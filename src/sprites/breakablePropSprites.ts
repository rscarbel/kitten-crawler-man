/**
 * The sheet and frame a long-standing breakable prop is drawn from on the
 * floor it stands on: the cellars' oak sheet, or the service level's steel and
 * plastic one. Every draw site — the standing prop, its break and its
 * wreckage — asks here, so all three always show the same object.
 */

import type { SpriteKey } from '../core/SpriteLoader';
import { isOilDrum, onServiceLevel, propVariantIndex } from '../map/dungeon/propVariants';
import type { PropKind } from './art/destructiblePropArt';

const PROP_KINDS: ReadonlySet<string> = new Set<PropKind>([
  'barrel',
  'barrel_side',
  'crate',
  'torch',
  'brazier',
  'bookshelf',
]);

/** Whether a breakable kind is one of the props every dungeon floor draws its own way. */
export function isThemedPropKind(kind: string): kind is PropKind {
  return PROP_KINDS.has(kind);
}

/** The service level's sheet for each cellars prop. */
const SERVICE_LEVEL_SHEETS = {
  barrel: 'steel_drum',
  barrel_side: 'steel_drum_side',
  crate: 'plastic_crate',
  bookshelf: 'steel_shelving',
  torch: 'work_lamp',
  brazier: 'drum_brazier',
} as const satisfies Record<PropKind, SpriteKey>;

/** The sheet the prop on this tile is drawn from on the current floor. */
export function themedPropSpriteKey(kind: PropKind, tileX: number, tileY: number): SpriteKey {
  if (!onServiceLevel()) return kind;
  if (kind === 'barrel' && isOilDrum(tileX, tileY)) return 'oil_drum';
  return SERVICE_LEVEL_SHEETS[kind];
}

/**
 * The frame of a static prop's idle, damaged or remains row for this tile: its
 * seeded look. The burning props animate those rows instead and keep one
 * wreckage frame.
 */
export function themedPropLookFrame(kind: PropKind, tileX: number, tileY: number): number {
  if (kind === 'torch' || kind === 'brazier') return 0;
  return propVariantIndex(tileX, tileY);
}
