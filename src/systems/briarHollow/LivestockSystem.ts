/**
 * Briar Hollow's herd: five cows and three calves in the paddock beside the
 * barn.
 *
 * Owns what belongs to the herd rather than to one animal — putting it in the
 * pen, pairing each calf with a mother, the herd's one shared moo timer, the
 * siege sending everyone into the barn, a blast nearby setting them bolting,
 * petting and its hearts, and a dead cow's burgers. Each animal's own routine
 * lives on `Cow`.
 *
 * Rebuilt with the scene on every door visit, and the herd with it: the
 * animals are ordinary spawns, so one killed earlier is back when the party
 * comes out of a building. Nothing here needs to outlive that. The one trace a
 * herd leaves on the village — Merrit remembering a cow being petted — is
 * written by the villagers into the durable state off `cowPetted`.
 */

import { TILE_SIZE } from '../../core/constants';
import type { EventBus } from '../../core/EventBus';
import type { VillageQuestPhase } from '../../core/villageQuestPhase';
import { applySpawnDifficulty } from '../../core/difficultyProfiles';
import { Cow, type CowRowWarmer, LIVESTOCK_LEVEL } from '../../creatures/Cow';
import { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import { playPetGesture } from '../../creatures/humanGestures';
import type { GameMap } from '../../map/GameMap';
import type { BriarHollowSite } from '../../map/overworld/briarHollowSite';
import type { TilePoint } from '../../map/town/townPlan';
import type { CowAge, CowCoatId } from '../../sprites/cowSprite';
import { drawInteractionPrompt } from '../../ui/InteractionPrompt';
import { randomInt } from '../../utils';
import { EmoteEffectSystem } from '../EmoteEffectSystem';
import type { GroundPickupSystem } from '../GroundPickupSystem';
import { hostileWithinAttackRange } from '../interactionPromptGate';
import type { MobRoster } from '../kits/SceneWorld';
import { CowPen } from './cowPen';
import { clearRespawnTile } from './respawnClearance';

const UPDATES_PER_SECOND = 60;
const SECONDS_PER_UPDATE = 1 / UPDATES_PER_SECOND;
const TILE_CENTRE = 0.5;

/** The adults, by coat: a mixed herd with every coat represented. */
const ADULT_COATS: readonly CowCoatId[] = ['holstein', 'jersey', 'dun', 'holstein', 'jersey'];
/** The calves, by coat; each is paired with an adult of the same coat. */
const CALF_COATS: readonly CowCoatId[] = ['holstein', 'jersey', 'dun'];
/** A calf is placed at most this far from its mother. */
const CALF_SPAWN_RADIUS_TILES = 2;

/** How close, centre to centre, a crawler must be to pet a cow. Facing is not required. */
export const PET_RANGE_TILES = 1.4;
/**
 * A crawler this near keeps the herd's everyday rows warm — walking, idling,
 * grazing — so the herd never comes into view cold.
 */
const ROUTINE_WARM_TILES = 30;
/** Within this many tiles of the active crawler an animal is on screen at a normal camera distance. */
const IN_VIEW_TILES = 12;
/** A blast inside this many tiles of an animal sets it bolting. */
export const PANIC_RADIUS_TILES = 5;

/** Burgers a dead cow or calf leaves. */
export const BURGERS_PER_COW_MIN = 2;
export const BURGERS_PER_COW_MAX = 3;

/** The herd moos at most once in this many seconds, and only with a crawler this near. */
const MOO_MIN_SECONDS = 8;
const MOO_MAX_SECONDS = 20;
const MOO_EARSHOT_TILES = 12;

/** A dead animal stands back up in its pasture after this long. */
const RESPAWN_SECONDS = 30;
const RESPAWN_UPDATES = RESPAWN_SECONDS * UPDATES_PER_SECOND;

const NO_THREATS: readonly BlastThreat[] = [];

/** Phases in which the herd is shut in the barn. */
const SHELTER_PHASES: ReadonlySet<VillageQuestPhase> = new Set(['imminent', 'assault']);

/** Someone in the party: anything with a tile-sized body at (`x`, `y`). */
interface HerdCrawler {
  readonly x: number;
  readonly y: number;
}

export interface LivestockDeps {
  readonly gameMap: GameMap;
  readonly site: BriarHollowSite;
  readonly roster: MobRoster;
  readonly bus: EventBus;
  /** Where a dead cow's burgers are dropped. */
  readonly groundPickups: GroundPickupSystem;
  /** The village questline's current phase, read live. */
  readonly questPhase: () => VillageQuestPhase;
  /** Seeded in the gates; the game uses `Math.random`. */
  readonly random?: () => number;
  /**
   * Everywhere a bang may soon land — a burning stick, a stick in hand, a
   * Smush winding up — read every update, so the herd can warm what a blast
   * would draw before it goes off.
   */
  readonly blastThreats?: () => readonly BlastThreat[];
  /** How the herd asks for rows ahead of use; a recorder in the gates. */
  readonly warmer?: CowRowWarmer;
}

/**
 * A bang that may be coming: where, how far from there it would set an animal
 * bolting, and how far it could kill one.
 */
export interface BlastThreat {
  readonly x: number;
  readonly y: number;
  readonly reachTiles: number;
  readonly killReachTiles: number;
}

/** The party for one herd update. */
export interface LivestockFrame {
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly active: HumanPlayer | CatPlayer;
}

function centreDistanceTiles(a: HerdCrawler, b: HerdCrawler): number {
  return Math.hypot(a.x - b.x, a.y - b.y) / TILE_SIZE;
}

export class LivestockSystem {
  readonly pen: CowPen;
  readonly emotes: EmoteEffectSystem;
  private readonly herdList: Cow[] = [];
  private readonly deps: LivestockDeps;
  private readonly random: () => number;
  private mooUpdatesLeft: number;
  /** Where each animal first stood, which is where it comes back. */
  private readonly homeTiles = new Map<Cow, TilePoint>();
  /** Updates until each dead animal respawns; absent until its death is first seen. */
  private readonly respawnUpdatesLeft = new Map<Cow, number>();
  private readonly unsubscribers: Array<() => void> = [];

  constructor(deps: LivestockDeps) {
    this.deps = deps;
    this.random = deps.random ?? Math.random;
    this.pen = CowPen.forSite(deps.gameMap, deps.site);
    this.emotes = new EmoteEffectSystem(this.random);
    this.mooUpdatesLeft = this.nextMooDelay();
    this.spawnHerd();
    this.unsubscribers.push(
      deps.bus.on('blastLanded', ({ x, y }) => this.onBlast(x, y)),
      deps.bus.on('mobKilled', ({ mob }) => {
        if (mob instanceof Cow && this.herdList.includes(mob)) this.onCowKilled(mob);
      }),
    );
  }

  /** Every animal in the herd, alive or dead. */
  get herd(): readonly Cow[] {
    return this.herdList;
  }

  private spawnHerd(): void {
    const open = this.pen.pastureTiles.filter((tile) => this.pen.isPassable(tile.x, tile.y));
    const taken = new Set<string>();
    const claim = (candidates: readonly TilePoint[]): TilePoint | null => {
      const free = candidates.filter((tile) => !taken.has(`${tile.x},${tile.y}`));
      if (free.length === 0) return null;
      const tile = free[Math.floor(this.random() * free.length)];
      taken.add(`${tile.x},${tile.y}`);
      return tile;
    };
    const adults: Cow[] = [];
    for (const coat of ADULT_COATS) {
      const tile = claim(open);
      if (tile === null) break;
      adults.push(this.spawn(coat, 'adult', tile));
    }
    for (const coat of CALF_COATS) {
      const mother = adults.find((adult) => adult.coat === coat) ?? null;
      const near =
        mother === null
          ? open
          : open.filter(
              (tile) =>
                Math.hypot(tile.x - mother.tile.x, tile.y - mother.tile.y) <=
                CALF_SPAWN_RADIUS_TILES,
            );
      const tile = claim(near) ?? claim(open);
      if (tile === null) break;
      const calf = this.spawn(coat, 'calf', tile);
      calf.mother = mother;
    }
  }

  /** One animal, levelled and placed like every other spawn, joined to the scene through the roster. */
  private spawn(coat: CowCoatId, age: CowAge, tile: TilePoint): Cow {
    const cow = new Cow(tile.x, tile.y, TILE_SIZE, coat, age, this.random);
    this.homeTiles.set(cow, tile);
    cow.pen = this.pen;
    if (this.deps.warmer !== undefined) cow.warmer = this.deps.warmer;
    cow.applyMobLevel(LIVESTOCK_LEVEL);
    applySpawnDifficulty(cow);
    cow.warmRoutine(false);
    this.deps.roster.add(cow);
    this.herdList.push(cow);
    return cow;
  }

  update(frame: LivestockFrame): void {
    const sheltering = SHELTER_PHASES.has(this.deps.questPhase());
    const threats = this.deps.blastThreats?.() ?? NO_THREATS;
    for (const cow of this.herdList) {
      cow.sheltering = sheltering;
      if (!cow.isAlive) {
        this.tickRespawn(cow, frame, sheltering);
        continue;
      }
      // In the barn for the siege: none of their rows is on screen, and the
      // figure cache is holding the assault's arrivals and the crawlers' fight.
      if (sheltering) continue;
      const nearestCrawler = Math.min(
        centreDistanceTiles(cow, frame.human),
        centreDistanceTiles(cow, frame.cat),
      );
      if (nearestCrawler <= ROUTINE_WARM_TILES) {
        cow.warmRoutine(centreDistanceTiles(cow, frame.active) <= IN_VIEW_TILES);
      }
      for (const threat of threats) {
        const cx = cow.x + TILE_SIZE * TILE_CENTRE;
        const cy = cow.y + TILE_SIZE * TILE_CENTRE;
        const reachPx = threat.reachTiles * TILE_SIZE;
        const distancePx = Math.hypot(cx - threat.x, cy - threat.y);
        if (distancePx <= reachPx) {
          cow.warmForThreat(distancePx <= threat.killReachTiles * TILE_SIZE);
        }
      }
    }
    // The press that would pet it is one step away: warm the row it plays.
    if (!sheltering) this.petTarget(frame.active)?.warmHappyToward(frame.active);
    this.tickMoo(frame);
    this.emotes.update(SECONDS_PER_UPDATE);
  }

  /**
   * Counts a dead animal toward its respawn. Held while the herd is
   * sheltering: the pasture is empty for the siege and nothing should appear
   * in it until the barn opens again.
   */
  private tickRespawn(cow: Cow, frame: LivestockFrame, sheltering: boolean): void {
    const left = this.respawnUpdatesLeft.get(cow) ?? RESPAWN_UPDATES;
    if (sheltering || left > 1) {
      this.respawnUpdatesLeft.set(cow, sheltering ? left : left - 1);
      return;
    }
    if (this.respawn(cow, frame)) this.respawnUpdatesLeft.delete(cow);
  }

  /** Stands `cow` back up on its home tile, or the nearest open pasture tile when that one is taken. Returns false when the pasture has no open tile. */
  private respawn(cow: Cow, frame: LivestockFrame): boolean {
    const tile = this.respawnTileFor(cow);
    if (tile === null) return false;
    clearRespawnTile(
      { gameMap: this.deps.gameMap, roster: this.deps.roster, crawlers: [frame.human, frame.cat] },
      tile,
      cow,
    );
    const grid = this.deps.roster.grid;
    grid.remove(cow);
    cow.reviveForCheckpoint();
    cow.x = tile.x * TILE_SIZE;
    cow.y = tile.y * TILE_SIZE;
    grid.insert(cow);
    cow.warmRoutine(false);
    return true;
  }

  private respawnTileFor(cow: Cow): TilePoint | null {
    const home = this.homeTiles.get(cow);
    if (home === undefined) return null;
    if (this.pen.isPassable(home.x, home.y)) return home;
    let nearest: TilePoint | null = null;
    let nearestDistance = Infinity;
    for (const tile of this.pen.pastureTiles) {
      if (!this.pen.isPassable(tile.x, tile.y)) continue;
      const distance = Math.hypot(tile.x - home.x, tile.y - home.y);
      if (distance < nearestDistance) {
        nearest = tile;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  /**
   * One moo for the whole herd every so often, from a grazing adult, and only
   * while someone is near enough to hear it — a pasture of eight each lowing
   * on its own clock would never be quiet.
   */
  private tickMoo(frame: LivestockFrame): void {
    if (this.mooUpdatesLeft > 0) {
      this.mooUpdatesLeft--;
      return;
    }
    const inEarshot = (cow: Cow): boolean =>
      Math.min(centreDistanceTiles(cow, frame.human), centreDistanceTiles(cow, frame.cat)) <=
      MOO_EARSHOT_TILES;
    const grazers = this.herdList.filter(
      (cow) => cow.isAlive && !cow.isCalf && cow.mode === 'graze' && inEarshot(cow),
    );
    if (grazers.length === 0) return;
    grazers[Math.floor(this.random() * grazers.length)].moo();
    this.mooUpdatesLeft = this.nextMooDelay();
  }

  private nextMooDelay(): number {
    const seconds = MOO_MIN_SECONDS + this.random() * (MOO_MAX_SECONDS - MOO_MIN_SECONDS);
    return Math.round(seconds * UPDATES_PER_SECOND);
  }

  /** A blast at world pixel (`x`, `y`): everything alive within reach flinches and bolts. */
  private onBlast(x: number, y: number): void {
    for (const cow of this.herdList) {
      if (!cow.isAlive) continue;
      const cx = cow.x + TILE_SIZE * TILE_CENTRE;
      const cy = cow.y + TILE_SIZE * TILE_CENTRE;
      if (Math.hypot(cx - x, cy - y) <= PANIC_RADIUS_TILES * TILE_SIZE) cow.startle(x, y);
    }
  }

  private onCowKilled(cow: Cow): void {
    const cx = cow.x + TILE_SIZE * TILE_CENTRE;
    const cy = cow.y + TILE_SIZE * TILE_CENTRE;
    const burgers = randomInt(BURGERS_PER_COW_MIN, BURGERS_PER_COW_MAX);
    this.deps.groundPickups.spawnBurgers(cx, cy, burgers);
    this.deps.bus.emit('cowKilled', { x: cx, y: cy });
  }

  /**
   * The cow a press of the interact key from `active` would pet: the nearest
   * living one within `PET_RANGE_TILES`, and none while a hostile is inside
   * the crawler's attack range, where the press goes to the swing instead.
   */
  petTarget(active: HumanPlayer | CatPlayer): Cow | null {
    if (hostileWithinAttackRange(active, this.deps.roster.grid)) return null;
    let nearest: Cow | null = null;
    let nearestTiles = PET_RANGE_TILES;
    for (const cow of this.herdList) {
      if (!cow.isAlive) continue;
      const tiles = centreDistanceTiles(cow, active);
      if (tiles <= nearestTiles) {
        nearest = cow;
        nearestTiles = tiles;
      }
    }
    return nearest;
  }

  /** Whether a press from `active` would pet a cow — the predicate `tryPet` is built on. */
  wouldPet(active: HumanPlayer | CatPlayer): boolean {
    return this.petTarget(active) !== null;
  }

  /**
   * Pets the nearest cow in reach. Returns whether the press was taken — true
   * even inside a cow's pet cooldown, so hammering the key never falls
   * through to a swing at the animal.
   */
  tryPet(active: HumanPlayer | CatPlayer): boolean {
    const cow = this.petTarget(active);
    if (cow === null) return false;
    this.petCow(cow, active);
    return true;
  }

  /** Pets one cow in particular — the one a tap landed on. */
  petCow(cow: Cow, active: HumanPlayer | CatPlayer): void {
    if (!cow.pet(active)) return;
    const head = cow.headAnchor();
    this.emotes.spawnHearts(head.x, head.y);
    this.deps.bus.emit('cowPetted', { x: head.x, y: head.y });
    if (active instanceof HumanPlayer) playPetGesture(active, head);
    else active.playContentGesture(cow.x, cow.y);
  }

  /** The living cow whose body covers world pixel (`worldX`, `worldY`), or null. */
  cowAtPoint(worldX: number, worldY: number): Cow | null {
    for (const cow of this.herdList) {
      if (!cow.isAlive) continue;
      const inside =
        worldX >= cow.x &&
        worldX <= cow.x + TILE_SIZE &&
        worldY >= cow.y &&
        worldY <= cow.y + TILE_SIZE;
      if (inside) return cow;
    }
    return null;
  }

  /** Floats "Pet" over the cow a press would pet. Returns whether it drew. */
  renderPrompt(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: HumanPlayer | CatPlayer,
  ): boolean {
    const cow = this.petTarget(active);
    if (cow === null) return false;
    drawInteractionPrompt(ctx, cow.x - camX, cow.y - camY, TILE_SIZE, 'Pet');
    return true;
  }

  /** The hearts, over every body. */
  renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.emotes.render(ctx, camX, camY);
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
    this.emotes.clear();
  }
}
