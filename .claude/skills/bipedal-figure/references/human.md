# The human figure, file by file

The human rig is the one figure in this game whose movement convinces, and the only one
split finely enough to show where each concern belongs. Read this before
changing him, and before copying his structure into another figure.

Constants named here are the source of truth; grep them before relying on a
value quoted beside them.

## Where everything lives

**Painter** — `src/sprites/art/biped/`. Knows nothing about animation; paints one
`BipedPose` in one view.

| File                   | Owns                                                                                                                                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `geometry.ts`          | Point arithmetic in figure space (tile units, origin between the feet, +Y down).                                                                                                                                                                               |
| `palette.ts`           | The material ramps (`SKIN`, `LEATHER`, `COTTON`, `HAIR`), `receded`, the silhouette-outline tone, rim/sheen/crease alphas, and `LIGHT`, the key-light direction.                                                                                               |
| `proportions.ts`       | Height, heads-tall, every joint height, bone lengths, widths, head radii. `FIGURE_HEIGHT` and `HEADS_TALL` pin everything else.                                                                                                                                |
| `rig.ts`               | `ViewSpec` and `VIEWS` per `CardinalView` (from `src/sprites/facingView.ts`), `BipedPose`, `ArmAngles`, `restingPose`, handedness (`mirrorPose`, `poseAsDrawn`, `drawnSide`), the two-bone IK, `buildSkeleton`, and the head-on depth projection.              |
| `paint.ts`             | The primitives every part is built from: capsule traces, `shadeForm` / `shadeClipped`, `castShadow`, `crease`, the contact shadow.                                                                                                                             |
| `head.ts`              | Skull, face planes, features, ears, hair, and the neck.                                                                                                                                                                                                        |
| `torso.ts`             | The jacket, collar and collar rim, each painted by the base jacket garment through its part frame.                                                                                                                                                             |
| `sleeve.ts`            | The shoved-up leather sleeve over the upper arm and the deltoid cap under it.                                                                                                                                                                                  |
| `limbs.ts`             | Bare arm and leg silhouettes and their muscle forms, the hand in its three shapes, `handGrip`, `wristAngle`.                                                                                                                                                   |
| `feet.ts`              | The bare foot, one silhouette per view; sole landmarks the probe and gates read.                                                                                                                                                                               |
| `bipedParts.ts`        | The part frames handed to garments (head, torso, neck, hips, forearm, leg, back, foot) and `BipedDressing`.                                                                                                                                                    |
| `props.ts` + `props/*` | The row props' painters (`HeldProp`, `PropPainter`, `PropReach`, `PROP_ART`), one file per prop, run by their held visuals in `src/sprites/held/art/scriptedPropHeld.ts`. `props/hammer.ts` is the shape to copy; `props/reach.ts` holds shared reach helpers. |
| `grip.ts`              | The hand closed round a handle: palm, four finger bands and a thumb wrapped round a cylinder, each segment sorted to the front or back grip layer by its normal.                                                                                               |
| `handSockets.ts`       | Each hand of a drawn pose solved on the painter's own skeleton: what it holds (nothing, the row's prop, an equipment-chosen item), the handle's axis, the palm normal, the solved grip.                                                                        |
| `figure.ts`            | Draw order and composition: `drawBipedFront` / `drawBipedBack` / `drawBipedSide`, the composing surface, the silhouette outline, cast shadows between parts, the bounce rim.                                                                                   |

