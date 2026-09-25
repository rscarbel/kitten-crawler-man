import { Mob, type LootDrop, type PlayerDamageType } from './Mob';
import type { DamageSource, Player } from '../Player';
import { PLAYER_SPEED, TILE_SIZE } from '../core/constants';
import { normalize } from '../utils';
import type { TilePoint, TileRect } from '../map/town/townPlan';
import type { RatkinSoldierId } from '../sprites/art/ratkin/cast';
import {
  type RatkinCastAction,
  drawRatkinCastSprite,
  prewarmRatkinSoldierFight,
  ratkinCastEventFrame,
  ratkinCastStateFor,
  ratkinCastTilesPerWalkCycle,
} from '../sprites/ratkinCastSprite';
import { ratkinCastRow } from '../sprites/art/ratkinCastFigure';
import { TimedSpeech } from '../sprites/speechBubble';
import { GHOUL_ATTACK_COOLDOWN_FRAMES, GHOUL_ATTACK_DAMAGE, GHOUL_HP } from './RuinsGhoul';

/**
 * One of Briar Hollow's four militia: a ratkin with a spear, on the party's
 * side, who guards the village and takes orders from either crawler.
 *
 * A `Mob` because it has to fight and be fought: hostiles pick it out of the
 * scene's allied defenders, it strikes them with a spear thrust, and it takes
 * knockback and damage like anything else. It is not hostile and not prey, so
 * Mongo, the hirelings, auto-aim and every aimed crawler weapon pass it by.
 *
 * It never dies. At no health it is knocked down where it stood — out of every
 * fight, drawn on the ground, owed no XP and counted as no kill — and it gets
 * back up later. `SoldierSystem` decides when; this class only falls and rises.
 *
 * What it is doing is its {@link SoldierDuty}, written by `SoldierSystem` from
 * the soldier's standing orders. The duty says where it belongs and how far
 * from there it will go after a hostile; `updateAI` does the rest.
 */

const UPDATES_PER_SECOND = 60;
const CENTER_OFFSET = 0.5;
const FULL_TURN = Math.PI * 2;

/**
 * The militia's numbers are written as multiples of the ruins ghoul's, the
 * floor's common undead brawler, and levelled through the same curves: three
 * quarters of a ghoul's health, blows a quarter harder and a little faster.
 * Tuned so one soldier beats one Raised Ratkin — the weakest body in the
 * siege — and is knocked down by three, which `verify:soldiers` fights out.
 */
const SOLDIER_HP_OVER_REFERENCE = 0.75;
const SOLDIER_DAMAGE_OVER_REFERENCE = 1.25;
const SOLDIER_COOLDOWN_OVER_REFERENCE = 0.6;
export const SOLDIER_BASE_HP = GHOUL_HP * SOLDIER_HP_OVER_REFERENCE;
export const SOLDIER_BASE_DAMAGE = GHOUL_ATTACK_DAMAGE * SOLDIER_DAMAGE_OVER_REFERENCE;
export const SOLDIER_ATTACK_COOLDOWN_FRAMES = Math.round(
  GHOUL_ATTACK_COOLDOWN_FRAMES * SOLDIER_COOLDOWN_OVER_REFERENCE,
);
/** A soldier's walk, before its own pace and its level: a little under a crawler's. */
export const SOLDIER_BASE_SPEED = 2;

/** The spear most of the militia carry reaches this far, centre to centre. */
const SPEAR_REACH_TILES = 1.3;
/** Pru's own long-shafted spear. */
const LONG_SPEAR_REACH_TILES = 1.6;
/** How far a soldier at their post will go after a hostile, measured from the post. */
export const POST_ENGAGE_TILES = 8;
/** Sedge watches further than anyone. */
const SEDGE_NOTICE_TILES = 10;

/** Who each soldier is in a fight. */
export interface SoldierProfile {
  readonly name: string;
  readonly hpScale: number;
  readonly speedScale: number;
  readonly damageScale: number;
  readonly reachTiles: number;
  /** How far from their post they go after a hostile. */
  readonly postEngageTiles: number;
  /** Hobb favours whatever is at the gate. */
  readonly guardsGate: boolean;
}

export const SOLDIER_PROFILES: Readonly<Record<RatkinSoldierId, SoldierProfile>> = {
  sedge: {
    name: 'Sedge Quickclaw',
    hpScale: 0.8,
    speedScale: 1.25,
    damageScale: 0.9,
    reachTiles: SPEAR_REACH_TILES,
    postEngageTiles: SEDGE_NOTICE_TILES,
    guardsGate: false,
  },
  hobb: {
    name: 'Hobb Greycloak',
    hpScale: 1.4,
    speedScale: 0.9,
    damageScale: 1,
    reachTiles: SPEAR_REACH_TILES,
    postEngageTiles: POST_ENGAGE_TILES,
    guardsGate: true,
  },
  marta: {
    name: 'Marta Redwhisker',
    hpScale: 1.2,
    speedScale: 1,
    damageScale: 1.15,
    reachTiles: SPEAR_REACH_TILES,
    postEngageTiles: POST_ENGAGE_TILES,
    guardsGate: false,
  },
  pru: {
    name: 'Pru Bristleback',
    hpScale: 1.2,
    speedScale: 0.95,
    damageScale: 1.2,
    reachTiles: LONG_SPEAR_REACH_TILES,
    postEngageTiles: POST_ENGAGE_TILES,
    guardsGate: false,
  },
};

