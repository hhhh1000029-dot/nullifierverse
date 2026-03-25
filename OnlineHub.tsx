import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Music, ChevronRight, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { VNProject, VNScene, VNDialogueStyle } from '../editor/EditorTypes';
import { bgmManager } from '../audio';

interface VNPlayerProps {
  vnData: VNProject;
  startSceneId: string;
  onComplete: () => void;
  onChoice?: (choiceId: string) => void;
  onMusicChange?: (musicName: string) => void;
}

const VNPlayer: React.FC<VNPlayerProps> = ({ vnData, startSceneId, onComplete, onChoice, onMusicChange }) => {
  const [currentSceneId, setCurrentSceneId] = useState(startSceneId);
  const [currentDialogueIndex, setCurrentDialogueIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isTextAnimating, setIsTextAnimating] = useState(false);
  const [displayedText, setDisplayedText] = useState('');

  const [isShowingChoices, setIsShowingChoices] = useState(false);

  const currentScene = vnData.scenes.find(s => s.id === currentSceneId);
  const currentDialogue = currentScene?.dialogue[currentDialogueIndex];
  const currentStyle = vnData.styles.find(s => s.id === currentDialogue?.styleId) || vnData.styles[0];

  const handleChoice = (nextId: string | null) => {
    if (nextId) {
      setCurrentSceneId(nextId);
      setCurrentDialogueIndex(0);
      setIsShowingChoices(false);
    } else {
      onComplete();
    }
  };

  const next = useCallback(() => {
    if (!currentScene) return;

    if (currentDialogueIndex < currentScene.dialogue.length - 1) {
      setCurrentDialogueIndex(currentDialogueIndex + 1);
    } else if (currentScene.choices && currentScene.choices.length > 0) {
      setIsShowingChoices(true);
    } else if (currentScene.nextSceneId) {
      setCurrentSceneId(currentScene.nextSceneId);
      setCurrentDialogueIndex(0);
    } else {
      onComplete();
    }
  }, [currentScene, currentDialogueIndex, onComplete]);

  useEffect(() => {
    if (currentScene?.musicId) {
      const musicAsset = vnData.assets.find(a => a.id === currentScene.musicId);
      if (musicAsset) {
        bgmManager.loadTrack(musicAsset.id, musicAsset.url).then(() => {
          bgmManager.play(musicAsset.id);
          onMusicChange?.(musicAsset.name);
        });
      }
    }
  }, [currentScene?.musicId, vnData.assets, onMusicChange]);

  useEffect(() => {
    if (!currentDialogue) return;
    
    setDisplayedText('');
    setIsTextAnimating(true);
    let i = 0;
    const interval = setInterval(() => {
      setDisplayedText(currentDialogue.text.slice(0, i + 1));
      i++;
      if (i >= currentDialogue.text.length) {
        clearInterval(interval);
        setIsTextAnimating(false);
      }
    }, 30);

    return () => clearInterval(interval);
  }, [currentDialogue]);

  if (!currentScene) return null;

  const background = vnData.assets.find(a => a.id === currentScene.backgroundId);

  const getEffectProps = (effect?: string) => {
    switch (effect) {
      case 'glow':
        return {
          animate: { filter: ['drop-shadow(0 0 0px rgba(255,255,255,0))', 'drop-shadow(0 0 15px rgba(255,255,255,0.8))', 'drop-shadow(0 0 0px rgba(255,255,255,0))'] },
          transition: { repeat: Infinity, duration: 2 }
        };
      case 'zoom':
        return {
          animate: { scale: [1, 1.05, 1] },
          transition: { repeat: Infinity, duration: 3 }
        };
      case 'float':
        return {
          animate: { y: [0, -15, 0] },
          transition: { repeat: Infinity, duration: 4, ease: "easeInOut" }
        };
      case 'shake':
        return {
          animate: { x: [-2, 2, -2, 2, 0] },
          transition: { repeat: Infinity, duration: 0.2 }
        };
      case 'brighten':
        return {
          animate: { brightness: [1, 1.3, 1] },
          transition: { repeat: Infinity, duration: 2 }
        };
      default:
        return {};
    }
  };

  return (
    <div className="fixed inset-0 bg-black overflow-hidden flex flex-col items-center justify-center">
      {/* Background */}
      <AnimatePresence mode="wait">
        <motion.div 
          key={currentScene.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1 }}
          className="absolute inset-0"
        >
          {background && (
            <img src={background.url} className="w-full h-full object-cover" alt="Background" />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Characters */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <AnimatePresence>
          {currentScene.characters.map(char => {
            const charDef = vnData.characters.find(c => c.id === char.characterId);
            const expression = charDef?.expressions.find(e => e.id === char.expressionId);
            const assetId = expression?.assetId || char.assetId;
            const asset = vnData.assets.find(a => a.id === assetId);
            
            if (!asset) return null;

            const effectProps = getEffectProps(char.highlightEffect);
            const filters = char.filters || { brightness: 100, contrast: 100, saturation: 100 };
            const filterStr = `brightness(${filters.brightness}%) contrast(${filters.contrast}%) saturate(${filters.saturation}%)`;

            return (
              <motion.div
                key={char.id}
                initial={{ opacity: 0, y: 50 }}
                animate={{ 
                  opacity: char.opacity ?? 1, 
                  y: 0,
                  ...effectProps.animate 
                }}
                exit={{ opacity: 0, y: 50 }}
                transition={{ 
                  duration: 0.5,
                  ...(effectProps.transition || {})
                }}
                className="absolute"
                style={{ 
                  left: `${char.position.x}%`, 
                  top: `${char.position.y}%`,
                  transform: `translate(-50%, -50%) scale(${char.scale}) ${char.flip ? 'scaleX(-1)' : ''}`,
                  zIndex: char.zIndex || 10,
                  filter: filterStr
                }}
              >
                <img 
                  src={asset.url} 
                  className={`max-h-[85vh] object-contain drop-shadow-2xl ${char.highlightEffect === 'glow' ? 'drop-shadow-[0_0_15px_rgba(255,255,255,0.8)]' : ''}`} 
                  alt="Character" 
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Dialogue Box */}
      <div 
        className="absolute bottom-12 left-1/2 -translate-x-1/2 w-full max-w-4xl cursor-pointer select-none z-[100]"
        onClick={() => {
          if (isShowingChoices) return;
          isTextAnimating ? setDisplayedText(currentDialogue?.text || '') : next();
        }}
      >
        <AnimatePresence>
          {isShowingChoices && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="absolute bottom-full left-0 right-0 mb-8 flex flex-col gap-3"
            >
              {currentScene.choices?.map((choice) => (
                <button
                  key={choice.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleChoice(choice.nextSceneId);
                  }}
                  className="w-full p-5 bg-black/80 backdrop-blur-xl border-2 border-pink-500/50 hover:bg-pink-600 hover:text-white rounded-2xl font-black uppercase tracking-widest text-sm transition-all active:scale-[0.98] shadow-2xl"
                >
                  {choice.text}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            backgroundColor: currentStyle.backgroundColor,
            borderRadius: currentStyle.borderRadius,
            border: `${currentStyle.borderWidth} solid ${currentStyle.borderColor}`,
            boxShadow: currentStyle.boxShadow,
            color: currentStyle.fontColor,
            fontFamily: currentStyle.fontFamily,
            fontSize: currentStyle.fontSize
          }}
          className="p-8 relative"
        >
          {/* Name Tag */}
          {currentDialogue?.speaker && (
            <div 
              className="absolute -top-10 left-6 font-black uppercase tracking-widest text-xs"
              style={{
                backgroundColor: currentStyle.nameTagStyle.syncWithBox ? currentStyle.backgroundColor : currentStyle.nameTagStyle.backgroundColor,
                color: currentStyle.nameTagStyle.syncWithBox ? currentStyle.fontColor : currentStyle.nameTagStyle.fontColor,
                borderRadius: currentStyle.nameTagStyle.borderRadius,
                padding: currentStyle.nameTagStyle.padding,
                border: currentStyle.nameTagStyle.syncWithBox ? `${currentStyle.borderWidth} solid ${currentStyle.borderColor}` : 'none',
              }}
            >
              {currentDialogue.speaker}
            </div>
          )}

          <div className="min-h-[80px] leading-relaxed">
            {displayedText}
            {!isTextAnimating && (
              <motion.span
                animate={{ opacity: [0, 1, 0] }}
                transition={{ repeat: Infinity, duration: 1 }}
                className="inline-block ml-1 w-2 h-4 bg-current align-middle"
              />
            )}
          </div>

          <div className="absolute bottom-4 right-6 flex items-center gap-4 text-zinc-500">
            <button onClick={(e) => { e.stopPropagation(); onComplete(); }} className="hover:text-white transition-colors">
              <SkipForward className="w-4 h-4" />
            </button>
            <button onClick={(e) => { e.stopPropagation(); setIsMuted(!isMuted); }} className="hover:text-white transition-colors">
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <ChevronRight className="w-5 h-5 animate-pulse" />
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default VNPlayer;
