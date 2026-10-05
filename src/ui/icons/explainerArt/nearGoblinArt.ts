/**
 * The near-goblin hint's combat preview: Carl and a mace goblin trading
 * blows in turn, no damage dealt.
 */

import { drawHumanSprite } from '../../../sprites/humanSprite';
import { GOBLIN_ATTACKS, drawGoblinSprite } from '../../../sprites/goblinSprite';
import type { IllustrationRect } from './illustration';

const SPRITE_SIZE = 48;
const SPRITE_GAP = 20;
/** One full exchange: Carl swings for the first half, the goblin for the second. */
const COMBAT_PERIOD = 120;
const COMBAT_HALF_PERIOD = 60;
const ATTACK_FRAMES = 60;
/** The goblin's guard pose while Carl swings. */
const GUARD_FRAME = 0;
/** The figures stand this far above the band's floor; Carl's head rises above his tile, so they sit low rather than centred. */
const FLOOR_MARGIN = 8;

export function drawNearGoblinCombat(
  ctx: CanvasRenderingContext2D,
  rect: IllustrationRect,
  frame: number,
): void {
  const t = frame % COMBAT_PERIOD;
  const humanIsAttacking = t < COMBAT_HALF_PERIOD;
  const phaseT = humanIsAttacking ? t : t - COMBAT_HALF_PERIOD;
  const centerX = rect.x + rect.width / 2;
  const humanX = centerX - SPRITE_SIZE - SPRITE_GAP / 2;
  const goblinX = centerX + SPRITE_GAP / 2;
  const spriteY = rect.y + rect.height - SPRITE_SIZE - FLOOR_MARGIN;
  drawHumanSprite(ctx, humanX, spriteY, SPRITE_SIZE, {
    attackPhase: humanIsAttacking ? 'jab_side' : null,
    attackTimer: humanIsAttacking ? ATTACK_FRAMES - phaseT : 0,
    attackFrames: ATTACK_FRAMES,
    facingX: 1,
    facingY: 0,
  });
  // A still of the strike, not of the goblin standing there: the mace's whirl
  // on the frame it actually connects.
  drawGoblinSprite(ctx, {
    archetype: 'mace',
    x: goblinX,
    y: spriteY,
    tileSize: SPRITE_SIZE,
    facingX: -1,
    state: humanIsAttacking ? 'idle' : 'attack_light',
    frame: humanIsAttacking ? GUARD_FRAME : GOBLIN_ATTACKS.mace.light.impactFrame,
  });
}
