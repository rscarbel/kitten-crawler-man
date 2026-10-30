import { TILE_SIZE } from '../core/constants';
import type { Camera } from '../core/rendering/camera';
import type { InteriorFigure } from '../core/rendering/InteriorFigure';
import type { CrawlerKind } from '../core/skills/SkillManager';
import type { Rarity } from '../core/items/defs/rarity';
import type { ClawTrail } from '../core/items/equipment/weapons';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { Mob } from '../creatures/Mob';
import { hitTrainingOn, resolveCrawlerHit, type ResolvedHit } from '../core/combat/outgoingHit';
import { FIRE_HIT, UNTAGGED_HIT, type DamageTags } from '../core/combat/damageTags';
import { runTickHooks, wornClaws, wornTraits } from '../gear/gearHooks';
import { FULL_NOTICE_RANGE_SHARE, type GearFxRequest } from '../gear/gearLive';
import { advancePartnerBond } from '../gear/partnerBond';
import { setCompletionPieces, setRarity, wornSets } from '../gear/setProgress';
import type { GearSetId } from '../gear/sets';
import {
  GEAR_REGEN_KEYS,
  landGearStatus,
  MIN_GEAR_STRIKE_DAMAGE,
  type GearTraitOf,
  type GearWorld,
  type OnHitStatusKind,
} from '../gear/traits';
import type { Player } from '../Player';
import {
  drawAwakening,
  drawBramble,
  drawChainArc,
  drawClawSwipe,
  drawLastStand,
  drawLastStandEdges,
  drawNinthLife,
  drawPartnerTether,
  drawRelic,
  drawRelicBolt,
  drawRiposteGlint,
  drawSetShimmer,
  drawShockwave,
  drawSlashWave,
  drawStillnessRegen,
  drawVanishWisps,
  drawWardShatter,
  drawBucklerBlock,
} from '../sprites/art/gearFxArt';
import { palette } from '../ui/theme/tokens';
import { worldPlate } from '../ui/world/worldShapes';
import type { GameSystem } from './GameSystem';
import { GEAR_CUES, type GearSoundCue } from './gearTraitSoundCues';
import type { SceneWorld } from './kits/SceneWorld';
import type { TownPropRenderable } from './townPropRenderable';

/** The fixed step the scene loop runs at, in frames per update. */
const FRAMES_PER_UPDATE = 1;
const HALF_TILE = TILE_SIZE / 2;
/** A body sorts on the foot of its tile, one tile below its depth line; a relic sorts on the same footing. */
const RELIC_SORT_FOOT_PX = TILE_SIZE;

/** How far she may drift in a frame and still count as standing still, in world pixels. */
const STILL_TOLERANCE_PX = 0.5;

/** The world's pace while a last stand runs: half speed. */
const LAST_STAND_WORLD_SPEED = 0.5;

/** A relic bolt's flight speed, in world pixels a frame. */
const RELIC_BOLT_SPEED_PX = 5;
/** How close a bolt comes to its target's centre before it lands. */
const RELIC_BOLT_HIT_RADIUS_TILES = 0.45;
const RELIC_BOLT_HIT_RADIUS_PX = TILE_SIZE * RELIC_BOLT_HIT_RADIUS_TILES;
/** A bolt that has not landed in this long has lost its target and fizzles. */
const RELIC_BOLT_MAX_FRAMES = 180;
/** A bolt hits for this share of its wearer's own bare blow. */
const RELIC_BOLT_DAMAGE_SHARE = 0.5;

/** How long a relic's bramble stands, and how far it reaches. */
const BRAMBLE_FRAMES = 240;
const BRAMBLE_RADIUS_TILES = 1.1;
const BRAMBLE_RADIUS_PX = TILE_SIZE * BRAMBLE_RADIUS_TILES;
/** A mob standing in the bramble is held this long, refreshed each frame it stays in. */
const BRAMBLE_ROOT_FRAMES = 6;
/** The patch lies on the floor, so it is drawn squashed to this share of its width. */
const BRAMBLE_GROUND_DEPTH = 0.6;

/** How fast a slash wave travels and how wide it cuts, in world pixels. */
const SLASH_WAVE_SPEED_PX = 6;
const SLASH_WAVE_HALF_WIDTH_TILES = 0.6;
const SLASH_WAVE_HALF_WIDTH_PX = TILE_SIZE * SLASH_WAVE_HALF_WIDTH_TILES;

/** How far out from his body toward the shooter a shield meets a shot. */
const BUCKLER_BLOCK_REACH_TILES = 0.35;
const BUCKLER_BLOCK_REACH_PX = TILE_SIZE * BUCKLER_BLOCK_REACH_TILES;

/** How long each kind of picture hangs in the air, in frames. */
const FX_FRAMES: Readonly<Record<GearFxRequest['kind'], number>> = {
  chainArc: 12,
  shockwave: 18,
  lifeSaved: 40,
  awakened: 50,
  setShimmer: 45,
  wardShatter: 20,
  bucklerBlock: 14,
  clawTrail: 9,
  slashWave: 0,
};

/**
 * Each crawler's outer side, away from her partner, where her hourglass
 * floats, so a pair standing together never stack their marks between them.
 * Where the two stand level, each keeps the side it had.
 */
