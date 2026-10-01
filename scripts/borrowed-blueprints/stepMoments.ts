/**
 * The seams between "The Borrowed Blueprints"' steps, for
 * `verify:borrowed-blueprints`: the last fence section and the hundredth
 * grain each put up a banner naming who to see next and raise the
 * objective-complete chime exactly once, the journal keeps pointing at
 * Merrit through the report, and a kit rebuilt mid-step (a door visit)
 * shows no banner for a step it did not see finish. Then the finish: the
 * quest-complete screen goes up once, waits its turn, is dismissed by
 * Continue or Escape, never comes back after a rebuild or a reload, and
 * states the upgraded stations' output as the sawmill's constants give it.
 */

import {
  captureBriarHollowState,
  createBriarHollowState,
  parseBriarHollowStateSnapshot,
  restoreBriarHollowState,
  type BriarHollowState,
  type BriarHollowStateSnapshot,
} from '../../src/core/briarHollowState';
import { allocCanvas, surfaceContext } from '../../src/core/canvasSurface';
import { setViewportSize } from '../../src/core/Viewport';
import { transientSpeaker } from '../../src/dialog/line';
import { PASTURE_FENCE_SECTION_COUNT } from '../../src/map/overworld/briarHollowLayout';
import { focusedButtonClickPoint } from '../../src/ui/Button';
import { BLUEPRINTS_REWARDS_HEADING } from '../../src/systems/briarHollow/blueprints/blueprintsRewardSpec';
import { BLUEPRINTS_QUEST_NAME } from '../../src/systems/briarHollow/blueprints/blueprintsProgress';
import type { QuestRewardScreen } from '../../src/ui/questReward/QuestRewardScreen';
import { UPGRADED_WOOD_PER_PRESS } from '../../src/systems/briarHollow/blueprints/StationUpgrades';
import { PLAIN_WOOD_PER_PRESS } from '../../src/systems/briarHollow/processingStations';
import {
  BOARDS_PER_WOOD,
  MANUAL_PROCESS_SECONDS,
  ROPE_PER_WOOD,
} from '../../src/systems/briarHollow/services/woodProcessing';
import {
  FENCE_DONE_BANNER,
  FENCE_DONE_OBJECTIVE_ID,
  HARVEST_DONE_BANNER,
  HARVEST_DONE_OBJECTIVE_ID,
  STEP_BANNER_SECONDS,
} from '../../src/systems/briarHollow/blueprints/BlueprintsStepMoments';
import type { BlueprintsQuestSystem } from '../../src/systems/briarHollow/BlueprintsQuestSystem';
import type { SiegeRig } from '../villageSiegeHarness';
import { buildSiegeRig, UPDATES_PER_SECOND } from '../villageSiegeHarness';
import { BLUEPRINTS_RIG_SEED, blueprintsRig, type Check } from './fence';

const GRAIN_TARGET = 100;
const BANNER_FRAMES = STEP_BANNER_SECONDS * UPDATES_PER_SECOND;

/** Every `objectiveComplete` id the rig's bus carries from now on. */
function recordObjectives(rig: SiegeRig): string[] {
  const ids: string[] = [];
  rig.bus.on('objectiveComplete', (event) => ids.push(event.objectiveId));
  return ids;
}

function stepFrames(rig: SiegeRig, frames: number): void {
  for (let frame = 0; frame < frames; frame++) rig.step();
}

/** Whether the journal's row points at Merrit where she stands. */
function journalPointsAtMerrit(rig: SiegeRig, blueprints: BlueprintsQuestSystem): boolean {
  const merrit = rig.kit.villagers?.villagerFor('merrit') ?? null;
  const target = blueprints.trackerEntries()[0]?.target;
  if (merrit === null || target === undefined) return false;
  return target.x === merrit.tile.x && target.y === merrit.tile.y && target.wearsOwnMarker === true;
}

/**
 * One finished job: `finish` completes it on a rig standing in `from`, and
 * the step moves on to `to` with `banner` up and `objectiveId` raised once.
 */
