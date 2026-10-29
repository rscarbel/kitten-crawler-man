import { isRecord } from '../../core/util/guards';
import {
  parseTrashGremlinRoomCheckpoint,
  type TrashGremlinRoomCheckpoint,
} from './trashGremlinRoomCheckpoint';
import { parseGymRoomCheckpoint, type GymRoomCheckpoint } from './gymRoomCheckpoint';
import {
  parseFloodedPumpRoomCheckpoint,
  type FloodedPumpRoomCheckpoint,
} from './floodedPumpRoom/floodedPumpRoomState';
import {
  parseSpiderLabDressingCheckpoint,
  type SpiderLabDressingCheckpoint,
} from './spiderLabCheckpoint';

/** The rooms' own state for a safe-room checkpoint. */
export interface BossRoomDressingCheckpoint {
  trashGremlin: TrashGremlinRoomCheckpoint | null;
  gym: GymRoomCheckpoint | null;
  floodedPumpRoom: FloodedPumpRoomCheckpoint | null;
  spiderLab: SpiderLabDressingCheckpoint | null;
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
  const gym = value.gym === null ? null : parseGymRoomCheckpoint(value.gym);
  const floodedPumpRoom =
    value.floodedPumpRoom === null ? null : parseFloodedPumpRoomCheckpoint(value.floodedPumpRoom);
  const spiderLab =
    value.spiderLab === null ? null : parseSpiderLabDressingCheckpoint(value.spiderLab);
  if (trashGremlin === undefined || gym === undefined || spiderLab === undefined) {
    return undefined;
  }
  if (floodedPumpRoom === undefined) return undefined;
  return { trashGremlin, gym, floodedPumpRoom, spiderLab };
}
