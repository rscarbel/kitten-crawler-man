/**
 * CircusQuestSystem — the overworld half of "The Show Must Go On", the
 * Vengeance of the Daughter circus questline. Everything is dialog-gated on
 * Tsarina Signet, following the book:
 *
 *   talk to Signet → defend her Mold Lion "casting" (she meant your blood to
 *   fuel it) → she tells the story of Signet the Bastard and Grimaldi, takes
 *   Mongo as collateral, and sends you after Heather the Bear → her blood
 *   fuels the Ink Marauder ritual → tattoo-army assault clears the sideshow
 *   waves → the Big Top unlocks (BigTopBossSystem fights Grimaldi indoors)
 *   → return to Signet for the resolution.
 *
 * Cross-scene state lives in CircusQuestProgress; every stage is
 * entry-idempotent so building round-trips reconstruct cleanly.
 */

import { TILE_SIZE } from '../core/constants';
import { pointInRect } from '../utils';
import type { GameMap } from '../map/GameMap';
import { findNearbyWalkableTile } from '../map/findWalkableTile';
import type { EventBus } from '../core/EventBus';
import type { AudioManager } from '../audio/AudioManager';
import type { GameSystem, SystemContext } from './GameSystem';
import type { Mob } from '../creatures/Mob';
import type { Player } from '../Player';
import { QuestManager } from '../core/QuestManager';
import type { CircusQuestProgress } from '../core/CircusQuestProgress';
import type { OverworldMusicSystem } from './OverworldMusicSystem';
import { Signet } from '../creatures/Signet';
import { CircusLemur } from '../creatures/CircusLemur';
import { StiltClown } from '../creatures/StiltClown';
import { FatClown } from '../creatures/FatClown';
import { MoldLion } from '../creatures/MoldLion';
import { TerrorTheClown } from '../creatures/TerrorTheClown';
import { HeatherTheBear, HEATHER_LEVEL } from '../creatures/HeatherTheBear';
import { InkMarauder } from '../creatures/InkMarauder';
import type { MongoSystem } from './MongoSystem';
import type { QuestMarkerType } from './MiniMapSystem';
import { drawText } from '../ui/TextBox';
import { drawButton, playButtonSound, BUTTON_PRESETS } from '../ui/Button';
import { drawModal, drawOverlay, BOX_PRESETS } from '../ui/Box';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import {
  type DialogPage,
  INTRO_DIALOG,
  buildRitualFailedDialog,
  HEATHER_RETURN_DIALOG,
  BIGTOP_READY_DIALOG,
  buildResolutionDialog,
} from './circusQuestDialogs';

const QUEST_ID = 'the_show_must_go_on';

const FRAMES_PER_SECOND = 60;

/** How far a scripted spawn may be nudged to find a walkable tile. */
const SPAWN_SEARCH_RADIUS_TILES = 6;
/** Signet's lookout position — just inside the circus edge, opposite the town road. */
const SIGNET_ANCHOR_INSET_TILES = 3;
/** How close the player must be to Signet to talk. */
const INTERACT_RANGE_TILES = 2.2;
/** Heather's den sits this far past the circus edge, on the town side. */
const HEATHER_DEN_BEYOND_RADIUS_TILES = 8;
/** Signet waits this far south of the Big Top door for the finale stages. */
const SIGNET_DOOR_OFFSET_TILES = 2;
/** Blood-fueled summon cadence during the assault (~5 s at 60 fps). */
const BLOOD_FUELED_SUMMON_FRAMES = 300;
/** Lifespan of the single marauder that fizzles when the first ritual fails. */
const FIZZLE_MARAUDER_LIFESPAN_FRAMES = 80;
const BATTLE_MUSIC_FADE_IN_MS = 1000;
/** Blocks Mongo's summon button while Signet holds him as collateral. */
const MONGO_KIDNAP_LOCK_FRAMES = 999999;

