import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Music } from 'lucide-react';

interface NowPlayingOverlayProps {
  songName: string;
}

export const NowPlayingOverlay: React.FC<NowPlayingOverlayProps> = ({ songName }) => {
  const [isVisible, setIsVisible] = useState(false);
  const lastSongRef = React.useRef('');

  useEffect(() => {
    if (songName && songName !== lastSongRef.current) {
      lastSongRef.current = songName;
      setIsVisible(true);
      
      const timer = setTimeout(() => {
        setIsVisible(false);
      }, 1500); // 0.5s in + 1s stay = 1.5s before exit starts
      
      return () => clearTimeout(timer);
    }
  }, [songName]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ x: '120%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '120%', opacity: 0 }}
          transition={{ 
            duration: 0.5, 
            ease: [0.215, 0.61, 0.355, 1] // approx easeOutCubic
          }}
          className="fixed top-6 right-6 z-[9999] pointer-events-none"
        >
          <div className="relative group">
            {/* Main Container */}
            <div className="bg-black/60 backdrop-blur-md border border-cyan-500/30 rounded-lg p-4 flex items-center gap-4 shadow-[0_0_20px_rgba(6,182,212,0.2)] min-w-[280px] max-w-[400px]">
              
              {/* Neon Border Pulse Effect */}
              <motion.div
                animate={{ opacity: [0.3, 0.8, 0.3] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                className="absolute inset-0 border border-cyan-400/50 rounded-lg pointer-events-none shadow-[inset_0_0_10px_rgba(34,211,238,0.2)]"
              />
              
              {/* Icon Section */}
              <div className="relative">
                <div className="bg-cyan-500/10 p-2.5 rounded-full border border-cyan-500/20">
                  <Music className="text-cyan-400 w-6 h-6 drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
                </div>
                {/* Glow behind icon */}
                <div className="absolute inset-0 bg-cyan-400/20 blur-xl rounded-full -z-10" />
              </div>
              
              {/* Text Section */}
              <div className="flex flex-col overflow-hidden">
                <span className="text-[10px] font-bold text-purple-300/80 uppercase tracking-[0.2em] leading-none mb-1.5 drop-shadow-[0_0_5px_rgba(192,132,252,0.5)]">
                  Now Playing
                </span>
                <span className="text-white font-black text-base tracking-tight truncate drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]">
                  {songName}
                </span>
              </div>
            </div>
            
            {/* Decorative Corner Accents */}
            <div className="absolute -top-1 -left-1 w-2 h-2 border-t-2 border-l-2 border-cyan-400 rounded-tl-sm" />
            <div className="absolute -bottom-1 -right-1 w-2 h-2 border-b-2 border-r-2 border-cyan-400 rounded-br-sm" />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
