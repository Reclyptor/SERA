import { exec } from 'child_process';
import {
  DEFAULT_TIMEOUT_MS,
  MAX_OUTPUT_SIZE,
  truncateOutput,
  type SandboxExecRequest,
  type SandboxExecResponse,
} from './protocol';

export function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export interface NamespaceSupport {
  pid: boolean;
  net: boolean;
}

/**
 * Build the command actually handed to /bin/sh.
 *
 * Exported for tests: the quoting and the conditional `unshare` wrapper are the
 * parts most likely to break silently, and a broken wrapper degrades to running
 * unconfined rather than failing loudly.
 */
export function buildWrappedCommand(
  command: string,
  memoryMb: number,
  timeoutMs: number,
  networkEnabled: boolean,
  ns: NamespaceSupport,
): string {
  const timeoutSec = Math.ceil(timeoutMs / 1000);

  // No `ulimit -u`. RLIMIT_NPROC counts every process owned by the uid across
  // the whole host, not within the container, so on a shared node it is
  // already consumed by unrelated pods running as the same uid. The previous
  // value of 64 was therefore never a fork-bomb guard — it sat far below the
  // ambient count and made every command that needed a second process (any
  // pipeline) fail with "can't fork", while a genuine fork bomb would be
  // bounded by the same ambient ceiling regardless of what we set here.
  //
  // Bounding process count per container is the cgroup pids controller's job,
  // reached in Kubernetes through the kubelet's podPidsLimit rather than from
  // the pod spec. Until that is set, the sandbox container's memory limit is
  // what contains a runaway: it OOM-kills the sidecar alone, leaving the agent
  // container running.
  const limits = [
    `ulimit -v ${memoryMb * 1024} 2>/dev/null`,
    `ulimit -t ${timeoutSec} 2>/dev/null`,
    `ulimit -n 256 2>/dev/null`,
    `ulimit -f 65536 2>/dev/null`,
  ].join('; ');

  // The command is NOT prefixed with `exec`. Doing so replaces the shell with
  // the first command, which silently discards everything after a `&&`, `;`,
  // or newline — and still exits 0, so the truncation looks like success. That
  // is fatal for the `shell` tool, whose whole purpose is multi-line scripts.
  //
  // Keeping the shell as the parent costs one extra process. The CPU-time
  // ulimit still applies, because rlimits are inherited by children.
  const inner = `${limits}\n${command}`;

  const nsFlags: string[] = [];
  if (ns.pid) nsFlags.push('--pid', '--fork');
  if (ns.net && !networkEnabled) nsFlags.push('--net');

  return nsFlags.length > 0
    ? `unshare ${nsFlags.join(' ')} /bin/sh -c ${shellQuote(inner)}`
    : inner;
}

/**
 * The sidecar's environment carries no credentials, so this is defence in
 * depth rather than the boundary — but a command still has no business
 * inheriting the runner's own variables.
 */
export function buildEnv(
  workDir: string,
  envVars: Record<string, string> = {},
): Record<string, string> {
  return {
    HOME: workDir,
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    TMPDIR: `${workDir}/.tmp`,
    LANG: 'C.UTF-8',
    ...envVars,
  };
}

export function probeNamespaces(): Promise<NamespaceSupport> {
  const probe = (cmd: string) =>
    new Promise<boolean>((resolve) => {
      exec(cmd, { timeout: 3000 }, (error) => resolve(!error));
    });
  return Promise.all([
    probe('unshare --pid --fork true'),
    probe('unshare --net true'),
  ]).then(([pid, net]) => ({ pid, net }));
}

export function runCommand(
  req: SandboxExecRequest,
  ns: NamespaceSupport,
): Promise<SandboxExecResponse> {
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const workDir = req.cwd ? `${req.workspaceDir}/${req.cwd}` : req.workspaceDir;

  const wrapped = buildWrappedCommand(
    req.command,
    req.memoryMb,
    timeoutMs,
    req.networkEnabled,
    ns,
  );

  return new Promise((resolve) => {
    const child = exec(
      wrapped,
      {
        cwd: workDir,
        shell: '/bin/sh',
        timeout: timeoutMs + 2000,
        maxBuffer: MAX_OUTPUT_SIZE,
        env: buildEnv(workDir, req.envVars),
      },
      (error, stdout, stderr) => {
        if (error && error.killed) {
          resolve({
            exitCode: 137,
            stdout: '',
            stderr: `Timed out after ${timeoutMs}ms`,
          });
          return;
        }
        resolve({
          exitCode: error ? (error.code ?? 1) : 0,
          stdout: truncateOutput(stdout),
          stderr: truncateOutput(stderr),
        });
      },
    );

    setTimeout(() => child.kill('SIGTERM'), timeoutMs + 3000);
  });
}
