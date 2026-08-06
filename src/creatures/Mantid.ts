import type { Player } from '../Player';
import { Mob, type LootDrop } from './Mob';
import {
  MANTID_BODY_PART_KEY,
  drawMantidSprite,
  mantidCullMarginTiles,
  mantidOverheadLiftTiles,
} from '../sprites/mantidSprite';
import { drawQuestMarker, QUEST_MARKER_GOLD } from '../sprites/questNPCSprite';
import { maybeDropSkillBook } from './skillBookDrop';
import { drawText } from '../ui/TextBox';
import { randomInt } from '../utils';
import { PLAYER_SPEED } from '../core/constants';

/**
 * The Mantid — a bounty target, and an enormous praying mantis.
 *
 * Baseline he is a slow, deliberate stalker who lands single raptorial strikes.
 * What makes the fight is the **rage cycle**, which he runs on a timer for as
 * long as he is engaged:
 *
 *   1. He stops dead and a gold exclamation appears over him.
 *   2. For exactly one second he is **invincible** — every hit deals zero and
 *      throws an "Immune" label off him instead.
 *   3. The instant that second ends he goes into a **three-second flurry**:
 *      both arms, a damage tick every few frames to everything in melee range,
 *      while walking the player down slightly faster than he stalks.
 *
 * The pause is the whole design. It is a full second of "get away from me"
 * during which hitting him is not merely useless but actively costs the player
 * the distance they needed — and it is deliberately readable three ways at once
 * (he stops, he rears into a pose nothing else uses, and he wears a marker),
 * because a player who misreads it takes the flurry standing still.
 */

const MANTID_HP = 700;
/** Slow: he stalks. The flurry is the only time he moves at speed. */
const MANTID_SPEED = 1.45;
/**
 * Ceiling on his walk, whatever level he spawns at.
 *
 * `applyMobLevel` multiplies speed by 8% a level, so a bounty mark at level 15
 * walked at 3.08 against the player's 2.5 — he simply ran the party down in the
 * open and the stalk became a chase nobody could break. Derived from
 * `PLAYER_SPEED` rather than written as a number so the relationship survives a
 * change to either: he is meant to be *just* faster than a walk, so that backing
 * off costs ground slowly instead of not working — 8% is about a tile every two
 * seconds, which is losing a retreat rather than never having one.
 */
const MANTID_WALK_ADVANTAGE = 1.08;
const MANTID_MAX_SPEED = PLAYER_SPEED * MANTID_WALK_ADVANTAGE;
const AGGRO_RANGE_TILES = 11;

/** Reach of a single raptorial strike, in tiles from his own tile origin. */
const SLASH_RANGE_TILES = 1.7;
/**
 * The stalking strike. Deliberately modest: the flurry is his damage, and this
 * is what he does while the player is looking for the opening to break away
 * from it. At 9 it was killing faster than the attack it exists to set up.
 */
const SLASH_DAMAGE = 5;
const SLASH_WINDUP_FRAMES = 26;
const SLASH_RECOVER_FRAMES = 20;
/** Length of one complete strike. Exported so the `?mantid` harness plays it at his tempo. */
export const MANTID_SLASH_TOTAL_FRAMES = SLASH_WINDUP_FRAMES + SLASH_RECOVER_FRAMES;
const SLASH_COOLDOWN_FRAMES = 54;

/** The invincible second before the flurry. Exactly one second at 60 fps. */
const RAGE_PAUSE_FRAMES = 60;
/** The flurry itself: three seconds. */
const FLURRY_FRAMES = 180;
/** Frames between flurry damage ticks — five hits per second of standing in it. */
const FLURRY_TICK_FRAMES = 12;
const FLURRY_TICK_DAMAGE = 5;
const FLURRY_RADIUS_TILES = 1.6;
/**
 * The `attackType` a flurry tick is tagged with.
 *
 * Exported because the death screen splits on it: being carved up by the flurry
 * is a different death from being caught by a single strike, and the melee lines
 * would tell a player they were killed by one swing of something that hit them
 * fifteen times.
 */
export const MANTID_FLURRY_ATTACK_TYPE = 'flurry';

