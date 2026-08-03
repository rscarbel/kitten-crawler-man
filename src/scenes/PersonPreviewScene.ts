/**
 * Localhost-only harness for the procedural people generator, in two modes.
 *
 * **Gallery** is the art view: four large "hero" figures walking in every
 * facing, a strip showing one citizen of each gait archetype so the per-role
 * walks can be compared side by side, and a scrolling grid of unique seeded
 * people. Every figure is driven at a simulated walking speed rather than a
 * frame counter, because the walk cycle is keyed to distance travelled and a
 * bare frame clock would show a gait nothing in the game ever strikes.
 *
 * **Crowd** is the performance view: a settable number of real `Townsperson`
 * instances wandering a pen and drawing through the frame cache, with the draw
 * cost and the cache's hit rate, bakes, evictions and live bytes on screen. The
 * crowd's cost is invisible from inside a running game — it needs a profile and
 * a plaza — so this exercises it without walking anywhere.
 *
 * Reached via `?people` in `devBootScene` (see `game.ts`); never on a
 * production path.
 */

import { Scene } from '../core/Scene';
import { TILE_SIZE } from '../core/constants';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { addButton, BUTTON_PRESETS, notifyButtonClick, setButtonMouseState } from '../ui/Button';
import { drawText } from '../ui/TextBox';
import { Townsperson } from '../creatures/Townsperson';
import {
  generatePersonAppearance,
  type PersonAppearance,
  type TownRole,
} from '../sprites/person/PersonAppearance';
import { drawPerson } from '../sprites/person/drawPerson';
import { walkCycleDistance } from '../sprites/person/gait';
import {
  BYTES_PER_MEGABYTE,
  getPersonCacheStats,
  setPersonCacheStatsRecording,
} from '../sprites/person/personCacheStats';
import { HUMANOID_NPC_SCALE } from '../sprites/humanoidScale';
import type { Facing } from '../sprites/person/skeleton';

const BG_COLOR = '#1b2436';
const GROUND_COLOR = '#26324a';
const HEADING_COLOR = '#e2e8f0';
const LABEL_COLOR = '#94a3b8';
const READOUT_COLOR = '#a7f3d0';

const HERO_SIZE = 150;
const GRID_SIZE = 88;
const GRID_CELL = 104;
const ROLE_STRIP_SIZE = 96;
const MARGIN = 40;
const HEADING_SIZE = 20;
const LABEL_SIZE = 14;

const HERO_BAND_Y = 60;
const ROLE_STRIP_TOP = 250;
const GRID_TOP = 400;

const FACINGS: ReadonlyArray<Facing> = ['down', 'left', 'up', 'right'];
const HERO_LABELS: Record<Facing, string> = {
  down: 'toward',
  up: 'away',
  left: 'left',
  right: 'right',
};

/** One citizen of each gait archetype, so the per-role walks can be compared. */
const ARCHETYPE_ROLES: ReadonlyArray<TownRole> = [
  'commoner',
  'guard',
  'laborer',
  'child',
  'drunk',
  'beggar',
];

/** Walking speed the gallery figures are driven at, in world px per frame. */
const GALLERY_SPEED = 0.7;

// Frames a grid figure holds a facing before turning (~2.3s at 60fps).
const FACING_HOLD_FRAMES = 140;

const HERO_GROUND_FRAC = 0.92;
const GROUND_THICKNESS = 8;
// Decorrelates grid seeds from hero seeds and spreads each figure's turn/anim clock.
const GRID_SEED_STRIDE = 31;
const FACING_STAGGER = 0.37;
const PHASE_STAGGER = 0.13;
const SEED_REROLL_STRIDE = 997;

// ── Crowd mode ───────────────────────────────────────────────────────────────

const CROWD_START_COUNT = 40;
const CROWD_STEP = 10;
const CROWD_MIN = 0;
const CROWD_MAX = 200;
const CROWD_SEED_BASE = 4001;
const CROWD_SEED_STRIDE = 101;
const CROWD_SPEED_MIN = 0.2;
const CROWD_SPEED_MAX = 1;
const CROWD_ARRIVE_DIST = TILE_SIZE / 2;
const CROWD_PAUSE_MIN = 20;
const CROWD_PAUSE_MAX = 180;
const CROWD_PEN_INSET = 60;
const CROWD_PEN_TOP = 150;
/** Frames of draw time averaged into the readout, so it does not flicker. */
const TIMING_WINDOW_FRAMES = 30;
const MS_DECIMALS = 2;
const PERCENT = 100;

const BUTTON_W = 130;
const BUTTON_H = 34;
const BUTTON_GAP = 10;
const BUTTON_ROW_Y = 8;
const READOUT_LINE_HEIGHT = 18;

type PreviewMode = 'gallery' | 'crowd';

/** What `addButton` records so a click can be routed back to its action. */
interface ButtonHitRect {
  x: number;
  y: number;
  w: number;
  h: number;
  action?: () => void;
  label?: string;
}

