/**
 * LichBattleSystem — the four-phase choreography of the magistrate's office.
 *
 * `TheLich` keeps its own kit (soul bolts, grasping hands, a raised escort) and
 * fights with it in the first and last phases. In between, this system takes the
 * body away from it twice: once to pin it against the north wall behind a
 * gauntlet of fire the party has to thread, and once to put it out of reach
 * raining warned orbs until it tires. What changes between phases is what the
 * player is being asked to do, which is the only thing that can keep a fight
 * this long from being a bar that empties slowly.
 *
 * Everything the fight puts in the air — every wave, every orb, every warning
 * circle — is owned here and not by the mob. A projectile stored on a `Mob`
 * dies with the `Mob`, and half of this fight lands after the frame the Lich
 * would stop being drawn.
 *
 * The rules that have to be fair are in `lichBattleRules.ts`, where
 * `scripts/verify-lich.ts` can drive them headlessly. This file is what those
 * rules look like on screen.
 */

import { PLAYER_SPEED, TILE_SIZE } from '../core/constants';
import type { AudioManager } from '../audio/AudioManager';
import type { GameMap } from '../map/GameMap';
import { findNearbyWalkableTile } from '../map/findWalkableTile';
import type { DamageSource, Player } from '../Player';
import type { SystemContext } from './GameSystem';
import type { GroundHazardSource } from './GroundHazardSource';
import type { DialogPage } from '../ui/QuestDialog';
import { handsConeCovers, TheLich } from '../creatures/TheLich';
import { drawDangerCircle, drawDangerTile } from '../sprites/dangerTelegraph';
import { drawSoulBurst } from '../sprites/skeletonEffectsSprite';
import { drawFireWave, WAVE_MIN_LOOP_FRAMES } from '../sprites/fireWaveSprite';
import { drawLichOrb } from '../sprites/lichOrbSprite';
import { drawProgressBar, PROGRESS_PRESETS } from '../ui/Box';
import { viewportWidth } from '../core/Viewport';
import { LICH_FIREWALL_BARK, LICH_RECKONING_BARK, LICH_TANTRUM_BARK } from './murderQuestDialogs';
import {
  columnBurns,
  canHoldGap,
  DODGE_SURVIVAL_FRAMES,
  FIREWALL_TELEGRAPH_FRAMES,
  FIREWALL_GAP_WIDTH_TILES,
  FirewallGapPlanner,
  gapCentreColumn,
  LichPhaseMachine,
  ORB_IMPACT_RADIUS_TILES,
  ORB_SPAWN_INTERVAL_FRAMES,
  ORB_WARNING_FRAMES,
  OrbRainPlanner,
  RECKONING_ORB_SPAWN_INTERVAL_FRAMES,
  stepTowardSafety,
  type LichBattlePhase,
  type OrbRainRoom,
  type TileDanger,
  type TilePos,
} from './lichBattleRules';
import { mulberry32 } from '../sprites/person/rng';

// ── Scripted beats ───────────────────────────────────────────────────────────

/**
 * Frames a scripted slide takes to move a body to where the next phase needs it.
 *
 * Exported because it is part of the fight's timing contract rather than a
 * private detail: `verify:lich` measures how quickly the daze pays out blows
 * landed during the Lich's descent, and that window is this long.
 */
export const PUSH_SLIDE_FRAMES = 36;

// ── The firewall ─────────────────────────────────────────────────────────────

/**
 * Frames a wave takes to travel one tile south.
 *
 * The tower's office is fourteen walkable rows, so this crosses it in about
 * three seconds. Deliberately a hair slower than the player's own walk: running
 * south gains them nothing they can keep, because the wall arrives first, while
 * a step sideways is free. That is the lesson the phase exists to teach, and
 * setting the speed *below* a sprint rather than above it is what lets the
 * player discover it instead of being killed by it.
 */
const FIREWALL_TRAVEL_FRAMES_PER_TILE = 13;
/** Damage a wave does. Small: the real cost of a mistake here is the repetition. */
const FIREWALL_HIT_DAMAGE = 3;
/**
 * Named on the damage rather than left untagged.
 *
 * The death screen reads the last source a crawler was hurt by, and an untagged
 * environmental hit means "a burning tree". The Lich stands its own kit down for
 * the whole of both gauntlet phases, so the last thing that tagged anything is a
 * soul bolt from the opening — a player who burns to death threading the fire
 * would be told they were shot.
 */
const FIREWALL_DAMAGE_SOURCE: DamageSource = { kind: 'environmental', hazard: 'lichFirewall' };
const ORB_DAMAGE_SOURCE: DamageSource = { kind: 'environmental', hazard: 'lichOrb' };
/**
 * Quiet after a stage reset, before the waves start again.
 *
 * Measured from the end of the slide that carries the party back, not from the
 * hit: the planner's countdown does not run while a scripted slide owns the
 * frame, so the grace the player actually gets is this plus
 * {@link PUSH_SLIDE_FRAMES}. Stated here because a constant that silently means
 * something else is worse than one that costs a sentence.
 */
const FIREWALL_RESET_GRACE_FRAMES = 60;
/**
 * How close a crawler must be for the Lich to be hurt during the firewall.
 *
 * The whole phase is the walk up the room. A Magic Missile from the back row
 * would skip it, so damage is refused until somebody has actually arrived.
 */
const LICH_STRIKE_RANGE_TILES = 2;
/**
 * Danger weights for the companion's escape search, in its own units.
 *
 * Only their order carries meaning. The grasping hands outrank everything
 * because the cone takes a flat share of the victim's maximum health and roots
 * whoever it catches; an orb outranks a wall of fire because it is already
 * falling and cannot be walked around, only stepped out from under.
 */
const HANDS_TILE_DANGER = 120;
const ORB_TILE_DANGER = 100;
/**
 * How far outside an orb's blast the companion is still told to keep.
 *
 * Without it the escape rule is "am I standing in the circle?", which the
 * companion's own follow drive turns into a shuffle: it steps one tile clear,
 * the rule goes quiet, the drive walks it straight back in, and it spends the
 * whole warning hovering on the rim. Whether the orb catches it then comes down
 * to which side of the line it happened to be on when the orb landed.
 *
 * Margin makes the two rules disagree about different ground, so the shuffle
 * happens well clear of anything that can hurt it.
 *
 * Two tiles rather than one, and the second is not padding. Whether an orb
 * catches somebody is decided on the tile they round to, and a body can change
 * tile — diagonally, so by more than a tile of measured distance — on a step of
 * a few pixels. It can also be shoved a whole tile in one frame by the
 * separation that keeps crawlers out of mobs, which runs no hazard check at all.
 * One tile of margin left the companion parked exactly on the rim, where any of
 * that flipped her inside; the second tile is what the shove costs.
 */
const ORB_KEEPOUT_MARGIN_TILES = 2;
const ORB_KEEPOUT_RADIUS_TILES = ORB_IMPACT_RADIUS_TILES + ORB_KEEPOUT_MARGIN_TILES;
/**
 * The same margin, for the grasping-hands cone.
 *
 * Needed twice over here. The companion fights the Lich in melee, so it is
 * *inside* the cone every time one is cast, and the danger field is read at the
 * centre of the tile it rounds to rather than at its feet — a body standing on a
 * tile boundary can be well inside the cone while the tile it is scored on sits
 * outside. Both failures put it on the rim, and the rim is where the hands take
 * forty percent of its health.
 *
 * The angular margin is the arc that clears a tile at the cone's own reach, so
 * stepping out sideways clears it by as much as stepping out backwards does.
 */
