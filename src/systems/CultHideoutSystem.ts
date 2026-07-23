/**
 * CultHideoutSystem — the Blackwood Lodge beat of "The Krasue Murders",
 * fought inside the barracks interior. The cult's nest: clear every city elf
 * cultist to find the letter that names Miss Quill. Owned by
 * BuildingInteriorScene, which supplies the combat stack; quest state
 * crosses scenes via MurderQuestProgress.
 */

import { TILE_SIZE } from '../core/constants';
import type { GameMap } from '../map/GameMap';
import type { EventBus } from '../core/EventBus';
import type { AudioManager } from '../audio/AudioManager';
import type { GameSystem, SystemContext } from './GameSystem';
import type { Mob } from '../creatures/Mob';
import type { MurderQuestProgress } from '../core/MurderQuestProgress';
import { findNearbyWalkableTile } from '../map/findWalkableTile';
import { CityElfCultist } from '../creatures/CityElfCultist';
import { drawText } from '../ui/TextBox';
import { drawQuestBanner, QUEST_BANNER_FRAMES } from '../ui/QuestBanners';

const SPAWN_SEARCH_RADIUS_TILES = 5;
/** The congregation, spread through the barracks hall (offsets from room centre). */
const CULTIST_SPAWN_OFFSETS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: 0, dy: -3 },
  { dx: -3, dy: -1 },
  { dx: 3, dy: -1 },
  { dx: -2, dy: 2 },
  { dx: 2, dy: 2 },
];
const CULTIST_LEVEL = 6;

const OBJECTIVE_Y_FROM_BOTTOM = 96;
const OBJECTIVE_SIZE = 13;

export class CultHideoutSystem implements GameSystem {
  /** Shown by BuildingInteriorScene if the players fall here. */
  readonly defeatMessage = 'The cult added your souls to the harvest.';

  private cultists: CityElfCultist[] = [];
  private bannerTimer = QUEST_BANNER_FRAMES;
  private cleared = false;

  constructor(
    private readonly map: GameMap,
    private readonly bus: EventBus,
    private readonly addMob: (mob: Mob) => void,
    private readonly progress: MurderQuestProgress,
    private readonly audio: AudioManager | null,
  ) {
    this.spawnCultists();
  }

  private spawnCultists(): void {
    const centreY = Math.floor(this.map.structure.length / 2);
    const centreX = Math.floor((this.map.structure[0]?.length ?? 0) / 2);
    for (const { dx, dy } of CULTIST_SPAWN_OFFSETS) {
      const tile = findNearbyWalkableTile(
        this.map,
        centreX + dx,
        centreY + dy,
        SPAWN_SEARCH_RADIUS_TILES,
      );
      if (!tile) continue;
      const cultist = new CityElfCultist(tile.x, tile.y, TILE_SIZE);
      cultist.setMap(this.map);
      cultist.applyMobLevel(CULTIST_LEVEL);
      this.addMob(cultist);
      this.cultists.push(cultist);
    }
  }

  update(_ctx: SystemContext): void {
    if (this.bannerTimer > 0) this.bannerTimer--;
    if (this.cleared) return;
    if (this.cultists.length === 0 || this.cultists.some((c) => c.isAlive)) return;

    this.cleared = true;
    this.progress.stage = 'confrontation';
    this.bus.emit('objectiveComplete', { objectiveId: 'krasue_cult_hideout_cleared' });
    this.audio?.play('objective_complete');
    this.bannerTimer = QUEST_BANNER_FRAMES;
  }

  renderUI(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    drawQuestBanner(
      ctx,
      canvas,
      this.cleared ? 'THE NEST IS CLEANSED' : "THE CULT'S NEST",
      this.bannerTimer,
      '#f47c7c',
      '#6a2a2a',
    );

    const remaining = this.cultists.filter((c) => c.isAlive).length;
    const objective = this.cleared
      ? "A letter names Miss Quill — the magistrate's tower, top floor."
      : `Cleanse the cult — ${remaining} remaining`;
    drawText(ctx, objective, {
      x: canvas.width / 2,
      y: canvas.height - OBJECTIVE_Y_FROM_BOTTOM,
      size: OBJECTIVE_SIZE,
      bold: true,
      color: this.cleared ? '#a8f070' : '#e8d060',
      align: 'center',
    });
  }
}