const OUTER_START_SIDE: Readonly<Record<CrawlerKind, number>> = { human: -1, cat: 1 };
/** How far apart, across the screen, the pair must stand before an outer side changes over. */
const SIDE_SWAP_GAP_PX = 4;
/** The share of the way to its new side a mark glides each frame, so a swap is a drift, not a jump. */
const SIDE_EASE = 0.12;
const HOURGLASS_SIDE_TILES = 0.42;
const HOURGLASS_SIDE_PX = TILE_SIZE * HOURGLASS_SIDE_TILES;
/** One slow lap of a relic round its wearer, in gear ticks. */
const RELIC_ORBIT_PERIOD_FRAMES = 360;
const RELIC_ORBIT_RADIANS_PER_FRAME = (Math.PI * 2) / RELIC_ORBIT_PERIOD_FRAMES;
/** Half the orbit's width: wide enough that the relic clears the body as it passes in front. */
const RELIC_ORBIT_RADIUS_TILES = 0.55;
const RELIC_ORBIT_RADIUS_X_PX = TILE_SIZE * RELIC_ORBIT_RADIUS_TILES;
/** The orbit is a level circle seen in the 3/4 view, so its depth is drawn this much as tall as it is wide. */
const RELIC_ORBIT_FORESHORTENING = 0.42;
const RELIC_ORBIT_RADIUS_Y_PX = RELIC_ORBIT_RADIUS_X_PX * RELIC_ORBIT_FORESHORTENING;
/**
 * Each crawler's bob runs half a beat from the other's, so the pair never bob
 * in step. Their laps share one phase instead: two relics in step keep the
 * pair's own spacing, where laps half a turn apart would swing both into the
 * gap between a pair standing side by side and stack them there.
 */
const RELIC_BOB_PHASE: Readonly<Record<CrawlerKind, number>> = { human: 0, cat: Math.PI };
/** How far above each crawler's tile centre her shoulder is: he stands tall, she is low to the floor. */
const HUMAN_SHOULDER_RISE_TILES = 0.72;
const CAT_SHOULDER_RISE_TILES = 0.3;
const RELIC_SHOULDER_RISE_PX: Readonly<Record<CrawlerKind, number>> = {
  human: TILE_SIZE * HUMAN_SHOULDER_RISE_TILES,
  cat: TILE_SIZE * CAT_SHOULDER_RISE_TILES,
};
const RELIC_BOB_PX = 1.5;
const RELIC_BOB_RADIANS_PER_FRAME = 0.06;
/** Where the floor is under a crawler, as a share of a tile below her tile's top. */
const FEET_TILES = 0.92;
const FEET_PX = TILE_SIZE * FEET_TILES;
/** Where the top of each crawler's head is, down from her tile's top: his is above it, hers inside it. */
const HUMAN_HEAD_TOP_TILES = -0.8;
const CAT_HEAD_TOP_TILES = 0.4;
const HEAD_TOP_PX: Readonly<Record<CrawlerKind, number>> = {
  human: TILE_SIZE * HUMAN_HEAD_TOP_TILES,
  cat: TILE_SIZE * CAT_HEAD_TOP_TILES,
};
/** The middle of each crawler's drawn body above her tile centre, where a burst from her starts. */
const HUMAN_BODY_RISE_TILES = 0.45;
const BODY_RISE_PX: Readonly<Record<CrawlerKind, number>> = {
  human: TILE_SIZE * HUMAN_BODY_RISE_TILES,
  cat: 0,
};
/** The hourglass floats beside her head: the space over it already holds her own bar. */
const HOURGLASS_DROP_PX = 6;
/** The partner tether runs between chests, not feet or tile centres. */
const HUMAN_CHEST_RISE_TILES = 0.4;
const CAT_CHEST_RISE_TILES = 0.05;
const TETHER_CHEST_RISE_PX: Readonly<Record<CrawlerKind, number>> = {
  human: TILE_SIZE * HUMAN_CHEST_RISE_TILES,
  cat: TILE_SIZE * CAT_CHEST_RISE_TILES,
};

/** The glint sits out on her facing side, at about where a hand would be. */
const RIPOSTE_GLINT_REACH_TILES = 0.45;
const RIPOSTE_GLINT_REACH_PX = TILE_SIZE * RIPOSTE_GLINT_REACH_TILES;

/**
 * Combo pips: their size and gap, and how far below her feet they sit. They go
 * under her rather than over her head, where her own bar already is, and drop
 * clear of the selection ring lying round the feet of the crawler being driven.
 */
const COMBO_PIP_SIZE_PX = 4;
const COMBO_PIP_GAP_PX = 2;
const COMBO_PIP_DROP_PX = 9;

/** The shades a set's shimmer is drawn in, by rarity. */
const RARITY_SHIMMER: Readonly<Record<Rarity, string>> = {
  Common: palette.rarity.common.glow,
  Uncommon: palette.rarity.uncommon.glow,
  Rare: palette.rarity.rare.glow,
  Epic: palette.rarity.epic.glow,
  Legendary: palette.rarity.legendary.glow,
  Divine: palette.rarity.divine.glow,
};

type Crawler = HumanPlayer | CatPlayer;

