/**
 * BigTopMazeSystem — the finale of "The Show Must Go On", inside the tent.
 *
 * The vine runs the big top as a performance in three acts, because Grimaldi
 * never staged a show without a floor that opened. The human and the cat come
 * in through two flaps into two sealed lanes and walk the fire walk, the
 * menagerie and the hall of mirrors, meeting only in the paired curtain rooms
 * between acts — where both of them have to be standing before either curtain
 * lifts. Every act puts doors in one lane that only the other lane can open.
 *
 * Failing an act costs no health. The house hauls both crawlers back to the top
 * of the act they were in, with every curtain, cage gate and lit star they had
 * already earned still open — which is the only currency a timing puzzle can
 * charge in without eventually making itself unfinishable.
 *
 * Nothing in the tent hurts, including the last act. Grimaldi is not a fight:
 * the centre ring is where the party stops performing and starts talking, and
 * the answer at the pole is a health potion poured over him, not a weapon.
 *
 * Owned by `BuildingInteriorScene`, which supplies the roster. All state is
 * scene-local and rebuilt from scratch on every entry: the maze holds nothing
 * across the door, so leaving mid-run and coming back starts it over.
 */

import { TILE_SIZE } from '../core/constants';
import type { GameMap } from '../map/GameMap';
import type { EventBus } from '../core/EventBus';
import type { AudioManager } from '../audio/AudioManager';
import type { SoundId } from '../audio/sounds';
import type { GameSystem, SystemContext } from './GameSystem';
import type { GroundHazardSource } from './GroundHazardSource';
import type { Mob } from '../creatures/Mob';
import type { Player } from '../Player';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CircusQuestProgress } from '../core/CircusQuestProgress';
import { keybindings } from '../core/Keybindings';
import { platform } from '../core/Platform';
import { GrimaldiVine } from '../creatures/GrimaldiVine';
import { MazeBlockTarget } from '../creatures/MazeBlockTarget';
import type { MazePropTarget } from '../creatures/MazePropTarget';
import { MazeBellTarget } from '../creatures/MazeBellTarget';
import { MazeMirrorTarget } from '../creatures/MazeMirrorTarget';
import { QuestDialog, type DialogPage } from '../ui/QuestDialog';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import { drawText } from '../ui/TextBox';
import { viewportWidth, viewportHeight } from '../core/Viewport';
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
  drawMazeCageGate,
  drawMazeCurtain,
  drawMazeCurtainOpen,
  drawMazeCurtainWindow,
  drawMazeExitDoor,
  drawMazeGate,
  drawMazeGrate,
  drawMazeLimelight,
  drawMazeRope,
  drawMazeStar,
  drawMazeWayOpen,
  type MazeStarArt,
  type MazeWayOpenArt,
  drawMenagerieCage,
  drawMirrorHallGlass,
  drawRingMatRunner,
  drawSpotlightBeam,
  drawSpotlightClear,
  drawSpotlightDock,
  drawSpotlightWarm,
  drawTargetNameChip,
} from '../sprites/bigTopMazeProps';
import {
  ACT_ONE_BANNER,
  BIGTOP_ENTRY_BANNER,
  BIGTOP_ENTRY_SUBTITLE,
  BURNOUT_FLASH_FRAMES,
  isInFinalChamber,
  isMazeBarrierTile,
  MAZE_BELLS,
  MAZE_BLOCKS,
  MAZE_CORRIDORS,
  MAZE_CURTAINS,
  MAZE_GRIMALDI_TILE,
  MENAGERIE_BLEACHER_ROW,
  MENAGERIE_CAGE_ROWS,
  MENAGERIE_LANES,
  MIRROR_HALL_GLASS_COLUMNS,
  MIRROR_HALL_ROWS,
  MAZE_MIRRORS,
  MAZE_PROJECTORS,
  MAZE_SECTIONS,
  MAZE_SPOTLIGHT_CROSSINGS,
  MAZE_SPOTLIGHTS,
  MAZE_STARS,
  MAZE_TARGET_OWNER,
  MAZE_VENTS,
  rectContains,
  sectionAtRow,
  traceMazeBeam,
  ventFlameProgress,
  ventPhaseAt,
  ventTelegraphProgress,
  type MazeBlock,
  type MazeHalf,
  type MazeSection,
  type MazeSectionId,
  type BeamPath,
  type MazeTile,
  type MirrorFacing,
  type VentSchedule,
} from '../map/bigTopMazeLayout';
import {
  ACT_TWO_CARD,
  ACT_THREE_CARD,
  BURNOUT_FIRE_DIALOG,
  BURNOUT_LIMELIGHT_DIALOG,
  BURNOUT_SPOTLIGHT_DIALOG,
  GRIMALDI_CURE_DIALOG,
  GRIMALDI_FREED_DIALOG,
  LAST_ACT_DIALOG,
} from './circusQuestDialogs';
import { SAWDUST_FLOOR } from '../map/tileTypes';
import { drawOverlay } from '../ui/Box';

const FRAMES_PER_SECOND = 60;

/** Music fades, matched to the ones the overworld half of the questline uses. */
const CIRCUS_BATTLE_FADE_IN_MS = 1000;
const CIRCUS_THEME_FADE_IN_MS = 2000;

/** How close a crawler must be to the vine to pour the potion on him. */
const POUR_RANGE_TILES = 2.4;
/**
 * How long a newly opened way flares before it settles into its quiet art.
 *
 * Long enough to still be burning when the player switches to the crawler it
 * was opened for, because the two things happen in that order every time: the
 * blow lands in one lane and the door is walked through from the other.
 */
const WAY_FLARE_FRAMES = 210;

/** How near a crossing's threshold the lantern hint starts speaking up. */
const CROSSING_HINT_RANGE_TILES = 2;
/** How close a crawler must be to their own unsolved block for the hint to show. */
const BLOCK_HINT_RANGE_TILES = 3.5;
/** How close the acting crawler must be to a target for its action prompt to show. */
const TARGET_PROMPT_RANGE_TILES = 3;

/** The white-out a failed act paints over everything, at its brightest. */
const BURNOUT_FLASH_COLOR = '#ffe8c0';
const BURNOUT_FLASH_PEAK_ALPHA = 0.92;

/** The one consumable the cure spends, when the party happens to have one. */
const POUR_ITEM_ID = 'health_potion';

const BANNER_SECONDS = 5;
const BANNER_FRAMES = BANNER_SECONDS * FRAMES_PER_SECOND;
const BANNER_FADE_FRAMES = 60;
const BANNER_TITLE_Y = 70;
const BANNER_TITLE_SIZE = 26;
const BANNER_SUBTITLE_Y = 102;
const BANNER_SUBTITLE_SIZE = 13;
const BANNER_GLOW_BLUR = 12;
const BANNER_TITLE_COLOR = '#a8f070';
const BANNER_TITLE_GLOW = '#3a6a2a';
const BANNER_SUBTITLE_COLOR = '#d4edaa';

// ── Cutscene script, in frames at 60 fps ──────────────────────────────────────

/**
 * Where in the cure the medicine's own flush peaks.
 *
 * The tint rises to it and drains away again over the rest of the beat, so what
 * the player watches is something passing *through* him rather than one more
 * layer of poison settling on top.
 */
const CS_POTION_FLUSH_PEAK = 0.5;
/** After the last dialog page, the human walks the last steps up to the trunk. */
const CS_APPROACH_FRAMES = 45;
/** The cure flourish: the tint drains, the mass straightens, the glow lifts. */
const CS_CURE_FRAMES = 110;
/** How far short of the vine the scripted walk stops. */
const CS_APPROACH_STOP_TILES = 1.5;
/** Frames the camera takes to slide from the crawler onto the vine. */
const CS_CAMERA_LERP_FRAMES = 45;
/**
 * How long the coils take to let go while Carl is talking him down.
 *
 * The slump belongs to the conversation rather than to the potion: what loosens
 * the vine's grip is the dwarf inside it remembering his own name, and the
 * medicine only closes what the name opened.
 */
const CS_SAG_BLOOM_FRAMES = 90;

/** Where in the cutscene the script currently is. */
type CutsceneBeat = 'dialog' | 'approach' | 'cure' | 'freed' | 'done';

const OBJECTIVE_Y_FROM_BOTTOM = 96;
const OBJECTIVE_SIZE = 13;
const OBJECTIVE_PENDING_COLOR = '#e8d060';
const OBJECTIVE_DONE_COLOR = '#a8f070';

/** World-space hint text sits this far above the crawler's head. */
const HINT_LIFT_TILES = 1.6;
const HINT_SIZE = 11;
const HINT_COLOR = '#ffe9a8';
const HINT_OUTLINE = 'rgba(0,0,0,0.85)';

const TILE_CENTRE = 0.5;

/** How far above its own tile a flame column reaches, for the culling test. */
const FLAME_COLUMN_HEIGHT_TILES = 2;
/** How far above its own tile a hanging pod or a name chip reaches. */
const OVERHEAD_PROP_HEIGHT_TILES = 1.5;

/**
 * How far apart two vents' flame clocks are set, so a bank of them lighting on
 * the same frame does not churn in lockstep.
 *
 * The column art is a pure function of the frame counter it is handed, and the
 * vents carry no state of their own to vary it with — so the offset has to come
 * from the one thing a vent does own, its tile. Strides that share no factor
 * with the spread keep neighbours in a row and in a column apart.
 */
const VENT_PHASE_SPREAD_FRAMES = 37;
const VENT_PHASE_COLUMN_STRIDE = 7;
const VENT_PHASE_ROW_STRIDE = 13;

function ventFlamePhase(vent: VentSchedule, frame: number): number {
  const offset =
    (vent.tileX * VENT_PHASE_COLUMN_STRIDE + vent.tileY * VENT_PHASE_ROW_STRIDE) %
    VENT_PHASE_SPREAD_FRAMES;
  return frame + offset;
}

/** How near a vent has to be for its ignition to be worth hearing. */
const VENT_CUE_RANGE_TILES = 9;
/** How long the ignition cue rests before another vent may claim it. */
const VENT_CUE_COOLDOWN_FRAMES = 18;

