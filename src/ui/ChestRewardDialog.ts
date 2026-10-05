import type { LootDrop } from '../creatures/Mob';
import type { TreasureChest } from '../systems/TreasureChestSystem';

const PARTICLE_SPEED_MIN = 1.5;
const PARTICLE_SPEED_VARIANCE = 3;
const PARTICLE_LIFE_MIN = 40;
const PARTICLE_LIFE_VARIANCE = 30;
const PARTICLE_MAX_LIFE = 70;
const PARTICLE_GRAVITY = 0.15;
const PARTICLE_COUNT = 30;

const CHEST_OPEN_FRAME = 30;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

export interface ChestLootSplit {
  humanLoot: LootDrop;
  catLoot: LootDrop;
  /** Override display names for specific item IDs (keyed by item id string). */
  displayLabels?: Record<string, string>;
  /** Extra display-only lines appended to the human column (not real inventory items). */
  customHumanEntries?: string[];
  /** Extra display-only lines appended to the cat column (not real inventory items). */
  customCatEntries?: string[];
}

/** A spark from the chest's burst, relative to the chest's centre. */
export interface ChestSpark {
  readonly x: number;
  readonly y: number;
  readonly life: number;
  readonly maxLife: number;
}

/** What the open dialog shows this frame. */
export interface ChestRewardView {
  readonly chestType: TreasureChest['type'];
  /** Update frames since the dialog opened. */
  readonly frame: number;
  /** The lid is up, the loot is listed and a press dismisses. */
  readonly opened: boolean;
  readonly lootSplit: ChestLootSplit | null;
  readonly sparks: readonly ChestSpark[];
}

export class ChestRewardDialog {
  private _isOpen = false;
  private frame = 0;
  private chest: TreasureChest | null = null;
  private lootSplit: ChestLootSplit | null = null;
  private onClose: (() => void) | null = null;
  private particles: Particle[] = [];
  private burstSpawned = false;
  rewardSoundPending = false;

  get isOpen(): boolean {
    return this._isOpen;
  }

  /** The open dialog's state, or null while it is closed. */
  get view(): ChestRewardView | null {
    if (!this._isOpen || this.chest === null) return null;
    return {
      chestType: this.chest.type,
      frame: this.frame,
      opened: this.frame >= CHEST_OPEN_FRAME,
      lootSplit: this.lootSplit,
      sparks: this.particles,
    };
  }

  open(chest: TreasureChest, lootSplit: ChestLootSplit | null, onClose?: () => void): void {
    this._isOpen = true;
    this.chest = chest;
    this.lootSplit = lootSplit;
    this.onClose = onClose ?? null;
    this.frame = 0;
    this.particles = [];
    this.burstSpawned = false;
    this.rewardSoundPending = false;
  }

  /**
   * Drops the dialog without running its `onClose`.
   *
   * That callback grants the chest's reward — the Mongo unlock among them — and
   * a checkpoint restore has just rewound the world the chest was opened in, so
   * firing it would hand out a prize for a chest that is locked again.
   */
  discard(): void {
    this._isOpen = false;
    this.chest = null;
    this.lootSplit = null;
    this.onClose = null;
    this.particles = [];
    this.rewardSoundPending = false;
  }

  tick(): void {
    if (!this._isOpen) return;

    this.frame++;

    if (this.frame === CHEST_OPEN_FRAME && !this.burstSpawned) {
      this.burstSpawned = true;
      this.rewardSoundPending = true;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const angle = (i / PARTICLE_COUNT) * Math.PI * 2;
        const speed = PARTICLE_SPEED_MIN + Math.random() * PARTICLE_SPEED_VARIANCE;
        this.particles.push({
          x: 0,
          y: 0,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: PARTICLE_LIFE_MIN + Math.floor(Math.random() * PARTICLE_LIFE_VARIANCE),
          maxLife: PARTICLE_MAX_LIFE,
        });
      }
    }

    this.particles = this.particles.filter((p) => p.life > 0);
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += PARTICLE_GRAVITY;
      p.life--;
    }
  }

  handleKeyDown(): boolean {
    return this.dismiss();
  }

  /** Closes the card once the chest has opened; returns whether it closed. */
  dismiss(): boolean {
    if (!this._isOpen || this.frame < CHEST_OPEN_FRAME) return false;
    this._isOpen = false;
    if (this.onClose !== null) {
      this.onClose();
    }
    return true;
  }
}
