/**
 * `offer_challenge`: a timed bounty from a fixed set of templates, offered on
 * a card the player accepts or declines. The model fills a template's
 * bounded parameters; it never writes the rules (`src/ai/show/challenges.ts`).
 *
 * The fairness rules hold at the offer: none while either crawler is under a
 * quarter of their health or a fight is on, one at a time, a few per floor,
 * and every template checked for being winnable here and now — enough of the
 * named creature alive, enough time for the kills or the walk, no status
 * already eating HP under a no-damage rule, a living boss for the potion fast.
 */
import { pendingStatusDamage } from '../../Player';
import {
  ANY_MOB,
  CHALLENGE_DEFAULT_COUNT,
  CHALLENGE_DEFAULT_SECONDS,
  CHALLENGE_MAX_COUNT,
  CHALLENGE_MAX_SECONDS,
  CHALLENGE_MIN_COUNT,
  CHALLENGE_MIN_SECONDS,
  CHALLENGE_MIN_SECONDS_PER_KILL,
  CHALLENGE_TEMPLATES,
  CHALLENGE_TEMPLATE_IDS,
  challengeObjective,
  minStairwellDashSeconds,
  mobMatches,
  type ChallengeSpec,
} from '../show/challenges';
import { aiSpawnableMobTypes } from './combat';
import { LOW_HP_FRACTION, anyVulnerable } from './governor';
import {
  AI_BOX_TIERS,
  AI_CHARACTER_SYSTEM,
  BOX_TIER_POINTS,
  activeCrawler,
  bothCrawlers,
  tileOf,
} from './helpers';
import {
  enumParam,
  optionalEnumParam,
  optionalIntParam,
  optionalTextParam,
  textParam,
} from './schema';
import { ok, refused, type AIActionCall, type AIActionDef } from './types';

const CHALLENGE_COOLDOWN_MS = 120_000;
const CHALLENGES_PER_FLOOR = 3;
const TITLE_MIN_CHARS = 3;
const TITLE_MAX_CHARS = 40;
const TAUNT_MIN_CHARS = 4;
const TAUNT_MAX_CHARS = 140;
const PITCH_MAX_CHARS = 140;
const PERCENT = 100;

const TEMPLATE = enumParam(
  'template',
  CHALLENGE_TEMPLATE_IDS,
  `Which challenge. ${CHALLENGE_TEMPLATE_IDS.map((id) => CHALLENGE_TEMPLATES[id].summary).join(' ')}`,
);
const TITLE = textParam('title', {
  minLength: TITLE_MIN_CHARS,
  maxLength: TITLE_MAX_CHARS,
  description: 'The challenge’s name on the offer card and the HUD, e.g. "Rat Race".',
});
const REWARD_TIER = enumParam(
  'reward_tier',
  AI_BOX_TIERS,
  'The loot box a win pays. Drawn from the floor’s loot-box allowance when offered.',
);
const TAUNT = textParam('taunt', {
  minLength: TAUNT_MIN_CHARS,
  maxLength: TAUNT_MAX_CHARS,
  description: 'Your public jeer if they fail, shown loudly on screen.',
});
const SECONDS = optionalIntParam('seconds', {
  min: CHALLENGE_MIN_SECONDS,
  max: CHALLENGE_MAX_SECONDS,
  fallback: CHALLENGE_DEFAULT_SECONDS,
  description: `Time limit for timed templates. Kill templates need at least ${CHALLENGE_MIN_SECONDS_PER_KILL}s per kill.`,
});
const COUNT = optionalIntParam('count', {
  min: CHALLENGE_MIN_COUNT,
  max: CHALLENGE_MAX_COUNT,
  fallback: CHALLENGE_DEFAULT_COUNT,
  description:
    'How many kills, for slay, slay_untouched and donut_finishes. That many must be alive on the floor.',
});
const MOB_TYPE = optionalEnumParam(
  'mob_type',
  [ANY_MOB, ...aiSpawnableMobTypes()],
  'Which creature the kills must be, for the kill templates; any for any hostile.',
  ANY_MOB,
);
const PITCH = optionalTextParam('pitch', {
  minLength: 1,
  maxLength: PITCH_MAX_CHARS,
  description: 'Your sell on the offer card, in character.',
});

function specOf({ params, characterName }: AIActionCall): ChallengeSpec {
  return {
    template: params.get(TEMPLATE),
    title: params.get(TITLE),
    count: params.get(COUNT),
    mobType: params.get(MOB_TYPE),
    seconds: params.get(SECONDS),
    rewardTier: params.get(REWARD_TIER),
    pitch: params.get(PITCH),
    taunt: params.get(TAUNT),
    offeredBy: characterName,
  };
}

