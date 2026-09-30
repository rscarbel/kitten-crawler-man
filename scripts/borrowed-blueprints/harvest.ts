/**
 * The grain harvest's checks for `verify:borrowed-blueprints`: how a swing's
 * timed second press is graded (by its event timestamp, one press only),
 * the verdict each swing reaches on the timing bar with its sound (a swing
 * that runs out unpressed is a miss) and how long it lingers, how a stand is
 * cut to stubble and grows back, and when the scythe can be taken off the
 * barn wall.
 *
 * The harvest is stood up on a real generated village with real crawlers and
 * a hand-driven clock, so every tick and every press timestamp is exact.
 */

import { createBriarHollowState, type BriarHollowState } from '../../src/core/briarHollowState';
import type { BlueprintsQuestPhase } from '../../src/core/blueprintsQuestPhase';
import { MOB_GRID_CELL_SIZE, TILE_SIZE } from '../../src/core/constants';
import { SpatialGrid } from '../../src/core/SpatialGrid';
import { ITEM_DEF, QUEST_SLOT_IDX } from '../../src/core/ItemDefs';
import { CatPlayer } from '../../src/creatures/CatPlayer';
import { HumanPlayer } from '../../src/creatures/HumanPlayer';
import type { Mob } from '../../src/creatures/Mob';
import { GameMap } from '../../src/map/GameMap';
import type { BriarHollowSite } from '../../src/map/overworld/briarHollowSite';
import { UPDATES_PER_SECOND } from '../../src/systems/briarHollow/structureRules';
import {
  GRAIN_CUTS_TO_STUBBLE,
  GRAIN_PER_GOOD,
  GRAIN_PER_PERFECT,
  GRAIN_PER_MISS,
  GRAIN_REGROW_SECONDS,
  GrainHarvest,
  SCYTHE_SWING_SECONDS,
  SWING_VERDICT_LINGER_SECONDS,
  gradeScythePress,
  type ScytheGrade,
} from '../../src/systems/briarHollow/blueprints/GrainHarvest';
import type { BlueprintsCue } from '../../src/systems/briarHollow/blueprints/blueprintsSoundCues';
import type { Check } from './fenna';

const HARVEST_MAP_SIZE = 280;
const HARVEST_MAP_SEED = 1;
const TICK_MS = 1000 / UPDATES_PER_SECOND;
const SWING_TICKS = Math.round(SCYTHE_SWING_SECONDS * UPDATES_PER_SECOND);
/** A clock that starts well away from zero, as `performance.now()` does in a live tab. */
const CLOCK_START_MS = 50_000;
/** A press at the inner band's late edge, which a short stall pushes into the outer band if mis-graded. */
const STALLED_PRESS_SHARE = 0.72;
/** Ticks the stall lets run between the press and its handler: inside the press tolerance. */
const STALL_TICKS = 3;
/** A tap's touchstart-to-touchend lag: a tap is handled on lift but stamped where it landed. */
const TAP_HANDLED_LATE_MS = 200;
/** A press in the middle of the inner band. */
const PERFECT_PRESS_SHARE = 0.7;
/** How long the world stays halted mid-swing, as a menu or dialog would hold it. */
const HALT_MS = 500;
/** Where the swing stands when the world halts. */
const HALT_AT_SHARE = 0.3;
/** A press well before the outer band. */
const EARLY_PRESS_SHARE = 0.3;
/** A press in the outer band, clear of the inner one. */
const GOOD_PRESS_SHARE = 0.6;
const LINGER_TICKS = Math.round(SWING_VERDICT_LINGER_SECONDS * UPDATES_PER_SECOND);

interface HarvestRig {
  readonly state: BriarHollowState;
  readonly site: BriarHollowSite;
  readonly gameMap: GameMap;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly harvest: GrainHarvest;
  readonly cues: BlueprintsCue[];
  /** The hand-driven clock the harvest reads its press timestamps against. */
  readonly clock: { nowMs: number };
  /** Whether the world is halted, as a menu or dialog halts it. */
  readonly halt: { halted: boolean };
}

