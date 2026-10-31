/**
 * Everything the party holds of every kind of key on the floor it stands on,
 * and the seals its keys have opened there.
 *
 * One ring is threaded by reference through every scene of a floor, like
 * `TownMemory`, and saved and rewound with the floor's world: a fragment taken
 * from a boss killed after the last save goes back with the boss.
 */

import type { LevelId } from '../../levels/levelIds';
import {
  floorKeysFor,
  fragmentDef,
  stairwellKey,
  type FloorFragmentDef,
  type FloorKey,
  type FragmentDef,
  type TableFloorKey,
} from './floorKeys';
import { fragmentHome, fragmentsOfKey, type FragmentId } from './fragmentIds';
import {
  keptAcrossFloors,
  keyKindDef,
  opensStairwells,
  type KeyKind,
  type KeyKindDef,
} from './keyKinds';
import { KeyMomentQueue } from './keyMoments';
import { emptyKeyRingState, type KeyRingState, type StairwellTile } from './keyRingState';

const FORGE_TICKET: unique symbol = Symbol('forgeTicket');

/**
 * Proof that every fragment of a key was held when the ticket was cut. Only
 * {@link KeyRing} makes one, so `forge` cannot be asked of a key with a
 * piece missing.
 */
export interface ForgeTicket {
  readonly [FORGE_TICKET]: true;
  readonly kind: KeyKind;
  /** The ring's count of rewinds and floor changes when cut: a ticket from before one is refused. */
  readonly generation: number;
}

/** What claiming a fragment would make of its key, worked out without claiming it. */
export interface ClaimPreview {
  readonly fragment: FragmentDef;
  readonly keyKind: KeyKind;
  /** The piece's place among its key's fragments on this floor. */
  readonly index: number;
  /** Which of the key's pieces on this floor are held with this one, by `index`. */
  readonly heldMask: readonly boolean[];
  readonly held: number;
  readonly needed: number;
  readonly completesKey: boolean;
}

/** What claiming a fragment did. */
type ClaimOutcome =
  /** Already on the ring: a replayed event, or a deed recognised twice. */
  | { readonly kind: 'alreadyHeld' }
  /** The fragment belongs to no key on the ring's floor. */
  | { readonly kind: 'notOnFloor' }
  | (ClaimPreview & { readonly kind: 'claimed'; readonly completesKey: false })
  | (ClaimPreview & {
      readonly kind: 'claimed';
      readonly completesKey: true;
      readonly ticket: ForgeTicket;
    });

/** What forging a key did. */
type ForgeOutcome = 'forged' | 'alreadyForged' | 'stale';

/** One fragment of a key as the menu shows it. */
export interface FragmentView {
  readonly fragment: FloorFragmentDef;
  readonly held: boolean;
}

/** One key on the floor as the key ring menu shows it. */
export interface KeyView {
  readonly kind: KeyKind;
  readonly def: KeyKindDef;
  /** In the floor table's order, which is also the order of the key's pieces. */
  readonly fragments: readonly FragmentView[];
  readonly held: number;
  readonly needed: number;
  readonly forged: boolean;
}

export interface KeyRingView {
  readonly levelId: LevelId;
  /** In the floor table's order; never empty, since every floor holds a key. */
  readonly keys: readonly [KeyView, ...KeyView[]];
  /** Fragments held of every key on the floor. */
  readonly heldOnFloor: number;
}

function sameTile(a: StairwellTile, b: StairwellTile): boolean {
  return a.x === b.x && a.y === b.y;
}

/** How a floor checkpoint treats the run's progress: a death rewinds it, a building exit keeps it. */
export type CheckpointRunProgress = 'rewind' | 'keep';

export class KeyRing {
  private state: KeyRingState;
  private generation = 0;
  /**
   * The ceremonies owed for live awards, threaded with the ring so a moment
   * queued just before a door survives the scene on the far side. Not saved:
   * a reload reconciles the ring silently.
   */
  readonly moments = new KeyMomentQueue();

