#!/usr/bin/env tsx
/**
 * Review PNGs for the Clogged Bathroom, one section at a time. Each section
 * renders its own pictures into `preview/clogged-bathroom/`; add a section to
 * `SECTIONS` for each new piece of the room worth looking at.
 *
 *  - `board`: the pipe board surface through a real `UiRoot`, per tier, in
 *    its opening scramble, half solved and leaking, every fixture full but
 *    still leaking, mid win moment and solved; on a desktop, a phone held
 *    upright and a phone on its side. A greyscale copy of each desktop frame
 *    sits beside it, because every state must read without colour.
 *  - `explainer`: the four explainer pages, desktop and phone.
 *  - `room`, `stalls`, `plumber`: the room broken and fixed, the fittings in
 *    every state, and the plumber; see `cloggedBathroomRoomRender.ts`.
 *
 * The test for every picture: could someone who has never seen the game tell
 * wet from dry, a leak, a dry fixture and the win?
 *
 *   npm run render:clogged-bathroom
 *   npm run render:clogged-bathroom -- --only=board
 *   npm run render:clogged-bathroom -- --only=board --tier=hard
 */

import { createCanvas, type Canvas } from 'canvas';

import { BATHROOM_ROOM_SECTIONS } from './cloggedBathroomRoomRender.js';
import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import type { Difficulty } from '../src/core/difficulty/difficultyProfiles.js';
import {
  DevPipeBoardSource,
  fullButLeaking,
  oneTurnFromSolved,
  solveAll,
  solveNearHalf,
} from '../src/dev/pipeBoardDevSource.js';
import {
  PIPE_BOARD_DIFFICULTIES,
  type PipeBoard,
  type PipeBoardLayout,
} from '../src/systems/cloggedBathroom/pipeBoard.js';
import { generatePipeBoardNow } from '../src/systems/cloggedBathroom/pipeBoardGenerator.js';
import { UiRoot, type Surface } from '../src/ui/core/UiRoot.js';
import { MOUSE_POINTER_ID, PRIMARY_BUTTON } from '../src/ui/core/pointer.js';
import { NO_INSETS } from '../src/ui/core/viewport.js';
import { pipeBoardExplainerSurface } from '../src/ui/screens/dialogs/pipeBoardExplainer.js';
import { pipeBoardSurfaces } from '../src/ui/screens/dialogs/pipeBoardSurface.js';
import type { Density } from '../src/ui/theme/tokens.js';

const OUT_DIR = `${PREVIEW_DIR}/clogged-bathroom`;
/** Any seed will do; this one is fixed so successive renders compare like for like. */
const REVIEW_WORLD_SEED = 20261010;
/** Coarser than a real frame: nothing reviewed here depends on per-frame stepping, and every frame is a full render. */
const FRAME_MS = 50;
/** Long enough for the panel to open and leaks and puddles to build up. */
const SETTLE_MS = 2200;
/** Into the win moment: the flushes running and the banner arriving. */
const WIN_MID_MS = 1900;
/** Past the win moment, with the way back offered. */
const WIN_DONE_MS = 3200;
/** Into an explainer page's animation, where each shows its point. */
const MAIN_PAGE_FLOODED_MS = 1400;
const TURN_PAGE_REFLOODED_MS = 2600;
const FIXTURES_PAGE_FILLED_MS = 2200;
const LEAKS_PAGE_SPRAYING_MS = 1800;
const EXPLAINER_PAGE_MS = [
  MAIN_PAGE_FLOODED_MS,
  TURN_PAGE_REFLOODED_MS,
  FIXTURES_PAGE_FILLED_MS,
  LEAKS_PAGE_SPRAYING_MS,
] as const;
const LUMA_RED = 0.299;
const LUMA_GREEN = 0.587;
const LUMA_BLUE = 0.114;
const RGBA = 4;

interface ReviewViewport {
  readonly name: string;
  readonly w: number;
  readonly h: number;
  readonly density: Density;
}

