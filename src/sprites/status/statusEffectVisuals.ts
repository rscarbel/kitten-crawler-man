/**
 * One place that answers, for any status effect: what does it look like on the
 * character, what does it look like in the HUD, and what is it called.
 *
 * Keeping the three answers in one place is what stops them from disagreeing.
 * The registry is keyed by every status, so a new one fails to compile until it
 * declares a look; one declared with none falls back to a generic grey HUD pill
 * and draws nothing on the character.
 *
 * Each entry can contribute two things:
 *
 * - a **body layer**, painted through the character's own silhouette by
 *   {@link ../../core/spriteAssets/silhouetteComposite}, so the effect is on the figure
 *   rather than beside it;
 * - an **overlay**, free-form world-space art drawn after the sprite.
 *
 * Statuses with no overlay still need a HUD entry, which is why `label` and
 * `color` are required and the two draw hooks are not.
 */

import type { SilhouetteLayer } from '../../core/spriteAssets/silhouetteComposite';
import {
  BLOOD_VOMIT_STATUS,
  CHILLED_STATUS,
  DOUBLE_DAMAGE_STATUS,
  FAIRY_AEGIS_STATUS,
  FAIRY_WARD_STATUS,
  FROZEN_STATUS,
  HAMBURGER_FED_STATUS,
  NUMBED_STATUS,
  OVERHEAL_STATUS,
  REFRESHED_STATUS,
  SHIELD_STATUS,
  SPEED_FIZZ_STATUS,
  type StatusEffect,
  type StatusId,
} from '../../core/combat/StatusEffect';
import type { StatusVisualFrame } from './statusPaint';
import { ARCANE_FLAME, NATURAL_FLAME, drawFlames, flameBodyLayers } from './statusFlames';
import {
  drawNumbed,
  drawPoison,
  drawSpitVenom,
  numbedBodyLayers,
  poisonBodyLayer,
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
  drawCatnipBuzz,
  drawDrunk,
  drawHearthWarmed,
  drawJuggJuice,
  drawSpeedFizzMotes,
  drawSpeedFizzTrail,
  drawWellRested,
  drawWhetstone,
  drunkBodyLayer,
  hearthWarmedBodyLayer,
  juggJuiceBodyLayer,
  speedFizzBodyLayer,
  wellRestedBodyLayer,
  whetstoneBodyLayer,
} from './statusBoons';
import { drawShieldDome } from './statusShield';
import { chilledBodyLayer, drawChilled, drawFrozen, frozenBodyLayer } from './statusFrost';
import {
  aegisBodyLayer,
  drawAegis,
  drawFairyWard,
  drawOverheal,
  overhealBodyLayer,
} from './statusFairyWards';
import { SHIELD_AMBER_DEEP } from '../art/earthElementalArt';
import { bloodVomitBodyLayers, drawBloodVomit } from './statusBloodVomit';

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
   * False for a status too brief to be worth a HUD pill: one that is over
   * before the eye finds the badge row is noise there, and the body already
   * shows it.
   */
  readonly showsHudPill: boolean;
  /**
   * Coats of paint applied through the character's own shape, in order. A list
   * rather than one coat because a single blend mode cannot both carry a colour
   * and add light, and fire needs both — see {@link flameBodyLayers}. Handed
   * the effect for coats that follow its own clock, such as a seizing bite.
   */
  readonly bodyLayers?: (
    frame: StatusVisualFrame,
    effect: StatusEffect,
  ) => readonly SilhouetteLayer[];
  /**
   * World-space art drawn on top of the character. Handed the effect itself
   * for art that plays through the effect's own life — rising when it is laid
   * on, breaking when it runs out.
   */
  readonly overlay?: (
    ctx: CanvasRenderingContext2D,
    frame: StatusVisualFrame,
    effect: StatusEffect,
  ) => void;
  /**
   * World-space art drawn *before* the sprite, so it reads as sitting behind
   * the body rather than pasted over it — motion streaks trailing a runner,
   * dust kicked up at the feet. Most statuses have no reason to draw here;
   * `overlay` is the default.
   */
  readonly preOverlay?: (
    ctx: CanvasRenderingContext2D,
    frame: StatusVisualFrame,
    effect: StatusEffect,
  ) => void;
}

