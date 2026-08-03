#!/usr/bin/env tsx
/**
 * Headless review harness and bake gates for the Over City's townsfolk.
 *
 * The crowd is drawn at runtime from `src/sprites/person/*`, so there is no
 * sheet to open and the only in-game view of it is a plaza you have to walk to.
 * A walk cannot be judged from prose: this renders the walk cycle as a contact
 * sheet — every facing, every phase, against a ground line — so the pelvic bob,
 * the foot roll and the stance plant are all visible in a still.
 *
 *   npx tsx scripts/render-townsfolk.ts --out=townsfolk.png --scale=3
 *
 * It also runs gates that a picture cannot check, and exits non-zero if any
 * fail. Two of them guard defects this art has actually shipped: a cached cell
 * sized too small silently clips a hat, and a stance foot that drifts is the
 * skating read the whole gait rework exists to remove.
 */

import { createCanvas } from 'canvas';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { TILE_SIZE } from '../src/core/constants.js';
import { HUMANOID_NPC_SCALE } from '../src/sprites/humanoidScale.js';
import {
  generatePersonAppearance,
  type PersonAppearance,
  type TownRole,
} from '../src/sprites/person/PersonAppearance.js';
import { drawPerson } from '../src/sprites/person/drawPerson.js';
import {
  gaitSpeedFactor,
  poseForMotion,
  strideReach,
  walkCycleDistance,
} from '../src/sprites/person/gait.js';
import {
  BAKED_FACINGS,
  CELL_BOUNDS_SAMPLE_PHASES,
  personCellGeometry,
} from '../src/sprites/person/personCellBounds.js';
import {
  IDLE_PHASE_BUCKETS,
  MAX_BAKE_SCALE,
  WALK_PHASE_BUCKETS,
} from '../src/sprites/person/personFrameCache.js';
import { buildSkeleton, FOOT_BASE_FRAC, type Facing } from '../src/sprites/person/skeleton.js';

/**
 * node-canvas's 2D context implements every call the person renderer makes, but
 * it is a structurally distinct type — it lacks `filter`, `createConicGradient`
 * and a handful of others the game never touches. The two are bridged once here
 * rather than at each draw site, which is exactly what `src/core/canvasSurface`
 * does for `OffscreenCanvas`.
 */
type NodeContext = ReturnType<ReturnType<typeof createCanvas>['getContext']>;

function asGameContext(ctx: NodeContext): CanvasRenderingContext2D {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return ctx as unknown as CanvasRenderingContext2D;
}

/** Length of the `--` prefix plus the `=` separator around a flag name. */
const FLAG_SYNTAX_LENGTH = 3;

function parseFlag(name: string, fallback: string): string {
  const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return match === undefined ? fallback : match.slice(name.length + FLAG_SYNTAX_LENGTH);
}

const DEFAULT_SCALE = 3;
const MIN_SCALE = 1;
const MAX_SCALE = 10;

function parseScale(): number {
  const raw = parseFlag('scale', String(DEFAULT_SCALE));
  const value = Number(raw);
  if (!Number.isFinite(value) || value < MIN_SCALE || value > MAX_SCALE) {
    throw new Error(`--scale=${raw} is not a number in [${MIN_SCALE}, ${MAX_SCALE}]`);
  }
  return value;
}

// ── Sheet layout ─────────────────────────────────────────────────────────────

/** The size a citizen is actually drawn at in the world. */
const IN_GAME_DRAW_SIZE = TILE_SIZE * HUMANOID_NPC_SCALE;
/** Frames per row — the cache's own walk bucket count, so the sheet is what plays. */
const CYCLE_FRAMES = WALK_PHASE_BUCKETS;
const CELL_PAD = 6;
const LABEL_BAND = 14;
const ROW_GAP = 10;
const SHEET_MARGIN = 10;