/**
 * A worn relic as a figure in a scene's Y-sorted pass: the dungeon's sorts on
 * `sortY`, an interior's on `depthY`, and both cull on `x`/`y`, the wearer's
 * tile.
 */
export interface RelicFigure extends TownPropRenderable, InteriorFigure {
  x: number;
  y: number;
  depthY: number;
  sortY: number;
}

/**
 * What a relic's bolt is, for the proficiency skills: the burn it lands says
 * it is flame, and a bolt that only wounds is no kind of hit in particular.
 */
function relicBoltTags(status: OnHitStatusKind | undefined): DamageTags {
  return status === 'burn' ? FIRE_HIT : UNTAGGED_HIT;
}

/**
 * A slash wave thrown off `owner`'s swipe landing on `mob`: a blow of her own
 * melee, of her claws' kind, that left her body and so cannot be guarded.
 */
function slashWaveHit(owner: Crawler, mob: Mob): ResolvedHit {
  return resolveCrawlerHit({
    dealer: owner,
    delivery: owner.meleeDelivery,
    blowAt: (melee) => Math.max(MIN_GEAR_STRIKE_DAMAGE, Math.round(owner.getMeleeDamage(melee))),
    tags: owner.meleeHitTags(),
    training: hitTrainingOn(mob),
    damageType: 'melee',
    struckBy: 'unguardable',
  });
}

interface RelicBolt {
  readonly owner: Crawler;
  readonly target: Mob;
  readonly status: OnHitStatusKind | undefined;
  x: number;
  y: number;
  ageFrames: number;
}

interface Bramble {
  readonly owner: Crawler;
  readonly x: number;
  readonly y: number;
  framesLeft: number;
}

interface SlashWave {
  readonly owner: Crawler;
  readonly dirX: number;
  readonly dirY: number;
  readonly rangePx: number;
  readonly trail: ClawTrail | null;
  readonly struck: Set<Mob>;
  x: number;
  y: number;
  travelledPx: number;
}

/** A picture hanging in the air, aged until it fades. */
interface LiveFx {
  readonly owner: Crawler;
  readonly request: GearFxRequest;
  /** Frozen where she stood when it began, for the pictures drawn around her. */
  readonly atX: number;
  readonly atY: number;
  ageFrames: number;
}

function centreOf(body: { readonly x: number; readonly y: number }): { x: number; y: number } {
  return { x: body.x + HALF_TILE, y: body.y + HALF_TILE };
}

/** The share of its life a picture has left, 1 when fresh. */
function fxLeft(fx: LiveFx): number {
  const life = FX_FRAMES[fx.request.kind];
  return life <= 0 ? 0 : Math.max(0, 1 - fx.ageFrames / life);
}

/**
 * Runs the two crawlers' gear between frames: every worn trait's tick hook,
 * each reading and writing the per-item state on its wearer's `gear`, which
 * travels with the crawler through every snapshot; set completion; the relics
 * circling them and what those relics throw; and the pictures traits ask
 * for. It is also each trait's view of the world (`GearWorld`).
 *
 * Equip and unequip hooks run from the crawler's own equipment listener
 * instead, since a scene that builds several combat kits would otherwise run
 * them once per kit.
 */
export class GearSystem implements GameSystem, GearWorld {
  private readonly human: HumanPlayer;
  private readonly cat: CatPlayer;
  private bolts: RelicBolt[] = [];
  private brambles: Bramble[] = [];
  private waves: SlashWave[] = [];
  private fx: LiveFx[] = [];
  private soundCues: GearSoundCue[] = [];
  private frame = 0;
  /** Each crawler's side away from her partner, -1 her left to 1 her right, eased between. */
  private readonly outerSides: Record<CrawlerKind, number> = { ...OUTER_START_SIDE };
  /** One figure per crawler for her relic in the Y-sorted pass, reused every frame. */
  private readonly relicFigureOf: Readonly<Record<CrawlerKind, RelicFigure>>;
  private readonly relicFigures: RelicFigure[] = [];
  /** Whether each crawler's last stand and vanish were running last tick, so each sounds as it starts and ends. */
  private readonly heardRunning: Record<CrawlerKind, { lastStand: boolean; vanished: boolean }> = {
    human: { lastStand: false, vanished: false },
    cat: { lastStand: false, vanished: false },
  };
  /** Fractional world steps owed, so a slowed world advances on a steady beat. */
  private worldClock = 0;
  private readonly unsubscribe: () => void;

  /** Told when a crawler first has a whole set on, for the set's achievement. */
  onSetCompleted: ((crawler: CrawlerKind, set: GearSetId) => void) | null = null;
  /** Told of every kill a relic landed, credited to its wearer. */
  onRelicKill: ((crawler: CrawlerKind) => void) | null = null;

  constructor(private readonly world: SceneWorld) {
    this.human = world.pm.human;
    this.cat = world.pm.cat;
    this.relicFigureOf = {
      human: this.relicFigure(this.human),
      cat: this.relicFigure(this.cat),
    };
    // A curse binds until the party next walks into a safe room.
    this.unsubscribe = world.bus.on('safeRoomEntered', () => {
      this.human.gear.releaseBinds();
      this.cat.gear.releaseBinds();
    });
  }

