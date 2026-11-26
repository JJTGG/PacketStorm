import { createSimNode, NODE_DIMENSIONS, PRESETS } from './presets';
import {
  CacheHitBurst,
  DroppedParticle,
  NodeType,
  NodeUiSnapshot,
  Packet,
  PacketColor,
  PresetDefinition,
  SerializedTopology,
  SimEdge,
  SimMetrics,
  SimNode,
  SimNodeConfig,
  TimeSeriesPoint,
  TrafficPattern,
} from './types';

interface LatencySample {
  timeSec: number;
  ms: number;
}

interface OutcomeSample {
  timeSec: number;
  status: 'ok' | 'hit' | 'drop';
}

export class SimulationEngine {
  public nodes: SimNode[] = [];
  public edges: SimEdge[] = [];
  public packets: Packet[] = [];
  public droppedParticles: DroppedParticle[] = [];
  public cacheHitBursts: CacheHitBurst[] = [];
  public timeSeries: TimeSeriesPoint[] = [];
  public edgeRpsMap = new Map<string, number>();

  public isRunning = true;
  public trafficPattern: TrafficPattern = 'steady';
  public trafficIntensityRps = 65;
  public activePresetId = 'doomed-monolith';
  public simTimeSec = 0;

  private nextPacketId = 1;
  private nextParticleId = 1;
  private patternPhaseSec = 0;
  private rngState = 133742;

  private latencyWindow: LatencySample[] = [];
  private outcomeWindow: OutcomeSample[] = [];
  private edgeWindowCounts = new Map<string, number>();
  private completedTotal = 0;
  private cacheHitTotal = 0;
  private droppedTotal = 0;
  private effectiveIngressRps = 0;

  private lastMetricsSampleSec = 0;
  private lastSparklineSampleSec = 0;
  private lastTimeSeriesSampleSec = 0;
  private cachedMetrics: SimMetrics = {
    totalRps: 0,
    effectiveIngressRps: 0,
    successRate: 100,
    droppedRps: 0,
    droppedTotal: 0,
    p50LatencyMs: 0,
    p95LatencyMs: 0,
    activePackets: 0,
    completedTotal: 0,
    cacheHitTotal: 0,
    simTimeSec: 0,
  };

  constructor() {
    this.loadPreset(PRESETS[0]);
  }

  private nextRandom(): number {
    this.rngState = (this.rngState * 1664525 + 1013904223) >>> 0;
    return this.rngState / 4294967296;
  }

  public loadPreset(preset: PresetDefinition): void {
    this.activePresetId = preset.id;
    this.nodes = preset.nodes.map((n) =>
      createSimNode(n.id, n.type, n.x, n.y, n.label, n.config)
    );
    this.edges = preset.edges.map((e) => ({ ...e }));
    this.trafficIntensityRps = preset.recommendedIntensity;
    this.trafficPattern = preset.recommendedPattern;
    this.resetSimulationState();
  }