  constructor(levelId: LevelId) {
    this.state = emptyKeyRingState(levelId);
  }

  get levelId(): LevelId {
    return this.state.levelId;
  }

  /** Whether the key system has been built on this floor before; see {@link KeyRingState.floorBuilt}. */
  get floorBuilt(): boolean {
    return this.state.floorBuilt;
  }

  markFloorBuilt(): void {
    this.state = { ...this.state, floorBuilt: true };
  }

  /** The keys the ring's floor holds. */
  keysOnFloor(): readonly [TableFloorKey, ...TableFloorKey[]] {
    return floorKeysFor(this.state.levelId);
  }

  holds(id: FragmentId): boolean {
    return this.state.held.includes(id);
  }

  isForged(kind: KeyKind): boolean {
    return this.state.forged.includes(kind);
  }

  private keyOf(fragment: FragmentId): FloorKey | null {
    return this.keysOnFloor().find((key) => key.fragments.some((f) => f.id === fragment)) ?? null;
  }

  /** Every piece of `kind` the ring needs, by the kind's scope. */
  private piecesOf(kind: KeyKind): readonly FragmentId[] {
    return fragmentsOfKey(kind, this.state.levelId);
  }

  private heldOf(kind: KeyKind): number {
    return this.piecesOf(kind).filter((id) => this.holds(id)).length;
  }

  private ticketFor(kind: KeyKind): ForgeTicket {
    return { [FORGE_TICKET]: true, kind, generation: this.generation };
  }

  /** What claiming `id` would do, or null when it is held already or belongs to no key on this floor. */
  previewClaim(id: FragmentId): ClaimPreview | null {
    if (this.holds(id)) return null;
    const key = this.keyOf(id);
    if (key === null) return null;
    const keyKind = key.kind;
    const heldWith = (piece: FragmentId): boolean => piece === id || this.holds(piece);
    const held = this.piecesOf(keyKind).filter(heldWith).length;
    const needed = this.piecesOf(keyKind).length;
    return {
      fragment: fragmentDef(id),
      keyKind,
      index: key.fragments.findIndex((piece) => piece.id === id),
      heldMask: key.fragments.map((piece) => heldWith(piece.id)),
      held,
      needed,
      completesKey: held === needed,
    };
  }

  claim(id: FragmentId): ClaimOutcome {
    if (this.holds(id)) return { kind: 'alreadyHeld' };
    const preview = this.previewClaim(id);
    if (preview === null) return { kind: 'notOnFloor' };
    this.state = { ...this.state, held: [...this.state.held, id] };
    if (!preview.completesKey) return { ...preview, kind: 'claimed', completesKey: false };
    const ticket = this.ticketFor(preview.keyKind);
    return { ...preview, kind: 'claimed', completesKey: true, ticket };
  }

  /**
   * A ticket for a key whose every piece is held but which has not been
   * forged, or null. For a ring restored or reconciled into that state, where
   * no claim is left to cut one.
   */
  unforgedWholeKey(kind: KeyKind): ForgeTicket | null {
    if (this.isForged(kind)) return null;
    const needed = this.piecesOf(kind).length;
    if (needed === 0 || this.heldOf(kind) < needed) return null;
    return this.ticketFor(kind);
  }

  /** Whether every piece of `kind` is held, whether or not its forge has run yet. */
  private isWhole(kind: KeyKind): boolean {
    return this.isForged(kind) || this.unforgedWholeKey(kind) !== null;
  }

  /**
   * Whether a key that opens this floor's stairwells is whole: true from the
   * moment its last piece is claimed, before its forge ceremony has played.
   */
  stairwellKeyIsWhole(): boolean {
    return this.isWhole(stairwellKey(this.state.levelId).kind);
  }

  /** The key that opens this floor's stairwells, as the menu and the seals show it. */
  stairwellKeyView(): KeyView {
    return this.keyView(stairwellKey(this.state.levelId));
  }

