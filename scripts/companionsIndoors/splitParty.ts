/**
 * A split party: the crawlers on different maps, one group live.
 *
 * - An away crawler is never placed, ticked or offered as a partner.
 * - A split written to a save reads back as the same split, and a broken one is refused.
 * - The death check ignores an away crawler, however it was left.
 * - Switching is refused while the other crawler is away, with a reason.
 * - A hand-over writes a save holding the chapter about to start, then moves the party.
 * - A hire goes with its group: it stands up only while that group is live,
 *   and is put away, its health written, when its group is handed away.
 * - A hand-over's save resumes at the chapter about to start, not where a
 *   crawler stood on the map being left.
 * - An away crawler stoops for no loot on this map.
 * - The cat away cannot bring Deinonychus out here, by summon or through a door.
 * - A cat ally goes with her group and is gone while it is away.
 *
 * Every case has a `--fault=` that injects the regression it exists to catch.
 */

import { TILE_SIZE } from '../../src/core/constants';
import { PlayerManager } from '../../src/core/party/PlayerManager';
import {
  capturePartySplit,
  createPartySplitState,
  formSplit,
  parsePartySplitSnapshot,
  presenceOf,
  PARTY_TOGETHER,
  WHOLE_PARTY_PRESENT,
  type PartyFormation,
  type PartyGroupDraft,
  type PartyGroupId,
  type PartyLocation,
  type PartySplitState,
} from '../../src/core/party/partySplit';
import { createMercenaryRoster } from '../../src/core/party/MercenaryRoster';
import { PetNameBook } from '../../src/core/party/petNames';
import { createDeinonychusPetState } from '../../src/core/state/DeinonychusPetState';
import { getDeinonychusStats } from '../../src/abilities/deinonychus';
import {
  getMercenaryTemplate,
  type MercenaryTemplateId,
} from '../../src/core/party/mercenaryTemplates';
import { TOWN_TOWER_ID } from '../../src/map/buildingIds';
import { GameMap } from '../../src/map/GameMap';
import { FloorTypeValue, type TileContent } from '../../src/map/tileTypes';
import { CatAllySystem } from '../../src/systems/CatAllySystem';
import { DeinonychusSystem } from '../../src/systems/DeinonychusSystem';
import { checkDeath } from '../../src/systems/GameLoopPhases';
import { LootSystem } from '../../src/systems/LootSystem';
import type { SystemContext } from '../../src/systems/GameSystem';
import { MercenarySystem } from '../../src/systems/MercenarySystem';
import { MobRoster } from '../../src/systems/kits/SceneWorld';
import { SpellSystem } from '../../src/systems/SpellSystem';
import { SplitDirector } from '../../src/systems/partySplit/SplitDirector';
import type { ArrivalCard, PartyTransferRequest } from '../../src/systems/partySplit/partyTransfer';
import { cameraAt, UNZOOMED } from '../../src/core/rendering/camera.js';

export const SPLIT_PARTY_FAULTS = [
  'away-crawler-placed',
  'split-lost-on-save',
  'death-counts-away',
  'switch-allowed',
  'handover-unsaved',
  'hire-leaves-group',
  'handover-saves-stale',
  'away-picks-up-loot',
  'away-cat-summons',
  'hire-body-stays',
  'cat-ally-stays',
] as const;
export type SplitPartyFault = (typeof SPLIT_PARTY_FAULTS)[number];

export function isSplitPartyFault(value: string): value is SplitPartyFault {
  return SPLIT_PARTY_FAULTS.some((fault) => fault === value);
}

type Check = (ok: boolean, message: string) => void;

const ROOM_W_TILES = 24;
const ROOM_H_TILES = 14;
const PARTY_TILE = { x: 4, y: 6 } as const;
const LANDING_TILE = { x: 14, y: 8 } as const;
const AWAY_TILE = { x: 2, y: 2 } as const;
const CATTERY_STOREY = 5;
const CISTERN_STOREY = 0;
const ARCHIVE_STOREY = 4;
const HIRE: MercenaryTemplateId = 'crush';
const HIRE_FLOOR = 'level3';
const HIRE_SETTLE_FRAMES = 3;
const LOOT_COINS = 7;
const LOOT_SETTLE_FRAMES = 2;
const DEINONYCHUS_LEVEL = 5;
const CAT_ALLY = 'tower_cattery_cellmate' as const;
const TILE_CENTRE = 0.5;

