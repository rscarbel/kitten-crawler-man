/**
 * Blits one frame of a baked town sheet at a prop's anchor tile.
 *
 * The town's street furniture is addressed by keys built at runtime — a
 * gateway's key carries its span, a laundry line's its alley width — so it
 * cannot go through `drawSpriteKey`, whose key type is the compile-time union of
 * every manifest entry. This resolves the same way `SPRITE_BUILDING` does, by
 * key string, and reduces a prop's whole render to one `drawImage`.
 *
 * A missing sheet draws nothing rather than throwing. The sheets are generated
 * from the town plan (`scripts/generate-townscape-sprites.ts`), so the only way
 * to reach a key with no entry is to move a gate or an alley without
 * regenerating — and a town that renders without its bunting is a better failure
 * than one that will not render at all.
 */

import { getSpriteDefByKey } from '../core/SpriteLoader';
import { drawSprite } from '../core/SpriteRenderer';

export function drawTownSheetFrame(
  ctx: CanvasRenderingContext2D,
  key: string,
  state: string,
  frame: number,
  sx: number,
  sy: number,
  tileSize: number,
): void {
  const def = getSpriteDefByKey(key);
  if (def === undefined) return;
  const stateDef = def.states.get(state);
  if (stateDef === undefined) return;
  drawSprite(ctx, def, stateDef, frame, sx, sy, tileSize);
}
