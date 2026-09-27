#!/usr/bin/env tsx
/**
 * Headless playthrough of "Briar Hollow's Plea" on a real floor-3 map with the
 * whole village kit built as the scene builds it. Every conversation goes
 * through the Space chain's entry (`kit.tryInteract`) and the panel's own
 * number keys; every line shown is held to the verbatim table.
 *
 *   npm run verify:village-quest
 *
 * Steps: the Mayor's offer (declined, then accepted); Oren's tools, granted
 * as the conversation opens rather than through a topic; chopping wood then
 * mining stone; Tikka's plans and Construction; Fenna's saw and rope walk;
 * processing boards and rope; Tikka's plans handed over; the first trebuchet,
 * loading it, and the first wooden wall; the Mayor's summons and briefing; a
 * lost siege (the dead withdraw, the bell is mended, the Mayor's word sends
 * the party to repair the bell tower, which returns the quest to fortifying);
 * a won retry (the rest crumble, paying nothing); the turn-in (every reward
 * once; a second pays nothing). A checkpoint is round-tripped at every step,
 * and one taken mid-siege must come back as fortifying.
 *
 * Harvesting and wood processing have their own gates (`verify:harvest`,
 * `verify:village-services`); here the party's held resources are set
 * directly and the quest's answer to them is checked.
 */

import { installCanvasGlobals } from './nodeCanvasGlobals';
import { TILE_SIZE } from '../src/core/constants';
import {
  captureBriarHollowState,
  parseBriarHollowStateSnapshot,
  restoreBriarHollowState,
} from '../src/core/briarHollowState';
import type { VillageQuestPhase } from '../src/core/villageQuestPhase';
import type { Mob } from '../src/creatures/Mob';
import { Necromancer } from '../src/creatures/Necromancer';
import {
  line,
  type Circumstance,
  type VillagerId,
} from '../src/systems/briarHollow/ratkinDialogue';
import { HOLLOW_BELL_MAX_HP } from '../src/systems/briarHollow/hollowBell';
import { ASK_QUESTION_LABEL } from '../src/systems/briarHollow/villagerTopics';
import {
  ASSAULT_WAVE_COUNT,
  IMMINENT_FRAMES,
  type SiegeMusicClaim,
} from '../src/systems/briarHollow/VillageAssaultSystem';
import {
  BRIAR_HOLLOW_QUEST_COINS,
  BRIAR_HOLLOW_QUEST_ID,
  BRIAR_HOLLOW_REWARD_BURGERS,
  BRIAR_HOLLOW_REWARD_STEW,
  MAYOR_SHOUT_SUMMONS_SPEAKER,
  MAYOR_SHOUT_SUMMONS_TEXT,
  PROCESSING_BOARDS_TARGET,
  PROCESSING_DONE_LINE,
  PROCESSING_ROPE_TARGET,
  QUARRY_SPOTTED_LINE,
  STONE_TARGET,
  WOOD_TARGET,
} from '../src/systems/briarHollow/VillageQuestSystem';
import { TREBUCHET_BUILD_COST } from '../src/systems/briarHollow/structureRules';
import { buildSiegeRig, standAt } from './villageSiegeHarness';

installCanvasGlobals();

let failures = 0;
let checks = 0;

function check(ok: boolean, message: string): void {
  checks++;
  if (ok) {
    console.log(`  ok   ${message}`);
    return;
  }
  failures++;
  console.error(`  FAIL ${message}`);
}

function section(name: string): void {
  console.log(`\n${name}`);
}

const SEED = 7919;
const ASSAULT_LEVEL = 6;
const UPDATES_PER_SECOND = 60;
/** The request's numbers, written out so a drifted constant fails here. */
const REQUEST_IMMINENT_SECONDS = 45;
const REQUEST_BELL_HP = 120;
const REQUEST_COINS = 500;
const WOODEN_WALL_BOARDS = 5;
/** Enough stone to load a trebuchet from empty. */
const TREBUCHET_AMMO_LOADED = 1;
/** Clear of the gate itself, and within its footprint's build zones. */
const TREBUCHET_TEST_OFFSET_TILES = 4;
/** Long enough for the first wave to reach and chew the east wall. */
const FIRST_WAVE_SECONDS = 40;
/** Long enough for every withdrawal to end, released or timed out. */
const WITHDRAW_WAIT_SECONDS = 40;
/** Long enough for the staggered crumble to finish. */
const CRUMBLE_WAIT_SECONDS = 4;
/** How long the retry's last wave runs before the necromancer is struck down. */
const NECRO_WAVE_RUN_SECONDS = 6;
/** The longest a scripted wait may run before the gate calls it stuck. */
const STEP_LIMIT_SECONDS = 400;
const OVERKILL = 100_000;
/** How long the rebuilt scene is watched for a wave that should never come. */
const REBUILD_WATCH_SECONDS = 30;
/** How far into the countdown the scene is rebuilt round a door visit. */
const REBUILD_INTO_COUNTDOWN_SECONDS = 20;
/** How long into the assault the checkpoint is taken, with the first wave in the field. */
const CHECKPOINT_INTO_ASSAULT_SECONDS = 30;
/** Blasts enough to bring down any wall, however many one takes. */
const WALL_BLASTS_MAX = 20;

