/**
 * MurderMysteryQuestSystem — the overworld half of "The Krasue Murders",
 * the town's dialog-driven murder mystery:
 *
 *   GumGum's plea (Mordecai warns you off) → her headless body turns up in
 *   the alley behind the Sunken Stump → three clue points around town (the
 *   well, Old Hilda's cottage, the tower plaza shrine) → a krasue swarm hits
 *   the streets at nightfall → the trail leads to the cult nest in Blackwood
 *   Barracks (cleared indoors by CultHideoutSystem) → the letter names Miss
 *   Quill → tower confrontation (QuillConfrontationSystem) → rewards.
 *
 * Cross-scene state lives in MurderQuestProgress; every stage is
 * entry-idempotent so building round-trips reconstruct cleanly.
 */

import { TILE_SIZE } from '../core/constants';
import { applyActiveDifficultyRewards } from '../core/difficultyProfiles';
import type { GameMap } from '../map/GameMap';
import { findNearbyWalkableTile } from '../map/findWalkableTile';
import { WELL } from '../map/tileTypes';
import type { EventBus } from '../core/EventBus';
import type { AudioManager } from '../audio/AudioManager';
import type { GameSystem, SystemContext } from './GameSystem';
import type { Mob } from '../creatures/Mob';
import type { Player } from '../Player';
import { QuestManager, type QuestStatus } from '../core/QuestManager';
import type { TrackerEntry } from './questTracker';
import type { MurderQuestProgress } from '../core/MurderQuestProgress';
import type { OverworldMusicSystem } from './OverworldMusicSystem';
import type { QuestMarkerType } from './MiniMapSystem';
import { GumGum } from '../creatures/GumGum';
import { Krasue } from '../creatures/Krasue';
import { drawGumGumCorpse } from '../sprites/gumGumSprite';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import { QuestDialog, type DialogPage } from '../ui/QuestDialog';
import {
  drawQuestBanner,
  drawQuestCompleteOverlay,
  QUEST_BANNER_FRAMES,
  QUEST_COMPLETE_OVERLAY_FRAMES,
} from '../ui/QuestBanners';
import {
  HOOK_DIALOG,
  BODY_FOUND_DIALOG,
  WELL_CLUE_DIALOG,
  HOME_CLUE_DIALOG,
  ROOST_CLUE_DIALOG,
  NIGHT_FALLS_DIALOG,
  AFTERMATH_DIALOG,
  HIDEOUT_CLEARED_DIALOG,
} from './murderQuestDialogs';

export const MURDER_QUEST_ID = 'krasue_murders';

/** How far a scripted spawn may be nudged to find a walkable tile. */
const SPAWN_SEARCH_RADIUS_TILES = 6;
/** How close the player must be to talk / investigate. */
const INTERACT_RANGE_TILES = 2.2;
/** Passing this close to the alley triggers the corpse discovery. */
const BODY_DISCOVERY_RANGE_TILES = 5;

/** GumGum loiters this far east of the pub door (the fallback hook location). */
const GUMGUM_DOOR_OFFSET = { dx: 3, dy: 0 };
/** GumGum loiters this far south of the club door when the hook meets there. */
const GUMGUM_CLUB_DOOR_OFFSET = { dx: 0, dy: 2 };
/** The club building whose entrance hosts GumGum's book-accurate approach. */
const GUMGUM_HOOK_CLUB_NAME = 'The Desperado Club';
/**
 * The alley where her body turns up.
 *
 * Preferred: the two-wide alley running down the Desperado Club's east flank,
 * reached from the club door by walking east along Low Street — the "murder
 * alley" the town's street plan exists to provide (`docs/town.md`).
 * The fallback offset from the pub door is kept for a map with no club: it used
 * to be the primary, and on the compacted town it now points four tiles west of
 * a pub that stands *against* the west wall, i.e. outside the town.
 */