/** Shell XP awarded for absorbing one flurry tick. Small: there are fifteen of them. */
const FLURRY_BLOCK_XP = 2;
/** He closes during the flurry rather than flailing at air. */
const FLURRY_SPEED_MULTIPLIER = 1.25;
/** How close the flurry walks in before it stops pushing, in tiles. */
const FLURRY_CLOSE_RANGE_TILES = 0.6;

/**
 * How close a player must be before a ready rage cycle actually fires, in tiles.
 *
 * Comfortably outside the flurry's own reach so he still has ground to cover on
 * it, but well inside the aggro range so the pause never burns on open field.
 */
const RAGE_TRIGGER_RANGE_TILES = 4.5;

/** Frames after a rage cycle ends before another may start: 12–20 seconds. */
const RAGE_COOLDOWN_MIN_FRAMES = 720;
const RAGE_COOLDOWN_MAX_FRAMES = 1200;
/** Frames of recovery after the flurry, during which he does nothing else. */
const POST_FLURRY_RECOVERY_FRAMES = 40;

/**
 * Frames between the stalking hisses, while a player is inside aggro range:
 * 2.5–5.5 seconds. Randomised rather than fixed so two Mantids in one encounter
 * do not lock into unison.
 */
const HISS_INTERVAL_MIN_FRAMES = 150;
const HISS_INTERVAL_MAX_FRAMES = 330;

const XP_VALUE = 1500;
const COIN_DROP_MIN = 120;
const COIN_DROP_MAX = 220;
/** A boss's mass: he is barely moved by anything shoving him. */
const MASS = 8;
/**
 * Lift and cull margin used before the sheet has loaded; the live values are
 * measured from the manifest so a rebake that resizes his cell cannot silently
 * shear him at the screen edge or detach the marker from his head.
 */
const FALLBACK_ART_HEIGHT_TILES = 2;
const FALLBACK_CULL_MARGIN_TILES = 3;

/** How close the stalk stops, as a fraction of the strike's own reach. */
const PURSUIT_STOP_RATIO = 0.85;
const CENTER_OFFSET = 0.5;

/** Mob levels at or above which the loot table steps up. */
const LOOT_TIER_TWO_LEVEL = 6;
const LOOT_TIER_THREE_LEVEL = 12;

// ── "Immune" labels ──────────────────────────────────────────────────────────

/** Frames one blocked-hit label lives for. */
const IMMUNE_LABEL_FRAMES = 40;
/** Tiles a label rises across its life. */
const IMMUNE_LABEL_RISE_TILES = 1.1;
/** Fraction of a label's life spent fully opaque before it starts fading. */
const IMMUNE_LABEL_HOLD = 0.45;
/**
 * Simultaneous labels allowed.
 *
 * The flurry provokes panic swings and the cat's missiles land in bursts, so
 * without a cap a one-second immunity can stack a dozen labels into an unreadable
 * white smear over the thing the player most needs to see.
 */
const MAX_IMMUNE_LABELS = 3;
const IMMUNE_LABEL_TEXT = 'Immune';
const IMMUNE_LABEL_SIZE = 13;
const IMMUNE_LABEL_COLOR = '#cbd5e1';
/** Sideways scatter of a label, in tiles, so repeated blocks do not overprint. */
const IMMUNE_LABEL_SPREAD_TILES = 0.35;

interface ImmuneLabel {
  /** Frames remaining. */
  life: number;
  /** Horizontal offset from the mob's centre, in tiles. */
  offsetTiles: number;
}

type MantidState = 'idle' | 'pursuing' | 'slash' | 'rage_pause' | 'flurry' | 'cooldown';

/**
 * The states whose timers only advance inside `updateAI`, and which therefore
 * freeze rather than finish if something stops that from being called.
 *
 * Listed rather than expressed as "not idle and not pursuing": a Mantid *is*
 * meant to keep pursuing while confused, and cancelling out of pursuit every
 * frame would re-roll his rage cooldown for as long as the fog held.
 */
const COMMITTED_STATES: ReadonlySet<MantidState> = new Set<MantidState>([
  'slash',
  'rage_pause',
  'flurry',
]);

