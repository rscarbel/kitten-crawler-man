/**
 * The Starlight Tent's centre ring once the three acts are performed: a chest the
 * troupe guards, and a rope ladder up the king pole out through the canvas.
 *
 * The acts never hurt; the ring is the tent's one fight. Its guards are not
 * stood in the ring when the tent is built but come out the first time a
 * crawler steps into it with the last act behind them, so the chest is locked
 * from the frame they arrive until the last of them falls. Once the chest has
 * been opened the tent remembers it in `StarlightTentProgress`, and every later show
 * ends in an empty ring with the chest standing open.
 *
 * Built once per visit and carried across a mid-show restart, so a restart
 * neither places a second chest and ladder nor calls the guards twice.
 */

import { applySpawnDifficulty } from '../../core/difficulty/difficultyProfiles';
import type { StarlightTentProgress } from '../../core/state/StarlightTentProgress';
import type { Mob, LootDrop } from '../../creatures/Mob';
import { liveSpawnContext, spawnMob } from '../../levels/spawnFunnel';
import { starlightTentChestGear } from '../../loot/gearPools';
import {
  MAZE_FINAL_CHAMBER,
  MAZE_KING_POLE,
  MAZE_RING_CHEST_TILE,
  type MazeSectionId,
  type MazeTile,
} from '../../map/starlightTentMazeLayout';
import type { GameMap } from '../../map/GameMap';
import type { TilePoint } from '../../map/town/townPlan';
import type { Player } from '../../Player';
import { TILE_SIZE } from '../../core/constants';
import { ropeLadderFoot } from '../../sprites/art/starlightTent/finaleProps';
import { postChestBand, type ChestPlacer } from '../kits/ChestKit';
import type { InteriorExitFixtureSystem } from '../interiorExitFixtures';
import type { TreasureChest } from '../TreasureChestSystem';
import { questMobLevel } from '../questMobLevel';

/** The clowns the troupe sends out to hold the ring. */
export type RingGuardKind = 'tall_clown' | 'fat_clown' | 'massive_clown';

export interface RingGuardPost {
  readonly kind: RingGuardKind;
  readonly tile: MazeTile;
}

/**
 * Where each guard comes out, all in the ring's north half around the chest,
 * so the party walking in from the curtains at its south edge meets the line
 * rather than spawning inside it.
 */
export const RING_GUARD_POSTS: ReadonlyArray<RingGuardPost> = [
  { kind: 'massive_clown', tile: { x: 25, y: 3 } },
  { kind: 'fat_clown', tile: { x: 18, y: 3 } },
  { kind: 'fat_clown', tile: { x: 27, y: 6 } },
  { kind: 'tall_clown', tile: { x: 15, y: 6 } },
  { kind: 'tall_clown', tile: { x: 29, y: 2 } },
];

/**
 * The guards' authored level, pitched with the floor's other indoor fights
 * and lifted toward a late party the same way theirs are.
 */
const RING_GUARD_LEVEL = 6;

/** Where a crawler's footing is read from: the middle of their tile-sized body. */
const BODY_CENTRE_FRACTION = 0.5;

/** Half a tile: from the edge of a floor square to its middle. */
const FLOOR_SQUARE_MIDDLE = 0.5;

/**
 * The ladder is climbed from the floor square in front of its foot, centred
 * on the mast like the ladder itself.
 */
export function ropeLadderFixtureAt(): TilePoint {
  const foot = ropeLadderFoot(MAZE_KING_POLE);
  return { x: foot.x, y: foot.y + FLOOR_SQUARE_MIDDLE };
}

/** The pieces only this chest gives; the chest kit adds a rolled floor-3 chest on top. */
function ringChestLoot(): LootDrop {
  return { coins: 0, items: starlightTentChestGear().map((id) => ({ id, quantity: 1 })) };
}

function standsInRing(crawler: Player): boolean {
  const tileX = Math.floor((crawler.x + TILE_SIZE * BODY_CENTRE_FRACTION) / TILE_SIZE);
  const tileY = Math.floor((crawler.y + TILE_SIZE * BODY_CENTRE_FRACTION) / TILE_SIZE);
  return (
    tileX >= MAZE_FINAL_CHAMBER.x0 &&
    tileX <= MAZE_FINAL_CHAMBER.x1 &&
    tileY >= MAZE_FINAL_CHAMBER.y0 &&
    tileY <= MAZE_FINAL_CHAMBER.y1
  );
}

