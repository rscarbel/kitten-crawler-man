/**
 * Device-local player settings, persisted to `localStorage`.
 *
 * Deliberately not part of the save payload: `GameProgress` is one server-side
 * row per *user*, so storing a render-quality or volume choice there would push
 * a phone's setting onto that player's desktop. It also frequently does not
 * exist — with the AI backend disabled the game boots with no save callback at
 * all — while these settings must work in every boot path.
 */

import { DEFAULT_AI_INTENSITY, isAIIntensity, type AIIntensity } from '../../ai/aiIntensity';
import { MUSIC_TRACK_IDS, type MusicTrackId } from '../../audio/sounds';
import type { Difficulty } from '../difficulty/difficultyProfiles';

const STORAGE_KEY = 'kittenCrawler.settings.v1';

const MIN_VOLUME = 0;
const MAX_VOLUME = 1;

const DEFAULT_MASTER_VOLUME = 1;
const DEFAULT_SFX_VOLUME = 1;
const DEFAULT_MUSIC_VOLUME = 1;
const DEFAULT_AMBIENCE_VOLUME = 1;

/**
 * Render-quality choice.
 *
 * - `auto` — resolved at boot from the display and a short performance probe.
 * - `sharp` — render at the device pixel ratio, capped so a 3× phone display
 *   does not ask for nine times the fill rate.
 * - `performance` — one backing-store pixel per CSS pixel.
 *
 * Presets rather than a raw scale slider: fractional scales leave hairline
 * seams between adjacent chunk blits.
 */
export type QualityPreset = 'auto' | 'sharp' | 'performance';

const QUALITY_PRESETS: ReadonlyArray<QualityPreset> = ['auto', 'sharp', 'performance'];

/** How large the player wants the UI drawn, on top of what the device's density already picks. */
export const UI_SIZES = ['small', 'medium', 'large'] as const;

export type UiSize = (typeof UI_SIZES)[number];

/**
 * Mirrors {@link Difficulty} as a value so it can be validated without a
 * runtime dependency on `difficultyProfiles.ts` — that module reads
 * `settings.difficulty`, so importing it here for the tuple would be a cycle.
 *
 * A `Record<Difficulty, true>` rather than an array: TypeScript rejects this
 * literal if `Difficulty` ever gains a member this object doesn't list, so a
 * forgotten tier is a compile error here rather than a setting that silently
 * fails validation and falls back to Normal on every reload.
 */
const DIFFICULTY_PRESET_LOOKUP: Record<Difficulty, true> = {
  easy: true,
  normal: true,
  hard: true,
};

/** Highest density `sharp` will ask for, regardless of the display's ratio. */
export const MAX_SHARP_RENDER_SCALE = 2;

/** The unscaled backing store: one device pixel per CSS pixel. */
export const PERFORMANCE_RENDER_SCALE = 1;

/**
 * Keyboard overrides, stored as raw action-name → key-list pairs.
 *
 * Only the *shape* is checked here; which action names and key strings are
 * meaningful is `Keybindings`' business, and this module deliberately does not
 * import it — the dependency runs the other way, so a binding table can be
 * built out of persisted settings without a cycle.
 */
type StoredBindings = Record<string, readonly string[]>;

/**
 * The music page's choice that outlives a reload. Play-once is a one-song
 * whim and is never stored; area music is the absence of a preference.
 */
export type MusicPlaybackPreference =
  { readonly mode: 'shuffle' } | { readonly mode: 'repeat'; readonly track: MusicTrackId };

interface SettingsData {
  quality: QualityPreset;
  difficulty: Difficulty;
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  /** The continuous world sounds' own level. */
  ambienceVolume: number;
  bindings: StoredBindings;
  /**
   * Whether the companion cat sends Mongo in on her own when a fight is on her.
   *
   * On by default: with the human in control the cat has no Summon button, so
   * without it the pet sits out every fight the player does not switch over for.
   */
  catAutoSummonsMongo: boolean;
  uiSize: UiSize;
  /** Absent while area music plays: no preference is the default. */
  musicPlayback?: MusicPlaybackPreference;
  /** Silences everything without moving a volume slider, so unmuting restores the same mix. */
  muted: boolean;
  /** Both speakers carry the same downmixed signal, for one-eared listening and single speakers. */
  monoAudio: boolean;
  /**
   * Keeps the game audible while its tab or window is in the background.
   * Off by default: a game left in another window falls silent.
   */
  audioInBackground: boolean;
  /** Short on-screen lines for sounds that carry information the screen does not show. */
  soundCaptions: boolean;
  /** The dotted route painted on the ground toward the pinned objective. */
  questRouteTrail: boolean;
  /** How much the AI characters may do on their own; sent to the AI server with the session context. */
  aiIntensity: AIIntensity;
  /** The "System intervened" line shown when an AI action lands. */
  aiInterventionIndicators: boolean;
}

