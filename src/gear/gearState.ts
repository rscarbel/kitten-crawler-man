import { isItemId, type ItemId } from '../core/items/defs/ItemDefs';
import { isRecord } from '../core/util/guards';
import type { ClawWeaponStats } from '../core/items/equipment/weapons';
import type { StatName } from '../Player';
import { GearLiveState } from './gearLive';
import type { GearModifiers, GearTrait } from './traits';

/** Traits whose effect can fire only once per dungeon floor. */
const FLOOR_ONCE_TRAIT_KINDS = ['ninthLife'] as const;
export type FloorOnceTraitKind = (typeof FLOOR_ONCE_TRAIT_KINDS)[number];

/** Traits whose recharge is carried across a scene change rather than restarting on arrival. */
const PERSISTED_COOLDOWN_TRAIT_KINDS = ['lastStand', 'relic'] as const;
export type PersistedCooldownTraitKind = (typeof PERSISTED_COOLDOWN_TRAIT_KINDS)[number];

/**
 * What one piece of gear remembers about itself on one crawler. Every field
 * defaults to the state of a piece fresh from the chest, so a save that
 * predates a field reads it as fresh.
 */
export interface GearItemState {
  /** Kills landed while worn, counted toward an awakening. */
  awakeningKills: number;
  /** True once the awakening threshold is reached; the awakened traits then apply. */
  awakened: boolean;
  /** A cursed piece that is bound cannot be taken off until the party next reaches a safe room. */
  bound: boolean;
  /** The once-per-floor effects already spent on this floor. */
  floorOnceSpent: FloorOnceTraitKind[];
  /** Frames left on each recharge that must survive a scene change. */
  cooldownFrames: Partial<Record<PersistedCooldownTraitKind, number>>;
}

function freshItemState(): GearItemState {
  return {
    awakeningKills: 0,
    awakened: false,
    bound: false,
    floorOnceSpent: [],
    cooldownFrames: {},
  };
}

/** One worn trait, with the piece it is filed under; a set bonus's under the set's first worn piece. */
export interface ActiveTrait {
  readonly itemId: ItemId;
  readonly trait: GearTrait;
}

/** Everything derived from what a crawler has on, and the revisions it was derived at. */
export interface WornGearCache {
  readonly equipmentRevision: number;
  readonly gearRevision: number;
  readonly traits: readonly ActiveTrait[];
  readonly modifiers: GearModifiers;
  /** What switched-on set bonuses add to each stat. */
  readonly setStatBonus: Readonly<Record<StatName, number>>;
  readonly claws: ClawWeaponStats | null;
}

/** One saved entry of a crawler's {@link GearState}. */
export type SavedGearItemState = readonly [string, GearItemState];

function isFloorOnceTraitKind(value: unknown): value is FloorOnceTraitKind {
  return FLOOR_ONCE_TRAIT_KINDS.some((kind) => kind === value);
}

function nonNegativeOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Rebuilds one saved entry's state from unvalidated JSON, defaulting whatever is missing or malformed. */
function parsedItemState(raw: unknown): GearItemState {
  const state = freshItemState();
  if (!isRecord(raw)) return state;
  state.awakeningKills = nonNegativeOr(raw.awakeningKills, 0);
  state.awakened = raw.awakened === true;
  state.bound = raw.bound === true;
  if (Array.isArray(raw.floorOnceSpent)) {
    state.floorOnceSpent = raw.floorOnceSpent.filter(isFloorOnceTraitKind);
  }
  const cooldowns = raw.cooldownFrames;
  if (isRecord(cooldowns)) {
    for (const kind of PERSISTED_COOLDOWN_TRAIT_KINDS) {
      const frames = nonNegativeOr(cooldowns[kind], 0);
      if (frames > 0) state.cooldownFrames[kind] = frames;
    }
  }
  return state;
}

/**
 * Per-item gear memory for one crawler, keyed by item id. Gear is unique per
 * party, so the id names the one piece.
 *
 * Kept for items that are not worn as well, so an awakening's progress or a
 * curse's binding is not lost when the piece goes back in the bag.
 */
export class GearState {
  private readonly items = new Map<ItemId, GearItemState>();
  /** What the crawler's gear is doing this moment; never saved. */
  readonly live = new GearLiveState();
  private changeCount = 0;
  /**
   * What `gearHooks` last derived from the crawler's worn gear, kept between
   * reads because max HP, every stat and every blow ask for it, many times a
   * frame. Valid only while both revisions it was built at still hold.
   */
  wornCache: WornGearCache | null = null;

  /**
   * Counts every change to what this crawler's pieces carry — an awakening, a
   * restore, a piece changing hands — the half of a worn-gear cache's key the
   * equipped set's own revision does not cover.
   */
  get revision(): number {
    return this.changeCount;
  }

  /** Marks what the pieces carry as changed, so a cache built before it is rebuilt. */
  noteChanged(): void {
    this.changeCount++;
  }

  /** The state of `id`, created fresh on first ask. */
  of(id: ItemId): GearItemState {
    const existing = this.items.get(id);
    if (existing !== undefined) return existing;
    const created = freshItemState();
    this.items.set(id, created);
    return created;
  }

  /** Whether `id` is a cursed piece bound to this crawler, read without creating an entry. */
  isBound(id: ItemId): boolean {
    return this.items.get(id)?.bound === true;
  }

  /**
   * Whether `id` has awakened, read without creating an entry: what its icon
   * and held visual ask on every draw.
   */
  isAwakened(id: ItemId): boolean {
    return this.items.get(id)?.awakened === true;
  }

  /**
   * Lets go of the binding on every piece not among `worn`: a reset that
   * stripped the crawler took the curse off with the piece, so it must not
   * come back bound when next put on.
   */
  releaseBindsNotWorn(worn: ReadonlySet<ItemId>): void {
    for (const [id, state] of this.items) if (!worn.has(id)) state.bound = false;
  }

  /** Lets every bound piece go: the party has reached a safe room. */
  releaseBinds(): void {
    for (const state of this.items.values()) state.bound = false;
  }

  /** Readies every once-per-floor effect again, for the crawler arriving on a new floor. */
  startNewFloor(): void {
    for (const state of this.items.values()) state.floorOnceSpent = [];
  }

  /**
   * Moves what `id` remembers to `to`, for the piece changing hands: an
   * awakening's progress goes with the piece rather than staying with the
   * crawler who gave it away.
   */
  transferTo(id: ItemId, to: GearState): void {
    const state = this.items.get(id);
    if (state === undefined) return;
    this.items.delete(id);
    to.items.set(id, state);
    this.noteChanged();
    to.noteChanged();
  }

  /** A deep copy for a snapshot, so the save never shares an object with the live state. */
  snapshot(): SavedGearItemState[] {
    return [...this.items].map(([id, state]) => [
      id,
      {
        ...state,
        floorOnceSpent: [...state.floorOnceSpent],
        cooldownFrames: { ...state.cooldownFrames },
      },
    ]);
  }

  /** Replaces every entry from a snapshot, dropping ids retired since it was written. */
  restore(saved: ReadonlyArray<SavedGearItemState> | undefined): void {
    this.items.clear();
    this.live.reset();
    this.noteChanged();
    for (const [id, raw] of saved ?? []) {
      if (isItemId(id)) this.items.set(id, parsedItemState(raw));
    }
  }
}
