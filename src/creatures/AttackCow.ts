/**
 * The human crawler's attack cow: a war cow won at the Cloak & Dagger's wheel, who walks
 * with the party for the rest of the run.
 *
 * She is a tank, not a damage dealer. Very high health and a weak
 * headbutt: she charges whatever comes near the party, butts it with her
 * helmet, and `AttackCowSystem` turns the hostiles around her onto her
 * (`Mob.tauntedBy`), so the blows meant for the crawlers land on her hide.
 *
 * Built on `Cow`, so she keeps the village cow's lead — the latched follow band,
 * the stall detour — for walking after the human crawler, and its voice for her moos. Her
 * fight, her fall and her rest are her own, and so is her figure
 * (`attackCowFigure.ts`).
 *
 * She never dies. At zero health she goes down for a revive window like a
 * hireling; left there, she limps off a few tiles and lies down to rest, and
 * is back at full health on the next floor or the next load. What outlives
 * this object — whether the party owns her, her health, the rest — is in
 * `AttackCowState`, which `AttackCowSystem` keeps.
 */

import { crawlerName } from '../characters/characters';
import { Cow, type CowLeadBand } from './Cow';
import type { LootDrop, Mob, PlayerDamageType } from './Mob';
import type { DamageOptions, DamageSource, Player } from '../Player';
import { TILE_SIZE } from '../core/constants';
import { levelledMaxHp, scaledDamageForLevel } from './mobLevelScaling';
import { HirelingSurvival } from './mercenaries/hirelingSurvival';
import {
  drawAttackCowSprite,
  prewarmAttackCow,
  prewarmAttackCowAction,
  type AttackCowAction,
} from '../sprites/attackCowSprite';
import {
  ATTACK_COW_DOWNED_FPS,
  ATTACK_COW_DOWNED_FRAMES,
  ATTACK_COW_HEADBUTT_FPS,
  ATTACK_COW_HEADBUTT_FRAMES,
  ATTACK_COW_HEADBUTT_IMPACT_FRAME,
} from '../sprites/attackCowTiming';
import {
  COW_HAPPY_FPS,
  COW_HAPPY_FRAMES,
  COW_LIE_DOWN_FPS,
  COW_LIE_DOWN_FRAMES,
  COW_TILES_PER_TROT_CYCLE,
  COW_TILES_PER_WALK_CYCLE,
  COW_TROT_FRAMES,
  COW_WALK_FRAMES,
} from '../sprites/cowTiming';
import { figureRowInkTop } from '../sprites/figure/figureFrameCache';
import { findNearbyWalkableTile } from '../map/findWalkableTile';

const UPDATES_PER_SECOND = 60;
const TWO_PI = Math.PI * 2;
const TILE_CENTRE = 0.5;

// ── Stats ────────────────────────────────────────────────────────────────────

/** Her health at level 1, before the floor levels her. Several crawlers' worth: she is the wall. */
export const ATTACK_COW_BASE_HP = 400;
/** One headbutt at level 1. A shove with a helmet, not a kill. */
export const ATTACK_COW_HEADBUTT_DAMAGE = 4;
/**
 * Levels she gains per floor, on the shared mob curve: her health and blow
 * grow with the floor the way the creatures she stands in front of do.
 */
export const ATTACK_COW_LEVELS_PER_FLOOR = 3;
/** Heavy: a goblin bumping into her moves, she does not. */
const ATTACK_COW_MASS = 4;

/** The level she fights at on floor `floorNumber`. */
export function attackCowLevelForFloor(floorNumber: number): number {
  return 1 + Math.max(0, floorNumber - 1) * ATTACK_COW_LEVELS_PER_FLOOR;
}

/** Her maximum health on floor `floorNumber`. */
export function attackCowMaxHpForFloor(floorNumber: number): number {
  return levelledMaxHp(ATTACK_COW_BASE_HP, attackCowLevelForFloor(floorNumber));
}

// ── Movement ─────────────────────────────────────────────────────────────────

