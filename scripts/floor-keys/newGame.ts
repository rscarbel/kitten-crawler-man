/**
 * Floor 3's run end and the new game it starts: what `NEW_GAME_CARRY` keeps
 * and resets, the hire carried through every floor change, the carried
 * Wayfinder's Anchor staying dead below Taloncrest, and the anchor's fragment
 * issued with its ceremony on the new run's first arrival on floor 3.
 */

import type { GameProgressInput } from '../../src/auth/AuthClient';
import { TILE_SIZE } from '../../src/core/constants';
import { DOUBLE_DAMAGE_STATUS, makeDoubleDamage } from '../../src/core/combat/StatusEffect';
import { EventBus } from '../../src/core/EventBus';
import { KeyRing } from '../../src/core/keys/KeyRing';
import {
  contractIsCurrent,
  createMercenaryRoster,
  restoreMercenaryRoster,
  captureMercenaryRoster,
  type HiredMercenary,
  type MercenaryRoster,
} from '../../src/core/party/MercenaryRoster';
import { getMercenaryTemplate } from '../../src/core/party/mercenaryTemplates';
import {
  createAnchorQuestProgress,
  type AnchorQuestProgress,
} from '../../src/core/quests/AnchorQuestProgress';
import { AbilityManager } from '../../src/core/skills/AbilityManager';
import { AchievementManager } from '../../src/core/progression/AchievementManager';
import { GameStats } from '../../src/core/progression/GameStats';
import { MusicLibrary } from '../../src/core/music/MusicLibrary';
import { createPartyCraftsState } from '../../src/core/labour/partyCrafts';
import { createWheelQuestFreeSpins } from '../../src/core/save/WheelLedger';
import { snapPlayer } from '../../src/core/save/PlayerSnapshot';
import { NEW_GAME_LEVEL_ID, newGameProgress } from '../../src/core/save/newGame';
import {
  anchorProgressCarrying,
  newGameCarryOf,
  rosterCarrying,
  runCarryOf,
  type NewGameCarry,
} from '../../src/core/save/newGameCarry';
import {
  NEW_GAME_CARRY,
  parseGameProgress,
  stampGameProgress,
} from '../../src/core/save/saveFormat';
import type { RunSaveFieldKey, RunSaveFields } from '../../src/core/save/saveFormat';
import { playerIdentity } from '../../src/characters/playerIdentity';
import { CatPlayer } from '../../src/creatures/CatPlayer';
import { HumanPlayer } from '../../src/creatures/HumanPlayer';
import { getLevelDef } from '../../src/levels';
import type { LevelId } from '../../src/levels/levelIds';
import { GameMap } from '../../src/map/GameMap';
import { MercenarySystem } from '../../src/systems/MercenarySystem';
import { RecallSystem } from '../../src/systems/RecallSystem';
import { createTownMemory } from '../../src/core/state/TownMemory';
import { createBriarHollowState } from '../../src/core/quests/briarHollowState';
import { CarriedAnchorWake, isCarriedAnchorMoment } from '../../src/systems/keys/CarriedAnchorWake';
import { KEY_CUES } from '../../src/audio/keySoundCues';
import type { SoundId } from '../../src/audio/sounds';
import { keyHarness, ledgerOf, type FloorKeysSection } from './shared';

const HIRE = 'crush';
const HIRE_FLOOR: LevelId = 'level3';
const CARRIED_LEVEL = 21;
const CARRIED_COINS = 4321;
const CARRIED_MELEE = 17;
const CARRIED_HIRE_HP = 9;
const COW_HP = 33;
const PET_HP = 41;
const PLAYED_FRAMES = 999_999;
const JUGG_JUICE_LOAN = 25;
const AWAKENING_KILLS = 12;
/** A piece of gear the human wears. */
const WORN_GEAR = 'hobnail_boots';
/** A quest's own item, which stays behind with the world it belongs to. */
const QUEST_ITEM = 'quest_key_ring';
/** Something plainly the party's own, which carries. */
const PARTY_ITEM = 'hamburger';
/** Comfortably past the anchor's wake. */
const WAKE_TICKS = 600;
/** The floors below Taloncrest, where the stone stays dead. */
const UNDERGROUND_FLOORS: readonly LevelId[] = ['level1', 'level2'];
const OVERWORLD_FLOOR: LevelId = 'level3';

function deskHire(levelId: LevelId, terms: HiredMercenary['terms'] = 'paid'): HiredMercenary {
  return {
    id: HIRE,
    name: getMercenaryTemplate(HIRE).name,
    terms,
    contract: { kind: 'floor', levelId },
    introduced: true,
    hp: CARRIED_HIRE_HP,
  };
}

