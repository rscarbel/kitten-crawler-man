/**
 * The top of the tower: the Warden's ritual, and the fight that ends it.
 *
 * One of these stands for the whole tower while the party is inside, and
 * answers only once the questline has brought the party back up together
 * (`ascent`) or into the fight already (`ritual`). The first time the party
 * comes up onto the cattery it finds the Warden waiting in the lit circle,
 * masked, and the questline moves to `ritual`; the Warden says what the
 * circle is for and lifts the mask, and when that is read the fight starts.
 * A party turned out of the tower by the fight and climbing back finds the
 * Warden waiting again, and the fight starts without the reveal.
 *
 * The fight is `LichBattleSystem`, opening inside the binding: each town cat
 * nobody let out of its cage is bound to a pillar of the circle, the circle
 * shields the Lich while any pillar is lit, the cat unbinds them while the
 * human holds the Lich off, and whoever the party's choice about Aviel sent
 * flies in through the observatory window to carry one cat out. Each bound
 * cat sits at her pillar from the moment the Warden is raised (`BoundCats`),
 * and bolts for the stair down as her pillar goes dark.
 *
 * Music: the `warden_ritual` stem set under owner `tower_finale` on the boss
 * layer, the stem without the cat theme while any cat is bound and the full
 * mix once the circle is broken. Its decoded stems are held only while the
 * party is on the archive or the cattery with the ritual still ahead of it.
 *
 * When the Warden falls, the questline moves to `aftermath`, every town cat
 * the fight left in the room gets up and runs for the stair down
 * (`CatsWalkOut`), and the `onWardenFallen` hook runs: everything after that
 * (the room watching them go, the rewards, the epilogue) belongs to whoever
 * the scene hands that hook to.
 */

import type { AudioManager } from '../../audio/AudioManager';
import type { MusicClaims } from '../../audio/AudioScope';
import type { MusicStemOf } from '../../audio/music/stemSets';
import { applySpawnDifficulty } from '../../core/difficulty/difficultyProfiles';
import type { EventBus } from '../../core/EventBus';
import { TILE_SIZE } from '../../core/constants';
import type { WorldRows } from '../../core/rendering/worldRect';
import { displayHp } from '../../core/party/crawlerFormulas';
import {
  madeAvielChoice,
  phaseReached,
  type AvielChoice,
  type MissingCatsProgress,
} from '../../core/quests/missingCatsProgress';
import { TOWN_CAT_IDS, type TownCatId } from '../../core/state/townCatIds';
import type { InteriorFigure } from '../../core/rendering/InteriorFigure';
import type { Mob } from '../../creatures/Mob';
import type { TheLich } from '../../creatures/TheLich';
import type { Conversation } from '../../dialog/Conversation';
import type { BarkLine, DialogLine, NonEmpty } from '../../dialog/line';
import type { ConversationHandle } from '../../dialog/request';
import {
  CARRIER_ARRIVES,
  WARDEN_FALLS,
  wardenReveal,
} from '../../dialog/scripts/scenes/towerRitual';
import { spawnHardModeBossHealer } from '../../levels/fairySpawner';
import { level3 } from '../../levels/level3';
import { liveSpawnContext, spawnMob } from '../../levels/spawnFunnel';
import { findNearbyWalkableTile } from '../../map/findWalkableTile';
import type { GameMap } from '../../map/GameMap';
import {
  BINDING_PILLAR_VARIANT,
  bindingPillarId,
  RITUAL_CIRCLE_TILE,
  TOWER_BINDING_PILLARS,
  towerStoreyIndex,
  type TowerConditions,
} from '../../map/town/interiors/townCenterTower';
import { TOWN_INTERIOR_PROPS } from '../../sprites/art/townInterior/townInteriorProps';
import { prewarmTowerCarrier, type TowerCarrierKind } from '../../sprites/art/towerCarrierFigure';
import type { CatLook } from '../../sprites/looks/catLook';
import { TOWN_CATS } from '../critters/TownCats';
import { prewarmLichLocomotion } from '../../sprites/lichSprite';
import { prewarmLichFightEffects } from '../../sprites/skeletonEffectsSprite';
import { objectiveRow } from '../../ui/hud/objectiveLine';
import type { TopBandEntry } from '../../ui/hud/topBand';
import type { StairRefusal } from '../TowerStairSystem';
import { stackedBandEntry, type BandRow, type BandTone } from '../../ui/hud/topBandStack';
import { questBannerEntry, QUEST_BANNER_FRAMES } from '../../ui/QuestBanners';
import type { SystemContext } from '../GameSystem';
import { enterMissingCatsPhase } from '../missingCats/missingCatsPhase';
import { questMobLevel } from '../questMobLevel';
import type { WorkChannelBuilder } from '../WorkChannel';
import {
  LichBattleSystem,
  type CompanionDirector,
  type LichBinding,
  type LichBindingPillar,
} from '../LichBattleSystem';
import type { TilePos } from '../lichBattleRules';
import { BoundCats } from './boundCats';
import { CatsWalkOut } from '../missingCats/catsWalkOut';

