#!/usr/bin/env tsx
/**
 * Idle stillness gates for every figure that stands on Carl's breathing idle —
 * Carl, the human townsfolk cast and named residents, Gum Gum, the city elf
 * cultists, Mordecai's Incubus — and for the skyfowl cast and the Cretin hirelings that
 * stand beside them.
 *
 *   I1  a standing figure does not sway: across its idle row, the head, the
 *       hips and the whole silhouette each travel sideways less than
 *       `MAX_SIDEWAYS_TRAVEL_PX` on screen at the 32px tile
 *   I2  the breath is small: the crown rises and falls no more than
 *       `MAX_BREATH_RISE_PX` on screen
 *   I3  the breath is slow: every runtime path that plays an idle takes at
 *       least `MIN_BREATH_SECONDS` to come round to its first frame again
 *
 * A standing loop that moves its hips, head or hands from side to side once a
 * cycle reads as a figure dancing on the spot, and played fast enough it reads
 * as nothing else. Breathing is the only motion a figure at rest is allowed.
 *
 *   npm run gates:idle-stillness
 *   npx tsx scripts/gates-idle-stillness.ts --report    every subject's numbers
 *   npx tsx scripts/gates-idle-stillness.ts --preview   also writes preview/idle-stillness.png
 */

import { createCanvas, type Canvas } from 'canvas';

import { paintFigureCell } from './figureSheet.js';
import { nothingMeasuredFailures, reportFigureGates } from './figureGates.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { TILE_SIZE } from '../src/core/constants.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import { HUMAN_FIGURE, HUMAN_ROW_TABLE } from '../src/sprites/art/humanFigure.js';
import {
  ALL_TOWN_CAST_VIEWS,
  IDLE_FRAMES as TOWN_CAST_IDLE_FRAMES,
  townCastFigure,
  townCastStateName,
} from '../src/sprites/art/townCastFigure.js';
import { TOWN_CAST_LOOKS } from '../src/sprites/person/townCastLooks.js';
import {
  CITY_ELF_CULTIST_FIGURE,
  CULTIST_VIEWS,
  cultistStateName,
} from '../src/sprites/art/cityElfCultistFigure.js';
import {
  INCUBUS_FIGURE,
  INCUBUS_VIEWS,
  incubusStateName,
} from '../src/sprites/art/incubusFigure.js';
import {
  castStateName,
  IDLE_FRAMES as SKYFOWL_IDLE_FRAMES,
  skyfowlCastFigure,
} from '../src/sprites/art/skyfowlCastFigure.js';
import { SKYFOWL_CIVILIAN_LOOKS } from '../src/sprites/art/skyfowl/cast.js';
import { CRETIN_VARIANTS } from '../src/sprites/art/cretinArt.js';
import { GUMGUM_FIGURE, GUMGUM_VIEWS, gumGumStateName } from '../src/sprites/art/gumGumFigure.js';
import { CRETIN_FIGURES, cretinStateName } from '../src/sprites/art/cretinFigure.js';
import {
  heldLength,
  idleFrameAtSeconds,
  TICKS_PER_SECOND,
} from '../src/sprites/art/human/timing.js';
import { townCastLoopFrame } from '../src/sprites/townCastSprite.js';
import { skyfowlCastLoopFrame } from '../src/sprites/skyfowlCastSprite.js';

/**
 * The most any of head, hips or silhouette may drift sideways over a whole
 * idle row, in screen pixels at the 32px tile. A figure standing still moves
 * none of them; the margin is for the breath, which lowers a slightly
 * asymmetric body through the fixed hip band, and for the small fist the
 * idle flexes. Edge-on, a robe's hanging hand sinking through that band with
 * the breath measures up to about 0.3px. A weight shift from one foot to the
 * other once a breath measures 0.6–1.9px, and a head turning to and fro over
 * 1px.
 */
const MAX_SIDEWAYS_TRAVEL_PX = 0.3;
/** How far the crown may rise and fall over one breath, in screen pixels at the 32px tile. */
const MAX_BREATH_RISE_PX = 1.5;
/**
 * The shortest a standing breath may last. A resting adult breathes every
 * three to four seconds; an idle cycling once a second reads as a figure
 * bobbing to music.
 */