const CLUB_ALLEY_DOOR_OFFSET = { dx: 8, dy: 0 };
const PUB_ALLEY_DOOR_OFFSET = { dx: -4, dy: 2 };
/** The shrine of moulted feathers sits just south of the tower door. */
const ROOST_DOOR_OFFSET = { dx: 0, dy: 3 };

/** The night-attack swarm: a ring of krasue closing in on the player. */
const NIGHT_SWARM_OFFSETS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: 8, dy: 0 },
  { dx: 6, dy: 6 },
  { dx: 0, dy: 8 },
  { dx: -6, dy: 6 },
  { dx: -8, dy: 0 },
  { dx: -6, dy: -6 },
  { dx: 0, dy: -8 },
  { dx: 6, dy: -6 },
];
const NIGHT_SWARM_LEVEL = 6;

const BATTLE_MUSIC_FADE_IN_MS = 1000;

/** Clue-point glow rendering. */
const CLUE_GLOW_RADIUS_RATIO = 0.35;
const CLUE_GLOW_ALPHA_BASE = 0.35;
const CLUE_GLOW_ALPHA_PULSE = 0.2;
const CLUE_GLOW_PULSE_MS = 450;

type MurderQuestPhase =
  | 'gumgum_waiting'
  | 'body_waiting'
  | 'investigation'
  | 'night_attack'
  | 'cult_hideout'
  | 'confrontation'
  | 'awaiting_rewards'
  | 'complete';

type ClueId = 'well' | 'home' | 'roost';

interface CluePoint {
  id: ClueId;
  tile: { x: number; y: number };
  pages: ReadonlyArray<DialogPage>;
}

export interface MurderMysteryQuestCheckpoint {
  questStatuses: Array<[string, QuestStatus]>;
  phase: MurderQuestPhase;
  swarmCleared: boolean;
  swarm: Mob[];
  gumgum: GumGum | null;
}

export class MurderMysteryQuestSystem implements GameSystem {
  readonly questManager: QuestManager;

  private phase: MurderQuestPhase;
  private readonly dialog: QuestDialog;

  private gumgum: GumGum | null = null;
  /**
   * Whether the creature `gumgum` points at is still in the scene's mob array.
   *
   * `finishHook` is the only place she leaves it, and it splices her out for
   * good — the scene's checkpoint rewind can revive a corpse but cannot re-add
   * a mob it no longer holds. Tracked here rather than searched for in the mob
   * array, because "she was removed" is a fact this system alone creates.
   */
  private gumgumInWorld = false;
  private readonly gumgumTile: { x: number; y: number } | null;
  private readonly alleyTile: { x: number; y: number } | null;
  private readonly clues: CluePoint[] = [];
  private readonly hideoutDoorTile: { x: number; y: number } | null;
  private readonly towerDoorTile: { x: number; y: number } | null;

  private swarm: Mob[] = [];
  /** Gates the swarm-cleared side effects (music, objective event) to fire once. */
  private swarmCleared = false;
  private bannerTimer = 0;
  private bannerText = '';
  private completeOverlayTimer = 0;
  /** Latest frame context — lets dialog callbacks reach the live players. */
  private lastCtx: SystemContext | null = null;

