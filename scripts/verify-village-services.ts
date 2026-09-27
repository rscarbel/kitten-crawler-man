#!/usr/bin/env tsx
/**
 * Headless gate on Briar Hollow's services, run against a real floor-3
 * `GameMap` with the village on it: Pipkin's prices and purchases, Sella's
 * fee and treatment, Vetch's stock, Oren's grant, lesson and upgrades, the
 * sawmill's two machines, Fenna's bulk processing, and every counter but the
 * infirmary shutting for the siege.
 *
 * The expected numbers are written out here from the request's wording, not
 * imported from the modules under test, so a rule that drifts fails rather
 * than agreeing with itself.
 *
 *   npm run verify:village-services [-- --fault=charge-first|buyer-only]
 *
 * Each fault reproduces a bug the gate exists to catch, and must turn it red:
 *  - `charge-first` takes a purchase's coins before the goods are handed over;
 *  - `buyer-only` upgrades the tool in the buyer's pack alone.
 */

import { installCanvasGlobals } from './nodeCanvasGlobals';
import { TILE_SIZE } from '../src/core/constants';
import { EventBus, type GameEvents } from '../src/core/EventBus';
import { ITEM_DEF, type ItemId } from '../src/core/ItemDefs';
import {
  captureBriarHollowState,
  createBriarHollowState,
  parseBriarHollowStateSnapshot,
  restoreBriarHollowState,
  type BriarHollowState,
} from '../src/core/briarHollowState';
import { PartyTools, type ToolOwner } from '../src/core/PartyTools';
import { createPartyCraftsState, type PartyCraftsState } from '../src/core/partyCrafts';
import { teachBoth } from '../src/core/CraftSkills';
import type { ToolKind } from '../src/core/toolTiers';
import type { VillageQuestPhase } from '../src/core/villageQuestPhase';
import { resetSessionTally, sessionTallyOf } from '../src/core/resourceSessionTally';
import { referenceStats } from '../src/core/referenceCrawler';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { GameMap } from '../src/map/GameMap';
import { PricedMenuPanel } from '../src/ui/PricedMenuPanel';
import { RewardGrantedDialog } from '../src/ui/RewardGrantedDialog';
import { QuantityPicker } from '../src/ui/QuantityPicker';
import {
  FENNA,
  OREN,
  PIPKIN,
  SELLA,
  VETCH,
  type VillagerId,
} from '../src/dialog/scripts/briarHollow';
import type { BarkLine, DialogLine } from '../src/dialog/line';
import { VillagerSystem } from '../src/systems/briarHollow/VillagerSystem';
import { Conversation } from '../src/dialog/Conversation';
import {
  openingLine,
  type VillagerPartyState,
} from '../src/systems/briarHollow/villagerCircumstances';
import type { Choice, ConversationHandle, ConversationTopic } from '../src/dialog/request';
import { testConversationFlow } from './dialogFlowTestHelpers';
import { VillageServices } from '../src/systems/briarHollow/services/VillageServices';
import {
  sellerLine,
  type ServiceParty,
  type ShopDefinition,
} from '../src/systems/briarHollow/services/serviceContext';
import { cookShop } from '../src/systems/briarHollow/services/cookhouse';
import {
  buildInfirmaryMenu,
  infirmaryShop,
  infirmaryTopics,
  treatmentFee,
} from '../src/systems/briarHollow/services/infirmary';
import {
  buildTradingPostMenu,
  restockTradingPost,
  tradingPostShop,
} from '../src/systems/briarHollow/services/tradingPost';
import {
  UPGRADE_REBUY_GUARD_FRAMES,
  forgeShop,
  forgeTopics,
  type ForgeHost,
} from '../src/systems/briarHollow/services/forge';
import {
  batchLimit,
  initialBatch,
  lumberForemanTopics,
  runBatch,
  CONSTRUCTION_EXPERIENCE_ONCE_FLAG,
  type LumberForemanHost,
} from '../src/systems/briarHollow/services/lumberForeman';
import { NEED_WOOD_LINE } from '../src/systems/briarHollow/services/sawmill';
import type { ProcessingStationKind } from '../src/systems/briarHollow/processingStations';

installCanvasGlobals();

const fault = process.argv.find((arg) => arg.startsWith('--fault='))?.split('=')[1] ?? null;

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

function last<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1];
}

// ── The request's own numbers ─────────────────────────────────────────────

const POTION_PRICE = 5;
const EXPECTED_STEW_PRICE = POTION_PRICE;
/** A burger is priced at 0.6 of a potion, rounded. */
const EXPECTED_BURGER_PRICE = 3;
const EXPECTED_FEE_PER_HP = 0.7;
const EXPECTED_MIN_FEE = POTION_PRICE;
const EXPECTED_ROPE_BASE = 10;
const EXPECTED_ROPE_PRICE = 6;
const EXPECTED_ROPE_LOW_PRICE = 9;
const LOW_STOCK = 3;
const EXPECTED_BOARDS_PER_WOOD = 2;
const EXPECTED_ROPE_PER_WOOD = 1;
const EXPECTED_FEE_PER_WOOD = 1;
const HARDENED_AXE_PRICE = 250;
const MANUAL_FRAMES = 72;
const PLENTY_OF_COINS = 100_000;
const MAX_MENU_ROWS = 9;

// ── A real village ────────────────────────────────────────────────────────

const MAP_SIZE = 280;
const MAP_SEED = 1;

interface Rig {
  readonly map: GameMap;
  readonly state: BriarHollowState;
  readonly crafts: PartyCraftsState;
  readonly partyTools: PartyTools;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly party: ServiceParty;
  readonly villagers: VillagerSystem;
  readonly services: VillageServices;
  readonly bus: EventBus;
  readonly announced: string[];
  readonly rewards: string[];
  explainerOpens: number;
  readonly events: Array<{ name: keyof GameEvents; data: unknown }>;
}

