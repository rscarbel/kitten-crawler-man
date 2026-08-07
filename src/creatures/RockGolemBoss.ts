import type { DamageSource, Player } from '../Player';
import { RockGolem, FRAMES_PER_SHEET_FRAME } from './RockGolem';
import { Mob, type LootDrop, type PlayerDamageType } from './Mob';
import { maybeDropSkillBook } from './skillBookDrop';
import { ROLL_ATTACK_TYPE } from './rockGolemAttackTypes';
import {
  ROCK_GOLEM_BOSS_BODY_PART_KEY,
  type GolemBallState,
  type RockGolemSheet,
  type RockGolemSpriteState,
} from '../sprites/rockGolemSprite';

const BOSS_HP = 90;
/**
 * Boss-tier reward. The named bosses in this game run 500 (the Hoarder) to 2000
 * (the Grotesque Spider); a bounty is meant to be a strong source of XP, so it
 * sits high in that band. `scripts/verify-bounty.ts` asserts every bounty boss
 * stays inside it — three of the five originally shipped near 250, below every
 * named boss in the game and barely above a regular floor-3 mob.
 */
const BOSS_XP_VALUE = 1500;
/** The highest of the five: he brings one bodyguard, so he carries the purse. */
const BOSS_COIN_DROP_MIN = 130;
const BOSS_COIN_DROP_MAX = 240;
/** The boss sheet is two and a half tiles tall. */
const BOSS_CULL_MARGIN_TILES = 3;
/** Even heavier than a normal golem — nothing shoves this off its line. */
const BOSS_MASS = 12;
/**
 * The boss throws faster than its bodyguards — a little under two a second's
 * worth of gap.
 *
 * It always could throw (the kit is inherited whole, and the boss sheet bakes
 * its own throw rows), but between the shared band and the base cooldown a rock
 * almost never actually arrived, so in play it read as a boss with no answer to
 * being kited at all. Being the one that reaches you at range is what makes
 * backing away from it a decision rather than a solution.
 */
const BOSS_THROW_COOLDOWN = 75;

/** Frames between boulder rolls while a target is engaged (~15 s at 60 fps). */
const ROLL_COOLDOWN = 900;
/** Sheet frames the curl and the uncurl each take. */
const CURL_SHEET_FRAMES = 8;
const CURL_FRAMES = CURL_SHEET_FRAMES * FRAMES_PER_SHEET_FRAME;
/** Passes of the boulder roll before he unrolls. The exit condition, not a timer. */
const ROLL_PASSES = 3;
/** Speed multiplier while rolling. */
const ROLL_SPEED_SCALE = 3.4;
/** How far past the aim point a pass carries before it re-aims, in tiles. */
const ROLL_OVERSHOOT_TILES = 2;
/** Frames a single pass may last before it is abandoned as stuck. */
const ROLL_PASS_TIMEOUT = 150;
/** Frames the stun lasts after a barrier interrupts the roll (~2.5 s). */
const STUN_FRAMES = 150;

/** Contact damage while rolling, as a fraction of the victim's own maximum HP. */
const ROLL_DAMAGE_HP_FRACTION = 0.5;
/** Flat damage added on top, so a full-health player still feels the hit. */
const ROLL_FLAT_DAMAGE = 3;
/** Frames before the same target can be hit again by the roll. */
const ROLL_HIT_COOLDOWN = 90;
const ROLL_CONTACT_RANGE_TILES = 1.1;

/**
 * Attributed to the golem so the death screen can name what flattened you.
 * Dodgeable: getting out of the boulder's lane is the entire counterplay, and
 * marking it undodgeable would take that away from a dexterous character.
 */
function rollDamageSource(mobType: string): DamageSource {
  return { kind: 'mob', mobType, attackType: ROLL_ATTACK_TYPE };
}

/** Damage a hit is capped to while the shell is closed — the hardened state. */
const ROLLED_DAMAGE_CAP = 1;

const CENTER_OFFSET = 0.5;
/** How little of a tile counts as arriving, so a pass cannot stall on rounding. */
const PASS_ARRIVAL_TILES = 0.4;
/** Below this a heading is treated as degenerate rather than normalised to NaN. */
const MIN_HEADING_LENGTH = 1e-4;
/**
 * Fraction of a frame's intended travel he must actually cover to count as
 * still rolling. Anything less means a wall is holding him, and the pass ends
 * there rather than grinding against it until the timeout.
 */
const BLOCKED_TRAVEL_RATIO = 0.25;

type BossState = 'fighting' | 'curling' | 'rolling' | 'uncurling' | 'stunned';

