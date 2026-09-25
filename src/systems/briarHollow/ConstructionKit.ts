/**
 * ConstructionKit — the village's defences as one unit inside
 * `BriarHollowKit`: the structures and their map (`DefenseStructures`), the
 * gate's doors (`VillageGate`), the build and repair jobs
 * (`ConstructionSystem`), and the menus that drive them — the Construction
 * menu, the Structure menu, the ammunition picker and the dismantle confirm.
 *
 * `BriarHollowKit` forwards each of its hooks here with one line, so the
 * village kit stays readable and this whole feature can be followed from one
 * file. Everything durable is in `BriarHollowState`; this class holds only
 * what an open menu or a running job needs, and a rebuild on a door visit
 * starts it fresh.
 */

import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { AudioManager } from '../../audio/AudioManager';
import type { BriarHollowState } from '../../core/briarHollowState';
import type { BriarHollowSite } from '../../map/overworld/briarHollowSite';
import type { MobRoster, SceneWorld } from '../kits/SceneWorld';
import type { Mob } from '../../creatures/Mob';
import type { MenusKit } from '../kits/MenusKit';
import type { OverlayInputClaim } from '../kits/OverlayClaims';
import type { TownPropRenderable } from '../townPropRenderable';
import type { Player } from '../../Player';
import type { CrawlerKind } from '../../core/SkillManager';
import type { ResourceCost } from '../../core/partyResources';
import { canAfford, formatCost, partyCount } from '../../core/partyResources';
import { TILE_SIZE } from '../../core/constants';
import { keybindings } from '../../core/Keybindings';
import { platform } from '../../core/Platform';
import { drawText, TEXT_PRESETS } from '../../ui/TextBox';
import { interactionPromptsSuppressed } from '../../ui/InteractionPrompt';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { QuantityPicker } from '../../ui/QuantityPicker';
import {
  StructureMenu,
  type StructureMenuModel,
  type StructureMenuOption,
} from '../../ui/StructureMenu';
import type { ConstructionMenuSource } from '../../ui/ConstructionMenu';
import { infernalTrebuchets } from '../../core/craftPerks';
import {
  drawTrebuchet,
  TREBUCHET_COCKED_ANGLE,
  TREBUCHET_REACH_UP_TILES,
} from '../../sprites/art/trebuchetArt';
import { drawSnare } from '../../sprites/art/snareArt';
import {
  DefenseStructures,
  type StructureRef,
  structureKey,
  trebuchetFootprint,
} from './DefenseStructures';
import { VillageGate } from './VillageGate';
import { TrebuchetSystem } from './TrebuchetSystem';
import { SnareSystem } from './SnareSystem';
import { ConvertedAllyController } from './ConvertedAllyController';
import { resolveSiegeLevel } from './siegeLevel';
import { partyLevelOf } from '../../levels/spawner';
import { activeDifficultyProfile } from '../../core/difficultyProfiles';
import { drawOccludedCrawler } from './occludedCrawlers';
import { HOLLOW_GATE, HOLLOW_PALISADE } from '../../map/tileTypes';
import {
  BUILD_OPTIONS,
  ConstructionSystem,
  isWallOption,
  type BuildOption,
  type PushableBody,
} from './ConstructionSystem';
import {
  TREBUCHET_MAX_AMMO,
  UPDATES_PER_SECOND,
  WALL_TIERS,
  damageStageFor,
} from './structureRules';
import type { Villager } from './Villager';
import { HOLLOW_BELL_LABEL } from './hollowBell';

type Crawler = HumanPlayer | CatPlayer;

/** How close a crawler must be to a construction to work on it. */
export const STRUCTURE_REACH_TILES = 1.6;
/** The Structure menu closes when its crawler walks this far from the structure. */
const STRUCTURE_MENU_WALK_AWAY_TILES = 3;
/** "Nothing to work on here." is said at most this often, so a held key does not spam it. */
const NOTHING_NOTE_COOLDOWN_SECONDS = 3;
/** Clear of the ammo pill above a trebuchet, whether or not the pill is stacked with a neighbor's. */
const TREBUCHET_HINT_LIFT_TILES = 2.65;
/** Vertical gap between the hint's two lines. */
const TREBUCHET_HINT_LINE_GAP_PX = 13;
const SECONDS_PER_UPDATE = 1 / UPDATES_PER_SECOND;
/** A tile's centre, as a fraction of the tile from its corner. */
const TILE_CENTRE = 0.5;
/** Reach is measured to a tile's centre, so a tile whose near edge is in reach counts. */
const REACH_TO_TILE_CENTRE_SLACK = 0.5;

const GHOST_VALID_FILL = 'rgba(74,222,128,0.28)';
const GHOST_VALID_EDGE = 'rgba(74,222,128,0.9)';
const GHOST_INVALID_FILL = 'rgba(248,113,113,0.28)';
const GHOST_INVALID_EDGE = 'rgba(248,113,113,0.9)';
const GHOST_EDGE_WIDTH = 2;
const HIGHLIGHT_EDGE = 'rgba(253,230,138,0.95)';
/** How far outside its tile a segment's highlight is drawn, so it reads over the wall art. */
const HIGHLIGHT_INSET = 1;

