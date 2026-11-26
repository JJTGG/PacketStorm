import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Cpu,
  Database,
  Filter,
  GitFork,
  Globe,
  Layers,
  Maximize2,
  Minus,
  Plus,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { SimulationEngine } from '../lib/sim/engine';
import { NODE_DIMENSIONS, NODE_META } from '../lib/sim/presets';
import { NodeType, PacketColor, SimEdge, SimNode } from '../lib/sim/types';

interface SimulatorCanvasProps {
  engine: SimulationEngine;
  selectedNodeId: string | null;
  presetChangeTrigger: number;
  onSelectNode: (nodeId: string | null) => void;
  onTopologyChanged: () => void;
}

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

interface WiringState {
  fromNodeId: string;
  cursorWorldX: number;
  cursorWorldY: number;
}

const NODE_PALETTE: Array<{ type: NodeType; label: string; icon: React.ReactNode }> = [
  { type: 'ingress', label: 'Ingress', icon: <Globe className="w-3.5 h-3.5 text-sky-400" /> },
  { type: 'ratelimiter', label: 'Rate Limiter', icon: <Filter className="w-3.5 h-3.5 text-violet-400" /> },
  { type: 'cache', label: 'Edge Cache', icon: <Zap className="w-3.5 h-3.5 text-cyan-400" /> },
  { type: 'loadbalancer', label: 'Load Balancer', icon: <GitFork className="w-3.5 h-3.5 text-blue-400" /> },
  { type: 'appserver', label: 'App Server', icon: <Cpu className="w-3.5 h-3.5 text-emerald-400" /> },
  { type: 'queue', label: 'Message Queue', icon: <Layers className="w-3.5 h-3.5 text-amber-400" /> },
  { type: 'database', label: 'Database', icon: <Database className="w-3.5 h-3.5 text-pink-400" /> },
];

function getPacketHex(color: PacketColor): { core: string; halo: string } {
  switch (color) {
    case 'hit':
      return { core: '#22d3ee', halo: 'rgba(6, 182, 212, 0.34)' };
    case 'queued':
      return { core: '#fbbf24', halo: 'rgba(245, 158, 11, 0.34)' };
    case 'dropped':
      return { core: '#f87171', halo: 'rgba(239, 68, 68, 0.35)' };
    case 'ok':
    default:
      return { core: '#4ade80', halo: 'rgba(34, 197, 94, 0.32)' };
  }
}

function evalCubicBezier(
  t: number,
  p0x: number,
  p0y: number,
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  p1x: number,
  p1y: number
): { x: number; y: number; dx: number; dy: number } {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  const x = mt2 * mt * p0x + 3 * mt2 * t * c1x + 3 * mt * t2 * c2x + t2 * t * p1x;
  const y = mt2 * mt * p0y + 3 * mt2 * t * c1y + 3 * mt * t2 * c2y + t2 * t * p1y;

  const dx = 3 * mt2 * (c1x - p0x) + 6 * mt * t * (c2x - c1x) + 3 * t2 * (p1x - c2x);
  const dy = 3 * mt2 * (c1y - p0y) + 6 * mt * t * (c2y - c1y) + 3 * t2 * (p1y - c2y);
  return { x, y, dx, dy };
}

