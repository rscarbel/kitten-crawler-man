/**
 * Fairies fly over bodies and never over masonry. Driven through the real
 * `MobUpdateLoop` — AI, separation passes and the crawler-collision pass —
 * with probes whose only change is that their AI walks at a fixed goal, so
 * every push measured is the loop's own.
 *
 * - A corridor plugged by a rooted ground mob holds a walker up and costs a
 *   fairy not one frame.
 * - A fairy overlapping a ground mob pushes nothing and is pushed by nothing;
 *   one overlapping the crawler never moves the crawler.
 * - A fairy cannot cross a wall.
 */

import { TILE_SIZE } from '../../src/core/constants';
import { Goblin } from '../../src/creatures/Goblin';
import { IceFairy } from '../../src/creatures/fairies/IceFairy';
import type { Mob } from '../../src/creatures/Mob';
import type { Player } from '../../src/Player';
import { MobUpdateLoop } from '../../src/systems/MobUpdateLoop';
import type { FairyGateReport } from './report';
import { ARENA_TILES, PARK_TILE, buildStage, placeOnTile, type TileSpec } from './stage';

/** The wall column that splits the arena in two. */
const WALL_COLUMN = 15;
/** Row of the one-tile gap through it, where the rooted mob stands. */
const GAP_ROW = 15;
const START_TILE_X = 8;
const GOAL_TILE_X = 22;
/** A corner of the start side, within the loop's activation radius of the movers. */
const PARTY_TILE = 3;
/** Enough frames to walk the whole way at the slowest mover's speed several times over. */
const WALK_FRAMES = 900;
/** Frames the overlap cases run; any push shows within a handful. */
const OVERLAP_FRAMES = 30;
/** Movement under this many pixels is rounding, not a push. */
const PUSH_EPSILON_PX = 0.01;
const ROOTED_SPEED = 0;
/** The column just short of the wall: a mover blocked there really pressed up against it. */
const LAST_OPEN_COLUMN = WALL_COLUMN - 1;
/** The cat stands a tile south of the human, clear of its body. */
const CAT_BESIDE_TILES = 1;
const GOBLIN_WEAPON = 'sword';

/** A goblin that stands where it was put, speed zero: a body, not a mover. */
class RootedGoblin extends Goblin {
  constructor(tileX: number, tileY: number) {
    super(tileX, tileY, TILE_SIZE, GOBLIN_WEAPON);
    this.setBaseSpeed(ROOTED_SPEED);
  }
  override updateAI(_targets: Player[]): void {
    this.isMoving = false;
  }
}

/** A goblin whose AI walks at one fixed point, by the same path-follow every mob uses. */
class WalkingGoblin extends Goblin {
  constructor(
    tileX: number,
    tileY: number,
    private readonly goal: { readonly x: number; readonly y: number },
  ) {
    super(tileX, tileY, TILE_SIZE, GOBLIN_WEAPON);
  }
  override updateAI(_targets: Player[]): void {
    this.followTargetAStar(this.goal.x, this.goal.y, this.speed, 0);
  }
}

/**
 * An ice fairy whose AI flies at one fixed point by the same path-follow its
 * positioning uses. `flies` false is the defect under test in the negatives: a
 * fairy that has lost its flight and is a plain body, crawler shove and all.
 */
class FlyingProbe extends IceFairy {
  constructor(
    tileX: number,
    tileY: number,
    private readonly goal: { readonly x: number; readonly y: number } | null,
    private readonly flies = true,
  ) {
    super(tileX, tileY, TILE_SIZE);
    this.isFlying = flies;
  }
  override get displacesPlayers(): boolean {
    return this.flies ? super.displacesPlayers : true;
  }
  override updateAI(_targets: Player[]): void {
    if (this.goal === null) {
      this.isMoving = false;
      return;
    }
    this.followTargetAStar(this.goal.x, this.goal.y, this.speed, 0);
  }
}

