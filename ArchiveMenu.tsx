export let sharedAudioContext: AudioContext | null = null;

export function initAudioContext() {
  if (!sharedAudioContext) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    sharedAudioContext = new AudioContextClass();
  }
  if (sharedAudioContext.state === 'suspended') {
    sharedAudioContext.resume().catch(e => console.error("Failed to resume shared AudioContext", e));
  }
  return sharedAudioContext;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  masterGain: GainNode | null = null;
  startTime: number = 0;
  audioBuffer: AudioBuffer | null = null;
  sourceNode: AudioBufferSourceNode | null = null;
  isCustomAudio: boolean = false;
  pausedAt: number = 0;
  isStarted: boolean = false;
  isStopped: boolean = false;
  playbackRate: number = 1.0;

  init() {
    this.ctx = initAudioContext();
    if (!this.masterGain) {
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
    }
  }

  async loadAudio(url: string) {
    if (!this.ctx || !this.masterGain) this.init();
    try {
      const response = await fetch(url, { 
        referrerPolicy: 'no-referrer',
        mode: 'cors',
        cache: 'no-cache'
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      if (this.isStopped) return;
      this.audioBuffer = await this.ctx!.decodeAudioData(arrayBuffer);
      if (this.isStopped) return;
      this.isCustomAudio = true;
    } catch (e) {
      console.error("Failed to load audio", e);
      this.isCustomAudio = false;
    }
  }

  async start(bpm: number, durationSec: number, audioUrl?: string, offset: number = 0) {
    this.isStopped = false;
    if (!this.ctx || !this.masterGain) this.init();
    if (this.ctx!.state === 'suspended') {
      this.ctx!.resume().catch(e => console.error("Failed to resume AudioContext", e));
    }
    
    if (audioUrl && !this.audioBuffer) {
      await this.loadAudio(audioUrl);
    }
    
    if (this.isStopped) return;

    const leadIn = 3.0;
    this.startTime = this.ctx!.currentTime + (leadIn / this.playbackRate) - (offset / this.playbackRate);
    this.pausedAt = offset - leadIn;

    if (this.isCustomAudio && this.audioBuffer) {
      this.sourceNode = this.ctx!.createBufferSource();
      this.sourceNode.buffer = this.audioBuffer;
      this.sourceNode.playbackRate.value = this.playbackRate;
      this.sourceNode.connect(this.masterGain!);
      this.sourceNode.start(this.ctx!.currentTime + (leadIn / this.playbackRate), offset);
    } else {
      const beatDuration = 60 / bpm;
      const limitDuration = Math.min(durationSec, 1200); // Cap metronome at 20 minutes to prevent overloading
      const totalBeats = Math.ceil(limitDuration / beatDuration) + 4;
      const startBeat = Math.floor(offset / beatDuration);
      
      // Schedule the backing track
      for (let i = startBeat; i < totalBeats; i++) {
        const songTime = i * beatDuration;
        const time = this.startTime + (songTime / this.playbackRate);
        if (time < this.ctx!.currentTime) continue;
        
        // Kick on every beat
        this.playKick(time);
        
        // Snare on every off-beat
        if (i % 2 === 1) {
          this.playSnare(time);
        }
        
        // Hi-hats on eighth notes
        this.playHiHat(time);
        this.playHiHat(time + (beatDuration / 2) / this.playbackRate);
      }
    }
    this.isStarted = true;
  }

  pause() {
    if (this.ctx && this.ctx.state === 'running') {
      this.pausedAt = this.ctx.currentTime - this.startTime;
      if (this.sourceNode) {
        this.sourceNode.stop();
        this.sourceNode.disconnect();
        this.sourceNode = null;
      }
      this.ctx.suspend();
    }
  }

  async resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
      if (this.isCustomAudio && this.audioBuffer) {
        this.sourceNode = this.ctx.createBufferSource();
        this.sourceNode.buffer = this.audioBuffer;
        this.sourceNode.playbackRate.value = this.playbackRate;
        this.sourceNode.connect(this.masterGain!);
        
        let offset = this.pausedAt;
        let delay = 0;
        if (offset < 0) {
          delay = -offset / this.playbackRate;
          offset = 0;
        }
        this.sourceNode.start(this.ctx.currentTime + delay, offset);
        this.startTime = this.ctx.currentTime - (this.pausedAt / this.playbackRate);
      }
    }
  }

  stop() {
    this.isStopped = true;
    if (this.sourceNode) {
      try {
        this.sourceNode.stop();
        this.sourceNode.disconnect();
      } catch (e) {}
      this.sourceNode = null;
    }
    if (this.masterGain) {
      this.masterGain.disconnect();
      this.masterGain = null;
    }
    this.audioBuffer = null;
    this.isCustomAudio = false;
    this.isStarted = false;
  }

  getCurrentTime() {
    if (!this.ctx || !this.isStarted) return 0;
    if (this.ctx.state === 'suspended') return this.pausedAt;
    return (this.ctx.currentTime - this.startTime) * this.playbackRate;
  }

  setPlaybackRate(rate: number) {
    const currentTime = this.getCurrentTime();
    this.playbackRate = rate;
    if (this.sourceNode) {
      this.sourceNode.playbackRate.value = rate;
    }
    if (this.ctx && this.isStarted && this.ctx.state !== 'suspended') {
      this.startTime = this.ctx.currentTime - (currentTime / rate);
    }
  }

  getDuration() {
    return this.audioBuffer ? this.audioBuffer.duration : 0;
  }

  setVolume(volume: number) {
    if (!this.ctx || !this.masterGain) this.init();
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(volume, this.ctx!.currentTime, 0.1);
    }
  }

  playKick(time: number) {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.connect(gain);
    gain.connect(this.masterGain!);
    
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.5);
    
    gain.gain.setValueAtTime(0.6, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.5);
    
    osc.start(time);
    osc.stop(time + 0.5);
  }

  playSnare(time: number) {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'triangle';
    osc.connect(gain);
    gain.connect(this.masterGain!);
    
    osc.frequency.setValueAtTime(250, time);
    osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.2);
    
    gain.gain.setValueAtTime(0.4, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.2);
    
    osc.start(time);
    osc.stop(time + 0.2);
  }

  playHiHat(time: number) {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'square';
    osc.connect(gain);
    gain.connect(this.masterGain!);
    
    osc.frequency.setValueAtTime(8000, time);
    
    gain.gain.setValueAtTime(0.1, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.05);
    
    osc.start(time);
    osc.stop(time + 0.05);
  }

  playCountdown(type: '3' | '2' | '1' | 'go', time: number) {
    if (!this.ctx || !this.masterGain) return;
    
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.connect(gain);
    gain.connect(this.masterGain!);
    
    if (type === 'go') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, time);
      osc.frequency.exponentialRampToValueAtTime(880, time + 0.2);
      gain.gain.setValueAtTime(0.5, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.3);
    } else {
      osc.type = 'sine';
      const freq = type === '3' ? 220 : type === '2' ? 247 : 262;
      osc.frequency.setValueAtTime(freq, time);
      gain.gain.setValueAtTime(0.4, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.2);
    }
    
    osc.start(time);
    osc.stop(time + 0.3);
  }

  playMissSound() {
    if (!this.ctx || !this.masterGain) return;
    const time = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'sawtooth';
    osc.connect(gain);
    gain.connect(this.masterGain!);
    
    osc.frequency.setValueAtTime(100, time);
    osc.frequency.linearRampToValueAtTime(50, time + 0.2);
    
    gain.gain.setValueAtTime(0.3, time);
    gain.gain.linearRampToValueAtTime(0.01, time + 0.2);
    
    osc.start(time);
    osc.stop(time + 0.2);
  }
}

