import { runAgent, type AgentState } from "@/lib/admin/agent";

// POST /api/admin/agent — body: {userText, priorState?}.
// Returns AgentResult: either {kind: "needs-clarification", ...} or
// {kind: "patch-staged", patch, summary, conversation, state}. Does NOT
// commit; the client is responsible for showing the diff and posting
// to /api/admin/agent/commit on confirm.
//
// `priorState` is the opaque round-trippable handle returned from a
// previous turn — when present, the new userText is appended as a
// follow-up message and the agent has memory of the earlier exchange.
// This is the mechanism behind the finish-flow pullquote/rating gate:
// turn 1 asks the questions, turn 2 receives the answers, the bundled
// patch is staged.

export const dynamic = "force-dynamic";

type Body = { userText?: string; priorState?: AgentState };

export async function POST(req: Request): Promise<Response> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      {
        error: "anthropic-not-configured",
        detail:
          "ANTHROPIC_API_KEY is not set on the server. The admin console " +
          "is read-ready but cannot orchestrate writes until configured.",
      },
      { status: 503 },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  if (typeof body.userText !== "string" || body.userText.trim().length === 0) {
    return Response.json({ error: "userText-required" }, { status: 400 });
  }
  if (body.userText.length > 4000) {
    return Response.json({ error: "userText-too-long" }, { status: 400 });
  }

  // Lightweight shape gate on priorState — the route doesn't introspect
  // the messages array (that's agent.ts's private contract), but reject
  // an obviously-malformed payload before it reaches the SDK. Cap the
  // size so a tampered client can't grow the request unbounded.
  let priorState: AgentState | undefined;
  if (body.priorState !== undefined) {
    if (
      body.priorState === null ||
      typeof body.priorState !== "object" ||
      !Array.isArray((body.priorState as AgentState).messages)
    ) {
      return Response.json({ error: "invalid-prior-state" }, { status: 400 });
    }
    if ((body.priorState as AgentState).messages.length > 64) {
      return Response.json({ error: "prior-state-too-long" }, { status: 400 });
    }
    priorState = body.priorState;
  }

  try {
    const result = await runAgent({
      userText: body.userText,
      apiKey,
      model: process.env.ANTHROPIC_MODEL,
      priorState,
    });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: "agent-failed", detail: (e as Error).message }, { status: 500 });
  }
}
