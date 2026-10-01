/**
 * A Briar Hollow cow or calf: livestock, not a combatant.
 *
 * A `Mob` rather than a village entity, because the things that can kill a cow
 * — a stick of dynamite, a Smush, a stray magic missile — find their victims
 * through the mob grid, and the gore and death pipeline that turns one into
 * pieces and burgers runs off `resolveKills`. It is never hostile, so every
 * companion, auto-aim and homing scan (all of which filter on `isHostile` or
 * `isPetAttackable`) passes it by.
 *
 * Its whole life is a small routine inside the pen (`CowPen`): graze, amble a
 * few tiles, stand and chew, now and then lie down in the barn. A calf keeps
 * near its mother and breaks into zoomies. A blast nearby sends it into a
 * flinch and a panicked trot away from the bang. `LivestockSystem` owns the
 * herd-wide parts — spawning, the shared moo timer, petting, the siege — and
 * steers each animal through the public methods below.
 */

import { Mob, type PlayerDamageType, type LootDrop } from './Mob';
import type { LevelledCurve } from './mobLevelScaling';
import type { Player } from '../Player';
import { TILE_SIZE } from '../core/constants';
import {
  CALF_TILES_PER_TROT_CYCLE,
  CALF_TILES_PER_WALK_CYCLE,
  COW_FLINCH_FPS,
  COW_HAPPY_FPS,
  COW_LIE_DOWN_FPS,
  COW_TILES_PER_TROT_CYCLE,
  COW_TILES_PER_WALK_CYCLE,
  type CowAction,
  type CowAge,
  type CowCoatId,
  COW_GORE_PARTS,
  COW_PREWARMED_STATES,
  cowBodyPartKey,
  cowStateFor,
  drawCowSprite,
} from '../sprites/cowSprite';
import { COW_VIEWS_BY_ACTION, cowFigure, cowStateName } from '../sprites/art/cowFigure';
import {
  IDLE_FRAMES_BEFORE_RELEASE,
  figureCacheFrame,
  figureRowInkTop,
  prewarmFigureState,
} from '../sprites/figure/figureFrameCache';
import {
  COW_FLINCH_FRAMES,
  COW_HAPPY_FRAMES,
  COW_LIE_DOWN_FRAMES,
  COW_TROT_FRAMES,
  COW_WALK_FRAMES,
} from '../sprites/cowTiming';
import { type CowView, cowPollPoint, restCowPose } from '../sprites/art/cowArt';
import { cowLookOf } from '../sprites/art/cowLooks';
import { CowPen } from '../systems/briarHollow/cowPen';
import type { TilePoint } from '../map/town/townPlan';
import { findNearbyWalkableTile } from '../map/findWalkableTile';
import { drawQuestBeacon } from '../sprites/questBeacon';
import {
  drawQuestMarker,
  questMarkerColorFor,
  type QuestMarkerState,
} from '../sprites/questNPCSprite';

const UPDATES_PER_SECOND = 60;
const SECONDS_PER_UPDATE = 1 / UPDATES_PER_SECOND;
const TWO_PI = Math.PI * 2;
const TILE_CENTRE = 0.5;

/**
 * Hit points before levelling. Low on purpose: livestock is killed by
 * collateral, and one stick of dynamite has to be enough. `LIVESTOCK_LEVEL`
 * levels these to at most the least any blast deals to a non-hostile body.
 */
const COW_BASE_HP = 10;
const CALF_BASE_HP = 6;

/**
 * Walking pace in pixels per update, before levelling. At `LIVESTOCK_LEVEL`
 * these come to a little over a tile a second — the pace the walk rows were
 * stride-matched at, so the hooves plant rather than skate.
 */
export const COW_WALK_SPEED = 0.5;
export const CALF_WALK_SPEED = 0.6;
/** The panicked trot away from a blast, and a calf's trot back to its mother after zoomies. */
export const COW_PANIC_SPEED = 1.6;
const CALF_TROT_BACK_SPEED = 1.1;

/**
 * The level every village animal is spawned at. Fixed rather than rolled from
 * the party: a cow is not a fight that should keep pace with the crawlers, and
 * its health must stay inside one blast however strong the party grows.
 */
export const LIVESTOCK_LEVEL = 3;

/** Heavier than a crawler, so bumping into one nudges it rather than shoving it aside. */
const COW_MASS = 3;
const CALF_MASS = 1.5;

/** The cow is drawn about two tiles long; this keeps it alive past the screen edge until it is off. */
const COW_CULL_MARGIN_TILES = 1.5;

/** How long each part of the routine lasts, in seconds. */
const GRAZE_MIN_SECONDS = 4;
const GRAZE_MAX_SECONDS = 10;
const IDLE_MIN_SECONDS = 2;
const IDLE_MAX_SECONDS = 5;
const LIE_MIN_SECONDS = 12;
const LIE_MAX_SECONDS = 30;
/** How far a routine amble goes, in tiles. */
const AMBLE_MIN_TILES = 1;
const AMBLE_MAX_TILES = 4;
/** After an idle, the chance an adult heads into the barn to lie down rather than going back to grazing. */
const BARN_TRIP_CHANCE = 0.08;
/** After an idle, the chance it grazes where it stands rather than ambling somewhere first. */
const GRAZE_IN_PLACE_CHANCE = 0.5;

/** A calf strays no further than this from its mother before trotting back. */
export const CALF_TETHER_TILES = 3;
/** A calf heading back stops once it is this close. */
const CALF_REJOIN_TILES = 1.5;
/** How long a sheltering calf stands before looking again at whether its mother has lain down. */
const CALF_SHELTER_WAIT_SECONDS = 0.5;
/** How often a calf trotting after its mother checks whether she has moved on. */
const RETARGET_CHECK_SECONDS = 0.5;
/** A calf's own ambles stay this close to its mother. */
const CALF_AMBLE_RADIUS_TILES = 2;
/** Seconds between a calf's zoomies. */
const ZOOMIE_MIN_SECONDS = 30;
const ZOOMIE_MAX_SECONDS = 90;
/** Seconds between a wandering calf's bleats. */
const CALF_BLEAT_MIN_SECONDS = 20;
const CALF_BLEAT_MAX_SECONDS = 45;
/** The happy row is warmed this long before a zoomie, so the buck never draws cold. */
const ZOOMIE_WARM_AHEAD_SECONDS = 5;

/** Seconds a startled animal runs for. */
export const PANIC_SECONDS = 3;
/** How far across the pen a panicked animal looks for somewhere to run to, in steps. */
const PANIC_SEARCH_STEPS = 10;
/** Shortest run worth taking; a nearer tile is no escape at all. */
const PANIC_MIN_RUN_STEPS = 2;

/** Seconds between two pets that each restart the happy row. */
export const PET_COOLDOWN_SECONDS = 1.5;

/** A walk that covers less than this per update is not getting anywhere. */
const STUCK_EPSILON_PX = 0.05;
/** A walk is checked this often, and given up if it gained less than `STALL_MIN_GAIN_TILES` since. */
const STUCK_GIVE_UP_SECONDS = 1;
const STALL_MIN_GAIN_TILES = 0.25;
/** How long an animal making for shelter waits after a blocked walk before trying again. */
const SHELTER_RETRY_SECONDS = 0.5;
/** Close enough to a waypoint to take the next. */
const WAYPOINT_ARRIVE_PX = 1;

const HAPPY_SECONDS = COW_HAPPY_FRAMES / COW_HAPPY_FPS;
const FLINCH_SECONDS = COW_FLINCH_FRAMES / COW_FLINCH_FPS;
const LIE_DOWN_SECONDS = COW_LIE_DOWN_FRAMES / COW_LIE_DOWN_FPS;

/**
 * How often, in the figure cache's own frames, a row still wanted is asked for
 * again. The cache frees a row nobody has drawn or asked for in
 * `IDLE_FRAMES_BEFORE_RELEASE` of its frames, so a warning that runs longer
 * than that — a pet held off, a stick held lit — re-asks at half the window;
 * for a row that is still warm the request bakes nothing and only refreshes it.
 */
