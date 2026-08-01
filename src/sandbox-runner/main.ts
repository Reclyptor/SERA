import * as http from 'http';
import { probeNamespaces, runCommand, type NamespaceSupport } from './exec';
import {
  DEFAULT_RUNNER_PORT,
  type SandboxExecRequest,
  type SandboxExecResponse,
} from './protocol';

/**
 * Sandbox sidecar entrypoint.
 *
 * Deliberately plain Node: booting the Nest AppModule would run the agent's
 * env-schema validation and demand MONGODB_URI, the model keys, and the rest —
 * the exact credentials this container exists in order not to hold.
 *
 * Binds to loopback only. Containers in a pod share a network namespace, so
 * loopback reaches the agent container and nothing else; the listener is never
 * exposed to the cluster network.
 */

const MAX_BODY_BYTES = 1024 * 1024;

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function validate(body: unknown): SandboxExecRequest | string {
  if (!body || typeof body !== 'object') return 'Body must be an object';
  const r = body as Partial<SandboxExecRequest>;
  if (typeof r.command !== 'string' || r.command.trim() === '') {
    return '`command` is required';
  }
  if (typeof r.workspaceDir !== 'string' || r.workspaceDir === '') {
    return '`workspaceDir` is required';
  }
  if (typeof r.memoryMb !== 'number' || r.memoryMb <= 0) {
    return '`memoryMb` must be a positive number';
  }
  return {
    command: r.command,
    cwd: r.cwd,
    timeoutMs: r.timeoutMs,
    workspaceDir: r.workspaceDir,
    memoryMb: r.memoryMb,
    networkEnabled: r.networkEnabled === true,
    envVars: r.envVars,
  };
}

async function main(): Promise<void> {
  const port = Number(process.env.SANDBOX_RUNNER_PORT) || DEFAULT_RUNNER_PORT;
  const ns: NamespaceSupport = await probeNamespaces();

  const caps = [ns.pid ? 'pid' : null, ns.net ? 'net' : null].filter(Boolean);
  console.log(
    caps.length > 0
      ? `[sandbox-runner] namespace support: ${caps.join(', ')}`
      : '[sandbox-runner] no namespace isolation available — ulimit-only sandbox',
  );

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      send(res, 200, { status: 'ok' });
      return;
    }

    if (req.method !== 'POST' || req.url !== '/exec') {
      send(res, 404, { error: 'Not found' });
      return;
    }

    void (async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readBody(req));
      } catch (err) {
        send(res, 400, {
          error: err instanceof Error ? err.message : 'Invalid JSON',
        });
        return;
      }

      const validated = validate(parsed);
      if (typeof validated === 'string') {
        send(res, 400, { error: validated });
        return;
      }

      // A failed command is a successful request: the caller wants the exit
      // code and streams back, not an HTTP error.
      const result: SandboxExecResponse = await runCommand(validated, ns);
      send(res, 200, result);
    })();
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[sandbox-runner] listening on 127.0.0.1:${port}`);
  });

  const shutdown = (signal: string) => {
    console.log(`[sandbox-runner] ${signal} received, closing`);
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

void main();
