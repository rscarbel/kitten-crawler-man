import type { TileContent } from '../tileTypes';
import {
  FloorTypeValue,
  TREE,
  FOUNTAIN,
  TORCH,
  WELL,
  GRASSY_WEED,
  DIRT_PATCH,
  BARREL_SIDE,
  CRATE,
  BRAZIER,
  BONES,
  MAIN_TOWER,
  SPRITE_BUILDING,
  MODERN_DECORATION,
  RUBBLE,
} from '../tileTypes';
import { inferFloorType } from './helpers';
import { drawTerrainTile } from './terrainTiles';
import { drawGroundTile } from './groundTiles';
import { drawSpecialFloorTile } from './specialFloorTiles';
import { drawSpriteKey, drawSprite, timeFrameIndex } from '../../core/SpriteRenderer';
import { drawFountainTileSlice } from '../../sprites/fountainSprite';
import { getSpriteDefByKey, getSpriteOverlayStatesByKey } from '../../core/SpriteLoader';
import { frameTime } from '../../utils';

/** Number of broken-stone chunks drawn per RUBBLE tile. */
const RUBBLE_CHUNK_COUNT = 4;
/** Number of fine grit specks per RUBBLE tile. */
const RUBBLE_GRIT_COUNT = 6;
/** Number of grass tufts drawn over the rubble so it blends into the lawn. */
const RUBBLE_TUFT_COUNT = 3;
const RUBBLE_TUFT_HEIGHT = 6;
/** Margin keeping the dirt patch off the tile edges so grass rings the debris. */
const RUBBLE_PATCH_INSET = 4;
/** Per-tile jitter applied to the dirt-patch position. */
const RUBBLE_PATCH_JITTER = 5;
/** Extra horizontal radius making the dirt patch an oval rather than a circle. */
const RUBBLE_PATCH_RX_EXTRA = 3;
const RUBBLE_CHUNK_MIN_SIZE = 3;
const RUBBLE_CHUNK_SIZE_VARIANCE = 4;

/** Playback rate of animated overlay states composited onto sprite buildings. */
const SPRITE_BUILDING_OVERLAY_FPS = 8;

