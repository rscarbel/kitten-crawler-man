/**
 * Wendell as the contracts' giver, for `verify:construction-contracts`: no
 * opinion before the Borrowed Blueprints is finished, a `!` while a contract
 * is his to give and none while one is held, the intro's accept issuing the
 * first, a drop clearing it, and one press of "Take another contract"
 * issuing exactly one more, and never a second while one is held.
 *
 * His hook is stood up the way Plumbline Farm's interior stands it up, on a
 * real `Conversation` whose own handles run his choices.
 */

import { createAnchorQuestProgress } from '../../src/core/AnchorQuestProgress';
import { createBriarHollowState, type BriarHollowState } from '../../src/core/briarHollowState';
import { TILE_SIZE } from '../../src/core/constants';
import { EventBus } from '../../src/core/EventBus';
import { HumanPlayer } from '../../src/creatures/HumanPlayer';
import { Conversation, defaultChoiceIndex } from '../../src/dialog/Conversation';
import { speakerLines } from '../../src/dialog/line';
import type { Choice, ConversationHandle, ConversationRequest } from '../../src/dialog/request';
import { WENDELL_CONTRACTS } from '../../src/dialog/scripts/wendellContracts';
import { PLUMBLINE_FARM_NAME } from '../../src/systems/briarHollow/blueprints/blueprintsProgress';
import { contractSiteFor } from '../../src/systems/constructionContracts/contractCatalog';
import {
  buildContractWorld,
  CONSTRUCTION_CONTRACT_QUEST_ID,
  releaseContractAutoPinOnEnd,
} from '../../src/systems/constructionContracts/contractQuest';
import { createJournalProgress } from '../../src/core/JournalProgress';
import { WendellContractsHook } from '../../src/systems/constructionContracts/WendellContractsHook';
import type { Check } from './shared';

const WENDELL = 'wendell';
const WENDELL_FLOOR = 0;
const WENDELL_SEED = 2718;

interface WendellRig {
  readonly state: BriarHollowState;
  readonly conversation: Conversation;
  readonly hook: WendellContractsHook;
  readonly human: HumanPlayer;
  /** Every request opened or played, with the handle that runs its choices. */
  readonly shown: Array<{ request: ConversationRequest; handle: ConversationHandle }>;
  readonly questsStarted: () => number;
  readonly bus: EventBus;
}

function wendellRig(): WendellRig | null {
  const state = createBriarHollowState();
  const conversation = new Conversation(null);
  const shown: WendellRig['shown'] = [];
  const open = conversation.open.bind(conversation);
  conversation.open = (request) => {
    const inner = open(request);
    // The hook's choices play their next beat through the handle they are
    // handed; wrapping it records each beat as the player would see it.
    const handle: ConversationHandle = {
      play: (next) => {
        shown.push({ request: next, handle });
        inner.play(next);
      },
      close: () => inner.close(),
    };
    shown.push({ request, handle });
    return handle;
  };
  const bus = new EventBus();
  let started = 0;
  bus.on('questStarted', (event) => {
    if (event.questId === CONSTRUCTION_CONTRACT_QUEST_ID) started++;
  });
  const anchor = createAnchorQuestProgress();
  const hook = WendellContractsHook.forBuilding(PLUMBLINE_FARM_NAME, WENDELL_FLOOR, {
    state,
    bus,
    audio: null,
    conversation,
    worldSeed: WENDELL_SEED,
    world: () =>
      buildContractWorld({ murderQuest: undefined, anchorQuest: anchor, briarHollow: state }),
    openHayloft: () => undefined,
    chatLine: () => speakerLines('wendell').line('Fine weather for joinery.'),
  });
  if (hook === null) return null;
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  human.isActive = true;
  return { state, conversation, hook, human, shown, questsStarted: () => started, bus };
}

function lastShown(
  rig: WendellRig,
): { request: ConversationRequest; handle: ConversationHandle } | null {
  return rig.shown[rig.shown.length - 1] ?? null;
}

function choicesOf(request: ConversationRequest): readonly Choice[] {
  return request.ending.kind === 'choices' ? request.ending.choices : [];
}

function choiceLabelled(request: ConversationRequest, label: string): Choice | undefined {
  return choicesOf(request).find((choice) => choice.label === label);
}

/** Opens a fresh talk with Wendell and returns what he shows first. */
function talk(
  rig: WendellRig,
): { request: ConversationRequest; handle: ConversationHandle } | null {
  rig.conversation.close();
  if (!rig.hook.tryOpenDialog(WENDELL, rig.human)) return null;
  return lastShown(rig);
}