/** How long the Build button pulses the first time it appears. */
const BUILD_BUTTON_PULSE_SECONDS = 5;

/** How far above the faced wall tile the build prompt's two lines float. */
const WALL_PROMPT_LIFT_TILES = 1.35;
/** The cost line sits this far below the first line. */
const WALL_PROMPT_LINE_GAP_PX = 13;
/**
 * Whether the Build button has been shown yet this page. Module state, like
 * the session's resource tally: a door visit rebuilds the kit, and the pulse
 * is for the first sighting, not every re-entry.
 */
let buildButtonSeen = false;

/** Past half open, the gate's doors have swung out of the way of anyone behind them. */
const GATE_SEE_THROUGH_OPEN = 0.5;
/** A trebuchet's frame stands this many rows above its footprint, over anyone standing there. */
const TREBUCHET_OCCLUDES_ROWS = 2;

const DISMANTLE_MESSAGE =
  'Are you sure you want to permanently remove this? Resources will NOT be refunded.';

export interface ConstructionKitDeps {
  readonly world: SceneWorld;
  readonly site: BriarHollowSite;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly state: BriarHollowState;
  readonly menus: MenusKit;
  readonly audio: AudioManager | null;
  /** Keeps the resource strip up while something is being built or loaded. */
  readonly noteResourceActivity: () => void;
  /** Told of every tile whose type changed, for the minimap. */
  readonly onTileChanged: (tileX: number, tileY: number) => void;
  /** The villagers, who open the gate and are pushed clear of a trebuchet like anyone else. */
  readonly villagers: () => readonly Villager[];
  /** Seconds of village life, for when the gate was last struck. */
  readonly clockSeconds: () => number;
  /** Whether a body stands in a safe room, where nothing the defences throw may land. */
  readonly isInSafeRoom: (point: { readonly x: number; readonly y: number }) => boolean;
  /**
   * Whether the world is stopped under a menu. The kit is ticked through
   * those, and a trebuchet or a snare must not keep fighting a paused world.
   */
  readonly worldHalted: () => boolean;
}

export class ConstructionKit {
  readonly defense: DefenseStructures;
  readonly gate: VillageGate;
  readonly construction: ConstructionSystem;
  /** What the trebuchets do once built: aim, throw, and what lands. */
  readonly trebuchets: TrebuchetSystem;
  /** What the snares do when a hostile steps on one. */
  readonly snares: SnareSystem;
  /** The enemies a level-15 snare has turned, for as long as that lasts. */
  readonly allies: ConvertedAllyController;
  private readonly deps: ConstructionKitDeps;
  private readonly structureMenu: StructureMenu;
  private readonly confirm: ConfirmModal;
  private readonly picker: QuantityPicker;
  private structureTarget: StructureRef | null = null;
  private preview: BuildOption | null = null;
  private secondsSinceNothingNote = NOTHING_NOTE_COOLDOWN_SECONDS;
  private buildPulseSecondsLeft = 0;
  private timeSeconds = 0;
  private readonly entityBuffer: TownPropRenderable[] = [];
  private readonly menuSource: ConstructionMenuSource;

  constructor(deps: ConstructionKitDeps) {
    this.deps = deps;
    const { world, site, state, audio } = deps;
    this.defense = new DefenseStructures({
      gameMap: world.gameMap,
      site,
      state,
      bus: world.bus,
      audio,
      roster: world.roster,
      constructionLevel: (kind) => this.levelOf(kind),
      crawler: (kind) => this.crawler(kind),
      onTileChanged: deps.onTileChanged,
      clockSeconds: deps.clockSeconds,
    });
    this.gate = new VillageGate(world.gameMap.structure, site, audio);
    this.construction = new ConstructionSystem({
      gameMap: world.gameMap,
      site,
      defense: this.defense,
      human: deps.human,
      cat: deps.cat,
      roster: world.roster,
      audio,
      announce: (message) => deps.menus.announce(message),
      noteResourceActivity: deps.noteResourceActivity,
      bodies: () => this.pushableBodies(),
      indoors: false,
    });
    this.allies = new ConvertedAllyController(world.roster, audio);
    this.trebuchets = new TrebuchetSystem({
      defense: this.defense,
      site,
      roster: world.roster,
      bus: world.bus,
      audio,
      human: deps.human,
      cat: deps.cat,
      active: () => this.active(),
      constructionLevel: (kind) => this.levelOf(kind),
      siegeLevel: () =>
        resolveSiegeLevel(
          partyLevelOf(deps.human.level, deps.cat.level),
          activeDifficultyProfile(),
        ),
      questPhase: () => state.quest.phase,
      isInSafeRoom: deps.isInSafeRoom,
    });
    this.snares = new SnareSystem({
      defense: this.defense,
      roster: world.roster,
      audio,
      human: deps.human,
      cat: deps.cat,
      constructionLevel: (kind) => this.levelOf(kind),
      allies: this.allies,
      callouts: this.trebuchets.callouts,
    });
    this.structureMenu = new StructureMenu(audio);
    this.confirm = new ConfirmModal(audio);
    this.picker = new QuantityPicker(audio);
    this.menuSource = {
      // The wall rows only mean anything while facing a section of the ring:
      // away from the wall, the menu shows only what can be built anywhere.
      rows: () => {
        const nearWall = this.construction.isNearWall();
        return BUILD_OPTIONS.filter((option) => nearWall || !isWallOption(option)).map((option) =>
          this.construction.optionStatus(option),
        );
      },
      start: (option) => this.construction.startOption(option),
      setPreview: (option) => {
        this.preview = option;
      },
    };
  }

