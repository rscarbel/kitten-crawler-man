/**
 * Everything small that drifts through the light: embers off the torches, dust
 * motes hanging in the hall, the dust thrown up when the logo slams in, and
 * sparks along the logo's lower edge.
 *
 * One fixed pool of slots, each a particle that is born, lives and is reborn
 * on its own period. Where a slot's particle is and how it looks is a pure
 * function of the clock and a seed, so a frozen moment always shows the same
 * particles and nothing has to be stepped to get there.
 */

import {
  allocCanvas,
  surfaceContext,
  type CanvasSurface,
  releaseSurface,
} from '../../../core/rendering/canvasSurface';
import { renderQuality } from '../../../core/perf/RenderQuality';
import { getRenderScale } from '../../../core/rendering/Viewport';
import { mulberry32, subSeed, type Rng } from '../../../sprites/person/rng';
import { TITLE_INK } from '../../../ui/theme/titleInk';
import type { TitleClock } from '../titleClock';
import {
  applyTitleCamera,
  type TitleCamera,
  type TitleDepth,
  type TitleLayer,
} from '../titleLayer';
import { HALL_DEPTH } from '../titleHall';
import {
  LogoSlamClock,
  logoFontGeneration,
  titleLogoGeometry,
  type TitleLogoGeometry,
} from '../titleLogo';
import type { TitleStage } from '../titleStage';
import { LOGO_FALL_MS, type TitleCue } from '../titleTimeline';

/** The pool's hard cap at full detail; every emitter's share is taken from it. */
const PARTICLE_CAP = 200;
/** The share of the pool kept when the render quality drops to save frames. */
const REDUCED_DETAIL_SHARE = 0.5;

/** Slots per emitter at full detail; together they never exceed {@link PARTICLE_CAP}. */
const EMBERS_PER_TORCH = 10;
const MOTE_SLOTS = 40;
const BURST_DUST_SLOTS = 28;
const BURST_SPARK_SLOTS = 34;
const BASELINE_SPARK_SLOTS = 16;

/** Embers leave the torches, so they ride the hall's plane; the motes fill the air in front of it. */
const TORCH_DEPTH: TitleDepth = HALL_DEPTH;
const MOTE_DEPTH: TitleDepth = 0.6;
/** The logo's dust and sparks move with the logo. */
const LOGO_DEPTH: TitleDepth = 0.85;

/** Particles are sized for a stage whose shorter side is this many CSS pixels, and scale with it. */
const REFERENCE_SHORT_SIDE_PX = 720;
const MIN_PARTICLE_SCALE = 0.6;
const MAX_PARTICLE_SCALE = 1.5;

/** Each soft dot is baked at this radius, in CSS pixels, before scaling to its particle. */
const SPRITE_RADIUS_PX = 16;
const SPRITE_CORE_AT = 0.15;
const SPRITE_BODY_AT = 0.4;

const MS_PER_SECOND = 1000;
const FULL_TURN = Math.PI * 2;
const HALF = 0.5;

/** Embers: lifted off a flame, rising and swaying as they cool. */
const EMBER = {
  lifeMs: 2200,
  /** Each slot's life is its base life times somewhere in this spread. */
  lifeSpread: 0.5,
  /** Where an ember leaves the flame, above the torch's mount, in particle-scaled pixels. */
  liftPx: 16,
  spawnJitterPx: 5,
  riseMinPxPerS: 26,
  riseMaxPxPerS: 58,
  swayMinPx: 3,
  swayMaxPx: 11,
  swayPeriodMs: 1300,
  radiusMinPx: 1.1,
  radiusMaxPx: 2.6,
  /** The share of its life an ember takes to flare up to full brightness. */
  fadeInShare: 0.08,
} as const;

