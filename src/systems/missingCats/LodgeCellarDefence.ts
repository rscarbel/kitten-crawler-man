/**
 * Blackwood Lodge's cellar, held against what climbs the old cistern.
 *
 * Kessler opened the lid looking for elves. What comes up the shaft is ruins
 * ghouls and krasue out of the deep cistern, one at a time up the iron rungs
 * and out over the lip, through {@link LODGE_CELLAR_WAVE_COUNT} waves. The
 * elves live in the drains and knew what that lid kept down; with the shaft
 * full of ghouls between them and it, they come round by the alley drain and
 * in at the lodge's front door, a little after the first ghoul is out, and
 * hold the hole beside the party. They cannot be killed: beaten down, they
 * keep their feet at one hit point.
 *
 * An `InteriorEncounter` on the lodge's only storey, built by
 * `BuildingInteriorScene.startEncounter`. Every wave held is written straight
 * into `MissingCatsProgress`, so a party that walks out (or dies and returns
 * to a save made after it) resumes at the next wave rather than the first,
 * and finds the elves already at the hole.
 */

import { TILE_SIZE } from '../../core/constants';
import { applySpawnDifficulty } from '../../core/difficulty/difficultyProfiles';
import type { Camera } from '../../core/rendering/camera';
import type { InteriorFigure } from '../../core/rendering/InteriorFigure';
import {
  LODGE_CELLAR_WAVE_COUNT,
  lodgeCellarHeld,
  type MissingCatsProgress,
} from '../../core/quests/missingCatsProgress';
import type { AllyRallyAnchor, Mob } from '../../creatures/Mob';
import { liveSpawnContext, spawnMob } from '../../levels/spawnFunnel';
import type { GameMap } from '../../map/GameMap';
import type { TilePoint } from '../../map/town/townPlan';
import type { Player } from '../../Player';
import { drawPartyMarker } from '../../sprites/art/siegeEffectsArt';
import { cellarHatchOpening } from '../../sprites/art/townInterior/rooms/cellarHatch';
import { TOWN_INTERIOR_PROPS } from '../../sprites/art/townInterior/townInteriorProps';
import { objectiveBandEntry } from '../../ui/hud/objectiveLine';
import { QUEST_BANNER_FRAMES, questBannerEntry } from '../../ui/QuestBanners';
import type { TopBandEntry } from '../../ui/hud/topBand';
import type { SystemContext } from '../GameSystem';
import { distinctSpawnTiles } from '../interiorSpawnTiles';
import { questMobLevel } from '../questMobLevel';
import { playMissingCatsCue } from '../../audio/missingCatsSoundCues';
import type { AudioManager } from '../../audio/AudioManager';

const ENCOUNTER = 'quest:lodge-cellar' as const;

/** The level the cellar's fight is authored at, lifted toward the party's by `questMobLevel`. */
const CELLAR_MOB_LEVEL = 6;
/** The elves who come in from the alley and hold the hole with the party. */
const ELF_COUNT = 3;
/** What comes up the cistern. */
type CellarMobKind = 'ruins_ghoul' | 'krasue';

/** Each wave, in order: what comes up the shaft. One entry per wave the questline counts. */
const CELLAR_WAVES = [
  ['ruins_ghoul', 'ruins_ghoul', 'ruins_ghoul'],
  ['ruins_ghoul', 'ruins_ghoul', 'ruins_ghoul', 'krasue'],
  ['ruins_ghoul', 'ruins_ghoul', 'krasue', 'krasue'],
] as const satisfies readonly (readonly CellarMobKind[])[] & {
  readonly length: typeof LODGE_CELLAR_WAVE_COUNT;
};
/** A breather between waves, so the next one comes up the shaft rather than on top of the last. */
const WAVE_GAP_FRAMES = 150;
/** One climber reaches the lip this long after the one before. */
const CLIMB_STAGGER_FRAMES = 40;
/** Rising out of the well, from the head breaking the lip to the feet on it. */
const CLIMB_RISE_FRAMES = 36;
/** Then the step off the lip onto the floor. */
const CLIMB_STEP_FRAMES = 12;
/** How far below the lip a climber's feet start, in tiles: deep enough that only the dark shows. */
const CLIMB_DEPTH_TILES = 1.4;
/** The window a rising climber is drawn through: wide and tall enough for any of them, cut at the lip. */
const CLIP_HEADROOM_TILES = 3;
const CLIP_WIDTH_TILES = 3;
/** Climbers come out spread along the lip rather than all from its middle. */
const CLIMB_SPREAD_TILES = 0.35;
/** Where climbers step off the lip: the row south of the hatch's footprint, from its north-west tile. */
const LANDING_ROW_DY = 3;
const HATCH_COLUMNS = TOWN_INTERIOR_PROPS.cellar_trapdoor.footprint.w;
const HATCH_MIDDLE_DX = (HATCH_COLUMNS - 1) / 2;
/** The footprint's columns, the middle ones first, so climbers land straight off the lip before they spread. */
const LANDING_COLUMNS_DX = Array.from({ length: HATCH_COLUMNS }, (_unused, dx) => dx).sort(
  (a, b) => Math.abs(a - HATCH_MIDDLE_DX) - Math.abs(b - HATCH_MIDDLE_DX),
);
/** How far round a landing or an elf's post a free tile is looked for. */
const SPAWN_SEARCH_TILES = 2;
/** The elves reach the door this long after the lid opens: long enough for the first ghoul to be out. */
const ELVES_ARRIVE_AFTER_FRAMES = 150;
/** One elf through the door after another. */
const ELF_ENTRY_GAP_FRAMES = 16;
/** On a resumed visit the elves are already at the hole, standing this far south of the footprint's north-west tile. */
const ELF_POST_DY = 3;
/** How far an elf reaches for something to fight. */
const ELF_AGGRO_TILES = 7;
/** With nothing to fight, an elf keeps within this of the hole. */
const ELF_RALLY_TILES = 3;
const HALF_TILE = TILE_SIZE / 2;
/** The party mark floats this far above the top of an elf's tile. */
const MARKER_LIFT_TILES = 0.35;

