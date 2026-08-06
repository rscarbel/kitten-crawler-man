import { Mob } from './Mob';
import type { LootDrop } from './Mob';
import type { Player } from '../Player';
import { randomInt } from '../utils';
import { drawDangerCircle } from '../sprites/dangerTelegraph';
import { maybeDropSkillBook } from './skillBookDrop';
import {
  DARK_KNIGHT_BODY_PART_KEY,
  darkKnightAttackFrames,
  darkKnightImpactProgress,
  drawDarkKnightSprite,
  type DarkKnightAttack,
} from '../sprites/darkKnightSprite';

const KNIGHT_HP = 900;
const KNIGHT_SPEED = 1.05;
const KNIGHT_MASS = 5;
const AGGRO_RANGE_TILES = 11;

/** Reach of the off-hand jab: about a tile past his own edge. */
const PUNCH_RANGE_TILES = 1.5;
/**
 * How far in front of himself the mace comes down, in tiles.
 *
 * A man swinging a mace at the floor can only hit the floor he can reach. This
 * used to be a 5.5-tile *targeting* range — the slam was aimed at wherever the
 * player was standing and detonated there, which read as a shockwave he never
 * animates and made backing off no defence at all. Now the impact point is a
 * fixed step along his own facing, locked at the start of the wind-up: stepping
 * out of the circle is still the dodge, but the circle is somewhere his arms go.
 */
const SLAM_REACH_TILES = 1.4;
/** Radius of the slam's impact disc, and of the circle drawn on the ground. */
export const SLAM_RADIUS_TILES = 1.6;
/**
 * Furthest a player can be and still be worth slamming at: the impact point's
 * own reach plus the disc around it. Derived rather than given its own number so
 * it cannot drift out of agreement with where the mace actually lands.
 */
const SLAM_ENGAGE_RANGE_TILES = SLAM_REACH_TILES + SLAM_RADIUS_TILES;
/** The sweep catches anything inside this, centred on the knight. */
export const SWEEP_RADIUS_TILES = 2.2;

/**
 * Windup lengths, in frames at 60 fps. Both are long enough to read the red
 * circle and walk out of it — that reading time *is* the counter-play, so these
 * are the two numbers to retune if the fight feels unfair rather than tense.
 */
const SLAM_WINDUP_FRAMES = 70;
const SWEEP_WINDUP_FRAMES = 55;
/** How long the strike itself plays before the knight can act again. */
const SLAM_EXECUTE_FRAMES = 26;
const SWEEP_EXECUTE_FRAMES = 22;
/**
 * Game frames each sprite frame of the jab is held for. Played one-to-one the
 * whole attack is eight frames — an eighth of a second, which is a flicker
 * rather than a punch. Under twenty total, so it still reads as the snappy
 * filler it is meant to be.
 */
const PUNCH_GAME_FRAMES_PER_SPRITE_FRAME = 2.4;

/**
 * How far a player travels in one frame, for sizing the jab's resolve range.
 * Duplicating the constant rather than importing `PLAYER_SPEED` keeps this
 * file's dependency on the player to the `Player` type alone.
 */
const PLAYER_WALK_PX_PER_FRAME = 2.5;

/**
 * How long the jab's wind-back and its recovery run for, as shares of the
 * sprite row. Split at the row's own impact frame rather than given fixed
 * lengths, so a re-bake that changes the row's length cannot leave the blow
 * landing on a frame where the fist is somewhere else.
 *
 * The wind-back is *not* a dodge window — a fifth of a second at most, and the
 * jab is undodgeable by construction. It exists so the animation plays its
 * whole arc instead of popping straight to the connect pose.
 */
function punchTiming(): { windup: number; execute: number } {
  const gameFrames = darkKnightAttackFrames('punch') * PUNCH_GAME_FRAMES_PER_SPRITE_FRAME;
  const impact = darkKnightImpactProgress('punch');
  const windup = Math.max(1, Math.round(gameFrames * impact));
  return { windup, execute: Math.max(1, Math.round(gameFrames) - windup) };
}

/**
 * Game frames each sprite frame of the jab is held for. Played one-to-one the
 * whole attack is eight frames — an eighth of a second, which is a flicker
 * rather than a punch. Under twenty total, so it still reads as the snappy
 * filler it is meant to be.
 */
const COOLDOWN_MIN_FRAMES = 34;
const COOLDOWN_MAX_FRAMES = 60;
/** Frames after a special before the punch is allowed to fill the gap. */
const PUNCH_COOLDOWN_FRAMES = 42;
/**
 * Frames of pursuit before a special may be rolled. Without it he can open an
 * engagement mid-windup, which reads as being ambushed rather than telegraphed.
 */
