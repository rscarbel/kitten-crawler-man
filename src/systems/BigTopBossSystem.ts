/**
 * BigTopBossSystem — the finale of "The Show Must Go On", fought inside the
 * Big Top interior. Grimaldi the Pestiferous Vine is wrapped around the
 * central tent pole; his Massive Roots must be destroyed before the trunk
 * can be harmed, and while any root lives the fallen troupe keeps
 * resurrecting. Owned by BuildingInteriorScene, which supplies the combat
 * stack; quest state crosses scenes via CircusQuestProgress.
 */

import { TILE_SIZE } from '../core/constants';
import type { GameMap } from '../map/GameMap';
import type { EventBus } from '../core/EventBus';
import type { AudioManager } from '../audio/AudioManager';
import type { GameSystem, SystemContext } from './GameSystem';
import type { Mob } from '../creatures/Mob';
import type { CircusQuestProgress } from '../core/CircusQuestProgress';
import { findNearbyWalkableTile } from '../map/findWalkableTile';
import { RingmasterGrimaldi } from '../creatures/RingmasterGrimaldi';
import { VineTendril } from '../creatures/VineTendril';
import { Signet } from '../creatures/Signet';
import { InkMarauder } from '../creatures/InkMarauder';
import { CircusLemur } from '../creatures/CircusLemur';
import { StiltClown } from '../creatures/StiltClown';
import { FatClown } from '../creatures/FatClown';
import { MoldLion } from '../creatures/MoldLion';
import { drawText } from '../ui/TextBox';
import { drawProgressBar, PROGRESS_PRESETS } from '../ui/Box';

const FRAMES_PER_SECOND = 60;
/** Seconds a resurrecting performer waits before respawning — the book's gimmick. */
const RESURRECT_DELAY_SECONDS = 6;
const RESURRECT_DELAY_FRAMES = RESURRECT_DELAY_SECONDS * FRAMES_PER_SECOND;
const RESPAWN_PENDING = -1;

const SPAWN_SEARCH_RADIUS_TILES = 5;
/** Distance from the pole at which the Massive Roots ring the trunk. */
const ROOT_RING_RADIUS_TILES = 4;
const ROOT_COUNT = 4;
/** Grimaldi's entity tile sits just south of the pole cluster so the vine mass wraps it. */
const GRIMALDI_POLE_SOUTH_OFFSET = 1;
/** Signet takes position this many tiles north of the entrance. */
const SIGNET_ENTRANCE_OFFSET_TILES = 3;

const BANNER_SECONDS = 4;
const BANNER_FRAMES = BANNER_SECONDS * FRAMES_PER_SECOND;
const BANNER_FADE_FRAMES = 60;
const BANNER_TITLE_Y = 70;
const BANNER_TITLE_SIZE = 30;
const BANNER_SUBTITLE_Y = 104;
const BANNER_SUBTITLE_SIZE = 13;
const BANNER_GLOW_BLUR = 12;

const BOSS_BAR_WIDTH = 320;
const BOSS_BAR_HEIGHT = 14;
const BOSS_BAR_Y = 40;
const BOSS_BAR_LABEL_Y = 22;
const BOSS_BAR_LABEL_SIZE = 12;

const OBJECTIVE_Y_FROM_BOTTOM = 96;
const OBJECTIVE_SIZE = 13;

const VICTORY_BANNER_SECONDS = 8;
const VICTORY_BANNER_FRAMES = VICTORY_BANNER_SECONDS * FRAMES_PER_SECOND;
const VICTORY_TITLE_SIZE = 26;
const VICTORY_SUBTITLE_SIZE = 13;
const VICTORY_TITLE_Y_OFFSET = 30;
const VICTORY_SUBTITLE_Y_OFFSET = 8;

type PerformerType = 'circus_lemur' | 'stilt_clown' | 'fat_clown' | 'mold_lion';

interface TrackedPerformer {
  mob: Mob;
  type: PerformerType;
  spawnTile: { x: number; y: number };
  /** RESPAWN_PENDING when not counting down; otherwise frames remaining until respawn. */
  respawnTimer: number;
}

/** The troupe's honor guard around the ring — subject to resurrection. */
const HONOR_GUARD: ReadonlyArray<{ dx: number; dy: number; type: PerformerType }> = [
  { dx: -5, dy: 3, type: 'stilt_clown' },
  { dx: 5, dy: 3, type: 'fat_clown' },
  { dx: -6, dy: -1, type: 'circus_lemur' },
  { dx: 6, dy: -1, type: 'circus_lemur' },
  { dx: 0, dy: 6, type: 'mold_lion' },
];