/** Frames the spear thrust plays over, start to recovery. */
const STRIKE_FRAMES = 30;
/** The figure's own impact frame, when the row cannot be read. */
const FALLBACK_IMPACT_FRAME = 4;
const FALLBACK_STRIKE_ROW_FRAMES = 8;
/** A target that stepped this much past the reach as the spear came down is still hit. */
const STRIKE_REACH_SLACK = 1.15;
/** Frames the flinch plays over. */
const HURT_FRAMES = 14;
/** Frames the collapse plays over before its last frame is held. */
export const DOWN_FRAMES = 36;
/** Frames the soldier takes to stand back up, untouchable throughout. */
export const RISE_FRAMES = 48;

/** A soldier walking a patrol or a beat goes at this share of their pace. */
export const PATROL_PACE = 0.8;
/** Close enough to a waypoint to count as having reached it. */
const WAYPOINT_ARRIVAL_TILES = 0.4;
/** Close enough to where they stand to stop walking. */
const STAND_ARRIVAL_PX = 3;
/** Within this many tiles of the gate's near side, a walk through it heads on to the far side. */
const GATE_LEG_ARRIVAL_TILES = 1;
/**
 * How far a soldier's path search reaches, in the search's own measure (the
 * larger of the two axis distances). A follower sent home from the end of
 * the village leash — 30 tiles out on any side — first walks to the gate,
 * which from the far side of the village is the leash plus the palisade's
 * whole width away (about 90 tiles); the default reach of 24 stops a
 * quarter of the way and leaves the soldier standing in the wilds.
 */
const SOLDIER_PATH_BUDGET_TILES = 100;
/** Drifted this far from where they stand, they walk back. */
const STAND_RETURN_TILES = 0.5;

/** The follow band: set off after the crawler past the first, stop inside the second. */
export const FOLLOW_START_TILES = 4;
export const FOLLOW_STOP_TILES = 2;
/**
 * A follower that has fallen out of the band jogs to close it at no less
 * than a crawler's own walking pace, or a crawler at a steady walk would
 * leave the slower soldiers further behind with every step.
 */
const FOLLOW_CATCH_UP_PACE_OF_CRAWLER = 1;
/** A follower drops a fight that has carried it this far from the crawler it follows. */
const FOLLOW_FIGHT_LEASH_TILES = 9;
/** A fight dropped at the edge of a soldier's ground is not picked straight back up for this long. */
const DROPPED_TARGET_BAN_SECONDS = 3;
const DROPPED_TARGET_BAN_FRAMES = DROPPED_TARGET_BAN_SECONDS * UPDATES_PER_SECOND;
/** A post soldier chases this much past the ground they engage over before letting go. */
const POST_CHASE_SLACK_TILES = 2;

/** How much nearer, in tiles, a hostile at the gate counts for Hobb. */
const GATE_PREFERENCE_TILES = 4;
/** Within this many tiles of the gate a hostile is "at the gate". */
const GATE_NEAR_TILES = 3;
/** How much nearer, in tiles, a hostile already fighting this soldier counts. */
const ATTACKER_PREFERENCE_TILES = 2;
/** Frames the soldier keeps facing where it last saw a hostile. */
const LAST_SEEN_FACING_SECONDS = 10;
const LAST_SEEN_FACING_FRAMES = LAST_SEEN_FACING_SECONDS * UPDATES_PER_SECOND;

/** Marta's rally: the damage a rallied soldier's blows gain, and for how long. */
export const RALLY_DAMAGE_MULTIPLIER = 1.1;
const RALLY_SECONDS = 5;
export const RALLY_FRAMES = RALLY_SECONDS * UPDATES_PER_SECOND;

/** Longer lines stay up longer, so a sentence can be read before it goes. */
const SPEECH_FRAMES_PER_CHARACTER = 5;
const MIN_SPEECH_FRAMES = 150;
const MAX_SPEECH_FRAMES = 420;

/** A spear reaches past the tile, so the figure is kept drawing a little off screen. */
const SOLDIER_CULL_MARGIN_TILES = 2;

