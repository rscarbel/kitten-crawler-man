import { mulberry32, type Rng } from './person/rng';
import { progressFrameIndex, timeFrameIndex, walkFrameIndex } from '../core/SpriteRenderer';
import type { FigureDef } from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import {
  GOBLIN_FIGURES,
  GOBLIN_GORE_STATES,
  GOBLIN_PLUMBER_FIGURE,
  GOBLIN_PLUMBER_WALK_GROUND_PER_CYCLE_TILES,
  goblinRowFrameCount,
  goblinWalkGroundPerCycleTiles,
} from './art/goblinFigure';
import { TILE_SIZE } from '../core/constants';

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
 * One figure per archetype, with the weapon painted into the body.
 *
 * The old base-plus-overlay split only worked while the body animation was
 * weapon-independent, which is exactly what this rework destroys: a two-handed
 * hammer haul, a one-handed mace whirl that passes behind the body and a lunging
 * sword stab need three different bodies, and a shared body layer cannot express
 * any of them.
 */
/**
 * All five figures share one state union, so indexing it needs no cast. Naming
 * the rows by *weight* rather than by move keeps that true while still meaning
 * something: in every archetype the light attack is the faster, shorter-reach,
 * lower-commitment one and the heavy is the telegraphed haymaker.
 */
export type GoblinState =
  'walk' | 'idle' | 'idle_break' | 'attack_light' | 'attack_heavy' | 'flinch';

/** The rows a goblin that is never handed an attack can be drawn in. */
export type GoblinPassiveState = Exclude<GoblinState, 'attack_light' | 'attack_heavy'>;

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

const WALK_FRAMES = goblinRowFrameCount('walk');
const IDLE_FRAMES = goblinRowFrameCount('idle');
const IDLE_BREAK_FRAMES = goblinRowFrameCount('idle_break');
const FLINCH_FRAMES = goblinRowFrameCount('flinch');
/**
 * Breathing speed of the always-on idle loop: one breath every
 * `IDLE_FRAMES / GOBLIN_IDLE_FPS` seconds, the slow rest rate of a creature
 * that is not doing anything. Faster than this the breath reads as a jitter.
 */
export const GOBLIN_IDLE_FPS = 5;
/** The fidget plays at an unhurried pace, so it never reads as a telegraph. */
export const GOBLIN_IDLE_BREAK_FPS = 9;

/** Frames a flinch plays for; short on purpose, so it never eats an attack. */
export const GOBLIN_FLINCH_FRAMES = 12;

/**
 * Seconds between fidgets. Long, because goblins stand in groups: at a few
 * seconds apart a camp or a queue of them always has someone fidgeting, and
 * the whole crowd reads as shifting about.
 */
const IDLE_BREAK_MIN_SECONDS = 8;
const IDLE_BREAK_RANDOM_SECONDS = 8;

/** A resolved animation state, ready to hand to the sprite renderer. */
interface ResolvedFrame<State extends GoblinState = GoblinState> {
  readonly state: State;
  readonly frame: number;
}

/** Seeds {@link cosmeticRandom}; any value serves, it only staggers the herd. */
const GOBLIN_COSMETIC_SEED = 0x60b1;

/**
 * The most the walk cycle may advance in one tick, in radians: one frame of
 * the row. Past that a tick skips a frame of the cycle, and skipped frames
 * read as strobing legs rather than as a faster stride.
 */
const MAX_GAIT_ADVANCE = (Math.PI * 2) / WALK_FRAMES;

/**
 * The draws that only decide how a goblin looks — when it fidgets, where its
 * breathing starts. A stream of their own rather than `Math.random`: the
 * animator ticks on its own schedule, and a cosmetic draw taken from the game's
 * stream reshuffles every roll after it, so moving when a goblin fidgets would
 * change how hard a seeded fight is.
 */
const cosmeticRandom: Rng = mulberry32(GOBLIN_COSMETIC_SEED);

/**
 * Owns a single goblin's animation timers.
 *
 * `idlePhaseOffset` is the part that is easy to forget and immediately visible
 * once forgotten: without it every goblin in a camp breathes and blinks on the
 * same frame, which reads as a rack of clones rather than as five creatures.
 *
 * The walk is paced by the ground the goblin actually covered, at the rate its
 * own stride covers it, so a planted foot stays put on the floor whatever the
 * goblin's speed. Paced by time, a goblin faster than its stride skates.
 */