/**
 * How close to a hazard's centre the companion steering treats as "get off this".
 *
 * Only correct inside a narrow band, and both edges of it bite:
 *
 * - Below `√2 / 2 ≈ 0.707` it stops covering the hazard's own tile. Positions
 *   are compared centre to centre, and the same centre-tile rule decides who
 *   gets caught — so a crawler whose centre sits in the corner region of a lit
 *   vent would cost the party the act with the steering never having reacted at
 *   all.
 * - At 1 or above it reaches the centre of the tile next door. The maze's safe
 *   ground is usually exactly there (a pulse corridor's dwell cells sit between
 *   two banks), so a wider reach shoves a parked crawler off perfectly good
 *   ground every time the bank beside them lights.
 *
 * Exported, and asserted against both bounds by the maze's own gate, because
 * neither failure has a symptom anything else would catch.
 */
export const HAZARD_ESCAPE_RADIUS_TILES = 0.8;

// ── Dressing ──────────────────────────────────────────────────────────────────

/** One in this many runner tiles carries a footlight. */
const FOOTLIGHT_STRIDE = 4;
/** One in this many wall tiles along a bleacher row seats a dead spectator. */
const BLEACHER_STRIDE = 2;
/** One in this many wall tiles along a menagerie run carries a cage front. */
const CAGE_STRIDE = 3;
/** One in this many wall tiles bounding the mirror halls carries a pane. */
const MIRROR_GLASS_STRIDE = 3;

type DressingKind = 'runner' | 'footlight' | 'archPost' | 'bleacher' | 'cage' | 'mirrorGlass';

interface Dressing {
  readonly tile: MazeTile;
  readonly kind: DressingKind;
  readonly owner: MazeHalf;
  readonly seed: number;
}

/** A painted board hung over an arch, naming the act it opens onto. */
interface ActBoard {
  readonly tile: MazeTile;
  readonly label: string;
}

/** The dividing wall the boards are centred on, and where the first one hangs. */
const ACT_BOARD_COLUMN = 21;
const ACT_ONE_BOARD_ROW = 86;

// ── Beams ─────────────────────────────────────────────────────────────────────

/** What put a crawler back at the top of the act. */
type BurnoutCause = 'fire' | 'spotlight' | 'limelight';

const BURNOUT_DIALOGS: Readonly<Record<BurnoutCause, ReadonlyArray<DialogPage>>> = {
  fire: BURNOUT_FIRE_DIALOG,
  spotlight: BURNOUT_SPOTLIGHT_DIALOG,
  limelight: BURNOUT_LIMELIGHT_DIALOG,
};

/** The one-page card each act opens with, shown once as its curtains part. */
const ACT_CARDS: Readonly<Partial<Record<MazeSectionId, ReadonlyArray<DialogPage>>>> = {
  menagerie: ACT_TWO_CARD,
  mirrors: ACT_THREE_CARD,
  finale: LAST_ACT_DIALOG,
};

/**
 * Whether a tile drawn at this screen position is worth the paint.
 *
 * The maze is 44×88 tiles against a viewport that shows a small fraction of it,
 * and a lit vent costs a gradient and a dozen bezier fills — so nearly all of
 * that work would be spent on flame nobody can see. `liftTiles` extends the
 * test upward for art that stands taller than its own tile.
 */
function isOnScreen(x: number, y: number, liftTiles = 0): boolean {
  return (
    x > -TILE_SIZE &&
    y > -TILE_SIZE * (1 + liftTiles) &&
    x < viewportWidth() + TILE_SIZE &&
    y < viewportHeight() + TILE_SIZE
  );
}

function tileKeyOf(tileX: number, tileY: number): string {
  return `${tileX},${tileY}`;
}

function tileOf(entity: Player): MazeTile {
  return {
    x: Math.floor((entity.x + TILE_SIZE * TILE_CENTRE) / TILE_SIZE),
    y: Math.floor((entity.y + TILE_SIZE * TILE_CENTRE) / TILE_SIZE),
  };
}