/**
 * Where a soldier belongs and how far from there it goes after a hostile.
 *
 * - `stand`: a tile to hold — a post, a held position, a battle post. It
 *   engages hostiles within `engageTiles` of the tile and never steps further
 *   than `leashTiles` from it, facing `outward` when idle.
 * - `follow`: trails `owner` in the follow band and fights anything within
 *   `engageTiles` of them.
 * - `patrol`: walks `route` in a loop at patrol pace and fights anything
 *   within `engageTiles` of it.
 */
export type SoldierDuty =
  | {
      readonly kind: 'stand';
      readonly anchor: TilePoint;
      readonly engageTiles: number;
      readonly leashTiles: number;
      readonly outward: { readonly x: number; readonly y: number };
    }
  | { readonly kind: 'follow'; readonly owner: Player; readonly engageTiles: number }
  | {
      readonly kind: 'patrol';
      readonly route: readonly TilePoint[];
      readonly engageTiles: number;
    };

function rectHolds(rect: TileRect, tile: TilePoint): boolean {
  return (
    tile.x >= rect.x && tile.y >= rect.y && tile.x < rect.x + rect.w && tile.y < rect.y + rect.h
  );
}

function tileCentrePx(tile: TilePoint): { x: number; y: number } {
  return { x: tile.x * TILE_SIZE, y: tile.y * TILE_SIZE };
}

/** Distance from point p to the segment a→b, all in the same units. */
function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSq = abx * abx + aby * aby;
  const along = lengthSq === 0 ? 0 : ((px - ax) * abx + (py - ay) * aby) / lengthSq;
  const t = Math.max(0, Math.min(1, along));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

export class RatkinSoldier extends Mob {
  readonly xpValue: number = 0;
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  readonly soldierId: RatkinSoldierId;
  readonly profile: SoldierProfile;
  displayName: string;
  description = 'A Briar Hollow militia soldier. Fights for the village, and takes your orders.';
  override readonly audioTag = 'ratkin_soldier';
  /** A downed soldier stays in the world, drawn on the ground, until it gets up. */
  override readonly rendersWhenDead = true;

  /** What the soldier is doing; written by `SoldierSystem` whenever the orders change. */
  duty: SoldierDuty;
  /** Every mob in the scene, set each frame by `SoldierSystem`. */
  allMobs: readonly Mob[] = [];
  /** The crawlers, set each frame, so a follower rests against whoever is in the way. */
  party: readonly Player[] = [];
  /** The tiles either side of the gate, for a walk that has to go through it. */
  gateRoute: { readonly inside: TilePoint; readonly outside: TilePoint } | null = null;
  /** The palisade's outer rectangle, which a walk crosses only at the gate. */
  villageBounds: TileRect | null = null;
  /** The gate's middle, in world pixels, for the soldier who guards it. */
  gateCentre: { readonly x: number; readonly y: number } | null = null;
  /** Whoever the soldier is talking to; it stands and faces them. */
  talkPartner: { readonly x: number; readonly y: number } | null = null;

  /** What the soldier is calling out; drawn by `SoldierSystem` over every body. */
  readonly speech = new TimedSpeech();

  private downed = false;
  /** Frames on the ground, for the collapse and for the recovery clock. */
  downedFrames = 0;
  private risingFramesLeft = 0;
  /** Set the frame the soldier falls; `SoldierSystem` reads and clears it. */
  fellThisFrame = false;

  private strikeTick = -1;
  private strikeTarget: Mob | null = null;
  private strikeFacingX = 0;
  private strikeFacingY = 1;
  private attackCooldown = 0;
  private hurtFramesLeft = 0;
  private hpLastFrame: number;

  private engaged: Mob | null = null;
  /** Set the frame the soldier takes on a fresh hostile; `SoldierSystem` reads and clears it. */
  engagedFreshThisFrame = false;
  private readonly bans = new Map<Mob, number>();
  private lastSeenHostile: { x: number; y: number } | null = null;
  private lastSeenFrames = 0;

  private routeIndex = 0;
  /** Patrol loops completed since the duty was set. */
  loopsCompleted = 0;
  private followingOwner = false;
  private returningToStand = false;

  /** Frames of Marta's rally left on this soldier's blows. */
  rallyFramesLeft = 0;
  /** Hostiles this soldier has finished off; `SoldierSystem` reads it for Marta's rally. */
  killsLanded = 0;

  private walkPhase = 0;
  private gaitSampleX: number;
  private gaitSampleY: number;
  private readonly tilesPerWalkCycle: number;

  constructor(tileX: number, tileY: number, tileSize: number, soldierId: RatkinSoldierId) {
    const profile = SOLDIER_PROFILES[soldierId];
    super(
      tileX,
      tileY,
      tileSize,
      SOLDIER_BASE_HP * profile.hpScale,
      SOLDIER_BASE_SPEED * profile.speedScale,
    );
    this.soldierId = soldierId;
    this.profile = profile;
    this.displayName = profile.name;
    this.duty = {
      kind: 'stand',
      anchor: { x: tileX, y: tileY },
      engageTiles: profile.postEngageTiles,
      leashTiles: profile.postEngageTiles + POST_CHASE_SLACK_TILES,
      outward: { x: 0, y: 1 },
    };
    this.hpLastFrame = this.hp;
    this.pathDistanceBudgetTiles = SOLDIER_PATH_BUDGET_TILES;
    this.gaitSampleX = this.x;
    this.gaitSampleY = this.y;
    this.tilesPerWalkCycle = ratkinCastTilesPerWalkCycle(soldierId);
  }