function getEdgeControlPoints(from: SimNode, to: SimNode) {
  const p0x = from.x + NODE_DIMENSIONS.width;
  const p0y = from.y + NODE_DIMENSIONS.height * 0.5;
  const p1x = to.x;
  const p1y = to.y + NODE_DIMENSIONS.height * 0.5;
  const dx = Math.abs(p1x - p0x);
  const offset = Math.max(55, Math.min(180, dx * 0.45));
  return {
    p0x,
    p0y,
    c1x: p0x + offset,
    c1y: p0y,
    c2x: p1x - offset,
    c2y: p1y,
    p1x,
    p1y,
  };
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export const SimulatorCanvas: React.FC<SimulatorCanvasProps> = ({
  engine,
  selectedNodeId,
  presetChangeTrigger,
  onSelectNode,
  onTopologyChanged,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const cameraRef = useRef<Camera>({ x: 40, y: 60, zoom: 1 });
  const [zoomPct, setZoomPct] = useState(100);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [edgePopupPos, setEdgePopupPos] = useState<{ x: number; y: number } | null>(null);
  const [showHint, setShowHint] = useState(true);

  const selectedNodeIdRef = useRef<string | null>(selectedNodeId);
  selectedNodeIdRef.current = selectedNodeId;
  const selectedEdgeIdRef = useRef<string | null>(selectedEdgeId);
  selectedEdgeIdRef.current = selectedEdgeId;

  const dragNodeRef = useRef<{
    nodeId: string;
    startWorldX: number;
    startWorldY: number;
    origNodeX: number;
    origNodeY: number;
    moved: boolean;
  } | null>(null);

  const panRef = useRef<{
    startClientX: number;
    startClientY: number;
    origCamX: number;
    origCamY: number;
  } | null>(null);

  const wiringRef = useRef<WiringState | null>(null);
  const hoverPortRef = useRef<{ nodeId: string; kind: 'in' | 'out' } | null>(null);
  const hoverNodeIdRef = useRef<string | null>(null);

  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const cam = cameraRef.current;
    return {
      x: (sx - cam.x) / cam.zoom,
      y: (sy - cam.y) / cam.zoom,
    };
  }, []);

  const worldToScreen = useCallback((wx: number, wy: number) => {
    const cam = cameraRef.current;
    return {
      x: wx * cam.zoom + cam.x,
      y: wy * cam.zoom + cam.y,
    };
  }, []);

  const fitToView = useCallback(() => {
    const container = containerRef.current;
    if (!container || engine.nodes.length === 0) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (cw <= 0 || ch <= 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of engine.nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NODE_DIMENSIONS.width);
      maxY = Math.max(maxY, n.y + NODE_DIMENSIONS.height);
    }

    const padLeft = 170;
    const padRight = 60;
    const padY = 70;
    const availW = Math.max(200, cw - padLeft - padRight);
    const availH = Math.max(200, ch - padY * 2);

    const contentW = Math.max(100, maxX - minX);
    const contentH = Math.max(100, maxY - minY);
    const zoom = Math.max(0.45, Math.min(1.15, Math.min(availW / contentW, availH / contentH)));

    const centerX = (minX + maxX) * 0.5;
    const centerY = (minY + maxY) * 0.5;
    const targetScreenCenterX = padLeft + availW * 0.5;
    const targetScreenCenterY = ch * 0.5;

    cameraRef.current = {
      zoom,
      x: targetScreenCenterX - centerX * zoom,
      y: targetScreenCenterY - centerY * zoom,
    };
    setZoomPct(Math.round(zoom * 100));
  }, [engine]);

  // Fit topology cleanly on initial boot and whenever preset changes
  useEffect(() => {
    setSelectedEdgeId(null);
    setEdgePopupPos(null);
    const id = requestAnimationFrame(() => fitToView());
    return () => cancelAnimationFrame(id);
  }, [presetChangeTrigger, fitToView]);

  // Update floating edge popup coordinates if an edge is selected
  const refreshEdgePopup = useCallback(
    (edgeId: string | null) => {
      if (!edgeId) {
        setEdgePopupPos(null);
        return;
      }
      const edge = engine.edges.find((e) => e.id === edgeId);
      if (!edge) {
        setSelectedEdgeId(null);
        setEdgePopupPos(null);
        return;
      }
      const from = engine.nodes.find((n) => n.id === edge.from);
      const to = engine.nodes.find((n) => n.id === edge.to);
      if (!from || !to) {
        setEdgePopupPos(null);
        return;
      }
      const cp = getEdgeControlPoints(from, to);
      const mid = evalCubicBezier(0.5, cp.p0x, cp.p0y, cp.c1x, cp.c1y, cp.c2x, cp.c2y, cp.p1x, cp.p1y);
      const screen = worldToScreen(mid.x, mid.y);
      setEdgePopupPos(screen);
    },
    [engine, worldToScreen]
  );

  // Keyboard delete shortcut for selected edge or node
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        wiringRef.current = null;
        setSelectedEdgeId(null);
        setEdgePopupPos(null);
      } else if (e.key === 'k' || e.key === 'K') {
        if (selectedNodeIdRef.current) {
          engine.toggleNodeDown(selectedNodeIdRef.current);
          onTopologyChanged();
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedEdgeIdRef.current) {
          engine.removeEdge(selectedEdgeIdRef.current);
          setSelectedEdgeId(null);
          setEdgePopupPos(null);
          onTopologyChanged();
        } else if (selectedNodeIdRef.current) {
          engine.removeNode(selectedNodeIdRef.current);
          onSelectNode(null);
          onTopologyChanged();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [engine, onSelectNode, onTopologyChanged]);

  // Hit testing helpers
  const findPortAt = useCallback(
    (wx: number, wy: number): { nodeId: string; kind: 'in' | 'out' } | null => {
      const hitR = 15 / cameraRef.current.zoom;
      const r2 = hitR * hitR;
      for (let i = engine.nodes.length - 1; i >= 0; i--) {
        const n = engine.nodes[i];
        const meta = NODE_META[n.type];
        if (meta.hasOutput) {
          const ox = n.x + NODE_DIMENSIONS.width;
          const oy = n.y + NODE_DIMENSIONS.height * 0.5;
          if ((wx - ox) ** 2 + (wy - oy) ** 2 <= r2) {
            return { nodeId: n.id, kind: 'out' };
          }
        }
        if (meta.hasInput) {
          const ix = n.x;
          const iy = n.y + NODE_DIMENSIONS.height * 0.5;
          if ((wx - ix) ** 2 + (wy - iy) ** 2 <= r2) {
            return { nodeId: n.id, kind: 'in' };
          }
        }
      }
      return null;
    },
    [engine]
  );

  const findNodeAt = useCallback(
    (wx: number, wy: number): SimNode | null => {
      for (let i = engine.nodes.length - 1; i >= 0; i--) {
        const n = engine.nodes[i];
        if (
          wx >= n.x &&
          wx <= n.x + NODE_DIMENSIONS.width &&
          wy >= n.y &&
          wy <= n.y + NODE_DIMENSIONS.height
        ) {
          return n;
        }
      }
      return null;
    },
    [engine]
  );

  const findEdgeAt = useCallback(
    (wx: number, wy: number): SimEdge | null => {
      const thresholdSq = (10 / cameraRef.current.zoom) ** 2;
      const nodeMap = new Map(engine.nodes.map((n) => [n.id, n]));
      for (const edge of engine.edges) {
        const from = nodeMap.get(edge.from);
        const to = nodeMap.get(edge.to);
        if (!from || !to) continue;
        const cp = getEdgeControlPoints(from, to);
        for (let s = 0; s <= 20; s++) {
          const t = s / 20;
          const pt = evalCubicBezier(t, cp.p0x, cp.p0y, cp.c1x, cp.c1y, cp.c2x, cp.c2y, cp.p1x, cp.p1y);
          const d2 = (wx - pt.x) ** 2 + (wy - pt.y) ** 2;
          if (d2 <= thresholdSq) {
            return edge;
          }
        }
      }
      return null;
    },
    [engine]
  );

  // Main 60fps requestAnimationFrame loop (simulation tick + canvas draw)
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let dpr = window.devicePixelRatio || 1;
    let width = container.clientWidth;
    let height = container.clientHeight;

    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      width = container.clientWidth;
      height = container.clientHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(container);

    let lastFrameMs = performance.now();
    let rafId = 0;

    const renderFrame = (nowMs: number) => {
      const dtSec = Math.min(0.05, (nowMs - lastFrameMs) / 1000);
      lastFrameMs = nowMs;

      engine.step(dtSec);

      ctx.save();
      ctx.scale(dpr, dpr);

      // 1. Background fill
      ctx.fillStyle = '#090d16';
      ctx.fillRect(0, 0, width, height);

      const cam = cameraRef.current;

      // 2. Crisp Dot Grid in screen space aligned to world coordinates
      const spacing = 28 * cam.zoom;
      if (spacing >= 10) {
        const offsetX = ((cam.x % spacing) + spacing) % spacing;
        const offsetY = ((cam.y % spacing) + spacing) % spacing;
        ctx.fillStyle = 'rgba(148, 163, 184, 0.14)';
        for (let gx = offsetX; gx < width; gx += spacing) {
          for (let gy = offsetY; gy < height; gy += spacing) {
            ctx.fillRect(gx - 0.75, gy - 0.75, 1.5, 1.5);
          }
        }
      }

      // World transform
      ctx.translate(cam.x, cam.y);
      ctx.scale(cam.zoom, cam.zoom);

      const nodeMap = new Map<string, SimNode>();
      for (const n of engine.nodes) nodeMap.set(n.id, n);

      // 3. Draw Edges
      const dashOffset = -(engine.simTimeSec * 36) % 24;
      for (const edge of engine.edges) {
        const from = nodeMap.get(edge.from);
        const to = nodeMap.get(edge.to);
        if (!from || !to) continue;

        const cp = getEdgeControlPoints(from, to);
        const isEdgeSelected = edge.id === selectedEdgeIdRef.current;

        // Base wire
        ctx.beginPath();
        ctx.moveTo(cp.p0x, cp.p0y);
        ctx.bezierCurveTo(cp.c1x, cp.c1y, cp.c2x, cp.c2y, cp.p1x, cp.p1y);
        ctx.lineWidth = isEdgeSelected ? 3.5 : 2;
        ctx.strokeStyle = isEdgeSelected ? '#38bdf8' : 'rgba(51, 65, 85, 0.85)';
        ctx.stroke();

        // Subtle animated flow dash when running
        if (engine.isRunning && !from.isDown && !to.isDown) {
          ctx.save();
          ctx.setLineDash([5, 11]);
          ctx.lineDashOffset = dashOffset;
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = isEdgeSelected
            ? 'rgba(125, 211, 252, 0.75)'
            : 'rgba(100, 116, 139, 0.38)';
          ctx.stroke();
          ctx.restore();
        }

        // Live per-edge RPS pill-free compact telemetry badge
        const edgeRps = engine.edgeRpsMap.get(edge.id) ?? 0;
        if (edgeRps >= 1 && !isEdgeSelected && cam.zoom >= 0.55) {
          const mid = evalCubicBezier(
            0.5,
            cp.p0x,
            cp.p0y,
            cp.c1x,
            cp.c1y,
            cp.c2x,
            cp.c2y,
            cp.p1x,
            cp.p1y
          );
          const label = `${Math.round(edgeRps)}/s`;
          ctx.font = '500 10px "IBM Plex Mono", monospace';
          const tw = ctx.measureText(label).width + 10;
          drawRoundedRect(ctx, mid.x - tw * 0.5, mid.y - 9, tw, 18, 4);
          ctx.fillStyle = 'rgba(9, 13, 22, 0.88)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(51, 65, 85, 0.65)';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = '#cbd5e1';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, mid.x, mid.y + 0.5);
        }
      }

      // 4. Draw Active Wiring Preview Line
      if (wiringRef.current) {
        const from = nodeMap.get(wiringRef.current.fromNodeId);
        if (from) {
          const p0x = from.x + NODE_DIMENSIONS.width;
          const p0y = from.y + NODE_DIMENSIONS.height * 0.5;
          const p1x = wiringRef.current.cursorWorldX;
          const p1y = wiringRef.current.cursorWorldY;
          const offset = Math.max(45, Math.abs(p1x - p0x) * 0.45);
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(p0x, p0y);
          ctx.bezierCurveTo(p0x + offset, p0y, p1x - offset, p1y, p1x, p1y);
          ctx.setLineDash([6, 6]);
          ctx.lineWidth = 2.2;
          ctx.strokeStyle = '#38bdf8';
          ctx.stroke();
          ctx.restore();
        }
      }

      // 5. Draw Cache Hit Bursts
      for (const burst of engine.cacheHitBursts) {
        ctx.beginPath();
        ctx.arc(burst.x, burst.y, burst.radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(6, 182, 212, ${burst.alpha * 0.65})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // 6. Draw Packets along Edges (60fps layered glow + directional tail, stride-sampled above 450)
      const pktLen = engine.packets.length;
      const pktStride = pktLen > 450 ? Math.ceil(pktLen / 450) : 1;

      for (let pi = 0; pi < pktLen; pi += pktStride) {
        const pkt = engine.packets[pi];
        const from = nodeMap.get(pkt.fromNodeId);
        const to = nodeMap.get(pkt.toNodeId);
        if (!from || !to) continue;
        const cp = getEdgeControlPoints(from, to);
        const pos = evalCubicBezier(
          pkt.progress,
          cp.p0x,
          cp.p0y,
          cp.c1x,
          cp.c1y,
          cp.c2x,
          cp.c2y,
          cp.p1x,
          cp.p1y
        );

        const { core, halo } = getPacketHex(pkt.color);
        const len = Math.hypot(pos.dx, pos.dy) || 1;
        const dirSign = pkt.isReturn ? -1 : 1;
        const ux = (pos.dx / len) * dirSign;
        const uy = (pos.dy / len) * dirSign;

        // Motion trail
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.lineTo(pos.x - ux * 13, pos.y - uy * 13);
        ctx.strokeStyle = halo;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Outer halo
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 6.2, 0, Math.PI * 2);
        ctx.fillStyle = halo;
        ctx.fill();

        // Core dot
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 3.1, 0, Math.PI * 2);
        ctx.fillStyle = core;
        ctx.fill();
      }

      // 7. Draw Dropped Particles (429 / 503 peeling off)
      ctx.font = '600 10px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const d of engine.droppedParticles) {
        ctx.fillStyle = `rgba(239, 68, 68, ${d.alpha * 0.28})`;
        ctx.beginPath();
        ctx.arc(d.x, d.y, 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(248, 113, 113, ${d.alpha})`;
        ctx.beginPath();
        ctx.arc(d.x, d.y, 3.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(252, 165, 165, ${d.alpha})`;
        ctx.fillText(d.code, d.x, d.y - 11);
      }

      // 8. Draw Nodes
      const W = NODE_DIMENSIONS.width;
      const H = NODE_DIMENSIONS.height;

      for (const node of engine.nodes) {
        const meta = NODE_META[node.type];
        const isSelected = node.id === selectedNodeIdRef.current;
        const isHovered = node.id === hoverNodeIdRef.current;

        // Ambient warning / critical aura
        if (node.status === 'overloaded') {
          drawRoundedRect(ctx, node.x - 4, node.y - 4, W + 8, H + 8, 13);
          ctx.fillStyle = 'rgba(239, 68, 68, 0.14)';
          ctx.fill();
        } else if (node.status === 'degraded') {
          drawRoundedRect(ctx, node.x - 3, node.y - 3, W + 6, H + 6, 12);
          ctx.fillStyle = 'rgba(245, 158, 11, 0.10)';
          ctx.fill();
        }

        // Cache hit or drop flash
        if (node._pulseHit > 0.05) {
          drawRoundedRect(ctx, node.x - 3, node.y - 3, W + 6, H + 6, 12);
          ctx.strokeStyle = `rgba(6, 182, 212, ${node._pulseHit * 0.7})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        if (node._pulseDrop > 0.05) {
          drawRoundedRect(ctx, node.x - 3, node.y - 3, W + 6, H + 6, 12);
          ctx.strokeStyle = `rgba(239, 68, 68, ${node._pulseDrop * 0.85})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Card Body
        drawRoundedRect(ctx, node.x, node.y, W, H, 10);
        ctx.fillStyle = node.isDown
          ? '#0b0f19'
          : isSelected
            ? '#131d31'
            : '#0f1623';
        ctx.fill();

        // Card Hairline Border (all-around, clean single elevation)
        ctx.save();
        if (node.isDown) {
          ctx.setLineDash([5, 4]);
        }
        ctx.lineWidth = isSelected ? 1.75 : 1;
        if (isSelected) {
          ctx.strokeStyle = node.isDown ? '#f87171' : '#38bdf8';
        } else if (node.isDown || node.status === 'overloaded') {
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.75)';
        } else if (node.status === 'degraded') {
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.65)';
        } else if (isHovered) {
          ctx.strokeStyle = '#475569';
        } else {
          ctx.strokeStyle = '#1e293b';
        }
        ctx.stroke();
        ctx.restore();

        // Subtle Top Color Indicator Line (clipped inside card top)
        ctx.save();
        drawRoundedRect(ctx, node.x, node.y, W, H, 10);
        ctx.clip();
        ctx.fillStyle = node.isDown ? '#ef4444' : meta.accent;
        ctx.fillRect(node.x, node.y, W, 2.5);
        ctx.restore();

        // Top Row: Type Tag (left) + Explicit Status Label (right)
        ctx.font = '600 10px "IBM Plex Mono", monospace';
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        ctx.fillStyle = node.isDown ? '#64748b' : meta.accent;
        ctx.fillText(meta.shortTag, node.x + 12, node.y + 12);

        ctx.textAlign = 'right';
        const statusText = node.isDown
          ? 'OFFLINE'
          : node.status === 'overloaded'
            ? 'CRITICAL'
            : node.status === 'degraded'
              ? 'ELEVATED'
              : 'NOMINAL';
        ctx.fillStyle = node.isDown
          ? '#f87171'
          : node.status === 'overloaded'
            ? '#f87171'
            : node.status === 'degraded'
              ? '#fbbf24'
              : '#4ade80';
        ctx.fillText(statusText, node.x + W - 12, node.y + 12);

        // Node Title
        ctx.font = '600 13.5px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = node.isDown ? '#64748b' : '#f1f5f9';
        let title = node.label;
        if (ctx.measureText(title).width > W - 24) {
          while (title.length > 3 && ctx.measureText(title + '…').width > W - 24) {
            title = title.slice(0, -1);
          }
          title += '…';
        }
        ctx.fillText(title, node.x + 12, node.y + 31);

        // Live Telemetry Detail Line
        ctx.font = '500 11px "IBM Plex Mono", monospace';
        ctx.fillStyle = node.isDown ? '#f87171' : '#94a3b8';
        let detail = '';
        if (node.isDown) {
          detail = `CRASHED · ${node.totalDropped} err`;
        } else if (node.type === 'ingress') {
          detail = `${node.currentRps.toFixed(0)} req/s out`;
        } else if (node.type === 'ratelimiter') {
          detail = `Tok ${Math.floor(node.tokens)}/${node.config.burstCapacity ?? 60} · ${node.totalDropped} err`;
        } else if (node.type === 'cache') {
          detail = `${node.config.cacheHitRate ?? 60}% hit · ${node.totalCacheHits} hits`;
        } else if (node.type === 'loadbalancer') {
          const mode = node.config.lbStrategy === 'round_robin' ? 'RR' : 'LeastConn';
          detail = `${mode} · ${node.currentRps.toFixed(0)} req/s`;
        } else if (node.type === 'appserver') {
          detail = `Act ${node.activeCount}/${node.config.maxConcurrency ?? 12} · Q ${node.queueDepth}/${node.config.queueCapacity ?? 24}`;
        } else if (node.type === 'queue') {
          detail = `Buf ${node.queueDepth}/${node.config.queueCapacity ?? 400} · ${node.config.drainRateRps ?? 120}/s`;
        } else if (node.type === 'database') {
          detail = `Pool ${node.activeCount}/${node.config.poolSize ?? 16} · ${Math.round(node.lastLatencyMs || node.config.baseLatencyMs || 45)}ms`;
        }
        ctx.fillText(detail, node.x + 12, node.y + 56);

        // Utilization Progress Bar
        const barX = node.x + 12;
        const barY = node.y + H - 18;
        const barW = W - 24;
        const barH = 5;
        const util = Math.max(0, Math.min(1, node.utilization));

        drawRoundedRect(ctx, barX, barY, barW, barH, 2.5);
        ctx.fillStyle = '#1e293b';
        ctx.fill();

        if (util > 0.01) {
          drawRoundedRect(ctx, barX, barY, Math.max(5, barW * util), barH, 2.5);
          ctx.fillStyle =
            node.status === 'overloaded'
              ? '#ef4444'
              : node.status === 'degraded'
                ? '#f59e0b'
                : meta.accent;
          ctx.fill();
        }

        // Ports (Input on Left, Output on Right)
        const portR = NODE_DIMENSIONS.portRadius;
        if (meta.hasInput) {
          const isPortHovered =
            hoverPortRef.current?.nodeId === node.id && hoverPortRef.current?.kind === 'in';
          const isValidTarget =
            wiringRef.current !== null && wiringRef.current.fromNodeId !== node.id;
          ctx.beginPath();
          ctx.arc(node.x, node.y + H * 0.5, isPortHovered || isValidTarget ? portR + 1.5 : portR, 0, Math.PI * 2);
          ctx.fillStyle = isPortHovered || isValidTarget ? '#38bdf8' : '#0f1623';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = isPortHovered || isValidTarget ? '#e0f2fe' : '#475569';
          ctx.stroke();
        }
        if (meta.hasOutput) {
          const isPortHovered =
            hoverPortRef.current?.nodeId === node.id && hoverPortRef.current?.kind === 'out';
          const isSource = wiringRef.current?.fromNodeId === node.id;
          ctx.beginPath();
          ctx.arc(
            node.x + W,
            node.y + H * 0.5,
            isPortHovered || isSource ? portR + 1.5 : portR,
            0,
            Math.PI * 2
          );
          ctx.fillStyle = isPortHovered || isSource ? '#38bdf8' : '#0f1623';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = isPortHovered || isSource ? '#e0f2fe' : '#64748b';
          ctx.stroke();
        }
      }

      ctx.restore();
      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [engine]);

  // Pointer Events
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);

    const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);

    // 1. If already wiring via click-port mode, complete or cancel
    if (wiringRef.current) {
      const targetPort = findPortAt(wx, wy);
      const targetNode = findNodeAt(wx, wy);
      const targetId =
        targetPort?.kind === 'in'
          ? targetPort.nodeId
          : targetNode && NODE_META[targetNode.type].hasInput
            ? targetNode.id
            : null;
      if (targetId && targetId !== wiringRef.current.fromNodeId) {
        engine.addEdge(wiringRef.current.fromNodeId, targetId);
        onTopologyChanged();
      }
      wiringRef.current = null;
      return;
    }

    // 2. Check ports first (output port starts wiring)
    const port = findPortAt(wx, wy);
    if (port && port.kind === 'out') {
      wiringRef.current = {
        fromNodeId: port.nodeId,
        cursorWorldX: wx,
        cursorWorldY: wy,
      };
      setSelectedEdgeId(null);
      setEdgePopupPos(null);
      return;
    }

    // 3. Check nodes (select + start drag)
    const node = findNodeAt(wx, wy);
    if (node) {
      setSelectedEdgeId(null);
      setEdgePopupPos(null);
      onSelectNode(node.id);
      dragNodeRef.current = {
        nodeId: node.id,
        startWorldX: wx,
        startWorldY: wy,
        origNodeX: node.x,
        origNodeY: node.y,
        moved: false,
      };
      return;
    }

    // 4. Check edges (click to select & offer disconnect)
    const edge = findEdgeAt(wx, wy);
    if (edge) {
      onSelectNode(null);
      setSelectedEdgeId(edge.id);
      refreshEdgePopup(edge.id);
      return;
    }

    // 5. Empty canvas -> pan + deselect
    setSelectedEdgeId(null);
    setEdgePopupPos(null);
    onSelectNode(null);
    panRef.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      origCamX: cameraRef.current.x,
      origCamY: cameraRef.current.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);

    if (wiringRef.current) {
      wiringRef.current.cursorWorldX = wx;
      wiringRef.current.cursorWorldY = wy;
    }

    if (dragNodeRef.current) {
      const d = dragNodeRef.current;
      const dx = wx - d.startWorldX;
      const dy = wy - d.startWorldY;
      if (Math.hypot(dx, dy) > 2) d.moved = true;
      const node = engine.nodes.find((n) => n.id === d.nodeId);
      if (node) {
        node.x = d.origNodeX + dx;
        node.y = d.origNodeY + dy;
      }
      return;
    }

    if (panRef.current) {
      const p = panRef.current;
      cameraRef.current.x = p.origCamX + (e.clientX - p.startClientX);
      cameraRef.current.y = p.origCamY + (e.clientY - p.startClientY);
      if (selectedEdgeIdRef.current) {
        refreshEdgePopup(selectedEdgeIdRef.current);
      }
      return;
    }

    hoverPortRef.current = findPortAt(wx, wy);
    const hoveredNode = findNodeAt(wx, wy);
    hoverNodeIdRef.current = hoveredNode?.id ?? null;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }

    const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);

    if (wiringRef.current) {
      const fromId = wiringRef.current.fromNodeId;
      const fromNode = engine.nodes.find((n) => n.id === fromId);
      const port = findPortAt(wx, wy);
      const targetNode = findNodeAt(wx, wy);

      // If dragged directly onto a target port or node, connect immediately
      const targetId =
        port?.kind === 'in'
          ? port.nodeId
          : targetNode && targetNode.id !== fromId && NODE_META[targetNode.type].hasInput
            ? targetNode.id
            : null;

      if (targetId && targetId !== fromId) {
        engine.addEdge(fromId, targetId);
        wiringRef.current = null;
        onTopologyChanged();
      } else if (fromNode) {
        const outX = fromNode.x + NODE_DIMENSIONS.width;
        const outY = fromNode.y + NODE_DIMENSIONS.height * 0.5;
        const distFromStart = Math.hypot(wx - outX, wy - outY);
        // If user just clicked the output port (<12px movement), stay in click-to-connect mode!
        if (distFromStart > 16) {
          wiringRef.current = null;
        }
      } else {
        wiringRef.current = null;
      }
    }

    dragNodeRef.current = null;
    panRef.current = null;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const cam = cameraRef.current;

    const factor = e.deltaY < 0 ? 1.09 : 0.92;
    const nextZoom = Math.max(0.35, Math.min(2.0, cam.zoom * factor));
    const scaleChange = nextZoom / cam.zoom;

    cameraRef.current = {
      zoom: nextZoom,
      x: sx - (sx - cam.x) * scaleChange,
      y: sy - (sy - cam.y) * scaleChange,
    };
    setZoomPct(Math.round(nextZoom * 100));
    if (selectedEdgeIdRef.current) {
      refreshEdgePopup(selectedEdgeIdRef.current);
    }
  };

  const applyZoomStep = (delta: number) => {
    const container = containerRef.current;
    if (!container) return;
    const cx = container.clientWidth * 0.5;
    const cy = container.clientHeight * 0.5;
    const cam = cameraRef.current;
    const nextZoom = Math.max(0.35, Math.min(2.0, cam.zoom + delta));
    const ratio = nextZoom / cam.zoom;
    cameraRef.current = {
      zoom: nextZoom,
      x: cx - (cx - cam.x) * ratio,
      y: cy - (cy - cam.y) * ratio,
    };
    setZoomPct(Math.round(nextZoom * 100));
    if (selectedEdgeIdRef.current) {
      refreshEdgePopup(selectedEdgeIdRef.current);
    }
  };

  const spawnNodeAtCenter = (type: NodeType) => {
    const container = containerRef.current;
    if (!container) return;
    const cx = container.clientWidth * 0.5;
    const cy = container.clientHeight * 0.5;
    const cam = cameraRef.current;
    const jitter = (engine.nodes.length % 5) * 24 - 48;
    const wx = (cx - cam.x) / cam.zoom - NODE_DIMENSIONS.width * 0.5 + jitter;
    const wy = (cy - cam.y) / cam.zoom - NODE_DIMENSIONS.height * 0.5 + jitter;
    const created = engine.addNode(type, wx, wy);
    onSelectNode(created.id);
    onTopologyChanged();
  };

  const handleCanvasDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/packetstorm-node') as NodeType;
    if (!type || !NODE_META[type]) return;
    const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
    const created = engine.addNode(
      type,
      wx - NODE_DIMENSIONS.width * 0.5,
      wy - NODE_DIMENSIONS.height * 0.5
    );
    onSelectNode(created.id);
    onTopologyChanged();
  };

  return (
    <div
      ref={containerRef}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleCanvasDrop}
      className="relative flex-1 h-full overflow-hidden bg-[#090d16] select-none"
    >
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        className="w-full h-full block cursor-grab active:cursor-grabbing touch-none"
      />

      {/* Left Floating Add-Node Palette */}
      <div className="absolute left-4 top-4 z-10 bg-[#0d1320]/95 backdrop-blur-sm border border-slate-800/90 rounded-lg p-1.5 flex flex-col gap-0.5 shadow-lg">
        <div className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-400 border-b border-slate-800/80 mb-0.5">
          Add Component
        </div>
        {NODE_PALETTE.map((item) => (
          <button
            key={item.type}
            type="button"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/packetstorm-node', item.type);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => spawnNodeAtCenter(item.type)}
            title={`Click or drag onto canvas to add ${item.label}`}
            className="flex items-center gap-2.5 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800/70 rounded-md transition-colors cursor-pointer whitespace-nowrap text-left"
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      {/* Selected Edge Disconnect Floating Button */}
      {selectedEdgeId && edgePopupPos && (
        <div
          style={{
            left: `${edgePopupPos.x}px`,
            top: `${edgePopupPos.y}px`,
            transform: 'translate(-50%, -50%)',
          }}
          className="absolute z-20 flex items-center gap-1 bg-[#0d1320] border border-slate-700 rounded-md p-1 shadow-lg"
        >
          <button
            type="button"
            onClick={() => {
              engine.removeEdge(selectedEdgeId);
              setSelectedEdgeId(null);
              setEdgePopupPos(null);
              onTopologyChanged();
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-red-300 hover:text-red-200 hover:bg-red-500/15 rounded transition-colors cursor-pointer whitespace-nowrap"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Disconnect</span>
          </button>
        </div>
      )}

      {/* Bottom-Right Zoom & Fit Controls */}
      <div className="absolute right-4 bottom-4 z-10 flex items-center gap-1 bg-[#0d1320]/95 backdrop-blur-sm border border-slate-800/90 rounded-lg p-1 shadow-lg">
        <button
          type="button"
          onClick={() => applyZoomStep(-0.15)}
          aria-label="Zoom out"
          className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded transition-colors cursor-pointer"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <span className="font-mono text-xs text-slate-300 px-2 min-w-[48px] text-center">
          {zoomPct}%
        </span>
        <button
          type="button"
          onClick={() => applyZoomStep(0.15)}
          aria-label="Zoom in"
          className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-4 bg-slate-800 mx-0.5" />
        <button
          type="button"
          onClick={fitToView}
          title="Fit topology to viewport"
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded transition-colors cursor-pointer whitespace-nowrap"
        >
          <Maximize2 className="w-3.5 h-3.5" />
          <span>Fit</span>
        </button>
      </div>

      {/* Subtle Bottom-Center Onboarding Hint */}
      {showHint && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 bg-[#0d1320]/90 backdrop-blur-sm border border-slate-800/80 rounded-lg px-3.5 py-1.5 text-xs text-slate-400 whitespace-nowrap shadow-md">
          <span>
            Drag nodes · Click output → input port to wire · Hit{' '}
            <strong className="text-amber-300 font-medium">Viral Spike</strong> to break things
          </span>
          <button
            type="button"
            onClick={() => setShowHint(false)}
            aria-label="Dismiss hint"
            className="text-slate-500 hover:text-slate-200 transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