  private crawler(kind: CrawlerKind): Crawler {
    return kind === 'human' ? this.deps.human : this.deps.cat;
  }

  private levelOf(kind: CrawlerKind): number {
    const skills = this.crawler(kind).craftSkills;
    return skills.isLearned('construction') ? skills.getLevel('construction') : 0;
  }

  private active(): Crawler {
    return this.deps.human.isActive ? this.deps.human : this.deps.cat;
  }

  private get learned(): boolean {
    return this.active().craftSkills.isLearned('construction');
  }

  /** Whether the HUD's Build button shows: once either crawler has learned Construction. */
  get buildButtonVisible(): boolean {
    return (
      this.deps.human.craftSkills.isLearned('construction') ||
      this.deps.cat.craftSkills.isLearned('construction')
    );
  }

  /** Seconds left on the Build button's first-sighting pulse. */
  get buildButtonPulseSeconds(): number {
    return this.buildPulseSecondsLeft;
  }

  get constructionMenuOpen(): boolean {
    return this.deps.menus.constructionMenu.isOpen;
  }

  // ── Bodies ──────────────────────────────────────────────────────────────

  private pushableBodies(): PushableBody[] {
    const roster = this.deps.world.roster;
    const bodies: PushableBody[] = [
      crawlerPushBody(this.deps.human),
      crawlerPushBody(this.deps.cat),
    ];
    for (const mob of roster.mobs) {
      if (mob.isAlive) bodies.push(mobPushBody(mob, roster));
    }
    for (const villager of this.deps.villagers()) {
      bodies.push({
        get x() {
          return villager.x;
        },
        get y() {
          return villager.y;
        },
        // A villager is not a physics body: it is set down clear and walks on from there.
        place: (x, y) => {
          villager.x = x;
          villager.y = y;
          villager.clearPath();
        },
      });
    }
    return bodies;
  }

  /** Every friendly body the gate opens for: the party, their allies and the villagers. */
  private friendlies(): Array<{ x: number; y: number }> {
    const friends: Array<{ x: number; y: number }> = [this.deps.human, this.deps.cat];
    for (const mob of this.deps.world.roster.mobs) {
      if (mob.isAlive && !mob.isHostile) friends.push(mob);
    }
    for (const villager of this.deps.villagers()) friends.push(villager);
    return friends;
  }

  // ── Per frame ───────────────────────────────────────────────────────────

  update(): void {
    this.timeSeconds += SECONDS_PER_UPDATE;
    if (this.buildButtonVisible && !buildButtonSeen) {
      buildButtonSeen = true;
      this.buildPulseSecondsLeft = BUILD_BUTTON_PULSE_SECONDS;
    }
    this.buildPulseSecondsLeft = Math.max(0, this.buildPulseSecondsLeft - SECONDS_PER_UPDATE);
    this.secondsSinceNothingNote += SECONDS_PER_UPDATE;
    this.defense.update(SECONDS_PER_UPDATE);
    this.gate.update(this.friendlies(), this.defense.gateShake, SECONDS_PER_UPDATE);
    this.construction.update();
    if (!this.deps.worldHalted()) {
      // Snares first: a hostile caught this frame is held where the boulder aimed at it lands.
      this.snares.update();
      this.trebuchets.update();
      this.allies.update();
    }
    this.picker.update();
    const menu = this.deps.menus.constructionMenu;
    if (!menu.isOpen) this.preview = null;
    this.updateStructureMenu();
  }

  private updateStructureMenu(): void {
    const target = this.structureTarget;
    if (target === null) return;
    if (!this.defense.exists(target) || this.walkedAway(target)) this.closeStructureMenu();
  }

  private walkedAway(target: StructureRef): boolean {
    const active = this.active();
    const centreX = active.x + TILE_SIZE / 2;
    const centreY = active.y + TILE_SIZE / 2;
    const limit = STRUCTURE_MENU_WALK_AWAY_TILES * TILE_SIZE;
    return this.defense
      .footprintOf(target)
      .every(
        (tile) =>
          Math.hypot(
            (tile.x + TILE_CENTRE) * TILE_SIZE - centreX,
            (tile.y + TILE_CENTRE) * TILE_SIZE - centreY,
          ) > limit,
      );
  }

  // ── Opening things ──────────────────────────────────────────────────────

  openConstruction(): void {
    const menu = this.deps.menus.constructionMenu;
    if (menu.isOpen) {
      menu.close();
      return;
    }
    if (!this.learned) {
      this.deps.menus.announce('You have not learned Construction yet.');
      return;
    }
    this.closeStructureMenu();
    menu.openWith(this.menuSource, false);
  }

