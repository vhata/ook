import { commitPatch } from "@/lib/mcp/book-tools";
import { commitPatchInputSchema } from "@/lib/mcp/patch";
import { commitPatchBatch } from "@/lib/mcp/patch-batch";
import {
  appendBulletPatchSchema,
  createFilePatchSchema,
  removeFilePatchSchema,
  type MetaPatch,
} from "@/lib/mcp/meta-patch";
import { z } from "zod";

// POST /api/admin/agent/commit — body is a CommitPatchInput, optionally
// with a `meta_patches` array of `create-file` / `remove-file` /
// `append-bullet` entries (the progress-archive dance the agent stages
// on finish; the quiet-return Note appended to _meta/log.md).
//
// Runs commitPatch with the user-confirmed staged patch. When
// `meta_patches` is present and non-empty, routes through
// commitPatchBatch instead so the book patch + meta operations land in
// one atomic commit. Auth-gated by the proxy; the patch shape is
// re-validated here as defence-in-depth against a tampered client
// payload (the diff preview is the structural safety net, this is the
// schema gate).

export const dynamic = "force-dynamic";

const bodySchema = commitPatchInputSchema.extend({
  meta_patches: z
    .array(
      z.discriminatedUnion("kind", [
        createFilePatchSchema,
        removeFilePatchSchema,
        appendBulletPatchSchema,
      ]),
    )
    .optional(),
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
    return Response.json({ error: "invalid-patch", detail: parsed.error.message }, { status: 400 });
  }

  const { meta_patches: metaPatchesRaw, ...patch } = parsed.data;
  const metaPatches: MetaPatch[] = metaPatchesRaw ?? [];

  try {
    if (metaPatches.length > 0) {
      // Archive-on-finish (or other meta-patch-carrying flows) — route
      // through the batch path so the book patch and the meta ops land
      // as one commit.
      const result = await commitPatchBatch({
        patches: [patch],
        metaPatches,
        message: patch.commit_message,
      });
      return Response.json(result);
    }
    const result = await commitPatch(patch);
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: "commit-failed", detail: (e as Error).message }, { status: 500 });
  }
}
