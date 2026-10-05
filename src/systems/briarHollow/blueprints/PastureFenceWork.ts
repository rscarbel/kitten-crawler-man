/**
 * Merrit's fence: the pasture ring cut into sections, each rebuilt from the
 * rickety fence to post-and-rail with a short hammering channel and two
 * boards, during the `build_fence` step only.
 *
 * Owned by `BlueprintsQuestSystem`, which asks it where the next section is
 * (for guidance and the tracker) and routes Space, taps and the render
 * passes to it through the hooks below. Everything durable lives in
 * `ctx.state.blueprints.fenceSectionsBuilt`; the channel in progress is the
 * only thing held here, and a rewind drops it.
 */

import type { AudioManager } from '../../../audio/AudioManager';
import { HumanPlayer } from '../../../creatures/HumanPlayer';
import type { TilePoint } from '../../../map/town/townPlan';
import type { FenceStyle } from '../../../map/tileTypes';
import {
  canAfford,
  costRequirements,
  spend,
  type ResourceCost,
} from '../../../core/partyResources';
import { TILE_SIZE } from '../../../core/constants';
import { activeInputMode, byInputMode } from '../../../ui/core/inputMode';
import { blueprintsPhaseAtLeast } from '../../../core/blueprintsQuestPhase';
import {
  PASTURE_FENCE_SECTION_COUNT,
  pastureFenceSections,
} from '../../../map/overworld/briarHollowLayout';
import { REPAIR_ROWS } from '../../../sprites/art/humanFigure';
import { viewForFacing } from '../../../sprites/humanSprite';
import { worldBar } from '../../../ui/world/worldShapes';
import {
  drawInteractionPrompt,
  interactionPromptsSuppressed,
  interactionPromptTop,
} from '../../../ui/InteractionPrompt';
import { drawRequirementRow } from '../../../ui/RequirementRow';
import { UPDATES_PER_SECOND } from '../structureRules';
import type { BlueprintsCrawler, BlueprintsQuestContext } from './blueprintsContext';
import { BLUEPRINTS_CUES } from './blueprintsSoundCues';
import { worldPalette } from '../../../ui/theme/worldInk';

/** Boards of wood each fence section costs, spent when its channel completes. */
export const FENCE_SECTION_BOARD_COST = 2;
/** What one section costs, in the shape the party's resource helpers take. */
export const FENCE_SECTION_COST: ResourceCost = { wood_board: FENCE_SECTION_BOARD_COST };
/** How near a section's nearest tile the active crawler must stand for it to glow and take a press. */
export const FENCE_REACH_TILES = 1.5;
/** How long the hammering channel on one section takes. */
export const FENCE_SECTION_WORK_SECONDS = 1.5;
/** What the party is told when a section is pressed without the boards for it. */
export const FENCE_SHORT_MESSAGE = 'Not enough materials.';

const FENCE_SECTION_WORK_FRAMES = Math.round(FENCE_SECTION_WORK_SECONDS * UPDATES_PER_SECOND);
const UNBUILT_STYLE: FenceStyle = 'rickety';
const BUILT_STYLE: FenceStyle = 'post_and_rail';
const TILE_CENTRE = 0.5;
/**
 * How far the builder may drift before the channel counts as walked off: a
 * separation push or a shove moves a crawler by a hair without its say.
 */
const WORK_MOTION_TOLERANCE_PX = 0.5;
/** How often the resource strip is kept up while hammering, so it shows the boards about to go. */
const RESOURCE_NOTE_INTERVAL_FRAMES = UPDATES_PER_SECOND;
const WORK_LOOP_VOLUME = 0.7;
/** Donut has no hammering row: her swipe lands on this cadence while she works a section. */
const CAT_HAMMER_SWING_TICKS = 30;
const FLOATING_TEXT = 'Fence rebuilt';

