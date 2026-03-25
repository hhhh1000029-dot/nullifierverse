import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import RhythmGame, { StageTheme, RhythmGameRef } from './RhythmGame';
import VNPlayer from './components/VNPlayer';
import { Play, RotateCcw, Music, Settings, ArrowRight, Home, Edit3, Pause, Square, Upload, Volume2, AlertCircle, Maximize, Minimize, User, Shirt, Camera, Save, X, ChevronRight, Book, Send, Wrench, RefreshCw, LogIn, Trash2, Archive } from 'lucide-react';
import { EditorMain } from './editor/EditorMain';
import { OnlineHub } from './online/OnlineHub';
import { ArchiveMenu } from './components/ArchiveMenu';
import { SavedStage, SavedWeek, CharacterData, Animation, EventNode } from './editor/EditorTypes';
import { initAudioContext, bgmManager, sfxManager } from './audio';
import { saveSetting, getSetting, loadWeeksFromDB, loadStagesFromDB, saveStagesToDB, saveWeeksToDB } from './editor/Storage';
import { auth, loginWithGoogle, logout, onAuthStateChanged, User as FirebaseUser } from './firebase';
import { IntroSequence } from './components/IntroSequence';
import { ResultsScreen } from './components/ResultsScreen';
import { NowPlayingOverlay } from './components/NowPlayingOverlay';

type Judgements = { sick: number; good: number; bad: number; shit: number; miss: number };

const DEFAULT_PLAYER_CHARACTER: CharacterData = {
  name: 'bf',
  image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Felix',
  xml: '',
  animations: [
    { name: 'idle', prefix: 'idle', indices: [0], fps: 24, loop: true, offset: { x: 0, y: 0 } },
    { name: 'left', prefix: 'left', indices: [0], fps: 24, loop: false, offset: { x: 0, y: 0 } },
    { name: 'down', prefix: 'down', indices: [0], fps: 24, loop: false, offset: { x: 0, y: 0 } },
    { name: 'up', prefix: 'up', indices: [0], fps: 24, loop: false, offset: { x: 0, y: 0 } },
    { name: 'right', prefix: 'right', indices: [0], fps: 24, loop: false, offset: { x: 0, y: 0 } },
  ],
  scale: 1,
  flipX: false,
};

