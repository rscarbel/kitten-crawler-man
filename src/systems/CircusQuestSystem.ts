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
import { applyActiveDifficultyRewards } from '../core/difficultyProfiles';
import type { GameMap } from '../map/GameMap';
import { findNearbyWalkableTile } from '../map/findWalkableTile';
import type { EventBus } from '../core/EventBus';
import type { AudioManager } from '../audio/AudioManager';
import type { GameSystem, SystemContext } from './GameSystem';
import type { Mob } from '../creatures/Mob';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { Player } from '../Player';
import { QuestManager, type QuestStatus } from '../core/QuestManager';
import type { TrackerEntry } from './questTracker';
import type { CircusQuestProgress } from '../core/CircusQuestProgress';
import type { OverworldMusicSystem } from './OverworldMusicSystem';
import { Signet } from '../creatures/Signet';
import { SIGNET_OVERLAY_CLEARANCE } from '../sprites/signetSprite';
import { CircusLemur } from '../creatures/CircusLemur';
import { StiltClown } from '../creatures/StiltClown';
import { FatClown } from '../creatures/FatClown';
import { MoldLion } from '../creatures/MoldLion';
import { TerrorTheClown } from '../creatures/TerrorTheClown';
import { HeatherTheBear, HEATHER_LEVEL } from '../creatures/HeatherTheBear';
import { InkMarauder } from '../creatures/InkMarauder';
import type { MongoSystem } from './MongoSystem';
import type { QuestMarkerType } from './MiniMapSystem';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import { QuestDialog } from '../ui/QuestDialog';
import {
  drawQuestBanner,
  drawQuestCompleteOverlay,
  QUEST_BANNER_FRAMES,
  QUEST_COMPLETE_OVERLAY_FRAMES,
} from '../ui/QuestBanners';
import {
  INTRO_DIALOG,
  buildRitualFailedDialog,
  HEATHER_RETURN_DIALOG,
  BIGTOP_READY_DIALOG,
  buildResolutionDialog,
} from './circusQuestDialogs';

export const CIRCUS_QUEST_ID = 'the_show_must_go_on';

/** How far a scripted spawn may be nudged to find a walkable tile. */
const SPAWN_SEARCH_RADIUS_TILES = 6;
/**
 * Wave spawns stay this far inside the circus boundary. The outermost ring of
 * the grounds abuts the wilderness, where forest can leave a walkable tile
 * fenced in by trees — an enemy there is unreachable and the wave never ends.
 */
const ARENA_SPAWN_EDGE_INSET_TILES = 1;
/** Signet's lookout position — just inside the circus edge, opposite the town road. */
const SIGNET_ANCHOR_INSET_TILES = 3;
/** How close the player must be to Signet to talk. */
const INTERACT_RANGE_TILES = 2.2;
/**
 * Heather spawns this many tiles east of her spawn origin — inside her own
 * aggro range (see HeatherTheBear's AGGRO_RANGE_TILES) so that when the origin
 * is the player she notices immediately and visibly walks up, rather than
 * appearing right on top of them.
 */
const HEATHER_SPAWN_OFFSET_TILES = 6;
/** Signet waits this far south of the Big Top door for the finale stages. */
const SIGNET_DOOR_OFFSET_TILES = 2;
/** Blood-fueled summon cadence during the assault (~5 s at 60 fps). */
const BLOOD_FUELED_SUMMON_FRAMES = 300;
/** Lifespan of the single marauder that fizzles when the first ritual fails. */
const FIZZLE_MARAUDER_LIFESPAN_FRAMES = 80;
const BATTLE_MUSIC_FADE_IN_MS = 1000;

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

/**
 * The phases that expect Signet waiting by the Big Top door rather than on her
 * lookout — the same split `enterStageFromProgress` makes when it decides
 * between `spawnSignetAtBigTopDoor` and `spawnSignetAtLookout`.
 */
const BIGTOP_DOOR_PHASES: ReadonlySet<CircusQuestPhase> = new Set([
  'bigtop_ready',
  'awaiting_resolution',
]);

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

