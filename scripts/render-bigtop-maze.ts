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
import { BigTopMazeSystem } from '../src/systems/BigTopMazeSystem';
import { setViewportSize } from '../src/core/Viewport';
import type { Mob, PlayerDamageType } from '../src/creatures/Mob';
import type { SystemContext } from '../src/systems/GameSystem';
import { MazeBlockTarget } from '../src/creatures/MazeBlockTarget';
import {
  MAZE_BLOCKS,
  MAZE_CURTAINS,
  MAZE_MIRRORS,
  MAZE_SECTIONS,
  MAZE_TARGET_OWNER,
  type BeamDirection,
  type MirrorFacing,
  type MirrorKind,
} from '../src/map/bigTopMazeLayout';
import {
  drawActArchBoard,
  drawActArchPost,
  drawBleacherDead,
  drawFlameVentColumn,
  drawFlameVentGrille,
  drawFlameVentTelegraph,
  drawFootlight,
  drawMazeActGate,
  drawMazeBarricade,
  drawMazeBeamTile,
  drawMazeBrace,
  drawMazeCageGate,
  drawMazeCapstan,
  drawMazeCurtain,
  drawMazeCurtainWindow,
  drawMazeExitDoor,
  drawMazeGate,
  drawMazeGrate,
  drawMazeLimelight,
  drawMazeMirror,
  drawMazeReleaseRing,
  drawMazeRope,
  drawMazeSandbag,
  drawMazeShowBell,
  drawMazeStar,
  drawMazeCurtainOpen,
  drawMazeWayOpen,
  drawMenagerieCage,
  drawMirrorHallGlass,
  drawRingMatRunner,
  drawSpotlightBeam,
  drawSpotlightClear,
  drawSpotlightDock,
  drawSpotlightWarm,
  drawTargetNameChip,
  type MazeDestructibleArt,
} from '../src/sprites/bigTopMazeProps';

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
  ['sandbag', drawMazeSandbag],
  ['brace', drawMazeBrace],
  ['ring', drawMazeReleaseRing],
  ['capstan', drawMazeCapstan],
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
      drawMazeShowBell(ctx, x, y, CELL, {
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
        phase: SAMPLE_PHASE,
        struck: false,
        turning: facing === 'SE',
        pulsing: facing === 'NE',
      });
    });
  }
}

push('grate', (ctx, x, y) => drawMazeGrate(ctx, x, y, CELL));
push('gate', (ctx, x, y) => drawMazeGate(ctx, x, y, CELL));
push('barricade', (ctx, x, y) => drawMazeBarricade(ctx, x, y, CELL));
push('cage gate', (ctx, x, y) => drawMazeCageGate(ctx, x, y, CELL, SAMPLE_PHASE));
push('curtain', (ctx, x, y) => drawMazeCurtain(ctx, x, y, CELL, SAMPLE_PHASE));
push('window', (ctx, x, y) => drawMazeCurtainWindow(ctx, x, y, CELL));
push('act gate', (ctx, x, y) => drawMazeActGate(ctx, x, y, CELL, SAMPLE_PHASE));
push('exit door', (ctx, x, y) => drawMazeExitDoor(ctx, x, y, CELL, SAMPLE_PHASE));

for (const litFraction of [0, 0.5, 1]) {
  push(`star ${litFraction}`, (ctx, x, y) => {
    drawMazeStar(ctx, x, y, CELL, { phase: SAMPLE_PHASE, litFraction, latched: litFraction === 1 });
  });
}

for (const direction of HEADINGS) {
  push(`limelight ${direction}`, (ctx, x, y) => {
    drawMazeLimelight(ctx, x, y, CELL, direction, SAMPLE_PHASE);
  });
}
for (const hot of [true, false]) {
  for (const heading of HEADINGS) {
    push(`beam ${hot ? 'hot' : 'cold'} ${heading}`, (ctx, x, y) => {
      drawMazeBeamTile(ctx, x, y, CELL, { hot, heading, phase: SAMPLE_PHASE });
    });
  }
}