let sharedMap: GameMap | null = null;

function harvestMap(): GameMap {
  sharedMap ??= new GameMap({
    mapSize: HARVEST_MAP_SIZE,
    mapType: 'overworld',
    worldSeed: HARVEST_MAP_SEED,
    tileHeight: TILE_SIZE,
  });
  return sharedMap;
}

function harvestRig(phase: BlueprintsQuestPhase): HarvestRig | null {
  const gameMap = harvestMap();
  const site = gameMap.briarHollow;
  if (site === null) return null;
  const state = createBriarHollowState();
  state.blueprints.phase = phase;
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(0, 0, TILE_SIZE);
  const cues: BlueprintsCue[] = [];
  const clock = { nowMs: CLOCK_START_MS };
  const halt = { halted: false };
  const rig: HarvestRig = {
    state,
    site,
    gameMap,
    human,
    cat,
    cues,
    clock,
    halt,
    harvest: new GrainHarvest({
      state,
      gameMap,
      site,
      human,
      cat,
      active: () => human,
      worldHalted: () => halt.halted,
      cue: (cue) => cues.push(cue),
      roster: { grid: new SpatialGrid<Mob>(MOB_GRID_CELL_SIZE) },
      nowMs: () => clock.nowMs,
    }),
  };
  return rig;
}

/** A rig in `harvest_grain` with Carl holding the scythe, standing on the field's first tile. */
function swingingRig(): HarvestRig | null {
  const rig = harvestRig('harvest_grain');
  if (rig === null) return null;
  rig.human.inventory.replaceQuestSlot({ ...ITEM_DEF.quest_scythe, quantity: 1 });
  standOn(rig, rig.site.grainField.x, rig.site.grainField.y);
  return rig;
}

function standOn(rig: HarvestRig, tileX: number, tileY: number): void {
  rig.human.x = tileX * TILE_SIZE;
  rig.human.y = tileY * TILE_SIZE;
  rig.human.facingX = 1;
  rig.human.facingY = 0;
}

function tick(rig: HarvestRig, ticks = 1): void {
  for (let i = 0; i < ticks; i++) {
    rig.clock.nowMs += TICK_MS;
    rig.harvest.update();
  }
}

/** The timestamp of a press made at `share` of a swing started at `startMs`. */
function pressAt(startMs: number, share: number): number {
  return startMs + share * SCYTHE_SWING_SECONDS * 1000;
}

/**
 * One swing with presses at the given shares of it, each dispatched on the
 * tick where it was made; returns the grain it landed.
 */
function swingWith(rig: HarvestRig, pressShares: readonly number[]): number {
  const before = rig.state.blueprints.grain;
  const startMs = rig.clock.nowMs;
  if (!rig.harvest.tryInteract(rig.human)) return -1;
  const pending = [...pressShares].sort((a, b) => a - b);
  for (let i = 0; i < SWING_TICKS; i++) {
    const nextPress = pending[0];
    if (nextPress !== undefined && pressAt(startMs, nextPress) <= rig.clock.nowMs + TICK_MS) {
      pending.shift();
      rig.harvest.handleKeyDown(' ', false, pressAt(startMs, nextPress));
    }
    tick(rig);
  }
  return rig.state.blueprints.grain - before;
}