const CARD: ArrivalCard = {
  kicker: 'Meanwhile…',
  title: 'Elsewhere',
  screen: { tips: ['The other half of the party is somewhere else.'] },
};

function at(storey: number, tile: { readonly x: number; readonly y: number }): PartyLocation {
  return { kind: 'interior', building: TOWN_TOWER_ID, storey, tile };
}

function makeRoom(): GameMap {
  const lastX = ROOM_W_TILES - 1;
  const lastY = ROOM_H_TILES - 1;
  const grid: TileContent[][] = Array.from({ length: ROOM_H_TILES }, (_, y) =>
    Array.from({ length: ROOM_W_TILES }, (_, x) => ({
      tileId: `${x}#${y}`,
      type:
        x === 0 || y === 0 || x === lastX || y === lastY
          ? FloorTypeValue.wall
          : FloorTypeValue.tile_floor,
    })),
  );
  return new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
}

function catAloneDrafts(): Record<PartyGroupId, PartyGroupDraft> {
  return {
    first: { crawlers: ['cat'], companions: [], at: at(CATTERY_STOREY, PARTY_TILE) },
    second: {
      crawlers: ['human'],
      companions: [{ kind: 'mercenary', hire: HIRE }],
      at: at(CISTERN_STOREY, PARTY_TILE),
    },
  };
}

function splitOrThrow(live: PartyGroupId): PartyFormation {
  const formed = formSplit(catAloneDrafts(), live);
  if (!formed.ok) throw new Error(`the harness split is invalid: ${formed.reason}`);
  return formed.formation;
}

/** A party built as a scene builds it, bound to a run's split state. */
function splitParty(live: PartyGroupId): { pm: PlayerManager; state: PartySplitState } {
  const pm = new PlayerManager(PARTY_TILE.x, PARTY_TILE.y, undefined);
  const state = createPartySplitState();
  pm.bindPartySplit(state);
  pm.human.x = AWAY_TILE.x * TILE_SIZE;
  pm.human.y = AWAY_TILE.y * TILE_SIZE;
  state.formation = splitOrThrow(live);
  pm.steerLiveGroup();
  return { pm, state };
}

/** What the fault stands in for: the formation never reaching a crawler's presence. */
function forgetFormation(pm: PlayerManager): void {
  pm.human.bindPresence(() => true);
  pm.cat.bindPresence(() => true);
}

function checkAwayCrawlerNeverPlaced(check: Check, fault: SplitPartyFault | null): void {
  const { pm } = splitParty('first');
  if (fault === 'away-crawler-placed') forgetFormation(pm);
  const awayX = pm.human.x;
  const awayY = pm.human.y;
  pm.setPartyDown({ leader: LANDING_TILE, follower: { x: LANDING_TILE.x + 1, y: LANDING_TILE.y } });
  check(pm.active() === pm.cat, "the steered crawler is the live group's, the cat");
  check(
    pm.human.x === awayX && pm.human.y === awayY,
    'setting the party down leaves the away human where the hand-over froze him',
  );
  check(
    pm.presentCrawlers().length === 1 && pm.presentCrawlers()[0] === pm.cat,
    'only the cat is present',
  );
  check(pm.presentPartner() === null, "the away human is nobody's partner on this map");
  check(
    pm.wholeParty().includes(pm.human) && pm.partnerAnywhere() === pm.human,
    'the roster still names the away human for rewards and the HUD',
  );
  check(
    pm.human.hiddenFromMobs && !pm.human.canBeHarmed,
    'the away human can be neither seen nor hurt',
  );
}

