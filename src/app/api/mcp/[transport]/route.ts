import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { listBingo, listBingoInputSchema, listBooks, listBooksInputSchema } from "@/lib/mcp/tools";

// MCP HTTP transport at /api/mcp/[transport]. The `[transport]`
// segment is currently ignored — the SDK exposes a single Streamable
// HTTP transport, but the URL shape leaves room to grow (e.g. an
// alternative read-only transport for unauthenticated tools).
//
// Auth: this route is gated by the proxy in src/proxy.ts. Unauth
// requests get a 401 before they reach this handler.
//
// Stateless mode: no session ID is generated. Each tool call is an
// independent request. This is the simplest deployment shape for
// serverless functions; if state is needed later (e.g. long-running
// tasks), revisit.

export const dynamic = "force-dynamic";

function buildServer(): McpServer {
  const server = new McpServer({ name: "ook", version: "0.1.0" });

  server.registerTool(
    "list_books",
    {
      title: "List books",
      description:
        "List books from the vault, optionally filtered by status, year, author, or tag. " +
        "Returns slim catalog entries; use get_book for reference notes.",
      inputSchema: listBooksInputSchema,
    },
    async (args) => {
      const result = await listBooks(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    "list_bingo",
    {
      title: "List bingo card",
      description: "Return the bingo card for a given year, including bound books.",
      inputSchema: listBingoInputSchema,
    },
    async (args) => {
      const card = await listBingo(args);
      return {
        content: [{ type: "text", text: JSON.stringify(card, null, 2) }],
      };
    },
  );

  return server;
}

async function handle(req: Request): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });
  const server = buildServer();
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    await server.close();
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
