import { NodeUiSnapshot, SimEdge, SimMetrics, TopologyDiagnostic } from './types';

export function analyzeTopology(
  nodes: NodeUiSnapshot[],
  edges: SimEdge[],
  metrics: SimMetrics
): TopologyDiagnostic[] {
  const diagnostics: TopologyDiagnostic[] = [];

  if (nodes.length === 0) {
    return [
      {
        id: 'empty-canvas',
        severity: 'info',
        title: 'No components on canvas',
        detail: 'Add a Traffic Ingress node and downstream components from the left palette.',
      },
    ];
  }

  const hasIngress = nodes.some((n) => n.type === 'ingress');
  if (!hasIngress) {
    diagnostics.push({
      id: 'missing-ingress',
      severity: 'warning',
      title: 'No Traffic Ingress',
      detail: 'Add a Traffic Ingress node and wire it to your entry point to emit requests.',
    });
  }

  // Offline / crashed nodes
  for (const n of nodes) {
    if (n.isDown) {
      diagnostics.push({
        id: `offline-${n.id}`,
        severity: 'critical',
        nodeId: n.id,
        title: `${n.label} is offline`,
        detail: 'Injected crash active. Incoming requests fail with 503 unless routed around.',
      });
    }
  }

  // Overloaded nodes
  for (const n of nodes) {
    if (n.isDown) continue;
    if (n.status === 'overloaded') {
      const reason =
        n.type === 'database'
          ? 'Connection pool saturated; tail latency is degrading non-linearly and dropping 503s.'
          : n.type === 'queue'
            ? 'Buffer capacity exhausted; incoming burst exceeds drain capacity.'
            : 'Concurrency and overflow queue saturated; shedding requests with 503.';
      diagnostics.push({
        id: `overload-${n.id}`,
        severity: 'critical',
        nodeId: n.id,
        title: `Bottleneck at ${n.label}`,
        detail: reason,
      });
    } else if (n.status === 'degraded') {
      if (n.type === 'ratelimiter') {
        diagnostics.push({
          id: `rl-shed-${n.id}`,
          severity: 'info',
          nodeId: n.id,
          title: `${n.label} shedding excess traffic`,
          detail: 'Token bucket exhausted; excess burst requests are rejected with 429 to protect downstream.',
        });
      } else {
        diagnostics.push({
          id: `degraded-${n.id}`,
          severity: 'warning',
          nodeId: n.id,
          title: `Elevated pressure on ${n.label}`,
          detail: `Utilization at ${Math.round(n.utilization * 100)}% with ${n.queueDepth} queued requests.`,
        });
      }
    }
  }

  // Architectural hint if high drops on app/db with no cache or queue
  const hasCache = nodes.some((n) => n.type === 'cache');
  const hasQueue = nodes.some((n) => n.type === 'queue');
  if (metrics.droppedRps > 5 && (!hasCache || !hasQueue)) {
    diagnostics.push({
      id: 'arch-suggestion',
      severity: 'info',
      title: !hasCache ? 'Consider adding an Edge Cache' : 'Consider adding a Message Queue',
      detail: !hasCache
        ? 'An Edge Cache upstream can absorb read traffic in cyan without hitting compute or database pools.'
        : 'A Message Queue buffers sudden spikes and drains at a steady rate to stop cascading 503s.',
    });
  }

  // Disconnected non-ingress nodes
  for (const n of nodes) {
    if (n.type === 'ingress') continue;
    const hasIncoming = edges.some((e) => e.to === n.id);
    if (!hasIncoming) {
      diagnostics.push({
        id: `unwired-${n.id}`,
        severity: 'info',
        nodeId: n.id,
        title: `${n.label} has no upstream input`,
        detail: 'Wire an upstream output port into this node so traffic can reach it.',
      });
    }
  }

  if (diagnostics.length === 0) {
    diagnostics.push({
      id: 'healthy-all',
      severity: 'info',
      title: 'Topology operating within capacity',
      detail: `Processing ${metrics.totalRps.toFixed(0)} req/s with ${metrics.successRate.toFixed(1)}% success and ${Math.round(metrics.p95LatencyMs)}ms p95 latency.`,
    });
  }

  return diagnostics.slice(0, 6);
}
