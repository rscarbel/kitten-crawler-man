import { Mob } from './Mob';
import type { Player } from '../Player';
import type { LootDrop } from './Mob';
import {
  drawEvilClownSprite,
  EVIL_CLOWN_BODY_PART_KEY,
  EVIL_CLOWN_IDLE_LOOP_SECONDS,
  type EvilClownAnimation,
} from '../sprites/evilClownSprite';

/**
 * The Evil Clown — a bounty target, and the only member of Grimaldi's troupe
 * that was never in the show.
 *
 * He fights as a slow, heavy melee boss with one signature: every so often he
 * stops hunting, throws his head back and laughs, and then goes for a wander
 * with three gas vials in the air, lobbing them across the battlefield. The
 * vials and the clouds they leave are **not his** — `ClownGasSystem` owns them.
 * A projectile stored on a mob is deleted in mid-air the frame that mob dies,
 * and a vial already thrown does not care what happened to the clown who threw
 * it. He queues throws here and the system drains them.
 */

const EVIL_CLOWN_HP = 150;
/** Unhurried: the menace is that he does not need to run. */
const EVIL_CLOWN_SPEED = 0.85;
const AGGRO_RANGE_TILES = 11;
/** His arms hang below his knees, so he reaches further than he looks. */
const ATTACK_RANGE_TILES = 2.3;
const ATTACK_DAMAGE = 16;
/** Frames between backhands (~2.5 s at 60 fps). */
const ATTACK_COOLDOWN = 150;
/** Frames of the swipe animation; damage lands at {@link SWIPE_CONTACT_FRAME}. */
const SWIPE_FRAMES = 24;
/**
 * Frames into the swipe at which the hand crosses the target. Matched to the
 * sheet's strike beat, so the damage lands on the frame the arm is out.
 */
const SWIPE_CONTACT_FRAME = 13;
const FOLLOW_STOP_FRACTION = 0.75;

/** Frames of the laugh that tells the party the vials are coming (~1.7 s). */
const LAUGH_FRAMES = 100;
/** Frames he spends wandering and throwing (~5 s). */
const JUGGLE_FRAMES = 300;
/** Frames between vial throws while juggling (~0.8 s). */
const THROW_INTERVAL = 48;
/**
 * Radians the juggle cascade advances per frame.
 *
 * The juggling row cannot ride `walkFrame` the way the walk row does:
 * `Player` zeroes `walkFrame` the moment a mob stops, and the juggle meander
 * pauses constantly — which would snap three vials back to the start of their
 * arc every time he stood still. The cascade keeps its own clock instead, and
 * that clock never stops while he is juggling.
 *
 * The row is 8 frames, so this sets the whole cascade's period: 2π/0.1 is ~63
 * frames, a shade over a second per loop. It was 0.16 — a 0.65 s loop, nearly
 * five catches a second — which is faster than a real cascade and read as
 * flicker rather than as juggling. Slowing it much further starts to expose the
 * 8-frame row as steps; a genuinely languid juggle wants a longer row, not a
 * smaller number here.
 */
const JUGGLE_CYCLE_SPEED = 0.1;
/** Frames between juggling fits, before and after a random extra spread. */
const JUGGLE_COOLDOWN_MIN = 600;
const JUGGLE_COOLDOWN_MAX = 960;
/**
 * He will not open a juggle unless someone is inside this, in tiles.
 *
 * Deliberately wider than {@link AGGRO_RANGE_TILES}: a bounty mark carries
 * `forceAggro`, which hands `acquireTarget` a player at any distance, and the
 * whole point of the phase is that backing off does not stop it. Outside a
 * bounty the aggro range is the binding limit and the extra reach is unused.
 */
const JUGGLE_TRIGGER_RANGE_TILES = 14;

/** How far from himself a lobbed vial may land, in tiles. */
const THROW_SCATTER_TILES = 5;
/** Fraction of throws aimed at a player rather than scattered. */
const AIMED_THROW_CHANCE = 0.55;
/** Jitter added to an aimed throw, in tiles — even the aimed ones miss a little. */
const AIMED_THROW_JITTER_TILES = 1.2;
/** Damage a vial's own impact deals to anyone standing on the landing spot. */
const VIAL_IMPACT_DAMAGE = 4;
/**
 * How far above the clown's own world position the bottle leaves, in tiles.
 *
 * Measured from `this.y + tileSize * CENTER_OFFSET` — the centre of his
 * one-tile collision box — because that is what `throwVial` uses as the origin.
 * His feet are half a tile *below* that, and the rig in
 * `scripts/generate-clown-sprites.ts` holds the juggling hands 1.415 tiles above
 * his feet (`shoulderHeight` 2.036 less `EVIL_ARM_LENGTH * JUGGLE_HAND_DROP`),
 * so the offset from the collision centre is 1.415 - 0.5.
 *
 * Without it the bottle pops out of his shoes and jumps a tile and a half in one
 * frame; measured from the wrong datum it leaves from empty air above his hands.
 */