function verifyJobFinished(
  check: Check,
  job: {
    readonly name: string;
    readonly from: 'build_fence' | 'harvest_grain';
    readonly to: 'report_fence' | 'deliver_grain';
    readonly finish: (rig: SiegeRig) => void;
    readonly banner: typeof FENCE_DONE_BANNER;
    readonly objectiveId: string;
  },
): void {
  const { rig, blueprints } = blueprintsRig(job.from);
  const objectives = recordObjectives(rig);
  rig.step();
  check(blueprints.moments.currentBanner === null, `no banner while the ${job.name} is under way`);
  job.finish(rig);
  rig.step();
  check(rig.state.blueprints.phase === job.to, `the ${job.name} done moves the step to ${job.to}`);
  check(
    blueprints.moments.currentBanner === job.banner,
    `the ${job.name} done puts up "${job.banner.title}" / "${job.banner.subtitle}"`,
  );
  check(
    objectives.join() === job.objectiveId,
    `the ${job.name} done raises objectiveComplete "${job.objectiveId}" once, for the chime (${objectives.join() || 'none'})`,
  );
  rig.step();
  check(
    rig.kit.villagers?.villagerFor('merrit')?.marker === 'question',
    `Merrit wears a "?" once the ${job.name} is done`,
  );
  check(
    journalPointsAtMerrit(rig, blueprints),
    `the journal points at Merrit after the ${job.name}`,
  );
  stepFrames(rig, BANNER_FRAMES);
  check(
    blueprints.moments.currentBanner === null && objectives.length === 1,
    `the ${job.name} banner comes down after ${STEP_BANNER_SECONDS} s, and the chime never repeats`,
  );
  rig.dispose();

  const rebuilt = blueprintsRig(job.to);
  const rebuiltObjectives = recordObjectives(rebuilt.rig);
  rebuilt.rig.step();
  check(
    rebuilt.blueprints.moments.currentBanner === null && rebuiltObjectives.length === 0,
    `a kit rebuilt at ${job.to} shows no banner for a ${job.name} it did not see finish`,
  );
  rebuilt.rig.dispose();
}

export function verifyStepBanners(check: Check): void {
  verifyJobFinished(check, {
    name: 'fence',
    from: 'build_fence',
    to: 'report_fence',
    finish: (rig) => {
      for (let index = 0; index < PASTURE_FENCE_SECTION_COUNT; index++) {
        rig.state.blueprints.fenceSectionsBuilt[index] = true;
      }
    },
    banner: FENCE_DONE_BANNER,
    objectiveId: FENCE_DONE_OBJECTIVE_ID,
  });
  verifyJobFinished(check, {
    name: 'harvest',
    from: 'harvest_grain',
    to: 'deliver_grain',
    finish: (rig) => {
      rig.state.blueprints.grain = GRAIN_TARGET;
    },
    banner: HARVEST_DONE_BANNER,
    objectiveId: HARVEST_DONE_OBJECTIVE_ID,
  });
}

// ── The quest-complete screen ────────────────────────────────────────────

const COMPLETE_RIG_ASSAULT_LEVEL = 6;
/** Frames a rig is given for the screen to go up once it is due: it opens on the first. */
const OPEN_WITHIN_FRAMES = 3;
/** Long enough that a screen raised a second time would certainly be up. */
const NO_REPLAY_FRAMES = 2 * UPDATES_PER_SECOND;
const SCREEN_W = 1280;
const SCREEN_H = 720;
/** A point on no button, well clear of the panel. */
const STRAY_CLICK = { x: 2, y: 2 } as const;

/** Render frames a reveal is given to settle before a check calls it stuck. */
const SETTLE_CEILING_FRAMES = 600;

interface CompletionRig {
  readonly rig: SiegeRig;
  readonly blueprints: BlueprintsQuestSystem;
  /** The scene's shared quest-complete screen, as the rig's menus hold it. */
  readonly screen: QuestRewardScreen;
  /** How many times a quest-complete screen has gone up, fanfare and all. */
  readonly opens: { count: number };
}

/**
 * A village kit on `state`, with the shared quest-complete screen waiting out
 * the village's conversation as the scene's does, counting every time it goes up.
 */
