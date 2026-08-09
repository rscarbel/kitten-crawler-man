/**
 * The Temple of the Sky's rat problem: a rat that will not fight back.
 *
 * Deacon Aviel wants the nave cleared, not defended, so the step has to be a
 * chase rather than a fight. A `Rat` with its aggro turned off would simply
 * stand there and be hit, which reads as a bug; this one runs, which reads as
 * vermin. Everything else about it — three hit points, the sprite, the gore, the
 * loot roll — is inherited, because the room's shipped `CombatKit` and
 * `DestructionKit` already know how to kill a rat.
 *
 * It stays `isHostile` — the base class's default — even though it never
 * attacks. That flag is what `takesPlayerDamage` and `isPetAttackable` read, and
 * a vermin the cat could not swat is a vermin the step could never count.
 */

import type { Player } from '../Player';
import { MOB_SLOWED_SPEED_FRACTION } from './Mob';
import { Rat } from './Rat';
import { drawQuestMarker, QUEST_MARKER_GOLD } from '../sprites/questNPCSprite';

/**
 * How close a crawler has to be before the vermin bolts, in tiles.
 *
 * Wider than the rat's own three-tile aggro range: the point of the step is that
 * the party sweeps them out of the nave, and a vermin that only reacts once it
 * is already cornered spends the fight standing still.
 */
const FLIGHT_TRIGGER_TILES = 6;

/**
 * Headings tried, in order, when the straight-away heading walks into a wall.
 *
 * An 18×18 room is mostly pews, so "directly away" is blocked most of the time
 * and a vermin that only knew that one heading would press into the furniture
 * and stay there. The offsets fan out symmetrically and stop short of a right
 * angle — past that the vermin is running across the crawler's face rather than
 * away from them.
 */
/** Eighths of a half-turn, i.e. 22.5° per step. */
const FLIGHT_TURN_STEPS_PER_HALF_TURN = 8;
const FLIGHT_TURN_STEP_RADIANS = Math.PI / FLIGHT_TURN_STEPS_PER_HALF_TURN;
/** How many steps to either side of straight-away are worth trying. */
const FLIGHT_TURN_STEPS = 3;
const FLIGHT_TURN_OFFSETS_RADIANS: ReadonlyArray<number> = ((): number[] => {
  const offsets = [0];
  for (let step = 1; step <= FLIGHT_TURN_STEPS; step++) {
    offsets.push(step * FLIGHT_TURN_STEP_RADIANS, -step * FLIGHT_TURN_STEP_RADIANS);
  }
  return offsets;
})();

/**
 * How far ahead of itself the vermin tests for open floor, as a fraction of a
 * tile.
 *
 * Testing the tile it would occupy after one frame's step is useless — a step is
 * about a thirtieth of a tile, so the test almost always lands on the tile it is
 * already standing in and every heading passes. Looking most of a tile ahead is
 * what makes the walkable clamp mean anything.
 */
const FLIGHT_LOOKAHEAD_TILES = 0.9;

export class ShrineVermin extends Rat {
  override displayName = 'Shrine Vermin';
  override description = 'A temple rat, interested only in being somewhere else.';

  /**
   * Flight, in place of the inherited chase.
   *
   * `updateAI` rather than `update` because that is the hook the mob loop calls;
   * overriding it wholesale is also what keeps the base rat's bite from ever
   * being armed, since nothing here sets a bite timer.
   */
  /**
   * The overhead `!` every quest giver wears, on a quest *target* instead.
   *
   * A vermin has no marker state machine to read: being alive is the whole of
   * its role in the step, and the moment it dies it stops being drawn at all. So
   * the glyph is unconditional rather than branched on a `markerType`.
   *
   * Drawn after the inherited sprite, as every other marker in the game is, and
   * against the plain tile box the rat is drawn in — `drawQuestMarker` measures
   * its font size and its lift above the box in units of the size handed to it,
   * so an enlarged box would float an oversized glyph off the rat's head.
   */
  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    super.drawSelf(ctx, camX, camY, tileSize);
    if (!this.isAlive) return;
    drawQuestMarker(ctx, this.x - camX, this.y - camY, tileSize, '!', QUEST_MARKER_GOLD);
  }

  override updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    // Deliberately never engaged: `currentTarget` means "this mob has noticed
    // you", and companion and mercenary AI read it as a fight in progress.
    this.currentTarget = null;

    const threat = this.nearestThreat(targets);
    if (threat === null) {
      this.isMoving = false;
      return;
    }

    const awayX = this.x - threat.x;
    const awayY = this.y - threat.y;
    const awayDistance = Math.hypot(awayX, awayY);
    // Standing exactly on the crawler leaves "away" undefined; keeping the last
    // heading is the one answer that cannot be a division by zero.
    const baseAngle =
      awayDistance === 0
        ? Math.atan2(this.facingY, this.facingX)
        : Math.atan2(awayY / awayDistance, awayX / awayDistance);

    // Webbed or shocked vermin run at the same fraction a chasing mob does —
    // the slow is a property of the mob, not of what it is running towards.
    const step = this.isSlowed ? this.speed * MOB_SLOWED_SPEED_FRACTION : this.speed;

    for (const turn of FLIGHT_TURN_OFFSETS_RADIANS) {
      const angle = baseAngle + turn;
      const headingX = Math.cos(angle);
      const headingY = Math.sin(angle);
      if (!this.hasOpenFloorAhead(headingX, headingY)) continue;
      this.facingX = headingX;
      this.facingY = headingY;
      this.moveWithCollision(headingX * step, headingY * step);
      this.isMoving = true;
      return;
    }

    // Cornered. `followTargetCollide` is not in play here, but its trap is:
    // nothing else writes facing on a frame with no walking, so a vermin backed
    // into a pew would keep whichever way it last ran. It faces what it is
    // cowering from instead, which is also what a cornered animal does.
    this.faceToward(threat);
    this.isMoving = false;
  }

  /** The nearer living crawler, once one is close enough to bolt from. */
  private nearestThreat(targets: Player[]): Player | null {
    const triggerRangePx = this.tileSize * FLIGHT_TRIGGER_TILES;
    let nearest: Player | null = null;
    let nearestDistance = triggerRangePx;
    for (const target of targets) {
      if (!target.isAlive) continue;
      const distance = this.distanceTo(target);
      if (distance > nearestDistance) continue;
      nearestDistance = distance;
      nearest = target;
    }
    return nearest;
  }

  /** Whether a heading leads onto floor rather than into the nave's furniture. */
  private hasOpenFloorAhead(headingX: number, headingY: number): boolean {
    const map = this.map;
    if (map === null) return true;
    const lookahead = this.tileSize * FLIGHT_LOOKAHEAD_TILES;
    const centreX = this.x + this.tileSize / 2;
    const centreY = this.y + this.tileSize / 2;
    const tileX = Math.floor((centreX + headingX * lookahead) / this.tileSize);
    const tileY = Math.floor((centreY + headingY * lookahead) / this.tileSize);
    return map.isWalkable(tileX, tileY);
  }
}