/** Banner display time. */
const BANNER_SECONDS = 4;
const BANNER_FRAMES = BANNER_SECONDS * FRAMES_PER_SECOND;
const BANNER_FADE_FRAMES = 60;
const BANNER_TITLE_Y = 70;
const BANNER_TITLE_SIZE = 30;
const BANNER_GLOW_BLUR = 12;

const QUEST_COMPLETE_DISPLAY_SECONDS = 7;
const QUEST_COMPLETE_DISPLAY_FRAMES = QUEST_COMPLETE_DISPLAY_SECONDS * FRAMES_PER_SECOND;
const OVERLAY_FADE_FRAMES = 90;
const OVERLAY_DIM_ALPHA = 0.6;
const OVERLAY_TITLE_Y_OFFSET = 30;
const OVERLAY_TITLE_SIZE = 26;
const OVERLAY_GLOW_BLUR = 15;
const OVERLAY_DISMISS_Y_OFFSET = 30;
const OVERLAY_DISMISS_SIZE = 12;

// Dialog layout
const DIALOG_WIDTH = 460;
const DIALOG_CANVAS_PADDING = 40;
const DIALOG_BASE_HEIGHT = 72;
const DIALOG_BUTTON_AREA_HEIGHT = 52;
const DIALOG_LINE_SPACING = 17;
const DIALOG_PAD_X = 18;
const DIALOG_TITLE_Y_OFFSET = 14;
const DIALOG_TITLE_SIZE = 14;
const DIALOG_LINE_START_Y = 40;
const DIALOG_LINE_SIZE = 12;
const DIALOG_BTN_W = 150;
const DIALOG_BTN_H = 30;
const DIALOG_BTN_Y_FROM_BOTTOM = 42;
const DIALOG_BTN_LABEL_SIZE = 12;
const DIALOG_PAGE_COUNTER_SIZE = 10;

type CircusQuestPhase =
  | 'awaiting_intro'
  | 'ritual_defense'
  | 'awaiting_ritual_failed'
  | 'heather_hunt'
  | 'awaiting_heather_return'
  | 'assault'
  | 'bigtop_ready'
  | 'awaiting_resolution'
  | 'complete';

interface WaveSpawn {
  dx: number;
  dy: number;
  make: (x: number, y: number) => Mob;
}

/**
 * Mold Lion waves for the ritual-defense beat, offset from Signet's lookout
 * (they come out of the circus, toward her stage).
 */
const RITUAL_WAVES: ReadonlyArray<ReadonlyArray<WaveSpawn>> = [
  [
    { dx: -4, dy: -2, make: (x, y) => new MoldLion(x, y, TILE_SIZE) },
    { dx: -4, dy: 2, make: (x, y) => new MoldLion(x, y, TILE_SIZE) },
  ],
  [
    { dx: -5, dy: -1, make: (x, y) => new MoldLion(x, y, TILE_SIZE) },
    { dx: -5, dy: 1, make: (x, y) => new MoldLion(x, y, TILE_SIZE) },
    { dx: -6, dy: 0, make: (x, y) => new MoldLion(x, y, TILE_SIZE) },
  ],
];

/**
 * The assault on the circus grounds, in the book's order: knife-throwing
 * lemurs, stilt clowns, fat clowns with the remaining mold lions, then
 * Terror the Clown. Offsets are relative to the circus centre and sit on
 * open ground between the big top (dx -6..+5, dy -4..0) and the small
 * tents (dy +4..+8) — never inside a footprint.
 */