const rig = buildSiegeRig({ seed: SEED, assaultLevel: ASSAULT_LEVEL });
const { kit, human, cat, state, bus } = rig;
const villagers = kit.villagers;
const quest = kit.quest;
const assault = kit.assault;
const defences = kit.defences;
if (villagers === null || quest === null || assault === null || defences === null) {
  console.error('verify:village-quest FAILED: the kit built no village');
  process.exit(1);
}
const conversation = villagers.conversation;
// The questline is what is under test, not the party's survival: the siege
// may walk straight through the square where they stand and wait.
human.godMode = true;
cat.godMode = true;

// Every page the panel shows, in order.
const shown: string[] = [];
const showPages = conversation.showPages.bind(conversation);
conversation.showPages = (pages: readonly string[]) => {
  shown.push(...pages);
  showPages(pages);
};

// Every narrated line the questline queues outside a conversation — Carl or
// Donut's own beats, the Mayor's shout — in order.
const questLines: Array<{ speaker: string; text: string }> = [];
const showQuestLine = kit.showQuestLine.bind(kit);
kit.showQuestLine = (speaker: string, text: string, onClosed?: () => void) => {
  questLines.push({ speaker, text });
  showQuestLine(speaker, text, onClosed);
};

const events: Array<{ name: string; detail: string }> = [];
bus.on('questStarted', ({ questId }) => events.push({ name: 'questStarted', detail: questId }));
bus.on('questCompleted', ({ questId }) => events.push({ name: 'questCompleted', detail: questId }));
bus.on('villageQuestPhaseChanged', ({ phase }) => events.push({ name: 'phase', detail: phase }));
bus.on('villageAssaultWave', ({ index }) => events.push({ name: 'wave', detail: String(index) }));

function stepFrames(frames: number): void {
  for (let i = 0; i < frames; i++) rig.step();
}

function stepUntil(done: () => boolean, limitSeconds = STEP_LIMIT_SECONDS): boolean {
  for (let i = 0; i < limitSeconds * UPDATES_PER_SECOND; i++) {
    if (done()) return true;
    rig.step();
  }
  return done();
}

function expected(villager: VillagerId, circumstances: readonly Circumstance[]): string[] {
  return circumstances.map((c) => line(villager, c) ?? `<missing ${villager}:${c}>`);
}

/** Reads the conversation to its choices: skips the typing and turns every page. */
function readThrough(): void {
  // `update()` runs first so a one-sentence page that reveals in full the
  // instant it is shown gets the chance to flip to its choice row before
  // `advance()` ever sees a fully-revealed last page — which, with nothing
  // else pending, reads as "leave" and picks Goodbye out from under the
  // choices this same tick would otherwise have put up.
  for (let i = 0; i < 40 && conversation.isOpen && !conversation.isShowingChoices; i++) {
    conversation.update();
    if (!conversation.isOpen || conversation.isShowingChoices) break;
    conversation.advance();
  }
}

/** Walks up to a villager and presses Space. Returns the pages the conversation opened with. */
function talk(villager: VillagerId): string[] {
  const body = villagers?.villagerFor(villager) ?? null;
  if (body === null) return [];
  if (conversation.isOpen) villagers?.closeConversation();
  standAt(human, Math.round(body.x / TILE_SIZE), Math.round(body.y / TILE_SIZE));
  human.x = body.x;
  human.y = body.y;
  const before = shown.length;
  kit.tryInteract(human);
  readThrough();
  return shown.slice(before);
}

/**
 * Picks the choice labelled `label` by its number key. Returns the pages it
 * said. Lore rows live one level down, under "I have a question" — when
 * `label` is not on offer at the current level but that row is, this opens
 * it first (picking it says nothing, so `shown` is untouched) and looks again.
 */
function choose(label: string): string[] | null {
  let index = conversation.choiceLabels.indexOf(label);
  if (index < 0 && conversation.choiceLabels.includes(ASK_QUESTION_LABEL)) {
    if (choose(ASK_QUESTION_LABEL) === null) return null;
    index = conversation.choiceLabels.indexOf(label);
  }
  if (index < 0) return null;
  const before = shown.length;
  conversation.handleKeyDown(String(index + 1));
  readThrough();
  return shown.slice(before);
}

function same(actual: readonly string[] | null, wanted: readonly string[]): boolean {
  return (
    actual !== null && actual.length === wanted.length && actual.every((t, i) => t === wanted[i])
  );
}

/** A save or checkpoint of the village right now, as a reload would read it back. */
function roundTrippedPhase(): VillageQuestPhase | null {
  const snapshot = parseBriarHollowStateSnapshot(
    JSON.parse(JSON.stringify(captureBriarHollowState(state))),
  );
  return snapshot?.quest.phase ?? null;
}