/** Pace on the lead after the human crawler: a touch under his own, so she trails rather than leads. */
const FOLLOW_SPEED = 2.3;
/** Pace closing on a target already within butting distance of a charge. */
const CLOSE_SPEED = 2;
/** The charge itself: faster than anyone she is protecting. */
const CHARGE_SPEED = 3.2;
const LIMP_SPEED = 0.6;

/**
 * The lead she walks on. Called rather than led (`ignoresBreak`), so however
 * far behind she falls she keeps coming — the system's catch-up handles the
 * rest.
 */
const ATTACK_COW_LEAD_BAND: CowLeadBand = {
  followStartTiles: 2.5,
  followStopTiles: 1.4,
  breakTiles: Infinity,
  resumeTiles: Infinity,
  speed: FOLLOW_SPEED,
  pathBudgetTiles: 40,
};

// ── Fighting ─────────────────────────────────────────────────────────────────

/** A hostile this close to her is one she goes for. */
export const ATTACK_COW_ENGAGE_RADIUS_TILES = 6;
/** ...as long as it is also this close to the human crawler: she guards him, she does not hunt. */
const ENGAGE_OWNER_RADIUS_TILES = 9;
/** Past this far from the human crawler she drops the fight and comes back. */
const LEASH_BREAK_TILES = 12;
/** A target dropped at the leash is left alone this long, or she yo-yos on the line. */
const LEASH_BAN_FRAMES = 90;
/** Further than this from her target and she breaks into a charge rather than walking up. */
const CHARGE_FROM_TILES = 2.5;
/** Close enough to swing the helmet. */
const HEADBUTT_RANGE_TILES = 1.25;
/** The blow lands if the target is still within this much of the range at impact. */
const HEADBUTT_REACH_SLACK = 1.3;
const HEADBUTT_COOLDOWN_FRAMES = 45;
/** How far a landed headbutt shoves its target, and over how many frames. */
const HEADBUTT_KNOCKBACK_TILES = 0.6;
const HEADBUTT_KNOCKBACK_FRAMES = 8;
/** The charge cry is not repeated more often than this: a moo per fight, not per target. */
const CHARGE_CRY_COOLDOWN_FRAMES = 240;
const HEADBUTT_UPDATES = Math.round(
  (ATTACK_COW_HEADBUTT_FRAMES / ATTACK_COW_HEADBUTT_FPS) * UPDATES_PER_SECOND,
);
const HEADBUTT_IMPACT_UPDATE = Math.round(
  (ATTACK_COW_HEADBUTT_IMPACT_FRAME / ATTACK_COW_HEADBUTT_FPS) * UPDATES_PER_SECOND,
);

// ── Recovery ─────────────────────────────────────────────────────────────────

/** Out of a fight this long, she starts to mend. */
const QUIET_SECONDS_BEFORE_REGEN = 8;
const QUIET_FRAMES_BEFORE_REGEN = QUIET_SECONDS_BEFORE_REGEN * UPDATES_PER_SECOND;
/** Share of her maximum mended each second once quiet. */
const REGEN_SHARE_PER_SECOND = 0.04;
/** A revive stands her up with this share of her health: enough to walk away from the fight. */
const REVIVE_HP_SHARE = 0.3;

const DOWNED_UPDATES = Math.round(
  (ATTACK_COW_DOWNED_FRAMES / ATTACK_COW_DOWNED_FPS) * UPDATES_PER_SECOND,
);
const HAPPY_UPDATES = Math.round((COW_HAPPY_FRAMES / COW_HAPPY_FPS) * UPDATES_PER_SECOND);
const LIE_DOWN_UPDATES = Math.round((COW_LIE_DOWN_FRAMES / COW_LIE_DOWN_FPS) * UPDATES_PER_SECOND);
/** How far from where she fell she limps before lying down. */
const LIMP_AWAY_TILES = 4;
const LIMP_SEARCH_TILES = 3;
/** She gives up on reaching her spot after this long and lies down where she is. */
const LIMP_MAX_SECONDS = 6;
const LIMP_MAX_UPDATES = LIMP_MAX_SECONDS * UPDATES_PER_SECOND;
const LIMP_ARRIVE_PX = 2;