const ASSAULT_WAVES: ReadonlyArray<ReadonlyArray<WaveSpawn>> = [
  [
    { dx: -9, dy: 1, make: (x, y) => new CircusLemur(x, y, TILE_SIZE) },
    { dx: -11, dy: 0, make: (x, y) => new CircusLemur(x, y, TILE_SIZE) },
    { dx: -8, dy: 3, make: (x, y) => new CircusLemur(x, y, TILE_SIZE) },
    { dx: -10, dy: -1, make: (x, y) => new CircusLemur(x, y, TILE_SIZE) },
    { dx: -7, dy: 2, make: (x, y) => new CircusLemur(x, y, TILE_SIZE) },
  ],
  [
    { dx: 9, dy: 1, make: (x, y) => new StiltClown(x, y, TILE_SIZE) },
    { dx: 11, dy: 0, make: (x, y) => new StiltClown(x, y, TILE_SIZE) },
  ],
  [
    { dx: -2, dy: 2, make: (x, y) => new FatClown(x, y, TILE_SIZE) },
    { dx: 2, dy: 2, make: (x, y) => new FatClown(x, y, TILE_SIZE) },
    { dx: 8, dy: 3, make: (x, y) => new MoldLion(x, y, TILE_SIZE) },
    { dx: 10, dy: 2, make: (x, y) => new MoldLion(x, y, TILE_SIZE) },
  ],
  [{ dx: 0, dy: -8, make: (x, y) => new TerrorTheClown(x, y, TILE_SIZE) }],
];

interface ActiveDialog {
  pages: ReadonlyArray<DialogPage>;
  pageIndex: number;
  onComplete: (active: Player) => void;
}

export class CircusQuestSystem implements GameSystem {
  readonly questManager: QuestManager;

  private phase: CircusQuestPhase = 'awaiting_intro';
  private readonly circusCentre: { x: number; y: number } | null;
  private readonly circusRadiusTiles: number;
  private readonly bigTopDoorTile: { x: number; y: number } | null;
  private readonly heatherDenTile: { x: number; y: number } | null;

  private signet: Signet | null = null;
  private heather: HeatherTheBear | null = null;

  private waveIndex = 0;
  private waveMobs: Mob[] = [];

  private activeDialog: ActiveDialog | null = null;
  private dialogButton: { x: number; y: number; w: number; h: number } | null = null;

  private bannerTimer = 0;
  private bannerText = '';
  private completeOverlayTimer = 0;
  /** Latest frame context — lets dialog callbacks reach the live mob list (e.g. Mongo dismissal). */
  private lastCtx: SystemContext | null = null;

  constructor(
    private readonly gameMap: GameMap,
    private readonly bus: EventBus,
    private readonly addMob: (mob: Mob) => void,
    private readonly mongoSystem: MongoSystem | null = null,
    private readonly progress: CircusQuestProgress,
    private readonly overworldMusic: OverworldMusicSystem | null = null,
    private readonly audio: AudioManager | null = null,
  ) {
    this.questManager = new QuestManager();
    this.questManager.register({
      id: QUEST_ID,
      name: 'The Show Must Go On',
      type: 'story',
      rewards: {
        xp: 1000,
        lootBoxItems: [
          { id: 'health_potion', minQty: 3, maxQty: 6 },
          { id: 'stat_boost_potion', minQty: 1, maxQty: 2 },
        ],
        coins: 100,
      },
    });

    if (gameMap.circusCentre && gameMap.circusRadiusTiles !== undefined) {
      this.circusCentre = gameMap.circusCentre;
      this.circusRadiusTiles = gameMap.circusRadiusTiles;
    } else {
      this.circusCentre = null;
      this.circusRadiusTiles = 0;
    }
    this.bigTopDoorTile =
      gameMap.buildingEntries.find((b) => b.name === 'Big Top')?.doorTile ?? null;
    this.heatherDenTile = this.computeHeatherDenTile();

    if (this.circusCentre) this.enterStageFromProgress();
  }

  // ── Stage-idempotent construction ─────────────────────────────────────────

