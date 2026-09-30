#!/usr/bin/env tsx
/**
 * The Big Top as a player stands in it: the real tile map through the real
 * chunk bake, the maze's dressing and props, and Carl and Donut for scale —
 * one frame per act, a curtain room, and one per forced hazard state, each at
 * 32 and 64 px per tile.
 *
 *   npm run render:bigtop-interior
 *   npm run render:bigtop-interior -- --label=before
 *   npm run render:bigtop-interior -- --only=vent
 *   npm run render:bigtop-interior -- --lighting=fullBright
 *
 * `--lighting` is `lit` (the game's own frame, the default), `fullBright` (no
 * stage lights, the reference the lighting gate compares a lit frame against)
 * or `darkTelegraph` (the lights laid over every warning — the fault the
 * lighting gate catches).
 *
 * Writes `preview/bigtop-interior/<label>/<shot>-<px>px.png` (label defaults
 * to `latest`), plus `fairness.json` with the hazard-contrast and floor
 * luminance measurements from `bigTopLightingFairness.ts`, so two labelled
 * runs can be compared picture for picture and number for number.
 *
 * Measurements are taken on a whole-tent frame at 32 px per tile with neither
 * the crawlers nor the maze's mobs drawn — the mirror and bell targets are mobs,
 * and one standing in the ring around a hazard would be scored as its floor —
 * so every tile of a forced state is scored against sawdust and dressing only,
 * and nothing occludes a telegraph.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { TILE_SIZE } from '../src/core/constants.js';
import type { Difficulty } from '../src/core/difficultyProfiles.js';
import { FLOOR_ART_SEEDS } from '../src/map/ground/artSeedAlphabet.js';
import { MAZE_CURTAINS, type MazeSectionId, type MazeTile } from '../src/map/bigTopMazeLayout.js';
import {
  HAZARD_ACT,
  HAZARD_STATES,
  buildTent,
  enterAct,
  entryAt,
  forceHazard,
  hazardFocus,
  placeAt,
  renderTentFrame,
  safeTilesNear,
  solveHall,
  viewCentredOn,
  wholeTentView,
  type ForcedHazard,
  type HazardState,
  type TentHarness,
  type TentLighting,
} from './bigTopInteriorHarness.js';
import {
  framePixels,
  measureHazardContrast,
  measureTentLuminance,
  type HazardContrastReport,
} from './bigTopLightingFairness.js';
import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';

const ARG_PREFIX_LENGTH = '--='.length;

function stringArg(name: string, fallback: string): string {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return raw === undefined ? fallback : raw.slice(name.length + ARG_PREFIX_LENGTH);
}

const label = stringArg('label', 'latest');
const lightingArg = stringArg('lighting', 'lit');
const TENT_LIGHTINGS: ReadonlyArray<TentLighting> = ['lit', 'fullBright', 'darkTelegraph'];
const lighting = TENT_LIGHTINGS.find((candidate) => candidate === lightingArg);
if (lighting === undefined) throw new Error(`unknown --lighting=${lightingArg}`);
const only = stringArg('only', '').toLowerCase();
const outDir = `${PREVIEW_DIR}/bigtop-interior/${label}`;
const ART_SEED = FLOOR_ART_SEEDS[0] ?? 0;
/** 32 and 64 px per tile: the game's own scale, and a zoom for judging detail. */
const RENDER_SCALES = [1, 2] as const;
const MEASURE_SCALE = 1;
const HEX_RADIX = 16;
const DIGITS = 3;
/** Column widths for the console table. */
const STATE_COLUMN = 16;
const COUNT_COLUMN = 3;
const SPREAD_NAME_COLUMN = 9;

await loadGameSpritesInNode(ART_SEED);

interface Shot {
  readonly id: string;
  readonly act: MazeSectionId;
  readonly focus: MazeTile;
  /** Drives the tent into the shot's state; returns the hazards it forced. */
  readonly force: (tent: TentHarness) => ForcedHazard[];
  /** Where Carl and Donut stand, given the forced hazards. */
  readonly party: (tent: TentHarness, forced: ReadonlyArray<ForcedHazard>) => [MazeTile, MazeTile];
}

const atActMarks = (tent: TentHarness): [MazeTile, MazeTile] => [
  tent.section.humanSpawn,
  tent.section.catSpawn,
];

/** The menagerie's interval pair: the first one a party reaches mid-run with an act behind it. */
const CURTAIN_ROOM = entryAt(MAZE_CURTAINS, 1);
if (CURTAIN_ROOM === undefined) throw new Error('the tent has no curtain rooms');

