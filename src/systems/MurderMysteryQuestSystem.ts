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
import type { ItemId } from '../core/ItemDefs';
import { partyLevelOf } from '../levels/spawner';
import { questMobLevel } from './questMobLevel';
import type { TrackerEntry, TrackerTarget } from './questTracker';
import type { MurderQuestProgress } from '../core/MurderQuestProgress';
import type { OverworldMusicSystem } from './OverworldMusicSystem';
import type { QuestMarkerType } from './MiniMapSystem';
import { GumGum } from '../creatures/GumGum';
import { Krasue, AGGRO_RANGE_TILES as KRASUE_AGGRO_RANGE_TILES } from '../creatures/Krasue';
import { drawGumGumCorpse } from '../sprites/gumGumSprite';
import { drawWellClueProp, drawHomeClueProp, drawRoostClueProp } from '../sprites/kraseuClueProps';
import { drawRadialGlow } from '../sprites/radialGlow';
import { drawBouncingArrowAboveEntity } from '../ui/WorldArrow';
import { doorwaySpan, type BuildingEntry } from './BuildingSystem';
import { doorwayBeaconTarget } from './objectiveBeaconTargets';
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
  TAUNT_AND_NIGHTFALL_DIALOG,
  AFTERMATH_DIALOG,
  HIDEOUT_CLEARED_DIALOG,
} from './murderQuestDialogs';

export const MURDER_QUEST_ID = 'krasue_murders';

/** The two papers tucked in GumGum's coat, handed over when the alley scene closes. */
const ALLEY_EVIDENCE: ReadonlyArray<ItemId> = ['magistrates_writ', 'unreadable_letter'];

/** How far a scripted spawn may be nudged to find a walkable tile. */
const SPAWN_SEARCH_RADIUS_TILES = 6;
/** How close the player must be to talk. */
const INTERACT_RANGE_TILES = 2.2;
/**
 * How close the player must be to investigate a clue.
 *
 * Wider than the talk range because a clue is a gore scene spread over a couple
 * of tiles rather than a person standing on one: the prompt has to appear as the
 * player walks up to the prop, not only once they are standing in the middle of
 * it.
 */
const CLUE_INTERACT_RANGE_TILES = 3;
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
/**
 * The drag from Hilda's doorstep ends this far out into the street.
 *
 * Off the doorway deliberately: standing on a doorway tile pops the building
 * entry menu, whose pre-focused Enter button then swallows the Space press the
 * player meant for the clue.
 */
const HOME_DOOR_OFFSET = { dx: 0, dy: 2 };

/**
 * The night-attack swarm: a ring of krasue closing in on the player.
 *
 * Radius stays well inside `KRASUE_AGGRO_RANGE_TILES` (8) rather than riding
 * its edge: `findSpawnTile` may still nudge an offset a few tiles to clear a
 * fence or building, and a krasue nudged past its own aggro range spawns
 * already lost — wandering the street instead of joining the fight, while the
 * "still flying" counter keeps expecting it.
 */
const NIGHT_SWARM_RING_RADIUS_TILES = 4;
type SwarmOffset = { readonly dx: number; readonly dy: number };
const NIGHT_SWARM_OFFSETS: ReadonlyArray<SwarmOffset> = [
  { dx: NIGHT_SWARM_RING_RADIUS_TILES, dy: 0 },
  { dx: 3, dy: 3 },
  { dx: 0, dy: NIGHT_SWARM_RING_RADIUS_TILES },
  { dx: -3, dy: 3 },
  { dx: -NIGHT_SWARM_RING_RADIUS_TILES, dy: 0 },
  { dx: -3, dy: -3 },
  { dx: 0, dy: -NIGHT_SWARM_RING_RADIUS_TILES },
  { dx: 3, dy: -3 },
];
const NIGHT_SWARM_LEVEL = 6;
/**
 * Krasue alive from the swarm at once. Uncapped, all eight spawned in the same
 * ring the player stands inside — this is the difference between a fight and
 * an ambush.
 */
