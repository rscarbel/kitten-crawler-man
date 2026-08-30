import { COCKROACH_FIGURE } from '../sprites/art/cockroachFigure';
import { RAT_FIGURE } from '../sprites/art/ratFigure';
import { LICH_FIGURE } from '../sprites/art/lichFigure';
import {
  SKELETON_ARCHER_FIGURE,
  SKELETON_LORD_FIGURE,
  SKELETON_SWORD_FIGURE,
} from '../sprites/art/skeletonFigure';
import type { GameSystem } from './GameSystem';
import type { FigureDef } from '../sprites/figure/figureDef';
import {
  drawFigureCachedRotatedCenter,
  figureInkRadiusPx,
} from '../sprites/figure/figureFrameCache';
import { COCKROACH_BODY_PART_KEY, COCKROACH_GORE_PARTS } from '../sprites/cockroachSprite';
import { HOARDER_BODY_PART_KEY, HOARDER_GORE_PARTS } from '../sprites/hoarderSprite';
import type { GameMap } from '../map/GameMap';
import { GOBLIN_GORE_PARTS, goblinFigure } from '../sprites/goblinSprite';
import { RAT_BODY_PART_KEY, RAT_GORE_PARTS } from '../sprites/ratSprite';
import { LLAMA_BODY_PART_KEY, LLAMA_GORE_PARTS } from '../sprites/llamaSprite';
import { LLAMA_FIGURE } from '../sprites/art/llamaFigure';
import { BRINDLED_VESPA_FIGURE } from '../sprites/art/brindledVespaFigure';
import {
  SKELETON_ARCHER_BODY_PART_KEY,
  SKELETON_GORE_PARTS,
  SKELETON_LORD_BODY_PART_KEY,
  SKELETON_SWORD_BODY_PART_KEY,
} from '../sprites/skeletonSprite';
import { LICH_BODY_PART_KEY } from '../sprites/lichSprite';
import {
  MANTID_BODY_PART_KEY,
  MANTID_GORE_PARTS,
  MANTIS_BODY_PART_KEY,
} from '../sprites/mantidSprite';
import { EVIL_CLOWN_BODY_PART_KEY, EVIL_CLOWN_GORE_PARTS } from '../sprites/evilClownSprite';
import { EVIL_CLOWN_FIGURE } from '../sprites/art/clownFigure';
import {
  ROCK_GOLEM_BODY_PART_KEY,
  ROCK_GOLEM_BOSS_BODY_PART_KEY,
  ROCK_GOLEM_GORE_PARTS,
} from '../sprites/rockGolemSprite';
import { DARK_KNIGHT_BODY_PART_KEY, DARK_KNIGHT_GORE_PARTS } from '../sprites/darkKnightSprite';
import { DARK_KNIGHT_FIGURE } from '../sprites/art/darkKnightFigure';
import {
  BRINDLED_VESPA_BODY_PART_KEY,
  BRINDLED_VESPA_GORE_PARTS,
} from '../sprites/brindledVespaSprite';
import { TROGLODYTE_BODY_PART_KEY, TROGLODYTE_GORE_PARTS } from '../sprites/troglodyteSprite';
import { TUSKLING_BODY_PART_KEY, TUSKLING_GORE_PARTS } from '../sprites/tusklingSprite';
import { TUSKLING_FIGURE } from '../sprites/art/tusklingFigure';
import { TROGLODYTE_FIGURE } from '../sprites/art/troglodyteFigure';
import { JUICER_BODY_PART_KEY, JUICER_GORE_PARTS } from '../sprites/juicerSprite';
import { HOARDER_FIGURE } from '../sprites/art/hoarderFigure';
import { JUICER_FIGURE } from '../sprites/art/juicerFigure';
import { MANTID_FIGURE, MANTIS_FIGURE } from '../sprites/art/mantidFigure';
import { ROCK_GOLEM_BOSS_FIGURE, ROCK_GOLEM_FIGURE } from '../sprites/art/rockGolemFigure';
import {
  KRAKAREN_TENTACLE_BODY_PART_KEY,
  KRAKAREN_TENTACLE_GORE_PARTS,
} from '../sprites/krakarenTentacleSprite';
import { KRAKAREN_BODY_PART_KEY, KRAKAREN_GORE_PARTS } from '../sprites/krakarenSprite';
import { KRAKAREN_FIGURE, KRAKAREN_TENTACLE_FIGURE } from '../sprites/art/krakarenFigure';

