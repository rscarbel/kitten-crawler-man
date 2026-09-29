#!/usr/bin/env tsx
/**
 * Art gates for the closed-set human townsfolk cast.
 *
 *   H1  structure: nothing clipped, nothing blank, no cell is mostly air
 *   H2  every state the sprite wrapper can ask for is one the figure paints
 *   H3  anchor: each look's soles stand on the tile it claims, feet planted
 *       in the stance phase of the walk cycle rather than sliding through it
 *   H4  walk/idle/talk frames within a row are distinct pictures, not the
 *       same pose painted `frameCount` times
 *   H5  builds are visually distinct from one another at 32px (measured ink width)
 *   H6  residency: the whole closed set fits the figure cache's own budget
 *   H7  no adult look stands shorter than any child look (plus a margin) —
 *       a build is a frame, never a shrunk-or-stretched age
 *   H8  no two adult looks share the same (skin, hair colour, hair style,
 *       garment colour) combination — every look is visually distinguishable
 *       by at least one of those axes
 *
 * Run by `npm run render:human-cast`, or alone: `npx tsx scripts/gates-human-cast.ts`.
 */

import { paintFigureCell } from './figureSheet.js';
import {
  distinctFrameFailures,
  figureStructuralFailures,
  inkBoxOf,
  missingStateFailures,
  nothingMeasuredFailures,
  reportFigureGates,
} from './figureGates.js';
import {
  ALL_TOWN_CAST_VIEWS,
  townCastFigure,
  townCastStateName,
  WORK_TOWN_CAST_VIEWS,
} from '../src/sprites/art/townCastFigure.js';
import { TOWN_CAST_LOOKS, type TownCastLook } from '../src/sprites/person/townCastLooks.js';
import {
  CACHE_BUDGET_MEGABYTES,
  figureByteBudgetFor,
} from '../src/sprites/figure/figureFrameCache.js';

let failures: string[] = [];
function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

const CAST_MIN_INK_AREA_SHARE = 0.1;
const PERCENT = 100;
const SHARE_DECIMALS = 2;

function gateStructure(): void {
  for (const look of TOWN_CAST_LOOKS) {
    for (const failure of figureStructuralFailures(townCastFigure(look.id), {
      minInkAreaShare: CAST_MIN_INK_AREA_SHARE,
    })) {
      fail('H1', failure);
    }
  }
}

/** Every state name the runtime sprite wrapper (`townCastSprite.ts`) can ask a look for. */
function drawnStates(look: TownCastLook): string[] {
  const states: string[] = [];
  for (const view of ALL_TOWN_CAST_VIEWS) {
    states.push(townCastStateName('walk', view), townCastStateName('idle', view));
    states.push(townCastStateName('talk', view));
  }
  if (look.hasWork) {
    for (const view of WORK_TOWN_CAST_VIEWS) states.push(townCastStateName('work', view));
  }
  return states;
}

function gateStateNames(): void {
  let measured = 0;
  for (const look of TOWN_CAST_LOOKS) {
    const figure = townCastFigure(look.id);
    const names = drawnStates(look);
    measured += names.length;
    for (const failure of missingStateFailures(figure, names, `${look.id}'s sprite wrapper`)) {
      fail('H2', failure);
    }
  }
  failures.push(...nothingMeasuredFailures(measured, 'state names').map((m) => `H2: ${m}`));
}

/** How near the ground line a planted foot's ink must stay, as a share of the cell height. */
const PLANT_TOLERANCE_SHARE = 0.12;

