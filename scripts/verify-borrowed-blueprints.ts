#!/usr/bin/env tsx
/**
 * Headless gate for "The Borrowed Blueprints", Fenna's Briar Hollow side
 * quest. Each section checks one seam or rule on its own and is listed in
 * `SECTIONS` below; a new part of the quest adds its own section there.
 *
 * Run: npm run verify:borrowed-blueprints
 */

import { installCanvasGlobals } from './nodeCanvasGlobals';
import {
  BLUEPRINTS_QUEST_PHASE_ORDER,
  blueprintsPhaseAtLeast,
  hasAcceptedBlueprintsQuest,
  isWendellWaitingForCow,
  type BlueprintsQuestPhase,
} from '../src/core/blueprintsQuestPhase';
import {
  captureBriarHollowState,
  createBriarHollowState,
  parseBriarHollowStateSnapshot,
  restoreBriarHollowState,
} from '../src/core/briarHollowState';
import { EventBus } from '../src/core/EventBus';
import { Inventory } from '../src/core/Inventory';
import { ITEM_DEF, QUEST_SLOT_IDX, type InventoryItem } from '../src/core/ItemDefs';
import { constructionUnlocked, TIKKA_PLANS_UNLOCKS } from '../src/core/villageUnlocks';
import { PASTURE_FENCE_SECTION_COUNT } from '../src/map/overworld/briarHollowLayout';
import { SFX_GROUPS } from '../src/audio/sfxGroups';
import type { SoundId } from '../src/audio/sounds';
import type { DialogLine } from '../src/dialog/line';
import type { VillagerId } from '../src/dialog/scripts/briarHollow';
import type { NPCMarkerType } from '../src/creatures/QuestNPC';
import {
  firstQuestMarker,
  firstQuestOpening,
  KEEP_TALKING,
  openingLine,
  type QuestLineProvider,
  type VillagerContext,
} from '../src/systems/briarHollow/villagerCircumstances';
import {
  BLUEPRINTS_QUEST_ID,
  moveBlueprintsPhase,
} from '../src/systems/briarHollow/blueprints/blueprintsProgress';
import { BLUEPRINTS_CUES } from '../src/systems/briarHollow/blueprints/blueprintsSoundCues';
import {
  fennaAcceptedPages,
  merritAskPages,
  merritFenceDonePages,
  skyfowlTownWhereabouts,
  wendellFirstVisitPages,
} from '../src/systems/briarHollow/blueprints/blueprintsDialog';
import { forwardQuestItemEvictions } from '../src/systems/questItemEvictions';
import {
  verifyFennaDecline,
  verifyFennaJournal,
  verifyFennaMarker,
  verifyFennaOffer,
  verifyWendellMarker,
} from './borrowed-blueprints/fenna';
import {
  verifyFenceBuild,
  verifyFenceCancelAndRefusal,
  verifyFenceCompletes,
  verifyFenceOnlyInBuildStep,
  verifyFenceSections,
  verifyFenceTap,
  verifyFenceHammering,
  verifyFenceWorkLoop,
} from './borrowed-blueprints/fence';
import {
  verifyMerritAsk,
  verifyMerritFenceDone,
  verifyMerritGrainAndCall,
  verifyMerritUnderSiege,
} from './borrowed-blueprints/merrit';
import { wendellSections } from './borrowed-blueprints/wendell';
import { stationSections } from './borrowed-blueprints/stations';
import { harvestSections } from './borrowed-blueprints/harvest';
import { stepMomentSections } from './borrowed-blueprints/stepMoments';
import { evictionSections } from './borrowed-blueprints/evictions';
import { agreementSections } from './borrowed-blueprints/agreement';
import { escortRouteSections } from './borrowed-blueprints/escortRoute';
import { verifyMidgeFriendlyFire } from './borrowed-blueprints/midgeFriendlyFire';

installCanvasGlobals();

let failures = 0;

