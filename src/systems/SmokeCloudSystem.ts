import { TILE_SIZE } from '../core/constants';
import {
  allocCanvas,
  freshSurfaceContext,
  releaseSurface,
  type CanvasSurface,
} from '../core/rendering/canvasSurface';
import { platform } from '../core/input/Platform';
import type { Camera } from '../core/rendering/camera';
import type { SpatialGrid } from '../core/world/SpatialGrid';
import type { Mob } from '../creatures/Mob';
import { worldPalette } from '../ui/theme/worldInk';
import { worldText } from '../ui/world/worldText';

/** How long a smoke bomb's cloud hangs where it burst. */
const SMOKE_CLOUD_SECONDS = 6;
/** How far the cloud reaches from where the bomb burst, in tiles. */
const SMOKE_CLOUD_RADIUS_TILES = 4;

const GAME_FRAMES_PER_SECOND = 60;
const SMOKE_CLOUD_FRAMES = SMOKE_CLOUD_SECONDS * GAME_FRAMES_PER_SECOND;
const SMOKE_CLOUD_RADIUS_PX = SMOKE_CLOUD_RADIUS_TILES * TILE_SIZE;

const TILE_CENTRE_FRACTION = 0.5;
const HALF_TILE = TILE_SIZE * TILE_CENTRE_FRACTION;

/** One soft puff of the baked cloud: its offset and radius as shares of the cloud's radius. */
interface CloudBlob {
  readonly dx: number;
  readonly dy: number;
  readonly sr: number;
}

const CLOUD_BLOBS: readonly CloudBlob[] = [
  { dx: 0.0, dy: 0.0, sr: 0.44 },
  { dx: 0.38, dy: -0.28, sr: 0.37 },
  { dx: -0.38, dy: -0.22, sr: 0.35 },
  { dx: 0.52, dy: 0.22, sr: 0.31 },
  { dx: -0.5, dy: 0.28, sr: 0.32 },
  { dx: 0.18, dy: 0.48, sr: 0.3 },
  { dx: -0.22, dy: 0.44, sr: 0.28 },
  { dx: 0.42, dy: -0.46, sr: 0.27 },
  { dx: -0.42, dy: -0.42, sr: 0.25 },
];

const MOBILE_CLOUD_BLOB_COUNT = 5;
/**
 * A phone bakes fewer puffs: the bake is an offscreen fill per puff, paid on
 * the frame the bomb bursts.
 */
const BAKED_BLOBS = platform.isMobile ? CLOUD_BLOBS.slice(0, MOBILE_CLOUD_BLOB_COUNT) : CLOUD_BLOBS;

/** Room round the cloud's rim in the baked texture, so the outermost puffs are not clipped. */
const BAKE_MARGIN_PX = 4;
const BAKE_SIZE_FACTOR = 2;
const SMOKE_CORE_INK = 'rgba(215, 215, 225, 0.72)';
const SMOKE_BODY_INK = 'rgba(200, 200, 215, 0.45)';
const SMOKE_EDGE_INK = 'rgba(185, 185, 205, 0)';
/** Where in each puff's radius the dense core gives way to the thinner body. */
const SMOKE_BODY_STOP = 0.55;

const FADE_IN_FRAMES = 40;
const FADE_OUT_FRAMES = 60;
const PULSE_BASE = 0.92;
const PULSE_RANGE = 0.08;
const PULSE_FREQ = 0.04;
const TIMER_ALPHA_SHARE = 0.8;
const TIMER_TEXT_SIZE = 10;
const TIMER_Y_OFFSET = 14;

interface SmokeCloud {
  readonly x: number;
  readonly y: number;
  framesLeft: number;
  /** The cloud's texture, baked once when it bursts. */
  readonly texture: CanvasSurface;
  readonly textureSize: number;
}

function bakeSmokeCloud(): { texture: CanvasSurface; textureSize: number } {
  const textureSize = Math.ceil((SMOKE_CLOUD_RADIUS_PX + BAKE_MARGIN_PX) * BAKE_SIZE_FACTOR);
  const texture = allocCanvas('smokeClouds', textureSize, textureSize);
  const ctx = freshSurfaceContext(texture);
  const centre = textureSize * TILE_CENTRE_FRACTION;
  for (const blob of BAKED_BLOBS) {
    const bx = centre + blob.dx * SMOKE_CLOUD_RADIUS_PX;
    const by = centre + blob.dy * SMOKE_CLOUD_RADIUS_PX;
    const br = blob.sr * SMOKE_CLOUD_RADIUS_PX;
    const grad = ctx.createRadialGradient(bx, by, 0, bx, by, br);
    grad.addColorStop(0, SMOKE_CORE_INK);
    grad.addColorStop(SMOKE_BODY_STOP, SMOKE_BODY_INK);
    grad.addColorStop(1, SMOKE_EDGE_INK);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
  }
  return { texture, textureSize };
}

/**
 * The clouds smoke bombs leave where they burst, and the confusion they cast
 * on every enemy standing inside one: a confused mob loses track of the
 * crawlers until it walks out or the cloud thins away.
 *
 * Owned by the map's roster, so the dynamite that throws the bomb and the
 * combat kit that ticks and draws the cloud reach the same clouds, and a cloud
 * stays on the storey it burst on.
 */