export const COW_ROW_REWARM_FRAMES = Math.floor(IDLE_FRAMES_BEFORE_RELEASE / 2);
/** A lying animal asks for its getting-up row this long before it gets up. */
const STAND_UP_WARM_AHEAD_SECONDS = 1;
/**
 * How much of a row a warning warms: only the frame drawn the moment the row
 * starts. A warning may never come to anything — a crawler walks past without
 * petting, a cow never reaches the barn — and the whole row is queued the
 * moment it does start; its next frame is several updates away, which the
 * cache drains well within.
 */
const HAPPY_OPENING_FRAMES = 1;
const ROUTINE_IN_VIEW_FRAMES = 1;
const LIE_DOWN_OPENING_FRAMES = 1;

/** The eight neighbours a body stuck in a wall may step out to. */
const ESCAPE_STEPS: ReadonlyArray<TilePoint> = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];
/** Tiles of distance an off-pen neighbour counts as worse than an on-pen one, when stepping out of a wall. */
const ESCAPE_OFF_PEN_PENALTY = 100;

/**
 * Stall checks in a row a led animal's path search may fail before it gives
 * the search up and walks for open ground toward its leader instead. The
 * first stalls only throw the cached route away: most are a crowd in a
 * gateway that clears by itself.
 */
const LED_STALLS_BEFORE_DETOUR = 3;
/** How far toward the leader a detour aims before looking for open ground round that point. */
const LED_DETOUR_REACH_TILES = 2;
/** How far round that point open ground is searched for. */
const LED_DETOUR_SEARCH_TILES = 3;
/** A detour walks this long at most before the path search is given another go. */
const LED_DETOUR_MAX_SECONDS = 2;

/** Offsets each animal's chewing clock, so a herd does not chew in step. */
const CLOCK_STAGGER_SECONDS = 60;

/**
 * How a cow asks for its rows to be baked ahead of use: through the figure
 * cache in the game, through a recorder in the gates that measure how much a
 * herd holds warm.
 */
export interface CowRowWarmer {
  /** Queues `state`, or only its first `frameLimit` frames when given. */
  warm(coat: CowCoatId, age: CowAge, state: string, frameLimit?: number): void;
  /** The figure cache's frame clock, which re-asking is paced by. */
  frame(): number;
}

export const FIGURE_CACHE_ROW_WARMER: CowRowWarmer = {
  warm: (coat, age, state, frameLimit) =>
    prewarmFigureState(cowFigure(coat, age), state, frameLimit),
  frame: figureCacheFrame,
};

/** What an animal is doing. `led` is walking after whoever leads it, off any pen. */
export type CowMode =
  'idle' | 'graze' | 'walk' | 'happy' | 'flinch' | 'trot' | 'lie_down' | 'lie' | 'stand_up' | 'led';

/** Whoever an animal is led by: anything with a tile-sized body at (`x`, `y`). */
export interface CowLeader {
  readonly x: number;
  readonly y: number;
}

/**
 * How a led animal keeps with its leader: a latched band it walks to close,
 * a distance past which it gives up and waits to be fetched, and its pace.
 */
export interface CowLeadBand {
  /** Sets off after the leader past this many tiles. */
  readonly followStartTiles: number;
  /** Stops again inside this many tiles. */
  readonly followStopTiles: number;
  /** Past this many tiles it stops, faces the leader and waits. */
  readonly breakTiles: number;
  /** A waiting animal walks on again once the leader is back inside this many tiles. */
  readonly resumeTiles: number;
  /** Walking pace while led, in pixels per update before levelling. */
  readonly speed: number;
  /** How far one path search reaches, in the search's own measure. */
  readonly pathBudgetTiles: number;
}

/** A led animal's standing: who leads it, and where it is in the band. */
interface LeadState {
  readonly band: CowLeadBand;
  leader: CowLeader | null;
  /** Called rather than led: it walks all the way to its leader, however far, and never gives up. */
  readonly ignoresBreak: boolean;
  following: boolean;
  /** Past the break distance: standing and waiting to be fetched. */
  waiting: boolean;
  /** One-second stall checks in a row that gained no ground while following. */
  stalls: number;
  /** A tile walked straight to after the path search has stalled for long, and how long it may take. */
  detour: TilePoint | null;
  detourUpdatesLeft: number;
}

/** Which cue a cow has queued for the mob-audio drain. */
export type CowVoice = 'ambient' | 'calf' | 'angry' | 'happy';

/** What a walk is for, which decides what happens when it ends. */
type WalkPurpose = 'amble' | 'to_barn' | 'to_mother' | 'shelter' | 'panic' | 'trot_back';

/** A blast point a panicking animal is running from. */
interface FleeSource {
  readonly x: number;
  readonly y: number;
}

function randomBetween(random: () => number, min: number, max: number): number {
  return min + random() * (max - min);
}

function secondsToUpdates(seconds: number): number {
  return Math.round(seconds * UPDATES_PER_SECOND);
}

export class Cow extends Mob {
  readonly xpValue = 0;
  override readonly audioTag = 'cow';
  override readonly bodyPartKey: string;
  readonly coat: CowCoatId;
  readonly age: CowAge;

  /**
   * The pen this animal lives in. Null for one spawned by name outside the
   * herd (`createMob('cow')`), which then ambles about its spawn tile with the
   * ordinary mob wander instead of its pen routine.
   */
  pen: CowPen | null = null;
  /** How this animal asks for rows ahead of use. */
  warmer: CowRowWarmer = FIGURE_CACHE_ROW_WARMER;
  /** A calf's mother, followed about the pen. Null for adults and for an orphan. */
  mother: Cow | null = null;
  /** While set, the animal heads for the barn and stays there. */
  sheltering = false;
  /** Set when something audible happens; `playMobAudioCues` plays it and clears it. */
  voicePending: CowVoice | null = null;
  /**
   * Whether whoever owns this animal draws its health bar itself, so the
   * bar every mob flashes when struck is not drawn twice over it.
   */
  healthBarDrawnElsewhere = false;
  /**
   * The quest glyph and beacon the animal wears, for the one a quest needs the
   * party to go to (Midge); `'none'` for the rest of the herd.
   */
  questMarker: QuestMarkerState = 'none';

  private readonly random: () => number;
  private modeValue: CowMode = 'idle';
  /** Updates left in the current mode, for the timed ones. */
  private modeUpdatesLeft = 0;
  /** Updates the current mode has run for, which one-shot rows read their progress off. */
  private modeUpdatesElapsed = 0;
  private route: TilePoint[] = [];
  private routeIndex = 0;
  private walkPurpose: WalkPurpose = 'amble';
  private gaitPhase = 0;
  /** Whether the body actually covered ground this update, which picks walk or stand. */
  private movedThisUpdate = false;
  /** Updates into the current one-second stall check, and where the body stood when it began. */
  private stalledUpdates = 0;
  private stallCheckFromX = 0;
  private stallCheckFromY = 0;
  private retargetUpdatesLeft = 0;
  private clockSeconds: number;
  private petCooldownUpdates = 0;
  private panicUpdatesLeft = 0;
  private fleeFrom: FleeSource | null = null;
  private zoomieUpdatesLeft: number;
  private bleatUpdatesLeft: number;
  /** The cache frame the last warning of a bang was acted on. */
  private threatWarmedAt = -Infinity;
  /** The cache frame each row was last asked for, keyed by state name. */
  private readonly rowWarmedAt = new Map<string, number>();
  /** Set while the animal is led or called; null while it keeps its own routine. */
  private lead: LeadState | null = null;
  /** The animal's own name, for the few the village has named; null for the rest of the herd. */
  private nameValue: string | null = null;
  /** The generic label a nameless animal is shown under. */
  private readonly kindLabel: string;
  /**
   * Where a checkpoint rewind stands it, when that is no longer the tile it
   * was spawned on — an animal that has moved to a new pen for good.
   */
  private homeOverride: TilePoint | null = null;
  /** Max HP before a scripted fight hardened it, so the fight's end can hand it back. */
  private herdMaxHp: number | null = null;

