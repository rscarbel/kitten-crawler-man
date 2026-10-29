/**
 * The Kraken's flooded pump room's fight, as data: the one state it is in, and
 * the checkpoint that carries it and everything else the room changed.
 */

import { isFiniteNumber, isRecord } from '../../../core/util/guards';
import { PUMP_WALLS, type PumpWall } from './platforms';
import type { RaftTentacleState } from './raftTentacles';

/**
 * Where the fight is:
 *
 * - `approach`: nobody has crossed the corridor's trigger line yet.
 * - `intro_cutscene`: the barrels have come down and the camera is touring
 *   the room.
 * - `flooded`: the room is sealed and full; the party crosses the rafts and
 *   shuts the pumps while the Kraken waits under the surface.
 * - `draining`: the last pump is off and the water is going.
 * - `drained`: the floor is bare and the Kraken fights.
 * - `defeated`: she is dead.
 */
export type FloodedPumpRoomState =
  | { readonly kind: 'approach' }
  | { readonly kind: 'intro_cutscene' }
  | { readonly kind: 'flooded' }
  | { readonly kind: 'draining'; readonly framesLeft: number }
  | { readonly kind: 'drained' }
  | { readonly kind: 'defeated' };

/**
 * The states a checkpoint can hold. The intro is never one: it is a script
 * that cannot be resumed part-way, so a capture taken during it records the
 * room as the intro leaves it.
 */
export type CheckpointedFloodedRoomState = Exclude<
  FloodedPumpRoomState,
  { readonly kind: 'intro_cutscene' }
>;

/** The beats of the intro the room itself carries out, run from the cutscene. */
export type FloodedPumpRoomIntroBeat = 'barrels_fall' | 'mark_pumps';

/**
 * Where the corridor's barrels are: on their seat, fallen across the
 * corridor behind the trigger line, or floated into the room's entrance.
 */
export type BarrelPlace = 'stacked' | 'corridor' | 'entrance';

const BARREL_PLACES: readonly BarrelPlace[] = ['stacked', 'corridor', 'entrance'];

/** The tentacle that rises beside the raft of the second pump shut off. */
export type PumpTentacleState =
  | { readonly kind: 'dormant' }
  | { readonly kind: 'risen'; readonly wall: PumpWall }
  | { readonly kind: 'killed'; readonly wall: PumpWall };

/** The beached shark, in world tiles, where its fin was when the water went. */
export interface BeachedShark {
  readonly x: number;
  readonly y: number;
}

export interface FloodedPumpRoomCheckpoint {
  readonly state: CheckpointedFloodedRoomState;
  readonly pumpPresses: Readonly<Record<PumpWall, number>>;
  /** By raft, in the layout's order. */
  readonly raftTentacles: readonly RaftTentacleState[];
  readonly pumpTentacle: PumpTentacleState;
  readonly barrels: BarrelPlace;
  /** Blows each barrel has taken since it became breakable, in barrel order. */
  readonly barrelHits: readonly number[];
  /** Null until the water goes. */
  readonly beachedShark: BeachedShark | null;
}

const RAFT_TENTACLE_STATES: readonly RaftTentacleState[] = ['dormant', 'risen', 'killed'];

function isPumpWall(value: unknown): value is PumpWall {
  return PUMP_WALLS.some((wall) => wall === value);
}

function parseState(value: unknown): CheckpointedFloodedRoomState | undefined {
  if (!isRecord(value)) return undefined;
  switch (value.kind) {
    case 'approach':
    case 'flooded':
    case 'drained':
    case 'defeated':
      return { kind: value.kind };
    case 'draining':
      return isFiniteNumber(value.framesLeft)
        ? { kind: 'draining', framesLeft: value.framesLeft }
        : undefined;
    default:
      return undefined;
  }
}

function parsePumpTentacle(value: unknown): PumpTentacleState | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === 'dormant') return { kind: 'dormant' };
  if (!isPumpWall(value.wall)) return undefined;
  if (value.kind === 'risen' || value.kind === 'killed')
    return { kind: value.kind, wall: value.wall };
  return undefined;
}

function parsePumpPresses(value: unknown): Record<PumpWall, number> | undefined {
  if (!isRecord(value)) return undefined;
  const { left, far, right } = value;
  if (!isFiniteNumber(left) || !isFiniteNumber(far) || !isFiniteNumber(right)) return undefined;
  return { left, far, right };
}

function parseBeached(value: unknown): BeachedShark | undefined {
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return undefined;
  return { x: value.x, y: value.y };
}

/** Reads a saved flooded pump room checkpoint back from untrusted JSON; undefined when malformed. */
export function parseFloodedPumpRoomCheckpoint(
  value: unknown,
): FloodedPumpRoomCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const state = parseState(value.state);
  const pumpPresses = parsePumpPresses(value.pumpPresses);
  const pumpTentacle = parsePumpTentacle(value.pumpTentacle);
  const barrels = BARREL_PLACES.find((place) => place === value.barrels);
  if (state === undefined || pumpPresses === undefined || pumpTentacle === undefined) {
    return undefined;
  }
  if (barrels === undefined) return undefined;
  const { raftTentacles, barrelHits } = value;
  if (!Array.isArray(raftTentacles) || !Array.isArray(barrelHits)) return undefined;
  const beachedShark = value.beachedShark === null ? null : parseBeached(value.beachedShark);
  if (beachedShark === undefined) return undefined;
  const rafts: RaftTentacleState[] = [];
  for (const entry of raftTentacles) {
    const raft = RAFT_TENTACLE_STATES.find((known) => known === entry);
    if (raft === undefined) return undefined;
    rafts.push(raft);
  }
  if (!barrelHits.every(isFiniteNumber)) return undefined;
  return {
    state,
    pumpPresses,
    raftTentacles: rafts,
    pumpTentacle,
    barrels,
    barrelHits: barrelHits.filter(isFiniteNumber),
    beachedShark,
  };
}
