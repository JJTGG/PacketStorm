import { NodeType, PresetDefinition, SimNode, SimNodeConfig } from './types';

export const NODE_DIMENSIONS = {
  width: 212,
  height: 106,
  portRadius: 7,
};

export const NODE_META: Record<
  NodeType,
  {
    title: string;
    shortTag: string;
    description: string;
    accent: string;
    hasInput: boolean;
    hasOutput: boolean;
  }
> = {
  ingress: {
    title: 'Traffic Ingress',
    shortTag: 'INGRESS',
    description: 'Generates client HTTP request packets following the selected traffic profile.',
    accent: '#38bdf8',
    hasInput: false,
    hasOutput: true,
  },
  ratelimiter: {
    title: 'Rate Limiter',
    shortTag: '429 GUARD',
    description: 'Token-bucket gatekeeper. Sheds excess burst traffic with 429 Too Many Requests.',
    accent: '#a78bfa',
    hasInput: true,
    hasOutput: true,
  },
  loadbalancer: {
    title: 'Load Balancer',
    shortTag: 'L7 PROXY',
    description: 'Distributes traffic across healthy downstream targets and avoids saturated nodes.',
    accent: '#60a5fa',
    hasInput: true,
    hasOutput: true,
  },
  cache: {
    title: 'Edge Cache',
    shortTag: 'CDN / KV',
    description: 'Resolves cache hits immediately in cyan without hitting origin compute or storage.',
    accent: '#06b6d4',
    hasInput: true,
    hasOutput: true,
  },
  appserver: {
    title: 'App Server',
    shortTag: 'COMPUTE',
    description: 'Bounded concurrency worker pool with overflow request queue and 503 shedding.',
    accent: '#22c55e',
    hasInput: true,
    hasOutput: true,
  },
  queue: {
    title: 'Message Queue',
    shortTag: 'BROKER',
    description: 'Deep shock-absorber buffer that smooths bursty spikes into steady downstream drain.',
    accent: '#f59e0b',
    hasInput: true,
    hasOutput: true,
  },
  database: {
    title: 'Database',
    shortTag: 'STORAGE',
    description: 'Connection-pooled datastore with non-linear latency degradation under contention.',
    accent: '#ec4899',
    hasInput: true,
    hasOutput: false,
  },
};

export function getDefaultConfig(type: NodeType): SimNodeConfig {
  switch (type) {
    case 'ingress':
      return {};
    case 'ratelimiter':
      return {
        rateLimitRps: 180,
        burstCapacity: 60,
      };
    case 'loadbalancer':
      return {
        lbStrategy: 'least_connections',
      };
    case 'cache':
      return {
        cacheHitRate: 60,
      };
    case 'appserver':
      return {
        maxConcurrency: 14,
        processingTimeMs: 90,
        queueCapacity: 30,
      };
    case 'queue':
      return {
        queueCapacity: 400,
        drainRateRps: 120,
      };
    case 'database':
      return {
        poolSize: 16,
        baseLatencyMs: 45,
        queueCapacity: 24,
      };
  }
}

export function createSimNode(
  id: string,
  type: NodeType,
  x: number,
  y: number,
  label?: string,
  configOverride?: SimNodeConfig
): SimNode {
  const defaultCfg = getDefaultConfig(type);
  const config: SimNodeConfig = { ...defaultCfg, ...configOverride };
  return {
    id,
    type,
    label: label ?? NODE_META[type].title,
    x,
    y,
    config,
    isDown: false,
    inFlight: [],
    queue: [],
    tokens: config.burstCapacity ?? 50,
    rrIndex: 0,
    drainAccumulator: 0,
    spawnAccumulator: 0,
    activeCount: 0,
    queueDepth: 0,
    utilization: 0,
    status: 'healthy',
    totalProcessed: 0,
    totalDropped: 0,
    totalCacheHits: 0,
    currentRps: 0,
    lastLatencyMs: 0,
    history: new Array(40).fill(0),
    _windowProcessed: 0,
    _overloadTimer: 0,
    _pulseHit: 0,
    _pulseDrop: 0,
  };
}

