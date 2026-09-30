/**
 * The hall of mirrors as the tent runs it: the dealt board, the teaching strip
 * under it, and what their light is doing this frame.
 *
 * Every question about where light goes is answered by `traceBoard`, the one
 * walk the generator, the solver and the gate also use: the live beams, the
 * turn preview, the stars, the marquee bulbs and the hot span are all read off
 * its result, so none of them can disagree with another.
 *
 * The rule is the same on both boards: a star shows only what is on it right
 * now, and a board is done once every star it needs is lit at the same moment.
 * Done is latched for the board as a whole — never per star — so the exits and
 * the teaching doorways stay open whatever is turned afterwards.
 *
 * The light only changes when a mirror turns, so everything drawn from it is
 * worked out once in {@link MirrorHall.refresh} and the frame only reads it.
 *
 * Owned by `BigTopMazeSystem`, which stands the mirrors up, opens the barriers
 * and plays the cues; this module only watches the light and draws it.
 */

import { TILE_SIZE } from '../../core/constants';
import type { InteriorFigure } from '../../core/InteriorFigure';
import type { MazeMirrorTarget } from '../../creatures/MazeMirrorTarget';
import {
  boardHotSpan,
  boardTileToTent,
  facingIndex,
  headingIndex,
  mirrorExit,
  traceBoard,
  traceBoardAfterBlow,
  type BeamHeading,
  type BoardStar,
  type BoardStarState,
  type BoardTile,
  type BoardTrace,
  type MirrorBoard,
} from '../../map/bigTop/mirrorBoard';
import {
  MAZE_HALVES,
  MAZE_HEIGHT,
  TEACHING_STRIP_BOARD,
  teachingTileToTent,
  type BigTopMazePlan,
  type MazeHalf,
  type MazeTile,
} from '../../map/bigTopMazeLayout';
import {
  drawBeamMirrorFlare,
  drawMazeBeamTile,
  drawMazeLimelight,
} from '../../sprites/art/bigTop/mirrorHallProps';
import {
  drawFootlightLamp,
  drawLightBeamTile,
  drawMazeSplitter,
  drawMazeWallWindow,
  drawPuzzleStar,
  drawStarMarquee,
  type BeamStop,
  type LightBeamRun,
  type PuzzleStarArt,
  type StarMarqueeArt,
  type StarMarqueeBulb,
} from '../../sprites/art/bigTop/mirrorPuzzleProps';
import {
  drawTurnPreviewStarRing,
  drawTurnPreviewTile,
} from '../../sprites/art/bigTop/turnPreviewProps';
import {
  hallMarqueePlacement,
  marqueeStarOrder,
  teachingMarqueePlacement,
  teachingStarsOf,
  type MarqueePlacement,
} from './hallMarquees';
import { isOnScreen } from './tentView';

/** Which of the two boards a mirror, a star or a trace belongs to. */
export type HallBoardId = 'hall' | 'teaching';

const BOARD_IDS: ReadonlyArray<HallBoardId> = ['hall', 'teaching'];

/** The ghost of one mirror's next turn: the whole light of its board, one blow on. */
export interface MazeTurnPreview {
  readonly mirrorId: string;
  readonly half: MazeHalf;
  readonly boardId: HallBoardId;
  /** Where every light of that board goes after the blow. */
  readonly trace: BoardTrace;
}

/** What one settle of the light changed, for the maze to answer with doors and cues. */
export interface HallChanges {
  /** Stars that came alight. */
  readonly starsLit: number;
  /** Stars that lost their light and went dark. */
  readonly starsDimmed: number;
  /** Stars that took on only a light they refuse. */
  readonly starsFizzled: number;
  /** Every star the hall needs is lit at once, for the first time. */
  readonly solved: boolean;
  /** The encore is lit for the first time in this tent. */
  readonly encoreLit: boolean;
  /** Lanes whose teaching stars are both lit at once, for the first time. */
  readonly teachingOpened: ReadonlyArray<MazeHalf>;
}

