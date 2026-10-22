/**
 * The Briar Hollow siege's waves as data: who each wave brings, and which
 * kinds stand in for others when the device has had to give up variety.
 *
 * Imports nothing from the siege system or the spawn funnel, so the
 * encounter-ladder lookup (`src/levels/encounters.ts`) can register the
 * siege's ladder without an import cycle back through itself.
 */

import type { LadderRow } from '../../levels/ladder';
import type { MobKind } from '../../levels/mobKinds';
import {
  LEAN_VARIETY_TIER,
  MINIMAL_VARIETY_TIER,
  TRIMMED_VARIETY_TIER,
} from '../../core/varietyTier';

/** The fewest undead any wave raises, whatever the difficulty takes off it. */
export const MIN_UNDEAD_PER_WAVE = 10;

/** The necromancer's own army: the undead every wave raises, in the order a wave raises them. */
export const UNDEAD_ORDER = [
  'raised_ratkin',
  'ruins_ghoul',
  'skeleton_sword',
  'skeleton_archer',
  'grave_bull',
] as const satisfies readonly MobKind[];

export type AssaultUndeadKind = (typeof UNDEAD_ORDER)[number];

/**
 * The crawl's other hostiles he drives before him: across the four waves,
 * every regular enemy there is but the spiders, the grubs and the cockroaches.
 * The rock golems come with the last.
 */
export const HOSTILE_ORDER = [
  'goblin',
  'goblin_archer',
  'goblin_dynamiter',
  'goblin_bombardier',
  'rat',
  'sky_fowl',
  'troglodyte',
  'llama',
  'circus_lemur',
  'fat_clown',
  'stilt_clown',
  'tuskling',
  'mold_lion',
  'krasue',
  'city_elf_cultist',
  'mantis',
  'bugaboo',
  'rock_golem',
] as const satisfies readonly MobKind[];

type AssaultHostileKind = (typeof HOSTILE_ORDER)[number];

/** Which kind of body a wave spawns. */
export type AssaultSpawnKind = AssaultUndeadKind | AssaultHostileKind;

/** Every kind a wave spawns, in the order a mini-wave sends them up the lane. */
const ASSAULT_SPAWN_ORDER: readonly AssaultSpawnKind[] = [...UNDEAD_ORDER, ...HOSTILE_ORDER];

export function isAssaultSpawnKind(kind: MobKind): kind is AssaultSpawnKind {
  return ASSAULT_SPAWN_ORDER.some((spawnKind) => spawnKind === kind);
}

export interface AssaultWaveSpec {
  /** Raised all at once as the wave begins; never fewer than {@link MIN_UNDEAD_PER_WAVE}. */
  readonly undead: Readonly<Partial<Record<AssaultUndeadKind, number>>>;
  readonly hostiles: Readonly<Partial<Record<AssaultHostileKind, number>>>;
  /**
   * The share of his full health Vordrick comes with. Below 1 he cannot be
   * killed, and fades away when beaten; at 1 his death wins the siege.
   */
  readonly necromancerHealthShare: number;
}

/** Each wave's base counts, before the difficulty's {@link AssaultTuning.bodyScale}. */
export const ASSAULT_WAVES: readonly AssaultWaveSpec[] = [
  {
    undead: { raised_ratkin: 5, ruins_ghoul: 2, skeleton_sword: 2, skeleton_archer: 1 },
    hostiles: {
      goblin: 2,
      goblin_archer: 1,
      goblin_dynamiter: 1,
      rat: 2,
      sky_fowl: 1,
    },
    necromancerHealthShare: 0.4,
  },
  {
    undead: {
      raised_ratkin: 4,
      ruins_ghoul: 2,
      skeleton_sword: 2,
      skeleton_archer: 2,
      grave_bull: 1,
    },
    hostiles: {
      goblin_dynamiter: 1,
      goblin_bombardier: 1,
      troglodyte: 1,
      llama: 1,
      circus_lemur: 1,
      fat_clown: 1,
      stilt_clown: 1,
      tuskling: 2,
    },
    necromancerHealthShare: 0.55,
  },
  {
    undead: {
      raised_ratkin: 4,
      ruins_ghoul: 3,
      skeleton_sword: 2,
      skeleton_archer: 2,
      grave_bull: 1,
    },
    hostiles: { mold_lion: 1, krasue: 2, city_elf_cultist: 1, mantis: 2, bugaboo: 1 },
    necromancerHealthShare: 0.7,
  },
  {
    undead: {
      raised_ratkin: 5,
      ruins_ghoul: 3,
      skeleton_sword: 3,
      skeleton_archer: 2,
      grave_bull: 1,
    },
    hostiles: {
      rock_golem: 2,
      goblin: 2,
      goblin_dynamiter: 1,
      goblin_bombardier: 1,
      krasue: 1,
      troglodyte: 1,
      stilt_clown: 1,
    },
    necromancerHealthShare: 1,
  },
];

/** A ladder row that can only name kinds the siege spawns. */
type SiegeLadderRow = LadderRow & {
  readonly kind: AssaultSpawnKind;
  readonly standIn: AssaultSpawnKind;
};

/**
 * The siege's kind substitutions as the variety tier drops. Every stand-in is
 * a kind the siege already fields at that tier, in the same mini-wave or one
 * that rises before it, so a substitution never brings in a new look. The
 * leaders and the necromancer's undead are never on it.
 */
export const BRIAR_HOLLOW_SIEGE_LADDER = [
  { tier: TRIMMED_VARIETY_TIER, kind: 'rat', standIn: 'goblin' },
  { tier: TRIMMED_VARIETY_TIER, kind: 'sky_fowl', standIn: 'ruins_ghoul' },
  { tier: TRIMMED_VARIETY_TIER, kind: 'bugaboo', standIn: 'raised_ratkin' },
  { tier: TRIMMED_VARIETY_TIER, kind: 'stilt_clown', standIn: 'raised_ratkin' },
  { tier: TRIMMED_VARIETY_TIER, kind: 'circus_lemur', standIn: 'ruins_ghoul' },
  { tier: TRIMMED_VARIETY_TIER, kind: 'fat_clown', standIn: 'troglodyte' },
  { tier: LEAN_VARIETY_TIER, kind: 'tuskling', standIn: 'troglodyte' },
  { tier: LEAN_VARIETY_TIER, kind: 'krasue', standIn: 'ruins_ghoul' },
  { tier: LEAN_VARIETY_TIER, kind: 'mantis', standIn: 'mold_lion' },
  { tier: LEAN_VARIETY_TIER, kind: 'city_elf_cultist', standIn: 'troglodyte' },
  { tier: MINIMAL_VARIETY_TIER, kind: 'llama', standIn: 'goblin_archer' },
  { tier: MINIMAL_VARIETY_TIER, kind: 'rock_golem', standIn: 'troglodyte' },
  { tier: MINIMAL_VARIETY_TIER, kind: 'mold_lion', standIn: 'troglodyte' },
] as const satisfies readonly SiegeLadderRow[];