  constructor(
    tileX: number,
    tileY: number,
    tileSize: number,
    coat: CowCoatId,
    age: CowAge,
    random: () => number = Math.random,
  ) {
    const isCalf = age === 'calf';
    super(
      tileX,
      tileY,
      tileSize,
      isCalf ? CALF_BASE_HP : COW_BASE_HP,
      isCalf ? CALF_WALK_SPEED : COW_WALK_SPEED,
    );
    this.coat = coat;
    this.age = age;
    this.random = random;
    this.bodyPartKey = cowBodyPartKey(coat, age);
    this.mass = isCalf ? CALF_MASS : COW_MASS;
    this.kindLabel = isCalf ? 'Calf' : 'Cow';
    this.displayName = this.kindLabel;
    this.description = isCalf
      ? 'A Briar Hollow calf. Never far from its mother.'
      : 'One of Briar Hollow’s dairy cows. Friendly, if you scratch behind the ears.';
    // Livestock is killed by accident, never hunted: a dead cow pays no XP,
    // drops no loot, and counts toward no kill.
    this.paysNoRewards = true;
    this.clockSeconds = random() * CLOCK_STAGGER_SECONDS;
    this.zoomieUpdatesLeft = this.nextZoomieDelay();
    this.bleatUpdatesLeft = this.nextBleatDelay();
    this.modeUpdatesLeft = secondsToUpdates(
      randomBetween(random, IDLE_MIN_SECONDS, IDLE_MAX_SECONDS),
    );
  }

  get isCalf(): boolean {
    return this.age === 'calf';
  }

  /**
   * The animal's own name, or null for an unnamed one. Setting it names the
   * animal wherever it is shown (`displayName`); clearing it goes back to
   * "Cow" or "Calf".
   */
  get name(): string | null {
    return this.nameValue;
  }

  set name(value: string | null) {
    this.nameValue = value;
    this.displayName = value ?? this.kindLabel;
  }

  get mode(): CowMode {
    return this.modeValue;
  }

  /** Whether the animal is still running from a blast. */
  get isPanicking(): boolean {
    return this.modeValue === 'flinch' || this.modeValue === 'trot';
  }

  /** Whether the current mode intends to cover ground — what a stall is measured against. */
  get isTryingToWalk(): boolean {
    if (this.modeValue === 'led') return this.lead?.following === true;
    return (
      (this.modeValue === 'walk' || this.modeValue === 'trot') &&
      this.routeIndex < this.route.length
    );
  }

  /** Whether someone is leading the animal right now: led or called, with a leader set. */
  get isLed(): boolean {
    const lead = this.lead;
    return lead !== null && lead.leader !== null;
  }

  /** Whether a led animal has fallen past its break distance and stands waiting to be fetched. */
  get isWaitingForLeader(): boolean {
    return this.lead?.waiting === true;
  }

  /** Whether a led animal is walking to close the band this update. */
  get isFollowingLeader(): boolean {
    return this.lead?.following === true;
  }

  /**
   * A led animal thinks wherever it is. It trails the party, often by more
   * than the activation radius when the party runs ahead, and the hostiles
   * going for it are ticked by their own exemption — a body frozen mid-fight
   * while its attackers still swing would be a free kill nobody watched.
   */
  override get exemptFromAiActivationRadius(): boolean {
    return this.isLed;
  }

  override get isHostile(): boolean {
    return false;
  }

  /**
   * Only area damage reaches a cow: a blast, a Smush, a magic missile. A cow is
   * only ever killed as collateral, never by an aimed blow — the attack key
   * near one pets it instead of swinging, and neither a claw, a fist, a sling
   * stone nor the shell's edge is something a crawler could land on it by
   * accident. Aimed missiles never pick it either, because the aim snap skips
   * anything not hostile; one that flies into it anyway still lands.
   */
  protected override admitsPlayerDamage(damageType: PlayerDamageType | null): boolean {
    return damageType === 'explosion' || damageType === 'smush' || damageType === 'missile';
  }

  /** A cow's spawn tile is its place in the pen, so a death rewind puts it back there. */
  override get resetsFullyOnCheckpoint(): boolean {
    return true;
  }

  /** A cow caught in a blast is a casualty, not a kill: no tally, no achievement. */
  override get countsAsKill(): boolean {
    return false;
  }

  /** A slaughtered cow is not a creature whose death should feed a floor's on-kill spawns. */
  override get seedsOnKillSpawns(): boolean {
    return false;
  }

  /** Nothing should spend a ward on livestock. */
  override get acceptsWards(): boolean {
    return false;
  }

  override get cullMarginTiles(): number {
    return COW_CULL_MARGIN_TILES;
  }

  override rollLootDrop(_killer: Player | null): LootDrop {
    return { coins: 0, items: [] };
  }

  protected override rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  /**
   * Every village animal is `LIVESTOCK_LEVEL`, whatever level a spawn site
   * asks for — so one spawned by name at a site's own level still dies to one
   * stick like the herd — and asking again is a no-op rather than the refused
   * re-level every other mob reports. Levelling is left to the spawn site, as
   * for every mob, so it is paired there with `applySpawnDifficulty`.
   */
  override applyMobLevel(_level: number, curve?: LevelledCurve): void {
    if (this.mobLevel === LIVESTOCK_LEVEL) return;
    super.applyMobLevel(LIVESTOCK_LEVEL, curve);
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    const home = this.homeOverride;
    if (home !== null) {
      this.x = home.x * TILE_SIZE;
      this.y = home.y * TILE_SIZE;
    }
    // Whoever led it re-leads it after a rewind, from wherever it puts it.
    this.lead = null;
    this.enterMode('idle', randomBetween(this.random, IDLE_MIN_SECONDS, IDLE_MAX_SECONDS));
    this.clearRoute();
    this.panicUpdatesLeft = 0;
    this.fleeFrom = null;
    this.petCooldownUpdates = 0;
    this.voicePending = null;
  }

  /**
   * A push that ignores walls — a protective shell's edge — may not carry the
   * animal off its pen either. Refused like its own step would be: anywhere
   * but passable pen ground, unless it is already off the pen and being
   * pushed about out there.
   */
  protected override acceptsShove(x: number, y: number): boolean {
    const pen = this.pen;
    if (pen?.holdsBody(this.x, this.y) !== true) return true;
    const landing = CowPen.tileOfBody(x, y);
    return pen.isPassable(landing.x, landing.y);
  }

  /**
   * Keeps every step — its own walk, a shove from a crawler, a knockback —
   * from carrying the animal's centre off the pen. Taken one axis at a time,
   * so a cow pushed diagonally against the gate slides along it instead of
   * sticking. A body already outside the pen is let walk anywhere, so one
   * placed badly can still get back in.
   */
  protected override moveWithCollision(dx: number, dy: number): void {
    const pen = this.pen;
    if (pen?.holdsBody(this.x, this.y) !== true) {
      super.moveWithCollision(dx, dy);
      return;
    }
    this.stepWithinPen(pen, dx, 0);
    this.stepWithinPen(pen, 0, dy);
  }

  private stepWithinPen(pen: CowPen, dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    const beforeX = this.x;
    const beforeY = this.y;
    super.moveWithCollision(dx, dy);
    if (!pen.holdsBody(this.x, this.y)) {
      this.x = beforeX;
      this.y = beforeY;
    }
  }

  /** The tile under the body's centre. */
  get tile(): TilePoint {
    return CowPen.tileOfBody(this.x, this.y);
  }

  // ── Commands from the herd ─────────────────────────────────────────────────

  /**
   * A crawler scratched it. Returns whether the happy row started; a pet inside
   * the cooldown is still a pet (the press is taken) but does not restart it.
   */
  pet(petter: { readonly x: number; readonly y: number }): boolean {
    if (!this.isAlive || this.petCooldownUpdates > 0) return false;
    this.petCooldownUpdates = secondsToUpdates(PET_COOLDOWN_SECONDS);
    this.voicePending = 'happy';
    this.panicUpdatesLeft = 0;
    this.fleeFrom = null;
    // A lying cow enjoys it where it lies.
    if (this.modeValue === 'lie' || this.modeValue === 'lie_down') return true;
    this.clearRoute();
    this.faceToward(petter);
    this.warmAction('happy', this.facingX, this.facingY);
    this.enterMode('happy', HAPPY_SECONDS);
    return true;
  }