/** Movement below this in an update is standing still, for the row and the stall count. */
const STILL_EPSILON_PX = 0.05;
/**
 * The health she is held at while down or out for the floor. Not zero: a body
 * at zero is dead to the mob loop, the renderer and kill resolution alike, and
 * she has to keep lying there, limping and being drawn. Every damage door is
 * shut while she is not standing, and the system records her as spent.
 */
const HELD_HP = 1;
const CLOCK_WRAP_SECONDS = 3600;

/** What she is doing, for the system and the sprite. */
export type AttackCowPhase =
  'follow' | 'fight' | 'downed' | 'reviving' | 'limping' | 'lying_down' | 'resting';

export class AttackCow extends Cow {
  /** Who she follows and guards: the human crawler. */
  owner: Player;
  /** The scene's mob list, set by the system each frame, which she picks fights from. */
  allMobs: readonly Mob[] = [];
  /** The window a crawler has to stand her back up in. Only its downed half is used. */
  readonly survival = new HirelingSurvival();
  /** Set when she breaks into a charge; drained by the mob-audio pass. */
  chargeSoundPending = false;
  /** Set when a headbutt lands; drained by the mob-audio pass. */
  headbuttSoundPending = false;
  /** Updates in a row the lead asked her to walk and she gained nothing. */
  followStallFrames = 0;

  private phaseValue: AttackCowPhase = 'follow';
  private phaseUpdates = 0;
  private target: Mob | null = null;
  private readonly bannedUntil = new Map<Mob, number>();
  private headbuttUpdate: number | null = null;
  private headbuttCooldown = 0;
  private chargeCryCooldown = 0;
  private charging = false;
  private quietFrames = 0;
  private regenFrames = 0;
  private restSpot: { x: number; y: number } | null = null;
  private frameCount = 0;
  private gait = 0;
  private steppedThisUpdate = false;
  private clock = 0;
  private readonly headbuttDamage: number;

  constructor(
    tileX: number,
    tileY: number,
    tileSize: number,
    owner: Player,
    floorNumber: number,
    startingHp: number | null,
  ) {
    super(tileX, tileY, tileSize, 'holstein', 'adult');
    this.owner = owner;
    this.creditTarget = owner;
    this.mass = ATTACK_COW_MASS;
    this.displayName = 'Attack Cow';
    this.description = `${crawlerName('human')}’s war cow. Helmet, spiked collar, and a grudge against anything near him.`;
    const level = attackCowLevelForFloor(floorNumber);
    this.setFixedMaxHp(attackCowMaxHpForFloor(floorNumber));
    this.hp = Math.max(1, Math.min(this.maxHp, Math.round(startingHp ?? this.maxHp)));
    this.headbuttDamage = scaledDamageForLevel(ATTACK_COW_HEADBUTT_DAMAGE, level);
    this.beginLead(ATTACK_COW_LEAD_BAND, owner, { ignoresBreak: true });
    prewarmAttackCow();
  }

  get phase(): AttackCowPhase {
    return this.phaseValue;
  }

  /** On her feet and in the party's fight: neither down nor walking off to rest. */
  get isStanding(): boolean {
    return (
      this.phaseValue === 'follow' || this.phaseValue === 'fight' || this.phaseValue === 'reviving'
    );
  }

  get isDowned(): boolean {
    return this.phaseValue === 'downed';
  }

  /** Limping off or lying down: out for the rest of this floor. */
  get isOutForTheFloor(): boolean {
    return (
      this.phaseValue === 'limping' ||
      this.phaseValue === 'lying_down' ||
      this.phaseValue === 'resting'
    );
  }

  /** Whether she has a fight on, for the catch-up that must not pull her out of one. */
  get isFighting(): boolean {
    return this.phaseValue === 'fight';
  }

  /** The hostile she is going for, if any. */
  get engagedTarget(): Mob | null {
    return this.target;
  }

  override get isHostile(): boolean {
    return false;
  }