export class PersonPreviewScene extends Scene {
  private frame = 0;
  private seedBase = 1;
  private mode: PreviewMode = 'gallery';
  private crowdCount = CROWD_START_COUNT;
  private crowd: Townsperson[] = [];
  private crowdBuiltFor = -1;
  private drawMsTotal = 0;
  private drawMsSamples = 0;
  private drawMsAverage = 0;
  private mouseX = 0;
  private mouseY = 0;
  private readonly buttons: ButtonHitRect[] = [];

  onEnter(): void {
    setPersonCacheStatsRecording(true);
  }

  onExit(): void {
    setPersonCacheStatsRecording(false);
  }

  handleClick(mx: number, my: number): void {
    notifyButtonClick(mx, my);
    for (const button of this.buttons) {
      const inside =
        mx >= button.x && mx <= button.x + button.w && my >= button.y && my <= button.y + button.h;
      if (inside) {
        button.action?.();
        return;
      }
    }
  }

  handleMouseMove(mx: number, my: number): void {
    this.mouseX = mx;
    this.mouseY = my;
  }

  update(): void {
    this.frame += 1;
    if (this.mode !== 'crowd') return;
    this.ensureCrowd();
    for (const person of this.crowd) person.update();
  }

  render(ctx: CanvasRenderingContext2D): void {
    setButtonMouseState(this.mouseX, this.mouseY);
    const width = viewportWidth();
    const height = viewportHeight();
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, width, height);

