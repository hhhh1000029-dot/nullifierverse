export interface Offset {
  x: number;
  y: number;
}

export interface Animation {
  name: string;
  prefix: string;
  indices: number[];
  fps: number;
  loop: boolean;
  offset: Offset;
  image?: string; // Optional separate image for this specific pose (Frame 1)
  image2?: string; // Optional second image for animation (Frame 2)
  delay?: number; // Delay in seconds between frames
  scale?: number; // Optional scale override for this specific pose
  flipX?: boolean; // Optional horizontal flip for this specific pose
}

export interface HealthIcons {
  win: string;
  normal: string;
  lose: string;
  isSpriteSheet?: boolean;
  spriteSheetUrl?: string;
  frames?: {
    normal: number;
    win: number;
    lose: number;
  };
}

export interface CustomNotes {
  falling?: string;
  hit?: string;
  holdColor?: string;
  specialFalling?: string;
  specialHit?: string;
}

export interface CharacterData {
  name: string;
  image: string; // URL or base64
  xml: string; // XML content
  animations: Animation[];
  scale: number;
  flipX: boolean;
  healthIcons?: HealthIcons;
  customNotes?: CustomNotes;
}

export interface ExtraCharacterData {
  id: string;
  character: CharacterData;
  showFromStart: boolean;
  side: 'player' | 'opponent';
}

export interface StageLayer {
  id: string;
  image: string;
  scrollFactor: number;
  scale: number;
  position: Offset;
  zIndex: number;
}

export interface StageData {
  name: string;
  layers: StageLayer[];
  cameraFocus: {
    player: Offset;
    opponent: Offset;
  };
}

export type TriggerTarget = 'player' | 'opponent' | 'both';

export interface MoveTriggerData {
  target: TriggerTarget;
  movementType: 'instant' | 'timed';
  duration: number; // in steps
  x: number;
  y: number;
  lanes?: number[]; // Optional specific lanes to move (0-7)
}

export interface BPMChangeTriggerData {
  bpm: number;
}

export interface CharacterSwapTriggerData {
  target: 'player' | 'opponent';
  characterId: string; // ID or name of the character to swap to
  isExtra?: boolean; // Whether the characterId refers to an extra character
  resetAnimation?: string; // Optional animation name to play immediately
}

export interface LoopTriggerData {
  target: TriggerTarget;
  interval: number; // in steps
  events: string[]; // IDs of events to loop
}

export interface StopLoopTriggerData {
  target: TriggerTarget;
  loopEventId?: string; // The ID of the loop event to stop
}

export interface CameraShakeTriggerData {
  intensity: number;
  duration: number; // in steps
}

export interface CameraZoomTriggerData {
  zoom: number;
  duration: number; // in steps
}

export interface FadeTriggerData {
  type: 'in' | 'out' | 'fade_in' | 'fade_out'; // 'in'/'out' for legacy, 'fade_in'/'fade_out' for new persistent modes
  duration: number; // in steps
  color?: string; // default to black
}

export interface FlashTriggerData {
  intensity: number;
  duration: number; // in steps
  rainbow?: boolean;
}

export interface StartPointTriggerData {
  enabled: boolean;
}

export interface RotateTriggerData {
  target: 'player' | 'opponent' | 'notes' | 'background' | 'all';
  rotations: number;
  duration: number; // in steps
}

export interface ShaderTriggerData {
  shaderType: 'glitch' | 'chromatic_glitch' | 'lens_circle' | 'hue' | 'gray_scale';
  intensity: number;
  duration: number; // in steps
  mode: 'instant' | 'fade_in' | 'fade_out';
  offsetX?: number; // lens_circle
  offsetY?: number; // lens_circle
  speed?: number; // chromatic_glitch
  noise?: number; // chromatic_glitch
}

export interface AddTextTriggerData {
  text: string;
  font: string;
  mode: 'fade_in' | 'fade_out';
  duration: number; // in steps
  targetOpacity: number; // 0 to 1
  color: string;
  x: number; // 0 to 1
  y: number; // 0 to 1
}

export interface ScrollSpeedTriggerData {
  speed: number;
}