const HANDS_KEEPOUT_MARGIN_PX = TILE_SIZE;
/**
 * A burning column's weight, before it is divided by the rows the wave still has
 * to cross to reach the companion.
 *
 * Divided rather than banded so that two walls with gaps in different columns
 * resolve in the order they arrive: the near wall's gap always outscores the far
 * wall's, which is the order the companion has to take them in. Without the
 * division a companion between two walls could walk into the near one's fire to
 * reach the far one's gap.
 */
const WAVE_TILE_DANGER = 60;
/** Where the Lich anchors itself, measured down from the room's north wall. */
const FIREWALL_ANCHOR_ROW_INSET = 1;
/**
 * Rows a wave must have left to travel, whatever else the storey's shape wants.
 *
 * The search for a clean starting row walks south; without a floor it could walk
 * all the way to the back wall and spawn waves that are over before they begin.
 */
const MIN_WAVE_TRAVEL_TILES = 6;
/**
 * How far a scripted destination may be nudged to land on walkable ground.
 *
 * The anchor and the room centre are arithmetic on the walkable *bounding box*,
 * which is not the same as a walkable tile: a storey with a buttress at the
 * midpoint of its north wall would otherwise park the Lich inside it, and a
 * slide's destination is written straight to the body with no collision to
 * catch it.
 */
const SCRIPTED_DESTINATION_SEARCH_RADIUS_TILES = 4;
/**
 * Frames per full flame loop.
 *
 * Taken from the art's own floor rather than chosen here: below it the sway
 * inside a parcel oscillates faster than the frame budget can sample, and the
 * whole wall either freezes or strobes.
 */
const FIREWALL_FLAME_LOOP_FRAMES = WAVE_MIN_LOOP_FRAMES;

// ── The tantrum ──────────────────────────────────────────────────────────────

/** How much faster than the player the Lich drifts while it is out of reach. */
const LICH_FLOAT_SPEED_RATIO = 1.75;
const LICH_FLOAT_SPEED = PLAYER_SPEED * LICH_FLOAT_SPEED_RATIO;
const ORB_DAMAGE = 4;
/** Frames the soul-burst of an orb impact stays on the floor. */
const ORB_BURST_FRAMES = 22;
/** How far inside the walls the float path runs, so the Lich never clips a wall. */
const FLOAT_PATH_INSET_TILES = 1;
/**
 * How near a perimeter station counts as reached, in pixels.
 *
 * Sized off the float speed rather than fixed: a threshold smaller than one
 * frame's travel is a station the Lich can never satisfy, and it would jitter on
 * the spot for the rest of the phase.
 */
const FLOAT_STATION_REACHED_PX = LICH_FLOAT_SPEED * 2;

// ── HUD ──────────────────────────────────────────────────────────────────────

const DODGE_BAR_WIDTH = 240;
const DODGE_BAR_HEIGHT = 10;
const DODGE_BAR_Y = 62;
const CENTER_OFFSET = 0.5;
const FRAMES_PER_SECOND = 60;

/** What the boss bar says the player should be doing, per phase. */
const OBJECTIVE_ONSLAUGHT = 'It has been keeping the magistrate’s appointments. End it.';
const OBJECTIVE_FIREWALL = 'Thread the fire. Reach the Lich.';
const OBJECTIVE_RECKONING = 'Finish it';

/** Banner cards, one per phase change. */
const FIREWALL_BANNER_TITLE = 'THE APPOINTMENT';
const FIREWALL_BANNER_SUBTITLE = 'Thread the fire. Reach the Lich.';
const TANTRUM_BANNER_TITLE = 'THE TANTRUM';
const TANTRUM_BANNER_SUBTITLE = 'Survive the rain until the Lich tires.';
const RECKONING_BANNER_TITLE = 'NOTHING LEFT TO SIGN';
const RECKONING_BANNER_SUBTITLE = 'Finish it.';

/** Volume for the wave ignition, which fires once per wave and would otherwise dominate. */
const WAVE_IGNITION_VOLUME = 0.5;
const ORB_LAUNCH_VOLUME = 0.4;

/**
 * The seed the fight's randomness runs from.
 *
 * Fixed rather than drawn from the clock: two players comparing notes on this
 * fight should be describing the same fight, and a scripted finale is the one
 * place in the game where a reproducible sequence is worth more than variety.
 * The player still cannot memorise it usefully — where the orbs fall depends on
 * where they are standing.
 */
const LICH_BATTLE_SEED = 0x11c4;

interface FireWave {
  readonly gapStart: number;
  /** Frames of telegraph left before it ignites; zero once it is burning. */
  telegraphFrames: number;
  /** Row in tiles, fractional while travelling south. */
  row: number;
}

interface OrbWarning {
  readonly tile: TilePos;
  framesLeft: number;
  /**
   * Whether the orb still bites when it arrives.
   *
   * Cleared, rather than the warning being deleted, when the daze opens: an orb
   * halfway down is a thing the player can see, and blinking it out of existence
   * reads as the game losing track of it. It finishes its fall, bursts, and does
   * nothing — which is also what keeps a player charging the newly-grounded Lich
   * from being hit by a rule that changed while they were committing to it.
   */
  dealsDamage: boolean;
}

interface OrbBurst {
  readonly tile: TilePos;
  framesLeft: number;
}

/** One body being carried to where the next phase needs it. */
interface SlideLeg {
  readonly body: Player | TheLich;
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
}

/**
 * The companion, as this fight needs to see it. An interface rather than the
 * class so the encounter can be built in a scene that has no companion at all.
 */
export interface CompanionDirector {
  setDirective(directive: { x: number; y: number; hold: boolean }): void;
  clearDirective(): void;
  registerHazardSource(source: GroundHazardSource): void;
}

/** What the fight asks of the encounter that owns it. */
export interface LichBattleHooks {
  /** Opens a one-page bark. The world is held while it is up. */
  openBark(pages: ReadonlyArray<DialogPage>, onClosed: () => void): void;
  /** Raises the phase card. */
  showBanner(title: string, subtitle: string): void;
}

/**
 * The office's walkable extent, found once at construction.
 *
 * Measured rather than assumed: the tower's storeys are generated, and a wave
 * sized to a hardcoded room would leave a burning column outside the wall on one
 * floor plan and a walkable gap outside the wave on another.
 */
interface RoomBounds {
  readonly minCol: number;
  readonly maxCol: number;
  readonly minRow: number;
  readonly maxRow: number;
}

export class LichBattleSystem implements GroundHazardSource {
  private readonly machine = new LichPhaseMachine();
  private readonly gapPlanner: FirewallGapPlanner;
  private readonly orbPlanner: OrbRainPlanner;
  private readonly bounds: RoomBounds;
  private readonly orbRoom: OrbRainRoom;

  private waves: FireWave[] = [];
  private warnings: OrbWarning[] = [];
  private bursts: OrbBurst[] = [];

  private slideLegs: ReadonlyArray<SlideLeg> = [];
  private slideFramesLeft = 0;
  /**
   * True from the first frame of a phase change until the slide that opens it
   * finishes. The scene withholds movement and attack input for its whole run,
   * or the player walks out of a walk-up the script is halfway through.
   */
  private scriptOwnsParty = false;