const MIN_PURSUIT_FRAMES = 45;
const SPECIAL_CHANCE_PER_FRAME = 0.05;
/**
 * How often the sweep wins when both specials are legal. Under 1 on purpose:
 * a slam at close range is still dodgeable — its point is locked for seventy
 * frames, so walking off it is exactly as available as backing out of the ring.
 */
const SWEEP_SHARE_INSIDE_RING = 0.6;

/**
 * The two ground attacks are priced as punishment for ignoring a warning that
 * sat on the floor for most of a second: a share of the victim's own max HP,
 * which keeps them lethal against Donut's fixed HP and against a Carl who has
 * poured everything into constitution.
 *
 * **These go through `dealPreScaledDamage`, not `dealDamage`.** A share of the
 * target's max HP already scales with the party; running it through the mob
 * level multiplier as well made a level-15 mark's slam land for 228% of the
 * player's health bar — a telegraphed attack that killed from full whether or
 * not it was the first thing he did. That double-scaling, not these fractions,
 * was why the fight was unsurvivable.
 */
const SLAM_HP_FRACTION = 0.4;
const SWEEP_HP_FRACTION = 0.18;
/** Flat damage on top, which *is* level-scaled — it is a mace, not a percentage. */
const SLAM_BONUS_DAMAGE = 5;
const SWEEP_BONUS_DAMAGE = 4;
/** The jab is chip damage — unavoidable, so it must never be a burst. */
const PUNCH_DAMAGE = 4;

/**
 * The bolt volley: mace raised overhead, green fire coming off it.
 *
 * It exists because the slam stopped being a ranged attack. With the mace
 * landing where his arms reach, a player who simply backed off was fighting a
 * boss with no answer at all — the whole fight became "stand outside two tiles".
 * The volley is that answer, and it is deliberately the *only* thing he does at
 * range, so closing the distance is still the way to change the terms.
 *
 * Two a second for six, then six seconds of cooling. The overheat is the whole
 * window: it is when a player crosses the ground the bolts were denying them,
 * and at six seconds that is a real crossing rather than a hurried step.
 */
const BOLT_INTERVAL_FRAMES = 30;
const BOLTS_PER_VOLLEY = 6;
const BOLT_OVERHEAT_FRAMES = 360;
/** Chip damage per bolt, level-scaled, matching the jab. Six of them is the threat. */
const BOLT_DAMAGE = 4;
/**
 * How far into the raise the first bolt leaves. The mace has to be up before
 * anything comes off it, and the slam row this borrows reaches its apex at its
 * own impact frame.
 */
const BOLT_RAISE_FRAMES = 26;
/**
 * The band he will open a volley in. Nearer than the floor and he should be
 * swinging; past the ceiling he cannot see well enough to aim, and it is his own
 * aggro range that decides whether the fight is happening at all.
 */
const BOLT_MIN_RANGE_TILES = 2.6;
const BOLT_MAX_RANGE_TILES = 10;
/** Height up the knight's body that a bolt leaves from, in tiles — the mace head. */
const BOLT_ORIGIN_LIFT_TILES = 1.15;
/**
 * How far through the borrowed slam row the cast pose sits. Held rather than
 * played on: the row's later frames bring the mace *down*, which is the one
 * thing this attack must not look like it is doing.
 */
const CAST_POSE_PROGRESS = 0.5;

const SLAM_BLOCK_XP = 10;
const SWEEP_BLOCK_XP = 8;

const COIN_DROP_MIN = 70;
const COIN_DROP_MAX = 130;
const KNIGHT_XP_VALUE = 1600;

/** Mob level at which the loot table steps up a tier. */
const LOOT_TIER_TWO_LEVEL = 6;
const LOOT_TIER_THREE_LEVEL = 12;

/**
 * How far the art overhangs his own tile. Measured off the baked sheet: the
 * cell is 164×204 px against a 64 px tile with the anchor 134 px down, so the
 * art reaches ~2.1 tiles above the tile and ~0.8 to either side. Without this a
 * knight mid-slam pops in at the screen edge with his mace already visible.
 */
const KNIGHT_CULL_MARGIN_TILES = 2.2;

/** Offset from a tile's origin to its centre, as a fraction of a tile. */
const TILE_CENTER = 0.5;

