import type { Mob } from '../creatures/Mob';
import { TILE_SIZE } from '../core/constants';
import type { VarietyTier } from '../core/perf/varietyTier';
import { variantsInPlay, type MobVariantFamily } from '../core/mobs/mobVariantFamily';
import { Goblin, GOBLIN_MELEE_FAMILY } from '../creatures/Goblin';
import { TutorialGoblin } from '../creatures/TutorialGoblin';
import { GoblinArcher } from '../creatures/GoblinArcher';
import { GoblinDynamiter } from '../creatures/GoblinDynamiter';
import { GoblinBombardier } from '../creatures/GoblinBombardier';
import { Llama } from '../creatures/Llama';
import { RockGolem } from '../creatures/RockGolem';
import { RockGolemBoss } from '../creatures/RockGolemBoss';
import { Mantid } from '../creatures/Mantid';
import { MantisCrony } from '../creatures/MantisCrony';
import { Rat } from '../creatures/Rat';
import { ShrineVermin } from '../creatures/ShrineVermin';
import { TrashGremlin } from '../creatures/TrashGremlin';
import { Cockroach } from '../creatures/Cockroach';
import { BigRooster, prewarmBigRoosterArrival } from '../creatures/BigRooster';
import { LittleRooster } from '../creatures/LittleRooster';
import { prewarmRoosterMinionArrival } from '../creatures/RoosterMinion';
import { SlightlyBentRooster } from '../creatures/SlightlyBentRooster';
import { Troglodyte } from '../creatures/Troglodyte';
import { Tuskling } from '../creatures/Tuskling';
import { SkyFowl, SKYFOWL_TOUGH_FAMILY } from '../creatures/SkyFowl';
import { Necromancer } from '../creatures/Necromancer';
import { RaisedRatkin, RAISED_RATKIN_FAMILY } from '../creatures/RaisedRatkin';
import { GraveBull } from '../creatures/GraveBull';
import { BallOfSwine } from '../creatures/BallOfSwine';
import { KrakarenClone } from '../creatures/KrakarenClone';
import { KrakarenTentacle } from '../creatures/KrakarenTentacle';
import { BrindleGrub } from '../creatures/BrindleGrub';
import { Bugaboo } from '../creatures/Bugaboo';
import { GrotesqueSpider, type SpiderBroodBounds } from '../creatures/GrotesqueSpider';
import { SmallSpider } from '../creatures/SmallSpider';
import { SpiderHatchling } from '../creatures/SpiderHatchling';
import { SpiderEgg } from '../creatures/SpiderEgg';
import { RuinsGhoul } from '../creatures/RuinsGhoul';
import { Krasue } from '../creatures/Krasue';
import { CircusLemur } from '../creatures/CircusLemur';
import { StiltClown } from '../creatures/StiltClown';
import { FatClown } from '../creatures/FatClown';
import { EvilClown } from '../creatures/EvilClown';
import { MoldLion } from '../creatures/MoldLion';
import { TerrorTheClown } from '../creatures/TerrorTheClown';
import { HeatherTheBear } from '../creatures/HeatherTheBear';
import { CityElfCultist } from '../creatures/CityElfCultist';
import { MissQuill } from '../creatures/MissQuill';
import { Remex } from '../creatures/Remex';
import { TheLich } from '../creatures/TheLich';
import { SkeletonWarrior } from '../creatures/SkeletonWarrior';
import { SkeletonArcher } from '../creatures/SkeletonArcher';
import { SkeletonLord } from '../creatures/SkeletonLord';
import { DarkKnight } from '../creatures/DarkKnight';
import { ShieldFairy } from '../creatures/fairies/ShieldFairy';
import { HealingFairy } from '../creatures/fairies/HealingFairy';
import { IceFairy } from '../creatures/fairies/IceFairy';
import { FireFairy } from '../creatures/fairies/FireFairy';
import { NecroFairy } from '../creatures/fairies/NecroFairy';
import { prewarmGoblin, type GoblinWeapon } from '../sprites/goblinSprite';
import { prewarmGoblinBomber } from '../sprites/goblinBomberSprite';
import { prewarmTuskling } from '../sprites/tusklingSprite';
import { prewarmSkyfowlCastMember } from '../sprites/skyfowlCastSprite';
import { prewarmLlama } from '../sprites/llamaSprite';
import { prewarmMoldLion } from '../sprites/moldLionSprite';
import { prewarmBrindleGrub } from '../sprites/brindleGrubSprite';
import { prewarmSmallSpider } from '../sprites/spiderSprite';
import { prewarmBugaboo } from '../sprites/bugabooSprite';
import { prewarmCockroach } from '../sprites/cockroachSprite';
import { prewarmRat } from '../sprites/ratSprite';
import { prewarmTroglodyte } from '../sprites/troglodyteSprite';
import { prewarmGraveBull } from '../sprites/graveBullSprite';
import { prewarmFairy } from '../sprites/fairySprite';
import type { SkyfowlLookId } from '../sprites/art/skyfowl/cast';
import type { FigureDef } from '../sprites/figure/figureDef';
import {
  NO_APPROACH_ROWS,
  THREE_VIEW_SUFFIXES,
  approachRowsFor,
  type ApproachRows,
  type ApproachSpec,
  type ApproachView,
  type RowViews,
} from '../sprites/figure/approachRows';
import { GOBLIN_FIGURES } from '../sprites/art/goblinFigure';
import { GOBLIN_BOMBER_FIGURES } from '../sprites/art/goblinBomberFigure';
import { RAT_FIGURE } from '../sprites/art/ratFigure';
import { COCKROACH_FIGURE } from '../sprites/art/cockroachFigure';
import { skyfowlCastFigure } from '../sprites/art/skyfowlCastFigure';
import { TROGLODYTE_FIGURE } from '../sprites/art/troglodyteFigure';
import {
  BENT_ROOSTER_FIGURE,
  BIG_ROOSTER_FIGURE,
  LITTLE_ROOSTER_FIGURE,
} from '../sprites/art/roosterFigure';
import { LLAMA_FIGURE } from '../sprites/art/llamaFigure';
import { CIRCUS_LEMUR_FIGURE } from '../sprites/art/circusLemurFigure';
import { FAT_CLOWN_FIGURE, STILT_CLOWN_FIGURE } from '../sprites/art/clownFigure';
import { TUSKLING_FIGURE } from '../sprites/art/tusklingFigure';
import { MOLD_LION_FIGURE } from '../sprites/art/moldLionFigure';
import { CITY_ELF_CULTIST_FIGURE } from '../sprites/art/cityElfCultistFigure';
import { MANTIS_FIGURE } from '../sprites/art/mantidFigure';
import { BUGABOO_FIGURE } from '../sprites/art/bugabooFigure';
import { ROCK_GOLEM_FIGURE } from '../sprites/art/rockGolemFigure';
import { SKELETON_ARCHER_FIGURE, SKELETON_SWORD_FIGURE } from '../sprites/art/skeletonFigure';
import type { RaisedRatkinLook } from '../sprites/art/raisedRatkinArt';

