/**
 * Midge at home: once she is delivered, she lives in Garrison Green, Wendell's
 * pasture in the Over City, for the rest of the run.
 *
 * Garrison Green's props are dressed by `TownDecorSystem`, which holds only
 * pictures; Midge is a mob in the scene's roster, so she is raised here, by
 * the quest part that walked her there, on every scene built after she
 * arrived. She lives by the herd's rules — the same routine inside her own
 * pen, and the same `LivestockRespawner` bringing her back `RESPAWN_SECONDS`
 * after a death, cleared tile and all, in her pasture and never in Briar
 * Hollow — but she lows far less than the herd does, and in one voice.
 */

import { TILE_SIZE } from '../../../core/constants';
import { applySpawnDifficulty } from '../../../core/difficultyProfiles';
import { Cow, LIVESTOCK_LEVEL } from '../../../creatures/Cow';
import type { Player } from '../../../Player';
import type { GameMap } from '../../../map/GameMap';
import type { TilePoint } from '../../../map/town/townPlan';
import type { MobRoster } from '../../kits/SceneWorld';
import { CowPen } from '../cowPen';
import {
  IN_VIEW_TILES,
  MIDGE_COAT,
  MIDGE_COW_NAME,
  MOO_EARSHOT_TILES,
  ROUTINE_WARM_TILES,
} from '../LivestockSystem';
import { LivestockRespawner } from '../livestockRespawn';
import { clearRespawnTile } from '../respawnClearance';
import type { BlueprintsCue } from './blueprintsSoundCues';
import { garrisonGreen } from './garrisonGreen';

const UPDATES_PER_SECOND = 60;

/**
 * Her own moo timer, much slower than the herd's shared one (8–20 s): one
 * cow alone in a town yard lowing every few seconds would be all the Upper
 * Lane ever heard.
 */
export const WENDELL_COW_MOO_MIN_SECONDS = 45;
export const WENDELL_COW_MOO_MAX_SECONDS = 90;
/** A delivered Midge not yet in through the gate after this long is set down inside. */
const MIDGE_WALK_IN_TIMEOUT_SECONDS = 12;

export interface WendellsMidgeDeps {
  readonly gameMap: GameMap;
  readonly roster: MobRoster;
  /** Both crawlers, wherever they stand. */
  readonly crawlers: () => readonly Player[];
  /** The crawler the player is steering. */
  readonly active: () => Player;
  /** Plays one of the quest's cues: her moo is `midgeAmbientMoo`. */
  readonly cue: (cue: BlueprintsCue) => void;
  /** Seeded in the gates; the game uses `Math.random`. */
  readonly random?: () => number;
}

function tilesBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y) / TILE_SIZE;
}

export class WendellsMidge {
  /** Her pen: the ground inside Garrison Green's fence, and its gate. Null off the town floor. */
  readonly pen: CowPen | null;
  private readonly respawner: LivestockRespawner | null;
  private readonly random: () => number;
  private cow: Cow | null = null;
  /**
   * Updates until her next moo; null until she lives here, so a scene built
   * long before the delivery draws nothing from the random source for her.
   */
  private mooUpdatesLeft: number | null = null;
  /** Where she stands when raised, where she comes back to, and where a rewind puts her. */
  private readonly home: TilePoint | null;
  /** Updates she has spent off her pen since she was adopted, walking in through the gate. */
  private offPenUpdates = 0;

  constructor(private readonly deps: WendellsMidgeDeps) {
    this.random = deps.random ?? Math.random;
    const green = garrisonGreen(deps.gameMap);
    this.pen = green === null ? null : CowPen.forYard(deps.gameMap, green.bounds, green.gateTiles);
    this.respawner =
      this.pen === null
        ? null
        : new LivestockRespawner({ gameMap: deps.gameMap, roster: deps.roster, pen: this.pen });
    this.home = this.pen === null ? null : this.homeTile(this.pen);
  }

  /** Midge in her pasture, alive or waiting to stand back up; null before she lives here. */
  get midge(): Cow | null {
    return this.cow;
  }

  /**
   * Midge delivered at the end of her escort, perhaps still walking in
   * through the gate: she lives here now, a plain cow of the pasture with the
   * herd's own health, and this is where a rewind or a respawn stands her.
   */
  adopt(cow: Cow): void {
    const pen = this.pen;
    if (pen === null) return;
    cow.pen = pen;
    cow.name = MIDGE_COW_NAME;
    cow.restoreHerdHp();
    cow.cannotBeKilled = false;
    cow.healthBarDrawnElsewhere = false;
    const home = this.home ?? cow.tile;
    this.respawner?.setHome(cow, home);
    // The body the escort led was spawned in Merrit's paddock; a rewind must
    // not stand it back there.
    cow.setHomeTile(home);
    this.cow = cow;
    this.offPenUpdates = 0;
    this.mooUpdatesLeft ??= this.nextMooDelay();
  }