function rosterOn(levelId: LevelId, active: HiredMercenary | null): MercenaryRoster {
  const roster = createMercenaryRoster();
  roster.floorLevelId = levelId;
  roster.active = active;
  return roster;
}

function completedAnchor(): AnchorQuestProgress {
  return { ...createAnchorQuestProgress(), status: 'completed' };
}

/** The save the run end is built from: a floor-3 party with gear, pets, a hire on tower-loan terms and a world. */
function runEndSave(): GameProgressInput & RunSaveFields {
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(0, 0, TILE_SIZE);
  human.level = CARRIED_LEVEL;
  human.coins = CARRIED_COINS;
  const humanSnap = snapPlayer(human);
  humanSnap.baseStats.melee = CARRIED_MELEE;
  humanSnap.inventorySlots[0] = { id: QUEST_ITEM, quantity: 1 };
  humanSnap.inventorySlots[1] = { id: PARTY_ITEM, quantity: 2 };
  humanSnap.statusEffects = [makeDoubleDamage()];
  humanSnap.juggJuiceHpBoost = JUGG_JUICE_LOAN;
  humanSnap.maxHp += JUGG_JUICE_LOAN;
  humanSnap.gearState = [
    [
      WORN_GEAR,
      {
        awakeningKills: AWAKENING_KILLS,
        awakened: false,
        bound: true,
        floorOnceSpent: ['ninthLife'],
        cooldownFrames: {},
      },
    ],
  ];
  const stats = new GameStats();
  stats.restore({ ...stats.snapshot(), framesPlayed: PLAYED_FRAMES });
  return {
    levelId: 'level3',
    humanSnap,
    catSnap: snapPlayer(cat),
    abilityStates: new AbilityManager().serializeStates(),
    deinonychusUnlocked: true,
    deinonychusPetHp: PET_HP,
    deinonychusPetResting: false,
    crafts: createPartyCraftsState(),
    humanAchievements: new AchievementManager().serialize(),
    catAchievements: new AchievementManager().serialize(),
    gameStats: stats.snapshot(),
    wheelPrizesWon: ['permanent_death'],
    pendingWheelOutcome: null,
    wheelFreeSpinBet: null,
    wheelOwedFreeze: null,
    wheelQuestFreeSpins: createWheelQuestFreeSpins(),
    doubleDamageRemaining: { human: 1, cat: 0 },
    attackCowOwned: true,
    attackCowHp: COW_HP,
    attackCowResting: false,
    musicLibrary: new MusicLibrary().serialize(),
    storyBeatsSeen: ['skipped_tutorial_dave_intro', 'floor3_caroline_arrival'],
    objectivesBriefed: ['anchor_offer'],
    petNames: {},
    playerIdentity: playerIdentity(),
    carried: runCarryOf({ roster: createMercenaryRoster(), anchor: createAnchorQuestProgress() }),
  };
}

