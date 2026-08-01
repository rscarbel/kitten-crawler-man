import { TILE_SIZE } from '../core/constants';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { GameMap } from '../map/GameMap';
import {
  BARREL,
  BARREL_SIDE,
  BRAZIER,
  CRATE,
  TORCH,
  PROP_DAMAGE_STAGE_CRACKED,
} from '../map/tileTypes';
import { inferFloorType } from '../map/tiles/helpers';
import { drawSpriteKey, progressFrameIndex } from '../core/SpriteRenderer';
import { randomInt } from '../utils';
import type { GameSystem } from './GameSystem';
import type { LootSystem } from './LootSystem';
import { MELEE_POINT_BLANK_RANGE } from './CombatSystem';
import { tileKey } from './tileKey';

/** Half of TILE_SIZE — used to find the center of a tile from its top-left corner. */
const HALF_TILE = TILE_SIZE / 2;
/** Tile center offset as a fraction of tile size. */
const TILE_CENTER_OFFSET = 0.5;
/** Full turn in radians. */
const TWO_PI = Math.PI * 2;

/** The prop tile types a melee swing can break. */
export type DestructiblePropKind = 'barrel' | 'barrel_side' | 'crate' | 'torch' | 'brazier';

const BARREL_HP = 6;
const BARREL_SIDE_HP = 5;
const CRATE_HP = 6;
/** A torch is a stick in a stand — the flimsiest of the props. */
const TORCH_HP = 4;
/** All iron and squat with it, so a brazier takes the most punishment of the lot. */
const BRAZIER_HP = 9;
/**
 * HP a prop that is already wearing its cracked art comes back missing when its
 * health entry has to be rebuilt. It cannot come back at full: `damageStage`
 * outlives this system, so an undamaged rebuild would show damaged art.
 */
const CRACKED_REBUILD_HP_PENALTY = 1;
/** Frames a prop flashes white after being struck. */
const HIT_FLASH_FRAMES = 6;
/** Peak opacity of the hit flash. */
const HIT_FLASH_MAX_ALPHA = 0.5;
/** Radius of the hit flash glow, as a fraction of a tile. */
const HIT_FLASH_RADIUS_TILE_FRACTION = 0.55;
const HIT_FLASH_RADIUS_PX = TILE_SIZE * HIT_FLASH_RADIUS_TILE_FRACTION;

const SHATTER_FRAME_COUNT = 6;
const SHATTER_FRAMES_PER_STEP = 5;
const SHATTER_TOTAL_FRAMES = SHATTER_FRAME_COUNT * SHATTER_FRAMES_PER_STEP;

/** 60 s at 60 fps. */
const WRECKAGE_LIFETIME_FRAMES = 3600;
const WRECKAGE_FADE_FRAMES = 240;
/** Past this many decals the oldest is dropped, so a long floor can't grow unbounded. */
const MAX_WRECKAGE = 60;

const SPLINTER_COUNT_MIN = 10;
const SPLINTER_COUNT_MAX = 16;
const SPLINTER_SPEED_MIN = 1.2;
const SPLINTER_SPEED_MAX = 3.0;
/**
 * Deliberately light. Undamped, a splinter living 50 frames under the
 * blood-spatter gravity would sink three tiles — the debris would end up well
 * south of the prop it came out of instead of scattered around it.
 */
const SPLINTER_GRAVITY = 0.03;
const SPLINTER_DRAG = 0.94;
const SPLINTER_LIFETIME_MIN = 30;
const SPLINTER_LIFETIME_MAX = 50;
/** Fraction of splinters thrown away from the puncher rather than in a full circle. */
const SPLINTER_FORWARD_CONE_BIAS = 0.7;
/** Half-angle of that forward cone. */
const SPLINTER_FORWARD_CONE_NUMERATOR = 2;
const SPLINTER_FORWARD_CONE_DENOMINATOR = 3;
const SPLINTER_FORWARD_CONE_HALF_ANGLE =
  Math.PI * (SPLINTER_FORWARD_CONE_NUMERATOR / SPLINTER_FORWARD_CONE_DENOMINATOR);
const SPLINTER_LENGTH_MIN = 3;
const SPLINTER_LENGTH_MAX = 7;
const SPLINTER_WIDTH = 1.6;
const SPLINTER_SPIN_MAX = 0.3;
/** Splinters spawn scattered up to this far either side of their origin. */
const SPLINTER_SPAWN_SCATTER_PX = 4;
/**
 * Where a kind's splinters come off, in tile heights relative to the tile
 * centre: the middle of the prop's own mass, and the span its pieces reach over.
 *
 * The boxy props are a tile wide and sit inside their tile, so a point source at
 * its centre is exactly right. A torch is a pole standing a tile above the floor
 * — spawning its debris at the tile centre would drop the whole burst around the
 * player's feet instead of down the length of the thing that just snapped.
 */