/**
 * A board's light and what its stars were showing before it, as
 * {@link MirrorHall.settleStars} is handed them.
 */
export interface SettlingBoard {
  readonly trace: BoardTrace;
  readonly stars: ReadonlyArray<BoardStarState>;
}

/** How far above its own tile a lamp, a splitter or a marquee reaches, for the cull. */
const PROP_LIFT_TILES = 1;

/** One step along each heading, in tiles. */
const HEADING_STEP: Readonly<Record<BeamHeading, BoardTile>> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function keyOf(tile: MazeTile): string {
  return `${tile.x},${tile.y}`;
}

function offset(tile: BoardTile, heading: BeamHeading, direction: number): BoardTile {
  const step = HEADING_STEP[heading];
  return { x: tile.x + step.x * direction, y: tile.y + step.y * direction };
}

/** A per-tile seed for the hot span's dust, unique over the whole tent. */
function tileSeed(tile: MazeTile): number {
  return tile.x * MAZE_HEIGHT + tile.y;
}

/** How a star's light-state reads on its plate. */
function starLookOf(state: BoardStarState): Pick<PuzzleStarArt, 'state' | 'wrongLight'> {
  switch (state.status) {
    case 'lit':
      return { state: 'lit' };
    case 'dark':
      return { state: 'dark' };
    case 'half':
      return { state: state.blue ? 'half_blue' : 'half_red' };
    case 'fizzle':
      return { state: 'wrong', wrongLight: state.blue ? 'blue' : 'red' };
  }
}

/** A marquee bulb for a star, lit exactly while the star is and half lit for a twin with one light. */
function bulbFor(state: BoardStarState | undefined, star: BoardStar): StarMarqueeBulb {
  if (state?.status === 'half') {
    return { kind: star.kind, lit: false, half: state.blue ? 'blue' : 'red' };
  }
  return { kind: star.kind, lit: state?.status === 'lit' };
}

/** One star's plate, with the art it is drawn with rewritten in place each settle and each frame. */
interface StarPlate {
  readonly star: BoardStar;
  readonly tile: MazeTile;
  readonly art: Mutable<PuzzleStarArt>;
}

/** A marquee's place and the art it is drawn with, refreshed in place. */
interface MarqueeSign {
  readonly placement: MarqueePlacement;
  readonly stars: ReadonlyArray<BoardStar>;
  readonly art: Mutable<StarMarqueeArt>;
  /** The frame its board was done, or null while it is not. */
  doneAt: number | null;
}

/** Where light meets a mirror. */
interface MirrorContact {
  readonly tile: MazeTile;
  readonly hot: boolean;
  readonly absorbed: boolean;
}

/** What the turn preview adds to the light as it stands, worked out once per mirror and settle. */
interface PreviewGhost {
  readonly preview: MazeTurnPreview;
  readonly steps: ReadonlyArray<{ readonly tile: MazeTile; readonly heading: BeamHeading }>;
  readonly rings: ReadonlyArray<MazeTile>;
}

/** One board's pieces and its latest light, with the mapping onto the tent. */
class BoardStage implements SettlingBoard {
  trace: BoardTrace;
  stars: ReadonlyArray<BoardStarState>;
  private stateById = new Map<string, BoardStarState>();
  /** Cold light per tent tile, every run on it. */
  runs: ReadonlyArray<{ readonly tile: MazeTile; readonly runs: LightBeamRun[] }> = [];
  contacts: ReadonlyArray<MirrorContact> = [];
  /** Every tile the light crosses, for the stage lights. */
  lightSteps: ReadonlyArray<{ readonly tile: MazeTile; readonly hot: boolean }> = [];
  litStarLights: ReadonlyArray<{ readonly tile: MazeTile; readonly lit: number }> = [];
  /** Every step as `x,y,heading,colour`, for telling the preview's new light from the old. */
  stepKeys: ReadonlySet<string> = new Set();
  readonly plates: ReadonlyArray<StarPlate>;
  /** The same plates as they look with no light on the stage. */
  readonly darkPlates: ReadonlyArray<StarPlate>;
  private readonly pieceStops: ReadonlyMap<string, BeamStop>;
  private readonly lampTiles: ReadonlySet<string>;
  private readonly mirrorIndexByTile: ReadonlyMap<string, number>;