export function verifyHarvestGrading(check: Check): void {
  check(gradeScythePress(0.7) === 'perfect', 'the middle of the inner band grades perfect');
  check(gradeScythePress(0.6) === 'good', 'the outer band grades good');
  check(gradeScythePress(0.5) === 'miss', 'before the outer band grades a miss');
  check(gradeScythePress(0.9) === 'miss', 'after the outer band grades a miss');

  const cases: ReadonlyArray<{ presses: readonly number[]; grain: number; label: string }> = [
    {
      presses: [],
      grain: GRAIN_PER_MISS,
      label: `no second press is a miss and lands ${GRAIN_PER_MISS}`,
    },
    { presses: [0.7], grain: GRAIN_PER_PERFECT, label: 'a press in the inner band lands 8' },
    { presses: [0.6], grain: GRAIN_PER_GOOD, label: 'a press in the outer band lands 4' },
    { presses: [0.95], grain: GRAIN_PER_MISS, label: `a late press lands ${GRAIN_PER_MISS}` },
    {
      presses: [0.3, 0.7],
      grain: GRAIN_PER_MISS,
      label: `an early press forfeits: a perfect press after it still lands only ${GRAIN_PER_MISS}`,
    },
    {
      presses: [0.7, 0.8],
      grain: GRAIN_PER_PERFECT,
      label: 'an extra press after a perfect one is ignored',
    },
  ];
  for (const { presses, grain, label } of cases) {
    const rig = swingingRig();
    if (rig === null) {
      check(false, `${label} (no Briar Hollow on the test map)`);
      continue;
    }
    const landed = swingWith(rig, presses);
    check(landed === grain, `${label} (landed ${landed})`);
  }

  // A press made late in the inner band but handled after a stall let the
  // swing run on into the outer band is graded where it was made.
  const stalled = swingingRig();
  if (stalled !== null) {
    const startMs = stalled.clock.nowMs;
    stalled.harvest.tryInteract(stalled.human);
    tick(stalled, Math.round(STALLED_PRESS_SHARE * SWING_TICKS) + STALL_TICKS);
    stalled.harvest.handleKeyDown(' ', false, pressAt(startMs, STALLED_PRESS_SHARE));
    tick(stalled, SWING_TICKS);
    const gained = stalled.state.blueprints.grain;
    check(
      gained === GRAIN_PER_PERFECT,
      `a stalled press is graded by its own timestamp, not when it was handled (landed ${gained})`,
    );
  }

  // A tap is stamped at touchstart but handled at touchend; the lag is
  // longer than a frame stall ever is and must not move the press either.
  const tapped = swingingRig();
  if (tapped !== null) {
    const startMs = tapped.clock.nowMs;
    tapped.harvest.tryInteract(tapped.human);
    const tapStampMs = pressAt(startMs, PERFECT_PRESS_SHARE);
    while (tapped.clock.nowMs < tapStampMs + TAP_HANDLED_LATE_MS) tick(tapped);
    const took = tapped.harvest.handleTap(0, 0, tapped.human, tapStampMs);
    tick(tapped, SWING_TICKS);
    const gained = tapped.state.blueprints.grain;
    check(
      took && gained === GRAIN_PER_PERFECT,
      `a tap handled ${TAP_HANDLED_LATE_MS} ms after it landed is graded where it landed (landed ${gained})`,
    );
  }

  // Time the world spends halted is no swing time: the bar stood still.
  const halted = swingingRig();
  if (halted !== null) {
    halted.harvest.tryInteract(halted.human);
    tick(halted, Math.round(HALT_AT_SHARE * SWING_TICKS));
    halted.halt.halted = true;
    const haltTicks = Math.round(HALT_MS / TICK_MS);
    tick(halted, haltTicks);
    halted.halt.halted = false;
    tick(halted, Math.round((PERFECT_PRESS_SHARE - HALT_AT_SHARE) * SWING_TICKS));
    halted.harvest.handleKeyDown(' ', false, halted.clock.nowMs);
    tick(halted, SWING_TICKS);
    const gained = halted.state.blueprints.grain;
    check(
      gained === GRAIN_PER_PERFECT,
      `a press after a halt is graded on the swing time the player watched (landed ${gained})`,
    );
  }

  const repeat = swingingRig();
  if (repeat !== null) {
    const startMs = repeat.clock.nowMs;
    repeat.harvest.tryInteract(repeat.human);
    tick(repeat, Math.round(0.7 * SWING_TICKS));
    const took = repeat.harvest.handleKeyDown(' ', true, pressAt(startMs, 0.7));
    tick(repeat, SWING_TICKS);
    check(
      took && repeat.state.blueprints.grain === GRAIN_PER_MISS,
      `a held key repeating is swallowed without grading: the swing lands a miss's ${GRAIN_PER_MISS} (landed ${repeat.state.blueprints.grain})`,
    );
  }

  const moved = swingingRig();
  if (moved !== null) {
    moved.harvest.tryInteract(moved.human);
    tick(moved, 10);
    moved.human.x += TILE_SIZE / 2;
    tick(moved, SWING_TICKS);
    check(
      moved.state.blueprints.grain === 0 && !moved.harvest.isSwinging,
      'walking off mid-swing cancels it with no grain',
    );
  }
}

