/**
 * Blackwood Lodge's cellar lid, held against what comes up the old cistern.
 *
 * The elves the town blames for the missing cats were never down there to
 * fight: they came up the lid because ruins ghouls and krasue were coming up
 * behind them. The party holds the lid with them through
 * {@link LODGE_CELLAR_WAVE_COUNT} waves, every one of them up through the one
 * breach. The elves stand on the party's side for the whole fight and cannot
 * be killed: beaten down, they keep their feet at one hit point.
 *
 * An `InteriorEncounter` on the lodge's only storey, built by
 * `BuildingInteriorScene.startEncounter`. Every wave held is written straight
 * into `MissingCatsProgress`, so a party that walks out (or dies and returns
 * to a save made after it) resumes at the next wave rather than the first.
 */

import { TILE_SIZE } from '../../core/constants';
import { applySpawnDifficulty } from '../../core/difficulty/difficultyProfiles';
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
import { objectiveBandEntry } from '../../ui/hud/objectiveLine';
import { QUEST_BANNER_FRAMES, questBannerEntry } from '../../ui/QuestBanners';
import type { TopBandEntry } from '../../ui/hud/topBand';
import type { SystemContext } from '../GameSystem';
import { distinctSpawnTiles } from '../interiorSpawnTiles';
import { questMobLevel } from '../questMobLevel';
import { playMissingCatsCue } from './missingCatsSoundCues';
import type { AudioManager } from '../../audio/AudioManager';

const ENCOUNTER = 'quest:lodge-cellar' as const;

/** The level the cellar's fight is authored at, lifted toward the party's by `questMobLevel`. */
const CELLAR_MOB_LEVEL = 6;
/** The elves who came up the lid and hold it with the party. */
const ELF_COUNT = 3;
/** What comes up the cistern. */
type CellarMobKind = 'ruins_ghoul' | 'krasue';

/** Each wave, in order: what comes up the lid. One entry per wave the questline counts. */
const CELLAR_WAVES = [
  ['ruins_ghoul', 'ruins_ghoul', 'ruins_ghoul'],
  ['ruins_ghoul', 'ruins_ghoul', 'ruins_ghoul', 'krasue'],
  ['ruins_ghoul', 'ruins_ghoul', 'krasue', 'krasue'],
] as const satisfies readonly (readonly CellarMobKind[])[] & {
  readonly length: typeof LODGE_CELLAR_WAVE_COUNT;
};
/** A breather between waves, so the next one comes up the lid rather than on top of the last. */
const WAVE_GAP_FRAMES = 150;
/** How far round the lid a wave and the elves are placed, in tiles. */
const LID_SPAWN_RADIUS_TILES = 2;
/** The elves stand back from the lid, between it and the door. */
const ELF_STAND_OFFSET_TILES = 2;
/** How far an elf reaches for something to fight. */
const ELF_AGGRO_TILES = 7;
/** With nothing to fight, an elf keeps within this of the lid. */
const ELF_RALLY_TILES = 3;
const HALF_TILE = TILE_SIZE / 2;
/** The party mark floats this far above the top of an elf's tile. */
const MARKER_LIFT_TILES = 0.35;

export interface LodgeCellarDefenceDeps {
  readonly map: GameMap;
  readonly progress: MissingCatsProgress;
  readonly addMob: (mob: Mob) => void;
  readonly partyLevel: number;
  /** Who the elves are fighting for: their kills are credited to this crawler. */
  readonly owner: Player;
  /** The tile of the cellar lid, the one breach. */
  readonly lid: TilePoint;
  readonly audio: AudioManager | null;
  /** Called once, the frame the last wave is down. */
  readonly onHeld: () => void;
}

export class LodgeCellarDefence {
  readonly defeatMessage =
    'The creatures from the cistern broke through the cellar lid. Nobody at Blackwood Lodge ever learned who had tried to hold it.';

  private readonly elves: Mob[] = [];
  private wave: Mob[] = [];
  private gapFrames = 0;
  private bannerFrames = QUEST_BANNER_FRAMES;
  private held = false;
  private readonly lidAnchor: AllyRallyAnchor;

  constructor(private readonly deps: LodgeCellarDefenceDeps) {
    this.lidAnchor = { x: deps.lid.x * TILE_SIZE, y: deps.lid.y * TILE_SIZE, isAlive: true };
    playMissingCatsCue(deps.audio, 'cellarLidOpen', {
      x: deps.lid.x * TILE_SIZE,
      y: deps.lid.y * TILE_SIZE,
    });
    this.standElvesUp();
    this.raiseWave();
  }

  /** The elves, for the scene's list of what the hostiles may fight. */
  allyTargets(): readonly Player[] {
    return this.elves.filter((elf) => elf.isAlive);
  }

  private standElvesUp(): void {
    const { map, lid } = this.deps;
    const wanted = Array.from({ length: ELF_COUNT }, (_unused, index) => ({
      x: lid.x + index - Math.floor(ELF_COUNT / 2),
      y: lid.y + ELF_STAND_OFFSET_TILES,
    }));
    for (const tile of distinctSpawnTiles(map, wanted, LID_SPAWN_RADIUS_TILES)) {
      const elf = spawnMob('elf', tile, map, liveSpawnContext(ENCOUNTER));
      elf.applyMobLevel(questMobLevel(CELLAR_MOB_LEVEL, this.deps.partyLevel));
      applySpawnDifficulty(elf);
      elf.cannotBeKilled = true;
      this.deps.addMob(elf);
      elf.convertToAlly(this.deps.owner);
      elf.allyRally = { anchor: this.lidAnchor, radiusPx: ELF_RALLY_TILES * TILE_SIZE };
      this.elves.push(elf);
    }
  }

  private raiseWave(): void {
    const waves: readonly (readonly CellarMobKind[])[] = CELLAR_WAVES;
    if (this.deps.progress.cellarWavesHeld >= waves.length) return;
    const kinds = waves[this.deps.progress.cellarWavesHeld];
    const { map, lid } = this.deps;
    const wanted = kinds.map(() => lid);
    const tiles = distinctSpawnTiles(map, wanted, LID_SPAWN_RADIUS_TILES);
    const level = questMobLevel(CELLAR_MOB_LEVEL, this.deps.partyLevel);
    this.wave = [];
    tiles.forEach((tile, index) => {
      if (index >= kinds.length) return;
      const kind = kinds[index];
      const mob = spawnMob(kind, tile, map, liveSpawnContext(ENCOUNTER));
      mob.applyMobLevel(level);
      applySpawnDifficulty(mob);
      mob.forceAggro = true;
      this.deps.addMob(mob);
      this.wave.push(mob);
    });
  }

  update(_ctx: SystemContext): void {
    if (this.bannerFrames > 0) this.bannerFrames--;
    for (const elf of this.elves) this.chooseTarget(elf);
    if (this.held) return;
    if (this.wave.some((mob) => mob.isAlive)) return;
    // A wave the lid had no room to stand up counts as held, so the fight always ends.
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
    if (this.gapFrames > 0) {
      this.gapFrames--;
      if (this.gapFrames === 0) this.raiseWave();
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

  renderEffects(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
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
          text: `Hold the cellar lid with the elves — wave ${wave} of ${LODGE_CELLAR_WAVE_COUNT}`,
          tone: 'warning',
        }),
      );
    }
    return entries;
  }
}