  constructor(
    private readonly gameMap: GameMap,
    private readonly bus: EventBus,
    private readonly addMob: (mob: Mob) => void,
    private readonly progress: MurderQuestProgress,
    private readonly overworldMusic: OverworldMusicSystem | null = null,
    private readonly audio: AudioManager | null = null,
  ) {
    this.questManager = new QuestManager();
    this.questManager.register({
      id: MURDER_QUEST_ID,
      name: 'The Krasue Murders',
      type: 'story',
      rewards: {
        xp: 800,
        lootBoxItems: [
          { id: 'health_potion', minQty: 3, maxQty: 5 },
          { id: 'stat_boost_potion', minQty: 1, maxQty: 1 },
        ],
        coins: 150,
      },
    });
    this.dialog = new QuestDialog(this.audio ?? null);

    const pubDoor = this.doorTileOf('The Sunken Stump Pub');
    // Book-accurate hook: GumGum approaches at the Desperado Club when it exists
    // on this floor, else the pub (Carl's Doomsday Scenario). Gated on the pub
    // too, so the alley/body anchor and the "is this quest viable?" check below
    // still resolve exactly as before on a pub-less map. To force the pub hook,
    // drop this club lookup — the rest of the quest is untouched.
    const clubDoor = pubDoor ? this.doorTileOf(GUMGUM_HOOK_CLUB_NAME) : null;
    // The hook and the corpse anchor separately: she is last seen at the club's
    // door and found in the alley beside it.
    const hookDoor = clubDoor ?? pubDoor;
    const hookOffset = clubDoor ? GUMGUM_CLUB_DOOR_OFFSET : GUMGUM_DOOR_OFFSET;
    this.gumgumTile = hookDoor
      ? this.findSpawnTile(hookDoor.x + hookOffset.dx, hookDoor.y + hookOffset.dy)
      : null;
    const alleyDoor = clubDoor ?? pubDoor;
    const alleyOffset = clubDoor ? CLUB_ALLEY_DOOR_OFFSET : PUB_ALLEY_DOOR_OFFSET;
    this.alleyTile = alleyDoor
      ? this.findSpawnTile(alleyDoor.x + alleyOffset.dx, alleyDoor.y + alleyOffset.dy)
      : null;
    this.hideoutDoorTile = this.doorTileOf('Blackwood Lodge');
    this.towerDoorTile = this.doorTileOf('Town Center Tower');

    const wellTile = this.findWellTile();
    const homeDoor = this.doorTileOf("Old Hilda's Cottage");
    if (wellTile) this.clues.push({ id: 'well', tile: wellTile, pages: WELL_CLUE_DIALOG });
    if (homeDoor) this.clues.push({ id: 'home', tile: homeDoor, pages: HOME_CLUE_DIALOG });
    if (this.towerDoorTile) {
      const roostTile = this.findSpawnTile(
        this.towerDoorTile.x + ROOST_DOOR_OFFSET.dx,
        this.towerDoorTile.y + ROOST_DOOR_OFFSET.dy,
      );
      if (roostTile) this.clues.push({ id: 'roost', tile: roostTile, pages: ROOST_CLUE_DIALOG });
    }

    this.phase = this.gumgumTile ? this.phaseFromProgress() : 'complete';
    this.enterPhase();
  }

  // ── Stage-idempotent construction ─────────────────────────────────────────

  private phaseFromProgress(): MurderQuestPhase {
    switch (this.progress.stage) {
      case 'not_started':
        return 'gumgum_waiting';
      case 'body_waiting':
        return 'body_waiting';
      case 'investigation':
        return 'investigation';
      case 'night_attack':
        return 'night_attack';
      case 'cult_hideout':
        return 'cult_hideout';
      case 'confrontation':
        return 'confrontation';
      case 'quill_slain':
        return 'awaiting_rewards';
      case 'complete':
        return 'complete';
    }
  }

  /** Rebuild the in-scene state the cross-scene progress object describes. */
  private enterPhase(): void {
    switch (this.phase) {
      case 'gumgum_waiting':
        this.spawnGumGum();
        break;
      case 'investigation':
      case 'cult_hideout':
      case 'confrontation':
      case 'awaiting_rewards':
        this.questManager.startQuest(MURDER_QUEST_ID);
        break;
      case 'night_attack':
        this.questManager.startQuest(MURDER_QUEST_ID);
        // The swarm respawns in full after a scene rebuild mid-attack.
        break;
      case 'body_waiting':
      case 'complete':
        break;
    }
  }

  private doorTileOf(buildingName: string): { x: number; y: number } | null {
    return this.gameMap.buildingEntries.find((b) => b.name === buildingName)?.doorTile ?? null;
  }

  private findSpawnTile(tileX: number, tileY: number): { x: number; y: number } | null {
    return findNearbyWalkableTile(this.gameMap, tileX, tileY, SPAWN_SEARCH_RADIUS_TILES);
  }

