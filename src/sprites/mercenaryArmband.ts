/**
 * The cloth band every hire of The Barracks Mercenaries wears round one arm, so
 * a player can tell a hired ally from a hostile of the same kind at a glance.
 *
 * One colour for every hire, whatever paints it: a figure picks its own lit and
 * shaded steps for its own shading model, but its base is always this.
 */
export const MERCENARY_ARMBAND = {
  base: '#e06040',
  light: '#f39070',
  shadow: '#a8432a',
} as const;
