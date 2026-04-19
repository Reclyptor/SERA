import * as http from 'http';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { ToolsRegistry } from '../tools.registry';
import type { ToolExecutionContext } from '../tool.interface';

const BRIDGE_TOOL_WHITELIST = new Set([
  'read',
  'web_fetch',
  'web_search',
  'memory_search',
  'memory_get',
]);

interface BridgeHandle {
  port: number;
  url: string;
  close: () => Promise<void>;
}

export async function startToolBridge(
  registry: ToolsRegistry,
  context: ToolExecutionContext,
): Promise<BridgeHandle> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      const match = req.url?.match(/^\/tool\/([a-z_]+)$/);
      if (!match) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }

      const toolName = match[1];
      if (!BRIDGE_TOOL_WHITELIST.has(toolName)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Tool "${toolName}" not available via bridge` }));
        return;
      }

      const tool = registry.get(toolName);
      if (!tool) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Tool "${toolName}" not found` }));
        return;
      }

      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 1024 * 1024) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Request body too large' }));
          return;
        }
      }

      try {
        const args = body ? JSON.parse(body) : {};
        const result = await tool.execute(args, context);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: err instanceof Error ? err.message : 'Bridge execution failed',
        }));
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Failed to bind bridge server'));
        return;
      }

      const port = addr.port;
      const url = `http://127.0.0.1:${port}`;

      resolve({
        port,
        url,
        close: () =>
          new Promise<void>((res) => server.close(() => res())),
      });
    });

    server.on('error', reject);
  });
}

function jsHelper(bridgeUrl: string): string {
  return `// SERA Tool Bridge — auto-generated, do not edit
const SERA_BRIDGE = "${bridgeUrl}";

async function sera(toolName, args = {}) {
  const res = await fetch(\`\${SERA_BRIDGE}/tool/\${toolName}\`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  return res.json();
}

async function seraRead(filePath, encoding) {
  return sera("read", { path: filePath, ...(encoding && { encoding }) });
}

async function seraFetch(url, options = {}) {
  return sera("web_fetch", { url, ...options });
}

async function seraSearch(query, options = {}) {
  return sera("web_search", { query, ...options });
}

async function seraMemorySearch(query, limit) {
  return sera("memory_search", { query, ...(limit && { limit }) });
}

module.exports = { sera, seraRead, seraFetch, seraSearch, seraMemorySearch };
`;
}

function pyHelper(bridgeUrl: string): string {
  return `# SERA Tool Bridge — auto-generated, do not edit
import json
import urllib.request

SERA_BRIDGE = "${bridgeUrl}"

def sera(tool_name, args=None):
    data = json.dumps(args or {}).encode()
    req = urllib.request.Request(
        f"{SERA_BRIDGE}/tool/{tool_name}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())

def sera_read(file_path, encoding=None):
    args = {"path": file_path}
    if encoding:
        args["encoding"] = encoding
    return sera("read", args)

def sera_fetch(url, **kwargs):
    return sera("web_fetch", {"url": url, **kwargs})

def sera_search(query, **kwargs):
    return sera("web_search", {"query": query, **kwargs})

def sera_memory_search(query, limit=None):
    args = {"query": query}
    if limit:
        args["limit"] = limit
    return sera("memory_search", args)
`;
}

export async function writeHelperLibraries(
  tmpDir: string,
  bridgeUrl: string,
): Promise<void> {
  await Promise.all([
    fs.writeFile(path.join(tmpDir, 'sera_tools.js'), jsHelper(bridgeUrl)),
    fs.writeFile(path.join(tmpDir, 'sera_tools.py'), pyHelper(bridgeUrl)),
  ]);
}