export class BGMManager {
  ctx: AudioContext | null = null;
  masterGain: GainNode | null = null;
  
  // Two slots for crossfading
  tracks: {
    [key: string]: {
      source: AudioBufferSourceNode | null;
      gain: GainNode | null;
      buffer: AudioBuffer | null;
      startTime: number;
      pausedAt: number;
      volume: number;
    }
  } = {};

  currentTrackId: string | null = null;
  isMuted: boolean = false;

  init() {
    this.ctx = initAudioContext();
    if (!this.masterGain) {
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
    }
  }

  async loadTrackFromBuffer(id: string, arrayBuffer: ArrayBuffer, volume: number = 0.6) {
    if (!this.ctx) this.init();
    try {
      const buffer = await new Promise<AudioBuffer>((resolve, reject) => {
        this.ctx!.decodeAudioData(arrayBuffer, resolve, reject);
      });

      if (!this.tracks[id]) {
        this.tracks[id] = { source: null, gain: null, buffer: null, startTime: 0, pausedAt: 0, volume };
      }
      this.tracks[id].buffer = buffer;
    } catch (e) {
      console.error(`Failed to load BGM track from buffer: ${id}`, e);
    }
  }

  async loadTrack(id: string, url: string) {
    if (!this.ctx) this.init();
    try {
      const response = await fetch(url, { 
        referrerPolicy: 'no-referrer',
        mode: 'cors',
        cache: 'no-cache'
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      
      // Use the promise-based decodeAudioData
      const buffer = await new Promise<AudioBuffer>((resolve, reject) => {
        this.ctx!.decodeAudioData(arrayBuffer, resolve, reject);
      });

      if (!this.tracks[id]) {
        this.tracks[id] = { source: null, gain: null, buffer: null, startTime: 0, pausedAt: 0, volume: 0.6 };
      }
      this.tracks[id].buffer = buffer;
    } catch (e) {
      console.error(`Failed to load BGM track: ${id}`, e);
    }
  }

  // Crossfade transition
  async play(id: string, fadeTime: number = 1.5) {
    if (!this.ctx) this.init();
    
    // If already playing this track AND it actually has a source node, skip
    if (this.currentTrackId === id && this.tracks[id]?.source) return;

    // Fade in new track
    if (this.tracks[id]) {
      const newTrack = this.tracks[id];
      
      // If no buffer, we can't play (should have preloaded)
      if (!newTrack.buffer) {
        console.warn(`BGM track ${id} not loaded yet.`);
        return;
      }

      const oldTrackId = this.currentTrackId;
      this.currentTrackId = id;

      const now = this.ctx!.currentTime;

      // Fade out old track
      if (oldTrackId && this.tracks[oldTrackId]?.gain) {
        const oldTrack = this.tracks[oldTrackId];
        oldTrack.gain!.gain.setTargetAtTime(0, now, fadeTime / 4);
        
        // Save position for the track
        oldTrack.pausedAt = (now - oldTrack.startTime) % (oldTrack.buffer?.duration || 1);

        setTimeout(() => {
          if (this.currentTrackId !== oldTrackId) {
            this.stopTrack(oldTrackId);
          }
        }, fadeTime * 1000);
      }

      // Create nodes
      newTrack.source = this.ctx!.createBufferSource();
      newTrack.source.buffer = newTrack.buffer;
      newTrack.source.loop = true;
      
      newTrack.gain = this.ctx!.createGain();
      newTrack.gain.gain.setValueAtTime(0, now);
      newTrack.gain.gain.setTargetAtTime(this.isMuted ? 0 : newTrack.volume, now, fadeTime / 4);
      
      newTrack.source.connect(newTrack.gain);
      newTrack.gain.connect(this.masterGain!);

      // State Memory: Resume if we have a saved position
      let offset = 0;
      if (newTrack.pausedAt > 0) {
        offset = newTrack.pausedAt;
      }

      newTrack.source.start(0, offset);
      newTrack.startTime = now - offset;
    }
  }

  stopTrack(id: string) {
    const track = this.tracks[id];
    if (!track) return;
    if (track.source) {
      try {
        track.source.stop();
        track.source.disconnect();
      } catch (e) {}
      track.source = null;
    }
    if (track.gain) {
      track.gain.disconnect();
      track.gain = null;
    }
    if (this.currentTrackId === id) {
      this.currentTrackId = null;
    }
  }

  setMute(muted: boolean) {
    this.isMuted = muted;
    this.updateGains();
  }

  setVolume(volume: number) {
    // Update individual track volumes proportionally or just set master?
    // The user's request implies a global volume setting too.
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(volume, this.ctx!.currentTime, 0.1);
    }
  }

  private updateGains() {
    if (this.currentTrackId && this.tracks[this.currentTrackId]?.gain) {
      const targetVol = this.isMuted ? 0 : this.tracks[this.currentTrackId].volume;
      this.tracks[this.currentTrackId].gain!.gain.setTargetAtTime(targetVol, this.ctx!.currentTime, 0.1);
    }
  }
}

export class SFXManager {
  ctx: AudioContext | null = null;
  masterGain: GainNode | null = null;
  isMuted: boolean = false;
  duckingFactor: number = 1.0;