function checkpointStep(label: string): void {
  const phase = state.quest.phase;
  const persisted = phase === 'imminent' || phase === 'assault' ? 'fortifying' : phase;
  check(
    roundTrippedPhase() === persisted,
    `${label}: a checkpoint round-trip reads back as "${persisted}" (live "${phase}")`,
  );
}

function objective(): string {
  return kit.trackerEntries()[0]?.objective ?? '<no journal row>';
}

function partyXp(): number {
  return (human.level + cat.level) * OVERKILL + human.xp + cat.xp;
}

// ── 1. The Mayor ──────────────────────────────────────────────────────────

section('1. The Mayor');
{
  check(
    objective() === `Speak with ${kit.recruiter?.post?.name} in the town square`,
    'before the Mayor has been met, the journal points at the recruiter',
  );
  rig.step();
  check(
    villagers.villagerFor('bramblewick')?.marker === 'exclamation',
    'the Mayor wears the ! before he is met',
  );
  const opening = talk('bramblewick');
  check(same(opening, expected('bramblewick', ['first_meeting'])), 'he opens with first_meeting');
  check(
    same(choose('About the village'), expected('bramblewick', ['ask_about_village'])),
    '"About the village" answers ask_about_village',
  );
  // A plain answer — one that neither opens a submenu nor moves back to the
  // root — is the conversation's last word: reading it closes the whole
  // talk, so asking about something else means talking to the Mayor again.
  check(!conversation.isOpen, 'and that answer ends the conversation');
  talk('bramblewick');
  check(
    same(choose('About the necromancer'), expected('bramblewick', ['ask_about_necromancer'])),
    '"About the necromancer" answers ask_about_necromancer',
  );
  check(!conversation.isOpen, 'and this answer ends the conversation too');
  talk('bramblewick');
  check(
    same(choose('How can we help?'), expected('bramblewick', ['quest_offer'])),
    '"How can we help?" makes the offer',
  );
  check(state.quest.phase === 'offered', 'the phase is offered');
  check(
    conversation.choiceLabels.includes('Accept') && conversation.choiceLabels.includes('Decline'),
    'Accept and Decline are on offer',
  );
  check(
    same(choose('Decline'), expected('bramblewick', ['quest_declined'])),
    'Decline answers quest_declined',
  );
  check(state.quest.phase === 'declined', 'the phase is declined');
  check(objective() === 'Speak with Mayor Bramblewick', 'the journal points back at the Mayor');
  checkpointStep('declined');
  choose('Goodbye');
  check(!conversation.isOpen, 'Goodbye closes the conversation');

  const again = talk('bramblewick');
  check(same(again, expected('bramblewick', ['quest_offer'])), 'talking again re-offers');
  check(
    same(choose('Accept'), expected('bramblewick', ['quest_accepted'])),
    'Accept answers quest_accepted',
  );
  check(state.quest.phase === 'need_tools', 'the phase is need_tools');
  check(
    events.some((e) => e.name === 'questStarted' && e.detail === BRIAR_HOLLOW_QUEST_ID),
    'questStarted is emitted',
  );
  check(quest.status === 'active', 'the quest is active');
  check(conversation.choiceLabels.length <= 9, 'the Mayor offers nine choices or fewer');
  checkpointStep('need_tools');
  choose('Goodbye');
}

// ── 2. Tools ──────────────────────────────────────────────────────────────

section('2. Tools');
{
  check(objective() === 'Get tools from Oren at the forge', 'the journal sends the party to Oren');
  check(same(talk('tikka'), expected('tikka', ['tools_required'])), 'Tikka says tools_required');
  choose('Goodbye');
  const opening = talk('oren');
  check(
    same(opening, expected('oren', ['grant_basic_tools'])),
    'Oren opens onto the grant, and only the grant — no lesson, no directions, no menu',
  );
  check(!conversation.isOpen, 'and the conversation closes on its own');
  check(
    human.inventory.countOf('basic_axe') === 1 && cat.inventory.countOf('basic_axe') === 1,
    'both crawlers carry the axe',
  );
  check(
    human.inventory.countOf('basic_pickaxe') === 1 && cat.inventory.countOf('basic_pickaxe') === 1,
    'both crawlers carry the pickaxe',
  );
  check(
    human.craftSkills.isLearned('resourcing') && cat.craftSkills.isLearned('resourcing'),
    'both crawlers learned Resourcing',
  );
  check(state.quest.phase === 'gather_wood', 'toolsGranted moved the phase to gather_wood');
  choose('Goodbye');
  check(
    rig.explainerOpens.get('resourcing') === 1,
    'the Resourcing explainer opened once the talk closed',
  );
  checkpointStep('gather_wood');
}

// ── 3. Wood, then stone ───────────────────────────────────────────────────