  /** Rebuild the phase state the cross-scene progress object describes. */
  private enterStageFromProgress(): void {
    if (this.progress.mongoKidnapped && this.mongoSystem) {
      this.mongoSystem.cooldownFrames = MONGO_KIDNAP_LOCK_FRAMES;
    }

    switch (this.progress.stage) {
      case 'not_started':
        this.phase = 'awaiting_intro';
        this.spawnSignetAtLookout();
        break;
      case 'ritual_defense':
        this.phase = 'ritual_defense';
        this.spawnSignetAtLookout();
        this.questManager.startQuest(QUEST_ID);
        this.startBattleMusic();
        this.spawnWave(RITUAL_WAVES, 0, this.signetTile());
        break;
      case 'heather_hunt':
        this.spawnSignetAtLookout();
        this.questManager.startQuest(QUEST_ID);
        if (this.progress.heatherSlain) {
          this.phase = 'awaiting_heather_return';
        } else {
          this.phase = 'heather_hunt';
          this.spawnHeather();
        }
        break;
      case 'assault':
        this.phase = 'assault';
        this.spawnSignetAtLookout();
        this.questManager.startQuest(QUEST_ID);
        this.beginAssaultCombat();
        break;
      case 'bigtop_ready':
        this.phase = 'bigtop_ready';
        this.questManager.startQuest(QUEST_ID);
        this.spawnSignetAtBigTopDoor();
        break;
      case 'grimaldi_slain':
        this.phase = 'awaiting_resolution';
        this.questManager.startQuest(QUEST_ID);
        this.spawnSignetAtBigTopDoor();
        break;
      case 'complete':
        this.phase = 'complete';
        break;
    }
  }

  private computeHeatherDenTile(): { x: number; y: number } | null {
    if (!this.circusCentre) return null;
    const mapCentre = this.gameMap.structure.length / 2;
    const dx = mapCentre - this.circusCentre.x;
    const dy = mapCentre - this.circusCentre.y;
    const dist = Math.hypot(dx, dy) || 1;
    const denDist = this.circusRadiusTiles + HEATHER_DEN_BEYOND_RADIUS_TILES;
    return {
      x: Math.round(this.circusCentre.x + (dx / dist) * denDist),
      y: Math.round(this.circusCentre.y + (dy / dist) * denDist),
    };
  }

  private findSpawnTile(tileX: number, tileY: number): { x: number; y: number } | null {
    return findNearbyWalkableTile(this.gameMap, tileX, tileY, SPAWN_SEARCH_RADIUS_TILES);
  }

  private signetTile(): { x: number; y: number } {
    if (this.signet) {
      return {
        x: Math.round(this.signet.x / TILE_SIZE),
        y: Math.round(this.signet.y / TILE_SIZE),
      };
    }
    return this.circusCentre ?? { x: 0, y: 0 };
  }

  private spawnSignetAt(tileX: number, tileY: number): void {
    const tile = this.findSpawnTile(tileX, tileY);
    if (!tile) return;
    const signet = new Signet(tile.x, tile.y, TILE_SIZE, this.addMob);
    signet.setMap(this.gameMap);
    this.signet = signet;
    this.addMob(signet);
  }

  private spawnSignetAtLookout(): void {
    if (!this.circusCentre) return;
    this.spawnSignetAt(
      this.circusCentre.x + this.circusRadiusTiles - SIGNET_ANCHOR_INSET_TILES,
      this.circusCentre.y,
    );
  }

  private spawnSignetAtBigTopDoor(): void {
    const door = this.bigTopDoorTile;
    if (!door) {
      this.spawnSignetAtLookout();
      return;
    }
    this.spawnSignetAt(door.x + SIGNET_DOOR_OFFSET_TILES, door.y + SIGNET_DOOR_OFFSET_TILES);
  }

  private spawnHeather(): void {
    if (!this.heatherDenTile) return;
    const tile = this.findSpawnTile(this.heatherDenTile.x, this.heatherDenTile.y);
    if (!tile) return;
    const heather = new HeatherTheBear(tile.x, tile.y, TILE_SIZE);
    heather.setMap(this.gameMap);
    heather.applyMobLevel(HEATHER_LEVEL);
    this.heather = heather;
    this.addMob(heather);
  }

  private spawnWave(
    waves: ReadonlyArray<ReadonlyArray<WaveSpawn>>,
    index: number,
    origin: { x: number; y: number },
  ): void {
    this.waveIndex = index;
    this.waveMobs = [];
    const wave = waves[index];
    for (const { dx, dy, make } of wave) {
      const tile = this.findSpawnTile(origin.x + dx, origin.y + dy);
      if (!tile) continue;
      const mob = make(tile.x, tile.y);
      mob.setMap(this.gameMap);
      this.addMob(mob);
      this.waveMobs.push(mob);
    }
  }

