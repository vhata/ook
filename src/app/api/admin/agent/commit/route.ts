import { commitPatch } from "@/lib/mcp/book-tools";
import { commitPatchInputSchema } from "@/lib/mcp/patch";

// POST /api/admin/agent/commit — body is a CommitPatchInput.
//
// Runs commitPatch with the user-confirmed staged patch. Auth-gated by
// the proxy; the patch shape is re-validated here as defence-in-depth
// against a tampered client payload (the diff preview is the structural
// safety net, this is the schema gate).

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }

  const parsed = commitPatchInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid-patch", detail: parsed.error.message }, { status: 400 });
  }

  try {
    const result = await commitPatch(parsed.data);
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: "commit-failed", detail: (e as Error).message }, { status: 500 });
  }
}
