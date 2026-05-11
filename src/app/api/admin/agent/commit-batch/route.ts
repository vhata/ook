import { z } from "zod";
import { commitPatchBatch } from "@/lib/mcp/patch-batch";
import { commitPatchInputSchema } from "@/lib/mcp/patch";

// POST /api/admin/agent/commit-batch — body is { patches, message? }.
//
// Runs commitPatchBatch over a list of user-confirmed staged patches.
// Auth-gated by the proxy (same matcher as the per-patch endpoint).
// All-or-nothing semantics: every patch is validated against its
// current on-disk reference file before any write begins; the first
// invalid patch rejects the whole batch with no partial writes. One
// `via ook-admin/<id>` trailer per batch commit.

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  patches: z.array(commitPatchInputSchema).min(1),
  message: z.string().optional(),
});

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid-batch", detail: parsed.error.message }, { status: 400 });
  }

  try {
    const result = await commitPatchBatch({
      patches: parsed.data.patches,
      message: parsed.data.message,
    });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: "commit-failed", detail: (e as Error).message }, { status: 500 });
  }
}
