# Bipedal anatomy trap catalog

Every entry here was found by looking at a rendered figure, not by reading code.
They are ordered roughly by how much time each one cost.

**Numbers here are illustrative of _scale_, not authoritative.** Where a value
appears, the named constant beside it is the source of truth — grep `carlArt.ts`
or `generate-human-sprite.ts` for the name before relying on a figure. Five
values in the first draft of this file were already stale. The _reasoning_ is
what carries; the digits drift.

**Provenance matters.** Everything under Arms / Legs / Feet / Timing comes from
Carl, the one figure in this game whose movement actually convinces — treat it as
the standard. A handful of entries are marked _(from the goblin rig — a caution,
not a model)_: those record a specific failure worth avoiding, but goblin gait
and attack motion are **not** convincing and must never be copied, measured
against, or cited as "how it's done here".

## Proportions {#proportions}

- **Never derive a body part from the head.** A game figure is ~4.8 heads tall
  with a deliberately oversized head, so any life-drawing ratio hung off it
  inflates. `HAND_LENGTH` was `HEAD_RY * 1.12` — the usual "a hand is as long as
  the face" — which made the hand 80% of its own forearm, and the bare skin
  below the cuff then read as a rolled-up sleeve. Derive from the _parent limb_:
  `HAND_LENGTH = FOREARM_LENGTH * 0.38`.
- **Pin height and heads-tall, derive every joint from those.** `HIP_Y`,
  `WAIST_Y`, `SHOULDER_Y`, `HEAD_CENTRE_Y` are constants in tile units with
  origin between the feet and +Y down (heights are negative). Bone lengths come
  out of the joint heights, not the other way round.
