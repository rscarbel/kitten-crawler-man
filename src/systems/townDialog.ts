/**
 * The voice of Taloncrest. Given a citizen's role and a snapshot of world
 * state, this builds the conversation shown when the player talks to a
 * townsperson (streets via `TownLifeSystem`, interiors via
 * `InteriorOccupantSystem`).
 *
 * Ambient lines come from a role-keyed pool of everyday talk (a guard grumbles
 * about his watch, a farmer about the harvest). Rotation is keyed to the
 * citizen's seed and how many times you have talked to them, so repeats vary
 * instead of parroting the same greeting. While the town is in danger every
 * citizen drops the small talk for their danger bark.
 *
 * Pure data + selection: no rendering, no scene coupling. The owning systems
 * supply the context and hand the returned `DialogLine` to the shared
 * `Conversation`.
 */

import type { TownRole } from '../sprites/person/PersonAppearance';
import { pickLine, transientSpeaker } from '../dialog/line';
import type { DialogLine } from '../dialog/line';
import type { CitizenSpeechStyle } from '../dialog/speakers';
import {
  ambientPool,
  dangerBark,
  GOSSIP_LINES,
  REPUTATION_GREETINGS,
  roleDisplayName,
  type ReputationTier,
} from '../dialog/scripts/townsfolk';
import { DEFAULT_TOWN_SPECIES, type TownSpecies } from './townSpecies';
import {
  phaseReached,
  type AvielChoice,
  type MissingCatsClueId,
  type MissingCatsPhase,
} from '../core/quests/missingCatsProgress';

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
 * back to the default for a `SpeciesBearer` that doesn't carry a real species.
 */
export function citizenSpecies(citizen: SpeciesBearer): TownSpecies {
  return citizen.species ?? DEFAULT_TOWN_SPECIES;
}

/** What the town knows of "A Cat Always Comes Back", for the lines that react to it. */
export interface MissingCatsDialogView {
  readonly phase: MissingCatsPhase;
  readonly avielChoice: AvielChoice | null;
  readonly clues: ReadonlySet<MissingCatsClueId>;
  readonly cellarWavesHeld: number;
}

/**
 * A read-only snapshot of the world state that colours citizen chatter. A
 * quest that wants the town to react to it adds its state here.
 */
export interface TownDialogContext {
  readonly missingCats: MissingCatsDialogView;
}

/** True when the town is actively imperilled and every citizen should be panicking. */
export function isTownInDanger(_ctx: TownDialogContext): boolean {
  return false;
}

/** What the street is saying about the questline. */
function gossipLine(view: MissingCatsDialogView): string {
  if (phaseReached(view, 'aftermath')) return GOSSIP_LINES.catsHome;
  if (phaseReached(view, 'captured')) return GOSSIP_LINES.belleTaken;
  if (view.avielChoice === 'exposed') return GOSSIP_LINES.avielGrounded;
  if (phaseReached(view, 'chase')) return GOSSIP_LINES.pennyTaken;
  if (phaseReached(view, 'stakeout')) return GOSSIP_LINES.lodgeHeld;
  if (phaseReached(view, 'blame')) return GOSSIP_LINES.elvesBlamed;
  if (phaseReached(view, 'posters_up')) return GOSSIP_LINES.noticesUp;
  return GOSSIP_LINES.catsGoing;
}

/** How the town greets the party for what it has done so far, or null before it has done anything. */
function reputationTier(view: MissingCatsDialogView): ReputationTier | null {
  if (phaseReached(view, 'aftermath')) return 'cats_home';
  if (phaseReached(view, 'captured')) return 'cat_taken';
  if (phaseReached(view, 'stakeout')) return 'cellar_held';
  if (phaseReached(view, 'investigating')) return 'asking_after_cats';
  return null;
}

/**
 * How often a citizen who could greet the party by its deeds repeats gossip
 * instead: one talk in this many. It must stay coprime to the greeting pools'
 * length (`ReputationGreetings`): the gate and `pickLine`'s index are both
 * keyed on `seed + turn`, so a shared factor would always divert the same
 * greeting and hide it for good, where a coprime one sweeps the whole pool.
 */
const GOSSIP_OVER_GREETING_MODULUS = 5;

/**
 * Citizens lead with the town's reaction on one talk in this many, so the
 * street reacts to the questline without every passer-by opening on it.
 */
const REACTIVE_LEAD_MODULUS = 2;

/** The reputation greeting or gossip a citizen leads with. */
function reactiveLead(view: MissingCatsDialogView, rotation: number): string {
  const tier = reputationTier(view);
  if (tier === null || rotation % GOSSIP_OVER_GREETING_MODULUS === 0) return gossipLine(view);
  return pickLine(REPUTATION_GREETINGS[tier], rotation);
}

/**
 * Builds one conversation line with a citizen: their danger bark while the
 * town is imperilled, otherwise the next line of their ambient pool, led on
 * every other talk by what the town is saying about the questline.
 *
 * @param role    The citizen's role — selects the ambient/danger voice.
 * @param species The citizen's species — selects which of that role's pools to draw from.
 * @param seed   The citizen's appearance seed — decorrelates which line each
 *               individual opens on, so two guards don't say the same thing.
 * @param turn   How many times the player has already talked to this citizen —
 *               rotates the pools so the next talk differs from the last.
 * @param ctx    Live world snapshot; decides whether the town is in danger.
 * @param speechStyle The voice the citizen speaks in.
 */
export function buildCitizenConversation(
  role: TownRole,
  species: TownSpecies,
  seed: number,
  turn: number,
  ctx: TownDialogContext,
  speechStyle: CitizenSpeechStyle,
): DialogLine {
  const speak = transientSpeaker(roleDisplayName(role), speechStyle);
  if (isTownInDanger(ctx)) return speak.line(dangerBark(species, role));
  const rotation = seed + turn;
  const ambient = pickLine(ambientPool(species, role), rotation);
  if (rotation % REACTIVE_LEAD_MODULUS !== 0) return speak.line(ambient);
  return speak.line([reactiveLead(ctx.missingCats, rotation), ambient]);
}
