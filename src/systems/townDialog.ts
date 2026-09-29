/**
 * The voice of the Over City. Given a citizen's role and a snapshot of world
 * state, this builds the conversation shown when the player talks to a
 * townsperson (streets via `TownLifeSystem`, interiors via
 * `InteriorOccupantSystem`).
 *
 * Two layers stack:
 *  - **Ambient** — a role-keyed pool of everyday lines (a guard grumbles about
 *    his watch, a farmer about the harvest). Deterministic rotation keyed to the
 *    citizen's seed + how many times you've talked to them means repeats vary
 *    instead of parroting the same greeting.
 *  - **Reactive** — gossip and alarm lines gated on live quest flags
 *    (`CircusQuestStage`, `MurderQuestStage`, `DoomsdayStage`). Citizens comment
 *    on what the player has actually done: whispers during the murders, relief
 *    once the killer falls, panic when the tower is about to blow.
 *
 * Pure data + selection: no rendering, no scene coupling. The owning systems
 * supply the context and hand the returned `DialogLine` to the shared
 * `Conversation`.
 */

import { isCircusResolvedStage, type CircusQuestStage } from '../core/CircusQuestProgress';
import type { MurderQuestStage } from '../core/MurderQuestProgress';
import type { DoomsdayStage } from '../core/DoomsdayProgress';
import type { TownRole } from '../sprites/person/PersonAppearance';
import { pickLine, transientSpeaker } from '../dialog/line';
import type { DialogLine } from '../dialog/line';
import {
  ambientPool,
  dangerBark,
  GOSSIP_LINES,
  REPUTATION_GREETINGS,
  roleDisplayName,
  type ReputationTier,
} from '../dialog/scripts/townsfolk';
import { DEFAULT_TOWN_SPECIES, type TownSpecies } from './townSpecies';

export { roleDisplayName };

/**
 * Anything with a role and an optional species field — `Townsperson` and
 * resident targets satisfy this structurally without `townDialog.ts`
 * importing `Townsperson`, which would close an import cycle back through
 * `townResidents.ts`'s `isTownInDanger` import of this module. `role` is
 * required (rather than the type being all-optional) so TypeScript doesn't
 * treat it as a weak type with no properties in common with `Townsperson`.
 */
export interface SpeciesBearer {
  readonly role: TownRole;
  readonly species?: TownSpecies;
}

/**
 * A street or interior citizen's species, for dialog-pool selection. Falls
 * back to the default for a `SpeciesBearer` that doesn't carry a real
 * species — this is the one place that fallback lives.
 */
export function citizenSpecies(citizen: SpeciesBearer): TownSpecies {
  return citizen.species ?? DEFAULT_TOWN_SPECIES;
}

/** A read-only snapshot of the quest flags that colour citizen chatter. */
export interface TownDialogContext {
  circus: CircusQuestStage;
  murder: MurderQuestStage;
  doomsday: DoomsdayStage;
  /** The circus's dancing bear has fallen in the ruins. */
  heatherSlain: boolean;
  /** The hideout letter has named Miss Quill as the killer. */
  quillNamed: boolean;
}

function roleSpeaker(role: TownRole) {
  return transientSpeaker(roleDisplayName(role), 'townsfolk');
}

/**
 * What this role shouts while the town is under threat. Named residents borrow
 * it too: an alarm is no time for a personal anecdote.
 */
export function dangerLine(role: TownRole, species: TownSpecies): DialogLine {
  return roleSpeaker(role).line(dangerBark(species, role));
}

/**
 * The most relevant gossip line for the current world state, or `null` when
 * nothing noteworthy has happened. Ordered by recency/urgency so the freshest
 * development wins when several quests are mid-flight.
 */
function gossipLine(ctx: TownDialogContext): string | null {
  if (ctx.doomsday === 'complete') {
    return GOSSIP_LINES.doomsdaySurvived;
  }
  if (isMurderResolved(ctx.murder)) {
    return GOSSIP_LINES.murderResolved;
  }
  if (isMurderActive(ctx.murder)) {
    // The schoolteacher is the answer the street has, and only up to the point
    // where the party learns she was not the whole of it. After the tower
    // reveal, a townsperson still closing the case at Quill contradicts what
    // the player has just been shown — so past that beat they go back to
    // knowing only that the killing has not stopped.
    if (ctx.murder === 'quill_slain') return GOSSIP_LINES.murderStillRaw;
    return ctx.quillNamed ? GOSSIP_LINES.murderQuillNamed : GOSSIP_LINES.murderActiveUnnamed;
  }
  if (ctx.murder === 'body_waiting' || ctx.murder === 'investigation') {
    return GOSSIP_LINES.murderBodyFound;
  }
  if (isCircusResolved(ctx.circus)) {
    return GOSSIP_LINES.circusResolved;
  }
  if (isCircusActive(ctx.circus)) {
    return ctx.heatherSlain ? GOSSIP_LINES.circusHeatherSlain : GOSSIP_LINES.circusOngoing;
  }
  return null;
}