  /**
   * Locates the town well nearest the plaza by scanning the tile grid.
   *
   * Measured from `townSquareCentre` rather than from `gridSize / 2`: the two
   * coincide today only because the plaza happens to be centred on the map, and
   * which well hosts this clue is decided by whichever is nearer.
   */
  private findWellTile(): { x: number; y: number } | null {
    const size = this.gameMap.structure.length;
    const mapCentre = Math.floor(size / 2);
    const centre = this.gameMap.townSquareCentre ?? { x: mapCentre, y: mapCentre };
    let best: { x: number; y: number } | null = null;
    let bestDist = Infinity;
    for (let y = 0; y < size; y++) {
      const row = this.gameMap.structure[y];
      for (let x = 0; x < row.length; x++) {
        if (row[x].type !== WELL) continue;
        const dist = Math.hypot(x - centre.x, y - centre.y);
        if (dist < bestDist) {
          bestDist = dist;
          best = { x, y };
        }
      }
    }
    return best;
  }

  private spawnGumGum(): void {
    if (!this.gumgumTile) return;
    const gumgum = new GumGum(this.gumgumTile.x, this.gumgumTile.y, TILE_SIZE);
    gumgum.setMap(this.gameMap);
    this.gumgum = gumgum;
    this.gumgumInWorld = true;
    this.addMob(gumgum);
  }

  /**
   * Re-creates the hook NPC when a restore rewinds the quest to a phase that
   * expects her on the street but she has already walked off into the crowd.
   *
   * The checkpoint flags are stamped on because she now belongs to the
   * checkpoint's world: without them the next rewind would read her as a
   * post-checkpoint arrival and drop her, putting the ghost straight back.
   */
  private respawnGumGumForCheckpoint(): void {
    this.spawnGumGum();
    const gumgum = this.gumgum;
    if (gumgum === null) return;
    gumgum.presentAtCheckpoint = true;
    gumgum.aliveAtCheckpoint = true;
  }

  // ── Public surface consumed by DungeonScene ───────────────────────────────

  get isDialogOpen(): boolean {
    return this.dialog.isOpen;
  }

  /**
   * Snapshots the mystery so a death inside a safe room rewinds every beat the
   * player completed after checking in.
   *
   * The swarm mobs are stored as references rather than copies: at capture time
   * the field held those exact creatures, and the scene's checkpoint restore
   * revives the ones that died afterwards. `gumgum` is a reference too, but it
   * is read only as "was she on the street at the checkpoint?" — see
   * `restoreGumGum`, which never hands the stored creature back to the field.
   *
   * The swarm array is copied here *and* again in `restoreCheckpoint`, because
   * one snapshot is restored once per death — handing the stored array straight
   * to the live field would let a later `spawnNightSwarm` mutate the snapshot.
   *
   * `clues` is deliberately absent: the array is built once in the constructor
   * and never mutated, and the per-clue found flags it is read against live on
   * MurderQuestProgress, which carries its own capture/restore pair.
   */
  captureCheckpoint(): MurderMysteryQuestCheckpoint {
    return {
      questStatuses: this.questManager.snapshotStatuses(),
      phase: this.phase,
      swarmCleared: this.swarmCleared,
      swarm: [...this.swarm],
      gumgum: this.gumgum,
    };
  }

  restoreCheckpoint(snapshot: MurderMysteryQuestCheckpoint): void {
    this.questManager.restoreStatuses(snapshot.questStatuses);
    this.phase = snapshot.phase;
    this.swarmCleared = snapshot.swarmCleared;
    this.swarm = [...snapshot.swarm];
    this.restoreGumGum(snapshot.gumgum);
  }

  /**
   * A snapshot taken before the hook holds the creature that was standing on
   * the street at the time; if the player then heard the hook, that creature
   * has since been spliced out of the world and re-pointing at it would leave
   * an invisible, un-tickable NPC still offering its dialog.
   *
   * The live `gumgumInWorld` flag decides, not the snapshot: whichever GumGum is
   * currently on the street is the right one to keep — she is stationary, so no
   * repositioning is owed — and only a world with none at all needs a new one.
   */
  private restoreGumGum(snapshotGumGum: GumGum | null): void {
    if (snapshotGumGum === null) {
      this.gumgum = null;
      return;
    }
    if (!this.gumgumInWorld) this.respawnGumGumForCheckpoint();
  }

