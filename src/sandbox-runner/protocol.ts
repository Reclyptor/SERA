/**
 * Wire contract between the agent container and the sandbox sidecar.
 *
 * The sidecar exists so that executing agent-authored commands does not happen
 * in a process that holds credentials. The agent container's environment holds
 * API keys and database URIs; the sidecar's holds none. Since `/proc/1/environ`
 * is readable by any process sharing the container's uid, running commands
 * anywhere inside the agent container hands those credentials to whatever it
 * runs — sanitising the child's environment does not help. Containers in a pod
 * get separate PID namespaces, so a command in the sidecar cannot read the
 * agent's environment at all.
 *
 * This file is imported by both sides. Keep it free of Nest and of any runtime
 * dependency, so the sidecar entrypoint stays bootable without the agent's
 * config schema.
 */

export const DEFAULT_RUNNER_PORT = 3002;
export const MAX_OUTPUT_SIZE = 64 * 1024;
export const DEFAULT_TIMEOUT_MS = 30_000;

export interface SandboxExecRequest {
  command: string;
  /** Relative to workspaceDir. Absent means the workspace root. */
  cwd?: string;
  timeoutMs?: number;
  workspaceDir: string;
  memoryMb: number;
  networkEnabled: boolean;
  /** Extra variables for the command. The runner passes nothing else through. */
  envVars?: Record<string, string>;
}

export interface SandboxExecResponse {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function truncateOutput(s: string, max = MAX_OUTPUT_SIZE): string {
  return s.length > max ? s.slice(0, max) + '\n[...truncated]' : s;
}