function checkSplitSurvivesSave(check: Check, fault: SplitPartyFault | null): void {
  const { state } = splitParty('second');
  const captured = capturePartySplit(state);
  const written =
    fault === 'split-lost-on-save' ? { ...captured, formation: PARTY_TOGETHER } : captured;
  const json: unknown = JSON.parse(JSON.stringify(written));
  const read = parsePartySplitSnapshot(json);
  const formation = read?.formation;
  check(formation?.kind === 'split', 'a split written to a save reads back split');
  if (formation?.kind !== 'split') return;
  check(formation.live === 'second', 'the live group reads back');
  const second = formation.groups.second;
  check(
    second.crawlers.includes('human') &&
      second.companions.some((ref) => ref.kind === 'mercenary' && ref.hire === HIRE) &&
      second.at.kind === 'interior' &&
      second.at.storey === CISTERN_STOREY,
    "each group's crawlers, companions and place read back",
  );
  const drafts = catAloneDrafts();
  const broken = {
    formation: {
      kind: 'split',
      live: 'first',
      groups: { ...drafts, first: { ...drafts.first, crawlers: ['cat', 'human'] } },
    },
    exchange: captured.exchange,
  };
  check(
    parsePartySplitSnapshot(broken) === undefined,
    'a saved split with one crawler in two groups is refused',
  );
}

function checkDeathIgnoresAway(check: Check, fault: SplitPartyFault | null): void {
  const { pm } = splitParty('first');
  pm.human.hp = 0;
  const judged = fault === 'death-counts-away' ? pm.wholeParty() : pm.presentCrawlers();
  check(!checkDeath(judged), 'an away crawler at no health ends nothing on this map');
  pm.cat.hp = 0;
  check(checkDeath(pm.presentCrawlers()), 'the live crawler dying still ends the run');
}

function checkSwitchRefused(check: Check, fault: SplitPartyFault | null): void {
  const { pm } = splitParty('first');
  if (fault === 'switch-allowed') forgetFormation(pm);
  const refusal = pm.switchRefusal();
  check(refusal !== null && refusal.length > 0, `switching is refused with a reason (${refusal})`);
  pm.switchActive();
  check(pm.active() === pm.cat, 'a refused switch leaves the cat steered');
}

function checkHandOverSaves(check: Check, fault: SplitPartyFault | null): void {
  const { pm, state } = splitParty('first');
  const livesAtSave: PartyGroupId[] = [];
  const savedAt: PartyLocation[] = [];
  const transfers: PartyTransferRequest[] = [];
  const director = new SplitDirector({
    state,
    locateLiveGroup: () => at(ARCHIVE_STOREY, LANDING_TILE),
    save: (chapterStart) => {
      if (fault === 'handover-unsaved') return;
      if (state.formation.kind === 'split') livesAtSave.push(state.formation.live);
      const staleSteeredSpot = at(ARCHIVE_STOREY, {
        x: Math.floor(pm.active().x / TILE_SIZE),
        y: Math.floor(pm.active().y / TILE_SIZE),
      });
      savedAt.push(fault === 'handover-saves-stale' ? staleSteeredSpot : chapterStart);
    },
    transfer: (request) => transfers.push(request),
    onFormationChanged: () => pm.steerLiveGroup(),
  });
  director.handOver('second', CARD);
  check(livesAtSave.length === 1, `a hand-over writes one save (${livesAtSave.length})`);
  check(livesAtSave[0] === 'second', 'the save holds the chapter about to start');
  const [saveSpot] = savedAt;
  check(
    saveSpot?.kind === 'interior' &&
      saveSpot.storey === CISTERN_STOREY &&
      saveSpot.tile.x === PARTY_TILE.x &&
      saveSpot.tile.y === PARTY_TILE.y,
    "the save resumes where the new live group's chapter starts",
  );
  check(pm.active() === pm.human, 'the steered crawler follows the hand-over');
  const handed = state.formation;
  const recorded =
    handed.kind === 'split' &&
    handed.groups.first.at.kind === 'interior' &&
    handed.groups.first.at.storey === ARCHIVE_STOREY;
  check(recorded, 'the group handed away from is recorded where it stood');
  const [moved] = transfers;
  check(
    transfers.length === 1 &&
      moved.to.kind === 'interior' &&
      moved.to.storey === CISTERN_STOREY &&
      moved.card === CARD,
    'the party is moved to the new live group behind the given card',
  );
}

