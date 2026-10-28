/**
 * Oren Ironwhisker's forge: where the party is handed its first axe and
 * pickaxe, taught Resourcing, and later sold better tools.
 *
 * Nothing here opens before the Mayor's request is accepted — the request is
 * the way into the whole gathering loop, and Oren has no reason to outfit
 * strangers. Once it is, the "Tools" topic runs the grant and the lesson. The
 * grant and the teaching happen the moment the topic is chosen, before a line
 * is read, so walking away or pressing Escape part-way can never leave the
 * party short: talking to him again finds the tools already owned, finishes
 * any lesson that did not land, and still shows the explainer if it never
 * got to open.
 *
 * Tools are the party's, not a crawler's: an upgrade replaces the tool in
 * both packs at once. Coins are still each crawler's own, so the upgrade is
 * paid for by whoever is being steered, the way every shop charges.
 */

import { crawlerDisplayName } from '../../../characters/characters';
import { ITEM_DEF } from '../../../core/items/defs/ItemDefs';
import type { BriarHollowState } from '../../../core/quests/briarHollowState';
import type { EventBus } from '../../../core/EventBus';
import type { GrantedReward } from '../../../core/items/loot/GrantedReward';
import type { PartyTools, PartyToolsState } from '../../../core/items/gathering/PartyTools';
import type { PartyCraftsState } from '../../../core/labour/partyCrafts';
import { teachBoth } from '../../../core/labour/CraftSkills';
import {
  TOOL_TIER_BASIC,
  forgeCoinPrice,
  isToolTier,
  toolTierDef,
  type ToolKind,
  type ToolTier,
  type ToolTierDef,
} from '../../../core/items/gathering/toolTiers';
import { drawItemIcon } from '../../../ui/icons/drawItemIcon';
import { asPercent } from '../../../ui/itemEffectLines';
import {
  coinsWithMaterials,
  costCoins,
  type ShopMenu,
  type ShopRow,
  type ShopPurchaseResult,
} from '../../../ui/screens/shop/shopSession';
import { canAffordCoins } from '../../../core/party/partyCoins';
import { canAfford } from '../../../core/items/gathering/partyResources';
import { SPEAKERS } from '../../../dialog/speakers';
import { OREN } from '../../../dialog/scripts/briarHollow';
import type { ConversationRequest, ConversationTopic } from '../../../dialog/request';
import type { TopicProvider, VillagerConversationFlow } from '../villagerTopics';
import { onceFlagFor } from '../villagerCircumstances';
import {
  type ServiceParty,
  type ShopCounter,
  type ShopDefinition,
  questAccepted,
  sellerLine,
  shopTopic,
  shopTrades,
} from './serviceContext';
import { shopSignWhen } from '../../../sprites/overheadIcon';

const FORGE_TITLE = 'Ironwhisker Forge';
export const SMITH = 'oren';
/** Shown in the price column of a tool already at its best tier. */
const FINEST_LABEL = 'Finest';

/** The one-shot for Oren explaining, after the first upgrade, why one purchase serves both crawlers. */
export const SHARED_UPGRADE_ONCE_FLAG = onceFlagFor(SMITH, 'shared_upgrade_explanation');

const TOOL_KINDS: readonly ToolKind[] = ['axe', 'pickaxe'];

/**
 * A bought row turns into the next, dearer tier under the cursor, so a second
 * click that lands within this long of a sale is taken as the same press.
 */
export const UPGRADE_REBUY_GUARD_TICKS = 18;

export interface ForgeHost extends ShopCounter {
  readonly party: ServiceParty;
  readonly partyTools: PartyTools;
  /** The live axe/pickaxe tiers `partyTools` wraps. */
  readonly tools: PartyToolsState;
  readonly crafts: PartyCraftsState;
  readonly state: BriarHollowState;
  readonly bus: EventBus | null;
  /** Shows "New Item!" for something just handed over. */
  enqueueReward(reward: GrantedReward): void;
  /** Opens the Resourcing explainer, once nothing else granted is still on screen. */
  showResourcingExplainer(): void;
  playUpgradeSound(): void;
}