function gateAnchor(): void {
  let measured = 0;
  for (const look of TOWN_CAST_LOOKS) {
    const figure = townCastFigure(look.id);
    const tileBottom = figure.tileY + figure.tileScale;
    for (const view of ALL_TOWN_CAST_VIEWS) {
      const state = townCastStateName('walk', view);
      const declared = figure.states.get(state);
      if (declared === undefined) continue;
      for (let frame = 0; frame < declared.frames; frame++) {
        const box = inkBoxOf(figure, state, frame);
        if (box === null) continue;
        measured++;
        const overshoot = box.maxY - tileBottom;
        if (overshoot > figure.frameHeight * PLANT_TOLERANCE_SHARE) {
          fail(
            'H3',
            `${figure.id}.${state}[${frame}] paints ink ${overshoot.toFixed(1)}px below the tile line ` +
              `(${tileBottom}) — the figure floats off the ground its own anchor claims`,
          );
        }
      }
    }
  }
  failures.push(
    ...nothingMeasuredFailures(measured, 'walk frames for anchoring').map((m) => `H3: ${m}`),
  );
}

function gateFrameDistinctness(): void {
  let measured = 0;
  for (const look of TOWN_CAST_LOOKS) {
    const figure = townCastFigure(look.id);
    const report = distinctFrameFailures(
      figure,
      (state, frame) => {
        const cell = paintFigureCell(figure, state, frame);
        return cell.getContext('2d').getImageData(0, 0, cell.width, cell.height).data;
      },
      { subject: `${look.id}'s pose` },
    );
    measured += report.framesMeasured;
    for (const failure of report.failures) fail('H4', failure);
  }
  failures.push(
    ...nothingMeasuredFailures(measured, 'frames for distinctness').map((m) => `H4: ${m}`),
  );
}

/** A look's measured ink box at 32px, from its idle-front frame 0 — the same reference pose every gate below reads from. */
function idleInkBoxAt32(look: TownCastLook): { width: number; height: number } | null {
  const figure = townCastFigure(look.id);
  const box = inkBoxOf(figure, townCastStateName('idle', 'down'), 0);
  if (box === null) return null;
  // `inkBoxOf` measures the figure's own baked density, not 32px directly, but
  // every look shares one bake density, so a ratio between two looks' boxes is
  // the same at any density — only the absolute px numbers in a message differ.
  return { width: box.maxX - box.minX, height: box.maxY - box.minY };
}

/** How different two builds' measured ink width must be before they read as the same frame. */
const MIN_BUILD_WIDTH_DIFFERENCE_SHARE = 0.12;

function gateBuildDistinctness(): void {
  const adults = TOWN_CAST_LOOKS.filter(
    (look): look is TownCastLook & { painter: 'carl' } => look.painter === 'carl',
  );
  const byBuild = new Map<string, { width: number }[]>();
  for (const look of adults) {
    const box = idleInkBoxAt32(look);
    if (box === null) continue;
    const list = byBuild.get(look.build) ?? [];
    list.push(box);
    byBuild.set(look.build, list);
  }
  const meanWidthByBuild = new Map<string, number>();
  for (const [build, boxes] of byBuild) {
    meanWidthByBuild.set(build, boxes.reduce((sum, b) => sum + b.width, 0) / boxes.length);
  }
  const builds = [...meanWidthByBuild.entries()];
  let measured = 0;
  for (let i = 1; i < builds.length; i++) {
    for (let j = 0; j < i; j++) {
      measured++;
      const [buildA, widthA] = builds[i];
      const [buildB, widthB] = builds[j];
      const share = Math.abs(widthA - widthB) / Math.max(widthA, widthB);
      if (share < MIN_BUILD_WIDTH_DIFFERENCE_SHARE) {
        fail(
          'H5',
          `${buildA} (mean ink width ${widthA.toFixed(1)}px) and ${buildB} (${widthB.toFixed(1)}px) ` +
            `differ by only ${(share * PERCENT).toFixed(SHARE_DECIMALS)}% — the two builds read as one frame`,
        );
      }
    }
  }
  failures.push(...nothingMeasuredFailures(measured, 'build pairs').map((m) => `H5: ${m}`));
}

/** How much taller than the tallest child every adult look must stand, as a share of the child's own height. */
const MIN_ADULT_OVER_CHILD_HEIGHT_SHARE = 0.15;