  /**
   * A blast landed at world pixel (`x`, `y`): flinch, then run away from it.
   * A led animal only flinches where it stands: running from the bang and
   * walking after its leader would take turns on the same ground.
   */
  startle(x: number, y: number): void {
    if (!this.isAlive) return;
    if (this.lead !== null) {
      this.voicePending = 'angry';
      this.flinchInPlace();
      return;
    }
    // A bang nobody saw coming gets its flinch asked for now; one that was
    // warned of already has it. The trot is queued now either way, a flinch
    // ahead of the run it draws.
    const centreX = this.x + TILE_SIZE * TILE_CENTRE;
    const centreY = this.y + TILE_SIZE * TILE_CENTRE;
    const warned = this.warmer.frame() - this.threatWarmedAt < COW_ROW_REWARM_FRAMES;
    if (!warned) this.warmAction('flinch', this.facingX, this.facingY);
    this.warmAction('trot', centreX - x, centreY - y);
    this.fleeFrom = { x, y };
    this.panicUpdatesLeft = secondsToUpdates(PANIC_SECONDS);
    this.clearRoute();
    this.voicePending = this.isCalf ? 'calf' : 'angry';
    this.enterMode('flinch', FLINCH_SECONDS);
  }

  /** Queues the grazing moo the herd's shared timer hands out. */
  moo(): void {
    if (this.isAlive && this.voicePending === null)
      this.voicePending = this.isCalf ? 'calf' : 'ambient';
  }

  // ── Being led ──────────────────────────────────────────────────────────────

  /**
   * Takes the animal off its pen and puts it on a lead: from now it walks
   * after `leader` in `band` instead of keeping its routine. A null leader
   * holds it where it stands, grazing, until one is given. `ignoresBreak`
   * is a call rather than a lead: it walks all the way to the leader however
   * far off, and never stops to wait.
   */
  beginLead(
    band: CowLeadBand,
    leader: CowLeader | null,
    options: { readonly ignoresBreak: boolean },
  ): void {
    this.pen = null;
    this.clearRoute();
    this.forceRepath();
    this.panicUpdatesLeft = 0;
    this.fleeFrom = null;
    this.pathDistanceBudgetTiles = band.pathBudgetTiles;
    this.lead = {
      band,
      leader,
      ignoresBreak: options.ignoresBreak,
      following: false,
      waiting: false,
      stalls: 0,
      detour: null,
      detourUpdatesLeft: 0,
    };
    if (this.modeValue !== 'flinch') this.enterMode('led', 0);
  }

  /** Hands the lead to `leader` — the crawler the player is steering now — or holds the animal with null. */
  setLeader(leader: CowLeader | null): void {
    const lead = this.lead;
    if (lead === null || lead.leader === leader) return;
    lead.leader = leader;
    if (leader === null) {
      lead.following = false;
      lead.waiting = false;
    }
  }

  /** Takes the lead off: the animal stands idle and goes back to whatever pen it is given. */
  endLead(): void {
    if (this.lead === null) return;
    this.lead = null;
    this.forceRepath();
    this.enterMode('idle', randomBetween(this.random, IDLE_MIN_SECONDS, IDLE_MAX_SECONDS));
  }

  /**
   * A blow or a bang: the flinch row, where it stands, and then back to
   * whatever it was doing. Never a run — for a led animal a run and the lead
   * would take turns on the same ground.
   */
  flinchInPlace(): void {
    // A second blow mid-flinch lets the row play on rather than restarting it.
    if (!this.isAlive || this.modeValue === 'flinch') return;
    this.warmAction('flinch', this.facingX, this.facingY);
    this.clearRoute();
    this.enterMode('flinch', FLINCH_SECONDS);
  }

  /**
   * Walks a pen-less animal into `pen` — a led animal delivered to its new
   * yard — and leaves it there on its routine. Returns false when the pen has
   * no ground it can reach, leaving it where it is.
   */
  settleInto(pen: CowPen): boolean {
    this.lead = null;
    this.pen = pen;
    this.forceRepath();
    const open = pen.pastureTiles.filter((tile) => pen.isPassable(tile.x, tile.y));
    if (open.length === 0) return false;
    const here = this.tile;
    let nearest = open[0];
    let nearestDistance = Infinity;
    for (const tile of open) {
      const distance = Math.hypot(tile.x - here.x, tile.y - here.y);
      if (distance < nearestDistance) {
        nearest = tile;
        nearestDistance = distance;
      }
    }
    return this.walkTo(nearest, 'amble');
  }

  /**
   * Makes `tile` where a checkpoint rewind stands the animal from now on,
   * rather than where it was spawned; null goes back to the spawn tile.
   */
  setHomeTile(tile: TilePoint | null): void {
    this.homeOverride = tile;
  }

  /**
   * Raises the animal's health to `maxHp` for a scripted fight — an escort —
   * and fills it. {@link restoreHerdHp} hands the herd's own bar back.
   */
  hardenTo(maxHp: number): void {
    this.herdMaxHp ??= this.maxHp;
    this.setFixedMaxHp(maxHp);
    this.hp = this.maxHp;
  }

  /** Undoes {@link hardenTo}: the herd's own max HP, full. */
  restoreHerdHp(): void {
    const herdMaxHp = this.herdMaxHp;
    if (herdMaxHp === null) return;
    this.herdMaxHp = null;
    this.setFixedMaxHp(herdMaxHp);
    this.hp = this.maxHp;
  }

  /**
   * Asks for one row, unless it was asked for recently enough to still be
   * warm. Paced on the cache's clock, so a warning that lasts keeps its row
   * alive without re-queuing it every update.
   */
  private warmState(state: string, frameLimit?: number): void {
    const now = this.warmer.frame();
    const key = frameLimit === undefined ? state : `${state}#${frameLimit}`;
    const last = this.rowWarmedAt.get(key);
    if (last !== undefined && now - last < COW_ROW_REWARM_FRAMES) return;
    this.rowWarmedAt.set(key, now);
    this.warmer.warm(this.coat, this.age, state, frameLimit);
  }

  /** Asks for an action's row in the one view it will be drawn in, facing (`facingX`, `facingY`). */
  private warmAction(
    action: CowAction,
    facingX: number,
    facingY: number,
    frameLimit?: number,
  ): void {
    this.warmState(cowStateFor(action, facingX, facingY), frameLimit);
  }

  /**
   * The rows it spends its day in. In full while the party approaches, so the
   * herd comes into view warm; only their first frames once it is in view,
   * where drawing keeps the rows it uses baked and re-asking for whole rows it
   * is not using would hold them against everything else.
   */
  warmRoutine(inView: boolean): void {
    const frameLimit = inView ? ROUTINE_IN_VIEW_FRAMES : undefined;
    for (const state of COW_PREWARMED_STATES) this.warmState(state, frameLimit);
  }

  /**
   * The happy row, turned toward `petter`: asked for as soon as a crawler is
   * near enough that a press would pet this animal.
   */
  warmHappyToward(petter: { readonly x: number; readonly y: number }): void {
    // In the view it will turn to: toward the petter.
    this.warmAction('happy', petter.x - this.x, petter.y - this.y, HAPPY_OPENING_FRAMES);
  }

  /**
   * What a bang that may be coming would draw at once: the flinch where it
   * stands, the moment the bang lands, and — if it stands where the bang could
   * kill it (`inKillReach`) — the pieces it comes apart into, all eight at
   * once. The trot waits for the flinch it follows. Asked for while a stick
   * burns or a Smush winds up nearby.
   */
  warmForThreat(inKillReach: boolean): void {
    // One view per warning: an animal milling about under a burning stick
    // turns several times before the bang, and chasing each turn would warm
    // every view of the row. If it has turned by the time the bang lands, the
    // flinch's six frames bake as they play.
    const now = this.warmer.frame();
    const threatNoticed = now - this.threatWarmedAt < COW_ROW_REWARM_FRAMES;
    if (!threatNoticed) {
      this.threatWarmedAt = now;
      this.warmAction('flinch', this.facingX, this.facingY);
    }
    if (!inKillReach) return;
    for (const part of COW_GORE_PARTS) this.warmState(part);
  }

