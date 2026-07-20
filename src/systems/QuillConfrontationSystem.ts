/**
 * QuillConfrontationSystem — the finale of "The Krasue Murders", fought in
 * the magistrate's office at the top of the Town Center Tower. Miss Quill is
 * untouchable while Remex, her husband-turned-soul-capacitor, still stands;
 * she answers every intrusion with soul bolts and summoned krasue. Owned by
 * BuildingInteriorScene (top floor only); quest state crosses scenes via
 * MurderQuestProgress.
 */

import { TILE_SIZE } from '../core/constants';
import type { GameMap } from '../map/GameMap';
import type { EventBus } from '../core/EventBus';
import type { AudioManager } from '../audio/AudioManager';
import type { GameSystem, SystemContext } from './GameSystem';
import type { Mob } from '../creatures/Mob';
import type { MurderQuestProgress } from '../core/MurderQuestProgress';
import { findNearbyWalkableTile } from '../map/findWalkableTile';
import { MissQuill } from '../creatures/MissQuill';
import { Remex } from '../creatures/Remex';
import { CityElfCultist } from '../creatures/CityElfCultist';
import { drawText } from '../ui/TextBox';
import { drawProgressBar, PROGRESS_PRESETS } from '../ui/Box';
import { drawQuestBanner, QUEST_BANNER_FRAMES } from '../ui/QuestBanners';

const SPAWN_SEARCH_RADIUS_TILES = 6;
/** Quill holds the far end of the office from the stairs. */
const QUILL_OFFSET = { dx: 0, dy: -2 };
const REMEX_OFFSET = { dx: 4, dy: -2 };
const GUARD_OFFSETS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: -3, dy: 1 },
  { dx: 3, dy: 1 },
];
const GUARD_LEVEL = 7;

const BOSS_BAR_WIDTH = 320;
const BOSS_BAR_HEIGHT = 14;
const BOSS_BAR_Y = 40;
const BOSS_BAR_LABEL_Y = 22;
const BOSS_BAR_LABEL_SIZE = 12;
const OBJECTIVE_Y_FROM_BOTTOM = 96;
const OBJECTIVE_SIZE = 13;

const FRAMES_PER_SECOND = 60;
const VICTORY_BANNER_SECONDS = 8;
const VICTORY_BANNER_FRAMES = VICTORY_BANNER_SECONDS * FRAMES_PER_SECOND;
const VICTORY_GLOW_BLUR = 12;
const BANNER_SUBTITLE_Y = 104;
const BANNER_SUBTITLE_SIZE = 13;
const VICTORY_TITLE_SIZE = 26;
const VICTORY_SUBTITLE_SIZE = 13;
const VICTORY_TITLE_Y_OFFSET = 30;
const VICTORY_SUBTITLE_Y_OFFSET = 8;
const BANNER_FADE_FRAMES = 60;
const BOSS_MUSIC_FADE_IN_MS = 1500;
const VICTORY_MUSIC_FADE_IN_MS = 2000;

export class QuillConfrontationSystem implements GameSystem {
  /** Shown by BuildingInteriorScene if the players fall here. */
  readonly defeatMessage = 'Miss Quill filed your souls under K.';

  private quill: MissQuill | null = null;
  private remex: Remex | null = null;
  private bannerTimer = QUEST_BANNER_FRAMES;
  private victoryTimer = 0;
  private victoryHandled = false;

  constructor(
    private readonly map: GameMap,
    private readonly bus: EventBus,
    private readonly addMob: (mob: Mob) => void,
    private readonly progress: MurderQuestProgress,
    private readonly audio: AudioManager | null,
  ) {
    this.spawnEncounter();
    this.bus.emit('bossFightInitiated', { bossType: 'miss_quill' });
    this.audio?.playMusic('boss_music_3', { fadeInMs: BOSS_MUSIC_FADE_IN_MS });
  }

  private findSpawnTile(tileX: number, tileY: number): { x: number; y: number } | null {
    return findNearbyWalkableTile(this.map, tileX, tileY, SPAWN_SEARCH_RADIUS_TILES);
  }