  // ── Music ─────────────────────────────────────────────────────────────────

  private startBattleMusic(): void {
    if (this.overworldMusic) this.overworldMusic.battleMusicActive = true;
    // Already mid-track after a building round-trip — don't restart it.
    if (this.audio?.currentMusicId === 'circus_battle') return;
    this.audio?.playMusic('circus_battle', { fadeInMs: BATTLE_MUSIC_FADE_IN_MS });
  }

  private stopBattleMusic(): void {
    if (this.overworldMusic) {
      this.overworldMusic.battleMusicActive = false;
      this.overworldMusic.reset();
    }
  }

  // ── Public surface consumed by DungeonScene ───────────────────────────────

  get isActive(): boolean {
    return this.phase !== 'awaiting_intro' && this.phase !== 'complete';
  }

  get isDialogOpen(): boolean {
    return this.activeDialog !== null;
  }

  /** Returns quest markers for the minimap. */
  get questMarkers(): Array<{ x: number; y: number; type: QuestMarkerType }> {
    const markers: Array<{ x: number; y: number; type: QuestMarkerType }> = [];

    if (this.signet?.isAlive) {
      const tile = this.signetTile();
      // The book's elite mark follows Signet everywhere.
      markers.push({ x: tile.x, y: tile.y, type: 'elite' });
      if (this.hasPendingDialog()) {
        markers.push({ x: tile.x, y: tile.y, type: 'exclamation' });
      }
    }

    if (this.phase === 'heather_hunt' && this.heather?.isAlive && this.heatherDenTile) {
      markers.push({
        x: Math.round(this.heather.x / TILE_SIZE),
        y: Math.round(this.heather.y / TILE_SIZE),
        type: 'red_x',
      });
    }

    if (this.phase === 'bigtop_ready' && this.bigTopDoorTile) {
      markers.push({ x: this.bigTopDoorTile.x, y: this.bigTopDoorTile.y, type: 'exclamation' });
    }

    return markers;
  }

  private hasPendingDialog(): boolean {
    return (
      this.phase === 'awaiting_intro' ||
      this.phase === 'awaiting_ritual_failed' ||
      this.phase === 'awaiting_heather_return' ||
      this.phase === 'bigtop_ready' ||
      this.phase === 'awaiting_resolution'
    );
  }

  private dialogForCurrentPhase(): ActiveDialog | null {
    switch (this.phase) {
      case 'awaiting_intro':
        return { pages: INTRO_DIALOG, pageIndex: 0, onComplete: () => this.startRitualDefense() };
      case 'awaiting_ritual_failed':
        return {
          pages: buildRitualFailedDialog((this.mongoSystem?.mongo ?? null) !== null),
          pageIndex: 0,
          onComplete: () => this.startHeatherHunt(),
        };
      case 'awaiting_heather_return':
        return {
          pages: HEATHER_RETURN_DIALOG,
          pageIndex: 0,
          onComplete: () => this.startAssault(),
        };
      case 'bigtop_ready':
        return {
          pages: BIGTOP_READY_DIALOG,
          pageIndex: 0,
          onComplete: () => undefined,
        };
      case 'awaiting_resolution':
        return {
          pages: buildResolutionDialog(this.progress.mongoKidnapped),
          pageIndex: 0,
          onComplete: (active) => this.finishQuest(active),
        };
      case 'ritual_defense':
      case 'heather_hunt':
      case 'assault':
      case 'complete':
        return null;
    }
  }

  /** Space-key interaction: opens Signet's dialog for the current stage when in range. */
  tryInteract(active: Player): boolean {
    if (this.activeDialog !== null) return false;
    if (!this.signet?.isAlive || !this.hasPendingDialog()) return false;
    const dist = Math.hypot(this.signet.x - active.x, this.signet.y - active.y);
    if (dist > TILE_SIZE * INTERACT_RANGE_TILES) return false;
    this.activeDialog = this.dialogForCurrentPhase();
    return this.activeDialog !== null;
  }