/** Cardinal steps only: a parked crawler walks, and a diagonal can cut a corner. */
const RESTING_SPOT_NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export class BigTopMazeSystem implements GameSystem, GroundHazardSource {
  /**
   * Shown by BuildingInteriorScene if the party falls in here.
   *
   * Only the last act can kill: the three acts before it charge the walk rather
   * than health, and every prop in them is damage-immune.
   */
  readonly defeatMessage = 'The show went on without you.';

  private frame = 0;
  private grimaldi: GrimaldiVine | null = null;
  private readonly targets = new Map<string, MazeBlockTarget>();
  private readonly bells = new Map<string, MazeBellTarget>();
  private readonly mirrors = new Map<string, MazeMirrorTarget>();

  /** Every tile a flame vent can light, for the "is this safe to stand on" question. */
  private readonly ventTiles = new Set(MAZE_VENTS.map((vent) => tileKeyOf(vent.tileX, vent.tileY)));
  private readonly clearedBlocks = new Set<string>();
  /** Frame each opened tile gave way on, so its art can flare and then settle. */
  private readonly openedFrames = new Map<string, number>();
  private readonly openedCurtains = new Set<string>();
  private readonly latchedStars = new Set<string>();

  /** The act the party is in. Only ever moves forward, and only through a curtain. */
  private currentSectionId: MazeSectionId = MAZE_SECTIONS[0].id;

  private readonly dressing: ReadonlyArray<Dressing>;
  private readonly actBoards: ReadonlyArray<ActBoard>;

  /**
   * The unbent spans of both limelights, computed once.
   *
   * They cannot move: a beam's first mirror is the first mirror on a ray that
   * never changes, and a mirror only ever turns in place. That is the whole
   * reason the hall is fair — the burning geometry is fixed however the players
   * aim the rest of the light.
   */
  private readonly hotBeamTiles: ReadonlyArray<MazeTile>;
  private readonly hotBeamKeys: ReadonlySet<string>;
  private beamPaths = new Map<MazeHalf, BeamPath>();
  private beamsDirty = true;

  /** Hazards stop for good once the cure lands — the tent has nothing left to defend. */
  private hazardsArmed = true;

  /** Frames left before another vent may be heard lighting. */
  private ventCueCooldown = 0;
  /** Frames left before another refused blow may be heard. */
  private refusalCueCooldown = 0;

  /** Frames left of the white-out a failed act paints. Drives nothing but the paint. */
  private flashFrames = 0;

  /**
   * The most recent frame context, so `renderUI` — which is handed only a
   * drawing surface — can still ask where the crawlers are standing.
   */
  private lastContext: SystemContext | null = null;

  private beat: CutsceneBeat | null = null;
  private beatFrame = 0;
  private cameraLerp = 0;
  /** How far the coils have let go while the last conversation runs. */
  private sagFrames = 0;
  private cameraLerpFrom: { x: number; y: number } | null = null;
  private approachFrom: { x: number; y: number } | null = null;

  private bannerTimer = BANNER_FRAMES;
  private bannerTitle = BIGTOP_ENTRY_BANNER;
  private bannerSubtitle: string | null = BIGTOP_ENTRY_SUBTITLE;

  private readonly dialog: QuestDialog;
  /**
   * Kept apart from the cure's box rather than shared with it, because the two
   * answer Escape in opposite ways: the cure may not be dismissed at all, and
   * this one is nothing but a dismissal.
   */
  private readonly interludeDialog: QuestDialog;

  /** Polled and cleared by the scene, which owns the door out. */
  exitPending = false;
  /**
   * Set when a reset has moved both crawlers, so the scene can re-anchor the
   * parked one. Without it the anchored follow drive walks whoever the player
   * is not holding straight back out toward the corridor they just failed.
   */
  partyResetPending = false;

  /** Cues raised by the script, drained by the scene's audio pass. */
  private readonly pendingSounds: Array<{ id: SoundId; volume?: number }> = [];

  constructor(
    private readonly map: GameMap,
    private readonly bus: EventBus,
    private readonly addMob: (mob: Mob) => void,
    private readonly progress: CircusQuestProgress,
    private readonly audio: AudioManager | null,
  ) {
    this.dialog = new QuestDialog(audio);
    this.interludeDialog = new QuestDialog(audio);
    this.hotBeamTiles = this.computeHotSpans();
    this.hotBeamKeys = new Set(this.hotBeamTiles.map((tile) => tileKeyOf(tile.x, tile.y)));
    this.dressing = buildBigTopDressing(bigTopWallAt(this.map));
    this.actBoards = buildActBoards();
    this.spawnFurniture();
    // Deliberately no `bossFightInitiated`: the tent is not scored as a boss
    // room, and the event is what hands the soundtrack to the boss-music table.
    this.audio?.playMusic('circus_battle', { fadeInMs: CIRCUS_BATTLE_FADE_IN_MS });
  }

  private spawnFurniture(): void {
    const grimaldi = new GrimaldiVine(MAZE_GRIMALDI_TILE.x, MAZE_GRIMALDI_TILE.y, TILE_SIZE);
    grimaldi.setMap(this.map);
    this.addMob(grimaldi);
    this.grimaldi = grimaldi;

    for (const block of MAZE_BLOCKS) {
      // The destructible presents the face the acting crawler approaches from,
      // which is whichever side of the dividing wall its own lane is on.
      const facing = block.propTile.x > block.grateTile.x ? 'east' : 'west';
      const target = new MazeBlockTarget(
        block.propTile.x,
        block.propTile.y,
        TILE_SIZE,
        block.kind,
        facing,
      );
      target.setMap(this.map);
      this.addMob(target);
      this.targets.set(block.id, target);
    }

    for (const bell of MAZE_BELLS) {
      const target = new MazeBellTarget(bell.tile.x, bell.tile.y, TILE_SIZE, bell.id);
      target.setMap(this.map);
      this.addMob(target);
      this.bells.set(bell.id, target);
    }

    for (const mirror of MAZE_MIRRORS) {
      const target = new MazeMirrorTarget(TILE_SIZE, mirror);
      target.setMap(this.map);
      this.addMob(target);
      this.mirrors.set(mirror.id, target);
    }
  }

  // ── Public surface consumed by BuildingInteriorScene ───────────────────────

  get isDialogOpen(): boolean {
    return this.dialog.isOpen || this.interludeDialog.isOpen;
  }

  advanceDialog(): boolean {
    return this.interludeDialog.advance() || this.dialog.advance();
  }

  /**
   * Escape closes an interlude box and refuses to close the cure's.
   *
   * The cure's dialog is one beat of a script that is holding both crawlers
   * still and waiting on the box to finish — dismissing it without finishing it
   * would leave the party locked in place with nothing left to advance, and no
   * way out of the finale at all. There is nothing to decline there anyway. An
   * act card or a reset notice is the opposite: nothing is waiting on it, the
   * party has already been moved, and it is pure explanation.
   */
  dismissDialog(): boolean {
    return this.interludeDialog.dismiss();
  }

  handleClick(mx: number, my: number): boolean {
    return this.interludeDialog.handleClick(mx, my) || this.dialog.handleClick(mx, my);
  }

  /**
   * True while the script owns both crawlers. The scene skips movement and
   * attack input entirely, the same way the spider quest's cutscene does.
   */
  get playerLocked(): boolean {
    return this.beat !== null && this.beat !== 'done';
  }

  /**
   * The maze is two people solving one room from opposite sides, so the party
   * may not be bundled back together: following would walk the idle crawler
   * into a corridor nobody is steering them through.
   */
  get followDisabled(): boolean {
    return true;
  }

  /** The point the camera holds, or null while the crawlers own it. */
  get cameraTargetOverride(): { x: number; y: number } | null {
    const grimaldi = this.grimaldi;
    if (grimaldi === null || !this.playerLocked) return null;
    const target = { x: grimaldi.x, y: grimaldi.y };
    const from = this.cameraLerpFrom;
    if (from === null || this.cameraLerp >= 1) return target;
    return {
      x: from.x + (target.x - from.x) * this.cameraLerp,
      y: from.y + (target.y - from.y) * this.cameraLerp,
    };
  }

  /** Sound cues raised since the last drain, oldest first. */
  drainSounds(): Array<{ id: SoundId; volume?: number }> {
    return this.pendingSounds.splice(0, this.pendingSounds.length);
  }

  private cue(id: SoundId, volume?: number): void {
    this.pendingSounds.push(volume === undefined ? { id } : { id, volume });
  }

  // ── Hazards ───────────────────────────────────────────────────────────────

  /**
   * Whether the act a row belongs to is the one currently being performed.
   *
   * An act the party has walked out of goes cold behind them: the house strikes
   * the set. Without it, a crawler who wandered back into the mirror hall during
   * the last act and stepped on the limelight would haul *both* of them forward
   * onto the finale's marks, mid-fight, with a scorch notice up — a reset that
   * teaches nothing and moves the party in the wrong direction.
   */
  private isCurrentAct(tileY: number): boolean {
    return sectionAtRow(tileY).id === this.currentSectionId;
  }

  private get liveVents(): ReadonlyArray<VentSchedule> {
    if (!this.hazardsArmed) return [];
    return MAZE_VENTS.filter((vent) => this.isCurrentAct(vent.tileY));
  }

  /** Whether the lanterns on this track are off the floor because a bell called them. */
  private trackIsHeld(trackId: string): boolean {
    const track = MAZE_SPOTLIGHTS.find((candidate) => candidate.id === trackId);
    if (track === undefined) return false;
    return this.bells.get(track.bellId)?.isHolding === true;
  }

  /** Every spotlight cell that is warming or lit this frame. */
  private *liveSpotlightCells(): Generator<{ cell: VentSchedule; lit: boolean }> {
    if (!this.hazardsArmed) return;
    for (const track of MAZE_SPOTLIGHTS) {
      if (this.trackIsHeld(track.id)) continue;
      for (const cell of track.cells) {
        if (!this.isCurrentAct(cell.tileY)) continue;
        const phase = ventPhaseAt(cell, this.frame);
        if (phase === 'idle') continue;
        yield { cell, lit: phase === 'flame' };
      }
    }
  }

  /**
   * The push out of anything lit or about to be, for companion steering.
   *
   * Every hazard in the tent answers here: a flame vent, an usher's lantern and
   * an unbent limelight span. A parked crawler left standing in one is a
   * companion the player has to babysit through a crossing they are not even
   * steering.
   */
  getHazardEscapeVector(x: number, y: number): { dx: number; dy: number } | null {
    const cx = x + TILE_SIZE * TILE_CENTRE;
    const cy = y + TILE_SIZE * TILE_CENTRE;
    const tileReach = TILE_SIZE * HAZARD_ESCAPE_RADIUS_TILES;
    let pushX = 0;
    let pushY = 0;
    let insideCount = 0;

    /** True when the point was inside this hazard's reach at all. */
    const repelFrom = (tileX: number, tileY: number): boolean => {
      const hazardCx = (tileX + TILE_CENTRE) * TILE_SIZE;
      const hazardCy = (tileY + TILE_CENTRE) * TILE_SIZE;
      const dx = cx - hazardCx;
      const dy = cy - hazardCy;
      const dist = Math.hypot(dx, dy);
      if (dist > tileReach) return false;
      if (dist === 0) {
        // Standing dead centre gives no direction of its own; anywhere is better.
        pushY -= 1;
        return true;
      }
      const weight = 1 - dist / tileReach;
      pushX += (dx / dist) * weight;
      pushY += (dy / dist) * weight;
      return true;
    };
    const repel = (tileX: number, tileY: number): void => {
      if (repelFrom(tileX, tileY)) insideCount++;
    };

    for (const vent of this.liveVents) {
      if (ventPhaseAt(vent, this.frame) === 'idle') continue;
      repel(vent.tileX, vent.tileY);
    }
    for (const { cell } of this.liveSpotlightCells()) repel(cell.tileX, cell.tileY);
    for (const tile of this.liveHotBeamTiles) repel(tile.x, tile.y);

    const magnitude = Math.hypot(pushX, pushY);
    // Two hazards either side cancel exactly, and a crawler between them is
    // still standing in both — so "no direction" is not the same as "safe".
    if (magnitude === 0) return insideCount > 0 ? { dx: 0, dy: -1 } : null;
    return { dx: pushX / magnitude, dy: pushY / magnitude };
  }

  /**
   * Every tile that is hazardous ground at some point in its cycle.
   *
   * Deliberately blind to which act is being performed, where the hazards
   * themselves are not.
   *
   * A parked crawler is left standing wherever this says is safe, and an anchor
   * outlives the curtain that retires the act around it. Scoping this to the
   * current act buys one tile of precision and gives up the invariant the gate
   * actually wants: a crawler is never parked on ground that lights in any act.
   */
  private isTrapGround(tileX: number, tileY: number): boolean {
    if (!this.hazardsArmed) return false;
    const key = tileKeyOf(tileX, tileY);
    if (this.ventTiles.has(key) || this.hotBeamKeys.has(key)) return true;
    return MAZE_SPOTLIGHTS.some((track) =>
      track.cells.some((cell) => cell.tileX === tileX && cell.tileY === tileY),
    );
  }

  /**
   * Where a crawler should be parked when the player hands them over.
   *
   * Their own position, unless that is ground a hazard claims — the anchored
   * follow drive walks a parked crawler back to their anchor over and over, and
   * an anchor inside a trap corridor is a crawler stepping into fire every time
   * it goes out. Returns a *world* position, so it can be handed straight to the
   * companion system as an anchor.
   */
  restingSpotFor(entity: Player): { x: number; y: number } {
    const { x: tileX, y: tileY } = tileOf(entity);
    if (!this.isTrapGround(tileX, tileY)) return { x: entity.x, y: entity.y };

    // Deliberately the *whole* rule: a crawler on ground that never lights is
    // left exactly where the player put them. Preferring somewhere roomier was
    // tried and backed out — every rest cell the maze teaches the player to
    // stand on (an alcove pocket, a dwell cell between two banks) sits one tile
    // off a hazard by construction, so "roomier" moved the crawler out of the
    // very spot the corridor was designed around, and sometimes across the fire
    // to get there.
    const seen = new Set<string>([tileKeyOf(tileX, tileY)]);
    const queue = [{ x: tileX, y: tileY }];
    for (const tile of queue) {
      if (!this.isTrapGround(tile.x, tile.y)) {
        return { x: tile.x * TILE_SIZE, y: tile.y * TILE_SIZE };
      }
      for (const [dx, dy] of RESTING_SPOT_NEIGHBOURS) {
        const next = { x: tile.x + dx, y: tile.y + dy };
        const key = tileKeyOf(next.x, next.y);
        if (seen.has(key) || !this.map.isWalkable(next.x, next.y)) continue;
        seen.add(key);
        queue.push(next);
      }
    }
    // Unreachable in the authored maze — every crossing opens onto ground that
    // never burns — so leaving them where they stand is the safe default.
    return { x: entity.x, y: entity.y };
  }

  /** What, if anything, is catching this crawler where they stand. */
  private hazardUnder(entity: Player): BurnoutCause | null {
    if (!this.hazardsArmed) return null;
    const { x: tileX, y: tileY } = tileOf(entity);
    for (const vent of this.liveVents) {
      if (vent.tileX !== tileX || vent.tileY !== tileY) continue;
      if (ventPhaseAt(vent, this.frame) === 'flame') return 'fire';
    }
    for (const { cell, lit } of this.liveSpotlightCells()) {
      if (lit && cell.tileX === tileX && cell.tileY === tileY) return 'spotlight';
    }
    const onHotSpan = this.liveHotBeamTiles.some((tile) => tile.x === tileX && tile.y === tileY);
    return onHotSpan ? 'limelight' : null;
  }

  private get currentSection(): MazeSection {
    const found = MAZE_SECTIONS.find((section) => section.id === this.currentSectionId);
    // `currentSectionId` only ever takes a value out of the same table.
    if (found === undefined)
      throw new Error(`unknown Big Top maze section ${this.currentSectionId}`);
    return found;
  }

  /**
   * Sends the whole party back to the top of the act, because one of them was
   * caught.
   *
   * No health changes hands. Both crawlers wake up on this act's marks and walk
   * it again, which is the only currency a timing puzzle can charge in without
   * eventually making itself unfinishable. Doors already opened stay open: a
   * failure teaches the crossing, and re-locking a counterweight somebody
   * already brought down would teach nothing but resentment.
   *
   * Both, not just the one who was caught. An act is solved by two people
   * standing in the right two places, and leaving the other crawler mid-crossing
   * while their partner restarts would hand the player a state neither of them
   * can walk out of.
   */
  private beginBurnout(ctx: SystemContext, cause: BurnoutCause): void {
    const section = this.currentSection;
    this.placeAtSpawn(ctx.human, section.humanSpawn);
    this.placeAtSpawn(ctx.cat, section.catSpawn);
    this.flashFrames = BURNOUT_FLASH_FRAMES;
    this.partyResetPending = true;
    // [STAND-IN] The llama's fireball burst is the library's closest thing to a
    // body going up, until a scorch-and-drop cue is sourced.
    this.cue('llama_fireball_explosion');
    this.interludeDialog.open(BURNOUT_DIALOGS[cause], () => undefined);
  }

  /**
   * Puts a crawler back on their mark and stops them dead.
   *
   * The momentum matters as much as the position: a crawler mid-knockback or
   * mid-attack arrives still carrying the frames they left with, and a shove
   * owed from a crossing two rooms away would spend itself walking them off the
   * tile they just woke up on.
   */
  private placeAtSpawn(entity: Player, tile: MazeTile): void {
    entity.x = tile.x * TILE_SIZE;
    entity.y = tile.y * TILE_SIZE;
    entity.knockbackFramesRemaining = 0;
    entity.isMoving = false;
  }

  /**
   * What is catching either crawler this frame, if anything.
   *
   * Deliberately not "which one": a reset moves both of them, so the identity
   * of whoever was careless is a fact with nothing downstream that wants it.
   */
  private hazardCatchingSomeone(ctx: SystemContext): BurnoutCause | null {
    if (ctx.human.isAlive) {
      const cause = this.hazardUnder(ctx.human);
      if (cause !== null) return cause;
    }
    if (ctx.cat.isAlive) return this.hazardUnder(ctx.cat);
    return null;
  }

  // ── Barriers, blocks and curtains ─────────────────────────────────────────

  private blockFor(id: string): MazeBlock {
    const block = MAZE_BLOCKS.find((candidate) => candidate.id === id);
    // Every id in `targets` came out of MAZE_BLOCKS a moment ago.
    if (block === undefined) throw new Error(`unknown Big Top maze block: ${id}`);
    return block;
  }

  private openTile(tile: MazeTile): void {
    // A barrier that opens is a tile light can now cross, so the beams have to
    // be re-walked even though no mirror moved.
    this.beamsDirty = true;
    this.openedFrames.set(tileKeyOf(tile.x, tile.y), this.frame);
    // Walkability is read off the live tile type, so opening a barrier is a
    // single write; only the painted art is cached, and that is what the dirty
    // mark is for.
    this.map.structure[tile.y][tile.x].type = SAWDUST_FLOOR;
    this.map.markTileDirty(tile.x, tile.y);
  }

  private openBarrier(block: MazeBlock): void {
    this.openTile(block.barrierTile);
    this.clearedBlocks.add(block.id);
    if (block.kind === 'brace') this.cue('wood_breaking_1');
    else this.cue('gate_opening');
    // Said out loud as well as drawn. The crawler this door was opened for is
    // the one the player is *not* holding, so the news has to survive the walk
    // back across the tent and the switch.
    this.showBanner(
      WAY_OPENED_BANNER,
      block.blocks === 'human' ? WAY_OPENED_FOR_CARL : WAY_OPENED_FOR_DONUT,
    );
  }

  private updateBlocks(): void {
    for (const [id, target] of this.targets) {
      if (!target.broken || this.clearedBlocks.has(id)) continue;
      this.openBarrier(this.blockFor(id));
    }
  }

  /** The first block of this lane that is still standing, if any. */
  private pendingBlockFor(half: MazeHalf): MazeBlock | null {
    return (
      MAZE_BLOCKS.find((block) => block.blocks === half && !this.clearedBlocks.has(block.id)) ??
      null
    );
  }

  /** The first block this lane can act on, if any. */
  private pendingActionFor(half: MazeHalf): MazeBlock | null {
    return (
      MAZE_BLOCKS.find((block) => block.clearedBy === half && !this.clearedBlocks.has(block.id)) ??
      null
    );
  }

  private halfOf(entity: Player, human: HumanPlayer): MazeHalf {
    return entity === human ? 'human' : 'cat';
  }

  /**
   * Lifts a pair of curtains once both crawlers are standing in their own room.
   *
   * The pair is what keeps the party in the same act. A curtain that opened for
   * whoever reached it first would let one crawler walk into an act the other
   * cannot follow them into, and the next reset would drop them on marks a wall
   * apart.
   */
  private updateCurtains(ctx: SystemContext): void {
    for (const curtain of MAZE_CURTAINS) {
      if (this.openedCurtains.has(curtain.id)) continue;
      const humanTile = tileOf(ctx.human);
      const catTile = tileOf(ctx.cat);
      if (!rectContains(curtain.humanRoom, humanTile.x, humanTile.y)) continue;
      if (!rectContains(curtain.catRoom, catTile.x, catTile.y)) continue;

      this.openedCurtains.add(curtain.id);
      this.openTile(curtain.humanBarrier);
      this.openTile(curtain.catBarrier);
      this.cue('gate_opening');
      this.currentSectionId = curtain.opens;
      this.showBanner(this.currentSection.banner, null);
      const card = ACT_CARDS[curtain.opens];
      if (card !== undefined) this.interludeDialog.open(card, () => undefined);
      return;
    }
  }

  private showBanner(title: string, subtitle: string | null): void {
    this.bannerTitle = title;
    this.bannerSubtitle = subtitle;
    this.bannerTimer = BANNER_FRAMES;
  }

  // ── The hall of mirrors ───────────────────────────────────────────────────

  /**
   * The span of each limelight that is still fire, worked out once.
   *
   * Traced with every mirror treated as opaque, which is exactly the span up to
   * the first mirror on the ray — and that mirror never moves, so neither does
   * the burning ground.
   */
  private computeHotSpans(): ReadonlyArray<MazeTile> {
    const hot: MazeTile[] = [];
    for (const half of ['human', 'cat'] as const) {
      const path = traceMazeBeam(half, () => null, this.isOpenTile);
      for (const step of path.steps) if (step.hot) hot.push(step.tile);
    }
    return hot;
  }

  /** The unbent limelight spans that are dangerous right now. */
  private get liveHotBeamTiles(): ReadonlyArray<MazeTile> {
    if (!this.hazardsArmed) return [];
    return this.hotBeamTiles.filter((tile) => this.isCurrentAct(tile.y));
  }

  /** Whether a beam can pass through this tile. Opened barriers let light by too. */
  private readonly isOpenTile = (tileX: number, tileY: number): boolean =>
    this.map.isWalkable(tileX, tileY);

  private refreshBeams(): void {
    if (!this.beamsDirty) return;
    this.beamsDirty = false;
    const facingOf = (mirrorId: string): MirrorFacing | null =>
      this.mirrors.get(mirrorId)?.facing ?? null;
    this.beamPaths = new Map([
      ['human', traceMazeBeam('human', facingOf, this.isOpenTile)],
      ['cat', traceMazeBeam('cat', facingOf, this.isOpenTile)],
    ]);
  }

  private updateMirrors(): void {
    for (const mirror of this.mirrors.values()) {
      if (!mirror.turnedThisFrame) continue;
      mirror.turnedThisFrame = false;
      this.beamsDirty = true;
      this.cue('hammer_strike');
    }
    this.refreshBeams();

    for (const star of MAZE_STARS) {
      if (this.latchedStars.has(star.id)) continue;
      const allOn = star.litBy.every((half) => this.beamPaths.get(half)?.starId === star.id);
      if (!allOn) continue;
      this.latchedStars.add(star.id);
      for (const tile of star.opens) this.openTile(tile);
      this.cue('objective_complete');
      this.cue('gate_opening');
      this.showBanner(WAY_OPENED_BANNER, WAY_OPENED_FOR_BOTH);
    }
  }

  /**
   * The refusal a blow gets when it is aimed at the other crawler's prop.
   *
   * Silently dropped, a missile that flies through a capstan reads as the game
   * having eaten the input; the cue and the name chip together say whose job it
   * is.
   */
  private noteRefusedBlows(): void {
    let refused = false;
    for (const prop of this.everyProp()) {
      if (!prop.refusedBlowThisFrame) continue;
      prop.refusedBlowThisFrame = false;
      refused = true;
    }
    if (this.refusalCueCooldown > 0) this.refusalCueCooldown--;
    if (!refused || this.refusalCueCooldown > 0) return;
    this.cue('error', REFUSAL_CUE_VOLUME);
    this.refusalCueCooldown = REFUSAL_CUE_COOLDOWN_FRAMES;
  }

  private *everyProp(): Generator<MazePropTarget> {
    yield* this.targets.values();
    yield* this.bells.values();
    yield* this.mirrors.values();
  }

  private updateBells(): void {
    for (const bell of this.bells.values()) {
      if (!bell.rangThisFrame) continue;
      bell.rangThisFrame = false;
      this.cue('massive_metal_hit');
    }
  }

  // ── The pour ──────────────────────────────────────────────────────────────

  private inChamber(entity: Player): boolean {
    const tile = tileOf(entity);
    return isInFinalChamber(tile.x, tile.y);
  }

  private bothInChamber(ctx: SystemContext): boolean {
    return this.inChamber(ctx.human) && this.inChamber(ctx.cat);
  }

  private canPour(ctx: SystemContext): boolean {
    const grimaldi = this.grimaldi;
    if (grimaldi === null || this.beat !== null) return false;
    return this.readyToPour(ctx) && this.humanIsAtTheVine(ctx);
  }

  private readyToPour(ctx: SystemContext): boolean {
    // The human does the pouring — it is Carl who has the conversation, and the
    // cat has no hands for a bottle.
    return (
      this.currentSectionId === 'finale' && ctx.active === ctx.human && this.bothInChamber(ctx)
    );
  }

  private humanIsAtTheVine(ctx: SystemContext): boolean {
    const grimaldi = this.grimaldi;
    if (grimaldi === null) return false;
    const dist = Math.hypot(grimaldi.x - ctx.human.x, grimaldi.y - ctx.human.y);
    return dist <= TILE_SIZE * POUR_RANGE_TILES;
  }

  /** Space / tap: walks Carl into the last conversation. Returns true when handled. */
  tryInteract(ctx: SystemContext): boolean {
    if (!this.canPour(ctx)) return false;
    this.beginLastConversation(ctx);
    return true;
  }

  /**
   * Both crawlers are in the ring and Carl has walked up to the pole.
   *
   * The conversation runs first and the bottle is the last line of it, because
   * the potion is not what cures him — being talked back into his own name is,
   * and the medicine only closes what the name opened. Fired on arrival rather
   * than automatically, so the beat the player has walked three acts to reach
   * stays in their hands.
   */
  private beginLastConversation(ctx: SystemContext): void {
    if (this.beat !== null) return;
    this.beat = 'dialog';
    this.beatFrame = 0;
    this.cameraLerp = 0;
    this.cameraLerpFrom = { x: ctx.active.x, y: ctx.active.y };
    this.bannerTimer = 0;
    this.cue('grimaldi_plant_moving_3');
    // The crawlers are captured rather than the frame context, which is rebuilt
    // every frame and long stale by the time the box closes.
    const human = ctx.human;
    const cat = ctx.cat;
    this.dialog.open(GRIMALDI_CURE_DIALOG, () => this.beginCure(human, cat));
  }

  private beginCure(human: HumanPlayer, cat: Player): void {
    // Taken from whichever pack has one — Signet hands the bottle to whoever
    // walked up to her, and that is not always the crawler who pours it.
    //
    // Spent if the party has one, but never required: the pour is a scripted act
    // of the story, and a quest that could dead-end on an empty pack is a quest
    // that eventually does.
    if (!human.inventory.removeOne(POUR_ITEM_ID)) cat.inventory.removeOne(POUR_ITEM_ID);
    this.cue('healing_potion');
    this.beat = 'approach';
    this.beatFrame = 0;
    this.approachFrom = { x: human.x, y: human.y };
  }

  // ── Frame update ──────────────────────────────────────────────────────────

  update(ctx: SystemContext): void {
    this.lastContext = ctx;
    this.frame++;
    if (this.bannerTimer > 0) this.bannerTimer--;
    if (this.flashFrames > 0) this.flashFrames--;

    this.updateBlocks();
    this.noteRefusedBlows();
    this.updateBells();
    this.updateMirrors();
    this.updateTargetPulses(ctx);

    if (this.beat !== null) {
      this.updateCutscene(ctx);
      return;
    }

    // The tent stops performing while an interlude box is up. The scene keeps
    // ticking this system through a dialog — the cure's script is what closes
    // its own box, so a bare halt there would strand the party — but an act card
    // and a reset notice are closed by the player, and everything below would
    // otherwise run behind one: a vent whooshes on the frame the box goes away
    // for fire that finished burning long before.
    if (this.interludeDialog.isOpen) return;

    this.updateCurtains(ctx);

    // Ahead of the ignition cue, so the frame a crawler is caught plays the
    // reset rather than one more whoosh from the vent that caught them.
    const caught = this.hazardCatchingSomeone(ctx);
    if (caught !== null) {
      this.beginBurnout(ctx, caught);
      return;
    }
    this.noteVentIgnition(ctx.active);
  }

  /**
   * Marks whatever each lane is currently being asked for, so its art pulses.
   *
   * One target per lane at a time: a room where four things glow is a room that
   * has told the player nothing.
   */
  private updateTargetPulses(ctx: SystemContext): void {
    const wanted = new Set<Mob>();
    for (const half of ['human', 'cat'] as const) {
      const block = this.pendingActionFor(half);
      if (block === null) continue;
      const target = this.targets.get(block.id);
      if (target !== undefined) wanted.add(target);
    }
    if (this.currentSectionId === 'menagerie' && ctx.active === ctx.cat) {
      const bell = this.nearestReadyBell(ctx.active);
      if (bell !== null) wanted.add(bell);
    }

    for (const target of this.targets.values()) target.pulsing = wanted.has(target);
    for (const bell of this.bells.values()) bell.pulsing = wanted.has(bell);
    for (const mirror of this.mirrors.values()) {
      mirror.pulsing =
        this.currentSectionId === 'mirrors' && this.latchedStars.size < MAZE_STARS.length;
    }
  }

  private nearestReadyBell(active: Player): MazeBellTarget | null {
    let best: MazeBellTarget | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const bell of this.bells.values()) {
      if (!bell.isReady) continue;
      const distance = Math.hypot(bell.x - active.x, bell.y - active.y);
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      best = bell;
    }
    return best;
  }

  /**
   * The ignition cue, for vents the crawler is actually near.
   *
   * Sixty-six vents on six clocks light about fifteen times a second between
   * them; played unconditionally that is a fireball whoosh every four frames,
   * most of it from the other lane where the player cannot even see the flame it
   * belongs to. Only what is close enough to matter is heard, and never twice
   * inside one breath.
   */
  private noteVentIgnition(active: Player): void {
    if (this.ventCueCooldown > 0) {
      this.ventCueCooldown--;
      return;
    }
    const reach = TILE_SIZE * VENT_CUE_RANGE_TILES;
    for (const vent of this.liveVents) {
      if (ventPhaseAt(vent, this.frame) !== 'flame') continue;
      if (ventPhaseAt(vent, this.frame - 1) === 'flame') continue;
      const dx = (vent.tileX + TILE_CENTRE) * TILE_SIZE - (active.x + TILE_SIZE * TILE_CENTRE);
      const dy = (vent.tileY + TILE_CENTRE) * TILE_SIZE - (active.y + TILE_SIZE * TILE_CENTRE);
      if (Math.hypot(dx, dy) > reach) continue;
      this.cue('llama_fireball', VENT_IGNITION_VOLUME);
      this.ventCueCooldown = VENT_CUE_COOLDOWN_FRAMES;
      return;
    }
  }

  private updateCutscene(ctx: SystemContext): void {
    const grimaldi = this.grimaldi;
    if (grimaldi === null) return;
    this.beatFrame++;
    if (this.cameraLerp < 1) {
      this.cameraLerp = Math.min(1, this.beatFrame / CS_CAMERA_LERP_FRAMES);
    }

    switch (this.beat) {
      case 'dialog': {
        // The dialog owns the beat; its completion pours the potion. The coils
        // let go underneath it, so the mass is already slumped by the time the
        // bottle comes out.
        this.advanceSag(grimaldi);
        break;
      }
      case 'approach': {
        this.advanceSag(grimaldi);
        const from = this.approachFrom;
        if (from !== null) {
          const walk = Math.min(1, this.beatFrame / CS_APPROACH_FRAMES);
          const stopShort = TILE_SIZE * CS_APPROACH_STOP_TILES;
          const dx = grimaldi.x - from.x;
          const dy = grimaldi.y - from.y;
          const dist = Math.hypot(dx, dy);
          const travel = Math.max(0, dist - stopShort);
          ctx.human.x = from.x + (dist === 0 ? 0 : (dx / dist) * travel * walk);
          ctx.human.y = from.y + (dist === 0 ? 0 : (dy / dist) * travel * walk);
        }
        if (this.beatFrame >= CS_APPROACH_FRAMES) {
          this.beat = 'cure';
          this.beatFrame = 0;
          this.cue('grimaldi_vine_taking_damage');
          this.cue('reviving_tone');
        }
        break;
      }
      case 'cure': {
        const cured = Math.min(1, this.beatFrame / CS_CURE_FRAMES);
        const flush =
          cured < CS_POTION_FLUSH_PEAK
            ? cured / CS_POTION_FLUSH_PEAK
            : (1 - cured) / (1 - CS_POTION_FLUSH_PEAK);
        grimaldi.poisonAmount = flush;
        grimaldi.cureAmount = cured;
        // Straightened out of however far the slump actually got, not out of a
        // presumed 1: a player who reads the conversation fast reaches the
        // bottle before the coils have finished letting go, and starting the
        // flourish from full sag would snap him down before lifting him.
        grimaldi.sagAmount = this.sagFraction * (1 - cured);
        if (this.beatFrame >= CS_CURE_FRAMES) {
          this.beat = 'freed';
          this.beatFrame = 0;
          this.dialog.open(GRIMALDI_FREED_DIALOG, () => this.leaveTheTent());
        }
        break;
      }
      case 'freed':
        // The dialog owns the beat; closing it walks the party out.
        break;
      case 'done':
      case null:
        break;
    }
  }

  /** How far the coils have let go, 0..1. */
  private get sagFraction(): number {
    return this.sagFrames / CS_SAG_BLOOM_FRAMES;
  }

  private advanceSag(grimaldi: GrimaldiVine): void {
    if (this.sagFrames < CS_SAG_BLOOM_FRAMES) this.sagFrames++;
    grimaldi.sagAmount = this.sagFraction;
  }

  private leaveTheTent(): void {
    this.beat = 'done';
    this.finishCure();
    this.exitPending = true;
  }

  private finishCure(): void {
    this.progress.stage = 'grimaldi_redeemed';
    // Everything goes cold at once: a vent still cycling behind a cured vine
    // would be the tent disagreeing with its own ending.
    this.hazardsArmed = false;
    this.bus.emit('objectiveComplete', { objectiveId: 'grimaldi_redeemed' });
    this.audio?.playMusic('circus_theme', { fadeInMs: CIRCUS_THEME_FADE_IN_MS });
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  /**
   * The room's own furniture, drawn under the crawlers: the dressing, the
   * grates, every barrier still shut, cold vent grilles and the warning on the
   * ones about to fire, the warm pools of a swinging lantern, and the cold half
   * of both limelights.
   */
  renderWorld(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.renderDressing(ctx, camX, camY);
    this.renderActBoards(ctx, camX, camY);
    this.renderBarriers(ctx, camX, camY);
    this.renderRopes(ctx, camX, camY);
    this.renderVents(ctx, camX, camY);
    this.renderSpotlightWarnings(ctx, camX, camY);
    this.renderMirrorHall(ctx, camX, camY);
  }

  private renderDressing(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const piece of this.dressing) {
      const x = piece.tile.x * TILE_SIZE - camX;
      const y = piece.tile.y * TILE_SIZE - camY;
      if (!isOnScreen(x, y, OVERHEAD_PROP_HEIGHT_TILES)) continue;
      switch (piece.kind) {
        case 'runner':
          drawRingMatRunner(ctx, x, y, TILE_SIZE, piece.owner);
          break;
        case 'footlight':
          drawFootlight(ctx, x, y, TILE_SIZE, this.frame + piece.seed);
          break;
        case 'archPost':
          drawActArchPost(ctx, x, y, TILE_SIZE, this.frame + piece.seed);
          break;
        case 'bleacher':
          drawBleacherDead(ctx, x, y, TILE_SIZE, piece.seed);
          break;
        case 'cage':
          drawMenagerieCage(ctx, x, y, TILE_SIZE, piece.seed);
          break;
        case 'mirrorGlass':
          drawMirrorHallGlass(ctx, x, y, TILE_SIZE, piece.seed, this.frame);
          break;
      }
    }
  }

  /** The act names, painted on the boards over the flaps and every arch. */
  private renderActBoards(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const board of this.actBoards) {
      const x = board.tile.x * TILE_SIZE - camX;
      const y = board.tile.y * TILE_SIZE - camY;
      // The board spills several tiles either side of its own, so the cull has
      // to be generous horizontally or it pops out while still half on screen.
      if (!isOnScreen(x, y, OVERHEAD_PROP_HEIGHT_TILES)) continue;
      drawActArchBoard(ctx, x, y, TILE_SIZE, board.label);
    }
  }

  private renderBarriers(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const block of MAZE_BLOCKS) {
      const grateX = block.grateTile.x * TILE_SIZE - camX;
      const grateY = block.grateTile.y * TILE_SIZE - camY;
      if (isOnScreen(grateX, grateY)) drawMazeGrate(ctx, grateX, grateY, TILE_SIZE);
      const barrierX = block.barrierTile.x * TILE_SIZE - camX;
      const barrierY = block.barrierTile.y * TILE_SIZE - camY;
      if (!isOnScreen(barrierX, barrierY)) continue;
      if (this.clearedBlocks.has(block.id)) {
        drawMazeWayOpen(ctx, barrierX, barrierY, TILE_SIZE, this.wayArtFor(block.barrierTile));
        continue;
      }
      if (block.section === 'menagerie')
        drawMazeCageGate(ctx, barrierX, barrierY, TILE_SIZE, this.frame);
      else if (block.kind === 'sandbag') drawMazeGate(ctx, barrierX, barrierY, TILE_SIZE);
      else drawMazeBarricade(ctx, barrierX, barrierY, TILE_SIZE);
    }

    for (const curtain of MAZE_CURTAINS) {
      const windowX = curtain.windowTile.x * TILE_SIZE - camX;
      const windowY = curtain.windowTile.y * TILE_SIZE - camY;
      if (isOnScreen(windowX, windowY)) drawMazeCurtainWindow(ctx, windowX, windowY, TILE_SIZE);
      const opened = this.openedCurtains.has(curtain.id);
      for (const tile of [curtain.humanBarrier, curtain.catBarrier]) {
        const x = tile.x * TILE_SIZE - camX;
        const y = tile.y * TILE_SIZE - camY;
        if (!isOnScreen(x, y)) continue;
        if (opened) drawMazeCurtainOpen(ctx, x, y, TILE_SIZE, this.wayArtFor(tile));
        else drawMazeCurtain(ctx, x, y, TILE_SIZE, this.frame);
      }
    }

    for (const star of MAZE_STARS) {
      const latched = this.latchedStars.has(star.id);
      for (const tile of star.opens) {
        const x = tile.x * TILE_SIZE - camX;
        const y = tile.y * TILE_SIZE - camY;
        if (!isOnScreen(x, y)) continue;
        if (latched) drawMazeWayOpen(ctx, x, y, TILE_SIZE, this.wayArtFor(tile));
        else if (star.id === 'star_twin') drawMazeExitDoor(ctx, x, y, TILE_SIZE, this.frame);
        else drawMazeActGate(ctx, x, y, TILE_SIZE, this.frame);
      }
    }
  }

  /** How an opened way should look this frame: quiet, unless it just gave way. */
  private wayArtFor(tile: MazeTile): MazeWayOpenArt {
    const openedAt = this.openedFrames.get(tileKeyOf(tile.x, tile.y));
    const age = openedAt === undefined ? WAY_FLARE_FRAMES : this.frame - openedAt;
    return { phase: this.frame, flare: Math.max(0, 1 - age / WAY_FLARE_FRAMES) };
  }

  /**
   * The rope from every gate-opening target to the gate it lifts.
   *
   * The single biggest comprehension fix in the tent: the player watches cause
   * travel to effect, over a pulley block set in the wall between the lanes,
   * instead of guessing which of four grey squares a counterweight belongs to.
   */
  private renderRopes(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const centre = (tile: MazeTile): { x: number; y: number } => ({
      x: (tile.x + TILE_CENTRE) * TILE_SIZE - camX,
      y: (tile.y + TILE_CENTRE) * TILE_SIZE - camY,
    });
    for (const block of MAZE_BLOCKS) {
      const from = centre(block.propTile);
      const pulley = centre(block.grateTile);
      const to = centre(block.barrierTile);
      if (
        !isOnScreen(pulley.x, pulley.y) &&
        !isOnScreen(from.x, from.y) &&
        !isOnScreen(to.x, to.y)
      ) {
        continue;
      }
      const target = this.targets.get(block.id);
      drawMazeRope(ctx, [from, pulley, to], {
        pulled: this.clearedBlocks.has(block.id) ? 1 : 1 - (target?.integrityFraction ?? 1),
        owner: MAZE_TARGET_OWNER[block.kind],
      });
    }
  }

  private renderVents(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const vent of MAZE_VENTS) {
      const x = vent.tileX * TILE_SIZE - camX;
      const y = vent.tileY * TILE_SIZE - camY;
      if (!isOnScreen(x, y)) continue;
      // The grille is architecture and stays whatever act it is; only the
      // warning belongs to a set that is still standing. A struck act glowing
      // behind the party would be the tent promising a hazard it has retired.
      drawFlameVentGrille(ctx, x, y, TILE_SIZE);
      if (!this.hazardsArmed || !this.isCurrentAct(vent.tileY)) continue;
      const telegraph = ventTelegraphProgress(vent, this.frame);
      if (telegraph > 0) drawFlameVentTelegraph(ctx, x, y, TILE_SIZE, telegraph);
    }
  }

  private renderSpotlightWarnings(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (!this.hazardsArmed) return;
    for (const track of MAZE_SPOTLIGHTS) {
      const held = this.trackIsHeld(track.id);
      for (const cell of track.cells) {
        if (!this.isCurrentAct(cell.tileY)) continue;
        const warm = held ? 0 : ventTelegraphProgress(cell, this.frame);
        if (!held && warm <= 0) continue;
        const x = cell.tileX * TILE_SIZE - camX;
        const y = cell.tileY * TILE_SIZE - camY;
        if (!isOnScreen(x, y)) continue;
        // A bought stretch of boards is marked in its own colour rather than
        // left as bare floor: the player has to be able to see what the ring
        // paid for, and it has to look nothing like the warning it replaced.
        if (held) drawSpotlightClear(ctx, x, y, TILE_SIZE, this.frame);
        else drawSpotlightWarm(ctx, x, y, TILE_SIZE, warm);
      }
    }
    for (const bell of this.bells.values()) {
      if (!bell.isHolding) continue;
      const x = bell.x - camX;
      const y = bell.y - camY;
      if (!isOnScreen(x, y)) continue;
      drawSpotlightDock(ctx, x, y, TILE_SIZE, bell.holdFraction, this.frame);
    }
  }

  private renderMirrorHall(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const projector of MAZE_PROJECTORS) {
      const x = projector.tile.x * TILE_SIZE - camX;
      const y = projector.tile.y * TILE_SIZE - camY;
      if (!isOnScreen(x, y)) continue;
      drawMazeLimelight(ctx, x, y, TILE_SIZE, projector.direction, this.frame);
    }
    for (const star of MAZE_STARS) {
      const x = star.tile.x * TILE_SIZE - camX;
      const y = star.tile.y * TILE_SIZE - camY;
      if (!isOnScreen(x, y)) continue;
      let on = 0;
      for (const half of star.litBy) {
        if (this.beamPaths.get(half)?.starId === star.id) on++;
      }
      const art: MazeStarArt = {
        phase: this.frame,
        litFraction: on / star.litBy.length,
        latched: this.latchedStars.has(star.id),
      };
      drawMazeStar(ctx, x, y, TILE_SIZE, art);
    }
    if (!this.hazardsArmed) return;
    for (const path of this.beamPaths.values()) {
      for (const step of path.steps) {
        if (step.hot) continue;
        const x = step.tile.x * TILE_SIZE - camX;
        const y = step.tile.y * TILE_SIZE - camY;
        if (!isOnScreen(x, y)) continue;
        drawMazeBeamTile(ctx, x, y, TILE_SIZE, {
          hot: false,
          heading: step.heading,
          phase: this.frame,
        });
      }
    }
  }

  /**
   * Everything that must sit over the crawlers: the fire itself, the lantern
   * beams, the white-hot span of a limelight, the vine's telegraphs, and the
   * chip naming whose job the pulsing target is.
   */
  renderEffects(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (!this.hazardsArmed) {
      this.renderNameChips(ctx, camX, camY);
      return;
    }
    for (const vent of this.liveVents) {
      const burn = ventFlameProgress(vent, this.frame);
      if (burn <= 0) continue;
      const x = vent.tileX * TILE_SIZE - camX;
      const y = vent.tileY * TILE_SIZE - camY;
      if (!isOnScreen(x, y, FLAME_COLUMN_HEIGHT_TILES)) continue;
      drawFlameVentColumn(ctx, x, y, TILE_SIZE, burn, ventFlamePhase(vent, this.frame));
    }

    for (const track of MAZE_SPOTLIGHTS) {
      if (this.trackIsHeld(track.id)) continue;
      for (const cell of track.cells) {
        if (!this.isCurrentAct(cell.tileY)) continue;
        const burn = ventFlameProgress(cell, this.frame);
        if (burn <= 0) continue;
        const x = cell.tileX * TILE_SIZE - camX;
        const y = cell.tileY * TILE_SIZE - camY;
        if (!isOnScreen(x, y, FLAME_COLUMN_HEIGHT_TILES)) continue;
        drawSpotlightBeam(ctx, x, y, TILE_SIZE, burn, this.frame);
      }
    }

    for (const path of this.beamPaths.values()) {
      for (const step of path.steps) {
        if (!step.hot || !this.isCurrentAct(step.tile.y)) continue;
        const x = step.tile.x * TILE_SIZE - camX;
        const y = step.tile.y * TILE_SIZE - camY;
        if (!isOnScreen(x, y)) continue;
        drawMazeBeamTile(ctx, x, y, TILE_SIZE, {
          hot: true,
          heading: step.heading,
          phase: this.frame,
        });
      }
    }

    this.renderNameChips(ctx, camX, camY);
  }

  private renderNameChips(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const chipFor = (mob: Mob, owner: MazeHalf): void => {
      const x = mob.x - camX;
      const y = mob.y - camY;
      if (!isOnScreen(x, y, OVERHEAD_PROP_HEIGHT_TILES)) return;
      drawTargetNameChip(ctx, x, y, TILE_SIZE, owner);
    };
    for (const target of this.targets.values()) {
      if (target.pulsing) chipFor(target, MAZE_TARGET_OWNER[target.kind]);
    }
    for (const bell of this.bells.values()) {
      if (bell.pulsing) chipFor(bell, MAZE_TARGET_OWNER[bell.kind]);
    }
  }

  /** Prompts and switch hints, in world space over whoever they are aimed at. */
  renderPrompts(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    ctxFrame: SystemContext,
  ): void {
    if (this.playerLocked) return;
    const active = ctxFrame.active;
    const half = this.halfOf(active, ctxFrame.human);

    if (this.canPour(ctxFrame)) {
      // Over the crawler rather than over him. Every other prompt in the game
      // hangs above the thing it names, but he is four tiles tall and his art
      // runs off the top of its own sprite — a prompt cleared of all that sits
      // near the top of the screen, nowhere near the eye, which is watching the
      // character it is telling to act. The room's other hints are on the
      // crawler for the same reason.
      drawInteractionPrompt(
        ctx,
        active.x - camX,
        active.y - camY - TILE_SIZE * HINT_LIFT_TILES,
        TILE_SIZE,
        'Pour health potion on Grimaldi',
      );
      return;
    }

    if (this.renderTargetPrompt(ctx, camX, camY, ctxFrame, half)) return;

    const blocked = this.pendingBlockFor(half);
    if (blocked !== null) {
      if (!this.withinTiles(active, blocked.blockedRestTile, BLOCK_HINT_RANGE_TILES)) return;
      this.drawSwitchHint(ctx, active, camX, camY, blocked);
      return;
    }

    if (
      this.currentSectionId === 'menagerie' &&
      this.renderCrossingHint(ctx, camX, camY, ctxFrame, half)
    ) {
      return;
    }
    if (this.currentSectionId !== 'finale') {
      this.renderCurtainHint(ctx, camX, camY, ctxFrame, half);
      return;
    }
    if (!this.inChamber(active)) return;
    if (!this.bothInChamber(ctxFrame)) {
      const waitingFor = half === 'human' ? 'Donut' : 'Carl';
      this.drawWorldHint(
        ctx,
        active,
        camX,
        camY,
        `${waitingFor} has to be here too. Press ${this.switchControlLabel()} to switch.`,
      );
      return;
    }
    if (half === 'cat') {
      this.drawWorldHint(
        ctx,
        active,
        camX,
        camY,
        `Carl has the potion. Press ${this.switchControlLabel()} to switch.`,
      );
    }
  }

  /** The prompt over whichever prop this lane can act on right now. */
  private renderTargetPrompt(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    ctxFrame: SystemContext,
    half: MazeHalf,
  ): boolean {
    const active = ctxFrame.active;
    // The chip is a property of the prop rather than of whatever the crawler
    // happens to be holding. Both of a crawler's answers land on every prop
    // they own — the tables are derived from ownership, so a stone and a swing
    // are equally good — which leaves the chip free to say the thing the prop
    // is *for*: a ring wants shooting, a capstan wants turning.
    const draw = (mob: Mob, prompt: string, chip: string): boolean => {
      drawInteractionPrompt(ctx, mob.x - camX, mob.y - camY, TILE_SIZE, prompt, chip);
      return true;
    };

    if (this.currentSectionId === 'mirrors') {
      const mirror = this.nearestMirror(active, half);
      if (mirror !== null && this.withinMobTiles(active, mirror, TARGET_PROMPT_RANGE_TILES)) {
        return mirror.kind === 'pivot_mirror'
          ? draw(mirror, 'Knock the mirror round', CHIP_HIT)
          : draw(mirror, 'Flip the far mirror', CHIP_SHOOT);
      }
    }

    const actionable = this.pendingActionFor(half);
    if (
      actionable !== null &&
      this.withinTiles(active, actionable.propTile, TARGET_PROMPT_RANGE_TILES)
    ) {
      const target = this.targets.get(actionable.id);
      if (target !== undefined && !target.broken) {
        return draw(target, BLOCK_PROMPTS[actionable.kind], BLOCK_CHIPS[actionable.kind]);
      }
    }

    if (this.currentSectionId === 'menagerie' && half === 'cat') {
      const bell = this.nearestReadyBell(active);
      if (bell !== null && this.withinMobTiles(active, bell, TARGET_PROMPT_RANGE_TILES)) {
        return draw(bell, 'Ring the show-bell', CHIP_SHOOT);
      }
    }
    return false;
  }

  private nearestMirror(active: Player, half: MazeHalf): MazeMirrorTarget | null {
    let best: MazeMirrorTarget | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const mirror of this.mirrors.values()) {
      if (MAZE_TARGET_OWNER[mirror.kind] !== half) continue;
      const distance = Math.hypot(mirror.x - active.x, mirror.y - active.y);
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      best = mirror;
    }
    return best;
  }

  /**
   * What to do about the lanterns, said while the crawler is standing where the
   * question is being asked.
   *
   * The menagerie shipped teaching neither of its two answers, and playtesters
   * stopped at its first crossing without discovering either. Both are named
   * here, at the threshold, in the same over-the-head channel every other hint
   * in the tent uses — because a mechanic explained once on an act card is a
   * mechanic explained to somebody who has not yet met the problem.
   */
  private renderCrossingHint(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    ctxFrame: SystemContext,
    half: MazeHalf,
  ): boolean {
    const active = ctxFrame.active;
    const activeTile = tileOf(active);
    for (const crossing of MAZE_SPOTLIGHT_CROSSINGS) {
      const track = MAZE_SPOTLIGHTS.find((candidate) => candidate.id === crossing.trackId);
      if (track?.half !== half) continue;
      const threshold = crossing.route[0];
      if (Math.abs(activeTile.x - threshold.x) > CROSSING_HINT_RANGE_TILES) continue;
      if (activeTile.y !== threshold.y) continue;
      if (this.trackIsHeld(track.id)) return false;
      this.drawWorldHint(
        ctx,
        active,
        camX,
        camY,
        half === 'cat'
          ? 'Ring the show-bell to clear the boards, or wait in the alcoves.'
          : `Donut's bell clears the boards. Otherwise, wait in the alcoves.`,
      );
      return true;
    }
    return false;
  }

  /** The nudge toward the interval, once this act has nothing left to open. */
  private renderCurtainHint(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    ctxFrame: SystemContext,
    half: MazeHalf,
  ): void {
    const curtain = MAZE_CURTAINS.find((candidate) => !this.openedCurtains.has(candidate.id));
    if (curtain === undefined) return;
    const active = ctxFrame.active;
    const activeTile = tileOf(active);
    const room = half === 'human' ? curtain.humanRoom : curtain.catRoom;
    if (!rectContains(room, activeTile.x, activeTile.y)) return;
    const waitingFor = half === 'human' ? 'Donut' : 'Carl';
    this.drawWorldHint(
      ctx,
      active,
      camX,
      camY,
      `${waitingFor} has to be here too. Press ${this.switchControlLabel()} to switch.`,
    );
  }

  private withinTiles(entity: Player, tile: MazeTile, rangeTiles: number): boolean {
    const dx = tile.x * TILE_SIZE - entity.x;
    const dy = tile.y * TILE_SIZE - entity.y;
    return Math.hypot(dx, dy) <= TILE_SIZE * rangeTiles;
  }

  private withinMobTiles(entity: Player, mob: Mob, rangeTiles: number): boolean {
    return Math.hypot(mob.x - entity.x, mob.y - entity.y) <= TILE_SIZE * rangeTiles;
  }

  /** On a touch screen there is no key to name, so the on-screen control is. */
  private switchControlLabel(): string {
    return platform.isMobile ? 'the switch button' : `[${keybindings.labelFor('switchCharacter')}]`;
  }

  private drawSwitchHint(
    ctx: CanvasRenderingContext2D,
    active: Player,
    camX: number,
    camY: number,
    blocked: MazeBlock,
  ): void {
    const control = this.switchControlLabel();
    const thing = BLOCK_THING_NAMES[blocked.kind];
    this.drawWorldHint(
      ctx,
      active,
      camX,
      camY,
      blocked.blocks === 'human'
        ? `Donut can reach that ${thing}. Press ${control} to switch.`
        : `Carl can break that ${thing}. Press ${control} to switch.`,
    );
  }

  private drawWorldHint(
    ctx: CanvasRenderingContext2D,
    active: Player,
    camX: number,
    camY: number,
    line: string,
  ): void {
    drawText(ctx, line, {
      x: active.x - camX + TILE_SIZE * TILE_CENTRE,
      y: active.y - camY - TILE_SIZE * HINT_LIFT_TILES,
      size: HINT_SIZE,
      bold: true,
      color: HINT_COLOR,
      align: 'center',
      outline: HINT_OUTLINE,
    });
  }

  /**
   * What the tent is asking for, in the act it is asking it in.
   *
   * Rebuilt every frame from what is actually still standing rather than left
   * as one line, because "bring both of you to the pole" reads as a bug once
   * both of them plainly are at it.
   */
  private currentObjective(): { line: string; done: boolean } {
    const section = this.currentSectionId;
    if (section === 'finale') {
      const ctx = this.lastContext;
      if (ctx === null || !this.bothInChamber(ctx)) {
        return { line: 'The chamber is open. Bring both of you to the pole.', done: false };
      }
      return { line: 'Carl has the potion. Pour it over him.', done: false };
    }

    if (section === 'mirrors') {
      const dark = MAZE_STARS.length - this.latchedStars.size;
      if (dark > 0) {
        return {
          line: `Bend the light: ${dark} of ${MAZE_STARS.length} stars still dark`,
          done: false,
        };
      }
      return { line: this.nextBanner(), done: true };
    }

    const blocks = MAZE_BLOCKS.filter((block) => block.section === section);
    const barred = blocks.filter((block) => !this.clearedBlocks.has(block.id)).length;
    if (barred === 0) return { line: this.nextBanner(), done: true };
    const line =
      section === 'firewalk'
        ? `Open the way: ${barred} of ${blocks.length} still barred`
        : `Cross the menagerie: ${barred} of ${blocks.length} cages still barred`;
    return { line, done: false };
  }

  /** The act waiting past the curtain, named by its own banner. */
  private nextBanner(): string {
    const index = MAZE_SECTIONS.findIndex((section) => section.id === this.currentSectionId);
    return MAZE_SECTIONS[index + 1]?.banner ?? ACT_ONE_BANNER;
  }

  renderUI(ctx: CanvasRenderingContext2D): void {
    // Under the boxes rather than over them: the white-out is the room going
    // white, and a message printed behind its own flash cannot be read.
    if (this.flashFrames > 0) {
      drawOverlay(ctx, {
        canvasWidth: viewportWidth(),
        canvasHeight: viewportHeight(),
        color: BURNOUT_FLASH_COLOR,
        alpha: (this.flashFrames / BURNOUT_FLASH_FRAMES) * BURNOUT_FLASH_PEAK_ALPHA,
      });
    }
    this.dialog.render(ctx);
    this.interludeDialog.render(ctx);

    if (this.bannerTimer > 0) {
      const alpha =
        this.bannerTimer < BANNER_FADE_FRAMES ? this.bannerTimer / BANNER_FADE_FRAMES : 1;
      drawText(ctx, this.bannerTitle, {
        x: viewportWidth() / 2,
        y: BANNER_TITLE_Y,
        size: BANNER_TITLE_SIZE,
        bold: true,
        color: BANNER_TITLE_COLOR,
        align: 'center',
        alpha,
        glow: BANNER_TITLE_GLOW,
        glowBlur: BANNER_GLOW_BLUR,
      });
      const subtitle = this.bannerSubtitle;
      if (subtitle !== null) {
        drawText(ctx, subtitle, {
          x: viewportWidth() / 2,
          y: BANNER_SUBTITLE_Y,
          size: BANNER_SUBTITLE_SIZE,
          color: BANNER_SUBTITLE_COLOR,
          align: 'center',
          alpha,
        });
      }
    }

    if (this.beat !== null || this.isDialogOpen) return;
    const objective = this.currentObjective();
    drawText(ctx, objective.line, {
      x: viewportWidth() / 2,
      y: viewportHeight() - OBJECTIVE_Y_FROM_BOTTOM,
      size: OBJECTIVE_SIZE,
      bold: true,
      color: objective.done ? OBJECTIVE_DONE_COLOR : OBJECTIVE_PENDING_COLOR,
      align: 'center',
    });
  }
}