/** How the room came to have its fight: the lid lifted in front of the party, or a visit back to one already under way. */
export type LodgeCellarStart = 'lid_just_opened' | 'resumed';

export interface LodgeCellarDefenceDeps {
  readonly map: GameMap;
  readonly progress: MissingCatsProgress;
  readonly addMob: (mob: Mob) => void;
  readonly partyLevel: number;
  /** Who the elves are fighting for: their kills are credited to this crawler. */
  readonly owner: Player;
  /** The cellar hatch prop's north-west tile. */
  readonly lid: TilePoint;
  readonly start: LodgeCellarStart;
  readonly audio: AudioManager | null;
  /** Called once, when the last elf is through the door on a visit that watched them come in. */
  readonly onElvesArrived: () => void;
  /** Called once, the frame the last wave is down. */
  readonly onHeld: () => void;
}

/** A creature on its way up the rungs, not yet in the room's roster. */
interface Climber {
  readonly mob: Mob;
  readonly fromX: number;
  readonly landing: TilePoint;
  frames: number;
}

export class LodgeCellarDefence {
  readonly defeatMessage =
    'The ghouls from the deep cistern got out past the cellar lid. Nobody at Blackwood Lodge ever learned who had tried to hold it.';

  private readonly elves: Mob[] = [];
  private wave: Mob[] = [];
  /** What is still below, in the order it reaches the lip. */
  private queued: CellarMobKind[] = [];
  private readonly climbers: Climber[] = [];
  private climbCountdown = 0;
  private gapFrames = 0;
  private bannerFrames = QUEST_BANNER_FRAMES;
  private held = false;
  /** Frames until the elves reach the door; null once they are in, or on a visit they were already here for. */
  private elvesDueIn: number | null;
  private elvesThroughDoor = 0;
  private elfEntryCountdown = 0;
  private readonly lidAnchor: AllyRallyAnchor;
  /** The well's south lip, in world pixels: a climber is hidden below it. */
  private readonly lipY: number;
  private readonly wellCentreX: number;

  constructor(private readonly deps: LodgeCellarDefenceDeps) {
    const opening = cellarHatchOpening(deps.lid.x * TILE_SIZE, deps.lid.y * TILE_SIZE, TILE_SIZE);
    this.lipY = opening.bottom;
    this.wellCentreX = (opening.left + opening.right) / 2;
    this.lidAnchor = {
      x: this.wellCentreX - HALF_TILE,
      y: (opening.top + opening.bottom) / 2,
      isAlive: true,
    };
    if (deps.start === 'resumed') {
      this.elvesDueIn = null;
      this.standElvesAtTheHole();
    } else {
      this.elvesDueIn = ELVES_ARRIVE_AFTER_FRAMES;
    }
    this.raiseWave();
  }

  /** The elves, for the scene's list of what the hostiles may fight. */
  allyTargets(): readonly Player[] {
    return this.elves.filter((elf) => elf.isAlive);
  }

  private standElvesAtTheHole(): void {
    const { lid } = this.deps;
    const posts = Array.from({ length: ELF_COUNT }, (_unused, index) => ({
      x: lid.x + index,
      y: lid.y + ELF_POST_DY,
    }));
    for (const tile of distinctSpawnTiles(this.deps.map, posts, SPAWN_SEARCH_TILES)) {
      this.enlistElf(tile);
    }
  }