- **Size is applied at draw time, never to the proportion tables.** Author shape
  at whatever scale reads best, then shrink the tile unit at build time
  (goblins' `ARCHETYPE_SCALE`). Scaling the anatomy alone leaves the
  choreography, prop tables and gore at full size and silently redraws the
  animation.
- Hips must not be wider than shoulders. It was, and it read as a barrel.

## Arms {#arms}

- **An arm swing is a sway, never a lift.** Head-on the swing is almost pure
  depth: the hand sweeps sideways across the hip (inboard going forward,
  outboard going back) and hangs slightly _higher at both ends_ because the arm
  foreshortens — so the vertical term comes off `cos(swingAngle)`, not off the
  signed swing. Driving one hand up while the other goes down is a dumbbell curl.
- **An arm placed by its hand cannot swing correctly at all.** Nearly all of a
  walking arm's travel belongs to the shoulder; the elbow just holds a bend. IK
  from a hand target forces both segments to sweep together and the forearm
  flails. Drive walk arms from joint angles (FK), keep the hand target for
  everything else (punches, grips, carries).
- **The head-on walk is FK too**, for a second reason: a hand target
  foreshortened by `cos(swing)` is slack, and the IK spends slack on the elbow —
  0.18 tiles of it at full swing, which is "the elbows go way out".
- Head-on the upper arm is nearly end-on and shows little (`FACING_UPPER_SWING`
  5°); the forearm carries most of the visible travel
  (`FACING_FOREARM_SWING` 11°).
- **An FK arm needs a _pair_ of rest tilts, not one.** The upper arm tilts out
  ~8° further than the forearm — that break at the elbow is what holds the arm
  off the ribs. Solve the pair by bisection so the wrist still lands exactly on
  the intended hang spread.
- **Idle and walk must share one arm rest.** Different rest shapes make the
  figure visibly tuck its arms in the moment it starts walking. Centre the
  walk's swing on the idle rest.
- Arms swing further forward than back (~55% forward share).
- **Head-on the travel is inward only** — arms swing in a plane just off the body
  and cross slightly toward the centreline coming forward, never out away from
  it. That inward amount must be a **remapped** swing `(own + 1) / 2`, never a
  rectified one (`own >= 0 ? own : -own`): folding the negative half back up
  gives each arm two inward peaks per stride and the swing reads at double speed
  however small the amplitude.
- **Which side an arm is drawn on is per view, never per frame.** Toward the
  camera an arm is in front of the chest for the whole cycle; away from it,
  behind the back for the whole cycle. Switching mid-swing pops at the shoulder.
- **A hand drop is measured from the shoulder _joint_,** which sits ~0.055 below
  the shoulder line poses write against. Hanging hands at `ARM_LENGTH` below the
  shoulder line leaves the arm 0.05 short of straight, and the IK throws that
  slack sideways into the elbow — a 6px bow on a 46px-per-tile sheet. That is
  what "the arms have a sharp elbow" always means.
- **A relaxed arm is a straight line.** Any bend must be posed deliberately.
- **`elbowFlare` must bow the two arms in _opposite_ screen directions** or the
  arms cross the chest.
- **A 2D arm has no way to foreshorten except to be drawn shorter.** A
  `foreScale` on the forearm (down to ~0.82 at the front of a head-on swing) is
  what carries the wrist up the body. Without it the hands track a flat arc at
  one height and the walk stays subtly wrong however well the angles are tuned.
- _(from the goblin rig — a caution, not a model)_ **The free arm of a
  weapon-carrier is three separate numbers**, and fixing one
  at a time takes three rounds: width scale, length scale (~0.72), and how far
  out the hand hangs (~0.95 against the weapon hand's 1.9). All three exist
  because that arm is angled away from the camera and must read as nearer the
  body than the weapon arm.
- _(from the goblin rig — a caution, not a model)_ **Raising a two-handed
  weapon's carry hand over-folds the off arm.** The butt
  grip comes up under the far shoulder and the shorter far arm folds to a third
  of its span, throwing its elbow up behind the shoulder — reads as an arm
  upside down. Carry further _out_ as well as up; keep the far arm's span past
  half its reach. Sweep it numerically against the skeleton builder — the
  shoulder moves with the lean.

## Legs {#legs}

- **Head-on, a knee is a change in _width_, not an angle.** A knee pointed at the
  viewer hinges away from the camera, so in the image plane there is no angle at
  all. Two separate pose values do this and conflating them is a bug:
  - `foreshorten` pulls the solved knee onto the hip→ankle line and must be **1
    on every leg of every head-on pose**, walk and idle alike. A bow that shows
    on the planted leg and vanishes on the swinging one flickers once per step
    and reads as a wiggle.
  - `legNearness` only changes widths, so it _should_ differ per leg: it blends
    the leg shape toward a near-leg shape where the knee stops pinching and
    widens to the thigh's width. The shin reading _wider_ is what says "closer
    to the camera" rather than "shorter". Drive it off the swing foot's lift.
- **IK slack goes into the knee as a square root**, so tiny slack is huge
  sideways offset: 3.5% of slack threw the knees a fifth of a head sideways —
  knock-kneed, then bow-legged once the sign was fixed. `LEG_SLACK` is 1.004 and
  `JOINT_SLACK` 0.0003. The leg is a straight column that narrows at the knee;
  real bends come from geometry (a swung or crouched leg), never from slack.
- **"Knees break away from the centreline" is a head-on rule only.** Applied
  edge-on it sends the two knees in opposite screen directions, so one hinges
  _backward_ — the single most obviously wrong thing a side walk can do. Force
  both knees forward in profile via a multiplier on the pose's knee-break, so a
  pose can still fold one deliberately.
- **A walking leg is nearly as long as the hip is high**, so a foot planted a
  full stride ahead is out of reach from standing height: the IK clamps, the leg
  locks straight, and the foot hangs above the floor. **The pelvis must drop at
  contact**, not rise at mid-stance — which is what a real pelvis does anyway.
  Get this backwards and no amount of stride or knee tuning fixes the side walk.
- **A stride that clamps on even one frame reads as a hop.** Check it
  numerically: model hip→ankle distance per frame against
  `THIGH + SHIN - JOINT_SLACK` and require headroom on _every_ frame. Carl's
  worst frame sits at 0.9307 against a 0.9334 limit (`STRIDE` 0.17,
  `WALK_BOB` 0.038, plus a toe-lift key easing the foot off the floor).
- **A raised leg solves into a shin sticking out sideways** unless the pose
  carries an explicit knee-break (−1 folds the knee up in front) plus a foot
  swung outboard.
- Two silent IK bugs made legs look wrong that no code review caught: the ankle
  target lifted by the foot's _drawn depth_ instead of the ankle's own height
  (asks the leg to over-reach → clamp → feet pulled up and inward, knees locked),
  and an inverted knee-bend sign (both knees break toward the centreline → legs
  read as crossed).

## Hands {#hands}

- **A hand does not take the full angle of its forearm.** Aligning it outright
  (`angleBetween(joint, end)`) gives a walking figure waving hands; real hands
  stay rigid relative to the body while the forearm swings under them. Blend
  ~30% toward the forearm from the line of the whole arm (`root`→`end`) — costs
  nothing on a straight limb, so punches are unaffected.
- **A hand as wide as its own wrist reads as a stick.** Width at 0.52 of hand
  length came out 0.07 across against a 0.07 wrist — one taper, and the
  cuff→hand step looked like a kink. 0.72 (fist 0.85).
- **Every digit must read `openness`.** A thumb pinned at its open-hand fan
  throws a stub sideways out of every closed fist that reads as a stray sixth
  finger. If a digit is added, it tucks with the rest.
- Mitten hands are the default failure at this scale; the blind review catches it.

## Feet {#feet}

- **A foot pointed at the camera cannot be splayed by rotating it** — that rolls
  the figure onto the outside edges of both soles. Lead the _toe end_ outward
  and keep the sole level.
- Toes drawn as separate strokes read as sandal straps. Bump the silhouette
  instead.

## Head, face, hair {#head}

- **The head is a tall oval head-on and a deeper one in profile — two radii, not
  one.** Width ratio 0.74, depth ratio 0.9. A round head makes any chin under it
  read as blocky _however narrow the chin is_, so narrowing the jaw alone never
  fixes it. The profile skull, hair, ear, brow, eye and mouth all key off
  **depth**, not width.
- **The jaw holds its width down to the top of the mouth and only turns in
  there** — a rounded triangle hung off a square jawline. Tapering from the
  cheekbone gives a face with no jaw and a flat chin at the bottom of it.
- **A shadow on the neck under the jaw** is what stops head and neck reading as
  one column of skin at tile size.
- **Hair is one soft mass with an uneven edge, not a ring of spikes.** Walk a
  curve through ~8 small tufts (height ~0.2 of head radius) rather than straight
  lines between 4 tall peaks and deep notches — that gives a crown of thorns.
- Three things separate hair from headgear: the crown must be **flat**, not
  circular (raise the circle's height to ~0.62 to square off the top); the
  hairline must run nearly **straight** across the brow with a shallow widow's
  peak, not bow up through the middle; and the hairline crown must clear the
  brow by a real margin or there is no forehead at all.
- **Edge-on the hairline is three heights**: the brow (at the front view's crown
  height, and placed _on_ the skull — the head is an ellipse, only ~63% as wide
  at brow height, so a brow point at the full half-width hangs off the face), a
  sideburn just forward of the ear, and a shallow nape. The profile crop needs
  its own arc range or its front end juts past the brow and the hairline cuts
  back up behind it.
- **The sideburn is painted separately and unstroked.** At this size the outline
  is as thick as the tab is wide, so inside the main path it renders as a black
  spike.
- **The temple hairline must stop above the ear's middle** — carried past it the
  hair swallows the ears, which are then drawn but invisible.
- **From behind, the crop is widest at the temples and narrowest at the nape.**
  Lower corners at the full half-width make the silhouette widest at its lowest
  point — a bowl, and no raggedness rescues it. Put those corners at ~0.7 of the
  half-width (on the skull, which is ~0.69 of its widest at that height), dip the
  nape line down at the centre and lift it toward the ears (inverted it curves
  like a chinstrap), and break the line with tufts. Two clean quadratics across
  the back of the head give a moulded rim, and a moulded rim on a smooth dome is
  a helmet.

## Clothing {#clothing}

- **Each leg of a pair of shorts is a cuff wrapped round its own thigh**: a band
  placed a fixed distance _down the thigh_ and square to it, with the crotch
  anchored between the two. A fixed trapezoid stays bolt upright through a kick
  while the leg swings out bare. Rotating a fixed hem about the hip is the
  obvious fix and **does not work**: the turn has to be damped and capped or the
  crotch sweeps across the body into a draped cape, and a capped hem stops
  covering a thigh raised past the cap. Following the thigh's own direction
  covers it at any angle by construction.
- The cuff takes two things from the _legs_, not the hip: its centre comes off
  the leg root (re-deriving from hip width puts it twice as far out in profile,
  because roots narrow with `view.lateral` and the hip does not), and its
  half-width is floored at `THIGH_WIDTH * CUFF_SLACK` (a flare-derived width came
  out a third narrower than the leg edge-on, so the thigh stuck out both sides).
- **A printed motif needs to be at least ~3px on the sheet.** A 3×5 grid at 0.03
  tiles made each heart under two pixels — a polka dot. 2×3 at 0.058 works.
- **The arm/hip gap is a chain of widths, not one number.** Hands clear of the
  body means hand-hang-spread > the hem, the hem must still cover
  `LEG_ROOT_HALF + THIGH_WIDTH` (so the hem flare can't drop below ~1.4), and
  pushing the hands out instead tilts the arm off the shoulder root. The gap
  that survives all three is ~1px at sheet scale, and it took trimming the
  shorts _and_ moving the hands.

## Views and depth {#views}

- **A profile figure needs two lateral factors, not one.** Compressing the torso
  by the same amount as the limb spacing makes a plank. `lateral` moves limb
  roots (`PROFILE_LATERAL` 0.3); `girth` scales torso/hip/clothing width
  (`PROFILE_GIRTH` 0.68).
- **Head-on, both arms belong in front of the torso.** Drawing the far arm first
  — correct in profile — makes the figure look one-armed.
- **Bare skin takes no depth shade outside the profile.** Legs never take one in
  any view (the outline separates them edge-on) and head-on neither arm does,
  including an arm drawn behind the torso. A depth shade on skin does not read as
  depth, it reads as two different colours of skin. Only a true profile shades a
  far limb, where it is genuinely behind the body.
- **A carried prop is painted over the torso and face but _under_ the gripping
  fist.** A haft is wider than a fist, so painting it over the hand buries it and
  the figure appears to swing something nobody holds. Do not fix that by putting
  the prop behind the body (the haft vanishes) or the head over it (the haft is
  severed and reads as a hat). Both were tried; only the fist comes back over.
- **Detail does not rescue a wrong outline.** Adding a spike to a war hammer to
  make it a "T" cost the archetype its identity outright: at 32 px the spike is
  two pixels and turns a rectangle into a radiating star, and a review then read
  the hammer as a morningstar and the mace as a hammer. A blunt rectangle
  straddling the haft is the whole read.
- **Prop identity lives in flare, aspect, and position along the haft.** The axe
  failed a blind naming test three attempts running — shovel, spade, boot,
  bucket — and two redraws of the _edge_ moved nothing. Four things were wrong at
  once: carry angle (14° off level; solve carry for tip clearance per archetype,
  ~29°), bit aspect (0.20 deep over a 0.34 edge is square; 2:1), head position
  (40% along the wood is a lump partway down a pole; finish one haft-width short
  of the tip), and **flare** — a socket as long as the edge is a parallel-sided
  plate, i.e. a spade. Narrow neck opening into a long edge is what an axe has.

## Timing and motion {#timing}

- **Pace a walk with a phase-speed multiplier on the actor, never by scaling the
  frame index.** The frame index maps a phase in radians onto however many frames
  exist, so more frames buy smoothness and nothing else. `Player` wraps
  `walkFrame` at 2π, and a **non-integer** multiple of an already-wrapped phase
  does not wrap with it: at rate 1.3 the cycle jumped from frame 4 straight back
  to 0 once per lap — a glitch frame in every direction that no amount of staring
  at the sheet finds, because the sheet is fine. Integer rates hide the bug.
- _(from the goblin rig — a caution, not a model)_ **A swing cap silently
  discards authored angles.** A ground-clearance clamp on
  a chop returned 16° from an authored 58° at impact, so the swing lay flat and
  stayed there for six frames. Keep the hand high through the strike and author
  _under_ the clamp.
- **The rebound is the follow keyframes, not a fifth beat.** `follow` is eased
  out, so it moves fastest in the frames right after impact.
- **An effect whose size is a gameplay value does not belong in the sheet.**
  Carl's Smush blast is drawn live because the wave has to stop exactly on the
  damage radius, which grows with ability level.

## Anchoring and wiring {#anchor}

- **A redraw moves the tile anchor**, so health-bar and active-marker offsets
  must move with it. Measure off the sheet: Carl's standing rows top out 40 px
  above the tile anchor against ~32 px on the old art.
- **Frame geometry is measured at bake time, not authored.** Have the generator
  print the exact manifest entry; the gate then _verifies_ rather than rewrites
  it. After a pose change: re-run with the manifest gate skipped, paste the
  printed entries, re-run clean.
- **Vertical wall tests are anchored by direction** (`src/map/collisionAnchors.ts`).
  Walking south the feet lead, so the test drops to the sole (0.95); every other
  direction tests the centre. Any new bipedal mob must use these or it stands
  with its lower half inside the south wall of a building.
- **`Mob.doWander` mirroring**: a mob that mirrors on facing must have `facingX`
  set by every movement path, or it moonwalks when it wanders opposite to its
  last chase.

## Rendering mechanics {#rendering}

- **A path that starts and ends at different points gets its gap stroked shut by
  `closePath`.** The back hair began at temple height and its closure ended at 0,
  so a seam ran down _one_ side of the head as a dark line — the other side looked
  fine because the path actually travels that segment. Any one-sided artifact in
  a filled-and-stroked shape is worth checking against this first.
- **node-canvas drops an `rgba()` with an exponent-notation alpha.** A tiny
  computed alpha serialises as `5e-17` and the whole colour is discarded, baking
  a solid smear. Clamp alphas to zero below a floor.
- See `floor3_trees` for the canvas-gradient and frame-clipping traps.