/** The tile a spawn stands on. */
export interface SpawnTile {
  readonly x: number;
  readonly y: number;
}

/** What a hostile kind does in a fight, at a glance. */
type MobRole = 'melee' | 'ranged' | 'bomber' | 'charger' | 'caster' | 'support' | 'summoner';

/**
 * Why a kind is never substituted for another: a boss (bounty marks among
 * them), an add a boss fight is built around, or a mob a quest or the
 * tutorial needs to be exactly itself.
 */
type ProtectionReason = 'boss' | 'boss-add' | 'quest-critical';

/** The per-kind argument list after the tile and the look: none, optional or required. */
export type KindOptionArgs<O> = undefined extends O ? [options?: O] : [options: O];

/**
 * Everything the game knows about one hostile kind: how to build one, how
 * dangerous it is, whether it may ever be substituted, which looks it wears
 * and what to warm when one is on its way.
 *
 * **Threat** rates a kind as a multiple of a melee goblin, so that one kind can
 * stand in for another without changing the fight: base HP × hits per second ×
 * damage per hit, at level 1 and with no level scaling, divided by a melee
 * goblin's own product (6 HP × 60/90 hits a second × 1.35, its light and heavy
 * blows mixed by how often it commits to the heavy one). Hits per second are
 * the attack's cooldown alone, not its windup or telegraph. Then ×1.5 when the
 * main attack is ranged, and ×1.25 when the kind has area or status attacks;
 * both can apply. An attack sized as a share of the target's health is read
 * against a level-1 crawler. A kind with no attack of its own rates 0 unless
 * what it raises fights for it, which is rated in its place.
 */