  private spawnEncounter(): void {
    const centreY = Math.floor(this.map.structure.length / 2);
    const centreX = Math.floor((this.map.structure[0]?.length ?? 0) / 2);

    const remexTile = this.findSpawnTile(centreX + REMEX_OFFSET.dx, centreY + REMEX_OFFSET.dy);
    if (remexTile) {
      const remex = new Remex(remexTile.x, remexTile.y, TILE_SIZE);
      remex.setMap(this.map);
      this.addMob(remex);
      this.remex = remex;
    }

    const quillTile = this.findSpawnTile(centreX + QUILL_OFFSET.dx, centreY + QUILL_OFFSET.dy);
    if (quillTile) {
      const quill = new MissQuill(quillTile.x, quillTile.y, TILE_SIZE, this.addMob);
      quill.setMap(this.map);
      if (this.remex) quill.setCapacitor(this.remex);
      this.addMob(quill);
      this.quill = quill;
    }

    for (const { dx, dy } of GUARD_OFFSETS) {
      const tile = this.findSpawnTile(centreX + dx, centreY + dy);
      if (!tile) continue;
      const guard = new CityElfCultist(tile.x, tile.y, TILE_SIZE);
      guard.setMap(this.map);
      guard.applyMobLevel(GUARD_LEVEL);
      this.addMob(guard);
    }
  }

  update(_ctx: SystemContext): void {
    if (this.bannerTimer > 0) this.bannerTimer--;
    if (this.victoryTimer > 0) this.victoryTimer--;

    const quill = this.quill;
    if (!quill) return;

    if (!quill.isAlive && !this.victoryHandled) {
      this.victoryHandled = true;
      this.progress.stage = 'quill_slain';
      this.victoryTimer = VICTORY_BANNER_FRAMES;
      this.bus.emit('bossDefeated', { bossType: 'miss_quill', mob: quill });
      this.audio?.play('boss_defeated');
      this.audio?.playMusic('village_square', { fadeInMs: VICTORY_MUSIC_FADE_IN_MS });
    }
  }

  renderUI(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const quill = this.quill;
    if (!quill) return;

    if (quill.isAlive) {
      const barX = canvas.width / 2 - BOSS_BAR_WIDTH / 2;
      drawText(ctx, quill.displayName, {
        x: canvas.width / 2,
        y: BOSS_BAR_LABEL_Y,
        size: BOSS_BAR_LABEL_SIZE,
        bold: true,
        color: '#f47c7c',
        align: 'center',
      });
      drawProgressBar(ctx, {
        x: barX,
        y: BOSS_BAR_Y,
        width: BOSS_BAR_WIDTH,
        height: BOSS_BAR_HEIGHT,
        value: quill.hp / quill.maxHp,
        ...PROGRESS_PRESETS.hp,
      });

      const remexAlive = this.remex?.isAlive ?? false;
      drawText(
        ctx,
        remexAlive
          ? 'Destroy Remex — his stored souls shield her'
          : 'The shield is broken — Miss Quill is exposed!',
        {
          x: canvas.width / 2,
          y: canvas.height - OBJECTIVE_Y_FROM_BOTTOM,
          size: OBJECTIVE_SIZE,
          bold: true,
          color: remexAlive ? '#e8d060' : '#a8f070',
          align: 'center',
        },
      );

      if (this.bannerTimer > 0) {
        drawQuestBanner(
          ctx,
          canvas,
          'MISS QUILL — THE HEADMISTRESS',
          this.bannerTimer,
          '#f47c7c',
          '#6a2a2a',
        );
        const alpha =
          this.bannerTimer < BANNER_FADE_FRAMES ? this.bannerTimer / BANNER_FADE_FRAMES : 1;
        drawText(ctx, 'Every krasue in the city was her handiwork', {
          x: canvas.width / 2,
          y: BANNER_SUBTITLE_Y,
          size: BANNER_SUBTITLE_SIZE,
          color: '#f4c7c7',
          align: 'center',
          alpha,
        });
      }
    }

    if (this.victoryTimer > 0) {
      const alpha =
        this.victoryTimer < BANNER_FADE_FRAMES ? this.victoryTimer / BANNER_FADE_FRAMES : 1;
      drawText(ctx, 'THE HEADMISTRESS FALLS', {
        x: canvas.width / 2,
        y: canvas.height / 2 - VICTORY_TITLE_Y_OFFSET,
        size: VICTORY_TITLE_SIZE,
        bold: true,
        color: '#4ade80',
        align: 'center',
        alpha,
        glow: '#4ade80',
        glowBlur: VICTORY_GLOW_BLUR,
      });
      drawText(ctx, 'The murders are over. Return to the streets below.', {
        x: canvas.width / 2,
        y: canvas.height / 2 + VICTORY_SUBTITLE_Y_OFFSET,
        size: VICTORY_SUBTITLE_SIZE,
        color: '#d4edaa',
        align: 'center',
        alpha,
      });
    }
  }
}