  /** One elf in at the front door, on whichever door tile is free. */
  private elfThroughTheDoor(): void {
    const { map } = this.deps;
    const door = map._interiorExitTiles;
    const wanted = door.length > 0 ? door[this.elvesThroughDoor % door.length] : map.startTile;
    const free = distinctSpawnTiles(map, [wanted], SPAWN_SEARCH_TILES);
    if (this.elvesThroughDoor === 0) {
      playMissingCatsCue(this.deps.audio, 'lodgeDoorBurst', {
        x: wanted.x * TILE_SIZE,
        y: wanted.y * TILE_SIZE,
      });
    }
    this.elvesThroughDoor++;
    if (free.length > 0) this.enlistElf(free[0]);
  }

  private enlistElf(tile: TilePoint): void {
    const elf = spawnMob('elf', tile, this.deps.map, liveSpawnContext(ENCOUNTER));
    elf.applyMobLevel(questMobLevel(CELLAR_MOB_LEVEL, this.deps.partyLevel));
    applySpawnDifficulty(elf);
    elf.cannotBeKilled = true;
    this.deps.addMob(elf);
    elf.convertToAlly(this.deps.owner);
    elf.allyRally = { anchor: this.lidAnchor, radiusPx: ELF_RALLY_TILES * TILE_SIZE };
    this.elves.push(elf);
  }

  private raiseWave(): void {
    const waves: readonly (readonly CellarMobKind[])[] = CELLAR_WAVES;
    if (this.deps.progress.cellarWavesHeld >= waves.length) return;
    this.wave = [];
    this.queued = [...waves[this.deps.progress.cellarWavesHeld]];
    this.climbCountdown = 0;
  }

  /** Sets the next creature off up the rungs, toward a free tile off the south lip. */
  private startClimber(kind: CellarMobKind): void {
    const { map, lid } = this.deps;
    const claimed = new Set(this.climbers.map((c) => `${c.landing.x},${c.landing.y}`));
    const wanted = LANDING_COLUMNS_DX.map((dx) => ({ x: lid.x + dx, y: lid.y + LANDING_ROW_DY }));
    const free = distinctSpawnTiles(
      map,
      wanted,
      SPAWN_SEARCH_TILES,
      (x, y) => !claimed.has(`${x},${y}`),
    );
    if (free.length === 0) return;
    const landing = free[0];
    const mob = spawnMob(kind, landing, map, liveSpawnContext(ENCOUNTER));
    mob.applyMobLevel(questMobLevel(CELLAR_MOB_LEVEL, this.deps.partyLevel));
    applySpawnDifficulty(mob);
    mob.forceAggro = true;
    mob.facingX = 0;
    mob.facingY = 1;
    const spread = (this.climbers.length % 2 === 0 ? -1 : 1) * CLIMB_SPREAD_TILES * TILE_SIZE;
    this.climbers.push({ mob, fromX: this.wellCentreX - HALF_TILE + spread, landing, frames: 0 });
    playMissingCatsCue(this.deps.audio, 'cellarClimb', { x: this.wellCentreX, y: this.lipY });
  }

  update(_ctx: SystemContext): void {
    if (this.bannerFrames > 0) this.bannerFrames--;
    this.bringElvesIn();
    this.climb();
    for (const elf of this.elves) this.chooseTarget(elf);
    if (this.held) return;
    if (this.waveStillComing()) return;
    if (this.gapFrames === 0) {
      this.deps.progress.cellarWavesHeld++;
      this.wave = [];
      if (lodgeCellarHeld(this.deps.progress)) {
        this.held = true;
        this.bannerFrames = QUEST_BANNER_FRAMES;
        this.deps.onHeld();
        return;
      }
      this.gapFrames = WAVE_GAP_FRAMES;
      return;
    }
    this.gapFrames--;
    if (this.gapFrames === 0) this.raiseWave();
  }

  /** Whether any of this wave is alive, on the rungs or still below. */
  private waveStillComing(): boolean {
    return (
      this.queued.length > 0 || this.climbers.length > 0 || this.wave.some((mob) => mob.isAlive)
    );
  }

  private bringElvesIn(): void {
    if (this.elvesDueIn === null) return;
    if (this.elvesDueIn > 0) {
      this.elvesDueIn--;
      return;
    }
    if (this.elfEntryCountdown > 0) {
      this.elfEntryCountdown--;
      return;
    }
    this.elfThroughTheDoor();
    this.elfEntryCountdown = ELF_ENTRY_GAP_FRAMES;
    if (this.elvesThroughDoor >= ELF_COUNT) {
      this.elvesDueIn = null;
      this.deps.onElvesArrived();
    }
  }

