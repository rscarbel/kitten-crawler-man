/**
 * Gates a phone's HUD — the same layout in the dungeon and inside a building —
 * at every common phone size in portrait and landscape, at every UI size, and
 * in every HUD state that moves a piece: minimap normal or expanded, and the
 * Build slot. Rects are in UI units, as the HUD lays itself out. The top
 * band is filled with a boss bar, an encounter bar, a countdown and a banner.
 *
 * Every rect comes from `hudLayout`, the function the HUD draws from
 * (`phoneHudLayouts.ts`). For each layout:
 * - every button is wholly on screen;
 * - no two buttons overlap, none covers the minimap's normal square, and none
 *   covers the band's leading bars, a boss and an encounter (buttons and bars
 *   may lie over the part an expanded minimap grew into);
 * - no button covers either crawler's HP meter;
 * - the leading bars always find room, and every bar placed is on screen;
 * - on a compact screen no bar covers the box around the screen's middle
 *   where the camera holds the player, except a fight's leading bar where
 *   the screen leaves it no other room; on a phone upright at least
 *   {@link ROOMY_PORTRAIT_MIN_W} wide at a small or medium UI size, not even
 *   those;
 * - on a phone upright, an interaction prompt over a figure anywhere in the
 *   play area clear of the HUD lands wholly on screen, under none of the HUD's
 *   chrome and off the figure itself, even beside the dock's column of
 *   buttons down the right edge. The prompt is placed from the keep-outs the
 *   HUD itself gives it (`promptKeepOutsOf`) and checked against every piece
 *   the layout reports, and every piece must lie inside one of those
 *   keep-outs.
 *
 * - during the Warden's fight, on every phone layout and on desktop screens,
 *   the cattery's north wall row is on screen below the top band's cards
 *   from every tile where the room lets the camera show it with the party
 *   (`wardenFightFraming.ts`). The same check run against a camera blind to
 *   the band and to the fight's rows must fail.
 *
 *   npm run gates:phone-hud
 */

import { overlaps, type Rect } from '../src/ui/core/geom';
import type { UiSize } from '../src/core/input/Settings';
import { dockButtonRect } from '../src/ui/hud/dock';
import { promptKeepOutsOf } from '../src/ui/hud/HudSurface';
import { DOCK_BUTTON_IDS } from '../src/ui/hud/hudModel';
import { placePromptPill } from '../src/ui/hud/prompt';
import { PROMPT_BOB_AMPLITUDE, promptPillHeight } from '../src/ui/InteractionPrompt';
import { LEADING_BARS, hudStates, representativeTopBand, type HudState } from './phoneHudLayouts';
import { wardenFightFramingFailures, type FightFraming } from './wardenFightFraming';

/** Common phone viewports in CSS pixels, portrait; each is also checked in landscape. */
const PORTRAIT_PHONES: ReadonlyArray<readonly [number, number]> = [
  [320, 568],
  [360, 640],
  [375, 667],
  [390, 844],
  [414, 896],
  [430, 932],
];
const VIEWPORTS = PORTRAIT_PHONES.flatMap(([w, h]) => [[w, h] as const, [h, w] as const]);

/** Pieces every layout must report: a layout missing one would pass every check by never being measured. */
const REQUIRED_PIECES: readonly string[] = [
  'pause',
  'bag',
  'follower',
  'switch',
  'summon',
  'chip',
  'journal',
  'hotbar',
  'minimap',
];

const UI_SIZES: readonly UiSize[] = ['small', 'medium', 'large'];

/** Desktop screens the Warden's fight is framed on, beside the phones; the shortest is a browser window not maximised. */
const DESKTOP_VIEWPORTS: ReadonlyArray<readonly [number, number]> = [
  [1440, 900],
  [1280, 720],
  [800, 600],
  [760, 390],
];

/** A camera that frames the fight as if the band held only the room's name and the fight had no rows. */
const BLIND_FRAMING: FightFraming = { band: false, arenaRows: null };

/** A phone upright at least this wide has room for a fight's bars above the player. */
const ROOMY_PORTRAIT_MIN_W = 390;
const UI_SIZES_WITH_ROOM_ABOVE_PLAYER: ReadonlySet<UiSize> = new Set(['small', 'medium']);

