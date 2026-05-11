// Deep-link → seed-prompt translation for /admin's agent textarea.
// Public surfaces ship inline affordances that link to /admin with
// `?focus=…&intent=…` query params; this module turns those params
// into a human-readable opening line for the agent.
//
// Contract:
// - `focus` identifies the target. Recognised shapes:
//     * "book:<slug>"
//     * "tag:<tag>"
//     * "series:<name>"
//     * "log:<composite-id>"
// - `intent` (optional) narrows the request. Recognised shapes:
//     * "remove-tag:<tag>"             — drop a tag from the focused book
//     * "remove-from-series:<series>"  — drop a series membership
//
// Decoding is defensive — the values arrive over the wire URL-encoded.
// Unknown kinds or malformed inputs return an empty string so the
// textarea stays blank rather than carrying confusing seed text.

export function buildSeedPrompt(focus?: string, intent?: string): string {
  if (!focus || typeof focus !== "string") return "";
  const decodedFocus = safeDecode(focus);
  const [kindRaw, ...idParts] = decodedFocus.split(":");
  const kind = kindRaw?.trim();
  const id = idParts.join(":").trim();
  if (!kind || !id) return "";

  const subject = readableSubject(kind, id);
  if (!subject) return "";

  if (intent) {
    const decodedIntent = safeDecode(intent);
    const [actionRaw, ...detailParts] = decodedIntent.split(":");
    const action = actionRaw?.trim();
    const detail = detailParts.join(":").trim();
    if (action === "remove-from-series" && detail) {
      return `Edit ${subject}: remove '${detail}' from the series field.`;
    }
    if (action === "remove-tag" && detail) {
      return `Edit ${subject}: remove the '${detail}' tag.`;
    }
  }

  return `Edit ${subject}: `;
}

function readableSubject(kind: string, id: string): string | null {
  switch (kind) {
    case "book":
      return id;
    case "tag":
      return `the '${id}' tag`;
    case "series":
      return `the '${id}' series`;
    case "log":
      return `log entry ${id}`;
    default:
      return null;
  }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