  /** The Lich's health last frame, so any route into it registers as a hit. */
  private lastObservedHp: number;
  /**
   * Hits the phase logic has not answered yet.
   *
   * A count, not a flag: the daze window opens under a descent this system
   * early-returns through, and a player who lands three blows on a Lich that is
   * still settling has landed three. A boolean credited them with one.
   *
   * Banked rather than read off the frame it lands for the same reason — the
   * frame a blow lands on may be one the phase logic is not running.
   */
  private unresolvedHits = 0;
  /**
   * Whether an orb caught the crawler the player is steering since the tantrum
   * last read it. Banked because impacts are resolved above the slide return,
   * which is a frame the phase logic does not run on.
   */
  private orbStruckActive = false;
  /** Per-column answers to {@link gapIsStandable}; the storey never changes. */
  private readonly standableGapCache = new Map<number, boolean>();
  private cachedWaveSpawnRow: number | null = null;
  private floatStation: TilePos | null = null;
  private orderedLaneColumn: number | null = null;
  private waveIgnitionSoundPending = false;
  /**
   * The crawlers, held from the last frame the fight was ticked.
   *
   * References rather than a precomputed answer, because the question the
   * firewall asks — "has anybody arrived?" — has to be answered at the moment
   * damage is offered, which is from the mob's side, where there is no frame
   * context. A boolean refreshed once a frame is a frame stale, and this system
   * teleports bodies: a scripted slide that carries the party from the Lich's
   * feet to the back wall would leave the gate reading "somebody is standing
   * right here" for the rest of that frame, and a damage-over-time tick landing
   * in that window ends the gauntlet before its first wave.
   */
  private crawlers: ReadonlyArray<Player> = [];

  constructor(
    private readonly map: GameMap,
    private readonly lich: TheLich,
    private readonly audio: AudioManager | null,
    private readonly companion: CompanionDirector | null,
    private readonly hooks: LichBattleHooks,
  ) {
    const rng = mulberry32(LICH_BATTLE_SEED);
    this.gapPlanner = new FirewallGapPlanner(rng);
    this.orbPlanner = new OrbRainPlanner(rng);
    this.bounds = findWalkableBounds(map);
    this.orbRoom = {
      minCol: this.bounds.minCol,
      maxCol: this.bounds.maxCol,
      minRow: this.bounds.minRow,
      maxRow: this.bounds.maxRow,
      isWalkable: (col, row) => this.map.isWalkable(col, row),
    };
    this.lastObservedHp = lich.hp;
    lich.battleDriver = {
      blocksDamage: () => this.blocksDamage(),
      drivesMovement: () => this.drivesMovement(),
      isDazed: () => this.isDazed(),
    };
    // Registration with the companion is deliberately not done here. It happens
    // from `update`, every frame, because a storey change clears the list and
    // coming back has to restore it — and one path that always runs beats a
    // constructor call plus a repair.
  }

  get phase(): LichBattlePhase {
    return this.machine.phase;
  }

  /** True while a scripted slide owns both crawlers' bodies. */
  get playerLocked(): boolean {
    return this.scriptOwnsParty;
  }

  /**
   * The band a wave occupies, from the row it is born on to the back wall.
   *
   * The birth row is computed from the storey rather than fixed, so it is not
   * something a reader — or a gate — can derive from the constants. Exposed
   * because it is half of the standability contract: a gap is only required to
   * be walkable over the rows a wave actually crosses.
   */
  get waveBand(): { readonly firstRow: number; readonly lastRow: number } {
    return { firstRow: Math.round(this.waveSpawnRow), lastRow: this.bounds.maxRow };
  }

  /**
   * Every wave currently on the floor: where its gap is, and where it has got to.
   *
   * Read by `verify:lich`, which checks each gap against the storey — the planner
   * being handed a usability test is one thing, and the fight handing it a
   * correct one is another, and only the second is what the player stands in.
   * The row comes with it because whether a crawler is in danger is a question
   * about a column *and* a wave that has not passed them yet; measured on the
   * column alone it reads as danger long after the fire has gone by.
   */
  get liveWaves(): ReadonlyArray<{ readonly gapStart: number; readonly row: number }> {
    return this.waves.map((wave) => ({ gapStart: wave.gapStart, row: wave.row }));
  }

  /**
   * The tile every orb still in the air *and still armed* is aimed at.
   *
   * Read by `verify:lich` two ways: to stand a crawler in one on purpose, since
   * a rain that stopped biting is invisible to a harness that only watches — and
   * to measure how near the companion is when one lands, which is the difference
   * between dodging and being missed. Defanged orbs are left out of both: they
   * are scenery, and nobody is supposed to be avoiding them.
   */
  get armedOrbTiles(): ReadonlyArray<TilePos> {
    return this.warnings.filter((warning) => warning.dealsDamage).map((warning) => warning.tile);
  }

  /**
   * The column the fight last told the companion to wait in, or null.
   *
   * Read by `verify:lich` so the *order* can be checked and not only where she
   * ends up standing. Hazard avoidance rescues a companion sent to the wrong
   * wave's gap, which is exactly what makes the outcome a poor witness: the
   * order can be wrong for the whole phase and the only symptom is a companion
   * repeatedly shoved out of ground she was told to stand on.
   */
  get companionLaneOrder(): number | null {
    return this.orderedLaneColumn;
  }

  /**
   * Orbs still in the air that would hurt somebody if they landed now.
   *
   * Read by `verify:lich` to hold the fight to its own promise: when the Lich
   * touches down, everything already falling has been defanged, so the window
   * the player is being told to charge into cannot cost them health on the way
   * in. Counting the threats is exact where waiting to see whether one happens
   * to land on somebody is a coin toss.
   */
  get liveOrbThreatCount(): number {
    return this.warnings.filter((warning) => warning.dealsDamage).length;
  }

  /** The boss bar's objective line for whatever the fight is asking right now. */
  get objectiveLine(): string {
    switch (this.machine.phase) {
      case 'onslaught':
        return OBJECTIVE_ONSLAUGHT;
      case 'firewall':
        return OBJECTIVE_FIREWALL;
      case 'tantrum':
        return this.machine.tantrumMode === 'daze'
          ? `The Lich is spent. Strike it now! (${this.machine.dazeHitsRemaining} more)`
          : `Survive the rain (${secondsLeftOnDodgeClock(this.machine.dodgeProgress)}s)`;
      case 'reckoning':
        return OBJECTIVE_RECKONING;
    }
  }

  // ── The creature's three questions ─────────────────────────────────────────

  private blocksDamage(): boolean {
    if (this.machine.phase !== 'firewall') return !this.machine.isVulnerable;
    // The gauntlet's one exception: somebody has to have arrived. Measured off
    // live positions rather than off the attacker, because the status-tick route
    // into a mob's health carries no attacker to measure at all — a burn applied
    // at the wall would otherwise be refused for the rest of the phase.
    //
    // The cost of asking "is anyone close?" instead of "was the attacker close?"
    // is that once one crawler reaches the Lich, a missile loosed from the back
    // row by the other lands too. That is the right side to err on: the rule
    // exists to stop the party skipping the walk, and by then somebody has
    // walked it.
    return !this.crawlers.some((crawler) => this.tilesFromLich(crawler) <= LICH_STRIKE_RANGE_TILES);
  }

  private drivesMovement(): boolean {
    if (this.slideFramesLeft > 0) return true;
    return this.machine.phase === 'firewall' || this.machine.phase === 'tantrum';
  }

  private isDazed(): boolean {
    return this.machine.phase === 'tantrum' && this.machine.tantrumMode === 'daze';
  }

  // ── Frame update ───────────────────────────────────────────────────────────

