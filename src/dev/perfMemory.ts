/**
 * Memory by owner, published as `globalThis.__perfMemory` on the `?perf` route
 * so browser automation can read it.
 *
 * The pixel tally lives in `canvasSurface.ts`, which ships; this module reads it
 * and adds what that module never allocates: the on-screen canvas, decoded audio
 * buffers and, where the browser reports it, the JS heap. Audio buffers and
 * pixels both sit outside the JS heap, so the three never count the same bytes.
 */

import {
  SURFACE_BYTES_PER_PIXEL,
  surfaceTallies,
  type CanvasSurface,
  type SurfaceOwner,
} from '../core/canvasSurface';
import type { AudioManager } from '../audio/AudioManager';

/** Holders of memory that are not canvas surfaces; their tallies count no surfaces. */
type NonSurfaceOwner = 'mainCanvas' | 'audioBuffers' | 'jsHeap';
type MemoryOwner = SurfaceOwner | NonSurfaceOwner;

type DecodedAudioReadout = Pick<AudioManager, 'residentAudioBytes' | 'decodedBufferCount'>;

interface PerfMemoryTally {
  /** Surfaces for a canvas owner, decoded buffers for `audioBuffers`, zero for `jsHeap`. */
  readonly surfaces: number;
  readonly bytes: number;
}

interface PerfMemorySnapshot {
  /**
   * Keyed by owner, so a sampler can follow one owner across snapshots. An
   * owner that has never held a surface is absent.
   */
  readonly owners: Partial<Record<MemoryOwner, PerfMemoryTally>>;
  /** Canvas surfaces only, the on-screen one included. */
  readonly totalSurfaces: number;
  readonly totalBytes: number;
}

declare global {
  var __perfMemory: (() => PerfMemorySnapshot) | undefined;
}

let mainCanvas: CanvasSurface | null = null;
let decodedAudio: DecodedAudioReadout | null = null;

/** Chrome's `performance.memory.usedJSHeapSize`; null in browsers without it. */
function usedJsHeapBytes(): number | null {
  const memory: unknown = Reflect.get(performance, 'memory');
  if (typeof memory !== 'object' || memory === null) return null;
  if (!('usedJSHeapSize' in memory)) return null;
  const used = memory.usedJSHeapSize;
  return typeof used === 'number' ? used : null;
}

interface OwnedTally {
  readonly owner: MemoryOwner;
  readonly tally: PerfMemoryTally;
}

function ownedTallies(): OwnedTally[] {
  const entries: OwnedTally[] = [];
  for (const [owner, tally] of surfaceTallies()) entries.push({ owner, tally });
  if (mainCanvas !== null) {
    const bytes = mainCanvas.width * mainCanvas.height * SURFACE_BYTES_PER_PIXEL;
    entries.push({ owner: 'mainCanvas', tally: { surfaces: 1, bytes } });
  }
  if (decodedAudio !== null) {
    const tally = {
      surfaces: decodedAudio.decodedBufferCount,
      bytes: decodedAudio.residentAudioBytes,
    };
    entries.push({ owner: 'audioBuffers', tally });
  }
  const heapBytes = usedJsHeapBytes();
  if (heapBytes !== null)
    entries.push({ owner: 'jsHeap', tally: { surfaces: 0, bytes: heapBytes } });
  return entries;
}

export function perfMemorySnapshot(): PerfMemorySnapshot {
  const owners: Partial<Record<MemoryOwner, PerfMemoryTally>> = {};
  let totalSurfaces = 0;
  let totalBytes = 0;
  for (const { owner, tally } of ownedTallies()) {
    owners[owner] = tally;
    if (owner !== 'audioBuffers') totalSurfaces += tally.surfaces;
    totalBytes += tally.bytes;
  }
  return { owners, totalSurfaces, totalBytes };
}

/** The owners holding the most bytes, largest first. */
export function largestMemoryOwners(count: number): OwnedTally[] {
  return ownedTallies()
    .sort((a, b) => b.tally.bytes - a.tally.bytes)
    .slice(0, count);
}

/**
 * Publishes {@link perfMemorySnapshot}, counting `canvas` as the on-screen
 * surface and `audio`'s decoded buffers when the scene has an audio manager.
 */
export function installPerfMemory(canvas: CanvasSurface, audio: DecodedAudioReadout | null): void {
  mainCanvas = canvas;
  decodedAudio = audio;
  globalThis.__perfMemory = perfMemorySnapshot;
}