**Garments** — `src/sprites/garments/human/`, one file per garment (each look's base garments, then each wearable) plus `humanDressing.ts`, which turns an outfit into the `BipedDressing` the compositor reads. See "Outfits" below.

**Choreography** — `src/sprites/art/human/`, split by row family. Each file fills
`BipedPose`s and knows nothing about paint.

| File                                                                                                                          | Owns                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `timing.ts`                                                                                                                   | Row lengths, impact frames, per-frame holds. A leaf: gameplay derives its hit ticks from these.                                                                                                                                                                                                                           |
| `figureScale.ts`                                                                                                              | `HUMAN_SCALE` (the rig's size, for every figure built on it), `PLAYER_HUMAN_SIZE_OVER_RIG` (how much larger the player's own figure is drawn; `playerLookAxes`, his cell and his gait pacing all carry it), `TILE_SCALE`, `HUMAN_CELL_PX_PER_UNIT`, kept apart from the cell so the gait can import them without a cycle. |
| `gaitShared.ts`                                                                                                               | What several families share: `blink`, the arm hang, arms posed by their joints (`armReaching`, `anglesThrough`), `bisect`, keyed tracks (`trackAt`, `fromRest`, `frameValue`), the rolling foot, leg reach at a knee bend, `springLag`, the arm swing.                                                                    |
| `locomotion.ts`                                                                                                               | Walk and run cycles, their starts and stops, in all three views; `RUN_RADIANS_PER_PX` / `WALK_RADIANS_PER_PX`.                                                                                                                                                                                                            |
| `idles.ts`                                                                                                                    | The breathing idle, the guard, the guard drop, the fidgets.                                                                                                                                                                                                                                                               |
| `strikesSide.ts` / `strikesUp.ts` / `strikesDown.ts`                                                                          | The strike family of each view (profile, from behind, head-on).                                                                                                                                                                                                                                                           |
| `stomps.ts`                                                                                                                   | Seismic Stomp, standing and hopping.                                                                                                                                                                                                                                                                                      |
| `travelling.ts`                                                                                                               | What every blow thrown on the move shares: entry phases, the kicking leg per entry, swing feet drawn back into reach.                                                                                                                                                                                                     |
| `actionsBuild.ts` / `actionsThrow.ts` / `actionsSling.ts` / `actionsMisc.ts`                                                  | Rows systems ask for: build/place/repair; dynamite light/hold/throw; the sling shot; shell cast, drink, grab, chest open, talk.                                                                                                                                                                                           |
| `reactions.ts`                                                                                                                | Rows done to him: hurt (front and behind), stagger, struggle, knockdown, knocked out, revive, death.                                                                                                                                                                                                                      |
| `appearance.ts`                                                                                                               | Outfits: `humanFigureFor` / `humanFigureWearing` keyed by an `Outfit<'human'>`, `dressedPose`, `garmentRowOf` (what a row tells garments that move with it).                                                                                                                                                              |
| `probe.ts`                                                                                                                    | `probeHumanJoints(row, frame)`: joints in cell pixels, read off the skeleton the painter solves, for gates and runtime anchors.                                                                                                                                                                                           |
| `sockets.ts`                                                                                                                  | `humanSocketsAt(figure, row, frame)`: `mainHand` (his right), `offHand`, `back`, `hip` in cell pixels, memoised per figure, row and frame; `mirroredSocket`; `stampAnchorOf` (where a Seismic Stomp heel lands).                                                                                                          |
| `handTurn.ts` / `carry.ts`                                                                                                    | Authoring a gripping hand's turn in depth (`turnHand`, palm normals); how a carried item is held on rows not authored for it (`carryInMainHand`, `CarriedGrip`).                                                                                                                                                          |
| `motionSets.ts` / `armedRows.ts` / `armedHold.ts` / `armedStrikes.ts` / `holster.ts` / `stowedGeometry.ts` / `weaponReach.ts` | The rows a weapon out in his hand plays, by grip and weight: the set an item picks, the armed row table, stance and stride holds, keyed blows and their travelling versions, draw and stow, where a stowed weapon rests, where a weapon blow lands. See "Motion sets" below.                                              |

**Row table and figure** — `src/sprites/art/humanFigure.ts`: cell geometry
(`FRAME_W`, `TILE_X`, `TILE_Y`, `GROUND_OFFSET_IN_TILE`, `ORIGIN_X/Y`),
`HUMAN_ROW_NAMES`, `HUMAN_ROW_TABLE`, `HUMAN_ROWS`, `paintDressedHumanFrame`,
and `HUMAN_FIGURE`.

**Shared by every painted figure** — `src/sprites/art/bipedArt.ts` holds only the
small maths and colour helpers (`Pt`, `deg`, `lerp`, easing, `hump`, `mix`,
`rgba`, `clampAlpha`) that a dozen figures import. `src/sprites/art/softShade.ts`
is the soft-shading module (below).

**Runtime** — `src/sprites/humanSprite.ts` (view selection, row timing helpers,
the active outfit, prewarm, drawing), `src/sprites/humanAnimator.ts`,
`src/sprites/humanReactions.ts`,
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
  (`FIGURE_CREASE_LAYERS` in `biped/paint.ts` has two steps: at the 32 px tile
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

| Field                              | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frameCount`, `view`, `kind`       | `kind` is `loop` (sampled evenly, must close on frame 0) or `oneShot`.                                                                                                                                                                                                                                                                                                                                                              |
| `mirrorable`                       | Painted facing +X, flipped at blit time for −X.                                                                                                                                                                                                                                                                                                                                                                                     |
| `impactFrames`                     | Frames a blow lands on. Gameplay scores the hit on the tick this frame is drawn.                                                                                                                                                                                                                                                                                                                                                    |
| `role`                             | What the animator plays it for: `idle`, `guard`, `drop`, `fidget`, `start`, `stop`, `strike`, `stomp`, `action`, `reaction`. A row without one is drawn only when named.                                                                                                                                                                                                                                                            |
| `locomotion`                       | `planted` (feet hold where they were put), `travelling` (a stance foot holds its ground position while the sprite carries him), `none`.                                                                                                                                                                                                                                                                                             |
| `gait` / `bridges`                 | A cycle's gait (`walk` / `run`); on a start or stop, the gait it bridges to or from standing.                                                                                                                                                                                                                                                                                                                                       |
| `entryFootPhase` / `exitFootPhase` | The cycle phase, **as a fraction of the cycle in [0, 1)**, 0 at right-foot contact, whose leg pose the first / last frame matches.                                                                                                                                                                                                                                                                                                  |
| `eventFrames`                      | Named frames a system synchronises to (`fuseLit`, `release`, `cast`, `lidUp`, `strike`). Pass them to `onFrame`; never copy the numbers.                                                                                                                                                                                                                                                                                            |
| `ticksPerFrame` / `frameTicks`     | Holds for a clock-paced row; `frameTicks` is per frame and wins (the idle's blink is one short frame among long breaths).                                                                                                                                                                                                                                                                                                           |
| `strike`                           | `tags` (`punch`, `kick`, `low`, `punt`, `stomp`, `high`, `long`, `finisher`, `downed`), `comboSlots` (0 is the opener), `standing` (on a travelling blow, the standing row it replaces), `reachLimb` (required: the part that lands it — a fist, foot, knee or the lead shoulder —), `drive` (`down` for a stamp, hammer-fist or knee drop; gate G5 checks the part is driven furthest, or stops coming down, on the impact frame). |
| `levelUpOrder`                     | A fidget's place in the level-up gestures.                                                                                                                                                                                                                                                                                                                                                                                          |

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
  hysteresis, per look by its height (`gaitThresholdsOf(look)` in
  `human/locomotion.ts`). His
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
nearest the stride on screen. A Seismic Stomp on the move is a hop in along the run,
chosen the same way.

## Views and facing: five views, three painted

`src/sprites/facingView.ts` is the one facing model for both crawlers.
`FACING_VIEWS` is `front`, `frontDiagonal`, `side`, `backDiagonal`, `back`;
`CARDINAL_VIEWS` (`CardinalView`) are the three the rig paints (`VIEWS` in
`biped/rig.ts` is keyed by them).

- **`selectFacing(fx, fy, previous)`** maps a facing to a `FacingSelection`
  (`view` + `flipX`) from eight 45° sectors. With `previous` it holds that view
  until the facing passes the sector edge by `FACING_HYSTERESIS_DEGREES`, so a
  phone stick wobbling on an edge never flickers; asked again with its own
  answer it returns the same thing. A zero facing keeps `previous`.
- **`FacingState`** remembers one figure's selection between ticks:
  `update` moves it on (the animator calls it once a tick), `peek` asks what a
  facing would draw without moving it (a strike, a Seismic Stomp or a draw latches its
  view this way). `HumanPlayer.facing` is shared with his animator;
  `isTurnedView` is true for the profile and both diagonals. It is the
  five-view `HeldFacing`; a figure painted only head-on, away and in profile
  holds a `HeldFacing` of `selectCardinalFacing` (the dominant axis, a tie
  going to the profile, with the same hysteresis margin) instead.
- **The fallback.** The human has no diagonal rows. `HUMAN_VIEW_FALLBACK`
  (`src/sprites/humanViews.ts`) draws `frontDiagonal` in profile and
  `backDiagonal` from behind; it is the only place a missing view is filled
  in. `HumanRowView` (the views he has rows for), `humanRowView(view)` and
  `viewRow(rows, view)` in `humanSprite.ts` route every view-keyed lookup
  through it, and `ViewRows` requires a row for every `HumanRowView`: delete a
  fallback entry and the compiler lists every table missing that view.
  Garments borrow the same choice through `humanViews` /
  `humanEveryView` (`src/sprites/garments/human/views.ts`), since a garment
  painter must exist for every `FacingView`.
- **Any test of "which way is he facing" goes through the selection**, never
  through the sign of `fx` or `fy`: a row's view, its mirroring, a mouth's
  lean, a tool's side all read the drawn row's view.

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

`BipedPose` in `biped/rig.ts` documents every field; these are the ones a new row
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
- **Secondary motion.** `jacketHemLag`, `hairTuftLag`: the free edge's displacement from rest;
  the attached edge never moves.
- **Planted flags.** `leftFootPlanted` / `rightFootPlanted` — set by every
  locomotion row, because head-on a planted foot's screen height cannot tell
  standing from stepping.
- **Outfit.** `outfit` (what he wears, plus the row and frame garments read) is
  laid on by `dressedPose` in `human/appearance.ts`, never by choreography.

- **Hand orientation.** `leftHandOrientation` / `rightHandOrientation`
  (`HandOrientation`: `palmNormal`, `haftDepth`, optional `haftAngle` and
  `haftShare` — a one-handed item turned out of the picture) on
  every hand a row closes on something, set with `turnHand` in
  `human/handTurn.ts`; `twoHandGrip` (which fist is at the butt, the grips'
  flat spacing) on a two-handed swing. A grip with no orientation is a plain
  fist round nothing (a sling's pinch).

A prop states its own reach (`PropReach`): the composing surface is sized round
the skeleton and whatever each prop says it reaches, and ink past it is sheared
off. G23 repaints every cell on a full-cell surface and fails any difference.

## Sockets, the grip and two-layer cells

What he holds is never a sticker over the finished figure.

- **Sockets** come out of the painter's own solve (`bipedHandSockets` in
  `biped/figure.ts`, published per cell by `human/sockets.ts`): centre, axis
  (camera space: x right, y down, z toward the camera), palm normal, the slab
  index the held thing sits in front of, and whether an equipment-chosen
  item is held there. `mainHand` is his right hand in every view; a mirrored
  cell mirrors its sockets (`mirroredSocket`) and keeps the hand. A two-handed
  haft's grip point is at the socket the frame names as its `butt`.
  `humanSocketsAt(source, row, frame)` memoises per figure id, row and frame.
  `occupied` means an equipment-chosen item is in that hand; `grips` means the
  hand is closed on anything, the row's own prop included. `back` and `hip`
  are where a stowed weapon rests (`stowedGeometry.ts`): never occupied; `back` lies
  over him seen from behind, `hip` in both head-on views, and otherwise each
  sits on the rearmost slab.
- **Orientation is authored per frame** beside the pose by every row that
  holds something: `turnHand(pose, side, palmNormal, haftDepth, haftAngle?)`
  (`human/handTurn.ts`, with `KNUCKLES_TO_CAMERA`, `PALM_TO_CAMERA`, `towards`,
  `rolled`, and `turnPropHands` for every hand holding a row prop) fills that
  side's `HandOrientation`; `TwoHandGrip` names the butt fist and the grips'
  flat spacing. The cardinal rows are hand-authored 2D, so
  depth is stated, not solved. Profile swings keep the palms at ±z; head-on,
  the butt fist's palm crossed with the haft points the way the head leads
  the swing (the axe's anticlockwise blow, the pick's clockwise one).
- **The grip** (`biped/grip.ts`) is computed, never drawn per frame: four
  finger bands and a thumb wrap a cylinder the handle's radius class thick
  (`HandOrientation.handle`, per hand: a carried weapon's class on the
  carrying hand, the tool haft's elsewhere) round the socket's axis, the palm block sits on the palm side, and each
  segment whose outward normal faces the camera is the front grip layer.
  Knuckles to the camera, the knuckles and palm lie over the handle; palm to
  the camera, the thumb and finger tips close over it.
- **Two layers.** A frame with an occupied socket is baked whole, plus a
  front layer cropped to its ink (`FigureDef.heldLayers`): every slab after
  the socket's, the front grip bands, the holding forearm when the back of
  the hand faces the camera (the handle lies on the palm's side of it), and
  the outline pixels that ring them. The outline and rim are built on the
  silhouette with a stand-in for the handle near each fist, so no outline is
  drawn across a handle where it leaves a fist. At runtime
  `drawFigureCached(..., between)` draws the cell, the item at its socket,
  then the front layer. A row's own prop is baked between the same layers by
  the same compositor (`compositeHeldItem`, `src/sprites/held/heldComposite.ts`)
  and keeps the outline the figure gives it.
- **Carrying.** A weapon out in his hand plays its motion set's rows (below);
  on a bare-handed row its set has none of its own for, it closes his right
  fist on it wherever the row leaves that hand free (`carryInMainHand`), one figure per carried grip
  (handle thickness × low or shouldered), so the cells are two-layered. A
  row with a prop in either hand, a tool in both or the Energy Shield's glow in that
  palm keeps its hands and the item is not drawn. The carry angle is turned
  off his face and out of the floor by a small search, the item's reach
  assumed per style.
- **Gates**: `npm run gates:equipment` (`--item=<id>`) holds E1 registration
  (each socket on its fist's wrist-to-knuckle line, the handle through the
  socket, fingers on it), E2 the cell border and the floor (head-on the
  floor ahead runs below his ground line; a tool head bites on its impact
  frame and the frame after; the scythe skims on the axe's backswing, see
  below), E3 not over his face unless a fist is there, E4 wrap, E6 a single
  row prop's bake against its runtime composite, E7 mirroring and the main
  hand. `npm run render:equipment` renders every item on its rows at the
  tile; `--part=hands` renders the grip through a roll at 6×.

Ceiling, the grip at close range: five rounds of fresh blind reviewers saw
the 6× roll (`render:equipment -- --part=hands --item=spiked_club`). From the
knuckle side, which is how every carry and blow holds a weapon, the later
rounds called it "a cartoon fist closed around a handle, acceptable at game
scale"; from the palm side, and as a whole, most still said "a fist stuck on
a stick": the bands are parallel capsules with banded tone, so nothing shows
them turning round the handle, and the turn through edge-on changes the
hand's construction in one step. Fixes tried: a thumb wound along the handle
onto the index finger and shortened so it no longer stands up; the palm
block moved to the palm side of the handle and kept in front until the palm
clearly faces the camera; finger girth tapered and the wrap carried past
three quarters of a turn so palm-out tips curl over the handle's front. Each
moved the read; none reached "fingers wrapped round a handle" twice running.
What is missing is per-band curl shading (each band darkening as it turns
away) and a fist outline that narrows edge-on; at the 32 px tile the whole
hand is three pixels and none of this shows.

Ceiling: Merrit's scythe is swung on the axe's profile chop, whose backswing
dips the long blade three pixels below the floor's line on two frames
(declared in `gates-equipment.ts`); a scythe swing of its own removes it.

## Motion sets: the rows a weapon plays

A weapon out in his hand picks the rows he moves and fights in by its grip
archetype and weight (`human/motionSets.ts`, `motionSetOf`):
`oneHandLight` (a sword), `oneHandHeavy` (a club), `twoHand` (a felling
axe, a scythe, a greatsword); a slingshot plays the bare-handed rows with the
stand-in carry. Every item of a set plays the same rows — a new sword is a
held visual and an item, nothing else.

- **Rows** live in `human/armedRows.ts`, named `<set>_<row><view>`
  (`light_slash_side`, `heavy_draw_away`, `twohand_sweep_run_side_3`) and
  marked `motionSet` in the row table; a draw or stow also carries
  `holster`. Light and heavy have idle, guard, guard drop, walk, run and their
  starts and stops; a two-hander has idle, walk and run, its stance being its
  guard. Strikes: light slash, backhand, chop, thrust; heavy smash, swing;
  two-handed sweep — each standing and in every travelling version.
- **Stance and stride** (`armedHold.ts`) are the bare-handed rows' own legs
  and body with the holding arm re-posed from a `Hold` (the fist placed from
  its shoulder joint, or both fists on a haft placed from the middle of his
  shoulders); the held arm keeps a share of the free arm's swing
  (`SWING_SHARES`), the item turning a little with the forearm. A two-hander
  rocks toward level with each step, never up across his face.
- **Blows** (`armedStrikes.ts`) are eight keyed frames per view: the fist's
  place, the item's screen angle, how much of it lies in the picture
  (`haftShare`) and which way it runs out, and what the trunk adds to the
  stance. The travelling versions lay the same keys over the run's legs at
  each entry phase, blended in from the run's carry (`TRAVELLING_BLEND`), the
  shoulders turned as far as the standing blow turns them. An overhead blow
  edge-on winds up behind his back, never with the near arm raised across his
  face (G25).
- **Draw and stow** (`holster.ts`): the hand reaches for where the weapon
  rests (`stowedGeometry.ts`, shared with the `hip` and `back` sockets),
  closes on it along the stowed axis, pulls it out and settles into the
  carry; the stow is the draw backwards. Until the fist closes the runtime
  draws the weapon at rest; `HumanPlayer` keeps a stowing weapon in hand while
  its stow plays.
- **Contract**: `strike.reachLimb: 'weapon'` — the main arm is driven
  furthest on the impact frame (G5), and the hit's contact point is out along
  the weapon (`weaponReach.ts`). Head-on his shoulders are too far apart for
  one fist to reach across to the other's side, so a two-hander's grip slides
  (the left fist takes the butt) while the head is out on his right.
- **The animator** plays the set's own idle, guard, drop, cycles, starts and
  stops and strikes; a set with none of a kind falls back as `restRowFor`,
  `cycleRow` and `strikingSet` say. With a weapon out he never fidgets and a
  level-up plays no gesture. Seismic Stomp, reactions and actions stay bare-handed
  rows, the weapon on the stand-in carry.
- **Wiring**: `HumanPlayer` reads the set off the drawn weapon's held visual
  and hands it to `HumanAnimator.setMotionSet`; a draw or stow calls
  `beginHolster(motion, set, fx, fy, onEnd)`, which plays the set's `holster`
  rows. The figure he is drawn as is keyed by `CarriedGrip` (handle class,
  carry style, motion set) through `setHumanHeld` in `humanSprite.ts`.
- **Residency is per set**: `alwaysDrawnRows(set)`, `openingStrikeRows(set)`
  and `residentViewSpans(set)` in `humanSprite.ts` name what stays warm with
  that set in his hand — the set's own rows replace the bare-handed ones, so
  arming swaps the working set rather than adding to it.
- **Memory**: the light set's family is the largest he has — G9b measures it
  as the cache stores it, ink crops and front layers, at 17.1 MB in Ryan's
  clothes and 22.0 MB on Dave in every garment (93.6 MB as whole cells) — so
  `HUMAN_FIGURE_BUDGET_MEGABYTES` is 28.

Ceiling, the armed rows head-on and from behind (four rounds of fresh blind
reviewers on the 32 px strips): every profile row — stance, stride, run and
each blow — and the draws were named every round with no major left. What
stayed major is what the camera cannot show of a blow driven at it or away
from it: head-on, a blade or club laid across his front at the hit sits over
his shorts and reads as a belt ("a bar across the waistband"); from behind,
the weapon is hidden by his back through the follow-through ("the sword
vanishes"); a two-hander head-on is held by fists that cannot leave his
centre, so the haft reads as turning round folded arms. Fixes tried: the hit
raised from the waist to the chest and the blade held across the picture
rather than at the camera; the back view's hidden frames held flat so the
length past his outline shows; the head-on two-hander's grips moved out to
the hip with the elbows less flared, the haft rocked with the stride, the
grip slid between fists on the wind-up. Each moved the read; none passed
twice running. What is missing is a three-quarter view for blows thrown
north and south (the arm and weapon would swing across the picture) and,
head-on, shoulders a two-handed grip can turn — the hand-authored head-on
pose keeps the shoulders square to the camera.

## Outfits

A cell is keyed on `(figure, state, frame)` and shared by every draw, so gear
cannot be a draw parameter. Everything he wears is a garment
(`src/sprites/garments/human/`): each look's own clothes are its base garments (Dave's jacket, jeans and boots, Ryan's shirt, belt, chinos, sneakers and watch),
then whatever is put on over them (the townsfolk's trousers and shoes on the
figures built on his rig).
The compositor (`biped/figure.ts`) paints no clothing itself: at each piece —
jacket, collar, hips, each forearm, each leg, the toes, the place behind or
over his back, the top of his head — it hands a part frame
(`biped/bipedParts.ts`) to a `BipedDressing`, and each garment covering that part
paints there, inside the slab. The pose carries what he wears
(`BipedPose.outfit`: the outfit plus the row and frame garments that move with
the row read); absent is his default outfit, his look's base garments with
nothing over them. Each
outfit is a figure of its own (`humanFigureWearing`), keyed by its sorted
garment ids; the default outfit is `HUMAN_FIGURE` itself. Only the outfit he
wears is resident: `setOutfit('human', …)` (`src/sprites/outfits.ts`, through
`setHumanOutfit` in `humanSprite.ts`) releases the old figure outright
(`releaseFigure`) and prewarms the new one's always-drawn rows.
`HumanPlayer.onEquipmentChanged` marks his outfit stale, and the private
`dressInGear` applies it — at once, or on his next draw for a change made while
he is being built — and re-asks the animator's and the stand-by warm requests,
which went to the figure he took off. Figures built on his rig (townsfolk, the
club cast, Baggi, the Demon Liaison, the city elf) carry a fixed outfit on their
poses. `npm run gates:equipment` (E5) holds every garment inside its part's
envelope; `scripts/render-garments.ts --wear=<ids>` renders one for review.

## Diagonals snap to a cardinal view; there is no three-quarter view, on evidence

`selectFacing` picks one of five facing views from eight 45° sectors, with a
hysteresis margin (see "Views and facing" above). the human has rows only for the
three cardinal views — bare-handed and armed alike — so `HUMAN_VIEW_FALLBACK`
(`src/sprites/humanViews.ts`) draws a south diagonal (`frontDiagonal`) in
profile and a north diagonal (`backDiagonal`) from behind, and his garments
borrow the same views. Every view-keyed table is five wide, so a later attempt
only adds rows and art and deletes the fallback entry.

Two attempts have been made, and both were rejected by blind review.

**First: head-on painters with features slid across.** `girth` about 0.85 and
`crotchNotch` about 0.6, the face and jacket front slid across, a near-side
ear and lengthwise feet, and a skeleton built from the profile pose's forward
and height and the head-on pose's sideways, projected at 45°. Reviewers: "the
torso is square to the camera but the legs stride flat across the screen —
the hips look dislocated", a scuttling crouch, and kicks shrinking to 1–2 px
(a 45° leg draws at about 0.7 of its length). Never retry this: sliding
features does not rotate a pelvis or shoulders.

**Second: a pose solved in three dimensions and projected, with a real
three-quarter trace for every part.** Walk, run and idle were authored once in
body space (hands and feet as 3D targets, pelvis and shoulder-girdle yaw,
pitch and roll, knee and elbow pole vectors, a 3D two-bone IK), projected
through a camera yaw of 45° and 135°, and painted by new traces: the jacket
and the skull as cross-sections (head-on half-width, profile depth in front
of and behind the spine) turned by the view, the zip off-centre on the front
centre line, the seam down his right side and the side panel it reveals, the
near cheek broad and the far eye foreshortened beside the nose, one ear, the
shorts' waist off the hip toward the seat, profile limb and foot traces with
the foot's length foreshortened by the sine of the turn, slab order read off
each limb root's projected depth. Every reviewer named each row as a man
walking or running toward or away from the camera at three-quarters. It
failed on one structural flaw, reported by four fresh reviewers in a row:

- **The body reads as turning on a turntable once a stride.** At 45° the
  fore-and-aft swing of arms and legs is drawn across the screen. Half a
  stride has the far arm forward and the near arm back, standing out either
  side of the chest — the figure reads square to the camera; the other half
  has the near arm over the chest and the far one hidden — it reads in
  profile. The legs do the same: their lateral spread adds to the stride on
  one step and subtracts on the next.
- **The run's rear thigh leaves the shorts at an odd angle** in the frames
  after push-off ("the hip looks unhinged"): the cuff, built to wrap a thigh
  swinging in the picture plane, does not follow one swinging at 45°.

Fixes tried, with their results:

1. Shoulder and pelvis counter-rotation cut from 6°/5° to 2° (walk) and from
   9° to 3° (run): no change in the read; the jacket and shorts are traced at
   the view's fixed yaw, so the girdle's turn only moved where the arms hang.
2. The body-space foot track narrowed from the head-on 0.135 to 0.06: the
   alternating cross-over and splay of the feet went away, the turntable read
   did not.
3. Arm swing cut to 0.7 of the profile's (walk) and 0.6 with a bent backswing
   (run), the arms rooted at the anatomical shoulder (`ARM_ROOT_HALF`) instead
   of the head-on spread: the arms stopped flaring, and reviewers then called
   them "barely swinging, stiff tubes" while still reporting the width pulse.

The limit is in the painter, not the pose: every part trace is drawn at the
view's one yaw while the limbs swing in three dimensions across it. A
three-quarter view that reads as one view needs the torso, hips and shorts
traced at the shoulder girdle's and the pelvis's own per-frame yaw, so the
chest turns with the arms rather than the arms sweeping over a fixed chest,
and a shorts cuff that wraps a thigh swinging toward or away from the camera.

The same 3D pose projected to the cardinal views lost what the hand-authored
rows have on purpose: the head-on shoulder spread (`FACING_SHOULDER_SPREAD`),
the exaggerated head-on arm swing and hip sway, the profile's `lateral` limb
spread, and the head-on arm draw order. The cardinal rows stay authored in two
dimensions per view.

Renders, kept locally under `preview/diagonal-spike/` (the preview folder is
not committed): `diagonal-strip32-final.png` and `diagonal-strip32-round1.png`
(the reviewed 32 px strips: walk toward, walk away, run toward, run away),
`diagonal-walk-frames.png` and `diagonal-frames-zoom.png` (frames 0, 4, 8, 12
of the walks, where the width pulse shows), `diagonal-head-zoom.png` (the
three-quarter head), `cardinal-parity-zoom.png` and `cardinal-parity-strip32.png`
(the projected cardinals beside the shipped rows), and `diagonal-spike.patch`,
which re-applies the whole attempt to the files as they stood when it was
shelved.

The memory cost was measured in whole cells: the idle and the run in both
diagonals add 48 always-warm cells. Every view is held warm (see the residency
decision in `add-sprite`), so diagonal rows add to every motion set's working
set too. The cache stores ink crops, about a fifth of a whole cell for him, so
re-measure G9b for every set when diagonal rows ship and raise
`HUMAN_FIGURE_BUDGET_MEGABYTES` to what it reports if it passes 28.

The cat has the same fallback (`CAT_VIEW_FALLBACK`, both diagonals in profile)
and her own failed three-quarter attempt; her ceiling and the painted
west-facing profiles are in `add-sprite`.

## Anchors frozen off the art

These are measured once off the painted cells and re-measured by a gate on
every render. The sole line is cell geometry and has to be frozen; the hair's
top is frozen debt, since `figureRowInkTop` in `figureFrameCache.ts` measures a
drawn row's top at runtime and could replace it:

- Each look's `figureExtent` (`HumanFigureExtent` in `looks/humanLook.ts`: the
  top of his hair above the tile anchor at the 32 px tile, rounded up to a whole
  pixel so the health bar clears it, and his half-width head-on). With the sole
  line it forms `humanStatusFigureBoxOf(look)` in `HumanPlayer.ts`, which the
  health bar, aggro marker and every status effect hang off, always for
  `activeHumanLook()`, never a look fixed at load. G21 re-measures it for every
  look it gates.
- `GROUND_OFFSET_IN_TILE` in `humanFigure.ts` is a whole cell row
  (`GROUND_ROW_IN_TILE`), because the composing surface is laid on the pose's
  origin and a fractional origin smears every one-pixel mark across two rows.
- The waterline when he wades is read off the solved rig of his standing pose,
  not frozen.

## Looks: Ryan and Dave

The rig and its rows are shared; who is painted is a `HumanLook`
(`src/sprites/looks/humanLook.ts`). Two player looks exist: Ryan
(`looks/humans/ryan.ts`) and Dave (`looks/humans/dave.ts`), both registered in
`src/characters/characters.ts`. Every human harness and gate takes
`--look=ryan|dave` (`scripts/humanLooks.ts`, Ryan by default), `?human&look=`
picks one in the preview, and `gates:equipment` checks every held item and
garment on both.

A look's build is data, never an edit to `proportions.ts`:

- `heightScale` / `widthScale`: the cell's scale down and across.
  `playerLookAxes` keeps the rig's own depth edge-on, because the travelling
  blows carry his stride across the profile in world pixels at the player's
  speed, and a profile drawn shallower would skate every planted foot.
- `headScale` / `headBreadth` / `headPivot`: the head drawn smaller or larger
  about a point `headPivot` of the way from eyes to chin (`scaleHeadAboutChin`
  in `head.ts`). Near the chin the neck keeps the rig's length; near the eyes it
  grows by what the head lost. Pushed too near the chin, a smaller head's eye
  sinks to where the heavy stow carries the arm past it (G25).
- `expression`: brows (`BrowShape`, `browTone`), anger, lips, `mouthSmile` and
  `eyes` (`EyeStyle`: whites head-on, iris shade, lid weight and ink — lightened toward the skin, since at the tile a black lid covers the eye — opening, a pupil).
  The rig's eye (`RIG_EYES`) is tuned for its game-sized head at the tile; at a
  real man's head size it reads as an eye screwed shut at review scale.
- `neckSoftness`: how softly the neck's light turns, against the rig's banded
  column.
- `shoulderSpread` / `hipSpread`: laid on every pose by `withLookBuild`, read by
  `buildSkeleton`; the painter, the probe and the sockets all solve the same
  skeleton. An arm hung by joint angles is swung about the look's own shoulder
  half-way toward where the rig's hand would hang
  (`HAND_SPREAD_FOLLOWS_SHOULDERS`, `rig.ts`), so narrow shoulders do not drop
  the hands over the thighs; a hand placed by a target stays where the row
  put it (on a haft, at the jaw).
- `limbs` (`LimbBuild` in `limbs.ts`): thigh, shin, upper arm and forearm
  girth, leg depth and upper-arm depth edge-on (a slim man's sleeve hangs
  over the middle third of his chest), foot width and length, and an open
  or relaxed hand's length and breadth (`handLength`, `handBreadth`; a
  closing fist comes back to the rig's, which the sockets are placed
  for). Every leg and forearm
  garment reads the same build (`legCover`, `bareSegmentEdges`,
  `scaleFootByBuild`), so cloth and boots keep fitting.
- `neckGirth`, `handSkin`, and the torso garment's `GarmentCut`
  (`profileDepth`, `chestAcross`, `seamWeight`, `shoulderDrop`, `neckline` —
  an open V shows what is worn under it in the V — and `foldWeight`, which
  lightens folds, flank shade and the arms' contact shadow for cloth lighter
  than leather); the sleeve's `SleeveCut.capSlope` (a cap that carries a
  sloping trapezius on over the deltoid); a trouser seat's `SeatFit`
  (`legwear.ts`), whose `'legs'` style paints the seat head-on as the two
  trouser-leg tops, in the legs' own slab, so no slab shadow splits the cloth.
  The garment fields themselves are listed in `add-gear` ("Read the wearer's
  cut, never its id").
- Head-on from behind the torso garment carries the deltoid out to the
  sleeve cap's outer edge (`sleeveCapHalf`, `upperArmHalf`), so with the
  arms hung behind him the back reads as one shoulder line, not a back with
  capsules beside it.
- The silhouette outline is cleared from enclosed holes the outside cannot
  reach (`clearOutlineInHoles`, `figureCompose.ts`): a gap shut between an arm
  and the hip it rests on would otherwise ring with outline ink.

**Ryan**: 6'0", drawn to the reference photograph's measured proportions (head
crown to chin 0.156 of his height, shoulders 0.25, hips about 0.2, slim limbs,
a chest about an eighth of his height deep). Swept-top hair and a short beard
(`biped/ryanHead.ts`, mass tables shared with `human/castHead.ts`), light-blue
chambray shirt with an open pointed collar and a white V (`ryanShirt.ts`),
sleeves rolled just below the elbow (`RYAN_ROLLED_SLEEVE`), black belt and
slate slim chinos (`ryanChinos.ts`), black knit low-tops on a thin white sole line under
the trouser cuff (`ryanSneakers.ts`, `BootLook.soleBuild`), a watch on his left
wrist (`ryanWatch.ts`; E7 checks the side). His face is relaxed (`mouthSmile`, a low
`angerScale`).

**Dave**: 6'3", heavily muscled — narrower than the rig (`widthScale` 0.94,
leaner limbs, a chest about a seventh of his height deep, a head a little
larger than life), brown crop, moto jacket and jeans, dark-brown leather lace-up
ankle boots under the jeans' hem (`daveBoots.ts`).

The ceilings above (no three-quarter views, the head-on run's planted leg, the
armed rows head-on and from behind, the grip at close range) hold for both
looks unchanged; they are properties of the rig and its rows. Ryan's own: at
the 32 px tile his limbs are two to three pixels across, so their form is
one lit pixel against one shaded one: his chinos' terminator sits on the
middle of the leg (`SLIM_LEG_TERMINATOR` in `human/legwear.ts`) and their
lit side climbs well clear of their shadow, or G17 reads the leg as a flat
strip (a crop under two pixels is still counted and skipped); and his fists
come back to the rig's size as they close, because the sockets wrap every
handle class at that size.
The guard's fists are hand targets, so they sit where the row puts them
whatever the look's shoulders: placed in front of the corners of his jaw,
with the upper arms drawn short toward the camera (`GUARD_UPPER_ARM_SCALE`),
the IK lands each elbow just under and outside its shoulder on his narrow
frame and on the rig's alike, so the forearms lean in without crossing. Set
wider apart than his shoulders, the same targets fold his elbows in across
his chest.
