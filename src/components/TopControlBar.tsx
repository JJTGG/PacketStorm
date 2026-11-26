import React, { useRef } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Pause,
  Play,
  RotateCcw,
  Share2,
  Volume2,
  VolumeX,
  X,
  XOctagon,
} from 'lucide-react';
import { PRESETS } from '../lib/sim/presets';
import { SimMetrics, TrafficPattern } from '../lib/sim/types';

interface TopControlBarProps {
  activePresetId: string;
  trafficPattern: TrafficPattern;
  trafficIntensityRps: number;
  isRunning: boolean;
  metrics: SimMetrics;
  onSelectPreset: (presetId: string) => void;
  onChangePattern: (pattern: TrafficPattern) => void;
  onChangeIntensity: (rps: number) => void;
  onTogglePlay: () => void;
  onReset: () => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  shareUrl: string | null;
  shareCopied: boolean;
  onShareTopology: () => void;
  onCopyShareUrl: () => void;
  onCloseSharePopover: () => void;
}

const PATTERN_OPTIONS: Array<{ id: TrafficPattern; label: string }> = [
  { id: 'steady', label: 'Steady' },
  { id: 'viral_spike', label: 'Viral Spike' },
  { id: 'bot_flood', label: 'Bot Flood' },
];

export const TopControlBar: React.FC<TopControlBarProps> = ({
  activePresetId,
  trafficPattern,
  trafficIntensityRps,
  isRunning,
  metrics,
  onSelectPreset,
  onChangePattern,
  onChangeIntensity,
  onTogglePlay,
  onReset,
  soundEnabled,
  onToggleSound,
  shareUrl,
  shareCopied,
  onShareTopology,
  onCopyShareUrl,
  onCloseSharePopover,
}) => {
  const shareInputRef = useRef<HTMLInputElement>(null);
  const successPct = metrics.successRate;
  const isCritical = successPct < 80 || metrics.droppedRps > 15;
  const isDegraded = !isCritical && (successPct < 98 || metrics.p95LatencyMs > 250);

  return (
    <header className="shrink-0 bg-[#0d1320] border-b border-slate-800/90 select-none z-20">
      {/* Row 1: Primary Workspace Controls */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-2.5 border-b border-slate-800/70">
        {/* Brand Wordmark */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-7 h-7 rounded-md bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
            <Activity className="w-4 h-4" />
          </div>
          <span className="text-base font-bold tracking-tight text-slate-100 whitespace-nowrap">
            PacketStorm
          </span>
        </div>

        {/* Preset Selector */}
        <div className="flex items-center gap-1 p-1 bg-[#090d16] border border-slate-800 rounded-lg">
          {PRESETS.map((preset) => {
            const active = preset.id === activePresetId;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onSelectPreset(preset.id)}
                title={preset.subtitle}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-slate-800 text-slate-100 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                {preset.name}
              </button>
            );
          })}
        </div>

        {/* Traffic Pattern & Intensity Controls */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1 p-1 bg-[#090d16] border border-slate-800 rounded-lg">
            {PATTERN_OPTIONS.map((opt) => {
              const active = opt.id === trafficPattern;
              const isDangerPattern = opt.id !== 'steady';
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onChangePattern(opt.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? isDangerPattern
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3 min-w-[205px]">
            <label
              htmlFor="traffic-intensity"
              className="text-xs font-medium text-slate-400 whitespace-nowrap shrink-0"
            >
              Intensity
            </label>
            <input
              id="traffic-intensity"
              type="range"
              min={10}
              max={400}
              step={5}
              value={trafficIntensityRps}
              onChange={(e) => onChangeIntensity(Number(e.target.value))}
              className="telemetry-slider w-24"
            />
            <span className="font-mono text-xs font-medium text-cyan-300 w-[64px] text-right whitespace-nowrap shrink-0">
              {trafficIntensityRps} req/s
            </span>
          </div>
        </div>

        {/* Playback & Share Controls */}
        <div className="relative flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onTogglePlay}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isRunning
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-500'
            }`}
          >
            {isRunning ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>Resume</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onReset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-[#090d16] hover:bg-slate-800 border border-slate-800 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
          <button
            type="button"
            onClick={onToggleSound}
            aria-pressed={soundEnabled}
            aria-label={soundEnabled ? 'Mute sound feedback' : 'Enable sound feedback'}
            title={soundEnabled ? 'Sound feedback on (click to mute)' : 'Sound feedback muted (click to enable)'}
            className={`flex items-center justify-center p-1.5 rounded-md border transition-colors shrink-0 cursor-pointer ${
              soundEnabled
                ? 'text-cyan-300 hover:text-cyan-100 bg-[#090d16] hover:bg-slate-800 border-slate-800'
                : 'text-slate-500 hover:text-slate-300 bg-[#090d16] hover:bg-slate-800 border-slate-800'
            }`}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={onShareTopology}
            title="Generate compressed URL for the current topology"
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              shareCopied
                ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/50'
                : 'text-cyan-300 hover:text-cyan-100 bg-cyan-500/10 hover:bg-cyan-500/20 border-cyan-500/35'
            }`}
          >
            {shareCopied ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>Copied Link</span>
              </>
            ) : (
              <>
                <Share2 className="w-3.5 h-3.5" />
                <span>Share</span>
              </>
            )}
          </button>

          {shareUrl && (
            <div className="absolute right-0 top-full mt-2 z-50 w-[360px] bg-[#0d1320] border border-slate-700/90 rounded-lg p-3 shadow-2xl space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-100">Share Topology Link</span>
                <span className="font-mono text-[11px] text-slate-400">
                  {shareUrl.length} chars
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  ref={shareInputRef}
                  type="text"
                  readOnly
                  value={shareUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="Shareable topology URL"
                  className="flex-1 min-w-0 bg-[#090d16] border border-slate-800 rounded px-2.5 py-1.5 font-mono text-[11px] text-cyan-300 outline-none select-all"
                />
                <button
                  type="button"
                  onClick={() => {
                    shareInputRef.current?.select();
                    onCopyShareUrl();
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-100 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {shareCopied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={onCloseSharePopover}
                  aria-label="Close share popover"
                  className="p-1.5 text-slate-400 hover:text-white rounded transition-colors cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Row 2: Live Telemetry KPI Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-2 bg-[#090d16]/70">
        <div className="flex flex-wrap items-center divide-x divide-slate-800/80">
          {/* Total RPS */}
          <div className="pr-5 flex items-baseline gap-2.5">
            <span className="text-[11px] font-medium text-slate-400 whitespace-nowrap">
              Total Throughput
            </span>
            <span className="font-mono text-sm font-semibold text-slate-100 whitespace-nowrap">
              {metrics.totalRps.toFixed(0)}{' '}
              <span className="text-[11px] font-normal text-slate-400">req/s</span>
            </span>
            <span className="font-mono text-[11px] text-slate-500 whitespace-nowrap">
              ({metrics.effectiveIngressRps.toFixed(0)} in)
            </span>
          </div>

          {/* Success % */}
          <div className="px-5 flex items-center gap-2">
            <span className="text-[11px] font-medium text-slate-400 whitespace-nowrap">
              Success Rate
            </span>
            <span
              className={`font-mono text-sm font-semibold whitespace-nowrap ${
                isCritical
                  ? 'text-red-400'
                  : isDegraded
                    ? 'text-amber-400'
                    : 'text-emerald-400'
              }`}
            >
              {metrics.successRate.toFixed(1)}%
            </span>
            <span
              className={`inline-flex items-center gap-1 text-[11px] font-medium whitespace-nowrap ${
                isCritical
                  ? 'text-red-400'
                  : isDegraded
                    ? 'text-amber-400'
                    : 'text-emerald-400'
              }`}
            >
              {isCritical ? (
                <>
                  <XOctagon className="w-3.5 h-3.5" />
                  <span>Critical</span>
                </>
              ) : isDegraded ? (
                <>
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Degraded</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Nominal</span>
                </>
              )}
            </span>
          </div>

          {/* Dropped / 503s */}
          <div className="px-5 flex items-baseline gap-2">
            <span className="text-[11px] font-medium text-slate-400 whitespace-nowrap">
              Dropped (429 / 503)
            </span>
            <span
              className={`font-mono text-sm font-semibold whitespace-nowrap ${
                metrics.droppedRps > 1 ? 'text-red-400' : 'text-slate-200'
              }`}
            >
              {metrics.droppedRps.toFixed(1)}{' '}
              <span className="text-[11px] font-normal text-slate-400">/s</span>
            </span>
            <span className="font-mono text-[11px] text-slate-500 whitespace-nowrap">
              {metrics.droppedTotal.toLocaleString()} total
            </span>
          </div>

          {/* p50 / p95 Latency */}
          <div className="pl-5 flex items-baseline gap-2">
            <span className="text-[11px] font-medium text-slate-400 whitespace-nowrap">
              p50 / p95 Latency
            </span>
            <span
              className={`font-mono text-sm font-semibold whitespace-nowrap ${
                metrics.p95LatencyMs > 300
                  ? 'text-amber-400'
                  : 'text-slate-100'
              }`}
            >
              {Math.round(metrics.p50LatencyMs)} ms
              <span className="text-slate-500 mx-1">/</span>
              {Math.round(metrics.p95LatencyMs)} ms
            </span>
          </div>
        </div>

        {/* Packet Color Legend */}
        <div className="hidden xl:flex items-center gap-4 text-[11px] text-slate-400 whitespace-nowrap shrink-0">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>200 OK</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-cyan-400" />
            <span>Cache Hit</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span>Queued / Slow</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            <span>Dropped (429/503)</span>
          </span>
        </div>
      </div>
    </header>
  );
};
