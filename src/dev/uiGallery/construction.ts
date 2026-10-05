/**
 * The gallery's construction sheet: the Construction screen outdoors, indoors
 * and split into tabs, the Structure popover hung over a trebuchet, and the
 * companion's orders panel, all with fixture data.
 *
 * Each fixture's world surface stands in for the scene: it paints the
 * structure the popover hangs over, and the placement ghost the Construction
 * screen asks for while a card is hovered or focused, so a capture shows that
 * the hover reaches the world.
 */

import { CraftSkills } from '../../core/CraftSkills';
import type { ResourceCost } from '../../core/partyResources';
import type { ResourceId } from '../../core/resourceIds';
import { TILE_SIZE } from '../../core/constants';
import type { BuildOption, OptionStatus } from '../../systems/briarHollow/ConstructionSystem';
import {
  TREBUCHET_COCKED_ANGLE,
  TREBUCHET_FOOTPRINT_H,
  TREBUCHET_FOOTPRINT_W,
  drawTrebuchet,
} from '../../sprites/art/trebuchetArt';
import type { Rect } from '../../ui/core/geom';
import type { Surface } from '../../ui/core/UiRoot';
import {
  ConstructionScreen,
  type ConstructionScreenSource,
} from '../../ui/screens/construction/ConstructionScreen';
import {
  StructurePopover,
  type StructurePopoverModel,
} from '../../ui/screens/construction/StructurePopover';
import { FollowerScreen, type FollowerMenuState } from '../../ui/screens/follower/FollowerScreen';
import { text } from '../../ui/widgets/text';
import type { DialogFixture } from './dialogs/fixture';

const STOCK: Readonly<Record<ResourceId, number>> = {
  wood: 46,
  stone: 3,
  wood_board: 12,
  rope: 4,
};

const stockOf = (id: ResourceId): number => STOCK[id];

/** The fixture crawler's Construction XP: a few levels in, so discounts show. */
const FIXTURE_CONSTRUCTION_XP = 900;
/** Fixture build times, in seconds. */
const WALL_SECONDS = 4.5;
const STONE_SECONDS = 6;
const FORTIFIED_SECONDS = 9;
const TREBUCHET_SECONDS = 18;
const SNARE_SECONDS = 5.5;
const FIXTURE_KITS = 2;
/** The tabs fixture splits as soon as there are more options than this. */
const FIXTURE_TABS_FROM = 3;

function fixtureSkills(): CraftSkills {
  const skills = new CraftSkills('human');
  skills.learn('construction');
  skills.addXp('construction', FIXTURE_CONSTRUCTION_XP);
  return skills;
}

function row(
  option: BuildOption,
  label: string,
  fields: Partial<Omit<OptionStatus, 'option' | 'label'>> & {
    readonly cost: ResourceCost;
    readonly seconds: number;
  },
): OptionStatus {
  return {
    option,
    label,
    enabled: false,
    status: 'Ready',
    baseCost: fields.cost,
    affordable: true,
    kits: 0,
    usesKit: false,
    roomBlocked: false,
    refusal: null,
    ...fields,
  };
}

const OUTDOOR_ROWS: readonly OptionStatus[] = [
  row('wood', 'Wooden Wall', {
    enabled: true,
    status: 'Ready — repairs the breach',
    cost: { wood_board: 4 },
    baseCost: { wood_board: 5 },
    seconds: WALL_SECONDS,
  }),
  row('stone', 'Stone Wall', {
    status: 'Not enough materials',
    affordable: false,
    cost: { stone: 5 },
    seconds: STONE_SECONDS,
  }),
  row('fortified', 'Fortified Stone Wall', {
    status: 'Face a stone wall to fortify it',
    affordable: false,
    cost: { stone: 8, wood_board: 2 },
    seconds: FORTIFIED_SECONDS,
  }),
  row('trebuchet', 'Trebuchet', {
    enabled: true,
    status: 'Ready — builds in front of you',
    cost: {},
    baseCost: { wood_board: 15, rope: 5 },
    kits: FIXTURE_KITS,
    usesKit: true,
    seconds: TREBUCHET_SECONDS,
  }),
  row('snare', 'Snare Trap', {
    status: 'No room in front of you',
    roomBlocked: true,
    cost: { wood_board: 3, rope: 1 },
    seconds: SNARE_SECONDS,
  }),
];

const INDOOR_ROWS: readonly OptionStatus[] = [
  row('trebuchet', 'Trebuchet', {
    status: 'Build outdoors',
    refusal: 'Cannot build this while inside',
    cost: { wood_board: 15, rope: 5 },
    seconds: TREBUCHET_SECONDS,
  }),
  row('snare', 'Snare Trap', {
    status: 'Build outdoors',
    refusal: 'Cannot build this while inside',
    cost: { wood_board: 3, rope: 1 },
    seconds: SNARE_SECONDS,
  }),
];

/** The world's stand-in: a dim ghost box captioned with the option the screen is previewing. */
function ghostSurface(
  id: string,
  shown: () => boolean,
  preview: () => BuildOption | null,
): Surface {
  return {
    id: `${id}-world`,
    band: 'world',
    haltsWorld: false,
    isOpen: shown,
    render: (ui) => {
      const option = preview();
      if (option === null) return;
      const { space, size } = ui.theme;
      const box: Rect = {
        x: ui.viewport.x + space.lg,
        y: ui.viewport.y + space.lg,
        w: ui.viewport.w / 2,
        h: size.control,
      };
      text(ui, box, { text: `World ghost: ${option}`, role: 'warning' });
    },
  };
}