function hireContext(pm: PlayerManager, map: GameMap, roster: MobRoster): SystemContext {
  return {
    human: pm.human,
    cat: pm.cat,
    active: pm.active(),
    partner: pm.presentPartner(),
    activeIsMoving: false,
    roster,
    gameMap: map,
    camera: cameraAt({ x: 0, y: 0 }, UNZOOMED),
  };
}

function checkHireStaysWithGroup(check: Check, fault: SplitPartyFault | null): void {
  const map = makeRoom();
  const { pm, state } = splitParty('first');
  pm.cat.setMap(map);
  pm.cat.x = PARTY_TILE.x * TILE_SIZE;
  pm.cat.y = PARTY_TILE.y * TILE_SIZE;
  const roster = createMercenaryRoster();
  roster.active = {
    id: HIRE,
    name: getMercenaryTemplate(HIRE).name,
    terms: 'paid',
    contractLevelId: HIRE_FLOOR,
    introduced: true,
  };
  const presence =
    fault === 'hire-leaves-group' ? WHOLE_PARTY_PRESENT : presenceOf(() => state.formation);
  const mobs = new MobRoster(map, new SpellSystem());
  const system = new MercenarySystem(roster, HIRE_FLOOR, undefined, undefined, presence);
  for (let frame = 0; frame < HIRE_SETTLE_FRAMES; frame++)
    system.update(hireContext(pm, map, mobs));
  check(
    system.activeMerc === null,
    'a hire whose group is away does not stand up beside the other group',
  );

  state.formation = splitOrThrow('second');
  pm.steerLiveGroup();
  pm.human.x = PARTY_TILE.x * TILE_SIZE;
  pm.human.y = PARTY_TILE.y * TILE_SIZE;
  const ownMobs = new MobRoster(map, new SpellSystem());
  const ownSystem = new MercenarySystem(roster, HIRE_FLOOR, undefined, undefined, presence);
  for (let frame = 0; frame < HIRE_SETTLE_FRAMES; frame++) {
    ownSystem.update(hireContext(pm, map, ownMobs));
  }
  check(
    ownSystem.activeMerc?.owner === pm.human,
    'with its group live, the hire follows its own crawler',
  );
}

function checkAwayCrawlerTakesNoLoot(check: Check, fault: SplitPartyFault | null): void {
  const map = makeRoom();
  const { pm } = splitParty('first');
  const loot = new LootSystem(map);
  const pileX = (AWAY_TILE.x + TILE_CENTRE) * TILE_SIZE;
  const pileY = (AWAY_TILE.y + TILE_CENTRE) * TILE_SIZE;
  loot.addLoot(pileX, pileY, { coins: LOOT_COINS, items: [] }, pm.human);
  const coinsBefore = pm.human.coins + pm.cat.coins;
  const mobs = new MobRoster(map, new SpellSystem());
  const ctx = hireContext(pm, map, mobs);
  const lootCtx = fault === 'away-picks-up-loot' ? { ...ctx, partner: pm.partnerAnywhere() } : ctx;
  for (let frame = 0; frame < LOOT_SETTLE_FRAMES; frame++) loot.update(lootCtx);
  check(
    pm.human.coins + pm.cat.coins === coinsBefore,
    'a pile at the away crawler’s frozen spot is not picked up',
  );
}

function makeDeinonychusSystem(): DeinonychusSystem {
  const ignore = (): void => {
    // Nothing here reads XP or announcements.
  };
  const maxHp = getDeinonychusStats(DEINONYCHUS_LEVEL).maxHp;
  const system = new DeinonychusSystem(
    createDeinonychusPetState(maxHp, maxHp),
    () => DEINONYCHUS_LEVEL,
    ignore,
    () => 0,
    { post: ignore, isShowing: () => false },
    new PetNameBook(),
  );
  system.unlocked = true;
  return system;
}

function checkAwayCatBringsNoPet(check: Check, fault: SplitPartyFault | null): void {
  const map = makeRoom();
  const { pm } = splitParty('second');
  if (fault === 'away-cat-summons') forgetFormation(pm);
  pm.cat.setMap(map);
  const summoned = makeDeinonychusSystem().summon(pm.cat, map);
  check(summoned === null, 'the away cat cannot summon Deinonychus onto this map');
  const carried = makeDeinonychusSystem().carryIn(pm.cat, map);
  check(carried === null, 'Deinonychus is not carried through a door beside the away cat');
}

