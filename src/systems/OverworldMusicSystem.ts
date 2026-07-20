/**
 * OverworldMusicSystem — zone-based background music for the Over City
 * overworld: village_square inside the town safe zone, circus_theme on the
 * circus grounds, forest_path in the wilds between. Quest systems set
 * `battleMusicActive` while they own the track (e.g. circus_battle during
 * circus fights); zone switching pauses until it clears.
 */

import { TILE_SIZE } from '../core/constants';
import type { AudioManager } from '../audio/AudioManager';
import type { SoundId } from '../audio/sounds';
import type { GameMap } from '../map/GameMap';
import type { GameSystem, SystemContext } from './GameSystem';

type MusicZone = 'town' | 'wilds' | 'circus';

const ZONE_TRACKS: Record<MusicZone, SoundId> = {
  town: 'village_square',
  wilds: 'forest_path',
  circus: 'circus_theme',
};

const ZONE_FADE_MS = 1500;
/** The circus theme starts a little before the player reaches the grounds. */
const CIRCUS_ZONE_BUFFER_TILES = 4;

export class OverworldMusicSystem implements GameSystem {
  private currentZone: MusicZone | null = null;
  /** Set by quest systems while battle music owns the track. */
  battleMusicActive = false;

  constructor(
    private readonly map: GameMap,
    private readonly audio: AudioManager,
  ) {}

  /** Forget the current zone so the next update restarts the zone track (e.g. after battle music ends). */
  reset(): void {
    this.currentZone = null;
  }

  update(ctx: SystemContext): void {
    if (this.battleMusicActive) return;
    const zone = this.zoneAt(ctx.active.x, ctx.active.y);
    if (zone === this.currentZone) return;
    this.currentZone = zone;
    // The right track may already be running — e.g. it survived a building
    // round-trip — and restarting it from the top would be jarring.
    if (this.audio.currentMusicId === ZONE_TRACKS[zone]) return;
    this.audio.playMusic(ZONE_TRACKS[zone], { fadeInMs: ZONE_FADE_MS });
  }

  private zoneAt(worldX: number, worldY: number): MusicZone {
    const circusCentre = this.map.circusCentre;
    const circusRadius = this.map.circusRadiusTiles;
    if (circusCentre && circusRadius !== undefined) {
      const dx = worldX / TILE_SIZE - circusCentre.x;
      const dy = worldY / TILE_SIZE - circusCentre.y;
      if (Math.hypot(dx, dy) <= circusRadius + CIRCUS_ZONE_BUFFER_TILES) return 'circus';
    }
    if (this.map.isInTownSafeZone(worldX, worldY)) return 'town';
    return 'wilds';
  }
}