/**
 * Every status's look, one entry per {@link StatusId}. Null for a status with
 * nothing to show: only mobs carry `ink`, and a mob has no HUD pill or body
 * coat for it.
 */
const STATUS_VISUALS: Readonly<Record<StatusId, StatusVisual | null>> = {
  burn: {
    label: 'BURN',
    color: '#f97316',
    harmful: true,
    showsHudPill: true,
    bodyLayers: (f) => flameBodyLayers(f, NATURAL_FLAME),
    overlay: (ctx, f) => drawFlames(ctx, f, NATURAL_FLAME),
  },
  magic_burn: {
    label: 'HEX',
    color: '#a855f7',
    harmful: true,
    showsHudPill: true,
    bodyLayers: (f) => flameBodyLayers(f, ARCANE_FLAME),
    overlay: (ctx, f) => drawFlames(ctx, f, ARCANE_FLAME),
  },
  poison: {
    label: 'PSN',
    color: '#22c55e',
    harmful: true,
    showsHudPill: true,
    bodyLayers: (f) => [poisonBodyLayer(f)],
    overlay: drawPoison,
  },
  spit_venom: {
    label: 'ACID',
    color: '#84cc16',
    harmful: true,
    showsHudPill: true,
    bodyLayers: (f) => [venomBodyLayer(f)],
    overlay: drawSpitVenom,
  },
  [BLOOD_VOMIT_STATUS]: {
    label: 'VOMT',
    color: '#dc2626',
    harmful: true,
    showsHudPill: false,
    bodyLayers: bloodVomitBodyLayers,
    overlay: drawBloodVomit,
  },
  [DOUBLE_DAMAGE_STATUS]: {
    label: 'DMx2',
    // The wheel's own red wedge, darkened, so the pill reads as the wedge that laid it.
    color: '#991b1b',
    harmful: true,
    showsHudPill: true,
  },
  stuck: {
    label: 'WEB',
    color: '#d9f99d',
    harmful: true,
    showsHudPill: true,
    bodyLayers: (f) => [stuckBodyLayer(f)],
    overlay: drawStuck,
  },
  stun: {
    label: 'STUN',
    color: '#fbbf24',
    harmful: true,
    showsHudPill: true,
    overlay: drawStun,
  },
  electrified: {
    label: 'ZAP',
    color: '#38bdf8',
    harmful: true,
    showsHudPill: true,
    bodyLayers: (f, effect) => [electrifiedBodyLayer(f, effect)],
    overlay: drawElectrified,
  },
  [SPEED_FIZZ_STATUS]: {
    label: 'FIZZ',
    color: '#0284c7',
    harmful: false,
    showsHudPill: true,
    bodyLayers: (f) => [speedFizzBodyLayer(f)],
    // The trail sits behind the body, opposite the direction of travel;
    // the ambient motes stay in front like every other boon's.
    preOverlay: drawSpeedFizzTrail,
    overlay: drawSpeedFizzMotes,
  },
  jugg_juice: {
    label: 'JUGG',
    color: '#ea580c',
    harmful: false,
    showsHudPill: true,
    bodyLayers: (f) => [juggJuiceBodyLayer(f)],
    overlay: drawJuggJuice,
  },
  cooldown_crisp: {
    label: 'CRSP',
    color: '#059669',
    harmful: false,
    showsHudPill: true,
    bodyLayers: (f) => [cooldownCrispBodyLayer(f)],
    overlay: drawCooldownCrisp,
  },
  whetstone: {
    label: 'EDGE',
    color: '#94a3b8',
    harmful: false,
    showsHudPill: true,
    bodyLayers: (f) => [whetstoneBodyLayer(f)],
    overlay: drawWhetstone,
  },
  well_rested: {
    label: 'RSTD',
    color: '#f5d68a',
    harmful: false,
    showsHudPill: true,
    bodyLayers: (f) => [wellRestedBodyLayer(f)],
    overlay: drawWellRested,
  },
  hearth_warmed: {
    label: 'WARM',
    color: '#f4725c',
    harmful: false,
    showsHudPill: true,
    bodyLayers: (f) => [hearthWarmedBodyLayer(f)],
    overlay: drawHearthWarmed,
  },
  deep_slumber: {
    label: 'DEEP',
    color: '#8a94f4',
    harmful: false,
    showsHudPill: true,
    bodyLayers: (f) => [deepSlumberBodyLayer(f)],
    overlay: drawDeepSlumber,
  },
  [HAMBURGER_FED_STATUS]: {
    label: 'FED',
    // Mustard, the burger's own cheese, so the pill reads as the food that granted it.
    color: '#e0a526',
    harmful: false,
    showsHudPill: true,
  },
  [REFRESHED_STATUS]: {
    label: 'FRESH',
    // Clean tap-water aqua, the plumbing that granted it.
    color: '#5eead4',
    harmful: false,
    showsHudPill: true,
  },
  [SHIELD_STATUS]: {
    label: 'SHLD',
    // The amber of the dome itself, so the badge and the picture read as one thing.
    color: SHIELD_AMBER_DEEP,
    harmful: false,
    showsHudPill: true,
    overlay: drawShieldDome,
  },
  [CHILLED_STATUS]: {
    label: 'CHIL',
    color: '#7dd3fc',
    harmful: true,
    showsHudPill: true,
    bodyLayers: (f) => [chilledBodyLayer(f)],
    overlay: drawChilled,
  },
  [FROZEN_STATUS]: {
    label: 'FRZN',
    color: '#bae6fd',
    harmful: true,
    showsHudPill: true,
    bodyLayers: (f) => [frozenBodyLayer(f)],
    overlay: drawFrozen,
  },
  [NUMBED_STATUS]: {
    label: 'NUMB',
    color: '#7c9a5e',
    harmful: true,
    showsHudPill: true,
    bodyLayers: numbedBodyLayers,
    overlay: drawNumbed,
  },
  [FAIRY_WARD_STATUS]: {
    label: 'WARD',
    color: '#3b82f6',
    harmful: false,
    showsHudPill: true,
    overlay: drawFairyWard,
  },
  [FAIRY_AEGIS_STATUS]: {
    label: 'AEGS',
    color: '#93c5fd',
    harmful: false,
    showsHudPill: true,
    bodyLayers: (f) => [aegisBodyLayer(f)],
    overlay: drawAegis,
  },
  [OVERHEAL_STATUS]: {
    label: 'OVHL',
    color: '#d9f99d',
    harmful: false,
    showsHudPill: true,
    bodyLayers: (f) => [overhealBodyLayer(f)],
    overlay: drawOverheal,
  },
  drunk: {
    label: 'DRNK',
    color: '#b45309',
    harmful: false,
    showsHudPill: true,
    bodyLayers: (f) => [drunkBodyLayer(f)],
    overlay: drawDrunk,
  },
  catnip_buzz: {
    label: 'NIP!',
    color: '#65a30d',
    harmful: false,
    showsHudPill: true,
    overlay: drawCatnipBuzz,
  },
  ink: null,
};