  update(): void {
    this.frame++;
    const together = !this.human.isAway && !this.cat.isAway;
    // A worn hush reaches the other crawler too, so both are cleared before
    // either ticks: clearing one inside its own tick would undo what the
    // first crawler's tick had just granted her.
    this.human.gear.live.noticeRangeShare = FULL_NOTICE_RANGE_SHARE;
    this.cat.gear.live.noticeRangeShare = FULL_NOTICE_RANGE_SHARE;
    this.tickCrawler(this.human, together ? this.cat : null);
    this.tickCrawler(this.cat, together ? this.human : null);
    this.easeOuterSides();
    this.updateBolts();
    this.updateBrambles();
    this.updateWaves();
    for (const fx of this.fx) fx.ageFrames++;
    this.fx = this.fx.filter((fx) => fxLeft(fx) > 0);
  }

  /**
   * Whether the world takes its step this frame. Every frame normally; every
   * other frame while a crawler's last stand slows it. The crawlers
   * themselves keep their own pace, which is the point.
   */
  takeWorldStep(): boolean {
    const slowed =
      this.human.gear.live.lastStandFrames > 0 || this.cat.gear.live.lastStandFrames > 0;
    this.worldClock += slowed ? LAST_STAND_WORLD_SPEED : 1;
    if (this.worldClock < 1) return false;
    this.worldClock -= 1;
    return true;
  }

  // ── GearWorld ───────────────────────────────────────────────────────────

  enemiesNear(x: number, y: number, radiusPx: number): readonly Mob[] {
    const found: Array<{ mob: Mob; dist: number }> = [];
    // Widened by a tile because the grid keys a mob by its origin while the
    // test measures its centre.
    for (const mob of this.world.roster.grid.queryCircle(x, y, radiusPx + TILE_SIZE)) {
      if (!mob.isHostileTarget || !mob.takesPlayerDamage('melee')) continue;
      const at = centreOf(mob);
      const dist = Math.hypot(at.x - x, at.y - y);
      if (dist <= radiusPx) found.push({ mob, dist });
    }
    found.sort((a, b) => a.dist - b.dist);
    return found.map((entry) => entry.mob);
  }

  fireRelicBolt(wearer: Player, target: Mob, status: OnHitStatusKind | undefined): void {
    const owner = this.crawlerOf(wearer);
    if (owner === null) return;
    const from = this.relicPosition(owner);
    this.soundCues.push({ takes: GEAR_CUES.relicBolt, x: from.x, y: from.y });
    this.bolts.push({
      owner,
      target,
      status,
      x: from.x,
      y: from.y,
      ageFrames: 0,
    });
  }

  plantBramble(wearer: Player, x: number, y: number): void {
    const owner = this.crawlerOf(wearer);
    if (owner === null) return;
    this.brambles.push({ owner, x, y, framesLeft: BRAMBLE_FRAMES });
    this.soundCues.push({ takes: GEAR_CUES.bramble, x, y });
  }

  // ── Per crawler ─────────────────────────────────────────────────────────

  private crawlerOf(wearer: Player): Crawler | null {
    if (wearer === this.human) return this.human;
    if (wearer === this.cat) return this.cat;
    return null;
  }

  private kindOf(crawler: Crawler): CrawlerKind {
    return crawler === this.human ? 'human' : 'cat';
  }

  /** `partner` is null while either crawler is away from the party: a link cannot reach a cat in another building. */
  private tickCrawler(crawler: Crawler, partner: Crawler | null): void {
    const live = crawler.gear.live;
    const moved =
      live.lastX === null ||
      live.lastY === null ||
      Math.abs(crawler.x - live.lastX) + Math.abs(crawler.y - live.lastY) > STILL_TOLERANCE_PX;
    live.stillFrames = moved ? 0 : live.stillFrames + FRAMES_PER_UPDATE;
    live.lastX = crawler.x;
    live.lastY = crawler.y;
    live.vanishFrames = Math.max(0, live.vanishFrames - FRAMES_PER_UPDATE);
    live.lastStandFrames = Math.max(0, live.lastStandFrames - FRAMES_PER_UPDATE);
    live.riposteFrames = Math.max(0, live.riposteFrames - FRAMES_PER_UPDATE);

    // Every bonus a tick grants is granted afresh each tick, so one that stops
    // applying — a set broken, a partner walked off — lapses on its own.
    const statBonusBefore = live.partnerLinkStatBonus;
    for (const key of GEAR_REGEN_KEYS) crawler.clearRegenModifier(key);
    live.stillnessRegenActive = false;
    live.partnerLinked = false;
    live.partnerLinkStatBonus = 0;

    this.dropLapsedRuns(crawler);
    runTickHooks(crawler, { dtFrames: FRAMES_PER_UPDATE, partner, world: this });

    if (live.partnerLinkStatBonus !== statBonusBefore) crawler.syncHpToMaxHp();
    const { bond, formed } = advancePartnerBond(
      live.partnerBond,
      live.partnerLinked,
      FRAMES_PER_UPDATE,
    );
    live.partnerBond = bond;
    this.noteRunningChanges(crawler, formed);
    this.noteSetCompletions(crawler);
    this.takeFx(crawler);
  }

