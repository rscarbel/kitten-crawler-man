/**
 * Mounts a sheet's named fixtures one at a time and, on the live `?ui` route,
 * a strip along the bottom that steps through them.
 */

import { splitH, type Rect } from '../../ui/core/geom';
import type { Surface } from '../../ui/core/UiRoot';
import { button } from '../../ui/widgets/button';
import { text } from '../../ui/widgets/text';
import type { DialogFixture } from './dialogs/fixture';
import type { GallerySheet, GalleryModel } from './model';

/** The picker's Prev and Next buttons are this many controls wide. */
const PICKER_BUTTON_CONTROLS = 2.5;

/** The fixture `sheet` is showing: the model's pick when it names one of `fixtures`, else the first. */
export function shownFixtureName(
  model: GalleryModel,
  sheet: GallerySheet,
  fixtures: readonly DialogFixture[],
): string | null {
  if (model.sheet !== sheet) return null;
  const picked = fixtures.find((fixture) => fixture.name === model.screenFixture);
  return picked?.name ?? (fixtures.length > 0 ? fixtures[0].name : null);
}

function step(
  model: GalleryModel,
  sheet: GallerySheet,
  fixtures: readonly DialogFixture[],
  by: number,
): void {
  const count = fixtures.length;
  if (count === 0) return;
  const current = fixtures.findIndex(
    (fixture) => fixture.name === shownFixtureName(model, sheet, fixtures),
  );
  model.screenFixture = fixtures[(current + by + count) % count].name;
}

/**
 * Every fixture's surfaces, each open only while its fixture is shown, plus
 * the live route's picker when `withPicker` is set.
 */
export function fixtureSheetSurfaces(
  model: GalleryModel,
  sheet: GallerySheet,
  fixtures: readonly DialogFixture[],
  withPicker: boolean,
): Surface[] {
  const surfaces = fixtures.flatMap((fixture) => [
    ...fixture.surfaces(() => shownFixtureName(model, sheet, fixtures) === fixture.name),
  ]);
  if (withPicker) surfaces.push(pickerSurface(model, sheet, fixtures));
  return surfaces;
}

function pickerSurface(
  model: GalleryModel,
  sheet: GallerySheet,
  fixtures: readonly DialogFixture[],
): Surface {
  return {
    id: `${sheet}-picker`,
    band: 'toast',
    haltsWorld: false,
    isOpen: () => model.sheet === sheet && fixtures.length > 1,
    onKey: (key) => {
      if (key === 'PageDown') step(model, sheet, fixtures, 1);
      else if (key === 'PageUp') step(model, sheet, fixtures, -1);
      else return false;
      return true;
    },
    render: (ui) => {
      const { space, size } = ui.theme;
      const h = size.control + space.sm * 2;
      const bar: Rect = {
        x: ui.viewport.x,
        y: ui.viewport.y + ui.viewport.h - h,
        w: ui.viewport.w,
        h,
      };
      ui.block(bar);
      const row: Rect = {
        x: bar.x + space.sm,
        y: bar.y + space.sm,
        w: bar.w - space.sm * 2,
        h: size.control,
      };
      const buttonW = size.control * PICKER_BUTTON_CONTROLS;
      const [prev, label, next] = splitH(row, [buttonW, 'fill', buttonW], space.sm);
      button(ui, prev, {
        id: 'prev',
        label: 'Prev',
        icon: 'back',
        onTap: () => step(model, sheet, fixtures, -1),
      });
      text(ui, label, {
        text: shownFixtureName(model, sheet, fixtures) ?? '',
        role: 'label',
        align: 'center',
      });
      button(ui, next, { id: 'next', label: 'Next', onTap: () => step(model, sheet, fixtures, 1) });
    },
  };
}
