import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import LZString from 'lz-string';
import { 
  X, 
  Save, 
  Play, 
  Plus, 
  Minus,
  Trash2, 
  ChevronLeft, 
  ChevronRight, 
  ChevronUp,
  ChevronDown,
  Layers, 
  Music, 
  User, 
  Zap, 
  Layout, 
  Settings as SettingsIcon,
  Search,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Maximize2,
  Minimize2,
  Camera,
  Image as ImageIcon,
  FileText,
  Clock,
  Volume2,
  FastForward,
  Rewind,
  Pause,
  Edit3,
  Move,
  Undo2,
  Redo2,
  Download,
  Upload,
  Copy,
  ClipboardPaste,
  Repeat,
  AlertCircle,
  Loader2,
  Sparkles,
  Type,
  ListMusic,
  Share2,
  GitBranch,
  BookOpen,
  Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { sfxManager } from '../audio';
import { GoogleGenAI, Type as GenAIType } from "@google/genai";
import VNEditor from './VNEditor';
import AITriggerGenerator from './AITriggerGenerator';
import { 
  auth, 
  db, 
  collection, 
  addDoc, 
  setDoc,
  updateDoc,
  getDoc, 
  doc, 
  OperationType, 
  handleFirestoreError,
  ensureUserProfile,
  onQuotaExceededChange,
  isConfigValid
} from '../firebase';
import { 
  SavedStage, 
  SavedWeek,
  CharacterData, 
  ExtraCharacterData,
  HealthIcons,
  StageData, 
  ChartData, 
  ChartNote, 
  ChartEvent, 
  CustomObject,
  Offset, 
  Animation,
  StageLayer,
  CustomNotes,
  EventNode,
  ArchiveCharacter,
  ArchiveBackground
} from './EditorTypes';

// --- Default Data ---
const DEFAULT_CHARACTER: CharacterData = {
  name: 'New Character',
  image: 'https://picsum.photos/seed/char/512/512',
  xml: '',
  animations: [
    { name: 'idle', prefix: 'idle', indices: [], fps: 24, loop: true, offset: { x: 0, y: 0 } },
    { name: 'singLEFT', prefix: 'left', indices: [], fps: 24, loop: false, offset: { x: 0, y: 0 } },
    { name: 'singRIGHT', prefix: 'right', indices: [], fps: 24, loop: false, offset: { x: 0, y: 0 } },
    { name: 'singUP', prefix: 'up', indices: [], fps: 24, loop: false, offset: { x: 0, y: 0 } },
    { name: 'singDOWN', prefix: 'down', indices: [], fps: 24, loop: false, offset: { x: 0, y: 0 } },
  ],
  scale: 1,
  flipX: false,
};

const DEFAULT_STAGE: StageData = {
  name: 'New Stage',
  layers: [
    { id: 'bg', image: 'https://picsum.photos/seed/bg/1920/1080', scrollFactor: 0.1, scale: 1, position: { x: 0, y: 0 }, zIndex: 0 },
  ],
  cameraFocus: {
    player: { x: 700, y: 500 },
    opponent: { x: 300, y: 500 },
  },
};

const DEFAULT_CHART: ChartData = {
  bpm: 100,
  scrollSpeed: 1,
  notes: [],
  events: [],
};

const DEFAULT_SAVED_STAGE: SavedStage = {
  id: 'new-stage-' + Date.now(),
  name: 'New Stage',
  characterPlayer: { ...DEFAULT_CHARACTER, name: 'Player' },
  characterOpponent: { ...DEFAULT_CHARACTER, name: 'Opponent' },
  stage: DEFAULT_STAGE,
  chart: DEFAULT_CHART,
  audioUrl: '',
};

import { ArchiveImportModal, ArchiveBackgroundImportModal } from './ArchiveModals';
import { loadStagesFromDB, saveStagesToDB, loadWeeksFromDB, saveWeeksToDB, loadArchiveCharacters, saveArchiveCharacters, loadArchiveBackgrounds } from './Storage';

// --- Main Editor Component ---
interface EditorProps {
  onBack: () => void;
  onPlaytest: (stage: SavedStage, playbackRate: number) => void;
  onPlaytestWeek: (week: SavedWeek, allStages: SavedStage[]) => void;
  settings: any;
  setSettings: React.Dispatch<React.SetStateAction<any>>;
  onEditStateChange?: (isEditing: boolean) => void;
}

export const EditorMain: React.FC<EditorProps> = ({ onBack, onPlaytest, onPlaytestWeek, settings, setSettings, onEditStateChange }) => {
  const [activeTab, setActiveTab] = useState<'CHARACTERS' | 'STAGE' | 'CHART' | 'EVENTS' | 'PLAYTEST'>('CHARACTERS');
  const [savedStages, setSavedStages] = useState<SavedStage[]>([]);
  const [savedWeeks, setSavedWeeks] = useState<SavedWeek[]>([]);
  const [listTab, setListTab] = useState<'TRACKS' | 'WEEKS'>('TRACKS');
  const [currentStage, setCurrentStage] = useState<SavedStage | null>(null);
  const [currentWeek, setCurrentWeek] = useState<SavedWeek | null>(null);
  const [showSavedList, setShowSavedList] = useState(true);
  useEffect(() => {
    onEditStateChange?.(!showSavedList);
    return () => {
      // Reset editing state when leaving editor entirely
      onEditStateChange?.(false);
    };
  }, [showSavedList, onEditStateChange]);

  const [stageToDelete, setStageToDelete] = useState<string | null>(null);
  const [weekToDelete, setWeekToDelete] = useState<string | null>(null);
  const [stageToRename, setStageToRename] = useState<{ id: string, name: string } | null>(null);
  const [weekToRename, setWeekToRename] = useState<{ id: string, name: string } | null>(null);
  const [isUploading, setIsUploading] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showPastePrompt, setShowPastePrompt] = useState(false);
  const [pasteType, setPasteType] = useState<'STAGE' | 'WEEK'>('STAGE');
  const [targetPasteId, setTargetPasteId] = useState<string | undefined>(undefined);

  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (!showSavedList) return;
    
    const handleGlobalPaste = (e: ClipboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      
      const text = e.clipboardData?.getData('text');
      if (text) {
        try {
          const decompressed = LZString.decompressFromBase64(text);
          const data = JSON.parse(decompressed || text);
          if (data.week && data.tracks) {
            processPasteWeek(text);
          } else if (data.chart || data.layers) {
            processPasteStage(text);
          }
        } catch (err) {}
      }
    };
    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [showSavedList, savedStages, savedWeeks]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }
      
      // Tab switching shortcuts (Alt + 1-5)
      if (e.altKey) {
        if (e.key === '1') setActiveTab('CHARACTERS');
        else if (e.key === '2') setActiveTab('STAGE');
        else if (e.key === '3') setActiveTab('CHART');
        else if (e.key === '4') setActiveTab('EVENTS');
        else if (e.key === '5') setActiveTab('PLAYTEST');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  const moveStage = (id: string, direction: 'up' | 'down') => {
    const index = savedStages.findIndex(s => s.id === id);
    if (index === -1) return;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === savedStages.length - 1) return;

    const newStages = [...savedStages];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    [newStages[index], newStages[targetIndex]] = [newStages[targetIndex], newStages[index]];
    
    setSavedStages(newStages);
    saveToLocalStorage(newStages);
  };

  const moveWeek = (id: string, direction: 'up' | 'down') => {
    const index = savedWeeks.findIndex(w => w.id === id);
    if (index === -1) return;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === savedWeeks.length - 1) return;

    const newWeeks = [...savedWeeks];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    [newWeeks[index], newWeeks[targetIndex]] = [newWeeks[targetIndex], newWeeks[index]];
    
    setSavedWeeks(newWeeks);
    saveWeeksToStorage(newWeeks);
  };

  useEffect(() => {
    const unsubscribe = onQuotaExceededChange((status) => {
      setQuotaExceeded(status);
    });
    return () => unsubscribe();
  }, []);
  const [showUploadModal, setShowUploadModal] = useState<SavedStage | null>(null);
  const [levelDescription, setLevelDescription] = useState('');
  const [customThumbnail, setCustomThumbnail] = useState('');
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [thumbnailPrompt, setThumbnailPrompt] = useState('');
  const [lastAutoSave, setLastAutoSave] = useState<Date | null>(null);
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const generateAIThumbnail = async () => {
    if (!thumbnailPrompt.trim()) {
      showNotification('Please enter a prompt for the AI.', 'error');
      return;
    }

    setIsGeneratingThumbnail(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [{ text: `A high-quality, vibrant game thumbnail for a rhythm game level called "${showUploadModal?.name}". Style: Friday Night Funkin' / Cartoon. Description: ${thumbnailPrompt}` }],
        },
        config: {
          imageConfig: {
            aspectRatio: "16:9",
            imageSize: "1K"
          }
        }
      });

      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          const base64Data = part.inlineData.data;
          setCustomThumbnail(`data:image/png;base64,${base64Data}`);
          showNotification('AI Thumbnail generated!', 'success');
          break;
        }
      }
    } catch (error) {
      console.error('AI Thumbnail error:', error);
      showNotification('Failed to generate AI thumbnail.', 'error');
    } finally {
      setIsGeneratingThumbnail(false);
    }
  };

  const resizeImage = (base64Str: string, maxWidth = 800, maxHeight = 450): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = base64Str;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
        if (height > maxHeight) {
          width *= maxHeight / height;
          height = maxHeight;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => resolve(base64Str);
    });
  };

  const uploadStage = async (stage: SavedStage) => {
    if (!auth.currentUser) {
      showNotification('Please create an account before uploading your level', 'error');
      return;
    }

    sfxManager.playDataSync();
    setIsUploading(stage.id);
    setUploadProgress(0);
    try {
      const userData = await ensureUserProfile(auth.currentUser);
      if (!userData) {
        showNotification('Please create an account before uploading your level', 'error');
        setIsUploading(null);
        return;
      }

      setUploadProgress(10);

      // Check note limit (20,000)
      if ((stage.chart?.notes?.length || 0) > 20000) {
        showNotification('Stage exceeds the 20,000 note limit.', 'error');
        setIsUploading(null);
        return;
      }

      setUploadProgress(5);
      // Pause for UI to update "Preparing" status before compressing heavy data
      await new Promise(resolve => setTimeout(resolve, 100));

      const stageJson = JSON.stringify(stage);
      setUploadProgress(10);
      // Pause for UI to update "Compressing" status
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const compressedData = LZString.compressToBase64(stageJson);
      
      setUploadProgress(20);

      // Firestore document limit is 1MB. 
      const CHUNK_SIZE = 900000; // Increase to 900KB to reduce write count (save daily quota)
      const chunks: string[] = [];
      for (let i = 0; i < compressedData.length; i += CHUNK_SIZE) {
        chunks.push(compressedData.substring(i, i + CHUNK_SIZE));
      }

      // Limit to 120 chunks (~100MB)
      if (chunks.length > 120) {
        showNotification('Stage data is too large (max 100MB).', 'error');
        setIsUploading(null);
        return;
      }

      let finalThumbnail = customThumbnail || stage.thumbnail || ('https://picsum.photos/seed/' + stage.id + '/400/225');
      if (finalThumbnail.startsWith('data:image')) {
        finalThumbnail = await resizeImage(finalThumbnail);
      }

      const weekId = crypto.randomUUID();
      const weekData = {
        id: weekId,
        name: stage.name,
        creatorUid: auth.currentUser.uid,
        creatorName: userData.displayName,
        creatorId: userData.creatorId,
        description: levelDescription || `A custom week created by ${userData.displayName}.`,
        thumbnail: finalThumbnail,
        songs: [stage.name],
        difficulty: 5,
        likesCount: 0,
        commentsCount: 0,
        data: chunks.length === 1 ? chunks[0] : '', 
        isCompressed: true,
        isChunked: chunks.length > 1,
        chunkCount: chunks.length,
        isReady: false,
        createdAt: new Date().toISOString()
      };

      await setDoc(doc(db, 'weeks', weekId), weekData);
      setUploadProgress(40);
      
      if (chunks.length > 1) {
        const totalChunks = chunks.length;
        
        // Upload each chunk sequentially to avoid "resource-exhausted" error
        // Firestore has a limit on the number of pending writes (queued writes)
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          await setDoc(doc(db, 'weeks', weekId, 'chunks', i.toString()), {
            index: i,
            data: chunk
          });
          
          // Update progress based on completed chunks
          setUploadProgress(40 + ((i + 1) / totalChunks) * 50);
          
          // Pause longer for write stream to free up data (especially important for large chunks)
          // 500ms is a safe interval to avoid overloading backend
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        await updateDoc(doc(db, 'weeks', weekId), { isReady: true });
      } else {
        await updateDoc(doc(db, 'weeks', weekId), { isReady: true });
      }

      setUploadProgress(100);
      showNotification('Stage uploaded successfully!', 'success');
      setShowUploadModal(null);
      setLevelDescription('');
      setCustomThumbnail('');
      setThumbnailPrompt('');
    } catch (error) {
      const errStr = error instanceof Error ? error.message : String(error);
      if (errStr.includes('Missing or insufficient permissions') || errStr.includes('permission-denied')) {
        showNotification('Please create an account before uploading your level', 'error');
      } else {
        showNotification('Failed to upload stage.', 'error');
      }
      try {
        handleFirestoreError(error, OperationType.CREATE, 'weeks');
      } catch (e) {
        // handleFirestoreError throws, catch it here so finally block runs smoothly
      }
    } finally {
      setIsUploading(null);
      setUploadProgress(0);
    }
  };

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const historyRef = useRef<SavedStage[]>([]);
  const historyIndexRef = useRef<number>(-1);

  const updateStage = (newStage: SavedStage | ((prev: SavedStage) => SavedStage), skipHistory = false) => {
    const resolvedStage = typeof newStage === 'function' 
      ? (newStage as (prev: SavedStage) => SavedStage)(currentStageRef.current!) 
      : newStage;

    setCurrentStage(resolvedStage);
    currentStageRef.current = resolvedStage;
    
    if (!skipHistory) {
      const newHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
      newHistory.push(resolvedStage);
      if (newHistory.length > 50) {
        newHistory.shift();
      }
      historyRef.current = newHistory;
      historyIndexRef.current = newHistory.length - 1;
      
      setCanUndo(historyIndexRef.current > 0);
      setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
    }
  };

  const undo = () => {
    if (historyIndexRef.current > 0) {
      historyIndexRef.current -= 1;
      setCurrentStage(historyRef.current[historyIndexRef.current]);
      setCanUndo(historyIndexRef.current > 0);
      setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
    }
  };

  const redo = () => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current += 1;
      setCurrentStage(historyRef.current[historyIndexRef.current]);
      setCanUndo(historyIndexRef.current > 0);
      setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
    }
  };

  const currentStageRef = useRef(currentStage);
  const savedStagesRef = useRef(savedStages);
  const currentWeekRef = useRef(currentWeek);
  const savedWeeksRef = useRef(savedWeeks);
  const activeParsingTasks = useRef<Set<string>>(new Set());

  useEffect(() => {
    currentStageRef.current = currentStage;
    savedStagesRef.current = savedStages;
    currentWeekRef.current = currentWeek;
    savedWeeksRef.current = savedWeeks;
  }, [currentStage, savedStages, currentWeek, savedWeeks]);

  // Auto-save every 30 seconds
  useEffect(() => {
    const autoSaveInterval = setInterval(() => {
      if (showSavedList) return; // Only auto-save if in editor mode

      if (currentStageRef.current) {
        const stage = currentStageRef.current;
        const updatedStages = [...savedStagesRef.current];
        const index = updatedStages.findIndex(s => s.id === stage.id);
        if (index >= 0) {
          updatedStages[index] = stage;
        } else {
          updatedStages.unshift(stage);
        }
        setSavedStages(updatedStages);
        saveToLocalStorage(updatedStages);
        setLastAutoSave(new Date());
        console.log(`Auto-saved stage: ${stage.name}`);
      }

      if (currentWeekRef.current) {
        const week = currentWeekRef.current;
        const updatedWeeks = [...savedWeeksRef.current];
        const index = updatedWeeks.findIndex(w => w.id === week.id);
        if (index >= 0) {
          updatedWeeks[index] = week;
        } else {
          updatedWeeks.unshift(week);
        }
        setSavedWeeks(updatedWeeks);
        saveWeeksToStorage(updatedWeeks);
        setLastAutoSave(new Date());
        console.log(`Auto-saved week: ${week.name}`);
      }
    }, 30000);

    return () => clearInterval(autoSaveInterval);
  }, [showSavedList]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (currentStageRef.current) {
          saveCurrentStage();
        } else if (currentWeekRef.current) {
          saveCurrentWeek();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Load saved stages and weeks from IndexedDB
  useEffect(() => {
    loadStagesFromDB().then(stages => {
      if (stages.length > 0) {
        setSavedStages(stages);
        setSelectedStageId(stages[0].id);
      } else {
        // Fallback to localStorage if any
        const saved = localStorage.getItem('fnr-saved-stages');
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            setSavedStages(parsed);
            setSelectedStageId(parsed[0].id);
            saveStagesToDB(parsed); // Migrate
          } catch (e) {
            console.error('Failed to parse saved stages', e);
          }
        }
      }
    }).catch(e => console.error('Failed to load stages from DB', e));

    loadWeeksFromDB().then(weeks => {
      if (weeks.length > 0) {
        setSavedWeeks(weeks);
      }
    }).catch(e => console.error('Failed to load weeks from DB', e));
  }, []);

  const saveToLocalStorage = (stages: SavedStage[]) => {
    saveStagesToDB(stages).catch(e => console.error('Failed to save stages to DB', e));
  };

  const saveWeeksToStorage = (weeks: SavedWeek[]) => {
    saveWeeksToDB(weeks).catch(e => console.error('Failed to save weeks to DB', e));
  };

  const startAIParseScript = async (weekId: string, scriptText: string, clearExisting: boolean) => {
    if (!scriptText.trim()) return;
    if (!process.env.GEMINI_API_KEY) {
      alert("GEMINI_API_KEY is missing. Please configure it in Settings.");
      return;
    }
    
    // Add to active tasks
    activeParsingTasks.current.add(weekId);
    
    try {
      // 1. Split script into chunks
      const CHUNK_SIZE = 2500;
      const chunks: string[] = [];
      let currentChunk = "";
      const lines = scriptText.split('\n');
      for (const line of lines) {
        if (currentChunk.length + line.length > CHUNK_SIZE && currentChunk.length > 0) {
          chunks.push(currentChunk);
          currentChunk = "";
        }
        currentChunk += line + "\n";
      }
      if (currentChunk.trim()) chunks.push(currentChunk);

      // 2. Update initial status in savedWeeks
      setSavedWeeks(prev => {
        const newWeeks = prev.map(w => {
          if (w.id === weekId) {
            const vnData = w.vnData || { id: w.id, name: w.name, scenes: [], assets: [], characters: [], styles: [] };
            const updatedVN = {
              ...vnData,
              scenes: clearExisting ? [] : vnData.scenes,
              parsingStatus: {
                isParsing: true,
                progress: 0,
                total: chunks.length,
                currentTask: 'Initializing...'
              }
            };
            
            if (currentWeekRef.current?.id === weekId) {
              setCurrentWeek(prev => prev ? { ...prev, vnData: updatedVN } : null);
            }

            return {
              ...w,
              vnData: updatedVN
            };
          }
          return w;
        });
        saveWeeksToStorage(newWeeks);
        return newWeeks;
      });

      // 3. Start parsing loop
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      for (let i = 0; i < chunks.length; i++) {
        // Check for cancellation
        if (!activeParsingTasks.current.has(weekId)) {
          console.log(`AI Parsing for week ${weekId} cancelled.`);
          return;
        }

        try {
          const chunk = chunks[i];
          
          // Update progress - mark as "Processing"
          setSavedWeeks(prev => {
            const newWeeks = prev.map(w => {
              if (w.id === weekId && w.vnData?.parsingStatus) {
                const updatedVN = {
                  ...w.vnData,
                  parsingStatus: {
                    ...w.vnData.parsingStatus,
                    progress: i,
                    currentTask: `Analyzing part ${i + 1} of ${chunks.length}...`
                  }
                };

                if (currentWeekRef.current?.id === weekId) {
                  setCurrentWeek(prev => prev ? { ...prev, vnData: updatedVN } : null);
                }

                return { ...w, vnData: updatedVN };
              }
              return w;
            });
            return newWeeks;
          });

          const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `Parse this PART of a raw script text into a structured Visual Novel sequence.
            This is part ${i + 1} of ${chunks.length}.
            
            """
            ${chunk}
            """`,
            config: {
              systemInstruction: `You are a Visual Novel script parser. Your task is to extract speakers, dialogue, emotions, and choices from raw text.
              
              Rules:
              1. Identify Speakers: Look for "Name: Dialogue" or "Name (Emotion): Dialogue". If no name is found, use "Narrator".
              2. Detect Emotions: If a speaker has an emotion in parentheses (e.g., "John (Happy): Hello"), extract "Happy" as the emotion.
              3. Separate Dialogue: Text inside double quotes is dialogue. Text outside is narration.
              4. Detect Choices: Lines starting with "-" or numbers (e.g., "1. Choice A") are interactive choices for the scene immediately preceding them.
              5. Structure: Group dialogues into logical scenes. A scene should end when choices appear or when there's a major transition.
              6. Output: Return a JSON object with a "scenes" array of VNScene objects.
              
              VNScene structure: { name: string, dialogue: [{ speaker: string, text: string, emotion?: string }], choices: [{ text: string }] }`,
              responseMimeType: "application/json",
              responseSchema: {
                type: GenAIType.OBJECT,
                properties: {
                  scenes: {
                    type: GenAIType.ARRAY,
                    items: {
                      type: GenAIType.OBJECT,
                      properties: {
                        name: { type: GenAIType.STRING },
                        dialogue: {
                          type: GenAIType.ARRAY,
                          items: {
                            type: GenAIType.OBJECT,
                            properties: {
                              speaker: { type: GenAIType.STRING },
                              text: { type: GenAIType.STRING },
                              emotion: { type: GenAIType.STRING }
                            }
                          }
                        },
                        choices: {
                          type: GenAIType.ARRAY,
                          items: {
                            type: GenAIType.OBJECT,
                            properties: {
                              text: { type: GenAIType.STRING }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          });

          const result = JSON.parse(response.text);
          const parsedScenes = result.scenes || [];

          setSavedWeeks(prev => {
            const newWeeks = prev.map(w => {
              if (w.id === weekId && w.vnData) {
                const vn = w.vnData;
                const existingCount = vn.scenes.length;
                const lastExistingScene = vn.scenes[existingCount - 1];
                
                const newScenes = parsedScenes.map((s: any, idx: number) => {
                  const scene = {
                    id: `ai-scene-${Date.now()}-${i}-${idx}`,
                    name: s.name || `Scene ${existingCount + idx + 1}`,
                    dialogue: (s.dialogue || []).map((d: any, j: number) => {
                      const char = vn.characters.find(c => c.name.toLowerCase() === d.speaker?.toLowerCase());
                      return {
                        id: `ai-diag-${Date.now()}-${i}-${idx}-${j}`,
                        speaker: d.speaker || 'Narrator',
                        characterId: char?.id || null,
                        text: d.text,
                        emotion: d.emotion || '',
                        styleId: 'default'
                      };
                    }),
                    backgroundId: lastExistingScene?.backgroundId || '',
                    musicId: lastExistingScene?.musicId || '',
                    characters: lastExistingScene ? JSON.parse(JSON.stringify(lastExistingScene.characters)) : [],
                    nextSceneId: null,
                    choices: (s.choices || []).map((c: any, j: number) => ({
                      id: `ai-choice-${Date.now()}-${i}-${idx}-${j}`,
                      text: c.text,
                      nextSceneId: null
                    }))
                  };
                  return scene;
                });

                // Link scenes
                for (let j = 0; j < newScenes.length - 1; j++) {
                  newScenes[j].nextSceneId = newScenes[j+1].id;
                }
                if (lastExistingScene && newScenes.length > 0) {
                  lastExistingScene.nextSceneId = newScenes[0].id;
                }

                const updatedVN = {
                  ...vn,
                  scenes: [...vn.scenes, ...newScenes],
                  parsingStatus: {
                    ...vn.parsingStatus!,
                    progress: i + 1,
                    currentTask: `Completed part ${i + 1} of ${chunks.length}`
                  }
                };

                if (currentWeekRef.current?.id === weekId) {
                  setCurrentWeek(prev => prev ? { ...prev, vnData: updatedVN } : null);
                }

                return { ...w, vnData: updatedVN };
              }
              return w;
            });
            saveWeeksToStorage(newWeeks);
            return newWeeks;
          });
        } catch (error) {
          console.error('AI Script Parsing Error:', error);
          // Update status to show error but continue
          setSavedWeeks(prev => {
            const newWeeks = prev.map(w => {
              if (w.id === weekId && w.vnData?.parsingStatus) {
                const updatedVN = {
                  ...w.vnData,
                  parsingStatus: {
                    ...w.vnData.parsingStatus,
                    currentTask: `Error in part ${i + 1}, skipping...`
                  }
                };
                if (currentWeekRef.current?.id === weekId) {
                  setCurrentWeek(prev => prev ? { ...prev, vnData: updatedVN } : null);
                }
                return { ...w, vnData: updatedVN };
              }
              return w;
            });
            return newWeeks;
          });
        }
      }

      // 4. Final update
      setSavedWeeks(prev => {
        const newWeeks = prev.map(w => {
          if (w.id === weekId && w.vnData) {
            const updatedVN = {
              ...w.vnData,
              parsingStatus: {
                isParsing: false,
                progress: chunks.length,
                total: chunks.length,
                currentTask: 'Completed'
              }
            };
            
            if (currentWeekRef.current?.id === weekId) {
              setCurrentWeek(prev => prev ? { ...prev, vnData: updatedVN } : null);
            }

            return {
              ...w,
              vnData: updatedVN
            };
          }
          return w;
        });
        saveWeeksToStorage(newWeeks);
        return newWeeks;
      });
    } catch (error) {
      console.error('Global AI Script Parsing Error:', error);
      setSavedWeeks(prev => {
        const newWeeks = prev.map(w => {
          if (w.id === weekId && w.vnData) {
            const updatedVN = {
              ...w.vnData,
              parsingStatus: {
                isParsing: false,
                progress: 0,
                total: 0,
                currentTask: 'Error: ' + (error instanceof Error ? error.message : 'Unknown error')
              }
            };
            if (currentWeekRef.current?.id === weekId) {
              setCurrentWeek(prev => prev ? { ...prev, vnData: updatedVN } : null);
            }
            return { ...w, vnData: updatedVN };
          }
          return w;
        });
        return newWeeks;
      });
    } finally {
      activeParsingTasks.current.delete(weekId);
    }
  };

  const cancelAIParseScript = (weekId: string) => {
    activeParsingTasks.current.delete(weekId);
    setSavedWeeks(prev => {
      const newWeeks = prev.map(w => {
        if (w.id === weekId && w.vnData?.parsingStatus) {
          const updatedVN = {
            ...w.vnData,
            parsingStatus: {
              ...w.vnData.parsingStatus,
              isParsing: false,
              currentTask: 'Cancelled'
            }
          };
          if (currentWeekRef.current?.id === weekId) {
            setCurrentWeek(prev => prev ? { ...prev, vnData: updatedVN } : null);
          }
          return { ...w, vnData: updatedVN };
        }
        return w;
      });
      return newWeeks;
    });
  };

  const renderAIParsingProgress = () => (
    <>
      {savedWeeks.map(w => w.vnData?.parsingStatus?.isParsing && (
        <motion.div 
          key={w.id}
          initial={{ opacity: 0, y: 50, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className="fixed bottom-8 right-8 z-[100] bg-zinc-900 border-2 border-purple-500/50 rounded-3xl p-6 shadow-[0_0_50px_rgba(168,85,247,0.3)] backdrop-blur-xl w-80"
        >
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 bg-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-600/40 animate-pulse">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-tighter text-white italic">AI Script Parsing</h3>
              <p className="text-[10px] font-black text-purple-500 uppercase tracking-widest">
                {w.name} • Running in background
              </p>
            </div>
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest">
              <span className="text-zinc-400 truncate w-40">{w.vnData.parsingStatus.currentTask}</span>
              <span className="text-purple-500">{Math.round((w.vnData.parsingStatus.progress / w.vnData.parsingStatus.total) * 100)}%</span>
            </div>
            <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-purple-500"
                initial={{ width: 0 }}
                animate={{ width: `${(w.vnData.parsingStatus.progress / w.vnData.parsingStatus.total) * 100}%` }}
              />
            </div>
            <button 
              onClick={() => cancelAIParseScript(w.id)}
              className="w-full mt-4 py-2 bg-zinc-800 hover:bg-red-500/20 text-zinc-400 hover:text-red-500 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all border border-zinc-700 hover:border-red-500/50 flex items-center justify-center gap-2"
            >
              <X className="w-3 h-3" />
              Cancel Parsing
            </button>
          </div>
        </motion.div>
      ))}
    </>
  );

  const saveCurrentWeek = () => {
    if (!currentWeek) return;
    const updatedWeeks = [...savedWeeks];
    const index = updatedWeeks.findIndex(w => w.id === currentWeek.id);
    if (index >= 0) {
      updatedWeeks[index] = currentWeek;
    } else {
      updatedWeeks.unshift(currentWeek);
    }
    setSavedWeeks(updatedWeeks);
    saveWeeksToStorage(updatedWeeks);
    showNotification('Week saved successfully!');
  };

  const loadStage = (stage: SavedStage) => {
    // Ensure all notes, events, and layers have unique IDs
    const seenNoteIds = new Set<string>();
    const notesWithIds = (stage.chart?.notes || []).map(n => {
      let id = n.id;
      if (!id || seenNoteIds.has(id)) {
        id = crypto.randomUUID();
      }
      seenNoteIds.add(id);
      return { ...n, id };
    });

    const seenEventIds = new Set<string>();
    const eventIdMap = new Map<string, string>();
    const eventsWithIds = (stage.chart?.events || []).map(e => {
      let id = e.id;
      if (!id || seenEventIds.has(id)) {
        id = crypto.randomUUID();
        if (e.id) eventIdMap.set(e.id, id);
      }
      seenEventIds.add(id);
      return { ...e, id };
    });

    // Update event references
    eventsWithIds.forEach(e => {
      if (e.type === 'loop' && e.value.loopEventId && eventIdMap.has(e.value.loopEventId)) {
        e.value.loopEventId = eventIdMap.get(e.value.loopEventId);
      }
    });

    const seenLayerIds = new Set<string>();
    const layersWithIds = stage.stage.layers.map(l => {
      let id = l.id;
      if (!id || seenLayerIds.has(id)) {
        id = crypto.randomUUID();
      }
      seenLayerIds.add(id);
      return { ...l, id };
    });

    const stageWithIds = {
      ...stage,
      stage: {
        ...stage.stage,
        layers: layersWithIds
      },
      chart: {
        ...stage.chart,
        notes: notesWithIds,
        events: eventsWithIds
      }
    };
    
    historyRef.current = [stageWithIds];
    historyIndexRef.current = 0;
    setCanUndo(false);
    setCanRedo(false);
    setCurrentStage(stageWithIds);
    setShowSavedList(false);
  };

  const loadWeek = (week: SavedWeek) => {
    setCurrentWeek(week);
    setShowSavedList(false);
  };

  const createNewStage = () => {
    const newStage = { ...DEFAULT_SAVED_STAGE, id: 'stage-' + crypto.randomUUID() };
    loadStage(newStage);
  };

  const createNewWeek = () => {
    const newWeek: SavedWeek = {
      id: 'week-' + crypto.randomUUID(),
      name: 'New Week',
      tracks: [],
      thumbnail: '',
      description: '',
      sequence: []
    };
    loadWeek(newWeek);
  };

  const saveCurrentStage = () => {
    if (!currentStage) return;
    const updatedStages = [...savedStages];
    const index = updatedStages.findIndex(s => s.id === currentStage.id);
    if (index >= 0) {
      updatedStages[index] = currentStage;
    } else {
      updatedStages.unshift(currentStage);
    }
    setSavedStages(updatedStages);
    saveToLocalStorage(updatedStages);
    showNotification('Stage saved successfully!');
  };

  const deleteStage = (id: string) => {
    const updatedStages = savedStages.filter(s => s.id !== id);
    setSavedStages(updatedStages);
    saveToLocalStorage(updatedStages);
    setStageToDelete(null);
    showNotification('Stage deleted successfully!');
  };

  const deleteWeek = (id: string) => {
    const updatedWeeks = savedWeeks.filter(w => w.id !== id);
    setSavedWeeks(updatedWeeks);
    saveWeeksToStorage(updatedWeeks);
    setWeekToDelete(null);
    showNotification('Week deleted successfully!');
  };

  const handleCopyStage = (stage: SavedStage) => {
    try {
      const jsonStr = JSON.stringify(stage, null, 2);
      navigator.clipboard.writeText(jsonStr);
      showNotification('Stage copied to clipboard!');
    } catch (error) {
      console.error('Copy error:', error);
      showNotification('Failed to copy stage.', 'error');
    }
  };

  const processPasteStage = (content: string, targetId?: string) => {
    if (!content) return;
    try {
      let decompressed = LZString.decompressFromBase64(content);
      let parsedData;
      try {
        parsedData = JSON.parse(decompressed || content);
      } catch (e) {
        showNotification('Invalid clipboard data.', 'error');
        return;
      }

      if (parsedData.chart || parsedData.layers) {
        const newStage = { ...parsedData as SavedStage };
        if (targetId) {
          const index = savedStages.findIndex(s => s.id === targetId);
          if (index !== -1) {
            const updatedStages = [...savedStages];
            updatedStages[index] = { ...newStage, id: targetId, name: updatedStages[index].name };
            setSavedStages(updatedStages);
            saveToLocalStorage(updatedStages);
            showNotification('Stage data pasted successfully!');
          }
        } else {
          newStage.id = 'stage-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
          newStage.name = (newStage.name || 'New Stage') + ' (Copy)';
          const updatedStages = [newStage, ...savedStages];
          setSavedStages(updatedStages);
          saveToLocalStorage(updatedStages);
          showNotification('Stage pasted as new track!');
        }
        setShowPastePrompt(false);
      } else {
        showNotification('Clipboard does not contain stage data.', 'error');
      }
    } catch (error) {
      console.error('Paste error:', error);
      showNotification('Failed to paste stage.', 'error');
    }
  };

  const handlePasteStage = async (targetId?: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        try {
          const content = await navigator.clipboard.readText();
          if (content) {
            processPasteStage(content, targetId);
            return;
          }
        } catch (e) {}
      }
      setPasteType('STAGE');
      setTargetPasteId(targetId);
      setShowPastePrompt(true);
    } catch (error) {
      setPasteType('STAGE');
      setTargetPasteId(targetId);
      setShowPastePrompt(true);
    }
  };

  const handleCopyWeek = (week: SavedWeek) => {
    try {
      const trackIds = new Set(week.tracks || []);
      (week.sequence || []).forEach(node => {
        if (node.type === 'GAMEPLAY') {
          trackIds.add(node.dataId);
        }
      });
      const tracksInWeek = savedStages.filter(s => trackIds.has(s.id));
      const exportData = {
        week,
        tracks: tracksInWeek
      };
      
      const jsonStr = JSON.stringify(exportData, null, 2);
      navigator.clipboard.writeText(jsonStr);
      showNotification('Week copied to clipboard!');
    } catch (error) {
      console.error('Copy error:', error);
      showNotification('Failed to copy week.', 'error');
    }
  };

  const processPasteWeek = (content: string, targetId?: string) => {
    if (!content) return;
    try {
      let decompressed = LZString.decompressFromBase64(content);
      let parsedData;
      try {
        parsedData = JSON.parse(decompressed || content);
      } catch (e) {
        showNotification('Invalid clipboard data.', 'error');
        return;
      }

      if (parsedData.week && parsedData.tracks) {
        const week = parsedData.week as SavedWeek;
        const tracks = parsedData.tracks as SavedStage[];
        
        const trackIdMap = new Map<string, string>();
        const newStages = [...savedStages];
        
        tracks.forEach(track => {
          const newId = 'stage-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
          trackIdMap.set(track.id, newId);
          newStages.push({ ...track, id: newId });
        });
        
        const newSequence = (week.sequence || []).map(node => {
          if (node.type === 'GAMEPLAY' && trackIdMap.has(node.dataId)) {
            return { ...node, id: crypto.randomUUID(), dataId: trackIdMap.get(node.dataId)! };
          }
          return { ...node, id: crypto.randomUUID() };
        });

        if (targetId) {
          const index = savedWeeks.findIndex(w => w.id === targetId);
          if (index !== -1) {
            const updatedWeeks = [...savedWeeks];
            updatedWeeks[index] = { 
              ...week, 
              id: targetId, 
              name: updatedWeeks[index].name,
              tracks: Array.from(trackIdMap.values()),
              sequence: newSequence
            };
            setSavedStages(newStages);
            saveToLocalStorage(newStages);
            setSavedWeeks(updatedWeeks);
            saveWeeksToStorage(updatedWeeks);
            showNotification('Week data pasted successfully!');
          }
        } else {
          const newWeek: SavedWeek = {
            ...week,
            id: 'week-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
            name: week.name + ' (Copy)',
            tracks: Array.from(trackIdMap.values()),
            sequence: newSequence
          };
          const updatedWeeks = [newWeek, ...savedWeeks];
          setSavedStages(newStages);
          saveToLocalStorage(newStages);
          setSavedWeeks(updatedWeeks);
          saveWeeksToStorage(updatedWeeks);
          showNotification('Week pasted as new week!');
        }
        setShowPastePrompt(false);
      } else {
        showNotification('Clipboard does not contain week data.', 'error');
      }
    } catch (error) {
      console.error('Paste error:', error);
      showNotification('Failed to paste week.', 'error');
    }
  };

  const handlePasteWeek = async (targetId?: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        try {
          const content = await navigator.clipboard.readText();
          if (content) {
            processPasteWeek(content, targetId);
            return;
          }
        } catch (e) {}
      }
      setPasteType('WEEK');
      setTargetPasteId(targetId);
      setShowPastePrompt(true);
    } catch (error) {
      setPasteType('WEEK');
      setTargetPasteId(targetId);
      setShowPastePrompt(true);
    }
  };

  const exportStage = (stage: SavedStage) => {
    showNotification('Preparing export...');
    
    // Use setTimeout to allow the notification to show before blocking the UI
    setTimeout(() => {
      try {
        const jsonStr = JSON.stringify(stage, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", url);
        downloadAnchorNode.setAttribute("download", stage.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() + ".json");
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
        URL.revokeObjectURL(url);
        
        showNotification('Stage exported successfully!');
      } catch (error) {
        console.error('Export error:', error);
        showNotification('Failed to export stage.', 'error');
      }
    }, 100);
  };

  const exportWeek = (week: SavedWeek) => {
    showNotification('Preparing week data...');
    
    // Use setTimeout to allow the notification to show before blocking the UI
    setTimeout(() => {
      try {
        const trackIds = new Set(week.tracks || []);
        (week.sequence || []).forEach(node => {
          if (node.type === 'GAMEPLAY') {
            trackIds.add(node.dataId);
          }
        });
        const tracksInWeek = savedStages.filter(s => trackIds.has(s.id));
        const exportData = {
          week,
          tracks: tracksInWeek
        };
        
        const jsonStr = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", url);
        downloadAnchorNode.setAttribute("download", week.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() + "_week.json");
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
        URL.revokeObjectURL(url);
        
        showNotification('Week exported successfully!');
      } catch (error) {
        console.error('Export error:', error);
        showNotification('Failed to export week.', 'error');
      }
    }, 100);
  };

  const importStage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        let content = e.target?.result as string;
        
        // Check if it's compressed (doesn't start with {)
        if (content.trim() && !content.trim().startsWith('{')) {
          const decompressed = LZString.decompressFromBase64(content);
          if (decompressed) {
            content = decompressed;
          }
        }
        
        const parsedData = JSON.parse(content);
        
        if (parsedData.week && parsedData.tracks) {
          // It's a week
          const week = parsedData.week as SavedWeek;
          const tracks = parsedData.tracks as SavedStage[];
          
          const trackIdMap = new Map<string, string>();
          const newStages = [...savedStages];
          
          tracks.forEach(track => {
            const newId = 'stage-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            trackIdMap.set(track.id, newId);
            newStages.push({ ...track, id: newId });
          });
          
          // Update sequence to point to new track IDs
          const newSequence = (week.sequence || []).map(node => {
            if (node.type === 'GAMEPLAY' && trackIdMap.has(node.dataId)) {
              return { ...node, id: crypto.randomUUID(), dataId: trackIdMap.get(node.dataId)! };
            }
            return { ...node, id: crypto.randomUUID() };
          });

          const newWeek: SavedWeek = {
            ...week,
            id: 'week-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
            tracks: Array.from(trackIdMap.values()),
            sequence: newSequence
          };
          
          const newWeeks = [newWeek, ...savedWeeks];
          
          setSavedStages(newStages);
          saveToLocalStorage(newStages);
          setSavedWeeks(newWeeks);
          saveWeeksToStorage(newWeeks);
          
          showNotification('Week imported successfully!');
        } else {
          // It's a stage
          const parsedStage = parsedData as SavedStage;
          
          // Ensure it has a unique ID
          parsedStage.id = 'stage-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
          
          const updatedStages = [parsedStage, ...savedStages];
          setSavedStages(updatedStages);
          saveToLocalStorage(updatedStages);
          showNotification('Stage imported successfully!');
        }
      } catch (error) {
        console.error('Error importing:', error);
        showNotification('Failed to import. Invalid file format.', 'error');
      }
    };
    reader.readAsText(file);
    // Reset input
    event.target.value = '';
  };

  if (showSavedList) {
    const selectedStage = savedStages.find(s => s.id === selectedStageId) || savedStages[0];

    return (
      <>
        <div className="fixed inset-0 bg-gradient-to-br from-zinc-950 via-black to-zinc-900 text-white flex flex-col overflow-hidden font-sans">
        {/* Modals */}
        <AnimatePresence>
          {showPastePrompt && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-8 bg-black/80 backdrop-blur-sm">
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="bg-zinc-900 border border-white/10 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl"
              >
                <div className="p-6 border-b border-white/5 flex items-center justify-between">
                  <h3 className="text-sm font-black uppercase tracking-widest text-white">
                    Paste {pasteType === 'STAGE' ? 'Track' : 'Week'} Data
                  </h3>
                  <button onClick={() => setShowPastePrompt(false)} className="text-zinc-500 hover:text-white transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="p-6 flex flex-col gap-4">
                  <p className="text-xs text-zinc-400 font-bold uppercase tracking-widest leading-relaxed">
                    Clipboard access is restricted in the preview. Please paste the data below to continue.
                  </p>
                  <textarea 
                    autoFocus
                    placeholder="Paste data here..."
                    className="w-full h-40 bg-zinc-950 border border-white/10 rounded-2xl p-4 text-xs font-mono text-zinc-300 focus:outline-none focus:border-white/20 transition-all custom-scrollbar"
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val) {
                        if (pasteType === 'STAGE') {
                          processPasteStage(val, targetPasteId);
                        } else {
                          processPasteWeek(val, targetPasteId);
                        }
                      }
                    }}
                  />
                  <div className="flex justify-end">
                    <button 
                      onClick={() => setShowPastePrompt(false)}
                      className="px-6 py-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-zinc-400 hover:text-white font-black text-[10px] uppercase tracking-widest transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Breadcrumb & Top Actions */}
        <div className="px-8 py-6 flex items-center justify-between z-20">
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="p-2 hover:bg-zinc-800/50 rounded-xl transition-all text-zinc-500 hover:text-white">
              <ChevronLeft className="w-6 h-6" />
            </button>
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
              <span>Stage Editor</span>
              <ChevronRight className="w-3 h-3 opacity-30" />
              <span className="text-white">Track List</span>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 px-5 py-2.5 bg-zinc-900/50 hover:bg-zinc-800/50 border border-zinc-800/50 rounded-xl font-bold transition-all cursor-pointer active:scale-95 text-xs uppercase tracking-widest text-zinc-400 hover:text-white">
              <Upload className="w-4 h-4" />
              <span>Import</span>
              <input type="file" accept=".json" onChange={importStage} className="hidden" />
            </label>
            <button 
              onClick={listTab === 'TRACKS' ? createNewStage : createNewWeek}
              className="flex items-center gap-2 px-6 py-2.5 bg-white text-black hover:bg-zinc-200 rounded-xl font-black transition-all active:scale-95 uppercase tracking-widest text-xs shadow-xl shadow-white/5"
            >
              <Plus className="w-4 h-4" />
              {listTab === 'TRACKS' ? 'New Track' : 'New Week'}
            </button>
          </div>
        </div>

        {quotaExceeded && (
          <div className="mx-8 mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-4 text-red-400 animate-pulse">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p className="text-[10px] font-black uppercase tracking-widest">Firestore Quota Exceeded - Upload Disabled</p>
          </div>
        )}

        <div className="flex-1 flex px-8 pb-8 gap-8 overflow-hidden">
          {/* Left: Track List / Week List */}
          <div className="w-[380px] flex flex-col gap-4 overflow-hidden">
            <div className="flex flex-col gap-3 px-2">
              <div className="flex items-center gap-4 border-b border-zinc-800/50 pb-2">
                <button 
                  onClick={() => setListTab('TRACKS')}
                  className={`text-xs font-black uppercase tracking-[0.2em] transition-colors ${listTab === 'TRACKS' ? 'text-white' : 'text-zinc-600 hover:text-zinc-400'}`}
                >
                  Track List
                </button>
                <button 
                  onClick={() => setListTab('WEEKS')}
                  className={`text-xs font-black uppercase tracking-[0.2em] transition-colors ${listTab === 'WEEKS' ? 'text-white' : 'text-zinc-600 hover:text-zinc-400'}`}
                >
                  Week List
                </button>
                <div className="flex-1" />
                <span className="text-[10px] font-bold text-zinc-600">
                  {listTab === 'TRACKS' ? `${savedStages.length} Tracks` : `${savedWeeks.length} Weeks`}
                </span>
              </div>
              
              {/* Search Bar */}
              <div className="relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 group-focus-within:text-white transition-colors" />
                <input 
                  type="text" 
                  placeholder={listTab === 'TRACKS' ? "SEARCH TRACKS..." : "SEARCH WEEKS..."}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl py-2.5 pl-10 pr-4 text-[10px] font-black tracking-widest uppercase focus:outline-none focus:border-zinc-600 focus:bg-zinc-900 transition-all"
                />
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-3">
              {listTab === 'TRACKS' ? (
                savedStages.filter(s => s.name.toLowerCase().includes(searchTerm.toLowerCase())).length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-700 border-2 border-dashed border-zinc-900 rounded-[2rem]">
                    <Music className="w-12 h-12 mb-4 opacity-20" />
                    <p className="text-[10px] font-black uppercase tracking-widest">No tracks found</p>
                  </div>
                ) : (
                  savedStages
                    .filter(s => s.name.toLowerCase().includes(searchTerm.toLowerCase()))
                    .map((stage, idx) => (
                    <div 
                      key={stage.id}
                      onClick={() => setSelectedStageId(stage.id)}
                      className={`group relative flex items-center gap-4 p-4 rounded-2xl border transition-all duration-300 cursor-pointer ${
                        selectedStageId === stage.id 
                          ? 'bg-zinc-900/80 border-zinc-600 shadow-2xl shadow-black/50 scale-[1.02] z-10' 
                          : 'bg-zinc-900/20 border-zinc-800/30 hover:border-zinc-700/50 hover:bg-zinc-900/40'
                      }`}
                    >
                      {/* Portrait with Play Button */}
                      <div className="relative shrink-0 group/thumb">
                        <div 
                          onClick={(e) => { e.stopPropagation(); onPlaytest(stage, 1); }}
                          className={`w-14 h-14 rounded-full overflow-hidden border-2 transition-all duration-500 cursor-pointer hover:scale-110 ${
                          selectedStageId === stage.id ? 'border-white ring-4 ring-white/10 scale-110' : 'border-zinc-800 group-hover:border-zinc-700'
                        }`}>
                          <img 
                            src={stage.characterOpponent.healthIcons?.normal || stage.characterOpponent.image} 
                            alt={stage.name} 
                            className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700"
                            referrerPolicy="no-referrer"
                          />
                          {/* Play Overlay */}
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center transition-opacity duration-300">
                            <Play className="w-6 h-6 text-white fill-white" />
                          </div>
                        </div>
                        {selectedStageId === stage.id && (
                          <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-white rounded-full flex items-center justify-center shadow-lg animate-pulse pointer-events-none">
                            <Play className="w-2.5 h-2.5 text-black fill-current" />
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2 mb-1">
                          <h3 className={`text-sm font-black uppercase tracking-tight truncate transition-colors ${
                            selectedStageId === stage.id ? 'text-white' : 'text-zinc-400 group-hover:text-zinc-200'
                          }`}>{stage.name}</h3>
                          <div className="flex items-center gap-2">
                            <button 
                              onClick={(e) => { e.stopPropagation(); onPlaytest(stage, 1); }}
                              className="text-[9px] font-black uppercase tracking-widest text-emerald-400 hover:text-emerald-300 transition-colors shrink-0 flex items-center gap-1 group/play"
                            >
                              <Play className="w-2.5 h-2.5 group-hover/play:scale-110 transition-transform" />
                              <span>Play</span>
                            </button>
                            <button 
                              onClick={(e) => { e.stopPropagation(); loadStage(stage); }}
                              className="text-[9px] font-black uppercase tracking-widest text-cyan-400 hover:text-cyan-300 transition-colors shrink-0 flex items-center gap-1 group/edit"
                            >
                              <Edit3 className="w-2.5 h-2.5 group-hover/edit:scale-110 transition-transform" />
                              <span>Edit</span>
                            </button>
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleCopyStage(stage); }}
                              className="text-[9px] font-black uppercase tracking-widest text-emerald-400 hover:text-emerald-300 transition-colors shrink-0 flex items-center gap-1 group/copy"
                              title="Copy Data"
                            >
                              <Copy className="w-2.5 h-2.5 group-hover/copy:scale-110 transition-transform" />
                              <span>Copy</span>
                            </button>
                            <button 
                              onClick={(e) => { e.stopPropagation(); handlePasteStage(stage.id); }}
                              className="text-[9px] font-black uppercase tracking-widest text-purple-400 hover:text-purple-300 transition-colors shrink-0 flex items-center gap-1 group/paste"
                              title="Paste Data (Overwrite)"
                            >
                              <ClipboardPaste className="w-2.5 h-2.5 group-hover/paste:scale-110 transition-transform" />
                              <span>Paste</span>
                            </button>
                          </div>
                        </div>
                        
                        {/* 5 Icons */}
                        <div className="flex items-center gap-2 mt-2">
                          <button 
                            onClick={(e) => { e.stopPropagation(); setStageToRename({ id: stage.id, name: stage.name }); }}
                            className="p-1.5 rounded-lg border border-yellow-400/20 text-yellow-400 hover:bg-yellow-400/10 transition-all hover:shadow-[0_0_12px_rgba(250,204,21,0.3)] active:scale-90"
                            title="Rename Track"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              if (!isConfigValid) {
                                alert("Upload is disabled because Firebase is not configured. Please set up Firebase in the AI Studio settings to enable online features.");
                                return;
                              }
                              setShowUploadModal(stage); 
                            }}
                            disabled={isUploading === stage.id || quotaExceeded}
                            className="p-1.5 rounded-lg border border-purple-400/20 text-purple-400 hover:bg-purple-400/10 disabled:opacity-20 transition-all hover:shadow-[0_0_12px_rgba(192,132,252,0.3)] active:scale-90"
                            title="Upload Chart"
                          >
                            {isUploading === stage.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                          </button>
                          <button 
                            onClick={(e) => { e.stopPropagation(); exportStage(stage); }}
                            className="p-1.5 rounded-lg border border-emerald-600/20 text-emerald-600 hover:bg-emerald-600/10 transition-all hover:shadow-[0_0_12px_rgba(5,150,105,0.3)] active:scale-90"
                            title="Download Chart"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={(e) => { e.stopPropagation(); moveStage(stage.id, 'up'); }}
                            className="p-1.5 rounded-lg border border-zinc-600/20 text-zinc-400 hover:bg-zinc-600/10 transition-all hover:shadow-[0_0_12px_rgba(161,161,170,0.3)] active:scale-90"
                            title="Move Up"
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={(e) => { e.stopPropagation(); moveStage(stage.id, 'down'); }}
                            className="p-1.5 rounded-lg border border-zinc-600/20 text-zinc-400 hover:bg-zinc-600/10 transition-all hover:shadow-[0_0_12px_rgba(161,161,170,0.3)] active:scale-90"
                            title="Move Down"
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={(e) => { e.stopPropagation(); setStageToDelete(stage.id); }}
                            className="p-1.5 rounded-lg border border-red-400/20 text-red-400 hover:bg-red-400/10 transition-all hover:shadow-[0_0_12px_rgba(248,113,113,0.3)] active:scale-90"
                            title="Delete Track"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )
              ) : (
                savedWeeks.filter(w => w.name.toLowerCase().includes(searchTerm.toLowerCase())).length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-700 border-2 border-dashed border-zinc-900 rounded-[2rem]">
                    <ListMusic className="w-12 h-12 mb-4 opacity-20" />
                    <p className="text-[10px] font-black uppercase tracking-widest">No weeks found</p>
                  </div>
                ) : (
                  savedWeeks
                    .filter(w => w.name.toLowerCase().includes(searchTerm.toLowerCase()))
                    .map((week, idx) => (
                    <div 
                      key={week.id}
                      onClick={() => setSelectedWeekId(week.id)}
                      className={`group relative flex items-center gap-4 p-4 rounded-2xl border transition-all duration-300 cursor-pointer ${
                        selectedWeekId === week.id 
                          ? 'bg-zinc-900/80 border-zinc-600 shadow-2xl shadow-black/50 scale-[1.02] z-10' 
                          : 'bg-zinc-900/20 border-zinc-800/30 hover:border-zinc-700/50 hover:bg-zinc-900/40'
                      }`}
                    >
                      {/* Thumbnail with Play Button */}
                      <div className="relative shrink-0 group/thumb">
                        <div 
                          onClick={(e) => { e.stopPropagation(); onPlaytestWeek(week, savedStages); }}
                          className={`w-14 h-14 rounded-xl overflow-hidden border-2 transition-all duration-500 cursor-pointer hover:scale-110 ${
                          selectedWeekId === week.id ? 'border-white ring-4 ring-white/10 scale-110' : 'border-zinc-800 group-hover:border-zinc-700'
                        }`}>
                          <img 
                            src={week.thumbnail || `https://picsum.photos/seed/${week.id}/400/225`} 
                            alt={week.name} 
                            className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700"
                            referrerPolicy="no-referrer"
                          />
                          {/* Play Overlay */}
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center transition-opacity duration-300">
                            <Play className="w-6 h-6 text-white fill-white" />
                          </div>
                        </div>
                        {selectedWeekId === week.id && (
                          <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-white rounded-full flex items-center justify-center shadow-lg animate-pulse pointer-events-none">
                            <Play className="w-2.5 h-2.5 text-black fill-current" />
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2 mb-1">
                          <h3 className={`text-sm font-black uppercase tracking-tight truncate transition-colors ${
                            selectedWeekId === week.id ? 'text-white' : 'text-zinc-400 group-hover:text-zinc-200'
                          }`}>{week.name}</h3>
                          <div className="flex items-center gap-2">
                            <button 
                              onClick={(e) => { e.stopPropagation(); onPlaytestWeek(week, savedStages); }}
                              className="text-[9px] font-black uppercase tracking-widest text-emerald-400 hover:text-emerald-300 transition-colors shrink-0 flex items-center gap-1 group/play"
                            >
                              <Play className="w-2.5 h-2.5 group-hover/play:scale-110 transition-transform" />
                              <span>Play</span>
                            </button>
                            <button 
                              onClick={(e) => { e.stopPropagation(); loadWeek(week); }}
                              className="text-[9px] font-black uppercase tracking-widest text-cyan-400 hover:text-cyan-300 transition-colors shrink-0 flex items-center gap-1 group/edit"
                            >
                              <Edit3 className="w-2.5 h-2.5 group-hover/edit:scale-110 transition-transform" />
                              <span>Edit</span>
                            </button>
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleCopyWeek(week); }}
                              className="text-[9px] font-black uppercase tracking-widest text-emerald-400 hover:text-emerald-300 transition-colors shrink-0 flex items-center gap-1 group/copy"
                              title="Copy Data"
                            >
                              <Copy className="w-2.5 h-2.5 group-hover/copy:scale-110 transition-transform" />
                              <span>Copy</span>
                            </button>
                            <button 
                              onClick={(e) => { e.stopPropagation(); handlePasteWeek(week.id); }}
                              className="text-[9px] font-black uppercase tracking-widest text-purple-400 hover:text-purple-300 transition-colors shrink-0 flex items-center gap-1 group/paste"
                              title="Paste Data (Overwrite)"
                            >
                              <ClipboardPaste className="w-2.5 h-2.5 group-hover/paste:scale-110 transition-transform" />
                              <span>Paste</span>
                            </button>
                          </div>
                        </div>
                        
                        <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-2">
                          {(() => {
                            const trackIds = new Set(week.tracks || []);
                            (week.sequence || []).forEach(node => {
                              if (node.type === 'GAMEPLAY') {
                                trackIds.add(node.dataId);
                              }
                            });
                            return trackIds.size;
                          })()} Tracks
                        </div>

                        {/* Icons */}
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={(e) => { e.stopPropagation(); setWeekToRename({ id: week.id, name: week.name }); }}
                            className="p-1.5 rounded-lg border border-yellow-400/20 text-yellow-400 hover:bg-yellow-400/10 transition-all hover:shadow-[0_0_12px_rgba(250,204,21,0.3)] active:scale-90"
                            title="Rename Week"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={(e) => { e.stopPropagation(); exportWeek(week); }}
                            className="p-1.5 rounded-lg border border-emerald-600/20 text-emerald-600 hover:bg-emerald-600/10 transition-all hover:shadow-[0_0_12px_rgba(5,150,105,0.3)] active:scale-90"
                            title="Download Week"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={(e) => { e.stopPropagation(); moveWeek(week.id, 'up'); }}
                            className="p-1.5 rounded-lg border border-zinc-600/20 text-zinc-400 hover:bg-zinc-600/10 transition-all hover:shadow-[0_0_12px_rgba(161,161,170,0.3)] active:scale-90"
                            title="Move Up"
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={(e) => { e.stopPropagation(); moveWeek(week.id, 'down'); }}
                            className="p-1.5 rounded-lg border border-zinc-600/20 text-zinc-400 hover:bg-zinc-600/10 transition-all hover:shadow-[0_0_12px_rgba(161,161,170,0.3)] active:scale-90"
                            title="Move Down"
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={(e) => { e.stopPropagation(); setWeekToDelete(week.id); }}
                            className="p-1.5 rounded-lg border border-red-400/20 text-red-400 hover:bg-red-400/10 transition-all hover:shadow-[0_0_12px_rgba(248,113,113,0.3)] active:scale-90"
                            title="Delete Week"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )
              )}
            </div>
          </div>

          {/* Right: Stage Preview */}
          <div className="flex-1 relative rounded-[3rem] overflow-hidden bg-black border border-zinc-800 shadow-2xl group/preview">
            {selectedStage ? (
              <>
                {/* Background */}
                <div className="absolute inset-0 z-0">
                  {selectedStage.stage.layers.find(l => l.id === 'bg') && (
                    <img 
                      src={selectedStage.stage.layers.find(l => l.id === 'bg')?.image} 
                      alt="Background" 
                      className="w-full h-full object-cover opacity-40 blur-[4px] scale-110 group-hover/preview:scale-100 transition-transform duration-[2000ms] ease-out"
                      referrerPolicy="no-referrer"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
                  
                  {/* Scientific Grid Overlay */}
                  <div className="absolute inset-0 z-5 opacity-[0.05] pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '48px 48px' }} />
                  <div className="absolute inset-0 z-5 opacity-[0.02] pointer-events-none" style={{ backgroundImage: 'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)', backgroundSize: '192px 192px' }} />
                </div>

                {/* Characters */}
                <div className="absolute inset-0 flex items-end justify-center gap-40 pb-32 z-10">
                  {/* Opponent */}
                  <div className="relative flex flex-col items-center animate-float-slow">
                    <div className="w-56 h-56 relative group/char">
                      <img 
                        src={selectedStage.characterOpponent.animations.find(a => a.name === 'idle')?.image || selectedStage.characterOpponent.image} 
                        alt="Opponent" 
                        className="w-full h-full object-contain drop-shadow-[0_0_40px_rgba(239,68,68,0.2)] group-hover/char:drop-shadow-[0_0_60px_rgba(239,68,68,0.4)] transition-all duration-500"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    <div className="mt-6 px-5 py-1.5 bg-red-500/5 border border-red-500/20 rounded-full text-[9px] font-black uppercase tracking-[0.2em] text-red-500 backdrop-blur-xl shadow-lg shadow-red-500/5">Opponent</div>
                  </div>

                  {/* Player */}
                  <div className="relative flex flex-col items-center animate-float">
                    <div className="w-56 h-56 relative group/char">
                      <img 
                        src={selectedStage.characterPlayer.animations.find(a => a.name === 'idle')?.image || selectedStage.characterPlayer.image} 
                        alt="Player" 
                        className="w-full h-full object-contain drop-shadow-[0_0_40px_rgba(6,182,212,0.2)] group-hover/char:drop-shadow-[0_0_60px_rgba(6,182,212,0.4)] transition-all duration-500"
                        referrerPolicy="no-referrer"
                        style={{ transform: 'scaleX(-1)' }}
                      />
                    </div>
                    <div className="mt-6 px-5 py-1.5 bg-cyan-500/5 border border-cyan-500/20 rounded-full text-[9px] font-black uppercase tracking-[0.2em] text-cyan-500 backdrop-blur-xl shadow-lg shadow-cyan-500/5">Player</div>
                  </div>
                </div>

                {/* Breadcrumb Navigation (Internal) */}
                <div className="absolute top-10 left-10 z-20 flex items-center gap-3 text-[9px] font-black uppercase tracking-[0.3em] text-zinc-500 bg-black/60 backdrop-blur-2xl px-6 py-3 rounded-2xl border border-white/10 shadow-2xl">
                  <Layout className="w-3.5 h-3.5 text-white" />
                  <span className="text-zinc-400">Preview</span>
                  <ChevronRight className="w-3 h-3 opacity-30" />
                  <span className="text-white">Active Stage</span>
                </div>

                {/* Chart Info (Slim Horizontal Bar) */}
                <div className="absolute top-10 right-10 z-30 flex items-center gap-6 bg-black/60 backdrop-blur-2xl px-8 py-4 rounded-2xl border border-white/10 shadow-2xl">
                  <div className="flex items-center gap-3 border-r border-white/10 pr-6">
                    <span className="text-[8px] font-black uppercase tracking-widest text-zinc-500">Track</span>
                    <span className="text-xs font-black uppercase tracking-tight truncate max-w-[120px] text-white">{selectedStage.name}</span>
                  </div>
                  <div className="flex items-center gap-3 border-r border-white/10 pr-6">
                    <span className="text-[8px] font-black uppercase tracking-widest text-zinc-500">Notes</span>
                    <span className="text-xs font-bold text-white font-mono">{selectedStage.chart?.notes?.length || 0}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[8px] font-black uppercase tracking-widest text-zinc-500">BPM</span>
                    <span className="text-xs font-bold text-white font-mono">{selectedStage.chart?.bpm || 0}</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-700">
                <Layout className="w-16 h-16 mb-4 opacity-10" />
                <p className="text-[10px] font-black uppercase tracking-widest opacity-40">Select a track to preview</p>
              </div>
            )}
          </div>
        </div>

        {/* Modals & Notifications */}
        <AnimatePresence>
          {notification && (
            <motion.div
              initial={{ opacity: 0, y: 50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.9 }}
              className={`fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl font-bold shadow-2xl z-[100] flex items-center gap-3 border ${
                notification.type === 'success' 
                  ? 'bg-zinc-900 text-green-400 border-green-500/30' 
                  : 'bg-zinc-900 text-red-400 border-red-500/30'
              }`}
            >
              {notification.type === 'success' ? <Zap className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
              {notification.message}
            </motion.div>
          )}

          {stageToDelete && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 max-w-md w-full shadow-2xl"
              >
                <h2 className="text-2xl font-black uppercase tracking-tight mb-4">Delete Stage?</h2>
                <p className="text-zinc-400 mb-8">
                  Are you sure you want to delete this stage? This action cannot be undone.
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => setStageToDelete(null)}
                    className="flex-1 py-4 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-bold transition-colors"
                  >
                    CANCEL
                  </button>
                  <button
                    onClick={() => deleteStage(stageToDelete)}
                    className="flex-1 py-4 bg-red-600 hover:bg-red-500 rounded-xl font-bold transition-colors shadow-lg shadow-red-600/20"
                  >
                    DELETE
                  </button>
                </div>
              </motion.div>
            </div>
          )}

          {weekToDelete && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 max-w-md w-full shadow-2xl"
              >
                <h2 className="text-2xl font-black uppercase tracking-tight mb-4">Delete Week?</h2>
                <p className="text-zinc-400 mb-8">
                  Are you sure you want to delete this week? This action cannot be undone.
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => setWeekToDelete(null)}
                    className="flex-1 py-4 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-bold transition-colors"
                  >
                    CANCEL
                  </button>
                  <button
                    onClick={() => deleteWeek(weekToDelete)}
                    className="flex-1 py-4 bg-red-600 hover:bg-red-500 rounded-xl font-bold transition-colors shadow-lg shadow-red-600/20"
                  >
                    DELETE
                  </button>
                </div>
              </motion.div>
            </div>
          )}

          {weekToRename && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 max-w-md w-full shadow-2xl"
              >
                <h2 className="text-2xl font-black uppercase tracking-tight mb-4">Rename Week</h2>
                <div className="space-y-4 mb-8">
                  <label className="text-xs font-black text-zinc-500 uppercase">New Name</label>
                  <input
                    autoFocus
                    type="text"
                    value={weekToRename.name}
                    onChange={(e) => setWeekToRename({ ...weekToRename, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const updatedWeeks = savedWeeks.map(w => 
                          w.id === weekToRename.id ? { ...w, name: weekToRename.name } : w
                        );
                        setSavedWeeks(updatedWeeks);
                        saveWeeksToStorage(updatedWeeks);
                        setWeekToRename(null);
                        showNotification('Week renamed successfully!');
                      }
                    }}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 focus:ring-2 focus:ring-pink-500 outline-none transition-all"
                  />
                </div>
                <div className="flex gap-4">
                  <button
                    onClick={() => setWeekToRename(null)}
                    className="flex-1 py-4 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-bold transition-colors"
                  >
                    CANCEL
                  </button>
                  <button
                    onClick={() => {
                      const updatedWeeks = savedWeeks.map(w => 
                        w.id === weekToRename.id ? { ...w, name: weekToRename.name } : w
                      );
                      setSavedWeeks(updatedWeeks);
                      saveWeeksToStorage(updatedWeeks);
                      setWeekToRename(null);
                      showNotification('Week renamed successfully!');
                    }}
                    className="flex-1 py-4 bg-pink-600 hover:bg-pink-500 rounded-xl font-bold transition-colors shadow-lg shadow-pink-600/20"
                  >
                    SAVE
                  </button>
                </div>
              </motion.div>
            </div>
          )}

          {stageToRename && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 max-w-md w-full shadow-2xl"
              >
                <h2 className="text-2xl font-black uppercase tracking-tight mb-4">Rename Stage</h2>
                <div className="space-y-4 mb-8">
                  <label className="text-xs font-black text-zinc-500 uppercase">New Name</label>
                  <input
                    autoFocus
                    type="text"
                    value={stageToRename.name}
                    onChange={(e) => setStageToRename({ ...stageToRename, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const updatedStages = savedStages.map(s => 
                          s.id === stageToRename.id ? { ...s, name: stageToRename.name, stage: { ...s.stage, name: stageToRename.name } } : s
                        );
                        setSavedStages(updatedStages);
                        saveToLocalStorage(updatedStages);
                        setStageToRename(null);
                        showNotification('Stage renamed successfully!');
                      }
                    }}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 focus:ring-2 focus:ring-cyan-500 outline-none transition-all"
                  />
                </div>
                <div className="flex gap-4">
                  <button
                    onClick={() => setStageToRename(null)}
                    className="flex-1 py-4 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-bold transition-colors"
                  >
                    CANCEL
                  </button>
                  <button
                    onClick={() => {
                      const updatedStages = savedStages.map(s => 
                        s.id === stageToRename.id ? { ...s, name: stageToRename.name, stage: { ...s.stage, name: stageToRename.name } } : s
                      );
                      setSavedStages(updatedStages);
                      saveToLocalStorage(updatedStages);
                      setStageToRename(null);
                      showNotification('Stage renamed successfully!');
                    }}
                    className="flex-1 py-4 bg-cyan-600 hover:bg-cyan-500 rounded-xl font-bold transition-colors shadow-lg shadow-cyan-600/20"
                  >
                    SAVE
                  </button>
                </div>
              </motion.div>
            </div>
          )}

          {showUploadModal && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl"
              >
                <div className="p-8 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/50">
                  <div>
                    <h2 className="text-2xl font-black italic uppercase tracking-tight text-white">Upload to Online Hub</h2>
                    <p className="text-zinc-500 text-sm font-medium">Share "{showUploadModal.name}" with the community</p>
                  </div>
                  <button 
                    onClick={() => setShowUploadModal(null)}
                    className="p-2 hover:bg-zinc-800 rounded-xl transition-colors text-zinc-400"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>

                <div className="p-8 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
                  {/* Description */}
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                      <Type className="w-3 h-3" />
                      Level Description
                    </label>
                    <textarea 
                      value={levelDescription}
                      onChange={(e) => setLevelDescription(e.target.value)}
                      placeholder="Tell players about your level..."
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-4 text-sm text-white focus:outline-none focus:border-pink-500/50 transition-colors h-32 resize-none"
                    />
                  </div>

                  {/* Thumbnail */}
                  <div className="space-y-4">
                    <label className="text-xs font-black uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                      <ImageIcon className="w-3 h-3" />
                      Level Thumbnail
                    </label>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-4">
                        <div className="flex gap-2">
                          <input 
                            type="text"
                            value={thumbnailPrompt}
                            onChange={(e) => setThumbnailPrompt(e.target.value)}
                            placeholder="AI Prompt (e.g. Neon city at night)"
                            className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-pink-500/50 transition-colors"
                          />
                          <button 
                            onClick={generateAIThumbnail}
                            disabled={isGeneratingThumbnail}
                            className="px-4 py-2 bg-pink-600 hover:bg-pink-500 disabled:bg-zinc-800 disabled:text-zinc-600 rounded-xl font-bold text-xs transition-all flex items-center gap-2"
                          >
                            {isGeneratingThumbnail ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                            GENERATE
                          </button>
                        </div>

                        <div className="relative group">
                          <input 
                            type="file"
                            id="thumbnail-upload"
                            accept="image/*"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                const reader = new FileReader();
                                reader.onloadend = async () => {
                                  const base64 = reader.result as string;
                                  const resized = await resizeImage(base64);
                                  setCustomThumbnail(resized);
                                };
                                reader.readAsDataURL(file);
                              }
                            }}
                            className="hidden"
                          />
                          <label 
                            htmlFor="thumbnail-upload"
                            className="flex items-center justify-center gap-2 w-full py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl cursor-pointer transition-all border border-dashed border-zinc-700 hover:border-zinc-500"
                          >
                            <Camera className="w-4 h-4" />
                            <span className="text-sm font-bold">UPLOAD IMAGE</span>
                          </label>
                        </div>
                      </div>

                      <div className="aspect-video bg-zinc-950 rounded-2xl border border-zinc-800 overflow-hidden relative group">
                        {customThumbnail || showUploadModal.thumbnail ? (
                          <img 
                            src={customThumbnail || showUploadModal.thumbnail} 
                            alt="Thumbnail Preview" 
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-zinc-700">
                            <ImageIcon className="w-8 h-8 mb-2" />
                            <span className="text-[10px] font-black uppercase tracking-widest">Preview</span>
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <span className="text-[10px] font-black uppercase tracking-widest text-white">Current Thumbnail</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  {isUploading === showUploadModal.id && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-zinc-500">
                        <span>
                          {uploadProgress < 10 ? 'Preparing...' : 
                           uploadProgress < 20 ? 'Compressing...' : 
                           uploadProgress < 40 ? 'Initializing...' : 
                           uploadProgress < 95 ? `Uploading Chunks (${Math.round(uploadProgress)}%)...` : 
                           'Finalizing...'}
                        </span>
                        <span>{Math.round(uploadProgress)}%</span>
                      </div>
                      <div className="h-2 bg-zinc-950 rounded-full overflow-hidden border border-zinc-800">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${uploadProgress}%` }}
                          className="h-full bg-gradient-to-r from-pink-600 to-purple-600"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-8 bg-zinc-950/50 border-t border-zinc-800 flex gap-4">
                  <button 
                    onClick={() => setShowUploadModal(null)}
                    className="flex-1 py-4 bg-zinc-800 hover:bg-zinc-700 rounded-2xl font-black uppercase tracking-widest transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={() => {
                      if (!isConfigValid) {
                        alert("Upload is disabled because Firebase is not configured. Please set up Firebase in the AI Studio settings to enable online features.");
                        return;
                      }
                      uploadStage(showUploadModal);
                    }}
                    disabled={isUploading === showUploadModal.id || quotaExceeded}
                    className="flex-[2] py-4 bg-pink-600 hover:bg-pink-500 disabled:bg-zinc-800 disabled:text-zinc-600 rounded-2xl font-black uppercase tracking-widest transition-all shadow-lg shadow-pink-600/20 flex items-center justify-center gap-3"
                  >
                    {isUploading === showUploadModal.id ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        UPLOADING...
                      </>
                    ) : quotaExceeded ? (
                      <>
                        <AlertCircle className="w-5 h-5" />
                        QUOTA EXCEEDED
                      </>
                    ) : (
                      <>
                        <Upload className="w-5 h-5" />
                        CONFIRM UPLOAD
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Global AI Parsing Progress */}
        {renderAIParsingProgress()}
        </div>
      </>
    );
  }

  if (currentWeek) {
    return (
      <>
        <WeekEditor 
          week={currentWeek} 
          setWeek={setCurrentWeek} 
          savedStages={savedStages} 
          onSave={saveCurrentWeek}
          onBack={() => {
            setCurrentWeek(null);
            setShowSavedList(true);
          }} 
          onPlaytestWeek={onPlaytestWeek}
          onStartAIParseScript={startAIParseScript}
          onCancelAIParseScript={cancelAIParseScript}
          lastAutoSave={lastAutoSave}
        />
      
        {/* Global AI Parsing Progress */}
        {renderAIParsingProgress()}
      </>
    );
  }

  return (
    <div className="fixed inset-0 bg-zinc-950 text-white flex flex-col overflow-hidden">
      {/* Header / Tabs */}
      <div className="bg-zinc-900/80 backdrop-blur-md border-b border-zinc-800 px-6 py-2 flex items-center justify-between relative z-50">
        <div className="flex items-center gap-6">
          <button onClick={() => setShowSavedList(true)} className="p-2.5 hover:bg-zinc-800 rounded-xl transition-all active:scale-90 bg-zinc-950 border border-zinc-800">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 group/name bg-zinc-950 px-4 py-1.5 rounded-2xl border border-zinc-800 hover:border-zinc-700 transition-all">
            <input 
              type="text" 
              value={currentStage?.name || ''} 
              onChange={(e) => {
                if (currentStage) {
                  const newName = e.target.value;
                  updateStage({ 
                    ...currentStage, 
                    name: newName,
                    stage: { ...currentStage.stage, name: newName }
                  });
                }
              }}
              className="bg-transparent border-none focus:ring-0 font-black uppercase text-sm w-48 outline-none italic tracking-tighter"
              placeholder="STAGE NAME"
            />
            <Edit3 className="w-3.5 h-3.5 text-zinc-600 group-hover/name:text-pink-500 transition-colors" />
          </div>
          {lastAutoSave && (
            <div className="flex items-center gap-1.5 text-[10px] font-bold text-zinc-500 bg-zinc-950 px-3 py-1 rounded-full border border-zinc-800/50">
              <Clock className="w-3 h-3" />
              AUTO-SAVED: {lastAutoSave.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
          )}
          <div className="h-4 w-px bg-zinc-800 mx-1" />
          <nav className="flex items-center gap-1.5">
            <TabButton active={activeTab === 'CHARACTERS'} onClick={() => setActiveTab('CHARACTERS')} icon={<User className="w-4 h-4" />} label="Characters" />
            <TabButton active={activeTab === 'STAGE'} onClick={() => setActiveTab('STAGE')} icon={<Layers className="w-4 h-4" />} label="Stage" />
            <TabButton active={activeTab === 'CHART'} onClick={() => setActiveTab('CHART')} icon={<Music className="w-4 h-4" />} label="Chart" />
            <TabButton active={activeTab === 'EVENTS'} onClick={() => setActiveTab('EVENTS')} icon={<Zap className="w-4 h-4" />} label="Events" />
            <TabButton active={activeTab === 'PLAYTEST'} onClick={() => setActiveTab('PLAYTEST')} icon={<Play className="w-4 h-4" />} label="Test" />
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-zinc-950 rounded-2xl p-1 border border-zinc-800">
            <button 
              onClick={undo}
              disabled={!canUndo}
              className={`p-2 rounded-xl transition-all active:scale-90 ${canUndo ? 'hover:bg-zinc-800 text-zinc-300' : 'opacity-20 cursor-not-allowed text-zinc-500'}`}
              title="Undo (Ctrl+Z)"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button 
              onClick={redo}
              disabled={!canRedo}
              className={`p-2 rounded-xl transition-all active:scale-90 ${canRedo ? 'hover:bg-zinc-800 text-zinc-300' : 'opacity-20 cursor-not-allowed text-zinc-500'}`}
              title="Redo (Ctrl+Y)"
            >
              <Redo2 className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-zinc-800 mx-1" />
            <button 
              onClick={saveCurrentStage}
              className="flex items-center gap-2 px-4 py-2 rounded-xl transition-all hover:bg-zinc-800 text-cyan-400 font-black text-[10px] tracking-widest active:scale-95"
              title="Save (Ctrl+S)"
            >
              <Save className="w-4 h-4" />
              SAVE
            </button>
            <button 
              onClick={() => currentStage && exportStage(currentStage)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl transition-all hover:bg-zinc-800 text-emerald-400 font-black text-[10px] tracking-widest active:scale-95"
              title="Export Stage"
            >
              <Download className="w-4 h-4" />
              EXPORT
            </button>
            <div className="w-px h-4 bg-zinc-800 mx-1" />
            <button 
              onClick={toggleFullscreen}
              className="p-2.5 hover:bg-zinc-800 rounded-xl text-zinc-400 transition-all active:scale-90"
              title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
          <button 
            onClick={() => currentStage && onPlaytest(currentStage, playbackRate)}
            className="flex items-center gap-2 px-6 py-2.5 bg-pink-600 hover:bg-pink-500 rounded-xl font-black text-xs tracking-widest transition-all active:scale-95 shadow-lg shadow-pink-600/20"
          >
            <Play className="w-4 h-4 fill-current" />
            TEST
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'CHARACTERS' && <CharacterLab stage={currentStage!} setStage={updateStage} />}
        {activeTab === 'STAGE' && <StageArchitect stage={currentStage!} setStage={updateStage} />}
        {activeTab === 'CHART' && <ChartMaster stage={currentStage!} setStage={updateStage} showNotification={showNotification} playbackRate={playbackRate} setPlaybackRate={setPlaybackRate} />}
        {activeTab === 'EVENTS' && <EventTrigger stage={currentStage!} setStage={updateStage} />}
        {activeTab === 'PLAYTEST' && (
          <PlaytestTab 
            stage={currentStage!} 
            playbackRate={playbackRate} 
            setPlaybackRate={setPlaybackRate} 
            onPlaytest={(s) => onPlaytest(s, playbackRate)} 
            settings={settings}
            setSettings={setSettings}
          />
        )}
      </div>

      {/* Global AI Parsing Progress */}
      {renderAIParsingProgress()}
    </div>
  );
};

// --- Sub-Components ---

const WeekEditor: React.FC<{
  week: SavedWeek;
  setWeek: (w: SavedWeek) => void;
  savedStages: SavedStage[];
  onSave: () => void;
  onBack: () => void;
  onPlaytestWeek: (week: SavedWeek, allStages: SavedStage[]) => void;
  onStartAIParseScript: (weekId: string, scriptText: string, clearExisting: boolean) => void;
  lastAutoSave: Date | null;
}> = ({ week, setWeek, savedStages, onSave, onBack, onPlaytestWeek, onStartAIParseScript, lastAutoSave }) => {
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState(false);
  const [thumbnailPrompt, setThumbnailPrompt] = useState('');
  const [activeMode, setActiveMode] = useState<'flow' | 'vn' | 'flowchart'>('flow');

  // Initialize sequence if not present
  useEffect(() => {
    if (!week.sequence || week.sequence.length === 0) {
      if (week.tracks && week.tracks.length > 0) {
        // Migrate legacy tracks to sequence
        const initialSequence: EventNode[] = week.tracks.map((trackId, idx) => ({
          id: `node-${Date.now()}-${idx}`,
          type: 'GAMEPLAY',
          dataId: trackId
        }));
        setWeek({ ...week, sequence: initialSequence });
      } else {
        setWeek({ ...week, sequence: [] });
      }
    }
  }, []);

  const generateAIThumbnail = async () => {
    if (!thumbnailPrompt.trim()) return;
    setIsGeneratingThumbnail(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [{ text: `A vibrant game thumbnail for a rhythm game week called "${week.name}". Style: Friday Night Funkin' / Cartoon. Description: ${thumbnailPrompt}` }],
        },
        config: {
          imageConfig: {
            aspectRatio: "16:9",
            imageSize: "1K"
          }
        }
      });

      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          const base64Data = part.inlineData.data;
          setWeek({ ...week, thumbnail: `data:image/png;base64,${base64Data}` });
          break;
        }
      }
    } catch (error) {
      console.error('AI Thumbnail error:', error);
    } finally {
      setIsGeneratingThumbnail(false);
    }
  };

  const handleAddPhase = (stageId: string) => {
    const newNode: EventNode = {
      id: `node-${Date.now()}`,
      type: 'GAMEPLAY',
      dataId: stageId
    };
    setWeek({ ...week, sequence: [...(week.sequence || []), newNode] });
  };

  const handleAddCutscene = (sceneId: string) => {
    const newNode: EventNode = {
      id: `node-${Date.now()}`,
      type: 'CUTSCENE',
      dataId: sceneId
    };
    setWeek({ ...week, sequence: [...(week.sequence || []), newNode] });
  };

  const handleRemoveNode = (index: number) => {
    const newSequence = [...(week.sequence || [])];
    newSequence.splice(index, 1);
    setWeek({ ...week, sequence: newSequence });
  };

  const handleMoveNode = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === (week.sequence?.length || 0) - 1) return;

    const newSequence = [...(week.sequence || [])];
    const temp = newSequence[index];
    newSequence[index] = newSequence[direction === 'up' ? index - 1 : index + 1];
    newSequence[direction === 'up' ? index - 1 : index + 1] = temp;
    setWeek({ ...week, sequence: newSequence });
  };

  const handleAddPack = () => {
    const newNode: EventNode = {
      id: `node-${Date.now()}`,
      type: 'PACK',
      dataId: `pack-${Date.now()}`,
      name: 'New Scene Pack',
      packScenes: []
    };
    setWeek({ ...week, sequence: [...(week.sequence || []), newNode] });
  };

  const [editingPackNode, setEditingPackNode] = useState<EventNode | null>(null);

  const handleUpdatePack = (nodeId: string, updates: Partial<EventNode>) => {
    const newSequence = (week.sequence || []).map(node => 
      node.id === nodeId ? { ...node, ...updates } : node
    );
    setWeek({ ...week, sequence: newSequence });
    if (editingPackNode?.id === nodeId) {
      setEditingPackNode({ ...editingPackNode, ...updates });
    }
  };

  if (activeMode === 'vn') {
    return <VNEditor week={week} setWeek={setWeek} onBack={() => setActiveMode('flow')} onSave={onSave} onStartAIParseScript={onStartAIParseScript} />;
  }

  if (activeMode === 'flowchart') {
    return (
      <div className="fixed inset-0 bg-zinc-950 text-white flex flex-col overflow-hidden">
        <div className="bg-zinc-900/80 backdrop-blur-md border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => setActiveMode('flow')} className="p-2 hover:bg-zinc-800 rounded-lg">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h2 className="text-xl font-black uppercase tracking-tighter">Story Flowchart</h2>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-12 bg-[radial-gradient(#18181b_1px,transparent_1px)] [background-size:20px_20px]">
          <div className="flex flex-col items-center gap-12">
            {(week.sequence || []).map((node, idx) => {
              const name = node.type === 'GAMEPLAY' 
                ? savedStages.find(s => s.id === node.dataId)?.name || 'Unknown Track'
                : week.vnData?.scenes.find(s => s.id === node.dataId)?.name || 'Unknown Scene';
              
              const vnScene = node.type === 'CUTSCENE' ? week.vnData?.scenes.find(s => s.id === node.dataId) : null;

              return (
                <React.Fragment key={node.id}>
                  <div className={`p-6 rounded-3xl border-2 min-w-[250px] text-center shadow-2xl relative ${node.type === 'GAMEPLAY' ? 'bg-cyan-600/10 border-cyan-500/50' : 'bg-pink-600/10 border-pink-500/50'}`}>
                    <div className="text-[10px] font-black uppercase tracking-widest opacity-50 mb-2">{node.type}</div>
                    <div className="font-black uppercase tracking-tighter text-lg">{name}</div>
                    
                    {vnScene?.choices && vnScene.choices.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-white/10 flex flex-col gap-2">
                        {vnScene.choices.map(choice => (
                          <div key={choice.id} className="text-[9px] font-bold py-1 px-2 bg-white/5 rounded-lg border border-white/10">
                            Choice: {choice.text} → {week.vnData?.scenes.find(s => s.id === choice.nextSceneId)?.name || 'End'}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {idx < (week.sequence?.length || 0) - 1 && (
                    <div className="w-0.5 h-12 bg-zinc-800 relative">
                      <ChevronDown className="absolute -bottom-2 -left-[7px] w-4 h-4 text-zinc-800" />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-zinc-950 text-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-zinc-900/80 backdrop-blur-md border-b border-zinc-800 px-6 py-4 flex items-center justify-between relative z-50">
        <div className="flex items-center gap-6">
          <button onClick={onBack} className="p-2.5 hover:bg-zinc-800 rounded-xl transition-all active:scale-90 bg-zinc-950 border border-zinc-800" title="Back to List">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 group/name bg-zinc-950 px-4 py-1.5 rounded-2xl border border-zinc-800 hover:border-zinc-700 transition-all">
            <input 
              type="text" 
              value={week.name} 
              onChange={(e) => setWeek({ ...week, name: e.target.value })}
              className="bg-transparent border-none focus:ring-0 font-black uppercase text-sm w-48 outline-none italic tracking-tighter"
              placeholder="WEEK NAME"
            />
            <Edit3 className="w-3.5 h-3.5 text-zinc-600 group-hover/name:text-pink-500 transition-colors" />
          </div>
          {lastAutoSave && (
            <div className="flex items-center gap-1.5 text-[10px] font-bold text-zinc-500 bg-zinc-950 px-3 py-1 rounded-full border border-zinc-800/50">
              <Clock className="w-3 h-3" />
              AUTO-SAVED: {lastAutoSave.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
          )}
          
          <div className="flex bg-zinc-950 p-1 rounded-xl border border-zinc-800">
            <button 
              onClick={() => setActiveMode('flow')}
              className={`px-4 py-1.5 rounded-lg text-[10px] font-black tracking-widest uppercase transition-all ${activeMode === 'flow' ? 'bg-pink-600 text-white shadow-lg shadow-pink-600/20' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Story Flow
            </button>
            <button 
              onClick={() => setActiveMode('flowchart')}
              className={`px-4 py-1.5 rounded-lg text-[10px] font-black tracking-widest uppercase transition-all ${activeMode === 'flowchart' ? 'bg-pink-600 text-white shadow-lg shadow-pink-600/20' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Flowchart
            </button>
            <button 
              onClick={() => setActiveMode('vn')}
              className={`px-4 py-1.5 rounded-lg text-[10px] font-black tracking-widest uppercase transition-all ${activeMode === 'vn' ? 'bg-pink-600 text-white shadow-lg shadow-pink-600/20' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              VN Editor
            </button>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={() => onPlaytestWeek(week, savedStages)}
            disabled={!week.sequence || week.sequence.length === 0}
            className="flex items-center gap-2 px-6 py-2.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-black text-xs tracking-widest transition-all active:scale-95 shadow-lg shadow-green-600/20"
          >
            <Play className="w-4 h-4" />
            PLAYTEST WEEK
          </button>
          <button 
            onClick={onSave}
            className="flex items-center gap-2 px-6 py-2.5 bg-pink-600 hover:bg-pink-500 rounded-xl font-black text-xs tracking-widest transition-all active:scale-95 shadow-lg shadow-pink-600/20"
          >
            <Save className="w-4 h-4" />
            SAVE WEEK
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel: Available Tracks & Scenes */}
        <div className="w-1/3 bg-zinc-900 border-r border-zinc-800 p-6 flex flex-col gap-6 overflow-y-auto custom-scrollbar">
          <div className="space-y-4">
            <h2 className="text-xl font-black uppercase tracking-widest text-zinc-500">Thumbnail</h2>
            <div className="aspect-video bg-zinc-950 rounded-2xl border-2 border-dashed border-zinc-800 overflow-hidden relative group">
              {week.thumbnail ? (
                <img src={week.thumbnail} alt="Thumbnail" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-zinc-700">
                  <ImageIcon className="w-12 h-12 mb-2 opacity-20" />
                  <p className="text-[10px] font-black uppercase tracking-widest">No thumbnail</p>
                </div>
              )}
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                <label className="p-3 bg-white text-black rounded-full cursor-pointer hover:scale-110 transition-transform">
                  <Upload className="w-5 h-5" />
                  <input 
                    type="file" 
                    accept="image/*" 
                    className="hidden" 
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (ev) => setWeek({ ...week, thumbnail: ev.target?.result as string });
                        reader.readAsDataURL(file);
                      }
                    }}
                  />
                </label>
              </div>
            </div>
            <div className="space-y-2">
              <div className="relative">
                <input 
                  type="text" 
                  value={thumbnailPrompt}
                  onChange={(e) => setThumbnailPrompt(e.target.value)}
                  placeholder="AI THUMBNAIL PROMPT..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-3 pl-4 pr-12 text-[10px] font-black tracking-widest uppercase focus:outline-none focus:border-zinc-600 transition-all"
                />
                <button 
                  onClick={generateAIThumbnail}
                  disabled={isGeneratingThumbnail || !thumbnailPrompt.trim()}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-pink-500 hover:text-pink-400 disabled:opacity-30"
                >
                  {isGeneratingThumbnail ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">Or paste a URL below</p>
              <input 
                type="text" 
                value={week.thumbnail || ''} 
                onChange={(e) => setWeek({ ...week, thumbnail: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-3 px-4 text-[10px] font-black tracking-widest uppercase focus:outline-none focus:border-zinc-600 transition-all"
                placeholder="HTTPS://..."
              />
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-xl font-black uppercase tracking-widest text-zinc-500">Available Tracks</h2>
            <div className="flex flex-col gap-2">
              {savedStages.map(stage => (
                <div key={stage.id} className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 flex items-center justify-between group">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800">
                      {stage.thumbnail ? (
                        <img src={stage.thumbnail} alt={stage.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-zinc-700">
                          <Music className="w-6 h-6" />
                        </div>
                      )}
                    </div>
                    <div>
                      <h3 className="font-bold text-white">{stage.name}</h3>
                      <p className="text-xs text-zinc-500">{stage.chart?.notes?.length || 0} notes</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleAddPhase(stage.id)}
                    className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-white transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-xl font-black uppercase tracking-widest text-zinc-500">Available Scenes</h2>
            <div className="flex flex-col gap-2">
              {week.vnData?.scenes.map(scene => (
                <div key={scene.id} className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 flex items-center justify-between group">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-700">
                      <Layout className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-bold text-white truncate w-32 uppercase tracking-tighter">{scene.name}</h3>
                      <p className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">{scene.dialogue.length} lines</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleAddCutscene(scene.id)}
                    className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-white transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {(!week.vnData || week.vnData.scenes.length === 0) && (
                <div className="text-center p-8 text-zinc-500 border border-dashed border-zinc-800 rounded-2xl">
                  <Layout className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-[10px] font-black uppercase tracking-widest">No scenes created.</p>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-zinc-800">
              <button 
                onClick={handleAddPack}
                className="w-full py-4 bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center gap-3 group transition-all"
              >
                <div className="w-8 h-8 bg-zinc-900 rounded-lg flex items-center justify-center group-hover:bg-purple-600 transition-all">
                  <Layers className="w-4 h-4 text-zinc-500 group-hover:text-white" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400 group-hover:text-white">Create Scene Pack</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Panel: Story Sequence */}
        <div className="flex-1 bg-zinc-950 p-6 flex flex-col gap-4 overflow-y-auto custom-scrollbar">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-black uppercase tracking-widest text-zinc-500">Story Sequence</h2>
            <div className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">
              {week.sequence?.length || 0} Nodes
            </div>
          </div>
          
          <div className="flex flex-col gap-3">
            {(week.sequence || []).map((node, index) => {
              let name = "Unknown";
              let typeLabel = node.type;
              let icon = <AlertCircle className="w-4 h-4" />;

              if (node.type === 'GAMEPLAY') {
                const stage = savedStages.find(s => s.id === node.dataId);
                name = stage?.name || "Missing Stage";
                icon = <Music className="w-4 h-4" />;
              } else if (node.type === 'CUTSCENE') {
                const scene = week.vnData?.scenes.find(s => s.id === node.dataId);
                name = scene?.name || "Missing Scene";
                icon = <Layout className="w-4 h-4" />;
              } else if (node.type === 'PACK') {
                name = node.name || "Scene Pack";
                icon = <Layers className="w-4 h-4" />;
              }
              
              return (
                <div key={node.id} className="bg-zinc-900 p-5 rounded-2xl border border-zinc-800 flex items-center justify-between group hover:border-zinc-700 transition-all">
                  <div className="flex items-center gap-6">
                    <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center font-black text-zinc-500 shadow-inner">
                      {index + 1}
                    </div>
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${node.type === 'GAMEPLAY' ? 'bg-green-600/20 text-green-500' : node.type === 'PACK' ? 'bg-purple-600/20 text-purple-500' : 'bg-pink-600/20 text-pink-500'}`}>
                        {icon}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[9px] font-black tracking-widest uppercase px-2 py-0.5 rounded-md ${node.type === 'GAMEPLAY' ? 'bg-green-600 text-white' : node.type === 'PACK' ? 'bg-purple-600 text-white' : 'bg-pink-600 text-white'}`}>
                            {typeLabel}
                          </span>
                          {node.type === 'PACK' && (
                            <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">
                              {node.packScenes?.length || 0} Scenes
                            </span>
                          )}
                        </div>
                        <h3 className="font-black text-white text-lg uppercase tracking-tighter mt-1">{name}</h3>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                    {node.type === 'PACK' && (
                      <button onClick={() => setEditingPackNode(node)} className="p-2 hover:bg-zinc-800 rounded-lg text-purple-500">
                        <Edit3 className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => handleMoveNode(index, 'up')} className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-400">
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleMoveNode(index, 'down')} className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-400">
                      <ChevronDown className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleRemoveNode(index)} className="p-2 hover:bg-zinc-800 rounded-lg text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
            
            {(week.sequence || []).length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-zinc-700 border-2 border-dashed border-zinc-900 rounded-3xl">
                <Share2 className="w-16 h-16 mb-4 opacity-10" />
                <p className="text-xs font-black uppercase tracking-widest opacity-30">Your story is empty. Add tracks or scenes from the left panel.</p>
              </div>
            )}
          </div>
        </div>

        <AnimatePresence>
          {editingPackNode && (
            <div className="fixed inset-0 z-[1000] flex items-center justify-center p-12">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setEditingPackNode(null)}
                className="absolute inset-0 bg-black/90 backdrop-blur-xl"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="relative w-full max-w-5xl bg-zinc-900 border border-zinc-800 rounded-[48px] overflow-hidden flex flex-col shadow-2xl h-[80vh]"
              >
                <div className="p-10 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/50">
                  <div className="flex items-center gap-6">
                    <div className="w-16 h-16 bg-purple-600 rounded-[24px] flex items-center justify-center shadow-lg shadow-purple-600/40">
                      <Layers className="w-8 h-8 text-white" />
                    </div>
                    <div>
                      <input 
                        type="text" 
                        value={editingPackNode.name}
                        onChange={(e) => handleUpdatePack(editingPackNode.id, { name: e.target.value })}
                        className="bg-transparent border-none focus:ring-0 font-black uppercase text-3xl outline-none tracking-tighter text-white italic"
                      />
                      <p className="text-purple-400 text-[10px] font-black uppercase tracking-[0.3em] mt-1">Scene Pack Editor</p>
                    </div>
                  </div>
                  <button onClick={() => setEditingPackNode(null)} className="p-4 hover:bg-zinc-800 rounded-3xl transition-all">
                    <X className="w-8 h-8" />
                  </button>
                </div>

                <div className="flex-1 flex overflow-hidden">
                  {/* Available Scenes */}
                  <div className="w-1/2 border-r border-zinc-800 flex flex-col">
                    <div className="p-6 border-b border-zinc-800 bg-zinc-950/30">
                      <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500">Available Scenes</h3>
                    </div>
                    <div className="flex-1 overflow-y-auto p-6 space-y-3 custom-scrollbar">
                      {week.vnData?.scenes.map(scene => {
                        const isInPack = editingPackNode.packScenes?.includes(scene.id);
                        return (
                          <div key={scene.id} className={`p-4 rounded-2xl border flex items-center justify-between transition-all ${isInPack ? 'bg-zinc-950 border-zinc-800 opacity-50 grayscale' : 'bg-zinc-900 border-zinc-800 hover:border-purple-500/50'}`}>
                            <div className="flex items-center gap-4">
                              <div className="w-12 h-12 rounded-xl overflow-hidden bg-zinc-950 border border-zinc-800">
                                {scene.backgroundId ? (
                                  <img src={week.vnData?.assets.find(a => a.id === scene.backgroundId)?.url} className="w-full h-full object-cover" alt="BG" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-zinc-800">
                                    <Layout className="w-6 h-6" />
                                  </div>
                                )}
                              </div>
                              <span className="font-black uppercase tracking-tighter text-sm">{scene.name}</span>
                            </div>
                            {!isInPack && (
                              <button 
                                onClick={() => {
                                  const newScenes = [...(editingPackNode.packScenes || []), scene.id];
                                  handleUpdatePack(editingPackNode.id, { packScenes: newScenes });
                                }}
                                className="p-2 bg-purple-600 hover:bg-purple-500 rounded-xl transition-all active:scale-90"
                              >
                                <Plus className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Pack Content */}
                  <div className="w-1/2 flex flex-col bg-zinc-950/30">
                    <div className="p-6 border-b border-zinc-800 bg-zinc-950/30 flex items-center justify-between">
                      <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500">Pack Sequence</h3>
                      <span className="text-[10px] font-black text-purple-500 uppercase tracking-widest">{editingPackNode.packScenes?.length || 0} Scenes</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-6 space-y-3 custom-scrollbar">
                      {editingPackNode.packScenes?.map((sceneId, idx) => {
                        const scene = week.vnData?.scenes.find(s => s.id === sceneId);
                        if (!scene) return null;
                        return (
                          <div key={`${sceneId}-${idx}`} className="p-4 bg-zinc-900 rounded-2xl border border-zinc-800 flex items-center justify-between group">
                            <div className="flex items-center gap-4">
                              <div className="w-8 h-8 rounded-full bg-zinc-950 flex items-center justify-center text-[10px] font-black text-zinc-500">
                                {idx + 1}
                              </div>
                              <span className="font-black uppercase tracking-tighter text-sm">{scene.name}</span>
                            </div>
                            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                              <button 
                                onClick={() => {
                                  const newScenes = [...(editingPackNode.packScenes || [])];
                                  newScenes.splice(idx, 1);
                                  handleUpdatePack(editingPackNode.id, { packScenes: newScenes });
                                }}
                                className="p-2 hover:bg-zinc-800 rounded-xl text-red-500"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {(!editingPackNode.packScenes || editingPackNode.packScenes.length === 0) && (
                        <div className="flex flex-col items-center justify-center py-20 text-zinc-800 border-2 border-dashed border-zinc-900 rounded-3xl">
                          <Layers className="w-12 h-12 mb-4 opacity-10" />
                          <p className="text-[10px] font-black uppercase tracking-widest opacity-30">Pack is empty. Add scenes from the left.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

const CharacterPreviewImage: React.FC<{ char: CharacterData; anim: Animation }> = ({ char, anim }) => {
  const [frame, setFrame] = useState(0);
  
  useEffect(() => {
    if (!anim.image2) {
      setFrame(0);
      return;
    }

    const interval = setInterval(() => {
      setFrame(f => (f === 0 ? 1 : 0));
    }, (1 / anim.fps) * 1000 + (anim.delay || 0) * 1000);

    return () => clearInterval(interval);
  }, [anim.image2, anim.fps, anim.delay]);

  const currentImage = frame === 0 ? (anim.image || char.image) : (anim.image2 || anim.image || char.image);

  return (
    <img 
      src={currentImage} 
      alt="Preview" 
      className="max-w-[400px] max-h-[400px] object-contain"
      style={{ 
        transform: `scale(${char.scale * (anim.scale || 1)}) ${char.flipX ? 'scaleX(-1)' : ''} ${char.flipY ? 'scaleY(-1)' : ''}`,
        marginLeft: anim.offset.x || 0,
        marginTop: anim.offset.y || 0
      }}
    />
  );
};

const TabButton: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string }> = ({ active, onClick, icon, label }) => (
  <button 
    onClick={onClick}
    className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl font-black uppercase text-[10px] tracking-[0.2em] transition-all active:scale-95 ${
      active 
        ? 'bg-pink-600 text-white shadow-lg shadow-pink-600/30' 
        : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 border border-transparent hover:border-zinc-700'
    }`}
  >
    {icon}
    {label}
  </button>
);

const CHARACTER_LAB_TIPS = [
  "*Upload a transparent png image of the sprite so it doesn't overlap the background",
  "*Use Arrow Keys for fine tuning the offset in the preview area",
  "*You can override specific animations with a custom image",
  "*Make sure your sprite sheet frames are evenly spaced",
  "*Adjust the scale to fit the stage properly",
  "*Use Frame 2 Image to create a simple 2-frame animation",
  "*Set loop to true for idle animations",
  "*Adjust FPS to control how fast the animation plays"
];

// --- Tab 1: Character Lab ---
const CharacterLab: React.FC<{ stage: SavedStage; setStage: (s: SavedStage) => void }> = ({ stage, setStage }) => {
  const [selectedCharId, setSelectedCharId] = useState<string>('player');
  const [previewZoom, setPreviewZoom] = useState(1);
  const [showArchiveImport, setShowArchiveImport] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  
  const selectedExtra = (stage.extraCharacters || []).find(ec => ec.id === selectedCharId);
  const char = selectedCharId === 'player' ? stage.characterPlayer : 
               selectedCharId === 'opponent' ? stage.characterOpponent : 
               selectedExtra?.character || DEFAULT_CHARACTER;

  const [selectedAnimIndex, setSelectedAnimIndex] = useState(0);
  const selectedAnim = char.animations[selectedAnimIndex];
  const [currentTip, setCurrentTip] = useState('');

  useEffect(() => {
    setCurrentTip(CHARACTER_LAB_TIPS[Math.floor(Math.random() * CHARACTER_LAB_TIPS.length)]);
    const interval = setInterval(() => {
      setCurrentTip(CHARACTER_LAB_TIPS[Math.floor(Math.random() * CHARACTER_LAB_TIPS.length)]);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleSaveToArchive = async () => {
    setSaveStatus('saving');
    try {
      const existing = await loadArchiveCharacters();
      const newArchiveChar: ArchiveCharacter = {
        id: `char_${Date.now()}`,
        data: { ...char }
      };
      await saveArchiveCharacters([...existing, newArchiveChar]);
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err) {
      console.error('Failed to save to archive:', err);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  const updateChar = (updates: Partial<CharacterData>) => {
    const newChar = { ...char, ...updates };
    if (selectedCharId === 'player') {
      setStage(prev => ({ ...prev, characterPlayer: newChar }));
    } else if (selectedCharId === 'opponent') {
      setStage(prev => ({ ...prev, characterOpponent: newChar }));
    } else {
      const newExtras = (stage.extraCharacters || []).map(ec => 
        ec.id === selectedCharId ? { ...ec, character: newChar } : ec
      );
      setStage(prev => ({ ...prev, extraCharacters: newExtras }));
    }
  };

  const updateExtraConfig = (updates: Partial<ExtraCharacterData>) => {
    if (selectedCharId === 'player' || selectedCharId === 'opponent') return;
    const newExtras = (stage.extraCharacters || []).map(ec => 
      ec.id === selectedCharId ? { ...ec, ...updates } : ec
    );
    setStage(prev => ({ ...prev, extraCharacters: newExtras }));
  };

  const addExtra = (side: 'player' | 'opponent') => {
    const newExtra: ExtraCharacterData = {
      id: 'extra-' + Math.random().toString(36).substr(2, 9),
      character: { ...DEFAULT_CHARACTER, name: `Extra ${side === 'player' ? 'P' : 'O'}` },
      showFromStart: false,
      side
    };
    setStage(prev => ({ ...prev, extraCharacters: [...(prev.extraCharacters || []), newExtra] }));
    setSelectedCharId(newExtra.id);
  };

  const removeExtra = (id: string) => {
    setStage(prev => ({ ...prev, extraCharacters: (prev.extraCharacters || []).filter(ec => ec.id !== id) }));
    if (selectedCharId === id) setSelectedCharId('player');
  };

  const updateAnim = (index: number, updates: Partial<Animation>) => {
    const newAnims = [...char.animations];
    newAnims[index] = { ...newAnims[index], ...updates };
    updateChar({ animations: newAnims });
  };

  const addAnim = () => {
    const newAnim: Animation = {
      name: 'new-anim',
      prefix: '',
      indices: [],
      fps: 24,
      loop: false,
      offset: { x: 0, y: 0 }
    };
    updateChar({ animations: [...char.animations, newAnim] });
    setSelectedAnimIndex(char.animations.length);
  };

  const removeAnim = (index: number) => {
    if (char.animations.length <= 1) return;
    const newAnims = char.animations.filter((_, i) => i !== index);
    updateChar({ animations: newAnims });
    setSelectedAnimIndex(Math.max(0, index - 1));
  };

  const handleOffsetChange = (dx: number, dy: number) => {
    updateAnim(selectedAnimIndex, {
      offset: { x: selectedAnim.offset.x + dx, y: selectedAnim.offset.y + dy }
    });
  };

  const handleImportFromArchive = (archiveChar: ArchiveCharacter) => {
    const charData = archiveChar.data;
    const characterData: CharacterData = {
      name: charData.name,
      image: charData.image,
      xml: charData.xml,
      animations: charData.animations,
      scale: charData.scale,
      flipX: charData.flipX,
      healthIcons: charData.healthIcons,
      customNotes: charData.customNotes
    };
    updateChar(characterData);
    setShowArchiveImport(false);
  };

  const handlePasteToLab = async () => {
    try {
      let text = '';
      if (navigator.clipboard && navigator.clipboard.readText) {
        try {
          text = await navigator.clipboard.readText();
        } catch (e) {
          // Fallback to prompt
        }
      }
      
      if (!text) {
        const manual = prompt('Paste character data here:');
        if (manual) text = manual;
      }
      
      if (text) {
        const decompressed = LZString.decompressFromEncodedURIComponent(text);
        if (!decompressed) throw new Error('Invalid data');
        const data = JSON.parse(decompressed) as CharacterData;
        updateChar(data);
      }
    } catch (err) {
      console.error('Failed to paste to lab:', err);
      alert('Failed to paste character data. Make sure you have valid character data.');
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return;
      
      switch (e.key) {
        case 'ArrowLeft': handleOffsetChange(-1, 0); break;
        case 'ArrowRight': handleOffsetChange(1, 0); break;
        case 'ArrowUp': handleOffsetChange(0, -1); break;
        case 'ArrowDown': handleOffsetChange(0, 1); break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedAnimIndex, char]);

  return (
    <div className="h-full flex">
      {/* Sidebar */}
      <div className="w-80 bg-zinc-900 border-r border-zinc-800 p-6 flex flex-col gap-6 overflow-y-auto custom-scrollbar">
        <div className="flex flex-col gap-2">
          <button
            onClick={() => setShowArchiveImport(true)}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase tracking-widest text-xs rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20 transition-all active:scale-95"
          >
            <Plus size={16} />
            Import from Archive
          </button>

          <button
            onClick={handlePasteToLab}
            className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 text-white font-black uppercase tracking-widest text-xs rounded-xl flex items-center justify-center gap-2 shadow-lg transition-all active:scale-95"
          >
            <ClipboardPaste size={16} />
            Paste Character
          </button>
          
          <button
            onClick={handleSaveToArchive}
            disabled={saveStatus === 'saving'}
            className={`w-full py-3 text-white font-black uppercase tracking-widest text-xs rounded-xl flex items-center justify-center gap-2 shadow-lg transition-all active:scale-95 ${
              saveStatus === 'success' ? 'bg-emerald-600' : 
              saveStatus === 'error' ? 'bg-red-600' : 
              'bg-blue-600 hover:bg-blue-500 shadow-blue-900/20'
            }`}
          >
            {saveStatus === 'saving' ? <Loader2 className="w-4 h-4 animate-spin" /> : 
             saveStatus === 'success' ? <Check size={16} /> :
             saveStatus === 'error' ? <AlertCircle size={16} /> :
             <Save size={16} />}
            {saveStatus === 'saving' ? 'Saving...' : 
             saveStatus === 'success' ? 'Saved to Archive!' :
             saveStatus === 'error' ? 'Failed to Save' :
             'Save to Archive'}
          </button>
        </div>

        <div className="flex flex-col gap-2 p-1 bg-zinc-950 rounded-xl">
          <div className="flex gap-1">
            <button 
              onClick={() => setSelectedCharId('player')}
              className={`flex-1 py-2 rounded-lg font-bold text-sm transition-all ${selectedCharId === 'player' ? 'bg-zinc-800 text-white' : 'text-zinc-500'}`}
            >
              PLAYER
            </button>
            <button 
              onClick={() => addExtra('player')}
              className="px-3 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 rounded-lg transition-all"
              title="Add Extra Player Character"
            >
              <Plus size={16} />
            </button>
          </div>
          
          {(stage.extraCharacters || []).filter(ec => ec.side === 'player').map(ec => (
            <div key={ec.id} className="flex gap-1">
              <button 
                onClick={() => setSelectedCharId(ec.id)}
                className={`flex-1 py-2 rounded-lg font-bold text-xs transition-all truncate px-2 ${selectedCharId === ec.id ? 'bg-cyan-600/20 text-cyan-400 border border-cyan-500/30' : 'text-zinc-500 bg-zinc-900/50'}`}
              >
                {ec.character.name}
              </button>
              <button 
                onClick={() => removeExtra(ec.id)}
                className="px-2 py-2 bg-red-900/20 hover:bg-red-900/40 text-red-400 rounded-lg transition-all"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}

          <div className="h-px bg-zinc-800 my-1" />

          <div className="flex gap-1">
            <button 
              onClick={() => setSelectedCharId('opponent')}
              className={`flex-1 py-2 rounded-lg font-bold text-sm transition-all ${selectedCharId === 'opponent' ? 'bg-zinc-800 text-white' : 'text-zinc-500'}`}
            >
              OPPONENT
            </button>
            <button 
              onClick={() => addExtra('opponent')}
              className="px-3 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 rounded-lg transition-all"
              title="Add Extra Opponent Character"
            >
              <Plus size={16} />
            </button>
          </div>

          {(stage.extraCharacters || []).filter(ec => ec.side === 'opponent').map(ec => (
            <div key={ec.id} className="flex gap-1">
              <button 
                onClick={() => setSelectedCharId(ec.id)}
                className={`flex-1 py-2 rounded-lg font-bold text-xs transition-all truncate px-2 ${selectedCharId === ec.id ? 'bg-pink-600/20 text-pink-400 border border-pink-500/30' : 'text-zinc-500 bg-zinc-900/50'}`}
              >
                {ec.character.name}
              </button>
              <button 
                onClick={() => removeExtra(ec.id)}
                className="px-2 py-2 bg-red-900/20 hover:bg-red-900/40 text-red-400 rounded-lg transition-all"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="space-y-4">
          <label className="text-xs font-black uppercase tracking-widest text-zinc-500">Character Info</label>
          <div className="space-y-2">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-zinc-400">Name</span>
              <input 
                type="text" 
                value={char.name || ''} 
                onChange={(e) => updateChar({ name: e.target.value })}
                className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-cyan-500 transition-colors"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-zinc-400">Sprite Sheet URL / Upload</span>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={char.image || ''} 
                  onChange={(e) => updateChar({ image: e.target.value })}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-cyan-500 transition-colors flex-1 min-w-0"
                />
                <label className="bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-2 rounded-lg cursor-pointer flex items-center justify-center transition-colors shrink-0">
                  <ImageIcon className="w-4 h-4" />
                  <input 
                    type="file" 
                    accept="image/*" 
                    className="hidden" 
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = () => updateChar({ image: reader.result as string });
                        reader.readAsDataURL(file);
                      }
                    }} 
                  />
                </label>
              </div>
            </div>
            
            <div className="flex flex-col gap-1 mt-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-zinc-400">Scale</span>
                <span className="text-xs font-mono text-zinc-500">{(char.scale || 1).toFixed(2)}x</span>
              </div>
              <input 
                type="range" 
                min="0.1" 
                max="5" 
                step="0.1"
                value={(char.scale === undefined || Number.isNaN(char.scale)) ? 1 : char.scale}
                onChange={(e) => updateChar({ scale: parseFloat(e.target.value) || 1 })}
                className="w-full accent-cyan-500"
              />
            </div>

            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-zinc-400">Flip X</span>
              <button 
                onClick={() => updateChar({ flipX: !char.flipX })}
                className={`w-10 h-5 rounded-full relative transition-colors ${char.flipX ? 'bg-cyan-500' : 'bg-zinc-700'}`}
              >
                <div className={`absolute top-1 bottom-1 w-3 bg-white rounded-full transition-all ${char.flipX ? 'right-1' : 'left-1'}`} />
              </button>
            </div>

            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-zinc-400">Flip Y</span>
              <button 
                onClick={() => updateChar({ flipY: !char.flipY })}
                className={`w-10 h-5 rounded-full relative transition-colors ${char.flipY ? 'bg-cyan-500' : 'bg-zinc-700'}`}
              >
                <div className={`absolute top-1 bottom-1 w-3 bg-white rounded-full transition-all ${char.flipY ? 'right-1' : 'left-1'}`} />
              </button>
            </div>

            {selectedExtra && (
              <div className="flex items-center justify-between mt-2 p-3 bg-zinc-950 rounded-lg border border-zinc-800">
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-zinc-300">Show from start</span>
                  <span className="text-[10px] text-zinc-500">If off, use 'character swap' trigger</span>
                </div>
                <button 
                  onClick={() => updateExtraConfig({ showFromStart: !selectedExtra.showFromStart })}
                  className={`w-10 h-5 rounded-full relative transition-colors ${selectedExtra.showFromStart ? 'bg-emerald-500' : 'bg-zinc-700'}`}
                >
                  <div className={`absolute top-1 bottom-1 w-3 bg-white rounded-full transition-all ${selectedExtra.showFromStart ? 'right-1' : 'left-1'}`} />
                </button>
              </div>
            )}

            <div className="space-y-4 pt-4 border-t border-zinc-800">
              <div className="flex items-center justify-between">
                <label className="text-xs font-black uppercase tracking-widest text-zinc-500">Health Icons</label>
                <button 
                  onClick={() => updateChar({ 
                    healthIcons: { 
                      ...char.healthIcons, 
                      isSpriteSheet: !char.healthIcons?.isSpriteSheet 
                    } as HealthIcons 
                  })}
                  className={`text-[10px] font-bold px-2 py-1 rounded border transition-all ${
                    char.healthIcons?.isSpriteSheet ? 'bg-cyan-500/20 border-cyan-500 text-cyan-400' : 'bg-zinc-800 border-zinc-700 text-zinc-500'
                  }`}
                >
                  SPRITE SHEET
                </button>
              </div>

              {char.healthIcons?.isSpriteSheet ? (
                <div className="space-y-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase text-zinc-400">Icon Sprite Sheet URL</span>
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        value={char.healthIcons?.spriteSheetUrl || ''} 
                        onChange={(e) => updateChar({ 
                          healthIcons: { ...char.healthIcons, spriteSheetUrl: e.target.value } as HealthIcons 
                        })}
                        className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs focus:border-cyan-500 transition-colors flex-1 min-w-0"
                        placeholder="Sprite sheet URL"
                      />
                      <label className="bg-zinc-800 hover:bg-zinc-700 text-white px-2 py-2 rounded-lg cursor-pointer flex items-center justify-center transition-colors shrink-0">
                        <ImageIcon className="w-3 h-3" />
                        <input 
                          type="file" 
                          accept="image/*" 
                          className="hidden" 
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const reader = new FileReader();
                              reader.onload = () => updateChar({ 
                                healthIcons: { ...char.healthIcons, spriteSheetUrl: reader.result as string } as HealthIcons 
                              });
                              reader.readAsDataURL(file);
                            }
                          }} 
                        />
                      </label>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(['normal', 'win', 'lose'] as const).map((type) => (
                      <div key={type} className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase text-zinc-400">{type} Frame</span>
                        <input 
                          type="number" 
                          value={char.healthIcons?.frames?.[type] || 0} 
                          onChange={(e) => updateChar({ 
                            healthIcons: { 
                              ...char.healthIcons, 
                              frames: { ...char.healthIcons?.frames, [type]: parseInt(e.target.value) || 0 } 
                            } as HealthIcons 
                          })}
                          className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-xs focus:border-cyan-500 transition-colors"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {(['normal', 'win', 'lose'] as const).map((type) => (
                    <div key={type} className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase text-zinc-400">{type} Icon</span>
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          value={char.healthIcons?.[type] || ''} 
                          onChange={(e) => {
                            const newIcons = { ...char.healthIcons, [type]: e.target.value };
                            updateChar({ healthIcons: newIcons as HealthIcons });
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs focus:border-cyan-500 transition-colors flex-1 min-w-0"
                          placeholder={`${type} icon URL`}
                        />
                        <label className="bg-zinc-800 hover:bg-zinc-700 text-white px-2 py-2 rounded-lg cursor-pointer flex items-center justify-center transition-colors shrink-0">
                          <ImageIcon className="w-3 h-3" />
                          <input 
                            type="file" 
                            accept="image/*" 
                            className="hidden" 
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                const reader = new FileReader();
                                reader.onload = () => {
                                  const newIcons = { ...char.healthIcons, [type]: reader.result as string };
                                  updateChar({ healthIcons: newIcons as HealthIcons });
                                };
                                reader.readAsDataURL(file);
                              }
                            }} 
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-4 pt-4 border-t border-zinc-800">
              <label className="text-xs font-black uppercase tracking-widest text-zinc-500">Custom Notes</label>
              <div className="grid grid-cols-1 gap-3">
                {(['falling', 'hit', 'specialFalling', 'specialHit', 'holdColor'] as const).map((type) => (
                  <div key={type} className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase text-zinc-400">
                      {type === 'falling' ? 'Falling Notes (Arrows)' : 
                       type === 'hit' ? 'Hit Notes (Receptors)' : 
                       type === 'specialFalling' ? 'Special Falling Notes' :
                       type === 'specialHit' ? 'Special Hit Notes' :
                       'Hold Note Color (Hex)'}
                    </span>
                    <div className="flex gap-2">
                      <input 
                        type={type === 'holdColor' ? 'color' : 'text'} 
                        value={char.customNotes?.[type] || (type === 'holdColor' ? '#00ffff' : '')} 
                        onChange={(e) => {
                          const newNotes = { ...char.customNotes, [type]: e.target.value };
                          updateChar({ customNotes: newNotes as CustomNotes });
                        }}
                        className={`bg-zinc-950 border border-zinc-800 rounded-lg ${type === 'holdColor' ? 'w-full h-8 p-1' : 'px-3 py-2 text-xs flex-1 min-w-0'} focus:border-cyan-500 transition-colors`}
                        placeholder={type === 'holdColor' ? '#00ffff' : `${type} notes URL`}
                      />
                      {type !== 'holdColor' && (
                        <label className="bg-zinc-800 hover:bg-zinc-700 text-white px-2 py-2 rounded-lg cursor-pointer flex items-center justify-center transition-colors shrink-0">
                          <ImageIcon className="w-3 h-3" />
                          <input 
                            type="file" 
                            accept="image/*" 
                            className="hidden" 
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                const reader = new FileReader();
                                reader.onload = () => {
                                  const newNotes = { ...char.customNotes, [type]: reader.result as string };
                                  updateChar({ customNotes: newNotes as CustomNotes });
                                };
                                reader.readAsDataURL(file);
                              }
                            }} 
                          />
                        </label>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <label className="text-xs font-black uppercase tracking-widest text-zinc-500">Animations</label>
            <button 
              onClick={addAnim}
              className="p-1 bg-cyan-500/20 hover:bg-cyan-500/40 text-cyan-400 rounded-lg transition-colors"
              title="Add Animation"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {char.animations.map((anim, i) => (
              <div key={i} className="group relative">
                <button 
                  onClick={() => setSelectedAnimIndex(i)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${
                    selectedAnimIndex === i ? 'bg-cyan-600/10 border-cyan-500 text-white' : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                  }`}
                >
                  <span className="font-bold text-sm">{anim.name}</span>
                  <span className="text-[10px] opacity-50">{anim.offset.x}, {anim.offset.y}</span>
                </button>
                {char.animations.length > 1 && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); removeAnim(i); }}
                    className="absolute -right-2 -top-2 p-1 bg-red-900/80 hover:bg-red-900 text-red-200 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {selectedAnim && (
          <div className="space-y-4 pt-4 border-t border-zinc-800">
            <label className="text-xs font-black uppercase tracking-widest text-zinc-500">Animation Details</label>
            <div className="space-y-3">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-zinc-400">Name</span>
                <input 
                  type="text" 
                  value={selectedAnim.name || ''} 
                  onChange={(e) => updateAnim(selectedAnimIndex, { name: e.target.value })}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-cyan-500 transition-colors"
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-zinc-400">Prefix</span>
                <input 
                  type="text" 
                  value={selectedAnim.prefix || ''} 
                  onChange={(e) => updateAnim(selectedAnimIndex, { prefix: e.target.value })}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-cyan-500 transition-colors"
                />
              </div>
              <div className="flex gap-2">
                <div className="flex flex-col gap-1 flex-1">
                  <span className="text-xs text-zinc-400">FPS</span>
                  <input 
                    type="number" 
                    value={selectedAnim.fps || 24} 
                    onChange={(e) => updateAnim(selectedAnimIndex, { fps: parseInt(e.target.value) || 24 })}
                    className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-cyan-500 transition-colors"
                  />
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <span className="text-xs text-zinc-400">Delay (s)</span>
                  <input 
                    type="number" 
                    step="0.01"
                    value={selectedAnim.delay || 0} 
                    onChange={(e) => updateAnim(selectedAnimIndex, { delay: parseFloat(e.target.value) || 0 })}
                    className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-cyan-500 transition-colors"
                  />
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <span className="text-xs text-zinc-400">Loop</span>
                  <button 
                    onClick={() => updateAnim(selectedAnimIndex, { loop: !selectedAnim.loop })}
                    className={`h-9 rounded-lg border transition-all flex items-center justify-center gap-2 ${
                      selectedAnim.loop ? 'bg-cyan-600/10 border-cyan-500 text-cyan-400' : 'bg-zinc-950 border-zinc-800 text-zinc-500'
                    }`}
                  >
                    <Zap className={`w-3 h-3 ${selectedAnim.loop ? 'fill-cyan-400' : ''}`} />
                    <span className="text-xs font-bold uppercase tracking-wider">Loop</span>
                  </button>
                </div>
              </div>
              <div className="flex gap-2">
                <div className="flex flex-col gap-1 flex-1">
                  <span className="text-xs text-zinc-400">Offset X</span>
                  <input 
                    type="number" 
                    value={selectedAnim.offset.x || 0} 
                    onChange={(e) => updateAnim(selectedAnimIndex, { offset: { ...selectedAnim.offset, x: parseInt(e.target.value) || 0 } })}
                    className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-cyan-500 transition-colors"
                  />
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <span className="text-xs text-zinc-400">Offset Y</span>
                  <input 
                    type="number" 
                    value={selectedAnim.offset.y || 0} 
                    onChange={(e) => updateAnim(selectedAnimIndex, { offset: { ...selectedAnim.offset, y: parseInt(e.target.value) || 0 } })}
                    className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-cyan-500 transition-colors"
                  />
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <span className="text-xs text-zinc-400">Scale</span>
                  <input 
                    type="number" 
                    step="0.1"
                    value={selectedAnim.scale || 1} 
                    onChange={(e) => updateAnim(selectedAnimIndex, { scale: parseFloat(e.target.value) || 1 })}
                    className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-cyan-500 transition-colors"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-zinc-400">Frame 1 Image</span>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    placeholder="Default (uses sprite sheet)"
                    value={selectedAnim.image || ''} 
                    onChange={(e) => updateAnim(selectedAnimIndex, { image: e.target.value || undefined })}
                    className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-cyan-500 transition-colors flex-1 min-w-0"
                  />
                  {selectedAnim.image && (
                    <button
                      onClick={() => updateAnim(selectedAnimIndex, { image: undefined })}
                      className="bg-red-500/20 text-red-400 px-3 py-2 rounded-lg hover:bg-red-500/30 transition-all shrink-0"
                      title="Clear image"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                  <label className="bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-2 rounded-lg cursor-pointer flex items-center justify-center transition-colors shrink-0">
                    <ImageIcon className="w-4 h-4" />
                    <input 
                      type="file" 
                      accept="image/*" 
                      className="hidden" 
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = () => updateAnim(selectedAnimIndex, { image: reader.result as string });
                          reader.readAsDataURL(file);
                        }
                      }} 
                    />
                  </label>
                  {selectedAnim.image && (
                    <button 
                      onClick={() => updateAnim(selectedAnimIndex, { image: undefined })}
                      className="bg-red-900/50 hover:bg-red-900 text-red-400 px-3 py-2 rounded-lg transition-colors shrink-0"
                      title="Remove Frame 1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-xs text-zinc-400">Frame 2 Image (Optional Animation)</span>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    placeholder="None"
                    value={selectedAnim.image2 || ''} 
                    onChange={(e) => updateAnim(selectedAnimIndex, { image2: e.target.value || undefined })}
                    className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-cyan-500 transition-colors flex-1 min-w-0"
                  />
                  <label className="bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-2 rounded-lg cursor-pointer flex items-center justify-center transition-colors shrink-0">
                    <ImageIcon className="w-4 h-4" />
                    <input 
                      type="file" 
                      accept="image/*" 
                      className="hidden" 
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = () => updateAnim(selectedAnimIndex, { image2: reader.result as string });
                          reader.readAsDataURL(file);
                        }
                      }} 
                    />
                  </label>
                  {selectedAnim.image2 && (
                    <button 
                      onClick={() => updateAnim(selectedAnimIndex, { image2: undefined })}
                      className="bg-red-900/50 hover:bg-red-900 text-red-400 px-3 py-2 rounded-lg transition-colors shrink-0"
                      title="Remove Frame 2"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tip Section */}
        <div className="p-4 mt-auto">
          <div className="bg-zinc-950/50 border border-zinc-800/50 rounded-xl p-4">
            <span className="text-xs font-bold text-cyan-500 uppercase tracking-wider mb-2 block">Tip</span>
            <p className="text-xs text-zinc-400 italic leading-relaxed">
              {currentTip}
            </p>
          </div>
        </div>
      </div>

      {/* Preview Area */}
      <div className="flex-1 bg-zinc-950 relative overflow-hidden flex items-center justify-center">
        {showArchiveImport && (
          <ArchiveImportModal 
            onClose={() => setShowArchiveImport(false)} 
            onSelect={handleImportFromArchive} 
          />
        )}
        <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, #333 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
        
        {/* Character Preview */}
        <div className="relative" style={{ transform: `scale(${previewZoom})`, transition: 'transform 0.2s ease-out' }}>
          <CharacterPreviewImage char={char} anim={selectedAnim} />
          {/* Grid lines for alignment */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 border-2 border-cyan-500 rounded-full opacity-50" />
          <div className="absolute top-1/2 left-0 right-0 h-px bg-cyan-500/20" />
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-cyan-500/20" />
        </div>

        {/* Zoom Controls */}
        <div className="absolute top-8 right-8 bg-zinc-900/90 backdrop-blur border border-zinc-800 p-2 rounded-xl shadow-2xl flex items-center gap-2">
          <button 
            onClick={() => setPreviewZoom(z => Math.max(0.25, z - 0.25))}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
            title="Zoom Out"
          >
            <Minus className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono w-12 text-center text-zinc-300">{Math.round(previewZoom * 100)}%</span>
          <button 
            onClick={() => setPreviewZoom(z => Math.min(3, z + 0.25))}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
            title="Zoom In"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Offset Controls Overlay */}
        <div className="absolute bottom-8 right-8 bg-zinc-900/90 backdrop-blur border border-zinc-800 p-4 rounded-2xl shadow-2xl flex flex-col gap-4 w-80">
          <div className="flex flex-col gap-2 border-b border-zinc-800 pb-4">
            <span className="text-xs font-black uppercase tracking-widest text-zinc-500">Pose Image Override</span>
            <div className="flex gap-2">
              <input 
                type="text" 
                placeholder="Default (uses sprite sheet)"
                value={selectedAnim.image || ''} 
                onChange={(e) => updateAnim(selectedAnimIndex, { image: e.target.value || undefined })}
                className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs focus:border-cyan-500 transition-colors flex-1 min-w-0"
              />
              <label className="bg-zinc-800 hover:bg-zinc-700 text-white px-2 py-2 rounded-lg cursor-pointer flex items-center justify-center transition-colors shrink-0">
                <ImageIcon className="w-4 h-4" />
                <input 
                  type="file" 
                  accept="image/*" 
                  className="hidden" 
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = () => updateAnim(selectedAnimIndex, { image: reader.result as string });
                      reader.readAsDataURL(file);
                    }
                  }} 
                />
              </label>
              {selectedAnim.image && (
                <button 
                  onClick={() => updateAnim(selectedAnimIndex, { image: undefined })}
                  className="bg-red-900/50 hover:bg-red-900 text-red-400 px-2 py-2 rounded-lg transition-colors shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between gap-8">
            <span className="text-xs font-black uppercase tracking-widest text-zinc-500">Offset Editor</span>
            <div className="flex gap-2">
              <div className="px-2 py-1 bg-zinc-950 rounded text-xs font-mono">X: {selectedAnim.offset.x}</div>
              <div className="px-2 py-1 bg-zinc-950 rounded text-xs font-mono">Y: {selectedAnim.offset.y}</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div />
            <button onClick={() => handleOffsetChange(0, -1)} className="p-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors"><ArrowUp className="w-4 h-4" /></button>
            <div />
            <button onClick={() => handleOffsetChange(-1, 0)} className="p-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors"><ArrowLeft className="w-4 h-4" /></button>
            <button onClick={() => handleOffsetChange(0, 1)} className="p-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors"><ArrowDown className="w-4 h-4" /></button>
            <button onClick={() => handleOffsetChange(1, 0)} className="p-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors"><ArrowRight className="w-4 h-4" /></button>
          </div>
          <p className="text-[10px] text-zinc-500 text-center">Use Arrow Keys for fine tuning</p>
        </div>
      </div>
    </div>
  );
};

// --- Tab 2: Stage Architect ---
const StageArchitect: React.FC<{ stage: SavedStage; setStage: (s: SavedStage) => void }> = ({ stage, setStage }) => {
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [layerStartPos, setLayerStartPos] = useState({ x: 0, y: 0 });
  const [showArchiveImport, setShowArchiveImport] = useState(false);
  const [activeBackground, setActiveBackground] = useState<'primary' | 'secondary'>('primary');

  const currentLayers = activeBackground === 'primary' ? stage.stage.layers : (stage.stage.secondaryLayers || []);

  const updateStage = (updates: Partial<StageData>) => {
    setStage(prev => ({ ...prev, stage: { ...prev.stage, ...updates } }));
  };

  const updateCurrentLayers = (newLayers: StageLayer[]) => {
    if (activeBackground === 'primary') {
      updateStage({ layers: newLayers });
    } else {
      updateStage({ secondaryLayers: newLayers });
    }
  };

  const handleImportBackground = (bg: ArchiveBackground) => {
    const newLayer: StageLayer = {
      id: 'layer-' + Date.now(),
      image: bg.url,
      scrollFactor: 1,
      scale: 1,
      position: { x: 0, y: 0 },
      zIndex: currentLayers.length,
    };
    updateCurrentLayers([...currentLayers, newLayer]);
    setSelectedLayerId(newLayer.id);
    setShowArchiveImport(false);
  };

  const addLayer = () => {
    const newLayer: StageLayer = {
      id: 'layer-' + Date.now(),
      image: 'https://picsum.photos/seed/' + Date.now() + '/1920/1080',
      scrollFactor: 1,
      scale: 1,
      position: { x: 0, y: 0 },
      zIndex: currentLayers.length,
    };
    updateCurrentLayers([...currentLayers, newLayer]);
    setSelectedLayerId(newLayer.id);
  };

  const updateLayer = (id: string, updates: Partial<StageLayer>) => {
    const newLayers = currentLayers.map(l => l.id === id ? { ...l, ...updates } : l);
    updateCurrentLayers(newLayers);
  };

  const removeLayer = (id: string) => {
    updateCurrentLayers(currentLayers.filter(l => l.id !== id));
    if (selectedLayerId === id) setSelectedLayerId(null);
  };

  const handlePointerDown = (e: React.PointerEvent, layer: StageLayer) => {
    e.preventDefault();
    setSelectedLayerId(layer.id);
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    setLayerStartPos({ x: layer.position.x, y: layer.position.y });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !selectedLayerId) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    updateLayer(selectedLayerId, {
      position: {
        x: layerStartPos.x + dx,
        y: layerStartPos.y + dy
      }
    });
  };

  const handlePointerUp = () => {
    setIsDragging(false);
  };

  return (
    <div className="h-full flex" onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp}>
      {/* Sidebar */}
      <div className="w-80 bg-zinc-900 border-r border-zinc-800 p-6 flex flex-col gap-6 overflow-y-auto custom-scrollbar">
        <div className="space-y-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-zinc-400">Background Slot</span>
            <div className="flex bg-zinc-950 p-1 rounded-lg border border-zinc-800">
              <button 
                onClick={() => { setActiveBackground('primary'); setSelectedLayerId(null); }}
                className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${activeBackground === 'primary' ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/20' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                Primary
              </button>
              <button 
                onClick={() => { setActiveBackground('secondary'); setSelectedLayerId(null); }}
                className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${activeBackground === 'secondary' ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/20' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                Secondary
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs text-zinc-400">Stage Name</span>
            <input 
              type="text" 
              value={stage.name || ''} 
              onChange={(e) => {
                const newName = e.target.value;
                setStage(prev => ({ 
                  ...prev, 
                  name: newName,
                  stage: { ...prev.stage, name: newName }
                }));
              }}
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-cyan-500 transition-colors"
            />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs text-zinc-400">Level Thumbnail</span>
            <div className="relative group aspect-video bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
              {stage.thumbnail ? (
                <img src={stage.thumbnail} alt="Thumbnail" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-zinc-600">
                  <ImageIcon className="w-8 h-8" />
                </div>
              )}
              <label className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer">
                <div className="flex flex-col items-center gap-2">
                  <Upload className="w-6 h-6 text-white" />
                  <span className="text-[10px] font-bold text-white uppercase tracking-widest">Upload Image</span>
                </div>
                <input 
                  type="file" 
                  accept="image/*" 
                  className="hidden" 
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = (event) => {
                        const img = new Image();
                        img.onload = () => {
                          // Resize to 400x225 (16:9)
                          const canvas = document.createElement('canvas');
                          canvas.width = 400;
                          canvas.height = 225;
                          const ctx = canvas.getContext('2d');
                          ctx?.drawImage(img, 0, 0, 400, 225);
                          const base64 = canvas.toDataURL('image/jpeg', 0.7);
                          setStage(prev => ({ ...prev, thumbnail: base64 }));
                        };
                        img.src = event.target?.result as string;
                      };
                      reader.readAsDataURL(file);
                    }
                  }}
                />
              </label>
            </div>
            {stage.thumbnail && (
              <button 
                onClick={() => setStage(prev => ({ ...prev, thumbnail: undefined }))}
                className="text-[10px] text-red-400 hover:text-red-300 uppercase tracking-widest font-bold mt-1 self-end"
              >
                Remove Custom Thumbnail
              </button>
            )}
          </div>
        </div>

        <div className="h-px bg-zinc-800" />

        <div className="flex items-center justify-between">
          <label className="text-xs font-black uppercase tracking-widest text-zinc-500">Layers</label>
          <div className="flex gap-2">
            <button 
              onClick={() => setShowArchiveImport(true)} 
              className="p-1 hover:bg-zinc-800 rounded text-cyan-400 flex items-center gap-1"
              title="Import from Archive"
            >
              <BookOpen className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase">Archive</span>
            </button>
            <button onClick={addLayer} className="p-1 hover:bg-zinc-800 rounded text-cyan-400"><Plus className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {currentLayers.sort((a, b) => b.zIndex - a.zIndex).map((layer) => (
            <div 
              key={layer.id} 
              className={`bg-zinc-950 border ${selectedLayerId === layer.id ? 'border-cyan-500' : 'border-zinc-800'} rounded-xl p-4 space-y-4 cursor-pointer transition-colors`}
              onClick={() => setSelectedLayerId(layer.id)}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-400">Layer {layer.id.slice(-4)}</span>
                <button 
                  onClick={(e) => { e.stopPropagation(); removeLayer(layer.id); }} 
                  className="text-red-400 hover:text-red-300"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <div className="space-y-2" onClick={e => e.stopPropagation()}>
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-zinc-500">Image URL / Upload</span>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      value={layer.image} 
                      onChange={(e) => updateLayer(layer.id, { image: e.target.value })}
                      className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs flex-1 min-w-0"
                    />
                    <label className="bg-zinc-800 hover:bg-zinc-700 text-white px-2 py-1 rounded cursor-pointer flex items-center justify-center transition-colors shrink-0">
                      <ImageIcon className="w-3 h-3" />
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onload = () => updateLayer(layer.id, { image: reader.result as string });
                            reader.readAsDataURL(file);
                          }
                        }} 
                      />
                    </label>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-zinc-500">Scroll Factor</span>
                    <input 
                      type="number" 
                      step="0.1"
                      value={Number.isNaN(layer.scrollFactor) ? '' : layer.scrollFactor} 
                      onChange={(e) => updateLayer(layer.id, { scrollFactor: parseFloat(e.target.value) || 0 })}
                      className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-zinc-500">Scale</span>
                    <input 
                      type="number" 
                      step="0.1"
                      value={Number.isNaN(layer.scale) ? '' : layer.scale} 
                      onChange={(e) => updateLayer(layer.id, { scale: parseFloat(e.target.value) || 1 })}
                      className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-zinc-500">Flip X</span>
                  <button 
                    onClick={() => updateLayer(layer.id, { flipX: !layer.flipX })}
                    className={`w-10 h-5 rounded-full relative transition-colors ${layer.flipX ? 'bg-cyan-500' : 'bg-zinc-700'}`}
                  >
                    <div className={`absolute top-1 bottom-1 w-3 bg-white rounded-full transition-all ${layer.flipX ? 'right-1' : 'left-1'}`} />
                  </button>
                </div>

                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-zinc-500">Flip Y</span>
                  <button 
                    onClick={() => updateLayer(layer.id, { flipY: !layer.flipY })}
                    className={`w-10 h-5 rounded-full relative transition-colors ${layer.flipY ? 'bg-cyan-500' : 'bg-zinc-700'}`}
                  >
                    <div className={`absolute top-1 bottom-1 w-3 bg-white rounded-full transition-all ${layer.flipY ? 'right-1' : 'left-1'}`} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-zinc-500">Position X</span>
                    <input 
                      type="number" 
                      value={Number.isNaN(layer.position.x) ? '' : layer.position.x} 
                      onChange={(e) => updateLayer(layer.id, { position: { ...layer.position, x: parseInt(e.target.value) || 0 } })}
                      className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-zinc-500">Position Y</span>
                    <input 
                      type="number" 
                      value={Number.isNaN(layer.position.y) ? '' : layer.position.y} 
                      onChange={(e) => updateLayer(layer.id, { position: { ...layer.position, y: parseInt(e.target.value) || 0 } })}
                      className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs"
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-4 pt-4 border-t border-zinc-800">
          <label className="text-xs font-black uppercase tracking-widest text-zinc-500">Camera Focus</label>
          <div className="space-y-4">
            <div className="space-y-2">
              <span className="text-[10px] text-zinc-400 font-bold">Player Focus</span>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" value={Number.isNaN(stage.stage.cameraFocus.player.x) ? '' : stage.stage.cameraFocus.player.x} onChange={(e) => updateStage({ cameraFocus: { ...stage.stage.cameraFocus, player: { ...stage.stage.cameraFocus.player, x: parseInt(e.target.value) || 0 } } })} className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs" />
                <input type="number" value={Number.isNaN(stage.stage.cameraFocus.player.y) ? '' : stage.stage.cameraFocus.player.y} onChange={(e) => updateStage({ cameraFocus: { ...stage.stage.cameraFocus, player: { ...stage.stage.cameraFocus.player, y: parseInt(e.target.value) || 0 } } })} className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs" />
              </div>
            </div>
            <div className="space-y-2">
              <span className="text-[10px] text-zinc-400 font-bold">Opponent Focus</span>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" value={Number.isNaN(stage.stage.cameraFocus.opponent.x) ? '' : stage.stage.cameraFocus.opponent.x} onChange={(e) => updateStage({ cameraFocus: { ...stage.stage.cameraFocus, opponent: { ...stage.stage.cameraFocus.opponent, x: parseInt(e.target.value) || 0 } } })} className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs" />
                <input type="number" value={Number.isNaN(stage.stage.cameraFocus.opponent.y) ? '' : stage.stage.cameraFocus.opponent.y} onChange={(e) => updateStage({ cameraFocus: { ...stage.stage.cameraFocus, opponent: { ...stage.stage.cameraFocus.opponent, y: parseInt(e.target.value) || 0 } } })} className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Preview Area */}
      <div className="flex-1 bg-zinc-950 relative overflow-hidden">
        {showArchiveImport && (
          <ArchiveBackgroundImportModal 
            onClose={() => setShowArchiveImport(false)} 
            onSelect={handleImportBackground} 
          />
        )}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative w-full h-full">
            {currentLayers.sort((a, b) => a.zIndex - b.zIndex).map((layer) => (
              <div 
                key={layer.id}
                className="absolute inset-0 flex items-center justify-center"
                style={{ zIndex: layer.zIndex || 0 }}
              >
                <img 
                  src={layer.image} 
                  alt="" 
                  onPointerDown={(e) => handlePointerDown(e, layer)}
                  className={`max-w-none ${selectedLayerId === layer.id ? 'ring-4 ring-cyan-500 cursor-grab active:cursor-grabbing' : 'cursor-pointer hover:ring-2 hover:ring-zinc-500'}`}
                  style={{ 
                    transform: `scale(${layer.scale || 1}) ${layer.flipX ? 'scaleX(-1)' : ''} ${layer.flipY ? 'scaleY(-1)' : ''}`,
                    marginLeft: layer.position.x || 0,
                    marginTop: layer.position.y || 0,
                    opacity: selectedLayerId === layer.id ? 1 : 0.8
                  }}
                  draggable={false}
                />
              </div>
            ))}
            
            {/* Camera Focus Indicators */}
            <div 
              className="absolute w-8 h-8 border-2 border-pink-500 rounded-full flex items-center justify-center pointer-events-none"
              style={{ left: stage.stage.cameraFocus.player.x || 0, top: stage.stage.cameraFocus.player.y || 0 }}
            >
              <Camera className="w-4 h-4 text-pink-500" />
            </div>
            <div 
              className="absolute w-8 h-8 border-2 border-cyan-500 rounded-full flex items-center justify-center pointer-events-none"
              style={{ left: stage.stage.cameraFocus.opponent.x || 0, top: stage.stage.cameraFocus.opponent.y || 0 }}
            >
              <Camera className="w-4 h-4 text-cyan-500" />
            </div>
          </div>
        </div>
        <div className="absolute bottom-4 left-4 bg-zinc-900/80 backdrop-blur px-3 py-1 rounded text-[10px] text-zinc-400">
          Preview Scale: 1:1
        </div>
      </div>
    </div>
  );
};

type SwipeMode = 'off' | 'add' | 'select' | 'hold' | 'special';
type SpecialNoteType = 'death' | 'caution' | 'black' | 'yellow';

// --- Tab 3: Chart Master ---
const ChartMaster: React.FC<{ 
  stage: SavedStage; 
  setStage: (s: SavedStage) => void; 
  showNotification: (m: string, t?: 'success' | 'error') => void;
  playbackRate: number;
  setPlaybackRate: (rate: number) => void;
}> = ({ stage, setStage, showNotification, playbackRate, setPlaybackRate }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 });
  const [gridSize, setGridSize] = useState<4 | 8>(8);
  const [containerHeight, setContainerHeight] = useState(800);
  const [audioDuration, setAudioDuration] = useState<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridScrollRef = useRef<HTMLDivElement>(null);

  // Measure container height for precise centering
  useEffect(() => {
    const updateHeight = () => {
      if (gridScrollRef.current) {
        setContainerHeight(gridScrollRef.current.clientHeight);
      }
    };
    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, []);

  const spacerHeight = containerHeight / 2;

  const [swipeMode, setSwipeMode] = useState<SwipeMode>('off');
  const [specialNoteType, setSpecialNoteType] = useState<SpecialNoteType>('death');
  const [areaSelection, setAreaSelection] = useState<{ startStep: number, endStep: number, startLane: number, endLane: number } | null>(null);
  const [copiedNotes, setCopiedNotes] = useState<ChartNote[]>([]);
  const [copiedEvents, setCopiedEvents] = useState<ChartEvent[]>([]);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [dragStart, setDragStart] = useState<{ step: number, lane: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ step: number, lane: number } | null>(null);

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [showEventMenu, setShowEventMenu] = useState<{ step: number, y: number } | null>(null);
  const [customObjects, setCustomObjects] = useState<CustomObject[]>(() => {
    const saved = localStorage.getItem('rhythm_editor_custom_objects');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as CustomObject[];
        
        // Ensure unique IDs for custom objects and their contents
        const seenObjIds = new Set<string>();
        return parsed.map(obj => {
          let objId = obj.id;
          if (!objId || seenObjIds.has(objId)) {
            objId = crypto.randomUUID();
          }
          seenObjIds.add(objId);

          const seenNoteIds = new Set<string>();
          const notesWithIds = (obj.notes || []).map(n => {
            let id = n.id;
            if (!id || seenNoteIds.has(id)) {
              id = crypto.randomUUID();
            }
            seenNoteIds.add(id);
            return { ...n, id };
          });

          const seenEventIds = new Set<string>();
          const eventsWithIds = (obj.events || []).map(e => {
            let id = e.id;
            if (!id || seenEventIds.has(id)) {
              id = crypto.randomUUID();
            }
            seenEventIds.add(id);
            return { ...e, id };
          });

          return {
            ...obj,
            id: objId,
            notes: notesWithIds,
            events: eventsWithIds
          };
        });
      } catch (e) {
        console.error('Failed to load custom objects', e);
      }
    }
    return [];
  });
  const [selectedCustomObjectId, setSelectedCustomObjectId] = useState<string | null>(null);
  const [isEditingCustomObjectName, setIsEditingCustomObjectName] = useState<string | null>(null);

  // Save custom objects to localStorage
  useEffect(() => {
    localStorage.setItem('rhythm_editor_custom_objects', JSON.stringify(customObjects));
  }, [customObjects]);

  // Sync custom objects across tabs
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'rhythm_editor_custom_objects' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          setCustomObjects(parsed);
        } catch (err) {
          console.error('Failed to sync custom objects', err);
        }
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const copyToCustomObject = () => {
    if (!areaSelection) return;
    const minStep = Math.min(areaSelection.startStep, areaSelection.endStep);
    const maxStep = Math.max(areaSelection.startStep, areaSelection.endStep);
    const minLane = Math.min(areaSelection.startLane, areaSelection.endLane);
    const maxLane = Math.max(areaSelection.startLane, areaSelection.endLane);

    const selectedNotes = (stage.chart?.notes || []).filter(n => n.step >= minStep && n.step <= maxStep && n.lane >= minLane && n.lane <= maxLane);
    const selectedEvents = minLane <= -1 ? (stage.chart?.events || []).filter(e => e.step >= minStep && e.step <= maxStep) : [];

    const notesToCopy = selectedNotes.map(n => ({ ...n, step: n.step - minStep, lane: n.lane - Math.max(0, minLane) }));
    const eventsToCopy = selectedEvents.map(e => ({ ...e, step: e.step - minStep }));

    const newCustomObject: CustomObject = {
      id: crypto.randomUUID(),
      name: `Object ${customObjects.length + 1}`,
      notes: notesToCopy,
      events: eventsToCopy,
      minLane,
      maxLane,
      duration: maxStep - minStep + 1
    };

    setCustomObjects([...customObjects, newCustomObject]);
    showNotification('Saved to Custom Objects!');
  };

  const pasteCustomObject = (obj: CustomObject) => {
    let targetStep = 0;
    let targetLane = 0;

    if (areaSelection) {
      targetStep = Math.min(areaSelection.startStep, areaSelection.endStep);
      targetLane = Math.max(0, Math.min(areaSelection.startLane, areaSelection.endLane));
    } else {
      const centerPixel = gridScrollRef.current ? gridScrollRef.current.scrollTop + gridScrollRef.current.clientHeight / 2 : 0;
      targetStep = Math.floor(Math.max(0, (centerPixel - window.innerHeight * 0.5) / 40));
    }

    const newNotes = obj.notes.map(n => ({ 
      ...n, 
      id: crypto.randomUUID(), 
      step: n.step + targetStep,
      lane: n.lane + targetLane
    })).filter(n => n.lane >= 0 && n.lane <= 7);

    const newEvents = obj.events.map(e => ({ ...e, id: crypto.randomUUID(), step: e.step + targetStep }));

    updateChart({
      notes: (stage.chart?.notes || []).concat(newNotes),
      events: (stage.chart?.events || []).concat(newEvents)
    });
    
    showNotification(`Pasted ${obj.name}!`);
  };

  const dragStateRef = useRef({
    isDragging: false,
    start: null as { step: number, lane: number } | null,
    current: null as { step: number, lane: number } | null,
    mode: 'off' as SwipeMode
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animationRef = useRef<number>();
  
  const isUserScrollingRef = useRef(false);
  const userScrollTimeout = useRef<NodeJS.Timeout>();
  const lastSetScrollTop = useRef<number>(-1);

  const handleAddEvent = (step: number, type: string, initialValue?: any) => {
    const newEvent: ChartEvent = {
      id: Math.random().toString(36).substr(2, 9),
      step,
      type,
      value: initialValue || getDefaultEventValue(type)
    };
    updateChart({ events: (stage.chart?.events || []).concat([newEvent]) });
    setShowEventMenu(null);
    setSelectedEventId(newEvent.id);
  };

  const getDefaultEventValue = (type: string) => {
    switch (type) {
      case 'modchart': return { type: 'sway', target: 'all', lanes: [], duration: 16, speed: 1, intensity: 1, value: { x: 0, y: 0 }, repeat: 0, delay: 0, fadeOut: 0, easing: 'linear' };
      case 'move': return { target: 'player', movementType: 'instant', duration: 0, x: 0, y: 0, lanes: [] };
      case 'bpm_change': return { bpm: stage.chart.bpm };
      case 'character_swap': return { target: 'player', characterId: '', resetAnimation: '', isExtra: false };
      case 'loop': return { target: 'player', count: 1, interval: 4, events: [] };
      case 'stop_loop': return { target: 'player' };
      case 'camera_shake': return { intensity: 10, duration: 4 };
      case 'camera_offset': return { focus: 'player', type: 'timed', duration: 4, x: 0, y: 0, zoom: 1.2 };
      case 'custom_effect': return { effectType: 'fire', mode: 'fade_in', duration: 4, intensity: 1 };
      case 'camera_zoom': return { zoom: 1.2, duration: 4 };
      case 'fade': return { type: 'fade_in', duration: 4, color: '#000000' };
      case 'flash': return { intensity: 1, fadeIn: 0, hold: 0, fadeOut: 4, rainbow: false };
      case 'start_point': return { enabled: true };
      case 'rotate': return { target: 'all', rotations: 1, duration: 4, lanes: [], isRelative: false, rotationMode: 'self', orbitRadius: 100 };
      case 'shader': return { shaderType: 'glitch', intensity: 1, duration: 4, mode: 'instant', opacity: 1 };
      case 'opacity': return { target: 'all', opacity: 1, duration: 4, mode: 'fade' };
      case 'add_text': return { text: 'New Text', font: 'Inter', mode: 'fade_in', duration: 4, targetOpacity: 1, color: '#ffffff', x: 0.5, y: 0.5 };
      case 'scroll_speed': return { speed: 1 };
      case 'background_swap': return { swapTo: 'toggle' };
      case 'character_edit': return { target: 'player', movementType: 'instant', duration: 4, x: 0, y: 0, scale: 1, opacity: 1, easing: 'linear', relative: false };
      default: return {};
    }
  };

  const handleUserInteraction = () => {
    isUserScrollingRef.current = true;
    if (userScrollTimeout.current) clearTimeout(userScrollTimeout.current);
    userScrollTimeout.current = setTimeout(() => {
      isUserScrollingRef.current = false;
    }, 500);
  };

  const getStepTime = (targetStep: number) => {
    const bpmChanges = (stage.chart?.events || [])
      .filter(e => e.type === 'bpm_change')
      .sort((a, b) => a.step - b.step);
      
    let time = 0;
    let currentStep = 0;
    let currentBpm = stage.chart?.bpm || 120;
    
    for (const change of bpmChanges) {
      if (change.step >= targetStep) break;
      const stepsInThisBpm = change.step - currentStep;
      time += stepsInThisBpm * (60 / currentBpm / 4);
      currentStep = change.step;
      currentBpm = change.value.bpm;
    }
    
    const remainingSteps = targetStep - currentStep;
    time += remainingSteps * (60 / currentBpm / 4);
    return time;
  };

  const getTimeStep = (targetTime: number) => {
    const bpmChanges = (stage.chart?.events || [])
      .filter(e => e.type === 'bpm_change')
      .sort((a, b) => a.step - b.step);
      
    let time = 0;
    let currentStep = 0;
    let currentBpm = stage.chart?.bpm || 120;
    
    for (const change of bpmChanges) {
      const stepsInThisBpm = change.step - currentStep;
      const timeInThisBpm = stepsInThisBpm * (60 / currentBpm / 4);
      
      if (time + timeInThisBpm >= targetTime) {
        const remainingTime = targetTime - time;
        return currentStep + remainingTime / (60 / currentBpm / 4);
      }
      
      time += timeInThisBpm;
      currentStep = change.step;
      currentBpm = change.value.bpm;
    }
    
    const remainingTime = targetTime - time;
    return currentStep + remainingTime / (60 / currentBpm / 4);
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    if (scrollRef.current) {
      scrollRef.current.scrollTop = target.scrollTop;
    }

    // Virtualization: Update visible range
    // The grid starts after the spacerHeight
    const visibleGridTop = Math.max(0, target.scrollTop - spacerHeight);
    const visibleGridBottom = target.scrollTop + target.clientHeight - spacerHeight;
    
    const startStep = Math.max(0, Math.floor(visibleGridTop / 40) - 10);
    const endStep = Math.min(totalSteps, Math.ceil(visibleGridBottom / 40) + 10);
    
    if (startStep !== visibleRange.start || endStep !== visibleRange.end) {
      setVisibleRange({ start: startStep, end: endStep });
    }

    if (isPlayingPreview && !isUserScrollingRef.current) {
      if (Math.abs(target.scrollTop - lastSetScrollTop.current) > 5) {
        handleUserInteraction();
      }
    }

    if (isUserScrollingRef.current || !isPlayingPreview) {
      if (audioRef.current) {
        const centerPixel = target.scrollTop + target.clientHeight / 2;
        const currentStep = Math.max(0, (centerPixel - spacerHeight) / 40);
        let newTime = getStepTime(currentStep);
        newTime = Math.min(newTime, audioRef.current.duration);
        
        if (newTime >= 0) {
          if (Math.abs(audioRef.current.currentTime - newTime) > 0.05) {
            audioRef.current.currentTime = newTime;
          }
        }
      }
    }
  };

  useEffect(() => {
    dragStateRef.current.mode = swipeMode;
  }, [swipeMode]);

  useEffect(() => {
    if (stage.audioUrl) {
      const audio = new Audio(stage.audioUrl);
      audio.playbackRate = playbackRate;
      audioRef.current = audio;
      audio.onloadedmetadata = () => {
        if (audioRef.current === audio) {
          setAudioDuration(audio.duration);
        }
      };
      audio.onended = () => {
        if (audioRef.current === audio) {
          setIsPlayingPreview(false);
          if (animationRef.current) cancelAnimationFrame(animationRef.current);
        }
      };
    } else {
      setAudioDuration(0);
    }
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [stage.audioUrl]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  const togglePreview = () => {
    if (!audioRef.current) return;
    if (isPlayingPreview) {
      audioRef.current.pause();
      setIsPlayingPreview(false);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    } else {
      // If we are at the very beginning, check for a start point
      const centerPixel = gridScrollRef.current ? gridScrollRef.current.scrollTop + gridScrollRef.current.clientHeight / 2 : 0;
      const currentStepAtPlay = Math.max(0, (centerPixel - spacerHeight) / 40);
      
      if (currentStepAtPlay < 0.1) {
        const startPoint = (stage.chart?.events || []).find(e => e.type === 'start_point');
        if (startPoint) {
          const startTime = getStepTime(startPoint.step);
          audioRef.current.currentTime = startTime;
          
          // Sync scroll position to start point
          const targetScrollTop = startPoint.step * 40 + spacerHeight - (gridScrollRef.current?.clientHeight || 0) / 2;
          if (gridScrollRef.current) gridScrollRef.current.scrollTop = targetScrollTop;
          if (scrollRef.current) scrollRef.current.scrollTop = targetScrollTop;
        }
      }

      audioRef.current.play();
      setIsPlayingPreview(true);
      
      const updateScroll = () => {
        if (!audioRef.current || !gridScrollRef.current || !scrollRef.current) return;
        
        if (!isUserScrollingRef.current) {
          const time = audioRef.current.currentTime;
          const currentStep = getTimeStep(time);
          const targetScrollTop = currentStep * 40 + spacerHeight - gridScrollRef.current.clientHeight / 2;
          
          lastSetScrollTop.current = targetScrollTop;
          gridScrollRef.current.scrollTop = targetScrollTop;
          scrollRef.current.scrollTop = targetScrollTop;
        }
        
        animationRef.current = requestAnimationFrame(updateScroll);
      };
      animationRef.current = requestAnimationFrame(updateScroll);
    }
  };

  const updateChart = (updates: Partial<ChartData>) => {
    setStage(prev => ({ ...prev, chart: { ...prev.chart, ...updates } }));
  };

  const deleteSelectedArea = () => {
    if (!areaSelection) return;
    const minStep = Math.min(areaSelection.startStep, areaSelection.endStep);
    const maxStep = Math.max(areaSelection.startStep, areaSelection.endStep);
    const minLane = Math.min(areaSelection.startLane, areaSelection.endLane);
    const maxLane = Math.max(areaSelection.startLane, areaSelection.endLane);

    setStage(prev => ({
      ...prev,
      chart: {
        ...prev.chart,
        notes: prev.chart.notes.filter(n => !(n.step >= minStep && n.step <= maxStep && n.lane >= minLane && n.lane <= maxLane)),
        events: prev.chart.events.filter(e => !(minLane <= -1 && e.step >= minStep && e.step <= maxStep))
      }
    }));
    setAreaSelection(null);
  };

  const createLoop = () => {
    if (!areaSelection) return;
    const minStep = Math.min(areaSelection.startStep, areaSelection.endStep);
    const maxStep = Math.max(areaSelection.startStep, areaSelection.endStep);
    
    // Find move and rotate events in the selected area
    const selectedEvents = (stage.chart?.events || []).filter(e => 
      e.step >= minStep && 
      e.step <= maxStep && 
      (e.type === 'move' || e.type === 'rotate')
    );
    
    if (selectedEvents.length < 2) {
      showNotification('Select at least 2 move/rotate triggers to create a loop!', 'error');
      return;
    }
    
    const interval = maxStep - minStep;
    if (interval <= 0) {
      showNotification('Selection range must be greater than 0!', 'error');
      return;
    }
    
    // Create the loop event
    const loopEventId = Math.random().toString(36).substr(2, 9);
    const loopEvent: ChartEvent = {
      id: loopEventId,
      step: minStep,
      type: 'loop',
      value: {
        events: selectedEvents.map(e => e.id),
        interval: interval,
        count: 0 // Loop indefinitely until stop_loop
      }
    };
    
    // Create the stop_loop event at the end of the selection (or just after)
    const stopLoopEvent: ChartEvent = {
      id: Math.random().toString(36).substr(2, 9),
      step: maxStep + interval,
      type: 'stop_loop',
      value: {
        loopEventId: loopEventId
      }
    };
    
    updateChart({ 
      events: (stage.chart?.events || []).concat([loopEvent, stopLoopEvent]) 
    });
    
    showNotification('Loop created! Adjust the stop_loop trigger to control duration.');
  };

  const fixOverlappingNotes = () => {
    if (!areaSelection) return;
    const minStep = Math.min(areaSelection.startStep, areaSelection.endStep);
    const maxStep = Math.max(areaSelection.startStep, areaSelection.endStep);
    const minLane = Math.min(areaSelection.startLane, areaSelection.endLane);
    const maxLane = Math.max(areaSelection.startLane, areaSelection.endLane);

    const allNotes = stage.chart?.notes || [];
    const outsideNotes = allNotes.filter(n => !(n.step >= minStep && n.step <= maxStep && n.lane >= minLane && n.lane <= maxLane));
    const insideNotes = allNotes.filter(n => n.step >= minStep && n.step <= maxStep && n.lane >= minLane && n.lane <= maxLane);

    const seen = new Set<string>();
    const uniqueInsideNotes = insideNotes.filter(n => {
      const key = `${n.step}-${n.lane}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (uniqueInsideNotes.length === insideNotes.length) {
      showNotification('No overlapping notes found in selection.', 'info');
      return;
    }

    const removedCount = insideNotes.length - uniqueInsideNotes.length;
    updateChart({ notes: [...outsideNotes, ...uniqueInsideNotes] });
    showNotification(`Fixed ${removedCount} overlapping notes!`);
  };

  const copySelectedArea = () => {
    if (!areaSelection) return;
    const minStep = Math.min(areaSelection.startStep, areaSelection.endStep);
    const maxStep = Math.max(areaSelection.startStep, areaSelection.endStep);
    const minLane = Math.min(areaSelection.startLane, areaSelection.endLane);
    const maxLane = Math.max(areaSelection.startLane, areaSelection.endLane);

    const selectedNotes = (stage.chart?.notes || []).filter(n => n.step >= minStep && n.step <= maxStep && n.lane >= minLane && n.lane <= maxLane);
    const selectedEvents = minLane <= -1 ? (stage.chart?.events || []).filter(e => e.step >= minStep && e.step <= maxStep) : [];

    const notesToCopy = selectedNotes.map(n => ({ ...n, step: n.step - minStep, lane: n.lane - Math.max(0, minLane) }));
    const eventsToCopy = selectedEvents.map(e => ({ ...e, step: e.step - minStep }));

    setCopiedNotes(notesToCopy);
    setCopiedEvents(eventsToCopy);

    const copyData = {
      type: 'rhythm_editor_copy',
      notes: notesToCopy,
      events: eventsToCopy
    };

    if (navigator.clipboard) {
      navigator.clipboard.writeText(JSON.stringify(copyData)).then(() => {
        showNotification('Copied to clipboard!');
      }).catch(err => {
        console.error('Failed to copy to clipboard', err);
      });
    }
  };

  const pasteSelectedArea = async (pastedData?: any) => {
    let notes = copiedNotes;
    let events = copiedEvents;

    if (pastedData && pastedData.type === 'rhythm_editor_copy') {
      notes = pastedData.notes;
      events = pastedData.events;
    } else if (navigator.clipboard && navigator.clipboard.readText) {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          const data = JSON.parse(text);
          if (data && data.type === 'rhythm_editor_copy') {
            notes = data.notes;
            events = data.events;
          }
        }
      } catch (e) {
        // Fallback to local state
      }
    }

    if (notes.length === 0 && events.length === 0) return;

    let targetStep = 0;
    let targetLane = 0;

    if (areaSelection) {
      targetStep = Math.min(areaSelection.startStep, areaSelection.endStep);
      targetLane = Math.max(0, Math.min(areaSelection.startLane, areaSelection.endLane));
    } else {
      const centerPixel = gridScrollRef.current ? gridScrollRef.current.scrollTop + gridScrollRef.current.clientHeight / 2 : 0;
      targetStep = Math.floor(Math.max(0, (centerPixel - window.innerHeight * 0.5) / 40));
    }

    const newNotes = notes.map(n => ({ 
      ...n, 
      id: crypto.randomUUID(), 
      step: n.step + targetStep,
      lane: n.lane + targetLane
    })).filter(n => n.lane >= 0 && n.lane <= 7);

    // Prevent overlapping notes during paste
    const existingNotes = stage.chart?.notes || [];
    const filteredNewNotes = newNotes.filter(newNote => 
      !existingNotes.some(existing => existing.step === newNote.step && existing.lane === newNote.lane)
    );

    const newEvents = events.map(e => ({ ...e, id: crypto.randomUUID(), step: e.step + targetStep }));

    updateChart({
      notes: existingNotes.concat(filteredNewNotes),
      events: (stage.chart?.events || []).concat(newEvents)
    });
    
    showNotification('Pasted successfully!');
  };

  const moveSelectedArea = (stepDelta: number) => {
    if (!areaSelection) return;
    const minStep = Math.min(areaSelection.startStep, areaSelection.endStep);
    const maxStep = Math.max(areaSelection.startStep, areaSelection.endStep);
    const minLane = Math.min(areaSelection.startLane, areaSelection.endLane);
    const maxLane = Math.max(areaSelection.startLane, areaSelection.endLane);

    setStage(prev => ({
      ...prev,
      chart: {
        ...prev.chart,
        notes: prev.chart.notes.map(n => {
          if (n.step >= minStep && n.step <= maxStep && n.lane >= minLane && n.lane <= maxLane) {
            return { ...n, step: Math.max(0, n.step + stepDelta) };
          }
          return n;
        }),
        events: prev.chart.events.map(e => {
          if (minLane <= -1 && e.step >= minStep && e.step <= maxStep) {
            return { ...e, step: e.step + stepDelta };
          }
          return e;
        })
      }
    }));

    setAreaSelection(prev => prev ? {
      ...prev,
      startStep: Math.max(0, prev.startStep + stepDelta),
      endStep: Math.max(0, prev.endStep + stepDelta)
    } : null);
  };

  const toggleNote = (step: number, lane: number, type: string = 'default') => {
    if (lane < 0) return;
    const existing = (stage.chart?.notes || []).find(n => n.lane === lane && step >= n.step && step <= n.step + (n.length || 0));
    if (existing) {
      updateChart({ notes: (stage.chart?.notes || []).filter(n => n !== existing) });
    } else {
      updateChart({ notes: (stage.chart?.notes || []).concat([{ id: crypto.randomUUID(), step, lane, length: 0, type }]) });
    }
  };

  const handleCellMouseDown = (step: number, lane: number) => {
    if (swipeMode === 'off') {
      toggleNote(step, lane);
    } else if (swipeMode === 'add') {
      dragStateRef.current = { ...dragStateRef.current, isDragging: true, start: { step, lane }, current: { step, lane }, mode: 'add' };
      setDragStart({ step, lane });
      setDragCurrent({ step, lane });
      setStage(prev => {
        if (!prev.chart.notes.find(n => n.step === step && n.lane === lane)) {
          return { ...prev, chart: { ...prev.chart, notes: [...prev.chart.notes, { id: crypto.randomUUID(), step, lane, length: 0, type: 'default' }] } };
        }
        return prev;
      });
    } else if (swipeMode === 'select') {
      if (areaSelection) {
        const { startStep, endStep, startLane, endLane } = areaSelection;
        const minStep = Math.min(startStep, endStep);
        const maxStep = Math.max(startStep, endStep);
        const minLane = Math.min(startLane, endLane);
        const maxLane = Math.max(startLane, endLane);
        
        if (step >= minStep && step <= maxStep && lane >= minLane && lane <= maxLane) {
          // Already selected, do nothing or show menu
        } else {
          dragStateRef.current = { ...dragStateRef.current, isDragging: true, start: { step, lane }, current: { step, lane }, mode: 'select' };
          setDragStart({ step, lane });
          setDragCurrent({ step, lane });
          setAreaSelection(null);
        }
      } else {
        dragStateRef.current = { ...dragStateRef.current, isDragging: true, start: { step, lane }, current: { step, lane }, mode: 'select' };
        setDragStart({ step, lane });
        setDragCurrent({ step, lane });
      }
    } else if (swipeMode === 'special') {
      toggleNote(step, lane, specialNoteType);
    } else if (swipeMode === 'hold') {
      dragStateRef.current = { ...dragStateRef.current, isDragging: true, start: { step, lane }, current: { step, lane }, mode: 'hold' };
      setDragStart({ step, lane });
      setDragCurrent({ step, lane });
    }
  };

  const handleCellMouseEnter = (step: number, lane: number) => {
    if (!dragStateRef.current.isDragging) return;
    
    dragStateRef.current.current = { step, lane };
    setDragCurrent({ step, lane });
    
    if (swipeMode === 'add') {
      setStage(prev => {
        if (!prev.chart.notes.find(n => n.step === step && n.lane === lane)) {
          return { ...prev, chart: { ...prev.chart, notes: [...prev.chart.notes, { id: crypto.randomUUID(), step, lane, length: 0, type: 'default' }] } };
        }
        return prev;
      });
    }
  };

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      const state = dragStateRef.current;
      if (!state.isDragging || !state.start || !state.current) {
        dragStateRef.current.isDragging = false;
        setDragStart(null);
        setDragCurrent(null);
        return;
      }
      
      if (state.mode === 'select') {
        setAreaSelection({
          startStep: state.start.step,
          endStep: state.current.step,
          startLane: state.start.lane,
          endLane: state.current.lane
        });
      } else if (state.mode === 'hold') {
        const startStep = Math.min(state.start.step, state.current.step);
        const endStep = Math.max(state.start.step, state.current.step);
        const length = endStep - startStep;
        const lane = state.start.lane;
        
        if (length > 0) {
          setStage(prev => {
            const filteredNotes = prev.chart.notes.filter(n => !(n.step === startStep && n.lane === lane));
            return {
              ...prev,
              chart: {
                ...prev.chart,
                notes: [...filteredNotes, { id: crypto.randomUUID(), step: startStep, lane, length, type: 'default' }]
              }
            };
          });
        } else {
          setStage(prev => {
            const existing = prev.chart.notes.find(n => n.step === startStep && n.lane === lane);
            if (existing) {
              return { ...prev, chart: { ...prev.chart, notes: prev.chart.notes.filter(n => n !== existing) } };
            } else {
              return { ...prev, chart: { ...prev.chart, notes: [...prev.chart.notes, { id: crypto.randomUUID(), step: startStep, lane, length: 0, type: 'default' }] } };
            }
          });
        }
      }
      
      dragStateRef.current.isDragging = false;
      setDragStart(null);
      setDragCurrent(null);
    };
    
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [setStage]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        if (swipeMode === 'select') {
          e.preventDefault();
          setAreaSelection({
            startStep: 0,
            endStep: 999999,
            startLane: -1,
            endLane: gridSize - 1
          });
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (areaSelection) {
          e.preventDefault();
          copySelectedArea();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        // Let the 'paste' event handle it for better permission support in iframes
        // But we still call pasteSelectedArea() as a fallback for local state if no paste event fires
        if (!navigator.clipboard || !navigator.clipboard.readText) {
          e.preventDefault();
          pasteSelectedArea();
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (areaSelection) {
          e.preventDefault();
          deleteSelectedArea();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [swipeMode, stage.chart?.notes, gridSize]);

  useEffect(() => {
    const handlePasteEvent = (e: ClipboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      
      const text = e.clipboardData?.getData('text');
      if (text) {
        try {
          const data = JSON.parse(text);
          if (data && data.type === 'rhythm_editor_copy') {
            e.preventDefault();
            pasteSelectedArea(data);
          }
        } catch (err) {}
      }
    };
    window.addEventListener('paste', handlePasteEvent);
    return () => window.removeEventListener('paste', handlePasteEvent);
  }, [copiedNotes, copiedEvents, areaSelection, stage.chart]);

  const maxStepFromNotes = (stage.chart?.notes?.length || 0) > 0 
    ? (stage.chart?.notes || []).reduce((max, n) => Math.max(max, n.step + (n.length || 0)), 0) 
    : 0;
  const maxStepFromAudio = audioDuration > 0 ? Math.ceil(getTimeStep(audioDuration)) : 128;
  const totalSteps = Math.max(128, maxStepFromNotes + 32, maxStepFromAudio + 16);
  const steps = useMemo(() => Array.from({ length: totalSteps }, (_, i) => i), [totalSteps]);

  const eventsByStep = useMemo(() => {
    const map: Record<number, ChartEvent[]> = {};
    (stage.chart?.events || []).forEach(e => {
      if (!map[e.step]) map[e.step] = [];
      map[e.step].push(e);
    });
    return map;
  }, [stage.chart?.events]);

  const isCellInAreaSelection = (step: number, lane: number) => {
    if (!areaSelection) return false;
    const minStep = Math.min(areaSelection.startStep, areaSelection.endStep);
    const maxStep = Math.max(areaSelection.startStep, areaSelection.endStep);
    const minLane = Math.min(areaSelection.startLane, areaSelection.endLane);
    const maxLane = Math.max(areaSelection.startLane, areaSelection.endLane);
    return step >= minStep && step <= maxStep && lane >= minLane && lane <= maxLane;
  };

  const isCellInDragSelect = (step: number, lane: number) => {
    if (swipeMode !== 'select' || !dragStart || !dragCurrent) return false;
    const minStep = Math.min(dragStart.step, dragCurrent.step);
    const maxStep = Math.max(dragStart.step, dragCurrent.step);
    const minLane = Math.min(dragStart.lane, dragCurrent.lane);
    const maxLane = Math.max(dragStart.lane, dragCurrent.lane);
    return step >= minStep && step <= maxStep && lane >= minLane && lane <= maxLane;
  };

  const isCellInHoldPreview = (step: number, lane: number) => {
    if (swipeMode !== 'hold' || !dragStart || !dragCurrent) return false;
    if (lane !== dragStart.lane) return false;
    const minStep = Math.min(dragStart.step, dragCurrent.step);
    const maxStep = Math.max(dragStart.step, dragCurrent.step);
    return step >= minStep && step <= maxStep;
  };

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="bg-zinc-900 border-b border-zinc-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-zinc-500">BPM</span>
            <input 
              type="number" 
              value={(stage.chart.bpm === undefined || Number.isNaN(stage.chart.bpm)) ? '' : stage.chart.bpm} 
              onChange={(e) => updateChart({ bpm: parseInt(e.target.value) || 120 })}
              className="w-16 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-zinc-500">Scroll Speed</span>
            <input 
              type="number" 
              step="0.1"
              value={(stage.chart.scrollSpeed === undefined || Number.isNaN(stage.chart.scrollSpeed)) ? '' : stage.chart.scrollSpeed} 
              onChange={(e) => updateChart({ scrollSpeed: parseFloat(e.target.value) || 1 })}
              className="w-16 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs"
            />
          </div>
          <div className="h-4 w-px bg-zinc-800" />
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-zinc-500">Grid</span>
            <button onClick={() => setGridSize(4)} className={`px-2 py-1 rounded text-[10px] font-bold ${gridSize === 4 ? 'bg-cyan-600 text-white' : 'bg-zinc-800 text-zinc-500'}`}>4 LANES</button>
            <button onClick={() => setGridSize(8)} className={`px-2 py-1 rounded text-[10px] font-bold ${gridSize === 8 ? 'bg-cyan-600 text-white' : 'bg-zinc-800 text-zinc-500'}`}>8 LANES</button>
          </div>
          <div className="h-4 w-px bg-zinc-800" />
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-zinc-500">Mode</span>
            <select 
              value={swipeMode} 
              onChange={(e) => {
                setSwipeMode(e.target.value as SwipeMode);
                setAreaSelection(null);
              }}
              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
            >
              <option value="off">Normal</option>
              <option value="add">Swipe Add</option>
              <option value="select">Area Select</option>
              <option value="hold">Add Hold</option>
              <option value="special">Special Notes</option>
            </select>
          </div>
          {swipeMode === 'special' && (
            <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2 duration-200">
              <div className="h-4 w-px bg-zinc-800" />
              <button 
                onClick={() => setSpecialNoteType('death')}
                className={`px-2 py-1 rounded text-[10px] font-bold transition-all ${specialNoteType === 'death' ? 'bg-red-600 text-white' : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'}`}
                title="Death Note: Player loses if hit"
              >
                DEATH
              </button>
              <button 
                onClick={() => setSpecialNoteType('caution')}
                className={`px-2 py-1 rounded text-[10px] font-bold transition-all ${specialNoteType === 'caution' ? 'bg-orange-600 text-white' : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'}`}
                title="Caution Note: Player loses if missed"
              >
                CAUTION
              </button>
              <button 
                onClick={() => setSpecialNoteType('black')}
                className={`px-2 py-1 rounded text-[10px] font-bold transition-all ${specialNoteType === 'black' ? 'bg-zinc-700 text-white' : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'}`}
                title="Black Note: Counts as miss if hit"
              >
                BLACK
              </button>
              <button 
                onClick={() => setSpecialNoteType('yellow')}
                className={`px-2 py-1 rounded text-[10px] font-bold transition-all ${specialNoteType === 'yellow' ? 'bg-yellow-600 text-white' : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'}`}
                title="Yellow Note: Missing loses 2x health"
              >
                YELLOW
              </button>
            </div>
          )}
          <div className="h-4 w-px bg-zinc-800" />
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-zinc-500">Speed</span>
            <select 
              value={playbackRate} 
              onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
            >
              <option value="0.25">0.25x</option>
              <option value="0.5">0.5x</option>
              <option value="0.75">0.75x</option>
              <option value="1">1.0x</option>
              <option value="1.25">1.25x</option>
              <option value="1.5">1.5x</option>
              <option value="2">2.0x</option>
            </select>
          </div>
          <div className="h-4 w-px bg-zinc-800" />
          <button 
            onClick={togglePreview}
            className={`px-3 py-1 rounded text-[10px] font-bold ${isPlayingPreview ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'}`}
          >
            {isPlayingPreview ? 'STOP PREVIEW' : 'TEST MUSIC'}
          </button>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1 bg-zinc-950 rounded-lg border border-zinc-800">
            <span className="text-[10px] font-bold text-zinc-500 uppercase">Default Event:</span>
            <select 
              value={stage.chart.defaultEvent || 'none'} 
              onChange={(e) => updateChart({ defaultEvent: e.target.value as any })}
              className="bg-transparent border-none focus:ring-0 text-xs text-zinc-300"
            >
              <option value="none">None</option>
              <option value="health_drain">Health Drain</option>
            </select>
          </div>
          <div className="flex items-center gap-2 px-3 py-1 bg-zinc-950 rounded-lg border border-zinc-800">
            <Volume2 className="w-4 h-4 text-zinc-500" />
            <input 
              type="text" 
              placeholder="Audio URL..." 
              value={stage.audioUrl} 
              onChange={(e) => setStage(prev => ({ ...prev, audioUrl: e.target.value }))} 
              className="bg-transparent border-none focus:ring-0 text-xs w-48" 
            />
            <label className="bg-zinc-800 hover:bg-zinc-700 text-white px-2 py-1 rounded cursor-pointer flex items-center justify-center transition-colors shrink-0 ml-2">
              <Music className="w-3 h-3" />
              <input 
                type="file" 
                accept="audio/*" 
                className="hidden" 
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = () => setStage(prev => ({ ...prev, audioUrl: reader.result as string }));
                    reader.readAsDataURL(file);
                  }
                }} 
              />
            </label>
          </div>
        </div>
      </div>

      {/* Grid Area */}
      <div className="flex-1 overflow-hidden flex">
        {/* Step Numbers */}
        <div className="w-12 bg-zinc-900 border-r border-zinc-800 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto custom-scrollbar no-scrollbar" ref={scrollRef}>
            <div style={{ height: spacerHeight }} />
            <div style={{ height: visibleRange.start * 40 }} />
            {steps.slice(visibleRange.start, visibleRange.end).map(step => (
              <div key={step} className={`h-10 flex items-center justify-center text-[10px] font-mono ${step % 4 === 0 ? 'text-zinc-300 bg-zinc-800/50' : 'text-zinc-600'}`}>
                {step}
              </div>
            ))}
            <div style={{ height: Math.max(0, (steps.length - visibleRange.end) * 40) }} />
            <div style={{ height: spacerHeight }} />
          </div>
        </div>

        {/* Note Grid */}
        <div className="flex-1 relative flex">
          {/* Fixed Playback Line */}
          <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-emerald-500 z-50 pointer-events-none shadow-[0_0_10px_rgba(16,185,129,0.8)] -translate-y-1/2" />
          
          <div 
            className="flex-1 bg-zinc-950 overflow-y-auto custom-scrollbar flex" 
            ref={gridScrollRef}
            onScroll={handleScroll}
            onWheel={handleUserInteraction}
            onTouchMove={handleUserInteraction}
          >
            {/* Trigger Lane */}
            <div className="w-16 border-r border-zinc-800 shrink-0 relative bg-zinc-900/30">
              <div style={{ height: spacerHeight }} />
              <div className="relative" style={{ height: steps.length * 40 }}>
                {steps.slice(visibleRange.start, visibleRange.end).map(step => (
                  <div 
                    key={`trigger-${step}`} 
                    className={`absolute left-0 right-0 h-10 border-b border-zinc-800/50 hover:bg-white/5 cursor-pointer flex items-center justify-center ${
                      isCellInAreaSelection(step, -1) ? 'bg-cyan-500/20' : 
                      isCellInDragSelect(step, -1) ? 'bg-cyan-500/40' : ''
                    }`}
                    style={{ top: step * 40 }}
                    onMouseDown={(e) => {
                      if (swipeMode === 'select') {
                        handleCellMouseDown(step, -1);
                      }
                    }}
                    onMouseEnter={() => {
                      if (swipeMode === 'select') {
                        handleCellMouseEnter(step, -1);
                      }
                    }}
                    onClick={(e) => {
                      if (swipeMode !== 'select') {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setShowEventMenu({ step, y: rect.top });
                      }
                    }}
                  >
                    {(eventsByStep[step] || []).map(event => {
                      const isInArea = isCellInAreaSelection(event.step, -1);
                      return (
                        <div 
                          key={event.id}
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shadow-lg ${selectedEventId === event.id || isInArea ? 'bg-cyan-500 text-white ring-2 ring-white' : 'bg-zinc-700 text-zinc-300'}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedEventId(event.id);
                          }}
                        >
                          {event.type === 'move' ? 'M' : event.type === 'bpm_change' ? 'B' : event.type === 'character_swap' ? 'C' : event.type === 'loop' ? 'L' : event.type === 'scroll_speed' ? 'V' : 'S'}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              <div style={{ height: spacerHeight }} />
            </div>

            {/* Note Grid */}
            <div className="flex-1 relative">
              <div style={{ height: spacerHeight }} />
              <div className="relative" style={{ height: steps.length * 40 }}>
                {/* Grid Background */}
              <div className="absolute inset-0 flex">
                {Array.from({ length: gridSize }).map((_, i) => (
                  <div key={i} className={`flex-1 border-r border-zinc-900/50 ${i === 3 && gridSize === 8 ? 'border-r-zinc-700 border-r-2' : ''}`} />
                ))}
              </div>
              
              {/* Horizontal Lines */}
              {steps.slice(visibleRange.start, visibleRange.end).map(step => (
                <div key={step} className={`absolute left-0 right-0 h-px ${step % 4 === 0 ? 'bg-zinc-800' : 'bg-zinc-900/30'}`} style={{ top: step * 40 }} />
              ))}

              {/* Trigger Markers */}
              {(stage.chart?.events || []).filter(e => e.step >= visibleRange.start - 10 && e.step <= visibleRange.end + 10).map(event => (
                <div 
                  key={`marker-${event.id}`} 
                  className={`absolute left-0 right-0 h-0.5 z-10 pointer-events-none ${selectedEventId === event.id ? 'bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.8)]' : 'bg-zinc-500/50'}`} 
                  style={{ top: event.step * 40 + 20 }} 
                />
              ))}
              
              {/* Interaction Layer */}
              <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${gridSize}, 1fr)`, gridTemplateRows: `repeat(${steps.length}, 40px)` }}>
                {steps.slice(visibleRange.start, visibleRange.end).flatMap(step => 
                  Array.from({ length: gridSize }).map((_, lane) => {
                    const isHoldPreview = isCellInHoldPreview(step, lane);
                    return (
                      <div 
                        key={`${step}-${lane}`} 
                        onMouseDown={() => handleCellMouseDown(step, lane)}
                        onMouseEnter={() => handleCellMouseEnter(step, lane)}
                        className={`hover:bg-white/5 cursor-crosshair transition-colors ${
                          isCellInAreaSelection(step, lane) ? 'bg-cyan-500/20' : 
                          isCellInDragSelect(step, lane) ? 'bg-cyan-500/40' : 
                          isCellInHoldPreview(step, lane) ? 'bg-emerald-500/20' : ''
                        }`}
                        style={{ gridRowStart: step + 1 }}
                      />
                    );
                  })
                )}
              </div>

              {/* Notes */}
              {(stage.chart?.notes || []).filter(n => n.step + (n.length || 0) >= visibleRange.start - 16 && n.step <= visibleRange.end + 16).map((note) => {
                const selectedEvent = (stage.chart?.events || []).find(e => e.id === selectedEventId);
                const isTargetedByMove = selectedEvent?.type === 'move' && 
                                        (selectedEvent.value.lanes || []).includes(note.lane);
                
                return (
                  <div 
                    key={note.id}
                    onClick={() => swipeMode === 'off' && toggleNote(note.step, note.lane)}
                    className={`absolute rounded-md cursor-pointer flex flex-col items-center shadow-lg transition-transform active:scale-90 pointer-events-none border border-black/40 ${
                      isTargetedByMove ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-zinc-900 z-30' : ''
                    }`}
                    style={{ 
                      top: note.step * 40 + 4, 
                      left: `${(note.lane / gridSize) * 100}%`, 
                      width: `${(1 / gridSize) * 100}%`,
                      height: note.length > 0 ? note.length * 40 + 32 : 32,
                      padding: '0 4px',
                      zIndex: isTargetedByMove ? 30 : 20
                    }}
                  >
                    <div className={`w-full h-8 rounded relative overflow-hidden border border-black/20 ${
                      isTargetedByMove ? 'bg-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.5)]' : 
                      note.type === 'death' ? 'bg-red-600 shadow-[0_0_10px_rgba(220,38,38,0.5)]' :
                      note.type === 'caution' ? 'bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.5)]' :
                      note.type === 'black' ? 'bg-zinc-900 border border-zinc-700 shadow-[0_0_10px_rgba(0,0,0,0.5)]' :
                      note.type === 'yellow' ? 'bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.5)]' :
                      (note.lane % 4 === 0 ? 'bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.4)]' :
                       note.lane % 4 === 1 ? 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.4)]' :
                       note.lane % 4 === 2 ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]' :
                       'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.4)]')
                    }`}>
                      <div className="w-full h-full rounded bg-white/20" />
                      {note.type === 'caution' && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-[10px] font-black text-white drop-shadow-md">!</span>
                        </div>
                      )}
                      {note.type === 'death' && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <X className="w-3 h-3 text-white/50" />
                        </div>
                      )}
                    </div>
                    {note.length > 0 && (
                      <div className={`w-1/2 flex-1 opacity-50 ${
                        isTargetedByMove ? 'bg-emerald-400' : 
                        note.type === 'death' ? 'bg-red-600' :
                        note.type === 'caution' ? 'bg-orange-500' :
                        note.type === 'black' ? 'bg-zinc-900' :
                        note.type === 'yellow' ? 'bg-yellow-500' :
                        (note.lane % 4 === 0 ? 'bg-purple-500' :
                         note.lane % 4 === 1 ? 'bg-blue-500' :
                         note.lane % 4 === 2 ? 'bg-emerald-500' :
                         'bg-red-500')
                      }`} />
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ height: spacerHeight }} />
          </div>
        </div>
        </div>

        {/* Properties Sidebar */}
        <div className="w-64 bg-zinc-900 border-l border-zinc-800 p-6 flex flex-col gap-6 overflow-y-auto custom-scrollbar">
          <label className="text-xs font-black uppercase tracking-widest text-zinc-500">Quick Edit</label>
          
          {areaSelection && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-white">Area Selection</span>
                <button 
                  onClick={() => setAreaSelection(null)}
                  className="p-1 hover:bg-zinc-800 text-zinc-400 rounded transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              
              <div className="grid grid-cols-2 gap-2">
                <button 
                  onClick={copySelectedArea}
                  className="flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-2 rounded text-xs transition-colors"
                >
                  <Copy className="w-3 h-3" />
                  Copy
                </button>
                <button 
                  onClick={pasteSelectedArea}
                  disabled={copiedNotes.length === 0 && copiedEvents.length === 0}
                  className="flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-2 rounded text-xs transition-colors disabled:opacity-50"
                >
                  <ClipboardPaste className="w-3 h-3" />
                  Paste
                </button>
                <button 
                  onClick={createLoop}
                  className="col-span-2 flex items-center justify-center gap-2 bg-indigo-900/20 hover:bg-indigo-900/40 text-indigo-400 px-3 py-2 rounded text-xs border border-indigo-900/50 transition-colors"
                >
                  <Repeat className="w-3 h-3" />
                  Create Loop
                </button>
                <button 
                  onClick={fixOverlappingNotes}
                  className="col-span-2 flex items-center justify-center gap-2 bg-amber-900/20 hover:bg-amber-900/40 text-amber-400 px-3 py-2 rounded text-xs border border-amber-900/50 transition-colors"
                >
                  <AlertCircle className="w-3 h-3" />
                  Fix Overlapping Notes
                </button>
                <button 
                  onClick={copyToCustomObject}
                  className="col-span-2 flex items-center justify-center gap-2 bg-cyan-900/20 hover:bg-cyan-900/40 text-cyan-400 px-3 py-2 rounded text-xs border border-cyan-900/50 transition-colors"
                >
                  <Sparkles className="w-3 h-3" />
                  Copy to Custom Object
                </button>
                <button 
                  onClick={() => moveSelectedArea(-1)}
                  className="flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-2 rounded text-xs transition-colors"
                >
                  <ArrowUp className="w-3 h-3" />
                  Move Up
                </button>
                <button 
                  onClick={() => moveSelectedArea(1)}
                  className="flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-2 rounded text-xs transition-colors"
                >
                  <ArrowDown className="w-3 h-3" />
                  Move Down
                </button>
                <button 
                  onClick={deleteSelectedArea}
                  className="col-span-2 flex items-center justify-center gap-2 bg-red-900/20 hover:bg-red-900/40 text-red-400 px-3 py-2 rounded text-xs border border-red-900/50 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete Selection
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-4 mt-2 pt-4 border-t border-zinc-800">
            <div className="flex items-center justify-between">
              <label className="text-xs font-black uppercase tracking-widest text-zinc-500">Custom Objects Library</label>
              <span className="text-[10px] text-zinc-600 bg-zinc-950 px-1.5 py-0.5 rounded border border-zinc-800">{customObjects.length}</span>
            </div>
            
            <div className="grid grid-cols-1 gap-3">
              {customObjects.length === 0 ? (
                <p className="text-[10px] text-zinc-600 italic text-center py-4 border border-dashed border-zinc-800 rounded">No custom objects saved yet. Use Area Select to copy some!</p>
              ) : (
                customObjects.map(obj => (
                  <div 
                    key={obj.id}
                    className={`group relative bg-zinc-950 border rounded-lg overflow-hidden transition-all hover:border-cyan-500/50 ${selectedCustomObjectId === obj.id ? 'border-cyan-500 ring-1 ring-cyan-500/50' : 'border-zinc-800'}`}
                    onClick={() => setSelectedCustomObjectId(obj.id)}
                  >
                    <div className="flex p-2 gap-3">
                      {/* Mini Preview */}
                      <div className="w-12 h-16 bg-zinc-900 rounded border border-zinc-800 overflow-hidden relative shrink-0">
                        <div className="absolute inset-0 grid grid-cols-4 grid-rows-8 opacity-20">
                          {Array.from({ length: 32 }).map((_, i) => <div key={i} className="border-[0.5px] border-zinc-700" />)}
                        </div>
                        {obj.notes.slice(0, 20).map(n => (
                          <div 
                            key={n.id} 
                            className="absolute bg-cyan-500/60 rounded-[1px]" 
                            style={{ 
                              top: `${(n.step / Math.max(1, obj.duration)) * 100}%`, 
                              left: `${(n.lane / 8) * 100}%`, 
                              width: '12.5%', 
                              height: '4%',
                              minHeight: '1px'
                            }} 
                          />
                        ))}
                      </div>
                      
                      <div className="flex-1 flex flex-col justify-between py-0.5">
                        <div className="flex flex-col">
                          {isEditingCustomObjectName === obj.id ? (
                            <input 
                              autoFocus
                              className="bg-zinc-900 border-none focus:ring-1 focus:ring-cyan-500 rounded px-1 py-0.5 text-xs text-white w-full"
                              value={obj.name}
                              onChange={(e) => {
                                setCustomObjects(customObjects.map(o => o.id === obj.id ? { ...o, name: e.target.value } : o));
                              }}
                              onBlur={() => setIsEditingCustomObjectName(null)}
                              onKeyDown={(e) => e.key === 'Enter' && setIsEditingCustomObjectName(null)}
                            />
                          ) : (
                            <div className="flex items-center justify-between group/name">
                              <span className="text-xs font-bold text-zinc-300 truncate max-w-[100px]">{obj.name}</span>
                              <button 
                                onClick={(e) => { e.stopPropagation(); setIsEditingCustomObjectName(obj.id); }}
                                className="opacity-0 group-hover/name:opacity-100 p-1 hover:text-cyan-400 text-zinc-600 transition-all"
                              >
                                <Edit3 className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                          <span className="text-[10px] text-zinc-600">{obj.notes.length} notes • {obj.duration} steps</span>
                        </div>
                        
                        <div className="flex gap-2">
                          <button 
                            onClick={(e) => { e.stopPropagation(); pasteCustomObject(obj); }}
                            className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white text-[10px] font-bold py-1 rounded transition-colors"
                          >
                            Paste
                          </button>
                          <button 
                            onClick={(e) => { e.stopPropagation(); setCustomObjects(customObjects.filter(o => o.id !== obj.id)); }}
                            className="p-1 hover:bg-red-900/20 text-zinc-600 hover:text-red-400 rounded transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {selectedEventId && !areaSelection ? (() => {
            const event = (stage.chart?.events || []).find(e => e.id === selectedEventId);
            if (!event) return <p className="text-xs text-zinc-500">Event not found</p>;
            
            return (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-white capitalize">{event.type.replace('_', ' ')} Trigger</span>
                  <button 
                    onClick={() => {
                      updateChart({ events: (stage.chart?.events || []).filter(e => e.id !== selectedEventId) });
                      setSelectedEventId(null);
                    }}
                    className="p-1 hover:bg-red-500/20 text-red-400 rounded transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                
                <div className="flex flex-col gap-2">
                  <label className="text-xs text-zinc-400">Step</label>
                  <input 
                    type="number" 
                    value={event.step || 0}
                    onChange={(e) => {
                      const newStep = parseInt(e.target.value);
                      if (!isNaN(newStep)) {
                        updateChart({
                          events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, step: newStep } : ev)
                        });
                      }
                    }}
                    className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                  />
                </div>

                {event.type === 'move' && (
                  <>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Target</label>
                      <select 
                        value={event.value.target || 'player'}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, target: e.target.value } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      >
                        <option value="player">Player</option>
                        <option value="opponent">Opponent</option>
                        <option value="both">Both</option>
                      </select>
                    </div>
                    <div className="flex gap-4 items-center mt-1">
                      <div className="flex flex-col gap-2">
                        <label className="text-xs text-zinc-400">Movement Type</label>
                        <select 
                          value={event.value.movementType || 'instant'}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, movementType: e.target.value } } : ev)
                            });
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        >
                          <option value="instant">Instant</option>
                          <option value="timed">Timed</option>
                        </select>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer mt-5">
                        <input 
                          type="checkbox"
                          checked={event.value.relative || false}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, relative: e.target.checked } } : ev)
                            });
                          }}
                          className="rounded bg-zinc-900 border-zinc-700"
                        />
                        Relative
                      </label>
                    </div>
                    {event.value.movementType === 'timed' && (
                      <div className="flex gap-4">
                        <div className="flex flex-col gap-2 flex-1">
                          <label className="text-xs text-zinc-400">Duration (steps)</label>
                          <input 
                            type="number" 
                            value={event.value.duration || 0}
                            onChange={(e) => {
                              updateChart({
                                events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, duration: parseFloat(e.target.value) || 0 } } : ev)
                              });
                            }}
                            className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white w-full"
                          />
                        </div>
                        <div className="flex flex-col gap-2 flex-1">
                          <label className="text-xs text-zinc-400">Easing</label>
                          <select 
                            value={event.value.easing || 'easeOut'}
                            onChange={(e) => {
                              updateChart({
                                events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, easing: e.target.value } } : ev)
                              });
                            }}
                            className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white w-full"
                          >
                            <option value="linear">Linear</option>
                            <option value="easeIn">Ease In</option>
                            <option value="easeOut">Ease Out</option>
                            <option value="easeInOut">Ease In Out</option>
                          </select>
                        </div>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <div className="flex flex-col gap-2 flex-1">
                        <label className="text-xs text-zinc-400">X Offset</label>
                        <input 
                          type="number" 
                          value={event.value.x || 0}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, x: parseFloat(e.target.value) || 0 } } : ev)
                            });
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white w-full"
                        />
                      </div>
                      <div className="flex flex-col gap-2 flex-1">
                        <label className="text-xs text-zinc-400">Y Offset</label>
                        <input 
                          type="number" 
                          value={event.value.y || 0}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, y: parseFloat(e.target.value) || 0 } } : ev)
                            });
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white w-full"
                        />
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 mt-2">
                      <label className="text-xs text-zinc-400">Target Lanes (Playtest Only)</label>
                      <div className="grid grid-cols-4 gap-1">
                        {[0, 1, 2, 3, 4, 5, 6, 7].map(lane => {
                          const isSelected = (event.value.lanes || []).includes(lane);
                          return (
                            <button
                              key={lane}
                              onClick={() => {
                                const currentLanes = event.value.lanes || [];
                                const newLanes = isSelected 
                                  ? currentLanes.filter(l => l !== lane)
                                  : [...currentLanes, lane];
                                updateChart({
                                  events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, lanes: newLanes } } : ev)
                                });
                              }}
                              className={`text-[10px] py-1 rounded border transition-all ${
                                isSelected 
                                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.3)]' 
                                  : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:border-zinc-700'
                              }`}
                            >
                              {lane < 4 ? `Opp ${lane}` : `Play ${lane - 4}`}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-[10px] text-zinc-500 italic mt-1">
                        * Selected lanes will move instead of the character sprite during playtest.
                      </p>
                    </div>
                  </>
                )}

                {event.type === 'character_edit' && (
                  <>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Target</label>
                      <select 
                        value={event.value.target || 'player'}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, target: e.target.value } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      >
                        <option value="player">Player</option>
                        <option value="opponent">Opponent</option>
                        <option value="both">Both (Player & Opponent)</option>
                        <option value="extra">Extra Character</option>
                      </select>
                    </div>

                    {event.value.target === 'extra' && (
                      <div className="flex flex-col gap-2">
                        <label className="text-xs text-zinc-400">Extra Character ID</label>
                        <input 
                          type="text" 
                          value={event.value.characterId || ''}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, characterId: e.target.value } } : ev)
                            });
                          }}
                          placeholder="e.g. bg_dancer"
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                    )}

                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Movement Type</label>
                      <select 
                        value={event.value.movementType || 'instant'}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, movementType: e.target.value } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      >
                        <option value="instant">Instant</option>
                        <option value="timed">Timed</option>
                      </select>
                    </div>

                    {event.value.movementType === 'timed' && (
                      <>
                        <div className="flex flex-col gap-2">
                          <label className="text-xs text-zinc-400">Duration (Steps)</label>
                          <input 
                            type="number" 
                            value={event.value.duration || 4}
                            onChange={(e) => {
                              updateChart({
                                events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, duration: parseInt(e.target.value) || 0 } } : ev)
                              });
                            }}
                            className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="text-xs text-zinc-400">Easing</label>
                          <select 
                            value={event.value.easing || 'linear'}
                            onChange={(e) => {
                              updateChart({
                                events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, easing: e.target.value } } : ev)
                              });
                            }}
                            className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                          >
                            <option value="linear">Linear</option>
                            <option value="easeIn">Ease In</option>
                            <option value="easeOut">Ease Out</option>
                            <option value="easeInOut">Ease In Out</option>
                          </select>
                        </div>
                      </>
                    )}

                    <div className="flex items-center gap-2 mt-2">
                      <input 
                        type="checkbox" 
                        id={`relative-${event.id}`}
                        checked={event.value.relative || false}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, relative: e.target.checked } } : ev)
                          });
                        }}
                        className="w-3 h-3 rounded border-zinc-800 bg-zinc-950 text-cyan-500 focus:ring-cyan-500"
                      />
                      <label htmlFor={`relative-${event.id}`} className="text-[10px] text-zinc-400 font-bold uppercase cursor-pointer">
                        Relative to current position/scale
                      </label>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <div className="flex flex-col gap-2">
                        <label className="text-xs text-zinc-400">X Offset</label>
                        <input 
                          type="number" 
                          value={event.value.x || 0}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, x: parseFloat(e.target.value) || 0 } } : ev)
                            });
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <label className="text-xs text-zinc-400">Y Offset</label>
                        <input 
                          type="number" 
                          value={event.value.y || 0}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, y: parseFloat(e.target.value) || 0 } } : ev)
                            });
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <label className="text-xs text-zinc-400">Scale</label>
                        <input 
                          type="number" 
                          step="0.1"
                          value={event.value.scale || 1}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, scale: parseFloat(e.target.value) || 1 } } : ev)
                            });
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <label className="text-xs text-zinc-400">Opacity</label>
                        <input 
                          type="number" 
                          step="0.1"
                          min="0"
                          max="1"
                          value={event.value.opacity === undefined ? 1 : event.value.opacity}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, opacity: parseFloat(e.target.value) || 0 } } : ev)
                            });
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                    </div>
                  </>
                )}

                {event.type === 'bpm_change' && (
                  <div className="flex flex-col gap-2">
                    <label className="text-xs text-zinc-400">New BPM</label>
                    <input 
                      type="number" 
                      value={event.value.bpm || 100}
                      onChange={(e) => {
                        updateChart({
                          events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, bpm: parseFloat(e.target.value) || 100 } } : ev)
                        });
                      }}
                      className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                    />
                  </div>
                )}

                {event.type === 'character_swap' && (
                  <>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Target</label>
                      <select 
                        value={event.value.target || 'player'}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, target: e.target.value } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      >
                        <option value="player">Player</option>
                        <option value="opponent">Opponent</option>
                      </select>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-zinc-400">Is Extra Character</span>
                      <button 
                        onClick={() => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, isExtra: !event.value.isExtra, characterId: '' } } : ev)
                          });
                        }}
                        className={`w-10 h-5 rounded-full relative transition-colors ${event.value.isExtra ? 'bg-cyan-500' : 'bg-zinc-700'}`}
                      >
                        <div className={`absolute top-1 bottom-1 w-3 bg-white rounded-full transition-all ${event.value.isExtra ? 'right-1' : 'left-1'}`} />
                      </button>
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">{event.value.isExtra ? 'Select Extra Character' : 'Character ID'}</label>
                      {event.value.isExtra ? (
                        <select
                          value={event.value.characterId || ''}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, characterId: e.target.value } } : ev)
                            });
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        >
                          <option value="">Select...</option>
                          {(stage.extraCharacters || []).filter(ec => ec.side === event.value.target).map(ec => (
                            <option key={ec.id} value={ec.id}>{ec.character.name}</option>
                          ))}
                        </select>
                      ) : (
                        <input 
                          type="text" 
                          placeholder="e.g. bf, dad"
                          value={event.value.characterId || ''}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, characterId: e.target.value } } : ev)
                            });
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Reset Animation (Optional)</label>
                      <input 
                        type="text" 
                        placeholder="e.g. hey, cheer"
                        value={event.value.resetAnimation || ''}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, resetAnimation: e.target.value } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                  </>
                )}
                
                {event.type === 'loop' && (
                  <>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Target</label>
                      <select 
                        value={event.value.target || 'player'}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, target: e.target.value } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      >
                        <option value="player">Player</option>
                        <option value="opponent">Opponent</option>
                        <option value="both">Both</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Interval (steps)</label>
                      <input 
                        type="number" 
                        value={event.value.interval || 0}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, interval: parseFloat(e.target.value) || 0 } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Events to Loop</label>
                      <div className="flex flex-col gap-1 max-h-32 overflow-y-auto custom-scrollbar bg-zinc-950 border border-zinc-800 rounded p-2">
                        {(stage.chart?.events || []).filter(e => e.id !== event.id).map(e => (
                          <label key={e.id} className="flex items-center gap-2 text-xs text-zinc-300">
                            <input 
                              type="checkbox"
                              checked={event.value.events?.includes(e.id) || false}
                              onChange={(e_check) => {
                                const newEvents = e_check.target.checked 
                                  ? [...(event.value.events || []), e.id]
                                  : (event.value.events || []).filter((id: string) => id !== e.id);
                                updateChart({
                                  events: (stage.chart?.events || []).map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, events: newEvents } } : ev)
                                });
                              }}
                              className="rounded bg-zinc-900 border-zinc-700"
                            />
                            {e.type.replace('_', ' ')} (Step {e.step})
                          </label>
                        ))}
                      </div>
                    </div>
                    <p className="text-[10px] text-zinc-500 italic mt-1">
                      * Loop will continue infinitely until a "Stop Loop" trigger is encountered.
                    </p>
                  </>
                )}

                {event.type === 'stop_loop' && (
                  <>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Target</label>
                      <select 
                        value={event.value.target}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, target: e.target.value } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      >
                        <option value="player">Player</option>
                        <option value="opponent">Opponent</option>
                        <option value="both">Both</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Loop to Stop</label>
                      <select 
                        value={event.value.loopEventId || ''}
                        onChange={(e) => {
                          updateChart({
                            events: (stage.chart?.events || []).map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, loopEventId: e.target.value } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      >
                        <option value="">Select a loop...</option>
                        {(stage.chart?.events || []).filter(e => e.type === 'loop').map(e => (
                          <option key={e.id} value={e.id}>
                            Loop at Step {e.step} ({e.id.slice(0, 4)})
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                {event.type === 'camera_shake' && (
                  <>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Intensity</label>
                      <input 
                        type="number" 
                        value={event.value.intensity || 0}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, intensity: parseFloat(e.target.value) || 0 } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Duration (steps)</label>
                      <input 
                        type="number" 
                        value={event.value.duration}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, duration: parseFloat(e.target.value) || 0 } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                  </>
                )}

                {event.type === 'camera_zoom' && (
                  <>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Zoom Level</label>
                      <input 
                        type="number" 
                        step="0.1"
                        value={event.value.zoom || 1}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, zoom: parseFloat(e.target.value) || 1 } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Duration (steps)</label>
                      <input 
                        type="number" 
                        value={event.value.duration}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, duration: parseFloat(e.target.value) || 0 } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                  </>
                )}

                {event.type === 'camera_offset' && (
                  <>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Focus</label>
                      <select 
                        value={event.value.focus || 'center'}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, focus: e.target.value } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      >
                        <option value="center">Center</option>
                        <option value="player">Player</option>
                        <option value="opponent">Opponent</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Transition Type</label>
                      <select 
                        value={event.value.type || 'instant'}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, type: e.target.value } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      >
                        <option value="instant">Instant</option>
                        <option value="timed">Timed</option>
                      </select>
                    </div>
                    {event.value.type === 'timed' && (
                      <div className="flex flex-col gap-2">
                        <label className="text-xs text-zinc-400">Duration (steps)</label>
                        <input 
                          type="number" 
                          value={event.value.duration || 4}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, duration: parseFloat(e.target.value) || 0 } } : ev)
                            });
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                    )}
                    <div className="flex gap-2">
                      <div className="flex flex-col gap-2 flex-1">
                        <label className="text-xs text-zinc-400">X Offset</label>
                        <input 
                          type="number" 
                          value={event.value.x || 0}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, x: parseFloat(e.target.value) || 0 } } : ev)
                            });
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white w-full"
                        />
                      </div>
                      <div className="flex flex-col gap-2 flex-1">
                        <label className="text-xs text-zinc-400">Y Offset</label>
                        <input 
                          type="number" 
                          value={event.value.y || 0}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, y: parseFloat(e.target.value) || 0 } } : ev)
                            });
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white w-full"
                        />
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Zoom</label>
                      <input 
                        type="number" 
                        step="0.1"
                        value={event.value.zoom || 1.2}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, zoom: parseFloat(e.target.value) || 1 } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                  </>
                )}

                {event.type === 'custom_effect' && (
                  <>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Effect Type</label>
                      <select 
                        value={event.value.effectType || 'fire'}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, effectType: e.target.value } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      >
                        <option value="fire">Fire</option>
                        <option value="lightning">Lightning</option>
                        <option value="frost">Frost</option>
                        <option value="rain">Rain</option>
                        <option value="invert">Invert</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Mode</label>
                      <select 
                        value={event.value.mode || 'fade_in'}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, mode: e.target.value } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      >
                        <option value="fade_in">Fade In (Start)</option>
                        <option value="fade_out">Fade Out (End)</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Duration (steps)</label>
                      <input 
                        type="number" 
                        value={event.value.duration || 4}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, duration: parseFloat(e.target.value) || 0 } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Intensity</label>
                      <input 
                        type="number" 
                        step="0.1"
                        min="0"
                        max="1"
                        value={event.value.intensity || 1}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, intensity: parseFloat(e.target.value) || 0 } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                  </>
                )}

                {event.type === 'fade' && (
                  <>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Fade Type</label>
                      <select 
                        value={event.value.type || 'fade_in'}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, type: e.target.value } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      >
                        <option value="fade_in">Fade In (Normal to Color)</option>
                        <option value="fade_out">Fade Out (Color to Normal)</option>
                        <option value="in">Legacy: In (Color to Normal)</option>
                        <option value="out">Legacy: Out (Normal to Color)</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Color</label>
                      <input 
                        type="color" 
                        value={event.value.color || '#000000'}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, color: e.target.value } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-1 py-1 text-xs text-white w-full h-8 cursor-pointer"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Duration (steps, 0 = instant)</label>
                      <input 
                        type="number" 
                        value={event.value.duration}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, duration: parseFloat(e.target.value) || 0 } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                  </>
                )}

                {event.type === 'flash' && (
                  <>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Opacity (Intensity)</label>
                      <input 
                        type="number" 
                        step="0.1"
                        min="0"
                        max="1"
                        value={event.value.intensity || 0}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, intensity: parseFloat(e.target.value) || 0 } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="flex flex-col gap-2">
                        <label className="text-[10px] text-zinc-400 uppercase">Fade In</label>
                        <input 
                          type="number" 
                          value={event.value.fadeIn || 0}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, fadeIn: parseFloat(e.target.value) || 0 } } : ev)
                            });
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <label className="text-[10px] text-zinc-400 uppercase">Hold</label>
                        <input 
                          type="number" 
                          value={event.value.hold || 0}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, hold: parseFloat(e.target.value) || 0 } } : ev)
                            });
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <label className="text-[10px] text-zinc-400 uppercase">Fade Out</label>
                        <input 
                          type="number" 
                          value={event.value.fadeOut || 0}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, fadeOut: parseFloat(e.target.value) || 0 } } : ev)
                            });
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer mt-1">
                      <input 
                        type="checkbox"
                        checked={event.value.rainbow || false}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, rainbow: e.target.checked } } : ev)
                          });
                        }}
                        className="rounded bg-zinc-900 border-zinc-700"
                      />
                      Rainbow Effect
                    </label>
                  </>
                )}

                {event.type === 'rotate' && (
                  <>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Target</label>
                      <select 
                        value={event.value.target || 'player'}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, target: e.target.value } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      >
                        <option value="player">Player</option>
                        <option value="opponent">Opponent</option>
                        <option value="notes">Notes</option>
                        <option value="background">Background</option>
                        <option value="all">All</option>
                        <option value="lane">Individual Lanes</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-2 mt-2">
                      <label className="text-xs text-zinc-400">Target Lanes (Playtest Only)</label>
                      <div className="grid grid-cols-4 gap-1">
                        {[0, 1, 2, 3, 4, 5, 6, 7].map(lane => {
                          const isSelected = (event.value.lanes || []).includes(lane);
                          return (
                            <button
                              key={lane}
                              onClick={() => {
                                const currentLanes = event.value.lanes || [];
                                const newLanes = isSelected 
                                  ? currentLanes.filter((l: number) => l !== lane)
                                  : [...currentLanes, lane];
                                updateChart({
                                  events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, lanes: newLanes } } : ev)
                                });
                              }}
                              className={`px-1 py-1 rounded text-[10px] transition-colors ${
                                isSelected 
                                  ? 'bg-zinc-200 text-zinc-950 font-bold' 
                                  : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
                              }`}
                            >
                              {lane < 4 ? `Opp ${lane}` : `Play ${lane-4}`}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Rotation Mode</label>
                      <select 
                        value={event.value.rotationMode || 'self'}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, rotationMode: e.target.value } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      >
                        <option value="self">Self (Rotate in place)</option>
                        <option value="orbit">Orbit (Move in circle)</option>
                      </select>
                    </div>

                    {event.value.rotationMode === 'orbit' && (
                      <div className="flex flex-col gap-2">
                        <label className="text-xs text-zinc-400">Orbit Radius (pixels)</label>
                        <input 
                          type="number" 
                          value={event.value.orbitRadius || 100}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, orbitRadius: parseFloat(e.target.value) || 0 } } : ev)
                            });
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                    )}

                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Rotations (x)</label>
                      <input 
                        type="number" 
                        step="0.1"
                        value={event.value.rotations || 0}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, rotations: parseFloat(e.target.value) || 0 } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Duration (steps) (y)</label>
                      <input 
                        type="number" 
                        value={event.value.duration || 0}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, duration: parseFloat(e.target.value) || 0 } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                      <input 
                        type="checkbox"
                        checked={event.value.isRelative || false}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, isRelative: e.target.checked } } : ev)
                          });
                        }}
                      />
                      Relative Rotation
                    </label>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Easing</label>
                      <select 
                        value={event.value.easing || 'easeInOut'}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, easing: e.target.value } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      >
                        <option value="easeInOut">Ease In Out</option>
                        <option value="easeIn">Ease In</option>
                        <option value="easeOut">Ease Out</option>
                        <option value="linear">Linear</option>
                      </select>
                    </div>
                  </>
                )}

                {event.type === 'modchart' && (
                  <>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Mod Type</label>
                      <select 
                        value={event.value.type || 'sway'}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, type: e.target.value } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      >
                        <option value="sway">Sway</option>
                        <option value="bounce">Bounce</option>
                        <option value="offset">Static Offset</option>
                        <option value="move">Move (Animated)</option>
                        <option value="rotate">Rotate</option>
                        <option value="scroll_speed">Scroll Speed</option>
                        <option value="scale">Scale & Spacing</option>
                        <option value="alpha">Alpha/Invisibility</option>
                        <option value="glitch">Flash & Glitch</option>
                        <option value="tilt">Screen Tilt</option>
                        <option value="mirror">Mirror Mode</option>
                        <option value="drunken">Drunken</option>
                        <option value="wavy">Wavy</option>
                        <option value="hidden">Sudden Appear</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Target</label>
                      <select 
                        value={event.value.target || 'all'}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, target: e.target.value } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      >
                        <option value="all">All</option>
                        <option value="player">Player</option>
                        <option value="opponent">Opponent</option>
                        <option value="both">Both</option>
                        <option value="lane">Lanes</option>
                      </select>
                    </div>

                    {event.value.target === 'lane' && (
                      <div className="flex flex-col gap-2">
                        <label className="text-xs text-zinc-400">Lanes</label>
                        <div className="grid grid-cols-4 gap-1">
                          {[0, 1, 2, 3, 4, 5, 6, 7].map(lane => (
                            <label key={lane} className="flex items-center gap-1 text-[10px] text-zinc-300">
                              <input 
                                type="checkbox"
                                checked={(event.value.lanes || []).includes(lane)}
                                onChange={(e) => {
                                  const currentLanes = event.value.lanes || [];
                                  const newLanes = e.target.checked 
                                    ? [...currentLanes, lane]
                                    : currentLanes.filter((l: number) => l !== lane);
                                  updateChart({
                                    events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, lanes: newLanes } } : ev)
                                  });
                                }}
                              />
                              {lane < 4 ? `Opp ${lane}` : `Play ${lane-4}`}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] text-zinc-400">Duration (steps)</label>
                        <input 
                          type="number" 
                          value={event.value.duration || 0}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, duration: parseFloat(e.target.value) || 0 } } : ev)
                            });
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] text-zinc-400">Speed</label>
                        <input 
                          type="number" 
                          step="0.1"
                          value={event.value.speed || 1}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, speed: parseFloat(e.target.value) || 0 } } : ev)
                            });
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] text-zinc-400">Intensity</label>
                        <input 
                          type="number" 
                          step="0.1"
                          value={event.value.intensity || 1}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, intensity: parseFloat(e.target.value) || 0 } } : ev)
                            });
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] text-zinc-400">Repeat (-1=inf)</label>
                        <input 
                          type="number" 
                          value={event.value.repeat || 0}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, repeat: parseInt(e.target.value) || 0 } } : ev)
                            });
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                    </div>

                    {(event.value.type === 'offset' || event.value.type === 'move') && (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] text-zinc-400">X Offset</label>
                          <input 
                            type="number" 
                            value={event.value.value?.x || 0}
                            onChange={(e) => {
                              updateChart({
                                events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, value: { ...ev.value.value, x: parseFloat(e.target.value) || 0 } } } : ev)
                              });
                            }}
                            className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] text-zinc-400">Y Offset</label>
                          <input 
                            type="number" 
                            value={event.value.value?.y || 0}
                            onChange={(e) => {
                              updateChart({
                                events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, value: { ...ev.value.value, y: parseFloat(e.target.value) || 0 } } } : ev)
                              });
                            }}
                            className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                          />
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] text-zinc-400">Delay (steps)</label>
                        <input 
                          type="number" 
                          value={event.value.delay || 0}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, delay: parseFloat(e.target.value) || 0 } } : ev)
                            });
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] text-zinc-400">Fade Out (steps)</label>
                        <input 
                          type="number" 
                          value={event.value.fadeOut || 0}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, fadeOut: parseFloat(e.target.value) || 0 } } : ev)
                            });
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Easing</label>
                      <select 
                        value={event.value.easing || 'linear'}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, easing: e.target.value } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      >
                        <option value="linear">Linear</option>
                        <option value="easeInOut">Ease In Out</option>
                        <option value="easeIn">Ease In</option>
                        <option value="easeOut">Ease Out</option>
                      </select>
                    </div>
                  </>
                )}

                {event.type === 'shader' && (
                  <>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Shader Type</label>
                      <select 
                        value={event.value.shaderType || 'glitch'}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, shaderType: e.target.value } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      >
                        <option value="glitch">Glitch</option>
                        <option value="chromatic_glitch">Chromatic Glitch</option>
                        <option value="lens_circle">Lens Circle</option>
                        <option value="hue">HUE</option>
                        <option value="gray_scale">Gray Scale</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Mode</label>
                      <select 
                        value={event.value.mode || 'instant'}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, mode: e.target.value } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      >
                        <option value="instant">Instant</option>
                        <option value="fade_in">Fade In</option>
                        <option value="fade_out">Fade Out</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Intensity</label>
                      <input 
                        type="number" 
                        step="0.1"
                        value={event.value.intensity || 0}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, intensity: parseFloat(e.target.value) || 0 } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Transition Duration (steps)</label>
                      <input 
                        type="number" 
                        value={event.value.duration || 0}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, duration: parseFloat(e.target.value) || 0 } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      />
                      <p className="text-[10px] text-zinc-500 italic">
                        * Shaders are permanent until a "Fade Out" trigger of the same type is encountered.
                      </p>
                    </div>
                    {event.value.shaderType === 'lens_circle' && (
                      <>
                        <div className="flex gap-2">
                          <div className="flex flex-col gap-2 flex-1">
                            <label className="text-xs text-zinc-400">Screen Off X</label>
                            <input 
                              type="number" 
                              step="0.01"
                              value={event.value.offsetX || 0}
                              onChange={(e) => {
                                updateChart({
                                  events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, offsetX: parseFloat(e.target.value) || 0 } } : ev)
                                });
                              }}
                              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white w-full"
                            />
                          </div>
                          <div className="flex flex-col gap-2 flex-1">
                            <label className="text-xs text-zinc-400">Screen Off Y</label>
                            <input 
                              type="number" 
                              step="0.01"
                              value={event.value.offsetY || 0}
                              onChange={(e) => {
                                updateChart({
                                  events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, offsetY: parseFloat(e.target.value) || 0 } } : ev)
                                });
                              }}
                              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white w-full"
                            />
                          </div>
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="text-xs text-zinc-400">Opacity</label>
                          <input 
                            type="number" 
                            step="0.1"
                            min="0"
                            max="1"
                            value={event.value.opacity !== undefined ? event.value.opacity : 1}
                            onChange={(e) => {
                              updateChart({
                                events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, opacity: parseFloat(e.target.value) || 0 } } : ev)
                              });
                            }}
                            className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white w-full"
                          />
                        </div>
                      </>
                    )}
                    {event.value.shaderType === 'chromatic_glitch' && (
                      <div className="flex gap-2">
                        <div className="flex flex-col gap-2 flex-1">
                          <label className="text-xs text-zinc-400">Speed</label>
                          <input 
                            type="number" 
                            step="0.1"
                            value={event.value.speed || 0}
                            onChange={(e) => {
                              updateChart({
                                events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, speed: parseFloat(e.target.value) || 0 } } : ev)
                              });
                            }}
                            className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white w-full"
                          />
                        </div>
                        <div className="flex flex-col gap-2 flex-1">
                          <label className="text-xs text-zinc-400">Noise</label>
                          <input 
                            type="number" 
                            step="0.1"
                            value={event.value.noise || 0}
                            onChange={(e) => {
                              updateChart({
                                events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, noise: parseFloat(e.target.value) || 0 } } : ev)
                              });
                            }}
                            className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white w-full"
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}

                {event.type === 'opacity' && (
                  <>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Target</label>
                      <select 
                        value={event.value.target || 'all'}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, target: e.target.value } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      >
                        <option value="notes">Notes (All)</option>
                        <option value="notes_player">Player Notes</option>
                        <option value="notes_opponent">Opponent Notes</option>
                        <option value="characters">Characters (Both)</option>
                        <option value="player">Player Character</option>
                        <option value="opponent">Opponent Character</option>
                        <option value="hp_bar">HP Bar</option>
                        <option value="all">All</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Opacity (0-1)</label>
                      <input 
                        type="number" 
                        step="0.1"
                        min="0"
                        max="1"
                        value={event.value.opacity || 0}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, opacity: parseFloat(e.target.value) || 0 } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Mode</label>
                      <select 
                        value={event.value.mode || 'instant'}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, mode: e.target.value } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      >
                        <option value="instant">Instant</option>
                        <option value="fade">Fade</option>
                      </select>
                    </div>
                    {event.value.mode === 'fade' && (
                      <div className="flex flex-col gap-2">
                        <label className="text-xs text-zinc-400">Duration (steps)</label>
                        <input 
                          type="number" 
                          value={event.value.duration || 0}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, duration: parseFloat(e.target.value) || 0 } } : ev)
                            });
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                    )}
                    <p className="text-[10px] text-zinc-500 italic">
                      * Opacity triggers persist until another trigger of the same target is encountered.
                    </p>
                  </>
                )}

                {event.type === 'add_text' && (
                  <>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Text Content</label>
                      <input 
                        type="text" 
                        value={event.value.text || ''}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, text: e.target.value } } : ev)
                          });
                        }}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-zinc-400">Font</label>
                      <div className="grid grid-cols-2 gap-2">
                        {['Inter', 'Playfair Display', 'JetBrains Mono', 'Anton'].map(font => (
                          <button
                            key={font}
                            onClick={() => {
                              updateChart({
                                events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, font } } : ev)
                              });
                            }}
                            className={`px-2 py-2 rounded border text-xs transition-all ${
                              event.value.font === font 
                                ? 'bg-cyan-500/20 border-cyan-500 text-white' 
                                : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:border-zinc-700'
                            }`}
                            style={{ fontFamily: font }}
                          >
                            {font}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <div className="flex flex-col gap-2 flex-1">
                        <label className="text-xs text-zinc-400">Mode</label>
                        <select 
                          value={event.value.mode || 'fade_in'}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, mode: e.target.value } } : ev)
                            });
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        >
                          <option value="fade_in">Fade In</option>
                          <option value="fade_out">Fade Out</option>
                        </select>
                      </div>
                      <div className="flex flex-col gap-2 flex-1">
                        <label className="text-xs text-zinc-400">Duration (steps)</label>
                        <input 
                          type="number" 
                          value={event.value.duration || 0}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, duration: parseFloat(e.target.value) || 0 } } : ev)
                            });
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <div className="flex flex-col gap-2 flex-1">
                        <label className="text-xs text-zinc-400">Target Opacity (0-1)</label>
                        <input 
                          type="number" 
                          step="0.1"
                          min="0"
                          max="1"
                          value={event.value.targetOpacity || 0}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, targetOpacity: parseFloat(e.target.value) || 0 } } : ev)
                            });
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                      <div className="flex flex-col gap-2 flex-1">
                        <label className="text-xs text-zinc-400">Color</label>
                        <input 
                          type="color" 
                          value={event.value.color || '#ffffff'}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, color: e.target.value } } : ev)
                            });
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded px-1 py-0.5 h-7 w-full cursor-pointer"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <div className="flex flex-col gap-2 flex-1">
                        <label className="text-xs text-zinc-400">X (0-1)</label>
                        <input 
                          type="number" 
                          step="0.01"
                          value={event.value.x || 0}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, x: parseFloat(e.target.value) || 0 } } : ev)
                            });
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                      <div className="flex flex-col gap-2 flex-1">
                        <label className="text-xs text-zinc-400">Y (0-1)</label>
                        <input 
                          type="number" 
                          step="0.01"
                          value={event.value.y || 0}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, y: parseFloat(e.target.value) || 0 } } : ev)
                            });
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                    </div>
                    <div className="mt-4 p-4 bg-zinc-950 border border-zinc-800 rounded-xl flex items-center justify-center min-h-[60px]">
                      <span style={{ 
                        fontFamily: event.value.font, 
                        color: event.value.color,
                        opacity: event.value.targetOpacity,
                        fontSize: '1.25rem'
                      }}>
                        {event.value.text}
                      </span>
                    </div>
                  </>
                )}

                {event.type === 'scroll_speed' && (
                  <div className="flex flex-col gap-2">
                    <label className="text-xs text-zinc-400">Scroll Speed Multiplier</label>
                    <div className="flex items-center gap-3">
                      <input 
                        type="range" 
                        min="0.1" 
                        max="5" 
                        step="0.1"
                        value={event.value.speed || 1}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, speed: parseFloat(e.target.value) || 1 } } : ev)
                          });
                        }}
                        className="flex-1 accent-cyan-500"
                      />
                      <input 
                        type="number" 
                        step="0.1"
                        value={event.value.speed || 1}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, speed: parseFloat(e.target.value) || 1 } } : ev)
                          });
                        }}
                        className="w-16 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                    <p className="text-[10px] text-zinc-500 italic">
                      * This changes the visual scroll speed in playtest. 1.0 is default.
                    </p>
                  </div>
                )}
              </div>
            );
          })() : (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-600 text-center">
              <Zap className="w-8 h-8 mb-2 opacity-20" />
              <p className="text-xs">Select a trigger marker to edit its properties.</p>
            </div>
          )}
        </div>
      </div>

      {/* Add Event Menu Modal */}
      <AnimatePresence>
        {showEventMenu && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40"
              onClick={() => setShowEventMenu(null)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed z-50 w-96 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl flex flex-col overflow-hidden"
              style={{ 
                top: Math.min(showEventMenu.y, window.innerHeight - 450), 
                left: 100,
                maxHeight: '400px'
              }}
            >
              <div className="px-3 py-2 border-b border-zinc-800 bg-zinc-950 flex-shrink-0">
                <span className="text-xs font-bold text-zinc-400">Add Trigger at Step {showEventMenu.step}</span>
              </div>
              <div className="flex divide-x divide-zinc-800 overflow-y-auto custom-scrollbar">
                <div className="flex flex-col py-1 flex-1">
                  <button onClick={() => handleAddEvent(showEventMenu.step, 'move')} className="px-4 py-2 text-sm text-left hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors">Move (Modchart)</button>
                  <button onClick={() => handleAddEvent(showEventMenu.step, 'bpm_change')} className="px-4 py-2 text-sm text-left hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors">BPM Change</button>
                  <button onClick={() => handleAddEvent(showEventMenu.step, 'character_swap')} className="px-4 py-2 text-sm text-left hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors">Character Swap</button>
                  <button onClick={() => handleAddEvent(showEventMenu.step, 'loop')} className="px-4 py-2 text-sm text-left hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors">Loop</button>
                  <button onClick={() => handleAddEvent(showEventMenu.step, 'stop_loop')} className="px-4 py-2 text-sm text-left hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors">Stop Loop</button>
                  <div className="h-px bg-zinc-800 my-1" />
                  <button onClick={() => handleAddEvent(showEventMenu.step, 'camera_shake')} className="px-4 py-2 text-sm text-left hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors">Camera Shake</button>
                  <button onClick={() => handleAddEvent(showEventMenu.step, 'camera_zoom')} className="px-4 py-2 text-sm text-left hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors">Camera Zoom</button>
                  <button onClick={() => handleAddEvent(showEventMenu.step, 'camera_offset')} className="px-4 py-2 text-sm text-left hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors">Camera Offset</button>
                  <button onClick={() => handleAddEvent(showEventMenu.step, 'custom_effect')} className="px-4 py-2 text-sm text-left hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors">Custom Effect</button>
                  <button onClick={() => handleAddEvent(showEventMenu.step, 'fade')} className="px-4 py-2 text-sm text-left hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors">Screen Fade</button>
                  <button onClick={() => handleAddEvent(showEventMenu.step, 'flash')} className="px-4 py-2 text-sm text-left hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors">Screen Flash</button>
                  <button onClick={() => handleAddEvent(showEventMenu.step, 'start_point')} className="px-4 py-2 text-sm text-left hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors">Start Point</button>
                </div>
                <div className="flex flex-col py-1 flex-1">
                  <button onClick={() => handleAddEvent(showEventMenu.step, 'modchart')} className="px-4 py-2 text-sm text-left hover:bg-zinc-800 text-cyan-400 hover:text-cyan-300 font-bold transition-colors">Modchart System</button>
                  <button onClick={() => handleAddEvent(showEventMenu.step, 'rotate')} className="px-4 py-2 text-sm text-left hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors">Rotate</button>
                  <div className="h-px bg-zinc-800 my-1" />
                  <button onClick={() => handleAddEvent(showEventMenu.step, 'shader', { shaderType: 'glitch', intensity: 1, duration: 4, mode: 'instant' })} className="px-4 py-2 text-sm text-left hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors">Shader: Glitch</button>
                  <button onClick={() => handleAddEvent(showEventMenu.step, 'shader', { shaderType: 'chromatic_glitch', intensity: 1, duration: 4, mode: 'instant', speed: 1, noise: 0.5 })} className="px-4 py-2 text-sm text-left hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors">Shader: Chromatic</button>
                  <button onClick={() => handleAddEvent(showEventMenu.step, 'shader', { shaderType: 'lens_circle', intensity: 1, duration: 4, mode: 'instant', offsetX: 0, offsetY: 0, opacity: 1 })} className="px-4 py-2 text-sm text-left hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors">Shader: Lens</button>
                  <button onClick={() => handleAddEvent(showEventMenu.step, 'shader', { shaderType: 'hue', intensity: 1, duration: 4, mode: 'instant' })} className="px-4 py-2 text-sm text-left hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors">Shader: HUE</button>
                  <button onClick={() => handleAddEvent(showEventMenu.step, 'shader', { shaderType: 'gray_scale', intensity: 1, duration: 4, mode: 'instant' })} className="px-4 py-2 text-sm text-left hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors">Shader: Gray</button>
                  <button onClick={() => handleAddEvent(showEventMenu.step, 'opacity')} className="px-4 py-2 text-sm text-left hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors">Opacity Trigger</button>
                  <button onClick={() => handleAddEvent(showEventMenu.step, 'add_text')} className="px-4 py-2 text-sm text-left hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors">Add Text</button>
                  <button onClick={() => handleAddEvent(showEventMenu.step, 'scroll_speed')} className="px-4 py-2 text-sm text-left hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors">Scroll Speed</button>
                  <button onClick={() => handleAddEvent(showEventMenu.step, 'background_swap')} className="px-4 py-2 text-sm text-left hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors">Background Swap</button>
                  <button onClick={() => handleAddEvent(showEventMenu.step, 'character_edit')} className="px-4 py-2 text-sm text-left hover:bg-zinc-800 text-cyan-400 hover:text-cyan-300 font-bold transition-colors">Character Edit</button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

// --- Tab 4: Event Trigger ---
const EventTrigger: React.FC<{ stage: SavedStage; setStage: (s: SavedStage) => void }> = ({ stage, setStage }) => {
  const [showAIGenerator, setShowAIGenerator] = useState(false);

  const updateChart = (updates: Partial<ChartData>) => {
    setStage(prev => ({ ...prev, chart: { ...prev.chart, ...updates } }));
  };

  const addEvent = (type: string, initialValue?: any) => {
    let currentEvents = (stage.chart?.events || []).slice();
    if (type === 'start_point') {
      currentEvents = currentEvents.filter(ev => ev.type !== 'start_point');
    }
    const newEvent: ChartEvent = {
      id: crypto.randomUUID(),
      step: 0,
      type,
      value: initialValue || getDefaultEventValue(type),
    };
    updateChart({ events: currentEvents.concat([newEvent]) });
  };

  const getDefaultEventValue = (type: string) => {
    switch (type) {
      case 'modchart': return { type: 'sway', target: 'all', lanes: [], duration: 16, speed: 1, intensity: 1, value: { x: 0, y: 0 }, repeat: 0, delay: 0, fadeOut: 0, easing: 'linear' };
      case 'move': return { target: 'player', movementType: 'instant', duration: 0, x: 0, y: 0, lanes: [] };
      case 'bpm_change': return { bpm: stage.chart.bpm };
      case 'character_swap': return { target: 'player', characterId: '', resetAnimation: '', isExtra: false };
      case 'loop': return { target: 'player', count: 1, interval: 4, events: [] };
      case 'stop_loop': return { target: 'player' };
      case 'camera_shake': return { intensity: 10, duration: 4 };
      case 'camera_offset': return { focus: 'player', type: 'timed', duration: 4, x: 0, y: 0, zoom: 1.2 };
      case 'custom_effect': return { effectType: 'fire', mode: 'fade_in', duration: 4, intensity: 1 };
      case 'camera_zoom': return { zoom: 1.2, duration: 4 };
      case 'fade': return { type: 'fade_in', duration: 4, color: '#000000' };
      case 'flash': return { intensity: 1, fadeIn: 0, hold: 0, fadeOut: 4, rainbow: false };
      case 'start_point': return { enabled: true };
      case 'rotate': return { target: 'all', rotations: 1, duration: 4, lanes: [], isRelative: false, rotationMode: 'self', orbitRadius: 100 };
      case 'shader': return { shaderType: 'glitch', intensity: 1, duration: 4, mode: 'instant', opacity: 1 };
      case 'opacity': return { target: 'all', opacity: 1, duration: 4, mode: 'fade' };
      case 'add_text': return { text: 'New Text', font: 'Inter', mode: 'fade_in', duration: 4, targetOpacity: 1, color: '#ffffff', x: 0.5, y: 0.5 };
      case 'scroll_speed': return { speed: 1 };
      case 'background_swap': return { swapTo: 'toggle' };
      case 'character_edit': return { target: 'player', movementType: 'instant', duration: 4, x: 0, y: 0, scale: 1, opacity: 1, easing: 'linear', relative: false };
      default: return {};
    }
  };

  const clearStartPoints = () => {
    updateChart({ events: stage.chart.events.filter(ev => ev.type !== 'start_point') });
  };

  const hasStartPoints = stage.chart.events.some(ev => ev.type === 'start_point');

  return (
    <div className="h-full flex">
      <div className="w-80 bg-zinc-900/50 backdrop-blur-xl border-r border-white/5 p-6 flex flex-col gap-6 shadow-2xl shadow-black/50">
        <label className="text-xs font-black uppercase tracking-widest text-zinc-500">AI Assistance</label>
        <button 
          onClick={() => setShowAIGenerator(true)}
          className="flex items-center gap-3 px-4 py-4 bg-indigo-600 border border-indigo-500 rounded-xl transition-all text-xs font-black uppercase tracking-widest text-white hover:bg-indigo-500 shadow-[0_0_20px_rgba(79,70,229,0.3)] group"
        >
          <Sparkles className="w-5 h-5 text-white animate-pulse group-hover:scale-110 transition-transform" />
          AI Trigger Generator
        </button>

        <label className="text-xs font-black uppercase tracking-widest text-zinc-500">Add Event</label>
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 -mr-2">
          <div className="grid grid-cols-2 gap-2">
            {['Camera Offset', 'Custom Effect', 'Camera Zoom', 'Flash Screen', 'Change Character', 'Character Edit', 'Play Animation', 'start_point', 'Rotate', 'Shader: Glitch', 'Shader: Chromatic', 'Shader: Lens', 'Shader: HUE', 'Shader: Gray', 'Add Text', 'Scroll Speed', 'Background Swap'].map(type => (
              <button 
                key={type}
                onClick={() => {
                  if (type === 'Rotate') addEvent('rotate');
                  else if (type === 'Camera Offset') addEvent('camera_offset');
                  else if (type === 'Custom Effect') addEvent('custom_effect');
                  else if (type === 'Camera Zoom') addEvent('camera_zoom');
                  else if (type === 'Flash Screen') addEvent('flash');
                  else if (type === 'Change Character') addEvent('character_swap');
                  else if (type === 'Character Edit') addEvent('character_edit');
                  else if (type === 'Shader: Glitch') addEvent('shader', { shaderType: 'glitch', intensity: 1, duration: 4, mode: 'instant' });
                  else if (type === 'Shader: Chromatic') addEvent('shader', { shaderType: 'chromatic_glitch', intensity: 1, duration: 4, mode: 'instant', speed: 1, noise: 0.5 });
                  else if (type === 'Shader: Lens') addEvent('shader', { shaderType: 'lens_circle', intensity: 1, duration: 4, mode: 'instant', offsetX: 0, offsetY: 0 });
                  else if (type === 'Shader: HUE') addEvent('shader', { shaderType: 'hue', intensity: 1, duration: 4, mode: 'instant' });
                  else if (type === 'Shader: Gray') addEvent('shader', { shaderType: 'gray_scale', intensity: 1, duration: 4, mode: 'instant' });
                  else if (type === 'Add Text') addEvent('add_text');
                  else if (type === 'Scroll Speed') addEvent('scroll_speed');
                  else if (type === 'Background Swap') addEvent('background_swap');
                  else addEvent(type.toLowerCase().replace(' ', '_'));
                }}
                className={`flex items-center gap-3 px-4 py-3 bg-zinc-950 border border-zinc-800 rounded-xl transition-all text-[10px] font-bold ${
                  type === 'start_point' 
                    ? 'hover:border-amber-500 text-amber-400' 
                    : 'hover:border-cyan-500 text-zinc-300'
                }`}
              >
                <Zap className={`w-4 h-4 ${type === 'start_point' ? 'text-amber-400' : 'text-cyan-400'}`} />
                {type === 'start_point' ? 'Start Point' : type}
              </button>
            ))}
          </div>
        </div>

        {hasStartPoints && (
          <button 
            onClick={clearStartPoints}
            className="mt-auto flex items-center justify-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl hover:bg-red-500/20 transition-all text-xs font-black uppercase tracking-widest"
          >
            <Trash2 className="w-4 h-4" />
            Delete start point
          </button>
        )}
      </div>

      <div className="flex-1 bg-zinc-950 p-8 overflow-y-auto custom-scrollbar">
        <div className="max-w-2xl mx-auto space-y-4">
          <h2 className="text-xl font-black uppercase tracking-tight mb-8">Event Timeline</h2>
          {(stage.chart?.events?.length || 0) === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-zinc-600">
              <Zap className="w-12 h-12 mb-4 opacity-10" />
              <p>No events added to this chart yet.</p>
            </div>
          ) : (
            (stage.chart?.events || []).sort((a, b) => a.step - b.step).map((event) => (
              <div key={event.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 flex items-center justify-between group">
                <div className="flex items-center gap-6">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black text-zinc-500 uppercase">Step</span>
                    <input 
                      type="number" 
                      value={Number.isNaN(event.step) ? '' : event.step} 
                      onChange={(e) => {
                        const newEvents = (stage.chart?.events || []).map(ev => ev.id === event.id ? { ...ev, step: parseInt(e.target.value) || 0 } : ev);
                        updateChart({ events: newEvents });
                      }}
                      className="w-16 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs font-mono"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black text-zinc-500 uppercase">Type</span>
                    <span className="text-sm font-bold text-cyan-400">{event.type}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black text-zinc-500 uppercase">Value</span>
                    <input 
                      type="text" 
                      value={typeof event.value === 'object' ? JSON.stringify(event.value) : (event.value || '')} 
                      onChange={(e) => {
                        const newEvents = (stage.chart?.events || []).map(ev => ev.id === event.id ? { ...ev, value: e.target.value } : ev);
                        updateChart({ events: newEvents });
                      }}
                      className="bg-zinc-950 border border-zinc-800 rounded px-3 py-1 text-xs w-32"
                    />
                  </div>
                </div>

                {event.type === 'camera_offset' && (
                  <div className="flex flex-col gap-3 w-full max-w-md ml-4">
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <label className="text-[10px] font-black text-zinc-500 uppercase block mb-1">Focus</label>
                        <select 
                          value={event.value.focus || 'player'}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, focus: e.target.value } } : ev)
                            });
                          }}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        >
                          <option value="player">Player</option>
                          <option value="opponent">Opponent</option>
                        </select>
                      </div>
                      <div className="flex-1">
                        <label className="text-[10px] font-black text-zinc-500 uppercase block mb-1">Transition</label>
                        <select 
                          value={event.value.type || 'timed'}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, type: e.target.value } } : ev)
                            });
                          }}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        >
                          <option value="instant">Instant</option>
                          <option value="timed">Timed</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[10px] font-black text-zinc-500 uppercase block mb-1">X Offset</label>
                        <input 
                          type="number" 
                          value={event.value.x || 0}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, x: parseFloat(e.target.value) || 0 } } : ev)
                            });
                          }}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-zinc-500 uppercase block mb-1">Y Offset</label>
                        <input 
                          type="number" 
                          value={event.value.y || 0}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, y: parseFloat(e.target.value) || 0 } } : ev)
                            });
                          }}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-zinc-500 uppercase block mb-1">Zoom</label>
                        <input 
                          type="number" 
                          step="0.1"
                          value={event.value.zoom || 1.2}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, zoom: parseFloat(e.target.value) || 1.2 } } : ev)
                            });
                          }}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                    </div>
                    {event.value.type === 'timed' && (
                      <div>
                        <label className="text-[10px] font-black text-zinc-500 uppercase block mb-1">Duration (Steps)</label>
                        <input 
                          type="number" 
                          value={event.value.duration || 4}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, duration: parseInt(e.target.value) || 0 } } : ev)
                            });
                          }}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                    )}
                  </div>
                )}

                {event.type === 'custom_effect' && (
                  <div className="flex flex-col gap-3 w-full max-w-md ml-4">
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <label className="text-[10px] font-black text-zinc-500 uppercase block mb-1">Effect</label>
                        <select 
                          value={event.value.effectType || 'fire'}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, effectType: e.target.value } } : ev)
                            });
                          }}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        >
                          <option value="fire">Fire</option>
                          <option value="lightning">Lightning</option>
                          <option value="frost">Frost</option>
                          <option value="rain">Rain</option>
                          <option value="invert">Invert</option>
                        </select>
                      </div>
                      <div className="flex-1">
                        <label className="text-[10px] font-black text-zinc-500 uppercase block mb-1">Mode</label>
                        <select 
                          value={event.value.mode || 'fade_in'}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, mode: e.target.value } } : ev)
                            });
                          }}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        >
                          <option value="fade_in">Fade In</option>
                          <option value="fade_out">Fade Out</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-black text-zinc-500 uppercase block mb-1">Duration (Steps)</label>
                        <input 
                          type="number" 
                          value={event.value.duration || 4}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, duration: parseInt(e.target.value) || 0 } } : ev)
                            });
                          }}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-zinc-500 uppercase block mb-1">Intensity</label>
                        <input 
                          type="number" 
                          step="0.1"
                          value={event.value.intensity || 1}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, intensity: parseFloat(e.target.value) || 1 } } : ev)
                            });
                          }}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {event.type === 'scroll_speed' && (
                  <div className="flex flex-col gap-2">
                    <label className="text-xs text-zinc-400">Scroll Speed Multiplier</label>
                    <div className="flex items-center gap-3">
                      <input 
                        type="range" 
                        min="0.1" 
                        max="5" 
                        step="0.1"
                        value={event.value.speed || 1}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, speed: parseFloat(e.target.value) || 1 } } : ev)
                          });
                        }}
                        className="flex-1 accent-cyan-500"
                      />
                      <input 
                        type="number" 
                        step="0.1"
                        value={event.value.speed || 1}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, speed: parseFloat(e.target.value) || 1 } } : ev)
                          });
                        }}
                        className="w-16 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                    <p className="text-[10px] text-zinc-500 italic">
                      * This changes the visual scroll speed in playtest. 1.0 is default.
                    </p>
                  </div>
                )}

                {event.type === 'background_swap' && (
                  <div className="flex flex-col gap-2">
                    <label className="text-xs text-zinc-400">Swap To</label>
                    <div className="flex bg-zinc-950 p-1 rounded-lg border border-zinc-800">
                      {['primary', 'secondary', 'toggle'].map(mode => (
                        <button 
                          key={mode}
                          onClick={() => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, swapTo: mode } } : ev)
                            });
                          }}
                          className={`flex-1 py-1 px-3 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${event.value.swapTo === mode ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/20' : 'text-zinc-500 hover:text-zinc-300'}`}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {event.type === 'character_edit' && (
                  <div className="flex flex-col gap-3 w-full max-w-md ml-4">
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <label className="text-[10px] font-black text-zinc-500 uppercase block mb-1">Target</label>
                        <select 
                          value={event.value.target || 'player'}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, target: e.target.value } } : ev)
                            });
                          }}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        >
                          <option value="player">Player</option>
                          <option value="opponent">Opponent</option>
                          <option value="both">Both</option>
                          <option value="extra">Extra</option>
                        </select>
                      </div>
                      {event.value.target === 'extra' && (
                        <div className="flex-1">
                          <label className="text-[10px] font-black text-zinc-500 uppercase block mb-1">Extra ID</label>
                          <input 
                            type="text" 
                            value={event.value.characterId || ''}
                            onChange={(e) => {
                              updateChart({
                                events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, characterId: e.target.value } } : ev)
                              });
                            }}
                            placeholder="ID"
                            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                          />
                        </div>
                      )}
                      <div className="flex-1">
                        <label className="text-[10px] font-black text-zinc-500 uppercase block mb-1">Type</label>
                        <select 
                          value={event.value.movementType || 'instant'}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, movementType: e.target.value } } : ev)
                            });
                          }}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        >
                          <option value="instant">Instant</option>
                          <option value="timed">Timed</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <div>
                        <label className="text-[10px] font-black text-zinc-500 uppercase block mb-1">X</label>
                        <input 
                          type="number" 
                          value={event.value.x || 0}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, x: parseFloat(e.target.value) || 0 } } : ev)
                            });
                          }}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-zinc-500 uppercase block mb-1">Y</label>
                        <input 
                          type="number" 
                          value={event.value.y || 0}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, y: parseFloat(e.target.value) || 0 } } : ev)
                            });
                          }}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-zinc-500 uppercase block mb-1">Scale</label>
                        <input 
                          type="number" 
                          step="0.1"
                          value={event.value.scale || 1}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, scale: parseFloat(e.target.value) || 1 } } : ev)
                            });
                          }}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-zinc-500 uppercase block mb-1">Alpha</label>
                        <input 
                          type="number" 
                          step="0.1"
                          min="0"
                          max="1"
                          value={event.value.opacity === undefined ? 1 : event.value.opacity}
                          onChange={(e) => {
                            updateChart({
                              events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, opacity: parseFloat(e.target.value) || 0 } } : ev)
                            });
                          }}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                        />
                      </div>
                    </div>
                    {event.value.movementType === 'timed' && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-black text-zinc-500 uppercase block mb-1">Dur</label>
                          <input 
                            type="number" 
                            value={event.value.duration || 4}
                            onChange={(e) => {
                              updateChart({
                                events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, duration: parseInt(e.target.value) || 0 } } : ev)
                              });
                            }}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-black text-zinc-500 uppercase block mb-1">Ease</label>
                          <select 
                            value={event.value.easing || 'linear'}
                            onChange={(e) => {
                              updateChart({
                                events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, easing: e.target.value } } : ev)
                              });
                            }}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
                          >
                            <option value="linear">Linear</option>
                            <option value="easeIn">Ease In</option>
                            <option value="easeOut">Ease Out</option>
                            <option value="easeInOut">Ease In Out</option>
                          </select>
                        </div>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <input 
                        type="checkbox" 
                        id={`rel-list-${event.id}`}
                        checked={event.value.relative || false}
                        onChange={(e) => {
                          updateChart({
                            events: stage.chart.events.map(ev => ev.id === event.id ? { ...ev, value: { ...ev.value, relative: e.target.checked } } : ev)
                          });
                        }}
                        className="w-3 h-3 rounded border-zinc-800 bg-zinc-950 text-cyan-500 focus:ring-cyan-500"
                      />
                      <label htmlFor={`rel-list-${event.id}`} className="text-[10px] text-zinc-500 font-bold uppercase cursor-pointer">
                        Relative
                      </label>
                    </div>
                  </div>
                )}

                <button 
                  onClick={() => updateChart({ events: (stage.chart?.events || []).filter(ev => ev.id !== event.id) })}
                  className="p-2 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {showAIGenerator && (
        <AITriggerGenerator 
          stage={stage}
          onUpdate={(newEvents) => {
            updateChart({ events: newEvents });
          }}
          onClose={() => setShowAIGenerator(false)}
        />
      )}
    </div>
  );
};