function partyState(
  human: HumanPlayer,
  cat: CatPlayer,
  crafts: PartyCraftsState,
): VillagerPartyState {
  return {
    hpFractions: { human: human.hp / human.maxHp, cat: cat.hp / cat.maxHp },
    stone: 0,
    axeTier: crafts.tools.axeTier,
    pickaxeTier: crafts.tools.pickaxeTier,
    constructionLevels: { human: 0, cat: 0 },
    constructionLearned: false,
  };
}

/**
 * A state whose machines are already open: every service test here is about
 * the shops and the machines themselves, not the unlock questline, so a
 * fresh rig starts past it. A test of the unlock gate itself builds its own
 * state and leaves this unset.
 */
function unlockedState(): BriarHollowState {
  const state = createBriarHollowState();
  state.unlocks.processingStations = true;
  return state;
}

function buildRig(
  state: BriarHollowState = unlockedState(),
  crafts = createPartyCraftsState(),
): Rig | null {
  const map = new GameMap({
    mapSize: MAP_SIZE,
    mapType: 'overworld',
    worldSeed: MAP_SEED,
    tileHeight: TILE_SIZE,
  });
  const site = map.briarHollow;
  if (site === null) return null;
  const human = new HumanPlayer(site.gate.inside.x, site.gate.inside.y, TILE_SIZE);
  const cat = new CatPlayer(site.gate.inside.x + 1, site.gate.inside.y, TILE_SIZE);
  human.isActive = true;
  cat.isActive = false;
  const bus = new EventBus();
  const villagers = new VillagerSystem({
    gameMap: map,
    site,
    state,
    bus,
    audio: null,
    conversation: new Conversation(null),
    party: () => partyState(human, cat, crafts),
    random: () => 0,
  });
  const partyTools = new PartyTools(crafts.tools);
  const announced: string[] = [];
  const rewards: string[] = [];
  const events: Rig['events'] = [];
  const rigRef: { rig: Rig | null } = { rig: null };
  for (const name of ['toolsGranted', 'toolUpgraded', 'woodProcessed'] as const) {
    bus.on(name, (data) => events.push({ name, data }));
  }
  const services = new VillageServices({
    human,
    cat,
    state,
    partyTools,
    partyCrafts: crafts,
    site,
    villagers,
    bus,
    audio: null,
    sawmill: { working: false },
    menus: {
      enqueueReward: (reward) => rewards.push(reward.name),
      afterRewardsDrain: (run) => run(),
      openResourcingExplainer: () => {
        if (rigRef.rig !== null) rigRef.rig.explainerOpens++;
      },
      announce: (message) => announced.push(message),
    },
    isInteractKey: (key) => key === ' ',
    noteResourceActivity: () => undefined,
    worldHalted: () => false,
  });
  const rig: Rig = {
    map,
    state,
    crafts,
    partyTools,
    human,
    cat,
    party: { human, cat, active: () => (human.isActive ? human : cat) },
    villagers,
    services,
    bus,
    announced,
    rewards,
    explainerOpens: 0,
    events,
  };
  rigRef.rig = rig;
  return rig;
}

/** What a topic said and did, from a single `play(request)` on a recording handle. */
interface Recording {
  readonly said: DialogLine[];
  /** The choice row the play's ending brought up, or null when it closed instead. */
  choices: readonly Choice[] | null;
  /** Whether the box the topic played closes once its pages are read — true the instant a `close` ending is played, since the pages here are always one line. */
  closed: boolean;
  /** Simulates reading through to the end: runs the close ending's own `onClosed`, if it played one. */
  close(): void;
}

/** Runs `topic` (or a `Choice`'s own `run`) on a fresh recording handle and reports what it said and did. */
function runRecorded(run: (handle: ConversationHandle) => void): Recording {
  let onClosed: (() => void) | null = null;
  const recording: Recording = {
    said: [],
    choices: null,
    closed: false,
    close: () => {
      recording.closed = true;
      onClosed?.();
    },
  };
  const handle: ConversationHandle = {
    play: (request) => {
      for (const line of request.lines) if ('paragraphs' in line) recording.said.push(line);
      if (request.ending.kind === 'choices') {
        recording.choices = request.ending.choices;
      } else if (request.ending.kind === 'close') {
        recording.closed = true;
        onClosed = request.ending.onClosed;
      }
    },
    close: () => {
      recording.closed = true;
    },
  };
  run(handle);
  return recording;
}

function runRecordedTopic(topic: ConversationTopic): Recording {
  return runRecorded((handle) => topic.run(handle));
}

/**
 * Root topics build their `run` through the villager's own live conversation
 * flow, which needs an actual session open to anchor a beat to — so reading
 * the menu, or running one of its rows, first talks to the villager for real.
 */
function topicsFor(rig: Rig, villager: VillagerId): ConversationTopic[] {
  const target = rig.villagers.villagerFor(villager);
  if (target !== null) rig.villagers.talkTo(target, rig.human);
  const speaker = target ?? rig.human;
  const ctx = rig.villagers.contextFor(villager, speaker, null);
  return rig.villagers.rootTopicsFor(villager, ctx);
}

function topicKeys(rig: Rig, villager: VillagerId): string[] {
  return topicsFor(rig, villager).map((topic) => topic.key);
}

function runTopic(rig: Rig, villager: VillagerId, key: string): Recording | null {
  const topic = topicsFor(rig, villager).find((candidate) => candidate.key === key);
  return topic === undefined ? null : runRecordedTopic(topic);
}

/** Opens a shop on a fresh panel, applying the gate's fault when one is asked for. */
function openShop(shop: ShopDefinition): PricedMenuPanel {
  const panel = new PricedMenuPanel();
  const purchase: ShopDefinition['purchase'] =
    fault === 'charge-first'
      ? (option, buyer) => {
          buyer.coins -= option.price;
          return shop.purchase(option, buyer);
        }
      : shop.purchase;
  panel.open(shop.build, purchase, undefined, shop.blockedLine, shop.rebuyGuardFrames);
  return panel;
}