const CATTERY_STOREY = towerStoreyIndex('cattery');
const NORTH_WALL_ROW = 0;

/**
 * The cattery's rows from the north wall down through the ritual circle, in
 * world pixels: the fight is staged against the far wall, where the top
 * band's cards would otherwise lie over it, so the camera keeps these clear.
 */
export const WARDEN_ARENA_ROWS: WorldRows = {
  top: NORTH_WALL_ROW * TILE_SIZE,
  bottom: (RITUAL_CIRCLE_TILE.y + TOWN_INTERIOR_PROPS.ritual_circle.footprint.h) * TILE_SIZE,
};
/** The storey below the cattery: from here up, the fight's music is held decoded. */
const ARCHIVE_STOREY = towerStoreyIndex('archive');

const RITUAL_SPAWNS = liveSpawnContext('quest:tower-ritual');
/**
 * The Warden's spawn level, a floor rather than a fixed level: a party that
 * arrives well past it is lifted to the quest floor. Its base health is tuned
 * for this fight and the level is here for its damage and its coins.
 */
const WARDEN_LEVEL = 3;
/** Where the Warden waits, from the circle's north-west tile: its middle, a tile in from each edge. */
const WARDEN_CIRCLE_OFFSET = { dx: 1, dy: 1 } as const;
const SPAWN_SEARCH_RADIUS_TILES = 4;

const FIGHT_STEMS = {
  bound: 'warden_ritual_battle_bound',
  free: 'warden_ritual_battle',
} as const satisfies Record<string, MusicStemOf<'warden_ritual'>>;

const WARDEN_NAME = 'The Warden, the Lich';

/**
 * Said instead of the stair prompt while the Warden is up: the fight cannot
 * be walked away from, so the way down is not offered until it is over.
 */
const FIGHT_HOLDS_THE_STAIR: StairRefusal = {
  kind: 'notice',
  text: 'The stair is no way out of this fight. Finish the Warden first.',
};

/** The stages from the Warden's reveal to the room being told it has fallen, while the stair down is held. */
const STAIR_HELD_STAGES: ReadonlySet<RitualStage> = new Set(['reveal', 'fight', 'falling']);

/** Who flies in for a cat: Aviel kept his feathers if his secret was kept, and the Roost sends one of its own if not. */
const CARRIER_BY_CHOICE = {
  kept: 'deacon_aviel',
  exposed: 'roost_hawk',
} as const satisfies Record<AvielChoice, TowerCarrierKind>;

/** The card raised over a phase change, held so one renderer serves them all. */
interface BannerCard {
  readonly title: string;
  readonly subtitle: string;
  readonly tone: BandTone;
}

const FIGHT_BANNER_BOUND: BannerCard = {
  title: 'THE WARDEN — THE LICH',
  subtitle: 'Every lit pillar shields it. Belle can free the cats.',
  tone: 'danger',
};
const FIGHT_BANNER_FREE: BannerCard = {
  title: 'THE WARDEN — THE LICH',
  subtitle: 'No cat is left in the circle. Finish it.',
  tone: 'danger',
};
const FALLEN_BANNER: BannerCard = {
  title: 'THE WARDEN IS GONE',
  subtitle: 'The circle is dark, and the cats are free.',
  tone: 'success',
};

/**
 * Where the ritual is.
 *
 * - `waiting`: the party has not come up onto the cattery yet, or the
 *   questline is not at the ritual.
 * - `reveal`: the Warden is speaking, behind its mask.
 * - `fight`: the fight is on.
 * - `falling`: the Warden has fallen, and the room is being told so.
 * - `done`: the questline has moved on to the aftermath.
 */
type RitualStage = 'waiting' | 'reveal' | 'fight' | 'falling' | 'done';

