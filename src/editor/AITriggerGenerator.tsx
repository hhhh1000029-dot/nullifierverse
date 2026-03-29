import React, { useState } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { Zap, Sparkles, X, Upload, Music, FileText, Loader2, Wand2 } from 'lucide-react';
import { SavedStage, ChartEvent, MoveTriggerData, ShaderTriggerData, FadeTriggerData } from './EditorTypes';

interface AITriggerGeneratorProps {
  stage: SavedStage;
  onUpdate: (newEvents: ChartEvent[]) => void;
  onClose: () => void;
}

const AITriggerGenerator: React.FC<AITriggerGeneratorProps> = ({ stage, onUpdate, onClose }) => {
  const [prompt, setPrompt] = useState('');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [startStep, setStartStep] = useState(0);
  const [endStep, setEndStep] = useState(100);
  const [isGenerating, setIsGenerating] = useState(false);
  const [lyrics, setLyrics] = useState('');
  const [musicFile, setMusicFile] = useState<File | null>(null);
  const [clearExisting, setClearExisting] = useState(false);

  const setFullRange = () => {
    const maxNoteStep = (stage.chart?.notes || []).reduce((max, n) => Math.max(max, (n.step || 0) + (n.length || 0)), 0);
    const maxEventStep = (stage.chart?.events || []).reduce((max, e) => Math.max(max, e.step || 0), 0);
    setStartStep(0);
    setEndStep(Math.max(maxNoteStep, maxEventStep, 100));
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const systemInstruction = `You are an expert modchart and visual effects generator for a rhythm game (similar to Friday Night Funkin' or StepMania).
      Your goal is to generate a comprehensive list of ChartEvents that create a dynamic, professional, and visually stunning experience.
      
      Difficulty Levels:
      - 'easy': Subtle effects, occasional camera zooms, simple fades. (approx. 5-10 events per 100 steps)
      - 'medium': Noticeable camera shakes, more frequent shader effects, character movements. (approx. 15-25 events per 100 steps)
      - 'hard': INTENSE modcharts. Constant camera movement, frequent shader glitches, rapid rotations, complex opacity changes, and synchronized text. (approx. 40-60+ events per 100 steps)
      
      Event Types & Value Structures:
      1. 'move': { target: 'player'|'opponent'|'lane', movementType: 'timed'|'instant', duration: number (steps), x: number, y: number, easing: 'linear'|'easeIn'|'easeOut'|'easeInOut' }
      2. 'shader': { shaderType: 'glitch'|'chromatic_glitch'|'lens_circle'|'hue'|'gray_scale', intensity: number (0-1), duration: number (steps), mode: 'pulse'|'constant'|'fade_in'|'fade_out', params: object }
      3. 'fade': { target: 'player'|'opponent'|'lane'|'hud'|'background', from: number (0-1), to: number (0-1), duration: number (steps) }
      4. 'camera_shake': { intensity: number, duration: number (steps) }
      5. 'camera_zoom': { zoom: number, duration: number (steps), easing: string }
      6. 'flash': { intensity: number, fadeInDuration: number (steps), holdDuration: number (steps), fadeOutDuration: number (steps), rainbow: boolean }
      7. 'rotate': { target: 'player'|'opponent'|'lane', rotations: number, duration: number (steps), easing: string }
      8. 'opacity': { target: 'player'|'opponent'|'lane', opacity: number, duration: number (steps) }
      9. 'scroll_speed': { speed: number, duration: number (steps) }
      10. 'add_text': { text: string, x: number, y: number, duration: number (steps), size: number, color: string }
      
      Guidelines:
      - Synchronize effects with the lyrics and beat.
      - Use 'hard' difficulty to create "impossible" looking modcharts with constant motion.
      - Ensure events are spread across the requested step range.
      - For 'hard', don't be afraid to stack multiple effects (e.g., a camera shake + chromatic aberration + character move all at once).
      - Return ONLY a JSON array of ChartEvent objects.`;

      const userMessage = `Prompt: ${prompt}\nLyrics: ${lyrics}\nMusic Context: ${musicFile ? 'Music file provided' : 'No music file'}\nStep Range: ${startStep} to ${endStep}\nDifficulty: ${difficulty}`;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview", // Use pro for better reasoning and more events
        contents: userMessage,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                step: { type: Type.INTEGER },
                type: { type: Type.STRING, enum: ['move', 'shader', 'fade', 'camera_shake', 'camera_zoom', 'flash', 'rotate', 'opacity', 'scroll_speed', 'add_text'] },
                value: { type: Type.OBJECT }
              },
              required: ['id', 'step', 'type', 'value']
            }
          }
        }
      });

      const generatedEvents: ChartEvent[] = JSON.parse(response.text);
      
      // Filter events within range and ensure IDs
      const validEvents = generatedEvents.filter(e => e.step >= startStep && e.step <= endStep).map(e => ({
        ...e,
        id: e.id || crypto.randomUUID()
      }));

      const finalEvents = clearExisting 
        ? validEvents 
        : [...(stage.chart?.events || []), ...validEvents];
      
      onUpdate(finalEvents);
      onClose();
    } catch (error) {
      console.error('AI Generation Error:', error);
      alert('Failed to generate triggers. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 border-bottom border-zinc-800 flex items-center justify-between bg-zinc-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">AI Trigger Generator</h2>
              <p className="text-xs text-zinc-400">Generate modcharts and effects using AI</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-800 rounded-full transition-colors text-zinc-400 hover:text-white">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Difficulty Selection */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Intensity Level</label>
            <div className="grid grid-cols-3 gap-3">
              {(['easy', 'medium', 'hard'] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDifficulty(d)}
                  className={`py-3 px-4 rounded-xl border transition-all flex flex-col items-center gap-1 ${
                    difficulty === d
                      ? 'bg-indigo-500/20 border-indigo-500 text-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.2)]'
                      : 'bg-zinc-800/50 border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
                  }`}
                >
                  <span className="text-sm font-bold capitalize">{d}</span>
                  <span className="text-[10px] opacity-60">
                    {d === 'easy' ? 'Subtle' : d === 'medium' ? 'Dynamic' : 'Intense'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Step Range */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Step Range</label>
              <button 
                onClick={setFullRange}
                className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-medium"
              >
                Set Full Song Range
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-500 uppercase">Start Step</label>
                <input
                  type="number"
                  value={startStep}
                  onChange={(e) => setStartStep(parseInt(e.target.value))}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-500 uppercase">End Step</label>
                <input
                  type="number"
                  value={endStep}
                  onChange={(e) => setEndStep(parseInt(e.target.value))}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
              </div>
            </div>
          </div>

          {/* Options */}
          <div className="flex items-center gap-3 p-4 bg-zinc-800/30 rounded-xl border border-zinc-800">
            <input
              type="checkbox"
              id="clearExisting"
              checked={clearExisting}
              onChange={(e) => setClearExisting(e.target.checked)}
              className="w-4 h-4 rounded border-zinc-700 bg-zinc-800 text-indigo-600 focus:ring-indigo-500"
            />
            <label htmlFor="clearExisting" className="text-sm text-zinc-300 cursor-pointer">
              Clear existing triggers in this range before adding new ones
            </label>
          </div>

          {/* Prompt Input */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-500 uppercase flex items-center gap-2">
              <Wand2 className="w-3 h-3" /> AI Prompt (Optional)
            </label>
            <textarea
              placeholder="e.g., Make the screen shake during the drop, add glitch effects on high notes..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 h-24 resize-none placeholder:text-zinc-600"
            />
          </div>

          {/* Lyrics Input */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-500 uppercase flex items-center gap-2">
              <FileText className="w-3 h-3" /> Lyrics (Optional)
            </label>
            <textarea
              placeholder="Paste lyrics here to help AI synchronize effects with words..."
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 h-32 resize-none placeholder:text-zinc-600"
            />
          </div>

          {/* Music Upload (Mock for now, as we can't process audio directly easily in this context without more complex setup) */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-500 uppercase flex items-center gap-2">
              <Music className="w-3 h-3" /> Music Context
            </label>
            <div className="border-2 border-dashed border-zinc-800 rounded-xl p-6 flex flex-col items-center justify-center gap-2 hover:border-zinc-700 transition-colors cursor-pointer group">
              <Upload className="w-6 h-6 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
              <span className="text-sm text-zinc-500 group-hover:text-zinc-300">Upload audio file for analysis</span>
              <input type="file" accept="audio/*" className="hidden" onChange={(e) => setMusicFile(e.target.files?.[0] || null)} />
              {musicFile && <span className="text-xs text-indigo-400 mt-1">{musicFile.name}</span>}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-top border-zinc-800 bg-zinc-900/50 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-xl bg-zinc-800 text-white font-bold hover:bg-zinc-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="flex-[2] py-3 px-4 rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(79,70,229,0.3)]"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Zap className="w-5 h-5 fill-current" />
                Generate Triggers
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AITriggerGenerator;