  /**
   * Clears the runs a trait keeps on her that the trait itself would clear on
   * its own tick — a combo's count, an armed riposte, a slash wave's swipe
   * count — once she no longer has the trait on: a set broken mid-run must
   * not leave its pips hanging over her.
   */
  private dropLapsedRuns(crawler: Crawler): void {
    const live = crawler.gear.live;
    const worn = new Set(wornTraits(crawler).map(({ trait }) => trait.kind));
    if (!worn.has('combo')) {
      live.comboHits = 0;
      live.comboWindowFrames = 0;
      live.comboTarget = 0;
    }
    if (!worn.has('riposte')) live.riposteFrames = 0;
    if (!worn.has('slashWave')) live.swipeCount = 0;
  }

  /** Sounds a last stand or a vanish as it starts or ends, and a partner link as it forms anew. */
  private noteRunningChanges(crawler: Crawler, linkFormed: boolean): void {
    const live = crawler.gear.live;
    const heard = this.heardRunning[this.kindOf(crawler)];
    const at = this.bodyOf(crawler);
    const standing = live.lastStandFrames > 0;
    if (standing !== heard.lastStand) {
      const takes = standing ? GEAR_CUES.lastStandBegins : GEAR_CUES.lastStandEnds;
      this.soundCues.push({ takes, x: at.x, y: at.y });
    }
    if (live.vanished && !heard.vanished) {
      this.soundCues.push({ takes: GEAR_CUES.vanish, x: at.x, y: at.y });
    }
    if (linkFormed) {
      this.soundCues.push({ takes: GEAR_CUES.partnerLink, x: at.x, y: at.y });
    }
    heard.lastStand = standing;
    heard.vanished = live.vanished;
  }

  private noteSetCompletions(crawler: Crawler): void {
    const live = crawler.gear.live;
    const complete = new Set<GearSetId>();
    for (const [set, worn] of wornSets(crawler.inventory.equipment.equippedIds())) {
      const needed = setCompletionPieces(set);
      if (needed > 0 && worn >= needed) complete.add(set);
    }
    // The first look after a load or a rewind only learns what she has on: a
    // set worn into the save was completed long ago.
    if (live.completedSetsSeeded) {
      for (const set of complete) {
        if (live.completedSets.has(set)) continue;
        live.queueFx({ kind: 'setShimmer', rarity: setRarity(set) });
        this.onSetCompleted?.(this.kindOf(crawler), set);
      }
    }
    live.completedSets = complete;
    live.completedSetsSeeded = true;
  }

  /** The gear sounds queued since the last drain, for the combat kit to play. */
  drainSoundCues(): GearSoundCue[] {
    return this.soundCues.splice(0, this.soundCues.length);
  }

  /**
   * Where each worn relic floats this frame, for its hum. A relic on a
   * crawler hidden from view is left out with its picture.
   */
  relicHumPoints(): Array<{ x: number; y: number }> {
    const points: Array<{ x: number; y: number }> = [];
    for (const crawler of [this.human, this.cat]) {
      if (crawler.concealed || crawler.isAway || this.relicOf(crawler) === null) continue;
      points.push(this.relicPosition(crawler));
    }
    return points;
  }

  private queueFxSound(crawler: Crawler, request: GearFxRequest): void {
    switch (request.kind) {
      // Every set of claws is heard on the swing itself (`catMeleeSwing`),
      // trail or none, so the trail it leaves adds nothing to hear.
      case 'clawTrail':
        break;
      case 'slashWave':
        this.soundCues.push({ takes: GEAR_CUES.slashWave, x: request.x, y: request.y });
        break;
      case 'wardShatter': {
        const at = this.relicPosition(crawler);
        this.soundCues.push({ takes: GEAR_CUES.wardBlock, x: at.x, y: at.y });
        break;
      }
      case 'bucklerBlock': {
        const at = this.bucklerBlockPoint(crawler, request);
        this.soundCues.push({ takes: GEAR_CUES.bucklerBlock, x: at.x, y: at.y });
        break;
      }
      case 'chainArc':
        this.soundCues.push({ takes: GEAR_CUES.chainSpark, x: request.toX, y: request.toY });
        break;
      case 'shockwave':
        if (request.source === 'flinchNova') {
          this.soundCues.push({ takes: GEAR_CUES.flinchCrow, x: request.x, y: request.y });
        }
        break;
      case 'lifeSaved':
      case 'awakened':
      case 'setShimmer': {
        const at = this.bodyOf(crawler);
        this.soundCues.push({ takes: GEAR_CUES[request.kind], x: at.x, y: at.y });
        break;
      }
    }
  }

  private takeFx(crawler: Crawler): void {
    for (const request of crawler.gear.live.drainFx()) {
      this.queueFxSound(crawler, request);
      if (request.kind === 'bucklerBlock' && crawler === this.human) {
        this.human.raiseOffHandBlock();
      }
      if (request.kind === 'slashWave') {
        this.waves.push({
          owner: crawler,
          dirX: request.dirX,
          dirY: request.dirY,
          rangePx: request.rangePx,
          trail: wornClaws(crawler)?.trail ?? null,
          struck: new Set(),
          x: request.x,
          y: request.y,
          travelledPx: 0,
        });
        continue;
      }
      const at = centreOf(crawler);
      this.fx.push({ owner: crawler, request, atX: at.x, atY: at.y, ageFrames: 0 });
    }
  }

