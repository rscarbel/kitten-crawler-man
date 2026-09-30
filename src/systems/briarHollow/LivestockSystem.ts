/**
 * Briar Hollow's herd: five cows and three calves in the paddock beside the
 * barn. Two of the cows have names: Midge, the dairy cow Merrit parts with in
 * "The Borrowed Blueprints", and Bramblewick, named — like the rest of
 * Merrit's favourites — after somebody in the village.
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
import type { Player } from '../../Player';
import { CowPen } from './cowPen';
import { LivestockRespawner } from './livestockRespawn';

const UPDATES_PER_SECOND = 60;
const SECONDS_PER_UPDATE = 1 / UPDATES_PER_SECOND;
const TILE_CENTRE = 0.5;

/** The adults, by coat: a mixed herd with every coat represented. */
const ADULT_COATS: readonly CowCoatId[] = ['holstein', 'jersey', 'dun', 'holstein', 'jersey'];
/** The calves, by coat; each is paired with the first adult of the same coat. */
const CALF_COATS: readonly CowCoatId[] = ['holstein', 'jersey', 'dun'];
/** The coats Merrit milks. */
const DAIRY_COATS: ReadonlySet<CowCoatId> = new Set<CowCoatId>(['holstein', 'jersey']);

/** Merrit's cow for Wendell. Not the soldier Midge Candleear, who is a villager, not livestock. */
export const MIDGE_COW_NAME = 'Midge';
/** Named after the mayor, which is the whole joke of Merrit offering "Bramblewick" first. */
export const BRAMBLEWICK_COW_NAME = 'Bramblewick';

/** The adults that mother a calf: the first adult of each calf's coat, as `spawnHerd` pairs them. */
const MOTHER_SLOTS: ReadonlySet<number> = new Set(
  CALF_COATS.map((coat) => ADULT_COATS.indexOf(coat)),
);

/**
 * Which adult is Midge: the last dairy cow with no calf, so taking her away
 * never orphans one. Fixed by the herd's make-up rather than rolled, so she is
 * the same cow in every run. -1 only if the herd were ever given no such cow.
 */
export const MIDGE_SLOT = ADULT_COATS.reduce(
  (found, coat, slot) => (DAIRY_COATS.has(coat) && !MOTHER_SLOTS.has(slot) ? slot : found),
  -1,
);
/** Midge's coat, for a Midge raised anywhere but her place in the herd. */
export const MIDGE_COAT: CowCoatId = ADULT_COATS[MIDGE_SLOT] ?? 'jersey';
/** Which adult is Bramblewick: the first holstein that is not Midge. */
const BRAMBLEWICK_SLOT = ADULT_COATS.findIndex(
  (coat, slot) => coat === 'holstein' && slot !== MIDGE_SLOT,
);
/** A calf is placed at most this far from its mother. */
const CALF_SPAWN_RADIUS_TILES = 2;

/** How close, centre to centre, a crawler must be to pet a cow. Facing is not required. */
export const PET_RANGE_TILES = 1.4;
/**
 * A crawler this near keeps the herd's everyday rows warm — walking, idling,
 * grazing — so the herd never comes into view cold.
 */
export const ROUTINE_WARM_TILES = 30;
/** Within this many tiles of the active crawler an animal is on screen at a normal camera distance. */
export const IN_VIEW_TILES = 12;
/** A blast inside this many tiles of an animal sets it bolting. */
export const PANIC_RADIUS_TILES = 5;

/** Burgers a dead cow or calf leaves. */
export const BURGERS_PER_COW_MIN = 2;
export const BURGERS_PER_COW_MAX = 3;

/** The herd moos at most once in this many seconds, and only with a crawler this near. */
const MOO_MIN_SECONDS = 8;
const MOO_MAX_SECONDS = 20;
export const MOO_EARSHOT_TILES = 12;

