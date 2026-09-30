#!/usr/bin/env tsx
/**
 * Contact sheet for the Big Top maze's props, plus a smoke run of every draw
 * function in the tent.
 *
 * The maze's art is procedural and drawn straight into the scene, so a throw
 * inside any one of these functions takes the whole finale down with nothing
 * but a blank canvas to debug from. This walks all of them, at every damage
 * stage and every facing, before the game ever does.
 *
 * Run: npx tsx scripts/render-bigtop-maze.ts
 */
import type { Difficulty } from '../src/core/difficultyProfiles';
import { createCanvas } from 'canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { TILE_SIZE } from '../src/core/constants';
import { EventBus } from '../src/core/EventBus';
import { GameMap } from '../src/map/GameMap';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import { SpellSystem } from '../src/systems/SpellSystem';
import { createCircusQuestProgress } from '../src/core/CircusQuestProgress';
import { Conversation } from '../src/dialog/Conversation';
import { BigTopMazeSystem } from '../src/systems/BigTopMazeSystem';
import { setViewportSize } from '../src/core/Viewport';
import type { Mob, PlayerDamageType } from '../src/creatures/Mob';
import type { SystemContext } from '../src/systems/GameSystem';
import { MazeBlockTarget } from '../src/creatures/MazeBlockTarget';
import {
  MAZE_BLOCKS,
  MAZE_CURTAINS,
  MAZE_SECTIONS,
  MAZE_TARGET_OWNER,
  planBigTopMaze,
  type BeamDirection,
  type MirrorFacing,
  type MirrorKind,
} from '../src/map/bigTopMazeLayout';
import {
  drawActArchPost,
  drawFlameVentColumn,
  drawFootlight,
  drawMazeActGate,
  drawMazeExitDoor,
  drawMazeWayOpen,
  drawRingMatRunner,
  drawSpotlightBeam,
  drawSpotlightClear,
  drawSpotlightDock,
  drawSpotlightWarm,
  drawTargetNameChip,
} from '../src/sprites/bigTopMazeProps';
import {
  drawBeamMirrorFlare,
  drawMazeBeamTile,
  drawMazeLimelight,
  drawMazeMirror,
  drawMirrorHallPane,
  drawSwivelMirrorWithGhost,
} from '../src/sprites/art/bigTop/mirrorHallProps';
import {
  drawFootlightLamp,
  drawLightBeamTile,
  drawMazeSplitter,
  drawMazeWallWindow,
  drawPuzzleStar,
  drawStarMarquee,
  starMarqueeWidthTiles,
  type LightBeamRun,
  type PuzzleStarKind,
  type PuzzleStarState,
  type StarMarqueeArt,
  type StarMarqueeBulb,
} from '../src/sprites/art/bigTop/mirrorPuzzleProps';
import { drawText } from '../src/ui/TextBox';
import {
  drawActEasel,
  drawMazeCurtain,
  drawMazeCurtainOpen,
  drawMazeCurtainWindow,
} from '../src/sprites/art/bigTop/curtainProps';
import { drawRingBleacher, RING_BLEACHER_TIERS } from '../src/sprites/art/bigTop/finaleProps';
import {
  FIRE_WALK_WALL_KITS,
  drawBoardedFlat,
  drawFireBreatherGrate,
  drawFireBreatherTelegraph,
  drawFireScreenGate,
  drawFireWalkWallKit,
  drawGrimaldiSandbag,
  drawHeatShimmerFlare,
  drawPulleyGrate,
  drawShadedRope,
  drawStageBrace,
  type MazeDestructibleArt,
} from '../src/sprites/art/bigTop/fireWalkProps';
import {
  drawBleacherSpectator,
  drawCageGateBarrier,
  drawCageReleaseRing,
  drawCapstanWinch,
  drawFeedTrough,
  drawFeedingBell,
  drawFollowSpotLamp,
  drawMenagerieCageFront,
} from '../src/sprites/art/bigTop/menagerieProps';
import { asGameContext } from './nodeGameContext.js';
import {
  drawTurnPreviewStarRing,
  drawTurnPreviewTile,
} from '../src/sprites/art/bigTop/turnPreviewProps';

/** A fixed floor-3 world seed, so the hall deals the same board every run. */
const TEST_WORLD_SEED = 0x5eed_b16;
/** The tier the maze is built under here; the default a new game starts on. */
const TEST_DIFFICULTY: Difficulty = 'normal';
/** The tent dealt for that world and tier, the way the scene deals it at the door. */
const TEST_PLAN = planBigTopMaze(TEST_WORLD_SEED, TEST_DIFFICULTY);

/**
 * The sheet is drawn at four times the tile size so the detail is legible.
 *
 * `--scale=1` paints it at the size the game actually uses, which is the only
 * size that answers whether a prop reads. Anything that only works at 4× does
 * not work.
 */
const SCALE_FLAG = '--scale=';
const DEFAULT_SCALE = 4;
const scaleArg = process.argv.find((arg) => arg.startsWith(SCALE_FLAG));
const SCALE = scaleArg === undefined ? DEFAULT_SCALE : Number(scaleArg.slice(SCALE_FLAG.length));
const CELL = TILE_SIZE * SCALE;
const COLUMNS = 12;
const OUT_DIR = 'preview';
const OUT_FILE = `${OUT_DIR}/bigtop-maze-props-${SCALE}x.png`;
const BACKGROUND = '#241a12';
const GRID_LINE = 'rgba(255,255,255,0.08)';

/** A frame counter deep enough into a cycle that nothing is caught at zero. */
const SAMPLE_PHASE = 97;
/** A second sample, chosen to land in a different part of every cycle above. */
const SAMPLE_PHASE_ALT = 233;

const DAMAGE_STAGES = [1, 0.67, 0.34, 0] as const;
const FACINGS: ReadonlyArray<MirrorFacing> = ['NE', 'SE', 'SW', 'NW'];
const KINDS: ReadonlyArray<MirrorKind> = ['pivot_mirror', 'swivel_mirror'];
const HEADINGS: ReadonlyArray<BeamDirection> = ['north', 'south', 'east', 'west'];

type Painter = (ctx: CanvasRenderingContext2D, x: number, y: number) => void;

const cells: Array<{ label: string; paint: Painter }> = [];
const push = (label: string, paint: Painter): void => {
  cells.push({ label, paint });
};

function destructibleArt(integrity: number, pulsing: boolean): MazeDestructibleArt {
  return {
    integrity,
    broken: integrity === 0,
    struck: integrity === DAMAGE_STAGES[1],
    facing: 'east',
    phase: SAMPLE_PHASE,
    pulsing,
  };
}

const DESTRUCTIBLES = [
  ['sandbag', drawGrimaldiSandbag],
  ['brace', drawStageBrace],
  ['ring', drawCageReleaseRing],
  ['capstan', drawCapstanWinch],
] as const;