export const PRESETS: PresetDefinition[] = [
  {
    id: 'doomed-monolith',
    name: '1. Doomed Monolith',
    subtitle: 'Ingress → Single App Server → Database. Survives Steady; melts under Viral Spike.',
    recommendedIntensity: 55,
    recommendedPattern: 'steady',
    nodes: [
      {
        id: 'ingress-1',
        type: 'ingress',
        label: 'Public Ingress',
        x: 110,
        y: 230,
        config: {},
      },
      {
        id: 'app-1',
        type: 'appserver',
        label: 'Monolith Server',
        x: 450,
        y: 230,
        config: {
          maxConcurrency: 12,
          processingTimeMs: 90,
          queueCapacity: 24,
        },
      },
      {
        id: 'db-1',
        type: 'database',
        label: 'Primary Postgres',
        x: 790,
        y: 230,
        config: {
          poolSize: 12,
          baseLatencyMs: 45,
          queueCapacity: 20,
        },
      },
    ],
    edges: [
      { id: 'e-ing-app', from: 'ingress-1', to: 'app-1' },
      { id: 'e-app-db', from: 'app-1', to: 'db-1' },
    ],
  },
  {
    id: 'cached-balanced',
    name: '2. Cached & Balanced',
    subtitle: 'Rate Limiter + Edge Cache + Load Balancer fanning across 3 App Servers.',
    recommendedIntensity: 150,
    recommendedPattern: 'viral_spike',
    nodes: [
      {
        id: 'ingress-1',
        type: 'ingress',
        label: 'Edge Gateway',
        x: 60,
        y: 240,
        config: {},
      },
      {
        id: 'rl-1',
        type: 'ratelimiter',
        label: 'WAF Rate Limiter',
        x: 320,
        y: 240,
        config: {
          rateLimitRps: 240,
          burstCapacity: 90,
        },
      },
      {
        id: 'cache-1',
        type: 'cache',
        label: 'Redis Edge Cache',
        x: 580,
        y: 240,
        config: {
          cacheHitRate: 62,
        },
      },
      {
        id: 'lb-1',
        type: 'loadbalancer',
        label: 'L7 Load Balancer',
        x: 840,
        y: 240,
        config: {
          lbStrategy: 'least_connections',
        },
      },
      {
        id: 'app-1',
        type: 'appserver',
        label: 'App Pod A',
        x: 1110,
        y: 80,
        config: {
          maxConcurrency: 12,
          processingTimeMs: 95,
          queueCapacity: 25,
        },
      },
      {
        id: 'app-2',
        type: 'appserver',
        label: 'App Pod B',
        x: 1110,
        y: 240,
        config: {
          maxConcurrency: 12,
          processingTimeMs: 95,
          queueCapacity: 25,
        },
      },
      {
        id: 'app-3',
        type: 'appserver',
        label: 'App Pod C',
        x: 1110,
        y: 400,
        config: {
          maxConcurrency: 12,
          processingTimeMs: 95,
          queueCapacity: 25,
        },
      },
      {
        id: 'db-1',
        type: 'database',
        label: 'Cluster Primary DB',
        x: 1400,
        y: 240,
        config: {
          poolSize: 28,
          baseLatencyMs: 40,
          queueCapacity: 40,
        },
      },
    ],
    edges: [
      { id: 'e-1', from: 'ingress-1', to: 'rl-1' },
      { id: 'e-2', from: 'rl-1', to: 'cache-1' },
      { id: 'e-3', from: 'cache-1', to: 'lb-1' },
      { id: 'e-4', from: 'lb-1', to: 'app-1' },
      { id: 'e-5', from: 'lb-1', to: 'app-2' },
      { id: 'e-6', from: 'lb-1', to: 'app-3' },
      { id: 'e-7', from: 'app-1', to: 'db-1' },
      { id: 'e-8', from: 'app-2', to: 'db-1' },
      { id: 'e-9', from: 'app-3', to: 'db-1' },
    ],
  },
  {
    id: 'event-fortress',
    name: '3. Event-Driven Fortress',
    subtitle: 'Full shock-absorbing pipeline with Message Queue surviving Bot Flood.',
    recommendedIntensity: 180,
    recommendedPattern: 'bot_flood',
    nodes: [
      {
        id: 'ingress-1',
        type: 'ingress',
        label: 'Global Ingress',
        x: 50,
        y: 240,
        config: {},
      },
      {
        id: 'rl-1',
        type: 'ratelimiter',
        label: 'DDoS Rate Limiter',
        x: 300,
        y: 240,
        config: {
          rateLimitRps: 360,
          burstCapacity: 150,
        },
      },
      {
        id: 'cache-1',
        type: 'cache',
        label: 'Edge CDN Cache',
        x: 550,
        y: 240,
        config: {
          cacheHitRate: 46,
        },
      },
      {
        id: 'lb-1',
        type: 'loadbalancer',
        label: 'API Gateway LB',
        x: 800,
        y: 240,
        config: {
          lbStrategy: 'least_connections',
        },
      },
      {
        id: 'app-1',
        type: 'appserver',
        label: 'Ingest API 1',
        x: 1050,
        y: 145,
        config: {
          maxConcurrency: 18,
          processingTimeMs: 45,
          queueCapacity: 40,
        },
      },
      {
        id: 'app-2',
        type: 'appserver',
        label: 'Ingest API 2',
        x: 1050,
        y: 335,
        config: {
          maxConcurrency: 18,
          processingTimeMs: 45,
          queueCapacity: 40,
        },
      },
      {
        id: 'mq-1',
        type: 'queue',
        label: 'Kafka Event Buffer',
        x: 1310,
        y: 240,
        config: {
          queueCapacity: 500,
          drainRateRps: 135,
        },
      },
      {
        id: 'worker-1',
        type: 'appserver',
        label: 'Async Worker Pool',
        x: 1570,
        y: 240,
        config: {
          maxConcurrency: 24,
          processingTimeMs: 75,
          queueCapacity: 60,
        },
      },
      {
        id: 'db-1',
        type: 'database',
        label: 'Sharded Ledger DB',
        x: 1830,
        y: 240,
        config: {
          poolSize: 32,
          baseLatencyMs: 32,
          queueCapacity: 50,
        },
      },
    ],
    edges: [
      { id: 'ef-1', from: 'ingress-1', to: 'rl-1' },
      { id: 'ef-2', from: 'rl-1', to: 'cache-1' },
      { id: 'ef-3', from: 'cache-1', to: 'lb-1' },
      { id: 'ef-4', from: 'lb-1', to: 'app-1' },
      { id: 'ef-5', from: 'lb-1', to: 'app-2' },
      { id: 'ef-6', from: 'app-1', to: 'mq-1' },
      { id: 'ef-7', from: 'app-2', to: 'mq-1' },
      { id: 'ef-8', from: 'mq-1', to: 'worker-1' },
      { id: 'ef-9', from: 'worker-1', to: 'db-1' },
    ],
  },
];