export function verifyHarvestRegrowth(check: Check): void {
  const rig = swingingRig();
  if (rig === null) {
    check(false, 'the test map has a grain field');
    return;
  }
  const { x, y } = rig.site.grainField;
  const stages: string[] = [];
  for (let cut = 0; cut < GRAIN_CUTS_TO_STUBBLE; cut++) {
    swingWith(rig, [PERFECT_PRESS_SHARE]);
    stages.push(rig.harvest.stageAt(x + 1, y));
  }
  const cutTile = { x: x + 1, y };
  check(
    rig.harvest.cutsAt(cutTile.x, cutTile.y) === GRAIN_CUTS_TO_STUBBLE,
    `three swings cut the faced stand three times (${stages.join(' → ')})`,
  );
  check(
    stages.join(',') === 'thinned,sparse,stubble',
    'the stand goes thinned, sparse, then stubble',
  );
  const next = rig.harvest.standInReach(rig.human);
  check(
    next !== null && !(next.x === cutTile.x && next.y === cutTile.y),
    'a stubble stand is never picked for the next swing',
  );

  const regrowTicks = GRAIN_REGROW_SECONDS * UPDATES_PER_SECOND;
  const thirdTicks = regrowTicks / 3;
  tick(rig, 2 * thirdTicks - 1);
  check(rig.harvest.stageAt(cutTile.x, cutTile.y) === 'stubble', 'still stubble at 20 s');
  tick(rig, 1);
  check(rig.harvest.stageAt(cutTile.x, cutTile.y) === 'sparse', 'sparse from 20 s');
  tick(rig, thirdTicks / 2);
  check(rig.harvest.stageAt(cutTile.x, cutTile.y) === 'thinned', 'thinned from 25 s');
  tick(rig, thirdTicks / 2 - 1);
  check(
    rig.harvest.cutsAt(cutTile.x, cutTile.y) === GRAIN_CUTS_TO_STUBBLE,
    'not grown back before 30 s',
  );
  tick(rig, 1);
  check(
    rig.harvest.cutsAt(cutTile.x, cutTile.y) === 0 &&
      rig.harvest.stageAt(cutTile.x, cutTile.y) === 'full',
    'grown back in full at 30 s',
  );
}

