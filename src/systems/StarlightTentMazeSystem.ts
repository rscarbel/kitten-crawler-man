/**
 * StarlightTentMazeSystem — the Starlight Tent's interior, a performance in three acts.
 *
 * The human and the cat come in through two flaps into two sealed lanes and
 * walk the fire walk, the menagerie and the hall of mirrors, meeting only in
 * the paired curtain rooms between acts — where both of them have to be
 * standing before either curtain lifts — and at last in the centre ring. Every
 * act puts doors in one lane that only the other lane can open.
 *
 * Failing an act costs no health. The house hauls both crawlers back to the top
 * of the act they were in, with every curtain, cage gate and lit star they had
 * already earned still open — which is the only currency a timing puzzle can
 * charge in without eventually making itself unfinishable.
 *
 * Owned by `BuildingInteriorScene`, which supplies the roster. All state is
 * scene-local and rebuilt from scratch on every entry: the maze holds nothing
 * across the door, so leaving mid-run and coming back starts it over.
 */

import { crawlerName } from '../characters/characters';
import { TILE_SIZE } from '../core/constants';
import type { GameMap } from '../map/GameMap';
import type { MusicClaims } from '../audio/AudioScope';
import type { SoundId } from '../audio/sounds';
import {
  STARLIGHT_TENT_BLOCK_CLEARED_CUES,
  STARLIGHT_TENT_CUES,
  STARLIGHT_TENT_MUSIC,
} from './starlightTent/starlightTentSoundCues';
import type { GameSystem, SystemContext } from './GameSystem';
import type { GroundHazardSource } from './GroundHazardSource';
import type { Mob } from '../creatures/Mob';
import type { Player } from '../Player';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { StarlightTentProgress } from '../core/state/StarlightTentProgress';
import type { Difficulty } from '../core/difficulty/difficultyProfiles';
import { MazeBlockTarget } from '../creatures/MazeBlockTarget';
import type { MazePropTarget } from '../creatures/MazePropTarget';
import { MazeBellTarget } from '../creatures/MazeBellTarget';
import { MazeMirrorTarget } from '../creatures/MazeMirrorTarget';
import type { Conversation } from '../dialog/Conversation';
import type { ConversationHandle } from '../dialog/request';
import type { DialogLine, NonEmpty } from '../dialog/line';
import { drawInteractionPromptOver } from '../ui/InteractionPrompt';
import { worldText } from '../ui/world/worldText';
import { worldTint } from '../ui/world/worldShapes';
import { worldPalette } from '../ui/theme/worldInk';
import { activeInputMode, byInputMode, keycapLabel } from '../ui/core/inputMode';
import { objectiveBandEntry } from '../ui/hud/objectiveLine';
import { viewportWidth, viewportHeight } from '../core/rendering/Viewport';
import {
  drawActArchPost,
  drawFlameVentColumn,
  drawFootlight,
  drawMazeActGate,
  drawMazeExitDoor,
  drawMazeWayOpen,
  type MazeWayOpenArt,
  drawRingMatRunner,
  drawSpotlightBeam,
  drawSpotlightClear,
  drawSpotlightDock,
  drawSpotlightWarm,
  drawTargetNameChip,
} from '../sprites/starlightTentMazeProps';
import { drawIntervalRoomLamp } from '../sprites/art/starlightTent/starlightTentShellArt';
import { clearStarlightTentPropCache } from '../sprites/art/starlightTent/starlightTentPropCache';
import {
  allocCanvas,
  releaseSurface,
  surfaceContext,
  type CanvasSurface,
} from '../core/rendering/canvasSurface';
import {
  drawMirrorHallPane,
  drawPaneReflection,
  clearReflectionScratch,
  paintReflectionSource,
  type ReflectionSource,
} from '../sprites/art/starlightTent/mirrorHallProps';
import {
  drawActEasel,
  drawMazeCurtain,
  drawMazeCurtainOpen,
  drawMazeCurtainWindow,
} from '../sprites/art/starlightTent/curtainProps';
import { drawRingBleacher, RING_BLEACHER_TIERS } from '../sprites/art/starlightTent/finaleProps';
import { backstageClutterAt } from '../sprites/art/starlightTent/starlightTentShellArt';
import {
  FIRE_WALK_WALL_KITS,
  drawBoardedFlat,
  drawFireBreatherGrateRun,
  fireGrateRuns,
  drawFireBreatherTelegraph,
  drawFireScreenGate,
  drawFireWalkWallKit,
  drawHeatShimmerFlare,
  drawPulleyGrate,
  drawShadedRope,
  type FireWalkWallKit,
} from '../sprites/art/starlightTent/fireWalkProps';
import {
  CAGE_LUNGE_DURATION_FRAMES,
  FOLLOW_SPOT_LENS_REACH,
  FOLLOW_SPOT_PIVOT,
  cageOccupantFor,
  drawBleacherSpectator,
  drawCageGateBarrier,
  drawFeedTrough,
  drawFollowSpotCone,
  drawFollowSpotLamp,
  drawMenagerieCageFront,
  occupantLunges,
} from '../sprites/art/starlightTent/menagerieProps';
import {
  ACT_ONE_BANNER,
  STARLIGHT_TENT_ENTRY_BANNER,
  STARLIGHT_TENT_ENTRY_SUBTITLE,
  BURNOUT_FLASH_FRAMES,
  isMazeBarrierTile,
  MAZE_BELLS,
  MAZE_BLOCKS,
  MAZE_WIDTH,
  MAZE_CORRIDORS,
  MAZE_CURTAINS,
  MAZE_ENCORE_REWARD_COINS,
  MAZE_FINAL_CHAMBER,
  MENAGERIE_BLEACHER_ROW,
  MENAGERIE_CAGE_ROWS,
  MENAGERIE_LANES,
  MIRROR_HALL_GLASS_COLUMNS,
  MIRROR_HALL_ROWS,
  MAZE_HALL_EXITS,
  MIRROR_BOARD_ROWS,
  TEACHING_STRIP_ROWS,
  MAZE_HALVES,
  MAZE_SECTIONS,
  MAZE_SPOTLIGHT_CROSSINGS,
  MAZE_SPOTLIGHTS,
  MAZE_TARGET_OWNER,
  MAZE_TEACHING_DOORWAYS,
  MAZE_VENTS,
  rectContains,
  sectionAtRow,
  starFootTile,
  TEACHING_STRIP_BOARD,
  teachingTileToTent,
  tentMirrorsOf,
  ventFlameProgress,
  ventPhaseAt,
  ventTelegraphProgress,
  type MazeBlock,
  type MazeHalf,
  type MazeRect,
  type MazeSection,
  type StarlightTentMazePlan,
  type MazeSectionId,
  type MazeMirror,
  type MazeTile,
  type SpotlightTrack,
  type VentPhase,
  type VentSchedule,
} from '../map/starlightTentMazeLayout';
import { boardTileToTent, type MirrorBoard } from '../map/starlightTent/mirrorBoard';
import {
  clearDifficultyChangeGuard,
  registerDifficultyChangeGuard,
  type DifficultyGuardHandle,
} from '../core/difficulty/difficultyChangeGuard';
import { settings } from '../core/input/Settings';
import { isOnScreen } from './starlightTent/tentView';
import { placeOnMark } from './starlightTent/starlightTentRestart';
import type { InteriorFigure } from '../core/rendering/InteriorFigure';
import type { StarlightTentFinale } from './starlightTent/StarlightTentFinale';
import {
  MirrorHall,
  type HallBoardId,
  type HallChanges,
  type MazeTurnPreview,
} from './starlightTent/MirrorHall';
import {
  STARLIGHT_TENT_ACT_TWO_CARD,
  STARLIGHT_TENT_ACT_THREE_CARD,
  STARLIGHT_TENT_BURNOUT_FIRE,
  STARLIGHT_TENT_BURNOUT_LIMELIGHT,
  STARLIGHT_TENT_BURNOUT_SPOTLIGHT,
} from '../dialog/scripts/scenes/starlightTent';
import { SAWDUST_FLOOR } from '../map/tileTypes';
import { BACKSTAGE_CLUTTER_CLEARANCE_TILES } from '../map/starlightTentMazeDecor';
import {
  StarlightTentLighting,
  layoutLightFixtures,
  type LightFixture,
  type LiveLights,
  type StageCue,
} from './starlightTent/starlightTentLighting';
import { questBannerEntry } from '../ui/QuestBanners';
import type { TopBandEntry } from '../ui/hud/topBand';

const FRAMES_PER_SECOND = 60;

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
const BURNOUT_FLASH_PEAK_ALPHA = 0.92;

const BANNER_SECONDS = 5;
const BANNER_FRAMES = BANNER_SECONDS * FRAMES_PER_SECOND;

/** World-space hint text sits this far above the crawler's head. */
const HINT_LIFT_TILES = 1.6;
const HINT_SIZE = 11;

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

/** How near a vent has to be for its kindling or ignition to be worth hearing. */
const VENT_CUE_RANGE_TILES = 9;
/** How long a vent cue rests before another vent may claim it. */
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

/** The act the party plays together: the ring, where the troupe's guards come out. */
const FIGHTING_ACT = 'finale' as const satisfies MazeSectionId;

// ── Dressing ──────────────────────────────────────────────────────────────────

/** One in this many runner tiles carries a footlight. */
const FOOTLIGHT_STRIDE = 4;
/** One in this many wall tiles along a bleacher row seats a dead spectator. */
const BLEACHER_STRIDE = 2;
/** One in this many wall tiles along a menagerie run carries a cage front. */
const CAGE_STRIDE = 3;
/** One in this many wall tiles bounding the mirror halls carries a pane. */
const MIRROR_GLASS_STRIDE = 3;
/** One in this many drape faces along the fire walk carries a piece of the fire act's kit. */
const FIRE_KIT_STRIDE = 4;
/** A follow-spot hangs on the drape this many tiles in from its lane's end wall. */
const FOLLOW_SPOT_INSET_TILES = 1;
/** The seat in the bleachers whose dead spectator is still applauding. */
const CLAPPING_SPECTATOR_COLUMN = 14;
/** How far along its row a caged beast notices a follow-spot catching, in tiles. */
const CAGE_LUNGE_REACH_TILES = 2;
/** The share of each frame a follow-spot turns toward where it is wanted: a quick but visible swing. */
const FOLLOW_SPOT_SWING_EASE = 0.14;
/** A beam brightens over this share of its burn and dims over the same at the end. */
const FOLLOW_SPOT_RAMP_SHARE = 0.2;
/** The follow-spot's cone may rise this far above its lane's row, to reach the lamp's lens. */
const FOLLOW_SPOT_CONE_HEADROOM_TILES = 0.45;