/** A shot per act, framed on the act's heart rather than its entrance. */
const ACT_FRAMES: ReadonlyArray<Pick<Shot, 'id' | 'act' | 'focus'>> = [
  { id: 'act-firewalk', act: 'firewalk', focus: { x: 22, y: 76 } },
  { id: 'act-menagerie', act: 'menagerie', focus: { x: 22, y: 49 } },
  { id: 'act-mirrors', act: 'mirrors', focus: { x: 22, y: 24 } },
  { id: 'act-finale', act: 'finale', focus: { x: 22, y: 6 } },
];
const ACT_SHOTS: ReadonlyArray<Shot> = ACT_FRAMES.map((shot) => ({
  ...shot,
  force: () => [],
  party: atActMarks,
}));

const curtainShot: Shot = {
  id: 'curtain-room',
  act: 'menagerie',
  focus: CURTAIN_ROOM.windowTile,
  force: () => [],
  party: () => [
    { x: CURTAIN_ROOM.humanRoom.x0, y: CURTAIN_ROOM.humanRoom.y0 },
    { x: CURTAIN_ROOM.catRoom.x1, y: CURTAIN_ROOM.catRoom.y0 },
  ],
};

/** The hall's funhouse glass: Carl at a side wall's panes, Donut at the dividing wall's. */
const reflectionShot: Shot = {
  id: 'mirror-reflections',
  act: 'mirrors',
  focus: { x: 12, y: 22 },
  force: () => [],
  party: () => [
    { x: 5, y: 22 },
    { x: 20, y: 21 },
  ],
};

/** Both limelight states show in one frame, so they share a shot. */
const HAZARD_SHOT_GROUPS: ReadonlyArray<{ id: string; states: ReadonlyArray<HazardState> }> = [
  { id: 'vent-telegraph', states: ['vent-telegraph'] },
  { id: 'vent-flame', states: ['vent-flame'] },
  { id: 'spotlight-warm', states: ['spotlight-warm'] },
  { id: 'spotlight-beam', states: ['spotlight-beam'] },
  { id: 'held-row', states: ['held-row'] },
  { id: 'beams-hot-and-cold', states: ['beam-hot', 'beam-cold'] },
];

const PARTY_SIZE = 2;

const hazardShots: Shot[] = HAZARD_SHOT_GROUPS.map(({ id, states }) => {
  const first = entryAt(states, 0);
  if (first === undefined) throw new Error(`${id}: a hazard shot forces at least one state`);
  return {
    id,
    act: HAZARD_ACT[first],
    focus: hazardFocus(first),
    force: (tent) => states.map((state) => forceHazard(tent, state)),
    party: (tent, forced) => {
      const avoid = forced.flatMap((hazard) => [...hazard.family, ...hazard.tiles]);
      const standing = safeTilesNear(tent.map, hazardFocus(first), PARTY_SIZE, avoid);
      const carl = entryAt(standing, 0);
      const donut = entryAt(standing, 1);
      if (carl === undefined || donut === undefined) {
        throw new Error(`${id}: no safe floor near the hazard to stand the party on`);
      }
      return [carl, donut];
    },
  };
});

const shots = [...ACT_SHOTS, curtainShot, reflectionShot, ...hazardShots].filter((shot) =>
  shot.id.includes(only),
);
/** The prefix of every dealt-hall shot. */
const HALL_SHOT_ID = 'hall-world';
if (shots.length === 0 && !HALL_SHOT_ID.includes(only)) {
  throw new Error(`--only=${only} matched no shot`);
}

const contrastReports: HazardContrastReport[] = [];
const problems: string[] = [];

for (const shot of shots) {
  const tent = buildTent(ART_SEED);
  enterAct(tent, shot.act);
  const forced = shot.force(tent);

  const measureView = wholeTentView(tent.map);
  const measured = renderTentFrame(tent, measureView, {
    scale: MEASURE_SCALE,
    withParty: false,
    withMobs: false,
    lighting,
  });
  const pixels = framePixels(measured, measureView, MEASURE_SCALE);
  for (const hazard of forced) {
    const report = measureHazardContrast(pixels, tent.map, hazard);
    contrastReports.push(report);
    if (report.samples.length === 0) problems.push(`${hazard.state}: no tile could be scored`);
  }

  const [carl, donut] = shot.party(tent, forced);
  placeAt(tent.human, carl);
  placeAt(tent.cat, donut);
  const view = viewCentredOn(shot.focus);
  for (const scale of RENDER_SCALES) {
    const canvas = renderTentFrame(tent, view, { scale, withParty: true, lighting });
    const pxPerTile = `${scale * TILE_SIZE}px`;
    const outPath = writePreviewPng(
      `${outDir}/${shot.id}-${pxPerTile}.png`,
      canvas.toBuffer('image/png'),
    );
    console.log(outPath);
  }
}

