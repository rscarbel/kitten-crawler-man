import { isRecord } from '../../core/guards';
import {
  parseColosseumDressingCheckpoint,
  type ColosseumDressingCheckpoint,
} from './ColosseumDressingSystem';
import { parseHoarderRoomCheckpoint, type HoarderRoomCheckpoint } from './hoarderRoomCheckpoint';
import { parseJuicerRoomCheckpoint, type JuicerRoomCheckpoint } from './juicerRoomCheckpoint';
import { parseKrakarenRoomCheckpoint, type KrakarenRoomCheckpoint } from './krakarenRoomCheckpoint';
import {
  parseSpiderLabDressingCheckpoint,
  type SpiderLabDressingCheckpoint,
} from './spiderLabCheckpoint';

/** The rooms' own state for a safe-room checkpoint. */
export interface BossRoomDressingCheckpoint {
  hoarder: HoarderRoomCheckpoint | null;
  juicer: JuicerRoomCheckpoint | null;
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
  const hoarder = parseHoarderRoomCheckpoint(value.hoarder);
  const krakaren = parseKrakarenRoomCheckpoint(value.krakaren);
  // Absent from saves written before the gym kept any state: that loads as a
  // gym as generated, not as a failed load.
  const juicer =
    value.juicer === null || value.juicer === undefined
      ? null
      : parseJuicerRoomCheckpoint(value.juicer);
  const spiderLab =
    value.spiderLab === null ? null : parseSpiderLabDressingCheckpoint(value.spiderLab);
  const colosseum =
    value.colosseum === null ? null : parseColosseumDressingCheckpoint(value.colosseum);
  if (
    hoarder === undefined ||
    juicer === undefined ||
    krakaren === undefined ||
    spiderLab === undefined ||
    colosseum === undefined
  ) {
    return undefined;
  }
  return { hoarder, juicer, krakaren, spiderLab, colosseum };
}