interface MobBodyPartConfig {
  readonly art: FigureDef;
  readonly parts: ReadonlyArray<string>;
}

/**
 * Gore pieces are one-frame states: each piece is its own row entry rather than
 * a frame of an animation, so every lookup here reads the row's only frame.
 */
const GORE_PIECE_FRAME = 0;

/**
 * The nine pieces every goblin comes apart into, in spawn order.
 *
 * One config per archetype rather than one shared config, because each figure
 * paints its own pieces: an axe goblin's severed arm has the axe goblin's skin
 * tone, build and gear on it. `Goblin.bodyPartKey` is weapon-derived so the
 * flying pieces match the goblin that died.
 */
const GOBLIN_CONFIGS: ReadonlyArray<readonly [string, MobBodyPartConfig]> = [
  ['goblin_sword', { art: goblinFigure('sword'), parts: GOBLIN_GORE_PARTS }],
  ['goblin_axe', { art: goblinFigure('axe'), parts: GOBLIN_GORE_PARTS }],
  ['goblin_mace', { art: goblinFigure('mace'), parts: GOBLIN_GORE_PARTS }],
  ['goblin_warhammer', { art: goblinFigure('warhammer'), parts: GOBLIN_GORE_PARTS }],
];

const COCKROACH_CONFIG: MobBodyPartConfig = {
  art: COCKROACH_FIGURE,
  parts: COCKROACH_GORE_PARTS,
};

const HOARDER_CONFIG: MobBodyPartConfig = {
  art: HOARDER_FIGURE,
  parts: HOARDER_GORE_PARTS,
};

/** The eight pieces a rat comes apart into, painted by the rat's own figure. */
const RAT_CONFIG: MobBodyPartConfig = { art: RAT_FIGURE, parts: RAT_GORE_PARTS };

/** Likewise the llama's eight, painted by the llama's own figure. */
const LLAMA_CONFIG: MobBodyPartConfig = {
  art: LLAMA_FIGURE,
  parts: LLAMA_GORE_PARTS,
};

/**
 * The boss and his cronies come apart into the same eight pieces, but off their
 * own figures — the pieces carry each build's colouring, so a dead crony's limbs
 * are green and the Mantid's are his own dark teal.
 */
const MANTID_CONFIG: MobBodyPartConfig = {
  art: MANTID_FIGURE,
  parts: MANTID_GORE_PARTS,
};
const MANTIS_CONFIG: MobBodyPartConfig = {
  art: MANTIS_FIGURE,
  parts: MANTID_GORE_PARTS,
};

/** And the Evil Clown's six, painted by his own figure. */
const EVIL_CLOWN_CONFIG: MobBodyPartConfig = {
  art: EVIL_CLOWN_FIGURE,
  parts: EVIL_CLOWN_GORE_PARTS,
};

/**
 * The Dark Knight's seven: six pieces of plate with the flesh showing only at
 * the joins, plus the mace itself, which is not a body part at all and is the
 * more recognisable for it.
 */
const DARK_KNIGHT_CONFIG: MobBodyPartConfig = {
  art: DARK_KNIGHT_FIGURE,
  parts: DARK_KNIGHT_GORE_PARTS,
};

/**
 * The seven loose bones each skeleton variant scatters.
 *
 * One config per variant rather than one shared config, for the same reason the
 * goblins have four: each figure paints its own pieces at its own scale, so the
 * lord's bones come out pale, crowned and a good half again the size of his
 * warriors'.
 */
const SKELETON_CONFIGS: ReadonlyArray<readonly [string, MobBodyPartConfig]> = [
  [SKELETON_LORD_BODY_PART_KEY, { art: SKELETON_LORD_FIGURE, parts: SKELETON_GORE_PARTS }],
  [SKELETON_SWORD_BODY_PART_KEY, { art: SKELETON_SWORD_FIGURE, parts: SKELETON_GORE_PARTS }],
  [SKELETON_ARCHER_BODY_PART_KEY, { art: SKELETON_ARCHER_FIGURE, parts: SKELETON_GORE_PARTS }],
  // The Lich comes apart into the same bones: whatever the robes were hiding,
  // it was a skeleton, and its figure paints the identical set.
  [LICH_BODY_PART_KEY, { art: LICH_FIGURE, parts: SKELETON_GORE_PARTS }],
];

