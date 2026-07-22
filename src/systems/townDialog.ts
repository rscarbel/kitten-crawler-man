/**
 * The voice of the Over City. Given a citizen's role and a snapshot of world
 * state, this builds the short conversation shown when the player talks to a
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
 * Pure data + selection: no rendering, no audio, no scene coupling. The owning
 * systems supply the context and drive the `CitizenDialog` surface.
 */

import type { CircusQuestStage } from '../core/CircusQuestProgress';
import type { MurderQuestStage } from '../core/MurderQuestProgress';
import type { DoomsdayStage } from '../core/DoomsdayProgress';
import type { TownRole } from '../sprites/person/PersonAppearance';

/** A read-only snapshot of the quest flags that colour citizen chatter. */
export interface TownDialogContext {
  circus: CircusQuestStage;
  murder: MurderQuestStage;
  doomsday: DoomsdayStage;
  /** The ringmaster's daughter has fallen in the ruins. */
  heatherSlain: boolean;
  /** The hideout letter has named Miss Quill as the killer. */
  quillNamed: boolean;
}

/** The name shown as the dialog speaker for each role. */
const ROLE_NAMES: Record<TownRole, string> = {
  guard: 'Town Guard',
  merchant: 'Merchant',
  farmer: 'Farmer',
  smith: 'Blacksmith',
  innkeeper: 'Innkeeper',
  priest: 'Priest',
  child: 'Child',
  drunk: 'Tavern Regular',
  noble: 'Noble',
  beggar: 'Beggar',
  laborer: 'Laborer',
  skyfowl: 'Bird-folk',
  commoner: 'Townsperson',
};

export function roleDisplayName(role: TownRole): string {
  return ROLE_NAMES[role];
}

/** Everyday, role-flavoured lines. Rotated per citizen so repeats stay fresh. */
const AMBIENT_LINES: Record<TownRole, ReadonlyArray<string>> = {
  guard: [
    'Move along. Nothing to see here.',
    "Keep your nose clean and we'll get along fine.",
    'Long watch tonight. The ruins never sleep.',
    "Draw a blade in my square and you'll answer for it.",
    'Stay inside the walls after dark. Safer that way.',
  ],
  merchant: [
    'Finest wares this side of the ruins — come see!',
    'Coin talks, friend. What are you buying?',
    'Trade’s been slow with the roads so dangerous.',
    'A discerning eye! I like that in a customer.',
    "Everything's for sale if the price is right.",
  ],
  farmer: [
    'Weather’s held. Should be a fair harvest.',
    'These old bones weren’t made for city cobbles.',
    'Lost two sheep to whatever crawls out of those ruins.',
    'Honest work, honest pay. That’s all I ask.',
    'Come by the farm if you want fresh milk.',
  ],
  smith: [
    'Mind the sparks. Forge runs hot today.',
    'Bring me good steel and I’ll make it sing.',
    'A dull blade gets a man killed out there.',
    'Every dent tells a story. What’s yours?',
    'Hammer, heat, and patience. No shortcuts.',
  ],
  innkeeper: [
    'A warm bed and a hot meal — best in town.',
    'Sit anywhere you like. Ale’s coming.',
    'Travellers bring the strangest tales through here.',
    'Mind the regulars. They’re harmless. Mostly.',
    'First one’s on the house for a friendly face.',
  ],
  priest: [
    'May the light keep you on the dark roads.',
    'Dark times test the faithful. Keep heart.',
    'The ruins hunger, but hope endures.',
    'A quiet word of prayer costs nothing.',
    'Peace be with you, traveller.',
  ],
  child: [
    'Wanna see me hop the whole square? Watch!',
    'Are you a real adventurer? You look like one!',
    'Mama says not to talk to strangers. You seem okay though.',
    'I found a shiny rock! Wanna see? No? Okay.',
    'Tag! You’re it! ...aw, you’re no fun.',
  ],
  drunk: [
    'Heyyy... you’re alright, you know that?',
    'One more round won’t kill me. Probably.',
    'I coulda been a hero. Coulda been...',
    'The room’s spinnin’ or the world is. Can’t tell.',
    'Shhh — don’t tell the barkeep I’m out of coin.',
  ],
  noble: [
    'Do watch where you step. This cloak was expensive.',
    'One simply cannot find decent help these days.',
    'The rabble grows bold. Where are the guards?',
    'I own half this street, you know. The better half.',
    'Charming little town. For a ruin on the edge of doom.',
  ],
  beggar: [
    'Spare a coin? Anything helps, kind soul.',
    'Haven’t eaten since the frost. You got bread?',
    'I see things others miss, down here in the gutter.',
    'Bless you, bless you — even for a passing glance.',
    'The cold’s a cruel landlord, friend.',
  ],
  laborer: [
    'Back’s achin’, but the walls won’t build themselves.',
    'Honest sweat, that’s all a man’s got out here.',
    'Careful past the scaffolding, aye?',
    'Long day. Longer night. Same as always.',
    'You lookin’ for work? Foreman’s always short-handed.',
  ],
  skyfowl: [
    'Skies are clear today. Good flying, if you’ve the wings.',
    'We roost above the square. Best view in town.',
    'Groundfolk worry too much. Look up once in a while.',
    'The wind carries strange tidings from the ruins.',
    'Ruffle my feathers and we’ll have words, friend.',
  ],
  commoner: [
    'Fine day, isn’t it? For now, anyway.',
    'You’re not from around here, are you?',
    'Heard the market’s got fresh stock. Worth a look.',
    'Keep to the lit streets and you’ll be fine.',
    'A face like yours means trouble’s not far behind.',
  ],
};