export class Mantid extends Mob {
  readonly xpValue = XP_VALUE;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  override readonly audioTag = 'mantid';
  override readonly bodyPartKey = MANTID_BODY_PART_KEY;
  displayName = 'Mantid';
  description = 'A praying mantis the size of a horse, and every bit as patient.';
  mass = MASS;

  /**
   * Sized to the art *plus* the furniture above it: the "Immune" labels rise a
   * further tile past the rage marker, and a margin covering only the animal
   * clips them off at the screen edge.
   */
  override get cullMarginTiles(): number {
    return mantidCullMarginTiles('mantid', IMMUNE_LABEL_RISE_TILES, FALLBACK_CULL_MARGIN_TILES);
  }

  /**
   * The companion must break away for the whole rage cycle, not just the flurry:
   * by the time the flurry starts it is already too late to walk out of it.
   */
  override get requiresEvasion(): boolean {
    return this.state === 'rage_pause' || this.state === 'flurry';
  }

  private state: MantidState = 'idle';
  private stateTimer = 0;
  private slashLanded = false;
  private slashCooldown = 0;
  private rageCooldown = randomInt(RAGE_COOLDOWN_MIN_FRAMES, RAGE_COOLDOWN_MAX_FRAMES);
  private hissCooldown = randomInt(HISS_INTERVAL_MIN_FRAMES, HISS_INTERVAL_MAX_FRAMES);
  /**
   * The stalking hiss, drained by `playMobAudioCues`. A flag of its own rather
   * than another `specialSoundPending` arm because it fires while he walks, and
   * the rage pause can raise that flag on the very same frame.
   */
  hissSoundPending = false;
  private flurryTickTimer = 0;
  private readonly immuneLabels: ImmuneLabel[] = [];
  private readonly aggroRangePx: number;
  private readonly slashRangePx: number;
  private readonly flurryRadiusPx: number;
  private readonly rageTriggerRangePx: number;
  private isAggro = false;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, MANTID_HP, MANTID_SPEED);
    this.aggroRangePx = tileSize * AGGRO_RANGE_TILES;
    this.slashRangePx = tileSize * SLASH_RANGE_TILES;
    this.flurryRadiusPx = tileSize * FLURRY_RADIUS_TILES;
    this.rageTriggerRangePx = tileSize * RAGE_TRIGGER_RANGE_TILES;
  }

  /**
   * Levels him up, then puts the ceiling back on his walk.
   *
   * The base scaling is a flat 8% a level with nothing above it, which is fine
   * for a mob the player is meant to outrun and wrong for one whose whole design
   * is a slow stalk punctuated by a charge. Clamped after `super` rather than by
   * scaling the increment, so the flurry's own multiplier still reads off a
   * known walk speed. See {@link MANTID_MAX_SPEED}.
   */
  override applyMobLevel(level: number): void {
    super.applyMobLevel(level);
    this.speed = Math.min(this.speed, MANTID_MAX_SPEED);
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.state = 'idle';
    this.stateTimer = 0;
    this.slashLanded = false;
    this.slashCooldown = 0;
    this.rageCooldown = randomInt(RAGE_COOLDOWN_MIN_FRAMES, RAGE_COOLDOWN_MAX_FRAMES);
    this.hissCooldown = randomInt(HISS_INTERVAL_MIN_FRAMES, HISS_INTERVAL_MAX_FRAMES);
    this.hissSoundPending = false;
    this.flurryTickTimer = 0;
    this.immuneLabels.length = 0;
    this.isAggro = false;
  }

  /** True for the one second of the rage pause, and only then. */
  private get isImmune(): boolean {
    return this.state === 'rage_pause';
  }

  /**
   * Cancels a rage cycle that confusion has frozen.
   *
   * `MobUpdateLoop` skips `updateAI` entirely for a confused mob, and the rage
   * cycle's timers only advance inside it. A Mantid fogged mid-pause would
   * otherwise sit in `rage_pause` — motionless and *invincible* — for as long as
   * the fog held him, then flurry the instant it lifted. A bounty-spawned Mantid
   * is immune to the fog and never sees this, but the class is registered as an
   * ordinary spawn type too, and a boss that becomes unkillable by drinking one
   * scroll is not a thing to leave to who spawned him.
   *
   * `tickTimers` is the fix's home because it is the one per-frame hook the loop
   * runs for confused and unconfused mobs alike.
   */
  override tickTimers(): void {
    super.tickTimers();
    // Ticked here rather than in `updateAI` for the same reason: labels left on a
    // confused Mantid would hang in the air until the fog lifted.
    this.tickImmuneLabels();
    if (!this.isConfused || !COMMITTED_STATES.has(this.state)) return;
    // Any committed pose — the pause, the flurry, a strike mid-swing — is dropped
    // rather than frozen. Dropping the rage cycle is the load-bearing case; the
    // strike is here so a confused Mantid does not wander around holding a
    // half-finished swing.
    this.state = 'cooldown';
    this.stateTimer = POST_FLURRY_RECOVERY_FRAMES;
    this.slashLanded = false;
    this.flurryTickTimer = 0;
    this.rageCooldown = randomInt(RAGE_COOLDOWN_MIN_FRAMES, RAGE_COOLDOWN_MAX_FRAMES);
    // The cancelled swing still costs him its cooldown. Without this a Mantid
    // fogged mid-strike pays 40 frames instead of the usual 100 and comes out of
    // the fog swinging *faster* than one that was left alone.
    this.slashCooldown = SLASH_COOLDOWN_FRAMES;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;
    if (this.slashCooldown > 0) this.slashCooldown--;
    if (this.rageCooldown > 0) this.rageCooldown--;
    if (this.hissCooldown > 0) this.hissCooldown--;

    const nearest = this.acquireTarget(targets, this.aggroRangePx);
    this.currentTarget = nearest;
    this.isAggro = nearest !== null;

    switch (this.state) {
      case 'slash':
        this.advanceSlash(nearest);
        return;
      case 'rage_pause':
        this.advanceRagePause();
        return;
      case 'flurry':
        this.advanceFlurry(nearest, targets);
        return;
      case 'cooldown':
        this.advanceCooldown(nearest);
        return;
      case 'idle':
      case 'pursuing':
        this.advancePursuit(nearest);
        return;
    }
  }

  private advancePursuit(nearest: Player | null): void {
    if (nearest === null) {
      this.state = 'idle';
      this.clearAStarPath();
      // Not `doWander`: BountySystem anchors an un-aggroed mark to its bounty
      // site with `homePoint`, and only this path consults it.
      this.returnHomeOrWander();
      return;
    }

    this.state = 'pursuing';
    this.updateLastKnown(nearest);

    // Only while he is actually stalking someone: a hiss from an idle Mantid
    // across the map is a jump-scare with nothing behind it.
    if (this.hissCooldown === 0) {
      this.hissCooldown = randomInt(HISS_INTERVAL_MIN_FRAMES, HISS_INTERVAL_MAX_FRAMES);
      this.hissSoundPending = true;
    }

    // The rage cycle outranks the ordinary strike: a Mantid that spent its
    // window slashing would never show the player the mechanic it is built on.
    //
    // It still waits until he is close, though. The cooldown runs whether or not
    // anyone is around, so a Mantid who has been idling at his bounty site would
    // otherwise rage the instant a player crested the ridge eleven tiles away —
    // spending the whole four-second cycle on empty ground, which turns the
    // fight's centrepiece into a thing the player watches from safety.
    if (this.rageCooldown === 0 && this.distanceTo(nearest) <= this.rageTriggerRangePx) {
      this.enterRagePause();
      return;
    }

    if (this.distanceTo(nearest) <= this.slashRangePx && this.slashCooldown === 0) {
      this.state = 'slash';
      this.stateTimer = MANTID_SLASH_TOTAL_FRAMES;
      this.slashLanded = false;
      this.isMoving = false;
      this.faceToward(nearest);
      return;
    }

    this.followTargetAStar(
      this.lastKnownTargetX,
      this.lastKnownTargetY,
      this.speed,
      this.slashRangePx * PURSUIT_STOP_RATIO,
    );
    // `followTargetCollide` returns before writing facing once it is inside its
    // stop range, so a Mantid holding position would strike sideways.
    if (!this.isMoving) this.faceToward(nearest);
  }

  private advanceSlash(target: Player | null): void {
    this.stateTimer--;
    this.isMoving = false;
    if (this.stateTimer > SLASH_RECOVER_FRAMES && target !== null) this.faceToward(target);

    if (!this.slashLanded && this.stateTimer <= SLASH_RECOVER_FRAMES) {
      this.slashLanded = true;
      if (target !== null && this.distanceTo(target) <= this.slashRangePx) {
        this.dealDamage(target, SLASH_DAMAGE, 'raptorial_slash');
      }
    }
    if (this.stateTimer <= 0) {
      this.slashCooldown = SLASH_COOLDOWN_FRAMES;
      this.state = target === null ? 'idle' : 'pursuing';
    }
  }

  private enterRagePause(): void {
    this.state = 'rage_pause';
    this.stateTimer = RAGE_PAUSE_FRAMES;
    this.isMoving = false;
    this.clearAStarPath();
    this.specialSoundPending = true;
  }

  private advanceRagePause(): void {
    this.stateTimer--;
    // He does not move, does not turn and cannot be hurt. Turning would let a
    // player kite the flurry's opening arc for free.
    this.isMoving = false;
    if (this.stateTimer <= 0) {
      this.state = 'flurry';
      this.stateTimer = FLURRY_FRAMES;
      this.flurryTickTimer = 0;
    }
  }

  private advanceFlurry(nearest: Player | null, targets: Player[]): void {
    this.stateTimer--;

    if (nearest !== null) {
      this.updateLastKnown(nearest);
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed * FLURRY_SPEED_MULTIPLIER,
        this.tileSize * FLURRY_CLOSE_RANGE_TILES,
      );
      if (!this.isMoving) this.faceToward(nearest);
    } else {
      this.isMoving = false;
    }

    if (this.flurryTickTimer > 0) {
      this.flurryTickTimer--;
    } else {
      this.flurryTickTimer = FLURRY_TICK_FRAMES;
      this.strikeEveryoneInReach(targets);
    }

    if (this.stateTimer <= 0) {
      this.state = 'cooldown';
      this.stateTimer = POST_FLURRY_RECOVERY_FRAMES;
      this.rageCooldown = randomInt(RAGE_COOLDOWN_MIN_FRAMES, RAGE_COOLDOWN_MAX_FRAMES);
      // The flurry left both arms out; refusing an instant follow-up strike is
      // what gives the player their window to close back in.
      this.slashCooldown = SLASH_COOLDOWN_FRAMES;
    }
  }

  /** One flurry tick: everything alive inside the melee disc takes a hit. */
  private strikeEveryoneInReach(targets: Player[]): void {
    for (const target of targets) {
      if (!target.isAlive) continue;
      if (this.distanceTo(target) > this.flurryRadiusPx) continue;
      const shell = this.spells;
      if (
        shell?.isPointInsideShell(
          target.x + this.tileSize * CENTER_OFFSET,
          target.y + this.tileSize * CENTER_OFFSET,
        ) === true
      ) {
        // Blocking a tick has to pay, or holding the shell through a flurry is
        // strictly worse than holding it through any other boss's attack.
        shell.addBlockXp(FLURRY_BLOCK_XP);
        continue;
      }
      this.dealDamage(target, FLURRY_TICK_DAMAGE, MANTID_FLURRY_ATTACK_TYPE);
    }
  }

  private advanceCooldown(nearest: Player | null): void {
    this.stateTimer--;
    this.isMoving = false;
    if (this.stateTimer <= 0) this.state = nearest === null ? 'idle' : 'pursuing';
  }

  /**
   * Blocks every point of damage for the invincible second and throws a label
   * instead — every route into its health, not only the swung one. A burn or a
   * crown proc ticking through the invincible second would put a hole in the
   * one window this whole fight is built around.
   *
   * Refusing the blow outright also keeps `damageTakenBy` clean: no damage was
   * dealt, so none should be attributed, and a swing that hit a wall of chitin
   * must not buy a share of the kill XP.
   */
  protected override get isDamageImmune(): boolean {
    return this.isImmune;
  }

  protected override onDamageBlocked(): void {
    this.pushImmuneLabel();
  }

  private pushImmuneLabel(): void {
    if (this.immuneLabels.length >= MAX_IMMUNE_LABELS) return;
    this.immuneLabels.push({
      life: IMMUNE_LABEL_FRAMES,
      offsetTiles: (Math.random() - CENTER_OFFSET) * 2 * IMMUNE_LABEL_SPREAD_TILES,
    });
  }

  private tickImmuneLabels(): void {
    for (let i = this.immuneLabels.length - 1; i >= 0; i--) {
      this.immuneLabels[i].life--;
      if (this.immuneLabels[i].life <= 0) this.immuneLabels.splice(i, 1);
    }
  }

  /**
   * Bounty-tier loot.
   *
   * On top of the ordinary roll he always drops the two consumables that matter
   * for the fight the player just survived, and steps up in count and quality
   * with his own level — the coins scale on their own through
   * `MOB_LEVEL_COIN_SCALE`.
   */
  protected override rollLootItems(killer: Player | null): LootDrop['items'] {
    const items = super.rollLootItems(killer);
    items.push({ id: 'jugg_juice', quantity: 1 });
    items.push({ id: 'speed_fizz', quantity: 1 });
    if (this.mobLevel >= LOOT_TIER_TWO_LEVEL) {
      items.push({ id: 'cooldown_crisp', quantity: 1 });
      items.push({ id: 'health_potion', quantity: 2 });
    }
    if (this.mobLevel >= LOOT_TIER_THREE_LEVEL) {
      items.push({ id: 'stat_boost_potion', quantity: 1 });
    }
    // The mantis lives by striking first and not being where the blow lands.
    maybeDropSkillBook(items, 'skill_book_cat_reflexes');
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

    drawMantidSprite(ctx, 'mantid', sx, sy, tileSize, {
      walkFrame: this.walkFrame,
      isMoving: this.isMoving,
      facingX: this.facingX,
      facingY: this.facingY,
      slashProgress:
        this.state === 'slash' ? 1 - this.stateTimer / MANTID_SLASH_TOTAL_FRAMES : null,
      isFlurrying: this.state === 'flurry',
      isRaging: this.state === 'rage_pause',
    });

    // Both the aggro tell and the rage marker go *after* the sprite and a full
    // art-height above the tile. `renderAggroIndicator` draws a few pixels above
    // the tile top, which on this creature is buried under two tiles of mantis.
    const overheadY = sy - tileSize * mantidOverheadLiftTiles('mantid', FALLBACK_ART_HEIGHT_TILES);
    if (this.isAggro && this.state !== 'rage_pause') {
      this.renderAggroIndicator(ctx, sx, overheadY, tileSize);
    }
    if (this.state === 'rage_pause') {
      drawQuestMarker(ctx, sx, overheadY, tileSize, '!', QUEST_MARKER_GOLD);
    }
    this.renderImmuneLabels(ctx, sx, overheadY, tileSize);

    // Lifted for the same reason, so the bar reads as *his* rather than as a
    // strip lying across his legs.
    this.renderMobHealthBar(ctx, sx, overheadY);
  }

  /**
   * The blocked-hit labels.
   *
   * Drawn here rather than pushed into `FloatingCombatTextSystem` because that
   * system drains only the two players' queues — a mob has no route into it, and
   * giving one to a single boss would mean threading a system reference through
   * every mob constructor in the game.
   */
  private renderImmuneLabels(
    ctx: CanvasRenderingContext2D,
    sx: number,
    overheadY: number,
    tileSize: number,
  ): void {
    for (const label of this.immuneLabels) {
      const elapsed = 1 - label.life / IMMUNE_LABEL_FRAMES;
      const alpha =
        elapsed < IMMUNE_LABEL_HOLD
          ? 1
          : 1 - (elapsed - IMMUNE_LABEL_HOLD) / (1 - IMMUNE_LABEL_HOLD);
      drawText(ctx, IMMUNE_LABEL_TEXT, {
        x: sx + tileSize * (CENTER_OFFSET + label.offsetTiles),
        y: overheadY - tileSize * elapsed * IMMUNE_LABEL_RISE_TILES,
        size: IMMUNE_LABEL_SIZE,
        bold: true,
        color: IMMUNE_LABEL_COLOR,
        alpha,
        align: 'center',
        outline: true,
      });
    }
  }
}