  /**
   * Raises Midge in her pasture unless she already stands there — the scene
   * was built, or rewound, after she was delivered. Does nothing off the town
   * floor or when the pasture has no ground she can stand on.
   */
  ensureResident(): void {
    const pen = this.pen;
    // A Midge a rewind dropped is forgotten by `onRewind`, so one held here is standing.
    if (pen === null || this.cow !== null) return;
    const tile = this.home;
    if (tile === null) return;
    const cow = new Cow(tile.x, tile.y, TILE_SIZE, MIDGE_COAT, 'adult', this.random);
    cow.applyMobLevel(LIVESTOCK_LEVEL);
    applySpawnDifficulty(cow);
    clearRespawnTile(
      { gameMap: this.deps.gameMap, roster: this.deps.roster, crawlers: this.deps.crawlers() },
      tile,
      cow,
    );
    this.deps.roster.add(cow);
    this.adopt(cow);
    cow.warmRoutine(false);
  }

  /**
   * Where she stands when she is raised and where she comes back to: the open
   * pasture tile nearest the middle of the green, which the dressing keeps
   * clear for her.
   */
  private homeTile(pen: CowPen): TilePoint | null {
    const open = pen.pastureTiles.filter((tile) => pen.isPassable(tile.x, tile.y));
    if (open.length === 0) return null;
    const middleX = open.reduce((sum, tile) => sum + tile.x, 0) / open.length;
    const middleY = open.reduce((sum, tile) => sum + tile.y, 0) / open.length;
    let best = open[0];
    let bestDistance = Infinity;
    for (const tile of open) {
      const distance = Math.hypot(tile.x - middleX, tile.y - middleY);
      if (distance < bestDistance) {
        best = tile;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** Once per gameplay frame: her respawn, keeping her rows warm while the party is near, and her moo. */
  update(): void {
    const cow = this.cow;
    if (cow === null) return;
    const crawlers = this.deps.crawlers();
    if (!cow.isAlive) {
      this.respawner?.tick(cow, crawlers, false);
      return;
    }
    let nearestTiles = Infinity;
    for (const crawler of crawlers)
      nearestTiles = Math.min(nearestTiles, tilesBetween(cow, crawler));
    this.finishWalkingIn(cow);
    if (nearestTiles <= ROUTINE_WARM_TILES) {
      cow.warmRoutine(tilesBetween(cow, this.deps.active()) <= IN_VIEW_TILES);
    }
    this.tickMoo(cow, nearestTiles);
  }

  /**
   * Delivered outside the fence, she walks in through the gate by her own
   * routine; one that has not made it in after
   * {@link MIDGE_WALK_IN_TIMEOUT_SECONDS} — somebody standing in the gate —
   * is set down on her home tile.
   */
  private finishWalkingIn(cow: Cow): void {
    const pen = this.pen;
    if (pen === null || pen.holdsBody(cow.x, cow.y)) {
      this.offPenUpdates = 0;
      return;
    }
    this.offPenUpdates++;
    if (this.offPenUpdates < MIDGE_WALK_IN_TIMEOUT_SECONDS * UPDATES_PER_SECOND) return;
    this.offPenUpdates = 0;
    this.moveHome(cow);
  }

  /** Stands her on her home tile, keeping her place in the mob grid with her. */
  private moveHome(cow: Cow): void {
    const home = this.home;
    if (home === null) return;
    const previousX = cow.x;
    const previousY = cow.y;
    cow.x = home.x * TILE_SIZE;
    cow.y = home.y * TILE_SIZE;
    cow.forceRepath();
    this.deps.roster.grid.move(cow, previousX, previousY);
  }

  /** Her one voice, now and then, and only with someone near enough to hear it. */
  private tickMoo(cow: Cow, nearestCrawlerTiles: number): void {
    if (this.mooUpdatesLeft === null) return;
    if (this.mooUpdatesLeft > 0) {
      this.mooUpdatesLeft--;
      return;
    }
    if (nearestCrawlerTiles > MOO_EARSHOT_TILES || cow.isPanicking) return;
    this.deps.cue('midgeAmbientMoo');
    this.mooUpdatesLeft = this.nextMooDelay();
  }

  private nextMooDelay(): number {
    const seconds =
      WENDELL_COW_MOO_MIN_SECONDS +
      this.random() * (WENDELL_COW_MOO_MAX_SECONDS - WENDELL_COW_MOO_MIN_SECONDS);
    return Math.round(seconds * UPDATES_PER_SECOND);
  }

  /**
   * A rewind to before she was delivered: she is not Wendell's after all.
   * Returns the body, for whoever has her now — the escort, or the herd.
   */
  release(): Cow | null {
    const cow = this.cow;
    if (cow === null) return null;
    this.cow = null;
    this.respawner?.forget(cow);
    cow.setHomeTile(null);
    return cow;
  }

  /**
   * A death rewind: a Midge the rewind dropped is forgotten, to be raised
   * afresh; one it kept is stood back in her pasture, wherever the rewind
   * put her.
   */
  onRewind(): void {
    const cow = this.cow;
    if (cow === null) return;
    if (!this.deps.roster.mobs.includes(cow)) {
      this.respawner?.forget(cow);
      this.cow = null;
      return;
    }
    const pen = this.pen;
    if (pen !== null && !pen.holdsBody(cow.x, cow.y)) this.moveHome(cow);
  }
}