/**
 * Worlds whose dealt halls are drawn too, each before and after it is solved,
 * across every tier: the board is generated, so one world's picture proves
 * nothing about the next one's.
 */
const HALL_WORLDS: ReadonlyArray<{ readonly worldSeed: number; readonly difficulty: Difficulty }> =
  [
    { worldSeed: 0x5eed_b16, difficulty: 'normal' },
    { worldSeed: 0x0c1a_55e5, difficulty: 'normal' },
    { worldSeed: 0x7a11_e0d0, difficulty: 'easy' },
    { worldSeed: 0x00b1_6b0f, difficulty: 'hard' },
    { worldSeed: 0x3f00_d1e5, difficulty: 'hard' },
  ];
/** The middle of the hall with its teaching strip, which one frame shows whole. */
const HALL_FOCUS: MazeTile = { x: 21, y: 27 };
if (HALL_SHOT_ID.includes(only)) {
  for (const { worldSeed, difficulty } of HALL_WORLDS) {
    const tent = buildTent(ART_SEED, { worldSeed, difficulty });
    enterAct(tent, 'mirrors');
    const name = `${HALL_SHOT_ID}-${worldSeed.toString(HEX_RADIX)}-${difficulty}`;
    for (const state of ['unsolved', 'solved'] as const) {
      if (state === 'solved') solveHall(tent);
      placeAt(tent.human, tent.section.humanSpawn);
      placeAt(tent.cat, tent.section.catSpawn);
      for (const scale of RENDER_SCALES) {
        const canvas = renderTentFrame(tent, viewCentredOn(HALL_FOCUS), {
          scale,
          withParty: true,
          lighting,
        });
        const outPath = writePreviewPng(
          `${outDir}/${name}-${state}-${scale * TILE_SIZE}px.png`,
          canvas.toBuffer('image/png'),
        );
        console.log(outPath);
      }
    }
  }
}

console.log(
  '\nHazard vs. surrounding floor at 32 px/tile (contrast: WCAG ratio; salience: sRGB units):',
);
for (const report of contrastReports) {
  console.log(
    `  ${report.state.padEnd(STATE_COLUMN)} tiles ${String(report.samples.length).padStart(COUNT_COLUMN)}  ` +
      `contrast min ${report.minContrast.toFixed(DIGITS)} median ${report.medianContrast.toFixed(DIGITS)}  ` +
      `salience min ${report.minSalience.toFixed(1)} median ${report.medianSalience.toFixed(1)}` +
      (report.unmeasured.length > 0 ? `  (${report.unmeasured.length} unscored)` : ''),
  );
}

const forcedStates = new Set(contrastReports.map((report) => report.state));
const measuredEveryState = HAZARD_STATES.every((state) => forcedStates.has(state));

let tentLuminance: ReturnType<typeof measureTentLuminance> | null = null;
if (only === '') {
  const tent = buildTent(ART_SEED);
  const view = wholeTentView(tent.map);
  const frame = renderTentFrame(tent, view, {
    scale: MEASURE_SCALE,
    withParty: false,
    withMobs: false,
    lighting,
  });
  tentLuminance = measureTentLuminance(framePixels(frame, view, MEASURE_SCALE), tent.map);
  const { floor, solid } = tentLuminance;
  console.log('\nTent luminance (mean relative luminance per tile, 32 px/tile):');
  for (const [name, spread] of [
    ['walkable', floor],
    ['solid', solid],
  ] as const) {
    console.log(
      `  ${name.padEnd(SPREAD_NAME_COLUMN)} tiles ${spread.tiles}  min ${spread.min.toFixed(DIGITS)}  ` +
        `p10 ${spread.p10.toFixed(DIGITS)}  median ${spread.median.toFixed(DIGITS)}  ` +
        `mean ${spread.mean.toFixed(DIGITS)}`,
    );
  }
  if (!measuredEveryState) problems.push('not every hazard state was forced and measured');
}

const summary = {
  label,
  lighting,
  hazardContrast: contrastReports.map((report) => ({
    state: report.state,
    tiles: report.samples.length,
    unscored: report.unmeasured.length,
    minContrast: report.minContrast,
    medianContrast: report.medianContrast,
    minSalience: report.minSalience,
    medianSalience: report.medianSalience,
  })),
  tentLuminance,
};
const summaryPath = resolve(`${outDir}/fairness.json`);
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`\n${summaryPath}`);

for (const problem of problems) console.log(` FAIL  ${problem}`);
process.exit(problems.length === 0 ? 0 : 1);
