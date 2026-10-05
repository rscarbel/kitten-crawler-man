/**
 * Per-surface, per-widget state for an immediate-mode UI: scroll offsets,
 * selections, open/closed flags and number tweens, keyed by surface id and
 * widget id, and dropped when the surface closes so a reopened menu starts
 * fresh.
 *
 * Typed state lives in a {@link UiStateSlot}: a widget declares its slot once
 * at module level with the state's type and initial value, and every read
 * through it is typed without a cast.
 */

/**
 * One kind of widget state. Declare at module level:
 *
 * ```ts
 * const SCROLL = new UiStateSlot('scroll', () => ({ offset: 0, velocity: 0 }));
 * const scroll = ui.state(SCROLL, id);
 * ```
 *
 * Each slot keeps its own map, so values of different types never share a
 * container.
 */
export class UiStateSlot<T> {
  private readonly values = new Map<string, T>();

  constructor(
    /** For debugging only. */
    readonly name: string,
    readonly init: () => T,
  ) {}

  /** @internal Used by {@link UiStateStore}. */
  read(key: string, init: () => T): T {
    const existing = this.values.get(key);
    if (existing !== undefined) return existing;
    const created = init();
    this.values.set(key, created);
    return created;
  }

  /** @internal Used by {@link UiStateStore}. */
  write(key: string, value: T): void {
    this.values.set(key, value);
  }

  /** @internal Drops every key that starts with `prefix`. */
  dropPrefix(prefix: string): void {
    for (const key of this.values.keys()) {
      if (key.startsWith(prefix)) this.values.delete(key);
    }
  }
}

/** Something that can forget a surface's keys; every slot qualifies. */
interface Clearable {
  dropPrefix(prefix: string): void;
}

interface Tween {
  from: number;
  to: number;
  startedAt: number;
  durationMs: number;
}

export interface TweenOptions {
  /** Duration of the ease toward a new target. */
  readonly ms: number;
  /** Value on the first frame this tween is seen. Defaults to the target (no animation). */
  readonly from?: number;
}

const CUBIC = 3;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, CUBIC);
}

const KEY_SEPARATOR = '\u0000';

let nextStoreId = 0;

/**
 * Holds every surface's widget state. `UiRoot` owns one.
 *
 * Slots are module-level and shared by every store, so each store prefixes its
 * keys with its own id: two scenes that both mount an `inventory` surface keep
 * separate state.
 */
export class UiStateStore {
  private readonly storeId = nextStoreId++;
  /** Slots that hold a value for each surface, so closing it clears only what it touched. */
  private readonly slotsBySurface = new Map<string, Set<Clearable>>();
  private readonly tweens = new Map<string, Tween>();

  private surfacePrefix(surfaceId: string): string {
    return `${this.storeId}${KEY_SEPARATOR}${surfaceId}${KEY_SEPARATOR}`;
  }

  private scopedKey(surfaceId: string, id: string): string {
    return `${this.surfacePrefix(surfaceId)}${id}`;
  }

  private touch(surfaceId: string, slot: Clearable): void {
    let slots = this.slotsBySurface.get(surfaceId);
    if (slots === undefined) {
      slots = new Set();
      this.slotsBySurface.set(surfaceId, slots);
    }
    slots.add(slot);
  }

  /** The value for `id` on `surfaceId`, created from `init` (or the slot's own) on first read. */
  get<T>(surfaceId: string, slot: UiStateSlot<T>, id: string, init?: () => T): T {
    this.touch(surfaceId, slot);
    return slot.read(this.scopedKey(surfaceId, id), init ?? slot.init);
  }

  /** Replaces the value for `id` on `surfaceId`. Only needed for immutable state; mutable objects can be edited in place. */
  set<T>(surfaceId: string, slot: UiStateSlot<T>, id: string, value: T): void {
    this.touch(surfaceId, slot);
    slot.write(this.scopedKey(surfaceId, id), value);
  }

  /**
   * Eases toward `target`, restarting from the current value whenever the
   * target changes, and returns the value at `now`.
   */
  tween(surfaceId: string, id: string, target: number, now: number, opts: TweenOptions): number {
    const key = this.scopedKey(surfaceId, id);
    let tween = this.tweens.get(key);
    if (tween === undefined) {
      tween = { from: opts.from ?? target, to: target, startedAt: now, durationMs: opts.ms };
      this.tweens.set(key, tween);
    } else if (tween.to !== target) {
      tween.from = valueAt(tween, now);
      tween.to = target;
      tween.startedAt = now;
      tween.durationMs = opts.ms;
    }
    return valueAt(tween, now);
  }

  /** Forgets everything `surfaceId` stored. Called when the surface closes. */
  clearSurface(surfaceId: string): void {
    const prefix = this.surfacePrefix(surfaceId);
    const slots = this.slotsBySurface.get(surfaceId);
    if (slots !== undefined) {
      for (const slot of slots) slot.dropPrefix(prefix);
      this.slotsBySurface.delete(surfaceId);
    }
    for (const key of this.tweens.keys()) {
      if (key.startsWith(prefix)) this.tweens.delete(key);
    }
  }
}

function valueAt(tween: Tween, now: number): number {
  if (tween.durationMs <= 0) return tween.to;
  const progress = Math.min(1, Math.max(0, (now - tween.startedAt) / tween.durationMs));
  return tween.from + (tween.to - tween.from) * easeOutCubic(progress);
}