/**
 * What the house calls out when a barrier gives way.
 *
 * The banner rather than a world hint, because the hint channel sits over the
 * *active* crawler and the crawler this concerns is the other one.
 */
const WAY_OPENED_BANNER = 'The way is open';
const WAY_OPENED_FOR_CARL = 'Switch to Carl and walk through.';
const WAY_OPENED_FOR_DONUT = 'Switch to Donut and walk through.';
const WAY_OPENED_FOR_BOTH = 'Both lanes can go on.';

/** How loud a vent's ignition is against the rest of the tent. */
const VENT_IGNITION_VOLUME = 0.35;

/** A refused blow says so once, quietly, however fast the missiles arrive. */
const REFUSAL_CUE_VOLUME = 0.5;
const REFUSAL_CUE_COOLDOWN_FRAMES = 24;

/**
 * What the chip asks for.
 *
 * `SHOOT` on everything the gold hoop marks and `HIT` on everything the brass
 * chevrons do — the same two-colour language the props themselves are painted
 * in, said again in a word, so a player who has learned the palette is never
 * told two different things about the same prop.
 */
const CHIP_SHOOT = 'SHOOT';
const CHIP_HIT = 'HIT';

const BLOCK_CHIPS: Readonly<Record<MazeBlock['kind'], string>> = {
  sandbag: CHIP_SHOOT,
  brace: CHIP_HIT,
  release_ring: CHIP_SHOOT,
  capstan: CHIP_HIT,
};