function tierOf(tools: PartyToolsState, kind: ToolKind): ToolTier | null {
  return kind === 'axe' ? tools.axeTier : tools.pickaxeTier;
}

export function partyOwnsTools(tools: PartyToolsState): boolean {
  return tools.axeTier !== null && tools.pickaxeTier !== null;
}

/** The tier Oren would sell next for `kind`, or null when the party already carries the best. */
export function nextToolTier(tools: PartyToolsState, kind: ToolKind): ToolTier | null {
  const next = (tierOf(tools, kind) ?? TOOL_TIER_BASIC) + 1;
  return isToolTier(next) ? next : null;
}

/**
 * Whether Oren has anything left to sell. His stock is the next tier of each
 * tool, so once both are at their finest he never trades again.
 */
export function forgeHasUpgradesLeft(tools: PartyToolsState): boolean {
  return TOOL_KINDS.some((kind) => nextToolTier(tools, kind) !== null);
}

function resourcingLearnedByBoth(party: ServiceParty): boolean {
  return (
    party.human.craftSkills.isLearned('resourcing') && party.cat.craftSkills.isLearned('resourcing')
  );
}

function toolReward(kind: ToolKind): GrantedReward {
  const tier = toolTierDef(kind, TOOL_TIER_BASIC);
  const def = ITEM_DEF[tier.id];
  return {
    kind: 'item',
    name: def.name,
    description: tier.description,
    renderIcon: (ctx, rect) => drawItemIcon(ctx, rect, { ...def, quantity: 1 }),
  };
}

/**
 * Opens the Resourcing explainer and records that it has been shown. The
 * first showing is once only; asking to be taught again reopens it on purpose.
 */
function showExplainer(host: ForgeHost): void {
  if (!host.crafts.explainersSeen.includes('resourcing')) {
    host.crafts.explainersSeen.push('resourcing');
  }
  host.showResourcingExplainer();
}

/**
 * Both crawlers get the starter axe and pickaxe and learn Resourcing, all at
 * once and before a word of it is read. Safe to repeat: a crawler who already
 * holds a tool is not given another, and a learned skill is not re-taught.
 */
export function grantToolsAndLesson(host: ForgeHost): void {
  const { human, cat } = host.party;
  host.partyTools.grantStarterTools(human, cat);
  teachBoth(human, cat, 'resourcing');
  host.bus?.emit('toolsGranted', {});
}

/**
 * Whether the follow-up to a closed lesson should still play. A conversation
 * closed by the party dying, or by a rewind that took the tools back out of
 * their packs, has nobody left to show the cards and the explainer to.
 */
function partyStillListening(host: ForgeHost): boolean {
  return host.party.active().isAlive && partyOwnsTools(host.tools);
}

/**
 * The grant's follow-up: the reward cards and the explainer, once the
 * conversation showing {@link OREN.grantAndLesson} has closed.
 */
function grantFollowUp(host: ForgeHost): () => void {
  return () => {
    if (!partyStillListening(host)) return;
    for (const kind of TOOL_KINDS) host.enqueueReward(toolReward(kind));
    showExplainer(host);
  };
}

/**
 * Grants the tools as the questline's own opening line for Oren, whose page
 * is {@link OREN.grantBasicTools} — already shown by the conversation panel
 * before this runs, so unlike {@link runToolsTopic} this never says it again.
 * Returns the follow-up to run once the conversation eventually closes, or
 * `null` when the party already had its tools and nothing was granted.
 */
export function runOrenAutoGrant(host: ForgeHost): (() => void) | null {
  if (partyOwnsTools(host.tools)) return null;
  grantToolsAndLesson(host);
  return grantFollowUp(host);
}

function runToolsTopic(host: ForgeHost, flow: VillagerConversationFlow): ConversationRequest {
  if (!partyOwnsTools(host.tools)) {
    grantToolsAndLesson(host);
    return flow.closeAfter([OREN.grantAndLesson], grantFollowUp(host));
  }
  if (resourcingLearnedByBoth(host.party)) {
    return flow.answer([OREN.basicToolsAlreadyOwned]);
  }
  teachBoth(host.party.human, host.party.cat, 'resourcing');
  const alreadySeen = host.crafts.explainersSeen.includes('resourcing');
  if (alreadySeen) return flow.answer([OREN.basicToolsAlreadyOwned, OREN.resourcingSkillGranted]);
  return flow.closeAfter([OREN.basicToolsAlreadyOwned, OREN.resourcingSkillGranted], () => {
    if (partyStillListening(host)) showExplainer(host);
  });
}