const NO_THREATS: readonly BlastThreat[] = [];
const NO_STRAYS: readonly Cow[] = [];

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
  /**
   * Whether Midge has left the herd for good — she is being led to Wendell,
   * or lives there now — read when the herd is raised, so a herd raised after
   * she left puts an ordinary cow of her coat in her place. Absent means never.
   */
  readonly midgeHasLeft?: () => boolean;
  /**
   * Animals that are not the herd's but can still be petted here — Midge on
   * her way to Wendell, and at Wendell's. Absent means none.
   */
  readonly strayCows?: () => readonly Cow[];
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
  private readonly respawner: LivestockRespawner;
  /** Each adult's place in `ADULT_COATS`, which decides its name. */
  private readonly adultSlotOf = new Map<Cow, number>();
  /**
   * Midge once she has been walked out of the herd, until the herd is sure
   * she is not coming back: a rewind to before she left hands her back here.
   */
  private releasedMidge: Cow | null = null;
  /** Where Midge lived in the paddock before she left, where a rewind stands her again. */
  private releasedMidgeHome: TilePoint | null = null;
  private readonly unsubscribers: Array<() => void> = [];
  /** Reused by `pettable`, which is asked every update. */
  private readonly pettableBuffer: Cow[] = [];

  constructor(deps: LivestockDeps) {
    this.deps = deps;
    this.random = deps.random ?? Math.random;
    this.pen = CowPen.forSite(deps.gameMap, deps.site);
    this.respawner = new LivestockRespawner({
      gameMap: deps.gameMap,
      roster: deps.roster,
      pen: this.pen,
    });
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
    for (const [slot, coat] of ADULT_COATS.entries()) {
      const tile = claim(open);
      if (tile === null) break;
      const adult = this.spawn(coat, 'adult', tile);
      this.adultSlotOf.set(adult, slot);
      adult.name = this.nameForSlot(slot);
      adults.push(adult);
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

  /** The name the adult in `slot` goes by, or null for an unnamed one. */
  private nameForSlot(slot: number): string | null {
    if (slot === MIDGE_SLOT) return this.deps.midgeHasLeft?.() === true ? null : MIDGE_COW_NAME;
    if (slot === BRAMBLEWICK_SLOT) return BRAMBLEWICK_COW_NAME;
    return null;
  }

  /** One animal, levelled and placed like every other spawn, joined to the scene through the roster. */
  private spawn(coat: CowCoatId, age: CowAge, tile: TilePoint): Cow {
    const cow = new Cow(tile.x, tile.y, TILE_SIZE, coat, age, this.random);
    this.respawner.setHome(cow, tile);
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
    this.respawner.tick(cow, [frame.human, frame.cat], sheltering);
  }

  // ── Midge leaving, and coming back on a rewind ─────────────────────────────

  /** Midge, while she is still one of the herd; null once she has left it. */
  get midge(): Cow | null {
    return this.herdList.find((cow) => cow.name === MIDGE_COW_NAME) ?? null;
  }

  /**
   * Walks Midge out of the herd for Merrit's call: she is handed to the
   * caller, alive (stood back up first if she was dead), off the pen, and an
   * ordinary cow of her coat takes her place — out of the barn, where one
   * more cow coming out to graze reads as nothing at all — so the herd is
   * never one short. Null when she has already left.
   */
  releaseMidge(crawlers: readonly Player[]): Cow | null {
    const midge = this.midge;
    if (midge === null) return null;
    const slot = this.adultSlotOf.get(midge) ?? MIDGE_SLOT;
    const home = this.respawner.homeOf(midge);
    if (!midge.isAlive && !this.respawner.standUp(midge, crawlers)) return null;
    this.respawner.forget(midge);
    this.adultSlotOf.delete(midge);
    const index = this.herdList.indexOf(midge);
    this.herdList.splice(index, 1);
    midge.pen = null;
    this.releasedMidge = midge;
    this.releasedMidgeHome = home;
    const stand = this.replacementTile(home);
    if (stand !== null) {
      const replacement = this.spawn(midge.coat, 'adult', stand);
      if (home !== null) this.respawner.setHome(replacement, home);
      this.adultSlotOf.set(replacement, slot);
      replacement.name = null;
    }
    return midge;
  }

  /**
   * Midge lives at Wendell's, yet the herd still has a cow by her name — a
   * herd raised before the quest's state said she had gone: that cow is an
   * ordinary one of her coat from now on, so there is only ever one Midge.
   */
  retireMidgeName(): void {
    const namesake = this.midge;
    if (namesake !== null) namesake.name = null;
  }

  /** Where the cow taking Midge's place comes out: the barn floor, else her own home tile. */
  private replacementTile(home: TilePoint | null): TilePoint | null {
    const pen = this.pen;
    const occupied = (tile: TilePoint): boolean =>
      this.herdList.some((cow) => cow.isAlive && cow.tile.x === tile.x && cow.tile.y === tile.y);
    const barn = pen.barnTiles.filter((tile) => pen.isPassable(tile.x, tile.y) && !occupied(tile));
    if (barn.length > 0) return barn[Math.floor(this.random() * barn.length)];
    return home;
  }

  /**
   * A death rewind on the same scene, after the roster has been rewound and
   * the quest's state restored. The rewind drops every body that joined after
   * the checkpoint; that includes the cow that took Midge's place when the
   * checkpoint is from before she left, and then Midge herself — who was one
   * of the herd at that checkpoint and so is still standing — comes back to
   * her place.
   */
  onRewind(): void {
    const midge = this.releasedMidge;
    if (midge === null || this.deps.midgeHasLeft?.() === true) return;
    const inRoster = new Set(this.deps.roster.mobs);
    if (!inRoster.has(midge)) return;
    const slot = MIDGE_SLOT;
    const standIn = this.herdList.find((cow) => this.adultSlotOf.get(cow) === slot) ?? null;
    if (standIn !== null) {
      this.herdList.splice(this.herdList.indexOf(standIn), 1);
      this.adultSlotOf.delete(standIn);
      this.respawner.forget(standIn);
      if (inRoster.has(standIn)) {
        this.deps.roster.replaceAll(this.deps.roster.mobs.filter((mob) => mob !== standIn));
        this.deps.roster.grid.remove(standIn);
        standIn.dispose();
      }
    }
    this.releasedMidge = null;
    midge.endLead();
    midge.restoreHerdHp();
    midge.cannotBeKilled = false;
    midge.wardedFromParty = false;
    midge.healthBarDrawnElsewhere = false;
    midge.pen = this.pen;
    midge.name = MIDGE_COW_NAME;
    // Delivered to Wendell's since, her rewind stood her in his pasture.
    midge.setHomeTile(null);
    const home = this.releasedMidgeHome ?? CowPen.tileOfBody(midge.x, midge.y);
    this.releasedMidgeHome = null;
    const previousX = midge.x;
    const previousY = midge.y;
    midge.x = home.x * TILE_SIZE;
    midge.y = home.y * TILE_SIZE;
    this.deps.roster.grid.move(midge, previousX, previousY);
    this.herdList.push(midge);
    this.adultSlotOf.set(midge, slot);
    this.respawner.setHome(midge, home);
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
    for (const cow of this.pettable()) {
      if (!cow.isAlive) continue;
      const tiles = centreDistanceTiles(cow, active);
      if (tiles <= nearestTiles) {
        nearest = cow;
        nearestTiles = tiles;
      }
    }
    return nearest;
  }

  /** The herd, then any stray that may be petted here. */
  private pettable(): readonly Cow[] {
    const strays = this.deps.strayCows?.() ?? NO_STRAYS;
    if (strays.length === 0) return this.herdList;
    const cows = this.pettableBuffer;
    cows.length = 0;
    for (const cow of this.herdList) cows.push(cow);
    for (const cow of strays) cows.push(cow);
    return cows;
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
    // Merrit hears of her own herd being petted, not of a cow she has parted with.
    if (this.herdList.includes(cow)) this.deps.bus.emit('cowPetted', { x: head.x, y: head.y });
    if (active instanceof HumanPlayer) playPetGesture(active, head);
    else active.playContentGesture(cow.x, cow.y);
  }

  /** The living cow whose body covers world pixel (`worldX`, `worldY`), or null. */
  cowAtPoint(worldX: number, worldY: number): Cow | null {
    for (const cow of this.pettable()) {
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