const VIAL_RELEASE_HEIGHT_TILES = 0.915;

/**
 * Boss-tier reward. The named bosses in this game run 500 (the Hoarder) to 2000
 * (the Grotesque Spider); a bounty is meant to be a strong source of XP, so it
 * sits high in that band. `scripts/verify-bounty.ts` asserts every bounty boss
 * stays inside it — three of the five originally shipped near 250, below every
 * named boss in the game and barely above a regular floor-3 mob.
 */
const EVIL_CLOWN_XP = 1400;
/** Generous, but under the Mantid's: his troupe of five drops coin of its own. */
const COIN_DROP_MIN = 110;
const COIN_DROP_MAX = 200;

/**
 * The sheet's tile sits 204 px down a 296 px frame at a 64 px tile scale, and
 * the juggled vials arc above even that.
 */
const CULL_MARGIN_TILES = 5;

const CENTER_OFFSET = 0.5;

/** Mob level at or above which the loot table steps up. */
const RICH_LOOT_LEVEL = 8;
const RICHEST_LOOT_LEVEL = 14;

/** Names the vial impact on the death screen, so it does not read as a backhand. */
export const VIAL_ATTACK_TYPE = 'vial';

/** One vial throw, as the clown hands it over. */
export interface PendingVial {
  /** Where the bottle leaves his hand, in world pixels. */
  readonly fromX: number;
  readonly fromY: number;
  /** Where it is meant to land, in world pixels. */
  readonly toX: number;
  readonly toY: number;
  /** Screen-space height the bottle starts at, so it leaves his hands. */
  readonly releaseHeightPx: number;
  /** Impact damage, already scaled for the mob's level. */
  readonly damage: number;
  /** Class name of the clown that threw it, so the death screen can name it. */
  readonly mobType: string;
}

const EMPTY_VIALS: readonly PendingVial[] = [];

type ClownPhase = 'hunting' | 'laughing' | 'juggling';

export class EvilClown extends Mob {
  readonly xpValue = EVIL_CLOWN_XP;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'the Evil Clown';
  description = 'A clown the size of a doorway, juggling bottles of something green.';
  override readonly audioTag = 'evil_clown';
  override readonly bodyPartKey = EVIL_CLOWN_BODY_PART_KEY;

  override get cullMarginTiles(): number {
    return CULL_MARGIN_TILES;
  }

  /**
   * The companion keeps its distance while he is juggling — that is the phase
   * that fills the ground with gas, and a follower that only avoids clouds
   * already on the floor walks straight under the next bottle.
   */
  override get requiresEvasion(): boolean {
    return this.phase === 'juggling';
  }

  /** Staggers his idle loop so a troupe of clowns does not breathe as one. */
  private readonly idlePhaseOffsetSeconds = Math.random() * EVIL_CLOWN_IDLE_LOOP_SECONDS;

  private phase: ClownPhase = 'hunting';
  private attackCooldown = 0;
  private swipeTimer = 0;
  private swipeConnected = false;
  private phaseTimer = 0;
  private throwTimer = 0;
  private juggleCycle = 0;
  private juggleCooldown = randomJuggleCooldown();
  private isAggro = false;
  private pendingVials: PendingVial[] = [];