const MIN_BREATH_SECONDS = 3;

/** The head band: the top of the frame-0 silhouette, as a share of its height. */
const HEAD_BAND_SHARE = 0.18;
/** The hip band, from and to these shares of the frame-0 silhouette's height. */
const HIP_BAND_TOP_SHARE = 0.48;
const HIP_BAND_BOTTOM_SHARE = 0.6;
/** Ink lighter than this alpha is antialiasing, not body. */
const SOLID_ALPHA = 24;
const RGBA_STRIDE = 4;
const ALPHA_OFFSET = 3;
const MAX_ALPHA = 255;
/**
 * How many whole pixels of ink, counted down from the top of the cell, mark
 * where the crown is. A single topmost row moves in whole steps; a mass of
 * ink moves smoothly with the head.
 */
const CROWN_INK_MASS_CELL_PX = 40;

const PREVIEW_ENLARGE = 4;
const PREVIEW_GAP = 6;
const PREVIEW_BACKGROUND = '#5b6650';
const PREVIEW_PLUMB = 'rgba(255, 40, 40, 0.85)';
const PX_DECIMALS = 2;
/** Wide enough for the longest subject label, so the report's numbers line up. */
const REPORT_LABEL_WIDTH = 52;
/** The sampling step through runtime clocks: the game's own tick. */
const CLOCK_STEP_SECONDS = 1 / TICKS_PER_SECOND;
/** How long a runtime clock is followed to find a breath's length: several breaths. */
const CLOCK_SPAN_SECONDS = 20;

interface IdleSubject {
  readonly label: string;
  readonly def: FigureDef;
  readonly state: string;
}

function idleSubjects(): IdleSubject[] {
  const subjects: IdleSubject[] = [];
  for (const state of ['idle', 'idle_side', 'idle_away']) {
    subjects.push({ label: `carl.${state}`, def: HUMAN_FIGURE, state });
  }
  for (const look of TOWN_CAST_LOOKS) {
    for (const view of ALL_TOWN_CAST_VIEWS) {
      const state = townCastStateName('idle', view);
      subjects.push({ label: `${look.id}.${state}`, def: townCastFigure(look.id), state });
    }
  }
  for (const view of CULTIST_VIEWS) {
    const state = cultistStateName('idle', view);
    subjects.push({ label: `cultist.${state}`, def: CITY_ELF_CULTIST_FIGURE, state });
  }
  for (const view of INCUBUS_VIEWS) {
    const state = incubusStateName('idle', view);
    subjects.push({ label: `incubus.${state}`, def: INCUBUS_FIGURE, state });
  }
  for (const view of GUMGUM_VIEWS) {
    const state = gumGumStateName('idle', view);
    subjects.push({ label: `gumgum.${state}`, def: GUMGUM_FIGURE, state });
  }
  for (const variant of CRETIN_VARIANTS) {
    for (const view of ['front', 'side', 'away'] as const) {
      const state = cretinStateName('idle', view);
      subjects.push({ label: `cretin_${variant}.${state}`, def: CRETIN_FIGURES[variant], state });
    }
  }
  for (const look of SKYFOWL_CIVILIAN_LOOKS) {
    for (const view of ['down', 'side', 'up'] as const) {
      const state = castStateName('idle', view);
      subjects.push({
        label: `skyfowl_${look.id}.${state}`,
        def: skyfowlCastFigure(look.id),
        state,
      });
    }
  }
  return subjects;
}

interface Measures {
  readonly sidewaysHead: number;
  readonly sidewaysHips: number;
  readonly sidewaysBody: number;
  readonly crownRise: number;
  readonly frames: number;
}

interface AlphaCell {
  readonly width: number;
  readonly height: number;
  readonly alpha: (x: number, y: number) => number;
}

