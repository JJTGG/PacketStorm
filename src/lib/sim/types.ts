export type NodeType =
  | 'ingress'
  | 'ratelimiter'
  | 'loadbalancer'
  | 'cache'
  | 'appserver'
  | 'queue'
  | 'database';

export type TrafficPattern = 'steady' | 'viral_spike' | 'bot_flood';

export type LoadBalancerStrategy = 'round_robin' | 'least_connections';

export type NodeHealthStatus = 'healthy' | 'degraded' | 'overloaded' | 'offline';

export type PacketColor = 'ok' | 'hit' | 'queued' | 'dropped';

export interface SimNodeConfig {
  // Fault injection
  injectedLatencyMs?: number;
  // Rate Limiter
  rateLimitRps?: number;
  burstCapacity?: number;
  // Load Balancer
  lbStrategy?: LoadBalancerStrategy;
  // Edge Cache
  cacheHitRate?: number; // 0 - 100 %
  // App Server & Database
  maxConcurrency?: number;
  processingTimeMs?: number;
  queueCapacity?: number;
  // Message Queue
  drainRateRps?: number;
  // Database specific
  poolSize?: number;
  baseLatencyMs?: number;
}

export interface InFlightRequest {
  id: number;
  remainingSec: number;
  totalDurationSec: number;
  accumulatedLatencyMs: number;
  wasQueued: boolean;
}

export interface QueuedRequest {
  id: number;
  enqueuedAtSec: number;
  accumulatedLatencyMs: number;
}

export interface SimNode {
  id: string;
  type: NodeType;
  label: string;
  x: number;
  y: number;
  config: SimNodeConfig;
  isDown: boolean;

  // Live simulation runtime state
  inFlight: InFlightRequest[];
  queue: QueuedRequest[];
  tokens: number;
  rrIndex: number;
  drainAccumulator: number;
  spawnAccumulator: number;

  // Live telemetry
  activeCount: number;
  queueDepth: number;
  utilization: number; // 0..1+
  status: NodeHealthStatus;
  totalProcessed: number;
  totalDropped: number;
  totalCacheHits: number;
  currentRps: number;
  lastLatencyMs: number;
  history: number[]; // 0..1 utilization sparkline history (up to 40 pts)

  // Internal rate tracking for current window
  _windowProcessed: number;
  _overloadTimer: number;
  _pulseHit: number; // 0..1 visual flash when cache hits
  _pulseDrop: number; // 0..1 visual flash when packet dropped
}

export interface SimEdge {
  id: string;
  from: string;
  to: string;
}

export interface Packet {
  id: number;
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  progress: number; // 0..1
  speed: number; // progress units per second
  color: PacketColor;
  accumulatedLatencyMs: number;
  wasQueued: boolean;
  isReturn?: boolean;
}

export interface DroppedParticle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  alpha: number;
  code: '429' | '503';
}

export interface CacheHitBurst {
  id: number;
  x: number;
  y: number;
  radius: number;
  alpha: number;
}

export interface TimeSeriesPoint {
  timeSec: number;
  ingressRps: number;
  successRps: number;
  droppedRps: number;
  p50Ms: number;
  p95Ms: number;
}

export interface SimMetrics {
  totalRps: number;
  effectiveIngressRps: number;
  successRate: number; // 0..100
  droppedRps: number;
  droppedTotal: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  activePackets: number;
  completedTotal: number;
  cacheHitTotal: number;
  simTimeSec: number;
}

export interface NodeUiSnapshot {
  id: string;
  type: NodeType;
  label: string;
  isDown: boolean;
  config: SimNodeConfig;
  activeCount: number;
  queueDepth: number;
  utilization: number;
  status: NodeHealthStatus;
  totalProcessed: number;
  totalDropped: number;
  totalCacheHits: number;
  currentRps: number;
  lastLatencyMs: number;
  tokens: number;
  history: number[];
}

export interface PresetDefinition {
  id: string;
  name: string;
  subtitle: string;
  recommendedIntensity: number;
  recommendedPattern: TrafficPattern;
  nodes: Array<{
    id: string;
    type: NodeType;
    label: string;
    x: number;
    y: number;
    config: SimNodeConfig;
  }>;
  edges: Array<{
    id: string;
    from: string;
    to: string;
  }>;
}

export interface TopologyDiagnostic {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  nodeId?: string;
  title: string;
  detail: string;
}

export interface SerializedTopology {
  version: 1;
  name: string;
  trafficPattern: TrafficPattern;
  trafficIntensityRps: number;
  nodes: Array<{
    id: string;
    type: NodeType;
    label: string;
    x: number;
    y: number;
    config: SimNodeConfig;
  }>;
  edges: SimEdge[];
}