export interface TowerRitualDeps {
  /** The cattery's map, where the fight is fought. */
  readonly map: GameMap;
  readonly bus: EventBus;
  /** Puts a mob into the cattery's roster. */
  readonly addMob: (mob: Mob) => void;
  readonly progress: MissingCatsProgress;
  /** The tower as the questline left it when the party came in. */
  readonly conditions: TowerConditions;
  readonly audio: AudioManager | null;
  /** The scene's music claims; null in a harness with no audio. */
  readonly music: MusicClaims | null;
  /** The companion's drive, so the fight can park it and send the cat to her pillars. */
  readonly companion: CompanionDirector | null;
  readonly conversation: Conversation;
  readonly partyLevel: () => number;
  /**
   * Writes the save a death in the fight returns to, on the frame the party
   * comes up to the Warden with the questline at the ritual.
   */
  readonly saveBeforeFight: () => void;
  /**
   * Runs once, on the frame the questline reaches `aftermath` and the cats
   * start walking out: the hook the rest of the aftermath (the rewards, the
   * epilogue) hangs from.
   */
  readonly onWardenFallen: () => void;
}

export class TowerRitualSystem {
  private stage: RitualStage = 'waiting';
  private warden: TheLich | null = null;
  private battle: LichBattleSystem | null = null;
  private readonly healers: Mob[] = [];
  private boundCats: BoundCats | null = null;
  private catsWalkingOut: CatsWalkOut | null = null;
  private banner: BannerCard = FIGHT_BANNER_BOUND;
  private bannerTimer = 0;
  private heldForBanner = false;
  private fightStem: MusicStemOf<'warden_ritual'> | null = null;
  /** A monotonic frame count for the fire's animation, so it runs at the rate the fight is simulated. */
  private frameCount = 0;
  private conversationHandle: ConversationHandle | null = null;

  constructor(private readonly deps: TowerRitualDeps) {}

  /** Whether the questline is at the point where the top of the tower holds the ritual. */
  get ritualAhead(): boolean {
    const { progress } = this.deps;
    return phaseReached(progress, 'ascent') && !phaseReached(progress, 'aftermath');
  }

  get defeatMessage(): string {
    return 'The Warden beat you, and the tower threw you out.';
  }

  /** Why the cattery's stair down will not be taken, or null once the fight is over or before it starts. */
  get stairDownRefusal(): StairRefusal | null {
    return STAIR_HELD_STAGES.has(this.stage) ? FIGHT_HOLDS_THE_STAIR : null;
  }

  /** True while a scripted beat owns both crawlers' bodies. */
  get playerLocked(): boolean {
    return this.battle?.playerLocked === true;
  }

  /** The fight, while one is running, for reading rather than driving; null before and after it. */
  get lichBattle(): LichBattleSystem | null {
    return this.battle;
  }

  /** The Warden, once it stands in the circle. */
  get wardenMob(): TheLich | null {
    return this.warden;
  }

  get isDialogOpen(): boolean {
    return this.conversationOwned;
  }

  /** Turns the page of the beat on screen, when it is one of this ritual's. */
  advanceDialog(): boolean {
    if (!this.conversationOwned) return false;
    this.conversation.advance();
    return true;
  }

  private get conversation(): Conversation {
    return this.deps.conversation;
  }

  private get conversationOwned(): boolean {
    return this.conversationHandle !== null && this.conversation.isActive(this.conversationHandle);
  }

  /** One frame of the tower, on whichever storey the party stands. */
  update(ctx: SystemContext, storey: number): void {
    this.catsWalkingOut?.update();
    this.holdFightMusic(storey);
    if (storey !== CATTERY_STOREY) return;
    this.frameCount++;
    if (this.bannerTimer > 0) this.bannerTimer--;
    if (this.heldForBanner && this.bannerTimer <= 0) this.releaseRoom();

    switch (this.stage) {
      case 'waiting':
        if (this.ritualAhead) this.arrive();
        return;
      case 'reveal':
        this.claimFightMusic();
        return;
      case 'falling':
      case 'done':
        this.boundCats?.update();
        return;
      case 'fight':
        this.claimFightMusic();
        // Held while one of the fight's own barks is up: the death check would
        // otherwise replace the open bark with the fall, throwing away the
        // callback that starts the next phase's slide.
        if (this.conversationOwned) return;
        this.battle?.update(ctx);
        this.handCarriedCatOver();
        this.boundCats?.update();
        if (this.warden !== null && !this.warden.isAlive) this.beginFall(this.warden);
        return;
      default: {
        const unhandled: never = this.stage;
        throw new Error(`unhandled ritual stage ${String(unhandled)}`);
      }
    }
  }

