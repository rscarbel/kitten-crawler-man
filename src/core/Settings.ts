/**
 * Device-local player settings, persisted to `localStorage`.
 *
 * Deliberately not part of the save payload: `GameProgress` is one server-side
 * row per *user*, so storing a render-quality or volume choice there would push
 * a phone's setting onto that player's desktop. It also frequently does not
 * exist — with the AI backend disabled the game boots with no save callback at
 * all — while these settings must work in every boot path.
 */

const STORAGE_KEY = 'kittenCrawler.settings.v1';

/** Bumped when the stored shape changes incompatibly; older payloads are discarded. */
const SETTINGS_VERSION = 1;

const MIN_VOLUME = 0;
const MAX_VOLUME = 1;

const DEFAULT_MASTER_VOLUME = 1;
const DEFAULT_SFX_VOLUME = 1;
const DEFAULT_MUSIC_VOLUME = 1;

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

interface SettingsData {
  quality: QualityPreset;
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  bindings: StoredBindings;
}

const DEFAULTS: SettingsData = {
  quality: 'auto',
  masterVolume: DEFAULT_MASTER_VOLUME,
  sfxVolume: DEFAULT_SFX_VOLUME,
  musicVolume: DEFAULT_MUSIC_VOLUME,
  bindings: {},
};

function isQualityPreset(value: unknown): value is QualityPreset {
  return QUALITY_PRESETS.some((preset) => preset === value);
}

function readVolume(source: Record<string, unknown>, key: string, fallback: number): number {
  const raw = source[key];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  return Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, raw));
}

/**
 * Assigning this key on an object literal re-points its prototype instead of
 * adding a property, so a hand-edited payload carrying it is dropped outright.
 */
const PROTOTYPE_POLLUTION_KEY = '__proto__';

function readBindings(source: Record<string, unknown>, key: string): StoredBindings {
  const raw = source[key];
  if (typeof raw !== 'object' || raw === null) return {};
  const result: StoredBindings = {};
  for (const [action, keys] of Object.entries(raw)) {
    if (action === PROTOTYPE_POLLUTION_KEY) continue;
    if (!Array.isArray(keys)) continue;
    result[action] = keys.filter((entry): entry is string => typeof entry === 'string');
  }
  return result;
}

/**
 * `localStorage` access throws outright in some privacy modes, so every read
 * and write is guarded and a failure simply means settings do not persist.
 */
function readStoredJson(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record: Record<string, unknown> = { ...parsed };
    if (record.version !== SETTINGS_VERSION) return null;
    return record;
  } catch {
    return null;
  }
}

function load(): SettingsData {
  const stored = readStoredJson();
  if (stored === null) return { ...DEFAULTS };
  const quality = stored.quality;
  return {
    quality: isQualityPreset(quality) ? quality : DEFAULTS.quality,
    masterVolume: readVolume(stored, 'masterVolume', DEFAULTS.masterVolume),
    sfxVolume: readVolume(stored, 'sfxVolume', DEFAULTS.sfxVolume),
    musicVolume: readVolume(stored, 'musicVolume', DEFAULTS.musicVolume),
    bindings: readBindings(stored, 'bindings'),
  };
}

class Settings {
  private data: SettingsData = load();

  get quality(): QualityPreset {
    return this.data.quality;
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

  setQuality(preset: QualityPreset): void {
    this.data.quality = preset;
    this.persist();
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
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: SETTINGS_VERSION, ...this.data }),
      );
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