interface RollAim {
  readonly x: number;
  readonly y: number;
}

/**
 * The Rock Golem bounty target: a normal golem's whole kit plus the boulder
 * roll.
 *
 * The roll is Ball-of-Swine-shaped but bounded and world-safe. Ball of Swine
 * orbits its arena and ignores walls, which it can do because the arena is an
 * empty box; the overworld has trees, cliffs and boulders, so this rolls in
 * straight charges through `moveWithCollision` instead and counts passes rather
 * than seconds. The two ideas it does take verbatim are the one-line damage cap
 * while rolled and reading `isSlowed` for the interrupt — which makes dropped
 * gym equipment the counterplay, at the cost of no new coupling at all.
 */
export class RockGolemBoss extends RockGolem {
  override readonly xpValue: number = BOSS_XP_VALUE;
  protected override coinDropMin = BOSS_COIN_DROP_MIN;
  protected override coinDropMax = BOSS_COIN_DROP_MAX;
  override readonly bodyPartKey: string | null = ROCK_GOLEM_BOSS_BODY_PART_KEY;
  override mass = BOSS_MASS;
  override displayName = 'Rock Golem';
  override description =
    'A quarry given a grudge. It curls into a boulder and comes through whatever is in the way.';

  private state: BossState = 'fighting';
  private stateFrame = 0;
  /**
   * Which of the roll's beats raised `specialSoundPending`. The curl, the roll
   * itself and the uncurl all share that one flag, and the boulder grinding
   * across the arena is a different sound from the golem hauling itself into
   * and out of the shape — `playMobAudioCues` reads this to tell them apart.
   */
  lastSpecial: 'brace' | 'roll' = 'brace';
  private rollCooldown = ROLL_COOLDOWN;
  private passesLeft = 0;
  private passFrames = 0;
  private aim: RollAim | null = null;
  private rollDirX = 1;
  private rollDirY = 0;
  /** Per-target hit cooldowns, so one pass cannot hit the same player twice. */
  private readonly rollHitCooldowns = new Map<Player, number>();
  private readonly rollContactRangePx: number;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, BOSS_HP);
    this.rollContactRangePx = tileSize * ROLL_CONTACT_RANGE_TILES;
  }

  override get cullMarginTiles(): number {
    return BOSS_CULL_MARGIN_TILES;
  }

  protected override get sheet(): RockGolemSheet {
    return 'rock_golem_boss';
  }

  /** Rolled, he is a hazard to run from rather than a thing to trade blows with. */
  override get avoidInstead(): boolean {
    return this.state === 'rolling' || this.state === 'curling';
  }

  /**
   * Stunned, the companion should pile in — that is the whole point of the
   * window. Every other state it should keep its distance and circle, because
   * both melee attacks and the roll are telegraphed things to be out of.
   *
   * This also keeps the boss's AI ticking outside the normal activation radius,
   * so a player who outruns it mid-roll cannot leave it frozen in the rolled
   * state — which is the one state that caps incoming damage to a scratch.
   */
  override get requiresEvasion(): boolean {
    return this.state !== 'stunned';
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.state = 'fighting';
    this.stateFrame = 0;
    this.rollCooldown = ROLL_COOLDOWN;
    this.passesLeft = 0;
    this.passFrames = 0;
    this.aim = null;
    this.rollHitCooldowns.clear();
  }

  /**
   * The exact Ball of Swine shape: everything is capped to a scratch while the
   * shell is closed, and only while it is closed. The stun that a barrier
   * causes is therefore a real damage window, not a cosmetic one.
   */
  override takeDamageFrom(
    amount: number,
    attacker: Player | null,
    damageType: PlayerDamageType | null = 'melee',
  ): void {
    const capped = this.isRolled ? Math.min(amount, ROLLED_DAMAGE_CAP) : amount;
    super.takeDamageFrom(capped, attacker, damageType);
  }

  /** True while the stone shell is shut, which is what the damage cap keys off. */
  private get isRolled(): boolean {
    return this.state === 'rolling';
  }

  override updateAI(targets: Player[]): void {
    if (!this.isAlive) return;
    this.tickRollHitCooldowns();

    switch (this.state) {
      case 'curling':
        this.updateCurling();
        return;
      case 'rolling':
        this.updateRolling(targets);
        return;
      case 'uncurling':
        this.updateUncurling();
        return;
      case 'stunned':
        this.updateStunned();
        return;
      case 'fighting':
        break;
    }

    if (this.rollCooldown > 0) this.rollCooldown--;
    // The roll only ever starts from a settled stance, so it cannot cancel a
    // slam the player is already reading as a telegraph.
    if (this.rollCooldown === 0 && this.currentAttack === null && this.currentTarget !== null) {
      this.enterState('curling');
      this.lastSpecial = 'brace';
      this.specialSoundPending = true;
      return;
    }
    super.updateAI(targets);
  }

  protected override get throwCooldownFrames(): number {
    return BOSS_THROW_COOLDOWN;
  }

  private enterState(state: BossState): void {
    this.state = state;
    this.stateFrame = 0;
    this.isMoving = false;
  }

  private tickRollHitCooldowns(): void {
    for (const [player, frames] of this.rollHitCooldowns) {
      if (frames <= 1) this.rollHitCooldowns.delete(player);
      else this.rollHitCooldowns.set(player, frames - 1);
    }
  }

  private updateCurling(): void {
    this.isMoving = false;
    this.stateFrame++;
    if (this.stateFrame < CURL_FRAMES) return;
    this.enterState('rolling');
    this.passesLeft = ROLL_PASSES;
    this.passFrames = 0;
    this.aim = null;
    this.lastSpecial = 'roll';
    this.specialSoundPending = true;
  }

  private updateRolling(targets: Player[]): void {
    // Gym equipment inside its slow radius is the counterplay: hitting one
    // stops the charge dead and opens the only full-damage window in the fight.
    // Read through `isSlowed` rather than `slowedByBarrier` so an electrified
    // golem stops for the same reason a barriered one does.
    if (this.isSlowed) {
      this.enterState('uncurling');
      this.aim = null;
      // The grind of the shell coming apart, not the groan — the groan belongs
      // to the stun that follows half a second later, and firing both here
      // stacks two cues on one beat.
      this.lastSpecial = 'brace';
      this.specialSoundPending = true;
      return;
    }

    const target = this.acquireTarget(targets, this.aggroRangePx);
    if (this.aim === null) {
      if (target === null) {
        // Losing the target between passes ends the roll, but it is not a
        // *failure* — only a barrier earns the stun, and clearing the remaining
        // passes here is what keeps `updateUncurling` able to tell them apart.
        this.passesLeft = 0;
        this.finishRoll();
        return;
      }
      this.beginPass(target);
    }

    this.rollContact(targets);
    this.advancePass();
  }

  private beginPass(target: Player): void {
    const fromX = this.x + this.tileSize * CENTER_OFFSET;
    const fromY = this.y + this.tileSize * CENTER_OFFSET;
    const toX = target.x + this.tileSize * CENTER_OFFSET;
    const toY = target.y + this.tileSize * CENTER_OFFSET;
    const dx = toX - fromX;
    const dy = toY - fromY;
    const length = Math.hypot(dx, dy);
    // A target standing on top of him gives a zero heading, which normalises to
    // NaN and leaves the boulder frozen for the rest of the roll.
    this.rollDirX =
      length < MIN_HEADING_LENGTH ? (this.facingX === 0 ? 1 : this.facingX) : dx / length;
    this.rollDirY = length < MIN_HEADING_LENGTH ? this.facingY : dy / length;
    const overshoot = this.tileSize * ROLL_OVERSHOOT_TILES;
    this.aim = {
      x: toX + this.rollDirX * overshoot,
      y: toY + this.rollDirY * overshoot,
    };
    this.passFrames = 0;
    this.facingX = this.rollDirX;
    this.facingY = this.rollDirY;
  }

  private advancePass(): void {
    const aim = this.aim;
    if (aim === null) return;

    const speed = this.speed * ROLL_SPEED_SCALE;
    const beforeX = this.x;
    const beforeY = this.y;
    this.moveWithCollision(this.rollDirX * speed, this.rollDirY * speed);
    this.isMoving = true;
    this.passFrames++;

    const cx = this.x + this.tileSize * CENTER_OFFSET;
    const cy = this.y + this.tileSize * CENTER_OFFSET;
    const arrived = Math.hypot(aim.x - cx, aim.y - cy) <= this.tileSize * PASS_ARRIVAL_TILES;
    // A pass also ends when a wall stops him: the overworld is full of trees and
    // cliffs, and without this he grinds against one until the timeout.
    const blocked = Math.hypot(this.x - beforeX, this.y - beforeY) < speed * BLOCKED_TRAVEL_RATIO;
    if (!arrived && !blocked && this.passFrames < ROLL_PASS_TIMEOUT) return;

    this.passesLeft--;
    this.aim = null;
    if (this.passesLeft <= 0) this.finishRoll();
  }

  private finishRoll(): void {
    this.enterState('uncurling');
    this.lastSpecial = 'brace';
    this.specialSoundPending = true;
  }

  private rollContact(targets: readonly Player[]): void {
    const cx = this.x + this.tileSize * CENTER_OFFSET;
    const cy = this.y + this.tileSize * CENTER_OFFSET;
    for (const target of targets) {
      if (!target.isAlive || this.rollHitCooldowns.has(target)) continue;
      const tx = target.x + this.tileSize * CENTER_OFFSET;
      const ty = target.y + this.tileSize * CENTER_OFFSET;
      if (Math.hypot(tx - cx, ty - cy) > this.rollContactRangePx) continue;
      // Half their maximum health plus a flat bite: brutal, but survivable from
      // full — a rolling boulder that one-shots is a coin flip, not a fight.
      //
      // Dealt directly rather than through `dealDamage`, which would run it
      // through the mob-level multiplier as well. This number is *already*
      // scaled — it is a fraction of the victim's own maximum health — and
      // stacking `MOB_LEVEL_DAMAGE_SCALE` on top of that makes one pass an
      // outright kill from full at any bounty level past five.
      const damage = Math.ceil(target.maxHp * ROLL_DAMAGE_HP_FRACTION) + ROLL_FLAT_DAMAGE;
      // `targets` is not just the two crawlers: `MobUpdateLoop` folds in the
      // scene's extra targets and any mob this one is retaliating against, so a
      // confused bodyguard can end up under the boulder. A `Mob` flattened by
      // plain `takeDamage` dies unattributed — the boulder has a thrower, and
      // `takeDamageFrom` is what puts him in the ledger the XP split reads.
      if (target instanceof Mob) target.takeDamageFrom(damage, this, 'melee');
      else if (target.takeDamage(damage, rollDamageSource(this.mobType)))
        this.noteStruckPlayer(target);
      this.attackSoundPending = true;
      this.rollHitCooldowns.set(target, ROLL_HIT_COOLDOWN);
    }
  }

  private updateUncurling(): void {
    this.isMoving = false;
    this.stateFrame++;
    if (this.stateFrame < CURL_FRAMES) return;
    // An interrupted roll ends in the stun; a roll that ran its three passes
    // just stands back up.
    if (this.isSlowed || this.passesLeft > 0) {
      this.enterState('stunned');
      this.damageSoundPending = true;
    } else {
      this.enterState('fighting');
    }
    this.passesLeft = 0;
    this.rollCooldown = ROLL_COOLDOWN;
  }

  /**
   * The attack cooldowns deliberately do not tick through the ball states: he
   * comes out of a roll able to swing immediately, which is what stops the roll
   * from being a free retreat.
   */
  private updateStunned(): void {
    this.isMoving = false;
    this.stateFrame++;
    if (this.stateFrame >= STUN_FRAMES) this.enterState('fighting');
  }

  private ballStateFor(): GolemBallState | null {
    switch (this.state) {
      case 'curling':
        return 'curl';
      case 'rolling':
        return 'roll';
      case 'uncurling':
        return 'uncurl';
      case 'stunned':
        return 'stunned';
      case 'fighting':
        return null;
    }
  }

  protected override spriteState(): RockGolemSpriteState {
    const ballState = this.ballStateFor();
    if (ballState === null) return super.spriteState();
    return {
      ...super.spriteState(),
      attack: null,
      ballState,
      ballProgress: this.stateFrame / CURL_FRAMES,
    };
  }

  /**
   * Bounty-tier loot: the curated high-value pool, stepped up by the level the
   * bounty system scaled him to. The coins ride the mob-level multiplier on top
   * of the already generous base, and the drop lands golden and permanent via
   * the overworld's boss-loot fallback.
   */
  protected override rollLootItems(killer: Player | null): LootDrop['items'] {
    const items = super.rollLootItems(killer);
    items.push({ id: 'stat_boost_potion', quantity: 1 });
    items.push({ id: 'jugg_juice', quantity: 1 });
    if (this.mobLevel >= MID_LEVEL_LOOT_THRESHOLD) {
      items.push({ id: 'speed_fizz', quantity: 1 });
    }
    if (this.mobLevel >= HIGH_LEVEL_LOOT_THRESHOLD) {
      items.push({ id: 'cooldown_crisp', quantity: 1 });
      items.push({ id: 'stat_boost_potion', quantity: 1 });
    }
    maybeDropSkillBook(items, 'skill_book_pugilism');
    return items;
  }
}

/** Mob levels at which the bounty payout adds another tier of consumables. */
const MID_LEVEL_LOOT_THRESHOLD = 5;
const HIGH_LEVEL_LOOT_THRESHOLD = 10;