  // ── Allegiance ───────────────────────────────────────────────────────────

  override get isHostile(): boolean {
    return false;
  }

  override get isPetAttackable(): boolean {
    return false;
  }

  /** Being knocked down is no feat, and it never feeds a floor's on-kill spawns. */
  override get countsAsKill(): boolean {
    return false;
  }

  override get seedsOnKillSpawns(): boolean {
    return false;
  }

  /**
   * Only a follower keeps thinking out of the party's sight: it has to keep
   * up. A soldier at its post off screen has nothing it could fight but
   * hostiles frozen by the same activation radius, and a spear through a
   * sleeping ghoul is a free kill nobody watched.
   */
  override get exemptFromAiActivationRadius(): boolean {
    return this.duty.kind === 'follow' || this.isHeadingHome;
  }

  /**
   * Out past the ground its duty lets it fight on, walking back. It thinks
   * wherever the party is until it gets there — a follower sent home from far
   * outside the palisade would otherwise stand frozen in the wilds — and it
   * picks no fight on the way, so thinking off screen never meets a hostile
   * the activation radius has frozen.
   */
  private get isHeadingHome(): boolean {
    return this.duty.kind === 'stand' && this.strayedTooFar();
  }

  /** Walks with the party, so it steps around the crawlers rather than shoving them. */
  override get yieldsToParty(): boolean {
    return true;
  }

  override get cullMarginTiles(): number {
    return SOLDIER_CULL_MARGIN_TILES;
  }

  protected override rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  override rollLootDrop(_killer: Player | null): LootDrop {
    return { coins: 0, items: [] };
  }

  // ── Downed ───────────────────────────────────────────────────────────────

  /** On the ground, or still getting up: nothing may harm it either way. */
  protected override get isDamageImmune(): boolean {
    return this.downed || this.risingFramesLeft > 0;
  }

  override takeDamage(amount: number, source?: DamageSource): boolean {
    if (this.downed || this.risingFramesLeft > 0) return false;
    const connected = super.takeDamage(amount, source);
    this.fallIfSpent();
    return connected;
  }

  override takeDamageFrom(
    amount: number,
    attacker: Player | null,
    damageType: PlayerDamageType | null = 'melee',
  ): void {
    if (this.downed || this.risingFramesLeft > 0) return;
    super.takeDamageFrom(amount, attacker, damageType);
    this.fallIfSpent();
  }

  /** Whether the soldier is on the ground. */
  get isDowned(): boolean {
    return this.downed;
  }

  /** Whether the soldier is standing back up. */
  get isRising(): boolean {
    return this.risingFramesLeft > 0;
  }

  /**
   * At no health the soldier goes down instead of dying. Everything the
   * killing blow latched for a kill is undone on the spot, before kill
   * resolution can see it: no `mobKilled`, no XP, no loot, no kill tally.
   */
  fallIfSpent(): void {
    if (this.hp > 0 || this.downed) return;
    this.hp = 0;
    this.downed = true;
    this.downedFrames = 0;
    this.fellThisFrame = true;
    this.isKnockedOut = true;
    this.reviveProgress = 0;
    this.justDied = false;
    this.killedBy = null;
    this.killedByDealer = null;
    this.killType = null;
    this.droppedLoot = null;
    this.damageTakenBy.clear();
    this.dropFight();
    this.isMoving = false;
    this.clearKnockback();
    this.clearStatusEffects();
    this.clearAStarPath();
    this.speech.clear();
    prewarmRatkinSoldierFight(this.soldierId);
  }

  /** One frame on the ground; the recovery clock is `SoldierSystem`'s. */
  tickDowned(): void {
    if (!this.downed) return;
    this.downedFrames++;
    this.speech.tick();
  }

  /** Stands back up with `hpFraction` of full health, untouchable until on its feet. */
  rise(hpFraction: number): void {
    if (!this.downed) return;
    this.downed = false;
    this.isKnockedOut = false;
    this.reviveProgress = 0;
    this.damageFlash = 0;
    this.hp = Math.max(1, Math.round(this.maxHp * hpFraction));
    this.hpLastFrame = this.hp;
    this.risingFramesLeft = RISE_FRAMES;
    this.onTeleported();
  }

  /** A downed body never expires: it waits to get up. */
  override get corpseExpired(): boolean {
    return false;
  }

