import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { TimeSeriesPoint } from '../lib/sim/types';

interface TelemetryOscilloscopeProps {
  series: TimeSeriesPoint[];
  isOpen: boolean;
  onToggle: () => void;
}

export const TelemetryOscilloscope: React.FC<TelemetryOscilloscopeProps> = ({
  series,
  isOpen,
  onToggle,
}) => {
  const latest = series[series.length - 1];
  const width = 480;
  const height = 74;

  // Throughput scale
  const maxRps = Math.max(
    100,
    ...series.map((p) => Math.max(p.ingressRps, p.successRps + p.droppedRps))
  );
  // Latency scale
  const maxMs = Math.max(150, ...series.map((p) => p.p95Ms));

  const buildPath = (extractor: (p: TimeSeriesPoint) => number, maxVal: number) => {
    if (series.length < 2) return '';
    return series
      .map((p, idx) => {
        const x = (idx / Math.max(1, series.length - 1)) * width;
        const norm = Math.max(0, Math.min(1, extractor(p) / maxVal));
        const y = height - 4 - norm * (height - 10);
        return `${idx === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  };

  const ingressPath = buildPath((p) => p.ingressRps, maxRps);
  const successPath = buildPath((p) => p.successRps, maxRps);
  const droppedPath = buildPath((p) => p.droppedRps, maxRps);

  const successArea = successPath ? `${successPath} L${width},${height} L0,${height} Z` : '';
  const droppedArea = droppedPath ? `${droppedPath} L${width},${height} L0,${height} Z` : '';

  const p95Path = buildPath((p) => p.p95Ms, maxMs);
  const p50Path = buildPath((p) => p.p50Ms, maxMs);

  return (
    <section className="shrink-0 bg-[#0d1320] border-t border-slate-800/90 select-none">
      {/* Slim Header Bar */}
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-slate-800/70">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2 text-xs font-semibold text-slate-300 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
        >
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          ) : (
            <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
          )}
          <span>30s Live Oscilloscope</span>
        </button>

        <div className="flex items-center gap-5 text-[11px] font-mono text-slate-400 whitespace-nowrap">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-slate-400 inline-block" />
            <span>Ingress {latest ? Math.round(latest.ingressRps) : 0}/s</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-emerald-400">
            <span className="w-2.5 h-0.5 bg-emerald-400 inline-block" />
            <span>Success {latest ? Math.round(latest.successRps) : 0}/s</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-red-400">
            <span className="w-2.5 h-0.5 bg-red-400 inline-block" />
            <span>Dropped {latest ? Math.round(latest.droppedRps) : 0}/s</span>
          </span>
          <span className="text-slate-600">|</span>
          <span className="inline-flex items-center gap-1.5 text-amber-400">
            <span className="w-2.5 h-0.5 bg-amber-400 inline-block" />
            <span>p95 {latest ? Math.round(latest.p95Ms) : 0}ms</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-cyan-400">
            <span className="w-2.5 h-0.5 bg-cyan-400 inline-block" />
            <span>p50 {latest ? Math.round(latest.p50Ms) : 0}ms</span>
          </span>
        </div>
      </div>

      {/* Expandable Chart Pair */}
      {isOpen && (
        <div className="grid grid-cols-2 divide-x divide-slate-800/80 px-2 py-2 bg-[#090d16]/75">
          {/* Chart 1: Throughput & Drops */}
          <div className="px-2 space-y-1">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Throughput vs. Dropped Load</span>
              <span className="font-mono text-slate-500">peak {Math.round(maxRps)} req/s</span>
            </div>
            <svg
              viewBox={`0 0 ${width} ${height}`}
              preserveAspectRatio="none"
              className="w-full h-[74px] bg-[#090d16] border border-slate-800/70 rounded"
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
              {successArea && <path d={successArea} fill="rgba(34, 197, 94, 0.14)" />}
              {droppedArea && <path d={droppedArea} fill="rgba(239, 68, 68, 0.22)" />}
              {ingressPath && (
                <path
                  d={ingressPath}
                  fill="none"
                  stroke="#94a3b8"
                  strokeWidth={1.25}
                  strokeDasharray="4 3"
                />
              )}
              {successPath && (
                <path d={successPath} fill="none" stroke="#22c55e" strokeWidth={1.75} />
              )}
              {droppedPath && (
                <path d={droppedPath} fill="none" stroke="#ef4444" strokeWidth={1.75} />
              )}
            </svg>
          </div>

          {/* Chart 2: Tail Latency */}
          <div className="px-2 space-y-1">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Tail Latency (p50 / p95)</span>
              <span className="font-mono text-slate-500">scale {Math.round(maxMs)} ms</span>
            </div>
            <svg
              viewBox={`0 0 ${width} ${height}`}
              preserveAspectRatio="none"
              className="w-full h-[74px] bg-[#090d16] border border-slate-800/70 rounded"
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
              {p95Path && (
                <path d={p95Path} fill="none" stroke="#f59e0b" strokeWidth={1.75} />
              )}
              {p50Path && (
                <path d={p50Path} fill="none" stroke="#22d3ee" strokeWidth={1.6} />
              )}
            </svg>
          </div>
        </div>
      )}
    </section>
  );
};