  /**
   * The opening of lying down, in both views a lying animal is drawn in (it
   * has not yet turned to lie), and the one-frame lie itself. The rest of
   * lying down is queued when it starts.
   */
  private warmLie(): void {
    for (const view of COW_VIEWS_BY_ACTION.lie_down) {
      this.warmState(cowStateName('lie_down', view), LIE_DOWN_OPENING_FRAMES);
    }
    for (const view of COW_VIEWS_BY_ACTION.lie) this.warmState(cowStateName('lie', view));
  }

  // ── The routine ────────────────────────────────────────────────────────────

  updateAI(_targets: Player[]): void {
    if (!this.isAlive) return;
    this.clockSeconds += SECONDS_PER_UPDATE;
    if (this.petCooldownUpdates > 0) this.petCooldownUpdates--;
    if (this.panicUpdatesLeft > 0) this.panicUpdatesLeft--;
    this.modeUpdatesElapsed++;
    if (this.modeUpdatesLeft > 0) this.modeUpdatesLeft--;
    this.tickCalfTimers();

    const beforeX = this.x;
    const beforeY = this.y;
    if (this.isInsideWall()) {
      this.stepOutOfWall();
    } else if (this.pen === null && this.isRoutineMode()) {
      this.modeValue = 'walk';
      this.doWander();
    } else {
      this.stepMode();
    }
    const moved = Math.hypot(this.x - beforeX, this.y - beforeY);
    this.movedThisUpdate = moved > STUCK_EPSILON_PX;
    this.isMoving = this.movedThisUpdate;
    this.advanceGait(moved);
    this.watchForStall();
  }

  /** Whether the body's centre is on a tile nothing may stand on — a fence post, a wall. */
  private isInsideWall(): boolean {
    const map = this.map;
    if (map === null) return false;
    const here = this.tile;
    return !map.isWalkable(here.x, here.y);
  }

  /**
   * Walks out of a tile nothing may stand on, ignoring walls for the step: a
   * body set down inside a fence post (by something that places it rather than
   * moves it) can never leave by ordinary collision, which refuses every step
   * whose leading edge is still in the post. Heads for the open neighbour
   * nearest the pen, so the way back starts from there.
   */
  private stepOutOfWall(): void {
    const map = this.map;
    if (map === null) return;
    const here = this.tile;
    const pen = this.pen;
    const entry = pen?.nearestPassable(here) ?? here;
    let best: TilePoint | null = null;
    let bestScore = Infinity;
    for (const step of ESCAPE_STEPS) {
      const tile = { x: here.x + step.x, y: here.y + step.y };
      if (!map.isWalkable(tile.x, tile.y) || map.isStairwellTile(tile.x, tile.y)) continue;
      const onPen = pen?.isPassable(tile.x, tile.y) === true;
      const score =
        (onPen ? 0 : ESCAPE_OFF_PEN_PENALTY) + Math.hypot(tile.x - entry.x, tile.y - entry.y);
      if (score < bestScore) {
        bestScore = score;
        best = tile;
      }
    }
    if (best === null) return;
    this.clearRoute();
    const dx = best.x * TILE_SIZE - this.x;
    const dy = best.y * TILE_SIZE - this.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return;
    const step = Math.min(this.speed, distance);
    this.facingX = dx / distance;
    this.facingY = dy / distance;
    this.x += this.facingX * step;
    this.y += this.facingY * step;
  }

  /** Grazing, idling or ambling: the modes a pen-less animal replaces with the plain wander. */
  private isRoutineMode(): boolean {
    return this.modeValue === 'idle' || this.modeValue === 'graze' || this.modeValue === 'walk';
  }

  private tickCalfTimers(): void {
    if (!this.isCalf) return;
    if (this.zoomieUpdatesLeft > 0) this.zoomieUpdatesLeft--;
    if (this.zoomieUpdatesLeft < secondsToUpdates(ZOOMIE_WARM_AHEAD_SECONDS)) {
      this.warmAction('happy', this.facingX, this.facingY, HAPPY_OPENING_FRAMES);
    }
    if (this.bleatUpdatesLeft > 0) this.bleatUpdatesLeft--;
    if (this.bleatUpdatesLeft === 0 && !this.isPanicking && this.modeValue !== 'happy') {
      this.bleatUpdatesLeft = this.nextBleatDelay();
      this.moo();
    }
  }

  private stepMode(): void {
    switch (this.modeValue) {
      case 'walk':
      case 'trot':
        this.stepWalk();
        return;
      case 'flinch':
        if (this.modeUpdatesLeft > 0) return;
        if (this.lead !== null) this.enterMode('led', 0);
        else this.beginPanicRun();
        return;
      case 'led':
        this.stepLed();
        return;
      case 'happy':
        if (this.modeUpdatesLeft === 0) this.afterHappy();
        return;
      case 'lie_down':
        if (this.modeUpdatesElapsed === 1) this.warmAction('lie_down', this.facingX, this.facingY);
        if (this.modeUpdatesLeft === 0) {
          this.enterMode('lie', randomBetween(this.random, LIE_MIN_SECONDS, LIE_MAX_SECONDS));
        }
        return;
      case 'lie': {
        // Sheltering, it stays down for the whole siege — unless it is a calf
        // whose mother has settled somewhere else, which gets up to join her.
        // Held, its count is kept a warm-up short of zero, so whatever ends
        // the hold, it lies on long enough to ask for its getting-up row.
        const warmAheadUpdates = secondsToUpdates(STAND_UP_WARM_AHEAD_SECONDS);
        if (this.sheltering && !this.calfTooFarFromMother()) {
          this.modeUpdatesLeft = Math.max(this.modeUpdatesLeft, warmAheadUpdates + 1);
          return;
        }
        // Getting up plays the lying-down row backwards, from its last frame.
        if (this.modeUpdatesLeft <= warmAheadUpdates) {
          this.warmAction('lie_down', this.facingX, this.facingY);
        }
        if (this.modeUpdatesLeft === 0) this.enterMode('stand_up', LIE_DOWN_SECONDS);
        return;
      }
      case 'stand_up':
        if (this.modeUpdatesLeft === 0) this.leaveTheBarn();
        return;
      case 'idle':
      case 'graze':
        if (this.needsToRelocate()) {
          this.decideNext();
          return;
        }
        if (this.modeUpdatesLeft === 0) this.decideNext();
        return;
    }
  }

  /**
   * One update on the lead: close the band when the leader has drawn ahead of
   * it, stand once inside it, and past the break distance stop and wait,
   * facing the leader, until they come back for it. The band is latched both
   * ways — it sets off only past the start distance and stops only inside
   * the stop distance — so a leader standing on the edge of either never
   * makes it shuffle.
   */
  private stepLed(): void {
    const lead = this.lead;
    const leader = lead?.leader ?? null;
    if (lead === null || leader === null) {
      this.isMoving = false;
      return;
    }
    const band = lead.band;
    const tiles = this.tilesFrom(leader);
    if (!lead.ignoresBreak) {
      if (lead.waiting && tiles <= band.resumeTiles) lead.waiting = false;
      else if (!lead.waiting && tiles > band.breakTiles) {
        lead.waiting = true;
        lead.following = false;
        lead.detour = null;
        this.forceRepath();
      }
    }
    if (lead.waiting) {
      this.faceToward(leader);
      this.isMoving = false;
      return;
    }
    if (tiles > band.followStartTiles) lead.following = true;
    else if (tiles <= band.followStopTiles) lead.following = false;
    if (!lead.following) {
      lead.detour = null;
      this.isMoving = false;
      return;
    }
    const speed = (this.speed * band.speed) / COW_WALK_SPEED;
    if (lead.detour !== null && lead.detourUpdatesLeft > 0) {
      lead.detourUpdatesLeft--;
      const detourX = lead.detour.x * TILE_SIZE;
      const detourY = lead.detour.y * TILE_SIZE;
      this.followTargetCollide(detourX, detourY, speed, 0);
      if (Math.hypot(detourX - this.x, detourY - this.y) <= WAYPOINT_ARRIVE_PX) {
        lead.detour = null;
      }
      return;
    }
    lead.detour = null;
    this.followTargetAStar(leader.x, leader.y, speed, band.followStopTiles * TILE_SIZE);
  }

