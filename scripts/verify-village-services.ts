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
  line,
  type Circumstance,
  type VillagerId,
} from '../src/systems/briarHollow/ratkinDialogue';
import { VillagerSystem } from '../src/systems/briarHollow/VillagerSystem';
import {
  openingLine,
  type VillagerPartyState,
} from '../src/systems/briarHollow/villagerCircumstances';
import type {
  ConversationController,
  ConversationTopic,
} from '../src/systems/briarHollow/villagerTopics';
import { VillageServices } from '../src/systems/briarHollow/services/VillageServices';
import type {
  ServiceParty,
  ShopDefinition,
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

function say(villager: VillagerId, circumstance: Circumstance): string {
  return line(villager, circumstance) ?? `<missing ${villager}:${circumstance}>`;
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

function buildRig(state = createBriarHollowState(), crafts = createPartyCraftsState()): Rig | null {
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

/** A controller that records what a topic says and does, instead of drawing it. */
interface Recording {
  readonly ctl: ConversationController;
  readonly said: Circumstance[];
  submenu: readonly ConversationTopic[] | null;
  closed: boolean;
  backToRoot: number;
}

function recorder(villager: VillagerId): Recording {
  const afterClose: Array<() => void> = [];
  const recording: Recording = {
    said: [],
    submenu: null,
    closed: false,
    backToRoot: 0,
    ctl: {
      villager,
      say: (...circumstances) => {
        recording.said.push(...circumstances);
        return true;
      },
      showTopics: (topics) => {
        recording.submenu = topics;
      },
      showRootTopics: () => {
        recording.backToRoot++;
      },
      close: () => {
        recording.closed = true;
        for (const run of afterClose) run();
      },
      afterClose: (run) => afterClose.push(run),
    },
  };
  return recording;
}

function topicsFor(rig: Rig, villager: VillagerId): ConversationTopic[] {
  const speaker = rig.villagers.villagerFor(villager) ?? rig.human;
  const ctx = rig.villagers.contextFor(villager, speaker, null);
  return rig.villagers.rootTopicsFor(villager, ctx);
}

function topicKeys(rig: Rig, villager: VillagerId): string[] {
  return topicsFor(rig, villager).map((topic) => topic.key);
}

function runTopic(rig: Rig, villager: VillagerId, key: string): Recording | null {
  const topic = topicsFor(rig, villager).find((candidate) => candidate.key === key);
  if (topic === undefined) return null;
  const recording = recorder(villager);
  topic.run(recording.ctl);
  return recording;
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
  const { human } = rig;
  const menu = cookShop(() => undefined).build();
  const price = (key: string): number | undefined =>
    menu.options.find((option) => option.key === key)?.price;
  check(
    price('hollow_stew') === EXPECTED_STEW_PRICE,
    `stew costs a potion (${price('hollow_stew')})`,
  );
  check(price('hamburger') === EXPECTED_BURGER_PRICE, `a burger costs ${price('hamburger')}`);
  check(menu.bark === say('pipkin', 'shop_open'), 'the menu opens on shop_open');

  human.coins = 0;
  const broke = openShop(cookShop(() => undefined));
  broke.pressBuy('hamburger', human);
  check(human.inventory.countOf('hamburger') === 0 && human.coins === 0, 'no coins buys nothing');
  check(broke.currentLine === say('pipkin', 'cannot_afford'), 'no coins hears cannot_afford');

  human.coins = PLENTY_OF_COINS;
  const panel = openShop(cookShop(() => undefined));
  panel.pressBuy('hamburger', human);
  check(human.inventory.countOf('hamburger') === 1, 'a burger lands in the pack');
  check(human.coins === PLENTY_OF_COINS - EXPECTED_BURGER_PRICE, 'and costs its price');
  check(panel.currentLine === say('pipkin', 'buy_burger'), 'with buy_burger');

  human.potionCooldownFrames = 0;
  panel.pressBuy('hollow_stew', human);
  check(panel.currentLine === say('pipkin', 'buy_stew'), 'stew off cooldown hears buy_stew');
  human.potionCooldownFrames = 100;
  panel.pressBuy('hollow_stew', human);
  check(human.inventory.countOf('hollow_stew') === 2, 'stew on cooldown still sells');
  check(
    panel.currentLine === say('pipkin', 'stew_cooldown_active'),
    'stew on cooldown hears stew_cooldown_active',
  );
  human.potionCooldownFrames = 0;
}

function checkFullBagRefused(): void {
  section('Full bag');
  const rig = buildRig();
  if (rig === null) return;
  const { human } = rig;
  fillPack(human);
  human.coins = PLENTY_OF_COINS;
  const announced: string[] = [];
  const panel = openShop(cookShop((message) => announced.push(message)));
  panel.pressBuy('hamburger', human);
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
  panel.pressBuy('treat_party', human);
  check(human.hp === human.maxHp && cat.hp === cat.maxHp, 'both crawlers end at full HP');
  check(human.coins === PLENTY_OF_COINS - expected, 'the fee is charged once');
  check(treatments === 1, 'the treatment plays');
  check(panel.currentLine === say('sella', 'buy_healing'), 'Sella says buy_healing');

  const unhurt = buildInfirmaryMenu(party).options[0];
  check(unhurt.unavailable === 'Unhurt', 'the row is disabled at full HP');
  const topic = infirmaryTopics(party, host).topics(
    'sella',
    rig.villagers.contextFor('sella', human, null),
  )[0];
  const recording = recorder('sella');
  topic.run(recording.ctl);
  check(
    recording.said.join() === 'fully_healthy' && !recording.closed,
    'Treatment at full HP says fully_healthy and opens nothing',
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
  const rig = buildRig();
  if (rig === null) return;
  const { human, state } = rig;
  human.coins = PLENTY_OF_COINS;
  const ropeRow = (): { price: number; unavailable?: string } | undefined =>
    buildTradingPostMenu(state).options.find((option) => option.key === 'rope');
  check(ropeRow()?.price === EXPECTED_ROPE_PRICE, 'rope costs 6');
  const panel = openShop(tradingPostShop(state, () => undefined));
  panel.pressBuy('rope', human);
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
    check(opening.pages[0] === 'low_supplies', 'and Vetch opens on low_supplies');
  }
  const burgers = buildTradingPostMenu(state).options.find((option) => option.key === 'hamburger');
  check(
    burgers?.price === Math.round(EXPECTED_BURGER_PRICE * 1.25),
    'a full burger shelf is not "low"',
  );

  state.merchantStock.rope = 0;
  check(ropeRow()?.unavailable === 'Sold out', 'an empty shelf is sold out');
  const before = human.coins;
  openShop(tradingPostShop(state, () => undefined)).pressBuy('rope', human);
  check(human.coins === before, 'and sells nothing');

  restockTradingPost(state);
  check(
    buildTradingPostMenu(state).options.every((option) => option.unavailable === undefined) &&
      ropeRow()?.price === EXPECTED_ROPE_PRICE,
    'entering the floor restocks every shelf',
  );
  check(
    buildTradingPostMenu(createBriarHollowState()).options[2].desc.includes(
      `${EXPECTED_ROPE_BASE} left`,
    ),
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
  const grantOrder = [
    'grant_basic_tools',
    'explain_resource_gathering',
    'resourcing_skill_granted',
    'directions_to_lumber_yard',
    'directions_to_quarry',
  ];
  check(grant?.said.join() === grantOrder.join(), 'the grant and lesson play in order');
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
  grant?.ctl.close();
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
  teach?.ctl.close();
  check(
    teach?.said.join() === 'resourcing_skill_already_granted' && rig.explainerOpens === 2,
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
    panel.currentLine === say('oren', 'axe_upgrade_available'),
    'an affordable axe is announced first',
  );
  panel.pressBuy('axe', human);
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
      `${say('oren', 'upgrade_purchased')} ${say('oren', 'shared_upgrade_explanation')}`,
    'the first upgrade explains the sharing',
  );
  check(
    rig.events.some((event) => event.name === 'toolUpgraded'),
    'toolUpgraded fires',
  );
  human.coins = PLENTY_OF_COINS;
  for (let frame = 0; frame < UPGRADE_REBUY_GUARD_FRAMES; frame++) panel.update();
  panel.pressBuy('pickaxe', human);
  check(panel.currentLine === say('oren', 'upgrade_purchased'), 'the explanation is a one-shot');

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
  topPanel.pressBuy('axe', human);
  check(
    human.coins === coins && rig.crafts.tools.axeTier === 5,
    'buying past the top tier is refused',
  );
  check(topPanel.currentLine === say('oren', 'already_max_axe'), 'with already_max_axe');
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
  check(standAt(rig, 'rope'), 'a spot beside the rope frame exists');
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

function fennaHost(
  rig: Rig,
  picker: QuantityPicker,
  responses: Circumstance[][],
): LumberForemanHost {
  return {
    party: rig.party,
    state: rig.state,
    bus: rig.bus,
    audio: null,
    openPicker: (options) => picker.open(options),
    respond: (_ctl, lines) => responses.push([...lines]),
    announce: (message) => rig.announced.push(message),
    noteResourceActivity: () => undefined,
  };
}

function checkFenna(): void {
  section('Fenna');
  const rig = buildRig();
  if (rig === null) return;
  const { human, cat } = rig;
  const picker = new QuantityPicker(null);
  const responses: Circumstance[][] = [];
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
  );
  const batch = topics.find((topic) => topic.key === 'process_batch');
  const recording = recorder('fenna');
  batch?.run(recording.ctl);
  check(recording.said.join() === 'bulk_processing_service', 'the offer first');
  const choice = recording.submenu?.find((topic) => topic.key === 'rope');
  check(
    recording.submenu?.map((topic) => topic.key).join() === 'boards,rope',
    'then Boards or Rope',
  );
  human.coins = 0;
  choice?.run(recording.ctl);
  check(last(recording.said) === 'bulk_processing_rope_selected', 'Rope it is');
  check(picker.isOpen && picker.max === 7, 'the picker opens capped at the wood');
  picker.handleKey('Enter');
  check(
    last(responses)?.join() === 'bulk_processing_insufficient_fee' && picker.isOpen,
    'short of coin: she says so and the picker comes back',
  );
  human.coins = PLENTY_OF_COINS;
  picker.handleKey('Enter');
  check(last(responses)?.join() === 'bulk_processing_complete', 'paid: bulk_processing_complete');
  check(!picker.isOpen, 'and the picker closes');

  teachBoth(human, cat, 'construction');
  human.inventory.addItem('wood', 2);
  const first = runBatch(host, 'boards', 1);
  const second = runBatch(host, 'boards', 1);
  check(
    first?.join() === 'bulk_processing_complete,construction_experience',
    'the first batch after learning Construction remarks on it',
  );
  check(second?.join() === 'bulk_processing_complete', 'once only');
  check(
    human.craftSkills.getXp('construction') === 0,
    'paying Fenna to run a batch grants no Construction XP, even once the skill is learned',
  );
  check(
    rig.events.filter((event) => event.name === 'woodProcessed').length >= 3,
    'every batch fires woodProcessed',
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
  panel.pressBuy('axe', human);
  panel.pressBuy('axe', human);
  check(
    rig.crafts.tools.axeTier === 1 && human.coins === startingCoins - HARDENED_AXE_PRICE,
    'two presses inside the window upgrade once',
  );
  for (let frame = 0; frame < UPGRADE_REBUY_GUARD_FRAMES - 1; frame++) panel.update();
  panel.pressBuy('axe', human);
  check(rig.crafts.tools.axeTier === 1, "a press on the window's last frame is still refused");
  panel.update();
  panel.pressBuy('axe', human);
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
  town.pressBuy('x', human);
  town.pressBuy('x', human);
  check(sales === 2, 'a menu that asks for no guard still sells on every press');
}

function checkDeathDuringLesson(): void {
  section('Death and rewind during the lesson');
  const dead = buildRig();
  if (dead !== null) {
    setPhase(dead, 'need_tools');
    const lesson = runTopic(dead, 'oren', 'tools');
    dead.human.hp = 0;
    lesson?.ctl.close();
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
    lesson?.ctl.close();
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
  setPhase(rig, 'gathering');
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
  setPhase(rig, 'gathering');
  const host = forgeHostFor(rig, rig.partyTools);
  const direct = forgeTopics(host).topics(
    'oren',
    rig.villagers.contextFor('oren', rig.human, null),
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
checkSawmill();
checkFenna();
checkSiegeClosure();
checkDoublePress();
checkDeathDuringLesson();
checkPanelsAndPrompt();

console.log(
  `\n${checks - failures}/${checks} checks passed${fault === null ? '' : ` (fault: ${fault})`}.`,
);
if (failures > 0) process.exit(1);