export interface CircusQuestCheckpoint {
  questStatuses: Array<[string, QuestStatus]>;
  phase: CircusQuestPhase;
  waveIndex: number;
  waveMobs: Mob[];
  signet: Signet | null;
  heather: HeatherTheBear | null;
}

export class CircusQuestSystem implements GameSystem {
  readonly questManager: QuestManager;

  private phase: CircusQuestPhase = 'awaiting_intro';
  private readonly circusCentre: { x: number; y: number } | null;
  private readonly circusRadiusTiles: number;
  private readonly bigTopDoorTile: { x: number; y: number } | null;

  private signet: Signet | null = null;
  private heather: HeatherTheBear | null = null;

  private waveIndex = 0;
  private waveMobs: Mob[] = [];

  private readonly dialog: QuestDialog;

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
    initialActivePlayer: Player,
  ) {
    this.questManager = new QuestManager();
    this.questManager.register({
      id: CIRCUS_QUEST_ID,
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
    this.dialog = new QuestDialog(audio ?? null);

    if (gameMap.circusCentre && gameMap.circusRadiusTiles !== undefined) {
      this.circusCentre = gameMap.circusCentre;
      this.circusRadiusTiles = gameMap.circusRadiusTiles;
    } else {
      this.circusCentre = null;
      this.circusRadiusTiles = 0;
    }
    this.bigTopDoorTile =
      gameMap.buildingEntries.find((b) => b.name === 'Big Top')?.doorTile ?? null;

    if (this.circusCentre) this.enterStageFromProgress(initialActivePlayer);
  }

  // ── Stage-idempotent construction ─────────────────────────────────────────

  /** Rebuild the phase state the cross-scene progress object describes. */
  private enterStageFromProgress(active: Player): void {
    if (this.progress.mongoKidnapped && this.mongoSystem) {
      this.mongoSystem.summonLocked = true;
    }

    switch (this.progress.stage) {
      case 'not_started':
        this.phase = 'awaiting_intro';
        this.spawnSignetAtLookout();
        break;
      case 'ritual_defense':
        this.phase = 'ritual_defense';
        this.spawnSignetAtLookout();
        this.questManager.startQuest(CIRCUS_QUEST_ID);
        this.startBattleMusic();
        this.spawnWave(RITUAL_WAVES, 0, this.ritualWaveOrigin());
        break;
      case 'heather_hunt':
        this.spawnSignetAtLookout();
        this.questManager.startQuest(CIRCUS_QUEST_ID);
        if (this.progress.heatherSlain) {
          this.phase = 'awaiting_heather_return';
        } else {
          this.phase = 'heather_hunt';
          // A rebuild happens wherever the player currently stands — town after
          // a death, or a doorstep after a building visit — so Heather anchors
          // to the circus rather than ambushing the player on scene load.
          this.spawnHeather(this.circusCentre ?? this.originFromPlayer(active));
        }
        break;
      case 'assault':
        this.phase = 'assault';
        this.spawnSignetAtLookout();
        this.questManager.startQuest(CIRCUS_QUEST_ID);
        this.beginAssaultCombat();
        break;
      case 'bigtop_ready':
        this.phase = 'bigtop_ready';
        this.questManager.startQuest(CIRCUS_QUEST_ID);
        this.spawnSignetAtBigTopDoor();
        break;
      case 'grimaldi_slain':
        this.phase = 'awaiting_resolution';
        this.questManager.startQuest(CIRCUS_QUEST_ID);
        this.spawnSignetAtBigTopDoor();
        break;
      case 'complete':
        this.phase = 'complete';
        break;
    }
  }

  private findSpawnTile(tileX: number, tileY: number): { x: number; y: number } | null {
    return findNearbyWalkableTile(this.gameMap, tileX, tileY, SPAWN_SEARCH_RADIUS_TILES);
  }

  private get arenaSpawnRadiusTiles(): number {
    return Math.max(0, this.circusRadiusTiles - ARENA_SPAWN_EDGE_INSET_TILES);
  }

  private isInsideArena(tileX: number, tileY: number): boolean {
    const centre = this.circusCentre;
    if (!centre) return true;
    return Math.hypot(tileX - centre.x, tileY - centre.y) <= this.arenaSpawnRadiusTiles;
  }

  /** Pulls a tile back onto the circus grounds, along the line to the centre. */
  private clampTileToArena(tileX: number, tileY: number): { x: number; y: number } {
    const centre = this.circusCentre;
    if (!centre) return { x: tileX, y: tileY };
    const maxRadiusTiles = this.arenaSpawnRadiusTiles;
    const dx = tileX - centre.x;
    const dy = tileY - centre.y;
    const distTiles = Math.hypot(dx, dy);
    if (distTiles <= maxRadiusTiles) return { x: tileX, y: tileY };
    const pullBack = maxRadiusTiles / distTiles;
    return {
      x: Math.round(centre.x + dx * pullBack),
      y: Math.round(centre.y + dy * pullBack),
    };
  }

  /**
   * Spawn tile for a battle mob: always on the circus grounds, so a wave can
   * never materialise in the surrounding forest where the player cannot reach
   * it (and where the fight would leave the arena entirely).
   *
   * Falls back to the arena centre, and then to an unconstrained search,
   * because a wave mob that fails to spawn is worse than one standing in an
   * imperfect spot: an empty wave reads as "cleared" and skips the encounter
   * — which for the last assault wave would silently skip Terror the Clown.
   */
  private findArenaSpawnTile(tileX: number, tileY: number): { x: number; y: number } | null {
    const preferred = this.clampTileToArena(tileX, tileY);
    const onGrounds = findNearbyWalkableTile(
      this.gameMap,
      preferred.x,
      preferred.y,
      SPAWN_SEARCH_RADIUS_TILES,
      (x, y) => this.isInsideArena(x, y),
    );
    if (onGrounds) return onGrounds;

    const centre = this.circusCentre;
    if (centre) {
      const atCentre = findNearbyWalkableTile(
        this.gameMap,
        centre.x,
        centre.y,
        SPAWN_SEARCH_RADIUS_TILES,
        (x, y) => this.isInsideArena(x, y),
      );
      if (atCentre) return atCentre;
    }

    return this.findSpawnTile(preferred.x, preferred.y);
  }

  private originFromPlayer(active: Player): { x: number; y: number } {
    return {
      x: Math.round(active.x / TILE_SIZE),
      y: Math.round(active.y / TILE_SIZE),
    };
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

  private spawnHeather(origin: { x: number; y: number }): void {
    const tile = this.findSpawnTile(origin.x + HEATHER_SPAWN_OFFSET_TILES, origin.y);
    if (!tile) return;
    const heather = new HeatherTheBear(tile.x, tile.y, TILE_SIZE);
    heather.setMap(this.gameMap);
    heather.applyMobLevel(HEATHER_LEVEL);
    applyActiveDifficultyRewards(heather);
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
      const tile = this.findArenaSpawnTile(origin.x + dx, origin.y + dy);
      if (!tile) continue;
      const mob = make(tile.x, tile.y);
      mob.setMap(this.gameMap);
      mob.forceAggro = true;
      this.addMob(mob);
      this.waveMobs.push(mob);
    }
  }

  /** Mold lions come out of the circus toward Signet's casting. */
  private ritualWaveOrigin(): { x: number; y: number } {
    return this.signetTile();
  }

  /** The assault fills the whole grounds, so its offsets read from the centre. */
  private assaultWaveOrigin(): { x: number; y: number } {
    return this.circusCentre ?? this.signetTile();
  }

  /**
   * Holds the wave to the encounter every frame:
   *
   * - `forceAggro` is re-asserted because a safe-room checkpoint restore runs
   *   `resetToSpawn()` on the survivors, which clears it — a revived wave must
   *   still hunt the player rather than mill about the arena.
   * - The mobs are held on the grounds because forced aggro would otherwise
   *   march them after a fleeing player into the forest belt. Once past
   *   `MOB_MAX_PATH_DISTANCE_TILES` no route can be found at all, so a mob
   *   stranded out there never returns and the wave never clears.
   */
  private keepWaveMobsEngaged(mobGrid: SpatialGrid<Mob>): void {
    for (const mob of this.waveMobs) {
      if (!mob.isAlive) continue;
      mob.forceAggro = true;
      this.holdMobOnGrounds(mob, mobGrid);
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
    return this.dialog.isOpen;
  }

  /**
   * The completion banner, which a press dismisses early. It rides over live
   * play rather than pausing it, so it is not part of `isDialogOpen`.
   */
  get isOutcomeOverlayShowing(): boolean {
    return this.completeOverlayTimer > 0;
  }

  /** Space/tap on the banner: dismiss early rather than wait out the timer. */
  advanceOutcomeOverlay(): boolean {
    if (this.completeOverlayTimer <= 0) return false;
    this.completeOverlayTimer = 0;
    return true;
  }

  /**
   * Snapshots the questline so a death inside a safe room rewinds every beat the
   * player completed after checking in.
   *
   * Mob fields are stored as references rather than copies: at capture time the
   * field held that exact creature, and the scene's checkpoint restore revives
   * the ones that died afterwards, so pointing back at them is the whole point.
   *
   * `waveMobs` is copied here *and* again in `restoreCheckpoint`, because one
   * snapshot is restored once per death — handing the stored array straight to
   * the live field would let a later `spawnWave` mutate the snapshot itself.
   *
   * Banner and complete-overlay timers are left out: they are per-frame FX that
   * expire on their own within a second of the restore.
   */
  captureCheckpoint(): CircusQuestCheckpoint {
    return {
      questStatuses: this.questManager.snapshotStatuses(),
      phase: this.phase,
      waveIndex: this.waveIndex,
      waveMobs: [...this.waveMobs],
      signet: this.signet,
      heather: this.heather,
    };
  }

  /**
   * `mobGrid` is taken as an argument rather than read off `lastCtx`: the
   * scene's rewind replaces its grid wholesale just before this runs, so the
   * cached frame context points at the discarded one.
   */
  restoreCheckpoint(snapshot: CircusQuestCheckpoint, mobGrid: SpatialGrid<Mob>): void {
    this.questManager.restoreStatuses(snapshot.questStatuses);
    this.phase = snapshot.phase;
    this.waveIndex = snapshot.waveIndex;
    this.waveMobs = [...snapshot.waveMobs];
    this.signet = snapshot.signet;
    this.heather = snapshot.heather;

    // Signet is `resetsFullyOnCheckpoint`, so the rewind has already sent her
    // back to the lookout tile she spawned on and re-anchored her loiter there.
    // The late phases expect her across the grounds at the Big Top door, so the
    // move has to be re-applied *after* that reset — the reposition re-anchors
    // her again, and doing it first would just be undone.
    if (BIGTOP_DOOR_PHASES.has(this.phase)) {
      this.repositionSignetToBigTopDoor(mobGrid);
    }
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

    if (this.phase === 'heather_hunt' && this.heather?.isAlive && this.circusCentre) {
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

  /**
   * The Journal's line for the circus, rebuilt from the phase every frame.
   *
   * Every phase points at somewhere: Signet while she is waiting to talk,
   * Heather while she is loose, the Big Top door when it is time to go in. The
   * one entry with no target is the finished one, which nobody needs directions
   * to.
   */
  trackerEntries(): ReadonlyArray<TrackerEntry> {
    const name = this.questManager.getDef(CIRCUS_QUEST_ID)?.name ?? 'The Show Must Go On';
    const atSignet = this.signet?.isAlive === true ? this.signetTile() : undefined;
    const base = { id: CIRCUS_QUEST_ID, name };

    switch (this.phase) {
      case 'awaiting_intro':
        return [
          {
            ...base,
            status: 'available',
            objective: 'Find the Tsarina at the circus',
            hint: 'The fairground is well outside the walls — take a gate and follow the road.',
            target: atSignet,
          },
        ];
      case 'ritual_defense':
        return [
          {
            ...base,
            status: 'active',
            objective: `Guard the casting — wave ${this.waveIndex + 1} of ${RITUAL_WAVES.length}`,
            hint: 'She cannot fight and cast. Keep the mold off her.',
            target: atSignet,
          },
        ];
      case 'awaiting_ritual_failed':
        return [
          {
            ...base,
            status: 'active',
            objective: 'Hear the Tsarina out',
            target: atSignet,
          },
        ];
      case 'heather_hunt':
        return [
          {
            ...base,
            status: 'active',
            objective: 'Bring Heather the bear back to the circus',
            hint: 'She bolted into the wilds. Follow the red mark.',
            target:
              this.heather?.isAlive === true
                ? {
                    x: Math.round(this.heather.x / TILE_SIZE),
                    y: Math.round(this.heather.y / TILE_SIZE),
                  }
                : atSignet,
          },
        ];
      case 'awaiting_heather_return':
        return [
          { ...base, status: 'active', objective: 'Report back to the Tsarina', target: atSignet },
        ];
      case 'assault':
        return [
          {
            ...base,
            status: 'active',
            objective: `Break the assault — wave ${this.waveIndex + 1} of ${ASSAULT_WAVES.length}`,
            target: this.circusCentre ?? atSignet,
          },
        ];
      case 'bigtop_ready':
        return [
          {
            ...base,
            status: 'active',
            objective: 'Take the ring under the Big Top',
            hint: 'The Tsarina waits at the tent door.',
            target: this.bigTopDoorTile ?? atSignet,
          },
        ];
      case 'awaiting_resolution':
        return [
          { ...base, status: 'active', objective: 'Settle up with the Tsarina', target: atSignet },
        ];
      case 'complete':
        return [{ ...base, status: 'completed', objective: 'The show went on' }];
    }
  }

  /**
   * Holds Signet's beacon state to the phase, every frame.
   *
   * Deliberately **not** part of `update()`, for the reason `syncShady` is not:
   * the scene treats an open quest dialog as halted gameplay and returns before
   * the system update pass, so a write in there could only ever observe the
   * dialog closed — and her beacon would stand over her for the whole
   * conversation. The scene calls this above that early return.
   */
  syncMarkers(): void {
    if (this.signet === null) return;
    // The same state her minimap `exclamation` marker is derived from, so the
    // beacon she draws over herself and the pip on the map agree.
    this.signet.markerType =
      this.hasPendingDialog() && !this.dialog.isOpen ? 'exclamation' : 'none';
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

  private openDialogForCurrentPhase(active: Player): boolean {
    switch (this.phase) {
      case 'awaiting_intro':
        this.dialog.open(INTRO_DIALOG, () => this.startRitualDefense());
        return true;
      case 'awaiting_ritual_failed':
        this.dialog.open(buildRitualFailedDialog((this.mongoSystem?.mongo ?? null) !== null), () =>
          this.startHeatherHunt(active),
        );
        return true;
      case 'awaiting_heather_return':
        this.dialog.open(HEATHER_RETURN_DIALOG, () => this.startAssault());
        return true;
      case 'bigtop_ready':
        this.dialog.open(BIGTOP_READY_DIALOG, () => undefined);
        return true;
      case 'awaiting_resolution':
        this.dialog.open(buildResolutionDialog(this.progress.mongoKidnapped), () =>
          this.finishQuest(active),
        );
        return true;
      case 'ritual_defense':
      case 'heather_hunt':
      case 'assault':
      case 'complete':
        return false;
    }
  }

  /** Space-key interaction: opens Signet's dialog for the current stage when in range. */
  tryInteract(active: Player): boolean {
    if (this.dialog.isOpen) return false;
    if (!this.signet?.isAlive || !this.hasPendingDialog()) return false;
    const dist = Math.hypot(this.signet.x - active.x, this.signet.y - active.y);
    if (dist > TILE_SIZE * INTERACT_RANGE_TILES) return false;
    return this.openDialogForCurrentPhase(active);
  }

  /** Esc closes an open dialog without advancing the quest. Returns true if handled. */
  dismissDialog(): boolean {
    return this.dialog.dismiss();
  }

  handleClick(mx: number, my: number): boolean {
    if (this.advanceOutcomeOverlay()) return true;
    return this.dialog.handleClick(mx, my);
  }

  // ── Phase transitions ─────────────────────────────────────────────────────

  private startRitualDefense(): void {
    this.phase = 'ritual_defense';
    this.progress.stage = 'ritual_defense';
    this.questManager.startQuest(CIRCUS_QUEST_ID);
    this.bus.emit('questStarted', { questId: CIRCUS_QUEST_ID });
    this.startBattleMusic();
    this.spawnWave(RITUAL_WAVES, 0, this.ritualWaveOrigin());
  }

  private startHeatherHunt(active: Player): void {
    // The book's collateral beat — Signet takes Mongo until the job is done.
    if (this.mongoSystem?.mongo && this.lastCtx) {
      this.mongoSystem.dismiss(this.lastCtx.roster.mobs, this.lastCtx.roster.grid);
      this.progress.mongoKidnapped = true;
    }
    if (this.progress.mongoKidnapped && this.mongoSystem) {
      this.mongoSystem.summonLocked = true;
    }
    this.phase = 'heather_hunt';
    this.progress.stage = 'heather_hunt';
    this.spawnHeather(this.originFromPlayer(active));
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
    this.spawnWave(ASSAULT_WAVES, 0, this.assaultWaveOrigin());
  }

  private finishQuest(active: Player): void {
    this.phase = 'complete';
    this.progress.stage = 'complete';
    this.questManager.completeQuest(CIRCUS_QUEST_ID);

    const def = this.questManager.getDef(CIRCUS_QUEST_ID);
    if (def) active.gainXp(def.rewards.xp);

    if (this.progress.mongoKidnapped && this.mongoSystem) {
      this.mongoSystem.summonLocked = false;
      this.progress.mongoKidnapped = false;
    }

    this.bus.emit('questCompleted', { questId: CIRCUS_QUEST_ID });
    this.completeOverlayTimer = QUEST_COMPLETE_OVERLAY_FRAMES;
  }

  // ── Frame update ──────────────────────────────────────────────────────────

  update(ctx: SystemContext): void {
    this.lastCtx = ctx;
    if (this.completeOverlayTimer > 0) this.completeOverlayTimer--;
    if (this.bannerTimer > 0) this.bannerTimer--;

    // Signet is in `ctx.roster.mobs`, so MobUpdateLoop already ticks her timers every
    // frame she is near enough to matter — ticking her here as well ran her
    // walk cycle and damage flash at double rate.
    if (this.signet) {
      this.signet.allMobs = ctx.roster.mobs;
      this.signet.isConversing = this.dialog.isOpen;
    }

    switch (this.phase) {
      case 'ritual_defense':
        this.updateRitualDefense(ctx);
        break;
      case 'heather_hunt':
        this.updateHeatherHunt();
        break;
      case 'assault':
        this.clampToCircus(ctx.human);
        this.clampToCircus(ctx.cat);
        this.updateAssault(ctx);
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

  private updateRitualDefense(ctx: SystemContext): void {
    this.keepWaveMobsEngaged(ctx.roster.grid);
    if (this.waveMobs.some((m) => m.isAlive)) return;

    if (this.waveIndex + 1 < RITUAL_WAVES.length) {
      this.spawnWave(RITUAL_WAVES, this.waveIndex + 1, this.ritualWaveOrigin());
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
      fizzle.allMobs = ctx.roster.mobs;
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

  private updateAssault(ctx: SystemContext): void {
    this.keepWaveMobsEngaged(ctx.roster.grid);
    if (this.waveMobs.some((m) => m.isAlive)) return;

    this.bus.emit('objectiveComplete', { objectiveId: 'circus_sideshow_cleared' });
    if (this.waveIndex + 1 < ASSAULT_WAVES.length) {
      this.spawnWave(ASSAULT_WAVES, this.waveIndex + 1, this.assaultWaveOrigin());
      return;
    }

    this.stopBattleMusic();
    this.phase = 'bigtop_ready';
    this.progress.stage = 'bigtop_ready';
    this.bannerText = 'THE BIG TOP AWAITS';
    this.bannerTimer = QUEST_BANNER_FRAMES;
    // Signet moves ahead to wait by the Big Top door.
    this.repositionSignetToBigTopDoor(ctx.roster.grid);
  }

  private repositionSignetToBigTopDoor(mobGrid: SpatialGrid<Mob>): void {
    const door = this.bigTopDoorTile;
    const signet = this.signet;
    if (!door || !signet) return;
    const tile = this.findSpawnTile(
      door.x + SIGNET_DOOR_OFFSET_TILES,
      door.y + SIGNET_DOOR_OFFSET_TILES,
    );
    if (!tile) return;
    // She crosses the grounds in one step, so her grid cell has to be rewritten
    // by hand — nothing else moves her afterwards to resync it.
    const preMoveX = signet.x;
    const preMoveY = signet.y;
    signet.x = tile.x * TILE_SIZE;
    signet.y = tile.y * TILE_SIZE;
    mobGrid.move(signet, preMoveX, preMoveY);
    signet.anchorIdleWanderToCurrentPosition();
    signet.allyModeActive = false;
  }

  /**
   * The point on the circus boundary that `(x, y)` maps to, or null when it is
   * already on the grounds. Pixel coords, unlike `clampTileToArena`.
   */
  private boundaryPosition(
    x: number,
    y: number,
    maxRadiusTiles: number,
  ): { x: number; y: number } | null {
    const centre = this.circusCentre;
    if (!centre) return null;
    const centreX = centre.x * TILE_SIZE;
    const centreY = centre.y * TILE_SIZE;
    const maxDistPx = maxRadiusTiles * TILE_SIZE;
    const dx = x - centreX;
    const dy = y - centreY;
    const dist = Math.hypot(dx, dy);
    if (dist <= maxDistPx || dist === 0) return null;
    const pullBack = maxDistPx / dist;
    return { x: centreX + dx * pullBack, y: centreY + dy * pullBack };
  }

  private clampToCircus(entity: Player): void {
    const clamped = this.boundaryPosition(entity.x, entity.y, this.circusRadiusTiles);
    if (!clamped) return;
    entity.x = clamped.x;
    entity.y = clamped.y;
  }

  /**
   * Keeps a wave mob on the grounds. Unlike a player, a mob shoved onto a tent
   * or a wall tile has no input to free itself, so a boundary point that is not
   * walkable falls back to the nearest walkable arena tile.
   */
  private holdMobOnGrounds(mob: Mob, mobGrid: SpatialGrid<Mob>): void {
    const clamped = this.boundaryPosition(mob.x, mob.y, this.arenaSpawnRadiusTiles);
    if (!clamped) return;

    const tileX = Math.round(clamped.x / TILE_SIZE);
    const tileY = Math.round(clamped.y / TILE_SIZE);
    let destinationX = clamped.x;
    let destinationY = clamped.y;
    if (!this.gameMap.isWalkable(tileX, tileY)) {
      const openTile = this.findArenaSpawnTile(tileX, tileY);
      if (!openTile) return;
      destinationX = openTile.x * TILE_SIZE;
      destinationY = openTile.y * TILE_SIZE;
    }

    // Reindex at the point of the move: MobUpdateLoop reads the mob's position
    // *after* this system runs, so its own mobGrid.move would delete from the
    // post-move cell and strand a phantom entry in the pre-move one.
    const preMoveX = mob.x;
    const preMoveY = mob.y;
    mob.x = destinationX;
    mob.y = destinationY;
    mobGrid.move(mob, preMoveX, preMoveY);
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  /** World-space rendering: the "Talk" prompt over Signet. */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, active: Player): void {
    if (!this.signet?.isAlive || this.dialog.isOpen) return;
    if (!this.hasPendingDialog()) return;
    const dist = Math.hypot(this.signet.x - active.x, this.signet.y - active.y);
    if (dist > TILE_SIZE * INTERACT_RANGE_TILES) return;
    // Signet is drawn at double tile scale, so her tile top is her chest — the
    // prompt has to be lifted clear of her head and her elite marker.
    const promptY = this.signet.y - camY - SIGNET_OVERLAY_CLEARANCE * TILE_SIZE;
    drawInteractionPrompt(ctx, this.signet.x - camX, promptY, TILE_SIZE, 'Talk');
  }

  renderUI(ctx: CanvasRenderingContext2D): void {
    this.dialog.render(ctx);
    drawQuestBanner(ctx, this.bannerText, this.bannerTimer);
    drawQuestCompleteOverlay(ctx, 'THE SHOW MUST GO ON — COMPLETE', this.completeOverlayTimer);
  }
}