  override clearAirborneAttacks(): void {
    this.pendingVials = [];
  }

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, EVIL_CLOWN_HP, EVIL_CLOWN_SPEED);
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.phase = 'hunting';
    this.attackCooldown = 0;
    this.swipeTimer = 0;
    this.swipeConnected = false;
    this.phaseTimer = 0;
    this.throwTimer = 0;
    this.juggleCycle = 0;
    this.juggleCooldown = randomJuggleCooldown();
    this.isAggro = false;
    this.pendingVials = [];
  }

  /**
   * Hands every queued throw to `ClownGasSystem` and clears the queue.
   *
   * Drained rather than read so a throw cannot be processed twice, and so a
   * clown killed on the frame he released a bottle still gets that bottle into
   * the air.
   */
  takePendingVials(): readonly PendingVial[] {
    if (this.pendingVials.length === 0) return EMPTY_VIALS;
    const vials = this.pendingVials;
    this.pendingVials = [];
    return vials;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.juggleCooldown > 0) this.juggleCooldown--;

    const aggroRangePx = this.tileSize * AGGRO_RANGE_TILES;
    const nearest = this.acquireTarget(targets, aggroRangePx);
    this.currentTarget = nearest;

    if (this.phase !== 'hunting') {
      this.updateJuggleCycle(nearest);
      return;
    }

    if (!nearest) {
      this.isAggro = false;
      this.swipeTimer = 0;
      this.clearAStarPath();
      // Not plain `doWander`: BountySystem anchors an un-aggroed encounter to
      // its site with `homePoint`/`leashRadiusTiles`, and only this consults
      // them. Without it the mark drifts off the site the player was sent to.
      this.returnHomeOrWander();
      return;
    }

    this.isAggro = true;
    this.updateLastKnown(nearest);

    if (this.shouldStartJuggling(nearest)) {
      this.beginLaugh();
      return;
    }

    const attackRangePx = this.tileSize * ATTACK_RANGE_TILES;
    const nearestDist = this.distanceTo(nearest);

    if (this.swipeTimer > 0) {
      this.isMoving = false;
      this.advanceSwipe(nearest, attackRangePx);
      return;
    }

    if (nearestDist > attackRangePx) {
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        attackRangePx * FOLLOW_STOP_FRACTION,
      );
    } else {
      this.isMoving = false;
    }

    // The swipe is stationary, so nothing else would ever point it at anything.
    // Only while stopped, though: overriding the facing a path step just set
    // makes him crab sideways for the whole of any detour round an obstacle.
    if (!this.isMoving) this.faceToward(nearest);

    if (
      nearestDist <= attackRangePx &&
      this.attackCooldown === 0 &&
      (this.hasLOS(nearest) || this.onSameTile(nearest))
    ) {
      this.swipeTimer = SWIPE_FRAMES;
      this.swipeConnected = false;
      this.attackCooldown = ATTACK_COOLDOWN;
    }
  }

  /** True when the juggle is off cooldown and there is someone to throw at. */
  private shouldStartJuggling(target: Player): boolean {
    if (this.juggleCooldown > 0 || this.swipeTimer > 0) return false;
    return this.distanceTo(target) <= this.tileSize * JUGGLE_TRIGGER_RANGE_TILES;
  }

  private beginLaugh(): void {
    this.phase = 'laughing';
    this.phaseTimer = LAUGH_FRAMES;
    this.isMoving = false;
    this.clearAStarPath();
    this.specialSoundPending = true;
  }

  /**
   * The laugh and the juggling wander.
   *
   * He deliberately does *not* chase here: the whole point of the phase is that
   * the pressure comes off the party's positioning and onto the ground.
   */
  private updateJuggleCycle(target: Player | null): void {
    this.phaseTimer--;

    if (this.phase === 'laughing') {
      this.isMoving = false;
      if (target) this.faceToward(target);
      if (this.phaseTimer <= 0) {
        this.phase = 'juggling';
        this.phaseTimer = JUGGLE_FRAMES;
        this.throwTimer = 0;
        this.juggleCycle = 0;
      }
      return;
    }

    this.juggleCycle = (this.juggleCycle + JUGGLE_CYCLE_SPEED) % (Math.PI * 2);

    // Deliberately unleashed: by now he has aggroed and BountySystem has
    // cleared his home point, and the meander is meant to spread gas across
    // wherever the fight has got to, not back where he started.
    this.doWander();

    if (this.throwTimer > 0) {
      this.throwTimer--;
    } else {
      this.throwVial(target);
      this.throwTimer = THROW_INTERVAL;
    }

    if (this.phaseTimer <= 0) {
      this.phase = 'hunting';
      this.juggleCooldown = randomJuggleCooldown();
    }
  }

  /**
   * Queues one lobbed vial.
   *
   * Some throws are aimed and some are scattered, because a boss who only ever
   * lands gas on the player's feet teaches the player to keep moving and
   * nothing else — it is the ground he did *not* aim at that turns the fight
   * into a maze.
   */
  private throwVial(target: Player | null): void {
    const scatterPx = this.tileSize * THROW_SCATTER_TILES;
    const fromX = this.x + this.tileSize * CENTER_OFFSET;
    const fromY = this.y + this.tileSize * CENTER_OFFSET;

    let toX: number;
    let toY: number;
    if (target !== null && Math.random() < AIMED_THROW_CHANCE) {
      const jitterPx = this.tileSize * AIMED_THROW_JITTER_TILES;
      const aimed = clampToDisc(
        target.x + this.tileSize * CENTER_OFFSET + (Math.random() * 2 - 1) * jitterPx,
        target.y + this.tileSize * CENTER_OFFSET + (Math.random() * 2 - 1) * jitterPx,
        fromX,
        fromY,
        scatterPx,
      );
      toX = aimed.x;
      toY = aimed.y;
    } else {
      const angle = Math.random() * Math.PI * 2;
      // Square-rooted so throws spread evenly over the disc rather than
      // clustering in the middle of it.
      const reach = scatterPx * Math.sqrt(Math.random());
      toX = fromX + Math.cos(angle) * reach;
      toY = fromY + Math.sin(angle) * reach;
    }

    this.pendingVials.push({
      fromX,
      fromY,
      toX,
      toY,
      releaseHeightPx: this.tileSize * VIAL_RELEASE_HEIGHT_TILES,
      damage: this.scaledDamage(VIAL_IMPACT_DAMAGE),
      mobType: this.mobType,
    });
    this.projectileSoundPending = true;
  }

  /** Runs the swing and lands its damage on the contact frame. */
  private advanceSwipe(target: Player, attackRangePx: number): void {
    this.swipeTimer--;
    const elapsed = SWIPE_FRAMES - this.swipeTimer;
    if (this.swipeConnected || elapsed < SWIPE_CONTACT_FRAME) return;
    this.swipeConnected = true;
    if (this.distanceTo(target) <= attackRangePx) this.dealDamage(target, ATTACK_DAMAGE);
  }

  protected override rollLootItems(killer: Player | null): LootDrop['items'] {
    const items = super.rollLootItems(killer);
    items.push({ id: 'stat_boost_potion', quantity: 1 });
    items.push({ id: 'jugg_juice', quantity: 1 });
    if (this.mobLevel >= RICH_LOOT_LEVEL) items.push({ id: 'speed_fizz', quantity: 1 });
    if (this.mobLevel >= RICHEST_LOOT_LEVEL) items.push({ id: 'cooldown_crisp', quantity: 1 });
    return items;
  }

  private animation(): EvilClownAnimation {
    if (this.phase === 'laughing') {
      return { kind: 'laugh', progress: 1 - this.phaseTimer / LAUGH_FRAMES };
    }
    if (this.phase === 'juggling') return { kind: 'juggle_walk', cycle: this.juggleCycle };
    if (this.swipeTimer > 0) {
      return { kind: 'swipe', progress: 1 - this.swipeTimer / SWIPE_FRAMES };
    }
    if (this.isMoving) return { kind: 'walk', cycle: this.walkFrame };
    return { kind: 'idle', phaseOffsetSeconds: this.idlePhaseOffsetSeconds };
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

    if (this.isAggro) {
      this.renderAggroIndicator(ctx, sx, sy, tileSize);
    }

    ctx.save();
    if (this.damageFlash > 0) {
      ctx.filter = 'brightness(3)';
    }

    drawEvilClownSprite(ctx, sx, sy, tileSize, this.facingX, this.facingY, this.animation());

    if (this.damageFlash > 0) ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
  }
}

/**
 * Pulls a point back onto a disc around (`centreX`, `centreY`).
 *
 * Aimed throws would otherwise be unbounded: `forceAggro` lets him target a
 * player most of a screen away, and a bottle lobbed that far crosses the field
 * faster than any other projectile in the game and lays its gas nowhere near
 * the fight.
 */
function clampToDisc(
  x: number,
  y: number,
  centreX: number,
  centreY: number,
  radius: number,
): { x: number; y: number } {
  const dx = x - centreX;
  const dy = y - centreY;
  const distance = Math.hypot(dx, dy);
  if (distance <= radius || distance === 0) return { x, y };
  const scale = radius / distance;
  return { x: centreX + dx * scale, y: centreY + dy * scale };
}

/** Frames until the next juggling fit, spread so the cadence never locks in. */
function randomJuggleCooldown(): number {
  return (
    JUGGLE_COOLDOWN_MIN + Math.floor(Math.random() * (JUGGLE_COOLDOWN_MAX - JUGGLE_COOLDOWN_MIN))
  );
}