const BLOCK_PROMPTS: Readonly<Record<MazeBlock['kind'], string>> = {
  sandbag: 'Bring down the counterweight',
  brace: 'Break the brace',
  release_ring: 'Shoot the release ring',
  capstan: 'Turn the capstan',
};

const BLOCK_THING_NAMES: Readonly<Record<MazeBlock['kind'], string>> = {
  sandbag: 'counterweight',
  brace: 'brace',
  release_ring: 'release ring',
  capstan: 'capstan',
};

/**
 * Where the tent may hang something on the wall, for a given map.
 *
 * Exported and shared with the maze's gate rather than restated there. The
 * predicate is the whole rule — a gate that wrote its own copy of it would go
 * on passing while the game supplied a broken one, which is the failure the
 * check exists to catch.
 *
 * A barrier is wall until it is opened, and anything hung on one would survive
 * the opening, so a barrier counts as floor from the start. Safe to evaluate
 * once at construction: `openTile` is the only thing that ever makes a tile of
 * this map walkable, and it only ever writes barriers.
 */
export function bigTopWallAt(map: GameMap): (tileX: number, tileY: number) => boolean {
  return (tileX, tileY) => !map.isWalkable(tileX, tileY) && !isMazeBarrierTile(tileX, tileY);
}

/**
 * The trail, worked out once from the same tables the traps are authored in.
 *
 * A ring-mat runner down every route the party is meant to walk, footlights
 * along it, striped posts either side of each curtain, and the act's own
 * dressing on the walls that bound it. All of it is paint: nothing here changes
 * where anybody can stand — which is exactly why the wall-hung half of it has to
 * be told where the walls are, and is asserted by the maze's own gate.
 *
 * Exported for that gate. A cage front, a bleacher or a pane of glass on ground
 * the party has to walk is the same failure the opened-door art was written to
 * fix: floor that reads as barred. The strides that place them run along a lane
 * counting tiles, and a stride knows nothing about the doorways and connecting
 * shafts cut through the wall it is walking.
 */
