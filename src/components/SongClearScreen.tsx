import React from 'react';
import { motion } from 'motion/react';
import { Judgements } from '../RhythmGame';

interface SongClearScreenProps {
  songName: string;
  author: string;
  difficulty: string;
  clearTime: string;
  score: number;
  judgements: Judgements;
  maxCombo: number;
  onNext: () => void;
  onQuit: () => void;
  nextText?: string;
}

export const SongClearScreen: React.FC<SongClearScreenProps> = ({
  songName,
  author,
  difficulty,
  clearTime,
  score,
  judgements,
  maxCombo,
  onNext,
  onQuit,
  nextText = "NEXT SONG"
}) => {
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 overflow-hidden"
    >
      {/* Background Grid */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_80%_80%_at_50%_50%,#000_40%,transparent_100%)]" />

      {/* Floating Glitch Cubes */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(10)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-16 h-16 border-2 border-cyan-500/30 bg-cyan-500/10 backdrop-blur-sm"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              transform: `rotate(${Math.random() * 360}deg)`,
            }}
            animate={{
              y: [0, -20, 0],
              rotate: [0, 90, 180],
              opacity: [0.3, 0.6, 0.3],
            }}
            transition={{
              duration: 4 + Math.random() * 4,
              repeat: Infinity,
              ease: "linear",
            }}
          />
        ))}
      </div>

      <div className="relative w-full max-w-6xl p-8 flex flex-col h-full justify-center">
        {/* Title */}
        <motion.h1 
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-7xl font-black italic tracking-tighter mb-12 bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-600 text-transparent bg-clip-text drop-shadow-[0_0_15px_rgba(6,182,212,0.5)]"
          style={{ WebkitTextStroke: '1px rgba(255,255,255,0.2)' }}
        >
          SONG CLEARED
        </motion.h1>

        <div className="flex gap-12 w-full">
          {/* Left Section: Info Cards */}
          <motion.div 
            initial={{ x: -50, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="flex-1 space-y-4"
          >
            <div className="bg-cyan-600/20 border-l-4 border-cyan-400 p-6 transform -skew-x-12 backdrop-blur-md">
              <div className="transform skew-x-12">
                <p className="text-cyan-400 font-mono text-sm mb-1">TRACK INFO</p>
                <h2 className="text-3xl font-black text-white uppercase">{songName}</h2>
                <p className="text-zinc-400 font-medium">By {author}</p>
              </div>
            </div>

            <div className="bg-cyan-600/20 border-l-4 border-cyan-400 p-6 transform -skew-x-12 backdrop-blur-md">
              <div className="transform skew-x-12">
                <p className="text-cyan-400 font-mono text-sm mb-1">DIFFICULTY</p>
                <h2 className="text-2xl font-black text-white uppercase">{difficulty}</h2>
              </div>
            </div>

            <div className="bg-cyan-600/20 border-l-4 border-cyan-400 p-6 transform -skew-x-12 backdrop-blur-md">
              <div className="transform skew-x-12">
                <p className="text-cyan-400 font-mono text-sm mb-1">CLEAR TIME</p>
                <h2 className="text-2xl font-black text-white uppercase">{clearTime}</h2>
              </div>
            </div>
            
            <div className="bg-cyan-600/20 border-l-4 border-cyan-400 p-6 transform -skew-x-12 backdrop-blur-md">
              <div className="transform skew-x-12">
                <p className="text-cyan-400 font-mono text-sm mb-1">SCORE</p>
                <h2 className="text-4xl font-black text-white uppercase">{score.toLocaleString()}</h2>
              </div>
            </div>
          </motion.div>

          {/* Right Section: Detailed Performance */}
          <motion.div 
            initial={{ x: 50, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="flex-1"
          >
            <h3 className="text-2xl font-black text-cyan-400 italic mb-4">DETAILED PERFORMANCE</h3>
            <div className="bg-black/80 border-2 border-yellow-500 p-8 shadow-[0_0_30px_rgba(234,179,8,0.2)]">
              <div className="space-y-4 font-mono">
                {[
                  { label: 'Awesomes!', value: judgements.sick, color: 'text-cyan-400' },
                  { label: 'Sicks!', value: judgements.good, color: 'text-green-400' },
                  { label: 'Goods', value: judgements.bad, color: 'text-yellow-400' },
                  { label: 'Bads', value: judgements.shit, color: 'text-orange-400' },
                  { label: 'Misses', value: judgements.miss, color: 'text-red-500' },
                  { label: 'Max Combo', value: maxCombo, color: 'text-purple-400' },
                ].map((item, i) => (
                  <div key={i} className="flex justify-between items-end border-b border-zinc-800 pb-2">
                    <span className="text-sm italic underline text-zinc-400 uppercase">{item.label}</span>
                    <span className={`text-2xl font-black ${item.color}`}>{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>

        {/* Bottom Navigation */}
        <motion.div 
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="absolute bottom-8 left-8 right-8 flex justify-between items-end"
        >
          <button 
            onClick={onQuit}
            className="text-zinc-500 hover:text-white font-mono text-lg transition-colors flex items-center gap-2"
          >
            {'<'} Quit week
          </button>

          <motion.button
            whileHover={{ scale: 1.05, boxShadow: "0 0 20px rgba(234,179,8,0.5)" }}
            whileTap={{ scale: 0.95 }}
            onClick={onNext}
            className="bg-black border-2 border-yellow-500 text-white font-mono font-bold text-xl px-12 py-4 transform -skew-x-12 transition-all"
          >
            <span className="block transform skew-x-12">{nextText}</span>
          </motion.button>
        </motion.div>
      </div>
    </motion.div>
  );
};