  /**
   * The fight's stems, decoded only from the storey below the cattery up and
   * only while the ritual is still ahead: they are large, and anywhere else
   * in the tower nothing can play them.
   */
  private holdFightMusic(storey: number): void {
    const nearTheTop = storey >= ARCHIVE_STOREY && this.ritualAhead;
    this.deps.audio?.holdSfxGroup('wardenRitualMusic', nearTheTop);
  }

  // ── The reveal ─────────────────────────────────────────────────────────────

  private arrive(): void {
    const choice = madeAvielChoice(this.deps.progress);
    const revealOwed = this.deps.progress.phase === 'ascent';
    enterMissingCatsPhase(this.deps.progress, 'ritual', this.deps.bus);
    this.deps.saveBeforeFight();
    prewarmLichLocomotion();
    prewarmLichFightEffects();
    this.raiseWarden();
    this.boundCats = new BoundCats(
      this.deps.map,
      this.boundCatIds(),
      this.deps.map.startTile,
      Math.random,
    );
    this.claimFightMusic();
    if (!revealOwed) {
      this.beginFight(choice);
      return;
    }
    this.stage = 'reveal';
    this.holdRoom();
    this.openBlocking(wardenReveal(this.boundPillars().length > 0), () => this.beginFight(choice));
  }

  private raiseWarden(): void {
    const target = {
      x: RITUAL_CIRCLE_TILE.x + WARDEN_CIRCLE_OFFSET.dx,
      y: RITUAL_CIRCLE_TILE.y + WARDEN_CIRCLE_OFFSET.dy,
    };
    const tile =
      findNearbyWalkableTile(this.deps.map, target.x, target.y, SPAWN_SEARCH_RADIUS_TILES) ??
      target;
    const warden = spawnMob('the_lich', tile, this.deps.map, RITUAL_SPAWNS);
    warden.applyMobLevel(questMobLevel(WARDEN_LEVEL, this.deps.partyLevel()));
    applySpawnDifficulty(warden);
    this.deps.addMob(warden);
    this.warden = warden;
    const healer = spawnHardModeBossHealer(
      warden,
      this.deps.map,
      this.deps.addMob,
      level3.floorNumber,
    );
    if (healer !== null) this.healers.push(healer);
  }

  // ── The fight ──────────────────────────────────────────────────────────────

  private beginFight(choice: AvielChoice): void {
    const warden = this.warden;
    if (warden === null) return;
    this.stage = 'fight';
    const binding = this.binding(choice);
    this.battle = new LichBattleSystem(
      this.deps.map,
      warden,
      this.deps.audio,
      this.deps.companion,
      {
        openBark: (line, onClosed) => this.openBark(line, onClosed),
        showBanner: (title, subtitle) => this.showBanner({ title, subtitle, tone: 'danger' }),
        onBindingBroken: () => this.claimFightMusic(),
      },
      binding,
    );
    this.showBanner(binding.boundPillars.length > 0 ? FIGHT_BANNER_BOUND : FIGHT_BANNER_FREE);
    this.holdRoom();
    this.deps.bus.emit('bossFightInitiated', { bossType: 'the_lich' });
  }

  /** The cats nobody let out of their cages. */
  private boundCatIds(): TownCatId[] {
    return TOWN_CAT_IDS.filter((cat) => this.deps.conditions.boundCats.has(cat));
  }

  /** The cats nobody let out, each bound to its pillar. */
  private boundPillars(): LichBindingPillar[] {
    return this.boundCatIds().map((cat) => {
      const { x, y } = TOWER_BINDING_PILLARS[cat];
      return { id: bindingPillarId(cat), tile: { col: x, row: y } };
    });
  }

  private binding(choice: AvielChoice): LichBinding {
    const window = this.observatoryWindow();
    const everyPillar = TOWN_CAT_IDS.map((cat) => {
      const { x, y } = TOWER_BINDING_PILLARS[cat];
      return { id: bindingPillarId(cat), tile: { col: x, row: y } };
    });
    const nearestTheWindowFirst = [...everyPillar].sort(
      (a, b) => tileSpan(a.tile, window) - tileSpan(b.tile, window),
    );
    const carrier = CARRIER_BY_CHOICE[choice];
    prewarmTowerCarrier(carrier);
    return {
      boundPillars: this.boundPillars(),
      carrierOrder: nearestTheWindowFirst.map((pillar) => pillar.id),
      carrierWindow: window,
      carrier,
      carrierArrives: CARRIER_ARRIVES[choice],
      catLookAt: catLookAtPillar,
      onPillarShattered: (id) => {
        this.deps.map.setPlacedInteriorPropVariant(id, BINDING_PILLAR_VARIANT.broken);
        const cat = catAtPillar(id);
        const carried = this.battle?.pillarOfCatInTalons === id;
        if (cat !== null && !carried) this.boundCats?.unbind(cat);
      },
    };
  }

