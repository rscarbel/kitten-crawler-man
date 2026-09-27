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

import { ITEM_DEF } from '../../../core/ItemDefs';
import type { BriarHollowState } from '../../../core/briarHollowState';
import type { EventBus } from '../../../core/EventBus';
import type { GrantedReward } from '../../../core/GrantedReward';
import type { PartyTools, PartyToolsState } from '../../../core/PartyTools';
import type { PartyCraftsState } from '../../../core/partyCrafts';
import { teachBoth } from '../../../core/CraftSkills';
import {
  TOOL_TIER_BASIC,
  isToolTier,
  toolTierDef,
  type ToolKind,
  type ToolTier,
  type ToolTierDef,
} from '../../../core/toolTiers';
import { drawItemIcon } from '../../../ui/InventoryPanel';
import { asPercent } from '../../../ui/itemEffectLines';
import type { PricedMenu, PricedOption, PricedPurchaseResult } from '../../../ui/PricedMenuPanel';
import { partyCoins } from '../../../core/partyCoins';
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
export const UPGRADE_REBUY_GUARD_FRAMES = 18;

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

function resourcingLearnedByBoth(party: ServiceParty): boolean {
  return (
    party.human.craftSkills.isLearned('resourcing') && party.cat.craftSkills.isLearned('resourcing')
  );
}

function toolReward(kind: ToolKind): GrantedReward {
  const def = ITEM_DEF[toolTierDef(kind, TOOL_TIER_BASIC).id];
  return {
    kind: 'item',
    name: def.name,
    description: def.description ?? '',
    renderIcon: (ctx, x, y, size) => drawItemIcon(ctx, { ...def, quantity: 1 }, x, y, size),
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

function upgradeOption(tools: PartyToolsState, kind: ToolKind): PricedOption {
  const current = toolTierDef(kind, tierOf(tools, kind) ?? TOOL_TIER_BASIC);
  const nextTier = nextToolTier(tools, kind);
  if (nextTier === null) {
    return {
      key: kind,
      label: `${current.name} (finest)`,
      price: 0,
      desc: current.description,
      unavailable: FINEST_LABEL,
    };
  }
  const next = toolTierDef(kind, nextTier);
  const gain = `${describeToolTierGain(next)} (now ${describeToolTierGain(current)}). Applies to Carl and Donut.`;
  return {
    key: kind,
    label: next.name,
    price: next.costCoins,
    desc: `Replaces your ${current.name}. ${next.description} ${gain}`,
  };
}

/** Oren's line as the menu opens: an upgrade the buyer can afford right now, the axe first. */
function forgeBark(tools: PartyToolsState, buyerCoins: number): string {
  const affordable = (kind: ToolKind): boolean => {
    const next = nextToolTier(tools, kind);
    return next !== null && buyerCoins >= toolTierDef(kind, next).costCoins;
  };
  if (affordable('axe')) return sellerLine(OREN.axeUpgradeAvailable);
  if (affordable('pickaxe')) return sellerLine(OREN.pickaxeUpgradeAvailable);
  return sellerLine(OREN.shopOpen);
}

export function buildForgeMenu(tools: PartyToolsState, buyerCoins: number): PricedMenu {
  return {
    title: FORGE_TITLE,
    bark: forgeBark(tools, buyerCoins),
    byline: SPEAKERS.oren.name ?? undefined,
    options: TOOL_KINDS.map((kind) => upgradeOption(tools, kind)),
  };
}

function kindOfOption(option: PricedOption): ToolKind | null {
  return TOOL_KINDS.find((kind) => kind === option.key) ?? null;
}

function alreadyMaxLine(kind: ToolKind): string {
  return sellerLine(kind === 'axe' ? OREN.alreadyMaxAxe : OREN.alreadyMaxPickaxe);
}

export function forgePurchase(host: ForgeHost, option: PricedOption): PricedPurchaseResult {
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
    build: () => buildForgeMenu(host.tools, partyCoins(host.party.human, host.party.cat)),
    purchase: (option) => forgePurchase(host, option),
    rebuyGuardFrames: UPGRADE_REBUY_GUARD_FRAMES,
    blockedLine: (option) => {
      const kind = kindOfOption(option);
      if (kind !== null && option.unavailable !== undefined) return alreadyMaxLine(kind);
      return sellerLine(OREN.cannotAffordUpgrade);
    },
  };
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
  };
}