  public exportTopology(name = 'Custom PacketStorm Topology'): SerializedTopology {
    return {
      version: 1,
      name,
      trafficPattern: this.trafficPattern,
      trafficIntensityRps: this.trafficIntensityRps,
      nodes: this.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        label: n.label,
        x: Math.round(n.x),
        y: Math.round(n.y),
        config: { ...n.config },
      })),
      edges: this.edges.map((e) => ({ ...e })),
    };
  }

  public importTopology(data: SerializedTopology): boolean {
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges) || data.nodes.length === 0) {
      return false;
    }
    const validTypes = new Set<NodeType>([
      'ingress',
      'ratelimiter',
      'loadbalancer',
      'cache',
      'appserver',
      'queue',
      'database',
    ]);
    for (const n of data.nodes) {
      if (
        !n ||
        typeof n.id !== 'string' ||
        !validTypes.has(n.type) ||
        typeof n.label !== 'string' ||
        !Number.isFinite(n.x) ||
        !Number.isFinite(n.y)
      ) {
        return false;
      }
    }
    this.activePresetId = 'custom';
    this.nodes = data.nodes.map((n) =>
      createSimNode(n.id, n.type, n.x, n.y, n.label, n.config ?? {})
    );
    const nodeIds = new Set(this.nodes.map((n) => n.id));
    this.edges = data.edges
      .filter((e) => e && typeof e.id === 'string' && nodeIds.has(e.from) && nodeIds.has(e.to))
      .map((e) => ({ id: e.id, from: e.from, to: e.to }));
    if (
      data.trafficPattern === 'steady' ||
      data.trafficPattern === 'viral_spike' ||
      data.trafficPattern === 'bot_flood'
    ) {
      this.trafficPattern = data.trafficPattern;
    }
    if (typeof data.trafficIntensityRps === 'number' && Number.isFinite(data.trafficIntensityRps)) {
      this.setTrafficIntensity(data.trafficIntensityRps);
    }
    this.resetSimulationState();
    return true;
  }

  public resetSimulationState(): void {
    this.packets = [];
    this.droppedParticles = [];
    this.cacheHitBursts = [];
    this.latencyWindow = [];
    this.outcomeWindow = [];
    this.timeSeries = [];
    this.edgeRpsMap.clear();
    this.edgeWindowCounts.clear();
    this.completedTotal = 0;
    this.cacheHitTotal = 0;
    this.droppedTotal = 0;
    this.simTimeSec = 0;
    this.patternPhaseSec = 0;
    this.lastMetricsSampleSec = 0;
    this.lastSparklineSampleSec = 0;
    this.lastTimeSeriesSampleSec = 0;
    this.rngState = 133742;

    for (const node of this.nodes) {
      node.isDown = false;
      node.inFlight = [];
      node.queue = [];
      node.tokens = node.config.burstCapacity ?? 50;
      node.rrIndex = 0;
      node.drainAccumulator = 0;
      node.spawnAccumulator = 0;
      node.activeCount = 0;
      node.queueDepth = 0;
      node.utilization = 0;
      node.status = 'healthy';
      node.totalProcessed = 0;
      node.totalDropped = 0;
      node.totalCacheHits = 0;
      node.currentRps = 0;
      node.lastLatencyMs = 0;
      node.history = new Array(40).fill(0);
      node._windowProcessed = 0;
      node._overloadTimer = 0;
      node._pulseHit = 0;
      node._pulseDrop = 0;
    }

    this.recomputeMetrics();
  }

  public setTrafficPattern(pattern: TrafficPattern): void {
    this.trafficPattern = pattern;
    this.patternPhaseSec = 0;
  }

  public setTrafficIntensity(rps: number): void {
    this.trafficIntensityRps = Math.max(5, Math.min(500, rps));
  }

  public toggleNodeDown(nodeId: string): boolean {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) return false;
    node.isDown = !node.isDown;
    if (node.isDown) {
      node.status = 'offline';
      node.inFlight = [];
      node.queue = [];
      node.activeCount = 0;
      node.queueDepth = 0;
      node.utilization = 0;
    } else {
      node.status = 'healthy';
    }
    return node.isDown;
  }

  public addNode(type: NodeType, x: number, y: number): SimNode {
    const id = `${type}-${Date.now().toString(36)}-${Math.floor(this.nextRandom() * 1000)}`;
    const countOfType = this.nodes.filter((n) => n.type === type).length + 1;
    const baseLabel = createSimNode(id, type, x, y).label;
    const label = countOfType > 1 ? `${baseLabel} ${countOfType}` : baseLabel;
    const node = createSimNode(id, type, x, y, label);
    this.nodes.push(node);
    this.activePresetId = 'custom';
    return node;
  }

  public removeNode(nodeId: string): void {
    this.nodes = this.nodes.filter((n) => n.id !== nodeId);
    this.edges = this.edges.filter((e) => e.from !== nodeId && e.to !== nodeId);
    this.packets = this.packets.filter((p) => p.fromNodeId !== nodeId && p.toNodeId !== nodeId);
  }

  public addEdge(fromId: string, toId: string): SimEdge | null {
    if (fromId === toId) return null;
    const fromNode = this.nodes.find((n) => n.id === fromId);
    const toNode = this.nodes.find((n) => n.id === toId);
    if (!fromNode || !toNode) return null;
    if (fromNode.type === 'database' || toNode.type === 'ingress') return null;
    const duplicate = this.edges.some((e) => e.from === fromId && e.to === toId);
    if (duplicate) return null;

    const edge: SimEdge = {
      id: `e-${fromId}-${toId}-${Date.now().toString(36)}`,
      from: fromId,
      to: toId,
    };
    this.edges.push(edge);
    return edge;
  }

  public removeEdge(edgeId: string): void {
    this.edges = this.edges.filter((e) => e.id !== edgeId);
    this.packets = this.packets.filter((p) => p.edgeId !== edgeId);
    this.edgeRpsMap.delete(edgeId);
    this.edgeWindowCounts.delete(edgeId);
  }

  public updateNodeConfig(nodeId: string, patch: Partial<SimNodeConfig>): void {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    node.config = { ...node.config, ...patch };
    if (patch.burstCapacity !== undefined && node.tokens > patch.burstCapacity) {
      node.tokens = patch.burstCapacity;
    }
  }

  public updateNodeLabel(nodeId: string, label: string): void {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    node.label = label;
  }

  public getAllNodeSnapshots(): NodeUiSnapshot[] {
    return this.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      label: n.label,
      isDown: n.isDown,
      config: { ...n.config },
      activeCount: n.activeCount,
      queueDepth: n.queueDepth,
      utilization: n.utilization,
      status: n.status,
      totalProcessed: n.totalProcessed,
      totalDropped: n.totalDropped,
      totalCacheHits: n.totalCacheHits,
      currentRps: n.currentRps,
      lastLatencyMs: n.lastLatencyMs,
      tokens: n.tokens,
      history: [...n.history],
    }));
  }

  public getMetrics(): SimMetrics {
    return this.cachedMetrics;
  }

  public getTimeSeries(): TimeSeriesPoint[] {
    return this.timeSeries;
  }

  private getCurrentIngressMultiplier(): number {
    const t = this.patternPhaseSec;
    if (this.trafficPattern === 'steady') {
      return 0.96 + 0.08 * Math.sin(t * 1.4);
    }
    if (this.trafficPattern === 'viral_spike') {
      const cycle = t % 10;
      if (cycle < 5.5) {
        const ramp = Math.min(1, cycle / 0.6);
        const wave = 2.9 + 0.7 * Math.sin(cycle * 2.2);
        return 1.0 + ramp * (wave - 1.0);
      }
      return 1.25 + 0.25 * Math.sin(cycle * 1.5);
    }
    const burstCycle = t % 4.5;
    const isBurst = burstCycle < 3.2;
    const jitter = 0.85 + this.nextRandom() * 0.4;
    return isBurst ? 3.2 * jitter : 1.4 * jitter;
  }

  public step(rawDtSec: number): void {
    const dt = Math.min(rawDtSec, 0.05);
    if (!this.isRunning || dt <= 0) return;

    this.simTimeSec += dt;
    this.patternPhaseSec += dt;

    const nodeMap = new Map<string, SimNode>();
    for (const n of this.nodes) {
      nodeMap.set(n.id, n);
      n._pulseHit = Math.max(0, n._pulseHit - dt * 3.2);
      n._pulseDrop = Math.max(0, n._pulseDrop - dt * 2.8);
      if (n.isDown) {
        n.status = 'offline';
      }
    }

    const outgoingMap = new Map<string, SimEdge[]>();
    for (const edge of this.edges) {
      const list = outgoingMap.get(edge.from);
      if (list) list.push(edge);
      else outgoingMap.set(edge.from, [edge]);
    }

    const multiplier = this.getCurrentIngressMultiplier();
    const instantRps = this.trafficIntensityRps * multiplier;
    this.effectiveIngressRps = instantRps;

    // 1. Emit traffic from active Ingress nodes
    const ingressNodes = this.nodes.filter((n) => n.type === 'ingress' && !n.isDown);
    const perIngressRps = ingressNodes.length > 0 ? instantRps / ingressNodes.length : 0;

    for (const ing of ingressNodes) {
      ing.spawnAccumulator += perIngressRps * dt;
      ing.currentRps = perIngressRps;
      ing.utilization = Math.min(1, perIngressRps / 350);
      ing.status = 'healthy';

      const outs = outgoingMap.get(ing.id) ?? [];
      let spawnedThisTick = 0;
      while (ing.spawnAccumulator >= 1 && spawnedThisTick < 24) {
        ing.spawnAccumulator -= 1;
        spawnedThisTick++;
        ing.totalProcessed++;
        ing._windowProcessed++;

        if (outs.length > 0) {
          const edge = this.pickDownstreamEdge(ing, outs, nodeMap);
          if (edge) {
            this.spawnPacket(edge, 'ok', 0, false);
          } else {
            this.recordDrop(ing, '503');
          }
        }
      }
    }

    // 2. Process stateful nodes
    for (const node of this.nodes) {
      if (node.isDown) {
        node.status = 'offline';
        node.activeCount = 0;
        node.queueDepth = 0;
        node.utilization = 0;
        continue;
      }

      if (node.type === 'ratelimiter') {
        const rate = node.config.rateLimitRps ?? 180;
        const burst = node.config.burstCapacity ?? 60;
        node.tokens = Math.min(burst, node.tokens + rate * dt);
        node.utilization = Math.max(0, Math.min(1.2, 1 - node.tokens / Math.max(1, burst)));
        node.status = node._pulseDrop > 0.1 ? 'degraded' : 'healthy';
      } else if (node.type === 'appserver' || node.type === 'database') {
        const cap =
          node.type === 'database'
            ? node.config.poolSize ?? 16
            : node.config.maxConcurrency ?? 12;
        const qCap = node.config.queueCapacity ?? 24;

        const stillRunning = [];
        for (const req of node.inFlight) {
          req.remainingSec -= dt;
          if (req.remainingSec <= 0) {
            const totalReqLat = req.accumulatedLatencyMs + req.totalDurationSec * 1000;
            node.totalProcessed++;
            node._windowProcessed++;
            node.lastLatencyMs = totalReqLat;
            const packetColor: PacketColor =
              req.wasQueued || (node.type === 'database' && node.inFlight.length / cap > 0.75)
                ? 'queued'
                : 'ok';
            this.forwardOrComplete(node, outgoingMap, nodeMap, packetColor, totalReqLat, req.wasQueued);
          } else {
            stillRunning.push(req);
          }
        }
        node.inFlight = stillRunning;

        while (node.inFlight.length < cap && node.queue.length > 0) {
          const next = node.queue.shift()!;
          const waitMs = (this.simTimeSec - next.enqueuedAtSec) * 1000;
          const durSec = this.computeServiceDurationSec(node);
          node.inFlight.push({
            id: next.id,
            remainingSec: durSec,
            totalDurationSec: durSec,
            accumulatedLatencyMs: next.accumulatedLatencyMs + waitMs,
            wasQueued: true,
          });
        }

        node.activeCount = node.inFlight.length;
        node.queueDepth = node.queue.length;
        const activeRatio = node.activeCount / Math.max(1, cap);
        const queueRatio = node.queueDepth / Math.max(1, qCap);
        node.utilization = Math.min(1.5, activeRatio * 0.7 + queueRatio * 0.5);

        if (queueRatio >= 0.85 || node._pulseDrop > 0.25) {
          node._overloadTimer += dt;
          node.status = queueRatio >= 0.92 ? 'overloaded' : 'degraded';
        } else if (activeRatio >= 0.75 || queueRatio >= 0.2) {
          node._overloadTimer = Math.max(0, node._overloadTimer - dt);
          node.status = 'degraded';
        } else {
          node._overloadTimer = 0;
          node.status = 'healthy';
        }
      } else if (node.type === 'queue') {
        const qCap = node.config.queueCapacity ?? 400;
        const drainRate = node.config.drainRateRps ?? 120;
        const outs = outgoingMap.get(node.id) ?? [];

        if (outs.length > 0 && node.queue.length > 0) {
          node.drainAccumulator += drainRate * dt;
          let drained = 0;
          while (node.drainAccumulator >= 1 && node.queue.length > 0 && drained < 24) {
            node.drainAccumulator -= 1;
            drained++;
            const item = node.queue.shift()!;
            const waitMs = (this.simTimeSec - item.enqueuedAtSec) * 1000;
            node.totalProcessed++;
            node._windowProcessed++;
            node.lastLatencyMs = waitMs;

            const edge = this.pickDownstreamEdge(node, outs, nodeMap);
            if (edge) {
              const color: PacketColor =
                node.queue.length / Math.max(1, qCap) > 0.55 ? 'queued' : 'ok';
              this.spawnPacket(edge, color, item.accumulatedLatencyMs + waitMs, waitMs > 120);
            } else {
              this.recordDrop(node, '503');
            }
          }
        } else {
          node.drainAccumulator = 0;
        }

        node.queueDepth = node.queue.length;
        node.activeCount = node.queue.length;
        node.utilization = Math.min(1, node.queueDepth / Math.max(1, qCap));
        node.status =
          node.utilization > 0.9
            ? 'overloaded'
            : node.utilization > 0.45
              ? 'degraded'
              : 'healthy';
      }
    }

    // 3. Advance flying packets along edges
    const remainingPackets: Packet[] = [];
    for (const pkt of this.packets) {
      if (pkt.isReturn) {
        pkt.progress -= pkt.speed * dt;
        if (pkt.progress > 0) {
          remainingPackets.push(pkt);
        }
        continue;
      }
      pkt.progress += pkt.speed * dt;
      if (pkt.progress >= 1) {
        const target = nodeMap.get(pkt.toNodeId);
        if (target) {
          this.handlePacketArrival(target, pkt, outgoingMap, nodeMap);
        }
      } else {
        remainingPackets.push(pkt);
      }
    }
    this.packets = remainingPackets;

    // 4. Advance dropped particles & cache bursts
    const nextDrops: DroppedParticle[] = [];
    for (const d of this.droppedParticles) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.vy += 170 * dt;
      d.alpha -= 1.35 * dt;
      if (d.alpha > 0.02) nextDrops.push(d);
    }
    this.droppedParticles = nextDrops;

    const nextBursts: CacheHitBurst[] = [];
    for (const b of this.cacheHitBursts) {
      b.radius += 68 * dt;
      b.alpha -= 2.1 * dt;
      if (b.alpha > 0.02) nextBursts.push(b);
    }
    this.cacheHitBursts = nextBursts;

    // 5. Periodic Sparkline & Edge RPS Rollup (every 250ms)
    if (this.simTimeSec - this.lastSparklineSampleSec >= 0.25) {
      const elapsed = Math.max(0.1, this.simTimeSec - this.lastSparklineSampleSec);
      this.lastSparklineSampleSec = this.simTimeSec;

      for (const n of this.nodes) {
        n.currentRps = n._windowProcessed / elapsed;
        n._windowProcessed = 0;
        n.history.push(Math.min(1, n.utilization));
        if (n.history.length > 40) n.history.shift();
      }

      for (const edge of this.edges) {
        const count = this.edgeWindowCounts.get(edge.id) ?? 0;
        const instantEdgeRps = count / elapsed;
        const prev = this.edgeRpsMap.get(edge.id) ?? instantEdgeRps;
        this.edgeRpsMap.set(edge.id, prev * 0.45 + instantEdgeRps * 0.55);
        this.edgeWindowCounts.set(edge.id, 0);
      }
    }

    // 6. Global KPI metrics
    if (this.simTimeSec - this.lastMetricsSampleSec >= 0.15) {
      this.lastMetricsSampleSec = this.simTimeSec;
      this.recomputeMetrics();
    }

    // 7. 30-second Oscilloscope Time-Series Buffer (sampled every 0.5s -> 60 pts)
    if (this.simTimeSec - this.lastTimeSeriesSampleSec >= 0.5) {
      this.lastTimeSeriesSampleSec = this.simTimeSec;
      const m = this.cachedMetrics;
      this.timeSeries.push({
        timeSec: this.simTimeSec,
        ingressRps: m.effectiveIngressRps,
        successRps: Math.max(0, m.totalRps - m.droppedRps),
        droppedRps: m.droppedRps,
        p50Ms: m.p50LatencyMs,
        p95Ms: m.p95LatencyMs,
      });
      if (this.timeSeries.length > 60) {
        this.timeSeries.shift();
      }
    }
  }

  private computeServiceDurationSec(node: SimNode): number {
    const injectedMs = node.config.injectedLatencyMs ?? 0;
    if (node.type === 'database') {
      const pool = Math.max(1, node.config.poolSize ?? 16);
      const baseMs = (node.config.baseLatencyMs ?? 45) + injectedMs;
      const loadRatio = node.inFlight.length / pool;
      const effectiveMs = baseMs * (1 + 3.2 * Math.pow(loadRatio, 2.4));
      node.lastLatencyMs = effectiveMs;
      return Math.max(0.012, effectiveMs / 1000);
    }
    const baseMs = (node.config.processingTimeMs ?? 90) + injectedMs;
    const jitter = 0.88 + this.nextRandom() * 0.24;
    return Math.max(0.012, (baseMs * jitter) / 1000);
  }

  private handlePacketArrival(
    node: SimNode,
    pkt: Packet,
    outgoingMap: Map<string, SimEdge[]>,
    nodeMap: Map<string, SimNode>
  ): void {
    if (node.isDown) {
      this.recordDrop(node, '503');
      return;
    }

    const injectedMs = node.config.injectedLatencyMs ?? 0;
    const edgeFlightMs = 28;
    const arrivedLatency = pkt.accumulatedLatencyMs + edgeFlightMs + injectedMs;

    switch (node.type) {
      case 'ratelimiter': {
        if (node.tokens >= 1) {
          node.tokens -= 1;
          node.totalProcessed++;
          node._windowProcessed++;
          this.forwardOrComplete(node, outgoingMap, nodeMap, pkt.color, arrivedLatency, pkt.wasQueued);
        } else {
          this.recordDrop(node, '429');
        }
        break;
      }

      case 'cache': {
        const hitRate = (node.config.cacheHitRate ?? 60) / 100;
        node.totalProcessed++;
        node._windowProcessed++;
        const isHit = this.nextRandom() < hitRate;
        if (isHit) {
          node.totalCacheHits++;
          node._pulseHit = 1;
          node.lastLatencyMs = 4 + injectedMs;
          node.utilization = Math.min(1, node.currentRps / 250);
          this.cacheHitTotal++;
          this.completedTotal++;
          this.outcomeWindow.push({ timeSec: this.simTimeSec, status: 'hit' });
          this.latencyWindow.push({ timeSec: this.simTimeSec, ms: arrivedLatency + 4 });
          this.spawnCacheBurst(node);
          if (this.packets.length < 440) {
            this.packets.push({
              id: this.nextPacketId++,
              edgeId: pkt.edgeId,
              fromNodeId: pkt.fromNodeId,
              toNodeId: pkt.toNodeId,
              progress: 0.98,
              speed: 3.1,
              color: 'hit',
              accumulatedLatencyMs: arrivedLatency + 4,
              wasQueued: false,
              isReturn: true,
            });
          }
        } else {
          node.utilization = Math.min(1, node.currentRps / 250);
          this.forwardOrComplete(node, outgoingMap, nodeMap, pkt.color, arrivedLatency + 8, pkt.wasQueued);
        }
        break;
      }

      case 'loadbalancer': {
        node.totalProcessed++;
        node._windowProcessed++;
        const outs = outgoingMap.get(node.id) ?? [];
        const chosenEdge = this.pickDownstreamEdge(node, outs, nodeMap);
        if (!chosenEdge) {
          this.recordDrop(node, '503');
        } else {
          node.utilization = Math.min(1, node.currentRps / 350);
          this.spawnPacket(chosenEdge, pkt.color, arrivedLatency + 5, pkt.wasQueued);
        }
        break;
      }

      case 'appserver':
      case 'database': {
        const cap =
          node.type === 'database'
            ? node.config.poolSize ?? 16
            : node.config.maxConcurrency ?? 12;
        const qCap = node.config.queueCapacity ?? 24;

        if (node.inFlight.length < cap) {
          const durSec = this.computeServiceDurationSec(node);
          node.inFlight.push({
            id: pkt.id,
            remainingSec: durSec,
            totalDurationSec: durSec,
            accumulatedLatencyMs: pkt.accumulatedLatencyMs + edgeFlightMs,
            wasQueued: pkt.wasQueued,
          });
        } else if (node.queue.length < qCap) {
          node.queue.push({
            id: pkt.id,
            enqueuedAtSec: this.simTimeSec,
            accumulatedLatencyMs: pkt.accumulatedLatencyMs + edgeFlightMs,
          });
        } else {
          this.recordDrop(node, '503');
        }
        break;
      }

      case 'queue': {
        const qCap = node.config.queueCapacity ?? 400;
        if (node.queue.length < qCap) {
          node.queue.push({
            id: pkt.id,
            enqueuedAtSec: this.simTimeSec,
            accumulatedLatencyMs: arrivedLatency,
          });
        } else {
          this.recordDrop(node, '503');
        }
        break;
      }

      case 'ingress':
        break;
    }
  }

  private forwardOrComplete(
    node: SimNode,
    outgoingMap: Map<string, SimEdge[]>,
    nodeMap: Map<string, SimNode>,
    color: PacketColor,
    totalLatencyMs: number,
    wasQueued: boolean
  ): void {
    const outs = outgoingMap.get(node.id) ?? [];
    if (outs.length === 0) {
      this.completedTotal++;
      this.outcomeWindow.push({ timeSec: this.simTimeSec, status: 'ok' });
      this.latencyWindow.push({ timeSec: this.simTimeSec, ms: totalLatencyMs });
      return;
    }

    const edge = this.pickDownstreamEdge(node, outs, nodeMap);
    if (!edge) {
      this.recordDrop(node, '503');
      return;
    }
    this.spawnPacket(edge, color, totalLatencyMs, wasQueued);
  }

  private pickDownstreamEdge(
    node: SimNode,
    outs: SimEdge[],
    nodeMap: Map<string, SimNode>
  ): SimEdge | null {
    if (outs.length === 0) return null;

    // Never route to offline/crashed nodes if any live alternative exists
    const online = outs.filter((e) => {
      const target = nodeMap.get(e.to);
      return target && !target.isDown;
    });

    if (online.length === 0) {
      // For load balancers / multi-node health checks, drop cleanly if all targets offline
      return node.type === 'loadbalancer' ? null : outs[node.rrIndex++ % outs.length];
    }

    const healthyOrDegraded = online.filter((e) => {
      const target = nodeMap.get(e.to);
      return target && target.status !== 'overloaded';
    });

    if (healthyOrDegraded.length === 0) {
      if (node.type === 'loadbalancer') {
        return null;
      }
      return online[node.rrIndex++ % online.length];
    }

    const strategy = node.config.lbStrategy ?? 'least_connections';
    if (node.type === 'loadbalancer' && strategy === 'least_connections') {
      let bestEdge = healthyOrDegraded[0];
      let bestScore = Infinity;
      for (const e of healthyOrDegraded) {
        const target = nodeMap.get(e.to)!;
        const cap =
          target.type === 'database'
            ? target.config.poolSize ?? 16
            : target.config.maxConcurrency ?? 12;
        const score = (target.activeCount + target.queueDepth) / Math.max(1, cap);
        if (score < bestScore) {
          bestScore = score;
          bestEdge = e;
        }
      }
      return bestEdge;
    }

    const chosen = healthyOrDegraded[node.rrIndex % healthyOrDegraded.length];
    node.rrIndex++;
    return chosen;
  }

  private spawnPacket(
    edge: SimEdge,
    color: PacketColor,
    accumulatedLatencyMs: number,
    wasQueued: boolean
  ): void {
    this.edgeWindowCounts.set(edge.id, (this.edgeWindowCounts.get(edge.id) ?? 0) + 1);

    if (this.packets.length > 4000) {
      return;
    }
    const speed = color === 'queued' ? 1.55 : 2.15 + this.nextRandom() * 0.25;
    this.packets.push({
      id: this.nextPacketId++,
      edgeId: edge.id,
      fromNodeId: edge.from,
      toNodeId: edge.to,
      progress: 0,
      speed,
      color,
      accumulatedLatencyMs,
      wasQueued,
    });
  }

  private recordDrop(node: SimNode, code: '429' | '503'): void {
    node.totalDropped++;
    node._pulseDrop = 1;
    this.droppedTotal++;
    this.outcomeWindow.push({ timeSec: this.simTimeSec, status: 'drop' });

    if (this.droppedParticles.length < 140) {
      const cx = node.x + NODE_DIMENSIONS.width * 0.5 + (this.nextRandom() - 0.5) * 40;
      const cy = node.y + NODE_DIMENSIONS.height * 0.85;
      this.droppedParticles.push({
        id: this.nextParticleId++,
        x: cx,
        y: cy,
        vx: (this.nextRandom() - 0.5) * 55,
        vy: 35 + this.nextRandom() * 40,
        alpha: 1,
        code,
      });
    }
  }

  private spawnCacheBurst(node: SimNode): void {
    if (this.cacheHitBursts.length > 60) return;
    this.cacheHitBursts.push({
      id: this.nextParticleId++,
      x: node.x + NODE_DIMENSIONS.width * 0.5,
      y: node.y + NODE_DIMENSIONS.height * 0.5,
      radius: 16,
      alpha: 0.9,
    });
  }

  private recomputeMetrics(): void {
    const cutoff = this.simTimeSec - 2.0;
    this.outcomeWindow = this.outcomeWindow.filter((o) => o.timeSec >= cutoff);
    this.latencyWindow = this.latencyWindow.filter((l) => l.timeSec >= cutoff);

    const windowDuration = Math.min(2.0, Math.max(0.25, this.simTimeSec));
    let okCount = 0;
    let dropCount = 0;
    for (const o of this.outcomeWindow) {
      if (o.status === 'drop') dropCount++;
      else okCount++;
    }

    const totalOutcomes = okCount + dropCount;
    const totalRps = totalOutcomes / windowDuration;
    const droppedRps = dropCount / windowDuration;
    const successRate = totalOutcomes > 0 ? (okCount / totalOutcomes) * 100 : 100;

    let p50 = 0;
    let p95 = 0;
    if (this.latencyWindow.length > 0) {
      const sorted = this.latencyWindow.map((l) => l.ms).sort((a, b) => a - b);
      p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
      p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
    }

    this.cachedMetrics = {
      totalRps,
      effectiveIngressRps: this.effectiveIngressRps,
      successRate,
      droppedRps,
      droppedTotal: this.droppedTotal,
      p50LatencyMs: p50,
      p95LatencyMs: p95,
      activePackets: this.packets.length,
      completedTotal: this.completedTotal,
      cacheHitTotal: this.cacheHitTotal,
      simTimeSec: this.simTimeSec,
    };
  }
}