  constructor(
    readonly id: HallBoardId,
    readonly board: MirrorBoard,
    readonly mirrors: ReadonlyArray<MazeMirrorTarget>,
    readonly toTent: (tile: BoardTile) => MazeTile,
    /** Whether the span from each lamp to its first optic is fire, drawn apart from the cold light. */
    readonly burns: boolean,
  ) {
    const stops = new Map<string, BeamStop>();
    for (const mirror of board.mirrors) stops.set(keyOf(mirror.tile), 'mirror');
    for (const splitter of board.splitters) {
      stops.set(
        keyOf(splitter.tile),
        splitter.diagonal === 'slash' ? 'splitter_slash' : 'splitter_backslash',
      );
    }
    for (const star of board.stars) stops.set(keyOf(star.tile), 'star');
    this.pieceStops = stops;
    this.lampTiles = new Set(board.limelights.map((light) => keyOf(light.tile)));
    this.mirrorIndexByTile = new Map(
      board.mirrors.map((mirror, index) => [keyOf(mirror.tile), index]),
    );
    const plateOf = (star: BoardStar): StarPlate => ({
      star,
      tile: toTent(star.tile),
      art: { kind: star.kind, state: 'dark', phase: 0 },
    });
    this.plates = board.stars.map(plateOf);
    this.darkPlates = board.stars.map(plateOf);
    this.trace = traceBoard(board, this.indices());
    this.stars = this.trace.stars;
    this.rebuild();
  }

  indices(): number[] {
    return this.mirrors.map((mirror) => mirror.cycleIndex);
  }

  stateOf(starId: string): BoardStarState | undefined {
    return this.stateById.get(starId);
  }

  /** Everything drawn from the light, worked out again after it has changed. */
  rebuild(): void {
    this.stateById = new Map(this.stars.map((state) => [state.starId, state]));
    for (const plate of this.plates) {
      const state = this.stateById.get(plate.star.id);
      const look = state === undefined ? { state: 'dark' as const } : starLookOf(state);
      plate.art.state = look.state;
      plate.art.wrongLight = look.wrongLight;
    }
    this.litStarLights = this.plates
      .filter((plate) => this.stateById.get(plate.star.id)?.status === 'lit')
      .map((plate) => ({ tile: plate.tile, lit: 1 }));
    this.lightSteps = this.trace.steps.map((step) => ({
      tile: this.toTent(step.tile),
      hot: this.burns && step.hot,
    }));
    this.stepKeys = new Set(
      this.trace.steps.map(
        (step) => `${step.tile.x},${step.tile.y},${step.heading},${step.colour}`,
      ),
    );
    this.rebuildRuns();
    this.rebuildContacts();
  }

  /**
   * The runs of cold light on every tent tile the trace lights, including the
   * half-runs into and out of each piece it meets, so the light visibly reaches
   * a star's plate, bends at the glass and leaves a lamp's lens.
   */
  private rebuildRuns(): void {
    const runs = new Map<string, { tile: MazeTile; runs: LightBeamRun[] }>();
    const seen = new Set<string>();
    const add = (boardTile: BoardTile, run: LightBeamRun): void => {
      const tile = this.toTent(boardTile);
      const signature = `${keyOf(tile)},${run.colour},${run.heading},${run.span}`;
      if (seen.has(signature)) return;
      seen.add(signature);
      const entry = runs.get(keyOf(tile)) ?? { tile, runs: [] };
      entry.runs.push(run);
      runs.set(keyOf(tile), entry);
    };
    for (const step of this.trace.steps) {
      if (this.burns && step.hot) continue;
      const { colour, heading } = step;
      add(step.tile, { colour, heading, span: 'through' });
      const ahead = offset(step.tile, heading, 1);
      const aheadStop = this.pieceStops.get(keyOf(ahead));
      if (aheadStop !== undefined) {
        add(ahead, { colour, heading, span: 'entering', stopAt: aheadStop });
      }
      const behind = offset(step.tile, heading, -1);
      const behindKey = keyOf(behind);
      const behindStop = this.pieceStops.get(behindKey);
      if (behindStop !== undefined) {
        add(behind, { colour, heading, span: 'leaving', stopAt: behindStop });
      } else if (this.lampTiles.has(behindKey)) {
        add(behind, { colour, heading, span: 'leaving', stopAt: 'lamp' });
      }
    }
    this.runs = [...runs.values()];
  }