function completionRigOn(state: BriarHollowState): CompletionRig {
  const rig = buildSiegeRig({
    seed: BLUEPRINTS_RIG_SEED,
    state,
    assaultLevel: COMPLETE_RIG_ASSAULT_LEVEL,
  });
  const blueprints = rig.kit.blueprints;
  if (blueprints === null) throw new Error('the village kit built no blueprints quest');
  rig.human.godMode = true;
  rig.cat.godMode = true;
  const screen = rig.menus.questReward;
  screen.setOpenConditions({
    conversationOpen: () => rig.kit.villagers?.conversation.isOpen === true,
    worldHeld: () => false,
  });
  const opens = { count: 0 };
  const open = screen.open.bind(screen);
  screen.open = (spec) => {
    opens.count++;
    open(spec);
  };
  return { rig, blueprints, screen, opens };
}

/** One scene frame: the village's update, then the menus' screen. */
function stepCompletion(setup: CompletionRig, frames: number): void {
  for (let frame = 0; frame < frames; frame++) {
    setup.rig.step();
    setup.screen.update();
  }
}

/** Whether the Blueprints' own screen is the one on show. */
function blueprintsScreenOpen(setup: CompletionRig): boolean {
  return setup.screen.showing?.questTitle === BLUEPRINTS_QUEST_NAME;
}

/** A kit whose second station has just gone up: the next update completes the quest. */
function bothStationsUpgradedRig(): CompletionRig {
  const state = createBriarHollowState();
  state.blueprints.phase = 'build_stations';
  state.blueprints.stationsUpgraded.saw = true;
  state.blueprints.stationsUpgraded.ropeWalk = true;
  return completionRigOn(state);
}

/** Every word one frame of the village's dialogs and the screen drew, at a desktop window. */
function renderDialogs(setup: CompletionRig): string[] {
  setViewportSize(SCREEN_W, SCREEN_H);
  const ctx = surfaceContext(allocCanvas(SCREEN_W, SCREEN_H));
  const texts: string[] = [];
  const fillText = ctx.fillText.bind(ctx);
  ctx.fillText = (...args: Parameters<CanvasRenderingContext2D['fillText']>) => {
    texts.push(args[0]);
    fillText(...args);
  };
  setup.rig.kit.renderDialog(ctx, 0, 0);
  setup.screen.render(ctx);
  return texts;
}

/** Renders the screen until its reveal has settled. */
function settle(setup: CompletionRig): void {
  for (let frame = 0; frame < SETTLE_CEILING_FRAMES && !setup.screen.isSettled; frame++) {
    renderDialogs(setup);
  }
}

/** Presses the accept key as the focus ring would: a click at the ring's primary. */
function pressAccept(setup: CompletionRig): boolean {
  renderDialogs(setup);
  const point = focusedButtonClickPoint();
  if (point === null) return false;
  setup.screen.handleClick(point.x, point.y);
  return true;
}