function constructionFixture(
  name: string,
  rows: readonly OptionStatus[],
  opts: { readonly tabsFrom?: number; readonly hover?: BuildOption } = {},
): DialogFixture {
  return {
    name,
    surfaces: (shown) => {
      const screen = new ConstructionScreen(null, {
        notify: () => undefined,
        tabsFrom: opts.tabsFrom,
      });
      let preview: BuildOption | null = null;
      const source: ConstructionScreenSource = {
        rows: () => rows,
        start: () => true,
        setPreview: (option) => {
          preview = option;
        },
      };
      const skills = fixtureSkills();
      const screenSurface = screen.surface(name, () => ({
        crawlerName: 'Carl',
        skills,
        partyCount: stockOf,
      }));
      const gated: Surface = {
        ...screenSurface,
        isOpen: () => {
          if (!shown()) return false;
          if (!screen.isOpen) screen.openWith(source);
          return screen.isOpen;
        },
        render: (ui) => screenSurface.render(ui),
      };
      return [ghostSurface(name, shown, () => preview), gated];
    },
    interact:
      opts.hover === undefined
        ? undefined
        : (rig) => {
            const target = rig.region(`${name}/option-${opts.hover}`);
            if (target !== null) rig.hover(target);
          },
  };
}

/** Where the fixture trebuchet stands, in tiles from the viewport's centre. */
const TREBUCHET_OFFSET_TILES = { x: -1, y: 1 } as const;

function trebuchetAnchor(viewportW: number, viewportH: number): Rect {
  return {
    x: viewportW / 2 + TREBUCHET_OFFSET_TILES.x * TILE_SIZE,
    y: viewportH / 2 + TREBUCHET_OFFSET_TILES.y * TILE_SIZE,
    w: TREBUCHET_FOOTPRINT_W * TILE_SIZE,
    h: TREBUCHET_FOOTPRINT_H * TILE_SIZE,
  };
}

const TREBUCHET_HP = 140;
const TREBUCHET_MAX_HP = 220;
const SPIKES_HP = 30;
const SPIKES_MAX_HP = 60;
const FIXTURE_AMMO_FRACTION = 0.4;

function structureFixture(): DialogFixture {
  return {
    name: 'structure-popover',
    surfaces: (shown) => {
      const popover = new StructurePopover(null);
      let anchor: Rect = { x: 0, y: 0, w: 0, h: 0 };
      const world: Surface = {
        id: 'structure-world',
        band: 'world',
        haltsWorld: false,
        isOpen: shown,
        render: (ui) => {
          const cssW = ui.screen.w * ui.uiScale;
          const cssH = ui.screen.h * ui.uiScale;
          anchor = trebuchetAnchor(cssW, cssH);
          const toUi = 1 / ui.uiScale;
          drawTrebuchet(ui.ctx, anchor.x * toUi, anchor.y * toUi, TILE_SIZE * toUi, {
            armAngle: TREBUCHET_COCKED_ANGLE,
            slingPhase: 0,
            broken: false,
            damageStage: 1,
            spikes: true,
            ammoFraction: FIXTURE_AMMO_FRACTION,
            infernal: false,
          });
        },
      };
      const model = (): StructurePopoverModel => ({
        title: 'Trebuchet',
        hp: TREBUCHET_HP,
        maxHp: TREBUCHET_MAX_HP,
        spikesHp: SPIKES_HP,
        spikesMaxHp: SPIKES_MAX_HP,
        detail: 'Ammunition: 4 / 10 stone',
        options: [
          { label: 'Load Stone…', action: () => undefined },
          { label: 'Quick Load', action: () => undefined },
          { label: 'Repair [Q]', cost: { wood_board: 3, rope: 1 }, action: () => undefined },
          {
            label: 'Repair Spikes',
            cost: { wood_board: 16 },
            disabledReason: 'Not enough materials',
            action: () => undefined,
          },
          { label: 'Destroy', style: 'danger', action: () => undefined },
          { label: 'Cancel', style: 'cancel', action: () => popover.close() },
        ],
        anchor,
      });
      const surface = popover.surface('structure-menu', { model, stockOf });
      const gated: Surface = {
        ...surface,
        isOpen: () => {
          if (!shown()) return false;
          if (!popover.isOpen) popover.show();
          return popover.isOpen;
        },
        render: (ui) => surface.render(ui),
      };
      return [world, gated];
    },
  };
}

function followerFixture(
  name: string,
  state: FollowerMenuState,
  restriction: number | null,
): DialogFixture {
  return {
    name,
    surfaces: (shown) => {
      const menu = new FollowerScreen();
      const surface = menu.surface({
        id: name,
        haltsWorld: false,
        state: () => state,
        restriction: () => restriction,
      });
      const gated: Surface = {
        ...surface,
        isOpen: () => {
          if (!shown()) return false;
          if (!menu.isOpen) menu.open();
          return menu.isOpen;
        },
        render: (ui) => surface.render(ui),
      };
      return [gated];
    },
  };
}

/** The tutorial row a restricted fixture allows: Follow me. */
const TUTORIAL_ALLOWED_ROW = 0;

export const CONSTRUCTION_FIXTURES: readonly DialogFixture[] = [
  constructionFixture('construction', OUTDOOR_ROWS, { hover: 'trebuchet' }),
  constructionFixture('construction-indoors', INDOOR_ROWS),
  constructionFixture('construction-tabs', OUTDOOR_ROWS, { tabsFrom: FIXTURE_TABS_FROM }),
  structureFixture(),
  followerFixture(
    'follower',
    {
      movementMode: 'follow',
      combatStance: 'aggressive',
      companionIsCat: true,
      mongoAutoSummon: true,
    },
    null,
  ),
  followerFixture(
    'follower-tutorial',
    {
      movementMode: 'anchored',
      combatStance: 'passive',
      companionIsCat: false,
      mongoAutoSummon: null,
    },
    TUTORIAL_ALLOWED_ROW,
  ),
];