/** What a tier gets you, in the player's own terms: how much faster, and how much more per swing. */
function describeToolTierGain(def: ToolTierDef): string {
  const parts: string[] = [];
  if (def.speedBonus > 0) parts.push(`+${asPercent(def.speedBonus)}% gathering speed`);
  if (def.yieldMultiplier > 1) parts.push(`${def.yieldMultiplier}× yield per swing`);
  return parts.length > 0 ? parts.join(', ') : 'no bonus';
}

function upgradeOption(tools: PartyToolsState, kind: ToolKind): ShopRow {
  const current = toolTierDef(kind, tierOf(tools, kind) ?? TOOL_TIER_BASIC);
  const nextTier = nextToolTier(tools, kind);
  if (nextTier === null) {
    return {
      key: kind,
      label: `${current.name} (finest)`,
      desc: current.description,
      art: { kind: 'item', item: current.id },
      offer: { status: 'spent', reason: FINEST_LABEL },
      questErrand: false,
    };
  }
  const next = toolTierDef(kind, nextTier);
  const gain = `${describeToolTierGain(next)} (now ${describeToolTierGain(current)}). Applies to ${crawlerDisplayName('human')} and ${crawlerDisplayName('cat')}.`;
  return {
    key: kind,
    label: next.name,
    desc: `Replaces your ${current.name}. ${next.description} ${gain}`,
    art: { kind: 'item', item: next.id },
    offer: {
      status: 'open',
      cost: coinsWithMaterials(forgeCoinPrice(kind, nextTier), next.costMaterials),
    },
    questErrand: false,
  };
}

/** Whether the party's shared purse and combined packs cover a tier's coins and materials. */
function partyCanAffordTier(party: ServiceParty, kind: ToolKind, tier: ToolTier): boolean {
  const { human, cat } = party;
  const materials = toolTierDef(kind, tier).costMaterials;
  return canAffordCoins(human, cat, forgeCoinPrice(kind, tier)) && canAfford(human, cat, materials);
}

/** The next tier of `kind` when the party can pay for all of it right now, else null. */
function affordableNextTier(
  tools: PartyToolsState,
  party: ServiceParty,
  kind: ToolKind,
): ToolTier | null {
  const next = nextToolTier(tools, kind);
  if (next === null) return null;
  return partyCanAffordTier(party, kind, next) ? next : null;
}

/** Oren's line as the menu opens: an upgrade the party can afford right now, the axe first. */
function forgeBark(tools: PartyToolsState, party: ServiceParty): string {
  if (affordableNextTier(tools, party, 'axe') !== null) return sellerLine(OREN.axeUpgradeAvailable);
  if (affordableNextTier(tools, party, 'pickaxe') !== null) {
    return sellerLine(OREN.pickaxeUpgradeAvailable);
  }
  return sellerLine(OREN.shopOpen);
}

export function buildForgeMenu(tools: PartyToolsState, party: ServiceParty): ShopMenu {
  return {
    title: FORGE_TITLE,
    bark: forgeBark(tools, party),
    byline: SPEAKERS.oren.name,
    emblem: null,
    options: TOOL_KINDS.map((kind) => upgradeOption(tools, kind)),
  };
}

function kindOfOption(option: ShopRow): ToolKind | null {
  return TOOL_KINDS.find((kind) => kind === option.key) ?? null;
}

function alreadyMaxLine(kind: ToolKind): string {
  return sellerLine(kind === 'axe' ? OREN.alreadyMaxAxe : OREN.alreadyMaxPickaxe);
}