function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`);
  if (!ok) failures++;
}

// ── Phase order ──────────────────────────────────────────────────────────

function verifyPhaseOrder(): void {
  const order = BLUEPRINTS_QUEST_PHASE_ORDER;
  check(new Set(order).size === order.length, 'every phase appears once in the order');
  check(order[0] === 'unoffered', 'the order starts at unoffered');
  check(order[order.length - 1] === 'complete', 'the order ends at complete');
  check(blueprintsPhaseAtLeast('build_fence', 'ask_merrit'), 'build_fence is at least ask_merrit');
  check(!blueprintsPhaseAtLeast('ask_merrit', 'build_fence'), 'ask_merrit is not yet build_fence');
  check(blueprintsPhaseAtLeast('complete', 'complete'), 'a phase is at least itself');
  check(!hasAcceptedBlueprintsQuest('unoffered'), 'unoffered is not accepted');
  check(!hasAcceptedBlueprintsQuest('declined'), 'declined is not accepted');
  check(hasAcceptedBlueprintsQuest('ask_wendell'), 'ask_wendell is accepted');
  const waiting: readonly BlueprintsQuestPhase[] = [
    'ask_merrit',
    'build_fence',
    'report_fence',
    'harvest_grain',
    'deliver_grain',
    'escort_midge',
  ];
  check(
    order.every((phase) => isWendellWaitingForCow(phase) === waiting.includes(phase)),
    'Wendell waits for his cow from ask_merrit through escort_midge, and at no other step',
  );
}

// ── Persistence ──────────────────────────────────────────────────────────

const ROUND_TRIP_GRAIN = 104;
const FIRST_SECTION = 0;
const MIDDLE_SECTION = 3;
const LAST_SECTION = PASTURE_FENCE_SECTION_COUNT - 1;
const BUILT_SECTION_INDICES = [FIRST_SECTION, MIDDLE_SECTION, LAST_SECTION] as const;

function verifyPersistence(): void {
  const state = createBriarHollowState();
  check(state.blueprints.phase === 'unoffered', 'a fresh village has the quest unoffered');
  check(
    state.blueprints.fenceSectionsBuilt.length === PASTURE_FENCE_SECTION_COUNT,
    `a fresh record holds ${PASTURE_FENCE_SECTION_COUNT} fence flags`,
  );

  state.blueprints.phase = 'harvest_grain';
  for (const index of BUILT_SECTION_INDICES) state.blueprints.fenceSectionsBuilt[index] = true;
  state.blueprints.grain = ROUND_TRIP_GRAIN;
  state.blueprints.stationsUpgraded.saw = true;
  const snapshot = captureBriarHollowState(state);
  const parsed = parseBriarHollowStateSnapshot(JSON.parse(JSON.stringify(snapshot)));
  check(parsed !== undefined, 'a captured village parses back');
  if (parsed === undefined) return;
  check(parsed.blueprints.phase === 'harvest_grain', 'the phase survives the round trip');
  check(parsed.blueprints.grain === ROUND_TRIP_GRAIN, 'grain, overshoot kept, survives');
  check(
    JSON.stringify(parsed.blueprints.fenceSectionsBuilt) ===
      JSON.stringify(state.blueprints.fenceSectionsBuilt),
    'the fence flags survive',
  );
  check(
    parsed.blueprints.stationsUpgraded.saw && !parsed.blueprints.stationsUpgraded.ropeWalk,
    'the station flags survive',
  );

  const restored = createBriarHollowState();
  restoreBriarHollowState(restored, parsed);
  check(restored.blueprints.grain === ROUND_TRIP_GRAIN, 'a restore writes the quest back');
  restored.blueprints.fenceSectionsBuilt[1] = true;
  check(
    !parsed.blueprints.fenceSectionsBuilt[1],
    'a restored record shares no array with the snapshot it came from',
  );

  const oldSave: unknown = JSON.parse(
    JSON.stringify(captureBriarHollowState(createBriarHollowState())),
  );
  if (typeof oldSave === 'object' && oldSave !== null && 'blueprints' in oldSave) {
    Reflect.deleteProperty(oldSave, 'blueprints');
  }
  const fromOldSave = parseBriarHollowStateSnapshot(oldSave);
  check(
    fromOldSave?.blueprints.phase === 'unoffered' &&
      fromOldSave.blueprints.grain === 0 &&
      fromOldSave.blueprints.fenceSectionsBuilt.length === PASTURE_FENCE_SECTION_COUNT &&
      fromOldSave.blueprints.fenceSectionsBuilt.every((built) => !built),
    'a save from before the quest existed reads as a quest never offered',
  );

  const malformed = parseBriarHollowStateSnapshot({
    ...snapshot,
    blueprints: {
      phase: 'teleport_the_cow',
      fenceSectionsBuilt: [true, 'yes', true],
      grain: -5,
      stationsUpgraded: { saw: 'maybe', ropeWalk: true },
    },
  });
  check(malformed?.blueprints.phase === 'unoffered', 'an unknown phase falls back to unoffered');
  check(
    malformed?.blueprints.fenceSectionsBuilt.length === PASTURE_FENCE_SECTION_COUNT &&
      malformed.blueprints.fenceSectionsBuilt[0] &&
      !malformed.blueprints.fenceSectionsBuilt[1] &&
      malformed.blueprints.fenceSectionsBuilt[2],
    'a short, partly malformed fence array keeps the good flags and pads the rest',
  );
  check(malformed?.blueprints.grain === 0, 'negative grain is clamped to zero');
  check(
    malformed?.blueprints.stationsUpgraded.saw === false &&
      malformed.blueprints.stationsUpgraded.ropeWalk,
    'a malformed station flag falls back while a good one is kept',
  );
}

// ── Quest-line providers ─────────────────────────────────────────────────

function villagerContext(): VillagerContext {
  const state = createBriarHollowState();
  return {
    nowSeconds: 0,
    quest: state.quest,
    talkCount: 1,
    onceFlags: [],
    party: {
      hpFractions: { human: 1, cat: 1 },
      stone: 0,
      axeTier: null,
      pickaxeTier: null,
      constructionLevels: { human: 0, cat: 0 },
      constructionLearned: false,
    },
    events: {
      lastCowPetNearbyAt: null,
      lastDepositDepletedNearAt: null,
      firstWoodenWallBuilt: false,
      stoneAtLastTalk: null,
      lastStoneUpgradeHintAt: null,
    },
    breachExists: false,
    woodenWallStanding: false,
    lowestStock: null,
    soldierStance: null,
    unlocks: state.unlocks,
  };
}

/** A provider that speaks and marks only for `villager`, counting how often it was asked for a line. */
function standInProvider(
  villager: VillagerId,
  line: DialogLine,
  marker: NPCMarkerType,
): QuestLineProvider & { asked: number } {
  const provider = {
    asked: 0,
    lineFor: (id: VillagerId) => {
      provider.asked++;
      return id === villager ? { pages: [line] as const, after: KEEP_TALKING } : null;
    },
    markerFor: (id: VillagerId): NPCMarkerType => (id === villager ? marker : 'none'),
  };
  return provider;
}

function verifyProviderOrder(): void {
  const ctx = villagerContext();
  const [pleaLine] = merritFenceDonePages('carl');
  const [sideLine] = merritAskPages('carl', true);
  const plea = standInProvider('fenna', pleaLine, 'question');
  const side = standInProvider('fenna', sideLine, 'exclamation');
  const opening = firstQuestOpening('fenna', ctx, [plea, side]);
  check(opening?.pages[0] === pleaLine, 'the first provider with an opening speaks');
  check(side.asked === 0, 'a later provider is not asked once an earlier one has spoken');
  check(
    firstQuestMarker('fenna', ctx, [plea, side]) === 'question',
    "the first provider's marker wins",
  );

  const silent = standInProvider('oren', pleaLine, 'question');
  check(
    firstQuestOpening('fenna', ctx, [silent, side])?.pages[0] === sideLine,
    'a provider with nothing to say leaves the villager to the next one',
  );
  check(
    firstQuestMarker('fenna', ctx, [silent, side]) === 'exclamation',
    "a provider's 'none' marker lets the next provider's marker through",
  );
  check(
    firstQuestMarker('fenna', ctx, []) === 'none' && firstQuestOpening('fenna', ctx, []) === null,
    'no providers means no quest opening and no marker',
  );
  const ladder = openingLine('fenna', ctx, [silent, side]);
  check(
    ladder.rule === 'quest' && ladder.pages[0] === sideLine,
    'the opening ladder takes the quest rung from the provider list',
  );
}

// ── Quest-slot eviction ──────────────────────────────────────────────────

function questSlotOf(inventory: Inventory): InventoryItem | null {
  return inventory.actionBar.slots[QUEST_SLOT_IDX] ?? null;
}

function verifyEviction(): void {
  const human = { inventory: new Inventory('human') };
  const cat = { inventory: new Inventory('cat') };
  const bus = new EventBus();
  const evictions: Array<{ itemId: string; crawler: string }> = [];
  bus.on('questItemEvicted', (event) => evictions.push(event));
  const stopForwarding = forwardQuestItemEvictions(bus, { human, cat });

  const firstBoards = 2;
  const moreBoards = 1;
  human.inventory.addItem('quest_wood_board', firstBoards);
  check(evictions.length === 0, 'filling an empty quest slot evicts nothing');
  human.inventory.addItem('quest_wood_board', moreBoards);
  check(
    questSlotOf(human.inventory)?.quantity === firstBoards + moreBoards && evictions.length === 0,
    'the same item tops the slot up without an eviction',
  );

  const evicted = human.inventory.replaceQuestSlot({ ...ITEM_DEF.quest_scythe, quantity: 1 });
  check(evicted?.id === 'quest_wood_board', 'replaceQuestSlot returns what it evicted');
  check(questSlotOf(human.inventory)?.id === 'quest_scythe', 'the new item holds the slot');
  check(
    evictions.length === 1 &&
      evictions[0].itemId === 'quest_wood_board' &&
      evictions[0].crawler === 'human',
    'the eviction is reported on the bus with the crawler it happened to',
  );

  human.inventory.addItem('quest_blueprints', 1);
  check(
    evictions.length === 2 && evictions[1].itemId === 'quest_scythe',
    'addItem of a different quest item goes through the same eviction',
  );
  cat.inventory.addItem('quest_scythe', 1);
  check(evictions.length === 2, "one crawler's first quest item evicts nothing of the other's");

  stopForwarding();
  human.inventory.addItem('quest_wood_board', 1);
  check(evictions.length === 2, 'no eviction reaches a bus that has stopped forwarding');
}

// ── Phase events ─────────────────────────────────────────────────────────

function verifyPhaseEvents(): void {
  const state = createBriarHollowState();
  const bus = new EventBus();
  const started: string[] = [];
  const completed: string[] = [];
  const phases: BlueprintsQuestPhase[] = [];
  bus.on('questStarted', (event) => started.push(event.questId));
  bus.on('questCompleted', (event) => completed.push(event.questId));
  bus.on('blueprintsQuestPhaseChanged', (event) => phases.push(event.phase));

  moveBlueprintsPhase(state.blueprints, 'declined', bus);
  check(started.length === 0, 'declining starts nothing');
  moveBlueprintsPhase(state.blueprints, 'ask_wendell', bus);
  check(
    started.length === 1 && started[0] === BLUEPRINTS_QUEST_ID,
    'accepting starts the quest, so the Journal pins it',
  );
  moveBlueprintsPhase(state.blueprints, 'ask_merrit', bus);
  check(started.length === 1, 'a later step does not start it again');
  const moved = moveBlueprintsPhase(state.blueprints, 'ask_merrit', bus);
  const phasesMovedThrough = ['declined', 'ask_wendell', 'ask_merrit'].length;
  check(
    !moved && phases.length === phasesMovedThrough,
    'moving to the phase already held does nothing',
  );
  moveBlueprintsPhase(state.blueprints, 'complete', bus);
  check(
    completed.length === 1 && completed[0] === BLUEPRINTS_QUEST_ID,
    'reaching complete completes the quest',
  );
}

// ── Construction unlock ──────────────────────────────────────────────────

function learner(learned: boolean): { craftSkills: { isLearned: () => boolean } } {
  return { craftSkills: { isLearned: () => learned } };
}

function verifyConstructionUnlocked(): void {
  const unlocks = createBriarHollowState().unlocks;
  check(
    !constructionUnlocked([learner(true), learner(false)], unlocks),
    'Construction learned but no plans held is not unlocked',
  );
  unlocks.construction.push(...TIKKA_PLANS_UNLOCKS);
  check(
    !constructionUnlocked([learner(false), learner(false)], unlocks),
    'plans held but nobody taught is not unlocked',
  );
  check(
    constructionUnlocked([learner(false), learner(true)], unlocks),
    "either crawler's lesson plus the trebuchet plan unlocks it",
  );
}

// ── Sounds ───────────────────────────────────────────────────────────────

function verifySoundCues(): void {
  const preloaded = new Set<SoundId>([...SFX_GROUPS.universal, ...SFX_GROUPS.briarHollow]);
  for (const [cue, takes] of Object.entries(BLUEPRINTS_CUES)) {
    const ids: readonly SoundId[] = takes;
    const missing = ids.filter((id) => !preloaded.has(id));
    check(missing.length === 0, `cue ${cue} plays only preloaded sounds (${missing.join(', ')})`);
  }
}

// ── Dialog ───────────────────────────────────────────────────────────────

function verifyDialog(): void {
  const northWest = skyfowlTownWhereabouts({ x: 10, y: 10 }, { x: 0, y: 0 });
  check(
    northWest === 'the skyfowl town north west of here',
    `the town's bearing is lower-cased into Fenna's line ("${northWest}")`,
  );
  check(
    skyfowlTownWhereabouts(null, { x: 0, y: 0 }) === 'the skyfowl town past the road',
    'with no village centre, Fenna falls back to "past the road"',
  );
  const [accepted] = fennaAcceptedPages(northWest);
  check(
    accepted.paragraphs[0].endsWith(
      'He lives at Plumbline Farm, in the skyfowl town north west of here.',
    ),
    "Fenna's directions finish her sentence",
  );
  const carlVisit = wendellFirstVisitPages('carl');
  const donutVisit = wendellFirstVisitPages('donut');
  const speakerOf = (line: DialogLine): string =>
    line.speaker.kind === 'cast' ? line.speaker.id : line.speaker.name;
  check(
    speakerOf(carlVisit[0]) === 'carl' && speakerOf(donutVisit[0]) === 'donut',
    "the active crawler opens Wendell's first visit",
  );
  check(
    speakerOf(carlVisit[carlVisit.length - 1]) === 'carl' &&
      speakerOf(donutVisit[donutVisit.length - 1]) === 'carl',
    'Carl has the last word to Donut, whoever is active',
  );
  const [, afterPlea] = merritAskPages('donut', true);
  const [, beforePlea] = merritAskPages('donut', false);
  check(
    afterPlea !== beforePlea && speakerOf(afterPlea) === 'merrit',
    "Merrit's greeting follows the Plea's outcome",
  );
}

// ── Runner ───────────────────────────────────────────────────────────────

const SECTIONS: ReadonlyArray<{ readonly name: string; readonly run: () => void }> = [
  { name: 'Phase order', run: verifyPhaseOrder },
  { name: 'Persistence, old saves included', run: verifyPersistence },
  { name: 'Quest-line providers in priority order', run: verifyProviderOrder },
  { name: 'Quest-slot eviction', run: verifyEviction },
  { name: 'Phase events', run: verifyPhaseEvents },
  { name: 'Construction unlock', run: verifyConstructionUnlocked },
  { name: 'Sound cues', run: verifySoundCues },
  { name: 'Dialog assembly', run: verifyDialog },
  { name: "Fenna's marker", run: () => verifyFennaMarker(check) },
  { name: "Fenna's offer", run: () => verifyFennaOffer(check) },
  { name: "Fenna's decline and re-offer", run: () => verifyFennaDecline(check) },
  { name: "Fenna's journal row and minimap pip", run: () => verifyFennaJournal(check) },
  { name: "Wendell's marker", run: () => verifyWendellMarker(check) },
  { name: 'Fence sections', run: () => verifyFenceSections(check) },
  { name: 'Fence only in build_fence', run: () => verifyFenceOnlyInBuildStep(check) },
  { name: 'Fence section build', run: () => verifyFenceBuild(check) },
  { name: 'Fence tap', run: () => verifyFenceTap(check) },
  { name: 'Fence hammering', run: () => verifyFenceHammering(check) },
  { name: 'Fence hammering bed', run: () => verifyFenceWorkLoop(check) },
  { name: 'Fence cancel and refusal', run: () => verifyFenceCancelAndRefusal(check) },
  { name: 'Fence completion', run: () => verifyFenceCompletes(check) },
  { name: "Merrit's ask", run: () => verifyMerritAsk(check) },
  { name: "Merrit's fence report", run: () => verifyMerritFenceDone(check) },
  { name: "Merrit's grain and Midge's call", run: () => verifyMerritGrainAndCall(check) },
  { name: 'Merrit under siege', run: () => verifyMerritUnderSiege(check) },
  ...wendellSections(check),
  ...stationSections(check),
  ...harvestSections(check),
  ...stepMomentSections(check),
  ...evictionSections(check),
  ...agreementSections(check),
  ...escortRouteSections(check),
  { name: 'No friendly fire on Midge', run: () => verifyMidgeFriendlyFire(check) },
];

/** `--only=<text>` runs just the sections whose name contains it. */
const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
const onlyName = onlyArg === undefined ? null : onlyArg.slice('--only='.length);

for (const section of SECTIONS) {
  if (onlyName !== null && !section.name.includes(onlyName)) continue;
  console.log(`\n${section.name}`);
  section.run();
}

if (failures > 0) {
  console.error(`\nFAIL — ${failures} failing check(s)`);
  process.exit(1);
}
console.log('\nAll borrowed-blueprints checks passed.');
