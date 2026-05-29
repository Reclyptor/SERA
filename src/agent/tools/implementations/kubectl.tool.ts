import { z } from 'zod';
import { createHash } from 'crypto';
import { PassThrough } from 'stream';
import * as k8s from '@kubernetes/client-node';
import * as yaml from 'js-yaml';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';
import type { ToolApprovalRequester } from '../tool-approval.service';
import { truncateOutput } from './tool-utils';

const READ_OPS = [
  'list',
  'get',
  'describe',
  'logs',
  'events',
  'top_pods',
  'top_nodes',
] as const;

const MUTATING_OPS = [
  'apply',
  'delete',
  'delete_pod',
  'scale',
  'rollout_restart',
  'rollout_undo',
  'cordon',
  'uncordon',
  'drain_pod',
  'exec',
  'patch',
] as const;

const OPERATIONS = [...READ_OPS, ...MUTATING_OPS] as const;

const PATCH_TYPES = ['json', 'merge', 'strategic'] as const;

const MAX_OUTPUT_SIZE = 64 * 1024;
const EXEC_TIMEOUT_MS = 30_000;
const LOGS_TAIL_DEFAULT = 200;
const LOGS_TAIL_MAX = 500;

const parameters = z.object({
  operation: z.enum(OPERATIONS).describe('kubectl operation to perform'),
  kind: z
    .string()
    .optional()
    .describe(
      'Kubernetes kind (Pod, Deployment, Service, …). Required for list/get/describe/delete/scale/rollout_restart/rollout_undo/patch.',
    ),
  name: z
    .string()
    .optional()
    .describe('Resource name (required for get/describe/delete/scale/...).'),
  namespace: z
    .string()
    .optional()
    .describe('Target namespace; defaults to kubeconfig current or "default".'),
  allNamespaces: z
    .boolean()
    .optional()
    .describe('list/events across all namespaces'),
  apiVersion: z
    .string()
    .optional()
    .describe(
      'Override apiVersion for the kind (e.g. apps/v1). Defaults vary by kind.',
    ),
  manifest: z
    .string()
    .optional()
    .describe(
      'YAML manifest text for `apply` (may contain multiple --- separated documents).',
    ),
  replicas: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Replica count for `scale`.'),
  tailLines: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      `Tail size for logs (default ${LOGS_TAIL_DEFAULT}, max ${LOGS_TAIL_MAX}).`,
    ),
  container: z
    .string()
    .optional()
    .describe('Container name for logs/exec when the pod has multiple.'),
  command: z
    .array(z.string())
    .optional()
    .describe('argv for `exec` (e.g. ["sh","-c","echo hi"]).'),
  patch: z
    .string()
    .optional()
    .describe(
      'Patch body for `patch` (JSON for json/merge, YAML or JSON for strategic).',
    ),
  patchType: z
    .enum(PATCH_TYPES)
    .optional()
    .describe('Patch content type for `patch` (default merge).'),
  gracePeriodSeconds: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Grace period for delete/delete_pod/drain_pod.'),
});

type Args = z.infer<typeof parameters>;

interface KindMeta {
  apiVersion: string;
  namespaced: boolean;
}

// Minimal, common-kind table. Falls back to KubernetesObjectApi.resource()
// for anything not listed.
const KIND_TABLE: Record<string, KindMeta> = {
  Pod: { apiVersion: 'v1', namespaced: true },
  Service: { apiVersion: 'v1', namespaced: true },
  ConfigMap: { apiVersion: 'v1', namespaced: true },
  Secret: { apiVersion: 'v1', namespaced: true },
  ServiceAccount: { apiVersion: 'v1', namespaced: true },
  PersistentVolumeClaim: { apiVersion: 'v1', namespaced: true },
  PersistentVolume: { apiVersion: 'v1', namespaced: false },
  Namespace: { apiVersion: 'v1', namespaced: false },
  Node: { apiVersion: 'v1', namespaced: false },
  Event: { apiVersion: 'v1', namespaced: true },
  Endpoints: { apiVersion: 'v1', namespaced: true },
  Deployment: { apiVersion: 'apps/v1', namespaced: true },
  StatefulSet: { apiVersion: 'apps/v1', namespaced: true },
  DaemonSet: { apiVersion: 'apps/v1', namespaced: true },
  ReplicaSet: { apiVersion: 'apps/v1', namespaced: true },
  Job: { apiVersion: 'batch/v1', namespaced: true },
  CronJob: { apiVersion: 'batch/v1', namespaced: true },
  Ingress: { apiVersion: 'networking.k8s.io/v1', namespaced: true },
  NetworkPolicy: { apiVersion: 'networking.k8s.io/v1', namespaced: true },
  HorizontalPodAutoscaler: { apiVersion: 'autoscaling/v2', namespaced: true },
};