/**
 * A golem does not bleed: its eight pieces are rubble, off whichever of the two
 * golem figures it was drawn from — so the boss's fragments come out molten and
 * lichened while a bouncer's come out plain grey.
 */
const ROCK_GOLEM_CONFIGS: ReadonlyArray<readonly [string, MobBodyPartConfig]> = [
  [ROCK_GOLEM_BODY_PART_KEY, { art: ROCK_GOLEM_FIGURE, parts: ROCK_GOLEM_GORE_PARTS }],
  [ROCK_GOLEM_BOSS_BODY_PART_KEY, { art: ROCK_GOLEM_BOSS_FIGURE, parts: ROCK_GOLEM_GORE_PARTS }],
];

/**
 * The troglodyte's nine, one painted state apiece. The set
 * carries its severed tongue and its shed tail, which are the two pieces a
 * player will recognise as this creature's and no other's.
 */
const TROGLODYTE_CONFIG: MobBodyPartConfig = {
  art: TROGLODYTE_FIGURE,
  parts: TROGLODYTE_GORE_PARTS,
};

/**
 * The Brindled Vespa's eight — the final, flying stage of the Brindle Grub
 * lifecycle. The two earlier grub stages are deliberately absent here: they
 * are squishy bugs whose deaths are covered by the generic gore burst and
 * blood puddle every mob already gets, and only the adult hornet gets real
 * severed parts.
 */
const BRINDLED_VESPA_CONFIG: MobBodyPartConfig = {
  art: BRINDLED_VESPA_FIGURE,
  parts: BRINDLED_VESPA_GORE_PARTS,
};

/**
 * The Tuskling's eight. The severed tusk is the piece that names the creature —
 * a long ivory crescent nothing else in the bestiary drops — and the ragged
 * flap of pink hide with the spine bristles still in it is the one that says
 * the rest of the pile came off something with a coat.
 */
const TUSKLING_CONFIG: MobBodyPartConfig = {
  art: TUSKLING_FIGURE,
  parts: TUSKLING_GORE_PARTS,
};

/**
 * The Juicer's eight. The tail is what says a lizard came apart here, and the
 * arm — an absurd bicep over a cut deltoid face — is what says it was him.
 */
const JUICER_CONFIG: MobBodyPartConfig = {
  art: JUICER_FIGURE,
  parts: JUICER_GORE_PARTS,
};

/**
 * The guard tentacle's four. A killed one bursts rather than sliding back
 * under — the burst is how the player learns that cutting it down is the thing
 * that lifts the boss's guard.
 */
const KRAKAREN_TENTACLE_CONFIG: MobBodyPartConfig = {
  art: KRAKAREN_TENTACLE_FIGURE,
  parts: KRAKAREN_TENTACLE_GORE_PARTS,
};

/** The boss's own seven, painted by her own figure. */
const KRAKAREN_CONFIG: MobBodyPartConfig = {
  art: KRAKAREN_FIGURE,
  parts: KRAKAREN_GORE_PARTS,
};

const BODY_PART_REGISTRY = new Map<string, MobBodyPartConfig>([
  ...ROCK_GOLEM_CONFIGS,
  ...GOBLIN_CONFIGS,
  [HOARDER_BODY_PART_KEY, HOARDER_CONFIG],
  [COCKROACH_BODY_PART_KEY, COCKROACH_CONFIG],
  [RAT_BODY_PART_KEY, RAT_CONFIG],
  [LLAMA_BODY_PART_KEY, LLAMA_CONFIG],
  [MANTID_BODY_PART_KEY, MANTID_CONFIG],
  [MANTIS_BODY_PART_KEY, MANTIS_CONFIG],
  [EVIL_CLOWN_BODY_PART_KEY, EVIL_CLOWN_CONFIG],
  [DARK_KNIGHT_BODY_PART_KEY, DARK_KNIGHT_CONFIG],
  [TROGLODYTE_BODY_PART_KEY, TROGLODYTE_CONFIG],
  [TUSKLING_BODY_PART_KEY, TUSKLING_CONFIG],
  [JUICER_BODY_PART_KEY, JUICER_CONFIG],
  [BRINDLED_VESPA_BODY_PART_KEY, BRINDLED_VESPA_CONFIG],
  [KRAKAREN_TENTACLE_BODY_PART_KEY, KRAKAREN_TENTACLE_CONFIG],
  [KRAKAREN_BODY_PART_KEY, KRAKAREN_CONFIG],
  ...SKELETON_CONFIGS,
]);

