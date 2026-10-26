import type { Ladder } from './ladder';
import type { MobKind } from './mobKinds';
import { BRIAR_HOLLOW_SIEGE_LADDER } from '../systems/briarHollow/assaultWaves';
import { SHARED_LOOKS_TIER, type VarietyTier } from '../core/perf/varietyTier';

/** The parts of a floor that each spawn their own population. */
type FloorEncounterSlot =
  | 'room'
  | 'hallway'
  | 'camp'
  | 'treasure'
  | 'landmark'
  | 'boss-room'
  | 'on-kill'
  | 'fairies'
  | 'arena';

/** Quests and set pieces that field hostiles of their own. */
type QuestEncounterName =
  | 'circus'
  | 'spider'
  | 'defend'
  | 'murder-mystery'
  | 'quill-confrontation'
  | 'cult-hideout'
  | 'stealth-key-snatch'
  | 'goblin-prison'
  | 'tutorial'
  | 'clogged-bathroom'
  | 'escort-ambush'
  | 'big-top-maze'
  | 'anchor-shrine'
  | 'interior-hostiles';

/**
 * Which encounter a spawn belongs to. An encounter is the unit a kind ladder
 * is declared on, so two spawns that should always substitute together share
 * one id.
 *
 * - `floor:<n>:<slot>` — a floor's own population, by where it stands.
 * - `boss:<kind>` — the adds a boss fight brings on, keyed by the boss.
 * - `bounty:<kind>` — a bounty mark's escort, keyed by the mark.
 * - `summon:<kind>` — what a summoner calls up mid-fight, keyed by the summoner.
 * - `quest:<name>` — a quest's waves and set pieces.
 * - `fairy:boss-healer` — the healer a boss fight brings on hard.
 * - `siege:briar-hollow` — the village assault.
 * - `town:crowd` — the Over City's street crowd.
 * - `dev:spawn` — cheats, the AI director's spawns and harnesses.
 */
export type EncounterId =
  | `floor:${number}:${FloorEncounterSlot}`
  | `boss:${MobKind}`
  | `bounty:${MobKind}`
  | `summon:${MobKind}`
  | `quest:${QuestEncounterName}`
  | 'fairy:boss-healer'
  | 'siege:briar-hollow'
  | 'town:crowd'
  | 'dev:spawn';

export const BRIAR_HOLLOW_SIEGE = 'siege:briar-hollow' as const satisfies EncounterId;

/** The bodies the Briar Hollow necromancer raises from the ground mid-siege. */
export const NECROMANCER_RAISES = 'summon:necromancer' as const satisfies EncounterId;

/** The encounter id of one slot of floor `floorNumber`. */
export function floorEncounter(floorNumber: number, slot: FloorEncounterSlot): EncounterId {
  return `floor:${floorNumber}:${slot}`;
}

/**
 * The kind ladders encounters declare. An encounter with no entry never
 * substitutes kinds; its spawns only share looks.
 */
const ENCOUNTER_LADDERS: Partial<Record<EncounterId, Ladder>> = {
  [BRIAR_HOLLOW_SIEGE]: BRIAR_HOLLOW_SIEGE_LADDER,
};

/**
 * The lowest variety tier encounters resolve their spawns' looks at. The siege
 * fields dozens of bodies at once, so each kind there wears its one shared
 * look on every device rather than only once a device has struggled.
 */
const ENCOUNTER_LOOK_TIER_FLOORS: Partial<Record<EncounterId, VarietyTier>> = {
  [BRIAR_HOLLOW_SIEGE]: SHARED_LOOKS_TIER,
  [NECROMANCER_RAISES]: SHARED_LOOKS_TIER,
};

/** The tier `encounter`'s spawns choose their looks at while the variety tier is `tier`. */
export function lookTierFor(encounter: EncounterId, tier: VarietyTier): VarietyTier {
  const floor = ENCOUNTER_LOOK_TIER_FLOORS[encounter] ?? tier;
  return floor > tier ? floor : tier;
}

/** The ladder `encounter` declares, or an empty one. */
export function ladderFor(encounter: EncounterId): Ladder {
  return ENCOUNTER_LADDERS[encounter] ?? [];
}

/** Every ladder an encounter declares, for gates that check them all. */
export function declaredLadders(): readonly (readonly [EncounterId, Ladder])[] {
  const ladders: (readonly [EncounterId, Ladder])[] = [];
  for (const [encounter, ladder] of Object.entries(ENCOUNTER_LADDERS)) {
    if (ladder !== undefined && isEncounterId(encounter)) ladders.push([encounter, ladder]);
  }
  return ladders;
}

function isEncounterId(value: string): value is EncounterId {
  return value in ENCOUNTER_LADDERS;
}