const SPLINTER_ORIGIN_OFFSET_TILES: Record<DestructiblePropKind, number> = {
  barrel: 0,
  barrel_side: 0,
  crate: 0,
  torch: -0.16,
  brazier: -0.06,
};
const SPLINTER_ORIGIN_SPAN_TILES: Record<DestructiblePropKind, number> = {
  barrel: 0,
  barrel_side: 0,
  crate: 0,
  torch: 1.05,
  brazier: 0.3,
};
/** Splinters fade over the last third of their life. */
const SPLINTER_FADE_DIVISOR = 3;
const SPLINTER_FADE_FRACTION = 1 / SPLINTER_FADE_DIVISOR;

/** A uniform random number in [-1, 1]. */
const bipolarRandom = () => Math.random() * 2 - 1;

/** Wood tones for the splinter shards — the same ramp the prop sheets are drawn in. */
const WOOD_SPLINTER_SHADES = ['#3a2413', '#5a3a1e', '#7a5028', '#9a6a38', '#c09050'] as const;
/**
 * Bent iron and spilled coals, for the one prop with no wood in it. Sharing the
 * wood ramp would throw brown splinters out of an iron bowl.
 */
const IRON_SPLINTER_SHADES = ['#3a4048', '#4a5058', '#6b7480', '#ff8a1e', '#e2450f'] as const;

/** What a prop is chiefly made of, which decides how its break sounds and looks. */
type PropMaterial = 'wood' | 'iron';

function materialFor(kind: DestructiblePropKind): PropMaterial {
  return kind === 'brazier' ? 'iron' : 'wood';
}

/** The debris palette a kind throws when it breaks. */
function splinterShadesFor(kind: DestructiblePropKind): ReadonlyArray<string> {
  return materialFor(kind) === 'iron' ? IRON_SPLINTER_SHADES : WOOD_SPLINTER_SHADES;
}

/** Breaks that happened since the scene last drained them, by material. */
export type SmashCounts = Record<PropMaterial, number>;

/**
 * Damage large enough to flatten any prop in one application, whatever its
 * remaining health. Used by blasts, which have no business chipping a crate.
 */
const INSTANT_DESTROY_DAMAGE = Number.MAX_SAFE_INTEGER;

/** Coins a break drops: floor 1 → 1–2, floor 2 → 2–3, and so on. */
const COIN_SPREAD = 1;

interface PropHealth {
  tileX: number;
  tileY: number;
  kind: DestructiblePropKind;
  hp: number;
  maxHp: number;
  hitFlashFrames: number;
}

interface ShatterBurst {
  tileX: number;
  tileY: number;
  kind: DestructiblePropKind;
  frames: number;
}

interface Wreckage {
  tileX: number;
  tileY: number;
  kind: DestructiblePropKind;
  life: number;
}

interface Splinter {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  length: number;
  shade: string;
  life: number;
  maxLife: number;
}

function kindForTileType(type: number): DestructiblePropKind | null {
  if (type === BARREL) return 'barrel';
  if (type === BARREL_SIDE) return 'barrel_side';
  if (type === CRATE) return 'crate';
  if (type === TORCH) return 'torch';
  if (type === BRAZIER) return 'brazier';
  return null;
}

function startingHpFor(kind: DestructiblePropKind): number {
  if (kind === 'barrel') return BARREL_HP;
  if (kind === 'barrel_side') return BARREL_SIDE_HP;
  if (kind === 'torch') return TORCH_HP;
  if (kind === 'brazier') return BRAZIER_HP;
  return CRATE_HP;
}

/**
 * Lets a melee swing break the barrels, crates and torches strewn through a
 * dungeon floor: the prop cracks, then shatters into splinters and a wreckage decal,
 * the tile opens up for both players and mob pathfinding, and a small
 * depth-scaled coin drop is left behind.
 *
 * Prop health is created lazily on the first hit, so a floor carrying thousands
 * of props costs nothing until the player actually swings at one.
 */
export class DestructiblePropSystem implements GameSystem {
  private readonly health = new Map<string, PropHealth>();
  private readonly bursts: ShatterBurst[] = [];
  private readonly wreckage: Wreckage[] = [];
  private readonly splinters: Splinter[] = [];
  private readonly smashCounts: SmashCounts = { wood: 0, iron: 0 };