/** Badge styling for a status with no look of its own, so one can never be invisible. */
const UNKNOWN_STATUS_COLOR = '#6b7280';
const UNKNOWN_STATUS_LABEL_LENGTH = 4;

export function statusVisual(type: StatusId): StatusVisual | null {
  return STATUS_VISUALS[type];
}

/** Whether the HUD shows a pill for `type`; see {@link StatusVisual.showsHudPill}. */
export function statusShowsHudPill(type: StatusId): boolean {
  return STATUS_VISUALS[type]?.showsHudPill ?? true;
}

/** Label and colour for a HUD badge, falling back for a status with no look. */
export function statusBadge(type: StatusId): { label: string; color: string; harmful: boolean } {
  const visual = STATUS_VISUALS[type];
  if (visual !== null) {
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
 * most recent one paints last and wins any argument about the rim. Appended
 * to `layers` when given, so a caller drawing every frame can reuse one array.
 */
export function statusBodyLayers(
  effects: readonly StatusEffect[],
  frameFor: (effect: StatusEffect) => StatusVisualFrame,
  layers: SilhouetteLayer[] = [],
): SilhouetteLayer[] {
  for (const effect of effects) {
    const bodyLayers = STATUS_VISUALS[effect.type]?.bodyLayers;
    if (bodyLayers === undefined) continue;
    layers.push(...bodyLayers(frameFor(effect), effect));
  }
  return layers;
}
