import type { Player } from '../Player';
import {
  ROOSTER_PECK_IMPACT_PROGRESS,
  ROOSTER_PECK_RECOVER_FRAMES,
  ROOSTER_PECK_WINDUP_FRAMES,
  ROOSTER_PUNCH_IMPACT_PROGRESS,
  ROOSTER_PUNCH_RECOVER_FRAMES,
  ROOSTER_PUNCH_WINDUP_FRAMES,
  splitAtImpactProgress,
} from '../sprites/bigRoosterAttackTiming';

/** The two unarmed blows every rooster has. */
export type RoosterStrikeKind = 'peck' | 'punch';

/** Recorded on a peck's damage so `DeathCauseSystem` can name it. */
export const ROOSTER_PECK_ATTACK_TYPE = 'rooster_peck';
/** Recorded on a punch's damage so `DeathCauseSystem` can name it. */
export const ROOSTER_PUNCH_ATTACK_TYPE = 'rooster_punch';

/** One unarmed blow: how far it reaches, how long it takes and what it costs. */
interface RoosterStrikeSpec {
  /** Centre to centre, in tiles. */
  readonly reachTiles: number;
  /**
   * Game frames from the start of the wind-up to the blow. The aim is fixed on
   * the first of them, so the whole wind-up is the locked telegraph and never
   * shorter than the fairness floor.
   */
  readonly windupFrames: number;
  /** Game frames of settling back into the guard after the blow. */
  readonly recoverFrames: number;
  readonly damage: number;
  /** Base game frames before the same blow can be thrown again; level-scaled by the rooster. */
  readonly cooldownFrames: number;
  /** Where in the row the blow lands, so the drawn reach and the damage are one instant. */
  readonly impactProgress: number;
  readonly attackType: string;
}

const PECK_REACH_TILES = 1.3;
const PECK_DAMAGE = 2;
const PECK_COOLDOWN_FRAMES = 60;

const PUNCH_REACH_TILES = 1.2;
const PUNCH_DAMAGE = 3;
const PUNCH_COOLDOWN_FRAMES = 90;

const ROOSTER_STRIKES: Readonly<Record<RoosterStrikeKind, RoosterStrikeSpec>> = {
  peck: {
    reachTiles: PECK_REACH_TILES,
    windupFrames: ROOSTER_PECK_WINDUP_FRAMES,
    recoverFrames: ROOSTER_PECK_RECOVER_FRAMES,
    damage: PECK_DAMAGE,
    cooldownFrames: PECK_COOLDOWN_FRAMES,
    impactProgress: ROOSTER_PECK_IMPACT_PROGRESS,
    attackType: ROOSTER_PECK_ATTACK_TYPE,
  },
  punch: {
    reachTiles: PUNCH_REACH_TILES,
    windupFrames: ROOSTER_PUNCH_WINDUP_FRAMES,
    recoverFrames: ROOSTER_PUNCH_RECOVER_FRAMES,
    damage: PUNCH_DAMAGE,
    cooldownFrames: PUNCH_COOLDOWN_FRAMES,
    impactProgress: ROOSTER_PUNCH_IMPACT_PROGRESS,
    attackType: ROOSTER_PUNCH_ATTACK_TYPE,
  },
};

/** Centre to centre, how far `kind` reaches, in tiles. */
export function roosterStrikeReachTiles(kind: RoosterStrikeKind): number {
  return ROOSTER_STRIKES[kind].reachTiles;
}

/** The longer reach of the two, which is how close a rooster walks in before choosing. */
export const ROOSTER_STRIKE_MAX_REACH_TILES = Math.max(PECK_REACH_TILES, PUNCH_REACH_TILES);

/** The whole cone in front of a rooster that a peck or punch lands in, centred on its locked aim. */
const STRIKE_CONE_DEGREES = 120;
const DEGREES_PER_HALF_TURN = 180;
/** Half of that cone, either side of the locked aim. */
export const ROOSTER_STRIKE_CONE_HALF_ANGLE_RAD =
  ((STRIKE_CONE_DEGREES / 2) * Math.PI) / DEGREES_PER_HALF_TURN;
/** The cone's half-angle as a dot-product floor against the locked aim. */
const STRIKE_CONE_MIN_DOT = Math.cos(ROOSTER_STRIKE_CONE_HALF_ANGLE_RAD);

/** What a strike needs from the rooster throwing it, handed in on every call. */
export interface RoosterStrikeBody {
  readonly x: number;
  readonly y: number;
  readonly tileSize: number;
  /** Deals one landed blow: the rooster's own level scaling, shell and attribution rules. */
  readonly land: (target: Player, spec: RoosterStrikeSpec) => void;
  /** The rooster's level-scaled cooldown for a base length. */
  readonly scaledCooldown: (baseFrames: number) => number;
  /** Told on the frame each blow comes down, whether or not it lands on anyone. */
  readonly impact: (kind: RoosterStrikeKind) => void;
}