const OUTFITS = [
  { id: 'default', name: 'Default', image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Felix' },
  { id: 'casual', name: 'Casual', image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Aneka' },
  { id: 'formal', name: 'Formal', image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Aiden' },
  { id: 'cyber', name: 'Cyber', image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Caleb' },
  { id: 'magic', name: 'Magic', image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Jocelyn' },
];

const TEASER_TRACKS = [
  { id: 'stage-1774413437703-5c2s2uv8j', filename: 'palace', name: 'Palace (dave style)', bpm: 200 },
  { id: 'stage-1774311044982-tcosf0pgk', filename: 'osmu', name: 'osmu', bpm: 320 },
  { id: 'stage-1774161531112', filename: 'opposed', name: 'OPPOSED', bpm: 320 }
];

const STAGES: { name: string; bpm: number; duration: number; targetNotes?: number; scrollSpeed?: number; week: number; theme: StageTheme }[] = [
  { name: 'Week 1: Bopeebo', bpm: 100, duration: 120, targetNotes: 200, scrollSpeed: 1.5, week: 1, theme: { bgTop: '#1a1a1a', bgBottom: '#000000', grid: '#333333', stage: '#222222', particles: 'stars' } },
  { name: 'Week 1: Fresh', bpm: 120, duration: 130, targetNotes: 250, scrollSpeed: 1.6, week: 1, theme: { bgTop: '#1a1a1a', bgBottom: '#000000', grid: '#333333', stage: '#222222', particles: 'stars' } },
  { name: 'Week 1: Dad Battle', bpm: 180, duration: 140, targetNotes: 400, scrollSpeed: 1.8, week: 1, theme: { bgTop: '#1a1a1a', bgBottom: '#000000', grid: '#333333', stage: '#222222', particles: 'stars' } },
  { name: 'Week 2: Spookeez', bpm: 150, duration: 150, targetNotes: 350, scrollSpeed: 1.7, week: 2, theme: { bgTop: '#0a0a1a', bgBottom: '#000000', grid: '#1a1a3a', stage: '#111122', particles: 'rain' } },
  { name: 'Week 2: South', bpm: 165, duration: 160, targetNotes: 450, scrollSpeed: 1.9, week: 2, theme: { bgTop: '#0a0a1a', bgBottom: '#000000', grid: '#1a1a3a', stage: '#111122', particles: 'rain' } },
  { name: 'Week 3: Pico', bpm: 150, duration: 140, targetNotes: 500, scrollSpeed: 2.0, week: 3, theme: { bgTop: '#1a1a1a', bgBottom: '#000000', grid: '#333333', stage: '#222222', particles: 'embers' } },
  { name: 'Week 3: Philly Nice', bpm: 175, duration: 150, targetNotes: 600, scrollSpeed: 2.2, week: 3, theme: { bgTop: '#1a1a1a', bgBottom: '#000000', grid: '#333333', stage: '#222222', particles: 'embers' } },
  { name: 'Week 3: Blammed', bpm: 165, duration: 160, targetNotes: 700, scrollSpeed: 2.4, week: 3, theme: { bgTop: '#1a1a1a', bgBottom: '#000000', grid: '#333333', stage: '#222222', particles: 'embers' } },
  { name: 'Week 4: Satin Panties', bpm: 110, duration: 130, targetNotes: 300, scrollSpeed: 1.6, week: 4, theme: { bgTop: '#2a0a1a', bgBottom: '#000000', grid: '#3a1a2a', stage: '#22111a', particles: 'stars' } },
  { name: 'Week 4: High', bpm: 180, duration: 140, targetNotes: 500, scrollSpeed: 1.9, week: 4, theme: { bgTop: '#2a0a1a', bgBottom: '#000000', grid: '#3a1a2a', stage: '#22111a', particles: 'stars' } },
  { name: 'Week 4: Milf', bpm: 180, duration: 150, targetNotes: 800, scrollSpeed: 2.5, week: 4, theme: { bgTop: '#2a0a1a', bgBottom: '#000000', grid: '#3a1a2a', stage: '#22111a', particles: 'stars' } },
  { name: 'Week 0: Test Stage', bpm: 100, duration: 60, targetNotes: 100, scrollSpeed: 1.5, week: 0, theme: { bgTop: '#000000', bgBottom: '#000000', grid: '#ffffff', stage: '#333333', particles: 'stars' } },
];

const MobileLayoutEditor = ({ 
  positions, 
  onSave, 
  onCancel 
}: { 
  positions: { x: number, y: number, scale: number }[], 
  onSave: (newPos: { x: number, y: number, scale: number }[]) => void, 
  onCancel: () => void 
}) => {
  const [localPos, setLocalPos] = useState([...positions]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleDragEnd = (i: number, info: any) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    
    // Calculate relative position within the container
    const x = Math.max(0, Math.min(1024, ((info.point.x - rect.left) / rect.width) * 1024));
    const y = Math.max(0, Math.min(576, ((info.point.y - rect.top) / rect.height) * 576));
    
    const newPos = [...localPos];
    newPos[i] = { ...newPos[i], x, y };
    setLocalPos(newPos);
  };

  return (
    <div className="fixed inset-0 z-[10000] bg-black/95 flex flex-col items-center justify-center p-4 backdrop-blur-xl">
      <div className="w-full max-w-5xl aspect-video bg-zinc-900 border-4 border-blue-500/50 rounded-3xl relative overflow-hidden shadow-[0_0_50px_rgba(59,130,246,0.3)]" ref={containerRef}>
        <div className="absolute inset-0 grid grid-cols-12 grid-rows-12 opacity-10 pointer-events-none">
           {Array.from({ length: 144 }).map((_, i) => (
             <div key={i} className="border border-blue-400" />
           ))}
        </div>
        
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-blue-600 px-6 py-2 parallelogram shadow-lg z-20">
          <span className="text-white font-black italic uppercase tracking-widest text-sm">DRAG BUTTONS TO REPOSITION</span>
        </div>

        {localPos.map((pos, i) => (
          <motion.div
            key={i}
            drag
            dragMomentum={false}
            onDragEnd={(e, info) => handleDragEnd(i, info)}
            onPointerDown={() => setSelectedIdx(i)}
            className={`absolute w-20 h-20 rounded-full border-4 flex items-center justify-center cursor-move touch-none ${
              selectedIdx === i ? 'ring-4 ring-white ring-offset-4 ring-offset-black' : ''
            } ${
              i === 0 ? 'border-purple-500 bg-purple-900/40' :
              i === 1 ? 'border-blue-500 bg-blue-900/40' :
              i === 2 ? 'border-green-500 bg-green-900/40' :
              'border-red-500 bg-red-900/40'
            }`}
            style={{
              left: `${(pos.x / 1024) * 100}%`,
              top: `${(pos.y / 576) * 100}%`,
              transform: `translate(-50%, -50%) scale(${pos.scale || 1})`,
              zIndex: selectedIdx === i ? 30 : 10
            }}
          >
            <div className={`w-0 h-0 border-l-[15px] border-l-transparent border-r-[15px] border-r-transparent border-b-[25px] ${
              i === 0 ? 'border-b-purple-400 -rotate-90' :
              i === 1 ? 'border-b-blue-400 rotate-180' :
              i === 2 ? 'border-b-green-400' :
              'border-b-red-400 rotate-90'
            }`} />
          </motion.div>
        ))}
      </div>

      <div className="mt-8 w-full max-w-lg flex flex-col items-center gap-6">
        {selectedIdx !== null && (
          <div className="w-full bg-zinc-800/80 border border-white/10 p-6 rounded-3xl backdrop-blur-md flex flex-col items-center gap-4">
            <h4 className="text-xl font-black italic text-white uppercase tracking-widest">
              {['LEFT', 'DOWN', 'UP', 'RIGHT'][selectedIdx]} BUTTON SCALE
            </h4>
            <div className="flex items-center gap-4 w-full">
              <button 
                onClick={() => {
                  const newPos = [...localPos];
                  newPos[selectedIdx].scale = Math.max(0.5, newPos[selectedIdx].scale - 0.1);
                  setLocalPos(newPos);
                }}
                className="w-12 h-12 bg-zinc-700 rounded-full flex items-center justify-center hover:bg-zinc-600 active:scale-90 transition-all"
              >
                <Minimize className="w-6 h-6 text-white" />
              </button>
              <input 
                type="range" min="0.5" max="2.5" step="0.1"
                value={localPos[selectedIdx].scale}
                onChange={(e) => {
                  const newPos = [...localPos];
                  newPos[selectedIdx].scale = parseFloat(e.target.value);
                  setLocalPos(newPos);
                }}
                className="flex-1 h-2 bg-blue-900/50 rounded-full appearance-none cursor-pointer accent-blue-400"
              />
              <button 
                onClick={() => {
                  const newPos = [...localPos];
                  newPos[selectedIdx].scale = Math.min(2.5, newPos[selectedIdx].scale + 0.1);
                  setLocalPos(newPos);
                }}
                className="w-12 h-12 bg-zinc-700 rounded-full flex items-center justify-center hover:bg-zinc-600 active:scale-90 transition-all"
              >
                <Maximize className="w-6 h-6 text-white" />
              </button>
            </div>
            <span className="text-blue-400 font-black italic">{(localPos[selectedIdx].scale * 100).toFixed(0)}%</span>
          </div>
        )}

        <div className="flex gap-4 w-full">
          <button 
            onClick={onCancel}
            className="flex-1 h-16 bg-zinc-800 text-white font-black tracking-widest uppercase italic flex items-center justify-center gap-3 rounded-2xl hover:bg-zinc-700 transition-all active:scale-95 border border-white/10"
          >
            <X className="w-6 h-6" />
            CANCEL
          </button>
          <button 
            onClick={() => onSave(localPos)}
            className="flex-1 h-16 bg-gradient-to-r from-blue-600 to-cyan-600 text-white font-black tracking-widest uppercase italic flex items-center justify-center gap-3 rounded-2xl hover:brightness-110 transition-all active:scale-95 shadow-lg"
          >
            <Save className="w-6 h-6" />
            SAVE LAYOUT
          </button>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [screen, setScreen] = useState<'INTRO' | 'START' | 'PLAYING' | 'GAMEOVER' | 'SETTINGS' | 'LEVEL_COMPLETE' | 'VICTORY' | 'STORY_MODE_MENU' | 'FREE_PLAY_MENU' | 'EDITOR' | 'ONLINE_HUB' | 'WEEK_RESULTS' | 'NEXT_SONG_RESULTS' | 'STORY_CUTSCENE' | 'ARCHIVE'>('INTRO');
  const [gameMode, setGameMode] = useState<'STORY' | 'FREEPLAY' | 'EDITOR' | 'WEEK_PLAYTEST' | 'CUSTOM_STORY'>('STORY');
  const [results, setResults] = useState<{ score: number; judgements: Judgements; reason?: string; maxCombo: number; clearTime?: string; difficulty?: string } | null>(null);
  const [levelStartTime, setLevelStartTime] = useState<number>(0);
  const gameRef = useRef<RhythmGameRef>(null);
  const [currentStage, setCurrentStage] = useState(0);
  const [customStage, setCustomStage] = useState<SavedStage | null>(null);
  const [playtestWeek, setPlaytestWeek] = useState<SavedWeek | null>(null);
  const [weekPlaytestIndex, setWeekPlaytestIndex] = useState(0);
  const [weekPlaytestResults, setWeekPlaytestResults] = useState<{ stageName: string; score: number; judgements: Judgements; maxCombo: number }[]>([]);
  const [weekPlaytestStages, setWeekPlaytestStages] = useState<SavedStage[]>([]);
  const [storyProgress, setStoryProgress] = useState<{ week: SavedWeek; index: number; stages: SavedStage[] } | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [activeSettingsCategory, setActiveSettingsCategory] = useState<string>('Gameplay mode');
  const [settings, setSettings] = useState({
    botplay: false,
    practiceMode: false,
    keys: ['a', 's', 'w', 'd'],
    bgmVolume: 0.5,
    customBg: null as string | null,
    morningBg: null as string | null,
    eveningBg: null as string | null,
    addedCustomWeeks: [] as string[],
    hiddenDefaultWeeks: [] as number[],
    mobileMode: false,
    mobileButtonPositions: [
      { x: 100, y: 400, scale: 1 }, // Left
      { x: 220, y: 450, scale: 1 }, // Down
      { x: 800, y: 450, scale: 1 }, // Up
      { x: 920, y: 400, scale: 1 }  // Right
    ]
  });
  const [editingKey, setEditingKey] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentSongName, setCurrentSongName] = useState('');
  const [showPauseSettings, setShowPauseSettings] = useState(false);
  const [showMobileLayoutEditor, setShowMobileLayoutEditor] = useState(false);
  const [playerCharacter, setPlayerCharacter] = useState<CharacterData>(DEFAULT_PLAYER_CHARACTER);
  const [showOutfitPopup, setShowOutfitPopup] = useState(false);
  const [showPosesPopup, setShowPosesPopup] = useState(false);
  const [showDebugFlow, setShowDebugFlow] = useState(false);
  const [tempPoses, setTempPoses] = useState<Record<string, string>>({});
  const [tempFlips, setTempFlips] = useState<Record<string, boolean>>({});
  const [activePose, setActivePose] = useState('idle');
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<number | string>('teaser-chart');
  const [isLoadingTeaser, setIsLoadingTeaser] = useState(false);
  const [selectedFreePlayStage, setSelectedFreePlayStage] = useState<number | string>('stage-1774413437703-5c2s2uv8j');
  const [allCustomWeeks, setAllCustomWeeks] = useState<SavedWeek[]>([]);
  const [allCustomStages, setAllCustomStages] = useState<SavedStage[]>([]);
  const [showExtraWeekModal, setShowExtraWeekModal] = useState(false);
  const [selectedCustomWeeks, setSelectedCustomWeeks] = useState<string[]>([]);
  const [itemToDelete, setItemToDelete] = useState<{ type: 'week' | 'stage' | 'defaultWeek', id: string | number } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [nullifierUnlocked, setNullifierUnlocked] = useState(false);
  const [inputBuffer, setInputBuffer] = useState('');

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName;
      const isInput = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || (document.activeElement as HTMLElement)?.isContentEditable;
      if (isInput) return;

      if (e.key.length === 1) {
        const newBuffer = (inputBuffer + e.key).slice(-15);
        setInputBuffer(newBuffer);
        if (newBuffer.toLowerCase().includes('nullifier')) {
          setNullifierUnlocked(true);
          try { sfxManager.playConfirm(); } catch(err) {}
          setInputBuffer('');
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [inputBuffer]);

  useEffect(() => {
    if (screen === 'PLAYING') {
      setLevelStartTime(Date.now());
    }
  }, [screen]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
        setIsFullscreen(false);
      });
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false);
      }).catch(err => {
        console.error(`Error attempting to exit full-screen mode: ${err.message} (${err.name})`);
        setIsFullscreen(!!document.fullscreenElement);
      });
    }
  };

  const [isBgmLoaded, setIsBgmLoaded] = useState(false);
  const [isAudioContextInitialized, setIsAudioContextInitialized] = useState(false);
  const bgmLoadedRef = useRef(false);
  const screenRef = useRef(screen);

  useEffect(() => {
    bgmLoadedRef.current = isBgmLoaded;
  }, [isBgmLoaded]);

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  useEffect(() => {
    const handleInteraction = () => {
      initAudioContext();
      setIsAudioContextInitialized(true);
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
    };
    window.addEventListener('click', handleInteraction);
    window.addEventListener('keydown', handleInteraction);

    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    if (!document.fullscreenEnabled) {
      console.warn("Fullscreen is not enabled in this document/environment. If you are in an iframe, it might be blocked by the 'allow' attribute.");
    }
    
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Toggle fullscreen with Tab key or F11, but only if not in an input/textarea
      if ((e.key === 'Tab' || e.key === 'F11') && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const activeTag = document.activeElement?.tagName;
        const isInput = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || (document.activeElement as HTMLElement)?.isContentEditable;
        
        if (!isInput && document.fullscreenEnabled) {
          e.preventDefault();
          toggleFullscreen();
        } else if (!isInput && !document.fullscreenEnabled) {
          console.warn("Fullscreen toggle attempted but document.fullscreenEnabled is false.");
        }
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    handleFullscreenChange(); // Sync initial state
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const loadSettings = async () => {
      const savedKeys = await getSetting('keys');
      const savedBotplay = await getSetting('botplay');
      const savedPractice = await getSetting('practiceMode');
      const savedVolume = await getSetting('bgmVolume');
      const savedBgm = await getSetting('menuBgm');
      const savedBg = await getSetting('customBg');
      const savedMorningBg = await getSetting('morningBg');
      const savedEveningBg = await getSetting('eveningBg');
      const savedCharacter = await getSetting('playerCharacter');
      const savedAddedWeeks = await getSetting('addedCustomWeeks');
      const savedHiddenWeeks = await getSetting('hiddenDefaultWeeks');
      const savedMobileMode = await getSetting('mobileMode');
      const savedMobileButtonPositions = await getSetting('mobileButtonPositions');

      if (savedCharacter) {
        setPlayerCharacter(savedCharacter);
      }

      setSettings(prev => ({
        ...prev,
        keys: savedKeys || prev.keys,
        botplay: savedBotplay !== undefined ? savedBotplay : prev.botplay,
        practiceMode: savedPractice !== undefined ? savedPractice : prev.practiceMode,
        bgmVolume: savedVolume !== undefined ? savedVolume : prev.bgmVolume,
        customBg: savedBg || null,
        morningBg: savedMorningBg || null,
        eveningBg: savedEveningBg || null,
        addedCustomWeeks: savedAddedWeeks || [],
        hiddenDefaultWeeks: savedHiddenWeeks || [],
        mobileMode: savedMobileMode !== undefined ? savedMobileMode : prev.mobileMode,
        mobileButtonPositions: savedMobileButtonPositions || prev.mobileButtonPositions
      }));

      if (savedBgm) {
        // Handle custom BGM
        await bgmManager.loadTrackFromBuffer('menu', savedBgm);
      } else {
        // Load default BGM if no custom one is saved
        await bgmManager.loadTrack('menu', '/Menu_Bgm.mp3');
      }
      setIsBgmLoaded(true);
    };
    loadSettings();
  }, []);

  useEffect(() => {
    if (isAudioContextInitialized && isBgmLoaded && ['START', 'SETTINGS', 'STORY_MODE_MENU', 'FREE_PLAY_MENU', 'ONLINE_HUB', 'EDITOR'].includes(screen)) {
      bgmManager.play('menu');
    }
  }, [isAudioContextInitialized, isBgmLoaded, screen]);

  useEffect(() => {
    // BGM Transition Logic
    const updateBgm = async () => {
      // Ensure AudioContext is active
      initAudioContext();

      if (['INTRO', 'PLAYING', 'STORY_CUTSCENE'].includes(screen) || (screen === 'EDITOR' && isEditing)) {
        // Stop BGM during gameplay, intro, or when editing in the editor
        bgmManager.stopTrack('menu');
      } else {
        // Resume BGM for menus
        bgmManager.play('menu', 1.5);
        setCurrentSongName('Main Menu Theme');
      }
    };

    updateBgm();

    // SFX Ducking Logic
    sfxManager.setDucking(['PLAYING', 'STORY_CUTSCENE'].includes(screen));

    if (screen === 'STORY_MODE_MENU' || screen === 'FREE_PLAY_MENU') {
      loadWeeksFromDB().then(weeks => setAllCustomWeeks(weeks));
      loadStagesFromDB().then(stages => setAllCustomStages(stages));
    }
  }, [screen, isEditing]);

  const saveAllSettings = async (newSettings: typeof settings) => {
    setSettings(newSettings);
    await saveSetting('keys', newSettings.keys);
    await saveSetting('botplay', newSettings.botplay);
    await saveSetting('practiceMode', newSettings.practiceMode);
    await saveSetting('bgmVolume', newSettings.bgmVolume);
    await saveSetting('customBg', newSettings.customBg);
    await saveSetting('morningBg', newSettings.morningBg);
    await saveSetting('eveningBg', newSettings.eveningBg);
    await saveSetting('addedCustomWeeks', newSettings.addedCustomWeeks);
    await saveSetting('mobileMode', newSettings.mobileMode);
    await saveSetting('mobileButtonPositions', newSettings.mobileButtonPositions);
  };

  const handleBgmUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const data = event.target?.result as ArrayBuffer;
        await saveSetting('menuBgm', data);
        await bgmManager.loadTrackFromBuffer('menu', data);
        if (!['INTRO', 'PLAYING', 'STORY_CUTSCENE'].includes(screen)) {
          bgmManager.play('menu');
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const handleDeleteItem = async () => {
    if (!itemToDelete) return;
    
    if (itemToDelete.type === 'week') {
      const newWeeks = allCustomWeeks.filter(w => w.id !== itemToDelete.id);
      setAllCustomWeeks(newWeeks);
      await saveWeeksToDB(newWeeks);
      
      const newAdded = settings.addedCustomWeeks.filter(id => id !== itemToDelete.id);
      await saveAllSettings({ ...settings, addedCustomWeeks: newAdded });
      
      if (selectedWeek === itemToDelete.id) {
        setSelectedWeek(1);
      }
    } else if (itemToDelete.type === 'defaultWeek') {
      const newHidden = [...settings.hiddenDefaultWeeks, itemToDelete.id as number];
      await saveAllSettings({ ...settings, hiddenDefaultWeeks: newHidden });
      
      if (selectedWeek === itemToDelete.id) {
        // Find first non-hidden default week or fallback to 1
        const remaining = [1, 2, 3, 4].filter(id => !newHidden.includes(id));
        setSelectedWeek(remaining[0] || 1);
      }
    } else if (itemToDelete.type === 'stage') {
      const newStages = allCustomStages.filter(s => s.id !== itemToDelete.id);
      setAllCustomStages(newStages);
      await saveStagesToDB(newStages);
      
      const newWeeks = allCustomWeeks.map(w => ({
        ...w,
        tracks: w.tracks.filter(tid => tid !== itemToDelete.id)
      }));
      setAllCustomWeeks(newWeeks);
      await saveWeeksToDB(newWeeks);
      
      if (selectedFreePlayStage === itemToDelete.id) {
        setSelectedFreePlayStage(0);
      }
    }
    
    setItemToDelete(null);
  };

  const handleBgUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'custom' | 'morning' | 'evening' = 'custom') => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const dataUrl = event.target?.result as string;
        if (type === 'morning') {
          saveAllSettings({ ...settings, morningBg: dataUrl });
        } else if (type === 'evening') {
          saveAllSettings({ ...settings, eveningBg: dataUrl });
        } else {
          saveAllSettings({ ...settings, customBg: dataUrl });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleKeyEdit = (index: number) => {
    setEditingKey(index);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (editingKey !== null) {
      e.preventDefault();
      const newKeys = [...settings.keys];
      newKeys[editingKey] = e.key.toLowerCase();
      saveAllSettings({ ...settings, keys: newKeys });
      setEditingKey(null);
    }
  };

  const handleNextStoryNode = (progress: { week: SavedWeek; index: number; stages: SavedStage[] } | null) => {
    if (!progress) return;
    const { week, index, stages } = progress;
    
    if (index >= (week.sequence?.length || 0)) {
      setScreen('WEEK_RESULTS');
      return;
    }

    const node = week.sequence[index];
    if (node.type === 'CUTSCENE') {
      setScreen('STORY_CUTSCENE');
    } else {
      const stage = stages.find(s => s.id === node.dataId);
      if (stage) {
        setCustomStage(stage);
        setCurrentSongName(stage.name);
        setScreen('PLAYING');
      } else {
        // Skip missing stage
        handleNextStoryNode({ ...progress, index: index + 1 });
      }
    }
  };

  const startGame = (stageIndex: number = 0, custom?: SavedStage, rate: number = 1, week?: SavedWeek, allStages?: SavedStage[], modeOverride?: 'STORY' | 'FREEPLAY' | 'EDITOR' | 'WEEK_PLAYTEST' | 'CUSTOM_STORY') => {
    initAudioContext();
    bgmManager.stopTrack('artcore');
    bgmManager.stopTrack('breakcore');
    setPlaybackRate(rate);
    
    if (modeOverride) {
      setGameMode(modeOverride);
    }
    
    if (week && allStages) {
      // Handle Story Mode (Sequence-based)
      if (week.sequence && week.sequence.length > 0) {
        const progress = { week, index: stageIndex, stages: allStages };
        setStoryProgress(progress);
        setPlaytestWeek(week);
        setWeekPlaytestStages(allStages);
        if (stageIndex === 0) setWeekPlaytestResults([]);
        setGameMode(modeOverride || 'CUSTOM_STORY');
        handleNextStoryNode(progress);
        return;
      }
      
      // Legacy Track-based
      setPlaytestWeek(week);
      setWeekPlaytestIndex(stageIndex);
      setWeekPlaytestStages(allStages);
      if (stageIndex === 0) {
        setWeekPlaytestResults([]);
      }
      if (!modeOverride) setGameMode('WEEK_PLAYTEST');
      const trackId = week.tracks[stageIndex];
      const stage = allStages.find(s => s.id === trackId);
      if (stage) {
        setCustomStage(stage);
        setCurrentSongName(stage.name);
        setScreen('PLAYING');
      } else {
        alert('Stage not found in week!');
        setScreen(modeOverride === 'CUSTOM_STORY' ? 'STORY_MODE_MENU' : 'EDITOR');
      }
      return;
    }
    
    if (custom) {
      setCustomStage(custom);
      setCurrentSongName(custom.name);
      if (!modeOverride) setGameMode('EDITOR');
      setScreen('PLAYING');
      return;
    }

    if (STAGES[stageIndex]) {
      setCurrentStage(stageIndex);
      setCurrentSongName(STAGES[stageIndex].name);
      setScreen('PLAYING');
    } else {
      setScreen('START');
    }
  };

  const handleLevelComplete = (score: number, judgements: Judgements, maxCombo: number) => {
    const timeSpentMs = Date.now() - levelStartTime;
    const minutes = Math.floor(timeSpentMs / 60000);
    const seconds = Math.floor((timeSpentMs % 60000) / 1000);
    const clearTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    // Determine difficulty based on scroll speed or other factors if available
    let difficulty = "NORMAL";
    if (customStage) {
      if (customStage.chart.scrollSpeed > 2.5) difficulty = "HARD";
      else if (customStage.chart.scrollSpeed < 1.5) difficulty = "EASY";
    } else if (STAGES[currentStage]) {
      if (STAGES[currentStage].scrollSpeed && STAGES[currentStage].scrollSpeed > 2.5) difficulty = "HARD";
      else if (STAGES[currentStage].scrollSpeed && STAGES[currentStage].scrollSpeed < 1.5) difficulty = "EASY";
    }

    setResults({ score, judgements, maxCombo, clearTime, difficulty });
    
    if (gameMode === 'CUSTOM_STORY' && storyProgress) {
      const node = storyProgress.week.sequence[storyProgress.index];
      const stageName = storyProgress.stages.find(s => s.id === node.dataId)?.name || 'Unknown Stage';
      const newResults = [...weekPlaytestResults, { stageName, score, judgements, maxCombo }];
      setWeekPlaytestResults(newResults);
      
      const nextIndex = storyProgress.index + 1;
      setStoryProgress({ ...storyProgress, index: nextIndex });
      
      if (nextIndex < (storyProgress.week.sequence?.length || 0)) {
        setScreen('NEXT_SONG_RESULTS');
      } else {
        setScreen('WEEK_RESULTS');
      }
      return;
    }

    if (gameMode === 'WEEK_PLAYTEST' && playtestWeek) {
      const stageName = customStage?.name || 'Unknown Stage';
      const newResults = [...weekPlaytestResults, { stageName, score, judgements, maxCombo }];
      setWeekPlaytestResults(newResults);
      
      if (weekPlaytestIndex < playtestWeek.tracks.length - 1) {
        setScreen('NEXT_SONG_RESULTS');
      } else {
        setScreen('WEEK_RESULTS');
      }
      return;
    }

    if (gameMode === 'STORY') {
      const currentWeek = STAGES[currentStage]?.week;
      const weekStages = STAGES.filter(s => s.week === currentWeek);
      const lastStageInWeek = STAGES.indexOf(weekStages[weekStages.length - 1]);

      if (currentStage < lastStageInWeek) {
        setScreen('NEXT_SONG_RESULTS');
      } else {
        setScreen('LEVEL_COMPLETE');
      }
    } else {
      setScreen('LEVEL_COMPLETE');
    }
  };

  const getDynamicBg = () => {
    const hour = new Date().getHours();
    // Morning: 6 AM to 6 PM (18:00)
    const isMorning = hour >= 6 && hour < 18;
    
    if (isMorning) {
      return settings.morningBg || settings.customBg || '/morning_background.jpg';
    } else {
      return settings.eveningBg || settings.customBg || '/Evening_Background.png';
    }
  };

  useEffect(() => {
    console.log('App: Current screen is', screen);
  }, [screen]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center font-sans selection:bg-pink-500/30 overflow-hidden relative">
      {/* Landscape Warning Overlay */}
      <div className="landscape-warning fixed inset-0 z-[9999] bg-black hidden flex-col items-center justify-center p-10 text-center">
        <div className="w-32 h-32 border-4 border-blue-500 rounded-2xl animate-bounce flex items-center justify-center mb-8">
          <div className="w-24 h-12 border-2 border-blue-400 rounded-lg rotate-90" />
        </div>
        <h2 className="text-4xl font-black italic uppercase text-white mb-4 tracking-widest">PLEASE ROTATE DEVICE</h2>
        <p className="text-blue-300 font-bold uppercase tracking-tighter">This game is best played in landscape mode</p>
      </div>

      <AnimatePresence mode="wait">
        {screen === 'INTRO' && (
          <IntroSequence key="intro" onComplete={() => {
            console.log('App: Intro complete, transitioning to START');
            setScreen('START');
          }} />
        )}

        {screen === 'STORY_CUTSCENE' && storyProgress && storyProgress.week.vnData && (
          <VNPlayer 
            vnData={storyProgress.week.vnData}
            startSceneId={storyProgress.week.sequence[storyProgress.index].dataId}
            onComplete={() => {
              const nextIndex = storyProgress.index + 1;
              const nextProgress = { ...storyProgress, index: nextIndex };
              setStoryProgress(nextProgress);
              handleNextStoryNode(nextProgress);
            }}
            onMusicChange={(name) => setCurrentSongName(name)}
          />
        )}

        {screen === 'START' && (
          <motion.div 
            key="START"
            initial={{ opacity: 0, scale: 1.1 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, filter: 'blur(10px)' }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full h-screen flex overflow-hidden bg-black"
          >
          {/* Left Side: Navigation */}
          <div className="w-1/3 h-full flex flex-col p-12 z-10 bg-zinc-900/50 backdrop-blur-xl border-r border-white/5 relative overflow-hidden">
            {/* Scanline Effect */}
            <div className="absolute inset-0 pointer-events-none opacity-[0.03] bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%]" />
            
            <div className="mb-16 relative z-10">
              <img src="/intro_logo.png" alt="NULLIFIERVERSE" className="w-full h-auto max-w-[280px] animate-pulse-soft" />
              <div className="h-1 w-20 bg-pink-500 mt-2 rounded-full" />
            </div>

            <div className="flex flex-col gap-3 flex-1">
              {[
                { id: 'STORY', label: 'STORY MODE', icon: <Book className="w-6 h-6" />, screen: 'STORY_MODE_MENU', color: 'from-pink-500 to-rose-600' },
                { id: 'FREEPLAY', label: 'FREEPLAY', icon: <Send className="w-6 h-6" />, screen: 'FREE_PLAY_MENU', color: 'from-cyan-500 to-blue-600' },
                { id: 'EDITOR', label: 'EDITOR', icon: <Wrench className="w-6 h-6" />, screen: 'EDITOR', color: 'from-yellow-500 to-orange-600' },
                { id: 'SETTINGS', label: 'SETTINGS', icon: <Settings className="w-6 h-6" />, screen: 'SETTINGS', color: 'from-zinc-500 to-zinc-700' },
                { id: 'ONLINE', label: 'ONLINE', icon: <ChevronRight className="w-6 h-6" />, screen: 'ONLINE_HUB', color: 'from-purple-500 to-indigo-600' },
              ].map((item) => (
                <motion.button
                  key={item.id}
                  whileHover={{ x: 12 }}
                  whileTap={{ scale: 0.98 }}
                  onMouseEnter={() => sfxManager.playHover()}
                  onClick={() => {
                    sfxManager.playConfirm();
                    setScreen(item.screen as any);
                  }}
                  className="group relative flex items-center gap-6 p-4 rounded-2xl transition-all overflow-hidden rainbow-neon-border"
                >
                  {/* Hover Background */}
                  <div className="absolute inset-0 bg-white/0 group-hover:bg-white/5 transition-colors" />
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b opacity-0 group-hover:opacity-100 transition-opacity rounded-full" style={{ backgroundImage: `linear-gradient(to bottom, var(--tw-gradient-from), var(--tw-gradient-to))` }} />
                  
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center bg-zinc-800/50 border border-white/10 group-hover:border-white/30 group-hover:shadow-[0_0_20px_rgba(255,255,255,0.1)] transition-all text-zinc-500 group-hover:text-white relative z-10 rainbow-neon-border`}>
                    <div className={`absolute inset-0 bg-gradient-to-br ${item.color} opacity-0 group-hover:opacity-20 transition-opacity rounded-xl`} />
                    {item.icon}
                  </div>
                  
                  <div className="flex flex-col relative z-10">
                    <span className="text-xl font-black tracking-widest text-zinc-500 group-hover:text-white transition-colors italic uppercase">
                      {item.label}
                    </span>
                    <div className="h-0.5 w-0 group-hover:w-full bg-white/20 transition-all duration-300" />
                  </div>

                  {/* Selection Indicator Arrow */}
                  <motion.div 
                    initial={{ opacity: 0, x: -10 }}
                    whileHover={{ opacity: 1, x: 0 }}
                    className="ml-auto text-white/20 group-hover:text-white transition-colors"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </motion.div>
                </motion.button>
              ))}
            </div>

            <div className="text-zinc-600 font-bold tracking-widest uppercase text-xs">
              v1.0.0-NULLIFIER
            </div>
          </div>

          {/* Right Side: Character Customization */}
          <div className="flex-1 h-full relative flex flex-col p-12 overflow-hidden">
            {/* Background Decoration */}
            <div 
              className="absolute inset-0 bg-cover bg-center opacity-40"
              style={{ backgroundImage: `url(${getDynamicBg()})` }}
            />
            <div className="absolute inset-0 bg-gradient-to-br from-zinc-900/80 via-black/80 to-zinc-900/80" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-pink-500/10 rounded-full blur-[120px]" />
            <div className="absolute top-1/4 right-1/4 w-[400px] h-[400px] bg-cyan-500/10 rounded-full blur-[100px]" />

            <div className="relative z-10 flex justify-between items-start">
              <div />
              <div className="text-right">
                {user ? (
                  <div className="bg-white/5 backdrop-blur-md border border-white/10 p-4 rounded-2xl flex items-center gap-4 shadow-xl">
                    <div className="text-right">
                      <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Logged in as</p>
                      <p className="text-xl font-black text-white uppercase italic">{user.displayName || 'Player'}</p>
                    </div>
                    {user.photoURL ? (
                      <img src={user.photoURL} alt="Avatar" className="w-12 h-12 rounded-full border-2 border-pink-500 object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-pink-500 flex items-center justify-center text-white font-black text-xl">
                        {(user.displayName || 'P')[0].toUpperCase()}
                      </div>
                    )}
                    <button 
                      onClick={logout}
                      className="p-2 hover:bg-white/10 rounded-lg text-zinc-500 hover:text-red-400 transition-colors"
                      title="Logout"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={loginWithGoogle}
                    className="bg-white text-black px-8 py-3 rounded-2xl font-black tracking-widest uppercase hover:bg-zinc-200 transition-all flex items-center gap-3 shadow-xl active:scale-95"
                  >
                    <LogIn className="w-5 h-5" />
                    LOGIN
                  </button>
                )}
              </div>
            </div>

            {/* Character Display */}
            <div className="flex-1 relative flex items-center justify-center z-10">
              {playerCharacter.image === DEFAULT_PLAYER_CHARACTER.image && !playerCharacter.animations.some(a => a.image) ? (
                <div className="text-center p-8 bg-white/5 backdrop-blur-md rounded-3xl border border-white/10 max-w-md">
                  <AlertCircle className="w-12 h-12 text-zinc-500 mx-auto mb-4" />
                  <p className="text-zinc-400 font-bold tracking-widest uppercase text-sm">
                    Please upload the character poses from the character gallery.
                  </p>
                </div>
              ) : (
                <motion.div 
                  className="relative group cursor-pointer" 
                  onClick={() => {
                    const poses = ['idle', 'left', 'down', 'up', 'right'];
                    const nextIndex = (poses.indexOf(activePose) + 1) % poses.length;
                    setActivePose(poses[nextIndex]);
                  }}
                  animate={{ y: [0, -10, 0] }}
                  transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                >
                  <div className="absolute inset-0 bg-white/5 blur-3xl rounded-full scale-150 opacity-0 group-hover:opacity-100 transition-opacity" />
                  <motion.img 
                    key={activePose}
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    src={playerCharacter.animations?.find(a => a.name === activePose)?.image || playerCharacter.image} 
                    alt="Character" 
                    className="w-[400px] h-[400px] object-contain drop-shadow-[0_0_50px_rgba(255,255,255,0.1)] transition-transform hover:scale-105"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-white/5 backdrop-blur-md px-4 py-1 rounded-full border border-white/10 text-[10px] font-black uppercase tracking-widest text-zinc-500">
                    Pose: {activePose}
                  </div>
                </motion.div>
              )}
            </div>

            {/* Control Panel */}
            <div className="relative z-10 flex justify-end">
              <div className="bg-zinc-900/80 backdrop-blur-xl border border-white/5 p-6 rounded-3xl flex gap-4 shadow-2xl">
                <button 
                  onClick={() => {
                    const initialTempPoses: Record<string, string> = {};
                    const initialTempFlips: Record<string, boolean> = {};
                    playerCharacter.animations.forEach(anim => {
                      if (anim.image) initialTempPoses[anim.name] = anim.image;
                      initialTempFlips[anim.name] = !!anim.flipX;
                    });
                    setTempPoses(initialTempPoses);
                    setTempFlips(initialTempFlips);
                    setShowPosesPopup(true);
                  }}
                  className="flex flex-col items-center gap-2 p-4 rounded-2xl hover:bg-white/5 transition-all group"
                >
                  <div className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center group-hover:text-cyan-400 group-hover:shadow-[0_0_15px_rgba(34,211,238,0.3)] transition-all">
                    <Camera className="w-6 h-6" />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 group-hover:text-white">
                    CHARACTER GALLERY
                  </span>
                </button>

                <button 
                  onClick={() => {
                    sfxManager.playConfirm();
                    setScreen('ARCHIVE');
                  }}
                  className="flex flex-col items-center gap-2 p-4 rounded-2xl hover:bg-white/5 transition-all group"
                >
                  <div className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center group-hover:text-emerald-400 group-hover:shadow-[0_0_15px_rgba(16,185,129,0.3)] transition-all">
                    <Archive className="w-6 h-6" />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 group-hover:text-white">
                    ARCHIVE
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Outfit Popup */}
          {showOutfitPopup && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
              <div className="max-w-2xl w-full bg-zinc-900 border border-white/10 rounded-[40px] p-10 shadow-2xl relative">
                <button onClick={() => setShowOutfitPopup(false)} className="absolute top-8 right-8 text-zinc-500 hover:text-white transition-colors">
                  <X className="w-8 h-8" />
                </button>
                <h3 className="text-3xl font-black text-white uppercase italic mb-8">Select Outfit</h3>
                <div className="grid grid-cols-5 gap-4">
                  {OUTFITS.map(outfit => (
                    <button 
                      key={outfit.id}
                      onClick={() => {
                        const newChar = { 
                          ...playerCharacter, 
                          image: outfit.image,
                          healthIcons: {
                            normal: outfit.image,
                            win: outfit.image,
                            lose: outfit.image
                          }
                        };
                        setPlayerCharacter(newChar);
                        saveSetting('playerCharacter', newChar);
                        setShowOutfitPopup(false);
                      }}
                      className="group flex flex-col items-center gap-3"
                    >
                      <div className="w-24 h-24 rounded-2xl overflow-hidden border-2 border-white/5 group-hover:border-cyan-400 transition-all">
                        <img src={outfit.image} alt={outfit.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 group-hover:text-white">{outfit.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Poses Popup */}
          {showPosesPopup && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
              <div className="max-w-md w-full bg-zinc-900 border border-white/10 rounded-[40px] p-10 shadow-2xl relative">
                <h3 className="text-2xl font-black text-white uppercase italic mb-2">CHARACTER GALLERY</h3>
                <div className="flex items-center justify-between mb-8">
                  <p className="text-zinc-500 font-bold text-[10px] uppercase tracking-widest">Animation Poses</p>
                  <button 
                    onClick={() => {
                      const allFlipped = Object.values(tempFlips).every(v => v);
                      const newFlips: Record<string, boolean> = {};
                      ['idle', 'left', 'up', 'down', 'right'].forEach(p => {
                        newFlips[p] = !allFlipped;
                      });
                      setTempFlips(newFlips);
                    }}
                    className="text-[10px] font-black text-pink-500 hover:text-pink-400 uppercase tracking-widest flex items-center gap-2 transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" />
                    FLIP ALL
                  </button>
                </div>
                
                <div className="space-y-4 mb-10">
                  {['IDLE', 'LEFT', 'UP', 'DOWN', 'RIGHT'].map(pose => (
                    <div key={pose} className="bg-white/5 p-4 rounded-2xl flex items-center justify-between border border-white/5">
                      <span className="font-black text-sm tracking-widest text-zinc-400">{pose}</span>
                      <div className="flex items-center gap-4">
                        {tempPoses[pose.toLowerCase()] && (
                          <div className="w-10 h-10 rounded-lg overflow-hidden border border-white/10">
                            <img src={tempPoses[pose.toLowerCase()]} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          {tempPoses[pose.toLowerCase()] && (
                            <button
                              onClick={() => {
                                setTempPoses(prev => {
                                  const next = { ...prev };
                                  delete next[pose.toLowerCase()];
                                  return next;
                                });
                              }}
                              className="p-2 bg-red-500/20 text-red-400 rounded-xl hover:bg-red-500/30 transition-all"
                              title="Clear Image"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setTempFlips(prev => ({ ...prev, [pose.toLowerCase()]: !prev[pose.toLowerCase()] }));
                            }}
                            className={`p-2 rounded-xl border transition-all ${
                              tempFlips[pose.toLowerCase()] 
                                ? 'bg-pink-500/20 border-pink-500 text-pink-500' 
                                : 'bg-zinc-800 border-white/10 text-zinc-500 hover:text-white'
                            }`}
                            title="Flip"
                          >
                            <RefreshCw className={`w-4 h-4 transition-transform ${tempFlips[pose.toLowerCase()] ? 'rotate-180' : ''}`} />
                          </button>
                          <label className="cursor-pointer p-2 bg-purple-500/20 text-purple-400 rounded-xl hover:bg-purple-500/30 transition-all">
                            <Upload className="w-5 h-5" />
                            <input 
                              type="file" 
                              accept="image/*" 
                              className="hidden" 
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  const reader = new FileReader();
                                  reader.onload = (event) => {
                                    setTempPoses(prev => ({ ...prev, [pose.toLowerCase()]: event.target?.result as string }));
                                  };
                                  reader.readAsDataURL(file);
                                }
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-4">
                  <button 
                    onClick={() => {
                      const newAnimations = playerCharacter.animations.map(anim => {
                        return { 
                          ...anim, 
                          image: tempPoses[anim.name] || anim.image,
                          flipX: tempFlips[anim.name]
                        };
                      });
                      const idleImage = tempPoses['idle'] || playerCharacter.image;
                      const newChar = { 
                        ...playerCharacter, 
                        image: idleImage,
                        animations: newAnimations,
                        healthIcons: {
                          normal: idleImage,
                          win: tempPoses['idle'] || playerCharacter.healthIcons?.win || idleImage,
                          lose: tempPoses['idle'] || playerCharacter.healthIcons?.lose || idleImage
                        }
                      };
                      setPlayerCharacter(newChar);
                      saveSetting('playerCharacter', newChar);
                      setShowPosesPopup(false);
                    }}
                    className="flex-1 py-4 bg-white text-black rounded-2xl font-black text-sm tracking-widest hover:bg-zinc-200 transition-all"
                  >
                    SAVE ALL
                  </button>
                  <button 
                    onClick={() => setShowPosesPopup(false)}
                    className="flex-1 py-4 bg-zinc-800 text-white rounded-2xl font-black text-sm tracking-widest hover:bg-zinc-700 transition-all"
                  >
                    CANCEL
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Fullscreen Button */}
          <button
            onClick={toggleFullscreen}
            className="absolute top-8 right-8 p-3 bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl text-zinc-500 hover:text-white transition-all z-20"
            title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
          >
            {isFullscreen ? <Minimize className="w-6 h-6" /> : <Maximize className="w-6 h-6" />}
          </button>
        </motion.div>
      )}

      {screen === 'STORY_MODE_MENU' && (
        <motion.div
          key="STORY_MODE_MENU"
          initial={{ opacity: 0, x: 100 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -100 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="fixed inset-0 bg-gradient-to-br from-[#1a1c23] via-[#2a3b4c] to-[#111] overflow-hidden flex flex-col"
        >
          {/* Grid Background */}
          <div className="absolute inset-0 opacity-30" style={{
            backgroundImage: `
              linear-gradient(to right, rgba(255,255,255,0.1) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(255,255,255,0.1) 1px, transparent 1px)
            `,
            backgroundSize: '60px 60px'
          }} />
          {/* Scanlines */}
          <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_4px,3px_100%] z-20 opacity-20" />
          
          {/* Main Content Container */}
          <div className="relative z-10 w-full h-full flex flex-col p-10 pb-16">
            {/* Title */}
            <h1 className="text-6xl text-white font-['Anton'] tracking-widest uppercase drop-shadow-[4px_4px_0_rgba(0,0,0,1)] mb-12 ml-4">
              SELECT WEEK
            </h1>

            <div className="flex flex-1 overflow-hidden">
              {/* Left Side: Week List */}
              <div className="w-1/2 flex flex-col gap-6 overflow-y-auto custom-scrollbar pr-4 pb-10">
                {[
                  { id: 1, title: 'Week 1 Daddy Dearest', color: 'bg-blue-500', hover: 'group-hover:bg-blue-400' },
                  { id: 2, title: 'Week 2 Spooky Month', color: 'bg-purple-500', hover: 'group-hover:bg-purple-400' },
                  { id: 3, title: 'Week 3 Pico', color: 'bg-green-500', hover: 'group-hover:bg-green-400' },
                  { id: 4, title: 'Week 4 Mommy Mearest', color: 'bg-pink-500', hover: 'group-hover:bg-pink-400' },
                  { id: 0, title: 'Week 0 Extreme Challenge', color: 'bg-red-600', hover: 'group-hover:bg-red-500' },
                  { id: 'teaser-chart', title: 'Teaser Chart', color: 'bg-orange-500', hover: 'group-hover:bg-orange-400' },
                ].filter(w => nullifierUnlocked || w.id === 'teaser-chart').map((week) => (
                  <div key={week.id} className="relative group w-full max-w-lg shrink-0 flex items-center">
                    <motion.button
                      whileHover={{ scale: 1.02, x: 10 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setSelectedWeek(week.id)}
                      className={`relative h-20 flex-1 transition-all duration-200 ${selectedWeek === week.id ? 'translate-x-8' : ''}`}
                    >
                      {/* Shadow/Border layer */}
                      <div className="absolute inset-0 bg-black translate-y-2 translate-x-2" style={{ clipPath: 'polygon(8% 0, 100% 0, 92% 100%, 0% 100%)' }} />
                      {/* Main button layer */}
                      <div className={`absolute inset-0 flex items-center justify-between px-12 ${week.color} ${selectedWeek === week.id ? 'brightness-110' : week.hover}`} style={{ clipPath: 'polygon(8% 0, 100% 0, 92% 100%, 0% 100%)' }}>
                        <span className="text-white text-3xl font-['Anton'] italic tracking-wider drop-shadow-[2px_2px_0_rgba(0,0,0,0.5)]">
                          {typeof week.id === 'number' ? `Week ${week.id}` : ''} <span className="font-sans text-xl opacity-80">{week.title.replace(`Week ${week.id} `, '')}</span>
                        </span>
                        <div className="w-0 h-0 border-t-[10px] border-t-transparent border-l-[16px] border-l-black border-b-[10px] border-b-transparent mr-4" />
                      </div>
                    </motion.button>
                  </div>
                ))}

                {/* Custom Weeks */}
                {settings.addedCustomWeeks.map(weekId => {
                  const customWeek = allCustomWeeks.find(w => w.id === weekId);
                  if (!customWeek) return null;
                  return (
                    <div key={customWeek.id} className="relative group w-full max-w-lg shrink-0 flex items-center">
                      <motion.button
                        whileHover={{ scale: 1.02, x: 10 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setSelectedWeek(customWeek.id)}
                        className={`relative h-20 flex-1 transition-all duration-200 ${selectedWeek === customWeek.id ? 'translate-x-8' : ''}`}
                      >
                        <div className="absolute inset-0 bg-black translate-y-2 translate-x-2" style={{ clipPath: 'polygon(8% 0, 100% 0, 92% 100%, 0% 100%)' }} />
                        <div className={`absolute inset-0 flex items-center justify-between px-12 bg-indigo-500 ${selectedWeek === customWeek.id ? 'brightness-110' : 'group-hover:bg-indigo-400'}`} style={{ clipPath: 'polygon(8% 0, 100% 0, 92% 100%, 0% 100%)' }}>
                          <span className="text-white text-3xl font-['Anton'] italic tracking-wider drop-shadow-[2px_2px_0_rgba(0,0,0,0.5)] truncate pr-4">
                            {customWeek.name}
                          </span>
                          <div className="w-0 h-0 border-t-[10px] border-t-transparent border-l-[16px] border-l-black border-b-[10px] border-b-transparent mr-4 shrink-0" />
                        </div>
                      </motion.button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); setItemToDelete({ type: 'week', id: customWeek.id }); }}
                        className="absolute right-[-40px] top-1/2 -translate-y-1/2 w-10 h-10 bg-red-600 hover:bg-red-500 text-white rounded-full flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-20"
                        title="Delete Week"
                      >
                        <Trash2 size={20} />
                      </button>
                    </div>
                  );
                })}

                {/* + Extra Week Button */}
                <motion.button
                  whileHover={{ scale: 1.02, x: 10 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    setSelectedCustomWeeks(settings.addedCustomWeeks);
                    setShowExtraWeekModal(true);
                  }}
                  className="relative group h-20 w-full max-w-lg transition-all duration-200 shrink-0"
                >
                  <div className="absolute inset-0 bg-black translate-y-2 translate-x-2" style={{ clipPath: 'polygon(8% 0, 100% 0, 92% 100%, 0% 100%)' }} />
                  <div className="absolute inset-0 flex items-center justify-between px-12 bg-zinc-700 group-hover:bg-zinc-600" style={{ clipPath: 'polygon(8% 0, 100% 0, 92% 100%, 0% 100%)' }}>
                    <span className="text-white text-3xl font-['Anton'] italic tracking-wider drop-shadow-[2px_2px_0_rgba(0,0,0,0.5)]">
                      + Extra Week
                    </span>
                    <div className="w-0 h-0 border-t-[10px] border-t-transparent border-l-[16px] border-l-black border-b-[10px] border-b-transparent mr-4" />
                  </div>
                </motion.button>
              </div>

              {/* Right Side: Preview */}
              <div className="w-1/2 flex flex-col items-start pl-16 relative">
                {/* Tracklist */}
                <div className="w-full max-w-lg mb-8 flex flex-col items-start">
                  <div className="bg-blue-600 text-white text-4xl font-['Anton'] px-12 py-2 rounded-full inline-block mb-6 shadow-[3px_3px_0_rgba(0,0,0,0.5)]">
                    Track:
                  </div>
                  <div className="flex flex-col gap-2 w-full pl-8">
                    {typeof selectedWeek === 'number' ? (
                      STAGES.filter(s => s.week === selectedWeek).map((stage, idx) => (
                        <span key={idx} className="text-white text-2xl italic font-sans tracking-widest drop-shadow-[2px_2px_0_rgba(0,0,0,1)] opacity-90">
                          {idx + 1}. {stage.name?.split(': ')[1] || stage.name || 'Unknown'}
                        </span>
                      ))
                    ) : selectedWeek === 'teaser-chart' ? (
                      ['Palace (dave style)', 'osmu', 'OPPOSED'].map((name, idx) => (
                        <span key={idx} className="text-white text-2xl italic font-sans tracking-widest drop-shadow-[2px_2px_0_rgba(0,0,0,1)] opacity-90">
                          {idx + 1}. {name}
                        </span>
                      ))
                    ) : (() => {
                      const week = allCustomWeeks.find(w => w.id === selectedWeek);
                      if (!week) return null;
                      
                      const trackIds = new Set(week.tracks || []);
                      (week.sequence || []).forEach(node => {
                        if (node.type === 'GAMEPLAY') {
                          trackIds.add(node.dataId);
                        }
                      });
                      
                      const tracks = Array.from(trackIds).map(id => allCustomStages.find(s => s.id === id)).filter(Boolean) as SavedStage[];
                      
                      if (tracks.length === 0) {
                        return (
                          <span className="text-white text-2xl italic font-sans tracking-widest drop-shadow-[2px_2px_0_rgba(0,0,0,1)] opacity-90">
                            ???
                          </span>
                        );
                      }

                      return tracks.map((stage, idx) => (
                        <span key={idx} className="text-white text-2xl italic font-sans tracking-widest drop-shadow-[2px_2px_0_rgba(0,0,0,1)] opacity-90">
                          {idx + 1}. {stage.name?.split(': ')[1] || stage.name || 'Unknown'}
                        </span>
                      ));
                    })()}
                    {(typeof selectedWeek === 'number' ? STAGES.filter(s => s.week === selectedWeek).length : 0) === 0 && typeof selectedWeek === 'number' && (
                      <span className="text-white text-2xl italic font-sans tracking-widest drop-shadow-[2px_2px_0_rgba(0,0,0,1)] opacity-90">
                        ???
                      </span>
                    )}
                  </div>
                </div>

                {/* Thumbnail */}
                <div className="w-full max-w-lg aspect-video bg-white/10 backdrop-blur-md border-4 border-white/20 rounded-xl relative overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.5)] flex items-center justify-center mt-4">
                  <img 
                    src={typeof selectedWeek === 'number' 
                      ? `https://picsum.photos/seed/week${selectedWeek}fnf/800/450`
                      : selectedWeek === 'teaser-chart'
                        ? 'https://picsum.photos/seed/teaserchart/800/450'
                        : allCustomWeeks.find(w => w.id === selectedWeek)?.thumbnail || `https://picsum.photos/seed/week${selectedWeek}fnf/800/450`} 
                    alt={`Week ${selectedWeek} Thumbnail`}
                    className="absolute inset-0 w-full h-full object-cover opacity-40 mix-blend-overlay"
                    referrerPolicy="no-referrer"
                  />
                  {/* Glitch/Cubes effect placeholder */}
                  <div className="absolute inset-0 opacity-60">
                    <div className="absolute top-8 left-8 w-12 h-12 bg-white/80 rotate-12 shadow-lg animate-[spin_10s_linear_infinite]" />
                    <div className="absolute bottom-16 right-16 w-16 h-16 bg-white/80 -rotate-12 shadow-lg animate-[spin_15s_linear_infinite_reverse]" />
                    <div className="absolute top-1/2 left-1/4 w-8 h-8 bg-white/80 rotate-45 shadow-lg animate-[spin_8s_linear_infinite]" />
                    <div className="absolute top-1/4 right-1/3 w-10 h-10 bg-white/80 rotate-[60deg] shadow-lg animate-[spin_12s_linear_infinite_reverse]" />
                  </div>
                  <span className="text-white text-4xl font-['Playfair_Display'] italic drop-shadow-[3px_3px_0_rgba(0,0,0,1)] z-10">
                    {typeof selectedWeek === 'number' 
                      ? (selectedWeek === 1 ? 'Daddy Dearest' : selectedWeek === 2 ? 'Pico' : selectedWeek === 3 ? 'Monster' : 'Mommy Mearest')
                      : selectedWeek === 'teaser-chart' ? 'Teaser Chart' : allCustomWeeks.find(w => w.id === selectedWeek)?.name || 'Custom Week'}
                  </span>
                </div>
              </div>
            </div>

            {/* Bottom Navigation */}
            <div className="mt-8 flex justify-between items-end w-full px-4">
              {/* Back Button */}
              <button
                onClick={() => setScreen('START')}
                className="relative group h-14 w-64 transition-all duration-200 hover:-translate-x-2"
              >
                <div className="absolute inset-0 bg-black translate-y-2 translate-x-2" style={{ clipPath: 'polygon(8% 0, 100% 0, 92% 100%, 0% 100%)' }} />
                <div className="absolute inset-0 bg-blue-700 group-hover:bg-blue-600 flex items-center justify-center" style={{ clipPath: 'polygon(8% 0, 100% 0, 92% 100%, 0% 100%)' }}>
                  <span className="text-white text-xl font-['Anton'] italic tracking-wider drop-shadow-[2px_2px_0_rgba(0,0,0,0.5)]">
                    &lt; Back to menu
                  </span>
                </div>
              </button>

              {/* Play Button */}
              <button
                disabled={isLoadingTeaser}
                onClick={async () => { 
                  if (typeof selectedWeek === 'number') {
                    const firstStageIndex = STAGES.findIndex(s => s.week === selectedWeek);
                    if (firstStageIndex !== -1) startGame(firstStageIndex, undefined, 1, undefined, undefined, 'STORY'); 
                  } else if (selectedWeek === 'teaser-chart') {
                    setIsLoadingTeaser(true);
                    try {
                      const [palace, osmu, opposed] = await Promise.all([
                        fetch('/data/palace.json').then(r => r.json()),
                        fetch('/data/osmu.json').then(r => r.json()),
                        fetch('/data/opposed.json').then(r => r.json()),
                      ]);
                      const week: SavedWeek = {
                        id: 'teaser-chart',
                        name: 'Teaser Chart',
                        sequence: [
                          { id: 'node-1', type: 'GAMEPLAY', dataId: palace.id },
                          { id: 'node-2', type: 'GAMEPLAY', dataId: osmu.id },
                          { id: 'node-3', type: 'GAMEPLAY', dataId: opposed.id },
                        ],
                        tracks: [palace.id, osmu.id, opposed.id]
                      };
                      startGame(0, undefined, 1, week, [palace, osmu, opposed], 'CUSTOM_STORY');
                    } catch (e) {
                      console.error('Failed to load teaser chart:', e);
                      alert('Failed to load teaser chart data.');
                    } finally {
                      setIsLoadingTeaser(false);
                    }
                  } else {
                    const customWeek = allCustomWeeks.find(w => w.id === selectedWeek);
                    if (customWeek) {
                      const hasContent = (customWeek.sequence && customWeek.sequence.length > 0) || (customWeek.tracks && customWeek.tracks.length > 0);
                      if (hasContent) {
                        // Collect all stages needed for this week
                        const stageIds = new Set<string>(customWeek.tracks || []);
                        customWeek.sequence?.forEach(node => {
                          if (node.type === 'GAMEPLAY') stageIds.add(node.dataId);
                        });
                        const weekStages = Array.from(stageIds).map(id => allCustomStages.find(s => s.id === id)).filter(Boolean) as SavedStage[];
                        startGame(0, undefined, 1, customWeek, weekStages, 'CUSTOM_STORY');
                      }
                    }
                  }
                }}
                className={`relative group h-20 w-80 transition-all duration-200 hover:scale-105 mr-8 ${isLoadingTeaser ? 'opacity-50 cursor-wait' : ''}`}
              >
                {/* Drop shadow */}
                <div className="absolute inset-0 bg-black translate-y-3 translate-x-3" style={{ clipPath: 'polygon(15% 0, 100% 0, 85% 100%, 0% 100%)' }} />
                {/* Orange border */}
                <div className="absolute inset-0 bg-[#FFB800]" style={{ clipPath: 'polygon(15% 0, 100% 0, 85% 100%, 0% 100%)' }} />
                {/* Main black button */}
                <div className="absolute inset-[6px] bg-[#111]" style={{ clipPath: 'polygon(15% 0, 100% 0, 85% 100%, 0% 100%)' }}>
                  <div className="absolute inset-0 flex items-center justify-center gap-4">
                    <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center">
                      {isLoadingTeaser ? (
                        <RefreshCw className="w-6 h-6 text-black animate-spin" />
                      ) : (
                        <div className="w-0 h-0 border-t-[6px] border-t-transparent border-l-[10px] border-l-black border-b-[6px] border-b-transparent ml-1" />
                      )}
                    </div>
                    <span className="text-white text-4xl tracking-widest lowercase font-['Anton'] drop-shadow-[3px_3px_0_rgba(0,0,0,1)]">
                      {isLoadingTeaser ? 'loading' : 'play'}
                    </span>
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Delete Confirmation Modal */}
          {itemToDelete && (
            <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-8">
              <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md flex flex-col">
                <div className="p-6 border-b border-zinc-700 flex justify-between items-center">
                  <h2 className="text-2xl font-bold text-red-500 flex items-center gap-2">
                    <AlertCircle size={24} />
                    Confirm Deletion
                  </h2>
                  <button onClick={() => setItemToDelete(null)} className="text-zinc-400 hover:text-white">
                    <X size={24} />
                  </button>
                </div>
                <div className="p-6">
                  <p className="text-zinc-300">
                    Are you sure you want to delete this {itemToDelete.type}? This action cannot be undone.
                  </p>
                </div>
                <div className="p-6 border-t border-zinc-700 flex justify-end gap-4">
                  <button
                    onClick={() => setItemToDelete(null)}
                    className="px-6 py-2 rounded-lg font-bold text-white bg-zinc-700 hover:bg-zinc-600 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteItem}
                    className="px-6 py-2 rounded-lg font-bold text-white bg-red-600 hover:bg-red-500 transition-colors flex items-center gap-2"
                  >
                    <Trash2 size={18} />
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Extra Week Modal */}
          {showExtraWeekModal && (
            <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-8">
              <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl flex flex-col max-h-[80vh]">
                <div className="p-6 border-b border-zinc-700 flex justify-between items-center">
                  <h2 className="text-2xl font-bold text-white">Select Custom Weeks</h2>
                  <button onClick={() => setShowExtraWeekModal(false)} className="text-zinc-400 hover:text-white">
                    <X size={24} />
                  </button>
                </div>
                <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-2">
                  {allCustomWeeks.length === 0 ? (
                    <p className="text-zinc-400 text-center py-8">No custom weeks found. Create some in the Editor!</p>
                  ) : (
                    allCustomWeeks.map(week => (
                      <label key={week.id} className="flex items-center gap-4 p-4 rounded-lg bg-zinc-800 hover:bg-zinc-700 cursor-pointer transition-colors">
                        <input
                          type="checkbox"
                          checked={selectedCustomWeeks.includes(week.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedCustomWeeks(prev => [...prev, week.id]);
                            } else {
                              setSelectedCustomWeeks(prev => prev.filter(id => id !== week.id));
                            }
                          }}
                          className="w-5 h-5 rounded border-zinc-600 text-indigo-500 focus:ring-indigo-500 bg-zinc-900"
                        />
                        <div className="flex-1">
                          <h3 className="text-lg font-bold text-white">{week.name}</h3>
                          <p className="text-sm text-zinc-400">{week.tracks.length} stages</p>
                        </div>
                      </label>
                    ))
                  )}
                </div>
                <div className="p-6 border-t border-zinc-700 flex justify-end gap-4">
                  <button
                    onClick={() => setShowExtraWeekModal(false)}
                    className="px-6 py-2 rounded-lg font-bold text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      saveAllSettings({ ...settings, addedCustomWeeks: selectedCustomWeeks });
                      setShowExtraWeekModal(false);
                    }}
                    className="px-6 py-2 rounded-lg font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
                  >
                    Add Selected Weeks
                  </button>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      )}

      {screen === 'FREE_PLAY_MENU' && (
        <motion.div
          key="FREE_PLAY_MENU"
          initial={{ opacity: 0, x: 100 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -100 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="fixed inset-0 bg-gradient-to-br from-[#1a1c23] via-[#2a3b4c] to-[#111] overflow-hidden flex flex-col"
        >
          {/* Grid Background */}
          <div className="absolute inset-0 opacity-30" style={{
            backgroundImage: `
              linear-gradient(to right, rgba(255,255,255,0.1) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(255,255,255,0.1) 1px, transparent 1px)
            `,
            backgroundSize: '60px 60px'
          }} />
          {/* Scanlines */}
          <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_4px,3px_100%] z-20 opacity-20" />
          
          {/* Main Content Container */}
          <div className="relative z-10 w-full h-full flex flex-col p-10 pb-16">
            {/* Title */}
            <h1 className="text-6xl text-white font-['Anton'] tracking-widest uppercase drop-shadow-[4px_4px_0_rgba(0,0,0,1)] mb-12 ml-4">
              FREE PLAY
            </h1>

            <div className="flex flex-1 overflow-hidden">
              {/* Left Side: Stage List */}
              <div className="w-1/2 flex flex-col gap-6 overflow-y-auto custom-scrollbar pr-4 pb-10">
                {STAGES.filter(() => nullifierUnlocked).map((stage, idx) => (
                  <motion.button
                    key={idx}
                    whileHover={{ scale: 1.02, x: 10 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setSelectedFreePlayStage(idx)}
                    className={`relative group h-20 w-full max-w-lg transition-all duration-200 shrink-0 ${selectedFreePlayStage === idx ? 'translate-x-8' : ''}`}
                  >
                    <div className="absolute inset-0 bg-black translate-y-2 translate-x-2" style={{ clipPath: 'polygon(8% 0, 100% 0, 92% 100%, 0% 100%)' }} />
                    <div className={`absolute inset-0 flex items-center justify-between px-12 ${stage.week === 0 ? 'bg-purple-600' : 'bg-blue-500'} ${selectedFreePlayStage === idx ? 'brightness-110' : 'group-hover:brightness-110'}`} style={{ clipPath: 'polygon(8% 0, 100% 0, 92% 100%, 0% 100%)' }}>
                      <span className="text-white text-3xl font-['Anton'] italic tracking-wider drop-shadow-[2px_2px_0_rgba(0,0,0,0.5)] truncate pr-4">
                        {stage.name?.split(': ')[1] || stage.name || 'Untitled Stage'}
                      </span>
                      <div className="w-0 h-0 border-t-[10px] border-t-transparent border-l-[16px] border-l-black border-b-[10px] border-b-transparent mr-4 shrink-0" />
                    </div>
                  </motion.button>
                ))}

                {/* Teaser Tracks */}
                {TEASER_TRACKS.map((stage) => (
                  <div key={stage.id} className="relative group w-full max-w-lg shrink-0 flex items-center">
                    <motion.button
                      whileHover={{ scale: 1.02, x: 10 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setSelectedFreePlayStage(stage.id)}
                      className={`relative h-20 flex-1 transition-all duration-200 ${selectedFreePlayStage === stage.id ? 'translate-x-8' : ''}`}
                    >
                      <div className="absolute inset-0 bg-black translate-y-2 translate-x-2" style={{ clipPath: 'polygon(8% 0, 100% 0, 92% 100%, 0% 100%)' }} />
                      <div className={`absolute inset-0 flex items-center justify-between px-12 bg-orange-600 ${selectedFreePlayStage === stage.id ? 'brightness-110' : 'group-hover:brightness-110'}`} style={{ clipPath: 'polygon(8% 0, 100% 0, 92% 100%, 0% 100%)' }}>
                        <span className="text-white text-3xl font-['Anton'] italic tracking-wider drop-shadow-[2px_2px_0_rgba(0,0,0,0.5)] truncate pr-4">
                          {stage.name}
                        </span>
                        <div className="w-0 h-0 border-t-[10px] border-t-transparent border-l-[16px] border-l-black border-b-[10px] border-b-transparent mr-4 shrink-0" />
                      </div>
                    </motion.button>
                  </div>
                ))}

                {/* Custom Stages */}
                {allCustomStages.map((stage) => (
                  <div key={stage.id} className="relative group w-full max-w-lg shrink-0 flex items-center">
                    <motion.button
                      whileHover={{ scale: 1.02, x: 10 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setSelectedFreePlayStage(stage.id)}
                      className={`relative h-20 flex-1 transition-all duration-200 ${selectedFreePlayStage === stage.id ? 'translate-x-8' : ''}`}
                    >
                      <div className="absolute inset-0 bg-black translate-y-2 translate-x-2" style={{ clipPath: 'polygon(8% 0, 100% 0, 92% 100%, 0% 100%)' }} />
                      <div className={`absolute inset-0 flex items-center justify-between px-12 bg-indigo-500 ${selectedFreePlayStage === stage.id ? 'brightness-110' : 'group-hover:brightness-110'}`} style={{ clipPath: 'polygon(8% 0, 100% 0, 92% 100%, 0% 100%)' }}>
                        <span className="text-white text-3xl font-['Anton'] italic tracking-wider drop-shadow-[2px_2px_0_rgba(0,0,0,0.5)] truncate pr-4">
                          {stage.name}
                        </span>
                        <div className="w-0 h-0 border-t-[10px] border-t-transparent border-l-[16px] border-l-black border-b-[10px] border-b-transparent mr-4 shrink-0" />
                      </div>
                    </motion.button>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setItemToDelete({ type: 'stage', id: stage.id }); }}
                      className="absolute right-[-40px] top-1/2 -translate-y-1/2 w-10 h-10 bg-red-600 hover:bg-red-500 text-white rounded-full flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-20"
                      title="Delete Stage"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                ))}
              </div>

              {/* Right Side: Preview */}
              <div className="w-1/2 flex flex-col items-start pl-16 relative">
                {/* Track Info */}
                <div className="w-full max-w-lg mb-8 flex flex-col items-start">
                  <div className="bg-blue-600 text-white text-4xl font-['Anton'] px-12 py-2 rounded-full inline-block mb-6 shadow-[3px_3px_0_rgba(0,0,0,0.5)]">
                    Info:
                  </div>
                  <div className="flex flex-col gap-4 w-full pl-8">
                    {(() => {
                      const isCustom = typeof selectedFreePlayStage === 'string';
                      const isTeaser = isCustom && TEASER_TRACKS.some(t => t.id === selectedFreePlayStage);
                      const stage = isTeaser 
                        ? TEASER_TRACKS.find(t => t.id === selectedFreePlayStage)
                        : isCustom 
                        ? allCustomStages.find(s => s.id === selectedFreePlayStage)
                        : STAGES[selectedFreePlayStage as number];
                      
                      if (!stage) return null;

                      return (
                        <>
                          <span className="text-white text-3xl italic font-sans tracking-widest drop-shadow-[2px_2px_0_rgba(0,0,0,1)] opacity-90">
                            {stage.name}
                          </span>
                          <span className="text-zinc-300 text-2xl italic font-sans tracking-widest drop-shadow-[2px_2px_0_rgba(0,0,0,1)] opacity-90">
                            BPM: {stage.bpm}
                          </span>
                          {(!isCustom && (stage as any).week === 0) && (
                            <span className="text-purple-400 text-xl italic font-sans tracking-widest drop-shadow-[2px_2px_0_rgba(0,0,0,1)] opacity-90">
                              Extreme Challenge
                            </span>
                          )}
                          {isTeaser && (
                            <span className="text-orange-400 text-xl italic font-sans tracking-widest drop-shadow-[2px_2px_0_rgba(0,0,0,1)] opacity-90">
                              Teaser Track
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* Thumbnail */}
                <div className="w-full max-w-lg aspect-video bg-white/10 backdrop-blur-md border-4 border-white/20 rounded-xl relative overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.5)] flex items-center justify-center mt-4">
                  <img 
                    src={typeof selectedFreePlayStage === 'number'
                      ? `https://picsum.photos/seed/stage${selectedFreePlayStage}fnf/800/450`
                      : TEASER_TRACKS.some(t => t.id === selectedFreePlayStage)
                        ? `https://picsum.photos/seed/${selectedFreePlayStage}/800/450`
                        : allCustomStages.find(s => s.id === selectedFreePlayStage)?.thumbnail || `https://picsum.photos/seed/stage${selectedFreePlayStage}fnf/800/450`} 
                    alt="Stage Thumbnail"
                    className="absolute inset-0 w-full h-full object-cover opacity-40 mix-blend-overlay"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 opacity-60">
                    <div className="absolute top-8 left-8 w-12 h-12 bg-white/80 rotate-12 shadow-lg animate-[spin_10s_linear_infinite]" />
                    <div className="absolute bottom-16 right-16 w-16 h-16 bg-white/80 -rotate-12 shadow-lg animate-[spin_15s_linear_infinite_reverse]" />
                    <div className="absolute top-1/2 left-1/4 w-8 h-8 bg-white/80 rotate-45 shadow-lg animate-[spin_8s_linear_infinite]" />
                    <div className="absolute top-1/4 right-1/3 w-10 h-10 bg-white/80 rotate-[60deg] shadow-lg animate-[spin_12s_linear_infinite_reverse]" />
                  </div>
                  <span className="text-white text-4xl font-['Playfair_Display'] italic drop-shadow-[3px_3px_0_rgba(0,0,0,1)] z-10 text-center px-4">
                    {typeof selectedFreePlayStage === 'number' 
                      ? (STAGES[selectedFreePlayStage]?.name?.split(': ')[1] || STAGES[selectedFreePlayStage]?.name || 'Unknown Stage')
                      : TEASER_TRACKS.find(t => t.id === selectedFreePlayStage)?.name
                      || allCustomStages.find(s => s.id === selectedFreePlayStage)?.name || 'Custom Stage'}
                  </span>
                </div>
              </div>
            </div>

            {/* Bottom Navigation */}
            <div className="mt-8 flex justify-between items-end w-full px-4">
              {/* Back Button */}
              <button
                onClick={() => setScreen('START')}
                className="relative group h-14 w-64 transition-all duration-200 hover:-translate-x-2"
              >
                <div className="absolute inset-0 bg-black translate-y-2 translate-x-2" style={{ clipPath: 'polygon(8% 0, 100% 0, 92% 100%, 0% 100%)' }} />
                <div className="absolute inset-0 bg-blue-700 group-hover:bg-blue-600 flex items-center justify-center" style={{ clipPath: 'polygon(8% 0, 100% 0, 92% 100%, 0% 100%)' }}>
                  <span className="text-white text-xl font-['Anton'] italic tracking-wider drop-shadow-[2px_2px_0_rgba(0,0,0,0.5)]">
                    &lt; Back to menu
                  </span>
                </div>
              </button>

              {/* Play Button */}
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                disabled={isLoadingTeaser}
                onClick={async () => { 
                  if (typeof selectedFreePlayStage === 'number') {
                    startGame(selectedFreePlayStage, undefined, 1, undefined, undefined, 'FREEPLAY');
                  } else {
                    const teaserTrack = TEASER_TRACKS.find(t => t.id === selectedFreePlayStage);
                    if (teaserTrack) {
                      setIsLoadingTeaser(true);
                      try {
                        const res = await fetch(`/data/${teaserTrack.filename}.json`);
                        const customStage = await res.json();
                        startGame(0, customStage, 1, undefined, undefined, 'FREEPLAY');
                      } catch (e) {
                        console.error('Failed to load teaser track:', e);
                        alert('Failed to load teaser track data.');
                      } finally {
                        setIsLoadingTeaser(false);
                      }
                    } else {
                      const customStage = allCustomStages.find(s => s.id === selectedFreePlayStage);
                      if (customStage) {
                        startGame(0, customStage, 1, undefined, undefined, 'FREEPLAY');
                      }
                    }
                  }
                }}
                className={`relative group h-20 w-80 transition-all duration-200 mr-8 ${isLoadingTeaser ? 'opacity-50 cursor-wait' : ''}`}
              >
                {/* Drop shadow */}
                <div className="absolute inset-0 bg-black translate-y-3 translate-x-3" style={{ clipPath: 'polygon(15% 0, 100% 0, 85% 100%, 0% 100%)' }} />
                {/* Orange border */}
                <div className="absolute inset-0 bg-[#FFB800]" style={{ clipPath: 'polygon(15% 0, 100% 0, 85% 100%, 0% 100%)' }} />
                {/* Main black button */}
                <div className="absolute inset-[6px] bg-[#111]" style={{ clipPath: 'polygon(15% 0, 100% 0, 85% 100%, 0% 100%)' }}>
                  <div className="absolute inset-0 flex items-center justify-center gap-4">
                    <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center">
                      {isLoadingTeaser ? (
                        <RefreshCw className="w-6 h-6 text-black animate-spin" />
                      ) : (
                        <div className="w-0 h-0 border-t-[6px] border-t-transparent border-l-[10px] border-l-black border-b-[6px] border-b-transparent ml-1" />
                      )}
                    </div>
                    <span className="text-white text-4xl tracking-widest lowercase font-['Anton'] drop-shadow-[3px_3px_0_rgba(0,0,0,1)]">
                      play
                    </span>
                  </div>
                </div>
              </motion.button>
            </div>
          </div>
        </motion.div>
      )}

      {screen === 'SETTINGS' && (
        <motion.div 
          key="SETTINGS"
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -50 }}
          transition={{ duration: 0.5, ease: "backOut" }}
          className="w-full h-full flex flex-col p-8 relative overflow-hidden"
          tabIndex={0}
          onKeyDown={handleKeyDown}
        >
          <div className="flex-1 grid grid-cols-12 gap-8 items-start">
            {/* Left Column: Categories */}
            <div className="col-span-5 space-y-6">
              <div className="mb-8">
                <h2 className="text-6xl font-black tracking-tighter uppercase text-white italic text-glow">
                  SETTINGS
                </h2>
              </div>
              <div className="space-y-4">
                {[
                  { id: 'Gameplay mode', color: 'bg-blue-600' },
                  { id: 'Key Bindings', color: 'bg-purple-600' },
                  { id: 'Fullscreen', color: 'bg-green-600' },
                  { id: 'Background/BGM', color: 'bg-cyan-600' },
                  { id: 'Reset Data', color: 'bg-red-600' }
                ].map((cat, idx) => (
                  <motion.button
                    key={cat.id}
                    initial={{ opacity: 0, x: -50 }}
                    animate={{ opacity: 1, x: 0 }}
                    whileHover={{ scale: 1.05, x: 10 }}
                    whileTap={{ scale: 0.95 }}
                    transition={{ delay: idx * 0.1 }}
                    onClick={() => setActiveSettingsCategory(cat.id)}
                    className={`group relative w-full h-16 transition-all duration-200 ${
                      activeSettingsCategory === cat.id ? 'translate-x-4' : ''
                    }`}
                  >
                    <div className={`absolute inset-0 ${cat.color} parallelogram shadow-lg group-hover:brightness-125 transition-all`}></div>
                    <div className="absolute inset-0 flex items-center justify-between px-12">
                      <span className="text-2xl font-black italic uppercase text-white tracking-widest">
                        {cat.id}
                      </span>
                      <div className="w-0 h-0 border-t-[8px] border-t-transparent border-l-[12px] border-l-black border-b-[8px] border-b-transparent"></div>
                    </div>
                  </motion.button>
                ))}
              </div>
            </div>

            {/* Right Column: Details */}
            <div className="col-span-7 h-full flex flex-col">
              <AnimatePresence mode="wait">
                <motion.div 
                  key={activeSettingsCategory}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                  className="bg-blue-900/20 border border-blue-500/30 rounded-3xl p-8 backdrop-blur-md flex-1 relative overflow-hidden"
                >
                  {/* Panel Title */}
                  <div className="absolute top-0 left-0 right-0 h-16 bg-blue-700 flex items-center justify-center parallelogram-right">
                    <h3 className="text-3xl font-black italic uppercase text-white tracking-widest">
                      {activeSettingsCategory === 'Key Bindings' ? 'Key bindings:' : activeSettingsCategory}
                    </h3>
                  </div>

                  <div className="mt-16 space-y-6">
                    {activeSettingsCategory === 'Gameplay mode' && (
                      <div className="space-y-4">
                        <div className="bg-gradient-to-r from-blue-900/40 to-transparent p-4 flex items-center justify-between rounded-r-full">
                          <div>
                            <h4 className="font-black italic text-xl text-white uppercase">Botplay</h4>
                            <p className="text-xs text-blue-300 uppercase font-bold tracking-tighter">Let the AI play for you</p>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input 
                              type="checkbox" 
                              className="sr-only peer" 
                              checked={settings.botplay}
                              onChange={(e) => saveAllSettings({...settings, botplay: e.target.checked})}
                            />
                            <div className="w-14 h-7 bg-blue-900/50 border border-blue-500/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-blue-400 after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                          </label>
                        </div>

                        <div className="bg-gradient-to-r from-blue-900/40 to-transparent p-4 flex items-center justify-between rounded-r-full">
                          <div>
                            <h4 className="font-black italic text-xl text-white uppercase">Mobile Mode</h4>
                            <p className="text-xs text-blue-300 uppercase font-bold tracking-tighter">Enable on-screen controls</p>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input 
                              type="checkbox" 
                              className="sr-only peer" 
                              checked={settings.mobileMode}
                              onChange={(e) => saveAllSettings({...settings, mobileMode: e.target.checked})}
                            />
                            <div className="w-14 h-7 bg-blue-900/50 border border-blue-500/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-blue-400 after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                          </label>
                        </div>
                      </div>
                    )}

                    {activeSettingsCategory === 'Key Bindings' && (
                      <div className="space-y-4">
                        {settings.mobileMode ? (
                          <div className="flex flex-col items-center justify-center py-10 space-y-6">
                            <div className="w-20 h-20 bg-blue-500/20 rounded-full flex items-center justify-center border-4 border-blue-500 animate-pulse">
                              <Wrench className="w-10 h-10 text-blue-400" />
                            </div>
                            <div className="text-center space-y-2">
                              <h3 className="text-2xl font-black italic uppercase text-white tracking-widest">LAYOUT EDITOR</h3>
                              <p className="text-sm text-blue-300 uppercase font-bold tracking-tighter max-w-xs">
                                Drag and resize your on-screen buttons to fit your playstyle perfectly.
                              </p>
                            </div>
                            <button 
                              onClick={() => setShowMobileLayoutEditor(true)}
                              className="group relative w-full max-w-xs h-16 transition-all duration-200 hover:scale-105"
                            >
                              <div className="absolute inset-0 bg-blue-600 parallelogram shadow-lg group-hover:brightness-125 transition-all"></div>
                              <div className="absolute inset-0 flex items-center justify-center gap-2">
                                <Edit3 className="w-6 h-6 text-white" />
                                <span className="text-2xl font-black italic uppercase text-white tracking-widest">OPEN EDITOR</span>
                              </div>
                            </button>
                          </div>
                        ) : (
                          <>
                            <p className="text-blue-300 font-bold italic text-center mb-4 uppercase tracking-widest">Click a key to rebind it</p>
                            {['Left', 'Down', 'Up', 'Right'].map((dir, i) => (
                              <div key={dir} className="bg-gradient-to-r from-blue-800/40 to-transparent p-4 flex items-center justify-between rounded-r-full group">
                                <span className="text-2xl font-black italic text-white uppercase tracking-widest">{dir}</span>
                                <button
                                  onClick={() => handleKeyEdit(i)}
                                  className={`w-16 h-16 rounded-full border-4 flex items-center justify-center text-2xl font-black uppercase transition-all duration-300 shadow-[0_0_15px_rgba(0,0,0,0.5)] ${
                                    editingKey === i 
                                      ? 'border-yellow-400 text-yellow-400 animate-pulse scale-110' 
                                      : i === 0 ? 'border-purple-500 text-purple-400' :
                                        i === 1 ? 'border-blue-500 text-blue-400' :
                                        i === 2 ? 'border-green-500 text-green-400' :
                                        'border-red-500 text-red-400'
                                  }`}
                                >
                                  {editingKey === i ? '?' : settings.keys[i]}
                                </button>
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    )}

                    {activeSettingsCategory === 'Fullscreen' && (
                      <div className="flex flex-col items-center justify-center h-full space-y-8 py-12">
                        <div className="text-center">
                          <h4 className="text-3xl font-black italic text-white uppercase mb-2">Display Mode</h4>
                          <p className="text-blue-300 font-bold uppercase tracking-tighter">Toggle between windowed and fullscreen</p>
                        </div>
                        <div className="flex flex-col items-center gap-4">
                          <button
                            onClick={toggleFullscreen}
                            disabled={!document.fullscreenEnabled}
                            className={`group relative w-64 h-20 transition-all active:scale-95 ${!document.fullscreenEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            <div className={`absolute inset-0 ${isFullscreen ? 'bg-green-600' : 'bg-zinc-700'} parallelogram shadow-xl transition-colors`}></div>
                            <div className="absolute inset-0 flex items-center justify-center gap-4">
                              {isFullscreen ? <Minimize className="w-8 h-8 text-white" /> : <Maximize className="w-8 h-8 text-white" />}
                              <span className="text-2xl font-black italic uppercase text-white">
                                {isFullscreen ? 'FULLSCREEN ON' : 'FULLSCREEN OFF'}
                              </span>
                            </div>
                          </button>
                          {!document.fullscreenEnabled && (
                            <div className="bg-amber-500/20 border border-amber-500/30 p-3 rounded-lg max-w-xs text-center">
                              <p className="text-amber-400 text-sm font-bold uppercase italic">
                                Trình duyệt đang chặn toàn màn hình. 
                                <br />
                                Hãy thử "Mở trong tab mới"!
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {activeSettingsCategory === 'Background/BGM' && (
                      <div className="space-y-4">
                        {[
                          { id: 'bgm', label: 'Menu Music', sub: 'Upload custom BGM', handler: handleBgmUpload, accept: 'audio/*' },
                          { id: 'morning', label: 'Morning Background', sub: '6 AM - 6 PM', handler: (e: any) => handleBgUpload(e, 'morning'), accept: 'image/*' },
                          { id: 'evening', label: 'Evening Background', sub: '6 PM - 6 AM', handler: (e: any) => handleBgUpload(e, 'evening'), accept: 'image/*' },
                          { id: 'custom', label: 'Custom Override', sub: 'Overrides dynamic background', handler: (e: any) => handleBgUpload(e, 'custom'), accept: 'image/*' }
                        ].map((item, idx) => (
                          <div key={item.id} className={`bg-gradient-to-r ${idx % 2 === 0 ? 'from-blue-800/40' : 'from-cyan-800/40'} to-transparent p-4 flex items-center justify-between rounded-r-full`}>
                            <div>
                              <h4 className="font-black italic text-xl text-white uppercase">{item.label}</h4>
                              <p className="text-xs text-blue-300 uppercase font-bold tracking-tighter">{item.sub}</p>
                            </div>
                            <label className="cursor-pointer w-12 h-12 bg-cyan-400 rounded-full flex items-center justify-center hover:bg-cyan-300 transition-colors shadow-lg">
                              <Upload className="w-6 h-6 text-blue-900" />
                              <input type="file" accept={item.accept} className="hidden" onChange={item.handler} />
                            </label>
                          </div>
                        ))}

                        <div className="mt-8 space-y-4">
                          <div className="flex items-center gap-4">
                            <Volume2 className="w-6 h-6 text-blue-400" />
                            <span className="text-sm font-black italic uppercase text-white tracking-widest">Volume</span>
                          </div>
                          <input 
                            type="range" 
                            min="0" 
                            max="1" 
                            step="0.01" 
                            value={settings.bgmVolume}
                            onChange={(e) => {
                              const vol = parseFloat(e.target.value);
                              saveAllSettings({...settings, bgmVolume: vol});
                              bgmManager.setVolume(vol);
                            }}
                            className="w-full h-3 bg-blue-900/50 rounded-full appearance-none cursor-pointer accent-cyan-400 border border-blue-500/30"
                          />
                        </div>
                      </div>
                    )}

                    {activeSettingsCategory === 'Reset Data' && (
                      <div className="flex flex-col items-center justify-center h-full space-y-8 py-12">
                        <div className="text-center">
                          <h4 className="text-3xl font-black italic text-white uppercase mb-2">Reset Settings</h4>
                          <p className="text-blue-300 font-bold uppercase tracking-tighter">Clear preferences and return to default values</p>
                        </div>
                        <button
                          onClick={() => saveAllSettings({ ...settings, botplay: false, practiceMode: false, bgmVolume: 0.5 })}
                          className="group relative w-80 h-20 transition-all active:scale-95"
                        >
                          <div className="absolute inset-0 bg-red-600 parallelogram shadow-xl"></div>
                          <div className="absolute inset-0 flex items-center justify-center gap-4">
                            <RefreshCw className="w-8 h-8 text-white" />
                            <span className="text-2xl font-black italic uppercase text-white">
                              RESET SETTINGS
                            </span>
                          </div>
                        </button>
                      </div>
                    )}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          {/* Back Button */}
          <div className="absolute bottom-8 right-8">
            <motion.button
              whileHover={{ scale: 1.05, x: -10 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setScreen('START')}
              className="group relative w-96 h-16 transition-all"
            >
              <div className="absolute inset-0 bg-blue-500 parallelogram shadow-xl group-hover:bg-blue-400 transition-colors"></div>
              <div className="absolute inset-0 flex items-center justify-center gap-4">
                <Home className="w-6 h-6 text-white" />
                <span className="text-2xl font-black italic uppercase text-white tracking-[0.2em]">
                  BACK TO MENU
                </span>
              </div>
            </motion.button>
          </div>
        </motion.div>
      )}

      {screen === 'EDITOR' && (
        <motion.div
          key="EDITOR"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.05, filter: 'blur(10px)' }}
          className="w-full h-full"
        >
          <EditorMain 
            onBack={() => setScreen('START')} 
            onPlaytest={(stage, rate) => startGame(0, stage, rate)} 
            onPlaytestWeek={(week, stages) => {
              setWeekPlaytestResults([]);
              startGame(0, undefined, 1, week, stages);
            }}
            settings={settings}
            setSettings={setSettings}
            onEditStateChange={setIsEditing}
          />
        </motion.div>
      )}

      {screen === 'ONLINE_HUB' && (
        <motion.div
          key="ONLINE_HUB"
          initial={{ opacity: 0, x: 100 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -100 }}
          className="w-full h-full"
        >
          <OnlineHub 
            onBack={() => setScreen('START')}
            onPlaytest={(stage) => startGame(0, stage)}
          />
        </motion.div>
      )}

      {screen === 'ARCHIVE' && (
        <motion.div
          key="ARCHIVE"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.1 }}
          className="w-full h-full"
        >
          <ArchiveMenu onBack={() => setScreen('START')} />
        </motion.div>
      )}

      {screen === 'PLAYING' && (
        <motion.div 
          key="PLAYING"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={`w-full ${isFullscreen ? 'max-w-none h-screen p-0 gap-0' : 'max-w-4xl gap-4'} flex flex-col items-center`}
        >
          {!isFullscreen && (
            <div className="w-full flex justify-between items-center px-4 py-2 bg-zinc-900 rounded-xl border border-zinc-800">
              <span className="font-bold text-zinc-400">
                {(gameMode === 'EDITOR' || gameMode === 'WEEK_PLAYTEST') ? customStage?.name : (STAGES[currentStage]?.name || 'Unknown Stage')}
              </span>
              <div className="flex gap-4 items-center">
                {settings.botplay && <span className="font-black text-pink-500 animate-pulse">BOTPLAY ENABLED</span>}
                {settings.practiceMode && <span className="font-black text-cyan-500 animate-pulse">PRACTICE MODE</span>}
                
                <div className="flex gap-2 ml-4">
                  <button
                    onClick={() => gameRef.current?.togglePause()}
                    className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-white transition-colors"
                    title="Pause (ESC)"
                  >
                    <Pause className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => {
                      if (gameMode === 'EDITOR' || gameMode === 'WEEK_PLAYTEST') setScreen('EDITOR');
                      else if (gameMode === 'STORY' || gameMode === 'CUSTOM_STORY') setScreen('STORY_MODE_MENU');
                      else setScreen('FREE_PLAY_MENU');
                    }}
                    className="p-2 bg-red-900/50 hover:bg-red-800/50 rounded-lg text-red-400 transition-colors"
                    title="Stop"
                  >
                    <Square className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <span className="font-bold text-zinc-400 hidden sm:inline">Press ESC to pause</span>
            </div>
          )}

          {/* Debug Story Flow Menu (Only in CUSTOM_STORY) */}
          {gameMode === 'CUSTOM_STORY' && storyProgress && (
            <div className="fixed top-4 right-4 z-[100]">
              <button 
                onClick={() => setShowDebugFlow(!showDebugFlow)}
                className="p-2 bg-black/50 hover:bg-black/80 rounded-lg text-white/50 hover:text-white transition-all"
                title="Debug Story Flow"
              >
                <Settings className="w-5 h-5" />
              </button>
              
              <AnimatePresence>
                {showDebugFlow && (
                  <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="absolute top-12 right-0 w-64 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 shadow-2xl space-y-4"
                  >
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Story Debugger</h3>
                    <div className="space-y-1 max-h-[60vh] overflow-y-auto custom-scrollbar">
                      {storyProgress.week.sequence.map((node, idx) => {
                        const name = node.type === 'GAMEPLAY' 
                          ? storyProgress.stages.find(s => s.id === node.dataId)?.name || 'Unknown Track'
                          : storyProgress.week.vnData?.scenes.find(s => s.id === node.dataId)?.name || 'Unknown Scene';
                        
                        return (
                          <button
                            key={node.id}
                            onClick={() => {
                              const newProgress = { ...storyProgress, index: idx };
                              setStoryProgress(newProgress);
                              handleNextStoryNode(newProgress);
                              setShowDebugFlow(false);
                            }}
                            className={`w-full text-left px-3 py-2 rounded-xl text-[10px] font-bold uppercase transition-all ${storyProgress.index === idx ? 'bg-pink-600 text-white' : 'hover:bg-zinc-800 text-zinc-400'}`}
                          >
                            {idx + 1}. {name}
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          <RhythmGame 
            ref={gameRef}
            bpm={(gameMode === 'EDITOR' || gameMode === 'WEEK_PLAYTEST' || gameMode === 'CUSTOM_STORY' || gameMode === 'FREEPLAY') && customStage ? customStage.chart.bpm : (STAGES[currentStage]?.bpm || 100)}
            duration={(gameMode === 'EDITOR' || gameMode === 'WEEK_PLAYTEST' || gameMode === 'CUSTOM_STORY' || gameMode === 'FREEPLAY') && customStage ? 9999 : (STAGES[currentStage]?.duration || 180)}
            targetNotes={(gameMode === 'EDITOR' || gameMode === 'WEEK_PLAYTEST' || gameMode === 'CUSTOM_STORY' || gameMode === 'FREEPLAY') && customStage ? 0 : (STAGES[currentStage]?.targetNotes || 0)}
            scrollSpeed={(gameMode === 'EDITOR' || gameMode === 'WEEK_PLAYTEST' || gameMode === 'CUSTOM_STORY' || gameMode === 'FREEPLAY') && customStage ? customStage.chart.scrollSpeed : (STAGES[currentStage]?.scrollSpeed || 2.0)}
            botplay={settings.botplay}
            practiceMode={settings.practiceMode}
            playbackRate={playbackRate}
            keys={settings.keys}
            volume={settings.bgmVolume}
            isFullscreen={isFullscreen}
            mobileMode={settings.mobileMode}
            mobileButtonPositions={settings.mobileButtonPositions}
            theme={(gameMode === 'EDITOR' || gameMode === 'WEEK_PLAYTEST' || gameMode === 'CUSTOM_STORY' || gameMode === 'FREEPLAY') && customStage ? {
              bgTop: '#000000',
              bgBottom: '#1a1a1a',
              grid: 'rgba(255, 255, 255, 0.1)',
              stage: 'rgba(255, 255, 255, 0.2)',
              particles: 'stars'
            } : (STAGES[currentStage]?.theme || {
              id: 'default',
              name: 'Default',
              bg: 'https://picsum.photos/seed/default/1920/1080',
              colors: { primary: '#ff00ff', secondary: '#00ffff', accent: '#ffff00' }
            })}
            customStage={customStage}
            onComplete={handleLevelComplete}
            onGameOver={(score, judgements, reason, maxCombo) => {
              setResults({ score, judgements, reason, maxCombo });
              setScreen('GAMEOVER');
            }} 
            onQuit={() => {
              if (gameMode === 'EDITOR' || gameMode === 'WEEK_PLAYTEST') setScreen('EDITOR');
              else if (gameMode === 'STORY' || gameMode === 'CUSTOM_STORY') setScreen('STORY_MODE_MENU');
              else setScreen('FREE_PLAY_MENU');
            }}
            onOpenSettings={() => setShowPauseSettings(true)}
            onRestart={() => {
              // Force restart by briefly changing screen
              setScreen('START');
              setTimeout(() => {
                if (gameMode === 'EDITOR' && customStage) {
                  setScreen('PLAYING');
                } else if ((gameMode === 'WEEK_PLAYTEST' || gameMode === 'CUSTOM_STORY') && playtestWeek) {
                  startGame(weekPlaytestIndex, undefined, playbackRate, playtestWeek, weekPlaytestStages, gameMode);
                } else if (gameMode === 'FREEPLAY' && customStage) {
                  startGame(0, customStage, playbackRate, undefined, undefined, 'FREEPLAY');
                } else {
                  startGame(currentStage, undefined, playbackRate, undefined, undefined, gameMode);
                }
              }, 0);
            }}
          />
          <p className="text-zinc-500 font-medium text-sm">Press keys when arrows overlap the targets</p>

          {showPauseSettings && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
              <div className="max-w-xl w-full bg-blue-900/20 border border-blue-500/30 rounded-3xl p-10 shadow-2xl relative overflow-hidden flex flex-col items-center">
                <div className="absolute top-0 left-0 right-0 h-16 bg-blue-700 flex items-center justify-center parallelogram-right mb-8">
                  <h2 className="text-4xl font-black italic uppercase text-white tracking-widest">SETTINGS</h2>
                </div>

                <div className="mt-20 w-full space-y-6 text-left">
                  <div className="bg-gradient-to-r from-blue-900/40 to-transparent p-4 flex items-center justify-between rounded-r-full">
                    <div>
                      <h4 className="font-black italic text-xl text-white uppercase">Botplay</h4>
                      <p className="text-xs text-blue-300 uppercase font-bold tracking-tighter">Let the AI play for you</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="sr-only peer" 
                        checked={settings.botplay}
                        onChange={(e) => saveAllSettings({...settings, botplay: e.target.checked})}
                      />
                      <div className="w-14 h-7 bg-blue-900/50 border border-blue-500/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-blue-400 after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                    </label>
                  </div>

                  <div className="bg-gradient-to-r from-blue-900/40 to-transparent p-4 flex items-center justify-between rounded-r-full">
                    <div>
                      <h4 className="font-black italic text-xl text-white uppercase">Practice Mode</h4>
                      <p className="text-xs text-blue-300 uppercase font-bold tracking-tighter">No score, no game over</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="sr-only peer" 
                        checked={settings.practiceMode}
                        onChange={(e) => saveAllSettings({...settings, practiceMode: e.target.checked})}
                      />
                      <div className="w-14 h-7 bg-blue-900/50 border border-blue-500/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-blue-400 after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                    </label>
                  </div>

                  <div className="bg-gradient-to-r from-blue-900/40 to-transparent p-4 rounded-r-full space-y-4">
                    <div className="flex items-center gap-4">
                      <Volume2 className="w-6 h-6 text-blue-400" />
                      <span className="text-sm font-black italic uppercase text-white tracking-widest">Volume</span>
                    </div>
                    <input 
                      type="range" 
                      min="0" 
                      max="1" 
                      step="0.01" 
                      value={settings.bgmVolume}
                      onChange={(e) => {
                        const vol = parseFloat(e.target.value);
                        saveAllSettings({...settings, bgmVolume: vol});
                        bgmManager.setVolume(vol);
                      }}
                      className="w-full h-3 bg-blue-900/50 rounded-full appearance-none cursor-pointer accent-cyan-400 border border-blue-500/30"
                    />
                  </div>
                </div>

                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setShowPauseSettings(false)}
                  className="mt-8 group relative w-full h-16 transition-all duration-200"
                >
                  <div className="absolute inset-0 bg-red-600 parallelogram shadow-lg group-hover:brightness-125 transition-all"></div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-2xl font-black italic uppercase text-white tracking-widest">CLOSE</span>
                  </div>
                </motion.button>
              </div>
            </div>
          )}
        </motion.div>
      )}

      {screen === 'NEXT_SONG_RESULTS' && results && (
        <ResultsScreen
          type="SONG_CLEARED"
          results={results}
          songName={gameMode === 'STORY' ? (STAGES[currentStage]?.name || 'Unknown') : (customStage?.name || 'Unknown')}
          author={gameMode === 'STORY' ? 'Game' : (customStage?.author || 'Unknown')}
          difficulty={results.difficulty || "NORMAL"}
          clearTime={results.clearTime || "00:00"}
          accuracy={(() => {
            const total = results.judgements.sick + results.judgements.good + results.judgements.bad + results.judgements.shit + results.judgements.miss;
            const weighted = (results.judgements.sick * 1.0) + (results.judgements.good * 0.8) + (results.judgements.bad * 0.5) + (results.judgements.shit * 0.2);
            return total === 0 ? 0 : (weighted / total) * 100;
          })()}
          rank={(() => {
            const total = results.judgements.sick + results.judgements.good + results.judgements.bad + results.judgements.shit + results.judgements.miss;
            const weighted = (results.judgements.sick * 1.0) + (results.judgements.good * 0.8) + (results.judgements.bad * 0.5) + (results.judgements.shit * 0.2);
            const acc = total === 0 ? 0 : (weighted / total) * 100;
            if (acc >= 100) return "PFC";
            if (acc >= 95) return "S";
            if (acc >= 90) return "A";
            if (acc >= 80) return "B";
            if (acc >= 70) return "C";
            return "D";
          })()}
          onNext={() => {
            if (gameMode === 'STORY') {
              startGame(currentStage + 1, undefined, 1, undefined, undefined, 'STORY');
            } else if (gameMode === 'WEEK_PLAYTEST' && playtestWeek) {
              startGame(weekPlaytestIndex + 1, undefined, 1, playtestWeek, weekPlaytestStages, gameMode);
            } else if (gameMode === 'CUSTOM_STORY' && storyProgress) {
              handleNextStoryNode(storyProgress);
            }
          }}
          onBack={() => {
            if (gameMode === 'STORY') setScreen('STORY_MODE_MENU');
            else if (gameMode === 'CUSTOM_STORY') setScreen('STORY_MODE_MENU');
            else if (gameMode === 'FREEPLAY') setScreen('FREE_PLAY_MENU');
            else setScreen('EDITOR');
          }}
          nextText="NEXT SONG"
          backText="QUIT WEEK"
        />
      )}

      {screen === 'LEVEL_COMPLETE' && results && (
        <ResultsScreen
          type="WEEK_COMPLETE"
          results={results}
          clearTime={results.clearTime || "00:00"}
          accuracy={(() => {
            const total = results.judgements.sick + results.judgements.good + results.judgements.bad + results.judgements.shit + results.judgements.miss;
            const weighted = (results.judgements.sick * 1.0) + (results.judgements.good * 0.8) + (results.judgements.bad * 0.5) + (results.judgements.shit * 0.2);
            return total === 0 ? 0 : (weighted / total) * 100;
          })()}
          rank={(() => {
            const total = results.judgements.sick + results.judgements.good + results.judgements.bad + results.judgements.shit + results.judgements.miss;
            const weighted = (results.judgements.sick * 1.0) + (results.judgements.good * 0.8) + (results.judgements.bad * 0.5) + (results.judgements.shit * 0.2);
            const acc = total === 0 ? 0 : (weighted / total) * 100;
            if (acc >= 100) return "PFC";
            if (acc >= 95) return "S";
            if (acc >= 90) return "A";
            if (acc >= 80) return "B";
            if (acc >= 70) return "C";
            return "D";
          })()}
          onNext={() => {
            if (gameMode === 'STORY') {
              setScreen('VICTORY');
            } else if ((gameMode === 'WEEK_PLAYTEST' || gameMode === 'CUSTOM_STORY') && playtestWeek) {
              setScreen('WEEK_RESULTS');
            } else if (gameMode === 'EDITOR') {
              setScreen('EDITOR');
            } else {
              setScreen('FREE_PLAY_MENU');
            }
          }}
          onBack={() => {
            if (gameMode === 'STORY') setScreen('STORY_MODE_MENU');
            else if (gameMode === 'CUSTOM_STORY') setScreen('STORY_MODE_MENU');
            else if (gameMode === 'FREEPLAY') setScreen('FREE_PLAY_MENU');
            else setScreen('EDITOR');
          }}
          nextText={gameMode === 'EDITOR' ? "BACK TO EDITOR" : gameMode === 'FREEPLAY' ? "BACK TO FREEPLAY" : "FINISH WEEK"}
          backText="BACK TO MENU"
        />
      )}

      {screen === 'VICTORY' && results && (
        <ResultsScreen
          type="WEEK_COMPLETE"
          results={results}
          clearTime={results.clearTime || "00:00"}
          accuracy={(() => {
            const total = results.judgements.sick + results.judgements.good + results.judgements.bad + results.judgements.shit + results.judgements.miss;
            const weighted = (results.judgements.sick * 1.0) + (results.judgements.good * 0.8) + (results.judgements.bad * 0.5) + (results.judgements.shit * 0.2);
            return total === 0 ? 0 : (weighted / total) * 100;
          })()}
          rank={(() => {
            const total = results.judgements.sick + results.judgements.good + results.judgements.bad + results.judgements.shit + results.judgements.miss;
            const weighted = (results.judgements.sick * 1.0) + (results.judgements.good * 0.8) + (results.judgements.bad * 0.5) + (results.judgements.shit * 0.2);
            const acc = total === 0 ? 0 : (weighted / total) * 100;
            if (acc >= 100) return "PFC";
            if (acc >= 95) return "S";
            if (acc >= 90) return "A";
            if (acc >= 80) return "B";
            if (acc >= 70) return "C";
            return "D";
          })()}
          onNext={() => {
            setScreen('STORY_MODE_MENU');
          }}
          onBack={() => {
            setScreen('STORY_MODE_MENU');
          }}
          nextText="BACK TO STORY MENU"
          backText="BACK TO MENU"
        />
      )}

      {screen === 'WEEK_RESULTS' && playtestWeek && (
        <ResultsScreen
          type="WEEK_COMPLETE"
          results={{
            score: weekPlaytestResults.reduce((sum, r) => sum + r.score, 0),
            judgements: weekPlaytestResults.reduce((acc, r) => ({
              sick: acc.sick + r.judgements.sick,
              good: acc.good + r.judgements.good,
              bad: acc.bad + r.judgements.bad,
              shit: acc.shit + r.judgements.shit,
              miss: acc.miss + r.judgements.miss,
            }), { sick: 0, good: 0, bad: 0, shit: 0, miss: 0 }),
            maxCombo: weekPlaytestResults.reduce((max, r) => Math.max(max, r.maxCombo), 0)
          }}
          clearTime={results?.clearTime || "00:00"}
          accuracy={(() => {
            const aggregatedJudgements = weekPlaytestResults.reduce((acc, r) => ({
              sick: acc.sick + r.judgements.sick,
              good: acc.good + r.judgements.good,
              bad: acc.bad + r.judgements.bad,
              shit: acc.shit + r.judgements.shit,
              miss: acc.miss + r.judgements.miss,
            }), { sick: 0, good: 0, bad: 0, shit: 0, miss: 0 });
            const total = aggregatedJudgements.sick + aggregatedJudgements.good + aggregatedJudgements.bad + aggregatedJudgements.shit + aggregatedJudgements.miss;
            const weighted = (aggregatedJudgements.sick * 1.0) + (aggregatedJudgements.good * 0.8) + (aggregatedJudgements.bad * 0.5) + (aggregatedJudgements.shit * 0.2);
            return total === 0 ? 0 : (weighted / total) * 100;
          })()}
          rank={(() => {
            const aggregatedJudgements = weekPlaytestResults.reduce((acc, r) => ({
              sick: acc.sick + r.judgements.sick,
              good: acc.good + r.judgements.good,
              bad: acc.bad + r.judgements.bad,
              shit: acc.shit + r.judgements.shit,
              miss: acc.miss + r.judgements.miss,
            }), { sick: 0, good: 0, bad: 0, shit: 0, miss: 0 });
            const total = aggregatedJudgements.sick + aggregatedJudgements.good + aggregatedJudgements.bad + aggregatedJudgements.shit + aggregatedJudgements.miss;
            const weighted = (aggregatedJudgements.sick * 1.0) + (aggregatedJudgements.good * 0.8) + (aggregatedJudgements.bad * 0.5) + (aggregatedJudgements.shit * 0.2);
            const acc = total === 0 ? 0 : (weighted / total) * 100;
            if (acc >= 100) return "PFC";
            if (acc >= 95) return "S";
            if (acc >= 90) return "A";
            if (acc >= 80) return "B";
            if (acc >= 70) return "C";
            return "D";
          })()}
          weekResults={weekPlaytestResults}
          onNext={() => {
            startGame(0, undefined, 1, playtestWeek, weekPlaytestStages, gameMode);
          }}
          onBack={() => {
            if (gameMode === 'CUSTOM_STORY') setScreen('STORY_MODE_MENU');
            else setScreen('EDITOR');
          }}
          nextText="REPLAY WEEK"
          backText={gameMode === 'CUSTOM_STORY' ? 'BACK TO STORY MENU' : 'BACK TO EDITOR'}
        />
      )}

      {screen === 'GAMEOVER' && results && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] bg-black flex items-center justify-center overflow-hidden font-sans"
        >
          {/* Background Elements */}
          <div className="absolute inset-0 bg-[#050510]" />
          <div className="absolute inset-0 bg-gradient-to-b from-blue-900/20 via-transparent to-black" />
          
          {/* Perspective Grid */}
          <div className="absolute bottom-[-10%] left-[-50%] w-[200%] h-[60%] perspective-grid opacity-20 pointer-events-none" />

          {/* Floating Polygons */}
          {[...Array(8)].map((_, i) => (
            <motion.div
              key={i}
              initial={{ 
                x: Math.random() * window.innerWidth, 
                y: Math.random() * window.innerHeight,
                rotate: Math.random() * 360,
                scale: 0.5 + Math.random()
              }}
              animate={{ 
                y: [null, Math.random() * -100, Math.random() * 100],
                rotate: [null, Math.random() * 360],
                opacity: [0.1, 0.3, 0.1]
              }}
              transition={{ 
                duration: 10 + Math.random() * 20, 
                repeat: Infinity, 
                ease: "linear" 
              }}
              className="absolute pointer-events-none"
              style={{
                width: 0,
                height: 0,
                borderLeft: `${20 + Math.random() * 40}px solid transparent`,
                borderRight: `${20 + Math.random() * 40}px solid transparent`,
                borderBottom: `${40 + Math.random() * 80}px solid ${i % 2 === 0 ? 'rgba(34, 211, 238, 0.2)' : 'rgba(236, 72, 153, 0.2)'}`,
              }}
            />
          ))}

          {/* Main Content Grid */}
          <div className="relative z-10 w-full h-full max-w-7xl grid grid-cols-[1fr_400px_1fr] gap-8 p-12 items-center">
            
            {/* Left Column: Statistics */}
            <div className="flex flex-col gap-4">
              {[
                { label: 'Final Score', value: settings.practiceMode ? 'PRACTICE' : results.score.toLocaleString(), color: 'text-white' },
                { label: 'Sick', value: results.judgements.sick, color: 'text-cyan-400' },
                { label: 'Good', value: results.judgements.good, color: 'text-green-400' },
                { label: 'Bad', value: results.judgements.bad, color: 'text-pink-400' },
                { label: 'Shits', value: results.judgements.shit, color: 'text-orange-400' },
                { label: 'Misses', value: results.judgements.miss, color: 'text-red-500' },
              ].map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ x: -100, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 0.5 + i * 0.1, duration: 0.5 }}
                  className="relative group"
                >
                  <div className="absolute inset-0 bg-blue-600/20 trapezoid-left border-l-4 border-orange-500/50 group-hover:bg-blue-600/40 transition-colors" />
                  <div className="relative px-8 py-4 flex justify-between items-center">
                    <span className="text-xs font-black uppercase tracking-[0.2em] text-blue-300 italic">{stat.label}</span>
                    <span className={`text-2xl font-black italic ${stat.color} drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]`}>{stat.value}</span>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Center Column: Character & Title */}
            <div className="h-full flex flex-col items-center justify-between py-12">
              <motion.div
                initial={{ y: -50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="text-center"
              >
                <h2 className="text-7xl font-black text-white tracking-tighter uppercase italic animate-pulse-soft drop-shadow-[0_0_30px_rgba(255,255,255,0.5)]">
                  GAME OVER
                </h2>
                <div className="mt-2 inline-block bg-red-600/20 border border-red-500/50 px-6 py-1 rounded-full">
                  <p className="text-red-400 font-black uppercase tracking-widest text-[10px]">
                    {results.reason || 'SYSTEM FAILURE: HEALTH DEPLETED'}
                  </p>
                </div>
              </motion.div>

              <motion.div
                initial={{ y: 100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="relative"
              >
                <div className="absolute inset-0 bg-cyan-500/20 blur-[100px] rounded-full scale-150" />
                <motion.img 
                  animate={{ y: [0, -15, 0] }}
                  transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                  src={(() => {
                    const char = customStage ? (
                      (customStage.extraCharacters?.find(ec => ec.side === 'player' && ec.showFromStart)?.character) || 
                      customStage.characterPlayer || 
                      playerCharacter
                    ) : playerCharacter;
                    return char?.animations?.find(a => a.name === 'idle')?.image || char?.image;
                  })()} 
                  alt="Character" 
                  className="w-[450px] h-[450px] object-contain drop-shadow-[0_0_50px_rgba(34,211,238,0.3)]"
                  referrerPolicy="no-referrer"
                />
              </motion.div>

              <div className="flex gap-6 w-full px-4">
                <motion.button
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 1.2 }}
                  onClick={() => {
                    if (gameMode === 'EDITOR' && customStage) setScreen('PLAYING');
                    else if ((gameMode === 'WEEK_PLAYTEST' || gameMode === 'CUSTOM_STORY') && playtestWeek) {
                      startGame(weekPlaytestIndex, undefined, 1, playtestWeek, weekPlaytestStages, gameMode);
                    } else if (gameMode === 'FREEPLAY' && customStage) {
                      startGame(0, customStage, 1, undefined, undefined, 'FREEPLAY');
                    } else {
                      startGame(currentStage, undefined, 1, undefined, undefined, gameMode);
                    }
                  }}
                  className="flex-1 h-16 bg-gradient-to-r from-orange-500 to-red-600 text-white font-black tracking-widest uppercase italic flex items-center justify-center gap-3 hexagon-btn hover:scale-105 transition-transform active:scale-95 shadow-[0_0_30px_rgba(239,68,68,0.3)]"
                >
                  <RotateCcw className="w-6 h-6" />
                  RETRY STAGE
                </motion.button>
                <motion.button
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 1.3 }}
                  onClick={() => {
                    if (gameMode === 'EDITOR' || gameMode === 'WEEK_PLAYTEST') setScreen('EDITOR');
                    else if (gameMode === 'STORY' || gameMode === 'CUSTOM_STORY') setScreen('STORY_MODE_MENU');
                    else setScreen('FREE_PLAY_MENU');
                  }}
                  className="flex-1 h-16 bg-zinc-800 text-white font-black tracking-widest uppercase italic flex items-center justify-center gap-3 hexagon-btn hover:bg-zinc-700 transition-all active:scale-95 border border-white/10"
                >
                  <Home className="w-6 h-6" />
                  QUIT TO MENU
                </motion.button>
              </div>
            </div>

            {/* Right Column: Ratings */}
            <div className="flex flex-col gap-6">
              <motion.div
                initial={{ x: 100, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.8 }}
                className="bg-zinc-800/50 backdrop-blur-md border border-white/10 p-8 rounded-[2rem] relative overflow-hidden group"
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/10 blur-3xl rounded-full" />
                <div className="flex items-center justify-between">
                  <span className="text-xl font-black text-zinc-400 uppercase tracking-widest italic">Ratings:</span>
                  <div className="w-20 h-20 rounded-full bg-gradient-to-br from-zinc-700 to-zinc-900 border-4 border-red-500 flex items-center justify-center shadow-[0_0_20px_rgba(239,68,68,0.5)] animate-pulse">
                    <span className="text-5xl font-black text-red-500 italic">F</span>
                  </div>
                </div>
              </motion.div>

              <motion.div
                initial={{ x: 100, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.9 }}
                className="bg-cyan-500/10 backdrop-blur-md border border-cyan-500/30 p-6 rounded-full flex items-center justify-between px-10"
              >
                <span className="text-sm font-black text-cyan-400 uppercase tracking-widest italic">Accuracy:</span>
                <span className="text-2xl font-black text-white italic">
                  {(() => {
                    const total = results.judgements.sick + results.judgements.good + results.judgements.bad + results.judgements.shit + results.judgements.miss;
                    const weighted = (results.judgements.sick * 1.0) + (results.judgements.good * 0.8) + (results.judgements.bad * 0.5) + (results.judgements.shit * 0.2);
                    const acc = total === 0 ? 0 : (weighted / total) * 100;
                    return acc.toFixed(2) + '%';
                  })()}
                </span>
              </motion.div>

              <motion.div
                initial={{ x: 100, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 1.0 }}
                className="bg-blue-500/10 backdrop-blur-md border border-blue-500/30 p-6 rounded-full flex items-center justify-between px-10"
              >
                <span className="text-sm font-black text-blue-400 uppercase tracking-widest italic">Max Combo:</span>
                <span className="text-2xl font-black text-white italic">{results.maxCombo}</span>
              </motion.div>
            </div>

          </div>
        </motion.div>
      )}
      </AnimatePresence>
      <NowPlayingOverlay songName={currentSongName} />
      
      {showMobileLayoutEditor && (
        <MobileLayoutEditor 
          positions={settings.mobileButtonPositions}
          onSave={(newPos) => {
            saveAllSettings({ ...settings, mobileButtonPositions: newPos });
            setShowMobileLayoutEditor(false);
          }}
          onCancel={() => setShowMobileLayoutEditor(false)}
        />
      )}
    </div>
  );
}