const BACKDROP = '#2f3440';
const GROUND_LINE = 'rgba(120,220,255,0.45)';
const CELL_TINT = 'rgba(255,255,255,0.04)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '9px sans-serif';

const SHEET_FACINGS: ReadonlyArray<Facing> = ['right', 'left', 'down', 'up'];
const ARCHETYPE_ROLES: ReadonlyArray<TownRole> = [
  'commoner',
  'guard',
  'laborer',
  'child',
  'drunk',
  'beggar',
];

const SHEET_SEED = 1301;

interface SheetRow {
  label: string;
  appearance: PersonAppearance;
  facing: Facing;
  moving: boolean;
}

function sheetRows(): SheetRow[] {
  const hero = generatePersonAppearance(SHEET_SEED);
  const rows: SheetRow[] = SHEET_FACINGS.map((facing) => ({
    label: `walk ${facing}`,
    appearance: hero,
    facing,
    moving: true,
  }));
  rows.push({ label: 'idle down', appearance: hero, facing: 'down', moving: false });
  for (const role of ARCHETYPE_ROLES) {
    const appearance = generatePersonAppearance(SHEET_SEED, role);
    rows.push({
      label: `${role} · ${appearance.gait.archetype}`,
      appearance,
      facing: 'right',
      moving: true,
    });
  }
  return rows;
}

function renderSheet(scale: number, outPath: string, only: string): void {
  const all = sheetRows();
  const rows = only === '' ? all : all.filter((row) => row.label.includes(only));
  if (rows.length === 0) throw new Error(`--only=${only} matched no row`);
  const cellW = Math.ceil(IN_GAME_DRAW_SIZE + CELL_PAD * 2);
  const cellH = Math.ceil(IN_GAME_DRAW_SIZE + CELL_PAD * 2);
  const rowH = cellH + LABEL_BAND + ROW_GAP;
  const sheetW = SHEET_MARGIN * 2 + cellW * CYCLE_FRAMES;
  const sheetH = SHEET_MARGIN * 2 + rowH * rows.length;

  const canvas = createCanvas(Math.ceil(sheetW * scale), Math.ceil(sheetH * scale));
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, sheetW, sheetH);
  ctx.font = LABEL_FONT;
  ctx.textBaseline = 'top';

  rows.forEach((row, rowIndex) => {
    const top = SHEET_MARGIN + rowIndex * rowH;
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(row.label, SHEET_MARGIN, top);
    const cellTop = top + LABEL_BAND;

    for (let frame = 0; frame < CYCLE_FRAMES; frame++) {
      const cellLeft = SHEET_MARGIN + frame * cellW;
      ctx.fillStyle = frame % 2 === 0 ? CELL_TINT : BACKDROP;
      ctx.fillRect(cellLeft, cellTop, cellW, cellH);

      const boxLeft = cellLeft + CELL_PAD;
      const boxTop = cellTop + CELL_PAD;
      // The ground line is the reference the bob has to be judged against: a
      // pelvis rising and falling is invisible without something that does not.
      ctx.fillStyle = GROUND_LINE;
      ctx.fillRect(cellLeft, boxTop + IN_GAME_DRAW_SIZE * FOOT_BASE_FRAC, cellW, 1);

      drawPerson(
        asGameContext(ctx),
        boxLeft,
        boxTop,
        IN_GAME_DRAW_SIZE,
        row.appearance,
        frame / CYCLE_FRAMES,
        row.facing,
        row.moving,
      );
    }
  });

  writeFileSync(outPath, canvas.toBuffer('image/png'));
}

// ── Gates ────────────────────────────────────────────────────────────────────

const GATE_SEEDS = 220;
/** The cadence scan rasterizes nothing, so it can afford to cover the population. */
const CADENCE_SCAN_SEEDS = 20000;
const GATE_SEED_STRIDE = 37;
const GATE_ROLES: ReadonlyArray<TownRole> = [
  'commoner',
  'guard',
  'merchant',
  'farmer',
  'smith',
  'innkeeper',
  'priest',
  'child',
  'drunk',
  'noble',
  'beggar',
  'laborer',
];

