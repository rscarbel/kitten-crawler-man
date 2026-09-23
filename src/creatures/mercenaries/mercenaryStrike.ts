import type { Mob } from '../Mob';
import type { Mercenary } from '../Mercenary';
import { normalize } from '../../utils';
import type { MercenaryDrawState, MercenaryKitContext, MercenaryRow } from './MercenaryKit';

/** How one swing plays out, in game frames. */
export interface StrikeTiming {
  readonly row: MercenaryRow;
  /** Length of the whole swing. */
  readonly frames: number;
  /** The frame the blow connects on — the one where the hit is drawn. */
  readonly impactFrame: number;
  /**
   * How far past strike range the victim may have stepped by the impact frame
   * and still be hit, as a multiple of the kit's strike range. A victim that
   * walked clear of the swing is missed rather than hit from across the room.
   */
  readonly reachRatio: number;
}

/**
 * One committed melee swing: it tracks its victim until the blow lands, lands
 * it on the impact frame, and owns the hireling's frame until the row ends.
 *
 * Landing on the drawn impact frame rather than when the swing begins is what
 * makes the blow a player watches the blow that connects. The hireling commits
 * to the swing and finishes it, exactly as a wild creature does.
 */
export class MercenaryStrike {
  private timing: StrikeTiming | null = null;
  private frame = 0;
  private resolved = false;
  private victim: Mob | null = null;
  private damage = 0;

  get isSwinging(): boolean {
    return this.timing !== null;
  }

  begin(victim: Mob, timing: StrikeTiming, damage: number, merc: Mercenary): void {
    this.timing = timing;
    this.frame = 0;
    this.resolved = false;
    this.victim = victim;
    this.damage = damage;
    merc.isMoving = false;
    merc.attackSoundPending = true;
  }

  /**
   * Plays one frame of the swing. Returns true while one owns the frame, so the
   * caller does no movement or targeting of its own.
   */
  advance(ctx: MercenaryKitContext): boolean {
    const timing = this.timing;
    if (timing === null) return false;
    const merc = ctx.merc;
    merc.isMoving = false;

    const victim = this.victim;
    if (!this.resolved && this.frame < timing.impactFrame && victim !== null) {
      const heading = normalize(victim.x - merc.x, victim.y - merc.y);
      merc.facingX = heading.x;
      merc.facingY = heading.y;
    }

    if (!this.resolved && this.frame >= timing.impactFrame) {
      this.resolved = true;
      this.land(ctx, timing);
    }

    this.frame++;
    if (this.frame >= timing.frames) this.cancel();
    return true;
  }

  cancel(): void {
    this.timing = null;
    this.frame = 0;
    this.resolved = false;
    this.victim = null;
  }

  drawState(): MercenaryDrawState | null {
    const timing = this.timing;
    if (timing === null) return null;
    return { row: timing.row, progress: this.frame / timing.frames };
  }

  private land(ctx: MercenaryKitContext, timing: StrikeTiming): void {
    const victim = this.victim;
    const merc = ctx.merc;
    if (victim?.isAlive !== true) return;
    const reachPx = merc.strikeRangePx * timing.reachRatio;
    if (Math.hypot(victim.x - merc.x, victim.y - merc.y) > reachPx) return;
    victim.takeCreditedDamage(this.damage, ctx.owner, 'melee', merc);
    merc.noteBlowLanded(victim);
  }
}