  /**
   * A soldier down when the checkpoint was taken and standing now was never
   * dead, so there is no kill to put back: a rewind stands it up healed like
   * every other ally, rather than laying it out for good.
   */
  override undoResurrectionForCheckpoint(): void {
    this.healAndForgetFight();
  }

  /**
   * A fight being called off — a checkpoint rewind — puts the soldier on its
   * feet with nothing latched.
   */
  protected override clearEncounterPhase(): void {
    this.downed = false;
    this.isKnockedOut = false;
    this.reviveProgress = 0;
    this.risingFramesLeft = 0;
    this.fellThisFrame = false;
    this.dropFight();
    this.hurtFramesLeft = 0;
    this.rallyFramesLeft = 0;
    this.bans.clear();
  }

  // ── Duty ─────────────────────────────────────────────────────────────────

  /** Replaces what the soldier is doing, starting the new duty fresh. */
  setDuty(duty: SoldierDuty): void {
    this.duty = duty;
    this.routeIndex = duty.kind === 'patrol' ? this.nearestWaypointIndex(duty.route) : 0;
    this.loopsCompleted = 0;
    this.followingOwner = false;
    this.returningToStand = true;
    this.dropFight();
    this.clearAStarPath();
  }

  /** Called when something other than its own feet has put the soldier on a new tile. */
  onTeleported(): void {
    this.clearAStarPath();
    this.followingOwner = false;
    this.returningToStand = true;
    this.gaitSampleX = this.x;
    this.gaitSampleY = this.y;
  }

  /** The hostile being fought, or null. */
  get currentFoe(): Mob | null {
    return this.engaged;
  }

  /** Whether the soldier has a fight on its hands. */
  get isFighting(): boolean {
    return this.engaged !== null || this.strikeTick >= 0;
  }

  /** Where the soldier stands, as the tile under its centre. */
  get tile(): TilePoint {
    return {
      x: Math.floor((this.x + TILE_SIZE * CENTER_OFFSET) / TILE_SIZE),
      y: Math.floor((this.y + TILE_SIZE * CENTER_OFFSET) / TILE_SIZE),
    };
  }

  /** Says a line over its head for long enough to read it. */
  say(text: string): void {
    const readingFrames = text.length * SPEECH_FRAMES_PER_CHARACTER;
    this.speech.say(text, {
      durationFrames: Math.min(MAX_SPEECH_FRAMES, Math.max(MIN_SPEECH_FRAMES, readingFrames)),
    });
  }

  // ── The frame ────────────────────────────────────────────────────────────

  /** The `targets` list is the crawlers; a soldier picks its own fights from `allMobs`. */
  updateAI(_targets: Player[]): void {
    if (!this.isAlive) return;
    this.syncGaitToGroundCovered();
    this.speech.tick();
    this.tickBans();
    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.rallyFramesLeft > 0) this.rallyFramesLeft--;
    if (this.lastSeenFrames > 0) this.lastSeenFrames--;
    this.noteWounds();

    if (this.risingFramesLeft > 0) {
      this.risingFramesLeft--;
      this.isMoving = false;
      return;
    }
    if (this.talkPartner !== null) {
      this.isMoving = false;
      this.faceToward(this.talkPartner);
      return;
    }
    // Marked ground outranks everything, a committed thrust included.
    if (this.stepOffMarkedGround(this.speed)) return;
    if (this.strikeTick >= 0) {
      this.advanceStrike();
      return;
    }

