/**
 * Wendell's work orders as read off a notice board: the tear-off strip the
 * party takes, in his written voice, signed with his initial.
 */

import { transientSpeaker } from '../line';

const workOrder = transientSpeaker('Work order', 'sign');

export const WORK_ORDERS = {
  /** The strip just torn off: the building, the client and the exact bill. */
  issued: workOrder.fn((args: { siteName: string; contactName: string; costText: string }) => [
    `${args.siteName}. ${args.contactName} is expecting you. You will require ${args.costText}. Payment from the client on completion. W.`,
  ]),
  /** No site can take a contract right now. */
  nothingDoing: workOrder.line(
    "Every strip on Wendell's order has been torn away. A note pinned underneath reads: 'More presently. W.'",
  ),
  /** The board's action button while a contract is there to take. */
  takeLabel: 'Tear off a work order',
} as const;
