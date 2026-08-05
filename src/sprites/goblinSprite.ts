import {
  drawSpriteKey,
  progressFrameIndex,
  timeFrameIndex,
  walkFrameIndex,
} from '../core/SpriteRenderer';
import type { SpriteKey, SpriteStates } from '../core/SpriteLoader';

export type GoblinWeapon = 'sword' | 'axe' | 'mace' | 'warhammer';
export type GoblinAttackKind = 'light' | 'heavy';

/**
 * Every goblin sheet, including the archer's.
 *
 * Deliberately wider than {@link GoblinWeapon}: the four melee archetypes share
 * a damage/reach/cooldown table that a bow has no use for, and putting the bow
 * in that union would give every melee lookup a case that can only ever be
 * unreachable. The sheets, though, are uniform — same rows, same states — so
 * everything that only wants to *draw* a goblin keys off this.
 */
export type GoblinArchetype = GoblinWeapon | 'bow';

/**
 * One sheet per archetype, with the weapon baked in.
 *
 * The old base-plus-overlay split only worked while the body animation was
 * weapon-independent, which is exactly what this rework destroys: a two-handed
 * hammer haul, a one-handed mace whirl that passes behind the body and a lunging
 * sword stab need three different bodies, and a shared body layer cannot express
 * any of them.
 */
const SHEET_KEYS: Record<GoblinArchetype, SpriteKey> = {
  sword: 'goblin_sword',
  axe: 'goblin_axe',
  mace: 'goblin_mace',
  warhammer: 'goblin_warhammer',
  bow: 'goblin_bow',
};

/**
 * All four sheets share one state union, so indexing it needs no cast. Naming
 * the rows by *weight* rather than by move keeps that true while still meaning
 * something: in every archetype the light attack is the faster, shorter-reach,
 * lower-commitment one and the heavy is the telegraphed haymaker.
 */
type GoblinState = SpriteStates['goblin_axe'];

export interface GoblinAttackTiming {
  /** Frames the sprite row holds — must equal the generator's frameCount. */
  readonly spriteFrames: number;
  /** Sprite frame on which the weapon connects. */
  readonly impactFrame: number;
  /** Game frames the whole animation plays over. */
  readonly animFrames: number;
  readonly damage: number;
  readonly reachTiles: number;
  readonly cooldownFrames: number;
}

/** Today's balance: every goblin reaches 1.2 tiles and swings every 90 frames. */
const LEGACY_REACH_TILES = 1.2;
const LEGACY_COOLDOWN_FRAMES = 90;
const LIGHT_DAMAGE = 1;
const HEAVY_DAMAGE = 2;

/**
 * The contract between the art and `Goblin.ts`.
 *
 * `spriteFrames`, `impactFrame` and `animFrames` come from the animation and are
 * asserted against the generator by gate G13 — if one moves, both move. The
 * damage, reach and cooldown columns deliberately carry **today's** numbers: a
 * rebalance is a separate piece of work from a visual rework, and adopting an
 * earlier proposed spread would have made a war-hammer goblin roughly twice as
 * dangerous as anything else on floor 1 as a side effect of new art.
 */