/** Why `spec` cannot be won from where the party stands, or null when it can. */
function winnableRefusal(call: AIActionCall, spec: ChallengeSpec): string | null {
  const { scene } = call;
  const { rules } = CHALLENGE_TEMPLATES[spec.template];
  if (rules.countsKills) {
    const needed = spec.count * CHALLENGE_MIN_SECONDS_PER_KILL;
    if (spec.seconds < needed) return `${spec.count} kills need at least ${needed}s`;
    const targets = scene
      .getMobs()
      .filter(
        (mob) =>
          mob.isAlive && mob.isHostile && !mob.isBoss && mobMatches(spec.mobType, mob.spawnTypeKey),
      ).length;
    if (targets < spec.count) return `only ${targets} matching creatures are alive on this floor`;
  }
  if (rules.killer === 'cat') {
    const cat = scene.getCat();
    if (!cat.isAlive || cat.isKnockedOut) return 'Donut is in no state to land a blow';
  }
  if (rules.failOnDamage) {
    const bleeding = bothCrawlers(scene).some(
      (crawler) => pendingStatusDamage(crawler.statusEffects, crawler.maxHp) > 0,
    );
    if (bleeding) return 'a status is still eating a crawler’s HP';
  }
  if (rules.goal === 'bossDefeated' && !scene.getMobs().some((mob) => mob.isBoss && mob.isAlive)) {
    return 'this floor has no living boss';
  }
  if (rules.goal === 'stairwell') {
    const stairs = scene.getGameMap().stairwellTiles;
    if (stairs.length === 0) return 'this floor has no stairwell';
    const here = tileOf(activeCrawler(scene));
    const nearest = Math.min(...stairs.map((tile) => Math.hypot(tile.x - here.x, tile.y - here.y)));
    const fairSeconds = minStairwellDashSeconds(nearest);
    if (spec.seconds < fairSeconds)
      return `the stairwell is too far for ${spec.seconds}s (allow ${fairSeconds}s)`;
  }
  return null;
}

function challengeRefusal(call: AIActionCall): string | null {
  const show = call.scene.getShow?.() ?? null;
  const challenges = show?.challenges ?? null;
  if (challenges === null) return 'challenges cannot run here';
  if (challenges.busy) return 'a challenge is already offered or under way';
  if (anyVulnerable(call.scene)) {
    return `no challenges while a crawler is below ${Math.round(LOW_HP_FRACTION * PERCENT)}% HP`;
  }
  return winnableRefusal(call, specOf(call));
}

const offerChallenge: AIActionDef = {
  name: 'offer_challenge',
  description:
    'Offer the crawlers a timed bounty from a fixed set of templates, with a loot box for winning and a public taunt for failing. They accept or decline on a card; acceptance, the win or the failure arrive later as challengeAccepted / challengeDeclined / challengeCompleted / challengeFailed events. One at a time, never mid-fight or at low HP.',
  params: [TEMPLATE, TITLE, REWARD_TIER, TAUNT, SECONDS, COUNT, MOB_TYPE, PITCH],
  policy: {
    cost: 3,
    cooldownMs: CHALLENGE_COOLDOWN_MS,
    severity: 'disruptive',
    forbidsContext: ['isPaused', 'inCombat', 'inBossFight'],
  },
  maxPerFloor: CHALLENGES_PER_FLOOR,
  characters: [AI_CHARACTER_SYSTEM],
  isHarmful: () => false,
  budget: ({ params }) => ({
    pool: 'lootBoxPoints',
    amount: BOX_TIER_POINTS[params.get(REWARD_TIER)],
  }),
  refusal: challengeRefusal,
  showsIndicator: false,
  execute(call) {
    const refusal = challengeRefusal(call);
    const challenges = call.scene.getShow?.()?.challenges ?? null;
    if (refusal !== null || challenges === null) {
      return refused(refusal ?? 'challenges cannot run here');
    }
    const spec = specOf(call);
    const id = challenges.propose(spec);
    if (id === null) return refused('a challenge is already offered or under way');
    return ok(
      `offered ${id} "${spec.title}": ${challengeObjective(spec)} for a ${spec.rewardTier} box (awaiting the player's answer)`,
    );
  },
};

export const CHALLENGE_ACTIONS: readonly AIActionDef[] = [offerChallenge];