function isRunSaveFieldKey(key: string): key is RunSaveFieldKey {
  return key in NEW_GAME_CARRY;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const newGameCarriesTheParty: FloorKeysSection = {
  name: 'a new game keeps the party and starts the world again',
  run(check) {
    const current = runEndSave();
    const world = {
      roster: rosterOn(HIRE_FLOOR, deskHire(HIRE_FLOOR, 'tower_loan')),
      anchor: completedAnchor(),
    };
    const carry = newGameCarryOf(world);
    const next = newGameProgress(current, carry);

    check(next.levelId === NEW_GAME_LEVEL_ID, 'the new game begins on floor 1');
    check(next.humanSnap.level === CARRIED_LEVEL, "the human's level carries");
    check(next.humanSnap.baseStats.melee === CARRIED_MELEE, "the human's attributes carry");
    check(next.humanSnap.coins === CARRIED_COINS, "the human's coins carry");
    check(
      same(next.humanSnap.equippedEntries, current.humanSnap.equippedEntries),
      'equipment carries',
    );
    check(
      next.humanSnap.inventorySlots.some((slot) => slot?.id === PARTY_ITEM),
      "the party's own items carry",
    );
    check(
      !next.humanSnap.inventorySlots.some((slot) => slot?.id === QUEST_ITEM),
      "a quest's own item stays behind with its quest",
    );

    const carried = Object.keys(NEW_GAME_CARRY)
      .filter(isRunSaveFieldKey)
      .filter((field) => NEW_GAME_CARRY[field] === 'carry');
    for (const field of carried) {
      check(same(current[field], next[field]), `${field} carries, as NEW_GAME_CARRY says`);
    }
    check(next.gameStats.framesPlayed === 0, "the run's tallies start again");
    check(
      same(next.wheelPrizesWon, current.wheelPrizesWon),
      "the wheel's one-time prizes stay won, since the party still holds them",
    );
    check(
      next.wheelQuestFreeSpins.earnedBy.length === 0,
      "the wheel's quest-earned spins start again",
    );
    check(next.storyBeatsSeen.length === 0, 'the story starts again');
    check(next.objectivesBriefed.length === 0, "Caroline's briefings start again");
    check(next.doubleDamageRemaining.human === 0, "the wheel's double damage curse does not carry");
    check(
      !next.humanSnap.statusEffects.some((status) => status.type === DOUBLE_DAMAGE_STATUS),
      "no double damage status rides into the new game's crawler",
    );
    check(next.humanSnap.statusEffects.length === 0, 'the new game starts clean of every status');
    check(
      next.humanSnap.juggJuiceHpBoost === 0 &&
        next.humanSnap.maxHp === current.humanSnap.maxHp - JUGG_JUICE_LOAN,
      "a Jugg Juice's loaned health stays behind",
    );
    const gear = next.humanSnap.gearState.find(([id]) => id === WORN_GEAR)?.[1];
    check(
      gear?.floorOnceSpent.length === 0,
      "a piece's once-per-floor effects are ready on the new floor 1",
    );
    check(gear?.bound === false, 'a cursed bind from the old world is lifted');
    check(gear?.awakeningKills === AWAKENING_KILLS, "a piece's progress toward awakening carries");
    check(
      same(next.musicLibrary, MusicLibrary.skippingTutorial().serialize()),
      'the songs start again, as a run that skipped the tutorial',
    );

    const hire = next.carried.hire;
    check(hire?.id === HIRE, 'the hire carries');
    check(hire?.contract.kind === 'carried', 'the hire carries on a carried contract');
    check(
      hire?.terms === 'paid',
      'a tower loan carries as a plain hire, so the Warden cannot end it',
    );
    check(hire?.hp === CARRIED_HIRE_HP, "the hire's health carries");
    check(next.carried.anchorRepaired, "the anchor's repair carries");
    check(
      anchorProgressCarrying(next.carried).status === 'completed',
      'the anchor quest starts complete',
    );
    const fresh = rosterCarrying(next.carried);
    check(
      !fresh.towerLoanSigned && fresh.lastDeceased === null,
      'the desk forgets the old loan and the dead',
    );

    const reloaded = parseGameProgress(JSON.parse(JSON.stringify(stampGameProgress(next))));
    check(reloaded !== null, "the new game's save parses back");
    check(same(reloaded?.carried, next.carried), 'what the run carries survives the save');
    const nothingCarried = newGameCarryOf({
      roster: rosterOn(HIRE_FLOOR, null),
      anchor: createAnchorQuestProgress(),
    });
    check(
      nothingCarried.hire === null && !nothingCarried.anchorRepaired,
      'a party with no hire and no anchor carries neither',
    );
  },
};

/** The roster the next floor's scene starts from, built as a floor change builds it. */
function acrossTheStairs(
  roster: MercenaryRoster,
  anchor: AnchorQuestProgress,
  to: LevelId,
): MercenaryRoster {
  const next = rosterCarrying(runCarryOf({ roster, anchor }));
  next.floorLevelId = to;
  return next;
}

const carriedHireSurvivesFloors: FloorKeysSection = {
  name: 'a carried hire walks through every floor change; a desk hire does not',
  run(check) {
    const anchor = completedAnchor();
    const carry: NewGameCarry = newGameCarryOf({
      roster: rosterOn(HIRE_FLOOR, deskHire(HIRE_FLOOR)),
      anchor,
    });
    let roster = rosterCarrying(carry);
    let system = new MercenarySystem(roster, 'level1');
    for (const to of ['level2', 'level3'] satisfies LevelId[]) {
      const atFloorEntry = captureMercenaryRoster(roster);
      system.endContractForFloor();
      check(roster.active?.id === HIRE, `the carried hire outlives the floor's end before ${to}`);
      roster = acrossTheStairs(roster, anchor, to);
      system = new MercenarySystem(roster, to);
      check(
        roster.active !== null && contractIsCurrent(roster, roster.active),
        `the carried hire stands on ${to}`,
      );
      restoreMercenaryRoster(roster, atFloorEntry);
      check(
        roster.active?.id === HIRE,
        `a checkpoint from the floor before ${to} keeps the carried hire`,
      );
    }

    const ordinary = rosterOn('level1', deskHire('level1'));
    const ordinaryEntry = captureMercenaryRoster(ordinary);
    new MercenarySystem(ordinary, 'level1').endContractForFloor();
    check(ordinary.active === null, "a desk hire's contract ends with its floor");
    const below = acrossTheStairs(rosterOn('level1', deskHire('level1')), anchor, 'level2');
    check(below.active === null, 'a desk hire does not follow the party down the stairs');
    restoreMercenaryRoster(below, ordinaryEntry);
    check(
      below.active === null,
      'a checkpoint from the floor above does not hand a desk hire back',
    );
  },
};

function recallOn(
  levelId: LevelId,
  anchor: AnchorQuestProgress,
): { toasts: string[]; menus: number } {
  const toasts: string[] = [];
  let menus = 0;
  const recall = new RecallSystem(
    new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] }),
    getLevelDef(levelId),
    new EventBus(),
    () => false,
    () => false,
    () => true,
    (message) => toasts.push(message),
    null,
    { townMemory: createTownMemory(), briarHollow: createBriarHollowState(), anchor },
    () => menus++,
    () => null,
  );
  recall.requestTravel(new HumanPlayer(0, 0, TILE_SIZE));
  return { toasts, menus };
}