export function verifyScytheTaking(check: Check): void {
  const phases: readonly BlueprintsQuestPhase[] = ['report_fence', 'deliver_grain', 'complete'];
  for (const phase of phases) {
    const rig = harvestRig(phase);
    const pegs = rig?.harvest.scytheTile() ?? null;
    if (rig === null || pegs === null) {
      check(false, 'the barn has scythe pegs');
      return;
    }
    standOn(rig, pegs.x, pegs.y + 1);
    const took = rig.harvest.tryInteract(rig.human);
    check(
      !took && rig.human.inventory.countOf('quest_scythe') === 0,
      `the scythe is decoration in ${phase}`,
    );
  }

  const rig = harvestRig('harvest_grain');
  const pegs = rig?.harvest.scytheTile() ?? null;
  if (rig === null || pegs === null) {
    check(false, 'the barn has scythe pegs');
    return;
  }
  standOn(rig, pegs.x + 3, pegs.y + 3);
  check(!rig.harvest.tryInteract(rig.human), 'the scythe cannot be taken from across the barn');
  standOn(rig, pegs.x, pegs.y + 1);
  const took = rig.harvest.tryInteract(rig.human);
  check(
    took && rig.human.inventory.actionBar.slots[QUEST_SLOT_IDX]?.id === 'quest_scythe',
    "in harvest_grain a press at the pegs puts the scythe in the active crawler's quest slot",
  );
  check(rig.cues.includes('scytheUnhook'), 'taking it plays the unhook cue');
  rig.harvest.update();
  check(
    rig.gameMap.structure[pegs.y]?.[pegs.x]?.scytheTaken === true,
    'the pegs show empty while the scythe is carried',
  );
  check(!rig.harvest.canTakeScythe(rig.human), 'a held scythe cannot be taken again');
  rig.human.inventory.removeItems('quest_scythe', 1);
  rig.harvest.update();
  check(
    rig.gameMap.structure[pegs.y]?.[pegs.x]?.scytheTaken !== true,
    'the scythe is back on its pegs once nobody carries it',
  );
}

/** The cue each verdict raises. */
const VERDICT_CUES: Record<ScytheGrade, BlueprintsCue> = {
  perfect: 'scytheTimingPerfect',
  good: 'scytheTimingGood',
  miss: 'scytheMiss',
};
const VERDICT_CUE_SET: ReadonlySet<BlueprintsCue> = new Set(Object.values(VERDICT_CUES));

function verdictCues(rig: HarvestRig): BlueprintsCue[] {
  return rig.cues.filter((cue) => VERDICT_CUE_SET.has(cue));
}