    const foe = this.chooseFoe();
    if (foe !== null) {
      this.fight(foe);
      return;
    }
    this.doDuty();
  }

  private noteWounds(): void {
    if (this.hp < this.hpLastFrame && this.strikeTick < 0) this.hurtFramesLeft = HURT_FRAMES;
    else if (this.hurtFramesLeft > 0) this.hurtFramesLeft--;
    this.hpLastFrame = this.hp;
  }

  private tickBans(): void {
    for (const [mob, frames] of this.bans) {
      if (frames <= 1) this.bans.delete(mob);
      else this.bans.set(mob, frames - 1);
    }
  }

  private syncGaitToGroundCovered(): void {
    const covered = Math.hypot(this.x - this.gaitSampleX, this.y - this.gaitSampleY);
    this.gaitSampleX = this.x;
    this.gaitSampleY = this.y;
    this.walkPhase =
      (this.walkPhase + (covered / (this.tilesPerWalkCycle * TILE_SIZE)) * FULL_TURN) % FULL_TURN;
  }

  // ── Choosing a fight ─────────────────────────────────────────────────────

  /** The point the duty's ground is measured from, in world pixels. */
  private zoneDistancePx(mob: Mob): number {
    const duty = this.duty;
    switch (duty.kind) {
      case 'stand': {
        const anchor = tileCentrePx(duty.anchor);
        return Math.hypot(mob.x - anchor.x, mob.y - anchor.y);
      }
      case 'follow':
        return Math.hypot(mob.x - duty.owner.x, mob.y - duty.owner.y);
      case 'patrol':
        return this.distanceToRoutePx(duty.route, mob.x, mob.y);
    }
  }

  private distanceToRoutePx(route: readonly TilePoint[], x: number, y: number): number {
    if (route.length === 0) return Infinity;
    let best = Infinity;
    for (let index = 0; index < route.length; index++) {
      const a = tileCentrePx(route[index]);
      const b = tileCentrePx(route[(index + 1) % route.length]);
      best = Math.min(best, distanceToSegment(x, y, a.x, a.y, b.x, b.y));
    }
    return best;
  }

  /** How far past its ground the soldier keeps after a hostile it already has. */
  private keepRadiusPx(): number {
    const duty = this.duty;
    const slack = duty.kind === 'stand' ? duty.leashTiles - duty.engageTiles : 0;
    return (duty.engageTiles + Math.max(0, slack)) * TILE_SIZE;
  }

  /** Whether chasing `foe` has carried the soldier past where its duty lets it go. */
  private strayedTooFar(): boolean {
    const duty = this.duty;
    if (duty.kind === 'stand') {
      const anchor = tileCentrePx(duty.anchor);
      return Math.hypot(this.x - anchor.x, this.y - anchor.y) > duty.leashTiles * TILE_SIZE;
    }
    if (duty.kind === 'follow') {
      const fromOwner = Math.hypot(this.x - duty.owner.x, this.y - duty.owner.y);
      return fromOwner > FOLLOW_FIGHT_LEASH_TILES * TILE_SIZE;
    }
    return false;
  }

  private isCandidate(mob: Mob): boolean {
    return (
      mob !== this &&
      mob.isAlive &&
      mob.isHostile &&
      !mob.offLimitsToAllies &&
      !mob.isDefendTarget &&
      !this.bans.has(mob)
    );
  }

  /**
   * Whether a fresh fight with `mob` would not first mean a walk round the
   * palisade. A soldier posted or patrolling on one side of the wall only
   * takes on what is on that side: the walk to the gate and back would carry
   * it off its ground and home again, over and over. The exceptions are
   * whatever is already after the soldier, and — for the gate's own guard —
   * whatever is at the gate. A follower goes where its crawler does.
   */
  private onMySideOfTheWall(mob: Mob): boolean {
    const bounds = this.villageBounds;
    const duty = this.duty;
    if (bounds === null || duty.kind === 'follow' || this.isHuntingMe(mob)) return true;
    const gate = this.gateCentre;
    if (this.profile.guardsGate && gate !== null) {
      const fromGate = Math.hypot(mob.x - gate.x, mob.y - gate.y);
      if (fromGate <= GATE_NEAR_TILES * TILE_SIZE) return true;
    }
    const home = duty.kind === 'stand' ? duty.anchor : this.tile;
    const mobTile = {
      x: Math.floor((mob.x + TILE_SIZE * CENTER_OFFSET) / TILE_SIZE),
      y: Math.floor((mob.y + TILE_SIZE * CENTER_OFFSET) / TILE_SIZE),
    };
    return rectHolds(bounds, home) === rectHolds(bounds, mobTile);
  }

  /** Whether `mob` is after this soldier: aiming at it, or answering a blow from it. */
  private isHuntingMe(mob: Mob): boolean {
    return mob.currentTarget === this || mob.retaliateMob === this;
  }

  /**
   * The hostile to fight this frame. The one already engaged is kept while it
   * stays on the soldier's ground; a fresh one must be on the ground and seen.
   * A fight the soldier had to let go of is banned for a while — unless the
   * hostile is still after the soldier — so it is not picked straight back up
   * on the next frame and walked out to again.
   */
  private chooseFoe(): Mob | null {
    const held = this.engaged;
    if (held !== null) {
      const stillValid =
        held.isAlive && held.isHostile && this.zoneDistancePx(held) <= this.keepRadiusPx();
      if (stillValid && !this.strayedTooFar()) return held;
      if (held.isAlive && !this.isHuntingMe(held)) this.bans.set(held, DROPPED_TARGET_BAN_FRAMES);
      this.dropFight();
      if (this.strayedTooFar()) return null;
    }

    if (this.strayedTooFar()) return null;
    const engagePx = this.duty.engageTiles * TILE_SIZE;
    let best: Mob | null = null;
    let bestScore = Infinity;
    for (const mob of this.allMobs) {
      if (!this.isCandidate(mob)) continue;
      if (this.zoneDistancePx(mob) > engagePx) continue;
      if (!this.canNotice(mob)) continue;
      if (!this.onMySideOfTheWall(mob)) continue;
      let score = Math.hypot(mob.x - this.x, mob.y - this.y);
      if (this.isHuntingMe(mob)) score -= ATTACKER_PREFERENCE_TILES * TILE_SIZE;
      const gate = this.gateCentre;
      if (this.profile.guardsGate && gate !== null) {
        const fromGate = Math.hypot(mob.x - gate.x, mob.y - gate.y);
        if (fromGate <= GATE_NEAR_TILES * TILE_SIZE) score -= GATE_PREFERENCE_TILES * TILE_SIZE;
      }
      if (score < bestScore) {
        bestScore = score;
        best = mob;
      }
    }
    if (best !== null) {
      this.engaged = best;
      this.engagedFreshThisFrame = true;
      prewarmRatkinSoldierFight(this.soldierId);
    }
    return best;
  }

  private dropFight(): void {
    this.engaged = null;
    this.strikeTick = -1;
    this.strikeTarget = null;
  }

  // ── Fighting ─────────────────────────────────────────────────────────────

  private get reachPx(): number {
    return this.profile.reachTiles * TILE_SIZE;
  }

  private fight(foe: Mob): void {
    this.lastSeenHostile = { x: foe.x, y: foe.y };
    this.lastSeenFrames = LAST_SEEN_FACING_FRAMES;
    const distance = Math.hypot(foe.x - this.x, foe.y - this.y);
    if (distance > this.reachPx) {
      this.updateLastKnown(foe);
      this.followTargetAStar(this.lastKnownTargetX, this.lastKnownTargetY, this.speed, 0);
      return;
    }
    this.isMoving = false;
    this.faceToward(foe);
    if (this.attackCooldown > 0 || !this.hasLOS(foe)) return;
    this.strikeTick = 0;
    this.strikeTarget = foe;
    this.strikeFacingX = this.facingX;
    this.strikeFacingY = this.facingY;
  }

  /** The tick of the thrust on which the spear lands: the row's own impact frame. */
  private impactTick(): number {
    const state = ratkinCastStateFor('strike', this.strikeFacingX, this.strikeFacingY);
    const rowFrames =
      ratkinCastRow(this.soldierId, state)?.frameCount ?? FALLBACK_STRIKE_ROW_FRAMES;
    const impactFrame =
      ratkinCastEventFrame(
        this.soldierId,
        'strike',
        this.strikeFacingX,
        this.strikeFacingY,
        'impact',
      ) ?? FALLBACK_IMPACT_FRAME;
    return Math.ceil((impactFrame / rowFrames) * STRIKE_FRAMES);
  }

  private advanceStrike(): void {
    this.isMoving = false;
    this.facingX = this.strikeFacingX;
    this.facingY = this.strikeFacingY;
    if (this.strikeTick === this.impactTick()) this.landThrust();
    this.strikeTick++;
    if (this.strikeTick >= STRIKE_FRAMES) {
      this.strikeTick = -1;
      this.strikeTarget = null;
      this.attackCooldown = this.scaledCooldownFrames(SOLDIER_ATTACK_COOLDOWN_FRAMES);
    }
  }

  /** The thrust lands on its drawn impact frame, on whoever is still in reach of it. */
  private landThrust(): void {
    const target = this.strikeTarget;
    if (!target?.isAlive) return;
    const distance = Math.hypot(target.x - this.x, target.y - this.y);
    if (distance > this.reachPx * STRIKE_REACH_SLACK) return;
    const rally = this.rallyFramesLeft > 0 ? RALLY_DAMAGE_MULTIPLIER : 1;
    const damage = this.scaledDamage(SOLDIER_BASE_DAMAGE * this.profile.damageScale * rally);
    target.takeDamageFrom(damage, this, 'melee');
    // Struck by a soldier, it fights the soldier rather than whoever it was after.
    target.retaliateMob = this;
    this.attackSoundPending = true;
    if (target.hp <= 0) this.killsLanded++;
  }

  // ── Duty movement ────────────────────────────────────────────────────────

  private doDuty(): void {
    const duty = this.duty;
    switch (duty.kind) {
      case 'stand':
        this.stand(duty.anchor, duty.outward);
        return;
      case 'follow':
        this.follow(duty.owner);
        return;
      case 'patrol':
        this.walkRoute(duty.route);
        return;
    }
  }

  private stand(anchor: TilePoint, outward: { readonly x: number; readonly y: number }): void {
    const at = tileCentrePx(anchor);
    const distance = Math.hypot(at.x - this.x, at.y - this.y);
    if (distance > STAND_RETURN_TILES * TILE_SIZE) this.returningToStand = true;
    if (this.returningToStand && distance > STAND_ARRIVAL_PX) {
      const leg = tileCentrePx(this.legToward(anchor));
      this.followTargetAStar(leg.x, leg.y, this.speed, 0);
      return;
    }
    this.returningToStand = false;
    this.isMoving = false;
    const seen = this.lastSeenHostile;
    if (seen !== null && this.lastSeenFrames > 0) {
      this.faceToward(seen);
    } else {
      this.facingX = outward.x;
      this.facingY = outward.y;
    }
  }

  private follow(owner: Player): void {
    if (this.restsAgainstParty(owner, this.party)) {
      this.followingOwner = false;
      this.isMoving = false;
      return;
    }
    const distance = Math.hypot(owner.x - this.x, owner.y - this.y);
    const stopPx = FOLLOW_STOP_TILES * TILE_SIZE;
    if (distance > FOLLOW_START_TILES * TILE_SIZE) this.followingOwner = true;
    else if (distance <= stopPx) this.followingOwner = false;
    if (this.followingOwner) {
      const catchUpSpeed = Math.max(this.speed, PLAYER_SPEED * FOLLOW_CATCH_UP_PACE_OF_CRAWLER);
      this.followTargetAStar(owner.x, owner.y, catchUpSpeed, stopPx);
    } else {
      this.isMoving = false;
    }
  }

  private nearestWaypointIndex(route: readonly TilePoint[]): number {
    let best = 0;
    let bestDistance = Infinity;
    route.forEach((tile, index) => {
      const at = tileCentrePx(tile);
      const distance = Math.hypot(at.x - this.x, at.y - this.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  }

  private walkRoute(route: readonly TilePoint[]): void {
    if (route.length === 0) {
      this.isMoving = false;
      return;
    }
    const index = this.routeIndex % route.length;
    const at = tileCentrePx(route[index]);
    if (Math.hypot(at.x - this.x, at.y - this.y) <= WAYPOINT_ARRIVAL_TILES * TILE_SIZE) {
      this.routeIndex = (index + 1) % route.length;
      if (this.routeIndex === 0) this.loopsCompleted++;
      return;
    }
    const leg = tileCentrePx(this.legToward(route[index]));
    this.followTargetAStar(leg.x, leg.y, this.speed * PATROL_PACE, 0);
  }

  /**
   * The next place to walk to on the way to `goal`: the goal itself, unless
   * the palisade stands between them, in which case the near side of the
   * gate and then its far side. A route round the whole palisade is longer
   * than a path search will look, and a soldier left to steer straight at
   * the goal walks into the wall and stays there.
   */
  private legToward(goal: TilePoint): TilePoint {
    const gate = this.gateRoute;
    const bounds = this.villageBounds;
    if (gate === null || bounds === null) return goal;
    const here = this.tile;
    const hereInside = rectHolds(bounds, here);
    if (hereInside === rectHolds(bounds, goal)) return goal;
    const nearSide = hereInside ? gate.inside : gate.outside;
    const farSide = hereInside ? gate.outside : gate.inside;
    const atNearSide =
      Math.hypot(nearSide.x - here.x, nearSide.y - here.y) <= GATE_LEG_ARRIVAL_TILES;
    return atNearSide ? farSide : nearSide;
  }

  // ── Drawing ──────────────────────────────────────────────────────────────

  private drawAction(): { action: RatkinCastAction; progress: number } {
    if (this.downed)
      return { action: 'down', progress: Math.min(1, this.downedFrames / DOWN_FRAMES) };
    if (this.risingFramesLeft > 0) {
      return { action: 'rise', progress: 1 - this.risingFramesLeft / RISE_FRAMES };
    }
    if (this.strikeTick >= 0)
      return { action: 'strike', progress: this.strikeTick / STRIKE_FRAMES };
    if (this.hurtFramesLeft > 0) {
      return { action: 'hurt', progress: 1 - this.hurtFramesLeft / HURT_FRAMES };
    }
    if (this.talkPartner !== null) return { action: 'talk', progress: 0 };
    if (this.isMoving) return { action: 'walk', progress: 0 };
    return { action: 'idle', progress: 0 };
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    const sx = this.x - camX;
    const sy = this.y - camY;
    const { action, progress } = this.drawAction();
    const heading =
      this.facingX === 0 && this.facingY === 0
        ? { x: 0, y: 1 }
        : normalize(this.facingX, this.facingY);
    drawRatkinCastSprite(ctx, this.soldierId, sx, sy, tileSize, {
      action,
      walkPhase: this.walkPhase,
      facingX: heading.x,
      facingY: heading.y,
      progress,
      loopOffsetSeconds: this.animClockOffsetSeconds,
    });
    if (this.downed) {
      this.renderKnockedOutOverlay(ctx, sx, sy);
      return;
    }
    this.renderMobHealthBar(ctx, sx, sy);
  }

  /** Each soldier breathes on its own beat rather than all four in lockstep. */
  private get animClockOffsetSeconds(): number {
    return SOLDIER_LOOP_OFFSETS_SECONDS[this.soldierId];
  }
}

const SOLDIER_LOOP_OFFSETS_SECONDS: Readonly<Record<RatkinSoldierId, number>> = {
  sedge: 0,
  hobb: 0.37,
  marta: 0.71,
  pru: 0.53,
};