function wallColumn(withGap: boolean): TileSpec[] {
  const walls: TileSpec[] = [];
  for (let y = 1; y < ARENA_TILES - 1; y++) {
    if (withGap && y === GAP_ROW) continue;
    walls.push([WALL_COLUMN, y]);
  }
  return walls;
}

const goalPoint = { x: GOAL_TILE_X * TILE_SIZE, y: GAP_ROW * TILE_SIZE };

type MoverFactory = (tileX: number, tileY: number) => Mob;

interface CrossingResult {
  /** The furthest tile column the mover reached. */
  readonly furthest: number;
  /** The frame its centre first passed the wall column, or null if it never did. */
  readonly crossedAtFrame: number | null;
}

/** Walks one mover from the start side at the goal beyond the wall column. */
function crossingRun(
  makeMover: MoverFactory,
  opts: { gap: boolean; plugged: boolean },
): CrossingResult {
  const stage = buildStage(wallColumn(opts.gap));
  placeOnTile(stage.pm.human, PARTY_TILE, PARTY_TILE);
  placeOnTile(stage.pm.cat, PARTY_TILE, PARTY_TILE + CAT_BESIDE_TILES);
  const loop = new MobUpdateLoop();
  if (opts.plugged) {
    const plug = new RootedGoblin(WALL_COLUMN, GAP_ROW);
    plug.setMap(stage.map);
    stage.roster.add(plug);
  }
  const mover = makeMover(START_TILE_X, GAP_ROW);
  mover.setMap(stage.map);
  stage.roster.add(mover);
  let furthest = START_TILE_X;
  let crossedAtFrame: number | null = null;
  for (let frame = 0; frame < WALK_FRAMES; frame++) {
    loop.update(stage.ctx());
    const column = Math.floor((mover.x + TILE_SIZE / 2) / TILE_SIZE);
    furthest = Math.max(furthest, column);
    if (crossedAtFrame === null && column > WALL_COLUMN) crossedAtFrame = frame;
  }
  return { furthest, crossedAtFrame };
}

interface OverlapResult {
  readonly probeMoved: number;
  readonly bodyMoved: number;
  readonly crawlerMoved: number;
}

/**
 * A still probe laid a few pixels off a free-standing goblin, or off the active
 * crawler, run through the loop. One at a time: a goblin and a crawler sharing
 * a spot would push each other and hide what the probe does.
 */
function overlapRun(flies: boolean, over: 'mob' | 'crawler'): OverlapResult {
  const stage = buildStage();
  const loop = new MobUpdateLoop();
  const OVERLAP_TILE = 10;
  const OFFSET_PX = 4;
  // A rooted body gives nothing back, so the body here must be free to be pushed.
  const pushableBody = new WalkingGoblin(OVERLAP_TILE, OVERLAP_TILE, {
    x: OVERLAP_TILE * TILE_SIZE,
    y: OVERLAP_TILE * TILE_SIZE,
  });
  pushableBody.setMap(stage.map);
  if (over === 'mob') stage.roster.add(pushableBody);
  const probe = new FlyingProbe(OVERLAP_TILE, OVERLAP_TILE, null, flies);
  probe.setMap(stage.map);
  probe.x += OFFSET_PX;
  stage.roster.add(probe);
  if (over === 'crawler') {
    stage.pm.human.x = probe.x - OFFSET_PX;
    stage.pm.human.y = probe.y + OFFSET_PX;
  } else {
    placeOnTile(stage.pm.human, OVERLAP_TILE + PARTY_TILE, OVERLAP_TILE + PARTY_TILE);
  }
  placeOnTile(stage.pm.cat, PARK_TILE, PARK_TILE);
  const start = {
    probe: { x: probe.x, y: probe.y },
    body: { x: pushableBody.x, y: pushableBody.y },
    crawler: { x: stage.pm.human.x, y: stage.pm.human.y },
  };
  for (let frame = 0; frame < OVERLAP_FRAMES; frame++) loop.update(stage.ctx());
  const moved = (now: { x: number; y: number }, then: { x: number; y: number }): number =>
    Math.hypot(now.x - then.x, now.y - then.y);
  return {
    probeMoved: moved(probe, start.probe),
    bodyMoved: moved(pushableBody, start.body),
    crawlerMoved: moved(stage.pm.human, start.crawler),
  };
}