/** A prompt's pill with a short label ("TAP Talk"), in UI units. */
const PROMPT_PILL_WIDTH = 88;
/** A figure a prompt floats over, about one character tall at a phone's zoom, in UI units. */
const PROMPT_TARGET_W = 32;
const PROMPT_TARGET_H = 48;
/** How finely figures are stepped across the play area, in UI units. */
const PROMPT_TARGET_STEP = 8;

/**
 * Every figure position in the play area that no HUD chrome covers, each with
 * the pill `placePromptPill` puts over it; returns the failures and how many
 * figures were checked.
 */
function promptPlacementFailures(
  state: HudState,
  where: string,
): { failures: string[]; checked: number } {
  const { geometry, width, height } = state;
  const drawnDock = DOCK_BUTTON_IDS.map((id) => dockButtonRect(geometry.buttons, id)).filter(
    (rect): rect is Rect => rect !== null,
  );
  const hudKeepOuts = promptKeepOutsOf({
    framesBlock: state.framesBlock,
    miniMap: geometry.miniMap,
    dock: drawnDock,
    summon: geometry.buttons.summon,
    hotbar: geometry.hotbar.strip,
    band: state.pieces.filter((piece) => piece.kind === 'surface').map((piece) => piece.rect),
  });
  // Checked against every piece the layout reports rather than against the
  // keep-outs the prompt was given, so a piece missing from those is caught.
  const chrome: Rect[] = [
    state.framesBlock,
    geometry.miniMap,
    ...state.pieces.map((piece) => piece.rect),
  ];
  const pillHeight = promptPillHeight(geometry.theme);
  const found: string[] = state.pieces
    .filter((piece) => !hudKeepOuts.some((keepOut) => within(piece.rect, keepOut)))
    .map(
      (piece) => `${where}: ${piece.name} ${describe(piece.rect)} is not kept clear by a prompt`,
    );
  let checked = 0;
  for (let y = 0; y + PROMPT_TARGET_H <= height; y += PROMPT_TARGET_STEP) {
    for (let x = 0; x + PROMPT_TARGET_W <= width; x += PROMPT_TARGET_STEP) {
      const target: Rect = { x, y, w: PROMPT_TARGET_W, h: PROMPT_TARGET_H };
      if (chrome.some((rect) => overlaps(rect, target))) continue;
      checked++;
      const centreX = x + PROMPT_TARGET_W / 2;
      const placement = placePromptPill({
        viewport: { x: 0, y: 0, w: width, h: height },
        margin: geometry.theme.space.xs,
        block: {
          left: centreX - PROMPT_PILL_WIDTH / 2,
          width: PROMPT_PILL_WIDTH,
          height: pillHeight,
          above: 0,
        },
        targetTop: y,
        targetBottom: y + PROMPT_TARGET_H,
        keepClear: [],
        hudKeepOuts,
      });
      const bobbed: Rect = {
        x: placement.left,
        y: placement.top - PROMPT_BOB_AMPLITUDE,
        w: PROMPT_PILL_WIDTH,
        h: pillHeight + PROMPT_BOB_AMPLITUDE * 2,
      };
      const problem = offScreen(bobbed, width, height)
        ? 'is off screen'
        : overlaps(bobbed, target)
          ? 'covers its figure'
          : chrome.some((rect) => overlaps(rect, bobbed))
            ? 'is under HUD chrome'
            : null;
      if (problem !== null) {
        found.push(
          `${where}: the prompt ${describe(bobbed)} over a figure ${describe(target)} ${problem}`,
        );
      }
    }
  }
  return { failures: found, checked };
}

function describe(rect: Rect): string {
  return `(${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.w)}×${Math.round(rect.h)})`;
}