export const GOBLIN_ATTACKS: Record<GoblinWeapon, Record<GoblinAttackKind, GoblinAttackTiming>> = {
  sword: {
    light: {
      spriteFrames: 14,
      impactFrame: 6,
      animFrames: 24,
      damage: LIGHT_DAMAGE,
      reachTiles: LEGACY_REACH_TILES,
      cooldownFrames: LEGACY_COOLDOWN_FRAMES,
    },
    heavy: {
      spriteFrames: 18,
      impactFrame: 8,
      animFrames: 36,
      damage: HEAVY_DAMAGE,
      reachTiles: LEGACY_REACH_TILES,
      cooldownFrames: LEGACY_COOLDOWN_FRAMES,
    },
  },
  axe: {
    light: {
      spriteFrames: 14,
      impactFrame: 6,
      animFrames: 30,
      damage: LIGHT_DAMAGE,
      reachTiles: LEGACY_REACH_TILES,
      cooldownFrames: LEGACY_COOLDOWN_FRAMES,
    },
    heavy: {
      spriteFrames: 18,
      impactFrame: 9,
      animFrames: 42,
      damage: HEAVY_DAMAGE,
      reachTiles: LEGACY_REACH_TILES,
      cooldownFrames: LEGACY_COOLDOWN_FRAMES,
    },
  },
  mace: {
    light: {
      spriteFrames: 14,
      impactFrame: 7,
      animFrames: 32,
      damage: LIGHT_DAMAGE,
      reachTiles: LEGACY_REACH_TILES,
      cooldownFrames: LEGACY_COOLDOWN_FRAMES,
    },
    heavy: {
      spriteFrames: 18,
      impactFrame: 8,
      animFrames: 40,
      damage: HEAVY_DAMAGE,
      reachTiles: LEGACY_REACH_TILES,
      cooldownFrames: LEGACY_COOLDOWN_FRAMES,
    },
  },
  warhammer: {
    light: {
      spriteFrames: 14,
      impactFrame: 7,
      animFrames: 40,
      damage: LIGHT_DAMAGE,
      reachTiles: LEGACY_REACH_TILES,
      cooldownFrames: LEGACY_COOLDOWN_FRAMES,
    },
    heavy: {
      spriteFrames: 18,
      impactFrame: 10,
      animFrames: 52,
      damage: HEAVY_DAMAGE,
      reachTiles: LEGACY_REACH_TILES,
      cooldownFrames: LEGACY_COOLDOWN_FRAMES,
    },
  },
};

/**
 * What `attack_light` and `attack_heavy` actually depict per archetype. The
 * state names are uniform so the runtime needs no per-weapon mapping; this table
 * is what they mean, for the review harness and the `?goblins` debug scene.
 */
export const ATTACK_MOVE_NAMES: Record<GoblinWeapon, Record<GoblinAttackKind, string>> = {
  sword: { light: 'stab', heavy: 'slash' },
  axe: { light: 'hooking cleave', heavy: 'overhead chop' },
  mace: { light: 'whirl', heavy: 'overhead crush' },
  warhammer: { light: 'side two-handed strike', heavy: 'high two-handed strike' },
};

/**
 * What the archer's two rows are worth in play.
 *
 * A separate table from {@link GOBLIN_ATTACKS} because nothing in that one
 * applies: an arrow has no reach (the projectile does), and what the frames
 * measure is a *release* rather than a moment of contact.
 *
 * `lockedFrames` is the fairness rule made explicit — the aim freezes that many
 * game frames before the string goes, at every level, so the shot is always
 * avoidable by moving. `scripts/verify-difficulty.ts` asserts it stays above the
 * 21-frame minimum; the aim-lock itself is applied in `GoblinArcher`.
 */
export interface GoblinShotTiming {
  /** Frames the sprite row holds — must equal the generator's frameCount. */
  readonly spriteFrames: number;
  /** Sprite frame the string is released on. */
  readonly releaseFrame: number;
  /** Game frames the whole draw-and-recover plays over. */
  readonly animFrames: number;
  readonly damage: number;
  readonly cooldownFrames: number;
  /** Game frames of frozen aim immediately before the release. */
  readonly lockedFrames: number;
}

const ARROW_DAMAGE = 2;
const ARROW_COOLDOWN_FRAMES = 130;
/** The fairness floor, and what both shots are authored against. */
const ARROW_LOCKED_FRAMES = 21;

export const GOBLIN_BOW_SHOTS: Record<GoblinAttackKind, GoblinShotTiming> = {
  // The hurried shot, snapped off while giving ground. Shorter overall, but the
  // locked stretch is identical — what it buys the archer is committing sooner,
  // never warning the player less.
  light: {
    spriteFrames: 14,
    releaseFrame: 10,
    animFrames: 34,
    damage: ARROW_DAMAGE,
    cooldownFrames: ARROW_COOLDOWN_FRAMES,
    lockedFrames: ARROW_LOCKED_FRAMES,
  },
  // The aimed shot: the archer's standard, taken from inside its own band.
  heavy: {
    spriteFrames: 18,
    releaseFrame: 13,
    animFrames: 40,
    damage: ARROW_DAMAGE,
    cooldownFrames: ARROW_COOLDOWN_FRAMES,
    lockedFrames: ARROW_LOCKED_FRAMES,
  },
};