  /**
   * Holds GumGum's beacon state to the phase, every frame.
   *
   * Deliberately **not** part of `update()`, for the reason `BountySystem`'s
   * `syncShady` is not: an open quest dialog halts gameplay and the scene
   * returns before the system update pass, so a write in there could only ever
   * observe the dialog closed — and her beacon would stand over her for the
   * whole conversation. The scene calls this above that early return.
   */
  syncMarkers(): void {
    if (this.gumgum === null) return;
    // The same condition her glyph is drawn under in `render`, held on the
    // creature so her beacon — drawn a pass earlier, by her — agrees with it.
    this.gumgum.markerType =
      this.phase === 'gumgum_waiting' && !this.dialog.isOpen ? 'exclamation' : 'none';
  }

  /** Returns quest markers for the minimap. */
  get questMarkers(): Array<{ x: number; y: number; type: QuestMarkerType }> {
    const markers: Array<{ x: number; y: number; type: QuestMarkerType }> = [];
    switch (this.phase) {
      case 'gumgum_waiting':
        if (this.gumgumTile) {
          markers.push({ x: this.gumgumTile.x, y: this.gumgumTile.y, type: 'exclamation' });
        }
        break;
      case 'body_waiting':
        if (this.alleyTile) {
          markers.push({ x: this.alleyTile.x, y: this.alleyTile.y, type: 'exclamation' });
        }
        break;
      case 'investigation':
        for (const clue of this.clues) {
          if (!this.isClueFound(clue.id)) {
            markers.push({ x: clue.tile.x, y: clue.tile.y, type: 'question' });
          }
        }
        break;
      case 'night_attack':
        for (const mob of this.swarm) {
          if (mob.isAlive) {
            markers.push({
              x: Math.round(mob.x / TILE_SIZE),
              y: Math.round(mob.y / TILE_SIZE),
              type: 'red_x',
            });
          }
        }
        break;
      case 'cult_hideout':
        if (this.hideoutDoorTile) {
          markers.push({
            x: this.hideoutDoorTile.x,
            y: this.hideoutDoorTile.y,
            type: 'exclamation',
          });
        }
        break;
      case 'confrontation':
        if (this.towerDoorTile) {
          markers.push({ x: this.towerDoorTile.x, y: this.towerDoorTile.y, type: 'exclamation' });
        }
        break;
      case 'awaiting_rewards':
      case 'complete':
        break;
    }
    return markers;
  }