  /** Walks with the party: she steps around a crawler rather than shoving her. */
  override get yieldsToParty(): boolean {
    return true;
  }

  /** The crawlers walk through her: a cow in a doorway must never wall the human in. */
  override get displacesPlayers(): boolean {
    return false;
  }

  override get exemptFromAiActivationRadius(): boolean {
    return true;
  }

  /** A party creature placed wherever the party is: a rewind removes her rather than resetting her. */
  override get resetsFullyOnCheckpoint(): boolean {
    return false;
  }

  /** The party's own blast can catch her, as it can Mongo; nothing aimed ever does. */
  protected override admitsPlayerDamage(damageType: PlayerDamageType | null): boolean {
    return damageType === 'explosion';
  }

  /** Her level is the floor's, set at construction; a spawn site has none to give her. */
  override applyMobLevel(): void {
    // Levelled from the floor in the constructor.
  }

  override rollLootDrop(_killer: Player | null): LootDrop {
    return { coins: 0, items: [] };
  }

  override takeDamage(amount: number, source?: DamageSource, options?: DamageOptions): boolean {
    if (!this.isStanding) return false;
    this.quietFrames = 0;
    return super.takeDamage(amount, source, options);
  }

  override takeDamageFrom(
    amount: number,
    attacker: Player | null,
    damageType: PlayerDamageType | null = 'melee',
  ): void {
    if (!this.isStanding) return;
    this.quietFrames = 0;
    super.takeDamageFrom(amount, attacker, damageType);
  }

  // ── Commands from the system ───────────────────────────────────────────────

  /**
   * The frame her health reached zero: down where she stands, the revive
   * window open, and every kill the blow latched undone.
   */
  goDown(): void {
    this.justDied = false;
    this.killedBy = null;
    this.killedByDealer = null;
    this.killType = null;
    this.damageTakenBy.clear();
    this.hp = HELD_HP;
    this.survival.goDown();
    this.isKnockedOut = true;
    this.reviveProgress = 0;
    this.dropTarget();
    this.clearKnockback();
    this.clearStatusEffects();
    this.isMoving = false;
    this.voicePending = 'angry';
    prewarmAttackCowAction('downed');
    prewarmAttackCowAction('happy');
    prewarmAttackCowAction('limp');
    this.enterPhase('downed');
  }

  /** One frame on the ground; see `HirelingSurvival.tickDowned`. */
  tickDowned(crawlerInReach: boolean): ReturnType<HirelingSurvival['tickDowned']> {
    const tick = this.survival.tickDowned(crawlerInReach);
    this.reviveProgress = this.survival.reviveProgress;
    return tick;
  }

  /** Stood back up by a crawler: a happy bounce, then back to work. */
  getUp(): void {
    const survivalHp = this.survival.getUp(this.maxHp);
    this.hp = Math.max(survivalHp, Math.ceil(this.maxHp * REVIVE_HP_SHARE));
    this.isKnockedOut = false;
    this.reviveProgress = 0;
    this.damageFlash = 0;
    this.quietFrames = 0;
    this.voicePending = 'happy';
    this.enterPhase('reviving');
  }

  /** Nobody came: she gets up on her own and limps off to rest for the floor. */
  limpOffToRest(): void {
    this.survival.getUp(this.maxHp);
    this.hp = HELD_HP;
    this.isKnockedOut = false;
    this.reviveProgress = 0;
    this.restSpot = this.findRestSpot();
    prewarmAttackCowAction('lie_down');
    prewarmAttackCowAction('lie');
    this.enterPhase('limping');
  }

  /** Put somewhere by anything other than her own feet: forget the route and the stall count. */
  onTeleported(): void {
    this.forceRepath();
    this.followStallFrames = 0;
    this.isMoving = false;
  }

  /** Drops the hostile she was going for, without a ban. */
  dropTarget(): void {
    this.target = null;
    this.headbuttUpdate = null;
    this.charging = false;
  }

  // ── The frame ──────────────────────────────────────────────────────────────

