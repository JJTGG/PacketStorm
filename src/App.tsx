import { useCallback, useEffect, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { InspectorPanel } from './components/InspectorPanel';
import { SimulatorCanvas } from './components/SimulatorCanvas';
import { TelemetryOscilloscope } from './components/TelemetryOscilloscope';
import { TopControlBar } from './components/TopControlBar';
import { soundEngine } from './lib/audio/soundEngine';
import { SimulationEngine } from './lib/sim/engine';
import { PRESETS } from './lib/sim/presets';
import {
  buildShareUrl,
  decodeTopologyFromToken,
  encodeTopologyToToken,
  extractShareTokenFromLocation,
} from './lib/sim/share';
import {
  NodeUiSnapshot,
  SerializedTopology,
  SimMetrics,
  SimNodeConfig,
  TimeSeriesPoint,
  TrafficPattern,
} from './lib/sim/types';

const STORAGE_KEY = 'packetstorm:v1:topology';
const SOUND_STORAGE_KEY = 'packetstorm:v1:sound';

interface StoredState {
  activePresetId: string;
  topology: SerializedTopology;
}

export default function App() {
  const engineRef = useRef<SimulationEngine | null>(null);
  if (!engineRef.current) {
    const created = new SimulationEngine();
    // Only restore localStorage if no shared URL token is present in location
    if (!extractShareTokenFromLocation()) {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as StoredState;
          if (parsed?.topology && created.importTopology(parsed.topology)) {
            created.activePresetId = parsed.activePresetId || 'custom';
          }
        }
      } catch {
        // Fall back cleanly to default Doomed Monolith preset
      }
    }
    engineRef.current = created;
  }
  const engine = engineRef.current;

  const [activePresetId, setActivePresetId] = useState<string>(engine.activePresetId);
  const [trafficPattern, setTrafficPattern] = useState<TrafficPattern>(engine.trafficPattern);
  const [trafficIntensityRps, setTrafficIntensityRps] = useState<number>(engine.trafficIntensityRps);
  const [isRunning, setIsRunning] = useState<boolean>(engine.isRunning);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [presetChangeTrigger, setPresetChangeTrigger] = useState<number>(0);
  const [oscilloscopeOpen, setOscilloscopeOpen] = useState<boolean>(true);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState<boolean>(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    try {
      const saved = window.localStorage.getItem(SOUND_STORAGE_KEY);
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });
  const copyTimerRef = useRef<number | null>(null);

  const [metrics, setMetrics] = useState<SimMetrics>(() => engine.getMetrics());
  const [allNodes, setAllNodes] = useState<NodeUiSnapshot[]>(() => engine.getAllNodeSnapshots());
  const [timeSeries, setTimeSeries] = useState<TimeSeriesPoint[]>(() => [...engine.getTimeSeries()]);

  const persistTopology = useCallback(() => {
    try {
      const payload: StoredState = {
        activePresetId: engine.activePresetId,
        topology: engine.exportTopology(),
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage quota errors
    }
  }, [engine]);

  const syncUiTelemetry = useCallback(() => {
    setMetrics({ ...engine.getMetrics() });
    setAllNodes(engine.getAllNodeSnapshots());
    setTimeSeries([...engine.getTimeSeries()]);
  }, [engine]);

  useEffect(() => {
    const timer = window.setInterval(syncUiTelemetry, 200);
    return () => window.clearInterval(timer);
  }, [syncUiTelemetry]);

  useEffect(() => {
    soundEngine.setEnabled(soundEnabled);
    try {
      window.localStorage.setItem(SOUND_STORAGE_KEY, String(soundEnabled));
    } catch {
      // Ignore storage quota errors
    }
  }, [soundEnabled]);

  useEffect(() => {
    const unlockOnGesture = () => {
      soundEngine.unlock();
    };
    window.addEventListener('pointerdown', unlockOnGesture, { passive: true });
    window.addEventListener('keydown', unlockOnGesture, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', unlockOnGesture);
      window.removeEventListener('keydown', unlockOnGesture);
    };
  }, []);

  // Load shared topology from URL (#t=... or ?t=...) on mount and hashchange
  useEffect(() => {
    let cancelled = false;

    const loadFromLocation = async () => {
      const token = extractShareTokenFromLocation();
      if (!token) return;
      const decoded = await decodeTopologyFromToken(token);
      if (cancelled) return;
      if (decoded && engine.importTopology(decoded)) {
        engine.isRunning = true;
        setActivePresetId('custom');
        setTrafficPattern(engine.trafficPattern);
        setTrafficIntensityRps(engine.trafficIntensityRps);
        setIsRunning(true);
        setSelectedNodeId(null);
        setImportError(null);
        setPresetChangeTrigger((c) => c + 1);
        persistTopology();
        syncUiTelemetry();
      } else {
        setImportError('Shared topology link could not be decoded.');
      }
    };

    void loadFromLocation();
    const onHashChange = () => {
      void loadFromLocation();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => {
      cancelled = true;
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [engine, persistTopology, syncUiTelemetry]);

  const copyTextWithFeedback = useCallback((url: string) => {
    const markCopied = () => {
      setShareCopied(true);
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setShareCopied(false), 2500);
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(markCopied).catch(() => {
        try {
          if (document.execCommand('copy')) markCopied();
        } catch {
          // User still has the URL selected inside the popover input
        }
      });
    } else {
      try {
        if (document.execCommand('copy')) markCopied();
      } catch {
        // User still has the URL selected inside the popover input
      }
    }
  }, []);

  const handleShareTopology = useCallback(async () => {
    const topology = engine.exportTopology();
    const token = await encodeTopologyToToken(topology);
    const url = buildShareUrl(token);
    window.history.replaceState(null, '', `#t=${token}`);
    setShareUrl(url);
    copyTextWithFeedback(url);
  }, [engine, copyTextWithFeedback]);

  const handleCopyShareUrl = useCallback(() => {
    if (shareUrl) {
      copyTextWithFeedback(shareUrl);
    }
  }, [shareUrl, copyTextWithFeedback]);

  const handleSelectNode = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    if (nodeId) {
      setMobileInspectorOpen(true);
    }
  }, []);

  const handleSelectPreset = useCallback(
    (presetId: string) => {
      const preset = PRESETS.find((p) => p.id === presetId);
      if (!preset) return;
      engine.loadPreset(preset);
      engine.isRunning = true;
      setActivePresetId(preset.id);
      setTrafficPattern(engine.trafficPattern);
      setTrafficIntensityRps(engine.trafficIntensityRps);
      setIsRunning(true);
      setSelectedNodeId(null);
      setImportError(null);
      setShareUrl(null);
      setShareCopied(false);
      if (window.location.hash || window.location.search) {
        window.history.replaceState(null, '', window.location.pathname);
      }
      setPresetChangeTrigger((c) => c + 1);
      persistTopology();
      syncUiTelemetry();
    },
    [engine, persistTopology, syncUiTelemetry]
  );

  const handleChangePattern = useCallback(
    (pattern: TrafficPattern) => {
      engine.setTrafficPattern(pattern);
      setTrafficPattern(pattern);
      persistTopology();
    },
    [engine, persistTopology]
  );

  const handleChangeIntensity = useCallback(
    (rps: number) => {
      engine.setTrafficIntensity(rps);
      setTrafficIntensityRps(rps);
      persistTopology();
    },
    [engine, persistTopology]
  );

  const handleTogglePlay = useCallback(() => {
    engine.isRunning = !engine.isRunning;
    setIsRunning(engine.isRunning);
  }, [engine]);

  const handleReset = useCallback(() => {
    engine.resetSimulationState();
    syncUiTelemetry();
  }, [engine, syncUiTelemetry]);

  const handleToggleSound = useCallback(() => {
    setSoundEnabled((prev) => {
      const next = !prev;
      soundEngine.setEnabled(next);
      return next;
    });
  }, []);

  const handleUpdateConfig = useCallback(
    (nodeId: string, patch: Partial<SimNodeConfig>) => {
      engine.updateNodeConfig(nodeId, patch);
      persistTopology();
      syncUiTelemetry();
    },
    [engine, persistTopology, syncUiTelemetry]
  );

  const handleUpdateLabel = useCallback(
    (nodeId: string, label: string) => {
      engine.updateNodeLabel(nodeId, label);
      persistTopology();
      syncUiTelemetry();
    },
    [engine, persistTopology, syncUiTelemetry]
  );

  const handleToggleNodeDown = useCallback(
    (nodeId: string) => {
      engine.toggleNodeDown(nodeId);
      syncUiTelemetry();
    },
    [engine, syncUiTelemetry]
  );

  const handleDisconnectNode = useCallback(
    (nodeId: string) => {
      const toRemove = engine.edges
        .filter((e) => e.from === nodeId || e.to === nodeId)
        .map((e) => e.id);
      for (const id of toRemove) {
        engine.removeEdge(id);
      }
      persistTopology();
      syncUiTelemetry();
    },
    [engine, persistTopology, syncUiTelemetry]
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      engine.removeNode(nodeId);
      setSelectedNodeId((prev) => (prev === nodeId ? null : prev));
      persistTopology();
      syncUiTelemetry();
    },
    [engine, persistTopology, syncUiTelemetry]
  );

  const handleTopologyChanged = useCallback(() => {
    setActivePresetId(engine.activePresetId);
    persistTopology();
    syncUiTelemetry();
  }, [engine, persistTopology, syncUiTelemetry]);

  const handleExportTopology = useCallback(() => {
    const payload = engine.exportTopology();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `packetstorm-${engine.activePresetId || 'topology'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [engine]);

  const handleImportTopology = useCallback(
    (jsonText: string) => {
      try {
        const parsed = JSON.parse(jsonText) as SerializedTopology;
        if (engine.importTopology(parsed)) {
          setActivePresetId(engine.activePresetId);
          setTrafficPattern(engine.trafficPattern);
          setTrafficIntensityRps(engine.trafficIntensityRps);
          setSelectedNodeId(null);
          setImportError(null);
          setPresetChangeTrigger((c) => c + 1);
          persistTopology();
          syncUiTelemetry();
        } else {
          setImportError('Invalid topology schema: missing valid nodes or edges.');
        }
      } catch {
        setImportError('Could not parse JSON file. Select a valid PacketStorm export.');
      }
    },
    [engine, persistTopology, syncUiTelemetry]
  );

  const selectedNode = selectedNodeId
    ? allNodes.find((n) => n.id === selectedNodeId) ?? null
    : null;
  const selectedNodeEdgeCount = selectedNodeId
    ? engine.edges.filter((e) => e.from === selectedNodeId || e.to === selectedNodeId).length
    : 0;

  return (
    <div className="h-screen w-screen flex flex-col bg-[#090d16] text-slate-100 overflow-hidden">
      <TopControlBar
        activePresetId={activePresetId}
        trafficPattern={trafficPattern}
        trafficIntensityRps={trafficIntensityRps}
        isRunning={isRunning}
        metrics={metrics}
        onSelectPreset={handleSelectPreset}
        onChangePattern={handleChangePattern}
        onChangeIntensity={handleChangeIntensity}
        onTogglePlay={handleTogglePlay}
        onReset={handleReset}
        soundEnabled={soundEnabled}
        onToggleSound={handleToggleSound}
        shareUrl={shareUrl}
        shareCopied={shareCopied}
        onShareTopology={() => void handleShareTopology()}
        onCopyShareUrl={handleCopyShareUrl}
        onCloseSharePopover={() => setShareUrl(null)}
      />

      <main className="relative flex-1 min-h-0 flex overflow-hidden">
        <div className="relative flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Mobile / Tablet Inspector Drawer Toggle */}
          <button
            type="button"
            onClick={() => setMobileInspectorOpen(true)}
            className="lg:hidden absolute top-4 right-4 z-10 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-[#0d1320]/95 border border-slate-800 rounded-lg shadow-lg cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-cyan-400" />
            <span>Inspector</span>
          </button>

          <SimulatorCanvas
            engine={engine}
            selectedNodeId={selectedNodeId}
            presetChangeTrigger={presetChangeTrigger}
            onSelectNode={handleSelectNode}
            onTopologyChanged={handleTopologyChanged}
          />
          <TelemetryOscilloscope
            series={timeSeries}
            isOpen={oscilloscopeOpen}
            onToggle={() => setOscilloscopeOpen((v) => !v)}
          />
        </div>

        {/* Desktop Fixed Inspector */}
        <div className="hidden lg:flex h-full">
          <InspectorPanel
            selectedNode={selectedNode}
            allNodes={allNodes}
            edges={engine.edges}
            metrics={metrics}
            selectedNodeEdgeCount={selectedNodeEdgeCount}
            importError={importError}
            onDismissImportError={() => setImportError(null)}
            onSelectNode={handleSelectNode}
            onUpdateConfig={handleUpdateConfig}
            onUpdateLabel={handleUpdateLabel}
            onToggleNodeDown={handleToggleNodeDown}
            onDisconnectNode={handleDisconnectNode}
            onDeleteNode={handleDeleteNode}
            onExportTopology={handleExportTopology}
            onImportTopology={handleImportTopology}
          />
        </div>

        {/* Mobile / Tablet Slide-over Inspector */}
        {mobileInspectorOpen && (
          <div className="lg:hidden fixed inset-0 z-30 flex justify-end bg-black/50 backdrop-blur-[1px]">
            <div
              className="flex-1"
              onClick={() => setMobileInspectorOpen(false)}
              aria-hidden="true"
            />
            <InspectorPanel
              selectedNode={selectedNode}
              allNodes={allNodes}
              edges={engine.edges}
              metrics={metrics}
              selectedNodeEdgeCount={selectedNodeEdgeCount}
              importError={importError}
              onDismissImportError={() => setImportError(null)}
              onCloseMobileDrawer={() => setMobileInspectorOpen(false)}
              onSelectNode={handleSelectNode}
              onUpdateConfig={handleUpdateConfig}
              onUpdateLabel={handleUpdateLabel}
              onToggleNodeDown={handleToggleNodeDown}
              onDisconnectNode={handleDisconnectNode}
              onDeleteNode={handleDeleteNode}
              onExportTopology={handleExportTopology}
              onImportTopology={handleImportTopology}
            />
          </div>
        )}
      </main>
    </div>
  );
}
