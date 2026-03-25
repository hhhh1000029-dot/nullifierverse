import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, ArrowDown, ArrowUp, ArrowRight } from 'lucide-react';
import { sfxManager, bgmManager } from '../audio';

interface IntroSequenceProps {
  onComplete: () => void;
}

export const IntroSequence: React.FC<IntroSequenceProps> = ({ onComplete }) => {
  const [scene, setScene] = useState(1);
  console.log('IntroSequence: Rendering scene', scene);
  const [skipClicks, setSkipClicks] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const audioInitialized = useRef(false);

  useEffect(() => {
    console.log('IntroSequence: Component mounted');
    return () => console.log('IntroSequence: Component unmounted');
  }, []);

  useEffect(() => {
    console.log('IntroSequence: Scene changed to', scene);
    const timer = setTimeout(() => {
      if (scene === 1) {
        setScene(2);
      } else if (scene === 2) {
        setScene(3);
      }
    }, scene === 1 ? 2500 : 3000);

    return () => clearTimeout(timer);
  }, [scene]);

  useEffect(() => {
    // Play BGM (Menu) for Intro Screen
    bgmManager.play('menu');
    
    try {
      if (scene === 1) {
        // Use sfxManager for intro sounds
        // sfxManager.playGlitch(); // Need to implement or use generic
      } else if (scene === 2) {
        // sfxManager.playSwish();
      } else if (scene === 3) {
        // sfxManager.playPowerUp();
      }
    } catch (error) {
      console.error('IntroSequence: Audio playback error', error);
    }
  }, [scene]);

  const handleInteraction = () => {
    if (scene === 3 && !isTransitioning) {
      setIsTransitioning(true);
      try {
        sfxManager.playConfirm();
      } catch (error) {
        console.error('IntroSequence: Interaction audio error', error);
      }
      setTimeout(() => {
        onComplete();
      }, 500);
    }
  };

  const handleSkip = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newClicks = skipClicks + 1;
    setSkipClicks(newClicks);
    if (newClicks >= 3) {
      onComplete();
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-zinc-950 z-[100] overflow-hidden cursor-pointer"
      onClick={handleInteraction}
      onMouseDown={(e) => e.button === 0 && handleSkip(e)}
    >
      <div className="absolute top-2 left-2 w-2 h-2 bg-red-500 z-[200] opacity-50" title="DEBUG DOT" />
      <div className="crt-flicker" />
      {/* Background Grid & Cubes */}
      <div className="absolute inset-0 perspective-[1000px]">
        <div 
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `linear-gradient(rgba(0, 255, 255, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 255, 255, 0.2) 1px, transparent 1px)`,
            backgroundSize: '100px 100px',
            transform: 'rotateX(60deg) translateY(-200px) translateZ(-500px)',
            transformOrigin: 'top'
          }}
        />
        
        {/* Floating Cubes */}
        {[...Array(15)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-8 h-8 border border-cyan-500/30"
            initial={{ 
              x: Math.random() * (typeof window !== 'undefined' ? window.innerWidth : 1000), 
              y: (typeof window !== 'undefined' ? window.innerHeight : 1000) + 100,
              rotate: Math.random() * 360
            }}
            animate={{ 
              y: -200,
              rotate: Math.random() * 720,
              opacity: [0, 0.5, 0]
            }}
            transition={{ 
              duration: 10 + Math.random() * 10, 
              repeat: Infinity,
              ease: "linear",
              delay: Math.random() * 10
            }}
          />
        ))}
      </div>

      <div className="relative z-50 w-full h-full">
        <AnimatePresence mode="wait">
          {scene === 1 && (
            <motion.div
              key="scene1"
              className="absolute inset-0 flex items-center justify-center flex-col"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.5, filter: 'blur(20px)' }}
              transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
            >
              <motion.h1 
                className="text-4xl md:text-7xl font-black italic uppercase text-white font-pixel text-center leading-tight"
                style={{ textShadow: '4px 4px 0px #ff00ff' }}
                animate={{ 
                  x: [0, -2, 2, -1, 1, 0],
                  y: [0, 1, -1, 2, -2, 0],
                }}
                transition={{ 
                  duration: 0.1, 
                  repeat: Infinity,
                  repeatType: "mirror"
                }}
              >
                NULLIFIERVERSE<br/>PRESENT
              </motion.h1>
            </motion.div>
          )}

          {scene === 2 && (
            <motion.div
              key="scene2"
              className="absolute inset-0 flex items-center justify-center flex-col space-y-8"
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ opacity: 0, y: -50 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            >
              <h2 className="text-xl md:text-3xl font-pixel text-white text-center text-glow-cyan leading-relaxed max-w-4xl">
                A GAME INSPIRED BY<br/>FRIDAY NIGHT FUNKIN'
              </h2>
              
              <div className="flex gap-6">
                {[
                  { Icon: ArrowLeft, color: 'text-cyan-400', note: 261 },
                  { Icon: ArrowDown, color: 'text-green-400', note: 293 },
                  { Icon: ArrowUp, color: 'text-blue-400', note: 329 },
                  { Icon: ArrowRight, color: 'text-red-400', note: 349 }
                ].map((arrow, i) => (
                  <motion.div
                    key={i}
                    animate={{ 
                      scale: [1, 1.2, 1],
                      opacity: [0.5, 1, 0.5]
                    }}
                    transition={{ 
                      duration: 0.5, 
                      repeat: Infinity,
                      delay: i * 0.125
                    }}
                    onUpdate={(latest) => {
                      if (latest.scale && (latest.scale as number) > 1.15 && Math.random() > 0.9) {
                        try {
                          sfxManager.playHover();
                        } catch (error) {}
                      }
                    }}
                  >
                    <arrow.Icon className={`w-12 h-12 ${arrow.color} drop-shadow-[0_0_8px_currentColor]`} />
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {scene === 3 && (
            <motion.div
              key="scene3"
              className="absolute inset-0 flex items-center justify-center flex-col"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              {/* Technical Indicators */}
              <div className="absolute bottom-8 right-8 font-pixel text-[10px] text-cyan-500/40">Nullifier v.1.0.0</div>

              <motion.div
                className="flex flex-col items-center"
                animate={{ y: [0, -15, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              >
                <img src="/intro_logo.png" alt="NULLIFIERVERSE" className="w-80 md:w-[40rem] h-auto mb-4 animate-pulse-soft" />
              </motion.div>

              <motion.div
                className="mt-24 font-pixel text-white text-lg md:text-2xl"
                animate={{ opacity: [0, 1, 0] }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              >
                PRESS TO CONTINUE
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        
        {/* Fallback if scene is not 1, 2, or 3 */}
        {!([1, 2, 3].includes(scene)) && (
          <div className="absolute inset-0 flex items-center justify-center text-white font-pixel">
            SCENE ERROR: {scene}
          </div>
        )}
      </div>

      {/* Flash Effect */}
      <AnimatePresence>
        {isTransitioning && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-white z-[110]"
          />
        )}
      </AnimatePresence>

      {/* Skip Indicator */}
      {skipClicks > 0 && (
        <div className="absolute bottom-4 left-4 font-pixel text-[10px] text-white/20">
          SKIP: {skipClicks}/3
        </div>
      )}
    </div>
  );
};