interface ActiveStrike {
  readonly kind: RoosterStrikeKind;
  readonly aimX: number;
  readonly aimY: number;
  phase: 'windup' | 'recover';
  framesLeft: number;
}

/**
 * Every rooster's peck and punch, one implementation for the whole flock: a
 * committed wind-up on an aim fixed when it starts, a cone test at the blow,
 * a recovery, then a per-blow cooldown.
 */
export class RoosterStrikes {
  private active: ActiveStrike | null = null;
  private readonly cooldowns: Record<RoosterStrikeKind, number> = { peck: 0, punch: 0 };

  /** The blow under way, from the first frame of its wind-up to the end of its recovery. */
  get current(): RoosterStrikeKind | null {
    return this.active?.kind ?? null;
  }

  /**
   * How far through its row the blow under way is, split at the impact so the
   * row's own impact frame is drawn on the frame the damage resolves; null
   * outside a blow.
   */
  get progress(): number | null {
    const active = this.active;
    if (active === null) return null;
    const spec = ROOSTER_STRIKES[active.kind];
    return splitAtImpactProgress(
      active.phase === 'windup',
      active.framesLeft,
      spec.windupFrames,
      spec.recoverFrames,
      spec.impactProgress,
    );
  }

  /**
   * Which blow is winding up and the aim it locked when its wind-up began,
   * as a unit vector, or null outside a wind-up. Fixed for the whole wind-up: a crawler
   * who steps out of the cone it marks is not hit.
   */
  get windupAim(): {
    readonly kind: RoosterStrikeKind;
    readonly x: number;
    readonly y: number;
  } | null {
    const active = this.active;
    if (active?.phase !== 'windup') return null;
    return { kind: active.kind, x: active.aimX, y: active.aimY };
  }

  /** Whether `kind` is off cooldown and nothing else is being thrown. */
  isReady(kind: RoosterStrikeKind): boolean {
    return this.active === null && this.cooldowns[kind] <= 0;
  }

  /** Whether `kind` is ready and a target `distancePx` away is inside its reach. */
  canReach(kind: RoosterStrikeKind, distancePx: number, tileSize: number): boolean {
    return this.isReady(kind) && distancePx <= tileSize * ROOSTER_STRIKES[kind].reachTiles;
  }

  /** Commits to `kind`, aimed along (`aimX`, `aimY`) for its whole wind-up. */
  begin(kind: RoosterStrikeKind, aimX: number, aimY: number): void {
    const length = Math.hypot(aimX, aimY);
    this.active = {
      kind,
      aimX: length === 0 ? 0 : aimX / length,
      aimY: length === 0 ? 0 : aimY / length,
      phase: 'windup',
      framesLeft: ROOSTER_STRIKES[kind].windupFrames,
    };
  }

  /**
   * One frame: cooldowns run, a wind-up counts down to its blow, a recovery
   * counts down to its cooldown. Call every AI frame, struck or not, so a
   * cooldown never freezes while nobody is in reach.
   */
  update(body: RoosterStrikeBody, targets: readonly Player[]): void {
    for (const kind of STRIKE_KINDS) {
      if (this.cooldowns[kind] > 0) this.cooldowns[kind]--;
    }
    const active = this.active;
    if (active === null) return;
    active.framesLeft--;
    if (active.framesLeft > 0) return;
    const spec = ROOSTER_STRIKES[active.kind];
    if (active.phase === 'windup') {
      body.impact(active.kind);
      this.resolve(body, targets, active, spec);
      active.phase = 'recover';
      active.framesLeft = spec.recoverFrames;
      return;
    }
    this.cooldowns[active.kind] = body.scaledCooldown(spec.cooldownFrames);
    this.active = null;
  }

  /** Drops any blow under way and every cooldown: the fight is being called off. */
  reset(): void {
    this.active = null;
    for (const kind of STRIKE_KINDS) this.cooldowns[kind] = 0;
  }

  private resolve(
    body: RoosterStrikeBody,
    targets: readonly Player[],
    active: ActiveStrike,
    spec: RoosterStrikeSpec,
  ): void {
    const reachPx = body.tileSize * spec.reachTiles;
    for (const target of targets) {
      if (!target.isAlive) continue;
      const dx = target.x - body.x;
      const dy = target.y - body.y;
      const distance = Math.hypot(dx, dy);
      if (distance > reachPx) continue;
      const inFront =
        distance === 0 ||
        (dx / distance) * active.aimX + (dy / distance) * active.aimY >= STRIKE_CONE_MIN_DOT;
      if (!inFront) continue;
      body.land(target, spec);
    }
  }
}

const STRIKE_KINDS: readonly RoosterStrikeKind[] = ['peck', 'punch'];
