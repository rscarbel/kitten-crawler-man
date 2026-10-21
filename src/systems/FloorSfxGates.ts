/**
 * Decides which of floor 3's gated SFX groups stay decoded.
 *
 * The village's siege and the bounty and circus questlines carry tens of
 * megabytes of decoded sound between them, and most of a session is spent
 * where none of it can play. Each gated group is held while something that
 * plays it is under way, or while the party is near the place it belongs to,
 * with a wider radius to let go than to take hold so walking the edge never
 * thrashes the decoder.
 *
 * The approach radius is the decode's head start: a crawler covers about five
 * tiles a second, so a group is asked for seconds before the party can reach
 * anything that sounds it. A recall's landing counts as where the party stands
 * from the moment the channel starts, which gives a warp the channel's three
 * seconds. A scene built mid-quest asks before its first frame, beside the
 * floor's own groups. Every group without a gate here — any floor but the
 * overworld — is let go.
 */

import { GATED_SFX_GROUPS, type GatedSfxGroup } from '../audio/sfxGroups';
import type { TilePoint, TileRect } from '../map/town/townPlan';

/** One gated group: what holds it wherever the party is, and where it belongs. */
export interface FloorSfxGate {
  readonly group: GatedSfxGroup;
  /** True while something under way can play the group wherever the party is. */
  readonly activeAnywhere: () => boolean;
  /** Where the group's sounds come from; the party nearing any of these holds it. */
  readonly places: readonly TileRect[];
}

/** What is under way on the overworld that can sound a gated group wherever the party is. */
export interface OverworldActivity {
  /** The siege's countdown or waves are running. */
  readonly siegeRunning: boolean;
  /** Some of a siege's dead still stand, walking back out after it ended. */
  readonly siegeDeadStanding: boolean;
  /** Midge is on the road. */
  readonly escortUnderWay: boolean;
  /** Some of the road's ambushers still stand, Midge delivered or not. */
  readonly escortAmbushersStanding: boolean;
  /** A bounty has been taken and not yet collected. */
  readonly bountyOut: boolean;
  /** The circus quest's waves or bear are out. */
  readonly circusMobsOut: boolean;
}

/**
 * Which gated groups `activity` can play anywhere. A siege fields bounty bosses
 * as its marks and the circus's clowns, lemurs and llamas in its waves, so it
 * holds all three.
 */
export function groupsActiveAnywhere(
  activity: OverworldActivity,
): Readonly<Record<GatedSfxGroup, boolean>> {
  const siege = activity.siegeRunning || activity.siegeDeadStanding;
  return {
    briarHollowSiege: siege || activity.escortUnderWay || activity.escortAmbushersStanding,
    bounty: activity.bountyOut || siege,
    circusQuest: activity.circusMobsOut || siege,
  };
}

/** The holder the gates drive; `AudioManager` in the game. */
export interface SfxGroupHolder {
  holdSfxGroup(group: GatedSfxGroup, held: boolean): void;
  holdsSfxGroup(group: GatedSfxGroup): boolean;
}

/** Tiles from a gated place at which its group starts decoding. */
export const SFX_GATE_APPROACH_TILES = 40;
/** Tiles from every gated place past which a held group is let go. */
export const SFX_GATE_LEAVE_TILES = 70;

/** Tiles from `tile` to the nearest tile of `rect`, counting diagonals as one; zero inside it. */
function tilesOutside(rect: TileRect, tile: TilePoint): number {
  const lastX = rect.x + rect.w - 1;
  const lastY = rect.y + rect.h - 1;
  const dx = Math.max(rect.x - tile.x, 0, tile.x - lastX);
  const dy = Math.max(rect.y - tile.y, 0, tile.y - lastY);
  return Math.max(dx, dy);
}

export class FloorSfxGates {
  constructor(
    private readonly holder: SfxGroupHolder,
    private readonly gates: readonly FloorSfxGate[],
  ) {}

  /** Holds or lets go of every gated group for where `partyTiles` stand and what is under way. */
  update(partyTiles: readonly TilePoint[]): void {
    for (const group of GATED_SFX_GROUPS) {
      const gate = this.gates.find((candidate) => candidate.group === group);
      this.holder.holdSfxGroup(group, gate !== undefined && this.wants(gate, partyTiles));
    }
  }

  private wants(gate: FloorSfxGate, partyTiles: readonly TilePoint[]): boolean {
    if (gate.activeAnywhere()) return true;
    const reach = this.holder.holdsSfxGroup(gate.group)
      ? SFX_GATE_LEAVE_TILES
      : SFX_GATE_APPROACH_TILES;
    return gate.places.some((place) =>
      partyTiles.some((tile) => tilesOutside(place, tile) <= reach),
    );
  }
}
