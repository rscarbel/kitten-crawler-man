import type { Player } from '../../Player';
import type { Mob } from '../Mob';
import type { Mercenary } from '../Mercenary';
import type { GolemRockThrow } from '../../systems/RockThrowSystem';
import type { HirelingShot } from '../../systems/HirelingBoltSystem';
import type { MercenaryBarkTrigger } from './mercenaryVoices';

/**
 * How a hireling fights.
 *
 * `Mercenary` is the shell every hire shares: it follows its owner, leashes,
 * scans for hostiles, speaks, dies and draws. Everything that makes one hire
 * fight differently from another — its attacks, its specials, whom it chooses
 * to hit, how far it ranges — lives in a kit, one instance per hireling, so a
 * kit may keep whatever state it likes on itself.
 *
 * The shell calls a living hireling's kit in this order each frame:
 *
 * 1. {@link MercenaryKit.tick} — cooldowns.
 * 2. {@link MercenaryKit.update} — true when the kit owns the frame (a swing
 *    mid-play, a channel, a charge), and the shell then does nothing else.
 * 3. Target choice: the nearest hostile within {@link MercenaryKit.engageRadiusTiles}
 *    of the owner, passed through {@link MercenaryKit.chooseTarget} if the kit has one.
 * 4. No target, or past the leash: the shell walks back to the owner.
 * 5. With a target: {@link MercenaryKit.approach} if the kit has one, else the
 *    shell closes to strike range and faces it.
 * 6. Off the shared attack cooldown: {@link MercenaryKit.canStartAttack}, then
 *    {@link MercenaryKit.startAttack}.
 *
 * Hurt reactions ({@link MercenaryKit.onOwnerHurt}, {@link MercenaryKit.onFriendHurt})
 * run before step 1 on the frame after the wound shows.
 *
 * Every blow a kit lands goes through `Mob.takeCreditedDamage(damage,
 * merc.owner, type, merc)`: the owner earns the kill, while a guard is judged
 * against — and shoved away from — the hireling that actually swung. A new file
 * that lands such a blow belongs in `HIRELING_DAMAGE_FILES` in
 * `scripts/verify-tactics.ts`.
 */
export interface MercenaryKit {
  /** Tiles from the owner within which a hostile is worth fighting. */
  readonly engageRadiusTiles: number;
  /** Tiles from the owner past which the hireling drops everything and comes back. */
  readonly leashRadiusTiles: number;
  /** Distance, in tiles, from which the kit's basic attack can connect. */
  readonly strikeRangeTiles: number;
  /**
   * The follow band, in tiles: the hireling sets off after its owner once
   * further than `start` and stops at `stop`. The gap between them is
   * hysteresis — see `DEFAULT_FOLLOW_BAND`.
   */
  readonly followBand: FollowBand;

  tick(ctx: MercenaryKitContext): void;

  /** True while the kit owns this frame; the shell then neither moves nor retargets. */
  update(ctx: MercenaryKitContext): boolean;

  /**
   * Overrides whom the hireling fights. `nearest` is the shell's own pick.
   * Return null to fight nothing — a medic that never looks for trouble.
   */
  chooseTarget?(ctx: MercenaryKitContext, nearest: Mob | null): Mob | null;

  /**
   * Overrides how the hireling closes on its target — holding range, stepping
   * back from a melee threat. Return false to let the shell close to strike
   * range as usual.
   */
  approach?(ctx: MercenaryKitContext, target: Mob, distancePx: number): boolean;

  /** Whether an attack could start this frame, with the shared cooldown already clear. */
  canStartAttack(ctx: MercenaryKitContext, target: Mob, distancePx: number): boolean;

  /** Starts an attack. Sets `merc.attackCooldown` itself, since the cooldown is per attack. */
  startAttack(ctx: MercenaryKitContext, target: Mob, distancePx: number): void;

  /** The crawler the hireling follows took a wound. `attacker` is a best guess, or null. */
  onOwnerHurt?(ctx: MercenaryKitContext, attacker: Mob | null): void;

  /**
   * Any ally took a wound — the other crawler, Mongo, the owner too. This is the
   * hook for a kit that protects someone in particular, or heals the worst hurt.
   */
  onFriendHurt?(ctx: MercenaryKitContext, friend: Player, attacker: Mob | null): void;