/** Motes: specks of dust hanging in the air, always there, even in the dark. */
const MOTE = {
  lifeMs: 11000,
  lifeSpread: 0.6,
  driftMaxPxPerS: 7,
  riseMaxPxPerS: 5,
  swayPx: 9,
  swayPeriodMs: 7000,
  radiusMinPx: 0.7,
  radiusMaxPx: 1.7,
  /** How bright motes are before the torches light, and once the hall is lit. */
  dormantAlpha: 0.22,
  litAlpha: 0.5,
  twinklePeriodMs: 2400,
  twinkleDepth: 0.4,
  /** The share of a mote's life spent fading in, and again fading out. */
  fadeShare: 0.2,
  /** With reduced motion the motes drift this much slower. */
  reducedSpeedShare: 0.4,
} as const;

/** The slam's dust: puffs thrown out from the lettering's base, spreading and settling. */
const BURST_DUST = {
  lifeMinMs: 700,
  lifeMaxMs: 1500,
  outwardPxPerS: 190,
  jitterPxPerS: 70,
  upMinPxPerS: 10,
  upMaxPxPerS: 80,
  /** How quickly the air slows the puffs, per second. */
  drag: 3.2,
  radiusFromPx: 5,
  radiusToMinPx: 16,
  radiusToMaxPx: 30,
  alpha: 0.9,
} as const;

/** The slam's sparks: thrown up and out, falling back under their own weight. */
const BURST_SPARK = {
  lifeMinMs: 450,
  lifeMaxMs: 1100,
  sideMaxPxPerS: 280,
  upMinPxPerS: 120,
  upMaxPxPerS: 380,
  gravityPxPerS2: 620,
  drag: 1.4,
  radiusMinPx: 0.9,
  radiusMaxPx: 2.1,
} as const;

/**
 * Sparks that keep dripping off the logo's lower edge once it has landed, like
 * hot metal. They fall rather than rise: the letters are painted over this
 * layer, so a spark rising from the edge would vanish behind them.
 */
const BASELINE_SPARK = {
  lifeMs: 1100,
  lifeSpread: 0.6,
  /** The share of a slot's lives that show a spark; the rest stay dark, so the edge spits irregularly. */
  liveChance: 0.55,
  fallMinPxPerS: 10,
  fallMaxPxPerS: 42,
  driftMaxPxPerS: 12,
  radiusMinPx: 0.8,
  radiusMaxPx: 1.8,
} as const;

/** Separate streams for each emitter, so changing one never reshuffles another. */
const SEED = {
  ember: 0x1e3b,
  mote: 0x2a71,
  burstDust: 0x3c55,
  burstSpark: 0x4d19,
  baselineSpark: 0x5e83,
} as const;
/** Slot keys within an emitter are spaced so torch `i`'s embers never share a stream with torch `i + 1`'s. */
const SLOT_STRIDE = 256;

type SpriteKind = 'ember' | 'spark' | 'dust' | 'mote';

const SPRITE_INK: Readonly<Record<SpriteKind, readonly [string, string, string]>> = {
  ember: [
    TITLE_INK.particles.emberCore,
    TITLE_INK.particles.emberBody,
    TITLE_INK.particles.emberFade,
  ],
  spark: [
    TITLE_INK.particles.sparkCore,
    TITLE_INK.particles.sparkBody,
    TITLE_INK.particles.sparkFade,
  ],
  dust: [TITLE_INK.particles.dustCore, TITLE_INK.particles.dustCore, TITLE_INK.particles.dustFade],
  mote: [TITLE_INK.particles.moteCore, TITLE_INK.particles.moteCore, TITLE_INK.particles.moteFade],
};
const SPRITE_KINDS: readonly SpriteKind[] = ['ember', 'spark', 'dust', 'mote'];

function bakeSprite(kind: SpriteKind, scale: number): CanvasSurface {
  const side = Math.ceil(SPRITE_RADIUS_PX * 2 * scale);
  const surface = allocCanvas('title', side, side);
  const ctx = surfaceContext(surface);
  const radius = side * HALF;
  const [core, body, fade] = SPRITE_INK[kind];
  const gradient = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
  gradient.addColorStop(0, core);
  gradient.addColorStop(SPRITE_CORE_AT, core);
  gradient.addColorStop(SPRITE_BODY_AT, body);
  gradient.addColorStop(1, fade);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, side, side);
  return surface;
}