for (const [name, paint] of DESTRUCTIBLES) {
  for (const integrity of DAMAGE_STAGES) {
    push(`${name} ${integrity}`, (ctx, x, y) => {
      paint(ctx, x, y, CELL, destructibleArt(integrity, integrity === 1));
    });
  }
}

for (const ready of [true, false]) {
  for (const holding of [true, false]) {
    push(`bell ${ready ? 'ready' : 'spent'}${holding ? ' held' : ''}`, (ctx, x, y) => {
      drawFeedingBell(ctx, x, y, CELL, {
        phase: SAMPLE_PHASE,
        struck: holding,
        holding,
        holdFraction: holding ? 0.6 : 0,
        ready,
        pulsing: ready,
      });
    });
  }
}

for (const kind of KINDS) {
  for (const facing of FACINGS) {
    push(`${kind === 'pivot_mirror' ? 'pivot' : 'swivel'} ${facing}`, (ctx, x, y) => {
      drawMazeMirror(ctx, x, y, CELL, {
        kind,
        facing,
        fromFacing: facing,
        turn: 1,
        phase: SAMPLE_PHASE,
        struck: false,
        pulsing: facing === 'NE',
      });
    });
  }
  /** Part-way through a swing from the first facing to the second, so the arc is on the sheet. */
  const SWING_SAMPLES = [0.25, 0.5, 0.75] as const;
  for (const turn of SWING_SAMPLES) {
    push(`${kind === 'pivot_mirror' ? 'pivot' : 'swivel'} swing ${turn}`, (ctx, x, y) => {
      drawMazeMirror(ctx, x, y, CELL, {
        kind,
        facing: 'SE',
        fromFacing: 'NE',
        turn,
        phase: SAMPLE_PHASE,
        struck: turn === SWING_SAMPLES[0],
        pulsing: false,
      });
    });
  }
}

push('pulley grate', (ctx, x, y) => drawPulleyGrate(ctx, x, y, CELL));
push('fire screen', (ctx, x, y) => drawFireScreenGate(ctx, x, y, CELL));
push('boarded flat', (ctx, x, y) => drawBoardedFlat(ctx, x, y, CELL));
push('cage gate', (ctx, x, y) => drawCageGateBarrier(ctx, x, y, CELL, SAMPLE_PHASE));
push('curtain', (ctx, x, y) => drawMazeCurtain(ctx, x, y, CELL, SAMPLE_PHASE));
push('window', (ctx, x, y) => drawMazeCurtainWindow(ctx, x, y, CELL, SAMPLE_PHASE));
push('act gate', (ctx, x, y) => drawMazeActGate(ctx, x, y, CELL, SAMPLE_PHASE));
push('exit door', (ctx, x, y) => drawMazeExitDoor(ctx, x, y, CELL, SAMPLE_PHASE));

for (const heading of HEADINGS) {
  push(`turn preview ${heading}`, (ctx, x, y) => {
    drawTurnPreviewTile(ctx, x, y, CELL, heading, SAMPLE_PHASE);
  });
}
push('turn preview star', (ctx, x, y) => {
  drawPuzzleStar(ctx, x, y, CELL, { kind: 'blue', state: 'dark', phase: SAMPLE_PHASE });
  drawTurnPreviewStarRing(ctx, x, y, CELL, SAMPLE_PHASE);
});

for (const direction of HEADINGS) {
  push(`limelight ${direction}`, (ctx, x, y) => {
    drawMazeLimelight(ctx, x, y, CELL, direction, SAMPLE_PHASE);
  });
}
for (const hot of [true, false]) {
  for (const heading of HEADINGS) {
    push(`beam ${hot ? 'hot' : 'cold'} ${heading}`, (ctx, x, y) => {
      drawMazeBeamTile(ctx, x, y, CELL, { hot, heading, phase: SAMPLE_PHASE, seed: 0 });
    });
  }
  for (const absorbed of [false, true]) {
    push(`flare ${hot ? 'hot' : 'cold'}${absorbed ? ' absorbed' : ''}`, (ctx, x, y) => {
      drawBeamMirrorFlare(ctx, x, y, CELL, { hot, absorbed, phase: SAMPLE_PHASE });
    });
  }
}

push('vent grate', (ctx, x, y) => drawFireBreatherGrate(ctx, x, y, CELL));
for (const progress of [0.2, 0.9]) {
  push(`vent warn ${progress}`, (ctx, x, y) => {
    drawFireBreatherGrate(ctx, x, y, CELL);
    drawFireBreatherTelegraph(ctx, x, y, CELL, progress);
  });
}
push('vent shimmer', (ctx, x, y) => {
  drawFireBreatherGrate(ctx, x, y, CELL);
  drawHeatShimmerFlare(ctx, x, y, CELL, 0.06, SAMPLE_PHASE);
});
for (const burn of [0.15, 0.5, 0.9]) {
  push(`flame ${burn}`, (ctx, x, y) => drawFlameVentColumn(ctx, x, y, CELL, burn, SAMPLE_PHASE));
}
for (const progress of [0.2, 0.9]) {
  push(`lantern warm ${progress}`, (ctx, x, y) => drawSpotlightWarm(ctx, x, y, CELL, progress));
  push(`lantern beam ${progress}`, (ctx, x, y) =>
    drawSpotlightBeam(ctx, x, y, CELL, progress, SAMPLE_PHASE),
  );
}
for (const flare of [1, 0]) {
  push(`way open ${flare}`, (ctx, x, y) =>
    drawMazeWayOpen(ctx, x, y, CELL, { phase: SAMPLE_PHASE, flare }),
  );
  push(`curtain open ${flare}`, (ctx, x, y) =>
    drawMazeCurtainOpen(ctx, x, y, CELL, { phase: SAMPLE_PHASE, flare, rise: 1 }),
  );
}
for (const rise of [0.2, 0.5, 0.8]) {
  push(`curtain rising ${rise}`, (ctx, x, y) =>
    drawMazeCurtainOpen(ctx, x, y, CELL, { phase: SAMPLE_PHASE, flare: 1 - rise, rise }),
  );
}

push('lantern cleared', (ctx, x, y) => drawSpotlightClear(ctx, x, y, CELL, SAMPLE_PHASE));
push('lantern dock', (ctx, x, y) => drawSpotlightDock(ctx, x, y, CELL, 0.7, SAMPLE_PHASE));

push('chip DONUT', (ctx, x, y) => drawTargetNameChip(ctx, x, y, CELL, 'cat'));
push('chip CARL', (ctx, x, y) => drawTargetNameChip(ctx, x, y, CELL, 'human'));

for (const pulled of [0, 0.5, 1]) {
  for (const owner of ['human', 'cat'] as const) {
    push(`rope ${owner} ${pulled}`, (ctx, x, y) => {
      drawShadedRope(
        ctx,
        [
          { x: x + CELL * 0.1, y: y + CELL * 0.8 },
          { x: x + CELL * 0.5, y: y + CELL * 0.3 },
          { x: x + CELL * 0.9, y: y + CELL * 0.7 },
        ],
        { pulled, owner },
        CELL,
      );
    });
  }
}