export function forgePurchase(host: ForgeHost, option: ShopRow): ShopPurchaseResult {
  const kind = kindOfOption(option);
  if (kind === null) return { ok: false, line: '' };
  const next = nextToolTier(host.tools, kind);
  if (next === null) return { ok: false, line: alreadyMaxLine(kind) };
  host.partyTools.upgrade(kind, host.party.human, host.party.cat);
  host.playUpgradeSound();
  host.bus?.emit('toolUpgraded', { kind, tier: next });
  const purchased = sellerLine(OREN.upgradePurchased);
  const onceFlags = host.state.onceFlags;
  if (onceFlags.includes(SHARED_UPGRADE_ONCE_FLAG)) return { ok: true, line: purchased };
  onceFlags.push(SHARED_UPGRADE_ONCE_FLAG);
  return { ok: true, line: `${purchased} ${sellerLine(OREN.sharedUpgradeExplanation)}` };
}

export function forgeShop(host: ForgeHost): ShopDefinition {
  return {
    build: () => buildForgeMenu(host.tools, host.party),
    purchase: (option) => forgePurchase(host, option),
    rebuyGuardTicks: UPGRADE_REBUY_GUARD_TICKS,
    blockedLine: (option) => {
      const kind = kindOfOption(option);
      if (option.offer.status !== 'open') {
        return kind === null ? null : alreadyMaxLine(kind);
      }
      const { cost } = option.offer;
      const { human, cat } = host.party;
      const coinsCovered = canAffordCoins(human, cat, costCoins(cost));
      if (coinsCovered && cost.kind === 'coinsAndMaterials') return sellerLine(OREN.needsMaterials);
      return sellerLine(OREN.cannotAffordUpgrade);
    },
    sell: null,
  };
}

/**
 * A notice for the first moment the party can pay for a tool's next tier,
 * coins and materials both, so a crawler out gathering learns the forge has
 * something for them. Each tier of each kind is announced once; the flag is
 * recorded as the notice is returned. Null when there is nothing new to say.
 */
export function forgeUpgradeNudge(host: ForgeHost): string | null {
  const phase = host.state.quest.phase;
  if (!questAccepted(phase) || !shopTrades(phase)) return null;
  if (!partyOwnsTools(host.tools)) return null;
  const onceFlags = host.state.onceFlags;
  for (const kind of TOOL_KINDS) {
    const tier = affordableNextTier(host.tools, host.party, kind);
    if (tier === null) continue;
    const flag = onceFlagFor(SMITH, `upgrade_nudge_${kind}_${tier}`);
    if (onceFlags.includes(flag)) continue;
    onceFlags.push(flag);
    const next = toolTierDef(kind, tier);
    return `You can afford a ${next.name}. Oren sells it at the ${FORGE_TITLE} in Briar Hollow.`;
  }
  return null;
}

/**
 * Oren's rows: nothing before the request is accepted; "Tools" (the grant and
 * the lesson) until the party has them; then "Shop" — first in the list — and
 * "Teach me again" once they do. All of it shuts during the siege.
 */
export function forgeTopics(host: ForgeHost): TopicProvider {
  return {
    topics(villager, ctx, flow): readonly ConversationTopic[] {
      if (villager !== SMITH) return [];
      const phase = ctx.quest.phase;
      if (!questAccepted(phase) || !shopTrades(phase)) return [];
      if (!partyOwnsTools(host.tools)) {
        return [
          {
            key: 'tools',
            label: 'Tools',
            tone: 'normal',
            repeatable: false,
            grouping: 'root',
            run: (convo) => convo.play(runToolsTopic(host, flow)),
          },
        ];
      }
      const teachAgain: ConversationTopic = {
        key: 'teach_again',
        label: 'Teach me again',
        tone: 'normal',
        repeatable: false,
        grouping: 'question',
        run: (convo) =>
          convo.play(
            flow.closeAfter([OREN.resourcingSkillAlreadyGranted], () => {
              if (partyStillListening(host)) showExplainer(host);
            }),
          ),
      };
      return [shopTopic('upgrades', 'Shop', host, () => forgeShop(host), flow), teachAgain];
    },
    shopSignFor: (villager, ctx) =>
      shopSignWhen(
        villager === SMITH &&
          questAccepted(ctx.quest.phase) &&
          shopTrades(ctx.quest.phase) &&
          partyOwnsTools(host.tools) &&
          forgeHasUpgradesLeft(host.tools),
      ),
  };
}