push('vent grille', (ctx, x, y) => drawFlameVentGrille(ctx, x, y, CELL));
for (const progress of [0.2, 0.9]) {
  push(`vent warn ${progress}`, (ctx, x, y) => {
    drawFlameVentGrille(ctx, x, y, CELL);
    drawFlameVentTelegraph(ctx, x, y, CELL, progress);
  });
}
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
    drawMazeCurtainOpen(ctx, x, y, CELL, { phase: SAMPLE_PHASE, flare }),
  );
}

push('lantern cleared', (ctx, x, y) => drawSpotlightClear(ctx, x, y, CELL, SAMPLE_PHASE));
push('lantern dock', (ctx, x, y) => drawSpotlightDock(ctx, x, y, CELL, 0.7, SAMPLE_PHASE));

push('chip DONUT', (ctx, x, y) => drawTargetNameChip(ctx, x, y, CELL, 'cat'));
push('chip CARL', (ctx, x, y) => drawTargetNameChip(ctx, x, y, CELL, 'human'));

for (const pulled of [0, 0.5, 1]) {
  for (const owner of ['human', 'cat'] as const) {
    push(`rope ${owner} ${pulled}`, (ctx, x, y) => {
      drawMazeRope(
        ctx,
        [
          { x: x + CELL * 0.1, y: y + CELL * 0.8 },
          { x: x + CELL * 0.5, y: y + CELL * 0.3 },
          { x: x + CELL * 0.9, y: y + CELL * 0.7 },
        ],
        { pulled, owner },
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
  push(`bleacher ${seed}`, (ctx, x, y) => drawBleacherDead(ctx, x, y, CELL, seed));
  push(`cage ${seed}`, (ctx, x, y) => drawMenagerieCage(ctx, x, y, CELL, seed));
  push(`hall glass ${seed}`, (ctx, x, y) =>
    drawMirrorHallGlass(ctx, x, y, CELL, seed, SAMPLE_PHASE),
  );
}

// The flame column paints through an offscreen buffer, which wants a document.
installCanvasGlobals();

const rows = Math.ceil(cells.length / COLUMNS);
/** The act board spans several tiles, so it gets a strip of its own above the grid. */
const BOARD_STRIP_ROWS = 1;
const canvas = createCanvas(COLUMNS * CELL, (rows + BOARD_STRIP_ROWS) * CELL);
// node-canvas implements the same drawing surface the game's painters are
// written against, but not the DOM's `CanvasRenderingContext2D` nominal type,
// and there is no cast-free bridge between them short of giving the whole game
// a parallel context type. Every render harness in this repo that is actually
// typechecked crosses the gap the same way; the ones that appear not to are
// simply not on the opt-in list in `tsconfig.scripts.json`.
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
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
  (target, x, y) => drawActArchBoard(target, x, y, CELL, 'ACT II: THE MENAGERIE'),
  canvas.width / 2 - CELL / 2,
  0,
);

cells.forEach((cell, index) => {
  const x = (index % COLUMNS) * CELL;
  const y = (Math.floor(index / COLUMNS) + BOARD_STRIP_ROWS) * CELL;
  ctx.strokeStyle = GRID_LINE;
  ctx.strokeRect(x, y, CELL, CELL);
  paintCell(cell.label, cell.paint, x, y);
});

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
  mazeMap.generateInterior('house', 0, 'Big Top', false, 'bigtop_maze');
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
  const viewCtx = view.getContext('2d') as unknown as CanvasRenderingContext2D;

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
  mazeMap.generateInterior('house', 0, 'Big Top', false, 'bigtop_maze');
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
  const tileCtx = tile.getContext('2d') as unknown as CanvasRenderingContext2D;

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

console.log(`Painted ${painted} prop states to ${OUT_FILE}`);
console.log(`Mirrors in the layout: ${MAZE_MIRRORS.length}`);
console.log(
  `Drove the tent through ${MAZE_SECTIONS.length} acts and ${MAZE_CURTAINS.length} intervals ` +
    `(${tentProblems.length} render problem(s))`,
);
for (const failure of failures) console.log(` FAIL  ${failure}`);
if (failures.length > 0) console.log(`\n${failures.length} prop(s) threw while drawing.`);
else console.log('\nEvery Big Top prop and every act of the tent drew without throwing.');
process.exit(failures.length === 0 ? 0 : 1);