function alphaCell(def: FigureDef, state: string, frame: number): AlphaCell {
  const cell = paintFigureCell(def, state, frame);
  const { width, height } = cell;
  const { data } = cell.getContext('2d').getImageData(0, 0, width, height);
  return {
    width,
    height,
    alpha: (x, y) => {
      const value = data[(y * width + x) * RGBA_STRIDE + ALPHA_OFFSET];
      return value < SOLID_ALPHA ? 0 : value / MAX_ALPHA;
    },
  };
}

interface Rows {
  readonly top: number;
  readonly bottom: number;
}

function solidRows(cell: AlphaCell): Rows | null {
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) {
      if (cell.alpha(x, y) === 0) continue;
      if (top < 0) top = y;
      bottom = y;
      break;
    }
  }
  return top < 0 ? null : { top, bottom };
}

/**
 * The ink-weighted mean column of the band `[from, to)`, or null when it
 * paints nothing. The bounds may be fractional: a row the band only partly
 * covers counts for that share, so a band can follow a head that moves a
 * fraction of a pixel.
 */
function centroidX(cell: AlphaCell, from: number, to: number): number | null {
  let mass = 0;
  let moment = 0;
  const first = Math.max(0, Math.floor(from));
  const last = Math.min(cell.height, Math.ceil(to));
  for (let y = first; y < last; y++) {
    const coverage = Math.min(y + 1, to) - Math.max(y, from);
    if (coverage <= 0) continue;
    for (let x = 0; x < cell.width; x++) {
      const a = cell.alpha(x, y) * coverage;
      mass += a;
      moment += a * x;
    }
  }
  return mass === 0 ? null : moment / mass;
}

function crownY(cell: AlphaCell): number | null {
  let mass = 0;
  for (let y = 0; y < cell.height; y++) {
    let rowMass = 0;
    for (let x = 0; x < cell.width; x++) rowMass += cell.alpha(x, y);
    if (mass + rowMass >= CROWN_INK_MASS_CELL_PX) {
      return y + (CROWN_INK_MASS_CELL_PX - mass) / rowMass;
    }
    mass += rowMass;
  }
  return null;
}

function travel(values: readonly number[]): number {
  return Math.max(...values) - Math.min(...values);
}

function measure(subject: IdleSubject): Measures | string {
  const declared = subject.def.states.get(subject.state);
  if (declared === undefined) return `${subject.label}: the figure declares no such state`;
  const cells = Array.from({ length: declared.frames }, (_unused, frame) =>
    alphaCell(subject.def, subject.state, frame),
  );
  const rows = solidRows(cells[0]);
  if (rows === null) return `${subject.label}[0] paints no solid ink`;
  const height = rows.bottom - rows.top;
  const headDepth = height * HEAD_BAND_SHARE;
  const firstCrown = crownY(cells[0]);
  if (firstCrown === null) return `${subject.label}[0] paints no crown`;
  // The head band rides each frame's own crown, so a head the breath lifts
  // straight up does not slide a differently shaped slice of itself, or of the
  // shoulders under it, through a fixed band and read as moving sideways.
  const crownToTop = firstCrown - rows.top;
  const hipFrom = rows.top + height * HIP_BAND_TOP_SHARE;
  const hipTo = rows.top + height * HIP_BAND_BOTTOM_SHARE;
  const toScreen = TILE_SIZE / subject.def.tileScale;

  const heads: number[] = [];
  const hips: number[] = [];
  const bodies: number[] = [];
  const crowns: number[] = [];
  for (const [frame, cell] of cells.entries()) {
    const crown = crownY(cell);
    if (crown === null) return `${subject.label}[${frame}] paints no crown`;
    const headTop = crown - crownToTop;
    const head = centroidX(cell, headTop, headTop + headDepth);
    const hip = centroidX(cell, hipFrom, hipTo);
    const body = centroidX(cell, 0, cell.height);
    if (head === null || hip === null || body === null) {
      return `${subject.label}[${frame}] paints nothing in a band frame 0 paints`;
    }
    heads.push(head);
    hips.push(hip);
    bodies.push(body);
    crowns.push(crown);
  }
  return {
    sidewaysHead: travel(heads) * toScreen,
    sidewaysHips: travel(hips) * toScreen,
    sidewaysBody: travel(bodies) * toScreen,
    crownRise: travel(crowns) * toScreen,
    frames: declared.frames,
  };
}

