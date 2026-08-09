/**
 * Where every equipment sub-slot sits on a paper doll.
 *
 * Shared rather than owned by one panel: the G-key gear screen and the pause
 * menu's Equipment tab draw the same eighteen cells in the same arrangement, and
 * a hit-test that disagrees with the drawing by a single pixel is a slot the
 * player can see but not click.
 */

import { EQUIP_SUBSLOTS } from '../core/ItemDefs';
import type { EquipSlot } from '../core/ItemDefs';

/** Inset from the panel's left edge to the section label column. */
export const EQUIP_PANEL_PAD = 12;

/** Width reserved for the HEAD / TORSO / LEGS section labels beside each row. */
export const EQUIP_SECTION_LABEL_W = 52;

/** Vertical gap between the bottom of one section's cells and the next section. */
export const EQUIP_SECTION_PAD = 8;

/** Head to foot, which is the order the sections stack down the panel. */
export const EQUIP_SLOT_ORDER = [
  'Head',
  'Torso',
  'Legs',
  'Hands',
  'Feet',
] as const satisfies readonly EquipSlot[];

/** Screen position of a single equipment sub-slot cell. */
export interface EquipSlotInfo {
  /** The `"Slot:SubSlot"` key the equipment map is keyed on. */
  key: string;
  slot: EquipSlot;
  subSlot: string;
  x: number;
  y: number;
}

/**
 * Lay out every sub-slot of every section, top-left corners in screen space.
 *
 * Sections flow downward in {@link EQUIP_SLOT_ORDER}; within a section the cells
 * wrap to as many rows as the panel width forces.
 */
export function buildEquipSlotInfos(
  panelX: number,
  startY: number,
  panelW: number,
  slotSize: number,
  slotGap: number,
): EquipSlotInfo[] {
  const infos: EquipSlotInfo[] = [];
  const startX = panelX + EQUIP_PANEL_PAD + EQUIP_SECTION_LABEL_W;
  const usableW = panelW - EQUIP_PANEL_PAD * 2 - EQUIP_SECTION_LABEL_W;
  // A panel too narrow for even one cell would otherwise divide by a zero column
  // count and place every cell at NaN, which draws nothing and hit-tests false.
  const maxPerRow = Math.max(1, Math.floor(usableW / (slotSize + slotGap)));

  let sectionY = startY;
  for (const slot of EQUIP_SLOT_ORDER) {
    const subSlots = EQUIP_SUBSLOTS[slot];
    let sectionBottom = sectionY;
    for (let i = 0; i < subSlots.length; i++) {
      const subSlot = subSlots[i];
      const col = i % maxPerRow;
      const row = Math.floor(i / maxPerRow);
      const y = sectionY + row * (slotSize + slotGap);
      infos.push({
        key: `${slot}:${subSlot}`,
        slot,
        subSlot,
        x: startX + col * (slotSize + slotGap),
        y,
      });
      sectionBottom = Math.max(sectionBottom, y + slotSize);
    }
    sectionY = sectionBottom + EQUIP_SECTION_PAD;
  }
  return infos;
}

/** The `"Slot:SubSlot"` key of the cell under (mx, my), or null for a miss. */
export function equipSlotKeyAt(
  mx: number,
  my: number,
  infos: ReadonlyArray<EquipSlotInfo>,
  slotSize: number,
): string | null {
  for (const info of infos) {
    if (mx >= info.x && mx <= info.x + slotSize && my >= info.y && my <= info.y + slotSize) {
      return info.key;
    }
  }
  return null;
}

/** Top edge of a section's first row of cells, for placing its label. */
export function equipSectionTopY(
  infos: ReadonlyArray<EquipSlotInfo>,
  slot: EquipSlot,
  fallbackY: number,
): number {
  let top: number | null = null;
  for (const info of infos) {
    if (info.slot !== slot) continue;
    top = top === null ? info.y : Math.min(top, info.y);
  }
  return top ?? fallbackY;
}

/** Bottom edge of the lowest cell, so a caller can place content under the doll. */
export function equipLayoutBottomY(
  infos: ReadonlyArray<EquipSlotInfo>,
  slotSize: number,
  fallbackY: number,
): number {
  let bottom = fallbackY;
  for (const info of infos) bottom = Math.max(bottom, info.y + slotSize);
  return bottom;
}