  /**
   * Where light meets a mirror: a flare off the silvered face, or a smoulder
   * where it dies on the timber back.
   */
  private rebuildContacts(): void {
    const contacts: MirrorContact[] = [];
    for (const step of this.trace.steps) {
      const ahead = offset(step.tile, step.heading, 1);
      const index = this.mirrorIndexByTile.get(keyOf(ahead));
      if (index === undefined || index >= this.mirrors.length) continue;
      const target = this.mirrors[index];
      const exit = mirrorExit(facingIndex(target.facing), headingIndex(step.heading));
      contacts.push({ tile: this.toTent(ahead), hot: this.burns && step.hot, absorbed: exit < 0 });
    }
    this.contacts = contacts;
  }
}

/** A splitter's pane as the scene's Y-sorted pass takes it, so a crawler north of it is drawn behind it. */
class SplitterFigure implements InteriorFigure {
  readonly y: number;
  /** The frame the pane's glint is at; set by the hall before each draw. */
  phase = 0;

  constructor(
    private readonly tile: MazeTile,
    private readonly diagonal: MirrorBoard['splitters'][number]['diagonal'],
  ) {
    this.y = tile.y * TILE_SIZE;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    const x = this.tile.x * tileSize - camX;
    const y = this.tile.y * tileSize - camY;
    if (isOnScreen(x, y, PROP_LIFT_TILES)) {
      drawMazeSplitter(ctx, x, y, tileSize, this.diagonal, this.phase);
    }
  }
}

export class MirrorHall {
  private readonly stages: Readonly<Record<HallBoardId, BoardStage>>;
  /** The frame every star the hall needs first shone at once, or null while it has not. */
  private solvedAt: number | null = null;
  /** The frame the encore first shone in this tent. */
  private encoreAt: number | null = null;
  private readonly teachingOpenedAt = new Map<MazeHalf, number>();
  /** The span from each limelight's lens to its first optic: fire, and fixed however the glass turns. */
  readonly hotSpan: ReadonlyArray<{
    readonly tentTile: MazeTile;
    readonly heading: BeamHeading;
    readonly seed: number;
  }>;
  readonly hallMarquee: MarqueePlacement;
  readonly teachingMarquees: Readonly<Record<MazeHalf, MarqueePlacement>>;
  private readonly signs: ReadonlyArray<MarqueeSign>;
  private readonly hallSign: MarqueeSign;
  private readonly teachingSigns: Readonly<Record<MazeHalf, MarqueeSign>>;
  private readonly teachingStars: Readonly<Record<MazeHalf, ReadonlyArray<BoardStar>>>;
  private readonly splitterFigures: ReadonlyArray<SplitterFigure>;
  private requiredLitCount = 0;
  private allLightSteps: ReadonlyArray<{ readonly tile: MazeTile; readonly hot: boolean }> = [];
  private allLitStars: ReadonlyArray<{ readonly tile: MazeTile; readonly lit: number }> = [];
  private readonly requiredTotal: number;
  private ghost: {
    readonly mirror: MazeMirrorTarget;
    readonly half: MazeHalf;
    readonly version: number;
    readonly ghost: PreviewGhost;
  } | null = null;
  /** Bumped whenever the light is re-walked, so a cached preview knows it is stale. */
  private lightVersion = 0;

