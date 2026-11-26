# PacketStorm

Interactive 60fps system architecture and live traffic simulator built with React, TypeScript, Tailwind CSS, and HTML5 Canvas.

## Features
- **7 Simulation Node Types**: Traffic Ingress, Rate Limiter (token bucket `429`), Edge Cache (cyan hit returns), Load Balancer (Round Robin / Least Connections + failover), App Server (bounded concurrency & `503` queue overflow), Message Queue (steady burst drain), and Database (non-linear connection pool contention).
- **Instant-Boot Presets**: *Doomed Monolith*, *Cached & Balanced*, and *Event-Driven Fortress*.
- **Traffic Profiles**: Switch live between `Steady`, `Viral Spike`, and `Bot Flood` with adjustable req/s intensity.
- **Chaos Engineering & Observability**: Crash/recover nodes (`K`), inject synthetic latency faults, inspect per-edge RPS, and monitor a live 30-second throughput & p50/p95 oscilloscope.
- **Persistence & Portability**: Auto-saves topologies to `localStorage` and supports JSON export/import.

## Development

```bash
bun install
bun run dev
```

## Verification & Production Build

```bash
bun run lint
bun run test
bun run build
```

Deploy the generated `dist/` folder to any static host (Vercel, Netlify, Cloudflare Pages, or GitHub Pages).
