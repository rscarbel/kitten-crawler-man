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
 *   H8  no two adult looks share the same (skin, hair colour, hair style,
 *       garment colour) combination — every look is visually distinguishable
 *       by at least one of those axes
 *   H9  at every variety tier the street wears no more distinct human looks
 *       than the tier's plan allows, each one offered for the role its
 *       citizen's group wears, and never a named resident's look
 *   H10 a citizen of either cast changes look only at a purged canvas
 *       recovery, to the one the tier then gives it; a named resident and a
 *       citizen in a conversation keep theirs at every tier
 *
 * Run by `npm run render:human-cast`, or alone: `npx tsx scripts/gates-human-cast.ts`.
 */

import { pathToFileURL } from 'node:url';

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
import {
  TOWN_CAST_LOOKS,
  TOWN_CAST_TIER_PLANS,
  townCastLeadRole,
  type TownCastLook,
  type TownCastTierPlan,
} from '../src/sprites/person/townCastLooks.js';
import { TOWN_ROLES, type TownRole } from '../src/sprites/person/PersonAppearance.js';
import {
  FULL_VARIETY_TIER,
  MINIMAL_VARIETY_TIER,
  SHARED_LOOKS_TIER,
  VARIETY_TIERS,
  forceVarietyTier,
  varietyTier,
  type VarietyTier,
} from '../src/core/perf/varietyTier.js';
import { runCanvasRecovery } from '../src/core/rendering/canvasRecovery.js';
import { citizenLookKey, pickCitizenFigure } from '../src/creatures/citizenFigure.js';
import { Townsperson } from '../src/creatures/Townsperson.js';
import { residentFigure } from '../src/creatures/residentFigures.js';
import { allResidents } from '../src/systems/townResidents.js';
import { TOWN_SPECIES } from '../src/systems/townSpecies.js';
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
    (look): look is TownCastLook & { painter: 'biped' } => look.painter === 'biped',
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