export function buildBigTopDressing(
  isWall: (tileX: number, tileY: number) => boolean,
): ReadonlyArray<Dressing> {
  const pieces: Dressing[] = [];
  const seenRunner = new Set<string>();
  let runnerIndex = 0;

  const addRunner = (tile: MazeTile, owner: MazeHalf): void => {
    const key = tileKeyOf(tile.x, tile.y);
    if (seenRunner.has(key)) return;
    seenRunner.add(key);
    pieces.push({ tile, kind: 'runner', owner, seed: runnerIndex });
    if (runnerIndex % FOOTLIGHT_STRIDE === 0) {
      pieces.push({ tile, kind: 'footlight', owner, seed: runnerIndex });
    }
    runnerIndex++;
  };

  /** Wall-hung dressing, refused wherever the wall turns out to be a way through. */
  const hangOnWall = (tile: MazeTile, kind: DressingKind, owner: MazeHalf, seed: number): void => {
    if (!isWall(tile.x, tile.y)) return;
    pieces.push({ tile, kind, owner, seed });
  };

  for (const corridor of MAZE_CORRIDORS) {
    for (const tile of corridor.route) addRunner(tile, corridor.half);
  }
  for (const crossing of MAZE_SPOTLIGHT_CROSSINGS) {
    const track = MAZE_SPOTLIGHTS.find((candidate) => candidate.id === crossing.trackId);
    if (track === undefined) continue;
    for (const tile of crossing.route) addRunner(tile, track.half);
  }

  // Straight through every barrier, so an opened door has the trail running
  // under it rather than a tile of bare sawdust the runner stops either side of.
  for (const block of MAZE_BLOCKS) addRunner(block.barrierTile, block.blocks);

  for (const curtain of MAZE_CURTAINS) {
    for (const [barrier, owner] of [
      [curtain.humanBarrier, 'human'],
      [curtain.catBarrier, 'cat'],
    ] as const) {
      addRunner(barrier, owner);
      hangOnWall({ x: barrier.x - 1, y: barrier.y }, 'archPost', owner, 0);
      hangOnWall({ x: barrier.x + 1, y: barrier.y }, 'archPost', owner, 1);
    }
  }

  // A doorway needs a clear tile of wall either side of it to read as a doorway.
  // The cage fronts are near-identical to a shut cage gate by design, and one
  // hung against a jamb puts that art within a tile of the opening — which is
  // half of how an opened gate went on reading as barred in the first place.
  const doorwayColumns = new Set(
    MAZE_BLOCKS.filter((block) => block.section === 'menagerie').flatMap((block) => [
      block.barrierTile.x - 1,
      block.barrierTile.x,
      block.barrierTile.x + 1,
    ]),
  );

  for (const lane of MENAGERIE_LANES) {
    for (let x = lane.x0; x <= lane.x1; x++) {
      const alongLane = x - lane.x0;
      if (alongLane % BLEACHER_STRIDE === 0) {
        hangOnWall({ x, y: MENAGERIE_BLEACHER_ROW }, 'bleacher', lane.half, x);
      }
      if (alongLane % CAGE_STRIDE !== 0 || doorwayColumns.has(x)) continue;
      for (const y of MENAGERIE_CAGE_ROWS) {
        hangOnWall({ x, y }, 'cage', lane.half, x * y);
      }
    }
  }

  const dividerColumn = MAZE_STARS[0].tile.x;
  for (const column of MIRROR_HALL_GLASS_COLUMNS) {
    for (let y = MIRROR_HALL_ROWS.y0; y <= MIRROR_HALL_ROWS.y1; y += MIRROR_GLASS_STRIDE) {
      hangOnWall(
        { x: column, y },
        'mirrorGlass',
        column < dividerColumn ? 'human' : 'cat',
        column * y,
      );
    }
  }

  return pieces;
}

/**
 * A board over the flaps naming the fire walk, and one over every arch naming
 * the act behind it.
 *
 * The banner that flashes when a curtain lifts is gone in five seconds; the
 * board stays up, so a player who walked away and came back can still find out
 * which act they are in by looking at the room.
 */
function buildActBoards(): ReadonlyArray<ActBoard> {
  const boards: ActBoard[] = [
    { tile: { x: ACT_BOARD_COLUMN, y: ACT_ONE_BOARD_ROW }, label: MAZE_SECTIONS[0].banner },
  ];
  for (const curtain of MAZE_CURTAINS) {
    const section = MAZE_SECTIONS.find((candidate) => candidate.id === curtain.opens);
    if (section === undefined) continue;
    boards.push({
      tile: { x: ACT_BOARD_COLUMN, y: curtain.humanBarrier.y },
      label: section.banner,
    });
  }
  return boards;
}
