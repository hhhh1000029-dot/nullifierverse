import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, Trash2, Image as ImageIcon, Music, User, MessageSquare, 
  ChevronRight, ChevronLeft, Play, Save, Undo2, Redo2, 
  Sparkles, Loader2, Settings, Layers, Type, Palette, 
  Search, Upload, X, Check, AlertCircle, Layout, Share2,
  Maximize, Minimize, RefreshCw, Archive, FileText
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type as GenAIType } from "@google/genai";
import { ArchiveImportModal, ArchiveBackgroundImportModal } from './ArchiveModals';
import { 
  VNProject, VNScene, VNAsset, VNChoice, 
  VNCharacterState, VNDialogueStyle, SavedWeek, VNCharacter,
  ArchiveCharacter, ArchiveBackground
} from './EditorTypes';

interface VNEditorProps {
  week: SavedWeek;
  setWeek: (w: SavedWeek) => void;
  onBack: () => void;
  onSave?: () => void;
  onStartAIParseScript?: (weekId: string, scriptText: string, clearExisting: boolean) => void;
}

const DEFAULT_STYLE: VNDialogueStyle = {
  id: 'default',
  name: 'Default Style',
  backgroundColor: 'rgba(0, 0, 0, 0.8)',
  borderRadius: '12px',
  borderWidth: '2px',
  borderColor: '#ec4899',
  boxShadow: '0 0 20px rgba(236, 72, 153, 0.3)',
  fontColor: '#ffffff',
  fontSize: '18px',
  fontFamily: 'Inter, sans-serif',
  nameTagStyle: {
    backgroundColor: '#ec4899',
    fontColor: '#ffffff',
    borderRadius: '4px 4px 0 0',
    padding: '4px 12px'
  }
};