section('3. Wood, then stone');
{
  check(
    objective() === `Chop wood in the lumber yard — 0/${WOOD_TARGET}`,
    'the journal starts the wood count at nothing',
  );
  human.inventory.addItem('wood', WOOD_TARGET - 1);
  rig.step();
  check(
    objective() === `Chop wood in the lumber yard — ${WOOD_TARGET - 1}/${WOOD_TARGET}`,
    'the journal follows the wood held',
  );
  check(state.quest.phase === 'gather_wood', 'one short of the target, still chopping');
  human.inventory.addItem('wood', 1);
  rig.step();
  check(
    questLines.some((q) => q.text === QUARRY_SPOTTED_LINE),
    'the active crawler mentions the quarry once the wood target is held',
  );
  check(state.quest.phase === 'gather_stone', `${WOOD_TARGET} wood held moves on to the quarry`);
  check(
    objective() === `Mine stone in the quarry — 0/${STONE_TARGET}`,
    'the journal starts the stone count at nothing',
  );
  // Stone already in the packs counts with no mining at all.
  cat.inventory.addItem('stone', STONE_TARGET);
  rig.step();
  check(
    state.quest.phase === 'report_tikka',
    `${STONE_TARGET} stone held sends the party to Tikka`,
  );
  rig.step();
  check(villagers.villagerFor('tikka')?.marker === 'question', 'Tikka wears the ?');
  checkpointStep('report_tikka');
}

// ── 4. Report to Tikka ────────────────────────────────────────────────────

section('4. Report to Tikka');
{
  const pages = talk('tikka');
  check(
    same(
      pages,
      expected('tikka', ['tikka_plans_intro', 'tikka_send_to_fenna', 'tikka_needs_boards_rope']),
    ),
    'Tikka teases her plans and sends the party to Fenna',
  );
  check(!conversation.isOpen, 'and the conversation closes on its own, no menu after');
  check(
    human.craftSkills.isLearned('construction') && cat.craftSkills.isLearned('construction'),
    'both crawlers learned Construction, on the spot',
  );
  check(state.quest.phase === 'see_fenna', 'the phase is see_fenna');
  check(
    objective() === 'Ask Fenna for the saw and rope walk',
    'the journal sends the party to Fenna',
  );
  choose('Goodbye');
  check(
    rig.rewardCards.includes('Construction'),
    'the skill-unlocked card is queued once the talk closes',
  );
  checkpointStep('see_fenna');
}

// ── 5. Fenna, processing, and Tikka's plans ───────────────────────────────

section("5. Fenna, processing, and Tikka's plans");
{
  check(!state.unlocks.processingStations, 'the stations are still shut before Fenna is asked');
  const opening = talk('fenna');
  check(
    same(opening, expected('fenna', ['fenna_grants_access', 'fenna_explains_stations'])),
    'Fenna grants the saw and the rope walk',
  );
  check(
    !conversation.isOpen,
    'and the conversation closes on its own, no "How does the mill work?" after',
  );
  check(state.unlocks.processingStations, 'the stations unlock the moment she says so');
  check(state.quest.phase === 'processing', 'the phase is processing');
  choose('Goodbye');
  check(
    rig.explainerOpens.get('processing') === 1,
    'the Processing explainer opens once the talk closes',
  );
  human.inventory.addItem('wood_board', PROCESSING_BOARDS_TARGET - 1);
  rig.step();
  check(state.quest.phase === 'processing', 'one board short, still processing');
  human.inventory.addItem('wood_board', 1);
  human.inventory.addItem('rope', PROCESSING_ROPE_TARGET);
  rig.step();
  check(
    questLines.some((q) => q.text === PROCESSING_DONE_LINE),
    'the active crawler suggests heading back to Tikka once processing is done',
  );
  check(
    state.quest.phase === 'return_tikka',
    'boards and rope both met send the party back to Tikka',
  );
  checkpointStep('return_tikka');
  const plans = talk('tikka');
  check(
    same(plans, expected('tikka', ['tikka_materials_received', 'tikka_plans_handoff'])),
    'Tikka takes the materials and hands over her plans',
  );
  check(!conversation.isOpen, 'and the conversation closes on its own');
  check(
    rig.explainerOpens.get('construction') === 1,
    'the Construction explainer opens once the talk closes',
  );
  check(rig.crafts.explainersSeen.includes('construction'), 'and is recorded as seen');
  check(
    human.inventory.countOf('wood_board') === PROCESSING_BOARDS_TARGET &&
      human.inventory.countOf('rope') === PROCESSING_ROPE_TARGET,
    'the boards and rope are not spent — they are needed to build',
  );
  // The phase waits for the explainer to close before moving on; the test
  // harness closes it synchronously, so the next update sees it shut.
  rig.step();
  check(
    state.quest.phase === 'build_trebuchet',
    'the plans move the phase on to building a trebuchet',
  );
  checkpointStep('build_trebuchet');
}

// ── 6. A trebuchet, loading it, and a wooden wall ─────────────────────────