function makePerformer(type: PerformerType, x: number, y: number): Mob {
  switch (type) {
    case 'circus_lemur':
      return new CircusLemur(x, y, TILE_SIZE);
    case 'stilt_clown':
      return new StiltClown(x, y, TILE_SIZE);
    case 'fat_clown':
      return new FatClown(x, y, TILE_SIZE);
    case 'mold_lion':
      return new MoldLion(x, y, TILE_SIZE);
  }
}

export class BigTopBossSystem implements GameSystem {
  /** Shown by BuildingInteriorScene if the players fall here. */
  readonly defeatMessage = 'The show went on without you.';

  private grimaldi: RingmasterGrimaldi | null = null;
  private roots: VineTendril[] = [];
  private performers: TrackedPerformer[] = [];
  private signet: Signet | null = null;
  private grimaldiWasInvulnerable = true;
  private bannerTimer = BANNER_FRAMES;
  private victoryTimer = 0;
  private victoryHandled = false;

  constructor(
    private readonly map: GameMap,
    private readonly bus: EventBus,
    private readonly addMob: (mob: Mob) => void,
    private readonly progress: CircusQuestProgress,
    private readonly audio: AudioManager | null,
  ) {
    this.spawnEncounter();
    this.bus.emit('bossFightInitiated', { bossType: 'ringmaster_grimaldi' });
    this.audio?.playMusic('circus_battle', { fadeInMs: 1000 });
  }

  get bossAlive(): boolean {
    return this.grimaldi?.isAlive ?? false;
  }

  private findSpawnTile(tileX: number, tileY: number): { x: number; y: number } | null {
    return findNearbyWalkableTile(this.map, tileX, tileY, SPAWN_SEARCH_RADIUS_TILES);
  }

  private spawnEncounter(): void {
    const pole = this.map.bigtopRingCentre;
    if (!pole) return;

    // Grimaldi's entity tile hugs the south face of the pole cluster; the
    // sprite's 3-tile vine mass visually wraps the pole itself. The hitbox
    // stays single-tile — the fight is root-focused, so a huge core hitbox
    // would only make the invulnerable phase confusing.
    const grimaldiTile = this.findSpawnTile(pole.x, pole.y + GRIMALDI_POLE_SOUTH_OFFSET) ?? {
      x: pole.x,
      y: pole.y + GRIMALDI_POLE_SOUTH_OFFSET,
    };
    const grimaldi = new RingmasterGrimaldi(grimaldiTile.x, grimaldiTile.y, TILE_SIZE);
    grimaldi.setMap(this.map);
    // No boss-room system exists indoors; the vine is always awake.
    grimaldi.forceAggro = true;

    this.roots = [];
    for (let i = 0; i < ROOT_COUNT; i++) {
      const angle = (i / ROOT_COUNT) * Math.PI * 2 + Math.PI / ROOT_COUNT;
      const tile = this.findSpawnTile(
        Math.round(pole.x + Math.cos(angle) * ROOT_RING_RADIUS_TILES),
        Math.round(pole.y + Math.sin(angle) * ROOT_RING_RADIUS_TILES),
      );
      if (!tile) continue;
      const root = new VineTendril(tile.x, tile.y, TILE_SIZE);
      root.setMap(this.map);
      this.addMob(root);
      this.roots.push(root);
    }
    grimaldi.setTendrils(this.roots);
    this.addMob(grimaldi);
    this.grimaldi = grimaldi;

    this.performers = [];
    for (const { dx, dy, type } of HONOR_GUARD) {
      const spawnTile = this.findSpawnTile(pole.x + dx, pole.y + dy);
      if (!spawnTile) continue;
      const mob = makePerformer(type, spawnTile.x, spawnTile.y);
      mob.setMap(this.map);
      this.addMob(mob);
      this.performers.push({ mob, type, spawnTile, respawnTimer: RESPAWN_PENDING });
    }

    // Signet fights at the crawlers' side, entering just behind them.
    const entrance = this.map.startTile;
    const signetTile = this.findSpawnTile(entrance.x, entrance.y - SIGNET_ENTRANCE_OFFSET_TILES);
    if (signetTile) {
      const signet = new Signet(signetTile.x, signetTile.y, TILE_SIZE, this.addMob);
      signet.setMap(this.map);
      signet.allyModeActive = true;
      this.addMob(signet);
      this.signet = signet;
    }
  }

