/**
 * The axe and pick of every tier, and Merrit's scythe, as held visuals: the
 * shared handle in each tier's wood, and the tier's head mounted at its end.
 */

import {
  TOOL_TIER_LOOKS,
  TOOL_TIERS,
  type ToolKind,
  type ToolTier,
} from '../../../core/items/gathering/toolTiers';
import {
  paintScytheBlade,
  paintScytheSnath,
  paintToolHead,
  SCYTHE_DIMENSIONS,
  TOOL_KNOB_LENGTH,
  toolHaftLength,
  toolHeadSize,
} from '../../art/toolArt';
import { defineHeldVisual, type HeldVisualDef } from '../heldVisualDef';
import type { ToolHeldVisualId } from '../heldVisualIds';

function toolHeld(id: ToolHeldVisualId, kind: ToolKind, tier: ToolTier): HeldVisualDef {
  const handleLength = toolHaftLength(tier) + TOOL_KNOB_LENGTH;
  const head = toolHeadSize(kind, tier);
  return defineHeldVisual({
    id,
    name: TOOL_TIERS[kind][tier].name,
    archetype: 'twoHandHaft',
    weight: 'heavy',
    handle: { length: handleLength, radius: 'standard' },
    head: { length: head.along, width: head.across },
    gripPoint: TOOL_KNOB_LENGTH / handleLength,
    phases: 1,
    handleLook: { colour: TOOL_TIER_LOOKS[tier].hafColor, butt: 'knob' },
    paintHead: (ctx) => paintToolHead(ctx, kind, tier),
  });
}

/** Every tool tier's held visual, by kind and tier. */
export const TOOL_HELD: Readonly<Record<ToolKind, Readonly<Record<ToolTier, HeldVisualDef>>>> = {
  axe: {
    0: toolHeld('basic_axe', 'axe', 0),
    1: toolHeld('hardened_axe', 'axe', 1),
    2: toolHeld('lumberjacks_axe', 'axe', 2),
    3: toolHeld('ratkin_forge_axe', 'axe', 3),
    4: toolHeld('deepwood_cleaver', 'axe', 4),
    5: toolHeld('graveyards_bane', 'axe', 5),
  },
  pickaxe: {
    0: toolHeld('basic_pickaxe', 'pickaxe', 0),
    1: toolHeld('hardened_pickaxe', 'pickaxe', 1),
    2: toolHeld('quarrymans_pick', 'pickaxe', 2),
    3: toolHeld('ratkin_forge_pick', 'pickaxe', 3),
    4: toolHeld('stonebreaker', 'pickaxe', 4),
    5: toolHeld('worldscar_pick', 'pickaxe', 5),
  },
};

const SCYTHE_HANDLE_LENGTH = SCYTHE_DIMENSIONS.snathLength + TOOL_KNOB_LENGTH;

/** Merrit's scythe: its own bowed snath with the nib for a handle. */
export const SCYTHE_HELD = defineHeldVisual({
  id: 'quest_scythe',
  name: "Merrit's Scythe",
  archetype: 'twoHandHaft',
  weight: 'heavy',
  handle: { length: SCYTHE_HANDLE_LENGTH, radius: 'standard' },
  head: { length: SCYTHE_DIMENSIONS.bladeAlong, width: SCYTHE_DIMENSIONS.bladeAcross },
  gripPoint: TOOL_KNOB_LENGTH / SCYTHE_HANDLE_LENGTH,
  phases: 1,
  paintHandle: (ctx) => paintScytheSnath(ctx),
  paintHead: (ctx) => paintScytheBlade(ctx),
});