  /** The Structure menu key. Returns whether a menu opened. */
  tryStructureMenu(): boolean {
    if (this.structureMenu.isOpen) {
      this.closeStructureMenu();
      return true;
    }
    if (!this.learned) return false;
    const target = this.defense.nearestInReach(this.active(), STRUCTURE_REACH_TILES);
    return this.openStructureMenuOn(target);
  }

  private openStructureMenuOn(target: StructureRef | null): boolean {
    if (target === null) {
      if (this.secondsSinceNothingNote >= NOTHING_NOTE_COOLDOWN_SECONDS) {
        this.secondsSinceNothingNote = 0;
        this.deps.menus.announce('Nothing to work on here.');
      }
      return false;
    }
    if (target.kind === 'gate') {
      this.deps.menus.announce('The gate is sound.');
      return false;
    }
    this.deps.menus.constructionMenu.close();
    this.structureTarget = target;
    this.structureMenu.show();
    return true;
  }

  private closeStructureMenu(): void {
    this.structureTarget = null;
    this.structureMenu.close();
  }

  quickLoad(): void {
    if (!this.learned) return;
    this.construction.quickLoad(STRUCTURE_REACH_TILES);
  }

  /**
   * The build key (desktop) or a double tap (mobile) pressed over a wall the
   * active crawler faces: raises it the same way choosing that tier's row in
   * the Construction menu would, without opening any menu first. Returns
   * whether it started a job.
   */
  tryBuildWall(): boolean {
    if (!this.learned || this.isMenuOpen) return false;
    return this.construction.tryBuildFacedWall();
  }

  /**
   * The contextual "press the build key" prompt over a wall the active
   * crawler faces: what it would raise the wall to and what that costs (the
   * same information the Structure menu's Upgrade row shows), then how to
   * open that menu for repairs and the rest.
   * Returns whether it drew one, for the scene's prompt chain.
   */
  renderWallBuildPrompt(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: Crawler,
  ): boolean {
    if (!this.learned || this.isMenuOpen || this.construction.job !== null) return false;
    if (interactionPromptsSuppressed()) return false;
    const prompt = this.construction.wallBuildPrompt(active);
    const tile = this.construction.wallPromptTile(active);
    if (prompt === null || tile === null) return false;
    const sx = (tile.x + TILE_CENTRE) * TILE_SIZE - camX;
    const topY = tile.y * TILE_SIZE - camY - WALL_PROMPT_LIFT_TILES * TILE_SIZE;
    const buildLine = platform.isMobile
      ? `Double tap to build ${WALL_TIERS[prompt.tier].label}`
      : `Press ${keybindings.labelFor('attack')} to build ${WALL_TIERS[prompt.tier].label}`;
    drawText(ctx, buildLine, { x: sx, y: topY, align: 'center', ...TEXT_PRESETS.label });
    drawText(ctx, `Cost: ${formatCost(prompt.cost)}.`, {
      x: sx,
      y: topY + WALL_PROMPT_LINE_GAP_PX,
      align: 'center',
      outline: true,
      ...TEXT_PRESETS.hint,
    });
    const menuLine = platform.isMobile
      ? 'Long-tap for menu'
      : `Press ${keybindings.labelFor('structureMenu')} for menu`;
    drawText(ctx, menuLine, {
      x: sx,
      y: topY + 2 * WALL_PROMPT_LINE_GAP_PX,
      align: 'center',
      outline: true,
      ...TEXT_PRESETS.hint,
    });
    return true;
  }

  /** Long-press on a construction: its Structure menu. Only a structure under the finger claims the press. */
  handleLongPress(screenX: number, screenY: number, camX: number, camY: number): boolean {
    const target = this.structureAtScreen(screenX, screenY, camX, camY);
    if (target === null || !this.learned) return false;
    if (!this.inReach(target)) {
      this.deps.menus.announce('Get closer to work on that.');
      return true;
    }
    this.openStructureMenuOn(target);
    return true;
  }

  /**
   * Whether a finger resting here would be a long-press on a structure this
   * crawler can work on — while it is, the hold must not walk the crawler
   * toward it, or the press would be rejected as the end of a walk.
   */
  isStructureUnderFinger(screenX: number, screenY: number, camX: number, camY: number): boolean {
    if (!this.learned) return false;
    const target = this.structureAtScreen(screenX, screenY, camX, camY);
    return target !== null && target.kind !== 'gate' && this.inReach(target);
  }

  /** Double-tap on a trebuchet: Quick Load it. Double-tap on a wall: build it, the mobile equivalent of the build key. */
  handleDoubleTap(screenX: number, screenY: number, camX: number, camY: number): boolean {
    const target = this.structureAtScreen(screenX, screenY, camX, camY);
    if (target === null || !this.learned || !this.inReach(target)) return false;
    if (target.kind === 'trebuchet') {
      this.construction.quickLoad(STRUCTURE_REACH_TILES);
      return true;
    }
    if (target.kind === 'segment' && !this.isMenuOpen)
      return this.construction.startUpgrade(target);
    return false;
  }