const DEFAULTS: SettingsData = {
  quality: 'auto',
  difficulty: 'normal',
  masterVolume: DEFAULT_MASTER_VOLUME,
  sfxVolume: DEFAULT_SFX_VOLUME,
  musicVolume: DEFAULT_MUSIC_VOLUME,
  ambienceVolume: DEFAULT_AMBIENCE_VOLUME,
  bindings: {},
  catAutoSummonsMongo: true,
  uiSize: 'medium',
  muted: false,
  monoAudio: false,
  audioInBackground: false,
  soundCaptions: false,
  questRouteTrail: true,
  aiIntensity: DEFAULT_AI_INTENSITY,
  aiInterventionIndicators: true,
};

function isQualityPreset(value: unknown): value is QualityPreset {
  return QUALITY_PRESETS.some((preset) => preset === value);
}

function isUiSize(value: unknown): value is UiSize {
  return UI_SIZES.some((size) => size === value);
}

function isDifficulty(value: unknown): value is Difficulty {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(DIFFICULTY_PRESET_LOOKUP, value)
  );
}

function isVolume(value: unknown): value is number {
  return typeof value === 'number' && value >= MIN_VOLUME && value <= MAX_VOLUME;
}

function parseMusicPlayback(raw: unknown): MusicPlaybackPreference | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const record: Record<string, unknown> = { ...raw };
  if (record.mode === 'shuffle') return { mode: 'shuffle' };
  if (record.mode !== 'repeat') return undefined;
  const track = MUSIC_TRACK_IDS.find((id) => id === record.track);
  return track === undefined ? undefined : { mode: 'repeat', track };
}

/**
 * Assigning this key on an object literal re-points its prototype instead of
 * adding a property, so a payload carrying it fails validation outright.
 */
const PROTOTYPE_POLLUTION_KEY = '__proto__';

function parseBindings(raw: unknown): StoredBindings | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const result: StoredBindings = {};
  for (const [action, keys] of Object.entries(raw)) {
    if (action === PROTOTYPE_POLLUTION_KEY || !Array.isArray(keys)) return undefined;
    const keyNames: string[] = [];
    for (const entry of keys) {
      if (typeof entry !== 'string') return undefined;
      keyNames.push(entry);
    }
    result[action] = keyNames;
  }
  return result;
}

/** Stored settings, or undefined when any field is missing or not something this build writes. */
function parseSettings(stored: Record<string, unknown>): SettingsData | undefined {
  const {
    quality,
    difficulty,
    masterVolume,
    sfxVolume,
    musicVolume,
    ambienceVolume,
    catAutoSummonsMongo,
    uiSize,
    muted,
    monoAudio,
    audioInBackground,
    soundCaptions,
    questRouteTrail,
    aiIntensity,
    aiInterventionIndicators,
  } = stored;
  const bindings = parseBindings(stored.bindings);
  const musicPlayback =
    stored.musicPlayback === undefined ? undefined : parseMusicPlayback(stored.musicPlayback);
  if (
    !isQualityPreset(quality) ||
    !isDifficulty(difficulty) ||
    !isVolume(masterVolume) ||
    !isVolume(sfxVolume) ||
    !isVolume(musicVolume) ||
    !isVolume(ambienceVolume) ||
    bindings === undefined ||
    typeof catAutoSummonsMongo !== 'boolean' ||
    !isUiSize(uiSize) ||
    (stored.musicPlayback !== undefined && musicPlayback === undefined) ||
    typeof muted !== 'boolean' ||
    typeof monoAudio !== 'boolean' ||
    typeof audioInBackground !== 'boolean' ||
    typeof soundCaptions !== 'boolean' ||
    typeof questRouteTrail !== 'boolean' ||
    !isAIIntensity(aiIntensity) ||
    typeof aiInterventionIndicators !== 'boolean'
  ) {
    return undefined;
  }
  const settings: SettingsData = {
    quality,
    difficulty,
    masterVolume,
    sfxVolume,
    musicVolume,
    ambienceVolume,
    bindings,
    catAutoSummonsMongo,
    uiSize,
    muted,
    monoAudio,
    audioInBackground,
    soundCaptions,
    questRouteTrail,
    aiIntensity,
    aiInterventionIndicators,
  };
  if (musicPlayback !== undefined) settings.musicPlayback = musicPlayback;
  return settings;
}

/**
 * The stored payload, or null when nothing is stored. `localStorage` access
 * throws outright in some privacy modes, so every read and write is guarded and
 * a failure simply means settings do not persist; a payload that is not JSON
 * comes back as an empty record, which fails validation.
 */
function readStoredJson(): Record<string, unknown> | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? { ...parsed } : {};
  } catch {
    return {};
  }
}

