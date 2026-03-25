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

import { SavedStage, CharacterData, ExtraCharacterData } from './editor/EditorTypes';
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
  mobileMode?: boolean;
  mobileButtonPositions?: Array<{ x: number, y: number, scale?: number }>;
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

const DEFAULT_SCROLL_SPEED = 700; // pixels per second
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

const RhythmGame = forwardRef<RhythmGameRef, RhythmGameProps>(({ bpm, duration, targetNotes, scrollSpeed = DEFAULT_SCROLL_SPEED, botplay, practiceMode = false, playbackRate = 1, keys, theme, customStage, onComplete, onGameOver, onQuit, onOpenSettings, onRestart, volume = 1, isFullscreen = false, mobileMode = false, mobileButtonPositions }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioEngine = useRef<AudioEngine | null>(null);
  const [isPaused, setIsPaused] = React.useState(false);
  const lastTimeRef = useRef(performance.now());
  const loadedImages = useRef<Record<string, HTMLImageElement>>({});
  const countdownAudioRef = useRef<Record<string, AudioBuffer>>({});
  const countdownPlayedRef = useRef<Record<string, boolean>>({ '3': false, '2': false, '1': false, 'go': false });

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
    activeMoveTriggers: [] as any[],
    laneOffsets: Array(8).fill({ x: 0, y: 0 }),
    playerCharacterId: (customStage?.extraCharacters?.find(ec => ec.side === 'player' && ec.showFromStart)?.id) || customStage?.characterPlayer?.name || 'bf',
    opponentCharacterId: (customStage?.extraCharacters?.find(ec => ec.side === 'opponent' && ec.showFromStart)?.id) || customStage?.characterOpponent?.name || 'dad',
    currentBpm: customStage?.chart?.bpm || 120,
    currentScrollSpeed: scrollSpeed,
    scrollSpeedEvents: [] as Array<{ time: number, speed: number, pos: number }>,
    lastEvents: {} as Record<string, { name: string, time: number }>,
    cameraShake: null as { intensity: number, endTime: number } | null,
    cameraZoom: { targetZoom: 1, startZoom: 1, currentZoom: 1, startTime: 0, endTime: 0 } as { targetZoom: number, startZoom: number, currentZoom: number, startTime: number, endTime: number },
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
      player: { angle: 0, startTime: 0, duration: 0, targetAngle: 0, startAngle: 0 },
      opponent: { angle: 0, startTime: 0, duration: 0, targetAngle: 0, startAngle: 0 },
      notes: { angle: 0, startTime: 0, duration: 0, targetAngle: 0, startAngle: 0 },
      background: { angle: 0, startTime: 0, duration: 0, targetAngle: 0, startAngle: 0 }
    },
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
  });

  useEffect(() => {
    state.current.botplay = botplay;
    state.current.practiceMode = practiceMode;
  }, [botplay, practiceMode]);

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

  const handleLaneDown = (laneIdx: number) => {
    if (state.current.isPaused || state.current.botplay) return;
    if (laneIdx !== -1) {
      state.current.keysPressed[laneIdx] = true;
      handleHit(laneIdx);
    }
  };

  const handleLaneUp = (laneIdx: number) => {
    if (state.current.botplay) return;
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
            state.current.totalNotesPossible++;
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

  useEffect(() => {
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
        .map(e => ({ time: getStepTime(e.step || 0), speed: (e.value.speed || 1) * scrollSpeed }))
        .sort((a, b) => a.time - b.time);

      const calculatedSpeedEvents = [];
      let currentPos = 0;
      let lastTime = 0;
      let currentSpeed = scrollSpeed;

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
      });

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
              state.current.cameraZoom.targetZoom = event.value.zoom;
              state.current.cameraZoom.currentZoom = event.value.zoom;
            }
          }
        });
      }

    } else {
      state.current.notes = generateChart(bpm, duration, targetNotes);
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
      countdownPlayedRef.current = { '3': false, '2': false, '1': false, 'go': false };
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
      lastTimeRef.current = performance.now();
      animationFrameId = requestAnimationFrame(loop);
    };

    const loop = (time: number) => {
      if (isUnmounted) return;
      if (!state.current.isPaused) {
        const deltaTime = (time - lastTimeRef.current) / 1000;
        lastTimeRef.current = time;
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

      handleLaneDown(laneIdx);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (state.current.botplay) return;
      let laneIdx = keys.findIndex(k => k.toLowerCase() === e.key.toLowerCase());
      if (laneIdx === -1) {
        const arrowMap: Record<string, number> = { ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3 };
        laneIdx = arrowMap[e.key] ?? -1;
      }
      handleLaneUp(laneIdx);
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
    const candidates = state.current.notes.filter(n => n.lane === noteLane && !n.hit);
    
    let note: Note | null = null;
    let minDiff = Infinity;
    
    for (const n of candidates) {
      const diff = Math.abs(n.time - currentTime);
      if (diff < minDiff) {
        minDiff = diff;
        note = n;
      }
    }

    if (note) {
      const diff = Math.abs(note.time - currentTime);
      const windows = note.type === 'caution' ? CAUTION_HIT_WINDOWS : HIT_WINDOWS;
      
      if (diff <= windows.shit) {
        // If it was marked as missed but we hit it within the window, un-miss it
        note.missed = false;
        
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

        if (judgement === 'BAD' || judgement === 'SHIT') {
          if (!state.current.practiceMode) {
            state.current.combo = 0;
            state.current.comboBreaks++;
          }
        } else {
          if (!state.current.practiceMode) {
            state.current.combo++;
            if (state.current.combo > state.current.maxCombo) {
              state.current.maxCombo = state.current.combo;
            }
          }
        }

        if (!state.current.practiceMode) {
          state.current.score += scoreAdd;
          state.current.health = Math.min(100, state.current.health + healthAdd);
        }
        state.current.totalNotesHit++;
        state.current.totalNotesPossible++;
        state.current.npsWindow.push(currentTime);

        spawnText(judgement, getLaneX(noteLane), getLaneY(noteLane, TARGET_Y), color);
      } else {
        // Ghost tap visual/audio feedback only - no health/combo penalty as requested
        if (!practiceMode) {
          state.current.playerPose = 'miss';
          state.current.playerPoseTime = 0.3;
          state.current.playerPoseStartTime = performance.now();
          audioEngine.current.playMissSound();
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
    if (lane < 4) {
      // Opponent (left side)
      const startX = 80;
      return startX + lane * laneWidth + laneOffset.x;
    } else {
      // Player (right side)
      const startX = CANVAS_WIDTH - 80 - (3 * laneWidth);
      return startX + (lane - 4) * laneWidth + laneOffset.x;
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

  const drawStage = (ctx: CanvasRenderingContext2D, beatBounce: number, theme: StageTheme, combo: number, currentTime: number, customStage?: SavedStage | null) => {
    // Always draw a base background to prevent black screen while layers load
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    grad.addColorStop(0, theme.bgTop);
    grad.addColorStop(1, theme.bgBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    if (customStage && customStage.stage && customStage.stage.layers && customStage.stage.layers.length > 0) {
      // Sort layers by zIndex
      const sortedLayers = [...customStage.stage.layers].sort((a, b) => a.zIndex - b.zIndex);
      
      sortedLayers.forEach(layer => {
        if (!layer.image) return;
        const img = loadedImages.current[layer.image];
        if (img && img.complete) {
          ctx.save();
          ctx.translate(CANVAS_WIDTH / 2 + layer.position.x, CANVAS_HEIGHT / 2 + layer.position.y);
          ctx.scale(layer.scale, layer.scale);
          ctx.drawImage(img, -img.width / 2, -img.height / 2);
          ctx.restore();
        }
      });
      return;
    }

    const intensity = Math.min(1, combo / 50);
    
    // Pulse the background slightly with the beat
    ctx.fillStyle = `rgba(255, 255, 255, ${beatBounce * 0.05 + intensity * 0.05})`;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

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
  };

  const drawCharacter = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    pose: string,
    isPlayer: boolean,
    bounce: number,
    characterData?: CharacterData,
    angle: number = 0
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
          const finalScale = characterData.scale * (anim.scale || 1);
          ctx.scale(finalScale, finalScale);
          if (characterData.flipX) ctx.scale(-1, 1);
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

  const updateAndDraw = (deltaTime: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !audioEngine.current) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const currentTime = audioEngine.current.getCurrentTime();
    const currentBeat = currentTime / (60 / state.current.currentBpm);
    const beatBounce = Math.abs(Math.sin(currentBeat * Math.PI)) * 15;

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

    // Apply camera shake
    if (state.current.cameraShake && currentTime < state.current.cameraShake.endTime) {
      const shake = state.current.cameraShake.intensity;
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    // Apply camera zoom
    if (state.current.cameraZoom) {
      const zoom = state.current.cameraZoom.currentZoom;
      ctx.translate(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-CANVAS_WIDTH / 2, -CANVAS_HEIGHT / 2);
    }

    // Process Events
    state.current.events.forEach(event => {
      if (currentTime >= event.time && !state.current.triggeredEvents.has(event.id)) {
        state.current.triggeredEvents.add(event.id);
        
        if (event.type === 'move') {
          state.current.lastEvents['move'] = { name: `MOVE: ${event.value.target}`, time: currentTime };
          const target = event.value.target;
          const durationSec = event.value.movementType === 'timed' ? event.value.duration * (60 / state.current.currentBpm / 4) : 0;
          const lanes = event.value.lanes || [];
          const isRelative = event.value.relative || false;
          
          if (lanes.length > 0) {
            lanes.forEach((lane: number) => {
              const startX = state.current.laneOffsets[lane].x;
              const startY = state.current.laneOffsets[lane].y;
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
            
            targets.forEach(t => {
              const startX = t === 'player' ? state.current.playerOffset.x : state.current.opponentOffset.x;
              const startY = t === 'player' ? state.current.playerOffset.y : state.current.opponentOffset.y;
              
              state.current.activeMoveTriggers.push({
                target: t as any,
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
          state.current.currentScrollSpeed = (event.value.speed || 1) * scrollSpeed;
          state.current.lastEvents['scroll'] = { name: `SCROLL SPEED: ${event.value.speed}x`, time: currentTime };
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
          const { target, rotations, duration } = event.value;
          const durationSec = (duration || 0) * (60 / state.current.currentBpm / 4);
          const targetAngle = (rotations || 0) * Math.PI * 2;
          
          const targets = target === 'all' ? ['player', 'opponent', 'notes', 'background'] : (target === 'both' ? ['player', 'opponent'] : [target]);
          
          targets.forEach(t => {
            if (state.current.activeRotations[t]) {
              state.current.activeRotations[t] = {
                angle: state.current.activeRotations[t].angle,
                startAngle: state.current.activeRotations[t].angle,
                targetAngle: state.current.activeRotations[t].angle + targetAngle,
                startTime: currentTime,
                duration: durationSec
              };
            }
          });
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
      const rot = state.current.activeRotations[target];
      if (rot.duration > 0) {
        const elapsed = currentTime - rot.startTime;
        if (elapsed < rot.duration) {
          const progress = elapsed / rot.duration;
          // Use easeInOutQuad for smoother rotation
          const easedProgress = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
          rot.angle = rot.startAngle + (rot.targetAngle - rot.startAngle) * easedProgress;
        } else {
          rot.angle = rot.targetAngle;
          rot.duration = 0; // Stop updating
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
      } else if (anim.target === 'opponent') {
        state.current.opponentOffset = { x: currentX, y: currentY };
      } else if (anim.target === 'lane') {
        state.current.laneOffsets[anim.lane] = { x: currentX, y: currentY };
      }
      
      if (progress >= 1) {
        state.current.activeMoveTriggers.splice(i, 1);
      }
    }

    // Update pose timers
    if (state.current.playerPoseTime > 0) {
      state.current.playerPoseTime -= deltaTime;
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
      else if (!note.hit && currentTime - note.time > (note.type === 'caution' ? CAUTION_HIT_WINDOWS.shit : HIT_WINDOWS.shit) + 0.1) {
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
    if (state.current.activeRotations.background.angle !== 0) {
      ctx.translate(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
      ctx.rotate(state.current.activeRotations.background.angle);
      ctx.translate(-CANVAS_WIDTH / 2, -CANVAS_HEIGHT / 2);
    }
    drawStage(ctx, beatBounce, theme, state.current.combo, currentTime, customStage);
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
    drawCharacter(ctx, 250 + state.current.opponentOffset.x, CANVAS_HEIGHT - 100 + state.current.opponentOffset.y, state.current.opponentPose, false, beatBounce, oppChar, state.current.activeRotations.opponent.angle);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = state.current.activeOpacities.player.current;
    drawCharacter(ctx, CANVAS_WIDTH - 250 + state.current.playerOffset.x, CANVAS_HEIGHT - 100 + state.current.playerOffset.y, state.current.playerPose, true, beatBounce, playerChar, state.current.activeRotations.player.angle);
    ctx.restore();

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
    ctx.save();
    if (state.current.activeRotations.notes.angle !== 0) {
      ctx.translate(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
      ctx.rotate(state.current.activeRotations.notes.angle);
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
      ctx.globalAlpha = isPlayer ? state.current.activeOpacities.notes_player.current : state.current.activeOpacities.notes_opponent.current;
      drawArrow(ctx, getLaneX(i), getLaneY(i, TARGET_Y), 50, ARROW_DIRECTIONS[directionIdx], COLORS[directionIdx], isPressed, true, false, undefined, customHitImage);
      ctx.restore();
    }

    // Draw Moving Notes
    for (let i = state.current.notes.length - 1; i >= 0; i--) {
      const note = state.current.notes[i];
      
      // Skip notes that are completely finished and off-screen
      const noteEndTime = note.time + (note.length || 0);
      if (currentTime > noteEndTime + 0.5) continue; 
      
      // Skip regular notes that were hit or missed
      if (note.length === 0 && (note.hit || note.missed)) continue;
      
      // Skip hold notes that are successfully completed
      if (note.length > 0 && note.holdCompleted) continue;
      
      const isPlayer = note.lane >= 4;
      ctx.save();
      ctx.globalAlpha = isPlayer ? state.current.activeOpacities.notes_player.current : state.current.activeOpacities.notes_opponent.current;

      const timeUntilHit = note.time - currentTime;
      const targetY = getLaneY(note.lane, TARGET_Y);
      
      // Calculate dynamic scroll position
      const getScrollPosAtTime = (time: number) => {
        const events = state.current.scrollSpeedEvents;
        if (!events || events.length === 0) return time * scrollSpeed;
        let lastEvent = events[0];
        for (let j = 1; j < events.length; j++) {
          if (events[j].time > time) break;
          lastEvent = events[j];
        }
        return lastEvent.pos + (time - lastEvent.time) * lastEvent.speed;
      };

      const currentScrollPos = getScrollPosAtTime(currentTime);
      const noteScrollPos = note.scrollPosition || (note.time * scrollSpeed);
      const y = targetY + (noteScrollPos - currentScrollPos);
      
      // Draw hold body if length > 0
      if (note.length > 0) {
        const noteEndScrollPos = note.endScrollPosition || ((note.time + note.length) * scrollSpeed);
        const holdEndY = targetY + (noteEndScrollPos - currentScrollPos);
        if (holdEndY > -100 && y < CANVAS_HEIGHT + 100) {
          const directionIdx = note.lane % 4;
          const char = isPlayer ? playerChar : oppChar;
          const color = char?.customNotes?.holdColor || COLORS[directionIdx];
          
          ctx.save();
          ctx.globalAlpha *= 0.6; // Multiply by base hold alpha
          
          // If missed or released early, make it look dimmed
          if (note.missed) {
            ctx.globalAlpha *= 0.4;
          }
          
          ctx.fillStyle = color;
          
          // Draw the hold body connecting the start note to the end
          let startY = y;
          if (note.isHolding) {
            startY = targetY;
          } else {
            startY = Math.max(targetY, y); // Don't draw past the target line
          }
          const endY = holdEndY;
          
          if (endY > startY) {
            ctx.fillRect(getLaneX(note.lane) - 15, startY, 30, endY - startY);
            
            // Add a border to the hold body
            ctx.strokeStyle = (note.type && note.type !== 'default') ? '#fff' : '#000';
            ctx.lineWidth = 3;
            ctx.strokeRect(getLaneX(note.lane) - 15, startY, 30, endY - startY);
          }
          ctx.restore();
        }
      }

      // Only draw the arrow head if it hasn't been hit yet and not missed
      if (!note.hit && !note.missed && y > -100 && y < CANVAS_HEIGHT + 100) {
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
        
        drawArrow(ctx, getLaneX(note.lane), y, 50, ARROW_DIRECTIONS[directionIdx], noteColor, false, false, false, note.type, customFallingImage);
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
    customImage?: HTMLImageElement
  ) => {
    ctx.save();
    ctx.translate(x, y);

    if (direction === 'left') ctx.rotate(-Math.PI / 2);
    else if (direction === 'down') ctx.rotate(Math.PI);
    else if (direction === 'right') ctx.rotate(Math.PI / 2);

    const scale = isPressed ? 0.85 : (isHit ? 1.2 : 1);
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

      {mobileMode && !state.current.isPaused && (
        <div className="absolute inset-0 pointer-events-none">
          {['left', 'down', 'up', 'right'].map((dir, i) => {
            const pos = mobileButtonPositions?.[i] || { x: 0, y: 0 };
            return (
              <button
                key={dir}
                className={`absolute w-20 h-20 rounded-full border-4 flex items-center justify-center pointer-events-auto active:scale-90 transition-transform ${
                  i === 0 ? 'border-purple-500 bg-purple-900/40' :
                  i === 1 ? 'border-blue-500 bg-blue-900/40' :
                  i === 2 ? 'border-green-500 bg-green-900/40' :
                  'border-red-500 bg-red-900/40'
                }`}
                style={{
                  left: `${(pos.x / CANVAS_WIDTH) * 100}%`,
                  top: `${(pos.y / CANVAS_HEIGHT) * 100}%`,
                  transform: `translate(-50%, -50%) scale(${pos.scale || 1})`
                }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  handleLaneDown(i);
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  handleLaneUp(i);
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleLaneDown(i);
                }}
                onMouseUp={(e) => {
                  e.preventDefault();
                  handleLaneUp(i);
                }}
              >
                <div className={`w-0 h-0 border-l-[15px] border-l-transparent border-r-[15px] border-r-transparent border-b-[25px] ${
                  i === 0 ? 'border-b-purple-400 -rotate-90' :
                  i === 1 ? 'border-b-blue-400 rotate-180' :
                  i === 2 ? 'border-b-green-400' :
                  'border-b-red-400 rotate-90'
                }`} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default RhythmGame;
