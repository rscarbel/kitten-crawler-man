/**
 * CultHideoutSystem — the Blackwood Lodge beat of "The Krasue Murders",
 * fought inside the barracks interior. The cult's nest: clear every city elf
 * cultist to find the letter that names Miss Quill. Owned by
 * BuildingInteriorScene, which supplies the combat stack; quest state
 * crosses scenes via MurderQuestProgress.
 */

import { TILE_SIZE } from '../core/constants';
import { applySpawnDifficulty } from '../core/difficultyProfiles';
import type { GameMap } from '../map/GameMap';
import type { EventBus } from '../core/EventBus';
import type { GameSystem, SystemContext } from './GameSystem';
import type { Mob } from '../creatures/Mob';
import type { MurderQuestProgress } from '../core/MurderQuestProgress';
import { findNearbyWalkableTile } from '../map/findWalkableTile';
import { CityElfCultist } from '../creatures/CityElfCultist';
import { questBannerEntry, QUEST_BANNER_FRAMES } from '../ui/QuestBanners';
import type { TopBandEntry } from '../ui/hud/topBand';
import { objectiveBandEntry, type ObjectiveLine } from '../ui/hud/objectiveLine';
import { questMobLevel } from './questMobLevel';

const SPAWN_SEARCH_RADIUS_TILES = 5;
/** The congregation, spread through the barracks hall (offsets from room centre). */
const CULTIST_SPAWN_OFFSETS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: 0, dy: -3 },
  { dx: -3, dy: -1 },
  { dx: 3, dy: -1 },
  { dx: -2, dy: 2 },
  { dx: 2, dy: 2 },
];
/**
 * The congregation's level. Exported because the cult's stair guards elsewhere
 * in the town are meant to be the same fight, and two numbers that have to agree
 * eventually stop agreeing.
 */
export const CULT_HIDEOUT_CULTIST_LEVEL = 6;

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
    private readonly partyLevel: number,
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
      cultist.applyMobLevel(questMobLevel(CULT_HIDEOUT_CULTIST_LEVEL, this.partyLevel));
      applySpawnDifficulty(cultist);
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
    this.bannerTimer = QUEST_BANNER_FRAMES;
  }

  topBandEntries(): TopBandEntry[] {
    const entries: TopBandEntry[] = [];
    const banner = questBannerEntry({
      id: 'cult-banner',
      title: this.cleared ? 'THE NEST IS CLEANSED' : "THE CULT'S NEST",
      framesLeft: this.bannerTimer,
      tone: 'danger',
    });
    if (banner !== null) entries.push(banner);
    entries.push(objectiveBandEntry('cult-objective', this.objective()));
    return entries;
  }

  private objective(): ObjectiveLine {
    if (this.cleared) {
      return {
        text: 'The letter names Miss Quill, and it bears the magistrate’s seal. The tower, top floor.',
        tone: 'success',
      };
    }
    const remaining = this.cultists.filter((c) => c.isAlive).length;
    return { text: `Cleanse the cult — ${remaining} remaining`, tone: 'warning' };
  }
}