type DressingKind =
  | 'runner'
  | 'footlight'
  | 'archPost'
  | 'bleacher'
  | 'cage'
  | 'mirrorGlass'
  | 'ringBleacher'
  | 'intervalLamp'
  | FireWalkWallKit
  | 'followSpot'
  | 'feedTrough';

/**
 * Which dressing hangs on a wall and which lies on the floor. Every kind is
 * one or the other, and the maze's gate holds each to its side.
 */
export const WALL_HUNG_DRESSING_KINDS: ReadonlySet<DressingKind> = new Set<DressingKind>([
  'archPost',
  'bleacher',
  'cage',
  'mirrorGlass',
  'ringBleacher',
  'intervalLamp',
  ...FIRE_WALK_WALL_KITS,
  'followSpot',
  'feedTrough',
]);
export const FLOOR_DRESSING_KINDS: ReadonlySet<DressingKind> = new Set<DressingKind>([
  'runner',
  'footlight',
]);

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

/**
 * The tent's dividing line, which every act board is centred on: the column
 * each interval's peep window is cut into, between the paired rooms.
 */
const ACT_BOARD_COLUMN = MAZE_CURTAINS[0].windowTile.x;

/** The vents' grates, as the strips they are blitted in: one per lane per row. */
const VENT_GRATE_RUNS = fireGrateRuns(
  MAZE_VENTS.map((vent) => ({ x: vent.tileX, y: vent.tileY })),
  ACT_BOARD_COLUMN,
);
const ACT_ONE_BOARD_ROW = 86;

/** A crawler shows in every hall pane within this many tiles of it, nearest first. */
const REFLECTION_RANGE_TILES = 3;
/** At most this many panes reflect one crawler at once: a blit each, so this caps the cost. */
export const MAX_REFLECTING_PANES = 4;
/** One crawler's reflection in the panes near it. */
interface PaneReflection {
  readonly source: ReflectionSource;
  /** How far the crawler stands east of the pane, in tiles. */
  readonly offsetTiles: number;
  /** 1 standing at the pane, fading to 0 at the edge of reach. */
  readonly strength: number;
}

/** The interval drape lifts and bunches over half a second. */
const CURTAIN_RISE_FRAMES = 30;
/**
 * How close the acting crawler must be to one of their own mirrors for the
 * ghost of its next turn to show — the same reach as the prompt to swing at it,
 * so the question and the answer appear together.
 */
export const TURN_PREVIEW_RANGE_TILES = TARGET_PROMPT_RANGE_TILES;

/** What put a crawler back at the top of the act. */
type BurnoutCause = 'fire' | 'spotlight' | 'limelight';

const BURNOUT_DIALOGS: Readonly<Record<BurnoutCause, NonEmpty<DialogLine>>> = {
  fire: STARLIGHT_TENT_BURNOUT_FIRE,
  spotlight: STARLIGHT_TENT_BURNOUT_SPOTLIGHT,
  limelight: STARLIGHT_TENT_BURNOUT_LIMELIGHT,
};

/** The card each act opens with, shown once as its curtains part. */
const ACT_CARDS: Readonly<Partial<Record<MazeSectionId, NonEmpty<DialogLine>>>> = {
  menagerie: STARLIGHT_TENT_ACT_TWO_CARD,
  mirrors: STARLIGHT_TENT_ACT_THREE_CARD,
};

const NO_TILES: ReadonlyArray<MazeTile> = [];
const NO_BEAM_STEPS: ReadonlyArray<{ readonly tile: MazeTile; readonly hot: boolean }> = [];
const NO_STAR_LIGHTS: ReadonlyArray<{ readonly tile: MazeTile; readonly lit: number }> = [];

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

export class StarlightTentMazeSystem implements GameSystem, GroundHazardSource {
  /**
   * Shown by BuildingInteriorScene if the party falls in here.
   *
   * The acts never kill: they charge the walk rather than health, and every
   * prop in them is damage-immune. Only the centre ring's guards can.
   */
  readonly defeatMessage = 'The show went on without you.';

  private frame = 0;
  private readonly targets = new Map<string, MazeBlockTarget>();
  private readonly bells = new Map<string, MazeBellTarget>();
  private readonly mirrors = new Map<string, MazeMirrorTarget>();

  /** Every tile a flame vent can light, for the "is this safe to stand on" question. */
  private readonly ventTiles = new Set(MAZE_VENTS.map((vent) => tileKeyOf(vent.tileX, vent.tileY)));
  private readonly clearedBlocks = new Set<string>();
  /** Frame each opened tile gave way on, so its art can flare and then settle. */
  private readonly openedFrames = new Map<string, number>();
  private readonly openedCurtains = new Set<string>();
  /** Coins owed for the encore, drained by the scene, which drops them at the star's foot. */
  private readonly pendingRewards: Array<{ tile: MazeTile; coins: number }> = [];
  /** Where the light would go after the next blow on the mirror the acting crawler stands at. */
  private turnPreview: MazeTurnPreview | null = null;

  /** The act being warmed during its interval, and the camera windows over it still to paint. */
  private warmSectionId: MazeSectionId | null = null;
  private warmWindows: Array<{ x: number; y: number }> = [];
  /** The curtain whose act has been queued for warming, so each act is warmed once. */
  private warmedCurtainId: string | null = null;
  /** A one-pixel surface the warm pass paints onto: the bakes are the point, not the pixels. */
  private warmSurface: CanvasSurface | null = null;

  /** The act the party is in. Only ever moves forward, and only through a curtain. */
  private currentSectionId: MazeSectionId = MAZE_SECTIONS[0].id;

  private readonly dressing: ReadonlyArray<Dressing>;
  /** The hall's wall panes, the only dressing that reflects. */
  private readonly hallPanes: ReadonlyArray<Dressing>;
  private reflectionBlits = 0;
  /** Each follow-spot's aim now, in screen radians, easing toward where its track wants it. */
  private readonly followSpotAims = new Map<string, number>();
  /** The wall tile each track's follow-spot hangs on. */
  private readonly followSpotTiles: ReadonlyMap<string, MazeTile>;
  /** The lantern cells whose catching sets each beast's cage lunging at its bars. */
  private readonly cageLungeCells: ReadonlyMap<Dressing, ReadonlyArray<VentSchedule>>;
  private readonly actBoards: ReadonlyArray<ActBoard>;
  /** The tent's stage lights: dark everywhere but the act on stage. */
  readonly lighting: StarlightTentLighting;

  /** The hall of mirrors: its board, its teaching strip and their light. */
  readonly hall: MirrorHall;
  /**
   * The span of each limelight from its lens to its first optic, in tent
   * tiles, worked out once.
   *
   * It cannot move: the first optic is the first on a ray that never changes,
   * and a mirror only ever turns in place. That is the whole reason the hall is
   * fair — the burning geometry is fixed however the players aim the rest of
   * the light.
   */
  private readonly hotBeamTiles: ReadonlyArray<MazeTile>;
  private readonly hotBeamKeys: ReadonlySet<string>;
  /** The hot span split by the act each tile belongs to, so the live span is one lookup. */
  private readonly hotBeamTilesByAct: ReadonlyMap<MazeSectionId, ReadonlyArray<MazeTile>>;
  /** The floor tiles the hall's glass stands on, held solid while this tent stands. */
  private readonly glassTiles: ReadonlyArray<MazeTile>;
  /** The hold on the difficulty setting while this tent is running, released on dispose. */
  private difficultyGuard: DifficultyGuardHandle | null = null;

  /** Frames left before another vent may be heard lighting. */
  private ventCueCooldown = 0;
  /** Frames left before another vent may be heard kindling. */
  private ventKindleCueCooldown = 0;
  /** Frames left before another refused blow may be heard. */
  private refusalCueCooldown = 0;

  /** Frames left of the white-out a failed act paints. Drives nothing but the paint. */
  private flashFrames = 0;

  /**
   * The most recent frame context, so the band and paint passes — which are
   * handed no context — can still ask where the crawlers are standing.
   */
  private lastContext: SystemContext | null = null;

  private bannerTimer = BANNER_FRAMES;
  /** A banner earned on the same frame as another, shown once that one has run. */
  private queuedBanner: { title: string; subtitle: string } | null = null;
  private bannerTitle = STARLIGHT_TENT_ENTRY_BANNER;
  private bannerSubtitle: string | null = STARLIGHT_TENT_ENTRY_SUBTITLE;

  /** The handle the interlude on screen was returned, if any. */
  private openBeatHandle: ConversationHandle | null = null;
  /**
   * Set when a reset has moved both crawlers, so the scene can re-anchor the
   * parked one. Without it the anchored follow drive walks whoever the player
   * is not holding straight back out toward the corridor they just failed.
   */
  partyResetPending = false;
  /**
   * Set the frame the ring's act begins, so the scene can take both crawlers
   * off the anchors the acts parked them on. Without it the companion stands
   * where the player last left them while the guards come out.
   */
  partyReleasePending = false;

  /** Cues raised by the script, drained by the scene's audio pass. */
  private readonly pendingSounds: Array<{ id: SoundId; volume?: number }> = [];
  /** How many times each cue has played, so a cue with several takes rotates through them. */
  private readonly cueTakesPlayed = new Map<readonly SoundId[], number>();