  /**
   * The hireling just said something for `trigger` — the hook for a kit whose
   * figure acts a line out, such as a salute on being hired. Not called when
   * the barker kept it quiet.
   */
  onBark?(ctx: MercenaryKitContext, trigger: MercenaryBarkTrigger): void;

  /** Which row the hireling's figure plays, and how far through it. */
  drawState(merc: Mercenary): MercenaryDrawState;

  /** Hands over anything launched since the last call, and forgets it. */
  drainProjectiles(): readonly HirelingProjectile[];

  /**
   * Draws what the kit leaves on other bodies — a heal's sparkle on the ally it
   * landed on — over the entity layer, so it is never hidden behind whoever
   * stands south of that ally.
   */
  renderEffects?(ctx: CanvasRenderingContext2D, camX: number, camY: number): void;

  /** Drops any attack in flight — a death, a despawn, a rewound world. */
  clearAirborne(): void;
}

export interface FollowBand {
  readonly startTiles: number;
  readonly stopTiles: number;
}

/**
 * The follow band most hires use. A tighter band had the hireling arriving,
 * being nudged out of range by the owner's next step, and re-pathing every
 * frame — which reads on screen as the sprite vibrating against the player's
 * shoulder.
 */
export const DEFAULT_FOLLOW_BAND: FollowBand = { startTiles: 3.0, stopTiles: 2.2 };

/** The reach most hires engage from, measured from the owner rather than the hireling. */
export const DEFAULT_ENGAGE_RADIUS_TILES = 12;
export const DEFAULT_LEASH_RADIUS_TILES = 14;
/** Close enough to land a fist or blade. */
export const DEFAULT_STRIKE_RANGE_TILES = 0.9;

/**
 * Every row a hireling figure can be asked to play. A figure without a row
 * draws its nearest equivalent — an attack falls back to its basic swing, a
 * special to its idle — so asking is always safe.
 */
export type MercenaryRow =
  | 'idle'
  | 'walk'
  | 'hurt'
  | 'death'
  | 'punch'
  | 'cast_shield'
  | 'robot'
  | 'slam'
  | 'stomp'
  | 'throw'
  | 'thrust'
  | 'charge_windup'
  | 'charge'
  | 'charge_recover'
  | 'salute'
  | 'shoot'
  | 'cast_wave'
  | 'jab_left'
  | 'jab_right'
  | 'crush'
  | 'flee'
  | 'slap'
  | 'cast_triage'
  | 'cower';

export interface MercenaryDrawState {
  readonly row: MercenaryRow;
  /** 0 at a one-shot row's first frame, 1 at its last. Ignored by looping rows. */
  readonly progress: number;
}

/**
 * Anything a hireling launches that a projectile system flies for it. One
 * variant per kind of shot, so each system takes only its own.
 */
export type HirelingProjectile =
  { readonly kind: 'rock'; readonly rock: GolemRockThrow } | HirelingShot;

/**
 * What the shell hands a kit each frame. Rebuilt per frame by the shell and
 * never kept by a kit: every field is only true for the frame it describes.
 */
export interface MercenaryKitContext {
  readonly merc: Mercenary;
  /** The crawler being followed this frame — whichever one is active. */
  readonly owner: Player;
  /** Every mob in the scene; filter on `isAlive` and `isHostile` before use. */
  readonly allMobs: readonly Mob[];
  /**
   * Everyone on the party's side the kit may protect or heal: both crawlers,
   * Mongo, a quest ally. Never the hireling itself.
   *
   * Shields, heals and any other help for them go through their own
   * `Player` API (`applyStatus` with a `StatusEffect`, restoring `hp` within
   * `maxHp`), never a flag on the hireling: the effect has to outlive the
   * hireling, and has to show up on the ally's own HUD.
   */
  readonly allies: readonly Player[];
  /** The cat crawler, active or following, for kits that treat her specially. */
  readonly cat: Player;
  /** Whether a point is inside a safe room, where offensive spells do not work. */
  isInSafeRoom(entity: { readonly x: number; readonly y: number }): boolean;
  /** Asks the hireling to say something; it may stay quiet if it spoke recently. */
  bark(trigger: MercenaryBarkTrigger): void;
}

/** The walk or idle row, for a kit with nothing of its own to play. */
export function locomotionState(merc: Mercenary): MercenaryDrawState {
  return { row: merc.isMoving ? 'walk' : 'idle', progress: 0 };
}

/** Kits with nothing to throw hand back this shared empty list. */
export const NO_PROJECTILES: readonly HirelingProjectile[] = [];
