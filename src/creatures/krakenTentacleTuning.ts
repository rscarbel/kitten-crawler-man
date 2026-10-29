/**
 * How long a Kraken tentacle's connecting whip holds its victim where it
 * landed: a little over a second.
 *
 * It also sets the shortest hop between the flooded pump room's rafts (a
 * longer hold needs longer swims for a whipped crawler to climb back in time),
 * so it is kept short enough for a field of small rafts four tiles apart.
 *
 * A leaf of its own because the flooded pump room's shark model is solved
 * against it headlessly: a crawler stunned stepping off a raft must be able to
 * climb back before the shark arrives and must not be able to finish the swim.
 * The solver reads this number rather than a copy, so retuning the stun
 * re-solves every room instead of silently breaking the escape.
 */
export const KRAKEN_TENTACLE_STUN_FRAMES = 70;
