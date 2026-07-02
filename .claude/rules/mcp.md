---
paths:
  - "client/src/mcp*.ts"
  - "mcp-server/**"
---

# MCP integration

`mcpSocketServer.ts`, `mcpHttpServer.ts`, `mcpTools.ts` expose GemStone operations via MCP so AI tools (Claude Desktop, Claude Code) can interact with a running GemStone session. The standalone `mcp-server/` process can run as stdio, SSE, or proxy transport; `tools.ts` registers MCP tools and `mcpSession.ts` wraps a GCI session for AI tool calls.

See `docs/mcp-server.md` for the full design.