    if (this.mode === 'gallery') {
      this.renderHeroes(ctx, width);
      this.renderArchetypeStrip(ctx, width);
      this.renderGrid(ctx, width, height);
    } else {
      this.renderCrowd(ctx, width, height);
    }
    this.renderControls(ctx, width);
  }

  /** Cycle position for a figure walking at `speed`, offset by `stagger` strides. */
  private galleryPhase(appearance: PersonAppearance, drawSize: number, stagger: number): number {
    const perFrame = GALLERY_SPEED / walkCycleDistance(appearance, drawSize);
    return (this.frame * perFrame + stagger) % 1;
  }

  private renderHeroes(ctx: CanvasRenderingContext2D, width: number): void {
    ctx.fillStyle = GROUND_COLOR;
    ctx.fillRect(0, HERO_BAND_Y + HERO_SIZE * HERO_GROUND_FRAC, width, GROUND_THICKNESS);

    const slot = width / (FACINGS.length + 1);
    FACINGS.forEach((facing, i) => {
      const appearance = generatePersonAppearance(this.seedBase + i);
      const sx = slot * (i + 1) - HERO_SIZE / 2;
      const phase = this.galleryPhase(appearance, HERO_SIZE, 0);
      drawPerson(ctx, sx, HERO_BAND_Y, HERO_SIZE, appearance, phase, facing, true);
      drawText(ctx, HERO_LABELS[facing], {
        x: slot * (i + 1),
        y: HERO_BAND_Y + HERO_SIZE,
        size: LABEL_SIZE,
        align: 'center',
        color: LABEL_COLOR,
      });
    });
  }

  private renderArchetypeStrip(ctx: CanvasRenderingContext2D, width: number): void {
    const slot = width / (ARCHETYPE_ROLES.length + 1);
    ARCHETYPE_ROLES.forEach((role, i) => {
      const appearance = generatePersonAppearance(this.seedBase + i, role);
      const sx = slot * (i + 1) - ROLE_STRIP_SIZE / 2;
      const phase = this.galleryPhase(appearance, ROLE_STRIP_SIZE, i * PHASE_STAGGER);
      drawPerson(ctx, sx, ROLE_STRIP_TOP, ROLE_STRIP_SIZE, appearance, phase, 'right', true);
      drawText(ctx, `${role} — ${appearance.gait.archetype}`, {
        x: slot * (i + 1),
        y: ROLE_STRIP_TOP + ROLE_STRIP_SIZE,
        size: LABEL_SIZE,
        align: 'center',
        color: LABEL_COLOR,
      });
    });
  }

  private renderGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const cols = Math.max(1, Math.floor((width - MARGIN * 2) / GRID_CELL));
    let index = 0;
    for (let y = GRID_TOP; y + GRID_CELL < height; y += GRID_CELL) {
      for (let col = 0; col < cols; col += 1) {
        const appearance = generatePersonAppearance(this.seedBase * GRID_SEED_STRIDE + index + 1);
        // Each figure turns on its own schedule so the crowd looks unchoreographed.
        const facingIndex =
          Math.floor(this.frame / FACING_HOLD_FRAMES + index * FACING_STAGGER) % FACINGS.length;
        const facing = FACINGS[facingIndex];
        const sx = MARGIN + col * GRID_CELL + (GRID_CELL - GRID_SIZE) / 2;
        const phase = this.galleryPhase(appearance, GRID_SIZE, index * PHASE_STAGGER);
        drawPerson(ctx, sx, y, GRID_SIZE, appearance, phase, facing, true);
        index += 1;
      }
    }
  }

  /** Rebuilds the pen's population when the requested count changes. */
  private ensureCrowd(): void {
    if (this.crowdBuiltFor === this.crowdCount) return;
    // Read live rather than captured: the pen is the window, and a citizen
    // holding the dimensions the window had when they spawned would be penned
    // into a rectangle that no longer exists after a resize.
    const pickTarget = (): { x: number; y: number } => {
      const penWidth = Math.max(TILE_SIZE, viewportWidth() - CROWD_PEN_INSET * 2);
      const penHeight = Math.max(TILE_SIZE, viewportHeight() - CROWD_PEN_TOP - CROWD_PEN_INSET);
      return {
        x: CROWD_PEN_INSET + Math.random() * penWidth,
        y: CROWD_PEN_TOP + Math.random() * penHeight,
      };
    };

    this.crowd = [];
    for (let i = 0; i < this.crowdCount; i++) {
      const start = pickTarget();
      this.crowd.push(
        new Townsperson({
          x: start.x,
          y: start.y,
          role: ARCHETYPE_ROLES[i % ARCHETYPE_ROLES.length],
          seed: CROWD_SEED_BASE + i * CROWD_SEED_STRIDE,
          speed: CROWD_SPEED_MIN + Math.random() * (CROWD_SPEED_MAX - CROWD_SPEED_MIN),
          wander: {
            pickTarget,
            arriveDist: CROWD_ARRIVE_DIST,
            pauseMin: CROWD_PAUSE_MIN,
            pauseMax: CROWD_PAUSE_MAX,
          },
        }),
      );
    }
    this.crowdBuiltFor = this.crowdCount;
    this.drawMsTotal = 0;
    this.drawMsSamples = 0;
  }

  private renderCrowd(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const start = performance.now();
    for (const person of this.crowd) person.render(ctx, 0, 0, TILE_SIZE);
    this.sampleDrawMs(performance.now() - start);
    this.renderCrowdReadout(ctx, width, height);
  }

  private sampleDrawMs(elapsedMs: number): void {
    this.drawMsTotal += elapsedMs;
    this.drawMsSamples += 1;
    if (this.drawMsSamples < TIMING_WINDOW_FRAMES) return;
    this.drawMsAverage = this.drawMsTotal / this.drawMsSamples;
    this.drawMsTotal = 0;
    this.drawMsSamples = 0;
  }

  private renderCrowdReadout(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const stats = getPersonCacheStats();
    const lookups = stats.hits + stats.misses;
    const hitRate = lookups === 0 ? 0 : (stats.hits / lookups) * PERCENT;
    const megabytes = stats.bytes / BYTES_PER_MEGABYTE;
    const drawSize = TILE_SIZE * HUMANOID_NPC_SCALE;
    const lines = [
      `${this.crowd.length} citizens at ${drawSize.toFixed(1)} px, dpr ${window.devicePixelRatio}`,
      `draw submit ${this.drawMsAverage.toFixed(MS_DECIMALS)} ms/frame (GPU raster not counted)`,
      `hits ${stats.hits} / misses ${stats.misses} (${hitRate.toFixed(0)}% hit)`,
      `bakes ${stats.bakes}, direct draws ${stats.directDraws}`,
      `evictions ${stats.evictions}, idle releases ${stats.releases}`,
      `${stats.people} people cached, ${megabytes.toFixed(1)} MB`,
    ];
    lines.forEach((line, i) => {
      drawText(ctx, line, {
        x: MARGIN,
        y: height - MARGIN - (lines.length - i) * READOUT_LINE_HEIGHT,
        size: LABEL_SIZE,
        color: READOUT_COLOR,
        outline: true,
      });
    });
    drawText(ctx, 'Crowd stress — real Townsperson instances through the frame cache', {
      x: width / 2,
      y: CROWD_PEN_TOP - READOUT_LINE_HEIGHT * 2,
      size: LABEL_SIZE,
      align: 'center',
      color: LABEL_COLOR,
    });
  }

  private renderControls(ctx: CanvasRenderingContext2D, width: number): void {
    drawText(ctx, 'Procedural People', {
      x: MARGIN,
      y: BUTTON_ROW_Y,
      size: HEADING_SIZE,
      bold: true,
      color: HEADING_COLOR,
      outline: true,
    });

    this.buttons.length = 0;
    let x = width - MARGIN - BUTTON_W;
    const button = (label: string, action: () => void): void => {
      addButton(ctx, this.buttons, {
        x,
        y: BUTTON_ROW_Y,
        width: BUTTON_W,
        height: BUTTON_H,
        label,
        ...BUTTON_PRESETS.toggle,
        action,
      });
      x -= BUTTON_W + BUTTON_GAP;
    };

    if (this.mode === 'crowd') {
      button(`+${CROWD_STEP} people`, () => {
        this.crowdCount = Math.min(CROWD_MAX, this.crowdCount + CROWD_STEP);
      });
      button(`−${CROWD_STEP} people`, () => {
        this.crowdCount = Math.max(CROWD_MIN, this.crowdCount - CROWD_STEP);
      });
    } else {
      button('reroll seeds', () => {
        this.seedBase += SEED_REROLL_STRIDE;
      });
    }
    button(this.mode === 'gallery' ? 'crowd stress' : 'gallery', () => {
      this.mode = this.mode === 'gallery' ? 'crowd' : 'gallery';
    });
  }
}