  constructor(
    readonly plan: BigTopMazePlan,
    hallMirrors: ReadonlyArray<MazeMirrorTarget>,
    teachingMirrors: ReadonlyArray<MazeMirrorTarget>,
  ) {
    this.stages = {
      hall: new BoardStage('hall', plan.board, hallMirrors, boardTileToTent, true),
      teaching: new BoardStage(
        'teaching',
        TEACHING_STRIP_BOARD,
        teachingMirrors,
        teachingTileToTent,
        false,
      ),
    };
    this.hotSpan = boardHotSpan(plan.board).map((step) => {
      const tentTile = boardTileToTent(step.tile);
      return { tentTile, heading: step.heading, seed: tileSeed(tentTile) };
    });
    this.hallMarquee = hallMarqueePlacement(plan.board);
    this.teachingMarquees = {
      human: teachingMarqueePlacement(plan.board, 'human'),
      cat: teachingMarqueePlacement(plan.board, 'cat'),
    };
    this.teachingStars = { human: teachingStarsOf('human'), cat: teachingStarsOf('cat') };
    const signOf = (placement: MarqueePlacement, stars: ReadonlyArray<BoardStar>): MarqueeSign => ({
      placement,
      stars,
      art: { bulbs: [], framesSinceSolved: null, phase: 0 },
      doneAt: null,
    });
    this.hallSign = signOf(this.hallMarquee, marqueeStarOrder(plan.board.stars));
    this.teachingSigns = {
      human: signOf(this.teachingMarquees.human, this.teachingStars.human),
      cat: signOf(this.teachingMarquees.cat, this.teachingStars.cat),
    };
    this.signs = [this.hallSign, this.teachingSigns.human, this.teachingSigns.cat];
    this.splitterFigures = BOARD_IDS.flatMap((boardId) => {
      const stage = this.stages[boardId];
      return stage.board.splitters.map(
        (splitter) => new SplitterFigure(stage.toTent(splitter.tile), splitter.diagonal),
      );
    });
    this.requiredTotal = plan.board.stars.filter((star) => star.kind !== 'encore').length;
    this.refreshReadouts();
  }

  get board(): MirrorBoard {
    return this.plan.board;
  }

  /** The light of one board as it stands. */
  traceOf(boardId: HallBoardId): BoardTrace {
    return this.stages[boardId].trace;
  }

  /** What each star of one board is showing. */
  starsOf(boardId: HallBoardId): ReadonlyArray<BoardStarState> {
    return this.stages[boardId].stars;
  }

  /** Whether every star the hall needs has shone at once; latched. */
  get solved(): boolean {
    return this.solvedAt !== null;
  }

  /** Whether the encore has shone in this tent. */
  get encoreShone(): boolean {
    return this.encoreAt !== null;
  }

  isTeachingOpen(half: MazeHalf): boolean {
    return this.teachingOpenedAt.has(half);
  }

  /** The stars the hall needs, and how many of them are lit right now. */
  requiredLit(): { lit: number; total: number } {
    return { lit: this.requiredLitCount, total: this.requiredTotal };
  }

  /** The two boards' mirror props, in board order. */
  mirrorsOf(boardId: HallBoardId): ReadonlyArray<MazeMirrorTarget> {
    return this.stages[boardId].mirrors;
  }

  /** The hall marquee's bulbs as they stand, one per star in {@link marqueeStarOrder}. */
  hallMarqueeBulbs(): ReadonlyArray<StarMarqueeBulb> {
    return this.hallSign.art.bulbs;
  }

  /** A teaching lane's two bulbs as they stand, in board order. */
  teachingMarqueeBulbs(half: MazeHalf): ReadonlyArray<StarMarqueeBulb> {
    return this.teachingSigns[half].art.bulbs;
  }

  /** The splitters' panes, for the scene's Y-sorted pass. */
  sortedFigures(frame: number): ReadonlyArray<InteriorFigure> {
    for (const figure of this.splitterFigures) figure.phase = frame;
    return this.splitterFigures;
  }