  constructor(
    private readonly map: GameMap,
    private readonly addMob: (mob: Mob) => void,
    private readonly progress: StarlightTentProgress,
    /** The tent's scene claims; null in a harness with no audio. */
    private readonly music: MusicClaims | null,
    private readonly conversation: Conversation,
    /**
     * The tent as dealt to floor 3's world on the difficulty it was built
     * under, already written into `map`. Fixed for the life of this system: a
     * mid-run difficulty change rebuilds the whole tent through
     * `restartOnDifficulty` rather than letting a live read disagree with the
     * board on the floor.
     */
    readonly plan: StarlightTentMazePlan,
    /**
     * Rebuilds the tent from Act I on the new tier's board, once the player
     * has confirmed a difficulty change the guard held. Called after the new
     * tier is set.
     */
    private readonly restartOnDifficulty: (next: Difficulty) => void,
    /**
     * The centre ring's chest, guards and ladder. Outlives this system across
     * a difficulty restart, so the ring keeps one chest and calls its guards
     * once.
     */
    readonly finale: StarlightTentFinale,
  ) {
    const hallMirrors = this.spawnMirrors(tentMirrorsOf(plan.board, boardTileToTent));
    const teachingMirrors = this.spawnMirrors(
      tentMirrorsOf(TEACHING_STRIP_BOARD, teachingTileToTent),
    );
    this.hall = new MirrorHall(plan, hallMirrors, teachingMirrors);
    this.hotBeamTiles = this.hall.hotSpan.map((step) => step.tentTile);
    this.hotBeamKeys = new Set(this.hotBeamTiles.map((tile) => tileKeyOf(tile.x, tile.y)));
    const hotByAct = new Map<MazeSectionId, MazeTile[]>();
    for (const tile of this.hotBeamTiles) {
      const act = sectionAtRow(tile.y).id;
      hotByAct.set(act, [...(hotByAct.get(act) ?? []), tile]);
    }
    this.hotBeamTilesByAct = hotByAct;
    this.glassTiles = [
      ...[...hallMirrors, ...teachingMirrors].map((mirror) => mirror.tile),
      ...plan.board.splitters.map((splitter) => boardTileToTent(splitter.tile)),
      ...TEACHING_STRIP_BOARD.splitters.map((splitter) => teachingTileToTent(splitter.tile)),
    ];
    // Glass is furniture a crawler walks round, never through: the board was
    // proven reachable with every pane solid, and a crawler standing inside a
    // mirror would be drawn through its frame.
    for (const tile of this.glassTiles) this.map.blockTilePermanently(tile.x, tile.y);
    this.dressing = buildStarlightTentDressing(starlightTentWallAt(this.map), plan.board);
    this.hallPanes = this.dressing.filter((piece) => piece.kind === 'mirrorGlass');
    this.followSpotTiles = followSpotTilesOf(this.dressing);
    this.cageLungeCells = cageLungeCellsOf(this.dressing);
    this.actBoards = buildActBoards();
    this.lighting = new StarlightTentLighting([
      ...layoutLightFixtures(plan),
      ...dressingLightFixtures(this.dressing),
    ]);
    this.spawnFurniture();
    // Deliberately no `bossFightInitiated`: the tent is not scored as a boss
    // room, and the event is what hands the soundtrack to the boss-music table.
    this.music?.claimMusic({
      owner: 'starlight_tent_maze',
      layer: 'battle',
      selection: { kind: 'loop', id: STARLIGHT_TENT_MUSIC },
    });
    // Last, so a restart the guard asks for never meets a tent half built.
    this.holdDifficulty();
  }

  private spawnFurniture(): void {
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
  }

  /** Stands a board's mirrors up as props, in board order. */
  private spawnMirrors(mirrors: ReadonlyArray<MazeMirror>): MazeMirrorTarget[] {
    return mirrors.map((mirror) => {
      const target = new MazeMirrorTarget(TILE_SIZE, mirror);
      target.setMap(this.map);
      this.addMob(target);
      this.mirrors.set(mirror.id, target);
      return target;
    });
  }

  /**
   * Holds the difficulty setting while the tent runs: a change would deal the
   * hall another board and change every other act's hazards mid-show, so it is
   * confirmed first and then restarts the tent from Act I on the new tier.
   */
  private holdDifficulty(): void {
    this.difficultyGuard = registerDifficultyChangeGuard({
      restartWithDifficulty: (next) => {
        settings.setDifficulty(next);
        this.restartOnDifficulty(next);
      },
    });
  }

  private releaseDifficulty(): void {
    if (this.difficultyGuard !== null) clearDifficultyChangeGuard(this.difficultyGuard);
    this.difficultyGuard = null;
  }

  /** Every creature this tent put in the roster: its props. */
  ownedMobs(): Mob[] {
    return [...this.everyProp()];
  }

  // ── Public surface consumed by BuildingInteriorScene ───────────────────────

  /** Whether an interlude — an act card or a reset notice — is on the shared conversation. */
  get isDialogOpen(): boolean {
    return this.openBeatHandle !== null && this.conversation.isActive(this.openBeatHandle);
  }

  advanceDialog(): boolean {
    if (!this.isDialogOpen) return false;
    this.conversation.advance();
    return true;
  }

  /**
   * Escape closes an interlude box: nothing is waiting on it, the party has
   * already been moved, and it is pure explanation.
   */
  dismissDialog(): boolean {
    if (!this.isDialogOpen) return false;
    return this.conversation.dismiss();
  }

  /** Opens an interlude on the shared conversation. */
  private openInterlude(lines: NonEmpty<DialogLine>): void {
    this.openBeatHandle = this.conversation.open({
      lines,
      reward: null,
      questRelated: false,
      ending: { kind: 'close', onClosed: () => undefined },
      dismiss: { kind: 'allowed', onDismissed: () => undefined },
      haltsWorld: true,
      anchor: null,
      locksKeyboard: true,
    });
  }

  /**
   * The acts are two people solving one room from opposite sides, so the party
   * may not be bundled back together: following would walk the idle crawler
   * into a corridor nobody is steering them through. The centre ring is one
   * room with nothing burning in it and five clowns in it, so there the party
   * fights together.
   */
  get followDisabled(): boolean {
    return this.currentSectionId !== FIGHTING_ACT;
  }

  /** Sound cues raised since the last drain, oldest first. */
  drainSounds(): Array<{ id: SoundId; volume?: number }> {
    return this.pendingSounds.splice(0, this.pendingSounds.length);
  }

  /**
   * Coin drops owed since the last drain. The scene drops each at its tile so
   * the coins fall and land before they are collected; the maze only decides
   * that they are owed, once per run.
   */
  drainRewards(): Array<{ tile: MazeTile; coins: number }> {
    return this.pendingRewards.splice(0, this.pendingRewards.length);
  }

  /** The ghost of the next turn shown this frame, if the acting crawler is at one of their mirrors. */
  get currentTurnPreview(): MazeTurnPreview | null {
    return this.turnPreview;
  }

  /** The act the show is on. */
  get currentAct(): MazeSectionId {
    return this.currentSectionId;
  }

  /** Whether the encore star has shone in this performance. */
  get encoreShone(): boolean {
    return this.hall.encoreShone;
  }

  /** The board this tent's hall was dealt. */
  get board(): MirrorBoard {
    return this.plan.board;
  }

  /**
   * Raises one take of a cue. An empty cue is one whose recording has not
   * landed and that has no stand-in, and stays silent.
   */
  private cue(takes: readonly SoundId[], volume?: number): void {
    if (takes.length === 0) return;
    const taken = this.cueTakesPlayed.get(takes) ?? 0;
    this.cueTakesPlayed.set(takes, taken + 1);
    const id = takes[taken % takes.length];
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
      throw new Error(`unknown Starlight Tent maze section ${this.currentSectionId}`);
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
    placeOnMark(ctx.human, section.humanSpawn);
    placeOnMark(ctx.cat, section.catSpawn);
    this.flashFrames = BURNOUT_FLASH_FRAMES;
    this.partyResetPending = true;
    this.cue(STARLIGHT_TENT_CUES.burnout);
    const burnoutBeat = BURNOUT_DIALOGS[cause];
    this.openInterlude(burnoutBeat);
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
    if (block === undefined) throw new Error(`unknown Starlight Tent maze block: ${id}`);
    return block;
  }