  /**
   * The Journal's line for the murder mystery, rebuilt from the phase every
   * frame.
   *
   * The investigation phase is the one that most needs a written objective: its
   * three clues are scattered across the town with nothing on screen tying them
   * together, and its minimap pips vanish under the fog on any street the player
   * has not walked yet.
   */
  trackerEntries(): ReadonlyArray<TrackerEntry> {
    const name = this.questManager.getDef(MURDER_QUEST_ID)?.name ?? 'The Krasue Murders';
    const base = { id: MURDER_QUEST_ID, name };

    switch (this.phase) {
      case 'gumgum_waiting':
        return [
          {
            ...base,
            status: 'available',
            objective: 'Hear GumGum out',
            hint: 'The jittery street elf outside the Desperado Club.',
            target: this.gumgumTile ?? undefined,
          },
        ];
      case 'body_waiting':
        return [
          {
            ...base,
            status: 'active',
            objective: 'Find what GumGum was so afraid of',
            hint: 'She pointed you down the service alley.',
            target: this.alleyTile ?? undefined,
          },
        ];
      case 'investigation': {
        const outstanding = this.clues.filter((clue) => !this.isClueFound(clue.id));
        const found = this.clues.length - outstanding.length;
        return [
          {
            ...base,
            status: 'active',
            objective: `Follow the trail — ${found} of ${this.clues.length} clues found`,
            hint: 'The well, a home and a roost. Ask the town what it has seen.',
            target: outstanding[0]?.tile,
          },
        ];
      }
      case 'night_attack': {
        const alive = this.swarm.filter((mob) => mob.isAlive);
        return [
          {
            ...base,
            status: 'active',
            objective: `Survive the krasue — ${alive.length} still flying`,
            target:
              alive.length === 0
                ? undefined
                : { x: Math.round(alive[0].x / TILE_SIZE), y: Math.round(alive[0].y / TILE_SIZE) },
          },
        ];
      }
      case 'cult_hideout':
        return [
          {
            ...base,
            status: 'active',
            objective: 'Search the cult’s lodge',
            hint: 'Blackwood Lodge, at the end of the dead-end alley off the West Lane.',
            target: this.hideoutDoorTile ?? undefined,
          },
        ];
      case 'confrontation':
        return [
          {
            ...base,
            status: 'active',
            objective: 'Take it to the tower',
            target: this.towerDoorTile ?? undefined,
          },
        ];
      case 'awaiting_rewards':
        return [{ ...base, status: 'active', objective: 'Collect what you are owed' }];
      case 'complete':
        return [{ ...base, status: 'completed', objective: 'The Krasue Murders are closed' }];
    }
  }

  private isClueFound(id: ClueId): boolean {
    switch (id) {
      case 'well':
        return this.progress.wellClueFound;
      case 'home':
        return this.progress.homeClueFound;
      case 'roost':
        return this.progress.roostClueFound;
    }
  }

  private markClueFound(id: ClueId): void {
    switch (id) {
      case 'well':
        this.progress.wellClueFound = true;
        break;
      case 'home':
        this.progress.homeClueFound = true;
        break;
      case 'roost':
        this.progress.roostClueFound = true;
        break;
    }
  }

  private allCluesFound(): boolean {
    return this.clues.every((clue) => this.isClueFound(clue.id));
  }

  private distToTile(entity: Player, tile: { x: number; y: number }): number {
    return Math.hypot(tile.x * TILE_SIZE - entity.x, tile.y * TILE_SIZE - entity.y);
  }

  /** Space-key interaction: GumGum's hook, then clue investigation. */
  tryInteract(active: Player): boolean {
    if (this.dialog.isOpen) return false;

    if (this.phase === 'gumgum_waiting' && this.gumgum && this.gumgumTile) {
      if (this.distToTile(active, this.gumgumTile) <= TILE_SIZE * INTERACT_RANGE_TILES) {
        this.dialog.open(HOOK_DIALOG, () => this.finishHook());
        return true;
      }
    }

    if (this.phase === 'investigation') {
      for (const clue of this.clues) {
        if (this.isClueFound(clue.id)) continue;
        if (this.distToTile(active, clue.tile) <= TILE_SIZE * INTERACT_RANGE_TILES) {
          this.dialog.open(clue.pages, () => this.finishClue(clue.id));
          return true;
        }
      }
    }

    return false;
  }

  /** Esc closes an open dialog without advancing the quest. Returns true if handled. */
  dismissDialog(): boolean {
    return this.dialog.dismiss();
  }

  handleClick(mx: number, my: number): boolean {
    if (this.completeOverlayTimer > 0) {
      this.completeOverlayTimer = 0;
      return true;
    }
    return this.dialog.handleClick(mx, my);
  }

  // ── Phase transitions ─────────────────────────────────────────────────────

  private finishHook(): void {
    // GumGum slips away into the crowd — the next time anyone sees her is the alley.
    if (this.gumgum && this.lastCtx) {
      const { mobs, grid } = this.lastCtx.roster;
      const idx = mobs.indexOf(this.gumgum);
      if (idx >= 0) mobs.splice(idx, 1);
      grid.remove(this.gumgum);
    }
    this.gumgum = null;
    this.gumgumInWorld = false;
    this.phase = 'body_waiting';
    this.progress.stage = 'body_waiting';
  }