const PART_LIFETIME = 6000; // 100s @ 60fps
const PART_FADE_START = 3000; // start fading 50s before despawn
const MAX_SETTLED_PARTS = 200;
/** Fraction of PI used for cone spread in impact direction (~100 degrees). */
const IMPACT_CONE_HALF_ANGLE_FRACTION = 0.5556;
/** Speed multiplier applied to parts launched with a known impact direction. */
const IMPACT_SPEED_MULT = 1.6;
/** Speed multiplier applied to parts with no known impact direction. */
const DEFAULT_SPEED_MULT = 1.0;
/** Extra upward pop multiplier when impact direction is known. */
const IMPACT_VZ_BOOST = 1.4;
/** Shadow falloff: controls how shadow shrinks with height. */
const SHADOW_HEIGHT_FALLOFF = 40;
/** Shadow opacity multiplier. */
const SHADOW_ALPHA = 0.2;
/** Shadow ellipse x radius in px. */
const SHADOW_ELLIPSE_RX = 10;
/** Shadow ellipse y radius in px. */
const SHADOW_ELLIPSE_RY = 5;
// Horizontal spread (world pixels per frame)
const XY_SPEED_MIN = 0.2;
const XY_SPEED_MAX = 0.8;
// Very light air friction — parts glide while airborne
const XY_FRICTION = 0.99;
// Initial upward pop (screen pixels, treated as height above ground)
const VZ_MIN = 2.0;
const VZ_MAX = 4.0;
// Downward pull applied to vz each frame
const GRAVITY = 0.1;
const SPIN_MIN = 0.04;
const SPIN_MAX = 0.14;
/**
 * Tumbles run for a fixed duration rather than a fixed speed: a part is drawn
 * over the wall it is escaping, so the artifact must clear quickly regardless
 * of how far it has to travel.
 */
const TUMBLE_DURATION_FRAMES = 30;
/** Spin carried into the tumble, so parts visibly roll rather than glide rigidly. */
const TUMBLE_SPIN = 0.06;
/** Wall thickness the exit slide is expected to cross; beyond this a part stays where it fell. */
const TUMBLE_SEARCH_RADIUS_TILES = 3;
/** Half-width of the random resting spread inside the target tile, as a fraction of it. */
const TUMBLE_SCATTER_RATIO = 0.25;
const TILE_CENTER_RATIO = 0.5;
/**
 * Scattered spots that turn out to hug a wall are rerolled rather than accepted,
 * up to this many times; past that the tile centre — the spot furthest from
 * every wall the tile touches — is the better answer anyway.
 */
const SCATTER_ATTEMPTS = 4;
/**
 * The search starts on the landing tile itself: a piece can land on open ground
 * and still overhang the wall beside it, and a nudge within its own tile fixes
 * that without throwing it across the room.
 */
const LANDING_TILE_SEARCH_RADIUS = 0;

interface FlyingPart {
  x: number;
  y: number;
  vx: number;
  vy: number;
  z: number; // height above ground in screen pixels
  vz: number; // vertical velocity (positive = rising)
  angle: number;
  spin: number;
  art: FigureDef;
  stateName: string;
  tileSize: number;
}

/** A part that landed inside an unwalkable tile and is sliding toward open ground. */
interface TumblingPart {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  targetX: number;
  targetY: number;
  framesLeft: number;
  art: FigureDef;
  stateName: string;
  tileSize: number;
}

interface SettledPart {
  x: number;
  y: number;
  angle: number;
  art: FigureDef;
  stateName: string;
  tileSize: number;
  life: number;
}

export class BodyPartGoreSystem implements GameSystem {
  private readonly flying: FlyingPart[] = [];
  private readonly tumbling: TumblingPart[] = [];
  private readonly settled: SettledPart[] = [];

  constructor(private readonly map: GameMap) {}