  /**
   * A led animal that has got nowhere in a second. The cached route is
   * thrown away every time, which is usually enough — something stood in a
   * gateway — and after several in a row it walks straight for the open
   * ground nearest a point a little way toward its leader, then searches again
   * from there.
   */
  private onLedStall(): void {
    const lead = this.lead;
    const leader = lead?.leader ?? null;
    if (lead === null || leader === null) return;
    this.forceRepath();
    lead.stalls++;
    if (lead.stalls < LED_STALLS_BEFORE_DETOUR) return;
    lead.stalls = 0;
    const map = this.map;
    if (map === null) return;
    const here = this.tile;
    const dx = leader.x - this.x;
    const dy = leader.y - this.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return;
    const aimX = Math.round(here.x + (dx / distance) * LED_DETOUR_REACH_TILES);
    const aimY = Math.round(here.y + (dy / distance) * LED_DETOUR_REACH_TILES);
    const open = findNearbyWalkableTile(
      map,
      aimX,
      aimY,
      LED_DETOUR_SEARCH_TILES,
      (x, y) => x !== here.x || y !== here.y,
    );
    if (open === null) return;
    lead.detour = open;
    lead.detourUpdatesLeft = secondsToUpdates(LED_DETOUR_MAX_SECONDS);
  }

  /** Whether standing still is no longer allowed: shelter called, or a calf too far from its mother. */
  private needsToRelocate(): boolean {
    if (this.isOffPen()) return true;
    if (this.sheltering) return !this.isInBarn();
    return this.calfTooFarFromMother();
  }

  private calfTooFarFromMother(): boolean {
    const mother = this.liveMother();
    if (mother === null) return false;
    return this.tilesFrom(mother) > CALF_TETHER_TILES;
  }

  private liveMother(): Cow | null {
    const mother = this.mother;
    return mother?.isAlive === true ? mother : null;
  }

  private tilesFrom(other: { readonly x: number; readonly y: number }): number {
    return Math.hypot(other.x - this.x, other.y - this.y) / TILE_SIZE;
  }

  private isInBarn(): boolean {
    return this.pen?.isBarnTile(this.tile) === true;
  }

  /** What to do once the current thing is done. */
  private decideNext(): void {
    const pen = this.pen;
    if (pen !== null && this.isOffPen()) {
      if (this.walkTo(pen.nearestPassable(this.tile), 'amble')) return;
    }
    if (this.sheltering) {
      this.decideWhileSheltering();
      return;
    }
    if (this.isCalf && this.decideAsCalf()) return;
    if (this.modeValue === 'idle' && !this.isCalf && this.random() < BARN_TRIP_CHANCE) {
      if (this.walkTo(this.randomBarnTile(), 'to_barn')) {
        this.warmLie();
        return;
      }
    }
    if (this.modeValue === 'graze') {
      if (this.amble(this.tile, AMBLE_MAX_TILES)) return;
      this.enterMode('idle', randomBetween(this.random, IDLE_MIN_SECONDS, IDLE_MAX_SECONDS));
      return;
    }
    if (this.modeValue === 'idle' && this.random() >= GRAZE_IN_PLACE_CHANCE) {
      if (this.amble(this.tile, AMBLE_MAX_TILES)) return;
    }
    this.enterMode('graze', randomBetween(this.random, GRAZE_MIN_SECONDS, GRAZE_MAX_SECONDS));
  }

  private decideWhileSheltering(): void {
    const mother = this.liveMother();
    if (mother !== null && this.tilesFrom(mother) > CALF_TETHER_TILES) {
      if (this.walkTo(this.shelterTile(), 'shelter')) return;
    }
    if (this.isInBarn()) {
      // A calf waits on its feet until its mother has chosen where to lie.
      const motherSettled = mother === null || mother.mode === 'lie' || mother.mode === 'lie_down';
      if (!motherSettled) {
        this.enterMode('idle', CALF_SHELTER_WAIT_SECONDS);
        return;
      }
      this.warmLie();
      this.enterMode('lie_down', LIE_DOWN_SECONDS);
      return;
    }
    if (this.walkTo(this.shelterTile(), 'shelter')) return;
    // No way into the barn from here: stand still rather than pace.
    this.enterMode('idle', randomBetween(this.random, IDLE_MIN_SECONDS, IDLE_MAX_SECONDS));
  }

  /** A calf's own choices. Returns whether it made one; otherwise it lives like an adult. */
  private decideAsCalf(): boolean {
    const mother = this.liveMother();
    if (mother !== null && this.tilesFrom(mother) > CALF_TETHER_TILES) {
      if (this.walkToward(mother, 'to_mother')) return true;
    }
    if (this.zoomieUpdatesLeft === 0) {
      this.zoomieUpdatesLeft = this.nextZoomieDelay();
      this.moo();
      this.warmAction('happy', this.facingX, this.facingY);
      this.enterMode('happy', HAPPY_SECONDS);
      return true;
    }
    if (mother !== null && this.modeValue !== 'walk') {
      if (
        this.random() >= GRAZE_IN_PLACE_CHANCE &&
        this.amble(mother.tile, CALF_AMBLE_RADIUS_TILES)
      ) {
        return true;
      }
    }
    return false;
  }

  private afterHappy(): void {
    // Petted on the lead: back to walking after whoever leads it.
    if (this.lead !== null) {
      this.enterMode('led', 0);
      return;
    }
    // A calf's zoomies end in a trot back to its mother.
    const mother = this.liveMother();
    if (this.isCalf && mother !== null && this.tilesFrom(mother) > CALF_REJOIN_TILES) {
      if (this.walkToward(mother, 'trot_back')) return;
    }
    this.enterMode('idle', randomBetween(this.random, IDLE_MIN_SECONDS, IDLE_MAX_SECONDS));
  }

  /** Starts the run away from the blast the flinch was for. */
  private beginPanicRun(): void {
    const flee = this.fleeFrom;
    const pen = this.pen;
    if (flee === null || pen === null || !this.walkTo(this.panicDestination(pen, flee), 'panic')) {
      this.endPanic();
    }
  }

  /**
   * The reachable pen tile furthest from the blast, a short run away. Picked
   * across the pen's own routes rather than along the straight line out of the
   * blast, because a line pointed at the fence is a run that never gets
   * anywhere — and a panicked animal pinned against a rail would otherwise
   * stay pinned for the whole panic.
   */
  private panicDestination(pen: CowPen, flee: FleeSource): TilePoint | null {
    let best: TilePoint | null = null;
    let bestScore = -Infinity;
    for (const { tile, steps } of pen.reachableFrom(this.penEntry(pen), PANIC_SEARCH_STEPS)) {
      if (steps < PANIC_MIN_RUN_STEPS) continue;
      const centreX = (tile.x + TILE_CENTRE) * TILE_SIZE;
      const centreY = (tile.y + TILE_CENTRE) * TILE_SIZE;
      const score = Math.hypot(centreX - flee.x, centreY - flee.y) + this.random() * TILE_SIZE;
      if (score > bestScore) {
        bestScore = score;
        best = tile;
      }
    }
    return best;
  }

  private endPanic(): void {
    this.fleeFrom = null;
    this.panicUpdatesLeft = 0;
    this.enterMode('idle', randomBetween(this.random, IDLE_MIN_SECONDS, IDLE_MAX_SECONDS));
  }