let failures: string[] = [];
function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

function px(value: number): string {
  return value.toFixed(PX_DECIMALS);
}

function gatePoses(report: boolean): void {
  let measured = 0;
  const worst = { head: 0, hips: 0, body: 0, crown: 0 };
  for (const subject of idleSubjects()) {
    const result = measure(subject);
    if (typeof result === 'string') {
      fail('I1', result);
      continue;
    }
    measured += result.frames;
    worst.head = Math.max(worst.head, result.sidewaysHead);
    worst.hips = Math.max(worst.hips, result.sidewaysHips);
    worst.body = Math.max(worst.body, result.sidewaysBody);
    worst.crown = Math.max(worst.crown, result.crownRise);
    if (report) {
      console.log(
        `  ${subject.label.padEnd(REPORT_LABEL_WIDTH)} head ${px(result.sidewaysHead)}  hips ${px(result.sidewaysHips)}  ` +
          `body ${px(result.sidewaysBody)}  crown ${px(result.crownRise)} px`,
      );
    }
    const sideways: ReadonlyArray<readonly [string, number]> = [
      ['head', result.sidewaysHead],
      ['hips', result.sidewaysHips],
      ['silhouette', result.sidewaysBody],
    ];
    for (const [part, distance] of sideways) {
      if (distance <= MAX_SIDEWAYS_TRAVEL_PX) continue;
      fail(
        'I1',
        `${subject.label}: the ${part} drifts ${px(distance)}px sideways across the idle ` +
          `(at most ${px(MAX_SIDEWAYS_TRAVEL_PX)}px) — a figure at rest is swaying`,
      );
    }
    if (result.crownRise > MAX_BREATH_RISE_PX) {
      fail(
        'I2',
        `${subject.label}: the crown rises and falls ${px(result.crownRise)}px over the breath ` +
          `(at most ${px(MAX_BREATH_RISE_PX)}px) — a breath that size reads as a bob`,
      );
    }
  }
  console.log(
    `  worst: head ${px(worst.head)}  hips ${px(worst.hips)}  silhouette ${px(worst.body)} ` +
      `sideways, crown ${px(worst.crown)} px`,
  );
  failures.push(
    ...nothingMeasuredFailures(measured, 'idle frames for stillness').map((m) => `I1: ${m}`),
  );
}

/**
 * Seconds from one entry into frame 0 to the next, following a runtime frame
 * clock tick by tick, or null if it never comes round twice.
 */
function breathSeconds(frameAt: (seconds: number) => number): number | null {
  const entries: number[] = [];
  let previous = -1;
  for (let t = 0; t <= CLOCK_SPAN_SECONDS; t += CLOCK_STEP_SECONDS) {
    const frame = frameAt(t);
    if (frame === 0 && previous !== 0 && previous !== -1) entries.push(t);
    previous = frame;
  }
  if (entries.length < 2) return null;
  return entries[1] - entries[0];
}

function gateBreathLength(): void {
  const clocks: ReadonlyArray<readonly [string, (seconds: number) => number]> = [
    ['the shared idle clock (Gum Gum, cultists, Incubus)', idleFrameAtSeconds],
    ['the town cast idle', (t) => townCastLoopFrame('idle', TOWN_CAST_IDLE_FRAMES, t)],
    ['the skyfowl cast idle', (t) => skyfowlCastLoopFrame('idle', SKYFOWL_IDLE_FRAMES, t)],
  ];
  for (const [label, frameAt] of clocks) {
    const seconds = breathSeconds(frameAt);
    if (seconds === null) {
      fail('I3', `${label} never came back round to frame 0 in ${CLOCK_SPAN_SECONDS}s`);
      continue;
    }
    console.log(`  ${label}: one breath every ${px(seconds)}s`);
    if (seconds < MIN_BREATH_SECONDS) {
      fail(
        'I3',
        `${label} breathes every ${px(seconds)}s (at least ${MIN_BREATH_SECONDS}s) — ` +
          'a standing loop played that fast reads as bobbing to music',
      );
    }
  }
  for (const state of ['idle', 'idle_side', 'idle_away'] as const) {
    const seconds = heldLength(HUMAN_ROW_TABLE[state].frameTicks) / TICKS_PER_SECOND;
    if (seconds < MIN_BREATH_SECONDS) {
      fail('I3', `carl.${state} breathes every ${px(seconds)}s (at least ${MIN_BREATH_SECONDS}s)`);
    }
  }
}