  constructor(
    private readonly gameMap: GameMap,
    private readonly loot: LootSystem,
    private readonly floorNumber: number,
  ) {}

  /**
   * Resolve a melee swing against every destructible prop in range.
   * Returns true if at least one prop was struck.
   *
   * A single swing can hit several props — that is what makes clearing a crate
   * stack feel worth doing.
   */
  tryMeleeHit(attacker: HumanPlayer | CatPlayer, range: number, damage: number): boolean {
    return this.damagePropsInRange(
      attacker.x + HALF_TILE,
      attacker.y + HALF_TILE,
      range,
      damage,
      attacker,
      { x: attacker.facingX, y: attacker.facingY },
    );
  }

  /**
   * Resolve an area attack against every destructible prop inside its radius.
   * Unlike a swing there is no facing cone — a stomp comes down on everything
   * around the player, behind them included.
   */
  tryAreaHit(attacker: HumanPlayer | CatPlayer, radius: number, damage: number): boolean {
    return this.damagePropsInRange(
      attacker.x + HALF_TILE,
      attacker.y + HALF_TILE,
      radius,
      damage,
      attacker,
      null,
    );
  }

  /**
   * Resolve a projectile impact at a world point. Returns true if it struck a
   * prop, which the caller uses to detonate the projectile.
   */
  tryProjectileHit(
    x: number,
    y: number,
    radius: number,
    damage: number,
    owner: HumanPlayer | CatPlayer,
  ): boolean {
    return this.damagePropsInRange(x, y, radius, damage, owner, null);
  }

  /**
   * Flatten every prop inside a blast, whatever its remaining health. A stick
   * of dynamite does not chip a crate.
   */
  destroyInRadius(x: number, y: number, radius: number, owner: HumanPlayer | CatPlayer): boolean {
    return this.damagePropsInRange(x, y, radius, INSTANT_DESTROY_DAMAGE, owner, null);
  }

  private damagePropsInRange(
    originX: number,
    originY: number,
    range: number,
    damage: number,
    owner: HumanPlayer | CatPlayer,
    facing: { x: number; y: number } | null,
  ): boolean {
    const originTileX = Math.floor(originX / TILE_SIZE);
    const originTileY = Math.floor(originY / TILE_SIZE);
    const searchRadiusTiles = Math.ceil(range / TILE_SIZE) + 1;

    const structure = this.gameMap.structure;
    const firstTileY = Math.max(0, originTileY - searchRadiusTiles);
    const lastTileY = Math.min(structure.length - 1, originTileY + searchRadiusTiles);

    let hitAnything = false;
    for (let ty = firstTileY; ty <= lastTileY; ty++) {
      const row = structure[ty];
      const firstTileX = Math.max(0, originTileX - searchRadiusTiles);
      const lastTileX = Math.min(row.length - 1, originTileX + searchRadiusTiles);
      for (let tx = firstTileX; tx <= lastTileX; tx++) {
        const tile = row[tx];
        const kind = kindForTileType(tile.type);
        if (kind === null) continue;

        const centerX = (tx + TILE_CENTER_OFFSET) * TILE_SIZE;
        const centerY = (ty + TILE_CENTER_OFFSET) * TILE_SIZE;
        const dx = centerX - originX;
        const dy = centerY - originY;
        const dist = Math.hypot(dx, dy);
        if (dist === 0 || dist > range) continue;
        // Same forward hemisphere the mob filter uses, so props and mobs answer
        // to the same swing.
        if (facing !== null && dist > MELEE_POINT_BLANK_RANGE) {
          const dot = (dx / dist) * facing.x + (dy / dist) * facing.y;
          if (dot <= 0) continue;
        }
        // Melee reaches a little under two tiles, far enough to clip a prop
        // through a wall — without this the player could pop crates in a room
        // they have not entered. The prop's own tile is named as exempt so the
        // test stays correct however the ray decides to treat its end tile.
        if (
          !this.gameMap.hasLineOfSight(originX, originY, centerX, centerY, { tileX: tx, tileY: ty })
        )
          continue;

        hitAnything = true;
        const key = tileKey(tx, ty);
        let health = this.health.get(key);
        if (health === undefined) {
          const maxHp = startingHpFor(kind);
          // A prop already wearing its cracked art must not rebuild at full
          // health: `damageStage` lives on the GameMap, which outlives this
          // system, so an undamaged rebuild would show damaged art.
          const wasCracked = tile.damageStage === PROP_DAMAGE_STAGE_CRACKED;
          const startingHp = wasCracked ? Math.max(1, maxHp - CRACKED_REBUILD_HP_PENALTY) : maxHp;
          health = { tileX: tx, tileY: ty, kind, hp: startingHp, maxHp, hitFlashFrames: 0 };
          this.health.set(key, health);
        }
        health.hp -= damage;
        health.hitFlashFrames = HIT_FLASH_FRAMES;

        if (health.hp <= 0) {
          this.breakProp(tx, ty, kind, owner, originX, originY);
          this.health.delete(key);
        } else {
          // Any damage at all cracks the art: a swing that lands but leaves the
          // prop looking untouched reads as a swing that missed. No chunk
          // invalidation needed — props draw live in the Y-sorted pass.
          tile.damageStage = PROP_DAMAGE_STAGE_CRACKED;
        }
      }
    }
    return hitAnything;
  }

