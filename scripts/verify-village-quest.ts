#!/usr/bin/env tsx
/**
 * Headless playthrough of "Briar Hollow's Plea" on a real floor-3 map with the
 * whole village kit built as the scene builds it. Every conversation goes
 * through the Space chain's entry (`kit.tryInteract`) and the panel's own
 * number keys; every line shown is held to the verbatim table.
 *
 *   npm run verify:village-quest
 *
 * Steps: the Mayor's offer (declined, then accepted); Tikka and Oren; the
 * gathering tasks with the journal after each; Construction from Tikka; a
 * wooden wall and "We're ready."; the ninety-second countdown; a lost siege
 * (the dead withdraw, the bell is mended, the damage stays, the Mayor's word
 * returns the quest to fortifying); a won retry (the rest crumble, paying
 * nothing); the turn-in (every reward once; a second pays nothing). A
 * checkpoint is round-tripped at every step, and one taken mid-siege must
 * come back as fortifying.
 *
 * Harvesting and wood processing have their own gates (`verify:harvest`,
 * `verify:village-services`); here the party's stock is filled and the events
 * those systems raise are raised, and the quest's answer to them is checked.
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
import {
  IMMINENT_FRAMES,
  type SiegeMusicClaim,
} from '../src/systems/briarHollow/VillageAssaultSystem';
import {
  BRIAR_HOLLOW_QUEST_COINS,
  BRIAR_HOLLOW_QUEST_ID,
  BRIAR_HOLLOW_REWARD_BURGERS,
  BRIAR_HOLLOW_REWARD_STEW,
} from '../src/systems/briarHollow/VillageQuestSystem';
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
const REQUEST_IMMINENT_SECONDS = 90;
const REQUEST_BELL_HP = 600;
const REQUEST_COINS = 500;
const REQUEST_TIKKA_WOOD = 10;
const REQUEST_TIKKA_STONE = 10;
const REQUEST_BOARDS = 1;
const REQUEST_ROPE = 1;
const WOODEN_WALL_BOARDS = 5;
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
  for (let i = 0; i < 40 && conversation.isOpen && !conversation.isShowingChoices; i++) {
    conversation.advance();
    conversation.update();
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

/** Picks the choice labelled `label` by its number key. Returns the pages it said. */
function choose(label: string): string[] | null {
  const index = conversation.choiceLabels.indexOf(label);
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
  check(kit.trackerEntries().length === 0, 'no journal row before the Mayor has been met');
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
  check(
    same(choose('About the necromancer'), expected('bramblewick', ['ask_about_necromancer'])),
    '"About the necromancer" answers ask_about_necromancer',
  );
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

// ── 2. Tikka and Oren ─────────────────────────────────────────────────────

section('2. Tikka and Oren');
{
  check(objective() === 'Get tools from Oren at the forge', 'the journal sends the party to Oren');
  check(same(talk('tikka'), expected('tikka', ['tools_required'])), 'Tikka says tools_required');
  choose('Goodbye');
  talk('oren');
  const tools = choose('Tools');
  check(tools !== null, 'Oren offers "Tools"');
  choose('Goodbye');
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
  check(rig.explainerOpens.get('resourcing') === 1, 'the Resourcing explainer opened once');
  check(state.quest.phase === 'gathering', 'toolsGranted moved the phase to gathering');
  checkpointStep('gathering');
}

// ── 3. Gathering ──────────────────────────────────────────────────────────

section('3. Gathering');
{
  const wantedObjective = (w: number, s: number, b: number, r: number): string =>
    `Gather for Tikka — Wood ${w}/${REQUEST_TIKKA_WOOD} · Stone ${s}/${REQUEST_TIKKA_STONE} · ` +
    `Boards ${b}/${REQUEST_BOARDS} · Rope ${r}/${REQUEST_ROPE}`;
  check(objective() === wantedObjective(0, 0, 0, 0), 'the journal starts every task at nothing');
  check(same(talk('tikka'), expected('tikka', ['axe_task'])), 'Tikka sets the axe task first');
  choose('Goodbye');
  for (let chop = 1; chop <= REQUEST_TIKKA_WOOD; chop++) {
    human.inventory.addItem('wood', 1);
    bus.emit('resourceHarvested', { id: 'wood', amount: 1, byThrall: false, x: 0, y: 0 });
    if (objective() !== wantedObjective(chop, 0, 0, 0)) {
      check(false, `the journal follows the wood at ${chop}`);
    }
  }
  check(objective() === wantedObjective(REQUEST_TIKKA_WOOD, 0, 0, 0), 'ten wood chopped');
  // Gathered wood still counts once it has been spent: the chopping happened.
  human.inventory.removeItems('wood', REQUEST_TIKKA_WOOD);
  check(
    objective() === wantedObjective(REQUEST_TIKKA_WOOD, 0, 0, 0),
    'the chopped wood still counts once it has been spent',
  );
  check(same(talk('tikka'), expected('tikka', ['pickaxe_task'])), 'then the pickaxe task');
  choose('Goodbye');
  // Stone already in the packs counts with no mining at all.
  cat.inventory.addItem('stone', REQUEST_TIKKA_STONE);
  check(
    objective() === wantedObjective(REQUEST_TIKKA_WOOD, REQUEST_TIKKA_STONE, 0, 0),
    'ten stone already held counts, with nothing mined',
  );
  check(state.quest.gathering.stoneMined === 0, 'and nothing was counted as mined');
  check(same(talk('tikka'), expected('tikka', ['wood_processing_task'])), 'then processing');
  choose('Goodbye');
  human.inventory.addItem('wood_board', 2);
  bus.emit('woodProcessed', { output: 'boards', count: 2, woodSpent: 1, via: 'manual' });
  check(
    objective() === wantedObjective(REQUEST_TIKKA_WOOD, REQUEST_TIKKA_STONE, 1, 0),
    'a board sawn',
  );
  // Rope bought or found counts as well as rope twisted.
  human.inventory.addItem('rope', 1);
  check(objective() === 'Report to Tikka', 'every task done: the journal sends the party to Tikka');
  rig.step();
  check(villagers.villagerFor('tikka')?.marker === 'question', 'Tikka wears the ?');
  checkpointStep('gathering done');
}

// ── 4. Construction ───────────────────────────────────────────────────────

section('4. Construction');
{
  const pages = talk('tikka');
  check(
    same(
      pages,
      expected('tikka', [
        'construction_explanation',
        'construction_skill_granted',
        'construction_tutorial_trigger',
        'wooden_wall_explanation',
      ]),
    ),
    'Tikka explains and teaches Construction',
  );
  check(
    human.craftSkills.isLearned('construction') && cat.craftSkills.isLearned('construction'),
    'both crawlers learned Construction',
  );
  check(state.quest.phase === 'fortifying', 'the phase is fortifying');
  check(!rig.explainerOpens.has('construction'), 'the explainer waits for the conversation');
  choose('Goodbye');
  check(rig.explainerOpens.get('construction') === 1, 'and opens once it closes');
  check(rig.crafts.explainersSeen.includes('construction'), 'and is recorded as seen');
  const teachAgain = talk('tikka');
  check(
    same(teachAgain, expected('tikka', ['construction_skill_already_granted'])),
    'Tikka then says construction_skill_already_granted',
  );
  choose('Goodbye');
  check(
    same(talk('bramblewick'), expected('bramblewick', ['construction_unlocked'])),
    'the Mayor hears construction is unlocked',
  );
  check(!conversation.choiceLabels.includes("We're ready."), 'no "We\'re ready." without a wall');
  choose('Goodbye');
  checkpointStep('fortifying');
}

// ── 5. A wooden wall ──────────────────────────────────────────────────────

const eastSegment = rig.site.segments.find((segment) =>
  segment.tiles.every(
    (tile) => tile.x === rig.site.palisadeBounds.x + rig.site.palisadeBounds.w - 1,
  ),
);
section('5. A wooden wall');
{
  check(eastSegment !== undefined, 'the east wall has a segment to build on');
  if (eastSegment !== undefined) {
    human.inventory.addItem('wood_board', WOODEN_WALL_BOARDS);
    const tile = eastSegment.tiles[0];
    standAt(human, tile.x - 1, tile.y);
    const started = defences.construction.startUpgrade({ kind: 'segment', id: eastSegment.id });
    check(started, 'the upgrade starts');
    stepUntil(() => defences.construction.job === null);
    check(defences.defense.segmentTier(eastSegment.id) === 'wood', 'the segment is a wooden wall');
  }
  const opening = talk('bramblewick');
  check(
    same(opening, expected('bramblewick', ['fortifications_started'])),
    'the Mayor says fortifications_started',
  );
  check(conversation.choiceLabels.includes("We're ready."), '"We\'re ready." is on offer');
  check(
    objective().startsWith('Fortify Briar Hollow — 1 wooden · 0 stone'),
    'the journal counts the wall',
  );
}

// ── 6. "We're ready." and the countdown ───────────────────────────────────

section('6. The countdown');
{
  choose("We're ready.");
  check(!conversation.isOpen, 'the conversation closes');
  check(quest.isConfirmOpen, 'the confirm modal is up');
  check(kit.haltsWorldItself, 'and it is the kit halting the world');
  kit.handleKeyDown('Escape');
  check(!quest.isConfirmOpen && state.quest.phase === 'fortifying', '"Not yet" changes nothing');
  talk('bramblewick');
  choose("We're ready.");
  kit.handleKeyDown('Enter');
  check(state.quest.phase === 'imminent', '"Begin" starts the countdown');
  check(
    state.quest.imminentCountdownFrames === REQUEST_IMMINENT_SECONDS * UPDATES_PER_SECOND &&
      IMMINENT_FRAMES === REQUEST_IMMINENT_SECONDS * UPDATES_PER_SECOND,
    'ninety seconds of it',
  );
  check(kit.ambience.noticeBoard.callToArms, 'the call to arms goes up on the notice board');
  checkpointStep('imminent');
  standAt(human, rig.site.square.bellTile.x, rig.site.square.bellTile.y + 3);
  stepFrames(IMMINENT_FRAMES - 1);
  check(state.quest.phase === 'imminent', 'still counting down a frame before the end');
  check(kit.ambience.bell.ringing, 'the bell rings through the countdown');
  rig.step();
  check(state.quest.phase === 'assault', 'the assault starts when the ninety seconds are up');
  check(
    events.some((e) => e.name === 'wave' && e.detail === '0'),
    'villageAssaultWave announces the first wave',
  );
  checkpointStep('assault');
}

// ── 7. A lost siege ───────────────────────────────────────────────────────

let breachedBeforeRetry = 0;
section('7. A lost siege');
{
  stepFrames(FIRST_WAVE_SECONDS * UPDATES_PER_SECOND);
  check(assault.spawnedTotal > 0, `the first wave came (${assault.spawnedTotal} spawned)`);
  const structuresBefore = JSON.stringify(state.structures);
  // Blow after blow until it gives: one blow may only take so much of the bell.
  for (let blow = 0; blow < REQUEST_BELL_HP && !defences.defense.bellCracked; blow++) {
    defences.defense.damage({ kind: 'bell' }, REQUEST_BELL_HP, null, 'melee');
  }
  check(HOLLOW_BELL_MAX_HP === REQUEST_BELL_HP, 'the bell has 600 health');
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
  check(
    objective() === 'The bell fell. Speak with Mayor Bramblewick.',
    'the journal sends the party to the Mayor',
  );
  checkpointStep('repelled_failed');
  const words = talk('bramblewick');
  check(
    same(words, expected('bramblewick', ['after_village_damage'])),
    'the Mayor says after_village_damage',
  );
  check(state.quest.phase === 'fortifying', 'and the quest returns to fortifying');
  choose('Goodbye');
  console.log(`  ..   segments breached in the lost siege: ${breachedBeforeRetry}`);
}

// ── 8. A won retry, and the turn-in ───────────────────────────────────────

section('8. The retry and the turn-in');
{
  // A breached wall is no wall: the Mayor will not hear "We're ready" until
  // one stands again. The only wall is knocked down here on purpose, so the
  // check never rides on where the siege happened to break through.
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
    talk('bramblewick');
    check(
      !conversation.choiceLabels.includes("We're ready."),
      'with the only wall breached, "We\'re ready." is withdrawn',
    );
    choose('Goodbye');
    human.inventory.addItem('wood_board', WOODEN_WALL_BOARDS);
    const tile = eastSegment.tiles[0];
    standAt(human, tile.x - 1, tile.y);
    check(defences.construction.startRepair(ref), 'the breach can be repaired');
    stepUntil(() => defences.construction.job === null);
    check(defences.defense.segmentTier(eastSegment.id) === 'wood', 'the wooden wall stands again');
  }
  talk('bramblewick');
  choose("We're ready.");
  kit.handleKeyDown('Enter');
  check(state.quest.phase === 'imminent', 'the siege can be tried again');
  stepUntil(() => state.quest.phase === 'assault', REQUEST_IMMINENT_SECONDS + 1);
  const killedEarly = new Set<Mob>();
  // Clear every body the first two waves send, as soon as it is out, until the necromancer comes.
  const reachedNecro = stepUntil(() => {
    for (const mob of rig.world.roster.mobs) {
      if (!mob.isAlive || !mob.isHostile || mob.siegeCapable === null) continue;
      if (mob instanceof Necromancer) return true;
      mob.takeDamageFrom(OVERKILL, human, 'melee');
      killedEarly.add(mob);
    }
    return false;
  });
  check(reachedNecro, 'the necromancer arrives with the last wave');
  check(rig.bossIntros === 1, 'his boss intro plays');
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

// ── 9. A scene rebuilt mid-siege ──────────────────────────────────────────

section('9. A scene rebuilt in the middle of the siege');
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
