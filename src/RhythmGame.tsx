import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { AudioEngine } from './audio';
import { GoogleGenAI, Modality } from "@google/genai";

export type Judgements = { sick: number; good: number; bad: number; shit: number; miss: number };

export type StageTheme = {
  bgTop: string;
  bgBottom: string;
  grid: string;
  stage: string;
  particles: 'rain' | 'stars' | 'embers';
};

import { SavedStage, CharacterData, ExtraCharacterData, ModchartTriggerData } from './editor/EditorTypes';
import { Settings, RotateCcw } from 'lucide-react';

interface RhythmGameProps {
  bpm: number;
  duration: number;
  targetNotes?: number;
  scrollSpeed?: number;
  botplay: boolean;
  practiceMode?: boolean;
  playbackRate?: number;
  keys: string[];
  theme: StageTheme;
  customStage?: SavedStage | null;
  onComplete: (score: number, judgements: Judgements, maxCombo: number) => void;
  onGameOver: (score: number, judgements: Judgements, reason: string, maxCombo: number) => void;
  onQuit: () => void;
  onOpenSettings?: () => void;
  onRestart?: () => void;
  volume?: number;
  isFullscreen?: boolean;
}

type Note = {
  id: string;
  time: number;
  lane: number; // 0-3 opponent, 4-7 player
  hit: boolean;
  missed: boolean;
  length: number;
  type?: 'death' | 'caution' | 'black' | 'yellow';
  isHolding?: boolean;
  holdCompleted?: boolean;
  lastHoldTick?: number;
  scrollPosition?: number;
  endScrollPosition?: number;
};

type FloatingText = {
  id: number;
  text: string;
  x: number;
  y: number;
  life: number;
  color: string;
};

const BASE_SCROLL_SPEED = 450;
const DEFAULT_SCROLL_SPEED = 1.0;

const getEffectiveScrollSpeed = (speed: number) => {
  // If speed is > 10, assume it's absolute pixels per second.
  // Otherwise, treat it as a multiplier of BASE_SCROLL_SPEED.
  return speed > 10 ? speed : speed * BASE_SCROLL_SPEED;
};
const TARGET_Y = 100;
const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 576;

const COLORS = ['#c24b99', '#00ffff', '#12fa05', '#f9393f']; // Left, Down, Up, Right
const ARROW_DIRECTIONS = ['left', 'down', 'up', 'right'];

const KEY_MAP: Record<string, number> = {
  ArrowLeft: 0, a: 0,
  ArrowDown: 1, s: 1,
  ArrowUp: 2, w: 2,
  ArrowRight: 3, d: 3,
};

const HIT_WINDOWS = {
  sick: 0.050,
  good: 0.100,
  bad: 0.150,
  shit: 0.200,
};

const CAUTION_HIT_WINDOWS = {
  sick: 0.100,
  good: 0.180,
  bad: 0.250,
  shit: 0.300,
};

