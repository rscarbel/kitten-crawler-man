/**
 * QuestManager — lightweight state machine tracker for quests.
 * Holds quest definitions and current state. No rendering or game logic.
 */

import type { ItemId } from './ItemDefs';

export type QuestStatus = 'available' | 'active' | 'completed' | 'failed';
export type QuestType = 'story' | 'mini';

export interface QuestRewards {
  xp: number;
  lootBoxItems?: Array<{ id: ItemId; minQty: number; maxQty: number }>;
  coins?: number;
}

export interface QuestDef {
  id: string;
  name: string;
  type: QuestType;
  rewards: QuestRewards;
}

export interface QuestState {
  status: QuestStatus;
}

export class QuestManager {
  private quests = new Map<string, { def: QuestDef; state: QuestState }>();

  register(def: QuestDef): void {
    this.quests.set(def.id, {
      def,
      state: { status: 'available' },
    });
  }

  getStatus(id: string): QuestStatus | null {
    return this.quests.get(id)?.state.status ?? null;
  }

  getDef(id: string): QuestDef | null {
    return this.quests.get(id)?.def ?? null;
  }

  startQuest(id: string): void {
    const q = this.quests.get(id);
    if (q && q.state.status === 'available') {
      q.state.status = 'active';
    }
  }

  completeQuest(id: string): void {
    const q = this.quests.get(id);
    if (q && q.state.status === 'active') {
      q.state.status = 'completed';
    }
  }

  failQuest(id: string): void {
    const q = this.quests.get(id);
    if (q && q.state.status === 'active') {
      q.state.status = 'failed';
    }
  }
}
