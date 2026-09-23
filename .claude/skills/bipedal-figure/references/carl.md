# Carl: the reference figure, file by file

Carl is the one figure in this game whose movement convinces, and the only one
split finely enough to show where each concern belongs. Read this before
changing him, and before copying his structure into another figure.

Constants named here are the source of truth; grep them before relying on a
value quoted beside them.

## Where everything lives

**Painter** — `src/sprites/art/carl/`. Knows nothing about animation; paints one
`CarlPose` in one view.

| File                   | Owns                                                                                                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `geometry.ts`          | Point arithmetic in figure space (tile units, origin between the feet, +Y down).                                                                                                                    |
| `palette.ts`           | The material ramps (`SKIN`, `LEATHER`, `COTTON`, `HAIR`), `receded`, the silhouette-outline tone, rim/sheen/crease alphas, and `LIGHT`, the key-light direction.                                    |
| `proportions.ts`       | Height, heads-tall, every joint height, bone lengths, widths, head radii. `FIGURE_HEIGHT` and `HEADS_TALL` pin everything else.                                                                     |
| `rig.ts`               | `CarlView`, `ViewSpec`, `VIEWS`, `CarlPose`, `ArmAngles`, `restingPose`, handedness (`mirrorPose`, `poseAsDrawn`, `drawnSide`), the two-bone IK, `buildSkeleton`, and the head-on depth projection. |
| `paint.ts`             | The primitives every part is built from: capsule traces, `shadeForm` / `shadeClipped`, `castShadow`, `crease`, the contact shadow.                                                                  |
| `head.ts`              | Skull, face planes, features, ears, hair, and the neck.                                                                                                                                             |
| `torso.ts`             | The jacket (and the trollskin shirt's band at the neckline), collar, rim light.                                                                                                                     |
| `sleeve.ts`            | The shoved-up leather sleeve over the upper arm and the deltoid cap under it.                                                                                                                       |
| `limbs.ts`             | Bare arm and leg silhouettes and their muscle forms, the hand in its three shapes, `handGrip`, `wristAngle`.                                                                                        |
| `feet.ts`              | The bare foot, one silhouette per view; sole landmarks the probe and gates read.                                                                                                                    |
| `boxers.ts`            | The heart-print shorts, cuffed round each thigh.                                                                                                                                                    |
| `gear.ts`              | Visible canon gear laid on the pose (`CarlPose.gear`): gauntlet, cloak, shirt band, toe ring, pedicure shine.                                                                                       |
| `props.ts` + `props/*` | The held-prop hook (`HeldProp`, `PropPainter`, `PropReach`, `PROP_ART`) and one file per prop. `props/hammer.ts` is the shape to copy; `props/reach.ts` holds shared reach helpers.                 |
| `figure.ts`            | Draw order and composition: `drawCarlFront` / `drawCarlBack` / `drawCarlSide`, the composing surface, the silhouette outline, cast shadows between parts, the bounce rim.                           |

**Choreography** — `src/sprites/art/human/`, split by row family. Each file fills
`CarlPose`s and knows nothing about paint.

| File                                                                         | Owns                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `timing.ts`                                                                  | Row lengths, impact frames, per-frame holds. A leaf: gameplay derives its hit ticks from these.                                                                                                                                                        |
| `figureScale.ts`                                                             | `HUMAN_SCALE`, `TILE_SCALE`, `HUMAN_CELL_PX_PER_UNIT`, kept apart from the cell so the gait can import them without a cycle.                                                                                                                           |
| `gaitShared.ts`                                                              | What several families share: `blink`, the arm hang, arms posed by their joints (`armReaching`, `anglesThrough`), `bisect`, keyed tracks (`trackAt`, `fromRest`, `frameValue`), the rolling foot, leg reach at a knee bend, `springLag`, the arm swing. |
| `locomotion.ts`                                                              | Walk and run cycles, their starts and stops, in all three views; `RUN_RADIANS_PER_PX` / `WALK_RADIANS_PER_PX`.                                                                                                                                         |
| `idles.ts`                                                                   | The breathing idle, the guard, the guard drop, the fidgets.                                                                                                                                                                                            |
| `strikesSide.ts` / `strikesUp.ts` / `strikesDown.ts`                         | The strike family of each view (profile, from behind, head-on).                                                                                                                                                                                        |
| `stomps.ts`                                                                  | Smush, standing and hopping.                                                                                                                                                                                                                           |
| `travelling.ts`                                                              | What every blow thrown on the move shares: entry phases, the kicking leg per entry, swing feet drawn back into reach.                                                                                                                                  |
| `actionsBuild.ts` / `actionsThrow.ts` / `actionsSling.ts` / `actionsMisc.ts` | Rows systems ask for: build/place/repair; dynamite light/hold/throw; the sling shot; shell cast, drink, grab, chest open, talk.                                                                                                                        |
| `reactions.ts`                                                               | Rows done to him: hurt (front and behind), stagger, struggle, knockdown, knocked out, revive, death.                                                                                                                                                   |
| `appearance.ts`                                                              | Outfits: `HumanAppearance`, `humanFigureWearing`, `dressedPose`, the gauntlet's per-frame form.                                                                                                                                                        |
| `probe.ts`                                                                   | `probeHumanJoints(row, frame)`: joints in cell pixels, read off the skeleton the painter solves, for gates and runtime anchors.                                                                                                                        |

**Row table and figure** — `src/sprites/art/humanFigure.ts`: cell geometry
(`FRAME_W`, `TILE_X`, `TILE_Y`, `GROUND_OFFSET_IN_TILE`, `ORIGIN_X/Y`),
`HUMAN_ROW_NAMES`, `HUMAN_ROW_TABLE`, `HUMAN_ROWS`, `paintDressedHumanFrame`,
and `HUMAN_FIGURE`.

**Shared by every painted figure** — `src/sprites/art/carlArt.ts` holds only the
small maths and colour helpers (`Pt`, `deg`, `lerp`, easing, `hump`, `mix`,
`rgba`, `clampAlpha`) that a dozen figures import. `src/sprites/art/softShade.ts`
is the soft-shading module (below).

**Runtime** — `src/sprites/humanSprite.ts` (view selection, row timing helpers,
the active outfit, prewarm, drawing), `src/sprites/humanAnimator.ts`,
`src/sprites/humanReactions.ts`, `src/sprites/slingshotCarrySprite.ts`,
`src/creatures/humanGestures.ts`. The `game-architecture` skill describes them.

## The soft-shading module

Canvas has no cheap blur, so every soft shadow, highlight and crease is layered
gradients and strokes. `src/sprites/art/softShade.ts` exists so no figure
re-invents the traps:

- **`fillSoftEllipse`** — a radial fade from a colour to _its own_ transparent
  twin, rotated to the form's axis. A flat-alpha shape leaves a hard rim that
  reads as a crease where there is no anatomy; a hand-kept `_FADE` constant
  drifts from its solid. Its alpha multiplies into the caller's `globalAlpha`,
  so a faded figure fades its shading with it.
- **`strokeSoftCrease`** + **`CREASE_LAYERS`** — one crease stroked several
  times, widest and faintest first. A single even stroke reads as ink on the
  skin however dark it is. A figure painted small passes a shorter table
  (`FIGURE_CREASE_LAYERS` in `carl/paint.ts` has two steps: at the 32 px tile
  the extra steps land in the same pixels and each costs a full stroke).
- **`taperedCreaseGradient`** — a crease that fades out along its own length,
  instead of ending in a hard cap.
- **`withClip`** — clip, paint, restore in a `try/finally`. Interior shading is
  deliberately oversized so the clip ends it; a painter that throws mid-clip
  would otherwise leave that clip on the save stack for every later frame.

**Never shade a form with two concentric soft shapes.** A shade ellipse and a
highlight ellipse sharing a centre put the terminator on a circle: airbrushed
onto a flat board. Offset light and shade along the form's own axis.

## Palette, outline and shading

- **Seven-step hue-shifted ramps** (`Ramp` in `palette.ts`: `deep`, `shadow`,
  `dark`, `mid`, `base`, `light`, `rim`). Going down, the hue cools and
  saturation rises; going up, warmer and paler. A ramp mixed toward black greys
  every shadow into mud, which reads as dirt at the tile. `base` sits two steps
  below the top so the highlight has somewhere to go. Glossy leather adds a
  `specular` step (`GlossRamp`).
- **A receding limb is the same material in less light**: `receded` moves each
  step toward the ramp's own `shadow`, never toward the outline.
- **The outline is the silhouette only.** No part draws its own. `figure.ts`
  composes the parts on a surface of its own, then dilates the finished
  silhouette into a one-screen-pixel line (`OUTLINE_PX`) in a warm plum at
  partial alpha (`SILHOUETTE_OUTLINE`), not near-black. Drawn per part, every
  arm over the chest gets an ink ring and the figure reads as a paper doll.
  `OUTLINE` is ink for genuine dark marks only (pupil, mouth line, nostril).
- **Internal boundaries are value separation, not ink.** Each form is traced,
  filled with its `base`, clipped, and shaded in its own frame by `shadeForm`
  so the terminator runs along the anatomy. Where one form sits on another,
  `castShadow` lays a cool dark band **and** a lit sliver beyond it — the sliver
  is what says "one form on another". `crease` is a soft dark core with a
  bounce highlight on the lower lip. A cool rim along the shadow side keeps the
  edge off the darkest floor.
- **Detail under about two pixels at the 32 px tile is noise.** Leave it out
  (the jacket's pocket zips are omitted for that reason) or gate it by drawn
  size.

## The row table

Every row is one entry in `HUMAN_ROW_TABLE`, keyed by `HUMAN_ROW_NAMES`, so a
row cannot exist on one side only. The runtime chooses rows from this metadata,
never from names — a new row plugs in by being declared.

| Field                              | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frameCount`, `view`, `kind`       | `kind` is `loop` (sampled evenly, must close on frame 0) or `oneShot`.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `mirrorable`                       | Painted facing +X, flipped at blit time for −X.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `impactFrames`                     | Frames a blow lands on. Gameplay scores the hit on the tick this frame is drawn.                                                                                                                                                                                                                                                                                                                                                                                                            |
| `role`                             | What the animator plays it for: `idle`, `guard`, `drop`, `fidget`, `start`, `stop`, `strike`, `stomp`, `action`, `reaction`. A row without one is drawn only when named.                                                                                                                                                                                                                                                                                                                    |
| `locomotion`                       | `planted` (feet hold where they were put), `travelling` (a stance foot holds its ground position while the sprite carries him), `none`.                                                                                                                                                                                                                                                                                                                                                     |
| `gait` / `bridges`                 | A cycle's gait (`walk` / `run`); on a start or stop, the gait it bridges to or from standing.                                                                                                                                                                                                                                                                                                                                                                                               |
| `entryFootPhase` / `exitFootPhase` | The cycle phase, **as a fraction of the cycle in [0, 1)**, 0 at right-foot contact, whose leg pose the first / last frame matches.                                                                                                                                                                                                                                                                                                                                                          |
| `stampAnchor`                      | Where the stamping heel lands on the impact frame, in tile fractions; the runtime spawns the Smush blast there.                                                                                                                                                                                                                                                                                                                                                                             |
| `eventFrames`                      | Named frames a system synchronises to (`fuseLit`, `release`, `cast`, `lidUp`, `strike`). Pass them to `onFrame`; never copy the numbers.                                                                                                                                                                                                                                                                                                                                                    |
| `ticksPerFrame` / `frameTicks`     | Holds for a clock-paced row; `frameTicks` is per frame and wins (the idle's blink is one short frame among long breaths).                                                                                                                                                                                                                                                                                                                                                                   |
| `strike`                           | `tags` (`punch`, `kick`, `low`, `punt`, `stomp`, `high`, `long`, `finisher`, `downed`), `comboSlots` (0 is the opener), `standing` (on a travelling blow, the standing row it replaces), `reachLimb` (required: the part that lands it — a fist, foot, knee or the lead shoulder — and on a punch the fist the gauntlet's steel goes round), `drive` (`down` for a stamp, hammer-fist or knee drop; gate G5 checks the part is driven furthest, or stops coming down, on the impact frame). |
| `levelUpOrder`                     | A fidget's place in the level-up gestures.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Profile strikes are thrown from an orthodox guard facing +X: the left hand and
foot lead (far side), the right are rear (near side).

## Locomotion: a planted foot does not move relative to the floor

- **The stride is solved, not chosen.** The sprite is carried over the ground at
  the player's speed, so a stance foot must slide back through the cell at
  exactly that rate. Each cycle's ground per cycle comes from leg reach at
  contact and push-off; `RUN_RADIANS_PER_PX` / `WALK_RADIANS_PER_PX` turn it into
  radians per world pixel, and the animator advances the phase by **ground
  actually covered** (measured from position, never from `isMoving`), capped at
  one frame a tick (`MAX_GAIT_ADVANCE_PX_PER_TICK`) so a shove never strobes the
  legs. Sprinting keeps the radians per pixel and shows as cadence.
- **Walk or run is chosen by measured speed** at a Froude-number threshold, with
  hysteresis (`RUN_SPEED_ENTER_PX_PER_TICK` / `RUN_SPEED_EXIT_PX_PER_TICK`). His
  base speed is a run; wading is always a walk.
- **The run has a real flight phase**: five stance frames of eight per step, so
  37.5% of the cycle has both feet off the floor, matched to Muybridge's runner
  at a racing pace. The hip rides a ballistic arc in flight and sinks after
  contact. Contact is on the forefoot with the knee bent; push-off is on the
  toes. G14 holds the run's flight share to a band and the walk to none.
- **The walking pelvis vaults over the planted leg** (`walkHipHeight`): it rides
  the lower of the two stance legs' reach arcs, which is what drops it at
  contact.
- **Every view is driven from one side-on model of each foot.** Head-on, "ahead"
  becomes `leftFootDepth` / `rightFootDepth`, and the rig draws depth as screen
  height through `depthShareAt`: on the floor at `HEAD_ON_FLOOR_FORESHORTENING`
  of its extent, fading out toward hip height (a knee driven at the camera must
  still read as lifted). The floor is foreshortened because the figure stands
  upright over a floor seen from above: at the floor's own scale a planted foot
  slides the whole stride down the screen while the hips ride with the sprite,
  and the leg between them grows and shrinks through every stance. So head-on a
  planted foot slides back through the cell by that share of the ground covered
  (`floorDriftPerFrameCellPx` in `probe.ts`), the hips carry the rest, and G10
  holds the foot to that foreshortened floor while G26 holds the legs to their
  length. Each head-on run view lays its feet out on a `FacingTrack`
  (`runFacingTrack` in `locomotion.ts`): the recovering heel flares out beside
  the planted leg so two legs never share one column, and a swinging foot's
  lift is raised behind the hip (`kickLift`) and lowered ahead of it
  (`reachLift`), because head-on the flight's split is depth the camera cannot
  show — without them two feet a little off the floor under bent knees read
  as a squat, where Muybridge's oncoming runner shows a heel flicked up and a
  leg reaching long. The head-on run rows also carry the whole figure up its
  flight (`runFacingCycle`); blows thrown on the move take `runFacing`
  unlifted, because they put a foot back down in frames the run is airborne.
  Anything that places a run foot head-on goes through `placeFoot`, which
  applies the view's track.
- **Loose parts are damped springs** driven by the row's own phase (`springLag`),
  written into the pose's lag fields. Deterministic per frame, no history.
- **Starts and stops are cut where the legs already agree.** A stride stops only
  within `HAND_OFF_FRAMES` of its stop's `entryFootPhase`, finishing the stride
  to reach it; setting off goes through the gait's start. G20 replays these cuts
  and holds each to the stride's own largest frame-to-frame step.

## Moving strikes

A blow's impact frame is tied to the tick its hit lands, so a blow thrown on the
move cannot wait for the stride. **He never throws a standing blow while
moving** — the standing picture carried over the floor is a frozen slide. Each
travelling blow is painted once per entry phase in `TRAVELLING_ENTRY_PHASES`
(five versions per row in profile, four head-on and from behind), the legs
carried on from that phase by the run's own feet; the upper body's beats are the
same in every version. The animator throws the version whose legs begin
nearest the stride on screen. A Smush on the move is a hop in along the run,
chosen the same way.

## Handedness: the front view is a mirror

Every pose is authored with **his right side at +X**, which is where it lies seen
from behind. Facing the camera his right is on the viewer's left, so
`VIEWS.front.mirrored` is true and the rig paints `poseAsDrawn(pose, view)` —
`mirrorPose` for the front view, every sided field swapped. Only geometry is
reflected; the light stays upper left.

- Choreography places one limb relative to another in the **authored** pose.
- Anything that reads the **drawn** picture — the painter, the probe, a gate
  measuring ink — goes through `poseAsDrawn`. `drawnSide(side, view)` says which
  pose field carries his own `side` in a view.
- G22 fails any head-on frame whose right side is not where its view puts it.
  Every other gate is symmetric under a reflection and cannot see this.
- A profile row facing −X is flipped at blit time, so gear on one hand shows on
  the other hand when he faces left. That is a property of mirroring a shared
  cell, not a bug to fix per row.

## Pose fields worth knowing

`CarlPose` in `carl/rig.ts` documents every field; these are the ones a new row
most often needs and gets wrong. Optional fields default to "absent is neutral".

- **Targets and FK.** Hands and feet are IK targets. `leftArmAngles` /
  `rightArmAngles` (`ArmAngles`: `upper`, `fore`, `foreScale`) win for that arm
  when set — required for any swinging arm, and for a head-on forearm raised
  toward the camera. Pose an arm by its angles with `setArmAngles`, which sets
  its upper-arm share (below) in the same call. `foreScale` and the upper-arm
  share are the only way a 2D segment foreshortens.
- **Elbows.** `elbowFlare` picks the side a solved elbow bends to head-on only.
  Edge-on both elbows always flex forward, as both knees do: a near arm bent
  backward throws its elbow over the shoulder and lays the arm across the face
  (G25). `leftUpperArmScale` / `rightUpperArmScale` draw an upper arm short
  when it points at the camera, however the arm is solved — the head-on guard's
  fists can only reach the jaw with the elbows down that way.
- **Head-on depth.** `leftFootDepth` / `rightFootDepth` (ahead of the hip, drawn
  as screen height), `leftHandDepth` / `rightHandDepth` (only the painting
  order: a hand far enough on the camera's far side paints its arm behind the
  torso), `leftArmBehind` / `rightArmBehind` (per view, never per frame),
  `torsoPitch` (the chest bent toward or away from the camera, shown as the
  spine foreshortening), `leftFootScale` / `rightFootScale` (a foot driven at the
  camera grows), `leftForeshorten` / `rightForeshorten` (1 on every head-on leg)
  and `leftLegNearness` / `rightLegNearness` (widths only; may differ per leg).
- **Body.** `bob`, `sway`, `lean` (in-plane), `crouch`, `twist`, `pelvisDrop`,
  `chestRise` (the rib cage lifting off the waist; a standing figure's only way
  to rise, because his legs are within a hair of full reach), `spineBend`
  (profile only; a bend at the waist on top of `lean`, so a lying body curves).
- **Face.** `headTurn`, `headTilt`, `chinLift`, `gazeUp`, `brow`, `mouth`,
  `mouthWidth`, `blink`.
- **Hands and props.** `leftHandShape` / `rightHandShape` (`relaxed`, `open`,
  `grip`), `leftFist` / `rightFist`, `heldProps` (each `HeldProp` names its
  `kind`, `hand`, `angle` relative to the grip's haft, `scale`, `variant`, and an
  optional `tether` — a figure-space point a corded prop's free end runs to),
  `palmGlow` (painted over the finished figure, outline and all).
- **Secondary motion.** `jacketHemLag`, `leftBoxerFlutter` /
  `rightBoxerFlutter`, `hairTuftLag`: the free edge's displacement from rest;
  the attached edge never moves.
- **Planted flags.** `leftFootPlanted` / `rightFootPlanted` — set by every
  locomotion row, because head-on a planted foot's screen height cannot tell
  standing from stepping.
- **Gear.** `gear` is laid on by the outfit's dresser, never by choreography.

A prop states its own reach (`PropReach`): the composing surface is sized round
the skeleton and whatever each prop says it reaches, and ink past it is sheared
off. G23 repaints every cell on a full-cell surface and fails any difference.

## Outfits

A cell is keyed on `(figure, state, frame)` and shared by every draw, so gear
cannot be a draw parameter. Each combination of visible gear is a figure of its
own (`humanFigureWearing`), painted from the same rows through a dresser that
lays `CarlPose.gear` on every pose; the default outfit is `HUMAN_FIGURE` itself.
Only the outfit he wears is resident: `setHumanAppearance` in `humanSprite.ts`
releases the old figure outright (`releaseFigure`) and prewarms the new one's
always-drawn rows. `HumanPlayer.syncAppearance` runs it on equipment change and
on every draw (cheap when nothing changed), and re-asks the animator's and the
stand-by warm requests, which went to the figure he took off.

## Diagonals snap to a cardinal view; there is no three-quarter view, on evidence

`viewForFacing` in `humanSprite.ts` picks the view: north of −0.5 is drawn from
behind (tested first), otherwise sideways past 0.5 is profile, otherwise
head-on. So a south diagonal draws in profile and a north diagonal from behind.

A front-3/4 view was tried with the existing `ViewSpec` knobs: `girth` about
0.85 and `crotchNotch` about 0.6; the head-on painters with the face and jacket
front slid across; a near-side ear and lengthwise feet; and a skeleton rebuilt
from the profile pose's forward and height and the head-on pose's sideways,
projected at 45°.

Two blind reviewers each picked the turned figure as the better _direction_
cue. Both rated it worse than the profile for realism and at 32 px: "the torso
is square to the camera but the legs stride flat across the screen — the hips
look dislocated", and a scuttling crouch. A 45° leg is also drawn at about 0.7
of its length, so a kick shrinks from 5–6 px of foot past the body to 1–2 px.
The head-on view was the worst of the three for a diagonal.

The flaw is structural. Sliding features across head-on painters does not
rotate a pelvis or shoulders, and rows cannot be derived from the profile and
head-on poses. A real three-quarter view needs its own trace for every part and
its own authored row for every family — about a hundred more rows. It also adds
about 13 MB of always-warm cells (run, start/stop, idle and guard, plus opener
wind-ups, in two more mirrored views) to a working set already close to Carl's
56 MB budget. Spend realism effort on the three cardinal views instead.

## Anchors frozen off the art

Nothing can measure ink at runtime, so these are measured once and re-measured
by a gate on every render:

- `HUMAN_SPRITE_TOP_ABOVE_TILE` in `HumanPlayer.ts`: the top of his hair sits
  21.5 px above the tile anchor at the 32 px tile, frozen as 22 so the health bar
  clears it. With the sole line and `HUMAN_HALF_WIDTH_TILES` it forms
  `HUMAN_STATUS_FIGURE_BOX`, which the health bar, aggro marker and every status
  effect hang off. G21 re-measures it.
- `GROUND_OFFSET_IN_TILE` in `humanFigure.ts` is a whole cell row
  (`GROUND_ROW_IN_TILE`), because the composing surface is laid on the pose's
  origin and a fractional origin smears every one-pixel mark across two rows.
- The waterline when he wades is read off the solved rig of his standing pose,
  not frozen.