export interface StarlightTentFinaleDeps {
  readonly map: GameMap;
  readonly chests: ChestPlacer;
  readonly exits: Pick<InteriorExitFixtureSystem, 'place'>;
  readonly addMob: (mob: Mob) => void;
  readonly progress: StarlightTentProgress;
  /** The stronger crawler's level, which the guards are levelled against. */
  readonly partyLevel: number;
}

/** Where the ring's fight stands. */
type RingStage =
  /** The chest is shut and nobody has come out for it yet. */
  | { readonly kind: 'waiting' }
  /** The guards are out; the chest unlocks once the last of them is dead. */
  | { readonly kind: 'guarded'; readonly guards: ReadonlyArray<Mob> }
  /** The chest has been opened, on this show or an earlier one. */
  | { readonly kind: 'claimed' };

/** One line for the HUD while the party is in the ring. */
export interface RingObjective {
  readonly line: string;
  readonly done: boolean;
}

const GUARDS_WAITING_LINE = 'The centre ring: every act performed';
const CHEST_UNLOCKED_LINE = 'The ring is yours: open the chest';
const CLAIMED_LINE = 'Climb the rope ladder out, or leave by the flaps';

export class StarlightTentFinale {
  readonly chest: TreasureChest;
  private stage: RingStage;

  constructor(private readonly deps: StarlightTentFinaleDeps) {
    deps.exits.place({ id: 'rope_ladder', at: ropeLadderFixtureAt() });
    if (deps.progress.chestClaimed) {
      this.chest = deps.chests.opened(MAZE_RING_CHEST_TILE, 'wooden');
      this.stage = { kind: 'claimed' };
      return;
    }
    this.chest = deps.chests.heldByBand(MAZE_RING_CHEST_TILE, ringChestLoot());
    this.stage = { kind: 'waiting' };
  }

  /** The guards the ring has called out, alive or dead; empty before they come out and after a claim. */
  get guards(): ReadonlyArray<Mob> {
    return this.stage.kind === 'guarded' ? this.stage.guards : [];
  }

  /**
   * Calls the guards out the first time a crawler stands in the ring with the
   * last act on stage, and records the chest's claim the frame it is opened.
   */
  update(human: Player, cat: Player, actOnStage: MazeSectionId): void {
    switch (this.stage.kind) {
      case 'waiting': {
        const partyInRing = standsInRing(human) || standsInRing(cat);
        if (actOnStage === 'finale' && partyInRing) {
          this.stage = { kind: 'guarded', guards: this.callGuards() };
        }
        return;
      }
      case 'guarded':
        if (this.chest.state !== 'opened') return;
        this.deps.progress.chestClaimed = true;
        this.stage = { kind: 'claimed' };
        return;
      case 'claimed':
        return;
      default: {
        const unhandled: never = this.stage;
        return unhandled;
      }
    }
  }

  private callGuards(): Mob[] {
    const { map, addMob, partyLevel } = this.deps;
    const guards = RING_GUARD_POSTS.map((post) => {
      const guard = spawnMob(
        post.kind,
        post.tile,
        map,
        liveSpawnContext('quest:starlight-tent-maze'),
      );
      guard.applyMobLevel(questMobLevel(RING_GUARD_LEVEL, partyLevel));
      applySpawnDifficulty(guard);
      // They came out for the party; one that waited to be walked up to would
      // leave the chest guarded by a clown standing in a corner.
      guard.forceAggro = true;
      addMob(guard);
      return guard;
    });
    // Held by the guards themselves rather than by whoever stands in the
    // ring: the last clown chasing the party out through the curtains still
    // has the chest.
    postChestBand(this.chest, guards);
    return guards;
  }

  /** What the HUD asks of the party once they are in the ring. */
  objective(): RingObjective {
    switch (this.stage.kind) {
      case 'waiting':
        return { line: GUARDS_WAITING_LINE, done: true };
      case 'guarded': {
        const standing = this.stage.guards.filter((guard) => guard.isAlive).length;
        if (standing === 0) return { line: CHEST_UNLOCKED_LINE, done: true };
        return {
          line: `Clear the ring: ${standing} of ${this.stage.guards.length} clowns still standing`,
          done: false,
        };
      }
      case 'claimed':
        return { line: CLAIMED_LINE, done: true };
      default: {
        const unhandled: never = this.stage;
        return unhandled;
      }
    }
  }
}
