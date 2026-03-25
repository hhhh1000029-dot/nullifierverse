import React, { useEffect, useState, useRef } from 'react';
import { motion } from 'motion/react';
import { sfxManager, bgmManager } from '../audio';

interface Judgements {
  sick: number;
  good: number;
  bad: number;
  shit: number;
  miss: number;
}

interface SongResult {
  stageName: string;
  score: number;
  judgements: Judgements;
  maxCombo: number;
}

interface ResultsScreenProps {
  type: 'SONG_CLEARED' | 'WEEK_COMPLETE';
  results: { score: number; judgements: Judgements; maxCombo: number; reason?: string };
  songName?: string;
  author?: string;
  difficulty?: string;
  clearTime?: string;
  accuracy: number;
  rank: string;
  weekResults?: SongResult[];
  onNext: () => void;
  onBack: () => void;
  nextText: string;
  backText: string;
}

export const ResultsScreen: React.FC<ResultsScreenProps> = ({
  type,
  results,
  songName,
  author,
  difficulty,
  clearTime,
  accuracy,
  rank,
  weekResults,
  onNext,
  onBack,
  nextText,
  backText
}) => {
  const [bgmVolume, setBgmVolume] = useState(100);
  const sliderRef = useRef<HTMLDivElement>(null);

  const handleVolumeChange = (e: React.MouseEvent | React.TouchEvent) => {
    if (!sliderRef.current) return;
    const rect = sliderRef.current.getBoundingClientRect();
    let clientX = 0;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
    } else {
      clientX = (e as React.MouseEvent).clientX;
    }
    
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percentage = Math.round((x / rect.width) * 100);
    setBgmVolume(percentage);
    bgmManager.setVolume(percentage / 100);
  };

  useEffect(() => {
    // Play a triumphant sound effect when the screen appears
    if (results.reason === 'FAILED') {
      sfxManager.playLoss();
    } else {
      sfxManager.playWin();
    }
  }, [type, results.reason]);

  // Generate random cubes
  const [cubes] = useState(() => 
    Array.from({ length: 15 }).map((_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 20 + 10,
      duration: Math.random() * 10 + 10,
      delay: Math.random() * 5,
    }))
  );

  const containerVariants = {
    hidden: { opacity: 0, scale: 0.95 },
    visible: { 
      opacity: 1, 
      scale: 1,
      transition: { duration: 0.5, ease: "easeOut", staggerChildren: 0.1 }
    },
    exit: { 
      opacity: 0, 
      scale: 0.95,
      transition: { duration: 0.3, ease: "easeIn" }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
    exit: { opacity: 0, y: 20, transition: { duration: 0.3, ease: "easeIn" } }
  };

  const buttonVariants = {
    hidden: { opacity: 0, x: -20 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.4, ease: "easeOut" } },
    exit: { opacity: 0, x: 20, transition: { duration: 0.3, ease: "easeIn" } },
    hover: { scale: 1.05, filter: "brightness(1.2)" }
  };

  const rightButtonVariants = {
    hidden: { opacity: 0, x: 20 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.4, ease: "easeOut" } },
    exit: { opacity: 0, x: -20, transition: { duration: 0.3, ease: "easeIn" } },
    hover: { scale: 1.05, filter: "brightness(1.2)" }
  };

  return (
    <motion.div 
      className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/90 overflow-hidden font-mono"
      initial="hidden"
      animate="visible"
      exit="exit"
      variants={containerVariants}
      style={{
        backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px)',
        backgroundSize: '40px 40px'
      }}
    >
      {/* Background Cubes */}
      {cubes.map(cube => (
        <motion.div
          key={cube.id}
          className="absolute border border-cyan-500/30 bg-cyan-900/10"
          style={{
            width: cube.size,
            height: cube.size,
            left: `${cube.x}%`,
            top: `${cube.y}%`,
            boxShadow: '0 0 10px rgba(6, 182, 212, 0.2), inset 0 0 10px rgba(6, 182, 212, 0.2)'
          }}
          animate={{
            y: [0, -100, 0],
            rotate: [0, 180, 360],
            opacity: [0.2, 0.5, 0.2]
          }}
          transition={{
            duration: cube.duration,
            repeat: Infinity,
            delay: cube.delay,
            ease: "linear"
          }}
        />
      ))}

      <motion.div 
        className="relative w-full max-w-6xl p-8 flex flex-col h-full max-h-[90vh]"
        whileHover={{ x: [0, -2, 2, -1, 1, 0], transition: { duration: 0.3 } }}
      >
        {/* Header */}
        <motion.h1 
          variants={itemVariants}
          className="text-6xl md:text-7xl font-black uppercase italic tracking-tighter mb-8"
          style={{
            background: 'linear-gradient(to right, #00f2fe, #4facfe, #f093fb, #f5576c, #ff9a9e)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            textShadow: '0 0 20px rgba(255,255,255,0.2)'
          }}
        >
          {type === 'SONG_CLEARED' ? 'SONG CLEARED' : 'WEEK COMPLETE'}
        </motion.h1>

        <div className="flex flex-col md:flex-row gap-8 flex-1 min-h-0">
          {/* Left Column - Stats Cards */}
          <div className="flex-1 flex flex-col gap-4">
            {type === 'SONG_CLEARED' ? (
              <>
                <StatCard label="1. Song" value={`${songName || 'Unknown'} / Author: ${author || 'Unknown'}`} />
                <StatCard label="2. Clear Time" value={clearTime || '00:00'} />
                <StatCard label="3. Difficulty" value={difficulty || '⭐⭐⭐⭐'} />
                <StatCard label="4. Avg. Accuracy" value={`${accuracy.toFixed(1)}%`} />
              </>
            ) : (
              <>
                <StatCard label="1. Clear Time" value={clearTime || '00:00'} />
                <StatCard label="2. Avg. Accuracy" value={`${accuracy.toFixed(1)}%`} />
                <StatCard label="3. Rank" value={rank} />
                <StatCard label="4. Total Score" value={results.score.toLocaleString()} />
                
                {/* Customization Button for Week Complete as requested */}
                <motion.div 
                  variants={itemVariants}
                  className="mt-4 relative group cursor-pointer"
                  whileHover={{ scale: 1.02 }}
                >
                  <div className="absolute inset-0 bg-blue-500/20 blur-md rounded-lg group-hover:bg-blue-400/30 transition-all"></div>
                  <div className="relative bg-zinc-900 border-2 border-blue-500 p-4 rounded-lg flex flex-col skew-x-[-10deg]">
                    <div className="skew-x-[10deg]">
                      <span className="text-blue-400 font-bold text-xl">3. CUSTOMIZATION</span>
                      <span className="text-zinc-400 text-sm ml-2">(Background/BGM)</span>
                      
                      <div className="mt-4 space-y-2">
                        <div className="flex justify-between text-xs text-pink-400 font-bold">
                          <span>BGM VOLUME</span>
                          <span>{bgmVolume}%</span>
                        </div>
                        <div 
                          ref={sliderRef}
                          className="h-2 bg-zinc-800 rounded-full overflow-hidden border border-pink-500/30 cursor-pointer"
                          onMouseDown={(e) => {
                            handleVolumeChange(e);
                            const handleMouseMove = (e: MouseEvent) => handleVolumeChange(e as any);
                            const handleMouseUp = () => {
                              window.removeEventListener('mousemove', handleMouseMove);
                              window.removeEventListener('mouseup', handleMouseUp);
                            };
                            window.addEventListener('mousemove', handleMouseMove);
                            window.addEventListener('mouseup', handleMouseUp);
                          }}
                          onTouchStart={(e) => {
                            handleVolumeChange(e);
                            const handleTouchMove = (e: TouchEvent) => handleVolumeChange(e as any);
                            const handleTouchEnd = () => {
                              window.removeEventListener('touchmove', handleTouchMove);
                              window.removeEventListener('touchend', handleTouchEnd);
                            };
                            window.addEventListener('touchmove', handleTouchMove);
                            window.addEventListener('touchend', handleTouchEnd);
                          }}
                        >
                          <div 
                            className="h-full bg-pink-500 shadow-[0_0_10px_#ec4899] transition-all duration-75" 
                            style={{ width: `${bgmVolume}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              </>
            )}
          </div>

          {/* Right Column - Detailed Performance */}
          <motion.div 
            variants={itemVariants}
            className="flex-[1.5] relative flex flex-col"
          >
            {/* Outer glowing border */}
            <div className="absolute inset-0 bg-yellow-500/20 blur-xl rounded-2xl skew-x-[-10deg]"></div>
            
            {/* Main Panel */}
            <div className="relative flex-1 bg-zinc-900 border-4 border-yellow-500 rounded-xl p-6 flex flex-col skew-x-[-10deg] shadow-[0_0_30px_rgba(234,179,8,0.3)]">
              <div className="skew-x-[10deg] flex flex-col h-full">
                
                {type === 'SONG_CLEARED' ? (
                  <>
                    <h2 className="text-blue-400 font-bold text-2xl mb-4 tracking-wider">DETAILED PERFORMANCE:</h2>
                    
                    <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-lg mb-6">
                      <JudgementRow label="Awesomes!" value={0} color="text-cyan-400" />
                      <JudgementRow label="Bads:" value={results.judgements.bad} color="text-pink-500" />
                      <JudgementRow label="Sicks!:" value={results.judgements.sick} color="text-green-400" />
                      <JudgementRow label="Shits:" value={results.judgements.shit} color="text-orange-500" />
                      <JudgementRow label="Goods:" value={results.judgements.good} color="text-yellow-400" />
                      <JudgementRow label="Misses:" value={results.judgements.miss} color="text-red-500" />
                    </div>

                    <div className="space-y-4 mt-auto">
                      <div className="flex justify-between items-center text-xl">
                        <span className="text-pink-500 font-bold">MAX COMBO:</span>
                        <span className="text-white font-bold">{results.maxCombo}</span>
                      </div>
                      <div className="flex justify-between items-center text-2xl">
                        <span className="text-green-400 font-bold">FINAL SCORE:</span>
                        <span className="text-white font-bold">{results.score.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between items-center text-2xl">
                        <span className="text-yellow-400 font-bold">OVERALL RANK:</span>
                        <span className="text-yellow-400 font-black text-4xl italic">{rank}</span>
                      </div>
                    </div>
                    
                    {/* Progress Bar */}
                    <div className="mt-6">
                      <div className="h-4 rounded-full overflow-hidden border border-zinc-700 p-0.5">
                        <div className="h-full rounded-full w-full" style={{ background: 'linear-gradient(to right, #a855f7, #06b6d4, #22c55e)' }}></div>
                      </div>
                      <p className="text-center text-xs text-zinc-400 mt-2">Total Song Progression</p>
                    </div>
                  </>
                ) : (
                  <>
                    <h2 className="text-blue-400 font-bold text-2xl mb-4 tracking-wider">SONG RESULTS:</h2>
                    <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar mb-4 space-y-2">
                      {weekResults?.map((res, idx) => (
                        <div key={idx} className="flex justify-between items-center text-lg">
                          <span className="text-white">{idx + 1}. {res.stageName}:</span>
                          <span className="text-green-400">😁</span>
                          <span className="text-zinc-300">&lt;Score: {res.score.toLocaleString()}&gt;</span>
                        </div>
                      ))}
                    </div>

                    <h2 className="text-pink-500 font-bold text-xl mb-2 tracking-wider">JUDGEMENT COUNT:</h2>
                    <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-base mb-4">
                      <JudgementRow label="Sicks:" value={results.judgements.sick} color="text-green-400" />
                      <JudgementRow label="Shits:" value={results.judgements.shit} color="text-orange-500" />
                      <JudgementRow label="Goods:" value={results.judgements.good} color="text-cyan-400" />
                      <JudgementRow label="Bads:" value={results.judgements.bad} color="text-pink-500" />
                      <JudgementRow label="Misses:" value={results.judgements.miss} color="text-red-500" />
                    </div>

                    <div className="flex justify-between items-center text-2xl mt-auto">
                      <span className="text-yellow-400 font-bold">OVERALL RANK:</span>
                      <span className="text-yellow-400 font-black text-4xl italic">{rank}!</span>
                    </div>

                    {/* Progress Bar */}
                    <div className="mt-4">
                      <div className="h-4 rounded-full overflow-hidden border border-zinc-700 p-0.5">
                        <div className="h-full rounded-full w-full" style={{ background: 'linear-gradient(to right, #a855f7, #06b6d4, #22c55e)' }}></div>
                      </div>
                      <p className="text-center text-xs text-zinc-400 mt-2">Total Week Progression</p>
                    </div>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </div>

        {/* Footer Buttons */}
        <div className="flex justify-between items-end mt-8">
          <motion.button
            variants={buttonVariants}
            whileHover="hover"
            whileTap={{ scale: 0.95 }}
            onClick={onBack}
            className="text-zinc-500 font-bold text-xl hover:text-zinc-300 transition-colors uppercase"
          >
            &lt;- {backText}
          </motion.button>

          <motion.button
            variants={rightButtonVariants}
            whileHover="hover"
            whileTap={{ scale: 0.95 }}
            onClick={onNext}
            className="relative group"
          >
            <div className="absolute inset-0 bg-yellow-500/20 blur-md rounded-lg group-hover:bg-yellow-400/40 transition-all"></div>
            <div className="relative bg-zinc-900 border-2 border-yellow-500 px-12 py-4 rounded-lg skew-x-[-15deg] shadow-[0_0_15px_rgba(234,179,8,0.5)]">
              <span className="block skew-x-[15deg] text-white font-black text-2xl tracking-widest uppercase">
                {nextText}
              </span>
            </div>
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
};

const StatCard = ({ label, value }: { label: string, value: string | React.ReactNode }) => {
  const itemVariants = {
    hidden: { opacity: 0, x: -20 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.4, ease: "easeOut" } }
  };

  return (
    <motion.div 
      variants={itemVariants}
      className="relative group"
      whileHover={{ scale: 1.02, x: 10 }}
    >
      <div className="absolute inset-0 bg-cyan-500/20 blur-md rounded-lg group-hover:bg-cyan-400/40 transition-all"></div>
      <div className="relative bg-zinc-900 border-2 border-cyan-500 p-4 rounded-lg flex items-center skew-x-[-15deg] shadow-[0_0_15px_rgba(6,182,212,0.3)]">
        <div className="skew-x-[15deg] flex items-center gap-2 w-full">
          <span className="text-cyan-400 font-black text-xl">&gt;</span>
          <span className="text-white font-bold text-lg whitespace-nowrap overflow-hidden text-ellipsis">{label}:</span>
          <span className="text-white font-medium text-lg ml-auto whitespace-nowrap overflow-hidden text-ellipsis">{value}</span>
        </div>
      </div>
    </motion.div>
  );
};

const JudgementRow = ({ label, value, color }: { label: string, value: number, color: string }) => (
  <div className="flex justify-between items-center">
    <span className={`${color} font-bold italic underline decoration-2 underline-offset-4`}>{label}</span>
    <span className="text-white font-bold">{value}</span>
  </div>
);