export interface MobKindEntry<M extends Mob, V, O> {
  /** `random` is the spawn context's stream, for a kind that keeps rolling after it is built. */
  readonly create: (
    tile: SpawnTile,
    variant: V,
    random: () => number,
    ...options: KindOptionArgs<O>
  ) => M;
  readonly threat: number;
  readonly role: MobRole;
  readonly protected: ProtectionReason | null;
  /** The looks this kind wears; a kind with one look has a family of one. */
  readonly family: MobVariantFamily<V>;
  /**
   * Re-dresses a live mob of this kind in another of its looks, returning
   * whether its look changed; null for a kind with one look.
   */
  readonly applyVariant: ((mob: M, variant: V) => boolean) | null;
  /** Starts warming the figure rows one spawn wearing `variant` draws first; null when nothing is painted ahead. */
  readonly prewarm: ((variant: V) => void) | null;
  /** Starts warming {@link prewarm}'s rows for every look a spawn can wear at `tier`. */
  readonly warm: (tier: VarietyTier) => void;
  /**
   * The rows a spawn at `tier` walks up to a fight in and opens it with,
   * facing `view`, for every look it can wear there: what a lead-in that knows
   * the kind is coming keeps warm. None for a kind not drawn from the figure
   * cache, or one whose arrival is warmed by its own sprite module.
   */
  readonly approachRows: (tier: VarietyTier, view: ApproachView) => ApproachRows;
}

/** The family of a kind that only ever has one look. */
const SINGLE_LOOK: MobVariantFamily<null> = {
  variants: [null],
  canonical: null,
  sharedFromTier: 0,
  pick: () => null,
};

type KindFields<M extends Mob, V, O> = Omit<
  MobKindEntry<M, V, O>,
  'family' | 'applyVariant' | 'warm' | 'approachRows'
> & {
  /** The figure rows behind {@link MobKindEntry.approachRows}; absent for none. */
  readonly approach?: ApproachSpec<V>;
};

function warmerFor<V>(
  family: MobVariantFamily<V>,
  prewarm: ((variant: V) => void) | null,
): (tier: VarietyTier) => void {
  return (tier) => {
    if (prewarm === null) return;
    for (const variant of variantsInPlay(family, tier)) prewarm(variant);
  };
}

function approachRowsFrom<V>(
  family: MobVariantFamily<V>,
  approach: ApproachSpec<V> | undefined,
): (tier: VarietyTier, view: ApproachView) => ApproachRows {
  return (tier, view) =>
    approach === undefined
      ? NO_APPROACH_ROWS
      : approachRowsFor(approach, variantsInPlay(family, tier), view);
}

/** A kind with a single look. */
function kind<M extends Mob, O = undefined>(
  fields: KindFields<M, null, O>,
): MobKindEntry<M, null, O> {
  const { approach, ...entry } = fields;
  return {
    ...entry,
    family: SINGLE_LOOK,
    applyVariant: null,
    warm: warmerFor(SINGLE_LOOK, entry.prewarm),
    approachRows: approachRowsFrom(SINGLE_LOOK, approach),
  };
}

/** A kind whose looks come from a variant family. */
function lookKind<M extends Mob, V, O = undefined>(
  fields: KindFields<M, V, O> & {
    readonly family: MobVariantFamily<V>;
    readonly applyVariant: (mob: M, variant: V) => boolean;
  },
): MobKindEntry<M, V, O> {
  const { approach, ...entry } = fields;
  return {
    ...entry,
    warm: warmerFor(entry.family, entry.prewarm),
    approachRows: approachRowsFrom(entry.family, approach),
  };
}

/** A figure that plays the same rows whatever the look. */
function oneFigure(def: FigureDef): () => FigureDef {
  return () => def;
}

const COCKROACH_VIEW_SUFFIXES = {
  front: '',
  side: '_side',
  away: '_back',
} as const satisfies RowViews;

/** Options for a tutorial goblin, which the tutorial places and scripts by hand. */
interface TutorialGoblinOptions {
  readonly weapon: GoblinWeapon;
  readonly stationary?: boolean;
  readonly defenseOnly?: boolean;
  readonly missileOnly?: boolean;
}