export class GoblinPassiveAnimator {
  /** Per-instance phase shift, in seconds, added to the idle time index. */
  private readonly idlePhaseOffset = cosmeticRandom() * (IDLE_FRAMES / GOBLIN_IDLE_FPS);
  private readonly radiansPerPx: number;
  private gaitPhase = 0;
  private idleSeconds = 0;
  private secondsUntilBreak = GoblinPassiveAnimator.rollBreakDelay();
  private breakFramesLeft = 0;
  /**
   * Frames the current break was given, so it can be played from its own start.
   *
   * Sampled off the free-running wall clock instead, a break would begin on
   * whatever frame that clock happened to be at — and a flourish that starts
   * three-quarters of the way through is a pop, not a flourish.
   */
  private breakTotalFrames = 1;
  private flinchFramesLeft = 0;

  /** @param walkGroundPerCycleTiles ground one walk cycle of this figure covers. */
  constructor(walkGroundPerCycleTiles: number) {
    this.radiansPerPx = (Math.PI * 2) / (walkGroundPerCycleTiles * TILE_SIZE);
  }

  private static rollBreakDelay(): number {
    return IDLE_BREAK_MIN_SECONDS + cosmeticRandom() * IDLE_BREAK_RANDOM_SECONDS;
  }

  /** Drops every animation in flight — used when a scene resets combat state. */
  reset(): void {
    this.gaitPhase = 0;
    this.idleSeconds = 0;
    this.secondsUntilBreak = GoblinPassiveAnimator.rollBreakDelay();
    this.breakFramesLeft = 0;
    this.breakTotalFrames = 1;
    this.flinchFramesLeft = 0;
  }

  startFlinch(): void {
    this.flinchFramesLeft = GOBLIN_FLINCH_FRAMES;
    this.breakFramesLeft = 0;
  }

  /**
   * Advances timers by one game frame. Call once per frame, before rendering,
   * with the ground the goblin's own feet covered this frame — not what a
   * knockback or a shove carried it, or its legs run forward as it flies back.
   */
  tick(
    isMoving: boolean,
    isAttacking: boolean,
    secondsPerFrame: number,
    ownStridePx: number,
  ): void {
    this.advanceGait(isMoving, ownStridePx);
    if (this.flinchFramesLeft > 0) this.flinchFramesLeft--;
    if (this.breakFramesLeft > 0) this.breakFramesLeft--;

    if (isMoving || isAttacking) {
      this.idleSeconds = 0;
      this.breakFramesLeft = 0;
      this.secondsUntilBreak = GoblinPassiveAnimator.rollBreakDelay();
      return;
    }

    this.idleSeconds += secondsPerFrame;
    if (this.breakFramesLeft > 0 || this.idleSeconds < this.secondsUntilBreak) return;
    this.breakFramesLeft = Math.round(IDLE_BREAK_FRAMES / GOBLIN_IDLE_BREAK_FPS / secondsPerFrame);
    this.breakTotalFrames = this.breakFramesLeft;
    this.idleSeconds = 0;
    this.secondsUntilBreak = GoblinPassiveAnimator.rollBreakDelay();
  }

  private advanceGait(isMoving: boolean, ownStridePx: number): void {
    if (!isMoving) {
      this.gaitPhase = 0;
      return;
    }
    const advance = Math.min(ownStridePx * this.radiansPerPx, MAX_GAIT_ADVANCE);
    this.gaitPhase = (this.gaitPhase + advance) % (Math.PI * 2);
  }

  get isFlinching(): boolean {
    return this.flinchFramesLeft > 0;
  }