const failures: string[] = [];

function fail(message: string): void {
  failures.push(message);
}

function gateAppearances(count: number = GATE_SEEDS): PersonAppearance[] {
  const people: PersonAppearance[] = [];
  for (let i = 0; i < count; i++) {
    people.push(
      generatePersonAppearance(1 + i * GATE_SEED_STRIDE, GATE_ROLES[i % GATE_ROLES.length]),
    );
  }
  return people;
}

/** Alpha at or below which a pixel counts as empty. */
const EMPTY_ALPHA = 2;
const ALPHA_CHANNEL_OFFSET = 3;
const RGBA_STRIDE = 4;
/** Cell area at the old one-size-fits-all padding, for the saving report. */
const LEGACY_TOP_FRACTION = 0.28;
const LEGACY_BOTTOM_FRACTION = 0.06;
const LEGACY_SIDE_FRACTION = 0.12;

/**
 * Every cached cell must contain all of its person's ink.
 *
 * The bound is computed analytically from the genome, so the only thing that
 * proves it is rasterizing the figure and looking at where the ink actually
 * lands: a hat whose reach changed in `drawPerson` but not in
 * `personCellBounds` clips silently, and it clips on one hairstyle out of ten.
 *
 * The figure is drawn into a canvas padded well past the cell on every side, so
 * overspill is *measured* rather than merely detected — drawing it into the
 * cell itself would clip the evidence away.
 */
function gateCellBounds(people: ReadonlyArray<PersonAppearance>): void {
  const size = IN_GAME_DRAW_SIZE;
  let worstOverspill = 0;
  let worstSeed = 0;
  let worstStyle = '';
  let clipped = 0;
  let ourArea = 0;
  let legacyArea = 0;
  const legacyW = size * (1 + LEGACY_SIDE_FRACTION * 2);
  const legacyH = size * (1 + LEGACY_TOP_FRACTION + LEGACY_BOTTOM_FRACTION);

  for (const appearance of people) {
    const cell = personCellGeometry(appearance, size);
    ourArea += cell.cellWidth * cell.cellHeight;
    legacyArea += legacyW * legacyH;

    const canvasW = cell.cellWidth + PROBE_PAD * 2;
    const canvasH = cell.cellHeight + PROBE_PAD * 2;
    const canvas = createCanvas(canvasW, canvasH);
    const ctx = canvas.getContext('2d');

    // Every pose the cache can serve, stacked into one image: the cell has to
    // hold the union, not whichever frame happened to be sampled.
    for (const facing of SHEET_FACINGS) {
      for (const moving of [true, false]) {
        for (let frame = 0; frame < CYCLE_FRAMES; frame++) {
          drawPerson(
            asGameContext(ctx),
            PROBE_PAD + cell.originX,
            PROBE_PAD + cell.originY,
            size,
            appearance,
            frame / CYCLE_FRAMES,
            facing,
            moving,
          );
        }
      }
    }

    const overspill = inkOverspill(
      ctx.getImageData(0, 0, canvasW, canvasH),
      cell.cellWidth,
      cell.cellHeight,
    );
    if (overspill > 0) clipped++;
    if (overspill > worstOverspill) {
      worstOverspill = overspill;
      worstSeed = appearance.seed;
      worstStyle = `${appearance.hair.style}, hat ${appearance.outfit.hat}`;
    }
  }

  const saving = 1 - ourArea / legacyArea;
  report(`cell area: ${(saving * PERCENT).toFixed(0)}% smaller than the old fixed padding`);
  if (clipped > 0) {
    fail(
      `cell bounds clip ink on ${clipped} of ${people.length} genomes; ` +
        `worst is ${worstOverspill} px (seed ${worstSeed}: ${worstStyle})`,
    );
  }
}