  // ── What relics and claws throw ─────────────────────────────────────────

  private updateBolts(): void {
    const flying: RelicBolt[] = [];
    for (const bolt of this.bolts) {
      bolt.ageFrames++;
      if (!bolt.target.isAlive || bolt.ageFrames > RELIC_BOLT_MAX_FRAMES) continue;
      const to = centreOf(bolt.target);
      const dx = to.x - bolt.x;
      const dy = to.y - bolt.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= RELIC_BOLT_HIT_RADIUS_PX) {
        this.landBolt(bolt);
        continue;
      }
      const step = Math.min(RELIC_BOLT_SPEED_PX, dist);
      bolt.x += (dx / dist) * step;
      bolt.y += (dy / dist) * step;
      flying.push(bolt);
    }
    this.bolts = flying;
  }

  private landBolt(bolt: RelicBolt): void {
    const { owner, target } = bolt;
    if (owner.zeroDamage) return;
    const hpBefore = target.hp;
    // Struck by nothing that can be guarded, and no weapon type: a relic's
    // kill trains no weapon skill and feeds no ability.
    const struck = resolveCrawlerHit({
      dealer: owner,
      delivery: owner.meleeDelivery,
      blowAt: (melee) =>
        Math.max(
          MIN_GEAR_STRIKE_DAMAGE,
          Math.round(owner.getMeleeDamage(melee) * RELIC_BOLT_DAMAGE_SHARE),
        ),
      tags: relicBoltTags(bolt.status),
      training: hitTrainingOn(target),
      damageType: null,
      struckBy: 'unguardable',
    });
    target.takeHit(struck);
    const killed = hpBefore > 0 && target.hp <= 0;
    if (bolt.status !== undefined && !killed) landGearStatus(owner, target, bolt.status);
    if (killed && target.paysRewards) {
      this.onRelicKill?.(this.kindOf(owner));
    }
  }

  private updateBrambles(): void {
    for (const bramble of this.brambles) {
      bramble.framesLeft--;
      for (const mob of this.enemiesNear(bramble.x, bramble.y, BRAMBLE_RADIUS_PX)) {
        if (!mob.isBoss) mob.root(BRAMBLE_ROOT_FRAMES, bramble);
      }
    }
    this.brambles = this.brambles.filter((bramble) => bramble.framesLeft > 0);
  }

  private updateWaves(): void {
    const map = this.world.gameMap;
    const moving: SlashWave[] = [];
    for (const wave of this.waves) {
      wave.x += wave.dirX * SLASH_WAVE_SPEED_PX;
      wave.y += wave.dirY * SLASH_WAVE_SPEED_PX;
      wave.travelledPx += SLASH_WAVE_SPEED_PX;
      const blocked = !map.isWalkable(
        Math.floor(wave.x / TILE_SIZE),
        Math.floor(wave.y / TILE_SIZE),
        'walker',
      );
      if (blocked || wave.travelledPx > wave.rangePx) continue;
      if (!wave.owner.zeroDamage) {
        for (const mob of this.enemiesNear(wave.x, wave.y, SLASH_WAVE_HALF_WIDTH_PX)) {
          if (wave.struck.has(mob)) continue;
          wave.struck.add(mob);
          mob.takeHit(slashWaveHit(wave.owner, mob));
        }
      }
      moving.push(wave);
    }
    this.waves = moving;
  }

  /** Drops everything thrown into this map, for a floor change or a rewind. */
  reset(): void {
    this.bolts = [];
    this.brambles = [];
    this.waves = [];
    this.fx = [];
    this.worldClock = 0;
    this.soundCues = [];
    for (const heard of Object.values(this.heardRunning)) {
      heard.lastStand = false;
      heard.vanished = false;
    }
  }

  dispose(): void {
    this.unsubscribe();
  }

  // ── Drawing ─────────────────────────────────────────────────────────────

  private relicFigure(crawler: Crawler): RelicFigure {
    return {
      x: crawler.x,
      y: crawler.y,
      depthY: crawler.depthY,
      sortY: crawler.depthY + RELIC_SORT_FOOT_PX,
      render: (ctx, camX, camY) => this.drawRelic(ctx, crawler, camX, camY),
    };
  }

  /** The relic trait a crawler has on, if any: one relic per crawler, so the first one found. */
  private relicOf(crawler: Crawler): {
    trait: GearTraitOf<'relic'>;
    recharging: boolean;
  } | null {
    for (const { ctx, trait } of wornTraits(crawler)) {
      if (trait.kind !== 'relic') continue;
      return { trait, recharging: (ctx.state.cooldownFrames.relic ?? 0) > 0 };
    }
    return null;
  }

  private easeOuterSides(): void {
    const gap = this.human.x - this.cat.x;
    for (const [kind, awayFromPartner] of [
      ['human', Math.sign(gap)],
      ['cat', -Math.sign(gap)],
    ] as const) {
      const target = Math.abs(gap) < SIDE_SWAP_GAP_PX ? this.keptSide(kind) : awayFromPartner;
      this.outerSides[kind] += (target - this.outerSides[kind]) * SIDE_EASE;
    }
  }

  private keptSide(kind: CrawlerKind): number {
    return this.outerSides[kind] >= 0 ? 1 : -1;
  }

  /** Where a crawler's relic floats this frame, in world pixels. */
  private relicPosition(crawler: Crawler): { x: number; y: number } {
    const { x, y } = this.relicOrbit(crawler);
    return { x, y };
  }

  /**
   * Where a crawler's relic is on its lap round her this frame. `depthPx` is
   * how far nearer the camera than her it is, on the floor plane: negative on
   * the far half of the lap, where her body hides it.
   */
  private relicOrbit(crawler: Crawler): { x: number; y: number; depthPx: number } {
    const at = centreOf(crawler);
    const kind = this.kindOf(crawler);
    const angle = this.frame * RELIC_ORBIT_RADIANS_PER_FRAME;
    const depthPx = Math.sin(angle) * RELIC_ORBIT_RADIUS_Y_PX;
    const bobPhase = RELIC_BOB_PHASE[kind];
    const bob = Math.sin(this.frame * RELIC_BOB_RADIANS_PER_FRAME + bobPhase) * RELIC_BOB_PX;
    return {
      x: at.x + Math.cos(angle) * RELIC_ORBIT_RADIUS_X_PX,
      y: at.y - RELIC_SHOULDER_RISE_PX[kind] + depthPx + bob,
      depthPx,
    };
  }

  /**
   * The worn relics as figures for a scene's Y-sorted pass, each sorting a
   * little ahead of or behind its wearer by where it is on its lap: behind
   * her on the far half, in front of her on the near half. `hides` is the
   * scene's own test for a crawler it is not drawing, so a relic never circles
   * a body the scene has taken out of the picture.
   */
  sortedRelics(hides: (crawler: Crawler) => boolean): readonly RelicFigure[] {
    this.relicFigures.length = 0;
    for (const crawler of [this.human, this.cat]) {
      if (crawler.concealed || crawler.isAway || hides(crawler)) continue;
      const relic = this.relicOf(crawler);
      if (relic === null) continue;
      const { depthPx } = this.relicOrbit(crawler);
      const figure = this.relicFigureOf[this.kindOf(crawler)];
      figure.x = crawler.x;
      figure.y = crawler.y;
      figure.depthY = crawler.depthY + depthPx;
      figure.sortY = figure.depthY + RELIC_SORT_FOOT_PX;
      this.relicFigures.push(figure);
    }
    return this.relicFigures;
  }

  private feetOf(crawler: Crawler): { x: number; y: number } {
    return { x: crawler.x + HALF_TILE, y: crawler.y + FEET_PX };
  }

  private bodyOf(crawler: Crawler): { x: number; y: number } {
    const at = centreOf(crawler);
    return { x: at.x, y: at.y - BODY_RISE_PX[this.kindOf(crawler)] };
  }

  /** Where a shot glances off the wearer's shield: out from the body toward the shooter. */
  private bucklerBlockPoint(
    crawler: Crawler,
    toward: { readonly dirX: number; readonly dirY: number },
  ): { x: number; y: number } {
    const at = this.bodyOf(crawler);
    return {
      x: at.x + toward.dirX * BUCKLER_BLOCK_REACH_PX,
      y: at.y + toward.dirY * BUCKLER_BLOCK_REACH_PX,
    };
  }

  private headTopOf(crawler: Crawler): number {
    return crawler.y + HEAD_TOP_PX[this.kindOf(crawler)];
  }

  /** How much of her last stand's sand is still to run, 1 the moment it starts. */
  private lastStandSandLeft(crawler: Crawler): number {
    const frames = crawler.gear.live.lastStandFrames;
    for (const { trait } of wornTraits(crawler)) {
      if (trait.kind === 'lastStand' && trait.durationFrames > 0) {
        return Math.min(1, frames / trait.durationFrames);
      }
    }
    return frames > 0 ? 1 : 0;
  }

  render(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const { x: camX, y: camY } = camera;
    const slowed =
      this.human.gear.live.lastStandFrames > 0 || this.cat.gear.live.lastStandFrames > 0;
    if (slowed) drawLastStandEdges(ctx, 0, 0, camera.viewWidth, camera.viewHeight);
    ctx.save();
    ctx.translate(-camX, -camY);
    for (const bramble of this.brambles) {
      drawBramble(ctx, {
        x: bramble.x,
        y: bramble.y,
        radiusPx: BRAMBLE_RADIUS_PX,
        groundDepth: BRAMBLE_GROUND_DEPTH,
        ageFrames: BRAMBLE_FRAMES - bramble.framesLeft,
        framesLeft: bramble.framesLeft,
        frame: this.frame,
      });
    }
    this.drawTether(ctx);
    for (const crawler of [this.human, this.cat]) {
      if (crawler.concealed || crawler.isAway) continue;
      this.drawWearerMarks(ctx, crawler);
      this.drawComboPips(ctx, crawler);
    }
    for (const wave of this.waves) {
      drawSlashWave(ctx, {
        trail: wave.trail,
        x: wave.x,
        y: wave.y,
        dirX: wave.dirX,
        dirY: wave.dirY,
        travelled: wave.rangePx <= 0 ? 1 : wave.travelledPx / wave.rangePx,
        frame: this.frame,
      });
    }
    for (const bolt of this.bolts) this.drawBolt(ctx, bolt);
    for (const fx of this.fx) this.drawFx(ctx, fx);
    ctx.restore();
  }

  private drawWearerMarks(ctx: CanvasRenderingContext2D, crawler: Crawler): void {
    const live = crawler.gear.live;
    const feet = this.feetOf(crawler);
    if (live.vanished) drawVanishWisps(ctx, feet, this.frame);
    if (live.stillnessRegenActive) drawStillnessRegen(ctx, feet, this.frame);
    if (live.riposteFrames > 0) {
      const at = centreOf(crawler);
      drawRiposteGlint(
        ctx,
        {
          x: at.x + crawler.facingX * RIPOSTE_GLINT_REACH_PX,
          y: at.y + crawler.facingY * RIPOSTE_GLINT_REACH_PX,
        },
        this.frame,
      );
    }
    if (live.lastStandFrames > 0) {
      drawLastStand(
        ctx,
        this.bodyOf(crawler),
        {
          x: feet.x + this.outerSides[this.kindOf(crawler)] * HOURGLASS_SIDE_PX,
          y: this.headTopOf(crawler) + HOURGLASS_DROP_PX,
        },
        this.lastStandSandLeft(crawler),
        this.frame,
      );
    }
  }

  private drawRelic(
    ctx: CanvasRenderingContext2D,
    crawler: Crawler,
    camX: number,
    camY: number,
  ): void {
    const relic = this.relicOf(crawler);
    if (relic === null) return;
    const orbit = this.relicOrbit(crawler);
    ctx.save();
    ctx.translate(-camX, -camY);
    drawRelic(ctx, relic.trait.behaviour, {
      x: orbit.x,
      y: orbit.y,
      groundY: this.feetOf(crawler).y + orbit.depthPx,
      frame: this.frame,
      ready: !relic.recharging,
    });
    ctx.restore();
  }

  private drawBolt(ctx: CanvasRenderingContext2D, bolt: RelicBolt): void {
    const to = centreOf(bolt.target);
    const dx = to.x - bolt.x;
    const dy = to.y - bolt.y;
    const dist = Math.hypot(dx, dy);
    const dirX = dist === 0 ? 0 : dx / dist;
    const dirY = dist === 0 ? 0 : dy / dist;
    drawRelicBolt(ctx, bolt.x, bolt.y, dirX, dirY, this.frame + bolt.ageFrames);
  }

  private drawTether(ctx: CanvasRenderingContext2D): void {
    if (!this.human.gear.live.partnerLinked && !this.cat.gear.live.partnerLinked) return;
    if (this.human.concealed || this.cat.concealed) return;
    const sun = centreOf(this.human);
    const moon = centreOf(this.cat);
    drawPartnerTether(
      ctx,
      { x: sun.x, y: sun.y - TETHER_CHEST_RISE_PX.human },
      { x: moon.x, y: moon.y - TETHER_CHEST_RISE_PX.cat },
      this.frame,
    );
  }

  private drawComboPips(ctx: CanvasRenderingContext2D, crawler: Crawler): void {
    const live = crawler.gear.live;
    if (live.comboHits <= 0 || live.comboTarget <= 0) return;
    const width = live.comboTarget * COMBO_PIP_SIZE_PX + (live.comboTarget - 1) * COMBO_PIP_GAP_PX;
    const left = crawler.x + HALF_TILE - width / 2;
    const top = this.feetOf(crawler).y + COMBO_PIP_DROP_PX;
    for (let pip = 0; pip < live.comboTarget; pip++) {
      worldPlate(
        ctx,
        {
          x: left + pip * (COMBO_PIP_SIZE_PX + COMBO_PIP_GAP_PX),
          y: top,
          w: COMBO_PIP_SIZE_PX,
          h: COMBO_PIP_SIZE_PX,
        },
        { style: pip < live.comboHits ? 'comboPipLit' : 'comboPipDim' },
      );
    }
  }

  private drawFx(ctx: CanvasRenderingContext2D, fx: LiveFx): void {
    const progress = 1 - fxLeft(fx);
    const { request } = fx;
    switch (request.kind) {
      case 'chainArc':
        drawChainArc(
          ctx,
          { x: request.fromX, y: request.fromY },
          { x: request.toX, y: request.toY },
          fx.ageFrames,
          progress,
        );
        break;
      case 'shockwave':
        drawShockwave(ctx, { x: request.x, y: request.y }, request.radiusPx, progress);
        break;
      case 'lifeSaved':
        drawNinthLife(ctx, this.bodyOf(fx.owner), this.headTopOf(fx.owner), progress);
        break;
      case 'awakened':
        drawAwakening(ctx, this.bodyOf(fx.owner), progress);
        break;
      case 'setShimmer':
        drawSetShimmer(ctx, this.feetOf(fx.owner), RARITY_SHIMMER[request.rarity], progress);
        break;
      case 'wardShatter':
        drawWardShatter(ctx, this.relicPosition(fx.owner), progress);
        break;
      case 'bucklerBlock':
        drawBucklerBlock(
          ctx,
          this.bucklerBlockPoint(fx.owner, request),
          { x: request.dirX, y: request.dirY },
          progress,
        );
        break;
      case 'clawTrail':
        drawClawSwipe(ctx, request, progress);
        break;
      case 'slashWave':
        break;
    }
  }
}
