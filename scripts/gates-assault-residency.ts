/**
 * The undead assault's figures against the real figure cache: whether what is
 * warmed, when it is warmed, is still warm when it is played.
 *
 * The necromancer, the raised ratkin and the Grave Bull are seen nowhere but
 * the Briar Hollow assault, and their cells are dear, so each is warmed in
 * stages and a wave's arrival rows are kept warm through its countdown by
 * `AssaultWavePrewarm`. The row-size gates in each figure's own gate module
 * cannot see any of this: whether a stage's lead covers its work, whether it
 * fits the figure's budget beside the stages before it, and whether a row is
 * swept or evicted before it is drawn are properties of the cache's clock, its
 * budgets and its sweep. So this drives the cache itself, headlessly:
 *
 *   A1  each creature's staged sets, in the order they are warmed: the cells a
 *       stage bakes, at the cost its lead was sized on, fit inside that lead
 *       with the safety margin (counted work, not timed frames, so it is the
 *       same verdict on every machine); the figure stays inside its budget;
 *       and every row warmed so far draws with no misses;
 *   A2  the ticker, `AssaultWavePrewarm`, with Carl, Donut and the four
 *       militia held on screen every frame beside it, at 1, 2, 2.4 and 8
 *       cache frames per update: each wave's countdown; wave 3's fight after
 *       he arrives, his standing set drawn with his drift; and the lull before
 *       waves 2 and 3, with a survivor on screen and the prewarm queue never
 *       empty. Each must end with no misses among the undead rows about to be
 *       played or drawn along the way, none among the crawlers, and the whole
 *       cache inside its global ceiling;
 *   A3  `touchFigureState`: a touched row outlives the idle window that
 *       sweeps an untouched one, and a row that is not held, or was baked
 *       before a bake-scale change, reports so.
 *
 *   npm run gates:assault-residency
 */

import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { gameContext } from './nodeGameContext.js';
import { nothingMeasuredFailures, reportFigureGates } from './figureGates.js';
import { figureFrameCount, type FigureDef } from '../src/sprites/figure/figureDef.js';
import {
  CACHE_BYTE_BUDGET,
  IDLE_FRAMES_BEFORE_RELEASE,
  PREWARM_BAKE_BUDGET_MS,
  beginFigureFrame,
  drawFigureCached,
  figureByteBudgetFor,
  figurePrewarmDepth,
  figureResidentBytes,
  flushFigureFrameCache,
  markFigureStateDrawn,
  prewarmFigureState,
  releaseFigure,
  touchFigureState,
} from '../src/sprites/figure/figureFrameCache.js';
import {
  getFigureCacheStats,
  setFigureCacheStatsRecording,
} from '../src/sprites/figure/figureCacheStats.js';
import {
  NECROMANCER_ACTION_VIEWS,
  NECROMANCER_FIGURE,
  necromancerStateName,
} from '../src/sprites/art/necromancerFigure.js';
import {
  NECROMANCER_ARRIVAL_ROWS,
  NECROMANCER_BLINK_CELL_BAKE_MS_ESTIMATE,
  NECROMANCER_BLINK_PREWARM_LEAD_FRAMES,
  NECROMANCER_BLINK_ROWS,
  NECROMANCER_CASTS,
  NECROMANCER_CAST_PREWARM_LEAD_FRAMES,
  NECROMANCER_CELL_BAKE_MS_ESTIMATE,
  NECROMANCER_DRIFT_PREWARM_LEAD_FRAMES,
  NECROMANCER_STANDING_PREWARM_LEAD_FRAMES,
  NECROMANCER_STANDING_ROWS,
  PREWARM_LEAD_SAFETY,
  prewarmNecromancerBlink,
  prewarmNecromancerCast,
  prewarmNecromancerDeath,
  prewarmNecromancerDrift,
  prewarmNecromancerStanding,
  type NecromancerRowRef,
} from '../src/sprites/necromancerSprite.js';
import {
  GRAVE_BULL_ACTION_VIEWS,
  GRAVE_BULL_FIGURE,
  graveBullStateName,
} from '../src/sprites/art/graveBullFigure.js';
import {
  GRAVE_BULL_ARRIVAL_ROWS,
  GRAVE_BULL_ATTACK_ACTIONS,
  GRAVE_BULL_ATTACK_PREWARM_LEAD_FRAMES,
  GRAVE_BULL_CELL_BAKE_MS_ESTIMATE,
  GRAVE_BULL_DEATH_ACTIONS,
  GRAVE_BULL_GORE_PARTS,
  GRAVE_BULL_LEAD_SAFETY,
  graveBullViewFor,
  prewarmGraveBullAttack,
  prewarmGraveBullDeath,
  type GraveBullRowRef,
} from '../src/sprites/graveBullSprite.js';
import { RAISED_RATKIN_LOOKS } from '../src/sprites/art/raisedRatkinArt.js';
import { raisedRatkinFigure, raisedStateName } from '../src/sprites/art/raisedRatkinFigure.js';
import {
  RAISED_ARRIVAL_ROWS,
  prewarmRaisedRatkinFight,
} from '../src/sprites/raisedRatkinSprite.js';
import { AssaultWavePrewarm, type AssaultWave } from '../src/sprites/assaultPrewarm.js';
import {
  IMMINENT_SECONDS,
  WAVE_LULL_SECONDS,
} from '../src/systems/briarHollow/VillageAssaultSystem.js';
import {
  ALWAYS_DRAWN_ROWS,
  HUMAN_ATTACK_ROWS,
  OPENING_STRIKE_ROWS,
  activeHumanFigure,
  strikeWindUpFrames,
} from '../src/sprites/humanSprite.js';
import { HUMAN_ROW_TABLE } from '../src/sprites/art/humanFigure.js';
import { CAT_FIGURE } from '../src/sprites/art/catFigure.js';
import { castRowsFor, ratkinCastFigure } from '../src/sprites/art/ratkinCastFigure.js';
import { RATKIN_SOLDIER_IDS } from '../src/sprites/art/ratkin/cast.js';