function verifyWendell(check: Check): void {
  const rig = wendellRig();
  check(rig !== null, 'Plumbline Farm stands up the contracts hook');
  if (rig === null) return;
  check(
    WendellContractsHook.forBuilding('The Rusty Anvil', WENDELL_FLOOR, {
      state: rig.state,
      bus: new EventBus(),
      audio: null,
      conversation: rig.conversation,
      worldSeed: WENDELL_SEED,
      world: () =>
        buildContractWorld({
          murderQuest: undefined,
          anchorQuest: createAnchorQuestProgress(),
          briarHollow: rig.state,
        }),
      openHayloft: () => undefined,
      chatLine: () => speakerLines('wendell').line('—'),
    }) === null,
    'no contracts hook anywhere else',
  );

  check(rig.hook.markerFor(WENDELL) === null, 'locked: no marker opinion before the Blueprints');
  check(!rig.hook.tryOpenDialog(WENDELL, rig.human), 'locked: no contracts talk');

  rig.state.blueprints.phase = 'complete';
  check(rig.hook.markerFor(WENDELL) === 'exclamation', 'unlocked and idle: a ! over Wendell');
  check(rig.hook.markerFor('old_hilda') === null, 'nobody else gets his marker');

  const intro = talk(rig);
  const introEnding = intro?.request.ending;
  check(introEnding?.kind === 'confirm', 'the first talk is the intro, ending on accept/decline');
  if (intro === null || introEnding?.kind !== 'confirm') return;
  introEnding.accept.run(intro.handle);
  const first = rig.state.contracts.active;
  check(
    first !== null && rig.state.contracts.introSeen && rig.state.contracts.contractsIssued === 1,
    'accepting the intro issues the first contract',
  );
  check(rig.questsStarted() === 1, 'questStarted fired once');
  check(rig.hook.markerFor(WENDELL) === 'none', 'holding a contract: no marker over Wendell');

  const held = talk(rig);
  const takeWhileHeld = held === null ? undefined : choicesOf(held.request)[0];
  check(
    takeWhileHeld?.label === WENDELL_CONTRACTS.takeAnotherLabel,
    'the menu leads with "Take another contract"',
  );
  if (held !== null && takeWhileHeld !== undefined) takeWhileHeld.run(held.handle);
  check(
    rig.state.contracts.contractsIssued === 1 && rig.state.contracts.active === first,
    'pressing it while one is held issues nothing',
  );

  const progress = createJournalProgress();
  const stopReleasing = releaseContractAutoPinOnEnd(rig.bus, progress);
  progress.pinnedTrackerId = CONSTRUCTION_CONTRACT_QUEST_ID;
  progress.pinSource = 'auto';
  const toDrop = talk(rig);
  const drop =
    toDrop === null ? undefined : choiceLabelled(toDrop.request, WENDELL_CONTRACTS.dropLabel);
  check(drop !== undefined, 'a contract with work left can be dropped');
  if (toDrop !== null && drop !== undefined) {
    drop.run(toDrop.handle);
    const confirm = lastShown(rig);
    const yes =
      confirm === null
        ? undefined
        : choiceLabelled(confirm.request, WENDELL_CONTRACTS.confirmDropLabel);
    if (confirm !== null && yes !== undefined) yes.run(confirm.handle);
  }
  const firstSite = first === null ? undefined : contractSiteFor(first.site);
  check(
    rig.state.contracts.active === null && rig.state.contracts.lastSiteKey === firstSite?.slug,
    'dropping clears the contract and remembers its site',
  );
  check(rig.hook.markerFor(WENDELL) === 'exclamation', 'after the drop: the ! is back');
  check(
    progress.pinnedTrackerId === null,
    "after the drop: the auto pin is let go, so no beam lights Wendell's door",
  );
  progress.pinnedTrackerId = CONSTRUCTION_CONTRACT_QUEST_ID;
  progress.pinSource = 'player';
  rig.bus.emit('questAbandoned', { questId: CONSTRUCTION_CONTRACT_QUEST_ID });
  check(
    progress.pinnedTrackerId === CONSTRUCTION_CONTRACT_QUEST_ID,
    "after a drop: the player's own pin stays, so the door still lights",
  );
  stopReleasing();

  const idle = talk(rig);
  const choices = idle === null ? [] : choicesOf(idle.request);
  const pressIndex = defaultChoiceIndex(choices);
  const press = pressIndex === null ? undefined : choices[pressIndex];
  check(
    press?.label === WENDELL_CONTRACTS.takeAnotherLabel,
    'idle: Space lands on "Take another contract"',
  );
  check(
    idle !== null && choiceLabelled(idle.request, WENDELL_CONTRACTS.dropLabel) === undefined,
    'idle: nothing to drop',
  );
  const issuedBefore = rig.state.contracts.contractsIssued;
  const startedBefore = rig.questsStarted();
  if (idle !== null && press !== undefined) press.run(idle.handle);
  const second = rig.state.contracts.active;
  check(
    rig.state.contracts.contractsIssued === issuedBefore + 1 && second !== null,
    'one press issues exactly one contract',
  );
  check(rig.questsStarted() === startedBefore + 1, 'and starts the quest once');
  const secondSite = second === null ? undefined : contractSiteFor(second.site);
  check(
    secondSite !== undefined && secondSite.slug !== firstSite?.slug,
    `the new contract is at another building (${secondSite?.name ?? 'none'})`,
  );
  const issuedLine = lastShown(rig);
  check(
    issuedLine !== null &&
      issuedLine.request.ending.kind === 'close' &&
      secondSite !== undefined &&
      JSON.stringify(issuedLine.request.lines).includes(secondSite.name),
    'Wendell names the building and closes; no further press is offered',
  );
  check(rig.hook.markerFor(WENDELL) === 'none', 'the new contract held: no marker');
}

export const wendellSections: ReadonlyArray<{
  readonly name: string;
  readonly run: (check: Check) => void;
}> = [{ name: "Wendell's marker and one-press contracts", run: verifyWendell }];
