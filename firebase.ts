import React, { useState, useEffect } from 'react';
import { Search, X, Image, FileText, AlertCircle, Copy, ClipboardPaste, Download, Upload, Play } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ArchiveCharacter, ArchiveBackground, CharacterData } from './EditorTypes';
import { loadArchiveCharacters, loadArchiveBackgrounds, saveArchiveCharacters } from './Storage';
import LZString from 'lz-string';

const CharacterPreview: React.FC<{ character: CharacterData }> = ({ character }) => {
  const [frame, setFrame] = useState(0);
  const idleAnim = character.animations.find(a => a.name.toLowerCase().includes('idle')) || character.animations[0];

  useEffect(() => {
    if (!idleAnim) return;
    if (!idleAnim.image2) {
      setFrame(0);
      return;
    }

    const interval = setInterval(() => {
      setFrame(f => (f === 0 ? 1 : 0));
    }, (1 / (idleAnim.fps || 24)) * 1000 + (idleAnim.delay || 0) * 1000);

    return () => clearInterval(interval);
  }, [idleAnim]);

  if (!character.image && (!idleAnim || !idleAnim.image)) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-zinc-950 rounded-3xl">
        <FileText className="w-12 h-12 text-zinc-800" />
      </div>
    );
  }

  const currentImage = frame === 0 
    ? (idleAnim?.image || character.image) 
    : (idleAnim?.image2 || idleAnim?.image || character.image);

  return (
    <div className="w-full h-full flex items-center justify-center bg-zinc-950 rounded-3xl overflow-hidden relative border border-white/5 p-8">
      <div className="relative flex items-center justify-center w-full h-full">
        <img 
          src={currentImage} 
          className="max-w-full max-h-full object-contain transition-transform duration-300"
          alt={character.name}
          referrerPolicy="no-referrer"
          style={{
            transform: `scale(${character.scale || 1}) ${character.flipX ? 'scaleX(-1)' : ''} translate(${idleAnim ? -idleAnim.offset.x : 0}px, ${idleAnim ? -idleAnim.offset.y : 0}px)`
          }}
        />
      </div>
      <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1 rounded-full border border-white/10">
        <p className="text-[10px] font-black text-pink-500 uppercase tracking-widest flex items-center gap-2">
          <Play className="w-3 h-3 fill-current" /> Preview: {idleAnim?.name || 'Default'}
        </p>
      </div>
    </div>
  );
};