const eastSegment = rig.site.segments.find((segment) =>
  segment.tiles.every(
    (tile) => tile.x === rig.site.palisadeBounds.x + rig.site.palisadeBounds.w - 1,
  ),
);
section('6. A trebuchet, loading it, and a wooden wall');
{
  check(
    human.inventory.countOf('wood_board') >= (TREBUCHET_BUILD_COST.wood_board ?? 0) &&
      human.inventory.countOf('rope') >= (TREBUCHET_BUILD_COST.rope ?? 0),
    'the party already holds enough to build the first trebuchet',
  );
  const gate = rig.site.gate.inside;
  const trebuchetRef = defences.defense.placeTrebuchet(
    gate.x - TREBUCHET_TEST_OFFSET_TILES,
    gate.y - TREBUCHET_TEST_OFFSET_TILES,
    'human',
  );
  rig.step();
  check(state.quest.phase === 'load_trebuchet', 'a trebuchet in the field moves on to loading it');
  const record =
    trebuchetRef.kind === 'trebuchet' ? defences.defense.trebuchet(trebuchetRef.key) : null;
  check(record !== null, 'the trebuchet has a record to load');
  if (record !== null) record.ammo = TREBUCHET_AMMO_LOADED;
  rig.step();
  check(state.quest.phase === 'build_wall', 'loaded ammunition moves on to the wall');
  check(eastSegment !== undefined, 'the east wall has a segment to build on');
  if (eastSegment !== undefined) {
    defences.defense.applyUpgrade({ kind: 'segment', id: eastSegment.id }, 'human');
    check(defences.defense.segmentTier(eastSegment.id) === 'wood', 'the segment is a wooden wall');
  }
  rig.step();
  check(
    questLines.some(
      (q) => q.speaker === MAYOR_SHOUT_SUMMONS_SPEAKER && q.text === MAYOR_SHOUT_SUMMONS_TEXT,
    ),
    'the Mayor shouts his summons once a wooden wall stands',
  );
  check(state.quest.phase === 'summoned_by_mayor', 'a wooden wall summons the party to the Mayor');
  checkpointStep('summoned_by_mayor');
}

// ── 7. Summoned by the Mayor, and the countdown ───────────────────────────

section('7. Summoned by the Mayor, and the countdown');
{
  check(!state.unlocks.soldierCommands, "the militia is still not under the party's command");
  const briefing = talk('bramblewick');
  check(
    same(
      briefing,
      expected('bramblewick', [
        'mayor_briefing_reason',
        'mayor_briefing_scouts',
        'mayor_briefing_life_stone',
        'mayor_briefing_threat',
        'mayor_briefing_command',
      ]),
    ),
    'the Mayor briefs the party and places the militia under their command',
  );
  check(
    !conversation.isOpen,
    'and the conversation closes on its own, not onto the fortifying choices yet',
  );
  check(state.unlocks.soldierCommands, 'soldierCommands unlocks the moment he says so');
  check(state.quest.phase === 'fortifying', 'the phase is fortifying');
  choose('Goodbye');
  checkpointStep('fortifying');

  talk('bramblewick');
  check(
    conversation.choiceLabels[0] === 'I need more time',
    '"I need more time" is the first row, so Space picks it',
  );
  check(
    same(choose('I need more time'), expected('bramblewick', ['mayor_more_time_granted'])),
    'and he grants it',
  );
  choose('Goodbye');

  talk('bramblewick');
  check(!conversation.choiceLabels.includes("We're ready."), 'the old "We\'re ready." row is gone');
  choose("I'm ready");
  check(!conversation.isOpen, 'choosing it closes the conversation and starts the siege directly');
  check(state.quest.phase === 'imminent', '"I\'m ready for the assault" starts the countdown');
  check(
    state.quest.imminentCountdownFrames === REQUEST_IMMINENT_SECONDS * UPDATES_PER_SECOND &&
      IMMINENT_FRAMES === REQUEST_IMMINENT_SECONDS * UPDATES_PER_SECOND,
    `${REQUEST_IMMINENT_SECONDS} seconds of it`,
  );
  check(kit.ambience.noticeBoard.callToArms, 'the call to arms goes up on the notice board');
  checkpointStep('imminent');
  standAt(human, rig.site.square.bellTile.x, rig.site.square.bellTile.y + 3);
  stepFrames(IMMINENT_FRAMES - 1);
  check(state.quest.phase === 'imminent', 'still counting down a frame before the end');
  check(kit.ambience.bell.ringing, 'the bell rings through the countdown');
  rig.step();
  check(state.quest.phase === 'assault', 'the assault starts when the countdown is up');
  check(
    events.some((e) => e.name === 'wave' && e.detail === '0'),
    'villageAssaultWave announces the first wave',
  );
  checkpointStep('assault');
}

// ── 8. A lost siege ───────────────────────────────────────────────────────

