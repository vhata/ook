export type Heading = {
  text: string;
  slug: string;
};

// Pull H2 headings from a markdown body for the per-book page TOC.
export function extractHeadings(body: string): Heading[] {
  const out: Heading[] = [];
  const re = /^##\s+(.+?)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const text = m[1].trim();
    out.push({ text, slug: slugify(text) });
  }
  return out;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

// Remark plugin: rewrite `:::spoiler ... :::` container/leaf/text directives
// into HTML nodes (div / span) carrying data-spoiler="true". react-markdown's
// `components` prop then renders those into the Spoiler client component.
//
// Typed loosely because mdast-util-directive nodes are not in the base mdast
// types — they live in the directive plugin's own package.
type AnyNode = {
  type: string;
  name?: string;
  data?: { hName?: string; hProperties?: Record<string, unknown> };
  children?: AnyNode[];
};

export function remarkSpoilerDirective() {
  return (tree: AnyNode) => {
    walk(tree, (node) => {
      if (
        (node.type === "containerDirective" ||
          node.type === "leafDirective" ||
          node.type === "textDirective") &&
        node.name === "spoiler"
      ) {
        node.data = node.data ?? {};
        node.data.hName = node.type === "textDirective" ? "span" : "div";
        node.data.hProperties = { "data-spoiler": "true" };
      }
    });
  };
}

function walk(node: AnyNode, fn: (n: AnyNode) => void) {
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      fn(child);
      walk(child, fn);
    }
  }
}