const VNEditor: React.FC<VNEditorProps> = ({ week, setWeek, onBack, onSave, onStartAIParseScript }) => {
  const [activeTab, setActiveTab] = useState<'scenes' | 'characters' | 'assets' | 'styles' | 'ai'>('scenes');
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [selectedSceneIds, setSelectedSceneIds] = useState<string[]>([]);
  const [isAreaSelectMode, setIsAreaSelectMode] = useState(false);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [showAssetPicker, setShowAssetPicker] = useState<{ type: VNAsset['type'], onSelect: (assetId: string) => void } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewSceneIndex, setPreviewSceneIndex] = useState(0);
  const [previewDialogueIndex, setPreviewDialogueIndex] = useState(0);
  const [history, setHistory] = useState<VNProject[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);
  const [showArchiveImport, setShowArchiveImport] = useState(false);
  const [showArchiveBgImport, setShowArchiveBgImport] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }
      
      // Tab switching shortcuts (Alt + 1-5)
      if (e.altKey) {
        if (e.key === '1') setActiveTab('scenes');
        else if (e.key === '2') setActiveTab('characters');
        else if (e.key === '3') setActiveTab('assets');
        else if (e.key === '4') setActiveTab('styles');
        else if (e.key === '5') setActiveTab('ai');
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
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState(false);
  const [thumbnailPrompt, setThumbnailPrompt] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [scriptText, setScriptText] = useState('');
  const [isStartingAI, setIsStartingAI] = useState(false);
  const isParsingScript = isStartingAI || week.vnData?.parsingStatus?.isParsing || false;
  const parsingProgress = week.vnData?.parsingStatus || { progress: 0, total: 0 };
  const [clearExistingScript, setClearExistingScript] = useState(false);
  const [isAIGenerating, setIsAIGenerating] = useState(false);
  const [aiStylePrompt, setAiStylePrompt] = useState('');
  const [isGeneratingStyle, setIsGeneratingStyle] = useState(false);
  const [aiBackgroundPrompt, setAiBackgroundPrompt] = useState('');
  const [isGeneratingBackground, setIsGeneratingBackground] = useState(false);
  const [aiPreview, setAiPreview] = useState<VNScene[] | null>(null);
  const [selectedCharStateId, setSelectedCharStateId] = useState<string | null>(null);

  const handleAIGenerateBackground = async () => {
    if (!aiBackgroundPrompt.trim() || !process.env.GEMINI_API_KEY) return;
    setIsGeneratingBackground(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [{ text: `A background for a visual novel: ${aiBackgroundPrompt}. Anime style, high quality, 16:9 aspect ratio.` }],
        },
      });

      let imageUrl = '';
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          imageUrl = `data:image/png;base64,${part.inlineData.data}`;
          break;
        }
      }

      if (imageUrl) {
        const newAsset: VNAsset = {
          id: Math.random().toString(36).substr(2, 9),
          name: `AI BG: ${aiBackgroundPrompt.slice(0, 20)}...`,
          type: 'background',
          url: imageUrl
        };
        updateVN(vn => {
          vn.assets.push(newAsset);
          return vn;
        });
        setAiBackgroundPrompt('');
      }
    } catch (error) {
      console.error('Error generating background:', error);
    } finally {
      setIsGeneratingBackground(false);
    }
  };

  const handleAIGenerateStyle = async (styleId?: string) => {
    const targetStyleId = typeof styleId === 'string' ? styleId : (aiStylePrompt ? 'new' : null);
    if (!targetStyleId || !process.env.GEMINI_API_KEY) return;
    
    setIsGeneratingStyle(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = aiStylePrompt || (typeof styleId === 'string' ? week.vnData?.styles.find(s => s.id === styleId)?.aiDescription : '');
      
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Generate a visual novel dialogue box style based on this description: "${prompt}".
        Return the style as a JSON object with these properties:
        - backgroundColor: string (RGBA or Hex)
        - borderRadius: string (e.g., "12px")
        - borderWidth: string (e.g., "2px")
        - borderColor: string (Hex)
        - boxShadow: string (CSS box-shadow)
        - fontColor: string (Hex)
        - fontSize: string (e.g., "18px")
        - fontFamily: string (e.g., "Inter, sans-serif" or "Playfair Display, serif")
        - nameTagBackgroundColor: string (Hex)
        - nameTagFontColor: string (Hex)
        `,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: GenAIType.OBJECT,
            properties: {
              backgroundColor: { type: GenAIType.STRING },
              borderRadius: { type: GenAIType.STRING },
              borderWidth: { type: GenAIType.STRING },
              borderColor: { type: GenAIType.STRING },
              boxShadow: { type: GenAIType.STRING },
              fontColor: { type: GenAIType.STRING },
              fontSize: { type: GenAIType.STRING },
              fontFamily: { type: GenAIType.STRING },
              nameTagBackgroundColor: { type: GenAIType.STRING },
              nameTagFontColor: { type: GenAIType.STRING }
            }
          }
        }
      });

      const generated = JSON.parse(response.text);
      
      if (targetStyleId === 'new') {
        const newStyle: VNDialogueStyle = {
          id: Math.random().toString(36).substr(2, 9),
          name: `AI Style: ${aiStylePrompt.slice(0, 15)}...`,
          backgroundColor: generated.backgroundColor,
          borderRadius: generated.borderRadius,
          borderWidth: generated.borderWidth,
          borderColor: generated.borderColor,
          boxShadow: generated.boxShadow,
          fontColor: generated.fontColor,
          fontSize: generated.fontSize,
          fontFamily: generated.fontFamily,
          nameTagStyle: {
            backgroundColor: generated.nameTagBackgroundColor,
            fontColor: generated.nameTagFontColor,
            borderRadius: '8px',
            padding: '4px 12px',
            syncWithBox: true
          }
        };
        updateVN(vn => {
          vn.styles.push(newStyle);
          return vn;
        });
        setAiStylePrompt('');
      } else {
        updateVN(vn => {
          const s = vn.styles.find(st => st.id === targetStyleId);
          if (s) {
            s.backgroundColor = generated.backgroundColor;
            s.borderRadius = generated.borderRadius;
            s.borderWidth = generated.borderWidth;
            s.borderColor = generated.borderColor;
            s.boxShadow = generated.boxShadow;
            s.fontColor = generated.fontColor;
            s.fontSize = generated.fontSize;
            s.fontFamily = generated.fontFamily;
            s.nameTagStyle.backgroundColor = generated.nameTagBackgroundColor;
            s.nameTagStyle.fontColor = generated.nameTagFontColor;
          }
          return vn;
        });
      }
    } catch (error) {
      console.error('Error generating style:', error);
    } finally {
      setIsGeneratingStyle(false);
    }
  };

  const handleDeleteAsset = (assetId: string) => {
    updateVN(vn => {
      vn.assets = vn.assets.filter(a => a.id !== assetId);
      // Also remove from scenes if used
      vn.scenes.forEach(scene => {
        if (scene.backgroundId === assetId) scene.backgroundId = '';
      });
      // Also remove from character expressions
      vn.characters.forEach(char => {
        char.expressions.forEach(exp => {
          if (exp.assetId === assetId) exp.assetId = '';
        });
      });
      return vn;
    });
  };

  const handleSetStartScene = (sceneId: string) => {
    updateVN(vn => {
      vn.startSceneId = sceneId;
      return vn;
    });
  };

  const handleAIGenerateThumbnail = async () => {
    if (!thumbnailPrompt.trim()) return;
    setIsGeneratingThumbnail(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [{ text: `A high-quality, vibrant game thumbnail for a visual novel called "${week.name}". Style: Anime / Digital Art. Description: ${thumbnailPrompt}` }],
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
          const url = `data:image/png;base64,${base64Data}`;
          setWeek({ ...week, thumbnail: url });
          break;
        }
      }
    } catch (error) {
      console.error('AI Thumbnail error:', error);
    } finally {
      setIsGeneratingThumbnail(false);
    }
  };

  // Initialize VN Data if not present
  useEffect(() => {
    if (!week.vnData) {
      const initialVN: VNProject = {
        id: week.id,
        name: week.name,
        scenes: [{
          id: 'scene-1',
          name: 'Intro Scene',
          dialogue: [],
          backgroundId: '',
          characters: [],
          nextSceneId: null
        }],
        assets: [],
        characters: [],
        styles: [DEFAULT_STYLE]
      };
      setWeek({ ...week, vnData: initialVN });
      addToHistory(initialVN);
    } else if (history.length === 0) {
      addToHistory(week.vnData);
    }
  }, []);

  const addToHistory = (project: VNProject) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(JSON.parse(JSON.stringify(project)));
    if (newHistory.length > 50) newHistory.shift();
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const undo = () => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1];
      setHistoryIndex(historyIndex - 1);
      setWeek({ ...week, vnData: JSON.parse(JSON.stringify(prev)) });
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      setHistoryIndex(historyIndex + 1);
      setWeek({ ...week, vnData: JSON.parse(JSON.stringify(next)) });
    }
  };

  const updateVN = (updater: (vn: VNProject) => VNProject) => {
    if (!week.vnData) return;
    const newVN = updater(JSON.parse(JSON.stringify(week.vnData)));
    setWeek({ ...week, vnData: newVN });
    addToHistory(newVN);
  };

  const handleAddScene = () => {
    updateVN(vn => {
      const newScene: VNScene = {
        id: `scene-${Date.now()}`,
        name: `New Scene ${vn.scenes.length + 1}`,
        dialogue: [],
        backgroundId: '',
        characters: [],
        nextSceneId: null
      };
      vn.scenes.push(newScene);
      return vn;
    });
  };

  const handleUpdateScene = (sceneId: string, updates: Partial<VNScene>) => {
    updateVN(vn => {
      const sceneIndex = vn.scenes.findIndex(s => s.id === sceneId);
      if (sceneIndex !== -1) {
        vn.scenes[sceneIndex] = { ...vn.scenes[sceneIndex], ...updates };
      }
      return vn;
    });
  };

  const handleDeleteScene = (sceneId: string) => {
    updateVN(vn => {
      vn.scenes = vn.scenes.filter(s => s.id !== sceneId);
      if (selectedSceneId === sceneId) setSelectedSceneId(null);
      return vn;
    });
  };

  const handleAddDialogue = (sceneId: string) => {
    updateVN(vn => {
      const scene = vn.scenes.find(s => s.id === sceneId);
      if (scene) {
        scene.dialogue.push({
          id: `dialogue-${Date.now()}`,
          speaker: 'Speaker',
          text: 'New dialogue line...',
          styleId: 'default'
        });
      }
      return vn;
    });
  };

  const handleUpdateDialogue = (sceneId: string, dialogueId: string, updates: any) => {
    updateVN(vn => {
      const scene = vn.scenes.find(s => s.id === sceneId);
      if (scene) {
        const diagIndex = scene.dialogue.findIndex(d => d.id === dialogueId);
        if (diagIndex !== -1) {
          scene.dialogue[diagIndex] = { ...scene.dialogue[diagIndex], ...updates };
        }
      }
      return vn;
    });
  };

  const handleDeleteDialogue = (sceneId: string, dialogueId: string) => {
    updateVN(vn => {
      const scene = vn.scenes.find(s => s.id === sceneId);
      if (scene) {
        scene.dialogue = scene.dialogue.filter(d => d.id !== dialogueId);
      }
      return vn;
    });
  };

  const handleAddAsset = (type: VNAsset['type'], name: string, url: string) => {
    updateVN(vn => {
      // Check for duplicates
      let finalName = name;
      let counter = 1;
      while (vn.assets.some(a => a.name === finalName)) {
        finalName = `${name}_${counter++}`;
      }
      
      vn.assets.push({
        id: `asset-${Date.now()}`,
        name: finalName,
        type,
        url
      });
      return vn;
    });
  };

  const handleImportCharacterFromArchive = (archiveChar: ArchiveCharacter) => {
    handleAddAsset('character', archiveChar.data.name, archiveChar.data.image || '');
    setShowArchiveImport(false);
  };

  const handleImportBackgroundFromArchive = (bg: ArchiveBackground) => {
    handleAddAsset('background', bg.name, bg.url);
    setShowArchiveBgImport(false);
  };

  const handleAddCharacter = () => {
    updateVN(vn => {
      vn.characters.push({
        id: `char-${Date.now()}`,
        name: 'New Character',
        expressions: []
      });
      return vn;
    });
  };

  const handleUpdateCharacter = (charId: string, updates: Partial<VNCharacter>) => {
    updateVN(vn => {
      const char = vn.characters.find(c => c.id === charId);
      if (char) Object.assign(char, updates);
      return vn;
    });
  };

  const handleDeleteCharacter = (charId: string) => {
    updateVN(vn => {
      vn.characters = vn.characters.filter(c => c.id !== charId);
      if (selectedCharacterId === charId) setSelectedCharacterId(null);
      return vn;
    });
  };

  const handleAddExpression = (charId: string) => {
    setShowAssetPicker({
      type: 'character',
      onSelect: (assetId) => {
        updateVN(vn => {
          const char = vn.characters.find(c => c.id === charId);
          if (char) {
            char.expressions.push({
              id: `exp-${Date.now()}`,
              name: 'New Expression',
              assetId
            });
          }
          return vn;
        });
        setShowAssetPicker(null);
      }
    });
  };

  const handleAddCharacterToScene = (sceneId: string) => {
    if (!week.vnData?.characters.length) return;
    updateVN(vn => {
      const scene = vn.scenes.find(s => s.id === sceneId);
      if (scene) {
        const firstChar = vn.characters[0];
        scene.characters.push({
          id: `char-state-${Date.now()}`,
          characterId: firstChar.id,
          expressionId: firstChar.expressions[0]?.id || '',
          position: { x: 50, y: 50 },
          scale: 1,
          flip: false
        });
      }
      return vn;
    });
  };

  const handleAIGenerateScript = async () => {
    if (!aiPrompt.trim() || !process.env.GEMINI_API_KEY) return;
    setIsAIGenerating(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Generate a short visual novel script based on this prompt: "${aiPrompt}". 
        Output as a JSON array of scenes. Each scene should have:
        - name: string
        - dialogue: array of { speaker: string, text: string, emotion: string }
        - backgroundDescription: string (for asset generation later)
        - charactersPresent: array of { name: string, initialEmotion: string }
        
        The "emotion" should describe the character's state for that specific line (e.g., "happy", "angry", "surprised").
        Keep it concise and dramatic.`,
        config: {
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
                    backgroundDescription: { type: GenAIType.STRING },
                    charactersPresent: { 
                      type: GenAIType.ARRAY, 
                      items: { 
                        type: GenAIType.OBJECT,
                        properties: {
                          name: { type: GenAIType.STRING },
                          initialEmotion: { type: GenAIType.STRING }
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
      const generated = result.scenes || [];
      const scenes: VNScene[] = generated.map((s: any, i: number) => ({
        id: `ai-scene-${Date.now()}-${i}`,
        name: s.name,
        dialogue: (s.dialogue || []).map((d: any, j: number) => {
          const char = week.vnData?.characters.find(c => c.name.toLowerCase() === d.speaker?.toLowerCase());
          return {
            id: `ai-diag-${Date.now()}-${i}-${j}`,
            speaker: d.speaker,
            characterId: char?.id || null,
            text: d.text,
            emotion: d.emotion,
            styleId: 'default'
          };
        }),
        backgroundId: '',
        characters: (s.charactersPresent || []).map((c: any, j: number) => ({
          id: `ai-char-${Date.now()}-${i}-${j}`,
          characterId: c.name, // Temporary store name here
          expressionId: c.initialEmotion, // Temporary store emotion here
          position: { x: 20 + (j * 30), y: 50 },
          scale: 1,
          flip: false
        })),
        nextSceneId: null
      }));
      setAiPreview(scenes);
    } catch (error) {
      console.error('AI Script error:', error);
    } finally {
      setIsAIGenerating(false);
    }
  };

  const handleAIParseScript = async (scriptText: string) => {
    if (!scriptText.trim() || !onStartAIParseScript) return;
    setIsStartingAI(true);
    try {
      onStartAIParseScript(week.id, scriptText, clearExistingScript);
      setScriptText('');
    } catch (error) {
      console.error('Failed to start AI parsing:', error);
      alert('Failed to start AI parsing. Please try again.');
    } finally {
      // Small timeout to allow the global state to update
      setTimeout(() => setIsStartingAI(false), 1000);
    }
  };

  const handleAutoLinkScenes = () => {
    updateVN(vn => {
      for (let i = 0; i < vn.scenes.length - 1; i++) {
        const currentScene = vn.scenes[i];
        const nextScene = vn.scenes[i + 1];
        
        // Only link if there are no choices and no nextSceneId already set
        if ((!currentScene.choices || currentScene.choices.length === 0) && !currentScene.nextSceneId) {
          currentScene.nextSceneId = nextScene.id;
        }
      }
      return vn;
    });
  };

  const handleScriptFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const text = event.target?.result as string;
        await handleAIParseScript(text);
      };
      reader.readAsText(file);
    }
  };

  const handleSceneClick = (e: React.MouseEvent, sceneId: string) => {
    if (e.ctrlKey || e.metaKey || isAreaSelectMode) {
      setSelectedSceneIds(prev => 
        prev.includes(sceneId) 
          ? prev.filter(id => id !== sceneId) 
          : [...prev, sceneId]
      );
      setSelectedSceneId(null);
    } else {
      setSelectedSceneId(sceneId);
      setSelectedSceneIds([]);
    }
  };

  const handleBatchDelete = () => {
    if (window.confirm(`Are you sure you want to delete ${selectedSceneIds.length} scenes?`)) {
      updateVN(vn => {
        vn.scenes = vn.scenes.filter(s => !selectedSceneIds.includes(s.id));
        return vn;
      });
      setSelectedSceneIds([]);
    }
  };

  const handleBatchUpdateBg = (assetId: string) => {
    updateVN(vn => {
      vn.scenes.forEach(scene => {
        if (selectedSceneIds.includes(scene.id)) {
          scene.backgroundId = assetId;
        }
      });
      return vn;
    });
    setSelectedSceneIds([]);
  };

  const handleBatchUpdateChars = (charStates: VNCharacterState[]) => {
    updateVN(vn => {
      vn.scenes.forEach(scene => {
        if (selectedSceneIds.includes(scene.id)) {
          scene.characters = JSON.parse(JSON.stringify(charStates));
        }
      });
      return vn;
    });
    setSelectedSceneIds([]);
  };

  const acceptAIScript = () => {
    if (!aiPreview) return;
    updateVN(vn => {
      const updatedScenes = [...aiPreview];
      
      // Track characters we've seen to avoid duplicates
      const currentCharacters = [...vn.characters];
      const seenCharacters = new Map<string, VNCharacter>();
      currentCharacters.forEach(c => seenCharacters.set(c.name.toLowerCase(), c));

      updatedScenes.forEach(scene => {
        scene.characters.forEach((charState, idx) => {
          const charName = charState.characterId; // This was temporarily storing the name
          const emotionName = charState.expressionId; // This was temporarily storing the emotion

          if (!charName) return;

          let character = seenCharacters.get(charName.toLowerCase());
          if (!character) {
            // Create new character
            character = {
              id: `char-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              name: charName,
              expressions: []
            };
            currentCharacters.push(character);
            seenCharacters.set(charName.toLowerCase(), character);
          }

          // Ensure expression exists
          let expression = character.expressions.find(e => e.name.toLowerCase() === emotionName.toLowerCase());
          if (!expression && emotionName) {
            expression = {
              id: `exp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              name: emotionName,
              assetId: ''
            };
            character.expressions.push(expression);
          }

          // Update state with actual IDs
          charState.characterId = character.id;
          charState.expressionId = expression?.id || '';
        });

        // Map characterId in dialogue lines
        scene.dialogue.forEach(diag => {
          const character = seenCharacters.get(diag.speaker.toLowerCase());
          if (character) {
            diag.characterId = character.id;
          }
        });
      });

      vn.characters = currentCharacters;
      vn.scenes = [...vn.scenes, ...updatedScenes];
      return vn;
    });
    setAiPreview(null);
    setAiPrompt('');
  };

  const [isGeneratingBg, setIsGeneratingBg] = useState(false);
  const [bgPrompt, setBgPrompt] = useState('');

  const generateAIBackground = async (sceneId: string) => {
    if (!bgPrompt.trim() || !process.env.GEMINI_API_KEY) return;
    setIsGeneratingBg(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [{ text: `A visual novel background for a scene. Description: ${bgPrompt}. Style: Anime / Digital Painting. High quality.` }],
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
          const url = `data:image/png;base64,${base64Data}`;
          const assetId = `ai-bg-${Date.now()}`;
          
          updateVN(vn => {
            vn.assets.push({
              id: assetId,
              name: `AI BG ${vn.assets.length + 1}`,
              type: 'background',
              url
            });
            const scene = vn.scenes.find(s => s.id === sceneId);
            if (scene) scene.backgroundId = assetId;
            return vn;
          });
          setBgPrompt('');
          break;
        }
      }
    } catch (error) {
      console.error('AI BG error:', error);
    } finally {
      setIsGeneratingBg(false);
    }
  };

  const selectedScene = week.vnData?.scenes.find(s => s.id === selectedSceneId);
  const selectedCharacter = week.vnData?.characters.find(c => c.id === selectedCharacterId);

  return (
    <div className="fixed inset-0 flex flex-col bg-zinc-950 text-white z-[1000] overflow-hidden">
      {/* VN Header */}
      <div className="bg-zinc-900 border-b border-zinc-800 px-6 py-4 flex items-center justify-between shadow-2xl z-50">
        <div className="flex items-center gap-6">
          <button onClick={onBack} className="p-2.5 hover:bg-zinc-800 rounded-xl transition-all active:scale-90 bg-zinc-950 border border-zinc-800">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-black uppercase tracking-tighter italic">VN Story Editor</h1>
            <p className="text-[10px] font-black text-pink-500 uppercase tracking-widest">{week.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={undo} disabled={historyIndex <= 0} className="p-2.5 hover:bg-zinc-800 rounded-xl text-zinc-400 disabled:opacity-20 transition-all bg-zinc-950 border border-zinc-800">
            <Undo2 className="w-5 h-5" />
          </button>
          <button onClick={redo} disabled={historyIndex >= history.length - 1} className="p-2.5 hover:bg-zinc-800 rounded-xl text-zinc-400 disabled:opacity-20 transition-all bg-zinc-950 border border-zinc-800">
            <Redo2 className="w-5 h-5" />
          </button>
          <div className="w-px h-8 bg-zinc-800 mx-2" />
          <button 
            onClick={toggleFullscreen}
            className="p-2.5 hover:bg-zinc-800 rounded-xl text-zinc-400 transition-all bg-zinc-950 border border-zinc-800"
            title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
          >
            {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
          </button>
          <div className="w-px h-8 bg-zinc-800 mx-2" />
          <button 
            onClick={() => {
              if (onSave) onSave();
              onBack();
            }} 
            className="flex items-center gap-2 px-6 py-2.5 bg-pink-600 hover:bg-pink-500 rounded-xl font-black text-xs tracking-widest uppercase transition-all shadow-lg shadow-pink-600/20"
          >
            <Save className="w-4 h-4" />
            Save & Exit
          </button>
        </div>
      </div>

      {/* VN Sub-Header (Tabs) */}
      <div className="bg-zinc-900/50 border-b border-zinc-800 px-6 py-3 flex items-center justify-center shrink-0">
        <div className="flex bg-zinc-950 p-1 rounded-xl border border-zinc-800">
          {[
            { id: 'scenes', label: 'Scenes', icon: Layout },
            { id: 'characters', label: 'Characters', icon: User },
            { id: 'assets', label: 'Assets', icon: ImageIcon },
            { id: 'styles', label: 'Styles', icon: Palette },
            { id: 'ai', label: 'AI Tools', icon: Sparkles },
          ].map(tab => (
            <button 
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-6 py-2 rounded-lg text-[10px] font-black tracking-widest uppercase transition-all flex items-center gap-2 ${activeTab === tab.id ? 'bg-pink-600 text-white shadow-lg shadow-pink-600/20' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden relative">
        {activeTab === 'scenes' && (
          <>
            {/* Scene List */}
            <div className="w-64 border-r border-zinc-800 bg-zinc-900/30 flex flex-col">
              <div className="p-4 border-b border-zinc-800 flex items-center justify-between gap-2">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 truncate">Story Scenes</h3>
                <div className="flex items-center gap-1">
                  <button 
                    onClick={() => setIsAreaSelectMode(!isAreaSelectMode)}
                    className={`p-1.5 rounded-lg transition-all active:scale-90 ${isAreaSelectMode ? 'bg-pink-600 text-white shadow-lg shadow-pink-600/20' : 'bg-zinc-950 border border-zinc-800 text-zinc-500 hover:text-white'}`}
                    title="Area Select Mode (Ctrl + Click)"
                  >
                    <Maximize className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={handleAddScene} className="p-1.5 bg-pink-600 hover:bg-pink-500 rounded-lg transition-all active:scale-90 shadow-lg shadow-pink-600/20">
                    <Plus className="w-3.5 h-3.5 text-white" />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                {week.vnData?.scenes.map(scene => (
                  <div
                    key={scene.id}
                    onClick={(e) => handleSceneClick(e, scene.id)}
                    className={`w-full cursor-pointer text-left px-3 py-2.5 rounded-xl flex items-center justify-between group transition-all ${selectedSceneId === scene.id || selectedSceneIds.includes(scene.id) ? 'bg-pink-600/10 border border-pink-500/50 text-pink-500' : 'hover:bg-zinc-800 border border-transparent text-zinc-400'}`}
                  >
                    <div className="flex items-center gap-3 overflow-hidden">
                      <Layout className="w-3.5 h-3.5 flex-shrink-0" />
                      <div className="flex flex-col overflow-hidden">
                        <span className="text-[11px] font-bold truncate uppercase tracking-tighter">{scene.name}</span>
                        {week.vnData?.startSceneId === scene.id && (
                          <span className="text-[7px] font-black text-pink-500 uppercase tracking-widest">Start Scene</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleSetStartScene(scene.id); }}
                        className={`p-1.5 rounded-lg transition-all ${week.vnData?.startSceneId === scene.id ? 'text-pink-500' : 'text-zinc-600 hover:text-zinc-400'}`}
                        title="Set as Start Scene"
                      >
                        <Play className="w-3 h-3" />
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleDeleteScene(scene.id); }}
                        className="p-1.5 text-zinc-600 hover:text-red-500 rounded-lg transition-all"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Scene Editor */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {selectedScene ? (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="p-6 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/20">
                    <div className="flex items-center gap-4">
                      <input 
                        type="text" 
                        value={selectedScene.name}
                        onChange={(e) => handleUpdateScene(selectedScene.id, { name: e.target.value })}
                        className="bg-transparent border-none focus:ring-0 font-black uppercase text-xl outline-none tracking-tighter text-white"
                      />
                    </div>
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={() => {
                          setPreviewSceneIndex(week.vnData?.scenes.findIndex(s => s.id === selectedScene.id) || 0);
                          setPreviewDialogueIndex(0);
                          setShowPreview(true);
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-[10px] font-black tracking-widest uppercase transition-all"
                      >
                        <Play className="w-3.5 h-3.5" />
                        Preview Scene
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 flex overflow-hidden">
                    {/* Scene Content */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                      {/* Background & Characters Preview */}
                      <div className="aspect-video bg-zinc-900 rounded-3xl border border-zinc-800 relative overflow-hidden shadow-2xl">
                        {selectedScene.backgroundId && (
                          <img 
                            src={week.vnData?.assets.find(a => a.id === selectedScene.backgroundId)?.url} 
                            className="absolute inset-0 w-full h-full object-cover"
                            style={{ transform: `${selectedScene.flipBackgroundX ? 'scaleX(-1)' : ''} ${selectedScene.flipBackgroundY ? 'scaleY(-1)' : ''}` }}
                            alt="Background"
                          />
                        )}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          {selectedScene.characters.map(char => {
                            const asset = week.vnData?.assets.find(a => a.id === char.assetId);
                            return (
                              <div 
                                key={char.id}
                                className="absolute transition-all"
                                style={{ 
                                  left: `${char.position.x}%`, 
                                  top: `${char.position.y}%`,
                                  transform: `translate(-50%, -50%) scale(${char.scale}) ${char.flip ? 'scaleX(-1)' : ''} ${char.flipVertical ? 'scaleY(-1)' : ''}`
                                }}
                              >
                                {asset ? (
                                  <img src={asset.url} className="max-h-[80vh] object-contain" alt="Character" />
                                ) : (
                                  <div className="w-32 h-64 bg-zinc-800/50 border border-dashed border-zinc-700 rounded-2xl flex items-center justify-center">
                                    <User className="w-8 h-8 text-zinc-600" />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        
                        {/* Dialogue Preview Overlay */}
                        <div className="absolute bottom-6 left-6 right-6 p-6 rounded-2xl border-2 border-pink-500/30 bg-black/80 backdrop-blur-md">
                          <div className="text-pink-500 font-black text-xs uppercase tracking-widest mb-2">Speaker Name</div>
                          <div className="text-white text-lg font-medium leading-relaxed">This is how your dialogue will look in-game.</div>
                        </div>
                      </div>

                      {/* Choices List */}
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Player Choices</h3>
                          <button 
                            onClick={() => {
                              updateVN(vn => {
                                const scene = vn.scenes.find(s => s.id === selectedScene.id);
                                if (scene) {
                                  if (!scene.choices) scene.choices = [];
                                  scene.choices.push({
                                    id: `choice-${Date.now()}`,
                                    text: 'New Choice...',
                                    nextSceneId: null
                                  });
                                }
                                return vn;
                              });
                            }}
                            className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-[9px] font-black tracking-widest uppercase transition-all"
                          >
                            <Plus className="w-3 h-3" />
                            Add Choice
                          </button>
                        </div>
                        <div className="space-y-2">
                          {selectedScene.choices?.map((choice) => (
                            <div key={choice.id} className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-2xl flex gap-4 group hover:border-zinc-700 transition-all">
                              <div className="flex-1 space-y-3">
                                <div className="flex items-center gap-3">
                                  <input 
                                    type="text" 
                                    value={choice.text}
                                    onChange={(e) => {
                                      updateVN(vn => {
                                        const scene = vn.scenes.find(s => s.id === selectedScene.id);
                                        if (scene && scene.choices) {
                                          const c = scene.choices.find(ch => ch.id === choice.id);
                                          if (c) c.text = e.target.value;
                                        }
                                        return vn;
                                      });
                                    }}
                                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-pink-500 transition-all"
                                    placeholder="Choice text..."
                                  />
                                  <select 
                                    value={choice.nextSceneId || ''}
                                    onChange={(e) => {
                                      updateVN(vn => {
                                        const scene = vn.scenes.find(s => s.id === selectedScene.id);
                                        if (scene && scene.choices) {
                                          const c = scene.choices.find(ch => ch.id === choice.id);
                                          if (c) c.nextSceneId = e.target.value || null;
                                        }
                                        return vn;
                                      });
                                    }}
                                    className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-[10px] font-black tracking-widest uppercase outline-none focus:border-pink-500 transition-all"
                                  >
                                    <option value="">End Story</option>
                                    {week.vnData?.scenes.filter(s => s.id !== selectedScene.id).map(s => (
                                      <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                              <button 
                                onClick={() => {
                                  updateVN(vn => {
                                    const scene = vn.scenes.find(s => s.id === selectedScene.id);
                                    if (scene && scene.choices) {
                                      scene.choices = scene.choices.filter(c => c.id !== choice.id);
                                    }
                                    return vn;
                                  });
                                }}
                                className="p-2 text-zinc-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all self-start"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Dialogue List */}
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Dialogue Script</h3>
                          <button 
                            onClick={() => handleAddDialogue(selectedScene.id)}
                            className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-[9px] font-black tracking-widest uppercase transition-all"
                          >
                            <Plus className="w-3 h-3" />
                            Add Line
                          </button>
                        </div>
                        <div className="space-y-3 pb-20">
                          {(selectedScene.dialogue || []).map((diag, idx) => (
                            <div key={diag.id} className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-2xl flex gap-4 group hover:border-zinc-700 transition-all">
                              <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] font-black text-zinc-500 flex-shrink-0">
                                {idx + 1}
                              </div>
                              <div className="flex-1 space-y-3">
                                <div className="flex items-center gap-3">
                                  <div className="flex items-center gap-2">
                                    <div className="relative group/speaker">
                                      <input 
                                        type="text" 
                                        value={diag.speaker}
                                        onChange={(e) => handleUpdateDialogue(selectedScene.id, diag.id, { speaker: e.target.value })}
                                        className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-[10px] font-black tracking-widest uppercase outline-none focus:border-pink-500 transition-all w-32"
                                        placeholder="SPEAKER"
                                      />
                                      {/* Quick Character Picker */}
                                      <div className="absolute top-full left-0 mt-1 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl opacity-0 invisible group-focus-within/speaker:opacity-100 group-focus-within/speaker:visible transition-all z-50 p-1 min-w-[150px]">
                                        {week.vnData?.characters.map(char => (
                                          <button 
                                            key={char.id}
                                            onClick={() => handleUpdateDialogue(selectedScene.id, diag.id, { speaker: char.name, characterId: char.id })}
                                            className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 rounded-lg text-[9px] font-black uppercase tracking-widest text-zinc-400 hover:text-white transition-all"
                                          >
                                            {char.name}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                    <select 
                                      value={diag.characterId || ''}
                                      onChange={(e) => handleUpdateDialogue(selectedScene.id, diag.id, { characterId: e.target.value || null })}
                                      className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-[10px] font-black tracking-widest uppercase outline-none focus:border-pink-500 transition-all w-32"
                                    >
                                      <option value="">No Character</option>
                                      {week.vnData?.characters.map(char => (
                                        <option key={char.id} value={char.id}>{char.name}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <select 
                                    value={diag.styleId}
                                    onChange={(e) => handleUpdateDialogue(selectedScene.id, diag.id, { styleId: e.target.value })}
                                    className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-[10px] font-black tracking-widest uppercase outline-none focus:border-pink-500 transition-all"
                                  >
                                    {week.vnData?.styles.map(s => (
                                      <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                  </select>
                                </div>
                                <textarea 
                                  value={diag.text}
                                  onChange={(e) => handleUpdateDialogue(selectedScene.id, diag.id, { text: e.target.value })}
                                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-sm outline-none focus:border-pink-500 transition-all min-h-[80px] resize-none"
                                  placeholder="Dialogue text..."
                                />
                              </div>
                              <div className="flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                <button 
                                  onClick={() => handleDeleteDialogue(selectedScene.id, diag.id)}
                                  className="p-2 text-zinc-600 hover:text-red-500"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Scene Sidebar: Background & Characters */}
                    <div className="w-80 border-l border-zinc-800 bg-zinc-900/30 p-6 space-y-8 overflow-y-auto custom-scrollbar">
                      <div className="space-y-4">
                        <div className="flex justify-between items-center">
                          <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                            <ImageIcon className="w-3 h-3" />
                            Background
                          </h3>
                          <div className="flex gap-1">
                            <button 
                              onClick={() => handleUpdateScene(selectedScene.id, { flipBackgroundX: !selectedScene.flipBackgroundX })}
                              className={`px-2 py-1 rounded text-[8px] font-black uppercase transition-all border ${selectedScene.flipBackgroundX ? 'bg-pink-600 border-pink-500 text-white' : 'bg-zinc-950 border-zinc-800 text-zinc-500'}`}
                            >
                              Flip X
                            </button>
                            <button 
                              onClick={() => handleUpdateScene(selectedScene.id, { flipBackgroundY: !selectedScene.flipBackgroundY })}
                              className={`px-2 py-1 rounded text-[8px] font-black uppercase transition-all border ${selectedScene.flipBackgroundY ? 'bg-pink-600 border-pink-500 text-white' : 'bg-zinc-950 border-zinc-800 text-zinc-500'}`}
                            >
                              Flip Y
                            </button>
                          </div>
                        </div>
                        <div className="aspect-video bg-zinc-950 rounded-2xl border border-zinc-800 overflow-hidden relative group cursor-pointer"
                             onClick={() => setShowAssetPicker({ type: 'background', onSelect: (assetId) => handleUpdateScene(selectedScene.id, { backgroundId: assetId }) })}>
                          {selectedScene.backgroundId ? (
                            <img 
                              src={week.vnData?.assets.find(a => a.id === selectedScene.backgroundId)?.url} 
                              className="w-full h-full object-cover"
                              alt="BG"
                              style={{ transform: `${selectedScene.flipBackgroundX ? 'scaleX(-1)' : ''} ${selectedScene.flipBackgroundY ? 'scaleY(-1)' : ''}` }}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-zinc-700">
                              <ImageIcon className="w-8 h-8 opacity-20" />
                            </div>
                          )}
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <div className="p-2 bg-white text-black rounded-full hover:scale-110 transition-transform">
                              <Search className="w-4 h-4" />
                            </div>
                          </div>
                        </div>

                        {/* Quick Background Library */}
                        <div className="space-y-2">
                          <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Quick Select</label>
                          <div className="grid grid-cols-4 gap-1 max-h-24 overflow-y-auto custom-scrollbar p-1 bg-zinc-950 rounded-lg border border-zinc-800">
                            {week.vnData?.assets.filter(a => a.type === 'background').map(bg => (
                              <button
                                key={bg.id}
                                onClick={() => handleUpdateScene(selectedScene.id, { backgroundId: bg.id })}
                                className={`aspect-video rounded border transition-all overflow-hidden ${selectedScene.backgroundId === bg.id ? 'border-pink-500 ring-1 ring-pink-500' : 'border-zinc-800 hover:border-zinc-600'}`}
                              >
                                <img src={bg.url} className="w-full h-full object-cover" alt={bg.name} />
                              </button>
                            ))}
                            <button 
                              onClick={() => setActiveTab('assets')}
                              className="aspect-video rounded border border-dashed border-zinc-800 flex items-center justify-center hover:bg-zinc-900 transition-all"
                            >
                              <Plus className="w-3 h-3 text-zinc-600" />
                            </button>
                          </div>
                        </div>
                        <div className="relative">
                          <input 
                            type="text" 
                            value={bgPrompt}
                            onChange={(e) => setBgPrompt(e.target.value)}
                            placeholder="AI BG PROMPT..."
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-2 pl-3 pr-10 text-[9px] font-black tracking-widest uppercase focus:outline-none focus:border-zinc-600 transition-all"
                          />
                          <button 
                            onClick={() => generateAIBackground(selectedScene.id)}
                            disabled={isGeneratingBg || !bgPrompt.trim()}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-pink-500 hover:text-pink-400 disabled:opacity-30"
                          >
                            {isGeneratingBg ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                          </button>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                            <User className="w-3 h-3" />
                            Characters
                          </h3>
                          <button 
                            onClick={() => handleAddCharacterToScene(selectedScene.id)}
                            className="p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-all"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="space-y-3">
                          {(selectedScene.characters || []).map(char => {
                            const character = week.vnData?.characters.find(c => c.id === char.characterId);
                            const expression = character?.expressions.find(e => e.id === char.expressionId);
                            const asset = week.vnData?.assets.find(a => a.id === expression?.assetId);

                            return (
                              <div key={char.id} className="bg-zinc-950 border border-zinc-800 p-3 rounded-xl space-y-3">
                                <div className="flex items-center justify-between">
                                  <select 
                                    value={char.characterId}
                                    onChange={(e) => {
                                      const newChars = [...selectedScene.characters];
                                      const idx = newChars.findIndex(c => c.id === char.id);
                                      newChars[idx].characterId = e.target.value;
                                      const newChar = week.vnData?.characters.find(c => c.id === e.target.value);
                                      newChars[idx].expressionId = newChar?.expressions[0]?.id || '';
                                      handleUpdateScene(selectedScene.id, { characters: newChars });
                                    }}
                                    className="bg-transparent text-[9px] font-black text-zinc-500 uppercase tracking-widest outline-none"
                                  >
                                    {week.vnData?.characters.map(c => (
                                      <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                  </select>
                                  <button 
                                    onClick={() => {
                                      const newChars = selectedScene.characters.filter(c => c.id !== char.id);
                                      handleUpdateScene(selectedScene.id, { characters: newChars });
                                      if (selectedCharStateId === char.id) setSelectedCharStateId(null);
                                    }}
                                    className="text-zinc-600 hover:text-red-500"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                                <div 
                                  onClick={() => setSelectedCharStateId(selectedCharStateId === char.id ? null : char.id)}
                                  className={`h-24 bg-zinc-900 rounded-lg border flex items-center justify-center relative group cursor-pointer transition-all ${selectedCharStateId === char.id ? 'border-pink-500 bg-pink-500/5' : 'border-zinc-800'}`}
                                >
                                  {asset ? (
                                    <img src={asset.url} className="h-full object-contain" alt="Preview" />
                                  ) : (
                                    <User className="w-6 h-6 text-zinc-700" />
                                  )}
                                  <div className="absolute top-2 right-2 p-1 bg-zinc-950 rounded-md border border-zinc-800 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Settings className="w-3 h-3 text-zinc-400" />
                                  </div>
                                </div>

                                {selectedCharStateId === char.id && (
                                  <div className="space-y-4 pt-2 border-t border-zinc-800 animate-in fade-in slide-in-from-top-2 duration-200">
                                    {/* Expression Picker */}
                                    <div className="space-y-1.5">
                                      <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Expression</label>
                                      <select 
                                        value={char.expressionId}
                                        onChange={(e) => {
                                          const newChars = [...selectedScene.characters];
                                          const idx = newChars.findIndex(c => c.id === char.id);
                                          newChars[idx].expressionId = e.target.value;
                                          handleUpdateScene(selectedScene.id, { characters: newChars });
                                        }}
                                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-[9px] font-black tracking-widest uppercase outline-none focus:border-pink-500 transition-all"
                                      >
                                        {character?.expressions.map(exp => (
                                          <option key={exp.id} value={exp.id}>{exp.name}</option>
                                        ))}
                                      </select>
                                    </div>

                                    {/* Highlight Effects */}
                                    <div className="space-y-1.5">
                                      <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Highlight Effect</label>
                                      <div className="grid grid-cols-3 gap-1">
                                        {['none', 'glow', 'zoom', 'float', 'shake', 'brighten'].map(effect => (
                                          <button
                                            key={effect}
                                            onClick={() => {
                                              const newChars = [...selectedScene.characters];
                                              const idx = newChars.findIndex(c => c.id === char.id);
                                              newChars[idx].highlightEffect = effect as any;
                                              handleUpdateScene(selectedScene.id, { characters: newChars });
                                            }}
                                            className={`py-1 rounded-md text-[7px] font-black uppercase tracking-tighter transition-all ${char.highlightEffect === effect ? 'bg-pink-600 text-white' : 'bg-zinc-900 text-zinc-500 hover:bg-zinc-800'}`}
                                          >
                                            {effect}
                                          </button>
                                        ))}
                                      </div>
                                    </div>

                                    {/* Transformations */}
                                    <div className="grid grid-cols-2 gap-3">
                                      <div className="space-y-1.5">
                                        <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Opacity</label>
                                        <input 
                                          type="range" min="0" max="1" step="0.1" 
                                          value={char.opacity ?? 1}
                                          onChange={(e) => {
                                            const newChars = [...selectedScene.characters];
                                            const idx = newChars.findIndex(c => c.id === char.id);
                                            newChars[idx].opacity = parseFloat(e.target.value);
                                            handleUpdateScene(selectedScene.id, { characters: newChars });
                                          }}
                                          className="w-full accent-pink-500"
                                        />
                                      </div>
                                      <div className="space-y-1.5">
                                        <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Z-Index</label>
                                        <input 
                                          type="number" 
                                          value={char.zIndex ?? 10}
                                          onChange={(e) => {
                                            const newChars = [...selectedScene.characters];
                                            const idx = newChars.findIndex(c => c.id === char.id);
                                            newChars[idx].zIndex = parseInt(e.target.value);
                                            handleUpdateScene(selectedScene.id, { characters: newChars });
                                          }}
                                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-[9px] font-black outline-none"
                                        />
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-2">
                                      <button 
                                        onClick={() => {
                                          const newChars = [...selectedScene.characters];
                                          const idx = newChars.findIndex(c => c.id === char.id);
                                          newChars[idx].flip = !newChars[idx].flip;
                                          handleUpdateScene(selectedScene.id, { characters: newChars });
                                        }}
                                        className={`flex-1 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-widest transition-all border ${char.flip ? 'bg-pink-600 border-pink-500 text-white' : 'bg-zinc-900 border-zinc-800 text-zinc-500'}`}
                                      >
                                        Flip X
                                      </button>
                                      <button 
                                        onClick={() => {
                                          const newChars = [...selectedScene.characters];
                                          const idx = newChars.findIndex(c => c.id === char.id);
                                          newChars[idx].flipVertical = !newChars[idx].flipVertical;
                                          handleUpdateScene(selectedScene.id, { characters: newChars });
                                        }}
                                        className={`flex-1 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-widest transition-all border ${char.flipVertical ? 'bg-pink-600 border-pink-500 text-white' : 'bg-zinc-900 border-zinc-800 text-zinc-500'}`}
                                      >
                                        Flip Y
                                      </button>
                                      <button 
                                        onClick={() => {
                                          const newChars = [...selectedScene.characters];
                                          const idx = newChars.findIndex(c => c.id === char.id);
                                          newChars[idx].position = { x: 50, y: 50 };
                                          newChars[idx].scale = 1;
                                          newChars[idx].opacity = 1;
                                          newChars[idx].zIndex = 10;
                                          newChars[idx].highlightEffect = 'none';
                                          newChars[idx].flip = false;
                                          newChars[idx].filters = { brightness: 100, contrast: 100, saturation: 100 };
                                          handleUpdateScene(selectedScene.id, { characters: newChars });
                                        }}
                                        className="p-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-zinc-500 hover:text-white transition-all"
                                        title="Reset All"
                                      >
                                        <RefreshCw className="w-3 h-3" />
                                      </button>
                                    </div>

                                    {/* Precise Positioning */}
                                    <div className="space-y-2">
                                      <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Position & Scale</label>
                                      <div className="grid grid-cols-2 gap-2">
                                        <div className="space-y-1">
                                          <div className="flex items-center justify-between px-1">
                                            <span className="text-[7px] text-zinc-600 font-bold">X: {char.position.x}%</span>
                                            <div className="flex gap-0.5">
                                              <button onClick={() => {
                                                const newChars = [...selectedScene.characters];
                                                const idx = newChars.findIndex(c => c.id === char.id);
                                                newChars[idx].position.x = Math.max(0, newChars[idx].position.x - 5);
                                                handleUpdateScene(selectedScene.id, { characters: newChars });
                                              }} className="p-0.5 bg-zinc-900 rounded hover:bg-zinc-800 text-[6px]">-5</button>
                                              <button onClick={() => {
                                                const newChars = [...selectedScene.characters];
                                                const idx = newChars.findIndex(c => c.id === char.id);
                                                newChars[idx].position.x = Math.min(100, newChars[idx].position.x + 5);
                                                handleUpdateScene(selectedScene.id, { characters: newChars });
                                              }} className="p-0.5 bg-zinc-900 rounded hover:bg-zinc-800 text-[6px]">+5</button>
                                            </div>
                                          </div>
                                          <input type="range" min="0" max="100" value={char.position.x} onChange={(e) => {
                                            const newChars = [...selectedScene.characters];
                                            const idx = newChars.findIndex(c => c.id === char.id);
                                            newChars[idx].position.x = parseInt(e.target.value);
                                            handleUpdateScene(selectedScene.id, { characters: newChars });
                                          }} className="w-full accent-pink-500 h-1" />
                                        </div>
                                        <div className="space-y-1">
                                          <div className="flex items-center justify-between px-1">
                                            <span className="text-[7px] text-zinc-600 font-bold">Y: {char.position.y}%</span>
                                            <div className="flex gap-0.5">
                                              <button onClick={() => {
                                                const newChars = [...selectedScene.characters];
                                                const idx = newChars.findIndex(c => c.id === char.id);
                                                newChars[idx].position.y = Math.max(0, newChars[idx].position.y - 5);
                                                handleUpdateScene(selectedScene.id, { characters: newChars });
                                              }} className="p-0.5 bg-zinc-900 rounded hover:bg-zinc-800 text-[6px]">-5</button>
                                              <button onClick={() => {
                                                const newChars = [...selectedScene.characters];
                                                const idx = newChars.findIndex(c => c.id === char.id);
                                                newChars[idx].position.y = Math.min(100, newChars[idx].position.y + 5);
                                                handleUpdateScene(selectedScene.id, { characters: newChars });
                                              }} className="p-0.5 bg-zinc-900 rounded hover:bg-zinc-800 text-[6px]">+5</button>
                                            </div>
                                          </div>
                                          <input type="range" min="0" max="100" value={char.position.y} onChange={(e) => {
                                            const newChars = [...selectedScene.characters];
                                            const idx = newChars.findIndex(c => c.id === char.id);
                                            newChars[idx].position.y = parseInt(e.target.value);
                                            handleUpdateScene(selectedScene.id, { characters: newChars });
                                          }} className="w-full accent-pink-500 h-1" />
                                        </div>
                                      </div>
                                      <div className="space-y-1">
                                        <div className="flex items-center justify-between px-1">
                                          <span className="text-[7px] text-zinc-600 font-bold">Scale: {char.scale.toFixed(1)}x</span>
                                        </div>
                                        <input type="range" min="0.1" max="3" step="0.1" value={char.scale} onChange={(e) => {
                                          const newChars = [...selectedScene.characters];
                                          const idx = newChars.findIndex(c => c.id === char.id);
                                          newChars[idx].scale = parseFloat(e.target.value);
                                          handleUpdateScene(selectedScene.id, { characters: newChars });
                                        }} className="w-full accent-pink-500 h-1" />
                                      </div>
                                    </div>

                                    {/* Color Filters */}
                                    <div className="space-y-2">
                                      <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Color Filters</label>
                                      <div className="space-y-1.5">
                                        {['brightness', 'contrast', 'saturation'].map(filter => (
                                          <div key={filter} className="space-y-1">
                                            <div className="flex items-center justify-between px-1">
                                              <span className="text-[7px] text-zinc-600 font-bold uppercase">{filter}: {(char.filters as any)?.[filter] ?? 100}%</span>
                                            </div>
                                            <input 
                                              type="range" min="0" max="200" 
                                              value={(char.filters as any)?.[filter] ?? 100} 
                                              onChange={(e) => {
                                                const newChars = [...selectedScene.characters];
                                                const idx = newChars.findIndex(c => c.id === char.id);
                                                if (!newChars[idx].filters) newChars[idx].filters = { brightness: 100, contrast: 100, saturation: 100 };
                                                (newChars[idx].filters as any)[filter] = parseInt(e.target.value);
                                                handleUpdateScene(selectedScene.id, { characters: newChars });
                                              }} 
                                              className="w-full accent-pink-500 h-1" 
                                            />
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-zinc-700">
                  <Layout className="w-16 h-16 mb-4 opacity-10" />
                  <p className="text-xs font-black uppercase tracking-widest opacity-30">Select a scene to edit</p>
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === 'characters' && (
          <div className="flex-1 flex overflow-hidden">
            {/* Character List */}
            <div className="w-64 border-r border-zinc-800 bg-zinc-900/30 flex flex-col">
              <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Characters</h3>
                <button onClick={handleAddCharacter} className="p-1.5 bg-pink-600 hover:bg-pink-500 rounded-lg transition-all active:scale-90">
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                {week.vnData?.characters.map(char => (
                  <div
                    key={char.id}
                    onClick={() => setSelectedCharacterId(char.id)}
                    className={`w-full cursor-pointer text-left px-3 py-2.5 rounded-xl flex items-center justify-between group transition-all ${selectedCharacterId === char.id ? 'bg-pink-600/10 border border-pink-500/50 text-pink-500' : 'hover:bg-zinc-800 border border-transparent text-zinc-400'}`}
                  >
                    <div className="flex items-center gap-3 overflow-hidden">
                      <User className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="text-[11px] font-bold truncate uppercase tracking-tighter">{char.name}</span>
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleDeleteCharacter(char.id); }}
                      className="p-1.5 text-zinc-600 hover:text-red-500 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Character Editor */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {selectedCharacter ? (
                <div className="flex-1 flex flex-col p-8 overflow-y-auto custom-scrollbar">
                  <div className="max-w-4xl mx-auto w-full space-y-8">
                    <div className="flex items-center justify-between">
                      <input 
                        type="text" 
                        value={selectedCharacter.name}
                        onChange={(e) => handleUpdateCharacter(selectedCharacter.id, { name: e.target.value })}
                        className="bg-transparent border-none focus:ring-0 font-black uppercase text-4xl outline-none tracking-tighter text-white"
                      />
                    </div>

                    <div className="space-y-6">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-black uppercase tracking-widest text-zinc-500">Expressions (Sprites)</h3>
                        <button 
                          onClick={() => handleAddExpression(selectedCharacter.id)}
                          className="flex items-center gap-2 px-4 py-2 bg-pink-600 hover:bg-pink-500 rounded-xl font-black text-[10px] tracking-widest uppercase transition-all shadow-lg shadow-pink-600/20"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add Expression
                        </button>
                      </div>

                      <div className="grid grid-cols-3 gap-6">
                        {selectedCharacter.expressions.map((exp) => {
                          const asset = week.vnData?.assets.find(a => a.id === exp.assetId);
                          return (
                            <div key={exp.id} className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden group hover:border-zinc-600 transition-all">
                              <div className="aspect-[3/4] bg-zinc-950 flex items-center justify-center relative">
                                {asset ? (
                                  <img src={asset.url} className="w-full h-full object-contain p-4" alt={exp.name} />
                                ) : (
                                  <User className="w-12 h-12 text-zinc-800" />
                                )}
                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                  <button 
                                    onClick={() => {
                                      setShowAssetPicker({
                                        type: 'character',
                                        onSelect: (assetId) => {
                                          updateVN(vn => {
                                            const char = vn.characters.find(c => c.id === selectedCharacter.id);
                                            const e = char?.expressions.find(ex => ex.id === exp.id);
                                            if (e) e.assetId = assetId;
                                            return vn;
                                          });
                                          setShowAssetPicker(null);
                                        }
                                      });
                                    }}
                                    className="p-3 bg-white text-black rounded-full hover:scale-110 transition-transform"
                                  >
                                    <ImageIcon className="w-5 h-5" />
                                  </button>
                                  <button 
                                    onClick={() => {
                                      updateVN(vn => {
                                        const char = vn.characters.find(c => c.id === selectedCharacter.id);
                                        if (char) char.expressions = char.expressions.filter(e => e.id !== exp.id);
                                        return vn;
                                      });
                                    }}
                                    className="p-3 bg-red-600 text-white rounded-full hover:scale-110 transition-transform"
                                  >
                                    <Trash2 className="w-5 h-5" />
                                  </button>
                                </div>
                              </div>
                              <div className="p-4 bg-zinc-900/50">
                                <input 
                                  type="text" 
                                  value={exp.name}
                                  onChange={(e) => {
                                    updateVN(vn => {
                                      const char = vn.characters.find(c => c.id === selectedCharacter.id);
                                      const ex = char?.expressions.find(x => x.id === exp.id);
                                      if (ex) ex.name = e.target.value;
                                      return vn;
                                    });
                                  }}
                                  className="w-full bg-transparent border-none focus:ring-0 text-xs font-black uppercase tracking-widest text-white outline-none"
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-zinc-700">
                  <User className="w-16 h-16 mb-4 opacity-10" />
                  <p className="text-xs font-black uppercase tracking-widest opacity-30">Select a character to edit</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Asset Picker Modal */}
        <AnimatePresence>
          {showAssetPicker && (
            <div className="fixed inset-0 z-[2000] flex items-center justify-center p-12">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowAssetPicker(null)}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="relative w-full max-w-4xl bg-zinc-900 border border-zinc-800 rounded-[40px] overflow-hidden flex flex-col shadow-2xl"
              >
                <div className="p-8 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/50">
                  <div>
                    <h2 className="text-2xl font-black uppercase tracking-tighter">Select {showAssetPicker.type}</h2>
                    <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest">Choose an asset from your library</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 px-6 py-3 bg-pink-600 hover:bg-pink-500 rounded-2xl font-black text-[10px] tracking-widest uppercase cursor-pointer transition-all shadow-lg shadow-pink-600/20">
                      <Upload className="w-4 h-4" />
                      Upload New
                      <input 
                        type="file" 
                        className="hidden" 
                        accept={showAssetPicker.type === 'music' || showAssetPicker.type === 'sfx' || showAssetPicker.type === 'voice' ? 'audio/*' : 'image/*'}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onload = (event) => {
                              const url = event.target?.result as string;
                              const newAsset: VNAsset = {
                                id: `asset-${Date.now()}`,
                                name: file.name,
                                type: showAssetPicker.type,
                                url: url
                              };
                              updateVN(vn => {
                                vn.assets.push(newAsset);
                                return vn;
                              });
                              showAssetPicker.onSelect(newAsset.id);
                              setShowAssetPicker(null);
                            };
                            reader.readAsDataURL(file);
                          }
                        }}
                      />
                    </label>
                    <button onClick={() => setShowAssetPicker(null)} className="p-3 hover:bg-zinc-800 rounded-2xl transition-all">
                      <X className="w-6 h-6" />
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                  <div className="grid grid-cols-4 gap-6">
                    {week.vnData?.assets.filter(a => a.type === showAssetPicker.type || (showAssetPicker.type === 'character' && a.type === 'background')).map(asset => (
                      <button 
                        key={asset.id}
                        onClick={() => showAssetPicker.onSelect(asset.id)}
                        className="bg-zinc-950 border border-zinc-800 rounded-3xl overflow-hidden hover:border-pink-500 transition-all group"
                      >
                        <div className="aspect-square flex items-center justify-center relative">
                          {asset.type === 'background' || asset.type === 'character' ? (
                            <img src={asset.url} className="w-full h-full object-contain p-4" alt={asset.name} />
                          ) : (
                            <Music className="w-12 h-12 text-zinc-800" />
                          )}
                        </div>
                        <div className="p-4 bg-zinc-900/50 text-left">
                          <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">{asset.type}</div>
                          <div className="text-xs font-bold text-white truncate">{asset.name}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Preview Overlay */}
        <AnimatePresence>
          {showPreview && week.vnData && (
            <div className="fixed inset-0 z-[3000] bg-black flex items-center justify-center">
              <div className="relative w-full h-full max-w-[1920px] aspect-video bg-zinc-950 overflow-hidden">
                {/* Close Button */}
                <button 
                  onClick={() => setShowPreview(false)}
                  className="absolute top-6 right-6 z-50 p-3 bg-black/50 hover:bg-black/80 rounded-2xl text-white transition-all"
                >
                  <X className="w-6 h-6" />
                </button>

                {/* VN Scene Content */}
                {(() => {
                  const scene = week.vnData.scenes[previewSceneIndex];
                  if (!scene) return null;
                  const bg = week.vnData.assets.find(a => a.id === scene.backgroundId);
                  const dialogue = scene.dialogue[previewDialogueIndex];

                  return (
                    <div className="absolute inset-0">
                      {bg && <img src={bg.url} className="absolute inset-0 w-full h-full object-cover" alt="BG" />}
                      
                      <div className="absolute inset-0 flex items-center justify-center">
                        {scene.characters.map(char => {
                          const character = week.vnData?.characters.find(c => c.id === char.characterId);
                          const expression = character?.expressions.find(e => e.id === char.expressionId);
                          const asset = week.vnData?.assets.find(a => a.id === expression?.assetId);
                          if (!asset) return null;
                          return (
                            <img 
                              key={char.id}
                              src={asset.url}
                              className="absolute transition-all duration-500"
                              style={{ 
                                left: `${char.position.x}%`, 
                                top: `${char.position.y}%`,
                                transform: `translate(-50%, -50%) scale(${char.scale}) ${char.flip ? 'scaleX(-1)' : ''} ${char.flipVertical ? 'scaleY(-1)' : ''}`,
                                maxHeight: '90%'
                              }}
                              alt="Character"
                            />
                          );
                        })}
                      </div>

                      {/* Dialogue Box */}
                      {dialogue && (
                        <div 
                          className="absolute bottom-12 left-1/2 -translate-x-1/2 w-[80%] p-8 rounded-3xl border-2 border-pink-500/30 bg-black/80 backdrop-blur-xl cursor-pointer"
                          onClick={() => {
                            if (previewDialogueIndex < scene.dialogue.length - 1) {
                              setPreviewDialogueIndex(previewDialogueIndex + 1);
                            } else if (scene.nextSceneId) {
                              const nextIdx = week.vnData?.scenes.findIndex(s => s.id === scene.nextSceneId);
                              if (nextIdx !== undefined && nextIdx !== -1) {
                                setPreviewSceneIndex(nextIdx);
                                setPreviewDialogueIndex(0);
                              }
                            } else {
                              setShowPreview(false);
                            }
                          }}
                        >
                          <div className="text-pink-500 font-black text-sm uppercase tracking-widest mb-3">{dialogue.speaker}</div>
                          <div className="text-white text-2xl font-medium leading-relaxed">{dialogue.text}</div>
                          <div className="absolute bottom-4 right-6 animate-bounce text-pink-500/50">
                            <ChevronRight className="w-6 h-6" />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </AnimatePresence>

        {activeTab === 'assets' && (
          <div className="flex-1 p-8 overflow-y-auto custom-scrollbar">
            <div className="max-w-6xl mx-auto space-y-12">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-3xl font-black uppercase tracking-tighter text-white">Asset Manager</h2>
                  <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest">Manage your backgrounds, sprites, and audio</p>
                </div>
                <div className="flex gap-3">
                  <button 
                    onClick={() => setShowArchiveImport(true)}
                    className="flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-2xl font-black text-xs tracking-widest uppercase transition-all shadow-lg shadow-emerald-600/20"
                  >
                    <Archive className="w-4 h-4" />
                    Import Character
                  </button>
                  <button 
                    onClick={() => setShowArchiveBgImport(true)}
                    className="flex items-center gap-2 px-6 py-3 bg-cyan-600 hover:bg-cyan-500 rounded-2xl font-black text-xs tracking-widest uppercase transition-all shadow-lg shadow-cyan-600/20"
                  >
                    <Archive className="w-4 h-4" />
                    Import Background
                  </button>
                  <label className="flex items-center gap-2 px-6 py-3 bg-pink-600 hover:bg-pink-500 rounded-2xl font-black text-xs tracking-widest uppercase transition-all cursor-pointer shadow-lg shadow-pink-600/20">
                    <Upload className="w-4 h-4" />
                    Upload Assets
                    <input 
                      type="file" multiple accept="image/*,audio/*" className="hidden"
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []) as File[];
                        files.forEach(file => {
                          const reader = new FileReader();
                          reader.onload = (ev) => {
                            const assetType: VNAsset['type'] = file.type.startsWith('image') ? 'background' : 'music';
                            handleAddAsset(assetType, file.name.split('.')[0], ev.target?.result as string);
                          };
                          reader.readAsDataURL(file);
                        });
                      }}
                    />
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-6">
                {week.vnData?.assets.map(asset => (
                  <div key={asset.id} className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden group hover:border-zinc-600 transition-all">
                    <div className="aspect-square bg-zinc-950 flex items-center justify-center relative">
                      {asset.type === 'background' || asset.type === 'character' ? (
                        <img src={asset.url} className="w-full h-full object-contain p-4" alt={asset.name} />
                      ) : (
                        <Music className="w-12 h-12 text-zinc-800" />
                      )}
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button 
                          onClick={() => handleDeleteAsset(asset.id)}
                          className="p-3 bg-red-600 text-white rounded-full hover:scale-110 transition-transform"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                    <div className="p-4 bg-zinc-900/50 backdrop-blur-md">
                      <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">{asset.type}</div>
                      <div className="text-sm font-bold text-white truncate">{asset.name}</div>
                    </div>
                  </div>
                ))}
                {week.vnData?.assets.length === 0 && (
                  <div className="col-span-4 py-20 text-center border-2 border-dashed border-zinc-800 rounded-3xl">
                    <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-10" />
                    <p className="text-zinc-600 font-black uppercase tracking-widest">No assets uploaded yet</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'ai' && (
          <div className="flex-1 p-8 overflow-y-auto custom-scrollbar">
            <div className="max-w-4xl mx-auto space-y-8 pb-20">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Script File Import */}
                <div className="bg-pink-600/10 border border-pink-500/30 p-8 rounded-3xl space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-pink-600 rounded-2xl flex items-center justify-center shadow-lg shadow-pink-600/40">
                        <FileText className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h2 className="text-2xl font-black uppercase tracking-tighter text-white">Import Script</h2>
                        <p className="text-pink-400 text-[10px] font-black uppercase tracking-widest">From Text or File</p>
                      </div>
                    </div>
                    <button 
                      onClick={handleAutoLinkScenes}
                      className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-[10px] font-black tracking-widest uppercase transition-all"
                      title="Automatically link scenes in order"
                    >
                      Auto-Link Scenes
                    </button>
                  </div>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Paste your script text below or upload a .txt file. AI will parse speakers, dialogues, and choices automatically.
                  </p>

                  <div className="flex items-center gap-2 mb-2">
                    <input 
                      type="checkbox" 
                      id="clearExisting"
                      checked={clearExistingScript}
                      onChange={(e) => setClearExistingScript(e.target.checked)}
                      className="w-4 h-4 rounded border-zinc-800 bg-zinc-950 text-pink-600 focus:ring-pink-500"
                    />
                    <label htmlFor="clearExisting" className="text-xs font-bold text-zinc-400 uppercase tracking-widest cursor-pointer">
                      Clear existing scenes before parsing
                    </label>
                  </div>
                  
                  {isParsingScript && (
                    <div className="mb-4 bg-pink-600/10 border border-pink-500/30 p-4 rounded-2xl space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black text-pink-500 uppercase tracking-widest">
                          {week.vnData?.parsingStatus?.currentTask || 'AI Parsing Script...'}
                        </span>
                        <span className="text-[10px] font-black text-pink-500 uppercase tracking-widest">
                          {Math.round((parsingProgress.progress / parsingProgress.total) * 100)}%
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <motion.div 
                          className="h-full bg-pink-500"
                          initial={{ width: 0 }}
                          animate={{ width: `${(parsingProgress.progress / parsingProgress.total) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="space-y-4">
                    <textarea 
                      value={scriptText}
                      onChange={(e) => setScriptText(e.target.value)}
                      placeholder="Paste your script here..."
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl p-4 text-sm outline-none focus:border-pink-500 transition-all min-h-[150px] resize-none"
                    />
                    <div className="flex gap-3">
                      <button 
                        onClick={() => handleAIParseScript(scriptText)}
                        disabled={isParsingScript || !scriptText.trim()}
                        className="flex-1 py-4 bg-pink-600 hover:bg-pink-500 disabled:opacity-50 rounded-2xl font-black text-sm tracking-widest uppercase transition-all shadow-xl shadow-pink-600/20 flex items-center justify-center gap-3"
                      >
                        {isParsingScript ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                        Parse Text
                      </button>
                      <label className="px-6 py-4 bg-zinc-800 hover:bg-zinc-700 rounded-2xl font-black text-sm tracking-widest uppercase transition-all cursor-pointer flex items-center justify-center">
                        <Upload className="w-5 h-5" />
                        <input 
                          type="file" 
                          accept=".txt" 
                          className="hidden" 
                          onChange={handleScriptFileUpload}
                          disabled={isParsingScript}
                        />
                      </label>
                    </div>
                  </div>
                </div>

                {/* AI Thumbnail Generator */}
                <div className="bg-indigo-600/10 border border-indigo-500/30 p-8 rounded-3xl space-y-6">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-600/40">
                      <ImageIcon className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-black uppercase tracking-tighter text-white">Thumbnail Gen</h2>
                      <p className="text-indigo-400 text-[10px] font-black uppercase tracking-widest">AI Cover Art</p>
                    </div>
                  </div>
                  <textarea 
                    value={thumbnailPrompt}
                    onChange={(e) => setThumbnailPrompt(e.target.value)}
                    placeholder="Describe the cover art..."
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl p-4 text-sm outline-none focus:border-indigo-500 transition-all min-h-[120px] resize-none"
                  />
                  <button 
                    onClick={handleAIGenerateThumbnail}
                    disabled={isGeneratingThumbnail || !thumbnailPrompt.trim()}
                    className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-2xl font-black text-sm tracking-widest uppercase transition-all shadow-xl shadow-indigo-600/20 flex items-center justify-center gap-3"
                  >
                    {isGeneratingThumbnail ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                    Generate Thumbnail
                  </button>
                </div>
              </div>

              {/* AI Script Writer */}
              <div className="bg-purple-600/10 border border-purple-500/30 p-8 rounded-[40px] space-y-6">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-600/40">
                    <Sparkles className="w-8 h-8 text-white" />
                  </div>
                  <div>
                    <h2 className="text-3xl font-black uppercase tracking-tighter text-white italic">AI Story Generator</h2>
                    <p className="text-purple-400 text-[10px] font-black uppercase tracking-widest">Generate Full Script from Prompt</p>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <textarea 
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="Describe your story idea..."
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-[32px] p-8 text-lg outline-none focus:border-purple-500 transition-all min-h-[200px] resize-none shadow-inner"
                  />
                  <button 
                    onClick={handleAIGenerateScript}
                    disabled={isAIGenerating || !aiPrompt.trim()}
                    className="w-full py-5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-3xl font-black text-base tracking-widest uppercase transition-all active:scale-[0.98] shadow-2xl shadow-purple-600/30 flex items-center justify-center gap-4"
                  >
                    {isAIGenerating ? (
                      <>
                        <Loader2 className="w-6 h-6 animate-spin" />
                        GENERATING FULL STORY...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-6 h-6" />
                        GENERATE STORY SCRIPT
                      </>
                    )}
                  </button>
                </div>
              </div>

              {aiPreview && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-zinc-900 border-2 border-purple-500/50 rounded-[40px] overflow-hidden shadow-[0_0_100px_rgba(168,85,247,0.2)]"
                >
                  <div className="p-8 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/50 backdrop-blur-xl">
                    <div>
                      <h3 className="text-xl font-black uppercase tracking-tighter text-white italic">AI Script Preview</h3>
                      <p className="text-[10px] font-black text-purple-500 uppercase tracking-widest">Review and accept the generated content</p>
                    </div>
                    <div className="flex gap-4">
                      <button 
                        onClick={() => setAiPreview(null)}
                        className="px-8 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-2xl text-xs font-black tracking-widest uppercase transition-all"
                      >
                        Discard
                      </button>
                      <button 
                        onClick={acceptAIScript}
                        className="px-10 py-3 bg-purple-600 hover:bg-purple-500 rounded-2xl text-xs font-black tracking-widest uppercase transition-all shadow-xl shadow-purple-600/40"
                      >
                        Accept & Add to Project
                      </button>
                    </div>
                  </div>
                  <div className="p-8 space-y-8 max-h-[600px] overflow-y-auto custom-scrollbar bg-zinc-900/50">
                    {aiPreview.map((scene, i) => (
                      <div key={i} className="space-y-4 p-6 bg-zinc-950 rounded-[32px] border border-zinc-800 hover:border-purple-500/30 transition-all">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-black text-purple-500 uppercase tracking-widest italic">Scene {i + 1}: {scene.name}</div>
                          <div className="px-3 py-1 bg-zinc-900 rounded-full text-[8px] font-black text-zinc-500 uppercase tracking-widest">{(scene.dialogue || []).length} Lines</div>
                        </div>
                        <div className="space-y-3">
                          {(scene.dialogue || []).map((diag, j) => (
                            <div key={j} className="bg-zinc-900/50 p-4 rounded-2xl border border-zinc-800/50">
                              <div className="text-[10px] font-black text-purple-400 uppercase tracking-widest mb-1">{diag.speaker}</div>
                              <div className="text-sm text-zinc-300 leading-relaxed italic">"{diag.text}"</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </div>
          </div>
        )}
        {/* Archive Modals */}
        {showArchiveImport && (
          <ArchiveImportModal 
            onClose={() => setShowArchiveImport(false)} 
            onSelect={handleImportCharacterFromArchive} 
          />
        )}
        {showArchiveBgImport && (
          <ArchiveBackgroundImportModal 
            onClose={() => setShowArchiveBgImport(false)} 
            onSelect={handleImportBackgroundFromArchive} 
          />
        )}
      </div>
      {/* Batch Actions Bar */}
      <AnimatePresence>
        {selectedSceneIds.length > 0 && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-zinc-900/90 backdrop-blur-2xl border border-pink-500/50 rounded-[32px] p-6 flex items-center gap-8 shadow-[0_20px_50px_rgba(0,0,0,0.5)] z-[100]"
          >
            <div className="flex flex-col">
              <span className="text-[10px] font-black text-pink-500 uppercase tracking-[0.2em]">Batch Actions</span>
              <span className="text-lg font-black text-white italic uppercase tracking-tighter">{selectedSceneIds.length} Scenes</span>
            </div>
            
            <div className="h-12 w-px bg-zinc-800" />
            
            <div className="flex items-center gap-3">
              <button 
                onClick={() => setShowAssetPicker({ type: 'background', onSelect: handleBatchUpdateBg })}
                className="flex items-center gap-3 px-6 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-2xl text-[10px] font-black tracking-widest uppercase transition-all group"
              >
                <ImageIcon className="w-4 h-4 text-zinc-500 group-hover:text-pink-500 transition-colors" />
                Change Background
              </button>
              
              <button 
                onClick={() => {
                  const firstScene = week.vnData?.scenes.find(s => s.id === selectedSceneIds[0]);
                  if (firstScene) {
                    handleBatchUpdateChars(firstScene.characters);
                  }
                }}
                className="flex items-center gap-3 px-6 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-2xl text-[10px] font-black tracking-widest uppercase transition-all group"
              >
                <User className="w-4 h-4 text-zinc-500 group-hover:text-pink-500 transition-colors" />
                Sync Characters
              </button>
              
              <button 
                onClick={handleBatchDelete}
                className="flex items-center gap-3 px-6 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-2xl text-[10px] font-black tracking-widest uppercase transition-all group"
              >
                <Trash2 className="w-4 h-4 group-hover:scale-110 transition-transform" />
                Delete All
              </button>
            </div>

            <div className="h-12 w-px bg-zinc-800" />

            <button 
              onClick={() => setSelectedSceneIds([])}
              className="p-3 hover:bg-zinc-800 rounded-2xl text-zinc-500 hover:text-white transition-all"
            >
              <X className="w-6 h-6" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default VNEditor;
