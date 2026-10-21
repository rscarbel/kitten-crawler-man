import { releaseSurface, SURFACE_BYTES_PER_PIXEL, type CanvasSurface } from './canvasSurface';
import { renderFrameNumber } from './renderFrameClock';

interface RecentEntry<V> {
  readonly value: V;
  readonly surface: CanvasSurface;
  readonly bytes: number;
  usedFrame: number;
}

/**
 * Baked surfaces under a byte budget, let go least recently drawn first.
 *
 * Nothing drawn within `protectedFrames` render frames is ever let go, so the
 * budget gives way rather than evicting art on screen: a cache whose every
 * entry is in use stays over budget until some of it falls idle. Set the budget
 * above what one scene draws and eviction only ever touches what that scene no
 * longer shows.
 */
export class RecentSurfaceCache<V> {
  /** Kept in recency order: a hit moves its entry to the end. */
  private readonly entries = new Map<string, RecentEntry<V>>();
  private heldBytes = 0;

  constructor(
    private readonly budgetBytes: number,
    private readonly protectedFrames: number,
    private readonly surfaceOf: (value: V) => CanvasSurface,
  ) {}

  /** The entry under `key`, marked as drawn this frame. */
  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    entry.usedFrame = renderFrameNumber();
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  /** Stores a freshly baked entry as drawn this frame, then lets idle entries go over budget. */
  set(key: string, value: V): void {
    const previous = this.entries.get(key);
    if (previous !== undefined) this.forget(key, previous);
    const surface = this.surfaceOf(value);
    const bytes = surface.width * surface.height * SURFACE_BYTES_PER_PIXEL;
    this.entries.set(key, { value, surface, bytes, usedFrame: renderFrameNumber() });
    this.heldBytes += bytes;
    this.evictIdleOverBudget();
  }

  /** Gives every surface back, for a canvas recovery or a flush. */
  clear(): void {
    for (const entry of this.entries.values()) releaseSurface(entry.surface);
    this.entries.clear();
    this.heldBytes = 0;
  }

  private evictIdleOverBudget(): void {
    const newestEvictableFrame = renderFrameNumber() - this.protectedFrames;
    for (const [key, entry] of this.entries) {
      if (this.heldBytes <= this.budgetBytes) return;
      // Recency order: once one entry is too recent to go, so is every one after it.
      if (entry.usedFrame >= newestEvictableFrame) return;
      this.forget(key, entry);
    }
  }

  private forget(key: string, entry: RecentEntry<V>): void {
    releaseSurface(entry.surface);
    this.entries.delete(key);
    this.heldBytes -= entry.bytes;
  }
}