  override updateAI(targets: Player[]): void {
    if (!this.isAlive) return;
    this.frameCount++;
    this.phaseUpdates++;
    this.clock = (this.clock + 1 / UPDATES_PER_SECOND) % CLOCK_WRAP_SECONDS;
    if (this.headbuttCooldown > 0) this.headbuttCooldown--;
    if (this.chargeCryCooldown > 0) this.chargeCryCooldown--;
    const beforeX = this.x;
    const beforeY = this.y;

    switch (this.phaseValue) {
      case 'downed':
      case 'resting':
        this.isMoving = false;
        break;
      case 'reviving':
        this.isMoving = false;
        if (this.phaseUpdates >= HAPPY_UPDATES) this.enterPhase('follow');
        break;
      case 'limping':
        this.stepLimp();
        break;
      case 'lying_down':
        this.isMoving = false;
        if (this.phaseUpdates >= LIE_DOWN_UPDATES) this.enterPhase('resting');
        break;
      case 'follow':
      case 'fight':
        this.think(targets);
        break;
    }

    const moved = Math.hypot(this.x - beforeX, this.y - beforeY);
    this.steppedThisUpdate = moved > STILL_EPSILON_PX;
    this.turnGait(moved);
    this.tickRegen();
  }

  private think(targets: Player[]): void {
    if (this.stepOffMarkedGround(CHARGE_SPEED)) return;
    if (this.headbuttUpdate !== null) {
      this.stepHeadbutt();
      return;
    }
    const target = this.chooseTarget();
    if (target === null) {
      this.target = null;
      this.charging = false;
      this.enterPhase('follow');
      this.follow(targets);
      return;
    }
    if (target !== this.target) this.onEngage(target);
    this.target = target;
    this.enterPhase('fight');
    this.quietFrames = 0;
    this.fight(target);
  }

  /** Walks after the human crawler on the cow's lead, counting a stall the catch-up can answer. */
  private follow(targets: Player[]): void {
    const beforeX = this.x;
    const beforeY = this.y;
    super.updateAI(targets);
    const walkedNowhere = Math.hypot(this.x - beforeX, this.y - beforeY) <= STILL_EPSILON_PX;
    this.followStallFrames =
      this.isFollowingLeader && walkedNowhere ? this.followStallFrames + 1 : 0;
  }

  private onEngage(target: Mob): void {
    prewarmAttackCowAction('charge');
    prewarmAttackCowAction('headbutt');
    const tiles = this.tilesTo(target);
    this.charging = tiles > CHARGE_FROM_TILES;
    if (this.charging && this.chargeCryCooldown === 0) {
      this.chargeSoundPending = true;
      this.voicePending = 'angry';
      this.chargeCryCooldown = CHARGE_CRY_COOLDOWN_FRAMES;
    }
  }