export interface ChartEvent {
  id: string;
  step: number;
  type: 'move' | 'bpm_change' | 'character_swap' | 'loop' | 'stop_loop' | 'camera_shake' | 'camera_zoom' | 'fade' | 'flash' | 'start_point' | 'rotate' | 'shader' | 'opacity' | 'add_text' | 'scroll_speed' | string;
  value: MoveTriggerData | BPMChangeTriggerData | CharacterSwapTriggerData | LoopTriggerData | StopLoopTriggerData | CameraShakeTriggerData | CameraZoomTriggerData | FadeTriggerData | FlashTriggerData | StartPointTriggerData | RotateTriggerData | ShaderTriggerData | OpacityTriggerData | AddTextTriggerData | ScrollSpeedTriggerData | any;
}

export interface ChartNote {
  id: string;
  step: number;
  lane: number;
  length: number; // Sustain length in steps
  type: string;
}

export interface OpacityTriggerData {
  target: 'notes' | 'characters' | 'hp_bar' | 'all';
  opacity: number; // 0 to 1
  duration: number; // in steps
  mode: 'instant' | 'fade';
}

export interface ChartData {
  bpm: number;
  scrollSpeed: number;
  notes: ChartNote[];
  events: ChartEvent[];
  defaultEvent?: 'none' | 'health_drain';
}

export interface CustomObject {
  id: string;
  name: string;
  notes: ChartNote[];
  events: ChartEvent[];
  minLane: number;
  maxLane: number;
  duration: number;
}

export interface SavedWeek {
  id: string;
  name: string;
  description?: string;
  thumbnail?: string;
  sequence: EventNode[];
  vnData?: VNProject;
  tracks: string[]; // Keep for backward compatibility or legacy loading
}

export type EventNodeType = 'CUTSCENE' | 'GAMEPLAY';

export interface EventNode {
  id: string;
  type: EventNodeType;
  dataId: string; // Cutscene ID (within vnData.scenes) or Stage ID
}

export interface VNAsset {
  id: string;
  name: string;
  type: 'background' | 'character' | 'music' | 'sfx' | 'voice';
  url: string;
}

export interface VNChoice {
  id: string;
  text: string;
  nextSceneId: string | null;
}

export interface VNCharacterState {
  id: string;
  characterId: string;
  expressionId: string;
  position: { x: number; y: number };
  scale: number;
  flip: boolean;
  zIndex?: number;
  opacity?: number;
  highlightEffect?: 'none' | 'glow' | 'zoom' | 'float' | 'shake' | 'brighten';
  filters?: {
    brightness: number;
    contrast: number;
    saturation: number;
  };
}

export interface VNExpression {
  id: string;
  name: string;
  assetId: string;
}

export interface VNCharacter {
  id: string;
  name: string;
  expressions: VNExpression[];
}

export interface VNDialogueStyle {
  id: string;
  name: string;
  backgroundColor: string;
  borderRadius: string;
  borderWidth: string;
  borderColor: string;
  boxShadow: string;
  fontColor: string;
  fontSize: string;
  fontFamily: string;
  aiDescription?: string;
  nameTagStyle: {
    backgroundColor: string;
    fontColor: string;
    borderRadius: string;
    padding: string;
    syncWithBox?: boolean;
  };
}

export interface VNDialogue {
  id: string;
  speaker: string;
  text: string;
  styleId: string;
}

export interface VNScene {
  id: string;
  name: string;
  dialogue: VNDialogue[];
  backgroundId: string;
  musicId?: string;
  characters: VNCharacterState[];
  nextSceneId: string | null;
  choices?: VNChoice[];
}

export interface VNProject {
  id: string;
  name: string;
  scenes: VNScene[];
  assets: VNAsset[];
  characters: VNCharacter[];
  styles: VNDialogueStyle[];
  startSceneId?: string;
}

export interface SavedStage {
  id: string;
  name: string;
  characterPlayer: CharacterData;
  characterOpponent: CharacterData;
  extraCharacters?: ExtraCharacterData[];
  stage: StageData;
  chart: ChartData;
  audioUrl: string;
  thumbnail?: string;
}

export interface ArchiveCharacter {
  id: string;
  data: CharacterData;
}

export interface ArchiveBackground {
  id: string;
  name: string;
  url: string;
}
