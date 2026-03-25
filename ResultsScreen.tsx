import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, Plus, Edit2, Trash2, Image as ImageIcon, User, Save, 
  ChevronLeft, Upload, Play, Check, AlertCircle, Search,
  Heart, Music, Settings, Info
} from 'lucide-react';
import { 
  ArchiveCharacter, ArchiveBackground, CharacterData, Animation, 
  HealthIcons, CustomNotes 
} from '../editor/EditorTypes';
import { 
  loadArchiveCharacters, saveArchiveCharacters, 
  loadArchiveBackgrounds, saveArchiveBackgrounds 
} from '../editor/Storage';

interface ArchiveMenuProps {
  onBack: () => void;
}

const DEFAULT_ANIMATIONS: Animation[] = [
  { name: 'idle', prefix: 'idle', indices: [], fps: 24, loop: true, offset: { x: 0, y: 0 } },
  { name: 'left', prefix: 'left', indices: [], fps: 24, loop: false, offset: { x: 0, y: 0 } },
  { name: 'down', prefix: 'down', indices: [], fps: 24, loop: false, offset: { x: 0, y: 0 } },
  { name: 'up', prefix: 'up', indices: [], fps: 24, loop: false, offset: { x: 0, y: 0 } },
  { name: 'right', prefix: 'right', indices: [], fps: 24, loop: false, offset: { x: 0, y: 0 } },
];