const DESKTOP: ReviewViewport = { name: 'desktop', w: 1440, h: 900, density: 'pointer' };
const PHONE: ReviewViewport = { name: 'phone', w: 390, h: 844, density: 'touch' };
const PHONE_LANDSCAPE: ReviewViewport = {
  name: 'phone-landscape',
  w: 844,
  h: 390,
  density: 'touch',
};
const SMALL_DESKTOP: ReviewViewport = {
  name: 'small-desktop',
  w: 1024,
  h: 640,
  density: 'pointer',
};

function flag(name: string): string | null {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? null : match.slice(prefix.length);
}

// ── A headless UiRoot ────────────────────────────────────────────────────────

interface Rig {
  readonly root: UiRoot;
  readonly canvas: Canvas;
  advance(ms: number): void;
  tap(regionId: string): void;
  key(key: string): void;
}

function makeRig(viewport: ReviewViewport, surfaces: readonly Surface[]): Rig {
  let clock = 0;
  const root = new UiRoot({
    audio: null,
    viewport: () => ({
      cssWidth: viewport.w,
      cssHeight: viewport.h,
      density: viewport.density,
      uiSize: 'medium',
      safeArea: NO_INSETS,
    }),
    now: () => clock,
    warn: () => undefined,
  });
  for (const surface of surfaces) root.mount(surface);
  const canvas = createCanvas(viewport.w, viewport.h);
  const ctx = asGameContext(canvas.getContext('2d'));
  const frame = (): void => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0d1016';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    root.frame(ctx);
  };
  frame();
  return {
    root,
    canvas,
    advance: (ms) => {
      for (let spent = 0; spent < ms; spent += FRAME_MS) {
        clock += FRAME_MS;
        frame();
      }
    },
    tap: (regionId) => {
      const region = root.regions().find((candidate) => candidate.id === regionId);
      if (region === undefined) throw new Error(`render:clogged-bathroom: no region "${regionId}"`);
      const x = region.rect.x + region.rect.w / 2;
      const y = region.rect.y + region.rect.h / 2;
      for (const kind of ['down', 'up'] as const) {
        root.pointer({
          kind,
          pointerId: MOUSE_POINTER_ID,
          source: 'mouse',
          x,
          y,
          cssX: x * root.uiScale,
          cssY: y * root.uiScale,
          button: PRIMARY_BUTTON,
          deltaY: 0,
        });
      }
    },
    key: (key) => void root.key(key, {}),
  };
}

function greyscale(source: Canvas): Canvas {
  const copy = createCanvas(source.width, source.height);
  const ctx = copy.getContext('2d');
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, copy.width, copy.height);
  const { data } = image;
  for (let i = 0; i < data.length; i += RGBA) {
    const luma = data[i] * LUMA_RED + data[i + 1] * LUMA_GREEN + data[i + 2] * LUMA_BLUE;
    data[i] = luma;
    data[i + 1] = luma;
    data[i + 2] = luma;
  }
  ctx.putImageData(image, 0, 0);
  return copy;
}

function write(name: string, canvas: Canvas): string {
  return writePreviewPng(`${OUT_DIR}/${name}.png`, canvas.toBuffer('image/png'));
}

// ── Sections ─────────────────────────────────────────────────────────────────

interface RenderSection {
  readonly name: string;
  /** Renders the section's PNGs and returns the paths written. */
  render(): readonly string[];
}

type BoardState = 'scramble' | 'midsolve' | 'full-leaking' | 'win-moment' | 'solved';

const BOARD_STATES: readonly BoardState[] = [
  'scramble',
  'midsolve',
  'full-leaking',
  'win-moment',
  'solved',
];

const layouts = new Map<Difficulty, PipeBoardLayout>();

/** A fresh source on the tier's board; the board is generated once per tier and dealt again for each picture. */
function boardFor(tier: Difficulty): DevPipeBoardSource {
  const known = layouts.get(tier);
  const layout = known ?? generatePipeBoardNow(REVIEW_WORLD_SEED, tier).layout;
  layouts.set(tier, layout);
  return new DevPipeBoardSource(layout);
}