// --- Tab 5: Playtest ---
const PlaytestTab: React.FC<{ 
  stage: SavedStage; 
  playbackRate: number;
  setPlaybackRate: (rate: number) => void;
  onPlaytest: (s: SavedStage) => void;
  settings: any;
  setSettings: React.Dispatch<React.SetStateAction<any>>;
}> = ({ stage, playbackRate, setPlaybackRate, onPlaytest, settings, setSettings }) => {
  return (
    <div className="h-full flex flex-col items-center justify-center bg-zinc-950 p-12 text-center overflow-y-auto">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-24 h-24 bg-gradient-to-br from-pink-500 to-cyan-500 rounded-3xl flex items-center justify-center shadow-2xl shadow-pink-500/20 mb-8"
      >
        <Play className="w-12 h-12 text-white fill-current" />
      </motion.div>
      
      <h2 className="text-4xl font-black uppercase tracking-tight mb-4">Ready to Test?</h2>
      <p className="text-zinc-400 max-w-md mb-12 text-sm">
        You are about to enter playtest mode for <span className="text-white font-bold">"{stage.name}"</span>. 
        Press <kbd className="px-2 py-1 bg-zinc-800 rounded text-xs font-mono mx-1">ESC</kbd> at any time to return to the editor.
      </p>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-2xl">
        <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-6 text-left backdrop-blur-sm">
          <span className="text-[10px] font-black text-zinc-500 uppercase block mb-4 tracking-widest">Track Info</span>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between items-center border-b border-zinc-800/50 pb-2">
              <span className="text-zinc-400">Notes</span>
              <span className="text-white font-black">{stage.chart?.notes?.length || 0}</span>
            </div>
            <div className="flex justify-between items-center border-b border-zinc-800/50 pb-2">
              <span className="text-zinc-400">Events</span>
              <span className="text-white font-black">{stage.chart?.events?.length || 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-zinc-400">BPM</span>
              <span className="text-white font-black">{stage.chart?.bpm || 0}</span>
            </div>
          </div>
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-6 text-left backdrop-blur-sm">
          <div className="flex justify-between items-center mb-4">
            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Playback Speed</span>
            <span className="px-2 py-0.5 bg-pink-500 text-white text-[10px] font-black rounded uppercase">{playbackRate.toFixed(2)}x</span>
          </div>
          
          <input 
            type="range"
            min="0.25"
            max="2.0"
            step="0.05"
            value={playbackRate}
            onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
            className="w-full accent-pink-500 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer mb-2"
          />
          
          <div className="flex justify-between text-[8px] font-black text-zinc-600 uppercase tracking-widest">
            <span>Slower</span>
            <button onClick={() => setPlaybackRate(1)} className="hover:text-white transition-colors">Reset (1.0x)</button>
            <span>Faster</span>
          </div>

          <div className="mt-6 flex gap-2">
            {[0.5, 0.75, 1.0, 1.25, 1.5].map(rate => (
              <button
                key={rate}
                onClick={() => setPlaybackRate(rate)}
                className={`flex-1 py-1 rounded-lg text-[10px] font-black transition-all ${playbackRate === rate ? 'bg-white text-black' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
              >
                {rate}x
              </button>
            ))}
          </div>
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-6 text-left backdrop-blur-sm md:col-span-2">
          <span className="text-[10px] font-black text-zinc-500 uppercase block mb-4 tracking-widest">Practice Settings</span>
          <div className="grid grid-cols-2 gap-4">
            <button 
              onClick={() => setSettings({ ...settings, practiceMode: !settings.practiceMode })}
              className={`flex items-center justify-between p-4 rounded-xl border transition-all ${settings.practiceMode ? 'bg-cyan-500/10 border-cyan-500/50 text-cyan-400' : 'bg-zinc-800/30 border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}
            >
              <div className="flex items-center gap-3">
                <Zap className={`w-5 h-5 ${settings.practiceMode ? 'fill-current' : ''}`} />
                <div className="text-left">
                  <p className="text-xs font-black uppercase tracking-widest">Practice Mode</p>
                  <p className="text-[9px] opacity-60 font-bold">No Game Over</p>
                </div>
              </div>
              <div className={`w-8 h-4 rounded-full relative transition-colors ${settings.practiceMode ? 'bg-cyan-500' : 'bg-zinc-700'}`}>
                <div className={`absolute top-1 w-2 h-2 bg-white rounded-full transition-all ${settings.practiceMode ? 'left-5' : 'left-1'}`} />
              </div>
            </button>

            <button 
              onClick={() => setSettings({ ...settings, botplay: !settings.botplay })}
              className={`flex items-center justify-between p-4 rounded-xl border transition-all ${settings.botplay ? 'bg-pink-500/10 border-pink-500/50 text-pink-400' : 'bg-zinc-800/30 border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}
            >
              <div className="flex items-center gap-3">
                <Sparkles className={`w-5 h-5 ${settings.botplay ? 'fill-current' : ''}`} />
                <div className="text-left">
                  <p className="text-xs font-black uppercase tracking-widest">Botplay</p>
                  <p className="text-[9px] opacity-60 font-bold">Auto-Hit Notes</p>
                </div>
              </div>
              <div className={`w-8 h-4 rounded-full relative transition-colors ${settings.botplay ? 'bg-pink-500' : 'bg-zinc-700'}`}>
                <div className={`absolute top-1 w-2 h-2 bg-white rounded-full transition-all ${settings.botplay ? 'left-5' : 'left-1'}`} />
              </div>
            </button>
          </div>
        </div>
      </div>

      <button 
        onClick={() => onPlaytest(stage)}
        className="mt-12 px-16 py-5 bg-white text-black rounded-2xl font-black text-xl hover:bg-zinc-200 transition-all active:scale-95 shadow-2xl shadow-white/10 flex items-center gap-4 group"
      >
        <Play className="w-6 h-6 fill-current group-hover:scale-110 transition-transform" />
        START PLAYTEST
      </button>
    </div>
  );
};
