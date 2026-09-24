import { isRecord } from './guards';
import type { ItemId } from './ItemDefs';
import type { Inventory } from './Inventory';
import { MAX_TOOL_TIER, TOOL_TIER_BASIC, TOOL_TIERS, isToolTier, toolTierDef } from './toolTiers';
import type { ToolKind, ToolTier } from './toolTiers';

/** Axe and pickaxe tier, shared by both crawlers. `null` means never granted. */
export interface PartyToolsState {
  axeTier: ToolTier | null;
  pickaxeTier: ToolTier | null;
}

export function createPartyToolsState(): PartyToolsState {
  return { axeTier: null, pickaxeTier: null };
}

function parseToolTierField(value: unknown): ToolTier | null {
  return typeof value === 'number' && isToolTier(value) ? value : null;
}

/** Strict, tolerant validator for a saved {@link PartyToolsState}. */
export function parsePartyToolsState(value: unknown): PartyToolsState {
  const state = createPartyToolsState();
  if (!isRecord(value)) return state;
  state.axeTier = parseToolTierField(value.axeTier);
  state.pickaxeTier = parseToolTierField(value.pickaxeTier);
  return state;
}

function tierFieldFor(kind: ToolKind): 'axeTier' | 'pickaxeTier' {
  return kind === 'axe' ? 'axeTier' : 'pickaxeTier';
}

/**
 * A crawler that carries an axe or pickaxe. A minimal structural type instead
 * of `HumanPlayer | CatPlayer` keeps this module decoupled from the creature
 * classes; every `Player` satisfies it.
 */
export interface ToolOwner {
  readonly inventory: Inventory;
}

/**
 * Wraps a live {@link PartyToolsState} by reference — the same object is
 * threaded across scene rebuilds, so upgrades and reconciliation are visible
 * to every holder of the wrapper without re-plumbing a new instance through.
 */
export class PartyTools {
  constructor(private readonly state: PartyToolsState) {}

  /** Grants tier-0 axe and pickaxe to both crawlers. Safe to call more than once. */
  grantStarterTools(human: ToolOwner, cat: ToolOwner): void {
    this.grantStarterTool('axe', human, cat);
    this.grantStarterTool('pickaxe', human, cat);
  }

  private grantStarterTool(kind: ToolKind, human: ToolOwner, cat: ToolOwner): void {
    const tierField = tierFieldFor(kind);
    this.state[tierField] ??= TOOL_TIER_BASIC;
    const currentTier = this.state[tierField] ?? TOOL_TIER_BASIC;
    const itemId = toolTierDef(kind, currentTier).id;
    for (const owner of [human, cat]) {
      if (owner.inventory.countOf(itemId) === 0) {
        owner.inventory.addItem(itemId, 1);
      }
    }
  }

  /** Advances one tool kind by a tier, capped at {@link MAX_TOOL_TIER}, in both inventories. */
  upgrade(kind: ToolKind, human: ToolOwner, cat: ToolOwner): void {
    const tierField = tierFieldFor(kind);
    const currentTier = this.state[tierField] ?? TOOL_TIER_BASIC;
    const candidateTier = currentTier + 1;
    const nextTier = isToolTier(candidateTier) ? candidateTier : MAX_TOOL_TIER;
    if (nextTier === currentTier) return;

    const fromItemId = toolTierDef(kind, currentTier).id;
    const toItemId = toolTierDef(kind, nextTier).id;
    this.state[tierField] = nextTier;
    for (const owner of [human, cat]) {
      const replaced = owner.inventory.replaceItemInPlace(fromItemId, toItemId);
      if (!replaced) {
        owner.inventory.addItem(toItemId, 1);
      }
    }
  }

  /**
   * Makes both inventories hold exactly one copy of each owned kind's current
   * tier, dropping stray other-tier copies and folding duplicates. Run on
   * scene enter and save restore to self-heal drift between inventories.
   */
  reconcile(human: ToolOwner, cat: ToolOwner): void {
    this.reconcileKind('axe', human, cat);
    this.reconcileKind('pickaxe', human, cat);
  }

  private reconcileKind(kind: ToolKind, human: ToolOwner, cat: ToolOwner): void {
    const tier = this.state[tierFieldFor(kind)];
    if (tier === null) return;
    const currentItemId = toolTierDef(kind, tier).id;
    const everyTierItemId = TOOL_TIERS[kind].map((def) => def.id);

    for (const owner of [human, cat]) {
      let keptCurrent = false;
      for (const itemId of everyTierItemId) {
        const heldCount = owner.inventory.countOf(itemId);
        if (heldCount === 0) continue;
        if (itemId === currentItemId && !keptCurrent) {
          keptCurrent = true;
          if (heldCount > 1) owner.inventory.removeItems(itemId, heldCount - 1);
        } else {
          owner.inventory.removeItems(itemId, heldCount);
        }
      }
      if (!keptCurrent) {
        owner.inventory.addItem(currentItemId, 1);
      }
    }
  }

  /** The multiplier a harvest tick gets from the party's current tool of this kind. */
  efficiency(kind: ToolKind): number {
    return toolTierDef(kind, this.tierOf(kind)).efficiency;
  }

  /** The item id currently carried for this tool kind. */
  toolItemId(kind: ToolKind): ItemId {
    return toolTierDef(kind, this.tierOf(kind)).id;
  }

  private tierOf(kind: ToolKind): ToolTier {
    return this.state[tierFieldFor(kind)] ?? TOOL_TIER_BASIC;
  }
}