  /** The tile under the middle of the observatory window, where the carrier comes in. */
  private observatoryWindow(): TilePos {
    const window = this.deps.map.placedInteriorProps.find(
      (placed) => placed.propId === 'sky_window',
    );
    if (window === undefined) return { col: RITUAL_CIRCLE_TILE.x, row: RITUAL_CIRCLE_TILE.y };
    const { w } = TOWN_INTERIOR_PROPS.sky_window.footprint;
    return { col: window.tile.x + Math.floor(w / 2), row: window.tile.y };
  }

  /** The cat the carrier has just lifted is drawn in its talons from now on, not at her pillar. */
  private handCarriedCatOver(): void {
    const pillar = this.battle?.pillarOfCatInTalons ?? null;
    const cat = pillar === null ? null : catAtPillar(pillar);
    if (cat !== null) this.boundCats?.carriedOff(cat);
  }

  private claimFightMusic(): void {
    const anyBound = (this.battle?.litPillars.size ?? this.boundPillars().length) > 0;
    const stem = anyBound ? FIGHT_STEMS.bound : FIGHT_STEMS.free;
    if (stem === this.fightStem) return;
    this.fightStem = stem;
    this.deps.music?.claimMusic({
      owner: 'tower_finale',
      layer: 'boss',
      selection: { kind: 'stems', set: 'warden_ritual', stem },
    });
  }

  /** The fight's music belongs to the cattery: it stops off it, and starts again on coming back up. */
  private releaseFightMusic(): void {
    if (this.fightStem === null) return;
    this.deps.music?.releaseMusic('tower_finale');
    this.fightStem = null;
  }

  private beginFall(warden: TheLich): void {
    this.stage = 'falling';
    this.battle?.dispose();
    this.battle = null;
    this.deps.audio?.stopSound('skeleton_lord_chant');
    this.deps.audio?.stopSound('magic_ball_launch');
    this.deps.audio?.stopSound('magic_ball_impact');
    this.deps.audio?.stopSound('fireball_launch');
    this.deps.audio?.stopSound('deep_rumbling');
    this.deps.audio?.stopSound('charging_up_1');
    this.deps.bus.emit('bossDefeated', { bossType: 'the_lich', mob: warden });
    this.releaseFightMusic();
    this.openBlocking(WARDEN_FALLS, () => this.finish());
  }

  private finish(): void {
    this.stage = 'done';
    this.showBanner(FALLEN_BANNER);
    enterMissingCatsPhase(this.deps.progress, 'aftermath', this.deps.bus);
    this.deps.audio?.holdSfxGroup('wardenRitualMusic', false);
    const catsInRoom = this.boundCats?.inRoom() ?? [];
    this.boundCats?.dispose();
    this.boundCats = null;
    const { map } = this.deps;
    this.catsWalkingOut = new CatsWalkOut(map, catsInRoom, map.startTile, Math.random);
    this.deps.onWardenFallen();
  }

  // ── Holding the room ───────────────────────────────────────────────────────

  /**
   * Freezes the Warden and anything at its side for the length of the beat
   * or the card that opens the fight, so the fight is never already running
   * under the page announcing it.
   */
  private holdRoom(): void {
    this.heldForBanner = true;
    for (const mob of this.encounterMobs()) {
      mob.aiHeld = true;
      mob.offLimitsToAllies = true;
    }
  }

  private releaseRoom(): void {
    if (this.stage !== 'fight') return;
    this.heldForBanner = false;
    for (const mob of this.encounterMobs()) {
      mob.aiHeld = false;
      mob.offLimitsToAllies = false;
    }
  }

  private encounterMobs(): Mob[] {
    return this.warden === null ? [...this.healers] : [this.warden, ...this.healers];
  }

  private showBanner(card: BannerCard): void {
    this.banner = card;
    this.bannerTimer = QUEST_BANNER_FRAMES;
  }