  /**
   * Smashes drained by DungeonScene to fire the break cues, split by material so
   * an iron brazier does not collapse to the sound of splitting planks.
   */
  drainSmashes(): SmashCounts {
    const counts = { ...this.smashCounts };
    this.smashCounts.wood = 0;
    this.smashCounts.iron = 0;
    return counts;
  }

  private breakProp(
    tileX: number,
    tileY: number,
    kind: DestructiblePropKind,
    attacker: HumanPlayer | CatPlayer,
    impactFromX: number,
    impactFromY: number,
  ): void {
    const tile = this.gameMap.structure[tileY][tileX];
    tile.type = tile.groundType ?? inferFloorType(this.gameMap.structure, tileX, tileY);
    delete tile.damageStage;
    delete tile.groundType;
    this.gameMap.markTileDirty(tileX, tileY);

    this.bursts.push({ tileX, tileY, kind, frames: 0 });

    const centerX = (tileX + TILE_CENTER_OFFSET) * TILE_SIZE;
    const centerY = (tileY + TILE_CENTER_OFFSET) * TILE_SIZE;
    this.spawnSplinters(centerX, centerY, centerX - impactFromX, centerY - impactFromY, kind);

    this.wreckage.push({ tileX, tileY, kind, life: WRECKAGE_LIFETIME_FRAMES });
    while (this.wreckage.length > MAX_WRECKAGE) this.dropOldestWreckage();

    this.loot.addLoot(
      centerX,
      centerY,
      { coins: randomInt(this.floorNumber, this.floorNumber + COIN_SPREAD), items: [] },
      attacker,
      false,
      // Both players are paid the full amount: floor 1 can roll a single coin,
      // and splitting that would pay one of them nothing.
      true,
    );

    this.smashCounts[materialFor(kind)]++;
  }

  /**
   * Drop the decal closest to expiry. Cannot just shift the head off: `update`
   * retires expired entries by swapping the last one into their slot, so the
   * array is not in age order.
   */
  private dropOldestWreckage(): void {
    let oldestIndex = 0;
    for (let i = 1; i < this.wreckage.length; i++) {
      if (this.wreckage[i].life < this.wreckage[oldestIndex].life) oldestIndex = i;
    }
    this.wreckage.splice(oldestIndex, 1);
  }

  private spawnSplinters(
    cx: number,
    cy: number,
    awayX: number,
    awayY: number,
    kind: DestructiblePropKind,
  ): void {
    const hasDirection = awayX !== 0 || awayY !== 0;
    const awayAngle = hasDirection ? Math.atan2(awayY, awayX) : 0;
    const count = randomInt(SPLINTER_COUNT_MIN, SPLINTER_COUNT_MAX);
    const originY = cy + SPLINTER_ORIGIN_OFFSET_TILES[kind] * TILE_SIZE;
    const originHalfSpan = (SPLINTER_ORIGIN_SPAN_TILES[kind] * TILE_SIZE) / 2;
    const shades = splinterShadesFor(kind);

    for (let i = 0; i < count; i++) {
      const inForwardCone = hasDirection && Math.random() < SPLINTER_FORWARD_CONE_BIAS;
      const angle = inForwardCone
        ? awayAngle + bipolarRandom() * SPLINTER_FORWARD_CONE_HALF_ANGLE
        : Math.random() * TWO_PI;
      const speed = SPLINTER_SPEED_MIN + Math.random() * (SPLINTER_SPEED_MAX - SPLINTER_SPEED_MIN);
      const life = randomInt(SPLINTER_LIFETIME_MIN, SPLINTER_LIFETIME_MAX);
      this.splinters.push({
        x: cx + bipolarRandom() * SPLINTER_SPAWN_SCATTER_PX,
        y: originY + bipolarRandom() * originHalfSpan + bipolarRandom() * SPLINTER_SPAWN_SCATTER_PX,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        angle: Math.random() * TWO_PI,
        spin: bipolarRandom() * SPLINTER_SPIN_MAX,
        length: SPLINTER_LENGTH_MIN + Math.random() * (SPLINTER_LENGTH_MAX - SPLINTER_LENGTH_MIN),
        shade: shades[Math.floor(Math.random() * shades.length)],
        life,
        maxLife: life,
      });
    }
  }

