// Procedural Web Audio API sound engine for PacketStorm simulation feedback.
// Synthesizes low-pitched soft delivery blips and high-pitched digital glitch cues
// with strict rate-limiting and dynamic compression so high RPS never clips.

const LOW_DELIVERY_NOTES_HZ = [146.83, 164.81, 174.61, 196.0]; // D3 - G3 warm low register
const GLITCH_BASE_FREQS_HZ = [1380, 1560, 1780, 2040];

export interface SimulationAudioEvents {
  delivered: number;
  cacheHits: number;
  dropped: number;
}

class ProceduralSoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private enabled = true;
  private lastDeliverySoundMs = 0;
  private lastGlitchSoundMs = 0;
  private deliveryNoteIndex = 0;
  private glitchStepIndex = 0;

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.masterGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(enabled ? 0.22 : 0, now, 0.015);
    }
    if (enabled) {
      this.unlock();
    }
  }

  public unlock(): void {
    if (typeof window === 'undefined' || !this.enabled) return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    if (!this.ctx) {
      try {
        const ctx = new AudioCtx();
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.setValueAtTime(-18, ctx.currentTime);
        compressor.knee.setValueAtTime(12, ctx.currentTime);
        compressor.ratio.setValueAtTime(6, ctx.currentTime);
        compressor.attack.setValueAtTime(0.002, ctx.currentTime);
        compressor.release.setValueAtTime(0.08, ctx.currentTime);

        const master = ctx.createGain();
        master.gain.setValueAtTime(this.enabled ? 0.22 : 0, ctx.currentTime);

        compressor.connect(master);
        master.connect(ctx.destination);

        this.ctx = ctx;
        this.compressor = compressor;
        this.masterGain = master;
        this.noiseBuffer = this.buildNoiseBuffer(ctx);
      } catch {
        return;
      }
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {
        // Ignore if called outside a user gesture
      });
    }
  }

  private buildNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = Math.max(1, Math.floor(ctx.sampleRate * 0.06));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  public processEvents(events: SimulationAudioEvents, nowMs = performance.now()): void {
    if (!this.enabled || !this.ctx || !this.compressor || this.ctx.state !== 'running') {
      return;
    }

    const totalSuccess = events.delivered + events.cacheHits;
    if (totalSuccess > 0 && nowMs - this.lastDeliverySoundMs >= 115) {
      this.lastDeliverySoundMs = nowMs;
      const isCacheDominated = events.cacheHits > events.delivered;
      this.triggerDeliveryBlip(isCacheDominated, totalSuccess);
    }

    if (events.dropped > 0 && nowMs - this.lastGlitchSoundMs >= 95) {
      this.lastGlitchSoundMs = nowMs;
      this.triggerDropGlitch(events.dropped);
    }
  }

  private triggerDeliveryBlip(isCacheHit: boolean, burstCount: number): void {
    const ctx = this.ctx;
    const target = this.compressor;
    if (!ctx || !target) return;

    const now = ctx.currentTime;
    const baseFreq = LOW_DELIVERY_NOTES_HZ[this.deliveryNoteIndex % LOW_DELIVERY_NOTES_HZ.length];
    this.deliveryNoteIndex++;

    // Keep cache-hit blips slightly brighter within the same gentle low register
    const startFreq = isCacheHit ? baseFreq * 1.15 : baseFreq;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq * 1.07, now);
    osc.frequency.exponentialRampToValueAtTime(startFreq * 0.94, now + 0.065);

    const peakGain = Math.min(0.32, 0.19 + Math.min(burstCount, 6) * 0.018);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peakGain, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);

    osc.connect(gain);
    gain.connect(target);

    osc.start(now);
    osc.stop(now + 0.08);
  }

  private triggerDropGlitch(dropCount: number): void {
    const ctx = this.ctx;
    const target = this.compressor;
    if (!ctx || !target) return;

    const now = ctx.currentTime;
    const f1 = GLITCH_BASE_FREQS_HZ[this.glitchStepIndex % GLITCH_BASE_FREQS_HZ.length];
    const f2 = f1 * (this.glitchStepIndex % 2 === 0 ? 1.38 : 0.78);
    const f3 = f1 * 1.18;
    this.glitchStepIndex++;

    // High-pitched stepped square chirp shaped by a bandpass filter for a crisp glitch texture
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(f1, now);
    osc.frequency.setValueAtTime(f2, now + 0.016);
    osc.frequency.setValueAtTime(f3, now + 0.032);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1900, now);
    filter.Q.setValueAtTime(2.2, now);

    const peakGain = Math.min(0.24, 0.14 + Math.min(dropCount, 8) * 0.012);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peakGain, now + 0.002);
    gain.gain.setValueAtTime(peakGain * 0.72, now + 0.024);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.058);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(target);

    osc.start(now);
    osc.stop(now + 0.062);

    // Subtle high-passed micro-noise snap to accentuate the digital error glitch
    if (this.noiseBuffer) {
      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;

      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(2600, now);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.0001, now);
      noiseGain.gain.linearRampToValueAtTime(0.065, now + 0.002);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.034);

      noise.connect(hp);
      hp.connect(noiseGain);
      noiseGain.connect(target);

      noise.start(now);
      noise.stop(now + 0.038);
    }
  }
}

export const soundEngine = new ProceduralSoundEngine();
