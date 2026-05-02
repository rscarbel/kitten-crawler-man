import manifestJson from '../images/manifest.json';

export interface SpriteStateDef {
  readonly row: number;
  readonly frameCount: number;
}

export interface SpriteManifestEntry {
  readonly path: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly tileScale: number;
  readonly states: Readonly<Record<string, SpriteStateDef>>;
}

// Type-checked view of the manifest — verifies JSON shape without changing
// the inferred literal type used by SpriteKey / SpriteStates below.
const _manifest: Readonly<Record<string, SpriteManifestEntry>> = manifestJson;

/** Union of all known sprite keys, inferred from the manifest JSON. */
export type SpriteKey = keyof typeof manifestJson;

/** Maps each SpriteKey to the union of its valid state name strings. */
export type SpriteStates = {
  [K in SpriteKey]: keyof (typeof manifestJson)[K]['states'] & string;
};

/** Runtime sprite data: loaded image + dimensions from the manifest. */
export interface SpriteDef {
  readonly img: HTMLImageElement;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly tileScale: number;
  readonly states: ReadonlyMap<string, SpriteStateDef>;
}

const _defs = new Map<string, SpriteDef>();
let _loadPromise: Promise<void> | null = null;

/**
 * Load all sprite sheets listed in the manifest.
 * Safe to call multiple times — subsequent calls return the same promise.
 * Missing files are silently skipped so procedural fallbacks can fill in.
 *
 * @param base  URL prefix prepended to each manifest path (default: 'src/images/')
 */
export async function loadSprites(base = 'src/images/'): Promise<void> {
  if (_loadPromise) return _loadPromise;

  _loadPromise = Promise.all(
    Object.entries(_manifest).map(([key, entry]) => {
      return new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const statesMap = new Map<string, SpriteStateDef>();
          for (const [name, sd] of Object.entries(entry.states)) {
            statesMap.set(name, sd);
          }
          _defs.set(key, {
            img,
            frameWidth: entry.frameWidth,
            frameHeight: entry.frameHeight,
            tileX: entry.tileX,
            tileY: entry.tileY,
            tileScale: entry.tileScale,
            states: statesMap,
          });
          resolve();
        };
        img.onerror = () => resolve(); // Missing file — skip silently
        img.src = base + entry.path;
      });
    }),
  ).then(() => undefined);

  return _loadPromise;
}

/** Returns the loaded SpriteDef for the given key, or undefined if not yet loaded. */
export function getSpriteDef(key: SpriteKey): SpriteDef | undefined {
  return _defs.get(key);
}