/**
 * The game frame of a shot's animation the string is released on.
 *
 * Derived from the sprite timing the same way every other one-shot row is
 * sampled, so the arrow leaves on the frame the art shows it leaving.
 */
export function goblinArrowReleaseFrame(kind: GoblinAttackKind): number {
  const timing = GOBLIN_BOW_SHOTS[kind];
  return Math.round(
    (timing.animFrames * (timing.releaseFrame + FRAME_MIDPOINT)) / timing.spriteFrames,
  );
}

/**
 * A one-shot row samples the *middle* of each frame, so its release lands half a
 * frame past the release frame's index.
 */
const FRAME_MIDPOINT = 0.5;

/** How many sprite frames an archetype's attack row holds. */
function attackSpriteFrames(archetype: GoblinArchetype, kind: GoblinAttackKind): number {
  if (archetype === 'bow') return GOBLIN_BOW_SHOTS[kind].spriteFrames;
  return GOBLIN_ATTACKS[archetype][kind].spriteFrames;
}

const WALK_FRAMES = 12;
const IDLE_FRAMES = 12;
const IDLE_BREAK_FRAMES = 18;
const FLINCH_FRAMES = 5;
/** Breathing speed of the always-on idle loop. */
const IDLE_FPS = 8;
const IDLE_BREAK_FPS = 14;

/** Frames a flinch plays for; short on purpose, so it never eats an attack. */
export const GOBLIN_FLINCH_FRAMES = 12;

const IDLE_BREAK_MIN_SECONDS = 4;
const IDLE_BREAK_RANDOM_SECONDS = 5;

/** A resolved animation state, ready to hand to the sprite renderer. */
interface ResolvedFrame {
  readonly state: GoblinState;
  readonly frame: number;
}

/**
 * Owns a single goblin's animation timers.
 *
 * `idlePhaseOffset` is the part that is easy to forget and immediately visible
 * once forgotten: without it every goblin in a camp breathes and blinks on the
 * same frame, which reads as a rack of clones rather than as five creatures.
 */
export class GoblinAnimator {
  constructor(private readonly archetype: GoblinArchetype) {}

  /** Per-instance phase shift, in seconds, added to the idle time index. */
  private readonly idlePhaseOffset = Math.random() * (IDLE_FRAMES / IDLE_FPS);
  private idleSeconds = 0;
  private secondsUntilBreak = GoblinAnimator.rollBreakDelay();
  private breakFramesLeft = 0;
  /**
   * Frames the current break was given, so it can be played from its own start.
   *
   * The break used to be sampled off the free-running wall clock, which meant it
   * began on whatever frame that clock happened to be at — a flourish that
   * starts three-quarters of the way through is a pop, not a flourish.
   */
  private breakTotalFrames = 1;
  private flinchFramesLeft = 0;

  private static rollBreakDelay(): number {
    return IDLE_BREAK_MIN_SECONDS + Math.random() * IDLE_BREAK_RANDOM_SECONDS;
  }

  /** Drops every animation in flight — used when a scene resets combat state. */
  reset(): void {
    this.idleSeconds = 0;
    this.secondsUntilBreak = GoblinAnimator.rollBreakDelay();
    this.breakFramesLeft = 0;
    this.breakTotalFrames = 1;
    this.flinchFramesLeft = 0;
  }

  startFlinch(): void {
    this.flinchFramesLeft = GOBLIN_FLINCH_FRAMES;
    this.breakFramesLeft = 0;
  }