export const ArchiveMenu: React.FC<ArchiveMenuProps> = ({ onBack }) => {
  const [activeTab, setActiveTab] = useState<'CHARACTERS' | 'BACKGROUNDS'>('CHARACTERS');
  const [characters, setCharacters] = useState<ArchiveCharacter[]>([]);
  const [backgrounds, setBackgrounds] = useState<ArchiveBackground[]>([]);
  const [editingCharacter, setEditingCharacter] = useState<ArchiveCharacter | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      const chars = await loadArchiveCharacters();
      const bgs = await loadArchiveBackgrounds();
      setCharacters(chars);
      setBackgrounds(bgs);
    };
    loadData();
  }, []);

  const handleAddCharacter = () => {
    const newChar: ArchiveCharacter = {
      id: `char_${Date.now()}`,
      data: {
        name: 'New Character',
        image: '',
        xml: '',
        animations: [...DEFAULT_ANIMATIONS],
        scale: 1,
        flipX: false,
        healthIcons: {
          normal: '',
          win: '',
          lose: ''
        },
        customNotes: {
          falling: '',
          hit: '',
          holdColor: '#ff00ff'
        }
      }
    };
    setCharacters([...characters, newChar]);
    setEditingCharacter(newChar);
  };

  const handleDeleteCharacter = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this character?')) {
      const newChars = characters.filter(c => c.id !== id);
      setCharacters(newChars);
      await saveArchiveCharacters(newChars);
    }
  };

  const handleSaveCharacter = async (updatedChar: ArchiveCharacter) => {
    setIsSaving(true);
    const newChars = characters.map(c => c.id === updatedChar.id ? updatedChar : c);
    setCharacters(newChars);
    await saveArchiveCharacters(newChars);
    setEditingCharacter(null);
    setIsSaving(false);
  };

  const handleAddBackground = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = async (event) => {
          const url = event.target?.result as string;
          const name = file.name.split('.')[0];
          const newBg: ArchiveBackground = {
            id: `bg_${Date.now()}`,
            name,
            url
          };
          const newBgs = [...backgrounds, newBg];
          setBackgrounds(newBgs);
          await saveArchiveBackgrounds(newBgs);
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  };

  const handleDeleteBackground = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this background?')) {
      const newBgs = backgrounds.filter(b => b.id !== id);
      setBackgrounds(newBgs);
      await saveArchiveBackgrounds(newBgs);
    }
  };

  const handleRenameBackground = async (id: string, newName: string) => {
    const newBgs = backgrounds.map(b => b.id === id ? { ...b, name: newName } : b);
    setBackgrounds(newBgs);
    await saveArchiveBackgrounds(newBgs);
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-zinc-950 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="h-20 bg-zinc-900/50 backdrop-blur-xl border-b border-white/5 flex items-center justify-between px-8 shrink-0">
        <div className="flex items-center gap-6">
          <button 
            onClick={onBack}
            className="p-3 hover:bg-white/5 rounded-2xl text-zinc-400 hover:text-white transition-all group"
          >
            <ChevronLeft className="w-6 h-6 group-hover:-translate-x-1 transition-transform" />
          </button>
          <div>
            <h2 className="text-2xl font-black text-white italic tracking-tighter uppercase">Archive</h2>
            <p className="text-[10px] font-bold text-zinc-500 tracking-[0.2em] uppercase">Resource Management</p>
          </div>
        </div>

        <div className="flex bg-zinc-800/50 p-1 rounded-2xl border border-white/5">
          <button 
            onClick={() => setActiveTab('CHARACTERS')}
            className={`px-6 py-2 rounded-xl text-xs font-black tracking-widest uppercase transition-all ${activeTab === 'CHARACTERS' ? 'bg-pink-500 text-white shadow-[0_0_20px_rgba(236,72,153,0.3)]' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            Characters
          </button>
          <button 
            onClick={() => setActiveTab('BACKGROUNDS')}
            className={`px-6 py-2 rounded-xl text-xs font-black tracking-widest uppercase transition-all ${activeTab === 'BACKGROUNDS' ? 'bg-pink-500 text-white shadow-[0_0_20px_rgba(236,72,153,0.3)]' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            Backgrounds
          </button>
        </div>

        <div className="w-64 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input 
            type="text"
            placeholder="Search resources..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-zinc-800/50 border border-white/5 rounded-xl py-2 pl-11 pr-4 text-xs font-bold text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-pink-500/50 transition-all"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <AnimatePresence mode="wait">
          {activeTab === 'CHARACTERS' ? (
            <motion.div 
              key="characters"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
            >
              <button 
                onClick={handleAddCharacter}
                className="aspect-[4/5] rounded-[32px] border-2 border-dashed border-zinc-800 hover:border-pink-500/50 hover:bg-pink-500/5 flex flex-col items-center justify-center gap-4 transition-all group"
              >
                <div className="w-16 h-16 rounded-2xl bg-zinc-900 flex items-center justify-center text-zinc-500 group-hover:text-pink-500 group-hover:scale-110 transition-all">
                  <Plus className="w-8 h-8" />
                </div>
                <span className="text-xs font-black tracking-widest text-zinc-500 group-hover:text-pink-500 uppercase">Add Character</span>
              </button>

              {characters.filter(c => c.data.name.toLowerCase().includes(searchTerm.toLowerCase())).map(char => (
                <div 
                  key={char.id}
                  className="aspect-[4/5] rounded-[32px] bg-zinc-900 border border-white/5 overflow-hidden flex flex-col group relative"
                >
                  <div className="flex-1 relative overflow-hidden bg-zinc-800/50 flex items-center justify-center p-8">
                    {char.data.image ? (
                      <img 
                        src={char.data.animations.find(a => a.name === 'idle')?.image || char.data.image} 
                        alt={char.data.name}
                        className="w-full h-full object-contain group-hover:scale-110 transition-transform duration-500"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <User className="w-16 h-16 text-zinc-700" />
                    )}
                    
                    <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent opacity-60" />
                    
                    <div className="absolute bottom-4 left-4 flex items-center gap-3">
                      {char.data.healthIcons?.normal && (
                        <img src={char.data.healthIcons.normal} alt="Icon" className="w-8 h-8 rounded-lg bg-zinc-900 border border-white/10 p-1" referrerPolicy="no-referrer" />
                      )}
                    </div>
                  </div>

                  <div className="p-6 bg-zinc-900 relative">
                    <h3 className="text-lg font-black text-white italic uppercase truncate mb-1">{char.data.name}</h3>
                    <p className="text-[10px] font-bold text-zinc-500 tracking-widest uppercase mb-4">
                      {char.data.animations.length} Animations
                    </p>

                    <div className="flex gap-2">
                      <button 
                        onClick={() => setEditingCharacter(char)}
                        className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white py-2 rounded-xl text-[10px] font-black tracking-widest uppercase transition-all flex items-center justify-center gap-2"
                      >
                        <Edit2 className="w-3 h-3" />
                        Edit
                      </button>
                      <button 
                        onClick={() => handleDeleteCharacter(char.id)}
                        className="w-10 h-10 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-xl flex items-center justify-center transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </motion.div>
          ) : (
            <motion.div 
              key="backgrounds"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
            >
              <button 
                onClick={handleAddBackground}
                className="aspect-video rounded-[32px] border-2 border-dashed border-zinc-800 hover:border-cyan-500/50 hover:bg-cyan-500/5 flex flex-col items-center justify-center gap-4 transition-all group"
              >
                <div className="w-16 h-16 rounded-2xl bg-zinc-900 flex items-center justify-center text-zinc-500 group-hover:text-cyan-500 group-hover:scale-110 transition-all">
                  <Plus className="w-8 h-8" />
                </div>
                <span className="text-xs font-black tracking-widest text-zinc-500 group-hover:text-cyan-500 uppercase">Upload Background</span>
              </button>

              {backgrounds.filter(b => b.name.toLowerCase().includes(searchTerm.toLowerCase())).map(bg => (
                <div 
                  key={bg.id}
                  className="aspect-video rounded-[32px] bg-zinc-900 border border-white/5 overflow-hidden flex flex-col group relative"
                >
                  <img 
                    src={bg.url} 
                    alt={bg.name}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                    referrerPolicy="no-referrer"
                  />
                  
                  <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-6">
                    <div className="flex items-center justify-between gap-4">
                      <input 
                        type="text"
                        defaultValue={bg.name}
                        onBlur={(e) => handleRenameBackground(bg.id, e.target.value)}
                        className="flex-1 bg-black/50 backdrop-blur-md border border-white/10 rounded-xl px-3 py-1.5 text-xs font-bold text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      />
                      <button 
                        onClick={() => handleDeleteBackground(bg.id)}
                        className="w-8 h-8 bg-red-500/20 hover:bg-red-500/40 text-red-500 rounded-lg flex items-center justify-center transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Character Editor Modal */}
      <AnimatePresence>
        {editingCharacter && (
          <CharacterArchiveEditor 
            character={editingCharacter}
            onClose={() => setEditingCharacter(null)}
            onSave={handleSaveCharacter}
            isSaving={isSaving}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
};

interface CharacterArchiveEditorProps {
  character: ArchiveCharacter;
  onClose: () => void;
  onSave: (char: ArchiveCharacter) => void;
  isSaving: boolean;
}

const CharacterArchiveEditor: React.FC<CharacterArchiveEditorProps> = ({ character, onClose, onSave, isSaving }) => {
  const [data, setData] = useState<CharacterData>({ ...character.data });
  const [activePose, setActivePose] = useState('idle');

  const handleFileUpload = (type: 'image' | 'xml' | 'icon_normal' | 'icon_win' | 'icon_lose' | 'pose', poseName?: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = type === 'xml' ? '.xml' : 'image/*';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const result = event.target?.result as string;
          if (type === 'image') setData({ ...data, image: result });
          if (type === 'xml') setData({ ...data, xml: result });
          if (type.startsWith('icon_')) {
            const iconType = type.split('_')[1] as keyof HealthIcons;
            setData({
              ...data,
              healthIcons: {
                ...data.healthIcons!,
                [iconType]: result
              }
            });
          }
          if (type === 'pose' && poseName) {
            setData({
              ...data,
              animations: data.animations.map(a => a.name === poseName ? { ...a, image: result } : a)
            });
          }
        };
        if (type === 'xml') reader.readAsText(file);
        else reader.readAsDataURL(file);
      }
    };
    input.click();
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-md flex items-center justify-center p-8"
    >
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="w-full max-w-6xl h-full bg-zinc-900 rounded-[40px] border border-white/10 flex flex-col overflow-hidden shadow-2xl"
      >
        {/* Modal Header */}
        <div className="h-20 bg-zinc-800/50 border-b border-white/5 flex items-center justify-between px-10">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-pink-500 flex items-center justify-center text-white">
              <Edit2 className="w-5 h-5" />
            </div>
            <div>
              <input 
                type="text"
                value={data.name}
                onChange={(e) => setData({ ...data, name: e.target.value })}
                className="bg-transparent text-xl font-black text-white italic uppercase focus:outline-none focus:ring-1 focus:ring-pink-500 rounded px-2"
              />
              <p className="text-[10px] font-bold text-zinc-500 tracking-widest uppercase">Editing Archive Character</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button 
              onClick={onClose}
              className="px-6 py-2 rounded-xl text-xs font-black tracking-widest uppercase text-zinc-500 hover:text-white transition-all"
            >
              Cancel
            </button>
            <button 
              onClick={() => onSave({ ...character, data })}
              disabled={isSaving}
              className="px-8 py-2 bg-pink-500 hover:bg-pink-400 disabled:bg-zinc-700 text-white rounded-xl text-xs font-black tracking-widest uppercase shadow-[0_0_20px_rgba(236,72,153,0.3)] transition-all flex items-center gap-2"
            >
              {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Changes
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel: Settings */}
          <div className="w-80 border-r border-white/5 p-8 overflow-y-auto custom-scrollbar space-y-8">
            {/* Health Icons */}
            <section>
              <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                <Heart className="w-3 h-3" /> Health Icons
              </h4>
              <div className="grid grid-cols-3 gap-3">
                {(['normal', 'win', 'lose'] as const).map(type => (
                  <button 
                    key={type}
                    onClick={() => handleFileUpload(`icon_${type}` as any)}
                    className="aspect-square rounded-xl bg-zinc-800 border border-white/5 flex flex-col items-center justify-center gap-2 group relative overflow-hidden"
                  >
                    {data.healthIcons?.[type] ? (
                      <img src={data.healthIcons[type]} alt={type} className="w-full h-full object-contain p-2" referrerPolicy="no-referrer" />
                    ) : (
                      <Upload className="w-4 h-4 text-zinc-600 group-hover:text-pink-500 transition-colors" />
                    )}
                    <span className="text-[8px] font-black uppercase text-zinc-600 group-hover:text-white transition-colors">{type}</span>
                  </button>
                ))}
              </div>
            </section>

            {/* Custom Notes */}
            <section>
              <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                <Music className="w-3 h-3" /> Custom Notes
              </h4>
              <div className="space-y-3">
                <div className="bg-zinc-800/50 p-3 rounded-xl border border-white/5">
                  <label className="text-[8px] font-black text-zinc-600 uppercase mb-2 block">Hold Color</label>
                  <div className="flex items-center gap-3">
                    <input 
                      type="color" 
                      value={data.customNotes?.holdColor || '#ff00ff'}
                      onChange={(e) => setData({ ...data, customNotes: { ...data.customNotes, holdColor: e.target.value } })}
                      className="w-8 h-8 rounded bg-transparent border-none cursor-pointer"
                    />
                    <span className="text-[10px] font-mono text-zinc-400">{data.customNotes?.holdColor || '#ff00ff'}</span>
                  </div>
                </div>
                <button 
                  onClick={() => handleFileUpload('pose', 'note_falling' as any)}
                  className="w-full bg-zinc-800/50 p-3 rounded-xl border border-white/5 flex items-center justify-between group"
                >
                  <span className="text-[10px] font-black text-zinc-400 uppercase">Note Falling</span>
                  <Upload className="w-3 h-3 text-zinc-600 group-hover:text-pink-500" />
                </button>
                <button 
                  onClick={() => handleFileUpload('pose', 'note_hit' as any)}
                  className="w-full bg-zinc-800/50 p-3 rounded-xl border border-white/5 flex items-center justify-between group"
                >
                  <span className="text-[10px] font-black text-zinc-400 uppercase">Note Hit</span>
                  <Upload className="w-3 h-3 text-zinc-600 group-hover:text-pink-500" />
                </button>
              </div>
            </section>

            {/* General Settings */}
            <section>
              <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                <Settings className="w-3 h-3" /> General
              </h4>
              <div className="space-y-4">
                <div>
                  <label className="text-[8px] font-black text-zinc-600 uppercase mb-2 block">Scale ({data.scale})</label>
                  <input 
                    type="range" min="0.1" max="3" step="0.1"
                    value={data.scale}
                    onChange={(e) => setData({ ...data, scale: parseFloat(e.target.value) })}
                    className="w-full accent-pink-500"
                  />
                </div>
                <button 
                  onClick={() => setData({ ...data, flipX: !data.flipX })}
                  className={`w-full py-2 rounded-xl text-[10px] font-black tracking-widest uppercase border transition-all ${data.flipX ? 'bg-pink-500/10 border-pink-500 text-pink-500' : 'bg-zinc-800 border-white/5 text-zinc-500'}`}
                >
                  Flip Horizontal: {data.flipX ? 'ON' : 'OFF'}
                </button>
              </div>
            </section>
          </div>

          {/* Center: Preview */}
          <div className="flex-1 bg-black/50 relative flex flex-col">
            <div className="absolute inset-0 flex items-center justify-center p-20">
              <div className="w-full h-full border-2 border-dashed border-white/5 rounded-[40px] flex items-center justify-center relative overflow-hidden">
                {/* Grid Background */}
                <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
                
                <AnimatePresence mode="wait">
                  <motion.div 
                    key={activePose}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 1.1 }}
                    className="relative z-10"
                  >
                    {data.animations.find(a => a.name === activePose)?.image ? (
                      <img 
                        src={data.animations.find(a => a.name === activePose)!.image} 
                        alt={activePose}
                        className="max-w-full max-h-[500px] object-contain drop-shadow-[0_0_50px_rgba(236,72,153,0.2)]"
                        style={{ transform: `scale(${data.scale}) ${data.flipX ? 'scaleX(-1)' : ''}` }}
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="text-center">
                        <AlertCircle className="w-12 h-12 text-zinc-800 mx-auto mb-4" />
                        <p className="text-zinc-700 font-black uppercase text-xs tracking-widest">No image for {activePose}</p>
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>

                <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-zinc-900/80 backdrop-blur-md border border-white/10 px-6 py-2 rounded-full flex items-center gap-4">
                  <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Previewing:</span>
                  <span className="text-xs font-black text-white uppercase italic">{activePose}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Panel: Poses */}
          <div className="w-80 border-l border-white/5 p-8 overflow-y-auto custom-scrollbar">
            <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
              <Play className="w-3 h-3" /> Animation Poses
            </h4>
            <div className="space-y-3">
              {data.animations.map(anim => (
                <div 
                  key={anim.name}
                  className={`group p-4 rounded-2xl border transition-all cursor-pointer ${activePose === anim.name ? 'bg-pink-500/10 border-pink-500' : 'bg-zinc-800/50 border-white/5 hover:border-white/20'}`}
                  onClick={() => setActivePose(anim.name)}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className={`text-xs font-black uppercase italic ${activePose === anim.name ? 'text-pink-500' : 'text-zinc-400'}`}>
                      {anim.name}
                    </span>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleFileUpload('pose', anim.name);
                      }}
                      className="p-2 bg-zinc-900 rounded-lg text-zinc-500 hover:text-pink-500 transition-colors"
                    >
                      <Upload className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="aspect-square rounded-xl bg-zinc-900 border border-white/5 flex items-center justify-center overflow-hidden">
                    {anim.image ? (
                      <img src={anim.image} alt={anim.name} className="w-full h-full object-contain p-2" referrerPolicy="no-referrer" />
                    ) : (
                      <ImageIcon className="w-4 h-4 text-zinc-800" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

const RefreshCw: React.FC<{ className?: string }> = ({ className }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    width="24" height="24" 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
);