/** Rails join toward their neighbours, so a restyled tile changes the art of all eight round it. */
const NEIGHBOURHOOD_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [0, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

const PROGRESS_BAR_WIDTH = 36;
const PROGRESS_BAR_HEIGHT = 5;
const PROGRESS_BAR_LIFT_PX = 10;
/** Gap between the SPACE prompt and the cost line stacked above it. */
const COST_LINE_GAP_PX = 12;

/** The reach glow, matching the sawmill's: a pulsing ellipse on the ground under each tile of the section. */
const REACH_GLOW_COLOR = worldPalette.village.reachGlow;
const REACH_GLOW_PULSE_PERIOD_MS = 700;
const REACH_GLOW_PULSE_MIN = 0.35;
const REACH_GLOW_PULSE_RANGE = 0.4;
const REACH_GLOW_LINE_WIDTH = 2;
/** Each tile's ellipse runs a little past the tile so neighbouring glows merge into one band. */
const REACH_GLOW_RADIUS_TILES = 0.7;
/** Ground-plane perspective: the ellipse's vertical radius as a fraction of its horizontal one. */
const REACH_GLOW_GROUND_SQUASH = 0.55;
const REACH_GLOW_FILL_ALPHA = 0.22;
const REACH_GLOW_EDGE_ALPHA = 0.55;
const SINE_TO_UNIT_SCALE = 0.5;
const SINE_TO_UNIT_OFFSET = 0.5;

interface FenceJob {
  readonly section: number;
  readonly builder: BlueprintsCrawler;
  /** The way the builder faces the section while hammering. */
  readonly faceX: number;
  readonly faceY: number;
  framesLeft: number;
  frames: number;
  refX: number;
  refY: number;
  /** Whether Carl's hammering row is this job's, so ending the job only ever stops its own. */
  posing: boolean;
  catSwingTicks: number;
}

/**
 * What the fence reads: the slice of the quest's shared context it uses,
 * with the audio narrowed to the ambient-loop calls its hammering bed makes —
 * narrow enough for a headless gate to stand in for it.
 */
export type PastureFenceContext = Pick<
  BlueprintsQuestContext,
  | 'state'
  | 'gameMap'
  | 'site'
  | 'human'
  | 'cat'
  | 'active'
  | 'announce'
  | 'onTileChanged'
  | 'noteResourceActivity'
  | 'worldHalted'
  | 'cue'
> & {
  readonly audio: Pick<
    AudioManager,
    'startAmbientLoop' | 'stopAmbientLoop' | 'isAmbientLoopRunning'
  > | null;
};

export class PastureFenceWork {
  /** The ring's runs, by the index their built flag is saved under. */
  readonly sections: readonly (readonly TilePoint[])[];
  private job: FenceJob | null = null;
  /** Whether the hammering bed playing was started here, so only this part ever stops it. */
  private ownsWorkLoop = false;

  constructor(protected readonly ctx: PastureFenceContext) {
    this.sections = pastureFenceSections(ctx.site);
    this.syncFenceStyles();
  }

  /** How many sections stand rebuilt, out of {@link PASTURE_FENCE_SECTION_COUNT}. */
  get sectionsBuilt(): number {
    return this.ctx.state.blueprints.fenceSectionsBuilt.filter((built) => built).length;
  }

  /** Whether every section stands rebuilt. */
  get allSectionsBuilt(): boolean {
    return this.sectionsBuilt >= PASTURE_FENCE_SECTION_COUNT;
  }

  /** Whether a hammering channel is running. */
  get isWorking(): boolean {
    return this.job !== null;
  }

  /**
   * Whether section `index` stands rebuilt. Every step past the fence counts
   * all of them built whatever the flags say, so a quest moved on by other
   * means never leaves the rickety fence standing.
   */
  isSectionBuilt(index: number): boolean {
    if (blueprintsPhaseAtLeast(this.ctx.state.blueprints.phase, 'report_fence')) return true;
    const built = this.ctx.state.blueprints.fenceSectionsBuilt;
    return index < built.length && built[index];
  }

  /**
   * The tiles of the unbuilt section nearest `from`, for the guide's
   * highlight and the tracker arrow; null when every section is built or the
   * map has no pasture ring to cut.
   */
  nearestUnbuiltSectionTiles(from: TilePoint): readonly TilePoint[] | null {
    const nearest = this.nearestUnbuilt(from.x + TILE_CENTRE, from.y + TILE_CENTRE);
    return nearest === null ? null : this.sections[nearest.index];
  }

  /**
   * The unbuilt section with a tile nearest (`tileX`, `tileY`) — a point in
   * tile units, measured to tile centres — with that distance.
   */
  private nearestUnbuilt(
    tileX: number,
    tileY: number,
  ): { readonly index: number; readonly tiles: number } | null {
    let bestIndex: number | null = null;
    let bestTiles = Number.POSITIVE_INFINITY;
    for (let index = 0; index < this.sections.length; index++) {
      if (this.isSectionBuilt(index)) continue;
      for (const tile of this.sections[index]) {
        const tiles = Math.hypot(tile.x + TILE_CENTRE - tileX, tile.y + TILE_CENTRE - tileY);
        if (tiles < bestTiles) {
          bestIndex = index;
          bestTiles = tiles;
        }
      }
    }
    return bestIndex === null ? null : { index: bestIndex, tiles: bestTiles };
  }

  /** The unbuilt section `crawler` could rebuild from where it stands, in `build_fence` only. */
  sectionInReach(crawler: BlueprintsCrawler): number | null {
    if (this.ctx.state.blueprints.phase !== 'build_fence') return null;
    const centreX = crawler.x / TILE_SIZE + TILE_CENTRE;
    const centreY = crawler.y / TILE_SIZE + TILE_CENTRE;
    const nearest = this.nearestUnbuilt(centreX, centreY);
    if (nearest === null || nearest.tiles > FENCE_REACH_TILES) return null;
    return nearest.index;
  }

  /**
   * Once per gameplay frame: advances a hammering channel, cancelling it when
   * the crawler moves, and keeps every section's art in step with its flag —
   * which also puts the fence back the way a death rewind left the flags.
   */
  update(): void {
    this.syncFenceStyles();
    this.advanceJob();
    this.syncWorkLoop();
  }

  /**
   * Space, from `BriarHollowKit.tryInteract`, ahead of the wall build and the
   * harvest. Starts a section's channel when one is in reach during
   * `build_fence` (or says "Not enough materials." when the party is short).
   * Returns whether the press was taken; false outside `build_fence` and
   * whenever no section is in reach, so the press falls through unchanged.
   */
  tryInteract(active: BlueprintsCrawler): boolean {
    const section = this.sectionInReach(active);
    if (section === null) return false;
    if (this.job !== null) return true;
    this.startWork(section, active);
    return true;
  }

  /**
   * A single world tap at world pixel (`worldX`, `worldY`), from
   * `BriarHollowKit.handleTap` ahead of cows and villagers: the mobile
   * equivalent of {@link tryInteract} for a tap on a section in reach.
   * Returns whether the tap was taken.
   */
  handleTap(worldX: number, worldY: number, active: BlueprintsCrawler): boolean {
    const section = this.sectionInReach(active);
    if (section === null) return false;
    const tileX = Math.floor(worldX / TILE_SIZE);
    const tileY = Math.floor(worldY / TILE_SIZE);
    const tapped = this.sections[section].some((tile) => tile.x === tileX && tile.y === tileY);
    if (!tapped) return false;
    if (this.job === null) this.startWork(section, active);
    return true;
  }

  private startWork(section: number, builder: BlueprintsCrawler): void {
    if (!canAfford(this.ctx.human, this.ctx.cat, FENCE_SECTION_COST)) {
      this.ctx.announce(FENCE_SHORT_MESSAGE);
      return;
    }
    const facing = this.facingToward(this.sections[section], builder);
    builder.facingX = facing.x;
    builder.facingY = facing.y;
    const job: FenceJob = {
      section,
      builder,
      faceX: facing.x,
      faceY: facing.y,
      framesLeft: FENCE_SECTION_WORK_FRAMES,
      frames: 0,
      refX: builder.x,
      refY: builder.y,
      posing: false,
      catSwingTicks: 0,
    };
    this.job = job;
    if (builder instanceof HumanPlayer) this.playHammerRow(job, builder);
    else builder.playWorkSwing();
    this.ctx.cue('fencePull');
    this.ctx.noteResourceActivity();
    this.syncWorkLoop();
  }

  /** The unit vector from `builder`'s centre to the section tile nearest it. */
  private facingToward(
    tiles: readonly TilePoint[],
    builder: BlueprintsCrawler,
  ): { readonly x: number; readonly y: number } {
    const tile = this.tileNearest(tiles, builder);
    if (tile === null) return { x: builder.facingX, y: builder.facingY };
    const dx = (tile.x + TILE_CENTRE) * TILE_SIZE - (builder.x + TILE_SIZE * TILE_CENTRE);
    const dy = (tile.y + TILE_CENTRE) * TILE_SIZE - (builder.y + TILE_SIZE * TILE_CENTRE);
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return { x: builder.facingX, y: builder.facingY };
    return { x: dx / distance, y: dy / distance };
  }

  private playHammerRow(job: FenceJob, human: HumanPlayer): void {
    job.posing = human.playAction(REPAIR_ROWS[viewForFacing(job.faceX, job.faceY)], {
      faceX: job.faceX,
      faceY: job.faceY,
      loop: true,
      onEnd: () => {
        job.posing = false;
      },
    });
  }

  /**
   * Carl's hammering loops until the job ends. A row the animator refuses
   * (he is mid-flinch) or another system stops is asked for again next tick,
   * so the picture catches back up with the work.
   */
  private keepHammering(job: FenceJob): void {
    const builder = job.builder;
    if (builder instanceof HumanPlayer) {
      if (!job.posing) this.playHammerRow(job, builder);
      return;
    }
    job.catSwingTicks++;
    if (job.catSwingTicks < CAT_HAMMER_SWING_TICKS) return;
    job.catSwingTicks = 0;
    builder.playWorkSwing();
  }

  private endJob(job: FenceJob): void {
    if (this.job === job) this.job = null;
    if (job.posing) this.ctx.human.stopAction();
  }

  private jobShouldEnd(job: FenceJob): boolean {
    if (this.ctx.state.blueprints.phase !== 'build_fence') return true;
    if (this.isSectionBuilt(job.section)) return true;
    const builder = job.builder;
    if (!builder.isActive || builder.isKnockedOut || !builder.isAlive) return true;
    if (builder.isSwinging) return true;
    const moved = Math.hypot(builder.x - job.refX, builder.y - job.refY);
    if (moved > WORK_MOTION_TOLERANCE_PX) {
      if (builder.isMoving) return true;
      job.refX = builder.x;
      job.refY = builder.y;
    }
    return false;
  }

  private advanceJob(): void {
    const job = this.job;
    if (job === null) return;
    if (this.jobShouldEnd(job)) {
      this.endJob(job);
      return;
    }
    if (this.ctx.worldHalted()) return;
    this.keepHammering(job);
    job.frames++;
    if (job.frames % RESOURCE_NOTE_INTERVAL_FRAMES === 0) this.ctx.noteResourceActivity();
    job.framesLeft--;
    if (job.framesLeft <= 0) this.finishJob(job);
  }

  private finishJob(job: FenceJob): void {
    this.endJob(job);
    const { human, cat } = this.ctx;
    // The boards are counted again here, not trusted from the press: they may
    // have been spent on something else while the hammer was going.
    if (!spend(human, cat, FENCE_SECTION_COST, job.builder)) {
      this.ctx.announce(FENCE_SHORT_MESSAGE);
      return;
    }
    this.ctx.state.blueprints.fenceSectionsBuilt[job.section] = true;
    this.syncFenceStyles();
    this.ctx.cue('fencePostSet');
    this.ctx.noteResourceActivity();
    job.builder.queueFloatingText(FLOATING_TEXT, 'buff');
  }

  /**
   * Keyed off the live channel rather than started and stopped at each end,
   * because a channel ends several ways (finished, walked off, rewound,
   * disposed) and every one must silence the loop. Asked every frame while
   * the channel runs, because the loop can be lost under it: the palisade's
   * repairs play and stop the same recording, and a locked audio context
   * declines a start until the player's first gesture. Only ever stops a
   * loop this part started.
   */
  private syncWorkLoop(): void {
    const audio = this.ctx.audio;
    if (audio === null) return;
    const [loop] = BLUEPRINTS_CUES.fenceWorkLoop;
    if (this.job !== null) {
      if (audio.isAmbientLoopRunning(loop)) return;
      audio.startAmbientLoop(loop, WORK_LOOP_VOLUME);
      this.ownsWorkLoop = true;
    } else if (this.ownsWorkLoop) {
      audio.stopAmbientLoop(loop);
      this.ownsWorkLoop = false;
    }
  }

  /** Paints each section in the style its flag asks for, re-baking only the tiles that change. */
  private syncFenceStyles(): void {
    const { structure } = this.ctx.gameMap;
    this.sections.forEach((section, index) => {
      const style = this.isSectionBuilt(index) ? BUILT_STYLE : UNBUILT_STYLE;
      for (const tile of section) {
        if (tile.y < 0 || tile.y >= structure.length) continue;
        const row = structure[tile.y];
        if (tile.x < 0 || tile.x >= row.length) continue;
        const content = row[tile.x];
        if (content.fenceStyle === undefined) continue;
        if (content.fenceStyle === style) continue;
        content.fenceStyle = style;
        this.markRestyled(tile);
      }
    });
  }

  private markRestyled(tile: TilePoint): void {
    for (const [dx, dy] of NEIGHBOURHOOD_OFFSETS) {
      this.ctx.gameMap.markTileDirty(tile.x + dx, tile.y + dy);
    }
    this.ctx.onTileChanged(tile.x, tile.y);
  }

  /** Under every body: the reach glow on the section a press would rebuild. */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.job !== null) return;
    const section = this.sectionInReach(this.ctx.active());
    if (section === null) return;
    const pulse =
      REACH_GLOW_PULSE_MIN +
      REACH_GLOW_PULSE_RANGE *
        (SINE_TO_UNIT_OFFSET +
          SINE_TO_UNIT_SCALE * Math.sin(performance.now() / REACH_GLOW_PULSE_PERIOD_MS));
    const radiusX = REACH_GLOW_RADIUS_TILES * TILE_SIZE;
    const radiusY = radiusX * REACH_GLOW_GROUND_SQUASH;
    ctx.save();
    ctx.fillStyle = REACH_GLOW_COLOR;
    ctx.strokeStyle = REACH_GLOW_COLOR;
    ctx.lineWidth = REACH_GLOW_LINE_WIDTH;
    for (const tile of this.sections[section]) {
      const groundCx = (tile.x + TILE_CENTRE) * TILE_SIZE - camX;
      const groundCy = (tile.y + 1) * TILE_SIZE - camY;
      ctx.beginPath();
      ctx.ellipse(groundCx, groundCy, radiusX, radiusY, 0, 0, Math.PI * 2);
      ctx.globalAlpha = pulse * REACH_GLOW_FILL_ALPHA;
      ctx.fill();
      ctx.globalAlpha = pulse * REACH_GLOW_EDGE_ALPHA;
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Over every body: the channel's progress bar. */
  renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const job = this.job;
    if (job === null) return;
    const tiles = this.sections[job.section];
    const centreX = sectionCentreX(tiles) * TILE_SIZE - camX;
    const top = Math.min(...tiles.map((tile) => tile.y)) * TILE_SIZE - camY - PROGRESS_BAR_LIFT_PX;
    worldBar(
      ctx,
      {
        x: centreX - PROGRESS_BAR_WIDTH / 2,
        y: top,
        w: PROGRESS_BAR_WIDTH,
        h: PROGRESS_BAR_HEIGHT,
      },
      { style: 'build', value: 1 - job.framesLeft / FENCE_SECTION_WORK_FRAMES },
    );
  }

  /**
   * The "Rebuild fence" prompt with its cost, in `BriarHollowKit.renderPrompt`
   * order (the same order as `tryInteract`). Returns whether it claimed the
   * prompt slot. While hammering, a section in reach claims it without
   * drawing, exactly as {@link tryInteract} swallows the press, so no later
   * link offers a press that would not happen.
   */
  renderPrompt(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: BlueprintsCrawler,
  ): boolean {
    const section = this.sectionInReach(active);
    if (section === null) return false;
    if (this.job !== null) return true;
    const anchor = this.tileNearest(this.sections[section], active);
    if (anchor === null) return false;
    const sx = anchor.x * TILE_SIZE - camX;
    const sy = anchor.y * TILE_SIZE - camY;
    // In touch mode the key cap itself reads "TAP", so the label finishes its sentence.
    const label = byInputMode(activeInputMode(), {
      touch: 'to rebuild fence',
      pointer: 'Rebuild fence',
    });
    drawInteractionPrompt(ctx, sx, sy, TILE_SIZE, label);
    if (!interactionPromptsSuppressed()) {
      drawRequirementRow(
        ctx,
        costRequirements(this.ctx.human, this.ctx.cat, FENCE_SECTION_COST),
        sx + TILE_SIZE * TILE_CENTRE,
        interactionPromptTop(sy) - COST_LINE_GAP_PX,
      );
    }
    return true;
  }

  private tileNearest(tiles: readonly TilePoint[], crawler: BlueprintsCrawler): TilePoint | null {
    const centreX = crawler.x / TILE_SIZE + TILE_CENTRE;
    const centreY = crawler.y / TILE_SIZE + TILE_CENTRE;
    let best: TilePoint | null = null;
    let bestTiles = Number.POSITIVE_INFINITY;
    for (const tile of tiles) {
      const tilesAway = Math.hypot(tile.x + TILE_CENTRE - centreX, tile.y + TILE_CENTRE - centreY);
      if (tilesAway < bestTiles) {
        best = tile;
        bestTiles = tilesAway;
      }
    }
    return best;
  }

  /** A death rewind on the same scene: drop any channel in progress. */
  onRewind(): void {
    if (this.job !== null) this.endJob(this.job);
    this.syncWorkLoop();
  }

  /** The scene is being torn down: stop any loop this part started. */
  dispose(): void {
    if (this.job !== null) this.endJob(this.job);
    this.syncWorkLoop();
  }
}

/** The middle of a run of tiles, in tile units, for a bar centred over it. */
function sectionCentreX(tiles: readonly TilePoint[]): number {
  const xs = tiles.map((tile) => tile.x);
  return (Math.min(...xs) + Math.max(...xs) + 1) / 2;
}