export class SmokeCloudSystem {
  private clouds: SmokeCloud[] = [];
  private readonly querySet = new Set<Mob>();
  /** Mobs confused by a cloud last frame — only these need their flag cleared. */
  private readonly confusedLastFrame: Mob[] = [];
  /** Display names of confusion-immune enemies standing in a cloud, awaiting a toast. */
  private readonly resistedNames: string[] = [];

  /** Bursts a fresh cloud centred on the world point (`x`, `y`). */
  burst(x: number, y: number): void {
    const { texture, textureSize } = bakeSmokeCloud();
    this.clouds.push({ x, y, framesLeft: SMOKE_CLOUD_FRAMES, texture, textureSize });
  }

  /**
   * Clears every cloud. A rewind and a walk off the map are the same here:
   * nothing about a cloud is spent that leaving could refund.
   */
  reset(): void {
    for (const cloud of this.clouds) releaseSurface(cloud.texture);
    this.clouds = [];
    // A mob's own isConfused flag lives on the mob; without this, a mob
    // confused at the moment the clouds were dropped stays confused forever,
    // since only this list ever unwinds it.
    for (const mob of this.confusedLastFrame) mob.isConfused = false;
    this.confusedLastFrame.length = 0;
    this.resistedNames.length = 0;
  }

  /**
   * Drains the names of enemies that shrugged off a cloud this frame, so the
   * scene can toast them. Queued per frame while the mob stands in the cloud;
   * the hotbar toast dedupes identical text, so the repetition is harmless.
   */
  takeFogResistedNames(): string[] {
    if (this.resistedNames.length === 0) return [];
    const drained = this.resistedNames.slice();
    this.resistedNames.length = 0;
    return drained;
  }

  /** Thins every cloud by a frame and re-marks the mobs standing inside one as confused. */
  update(mobGrid: SpatialGrid<Mob>): void {
    for (const mob of this.confusedLastFrame) mob.isConfused = false;
    this.confusedLastFrame.length = 0;
    // Cleared here rather than only by the drain: a scene that never drains it
    // would otherwise grow the buffer by one string per immune mob per frame.
    this.resistedNames.length = 0;
    this.clouds = this.clouds.filter((cloud) => {
      cloud.framesLeft--;
      if (cloud.framesLeft <= 0) {
        releaseSurface(cloud.texture);
        return false;
      }
      this.confuseMobsInside(cloud, mobGrid);
      return true;
    });
  }

  private confuseMobsInside(cloud: SmokeCloud, mobGrid: SpatialGrid<Mob>): void {
    this.querySet.clear();
    // The extra tile is the grid's: it keys mobs by their top-left corner
    // while the test below measures centres.
    const nearby = mobGrid.queryCircle(
      cloud.x,
      cloud.y,
      SMOKE_CLOUD_RADIUS_PX + TILE_SIZE,
      this.querySet,
    );
    const radiusSq = SMOKE_CLOUD_RADIUS_PX * SMOKE_CLOUD_RADIUS_PX;
    for (const mob of nearby) {
      if (!mob.isAlive || mob.wardedFromParty) continue;
      const dx = mob.x + HALF_TILE - cloud.x;
      const dy = mob.y + HALF_TILE - cloud.y;
      if (dx * dx + dy * dy > radiusSq) continue;
      if (mob.immuneToConfusion) {
        // Only enemies are worth a "sees you through the smoke" notice. The
        // cat's own pet is immune too, and toasting that their companion
        // resisted the bomb reads as the pet turning on them.
        if (mob.isHostile) this.resistedNames.push(mob.displayName);
        continue;
      }
      if (!mob.isConfused) {
        mob.isConfused = true;
        this.confusedLastFrame.push(mob);
      }
    }
  }

  render(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const { x: camX, y: camY } = camera;
    const viewW = camera.viewWidth;
    const viewH = camera.viewHeight;
    for (const cloud of this.clouds) {
      const cx = cloud.x - camX;
      const cy = cloud.y - camY;
      const half = cloud.textureSize * TILE_CENTRE_FRACTION;
      const offscreen = cx + half < 0 || cy + half < 0 || cx - half > viewW || cy - half > viewH;
      if (offscreen) continue;

      const ageFrames = SMOKE_CLOUD_FRAMES - cloud.framesLeft;
      const fadeIn = Math.min(1, ageFrames / FADE_IN_FRAMES);
      const fadeOut = Math.min(1, cloud.framesLeft / FADE_OUT_FRAMES);
      const alpha = Math.min(fadeIn, fadeOut);
      const pulse = PULSE_BASE + PULSE_RANGE * Math.sin(cloud.framesLeft * PULSE_FREQ);
      const drawnSize = cloud.textureSize * pulse;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(cloud.texture, cx - half * pulse, cy - half * pulse, drawnSize, drawnSize);
      ctx.restore();

      worldText(ctx, `${Math.ceil(cloud.framesLeft / GAME_FRAMES_PER_SECOND)}s`, {
        x: cx,
        y: cy - SMOKE_CLOUD_RADIUS_PX - TIMER_Y_OFFSET,
        size: TIMER_TEXT_SIZE,
        bold: true,
        color: worldPalette.spell.smokeCloudTimer,
        alpha: alpha * TIMER_ALPHA_SHARE,
        align: 'center',
      });
    }
  }
}