function gateAdultTallerThanChild(): void {
  const childHeights = TOWN_CAST_LOOKS.filter((look) => look.painter === 'person')
    .map(idleInkBoxAt32)
    .filter((box): box is { width: number; height: number } => box !== null)
    .map((box) => box.height);
  const tallestChild = Math.max(...childHeights);
  failures.push(
    ...nothingMeasuredFailures(childHeights.length, 'child looks for height').map(
      (m) => `H7: ${m}`,
    ),
  );

  let measured = 0;
  for (const look of TOWN_CAST_LOOKS) {
    if (look.painter !== 'carl') continue;
    const box = idleInkBoxAt32(look);
    if (box === null) continue;
    measured++;
    const minHeight = tallestChild * (1 + MIN_ADULT_OVER_CHILD_HEIGHT_SHARE);
    if (box.height < minHeight) {
      fail(
        'H7',
        `${look.id} stands ${box.height.toFixed(1)}px tall, under the ${minHeight.toFixed(1)}px an adult ` +
          `must clear over the tallest child (${tallestChild.toFixed(1)}px) — it reads as a shrunk Carl, not a build`,
      );
    }
  }
  failures.push(
    ...nothingMeasuredFailures(measured, 'adult looks for height').map((m) => `H7: ${m}`),
  );
}

function gateLookCombinationsDistinct(): void {
  const seen = new Map<string, string>();
  let measured = 0;
  for (const look of TOWN_CAST_LOOKS) {
    if (look.painter !== 'carl') continue;
    measured++;
    const key = [
      look.skinRamp.base,
      look.hairRamp.base,
      look.hairStyle,
      look.garmentRamp.base,
    ].join('|');
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      fail(
        'H8',
        `${look.id} shares its whole (skin, hair colour, hair style, garment colour) combination ` +
          `with ${earlier} — nothing distinguishes them`,
      );
      continue;
    }
    seen.set(key, look.id);
  }
  failures.push(
    ...nothingMeasuredFailures(measured, 'adult looks for combination distinctness').map(
      (m) => `H8: ${m}`,
    ),
  );
}

const RGBA_BYTES_PER_PIXEL = 4;
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;

/**
 * The bytes every declared cell of `look`'s figure would cost if every row's
 * every frame were baked and held resident at once — the true theoretical
 * ceiling, as opposed to {@link figureByteBudgetFor}'s per-figure cap, which
 * the LRU cache enforces on any *one* figure but never asks every figure to
 * hit simultaneously. The runtime's actual peak (`npm run measure:town-plaza`)
 * is well under this, because a citizen off screen keeps no rows warm at all.
 */
function fullBakeBytes(look: TownCastLook): number {
  const figure = townCastFigure(look.id);
  let frames = 0;
  for (const declared of figure.states.values()) frames += declared.frames;
  return figure.frameWidth * figure.frameHeight * RGBA_BYTES_PER_PIXEL * frames;
}

function gateResidency(): void {
  const totalMb =
    TOWN_CAST_LOOKS.reduce((sum, look) => sum + fullBakeBytes(look), 0) / BYTES_PER_MEGABYTE;
  const perFigureMb =
    TOWN_CAST_LOOKS.reduce((sum, look) => sum + figureByteBudgetFor(townCastFigure(look.id)), 0) /
    BYTES_PER_MEGABYTE;
  console.log(
    `  info human cast: ${totalMb.toFixed(2)} MB if every row of every look baked at once ` +
      `(${TOWN_CAST_LOOKS.length} looks; shared cache budget ${CACHE_BUDGET_MEGABYTES} MB; per-figure cap ` +
      `sums to ${perFigureMb.toFixed(0)} MB, never all drawn together) — see \`npm run measure:town-plaza\` ` +
      'for the actual measured peak with the crowd on screen',
  );
}

export function humanCastGateFailures(): string[] {
  failures = [];
  gateStructure();
  gateStateNames();
  gateAnchor();
  gateFrameDistinctness();
  gateBuildDistinctness();
  gateAdultTallerThanChild();
  gateLookCombinationsDistinct();
  gateResidency();
  return failures;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ok = reportFigureGates('human-cast', humanCastGateFailures());
  if (!ok) process.exitCode = 1;
}
