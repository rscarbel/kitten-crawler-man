/**
 * The quarry's minable stone: which sheet a `ROCK_DEPOSIT` tile is drawn from,
 * and in which state.
 *
 * Natural outcrops pick their sheet from their position, like boulders. The
 * quarry's ruined-wall stubs carry a planted `spriteKey` naming a dressed-stone
 * sheet, so the remains of a wall still read as a wall.
 *
 * Sprite only: the ground beneath was drawn by the chunk bake's `baseOnly`
 * pass, and repainting it here would wipe out a neighbour's overhang.
 */

import { drawSpriteKey } from '../../core/SpriteRenderer';
import { positionHash, propSpriteState, type TileContent } from '../tileTypes';

const OUTCROP_SPRITE_KEYS = ['rock_deposit_a', 'rock_deposit_b', 'rock_deposit_c'] as const;

/** Dressed stone: a ruined wall's squared blocks, planted on the quarry's wall stubs. */
export const DRESSED_STONE_SPRITE_KEYS = [
  'rock_deposit_dressed_a',
  'rock_deposit_dressed_b',
] as const;

type RockDepositSpriteKey =
  (typeof OUTCROP_SPRITE_KEYS)[number] | (typeof DRESSED_STONE_SPRITE_KEYS)[number];

function isDressedStoneSpriteKey(key: string): key is (typeof DRESSED_STONE_SPRITE_KEYS)[number] {
  return DRESSED_STONE_SPRITE_KEYS.some((dressed) => dressed === key);
}

/** The sheet a deposit at (tx, ty) is drawn from. */
export function rockDepositSpriteKey(
  tile: TileContent,
  tx: number,
  ty: number,
): RockDepositSpriteKey {
  const planted = tile.spriteKey;
  if (planted !== undefined && isDressedStoneSpriteKey(planted)) return planted;
  return OUTCROP_SPRITE_KEYS[positionHash(tx, ty) % OUTCROP_SPRITE_KEYS.length];
}

/**
 * A deposit past half its capacity is marked damaged on its tile by the node
 * ledger, and shows its worked-over look.
 */
export function drawRockDepositTile(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const tile = structure[ty][tx];
  const state = propSpriteState(tile.damageStage) === 'damaged' ? 'worked' : 'idle';
  drawSpriteKey(ctx, rockDepositSpriteKey(tile, tx, ty), state, 0, sx, sy, ts);
}