type KnightState = 'idle' | 'pursuing' | DarkKnightAttack | 'cast' | 'cooldown';
type AttackPhase = 'windup' | 'execute';

/** One bolt handed to `KnightMissileSystem` on the frame it is released. */
export interface PendingKnightMissile {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly damage: number;
  readonly mobType: string;
}

/** Attack type recorded on a bolt's damage, for the death screen. */
export const KNIGHT_MISSILE_ATTACK_TYPE = 'boltVolley';

/** Shared empty result, so an idle knight's drain allocates nothing. */
const EMPTY_MISSILES: readonly PendingKnightMissile[] = [];

/** Windup and execute lengths for each attack, in frames. */
function attackTiming(attack: DarkKnightAttack): { windup: number; execute: number } {
  if (attack === 'slam') return { windup: SLAM_WINDUP_FRAMES, execute: SLAM_EXECUTE_FRAMES };
  if (attack === 'sweep') return { windup: SWEEP_WINDUP_FRAMES, execute: SWEEP_EXECUTE_FRAMES };
  return punchTiming();
}

/** How far into the wind-up the circle starts fading in, as a share of it. */
const TELEGRAPH_FADE_IN = 0.12;
/** How much of the wind-up the fade-in takes, from that point. */
const TELEGRAPH_FADE_SPAN = 0.45;

/**
 * The ground circle's opacity at a given point through a wind-up, or null while
 * nothing should be drawn.
 *
 * Exported because the `?darkknight` harness exists to answer "has the circle
 * faded up by the time the mace is overhead", and it can only answer that about
 * the schedule the game actually runs. A second copy of this curve in the
 * preview scene would drift the moment either number was retuned — which is the
 * same argument that file already makes for reading frame counts off the sheet.
 */
export function darkKnightTelegraphFade(windupProgress: number): number | null {
  if (windupProgress < TELEGRAPH_FADE_IN) return null;
  return Math.min((windupProgress - TELEGRAPH_FADE_IN) / TELEGRAPH_FADE_SPAN, 1);
}

/**
 * The Dark Knight — a bounty target in blackened plate with a flanged mace.
 *
 * Its shape is the Grotesque Spider's: a state machine whose specials run a
 * telegraphed windup and then an execute, with the damage resolved on the
 * transition between them. The two differences that matter are that the slam
 * **locks its impact point at the start of the windup** — that lock is the
 * dodge, and a point that tracked the player would make the telegraph
 * decorative — and that the punch is deliberately undodgeable, so it has no
 * telegraph and no windup to match.
 */
export class DarkKnight extends Mob {
  readonly xpValue = KNIGHT_XP_VALUE;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'Dark Knight';
  description = 'A silent thing in blackened plate. The mace is the whole conversation.';
  override readonly audioTag = 'dark_knight';
  override readonly bodyPartKey = DARK_KNIGHT_BODY_PART_KEY;
  mass = KNIGHT_MASS;

  /**
   * Set on the frame either special's wind-up begins. Both start with the mace
   * going round — the sweep whirls it level, the slam hauls it overhead — so
   * they share one cue rather than pretending only the sweep makes a noise.
   */
  whirlSoundPending = false;
  slamSoundPending = false;
  sweepHitSoundPending = false;

  /**
   * Set on the frame the mace starts coming up for a volley. Separate from
   * {@link whirlSoundPending} because a raise that ends in green fire has to
   * announce itself as something other than a physical swing — it is the only
   * warning the player gets before bolts start crossing the room.
   */
  volleyWindupSoundPending = false;

  private state: KnightState = 'idle';
  private attackPhase: AttackPhase = 'windup';
  private windupTimer = 0;
  private windupTotal = 1;
  private executeTimer = 0;
  private executeTotal = 1;
  private cooldownTimer = 0;
  private punchCooldown = 0;
  private pursuitTimer = 0;
  /**
   * Where the slam will land, in world pixels, chosen when the wind-up starts
   * and never revised. Null outside a slam.
   */
  private slamPoint: { x: number; y: number } | null = null;
  /** Who the jab was aimed at. Null outside a punch. */
  private punchTarget: Player | null = null;

  /** Frames until the next bolt of the volley in progress. */
  private boltTimer = 0;
  /** Bolts already fired in the volley in progress. */
  private boltsFired = 0;
  /** Frames left of the overheat; nothing may be cast while this is running. */
  private overheatTimer = 0;
  /** Bolts released this frame, drained by {@link takePendingMissiles}. */
  private pendingMissiles: PendingKnightMissile[] = [];
  /** Raised on the frame a bolt leaves the mace; the scene plays the cue. */
  castSoundPending = false;
  /** Raised on the frame the volley overheats. */
  overheatSoundPending = false;