/** Everyone drops everything and reacts when the town is under threat. */
const DANGER_LINES: Record<TownRole, string> = {
  guard: 'Get behind me, civilian! To arms!',
  merchant: 'My wares — never mind the wares, RUN!',
  farmer: 'Gods preserve us, it’s come for the town!',
  smith: 'Grab a blade off the rack — we make our stand here!',
  innkeeper: 'Everyone into the cellar! Go, go!',
  priest: 'Light shield us all — the reckoning is upon us!',
  child: 'Mama! MAMA! I’m scared!',
  drunk: 'Sobered me right up, that did. We’re done for!',
  noble: 'Where are my guards?! Somebody DO something!',
  beggar: 'Nobody’ll miss an old beggar. Save yourselves.',
  laborer: 'Drop the tools — grab anything that swings!',
  skyfowl: 'Take to the air! The ground’s no place to be!',
  commoner: 'It’s breaking through! Run for the stairs!',
};

/**
 * The most relevant gossip line for the current world state, or `null` when
 * nothing noteworthy has happened. Ordered by recency/urgency so the freshest
 * development wins when several quests are mid-flight.
 */
function gossipLine(ctx: TownDialogContext): string | null {
  if (ctx.doomsday === 'complete') {
    return 'We nearly lost everything up in that tower. Nearly.';
  }
  if (isMurderResolved(ctx.murder)) {
    return 'The killings have stopped. Folk sleep easier now — we owe you.';
  }
  if (isMurderActive(ctx.murder)) {
    return ctx.quillNamed
      ? 'They say it was Miss Quill all along. Who could’ve guessed?'
      : 'Lock your doors. Someone’s been killing in the night.';
  }
  if (ctx.murder === 'body_waiting' || ctx.murder === 'investigation') {
    return 'Did you hear? They found a poor soul dead by the well.';
  }
  if (isCircusResolved(ctx.circus)) {
    return 'The circus folk walk free again. The whole town’s talking.';
  }
  if (isCircusActive(ctx.circus)) {
    return ctx.heatherSlain
      ? 'They say the ringmaster’s daughter fell in the ruins. Grim business.'
      : 'Strange lights over the old Big Top of late. Gives me chills.';
  }
  return null;
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
  return stage === 'grimaldi_slain' || stage === 'complete';
}

function isMurderActive(stage: MurderQuestStage): boolean {
  return stage === 'night_attack' || stage === 'cult_hideout' || stage === 'confrontation';
}

function isMurderResolved(stage: MurderQuestStage): boolean {
  return stage === 'quill_slain' || stage === 'complete';
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

/** Deterministically pick from a pool, advancing with each conversation so repeats vary. */
function rotate(pool: ReadonlyArray<string>, seed: number, turn: number): string {
  const index = ((((seed % pool.length) + turn) % pool.length) + pool.length) % pool.length;
  return pool[index];
}

/**
 * Builds the lines for one conversation with a citizen.
 *
 * @param role   The citizen's role — selects the ambient/danger voice.
 * @param seed   The citizen's appearance seed — decorrelates which line each
 *               individual opens on, so two guards don't say the same thing.
 * @param turn   How many times the player has already talked to this citizen —
 *               rotates the pools so the next talk differs from the last.
 * @param ctx    Live quest snapshot driving the reactive layer.
 */
export function buildCitizenConversation(
  role: TownRole,
  seed: number,
  turn: number,
  ctx: TownDialogContext,
): string[] {
  if (isTownInDanger(ctx)) {
    return [DANGER_LINES[role]];
  }

  const lines: string[] = [];
  const gossip = gossipLine(ctx);
  // Fold gossip in on every other conversation so citizens react to the world
  // without every single one leading with the same headline.
  if (gossip !== null && (seed + turn) % 2 === 0) {
    lines.push(gossip);
  }
  lines.push(rotate(AMBIENT_LINES[role], seed, turn));
  return lines;
}
