/**
 * Off-screen drawing surfaces shared by the tile caches and the pre-rendered
 * sprite compositions.
 *
 * A detached `<canvas>` rather than an `OffscreenCanvas`. On the main thread
 * the two are drawn by the same accelerated backend, but only the element's
 * context is a `CanvasRenderingContext2D` — the type every painter in the
 * engine is written against. An `OffscreenCanvas` hands back a distinct
 * context type that could only be passed to those painters by asserting it was
 * something it is not.
 *
 * Every surface is allocated against a {@link SurfaceOwner}, and this module
 * keeps a running tally of live surfaces and backing-store bytes per owner, so
 * a memory readout can say which cache the pixels belong to. The tally is a
 * few additions per allocation, resize or release — cheap enough to ship.
 */
export type CanvasSurface = HTMLCanvasElement;

/** Every cache or painter that holds off-screen pixels, one name per distinct pool. */
export const SURFACE_OWNERS = [
  'figureCells',
  'figureScratch',
  'creatureArt',
  'paintedCells',
  'deuceBitmaps',
  'tileChunks',
  'tileOverlays',
  'environmentSheets',
  'spriteSheets',
  'lighting',
  'lightCookies',
  'groundTileParts',
  'bossRoomTiles',
  'dungeonWalls',
  'palisades',
  'heldArt',
  'rims',
  'effects',
  'props',
  'bigTopProps',
  'townInteriorProps',
  'spellFog',
  'circus',
  'casino',
  'construction',
  'prisonGround',
  'signet',
  'keyboardHero',
  'ui',
  'title',
  'minimap',
  'misc',
] as const;

export type SurfaceOwner = (typeof SURFACE_OWNERS)[number];

/** A canvas backing store holds one byte each of red, green, blue and alpha. */
export const SURFACE_BYTES_PER_PIXEL = 4;

const BYTES_PER_KILOBYTE = 1024;
/** For budgets written in megabytes and readouts that print them. */
export const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;

interface SurfaceRecord {
  readonly owner: SurfaceOwner;
  bytes: number;
  /** False once given back, so a later resize counts the surface again. */
  live: boolean;
}

/** One owner's live surfaces and the bytes their backing stores hold. */
interface SurfaceOwnerTally {
  surfaces: number;
  bytes: number;
}

/** Keyed weakly so the bookkeeping never keeps a dropped surface alive. */
const records = new WeakMap<object, SurfaceRecord>();
const tallies = new Map<SurfaceOwner, SurfaceOwnerTally>();

/**
 * Takes a surface that was dropped without {@link releaseSurface} off its
 * owner's tally once the collector frees it, so the tally reports what is
 * held rather than everything ever allocated. Its held value is the record
 * alone: holding the surface would keep it from ever being collected. Absent
 * in browsers older than the `FinalizationRegistry` API, where such a surface
 * simply stays counted.
 */
const collectedSurfaces =
  typeof FinalizationRegistry === 'undefined'
    ? null
    : new FinalizationRegistry<SurfaceRecord>((record) => {
        countRecordOut(record);
      });

function tallyOf(owner: SurfaceOwner): SurfaceOwnerTally {
  const existing = tallies.get(owner);
  if (existing !== undefined) return existing;
  const fresh: SurfaceOwnerTally = { surfaces: 0, bytes: 0 };
  tallies.set(owner, fresh);
  return fresh;
}

function backingBytes(width: number, height: number): number {
  return width * height * SURFACE_BYTES_PER_PIXEL;
}

function countIn(key: object, owner: SurfaceOwner, bytes: number): void {
  const record: SurfaceRecord = { owner, bytes, live: true };
  records.set(key, record);
  collectedSurfaces?.register(key, record);
  const tally = tallyOf(owner);
  tally.surfaces += 1;
  tally.bytes += bytes;
}

function countRecordOut(record: SurfaceRecord): void {
  if (!record.live) return;
  const tally = tallyOf(record.owner);
  tally.surfaces -= 1;
  tally.bytes -= record.bytes;
  record.bytes = 0;
  record.live = false;
}

function countOut(key: object): void {
  const record = records.get(key);
  if (record !== undefined) countRecordOut(record);
}

/** Allocates a detached canvas of the given size, counted against `owner`. */
export function allocCanvas(owner: SurfaceOwner, w: number, h: number): CanvasSurface {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  countIn(c, owner, backingBytes(c.width, c.height));
  return c;
}