  private fight(target: Mob): void {
    this.followStallFrames = 0;
    this.updateLastKnown(target);
    const rangePx = HEADBUTT_RANGE_TILES * TILE_SIZE;
    const distancePx = this.centreDistance(target);
    if (distancePx > rangePx) {
      const speed = this.charging ? CHARGE_SPEED : CLOSE_SPEED;
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        speed,
        rangePx * TILE_CENTRE,
      );
      return;
    }
    this.charging = false;
    this.isMoving = false;
    this.faceToward(target);
    if (this.headbuttCooldown > 0) return;
    this.headbuttUpdate = 0;
  }

  private stepHeadbutt(): void {
    const update = this.headbuttUpdate;
    if (update === null) return;
    this.isMoving = false;
    const target = this.target;
    if (target !== null && update < HEADBUTT_IMPACT_UPDATE) this.faceToward(target);
    if (update === HEADBUTT_IMPACT_UPDATE && target !== null) this.landHeadbutt(target);
    const next = update + 1;
    if (next >= HEADBUTT_UPDATES) {
      this.headbuttUpdate = null;
      this.headbuttCooldown = HEADBUTT_COOLDOWN_FRAMES;
      return;
    }
    this.headbuttUpdate = next;
  }

  /**
   * The blow, in her own name so the victim turns on her, credited to the human
   * crawler (`creditTarget`) so the kill and its XP are his.
   */
  private landHeadbutt(target: Mob): void {
    if (!target.isAlive) return;
    const reachPx = HEADBUTT_RANGE_TILES * TILE_SIZE * HEADBUTT_REACH_SLACK;
    if (this.centreDistance(target) > reachPx) return;
    target.takeDamageFrom(this.headbuttDamage, this, 'melee');
    this.headbuttSoundPending = true;
    const killed = target.hp <= 0;
    if (killed) return;
    target.retaliateMob = this;
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const length = Math.hypot(dx, dy);
    if (length > 0) {
      target.applyKnockback(
        dx / length,
        dy / length,
        HEADBUTT_KNOCKBACK_TILES * TILE_SIZE,
        HEADBUTT_KNOCKBACK_FRAMES,
      );
    }
  }

  /**
   * The hostile to go for: the one she has, while it is still worth having,
   * else the nearest she can see within her engage radius that is also near
   * the human crawler. A boss whose fight has not begun is the player's to start.
   */
  private chooseTarget(): Mob | null {
    const ownerTiles = this.tilesTo(this.owner);
    if (ownerTiles > LEASH_BREAK_TILES) {
      if (this.target !== null)
        this.bannedUntil.set(this.target, this.frameCount + LEASH_BAN_FRAMES);
      return null;
    }
    const current = this.target;
    const keepCurrent =
      current !== null &&
      this.isFightable(current) &&
      !this.isBanned(current) &&
      this.ownerTilesTo(current) <= LEASH_BREAK_TILES;
    if (keepCurrent) return current;
    let best: Mob | null = null;
    let bestTiles = Infinity;
    for (const mob of this.allMobs) {
      if (!this.isFightable(mob) || this.isBanned(mob)) continue;
      const tiles = this.tilesTo(mob);
      if (tiles > ATTACK_COW_ENGAGE_RADIUS_TILES || tiles >= bestTiles) continue;
      if (this.ownerTilesTo(mob) > ENGAGE_OWNER_RADIUS_TILES) continue;
      if (!this.canNotice(mob)) continue;
      best = mob;
      bestTiles = tiles;
    }
    return best;
  }

  private isFightable(mob: Mob): boolean {
    if (mob === this || !mob.isAlive || !mob.isHostile) return false;
    if (mob.offLimitsToAllies || mob.avoidInstead || mob.isDefendTarget === true) return false;
    return !mob.isBoss || mob.forceAggro;
  }

  private isBanned(mob: Mob): boolean {
    const until = this.bannedUntil.get(mob);
    if (until === undefined) return false;
    if (until > this.frameCount) return true;
    this.bannedUntil.delete(mob);
    return false;
  }

  // ── Resting ────────────────────────────────────────────────────────────────

  /** Open ground a few tiles away from the human crawler, beyond where she fell, to lie down on. */
  private findRestSpot(): { x: number; y: number } | null {
    const map = this.map;
    if (map === null) return null;
    const awayX = this.x - this.owner.x;
    const awayY = this.y - this.owner.y;
    const length = Math.hypot(awayX, awayY);
    const dirX = length > 0 ? awayX / length : 1;
    const dirY = length > 0 ? awayY / length : 0;
    const hereX = Math.floor((this.x + TILE_SIZE * TILE_CENTRE) / TILE_SIZE);
    const hereY = Math.floor((this.y + TILE_SIZE * TILE_CENTRE) / TILE_SIZE);
    return findNearbyWalkableTile(
      map,
      Math.round(hereX + dirX * LIMP_AWAY_TILES),
      Math.round(hereY + dirY * LIMP_AWAY_TILES),
      LIMP_SEARCH_TILES,
      (x, y) => !map.isStairwellTile(x, y),
    );
  }

  private stepLimp(): void {
    const spot = this.restSpot;
    const giveUp = this.phaseUpdates >= LIMP_MAX_UPDATES;
    if (spot === null || giveUp) {
      this.enterPhase('lying_down');
      return;
    }
    const goalX = spot.x * TILE_SIZE;
    const goalY = spot.y * TILE_SIZE;
    if (Math.hypot(goalX - this.x, goalY - this.y) <= LIMP_ARRIVE_PX) {
      this.enterPhase('lying_down');
      return;
    }
    this.followTargetAStar(goalX, goalY, LIMP_SPEED, 0);
  }

  // ── Recovery ───────────────────────────────────────────────────────────────

  private tickRegen(): void {
    if (!this.isStanding || this.phaseValue === 'fight') {
      this.regenFrames = 0;
      return;
    }
    if (this.quietFrames < QUIET_FRAMES_BEFORE_REGEN) {
      this.quietFrames++;
      return;
    }
    if (this.hp >= this.maxHp) return;
    this.regenFrames++;
    if (this.regenFrames < UPDATES_PER_SECOND) return;
    this.regenFrames = 0;
    this.hp = Math.min(this.maxHp, this.hp + Math.ceil(this.maxHp * REGEN_SHARE_PER_SECOND));
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private enterPhase(phase: AttackCowPhase): void {
    if (phase === this.phaseValue) return;
    this.phaseValue = phase;
    this.phaseUpdates = 0;
    if (phase !== 'fight') this.forceRepath();
  }

  private centreDistance(other: { readonly x: number; readonly y: number }): number {
    return Math.hypot(other.x - this.x, other.y - this.y);
  }

  private tilesTo(other: { readonly x: number; readonly y: number }): number {
    return this.centreDistance(other) / TILE_SIZE;
  }

  private ownerTilesTo(mob: Mob): number {
    return Math.hypot(mob.x - this.owner.x, mob.y - this.owner.y) / TILE_SIZE;
  }

  /**
   * The gait turns by the ground covered, capped at one row frame per update:
   * past that the row is undersampled and the legs vibrate rather than walk.
   */
  private turnGait(movedPx: number): void {
    if (movedPx <= 0) return;
    const charging = this.phaseValue === 'fight' && this.charging;
    const tilesPerCycle = charging ? COW_TILES_PER_TROT_CYCLE : COW_TILES_PER_WALK_CYCLE;
    const frames = charging ? COW_TROT_FRAMES : COW_WALK_FRAMES;
    const step = Math.min((movedPx * TWO_PI) / (tilesPerCycle * TILE_SIZE), TWO_PI / frames);
    this.gait = (this.gait + step) % TWO_PI;
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  private rowToDraw(): { action: AttackCowAction; progress: number } {
    const oneShot = (updates: number): number =>
      Math.min(1, this.phaseUpdates / Math.max(1, updates));
    switch (this.phaseValue) {
      case 'downed':
        return { action: 'downed', progress: oneShot(DOWNED_UPDATES) };
      case 'reviving':
        return { action: 'happy', progress: oneShot(HAPPY_UPDATES) };
      case 'limping':
        return { action: 'limp', progress: 0 };
      case 'lying_down':
        return { action: 'lie_down', progress: oneShot(LIE_DOWN_UPDATES) };
      case 'resting':
        return { action: 'lie', progress: 0 };
      case 'fight': {
        const update = this.headbuttUpdate;
        if (update !== null) return { action: 'headbutt', progress: update / HEADBUTT_UPDATES };
        if (!this.steppedThisUpdate) return { action: 'idle', progress: 0 };
        return { action: this.charging ? 'charge' : 'walk', progress: 0 };
      }
      case 'follow':
        return { action: this.steppedThisUpdate ? 'walk' : 'idle', progress: 0 };
    }
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
    const { action, progress } = this.rowToDraw();
    const drawnRow = drawAttackCowSprite(ctx, sx, sy, tileSize, {
      action,
      facingX: this.facingX,
      facingY: this.facingY,
      gaitPhase: this.gait,
      progress,
      clockSeconds: this.clock,
    });
    if (this.isStanding)
      this.renderMobHealthBar(ctx, sx, sy, figureRowInkTop(drawnRow, sy, tileSize));
  }
}