  /** Esc closes an open dialog without advancing the quest. Returns true if handled. */
  dismissDialog(): boolean {
    if (this.activeDialog === null) return false;
    this.activeDialog = null;
    return true;
  }

  handleClick(mx: number, my: number, active: Player): boolean {
    if (this.completeOverlayTimer > 0) {
      this.completeOverlayTimer = 0;
      return true;
    }
    const dialog = this.activeDialog;
    if (dialog === null) return false;

    if (this.dialogButton && pointInRect(mx, my, this.dialogButton)) {
      playButtonSound(this.audio);
      if (dialog.pageIndex < dialog.pages.length - 1) {
        dialog.pageIndex++;
      } else {
        this.activeDialog = null;
        this.dialogButton = null;
        dialog.onComplete(active);
      }
    }
    return true; // dialogs are modal — consume every click while open
  }

  // ── Phase transitions ─────────────────────────────────────────────────────

  private startRitualDefense(): void {
    this.phase = 'ritual_defense';
    this.progress.stage = 'ritual_defense';
    this.questManager.startQuest(QUEST_ID);
    this.bus.emit('questStarted', { questId: QUEST_ID });
    this.startBattleMusic();
    this.spawnWave(RITUAL_WAVES, 0, this.signetTile());
  }

  private startHeatherHunt(): void {
    // The book's collateral beat — Signet takes Mongo until the job is done.
    if (this.mongoSystem?.mongo && this.lastCtx) {
      this.mongoSystem.dismiss(this.lastCtx.mobs, this.lastCtx.mobGrid);
      this.progress.mongoKidnapped = true;
    }
    if (this.progress.mongoKidnapped && this.mongoSystem) {
      this.mongoSystem.cooldownFrames = MONGO_KIDNAP_LOCK_FRAMES;
    }
    this.phase = 'heather_hunt';
    this.progress.stage = 'heather_hunt';
    this.spawnHeather();
  }

  private startAssault(): void {
    this.phase = 'assault';
    this.progress.stage = 'assault';
    this.beginAssaultCombat();
  }

  /** Shared by startAssault and mid-assault scene re-entry. */
  private beginAssaultCombat(): void {
    if (this.signet) {
      this.signet.allyModeActive = true;
      this.signet.summonCooldownFrames = BLOOD_FUELED_SUMMON_FRAMES;
    }
    this.startBattleMusic();
    if (this.circusCentre) this.spawnWave(ASSAULT_WAVES, 0, this.circusCentre);
  }

  private finishQuest(active: Player): void {
    this.phase = 'complete';
    this.progress.stage = 'complete';
    this.questManager.completeQuest(QUEST_ID);

    const def = this.questManager.getDef(QUEST_ID);
    if (def) active.gainXp(def.rewards.xp);

    if (this.progress.mongoKidnapped && this.mongoSystem) {
      this.mongoSystem.cooldownFrames = 0;
      this.progress.mongoKidnapped = false;
    }

    this.bus.emit('questCompleted', { questId: QUEST_ID });
    this.completeOverlayTimer = QUEST_COMPLETE_DISPLAY_FRAMES;
  }

  // ── Frame update ──────────────────────────────────────────────────────────

  update(ctx: SystemContext): void {
    this.lastCtx = ctx;
    if (this.completeOverlayTimer > 0) this.completeOverlayTimer--;
    if (this.bannerTimer > 0) this.bannerTimer--;
    this.signet?.tickTimers();

    if (this.signet) this.signet.allMobs = ctx.mobs;
    for (const mob of ctx.mobs) {
      if (mob instanceof InkMarauder) mob.allMobs = ctx.mobs;
    }

    switch (this.phase) {
      case 'ritual_defense':
        this.updateRitualDefense();
        break;
      case 'heather_hunt':
        this.updateHeatherHunt();
        break;
      case 'assault':
        this.clampToCircus(ctx.human);
        this.clampToCircus(ctx.cat);
        this.updateAssault();
        break;
      case 'awaiting_intro':
      case 'awaiting_ritual_failed':
      case 'awaiting_heather_return':
      case 'bigtop_ready':
      case 'awaiting_resolution':
      case 'complete':
        break;
    }
  }