function range(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** One life of a slot that is reborn every `lifeMs`, offset by its own seed. */
interface SlotLife {
  /** How far through this life, 0 to 1. */
  readonly t: number;
  readonly ageMs: number;
  readonly lifeMs: number;
  /** The stream for this life alone: a new life draws new values. */
  readonly rng: Rng;
}

function slotLife(
  seed: number,
  slot: number,
  timeMs: number,
  baseLifeMs: number,
  spread: number,
): SlotLife {
  const slotSeed = subSeed(seed, slot);
  const slotRng = mulberry32(slotSeed);
  const lifeMs = baseLifeMs * (1 - spread * HALF + spread * slotRng());
  const shifted = timeMs + slotRng() * lifeMs;
  const cycle = Math.floor(shifted / lifeMs);
  const ageMs = shifted - cycle * lifeMs;
  return { t: ageMs / lifeMs, ageMs, lifeMs, rng: mulberry32(subSeed(slotSeed, cycle)) };
}

/** Distance covered after `seconds` from speed `v` under drag `k`: fast at first, then easing off. */
function dragged(v: number, k: number, seconds: number): number {
  return (v * (1 - Math.exp(-k * seconds))) / k;
}

function particleScale(stage: TitleStage): number {
  const shortSide = Math.min(stage.width, stage.height);
  return Math.min(
    MAX_PARTICLE_SCALE,
    Math.max(MIN_PARTICLE_SCALE, shortSide / REFERENCE_SHORT_SIDE_PX),
  );
}

/** Slots an emitter gets at the current render quality. */
function share(slots: number): number {
  const detail = renderQuality.fullDetail ? 1 : REDUCED_DETAIL_SHARE;
  return Math.round(slots * detail);
}

class ParticlesLayer implements TitleLayer {
  readonly id = 'particles';
  readonly depth = MOTE_DEPTH;
  private sprites: Readonly<Record<SpriteKind, CanvasSurface>> | null = null;
  private spriteScale = 0;
  private logo: TitleLogoGeometry | null = null;
  private logoStage: TitleStage | null = null;
  /** Particles drawn so far this frame, held under the cap. */
  private drawn = 0;
  private readonly slamClock = new LogoSlamClock();
  /** This frame's time since the logo landed, read once for every emitter; null before it has. */
  private sinceLanding: number | null = null;
  private cap = 0;

  layout(stage: TitleStage): void {
    this.logo = titleLogoGeometry(stage);
    this.logoStage = stage;
  }

  render(
    ctx: CanvasRenderingContext2D,
    clock: TitleClock,
    stage: TitleStage,
    camera: TitleCamera,
  ): void {
    const sprites = this.currentSprites();
    const logo = this.currentLogo(stage);
    const sinceFallBegan = this.slamClock.since(clock);
    const sinceImpact = sinceFallBegan === null ? null : sinceFallBegan - LOGO_FALL_MS;
    this.sinceLanding = sinceImpact === null || sinceImpact < 0 ? null : sinceImpact;
    const scale = particleScale(stage);
    this.drawn = 0;
    this.cap = share(PARTICLE_CAP);

    this.onPlane(ctx, camera, LOGO_DEPTH, () => {
      this.paintBurstDust(ctx, sprites, clock, logo, scale);
    });
    ctx.globalCompositeOperation = 'lighter';
    this.onPlane(ctx, camera, MOTE_DEPTH, () => {
      this.paintMotes(ctx, sprites, clock, stage, scale);
    });
    this.onPlane(ctx, camera, TORCH_DEPTH, () => {
      this.paintEmbers(ctx, sprites, clock, stage, scale);
    });
    this.onPlane(ctx, camera, LOGO_DEPTH, () => {
      this.paintBurstSparks(ctx, sprites, clock, logo, scale);
      this.paintBaselineSparks(ctx, sprites, clock, logo, scale);
    });
  }

  onCue(cue: TitleCue): void {
    this.slamClock.onCue(cue);
  }

  dispose(): void {
    const sprites = this.sprites;
    if (sprites === null) return;
    for (const kind of SPRITE_KINDS) {
      releaseSurface(sprites[kind]);
    }
    this.sprites = null;
  }

  private currentSprites(): Readonly<Record<SpriteKind, CanvasSurface>> {
    const scale = getRenderScale();
    if (this.sprites !== null && this.spriteScale === scale) return this.sprites;
    this.dispose();
    const sprites = {
      ember: bakeSprite('ember', scale),
      spark: bakeSprite('spark', scale),
      dust: bakeSprite('dust', scale),
      mote: bakeSprite('mote', scale),
    };
    this.sprites = sprites;
    this.spriteScale = scale;
    return sprites;
  }

  private currentLogo(stage: TitleStage): TitleLogoGeometry {
    const known = this.logo;
    const fresh =
      known !== null && this.logoStage === stage && known.fontGeneration === logoFontGeneration();
    if (fresh) return known;
    const logo = titleLogoGeometry(stage);
    this.logo = logo;
    this.logoStage = stage;
    return logo;
  }

  private onPlane(
    ctx: CanvasRenderingContext2D,
    camera: TitleCamera,
    depth: TitleDepth,
    paint: () => void,
  ): void {
    ctx.save();
    applyTitleCamera(ctx, camera, depth);
    paint();
    ctx.restore();
  }

  /** One soft dot; refused once the frame has drawn its cap. */
  private dot(
    ctx: CanvasRenderingContext2D,
    sprite: CanvasSurface,
    x: number,
    y: number,
    radius: number,
    alpha: number,
  ): void {
    if (alpha <= 0 || this.drawn >= this.cap) return;
    this.drawn += 1;
    // `radius` is the dot's bright body; its soft fringe reaches past it to the sprite's edge.
    const reach = radius / SPRITE_BODY_AT;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(sprite, x - reach, y - reach, reach * 2, reach * 2);
  }

  private paintEmbers(
    ctx: CanvasRenderingContext2D,
    sprites: Readonly<Record<SpriteKind, CanvasSurface>>,
    clock: TitleClock,
    stage: TitleStage,
    scale: number,
  ): void {
    const perTorch = share(EMBERS_PER_TORCH);
    const speed = clock.reducedMotion ? MOTE.reducedSpeedShare : 1;
    const torchCount = Math.min(stage.torches.length, stage.lights.torches.length);
    for (let torchIndex = 0; torchIndex < torchCount; torchIndex += 1) {
      const torch = stage.torches[torchIndex];
      const light = stage.lights.torches[torchIndex];
      if (light.level <= 0) continue;
      const brightness = light.level * light.flicker;
      for (let slot = 0; slot < perTorch; slot += 1) {
        const life = slotLife(
          SEED.ember,
          torchIndex * SLOT_STRIDE + slot,
          clock.elapsedMs * speed,
          EMBER.lifeMs,
          EMBER.lifeSpread,
        );
        const { rng, t, ageMs } = life;
        const seconds = ageMs / MS_PER_SECOND;
        const jitter = range(rng, -EMBER.spawnJitterPx, EMBER.spawnJitterPx) * scale;
        const rise = range(rng, EMBER.riseMinPxPerS, EMBER.riseMaxPxPerS) * scale;
        const sway = range(rng, EMBER.swayMinPx, EMBER.swayMaxPx) * scale * t;
        const swayPhase = rng() * FULL_TURN;
        const radius = range(rng, EMBER.radiusMinPx, EMBER.radiusMaxPx) * scale;
        const x =
          torch.x + jitter + Math.sin((ageMs / EMBER.swayPeriodMs) * FULL_TURN + swayPhase) * sway;
        const y = torch.y - EMBER.liftPx * scale - rise * seconds;
        const fadeIn = Math.min(1, t / EMBER.fadeInShare);
        const cooling = (1 - t) * (1 - t);
        this.dot(ctx, sprites.ember, x, y, radius * (1 - t * HALF), brightness * fadeIn * cooling);
      }
    }
  }

  private paintMotes(
    ctx: CanvasRenderingContext2D,
    sprites: Readonly<Record<SpriteKind, CanvasSurface>>,
    clock: TitleClock,
    stage: TitleStage,
    scale: number,
  ): void {
    const slots = share(MOTE_SLOTS);
    const speed = clock.reducedMotion ? MOTE.reducedSpeedShare : 1;
    const timeMs = clock.elapsedMs * speed;
    const brightness =
      MOTE.dormantAlpha + (MOTE.litAlpha - MOTE.dormantAlpha) * clock.ignitionProgress;
    for (let slot = 0; slot < slots; slot += 1) {
      const life = slotLife(SEED.mote, slot, timeMs, MOTE.lifeMs, MOTE.lifeSpread);
      const { rng, t, ageMs } = life;
      const seconds = ageMs / MS_PER_SECOND;
      const startX = rng() * stage.width;
      const startY = rng() * stage.height;
      const driftX = range(rng, -MOTE.driftMaxPxPerS, MOTE.driftMaxPxPerS) * scale;
      const rise = rng() * MOTE.riseMaxPxPerS * scale;
      const phase = rng() * FULL_TURN;
      const twinklePhase = rng() * FULL_TURN;
      const radius = range(rng, MOTE.radiusMinPx, MOTE.radiusMaxPx) * scale;
      const sway = Math.sin((ageMs / MOTE.swayPeriodMs) * FULL_TURN + phase) * MOTE.swayPx * scale;
      const x = startX + driftX * seconds + sway;
      const y = startY - rise * seconds;
      const edgeFade = Math.min(1, t / MOTE.fadeShare, (1 - t) / MOTE.fadeShare);
      const twinkle =
        1 -
        MOTE.twinkleDepth *
          (HALF +
            HALF * Math.sin((clock.elapsedMs / MOTE.twinklePeriodMs) * FULL_TURN + twinklePhase));
      this.dot(ctx, sprites.mote, x, y, radius, brightness * edgeFade * twinkle);
    }
  }

  private paintBurstDust(
    ctx: CanvasRenderingContext2D,
    sprites: Readonly<Record<SpriteKind, CanvasSurface>>,
    clock: TitleClock,
    logo: TitleLogoGeometry,
    scale: number,
  ): void {
    if (clock.reducedMotion) return;
    const since = this.sinceLanding;
    if (since === null || since > BURST_DUST.lifeMaxMs) return;
    const halfWidth = Math.max(1, (logo.footRight - logo.footLeft) * HALF);
    const slots = share(BURST_DUST_SLOTS);
    for (let slot = 0; slot < slots; slot += 1) {
      const rng = mulberry32(subSeed(SEED.burstDust, slot));
      const lifeMs = range(rng, BURST_DUST.lifeMinMs, BURST_DUST.lifeMaxMs);
      if (since >= lifeMs) continue;
      const t = since / lifeMs;
      const seconds = since / MS_PER_SECOND;
      const startX = range(rng, logo.footLeft, logo.footRight);
      const startY = logo.footY - rng() * logo.depth;
      const outward = (startX - logo.center.x) / halfWidth;
      const vx =
        (outward * BURST_DUST.outwardPxPerS +
          range(rng, -BURST_DUST.jitterPxPerS, BURST_DUST.jitterPxPerS)) *
        scale;
      const vy = -range(rng, BURST_DUST.upMinPxPerS, BURST_DUST.upMaxPxPerS) * scale;
      const radiusTo = range(rng, BURST_DUST.radiusToMinPx, BURST_DUST.radiusToMaxPx);
      const radius = (BURST_DUST.radiusFromPx + (radiusTo - BURST_DUST.radiusFromPx) * t) * scale;
      const x = startX + dragged(vx, BURST_DUST.drag, seconds);
      const y = startY + dragged(vy, BURST_DUST.drag, seconds);
      this.dot(ctx, sprites.dust, x, y, radius, BURST_DUST.alpha * (1 - t));
    }
  }

  private paintBurstSparks(
    ctx: CanvasRenderingContext2D,
    sprites: Readonly<Record<SpriteKind, CanvasSurface>>,
    clock: TitleClock,
    logo: TitleLogoGeometry,
    scale: number,
  ): void {
    if (clock.reducedMotion) return;
    const since = this.sinceLanding;
    if (since === null || since > BURST_SPARK.lifeMaxMs) return;
    const seconds = since / MS_PER_SECOND;
    const slots = share(BURST_SPARK_SLOTS);
    for (let slot = 0; slot < slots; slot += 1) {
      const rng = mulberry32(subSeed(SEED.burstSpark, slot));
      const lifeMs = range(rng, BURST_SPARK.lifeMinMs, BURST_SPARK.lifeMaxMs);
      if (since >= lifeMs) continue;
      const t = since / lifeMs;
      const startX = range(rng, logo.footLeft, logo.footRight);
      const vx = range(rng, -BURST_SPARK.sideMaxPxPerS, BURST_SPARK.sideMaxPxPerS) * scale;
      const vy = -range(rng, BURST_SPARK.upMinPxPerS, BURST_SPARK.upMaxPxPerS) * scale;
      const radius = range(rng, BURST_SPARK.radiusMinPx, BURST_SPARK.radiusMaxPx) * scale;
      const fall = HALF * BURST_SPARK.gravityPxPerS2 * scale * seconds * seconds;
      const x = startX + dragged(vx, BURST_SPARK.drag, seconds);
      const y = logo.footY + dragged(vy, BURST_SPARK.drag, seconds) + fall;
      this.dot(ctx, sprites.spark, x, y, radius, 1 - t * t);
    }
  }

  private paintBaselineSparks(
    ctx: CanvasRenderingContext2D,
    sprites: Readonly<Record<SpriteKind, CanvasSurface>>,
    clock: TitleClock,
    logo: TitleLogoGeometry,
    scale: number,
  ): void {
    const since = this.sinceLanding;
    if (since === null) return;
    const slots = share(BASELINE_SPARK_SLOTS);
    for (let slot = 0; slot < slots; slot += 1) {
      const life = slotLife(
        SEED.baselineSpark,
        slot,
        since,
        BASELINE_SPARK.lifeMs,
        BASELINE_SPARK.lifeSpread,
      );
      const { rng, t, ageMs } = life;
      // A life that began before the slam belongs to a logo that was not there yet.
      if (since < ageMs || rng() >= BASELINE_SPARK.liveChance) continue;
      const seconds = ageMs / MS_PER_SECOND;
      const startX = range(rng, logo.footLeft, logo.footRight);
      const startY = logo.footY;
      const fall = range(rng, BASELINE_SPARK.fallMinPxPerS, BASELINE_SPARK.fallMaxPxPerS) * scale;
      const drift =
        range(rng, -BASELINE_SPARK.driftMaxPxPerS, BASELINE_SPARK.driftMaxPxPerS) * scale;
      const radius = range(rng, BASELINE_SPARK.radiusMinPx, BASELINE_SPARK.radiusMaxPx) * scale;
      const flare = Math.sin(t * Math.PI);
      this.dot(
        ctx,
        sprites.spark,
        startX + drift * seconds,
        startY + fall * seconds,
        radius,
        flare,
      );
    }
  }
}

export function particlesLayer(): TitleLayer {
  return new ParticlesLayer();
}