installCanvasGlobals();

/** Matches TILE_SIZE in src/core/constants.ts. */
const TILE_SIZE = 32;
const TARGET_SIZE_PX = 256;
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
const MB_DECIMALS = 1;
const MS_DECIMALS = 1;
/** A stage that has not drained in this many frames is not going to. */
const DRAIN_GIVE_UP_FRAMES = 20000;
/** Gameplay updates a second. */
const UPDATES_PER_SECOND = 60;
/** The countdown a wave is announced with. */
const COUNTDOWN_SECONDS = IMMINENT_SECONDS;
/** How long A2 holds wave 3's fight on screen after he has arrived. */
const FIGHT_SECONDS = 10;
/**
 * Rendered frames per gameplay update: 60 Hz, 120 Hz, 144 Hz, and a paused
 * screen still refreshing while updates trickle. The cache's clock is the
 * rendered one.
 */
const RATE_60_HZ = 1;
const RATE_120_HZ = 2;
const RATE_144_HZ = 2.4;
const RATE_PAUSED = 8;
const ALL_RATES: readonly number[] = [RATE_60_HZ, RATE_120_HZ, RATE_144_HZ, RATE_PAUSED];
/** Carl's fight is gated in one view, the one his busiest strike family is painted in. */
const CARL_FIGHT_VIEW = 'side';
/** Donut's rows the cat sprite keeps warm continuously: standing, walking, swiping and casting. */
const DONUT_ROWS: readonly string[] = [
  'idle',
  'idle_side',
  'idle_away',
  'walk',
  'walk_side',
  'walk_away',
  'swipe',
  'swipe_side',
  'swipe_away',
  'cast',
  'cast_side',
  'cast_away',
];
/** The militia rows a defence is fought in. */
const SOLDIER_FIGHT_ROLES: ReadonlySet<string> = new Set(['walk', 'idle', 'strike', 'hurt']);
/** A display density the cache treats as low-end, and bakes at half density for. */
const LOW_END_DEVICE_PIXEL_RATIO = 1;
/**
 * The deepest the prewarm queue may get while the ticker rewarms a burst of
 * lost rows with nothing else asking: its one row in flight, and the row it
 * just finished, whose request leaves the queue on the drain after its last
 * cell is baked.
 */
const MOST_QUEUED_AFTER_BURST = 2;
/** How far past the idle window A3 runs, so a sweep has certainly come round. */
const TOUCH_GATE_EXTRA_FRAMES = 10;

const ctx = gameContext(TARGET_SIZE_PX, TARGET_SIZE_PX);
const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

function mb(bytes: number): string {
  return (bytes / BYTES_PER_MEGABYTE).toFixed(MB_DECIMALS);
}

/** One row of one figure, and how many of its frames are held warm. */
interface Row {
  readonly def: FigureDef;
  readonly state: string;
  readonly frames: number;
}

function row(def: FigureDef, state: string, frames = figureFrameCount(def, state)): Row {
  return { def, state, frames };
}

function necroRows(refs: readonly NecromancerRowRef[]): Row[] {
  return refs.map((ref) => row(NECROMANCER_FIGURE, necromancerStateName(ref.action, ref.view)));
}