function checkHireBodyPutAwayWithGroup(check: Check, fault: SplitPartyFault | null): void {
  const map = makeRoom();
  const { pm, state } = splitParty('second');
  pm.human.x = PARTY_TILE.x * TILE_SIZE;
  pm.human.y = PARTY_TILE.y * TILE_SIZE;
  const roster = createMercenaryRoster();
  roster.active = {
    id: HIRE,
    name: getMercenaryTemplate(HIRE).name,
    terms: 'paid',
    contractLevelId: HIRE_FLOOR,
    introduced: true,
  };
  const presence =
    fault === 'hire-body-stays' ? WHOLE_PARTY_PRESENT : presenceOf(() => state.formation);
  const mobs = new MobRoster(map, new SpellSystem());
  const system = new MercenarySystem(roster, HIRE_FLOOR, undefined, undefined, presence);
  for (let frame = 0; frame < HIRE_SETTLE_FRAMES; frame++) {
    system.update(hireContext(pm, map, mobs));
  }
  const standing = system.activeMerc;
  check(standing !== null, 'the hire stands up beside its live group');
  if (standing === null) return;
  const woundedHp = Math.max(1, standing.hp - 1);
  standing.hp = woundedHp;

  state.formation = splitOrThrow('first');
  pm.steerLiveGroup();
  pm.cat.setMap(map);
  system.update(hireContext(pm, map, mobs));
  check(
    system.activeMerc === null && !mobs.mobs.includes(standing),
    "the hire's body leaves the map once its group is handed away",
  );
  check(roster.active?.hp === woundedHp, 'the hire’s health is written back as it goes');
}

function checkCatAllyGoesWithGroup(check: Check, fault: SplitPartyFault | null): void {
  const map = makeRoom();
  const { pm, state } = splitParty('first');
  pm.cat.setMap(map);
  const drafts = catAloneDrafts();
  const withAlly = formSplit(
    {
      ...drafts,
      first: { ...drafts.first, companions: [{ kind: 'cat_ally', ally: CAT_ALLY }] },
    },
    'first',
  );
  if (!withAlly.ok) throw new Error(`the harness split is invalid: ${withAlly.reason}`);
  state.formation = withAlly.formation;
  pm.steerLiveGroup();
  const presence =
    fault === 'cat-ally-stays' ? WHOLE_PARTY_PRESENT : presenceOf(() => state.formation);
  const ally = new CatAllySystem(CAT_ALLY, presence);
  ally.followCrawler('human');
  const mobs = new MobRoster(map, new SpellSystem());
  ally.bringOut(pm.cat, map, mobs);
  ally.update(hireContext(pm, map, mobs));
  check(ally.body?.owner === pm.cat, 'with her group live she follows its crawler, the cat');

  const handedAway = formSplit(
    {
      ...drafts,
      first: { ...drafts.first, companions: [{ kind: 'cat_ally', ally: CAT_ALLY }] },
    },
    'second',
  );
  if (!handedAway.ok) throw new Error(`the harness split is invalid: ${handedAway.reason}`);
  state.formation = handedAway.formation;
  pm.steerLiveGroup();
  ally.update(hireContext(pm, map, mobs));
  check(ally.body === null, 'she is gone from the map while her group is away');
  ally.dispose();
}

/** Every split-party case, each red under its own `--fault=`. */
export function checkSplitParty(check: Check, fault: SplitPartyFault | null): void {
  checkAwayCrawlerNeverPlaced(check, fault);
  checkSplitSurvivesSave(check, fault);
  checkDeathIgnoresAway(check, fault);
  checkSwitchRefused(check, fault);
  checkHandOverSaves(check, fault);
  checkHireStaysWithGroup(check, fault);
  checkAwayCrawlerTakesNoLoot(check, fault);
  checkAwayCatBringsNoPet(check, fault);
  checkHireBodyPutAwayWithGroup(check, fault);
  checkCatAllyGoesWithGroup(check, fault);
}