const MOB_KIND_DEFS = {
  goblin: lookKind({
    create: (tile, weapon: GoblinWeapon) => new Goblin(tile.x, tile.y, TILE_SIZE, weapon),
    threat: 1,
    role: 'melee',
    protected: null,
    family: GOBLIN_MELEE_FAMILY,
    applyVariant: (mob, weapon) => mob.applyVariant(weapon),
    approach: {
      figure: (weapon) => GOBLIN_FIGURES[weapon],
      rows: { walk: 'walk', attacks: ['attack_light', 'attack_heavy'], views: 'single' },
    },
    prewarm: prewarmGoblin,
  }),
  tutorial_goblin: kind<TutorialGoblin, TutorialGoblinOptions>({
    create: (tile, _look, _random, options) =>
      new TutorialGoblin(
        tile.x,
        tile.y,
        TILE_SIZE,
        options.weapon,
        options.stationary,
        options.defenseOnly,
        options.missileOnly,
      ),
    threat: 0.17,
    role: 'melee',
    protected: 'quest-critical',
    prewarm: null,
  }),
  goblin_archer: kind({
    create: (tile) => new GoblinArcher(tile.x, tile.y, TILE_SIZE),
    threat: 1.3,
    role: 'ranged',
    protected: null,
    approach: {
      figure: oneFigure(GOBLIN_FIGURES.bow),
      rows: { walk: 'walk', attacks: ['attack_heavy', 'attack_light'], views: 'single' },
    },
    prewarm: () => prewarmGoblin('bow'),
  }),
  goblin_dynamiter: kind({
    create: (tile) => new GoblinDynamiter(tile.x, tile.y, TILE_SIZE),
    threat: 6.9,
    role: 'bomber',
    protected: null,
    approach: {
      figure: oneFigure(GOBLIN_BOMBER_FIGURES.dynamite),
      rows: { walk: 'walk', attacks: ['light', 'throw'], views: 'single' },
    },
    prewarm: () => prewarmGoblinBomber('dynamite'),
  }),
  goblin_bombardier: kind({
    create: (tile) => new GoblinBombardier(tile.x, tile.y, TILE_SIZE),
    threat: 5.6,
    role: 'bomber',
    protected: null,
    approach: {
      figure: oneFigure(GOBLIN_BOMBER_FIGURES.black_powder),
      rows: { walk: 'walk', attacks: ['light', 'aim', 'throw'], views: 'single' },
    },
    prewarm: () => prewarmGoblinBomber('black_powder'),
  }),
  llama: kind({
    create: (tile) => new Llama(tile.x, tile.y, TILE_SIZE),
    threat: 2.8,
    role: 'ranged',
    protected: null,
    approach: {
      figure: oneFigure(LLAMA_FIGURE),
      rows: { walk: 'walk', attacks: ['spit'], views: THREE_VIEW_SUFFIXES },
    },
    prewarm: prewarmLlama,
  }),
  rock_golem: kind({
    create: (tile) => new RockGolem(tile.x, tile.y, TILE_SIZE),
    threat: 21,
    role: 'melee',
    protected: null,
    approach: {
      figure: oneFigure(ROCK_GOLEM_FIGURE),
      rows: { walk: 'walk', attacks: ['slam', 'stomp'], views: THREE_VIEW_SUFFIXES },
    },
    prewarm: null,
  }),
  rock_golem_boss: kind({
    create: (tile) => new RockGolemBoss(tile.x, tile.y, TILE_SIZE),
    threat: 71,
    role: 'charger',
    protected: 'boss',
    prewarm: null,
  }),
  rat: kind({
    create: (tile) => new Rat(tile.x, tile.y, TILE_SIZE),
    threat: 0.28,
    role: 'melee',
    protected: null,
    approach: {
      figure: oneFigure(RAT_FIGURE),
      rows: { walk: 'walk', attacks: ['bite'], views: THREE_VIEW_SUFFIXES },
    },
    prewarm: prewarmRat,
  }),
  shrine_vermin: kind({
    create: (tile) => new ShrineVermin(tile.x, tile.y, TILE_SIZE),
    threat: 0,
    role: 'support',
    protected: 'quest-critical',
    prewarm: prewarmRat,
  }),
  mantid: kind({
    create: (tile) => new Mantid(tile.x, tile.y, TILE_SIZE),
    threat: 720,
    role: 'melee',
    protected: 'boss',
    prewarm: null,
  }),
  mantis: kind({
    create: (tile) => new MantisCrony(tile.x, tile.y, TILE_SIZE),
    threat: 23,
    role: 'melee',
    protected: null,
    approach: {
      figure: oneFigure(MANTIS_FIGURE),
      rows: { walk: 'walk', attacks: ['slash'], views: THREE_VIEW_SUFFIXES },
    },
    prewarm: null,
  }),
  trash_gremlin: kind({
    create: (tile) => new TrashGremlin(tile.x, tile.y, TILE_SIZE),
    threat: 16,
    role: 'ranged',
    protected: 'boss',
    prewarm: null,
  }),
  cockroach: kind({
    create: (tile) => new Cockroach(tile.x, tile.y, TILE_SIZE),
    threat: 0.5,
    role: 'melee',
    protected: null,
    approach: {
      figure: oneFigure(COCKROACH_FIGURE),
      rows: { walk: 'skitter', attacks: ['bite'], views: COCKROACH_VIEW_SUFFIXES },
    },
    prewarm: prewarmCockroach,
  }),
  big_rooster: kind({
    create: (tile) => new BigRooster(tile.x, tile.y, TILE_SIZE),
    threat: 83,
    role: 'ranged',
    protected: 'boss',
    approach: {
      figure: oneFigure(BIG_ROOSTER_FIGURE),
      rows: { walk: 'walk', attacks: ['crow', 'club_swing'], views: THREE_VIEW_SUFFIXES },
    },
    prewarm: prewarmBigRoosterArrival,
  }),
  little_rooster: kind({
    create: (tile) => new LittleRooster(tile.x, tile.y, TILE_SIZE),
    threat: 6.9,
    role: 'melee',
    protected: 'boss-add',
    approach: {
      figure: oneFigure(LITTLE_ROOSTER_FIGURE),
      rows: { walk: 'walk', attacks: ['peck', 'punch'], views: THREE_VIEW_SUFFIXES },
    },
    prewarm: () => prewarmRoosterMinionArrival('little'),
  }),
  slightly_bent_rooster: kind({
    create: (tile) => new SlightlyBentRooster(tile.x, tile.y, TILE_SIZE),
    threat: 10,
    role: 'melee',
    protected: 'boss-add',
    approach: {
      figure: oneFigure(BENT_ROOSTER_FIGURE),
      rows: { walk: 'walk', attacks: ['peck', 'punch'], views: THREE_VIEW_SUFFIXES },
    },
    prewarm: () => prewarmRoosterMinionArrival('bent'),
  }),
  troglodyte: kind({
    create: (tile) => new Troglodyte(tile.x, tile.y, TILE_SIZE),
    threat: 9.2,
    role: 'ranged',
    protected: null,
    approach: {
      figure: oneFigure(TROGLODYTE_FIGURE),
      rows: { walk: 'walk', attacks: ['gape', 'lash'], views: THREE_VIEW_SUFFIXES },
    },
    prewarm: prewarmTroglodyte,
  }),
  tuskling: kind({
    create: (tile) => new Tuskling(tile.x, tile.y, TILE_SIZE),
    threat: 13,
    role: 'charger',
    protected: null,
    approach: {
      figure: oneFigure(TUSKLING_FIGURE),
      rows: { walk: 'walk', attacks: ['hook'], views: THREE_VIEW_SUFFIXES },
    },
    prewarm: prewarmTuskling,
  }),
  sky_fowl: lookKind({
    create: (tile, look: SkyfowlLookId) => new SkyFowl(tile.x, tile.y, TILE_SIZE, look),
    threat: 5.5,
    role: 'melee',
    protected: null,
    family: SKYFOWL_TOUGH_FAMILY,
    applyVariant: (mob, look) => mob.applyVariant(look),
    approach: {
      figure: skyfowlCastFigure,
      rows: { walk: 'walk', attacks: ['strike'], views: THREE_VIEW_SUFFIXES },
    },
    prewarm: prewarmSkyfowlCastMember,
  }),
  necromancer: kind({
    create: (tile, _look, random) => new Necromancer(tile.x, tile.y, TILE_SIZE, random),
    threat: 56,
    role: 'summoner',
    protected: 'boss',
    // The siege's wave ticker warms his arrival rows one at a time and never
    // evicts for them; a spawn-time warm would queue them all at once.
    prewarm: null,
  }),
  // No spawn-time warm: its idle and head-on shamble on top of the arrival
  // rows are more than a siege wave's cache headroom holds, so the assault's
  // countdown warms the arrival and each body warms the rest as it engages.
  raised_ratkin: lookKind({
    create: (tile, look: RaisedRatkinLook) => new RaisedRatkin(tile.x, tile.y, TILE_SIZE, look),
    threat: 2.8,
    role: 'melee',
    protected: null,
    family: RAISED_RATKIN_FAMILY,
    applyVariant: (mob, look) => mob.applyVariant(look),
    prewarm: null,
  }),
  grave_bull: kind({
    create: (tile) => new GraveBull(tile.x, tile.y, TILE_SIZE),
    threat: 110,
    role: 'charger',
    protected: null,
    prewarm: prewarmGraveBull,
  }),
  ball_of_swine: kind({
    create: (tile) => new BallOfSwine(tile.x, tile.y, TILE_SIZE),
    threat: 340,
    role: 'charger',
    protected: 'boss',
    prewarm: null,
  }),
  krakaren_clone: kind({
    create: (tile) => new KrakarenClone(tile.x, tile.y, TILE_SIZE),
    threat: 180,
    role: 'melee',
    protected: 'boss',
    prewarm: null,
  }),
  krakaren_tentacle: kind<KrakarenTentacle, { readonly owner: KrakarenClone }>({
    create: (tile, _look, _random, options) =>
      new KrakarenTentacle(tile.x, tile.y, TILE_SIZE, options.owner),
    threat: 4.6,
    role: 'melee',
    protected: 'boss-add',
    prewarm: null,
  }),
  brindle_grub: kind({
    create: (tile) => new BrindleGrub(tile.x, tile.y, TILE_SIZE),
    threat: 6.7,
    role: 'ranged',
    protected: null,
    prewarm: prewarmBrindleGrub,
  }),
  bugaboo: kind({
    create: (tile) => new Bugaboo(tile.x, tile.y, TILE_SIZE),
    threat: 3,
    role: 'melee',
    protected: null,
    approach: {
      figure: oneFigure(BUGABOO_FIGURE),
      rows: { walk: 'walk', attacks: ['swipe'], views: THREE_VIEW_SUFFIXES },
    },
    prewarm: prewarmBugaboo,
  }),
  grotesque_spider: kind({
    create: (tile) => new GrotesqueSpider(tile.x, tile.y, TILE_SIZE),
    threat: 7100,
    role: 'melee',
    protected: 'boss',
    prewarm: null,
  }),
  small_spider: kind({
    create: (tile) => new SmallSpider(tile.x, tile.y, TILE_SIZE),
    threat: 11,
    role: 'melee',
    protected: null,
    prewarm: prewarmSmallSpider,
  }),
  spider_hatchling: kind<SpiderHatchling, { readonly leash: SpiderBroodBounds }>({
    create: (tile, _look, _random, options) =>
      new SpiderHatchling(tile.x, tile.y, TILE_SIZE, options.leash),
    threat: 4.2,
    role: 'melee',
    protected: 'boss-add',
    prewarm: prewarmSmallSpider,
  }),
  spider_egg: kind({
    create: (tile) => new SpiderEgg(tile.x, tile.y, TILE_SIZE),
    threat: 0,
    role: 'summoner',
    protected: 'boss-add',
    prewarm: null,
  }),
  ruins_ghoul: kind({
    create: (tile) => new RuinsGhoul(tile.x, tile.y, TILE_SIZE),
    threat: 7.1,
    role: 'melee',
    protected: null,
    prewarm: null,
  }),
  krasue: kind({
    create: (tile) => new Krasue(tile.x, tile.y, TILE_SIZE),
    threat: 7.7,
    role: 'melee',
    protected: null,
    prewarm: null,
  }),
  circus_lemur: kind({
    create: (tile) => new CircusLemur(tile.x, tile.y, TILE_SIZE),
    threat: 7.5,
    role: 'ranged',
    protected: null,
    approach: {
      figure: oneFigure(CIRCUS_LEMUR_FIGURE),
      rows: { walk: 'walk', attacks: ['throw', 'attack'], views: 'single' },
    },
    prewarm: null,
  }),
  stilt_clown: kind({
    create: (tile) => new StiltClown(tile.x, tile.y, TILE_SIZE),
    threat: 3.6,
    role: 'melee',
    protected: null,
    approach: {
      figure: oneFigure(STILT_CLOWN_FIGURE),
      rows: { walk: 'walk', attacks: ['windup', 'lunge'], views: 'single' },
    },
    prewarm: null,
  }),
  fat_clown: kind({
    create: (tile) => new FatClown(tile.x, tile.y, TILE_SIZE),
    threat: 12,
    role: 'melee',
    protected: null,
    approach: {
      figure: oneFigure(FAT_CLOWN_FIGURE),
      rows: { walk: 'walk', attacks: ['slam'], views: 'single' },
    },
    prewarm: null,
  }),
  evil_clown: kind({
    create: (tile) => new EvilClown(tile.x, tile.y, TILE_SIZE),
    threat: 56,
    role: 'melee',
    protected: 'boss',
    prewarm: null,
  }),
  mold_lion: kind({
    create: (tile) => new MoldLion(tile.x, tile.y, TILE_SIZE),
    threat: 30,
    role: 'melee',
    protected: null,
    approach: {
      figure: oneFigure(MOLD_LION_FIGURE),
      rows: { walk: 'walk', attacks: ['attack'], views: 'single' },
    },
    prewarm: prewarmMoldLion,
  }),
  terror_the_clown: kind({
    create: (tile) => new TerrorTheClown(tile.x, tile.y, TILE_SIZE),
    threat: 67,
    role: 'melee',
    protected: 'boss',
    prewarm: null,
  }),
  heather_the_bear: kind({
    create: (tile) => new HeatherTheBear(tile.x, tile.y, TILE_SIZE),
    threat: 18,
    role: 'melee',
    protected: 'boss',
    prewarm: null,
  }),
  city_elf_cultist: kind({
    create: (tile) => new CityElfCultist(tile.x, tile.y, TILE_SIZE),
    threat: 13,
    role: 'caster',
    protected: null,
    approach: {
      figure: oneFigure(CITY_ELF_CULTIST_FIGURE),
      rows: { walk: 'walk', attacks: ['cast'], views: THREE_VIEW_SUFFIXES },
    },
    prewarm: null,
  }),
  miss_quill: kind<MissQuill, { readonly addMob: (mob: Mob) => void }>({
    create: (tile, _look, _random, options) =>
      new MissQuill(tile.x, tile.y, TILE_SIZE, options.addMob),
    threat: 320,
    role: 'caster',
    protected: 'boss',
    prewarm: null,
  }),
  remex: kind({
    create: (tile) => new Remex(tile.x, tile.y, TILE_SIZE),
    threat: 0,
    role: 'support',
    protected: 'quest-critical',
    prewarm: null,
  }),
  skeleton_sword: kind({
    create: (tile) => new SkeletonWarrior(tile.x, tile.y, TILE_SIZE),
    threat: 6,
    role: 'melee',
    protected: null,
    approach: {
      figure: oneFigure(SKELETON_SWORD_FIGURE),
      rows: { walk: 'walk', attacks: ['slash'], views: THREE_VIEW_SUFFIXES },
    },
    prewarm: null,
  }),
  skeleton_archer: kind({
    create: (tile) => new SkeletonArcher(tile.x, tile.y, TILE_SIZE),
    threat: 2.4,
    role: 'ranged',
    protected: null,
    approach: {
      figure: oneFigure(SKELETON_ARCHER_FIGURE),
      rows: { walk: 'walk', attacks: ['draw_loose'], views: THREE_VIEW_SUFFIXES },
    },
    prewarm: null,
  }),
  skeleton_lord: kind({
    create: (tile) => new SkeletonLord(tile.x, tile.y, TILE_SIZE),
    threat: 28,
    role: 'summoner',
    protected: 'boss',
    prewarm: null,
  }),
  the_lich: kind({
    create: (tile) => new TheLich(tile.x, tile.y, TILE_SIZE),
    threat: 220,
    role: 'summoner',
    protected: 'boss',
    prewarm: null,
  }),
  dark_knight: kind({
    create: (tile) => new DarkKnight(tile.x, tile.y, TILE_SIZE),
    threat: 1200,
    role: 'melee',
    protected: 'boss',
    prewarm: null,
  }),
  fairy_shield: kind({
    create: (tile) => new ShieldFairy(tile.x, tile.y, TILE_SIZE),
    threat: 0,
    role: 'support',
    protected: null,
    prewarm: () => prewarmFairy('shield'),
  }),
  fairy_healer: kind({
    create: (tile) => new HealingFairy(tile.x, tile.y, TILE_SIZE),
    threat: 0.26,
    role: 'support',
    protected: null,
    prewarm: () => prewarmFairy('healer'),
  }),
  fairy_ice: kind({
    create: (tile) => new IceFairy(tile.x, tile.y, TILE_SIZE),
    threat: 2.4,
    role: 'caster',
    protected: null,
    prewarm: () => prewarmFairy('ice'),
  }),
  fairy_fire: kind({
    create: (tile) => new FireFairy(tile.x, tile.y, TILE_SIZE),
    threat: 3.8,
    role: 'caster',
    protected: null,
    prewarm: () => prewarmFairy('fire'),
  }),
  fairy_necro: kind({
    create: (tile) => new NecroFairy(tile.x, tile.y, TILE_SIZE),
    threat: 5.8,
    role: 'summoner',
    protected: null,
    prewarm: () => prewarmFairy('necro'),
  }),
};

