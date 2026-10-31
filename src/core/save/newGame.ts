/**
 * The save a new game starts from: the party of the run it replaces, on floor
 * 1 of a world begun again.
 */

import type { GameProgressInput } from '../../auth/AuthClient';
import type { LevelId } from '../../levels/levelIds';
import { ITEM_DEF } from '../items/defs/ItemDefs';
import { MusicLibrary, bindMusicLibrary } from '../music/MusicLibrary';
import { bindRunStats, GameStats } from '../progression/GameStats';
import { difficultyStats } from '../difficulty/DifficultyStats';
import { revivedSnapshot } from './PlayerSnapshot';
import type { PlayerSnapshot, SavedStack } from './playerSnapshotFormat';
import type { SavedGearItemState } from '../../gear/gearState';
import { newGameRunFields, type NewGameResetFields, type RunSaveFields } from './saveFormat';
import { createWheelQuestFreeSpins } from './WheelLedger';
import type { NewGameCarry } from './newGameCarry';

/** A new game begins where a run that skips the tutorial does. */
export const NEW_GAME_LEVEL_ID = 'level1' as const satisfies LevelId;

/**
 * A quest's own item belongs to a quest the new world starts again, so it
 * stays behind: a gate key or a stolen cat's keepsake in the bag would walk
 * straight past the step that hands it out.
 */
function withoutQuestItem(stack: SavedStack | null): SavedStack | null {
  if (stack === null) return null;
  return ITEM_DEF[stack.id].category === 'quest' ? null : stack;
}

/**
 * A piece of gear as a new game takes it over: its awakening is the piece's
 * own and carries, but what it owes this floor (once-per-floor effects spent,
 * recharges running, a cursed bind until the next safe room) belongs to the
 * world left behind.
 */
function carriedGearState([id, state]: SavedGearItemState): SavedGearItemState {
  return [id, { ...state, bound: false, floorOnceSpent: [], cooldownFrames: {} }];
}

/**
 * A crawler as a new game takes them over: level, attributes, skills, gear
 * and bag carry; every status (a drink's buff, a poison, the wheel's double
 * damage curse) and a Jugg Juice's loaned health stay with the old world, so
 * the new run starts clean of them.
 */
function carriedSnapshot(snap: PlayerSnapshot): PlayerSnapshot {
  const revived = revivedSnapshot(snap);
  const maxHpWithoutLoan = revived.maxHp - revived.juggJuiceHpBoost;
  return {
    ...revived,
    hp: Math.min(revived.hp, maxHpWithoutLoan),
    maxHp: maxHpWithoutLoan,
    juggJuiceHpBoost: 0,
    statusEffects: [],
    gearState: revived.gearState.map(carriedGearState),
    inventorySlots: revived.inventorySlots.map(withoutQuestItem),
    inventoryHotbar: revived.inventoryHotbar.map(withoutQuestItem),
  };
}

/** Every run field a new game starts fresh, with the world-held pieces it carries. */
function freshRunFields(carry: NewGameCarry): NewGameResetFields {
  return {
    gameStats: new GameStats().snapshot(),
    pendingWheelOutcome: null,
    wheelFreeSpinBet: null,
    wheelOwedFreeze: null,
    wheelQuestFreeSpins: createWheelQuestFreeSpins(),
    doubleDamageRemaining: { human: 0, cat: 0 },
    musicLibrary: MusicLibrary.skippingTutorial().serialize(),
    storyBeatsSeen: [],
    objectivesBriefed: [],
    carried: carry,
  };
}

/**
 * The new run's first save, built from the save of the run it replaces. No
 * `world`: the new floor is generated fresh, as it is after the stairs.
 */
export function newGameProgress(
  current: GameProgressInput & RunSaveFields,
  carry: NewGameCarry,
): Omit<GameProgressInput & RunSaveFields, 'world'> {
  const { levelId: _oldFloor, humanSnap, catSnap, world: _oldWorld, ...runFields } = current;
  return {
    ...newGameRunFields(runFields, freshRunFields(carry)),
    levelId: NEW_GAME_LEVEL_ID,
    humanSnap: carriedSnapshot(humanSnap),
    catSnap: carriedSnapshot(catSnap),
  };
}

/**
 * Clears the run-scoped counters a new game must not inherit, however the
 * player reached it: from the title, or from floor 3's run end. Reset Game
 * clears them before the title, but the run end keeps its save, and so do the
 * counters bound to it.
 */
export function beginNewRun(): void {
  difficultyStats.beginRun();
  bindRunStats(null);
  bindMusicLibrary(null);
}