const NIGHT_SWARM_CONCURRENT_CAP = 4;
/**
 * Frames a freshly-spawned swarm krasue runs no AI at all — reused for both the
 * opening wave and every reinforcement, so a krasue never gets a free hit on a
 * player who has not seen it materialise yet, and a death-respawn is never
 * greeted by an instantly-attacking ring on top of the new spawn point.
 */
const NIGHT_SWARM_SPAWN_GRACE_FRAMES = 90;

const BATTLE_MUSIC_FADE_IN_MS = 1000;

/**
 * Clue-point attention rendering.
 *
 * Witch-green rather than the festival yellow every other marker in town uses:
 * a clue is a krasue's leavings, and the glow over it should read as the same
 * sickly light the creature itself trails.
 */
const CLUE_GLOW_RGB = '132, 206, 92';
const CLUE_GLOW_RADIUS_TILES = 1.5;
const CLUE_GLOW_ALPHA_BASE = 0.35;
const CLUE_GLOW_ALPHA_PULSE = 0.2;
const CLUE_GLOW_PULSE_MS = 450;
/**
 * Steps the pulsing alpha is rounded to before it reaches `drawRadialGlow`.
 *
 * Each distinct set of colour stops bakes its own texture for the life of the
 * page, so a continuously varying alpha would allocate one per frame.
 */
const CLUE_GLOW_ALPHA_STEPS = 12;
/** A flat bright centre, so the glow reads as a pool of light rather than a point. */
const CLUE_GLOW_CORE_FRACTION = 0.25;

/** Beyond this the arrow is clutter; inside it, it is the one unmissable "look here". */
const CLUE_ARROW_RANGE_TILES = 12;
const CLUE_ARROW_COLOR = '#9ade63';
const CLUE_ARROW_OUTLINE_COLOR = '#16300c';

/**
 * How wide each gore prop lies, in tiles, and how far west of the clue tile it
 * starts — the prop is drawn centred on the clue tile, so a beacon sized to it
 * has to start half a tile back to stay centred too.
 */
const CLUE_PROP_WIDTH_TILES = 2;
const CLUE_PROP_WEST_OFFSET_TILES = 0.5;

type MurderQuestPhase =
  | 'gumgum_waiting'
  | 'body_waiting'
  | 'investigation'
  | 'night_attack'
  | 'cult_hideout'
  | 'confrontation'
  | 'lich_confrontation'
  | 'awaiting_rewards'
  | 'complete';

type ClueId = 'well' | 'home' | 'roost';

/**
 * The well clue sits on the well's own tile, and the well is a Y-sorted
 * decoration painted in `RenderPipeline.renderEntities` — which runs after
 * this system's `render()` in the scene's draw order. Drawn there like the
 * other clues, the well's own sprite paints over it every frame, leaving
 * only the ground pool at its base visible and burying its bouncing arrow
 * along with it. `renderWellClueOverlay` repaints just this clue afterward
 * so it lands on top of the well sprite instead of under it.
 */
const WELL_CLUE_ID: ClueId = 'well';

/** Draws a clue's gore scene from the clue tile's top-left corner, in screen space. */
type CluePropDrawer = (
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
) => void;

interface CluePoint {
  id: ClueId;
  tile: { x: number; y: number };
  pages: ReadonlyArray<DialogPage>;
  drawProp: CluePropDrawer;
}

export interface MurderMysteryQuestCheckpoint {
  questStatuses: Array<[string, QuestStatus]>;
  phase: MurderQuestPhase;
  swarmCleared: boolean;
  swarm: Mob[];
  swarmStarted: boolean;
  swarmDefeatedBaseline: number;
  swarmSpawnQueue: ReadonlyArray<SwarmOffset>;
  swarmSpawnGrace: Array<[Krasue, number]>;
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
  private readonly hideoutEntry: BuildingEntry | null;
  private readonly towerEntry: BuildingEntry | null;