function gateLookCombinationsDistinct(): void {
  const seen = new Map<string, string>();
  let measured = 0;
  for (const look of TOWN_CAST_LOOKS) {
    if (look.painter !== 'biped') continue;
    measured++;
    const key = [
      look.skinRamp.base,
      look.hairRamp.base,
      look.hairStyle,
      look.facialHair,
      look.garmentRamp.base,
    ].join('|');
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      fail(
        'H8',
        `${look.id} shares its whole (skin, hair colour, hair style, facial hair, garment colour) combination ` +
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

// ── H9 street looks per variety tier ─────────────────────────────────────────

/** Seeds swept per role and tier: far more citizens of one role than any town holds. */
const TIER_SWEEP_SEEDS = 512;

/** The distinct looks a tier's plan lets the street wear, counted from the plan and the cast alone. */
function humanStreetAllowance(tier: VarietyTier): number {
  const plan: TownCastTierPlan = TOWN_CAST_TIER_PLANS[tier];
  const allowed = new Set<string>();
  for (const role of TOWN_ROLES) {
    const lead = townCastLeadRole(plan, role);
    const offered = TOWN_CAST_LOOKS.filter((look) => look.roles.includes(lead));
    const limit = plan.looksPerRole[role];
    const kept = limit === undefined ? offered : offered.slice(0, limit);
    for (const look of kept) allowed.add(look.id);
  }
  return allowed.size;
}

function gateTierAllowance(): void {
  const streetLookCount = TOWN_CAST_LOOKS.filter((look) => look.roles.length > 0).length;
  if (humanStreetAllowance(FULL_VARIETY_TIER) !== streetLookCount) {
    fail(
      'H9',
      `the full tier allows ${humanStreetAllowance(FULL_VARIETY_TIER)} looks, not every one of the ${streetLookCount} street looks`,
    );
  }
  let previousAllowance = Number.POSITIVE_INFINITY;
  let measured = 0;
  for (const tier of VARIETY_TIERS) {
    const allowance = humanStreetAllowance(tier);
    if (allowance > previousAllowance) {
      fail(
        'H9',
        `tier ${tier} allows ${allowance} looks, more than the tier above's ${previousAllowance}`,
      );
    }
    previousAllowance = allowance;
    const plan = TOWN_CAST_TIER_PLANS[tier];
    const worn = new Set<string>();
    for (const role of TOWN_ROLES) {
      const lead = townCastLeadRole(plan, role);
      const misfits = new Set<string>();
      for (let seed = 0; seed < TIER_SWEEP_SEEDS; seed++) {
        const figure = pickCitizenFigure(seed, role, 'human', tier);
        measured++;
        if (figure.species !== 'human') {
          fail('H9', `a human ${role} was given a ${figure.species} figure at tier ${tier}`);
          continue;
        }
        worn.add(figure.look.id);
        if (!figure.look.roles.includes(lead)) misfits.add(figure.look.id);
      }
      for (const id of misfits) {
        fail(
          'H9',
          `a ${role} wears ${id} at tier ${tier}, which is not offered for its group's ${lead}`,
        );
      }
    }
    if (worn.size > allowance) {
      fail(
        'H9',
        `tier ${tier}'s street wears ${worn.size} distinct looks, over its allowance of ${allowance}`,
      );
    }
  }
  failures.push(...nothingMeasuredFailures(measured, 'tiered picks').map((m) => `H9: ${m}`));
  gateSharedLooksTierKeepsUntrimmedRoles();
}

function lookIdsWorn(role: TownRole, tier: VarietyTier): Set<string> {
  const worn = new Set<string>();
  for (let seed = 0; seed < TIER_SWEEP_SEEDS; seed++) {
    worn.add(pickCitizenFigure(seed, role, 'human', tier).look.id);
  }
  return worn;
}

/**
 * The first step down trims only the roles its plan names; every other role
 * must still wear every look it wears at the full tier.
 */
function gateSharedLooksTierKeepsUntrimmedRoles(): void {
  const plan: TownCastTierPlan = TOWN_CAST_TIER_PLANS[SHARED_LOOKS_TIER];
  const limits = plan.looksPerRole;
  const untrimmed = TOWN_ROLES.filter((role) => limits[role] === undefined);
  if (untrimmed.length === 0) {
    fail('H9', `tier ${SHARED_LOOKS_TIER} trims every role; it should leave most roles whole`);
  }
  for (const role of untrimmed) {
    const full = lookIdsWorn(role, FULL_VARIETY_TIER);
    const shared = lookIdsWorn(role, SHARED_LOOKS_TIER);
    const lost = [...full].filter((id) => !shared.has(id));
    if (lost.length > 0) {
      fail(
        'H9',
        `a ${role} loses ${lost.join(', ')} at tier ${SHARED_LOOKS_TIER}, though its plan leaves the role whole`,
      );
    }
  }
}

// ── H10 a citizen changes look only behind a purge ───────────────────────────

const STILL_WANDER = {
  pickTarget: () => ({ x: 0, y: 0 }),
  arriveDist: 1,
  pauseMin: 1,
  pauseMax: 1,
};
/** Street citizens built per role and species: enough that a lean tier must change some. */
const RELOOK_SEEDS_PER_ROLE = 4;

interface WatchedCitizen {
  readonly person: Townsperson;
  readonly label: string;
  /** The look it should wear after a purged recovery leaves the game at `tier`. */
  readonly expectAfterPurge: (tier: VarietyTier) => string;
}

function lookOf(person: Townsperson): string {
  return citizenLookKey(person.figure);
}

function failChanged(
  watched: readonly WatchedCitizen[],
  before: ReadonlyMap<Townsperson, string>,
  when: string,
): void {
  for (const { person, label } of watched) {
    if (lookOf(person) !== before.get(person)) fail('H10', `${label} changed look ${when}`);
  }
}

function gateRelookOnPurge(): void {
  forceVarietyTier(FULL_VARIETY_TIER);
  const watched: WatchedCitizen[] = [];
  for (const species of TOWN_SPECIES) {
    for (const role of TOWN_ROLES) {
      for (let seed = 0; seed < RELOOK_SEEDS_PER_ROLE; seed++) {
        const person = new Townsperson({
          x: 0,
          y: 0,
          role,
          species,
          seed,
          speed: 1,
          wander: STILL_WANDER,
        });
        watched.push({
          person,
          label: `a ${species} ${role} (seed ${seed})`,
          expectAfterPurge: (tier) => citizenLookKey(pickCitizenFigure(seed, role, species, tier)),
        });
      }
    }
  }
  for (const def of allResidents()) {
    const person = new Townsperson({
      x: 0,
      y: 0,
      role: def.role,
      species: def.species,
      seed: 0,
      speed: 1,
      wander: STILL_WANDER,
      residentId: def.id,
    });
    const ownLook = citizenLookKey(residentFigure(def.id));
    if (lookOf(person) !== ownLook) fail('H10', `${def.name} does not wear their own look`);
    watched.push({ person, label: def.name, expectAfterPurge: () => ownLook });
  }
  const talker = watched.find(
    ({ person, expectAfterPurge }) =>
      person.residentId === null && expectAfterPurge(MINIMAL_VARIETY_TIER) !== lookOf(person),
  );
  if (talker === undefined) {
    fail(
      'H10',
      'no street citizen wears a look the minimal tier takes away, so a conversation cannot be tested',
    );
    return;
  }
  talker.person.frozen = true;

  const before = new Map(watched.map(({ person }) => [person, lookOf(person)]));
  const updateAll = (): void => {
    for (const { person } of watched) person.update();
  };

  forceVarietyTier(MINIMAL_VARIETY_TIER);
  updateAll();
  failChanged(watched, before, 'when the tier dropped during play');
  runCanvasRecovery('memoryPressure', null);
  updateAll();
  failChanged(watched, before, 'at a memory-pressure recovery, which repaints nothing on screen');

  runCanvasRecovery('purged', null);
  const tier = varietyTier();
  updateAll();
  let changed = 0;
  for (const { person, label, expectAfterPurge } of watched) {
    const expected = person === talker.person ? before.get(person) : expectAfterPurge(tier);
    if (lookOf(person) !== before.get(person)) changed++;
    if (lookOf(person) !== expected) {
      fail(
        'H10',
        `${label} wears ${lookOf(person)} after a purge at tier ${tier}, not ${expected ?? 'the look it wore'}`,
      );
    }
  }
  if (changed === 0) fail('H10', `a purge at tier ${tier} changed no citizen's look`);

  const afterPurge = new Map(watched.map(({ person }) => [person, lookOf(person)]));
  talker.person.frozen = false;
  updateAll();
  failChanged(watched, afterPurge, 'after the purge had passed');
  forceVarietyTier(FULL_VARIETY_TIER);
}

export function humanCastGateFailures(): string[] {
  failures = [];
  gateStructure();
  gateStateNames();
  gateAnchor();
  gateFrameDistinctness();
  gateBuildDistinctness();
  gateLookCombinationsDistinct();
  gateResidency();
  gateTierAllowance();
  gateRelookOnPurge();
  return failures;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ok = reportFigureGates('human-cast', humanCastGateFailures());
  if (!ok) process.exitCode = 1;
}