/** Fills every free bag and hotbar slot with a tool, so nothing new has anywhere to go. */
function fillPack(owner: ToolOwner): void {
  const filler = { ...ITEM_DEF.basic_axe, quantity: 1 };
  const { bag, actionBar } = owner.inventory;
  for (let index = 0; index < bag.slots.length; index++) {
    if (bag.slots[index] === null) bag.slots[index] = { ...filler };
  }
  for (let index = 0; index < actionBar.slots.length; index++) {
    if (actionBar.slots[index] === null) actionBar.slots[index] = { ...filler };
  }
}

function slotIndexOf(owner: ToolOwner, id: ItemId): string {
  const bar = owner.inventory.actionBar.slots.findIndex((slot) => slot?.id === id);
  if (bar !== -1) return `bar:${bar}`;
  const bag = owner.inventory.bag.slots.findIndex((slot) => slot?.id === id);
  return bag === -1 ? 'none' : `bag:${bag}`;
}

function setPhase(rig: Rig, phase: VillageQuestPhase): void {
  rig.state.quest.phase = phase;
}

// ── Sections ──────────────────────────────────────────────────────────────

function checkCook(rig: Rig): void {
  section('Cook');
  const { human, cat } = rig;
  const menu = cookShop(() => undefined).build();
  const price = (key: string): number | undefined =>
    menu.options.find((option) => option.key === key)?.price;
  check(
    price('hollow_stew') === EXPECTED_STEW_PRICE,
    `stew costs a potion (${price('hollow_stew')})`,
  );
  check(price('hamburger') === EXPECTED_BURGER_PRICE, `a burger costs ${price('hamburger')}`);
  check(menu.bark === sellerLine(PIPKIN.shopOpen), 'the menu opens on shop_open');

  human.coins = 0;
  const broke = openShop(cookShop(() => undefined));
  broke.pressBuy('hamburger', human, cat);
  check(human.inventory.countOf('hamburger') === 0 && human.coins === 0, 'no coins buys nothing');
  check(broke.currentLine === sellerLine(PIPKIN.cannotAfford), 'no coins hears cannot_afford');

  human.coins = PLENTY_OF_COINS;
  const panel = openShop(cookShop(() => undefined));
  panel.pressBuy('hamburger', human, cat);
  check(human.inventory.countOf('hamburger') === 1, 'a burger lands in the pack');
  check(human.coins === PLENTY_OF_COINS - EXPECTED_BURGER_PRICE, 'and costs its price');
  check(panel.currentLine === sellerLine(PIPKIN.buyBurger), 'with buy_burger');

  human.potionCooldownFrames = 0;
  panel.pressBuy('hollow_stew', human, cat);
  check(panel.currentLine === sellerLine(PIPKIN.buyStew), 'stew off cooldown hears buy_stew');
  human.potionCooldownFrames = 100;
  panel.pressBuy('hollow_stew', human, cat);
  check(human.inventory.countOf('hollow_stew') === 2, 'stew on cooldown still sells');
  check(
    panel.currentLine === sellerLine(PIPKIN.stewCooldownActive),
    'stew on cooldown hears stew_cooldown_active',
  );
  human.potionCooldownFrames = 0;
}

function checkFullBagRefused(): void {
  section('Full bag');
  const rig = buildRig();
  if (rig === null) return;
  const { human, cat } = rig;
  fillPack(human);
  human.coins = PLENTY_OF_COINS;
  const announced: string[] = [];
  const panel = openShop(cookShop((message) => announced.push(message)));
  panel.pressBuy('hamburger', human, cat);
  check(human.inventory.countOf('hamburger') === 0, 'a full bag takes no burger');
  check(human.coins === PLENTY_OF_COINS, 'and the buyer is not charged for it');
  check(announced.includes('Your bag is full.'), 'and is told the bag is full');
}

function checkDoctor(rig: Rig): void {
  section('Doctor');
  const { human, cat, party } = rig;
  human.hp = Math.max(1, Math.floor(human.maxHp / 2));
  cat.hp = Math.max(1, Math.floor(cat.maxHp / 2));
  const missing = human.maxHp - human.hp + (cat.maxHp - cat.hp);
  const expected = Math.max(EXPECTED_MIN_FEE, Math.ceil(missing * EXPECTED_FEE_PER_HP));
  check(treatmentFee(party) === expected, `fee for ${missing} missing HP is ${expected}`);

  let treatments = 0;
  const host = { openShop: () => undefined, beginTreatment: () => treatments++ };
  human.coins = PLENTY_OF_COINS;
  const panel = openShop(infirmaryShop(party, host));
  panel.pressBuy('treat_party', human, cat);
  check(human.hp === human.maxHp && cat.hp === cat.maxHp, 'both crawlers end at full HP');
  check(human.coins === PLENTY_OF_COINS - expected, 'the fee is charged once');
  check(treatments === 1, 'the treatment plays');
  check(panel.currentLine === sellerLine(SELLA.buyHealing), 'Sella says buy_healing');

  const unhurt = buildInfirmaryMenu(party).options[0];
  check(unhurt.unavailable === 'Unhurt', 'the row is disabled at full HP');
  const topic = infirmaryTopics(party, host).topics(
    'sella',
    rig.villagers.contextFor('sella', human, null),
    testConversationFlow(),
  )[0];
  const recording = runRecordedTopic(topic);
  check(
    recording.said.length === 1 && recording.said[0] === SELLA.fullyHealthy && recording.closed,
    'Treatment at full HP says fully_healthy and closes',
  );

  const floorLevel = 15;
  const refHuman = referenceStats('human', 'balanced', floorLevel).maxHp;
  const refCat = referenceStats('cat', 'balanced', floorLevel).maxHp;
  const halfMissing = Math.ceil(refHuman / 2) + Math.ceil(refCat / 2);
  const reference = Math.max(EXPECTED_MIN_FEE, Math.ceil(halfMissing * EXPECTED_FEE_PER_HP));
  console.log(
    `  ..   reference pair (level ${floorLevel}, ${refHuman}+${refCat} HP) at half health: ` +
      `${reference} coins = ${(reference / POTION_PRICE).toFixed(2)} potions`,
  );
}