  /** Pieces in flight, tumbling and settled — how many body parts this system is holding. */
  get liveCount(): number {
    return this.flying.length + this.tumbling.length + this.settled.length;
  }

  /** Pieces at rest on the floor, which is the population {@link MAX_SETTLED_PARTS} bounds. */
  get settledCount(): number {
    return this.settled.length;
  }

  /**
   * How many resting pieces this figure painted — how much of one creature's
   * corpse is still on the floor.
   */
  countSettledFrom(art: FigureDef): number {
    let count = 0;
    for (const part of this.settled) {
      if (part.art === art) count++;
    }
    return count;
  }

  /**
   * Drops in-flight/tumbling parts from the death frame. Settled parts are left
   * alone — they're floor history, same as a smashed prop, not combat state.
   */
  resetForCheckpoint(): void {
    this.flying.length = 0;
    this.tumbling.length = 0;
  }

  spawnParts(
    cx: number,
    cy: number,
    bodyPartKey: string | null,
    tileSize: number,
    impactDx = 0,
    impactDy = 0,
  ): void {
    if (!bodyPartKey) return;
    const config = BODY_PART_REGISTRY.get(bodyPartKey);
    if (!config) return;

    const hasDir = impactDx !== 0 || impactDy !== 0;
    const impactAngle = hasDir ? Math.atan2(impactDy, impactDx) : 0;

    for (const stateName of config.parts) {
      // When impact direction is known, parts fly in a ±100° cone away from the attacker
      const angle = hasDir
        ? impactAngle + (Math.random() * 2 - 1) * (Math.PI * IMPACT_CONE_HALF_ANGLE_FRACTION)
        : Math.random() * Math.PI * 2;
      const speedMult = hasDir ? IMPACT_SPEED_MULT : DEFAULT_SPEED_MULT;
      const speed = (XY_SPEED_MIN + Math.random() * (XY_SPEED_MAX - XY_SPEED_MIN)) * speedMult;
      const SPIN_DIRECTION_THRESHOLD = 0.5;
      const spinDir = Math.random() < SPIN_DIRECTION_THRESHOLD ? 1 : -1;
      const spin = spinDir * (SPIN_MIN + Math.random() * (SPIN_MAX - SPIN_MIN));
      // Higher upward pop when there's a strong impact — parts burst higher
      const vzBoost = hasDir ? IMPACT_VZ_BOOST : DEFAULT_SPEED_MULT;
      this.flying.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        z: 0,
        vz: (VZ_MIN + Math.random() * (VZ_MAX - VZ_MIN)) * vzBoost,
        angle: Math.random() * Math.PI * 2,
        spin,
        art: config.art,
        stateName,
        tileSize,
      });
    }
  }

  update(): void {
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const p = this.flying[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= XY_FRICTION;
      p.vy *= XY_FRICTION;
      p.z += p.vz;
      p.vz -= GRAVITY;
      p.angle += p.spin;

      if (p.z <= 0 && p.vz < 0) {
        this._land(p);
        this.flying[i] = this.flying[this.flying.length - 1];
        this.flying.pop();
      }
    }

    for (let i = this.tumbling.length - 1; i >= 0; i--) {
      const p = this.tumbling[i];
      p.x += p.vx;
      p.y += p.vy;
      p.angle += p.spin;
      p.framesLeft--;
      if (p.framesLeft <= 0) {
        this._settle(p.targetX, p.targetY, p.angle, p);
        this.tumbling[i] = this.tumbling[this.tumbling.length - 1];
        this.tumbling.pop();
      }
    }

    for (let i = this.settled.length - 1; i >= 0; i--) {
      this.settled[i].life--;
      if (this.settled[i].life <= 0) {
        this.settled[i] = this.settled[this.settled.length - 1];
        this.settled.pop();
      }
    }
  }

  /**
   * Resolves where a part comes to rest. Parts fly over walls while airborne,
   * so one can easily touch down inside a wall or other blocked tile; those
   * tumble toward the nearest open ground instead of resting inside geometry.
   */
  private _land(p: FlyingPart): void {
    // Tumbling parts are already spoken for against the cap, so the slot a part
    // needs has to be free at landing rather than found mid-slide.
    const partsHoldingASettledSlot = this.settled.length + this.tumbling.length;
    if (partsHoldingASettledSlot >= MAX_SETTLED_PARTS && !this._retireOldestSettled()) return;

    const clearance = this._pieceClearanceRadius(p);
    if (this._isClearOfBlockedTiles(p.x, p.y, clearance, p.tileSize)) {
      this._settle(p.x, p.y, p.angle, p);
      return;
    }

    const restingSpot = this._findTumbleTarget(p.x, p.y, clearance, p.tileSize);
    if (restingSpot === null) {
      this._settle(p.x, p.y, p.angle, p);
      return;
    }

    const rollDirection = p.spin < 0 ? -TUMBLE_SPIN : TUMBLE_SPIN;
    this.tumbling.push({
      x: p.x,
      y: p.y,
      vx: (restingSpot.x - p.x) / TUMBLE_DURATION_FRAMES,
      vy: (restingSpot.y - p.y) / TUMBLE_DURATION_FRAMES,
      angle: p.angle,
      spin: rollDirection,
      targetX: restingSpot.x,
      targetY: restingSpot.y,
      framesLeft: TUMBLE_DURATION_FRAMES,
      art: p.art,
      stateName: p.stateName,
      tileSize: p.tileSize,
    });
  }

  /**
   * Frees a slot for a piece that has just landed by retiring the resting piece
   * nearest its own despawn. Answers false only when every slot is held by a
   * piece still tumbling, which leaves nothing to retire.
   *
   * The cap has to stay — it is what bounds this system's memory and its
   * per-frame draw cost — but the newest arrival is the wrong end to trim. A
   * boss who spawns her own trash mobs kills the payoff of her own fight
   * otherwise: her swarm's litter takes every slot during the fight and holds it
   * long past their deaths, so her six pieces burst out of her, fly, and wink
   * out the instant they touch the floor.
   *
   * Life counts down from the same start for every piece, so the lowest life is
   * the piece that has been lying there longest.
   */
  private _retireOldestSettled(): boolean {
    let oldestIndex = -1;
    let lowestLifeSeen = Infinity;
    for (let i = 0; i < this.settled.length; i++) {
      const life = this.settled[i].life;
      if (life >= lowestLifeSeen) continue;
      lowestLifeSeen = life;
      oldestIndex = i;
    }
    if (oldestIndex < 0) return false;
    this.settled[oldestIndex] = this.settled[this.settled.length - 1];
    this.settled.pop();
    return true;
  }

  /**
   * Finds the world position a part overlapping geometry should slide to: the
   * closest tile by ring search that can hold the whole piece clear of every
   * wall, scattered within that tile so the six parts of one corpse don't stack
   * on a single pixel.
   *
   * A tile merely being walkable is not enough. Resting a piece on the centre of
   * the first open tile still leaves half of it drawn over the wall it just
   * escaped, which reads as gore stuck to the wall rather than gore that fell
   * off it — so candidate tiles are judged by whether the piece fits, not by
   * whether its centre point is on open ground.
   */
  private _findTumbleTarget(
    x: number,
    y: number,
    clearanceRadius: number,
    tileSize: number,
  ): { x: number; y: number } | null {
    const originTileX = Math.floor(x / tileSize);
    const originTileY = Math.floor(y / tileSize);
    let fallbackCenter: { x: number; y: number } | null = null;
    let fallbackDistSq = Infinity;

    for (let radius = LANDING_TILE_SEARCH_RADIUS; radius <= TUMBLE_SEARCH_RADIUS_TILES; radius++) {
      let bestCenter: { x: number; y: number } | null = null;
      let bestDistSq = Infinity;

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const onRing = Math.max(Math.abs(dx), Math.abs(dy)) === radius;
          if (!onRing) continue;
          const tileX = originTileX + dx;
          const tileY = originTileY + dy;
          if (!this.map.isWalkable(tileX, tileY)) continue;
          const centerX = (tileX + TILE_CENTER_RATIO) * tileSize;
          const centerY = (tileY + TILE_CENTER_RATIO) * tileSize;
          const distSq = (centerX - x) ** 2 + (centerY - y) ** 2;

          if (distSq < fallbackDistSq) {
            fallbackDistSq = distSq;
            fallbackCenter = { x: centerX, y: centerY };
          }
          if (distSq >= bestDistSq) continue;
          if (!this._isClearOfBlockedTiles(centerX, centerY, clearanceRadius, tileSize)) continue;
          bestDistSq = distSq;
          bestCenter = { x: centerX, y: centerY };
        }
      }

      if (bestCenter !== null) {
        return this._scatterWithinTile(bestCenter, clearanceRadius, tileSize);
      }
    }
    // Nothing nearby fits the piece — a one-tile crevice, say. Its centre is
    // still the least-buried spot on offer.
    return fallbackCenter;
  }

  private _scatterWithinTile(
    center: { x: number; y: number },
    clearanceRadius: number,
    tileSize: number,
  ): { x: number; y: number } {
    const scatterRange = tileSize * TUMBLE_SCATTER_RATIO;
    for (let attempt = 0; attempt < SCATTER_ATTEMPTS; attempt++) {
      const scatteredX = center.x + (Math.random() * 2 - 1) * scatterRange;
      const scatteredY = center.y + (Math.random() * 2 - 1) * scatterRange;
      if (this._isClearOfBlockedTiles(scatteredX, scatteredY, clearanceRadius, tileSize)) {
        return { x: scatteredX, y: scatteredY };
      }
    }
    return center;
  }

  /**
   * How far a piece's drawn pixels reach from the position physics tracks it by.
   * Measured off the painted ink rather than taken from the cell size, because a gore
   * cell is sized for the creature's widest standing pose and a severed jaw
   * fills almost none of it.
   */
  private _pieceClearanceRadius(part: Pick<FlyingPart, 'art' | 'stateName' | 'tileSize'>): number {
    return figureInkRadiusPx(part.art, part.stateName, GORE_PIECE_FRAME, part.tileSize);
  }

  /**
   * Whether a piece of the given radius resting here would touch a blocked tile.
   * Tests the piece's bounding square rather than its disc — the corners cost a
   * little reach at tile corners and save the per-tile distance maths.
   */
  private _isClearOfBlockedTiles(x: number, y: number, radius: number, tileSize: number): boolean {
    const minTileX = Math.floor((x - radius) / tileSize);
    const maxTileX = Math.floor((x + radius) / tileSize);
    const minTileY = Math.floor((y - radius) / tileSize);
    const maxTileY = Math.floor((y + radius) / tileSize);
    for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
      for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
        if (!this.map.isWalkable(tileX, tileY)) return false;
      }
    }
    return true;
  }

  private _settle(
    x: number,
    y: number,
    angle: number,
    source: Pick<FlyingPart, 'art' | 'stateName' | 'tileSize'>,
  ): void {
    this.settled.push({
      x,
      y,
      angle,
      art: source.art,
      stateName: source.stateName,
      tileSize: source.tileSize,
      life: PART_LIFETIME,
    });
  }

  renderSettled(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const p of this.settled) {
      const alpha = p.life <= PART_FADE_START ? p.life / PART_FADE_START : 1;
      this._drawPart(ctx, p.x - camX, p.y - camY, p.angle, p.art, p.stateName, p.tileSize, alpha);
    }

    for (const p of this.tumbling) {
      this._drawPart(ctx, p.x - camX, p.y - camY, p.angle, p.art, p.stateName, p.tileSize, 1);
    }
  }

  renderFlying(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const p of this.flying) {
      const sx = p.x - camX;
      const sy = p.y - camY;

      // Shadow at ground position — helps read the arc height
      const SHADOW_MIN_SCALE = 0.3;
      const shadowScale = Math.max(SHADOW_MIN_SCALE, 1 - p.z / SHADOW_HEIGHT_FALLOFF);
      ctx.save();
      ctx.globalAlpha = SHADOW_ALPHA * shadowScale;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(
        sx,
        sy,
        SHADOW_ELLIPSE_RX * shadowScale,
        SHADOW_ELLIPSE_RY * shadowScale,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.restore();

      // Part drawn above its ground position by z pixels
      this._drawPart(ctx, sx, sy - p.z, p.angle, p.art, p.stateName, p.tileSize, 1);
    }
  }

  private _drawPart(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    angle: number,
    art: FigureDef,
    stateName: string,
    tileSize: number,
    alpha: number,
  ): void {
    drawFigureCachedRotatedCenter(
      ctx,
      art,
      stateName,
      GORE_PIECE_FRAME,
      sx,
      sy,
      angle,
      tileSize,
      alpha,
    );
  }
}
