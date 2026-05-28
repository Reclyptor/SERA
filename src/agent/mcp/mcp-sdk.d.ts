// Ambient module declarations for @modelcontextprotocol/sdk. The SDK is
// an optional runtime dependency (mcp-client.service.ts catches a
// missing-module error during onModuleInit and disables MCP features
// quietly). These stubs let the dynamic imports type-check even when
// the SDK is not installed; the service applies its own narrower
// `McpSdkModule` / `McpStdioModule` / `McpSseModule` types to the
// imported values at the call site.

declare module '@modelcontextprotocol/sdk/client/index.js' {
  const m: unknown;
  export = m;
}

declare module '@modelcontextprotocol/sdk/client/stdio.js' {
  const m: unknown;
  export = m;
}

declare module '@modelcontextprotocol/sdk/client/sse.js' {
  const m: unknown;
  export = m;
}