function checkMerchant(): void {
  section('Merchant');
  const lockedState = createBriarHollowState();
  lockedState.unlocks.processingStations = false;
  const lockedOptions = buildTradingPostMenu(lockedState).options;
  check(
    !lockedOptions.some((option) => option.key === 'rope' || option.key === 'wood_board'),
    'the shelf carries no rope or boards before Fenna opens the machines up',
  );

  const rig = buildRig();
  if (rig === null) return;
  const { human, state } = rig;
  human.coins = PLENTY_OF_COINS;
  const ropeRow = (): { price: number; unavailable?: string } | undefined =>
    buildTradingPostMenu(state).options.find((option) => option.key === 'rope');
  check(ropeRow()?.price === EXPECTED_ROPE_PRICE, 'rope costs 6');
  const panel = openShop(tradingPostShop(state, () => undefined));
  panel.pressBuy('rope', human, rig.cat);
  check(state.merchantStock.rope === EXPECTED_ROPE_BASE - 1, 'a sale takes one off the shelf');
  check(human.inventory.countOf('rope') === 1, 'and hands it over');

  const rebuilt = buildRig(state);
  check(
    rebuilt !== null && buildTradingPostMenu(rebuilt.state).options[2].desc.includes('9 left'),
    'the count survives a scene rebuild',
  );
  const reloaded = createBriarHollowState();
  const snapshot = parseBriarHollowStateSnapshot(
    JSON.parse(JSON.stringify(captureBriarHollowState(state))),
  );
  if (snapshot !== undefined) restoreBriarHollowState(reloaded, snapshot);
  check(reloaded.merchantStock.rope === EXPECTED_ROPE_BASE - 1, 'and a save and reload');

  state.merchantStock.rope = LOW_STOCK + 1;
  check(ropeRow()?.price === EXPECTED_ROPE_PRICE, 'four left is still the base price');
  state.merchantStock.rope = LOW_STOCK;
  check(ropeRow()?.price === EXPECTED_ROPE_LOW_PRICE, 'three left is marked up by half');
  const vetch = rig.villagers.villagerFor('vetch');
  if (vetch !== null) {
    state.talkCounts.vetch = 1;
    const opening = openingLine('vetch', rig.villagers.contextFor('vetch', vetch, null));
    check(opening.pages[0] === VETCH.lowSupplies, 'and Vetch opens on low_supplies');
  }
  const burgers = buildTradingPostMenu(state).options.find((option) => option.key === 'hamburger');
  check(
    burgers?.price === Math.round(EXPECTED_BURGER_PRICE * 1.25),
    'a full burger shelf is not "low"',
  );

  state.merchantStock.rope = 0;
  check(ropeRow()?.unavailable === 'Sold out', 'an empty shelf is sold out');
  const before = human.coins;
  openShop(tradingPostShop(state, () => undefined)).pressBuy('rope', human, rig.cat);
  check(human.coins === before, 'and sells nothing');

  restockTradingPost(state);
  check(
    buildTradingPostMenu(state).options.every((option) => option.unavailable === undefined) &&
      ropeRow()?.price === EXPECTED_ROPE_PRICE,
    'entering the floor restocks every shelf',
  );
  const freshState = createBriarHollowState();
  freshState.unlocks.processingStations = true;
  check(
    buildTradingPostMenu(freshState).options[2].desc.includes(`${EXPECTED_ROPE_BASE} left`),
    "a new floor's village starts fully stocked",
  );
}

function forgeHostFor(rig: Rig, tools: PartyTools): ForgeHost {
  return {
    openShop: () => undefined,
    party: rig.party,
    partyTools: tools,
    tools: rig.crafts.tools,
    crafts: rig.crafts,
    state: rig.state,
    bus: rig.bus,
    enqueueReward: (reward) => rig.rewards.push(reward.name),
    showResourcingExplainer: () => rig.explainerOpens++,
    playUpgradeSound: () => undefined,
  };
}

/** Upgrades only the buyer's pack — the bug the `buyer-only` fault reproduces. */
class BuyerOnlyTools extends PartyTools {
  override upgrade(kind: ToolKind, human: ToolOwner, _cat: ToolOwner): void {
    super.upgrade(kind, human, human);
  }
}