/** Raised once on completion, halting the world, and gone for good after Continue. */
function verifyCompletionScreenShownOnce(check: Check): void {
  const setup = bothStationsUpgradedRig();
  const { rig, screen } = setup;
  stepCompletion(setup, OPEN_WITHIN_FRAMES);
  check(rig.state.blueprints.phase === 'complete', 'both stations upgraded completes the quest');
  check(blueprintsScreenOpen(setup), 'the quest-complete screen goes up on completion');
  check(setup.opens.count === 1, 'the screen goes up once, with its fanfare');
  const claim = screen.overlayClaim();
  check(
    claim.isOpen && claim.haltsWorld && claim.locksKeyboard,
    "the screen's overlay claim is open, halts the world and locks the keyboard",
  );

  const drawn = renderDialogs(setup).join('\n');
  check(
    drawn.includes('QUEST COMPLETE') && drawn.includes(BLUEPRINTS_QUEST_NAME),
    'the screen names the quest as complete',
  );
  check(drawn.includes(BLUEPRINTS_REWARDS_HEADING), 'the screen lists its rewards as permanent');

  screen.handleClick(STRAY_CLICK.x, STRAY_CLICK.y);
  check(
    screen.isOpen && screen.isSettled,
    'a click before the reveal settles only finishes the reveal',
  );
  settle(setup);
  screen.handleClick(STRAY_CLICK.x, STRAY_CLICK.y);
  check(screen.isOpen, 'a click off Continue does not dismiss the settled screen');
  check(pressAccept(setup), 'the settled screen offers Continue as its primary to the accept key');
  check(!screen.isOpen, 'Continue dismisses the screen');
  check(rig.state.blueprints.completionScreenSeen, 'dismissing records the screen as seen');
  check(!screen.overlayClaim().isOpen, 'the claim closes with the screen');

  stepCompletion(setup, NO_REPLAY_FRAMES);
  check(
    !screen.isOpen && setup.opens.count === 1,
    'the screen never comes back, and the fanfare never repeats',
  );

  const reloaded = parseBriarHollowStateSnapshot(
    JSON.parse(JSON.stringify(captureBriarHollowState(rig.state))),
  );
  rig.dispose();
  if (reloaded === undefined) {
    check(false, 'the finished village parses back');
    return;
  }
  check(reloaded.blueprints.completionScreenSeen, 'the seen flag survives a save and load');
  const reloadedState = createBriarHollowState();
  restoreBriarHollowState(reloadedState, reloaded);
  const rebuilt = completionRigOn(reloadedState);
  stepCompletion(rebuilt, NO_REPLAY_FRAMES);
  check(
    !rebuilt.screen.isOpen && rebuilt.opens.count === 0,
    'a kit rebuilt from the reloaded save (a door visit, a load) never raises it again',
  );
  rebuilt.rig.dispose();
}

/** Escape leaves as Continue does, once settled; an auto-repeat does not. */
function verifyCompletionScreenEscape(check: Check): void {
  const setup = bothStationsUpgradedRig();
  const { rig, screen } = setup;
  stepCompletion(setup, OPEN_WITHIN_FRAMES);
  settle(setup);
  screen.handleKeyDown('Escape', true);
  check(screen.isOpen, 'a held Escape repeating into the screen does not dismiss it');
  check(screen.handleKeyDown('h', false), 'every other key is swallowed while the screen is up');
  screen.handleKeyDown('Escape', false);
  check(
    !screen.isOpen && rig.state.blueprints.completionScreenSeen,
    'a fresh Escape dismisses the settled screen and records it as seen',
  );
  rig.dispose();
}

/** It waits for a conversation and for the siege, and a completion never read survives a door. */
function verifyCompletionScreenWaits(check: Check): void {
  const setup = bothStationsUpgradedRig();
  const { rig } = setup;
  const conversation = rig.kit.villagers?.conversation ?? null;
  if (conversation === null) {
    check(false, 'the village kit has a conversation panel');
    return;
  }
  const handle = conversation.open({
    lines: [transientSpeaker('Fenna', 'questLine').line('One moment.')],
    reward: null,
    questRelated: false,
    ending: { kind: 'close', onClosed: () => undefined },
    dismiss: { kind: 'allowed', onDismissed: () => undefined },
    haltsWorld: false,
    anchor: null,
    locksKeyboard: true,
  });
  stepCompletion(setup, OPEN_WITHIN_FRAMES);
  check(
    rig.state.blueprints.phase === 'complete' && !blueprintsScreenOpen(setup),
    'the screen waits while a conversation is open',
  );
  check(setup.opens.count === 0, 'and holds its fanfare for when it goes up');
  if (conversation.isActive(handle)) conversation.close();
  stepCompletion(setup, OPEN_WITHIN_FRAMES);
  check(blueprintsScreenOpen(setup), 'the screen goes up once the conversation closes');
  rig.dispose();

  const underSiege = createBriarHollowState();
  underSiege.blueprints.phase = 'complete';
  underSiege.quest.phase = 'imminent';
  const siege = completionRigOn(underSiege);
  stepCompletion(siege, OPEN_WITHIN_FRAMES);
  check(
    !siege.screen.isOpen && siege.screen.queuedCount === 0,
    'the screen is never asked for during the siege',
  );
  siege.rig.dispose();

  const unread = createBriarHollowState();
  unread.blueprints.phase = 'complete';
  const door = completionRigOn(unread);
  stepCompletion(door, OPEN_WITHIN_FRAMES);
  check(
    blueprintsScreenOpen(door),
    'a completion whose screen was never dismissed raises it on the far side of a door',
  );
  door.rig.dispose();
}