  /** Advances timers by one game frame. Call once per frame, before rendering. */
  tick(isMoving: boolean, isAttacking: boolean, secondsPerFrame: number): void {
    if (this.flinchFramesLeft > 0) this.flinchFramesLeft--;
    if (this.breakFramesLeft > 0) this.breakFramesLeft--;

    if (isMoving || isAttacking) {
      this.idleSeconds = 0;
      this.breakFramesLeft = 0;
      this.secondsUntilBreak = GoblinAnimator.rollBreakDelay();
      return;
    }

    this.idleSeconds += secondsPerFrame;
    if (this.breakFramesLeft > 0 || this.idleSeconds < this.secondsUntilBreak) return;
    this.breakFramesLeft = Math.round(IDLE_BREAK_FRAMES / IDLE_BREAK_FPS / secondsPerFrame);
    this.breakTotalFrames = this.breakFramesLeft;
    this.idleSeconds = 0;
    this.secondsUntilBreak = GoblinAnimator.rollBreakDelay();
  }

  get isFlinching(): boolean {
    return this.flinchFramesLeft > 0;
  }

  /**
   * Resolve the state and frame to draw.
   *
   * Priority is attack → flinch → walk → idle_break → idle.
   */
  resolve(
    elapsedSeconds: number,
    walkFrame: number,
    isMoving: boolean,
    attack: { readonly kind: GoblinAttackKind; readonly progress: number } | null,
  ): ResolvedFrame {
    if (attack !== null) {
      const state: GoblinState = attack.kind === 'light' ? 'attack_light' : 'attack_heavy';
      const frames = attackSpriteFrames(this.archetype, attack.kind);
      return { state, frame: progressFrameIndex(attack.progress, frames) };
    }
    if (this.flinchFramesLeft > 0) {
      const progress = 1 - this.flinchFramesLeft / GOBLIN_FLINCH_FRAMES;
      return { state: 'flinch', frame: progressFrameIndex(progress, FLINCH_FRAMES) };
    }
    if (isMoving) {
      return { state: 'walk', frame: walkFrameIndex(walkFrame, WALK_FRAMES) };
    }
    if (this.breakFramesLeft > 0) {
      const progress = 1 - this.breakFramesLeft / this.breakTotalFrames;
      return { state: 'idle_break', frame: progressFrameIndex(progress, IDLE_BREAK_FRAMES) };
    }
    // The always-on breathing loop is the one thing driven by the clock, because
    // it has no start: `walkFrame` resets to 0 the moment a mob stops, so a
    // walk-driven idle freezes on frame 0 and the goblin becomes a corpse that
    // has not fallen over. The per-instance phase offset is what keeps a camp of
    // five from breathing and blinking in lockstep.
    const phased = elapsedSeconds + this.idlePhaseOffset;
    return { state: 'idle', frame: timeFrameIndex(phased, IDLE_FPS, IDLE_FRAMES) };
  }
}

export interface GoblinSpriteState {
  readonly archetype: GoblinArchetype;
  readonly x: number;
  readonly y: number;
  readonly tileSize: number;
  readonly facingX: number;
  readonly state: GoblinState;
  readonly frame: number;
}

/** Draw one goblin frame. Every sheet faces +X, so the runtime mirrors it. */
export function drawGoblinSprite(ctx: CanvasRenderingContext2D, sprite: GoblinSpriteState): void {
  drawSpriteKey(
    ctx,
    SHEET_KEYS[sprite.archetype],
    sprite.state,
    sprite.frame,
    sprite.x,
    sprite.y,
    sprite.tileSize,
    { flipX: sprite.facingX < 0 },
  );
}

/**
 * The nine pieces a goblin comes apart into, in the order they spawn.
 *
 * The single source of truth: `scripts/goblinGore.ts` paints them in this order
 * and `BodyPartGoreSystem` spawns them in it, so a rename in one place is a
 * compile error rather than a body part that silently stops appearing.
 */
export const GOBLIN_GORE_PARTS: ReadonlyArray<string> = [
  'gore_head',
  'gore_torso',
  'gore_arm_near',
  'gore_arm_far',
  'gore_leg_near',
  'gore_leg_far',
  'gore_ribchunk',
  'gore_entrails',
  'gore_jaw',
];

/** The sheet an archetype's frames come from. */
export function goblinSheetKey(archetype: GoblinArchetype): SpriteKey {
  return SHEET_KEYS[archetype];
}

/** The gore sheet a dead goblin's flying pieces come from. */
export function goblinBodyPartKey(archetype: GoblinArchetype): string {
  return `goblin_${archetype}`;
}