  init() {
    this.ctx = initAudioContext();
    if (!this.masterGain) {
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
    }
  }

  setMute(muted: boolean) {
    this.isMuted = muted;
  }

  setVolume(volume: number) {
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(volume, this.ctx!.currentTime, 0.1);
    }
  }

  // Ducking: Reduce UI SFX by 20%
  setDucking(isDucking: boolean) {
    this.duckingFactor = isDucking ? 0.8 : 1.0;
  }

  private createGain(volume: number = 1.0) {
    if (!this.ctx || !this.masterGain) this.init();
    const gain = this.ctx!.createGain();
    gain.gain.setValueAtTime(this.isMuted ? 0 : volume * this.duckingFactor, this.ctx!.currentTime);
    gain.connect(this.masterGain!);
    return gain;
  }

  // A. Hover/Select: Electronic Blip
  playHover() {
    if (!this.ctx) this.init();
    const t = this.ctx!.currentTime;
    const osc = this.ctx!.createOscillator();
    const gain = this.createGain(0.15);
    
    // Pitch Variation: +/- 5%
    const baseFreq = 1200;
    const variation = (Math.random() * 0.1 - 0.05) * baseFreq;
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq + variation, t);
    
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.05);
    
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + 0.05);
  }

  // B. Confirm/Click: Digital Impact
  playConfirm() {
    if (!this.ctx) this.init();
    const t = this.ctx!.currentTime;
    
    // Impact part
    const osc = this.ctx!.createOscillator();
    const gain = this.createGain(0.4);
    
    osc.type = 'square';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.1);
    
    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
    
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + 0.2);

    // Mechanical click part
    this.playMechanicalClick(t);
  }

  private playMechanicalClick(t: number) {
    const noise = this.ctx!.createBufferSource();
    const bufferSize = this.ctx!.sampleRate * 0.02;
    const buffer = this.ctx!.createBuffer(1, bufferSize, this.ctx!.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    
    noise.buffer = buffer;
    const filter = this.ctx!.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(2000, t);
    
    const gain = this.createGain(0.1);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.02);
    
    noise.connect(filter);
    filter.connect(gain);
    noise.start(t);
  }

  // C. Open Window: System Expansion
  playOpenModal() {
    if (!this.ctx) this.init();
    const t = this.ctx!.currentTime;
    
    // Digital whoosh
    const noise = this.ctx!.createBufferSource();
    const bufferSize = this.ctx!.sampleRate * 0.4;
    const buffer = this.ctx!.createBuffer(1, bufferSize, this.ctx!.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    
    noise.buffer = buffer;
    const filter = this.ctx!.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(500, t);
    filter.frequency.exponentialRampToValueAtTime(4000, t + 0.3);
    
    const gain = this.createGain(0.2);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.2, t + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.4);
    
    noise.connect(filter);
    filter.connect(gain);
    noise.start(t);

    // Mechanical expansion
    const osc = this.ctx!.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.linearRampToValueAtTime(600, t + 0.3);
    const oscGain = this.createGain(0.1);
    oscGain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
    osc.connect(oscGain);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  // D. Close/Back: Down-tone
  playCloseModal() {
    if (!this.ctx) this.init();
    const t = this.ctx!.currentTime;
    const osc = this.ctx!.createOscillator();
    const gain = this.createGain(0.2);
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, t);
    osc.frequency.exponentialRampToValueAtTime(100, t + 0.3);
    
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
    
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  // Special Editor: Data Sync
  playDataSync() {
    if (!this.ctx) this.init();
    const t = this.ctx!.currentTime;
    
    for (let i = 0; i < 5; i++) {
      const startTime = t + i * 0.05;
      const osc = this.ctx!.createOscillator();
      const gain = this.createGain(0.1);
      
      osc.type = 'square';
      osc.frequency.setValueAtTime(800 + i * 200, startTime);
      
      gain.gain.setValueAtTime(0.1, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.04);
      
      osc.connect(gain);
      osc.start(startTime);
      osc.stop(startTime + 0.04);
    }
  }

  // F. Win Variation (AI-inspired synthesis)
  playWin() {
    if (!this.ctx) this.init();
    const t = this.ctx!.currentTime;
    
    // Triumphant arpeggio
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    notes.forEach((freq, i) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.createGain(0.1);
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, t + i * 0.1);
      gain.gain.setValueAtTime(0, t + i * 0.1);
      gain.gain.linearRampToValueAtTime(0.1, t + i * 0.1 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, t + i * 0.1 + 0.4);
      osc.connect(gain);
      osc.start(t + i * 0.1);
      osc.stop(t + i * 0.1 + 0.4);
    });
  }

  // G. Loss Variation
  playLoss() {
    if (!this.ctx) this.init();
    const t = this.ctx!.currentTime;
    
    const osc = this.ctx!.createOscillator();
    const gain = this.createGain(0.2);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.5);
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.5);
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + 0.5);
  }
}

export const bgmManager = new BGMManager();
export const sfxManager = new SFXManager();
