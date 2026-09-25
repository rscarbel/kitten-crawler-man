/**
 * The Structure menu over a boarded grate in the defense quest: a crawler who
 * has reached Construction 5 can nail spikes onto the boards. The spikes take
 * a bugaboo's blows before the boards do and hand each blow back to it.
 *
 * Without Construction 5 on the active crawler, the Structure menu key and the
 * long-press fall through to their usual handlers.
 *
 * Spikes cost a `wood_board` — the village's Boards of Wood — never the quest's
 * own Barricade Boards, which the grates themselves are built from.
 */

import type { AudioManager } from '../audio/AudioManager';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { OverlayInputClaim } from './kits/OverlayClaims';
import type { DefendQuestSystem } from './DefendQuestSystem';
import { canAfford, partyCount, spend } from '../core/partyResources';
import { constructionHpMultiplier, spikesUnlocked } from '../core/craftPerks';
import { keybindings } from '../core/Keybindings';
import { TILE_SIZE } from '../core/constants';
import { StructureMenu, type StructureMenuModel } from '../ui/StructureMenu';
import {
  CONSTRUCTION_XP,
  SPIKES_BASE_HP,
  SPIKES_COST,
  discountedCost,
} from './briarHollow/structureRules';

type Crawler = HumanPlayer | CatPlayer;

/** A grate's spikes are the same armour as a wall's: the same HP, doubled by the same level-15 perk. */
export const GRATE_SPIKES_BASE_HP = SPIKES_BASE_HP;

export interface GrateSpikesMenuDeps {
  readonly defendQuest: DefendQuestSystem;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly audio: AudioManager | null;
  readonly announce: (message: string) => void;
}

function constructionLevel(crawler: Crawler): number {
  return crawler.craftSkills.isLearned('construction')
    ? crawler.craftSkills.getLevel('construction')
    : 0;
}

export class GrateSpikesMenu {
  private readonly menu: StructureMenu;
  private grateIdx: number | null = null;

  constructor(private readonly deps: GrateSpikesMenuDeps) {
    this.menu = new StructureMenu(deps.audio);
  }

  private active(): Crawler {
    return this.deps.human.isActive ? this.deps.human : this.deps.cat;
  }

  get isOpen(): boolean {
    return this.menu.isOpen;
  }

  /**
   * The Structure menu key, or a long-press near a grate. Returns whether it
   * was taken: only when the active crawler has the spikes unlocked and a
   * boarded grate is in reach.
   */
  tryOpen(): boolean {
    if (this.menu.isOpen) {
      this.close();
      return true;
    }
    const active = this.active();
    if (!spikesUnlocked(constructionLevel(active))) return false;
    const barrier = this.deps.defendQuest.spikeableBarrierNear(active);
    if (barrier === null) return false;
    this.grateIdx = barrier.grateIdx;
    this.menu.show();
    return true;
  }

  /** Whether a finger held on this tile would open the menu: the active crawler's own spikeable grate. */
  isSpikeableGrateAt(tileX: number, tileY: number): boolean {
    const active = this.active();
    if (!spikesUnlocked(constructionLevel(active))) return false;
    const barrier = this.deps.defendQuest.spikeableBarrierNear(active);
    return barrier !== null && barrier.tileX === tileX && barrier.tileY === tileY;
  }

  close(): boolean {
    if (!this.menu.isOpen) return false;
    this.grateIdx = null;
    this.menu.close();
    return true;
  }

  /** Closes once the crawler has walked out of reach of the grate, or the boards are gone. */
  update(): void {
    const grateIdx = this.grateIdx;
    if (grateIdx === null) return;
    // Switched to a crawler who cannot spike: the menu has nothing to offer them.
    if (!spikesUnlocked(constructionLevel(this.active()))) {
      this.close();
      return;
    }
    const barrier = this.deps.defendQuest.spikeableBarrierNear(this.active());
    const stillHere = barrier !== null && barrier.grateIdx === grateIdx;
    if (!stillHere || !this.deps.defendQuest.hasBarrierAt(grateIdx)) this.close();
  }

  /** Nails the spikes on for the active crawler, paying from the party. Returns whether it did. */
  addSpikes(): boolean {
    const grateIdx = this.grateIdx;
    if (grateIdx === null) return false;
    const active = this.active();
    const level = constructionLevel(active);
    if (!spikesUnlocked(level)) return false;
    const cost = discountedCost(SPIKES_COST, level);
    if (!spend(this.deps.human, this.deps.cat, cost, active)) {
      this.deps.announce('Not enough materials.');
      this.deps.audio?.play('error');
      return false;
    }
    const builder = active === this.deps.human ? 'human' : 'cat';
    const hp = GRATE_SPIKES_BASE_HP * constructionHpMultiplier(level);
    if (!this.deps.defendQuest.addBarrierSpikes(grateIdx, hp, builder)) return false;
    active.craftSkills.addXp('construction', CONSTRUCTION_XP.spikes);
    active.queueFloatingText('+Spikes', 'buff');
    this.close();
    return true;
  }

  private model(camX: number, camY: number): StructureMenuModel | null {
    const grateIdx = this.grateIdx;
    if (grateIdx === null) return null;
    const barrier = this.deps.defendQuest.spikeableBarrierNear(this.active());
    if (barrier?.grateIdx !== grateIdx) return null;
    const level = constructionLevel(this.active());
    const cost = discountedCost(SPIKES_COST, level);
    const affordable = canAfford(this.deps.human, this.deps.cat, cost);
    const spiked = (barrier.spikesHp ?? 0) > 0;
    return {
      title: 'Boarded Grate',
      hp: barrier.hp,
      maxHp: barrier.maxHp,
      spikesHp: barrier.spikesHp ?? null,
      spikesMaxHp: GRATE_SPIKES_BASE_HP * constructionHpMultiplier(level),
      options: [
        {
          label: spiked ? 'Repair Spikes' : 'Add Spikes',
          cost,
          disabledReason: affordable ? undefined : 'Not enough materials',
          action: () => void this.addSpikes(),
        },
        { label: 'Cancel', style: 'cancel', action: () => void this.close() },
      ],
      anchor: { x: barrier.worldX - camX, y: barrier.worldY - camY, w: TILE_SIZE, h: TILE_SIZE },
    };
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (!this.menu.isOpen) return;
    const model = this.model(camX, camY);
    if (model === null) return;
    this.menu.render(ctx, model, (id) => partyCount(this.deps.human, this.deps.cat, id));
  }

  handleClick(mx: number, my: number): boolean {
    return this.menu.handleClick(mx, my);
  }

  /** Escape closes it; so does the Structure menu key again. */
  handleKeyDown(key: string, repeat = false): boolean {
    if (!this.menu.isOpen) return false;
    if (key === 'Escape' || keybindings.actionFor(key) === 'structureMenu') {
      // A held key repeating is still the press that opened the menu.
      if (!repeat) this.close();
      return true;
    }
    return false;
  }

  overlayClaim(): OverlayInputClaim {
    return this.menu.overlayClaim();
  }
}