function checkForge(): void {
  section('Forge');
  const rig = buildRig();
  if (rig === null) return;
  const { human, cat } = rig;
  setPhase(rig, 'offered');
  check(!topicKeys(rig, 'oren').includes('tools'), 'before the quest, Oren grants nothing');
  setPhase(rig, 'need_tools');
  check(topicKeys(rig, 'oren').join() === 'tools', 'once accepted, "Tools" is his only row');

  const grant = runTopic(rig, 'oren', 'tools');
  check(
    grant?.said.length === 1 && grant.said[0] === OREN.grantAndLesson,
    'the grant and lesson play as one line',
  );
  const holds = (owner: ToolOwner, id: ItemId): boolean => owner.inventory.countOf(id) === 1;
  check(
    holds(human, 'basic_axe') &&
      holds(human, 'basic_pickaxe') &&
      holds(cat, 'basic_axe') &&
      holds(cat, 'basic_pickaxe'),
    'both inventories hold both tools',
  );
  check(
    human.craftSkills.getLevel('resourcing') === 1 && cat.craftSkills.getLevel('resourcing') === 1,
    'both crawlers learn Resourcing at level 1',
  );
  check(
    rig.events.filter((event) => event.name === 'toolsGranted').length === 1,
    'toolsGranted fires',
  );
  check(rig.explainerOpens === 0, 'the explainer waits for the conversation to close');
  grant?.close();
  check(rig.rewards.join() === 'Basic Axe,Basic Pickaxe', 'the two tools are shown as rewards');
  check(rig.explainerOpens === 1, 'the Resourcing explainer opens after the grant');
  check(rig.crafts.explainersSeen.includes('resourcing'), 'and is recorded as seen');

  check(
    !topicKeys(rig, 'oren').includes('tools'),
    '"Tools" drops off the list once the party already has them',
  );
  check(
    holds(human, 'basic_axe') && holds(cat, 'basic_pickaxe'),
    'the grant is idempotent: still one of each',
  );
  check(rig.explainerOpens === 1, 'the explainer opens exactly once on its own');
  const teach = runTopic(rig, 'oren', 'teach_again');
  teach?.close();
  check(
    teach?.said.length === 1 &&
      teach.said[0] === OREN.resourcingSkillAlreadyGranted &&
      rig.explainerOpens === 2,
    '"Teach me again" reopens the explainer',
  );
  const keys = topicKeys(rig, 'oren');
  check(keys.length + 1 <= MAX_MENU_ROWS, `Oren's menu fits the number keys (${keys.length + 1})`);
  check(keys[0] === 'upgrades', '"Shop" leads Oren\'s list once he has tools to sell');

  const tools = fault === 'buyer-only' ? new BuyerOnlyTools(rig.crafts.tools) : rig.partyTools;
  const host = forgeHostFor(rig, tools);
  const humanSlot = slotIndexOf(human, 'basic_axe');
  const catSlot = slotIndexOf(cat, 'basic_axe');
  human.coins = HARDENED_AXE_PRICE;
  const panel = openShop(forgeShop(host));
  check(
    panel.currentLine === sellerLine(OREN.axeUpgradeAvailable),
    'an affordable axe is announced first',
  );
  panel.pressBuy('axe', human, cat);
  check(
    slotIndexOf(human, 'hardened_axe') === humanSlot,
    `the buyer's axe is swapped in place (${humanSlot})`,
  );
  check(
    slotIndexOf(cat, 'hardened_axe') === catSlot,
    `and the companion's, in its own slot (${catSlot})`,
  );
  check(
    human.inventory.countOf('basic_axe') === 0 && cat.inventory.countOf('basic_axe') === 0,
    'no basic axe is left behind',
  );
  check(
    cat.inventory.countOf('hardened_axe') === 1,
    "one crawler's purchase reaches the other's pack",
  );
  check(human.coins === 0, 'the buyer pays');
  check(
    panel.currentLine ===
      `${sellerLine(OREN.upgradePurchased)} ${sellerLine(OREN.sharedUpgradeExplanation)}`,
    'the first upgrade explains the sharing',
  );
  check(
    rig.events.some((event) => event.name === 'toolUpgraded'),
    'toolUpgraded fires',
  );
  human.coins = PLENTY_OF_COINS;
  for (let frame = 0; frame < UPGRADE_REBUY_GUARD_FRAMES; frame++) panel.update();
  panel.pressBuy('pickaxe', human, cat);
  check(panel.currentLine === sellerLine(OREN.upgradePurchased), 'the explanation is a one-shot');

  rig.crafts.tools.axeTier = 5;
  rig.partyTools.reconcile(human, cat);
  const top = forgeShop(host)
    .build()
    .options.find((option) => option.key === 'axe');
  check(
    top?.unavailable !== undefined && (top?.label.endsWith('(finest)') ?? false),
    'the top axe is marked finest',
  );
  const coins = human.coins;
  const topPanel = openShop(forgeShop(host));
  topPanel.pressBuy('axe', human, cat);
  check(
    human.coins === coins && rig.crafts.tools.axeTier === 5,
    'buying past the top tier is refused',
  );
  check(topPanel.currentLine === sellerLine(OREN.alreadyMaxAxe), 'with already_max_axe');
}

/** Stands `crawler` where it can work the machine making `kind`. */
function standAt(rig: Rig, kind: ProcessingStationKind): boolean {
  const site = rig.map.briarHollow;
  if (site === null) return false;
  const sawmill = rig.services.sawmill;
  const bounds = site.palisadeBounds;
  for (let ty = bounds.y; ty < bounds.y + bounds.h; ty++) {
    for (let tx = bounds.x; tx < bounds.x + bounds.w; tx++) {
      rig.human.x = tx * TILE_SIZE;
      rig.human.y = ty * TILE_SIZE;
      if (sawmill.stationFor(rig.human)?.kind === kind) return true;
    }
  }
  return false;
}

function tick(rig: Rig, frames: number): void {
  for (let frame = 0; frame < frames; frame++) rig.services.update();
}

function checkSawmillLocked(): void {
  section('Sawmill, before Fenna opens the machines up');
  const lockedState = createBriarHollowState();
  lockedState.unlocks.processingStations = false;
  const rig = buildRig(lockedState);
  if (rig === null) return;
  const { human } = rig;
  const sawmill = rig.services.sawmill;
  human.inventory.addItem('wood', 5);
  check(!standAt(rig, 'boards'), 'no tile in the yard offers the saw');
  check(!standAt(rig, 'rope'), 'no tile in the yard offers the rope walk');
  check(sawmill.press(human) === null, 'a press at the machine reaches nothing');
  check(human.craftSkills.getXp('construction') === 0, 'no Construction XP is earned');
}