  /**
   * What a star shows given the light on it now and what it showed before.
   *
   * The whole of the hall's rule sits in this one method, which is why it is
   * a method: a star holds the light only while the light is on it. The gate
   * swaps in a star that keeps what it once had, and watches its check fail.
   */
  settleStars(board: SettlingBoard): ReadonlyArray<BoardStarState> {
    return board.trace.stars;
  }

  /** Re-walks both boards' light and reports what changed. Call after any mirror turns. */
  refresh(frame: number): HallChanges {
    this.lightVersion++;
    let starsLit = 0;
    let starsDimmed = 0;
    let starsFizzled = 0;
    for (const boardId of BOARD_IDS) {
      const stage = this.stages[boardId];
      const previous = stage.stars;
      stage.trace = traceBoard(stage.board, stage.indices());
      stage.stars = this.settleStars(stage);
      const before = new Map(previous.map((state) => [state.starId, state.status]));
      for (const next of stage.stars) {
        const was = before.get(next.starId) ?? 'dark';
        if (next.status === was) continue;
        // A star is heard doing one thing per blow: a light it refuses reads
        // as the sputter, never as a dimming too.
        if (next.status === 'lit') starsLit++;
        else if (next.status === 'fizzle') starsFizzled++;
        else if (was === 'lit') starsDimmed++;
      }
      stage.rebuild();
    }

    this.requiredLitCount = this.stages.hall.stars.filter(
      (state) => state.kind !== 'encore' && state.status === 'lit',
    ).length;
    const solved =
      this.solvedAt === null &&
      this.requiredTotal > 0 &&
      this.requiredLitCount === this.requiredTotal;
    if (solved) this.solvedAt = frame;

    const encoreLit =
      this.encoreAt === null &&
      this.stages.hall.stars.some((state) => state.kind === 'encore' && state.status === 'lit');
    if (encoreLit) this.encoreAt = frame;

    const teachingOpened: MazeHalf[] = [];
    for (const half of MAZE_HALVES) {
      if (this.teachingOpenedAt.has(half)) continue;
      const allLit = this.teachingStars[half].every(
        (star) => this.stages.teaching.stateOf(star.id)?.status === 'lit',
      );
      if (!allLit) continue;
      this.teachingOpenedAt.set(half, frame);
      teachingOpened.push(half);
    }
    this.refreshReadouts();
    return { starsLit, starsDimmed, starsFizzled, solved, encoreLit, teachingOpened };
  }

  /** The marquees' bulbs and done frames, from the stars as they now stand. */
  private refreshReadouts(): void {
    const hall = this.stages.hall;
    const teaching = this.stages.teaching;
    this.allLightSteps = [...hall.lightSteps, ...teaching.lightSteps];
    this.allLitStars = [...hall.litStarLights, ...teaching.litStarLights];
    this.hallSign.art.bulbs = this.hallSign.stars.map((star) =>
      bulbFor(hall.stateOf(star.id), star),
    );
    this.hallSign.doneAt = this.solvedAt;
    for (const half of MAZE_HALVES) {
      const sign = this.teachingSigns[half];
      sign.art.bulbs = sign.stars.map((star) => bulbFor(teaching.stateOf(star.id), star));
      sign.doneAt = this.teachingOpenedAt.get(half) ?? null;
    }
  }

  /** The board a mirror prop stands on, and its index there, or null for a mirror not in this hall. */
  private locate(mirror: MazeMirrorTarget): { stage: BoardStage; index: number } | null {
    for (const boardId of BOARD_IDS) {
      const stage = this.stages[boardId];
      const index = stage.mirrors.indexOf(mirror);
      if (index >= 0) return { stage, index };
    }
    return null;
  }