  update(ctx: SystemContext): void {
    if (this.bannerTimer > 0) this.bannerTimer--;
    if (this.victoryTimer > 0) this.victoryTimer--;

    if (this.signet) this.signet.allMobs = ctx.mobs;
    for (const mob of ctx.mobs) {
      if (mob instanceof InkMarauder) mob.allMobs = ctx.mobs;
    }

    const grimaldi = this.grimaldi;
    if (!grimaldi) return;

    if (!grimaldi.isAlive) {
      if (!this.victoryHandled) {
        this.victoryHandled = true;
        this.progress.stage = 'grimaldi_slain';
        this.victoryTimer = VICTORY_BANNER_FRAMES;
        this.bus.emit('bossDefeated', { bossType: 'ringmaster_grimaldi', mob: grimaldi });
        this.audio?.play('boss_defeated');
        this.audio?.playMusic('circus_theme', { fadeInMs: 2000 });
      }
      return;
    }

    const invulnerable = this.roots.some((r) => r.isAlive);
    if (this.grimaldiWasInvulnerable && !invulnerable) {
      this.bus.emit('objectiveComplete', { objectiveId: 'grimaldi_vulnerable' });
    }
    this.grimaldiWasInvulnerable = invulnerable;

    for (const entry of this.performers) {
      if (entry.mob.isAlive) continue;
      if (!invulnerable) continue; // resurrection stops once the trunk is exposed
      if (entry.respawnTimer === RESPAWN_PENDING) {
        entry.respawnTimer = RESURRECT_DELAY_FRAMES;
        continue;
      }
      entry.respawnTimer--;
      if (entry.respawnTimer <= 0) {
        const fresh = makePerformer(entry.type, entry.spawnTile.x, entry.spawnTile.y);
        fresh.setMap(this.map);
        this.addMob(fresh);
        entry.mob = fresh;
        entry.respawnTimer = RESPAWN_PENDING;
      }
    }
  }

  renderUI(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const grimaldi = this.grimaldi;
    if (!grimaldi) return;

    if (grimaldi.isAlive) {
      const barX = canvas.width / 2 - BOSS_BAR_WIDTH / 2;
      drawText(ctx, grimaldi.displayName, {
        x: canvas.width / 2,
        y: BOSS_BAR_LABEL_Y,
        size: BOSS_BAR_LABEL_SIZE,
        bold: true,
        color: '#a8f070',
        align: 'center',
      });
      drawProgressBar(ctx, {
        x: barX,
        y: BOSS_BAR_Y,
        width: BOSS_BAR_WIDTH,
        height: BOSS_BAR_HEIGHT,
        value: grimaldi.hp / grimaldi.maxHp,
        ...PROGRESS_PRESETS.hp,
      });

      const rootsLeft = this.roots.filter((r) => r.isAlive).length;
      const objective =
        rootsLeft > 0
          ? `Destroy the Massive Roots — ${rootsLeft} remaining`
          : 'The Vine is exposed!';
      drawText(ctx, objective, {
        x: canvas.width / 2,
        y: canvas.height - OBJECTIVE_Y_FROM_BOTTOM,
        size: OBJECTIVE_SIZE,
        bold: true,
        color: rootsLeft > 0 ? '#e8d060' : '#a8f070',
        align: 'center',
      });
    }

    if (this.bannerTimer > 0 && grimaldi.isAlive) {
      const alpha =
        this.bannerTimer < BANNER_FADE_FRAMES ? this.bannerTimer / BANNER_FADE_FRAMES : 1;
      drawText(ctx, 'GRIMALDI THE PESTIFEROUS VINE', {
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
      drawText(ctx, 'City Boss — while his roots live, the trunk cannot be harmed', {
        x: canvas.width / 2,
        y: BANNER_SUBTITLE_Y,
        size: BANNER_SUBTITLE_SIZE,
        color: '#d4edaa',
        align: 'center',
        alpha,
      });
    }

    if (this.victoryTimer > 0) {
      const alpha =
        this.victoryTimer < BANNER_FADE_FRAMES ? this.victoryTimer / BANNER_FADE_FRAMES : 1;
      drawText(ctx, 'THE VINE IS DEAD', {
        x: canvas.width / 2,
        y: canvas.height / 2 - VICTORY_TITLE_Y_OFFSET,
        size: VICTORY_TITLE_SIZE,
        bold: true,
        color: '#4ade80',
        align: 'center',
        alpha,
        glow: '#4ade80',
        glowBlur: BANNER_GLOW_BLUR,
      });
      drawText(ctx, 'Return to Signet outside the Big Top', {
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