export function drawDecorationTile(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  type: number,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
  baseOnly = false,
): boolean {
  if (baseOnly) {
    switch (type) {
      case TREE:
        // Trees are always outdoor tiles — draw grass directly rather than
        // inferring from neighbours, which fails for trees deep inside a
        // dense forest blob where all neighbours are also trees.
        drawTerrainTile(ctx, structure, FloorTypeValue.grass, sx, sy, ts, tx, ty);
        return true;
      case TORCH:
      case WELL:
      case FOUNTAIN:
      case BRAZIER:
      case MAIN_TOWER:
      case SPRITE_BUILDING:
      case MODERN_DECORATION: {
        const floorType = inferFloorType(structure, tx, ty);
        if (!drawTerrainTile(ctx, structure, floorType, sx, sy, ts, tx, ty)) {
          drawSpecialFloorTile(ctx, structure, floorType, sx, sy, ts, tx, ty);
        }
        return true;
      }
      default:
        return false;
    }
  }
  switch (type) {
    case TREE: {
      // Ground is already drawn by the baseOnly chunk-cache pass.
      // Re-drawing it here would wipe out the canopy-overhead of any
      // adjacent tree that already painted into this tile's space.
      switch (((Math.imul(tx, 2654435761) ^ Math.imul(ty, 2246822519)) >>> 0) % 6) {
        case 0:
          drawSpriteKey(ctx, 'tree_1', 'idle', 0, sx, sy, ts);
          break;
        case 1:
          drawSpriteKey(ctx, 'tree_2', 'idle', 0, sx, sy, ts);
          break;
        case 2:
          drawSpriteKey(ctx, 'tree_3', 'idle', 0, sx, sy, ts);
          break;
        case 3:
          drawSpriteKey(ctx, 'tree_4', 'idle', 0, sx, sy, ts);
          break;
        case 4:
          drawSpriteKey(ctx, 'tree_5', 'idle', 0, sx, sy, ts);
          break;
        default:
          drawSpriteKey(ctx, 'tree_6', 'idle', 0, sx, sy, ts);
          break;
      }
      return true;
    }

    case FOUNTAIN: {
      // Walk to the block's origin instead of testing the four neighbours: the
      // composition is authored for a 3×3 block, so a differently-sized
      // fountain clamps into it rather than drawing nine wrong slices.
      let blockX = 0;
      while (structure[ty]?.[tx - blockX - 1]?.type === FOUNTAIN) blockX++;
      let blockY = 0;
      while (structure[ty - blockY - 1]?.[tx]?.type === FOUNTAIN) blockY++;
      drawFountainTileSlice(ctx, sx, sy, ts, blockX, blockY, frameTime);
      return true;
    }

    // Torch — animated PNG sprite with transparent background
    case TORCH: {
      drawSpriteKey(ctx, 'torch', 'flicker', timeFrameIndex(frameTime, 8, 6), sx, sy, ts);
      return true;
    }

    // Well — PNG sprite with transparent background
    case WELL: {
      drawSpriteKey(ctx, 'well', 'idle', 0, sx, sy, ts);
      return true;
    }

    // Brazier — animated iron fire brazier, extends above tile
    case BRAZIER: {
      drawSpriteKey(ctx, 'brazier', 'flicker', timeFrameIndex(frameTime, 10, 4), sx, sy, ts);
      return true;
    }

    // Barrel on its side — PNG sprite, draw floor first
    case BARREL_SIDE: {
      const barrelSideFloor = inferFloorType(structure, tx, ty);
      if (!drawTerrainTile(ctx, structure, barrelSideFloor, sx, sy, ts, tx, ty)) {
        drawSpecialFloorTile(ctx, structure, barrelSideFloor, sx, sy, ts, tx, ty);
      }
      drawSpriteKey(ctx, 'barrel_side', 'idle', 0, sx, sy, ts);
      return true;
    }

    // Wooden crate — PNG sprite, draw floor first
    case CRATE: {
      const crateFloor = inferFloorType(structure, tx, ty);
      if (!drawTerrainTile(ctx, structure, crateFloor, sx, sy, ts, tx, ty)) {
        drawSpecialFloorTile(ctx, structure, crateFloor, sx, sy, ts, tx, ty);
      }
      drawSpriteKey(ctx, 'crate', 'idle', 0, sx, sy, ts);
      return true;
    }

    // Bones pile — walkable, procedural scattered bones drawn over floor
    case BONES: {
      const bonesFloor = inferFloorType(structure, tx, ty);
      if (!drawTerrainTile(ctx, structure, bonesFloor, sx, sy, ts, tx, ty)) {
        drawSpecialFloorTile(ctx, structure, bonesFloor, sx, sy, ts, tx, ty);
      }
      // Deterministic layout per tile position
      const bh1 = (tx * 37 + ty * 23) % 97;
      const bh2 = (tx * 61 + ty * 47) % 89;
      // Long bone 1 (femur/tibia shape — rounded ends, shaft)
      const b1x = sx + 5 + (bh1 % (ts - 22));
      const b1y = sy + 8 + (bh2 % (ts - 20));
      const b1a = (bh1 % 6) * 0.5;
      ctx.save();
      ctx.translate(b1x + 9, b1y + 4);
      ctx.rotate(b1a);
      ctx.fillStyle = '#d8d0b8';
      ctx.fillRect(-9, -2, 18, 4); // shaft
      ctx.beginPath();
      ctx.arc(-9, 0, 4, 0, Math.PI * 2);
      ctx.fill(); // knob left
      ctx.beginPath();
      ctx.arc(9, 0, 3.5, 0, Math.PI * 2);
      ctx.fill(); // knob right
      ctx.fillStyle = '#c0b8a0';
      ctx.fillRect(-8, -1, 16, 1); // highlight
      ctx.restore();
      // Long bone 2 (rotated opposite)
      const b2x = sx + 8 + (bh2 % (ts - 24));
      const b2y = sy + 12 + (bh1 % (ts - 24));
      const b2a = b1a + 1.1;
      ctx.save();
      ctx.translate(b2x + 8, b2y + 3);
      ctx.rotate(b2a);
      ctx.fillStyle = '#ccc4a8';
      ctx.fillRect(-7, -2, 14, 3);
      ctx.beginPath();
      ctx.arc(-7, 0, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(7, 0, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Small bone fragment / rib shard
      const b3x = sx + 10 + (bh1 % (ts - 20));
      const b3y = sy + 6 + (bh2 % (ts - 18));
      ctx.save();
      ctx.translate(b3x, b3y);
      ctx.rotate(bh2 * 0.15);
      ctx.fillStyle = '#e0d8c0';
      ctx.fillRect(0, -1, 10, 2);
      ctx.beginPath();
      ctx.arc(0, 0, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(10, 0, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return true;
    }

    // Grassy weed — walkable grass tile with decorative tufts and occasional flowers
    case GRASSY_WEED: {
      drawGroundTile(ctx, structure, sx, sy, ts, tx, ty);

      // Deterministic hash from tile position
      const h1 = (tx * 31 + ty * 17) % 97;
      const h2 = (tx * 53 + ty * 41) % 89;

      // First grass tuft. The blade colours track the generated grass material,
      // which is olive — the mint greens they replaced belonged to the retired
      // tileset and read as teal dashes on the new lawn.
      const t1x = sx + 3 + ((h1 * 7) % (ts - 12));
      const t1y = sy + 5 + ((h1 * 11) % (ts - 14));
      ctx.fillStyle = '#6b7f35';
      ctx.fillRect(t1x, t1y, 2, 7); // central blade
      ctx.fillRect(t1x - 3, t1y + 3, 2, 5); // left blade (angled out)
      ctx.fillRect(t1x + 3, t1y + 3, 2, 5); // right blade

      // Second smaller tuft
      const t2x = sx + 5 + ((h2 * 13) % (ts - 14));
      const t2y = sy + 4 + ((h2 * 7) % (ts - 14));
      ctx.fillStyle = '#55692a';
      ctx.fillRect(t2x, t2y, 2, 5);
      ctx.fillRect(t2x - 2, t2y + 2, 2, 3);
      ctx.fillRect(t2x + 2, t2y + 2, 2, 3);

      // Occasional small flower (about 1 in 9 tiles)
      if ((tx * 7 + ty * 13) % 9 === 0) {
        const fx = sx + 4 + (h1 % (ts - 10));
        const fy = sy + 4 + (h2 % (ts - 12));
        // Petals
        ctx.fillStyle = '#f0e040';
        ctx.beginPath();
        ctx.arc(fx, fy, 3, 0, Math.PI * 2);
        ctx.fill();
        // Centre
        ctx.fillStyle = '#e06010';
        ctx.beginPath();
        ctx.arc(fx, fy, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // Alternate: small purple wildflower
      if ((tx * 11 + ty * 7) % 13 === 0) {
        const fx = sx + 6 + (h2 % (ts - 14));
        const fy = sy + 5 + (h1 % (ts - 13));
        ctx.fillStyle = '#c060d8';
        ctx.beginPath();
        ctx.arc(fx, fy, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f0d000';
        ctx.beginPath();
        ctx.arc(fx, fy, 1, 0, Math.PI * 2);
        ctx.fill();
      }
      return true;
    }

    // Dirt patch — walkable road tile with pebble and soil texture
    case DIRT_PATCH: {
      drawGroundTile(ctx, structure, sx, sy, ts, tx, ty);

      // Deterministic hash from tile position
      const h1 = (tx * 29 + ty * 19) % 97;
      const h2 = (tx * 43 + ty * 37) % 89;

      // Darker soil blotch
      ctx.fillStyle = 'rgba(70,38,8,0.28)';
      ctx.beginPath();
      ctx.ellipse(
        sx + 5 + ((h1 * 7) % (ts - 12)),
        sy + 5 + ((h1 * 11) % (ts - 12)),
        5 + (h1 % 5),
        3 + (h1 % 4),
        (h1 % 5) * 0.3,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      // Second smaller blotch
      if (h2 % 3 !== 0) {
        ctx.fillStyle = 'rgba(60,30,5,0.18)';
        ctx.beginPath();
        ctx.ellipse(
          sx + 8 + ((h2 * 11) % (ts - 16)),
          sy + 7 + ((h2 * 7) % (ts - 16)),
          3 + (h2 % 3),
          2 + (h2 % 2),
          (h2 % 4) * 0.4,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }

      // Small pebbles
      ctx.fillStyle = '#8a6030';
      for (let i = 0; i < 3; i++) {
        const px = sx + 4 + ((h1 * (i * 7 + 3)) % (ts - 8));
        const py = sy + 4 + ((h2 * (i * 5 + 11)) % (ts - 8));
        ctx.beginPath();
        ctx.arc(px, py, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // Lighter pebble highlight
      ctx.fillStyle = '#c8a070';
      for (let i = 0; i < 2; i++) {
        const px = sx + 6 + ((h2 * (i * 9 + 5)) % (ts - 12));
        const py = sy + 6 + ((h1 * (i * 7 + 3)) % (ts - 12));
        ctx.beginPath();
        ctx.arc(px, py, 1, 0, Math.PI * 2);
        ctx.fill();
      }

      // Occasional crack/groove line
      if ((tx * 13 + ty * 11) % 7 === 0) {
        ctx.fillStyle = 'rgba(55,28,5,0.32)';
        const crx = sx + 5 + (h1 % (ts - 14));
        const cry = sy + 5 + (h2 % (ts - 14));
        ctx.fillRect(crx, cry, 1, 5 + (h1 % 6));
        ctx.fillRect(crx, cry, 4 + (h2 % 5), 1);
      }
      return true;
    }

    // Rubble — walkable ground clutter scattered across the Over City's ruined
    // outskirts. Drawn over the real grass sprite (like GRASSY_WEED) so the
    // debris dissolves into the surrounding lawn instead of reading as an
    // opaque square.
    case RUBBLE: {
      drawGroundTile(ctx, structure, sx, sy, ts, tx, ty);

      const h1 = (tx * 37 + ty * 23) % 97;
      const h2 = (tx * 59 + ty * 43) % 89;

      // A faint dirt patch under the debris cluster — smaller than the tile so
      // grass stays visible around every edge.
      const patchX = sx + RUBBLE_PATCH_INSET + (h1 % RUBBLE_PATCH_JITTER);
      const patchY = sy + RUBBLE_PATCH_INSET + (h2 % RUBBLE_PATCH_JITTER);
      const patchSize = ts - RUBBLE_PATCH_INSET * 2 - RUBBLE_PATCH_JITTER;
      ctx.fillStyle = 'rgba(74,70,62,0.55)';
      ctx.beginPath();
      ctx.ellipse(
        patchX + patchSize / 2,
        patchY + patchSize / 2,
        patchSize / 2 + RUBBLE_PATCH_RX_EXTRA,
        patchSize / 2,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();

      // Broken-stone chunks clustered on the dirt patch, varied sizes.
      for (let i = 0; i < RUBBLE_CHUNK_COUNT; i++) {
        const cx = patchX + ((h1 * (i + 1) * 7) % patchSize);
        const cy = patchY + ((h2 * (i + 1) * 5) % patchSize);
        const cw = RUBBLE_CHUNK_MIN_SIZE + ((h1 * (i + 3)) % RUBBLE_CHUNK_SIZE_VARIANCE);
        const chHeight = RUBBLE_CHUNK_MIN_SIZE + ((h2 * (i + 2)) % RUBBLE_CHUNK_SIZE_VARIANCE);
        ctx.fillStyle = i % 2 === 0 ? '#6a655a' : '#7a6f5e';
        ctx.fillRect(cx, cy, cw, chHeight);
        ctx.fillStyle = '#847e70';
        ctx.fillRect(cx, cy, cw, 1);
      }

      // Grass blades poking up between and over the chunk edges, so the
      // debris reads as half-swallowed by the lawn — which only works while the
      // blades are the lawn's colour, not the retired tileset's mint.
      ctx.fillStyle = '#6b7f35';
      for (let i = 0; i < RUBBLE_TUFT_COUNT; i++) {
        const gx = sx + 2 + ((h2 * (i * 13 + 5)) % (ts - 6));
        const gy = sy + 3 + ((h1 * (i * 9 + 7)) % (ts - 10));
        ctx.fillRect(gx, gy, 2, RUBBLE_TUFT_HEIGHT);
        ctx.fillRect(gx + 3, gy + 2, 2, RUBBLE_TUFT_HEIGHT - 2);
      }

      // Fine grit
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      for (let i = 0; i < RUBBLE_GRIT_COUNT; i++) {
        const px = patchX + ((h1 * (i * 11 + 3)) % patchSize);
        const py = patchY + ((h2 * (i * 7 + 5)) % patchSize);
        ctx.fillRect(px, py, 1, 1);
      }
      return true;
    }

    // Main overworld tower — large animated sprite, anchor at door-threshold level.
    // Frame 0 is the complete base tower; frames 1-3 are glow-only overlays composited on top.
    case MAIN_TOWER: {
      drawSpriteKey(ctx, 'overworld_main_tower', 'normal', 0, sx, sy, ts);
      const glowFrame = timeFrameIndex(frameTime, 4, 4);
      if (glowFrame > 0) {
        drawSpriteKey(ctx, 'overworld_main_tower', 'normal', glowFrame, sx, sy, ts);
      }
      return true;
    }

    // Sprite building — PNG-based building anchor tile.
    // The spriteKey on this tile selects which house image to render.
    case SPRITE_BUILDING: {
      const spriteKey = structure[ty][tx].spriteKey;
      if (spriteKey === undefined) return true;
      const def = getSpriteDefByKey(spriteKey);
      if (def === undefined) return true;
      const stateDef = def.states.get('idle');
      if (stateDef === undefined) return true;
      drawSprite(ctx, def, stateDef, 0, sx, sy, ts);
      // Any extra state is an animated overlay authored in the same frame-local
      // space as `idle` (e.g. the blacksmith's forge flames), so it composites on
      // top of the facade at the same anchor rather than replacing it.
      for (const overlayState of getSpriteOverlayStatesByKey(spriteKey)) {
        const overlayDef = def.states.get(overlayState);
        if (overlayDef === undefined) continue;
        const frame = timeFrameIndex(frameTime, SPRITE_BUILDING_OVERLAY_FPS, overlayDef.frameCount);
        drawSprite(ctx, def, overlayDef, frame, sx, sy, ts);
      }
      return true;
    }

    // Modern prop from the shared modern_decorations sprite sheet.
    // decorationVariant = row * 10 + col selects the specific item.
    case MODERN_DECORATION: {
      const variant = structure[ty][tx].decorationVariant ?? 0;
      const row = Math.floor(variant / 10);
      const col = variant % 10;
      const def = getSpriteDefByKey('modern_decorations');
      if (def === undefined) return true;
      const stateDef = def.states.get(`row_${row}`);
      if (stateDef === undefined) return true;
      const floorType = inferFloorType(structure, tx, ty);
      if (!drawTerrainTile(ctx, structure, floorType, sx, sy, ts, tx, ty)) {
        drawSpecialFloorTile(ctx, structure, floorType, sx, sy, ts, tx, ty);
      }
      drawSprite(ctx, def, stateDef, col, sx, sy, ts);
      return true;
    }

    default:
      return false;
  }
}