/** Every frame of a few subjects' idles at in-game size, enlarged, with a plumb line through frame 0's head. */
function writePreview(): void {
  const wanted = new Set([
    'carl.idle',
    'carl.idle_side',
    'adult_guard.idle',
    'adult_merchant.idle',
    'adult_noble.idle_side',
    'resident_wendell.idle',
    'resident_old_hilda.idle',
    'gumgum.idle',
    'gumgum.idle_side',
    'cultist.idle',
    'cultist.idle_side',
    'incubus.idle',
    'cretin_sledge.idle',
    `skyfowl_${SKYFOWL_CIVILIAN_LOOKS[0].id}.idle`,
  ]);
  const subjects = idleSubjects().filter((subject) => wanted.has(subject.label));
  const strips = subjects.map((subject) => idleStrip(subject));
  const width = Math.max(...strips.map((strip) => strip.width)) + PREVIEW_GAP * 2;
  const height = strips.reduce((sum, strip) => sum + strip.height + PREVIEW_GAP, PREVIEW_GAP);
  const sheet = createCanvas(width, height);
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = PREVIEW_BACKGROUND;
  ctx.fillRect(0, 0, width, height);
  let y = PREVIEW_GAP;
  for (const strip of strips) {
    ctx.drawImage(strip, PREVIEW_GAP, y);
    y += strip.height + PREVIEW_GAP;
  }
  const out = writePreviewPng(`${PREVIEW_DIR}/idle-stillness.png`, sheet.toBuffer('image/png'));
  console.log(`  wrote ${out} (${subjects.map((subject) => subject.label).join(', ')})`);
}

/** One subject's row: every frame at in-game size, then the same frames enlarged. */
function idleStrip(subject: IdleSubject): Canvas {
  const declared = subject.def.states.get(subject.state);
  const frames = declared?.frames ?? 0;
  const toScreen = TILE_SIZE / subject.def.tileScale;
  const gameW = Math.ceil(subject.def.frameWidth * toScreen);
  const gameH = Math.ceil(subject.def.frameHeight * toScreen);
  const bigW = gameW * PREVIEW_ENLARGE;
  const bigH = gameH * PREVIEW_ENLARGE;
  const strip = createCanvas(frames * (gameW + bigW), bigH);
  const ctx = strip.getContext('2d');
  const head = centroidX(alphaCell(subject.def, subject.state, 0), 0, subject.def.frameHeight / 2);
  for (let frame = 0; frame < frames; frame++) {
    const game = createCanvas(gameW, gameH);
    const gameCtx = game.getContext('2d');
    gameCtx.drawImage(paintFigureCell(subject.def, subject.state, frame), 0, 0, gameW, gameH);
    ctx.drawImage(game, frame * gameW, 0);
    ctx.imageSmoothingEnabled = false;
    const bigX = frames * gameW + frame * bigW;
    ctx.drawImage(game, bigX, 0, bigW, bigH);
    if (head !== null) {
      ctx.fillStyle = PREVIEW_PLUMB;
      ctx.fillRect(bigX + head * toScreen * PREVIEW_ENLARGE, 0, 1, bigH);
    }
  }
  return strip;
}

export function idleStillnessGateFailures(report = false): string[] {
  failures = [];
  gatePoses(report);
  gateBreathLength();
  return failures;
}

const invokedDirectly = process.argv[1].endsWith('gates-idle-stillness.ts');
if (invokedDirectly) {
  const args = new Set(process.argv.slice(2));
  const ok = reportFigureGates('idle stillness', idleStillnessGateFailures(args.has('--report')));
  if (args.has('--preview')) writePreview();
  if (!ok) process.exitCode = 1;
}