export const ArchiveImportModal: React.FC<{ 
  onClose: () => void; 
  onSelect: (char: ArchiveCharacter) => void 
}> = ({ onClose, onSelect }) => {
  const [characters, setCharacters] = useState<ArchiveCharacter[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedChar, setSelectedChar] = useState<ArchiveCharacter | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await loadArchiveCharacters();
      setCharacters(data);
    } catch (err) {
      console.error('Failed to load archive characters:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCopy = (char: ArchiveCharacter) => {
    const data = JSON.stringify(char.data);
    const compressed = LZString.compressToEncodedURIComponent(data);
    navigator.clipboard.writeText(compressed);
    // Could add a toast here
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const decompressed = LZString.decompressFromEncodedURIComponent(text);
      if (!decompressed) throw new Error('Invalid data');
      const data = JSON.parse(decompressed) as CharacterData;
      
      const newChar: ArchiveCharacter = {
        id: crypto.randomUUID(),
        data
      };
      
      const updated = [...characters, newChar];
      await saveArchiveCharacters(updated);
      setCharacters(updated);
    } catch (err) {
      console.error('Failed to paste character:', err);
      alert('Failed to paste character. Make sure you have valid character data in your clipboard.');
    }
  };

  const handleDownload = (char: ArchiveCharacter) => {
    const data = JSON.stringify(char.data, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${char.data.name}_archive.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const data = JSON.parse(event.target?.result as string) as CharacterData;
          const newChar: ArchiveCharacter = {
            id: crypto.randomUUID(),
            data
          };
          const updated = [...characters, newChar];
          await saveArchiveCharacters(updated);
          setCharacters(updated);
        } catch (err) {
          console.error('Failed to upload character:', err);
          alert('Invalid character file');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const filtered = characters.filter(c => 
    c.data.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-8 bg-black/90 backdrop-blur-xl">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-zinc-900 border border-white/10 rounded-[40px] w-full max-w-6xl h-[85vh] overflow-hidden flex flex-col shadow-2xl"
      >
        <div className="p-8 border-b border-white/5 flex items-center justify-between bg-zinc-900/50 backdrop-blur-md">
          <div>
            <h2 className="text-2xl font-black text-white uppercase italic tracking-widest">Character Archive</h2>
            <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest mt-1">Manage and import characters from your global archive</p>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={handleUpload}
              className="flex items-center gap-2 px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/5 rounded-2xl text-white font-black uppercase tracking-widest text-[10px] transition-all"
            >
              <Upload className="w-4 h-4" /> Upload
            </button>
            <button 
              onClick={handlePaste}
              className="flex items-center gap-2 px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/5 rounded-2xl text-white font-black uppercase tracking-widest text-[10px] transition-all"
            >
              <ClipboardPaste className="w-4 h-4" /> Paste
            </button>
            <button onClick={onClose} className="p-3 hover:bg-white/5 rounded-2xl text-zinc-500 hover:text-white transition-all">
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* List Section */}
          <div className="w-2/3 flex flex-col border-r border-white/5 bg-zinc-950/20">
            <div className="p-6 border-b border-white/5">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                <input 
                  type="text"
                  placeholder="Search archive..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-zinc-900 border border-white/5 rounded-2xl py-4 pl-12 pr-4 text-white font-bold placeholder:text-zinc-700 focus:outline-none focus:border-pink-500/50 transition-all"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-20 gap-4">
                  <div className="w-12 h-12 border-4 border-pink-500/20 border-t-pink-500 rounded-full animate-spin" />
                  <p className="text-zinc-500 font-black uppercase tracking-widest text-xs">Loading Archive...</p>
                </div>
              ) : filtered.length > 0 ? (
                <div className="grid grid-cols-2 gap-4">
                  {filtered.map(char => (
                    <motion.div
                      key={char.id}
                      whileHover={{ y: -2 }}
                      className={`relative bg-zinc-900 border rounded-3xl p-4 text-left group transition-all cursor-pointer ${selectedChar?.id === char.id ? 'border-pink-500 bg-pink-500/5' : 'border-white/5 hover:border-white/10'}`}
                      onClick={() => setSelectedChar(char)}
                    >
                      <div className="flex gap-4">
                        <div className="w-16 h-16 bg-zinc-950 rounded-xl overflow-hidden border border-white/5 flex-shrink-0">
                          {char.data.image ? (
                            <img src={char.data.image} className="w-full h-full object-contain p-1" alt={char.data.name} referrerPolicy="no-referrer" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <FileText className="w-6 h-6 text-zinc-800" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-black text-white uppercase italic truncate">{char.data.name}</h3>
                          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1">
                            {char.data.animations.length} Poses
                          </p>
                          <div className="flex gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleCopy(char); }}
                              className="p-1.5 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-colors"
                              title="Copy to Clipboard"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleDownload(char); }}
                              className="p-1.5 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-colors"
                              title="Download JSON"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-20 bg-white/5 rounded-[32px] border-2 border-dashed border-white/5">
                  <AlertCircle className="w-12 h-12 text-zinc-800 mx-auto mb-4" />
                  <p className="text-zinc-500 font-black uppercase tracking-widest text-sm">No characters found</p>
                </div>
              )}
            </div>
          </div>

          {/* Preview Section */}
          <div className="w-1/3 flex flex-col bg-zinc-900/50 p-8">
            {selectedChar ? (
              <div className="flex flex-col h-full">
                <div className="flex-1 mb-8">
                  <div className="text-zinc-500 font-black uppercase tracking-widest text-[10px] mb-4 flex items-center gap-2">
                    <Image className="w-3 h-3" /> Character Preview
                  </div>
                  <div className="aspect-[3/4] w-full">
                    <CharacterPreview character={selectedChar.data} />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="bg-zinc-950/50 rounded-2xl p-4 border border-white/5">
                    <h4 className="text-white font-black uppercase italic text-lg mb-1">{selectedChar.data.name}</h4>
                    <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">
                      Scale: {selectedChar.data.scale} • FlipX: {selectedChar.data.flipX ? 'Yes' : 'No'}
                    </p>
                  </div>

                  <button 
                    onClick={() => onSelect(selectedChar)}
                    className="w-full py-4 bg-pink-600 hover:bg-pink-500 text-white font-black uppercase tracking-widest rounded-2xl shadow-lg shadow-pink-600/20 transition-all flex items-center justify-center gap-3"
                  >
                    Import Character
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6 border border-white/5">
                  <Image className="w-8 h-8 text-zinc-700" />
                </div>
                <p className="text-zinc-500 font-black uppercase tracking-widest text-xs">Select a character<br/>to see preview</p>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};


export const ArchiveBackgroundImportModal: React.FC<{ 
  onClose: () => void; 
  onSelect: (bg: ArchiveBackground) => void 
}> = ({ onClose, onSelect }) => {
  const [backgrounds, setBackgrounds] = useState<ArchiveBackground[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const data = await loadArchiveBackgrounds();
        setBackgrounds(data);
      } catch (err) {
        console.error('Failed to load archive backgrounds:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filtered = backgrounds.filter(bg => 
    bg.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-8 bg-black/90 backdrop-blur-xl">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-zinc-900 border border-white/10 rounded-[40px] w-full max-w-4xl max-h-[80vh] overflow-hidden flex flex-col shadow-2xl"
      >
        <div className="p-8 border-b border-white/5 flex items-center justify-between bg-zinc-900/50 backdrop-blur-md">
          <div>
            <h2 className="text-2xl font-black text-white uppercase italic tracking-widest">Import Background</h2>
            <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest mt-1">Select a background from your archive</p>
          </div>
          <button onClick={onClose} className="p-3 hover:bg-white/5 rounded-2xl text-zinc-500 hover:text-white transition-all">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 bg-zinc-950/50 border-b border-white/5">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
            <input 
              type="text"
              placeholder="Search backgrounds..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-zinc-900 border border-white/5 rounded-2xl py-4 pl-12 pr-4 text-white font-bold placeholder:text-zinc-700 focus:outline-none focus:border-cyan-500/50 transition-all"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-12 h-12 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin" />
              <p className="text-zinc-500 font-black uppercase tracking-widest text-xs">Loading Archive...</p>
            </div>
          ) : filtered.length > 0 ? (
            <div className="grid grid-cols-3 gap-6">
              {filtered.map(bg => (
                <motion.button
                  key={bg.id}
                  whileHover={{ y: -5, scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => onSelect(bg)}
                  className="bg-zinc-900 border border-white/5 rounded-3xl p-4 text-left group hover:border-cyan-500/30 transition-all hover:shadow-2xl hover:shadow-cyan-500/10"
                >
                  <div className="aspect-video bg-zinc-950 rounded-2xl mb-4 overflow-hidden relative border border-white/5">
                    <img src={bg.url} className="w-full h-full object-cover" alt={bg.name} referrerPolicy="no-referrer" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <h3 className="text-lg font-black text-white uppercase italic truncate">{bg.name}</h3>
                </motion.button>
              ))}
            </div>
          ) : (
            <div className="text-center py-20 bg-white/5 rounded-[32px] border-2 border-dashed border-white/5">
              <Image className="w-12 h-12 text-zinc-800 mx-auto mb-4" />
              <p className="text-zinc-500 font-black uppercase tracking-widest text-sm">No backgrounds found in archive</p>
              <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest mt-1">Add backgrounds to the Archive from the Main Menu</p>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};
