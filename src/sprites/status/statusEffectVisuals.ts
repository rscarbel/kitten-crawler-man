/**
 * One place that answers, for any status effect: what does it look like on the
 * character, what does it look like in the HUD, and what is it called.
 *
 * Before this registry existed those three answers lived in three files and
 * disagreed — seven of the twelve statuses drew nothing on the character at all,
 * and the same seven fell through to an identical grey HUD pill, so a player
 * being stunned, webbed and electrocuted saw three indistinguishable badges and
 * no world-space cue whatsoever. Adding a status now means adding one entry
 * here; leaving one out is visible immediately rather than three files away.
 *
 * Each entry can contribute two things:
 *
 * - a **body layer**, painted through the character's own silhouette by
 *   {@link ../../core/silhouetteComposite}, so the effect is on the figure
 *   rather than beside it;
 * - an **overlay**, free-form world-space art drawn after the sprite.
 *
 * Statuses with no overlay still need a HUD entry, which is why `label` and
 * `color` are required and the two draw hooks are not.
 */

import type { SilhouetteLayer } from '../../core/silhouetteComposite';
import type { StatusEffect } from '../../core/StatusEffect';
import type { StatusVisualFrame } from './statusPaint';
import { ARCANE_FLAME, NATURAL_FLAME, drawFlames, flameBodyLayers } from './statusFlames';
import {
  drawPoison,
  drawSepsis,
  drawSpitVenom,
  poisonBodyLayer,
  sepsisBodyLayer,
  venomBodyLayer,
} from './statusAilments';
import {
  drawElectrified,
  drawStuck,
  drawStun,
  electrifiedBodyLayer,
  stuckBodyLayer,
} from './statusRestraints';
import {
  cooldownCrispBodyLayer,
  deepSlumberBodyLayer,
  drawCooldownCrisp,
  drawDeepSlumber,
  drawDrunk,
  drawHearthWarmed,
  drawJuggJuice,
  drawSpeedFizz,
  drawWellRested,
  drawWhetstone,
  drunkBodyLayer,
  hearthWarmedBodyLayer,
  juggJuiceBodyLayer,
  speedFizzBodyLayer,
  wellRestedBodyLayer,
  whetstoneBodyLayer,
} from './statusBoons';

export type { StatusVisualFrame } from './statusPaint';

/** How one status effect presents itself, in the world and in the HUD. */
export interface StatusVisual {
  /** Short badge text. Kept to four characters so every pill is the same width. */
  readonly label: string;
  /** Badge fill, and the colour a player learns to associate with the effect. */
  readonly color: string;
  /** Whether this is something to fear. Drives the badge's urgency styling. */
  readonly harmful: boolean;
  /**
   * Coats of paint applied through the character's own shape, in order. A list
   * rather than one coat because a single blend mode cannot both carry a colour
   * and add light, and fire needs both — see {@link flameBodyLayers}.
   */
  readonly bodyLayers?: (frame: StatusVisualFrame) => readonly SilhouetteLayer[];
  /** World-space art drawn on top of the character. */
  readonly overlay?: (ctx: CanvasRenderingContext2D, frame: StatusVisualFrame) => void;
}