type KindDefs = typeof MOB_KIND_DEFS;

/** Every hostile kind the game can spawn. */
export type MobKind = keyof KindDefs;

/** The class a spawn of `K` is built as. */
export type MobOf<K extends MobKind> = K extends MobKind
  ? KindDefs[K] extends MobKindEntry<infer M, infer _V, infer _O>
    ? M
    : never
  : never;

/** The looks `K` can wear; `null` for a kind with one look. */
export type VariantOf<K extends MobKind> = K extends MobKind
  ? KindDefs[K] extends MobKindEntry<infer _M, infer V, infer _O>
    ? V
    : never
  : never;

/** The extra arguments a spawn of `K` needs; `undefined` for a kind that needs none. */
export type OptionsOf<K extends MobKind> = K extends MobKind
  ? KindDefs[K] extends MobKindEntry<infer _M, infer _V, infer O>
    ? O
    : never
  : never;

/**
 * A kind spawnable from a tile alone, with no per-spawn options: what spawn
 * tables, rosters and the AI director may name.
 */
export type StandaloneMobKind = {
  [K in MobKind]: undefined extends OptionsOf<K> ? K : never;
}[MobKind];

/**
 * The option arguments a spawn of any of the kinds `K` takes: optional only
 * when every one of them can do without.
 */