const carriedAnchorStaysDead: FloorKeysSection = {
  name: 'a carried anchor sleeps below Taloncrest and wakes on floor 3',
  run(check) {
    const carried = anchorProgressCarrying({ hire: null, anchorRepaired: true });
    for (const levelId of UNDERGROUND_FLOORS) {
      const press = recallOn(levelId, carried);
      check(press.menus === 0, `the carried anchor will not travel on ${levelId}`);
      check(
        press.toasts.some((toast) => toast.includes('Taloncrest')),
        `on ${levelId} its holder is told it wakes in Taloncrest`,
      );
    }
    const home = recallOn(OVERWORLD_FLOOR, carried);
    check(
      home.menus === 1 && home.toasts.length === 0,
      'on floor 3 the carried anchor opens its travel menu',
    );
  },
};

function fakeAudio(played: SoundId[]): {
  play: (id: SoundId) => void;
  playAt: (id: SoundId) => void;
} {
  return { play: (id) => played.push(id), playAt: (id) => played.push(id) };
}

const anchorFragmentOnArrival: FloorKeysSection = {
  name: "a carried run's first arrival on floor 3 issues the anchor's fragment with a ceremony",
  run(check) {
    const anchor = anchorProgressCarrying({ hire: null, anchorRepaired: true });
    const ledger = ledgerOf({ quests: anchor.status === 'completed' ? ['anchor_shards'] : [] });
    const ring = new KeyRing(OVERWORLD_FLOOR);
    const first = keyHarness(OVERWORLD_FLOOR, ring);
    first.keys.reconcile(ledger);
    const moment = first.keys.nextMoment();
    check(isCarriedAnchorMoment(moment), 'its ceremony is queued, as the carried-in award');

    const played: SoundId[] = [];
    const wake = new CarriedAnchorWake(() => first.keys.nextMoment(), fakeAudio(played));
    check(wake.holdsCeremony(), 'the ceremony waits for the anchor to wake');
    wake.tickSettled();
    check(
      played.some((id) => KEY_CUES.anchorWake.some((take) => take === id)),
      'the anchor wakes with its sound',
    );
    let brightest = 0;
    for (let tick = 0; tick < WAKE_TICKS && wake.holdsCeremony(); tick++) {
      brightest = Math.max(brightest, wake.pulse);
      wake.tickSettled();
    }
    check(brightest > 0, 'the anchor pulses on the hotbar while it wakes');
    check(!wake.holdsCeremony(), 'once the anchor has woken, its fragment ceremony may open');
    first.keys.beginMoment();
    check(first.claimed.length === 1, "the anchor's fragment is issued as its ceremony opens");

    const reload = new KeyRing(OVERWORLD_FLOOR);
    reload.restore(ring.capture());
    const later = keyHarness(OVERWORLD_FLOOR, reload);
    later.keys.reconcile(ledger);
    check(later.claimed.length === 0, 'a later build of the floor issues nothing again');
    check(later.keys.nextMoment() === null, 'and queues no second ceremony');

    const ordinary = keyHarness(OVERWORLD_FLOOR);
    ordinary.keys.reconcile(ledgerOf({}));
    check(
      ordinary.claimed.length === 0,
      'an ordinary run arrives on floor 3 with no anchor fragment',
    );
  },
};

export const newGameSections: readonly FloorKeysSection[] = [
  newGameCarriesTheParty,
  carriedHireSurvivesFloors,
  carriedAnchorStaysDead,
  anchorFragmentOnArrival,
];