  private readonly aggroRangePx: number;
  private isAggro = false;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, KNIGHT_HP, KNIGHT_SPEED);
    this.aggroRangePx = tileSize * AGGRO_RANGE_TILES;
  }

  override get cullMarginTiles(): number {
    return KNIGHT_CULL_MARGIN_TILES;
  }

  /**
   * The sweep ring is wider than his own tile, so the status-effect silhouette
   * composite would otherwise slice it into a square for the whole of a burn —
   * taking away the "don't stand here" edge at the moment it is needed most.
   */
  protected override get silhouetteMarginTiles(): number {
    return Math.max(super.silhouetteMarginTiles, SWEEP_RADIUS_TILES);
  }

  /** He telegraphs, so he must keep thinking while the party is off-screen. */
  override get requiresEvasion(): boolean {
    return true;
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.state = 'idle';
    this.attackPhase = 'windup';
    this.windupTimer = 0;
    this.executeTimer = 0;
    this.cooldownTimer = 0;
    this.punchCooldown = 0;
    this.pursuitTimer = 0;
    this.slamPoint = null;
    this.punchTarget = null;
    this.whirlSoundPending = false;
    this.slamSoundPending = false;
    this.sweepHitSoundPending = false;
    this.volleyWindupSoundPending = false;
    this.boltTimer = 0;
    this.boltsFired = 0;
    this.overheatTimer = 0;
    this.pendingMissiles = [];
    this.castSoundPending = false;
    this.overheatSoundPending = false;
    this.isAggro = false;
  }

  /**
   * Hands over every bolt released since the last call and clears the queue.
   *
   * Drained rather than read so a bolt cannot be processed twice, and so a
   * knight killed on the frame he released one still gets it into the air —
   * `KnightMissileSystem` owns it from here, because a projectile stored on a
   * mob is deleted mid-flight the moment that mob dies.
   */
  takePendingMissiles(): readonly PendingKnightMissile[] {
    if (this.pendingMissiles.length === 0) return EMPTY_MISSILES;
    const missiles = this.pendingMissiles;
    this.pendingMissiles = [];
    return missiles;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;
    if (this.punchCooldown > 0) this.punchCooldown--;
    // Ticked here rather than inside the cast, so the mace keeps cooling while
    // he closes, swings and recovers. Cooling only while standing still would
    // make the overheat a pause he takes rather than a cost he pays.
    if (this.overheatTimer > 0) this.overheatTimer--;

    const nearest = this.acquireTarget(targets, this.aggroRangePx);
    this.currentTarget = nearest;
    this.isAggro = nearest !== null;

    switch (this.state) {
      case 'idle':
      case 'pursuing':
        this.doPursuing(nearest);
        break;
      case 'slam':
      case 'sweep':
      case 'punch':
        this.doAttack(this.state, nearest, targets);
        break;
      case 'cast':
        this.doCast(nearest);
        break;
      case 'cooldown':
        this.doCooldown(nearest);
        break;
    }
  }

  private doPursuing(nearest: Player | null): void {
    if (nearest === null) {
      this.state = 'idle';
      this.pursuitTimer = 0;
      this.clearAStarPath();
      // Not `doWander`: BountySystem anchors an un-aggroed encounter to its
      // site with a home point and a leash, and only this path reads them.
      this.returnHomeOrWander();
      return;
    }

    this.state = 'pursuing';
    this.updateLastKnown(nearest);
    this.pursuitTimer++;
    this.faceToward(nearest);

    const distance = this.distanceTo(nearest);
    const attack = this.chooseAttack(nearest, distance);
    if (attack !== null) {
      this.beginAttack(attack, nearest);
      return;
    }

    if (this.shouldOpenVolley(nearest, distance)) {
      this.beginVolley(nearest);
      return;
    }

    this.followTargetAStar(
      this.lastKnownTargetX,
      this.lastKnownTargetY,
      this.speed,
      this.tileSize * PUNCH_RANGE_TILES * FOLLOW_STOP_FRACTION,
    );
  }

  /**
   * Whether to raise the mace and open a volley.
   *
   * No random roll, unlike the specials: at range the volley is the only thing
   * he can do, so gating it on a per-frame chance would leave him jogging after
   * a kiting player doing nothing at all. The overheat is what paces it.
   */
  private shouldOpenVolley(target: Player, distance: number): boolean {
    if (this.overheatTimer > 0) return false;
    if (distance < this.tileSize * BOLT_MIN_RANGE_TILES) return false;
    if (distance > this.tileSize * BOLT_MAX_RANGE_TILES) return false;
    return this.hasLOS(target);
  }

  private beginVolley(target: Player): void {
    this.state = 'cast';
    this.isMoving = false;
    this.clearAStarPath();
    this.faceToward(target);
    this.boltsFired = 0;
    // The first bolt waits for the mace to actually get overhead; the rest are
    // spaced by the interval alone.
    this.boltTimer = BOLT_RAISE_FRAMES;
    this.volleyWindupSoundPending = true;
  }

  /**
   * Runs a volley: mace held up, one bolt every {@link BOLT_INTERVAL_FRAMES},
   * then the overheat.
   *
   * He keeps facing the player throughout and each bolt is aimed on the frame it
   * leaves — but at where the player *is*, not where they will be, so moving
   * across his line is what beats it.
   */
  private doCast(nearest: Player | null): void {
    this.isMoving = false;
    // Losing the target ends the volley rather than pausing it: a knight frozen
    // mid-cast waiting for someone to come back into view is a statue.
    if (nearest === null) {
      this.enterOverheat();
      return;
    }
    this.faceToward(nearest);

    if (this.boltTimer > 0) {
      this.boltTimer--;
      return;
    }
    this.releaseBolt(nearest);
    this.boltsFired++;
    if (this.boltsFired >= BOLTS_PER_VOLLEY) {
      this.enterOverheat();
      return;
    }
    this.boltTimer = BOLT_INTERVAL_FRAMES;
  }

  private enterOverheat(): void {
    this.overheatTimer = BOLT_OVERHEAT_FRAMES;
    this.overheatSoundPending = true;
    this.boltsFired = 0;
    this.boltTimer = 0;
    // Straight back to pursuing rather than into `cooldown`: the overheat is
    // already the punishment, and stacking the melee cooldown on top of it would
    // leave him inert for over three seconds.
    this.state = 'pursuing';
    this.pursuitTimer = 0;
  }

  private releaseBolt(target: Player): void {
    const fromX = this.x + this.tileSize * TILE_CENTER;
    const fromY = this.y + this.tileSize * TILE_CENTER - this.tileSize * BOLT_ORIGIN_LIFT_TILES;
    this.pendingMissiles.push({
      fromX,
      fromY,
      toX: target.x + this.tileSize * TILE_CENTER,
      toY: target.y + this.tileSize * TILE_CENTER,
      damage: this.scaledDamage(BOLT_DAMAGE),
      mobType: this.mobType,
    });
    this.castSoundPending = true;
  }

  private chooseAttack(target: Player, distance: number): DarkKnightAttack | null {
    const readyForSpecial =
      this.pursuitTimer >= MIN_PURSUIT_FRAMES && Math.random() < SPECIAL_CHANCE_PER_FRAME;
    if (readyForSpecial) {
      const canSlam = distance <= this.tileSize * SLAM_ENGAGE_RANGE_TILES && this.hasLOS(target);
      // Inside the ring both are legal and the choice is a roll. Handing the
      // sweep everything inside 2.2 tiles — which is where he stands, because
      // he pursues to punch range — meant the slam could only fire if the
      // player happened to be further out on the exact frame the roll landed.
      // A player who stood and traded would never once have seen the boss's
      // signature attack.
      if (distance <= this.tileSize * SWEEP_RADIUS_TILES) {
        if (!canSlam || Math.random() < SWEEP_SHARE_INSIDE_RING) return 'sweep';
        return 'slam';
      }
      if (canSlam) return 'slam';
    }
    // Filling the gap between specials: in arm's reach, off cooldown.
    if (distance <= this.tileSize * PUNCH_RANGE_TILES && this.punchCooldown === 0) return 'punch';
    return null;
  }

  private beginAttack(attack: DarkKnightAttack, target: Player): void {
    const timing = attackTiming(attack);
    this.state = attack;
    // Always 'windup'. An attack begun in 'execute' would never cross the
    // windup→execute boundary, and that boundary is the only place damage is
    // resolved — the whole attack would play as an animation that hurts nobody.
    this.attackPhase = 'windup';
    // Only a *special* resets it. Reset by the jab too, the counter never got
    // past 1 at melee range — he punches, cools down for longer than the punch
    // cooldown, punches again — and the special roll was never once reached.
    // The player then saw two slams on the walk-in and nothing but jabs after.
    if (attack !== 'punch') this.pursuitTimer = 0;
    this.isMoving = false;
    this.faceToward(target);
    this.windupTimer = timing.windup;
    this.windupTotal = Math.max(1, timing.windup);
    this.executeTimer = timing.execute;
    this.executeTotal = Math.max(1, timing.execute);

    if (attack === 'slam') {
      // Locked here and never revised: the point not tracking the player is the
      // whole dodge. `faceToward` ran just above, so the facing this reads is
      // already the one pointing at the target — the mace lands a step in front
      // of the knight along it, not wherever the player happens to be.
      const facingLength = Math.hypot(this.facingX, this.facingY);
      const reach = this.tileSize * SLAM_REACH_TILES;
      const stepX = facingLength === 0 ? 0 : (this.facingX / facingLength) * reach;
      const stepY = facingLength === 0 ? 0 : (this.facingY / facingLength) * reach;
      this.slamPoint = {
        x: this.x + this.tileSize * TILE_CENTER + stepX,
        y: this.y + this.tileSize * TILE_CENTER + stepY,
      };
      this.whirlSoundPending = true;
    }
    if (attack === 'sweep') this.whirlSoundPending = true;
    if (attack === 'punch') {
      this.punchCooldown = PUNCH_COOLDOWN_FRAMES;
      // Captured, not re-found at impact. The row needs eleven frames of
      // wind-back to play its arc, and a player walks nearly a tile in eleven
      // frames — re-checking range at the blow made the one attack the design
      // calls unavoidable the easiest one in the fight to avoid, while its
      // damage source still told the death screen it could not be dodged.
      this.punchTarget = target;
    }
  }

  private doAttack(attack: DarkKnightAttack, nearest: Player | null, targets: Player[]): void {
    this.isMoving = false;
    if (this.attackPhase === 'windup') {
      // He keeps facing the player through the wind-up — the mace tracks, the
      // slam's *point* does not.
      if (nearest !== null) this.faceToward(nearest);
      this.windupTimer--;
      if (this.windupTimer > 0) return;
      this.attackPhase = 'execute';
      this.resolveAttack(attack, targets);
      return;
    }
    this.executeTimer--;
    if (this.executeTimer <= 0) this.enterCooldown();
  }

  private resolveAttack(attack: DarkKnightAttack, targets: Player[]): void {
    switch (attack) {
      case 'slam':
        this.dealSlamDamage(targets);
        // `dealDamage` raises `attackSoundPending` on every connection, and for
        // this mob that flag plays the gauntlet thud. Cleared here so a mace
        // burying itself in the earth is not also a punch.
        this.attackSoundPending = false;
        this.slamSoundPending = true;
        break;
      case 'sweep':
        this.dealSweepDamage(targets);
        this.attackSoundPending = false;
        this.sweepHitSoundPending = true;
        break;
      case 'punch':
        // No cue of its own: `dealDamage`'s own `attackSoundPending` already
        // carries the gauntlet thud through the `dark_knight` arm of
        // `playMobAudioCues`.
        this.dealPunchDamage();
        break;
    }
  }

  /**
   * A ground attack's damage: an unscaled share of the victim's own health plus
   * a level-scaled flat hit from the mace itself.
   *
   * Split so the two halves scale on their own terms — see the comment on
   * {@link SLAM_HP_FRACTION} for why the share must not be scaled twice.
   */
  private groundAttackDamage(target: Player, hpFraction: number, bonus: number): number {
    return Math.ceil(target.maxHp * hpFraction) + this.scaledDamage(bonus);
  }

  private dealSlamDamage(targets: Player[]): void {
    const point = this.slamPoint;
    if (point === null) return;
    const radius = this.tileSize * SLAM_RADIUS_TILES;
    for (const target of targets) {
      if (!target.isAlive) continue;
      const cx = target.x + this.tileSize * TILE_CENTER;
      const cy = target.y + this.tileSize * TILE_CENTER;
      if (Math.hypot(cx - point.x, cy - point.y) > radius) continue;
      if (this.spells?.isPointInsideShell(cx, cy) === true) {
        this.spells.addBlockXp(SLAM_BLOCK_XP);
        continue;
      }
      this.dealPreScaledDamage(
        target,
        this.groundAttackDamage(target, SLAM_HP_FRACTION, SLAM_BONUS_DAMAGE),
        'slam',
      );
    }
  }

  private dealSweepDamage(targets: Player[]): void {
    const radius = this.tileSize * SWEEP_RADIUS_TILES;
    for (const target of targets) {
      if (!target.isAlive) continue;
      if (Math.hypot(target.x - this.x, target.y - this.y) > radius) continue;
      const cx = target.x + this.tileSize * TILE_CENTER;
      const cy = target.y + this.tileSize * TILE_CENTER;
      if (this.spells?.isPointInsideShell(cx, cy) === true) {
        this.spells.addBlockXp(SWEEP_BLOCK_XP);
        continue;
      }
      this.dealPreScaledDamage(
        target,
        this.groundAttackDamage(target, SWEEP_HP_FRACTION, SWEEP_BONUS_DAMAGE),
        'sweep',
      );
    }
  }

  /**
   * The jab. Routed through `takeDamage` rather than `dealDamage` for the one
   * thing `dealDamage` cannot express — an `undodgeable` source — which is what
   * makes this the attack that punishes hugging him between specials. The level
   * scaling and the swing sound are applied by hand to match.
   */
  private dealPunchDamage(): void {
    const target = this.punchTarget;
    this.punchTarget = null;
    if (target === null) return;
    // The swing still lands audibly even from a harmless knight; only the harm
    // is withheld. `dealDamage`'s own early-return is reproduced here because
    // this attack cannot go through it — see the note above.
    this.attackSoundPending = true;
    if (this.harmless || !target.isAlive) return;
    // A leash on how far it can follow, so a player who sprints clear of the
    // whole engagement is not hit from across the road. Sized off the wind-up:
    // anything inside the distance a player could have walked during it was in
    // reach when the fist started moving, which is when an unavoidable attack
    // becomes unavoidable.
    if (Math.hypot(target.x - this.x, target.y - this.y) > this.punchResolveRangePx()) return;
    const connected = target.takeDamage(this.scaledDamage(PUNCH_DAMAGE), {
      kind: 'mob',
      mobType: this.mobType,
      attackType: 'gauntlet',
      undodgeable: true,
    });
    if (connected) this.noteStruckPlayer(target);
  }

  private punchResolveRangePx(): number {
    return this.tileSize * PUNCH_RANGE_TILES + punchTiming().windup * PLAYER_WALK_PX_PER_FRAME;
  }

  private enterCooldown(): void {
    this.state = 'cooldown';
    this.cooldownTimer = randomInt(COOLDOWN_MIN_FRAMES, COOLDOWN_MAX_FRAMES);
    this.windupTimer = 0;
    this.executeTimer = 0;
    this.slamPoint = null;
  }

  private doCooldown(nearest: Player | null): void {
    this.isMoving = false;
    if (nearest !== null) this.faceToward(nearest);
    this.cooldownTimer--;
    if (this.cooldownTimer <= 0) this.state = nearest !== null ? 'pursuing' : 'idle';
  }

  /** The attack currently playing, or null when he is walking or standing. */
  private get activeAttack(): DarkKnightAttack | null {
    if (this.state === 'slam' || this.state === 'sweep' || this.state === 'punch')
      return this.state;
    return null;
  }

  /**
   * The attack row's 0→1 progress, mapped so the sprite's own impact frame lines
   * up with the frame the damage fired. Windup and execute have their own frame
   * counts, so a linear ramp across the pair would drift the two apart.
   */
  private get attackProgress(): number {
    const attack = this.activeAttack;
    if (attack === null) return 0;
    const impact = darkKnightImpactProgress(attack);
    if (this.attackPhase === 'windup') {
      const elapsed = (this.windupTotal - this.windupTimer) / this.windupTotal;
      return elapsed * impact;
    }
    const elapsed = (this.executeTotal - this.executeTimer) / this.executeTotal;
    return impact + elapsed * (1 - impact);
  }

  /**
   * Where in the borrowed slam row the cast sits.
   *
   * Ramps up over the raise so the mace visibly travels overhead, then holds —
   * it must not walk on into the frames that bring it down, and it must not snap
   * to the apex on frame one either.
   */
  private get castPoseProgress(): number {
    if (this.boltsFired > 0) return CAST_POSE_PROGRESS;
    const raised = (BOLT_RAISE_FRAMES - this.boltTimer) / BOLT_RAISE_FRAMES;
    return Math.min(raised, 1) * CAST_POSE_PROGRESS;
  }

  protected override rollLootItems(killer: Player | null): LootDrop['items'] {
    const items = super.rollLootItems(killer);
    // Boss-tier and level-stepped: the bounty's whole promise is that the mark
    // is worth the walk, and the coins alone do not carry that.
    items.push({ id: 'stat_boost_potion', quantity: 1 });
    items.push({ id: 'health_potion', quantity: 2 });
    if (this.mobLevel >= LOOT_TIER_TWO_LEVEL) {
      items.push({ id: 'jugg_juice', quantity: 1 });
      items.push({ id: 'speed_fizz', quantity: 1 });
    }
    if (this.mobLevel >= LOOT_TIER_THREE_LEVEL) {
      items.push({ id: 'cooldown_crisp', quantity: 1 });
      items.push({ id: 'stat_boost_potion', quantity: 1 });
    }
    // He fights with his fists as readily as his mace; the book is his to lose.
    maybeDropSkillBook(items, 'skill_book_pugilism');
    return items;
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

    // Only the sweep's ring is drawn here. It is centred on him and inside
    // `silhouetteMarginTiles`, so the status composite cannot clip it. The
    // slam's disc is somewhere else entirely and is drawn in
    // `drawWorldFeedback` — see the note there.
    this.renderSweepTelegraph(ctx, sx, sy, tileSize);
    if (this.isAggro) this.renderAggroIndicator(ctx, sx, sy, tileSize);

    ctx.save();
    if (this.damageFlash > 0) ctx.filter = 'brightness(3)';
    // The cast borrows the slam row and holds it at the raise, so the pose is a
    // slam that never comes down. Sharing the row rather than baking a new one
    // keeps the largest sheet in the game from growing for one held frame.
    const isCasting = this.state === 'cast';
    drawDarkKnightSprite(ctx, sx, sy, tileSize, {
      walkFrame: this.walkFrame,
      isMoving: this.isMoving,
      facingX: this.facingX,
      facingY: this.facingY,
      attack: isCasting ? 'slam' : this.activeAttack,
      attackProgress: isCasting
        ? this.castPoseProgress
        : this.activeAttack === null
          ? null
          : this.attackProgress,
    });
    if (this.damageFlash > 0) ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
  }

  /**
   * How far into the wind-up the ring has faded up, or null when nothing is
   * winding up. Shared by both telegraphs so they cannot drift apart.
   */
  private telegraphFade(): number | null {
    if (this.attackPhase !== 'windup') return null;
    return darkKnightTelegraphFade((this.windupTotal - this.windupTimer) / this.windupTotal);
  }

  /**
   * The sweep's ring: red ground warning in the same shape the Grotesque Spider
   * taught players to fear, centred on him at the radius the blow reaches.
   */
  private renderSweepTelegraph(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    tileSize: number,
  ): void {
    if (this.state !== 'sweep') return;
    const fade = this.telegraphFade();
    if (fade === null) return;
    drawDangerCircle(
      ctx,
      sx + tileSize * TILE_CENTER,
      sy + tileSize * TILE_CENTER,
      tileSize * SWEEP_RADIUS_TILES,
      fade,
    );
  }

  /**
   * The slam's disc, drawn **outside** the silhouette composite.
   *
   * It is anchored where the blow will land — `SLAM_REACH_TILES` in front of
   * him — not on the knight, so it cannot live in `drawSelf`: `Player.render`
   * composites `drawSelf` into a box of `silhouetteMarginTiles` whenever the
   * character is hit-flashing or carrying a status, and a disc offset past that
   * box would simply be cropped away. Mid-fight the knight is flashing
   * constantly, so the one warning the player has to read would strobe in and
   * out. Inside the composite it would also be repainted by his own status coat.
   *
   * The cost of drawing it here is that it lands over anything already drawn
   * this frame rather than under it. That is the right trade for a translucent
   * ground wash: being briefly on top of a mob is survivable, not being drawn
   * at all is not.
   */
  protected override drawWorldFeedback(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
  ): void {
    super.drawWorldFeedback(ctx, sx, sy);
    if (!this.isAlive || this.state !== 'slam') return;
    const point = this.slamPoint;
    if (point === null) return;
    const fade = this.telegraphFade();
    if (fade === null) return;
    // `sx` is `this.x - camX`, so the camera offset is recovered from it rather
    // than passed in — `drawWorldFeedback` is given screen coordinates only.
    drawDangerCircle(
      ctx,
      sx + (point.x - this.x),
      sy + (point.y - this.y),
      this.tileSize * SLAM_RADIUS_TILES,
      fade,
    );
  }
}

/** Fraction of attack range used as the follow stop distance. */
const FOLLOW_STOP_FRACTION = 0.8;