function checkSawmill(): void {
  section('Sawmill');
  const rig = buildRig();
  if (rig === null) return;
  const { human } = rig;
  const sawmill = rig.services.sawmill;
  resetSessionTally();
  check(standAt(rig, 'boards'), 'a spot beside the saw exists');
  check(sawmill.press(human) === 'no_wood', 'no wood: refused');
  check(rig.announced.includes(NEED_WOOD_LINE), `and told "${NEED_WOOD_LINE}"`);

  human.inventory.addItem('wood', 1);
  check(sawmill.press(human) === 'started', 'one wood: the saw starts');
  tick(rig, MANUAL_FRAMES);
  check(
    human.inventory.countOf('wood') === 0 &&
      human.inventory.countOf('wood_board') === EXPECTED_BOARDS_PER_WOOD,
    '1 wood becomes 2 boards',
  );
  check(
    sessionTallyOf('wood_board') === EXPECTED_BOARDS_PER_WOOD,
    'the boards join the session tally',
  );
  const processed = rig.events.find((event) => event.name === 'woodProcessed');
  check(processed !== undefined, 'woodProcessed fires');
  check(human.craftSkills.getXp('construction') === 0, 'no Construction XP before it is learned');

  human.inventory.addItem('wood', 1);
  sawmill.press(human);
  tick(rig, MANUAL_FRAMES / 2);
  human.x += TILE_SIZE / 2;
  tick(rig, MANUAL_FRAMES);
  check(
    !sawmill.isWorking &&
      human.inventory.countOf('wood') === 1 &&
      human.inventory.countOf('wood_board') === EXPECTED_BOARDS_PER_WOOD,
    'moving mid-cut cancels it, and nothing is spent',
  );

  teachBoth(human, rig.cat, 'construction');
  check(standAt(rig, 'rope'), 'a spot beside the rope walk exists');
  sawmill.press(human);
  tick(rig, MANUAL_FRAMES);
  check(human.inventory.countOf('rope') === EXPECTED_ROPE_PER_WOOD, '1 wood becomes 1 rope');
  const xp = human.craftSkills.getXp('construction');
  check(xp > 0, `Construction XP once it is learned (${xp} a wood)`);

  human.inventory.addItem('wood', 3);
  sawmill.setKeyHeld(true);
  sawmill.press(human);
  tick(rig, MANUAL_FRAMES * 4);
  check(
    human.inventory.countOf('wood') === 0 &&
      human.inventory.countOf('rope') === EXPECTED_ROPE_PER_WOOD * 4,
    'holding the key works through the whole stack',
  );
  check(!sawmill.isWorking, 'and stops when the wood runs out');
  sawmill.setKeyHeld(false);

  const wallXpPerSecond = 545 / 3;
  const processXpPerSecond = xp / (MANUAL_FRAMES / 60);
  console.log(
    `  ..   processing earns ${processXpPerSecond.toFixed(1)} XP/s, ` +
      `${((processXpPerSecond / wallXpPerSecond) * 100).toFixed(1)}% of building a wooden wall`,
  );
}

/**
 * A `LumberForemanHost` whose `respond`/`returnToRoot` mirror
 * `VillageServices`'s own: while `conversationOpen()` says the conversation
 * is still there, they play through the `convo`/`flow` the picker was opened
 * over; once it says otherwise, `respond` only barks the first line and
 * `returnToRoot` does nothing, the way a picker outliving a walked-away
 * conversation would find it.
 */
function fennaHost(
  rig: Rig,
  picker: QuantityPicker,
  responses: BarkLine[][],
  conversationOpen: () => boolean = () => true,
): LumberForemanHost {
  return {
    party: rig.party,
    state: rig.state,
    bus: rig.bus,
    audio: null,
    openPicker: (options) => picker.open(options),
    respond: (convo, flow, lines) => {
      responses.push([...lines]);
      if (!conversationOpen()) return false;
      convo.play(flow.sayKeepingMenu(lines));
      return true;
    },
    returnToRoot: (convo, flow) => {
      if (conversationOpen()) convo.play(flow.returnToRoot());
    },
    announce: (message) => rig.announced.push(message),
    noteResourceActivity: () => undefined,
  };
}

function checkFenna(): void {
  section('Fenna');
  const lockedState = createBriarHollowState();
  lockedState.unlocks.processingStations = false;
  const lockedRig = buildRig(lockedState);
  if (lockedRig !== null) {
    check(
      !topicKeys(lockedRig, 'fenna').includes('process_batch'),
      'no batch-processing row before the machines are open',
    );
  }

  const rig = buildRig();
  if (rig === null) return;
  const { human, cat } = rig;
  const picker = new QuantityPicker(null);
  const responses: BarkLine[][] = [];
  const host = fennaHost(rig, picker, responses);

  const fennaKeys = topicKeys(rig, 'fenna');
  check(fennaKeys[0] === 'process_batch', '"Process a batch" leads Fenna\'s list');

  human.inventory.addItem('wood', 10);
  human.coins = 10;
  check(runBatch(host, 'boards', 10) !== null, '10 wood, 10 coins: the batch runs');
  check(
    human.coins === 10 - 10 * EXPECTED_FEE_PER_WOOD &&
      human.inventory.countOf('wood') === 0 &&
      human.inventory.countOf('wood_board') === 10 * EXPECTED_BOARDS_PER_WOOD,
    'N wood → N coins and 2N boards',
  );
  human.inventory.addItem('wood', 4);
  human.coins = 4;
  runBatch(host, 'rope', 4);
  check(human.inventory.countOf('rope') === 4 && human.coins === 0, 'N wood → N rope');

  human.inventory.addItem('wood', 5);
  human.coins = 3;
  check(runBatch(host, 'boards', 5) === null, 'short of the fee: refused');
  check(
    human.coins === 3 &&
      human.inventory.countOf('wood') === 5 &&
      human.inventory.countOf('wood_board') === 20,
    'and nothing changes',
  );

  cat.inventory.addItem('wood', 2);
  check(batchLimit(rig.party, 'boards').max === 7, "the picker's max is the party's wood");
  check(initialBatch(7) === 7 && initialBatch(25) === 10, 'it opens on ten, or all there is');

  const packed = buildRig();
  if (packed !== null) {
    packed.human.inventory.addItem('wood', 6);
    fillPack(packed.human);
    fillPack(packed.cat);
    const limit = batchLimit(packed.party, 'rope');
    check(limit.max === 0 && limit.limitedByBag, 'no room anywhere: nothing can be processed');
    const halfPacked = buildRig();
    if (halfPacked !== null) {
      halfPacked.human.inventory.addItem('wood', 6);
      fillPack(halfPacked.human);
      check(
        batchLimit(halfPacked.party, 'rope').max === 6,
        "room in the companion's pack is enough",
      );
    }
  }

  const topics = lumberForemanTopics(host).topics(
    'fenna',
    rig.villagers.contextFor('fenna', human, null),
    testConversationFlow(),
  );
  const batch = topics.find((topic) => topic.key === 'process_batch');
  const recording = batch === undefined ? null : runRecordedTopic(batch);
  check(
    recording?.said.length === 1 && recording.said[0] === FENNA.bulkProcessingService,
    'the offer first',
  );
  const choice = recording?.choices?.find((candidate) => candidate.label === 'Rope');
  check(
    recording?.choices?.map((candidate) => candidate.label).join() === 'Boards,Rope,Back',
    'then Boards or Rope',
  );
  human.coins = 0;
  const ropeRecording = choice === undefined ? null : runRecorded((handle) => choice.run(handle));
  check(last(ropeRecording?.said ?? []) === FENNA.bulkProcessingRopeSelected, 'Rope it is');
  check(picker.isOpen && picker.max === 7, 'the picker opens capped at the wood');
  picker.handleKey('Enter');
  check(
    last(responses)?.length === 1 &&
      last(responses)?.[0] === FENNA.bulkProcessingInsufficientFee &&
      picker.isOpen,
    'short of coin: she says so and the picker comes back',
  );
  human.coins = PLENTY_OF_COINS;
  picker.handleKey('Enter');
  check(last(responses)?.[0] === FENNA.bulkProcessingComplete, 'paid: bulk_processing_complete');
  check(!picker.isOpen, 'and the picker closes');

  teachBoth(human, cat, 'construction');
  human.inventory.addItem('wood', 2);
  const first = runBatch(host, 'boards', 1);
  check(
    first !== null &&
      first.constructionExperienceEarned &&
      first.lines.length === 2 &&
      first.lines[0] === FENNA.bulkProcessingComplete &&
      first.lines[1] === FENNA.constructionExperience,
    'the first batch after learning Construction remarks on it',
  );
  // runBatch itself never spends the once-flag — only the caller does, once
  // it knows the remark was actually shown (see checkFennaConversationFlow);
  // simulate that here so a second direct call still proves "once only".
  if (first !== null && first.constructionExperienceEarned) {
    rig.state.onceFlags.push(CONSTRUCTION_EXPERIENCE_ONCE_FLAG);
  }
  const second = runBatch(host, 'boards', 1);
  check(
    second !== null &&
      second.lines.length === 1 &&
      second.lines[0] === FENNA.bulkProcessingComplete,
    'once only',
  );
  check(
    human.craftSkills.getXp('construction') === 0,
    'paying Fenna to run a batch grants no Construction XP, even once the skill is learned',
  );
  check(
    rig.events.filter((event) => event.name === 'woodProcessed').length >= 3,
    'every batch fires woodProcessed',
  );
}