  private structureAtScreen(
    screenX: number,
    screenY: number,
    camX: number,
    camY: number,
  ): StructureRef | null {
    const tileX = Math.floor((screenX + camX) / TILE_SIZE);
    const tileY = Math.floor((screenY + camY) / TILE_SIZE);
    const direct = this.defense.at(tileX, tileY);
    if (direct !== null) return direct;
    // A standing wall and a trebuchet are drawn taller than the tiles they
    // stand on, so a finger on the art above the footing is still a finger on
    // the structure. A snare, the gate and a fallen wall are flat.
    const below = this.defense.at(tileX, tileY + 1);
    if (below?.kind === 'trebuchet') return below;
    if (below?.kind === 'segment' && !this.defense.isOpening(below.id)) return below;
    return null;
  }

  private inReach(target: StructureRef): boolean {
    const active = this.active();
    const centreX = active.x + TILE_SIZE / 2;
    const centreY = active.y + TILE_SIZE / 2;
    const reach = (STRUCTURE_REACH_TILES + REACH_TO_TILE_CENTRE_SLACK) * TILE_SIZE;
    return this.defense
      .footprintOf(target)
      .some(
        (tile) =>
          Math.hypot(
            (tile.x + TILE_CENTRE) * TILE_SIZE - centreX,
            (tile.y + TILE_CENTRE) * TILE_SIZE - centreY,
          ) <= reach,
      );
  }

  // ── The Structure menu's model ──────────────────────────────────────────

  private structureModel(
    target: StructureRef,
    camX: number,
    camY: number,
  ): StructureMenuModel | null {
    const defense = this.defense;
    const construction = this.construction;
    const tiles = defense.footprintOf(target);
    if (tiles.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const tile of tiles) {
      minX = Math.min(minX, tile.x);
      minY = Math.min(minY, tile.y);
      maxX = Math.max(maxX, tile.x + 1);
      maxY = Math.max(maxY, tile.y + 1);
    }
    const anchor = {
      x: minX * TILE_SIZE - camX,
      y: minY * TILE_SIZE - camY,
      w: (maxX - minX) * TILE_SIZE,
      h: (maxY - minY) * TILE_SIZE,
    };
    const record = defense.record(target);
    const options: StructureMenuOption[] = [];
    const busy = construction.job !== null ? 'Already building' : undefined;
    const affordReason = (cost: ResourceCost): string | undefined =>
      busy ??
      (canAfford(this.deps.human, this.deps.cat, cost) ? undefined : 'Not enough materials');
    const act = (start: () => boolean) => () => {
      this.closeStructureMenu();
      start();
    };

    const upgradeCost = construction.upgradeCostFor(target);
    const upgradeTier = defense.upgradeTarget(target);
    if (upgradeCost !== null && upgradeTier !== null) {
      options.push({
        label: `Upgrade to ${WALL_TIERS[upgradeTier].label}`,
        cost: upgradeCost,
        disabledReason: affordReason(upgradeCost),
        action: act(() => construction.startUpgrade(target)),
      });
    }
    const trebuchetKey = target.kind === 'trebuchet' ? target.key : null;
    if (trebuchetKey !== null && !construction.hasUnlimitedAmmo(trebuchetKey)) {
      const room = construction.ammoRoom(trebuchetKey);
      const stone = construction.partyStone();
      options.push({
        label: 'Load Stone…',
        disabledReason:
          room <= 0 ? 'The trebuchet is full' : stone <= 0 ? 'You have no stone' : undefined,
        action: () => this.openLoadPicker(trebuchetKey),
      });
      options.push({
        label: `Quick Load [${keybindings.labelFor('quickLoad')}]`,
        disabledReason:
          room <= 0 ? 'The trebuchet is full' : stone <= 0 ? 'You have no stone' : undefined,
        action: () => {
          this.closeStructureMenu();
          construction.quickLoad(STRUCTURE_REACH_TILES);
        },
      });
    }
    const repairCost = construction.repairCostFor(target);
    if (repairCost !== null) {
      options.push({
        label: 'Repair',
        cost: repairCost,
        disabledReason: affordReason(repairCost),
        action: act(() => construction.startRepair(target)),
      });
    }
    if (construction.spikesAvailable() && defense.spikesNeedWork(target)) {
      const cost = construction.spikesCostFor();
      options.push({
        label: record?.spikesHp === null || record === null ? 'Add Spikes' : 'Repair Spikes',
        cost,
        disabledReason: affordReason(cost),
        action: act(() => construction.startSpikes(target)),
      });
    }
    if (target.kind === 'trebuchet' || target.kind === 'snare') {
      options.push({
        label: 'Destroy',
        style: 'danger',
        action: () => this.confirmDestroy(target),
      });
    }
    options.push({ label: 'Cancel', style: 'cancel', action: () => this.closeStructureMenu() });

    const maxHp = defense.maxHp(target);
    const spikesHp = record?.spikesHp ?? null;
    return {
      title: this.structureTitle(target),
      hp: defense.hp(target),
      maxHp,
      spikesHp,
      spikesMaxHp: defense.spikesMaxHp(target),
      detail: this.structureDetail(target),
      options,
      anchor,
    };
  }