const PERCENT = 100;
/** Slack around the cell the gate rasterizes into, so overspill is measurable. */
const PROBE_PAD = 40;

/** How many pixels the ink reaches outside the cell rect, on its worst edge. */
function inkOverspill(
  image: { data: Uint8ClampedArray; width: number; height: number },
  cellWidth: number,
  cellHeight: number,
): number {
  const { data, width, height } = image;
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * RGBA_STRIDE + ALPHA_CHANNEL_OFFSET] <= EMPTY_ALPHA) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return 0;
  return Math.max(
    PROBE_PAD - minX,
    maxX - (PROBE_PAD + cellWidth - 1),
    PROBE_PAD - minY,
    maxY - (PROBE_PAD + cellHeight - 1),
    0,
  );
}

/** Frames simulated per slip check. */
const SLIP_FRAMES = 400;
const SLIP_SPEED = 0.7;
/** A planted foot may wander this fraction of a pixel before it reads as sliding. */
const SLIP_TOLERANCE_PX = 0.02;
const STANCE_END = 0.5;

/**
 * The planted foot must not move in world space.
 *
 * This is the defect the whole rework is about: with the cycle advanced by
 * distance travelled and the stance foot translating at exactly the body's
 * speed, a planted ankle's world position is constant. Any drift here is a
 * skate, however small it looks in a still.
 *
 * Archetypes that sway are exempt: a stagger moves the whole body sideways, and
 * the drunk's feet scuffing off the line is the point of it.
 */
function gateStancePlant(people: ReadonlyArray<PersonAppearance>): void {
  const size = IN_GAME_DRAW_SIZE;
  let worst = 0;
  let worstSeed = 0;

  for (const appearance of people) {
    if (appearance.gait.archetype === 'stagger') continue;
    const cycleDistance = walkCycleDistance(appearance, size);
    let worldX = 0;
    let phase = 0;
    let plantedAt: number | null = null;
    let previousCycle = -1;

    for (let frame = 0; frame < SLIP_FRAMES; frame++) {
      const cycle = (((phase + appearance.gait.phaseOffset) % 1) + 1) % 1;
      const pose = poseForMotion(appearance, 'right', phase, true);
      const skel = buildSkeleton(appearance, pose, 'right', worldX, 0, size);
      // Facing right, the near leg is the right leg, and the right foot's
      // stance is the first half of the cycle.
      const inStance = cycle < STANCE_END;
      const ankleWorldX = skel.nearLeg.end.x;
      const wrapped = cycle < previousCycle;
      if (!inStance || wrapped) plantedAt = null;
      if (inStance) {
        if (plantedAt === null) plantedAt = ankleWorldX;
        const drift = Math.abs(ankleWorldX - plantedAt);
        if (drift > worst) {
          worst = drift;
          worstSeed = appearance.seed;
        }
      }
      previousCycle = cycle;
      worldX += SLIP_SPEED;
      phase += SLIP_SPEED / cycleDistance;
    }
  }

  report(`stance plant: worst drift ${worst.toFixed(4)} px`);
  if (worst > SLIP_TOLERANCE_PX) {
    fail(
      `planted foot slides ${worst.toFixed(3)} px (seed ${worstSeed}); the walk will read as skating`,
    );
  }
}

const CONTACT_CYCLE = 0;
const MIDSTANCE_CYCLE = 0.25;

/**
 * The pelvis must be lowest at foot contact and highest over the straight
 * stance leg. The pose this replaced had it exactly inverted, and an inversion
 * is easy to fix into a different inversion — so it is asserted, not eyeballed.
 */