export function verifySwingVerdicts(check: Check): void {
  const pressed: ReadonlyArray<{ share: number; verdict: ScytheGrade }> = [
    { share: PERFECT_PRESS_SHARE, verdict: 'perfect' },
    { share: GOOD_PRESS_SHARE, verdict: 'good' },
    { share: EARLY_PRESS_SHARE, verdict: 'miss' },
  ];
  for (const { share, verdict } of pressed) {
    const rig = swingingRig();
    if (rig === null) {
      check(false, 'the test map has a grain field');
      return;
    }
    const startMs = rig.clock.nowMs;
    rig.harvest.tryInteract(rig.human);
    check(rig.harvest.swingBarView()?.verdict === null, `before any press the bar has no verdict`);
    tick(rig, Math.round(share * SWING_TICKS));
    rig.harvest.handleKeyDown(' ', false, pressAt(startMs, share));
    const view = rig.harvest.swingBarView();
    check(
      view?.verdict === verdict && verdictCues(rig).join() === VERDICT_CUES[verdict],
      `a press at ${share} of the swing is judged ${verdict} at once, with ${VERDICT_CUES[verdict]} (${view?.verdict ?? 'no bar'}; ${verdictCues(rig).join() || 'no cue'})`,
    );
    const later = share === PERFECT_PRESS_SHARE ? GOOD_PRESS_SHARE : PERFECT_PRESS_SHARE;
    tick(rig, 1);
    rig.harvest.handleKeyDown(' ', false, pressAt(startMs, later));
    check(
      rig.harvest.swingBarView()?.verdict === verdict && verdictCues(rig).length === 1,
      `a second press in the same ${verdict} swing is not judged again and makes no sound`,
    );
    tick(rig, SWING_TICKS);
    check(
      verdictCues(rig).length === 1,
      `a ${verdict} swing that lands raises no second verdict sound`,
    );
  }

  const unpressed = swingingRig();
  if (unpressed === null) return;
  const faced = unpressed.harvest.standInReach(unpressed.human);
  unpressed.harvest.tryInteract(unpressed.human);
  tick(unpressed, SWING_TICKS - 1);
  check(
    unpressed.harvest.swingBarView()?.verdict === null && verdictCues(unpressed).length === 0,
    'an unpressed swing has no verdict while it runs',
  );
  tick(unpressed, 1);
  const ranOut = unpressed.harvest.swingBarView();
  check(
    !unpressed.harvest.isSwinging &&
      ranOut?.verdict === 'miss' &&
      ranOut.pressShare === null &&
      verdictCues(unpressed).join() === 'scytheMiss',
    `a swing that runs out unpressed is judged a miss, with scytheMiss (${ranOut?.verdict ?? 'no bar'})`,
  );
  const grainTexts = unpressed.human.pendingFloatingText.filter((request) =>
    request.text.includes('Grain'),
  );
  const missFloat = `+${GRAIN_PER_MISS} Grain`;
  check(
    unpressed.state.blueprints.grain === GRAIN_PER_MISS &&
      grainTexts.map((request) => request.text).join() === missFloat &&
      unpressed.cues.includes('grainGather'),
    `a missed swing lands ${GRAIN_PER_MISS} grain, floats "${missFloat}" and plays the gather sound (${grainTexts.map((request) => request.text).join() || 'no float'})`,
  );
  check(
    faced !== null && unpressed.harvest.cutsAt(faced.x, faced.y) === 1,
    'a missed swing still cuts the stand',
  );
  check(
    unpressed.harvest.swingBarView()?.verdictGrain === GRAIN_PER_MISS,
    `the bar credits a miss with its ${GRAIN_PER_MISS} grain beside "Miss!"`,
  );
  tick(unpressed, LINGER_TICKS - 1);
  check(
    unpressed.harvest.swingBarView()?.verdict === 'miss',
    `the verdict lingers on the bar for ${SWING_VERDICT_LINGER_SECONDS} s after the swing`,
  );
  tick(unpressed, 1);
  check(unpressed.harvest.swingBarView() === null, 'then the bar comes down');

  // The linger never holds up the next swing: a new swing replaces the old verdict.
  const next = swingingRig();
  if (next === null) return;
  const firstStart = next.clock.nowMs;
  next.harvest.tryInteract(next.human);
  tick(next, Math.round(EARLY_PRESS_SHARE * SWING_TICKS));
  next.harvest.handleKeyDown(' ', false, pressAt(firstStart, EARLY_PRESS_SHARE));
  tick(next, SWING_TICKS);
  const restarted = next.harvest.tryInteract(next.human);
  const fresh = next.harvest.swingBarView();
  check(
    restarted && next.harvest.isSwinging && fresh?.verdict === null && fresh.pressShare === null,
    'a new swing starts during the linger and clears the old verdict off the bar',
  );

  const walkedOff = swingingRig();
  if (walkedOff === null) return;
  walkedOff.harvest.tryInteract(walkedOff.human);
  tick(walkedOff, 1);
  walkedOff.human.x += TILE_SIZE / 2;
  tick(walkedOff, 1);
  check(
    walkedOff.harvest.swingBarView() === null && verdictCues(walkedOff).length === 0,
    'a swing cancelled by walking off takes its bar down with no verdict',
  );

  verifyJudgedSwingBrokenOff(check);
}

/**
 * A hit already judged has been announced, with its sound, so breaking the
 * swing off after it — the natural step away — lands what was announced and
 * keeps the verdict up. A miss was never celebrated, and a swing that has
 * lost the scythe can pay nothing, so both are dropped.
 */