for (const owner of ['human', 'cat'] as const) {
  push(`runner ${owner}`, (ctx, x, y) => drawRingMatRunner(ctx, x, y, CELL, owner));
}
push('footlight', (ctx, x, y) => drawFootlight(ctx, x, y, CELL, SAMPLE_PHASE));
push('arch post', (ctx, x, y) => drawActArchPost(ctx, x, y, CELL, SAMPLE_PHASE));
for (const seed of [SAMPLE_PHASE, SAMPLE_PHASE_ALT]) {
  push(`bleacher ${seed}`, (ctx, x, y) =>
    drawBleacherSpectator(ctx, x, y, CELL, seed, false, SAMPLE_PHASE),
  );
  push(`cage ${seed}`, (ctx, x, y) =>
    drawMenagerieCageFront(ctx, x, y, CELL, seed, SAMPLE_PHASE, null),
  );
  push(`hall glass ${seed}`, (ctx, x, y) =>
    drawMirrorHallPane(ctx, x, y, CELL, seed, SAMPLE_PHASE),
  );
}
push('hall glass 7', (ctx, x, y) => drawMirrorHallPane(ctx, x, y, CELL, 7, SAMPLE_PHASE));
for (const side of ['west', 'east'] as const) {
  for (let tier = 0; tier < RING_BLEACHER_TIERS; tier++) {
    push(`ring stand ${side} ${tier}`, (ctx, x, y) =>
      drawRingBleacher(ctx, x, y, CELL, {
        side,
        tier,
        seed: tier,
        phase: SAMPLE_PHASE,
        slump: 0,
        bulbsLit: false,
      }),
    );
  }
}
for (const slump of [0.5, 1]) {
  push(`ring stand slump ${slump}`, (ctx, x, y) =>
    drawRingBleacher(ctx, x, y, CELL, {
      side: 'west',
      tier: 0,
      seed: 2,
      phase: SAMPLE_PHASE,
      slump,
      bulbsLit: slump === 1,
    }),
  );
}

/** Cage seeds that land on each occupant, so every one is on the sheet. */
const CAGE_SAMPLE_SEEDS = [0, 1, 2, 3, 5, 7, 11, 13];
for (const seed of CAGE_SAMPLE_SEEDS) {
  push(`cage seed ${seed}`, (ctx, x, y) =>
    drawMenagerieCageFront(ctx, x, y, CELL, seed, SAMPLE_PHASE, null),
  );
  push(`cage lunge ${seed}`, (ctx, x, y) =>
    drawMenagerieCageFront(ctx, x, y, CELL, seed, SAMPLE_PHASE, 0.35),
  );
}
const SPECTATOR_SAMPLE_SEEDS = [6, 8, 10, 12, 16, 18];
for (const seed of SPECTATOR_SAMPLE_SEEDS) {
  push(`spectator ${seed}`, (ctx, x, y) =>
    drawBleacherSpectator(ctx, x, y, CELL, seed, false, SAMPLE_PHASE),
  );
}
push('spectator clapping', (ctx, x, y) =>
  drawBleacherSpectator(ctx, x, y, CELL, 14, true, SAMPLE_PHASE),
);
const FOLLOW_SPOT_SAMPLE_AIMS = [0.1, 0.6, Math.PI - 0.4];
for (const aim of FOLLOW_SPOT_SAMPLE_AIMS) {
  for (const open of [true, false]) {
    push(`follow-spot ${aim.toFixed(1)} ${open ? 'open' : 'shut'}`, (ctx, x, y) =>
      drawFollowSpotLamp(ctx, x, y, CELL, aim, open),
    );
  }
}
push('feed trough', (ctx, x, y) => drawFeedTrough(ctx, x, y, CELL));
for (const kit of FIRE_WALK_WALL_KITS) {
  for (const seed of [0, 1]) {
    push(`${kit} ${seed}`, (ctx, x, y) => drawFireWalkWallKit(ctx, kit, x, y, CELL, seed));
  }
}

// The flame column paints through an offscreen buffer, which wants a document.
installCanvasGlobals();

const rows = Math.ceil(cells.length / COLUMNS);
/** The act board spans several tiles, so it gets a strip of its own above the grid. */
const BOARD_STRIP_ROWS = 2;
/** The easel's lamp rises half a tile over its board, so the board sits this far down its strip. */
const EASEL_STRIP_DROP = 0.55;
const canvas = createCanvas(COLUMNS * CELL, (rows + BOARD_STRIP_ROWS) * CELL);
// node-canvas implements the same drawing surface the game's painters are
// written against, but not the DOM's `CanvasRenderingContext2D` nominal type,
// and there is no cast-free bridge between them short of giving the whole game
// a parallel context type. Every render harness in this repo that is actually
// typechecked crosses the gap the same way; the ones that appear not to are
// simply not on the opt-in list in `tsconfig.scripts.json`.
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const ctx = asGameContext(canvas.getContext('2d'));
ctx.fillStyle = BACKGROUND;
ctx.fillRect(0, 0, canvas.width, canvas.height);