function gateBobPhase(people: ReadonlyArray<PersonAppearance>): void {
  for (const appearance of people) {
    const offset = appearance.gait.phaseOffset;
    const atContact = poseForMotion(appearance, 'right', CONTACT_CYCLE - offset, true);
    const atMidstance = poseForMotion(appearance, 'right', MIDSTANCE_CYCLE - offset, true);
    if (atContact.hipDrop <= atMidstance.hipDrop) {
      fail(
        `bob is inverted for seed ${appearance.seed}: hip drop ${atContact.hipDrop.toFixed(4)} at contact vs ${atMidstance.hipDrop.toFixed(4)} at midstance`,
      );
      return;
    }
  }
  report('bob phase: pelvis troughs at contact, peaks over the stance leg');
}

/**
 * The foot must roll: heel down at contact, toe down at push-off. A foot that
 * never rotates is most of what made the old walk read as sliding.
 */
function gateFootRoll(people: ReadonlyArray<PersonAppearance>): void {
  const justBeforeToeOff = STANCE_END - 0.01;
  for (const appearance of people) {
    const offset = appearance.gait.phaseOffset;
    const contact = poseForMotion(appearance, 'right', CONTACT_CYCLE - offset, true);
    const pushOff = poseForMotion(appearance, 'right', justBeforeToeOff - offset, true);
    if (contact.rightFoot.pitch >= 0) {
      fail(
        `seed ${appearance.seed} has no heel strike: pitch ${contact.rightFoot.pitch.toFixed(3)}`,
      );
      return;
    }
    if (pushOff.rightFoot.pitch <= 0) {
      fail(`seed ${appearance.seed} has no toe-off: pitch ${pushOff.rightFoot.pitch.toFixed(3)}`);
      return;
    }
  }
  report('foot roll: heel strike and toe-off present on every genome');
}

/**
 * The arm on a leg's own side must be at its furthest **back** when that leg is
 * at its furthest forward.
 *
 * This is the one defect in this rig that every limb moving correctly still
 * hides: driving the arm from a sine when the foot path peaks at cycle zero
 * leaves the arms a quarter of a stride out of phase, and the result reads as a
 * shuffle rather than as anything obviously broken. The repo has made exactly
 * this mistake before — see the `carl-arm-swing-is-90-degrees-out-of-phase`
 * note — so it is asserted rather than left to the eye.
 */
function gateArmPhase(people: ReadonlyArray<PersonAppearance>): void {
  for (const appearance of people) {
    const offset = appearance.gait.phaseOffset;
    const contact = poseForMotion(appearance, 'right', CONTACT_CYCLE - offset, true);
    const midStance = poseForMotion(appearance, 'right', MIDSTANCE_CYCLE - offset, true);
    if (contact.rightFoot.forward <= 0) {
      fail(
        `seed ${appearance.seed}: the right foot is not forward at contact — gate assumption broken`,
      );
      return;
    }
    if (contact.rightArm.swing >= 0) {
      fail(
        `arm swing is out of phase for seed ${appearance.seed}: the right arm is at ` +
          `${contact.rightArm.swing.toFixed(3)} rad while its own foot is forward; it must be behind`,
      );
      return;
    }
    if (contact.leftArm.swing <= 0) {
      fail(
        `both arms swing together for seed ${appearance.seed}: the left arm must be leading ` +
          `while the right foot is forward, and it is at ${contact.leftArm.swing.toFixed(3)} rad`,
      );
      return;
    }
    // Mid-stance is where a sine-driven arm would peak, so the arm passing
    // through neutral there is what distinguishes the two drivers.
    if (Math.abs(midStance.rightArm.swing) > Math.abs(contact.rightArm.swing)) {
      fail(
        `arm swing peaks at mid-stance for seed ${appearance.seed} — a quarter-cycle late; ` +
          `the driver should be a cosine of the cycle, not a sine`,
      );
      return;
    }
  }
  report('arm phase: each arm is furthest back as its own leg reaches forward');
}

