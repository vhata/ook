import { runAgent } from "@/lib/admin/agent";

// POST /api/admin/agent — body: {userText}.
// Returns AgentResult: either {kind: "needs-clarification", ...} or
// {kind: "patch-staged", patch, summary, conversation}. Does NOT
// commit; the client is responsible for showing the diff and posting
// to /api/admin/agent/commit on confirm.

export const dynamic = "force-dynamic";

type Body = { userText?: string };

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

  try {
    const result = await runAgent({
      userText: body.userText,
      apiKey,
      model: process.env.ANTHROPIC_MODEL,
    });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: "agent-failed", detail: (e as Error).message }, { status: 500 });
  }
}