/**
 * Gives a surface a new size, keeping its owner's tally in step.
 *
 * Assigning a canvas's size clears it and resets its context state even when
 * the size is unchanged, and this does the same, so a caller may rely on it
 * as a wipe. A surface that has been released is counted again.
 */
export function resizeSurface(surface: CanvasSurface, w: number, h: number): void {
  surface.width = w;
  surface.height = h;
  const record = records.get(surface);
  if (record === undefined) return;
  const bytes = backingBytes(surface.width, surface.height);
  const tally = tallyOf(record.owner);
  if (!record.live) {
    record.live = true;
    tally.surfaces += 1;
  }
  tally.bytes += bytes - record.bytes;
  record.bytes = bytes;
}

/**
 * Counts a decoded sprite-sheet image by its natural size. Its pixels are not
 * a canvas's, but they occupy the same memory budget and are as large.
 */
export function countDecodedImage(image: HTMLImageElement): void {
  if (records.get(image)?.live === true) return;
  countIn(image, 'spriteSheets', backingBytes(image.naturalWidth, image.naturalHeight));
}

/** Takes an image counted by {@link countDecodedImage} back out once its pixels are let go. */
export function forgetDecodedImage(image: HTMLImageElement): void {
  countOut(image);
}

/**
 * The owner a surface or decoded image was counted against, or null for one
 * this module never saw. A released surface still names its owner.
 */
export function surfaceOwnerOf(source: object): SurfaceOwner | null {
  return records.get(source)?.owner ?? null;
}

/** A copy of every owner's tally that has ever held a surface. */
export function surfaceTallies(): ReadonlyMap<SurfaceOwner, Readonly<SurfaceOwnerTally>> {
  const copy = new Map<SurfaceOwner, Readonly<SurfaceOwnerTally>>();
  for (const [owner, tally] of tallies) copy.set(owner, { ...tally });
  return copy;
}

/**
 * Surfaces whose context has been asked for with `willReadFrequently`.
 *
 * The flag is a property of the *context*, and a canvas hands back the same
 * context object on every `getContext` call — so it can only be set on the first
 * one, and `surfaceContext` has to know which surfaces were declared before it
 * fetches theirs. A `WeakSet` because the entry must not keep a released surface
 * alive: the caches here give their pixels back by shrinking a surface to
 * nothing and dropping it.
 */
const readFrequently = new WeakSet();

/**
 * Allocates a surface whose context will be read back pixel by pixel.
 *
 * A canvas the browser has put on the GPU has to be synchronised back to main
 * memory for every `getImageData`, and a painter that filters its own pixels —
 * the building kit's ink and outline passes are the case — does that several
 * times per frame it paints. Declaring the intent up front keeps the surface in
 * software, where those reads are free and the drawing is barely slower.
 *
 * Only for surfaces that are genuinely read back. Everything else wants the GPU.
 */
export function allocReadableCanvas(owner: SurfaceOwner, w: number, h: number): CanvasSurface {
  const surface = allocCanvas(owner, w, h);
  readFrequently.add(surface);
  return surface;
}

/**
 * The browser refused a 2D context for a surface. In practice this is the
 * browser's canvas memory budget running out — iOS enforces one across every
 * canvas on the page — rather than a bug in the caller.
 */
export class CanvasContextUnavailableError extends Error {
  constructor() {
    super('Failed to acquire a 2D canvas context');
    this.name = 'CanvasContextUnavailableError';
  }
}

/** Returns the 2D drawing context of an off-screen surface. */
export function surfaceContext(surface: CanvasSurface): CanvasRenderingContext2D {
  const settings: CanvasRenderingContext2DSettings = {
    willReadFrequently: readFrequently.has(surface),
  };
  const ctx = surface.getContext('2d', settings);
  if (ctx === null) {
    throw new CanvasContextUnavailableError();
  }
  return ctx;
}

/** Gives a surface's pixels back at once rather than at the next collection. */
export function releaseSurface(surface: CanvasSurface): void {
  surface.width = 0;
  surface.height = 0;
  countOut(surface);
}

/**
 * {@link surfaceContext} for a surface just allocated, which is given back if
 * the browser refuses it a context: a caller that throws on would otherwise
 * leave it holding its size until a collection.
 */
export function freshSurfaceContext(surface: CanvasSurface): CanvasRenderingContext2D {
  try {
    return surfaceContext(surface);
  } catch (error) {
    releaseSurface(surface);
    throw error;
  }
}