  private swarm: Mob[] = [];
  /** Gates the swarm-cleared side effects (music, objective event) to fire once. */
  private swarmCleared = false;
  /** Gates the initial spawn wave to once per instance — every rebuild gets a fresh one. */
  private swarmStarted = false;
  /** `progress.swarmKrasueDefeated` as it stood when this instance's wave began. */
  private swarmDefeatedBaseline = 0;
  /** Offsets not yet spawned this wave — refilled into `swarm` as members fall. */
  private swarmSpawnQueue: ReadonlyArray<SwarmOffset> = [];
  /** Frames left before each freshly-spawned krasue's AI unfreezes. */
  private swarmSpawnGrace = new Map<Krasue, number>();
  private bannerTimer = 0;
  private bannerText = '';
  private completeOverlayTimer = 0;
  /** Latest frame context — lets dialog callbacks reach the live players. */
  private lastCtx: SystemContext | null = null;
  /**
   * The party level the night swarm is levelled against, kept current from the
   * frame context — the swarm only ever spawns from `update`, so it is always
   * this frame's value by the time a krasue is built.
   */
  private partyLevel = 1;

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
    this.hideoutEntry = this.buildingEntryOf('Blackwood Lodge');
    this.towerEntry = this.buildingEntryOf('Town Center Tower');

    const wellTile = this.findWellTile();
    if (wellTile) {
      this.clues.push({
        id: WELL_CLUE_ID,
        tile: wellTile,
        pages: WELL_CLUE_DIALOG,
        drawProp: drawWellClueProp,
      });
    }
    const homeEntry = this.buildingEntryOf("Old Hilda's Cottage");
    const homeTile = homeEntry
      ? this.findTileClearOfAllDoorways(
          homeEntry.doorTile.x + HOME_DOOR_OFFSET.dx,
          homeEntry.doorTile.y + HOME_DOOR_OFFSET.dy,
        )
      : null;
    if (homeTile) {
      this.clues.push({
        id: 'home',
        tile: homeTile,
        pages: HOME_CLUE_DIALOG,
        drawProp: drawHomeClueProp,
      });
    }
    const towerDoor = this.towerDoorTile;
    if (towerDoor) {
      const roostTile = this.findTileClearOfAllDoorways(
        towerDoor.x + ROOST_DOOR_OFFSET.dx,
        towerDoor.y + ROOST_DOOR_OFFSET.dy,
      );
      if (roostTile) {
        this.clues.push({
          id: 'roost',
          tile: roostTile,
          pages: ROOST_CLUE_DIALOG,
          drawProp: drawRoostClueProp,
        });
      }
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
        return 'lich_confrontation';
      case 'lich_slain':
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
      case 'lich_confrontation':
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

  private buildingEntryOf(buildingName: string): BuildingEntry | null {
    return this.gameMap.buildingEntries.find((b) => b.name === buildingName) ?? null;
  }

  private doorTileOf(buildingName: string): { x: number; y: number } | null {
    return this.buildingEntryOf(buildingName)?.doorTile ?? null;
  }

  private get hideoutDoorTile(): { x: number; y: number } | null {
    return this.hideoutEntry?.doorTile ?? null;
  }

  private get towerDoorTile(): { x: number; y: number } | null {
    return this.towerEntry?.doorTile ?? null;
  }

  private findSpawnTile(
    tileX: number,
    tileY: number,
    isAcceptable?: (x: number, y: number) => boolean,
  ): { x: number; y: number } | null {
    return findNearbyWalkableTile(
      this.gameMap,
      tileX,
      tileY,
      SPAWN_SEARCH_RADIUS_TILES,
      isAcceptable,
    );
  }

  /**
   * True inside the town's own streets and plazas — the wall ring's interior,
   * minus any fenced private yard (unless standing in that yard's own gate).
   *
   * The night swarm needs this, not `isInTownSafeZone`: the safe zone is a
   * circle around the plaza used to let krasue give up a chase, unrelated to
   * where they are allowed to land. Without this check a spawn ring offset
   * nudges to the *nearest* walkable tile with no regard for the wall, which
   * can be a fenced backyard the player has no reason to visit or open ground
   * outside the wall entirely — both leave a krasue that never finds the fight.
   */
  private isPublicTownTile(x: number, y: number): boolean {
    const plan = this.gameMap.townPlan;
    if (!plan) return true;
    const { interior } = plan;
    if (
      x < interior.x ||
      y < interior.y ||
      x >= interior.x + interior.w ||
      y >= interior.y + interior.h
    ) {
      return false;
    }
    return plan.yards.every((yard) => {
      if (!yard.fenced) return true;
      const { bounds } = yard;
      const inYard =
        x >= bounds.x && y >= bounds.y && x < bounds.x + bounds.w && y < bounds.y + bounds.h;
      if (!inYard) return true;
      return yard.gates.some(
        (gate) => x >= gate.x && y >= gate.y && x < gate.x + gate.w && y < gate.y + gate.h,
      );
    });
  }

  /**
   * True when a tile falls outside every building's doorway span, so a clue
   * placed near one entry can't drift into another's opening and fire that
   * building's entry menu instead of the clue's dialog.
   */
  private isClearOfAllDoorways(x: number, y: number): boolean {
    return this.gameMap.buildingEntries.every((entry) => {
      const { x0, width } = doorwaySpan(entry);
      return y !== entry.doorTile.y || x < x0 || x >= x0 + width;
    });
  }

  /**
   * A walkable tile near the given origin that the entry menu will never fire
   * on.
   *
   * The nudge that finds walkable ground is free to land back on an opening —
   * a doorway is walkable by definition — so every doorway span is excluded
   * from the search rather than checked after it.
   */
  private findTileClearOfAllDoorways(
    originX: number,
    originY: number,
  ): { x: number; y: number } | null {
    return findNearbyWalkableTile(
      this.gameMap,
      originX,
      originY,
      SPAWN_SEARCH_RADIUS_TILES,
      (x, y) => this.isClearOfAllDoorways(x, y),
    );
  }

  /** A beacon sized to a clue's gore scene rather than to the single tile it is keyed on. */
  private clueBeaconTarget(clue: CluePoint | undefined): TrackerTarget | undefined {
    if (clue === undefined) return undefined;
    return {
      x: clue.tile.x - CLUE_PROP_WEST_OFFSET_TILES,
      y: clue.tile.y,
      widthTiles: CLUE_PROP_WIDTH_TILES,
    };
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
      swarmStarted: this.swarmStarted,
      swarmDefeatedBaseline: this.swarmDefeatedBaseline,
      swarmSpawnQueue: [...this.swarmSpawnQueue],
      swarmSpawnGrace: [...this.swarmSpawnGrace],
      gumgum: this.gumgum,
    };
  }