/**
 * Fenna's batch through her real, still-open conversation: picking an
 * output opens the picker over the villager box rather than closing it,
 * the batch's result — including the construction-experience one-shot,
 * when it is due — plays inside that same open conversation, and
 * cancelling the picker brings the box back to its root topics.
 */
function checkFennaConversationFlow(): void {
  section('Fenna: the picker over the still-open conversation');
  const rig = buildRig();
  if (rig === null) return;
  const { human, cat } = rig;
  teachBoth(human, cat, 'construction');
  human.inventory.addItem('wood', 20);
  human.coins = PLENTY_OF_COINS;

  const fenna = rig.villagers.villagerFor('fenna');
  if (fenna === null) {
    check(false, 'Fenna is on the map');
    return;
  }
  const conversation = rig.villagers.conversation;
  const ADVANCE_GUARD = 40;
  /** Reads the conversation to its choices: skips the typing and turns every page, the same way the real per-frame loop does. */
  const advanceToChoices = (): void => {
    for (
      let guard = 0;
      guard < ADVANCE_GUARD && rig.villagers.isConversationOpen && !conversation.isShowingChoices;
      guard++
    ) {
      conversation.update(null);
      if (!rig.villagers.isConversationOpen || conversation.isShowingChoices) break;
      conversation.advance();
    }
  };

  rig.villagers.talkTo(fenna, human);
  advanceToChoices();
  const processBatchIndex = conversation.choiceLabels.indexOf('Process a batch');
  check(processBatchIndex === 0, '"Process a batch" leads the root menu');
  conversation.handleKeyDown(String(processBatchIndex + 1));
  advanceToChoices();
  check(conversation.choiceLabels.join() === 'Boards,Rope,Back', 'the offer, then Boards or Rope');

  conversation.handleKeyDown('1'); // Boards
  check(rig.services.picker.isOpen, 'the picker opens over the still-open conversation');
  check(!conversation.isShowingChoices, 'the selected-output line, not the submenu, is on screen');

  rig.services.picker.handleKey('Enter');
  advanceToChoices();
  check(
    rig.villagers.isConversationOpen,
    'the conversation is still open once the batch is answered',
  );
  check(
    rig.state.onceFlags.includes(CONSTRUCTION_EXPERIENCE_ONCE_FLAG),
    'the construction-experience remark was actually read, not skipped — its one-shot flag is spent',
  );
  check(
    conversation.choiceLabels.join() === 'Boards,Rope,Back',
    'and the boards/rope submenu — not the root — is what comes back',
  );

  human.inventory.addItem('wood', 20);
  conversation.handleKeyDown('2'); // Rope
  check(rig.services.picker.isOpen, 'picking again reopens the picker');
  rig.services.picker.handleKey('Escape');
  check(!rig.services.picker.isOpen, 'Escape cancels the picker');
  check(
    !conversation.choiceLabels.includes('Boards') && conversation.choiceLabels.includes('Goodbye'),
    'cancelling the picker returns the conversation to its root topics',
  );
}

