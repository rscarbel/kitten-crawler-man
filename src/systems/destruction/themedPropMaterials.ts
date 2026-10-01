/**
 * What the dungeon's long-standing breakable props are made of, floor by floor,
 * and what each leaves spilled round its wreckage.
 *
 * A barrel is one tile type everywhere but a different object on each floor:
 * an oak cask in the cellars, a steel drum on the service level. Its material,
 * its break cue, the colour of what it throws and what it spills therefore
 * depend on the floor it stands on, and some service-level drums hold oil.
 */

import type { DungeonFloorThemeId } from '../../map/dungeon/floorTheme';
import { isOilDrum, onServiceLevel } from '../../map/dungeon/propVariants';
import type { BreakMaterial, SmashCue } from './breakMaterials';
import type { PropKind } from '../../sprites/art/destructiblePropArt';

type Materials = readonly [BreakMaterial, ...BreakMaterial[]];

/** Chief material first, then anything else that comes out of it. */
export const THEMED_PROP_MATERIALS = {
  barrel: { cellars: ['wood', 'metal'], service_level: ['metal'] },
  barrel_side: { cellars: ['wood', 'metal'], service_level: ['metal'] },
  crate: { cellars: ['wood'], service_level: ['plastic'] },
  // Steel shelving holds cardboard supply boxes, and cardboard breaks like paper.
  bookshelf: { cellars: ['wood', 'paper'], service_level: ['metal', 'paper'] },
  torch: { cellars: ['metal', 'wood', 'cloth'], service_level: ['electrical', 'glass', 'metal'] },
  brazier: { cellars: ['metal'], service_level: ['metal'] },
} as const satisfies Record<PropKind, Record<DungeonFloorThemeId, Materials>>;

const THEME_SMASH_CUES = {
  barrel: { cellars: 'wood', service_level: 'iron' },
  barrel_side: { cellars: 'wood', service_level: 'iron' },
  crate: { cellars: 'wood', service_level: 'trash' },
  bookshelf: { cellars: 'wood', service_level: 'iron' },
  torch: { cellars: 'wood', service_level: 'iron' },
  brazier: { cellars: 'iron', service_level: 'iron' },
} as const satisfies Record<PropKind, Record<DungeonFloorThemeId, SmashCue>>;

const DRUM_SHADES = ['#25313b', '#3a4b59', '#566a7a', '#93a6b4'] as const;
const OIL_DRUM_SHADES = ['#141618', '#25292c', '#3f4448', '#9a7f2a'] as const;
const PLASTIC_SHADES = ['#22374a', '#34516a', '#4b6f8a', '#86a5ba'] as const;
const SHELVING_SHADES = ['#46505a', '#69747e', '#86694a', '#a48660'] as const;
const LAMP_SHADES = ['#a48a2c', '#6e5a1c', '#d6e2ea', '#46505a'] as const;
const DRUM_BRAZIER_SHADES = ['#25292c', '#3a2c24', '#ff8a1e', '#e2450f'] as const;

/** What a break leaves spread round its wreckage, beyond the wreckage itself. */
export type ThemedPropSpill = 'oil' | 'supply_boxes' | 'books' | 'coals';

function themeId(): DungeonFloorThemeId {
  return onServiceLevel() ? 'service_level' : 'cellars';
}

/** What the prop on this tile is made of, on the current floor. */
export function themedPropMaterials(kind: PropKind): Materials {
  return THEMED_PROP_MATERIALS[kind][themeId()];
}

/** Which break cue the prop plays on the current floor. */
export function themedPropSmashCue(kind: PropKind): SmashCue {
  return THEME_SMASH_CUES[kind][themeId()];
}

/**
 * The debris palette a service-level prop throws, or null on the cellars,
 * whose props throw the system's own wood and iron.
 */
export function serviceLevelSplinterShades(
  kind: PropKind,
  tileX: number,
  tileY: number,
): readonly [string, ...string[]] | null {
  if (!onServiceLevel()) return null;
  if (kind === 'barrel' && isOilDrum(tileX, tileY)) return OIL_DRUM_SHADES;
  if (kind === 'barrel' || kind === 'barrel_side') return DRUM_SHADES;
  if (kind === 'crate') return PLASTIC_SHADES;
  if (kind === 'bookshelf') return SHELVING_SHADES;
  if (kind === 'torch') return LAMP_SHADES;
  return DRUM_BRAZIER_SHADES;
}

/**
 * What the prop on this tile spills when it breaks, or null for a clean break.
 * An oil drum's spill is a pool that a flame — a broken torch or brazier, a
 * fireball, a blast — can set burning.
 */
export function themedPropSpill(
  kind: PropKind,
  tileX: number,
  tileY: number,
): ThemedPropSpill | null {
  if (kind === 'barrel') return isOilDrum(tileX, tileY) ? 'oil' : null;
  if (kind === 'bookshelf') return onServiceLevel() ? 'supply_boxes' : 'books';
  if (kind === 'brazier') return 'coals';
  return null;
}