  /** Ambles to a random pen tile within `radiusTiles` of `around`. */
  private amble(around: TilePoint, radiusTiles: number): boolean {
    const pen = this.pen;
    if (pen === null) return false;
    const here = this.tile;
    const candidates = pen.pastureTiles.filter((tile) => {
      const fromAround = Math.hypot(tile.x - around.x, tile.y - around.y);
      const fromHere = Math.hypot(tile.x - here.x, tile.y - here.y);
      return (
        fromAround <= radiusTiles &&
        fromHere >= AMBLE_MIN_TILES &&
        fromHere <= AMBLE_MAX_TILES &&
        pen.isPassable(tile.x, tile.y)
      );
    });
    if (candidates.length === 0) return false;
    return this.walkTo(candidates[Math.floor(this.random() * candidates.length)], 'amble');
  }

  /** Up from lying down: back out to the paddock, or straight back to grazing if there is no way out. */
  private leaveTheBarn(): void {
    const pen = this.pen;
    if (pen !== null && !this.sheltering && this.isInBarn()) {
      const paddock = pen.pastureTiles.filter((tile) => pen.isPassable(tile.x, tile.y));
      const hasPaddock = paddock.length > 0;
      const goal = hasPaddock ? paddock[Math.floor(this.random() * paddock.length)] : null;
      if (this.walkTo(goal, 'amble')) return;
    }
    this.decideNext();
  }

  /** Where to lie in the barn: anywhere for an adult, beside its mother for a calf. */
  private shelterTile(): TilePoint | null {
    const pen = this.pen;
    const mother = this.liveMother();
    if (pen === null || mother === null) return this.randomBarnTile();
    const motherTile = mother.tile;
    let best: TilePoint | null = null;
    let bestDistance = Infinity;
    for (const tile of pen.barnTiles) {
      if (!pen.isPassable(tile.x, tile.y)) continue;
      const distance = Math.hypot(tile.x - motherTile.x, tile.y - motherTile.y);
      if (distance > 0 && distance < bestDistance) {
        bestDistance = distance;
        best = tile;
      }
    }
    return best ?? this.randomBarnTile();
  }

  private randomBarnTile(): TilePoint | null {
    const pen = this.pen;
    if (pen === null) return null;
    const floor = pen.barnTiles.filter((tile) => pen.isPassable(tile.x, tile.y));
    if (floor.length === 0) return null;
    return floor[Math.floor(this.random() * floor.length)];
  }

  /** Walks to the passable pen tile nearest `target` — a calf heading for its mother. */
  private walkToward(target: Cow, purpose: WalkPurpose): boolean {
    const pen = this.pen;
    if (pen === null) return false;
    const goal = target.tile;
    let best: TilePoint | null = null;
    let bestDistance = Infinity;
    for (const { tile } of pen.reachableFrom(this.penEntry(pen), Number.MAX_SAFE_INTEGER)) {
      const distance = Math.hypot(tile.x - goal.x, tile.y - goal.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = tile;
      }
    }
    return this.walkTo(best, purpose);
  }

  /** Whether the body's centre is somewhere the pen does not let it stand. */
  private isOffPen(): boolean {
    const pen = this.pen;
    if (pen === null) return false;
    const here = this.tile;
    return !pen.isPassable(here.x, here.y);
  }

  /**
   * Where routes start from: the tile underfoot, or — for an animal that has
   * ended up off the pen, shoved out by something that ignores walls — the
   * nearest pen tile, which it walks straight to first.
   */
  private penEntry(pen: CowPen): TilePoint {
    const here = this.tile;
    if (pen.isPassable(here.x, here.y)) return here;
    return pen.nearestPassable(here) ?? here;
  }

  /**
   * The walk from off the pen back onto `entry`, round the fence rather than
   * into it: the map's own path, which may go the long way through the gate.
   * Straight at it when the map finds none.
   */
  private wayBackTo(entry: TilePoint): TilePoint[] {
    const here = this.tile;
    const path = this.map?.findPath(here.x, here.y, entry.x, entry.y) ?? [];
    return path.length > 1 ? path.slice(1) : [entry];
  }

  private walkTo(goal: TilePoint | null, purpose: WalkPurpose): boolean {
    const pen = this.pen;
    if (goal === null || pen === null) return false;
    const here = this.tile;
    const entry = this.penEntry(pen);
    const enteringFromOutside = entry.x !== here.x || entry.y !== here.y;
    const onward = pen.route(entry, goal);
    if (onward === null) return false;
    const route = enteringFromOutside ? [...this.wayBackTo(entry), ...onward] : onward;
    if (route.length === 0) return false;
    this.route = route;
    this.routeIndex = 0;
    this.walkPurpose = purpose;
    const runs = purpose === 'panic' || purpose === 'trot_back' || purpose === 'to_mother';
    this.enterMode(runs ? 'trot' : 'walk', 0);
    return true;
  }

  private clearRoute(): void {
    this.route = [];
    this.routeIndex = 0;
  }

  private walkSpeed(): number {
    if (this.walkPurpose === 'panic') {
      return (this.speed * COW_PANIC_SPEED) / (this.isCalf ? CALF_WALK_SPEED : COW_WALK_SPEED);
    }
    if (this.walkPurpose === 'trot_back' || this.walkPurpose === 'to_mother') {
      return (this.speed * CALF_TROT_BACK_SPEED) / CALF_WALK_SPEED;
    }
    return this.speed;
  }

  private stepWalk(): void {
    // Shelter called mid-amble: head for the barn now, not after the stroll.
    if (this.sheltering && this.walkPurpose === 'amble' && !this.isOffPen()) {
      this.decideWhileSheltering();
      return;
    }
    // The run lasts as long as the panic does, wherever it has got to.
    if (this.walkPurpose === 'panic' && this.panicUpdatesLeft === 0) {
      this.endPanic();
      return;
    }
    // A calf's own amble is dropped the moment its mother has wandered off.
    if (this.walkPurpose === 'amble' && this.calfTooFarFromMother()) {
      const mother = this.liveMother();
      if (mother !== null && this.walkToward(mother, 'to_mother')) return;
    }
    if (this.walkPurpose === 'to_mother' || this.walkPurpose === 'trot_back') {
      const mother = this.liveMother();
      if (mother !== null && this.tilesFrom(mother) <= CALF_REJOIN_TILES) {
        this.finishWalk();
        return;
      }
      // She has moved on from where it was heading: head for where she is now.
      if (mother !== null && this.routeGoalDriftedFrom(mother)) {
        const purpose = this.walkPurpose;
        if (this.walkToward(mother, purpose)) return;
      }
    }
    if (this.routeIndex >= this.route.length) {
      this.finishWalk();
      return;
    }
    const waypoint = this.route[this.routeIndex];
    const targetX = waypoint.x * TILE_SIZE;
    const targetY = waypoint.y * TILE_SIZE;
    this.followTargetCollide(targetX, targetY, this.walkSpeed(), 0);
    if (Math.hypot(targetX - this.x, targetY - this.y) <= WAYPOINT_ARRIVE_PX) {
      this.routeIndex++;
    }
  }

  /**
   * Whether the end of the current route is now well away from `mother`,
   * checked at most every `RETARGET_CHECK_SECONDS` so a calf is not replanning
   * every step.
   */
  private routeGoalDriftedFrom(mother: Cow): boolean {
    if (this.retargetUpdatesLeft > 0) {
      this.retargetUpdatesLeft--;
      return false;
    }
    this.retargetUpdatesLeft = secondsToUpdates(RETARGET_CHECK_SECONDS);
    if (this.route.length === 0) return false;
    const goal = this.route[this.route.length - 1];
    const motherTile = mother.tile;
    return Math.hypot(goal.x - motherTile.x, goal.y - motherTile.y) > CALF_REJOIN_TILES;
  }

  private finishWalk(): void {
    const purpose = this.walkPurpose;
    this.clearRoute();
    if (purpose === 'panic') {
      const pen = this.pen;
      const flee = this.fleeFrom;
      // Still inside the panic: keep running rather than stopping short.
      if (this.panicUpdatesLeft > 0 && pen !== null && flee !== null) {
        if (this.walkTo(this.panicDestination(pen, flee), 'panic')) return;
      }
      this.endPanic();
      return;
    }
    if (purpose === 'to_barn' || purpose === 'shelter') {
      this.warmLie();
      this.enterMode('lie_down', LIE_DOWN_SECONDS);
      return;
    }
    this.decideNextAfterWalk();
  }

