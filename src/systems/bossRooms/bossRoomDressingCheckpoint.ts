import { isRecord } from '../../core/util/guards';
import {
  parseColosseumDressingCheckpoint,
  type ColosseumDressingCheckpoint,
} from './ColosseumDressingSystem';
import {
  parseTrashGremlinRoomCheckpoint,
  type TrashGremlinRoomCheckpoint,
} from './trashGremlinRoomCheckpoint';
import { parseGymRoomCheckpoint, type GymRoomCheckpoint } from './gymRoomCheckpoint';
import { parseKrakarenRoomCheckpoint, type KrakarenRoomCheckpoint } from './krakarenRoomCheckpoint';
import {
  parseSpiderLabDressingCheckpoint,
  type SpiderLabDressingCheckpoint,
} from './spiderLabCheckpoint';

/** The rooms' own state for a safe-room checkpoint. */
export interface BossRoomDressingCheckpoint {
  trashGremlin: TrashGremlinRoomCheckpoint | null;
  gym: GymRoomCheckpoint | null;
  krakaren: KrakarenRoomCheckpoint | null;
  spiderLab: SpiderLabDressingCheckpoint | null;
  colosseum: ColosseumDressingCheckpoint | null;
}

/**
 * Reads a saved dressing checkpoint back from untrusted JSON. Each room's part
 * is null or a record; a room with state of its own validates it here.
 */
export function parseBossRoomDressingCheckpoint(
  value: unknown,
): BossRoomDressingCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const trashGremlin = parseTrashGremlinRoomCheckpoint(value.trashGremlin);
  const krakaren = parseKrakarenRoomCheckpoint(value.krakaren);
  // Absent from saves written before the gym kept any state: that loads as a
  // gym as generated, not as a failed load.
  const gym =
    value.gym === null || value.gym === undefined ? null : parseGymRoomCheckpoint(value.gym);
  const spiderLab =
    value.spiderLab === null ? null : parseSpiderLabDressingCheckpoint(value.spiderLab);
  const colosseum =
    value.colosseum === null ? null : parseColosseumDressingCheckpoint(value.colosseum);
  if (
    trashGremlin === undefined ||
    gym === undefined ||
    krakaren === undefined ||
    spiderLab === undefined ||
    colosseum === undefined
  ) {
    return undefined;
  }
  return { trashGremlin, gym, krakaren, spiderLab, colosseum };
}