let breachedBeforeRetry = 0;
section('8. A lost siege');
{
  stepFrames(FIRST_WAVE_SECONDS * UPDATES_PER_SECOND);
  check(assault.spawnedTotal > 0, `the first wave came (${assault.spawnedTotal} spawned)`);
  const structuresBefore = JSON.stringify(state.structures);
  // Blow after blow until it gives: one blow may only take so much of the bell.
  for (let blow = 0; blow < REQUEST_BELL_HP && !defences.defense.bellCracked; blow++) {
    defences.defense.damage({ kind: 'bell' }, REQUEST_BELL_HP, null, 'melee');
  }
  check(HOLLOW_BELL_MAX_HP === REQUEST_BELL_HP, `the bell has ${REQUEST_BELL_HP} health`);
  rig.step();
  check(state.quest.phase === 'repelled_failed', 'the bell at zero loses the siege');
  check(state.quest.bellHp === REQUEST_BELL_HP, 'the villagers restore the bell');
  check(kit.ambience.bell.cracked, 'the bell hangs cracked for a while');
  check(JSON.stringify(state.structures) === structuresBefore, 'the damage to the walls stays');
  check(assault.withdrawingCount > 0, `the dead turn to withdraw (${assault.withdrawingCount})`);
  stepUntil(() => assault.withdrawingCount === 0, WITHDRAW_WAIT_SECONDS);
  const standing = rig.world.roster.mobs.filter(
    (mob) => mob.isAlive && mob.isHostile && mob.siegeCapable !== null,
  );
  check(standing.length === 0, 'every withdrawing undead is released');
  check(!kit.ambience.noticeBoard.callToArms, 'the poster comes down');
  check(state.quest.lastSiege !== null, 'the siege recorded its damage');
  breachedBeforeRetry = state.quest.lastSiege?.segmentsBreached ?? 0;
  check(objective() === 'Speak with Mayor Bramblewick', 'the journal sends the party to the Mayor');
  checkpointStep('repelled_failed');
  const words = talk('bramblewick');
  check(
    same(words, expected('bramblewick', ['mayor_loss_unprepared', 'mayor_loss_facsimile'])),
    'the Mayor explains the facsimile bought them time',
  );
  check(!conversation.isOpen, 'and the conversation closes on its own');
  check(state.quest.phase === 'repair_bell', 'and the quest moves on to repairing the bell tower');
  check(objective() === 'Repair the bell tower', 'the journal now asks for the bell tower');
  choose('Goodbye');
  checkpointStep('repair_bell');
  // The bell tower's own repair action belongs to a different system; here
  // only the questline's answer to it is under test — so the repair's other
  // effect (standing the tower back up) is simulated alongside the event a
  // real repair would raise once it finishes.
  state.quest.bellTowerBroken = false;
  bus.emit('bellTowerRepaired', {});
  check(
    state.quest.phase === 'fortifying',
    'a repaired bell tower returns the quest to fortifying',
  );
  console.log(`  ..   segments breached in the lost siege: ${breachedBeforeRetry}`);
}

// ── 9. A won retry, and the turn-in ───────────────────────────────────────