  forge(ticket: ForgeTicket): ForgeOutcome {
    if (ticket.generation !== this.generation) return 'stale';
    if (this.isForged(ticket.kind)) return 'alreadyForged';
    this.state = { ...this.state, forged: [...this.state.forged, ticket.kind] };
    return 'forged';
  }

  /** Whether `kind` is forged and opens stairwells. */
  private canUnseal(kind: KeyKind): boolean {
    return this.isForged(kind) && opensStairwells(kind);
  }

  /** Whether any key the party holds opens this floor's stairwells. */
  canUnsealStairwells(): boolean {
    return this.stairwellOpener() !== null;
  }

  /** The forged key that opens this floor's stairwells, or null while none is. */
  stairwellOpener(): KeyKind | null {
    return this.state.forged.find((kind) => this.canUnseal(kind)) ?? null;
  }

  markUnsealed(tile: StairwellTile): void {
    if (this.isUnsealed(tile)) return;
    const opened = { x: tile.x, y: tile.y };
    this.state = { ...this.state, unsealedStairwells: [...this.state.unsealedStairwells, opened] };
  }

  isUnsealed(tile: StairwellTile): boolean {
    return this.state.unsealedStairwells.some((opened) => sameTile(opened, tile));
  }

  /**
   * The party arrives on `levelId`. Each kind's holdings follow its scope, and
   * the seals of the floor left behind are forgotten. Arriving again on the
   * floor the ring is already on (a floor restart) keeps the record that its
   * ring has been built, so deeds done before the restart are not taken for
   * deeds carried in from another run.
   */
  beginFloor(levelId: LevelId): void {
    const keptHeld = this.state.held.filter((id) => keptAcrossFloors(fragmentHome(id).kind));
    const keptForged = this.state.forged.filter(keptAcrossFloors);
    this.state = {
      levelId,
      floorBuilt: levelId === this.state.levelId && this.state.floorBuilt,
      held: keptHeld,
      forged: keptForged,
      unsealedStairwells: [],
    };
    this.generation++;
    this.moments.clear();
  }

  capture(): KeyRingState {
    return this.state;
  }

  /**
   * Puts the ring back to a checkpoint or a save. Owed ceremonies are dropped
   * and every outstanding forge ticket goes stale, since both describe a ring
   * that no longer exists.
   */
  restore(state: KeyRingState): void {
    if (state.levelId !== this.state.levelId) {
      throw new Error(`A ${state.levelId} key ring cannot be restored onto ${this.state.levelId}`);
    }
    this.state = state;
    this.generation++;
    this.moments.clear();
  }

  /**
   * Applies a floor checkpoint to the ring. A rewind (a death) puts the ring
   * back to the capture. Coming back out of a building keeps the ring as it
   * stands: it was threaded indoors by reference, so it already holds what the
   * party earned there, the ceremonies still owed for it and the Keys button's
   * news; the snapshot taken at the door would wipe all three.
   */
  applyCheckpoint(state: KeyRingState, runProgress: CheckpointRunProgress): void {
    switch (runProgress) {
      case 'rewind':
        this.restore(state);
        return;
      case 'keep':
        return;
      default: {
        const unhandled: never = runProgress;
        return unhandled;
      }
    }
  }

  private keyView(key: TableFloorKey): KeyView {
    const fragments = key.fragments.map((fragment) => ({
      fragment,
      held: this.holds(fragment.id),
    }));
    return {
      kind: key.kind,
      def: keyKindDef(key.kind),
      fragments,
      held: this.heldOf(key.kind),
      needed: this.piecesOf(key.kind).length,
      forged: this.isForged(key.kind),
    };
  }

  view(): KeyRingView {
    const toView = (key: TableFloorKey): KeyView => this.keyView(key);
    const [first, ...rest] = this.keysOnFloor();
    const keys: KeyRingView['keys'] = [toView(first), ...rest.map(toView)];
    const heldOnFloor = keys.reduce((total, key) => total + key.held, 0);
    return { levelId: this.state.levelId, keys, heldOnFloor };
  }
}