  // ── Dialog ─────────────────────────────────────────────────────────────────

  /** Opens a beat whose Escape and walk-away do nothing until it is read. */
  private openBlocking(lines: NonEmpty<DialogLine>, onClosed: () => void): void {
    this.conversationHandle = this.conversation.open({
      lines,
      reward: null,
      questRelated: true,
      ending: { kind: 'close', onClosed },
      dismiss: { kind: 'blocked' },
      haltsWorld: true,
      anchor: null,
      locksKeyboard: true,
    });
  }

  private openBark(line: BarkLine, onClosed: () => void): void {
    this.openBlocking([line], onClosed);
  }

  // ── The storey's hooks ─────────────────────────────────────────────────────

  tryInteract(ctx: SystemContext): boolean {
    return this.battle?.tryInteract(ctx.active) ?? false;
  }

  /** The party walked off the cattery; see `LichBattleSystem.leaveFloor`. */
  leaveFloor(ctx: SystemContext): void {
    this.battle?.leaveFloor(ctx);
    this.releaseFightMusic();
  }

  dispose(): void {
    this.battle?.dispose();
    this.battle = null;
    this.boundCats?.dispose();
    this.boundCats = null;
    this.catsWalkingOut?.dispose();
    this.catsWalkingOut = null;
    this.releaseFightMusic();
    this.deps.audio?.holdSfxGroup('wardenRitualMusic', false);
  }

  renderWorld(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.battle?.renderWorld(ctx, camX, camY);
  }

  /** The bound cats, or the freed ones running for the stair, for the room's depth-sorted pass. */
  roomFigures(): InteriorFigure[] {
    return [
      ...(this.boundCats?.roomFigures() ?? []),
      ...(this.catsWalkingOut?.sortedFigures() ?? []),
    ];
  }

  renderEffects(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.battle?.renderEffects(ctx, camX, camY, this.frameCount);
  }

  renderInteractionPrompts(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: WorkChannelBuilder,
  ): void {
    this.battle?.renderInteractionPrompts(ctx, camX, camY, active);
  }

  topBandEntries(): TopBandEntry[] {
    const entries: TopBandEntry[] = [];
    const bossBar = this.bossBarEntry();
    if (bossBar !== null) entries.push(bossBar);
    const banner = questBannerEntry({
      id: 'tower-ritual-banner',
      title: this.banner.title,
      subtitle: this.banner.subtitle,
      framesLeft: this.bannerTimer,
      tone: this.banner.tone,
    });
    if (banner !== null) entries.push(banner);
    return entries;
  }

  /** {@link WARDEN_ARENA_ROWS} while the Warden stands in the circle. */
  cameraKeepRows(): WorldRows | null {
    if (this.stage !== 'reveal' && this.stage !== 'fight') return null;
    return WARDEN_ARENA_ROWS;
  }

  private bossBarEntry(): TopBandEntry | null {
    const warden = this.warden;
    if (warden === null || !warden.isAlive || this.stage !== 'fight') return null;
    const rows: BandRow[] = [
      { kind: 'text', text: WARDEN_NAME, role: 'label', tone: 'danger' },
      {
        kind: 'meter',
        id: 'tower-ritual-boss/hp',
        value: warden.hp,
        max: warden.maxHp,
        meterKind: 'boss',
        valueText: `${displayHp(warden.hp)} / ${warden.maxHp}`,
      },
    ];
    const dodgeClock = this.battle?.dodgeClockRow() ?? null;
    if (dodgeClock !== null) rows.push(dodgeClock);
    const objective = this.battle?.objectiveLine;
    if (objective !== undefined) rows.push(objectiveRow({ text: objective, tone: 'success' }));
    return stackedBandEntry({
      id: 'tower-ritual-boss',
      priority: 'boss',
      accentTone: 'danger',
      rows,
    });
  }
}

/** The cat bound to the pillar placed under `id`, or null for an id that is no pillar. */
function catAtPillar(id: string): TownCatId | null {
  return TOWN_CAT_IDS.find((candidate) => bindingPillarId(candidate) === id) ?? null;
}

/** The look of the cat bound to the pillar placed under `id`, or null for an id that is no pillar. */
function catLookAtPillar(id: string): CatLook | null {
  const cat = catAtPillar(id);
  return cat === null ? null : TOWN_CATS[cat].look;
}

function tileSpan(a: TilePos, b: TilePos): number {
  return Math.hypot(a.col - b.col, a.row - b.row);
}
