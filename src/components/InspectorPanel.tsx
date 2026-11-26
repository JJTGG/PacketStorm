import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  HelpCircle,
  Info,
  MousePointerClick,
  Power,
  PowerOff,
  Trash2,
  Unlink,
  Upload,
  XOctagon,
} from 'lucide-react';
import { analyzeTopology } from '../lib/sim/diagnostics';
import { NODE_META, NODE_PARAM_HELP } from '../lib/sim/presets';
import {
  LoadBalancerStrategy,
  NodeUiSnapshot,
  SimEdge,
  SimMetrics,
  SimNodeConfig,
} from '../lib/sim/types';

interface InspectorPanelProps {
  selectedNode: NodeUiSnapshot | null;
  allNodes: NodeUiSnapshot[];
  edges: SimEdge[];
  metrics: SimMetrics;
  selectedNodeEdgeCount: number;
  importError: string | null;
  onDismissImportError: () => void;
  onCloseMobileDrawer?: () => void;
  onSelectNode: (nodeId: string) => void;
  onUpdateConfig: (nodeId: string, patch: Partial<SimNodeConfig>) => void;
  onUpdateLabel: (nodeId: string, label: string) => void;
  onToggleNodeDown: (nodeId: string) => void;
  onDisconnectNode: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onExportTopology: () => void;
  onImportTopology: (jsonText: string) => void;
}

const Sparkline: React.FC<{ history: number[]; status: NodeUiSnapshot['status'] }> = ({
  history,
  status,
}) => {
  const width = 264;
  const height = 54;
  const pts = history.length > 1 ? history : [0, 0];

  const strokeColor =
    status === 'offline'
      ? '#64748b'
      : status === 'overloaded'
        ? '#ef4444'
        : status === 'degraded'
          ? '#f59e0b'
          : '#22c55e';
  const fillColor =
    status === 'offline'
      ? 'rgba(100, 116, 139, 0.12)'
      : status === 'overloaded'
        ? 'rgba(239, 68, 68, 0.16)'
        : status === 'degraded'
          ? 'rgba(245, 158, 11, 0.16)'
          : 'rgba(34, 197, 94, 0.16)';

  const coords = pts.map((val, idx) => {
    const x = (idx / (pts.length - 1)) * width;
    const clamped = Math.max(0, Math.min(1, val));
    const y = height - 4 - clamped * (height - 10);
    return { x, y };
  });

  const linePath = coords
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-[54px] bg-[#090d16] border border-slate-800/80 rounded-md overflow-hidden"
    >
      <line
        x1={0}
        y1={height * 0.5}
        x2={width}
        y2={height * 0.5}
        stroke="#1e293b"
        strokeDasharray="3 3"
        strokeWidth={1}
      />
      <line
        x1={0}
        y1={height * 0.14}
        x2={width}
        y2={height * 0.14}
        stroke="rgba(239,68,68,0.22)"
        strokeDasharray="3 3"
        strokeWidth={1}
      />
      <path d={areaPath} fill={fillColor} />
      <path d={linePath} fill="none" stroke={strokeColor} strokeWidth={1.75} />
    </svg>
  );
};

interface HelpTooltipProps {
  title: string;
  content: React.ReactNode;
  variant?: 'info' | 'help';
  align?: 'left' | 'right';
  placement?: 'top' | 'bottom';
}