  private discoverBody(): void {
    this.dialog.open(BODY_FOUND_DIALOG, () => {
      this.phase = 'investigation';
      this.progress.stage = 'investigation';
      this.questManager.startQuest(MURDER_QUEST_ID);
      this.bus.emit('questStarted', { questId: MURDER_QUEST_ID });
    });
  }

  private finishClue(id: ClueId): void {
    this.markClueFound(id);
    this.bus.emit('objectiveComplete', { objectiveId: `krasue_clue_${id}` });
    // The nightfall dialog is opened (and re-offered after an Esc dismissal)
    // by the investigation branch of update().
  }

  private beginNightAttack(): void {
    this.phase = 'night_attack';
    this.progress.stage = 'night_attack';
    this.bannerText = 'THE KRASUE COME AT NIGHTFALL';
    this.bannerTimer = QUEST_BANNER_FRAMES;
    this.audio?.play('krasue_attack');
    if (this.overworldMusic) this.overworldMusic.battleMusicActive = true;
    this.audio?.playMusic('defense_quest_music', { fadeInMs: BATTLE_MUSIC_FADE_IN_MS });
    if (this.lastCtx) this.spawnNightSwarm(this.lastCtx.active);
  }

  private spawnNightSwarm(active: Player): void {
    this.swarm = [];
    this.swarmCleared = false;
    const originX = Math.round(active.x / TILE_SIZE);
    const originY = Math.round(active.y / TILE_SIZE);
    for (const { dx, dy } of NIGHT_SWARM_OFFSETS) {
      const tile = this.findSpawnTile(originX + dx, originY + dy);
      if (!tile) continue;
      const krasue = new Krasue(tile.x, tile.y, TILE_SIZE);
      krasue.setMap(this.gameMap);
      krasue.ignoresTownSafeZone = true;
      krasue.applyMobLevel(NIGHT_SWARM_LEVEL);
      applyActiveDifficultyRewards(krasue);
      this.addMob(krasue);
      this.swarm.push(krasue);
    }
  }

  /** One-shot side effects when the last swarm krasue falls; the aftermath dialog is re-offered separately. */
  private handleSwarmCleared(): void {
    if (this.swarmCleared) return;
    this.swarmCleared = true;
    if (this.overworldMusic) {
      this.overworldMusic.battleMusicActive = false;
      this.overworldMusic.reset();
    }
    this.bus.emit('objectiveComplete', { objectiveId: 'krasue_night_attack_survived' });
  }

  private finishQuest(active: Player): void {
    this.phase = 'complete';
    this.progress.stage = 'complete';
    this.questManager.completeQuest(MURDER_QUEST_ID);

    const def = this.questManager.getDef(MURDER_QUEST_ID);
    if (def) active.gainXp(def.rewards.xp);

    this.bus.emit('questCompleted', { questId: MURDER_QUEST_ID });
    this.completeOverlayTimer = QUEST_COMPLETE_OVERLAY_FRAMES;
  }

  // ── Frame update ──────────────────────────────────────────────────────────