  /**
   * Resolve the state and frame to draw for a goblin that is not attacking.
   *
   * Priority is flinch → walk → idle_break → idle.
   */
  resolvePassive(elapsedSeconds: number, isMoving: boolean): ResolvedFrame<GoblinPassiveState> {
    if (this.flinchFramesLeft > 0) {
      const progress = 1 - this.flinchFramesLeft / GOBLIN_FLINCH_FRAMES;
      return { state: 'flinch', frame: progressFrameIndex(progress, FLINCH_FRAMES) };
    }
    if (isMoving) {
      return { state: 'walk', frame: walkFrameIndex(this.gaitPhase, WALK_FRAMES) };
    }
    if (this.breakFramesLeft > 0) {
      const progress = 1 - this.breakFramesLeft / this.breakTotalFrames;
      return { state: 'idle_break', frame: progressFrameIndex(progress, IDLE_BREAK_FRAMES) };
    }
    // The always-on breathing loop is the one thing driven by the clock, because
    // it has no start: the gait resets to 0 the moment a goblin stops, so a
    // gait-driven idle freezes on frame 0 and the goblin becomes a corpse that
    // has not fallen over. The per-instance phase offset is what keeps a camp of
    // five from breathing and blinking in lockstep.
    const phased = elapsedSeconds + this.idlePhaseOffset;
    return { state: 'idle', frame: timeFrameIndex(phased, GOBLIN_IDLE_FPS, IDLE_FRAMES) };
  }
}

/** A fighting goblin's animator: the passive rows plus its archetype's attacks. */
export class GoblinAnimator extends GoblinPassiveAnimator {
  constructor(private readonly archetype: GoblinArchetype) {
    super(goblinWalkGroundPerCycleTiles(archetype));
  }