  update(ctx: SystemContext): void {
    if (!this.lich.isAlive) {
      this.clearHazards();
      return;
    }

    // Idempotent, and repeated every frame on purpose: leaving the storey
    // clears the companion's hazard list, and coming back has to put this fight
    // back on it without anybody outside remembering to.
    this.companion?.registerHazardSource(this);

    const crawlers = livingCrawlers(ctx);
    this.crawlers = crawlers;

    if (this.lich.hp < this.lastObservedHp) this.unresolvedHits++;
    this.lastObservedHp = this.lich.hp;

    this.tickBursts();
    // Above the slide's early return, so an orb halfway down keeps falling
    // through a scripted descent instead of hanging in the air for its length.
    // The result is banked rather than acted on here: only the tantrum's float
    // reads it, and it is the one caller that must not miss a frame of it.
    if (this.resolveOrbImpacts(crawlers, ctx.active)) this.orbStruckActive = true;

    if (this.slideFramesLeft > 0) {
      this.advanceSlide(ctx);
      return;
    }

    const hitsLanded = this.unresolvedHits;
    this.unresolvedHits = 0;

    switch (this.machine.phase) {
      case 'onslaught':
        if (this.machine.observeHealth(this.lich.hp / this.lich.maxHp)) this.enterFirewall(ctx);
        break;
      case 'firewall':
        this.updateFirewall(ctx, crawlers, hitsLanded);
        break;
      case 'tantrum':
        this.updateTantrum(ctx, crawlers, hitsLanded);
        break;
      case 'reckoning':
        this.updateReckoning(ctx);
        break;
    }
  }

  // ── Phase 2: the firewall ──────────────────────────────────────────────────

  private enterFirewall(ctx: SystemContext): void {
    this.gapPlanner.reset();
    this.waves = [];
    // Belt and braces, and honestly so: the bark that follows halts the world,
    // and the slide after it carries *both* crawlers to the south wall anyway,
    // so today there is no frame in which an unparked companion could walk north
    // into a room that is about to be on fire. The order costs nothing and keeps
    // that true if the bark is ever made skippable or the slide's cargo changes.
    // Not `directCompanionToGap` — there is no wave yet, so there is no gap to
    // name — but "get to the back and stop" is the right order either way.
    this.parkCompanionAtBackWall(ctx);
    // Barks play before their slide rather than over it. A slide does not halt
    // the world — only player input is withheld — so a bark opened over one
    // would be read while the fight ran underneath it. Opening it first is what
    // gets it a held world.
    this.hooks.openBark(LICH_FIREWALL_BARK, () => {
      this.hooks.showBanner(FIREWALL_BANNER_TITLE, FIREWALL_BANNER_SUBTITLE);
      this.audio?.play('skeleton_lord_chant');
      this.beginSlide([this.lichLegToAnchor(), ...this.partyLegsToSouthWall(ctx)]);
    });
  }

  private updateFirewall(
    ctx: SystemContext,
    crawlers: ReadonlyArray<Player>,
    hitsLanded: number,
  ): void {
    if (hitsLanded > 0 && this.machine.registerFirewallStrike()) {
      this.enterTantrum(ctx);
      return;
    }

    this.holdLichAtAnchor(ctx);
    this.spawnWaves();
    this.advanceWaves();
    // Collision runs here rather than in `render`: the scene's loop can run two
    // updates for one animation frame while catching up, and a wave that only
    // ever hurt somebody at draw time would pass straight through them.
    if (this.resolveWaveHits(ctx, crawlers)) return;
    this.directCompanionToGap(ctx);
  }

  private spawnWaves(): void {
    const span = { minCol: this.bounds.minCol, maxCol: this.bounds.maxCol };
    if (!canHoldGap(span)) return;
    const gapStart = this.gapPlanner.tick(span, (start) => this.gapIsStandable(start));
    if (gapStart === null) return;
    this.waves.push({
      gapStart,
      telegraphFrames: FIREWALL_TELEGRAPH_FRAMES,
      row: this.waveSpawnRow,
    });
  }

  private advanceWaves(): void {
    const surviving: FireWave[] = [];
    for (const wave of this.waves) {
      if (wave.telegraphFrames > 0) {
        wave.telegraphFrames--;
        if (wave.telegraphFrames === 0) this.waveIgnitionSoundPending = true;
        surviving.push(wave);
        continue;
      }
      wave.row += 1 / FIREWALL_TRAVEL_FRAMES_PER_TILE;
      if (wave.row <= this.bounds.maxRow) surviving.push(wave);
    }
    this.waves = surviving;
    if (this.waveIgnitionSoundPending) {
      this.waveIgnitionSoundPending = false;
      this.audio?.play('llama_fireball', { volume: WAVE_IGNITION_VOLUME });
    }
  }

  /** Returns true when a hit reset the stage, so the caller stops for the frame. */
  private resolveWaveHits(ctx: SystemContext, crawlers: ReadonlyArray<Player>): boolean {
    let anyCaught = false;
    for (const crawler of crawlers) {
      const tile = tileOf(crawler);
      const caught = this.waves.some(
        (wave) =>
          wave.telegraphFrames === 0 &&
          Math.round(wave.row) === tile.row &&
          columnBurns(tile.col, wave.gapStart),
      );
      if (!caught) continue;
      // Every crawler standing in the fire is burned by it, before the reset
      // clears the wave — stopping at the first would let one of the two walk
      // through a wall of flame for free whenever they were both in it.
      crawler.takeDamage(FIREWALL_HIT_DAMAGE, FIREWALL_DAMAGE_SOURCE);
      anyCaught = true;
    }
    if (!anyCaught) return false;
    this.resetFirewallStage(ctx);
    return true;
  }

  private resetFirewallStage(ctx: SystemContext): void {
    this.waves = [];
    this.gapPlanner.holdFor(FIREWALL_RESET_GRACE_FRAMES);
    this.beginSlide(this.partyLegsToSouthWall(ctx));
  }

  /**
   * Whether a gap starting at this column is standable for the whole of a wave's
   * journey down the room.
   *
   * The office is not a rectangle — it has pillars, and its corners are notched.
   * A gap placed on one is not a gap at all: the player is being shown a safe
   * column they cannot walk into, and the wave that follows is unavoidable.
   *
   * Cached, because the storey does not change and this is asked once per wave
   * per candidate column.
   */
  private gapIsStandable(gapStart: number): boolean {
    const cached = this.standableGapCache.get(gapStart);
    if (cached !== undefined) return cached;
    const standable = this.gapStandableFrom(gapStart, Math.round(this.waveSpawnRow));
    this.standableGapCache.set(gapStart, standable);
    return standable;
  }

  private gapStandableFrom(gapStart: number, spawnRow: number): boolean {
    for (let col = gapStart; col < gapStart + FIREWALL_GAP_WIDTH_TILES; col++) {
      for (let row = spawnRow; row <= this.bounds.maxRow; row++) {
        if (!this.map.isWalkable(col, row)) return false;
      }
    }
    return true;
  }

  /**
   * The row waves are born on.
   *
   * Not simply one row south of the anchor. The office has pillars, and a wave
   * that starts level with one has a column set full of holes: the gap can only
   * ever be placed in whichever fragment it started in, because moving between
   * fragments would break the three-column reachability contract, and the player
   * ends up watching the same two columns for the whole phase.
   *
   * So the waves start below the obstructions instead — the first row from which
   * every column of the path is clear all the way to the back wall. That buys
   * two things at once: a gap free to wander the whole room, and a few
   * fire-free rows at the Lich's feet, which is the reward for having threaded
   * the gauntlet rather than an oversight.
   */
  private get waveSpawnRow(): number {
    const cached = this.cachedWaveSpawnRow;
    if (cached !== null) return cached;
    const row = this.findWaveSpawnRow();
    this.cachedWaveSpawnRow = row;
    return row;
  }

  private findWaveSpawnRow(): number {
    // One row south of the anchor at the earliest, so the Lich never stands
    // inside its own fire.
    const earliest = Math.min(this.firewallAnchorTile.row + 1, this.bounds.maxRow);
    const latest = this.bounds.maxRow - MIN_WAVE_TRAVEL_TILES;
    let firstUsableRow: number | null = null;
    for (let row = earliest; row <= Math.max(earliest, latest); row++) {
      const starts = this.standableGapStartsFrom(row);
      if (starts.length === 0) continue;
      firstUsableRow ??= row;
      const isContiguous = starts[starts.length - 1] - starts[0] === starts.length - 1;
      if (isContiguous) return row;
    }
    // A storey where no starting row offers an unbroken run of gaps: take the
    // first that offers any, and let the planner's reachability clamp hold the
    // gap inside whichever fragment it lands in.
    return firstUsableRow ?? earliest;
  }