function reputationTier(ctx: TownDialogContext): ReputationTier | null {
  if (ctx.doomsday === 'complete') return 'savior';
  const circusDone = isCircusResolved(ctx.circus);
  const murderDone = isMurderResolved(ctx.murder);
  if (circusDone && murderDone) return 'double_hero';
  if (circusDone) return 'circus_hero';
  if (murderDone) return 'murder_hero';
  if (isMurderActive(ctx.murder)) return 'murder_wary';
  return null;
}

// How often a citizen who could greet the player by their deeds instead voices
// ambient gossip — a 1-in-N chance. MUST stay coprime to every reputation pool's
// length (all 3 today): the gossip gate and `pickLine`'s index are both keyed on
// `seed + turn`, so if this modulus shared a factor with the pool length the gate
// would always divert the same rotation index, permanently hiding that line.
// Coprime moduli make the diverted index sweep the whole pool over successive
// talks, so every greeting line still gets shown.
const GOSSIP_OVER_GREETING_MODULUS = 5;

/**
 * The reactive line a citizen leads with. Once the player has earned a reputation
 * they're mostly greeted by their deeds (more alive than overheard rumor), but
 * ambient gossip still surfaces now and then so the town's reaction has variety.
 * With no reputation yet, it's pure gossip.
 */
function reactiveLead(ctx: TownDialogContext, seed: number, turn: number): string | null {
  const tier = reputationTier(ctx);
  const gossip = gossipLine(ctx);
  if (tier === null) return gossip;
  if (gossip !== null && (seed + turn) % GOSSIP_OVER_GREETING_MODULUS === 0) return gossip;
  return pickLine(REPUTATION_GREETINGS[tier], seed + turn);
}

function isCircusActive(stage: CircusQuestStage): boolean {
  return (
    stage === 'ritual_defense' ||
    stage === 'heather_hunt' ||
    stage === 'assault' ||
    stage === 'bigtop_ready'
  );
}

function isCircusResolved(stage: CircusQuestStage): boolean {
  return isCircusResolvedStage(stage);
}

function isMurderActive(stage: MurderQuestStage): boolean {
  return (
    stage === 'night_attack' ||
    stage === 'cult_hideout' ||
    stage === 'confrontation' ||
    stage === 'quill_slain'
  );
}

function isMurderResolved(stage: MurderQuestStage): boolean {
  return stage === 'lich_slain' || stage === 'complete';
}

/** True when the town is actively imperilled and every citizen should be panicking. */
export function isTownInDanger(ctx: TownDialogContext): boolean {
  return (
    ctx.doomsday === 'containment' ||
    ctx.doomsday === 'escape' ||
    ctx.circus === 'ritual_defense' ||
    ctx.circus === 'assault' ||
    ctx.murder === 'night_attack'
  );
}

// Show the reactive lead (reputation greeting / gossip) on every other talk, so
// citizens react to the world without every single one leading with a headline.
const REACTIVE_LEAD_MODULUS = 2;

/**
 * Builds one conversation line with a citizen — a single `DialogLine` whose
 * paragraphs are the reactive lead (if any) followed by the ambient line,
 * each its own page.
 *
 * @param role    The citizen's role — selects the ambient/danger voice.
 * @param species The citizen's species — selects which of that role's pools to draw from.
 * @param seed   The citizen's appearance seed — decorrelates which line each
 *               individual opens on, so two guards don't say the same thing.
 * @param turn   How many times the player has already talked to this citizen —
 *               rotates the pools so the next talk differs from the last.
 * @param ctx    Live quest snapshot driving the reactive layer.
 */
export function buildCitizenConversation(
  role: TownRole,
  species: TownSpecies,
  seed: number,
  turn: number,
  ctx: TownDialogContext,
): DialogLine {
  const speak = roleSpeaker(role);
  if (isTownInDanger(ctx)) {
    return speak.line(dangerBark(species, role));
  }

  const ambient = pickLine(ambientPool(species, role), seed + turn);
  const lead = reactiveLead(ctx, seed, turn);
  if (lead !== null && (seed + turn) % REACTIVE_LEAD_MODULUS === 0) {
    return speak.line([lead, ambient]);
  }
  return speak.line(ambient);
}