function requireBoard(source: DevPipeBoardSource): PipeBoard {
  const board = source.pipeBoard;
  if (board === null) throw new Error('render:clogged-bathroom: the review source has no board');
  return board;
}

function renderBoardState(tier: Difficulty, state: BoardState, viewport: ReviewViewport): Canvas {
  const source = boardFor(tier);
  const board = requireBoard(source);
  let winningTile: number | null = null;
  switch (state) {
    case 'scramble':
      break;
    case 'midsolve':
      solveNearHalf(board);
      break;
    case 'full-leaking':
      if (!fullButLeaking(board)) throw new Error(`no full-but-leaking arrangement on ${tier}`);
      break;
    case 'win-moment':
    case 'solved':
      winningTile = oneTurnFromSolved(board);
      if (winningTile === null) solveAll(board);
      break;
  }
  const rig = makeRig(viewport, pipeBoardSurfaces(source));
  rig.advance(SETTLE_MS);
  if (winningTile !== null) {
    rig.tap(`pipe-board/tile-${winningTile}`);
    rig.advance(state === 'win-moment' ? WIN_MID_MS : WIN_DONE_MS);
  }
  return rig.canvas;
}

const boardSection: RenderSection = {
  name: 'board',
  render: () => {
    const onlyTier = flag('tier');
    const tiers = PIPE_BOARD_DIFFICULTIES.filter((tier) => onlyTier === null || tier === onlyTier);
    const written: string[] = [];
    for (const tier of tiers) {
      for (const state of BOARD_STATES) {
        const desktop = renderBoardState(tier, state, DESKTOP);
        written.push(write(`board-${tier}-${state}-${DESKTOP.name}`, desktop));
        written.push(write(`board-${tier}-${state}-${DESKTOP.name}-grey`, greyscale(desktop)));
        for (const viewport of [PHONE, PHONE_LANDSCAPE, SMALL_DESKTOP]) {
          const canvas = renderBoardState(tier, state, viewport);
          written.push(write(`board-${tier}-${state}-${viewport.name}`, canvas));
        }
      }
    }
    return written;
  },
};

function renderExplainerPage(page: number, viewport: ReviewViewport): Canvas {
  const model = { open: true, page };
  const surface = pipeBoardExplainerSurface({
    get isPipeBoardExplainerOpen() {
      return model.open;
    },
    finishPipeBoardExplainer: () => {
      model.open = false;
    },
    dismissPipeBoardExplainer: () => {
      model.open = false;
    },
  });
  const rig = makeRig(viewport, [surface]);
  rig.advance(FRAME_MS);
  for (let turn = 0; turn < page; turn++) {
    rig.key('ArrowRight');
    rig.advance(FRAME_MS);
  }
  rig.advance(EXPLAINER_PAGE_MS[page] ?? SETTLE_MS);
  return rig.canvas;
}

const EXPLAINER_PAGES = 4;

const explainerSection: RenderSection = {
  name: 'explainer',
  render: () => {
    const written: string[] = [];
    for (let page = 0; page < EXPLAINER_PAGES; page++) {
      for (const viewport of [SMALL_DESKTOP, PHONE]) {
        const canvas = renderExplainerPage(page, viewport);
        written.push(write(`explainer-page${page + 1}-${viewport.name}`, canvas));
      }
    }
    return written;
  },
};

const SECTIONS: readonly RenderSection[] = [
  boardSection,
  explainerSection,
  ...BATHROOM_ROOM_SECTIONS,
];

function main(): void {
  const only = flag('only');
  const sections = SECTIONS.filter((section) => only === null || section.name === only);
  if (sections.length === 0) {
    throw new Error(`render:clogged-bathroom: no section "${only ?? ''}"`);
  }
  for (const section of sections) {
    const written = section.render();
    console.log(`${section.name}: ${written.length} PNGs in ${OUT_DIR}/`);
  }
}

main();