function within(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

function offScreen(rect: Rect, width: number, height: number): boolean {
  return rect.x < 0 || rect.y < 0 || rect.x + rect.w > width || rect.y + rect.h > height;
}

const failures: string[] = [];
let layouts = 0;
let buttonsChecked = 0;
let layoutsKeepingPlayerClear = 0;
let promptsChecked = 0;
let fightTilesChecked = 0;
let blindFramingFailures = 0;

function checkWardenFight(state: HudState, where: string): void {
  const framed = wardenFightFramingFailures(state, where);
  failures.push(...framed.failures);
  fightTilesChecked += framed.checked;
  blindFramingFailures += wardenFightFramingFailures(state, where, BLIND_FRAMING).failures.length;
}

for (const uiSize of UI_SIZES) {
  for (const [cssWidth, cssHeight] of VIEWPORTS) {
    for (const state of hudStates(cssWidth, cssHeight, 'touch', uiSize)) {
      layouts++;
      const { width, height } = state;
      const where = `${cssWidth}x${cssHeight} [${state.label}]`;
      for (const required of REQUIRED_PIECES) {
        if (!state.pieces.some((piece) => piece.name === required)) {
          failures.push(`${where}: no ${required} rect to check`);
        }
      }
      for (const piece of state.pieces.filter((p) => p.kind !== 'surface')) {
        buttonsChecked++;
        if (offScreen(piece.rect, width, height)) {
          failures.push(`${where}: ${piece.name} ${describe(piece.rect)} is off screen`);
        }
        if (piece.kind === 'button') {
          for (const bar of state.hpBars) {
            if (overlaps(piece.rect, bar)) {
              failures.push(
                `${where}: ${piece.name} ${describe(piece.rect)} covers an HP meter ${describe(bar)}`,
              );
            }
          }
        }
      }
      for (const [index, piece] of state.pieces.entries()) {
        for (const other of state.pieces.slice(index + 1)) {
          if (piece.kind === 'surface' && other.kind === 'surface') continue;
          if (overlaps(piece.rect, other.rect)) {
            failures.push(
              `${where}: ${piece.name} ${describe(piece.rect)} overlaps ${other.name} ${describe(other.rect)}`,
            );
          }
        }
      }
      const leading = representativeTopBand(state.geometry, LEADING_BARS);
      if (leading.length < LEADING_BARS.length) {
        failures.push(`${where}: only ${leading.length} of the leading bars found room`);
      }
      const roomAbovePlayer =
        cssHeight > cssWidth &&
        cssWidth >= ROOMY_PORTRAIT_MIN_W &&
        UI_SIZES_WITH_ROOM_ABOVE_PLAYER.has(uiSize);
      const leadingNames = new Set<string>(LEADING_BARS.map((priority) => `band-${priority}`));
      for (const bar of representativeTopBand(state.geometry)) {
        if (offScreen(bar.rect, width, height)) {
          failures.push(`${where}: the ${bar.name} bar ${describe(bar.rect)} is off screen`);
        }
        const mayCoverPlayer = !roomAbovePlayer && leadingNames.has(bar.name);
        for (const clearance of state.geometry.topBandKeepClear) {
          if (!mayCoverPlayer && overlaps(bar.rect, clearance)) {
            failures.push(
              `${where}: the ${bar.name} bar ${describe(bar.rect)} covers the player ${describe(clearance)}`,
            );
          }
        }
      }
      checkWardenFight(state, where);
      if (cssHeight > cssWidth) {
        const prompts = promptPlacementFailures(state, where);
        failures.push(...prompts.failures);
        promptsChecked += prompts.checked;
      }
      if (state.geometry.size === 'compact') {
        if (state.geometry.topBandKeepClear.length === 0) {
          failures.push(`${where}: a compact top band keeps nothing clear of the player`);
        } else {
          layoutsKeepingPlayerClear++;
        }
      }
    }
  }
}

for (const uiSize of UI_SIZES) {
  for (const [cssWidth, cssHeight] of DESKTOP_VIEWPORTS) {
    for (const state of hudStates(cssWidth, cssHeight, 'pointer', uiSize)) {
      checkWardenFight(state, `desktop ${cssWidth}x${cssHeight} [${state.label}]`);
    }
  }
}

if (fightTilesChecked === 0) {
  failures.push(
    "no tile let the camera show the cattery's north wall, so the fight was never framed",
  );
}
if (blindFramingFailures === 0) {
  failures.push(
    "a camera blind to the band and the fight's rows kept the north wall clear: the check cannot tell",
  );
}
if (promptsChecked === 0) {
  failures.push('no figure was clear of the HUD, so prompt placement was never checked');
}
if (layoutsKeepingPlayerClear === 0) {
  failures.push('no layout was compact, so the player clearance was never checked');
}
console.log(
  `phone hud: ${layouts} layouts over ${VIEWPORTS.length} viewports, ${buttonsChecked} tap targets checked, ${layoutsKeepingPlayerClear} keeping the player clear, ${promptsChecked} prompts placed, ${fightTilesChecked} fight tiles framed (blind camera: ${blindFramingFailures} failures)`,
);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL ${failure}`);
  console.error(`gates:phone-hud FAILED (${failures.length})`);
  process.exit(1);
}
console.log('gates:phone-hud passed');