  /**
   * Resolve the state and frame to draw.
   *
   * Priority is attack → flinch → walk → idle_break → idle.
   */
  resolve(
    elapsedSeconds: number,
    isMoving: boolean,
    attack: { readonly kind: GoblinAttackKind; readonly progress: number } | null,
  ): ResolvedFrame {
    if (attack === null) return this.resolvePassive(elapsedSeconds, isMoving);
    const state: GoblinState = attack.kind === 'light' ? 'attack_light' : 'attack_heavy';
    const frames = attackSpriteFrames(this.archetype, attack.kind);
    return { state, frame: progressFrameIndex(attack.progress, frames) };
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

/** Draw one goblin frame. Every figure faces +X, so the runtime mirrors it. */
export function drawGoblinSprite(ctx: CanvasRenderingContext2D, sprite: GoblinSpriteState): void {
  drawFigureCached(
    ctx,
    GOBLIN_FIGURES[sprite.archetype],
    sprite.state,
    sprite.frame,
    sprite.x,
    sprite.y,
    sprite.tileSize,
    { flipX: sprite.facingX < 0 },
  );
}

/** Where and how to draw the bathroom plumber; he has only the passive rows. */
export interface GoblinPlumberSpriteState extends Omit<GoblinSpriteState, 'archetype' | 'state'> {
  readonly state: GoblinPassiveState;
}

/**
 * Draw one frame of the bathroom plumber: a goblin in a cap and overalls, with a
 * pipe wrench in hand and a plunger on his back. Drive it from
 * {@link GoblinPassiveAnimator.resolvePassive}.
 */
export function drawGoblinPlumberSprite(
  ctx: CanvasRenderingContext2D,
  sprite: GoblinPlumberSpriteState,
): void {
  drawFigureCached(
    ctx,
    GOBLIN_PLUMBER_FIGURE,
    sprite.state,
    sprite.frame,
    sprite.x,
    sprite.y,
    sprite.tileSize,
    { flipX: sprite.facingX < 0 },
  );
}

/** The passive animator for a bathroom goblin: the plumber's own build, or a queue goblin's archetype. */
export function bathroomGoblinAnimator(figure: GoblinArchetype | 'plumber'): GoblinPassiveAnimator {
  return new GoblinPassiveAnimator(
    figure === 'plumber'
      ? GOBLIN_PLUMBER_WALK_GROUND_PER_CYCLE_TILES
      : goblinWalkGroundPerCycleTiles(figure),
  );
}

/** Every row the plumber can be drawn in, in the order `resolvePassive` prioritises them. */
export const GOBLIN_PLUMBER_STATES: ReadonlyArray<GoblinPassiveState> = [
  'flinch',
  'walk',
  'idle_break',
  'idle',
];

/**
 * Warms every row the plumber draws.
 *
 * All four rather than the spawn pair the hostile goblins warm: he is placed
 * with the room rather than arriving, and a flinch from the first blow has no
 * telegraph to warm it behind.
 */
export function prewarmGoblinPlumber(): void {
  for (const state of GOBLIN_PLUMBER_STATES) prewarmFigureState(GOBLIN_PLUMBER_FIGURE, state);
}

/**
 * The nine pieces a goblin comes apart into, in the order they spawn.
 *
 * One list, taken from the figure that paints them, so `BodyPartGoreSystem`
 * cannot ask for a piece by a name the art has renamed — which would be a body
 * part that silently stops appearing.
 */
export const GOBLIN_GORE_PARTS: ReadonlyArray<string> = GOBLIN_GORE_STATES;

/** The figure an archetype's frames are painted from. */
export function goblinFigure(archetype: GoblinArchetype): FigureDef {
  return GOBLIN_FIGURES[archetype];
}

/** The gore art a dead goblin's flying pieces come from. */
export function goblinBodyPartKey(archetype: GoblinArchetype): string {
  return `goblin_${archetype}`;
}

/**
 * Every animation row a goblin can be drawn in, in the order `resolve`
 * prioritises them.
 *
 * The art gates feed this to `missingStateFailures`: `drawFigureCached` returns
 * silently on a state the figure does not paint, so a row name only the runtime
 * knows is an invisible goblin and no log line.
 */
export const GOBLIN_STATES: ReadonlyArray<GoblinState> = [
  'attack_light',
  'attack_heavy',
  'flinch',
  'walk',
  'idle_break',
  'idle',
];

/**
 * The rows warmed when a goblin's spawn is scheduled.
 *
 * A body that has just arrived stands and walks, and nothing else: an
 * `idle_break` is eight seconds away at the earliest and an attack needs the
 * player inside reach. Those two rows are what the frame the pack lands on
 * draws.
 */
const SPAWN_WARMED_STATES: ReadonlyArray<GoblinState> = ['idle', 'walk'];

/**
 * The rows warmed when a goblin notices the player.
 *
 * `npm run bench:figure-paint` puts a goblin cell just over the threshold the
 * direct-paint fallback is affordable below, so every row its AI can enter has
 * to be warm before it enters it. Engagement is the telegraph the combat rows
 * have: an idle break is the one row with no cue at all, so it warms here too
 * rather than waiting for a flourish that starts on the frame it plays.
 */
const ENGAGED_WARMED_STATES: ReadonlyArray<GoblinState> = [
  'attack_light',
  'attack_heavy',
  'flinch',
  'idle_break',
];

/**
 * Warms the rows a goblin about to exist will draw.
 *
 * Called where a spawn is *scheduled* rather than where the mob first renders:
 * ten arriving on one frame is ten cold rows if the first request for them is
 * the frame they appear on.
 */
export function prewarmGoblin(archetype: GoblinArchetype): void {
  const figure = GOBLIN_FIGURES[archetype];
  for (const state of SPAWN_WARMED_STATES) prewarmFigureState(figure, state);
}

/**
 * The rows a goblin that is placed with its room and never fights draws: it
 * stands, shuffles, fidgets and flinches, and none of those has a telegraph to
 * warm behind.
 */
const BYSTANDER_WARMED_STATES: ReadonlyArray<GoblinPassiveState> = [
  'idle',
  'walk',
  'idle_break',
  'flinch',
];

/** Warms every row a non-fighting goblin can draw, for one placed with its room. */
export function prewarmGoblinBystander(archetype: GoblinArchetype): void {
  const figure = GOBLIN_FIGURES[archetype];
  for (const state of BYSTANDER_WARMED_STATES) prewarmFigureState(figure, state);
}

/** Warms the combat rows, from the moment a goblin has a target to use them on. */
export function prewarmGoblinCombat(archetype: GoblinArchetype): void {
  const figure = GOBLIN_FIGURES[archetype];
  for (const state of ENGAGED_WARMED_STATES) prewarmFigureState(figure, state);
  // Severed pieces are all drawn on the one frame a body comes apart, with no
  // telegraph of their own; noticing the player is the only warning there is.
  for (const part of GOBLIN_GORE_PARTS) prewarmFigureState(figure, part);
}