let painted = 0;
const failures: string[] = [];
const paintCell = (label: string, paint: Painter, x: number, y: number): void => {
  try {
    paint(ctx, x, y);
    painted++;
  } catch (error) {
    failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

paintCell(
  'act board',
  (target, x, y) => drawActEasel(target, x, y, CELL, 'ACT III: THE HALL OF MIRRORS'),
  canvas.width / 2 - CELL / 2,
  CELL * EASEL_STRIP_DROP,
);

cells.forEach((cell, index) => {
  const x = (index % COLUMNS) * CELL;
  const y = (Math.floor(index / COLUMNS) + BOARD_STRIP_ROWS) * CELL;
  ctx.strokeStyle = GRID_LINE;
  ctx.strokeRect(x, y, CELL, CELL);
  paintCell(cell.label, cell.paint, x, y);
});

// ── The hall's puzzle pieces ──────────────────────────────────────────────────

/**
 * The light puzzle's pieces on a sheet of their own, each on the ground it
 * stands on in the hall — floor pieces on sawdust, wall pieces on the dark
 * divider — with a small board at the end that puts them together. It is
 * written twice: in colour, and in greyscale, because every colour cue in the
 * hall has to have a shape or pattern twin and the grey sheet is where that is
 * checked by eye.
 */
const PUZZLE_OUT_FILE = `${OUT_DIR}/bigtop-mirror-puzzle-${SCALE}x.png`;
const PUZZLE_GREY_OUT_FILE = `${OUT_DIR}/bigtop-mirror-puzzle-${SCALE}x-grey.png`;
const PUZZLE_COLUMNS = 20;
/** Room above every cell for props that stand taller than their tile: a cheval mirror rises a tile and a half. */
const PUZZLE_HEADROOM_TILES = 1.5;
const PUZZLE_LABEL_HEIGHT = 14;
const PUZZLE_LABEL_SIZE = 10;
/** Labels sit this far in from their cell's left edge and below its bottom edge, in pixels. */
const PUZZLE_LABEL_INSET_PX = 2;
/** Below this the labels are wider than the cells they name and only smear across the art. */
const MIN_LABELLED_SCALE = 2;
const PUZZLE_ROW_GAP = 6;
const HALL_FLOOR = '#8c7650';
const HALL_FLOOR_ALT = '#7d6946';
const HALL_WALL = '#1c1519';
const LABEL_COLOR = '#e8dcc0';
/** Frames into a solve at which the marquee is sampled: first letter, mid-spell, spelt, chasing. */
const MARQUEE_SOLVE_SAMPLES = [0, 25, 45, 80] as const;
/** Long after the solve: the board has gone back to its bulbs, and the encore was lit since. */
const MARQUEE_SETTLED_FRAMES = 150;
/** Luminance weights for the greyscale check (Rec. 601). */
const LUMA_RED = 0.299;
const LUMA_GREEN = 0.587;
const LUMA_BLUE = 0.114;
const RGBA_STRIDE = 4;

type Ground = 'floor' | 'wall';

interface PuzzleCell {
  readonly label: string;
  readonly ground: Ground;
  /** How many cells wide it is; a marquee spans several. */
  readonly span: number;
  readonly paint: Painter;
}

const PUZZLE_STAR_KINDS: ReadonlyArray<PuzzleStarKind> = ['blue', 'red', 'twin', 'encore'];
const PUZZLE_ROWS: PuzzleCell[][] = [];

const floorCell = (label: string, paint: Painter): PuzzleCell => ({
  label,
  ground: 'floor',
  span: 1,
  paint,
});
const wallCell = (label: string, paint: Painter, span = 1): PuzzleCell => ({
  label,
  ground: 'wall',
  span,
  paint,
});

PUZZLE_ROWS.push([
  floorCell('splitter /', (c, x, y) => drawMazeSplitter(c, x, y, CELL, 'slash', SAMPLE_PHASE)),
  floorCell('splitter \\', (c, x, y) => drawMazeSplitter(c, x, y, CELL, 'backslash', SAMPLE_PHASE)),
  wallCell('window', (c, x, y) => drawMazeWallWindow(c, x, y, CELL, SAMPLE_PHASE)),
  wallCell('hall pane', (c, x, y) => drawMirrorHallPane(c, x, y, CELL, SAMPLE_PHASE, SAMPLE_PHASE)),
  ...(['blue', 'red'] as const).flatMap((colour) =>
    HEADINGS.map((direction) =>
      floorCell(`lamp ${colour} ${direction}`, (c, x, y) =>
        drawFootlightLamp(c, x, y, CELL, direction, colour, SAMPLE_PHASE),
      ),
    ),
  ),
]);

PUZZLE_ROWS.push(
  PUZZLE_STAR_KINDS.flatMap((kind) => {
    const states: ReadonlyArray<PuzzleStarState> =
      kind === 'twin'
        ? ['dark', 'half_blue', 'half_red', 'lit', 'wrong']
        : ['dark', 'lit', 'wrong'];
    return states.map((state) =>
      wallCell(`${kind} ${state}`, (c, x, y) =>
        drawPuzzleStar(c, x, y, CELL, {
          kind,
          state,
          phase: SAMPLE_PHASE,
          wrongLight: kind === 'blue' ? 'red' : 'blue',
        }),
      ),
    );
  }),
);

/** A wrong-colour sputter over consecutive frames, so the spark is seen to move. */
const SPUTTER_FRAMES = [0, 2, 4, 6, 8, 10] as const;
PUZZLE_ROWS.push([
  ...SPUTTER_FRAMES.map((offset) =>
    wallCell(`sputter +${offset}`, (c, x, y) =>
      drawPuzzleStar(c, x, y, CELL, {
        kind: 'blue',
        state: 'wrong',
        phase: SAMPLE_PHASE + offset,
        wrongLight: 'red',
      }),
    ),
  ),
]);
PUZZLE_ROWS.push([
  ...(
    [
      ['NE', 'SE'],
      ['NE', 'SW'],
      ['SE', 'SW'],
      ['SW', 'NW'],
      ['NW', 'NE'],
    ] as const
  ).map(([facing, other]) =>
    floorCell(`swivel ${facing}/${other}`, (c, x, y) =>
      drawSwivelMirrorWithGhost(
        c,
        x,
        y,
        CELL,
        {
          kind: 'swivel_mirror',
          facing,
          fromFacing: facing,
          turn: 1,
          phase: SAMPLE_PHASE,
          struck: false,
          pulsing: false,
        },
        other,
      ),
    ),
  ),
  ...KINDS.map((kind) =>
    floorCell(`${kind === 'pivot_mirror' ? 'pivot' : 'swivel'} back`, (c, x, y) =>
      drawMazeMirror(c, x, y, CELL, {
        kind,
        facing: 'NW',
        fromFacing: 'NW',
        turn: 1,
        phase: SAMPLE_PHASE,
        struck: false,
        pulsing: false,
      }),
    ),
  ),
]);

const beamCell = (label: string, runs: ReadonlyArray<LightBeamRun>): PuzzleCell =>
  floorCell(label, (c, x, y) => drawLightBeamTile(c, x, y, CELL, runs, SAMPLE_PHASE));
PUZZLE_ROWS.push([
  beamCell('blue east', [{ colour: 'blue', heading: 'east', span: 'through' }]),
  beamCell('blue east', [{ colour: 'blue', heading: 'east', span: 'through' }]),
  beamCell('red east', [{ colour: 'red', heading: 'east', span: 'through' }]),
  beamCell('red east', [{ colour: 'red', heading: 'east', span: 'through' }]),
  beamCell('blue north', [{ colour: 'blue', heading: 'north', span: 'through' }]),
  beamCell('red south', [{ colour: 'red', heading: 'south', span: 'through' }]),
  beamCell('both east', [
    { colour: 'blue', heading: 'east', span: 'through' },
    { colour: 'red', heading: 'west', span: 'through' },
  ]),
  beamCell('both east', [
    { colour: 'blue', heading: 'east', span: 'through' },
    { colour: 'red', heading: 'west', span: 'through' },
  ]),
  beamCell('crossing', [
    { colour: 'blue', heading: 'east', span: 'through' },
    { colour: 'red', heading: 'north', span: 'through' },
  ]),
  beamCell('crossing', [
    { colour: 'red', heading: 'east', span: 'through' },
    { colour: 'blue', heading: 'south', span: 'through' },
  ]),
  floorCell('split blue', (c, x, y) => {
    drawMazeSplitter(c, x, y, CELL, 'slash', SAMPLE_PHASE);
    drawLightBeamTile(
      c,
      x,
      y,
      CELL,
      [
        { colour: 'blue', heading: 'east', span: 'entering', stopAt: 'splitter_slash' },
        { colour: 'blue', heading: 'east', span: 'leaving', stopAt: 'splitter_slash' },
        { colour: 'blue', heading: 'north', span: 'leaving', stopAt: 'splitter_slash' },
      ],
      SAMPLE_PHASE,
    );
  }),
  floorCell('split red', (c, x, y) => {
    drawMazeSplitter(c, x, y, CELL, 'backslash', SAMPLE_PHASE);
    drawLightBeamTile(
      c,
      x,
      y,
      CELL,
      [
        { colour: 'red', heading: 'west', span: 'entering', stopAt: 'splitter_backslash' },
        { colour: 'red', heading: 'west', span: 'leaving', stopAt: 'splitter_backslash' },
        { colour: 'red', heading: 'north', span: 'leaving', stopAt: 'splitter_backslash' },
      ],
      SAMPLE_PHASE,
    );
  }),
]);

/** Each piece drawn in the game's order — prop, then the light over it — so a run is seen to stop at the piece's face. */
const stopCell = (
  label: string,
  prop: Painter,
  runs: ReadonlyArray<LightBeamRun>,
  ground: Ground = 'floor',
): PuzzleCell => ({
  label,
  ground,
  span: 1,
  paint: (c, x, y) => {
    prop(c, x, y);
    drawLightBeamTile(c, x, y, CELL, runs, SAMPLE_PHASE);
  },
});
const settledMirror =
  (kind: MirrorKind, facing: MirrorFacing): Painter =>
  (c, x, y) =>
    drawMazeMirror(c, x, y, CELL, {
      kind,
      facing,
      fromFacing: facing,
      turn: 1,
      phase: SAMPLE_PHASE,
      struck: false,
      pulsing: false,
    });
PUZZLE_ROWS.push([
  ...HEADINGS.map((direction) =>
    stopCell(
      `lamp ${direction} beam`,
      (c, x, y) => drawFootlightLamp(c, x, y, CELL, direction, 'blue', SAMPLE_PHASE),
      [{ colour: 'blue', heading: direction, span: 'leaving', stopAt: 'lamp' }],
    ),
  ),
  stopCell(
    'star from south',
    (c, x, y) => drawPuzzleStar(c, x, y, CELL, { kind: 'blue', state: 'lit', phase: SAMPLE_PHASE }),
    [{ colour: 'blue', heading: 'north', span: 'entering', stopAt: 'star' }],
    'wall',
  ),
  stopCell(
    'star from east',
    (c, x, y) => drawPuzzleStar(c, x, y, CELL, { kind: 'red', state: 'lit', phase: SAMPLE_PHASE }),
    [{ colour: 'red', heading: 'west', span: 'entering', stopAt: 'star' }],
    'wall',
  ),
  stopCell('mirror turn', settledMirror('pivot_mirror', 'SW'), [
    { colour: 'blue', heading: 'east', span: 'entering', stopAt: 'mirror' },
    { colour: 'blue', heading: 'south', span: 'leaving', stopAt: 'mirror' },
  ]),
  stopCell('mirror from N', settledMirror('pivot_mirror', 'NE'), [
    { colour: 'red', heading: 'south', span: 'entering', stopAt: 'mirror' },
    { colour: 'red', heading: 'east', span: 'leaving', stopAt: 'mirror' },
  ]),
  stopCell('back stops it', settledMirror('swivel_mirror', 'NW'), [
    { colour: 'red', heading: 'west', span: 'entering', stopAt: 'mirror' },
  ]),
]);

const marqueeCell = (label: string, art: StarMarqueeArt): PuzzleCell =>
  wallCell(
    label,
    (c, x, y) => drawStarMarquee(c, x, y, CELL, art),
    Math.ceil(starMarqueeWidthTiles(art.bulbs.length)),
  );
const bulbs = (
  kinds: ReadonlyArray<PuzzleStarKind>,
  lit: ReadonlyArray<boolean>,
): StarMarqueeBulb[] => kinds.map((kind, index) => ({ kind, lit: lit[index] ?? false }));
const twinWithHalf = (half: 'blue' | 'red'): StarMarqueeBulb => ({
  kind: 'twin',
  lit: false,
  half,
});
PUZZLE_ROWS.push([
  marqueeCell('strip off', {
    bulbs: bulbs(['blue', 'blue'], [false, false]),
    framesSinceSolved: null,
    phase: SAMPLE_PHASE,
  }),
  marqueeCell('strip 1 of 2', {
    bulbs: bulbs(['blue', 'blue'], [true, false]),
    framesSinceSolved: null,
    phase: SAMPLE_PHASE,
  }),
  marqueeCell('kitten', {
    bulbs: bulbs(['blue', 'red', 'encore'], [false, true, false]),
    framesSinceSolved: null,
    phase: SAMPLE_PHASE,
  }),
  marqueeCell('nightmare', {
    bulbs: bulbs(['twin', 'blue', 'red', 'encore'], [true, false, true, false]),
    framesSinceSolved: null,
    phase: SAMPLE_PHASE,
  }),
  marqueeCell('twin halves', {
    bulbs: [twinWithHalf('blue'), twinWithHalf('red'), ...bulbs(['twin'], [false])],
    framesSinceSolved: null,
    phase: SAMPLE_PHASE,
  }),
]);
PUZZLE_ROWS.push([
  marqueeCell('all lit', {
    bulbs: bulbs(['twin', 'blue', 'red', 'encore'], [true, true, true, true]),
    framesSinceSolved: null,
    phase: SAMPLE_PHASE,
  }),
  ...MARQUEE_SOLVE_SAMPLES.map((frames) =>
    marqueeCell(`bravo +${frames}`, {
      bulbs: bulbs(['twin', 'blue', 'red'], [true, true, true]),
      framesSinceSolved: frames,
      phase: SAMPLE_PHASE + frames,
    }),
  ),
  marqueeCell('solved, encore lit later', {
    bulbs: bulbs(['twin', 'blue', 'red', 'encore'], [true, true, true, true]),
    framesSinceSolved: MARQUEE_SETTLED_FRAMES,
    phase: SAMPLE_PHASE + MARQUEE_SETTLED_FRAMES,
  }),
]);

/**
 * A little board, lit: Carl's lamp throws blue into a splitter, which sends
 * one branch on to the twin star and one up to the blue star. Donut's lamp
 * throws red into a splitter of its own: one branch on to the twin's other
 * half, one up into a pivot that turns it back across the divider through a
 * window, where it sputters on a blue star. A swivel shows both its settings.
 */
const DEMO_WIDTH = 8;
const DEMO_HEIGHT = 5;

interface DemoTile {
  readonly column: number;
  readonly row: number;
}

/** Where each piece of the demo board stands, in tiles from its top-left. */
const DEMO_TILES = {
  outerWallWest: { column: 0, row: 0 },
  divider: { column: 4, row: 0 },
  blueLamp: { column: 1, row: 3 },
  splitter: { column: 2, row: 3 },
  redSplitter: { column: 5, row: 3 },
  twinStar: { column: 4, row: 3 },
  blueStar: { column: 2, row: 0 },
  redLamp: { column: 6, row: 3 },
  window: { column: 4, row: 1 },
  sputteringStar: { column: 0, row: 1 },
  redStar: { column: 6, row: 0 },
  swivel: { column: 6, row: 2 },
  pivot: { column: 5, row: 1 },
  /** The marquee hangs over the wall row, a tile above the board. */
  marquee: { column: 3, row: -1 },
} satisfies Record<string, DemoTile>;

/** Every tile the two lights cross on the demo board, and how. */
const DEMO_BEAMS: ReadonlyArray<DemoTile & { readonly runs: ReadonlyArray<LightBeamRun> }> = [
  {
    column: 1,
    row: 3,
    runs: [{ colour: 'blue', heading: 'east', span: 'leaving', stopAt: 'lamp' }],
  },
  {
    column: 2,
    row: 3,
    runs: [
      { colour: 'blue', heading: 'east', span: 'entering', stopAt: 'splitter_slash' },
      { colour: 'blue', heading: 'east', span: 'leaving', stopAt: 'splitter_slash' },
      { colour: 'blue', heading: 'north', span: 'leaving', stopAt: 'splitter_slash' },
    ],
  },
  { column: 3, row: 3, runs: [{ colour: 'blue', heading: 'east', span: 'through' }] },
  {
    column: 4,
    row: 3,
    runs: [
      { colour: 'blue', heading: 'east', span: 'entering', stopAt: 'star' },
      { colour: 'red', heading: 'west', span: 'entering', stopAt: 'star' },
    ],
  },
  { column: 2, row: 2, runs: [{ colour: 'blue', heading: 'north', span: 'through' }] },
  {
    column: 2,
    row: 1,
    runs: [
      { colour: 'blue', heading: 'north', span: 'through' },
      { colour: 'red', heading: 'west', span: 'through' },
    ],
  },
  {
    column: 2,
    row: 0,
    runs: [{ colour: 'blue', heading: 'north', span: 'entering', stopAt: 'star' }],
  },
  {
    column: 6,
    row: 3,
    runs: [{ colour: 'red', heading: 'west', span: 'leaving', stopAt: 'lamp' }],
  },
  {
    column: 5,
    row: 3,
    runs: [
      { colour: 'red', heading: 'west', span: 'entering', stopAt: 'splitter_backslash' },
      { colour: 'red', heading: 'west', span: 'leaving', stopAt: 'splitter_backslash' },
      { colour: 'red', heading: 'north', span: 'leaving', stopAt: 'splitter_backslash' },
    ],
  },
  { column: 5, row: 2, runs: [{ colour: 'red', heading: 'north', span: 'through' }] },
  {
    column: 5,
    row: 1,
    runs: [
      { colour: 'red', heading: 'north', span: 'entering', stopAt: 'mirror' },
      { colour: 'red', heading: 'west', span: 'leaving', stopAt: 'mirror' },
    ],
  },
  { column: 3, row: 1, runs: [{ colour: 'red', heading: 'west', span: 'through' }] },
  { column: 1, row: 1, runs: [{ colour: 'red', heading: 'west', span: 'through' }] },
  {
    column: 0,
    row: 1,
    runs: [{ colour: 'red', heading: 'west', span: 'entering', stopAt: 'star' }],
  },
  { column: 4, row: 1, runs: [{ colour: 'red', heading: 'west', span: 'through' }] },
];

function paintDemoBoard(c: CanvasRenderingContext2D, left: number, top: number): void {
  const at = (tile: DemoTile): { x: number; y: number } => ({
    x: left + tile.column * CELL,
    y: top + tile.row * CELL,
  });
  const wallColumns = new Set([
    DEMO_TILES.outerWallWest.column,
    DEMO_TILES.divider.column,
    DEMO_WIDTH - 1,
  ]);
  for (let row = 0; row < DEMO_HEIGHT; row++) {
    for (let column = 0; column < DEMO_WIDTH; column++) {
      const spot = at({ column, row });
      const wall = row === 0 || wallColumns.has(column);
      c.fillStyle = wall ? HALL_WALL : (row + column) % 2 === 0 ? HALL_FLOOR : HALL_FLOOR_ALT;
      c.fillRect(spot.x, spot.y, CELL, CELL);
    }
  }
  // The game's order: the pieces the light lies over, then the stars, the
  // marquee and the light itself; the mirrors are entities, drawn after all of it.
  const window = at(DEMO_TILES.window);
  drawMazeWallWindow(c, window.x, window.y, CELL, SAMPLE_PHASE);
  const blueLamp = at(DEMO_TILES.blueLamp);
  drawFootlightLamp(c, blueLamp.x, blueLamp.y, CELL, 'east', 'blue', SAMPLE_PHASE);
  const redLamp = at(DEMO_TILES.redLamp);
  drawFootlightLamp(c, redLamp.x, redLamp.y, CELL, 'west', 'red', SAMPLE_PHASE);
  const splitter = at(DEMO_TILES.splitter);
  drawMazeSplitter(c, splitter.x, splitter.y, CELL, 'slash', SAMPLE_PHASE);
  const redSplitter = at(DEMO_TILES.redSplitter);
  drawMazeSplitter(c, redSplitter.x, redSplitter.y, CELL, 'backslash', SAMPLE_PHASE);
  const twin = at(DEMO_TILES.twinStar);
  drawPuzzleStar(c, twin.x, twin.y, CELL, { kind: 'twin', state: 'lit', phase: SAMPLE_PHASE });
  const blueStar = at(DEMO_TILES.blueStar);
  drawPuzzleStar(c, blueStar.x, blueStar.y, CELL, {
    kind: 'blue',
    state: 'lit',
    phase: SAMPLE_PHASE,
  });
  const sputtering = at(DEMO_TILES.sputteringStar);
  drawPuzzleStar(c, sputtering.x, sputtering.y, CELL, {
    kind: 'blue',
    state: 'wrong',
    phase: SAMPLE_PHASE,
    wrongLight: 'red',
  });
  const redStar = at(DEMO_TILES.redStar);
  drawPuzzleStar(c, redStar.x, redStar.y, CELL, {
    kind: 'red',
    state: 'dark',
    phase: SAMPLE_PHASE,
  });
  const marquee = at(DEMO_TILES.marquee);
  drawStarMarquee(c, marquee.x, marquee.y, CELL, {
    bulbs: bulbs(['twin', 'blue', 'red'], [true, true, false]),
    framesSinceSolved: null,
    phase: SAMPLE_PHASE,
  });
  for (const beam of DEMO_BEAMS) {
    const spot = at(beam);
    drawLightBeamTile(c, spot.x, spot.y, CELL, beam.runs, SAMPLE_PHASE);
  }
  const pivot = at(DEMO_TILES.pivot);
  settledMirror('pivot_mirror', 'SW')(c, pivot.x, pivot.y);
  const swivel = at(DEMO_TILES.swivel);
  drawSwivelMirrorWithGhost(
    c,
    swivel.x,
    swivel.y,
    CELL,
    {
      kind: 'swivel_mirror',
      facing: 'SW',
      fromFacing: 'SW',
      turn: 1,
      phase: SAMPLE_PHASE,
      struck: false,
      pulsing: false,
    },
    'NW',
  );
}

function paintPuzzleSheet(): { colour: Buffer; grey: Buffer } {
  const rowHeight = CELL * (1 + PUZZLE_HEADROOM_TILES) + PUZZLE_LABEL_HEIGHT + PUZZLE_ROW_GAP;
  const demoTop = PUZZLE_ROWS.length * rowHeight + CELL;
  const sheet = createCanvas(PUZZLE_COLUMNS * CELL, demoTop + (DEMO_HEIGHT + 1) * CELL);
  const sheetCtx = asGameContext(sheet.getContext('2d'));
  sheetCtx.fillStyle = BACKGROUND;
  sheetCtx.fillRect(0, 0, sheet.width, sheet.height);
  PUZZLE_ROWS.forEach((row, rowIndex) => {
    let column = 0;
    const rowTop = rowIndex * rowHeight;
    const y = rowTop + CELL * PUZZLE_HEADROOM_TILES;
    for (const cell of row) {
      const x = column * CELL;
      sheetCtx.fillStyle = cell.ground === 'wall' ? HALL_WALL : HALL_FLOOR;
      sheetCtx.fillRect(x, y, cell.span * CELL, CELL);
      if (SCALE >= MIN_LABELLED_SCALE)
        drawText(sheetCtx, cell.label, {
          x: x + PUZZLE_LABEL_INSET_PX,
          y: y + CELL + PUZZLE_LABEL_INSET_PX,
          size: PUZZLE_LABEL_SIZE,
          color: LABEL_COLOR,
        });
      paintCell(`puzzle ${cell.label}`, (_target, px, py) => cell.paint(sheetCtx, px, py), x, y);
      column += cell.span;
    }
  });
  paintCell(
    'puzzle demo board',
    (_target, px, py) => paintDemoBoard(sheetCtx, px, py),
    CELL,
    demoTop,
  );
  const colour = sheet.toBuffer('image/png');
  const pixels = sheetCtx.getImageData(0, 0, sheet.width, sheet.height);
  for (let index = 0; index < pixels.data.length; index += RGBA_STRIDE) {
    const luma =
      (pixels.data[index] ?? 0) * LUMA_RED +
      (pixels.data[index + 1] ?? 0) * LUMA_GREEN +
      (pixels.data[index + 2] ?? 0) * LUMA_BLUE;
    pixels.data[index] = luma;
    pixels.data[index + 1] = luma;
    pixels.data[index + 2] = luma;
  }
  sheetCtx.putImageData(pixels, 0, 0);
  return { colour, grey: sheet.toBuffer('image/png') };
}
const puzzleSheet = paintPuzzleSheet();

// ── The tent itself ───────────────────────────────────────────────────────────

/**
 * Every render entry point the maze has, driven over a real instance.
 *
 * The contact sheet above proves each painter survives its own arguments; this
 * proves the system feeds them arguments they survive, in every act, which is
 * the failure that would actually reach a player as a blank tent.
 */
const VIEW_TILES_WIDE = 24;
const VIEW_TILES_HIGH = 16;

function smokeTestTheTent(): string[] {
  const problems: string[] = [];
  const mazeMap = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  mazeMap.generateInterior('house', 0, 'Big Top', false, { kind: 'bigtop_maze', plan: TEST_PLAN });
  const progress = createCircusQuestProgress();
  progress.stage = 'bigtop_ready';
  const roster = new MobRoster(mazeMap, new SpellSystem());
  const spawned: Mob[] = [];
  const maze = new BigTopMazeSystem(
    mazeMap,
    new EventBus(),
    (mob: Mob) => {
      spawned.push(mob);
      roster.add(mob);
    },
    progress,
    null,
    new Conversation(null),
    TEST_PLAN,
    () => undefined,
  );
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(0, 0, TILE_SIZE);
  const frameCtx: SystemContext = {
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster,
    gameMap: mazeMap,
  };

  setViewportSize(VIEW_TILES_WIDE * TILE_SIZE, VIEW_TILES_HIGH * TILE_SIZE);
  const view = createCanvas(VIEW_TILES_WIDE * TILE_SIZE, VIEW_TILES_HIGH * TILE_SIZE);
  // Same nominal-type gap as the sheet's own context above.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const viewCtx = asGameContext(view.getContext('2d'));

  const paintFrom = (label: string, tile: { x: number; y: number }): void => {
    human.x = tile.x * TILE_SIZE;
    human.y = tile.y * TILE_SIZE;
    cat.x = (tile.x + 1) * TILE_SIZE;
    cat.y = tile.y * TILE_SIZE;
    const camX = human.x - (VIEW_TILES_WIDE / 2) * TILE_SIZE;
    const camY = human.y - (VIEW_TILES_HIGH / 2) * TILE_SIZE;
    try {
      maze.update(frameCtx);
      maze.renderWorld(viewCtx, camX, camY);
      maze.renderEffects(viewCtx, camX, camY);
      maze.renderPrompts(viewCtx, camX, camY, frameCtx);
      maze.renderUI(viewCtx);
      for (const mob of spawned) mob.render(viewCtx, camX, camY, TILE_SIZE);
    } catch (error) {
      problems.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  for (const section of MAZE_SECTIONS) {
    // Enough frames for every clock in the act to have run a full cycle.
    for (let frame = 0; frame < CYCLE_SAMPLE_FRAMES; frame++) {
      paintFrom(section.id, section.humanSpawn);
    }
  }
  for (const curtain of MAZE_CURTAINS) {
    paintFrom(curtain.id, { x: curtain.humanRoom.x0, y: curtain.humanRoom.y0 });
  }
  return problems;
}

/** Longer than the slowest hazard cycle in the tent. */
const CYCLE_SAMPLE_FRAMES = 320;

/**
 * Every barrier, painted shut and then painted open, compared as pixels.
 *
 * The one thing a smoke run cannot catch and a playtester catches immediately:
 * a door that opened and went on looking shut. It shipped that way once — the
 * menagerie's gates stopped being drawn when they opened, which left a one-tile
 * hole in a wall of identical cage fronts, and one of the four had a decorative
 * cage hung directly over it. Players walked back and forth in front of their
 * own opened gate.
 *
 * Sampled long after the opening flare has burned out, because the flare is not
 * the cue being tested — the settled art is, and it is the one the player is
 * looking at by the time they have switched crawlers and walked back.
 */
const OPENED_SAMPLE_SETTLE_FRAMES = 400;
/** How far the tile's mean channel must move, out of 255, before and after. */
const OPENED_MIN_MEAN_SHIFT = 12;
/** How much further the opened tile must lean green than the shut one did. */
const OPENED_MIN_GREEN_LEAD = 6;

interface TileSample {
  readonly mean: number;
  /** How far green runs ahead of the warmer channels — the tent's "go" signal. */
  readonly greenLead: number;
}

function sampleTile(ctx: CanvasRenderingContext2D): TileSample {
  const pixels = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
  let total = 0;
  let lead = 0;
  const count = TILE_SIZE * TILE_SIZE;
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    total += (red + green + blue) / 3;
    lead += green - Math.max(red, blue);
  }
  return { mean: total / count, greenLead: lead / count };
}

function checkOpenedWaysLookOpen(): string[] {
  const problems: string[] = [];
  const mazeMap = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  mazeMap.generateInterior('house', 0, 'Big Top', false, { kind: 'bigtop_maze', plan: TEST_PLAN });
  const progress = createCircusQuestProgress();
  progress.stage = 'bigtop_ready';
  const roster = new MobRoster(mazeMap, new SpellSystem());
  const spawned: Mob[] = [];
  const maze = new BigTopMazeSystem(
    mazeMap,
    new EventBus(),
    (mob: Mob) => {
      spawned.push(mob);
      roster.add(mob);
    },
    progress,
    null,
    new Conversation(null),
    TEST_PLAN,
    () => undefined,
  );
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(0, 0, TILE_SIZE);
  const frameCtx: SystemContext = {
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster,
    gameMap: mazeMap,
  };

  setViewportSize(TILE_SIZE, TILE_SIZE);
  const tile = createCanvas(TILE_SIZE, TILE_SIZE);
  // Same nominal-type gap as the sheet's own context above.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const tileCtx = asGameContext(tile.getContext('2d'));

  /** The barrier tile alone, with the camera parked so it fills the canvas. */
  const paintBarrier = (at: { x: number; y: number }): TileSample => {
    tileCtx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
    maze.renderWorld(tileCtx, at.x * TILE_SIZE, at.y * TILE_SIZE);
    return sampleTile(tileCtx);
  };

  // An act card is an interlude box, and the tent stops performing behind one —
  // so a sampler that did not close them would sit still through every curtain
  // after the first and compare a tile with itself.
  const settle = (): void => {
    for (let frame = 0; frame < OPENED_SAMPLE_SETTLE_FRAMES; frame++) {
      maze.update(frameCtx);
      while (maze.isDialogOpen) maze.advanceDialog();
    }
  };

  for (const block of MAZE_BLOCKS) {
    const section = MAZE_SECTIONS.find((candidate) => candidate.id === block.section);
    if (section === undefined) continue;
    // Parked on the act's own marks, which are proven never to light, so no
    // burnout fires while the sampler is stepping frames.
    human.x = section.humanSpawn.x * TILE_SIZE;
    human.y = section.humanSpawn.y * TILE_SIZE;
    cat.x = section.catSpawn.x * TILE_SIZE;
    cat.y = section.catSpawn.y * TILE_SIZE;

    const shut = paintBarrier(block.barrierTile);
    const prop = spawned.find(
      (mob): mob is MazeBlockTarget =>
        mob instanceof MazeBlockTarget &&
        Math.round(mob.x / TILE_SIZE) === block.propTile.x &&
        Math.round(mob.y / TILE_SIZE) === block.propTile.y,
    );
    if (prop === undefined) {
      problems.push(`${block.id}: no prop stands on its own tile`);
      continue;
    }
    const damageType: PlayerDamageType =
      MAZE_TARGET_OWNER[block.kind] === 'human' ? 'melee' : 'missile';
    while (!prop.broken) {
      prop.takeDamageFrom(BARRIER_PROBE_DAMAGE, null, damageType);
      for (let frame = 0; frame < BLOW_LOCKOUT_SETTLE_FRAMES; frame++) prop.updateAI([]);
    }
    settle();
    const open = paintBarrier(block.barrierTile);

    if (Math.abs(open.mean - shut.mean) < OPENED_MIN_MEAN_SHIFT) {
      problems.push(
        `${block.id}: opening it barely changed the tile ` +
          `(mean ${shut.mean.toFixed(1)} to ${open.mean.toFixed(1)})`,
      );
    }
    if (open.greenLead - shut.greenLead < OPENED_MIN_GREEN_LEAD) {
      problems.push(
        `${block.id}: the opened tile does not wear the tent's "go" green ` +
          `(lead ${shut.greenLead.toFixed(1)} to ${open.greenLead.toFixed(1)})`,
      );
    }
  }

  // And the interval curtains, which lift on their own once both crawlers are in
  // their rooms rather than on a blow.
  for (const curtain of MAZE_CURTAINS) {
    const shut = paintBarrier(curtain.humanBarrier);
    human.x = curtain.humanRoom.x0 * TILE_SIZE;
    human.y = curtain.humanRoom.y0 * TILE_SIZE;
    cat.x = curtain.catRoom.x0 * TILE_SIZE;
    cat.y = curtain.catRoom.y0 * TILE_SIZE;
    settle();
    const open = paintBarrier(curtain.humanBarrier);
    if (Math.abs(open.mean - shut.mean) < OPENED_MIN_MEAN_SHIFT) {
      problems.push(
        `${curtain.id}: lifting it barely changed the tile ` +
          `(mean ${shut.mean.toFixed(1)} to ${open.mean.toFixed(1)})`,
      );
    }
    if (open.greenLead - shut.greenLead < OPENED_MIN_GREEN_LEAD) {
      problems.push(
        `${curtain.id}: the lifted curtain does not wear the tent's "go" green ` +
          `(lead ${shut.greenLead.toFixed(1)} to ${open.greenLead.toFixed(1)})`,
      );
    }
  }
  return problems;
}

/** Enough to flatten anything in the tent in one blow. */
const BARRIER_PROBE_DAMAGE = 1000;
/** Longer than any prop's lockout, so every scripted swing lands. */
const BLOW_LOCKOUT_SETTLE_FRAMES = 16;

const tentProblems = smokeTestTheTent();
for (const problem of tentProblems) failures.push(problem);
for (const problem of checkOpenedWaysLookOpen()) failures.push(problem);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, canvas.toBuffer('image/png'));
writeFileSync(PUZZLE_OUT_FILE, puzzleSheet.colour);
writeFileSync(PUZZLE_GREY_OUT_FILE, puzzleSheet.grey);

console.log(`Painted ${painted} prop states to ${OUT_FILE}`);
console.log(`Hall puzzle pieces: ${PUZZLE_OUT_FILE} and ${PUZZLE_GREY_OUT_FILE}`);
console.log(
  `Mirrors on the ${TEST_DIFFICULTY} board dealt to world ${TEST_WORLD_SEED}: ${TEST_PLAN.board.mirrors.length}`,
);
console.log(
  `Drove the tent through ${MAZE_SECTIONS.length} acts and ${MAZE_CURTAINS.length} intervals ` +
    `(${tentProblems.length} render problem(s))`,
);
for (const failure of failures) console.log(` FAIL  ${failure}`);
if (failures.length > 0) console.log(`\n${failures.length} prop(s) threw while drawing.`);
else console.log('\nEvery Big Top prop and every act of the tent drew without throwing.');
process.exit(failures.length === 0 ? 0 : 1);