export class KubectlTool implements Tool<typeof parameters> {
  readonly name = 'kubectl';
  readonly description =
    'Direct cluster management via the Kubernetes API. Reads (list/get/describe/logs/events/top_pods/top_nodes) run immediately; mutations require operator approval. For declarative changes that should survive FluxCD reconciliation, prefer the `cluster_git` tool — `kubectl` mutations are appropriate for diagnostics, emergencies, or when Flux itself is degraded.';
  readonly parameters = parameters;
  readonly parallelSafe = false;

  private readonly kc: k8s.KubeConfig | null;
  private readonly coreApi: k8s.CoreV1Api | null;
  private readonly appsApi: k8s.AppsV1Api | null;
  private readonly objectApi: k8s.KubernetesObjectApi | null;
  private readonly metricsApi: k8s.Metrics | null;
  private readonly initError: string | null;

  constructor(
    kubeconfigContent: string | null,
    kubeContext: string | null,
    private readonly approvalRequester?: ToolApprovalRequester,
  ) {
    const kc = new k8s.KubeConfig();
    try {
      if (!kubeconfigContent || kubeconfigContent.trim() === '') {
        throw new Error('KUBECONFIG env var is not set');
      }
      kc.loadFromString(kubeconfigContent);
      if (kubeContext) {
        kc.setCurrentContext(kubeContext);
      }
      this.kc = kc;
      this.coreApi = kc.makeApiClient(k8s.CoreV1Api);
      this.appsApi = kc.makeApiClient(k8s.AppsV1Api);
      this.objectApi = k8s.KubernetesObjectApi.makeApiClient(kc);
      this.metricsApi = new k8s.Metrics(kc);
      this.initError = null;
    } catch (err) {
      this.kc = null;
      this.coreApi = null;
      this.appsApi = null;
      this.objectApi = null;
      this.metricsApi = null;
      this.initError = err instanceof Error ? err.message : String(err);
    }
  }

  async execute(
    args: Args,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (this.initError || !this.kc) {
      return {
        success: false,
        error: `kubectl unavailable: ${this.initError ?? 'kubeconfig not loaded'}`,
      };
    }
    try {
      switch (args.operation) {
        case 'list':
          return await this.opList(args);
        case 'get':
          return await this.opGet(args);
        case 'describe':
          return await this.opDescribe(args);
        case 'logs':
          return await this.opLogs(args);
        case 'events':
          return await this.opEvents(args);
        case 'top_pods':
          return await this.opTopPods(args);
        case 'top_nodes':
          return await this.opTopNodes();
        case 'apply':
          return await this.opApply(args, context);
        case 'delete':
          return await this.opDelete(args, context);
        case 'delete_pod':
          return await this.opDeletePod(args, context);
        case 'scale':
          return await this.opScale(args, context);
        case 'rollout_restart':
          return await this.opRolloutRestart(args, context);
        case 'rollout_undo':
          return await this.opRolloutUndo(args, context);
        case 'cordon':
          return await this.opCordon(args, context, true);
        case 'uncordon':
          return await this.opCordon(args, context, false);
        case 'drain_pod':
          return await this.opDrainPod(args, context);
        case 'exec':
          return await this.opExec(args, context);
        case 'patch':
          return await this.opPatch(args, context);
      }
    } catch (err) {
      return {
        success: false,
        error: this.formatError(err),
      };
    }
  }

  // ───────── Read operations ─────────

  private async opList(args: Args): Promise<ToolExecutionResult> {
    if (!args.kind) {
      return { success: false, error: 'list requires `kind`' };
    }
    const meta = this.resolveKind(args.kind, args.apiVersion);
    const ns = args.allNamespaces ? undefined : this.namespaceFor(args, meta);
    const list = await this.objectApi!.list(
      meta.apiVersion,
      args.kind,
      meta.namespaced ? ns : undefined,
    );
    const items = (list.items ?? []).map((item) => ({
      name: item.metadata?.name,
      namespace: item.metadata?.namespace,
      creationTimestamp: item.metadata?.creationTimestamp,
      labels: item.metadata?.labels,
    }));
    return {
      success: true,
      result: {
        kind: args.kind,
        apiVersion: meta.apiVersion,
        namespace: ns,
        count: items.length,
        items,
      },
    };
  }