  /** Starts the next climber when its turn comes, and lets each one out onto the floor once it is up. */
  private climb(): void {
    if (this.queued.length > 0) {
      if (this.climbCountdown > 0) this.climbCountdown--;
      else {
        const [next, ...rest] = this.queued;
        this.queued = rest;
        this.startClimber(next);
        this.climbCountdown = CLIMB_STAGGER_FRAMES;
      }
    }
    for (const climber of [...this.climbers]) {
      climber.frames++;
      if (climber.frames < CLIMB_RISE_FRAMES + CLIMB_STEP_FRAMES) continue;
      this.climbers.splice(this.climbers.indexOf(climber), 1);
      climber.mob.x = climber.landing.x * TILE_SIZE;
      climber.mob.y = climber.landing.y * TILE_SIZE;
      this.deps.addMob(climber.mob);
      this.wave.push(climber.mob);
    }
  }

  /** The nearest hostile in reach, as an elf's only target, or none. */
  private chooseTarget(elf: Mob): void {
    const targets = elf.allyTargets;
    targets.length = 0;
    if (!elf.isAlive) return;
    const reach = ELF_AGGRO_TILES * TILE_SIZE;
    let nearest: Mob | null = null;
    let nearestDistance = reach;
    for (const mob of this.wave) {
      if (!mob.isHostileTarget) continue;
      const distance = Math.hypot(mob.x - elf.x, mob.y - elf.y);
      if (distance < nearestDistance) {
        nearest = mob;
        nearestDistance = distance;
      }
    }
    if (nearest !== null) targets.push(nearest);
  }

  /**
   * The creatures on the rungs, in the room's depth-sorted pass: rising out
   * of the well with everything below the south lip hidden, then stepping
   * off it onto the floor.
   */
  roomFigures(_camera: Camera): readonly InteriorFigure[] {
    return this.climbers.map((climber) => {
      const { mob, fromX, landing, frames } = climber;
      const standingOnLipY = this.lipY - TILE_SIZE;
      const rising = frames < CLIMB_RISE_FRAMES;
      const rise = Math.min(1, frames / CLIMB_RISE_FRAMES);
      const step = rising ? 0 : (frames - CLIMB_RISE_FRAMES) / CLIMB_STEP_FRAMES;
      const landingX = landing.x * TILE_SIZE;
      const landingY = landing.y * TILE_SIZE;
      const x = fromX + (landingX - fromX) * step;
      const y = rising
        ? standingOnLipY + (1 - rise) * CLIMB_DEPTH_TILES * TILE_SIZE
        : standingOnLipY + (landingY - standingOnLipY) * step;
      return {
        // Rising, its feet are on the lip whatever the drawing shows: anyone
        // standing south of the hatch is in front of it.
        y: rising ? standingOnLipY : y,
        render: (ctx, camX, camY, tileSize) => {
          mob.x = x;
          mob.y = y;
          ctx.save();
          if (rising) {
            ctx.beginPath();
            const headroom = tileSize * CLIP_HEADROOM_TILES;
            ctx.rect(
              x - camX - tileSize,
              y - camY - headroom,
              tileSize * CLIP_WIDTH_TILES,
              this.lipY - y + headroom,
            );
            ctx.clip();
          }
          mob.render(ctx, camX, camY, tileSize);
          ctx.restore();
        },
      };
    });
  }

  renderEffects(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const { x: camX, y: camY } = camera;
    for (const elf of this.elves) {
      if (!elf.isAlive) continue;
      drawPartyMarker(ctx, elf.x + HALF_TILE - camX, elf.y - MARKER_LIFT_TILES * TILE_SIZE - camY);
    }
  }

  topBandEntries(): TopBandEntry[] {
    const entries: TopBandEntry[] = [];
    const banner = questBannerEntry({
      id: 'lodge-cellar-banner',
      title: this.held ? 'THE CELLAR HOLDS' : 'HOLD THE CELLAR',
      framesLeft: this.bannerFrames,
      tone: this.held ? 'success' : 'danger',
    });
    if (banner !== null) entries.push(banner);
    if (!this.held) {
      const wave = Math.min(this.deps.progress.cellarWavesHeld + 1, LODGE_CELLAR_WAVE_COUNT);
      entries.push(
        objectiveBandEntry('lodge-cellar-objective', {
          text: `Hold the cellar lid — wave ${wave} of ${LODGE_CELLAR_WAVE_COUNT}`,
          tone: 'warning',
        }),
      );
    }
    return entries;
  }
}