/** The cell sampler must visit every phase the cache bakes, not merely near them. */
function gateSampleAlignment(): void {
  for (const buckets of [WALK_PHASE_BUCKETS, IDLE_PHASE_BUCKETS]) {
    if (CELL_BOUNDS_SAMPLE_PHASES % buckets === 0) continue;
    fail(
      `personCellBounds samples ${CELL_BOUNDS_SAMPLE_PHASES} phases, which is not a multiple of ` +
        `the cache's ${buckets} buckets — some baked poses are never measured`,
    );
    return;
  }
  report(
    `sampling: ${CELL_BOUNDS_SAMPLE_PHASES} bound samples cover all ` +
      `${WALK_PHASE_BUCKETS} walk and ${IDLE_PHASE_BUCKETS} idle phases`,
  );
}

/**
 * A leg may fall this far short of its foot target before the stride is a lie.
 * The two-bone solve holds back a thousandth of full extension — a straight
 * chain has no solution — so a fraction of a pixel of shortfall is the floor,
 * not a defect.
 */
const REACH_TOLERANCE_PX = 0.05;

/**
 * The IK's reach clamp must never bind at contact. `gait.ts` sizes the pelvic drop from the
 * stride precisely so a foot planted a stride ahead is reachable; if the clamp
 * is engaging, the leg is locking straight with its foot hanging above the floor
 * and the stride the cadence assumes is not the stride being drawn.
 */
function gateReach(people: ReadonlyArray<PersonAppearance>): void {
  const size = IN_GAME_DRAW_SIZE;
  let worst = 0;
  let worstSeed = 0;
  for (const appearance of people) {
    for (let frame = 0; frame < CYCLE_FRAMES; frame++) {
      const phase = frame / CYCLE_FRAMES;
      const pose = poseForMotion(appearance, 'right', phase, true);
      const skel = buildSkeleton(appearance, pose, 'right', 0, 0, size);
      const groundY = size * FOOT_BASE_FRAC;
      const targetY = groundY - pose.rightFoot.lift * size;
      const shortfall = Math.abs(skel.nearLeg.end.y - targetY);
      if (shortfall > worst) {
        worst = shortfall;
        worstSeed = appearance.seed;
      }
    }
  }
  report(`ik reach: worst shortfall ${worst.toFixed(4)} px`);
  if (worst > REACH_TOLERANCE_PX) {
    fail(`leg cannot reach its foot target, short by ${worst.toFixed(3)} px (seed ${worstSeed})`);
  }
}

/**
 * A citizen's legs must not blur.
 *
 * Cadence is `speed / cycleDistance`, so a crowd handed one speed range while
 * its strides differ four-fold gets a four-fold spread of step rates — which is
 * exactly what shipped: a child's legs moved at fourteen steps a second beside
 * an adult's four, because a child is 62 % of an adult's height and was walking
 * at an adult's pace. `gaitSpeedFactor` now takes most of that difference out of
 * the speed instead. Below one stride per bucket-count of frames the cache's
 * sixteen baked poses cannot all be shown and the legs alias, so that is the
 * floor.
 */
function gateCadence(): void {
  const size = IN_GAME_DRAW_SIZE;
  // Its own, much wider sample: this gate is pure arithmetic on the genome, so
  // it costs nothing to scan far more people than the gates that rasterize, and
  // the number it prints is quoted as the crowd's range rather than a sample's.
  const people = gateAppearances(CADENCE_SCAN_SEEDS);
  let worstFrames = Number.POSITIVE_INFINITY;
  let worstSeed = 0;
  let fastestSteps = 0;
  let slowestSteps = Number.POSITIVE_INFINITY;

  for (const appearance of people) {
    const cycleDistance = walkCycleDistance(appearance, size);
    const speed = FASTEST_CITIZEN_SPEED * gaitSpeedFactor(appearance);
    const frames = cycleDistance / speed;
    if (frames < worstFrames) {
      worstFrames = frames;
      worstSeed = appearance.seed;
    }
    const stepsPerSecond = (STEPS_PER_CYCLE / frames) * FRAMES_PER_SECOND;
    fastestSteps = Math.max(fastestSteps, stepsPerSecond);
    slowestSteps = Math.min(slowestSteps, stepsPerSecond);
  }

  report(
    `cadence: ${slowestSteps.toFixed(1)}–${fastestSteps.toFixed(1)} steps/s at full cohort speed ` +
      `(${worstFrames.toFixed(1)} frames per cycle at worst)`,
  );
  if (worstFrames < WALK_PHASE_BUCKETS) {
    fail(
      `seed ${worstSeed} completes a stride in ${worstFrames.toFixed(1)} frames, under the ` +
        `${WALK_PHASE_BUCKETS} baked poses — its legs will blur`,
    );
  }
}