  private structureTitle(target: StructureRef): string {
    const defense = this.defense;
    switch (target.kind) {
      case 'segment': {
        const tier = defense.segmentTier(target.id);
        if (tier === 'gap') return 'Gap in the fence';
        if (tier === 'breach') {
          const record = defense.record(target);
          const former = record?.kind === 'segment' ? (record.formerTier ?? 'wood') : 'wood';
          return `${WALL_TIERS[former].label} — breached`;
        }
        return WALL_TIERS[tier].label;
      }
      case 'trebuchet':
        return defense.trebuchet(target.key)?.broken === true ? 'Trebuchet — broken' : 'Trebuchet';
      case 'snare':
        return defense.snare(target.key)?.broken === true ? 'Snare Trap — broken' : 'Snare Trap';
      case 'gate':
        return 'The Gate';
      case 'bell':
        return HOLLOW_BELL_LABEL;
    }
  }

  private structureDetail(target: StructureRef): string | undefined {
    if (target.kind !== 'trebuchet') return undefined;
    const record = this.defense.trebuchet(target.key);
    if (record === null) return undefined;
    if (this.construction.hasUnlimitedAmmo(target.key)) return 'Ammunition: never runs dry';
    return `Ammunition: ${record.ammo} / ${TREBUCHET_MAX_AMMO} stone`;
  }

  private openLoadPicker(key: string): void {
    const max = Math.min(this.construction.partyStone(), this.construction.ammoRoom(key));
    if (max <= 0) return;
    this.closeStructureMenu();
    this.picker.open({
      title: 'Load Stone',
      max,
      initial: max,
      unitLabel: 'stone',
      confirmLabel: 'Load',
      onConfirm: (qty) => {
        const moved = this.construction.depositAmmo(key, qty);
        if (moved > 0) this.deps.menus.announce(`Loaded ${moved} stone.`);
      },
      onCancel: () => undefined,
    });
  }

  private confirmDestroy(target: StructureRef): void {
    this.closeStructureMenu();
    this.confirm.open({
      message: DISMANTLE_MESSAGE,
      yesLabel: 'Yes',
      noLabel: 'No',
      onYes: () => {
        if (this.construction.job !== null) this.construction.cancelJob();
        this.defense.destroy(target);
      },
      onNo: () => undefined,
    });
  }

  // ── Drawing ─────────────────────────────────────────────────────────────