section('9. The retry and the turn-in');
{
  // A wall breached in the first siege is knocked down again here on
  // purpose, so the repair below never rides on where that siege happened to
  // break through.
  if (eastSegment !== undefined) {
    const ref = { kind: 'segment', id: eastSegment.id } as const;
    for (
      let blast = 0;
      blast < WALL_BLASTS_MAX && defences.defense.segmentTier(eastSegment.id) !== 'breach';
      blast++
    ) {
      defences.defense.damage(ref, OVERKILL, null, 'blast');
    }
    check(defences.defense.segmentTier(eastSegment.id) === 'breach', 'the only wall is breached');
    human.inventory.addItem('wood_board', WOODEN_WALL_BOARDS);
    const tile = eastSegment.tiles[0];
    standAt(human, tile.x - 1, tile.y);
    check(defences.construction.startRepair(ref), 'the breach can be repaired');
    stepUntil(() => defences.construction.job === null);
    check(defences.defense.segmentTier(eastSegment.id) === 'wood', 'the wooden wall stands again');
  }
  talk('bramblewick');
  choose("I'm ready");
  check(state.quest.phase === 'imminent', 'the siege can be tried again');
  const introsBeforeRetry = rig.bossIntros;
  stepUntil(() => state.quest.phase === 'assault', REQUEST_IMMINENT_SECONDS + 1);
  const killedEarly = new Set<Mob>();
  const beatenEarly = new Set<Necromancer>();
  const killEvents = new Set<Mob>();
  bus.on('mobKilled', ({ mob }) => killEvents.add(mob));
  const lastWaveIndex = ASSAULT_WAVE_COUNT - 1;
  // Clear every body the earlier waves send, as soon as it is out, and beat
  // down the necromancer who leads each, until he comes with the last.
  const reachedNecro = stepUntil(() => {
    for (const mob of rig.world.roster.mobs) {
      if (!mob.isAlive || !mob.isHostile || mob.siegeCapable === null) continue;
      if (mob instanceof Necromancer) {
        if (state.quest.assaultWaveIndex === lastWaveIndex) return true;
        if (!mob.isFadingAway) mob.takeDamageFrom(OVERKILL, human, 'melee');
        beatenEarly.add(mob);
        continue;
      }
      mob.takeDamageFrom(OVERKILL, human, 'melee');
      killedEarly.add(mob);
    }
    return false;
  });
  check(reachedNecro, 'the necromancer leads the last wave');
  check(
    beatenEarly.size === lastWaveIndex,
    `he led every wave before it too (${beatenEarly.size} of ${lastWaveIndex})`,
  );
  check(
    [...beatenEarly].every((early) => !early.isAlive && !killEvents.has(early)),
    'beaten in those, he faded away rather than dying',
  );
  check(
    rig.bossIntros - introsBeforeRetry === 1,
    'his boss intro plays once in the siege, when he first comes',
  );
  stepFrames(NECRO_WAVE_RUN_SECONDS * UPDATES_PER_SECOND);
  const necro = assault.activeNecromancer;
  check(necro !== null, 'he is in the field');
  const living = rig.world.roster.mobs.filter(
    (mob) => mob.isAlive && mob.isHostile && mob.siegeCapable !== null && mob !== necro,
  );
  check(living.length > 0, `the rest of his wave is still standing (${living.length})`);
  const killed = new Set<Mob>();
  bus.on('mobKilled', ({ mob }) => killed.add(mob));
  necro?.takeDamageFrom(OVERKILL, human, 'melee');
  rig.step();
  rig.step();
  check(state.quest.phase === 'victory', 'his death wins the siege');
  const xpAfterKill = partyXp();
  const coinsAfterKill = human.coins + cat.coins;
  stepFrames(CRUMBLE_WAIT_SECONDS * UPDATES_PER_SECOND);
  check(
    living.every((mob) => !mob.isAlive),
    'every undead left standing crumbles',
  );
  check(
    living.every((mob) => !killed.has(mob)),
    'no crumbled undead raised a kill event',
  );
  check(partyXp() === xpAfterKill, 'the crumbling paid no XP');
  check(human.coins + cat.coins === coinsAfterKill, 'and dropped no coin into anyone’s purse');
  check(state.quest.bellHp === REQUEST_BELL_HP, 'the bell is whole');
  checkpointStep('victory');

  const coinsBefore = human.coins;
  const burgersBefore = human.inventory.countOf('hamburger');
  const stewBefore = human.inventory.countOf('hollow_stew');
  const xpBefore = partyXp();
  const siege = state.quest.lastSiege;
  const damaged =
    siege !== null && siege.segmentsBreached + siege.structuresDestroyed + siege.soldiersDowned > 0;
  const thanks = talk('bramblewick');
  const wanted: Circumstance[] = damaged
    ? ['after_victory', 'after_village_damage', 'quest_complete']
    : ['after_victory', 'quest_complete'];
  check(
    same(thanks, expected('bramblewick', wanted)),
    `the Mayor thanks them (${wanted.join(' → ')})`,
  );
  check(state.quest.phase === 'complete', 'the quest is complete');
  check(quest.status === 'completed', 'the quest manager agrees');
  check(human.coins - coinsBefore === REQUEST_COINS, `the purse pays ${REQUEST_COINS} coins`);
  check(BRIAR_HOLLOW_QUEST_COINS === REQUEST_COINS, 'the purse is the request’s 500');
  check(
    human.inventory.countOf('hamburger') - burgersBefore === BRIAR_HOLLOW_REWARD_BURGERS,
    `${BRIAR_HOLLOW_REWARD_BURGERS} hamburgers`,
  );
  check(
    human.inventory.countOf('hollow_stew') - stewBefore === BRIAR_HOLLOW_REWARD_STEW,
    `${BRIAR_HOLLOW_REWARD_STEW} Hollow Stew`,
  );
  check(partyXp() > xpBefore, 'the quest XP is paid');
  check(
    events.filter((e) => e.name === 'questCompleted' && e.detail === BRIAR_HOLLOW_QUEST_ID)
      .length === 1,
    'questCompleted is emitted once',
  );
  choose('Goodbye');
  check(rig.rewardCards.length >= 2, 'the reward cards are shown once the conversation closes');

  const coinsAfter = human.coins;
  const xpAfter = partyXp();
  const burgersAfter = human.inventory.countOf('hamburger');
  talk('bramblewick');
  choose('Goodbye');
  talk('bramblewick');
  choose('Goodbye');
  check(
    human.coins === coinsAfter &&
      partyXp() === xpAfter &&
      human.inventory.countOf('hamburger') === burgersAfter,
    'turning in again pays nothing',
  );
  check(
    events.filter((e) => e.name === 'questCompleted').length === 1,
    'and raises no second questCompleted',
  );
  check(kit.trackerEntries()[0]?.status === 'completed', 'the journal marks it done');
  check(kit.trackerEntries()[0]?.target === undefined, 'with nowhere left to point');
  checkpointStep('complete');
}