  private updateRitualDefense(): void {
    if (this.waveMobs.some((m) => m.isAlive)) return;

    if (this.waveIndex + 1 < RITUAL_WAVES.length) {
      this.spawnWave(RITUAL_WAVES, this.waveIndex + 1, this.signetTile());
      return;
    }

    // The casting sputters out — a single marauder half-forms and bleeds away.
    const signetTile = this.signetTile();
    const fizzleTile = this.findSpawnTile(signetTile.x - 1, signetTile.y);
    if (fizzleTile) {
      const fizzle = new InkMarauder(
        fizzleTile.x,
        fizzleTile.y,
        TILE_SIZE,
        FIZZLE_MARAUDER_LIFESPAN_FRAMES,
      );
      fizzle.setMap(this.gameMap);
      this.addMob(fizzle);
    }
    this.stopBattleMusic();
    this.bus.emit('objectiveComplete', { objectiveId: 'circus_ritual_defended' });
    this.phase = 'awaiting_ritual_failed';
  }

  private updateHeatherHunt(): void {
    if (this.heather && !this.heather.isAlive) {
      this.heather = null;
      this.progress.heatherSlain = true;
      this.bus.emit('objectiveComplete', { objectiveId: 'heather_slain' });
      this.phase = 'awaiting_heather_return';
    }
  }

  private updateAssault(): void {
    if (this.waveMobs.some((m) => m.isAlive)) return;

    this.bus.emit('objectiveComplete', { objectiveId: 'circus_sideshow_cleared' });
    if (this.waveIndex + 1 < ASSAULT_WAVES.length) {
      if (this.circusCentre) this.spawnWave(ASSAULT_WAVES, this.waveIndex + 1, this.circusCentre);
      return;
    }

    this.stopBattleMusic();
    this.phase = 'bigtop_ready';
    this.progress.stage = 'bigtop_ready';
    this.bannerText = 'THE BIG TOP AWAITS';
    this.bannerTimer = BANNER_FRAMES;
    // Signet moves ahead to wait by the Big Top door.
    this.repositionSignetToBigTopDoor();
  }

  private repositionSignetToBigTopDoor(): void {
    const door = this.bigTopDoorTile;
    const signet = this.signet;
    if (!door || !signet) return;
    const tile = this.findSpawnTile(
      door.x + SIGNET_DOOR_OFFSET_TILES,
      door.y + SIGNET_DOOR_OFFSET_TILES,
    );
    if (!tile) return;
    signet.x = tile.x * TILE_SIZE;
    signet.y = tile.y * TILE_SIZE;
    signet.allyModeActive = false;
  }

  private clampToCircus(entity: Player): void {
    if (!this.circusCentre) return;
    const cx = this.circusCentre.x * TILE_SIZE;
    const cy = this.circusCentre.y * TILE_SIZE;
    const maxDist = this.circusRadiusTiles * TILE_SIZE;
    const dx = entity.x - cx;
    const dy = entity.y - cy;
    const dist = Math.hypot(dx, dy);
    if (dist <= maxDist || dist === 0) return;
    const scale = maxDist / dist;
    entity.x = cx + dx * scale;
    entity.y = cy + dy * scale;
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  /** World-space rendering: the "Talk" prompt over Signet. */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, active: Player): void {
    if (!this.signet?.isAlive || this.activeDialog !== null) return;
    if (!this.hasPendingDialog()) return;
    const dist = Math.hypot(this.signet.x - active.x, this.signet.y - active.y);
    if (dist > TILE_SIZE * INTERACT_RANGE_TILES) return;
    drawInteractionPrompt(ctx, this.signet.x - camX, this.signet.y - camY, TILE_SIZE, 'Talk');
  }

