import assert from 'node:assert/strict';
import { SimulationEngine } from './engine';
import { PRESETS } from './presets';
import { decodeTopologyFromToken, encodeTopologyToToken } from './share';
import { SerializedTopology } from './types';

function stepSeconds(engine: SimulationEngine, seconds: number, dt = 0.02): void {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    engine.step(dt);
  }
}

// 1. Doomed Monolith: healthy on steady, melts on overload
{
  const engine = new SimulationEngine();
  assert.equal(engine.activePresetId, 'doomed-monolith');
  stepSeconds(engine, 4);
  const steadyMetrics = engine.getMetrics();
  assert.ok(steadyMetrics.successRate > 95, `Expected healthy steady successRate, got ${steadyMetrics.successRate}`);

  engine.setTrafficPattern('viral_spike');
  stepSeconds(engine, 4);
  const spikeMetrics = engine.getMetrics();
  assert.ok(spikeMetrics.droppedTotal > 0, 'Expected Doomed Monolith to drop requests during Viral Spike');
}

// 2. Rate Limiter: token bucket enforces cap
{
  const engine = new SimulationEngine();
  const ing = engine.addNode('ingress', 0, 0);
  const rl = engine.addNode('ratelimiter', 250, 0);
  const db = engine.addNode('database', 500, 0);
  engine.nodes = [ing, rl, db];
  engine.edges = [];
  engine.addEdge(ing.id, rl.id);
  engine.addEdge(rl.id, db.id);
  engine.updateNodeConfig(rl.id, { rateLimitRps: 50, burstCapacity: 10 });
  engine.updateNodeConfig(db.id, { poolSize: 64, baseLatencyMs: 15, queueCapacity: 100 });
  engine.setTrafficPattern('steady');
  engine.setTrafficIntensity(200);
  engine.resetSimulationState();

  stepSeconds(engine, 3);
  assert.ok(rl.totalDropped > 50, `Expected rate limiter to shed excess traffic, got ${rl.totalDropped}`);
  assert.ok(rl.totalProcessed < 220, `Expected rate limiter throughput bounded, got ${rl.totalProcessed}`);
}

// 3. Edge Cache: absorbs hits without forwarding downstream
{
  const engine = new SimulationEngine();
  engine.loadPreset(PRESETS[1]); // Cached & Balanced
  engine.setTrafficPattern('steady');
  engine.setTrafficIntensity(120);
  stepSeconds(engine, 4);

  const cacheNode = engine.nodes.find((n) => n.type === 'cache')!;
  const lbNode = engine.nodes.find((n) => n.type === 'loadbalancer')!;
  assert.ok(cacheNode.totalCacheHits > 40, `Expected cache hits > 40, got ${cacheNode.totalCacheHits}`);
  assert.ok(lbNode.totalProcessed < cacheNode.totalProcessed, 'Cache should shield downstream LB');
}

// 4. Load Balancer failover when target node is killed (isDown)
{
  const engine = new SimulationEngine();
  engine.loadPreset(PRESETS[1]); // 3 app servers behind LB
  engine.setTrafficPattern('steady');
  engine.setTrafficIntensity(100);
  stepSeconds(engine, 2);

  const app2 = engine.nodes.find((n) => n.id === 'app-2')!;
  const app1 = engine.nodes.find((n) => n.id === 'app-1')!;
  const app2ProcessedBefore = app2.totalProcessed;
  const app1ProcessedBefore = app1.totalProcessed;

  engine.toggleNodeDown(app2.id);
  assert.equal(app2.isDown, true);
  stepSeconds(engine, 2.5);

  assert.equal(app2.totalProcessed, app2ProcessedBefore, 'Offline node must not process new requests');
  assert.ok(app1.totalProcessed > app1ProcessedBefore, 'Healthy sibling node should continue processing');
}

// 5. Message Queue shock absorption during spike
{
  const engine = new SimulationEngine();
  engine.loadPreset(PRESETS[2]); // Event-Driven Fortress
  engine.setTrafficPattern('bot_flood');
  engine.setTrafficIntensity(160);
  stepSeconds(engine, 5);

  const mq = engine.nodes.find((n) => n.type === 'queue')!;
  assert.ok(mq.totalProcessed > 100, 'Message Queue should drain requests steadily');
  assert.equal(mq.totalDropped, 0, 'Message Queue deep buffer should absorb Bot Flood without dropping');
}

// 6. Export / Import topology round-trip & malformed rejection
{
  const engine = new SimulationEngine();
  const exported = engine.exportTopology('Test Export');
  const importedOk = engine.importTopology(exported);
  assert.equal(importedOk, true, 'Valid exported topology should import cleanly');
  assert.equal(engine.nodes.length, exported.nodes.length);

  const malformed = { version: 1, nodes: [{ id: 'x', type: 'unknown', label: 'bad', x: 0, y: 0 }], edges: [] } as unknown as SerializedTopology;
  assert.equal(engine.importTopology(malformed), false, 'Malformed node type must be rejected');
}

// 7. Compressed Share Topology URL round-trip
async function runShareTests(): Promise<void> {
  const engine = new SimulationEngine();
  engine.loadPreset(PRESETS[2]);
  const exported = engine.exportTopology('Fortress Share');
  const token = await encodeTopologyToToken(exported);

  assert.ok(token.startsWith('z.') || token.startsWith('u.'), 'Token should include compression prefix');
  assert.ok(token.length < JSON.stringify(exported).length, 'Compressed token should be shorter than raw JSON');

  const decoded = await decodeTopologyFromToken(token);
  assert.ok(decoded !== null, 'Compressed token should decode cleanly');
  assert.equal(decoded!.nodes.length, exported.nodes.length);
  assert.equal(decoded!.edges.length, exported.edges.length);
  assert.equal(decoded!.trafficPattern, exported.trafficPattern);

  const badDecoded = await decodeTopologyFromToken('z.not-valid-compressed-data');
  assert.equal(badDecoded, null, 'Corrupted share token must return null');

  console.log('All PacketStorm simulation engine and share URL assertions passed.');
}

void runShareTests();