  private async opGet(args: Args): Promise<ToolExecutionResult> {
    if (!args.kind || !args.name) {
      return { success: false, error: 'get requires `kind` and `name`' };
    }
    const meta = this.resolveKind(args.kind, args.apiVersion);
    const obj = await this.objectApi!.read({
      apiVersion: meta.apiVersion,
      kind: args.kind,
      metadata: {
        name: args.name,
        namespace: meta.namespaced ? this.namespaceFor(args, meta) : undefined,
      },
    });
    return { success: true, result: obj };
  }

  private async opDescribe(args: Args): Promise<ToolExecutionResult> {
    if (!args.kind || !args.name) {
      return { success: false, error: 'describe requires `kind` and `name`' };
    }
    const meta = this.resolveKind(args.kind, args.apiVersion);
    const namespace = meta.namespaced
      ? this.namespaceFor(args, meta)
      : undefined;
    const obj = await this.objectApi!.read({
      apiVersion: meta.apiVersion,
      kind: args.kind,
      metadata: { name: args.name, namespace },
    });
    const events = await this.findEventsFor(args.kind, args.name, namespace);
    return {
      success: true,
      result: {
        kind: args.kind,
        name: args.name,
        namespace,
        spec: (obj as { spec?: unknown }).spec,
        status: (obj as { status?: unknown }).status,
        metadata: (obj as { metadata?: unknown }).metadata,
        events,
      },
    };
  }

  private async opLogs(args: Args): Promise<ToolExecutionResult> {
    if (!args.name) {
      return { success: false, error: 'logs requires `name` (pod name)' };
    }
    const namespace = this.namespaceFor(args, KIND_TABLE.Pod);
    const tail = Math.min(args.tailLines ?? LOGS_TAIL_DEFAULT, LOGS_TAIL_MAX);
    const log = await this.coreApi!.readNamespacedPodLog({
      name: args.name,
      namespace,
      container: args.container,
      follow: false,
      limitBytes: MAX_OUTPUT_SIZE,
      tailLines: tail,
    });
    return {
      success: true,
      result: {
        pod: args.name,
        namespace,
        container: args.container,
        tailLines: tail,
        log: truncateOutput(log, MAX_OUTPUT_SIZE),
      },
    };
  }

  private async opEvents(args: Args): Promise<ToolExecutionResult> {
    const events = args.allNamespaces
      ? await this.coreApi!.listEventForAllNamespaces({})
      : await this.coreApi!.listNamespacedEvent({
          namespace: this.namespaceFor(args, KIND_TABLE.Event),
        });
    const items = (events.items ?? []).map((evt) => ({
      namespace: evt.metadata?.namespace,
      name: evt.metadata?.name,
      reason: evt.reason,
      message: evt.message,
      type: evt.type,
      count: evt.count,
      lastTimestamp: evt.lastTimestamp,
      involvedKind: evt.involvedObject?.kind,
      involvedName: evt.involvedObject?.name,
    }));
    return {
      success: true,
      result: { count: items.length, events: items },
    };
  }

  private async opTopPods(args: Args): Promise<ToolExecutionResult> {
    const namespace = args.allNamespaces
      ? undefined
      : this.namespaceFor(args, KIND_TABLE.Pod);
    const metrics = await this.metricsApi!.getPodMetrics(namespace);
    const items = (metrics.items ?? []).map((pod) => ({
      namespace: pod.metadata?.namespace,
      name: pod.metadata?.name,
      containers: pod.containers?.map((c) => ({
        name: c.name,
        cpu: c.usage?.cpu,
        memory: c.usage?.memory,
      })),
    }));
    return { success: true, result: { count: items.length, pods: items } };
  }

  private async opTopNodes(): Promise<ToolExecutionResult> {
    const metrics = await this.metricsApi!.getNodeMetrics();
    const items = (metrics.items ?? []).map((node) => ({
      name: node.metadata?.name,
      cpu: node.usage?.cpu,
      memory: node.usage?.memory,
    }));
    return { success: true, result: { count: items.length, nodes: items } };
  }

  // ───────── Mutating operations ─────────