export type SpawnOptionArgs<K extends MobKind> = [Exclude<K, StandaloneMobKind>] extends [never]
  ? [options?: OptionsOf<K>]
  : [options: OptionsOf<K>];

type KindEntryFor<K extends MobKind> = MobKindEntry<MobOf<K>, VariantOf<K>, OptionsOf<K>>;

/**
 * The registry, typed per kind so that looking up `MOB_KINDS[kind]` for a
 * generic `kind` keeps its class, look and option types tied together.
 */
export const MOB_KINDS: { readonly [K in MobKind]: KindEntryFor<K> } = MOB_KIND_DEFS;

const ALL_MOB_KINDS: readonly MobKind[] = Object.keys(MOB_KIND_DEFS).filter(isMobKind);

/** Every hostile kind, in registry order. */
export function allMobKinds(): readonly MobKind[] {
  return ALL_MOB_KINDS;
}

/** Every kind that needs per-spawn options; a `Record` so the list cannot drift from the types. */
const KINDS_NEEDING_OPTIONS: Readonly<Record<Exclude<MobKind, StandaloneMobKind>, true>> = {
  tutorial_goblin: true,
  krakaren_tentacle: true,
  spider_hatchling: true,
  miss_quill: true,
};

const STANDALONE_MOB_KINDS: readonly StandaloneMobKind[] =
  ALL_MOB_KINDS.filter(isStandaloneMobKind);

/** Every kind that spawns from a tile alone, in registry order. */
export function standaloneMobKinds(): readonly StandaloneMobKind[] {
  return STANDALONE_MOB_KINDS;
}

/** Whether `kind` spawns from a tile alone; see {@link StandaloneMobKind}. */
export function isStandaloneMobKind(kind: MobKind): kind is StandaloneMobKind {
  return !Object.prototype.hasOwnProperty.call(KINDS_NEEDING_OPTIONS, kind);
}

function isMobKind(value: string): value is MobKind {
  return Object.prototype.hasOwnProperty.call(MOB_KIND_DEFS, value);
}

export function threatOf(kind: MobKind): number {
  return MOB_KINDS[kind].threat;
}

export function isProtectedKind(kind: MobKind): boolean {
  return MOB_KINDS[kind].protected !== null;
}