function checkDoublePress(): void {
  section('Double press at the forge');
  const rig = buildRig();
  if (rig === null) return;
  const { human, cat } = rig;
  rig.partyTools.grantStarterTools(human, cat);
  const startingCoins = 3000;
  human.coins = startingCoins;
  const panel = openShop(forgeShop(forgeHostFor(rig, rig.partyTools)));
  panel.pressBuy('axe', human, cat);
  panel.pressBuy('axe', human, cat);
  check(
    rig.crafts.tools.axeTier === 1 && human.coins === startingCoins - HARDENED_AXE_PRICE,
    'two presses inside the window upgrade once',
  );
  for (let frame = 0; frame < UPGRADE_REBUY_GUARD_FRAMES - 1; frame++) panel.update();
  panel.pressBuy('axe', human, cat);
  check(rig.crafts.tools.axeTier === 1, "a press on the window's last frame is still refused");
  panel.update();
  panel.pressBuy('axe', human, cat);
  check(rig.crafts.tools.axeTier === 2, 'a press after the window buys the next tier');
  const town = new PricedMenuPanel();
  let sales = 0;
  town.open(
    () => ({ title: '', bark: '', options: [{ key: 'x', label: 'x', price: 1, desc: '' }] }),
    () => {
      sales++;
      return { ok: true, line: '' };
    },
  );
  town.pressBuy('x', human, cat);
  town.pressBuy('x', human, cat);
  check(sales === 2, 'a menu that asks for no guard still sells on every press');
}

function checkDeathDuringLesson(): void {
  section('Death and rewind during the lesson');
  const dead = buildRig();
  if (dead !== null) {
    setPhase(dead, 'need_tools');
    const lesson = runTopic(dead, 'oren', 'tools');
    dead.human.hp = 0;
    lesson?.close();
    check(
      dead.rewards.length === 0 && dead.explainerOpens === 0,
      'a lesson closed by death queues no cards and no explainer',
    );
  }
  const rewound = buildRig();
  if (rewound !== null) {
    setPhase(rewound, 'need_tools');
    const lesson = runTopic(rewound, 'oren', 'tools');
    rewound.crafts.tools.axeTier = null;
    rewound.crafts.tools.pickaxeTier = null;
    lesson?.close();
    check(
      rewound.rewards.length === 0 && rewound.explainerOpens === 0,
      'a lesson whose grant was rewound queues nothing',
    );
  }
  const dialog = new RewardGrantedDialog();
  let staleFollowUps = 0;
  dialog.enqueue({ kind: 'item', name: 'Basic Axe', description: '', renderIcon: () => undefined });
  dialog.afterQueueDrains(() => staleFollowUps++);
  dialog.discard();
  let freshFollowUps = 0;
  dialog.afterQueueDrains(() => freshFollowUps++);
  // A later card being shown and dismissed must not bring the dropped follow-up back either.
  dialog.enqueue({ kind: 'item', name: 'Later', description: '', renderIcon: () => undefined });
  const cardFrames = 61;
  for (let frame = 0; frame < cardFrames; frame++) dialog.update();
  dialog.handleClick(0, 0);
  check(
    !dialog.isShowing && staleFollowUps === 0 && freshFollowUps === 1,
    'discarding the reward cards drops them and what waited on them',
  );
}

function checkPanelsAndPrompt(): void {
  section('Panels on death, prompt during a cut');
  const rig = buildRig();
  if (rig === null) return;
  const { human } = rig;
  human.inventory.addItem('wood', 3);
  const picker = rig.services.picker;
  picker.open({
    title: '',
    max: 3,
    initial: 1,
    unitLabel: 'wood',
    confirmLabel: 'Process',
    onConfirm: () => undefined,
    onCancel: () => undefined,
  });
  rig.services.closePanels();
  check(!picker.isOpen && !rig.services.panel.isOpen, 'death takes the picker and the menu down');
  check(standAt(rig, 'boards'), 'a spot beside the saw exists');
  rig.services.sawmill.press(human);
  check(rig.services.wouldInteract(human), 'mid-cut the press is claimed by the machine');
  rig.services.sawmill.cancel();
}

function checkSiegeClosure(): void {
  section('Siege closure');
  const rig = buildRig();
  if (rig === null) return;
  rig.partyTools.grantStarterTools(rig.human, rig.cat);
  const shopRows: ReadonlyArray<{ villager: VillagerId; key: string }> = [
    { villager: 'pipkin', key: 'buy_food' },
    { villager: 'vetch', key: 'browse' },
    { villager: 'oren', key: 'upgrades' },
    { villager: 'fenna', key: 'process_batch' },
  ];
  setPhase(rig, 'gather_wood');
  for (const { villager, key } of shopRows) {
    check(topicKeys(rig, villager).includes(key), `${villager} trades while gathering`);
  }
  check(topicKeys(rig, 'sella').includes('treatment'), 'sella treats while gathering');
  for (const villager of ['pipkin', 'sella', 'vetch', 'oren', 'fenna'] as const) {
    const rows = topicKeys(rig, villager).length + 1;
    check(rows <= MAX_MENU_ROWS, `${villager}'s menu fits the number keys (${rows})`);
  }
  for (const phase of ['imminent', 'assault'] as const) {
    setPhase(rig, phase);
    for (const { villager, key } of shopRows) {
      check(!topicKeys(rig, villager).includes(key), `${villager} refuses trade in ${phase}`);
    }
    check(topicKeys(rig, 'sella').includes('treatment'), `sella stays open in ${phase}`);
  }
}

function checkForgeTopicsAreServices(rig: Rig): void {
  section('Registration');
  setPhase(rig, 'gather_wood');
  const host = forgeHostFor(rig, rig.partyTools);
  const direct = forgeTopics(host).topics(
    'oren',
    rig.villagers.contextFor('oren', rig.human, null),
    testConversationFlow(),
  );
  check(direct.length > 0, 'the forge offers rows once the quest is under way');
  check(topicKeys(rig, 'pipkin').includes('buy_food'), 'the services register with the village');
}

// ── Run ───────────────────────────────────────────────────────────────────

const rig = buildRig();
check(rig !== null, 'a generated map has a village');
if (rig !== null) {
  checkCook(rig);
  checkFullBagRefused();
  checkDoctor(rig);
  checkForgeTopicsAreServices(rig);
}
checkMerchant();
checkForge();
checkSawmillLocked();
checkSawmill();
checkFenna();
checkFennaConversationFlow();
checkSiegeClosure();
checkDoublePress();
checkDeathDuringLesson();
checkPanelsAndPrompt();

console.log(
  `\n${checks - failures}/${checks} checks passed${fault === null ? '' : ` (fault: ${fault})`}.`,
);
if (failures > 0) process.exit(1);