function bullRows(refs: readonly GraveBullRowRef[]): Row[] {
  return refs.map((ref) => row(GRAVE_BULL_FIGURE, graveBullStateName(ref.action, ref.view)));
}

function cellsOf(rows: readonly Row[]): number {
  return rows.reduce((cells, r) => cells + r.frames, 0);
}

/** Draws every held frame of every row on one cache frame and returns the misses. */
function missesDrawing(rows: readonly Row[]): number {
  beginFigureFrame();
  for (const r of rows) {
    for (let frame = 0; frame < r.frames; frame++) {
      drawFigureCached(ctx, r.def, r.state, frame, 0, 0, TILE_SIZE);
    }
  }
  return getFigureCacheStats().misses;
}

/** Draws one frame of each row, cycling through the frames it holds, as a live scene does. */
function drawOneFrameEach(rows: readonly Row[], tick: number): void {
  for (const r of rows) {
    if (r.frames === 0) continue;
    drawFigureCached(ctx, r.def, r.state, tick % r.frames, 0, 0, TILE_SIZE);
  }
}

interface Drained {
  /** Cache frames until the queue was empty. */
  readonly frames: number;
  /** Cells the prewarm queue baked on the way. */
  readonly cells: number;
  /** Median milliseconds a baked cell cost, over the frames that baked any. */
  readonly medianCellMs: number;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Runs cache frames until the prewarm queue is empty, drawing `onScreen` on
 * each — what is being played while the stage warms.
 */
function drain(onScreen: readonly Row[]): Drained {
  let frames = 0;
  let cells = 0;
  const cellMs: number[] = [];
  while (figurePrewarmDepth() > 0 && frames < DRAIN_GIVE_UP_FRAMES) {
    const started = performance.now();
    beginFigureFrame();
    const elapsed = performance.now() - started;
    const baked = getFigureCacheStats().prewarmBakes;
    if (baked > 0) cellMs.push(elapsed / baked);
    cells += baked;
    drawOneFrameEach(onScreen, frames);
    frames++;
  }
  return { frames, cells, medianCellMs: median(cellMs) };
}

/** The work a stage's lead was sized on, and how many cache frames it is. */
interface Lead {
  readonly frames: number;
  readonly msPerCell: number;
  readonly safety: number;
}

interface Stage {
  readonly label: string;
  readonly prewarm: () => void;
  /** What is on screen while it warms. */
  readonly onScreen: readonly Row[];
  /** The rows warm from this stage and those before it, which must all be hits. */
  readonly warm: readonly Row[];
  /** A stage warmed a set time ahead of its use; one warmed at a scene beat has none. */
  readonly lead?: Lead;
}

function checkLead(gateId: string, def: FigureDef, stage: Stage, drained: Drained): void {
  const lead = stage.lead;
  if (lead === undefined) return;
  const workMs = drained.cells * lead.msPerCell * lead.safety;
  const leadMs = lead.frames * PREWARM_BAKE_BUDGET_MS;
  if (workMs > leadMs) {
    fail(
      gateId,
      `${def.id} ${stage.label} bakes ${drained.cells} cells, ${workMs} ms of work at ` +
        `${lead.msPerCell} ms each with a ${lead.safety}x margin, past its ${lead.frames}-frame ` +
        `lead (${leadMs} ms of prewarm budget)`,
    );
  }
  // The estimate is what the lead is sized on; a cell that costs more than the
  // whole margin in node has left no room for a slower browser.
  const ceilingMs = lead.msPerCell * lead.safety;
  if (drained.medianCellMs > ceilingMs) {
    fail(
      gateId,
      `${def.id} ${stage.label} cells cost ${drained.medianCellMs.toFixed(MS_DECIMALS)} ms each, ` +
        `past the ${ceilingMs} ms the lead's estimate and margin allow`,
    );
  }
}

function runStages(
  gateId: string,
  def: FigureDef,
  stages: readonly Stage[],
  setup: () => void = () => undefined,
): void {
  flushFigureFrameCache();
  setup();
  const budget = figureByteBudgetFor(def);
  for (const stage of stages) {
    stage.prewarm();
    const drained = drain(stage.onScreen);
    const resident = figureResidentBytes(def);
    const misses = missesDrawing(stage.warm);
    const leadNote =
      stage.lead === undefined
        ? 'no lead'
        : `lead ${stage.lead.frames} frames at ${stage.lead.msPerCell} ms/cell`;
    console.log(
      `  ${gateId} ${def.id} ${stage.label}: ${drained.cells} cells baked ` +
        `(${drained.medianCellMs.toFixed(MS_DECIMALS)} ms each, ${drained.frames} frames here; ${leadNote}), ` +
        `${mb(resident)} of ${mb(budget)} MB, ${misses} misses`,
    );
    checkLead(gateId, def, stage, drained);
    if (resident > budget) {
      fail(
        gateId,
        `${def.id} ${stage.label} holds ${mb(resident)} MB, over its ${mb(budget)} MB budget`,
      );
    }
    if (misses > 0) {
      fail(gateId, `${def.id} ${stage.label}: ${misses} cells warmed by now draw cold`);
    }
  }
  for (const failure of nothingMeasuredFailures(stages.length, 'stages')) fail(gateId, failure);
}

/**
 * Warms `rows` one at a time, touching each row warmed so far every frame, so
 * a long warm-up does not sweep its own first rows before the last is baked.
 */
function warmDirectly(rows: readonly Row[]): void {
  const warmed: Row[] = [];
  for (const r of rows) {
    prewarmFigureState(r.def, r.state, r.frames);
    warmed.push(r);
    let frames = 0;
    while (figurePrewarmDepth() > 0 && frames < DRAIN_GIVE_UP_FRAMES) {
      for (const held of warmed) touchFigureState(held.def, held.state);
      beginFigureFrame();
      frames++;
    }
  }
}

// ── A1 staged sets ───────────────────────────────────────────────────────────

function necromancerStages(): Stage[] {
  const arrival = necroRows(NECROMANCER_ARRIVAL_ROWS);
  const standing = necroRows(NECROMANCER_STANDING_ROWS);
  const blink = necroRows(NECROMANCER_BLINK_ROWS);
  const driftingSide = row(NECROMANCER_FIGURE, necromancerStateName('drift', 'side'));
  const idleSide = row(NECROMANCER_FIGURE, necromancerStateName('idle', 'side'));
  const castLead = (frames: number): Lead => ({
    frames,
    msPerCell: NECROMANCER_CELL_BAKE_MS_ESTIMATE,
    safety: PREWARM_LEAD_SAFETY,
  });
  const driftFront = row(NECROMANCER_FIGURE, necromancerStateName('drift', 'front'));
  const driftAway = row(NECROMANCER_FIGURE, necromancerStateName('drift', 'away'));
  const driftLead: Lead = {
    frames: NECROMANCER_DRIFT_PREWARM_LEAD_FRAMES,
    msPerCell: NECROMANCER_CELL_BAKE_MS_ESTIMATE,
    safety: PREWARM_LEAD_SAFETY,
  };
  const stages: Stage[] = [
    {
      label: 'drift front before settling',
      prewarm: () => prewarmNecromancerDrift('front'),
      onScreen: [driftingSide],
      warm: [...arrival, driftFront],
      lead: driftLead,
    },
    {
      label: 'standing',
      prewarm: prewarmNecromancerStanding,
      onScreen: [driftingSide],
      warm: [...arrival, ...standing],
      lead: castLead(NECROMANCER_STANDING_PREWARM_LEAD_FRAMES),
    },
    {
      label: 'blink',
      prewarm: prewarmNecromancerBlink,
      onScreen: [idleSide],
      warm: [...arrival, ...standing, ...blink],
      lead: {
        frames: NECROMANCER_BLINK_PREWARM_LEAD_FRAMES,
        msPerCell: NECROMANCER_BLINK_CELL_BAKE_MS_ESTIMATE,
        safety: PREWARM_LEAD_SAFETY,
      },
    },
  ];
  for (const cast of NECROMANCER_CASTS) {
    for (const view of NECROMANCER_ACTION_VIEWS[cast]) {
      stages.push({
        label: `${cast} ${view}`,
        prewarm: () => prewarmNecromancerCast(cast, view),
        onScreen: [idleSide],
        warm: [
          ...arrival,
          ...standing,
          ...blink,
          row(NECROMANCER_FIGURE, necromancerStateName(cast, view)),
        ],
        lead: castLead(NECROMANCER_CAST_PREWARM_LEAD_FRAMES),
      });
    }
  }
  stages.push({
    label: 'drift away',
    prewarm: () => prewarmNecromancerDrift('away'),
    onScreen: [idleSide],
    warm: [...arrival, ...standing, ...blink, driftAway],
    lead: driftLead,
  });
  stages.push({
    label: 'death',
    prewarm: prewarmNecromancerDeath,
    onScreen: [idleSide],
    warm: [...arrival, ...standing, ...blink, row(NECROMANCER_FIGURE, 'death')],
  });
  return stages;
}

const BULL_FACINGS = GRAVE_BULL_ACTION_VIEWS.charge;

function graveBullStages(facing: (typeof BULL_FACINGS)[number]): Stage[] {
  const arrival = bullRows(GRAVE_BULL_ARRIVAL_ROWS);
  const attack = bullRows(
    GRAVE_BULL_ATTACK_ACTIONS.map((action) => ({
      action,
      view: graveBullViewFor(action, facing),
    })),
  );
  const death = [
    ...bullRows(
      GRAVE_BULL_DEATH_ACTIONS.flatMap((action) =>
        GRAVE_BULL_ACTION_VIEWS[action].map((view) => ({ action, view })),
      ),
    ),
    ...GRAVE_BULL_GORE_PARTS.map((state) => row(GRAVE_BULL_FIGURE, state)),
  ];
  const walking = row(GRAVE_BULL_FIGURE, graveBullStateName('walk', facing));
  const charging = row(GRAVE_BULL_FIGURE, graveBullStateName('charge', facing));
  return [
    {
      label: `attack ${facing}`,
      prewarm: () => prewarmGraveBullAttack(facing),
      onScreen: [walking],
      warm: [...arrival, ...attack],
      lead: {
        frames: GRAVE_BULL_ATTACK_PREWARM_LEAD_FRAMES,
        msPerCell: GRAVE_BULL_CELL_BAKE_MS_ESTIMATE,
        safety: GRAVE_BULL_LEAD_SAFETY,
      },
    },
    {
      label: `death after a ${facing} charge`,
      prewarm: prewarmGraveBullDeath,
      onScreen: [charging],
      warm: [...arrival, ...attack, ...death],
    },
  ];
}

// ── A2 a wave's countdown, beside the crawlers ───────────────────────────────

/** The first wave a Grave Bull comes with, and the wave he comes with. */
const FIRST_BULL_WAVE = 2;
const NECROMANCER_WAVE = 3;

/**
 * Every row a wave arrives playing, spelt out here rather than read from
 * `assaultWaveRows`, so the gate cannot agree with a list that has drifted.
 */
function waveRows(wave: AssaultWave): Row[] {
  const rows = RAISED_RATKIN_LOOKS.flatMap((look) =>
    RAISED_ARRIVAL_ROWS.map((ref) =>
      row(raisedRatkinFigure(look), raisedStateName(ref.action, ref.view)),
    ),
  );
  if (wave >= FIRST_BULL_WAVE) rows.push(...bullRows(GRAVE_BULL_ARRIVAL_ROWS));
  if (wave >= NECROMANCER_WAVE) rows.push(...necroRows(NECROMANCER_ARRIVAL_ROWS));
  return rows;
}

/**
 * Carl in a fight: every row he is drawn in continuously, the wind-up of every
 * blow he can open with, and every strike in the view he is fighting in — the
 * core of the working set `gates-human`'s G9b sizes against his budget.
 */
function carlRows(): Row[] {
  const carl = activeHumanFigure();
  const whole = new Set([
    ...ALWAYS_DRAWN_ROWS,
    ...HUMAN_ATTACK_ROWS.filter((name) => HUMAN_ROW_TABLE[name].view === CARL_FIGHT_VIEW),
  ]);
  const windUps = OPENING_STRIKE_ROWS.filter((name) => !whole.has(name));
  return [
    ...[...whole].map((name) => row(carl, name)),
    ...windUps.map((name) => row(carl, name, strikeWindUpFrames(HUMAN_ROW_TABLE[name]))),
  ];
}

function crawlerRows(): Row[] {
  const donut = DONUT_ROWS.map((state) => row(CAT_FIGURE, state));
  const soldiers = RATKIN_SOLDIER_IDS.flatMap((id) =>
    castRowsFor(id)
      .filter((spec) => SOLDIER_FIGHT_ROLES.has(spec.role))
      .map((spec) => row(ratkinCastFigure(id), spec.name)),
  );
  return [...carlRows(), ...donut, ...soldiers];
}

function residentOf(rows: readonly Row[]): number {
  const figures = new Set(rows.map((r) => r.def));
  let bytes = 0;
  for (const def of figures) bytes += figureResidentBytes(def);
  return bytes;
}

const COUNTDOWN_WAVES: readonly AssaultWave[] = [1, FIRST_BULL_WAVE, NECROMANCER_WAVE];
/** The waves that follow a lull rather than a countdown. */
const LULL_WAVES: readonly AssaultWave[] = [FIRST_BULL_WAVE, NECROMANCER_WAVE];

/** Holds every row on screen for one cache frame, as drawing a warm cell of each does. */
function holdOnScreen(rows: readonly Row[]): void {
  for (const r of rows) markFigureStateDrawn(r.def, r.state);
}

/** What one stretch of play holds on screen, and what the ticker is told. */
interface Stretch {
  /** Gameplay updates it lasts. */
  readonly updates: number;
  /** The wave passed to the ticker each update. */
  readonly tickerWave: AssaultWave | null;
  /** Undead drawn for real, one frame of each row per cache frame. */
  readonly drawn: readonly Row[];
  /** Other prewarm requests made every update, ahead of the ticker's. */
  readonly otherRequests?: () => void;
}

/**
 * Plays a stretch at a cache rate — the update, then the render frame that
 * begins the cache's frame and draws, the order the game runs in — and
 * returns the misses among the undead drawn.
 *
 * The crawlers are held with `markFigureStateDrawn`, which does to the cache
 * what a draw of a warm row does, without the blit that would otherwise be
 * most of this gate's time. A row evicted along the way is not rebaked by a
 * mark, so it is still cold when every crawler cell is really drawn after.
 */
function play(
  ticker: AssaultWavePrewarm,
  stretch: Stretch,
  rate: number,
  crawlers: readonly Row[],
): number {
  let owed = 0;
  let tick = 0;
  let misses = 0;
  for (let update = 0; update < stretch.updates; update++) {
    stretch.otherRequests?.();
    ticker.update(stretch.tickerWave);
    owed += rate;
    while (owed >= 1) {
      beginFigureFrame();
      holdOnScreen(crawlers);
      drawOneFrameEach(stretch.drawn, tick);
      misses += getFigureCacheStats().misses;
      tick++;
      owed--;
    }
  }
  return misses;
}

const COUNTDOWN_UPDATES = UPDATES_PER_SECOND * COUNTDOWN_SECONDS;
const LULL_UPDATES = UPDATES_PER_SECOND * WAVE_LULL_SECONDS;
const FIGHT_UPDATES = UPDATES_PER_SECOND * FIGHT_SECONDS;

const UNDEAD_FIGURES: readonly FigureDef[] = [
  NECROMANCER_FIGURE,
  GRAVE_BULL_FIGURE,
  ...RAISED_RATKIN_LOOKS.map(raisedRatkinFigure),
];

/**
 * Starts a case from the undead figures released, as they are before a wave,
 * and every crawler cell warm, so one case's losses are not the next one's.
 */
function startCase(crawlers: readonly Row[]): void {
  for (const def of UNDEAD_FIGURES) releaseFigure(def);
  warmDirectly(crawlers);
}

/** Checks what a stretch has left: the rows about to be played, and the crawlers. */
function checkArrival(
  label: string,
  arriving: readonly Row[],
  crawlers: readonly Row[],
  missesOnScreen: number,
): void {
  const waveMisses = missesDrawing(arriving);
  const crawlerMisses = missesDrawing(crawlers);
  const resident = getFigureCacheStats().bytes;
  console.log(
    `  A2 ${label}: ${waveMisses} misses on arrival, ${missesOnScreen} on screen along the way, ` +
      `${crawlerMisses} crawler misses; ${mb(resident)} MB resident`,
  );
  if (waveMisses > 0) fail('A2 countdown', `${label} arrives with ${waveMisses} cold cells`);
  if (missesOnScreen > 0) {
    fail('A2 countdown', `${label}: ${missesOnScreen} cells drawn on the way were cold`);
  }
  if (crawlerMisses > 0) {
    fail('A2 countdown', `${label} cost the crawlers ${crawlerMisses} cold cells`);
  }
  if (resident > CACHE_BYTE_BUDGET) {
    fail('A2 countdown', `${label} holds ${mb(resident)} MB, past the cache's ceiling`);
  }
}

/**
 * Wave 3 after he has arrived: his standing set warmed while he drifts in,
 * then drawn with his drift beside the crawlers through a stretch of the
 * fight, the ticker told `tickerWave` from the moment he is out — `null`, as
 * its contract says, or still wave 3, a caller that never stops it, whose
 * touches and re-requests must not cost a row on screen either.
 */
function fightAfterArrival(
  ticker: AssaultWavePrewarm,
  tickerWave: AssaultWave | null,
  rate: number,
  crawlers: readonly Row[],
): void {
  const drifting = [row(NECROMANCER_FIGURE, necromancerStateName('drift', 'side'))];
  const fighting = [...drifting, ...necroRows(NECROMANCER_STANDING_ROWS)];
  prewarmNecromancerStanding();
  let missesOnScreen = 0;
  let frames = 0;
  while (figurePrewarmDepth() > 0 && frames < DRAIN_GIVE_UP_FRAMES) {
    missesOnScreen += play(ticker, { updates: 1, tickerWave, drawn: drifting }, rate, crawlers);
    frames++;
  }
  missesOnScreen += play(
    ticker,
    { updates: FIGHT_UPDATES, tickerWave, drawn: fighting },
    rate,
    crawlers,
  );
  const told = tickerWave === null ? 'stopped' : `still told wave ${tickerWave}`;
  checkArrival(`wave 3 fight at ${rate}, ticker ${told}`, fighting, crawlers, missesOnScreen);
}

/**
 * Waves 2 and 3 get no countdown of their own: the ticker is told the next
 * wave from the moment the one before triggers the advance, through the lull.
 * The fifth of the wave before still standing is on screen, shambling in, and
 * the fight asks for its own rows every update, so the prewarm queue is never
 * empty when the ticker looks at it.
 */
function lullBefore(wave: AssaultWave, rate: number, crawlers: readonly Row[]): void {
  const before: AssaultWave = wave === NECROMANCER_WAVE ? FIRST_BULL_WAVE : 1;
  startCase(crawlers);
  const leadIn = new AssaultWavePrewarm();
  play(leadIn, { updates: COUNTDOWN_UPDATES, tickerWave: before, drawn: [] }, rate, crawlers);
  const [survivorLook] = RAISED_RATKIN_LOOKS;
  const survivors = [row(raisedRatkinFigure(survivorLook), raisedStateName('shamble', 'side'))];
  if (before >= FIRST_BULL_WAVE) {
    survivors.push(row(GRAVE_BULL_FIGURE, graveBullStateName('walk', 'side')));
  }
  const ticker = new AssaultWavePrewarm();
  const missesOnScreen = play(
    ticker,
    {
      updates: LULL_UPDATES,
      tickerWave: wave,
      drawn: survivors,
      otherRequests: () => prewarmRaisedRatkinFight(survivorLook),
    },
    rate,
    crawlers,
  );
  checkArrival(`wave ${wave} after a lull at ${rate}`, waveRows(wave), crawlers, missesOnScreen);
}

function countdownGate(): void {
  const crawlers = crawlerRows();
  const carl = activeHumanFigure();
  const carlLoad = crawlers.filter((r) => r.def === carl);
  for (const failure of nothingMeasuredFailures(carlLoad.length, 'Carl rows')) {
    fail('A2 countdown', failure);
  }
  for (const failure of nothingMeasuredFailures(cellsOf(crawlers), 'crawler cells')) {
    fail('A2 countdown', failure);
  }
  // The crawlers are warmed once and stay drawn from run to run; each run
  // starts from the undead figures released, as they are before a wave.
  flushFigureFrameCache();
  warmDirectly(crawlers);
  const coldCrawlerCells = missesDrawing(crawlers);
  const crawlerBytes = residentOf(crawlers);
  const carlBytes = figureResidentBytes(carl);
  console.log(
    `  A2 crawlers: ${crawlers.length} rows, ${mb(crawlerBytes)} MB (Carl ${mb(carlBytes)}), ` +
      `${coldCrawlerCells} cold before the countdown`,
  );
  if (coldCrawlerCells > 0) {
    fail('A2 countdown', `${coldCrawlerCells} crawler cells are cold before any wave is warmed`);
  }
  if (carlBytes > figureByteBudgetFor(carl)) {
    fail('A2 countdown', `Carl's load alone is past his own budget, so it proves nothing`);
  }
  let measured = 0;
  for (const wave of COUNTDOWN_WAVES) {
    for (const rate of ALL_RATES) {
      startCase(crawlers);
      const ticker = new AssaultWavePrewarm();
      play(ticker, { updates: COUNTDOWN_UPDATES, tickerWave: wave, drawn: [] }, rate, crawlers);
      checkArrival(`wave ${wave} at ${rate} cache frames/update`, waveRows(wave), crawlers, 0);
      if (wave === NECROMANCER_WAVE) {
        const tickerWave = rate === RATE_60_HZ ? NECROMANCER_WAVE : null;
        fightAfterArrival(ticker, tickerWave, rate, crawlers);
      }
      measured++;
    }
  }
  for (const wave of LULL_WAVES) {
    for (const rate of ALL_RATES) {
      lullBefore(wave, rate, crawlers);
      measured++;
    }
  }
  for (const failure of nothingMeasuredFailures(measured, 'countdowns')) {
    fail('A2 countdown', failure);
  }
}

// ── A3 the touch ─────────────────────────────────────────────────────────────

function touchGate(): void {
  flushFigureFrameCache();
  const touched = row(NECROMANCER_FIGURE, necromancerStateName('drift', 'side'));
  const control = row(NECROMANCER_FIGURE, necromancerStateName('drift', 'away'));
  warmDirectly([touched, control]);
  if (!touchFigureState(touched.def, touched.state)) {
    fail('A3 touch', 'a fully warmed row reports itself not warm');
  }
  const outlast = IDLE_FRAMES_BEFORE_RELEASE + TOUCH_GATE_EXTRA_FRAMES;
  let stillWarm = true;
  let bakesWhileTouching = 0;
  for (let frame = 0; frame < outlast; frame++) {
    stillWarm = touchFigureState(touched.def, touched.state);
    beginFigureFrame();
    const stats = getFigureCacheStats();
    bakesWhileTouching += stats.bakes + stats.prewarmBakes;
  }
  const touchedMisses = missesDrawing([touched]);
  const controlGone = !touchFigureState(control.def, control.state);
  console.log(
    `  A3 touch: touched row ${stillWarm ? 'warm' : 'lost'} after ${outlast} frames ` +
      `(${touchedMisses} misses), control ${controlGone ? 'swept' : 'kept'}`,
  );
  if (!stillWarm || touchedMisses > 0) {
    fail('A3 touch', `a row touched every frame was released within ${outlast} frames`);
  }
  if (bakesWhileTouching > 0) fail('A3 touch', 'touching a row baked something');
  // Without this the first check passes on a cache that never sweeps anything.
  if (!controlGone) {
    fail('A3 touch', `an untouched row outlived ${outlast} frames, so the idle sweep never ran`);
  }
  if (touchFigureState(NECROMANCER_FIGURE, necromancerStateName('death', 'front'))) {
    fail('A3 touch', 'a row never warmed reports itself warm');
  }
  // A display that drops to low-end bakes at half density, and every row baked
  // before is dropped at its next draw: a touch must not call those warm.
  const fullDensity = window.devicePixelRatio;
  Object.defineProperty(window, 'devicePixelRatio', { value: LOW_END_DEVICE_PIXEL_RATIO });
  const warmAfterScaleChange = touchFigureState(touched.def, touched.state);
  Object.defineProperty(window, 'devicePixelRatio', { value: fullDensity });
  console.log(`  A3 touch after a bake-scale change: ${warmAfterScaleChange ? 'warm' : 'cold'}`);
  if (warmAfterScaleChange) {
    fail('A3 touch', 'a row baked at the old density reports itself warm after the change');
  }
}

/**
 * The ticker keeps at most one row of its own in the prewarm queue, however
 * many of its rows are lost at once: the creatures' own staged rows queue
 * behind it, and a burst of re-requests would hold them back by the whole
 * burst.
 */
function oneRowInFlightGate(): void {
  flushFigureFrameCache();
  const ticker = new AssaultWavePrewarm();
  let frames = 0;
  while (frames < COUNTDOWN_UPDATES) {
    ticker.update(NECROMANCER_WAVE);
    beginFigureFrame();
    frames++;
  }
  for (const look of RAISED_RATKIN_LOOKS) releaseFigure(raisedRatkinFigure(look));
  releaseFigure(GRAVE_BULL_FIGURE);
  let deepest = 0;
  let updates = 0;
  let lost = true;
  while (lost && updates < DRAIN_GIVE_UP_FRAMES) {
    ticker.update(NECROMANCER_WAVE);
    deepest = Math.max(deepest, figurePrewarmDepth());
    beginFigureFrame();
    lost = waveRows(NECROMANCER_WAVE).some((r) => !touchFigureState(r.def, r.state));
    updates++;
  }
  console.log(
    `  A3 one row in flight: deepest queue ${deepest} while ${updates} updates rewarmed a burst of evictions`,
  );
  if (deepest > MOST_QUEUED_AFTER_BURST) {
    fail('A3 touch', `the ticker queued ${deepest} rows at once after a burst of evictions`);
  }
  if (lost) fail('A3 touch', 'the ticker never rewarmed the rows it lost');
  for (const failure of nothingMeasuredFailures(updates, 'updates after the evictions')) {
    fail('A3 touch', failure);
  }
}

function main(): void {
  setFigureCacheStatsRecording(true);
  console.log('Gating the assault figures against the figure cache…');
  const necroArrival = necroRows(NECROMANCER_ARRIVAL_ROWS);
  runStages('A1 stages', NECROMANCER_FIGURE, necromancerStages(), () => warmDirectly(necroArrival));
  const bullArrival = bullRows(GRAVE_BULL_ARRIVAL_ROWS);
  for (const facing of BULL_FACINGS) {
    runStages('A1 stages', GRAVE_BULL_FIGURE, graveBullStages(facing), () =>
      warmDirectly(bullArrival),
    );
  }
  countdownGate();
  touchGate();
  oneRowInFlightGate();
  setFigureCacheStatsRecording(false);
  reportFigureGates('assault residency', failures);
}

main();