function verifyJudgedSwingBrokenOff(check: Check): void {
  const walked = swingingRig();
  if (walked === null) return;
  const startMs = walked.clock.nowMs;
  walked.harvest.tryInteract(walked.human);
  const faced = walked.harvest.standInReach(walked.human);
  tick(walked, Math.round(PERFECT_PRESS_SHARE * SWING_TICKS));
  walked.harvest.handleKeyDown(' ', false, pressAt(startMs, PERFECT_PRESS_SHARE));
  walked.human.x += TILE_SIZE / 2;
  tick(walked, 1);
  const grainTexts = walked.human.pendingFloatingText.filter((request) =>
    request.text.includes('Grain'),
  );
  check(
    walked.state.blueprints.grain === GRAIN_PER_PERFECT &&
      grainTexts.length === 1 &&
      !walked.harvest.isSwinging,
    `press perfect, then move: the swing lands its ${GRAIN_PER_PERFECT} grain at once (landed ${walked.state.blueprints.grain})`,
  );
  check(
    faced !== null && walked.harvest.cutsAt(faced.x, faced.y) === 1,
    'press perfect, then move: the faced stand takes its cut',
  );
  check(
    walked.harvest.swingBarView()?.verdict === 'perfect' && verdictCues(walked).length === 1,
    `press perfect, then move: the verdict stays up on the bar, sounded once (${walked.harvest.swingBarView()?.verdict ?? 'no bar'})`,
  );
  tick(walked, SWING_TICKS);
  check(
    walked.state.blueprints.grain === GRAIN_PER_PERFECT,
    'press perfect, then move: the grain is paid once, not again when the swing would have ended',
  );

  const struck = swingingRig();
  if (struck === null) return;
  const struckStartMs = struck.clock.nowMs;
  struck.harvest.tryInteract(struck.human);
  tick(struck, Math.round(GOOD_PRESS_SHARE * SWING_TICKS));
  struck.harvest.handleKeyDown(' ', false, pressAt(struckStartMs, GOOD_PRESS_SHARE));
  struck.human.hp -= 1;
  tick(struck, 1);
  check(
    struck.state.blueprints.grain === GRAIN_PER_GOOD &&
      struck.harvest.swingBarView()?.verdict === 'good',
    `press good, then take a hit: the swing lands its ${GRAIN_PER_GOOD} grain (landed ${struck.state.blueprints.grain})`,
  );

  const missedThenWalked = swingingRig();
  if (missedThenWalked === null) return;
  const missStartMs = missedThenWalked.clock.nowMs;
  missedThenWalked.harvest.tryInteract(missedThenWalked.human);
  tick(missedThenWalked, Math.round(EARLY_PRESS_SHARE * SWING_TICKS));
  missedThenWalked.harvest.handleKeyDown(' ', false, pressAt(missStartMs, EARLY_PRESS_SHARE));
  missedThenWalked.human.x += TILE_SIZE / 2;
  tick(missedThenWalked, SWING_TICKS);
  check(
    missedThenWalked.state.blueprints.grain === 0 && !missedThenWalked.harvest.isSwinging,
    `press a miss, then move: the swing is dropped without its consolation grain (landed ${missedThenWalked.state.blueprints.grain})`,
  );

  const disarmed = swingingRig();
  if (disarmed === null) return;
  const disarmedStartMs = disarmed.clock.nowMs;
  disarmed.harvest.tryInteract(disarmed.human);
  tick(disarmed, Math.round(PERFECT_PRESS_SHARE * SWING_TICKS));
  disarmed.harvest.handleKeyDown(' ', false, pressAt(disarmedStartMs, PERFECT_PRESS_SHARE));
  disarmed.human.inventory.removeItems('quest_scythe', 1);
  tick(disarmed, 1);
  check(
    disarmed.state.blueprints.grain === 0 && !disarmed.harvest.isSwinging,
    'press perfect, then lose the scythe: the swing is dropped with no grain',
  );
}

/** Every harvest section, for the runner's list. */
export function harvestSections(
  check: Check,
): ReadonlyArray<{ readonly name: string; readonly run: () => void }> {
  return [
    { name: 'Grain harvest: grading the swing', run: () => verifyHarvestGrading(check) },
    { name: 'Grain harvest: the verdict on the bar', run: () => verifySwingVerdicts(check) },
    { name: 'Grain harvest: stubble and regrowth', run: () => verifyHarvestRegrowth(check) },
    { name: 'Grain harvest: taking the scythe', run: () => verifyScytheTaking(check) },
  ];
}