  private standableGapStartsFrom(spawnRow: number): number[] {
    const starts: number[] = [];
    const highestStart = this.bounds.maxCol - FIREWALL_GAP_WIDTH_TILES + 1;
    for (let start = this.bounds.minCol; start <= highestStart; start++) {
      if (this.gapStandableFrom(start, spawnRow)) starts.push(start);
    }
    return starts;
  }

  private get firewallAnchorTile(): TilePos {
    return this.walkableNear(
      Math.floor((this.bounds.minCol + this.bounds.maxCol) / 2),
      Math.min(this.bounds.minRow + FIREWALL_ANCHOR_ROW_INSET, this.bounds.maxRow),
    );
  }

  private lichLegToAnchor(): SlideLeg {
    const anchor = this.firewallAnchorTile;
    return {
      body: this.lich,
      fromX: this.lich.x,
      fromY: this.lich.y,
      toX: anchor.col * TILE_SIZE,
      toY: anchor.row * TILE_SIZE,
    };
  }

  private holdLichAtAnchor(ctx: SystemContext): void {
    const anchor = this.firewallAnchorTile;
    this.moveLichTo(ctx, anchor.col * TILE_SIZE, anchor.row * TILE_SIZE);
  }

  /**
   * Sends the companion to the back of the room in whatever column it is
   * already standing in, and tells it to stop fighting.
   *
   * The opening order of the gauntlet, before any wave has been planned. Its own
   * column rather than a chosen one: with nothing burning yet every column is as
   * safe as every other, and the shortest walk is the one that ends soonest.
   */
  private parkCompanionAtBackWall(ctx: SystemContext): void {
    if (this.companion === null) return;
    const col = clamp(tileOf(ctx.inactive).col, this.bounds.minCol, this.bounds.maxCol);
    this.companion.setDirective({
      x: col * TILE_SIZE,
      y: this.southmostWalkableRow(col) * TILE_SIZE,
      hold: true,
    });
  }

  private directCompanionToGap(ctx: SystemContext): void {
    if (this.companion === null) return;
    const lane = this.companionLaneColumn(tileOf(ctx.inactive).row);
    this.orderedLaneColumn = lane;
    if (lane === null) return;
    this.companion.setDirective({
      x: lane * TILE_SIZE,
      // The southernmost walkable row *in that column*, not the room's own
      // maximum: a storey with a bay or a buttress has columns that stop short
      // of it, and the room-wide figure would send the companion into a wall.
      y: this.southmostWalkableRow(lane) * TILE_SIZE,
      hold: true,
    });
  }

  /**
   * Which column of the arriving wall's gap the companion should wait in.
   *
   * Not its centre. A companion parked in the middle of its lane cannot move
   * until the wall has physically swept over it — every other column is on fire
   * — so it stands motionless while the wall bears down and then darts sideways
   * at the moment of contact. It always made it, and it always looked like it
   * only just made it, which is the same thing as looking like an accident.
   *
   * So it waits on the side of its lane the *next* gap is on. The handoff is
   * then a step or two rather than a sprint, taken the instant the fire clears,
   * and what the player watches is a companion that saw the wall coming.
   */
  private companionLaneColumn(row: number): number | null {
    const arriving = this.waveArrivingAt(row);
    const arrivingGap = arriving?.gapStart ?? this.gapPlanner.lastGapStart;
    if (arrivingGap === null) return null;
    const following = arriving === null ? null : this.waveFollowing(arriving);
    // The newest planned gap when nothing follows: before the first wave has
    // ignited that is the only gap there is, and the companion should already be
    // walking to it rather than waiting for the telegraph to catch fire.
    const followingGap = following?.gapStart ?? this.gapPlanner.lastGapStart;
    if (followingGap === null) return gapCentreColumn(arrivingGap);
    return clamp(
      gapCentreColumn(followingGap),
      arrivingGap,
      arrivingGap + FIREWALL_GAP_WIDTH_TILES - 1,
    );
  }

  /**
   * The wave that will next burn across a row, or null when none will.
   *
   * The *newest* wave is the wrong answer and was the bug: it belongs to the
   * wall still at the top of the room, and standing in its gap means standing in
   * a burning column of the wall that arrives first. Waves already south of the
   * row are excluded for the mirror-image reason — they have swept past it and
   * are never coming back.
   */
  private waveArrivingAt(row: number): FireWave | null {
    let arriving: FireWave | null = null;
    for (const wave of this.waves) {
      if (Math.round(wave.row) > row) continue;
      if (arriving === null || wave.row > arriving.row) arriving = wave;
    }
    return arriving;
  }

  /** The wall behind another one: the next to cross whatever that one crosses. */
  private waveFollowing(wave: FireWave): FireWave | null {
    let following: FireWave | null = null;
    for (const candidate of this.waves) {
      if (candidate.row >= wave.row) continue;
      if (following === null || candidate.row > following.row) following = candidate;
    }
    return following;
  }

  // ── Phase 3: the tantrum ───────────────────────────────────────────────────

  private enterTantrum(ctx: SystemContext): void {
    this.waves = [];
    this.warnings = [];
    this.orbPlanner.reset();
    this.orbPlanner.setInterval(ORB_SPAWN_INTERVAL_FRAMES);
    this.companion?.clearDirective();
    this.floatStation = null;
    this.hooks.openBark(LICH_TANTRUM_BARK, () => {
      this.hooks.showBanner(TANTRUM_BANNER_TITLE, TANTRUM_BANNER_SUBTITLE);
      this.audio?.play('deep_rumbling');
      this.beginSlide(this.partyLegsToRoomCentre(ctx));
    });
  }

  private updateTantrum(
    ctx: SystemContext,
    crawlers: ReadonlyArray<Player>,
    hitsLanded: number,
  ): void {
    if (this.machine.tantrumMode === 'daze') {
      for (let hit = 0; hit < hitsLanded; hit++) {
        if (!this.machine.registerDazeHit()) continue;
        this.enterReckoning();
        return;
      }
      this.holdLichAtRoomCentre(ctx);
      this.orbStruckActive = false;
      if (this.machine.tickTantrum(false) === 'daze_expired') this.audio?.play('charging_up_1');
      return;
    }

    this.floatAwayFromParty(ctx, crawlers);
    this.spawnOrbs(ctx);
    const struckPlayer = this.orbStruckActive;
    this.orbStruckActive = false;
    if (this.machine.tickTantrum(struckPlayer) === 'daze_started') this.beginDaze();
  }

  private beginDaze(): void {
    // The rain stops, and everything already falling is defanged rather than
    // deleted — see `OrbWarning.dealsDamage`.
    for (const warning of this.warnings) warning.dealsDamage = false;
    this.audio?.play('powering_off');
    const centre = this.roomCentreTile;
    this.beginSlide(
      [
        {
          body: this.lich,
          fromX: this.lich.x,
          fromY: this.lich.y,
          toX: centre.col * TILE_SIZE,
          toY: centre.row * TILE_SIZE,
        },
      ],
      // The party keeps their feet through this one: the descent is the starting
      // gun on a window they have three seconds to reach, and locking them out
      // of half a second of it would be taking back what it just gave.
      false,
    );
  }

  private holdLichAtRoomCentre(ctx: SystemContext): void {
    const centre = this.roomCentreTile;
    this.moveLichTo(ctx, centre.col * TILE_SIZE, centre.row * TILE_SIZE);
  }