const STEPS_PER_CYCLE = 2;
const FRAMES_PER_SECOND = 60;

/** The fastest speed any `TownLifeSystem` cohort hands out, before the gait scales it. */
const FASTEST_CITIZEN_SPEED = 1;

/** Stride must scale with the body, not sit at one length for everybody. */
function reportStride(people: ReadonlyArray<PersonAppearance>): void {
  const size = IN_GAME_DRAW_SIZE;
  let shortestCycle = Number.POSITIVE_INFINITY;
  let longestCycle = 0;
  for (const appearance of people) {
    const distance = walkCycleDistance(appearance, size);
    shortestCycle = Math.min(shortestCycle, distance);
    longestCycle = Math.max(longestCycle, distance);
  }
  report(`stride: ${shortestCycle.toFixed(1)}–${longestCycle.toFixed(1)} px per cycle`);
  const reference = generatePersonAppearance(SHEET_SEED);
  report(`reference stride reach: ${(strideReach(reference) * size).toFixed(2)} px`);
}

/** RGBA. */
const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;
/** A full plaza crowd, which is what the byte budget has to hold. */
const PLAZA_CROWD = 40;

/**
 * What a full crowd costs the frame cache with every cell baked — the worst
 * case the byte budget is sized against.
 */
function reportCacheFootprint(people: ReadonlyArray<PersonAppearance>): void {
  const size = IN_GAME_DRAW_SIZE;
  const cellsPerPerson = BAKED_FACINGS.length * (WALK_PHASE_BUCKETS + IDLE_PHASE_BUCKETS);
  let totalArea = 0;
  for (const appearance of people) {
    const cell = personCellGeometry(appearance, size);
    totalArea +=
      Math.ceil(cell.cellWidth * MAX_BAKE_SCALE) * Math.ceil(cell.cellHeight * MAX_BAKE_SCALE);
  }
  const bytesPerPerson = (totalArea / people.length) * cellsPerPerson * BYTES_PER_PIXEL;
  report(
    `cache: ${cellsPerPerson} cells/person at ${MAX_BAKE_SCALE}x bake, ` +
      `${(bytesPerPerson / BYTES_PER_MEGABYTE).toFixed(2)} MB/person, ` +
      `${((bytesPerPerson * PLAZA_CROWD) / BYTES_PER_MEGABYTE).toFixed(1)} MB for ${PLAZA_CROWD}`,
  );
}

const reports: string[] = [];
function report(line: string): void {
  reports.push(line);
}

// ── Entry ────────────────────────────────────────────────────────────────────

const scale = parseScale();
const outPath = resolve(parseFlag('out', 'townsfolk-review.png'));
const people = gateAppearances();

gateBobPhase(people);
gateArmPhase(people);
gateSampleAlignment();
gateCadence();
gateFootRoll(people);
gateReach(people);
gateStancePlant(people);
gateCellBounds(people);
reportStride(people);
reportCacheFootprint(people);
renderSheet(scale, outPath, parseFlag('only', ''));

for (const line of reports) console.log(`  ${line}`);
console.log(`\nWrote ${outPath} at ${scale}x`);

if (failures.length > 0) {
  console.error('\nGATE FAILURES:');
  for (const line of failures) console.error(`  ✗ ${line}`);
  process.exit(1);
}
console.log('All townsfolk gates passed.');