const HelpTooltip: React.FC<HelpTooltipProps> = ({
  title,
  content,
  variant = 'help',
  align = 'left',
  placement = 'bottom',
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={containerRef}
      className="relative inline-flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={`Help for ${title}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          if (!containerRef.current?.contains(e.relatedTarget as Node)) {
            setOpen(false);
          }
        }}
        className="text-slate-500 hover:text-cyan-300 focus-visible:text-cyan-300 focus-visible:outline-none transition-colors p-0.5 rounded cursor-pointer"
      >
        {variant === 'info' ? (
          <Info className="w-3.5 h-3.5" />
        ) : (
          <HelpCircle className="w-3.5 h-3.5" />
        )}
      </button>

      {open && (
        <div
          role="tooltip"
          className={`absolute z-40 w-[264px] bg-[#090d16] border border-slate-700/90 rounded-lg p-3 shadow-xl text-left ${
            placement === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          } ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          <div className="text-[11px] font-semibold text-cyan-300 mb-1">{title}</div>
          <div className="text-[11px] text-slate-300 leading-relaxed">{content}</div>
        </div>
      )}
    </div>
  );
};

interface SliderRowProps {
  label: string;
  helpText?: string;
  helpPlacement?: 'top' | 'bottom';
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (val: number) => void;
}

const SliderRow: React.FC<SliderRowProps> = ({
  label,
  helpText,
  helpPlacement = 'bottom',
  value,
  min,
  max,
  step,
  unit,
  onChange,
}) => (
  <div className="space-y-1.5">
    <div className="flex items-center justify-between text-xs gap-2">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-slate-300 font-medium truncate">{label}</span>
        {helpText && (
          <HelpTooltip title={label} content={helpText} align="left" placement={helpPlacement} />
        )}
      </div>
      <span className="font-mono text-cyan-300 font-medium shrink-0">
        {value} {unit}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="telemetry-slider w-full"
    />
  </div>
);

export const InspectorPanel: React.FC<InspectorPanelProps> = ({
  selectedNode,
  allNodes,
  edges,
  metrics,
  selectedNodeEdgeCount,
  importError,
  onDismissImportError,
  onCloseMobileDrawer,
  onSelectNode,
  onUpdateConfig,
  onUpdateLabel,
  onToggleNodeDown,
  onDisconnectNode,
  onDeleteNode,
  onExportTopology,
  onImportTopology,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!selectedNode) {
    const diagnostics = analyzeTopology(allNodes, edges, metrics);

    return (
      <aside className="w-[320px] h-full shrink-0 bg-[#0d1320] border-l border-slate-800/90 flex flex-col overflow-hidden">
        <div className="px-4 py-3.5 border-b border-slate-800/80 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Topology Inspector</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Select a node to tune or inject faults.
            </p>
          </div>
          {onCloseMobileDrawer && (
            <button
              type="button"
              onClick={onCloseMobileDrawer}
              className="lg:hidden px-2 py-1 text-xs text-slate-400 hover:text-white border border-slate-800 rounded cursor-pointer"
            >
              Close
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Live Diagnostics */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-200">Live Diagnostics</span>
              <span className="font-mono text-[11px] text-slate-500">
                {diagnostics.length} {diagnostics.length === 1 ? 'note' : 'notes'}
              </span>
            </div>
            <div className="divide-y divide-slate-800/70 border border-slate-800/80 rounded-lg bg-[#090d16]/60">
              {diagnostics.map((d) => {
                const icon =
                  d.severity === 'critical' ? (
                    <XOctagon className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                  ) : d.severity === 'warning' ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  ) : (
                    <Info className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                  );
                return (
                  <button
                    key={d.id}
                    type="button"
                    disabled={!d.nodeId}
                    onClick={() => d.nodeId && onSelectNode(d.nodeId)}
                    className={`w-full text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors ${
                      d.nodeId ? 'hover:bg-slate-800/50 cursor-pointer' : 'cursor-default'
                    }`}
                  >
                    {icon}
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-200">{d.title}</div>
                      <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                        {d.detail}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Nodes Quick List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-semibold text-slate-200">Active Nodes</span>
              <span className="font-mono text-slate-400">{allNodes.length} nodes</span>
            </div>

            {allNodes.length === 0 ? (
              <div className="py-10 text-center space-y-2 text-xs text-slate-400 border border-dashed border-slate-800 rounded-lg px-4">
                <MousePointerClick className="w-5 h-5 mx-auto text-slate-500" />
                <p>Canvas is empty. Add nodes from the left palette or choose a preset above.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-800/70 border border-slate-800/80 rounded-lg bg-[#090d16]/60">
                {allNodes.map((node) => {
                  const utilPct = Math.min(100, Math.round(node.utilization * 100));
                  const barColor =
                    node.isDown || node.status === 'overloaded'
                      ? 'bg-red-500'
                      : node.status === 'degraded'
                        ? 'bg-amber-500'
                        : 'bg-emerald-500';
                  return (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => onSelectNode(node.id)}
                      className="w-full text-left px-3 py-2.5 hover:bg-slate-800/50 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-xs font-medium truncate ${
                            node.isDown ? 'text-red-300 line-through' : 'text-slate-200'
                          }`}
                        >
                          {node.label}
                        </span>
                        <span className="font-mono text-[11px] text-slate-400 shrink-0">
                          {node.isDown ? 'OFFLINE' : `${utilPct}%`}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                        <span>{NODE_META[node.type].title}</span>
                        <span className="font-mono">
                          {node.currentRps.toFixed(0)} req/s
                          {node.totalDropped > 0 ? ` · ${node.totalDropped} err` : ''}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1 w-full bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-150 ${barColor}`}
                          style={{ width: `${node.isDown ? 100 : utilPct}%` }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Export / Import Topology Footer */}
        <div className="p-3.5 border-t border-slate-800/80 space-y-2.5">
          {importError && (
            <div className="flex items-start justify-between gap-2 px-2.5 py-2 rounded-md bg-red-500/10 border border-red-500/35 text-[11px] text-red-300">
              <span>{importError}</span>
              <button
                type="button"
                onClick={onDismissImportError}
                className="text-red-400 hover:text-red-200 font-medium shrink-0 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                file.text().then((txt) => onImportTopology(txt));
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={onExportTopology}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white bg-[#090d16] hover:bg-slate-800 border border-slate-800 rounded-md transition-colors cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export JSON</span>
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white bg-[#090d16] hover:bg-slate-800 border border-slate-800 rounded-md transition-colors cursor-pointer whitespace-nowrap"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Import JSON</span>
            </button>
          </div>
        </div>
      </aside>
    );
  }

  const meta = NODE_META[selectedNode.type];
  const nodeHelp = NODE_PARAM_HELP[selectedNode.type];
  const utilPct = Math.min(100, Math.round(selectedNode.utilization * 100));
  const cfg = selectedNode.config;

  return (
    <aside className="w-[320px] h-full shrink-0 bg-[#0d1320] border-l border-slate-800/90 flex flex-col overflow-hidden">
      {/* Node Header */}
      <div className="px-4 py-3.5 border-b border-slate-800/80 space-y-2.5">
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-medium">{meta.title}</span>
            <HelpTooltip
              variant="info"
              align="left"
              title={`${meta.title} Mechanics`}
              content={
                <div className="space-y-2">
                  <p className="text-slate-300">{nodeHelp.overview}</p>
                  <div className="pt-1.5 border-t border-slate-800 space-y-1.5">
                    {nodeHelp.params.map((p) => (
                      <div key={p.name}>
                        <div className="font-medium text-slate-100">{p.name}</div>
                        <div className="text-slate-400">{p.impact}</div>
                      </div>
                    ))}
                  </div>
                </div>
              }
            />
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 font-medium ${
                selectedNode.isDown || selectedNode.status === 'overloaded'
                  ? 'text-red-400'
                  : selectedNode.status === 'degraded'
                    ? 'text-amber-400'
                    : 'text-emerald-400'
              }`}
            >
              {selectedNode.isDown ? (
                <>
                  <PowerOff className="w-3.5 h-3.5" />
                  <span>Offline</span>
                </>
              ) : selectedNode.status === 'overloaded' ? (
                <>
                  <XOctagon className="w-3.5 h-3.5" />
                  <span>Critical</span>
                </>
              ) : selectedNode.status === 'degraded' ? (
                <>
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Elevated</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Nominal</span>
                </>
              )}
            </span>
            {onCloseMobileDrawer && (
              <button
                type="button"
                onClick={onCloseMobileDrawer}
                className="lg:hidden px-2 py-0.5 text-[11px] text-slate-400 hover:text-white border border-slate-800 rounded cursor-pointer"
              >
                Close
              </button>
            )}
          </div>
        </div>

        <input
          type="text"
          value={selectedNode.label}
          onChange={(e) => onUpdateLabel(selectedNode.id, e.target.value)}
          aria-label="Node label"
          className="w-full bg-[#090d16] border border-slate-800 focus:border-cyan-500/70 rounded-md px-2.5 py-1.5 text-sm font-semibold text-slate-100 outline-none transition-colors"
        />

        <p className="text-xs text-slate-400 leading-relaxed">{meta.description}</p>
      </div>

      {/* Scrollable Telemetry & Parameters */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Live Utilization + Sparkline */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-300 font-medium">Live Utilization</span>
            <span className="font-mono font-semibold text-slate-100">
              {selectedNode.isDown ? 'OFFLINE' : `${utilPct}%`}
            </span>
          </div>
          <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-150 ${
                selectedNode.isDown
                  ? 'bg-red-500/50'
                  : selectedNode.status === 'overloaded'
                    ? 'bg-red-500'
                    : selectedNode.status === 'degraded'
                      ? 'bg-amber-500'
                      : 'bg-emerald-500'
              }`}
              style={{ width: `${selectedNode.isDown ? 100 : utilPct}%` }}
            />
          </div>
          <Sparkline history={selectedNode.history} status={selectedNode.status} />
        </div>

        {/* Live Telemetry Counters */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 py-3 border-y border-slate-800/80 text-xs">
          <div>
            <div className="text-slate-400">Throughput</div>
            <div className="font-mono text-sm font-semibold text-slate-100 mt-0.5">
              {selectedNode.currentRps.toFixed(0)} req/s
            </div>
          </div>
          <div>
            <div className="text-slate-400">Processed</div>
            <div className="font-mono text-sm font-semibold text-slate-100 mt-0.5">
              {selectedNode.totalProcessed.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-slate-400">
              {selectedNode.type === 'cache'
                ? 'Cache Hits'
                : selectedNode.type === 'ratelimiter'
                  ? 'Available Tokens'
                  : 'Queue Depth'}
            </div>
            <div className="font-mono text-sm font-semibold text-cyan-300 mt-0.5">
              {selectedNode.type === 'cache'
                ? selectedNode.totalCacheHits.toLocaleString()
                : selectedNode.type === 'ratelimiter'
                  ? `${Math.floor(selectedNode.tokens)} / ${cfg.burstCapacity ?? 60}`
                  : `${selectedNode.queueDepth}`}
            </div>
          </div>
          <div>
            <div className="text-slate-400">Dropped</div>
            <div
              className={`font-mono text-sm font-semibold mt-0.5 ${
                selectedNode.totalDropped > 0 ? 'text-red-400' : 'text-slate-200'
              }`}
            >
              {selectedNode.totalDropped.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Tunable Live Parameters */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-200">Live Parameters</h3>
            <HelpTooltip
              variant="info"
              align="right"
              title={`${meta.title} Parameters`}
              content={
                <div className="space-y-1.5">
                  {nodeHelp.params.map((p) => (
                    <div key={p.name}>
                      <div className="font-medium text-slate-100">{p.name}</div>
                      <div className="text-slate-400">{p.impact}</div>
                    </div>
                  ))}
                </div>
              }
            />
          </div>

          {selectedNode.type === 'ingress' && (
            <p className="text-xs text-slate-400 leading-relaxed">
              Traffic emission rate and pattern are controlled from the top bar. Connect this
              node&apos;s output port to downstream Gateways, Rate Limiters, or Servers.
            </p>
          )}

          {selectedNode.type === 'ratelimiter' && (
            <>
              <SliderRow
                label="Rate Limit"
                helpText={nodeHelp.params[0].impact}
                value={cfg.rateLimitRps ?? 180}
                min={20}
                max={450}
                step={10}
                unit="req/s"
                onChange={(v) => onUpdateConfig(selectedNode.id, { rateLimitRps: v })}
              />
              <SliderRow
                label="Burst Capacity"
                helpText={nodeHelp.params[1].impact}
                value={cfg.burstCapacity ?? 60}
                min={5}
                max={300}
                step={5}
                unit="tokens"
                onChange={(v) => onUpdateConfig(selectedNode.id, { burstCapacity: v })}
              />
            </>
          )}

          {selectedNode.type === 'loadbalancer' && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                <span>Balancing Strategy</span>
                <HelpTooltip
                  title="Balancing Strategy"
                  content={nodeHelp.params[0].impact}
                  align="left"
                />
              </div>
              <div className="grid grid-cols-2 gap-1 p-1 bg-[#090d16] border border-slate-800 rounded-lg">
                {(
                  [
                    { id: 'least_connections', label: 'Least Conn' },
                    { id: 'round_robin', label: 'Round Robin' },
                  ] as Array<{ id: LoadBalancerStrategy; label: string }>
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onUpdateConfig(selectedNode.id, { lbStrategy: opt.id })}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                      (cfg.lbStrategy ?? 'least_connections') === opt.id
                        ? 'bg-slate-800 text-slate-100'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {selectedNode.type === 'cache' && (
            <SliderRow
              label="Cache Hit Rate"
              helpText={nodeHelp.params[0].impact}
              value={cfg.cacheHitRate ?? 60}
              min={0}
              max={98}
              step={2}
              unit="%"
              onChange={(v) => onUpdateConfig(selectedNode.id, { cacheHitRate: v })}
            />
          )}

          {selectedNode.type === 'appserver' && (
            <>
              <SliderRow
                label="Max Concurrency"
                helpText={nodeHelp.params[0].impact}
                value={cfg.maxConcurrency ?? 12}
                min={2}
                max={64}
                step={1}
                unit="workers"
                onChange={(v) => onUpdateConfig(selectedNode.id, { maxConcurrency: v })}
              />
              <SliderRow
                label="Processing Time"
                helpText={nodeHelp.params[1].impact}
                value={cfg.processingTimeMs ?? 90}
                min={15}
                max={350}
                step={5}
                unit="ms"
                onChange={(v) => onUpdateConfig(selectedNode.id, { processingTimeMs: v })}
              />
              <SliderRow
                label="Queue Capacity"
                helpText={nodeHelp.params[2].impact}
                value={cfg.queueCapacity ?? 24}
                min={0}
                max={150}
                step={2}
                unit="slots"
                onChange={(v) => onUpdateConfig(selectedNode.id, { queueCapacity: v })}
              />
            </>
          )}

          {selectedNode.type === 'queue' && (
            <>
              <SliderRow
                label="Drain Rate"
                helpText={nodeHelp.params[0].impact}
                value={cfg.drainRateRps ?? 120}
                min={10}
                max={400}
                step={5}
                unit="req/s"
                onChange={(v) => onUpdateConfig(selectedNode.id, { drainRateRps: v })}
              />
              <SliderRow
                label="Buffer Capacity"
                helpText={nodeHelp.params[1].impact}
                value={cfg.queueCapacity ?? 400}
                min={50}
                max={1200}
                step={25}
                unit="msgs"
                onChange={(v) => onUpdateConfig(selectedNode.id, { queueCapacity: v })}
              />
            </>
          )}

          {selectedNode.type === 'database' && (
            <>
              <SliderRow
                label="Connection Pool"
                helpText={nodeHelp.params[0].impact}
                value={cfg.poolSize ?? 16}
                min={2}
                max={64}
                step={1}
                unit="conns"
                onChange={(v) => onUpdateConfig(selectedNode.id, { poolSize: v })}
              />
              <SliderRow
                label="Base Query Latency"
                helpText={nodeHelp.params[1].impact}
                value={cfg.baseLatencyMs ?? 45}
                min={10}
                max={250}
                step={5}
                unit="ms"
                onChange={(v) => onUpdateConfig(selectedNode.id, { baseLatencyMs: v })}
              />
              <SliderRow
                label="Wait Queue Capacity"
                helpText={nodeHelp.params[2].impact}
                value={cfg.queueCapacity ?? 24}
                min={0}
                max={120}
                step={2}
                unit="slots"
                onChange={(v) => onUpdateConfig(selectedNode.id, { queueCapacity: v })}
              />
            </>
          )}
        </div>

        {/* Chaos Engineering & Fault Injection */}
        <div className="pt-4 border-t border-slate-800/80 space-y-3.5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-200">Chaos Fault Injection</h3>
            <span className="font-mono text-[11px] text-slate-500">Key: K</span>
          </div>

          <button
            type="button"
            onClick={() => onToggleNodeDown(selectedNode.id)}
            className={`w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-md border transition-colors cursor-pointer ${
              selectedNode.isDown
                ? 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/40'
                : 'bg-red-500/10 hover:bg-red-500/20 text-red-300 border-red-500/35'
            }`}
          >
            {selectedNode.isDown ? (
              <>
                <Power className="w-3.5 h-3.5" />
                <span>Recover Node (Bring Online)</span>
              </>
            ) : (
              <>
                <PowerOff className="w-3.5 h-3.5" />
                <span>Kill Node (Simulate Crash)</span>
              </>
            )}
          </button>

          {selectedNode.type !== 'ingress' && (
            <SliderRow
              label="Injected Latency Fault"
              helpPlacement="top"
              helpText="Adds artificial network or processing delay to every request passing through this node, compounding downstream queue pressure."
              value={cfg.injectedLatencyMs ?? 0}
              min={0}
              max={400}
              step={10}
              unit="ms"
              onChange={(v) => onUpdateConfig(selectedNode.id, { injectedLatencyMs: v })}
            />
          )}
        </div>
      </div>

      {/* Node Actions Footer */}
      <div className="p-4 border-t border-slate-800/80 flex items-center gap-2">
        {selectedNodeEdgeCount > 0 && (
          <button
            type="button"
            onClick={() => onDisconnectNode(selectedNode.id)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white bg-[#090d16] hover:bg-slate-800 border border-slate-800 rounded-md transition-colors cursor-pointer whitespace-nowrap"
          >
            <Unlink className="w-3.5 h-3.5" />
            <span>Unwire ({selectedNodeEdgeCount})</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => onDeleteNode(selectedNode.id)}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-red-300 hover:text-red-200 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-md transition-colors cursor-pointer whitespace-nowrap"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Remove Node</span>
        </button>
      </div>
    </aside>
  );
};