  private openTile(tile: MazeTile): void {
    this.openedFrames.set(tileKeyOf(tile.x, tile.y), this.frame);
    // Walkability is read off the live tile type, so opening a barrier is a
    // single write; only the painted art is cached, and that is what the dirty
    // mark is for.
    this.map.structure[tile.y][tile.x].type = SAWDUST_FLOOR;
    // Every wall tile whose art can depend on this one, not just the tile: a
    // wall's drape is chosen by which of its neighbours is floor, and backstage
    // clutter is hidden anywhere within its clearance of floor, so a wall a
    // couple of tiles off can lose its trunk the moment the way opens — and the
    // chunk it sits in may not be this tile's.
    const reach = BACKSTAGE_CLUTTER_CLEARANCE_TILES;
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) this.map.markTileDirty(tile.x + dx, tile.y + dy);
    }
  }

  private openBarrier(block: MazeBlock): void {
    this.openTile(block.barrierTile);
    this.clearedBlocks.add(block.id);
    this.cue(STARLIGHT_TENT_BLOCK_CLEARED_CUES[block.kind]);
    // Said out loud as well as drawn. The crawler this door was opened for is
    // the one the player is *not* holding, so the news has to survive the walk
    // back across the tent and the switch.
    this.showBanner(
      WAY_OPENED_BANNER,
      block.blocks === 'human' ? WAY_OPENED_FOR_HUMAN : WAY_OPENED_FOR_CAT,
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
      this.cue(STARLIGHT_TENT_CUES.curtainRise);
      this.cue(STARLIGHT_TENT_CUES.actApplause);
      if (curtain.opens === 'mirrors') this.cue(STARLIGHT_TENT_CUES.limelightIgnite);
      this.currentSectionId = curtain.opens;
      if (curtain.opens === FIGHTING_ACT) this.partyReleasePending = true;
      this.showBanner(this.currentSection.banner, null);
      const card = ACT_CARDS[curtain.opens];
      if (card !== undefined) this.openInterlude(card);
      return;
    }
  }

  private showBanner(title: string, subtitle: string | null): void {
    this.bannerTitle = title;
    this.bannerSubtitle = subtitle;
    this.bannerTimer = BANNER_FRAMES;
  }

  // ── The hall of mirrors ───────────────────────────────────────────────────

  /** The hot span's tiles that are dangerous right now. */
  private get liveHotBeamTiles(): ReadonlyArray<MazeTile> {
    return this.hotBeamTilesByAct.get(this.currentSectionId) ?? NO_TILES;
  }

  /**
   * Whether the hall's light is on: only while its act is on stage. Before the act the limelights have not been lit,
   * and once the party has gone through to the ring the set is struck, like
   * every other act behind them.
   */
  private get hallLightOn(): boolean {
    return this.currentSectionId === 'mirrors';
  }

  /**
   * The ghost of the next blow, for the acting crawler's nearest own mirror in
   * reach: the whole of its board's light one blow on, walked by the same trace
   * as the live light, so it shows exactly what the swing then does.
   */
  private computeTurnPreview(ctx: SystemContext): MazeTurnPreview | null {
    if (this.currentSectionId !== 'mirrors') return null;
    const half = this.halfOf(ctx.active, ctx.human);
    const mirror = this.nearestMirror(ctx.active, half);
    if (mirror === null) return null;
    if (!this.withinMobTiles(ctx.active, mirror, TURN_PREVIEW_RANGE_TILES)) return null;
    return this.hall.previewFor(mirror, half);
  }

  private updateMirrors(): void {
    let turned = false;
    for (const mirror of this.mirrors.values()) {
      if (!mirror.turnedThisFrame) continue;
      mirror.turnedThisFrame = false;
      turned = true;
      this.cue(STARLIGHT_TENT_CUES.mirrorTurn);
    }
    if (!turned) return;
    this.answerHall(this.hall.refresh(this.frame));
  }

  /**
   * The doors, cues and banners a settle of the light earns.
   *
   * One blow can do several of these at once, so each cue is raised at most
   * once and the biggest moment speaks for the rest: a solve covers the star
   * that completed it, and when the same blow lights the encore its banner
   * waits for the solve's to finish rather than replacing it.
   */
  private answerHall(changes: HallChanges): void {
    const cues = new Set<readonly SoundId[]>();
    const opensWay = changes.solved || changes.teachingOpened.length > 0;
    if (changes.starsLit > 0 && !changes.solved) cues.add(STARLIGHT_TENT_CUES.starLights);
    if (changes.starsFizzled > 0) cues.add(STARLIGHT_TENT_CUES.starWrongFizzle);
    else if (changes.starsDimmed > 0) cues.add(STARLIGHT_TENT_CUES.starDims);

    for (const half of changes.teachingOpened) {
      this.openTile(MAZE_TEACHING_DOORWAYS[half]);
      this.showBanner(
        WAY_OPENED_BANNER,
        half === 'human' ? TEACHING_OPENED_FOR_HUMAN : TEACHING_OPENED_FOR_CAT,
      );
    }

    if (changes.solved) {
      for (const exit of MAZE_HALL_EXITS) this.openTile(exit.tile);
      cues.add(STARLIGHT_TENT_CUES.starLatch);
      cues.add(STARLIGHT_TENT_CUES.marqueeChase);
      this.showBanner(WAY_OPENED_BANNER, WAY_OPENED_FOR_BOTH);
    }
    if (opensWay) cues.add(STARLIGHT_TENT_CUES.starOpensWay);

    if (changes.encoreLit) {
      cues.add(STARLIGHT_TENT_CUES.starLatch);
      cues.add(STARLIGHT_TENT_CUES.actApplause);
      const banner = this.payEncore();
      if (changes.solved || changes.teachingOpened.length > 0) this.queuedBanner = banner;
      else this.showBanner(banner.title, banner.subtitle);
    }
    for (const cue of cues) this.cue(cue);
  }

  /**
   * The encore opens nothing: it lights its bulb on the marquee and pays out
   * once per run. The flag lives on the tent's progress, which outlives this
   * system, because a party thrown out of the tent and sent back in builds a
   * fresh maze with every star dark again. Returns the banner it earns.
   */
  private payEncore(): { title: string; subtitle: string } {
    const encore = this.hall.encoreStar;
    const alreadyPaid = this.progress.encorePaid;
    const banner = {
      title: ENCORE_BANNER,
      subtitle: alreadyPaid ? ENCORE_REPEAT_SUBTITLE : ENCORE_PAID_SUBTITLE,
    };
    if (alreadyPaid || encore === undefined) return banner;
    this.progress.encorePaid = true;
    this.pendingRewards.push({
      tile: starFootTile(this.plan.board, encore),
      coins: MAZE_ENCORE_REWARD_COINS,
    });
    return banner;
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
    this.cue(STARLIGHT_TENT_CUES.refusedBlow, REFUSAL_CUE_VOLUME);
    this.refusalCueCooldown = REFUSAL_CUE_COOLDOWN_FRAMES;
  }

  private *everyProp(): Generator<MazePropTarget> {
    yield* this.targets.values();
    yield* this.bells.values();
    yield* this.mirrors.values();
  }

  private updateBells(): void {
    for (const bell of this.bells.values()) {
      if (bell.holdEndedThisFrame) {
        bell.holdEndedThisFrame = false;
        this.cue(STARLIGHT_TENT_CUES.followSpotSwing);
      }
      if (!bell.rangThisFrame) continue;
      bell.rangThisFrame = false;
      this.cue(STARLIGHT_TENT_CUES.bellRing);
      this.cue(STARLIGHT_TENT_CUES.followSpotSwing);
    }
  }

  // ── Frame update ──────────────────────────────────────────────────────────

  /** Whether the stage lights have finished answering the act on stage. */
  get lightsSettled(): boolean {
    return this.lighting.settledFor(this.stageCue());
  }

  /** What the lights are asked for: the act on stage. */
  private stageCue(): StageCue {
    return { currentAct: this.currentSectionId };
  }

  update(ctx: SystemContext): void {
    this.lastContext = ctx;
    this.frame++;
    // Ahead of the early return below: the house board keeps fading through an
    // act card, which opens on the very frame its act's lights start coming up.
    this.lighting.tick(this.stageCue());
    if (this.bannerTimer > 0) this.bannerTimer--;
    if (this.bannerTimer === 0 && this.queuedBanner !== null) {
      this.showBanner(this.queuedBanner.title, this.queuedBanner.subtitle);
      this.queuedBanner = null;
    }
    if (this.flashFrames > 0) this.flashFrames--;

    this.updateBlocks();
    this.noteRefusedBlows();
    this.updateBells();
    this.updateFollowSpots();
    this.updateMirrors();
    this.updateTargetPulses(ctx);
    this.turnPreview = this.computeTurnPreview(ctx);
    this.queueNextActWarm(ctx);

    // The tent stops performing while an interlude box is up. The scene keeps
    // ticking this system through one, so everything below would otherwise run
    // behind it: a vent whooshes on the frame the box goes away for fire that
    // finished burning long before.
    if (this.isDialogOpen) return;

    this.updateCurtains(ctx);
    this.finale.update(ctx.human, ctx.cat, this.currentSectionId);

    // Ahead of the ignition cue, so the frame a crawler is caught plays the
    // reset rather than one more whoosh from the vent that caught them.
    const caught = this.hazardCatchingSomeone(ctx);
    if (caught !== null) {
      this.beginBurnout(ctx, caught);
      return;
    }
    this.noteVentCues(ctx.active);
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
    // A teaching mirror pulses until its lane's doorway opens, and the hall's
    // glass takes over from there until the board is solved: one lane's worth
    // of questions at a time.
    const inHall = this.currentSectionId === 'mirrors';
    for (const mirror of this.hall.mirrorsOf('teaching')) {
      mirror.pulsing = inHall && !this.hall.isTeachingOpen(MAZE_TARGET_OWNER[mirror.kind]);
    }
    for (const mirror of this.hall.mirrorsOf('hall')) {
      mirror.pulsing =
        inHall && !this.hall.solved && this.hall.isTeachingOpen(MAZE_TARGET_OWNER[mirror.kind]);
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
   * The kindle and ignition cues, for vents the crawler is actually near.
   *
   * Sixty-six vents on six clocks light about fifteen times a second between
   * them; played unconditionally that is a fireball whoosh every four frames,
   * most of it from the other lane where the player cannot even see the flame it
   * belongs to. Only what is close enough to matter is heard, and never twice
   * inside one breath. Each cue keeps its own rest, so a kindle never swallows
   * the whoosh of a neighbouring vent that lights on the same frame.
   */
  private noteVentCues(active: Player): void {
    this.ventKindleCueCooldown = this.noteNearbyVentEntering(
      active,
      'telegraph',
      this.ventKindleCueCooldown,
      STARLIGHT_TENT_CUES.ventKindle,
      VENT_KINDLE_VOLUME,
    );
    this.ventCueCooldown = this.noteNearbyVentEntering(
      active,
      'flame',
      this.ventCueCooldown,
      STARLIGHT_TENT_CUES.ventIgnition,
      VENT_IGNITION_VOLUME,
    );
  }

  /**
   * Raises `takes` for the first nearby vent that entered `phase` this frame,
   * unless the cue is still resting. Returns the rest left after this frame.
   */
  private noteNearbyVentEntering(
    active: Player,
    phase: Exclude<VentPhase, 'idle'>,
    cooldown: number,
    takes: readonly SoundId[],
    volume: number,
  ): number {
    if (cooldown > 0) return cooldown - 1;
    const reach = TILE_SIZE * VENT_CUE_RANGE_TILES;
    for (const vent of this.liveVents) {
      if (ventPhaseAt(vent, this.frame) !== phase) continue;
      if (ventPhaseAt(vent, this.frame - 1) === phase) continue;
      const dx = (vent.tileX + TILE_CENTRE) * TILE_SIZE - (active.x + TILE_SIZE * TILE_CENTRE);
      const dy = (vent.tileY + TILE_CENTRE) * TILE_SIZE - (active.y + TILE_SIZE * TILE_CENTRE);
      if (Math.hypot(dx, dy) > reach) continue;
      this.cue(takes, volume);
      return VENT_CUE_COOLDOWN_FRAMES;
    }
    return 0;
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  /**
   * Everything the tent draws under the crawlers, in the one order that keeps
   * the hazards fair: the furniture, then the stage lights over it, then every
   * warning and marker over the lights at full strength, whatever the local
   * dark.
   */
  renderWorld(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.renderProps(ctx, camX, camY);
    this.renderLighting(ctx, camX, camY);
    this.renderTelegraphs(ctx, camX, camY);
    this.warmStep(ctx);
  }

  /** Lets go of the tent's baked prop frames and reflection scratch once the party has left. */
  dispose(): void {
    this.releaseDifficulty();
    // The map outlives this system when the tent is restarted on it, and the
    // next board's glass stands somewhere else.
    for (const tile of this.glassTiles) this.map.unblockTilePermanently(tile.x, tile.y);
    clearStarlightTentPropCache();
    clearReflectionScratch();
    this.lighting.dispose();
    if (this.warmSurface !== null) releaseSurface(this.warmSurface);
    this.warmSurface = null;
    this.warmWindows = [];
  }

  /**
   * Queues the next act's props for baking once either crawler is in its
   * interval room. Every prop of an act is first drawn on the frame its
   * curtain lifts, and baking them all then is a hitch as the act opens; the
   * interval is a quiet stretch to bake them in, and the act the party has
   * just left no longer needs its frames kept.
   */
  private queueNextActWarm(ctx: SystemContext): void {
    const next = MAZE_CURTAINS.find((curtain) => !this.openedCurtains.has(curtain.id));
    if (next === undefined || this.warmedCurtainId === next.id) return;
    const humanTile = tileOf(ctx.human);
    const catTile = tileOf(ctx.cat);
    const inInterval =
      rectContains(next.humanRoom, humanTile.x, humanTile.y) ||
      rectContains(next.catRoom, catTile.x, catTile.y);
    if (!inInterval) return;
    this.warmedCurtainId = next.id;
    const section = MAZE_SECTIONS.find((candidate) => candidate.id === next.opens);
    if (section === undefined) return;
    const stepX = Math.max(TILE_SIZE, viewportWidth());
    const stepY = Math.max(TILE_SIZE, viewportHeight());
    const windows: Array<{ x: number; y: number }> = [];
    const bottom = (section.rowRange.y1 + 1) * TILE_SIZE;
    for (let y = section.rowRange.y0 * TILE_SIZE; y < bottom; y += stepY) {
      for (let x = 0; x < MAZE_WIDTH * TILE_SIZE; x += stepX) windows.push({ x, y });
    }
    this.warmSectionId = section.id;
    this.warmWindows = windows;
  }

  /**
   * Paints one window of the act being warmed onto a scratch pixel, at the
   * live canvas's scale so the frames baked are the ones the act will ask
   * for. One window a frame spreads the bakes over the interval.
   */
  private warmStep(live: CanvasRenderingContext2D): void {
    const view = this.warmWindows.shift();
    const sectionId = this.warmSectionId;
    if (view === undefined || sectionId === null) return;
    this.warmSurface ??= allocCanvas('starlightTentProps', 1, 1);
    const scratch = surfaceContext(this.warmSurface);
    const liveTransform = live.getTransform();
    scratch.save();
    try {
      scratch.setTransform(
        liveTransform.a,
        liveTransform.b,
        liveTransform.c,
        liveTransform.d,
        0,
        0,
      );
      this.renderProps(scratch, view.x, view.y);
      this.renderTelegraphs(scratch, view.x, view.y);
      for (const figure of this.sortedFigures()) {
        if (sectionAtRow(Math.floor(figure.y / TILE_SIZE)).id !== sectionId) continue;
        figure.render(scratch, view.x, view.y, TILE_SIZE);
      }
      for (const prop of this.everyProp()) {
        const propX = prop.x - view.x;
        const propY = prop.y - view.y;
        if (!isOnScreen(propX, propY, OVERHEAD_PROP_HEIGHT_TILES)) continue;
        if (sectionAtRow(Math.floor(prop.y / TILE_SIZE)).id !== sectionId) continue;
        prop.paintBodyAt(scratch, propX, propY, TILE_SIZE);
      }
    } finally {
      scratch.restore();
    }
  }

  /**
   * The room's own furniture: the dressing, the act boards, every barrier
   * still shut and the grates behind them, and both limelight housings. All
   * of it goes under the stage lights.
   */
  renderProps(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.renderDressing(ctx, camX, camY);
    this.renderActBoards(ctx, camX, camY);
    this.renderShutBarriers(ctx, camX, camY);
    this.hall.renderPieces(ctx, camX, camY, this.frame);
  }

  /** The hall's floor-standing glass that is not a mob, for the scene's Y-sorted pass. */
  sortedFigures(): ReadonlyArray<InteriorFigure> {
    return this.hall.sortedFigures(this.frame);
  }

  /** The dark over the tent, and the live light cut through it. */
  renderLighting(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.lighting.renderDarkness(ctx, camX, camY);
    this.lighting.renderLiveLights(ctx, camX, camY, this.liveLights());
    this.renderFollowSpotCones(ctx, camX, camY);
    this.renderReflections(ctx, camX, camY);
  }

  /**
   * The crawlers in the hall's glass. Over the dark rather than under it: a
   * reflection is the lit crawler thrown back, as bright as the crawler is,
   * in a pane the tent's dark has otherwise swallowed.
   */
  private renderReflections(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.reflectionBlits = 0;
    for (const [pane, reflections] of this.paneReflections(ctx, camX, camY)) {
      const x = pane.tile.x * TILE_SIZE - camX;
      const y = pane.tile.y * TILE_SIZE - camY;
      if (!isOnScreen(x, y)) continue;
      for (const reflection of reflections) {
        drawPaneReflection(
          ctx,
          x,
          y,
          TILE_SIZE,
          pane.seed,
          this.frame,
          reflection.source,
          reflection.offsetTiles,
          reflection.strength,
        );
        this.reflectionBlits++;
      }
    }
  }

  /** Where a track's follow-spot pivots, in tiles. */
  private followSpotPivot(trackId: string): { x: number; y: number } | null {
    const tile = this.followSpotTiles.get(trackId);
    if (tile === undefined) return null;
    return { x: tile.x + FOLLOW_SPOT_PIVOT.x, y: tile.y + FOLLOW_SPOT_PIVOT.y };
  }

  /**
   * Where a follow-spot wants to point, in tiles: at its lit cells while it
   * burns, at the cell warming while it arrives, at its bell's trough while
   * the bell holds it, and at the middle of its run otherwise.
   */
  private followSpotTarget(track: SpotlightTrack): { x: number; y: number } | null {
    if (this.trackIsHeld(track.id)) {
      const bell = MAZE_BELLS.find((candidate) => candidate.id === track.bellId);
      if (bell === undefined) return null;
      return { x: bell.tile.x + 1 + TILE_CENTRE, y: bell.tile.y + TILE_CENTRE };
    }
    const armed = track.cells.some((cell) => this.isCurrentAct(cell.tileY));
    let litX = 0;
    let litCount = 0;
    let warming: VentSchedule | null = null;
    let warmest = 0;
    if (armed) {
      for (const cell of track.cells) {
        const phase = ventPhaseAt(cell, this.frame);
        if (phase === 'flame') {
          litX += cell.tileX;
          litCount++;
        } else if (phase === 'telegraph') {
          const warm = ventTelegraphProgress(cell, this.frame);
          if (warm > warmest) {
            warmest = warm;
            warming = cell;
          }
        }
      }
    }
    const row = (track.cells[0]?.tileY ?? 0) + TILE_CENTRE;
    if (litCount > 0) return { x: litX / litCount + TILE_CENTRE, y: row };
    if (warming !== null) return { x: warming.tileX + TILE_CENTRE, y: row };
    if (track.cells.length === 0) return null;
    const middle = track.cells[Math.floor(track.cells.length / 2)];
    return { x: middle.tileX + TILE_CENTRE, y: row };
  }

  /** Turns every follow-spot a step toward where it is wanted, the short way round. */
  private updateFollowSpots(): void {
    for (const track of MAZE_SPOTLIGHTS) {
      const pivot = this.followSpotPivot(track.id);
      const target = this.followSpotTarget(track);
      if (pivot === null || target === null) continue;
      const wanted = Math.atan2(target.y - pivot.y, target.x - pivot.x);
      const current = this.followSpotAims.get(track.id);
      if (current === undefined) {
        this.followSpotAims.set(track.id, wanted);
        continue;
      }
      const turn = Math.atan2(Math.sin(wanted - current), Math.cos(wanted - current));
      this.followSpotAims.set(track.id, current + turn * FOLLOW_SPOT_SWING_EASE);
    }
  }

  /**
   * Each burning follow-spot's beam through the air, from its lens to the
   * cells it has caught, kept inside the lane it lights.
   */
  private renderFollowSpotCones(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const track of MAZE_SPOTLIGHTS) {
      if (this.trackIsHeld(track.id)) continue;
      if (track.cells.length === 0) continue;
      const first = track.cells[0];
      if (!this.isCurrentAct(first.tileY)) continue;
      let strength = 0;
      for (const cell of track.cells) {
        const burn = ventFlameProgress(cell, this.frame);
        if (burn <= 0) continue;
        const ramp = Math.min(burn, 1 - burn) / FOLLOW_SPOT_RAMP_SHARE;
        strength = Math.max(strength, Math.min(1, ramp));
      }
      const pivot = this.followSpotPivot(track.id);
      const target = this.followSpotTarget(track);
      const lane = MENAGERIE_LANES.find((candidate) => candidate.half === track.half);
      if (strength <= 0 || pivot === null || target === null || lane === undefined) continue;
      const aim = this.followSpotAims.get(track.id) ?? 0;
      const lensX = (pivot.x + Math.cos(aim) * FOLLOW_SPOT_LENS_REACH) * TILE_SIZE - camX;
      const lensY = (pivot.y + Math.sin(aim) * FOLLOW_SPOT_LENS_REACH) * TILE_SIZE - camY;
      if (!isOnScreen(lensX, lensY) && !isOnScreen(target.x * TILE_SIZE - camX, lensY)) continue;
      drawFollowSpotCone(
        ctx,
        lensX,
        lensY,
        target.x * TILE_SIZE - camX,
        target.y * TILE_SIZE - camY,
        TILE_SIZE,
        strength,
        {
          x: lane.x0 * TILE_SIZE - camX,
          y: (first.tileY - FOLLOW_SPOT_CONE_HEADROOM_TILES) * TILE_SIZE - camY,
          width: (lane.x1 - lane.x0 + 1) * TILE_SIZE,
          height: (1 + FOLLOW_SPOT_CONE_HEADROOM_TILES) * TILE_SIZE,
        },
      );
    }
  }

  /**
   * How far through a lunge at its bars a caged beast is, 0..1, or `null`
   * while it is still: it lunges when a lantern near it catches.
   */
  private cageLunge(piece: Dressing): number | null {
    const cells = this.cageLungeCells.get(piece);
    if (cells === undefined) return null;
    let lunge: number | null = null;
    for (const cell of cells) {
      if (!this.isCurrentAct(cell.tileY)) continue;
      const track = MAZE_SPOTLIGHTS.find((candidate) => candidate.cells.includes(cell));
      if (track === undefined || this.trackIsHeld(track.id)) continue;
      const burnedFrames = ventFlameProgress(cell, this.frame) * cell.flameFrames;
      if (burnedFrames <= 0 || burnedFrames >= CAGE_LUNGE_DURATION_FRAMES) continue;
      lunge = Math.max(lunge ?? 0, burnedFrames / CAGE_LUNGE_DURATION_FRAMES);
    }
    return lunge;
  }

  /**
   * Everything a player reads to stay alive or find the way, drawn over the
   * stage lights so none of it is dimmed: the ropes from each target to its
   * gate, every vent grille — the grille is where fire comes from, lit or
   * not — and its warning, the lanterns' warm rings and a held row's clear
   * marks, every opened way's green, and the hall's stars, marquees and cold
   * light.
   */
  renderTelegraphs(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.renderRopes(ctx, camX, camY);
    this.renderVentGrilles(ctx, camX, camY);
    this.renderVentTelegraphs(ctx, camX, camY);
    this.renderSpotlightWarnings(ctx, camX, camY);
    this.renderOpenedWays(ctx, camX, camY);
    this.hall.renderReadouts(ctx, camX, camY, this.frame, this.hallLightOn, this.turnPreview);
  }

  /** What is lit this frame, for the stage lights' additive pass. */
  private liveLights(): LiveLights {
    return {
      ventFlames: this.litVents(),
      spotlightBeams: this.litSpotlightCells(),
      beamSteps: this.liveBeamSteps(),
      stars: this.starLights(),
      openedCurtains: this.openedCurtainTiles(),
    };
  }

  private *litVents(): Generator<{ tile: MazeTile; burn: number }> {
    for (const vent of this.liveVents) {
      const burn = ventFlameProgress(vent, this.frame);
      if (burn > 0) yield { tile: { x: vent.tileX, y: vent.tileY }, burn };
    }
  }

  private *litSpotlightCells(): Generator<{ tile: MazeTile; burn: number }> {
    for (const { cell, lit } of this.liveSpotlightCells()) {
      if (!lit) continue;
      yield { tile: { x: cell.tileX, y: cell.tileY }, burn: ventFlameProgress(cell, this.frame) };
    }
  }

  private liveBeamSteps(): ReadonlyArray<{ readonly tile: MazeTile; readonly hot: boolean }> {
    return this.hallLightOn ? this.hall.beamSteps : NO_BEAM_STEPS;
  }

  private starLights(): ReadonlyArray<{ readonly tile: MazeTile; readonly lit: number }> {
    return this.hallLightOn ? this.hall.litStars : NO_STAR_LIGHTS;
  }

  private *openedCurtainTiles(): Generator<MazeTile> {
    for (const curtain of MAZE_CURTAINS) {
      if (!this.openedCurtains.has(curtain.id)) continue;
      yield curtain.humanBarrier;
      yield curtain.catBarrier;
    }
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
          drawBleacherSpectator(
            ctx,
            x,
            y,
            TILE_SIZE,
            piece.seed,
            piece.tile.x === CLAPPING_SPECTATOR_COLUMN,
            this.frame,
          );
          break;
        case 'cage':
          drawMenagerieCageFront(
            ctx,
            x,
            y,
            TILE_SIZE,
            piece.seed,
            this.frame,
            this.cageLunge(piece),
          );
          break;
        case 'fireHoop':
        case 'fuelCans':
        case 'dangerPoster':
          drawFireWalkWallKit(ctx, piece.kind, x, y, TILE_SIZE, piece.seed);
          break;
        case 'followSpot': {
          if (piece.seed >= MAZE_SPOTLIGHTS.length) break;
          const track = MAZE_SPOTLIGHTS[piece.seed];
          const aim = this.followSpotAims.get(track.id) ?? 0;
          drawFollowSpotLamp(ctx, x, y, TILE_SIZE, aim, !this.trackIsHeld(track.id));
          break;
        }
        case 'feedTrough':
          drawFeedTrough(ctx, x, y, TILE_SIZE);
          break;
        case 'mirrorGlass':
          drawMirrorHallPane(ctx, x, y, TILE_SIZE, piece.seed, this.frame);
          break;
        case 'ringBleacher': {
          const seat = ringSeatOf(piece);
          drawRingBleacher(ctx, x, y, TILE_SIZE, {
            side: seat.side,
            tier: seat.tier,
            seed: piece.seed,
            phase: this.frame,
          });
          break;
        }
        case 'intervalLamp':
          drawIntervalRoomLamp(
            ctx,
            x,
            y,
            TILE_SIZE,
            piece.owner === 'human' ? 'east' : 'west',
            this.frame + piece.seed,
          );
          break;
      }
    }
  }

  /**
   * Which crawlers each hall pane reflects this frame: every crawler within
   * reach of a pane shows in the nearest few, painted once into a scratch
   * surface and blitted into each — so a reflection costs one paint and at
   * most `MAX_REFLECTING_PANES` blits per crawler.
   */
  private paneReflections(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
  ): ReadonlyMap<Dressing, ReadonlyArray<PaneReflection>> {
    const reflections = new Map<Dressing, PaneReflection[]>();
    const party = this.lastContext;
    // Only the hall has panes, and only panes on screen are worth a crawler's
    // body painted into a scratch surface.
    if (party === null || this.currentSectionId !== 'mirrors') return reflections;
    const visiblePanes = this.hallPanes.filter((pane) =>
      isOnScreen(pane.tile.x * TILE_SIZE - camX, pane.tile.y * TILE_SIZE - camY),
    );
    if (visiblePanes.length === 0) return reflections;
    const crawlers: ReadonlyArray<Player> = [party.human, party.cat];
    crawlers.forEach((crawler, slot) => {
      if (!crawler.isAlive) return;
      const centreX = crawler.x / TILE_SIZE + TILE_CENTRE;
      const centreY = crawler.y / TILE_SIZE + TILE_CENTRE;
      const near = visiblePanes
        .map((pane) => {
          const dx = centreX - (pane.tile.x + TILE_CENTRE);
          const dy = centreY - (pane.tile.y + TILE_CENTRE);
          return { pane, dx, distance: Math.hypot(dx, dy) };
        })
        .filter((entry) => entry.distance <= REFLECTION_RANGE_TILES)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, MAX_REFLECTING_PANES);
      if (near.length === 0) return;
      const source: ReflectionSource = paintReflectionSource(
        ctx,
        slot,
        TILE_SIZE,
        (target, x, y, size) => crawler.paintBodyAt(target, x, y, size),
      );
      for (const entry of near) {
        const list = reflections.get(entry.pane) ?? [];
        list.push({
          source,
          offsetTiles: entry.dx,
          strength: 1 - entry.distance / REFLECTION_RANGE_TILES,
        });
        reflections.set(entry.pane, list);
      }
    });
    return reflections;
  }

  /** How many reflection blits the last frame's dressing made, for the art gate. */
  get lastReflectionBlits(): number {
    return this.reflectionBlits;
  }

  /** The act names, painted on the boards over the flaps and every arch. */
  private renderActBoards(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const board of this.actBoards) {
      const x = board.tile.x * TILE_SIZE - camX;
      const y = board.tile.y * TILE_SIZE - camY;
      // The board spills several tiles either side of its own, so the cull has
      // to be generous horizontally or it pops out while still half on screen.
      if (!isOnScreen(x, y, OVERHEAD_PROP_HEIGHT_TILES)) continue;
      drawActEasel(ctx, x, y, TILE_SIZE, board.label);
    }
  }

  private renderShutBarriers(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const block of MAZE_BLOCKS) {
      const grateX = block.grateTile.x * TILE_SIZE - camX;
      const grateY = block.grateTile.y * TILE_SIZE - camY;
      if (isOnScreen(grateX, grateY)) drawPulleyGrate(ctx, grateX, grateY, TILE_SIZE);
      if (this.clearedBlocks.has(block.id)) continue;
      const barrierX = block.barrierTile.x * TILE_SIZE - camX;
      const barrierY = block.barrierTile.y * TILE_SIZE - camY;
      if (!isOnScreen(barrierX, barrierY)) continue;
      if (block.section === 'menagerie')
        drawCageGateBarrier(ctx, barrierX, barrierY, TILE_SIZE, this.frame);
      else if (block.kind === 'sandbag') drawFireScreenGate(ctx, barrierX, barrierY, TILE_SIZE);
      else drawBoardedFlat(ctx, barrierX, barrierY, TILE_SIZE);
    }

    for (const curtain of MAZE_CURTAINS) {
      const windowX = curtain.windowTile.x * TILE_SIZE - camX;
      const windowY = curtain.windowTile.y * TILE_SIZE - camY;
      if (isOnScreen(windowX, windowY))
        drawMazeCurtainWindow(ctx, windowX, windowY, TILE_SIZE, this.frame);
      if (this.openedCurtains.has(curtain.id)) continue;
      for (const tile of [curtain.humanBarrier, curtain.catBarrier]) {
        const x = tile.x * TILE_SIZE - camX;
        const y = tile.y * TILE_SIZE - camY;
        if (isOnScreen(x, y)) drawMazeCurtain(ctx, x, y, TILE_SIZE, this.frame);
      }
    }

    const hallShut = !this.hall.solved;
    for (const exit of MAZE_HALL_EXITS) {
      if (!hallShut) break;
      const x = exit.tile.x * TILE_SIZE - camX;
      const y = exit.tile.y * TILE_SIZE - camY;
      if (!isOnScreen(x, y)) continue;
      if (exit.kind === 'door') drawMazeExitDoor(ctx, x, y, TILE_SIZE, this.frame);
      else drawMazeActGate(ctx, x, y, TILE_SIZE, this.frame);
    }
    for (const half of MAZE_HALVES) {
      if (this.hall.isTeachingOpen(half)) continue;
      const tile = MAZE_TEACHING_DOORWAYS[half];
      const x = tile.x * TILE_SIZE - camX;
      const y = tile.y * TILE_SIZE - camY;
      if (isOnScreen(x, y)) drawMazeActGate(ctx, x, y, TILE_SIZE, this.frame);
    }
  }

  /** Every way that has given way, in the tent's "go" green. */
  private renderOpenedWays(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const block of MAZE_BLOCKS) {
      if (!this.clearedBlocks.has(block.id)) continue;
      const x = block.barrierTile.x * TILE_SIZE - camX;
      const y = block.barrierTile.y * TILE_SIZE - camY;
      if (isOnScreen(x, y))
        drawMazeWayOpen(ctx, x, y, TILE_SIZE, this.wayArtFor(block.barrierTile));
    }
    for (const curtain of MAZE_CURTAINS) {
      if (!this.openedCurtains.has(curtain.id)) continue;
      for (const tile of [curtain.humanBarrier, curtain.catBarrier]) {
        const x = tile.x * TILE_SIZE - camX;
        const y = tile.y * TILE_SIZE - camY;
        if (isOnScreen(x, y)) {
          drawMazeCurtainOpen(ctx, x, y, TILE_SIZE, {
            ...this.wayArtFor(tile),
            rise: this.curtainRiseFor(tile),
          });
        }
      }
    }
    const opened = [
      ...(this.hall.solved ? MAZE_HALL_EXITS.map((exit) => exit.tile) : []),
      ...MAZE_HALVES.filter((half) => this.hall.isTeachingOpen(half)).map(
        (half) => MAZE_TEACHING_DOORWAYS[half],
      ),
    ];
    for (const tile of opened) {
      const x = tile.x * TILE_SIZE - camX;
      const y = tile.y * TILE_SIZE - camY;
      if (isOnScreen(x, y)) drawMazeWayOpen(ctx, x, y, TILE_SIZE, this.wayArtFor(tile));
    }
  }

  /** How far an opened curtain's drape has lifted: 0 on the frame it opened, 1 once it has bunched up. */
  private curtainRiseFor(tile: MazeTile): number {
    const openedAt = this.openedFrames.get(tileKeyOf(tile.x, tile.y));
    if (openedAt === undefined) return 1;
    return Math.min(1, (this.frame - openedAt) / CURTAIN_RISE_FRAMES);
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
      drawShadedRope(
        ctx,
        [from, pulley, to],
        {
          pulled: this.clearedBlocks.has(block.id) || target?.broken === true,
          owner: MAZE_TARGET_OWNER[block.kind],
        },
        TILE_SIZE,
      );
    }
  }

  /** The grilles are architecture and stay whatever act it is. */
  private renderVentGrilles(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const run of VENT_GRATE_RUNS) {
      const x = run.x0 * TILE_SIZE - camX;
      const y = run.tileY * TILE_SIZE - camY;
      const lastColumn = run.columns[run.columns.length - 1] ?? run.x0;
      const right = (lastColumn + 1) * TILE_SIZE - camX;
      if (!isOnScreen(Math.min(right - TILE_SIZE, Math.max(x, 0)), y)) continue;
      drawFireBreatherGrateRun(ctx, run, x, y, TILE_SIZE);
    }
  }

  /**
   * Only a set that is still standing warns. A struck act glowing behind the
   * party would be the tent promising a hazard it has retired.
   */
  private renderVentTelegraphs(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const vent of this.liveVents) {
      const x = vent.tileX * TILE_SIZE - camX;
      const y = vent.tileY * TILE_SIZE - camY;
      if (!isOnScreen(x, y)) continue;
      const telegraph = ventTelegraphProgress(vent, this.frame);
      if (telegraph > 0) drawFireBreatherTelegraph(ctx, x, y, TILE_SIZE, telegraph);
    }
  }

  private renderSpotlightWarnings(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
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

  /**
   * Everything that must sit over the crawlers: the fire itself, the lantern
   * beams, the white-hot span of a limelight, and the
   * chip naming whose job the pulsing target is.
   */
  renderEffects(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const vent of this.liveVents) {
      const burn = ventFlameProgress(vent, this.frame);
      if (burn <= 0) continue;
      const x = vent.tileX * TILE_SIZE - camX;
      const y = vent.tileY * TILE_SIZE - camY;
      if (!isOnScreen(x, y, FLAME_COLUMN_HEIGHT_TILES)) continue;
      const flamePhase = ventFlamePhase(vent, this.frame);
      drawHeatShimmerFlare(ctx, x, y, TILE_SIZE, burn, flamePhase);
      drawFlameVentColumn(ctx, x, y, TILE_SIZE, burn, flamePhase);
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

    this.hall.renderEffects(ctx, camX, camY, this.frame, this.hallLightOn);

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
    const active = ctxFrame.active;
    const half = this.halfOf(active, ctxFrame.human);

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
    if (this.currentSectionId !== 'finale') this.renderCurtainHint(ctx, camX, camY, ctxFrame, half);
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
      drawInteractionPromptOver(ctx, mob, camX, camY, prompt, chip);
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

  /**
   * The crawler's nearest own mirror in the room they are standing in. The
   * hall and the teaching strip are a wall apart, and glass on the far side
   * of it can be nearer than the mirror at the crawler's elbow.
   */
  private nearestMirror(active: Player, half: MazeHalf): MazeMirrorTarget | null {
    const tile = tileOf(active);
    const room: HallBoardId | null = rectContains(MIRROR_BOARD_ROWS, tile.x, tile.y)
      ? 'hall'
      : rectContains(TEACHING_STRIP_ROWS, tile.x, tile.y)
        ? 'teaching'
        : null;
    if (room === null) return null;
    let best: MazeMirrorTarget | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const mirror of this.hall.mirrorsOf(room)) {
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
          : `${crawlerName('cat')}'s bell clears the boards. Otherwise, wait in the alcoves.`,
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
    const waitingFor = crawlerName(half === 'human' ? 'cat' : 'human');
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
    return byInputMode(activeInputMode(), {
      touch: 'the switch button',
      pointer: keycapLabel('switchCharacter'),
    });
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
        ? `${crawlerName('cat')} can reach that ${thing}. Press ${control} to switch.`
        : `${crawlerName('human')} can break that ${thing}. Press ${control} to switch.`,
    );
  }

  private drawWorldHint(
    ctx: CanvasRenderingContext2D,
    active: Player,
    camX: number,
    camY: number,
    line: string,
  ): void {
    worldText(ctx, line, {
      x: active.x - camX + TILE_SIZE * TILE_CENTRE,
      y: active.y - camY - TILE_SIZE * HINT_LIFT_TILES,
      size: HINT_SIZE,
      bold: true,
      color: worldPalette.starlightTent.hint,
      align: 'center',
      outline: worldPalette.starlightTent.hintOutline,
    });
  }

  /**
   * What the tent is asking for, in the act it is asking it in.
   *
   * Rebuilt every frame from what is actually still standing rather than left
   * as one line, because a count of barred doors reads as a bug once the last
   * of them has plainly opened.
   */
  private currentObjective(): { line: string; done: boolean } {
    const section = this.currentSectionId;
    if (section === 'finale') return this.finale.objective();

    if (section === 'mirrors') {
      if (this.hall.solved) return { line: this.nextBanner(), done: true };
      const shutLanes = MAZE_HALVES.filter((half) => !this.hall.isTeachingOpen(half)).length;
      if (shutLanes > 0) {
        return {
          line: `Light both of your stars at once: ${shutLanes} doorway${shutLanes === 1 ? '' : 's'} still shut`,
          done: false,
        };
      }
      const { lit, total } = this.hall.requiredLit();
      return { line: `Light every star at once: ${lit} of ${total} lit`, done: false };
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

  topBandEntries(): TopBandEntry[] {
    const banner = questBannerEntry({
      id: 'starlight-tent-banner',
      title: this.bannerTitle,
      subtitle: this.bannerSubtitle,
      framesLeft: this.bannerTimer,
    });
    const entries: TopBandEntry[] = banner === null ? [] : [banner];
    if (!this.isDialogOpen) {
      const objective = this.currentObjective();
      entries.push(
        objectiveBandEntry('starlight-tent-objective', {
          text: objective.line,
          tone: objective.done ? 'success' : 'warning',
        }),
      );
    }
    return entries;
  }

  renderUI(ctx: CanvasRenderingContext2D): void {
    // Under the boxes rather than over them: the white-out is the room going
    // white, and a message printed behind its own flash cannot be read.
    if (this.flashFrames > 0) {
      worldTint(
        ctx,
        worldPalette.starlightTent.burnoutFlash,
        (this.flashFrames / BURNOUT_FLASH_FRAMES) * BURNOUT_FLASH_PEAK_ALPHA,
      );
    }
  }
}

/**
 * What the house calls out when a barrier gives way.
 *
 * The banner rather than a world hint, because the hint channel sits over the
 * *active* crawler and the crawler this concerns is the other one.
 */
const WAY_OPENED_BANNER = 'The way is open';
const WAY_OPENED_FOR_HUMAN = `Switch to ${crawlerName('human')} and walk through.`;
const WAY_OPENED_FOR_CAT = `Switch to ${crawlerName('cat')} and walk through.`;
const WAY_OPENED_FOR_BOTH = 'Both lanes can go on.';
const TEACHING_OPENED_FOR_HUMAN = `${crawlerName('human')}'s doorway into the hall is open.`;
const TEACHING_OPENED_FOR_CAT = `${crawlerName('cat')}'s doorway into the hall is open.`;
const ENCORE_BANNER = 'Bravo!';
const ENCORE_PAID_SUBTITLE = 'An encore. The house throws coins.';
const ENCORE_REPEAT_SUBTITLE = 'An encore. The house has nothing left to throw.';

/** How loud a vent's ignition is against the rest of the tent. */
const VENT_IGNITION_VOLUME = 0.35;
/** A kindle is a warning, not the event, so it sits under the whoosh. */
const VENT_KINDLE_VOLUME = 0.25;

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
export function starlightTentWallAt(map: GameMap): (tileX: number, tileY: number) => boolean {
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
export function buildStarlightTentDressing(
  isWall: (tileX: number, tileY: number) => boolean,
  board: MirrorBoard,
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
    // A lamp on each room's outer side wall, level with where its crawler waits.
    const lampRow = curtain.windowTile.y;
    hangOnWall({ x: curtain.humanRoom.x0 - 1, y: lampRow }, 'intervalLamp', 'human', 0);
    hangOnWall({ x: curtain.catRoom.x1 + 1, y: lampRow }, 'intervalLamp', 'cat', 1);
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

  hangFireWalkKit(pieces, isWall);

  MAZE_SPOTLIGHTS.forEach((track, index) => {
    const lane = MENAGERIE_LANES.find((candidate) => candidate.half === track.half);
    if (lane === undefined || track.cells.length === 0) return;
    const row = track.cells[0].tileY;
    const x =
      track.half === 'human'
        ? lane.x0 + FOLLOW_SPOT_INSET_TILES
        : lane.x1 - FOLLOW_SPOT_INSET_TILES;
    hangOnWall({ x, y: row - 1 }, 'followSpot', track.half, index);
  });
  // Every bell stands in a one-tile shaft; its trough hangs on the drape beside it.
  MAZE_BELLS.forEach((bell, index) => {
    hangOnWall({ x: bell.tile.x + 1, y: bell.tile.y }, 'feedTrough', 'cat', index);
  });

  const dividerColumn = MIRROR_HALL_GLASS_COLUMNS[1];
  // A star, a light or a window already fills its tile of wall; a pane there
  // would sit under it. A light's housing also stands a tile tall on its
  // tripod, so the tile above it is taken too.
  const lights = [
    ...board.limelights.map((light) => boardTileToTent(light.tile)),
    ...TEACHING_STRIP_BOARD.limelights.map((light) => teachingTileToTent(light.tile)),
  ];
  const fixedInWall = new Set(
    [
      ...board.stars.map((star) => boardTileToTent(star.tile)),
      ...board.windows.map(boardTileToTent),
      ...TEACHING_STRIP_BOARD.stars.map((star) => teachingTileToTent(star.tile)),
      ...lights,
      ...lights.map((tile) => ({ x: tile.x, y: tile.y - 1 })),
    ].map((tile) => tileKeyOf(tile.x, tile.y)),
  );
  for (const column of MIRROR_HALL_GLASS_COLUMNS) {
    for (let y = MIRROR_HALL_ROWS.y0; y <= MIRROR_HALL_ROWS.y1; y += MIRROR_GLASS_STRIDE) {
      if (fixedInWall.has(tileKeyOf(column, y))) continue;
      hangOnWall(
        { x: column, y },
        'mirrorGlass',
        column < dividerColumn ? 'human' : 'cat',
        column * y,
      );
    }
  }

  // The dead audience in the ring's stands, tier on tier up the rim either side.
  const ring: MazeRect = MAZE_FINAL_CHAMBER;
  for (let y = ring.y0; y <= ring.y1; y++) {
    for (let tier = 0; tier < RING_BLEACHER_TIERS; tier++) {
      const west = { x: ring.x0 - 1 - tier, y };
      const east = { x: ring.x1 + 1 + tier, y };
      for (const [seat, owner] of [
        [west, 'human'],
        [east, 'cat'],
      ] as const) {
        if (backstageClutterAt(seat.x, seat.y) !== null) continue;
        hangOnWall(seat, 'ringBleacher', owner, seat.x * RING_SEAT_SEED_STRIDE + seat.y);
      }
    }
  }

  return pieces;
}

/** Spreads the stands' seeds so no two seats in a column share a spectator. */
const RING_SEAT_SEED_STRIDE = 53;

/** Which stand a seat is in, and how many rows back from the ring. */
function ringSeatOf(piece: Dressing): { side: 'west' | 'east'; tier: number } {
  const west = piece.tile.x < MAZE_FINAL_CHAMBER.x0;
  return {
    side: west ? 'west' : 'east',
    tier: west
      ? MAZE_FINAL_CHAMBER.x0 - 1 - piece.tile.x
      : piece.tile.x - MAZE_FINAL_CHAMBER.x1 - 1,
  };
}

/** The wall tile each track's follow-spot hangs on, keyed by track. */
function followSpotTilesOf(dressing: ReadonlyArray<Dressing>): ReadonlyMap<string, MazeTile> {
  const tiles = new Map<string, MazeTile>();
  for (const piece of dressing) {
    if (piece.kind !== 'followSpot') continue;
    if (piece.seed < MAZE_SPOTLIGHTS.length) tiles.set(MAZE_SPOTLIGHTS[piece.seed].id, piece.tile);
  }
  return tiles;
}

/**
 * Which lantern cells set each beast's cage lunging: every cell on the row
 * under a cage front, within reach along it, handed to the nearest cage whose
 * occupant can still lunge.
 */
function cageLungeCellsOf(
  dressing: ReadonlyArray<Dressing>,
): ReadonlyMap<Dressing, ReadonlyArray<VentSchedule>> {
  const beasts = dressing.filter(
    (piece) => piece.kind === 'cage' && occupantLunges(cageOccupantFor(piece.seed)),
  );
  const cells = new Map<Dressing, VentSchedule[]>();
  for (const track of MAZE_SPOTLIGHTS) {
    for (const cell of track.cells) {
      let nearest: Dressing | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const cage of beasts) {
        if (cage.tile.y !== cell.tileY - 1) continue;
        const distance = Math.abs(cage.tile.x - cell.tileX);
        if (distance > CAGE_LUNGE_REACH_TILES || distance >= nearestDistance) continue;
        nearest = cage;
        nearestDistance = distance;
      }
      if (nearest === null) continue;
      const list = cells.get(nearest) ?? [];
      list.push(cell);
      cells.set(nearest, list);
    }
  }
  return cells;
}

/**
 * The fire act's kit hung along the fire walk's drapes: every few faces a
 * fire hoop, a poster or a pair of fuel cans. Only on a drape over the act's
 * own floor, never beside a way that opens, and never where a piece already
 * hangs.
 */
function hangFireWalkKit(
  pieces: Dressing[],
  isWall: (tileX: number, tileY: number) => boolean,
): void {
  const firewalk = MAZE_SECTIONS.find((section) => section.id === 'firewalk');
  if (firewalk === undefined) return;
  const taken = new Set(pieces.map((piece) => tileKeyOf(piece.tile.x, piece.tile.y)));
  for (const block of MAZE_BLOCKS) {
    taken.add(tileKeyOf(block.grateTile.x, block.grateTile.y));
    for (let dx = -1; dx <= 1; dx++) {
      taken.add(tileKeyOf(block.barrierTile.x + dx, block.barrierTile.y));
    }
  }
  const inCurtainRoom = (x: number, y: number): boolean =>
    MAZE_CURTAINS.some(
      (curtain) => rectContains(curtain.humanRoom, x, y) || rectContains(curtain.catRoom, x, y),
    );
  let faces = 0;
  let hung = 0;
  for (let y = firewalk.rowRange.y0; y < firewalk.rowRange.y1; y++) {
    for (let x = 0; x < MAZE_WIDTH; x++) {
      const isDrapeFace = isWall(x, y) && !isWall(x, y + 1) && !isMazeBarrierTile(x, y + 1);
      if (!isDrapeFace || inCurtainRoom(x, y + 1) || taken.has(tileKeyOf(x, y))) continue;
      const turn = faces++;
      if (turn % FIRE_KIT_STRIDE !== 0) continue;
      const kit = FIRE_WALK_WALL_KITS[hung % FIRE_WALK_WALL_KITS.length];
      pieces.push({
        tile: { x, y },
        kind: kit,
        owner: x < ACT_BOARD_COLUMN ? 'human' : 'cat',
        seed: hung,
      });
      hung++;
    }
  }
}

/** How far into its room an interval lamp's pool falls, from the wall it hangs on. */
const INTERVAL_LAMP_THROW_TILES = 1.5;

/**
 * The lamps the dressing hangs, as the stage lights see them: a pool on every
 * footlight, on each striped arch post, and thrown into each interval room
 * from its lamp.
 */
function dressingLightFixtures(dressing: ReadonlyArray<Dressing>): LightFixture[] {
  const fixtures: LightFixture[] = [];
  for (const piece of dressing) {
    const x = piece.tile.x + TILE_CENTRE;
    const y = piece.tile.y + TILE_CENTRE;
    switch (piece.kind) {
      case 'footlight':
      case 'archPost':
        fixtures.push({ kind: piece.kind, x, y });
        break;
      case 'intervalLamp': {
        // The human's lamp hangs on its room's west wall and lights eastward.
        const intoRoom = piece.owner === 'human' ? 1 : -1;
        fixtures.push({ kind: 'intervalLamp', x: x + intoRoom * INTERVAL_LAMP_THROW_TILES, y });
        break;
      }
      case 'runner':
      case 'bleacher':
      case 'cage':
      case 'mirrorGlass':
      case 'ringBleacher':
      case 'fireHoop':
      case 'fuelCans':
      case 'dangerPoster':
      case 'followSpot':
      case 'feedTrough':
        break;
    }
  }
  return fixtures;
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
      tile: { x: curtain.windowTile.x, y: curtain.humanBarrier.y },
      label: section.banner,
    });
  }
  return boards;
}