  renderUI(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    if (this.activeDialog !== null) {
      this.renderDialog(ctx, canvas, this.activeDialog);
    }

    if (this.bannerTimer > 0) {
      const alpha =
        this.bannerTimer < BANNER_FADE_FRAMES ? this.bannerTimer / BANNER_FADE_FRAMES : 1;
      drawText(ctx, this.bannerText, {
        x: canvas.width / 2,
        y: BANNER_TITLE_Y,
        size: BANNER_TITLE_SIZE,
        bold: true,
        color: '#a8f070',
        align: 'center',
        alpha,
        glow: '#3a6a2a',
        glowBlur: BANNER_GLOW_BLUR,
      });
    }

    if (this.completeOverlayTimer > 0) {
      this.renderCompleteOverlay(ctx, canvas);
    }
  }

  private renderDialog(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    dialog: ActiveDialog,
  ): void {
    const page = dialog.pages[dialog.pageIndex];
    const dw = Math.min(DIALOG_WIDTH, canvas.width - DIALOG_CANVAS_PADDING);
    const dh =
      DIALOG_BASE_HEIGHT + page.lines.length * DIALOG_LINE_SPACING + DIALOG_BUTTON_AREA_HEIGHT;

    const box = drawModal(ctx, {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      width: dw,
      height: dh,
      ...BOX_PRESETS.modal,
    });

    drawText(ctx, page.title, {
      x: box.x + DIALOG_PAD_X,
      y: box.y + DIALOG_TITLE_Y_OFFSET,
      size: DIALOG_TITLE_SIZE,
      bold: true,
      color: '#8ae0d0',
    });

    for (let i = 0; i < page.lines.length; i++) {
      drawText(ctx, page.lines[i], {
        x: box.x + DIALOG_PAD_X,
        y: box.y + DIALOG_LINE_START_Y + i * DIALOG_LINE_SPACING,
        size: DIALOG_LINE_SIZE,
        color: '#e2e8f0',
      });
    }

    if (dialog.pages.length > 1) {
      drawText(ctx, `${dialog.pageIndex + 1} / ${dialog.pages.length}`, {
        x: box.x + dw - DIALOG_PAD_X,
        y: box.y + DIALOG_TITLE_Y_OFFSET,
        size: DIALOG_PAGE_COUNTER_SIZE,
        color: 'rgba(200,200,200,0.6)',
        align: 'right',
      });
    }

    const btnX = box.x + dw / 2 - DIALOG_BTN_W / 2;
    const btnY = box.y + dh - DIALOG_BTN_Y_FROM_BOTTOM;
    drawButton(ctx, {
      x: btnX,
      y: btnY,
      width: DIALOG_BTN_W,
      height: DIALOG_BTN_H,
      label: page.button,
      ...BUTTON_PRESETS.primary,
      labelSize: DIALOG_BTN_LABEL_SIZE,
    });
    this.dialogButton = { x: btnX, y: btnY, w: DIALOG_BTN_W, h: DIALOG_BTN_H };
  }

  private renderCompleteOverlay(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const alpha =
      this.completeOverlayTimer < OVERLAY_FADE_FRAMES
        ? this.completeOverlayTimer / OVERLAY_FADE_FRAMES
        : 1;

    drawOverlay(ctx, {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      alpha: alpha * OVERLAY_DIM_ALPHA,
    });

    drawText(ctx, 'THE SHOW MUST GO ON — COMPLETE', {
      x: canvas.width / 2,
      y: canvas.height / 2 - OVERLAY_TITLE_Y_OFFSET,
      size: OVERLAY_TITLE_SIZE,
      bold: true,
      color: '#4ade80',
      align: 'center',
      alpha,
      glow: '#4ade80',
      glowBlur: OVERLAY_GLOW_BLUR,
    });
    drawText(ctx, 'Click to dismiss', {
      x: canvas.width / 2,
      y: canvas.height / 2 + OVERLAY_DISMISS_Y_OFFSET,
      size: OVERLAY_DISMISS_SIZE,
      color: 'rgba(200,200,200,0.7)',
      align: 'center',
      alpha,
    });
  }
}
