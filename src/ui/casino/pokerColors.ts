/**
 * Every colour the Texas Hold'em table paints its felt, rail, seats and
 * markers with, derived from the theme's tokens so the poker table and Deuce's
 * blackjack table read as one room.
 */

import { darken, lighten, mix, withAlpha } from '../theme/color';
import { skinsFor } from '../theme/skins';
import type { Theme } from '../theme/tokens';

export interface PokerTableColors {
  readonly feltCentre: string;
  readonly feltEdge: string;
  readonly feltLine: string;
  readonly rail: string;
  readonly railHighlight: string;
  readonly railShadow: string;
  readonly plate: string;
  readonly plateBorder: string;
  readonly plateActing: string;
  readonly avatarBack: string;
  readonly avatarRing: string;
  readonly actingRing: string;
  readonly actingGlow: string;
  readonly winnerGlow: string;
  readonly tiltFlush: string;
  readonly name: string;
  readonly stack: string;
  readonly muted: string;
  readonly puckFace: string;
  readonly puckEdge: string;
  readonly puckText: string;
  readonly smallBlind: string;
  readonly bigBlind: string;
  readonly markerText: string;
  readonly potText: string;
  readonly betText: string;
  readonly betHalo: string;
  readonly slot: string;
  readonly slotLine: string;
  readonly winHighlight: string;
  readonly banter: string;
  readonly title: string;
  readonly readout: string;
  readonly handLabel: string;
  readonly handLabelEmphasis: string;
  readonly crawler: { readonly human: string; readonly cat: string };
  readonly bustBack: string;
  readonly bustBorder: string;
  readonly shuffleVeil: string;
}

const FELT_EDGE_DARKEN = 0.45;
const FELT_CENTRE_LIGHTEN = 0.06;
const FELT_LINE_ALPHA = 0.3;
const RAIL_HIGHLIGHT_LIGHTEN = 0.22;
const RAIL_SHADOW_DARKEN = 0.5;
const PLATE_ALPHA = 0.92;
const PLATE_ACTING_MIX = 0.18;
const ACTING_GLOW_ALPHA = 0.55;
const WINNER_GLOW_ALPHA = 0.85;
const TILT_FLUSH_ALPHA = 0.38;
const SLOT_ALPHA = 0.35;
const SLOT_LINE_ALPHA = 0.25;
const WIN_HIGHLIGHT_ALPHA = 0.9;
const BET_HALO_ALPHA = 0.85;
const BUST_BACK_ALPHA = 0.7;
const SHUFFLE_VEIL_ALPHA = 0.5;

const cache = new WeakMap<Theme, PokerTableColors>();

export function pokerTableColors(theme: Theme): PokerTableColors {
  const cached = cache.get(theme);
  if (cached !== undefined) return cached;
  const { palette } = theme;
  const chip = skinsFor(theme).casinoChip;
  const felt = palette.material.felt;
  const rail = palette.material.rail;
  const colors: PokerTableColors = {
    feltCentre: lighten(felt, FELT_CENTRE_LIGHTEN),
    feltEdge: darken(felt, FELT_EDGE_DARKEN),
    feltLine: withAlpha(chip.rim, FELT_LINE_ALPHA),
    rail,
    railHighlight: lighten(rail, RAIL_HIGHLIGHT_LIGHTEN),
    railShadow: darken(rail, RAIL_SHADOW_DARKEN),
    plate: withAlpha(palette.surface.raised, PLATE_ALPHA),
    plateBorder: palette.border.strong,
    plateActing: mix(palette.surface.raised, palette.accent.base, PLATE_ACTING_MIX),
    avatarBack: palette.surface.sunken,
    avatarRing: palette.border.strong,
    actingRing: palette.accent.base,
    actingGlow: withAlpha(palette.accent.base, ACTING_GLOW_ALPHA),
    winnerGlow: withAlpha(palette.accent.celebrate, WINNER_GLOW_ALPHA),
    tiltFlush: withAlpha(palette.state.danger, TILT_FLUSH_ALPHA),
    name: palette.text.primary,
    stack: palette.accent.hover,
    muted: palette.text.muted,
    puckFace: palette.material.chipWhite,
    puckEdge: palette.text.secondary,
    puckText: palette.text.inverse,
    smallBlind: palette.state.info,
    bigBlind: palette.accent.base,
    markerText: palette.text.inverse,
    potText: palette.text.primary,
    betText: palette.text.primary,
    betHalo: withAlpha(palette.surface.sunken, BET_HALO_ALPHA),
    slot: withAlpha(darken(felt, FELT_EDGE_DARKEN), SLOT_ALPHA),
    slotLine: withAlpha(chip.rim, SLOT_LINE_ALPHA),
    winHighlight: withAlpha(palette.accent.base, WIN_HIGHLIGHT_ALPHA),
    banter: palette.text.secondary,
    title: palette.accent.base,
    readout: palette.text.secondary,
    handLabel: palette.text.secondary,
    handLabelEmphasis: palette.text.primary,
    crawler: palette.crawler,
    bustBack: withAlpha(palette.surface.sunken, BUST_BACK_ALPHA),
    bustBorder: palette.border.subtle,
    shuffleVeil: withAlpha(darken(felt, FELT_EDGE_DARKEN), SHUFFLE_VEIL_ALPHA),
  };
  cache.set(theme, colors);
  return colors;
}