rig.dispose();

// ── 10. A scene rebuilt mid-siege ──────────────────────────────────────────

section('10. A scene rebuilt in the middle of the siege');
{
  // A door visit rebuilds the scene; the wave in the field is not carried
  // through the door, so the siege must be settled as lost, not resumed.
  const first = buildSiegeRig({ seed: SEED, assaultLevel: ASSAULT_LEVEL });
  first.state.quest.phase = 'fortifying';
  first.kit.assault?.begin();
  for (let i = 0; i < IMMINENT_FRAMES + UPDATES_PER_SECOND * 2; i++) first.step();
  const firstPhase = (): VillageQuestPhase => first.state.quest.phase;
  check(firstPhase() === 'assault', 'the first scene is in the assault');
  first.dispose();
  const rebuilt = buildSiegeRig({ seed: SEED, assaultLevel: ASSAULT_LEVEL, state: first.state });
  let wavesAfter = 0;
  rebuilt.bus.on('villageAssaultWave', () => wavesAfter++);
  check(
    rebuilt.state.quest.phase === 'repelled_failed',
    `the rebuilt scene settles the siege as lost (phase "${rebuilt.state.quest.phase}")`,
  );
  for (let i = 0; i < UPDATES_PER_SECOND * REBUILD_WATCH_SECONDS; i++) rebuilt.step();
  const undead = rebuilt.world.roster.mobs.filter(
    (mob) => mob.isAlive && mob.isHostile && mob.siegeCapable !== null,
  ).length;
  check(
    wavesAfter === 0 && undead === 0,
    `and no wave follows (${wavesAfter} waves, ${undead} undead)`,
  );
  check(rebuilt.state.quest.bellHp === REQUEST_BELL_HP, 'the bell is whole');
  rebuilt.dispose();
}
{
  // Rebuilt mid-countdown, the siege carries on: the same frames left, the
  // assault on schedule, and the siege track held against a music system
  // built after the siege's dressing went up.
  const first = buildSiegeRig({ seed: SEED, assaultLevel: ASSAULT_LEVEL });
  first.state.quest.phase = 'fortifying';
  first.kit.assault?.begin();
  for (let i = 0; i < UPDATES_PER_SECOND * REBUILD_INTO_COUNTDOWN_SECONDS; i++) first.step();
  const framesLeft = first.state.quest.imminentCountdownFrames;
  first.dispose();
  const music: { current: SiegeMusicClaim | null } = { current: null };
  const rebuilt = buildSiegeRig({
    seed: SEED,
    assaultLevel: ASSAULT_LEVEL,
    state: first.state,
    music: () => music.current,
  });
  const phaseNow = (): VillageQuestPhase => rebuilt.state.quest.phase;
  check(
    phaseNow() === 'imminent' && rebuilt.state.quest.imminentCountdownFrames === framesLeft,
    `a scene rebuilt mid-countdown keeps it: "${phaseNow()}", ${rebuilt.state.quest.imminentCountdownFrames} of ${framesLeft} frames left`,
  );
  const stub: SiegeMusicClaim = { battleMusicActive: false, reset: () => undefined };
  music.current = stub;
  rebuilt.step();
  check(stub.battleMusicActive, 'the siege track is held by a music system built after it');
  for (let i = 1; i < framesLeft - 1; i++) rebuilt.step();
  const stillCounting = phaseNow() === 'imminent';
  rebuilt.step();
  rebuilt.step();
  check(
    stillCounting && phaseNow() === 'assault',
    `and the assault starts on schedule (${stillCounting ? 'counting' : 'early'}, then "${phaseNow()}")`,
  );
  rebuilt.dispose();
}
{
  // A checkpoint taken mid-assault is a village fortifying: rewound to it,
  // no undead of that siege is left standing in the field.
  const live = buildSiegeRig({ seed: SEED, assaultLevel: ASSAULT_LEVEL });
  live.state.quest.phase = 'fortifying';
  live.kit.assault?.begin();
  const toCheckpoint = IMMINENT_FRAMES + UPDATES_PER_SECOND * CHECKPOINT_INTO_ASSAULT_SECONDS;
  for (let i = 0; i < toCheckpoint; i++) live.step();
  const siegeUndead = (): number =>
    live.world.roster.mobs.filter(
      (mob) => mob.isAlive && mob.isHostile && mob.siegeCapable !== null,
    ).length;
  const inField = siegeUndead();
  const snapshot = captureBriarHollowState(live.state);
  const kitCheckpoint = live.kit.captureCheckpoint();
  restoreBriarHollowState(live.state, snapshot);
  live.kit.restoreCheckpoint(kitCheckpoint);
  check(
    inField > 0 && siegeUndead() === 0,
    `rewound to a checkpoint taken mid-assault, no undead stands (${inField} before, ${siegeUndead()} after)`,
  );
  live.dispose();
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`verify:village-quest FAILED (${failures})`);
  process.exit(1);
}
console.log('verify:village-quest passed');