  update(): void {
    for (const health of this.health.values()) {
      if (health.hitFlashFrames > 0) health.hitFlashFrames--;
    }

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      this.bursts[i].frames++;
      if (this.bursts[i].frames >= SHATTER_TOTAL_FRAMES) {
        this.bursts[i] = this.bursts[this.bursts.length - 1];
        this.bursts.pop();
      }
    }

    for (let i = this.splinters.length - 1; i >= 0; i--) {
      const s = this.splinters[i];
      s.x += s.vx;
      s.y += s.vy;
      s.vy = (s.vy + SPLINTER_GRAVITY) * SPLINTER_DRAG;
      s.vx *= SPLINTER_DRAG;
      s.angle += s.spin;
      s.life--;
      if (s.life <= 0) {
        this.splinters[i] = this.splinters[this.splinters.length - 1];
        this.splinters.pop();
      }
    }

    for (let i = this.wreckage.length - 1; i >= 0; i--) {
      this.wreckage[i].life--;
      if (this.wreckage[i].life <= 0) {
        this.wreckage[i] = this.wreckage[this.wreckage.length - 1];
        this.wreckage.pop();
      }
    }
  }

  /** Settled debris, drawn on the floor beneath everything else in the world. */
  renderWreckage(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const w of this.wreckage) {
      const alpha = w.life < WRECKAGE_FADE_FRAMES ? w.life / WRECKAGE_FADE_FRAMES : 1;
      drawSpriteKey(
        ctx,
        w.kind,
        'remains',
        0,
        w.tileX * TILE_SIZE - camX,
        w.tileY * TILE_SIZE - camY,
        TILE_SIZE,
        { alpha },
      );
    }
  }

  /**
   * The break itself: the impact flash on props that survived the swing, the
   * shatter animation, and the flying splinters.
   */
  renderEffects(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const health of this.health.values()) {
      if (health.hitFlashFrames <= 0) continue;
      const flash = (health.hitFlashFrames / HIT_FLASH_FRAMES) * HIT_FLASH_MAX_ALPHA;
      const sx = (health.tileX + TILE_CENTER_OFFSET) * TILE_SIZE - camX;
      // Struck on the prop's own mass, which for a torch is up the pole rather
      // than in the middle of the tile it stands on.
      const sy =
        (health.tileY + TILE_CENTER_OFFSET + SPLINTER_ORIGIN_OFFSET_TILES[health.kind]) *
          TILE_SIZE -
        camY;
      const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, HIT_FLASH_RADIUS_PX);
      glow.addColorStop(0, `rgba(255,240,210,${flash})`);
      glow.addColorStop(1, 'rgba(255,240,210,0)');
      ctx.save();
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(sx, sy, HIT_FLASH_RADIUS_PX, 0, TWO_PI);
      ctx.fill();
      ctx.restore();
    }

    for (const burst of this.bursts) {
      drawSpriteKey(
        ctx,
        burst.kind,
        'shatter',
        progressFrameIndex(burst.frames / SHATTER_TOTAL_FRAMES, SHATTER_FRAME_COUNT),
        burst.tileX * TILE_SIZE - camX,
        burst.tileY * TILE_SIZE - camY,
        TILE_SIZE,
      );
    }

    for (const s of this.splinters) {
      const fadeFrames = s.maxLife * SPLINTER_FADE_FRACTION;
      ctx.save();
      ctx.globalAlpha = s.life < fadeFrames ? s.life / fadeFrames : 1;
      ctx.translate(s.x - camX, s.y - camY);
      ctx.rotate(s.angle);
      ctx.fillStyle = s.shade;
      ctx.fillRect(-s.length / 2, -SPLINTER_WIDTH / 2, s.length, SPLINTER_WIDTH);
      ctx.restore();
    }
  }
}