  private decideNextAfterWalk(): void {
    if (this.sheltering) {
      this.decideWhileSheltering();
      return;
    }
    if (this.random() < GRAZE_IN_PLACE_CHANCE) {
      this.enterMode('graze', randomBetween(this.random, GRAZE_MIN_SECONDS, GRAZE_MAX_SECONDS));
    } else {
      this.enterMode('idle', randomBetween(this.random, IDLE_MIN_SECONDS, IDLE_MAX_SECONDS));
    }
  }

  /**
   * Gives up a walk that has got nowhere in a second — another cow standing in
   * the gate, a crawler in the barn door — and decides again. Measured as the
   * ground actually gained over that second, never `isMoving` (true for a mob
   * grinding against a rail) nor pixels stepped (two animals shoving each
   * other back and forth step plenty and gain nothing).
   */
  private watchForStall(): void {
    if (!this.isTryingToWalk) {
      this.stalledUpdates = 0;
      return;
    }
    if (this.stalledUpdates === 0) {
      this.stallCheckFromX = this.x;
      this.stallCheckFromY = this.y;
    }
    this.stalledUpdates++;
    if (this.stalledUpdates < secondsToUpdates(STUCK_GIVE_UP_SECONDS)) return;
    this.stalledUpdates = 0;
    const gainedPx = Math.hypot(this.x - this.stallCheckFromX, this.y - this.stallCheckFromY);
    const lead = this.lead;
    if (gainedPx >= STALL_MIN_GAIN_TILES * TILE_SIZE) {
      if (lead !== null) lead.stalls = 0;
      return;
    }
    if (this.modeValue === 'led') {
      this.onLedStall();
      return;
    }
    const panicking = this.walkPurpose === 'panic';
    this.clearRoute();
    if (panicking) {
      this.endPanic();
      return;
    }
    // Headed for shelter, it waits only a moment for the way to clear.
    const waitSeconds = this.sheltering
      ? SHELTER_RETRY_SECONDS
      : randomBetween(this.random, IDLE_MIN_SECONDS, IDLE_MAX_SECONDS);
    this.enterMode('idle', waitSeconds);
  }

  private enterMode(mode: CowMode, seconds: number): void {
    this.modeValue = mode;
    this.modeUpdatesLeft = secondsToUpdates(seconds);
    this.modeUpdatesElapsed = 0;
    if (mode !== 'walk' && mode !== 'trot') this.clearRoute();
  }

  private nextZoomieDelay(): number {
    return secondsToUpdates(randomBetween(this.random, ZOOMIE_MIN_SECONDS, ZOOMIE_MAX_SECONDS));
  }

  private nextBleatDelay(): number {
    return secondsToUpdates(
      randomBetween(this.random, CALF_BLEAT_MIN_SECONDS, CALF_BLEAT_MAX_SECONDS),
    );
  }

  /**
   * Advances the gait by the ground actually covered, capped at one row frame
   * per update: past that the row is undersampled and the legs vibrate rather
   * than walk.
   */
  private advanceGait(movedPx: number): void {
    if (movedPx <= 0) return;
    const trotting = this.modeValue === 'trot';
    const tilesPerCycle = trotting
      ? this.isCalf
        ? CALF_TILES_PER_TROT_CYCLE
        : COW_TILES_PER_TROT_CYCLE
      : this.isCalf
        ? CALF_TILES_PER_WALK_CYCLE
        : COW_TILES_PER_WALK_CYCLE;
    const frames = trotting ? COW_TROT_FRAMES : COW_WALK_FRAMES;
    const radiansPerPixel = TWO_PI / (tilesPerCycle * TILE_SIZE);
    const step = Math.min(movedPx * radiansPerPixel, TWO_PI / frames);
    this.gaitPhase = (this.gaitPhase + step) % TWO_PI;
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  /** The row and its progress this update. */
  private spriteAction(): { action: CowAction; progress: number } {
    const oneShotProgress = (seconds: number): number =>
      Math.min(1, this.modeUpdatesElapsed / Math.max(1, secondsToUpdates(seconds)));
    switch (this.modeValue) {
      // A step that gained nothing this update (a shove, a waypoint reached)
      // holds the stride rather than flashing the idle for a frame, which
      // would also keep that idle's view baked for nothing. A pen-less animal
      // is the exception: its wander pauses for seconds, and it idles through them.
      case 'walk':
        return {
          action: this.pen === null && !this.movedThisUpdate ? 'idle' : 'walk',
          progress: 0,
        };
      case 'trot':
        return { action: 'trot', progress: 0 };
      case 'graze':
        return { action: 'graze', progress: 0 };
      case 'happy':
        return { action: 'happy', progress: oneShotProgress(HAPPY_SECONDS) };
      case 'flinch':
        return { action: 'flinch', progress: oneShotProgress(FLINCH_SECONDS) };
      case 'lie_down':
        return { action: 'lie_down', progress: oneShotProgress(LIE_DOWN_SECONDS) };
      case 'stand_up':
        return { action: 'lie_down', progress: 1 - oneShotProgress(LIE_DOWN_SECONDS) };
      case 'lie':
        return { action: 'lie', progress: 0 };
      case 'idle':
        return { action: 'idle', progress: 0 };
      // Held with nobody leading it, it grazes where it stands.
      case 'led':
        if (this.movedThisUpdate) return { action: 'walk', progress: 0 };
        return { action: this.lead?.leader === null ? 'graze' : 'idle', progress: 0 };
    }
  }

  /**
   * The row `drawSelf` asks the figure cache for right now — the state name,
   * as `drawCowSprite` composes it. For measuring what a herd on screen keeps
   * baked.
   */
  get drawnState(): string {
    return cowStateFor(this.spriteAction().action, this.facingX, this.facingY);
  }

  /** The view the sprite picks for the current facing; the same split `drawCowSprite` makes. */
  private view(): CowView {
    if (Math.abs(this.facingY) <= Math.abs(this.facingX)) return 'side';
    return this.facingY < 0 ? 'back' : 'front';
  }

  /**
   * The world pixel over the top of the head, where the hearts of a pet rise
   * from. Read off the resting pose: the hearts start as the happy row starts,
   * and the head is at rest then.
   */
  headAnchor(): { x: number; y: number } {
    const view = this.view();
    const poll = cowPollPoint(restCowPose(), cowLookOf(this.coat, this.age), view);
    const mirror = view === 'side' && this.facingX < 0 ? -1 : 1;
    return {
      x: this.x + TILE_SIZE * TILE_CENTRE + poll.x * TILE_SIZE * mirror,
      y: this.y + TILE_SIZE * TILE_CENTRE + poll.y * TILE_SIZE,
    };
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    if (!this.isAlive) return;
    const sx = this.x - camX;
    const sy = this.y - camY;
    const markerColor = questMarkerColorFor(this.questMarker);
    // Beacon first, so the column stands behind the animal rather than across it.
    if (markerColor !== undefined) {
      drawQuestBeacon(ctx, sx, sy, tileSize, camX, camY, performance.now(), markerColor);
    }
    const { action, progress } = this.spriteAction();
    const drawnRow = drawCowSprite(ctx, sx, sy, tileSize, {
      coat: this.coat,
      age: this.age,
      action,
      facingX: this.facingX,
      facingY: this.facingY,
      gaitPhase: this.gaitPhase,
      progress,
      clockSeconds: this.clockSeconds,
    });
    const artTop = figureRowInkTop(drawnRow, sy, tileSize);
    if (!this.healthBarDrawnElsewhere) this.renderMobHealthBar(ctx, sx, sy, artTop);
    if (markerColor !== undefined) {
      const glyph = this.questMarker === 'question' ? '?' : '!';
      const clearOf = this.overheadClearTop(artTop, sy);
      drawQuestMarker(ctx, sx, clearOf, tileSize, glyph, markerColor);
    }
  }
}