  /**
   * Walks the Lich around the room's perimeter, choosing at each station the
   * neighbour that puts it further from the nearest crawler. Unreachable by
   * design: it is immune while it floats, and the phase is a dodge, not a chase.
   */
  private floatAwayFromParty(ctx: SystemContext, crawlers: ReadonlyArray<Player>): void {
    const stations = this.perimeterStations();
    if (stations.length === 0) return;
    let station = this.floatStation;
    if (station === null) {
      station = farthestStationFrom(stations, crawlers);
    } else {
      const targetX = station.col * TILE_SIZE;
      const targetY = station.row * TILE_SIZE;
      if (Math.hypot(targetX - this.lich.x, targetY - this.lich.y) <= FLOAT_STATION_REACHED_PX) {
        station = nextStationAwayFrom(stations, station, crawlers);
      }
    }
    this.floatStation = station;

    const targetX = station.col * TILE_SIZE;
    const targetY = station.row * TILE_SIZE;
    const dx = targetX - this.lich.x;
    const dy = targetY - this.lich.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= LICH_FLOAT_SPEED) {
      this.moveLichTo(ctx, targetX, targetY);
      return;
    }
    this.moveLichTo(
      ctx,
      this.lich.x + (dx / distance) * LICH_FLOAT_SPEED,
      this.lich.y + (dy / distance) * LICH_FLOAT_SPEED,
    );
  }

  private spawnOrbs(ctx: SystemContext): void {
    const target = this.orbPlanner.tick(
      this.orbRoom,
      tileOf(ctx.active),
      this.warnings.map((warning) => warning.tile),
    );
    if (target === null) return;
    this.warnings.push({ tile: target, framesLeft: ORB_WARNING_FRAMES, dealsDamage: true });
    this.audio?.play('magic_ball_launch', { volume: ORB_LAUNCH_VOLUME });
  }

  /** Lands every expired warning. Returns true when one of them caught the player. */
  private resolveOrbImpacts(crawlers: ReadonlyArray<Player>, active: Player): boolean {
    const surviving: OrbWarning[] = [];
    let struckActive = false;
    for (const warning of this.warnings) {
      warning.framesLeft--;
      if (warning.framesLeft > 0) {
        surviving.push(warning);
        continue;
      }
      this.bursts.push({ tile: warning.tile, framesLeft: ORB_BURST_FRAMES });
      this.audio?.play('magic_ball_impact');
      if (!warning.dealsDamage) continue;
      for (const crawler of crawlers) {
        if (tileDistance(tileOf(crawler), warning.tile) > ORB_IMPACT_RADIUS_TILES) continue;
        crawler.takeDamage(ORB_DAMAGE, ORB_DAMAGE_SOURCE);
        // Only the crawler the player is steering resets the dodge clock. The
        // companion dodges through the hazard interface, and a clock the player
        // cannot control would make the phase unfinishable through no fault of
        // their own.
        if (crawler === active) struckActive = true;
      }
    }
    this.warnings = surviving;
    return struckActive;
  }

  // ── Phase 4: the reckoning ─────────────────────────────────────────────────

  private enterReckoning(): void {
    // Nothing to defang here, and deliberately no loop that pretends otherwise:
    // this phase is reachable only through a daze, and `beginDaze` has already
    // taken the teeth out of everything in the air.
    this.orbPlanner.reset();
    this.orbPlanner.setInterval(RECKONING_ORB_SPAWN_INTERVAL_FRAMES);
    this.companion?.clearDirective();
    this.hooks.openBark(LICH_RECKONING_BARK, () => {
      this.hooks.showBanner(RECKONING_BANNER_TITLE, RECKONING_BANNER_SUBTITLE);
      this.audio?.play('skeleton_lord_chant');
    });
  }

  private updateReckoning(ctx: SystemContext): void {
    // No steering here: `drivesMovement` reports false in this phase, so the
    // Lich's own state machine has the body back — bolts, hands and summons.
    // The rain is resolved above, with the rest of the airborne state.
    this.spawnOrbs(ctx);
  }

  // ── Scripted slides ────────────────────────────────────────────────────────

  /**
   * Drops every hit the fight has not answered yet, including one that has
   * landed but not been counted.
   *
   * Both halves are needed. The counter holds hits already observed; the
   * comparison against {@link lastObservedHp} is what turns a health drop into
   * one, and it runs at the top of the next frame. Clearing the counter alone
   * leaves that comparison holding a stale reading, so a blow landed during a
   * window the party could not act through is not discarded — it is merely paid
   * out one frame later, which is the same bug with an extra step.
   */
  private forgetPendingHits(): void {
    this.unresolvedHits = 0;
    this.lastObservedHp = this.lich.hp;
  }

  private beginSlide(legs: ReadonlyArray<SlideLeg>, locksParty = true): void {
    if (legs.length === 0) return;
    this.slideLegs = legs;
    this.slideFramesLeft = PUSH_SLIDE_FRAMES;
    this.scriptOwnsParty = locksParty;
  }

  private advanceSlide(ctx: SystemContext): void {
    this.slideFramesLeft--;
    const progress = 1 - this.slideFramesLeft / PUSH_SLIDE_FRAMES;
    for (const leg of this.slideLegs) {
      const x = leg.fromX + (leg.toX - leg.fromX) * progress;
      const y = leg.fromY + (leg.toY - leg.fromY) * progress;
      if (leg.body instanceof TheLich) this.moveLichTo(ctx, x, y);
      else {
        leg.body.x = x;
        leg.body.y = y;
      }
    }
    if (this.slideFramesLeft > 0) return;
    this.slideLegs = [];
    // A slide the party could not act through banks nothing. Without this, a
    // blow the player was still following through on when the firewall opened —
    // or a burn tick, or the companion's missile, none of which the input lock
    // reaches — lands as "the player reached the Lich and struck it" on the
    // first frame of the gauntlet, and the whole phase is skipped before a
    // single wave has spawned.
    if (this.scriptOwnsParty) this.forgetPendingHits();
    this.scriptOwnsParty = false;
  }

  private partyLegsToSouthWall(ctx: SystemContext): SlideLeg[] {
    return livingCrawlers(ctx).map((crawler) => {
      const col = tileOf(crawler).col;
      return {
        body: crawler,
        fromX: crawler.x,
        fromY: crawler.y,
        toX: crawler.x,
        toY: this.southmostWalkableRow(col) * TILE_SIZE,
      };
    });
  }

  /**
   * The last walkable row in a column.
   *
   * `bounds.maxRow` is the southernmost walkable row *anywhere* in the room, and
   * a storey with a bay or a buttress has columns that stop short of it. Sliding
   * a crawler to the room's maximum in their own column would park them inside
   * the wall, where the next collision resolution has to shove them somewhere
   * arbitrary.
   */
  private southmostWalkableRow(col: number): number {
    for (let row = this.bounds.maxRow; row >= this.bounds.minRow; row--) {
      if (this.map.isWalkable(col, row)) return row;
    }
    return this.bounds.maxRow;
  }

  private partyLegsToRoomCentre(ctx: SystemContext): SlideLeg[] {
    const centre = this.roomCentreTile;
    return livingCrawlers(ctx).map((crawler, index) => {
      // Side by side rather than stacked, so the separation pass does not
      // immediately shove one of them back out of the spot it was placed in —
      // and each slot resolved to walkable ground separately, because a slide
      // writes straight to the body with no collision to catch it.
      const slot = this.walkableNear(centre.col + index, centre.row);
      return {
        body: crawler,
        fromX: crawler.x,
        fromY: crawler.y,
        toX: slot.col * TILE_SIZE,
        toY: slot.row * TILE_SIZE,
      };
    });
  }

  private get roomCentreTile(): TilePos {
    return this.walkableNear(
      Math.floor((this.bounds.minCol + this.bounds.maxCol) / 2),
      Math.floor((this.bounds.minRow + this.bounds.maxRow) / 2),
    );
  }

  /**
   * The nearest walkable tile to a computed destination, or the destination
   * itself if the storey has none within reach — which would mean a room with
   * no floor, and nothing this fight does could help.
   */
  private walkableNear(col: number, row: number): TilePos {
    const tile = findNearbyWalkableTile(
      this.map,
      col,
      row,
      SCRIPTED_DESTINATION_SEARCH_RADIUS_TILES,
    );
    return tile === null ? { col, row } : { col: tile.x, row: tile.y };
  }

  /**
   * The ring the float path runs on, one tile inside the walls, walked
   * clockwise. Only walkable stations are kept, so a storey with furniture
   * against a wall routes around it instead of through it.
   */
  private perimeterStations(): ReadonlyArray<TilePos> {
    const left = this.bounds.minCol + FLOAT_PATH_INSET_TILES;
    const right = this.bounds.maxCol - FLOAT_PATH_INSET_TILES;
    const top = this.bounds.minRow + FLOAT_PATH_INSET_TILES;
    const bottom = this.bounds.maxRow - FLOAT_PATH_INSET_TILES;
    if (right <= left || bottom <= top) return [];
    const ring: TilePos[] = [];
    for (let col = left; col <= right; col++) ring.push({ col, row: top });
    for (let row = top + 1; row <= bottom; row++) ring.push({ col: right, row });
    for (let col = right - 1; col >= left; col--) ring.push({ col, row: bottom });
    for (let row = bottom - 1; row > top; row--) ring.push({ col: left, row });
    return ring.filter((station) => this.map.isWalkable(station.col, station.row));
  }

  private moveLichTo(ctx: SystemContext, x: number, y: number): void {
    const previousX = this.lich.x;
    const previousY = this.lich.y;
    if (previousX === x && previousY === y) return;
    this.lich.x = x;
    this.lich.y = y;
    // Without this the mob's hit-test entry stays in the cell it left, and every
    // swing aimed at where it is drawn misses.
    ctx.roster.grid.move(this.lich, previousX, previousY);
  }

  /**
   * Whether one tile of a wave is on fire.
   *
   * Masonry does not burn. Without this the wall of flame paints straight
   * through the office's pillars and its notched corners, which reads as art
   * that has lost track of the room rather than as a hazard.
   */
  private burnsTile(col: number, row: number, gapStart: number): boolean {
    if (!columnBurns(col, gapStart)) return false;
    return this.map.isWalkable(col, row);
  }

  private tilesFromLich(crawler: Player): number {
    return Math.hypot(crawler.x - this.lich.x, crawler.y - this.lich.y) / TILE_SIZE;
  }

  // ── Ground hazards, for the companion ──────────────────────────────────────

  getHazardEscapeVector(x: number, y: number): { dx: number; dy: number } | null {
    const from = tileOf({ x, y });
    const step = stepTowardSafety(this.orbRoom, this.dangerFieldFrom(from), from);
    if (step === null) return null;
    const dx = step.col * TILE_SIZE - x;
    const dy = step.row * TILE_SIZE - y;
    const length = Math.hypot(dx, dy);
    // Never zero: `step` is a neighbour of the tile `x, y` rounds to, so it
    // cannot also be the tile `x, y` is standing in.
    return { dx: dx / length, dy: dy / length };
  }

  /**
   * How dangerous each tile of the room is to a body standing on `from`.
   *
   * Every wall of fire is weighed from where that body is rather than from the
   * tile being scored, which is what keeps the field free of a north-south
   * gradient. Scored per tile, a wall would look less dangerous the further
   * south it was read, and running south from a wave that travels south would
   * come out as an escape — a race the wall wins every time. Weighed from the
   * body, a burning column is exactly as bad wherever you stand in it, so the
   * only answer the search can find is the one that is true: step sideways.
   *
   * Waves already south of the body are left out entirely. They have swept past
   * and are never coming back, and counting them would have the companion flee
   * ground that is now the safest in the room.
   */
  private dangerFieldFrom(from: TilePos): TileDanger {
    // A defanged orb is scenery. Fleeing one costs the companion the whole daze
    // window, which is the one stretch of the phase it is meant to spend hitting
    // the thing.
    const orbs = this.warnings.filter((warning) => warning.dealsDamage).map((w) => w.tile);
    const telegraphed = this.lich.telegraphedHandsCone;
    const cone =
      telegraphed === null
        ? null
        : {
            ...telegraphed,
            rangePx: telegraphed.rangePx + HANDS_KEEPOUT_MARGIN_PX,
            halfAngle:
              telegraphed.halfAngle + Math.atan2(HANDS_KEEPOUT_MARGIN_PX, telegraphed.rangePx),
          };
    const walls: Array<{ gapStart: number; weight: number }> = [];
    for (const wave of this.waves) {
      // Rounded the same way the collision test rounds it. Read raw, a wave
      // three-tenths of a tile into the row somebody is standing on reports them
      // as *behind* it and safe — for six frames of every thirteen, on the one
      // row where the answer matters most.
      const rowsAway = from.row - Math.round(wave.row);
      if (rowsAway < 0) continue;
      walls.push({ gapStart: wave.gapStart, weight: WAVE_TILE_DANGER / (1 + rowsAway) });
    }

    return (tile) => {
      let danger = 0;
      for (const orb of orbs) {
        if (tileDistance(tile, orb) <= ORB_KEEPOUT_RADIUS_TILES) danger += ORB_TILE_DANGER;
      }
      for (const wall of walls) {
        if (columnBurns(tile.col, wall.gapStart)) danger += wall.weight;
      }
      if (cone !== null) {
        const centreX = (tile.col + CENTER_OFFSET) * TILE_SIZE;
        const centreY = (tile.row + CENTER_OFFSET) * TILE_SIZE;
        if (handsConeCovers(cone, centreX, centreY)) danger += HANDS_TILE_DANGER;
      }
      return danger;
    };
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  /**
   * The marks on the floor: a wave's row before it ignites, and the circle an
   * orb is going to land in. Ground paint, drawn under the figures — a warning a
   * crawler stood on top of would be a warning they hide from themselves.
   */
  renderWorld(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const wave of this.waves) {
      if (wave.telegraphFrames === 0) continue;
      const row = Math.round(wave.row);
      const screenY = row * TILE_SIZE - camY;
      const fade = 1 - wave.telegraphFrames / FIREWALL_TELEGRAPH_FRAMES;
      for (let col = this.bounds.minCol; col <= this.bounds.maxCol; col++) {
        if (!this.burnsTile(col, row, wave.gapStart)) continue;
        drawDangerTile(ctx, col * TILE_SIZE - camX, screenY, TILE_SIZE, fade);
      }
    }

    for (const warning of this.warnings) {
      drawDangerCircle(
        ctx,
        (warning.tile.col + CENTER_OFFSET) * TILE_SIZE - camX,
        (warning.tile.row + CENTER_OFFSET) * TILE_SIZE - camY,
        TILE_SIZE * ORB_IMPACT_RADIUS_TILES,
        1 - warning.framesLeft / ORB_WARNING_FRAMES,
      );
    }
  }

  /**
   * The hazards themselves, drawn over the crawlers.
   *
   * A wall of fire is a wall, not a decal: a crawler drawn in front of the
   * column they are standing inside reads as somebody who is fine. The same
   * goes for an orb, which is falling out of the air rather than lying on the
   * floor, and for the burst it makes when it arrives.
   */
  renderEffects(ctx: CanvasRenderingContext2D, camX: number, camY: number, frame: number): void {
    const flamePhase = (frame % FIREWALL_FLAME_LOOP_FRAMES) / FIREWALL_FLAME_LOOP_FRAMES;
    for (const wave of this.waves) {
      if (wave.telegraphFrames > 0) continue;
      const row = Math.round(wave.row);
      const screenY = row * TILE_SIZE - camY;
      for (let col = this.bounds.minCol; col <= this.bounds.maxCol; col++) {
        if (!this.burnsTile(col, row, wave.gapStart)) continue;
        drawFireWave(ctx, col * TILE_SIZE - camX, screenY, TILE_SIZE, flamePhase);
      }
    }

    for (const warning of this.warnings) {
      drawLichOrb(
        ctx,
        (warning.tile.col + CENTER_OFFSET) * TILE_SIZE - camX,
        (warning.tile.row + CENTER_OFFSET) * TILE_SIZE - camY,
        TILE_SIZE,
        1 - warning.framesLeft / ORB_WARNING_FRAMES,
      );
    }

    for (const burst of this.bursts) {
      drawSoulBurst(
        ctx,
        (burst.tile.col + CENTER_OFFSET) * TILE_SIZE - camX,
        (burst.tile.row + CENTER_OFFSET) * TILE_SIZE - camY,
        TILE_SIZE,
        1 - burst.framesLeft / ORB_BURST_FRAMES,
      );
    }
  }

  /** The dodge clock, drawn under the boss bar for the phase that has one. */
  renderUI(ctx: CanvasRenderingContext2D): void {
    if (this.machine.phase !== 'tantrum') return;
    if (this.machine.tantrumMode !== 'float') return;
    drawProgressBar(ctx, {
      x: viewportWidth() / 2 - DODGE_BAR_WIDTH / 2,
      y: DODGE_BAR_Y,
      width: DODGE_BAR_WIDTH,
      height: DODGE_BAR_HEIGHT,
      value: this.machine.dodgeProgress,
      ...PROGRESS_PRESETS.stamina,
    });
  }

  private tickBursts(): void {
    const surviving: OrbBurst[] = [];
    for (const burst of this.bursts) {
      burst.framesLeft--;
      if (burst.framesLeft > 0) surviving.push(burst);
    }
    this.bursts = surviving;
  }

  private clearHazards(): void {
    this.waves = [];
    this.warnings = [];
    this.bursts = [];
    this.slideLegs = [];
    this.slideFramesLeft = 0;
    this.scriptOwnsParty = false;
  }

  /**
   * The party has walked off this storey.
   *
   * A scripted slide only advances from `update`, and `update` only runs while
   * this is the storey the party is standing on — so a slide interrupted by a
   * staircase would hold `playerLocked` true for the whole of the rest of the
   * building, withholding movement, attacks and the switch key on every floor
   * until they climbed back. Finishing it outright is both the simplest fix and
   * the right one: the slide exists to put bodies somewhere, and they should be
   * there when the party returns.
   */
  leaveFloor(ctx: SystemContext): void {
    if (this.slideFramesLeft === 0) return;
    for (const leg of this.slideLegs) {
      // The Lich goes through `moveLichTo`, never a bare write: a mob teleported
      // without its grid cell keeps its hit-test entry where it left, and every
      // swing aimed at where it is drawn misses. It does not self-repair either,
      // because the next frame's hold finds it already at the target and moves
      // nothing.
      if (leg.body instanceof TheLich) this.moveLichTo(ctx, leg.toX, leg.toY);
      else {
        leg.body.x = leg.toX;
        leg.body.y = leg.toY;
      }
    }
    this.slideLegs = [];
    this.slideFramesLeft = 0;
    this.scriptOwnsParty = false;
    // The bodies were carried by something the party could not act through, so
    // nothing that landed during it is theirs to spend — the same rule
    // `advanceSlide` applies when a locking slide ends normally.
    this.forgetPendingHits();
  }

  /**
   * Everything this fight put in the room goes with it, and the Lich gets its
   * own body back — a driver left attached to a creature that outlives this
   * system would answer every question with a phase that no longer exists.
   */
  dispose(): void {
    this.clearHazards();
    this.companion?.clearDirective();
    this.lich.battleDriver = null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function livingCrawlers(ctx: SystemContext): ReadonlyArray<Player> {
  return [ctx.human, ctx.cat].filter((crawler) => crawler.isAlive);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function tileOf(body: { x: number; y: number }): TilePos {
  return {
    col: Math.round(body.x / TILE_SIZE),
    row: Math.round(body.y / TILE_SIZE),
  };
}

function tileDistance(a: TilePos, b: TilePos): number {
  return Math.hypot(a.col - b.col, a.row - b.row);
}

/**
 * The countdown beside the dodge bar. Floored at one rather than allowed to
 * reach zero: a clock reading "0s" for the last sixtieth of a second reads as a
 * stuck timer, and the daze it is counting toward announces itself anyway.
 */
function secondsLeftOnDodgeClock(progress: number): number {
  const framesLeft = (1 - progress) * DODGE_SURVIVAL_FRAMES;
  return Math.max(1, Math.ceil(framesLeft / FRAMES_PER_SECOND));
}

function farthestStationFrom(
  stations: ReadonlyArray<TilePos>,
  crawlers: ReadonlyArray<Player>,
): TilePos {
  let best = stations[0];
  let bestDistance = -Infinity;
  for (const station of stations) {
    const distance = nearestCrawlerTileDistance(station, crawlers);
    if (distance <= bestDistance) continue;
    bestDistance = distance;
    best = station;
  }
  return best;
}

/**
 * The next station clockwise or anticlockwise, whichever moves away from the
 * party. A ring walked in one fixed direction would eventually walk the Lich
 * straight through whoever is chasing it.
 */
function nextStationAwayFrom(
  stations: ReadonlyArray<TilePos>,
  current: TilePos,
  crawlers: ReadonlyArray<Player>,
): TilePos {
  const index = stations.findIndex(
    (station) => station.col === current.col && station.row === current.row,
  );
  if (index < 0) return farthestStationFrom(stations, crawlers);
  const forward = stations[(index + 1) % stations.length];
  const backward = stations[(index - 1 + stations.length) % stations.length];
  return nearestCrawlerTileDistance(forward, crawlers) >=
    nearestCrawlerTileDistance(backward, crawlers)
    ? forward
    : backward;
}

function nearestCrawlerTileDistance(station: TilePos, crawlers: ReadonlyArray<Player>): number {
  let nearest = Infinity;
  for (const crawler of crawlers) {
    nearest = Math.min(nearest, tileDistance(station, tileOf(crawler)));
  }
  return nearest;
}

function findWalkableBounds(map: GameMap): RoomBounds {
  let minCol = Infinity;
  let maxCol = -Infinity;
  let minRow = Infinity;
  let maxRow = -Infinity;
  for (let row = 0; row < map.structure.length; row++) {
    const cells = map.structure[row];
    for (let col = 0; col < cells.length; col++) {
      if (!map.isWalkable(col, row)) continue;
      minCol = Math.min(minCol, col);
      maxCol = Math.max(maxCol, col);
      minRow = Math.min(minRow, row);
      maxRow = Math.max(maxRow, row);
    }
  }
  // A room with no walkable tile at all cannot be fought in; collapsing to a
  // single degenerate tile keeps every consumer's arithmetic finite rather than
  // spreading Infinity through the wave and orb geometry.
  if (minCol > maxCol || minRow > maxRow) return { minCol: 0, maxCol: 0, minRow: 0, maxRow: 0 };
  return { minCol, maxCol, minRow, maxRow };
}