/** The stored settings, or the defaults when there are none or they fail validation. */
function load(): SettingsData {
  const stored = readStoredJson();
  if (stored === null) return { ...DEFAULTS };
  const parsed = parseSettings(stored);
  if (parsed === undefined) {
    console.warn('Stored settings failed validation; starting from the defaults.');
    return { ...DEFAULTS };
  }
  return parsed;
}

class Settings {
  private data: SettingsData = load();

  /**
   * A difficulty that holds for this page load only, over the stored one.
   * Kept apart from `data` so that saving any other setting never writes it
   * through to storage.
   */
  private sessionDifficulty: Difficulty | null = null;

  get quality(): QualityPreset {
    return this.data.quality;
  }

  get difficulty(): Difficulty {
    return this.sessionDifficulty ?? this.data.difficulty;
  }

  get masterVolume(): number {
    return this.data.masterVolume;
  }

  get sfxVolume(): number {
    return this.data.sfxVolume;
  }

  get musicVolume(): number {
    return this.data.musicVolume;
  }

  get ambienceVolume(): number {
    return this.data.ambienceVolume;
  }

  setQuality(preset: QualityPreset): void {
    this.data.quality = preset;
    this.persist();
  }

  setDifficulty(difficulty: Difficulty): void {
    this.sessionDifficulty = null;
    this.data.difficulty = difficulty;
    this.persist();
  }

  /**
   * Plays this page load on `difficulty` without saving it, for dev routes that
   * must not leave the player's own game changed once they are closed. A later
   * {@link setDifficulty} is the player choosing, and replaces it.
   */
  setDifficultyForSession(difficulty: Difficulty): void {
    this.sessionDifficulty = difficulty;
  }

  setMasterVolume(volume: number): void {
    this.data.masterVolume = clampVolume(volume);
    this.persist();
  }

  setSfxVolume(volume: number): void {
    this.data.sfxVolume = clampVolume(volume);
    this.persist();
  }

  setMusicVolume(volume: number): void {
    this.data.musicVolume = clampVolume(volume);
    this.persist();
  }

  setAmbienceVolume(volume: number): void {
    this.data.ambienceVolume = clampVolume(volume);
    this.persist();
  }

  get catAutoSummonsMongo(): boolean {
    return this.data.catAutoSummonsMongo;
  }

  setCatAutoSummonsMongo(enabled: boolean): void {
    this.data.catAutoSummonsMongo = enabled;
    this.persist();
  }

  get uiSize(): UiSize {
    return this.data.uiSize;
  }

  setUiSize(size: UiSize): void {
    this.data.uiSize = size;
    this.persist();
  }

  get musicPlayback(): MusicPlaybackPreference | undefined {
    return this.data.musicPlayback;
  }

  /** Undefined forgets the choice, so the next load starts on area music. */
  setMusicPlayback(preference: MusicPlaybackPreference | undefined): void {
    this.data.musicPlayback = preference;
    this.persist();
  }

  get muted(): boolean {
    return this.data.muted;
  }

  setMuted(muted: boolean): void {
    this.data.muted = muted;
    this.persist();
  }

  get monoAudio(): boolean {
    return this.data.monoAudio;
  }

  setMonoAudio(mono: boolean): void {
    this.data.monoAudio = mono;
    this.persist();
  }

  get audioInBackground(): boolean {
    return this.data.audioInBackground;
  }

  setAudioInBackground(enabled: boolean): void {
    this.data.audioInBackground = enabled;
    this.persist();
  }

  get soundCaptions(): boolean {
    return this.data.soundCaptions;
  }

  setSoundCaptions(enabled: boolean): void {
    this.data.soundCaptions = enabled;
    this.persist();
  }

  get questRouteTrail(): boolean {
    return this.data.questRouteTrail;
  }

  setQuestRouteTrail(enabled: boolean): void {
    this.data.questRouteTrail = enabled;
    this.persist();
  }

  get aiIntensity(): AIIntensity {
    return this.data.aiIntensity;
  }

  setAIIntensity(intensity: AIIntensity): void {
    this.data.aiIntensity = intensity;
    this.persist();
  }

  get aiInterventionIndicators(): boolean {
    return this.data.aiInterventionIndicators;
  }

  setAIInterventionIndicators(enabled: boolean): void {
    this.data.aiInterventionIndicators = enabled;
    this.persist();
  }

  get bindings(): Readonly<StoredBindings> {
    return this.data.bindings;
  }

  /** Replaces the whole override map; `Keybindings` owns what belongs in it. */
  setBindings(bindings: StoredBindings): void {
    this.data.bindings = bindings;
    this.persist();
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // Storage unavailable (private browsing, quota); settings stay in-memory.
    }
  }
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return MIN_VOLUME;
  return Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, volume));
}

export const settings = new Settings();