  /**
   * Where the light of this mirror's board would go after one more blow on it.
   * The same walk as the live light, with that one mirror a step further on.
   */
  previewFor(mirror: MazeMirrorTarget, half: MazeHalf): MazeTurnPreview | null {
    return this.ghostFor(mirror, half)?.preview ?? null;
  }

  private ghostFor(mirror: MazeMirrorTarget, half: MazeHalf): PreviewGhost | null {
    const cached = this.ghost;
    if (
      cached !== null &&
      cached.mirror === mirror &&
      cached.half === half &&
      cached.version === this.lightVersion
    ) {
      return cached.ghost;
    }
    const found = this.locate(mirror);
    if (found === null) return null;
    const { stage, index } = found;
    const trace = traceBoardAfterBlow(stage.board, stage.indices(), index);
    const ghost: PreviewGhost = {
      preview: { mirrorId: mirror.mirrorId, half, boardId: stage.id, trace },
      // Only the light the blow would add is dotted: light that stays where it
      // is already drawn solid, and the hot span, which never moves.
      steps: trace.steps
        .filter(
          (step) =>
            !(stage.burns && step.hot) &&
            !stage.stepKeys.has(`${step.tile.x},${step.tile.y},${step.heading},${step.colour}`),
        )
        .map((step) => ({ tile: stage.toTent(step.tile), heading: step.heading })),
      rings: trace.stars.flatMap((next) => {
        if (next.status !== 'lit' || stage.stateOf(next.starId)?.status === 'lit') return [];
        const star = stage.board.stars.find((candidate) => candidate.id === next.starId);
        return star === undefined ? [] : [stage.toTent(star.tile)];
      }),
    };
    this.ghost = { mirror, half, version: this.lightVersion, ghost };
    return ghost;
  }

  /** The encore star, if the board has one. */
  get encoreStar(): BoardStar | undefined {
    return this.plan.board.stars.find((star) => star.kind === 'encore');
  }

  // ── What the stage lights need ────────────────────────────────────────────

  /** Every tile either board's light crosses, for the additive pass. */
  get beamSteps(): ReadonlyArray<{ readonly tile: MazeTile; readonly hot: boolean }> {
    return this.allLightSteps;
  }