/**
 * Frames the plug costs a mover: when it crossed with the rooted mob in the gap,
 * less when it crossed with the gap clear. Null when either run never crossed.
 */
function plugDelay(makeMover: MoverFactory): { delay: number | null; detail: string } {
  const open = crossingRun(makeMover, { gap: true, plugged: false });
  const plugged = crossingRun(makeMover, { gap: true, plugged: true });
  const detail = `open ${open.crossedAtFrame ?? 'never'}, plugged ${plugged.crossedAtFrame ?? 'never'}`;
  if (open.crossedAtFrame === null || plugged.crossedAtFrame === null)
    return { delay: null, detail };
  return { delay: plugged.crossedAtFrame - open.crossedAtFrame, detail };
}

export function verifyFlight(report: FairyGateReport): void {
  report.section('Flight');

  const flyer: MoverFactory = (x, y) => new FlyingProbe(x, y, goalPoint);
  const walker: MoverFactory = (x, y) => new WalkingGoblin(x, y, goalPoint);
  const grounded: MoverFactory = (x, y) => new FlyingProbe(x, y, goalPoint, false);

  // A rooted mob is a wall to the crawler, whom the collision pass shoves a
  // whole tile clear; another mob is only jostled past it by the soft ground
  // separation. So the ground-side measure is the time the plug costs.
  const walkerDelay = plugDelay(walker);
  report.check(
    walkerDelay.delay !== null && walkerDelay.delay > 0,
    'control: a rooted mob in a one-tile corridor holds a ground mob up',
    walkerDelay.detail,
  );
  const flyerDelay = plugDelay(flyer);
  report.check(
    flyerDelay.delay === 0,
    'a fairy flies over the rooted mob plugging the corridor without losing a frame',
    flyerDelay.detail,
  );
  const groundedDelay = plugDelay(grounded);
  report.checkCatches(
    groundedDelay.delay === 0,
    'a fairy that has lost its flight is caught held up by the plug',
    groundedDelay.detail,
  );
  const walled = crossingRun(flyer, { gap: false, plugged: false });
  report.check(
    walled.furthest >= LAST_OPEN_COLUMN && walled.crossedAtFrame === null,
    'a fairy flown up against a wall cannot cross it',
    `reached column ${walled.furthest} of ${GOAL_TILE_X}`,
  );

  const overMob = overlapRun(true, 'mob');
  report.check(
    overMob.bodyMoved < PUSH_EPSILON_PX && overMob.probeMoved < PUSH_EPSILON_PX,
    'a fairy over a ground mob is outside the ground separation pass: neither is pushed',
    `fairy ${overMob.probeMoved.toFixed(2)} px, goblin ${overMob.bodyMoved.toFixed(2)} px`,
  );
  const overCrawler = overlapRun(true, 'crawler');
  report.check(
    overCrawler.crawlerMoved < PUSH_EPSILON_PX,
    'a fairy over the active crawler never displaces the crawler',
    `${overCrawler.crawlerMoved.toFixed(2)} px`,
  );
  const groundedOverMob = overlapRun(false, 'mob');
  report.checkCatches(
    groundedOverMob.bodyMoved < PUSH_EPSILON_PX && groundedOverMob.probeMoved < PUSH_EPSILON_PX,
    'a grounded fairy is caught in the ground separation pass',
    `fairy ${groundedOverMob.probeMoved.toFixed(2)} px, goblin ${groundedOverMob.bodyMoved.toFixed(2)} px`,
  );
  const groundedOverCrawler = overlapRun(false, 'crawler');
  report.checkCatches(
    groundedOverCrawler.crawlerMoved < PUSH_EPSILON_PX,
    'a grounded fairy is caught shoving the crawler',
    `${groundedOverCrawler.crawlerMoved.toFixed(2)} px`,
  );
}