  update(ctx: SystemContext): void {
    this.lastCtx = ctx;
    if (this.completeOverlayTimer > 0) this.completeOverlayTimer--;
    if (this.bannerTimer > 0) this.bannerTimer--;

    switch (this.phase) {
      case 'body_waiting':
        if (
          !this.dialog.isOpen &&
          this.alleyTile &&
          this.distToTile(ctx.active, this.alleyTile) <= TILE_SIZE * BODY_DISCOVERY_RANGE_TILES
        ) {
          this.discoverBody();
        }
        break;
      case 'night_attack':
        // Entry-idempotent: a scene rebuild mid-attack respawns the full swarm.
        if (this.swarm.length === 0 && !this.dialog.isOpen) {
          if (this.overworldMusic) this.overworldMusic.battleMusicActive = true;
          if (this.audio && this.audio.currentMusicId !== 'defense_quest_music') {
            this.audio.playMusic('defense_quest_music', { fadeInMs: BATTLE_MUSIC_FADE_IN_MS });
          }
          this.spawnNightSwarm(ctx.active);
          break;
        }
        if (this.swarm.length > 0 && this.swarm.every((m) => !m.isAlive)) {
          this.handleSwarmCleared();
          // Re-offered every frame the dialog is closed, so an Esc dismissal
          // can't strand the quest before the stage advances.
          if (!this.dialog.isOpen) {
            this.dialog.open(AFTERMATH_DIALOG, () => {
              this.phase = 'cult_hideout';
              this.progress.stage = 'cult_hideout';
            });
          }
        }
        break;
      case 'confrontation':
        // The hideout letter names Quill the first time we're back on the streets.
        if (!this.progress.quillNamed && !this.dialog.isOpen) {
          this.dialog.open(HIDEOUT_CLEARED_DIALOG, () => {
            this.progress.quillNamed = true;
          });
        }
        break;
      case 'awaiting_rewards':
        this.finishQuest(ctx.active);
        break;
      case 'investigation':
        // Opens once the last clue's dialog closes, and re-offers after an
        // Esc dismissal — otherwise the quest would strand here forever.
        if (this.allCluesFound() && !this.dialog.isOpen) {
          this.dialog.open(NIGHT_FALLS_DIALOG, () => this.beginNightAttack());
        }
        break;
      case 'gumgum_waiting':
      case 'cult_hideout':
      case 'complete':
        break;
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  /** World-space rendering: corpse prop, clue glows, and interaction prompts. */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, active: Player): void {
    // The corpse stays in the alley from discovery until the mystery is solved.
    if (
      this.alleyTile &&
      (this.phase === 'body_waiting' ||
        this.phase === 'investigation' ||
        this.phase === 'night_attack' ||
        this.phase === 'cult_hideout' ||
        this.phase === 'confrontation')
    ) {
      drawGumGumCorpse(
        ctx,
        this.alleyTile.x * TILE_SIZE - camX,
        this.alleyTile.y * TILE_SIZE - camY,
        TILE_SIZE,
      );
    }

    if (this.dialog.isOpen) return;

    if (this.phase === 'gumgum_waiting' && this.gumgum && this.gumgumTile) {
      this.gumgum.renderQuestMarker(ctx, camX, camY, TILE_SIZE);
      if (this.distToTile(active, this.gumgumTile) <= TILE_SIZE * INTERACT_RANGE_TILES) {
        drawInteractionPrompt(ctx, this.gumgum.x - camX, this.gumgum.y - camY, TILE_SIZE, 'Talk');
      }
    }

    if (this.phase === 'investigation') {
      const pulse =
        CLUE_GLOW_ALPHA_BASE + Math.sin(Date.now() / CLUE_GLOW_PULSE_MS) * CLUE_GLOW_ALPHA_PULSE;
      for (const clue of this.clues) {
        if (this.isClueFound(clue.id)) continue;
        const sx = clue.tile.x * TILE_SIZE - camX;
        const sy = clue.tile.y * TILE_SIZE - camY;
        ctx.save();
        ctx.fillStyle = `rgba(250, 220, 90, ${Math.max(0, pulse)})`;
        ctx.beginPath();
        ctx.arc(
          sx + TILE_SIZE / 2,
          sy + TILE_SIZE / 2,
          TILE_SIZE * CLUE_GLOW_RADIUS_RATIO,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.restore();
        if (this.distToTile(active, clue.tile) <= TILE_SIZE * INTERACT_RANGE_TILES) {
          drawInteractionPrompt(ctx, sx, sy, TILE_SIZE, 'Investigate');
        }
      }
    }
  }

  renderUI(ctx: CanvasRenderingContext2D): void {
    this.dialog.render(ctx);
    drawQuestBanner(ctx, this.bannerText, this.bannerTimer, '#f47c7c', '#6a2a2a');
    drawQuestCompleteOverlay(ctx, 'THE KRASUE MURDERS — SOLVED', this.completeOverlayTimer);
  }
}