  /** The placement ghost for a hovered Construction row, and the targeted segment's outline. */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.trebuchets.renderGround(ctx, camX, camY);
    const option = this.preview;
    if (option !== null && this.deps.menus.constructionMenu.isOpen) {
      const preview = this.construction.previewFor(option);
      if (preview !== null) {
        const fill = preview.valid ? GHOST_VALID_FILL : GHOST_INVALID_FILL;
        const edge = preview.valid ? GHOST_VALID_EDGE : GHOST_INVALID_EDGE;
        for (const tile of preview.tiles) {
          const x = tile.x * TILE_SIZE - camX;
          const y = tile.y * TILE_SIZE - camY;
          ctx.fillStyle = fill;
          ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
          ctx.strokeStyle = edge;
          ctx.lineWidth = GHOST_EDGE_WIDTH;
          ctx.strokeRect(x + 1, y + 1, TILE_SIZE - 2, TILE_SIZE - 2);
        }
      }
    }
    const target = this.structureTarget;
    if (target !== null) {
      ctx.strokeStyle = HIGHLIGHT_EDGE;
      ctx.lineWidth = GHOST_EDGE_WIDTH;
      for (const tile of this.defense.footprintOf(target)) {
        ctx.strokeRect(
          tile.x * TILE_SIZE - camX - HIGHLIGHT_INSET,
          tile.y * TILE_SIZE - camY - HIGHLIGHT_INSET,
          TILE_SIZE + HIGHLIGHT_INSET * 2,
          TILE_SIZE + HIGHLIGHT_INSET * 2,
        );
      }
    }
  }

  /** Trebuchets and snares, Y-sorted with every body. */
  renderEntities(): ReadonlyArray<TownPropRenderable> {
    const buffer = this.entityBuffer;
    buffer.length = 0;
    const time = this.timeSeconds;
    for (const record of this.defense.trebuchets) {
      const key = structureKey(record.x, record.y);
      const builderLevel = this.levelOf(record.builtBy);
      const maxHp = this.defense.maxHp({ kind: 'trebuchet', key });
      const footprint = trebuchetFootprint(record.x, record.y);
      const pose = this.trebuchets.armPose(key);
      buffer.push({
        x: footprint.x * TILE_SIZE,
        // Sorted on its front row, so a body standing in front is drawn over it.
        y: (footprint.y + footprint.h - 1) * TILE_SIZE,
        cullMarginTiles: TREBUCHET_REACH_UP_TILES + footprint.h,
        render: (ctx, camX, camY, tileSize) =>
          drawTrebuchet(
            ctx,
            footprint.x * tileSize - camX,
            footprint.y * tileSize - camY,
            tileSize,
            {
              armAngle: pose.armAngle,
              slingPhase: pose.slingPhase,
              broken: record.broken,
              damageStage: damageStageFor(record.hp, maxHp),
              spikes: record.spikesHp !== null && record.spikesHp > 0,
              ammoFraction: this.construction.hasUnlimitedAmmo(key)
                ? 1
                : record.ammo / TREBUCHET_MAX_AMMO,
              infernal: infernalTrebuchets(builderLevel),
              timeSeconds: time,
            },
          ),
      });
    }
    const scaffold = this.construction.scaffoldProgress();
    if (scaffold !== null) {
      const { footprint, progress } = scaffold;
      buffer.push({
        x: footprint.x * TILE_SIZE,
        y: (footprint.y + footprint.h - 1) * TILE_SIZE,
        cullMarginTiles: TREBUCHET_REACH_UP_TILES + footprint.h,
        render: (ctx, camX, camY, tileSize) =>
          drawTrebuchet(
            ctx,
            footprint.x * tileSize - camX,
            footprint.y * tileSize - camY,
            tileSize,
            {
              armAngle: TREBUCHET_COCKED_ANGLE,
              slingPhase: 0,
              broken: false,
              damageStage: 0,
              spikes: false,
              ammoFraction: 0,
              infernal: false,
              progress,
            },
          ),
      });
    }
    for (const record of this.defense.snares) {
      buffer.push({
        x: record.x * TILE_SIZE,
        // A hair above its own tile, so a body standing on the snare is drawn over it.
        y: record.y * TILE_SIZE - 1,
        render: (ctx, camX, camY, tileSize) =>
          drawSnare(ctx, record.x * tileSize - camX, record.y * tileSize - camY, tileSize, {
            look: this.snares.lookFor(record),
            spikes: record.spikesHp !== null && record.spikesHp > 0,
            timeSeconds: time,
          }),
      });
    }
    return buffer;
  }

  /** The job's progress bar, and any crawler hidden behind a wall, over every body. */
  renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const crawler of [this.deps.human, this.deps.cat]) {
      if (crawler.isAlive && this.isBehindStructure(crawler))
        drawOccludedCrawler(ctx, camX, camY, crawler);
    }
    this.snares.renderAbove(ctx, camX, camY);
    this.allies.renderAbove(ctx, camX, camY);
    this.trebuchets.renderAbove(ctx, camX, camY);
    this.construction.renderJob(ctx, camX, camY);
    this.renderTrebuchetHint(ctx, camX, camY);
  }

  /**
   * Two lines above a trebuchet in reach, spelling out its own Structure menu
   * and Quick Load, in the player's own bound keys or their device's gesture.
   * Silent whenever a menu already has the screen, or the frame's prompts are
   * suppressed outright — the same one answer every other floating prompt
   * honors.
   */
  private renderTrebuchetHint(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.structureMenu.isOpen || this.deps.menus.constructionMenu.isOpen) return;
    if (interactionPromptsSuppressed()) return;
    const target = this.defense.nearestInReach(this.active(), STRUCTURE_REACH_TILES);
    if (target?.kind !== 'trebuchet') return;
    const record = this.defense.trebuchet(target.key);
    if (record === null) return;
    const footprint = trebuchetFootprint(record.x, record.y);
    const x = (footprint.x + footprint.w / 2) * TILE_SIZE - camX;
    const y = footprint.y * TILE_SIZE - camY - TREBUCHET_HINT_LIFT_TILES * TILE_SIZE;
    const menuLine = platform.isMobile
      ? 'Long-press to open menu'
      : `Press ${keybindings.labelFor('structureMenu')} to open menu`;
    const reloadLine = platform.isMobile
      ? 'Double tap to reload'
      : `Press ${keybindings.labelFor('quickLoad')} to reload`;
    drawText(ctx, menuLine, { x, y, align: 'center', ...TEXT_PRESETS.label });
    drawText(ctx, reloadLine, {
      x,
      y: y + TREBUCHET_HINT_LINE_GAP_PX,
      align: 'center',
      ...TEXT_PRESETS.label,
    });
  }

  /**
   * Whether a crawler stands where a structure just south of them is drawn
   * over them: a wall or the shut gate in the row below, or a trebuchet's
   * frame within its height.
   */
  private isBehindStructure(crawler: Crawler): boolean {
    const tileX = Math.floor((crawler.x + TILE_SIZE / 2) / TILE_SIZE);
    const tileY = Math.floor((crawler.y + TILE_SIZE / 2) / TILE_SIZE);
    const structure = this.deps.world.gameMap.structure;
    const southY = tileY + 1;
    const row = southY >= 0 && southY < structure.length ? structure[southY] : [];
    // Only the tile straight below covers the crawler, and only a wall taller
    // than they are: a knee-high fence hides nobody.
    const below = tileX >= 0 && tileX < row.length ? row[tileX] : undefined;
    if (below?.type === HOLLOW_PALISADE && below.wallTier !== 'fence') return true;
    if (below?.type === HOLLOW_GATE && this.gate.openFraction < GATE_SEE_THROUGH_OPEN) return true;
    for (const record of this.defense.trebuchets) {
      const footprint = trebuchetFootprint(record.x, record.y);
      const coversColumn = tileX >= footprint.x && tileX < footprint.x + footprint.w;
      const justNorth =
        tileY >= footprint.y - TREBUCHET_OCCLUDES_ROWS && tileY < footprint.y + footprint.h - 1;
      if (coversColumn && justNorth) return true;
    }
    return false;
  }

  /** The village's construction menus, drawn with the scene's dialogs; the topmost last. */
  renderDialog(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const active = this.active();
    const target = this.structureTarget;
    if (target !== null && this.structureMenu.isOpen) {
      const model = this.structureModel(target, camX, camY);
      if (model !== null) {
        this.structureMenu.render(ctx, model, (id) =>
          partyCount(this.deps.human, this.deps.cat, id),
        );
      }
    }
    this.deps.menus.constructionMenu.render(
      ctx,
      { name: active === this.deps.human ? 'Carl' : 'Donut', skills: active.craftSkills },
      (id) => partyCount(this.deps.human, this.deps.cat, id),
    );
    this.picker.render(ctx);
    this.confirm.render(ctx);
  }

  // ── Input ───────────────────────────────────────────────────────────────

  /** Highest first: the confirm and the picker sit over both menus. */
  handleClick(mx: number, my: number): boolean {
    if (this.confirm.handleClick(mx, my)) return true;
    if (this.picker.handleClick(mx, my)) return true;
    if (this.deps.menus.constructionMenu.handleClick(mx, my)) return true;
    return this.structureMenu.handleClick(mx, my);
  }

  handlePointerDown(mx: number, my: number): void {
    this.picker.handlePointerDown(mx, my);
  }

  handlePointerUp(): void {
    this.picker.handlePointerUp();
  }

  /**
   * Keys for whichever construction panel is up. A held key's auto-repeat is
   * swallowed rather than acted on: otherwise holding the key that opened a
   * menu would close it again a moment later.
   */
  handleKeyDown(key: string, repeat = false): boolean {
    if (this.confirm.handleKey(key)) return true;
    if (this.picker.handleKey(key)) return true;
    if (this.deps.menus.constructionMenu.handleKey(key, repeat)) return true;
    if (this.structureMenu.isOpen && keybindings.actionFor(key) === 'structureMenu') {
      if (!repeat) this.closeStructureMenu();
      return true;
    }
    if (this.structureMenu.handleKey(key)) {
      this.structureTarget = null;
      return true;
    }
    return false;
  }

  /** Escape, reached through the scene's dismiss chain. Returns whether it closed something. */
  dismissDialog(): boolean {
    const menu = this.deps.menus.constructionMenu;
    if (menu.isOpen) {
      menu.close();
      return true;
    }
    if (this.structureMenu.isOpen) {
      this.closeStructureMenu();
      return true;
    }
    return false;
  }

  get isMenuOpen(): boolean {
    return (
      this.deps.menus.constructionMenu.isOpen ||
      this.structureMenu.isOpen ||
      this.picker.isOpen ||
      this.confirm.isOpen
    );
  }

  /** Topmost first, as the scene's list ranks them. */
  overlayClaims(): OverlayInputClaim[] {
    return [
      this.confirm.overlayClaim(),
      this.picker.overlayClaim(),
      this.deps.menus.constructionMenu.overlayClaim(),
      this.structureMenu.overlayClaim(),
    ];
  }

  /**
   * A death rewind on this same scene: whatever was mid-build never happened,
   * no menu survives the respawn, and the map is re-derived from the restored
   * state.
   */
  onRewind(): void {
    this.construction.cancelJob();
    this.closeAllPanels();
    this.defense.syncMap();
    this.snares.reset();
    this.trebuchets.reset();
    this.allies.reset();
  }

  /** Whether the dismantle confirm — the one construction panel that halts the world — is up. */
  get haltsWorldItself(): boolean {
    return this.confirm.isOpen;
  }

  /** Every construction panel down: both menus, the ammunition picker and the confirm. */
  closeAllPanels(): void {
    this.deps.menus.constructionMenu.close();
    this.closeStructureMenu();
    this.picker.close();
    this.confirm.close();
  }

  dispose(): void {
    this.construction.dispose();
    this.deps.menus.constructionMenu.close();
    this.closeStructureMenu();
  }
}