const easeInOutQuad = (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
const easeInQuad = (t: number) => t * t;
const easeOutQuad = (t: number) => t * (2 - t);
const linear = (t: number) => t;

const getEasing = (type?: string) => {
  switch (type) {
    case 'easeIn': return easeInQuad;
    case 'easeOut': return easeOutQuad;
    case 'linear': return linear;
    default: return easeInOutQuad;
  }
};

function generateChart(bpm: number, durationSec: number, targetNotes?: number): Note[] {
  const notes: Note[] = [];
  const beatDuration = 60 / bpm;
  const totalBeats = Math.ceil(durationSec / beatDuration);
  
  if (targetNotes) {
    let currentNoteCount = 0;
    let isPlayerTurn = false;
    const resolution = targetNotes > 1500 ? 0.125 : 0.25;

    for (let beat = 4; beat < totalBeats && currentNoteCount < targetNotes; beat += resolution) {
      if (Math.floor(beat) % 8 < 4) {
        isPlayerTurn = false;
      } else {
        isPlayerTurn = true;
      }

      const remainingBeats = totalBeats - beat;
      const remainingNotes = targetNotes - currentNoteCount;
      const spawnProb = remainingNotes / (remainingBeats / resolution);

      const notesToSpawn = Math.min(4, Math.ceil(spawnProb));
      
      for (let i = 0; i < notesToSpawn; i++) {
        if (Math.random() < Math.min(1, spawnProb / notesToSpawn) || spawnProb > 3) {
          const baseLane = isPlayerTurn ? 4 : 0;
          const lane = baseLane + (Math.floor(Math.random() * 4));
          
          notes.push({
            id: `note-${currentNoteCount}-${i}`,
            time: beat * beatDuration,
            lane: lane,
            hit: false,
            missed: false,
            length: 0,
          });
          currentNoteCount++;
          if (currentNoteCount >= targetNotes) break;
        }
      }
    }
  } else {
    let isPlayerTurn = false;
    for (let beat = 4; beat < totalBeats; beat += 1) {
      if (beat % 4 === 0) {
        isPlayerTurn = !isPlayerTurn;
      }
      if (Math.random() > 0.4) {
        const baseLane = isPlayerTurn ? 4 : 0;
        notes.push({
          id: `note-${beat}`,
          time: beat * beatDuration,
          lane: baseLane + Math.floor(Math.random() * 4),
          hit: false,
          missed: false,
          length: 0,
        });
      }
    }
  }
  return notes;
}

export interface RhythmGameRef {
  togglePause: () => void;
}

const RhythmGame = forwardRef<RhythmGameRef, RhythmGameProps>(({ bpm, duration, targetNotes, scrollSpeed = DEFAULT_SCROLL_SPEED, botplay, practiceMode = false, playbackRate = 1, keys, theme, customStage, onComplete, onGameOver, onQuit, onOpenSettings, onRestart, volume = 1, isFullscreen = false }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioEngine = useRef<AudioEngine | null>(null);
  const [isPaused, setIsPaused] = React.useState(false);
  const lastTimeRef = useRef(performance.now());
  const loadedImages = useRef<Record<string, HTMLImageElement>>({});
  const countdownAudioRef = useRef<Record<string, AudioBuffer>>({});
  const countdownPlayedRef = useRef<Set<string>>(new Set());

  const state = useRef({
    notes: [] as Note[],
    actualDuration: duration,
    score: 0,
    health: 50,
    judgements: { sick: 0, good: 0, bad: 0, shit: 0, miss: 0 },
    combo: 0,
    maxCombo: 0,
    comboBreaks: 0,
    totalNotesHit: 0,
    totalNotesPossible: 0,
    nps: 0,
    maxNps: 0,
    npsWindow: [] as number[],
    fps: 60,
    memory: { used: 120, total: 2048 },
    keysPressed: [false, false, false, false],
    opponentKeysPressed: [false, false, false, false],
    floatingTexts: [] as FloatingText[],
    particles: [] as Array<{x: number, y: number, size: number, speed: number, color: string}>,
    isPlaying: false,
    textIdCounter: 0,
    playerPose: 'idle',
    playerPoseTime: 0,
    playerPoseStartTime: 0,
    opponentPose: 'idle',
    opponentPoseTime: 0,
    opponentPoseStartTime: 0,
    isPaused: false,
    events: [] as any[],
    triggeredEvents: new Set<string>(),
    playerOffset: { x: 0, y: 0 },
    opponentOffset: { x: 0, y: 0 },
    basePlayerOffset: { x: 0, y: 0 },
    baseOpponentOffset: { x: 0, y: 0 },
    activeMoveTriggers: [] as any[],
    baseLaneOffsets: Array.from({ length: 8 }).map(() => ({ x: 0, y: 0 })),
    laneOffsets: Array.from({ length: 8 }).map(() => ({ x: 0, y: 0 })),
    laneScales: Array.from({ length: 8 }).fill(1),
    laneAlphas: Array.from({ length: 8 }).fill(1),
    laneRotations: Array.from({ length: 8 }).fill(0),
    screenTilt: 0,
    playerCharacterId: (customStage?.extraCharacters?.find(ec => ec.side === 'player' && ec.showFromStart)?.id) || customStage?.characterPlayer?.name || 'bf',
    opponentCharacterId: (customStage?.extraCharacters?.find(ec => ec.side === 'opponent' && ec.showFromStart)?.id) || customStage?.characterOpponent?.name || 'dad',
    currentBpm: customStage?.chart?.bpm || 120,
    currentScrollSpeed: scrollSpeed,
    baseScrollSpeed: scrollSpeed,
    scrollSpeedEvents: [] as Array<{ time: number, speed: number, pos: number }>,
    lastEvents: {} as Record<string, { name: string, time: number }>,
    cameraShake: null as { intensity: number, endTime: number } | null,
    cameraOffset: { 
      focus: 'center' as 'player' | 'opponent' | 'center',
      currentX: 0,
      currentY: 0,
      currentZoom: 1,
      targetX: 0,
      targetY: 0,
      targetZoom: 1,
      startX: 0,
      startY: 0,
      startZoom: 1,
      startTime: 0,
      endTime: 0,
      type: 'instant' as 'instant' | 'timed'
    },
    cameraZoom: { targetZoom: 1, startZoom: 1, currentZoom: 1, startTime: 0, endTime: 0 } as { targetZoom: number, startZoom: number, currentZoom: number, startTime: number, endTime: number },
    activeCustomEffects: {} as Record<string, {
      effectType: string,
      mode: 'fade_in' | 'fade_out',
      startTime: number,
      duration: number,
      intensity: number,
      currentIntensity: number
    }>,
    fade: null as { 
      type: 'in' | 'out' | 'fade_in' | 'fade_out', 
      startTime: number, 
      endTime: number, 
      startAlpha: number,
      targetAlpha: number,
      color: string 
    } | null,
    currentFadeAlpha: 0,
    currentFadeColor: '#000000',
    flash: null as { intensity: number, startTime: number, fadeInDuration: number, holdDuration: number, fadeOutDuration: number, endTime: number, rainbow: boolean } | null,
    activeShaders: {} as Record<string, {
      intensity: number,
      startTime: number,
      duration: number,
      mode: 'instant' | 'fade_in' | 'fade_out',
      params: any,
      currentIntensity: number,
      isEnding: boolean
    }>,
    activeRotations: {
      player: { 
        self: { angle: 0, startTime: 0, duration: 0, targetAngle: 0, startAngle: 0 },
        orbit: { angle: 0, startTime: 0, duration: 0, targetAngle: 0, startAngle: 0, radius: 0 }
      },
      opponent: { 
        self: { angle: 0, startTime: 0, duration: 0, targetAngle: 0, startAngle: 0 },
        orbit: { angle: 0, startTime: 0, duration: 0, targetAngle: 0, startAngle: 0, radius: 0 }
      },
      notes: { 
        self: { angle: 0, startTime: 0, duration: 0, targetAngle: 0, startAngle: 0 },
        orbit: { angle: 0, startTime: 0, duration: 0, targetAngle: 0, startAngle: 0, radius: 0 }
      },
      background: { 
        self: { angle: 0, startTime: 0, duration: 0, targetAngle: 0, startAngle: 0 },
        orbit: { angle: 0, startTime: 0, duration: 0, targetAngle: 0, startAngle: 0, radius: 0 }
      },
      lanes: Array.from({ length: 8 }).map(() => ({ 
        self: { angle: 0, startTime: 0, duration: 0, targetAngle: 0, startAngle: 0 },
        orbit: { angle: 0, startTime: 0, duration: 0, targetAngle: 0, startAngle: 0, radius: 0 }
      }))
    },
    playerScale: 1,
    opponentScale: 1,
    extraCharacterStates: {} as Record<string, { offset: { x: number, y: number }, scale: number, opacity: number }>,
    characterEdits: [] as Array<{
      target: string;
      startTime: number;
      duration: number;
      startX: number;
      startY: number;
      startScale: number;
      startOpacity: number;
      endX: number;
      endY: number;
      endScale: number;
      endOpacity: number;
      easing: string;
    }>,
    activeOpacities: {
      notes_player: { current: 1, target: 1, startTime: 0, duration: 0, startOpacity: 1 },
      notes_opponent: { current: 1, target: 1, startTime: 0, duration: 0, startOpacity: 1 },
      player: { current: 1, target: 1, startTime: 0, duration: 0, startOpacity: 1 },
      opponent: { current: 1, target: 1, startTime: 0, duration: 0, startOpacity: 1 },
      hp_bar: { current: 1, target: 1, startTime: 0, duration: 0, startOpacity: 1 },
    },
    gameOverReason: null as string | null,
    botplay: botplay,
    practiceMode: practiceMode,
    activeTexts: [] as Array<{
      id: string,
      text: string,
      font: string,
      color: string,
      x: number,
      y: number,
      targetOpacity: number,
      currentOpacity: number,
      startTime: number,
      duration: number,
      mode: 'fade_in' | 'fade_out',
      isRemoving: boolean
    }>,
    activeModcharts: [] as Array<{
      id: string,
      type: string,
      target: 'player' | 'opponent' | 'both' | 'all' | 'lane',
      lanes: number[],
      startTime: number,
      duration: number,
      speed: number,
      intensity: number,
      value: any,
      repeat: number,
      delay: number,
      fadeOut: number,
      easing: string,
      isRemoving: boolean
    }>,
    currentBackground: 'primary' as 'primary' | 'secondary',
    cameraPos: { x: 0, y: 0 },
    isLoading: true,
  });

  useEffect(() => {
    state.current.botplay = botplay;
    state.current.practiceMode = practiceMode;
    const speed = getEffectiveScrollSpeed(scrollSpeed);
    state.current.currentScrollSpeed = speed;
    state.current.baseScrollSpeed = speed;
  }, [botplay, practiceMode, scrollSpeed]);

  useEffect(() => {
    if (audioEngine.current) {
      audioEngine.current.setVolume(volume);
    }
  }, [volume]);

  const togglePause = () => {
    setIsPaused(prev => {
      const next = !prev;
      state.current.isPaused = next;
      if (next) {
        audioEngine.current?.pause();
      } else {
        audioEngine.current?.resume();
        lastTimeRef.current = performance.now();
      }
      return next;
    });
  };

  useImperativeHandle(ref, () => ({
    togglePause
  }));

  useEffect(() => {
    // Reset state for new song or retry
    state.current.judgements = { sick: 0, good: 0, bad: 0, shit: 0, miss: 0 };
    state.current.combo = 0;
    state.current.maxCombo = 0;
    state.current.score = 0;
    state.current.health = 50;
    state.current.totalNotesHit = 0;
    state.current.totalNotesPossible = 0;
    state.current.triggeredEvents.clear();
    state.current.activeMoveTriggers = [];
    state.current.baseLaneOffsets = Array.from({ length: 8 }).map(() => ({ x: 0, y: 0 }));
    state.current.activeTexts = [];
    state.current.activeShaders = {};
    state.current.lastEvents = {};
    state.current.cameraShake = { intensity: 0, endTime: 0 };
    state.current.cameraOffset = { 
      focus: 'center',
      currentX: 0,
      currentY: 0,
      currentZoom: 1,
      targetX: 0,
      targetY: 0,
      targetZoom: 1,
      startX: 0,
      startY: 0,
      startZoom: 1,
      startTime: 0,
      endTime: 0,
      type: 'instant'
    };
    state.current.cameraZoom = { targetZoom: 1, startZoom: 1, currentZoom: 1, startTime: 0, endTime: 0 };
    state.current.activeCustomEffects = {};
    state.current.fade = null;
    state.current.flash = null;
    state.current.currentFadeAlpha = 0;
    state.current.currentBackground = 'primary';
    state.current.cameraPos = { x: 0, y: 0 };
    state.current.isLoading = true;
    state.current.extraCharacterStates = {};
    state.current.characterEdits = [];
    state.current.playerPose = 'idle';
    state.current.opponentPose = 'idle';
    state.current.keysPressed = [false, false, false, false];
    state.current.opponentKeysPressed = [false, false, false, false];
    const initialSpeed = getEffectiveScrollSpeed(scrollSpeed);
    state.current.currentScrollSpeed = initialSpeed;
    state.current.baseScrollSpeed = initialSpeed;
    state.current.currentBpm = customStage?.chart?.bpm || bpm || 120;
    state.current.activeOpacities = {
      player: { current: 1, startOpacity: 1, target: 1, startTime: 0, duration: 0 },
      opponent: { current: 1, startOpacity: 1, target: 1, startTime: 0, duration: 0 },
      notes_player: { current: 1, startOpacity: 1, target: 1, startTime: 0, duration: 0 },
      notes_opponent: { current: 1, startOpacity: 1, target: 1, startTime: 0, duration: 0 },
      hp_bar: { current: 1, startOpacity: 1, target: 1, startTime: 0, duration: 0 },
    };
    state.current.activeRotations = {
      player: { 
        self: { angle: 0, startTime: 0, duration: 0, targetAngle: 0, startAngle: 0 },
        orbit: { angle: 0, startTime: 0, duration: 0, targetAngle: 0, startAngle: 0, radius: 0 }
      },
      opponent: { 
        self: { angle: 0, startTime: 0, duration: 0, targetAngle: 0, startAngle: 0 },
        orbit: { angle: 0, startTime: 0, duration: 0, targetAngle: 0, startAngle: 0, radius: 0 }
      },
      notes: { 
        self: { angle: 0, startTime: 0, duration: 0, targetAngle: 0, startAngle: 0 },
        orbit: { angle: 0, startTime: 0, duration: 0, targetAngle: 0, startAngle: 0, radius: 0 }
      },
      background: { 
        self: { angle: 0, startTime: 0, duration: 0, targetAngle: 0, startAngle: 0 },
        orbit: { angle: 0, startTime: 0, duration: 0, targetAngle: 0, startAngle: 0, radius: 0 }
      },
      lanes: Array.from({ length: 8 }).map(() => ({ 
        self: { angle: 0, startTime: 0, duration: 0, targetAngle: 0, startAngle: 0 },
        orbit: { angle: 0, startTime: 0, duration: 0, targetAngle: 0, startAngle: 0, radius: 0 }
      }))
    };

    let startOffset = 0;
    if (customStage && customStage.chart) {
      // Calculate exact time for each step considering BPM changes
      const bpmChanges = (customStage.chart.events || [])
        .filter(e => e.type === 'bpm_change')
        .sort((a, b) => a.step - b.step);
        
      const getStepTime = (targetStep: number) => {
        let time = 0;
        let currentStep = 0;
        let currentBpm = customStage.chart?.bpm || 120;
        
        for (const change of bpmChanges) {
          if (change.step >= targetStep) break;
          const stepsInThisBpm = change.step - currentStep;
          time += stepsInThisBpm * (60 / currentBpm / 4);
          currentStep = change.step;
          currentBpm = change.value.bpm;
        }
        
        const remainingSteps = targetStep - currentStep;
        time += (remainingSteps || 0) * (60 / currentBpm / 4);
        return time;
      };

      // Pre-calculate scroll speed changes
      const scrollSpeedEvents = (customStage.chart.events || [])
        .filter(e => e.type === 'scroll_speed')
        .map(e => ({ time: getStepTime(e.step || 0), speed: getEffectiveScrollSpeed((e.value.speed || 1) * scrollSpeed) }))
        .sort((a, b) => a.time - b.time);

      const calculatedSpeedEvents = [];
      let currentPos = 0;
      let lastTime = 0;
      let currentSpeed = getEffectiveScrollSpeed(scrollSpeed);

      calculatedSpeedEvents.push({ time: 0, speed: currentSpeed, pos: 0 });

      for (const event of scrollSpeedEvents) {
        currentPos += (event.time - lastTime) * currentSpeed;
        lastTime = event.time;
        currentSpeed = event.speed;
        calculatedSpeedEvents.push({ time: event.time, speed: currentSpeed, pos: currentPos });
      }
      state.current.scrollSpeedEvents = calculatedSpeedEvents;

      const getScrollPosition = (time: number) => {
        let lastEvent = calculatedSpeedEvents[0];
        for (let i = 1; i < calculatedSpeedEvents.length; i++) {
          if (calculatedSpeedEvents[i].time > time) break;
          lastEvent = calculatedSpeedEvents[i];
        }
        return lastEvent.pos + (time - lastEvent.time) * lastEvent.speed;
      };

      state.current.notes = (customStage.chart?.notes || []).map((n, i) => {
        const time = getStepTime(n.step || 0);
        const endTime = (n.length || 0) > 0 ? getStepTime((n.step || 0) + n.length) : time;
        return {
          id: `custom-note-${i}`,
          time,
          lane: n.lane || 0,
          hit: false,
          missed: false,
          type: n.type as any,
          length: endTime - time,
          scrollPosition: getScrollPosition(time),
          endScrollPosition: (n.length || 0) > 0 ? getScrollPosition(endTime) : undefined
        };
      }).sort((a, b) => a.time - b.time);

      // Pre-calculate event times
      const baseEvents = (customStage.chart?.events || []).map(e => ({
        ...e,
        time: getStepTime(e.step || 0)
      }));

      const maxNoteStep = (customStage.chart?.notes || []).reduce((max, n) => Math.max(max, (n.step || 0) + (n.length || 0)), 0);
      const maxEventStep = (customStage.chart?.events || []).reduce((max, e) => Math.max(max, e.step || 0), 0);
      const maxStep = Math.max(maxNoteStep, maxEventStep, 100);

      const loopedEvents: any[] = [];
      baseEvents.forEach(e => {
        if (e.type === 'loop') {
          const eventsToLoop = baseEvents.filter(ev => e.value.events?.includes(ev.id));
          // Find the stop_loop that specifically targets this loop ID
          const stopLoop = baseEvents.find(ev => 
            ev.type === 'stop_loop' && 
            ev.value.loopEventId === e.id && 
            ev.step > e.step
          );
          
          const endStep = stopLoop ? stopLoop.step : maxStep + 200; // Loop until stop_loop or a bit past end of song
          
          let i = 1;
          while (true) {
            let addedAny = false;
            eventsToLoop.forEach(ev => {
              const newStep = ev.step + i * e.value.interval;
              if (newStep < endStep) { // Stop BEFORE the stop loop step
                loopedEvents.push({
                  ...ev,
                  id: `${ev.id}-loop-${e.id}-${i}`,
                  step: newStep,
                  time: getStepTime(newStep)
                });
                addedAny = true;
              }
            });
            if (!addedAny) break;
            i++;
            if (i > 2000) break; // Safety break to prevent infinite pre-calculation
          }
        }
      });

      let allEvents = [...baseEvents, ...loopedEvents].sort((a, b) => a.time - b.time);

      state.current.events = allEvents;

      // Load custom stage images
      const loadImg = (src: string) => {
        if (!src || loadedImages.current[src]) return;
        const img = new Image();
        img.src = src;
        loadedImages.current[src] = img;
      };

      const loadChar = (char: CharacterData) => {
        if (char.image) loadImg(char.image);
        char.animations.forEach(anim => {
          if (anim.image) loadImg(anim.image);
          if (anim.image2) loadImg(anim.image2);
        });
        if (char.healthIcons) {
          if (char.healthIcons.normal) loadImg(char.healthIcons.normal);
          if (char.healthIcons.win) loadImg(char.healthIcons.win);
          if (char.healthIcons.lose) loadImg(char.healthIcons.lose);
        }
        if (char.customNotes) {
          if (char.customNotes.falling) loadImg(char.customNotes.falling);
          if (char.customNotes.hit) loadImg(char.customNotes.hit);
          if (char.customNotes.specialFalling) loadImg(char.customNotes.specialFalling);
          if (char.customNotes.specialHit) loadImg(char.customNotes.specialHit);
        }
      };

      if (customStage.characterPlayer) loadChar(customStage.characterPlayer);
      if (customStage.characterOpponent) loadChar(customStage.characterOpponent);
      if (customStage.extraCharacters) {
        customStage.extraCharacters.forEach(ec => loadChar(ec.character));
      }

      if (customStage.stage && customStage.stage.layers) {
        customStage.stage.layers.forEach(layer => {
          if (layer.image) loadImg(layer.image);
        });
      }
      if (customStage.stage && customStage.stage.secondaryLayers) {
        customStage.stage.secondaryLayers.forEach(layer => {
          if (layer.image) loadImg(layer.image);
        });
      }

      const startPoint = (customStage.chart?.events || []).find(e => e.type === 'start_point');
      if (startPoint) {
        startOffset = getStepTime(startPoint.step);
        
        // Mark previous notes as hit so they don't trigger misses
        state.current.notes.forEach(note => {
          if (note.time < startOffset) {
            note.hit = true;
          }
        });

        // Fast-forward events before countdown
        const countdownStartTime = startOffset - 3.0;
        allEvents.forEach(event => {
          if (event.time < countdownStartTime) {
            state.current.triggeredEvents.add(event.id);
            
            // Apply persistent state changes
            if (event.type === 'bpm_change') {
              state.current.currentBpm = event.value.bpm;
            } else if (event.type === 'character_swap') {
              if (event.value.target === 'player') {
                state.current.playerCharacterId = event.value.characterId;
              } else if (event.value.target === 'opponent') {
                state.current.opponentCharacterId = event.value.characterId;
              }
            } else if (event.type === 'camera_zoom') {
              state.current.cameraZoom.targetZoom = event.value.zoom || 1;
              state.current.cameraZoom.currentZoom = event.value.zoom || 1;
              state.current.cameraZoom.startZoom = event.value.zoom || 1;
            } else if (event.type === 'scroll_speed') {
              state.current.currentScrollSpeed = getEffectiveScrollSpeed((event.value.speed || 1) * scrollSpeed);
            } else if (event.type === 'background_swap') {
              const swapTo = event.value.swapTo || 'toggle';
              if (swapTo === 'primary') {
                state.current.currentBackground = 'primary';
              } else if (swapTo === 'secondary') {
                state.current.currentBackground = 'secondary';
              } else {
                state.current.currentBackground = state.current.currentBackground === 'primary' ? 'secondary' : 'primary';
              }
            } else if (event.type === 'opacity') {
              const { target, opacity } = event.value;
              let targets: string[] = [];
              if (target === 'all') targets = ['player', 'opponent', 'notes_player', 'notes_opponent', 'hp_bar'];
              else if (target === 'notes') targets = ['notes_player', 'notes_opponent'];
              else if (target === 'characters') targets = ['player', 'opponent'];
              else if (target === 'player') targets = ['player', 'notes_player'];
              else if (target === 'opponent') targets = ['opponent', 'notes_opponent'];
              else targets = [target];
              
              targets.forEach(t => {
                if (state.current.activeOpacities[t]) {
                  state.current.activeOpacities[t].current = opacity;
                  state.current.activeOpacities[t].target = opacity;
                }
              });
            } else if (event.type === 'rotate') {
              const { target, rotations, isRelative, lanes, rotationMode, orbitRadius } = event.value;
              const targetAngle = (rotations || 0) * Math.PI * 2;
              const targetLanes = (lanes && lanes.length > 0) ? lanes : 
                                 (target === 'player_notes' ? [4, 5, 6, 7] : 
                                 (target === 'opponent_notes' ? [0, 1, 2, 3] : 
                                 (target === 'lane' ? [event.value.lane || 0] : [])));
              
              const mode = rotationMode === 'orbit' ? 'orbit' : 'self';
              
              if (targetLanes.length > 0) {
                targetLanes.forEach((lane: number) => {
                  if (state.current.activeRotations.lanes[lane]) {
                    const rot = state.current.activeRotations.lanes[lane][mode];
                    const currentAngle = rot.angle;
                    const newAngle = isRelative ? currentAngle + targetAngle : targetAngle;
                    rot.angle = newAngle;
                    rot.startAngle = newAngle;
                    rot.targetAngle = newAngle;
                    rot.duration = 0;
                    if (mode === 'orbit') {
                      rot.radius = orbitRadius !== undefined ? orbitRadius : (rot.radius || 0);
                    }
                  }
                });
              } else {
                const targets = target === 'all' ? ['player', 'opponent', 'notes', 'background'] : (target === 'both' ? ['player', 'opponent'] : [target]);
                targets.forEach(t => {
                  const targetRot = state.current.activeRotations[t as keyof typeof state.current.activeRotations];
                  if (targetRot && typeof targetRot === 'object' && !Array.isArray(targetRot)) {
                    const rot = (targetRot as any)[mode];
                    if (rot) {
                      const currentAngle = rot.angle;
                      const newAngle = isRelative ? currentAngle + targetAngle : targetAngle;
                      rot.angle = newAngle;
                      rot.startAngle = newAngle;
                      rot.targetAngle = newAngle;
                      rot.duration = 0;
                      if (mode === 'orbit') {
                        rot.radius = orbitRadius !== undefined ? orbitRadius : (rot.radius || 0);
                      }
                    }
                  }
                });
                if (target === 'all') {
                  for (let i = 0; i < 8; i++) {
                    const rot = state.current.activeRotations.lanes[i][mode];
                    const currentAngle = rot.angle;
                    const newAngle = isRelative ? currentAngle + targetAngle : targetAngle;
                    rot.angle = newAngle;
                    rot.startAngle = newAngle;
                    rot.targetAngle = newAngle;
                    rot.duration = 0;
                    if (mode === 'orbit') {
                      rot.radius = orbitRadius !== undefined ? orbitRadius : (rot.radius || 0);
                    }
                  }
                }
              }
            } else if (event.type === 'move') {
              const { target, x, y, lanes, relative } = event.value;
              const isRelative = relative || false;
              const targetLanes = (lanes && lanes.length > 0) ? lanes : 
                                 (target === 'player_notes' ? [4, 5, 6, 7] : 
                                 (target === 'opponent_notes' ? [0, 1, 2, 3] : []));
              
              if (targetLanes.length > 0) {
                targetLanes.forEach((lane: number) => {
                  if (isRelative) {
                    state.current.baseLaneOffsets[lane].x += x;
                    state.current.baseLaneOffsets[lane].y += y;
                  } else {
                    state.current.baseLaneOffsets[lane].x = x;
                    state.current.baseLaneOffsets[lane].y = y;
                  }
                });
              } else {
                const targets = target === 'both' ? ['player', 'opponent'] : [target];
                targets.forEach(t => {
                  if (t === 'player') {
                    if (isRelative) {
                      state.current.playerOffset.x += x;
                      state.current.playerOffset.y += y;
                    } else {
                      state.current.playerOffset.x = x;
                      state.current.playerOffset.y = y;
                    }
                  } else if (t === 'opponent') {
                    if (isRelative) {
                      state.current.opponentOffset.x += x;
                      state.current.opponentOffset.y += y;
                    } else {
                      state.current.opponentOffset.x = x;
                      state.current.opponentOffset.y = y;
                    }
                  } else if (t === 'lane') {
                    const lane = event.value.lane || 0;
                    if (isRelative) {
                      state.current.baseLaneOffsets[lane].x += x;
                      state.current.baseLaneOffsets[lane].y += y;
                    } else {
                      state.current.baseLaneOffsets[lane].x = x;
                      state.current.baseLaneOffsets[lane].y = y;
                    }
                  }
                });
              }
            }
          }
        });
      }

    } else {
      const baseSpeed = getEffectiveScrollSpeed(scrollSpeed);
      state.current.notes = generateChart(bpm, duration, targetNotes).map(n => ({
        ...n,
        scrollPosition: n.time * baseSpeed,
        endScrollPosition: (n.time + (n.length || 0)) * baseSpeed
      }));
    }
    state.current.isPlaying = true;
    
    let actualDuration = duration;
    if (customStage) {
      const lastNoteTime = state.current.notes.length > 0 
        ? state.current.notes[state.current.notes.length - 1].time + (state.current.notes[state.current.notes.length - 1].length || 0)
        : 0;
      const lastEventTime = state.current.events.length > 0
        ? state.current.events[state.current.events.length - 1].time
        : 0;
      actualDuration = Math.max(lastNoteTime, lastEventTime, 1);
    }
    state.current.actualDuration = actualDuration;

    // Initialize particles based on theme
    state.current.particles = Array.from({ length: 100 }).map(() => ({
      x: Math.random() * CANVAS_WIDTH + (theme.particles === 'rain' ? 200 : 0),
      y: Math.random() * CANVAS_HEIGHT,
      size: Math.random() * 3 + 1,
      speed: Math.random() * 5 + 2,
      color: theme.particles === 'embers' ? '#ff8800' : theme.particles === 'rain' ? '#00ffff' : '#ffffff'
    }));

    audioEngine.current = new AudioEngine();
    audioEngine.current.playbackRate = playbackRate;
    
    let isUnmounted = false;
    let animationFrameId: number;

    const startAudioAndLoop = async () => {
      countdownPlayedRef.current.clear();
      state.current.isLoading = true;
      try {
        await audioEngine.current?.start(bpm, state.current.actualDuration, customStage?.audioUrl, startOffset);
        
        // Update actual duration from audio if it's longer
        const audioDuration = audioEngine.current?.getDuration() || 0;
        if (audioDuration > state.current.actualDuration) {
          state.current.actualDuration = audioDuration;
        }
      } catch (e) {
        console.error("Failed to start audio engine:", e);
      }
      if (isUnmounted) return;
      state.current.isLoading = false;
      
      // Pre-process step 0 triggers
      state.current.events.forEach(event => {
        if (event.time <= 0 && !state.current.triggeredEvents.has(event.id)) {
          // We trigger them manually here so they are active during countdown
          // But we don't mark them as triggered yet if they are timed? 
          // Actually, for instant ones, we should trigger them now.
          // For timed ones, they will start when currentTime reaches event.time.
          // The user specifically wants Fade and Character Edit at step 0 to be active.
          if (event.type === 'fade' || event.type === 'character_edit' || event.type === 'opacity') {
            // Process these immediately
            // I'll call a helper or just let the loop handle it by ensuring currentTime starts at -3.0
          }
        }
      });

      lastTimeRef.current = performance.now();
      animationFrameId = requestAnimationFrame(loop);
    };

    const loop = (time: number) => {
      if (isUnmounted) return;
      
      const deltaTime = (time - lastTimeRef.current) / 1000;
      lastTimeRef.current = time;

      if (!state.current.isPaused) {
        updateAndDraw(deltaTime);
      }
      
      if (state.current.isPlaying) {
        animationFrameId = requestAnimationFrame(loop);
      }
    };

    startAudioAndLoop();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === 'Escape' || e.key === 'Enter') {
        if (state.current.isPaused) {
          if (e.key === 'Escape') onQuit();
          else togglePause(); // Enter resumes if paused
        } else {
          togglePause();
        }
        return;
      }
      if (state.current.isPaused || state.current.botplay) return;

      let laneIdx = keys.findIndex(k => k.toLowerCase() === e.key.toLowerCase());
      if (laneIdx === -1) {
        const arrowMap: Record<string, number> = { ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3 };
        laneIdx = arrowMap[e.key] ?? -1;
      }

      if (laneIdx !== -1) {
        state.current.keysPressed[laneIdx] = true;
        handleHit(laneIdx);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (state.current.botplay) return;
      let laneIdx = keys.findIndex(k => k.toLowerCase() === e.key.toLowerCase());
      if (laneIdx === -1) {
        const arrowMap: Record<string, number> = { ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3 };
        laneIdx = arrowMap[e.key] ?? -1;
      }
      if (laneIdx !== -1) {
        state.current.keysPressed[laneIdx] = false;
        
        // Handle releasing hold notes
        if (audioEngine.current) {
          const currentTime = audioEngine.current.getCurrentTime();
          const noteLane = laneIdx + 4;
          const heldNote = state.current.notes.find(n => n.lane === noteLane && n.isHolding && !n.holdCompleted);
          
          if (heldNote) {
            heldNote.isHolding = false;
            const holdEndTime = heldNote.time + heldNote.length;
            
            // If released too early, it's a miss for the hold part
            const windows = heldNote.type === 'caution' ? CAUTION_HIT_WINDOWS : HIT_WINDOWS;
            if (currentTime < holdEndTime - windows.good) {
              heldNote.missed = true; // Mark as missed to stop drawing/processing
              
              if (heldNote.type === 'caution') {
                if (!state.current.practiceMode) state.current.health = 0; // Fatal release
                spawnText('FATAL RELEASE!', getLaneX(heldNote.lane), getLaneY(heldNote.lane, TARGET_Y) + 50, '#ff0000');
              } else {
                if (!state.current.practiceMode) state.current.health = Math.max(0, state.current.health - 5);
                spawnText('MISS', getLaneX(heldNote.lane), getLaneY(heldNote.lane, TARGET_Y) + 50, '#ff0000');
              }
              
              state.current.judgements.miss++;
              // totalNotesPossible was already incremented when the hold started in handleHit
              state.current.playerPose = 'miss';
              state.current.playerPoseTime = 0.4;
              state.current.playerPoseStartTime = performance.now();
              audioEngine.current!.playMissSound();

              if (!state.current.practiceMode) {
                state.current.combo = 0;
                state.current.comboBreaks++;
              }
            } else {
              heldNote.holdCompleted = true;
              if (!state.current.practiceMode) {
                state.current.score += 100; // Bonus for completing hold
                state.current.health = Math.min(100, state.current.health + 2);
              }
            }
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      isUnmounted = true;
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (audioEngine.current) {
        audioEngine.current.stop();
      }
    };
  }, []);

  const handleHit = (lane: number) => {
    if (!audioEngine.current || state.current.botplay) return;
    const currentTime = audioEngine.current.getCurrentTime();
    
    const noteLane = lane + 4; // Player lanes are 4-7
    
    // Find the closest note in this lane that hasn't been hit yet
    // We include "missed" notes in the search to allow for a small grace period
    let note: Note | null = null;
    let minDiff = Infinity;
    
    for (let i = 0; i < state.current.notes.length; i++) {
      const n = state.current.notes[i];
      // Optimization: notes are sorted by time, so we can stop searching if we're too far ahead
      if (n.time > currentTime + 0.5) break;
      
      if (n.lane === noteLane && !n.hit) {
        const diff = Math.abs(n.time - currentTime);
        if (diff < minDiff) {
          minDiff = diff;
          note = n;
        }
      }
    }

    if (note) {
      const diff = Math.abs(note.time - currentTime);
      const windows = note.type === 'caution' ? CAUTION_HIT_WINDOWS : HIT_WINDOWS;
      
      if (diff <= windows.shit) {
        // If it was marked as missed but we hit it within the window, un-miss it
        if (note.missed) {
          note.missed = false;
          state.current.judgements.miss--;
          // Don't increment totalNotesPossible again below
        } else {
          state.current.totalNotesPossible++;
        }
        
        // Special note hit logic
        if (note.type === 'death') {
          if (!state.current.practiceMode) state.current.health = 0; // Fatal hit
          spawnText('DEATH!', getLaneX(noteLane), getLaneY(noteLane, TARGET_Y), '#ff0000');
          note.hit = true;
          
          // Trigger game over immediately
          if (!state.current.practiceMode) {
            state.current.isPlaying = false;
            audioEngine.current.stop();
            state.current.gameOverReason = 'You have pressed death notes.';
            onGameOver(state.current.score, state.current.judgements, state.current.gameOverReason, state.current.maxCombo);
          }
          return;
        } else if (note.type === 'black') {
          if (!state.current.practiceMode) {
            state.current.health = Math.max(0, state.current.health - 10); // Damage hit
            state.current.combo = 0;
          }
          state.current.judgements.miss++;
          spawnText('POISON!', getLaneX(noteLane), getLaneY(noteLane, TARGET_Y), '#000000');
          note.hit = true;
          audioEngine.current.playMissSound();
          return;
        }

        note.hit = true;
        if (note.length > 0) {
          note.isHolding = true;
        } else {
          note.holdCompleted = true;
        }
        state.current.playerPose = ARROW_DIRECTIONS[lane];
        state.current.playerPoseTime = 0.4;
        state.current.playerPoseStartTime = performance.now();

        let judgement = 'SHIT';
        let color = '#a0522d';
        let scoreAdd = 50;
        let healthAdd = 0; // SHIT: no HP gain, no HP loss

        if (diff <= windows.sick) {
          judgement = 'SICK!';
          color = '#00ffff';
          scoreAdd = 350;
          healthAdd = 2;
          state.current.judgements.sick++;
        } else if (diff <= windows.good) {
          judgement = 'GOOD';
          color = '#12fa05';
          scoreAdd = 200;
          healthAdd = 1;
          state.current.judgements.good++;
        } else if (diff <= windows.bad) {
          judgement = 'BAD';
          color = '#c24b99';
          scoreAdd = 100;
          healthAdd = 0.5; // BAD: now increases HP
          state.current.judgements.bad++;
        } else {
          state.current.judgements.shit++; // Correctly increment SHIT instead of miss
        }

        if (!state.current.practiceMode) {
          state.current.combo++;
          if (state.current.combo > state.current.maxCombo) {
            state.current.maxCombo = state.current.combo;
          }
        }

        if (!state.current.practiceMode) {
          state.current.score += scoreAdd;
          state.current.health = Math.min(100, state.current.health + healthAdd);
        }
        state.current.totalNotesHit++;
        state.current.npsWindow.push(currentTime);

        spawnText(judgement, getLaneX(noteLane), getLaneY(noteLane, TARGET_Y), color);
      } else {
        // Ghost tap visual feedback only - no audio miss sound as requested
        if (!practiceMode) {
          state.current.playerPose = 'miss';
          state.current.playerPoseTime = 0.2; // Slightly shorter pose for ghost taps
          state.current.playerPoseStartTime = performance.now();
          // Removed playMissSound() call for ghost taps
        }
      }
    }
  };

  const spawnText = (text: string, x: number, y: number, color: string) => {
    state.current.floatingTexts.push({
      id: state.current.textIdCounter++,
      text,
      x,
      y,
      life: 1.0,
      color
    });
  };

  const getLaneX = (lane: number) => {
    const laneWidth = 70;
    const laneOffset = state.current.laneOffsets[lane] || { x: 0, y: 0 };
    const scale = state.current.laneScales[lane] || 1;
    
    if (lane < 4) {
      // Opponent (left side)
      const startX = 80;
      return startX + lane * laneWidth * scale + laneOffset.x;
    } else {
      // Player (right side)
      const startX = CANVAS_WIDTH - 80 - (3 * laneWidth * scale);
      return startX + (lane - 4) * laneWidth * scale + laneOffset.x;
    }
  };

  const getLaneY = (lane: number, baseTargetY: number) => {
    const laneOffset = state.current.laneOffsets[lane] || { x: 0, y: 0 };
    return baseTargetY + laneOffset.y;
  };

  const playVoice = (word: string) => {
    // Use built-in synth beeps instead of Gemini TTS to avoid quota issues
    audioEngine.current?.playCountdown(word as any, audioEngine.current.ctx?.currentTime || 0);
  };

  const drawStage = (ctx: CanvasRenderingContext2D, beatBounce: number, theme: StageTheme, combo: number, currentTime: number, customStage?: SavedStage | null, cameraPos?: { x: number, y: number }) => {
    // Always draw a base background to prevent black screen while layers load
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    grad.addColorStop(0, theme.bgTop);
    grad.addColorStop(1, theme.bgBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const layers = customStage && customStage.stage 
      ? (state.current.currentBackground === 'primary' ? (customStage.stage.layers || []) : (customStage.stage.secondaryLayers || []))
      : [];

    const sortedLayers = [...layers].sort((a, b) => a.zIndex - b.zIndex);

    // Draw layers with zIndex < 0 (Behind the stage)
    sortedLayers.filter(l => l.zIndex < 0).forEach(layer => {
      if (!layer.image) return;
      const img = loadedImages.current[layer.image];
      if (img && img.complete) {
        ctx.save();
        // Center the layer by default to match editor
        ctx.translate(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
        if (cameraPos) {
          ctx.translate(cameraPos.x * (1 - (layer.scrollFactor || 1)), cameraPos.y * (1 - (layer.scrollFactor || 1)));
        }
        ctx.translate(layer.position.x, layer.position.y);
        ctx.scale(layer.scale * (layer.flipX ? -1 : 1), layer.scale * (layer.flipY ? -1 : 1));
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        ctx.restore();
      }
    });

    const intensity = Math.min(1, combo / 50);
    
    // Pulse the background slightly with the beat
    ctx.fillStyle = `rgba(255, 255, 255, ${beatBounce * 0.05 + intensity * 0.05})`;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    if (!customStage) {
      // Vignette
      const vignette = ctx.createRadialGradient(
        CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, CANVAS_HEIGHT * 0.2,
        CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, CANVAS_HEIGHT * 0.8
      );
      vignette.addColorStop(0, 'rgba(0,0,0,0)');
      vignette.addColorStop(1, 'rgba(0,0,0,0.6)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Grid lines
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 2 + beatBounce * 2;
      ctx.globalAlpha = 0.3 + intensity * 0.2;
      
      ctx.beginPath();
      // Perspective grid
      const centerX = CANVAS_WIDTH / 2;
      const horizonY = CANVAS_HEIGHT * 0.4;
      
      for (let i = -10; i <= 10; i++) {
        ctx.moveTo(centerX + i * 40, horizonY);
        ctx.lineTo(centerX + i * 200, CANVAS_HEIGHT);
      }
      
      // Horizontal lines moving towards player
      const speed = 2;
      const offset = (currentTime * speed) % 1;
      
      let y = horizonY;
      let gap = 10;
      
      // Apply offset to the first gap to create continuous movement
      gap *= (1 + offset * 0.2);
      
      while (y < CANVAS_HEIGHT) {
        ctx.moveTo(0, y);
        ctx.lineTo(CANVAS_WIDTH, y);
        y += gap;
        gap *= 1.2;
      }
      ctx.stroke();
      ctx.globalAlpha = 1.0;

      // Stage floor
      const stageY = CANVAS_HEIGHT - 150 + beatBounce * 10;
      ctx.fillStyle = '#18181b';
      ctx.beginPath();
      ctx.ellipse(CANVAS_WIDTH / 2, stageY, 400, 100, 0, 0, Math.PI * 2);
      ctx.fill();
      
      // Stage glow
      ctx.shadowColor = theme.stage;
      ctx.shadowBlur = 30 + beatBounce * 20 + intensity * 20;
      ctx.strokeStyle = theme.stage;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Stage Edge
      ctx.fillStyle = '#18181b';
      ctx.fillRect(0, CANVAS_HEIGHT - 150, CANVAS_WIDTH, 20);

      // Speakers bouncing to beat
      ctx.fillStyle = '#09090b';
      const speakerY = CANVAS_HEIGHT - 280 + beatBounce * 3;
      
      // Left speaker
      ctx.fillRect(100, speakerY, 140, 180);
      ctx.fillStyle = '#27272a';
      ctx.beginPath();
      ctx.arc(170, speakerY + 50, 35, 0, Math.PI * 2);
      ctx.arc(170, speakerY + 130, 30, 0, Math.PI * 2);
      ctx.fill();

      // Right speaker
      ctx.fillStyle = '#09090b';
      ctx.fillRect(CANVAS_WIDTH - 240, speakerY, 140, 180);
      ctx.fillStyle = '#27272a';
      ctx.beginPath();
      ctx.arc(CANVAS_WIDTH - 170, speakerY + 50, 35, 0, Math.PI * 2);
      ctx.arc(CANVAS_WIDTH - 170, speakerY + 130, 30, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw layers with zIndex >= 0 (In front of the stage)
    sortedLayers.filter(l => l.zIndex >= 0).forEach(layer => {
      if (!layer.image) return;
      const img = loadedImages.current[layer.image];
      if (img && img.complete) {
        ctx.save();
        // Center the layer by default to match editor
        ctx.translate(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
        if (cameraPos) {
          ctx.translate(cameraPos.x * (1 - (layer.scrollFactor || 1)), cameraPos.y * (1 - (layer.scrollFactor || 1)));
        }
        ctx.translate(layer.position.x, layer.position.y);
        ctx.scale(layer.scale * (layer.flipX ? -1 : 1), layer.scale * (layer.flipY ? -1 : 1));
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        ctx.restore();
      }
    });
  };

  const drawCharacter = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    pose: string,
    isPlayer: boolean,
    bounce: number,
    characterData?: CharacterData,
    angle: number = 0,
    scale: number = 1
  ) => {
    ctx.save();
    ctx.translate(x, y + bounce);
    if (angle !== 0) ctx.rotate(angle);

    if (characterData) {
      // Find the animation for the current pose
      let animName = pose; // Default to pose name
      if (pose === 'idle') animName = 'idle';
      else if (pose === 'left') animName = 'singLEFT';
      else if (pose === 'right') animName = 'singRIGHT';
      else if (pose === 'up') animName = 'singUP';
      else if (pose === 'down') animName = 'singDOWN';
      else if (pose === 'miss') animName = 'miss';

      let anim = characterData.animations.find(a => a.name === animName);
      // Fallback: try the original pose name if singLEFT etc. not found
      if (!anim && animName !== pose) anim = characterData.animations.find(a => a.name === pose);
      // Final fallback to idle
      if (!anim) anim = characterData.animations.find(a => a.name === 'idle');

      if (anim) {
        let imgSrc = anim.image || characterData.image;
        
        // Handle 2-frame animation if image2 is provided
        if (anim.image2) {
          const frameTime = (1000 / anim.fps) + (anim.delay || 0) * 1000;
          const startTime = isPlayer ? state.current.playerPoseStartTime : state.current.opponentPoseStartTime;
          const elapsed = performance.now() - startTime;
          
          let currentFrame = Math.floor(elapsed / frameTime);
          
          if (anim.loop) {
            currentFrame = currentFrame % 2;
          } else {
            currentFrame = Math.min(currentFrame, 1);
          }
          
          if (currentFrame === 1) {
            imgSrc = anim.image2;
          }
        }

        const img = loadedImages.current[imgSrc];
        
        if (img && img.complete) {
          const finalScale = characterData.scale * (anim.scale || 1) * scale;
          ctx.scale(finalScale, finalScale);
          if (characterData.flipX) ctx.scale(-1, 1);
          if (characterData.flipY) ctx.scale(1, -1);
          if (isPlayer) ctx.scale(-1, 1); // Face left by default for player
          if (anim.flipX) ctx.scale(-1, 1); // Apply per-animation flip

          // Draw image with offset
          // Note: offset is applied from the center bottom
          ctx.drawImage(
            img,
            -img.width / 2 + anim.offset.x,
            -img.height + anim.offset.y
          );
          ctx.restore();
          return;
        }
      } else {
        // Fallback to base image if no animation is found
        const img = loadedImages.current[characterData.image];
        if (img && img.complete) {
          ctx.scale(characterData.scale, characterData.scale);
          if (characterData.flipX) ctx.scale(-1, 1);
          if (characterData.flipY) ctx.scale(1, -1);
          if (isPlayer) ctx.scale(-1, 1);
          ctx.drawImage(img, -img.width / 2, -img.height);
          ctx.restore();
          return;
        }
      }
    }

    if (isPlayer) ctx.scale(-1, 1); // Face left

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 50, 12, 0, 0, Math.PI * 2);
    ctx.fill();

    // Legs
    ctx.fillStyle = isPlayer ? '#1e3a8a' : '#450a0a';
    ctx.fillRect(-20, -50, 18, 50);
    ctx.fillRect(5, -50, 18, 50);

    // Body
    ctx.fillStyle = isPlayer ? '#3b82f6' : '#ef4444';
    
    let bodyTilt = 0;
    if (pose === 'left') bodyTilt = -0.2;
    if (pose === 'right') bodyTilt = 0.2;
    if (pose === 'up') bodyTilt = -0.1;
    if (pose === 'down') bodyTilt = 0.1;

    ctx.rotate(bodyTilt);
    ctx.fillRect(-30, -110, 60, 60);

    // Head
    let headX = 0;
    let headY = -140;
    
    if (pose === 'left') headX = -20;
    if (pose === 'right') headX = 20;
    if (pose === 'up') headY = -160;
    if (pose === 'down') headY = -120;

    // Hair/Cap
    ctx.fillStyle = isPlayer ? '#0284c7' : '#7f1d1d';
    ctx.beginPath();
    ctx.arc(headX, headY, 38, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(headX, headY - 5, 50, 12); // Cap brim

    // Face
    ctx.fillStyle = '#ffedd5';
    ctx.beginPath();
    ctx.arc(headX, headY, 35, 0, Math.PI);
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#000';
    if (pose === 'miss') {
      ctx.font = 'bold 20px Arial';
      ctx.fillText('X', headX + 5, headY + 15);
      ctx.fillText('X', headX + 20, headY + 15);
    } else {
      ctx.fillRect(headX + 5, headY + 5, 6, 12);
      ctx.fillRect(headX + 20, headY + 5, 6, 12);
    }

    // Mouth
    if (pose === 'idle') {
      ctx.beginPath();
      ctx.arc(headX + 15, headY + 22, 6, 0, Math.PI);
      ctx.stroke();
    } else if (pose === 'miss') {
      ctx.beginPath();
      ctx.arc(headX + 15, headY + 25, 10, Math.PI, 0);
      ctx.fill();
    } else {
      // Singing
      ctx.beginPath();
      ctx.ellipse(headX + 15, headY + 22, 8, 12, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Mic hand
    ctx.fillStyle = '#ffedd5';
    ctx.beginPath();
    ctx.arc(headX + 30, headY + 35, 12, 0, Math.PI * 2);
    ctx.fill();
    
    // Mic
    ctx.fillStyle = '#3f3f46';
    ctx.fillRect(headX + 26, headY + 15, 8, 25);
    ctx.fillStyle = '#71717a';
    ctx.beginPath();
    ctx.arc(headX + 30, headY + 15, 12, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  };

  const drawCustomEffects = (ctx: CanvasRenderingContext2D, currentTime: number) => {
    (Object.values(state.current.activeCustomEffects) as any[]).forEach(effect => {
      const { effectType, mode, startTime, duration, intensity } = effect;
      
      let currentIntensity = effect.currentIntensity;
      if (mode === 'fade_in' && currentTime < startTime + duration) {
        currentIntensity = Math.min(intensity, (currentTime - startTime) / duration * intensity);
      } else if (mode === 'fade_in') {
        currentIntensity = intensity;
      } else if (mode === 'fade_out' && currentTime < startTime + duration) {
        currentIntensity = Math.max(0, (1 - (currentTime - startTime) / duration) * effect.startIntensity);
      } else if (mode === 'fade_out') {
        currentIntensity = 0;
        delete state.current.activeCustomEffects[effectType];
        return;
      }
      effect.currentIntensity = currentIntensity;

      if (currentIntensity <= 0) return;

      ctx.save();
      ctx.globalAlpha = currentIntensity;

      if (effectType === 'fire') {
        const flicker = Math.random() * 0.2 + 0.8;
        const grad = ctx.createRadialGradient(CANVAS_WIDTH/2, CANVAS_HEIGHT, 0, CANVAS_WIDTH/2, CANVAS_HEIGHT, CANVAS_HEIGHT);
        grad.addColorStop(0, `rgba(255, 100, 0, ${0.4 * flicker})`);
        grad.addColorStop(0.5, `rgba(255, 50, 0, ${0.2 * flicker})`);
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        
        for(let i=0; i<10; i++) {
          const x = Math.random() * CANVAS_WIDTH;
          const y = CANVAS_HEIGHT - (Math.random() * CANVAS_HEIGHT * ((currentTime + i * 0.1) % 1));
          ctx.fillStyle = '#ffcc00';
          ctx.beginPath();
          ctx.arc(x, y, Math.random() * 3, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (effectType === 'lightning') {
        if (Math.random() > 0.95) {
          ctx.fillStyle = `rgba(200, 200, 255, ${0.3 * currentIntensity})`;
          ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
          
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          let lx = Math.random() * CANVAS_WIDTH;
          let ly = 0;
          ctx.moveTo(lx, ly);
          while(ly < CANVAS_HEIGHT) {
            lx += (Math.random() - 0.5) * 50;
            ly += Math.random() * 50;
            ctx.lineTo(lx, ly);
          }
          ctx.stroke();
        }
      } else if (effectType === 'frost') {
        const grad = ctx.createRadialGradient(CANVAS_WIDTH/2, CANVAS_HEIGHT/2, CANVAS_HEIGHT * 0.3, CANVAS_WIDTH/2, CANVAS_HEIGHT/2, CANVAS_HEIGHT);
        grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
        grad.addColorStop(1, `rgba(100, 200, 255, ${0.4 * currentIntensity})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        
        for(let i=0; i<20; i++) {
          const x = (Math.random() * CANVAS_WIDTH + currentTime * 50 + i * 100) % CANVAS_WIDTH;
          const y = (Math.random() * CANVAS_HEIGHT + currentTime * 100 + i * 50) % CANVAS_HEIGHT;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(x, y, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (effectType === 'rain') {
        ctx.strokeStyle = `rgba(150, 150, 200, ${0.5 * currentIntensity})`;
        ctx.lineWidth = 1;
        for(let i=0; i<50; i++) {
          const x = (Math.random() * CANVAS_WIDTH + currentTime * 100 + i * 20) % CANVAS_WIDTH;
          const y = (Math.random() * CANVAS_HEIGHT + currentTime * 500 + i * 10) % CANVAS_HEIGHT;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - 5, y + 20);
          ctx.stroke();
        }
      } else if (effectType === 'invert') {
        ctx.globalCompositeOperation = 'difference';
        ctx.fillStyle = `rgba(255, 255, 255, ${currentIntensity})`;
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      }

      ctx.restore();
    });
  };

  const drawLoadingScreen = (ctx: CanvasRenderingContext2D, currentTime: number) => {
    ctx.fillStyle = '#09090b'; // bg-zinc-950
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Background Grid
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    const gridSize = 50;
    for (let x = 0; x < CANVAS_WIDTH; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_HEIGHT);
      ctx.stroke();
    }
    for (let y = 0; y < CANVAS_HEIGHT; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CANVAS_WIDTH, y);
      ctx.stroke();
    }

    // Logo
    const logo = new Image();
    logo.src = '/intro_logo.png';
    if (logo.complete) {
      const logoWidth = 400;
      const logoHeight = (logo.height / logo.width) * logoWidth;
      ctx.drawImage(logo, CANVAS_WIDTH / 2 - logoWidth / 2, CANVAS_HEIGHT / 2 - logoHeight / 2 - 50, logoWidth, logoHeight);
    } else {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 60px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('NULLIFIERVERSE', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 50);
    }

    // Countdown
    if (currentTime < 0) {
      const remaining = Math.abs(currentTime);
      let text = '';
      let scale = 1;
      
      if (remaining > 2) {
        text = '3';
        scale = 1 + (remaining - 2);
      } else if (remaining > 1) {
        text = '2';
        scale = 1 + (remaining - 1);
      } else if (remaining > 0) {
        text = '1';
        scale = 1 + remaining;
      }
      
      if (text) {
        ctx.save();
        ctx.translate(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 150);
        ctx.scale(scale, scale);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 120px "Inter", sans-serif';
        ctx.textAlign = 'center';
        ctx.shadowBlur = 20;
        ctx.shadowColor = 'rgba(0, 255, 255, 0.5)';
        ctx.fillText(text, 0, 0);
        ctx.restore();

        // Loading Text (pulsing)
        ctx.fillStyle = '#fff';
        ctx.font = '20px "Inter", sans-serif';
        ctx.textAlign = 'center';
        const opacity = (Math.sin(Date.now() / 200) + 1) / 2;
        ctx.globalAlpha = opacity;
        ctx.fillText('PREPARING...', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 50);
        ctx.globalAlpha = 1;
      }
    } else if (currentTime < 0.5) {
      ctx.save();
      ctx.translate(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 150);
      ctx.scale(1 + (0.5 - currentTime) * 2, 1 + (0.5 - currentTime) * 2);
      ctx.fillStyle = '#0f0';
      ctx.font = 'bold 150px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowBlur = 30;
      ctx.shadowColor = 'rgba(0, 255, 0, 0.8)';
      ctx.fillText('GO!', 0, 0);
      ctx.restore();
    }

    // Technical Indicators
    ctx.fillStyle = 'rgba(0, 255, 255, 0.4)';
    ctx.font = '10px "Inter", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('Nullifier v.1.0.0', CANVAS_WIDTH - 20, CANVAS_HEIGHT - 20);
  };

  const updateAndDraw = (deltaTime: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !audioEngine.current) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const currentTime = audioEngine.current.getCurrentTime();

    if (state.current.isLoading) {
      if (currentTime >= 0) {
        state.current.isLoading = false;
      }
    }

    const currentBeat = currentTime / (60 / state.current.currentBpm);
    const beatBounce = Math.abs(Math.sin(currentBeat * Math.PI)) * 15;

    // Countdown Sounds
    if (currentTime < 0) {
      const remaining = Math.abs(currentTime);
      if (remaining <= 3 && remaining > 2.9 && !countdownPlayedRef.current.has('3')) {
        playVoice('3');
        countdownPlayedRef.current.add('3');
      } else if (remaining <= 2 && remaining > 1.9 && !countdownPlayedRef.current.has('2')) {
        playVoice('2');
        countdownPlayedRef.current.add('2');
      } else if (remaining <= 1 && remaining > 0.9 && !countdownPlayedRef.current.has('1')) {
        playVoice('1');
        countdownPlayedRef.current.add('1');
      }
    } else if (currentTime >= 0 && currentTime < 0.1 && !countdownPlayedRef.current.has('go')) {
      playVoice('go');
      countdownPlayedRef.current.add('go');
    }

    ctx.save();

    // Update and apply shaders
    let filters: string[] = [];
    let postProcessShaders: any[] = [];
    
    Object.keys(state.current.activeShaders).forEach(type => {
      const shader = state.current.activeShaders[type];
      const elapsed = currentTime - shader.startTime;
      
      if (shader.duration > 0 && elapsed < shader.duration) {
        const progress = elapsed / shader.duration;
        if (shader.mode === 'fade_in') {
          shader.currentIntensity = shader.intensity * progress;
        } else if (shader.mode === 'fade_out') {
          shader.currentIntensity = shader.intensity * (1 - progress);
        }
      } else if (elapsed >= shader.duration) {
        if (shader.mode === 'fade_in') {
          shader.currentIntensity = shader.intensity;
        } else if (shader.mode === 'fade_out') {
          shader.currentIntensity = 0;
          delete state.current.activeShaders[type];
          return;
        }
      }

      if (shader.currentIntensity > 0) {
        if (type === 'hue') {
          filters.push(`hue-rotate(${shader.currentIntensity * 360}deg)`);
        } else if (type === 'gray_scale') {
          filters.push(`grayscale(${shader.currentIntensity * 100}%)`);
        } else {
          postProcessShaders.push({ type, ...shader });
        }
      }
    });

    if (filters.length > 0) {
      ctx.filter = filters.join(' ');
    }

    // Apply camera shake and offset/zoom
    ctx.save();
    if (state.current.cameraShake && currentTime < state.current.cameraShake.endTime) {
      const shake = state.current.cameraShake.intensity;
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    // Apply camera offset and zoom
    if (state.current.cameraOffset) {
      const cam = state.current.cameraOffset;
      
      if (cam.type === 'timed' && currentTime < cam.endTime) {
        const progress = (currentTime - cam.startTime) / (cam.endTime - cam.startTime);
        cam.currentX = cam.startX + (cam.targetX - cam.startX) * progress;
        cam.currentY = cam.startY + (cam.targetY - cam.startY) * progress;
        cam.currentZoom = cam.startZoom + (cam.targetZoom - cam.startZoom) * progress;
      } else {
        cam.currentX = cam.targetX;
        cam.currentY = cam.targetY;
        cam.currentZoom = cam.targetZoom;
      }

      let focusX = 0;
      if (cam.focus === 'player') {
        focusX = (CANVAS_WIDTH / 2) - (CANVAS_WIDTH - 250); // Center - Player position
      } else if (cam.focus === 'opponent') {
        focusX = (CANVAS_WIDTH / 2) - 250; // Center - Opponent position
      }

      // Clamp camera to background bounds
      const zoom = Math.max(1, cam.currentZoom);
      
      // Max allowed offset from center in world coordinates to keep viewport within [0, CANVAS_WIDTH]
      const maxX = (CANVAS_WIDTH / 2) * (1 - 1 / zoom);
      const maxY = (CANVAS_HEIGHT / 2) * (1 - 1 / zoom);

      // Total offset relative to center
      let totalX = focusX + cam.currentX;
      let totalY = cam.currentY;

      // Clamp totalX and totalY
      totalX = Math.max(-maxX, Math.min(maxX, totalX));
      totalY = Math.max(-maxY, Math.min(maxY, totalY));

      ctx.translate(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-CANVAS_WIDTH / 2 + totalX, -CANVAS_HEIGHT / 2 + totalY);
      state.current.cameraPos = { x: totalX, y: totalY };
    } else if (state.current.cameraZoom) {
      // Legacy camera zoom
      const zoom = Math.max(1, state.current.cameraZoom.currentZoom);
      ctx.translate(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-CANVAS_WIDTH / 2, -CANVAS_HEIGHT / 2);
    }

    // Process Events
    state.current.events.forEach(event => {
      // Trigger events at step 0 early during countdown so they are active before "GO!"
      const shouldTrigger = (currentTime >= event.time) || (currentTime < 0 && event.time <= 0);
      if (shouldTrigger && !state.current.triggeredEvents.has(event.id)) {
        state.current.triggeredEvents.add(event.id);
        
        if (event.type === 'move') {
          state.current.lastEvents['move'] = { name: `MOVE: ${event.value.target}`, time: currentTime };
          const target = event.value.target;
          const durationSec = event.value.movementType === 'timed' ? event.value.duration * (60 / state.current.currentBpm / 4) : 0;
          const lanes = event.value.lanes || [];
          const isRelative = event.value.relative || false;
          
          const targetLanes = lanes.length > 0 ? lanes : 
                             (target === 'player_notes' ? [4, 5, 6, 7] : 
                             (target === 'opponent_notes' ? [0, 1, 2, 3] : []));

          if (targetLanes.length > 0) {
            // Cancel existing move triggers for these lanes
            state.current.activeMoveTriggers = state.current.activeMoveTriggers.filter(t => 
              !(t.target === 'lane' && targetLanes.includes(t.lane))
            );
            
            targetLanes.forEach((lane: number) => {
              const startX = state.current.baseLaneOffsets[lane].x;
              const startY = state.current.baseLaneOffsets[lane].y;
              state.current.activeMoveTriggers.push({
                target: 'lane',
                lane,
                startX,
                startY,
                endX: isRelative ? startX + event.value.x : event.value.x,
                endY: isRelative ? startY + event.value.y : event.value.y,
                startTime: currentTime,
                duration: durationSec,
                easing: event.value.easing
              });
            });
          } else {
            const targets = target === 'both' ? ['player', 'opponent'] : [target];
            
            // Cancel existing move triggers for these targets
            state.current.activeMoveTriggers = state.current.activeMoveTriggers.filter(t => 
              !targets.includes(t.target)
            );

            targets.forEach(t => {
              const startX = t === 'player' ? state.current.basePlayerOffset.x : (t === 'opponent' ? state.current.baseOpponentOffset.x : (t === 'lane' ? state.current.baseLaneOffsets[event.value.lane || 0].x : 0));
              const startY = t === 'player' ? state.current.basePlayerOffset.y : (t === 'opponent' ? state.current.baseOpponentOffset.y : (t === 'lane' ? state.current.baseLaneOffsets[event.value.lane || 0].y : 0));
              
              state.current.activeMoveTriggers.push({
                target: t as any,
                lane: t === 'lane' ? (event.value.lane || 0) : undefined,
                startX,
                startY,
                endX: isRelative ? startX + event.value.x : event.value.x,
                endY: isRelative ? startY + event.value.y : event.value.y,
                startTime: currentTime,
                duration: durationSec,
                easing: event.value.easing
              });
            });
          }
        } else if (event.type === 'bpm_change') {
          state.current.currentBpm = event.value.bpm;
          state.current.lastEvents['bpm'] = { name: `BPM: ${event.value.bpm}`, time: currentTime };
        } else if (event.type === 'character_swap') {
          state.current.lastEvents['swap'] = { name: `SWAP: ${event.value.target} -> ${event.value.characterId}`, time: currentTime };
          if (event.value.target === 'player') {
            state.current.playerCharacterId = event.value.characterId;
            if (event.value.resetAnimation) {
              state.current.playerPose = event.value.resetAnimation;
              state.current.playerPoseTime = 0.5;
            }
          } else if (event.value.target === 'opponent') {
            state.current.opponentCharacterId = event.value.characterId;
            if (event.value.resetAnimation) {
              state.current.opponentPose = event.value.resetAnimation;
              state.current.opponentPoseTime = 0.5;
            }
          }
        } else if (event.type === 'camera_focus') {
          state.current.lastEvents['camera'] = { name: `CAMERA: ${event.value.target}`, time: currentTime };
        } else if (event.type === 'loop') {
          state.current.lastEvents['loop'] = { name: `LOOP START: ${event.id}`, time: currentTime };
        } else if (event.type === 'stop_loop') {
          state.current.lastEvents['loop'] = { name: `LOOP STOP: ${event.value.loopEventId}`, time: currentTime };
        } else if (event.type === 'camera_shake') {
          state.current.cameraShake = { 
            intensity: event.value.intensity || 10, 
            endTime: currentTime + (event.value.duration || 1) * (60 / state.current.currentBpm / 4) 
          };
          state.current.lastEvents['shake'] = { name: `SHAKE: ${event.value.intensity}`, time: currentTime };
        } else if (event.type === 'camera_zoom') {
          state.current.cameraZoom = {
            targetZoom: event.value.zoom || 1,
            startZoom: state.current.cameraZoom.currentZoom,
            currentZoom: state.current.cameraZoom.currentZoom,
            startTime: currentTime,
            endTime: currentTime + (event.value.duration || 1) * (60 / state.current.currentBpm / 4)
          };
          state.current.lastEvents['zoom'] = { name: `ZOOM: ${event.value.zoom}`, time: currentTime };
        } else if (event.type === 'camera_offset') {
          const duration = event.value.type === 'timed' ? (event.value.duration || 4) * (60 / state.current.currentBpm / 4) : 0;
          state.current.cameraOffset = {
            focus: event.value.focus || 'center',
            type: event.value.type || 'instant',
            startTime: currentTime,
            endTime: currentTime + duration,
            startX: state.current.cameraOffset.currentX,
            startY: state.current.cameraOffset.currentY,
            startZoom: state.current.cameraOffset.currentZoom,
            targetX: event.value.x || 0,
            targetY: event.value.y || 0,
            targetZoom: event.value.zoom || 1.2,
            currentX: state.current.cameraOffset.currentX,
            currentY: state.current.cameraOffset.currentY,
            currentZoom: state.current.cameraOffset.currentZoom
          };
          state.current.lastEvents['camera'] = { name: `CAMERA OFFSET: ${event.value.focus}`, time: currentTime };
        } else if (event.type === 'custom_effect') {
          const duration = (event.value.duration || 4) * (60 / state.current.currentBpm / 4);
          const existingEffect = state.current.activeCustomEffects[event.value.effectType];
          state.current.activeCustomEffects[event.value.effectType] = {
            effectType: event.value.effectType,
            mode: event.value.mode || 'fade_in',
            startTime: currentTime,
            duration: duration,
            intensity: event.value.intensity || 1,
            startIntensity: event.value.mode === 'fade_out' ? (existingEffect?.currentIntensity || 1) : 0,
            currentIntensity: event.value.mode === 'fade_out' ? (existingEffect?.currentIntensity || 1) : 0
          };
          state.current.lastEvents['effect'] = { name: `EFFECT: ${event.value.effectType}`, time: currentTime };
        } else if (event.type === 'fade') {
          const duration = (event.value.duration || 0) * (60 / state.current.currentBpm / 4);
          let targetAlpha = 0;
          let startAlpha = state.current.currentFadeAlpha;
          
          if (event.value.type === 'fade_in' || event.value.type === 'out') {
            targetAlpha = 1;
            if (event.value.type === 'out') startAlpha = 0;
          } else if (event.value.type === 'fade_out' || event.value.type === 'in') {
            targetAlpha = 0;
            if (event.value.type === 'in') startAlpha = 1;
          }

          state.current.fade = {
            type: event.value.type || 'fade_in',
            startTime: currentTime,
            endTime: currentTime + duration,
            startAlpha: startAlpha,
            targetAlpha: targetAlpha,
            color: event.value.color || '#000000'
          };
          state.current.currentFadeColor = event.value.color || '#000000';
          state.current.lastEvents['fade'] = { name: `FADE: ${event.value.type}`, time: currentTime };
        } else if (event.type === 'flash') {
          const stepDuration = 60 / state.current.currentBpm / 4;
          const fadeIn = (event.value.fadeIn || 0) * stepDuration;
          const hold = (event.value.hold || 0) * stepDuration;
          const fadeOut = (event.value.fadeOut || 4) * stepDuration;
          
          state.current.flash = {
            intensity: event.value.intensity !== undefined ? event.value.intensity : 1,
            startTime: currentTime,
            fadeInDuration: fadeIn,
            holdDuration: hold,
            fadeOutDuration: fadeOut,
            endTime: currentTime + fadeIn + hold + fadeOut,
            rainbow: !!event.value.rainbow
          };
          state.current.lastEvents['flash'] = { name: `FLASH: ${event.value.intensity}`, time: currentTime };
        } else if (event.type === 'scroll_speed') {
          const newSpeed = getEffectiveScrollSpeed((event.value.speed || 1) * scrollSpeed);
          state.current.currentScrollSpeed = newSpeed;
          state.current.baseScrollSpeed = newSpeed;
          state.current.lastEvents['scroll'] = { name: `SCROLL SPEED: ${event.value.speed}x`, time: currentTime };
        } else if (event.type === 'character_edit') {
          const target = event.value.target;
          const durationSec = event.value.movementType === 'timed' ? (event.value.duration || 4) * (60 / state.current.currentBpm / 4) : 0;
          const isRelative = event.value.relative || false;
          
          const targets = target === 'both' ? ['player', 'opponent'] : (target === 'extra' ? [event.value.characterId] : [target]);
          
          targets.forEach(t => {
            if (!t) return; // Skip if target is empty
            let startX = 0;
            let startY = 0;
            let startScale = 1;
            let startOpacity = 1;
            
            if (t === 'player') {
              startX = state.current.playerOffset.x;
              startY = state.current.playerOffset.y;
              startScale = state.current.playerScale;
              startOpacity = state.current.activeOpacities.player.current;
            } else if (t === 'opponent') {
              startX = state.current.opponentOffset.x;
              startY = state.current.opponentOffset.y;
              startScale = state.current.opponentScale;
              startOpacity = state.current.activeOpacities.opponent.current;
            } else {
              const extraState = state.current.extraCharacterStates[t] || { offset: { x: 0, y: 0 }, scale: 1, opacity: 1 };
              startX = extraState.offset.x;
              startY = extraState.offset.y;
              startScale = extraState.scale;
              startOpacity = extraState.opacity;
            }

            const endX = isRelative ? startX + (event.value.x || 0) : (event.value.x || 0);
            const endY = isRelative ? startY + (event.value.y || 0) : (event.value.y || 0);
            const endScale = isRelative ? startScale * (event.value.scale || 1) : (event.value.scale || 1);
            const endOpacity = event.value.opacity !== undefined ? (isRelative ? Math.max(0, Math.min(1, startOpacity + event.value.opacity)) : event.value.opacity) : startOpacity;

            if (durationSec <= 0) {
              // Instant
              if (t === 'player') {
                state.current.playerOffset = { x: endX, y: endY };
                state.current.playerScale = endScale;
                state.current.activeOpacities.player.current = endOpacity;
                state.current.activeOpacities.player.target = endOpacity;
              } else if (t === 'opponent') {
                state.current.opponentOffset = { x: endX, y: endY };
                state.current.opponentScale = endScale;
                state.current.activeOpacities.opponent.current = endOpacity;
                state.current.activeOpacities.opponent.target = endOpacity;
              } else {
                state.current.extraCharacterStates[t] = { offset: { x: endX, y: endY }, scale: endScale, opacity: endOpacity };
              }
            } else {
              // Timed
              // Cancel existing character edits for this target
              state.current.characterEdits = state.current.characterEdits.filter(e => e.target !== t);
              
              state.current.characterEdits.push({
                target: t,
                startTime: currentTime,
                duration: durationSec,
                startX,
                startY,
                startScale,
                startOpacity,
                endX,
                endY,
                endScale,
                endOpacity,
                easing: event.value.easing || 'linear'
              });
            }
          });
          state.current.lastEvents['char_edit'] = { name: `CHAR EDIT: ${target}`, time: currentTime };
        } else if (event.type === 'background_swap') {
          const swapTo = event.value.swapTo || 'toggle';
          if (swapTo === 'primary') {
            state.current.currentBackground = 'primary';
          } else if (swapTo === 'secondary') {
            state.current.currentBackground = 'secondary';
          } else {
            state.current.currentBackground = state.current.currentBackground === 'primary' ? 'secondary' : 'primary';
          }
          state.current.lastEvents['bg_swap'] = { name: `BG SWAP: ${state.current.currentBackground}`, time: currentTime };
        } else if (event.type === 'shader') {
          const { shaderType, intensity, duration, mode, ...params } = event.value;
          const durationSec = (duration || 0) * (60 / state.current.currentBpm / 4);
          
          state.current.activeShaders[shaderType] = {
            intensity: intensity || 1,
            startTime: currentTime,
            duration: durationSec,
            mode: mode || 'instant',
            params: params || {},
            currentIntensity: mode === 'fade_out' ? (state.current.activeShaders[shaderType]?.currentIntensity || intensity || 1) : (mode === 'instant' ? (intensity || 1) : 0),
            isEnding: mode === 'fade_out'
          };
          state.current.lastEvents['shader'] = { name: `SHADER: ${shaderType} (${mode})`, time: currentTime };
        } else if (event.type === 'rotate') {
          const { target, rotations, duration, isRelative, easing, rotationMode, orbitRadius } = event.value;
          const durationSec = (duration || 0) * (60 / state.current.currentBpm / 4);
          const targetAngle = (rotations || 0) * Math.PI * 2;
          const lanes = event.value.lanes || [];
          
          const mode = rotationMode === 'orbit' ? 'orbit' : 'self';
          
          if (lanes.length > 0 || target === 'lane' || target === 'player_notes' || target === 'opponent_notes') {
            const targetLanes = lanes.length > 0 ? lanes : 
                               (target === 'player_notes' ? [4, 5, 6, 7] : 
                               (target === 'opponent_notes' ? [0, 1, 2, 3] : 
                               [event.value.lane || 0]));
            
            // For timed rotations, we don't necessarily cancel, but for instant ones we might.
            // However, to avoid conflicts, it's better to let the newest one take over the target state.
            
            targetLanes.forEach((lane: number) => {
              if (state.current.activeRotations.lanes[lane]) {
                const rot = state.current.activeRotations.lanes[lane][mode];
                const currentAngle = rot.angle;
                const newTargetAngle = isRelative ? currentAngle + targetAngle : targetAngle;
                
                if (durationSec === 0) {
                  rot.angle = newTargetAngle;
                  rot.startAngle = newTargetAngle;
                  rot.targetAngle = newTargetAngle;
                  rot.duration = 0;
                  if (mode === 'orbit') {
                    rot.radius = orbitRadius !== undefined ? orbitRadius : (rot.radius || 0);
                  }
                } else {
                  rot.angle = currentAngle;
                  rot.startAngle = currentAngle;
                  rot.targetAngle = newTargetAngle;
                  rot.startTime = currentTime;
                  rot.duration = durationSec;
                  rot.easing = easing || 'easeInOut';
                  if (mode === 'orbit') {
                    rot.radius = orbitRadius !== undefined ? orbitRadius : (rot.radius || 0);
                  }
                }
              }
            });
          } else {
            const targets = target === 'all' ? ['player', 'opponent', 'notes', 'background'] : (target === 'both' ? ['player', 'opponent'] : [target]);
            
            targets.forEach(t => {
              const targetRot = state.current.activeRotations[t as keyof typeof state.current.activeRotations];
              if (targetRot && typeof targetRot === 'object' && !Array.isArray(targetRot)) {
                const rot = (targetRot as any)[mode];
                if (rot) {
                  const currentAngle = rot.angle;
                  const newTargetAngle = isRelative ? currentAngle + targetAngle : targetAngle;
                  
                  if (durationSec === 0) {
                    rot.angle = newTargetAngle;
                    rot.startAngle = newTargetAngle;
                    rot.targetAngle = newTargetAngle;
                    rot.duration = 0;
                    if (mode === 'orbit') {
                      rot.radius = orbitRadius !== undefined ? orbitRadius : (rot.radius || 0);
                    }
                  } else {
                    rot.angle = currentAngle;
                    rot.startAngle = currentAngle;
                    rot.targetAngle = newTargetAngle;
                    rot.startTime = currentTime;
                    rot.duration = durationSec;
                    rot.easing = easing || 'easeInOut';
                    if (mode === 'orbit') {
                      rot.radius = orbitRadius !== undefined ? orbitRadius : (rot.radius || 0);
                    }
                  }
                }
              }
            });
            
            if (target === 'all') {
              for (let i = 0; i < 8; i++) {
                const rot = state.current.activeRotations.lanes[i][mode];
                const currentAngle = rot.angle;
                const newTargetAngle = isRelative ? currentAngle + targetAngle : targetAngle;
                
                if (durationSec === 0) {
                  rot.angle = newTargetAngle;
                  rot.startAngle = newTargetAngle;
                  rot.targetAngle = newTargetAngle;
                  rot.duration = 0;
                  if (mode === 'orbit') {
                    rot.radius = orbitRadius !== undefined ? orbitRadius : (rot.radius || 0);
                  }
                } else {
                  rot.angle = currentAngle;
                  rot.startAngle = currentAngle;
                  rot.targetAngle = newTargetAngle;
                  rot.startTime = currentTime;
                  rot.duration = durationSec;
                  rot.easing = easing || 'easeInOut';
                  if (mode === 'orbit') {
                    rot.radius = orbitRadius !== undefined ? orbitRadius : (rot.radius || 0);
                  }
                }
              }
            }
          }
          state.current.lastEvents['rotate'] = { name: `ROTATE: ${target}`, time: currentTime };
        } else if (event.type === 'opacity') {
          const { target, opacity, duration, mode } = event.value;
          const durationSec = (duration || 0) * (60 / state.current.currentBpm / 4);
          
          let targets: string[] = [];
          if (target === 'all') {
            targets = ['notes_player', 'notes_opponent', 'player', 'opponent', 'hp_bar'];
          } else if (target === 'notes') {
            targets = ['notes_player', 'notes_opponent'];
          } else if (target === 'characters') {
            targets = ['player', 'opponent'];
          } else if (target === 'player') {
            targets = ['player', 'notes_player'];
          } else if (target === 'opponent') {
            targets = ['opponent', 'notes_opponent'];
          } else {
            targets = [target];
          }
          
          targets.forEach(t => {
            if (state.current.activeOpacities[t]) {
              state.current.activeOpacities[t] = {
                current: state.current.activeOpacities[t].current,
                startOpacity: state.current.activeOpacities[t].current,
                target: opacity,
                startTime: currentTime,
                duration: mode === 'fade' ? durationSec : 0
              };
            }
          });
          state.current.lastEvents['opacity'] = { name: `OPACITY: ${target} (${opacity})`, time: currentTime };
        } else if (event.type === 'add_text') {
          const { text, font, mode, duration, targetOpacity, color, x, y } = event.value;
          const durationSec = (duration || 0) * (60 / state.current.currentBpm / 4);
          
          if (mode === 'fade_in') {
            state.current.activeTexts.push({
              id: event.id,
              text,
              font,
              color,
              x,
              y,
              targetOpacity,
              currentOpacity: 0,
              startTime: currentTime,
              duration: durationSec,
              mode: 'fade_in',
              isRemoving: false
            });
          } else if (mode === 'fade_out') {
            // Find the most recent text and mark it for removal
            const lastText = [...state.current.activeTexts].reverse().find(t => !t.isRemoving);
            if (lastText) {
              lastText.isRemoving = true;
              lastText.startTime = currentTime;
              lastText.duration = durationSec;
              lastText.mode = 'fade_out';
            }
          }
          state.current.lastEvents['text'] = { name: `TEXT: ${text} (${mode})`, time: currentTime };
        } else if (event.type === 'modchart') {
          const modData = event.value as ModchartTriggerData;
          const stepDuration = 60 / state.current.currentBpm / 4;
          const durationSec = (modData.duration || 0) * stepDuration;
          const delaySec = (modData.delay || 0) * stepDuration;
          const fadeOutSec = (modData.fadeOut || 0) * stepDuration;
          
          state.current.activeModcharts.push({
            id: event.id,
            type: modData.type,
            target: modData.target,
            lanes: modData.lanes || [],
            startTime: currentTime + delaySec,
            duration: durationSec,
            speed: modData.speed || 1,
            intensity: modData.intensity || 1,
            value: modData.value || {},
            repeat: modData.repeat !== undefined ? modData.repeat : 0,
            delay: modData.delay || 0,
            fadeOut: fadeOutSec,
            easing: modData.easing || 'linear',
            isRemoving: false
          });
          state.current.lastEvents['modchart'] = { name: `MODCHART: ${modData.type}`, time: currentTime };
        }
      }
    });

    // Update active texts
    for (let i = state.current.activeTexts.length - 1; i >= 0; i--) {
      const txt = state.current.activeTexts[i];
      const elapsed = currentTime - txt.startTime;
      
      if (txt.mode === 'fade_in') {
        if (elapsed < txt.duration && txt.duration > 0) {
          txt.currentOpacity = (elapsed / txt.duration) * txt.targetOpacity;
        } else {
          txt.currentOpacity = txt.targetOpacity;
        }
      } else if (txt.mode === 'fade_out') {
        if (elapsed < txt.duration && txt.duration > 0) {
          txt.currentOpacity = txt.targetOpacity * (1 - (elapsed / txt.duration));
        } else {
          txt.currentOpacity = 0;
          state.current.activeTexts.splice(i, 1);
        }
      }
    }

    // Update opacities
    Object.keys(state.current.activeOpacities).forEach(target => {
      const op = state.current.activeOpacities[target];
      if (op.duration > 0) {
        const elapsed = currentTime - op.startTime;
        if (elapsed < op.duration) {
          const progress = elapsed / op.duration;
          op.current = op.startOpacity + (op.target - op.startOpacity) * progress;
        } else {
          op.current = op.target;
          op.duration = 0;
        }
      } else {
        op.current = op.target;
      }
    });

    // Update rotations
    Object.keys(state.current.activeRotations).forEach(target => {
      if (target === 'lanes') {
        state.current.activeRotations.lanes.forEach((laneRot, i) => {
          ['self', 'orbit'].forEach(mode => {
            const rot = laneRot[mode as 'self' | 'orbit'];
            if (rot.duration > 0) {
              const elapsed = currentTime - rot.startTime;
              if (elapsed < rot.duration) {
                const progress = elapsed / rot.duration;
                const easedProgress = getEasing(rot.easing)(progress);
                rot.angle = rot.startAngle + (rot.targetAngle - rot.startAngle) * easedProgress;
              } else {
                rot.angle = rot.targetAngle;
                rot.duration = 0;
              }
            }
          });
        });
      } else {
        const targetRot = state.current.activeRotations[target as keyof typeof state.current.activeRotations];
        if (targetRot && typeof targetRot === 'object' && !Array.isArray(targetRot)) {
          ['self', 'orbit'].forEach(mode => {
            const rot = (targetRot as any)[mode];
            if (rot && rot.duration > 0) {
              const elapsed = currentTime - rot.startTime;
              if (elapsed < rot.duration) {
                const progress = elapsed / rot.duration;
                const easedProgress = getEasing(rot.easing)(progress);
                rot.angle = rot.startAngle + (rot.targetAngle - rot.startAngle) * easedProgress;
              } else {
                rot.angle = rot.targetAngle;
                rot.duration = 0;
              }
            }
          });
        }
      }
    });

    // Update camera zoom
    if (state.current.cameraZoom.startTime < currentTime && currentTime < state.current.cameraZoom.endTime) {
      const duration = state.current.cameraZoom.endTime - state.current.cameraZoom.startTime;
      const elapsed = currentTime - state.current.cameraZoom.startTime;
      const progress = elapsed / duration;
      state.current.cameraZoom.currentZoom = state.current.cameraZoom.startZoom + (state.current.cameraZoom.targetZoom - state.current.cameraZoom.startZoom) * progress;
    } else if (currentTime >= state.current.cameraZoom.endTime) {
      state.current.cameraZoom.currentZoom = state.current.cameraZoom.targetZoom;
    }

    // Update modcharts
    state.current.laneOffsets = state.current.baseLaneOffsets.map(o => ({ ...o }));
    state.current.playerOffset = { ...state.current.basePlayerOffset };
    state.current.opponentOffset = { ...state.current.baseOpponentOffset };
    
    // Apply orbital rotations
    const centerX = CANVAS_WIDTH / 2;
    const centerY = CANVAS_HEIGHT / 2;

    // Player/Opponent orbital rotations
    ['player', 'opponent'].forEach(target => {
      const rot = state.current.activeRotations[target as 'player' | 'opponent'].orbit;
      if (rot.radius > 0 || rot.angle !== 0) {
        const offsetKey = target === 'player' ? 'playerOffset' : 'opponentOffset';
        const basePos = target === 'player' ? { x: CANVAS_WIDTH - 250, y: CANVAS_HEIGHT - 100 } : { x: 250, y: CANVAS_HEIGHT - 100 };
        const baseOffset = target === 'player' ? state.current.basePlayerOffset : state.current.baseOpponentOffset;
        
        const currentX = basePos.x + baseOffset.x;
        const currentY = basePos.y + baseOffset.y;
        
        const dx = currentX - centerX;
        const dy = currentY - centerY;
        const angle = Math.atan2(dy, dx) + rot.angle;
        const radius = rot.radius > 0 ? rot.radius : Math.sqrt(dx * dx + dy * dy);
        
        const finalX = centerX + Math.cos(angle) * radius;
        const finalY = centerY + Math.sin(angle) * radius;
        
        state.current[offsetKey].x = finalX - basePos.x;
        state.current[offsetKey].y = finalY - basePos.y;
      }
    });

    state.current.activeRotations.lanes.forEach((laneRot, i) => {
      const rot = laneRot.orbit;
      const notesOrbit = state.current.activeRotations.notes.orbit;
      
      if (rot.radius > 0 || rot.angle !== 0 || notesOrbit.radius > 0 || notesOrbit.angle !== 0) {
        const laneWidth = 70;
        const scale = state.current.laneScales[i] || 1;
        let baseLaneX = 0;
        if (i < 4) {
          baseLaneX = 80 + i * laneWidth * scale;
        } else {
          baseLaneX = CANVAS_WIDTH - 80 - (3 * laneWidth * scale) + (i - 4) * laneWidth * scale;
        }
        const baseLaneY = TARGET_Y;
        
        // Group-based rigid body rotation
        // Group 0: Opponent (0-3), Group 1: Player (4-7)
        const isPlayerGroup = i >= 4;
        const group = isPlayerGroup ? [4, 5, 6, 7] : [0, 1, 2, 3];
        
        // Calculate dynamic group center based on current base offsets
        const groupCenterX = group.reduce((sum, idx) => {
          const laneW = 70;
          const laneS = state.current.laneScales[idx] || 1;
          let bX = 0;
          if (idx < 4) bX = 80 + idx * laneW * laneS;
          else bX = CANVAS_WIDTH - 80 - (3 * laneW * laneS) + (idx - 4) * laneW * laneS;
          return sum + bX + state.current.baseLaneOffsets[idx].x;
        }, 0) / 4;
        
        const groupCenterY = group.reduce((sum, idx) => {
          return sum + TARGET_Y + state.current.baseLaneOffsets[idx].y;
        }, 0) / 4;
        
        // 1. Position of the lane including move offsets
        const currentLaneX = baseLaneX + state.current.baseLaneOffsets[i].x;
        const currentLaneY = baseLaneY + state.current.baseLaneOffsets[i].y;
        
        // 2. Vector from screen center to group center
        const vGroupX = groupCenterX - centerX;
        const vGroupY = groupCenterY - centerY;
        
        // 3. Rotate and scale the group center
        const combinedAngle = rot.angle + notesOrbit.angle;
        const groupAngle = Math.atan2(vGroupY, vGroupX) + combinedAngle;
        
        let groupRadius = Math.sqrt(vGroupX * vGroupX + vGroupY * vGroupY);
        if (rot.radius > 0) groupRadius = rot.radius;
        else if (notesOrbit.radius > 0) groupRadius = notesOrbit.radius;
        
        const newGroupCenterX = centerX + Math.cos(groupAngle) * groupRadius;
        const newGroupCenterY = centerY + Math.sin(groupAngle) * groupRadius;
        
        // 4. Vector from group center to individual lane (relative offset)
        const vRelX = currentLaneX - groupCenterX;
        const vRelY = currentLaneY - groupCenterY;
        
        // 5. Rotate the relative offset as well (rigid body rotation)
        const cosA = Math.cos(combinedAngle);
        const sinA = Math.sin(combinedAngle);
        
        const rotatedRelX = vRelX * cosA - vRelY * sinA;
        const rotatedRelY = vRelX * sinA + vRelY * cosA;
        
        // 6. Final position
        const finalX = newGroupCenterX + rotatedRelX;
        const finalY = newGroupCenterY + rotatedRelY;
        
        state.current.laneOffsets[i].x = finalX - baseLaneX;
        state.current.laneOffsets[i].y = finalY - baseLaneY;
      }
    });

    state.current.laneScales = Array.from({ length: 8 }).fill(1);
    state.current.laneAlphas = Array.from({ length: 8 }).fill(1);
    state.current.laneRotations = Array.from({ length: 8 }).fill(0);
    state.current.screenTilt = 0;
    state.current.currentScrollSpeed = state.current.baseScrollSpeed;
    let modScrollSpeedMult = 1;
    let isMirrored = false;

    for (let i = state.current.activeModcharts.length - 1; i >= 0; i--) {
      const mod = state.current.activeModcharts[i];
      if (currentTime < mod.startTime) continue;
      
      const elapsed = currentTime - mod.startTime;
      let currentElapsed = elapsed;
      
      const totalDuration = mod.duration > 0 ? (mod.repeat === -1 ? Infinity : (mod.repeat + 1) * mod.duration) : 0;
      
      if (mod.duration > 0) {
        const cycle = Math.floor(elapsed / mod.duration);
        if (mod.repeat !== -1 && cycle > mod.repeat) {
          state.current.activeModcharts.splice(i, 1);
          continue;
        }
        currentElapsed = elapsed % mod.duration;
      } else if (mod.repeat !== -1 && elapsed > 0) {
        // Instant modchart with no duration, remove after one frame or if it has fadeOut
        if (mod.fadeOut <= 0) {
          state.current.activeModcharts.splice(i, 1);
          continue;
        }
      }
      
      const progress = mod.duration > 0 ? currentElapsed / mod.duration : 1;
      const easedProgress = getEasing(mod.easing)(progress);
      
      // Fade out logic
      let modAlpha = 1;
      if (mod.fadeOut > 0) {
        const remainingTime = totalDuration === Infinity ? Infinity : totalDuration - elapsed;
        if (remainingTime < mod.fadeOut) {
          modAlpha = Math.max(0, remainingTime / mod.fadeOut);
        }
      }

      const targets = mod.target === 'all' ? [0,1,2,3,4,5,6,7] : 
                    mod.target === 'player' ? [4,5,6,7] : 
                    mod.target === 'opponent' ? [0,1,2,3] : 
                    mod.target === 'both' ? [0,1,2,3,4,5,6,7] : 
                    mod.lanes;
      
      targets.forEach(lane => {
        if (lane < 0 || lane >= 8) return;
        
        switch (mod.type) {
          case 'sway':
            state.current.laneOffsets[lane].x += Math.sin(currentTime * mod.speed) * mod.intensity * modAlpha;
            break;
          case 'bounce':
            state.current.laneOffsets[lane].y += Math.abs(Math.sin(currentTime * mod.speed)) * mod.intensity * modAlpha;
            break;
          case 'offset':
          case 'move':
            state.current.laneOffsets[lane].x += (mod.value.x || 0) * easedProgress * modAlpha;
            state.current.laneOffsets[lane].y += (mod.value.y || 0) * easedProgress * modAlpha;
            break;
          case 'scale':
            state.current.laneScales[lane] *= (1 + (mod.intensity - 1) * easedProgress * modAlpha);
            break;
          case 'alpha':
            state.current.laneAlphas[lane] *= (1 - (1 - mod.intensity) * easedProgress * modAlpha);
            break;
          case 'glitch':
            if (Math.random() < 0.3) {
              state.current.laneOffsets[lane].x += (Math.random() - 0.5) * mod.intensity * modAlpha;
              state.current.laneOffsets[lane].y += (Math.random() - 0.5) * mod.intensity * modAlpha;
            }
            break;
          case 'tilt':
            state.current.screenTilt += Math.sin(currentTime * mod.speed) * mod.intensity * modAlpha;
            break;
          case 'rotate':
            state.current.laneRotations[lane] += (mod.intensity * Math.PI * 2) * easedProgress * modAlpha;
            break;
          case 'scroll_speed':
            modScrollSpeedMult *= (1 + (mod.intensity - 1) * easedProgress * modAlpha);
            break;
          case 'mirror':
            isMirrored = true;
            break;
          case 'drunken':
            state.current.laneOffsets[lane].x += Math.cos(currentTime * mod.speed + lane) * mod.intensity * modAlpha;
            state.current.laneOffsets[lane].y += Math.sin(currentTime * mod.speed + lane) * mod.intensity * modAlpha;
            break;
          case 'wavy':
            state.current.laneOffsets[lane].y += Math.sin(currentTime * mod.speed + lane * 0.5) * mod.intensity * modAlpha;
            break;
          case 'hidden':
            state.current.laneAlphas[lane] *= Math.max(0, 1 - (mod.intensity * easedProgress * modAlpha));
            break;
        }
      });
    }

    // Apply mod scroll speed
    state.current.currentScrollSpeed *= modScrollSpeedMult;

    // Apply mirror if active
    if (isMirrored) {
      for (let i = 0; i < 4; i++) {
        const tempX = state.current.laneOffsets[i].x;
        const tempY = state.current.laneOffsets[i].y;
        state.current.laneOffsets[i].x = state.current.laneOffsets[i+4].x;
        state.current.laneOffsets[i].y = state.current.laneOffsets[i+4].y;
        state.current.laneOffsets[i+4].x = tempX;
        state.current.laneOffsets[i+4].y = tempY;
        
        const tempScale = state.current.laneScales[i];
        state.current.laneScales[i] = state.current.laneScales[i+4];
        state.current.laneScales[i+4] = tempScale;
        
        const tempAlpha = state.current.laneAlphas[i];
        state.current.laneAlphas[i] = state.current.laneAlphas[i+4];
        state.current.laneAlphas[i+4] = tempAlpha;
      }
    }

    // Default Events (Health Drain)
    if (!state.current.practiceMode && customStage?.chart?.defaultEvent === 'health_drain' && state.current.isPlaying) {
      state.current.health = Math.max(1, state.current.health - deltaTime * 2);
    }

      // Process active move triggers
      for (let i = state.current.activeMoveTriggers.length - 1; i >= 0; i--) {
        const anim = state.current.activeMoveTriggers[i];
        let progress = 1;
        if (anim.duration > 0) {
          progress = Math.min(1, (currentTime - anim.startTime) / anim.duration);
          
          // Apply easing
          const easing = anim.easing || 'easeOut';
          if (easing === 'easeIn') {
            progress = progress * progress;
          } else if (easing === 'easeOut') {
            progress = progress * (2 - progress);
          } else if (easing === 'easeInOut') {
            progress = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
          }
          // 'linear' is default progress
        }
      
      const currentX = anim.startX + (anim.endX - anim.startX) * progress;
      const currentY = anim.startY + (anim.endY - anim.startY) * progress;
      
      if (anim.target === 'player') {
        state.current.playerOffset = { x: currentX, y: currentY };
        state.current.basePlayerOffset = { x: currentX, y: currentY };
      } else if (anim.target === 'opponent') {
        state.current.opponentOffset = { x: currentX, y: currentY };
        state.current.baseOpponentOffset = { x: currentX, y: currentY };
      } else if (anim.target === 'lane') {
        state.current.baseLaneOffsets[anim.lane] = { x: currentX, y: currentY };
        state.current.laneOffsets[anim.lane] = { x: currentX, y: currentY };
      }
      
      if (progress >= 1) {
        state.current.activeMoveTriggers.splice(i, 1);
      }
    }

    // Process character edits
    for (let i = state.current.characterEdits.length - 1; i >= 0; i--) {
      const edit = state.current.characterEdits[i];
      let progress = Math.min(1, (currentTime - edit.startTime) / edit.duration);
      
      // Apply easing
      const easing = edit.easing || 'linear';
      if (easing === 'easeIn') {
        progress = progress * progress;
      } else if (easing === 'easeOut') {
        progress = progress * (2 - progress);
      } else if (easing === 'easeInOut') {
        progress = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
      }

      const currentX = edit.startX + (edit.endX - edit.startX) * progress;
      const currentY = edit.startY + (edit.endY - edit.startY) * progress;
      const currentScale = edit.startScale + (edit.endScale - edit.startScale) * progress;
      const currentOpacity = edit.startOpacity + (edit.endOpacity - edit.startOpacity) * progress;

      if (edit.target === 'player') {
        state.current.playerOffset = { x: currentX, y: currentY };
        state.current.playerScale = currentScale;
        state.current.activeOpacities.player.current = currentOpacity;
        state.current.activeOpacities.player.target = currentOpacity;
      } else if (edit.target === 'opponent') {
        state.current.opponentOffset = { x: currentX, y: currentY };
        state.current.opponentScale = currentScale;
        state.current.activeOpacities.opponent.current = currentOpacity;
        state.current.activeOpacities.opponent.target = currentOpacity;
      } else {
        state.current.extraCharacterStates[edit.target] = { 
          offset: { x: currentX, y: currentY }, 
          scale: currentScale,
          opacity: currentOpacity
        };
      }

      if (progress >= 1) {
        state.current.characterEdits.splice(i, 1);
      }
    }

    // Update pose timers
    if (state.current.playerPoseTime > 0) {
      state.current.playerPoseTime -= deltaTime;
      
      // Keep player pose active if holding a note
      const isHoldingAny = state.current.notes.some(n => n.lane >= 4 && n.isHolding);
      if (isHoldingAny && state.current.playerPose !== 'idle' && state.current.playerPose !== 'miss') {
        state.current.playerPoseTime = Math.max(state.current.playerPoseTime, 0.1);
      }

      if (state.current.playerPoseTime <= 0) state.current.playerPose = 'idle';
    }
    if (state.current.opponentPoseTime > 0) {
      state.current.opponentPoseTime -= deltaTime;
      if (state.current.opponentPoseTime <= 0) state.current.opponentPose = 'idle';
    }

    // Process notes in a single pass
    state.current.notes.forEach(note => {
      if ((note.hit && !note.isHolding) || note.missed) return;

      // Opponent Auto-play
      if (note.lane < 4) {
        if (currentTime >= note.time) {
          if (note.length > 0 && currentTime < note.time + note.length) {
            note.hit = true;
            note.isHolding = true;
            if (state.current.opponentPose !== ARROW_DIRECTIONS[note.lane]) {
              state.current.opponentPose = ARROW_DIRECTIONS[note.lane];
              state.current.opponentPoseStartTime = performance.now();
            }
            state.current.opponentPoseTime = 0.1; // Keep posing while holding
            state.current.opponentKeysPressed[note.lane] = true;
          } else {
            if (note.isHolding) {
              note.isHolding = false;
              note.holdCompleted = true;
              state.current.opponentKeysPressed[note.lane] = false;
            } else if (!note.hit) {
              note.hit = true;
              note.holdCompleted = true;
              state.current.opponentPose = ARROW_DIRECTIONS[note.lane];
              state.current.opponentPoseTime = 0.4;
              state.current.opponentPoseStartTime = performance.now();
              state.current.opponentKeysPressed[note.lane] = true;
              if (!state.current.practiceMode && customStage?.chart?.defaultEvent === 'health_drain') {
                // Opponent pushes player health down to 1%
                state.current.health = Math.max(1, state.current.health - 2);
              }
              setTimeout(() => {
                state.current.opponentKeysPressed[note.lane] = false;
              }, 150);
            }
          }
        }
      } 
      // Player Botplay
      else if (state.current.botplay) {
        // Botplay should ignore death and black notes
        const windows = note.type === 'caution' ? CAUTION_HIT_WINDOWS : HIT_WINDOWS;
        if (note.type === 'death' || note.type === 'black') {
          if (currentTime - note.time > windows.shit) {
            note.missed = true; // Safe miss
          }
        } else if (currentTime >= note.time) {
          const directionIdx = note.lane - 4;
          if (note.length > 0 && currentTime < note.time + note.length) {
            if (!note.hit) {
              note.hit = true;
              note.isHolding = true;
              state.current.judgements.sick++;
              if (!state.current.practiceMode) {
                state.current.combo++;
                state.current.score += 350;
                state.current.health = Math.min(100, state.current.health + 2);
              }
              spawnText('SICK!', getLaneX(note.lane), getLaneY(note.lane, TARGET_Y), '#00ffff');
            }
            if (state.current.playerPose !== ARROW_DIRECTIONS[directionIdx]) {
              state.current.playerPose = ARROW_DIRECTIONS[directionIdx];
              state.current.playerPoseStartTime = performance.now();
            }
            state.current.playerPoseTime = 0.1;
            state.current.keysPressed[directionIdx] = true;
          } else {
            if (note.isHolding) {
              note.isHolding = false;
              note.holdCompleted = true;
              if (!state.current.practiceMode) state.current.score += 100;
              state.current.keysPressed[directionIdx] = false;
            } else if (!note.hit) {
              note.hit = true;
              state.current.playerPose = ARROW_DIRECTIONS[directionIdx];
              state.current.playerPoseTime = 0.4;
              state.current.playerPoseStartTime = performance.now();
              state.current.keysPressed[directionIdx] = true;
              setTimeout(() => {
                state.current.keysPressed[directionIdx] = false;
              }, 150);
              state.current.judgements.sick++;
              state.current.totalNotesHit++;
              state.current.totalNotesPossible++;
              state.current.npsWindow.push(currentTime);
              if (!state.current.practiceMode) {
                state.current.combo++;
                state.current.score += 350;
                state.current.health = Math.min(100, state.current.health + 2);
              }
              spawnText('SICK!', getLaneX(note.lane), getLaneY(note.lane, TARGET_Y), '#00ffff');
            }
          }
        }
      }
      // Check Player misses (Manual Play)
      else if (!note.hit && !note.missed && currentTime - note.time > (note.type === 'caution' ? CAUTION_HIT_WINDOWS.shit : HIT_WINDOWS.shit) + 0.1) {
        note.missed = true;
        
        // Special note miss logic
        if (note.type === 'death' || note.type === 'black') {
          // Death and Black notes are SAFE to miss
          return; 
        } else if (note.type === 'caution') {
          if (!state.current.practiceMode) {
            state.current.combo = 0;
            state.current.health = 0; // Fatal miss
            state.current.gameOverReason = 'You forgot to press caution notes.';
          }
          spawnText('FATAL MISS!', getLaneX(note.lane), getLaneY(note.lane, TARGET_Y) + 50, '#ff0000');
        } else if (note.type === 'yellow') {
          if (!state.current.practiceMode) {
            state.current.combo = 0;
            state.current.health = Math.max(0, state.current.health - 10); // Double damage
          }
          spawnText('MISS x2', getLaneX(note.lane), getLaneY(note.lane, TARGET_Y) + 50, '#ff0000');
        } else {
          if (!state.current.practiceMode) {
            state.current.combo = 0;
            state.current.health = Math.max(0, state.current.health - 5);
          }
          spawnText('MISS', getLaneX(note.lane), getLaneY(note.lane, TARGET_Y) + 50, '#ff0000');
        }
        
        state.current.judgements.miss++;
        state.current.totalNotesPossible++;
        state.current.playerPose = 'miss';
        state.current.playerPoseTime = 0.4;
        audioEngine.current!.playMissSound();

        if (!state.current.practiceMode) {
          state.current.comboBreaks++;
        }
      }
      // Check if holding past the end time
      else if (note.isHolding) {
        // Periodic hold rewards
        const lastTick = note.lastHoldTick || note.time;
        const tickInterval = 0.1; // Reward every 0.1s
        const hpInterval = 0.5; // HP every 0.5s
        
        if (currentTime >= lastTick + tickInterval) {
          const ticks = Math.floor((currentTime - lastTick) / tickInterval);
          if (!state.current.practiceMode) {
            state.current.score += 10 * ticks;
            
            // HP gain every 0.5s
            const lastHPTick = Math.floor(lastTick / hpInterval);
            const currentHPTick = Math.floor(currentTime / hpInterval);
            if (currentHPTick > lastHPTick) {
              state.current.health = Math.min(100, state.current.health + (currentHPTick - lastHPTick));
            }
          }
          note.lastHoldTick = lastTick + (ticks * tickInterval);
        }

        if (currentTime >= note.time + note.length) {
          note.isHolding = false;
          note.holdCompleted = true;
          if (!state.current.practiceMode) {
            state.current.score += 100;
            state.current.health = Math.min(100, state.current.health + 2);
          }
        }
      }
    });

    // Check Game Over
    if (!state.current.practiceMode && state.current.health <= 0 && state.current.isPlaying) {
      state.current.isPlaying = false;
      audioEngine.current.stop();
      const reason = state.current.gameOverReason || 'You ran out of health!';
      onGameOver(state.current.score, state.current.judgements, reason, state.current.maxCombo);
      return;
    }

    // Check Level Complete
    const isComplete = currentTime >= state.current.actualDuration + 2;

    if (isComplete && state.current.isPlaying) {
      state.current.isPlaying = false;
      audioEngine.current.stop();
      onComplete(state.current.score, state.current.judgements, state.current.maxCombo);
      return;
    }

    // Update Particles
    state.current.particles.forEach(p => {
      if (theme.particles === 'rain') {
        const speedMult = 1 + state.current.combo * 0.02;
        p.y += p.speed * 3 * speedMult * deltaTime * 60;
        p.x -= p.speed * 0.5 * speedMult * deltaTime * 60;
        if (p.y > CANVAS_HEIGHT || p.x < 0) {
          p.y = 0;
          p.x = Math.random() * CANVAS_WIDTH + 200;
        }
      } else if (theme.particles === 'stars') {
        const dx = p.x - CANVAS_WIDTH / 2;
        const dy = p.y - CANVAS_HEIGHT / 2;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const speedMult = 1 + state.current.combo * 0.05;
        p.x += (dx / dist) * p.speed * speedMult * deltaTime * 60;
        p.y += (dy / dist) * p.speed * speedMult * deltaTime * 60;
        p.size += 0.02 * speedMult * deltaTime * 60;
        
        if (p.x < 0 || p.x > CANVAS_WIDTH || p.y < 0 || p.y > CANVAS_HEIGHT) {
          p.x = CANVAS_WIDTH / 2 + (Math.random() - 0.5) * 200;
          p.y = CANVAS_HEIGHT / 2 + (Math.random() - 0.5) * 200;
          p.size = Math.random() * 2 + 1;
        }
      } else if (theme.particles === 'embers') {
        p.y -= p.speed * deltaTime * 60;
        p.x += Math.sin(currentTime * 2 + p.size) * 2;
        if (p.y < 0) p.y = CANVAS_HEIGHT;
      }
    });

    // Draw Background Stage
    ctx.save();
    const bgRot = state.current.activeRotations.background.self.angle + state.current.activeRotations.background.orbit.angle;
    if (bgRot !== 0) {
      ctx.translate(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
      ctx.rotate(bgRot);
      ctx.translate(-CANVAS_WIDTH / 2, -CANVAS_HEIGHT / 2);
    }
    drawStage(ctx, beatBounce, theme, state.current.combo, currentTime, customStage, state.current.cameraPos);
    ctx.restore();

    // Draw Particles
    ctx.globalAlpha = 0.6;
    state.current.particles.forEach(p => {
      if (theme.particles === 'rain') {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.speed * 0.5, p.y - p.speed * 3);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size * 0.5;
        ctx.stroke();
      } else if (theme.particles === 'stars') {
        const dx = p.x - CANVAS_WIDTH / 2;
        const dy = p.y - CANVAS_HEIGHT / 2;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const speedMult = 1 + state.current.combo * 0.05;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - (dx / dist) * p.speed * speedMult * 2, p.y - (dy / dist) * p.speed * speedMult * 2);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.stroke();
      } else {
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    });
    ctx.globalAlpha = 1.0;

    // Draw Characters
    const getCharacterData = (id: string, defaultChar: CharacterData | undefined) => {
      const extra = (customStage?.extraCharacters || []).find(ec => ec.id === id);
      if (extra) return extra.character;

      if (id === customStage?.characterPlayer?.name) return customStage?.characterPlayer;
      if (id === customStage?.characterOpponent?.name) return customStage?.characterOpponent;
      
      return defaultChar;
    };

    const oppChar = getCharacterData(state.current.opponentCharacterId, customStage?.characterOpponent);
    const editorPlayerChar = getCharacterData(state.current.playerCharacterId, customStage?.characterPlayer);
    const playerChar = editorPlayerChar;

    ctx.save();
    ctx.globalAlpha = state.current.activeOpacities.opponent.current;
    drawCharacter(ctx, 250 + state.current.opponentOffset.x, CANVAS_HEIGHT - 100 + state.current.opponentOffset.y, state.current.opponentPose, false, beatBounce, oppChar, state.current.activeRotations.opponent.self.angle + state.current.activeRotations.opponent.orbit.angle, state.current.opponentScale);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = state.current.activeOpacities.player.current;
    drawCharacter(ctx, CANVAS_WIDTH - 250 + state.current.playerOffset.x, CANVAS_HEIGHT - 100 + state.current.playerOffset.y, state.current.playerPose, true, beatBounce, playerChar, state.current.activeRotations.player.self.angle + state.current.activeRotations.player.orbit.angle, state.current.playerScale);
    ctx.restore();

    // Draw Extra Characters
    (customStage?.extraCharacters || []).forEach(extra => {
      // Don't draw if it's the current player or opponent (already drawn)
      if (extra.id === state.current.playerCharacterId || extra.id === state.current.opponentCharacterId) return;
      
      // Only draw if showFromStart is true OR it has been character_swapped to or edited (handled by state.current.extraCharacterStates)
      const extraState = state.current.extraCharacterStates[extra.id];
      if (!extra.showFromStart && !extraState) return;

      const charData = extra.character;
      const offset = extraState?.offset || { x: 0, y: 0 };
      const scale = extraState?.scale || 1;
      const opacity = extraState?.opacity !== undefined ? extraState.opacity : (extra.side === 'player' ? state.current.activeOpacities.player.current : state.current.activeOpacities.opponent.current);
      
      const x = extra.side === 'player' ? CANVAS_WIDTH - 250 + offset.x : 250 + offset.x;
      const y = CANVAS_HEIGHT - 100 + offset.y;
      
      ctx.save();
      ctx.globalAlpha = opacity; 
      drawCharacter(ctx, x, y, 'idle', extra.side === 'player', beatBounce, charData, 0, scale);
      ctx.restore();
    });

    // Apply Screen Effects (Fade/Flash) - Moved here to only cover background and characters
    if (state.current.fade) {
      const { startTime, endTime, startAlpha, targetAlpha, color } = state.current.fade;
      let alpha = targetAlpha;
      
      if (currentTime < endTime) {
        const duration = endTime - startTime;
        if (duration > 0) {
          const elapsed = currentTime - startTime;
          const progress = Math.max(0, Math.min(1, elapsed / duration));
          alpha = startAlpha + (targetAlpha - startAlpha) * progress;
        }
      }
      
      state.current.currentFadeAlpha = alpha;
      
      if (alpha > 0) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx.fillStyle = color || '#000000';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.restore();
      }
    }

    if (state.current.flash && currentTime < state.current.flash.endTime) {
      const { startTime, fadeInDuration, holdDuration, fadeOutDuration, intensity, rainbow } = state.current.flash;
      const elapsed = currentTime - startTime;
      let alpha = 0;

      if (elapsed < fadeInDuration) {
        alpha = (elapsed / fadeInDuration) * intensity;
      } else if (elapsed < fadeInDuration + holdDuration) {
        alpha = intensity;
      } else {
        const fadeOutElapsed = elapsed - (fadeInDuration + holdDuration);
        alpha = (1 - (fadeOutElapsed / fadeOutDuration)) * intensity;
      }
      
      if (rainbow) {
        const hue = (currentTime * 500) % 360;
        ctx.fillStyle = `hsla(${hue}, 100%, 50%, ${Math.max(0, Math.min(1, alpha))})`;
      } else {
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0, Math.min(1, alpha))})`;
      }
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }

    // Draw Countdown
    if (currentTime < 0.5) {
      let countdownText = '';
      let countdownScale = 1;
      
      if (currentTime >= -3 && currentTime < -2) {
        countdownText = '3';
        countdownScale = 1 + (currentTime + 3);
        if (!countdownPlayedRef.current['3']) {
          playVoice('3');
          countdownPlayedRef.current['3'] = true;
        }
      } else if (currentTime >= -2 && currentTime < -1) {
        countdownText = '2';
        countdownScale = 1 + (currentTime + 2);
        if (!countdownPlayedRef.current['2']) {
          playVoice('2');
          countdownPlayedRef.current['2'] = true;
        }
      } else if (currentTime >= -1 && currentTime < 0) {
        countdownText = '1';
        countdownScale = 1 + (currentTime + 1);
        if (!countdownPlayedRef.current['1']) {
          playVoice('1');
          countdownPlayedRef.current['1'] = true;
        }
      } else if (currentTime >= 0 && currentTime < 0.5) {
        countdownText = 'GO!';
        countdownScale = 1.5 - currentTime;
        if (!countdownPlayedRef.current['go']) {
          playVoice('go');
          countdownPlayedRef.current['go'] = true;
        }
      }

      if (countdownText) {
        ctx.save();
        ctx.translate(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
        ctx.scale(countdownScale, countdownScale);
        ctx.font = 'bold 120px "Inter", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 8;
        ctx.strokeText(countdownText, 0, 0);
        ctx.fillStyle = countdownText === 'GO!' ? '#00ffff' : '#fff';
        ctx.fillText(countdownText, 0, 0);
        ctx.restore();
      }
    }

    // Draw Target Arrows (Opponent 0-3, Player 4-7)
    ctx.restore(); // Restore from camera transformation
    
    // Draw Custom Effects (screen-space, behind notes/UI)
    drawCustomEffects(ctx, currentTime);

    ctx.save();
    if (state.current.screenTilt !== 0) {
      ctx.translate(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
      ctx.rotate(state.current.screenTilt);
      ctx.translate(-CANVAS_WIDTH / 2, -CANVAS_HEIGHT / 2);
    }
    for (let i = 0; i < 8; i++) {
      const isPlayer = i >= 4;
      const directionIdx = i % 4;
      const isPressed = isPlayer ? state.current.keysPressed[directionIdx] : state.current.opponentKeysPressed[directionIdx];
      const char = isPlayer ? playerChar : oppChar;
      
      const isSpecialHit = state.current.notes.some(n => 
        n.lane === i && 
        n.type && n.type !== 'default' && 
        (n.isHolding || (n.hit && Math.abs(n.time - currentTime) < 0.15))
      );
      
      const customHitImageSrc = isSpecialHit && char?.customNotes?.specialHit ? char.customNotes.specialHit : char?.customNotes?.hit;
      const customHitImage = customHitImageSrc ? loadedImages.current[customHitImageSrc] : undefined;
      
      ctx.save();
      const baseAlpha = isPlayer ? state.current.activeOpacities.notes_player.current : state.current.activeOpacities.notes_opponent.current;
      const laneAlpha = state.current.laneAlphas[i] || 1;
      ctx.globalAlpha = baseAlpha * laneAlpha;
      
      const laneScale = state.current.laneScales[i] || 1;
      const laneX = getLaneX(i);
      const laneY = getLaneY(i, TARGET_Y);
      const orbitRot = state.current.activeRotations.lanes[i].orbit.angle + 
                       state.current.activeRotations.notes.orbit.angle + 
                       (state.current.laneRotations[i] || 0);
      
      const selfRot = state.current.activeRotations.lanes[i].self.angle + 
                      state.current.activeRotations.notes.self.angle;
      
      const totalRot = orbitRot + selfRot;
      
      drawArrow(ctx, laneX, laneY, 50, ARROW_DIRECTIONS[directionIdx], COLORS[directionIdx], isPressed, true, false, undefined, customHitImage, totalRot, laneScale);
      ctx.restore();
    }

    // Calculate dynamic scroll position once per frame
    const events = state.current.scrollSpeedEvents;
    const getScrollPosAtTime = (time: number) => {
      if (!events || events.length === 0) return time * getEffectiveScrollSpeed(scrollSpeed);
      let lastEvent = events[0];
      for (let j = 1; j < events.length; j++) {
        if (events[j].time > time) break;
        lastEvent = events[j];
      }
      return lastEvent.pos + (time - lastEvent.time) * lastEvent.speed;
    };

    const currentScrollPos = getScrollPosAtTime(currentTime);
    const baseEffectiveSpeed = getEffectiveScrollSpeed(scrollSpeed);

    // Draw Moving Notes
    for (let i = state.current.notes.length - 1; i >= 0; i--) {
      const note = state.current.notes[i];
      
      // Skip notes that are completely finished and off-screen
      const noteEndTime = note.time + (note.length || 0);
      if (currentTime > noteEndTime + 0.5) continue; 
      
      // Optimization: Skip notes that are too far in the future to be on screen
      // Assuming a reasonable scroll speed and screen height
      if (note.time > currentTime + 3.0) continue;
      if (note.length === 0 && (note.hit || note.missed)) continue;
      
      // Skip hold notes that are successfully completed
      if (note.length > 0 && note.holdCompleted) continue;
      
      const isPlayer = note.lane >= 4;
      ctx.save();
      const baseAlpha = isPlayer ? state.current.activeOpacities.notes_player.current : state.current.activeOpacities.notes_opponent.current;
      const laneAlpha = state.current.laneAlphas[note.lane] || 1;
      ctx.globalAlpha = baseAlpha * laneAlpha;

      const laneScale = state.current.laneScales[note.lane] || 1;
      const laneX = getLaneX(note.lane);
      const targetY = getLaneY(note.lane, TARGET_Y);
      
      // Drunken/Wavy effect
      let offsetX = 0;
      let offsetY = 0;
      state.current.activeModcharts.forEach(mod => {
        if (mod.type === 'drunken' || mod.type === 'wavy') {
          const targets = mod.target === 'all' ? [0,1,2,3,4,5,6,7] : 
                        mod.target === 'player' ? [4,5,6,7] : 
                        mod.target === 'opponent' ? [0,1,2,3] : 
                        mod.lanes;
          if (targets.includes(note.lane)) {
             if (mod.type === 'drunken') {
               offsetX += Math.sin(currentTime * mod.speed + note.time) * mod.intensity;
             } else {
               offsetY += Math.cos(currentTime * mod.speed + note.time) * mod.intensity;
             }
          }
        }
      });

      const orbitRot = state.current.activeRotations.lanes[note.lane].orbit.angle + 
                       state.current.activeRotations.notes.orbit.angle + 
                       (state.current.laneRotations[note.lane] || 0);
      
      const selfRot = state.current.activeRotations.lanes[note.lane].self.angle + 
                      state.current.activeRotations.notes.self.angle;
      
      const totalRot = orbitRot + selfRot;
      
      const noteScrollPos = note.scrollPosition ?? (note.time * baseEffectiveSpeed);
      const scrollOffset = noteScrollPos - currentScrollPos;
      
      // Calculate rotated position relative to the target arrow using ONLY orbitRot
      const noteX = laneX + Math.sin(-orbitRot) * scrollOffset + offsetX;
      const noteY = targetY + Math.cos(orbitRot) * scrollOffset + offsetY;
      
      // Sudden Appear (Hidden)
      let hiddenAlpha = 1;
      state.current.activeModcharts.forEach(mod => {
        if (mod.type === 'hidden') {
          const targets = mod.target === 'all' ? [0,1,2,3,4,5,6,7] : 
                        mod.target === 'player' ? [4,5,6,7] : 
                        mod.target === 'opponent' ? [0,1,2,3] : 
                        mod.lanes;
          if (targets.includes(note.lane)) {
             const dist = Math.abs(scrollOffset);
             if (dist < 200) {
               hiddenAlpha = Math.max(0, dist / 200);
             }
          }
        }
      });
      ctx.globalAlpha *= hiddenAlpha;

      // Draw hold body if length > 0
      if (note.length > 0) {
        const noteEndScrollPos = note.endScrollPosition ?? ((note.time + note.length) * baseEffectiveSpeed);
        const endScrollOffset = noteEndScrollPos - currentScrollPos;
        
        if (endScrollOffset > -500 && scrollOffset < 1000) {
          const directionIdx = note.lane % 4;
          const char = isPlayer ? playerChar : oppChar;
          const color = char?.customNotes?.holdColor || COLORS[directionIdx];
          
          ctx.save();
          ctx.globalAlpha *= 0.6; // Multiply by base hold alpha
          
          // If missed or released early, make it look dimmed
          if (note.missed) {
            ctx.globalAlpha *= 0.4;
          }
          
          const startScrollOffset = note.isHolding ? 0 : Math.max(0, scrollOffset);
          const bodyLength = endScrollOffset - startScrollOffset;
          
          if (bodyLength > 0) {
            const bodyWidth = 30 * laneScale;
            
            // Translate to the start of the hold body (on the rotated axis) using orbitRot
            ctx.translate(laneX + Math.sin(-orbitRot) * startScrollOffset + offsetX, 
                          targetY + Math.cos(orbitRot) * startScrollOffset + offsetY);
            ctx.rotate(orbitRot);
            
            ctx.fillStyle = color;
            ctx.fillRect(-bodyWidth / 2, 0, bodyWidth, bodyLength);
            
            // Add a border to the hold body
            ctx.strokeStyle = (note.type && note.type !== 'default') ? '#fff' : '#000';
            ctx.lineWidth = 3 * laneScale;
            ctx.strokeRect(-bodyWidth / 2, 0, bodyWidth, bodyLength);
          }
          ctx.restore();
        }
      }

      // Only draw the arrow head if it hasn't been hit yet and not missed
      if (!note.hit && !note.missed && noteX > -100 && noteX < CANVAS_WIDTH + 100 && noteY > -100 && noteY < CANVAS_HEIGHT + 100) {
        const directionIdx = note.lane % 4;
        let noteColor = COLORS[directionIdx];
        if (note.type === 'death') noteColor = '#000000';
        else if (note.type === 'caution') noteColor = '#f97316';
        else if (note.type === 'black') noteColor = '#18181b';
        else if (note.type === 'yellow') noteColor = '#eab308';
        
        const char = isPlayer ? playerChar : oppChar;
        const isSpecial = note.type && note.type !== 'default';
        const customFallingImageSrc = isSpecial ? (char?.customNotes?.specialFalling || char?.customNotes?.falling) : char?.customNotes?.falling;
        const customFallingImage = customFallingImageSrc ? loadedImages.current[customFallingImageSrc] : undefined;
        
        drawArrow(ctx, noteX, noteY, 50, ARROW_DIRECTIONS[directionIdx], noteColor, false, false, false, note.type, customFallingImage, totalRot, laneScale);
      }
      ctx.restore();
    }
    ctx.restore();

    // Draw Floating Texts
    for (let i = state.current.floatingTexts.length - 1; i >= 0; i--) {
      const ft = state.current.floatingTexts[i];
      ft.life -= deltaTime * 2;
      ft.y -= deltaTime * 50;

      if (ft.life <= 0) {
        state.current.floatingTexts.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.globalAlpha = Math.max(0, ft.life);
      ctx.fillStyle = ft.color;
      ctx.font = 'bold 36px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 4;
      ctx.strokeText(ft.text, ft.x, ft.y);
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }

    const currentTimeVal = audioEngine.current?.getCurrentTime() || 0;
    state.current.npsWindow = state.current.npsWindow.filter(t => currentTimeVal - t <= 1);
    state.current.nps = state.current.npsWindow.length;
    if (state.current.nps > state.current.maxNps) state.current.maxNps = state.current.nps;
    
    // Simulate FPS and Memory
    if (Math.random() > 0.95) {
      state.current.fps = 60 + Math.floor(Math.random() * 5) - 2;
      state.current.memory.used = 120 + Math.floor(Math.random() * 10);
    }

    // Draw UI (Score, Combo)
    drawPlayUI(ctx, currentTimeVal, state.current.actualDuration);

    if (state.current.combo > 3) {
      ctx.fillStyle = '#a855f7';
      ctx.font = 'bold 40px "Inter", sans-serif';
      ctx.strokeText(`${state.current.combo}x`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
      ctx.fillText(`${state.current.combo}x`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
    }

    // Draw Health Bar
    if (!state.current.practiceMode) {
      drawHealthBar(ctx, state.current.health, currentTimeVal, playerChar, oppChar);
    }

    // Apply Post-Process Shaders
    if (postProcessShaders.length > 0) {
      postProcessShaders.forEach(shader => {
        if (shader.type === 'lens_circle') {
          const offX = shader.params.offsetX || 0;
          const offY = shader.params.offsetY || 0;
          const centerX = CANVAS_WIDTH / 2 + offX;
          const centerY = CANVAS_HEIGHT / 2 + offY;
          const radius = Math.max(CANVAS_WIDTH, CANVAS_HEIGHT) * (1.2 - shader.currentIntensity);
          
          const baseOpacity = shader.params.opacity !== undefined ? shader.params.opacity : 1;
          const currentOpacity = baseOpacity * (shader.intensity > 0 ? (shader.currentIntensity / shader.intensity) : 1);
          
          const grad = ctx.createRadialGradient(centerX, centerY, radius * 0.5, centerX, centerY, radius);
          grad.addColorStop(0, 'transparent');
          grad.addColorStop(1, `rgba(0, 0, 0, ${currentOpacity})`);
          
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        } else if (shader.type === 'glitch') {
          const intensity = shader.currentIntensity;
          if (Math.random() < 0.1 * intensity) {
            const sliceCount = Math.floor(5 + 15 * intensity);
            for (let i = 0; i < sliceCount; i++) {
              const sliceY = Math.random() * CANVAS_HEIGHT;
              const sliceH = Math.random() * 50 * intensity;
              const offset = (Math.random() - 0.5) * 40 * intensity;
              ctx.drawImage(canvas, 0, sliceY, CANVAS_WIDTH, sliceH, offset, sliceY, CANVAS_WIDTH, sliceH);
            }
          }
        } else if (shader.type === 'chromatic_glitch') {
          const intensity = shader.currentIntensity;
          const speed = shader.params.speed || 1;
          const noise = shader.params.noise || 1;
          const time = currentTime * speed;
          
          const offset = Math.sin(time * 10) * 10 * intensity * noise;
          
          ctx.save();
          ctx.globalAlpha = 0.5 * intensity;
          ctx.globalCompositeOperation = 'screen';
          
          // Red ghost
          ctx.filter = 'hue-rotate(0deg) saturate(200%)';
          ctx.drawImage(canvas, offset, 0);
          
          // Blue ghost
          ctx.filter = 'hue-rotate(240deg) saturate(200%)';
          ctx.drawImage(canvas, -offset, 0);
          
          ctx.restore();

          // Add some random noise lines
          if (Math.random() < 0.2 * intensity * noise) {
            ctx.fillStyle = `hsla(${Math.random() * 360}, 100%, 50%, ${0.3 * intensity})`;
            ctx.fillRect(0, Math.random() * CANVAS_HEIGHT, CANVAS_WIDTH, Math.random() * 5);
          }
        }
      });
    }

    // Draw active texts
    state.current.activeTexts.forEach(txt => {
      ctx.save();
      ctx.globalAlpha = txt.currentOpacity;
      ctx.fillStyle = txt.color;
      ctx.font = `bold 48px "${txt.font}"`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Add a subtle shadow for better readability
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
      ctx.fillText(txt.text, txt.x * CANVAS_WIDTH, txt.y * CANVAS_HEIGHT);
      ctx.restore();
    });

    ctx.restore();

    if (state.current.isLoading) {
      drawLoadingScreen(ctx, currentTime);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const drawPlayUI = (ctx: CanvasRenderingContext2D, currentTime: number, duration: number) => {
    // 1. Time Bar
    const barWidth = 400;
    const barHeight = 8;
    const barX = (CANVAS_WIDTH - barWidth) / 2;
    const barY = 50;
    
    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(barX, barY, barWidth, barHeight);
    
    // Progress
    const progress = Math.min(1, currentTime / duration);
    ctx.fillStyle = '#a855f7'; // Purple neon
    ctx.fillRect(barX, barY, barWidth * progress, barHeight);
    
    // Text
    ctx.fillStyle = '#fff';
    ctx.font = '14px "Inter", sans-serif';
    ctx.textAlign = 'center';
    const timeText = `${formatTime(currentTime)} / ${formatTime(duration)}`;
    ctx.fillText(timeText, CANVAS_WIDTH / 2, barY + barHeight + 15);

    // 2. Technical Performance
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.textAlign = 'left';
    ctx.font = '12px "Inter", sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(`FPS: ${state.current.fps}`, 20, 30);
    ctx.fillText(`Mem: ${state.current.memory.used} MB / ${state.current.memory.total} MB`, 20, 45);
    ctx.restore();

    // 3. Judgement Counter
    ctx.save();
    ctx.textAlign = 'left';
    ctx.font = 'bold 18px "Inter", sans-serif';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    const judgements = state.current.judgements;
    const jX = 30;
    const jY = CANVAS_HEIGHT - 200;
    
    const drawJ = (label: string, count: number, color: string, offset: number) => {
      ctx.fillStyle = color;
      ctx.strokeText(`${label}: ${count}`, jX, jY + offset);
      ctx.fillText(`${label}: ${count}`, jX, jY + offset);
    };
    
    drawJ('Sicks', judgements.sick, '#00ffff', 0);
    drawJ('Goods', judgements.good, '#12fa05', 25);
    drawJ('Bads', judgements.bad, '#c24b99', 50);
    drawJ('Shits', judgements.shit, '#a0522d', 75);
    drawJ('Misses', judgements.miss, '#f9393f', 100);
    ctx.restore();

    // 4. Performance Stats
    ctx.save();
    ctx.textAlign = 'right';
    ctx.font = 'bold 20px "Inter", sans-serif';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 4;
    const pX = CANVAS_WIDTH - 30;
    const pY = CANVAS_HEIGHT - 200;
    
    const accuracy = state.current.totalNotesPossible > 0 
      ? (state.current.totalNotesHit / state.current.totalNotesPossible) * 100 
      : 100;
      
    let rank = 'FC';
    let rankColor = '#facc15'; // Yellow
    if (state.current.comboBreaks > 0) {
      rank = 'SDG';
      rankColor = '#facc15';
    }
    if (state.current.comboBreaks > 5) {
      rank = 'A';
      rankColor = '#22c55e';
    }
    if (accuracy < 80) {
      rank = 'B';
      rankColor = '#3b82f6';
    }

    ctx.fillStyle = '#fff';
    ctx.strokeText(`NPS: ${state.current.nps} / ${state.current.maxNps}`, pX, pY);
    ctx.fillText(`NPS: ${state.current.nps} / ${state.current.maxNps}`, pX, pY);
    
    ctx.strokeText(`Score: ${state.current.score}`, pX, pY + 30);
    ctx.fillText(`Score: ${state.current.score}`, pX, pY + 30);
    
    ctx.strokeText(`Combo Breaks: ${state.current.comboBreaks}`, pX, pY + 60);
    ctx.fillText(`Combo Breaks: ${state.current.comboBreaks}`, pX, pY + 60);
    
    ctx.strokeText(`Accuracy: ${accuracy.toFixed(2)}%`, pX, pY + 90);
    ctx.fillText(`Accuracy: ${accuracy.toFixed(2)}%`, pX, pY + 90);
    
    ctx.font = 'black 48px "Inter", sans-serif';
    ctx.fillStyle = rankColor;
    ctx.strokeText(rank, pX, pY + 150);
    ctx.fillText(rank, pX, pY + 150);
    ctx.restore();
  };

  const drawHealthBar = (ctx: CanvasRenderingContext2D, health: number, currentTime: number, playerChar: CharacterData | undefined, oppChar: CharacterData | undefined) => {
    ctx.save();
    ctx.globalAlpha = state.current.activeOpacities.hp_bar.current;
    const barWidth = 500;
    const barHeight = 24;
    const x = (CANVAS_WIDTH - barWidth) / 2;
    const y = CANVAS_HEIGHT - 50;

    // Background (Enemy - Red)
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(x, y, barWidth, barHeight);

    // Foreground (Player - Green)
    const playerWidth = (health / 100) * barWidth;
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(x + (barWidth - playerWidth), y, playerWidth, barHeight);

    // Border
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 6;
    ctx.strokeRect(x, y, barWidth, barHeight);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, barWidth, barHeight);

    // Icons
    const iconSize = 80;
    const iconY = y + barHeight / 2;
    const iconX = x + (barWidth - playerWidth);

    const currentBeat = currentTime / (60 / state.current.currentBpm);
    const bounceScale = 1 + Math.abs(Math.sin(currentBeat * Math.PI)) * 0.15;

    const drawIcon = (char: CharacterData | undefined, isPlayer: boolean) => {
      if (!char) return;
      let iconUrl = char.image; // Fallback
      let isSpriteSheet = false;
      let frameIndex = 0;

      if (char.healthIcons) {
        if (char.healthIcons.isSpriteSheet) {
          isSpriteSheet = true;
          iconUrl = char.healthIcons.spriteSheetUrl || char.image;
          const frames = char.healthIcons.frames || { normal: 0, win: 0, lose: 0 };
          if (health > 90) frameIndex = isPlayer ? frames.win : frames.lose;
          else if (health < 10) frameIndex = isPlayer ? frames.lose : frames.win;
          else frameIndex = frames.normal;
        } else {
          if (health > 90) iconUrl = (isPlayer ? char.healthIcons.win : char.healthIcons.lose) || char.image;
          else if (health < 10) iconUrl = (isPlayer ? char.healthIcons.lose : char.healthIcons.win) || char.image;
          else iconUrl = char.healthIcons.normal || char.image;
        }
      }
      
      const img = loadedImages.current[iconUrl];
      if (img && img.complete) {
        ctx.save();
        ctx.translate(iconX, iconY);
        ctx.scale(bounceScale, bounceScale);
        if (isPlayer) ctx.scale(-1, 1);

        if (isSpriteSheet) {
          // Assume icons are 150x150 in a horizontal strip
          const frameWidth = 150;
          const frameHeight = 150;
          ctx.drawImage(
            img,
            frameIndex * frameWidth, 0, frameWidth, frameHeight,
            -iconSize, -iconSize / 2, iconSize, iconSize
          );
        } else {
          ctx.drawImage(img, -iconSize, -iconSize / 2, iconSize, iconSize);
        }
        ctx.restore();
      } else {
        // Fallback placeholder
        ctx.fillStyle = isPlayer ? '#22c55e' : '#ef4444';
        ctx.beginPath();
        const circleSize = (iconSize / 3) * bounceScale;
        ctx.arc(iconX + (isPlayer ? circleSize : -circleSize), iconY, circleSize, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    drawIcon(playerChar, true);
    drawIcon(oppChar, false);
    ctx.restore();
  };

  const drawArrow = (
    ctx: CanvasRenderingContext2D, 
    x: number, 
    y: number, 
    size: number, 
    direction: string, 
    color: string, 
    isPressed: boolean, 
    isTarget: boolean, 
    isHit: boolean,
    type?: 'death' | 'caution' | 'black' | 'yellow',
    customImage?: HTMLImageElement,
    selfRotation: number = 0,
    extraScale: number = 1
  ) => {
    ctx.save();
    ctx.translate(x, y);
    
    if (selfRotation !== 0) {
      ctx.rotate(selfRotation);
    }

    if (direction === 'left') ctx.rotate(-Math.PI / 2);
    else if (direction === 'down') ctx.rotate(Math.PI);
    else if (direction === 'right') ctx.rotate(Math.PI / 2);

    const scale = (isPressed ? 0.85 : (isHit ? 1.2 : 1)) * extraScale;
    ctx.scale(scale, scale);

    if (customImage) {
      if (isTarget && !isPressed) {
        ctx.globalAlpha = 0.5;
      }
      ctx.drawImage(customImage, -size / 2, -size / 2, size, size);
      ctx.restore();
      return;
    }

    ctx.beginPath();
    ctx.moveTo(0, -size / 2);
    ctx.lineTo(size / 2, 0);
    ctx.lineTo(size / 4, 0);
    ctx.lineTo(size / 4, size / 2);
    ctx.lineTo(-size / 4, size / 2);
    ctx.lineTo(-size / 4, 0);
    ctx.lineTo(-size / 2, 0);
    ctx.closePath();

    if (isTarget) {
      ctx.strokeStyle = isPressed ? color : '#52525b';
      ctx.lineWidth = 6;
      ctx.stroke();
      if (isPressed) {
        ctx.fillStyle = color + '60';
        ctx.fill();
      }
    } else {
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = type === 'death' ? '#dc2626' : ((!type || (type as string) === 'default') ? '#000' : '#fff');
      ctx.lineWidth = type === 'death' ? 5 : 4;
      ctx.stroke();

      // Draw icons for special notes
      if (type === 'caution') {
        ctx.save();
        if (direction === 'left') ctx.rotate(Math.PI / 2);
        else if (direction === 'down') ctx.rotate(-Math.PI);
        else if (direction === 'right') ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', 0, 0);
        ctx.restore();
      } else if (type === 'death') {
        ctx.save();
        if (direction === 'left') ctx.rotate(Math.PI / 2);
        else if (direction === 'down') ctx.rotate(-Math.PI);
        else if (direction === 'right') ctx.rotate(-Math.PI / 2);
        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(-10, -10); ctx.lineTo(10, 10);
        ctx.moveTo(10, -10); ctx.lineTo(-10, 10);
        ctx.stroke();
        ctx.restore();
      }
    }

    ctx.restore();
  };

  return (
    <div className={`relative flex flex-col items-center justify-center w-full ${isFullscreen ? 'max-w-none h-screen' : 'max-w-5xl mx-auto'}`}>
      {isPaused && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-10 rounded-xl backdrop-blur-md">
          <div className="w-full max-w-md bg-blue-900/20 border border-blue-500/30 rounded-3xl p-10 shadow-2xl relative overflow-hidden flex flex-col items-center">
            <div className="absolute top-0 left-0 right-0 h-16 bg-blue-700 flex items-center justify-center parallelogram-right mb-8">
              <h2 className="text-4xl font-black italic uppercase text-white tracking-widest">PAUSED</h2>
            </div>
            
            <div className="mt-20 w-full space-y-4">
              <button 
                onClick={togglePause}
                className="group relative w-full h-16 transition-all duration-200 hover:scale-105"
              >
                <div className="absolute inset-0 bg-blue-600 parallelogram shadow-lg group-hover:brightness-125 transition-all"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-2xl font-black italic uppercase text-white tracking-widest">RESUME</span>
                </div>
              </button>

              {onRestart && (
                <button 
                  onClick={onRestart}
                  className="group relative w-full h-16 transition-all duration-200 hover:scale-105"
                >
                  <div className="absolute inset-0 bg-purple-600 parallelogram shadow-lg group-hover:brightness-125 transition-all"></div>
                  <div className="absolute inset-0 flex items-center justify-center gap-2">
                    <RotateCcw className="w-6 h-6 text-white" />
                    <span className="text-2xl font-black italic uppercase text-white tracking-widest">RESTART</span>
                  </div>
                </button>
              )}

              {onOpenSettings && (
                <button 
                  onClick={onOpenSettings}
                  className="group relative w-full h-16 transition-all duration-200 hover:scale-105"
                >
                  <div className="absolute inset-0 bg-cyan-600 parallelogram shadow-lg group-hover:brightness-125 transition-all"></div>
                  <div className="absolute inset-0 flex items-center justify-center gap-2">
                    <Settings className="w-6 h-6 text-white" />
                    <span className="text-2xl font-black italic uppercase text-white tracking-widest">SETTINGS</span>
                  </div>
                </button>
              )}

              <button 
                onClick={onQuit}
                className="group relative w-full h-16 transition-all duration-200 hover:scale-105"
              >
                <div className="absolute inset-0 bg-red-600 parallelogram shadow-lg group-hover:brightness-125 transition-all"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-2xl font-black italic uppercase text-white tracking-widest">QUIT TO MENU</span>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className={`w-full h-auto aspect-video bg-zinc-950 ${isFullscreen ? 'rounded-none border-none max-h-screen' : 'rounded-xl shadow-2xl border border-zinc-800'}`}
      />
    </div>
  );
});

export default RhythmGame;
