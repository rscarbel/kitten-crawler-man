/**
 * Fixtures for the clogged bathroom's pipe board: the opening scramble, half
 * solved and leaking, every fixture full but still leaking, solved, still
 * generating, and the "Start over" confirmation.
 */

import {
  DevPipeBoardSource,
  fullButLeaking,
  solveAll,
  solveNearHalf,
} from '../../pipeBoardDevSource';
import type { PipeBoard } from '../../../systems/cloggedBathroom/pipeBoard';
import { PIPE_BOARD_FALLBACKS } from '../../../systems/cloggedBathroom/pipeBoardFallback';
import { pipeBoardSurfaces } from '../../../ui/screens/dialogs/pipeBoardSurface';
import type { Surface } from '../../../ui/core/UiRoot';
import type { DialogFixture } from './fixture';

/** Shown only while the gallery shows this fixture; every other claim is read live from the surface. */
function gated(surface: Surface, shown: () => boolean): Surface {
  return {
    get id() {
      return surface.id;
    },
    get band() {
      return surface.band;
    },
    get haltsWorld() {
      return surface.haltsWorld;
    },
    get locksKeyboard() {
      return surface.locksKeyboard;
    },
    get blocksEscape() {
      return surface.blocksEscape;
    },
    isOpen: () => shown() && surface.isOpen(),
    render: (ui) => surface.render(ui),
    close: () => surface.close?.(),
    wantsEscape: () => surface.wantsEscape?.() !== false,
    onKey: (key, mods) => surface.onKey?.(key, mods) === true,
  };
}

/** Half way through laying out the board. */
const GENERATING_PROGRESS = 0.4;

function boardFixture(
  name: string,
  arrange: (board: PipeBoard, source: DevPipeBoardSource) => void,
  interact?: DialogFixture['interact'],
): DialogFixture {
  return {
    name,
    surfaces: (shown) => {
      const source = new DevPipeBoardSource(PIPE_BOARD_FALLBACKS.normal);
      const board = source.pipeBoard;
      if (board !== null) arrange(board, source);
      return pipeBoardSurfaces(source, name).map((surface) => gated(surface, shown));
    },
    interact,
  };
}

export const FIXTURES: readonly DialogFixture[] = [
  boardFixture('pipe-board', () => undefined),
  boardFixture('pipe-board-midsolve', (board) => solveNearHalf(board)),
  boardFixture('pipe-board-full-leaking', (board) => void fullButLeaking(board)),
  boardFixture('pipe-board-solved', (board, source) => {
    solveAll(board);
    source.pipeBoardSolved = true;
  }),
  boardFixture('pipe-board-generating', (_board, source) => {
    source.pipeBoard = null;
    source.pipeBoardGenerationProgress = GENERATING_PROGRESS;
  }),
  boardFixture(
    'pipe-board-restart-confirm',
    () => undefined,
    (rig) => rig.tap(rig.need('pipe-board-restart-confirm/pipe-board-restart-confirm/restart')),
  ),
];