const STATUS_VISUALS = new Map<string, StatusVisual>([
  [
    'burn',
    {
      label: 'BURN',
      color: '#f97316',
      harmful: true,
      bodyLayers: (f) => flameBodyLayers(f, NATURAL_FLAME),
      overlay: (ctx, f) => drawFlames(ctx, f, NATURAL_FLAME),
    },
  ],
  [
    'magic_burn',
    {
      label: 'HEX',
      color: '#a855f7',
      harmful: true,
      bodyLayers: (f) => flameBodyLayers(f, ARCANE_FLAME),
      overlay: (ctx, f) => drawFlames(ctx, f, ARCANE_FLAME),
    },
  ],
  [
    'poison',
    {
      label: 'PSN',
      color: '#22c55e',
      harmful: true,
      bodyLayers: (f) => [poisonBodyLayer(f)],
      overlay: drawPoison,
    },
  ],
  [
    'sepsis',
    {
      label: 'SEPS',
      color: '#a3e635',
      harmful: true,
      bodyLayers: (f) => [sepsisBodyLayer(f)],
      overlay: drawSepsis,
    },
  ],
  [
    'spit_venom',
    {
      label: 'ACID',
      color: '#84cc16',
      harmful: true,
      bodyLayers: (f) => [venomBodyLayer(f)],
      overlay: drawSpitVenom,
    },
  ],
  [
    'stuck',
    {
      label: 'WEB',
      color: '#d9f99d',
      harmful: true,
      bodyLayers: (f) => [stuckBodyLayer(f)],
      overlay: drawStuck,
    },
  ],
  [
    'stun',
    {
      label: 'STUN',
      color: '#fbbf24',
      harmful: true,
      overlay: drawStun,
    },
  ],
  [
    'electrified',
    {
      label: 'ZAP',
      color: '#38bdf8',
      harmful: true,
      bodyLayers: (f) => [electrifiedBodyLayer(f)],
      overlay: drawElectrified,
    },
  ],
  [
    'speed_fizz',
    {
      label: 'FIZZ',
      color: '#0284c7',
      harmful: false,
      bodyLayers: (f) => [speedFizzBodyLayer(f)],
      overlay: drawSpeedFizz,
    },
  ],
  [
    'jugg_juice',
    {
      label: 'JUGG',
      color: '#ea580c',
      harmful: false,
      bodyLayers: (f) => [juggJuiceBodyLayer(f)],
      overlay: drawJuggJuice,
    },
  ],
  [
    'cooldown_crisp',
    {
      label: 'CRSP',
      color: '#059669',
      harmful: false,
      bodyLayers: (f) => [cooldownCrispBodyLayer(f)],
      overlay: drawCooldownCrisp,
    },
  ],
  [
    'whetstone',
    {
      label: 'EDGE',
      color: '#94a3b8',
      harmful: false,
      bodyLayers: (f) => [whetstoneBodyLayer(f)],
      overlay: drawWhetstone,
    },
  ],
  [
    'well_rested',
    {
      label: 'RSTD',
      color: '#f5d68a',
      harmful: false,
      bodyLayers: (f) => [wellRestedBodyLayer(f)],
      overlay: drawWellRested,
    },
  ],
  [
    'hearth_warmed',
    {
      label: 'WARM',
      color: '#f4725c',
      harmful: false,
      bodyLayers: (f) => [hearthWarmedBodyLayer(f)],
      overlay: drawHearthWarmed,
    },
  ],
  [
    'deep_slumber',
    {
      label: 'DEEP',
      color: '#8a94f4',
      harmful: false,
      bodyLayers: (f) => [deepSlumberBodyLayer(f)],
      overlay: drawDeepSlumber,
    },
  ],
  [
    'drunk',
    {
      label: 'DRNK',
      color: '#b45309',
      harmful: false,
      bodyLayers: (f) => [drunkBodyLayer(f)],
      overlay: drawDrunk,
    },
  ],
]);

/** Badge styling for a status with no registry entry, so one can never be invisible. */
const UNKNOWN_STATUS_COLOR = '#6b7280';
const UNKNOWN_STATUS_LABEL_LENGTH = 4;

export function statusVisual(type: string): StatusVisual | undefined {
  return STATUS_VISUALS.get(type);
}

/** Label and colour for a HUD badge, falling back for an unregistered status. */
export function statusBadge(type: string): { label: string; color: string; harmful: boolean } {
  const visual = STATUS_VISUALS.get(type);
  if (visual !== undefined) {
    return { label: visual.label, color: visual.color, harmful: visual.harmful };
  }
  return {
    label: type.toUpperCase().slice(0, UNKNOWN_STATUS_LABEL_LENGTH),
    color: UNKNOWN_STATUS_COLOR,
    harmful: true,
  };
}

/**
 * Ticks over which an expiring effect fades out. A flame that vanishes between
 * one frame and the next reads as a rendering glitch; a flame that gutters
 * reads as the fire going out.
 */
const FADE_OUT_TICKS = 30;

/** How much of the effect is left to draw, in 0..1. */
export function statusFade(effect: StatusEffect): number {
  return Math.min(1, effect.ticksRemaining / FADE_OUT_TICKS);
}

/**
 * Every silhouette layer the character's active statuses ask for, in
 * registry-independent order — the order the effects were applied in, so the
 * most recent one paints last and wins any argument about the rim.
 */
export function statusBodyLayers(
  effects: readonly StatusEffect[],
  frameFor: (effect: StatusEffect) => StatusVisualFrame,
): SilhouetteLayer[] {
  const layers: SilhouetteLayer[] = [];
  for (const effect of effects) {
    const bodyLayers = STATUS_VISUALS.get(effect.type)?.bodyLayers;
    if (bodyLayers === undefined) continue;
    layers.push(...bodyLayers(frameFor(effect)));
  }
  return layers;
}