/** A crawler as a trebuchet push-out sees it: slid clear by a knockback. */
export function crawlerPushBody(crawler: Player): PushableBody {
  return {
    get x() {
      return crawler.x;
    },
    get y() {
      return crawler.y;
    },
    slide: (dx, dy, distance, frames) => crawler.applyKnockback(dx, dy, distance, frames),
    place: (x, y) => {
      crawler.x = x;
      crawler.y = y;
    },
  };
}

/**
 * A mob as a trebuchet push-out sees it: slid clear by a knockback, or set
 * down outright — through `shoveTo`, so a mob that must stay on its own
 * ground (a penned cow) is never dropped off it — and its place in the mob
 * grid moves with it, or attacks would pass straight through it. The plan
 * only ever picks a spot the mob `accepts`.
 */
export function mobPushBody(mob: Mob, roster: MobRoster): PushableBody {
  return {
    get x() {
      return mob.x;
    },
    get y() {
      return mob.y;
    },
    accepts: (x, y) => mob.canBeShovedTo(x, y),
    slide: (dx, dy, distance, frames) => mob.applyKnockback(dx, dy, distance, frames),
    place: (x, y) => {
      const oldX = mob.x;
      const oldY = mob.y;
      mob.shoveTo(x, y);
      roster.grid.move(mob, oldX, oldY);
    },
  };
}