  restoreCheckpoint(snapshot: MurderMysteryQuestCheckpoint): void {
    this.questManager.restoreStatuses(snapshot.questStatuses);
    this.phase = snapshot.phase;
    this.swarmCleared = snapshot.swarmCleared;
    this.swarm = [...snapshot.swarm];
    this.swarmStarted = snapshot.swarmStarted;
    this.swarmDefeatedBaseline = snapshot.swarmDefeatedBaseline;
    this.swarmSpawnQueue = [...snapshot.swarmSpawnQueue];
    this.swarmSpawnGrace = new Map(snapshot.swarmSpawnGrace);
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
      case 'lich_confrontation':
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
            hint: 'The well, Hilda’s door, and the plaza under the tower. The letter in your pack stays warm.',
            target: this.clueBeaconTarget(outstanding[0]),
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
            target: doorwayBeaconTarget(this.hideoutEntry) ?? undefined,
          },
        ];
      case 'confrontation':
        return [
          {
            ...base,
            status: 'active',
            objective: 'Take it to the tower',
            hint: 'Miss Quill’s “capacitor” waits at the top of the magistrate’s tower. So does whatever signs Featherfall’s letters.',
            target: doorwayBeaconTarget(this.towerEntry) ?? undefined,
          },
        ];
      case 'lich_confrontation':
        return [
          {
            ...base,
            status: 'active',
            objective: 'Destroy the Lich',
            hint: 'Whatever has been signing Featherfall’s letters is still in his office.',
            target: doorwayBeaconTarget(this.towerEntry) ?? undefined,
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
        if (this.distToTile(active, clue.tile) <= TILE_SIZE * CLUE_INTERACT_RANGE_TILES) {
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
    if (this.advanceOutcomeOverlay()) return true;
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
      // The dialog strip only ever previews these — Carl pockets the writ and the
      // letter off the body here, in code, or neither ever reaches the bag.
      this.progress.evidenceOwed = [...ALLEY_EVIDENCE];
    });
  }

  /**
   * Hands over the papers off GumGum's body, retrying until the bag has room.
   *
   * `addItem` on a full bag returns nothing and drops the item. These two are granted once,
   * behind a stage advance that never runs again, and the investigation's own
   * hint talks about the letter being in the player's pack — so losing them
   * would leave the quest describing evidence that does not exist. Retried every
   * frame instead, which costs nothing and resolves itself the moment the player
   * frees a slot. The outstanding list lives on the cross-scene progress record,
   * so walking through a door mid-retry does not end the attempt.
   */
  private grantOwedEvidence(ctx: SystemContext): void {
    const owed = this.progress.evidenceOwed;
    if (owed.length === 0) return;
    const bag = ctx.human.inventory;
    this.progress.evidenceOwed = owed.filter((id) => {
      if (!bag.hasRoomFor(id)) return true;
      bag.addItem(id, 1);
      return false;
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
    // Music and the first spawn wave are owned by update()'s night_attack case,
    // which runs this same instance's very next frame — the one thing every
    // resumed instance also needs, so there is exactly one place that does it.
  }

  /**
   * Starts (or, on a rebuilt instance, resumes) the swarm: the offsets already
   * accounted for by `progress.swarmKrasueDefeated` are skipped, so a death
   * respawn owes only the krasue still standing, not a fresh eight.
   */
  private spawnNightSwarm(active: Player): void {
    this.swarm = [];
    this.swarmCleared = false;
    this.swarmDefeatedBaseline = Math.min(
      this.progress.swarmKrasueDefeated,
      NIGHT_SWARM_OFFSETS.length,
    );
    this.swarmSpawnQueue = NIGHT_SWARM_OFFSETS.slice(this.swarmDefeatedBaseline);
    this.fillSwarmSpawns(active);
  }

  /**
   * Spawns from the queue until `NIGHT_SWARM_CONCURRENT_CAP` krasue are alive
   * at once, or the queue runs dry. Called every frame the queue still holds
   * something, so a kill during the fight is replaced rather than leaving the
   * player facing a shrinking pack until the whole ring has cycled through.
   */
  private fillSwarmSpawns(active: Player): void {
    const originX = Math.round(active.x / TILE_SIZE);
    const originY = Math.round(active.y / TILE_SIZE);
    let openSlots = NIGHT_SWARM_CONCURRENT_CAP - this.swarm.filter((mob) => mob.isAlive).length;
    let queue = this.swarmSpawnQueue;
    while (openSlots > 0 && queue.length > 0) {
      const [{ dx, dy }, ...rest] = queue;
      queue = rest;
      openSlots--;
      const tile = this.findSpawnTile(originX + dx, originY + dy, (x, y) =>
        this.isPublicTownTile(x, y),
      );
      if (!tile) continue;
      // Belt-and-braces: a lawful tile can still be walked out past aggro range
      // by the ring search on a tight street. A krasue that lands there would
      // spawn already lost — better to drop it than ship dead weight.
      const spawnDistTiles = Math.hypot(tile.x - originX, tile.y - originY);
      if (spawnDistTiles > KRASUE_AGGRO_RANGE_TILES) continue;
      const krasue = new Krasue(tile.x, tile.y, TILE_SIZE);
      krasue.setMap(this.gameMap);
      krasue.ignoresTownSafeZone = true;
      krasue.applyMobLevel(questMobLevel(NIGHT_SWARM_LEVEL, this.partyLevel));
      applyActiveDifficultyRewards(krasue);
      krasue.aiHeld = true;
      this.swarmSpawnGrace.set(krasue, NIGHT_SWARM_SPAWN_GRACE_FRAMES);
      this.addMob(krasue);
      this.swarm.push(krasue);
    }
    this.swarmSpawnQueue = queue;
  }

  /** Counts down each spawn-held krasue's grace and releases its AI once it expires. */
  private tickSwarmSpawnGrace(): void {
    for (const [krasue, framesLeft] of this.swarmSpawnGrace) {
      if (!krasue.isAlive) {
        this.swarmSpawnGrace.delete(krasue);
        continue;
      }
      const remaining = framesLeft - 1;
      if (remaining <= 0) {
        krasue.aiHeld = false;
        this.swarmSpawnGrace.delete(krasue);
      } else {
        this.swarmSpawnGrace.set(krasue, remaining);
      }
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
    this.grantOwedEvidence(ctx);
    this.partyLevel = partyLevelOf(ctx.human.level, ctx.cat.level);
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
        // Entry-idempotent: a scene rebuild mid-attack resumes the wave rather
        // than restarting it — `spawnNightSwarm` reads how many are already
        // owed dead from `progress.swarmKrasueDefeated`.
        if (!this.swarmStarted && !this.dialog.isOpen) {
          this.swarmStarted = true;
          if (this.overworldMusic) this.overworldMusic.battleMusicActive = true;
          if (this.audio && this.audio.currentMusicId !== 'defense_quest_music') {
            this.audio.playMusic('defense_quest_music', { fadeInMs: BATTLE_MUSIC_FADE_IN_MS });
          }
          this.spawnNightSwarm(ctx.active);
          break;
        }
        this.tickSwarmSpawnGrace();
        // Recorded every frame rather than only on a kill event: this class has
        // no death callback, only the `.isAlive` polling every mob system here
        // already uses, so the running count is the cheapest correct source.
        this.progress.swarmKrasueDefeated =
          this.swarmDefeatedBaseline + this.swarm.filter((mob) => !mob.isAlive).length;
        if (this.swarmSpawnQueue.length > 0) {
          this.fillSwarmSpawns(ctx.active);
        }
        if (
          this.swarmSpawnQueue.length === 0 &&
          this.swarm.length > 0 &&
          this.swarm.every((m) => !m.isAlive)
        ) {
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
          this.dialog.open(TAUNT_AND_NIGHTFALL_DIALOG, () => this.beginNightAttack());
        }
        break;
      case 'gumgum_waiting':
      case 'cult_hideout':
      case 'lich_confrontation':
      case 'complete':
        break;
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  /**
   * Whether the gore the krasue left at each clue is on the ground yet.
   *
   * It goes down when the investigation opens and never comes up again —
   * evidence does not evaporate once it has been read, so a found clue keeps its
   * scene and loses only the glow and the arrow that were asking to be noticed.
   *
   * `'complete'` is also the phase forced on construction when `gumgumTile`
   * couldn't be resolved, meaning the quest never started at all — that case
   * must not be confused with a genuinely finished quest, so it's gated on
   * `gumgumTile` rather than trusting the phase alone.
   */
  private get cluePropsVisible(): boolean {
    switch (this.phase) {
      case 'gumgum_waiting':
      case 'body_waiting':
        return false;
      case 'investigation':
      case 'night_attack':
      case 'cult_hideout':
      case 'confrontation':
      case 'lich_confrontation':
      case 'awaiting_rewards':
        return true;
      case 'complete':
        return this.gumgumTile !== null;
    }
  }

  /** World-space rendering: corpse and clue props, attention effects, and prompts. */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, active: Player): void {
    // The corpse stays in the alley from discovery until the mystery is solved.
    if (
      this.alleyTile &&
      (this.phase === 'body_waiting' ||
        this.phase === 'investigation' ||
        this.phase === 'night_attack' ||
        this.phase === 'cult_hideout' ||
        this.phase === 'confrontation' ||
        this.phase === 'lich_confrontation')
    ) {
      drawGumGumCorpse(
        ctx,
        this.alleyTile.x * TILE_SIZE - camX,
        this.alleyTile.y * TILE_SIZE - camY,
        TILE_SIZE,
      );
    }

    if (this.cluePropsVisible) {
      // The well clue is drawn separately by `renderWellClueOverlay`, after
      // the well's own sprite has painted, instead of here.
      for (const clue of this.clues) {
        if (clue.id === WELL_CLUE_ID) continue;
        this.renderClueProp(ctx, camX, camY, clue);
      }
    }

    if (this.dialog.isOpen) return;

    if (this.phase === 'gumgum_waiting' && this.gumgum && this.gumgumTile) {
      if (this.distToTile(active, this.gumgumTile) <= TILE_SIZE * INTERACT_RANGE_TILES) {
        drawInteractionPrompt(ctx, this.gumgum.x - camX, this.gumgum.y - camY, TILE_SIZE, 'Talk');
      }
    }

    if (this.phase === 'investigation') {
      for (const clue of this.clues) {
        if (clue.id === WELL_CLUE_ID) continue;
        this.renderClueAttention(ctx, camX, camY, active, clue);
      }
    }
  }

  /**
   * Repaints the well clue's prop, glow, arrow, and prompt on top of the
   * well's own sprite. The scene calls this after `RenderPipeline.renderEntities`
   * runs (the Y-sorted pass that draws the well) — see the `WELL_CLUE_ID`
   * comment for why the well clue can't just render in the main `render()`
   * pass like the other two.
   */
  renderWellClueOverlay(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: Player,
  ): void {
    const clue = this.clues.find((candidate) => candidate.id === WELL_CLUE_ID);
    if (!clue) return;

    if (this.cluePropsVisible) this.renderClueProp(ctx, camX, camY, clue);
    if (this.dialog.isOpen) return;
    if (this.phase === 'investigation') this.renderClueAttention(ctx, camX, camY, active, clue);
  }

  private renderClueProp(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    clue: CluePoint,
  ): void {
    clue.drawProp(ctx, clue.tile.x * TILE_SIZE - camX, clue.tile.y * TILE_SIZE - camY, TILE_SIZE);
  }

  /** Glow pulse, bouncing arrow, and interact prompt for one unfound investigation-phase clue. */
  private renderClueAttention(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: Player,
    clue: CluePoint,
  ): void {
    if (this.isClueFound(clue.id)) return;

    const pulse =
      CLUE_GLOW_ALPHA_BASE + Math.sin(Date.now() / CLUE_GLOW_PULSE_MS) * CLUE_GLOW_ALPHA_PULSE;
    const glowAlpha =
      Math.round(Math.max(0, pulse) * CLUE_GLOW_ALPHA_STEPS) / CLUE_GLOW_ALPHA_STEPS;
    const glowStops = [
      { offset: 0, color: `rgba(${CLUE_GLOW_RGB}, ${glowAlpha})` },
      { offset: 1, color: `rgba(${CLUE_GLOW_RGB}, 0)` },
    ];

    const worldX = clue.tile.x * TILE_SIZE;
    const worldY = clue.tile.y * TILE_SIZE;
    const sx = worldX - camX;
    const sy = worldY - camY;
    drawRadialGlow(
      ctx,
      sx + TILE_SIZE / 2,
      sy + TILE_SIZE / 2,
      TILE_SIZE * CLUE_GLOW_RADIUS_TILES,
      glowStops,
      CLUE_GLOW_CORE_FRACTION,
    );
    const distance = this.distToTile(active, clue.tile);
    if (distance <= TILE_SIZE * CLUE_ARROW_RANGE_TILES) {
      drawBouncingArrowAboveEntity(
        ctx,
        worldX,
        worldY,
        camX,
        camY,
        CLUE_ARROW_COLOR,
        CLUE_ARROW_OUTLINE_COLOR,
      );
    }
    if (distance <= TILE_SIZE * CLUE_INTERACT_RANGE_TILES) {
      drawInteractionPrompt(ctx, sx, sy, TILE_SIZE, 'Investigate');
    }
  }

  renderUI(ctx: CanvasRenderingContext2D): void {
    this.dialog.render(ctx);
    drawQuestBanner(ctx, this.bannerText, this.bannerTimer, '#f47c7c', '#6a2a2a');
    drawQuestCompleteOverlay(ctx, 'THE KRASUE MURDERS — SOLVED', this.completeOverlayTimer);
  }
}