  private async opApply(
    args: Args,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!args.manifest) {
      return { success: false, error: 'apply requires `manifest`' };
    }
    const docs = yaml
      .loadAll(args.manifest)
      .filter((d): d is k8s.KubernetesObject => !!d && typeof d === 'object');
    if (docs.length === 0) {
      return { success: false, error: 'apply: manifest produced no documents' };
    }
    const manifestHash = createHash('sha256')
      .update(args.manifest)
      .digest('hex');
    const gate = await this.gateApproval(
      context,
      'kubectl.apply',
      {
        documents: docs.map((d) => ({
          kind: d.kind,
          name: d.metadata?.name,
          namespace: d.metadata?.namespace,
        })),
        manifestHash,
      },
      `Approval required to apply ${docs.length} manifest document(s) (sha256: ${manifestHash.slice(0, 12)})`,
    );
    if (gate) return gate;

    const applied: Array<Record<string, unknown>> = [];
    for (const doc of docs) {
      const result = await this.objectApi!.patch(
        doc,
        undefined,
        undefined,
        'sera',
        true,
        k8s.PatchStrategy.ServerSideApply,
      );
      applied.push({
        kind: result.kind,
        apiVersion: result.apiVersion,
        name: result.metadata?.name,
        namespace: result.metadata?.namespace,
        resourceVersion: result.metadata?.resourceVersion,
      });
    }
    return {
      success: true,
      result: { applied: applied.length, items: applied },
    };
  }

  private async opDelete(
    args: Args,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!args.kind || !args.name) {
      return { success: false, error: 'delete requires `kind` and `name`' };
    }
    const meta = this.resolveKind(args.kind, args.apiVersion);
    const namespace = meta.namespaced
      ? this.namespaceFor(args, meta)
      : undefined;
    const gate = await this.gateApproval(
      context,
      'kubectl.delete',
      { kind: args.kind, name: args.name, namespace },
      `Approval required to delete ${args.kind} ${args.name}${namespace ? ` in ${namespace}` : ''}`,
    );
    if (gate) return gate;
    const status = await this.objectApi!.delete(
      {
        apiVersion: meta.apiVersion,
        kind: args.kind,
        metadata: { name: args.name, namespace },
      },
      undefined,
      undefined,
      args.gracePeriodSeconds,
    );
    return {
      success: true,
      result: {
        kind: args.kind,
        name: args.name,
        namespace,
        status: status.status,
        message: status.message,
      },
    };
  }

  private async opDeletePod(
    args: Args,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!args.name) {
      return { success: false, error: 'delete_pod requires `name`' };
    }
    const namespace = this.namespaceFor(args, KIND_TABLE.Pod);
    const gate = await this.gateApproval(
      context,
      'kubectl.delete_pod',
      { name: args.name, namespace },
      `Approval required to delete pod ${args.name} in ${namespace}`,
    );
    if (gate) return gate;
    await this.coreApi!.deleteNamespacedPod({
      name: args.name,
      namespace,
      gracePeriodSeconds: args.gracePeriodSeconds,
    });
    return {
      success: true,
      result: { pod: args.name, namespace, action: 'deleted' },
    };
  }

  private async opScale(
    args: Args,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!args.kind || !args.name || args.replicas === undefined) {
      return {
        success: false,
        error: 'scale requires `kind`, `name`, and `replicas`',
      };
    }
    const meta = this.resolveKind(args.kind, args.apiVersion);
    if (!meta.namespaced) {
      return {
        success: false,
        error: `scale: ${args.kind} is not a namespaced resource`,
      };
    }
    const namespace = this.namespaceFor(args, meta);
    const gate = await this.gateApproval(
      context,
      'kubectl.scale',
      {
        kind: args.kind,
        name: args.name,
        namespace,
        replicas: args.replicas,
      },
      `Approval required to scale ${args.kind} ${args.name} in ${namespace} to ${args.replicas} replicas`,
    );
    if (gate) return gate;
    const patched = await this.objectApi!.patch(
      {
        apiVersion: meta.apiVersion,
        kind: args.kind,
        metadata: { name: args.name, namespace },
        spec: { replicas: args.replicas },
      } as k8s.KubernetesObject,
      undefined,
      undefined,
      undefined,
      undefined,
      k8s.PatchStrategy.MergePatch,
    );
    return {
      success: true,
      result: {
        kind: args.kind,
        name: args.name,
        namespace,
        replicas: (patched as { spec?: { replicas?: number } }).spec?.replicas,
      },
    };
  }

  private async opRolloutRestart(
    args: Args,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!args.kind || !args.name) {
      return {
        success: false,
        error: 'rollout_restart requires `kind` and `name`',
      };
    }
    const meta = this.resolveKind(args.kind, args.apiVersion);
    const namespace = this.namespaceFor(args, meta);
    const gate = await this.gateApproval(
      context,
      'kubectl.rollout_restart',
      { kind: args.kind, name: args.name, namespace },
      `Approval required to restart rollout of ${args.kind} ${args.name} in ${namespace}`,
    );
    if (gate) return gate;
    const restartedAt = new Date().toISOString();
    await this.objectApi!.patch(
      {
        apiVersion: meta.apiVersion,
        kind: args.kind,
        metadata: { name: args.name, namespace },
        spec: {
          template: {
            metadata: {
              annotations: {
                'kubectl.kubernetes.io/restartedAt': restartedAt,
              },
            },
          },
        },
      } as k8s.KubernetesObject,
      undefined,
      undefined,
      undefined,
      undefined,
      k8s.PatchStrategy.StrategicMergePatch,
    );
    return {
      success: true,
      result: { kind: args.kind, name: args.name, namespace, restartedAt },
    };
  }

  private async opRolloutUndo(
    args: Args,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (args.kind !== 'Deployment' || !args.name) {
      return {
        success: false,
        error:
          'rollout_undo currently supports Deployment only; requires `kind: Deployment` and `name`',
      };
    }
    const namespace = this.namespaceFor(args, KIND_TABLE.Deployment);
    const gate = await this.gateApproval(
      context,
      'kubectl.rollout_undo',
      { kind: 'Deployment', name: args.name, namespace },
      `Approval required to roll back Deployment ${args.name} in ${namespace} to its previous revision`,
    );
    if (gate) return gate;
    const dep = await this.appsApi!.readNamespacedDeployment({
      name: args.name,
      namespace,
    });
    const currentRev = parseInt(
      dep.metadata?.annotations?.['deployment.kubernetes.io/revision'] ?? '0',
      10,
    );
    if (!currentRev || currentRev <= 1) {
      return {
        success: false,
        error: `rollout_undo: deployment has no previous revision (current=${currentRev})`,
      };
    }
    const targetRev = currentRev - 1;
    const selector = dep.spec?.selector?.matchLabels;
    if (!selector) {
      return {
        success: false,
        error: 'rollout_undo: deployment has no selector.matchLabels',
      };
    }
    const labelSelector = Object.entries(selector)
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    const rsList = await this.appsApi!.listNamespacedReplicaSet({
      namespace,
      labelSelector,
    });
    const target = (rsList.items ?? []).find(
      (rs) =>
        rs.metadata?.annotations?.['deployment.kubernetes.io/revision'] ===
        String(targetRev),
    );
    if (!target || !target.spec?.template) {
      return {
        success: false,
        error: `rollout_undo: previous ReplicaSet (revision ${targetRev}) not found for ${args.name}`,
      };
    }
    await this.objectApi!.patch(
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: args.name, namespace },
        spec: { template: target.spec.template },
      } as k8s.KubernetesObject,
      undefined,
      undefined,
      undefined,
      undefined,
      k8s.PatchStrategy.StrategicMergePatch,
    );
    return {
      success: true,
      result: {
        deployment: args.name,
        namespace,
        fromRevision: currentRev,
        toRevision: targetRev,
      },
    };
  }

  private async opCordon(
    args: Args,
    context: ToolExecutionContext,
    unschedulable: boolean,
  ): Promise<ToolExecutionResult> {
    if (!args.name) {
      return {
        success: false,
        error: `${unschedulable ? 'cordon' : 'uncordon'} requires \`name\` (node)`,
      };
    }
    const action = unschedulable ? 'cordon' : 'uncordon';
    const gate = await this.gateApproval(
      context,
      `kubectl.${action}`,
      { node: args.name },
      `Approval required to ${action} node ${args.name}`,
    );
    if (gate) return gate;
    await this.objectApi!.patch(
      {
        apiVersion: 'v1',
        kind: 'Node',
        metadata: { name: args.name },
        spec: { unschedulable },
      } as k8s.KubernetesObject,
      undefined,
      undefined,
      undefined,
      undefined,
      k8s.PatchStrategy.MergePatch,
    );
    return { success: true, result: { node: args.name, unschedulable } };
  }

  private async opDrainPod(
    args: Args,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!args.name) {
      return { success: false, error: 'drain_pod requires `name`' };
    }
    const namespace = this.namespaceFor(args, KIND_TABLE.Pod);
    const gate = await this.gateApproval(
      context,
      'kubectl.drain_pod',
      { name: args.name, namespace },
      `Approval required to evict pod ${args.name} from ${namespace}`,
    );
    if (gate) return gate;
    await this.coreApi!.createNamespacedPodEviction({
      name: args.name,
      namespace,
      body: {
        apiVersion: 'policy/v1',
        kind: 'Eviction',
        metadata: { name: args.name, namespace },
        deleteOptions:
          args.gracePeriodSeconds !== undefined
            ? { gracePeriodSeconds: args.gracePeriodSeconds }
            : undefined,
      },
    });
    return {
      success: true,
      result: { pod: args.name, namespace, action: 'evicted' },
    };
  }

  private async opExec(
    args: Args,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!args.name || !args.command || args.command.length === 0) {
      return {
        success: false,
        error: 'exec requires `name` and non-empty `command`',
      };
    }
    const namespace = this.namespaceFor(args, KIND_TABLE.Pod);
    const gate = await this.gateApproval(
      context,
      'kubectl.exec',
      {
        pod: args.name,
        namespace,
        container: args.container,
        command: args.command,
      },
      `Approval required to exec in pod ${args.name} (${namespace}): ${args.command.join(' ')}`,
    );
    if (gate) return gate;

    const exec = new k8s.Exec(this.kc!);
    const stdoutBuf: Buffer[] = [];
    const stderrBuf: Buffer[] = [];
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    stdout.on('data', (chunk: Buffer) => stdoutBuf.push(chunk));
    stderr.on('data', (chunk: Buffer) => stderrBuf.push(chunk));

    return await new Promise<ToolExecutionResult>((resolve) => {
      let settled = false;
      const settle = (result: ToolExecutionResult) => {
        if (settled) return;
        settled = true;
        try {
          stdout.end();
          stderr.end();
        } catch {
          /* noop */
        }
        resolve(result);
      };

      const timer = setTimeout(() => {
        settle({
          success: false,
          error: `exec timed out after ${EXEC_TIMEOUT_MS}ms`,
        });
      }, EXEC_TIMEOUT_MS);

      exec
        .exec(
          namespace,
          args.name!,
          args.container ?? '',
          args.command!,
          stderr,
          stdout,
          null,
          false,
          (status) => {
            clearTimeout(timer);
            const stdoutStr = truncateOutput(
              Buffer.concat(stdoutBuf).toString('utf-8'),
              MAX_OUTPUT_SIZE,
            );
            const stderrStr = truncateOutput(
              Buffer.concat(stderrBuf).toString('utf-8'),
              MAX_OUTPUT_SIZE,
            );
            const exitCode =
              status?.status === 'Success'
                ? 0
                : Number(
                    (
                      status?.details as {
                        causes?: Array<{ message?: string }>;
                      }
                    )?.causes?.[0]?.message ?? 1,
                  );
            settle({
              success: status?.status === 'Success',
              result: {
                pod: args.name,
                namespace,
                container: args.container,
                exitCode: isNaN(exitCode) ? 1 : exitCode,
                stdout: stdoutStr,
                stderr: stderrStr,
                status: status?.status,
                message: status?.message,
              },
              error: status?.status === 'Success' ? undefined : status?.message,
            });
          },
        )
        .catch((err: unknown) => {
          clearTimeout(timer);
          settle({ success: false, error: this.formatError(err) });
        });
    });
  }

  private async opPatch(
    args: Args,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!args.kind || !args.name || !args.patch) {
      return {
        success: false,
        error: 'patch requires `kind`, `name`, and `patch`',
      };
    }
    const meta = this.resolveKind(args.kind, args.apiVersion);
    const namespace = meta.namespaced
      ? this.namespaceFor(args, meta)
      : undefined;
    const strategy = this.resolvePatchStrategy(args.patchType ?? 'merge');
    const patchHash = createHash('sha256').update(args.patch).digest('hex');
    const gate = await this.gateApproval(
      context,
      'kubectl.patch',
      {
        kind: args.kind,
        name: args.name,
        namespace,
        patchType: args.patchType ?? 'merge',
        patchHash,
      },
      `Approval required to patch ${args.kind} ${args.name}${namespace ? ` in ${namespace}` : ''} (${args.patchType ?? 'merge'} patch, sha256: ${patchHash.slice(0, 12)})`,
    );
    if (gate) return gate;
    const parsed =
      args.patchType === 'json'
        ? (JSON.parse(args.patch) as unknown)
        : yaml.load(args.patch);
    const spec: k8s.KubernetesObject = {
      apiVersion: meta.apiVersion,
      kind: args.kind,
      metadata: { name: args.name, namespace },
      ...(parsed as Record<string, unknown>),
    };
    const patched = await this.objectApi!.patch(
      spec,
      undefined,
      undefined,
      undefined,
      undefined,
      strategy,
    );
    return {
      success: true,
      result: {
        kind: args.kind,
        name: args.name,
        namespace,
        resourceVersion: (
          patched as { metadata?: { resourceVersion?: string } }
        ).metadata?.resourceVersion,
      },
    };
  }

  // ───────── Helpers ─────────

  private resolveKind(kind: string, apiVersion?: string): KindMeta {
    if (apiVersion) {
      return { apiVersion, namespaced: KIND_TABLE[kind]?.namespaced ?? true };
    }
    const known = KIND_TABLE[kind];
    if (known) return known;
    // Default unknown kinds to v1 + namespaced; user can override via apiVersion.
    return { apiVersion: 'v1', namespaced: true };
  }

  private namespaceFor(args: Args, meta: KindMeta): string {
    if (args.namespace) return args.namespace;
    if (!meta.namespaced) return '';
    return (
      this.kc?.getContextObject(this.kc.getCurrentContext())?.namespace ??
      'default'
    );
  }

  private resolvePatchStrategy(
    t: (typeof PATCH_TYPES)[number],
  ): k8s.PatchStrategy {
    switch (t) {
      case 'json':
        return k8s.PatchStrategy.JsonPatch;
      case 'merge':
        return k8s.PatchStrategy.MergePatch;
      case 'strategic':
        return k8s.PatchStrategy.StrategicMergePatch;
    }
  }

  private async findEventsFor(
    kind: string,
    name: string,
    namespace?: string,
  ): Promise<Array<Record<string, unknown>>> {
    const fieldSelector = `involvedObject.name=${name},involvedObject.kind=${kind}`;
    const list = namespace
      ? await this.coreApi!.listNamespacedEvent({ namespace, fieldSelector })
      : await this.coreApi!.listEventForAllNamespaces({ fieldSelector });
    return (list.items ?? []).map((e) => ({
      reason: e.reason,
      message: e.message,
      type: e.type,
      count: e.count,
      lastTimestamp: e.lastTimestamp,
    }));
  }

  private async gateApproval(
    context: ToolExecutionContext,
    actionName: string,
    args: Record<string, unknown>,
    message: string,
  ): Promise<ToolExecutionResult | null> {
    if (!this.approvalRequester) {
      return {
        success: false,
        error: `${actionName} requires approval, but approval handling is unavailable`,
      };
    }
    const approval = await this.approvalRequester.requestApproval({
      threadID: context.threadID,
      runID: context.runID,
      actionName,
      args,
      message,
    });
    if (approval.status === 'approved') return null;
    if (approval.status === 'rejected') {
      return {
        success: false,
        error: `Operator rejected${approval.feedback ? `: ${approval.feedback}` : ''}`,
      };
    }
    return {
      success: false,
      result: {
        status: 'approval_required',
        confirmationID: approval.confirmationID,
        fingerprint: approval.fingerprint,
      },
      error: `${actionName} requires approval (${approval.confirmationID})`,
    };
  }

  private formatError(err: unknown): string {
    if (err instanceof Error) {
      const body = (err as { body?: { message?: string } }).body;
      if (body?.message) return `${err.message}: ${body.message}`;
      return err.message;
    }
    return String(err);
  }

  renderResultSummary(args: Args, result: unknown): string {
    const head = `[kubectl] ${args.operation}`;
    const tail =
      args.kind || args.name
        ? ` ${[args.kind, args.name].filter(Boolean).join('/')}`
        : '';
    if (result && typeof result === 'object') {
      const r = result as { count?: number; exitCode?: number };
      if (typeof r.count === 'number')
        return `${head}${tail} -> ${r.count} items`;
      if (typeof r.exitCode === 'number')
        return `${head}${tail} -> exit ${r.exitCode}`;
    }
    return `${head}${tail}`;
  }
}