/** A save from before the flag existed: a finished quest reads as seen, an open one does not. */
function verifyCompletionFlagParse(check: Check): void {
  const readWithoutFlag = (
    phase: 'complete' | 'build_stations',
  ): BriarHollowStateSnapshot | undefined => {
    const state = createBriarHollowState();
    state.blueprints.phase = phase;
    const snapshot: unknown = JSON.parse(JSON.stringify(captureBriarHollowState(state)));
    if (typeof snapshot === 'object' && snapshot !== null && 'blueprints' in snapshot) {
      const quest: unknown = snapshot.blueprints;
      if (typeof quest === 'object' && quest !== null) {
        Reflect.deleteProperty(quest, 'completionScreenSeen');
      }
    }
    return parseBriarHollowStateSnapshot(snapshot);
  };
  check(
    readWithoutFlag('complete')?.blueprints.completionScreenSeen === true,
    'an old save with the quest already finished never springs the screen on load',
  );
  check(
    readWithoutFlag('build_stations')?.blueprints.completionScreenSeen === false,
    'an old save mid-quest still has the screen to come',
  );
}

/**
 * Each station's card states what the sawmill really does, in figures worked
 * out here from the constants the sawmill itself reads.
 */
function verifyCompletionRewardsMatchConstants(check: Check): void {
  const setup = bothStationsUpgradedRig();
  const { rig } = setup;
  stepCompletion(setup, OPEN_WITHIN_FRAMES);
  settle(setup);
  const drawn = renderDialogs(setup);
  const drew = (text: string): boolean => drawn.some((line) => line.includes(text));
  const intake = `${UPGRADED_WOOD_PER_PRESS} wood per press (was ${PLAIN_WOOD_PER_PRESS})`;
  const sawOutput = `${UPGRADED_WOOD_PER_PRESS * BOARDS_PER_WOOD} boards a press (was ${PLAIN_WOOD_PER_PRESS * BOARDS_PER_WOOD})`;
  const ropeOutput = `${UPGRADED_WOOD_PER_PRESS * ROPE_PER_WOOD} rope a press (was ${PLAIN_WOOD_PER_PRESS * ROPE_PER_WOOD})`;
  check(drew('Upgraded Saw') && drew('Upgraded Rope Walk'), 'both upgraded stations are listed');
  check(drawn.filter((line) => line === intake).length === 2, `both cards read "${intake}"`);
  check(drew(sawOutput), `the saw's card reads "${sawOutput}"`);
  check(drew(ropeOutput), `the rope walk's card reads "${ropeOutput}"`);
  check(
    drew(`${MANUAL_PROCESS_SECONDS}s press`) &&
      drew(`${UPGRADED_WOOD_PER_PRESS / PLAIN_WOOD_PER_PRESS}x the output`),
    'the footnote gives the press time and the multiplier the constants give',
  );
  rig.dispose();
}

/** Every step-moment section, for the runner's list. */
export function stepMomentSections(
  check: Check,
): ReadonlyArray<{ readonly name: string; readonly run: () => void }> {
  return [
    { name: 'Step banners: fence and harvest done', run: () => verifyStepBanners(check) },
    {
      name: 'Quest-complete screen: shown once, dismissed, never replayed',
      run: () => verifyCompletionScreenShownOnce(check),
    },
    { name: 'Quest-complete screen: Escape', run: () => verifyCompletionScreenEscape(check) },
    {
      name: 'Quest-complete screen: waits for conversations and the siege',
      run: () => verifyCompletionScreenWaits(check),
    },
    { name: 'Quest-complete screen: old saves', run: () => verifyCompletionFlagParse(check) },
    {
      name: 'Quest-complete screen: rewards match the sawmill',
      run: () => verifyCompletionRewardsMatchConstants(check),
    },
  ];
}