  /** Every lit star, for the additive pass. */
  get litStars(): ReadonlyArray<{ readonly tile: MazeTile; readonly lit: number }> {
    return this.allLitStars;
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  /**
   * The fixed pieces set in the walls: the limelights, the teaching lamps and
   * the windows. Furniture, drawn under the stage lights with the rest of it.
   * The splitters stand on the floor and go through {@link sortedFigures}.
   */
  renderPieces(ctx: CanvasRenderingContext2D, camX: number, camY: number, frame: number): void {
    for (const boardId of BOARD_IDS) {
      const stage = this.stages[boardId];
      for (const light of stage.board.limelights) {
        const tile = stage.toTent(light.tile);
        const x = tile.x * TILE_SIZE - camX;
        const y = tile.y * TILE_SIZE - camY;
        if (!isOnScreen(x, y, PROP_LIFT_TILES)) continue;
        if (stage.burns) drawMazeLimelight(ctx, x, y, TILE_SIZE, light.heading, frame);
        else drawFootlightLamp(ctx, x, y, TILE_SIZE, light.heading, light.colour, frame);
      }
      for (const window of stage.board.windows) {
        const tile = stage.toTent(window);
        const x = tile.x * TILE_SIZE - camX;
        const y = tile.y * TILE_SIZE - camY;
        if (isOnScreen(x, y)) drawMazeWallWindow(ctx, x, y, TILE_SIZE, frame);
      }
    }
  }

  /**
   * What a player reads to solve the hall, over the stage lights so none of it
   * is dimmed: the stars and the marquees always, and while the hall's light is
   * on, the light itself and the ghost of the next blow. Stars first and light
   * over them, so a beam is seen to reach the plate it lights. With the light
   * off the stars show dark: a plate cannot be lit by light that is not there.
   */
  renderReadouts(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    frame: number,
    lightOn: boolean,
    preview: MazeTurnPreview | null,
  ): void {
    for (const boardId of BOARD_IDS) {
      const stage = this.stages[boardId];
      for (const plate of lightOn ? stage.plates : stage.darkPlates) {
        const x = plate.tile.x * TILE_SIZE - camX;
        const y = plate.tile.y * TILE_SIZE - camY;
        if (!isOnScreen(x, y)) continue;
        plate.art.phase = frame;
        drawPuzzleStar(ctx, x, y, TILE_SIZE, plate.art);
      }
    }
    for (const sign of this.signs) this.drawSign(ctx, camX, camY, sign, frame);
    if (!lightOn) return;
    for (const boardId of BOARD_IDS) {
      for (const { tile, runs } of this.stages[boardId].runs) {
        const x = tile.x * TILE_SIZE - camX;
        const y = tile.y * TILE_SIZE - camY;
        if (isOnScreen(x, y)) drawLightBeamTile(ctx, x, y, TILE_SIZE, runs, frame);
      }
    }
    if (preview !== null) this.renderPreview(ctx, camX, camY, frame, preview);
  }

  private drawSign(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    sign: MarqueeSign,
    frame: number,
  ): void {
    const { placement } = sign;
    const x = placement.x * TILE_SIZE - camX;
    const y = placement.y * TILE_SIZE - camY;
    const right = x + placement.widthTiles * TILE_SIZE;
    if (!isOnScreen(x, y, PROP_LIFT_TILES) && !isOnScreen(right - TILE_SIZE, y, PROP_LIFT_TILES)) {
      return;
    }
    sign.art.phase = frame;
    sign.art.framesSinceSolved = sign.doneAt === null ? null : frame - sign.doneAt;
    drawStarMarquee(ctx, x, y, TILE_SIZE, sign.art);
  }

  /** The ghost of the next blow: dots along the light it would add, and a ring on every star it would light. */
  private renderPreview(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    frame: number,
    preview: MazeTurnPreview,
  ): void {
    const mirror = this.stages[preview.boardId].mirrors.find(
      (candidate) => candidate.mirrorId === preview.mirrorId,
    );
    const ghost = mirror === undefined ? null : this.ghostFor(mirror, preview.half);
    if (ghost === null) return;
    for (const step of ghost.steps) {
      const x = step.tile.x * TILE_SIZE - camX;
      const y = step.tile.y * TILE_SIZE - camY;
      if (isOnScreen(x, y)) drawTurnPreviewTile(ctx, x, y, TILE_SIZE, step.heading, frame);
    }
    for (const tile of ghost.rings) {
      const x = tile.x * TILE_SIZE - camX;
      const y = tile.y * TILE_SIZE - camY;
      if (isOnScreen(x, y)) drawTurnPreviewStarRing(ctx, x, y, TILE_SIZE, frame);
    }
  }

  /**
   * The fire of the hot span and every flare where light meets glass, over the
   * crawlers: a crawler stands in the span, not behind it. Nothing at all while
   * the hall's light is off.
   */
  renderEffects(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    frame: number,
    lightOn: boolean,
  ): void {
    if (!lightOn) return;
    for (const step of this.hotSpan) {
      const x = step.tentTile.x * TILE_SIZE - camX;
      const y = step.tentTile.y * TILE_SIZE - camY;
      if (!isOnScreen(x, y)) continue;
      drawMazeBeamTile(ctx, x, y, TILE_SIZE, {
        hot: true,
        heading: step.heading,
        phase: frame,
        seed: step.seed,
      });
    }
    for (const boardId of BOARD_IDS) {
      for (const contact of this.stages[boardId].contacts) {
        const x = contact.tile.x * TILE_SIZE - camX;
        const y = contact.tile.y * TILE_SIZE - camY;
        if (!isOnScreen(x, y)) continue;
        drawBeamMirrorFlare(ctx, x, y, TILE_SIZE, {
          hot: contact.hot,
          absorbed: contact.absorbed,
          phase: frame,
        });
      }
    }
  }
}
