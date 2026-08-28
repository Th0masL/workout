/* Program definition — rings + bodyweight, full-body A/B split.
 *
 * Design constraint driving everything here: the rings sit at a small number
 * of fixed heights, and a session only ever moves them DOWNWARD. Exercises are
 * grouped into "stations" in that order — the pull day needs two adjustments,
 * the push day three.
 *
 * Ring range is floor to overhead with a clean dead hang at the top, so no
 * exercise is compromised by the hardware any more. Where a movement needs
 * body elevation it uses furniture already in the room: a 20 cm sofa chair and
 * a 45 cm regular chair. Nothing else is bought or built.
 *
 * Progression is never encoded as "do more weight next week". Each exercise
 * carries a `ladder` of leverage levels (the real progression driver for
 * bodyweight work) and, once the ladder is topped out, switches to vest
 * microloading. progression.js consumes this; it holds no exercise knowledge.
 *
 * THE LEVEL IS THE UNIT. A rung is very nearly its own exercise, so it owns
 * whatever differs from the exercise default:
 *   name, note   what you are doing at this level
 *   kit          REPLACES the exercise's list — push-ups start on the bars and
 *                end up in the rings, so a fixed per-exercise list is wrong
 *                most of the time
 *   image        a floor glute bridge and a single-leg hip thrust off a chair
 *                need different pictures
 *   perSide      a level is unilateral or it is not; the exercise is neither
 *   range, step, rest, metric   for when a rung is a different enough movement
 *                that inheriting the exercise's prescription would be wrong
 *   cues         REPLACES the exercise's coaching, for a level that is really
 *                another movement; `addCues` appends instead, for one that only
 *                adds a caveat
 * Omit a field and the exercise's value applies. See PR.rung().
 */
window.PROGRAM = {
  meta: {
    name: "Bodyweight A/B",
    subtitle: "Rings, bars, or whatever is there",
    /* Deliberately no fixed frequency or training days. The engine counts
     * sessions and elapsed weeks, never weekdays, so 2x and 3x both work — a
     * lighter week simply takes longer to clear a phase gate, which is the
     * correct behaviour rather than a compromise. 2x/week lands around 11-12
     * hard sets per muscle group, inside the range associated with growth; 3x
     * is faster but only if it actually happens. */
    frequencyNote: "2-3 sessions a week, at least a day apart. Alternate A and B.",
    sessionMinutes: [45, 55],
    vestTotalKg: 10,
  },

  /* MOVEMENT PATTERNS, not muscles. Two exercises share a pattern only when one
   * could genuinely stand in for the other — which is why "pull" had to split.
   * A pull-up and a row are both lats; they are not substitutes, you need both.
   * A hanging leg raise and a ring fallout are both abs; one produces hip
   * flexion and the other resists extension.
   *
   * The coarse group (push / pull / legs / core / prehab) is DERIVED from the
   * prefix, so there is one place to change and nothing to keep in sync.
   *
   *   prehab-warmup  prehab-hang  prehab-scap  prehab-rear-delt
   *   pull-vertical  pull-horizontal
   *   push-dip  push-vertical  push-horizontal
   *   legs-knee  legs-hip  legs-knee-flexion  legs-calf
   *   core-anti-extension  core-hip-flexion
   */

  /* Ordered — a session renders its stations in this order, which is also the
   * order the rings physically travel: overhead, then chest, then they stay
   * there. Two adjustments per session, both downward, never back up.
   *
   * The straps reach the floor, so the leg curl is done lying flat with the
   * heels in the rings at 20-25 cm — no chair, no compromise. It is the only
   * exercise that needs the rings that low, which is why day B pays for a third
   * adjustment and day A only needs two. Both stay downward-only.
   *
   * (An earlier strap stopped at 80 cm and the leg curl had to be done with the
   * shoulders up on the 45 cm chair to get the same body angle. That is gone.) */

  /* WHAT AN EXERCISE NEEDS IS A CAPABILITY, NOT AN OBJECT.
   *
   * "rings" was the wrong unit. A dead hang does not need rings, it needs
   * something overhead to hang from — a park bar does just as well. But a
   * feet-assisted pull-up DOES need rings, because it needs that something to
   * be at a height you choose. Naming the object hid the difference; naming the
   * capability makes it exact, and makes "what can I do here?" answerable.
   *
   * Equipment provides capabilities; exercises (per level) require them. */
  equipment: {
    rings: {
      label: "rings",
      provides: [
        "hang-high",
        "hang-high-adjustable",
        "grip-chest",
        "dip-support",
        "dip-support-adjustable",
        "handles-hanging",
        "handles-low",
        "steady",
      ],
    },
    bars: { label: "push-up bars", provides: ["handles-floor"] },
    sofa: { label: "sofa chair 20 cm", provides: ["step-20"] },
    chair: { label: "chair 45 cm", provides: ["step-45", "steady"] },
    "high-bar": { label: "high bar", provides: ["hang-high"] },
    "low-bar": { label: "low bar", provides: ["grip-chest"] },
    "dip-bars": { label: "parallel bars", provides: ["dip-support"] },
    bench: { label: "bench", provides: ["step-45", "steady"] },
    box: { label: "box or step", provides: ["step-20", "step-45"] },
    /* A suspension trainer is a pair of rings by another name — everything the
     * rings provide except a dip, which is not safe on a soft handle at height. */
    straps: {
      label: "suspension straps",
      provides: [
        "hang-high",
        "hang-high-adjustable",
        "grip-chest",
        "handles-hanging",
        "handles-low",
        "steady",
      ],
    },
  },

  /* Where you are today. The session is resolved against whatever the place
   * provides: a level whose requirements are not met is capped down to the
   * highest one that is, and an exercise with no usable level at all is shown
   * as unavailable rather than quietly dropped. */
  places: {
    home: { label: "Home", has: ["rings", "bars", "sofa", "chair"] },
    park: { label: "Park", has: ["high-bar", "low-bar", "dip-bars"] },
    /* A conservative gym: the things every gym has. Anything better — a
     * suspension trainer, a proper dip station — gets ticked under Anywhere
     * rather than assumed here, because a gym that turns out not to have it
     * would quietly hand you a session you cannot do. */
    gym: { label: "Gym", has: ["high-bar", "low-bar", "dip-bars", "bench", "box"] },
    /* Not a place so much as a starting point: one tap to clear the list, then
     * tick the two things that are actually in the hotel room. */
    nothing: { label: "Nothing", has: [] },
  },

  /* What a pattern trains, in the words you would use to describe the session
   * to someone. Display only — substitution runs on the PATTERN, because
   * "lats" would happily swap a pull-up for a row and those are not
   * substitutes. This is the reading, not the rule. */
  trains: {
    "prehab-warmup": "whole body, light",
    "prehab-hang": "grip, shoulders",
    "prehab-scap": "lower traps, serratus",
    "prehab-rear-delt": "rear delts, rotator cuff",
    "pull-vertical": "lats, biceps",
    "pull-horizontal": "mid-back, rear delts, biceps",
    "push-dip": "chest, triceps, front delts",
    "push-vertical": "shoulders, triceps",
    "push-horizontal": "chest, triceps",
    "legs-knee": "quads, glutes",
    "legs-hip": "glutes, hamstrings",
    "legs-knee-flexion": "hamstrings",
    "legs-calf": "calves",
    "core-anti-extension": "abs, deep core",
    "core-hip-flexion": "hip flexors, lower abs",
  },

  /* How to ask "which of these?" for a capability. Only needed where more than
   * one thing can provide it, but kept complete so a new piece of equipment
   * cannot silently produce an unlabelled question. */
  capLabels: {
    "hang-high": "hang from",
    "hang-high-adjustable": "hang from",
    "grip-chest": "grip at chest",
    "dip-support": "dip on",
    "dip-support-adjustable": "dip on",
    "handles-hanging": "handles",
    "handles-low": "heels in",
    "handles-floor": "hands on",
    steady: "steady on",
    "step-20": "20 cm step",
    "step-45": "45 cm step",
  },

  stationOrder: ["rings-full", "rings-chest", "rings-dip", "rings-low", "floor"],

  /* A station is a rig height: a group of exercises you do before touching the
   * straps again. The `label` describes the rig, which is only meaningful where
   * there IS one — everywhere else `plain` names the role instead, so a park or
   * a hotel room does not announce rings that are not there. */
  stations: {
    "rings-full": {
      plain: "Overhead",
      label: "Rings overhead",
      icon: "⬆️",
      setup:
        "Hang the rings so your toes just brush the floor with your legs STRAIGHT, then warm up. That one height does both jobs: straighten the legs to take weight through them while you still need assistance, bend the knees and cross the ankles for a clean full hang once you do not. You never have to move them.",
      adjust: true,
    },
    "rings-chest": {
      plain: "Chest height",
      label: "Rings at chest",
      icon: "↔️",
      setup:
        "Drop the rings to STERNUM height, then check it against the dip: at the BOTTOM of a dip, knees bent, your feet must still clear the floor. Raise them a little if they do not. Only adjustment left in the session.",
      adjust: true,
    },
    "rings-dip": {
      plain: "Seated dips",
      label: "Rings for seated dips",
      icon: "🔻",
      setup:
        "Only while you still need help with the dips. Sit on the floor between the rings with your legs " +
        "straight out in front, and set them to about SHOULDER HEIGHT WHILE SEATED — roughly 60 cm. " +
        "Check it by sitting down: with your backside on the floor your hands should be level with your " +
        "shoulders and your elbows well bent. That is the bottom of the dip, and the floor is what stops " +
        "you going too deep. Press up from there. This station disappears once you are dipping " +
        "unassisted and the rings stay at chest height.",
      adjust: true,
    },
    "rings-low": {
      plain: "At floor level",
      label: "Rings on the floor",
      icon: "🔽",
      setup:
        "Rings all the way down — 20 to 25 cm. Low enough to lie flat on your back and rest your heels in them with the legs straight.",
      adjust: true,
    },
    floor: {
      label: "Floor",
      icon: "⬇️",
      setup: "Push-up bars down, rings left wherever they ended up.",
    },
  },

  /* Phase gating. A phase unlocks only when BOTH the session count and the
   * elapsed weeks are met — training once a week for three weeks is not a
   * completed reintroduction phase, and tendons care about calendar time. */
  phases: [
    {
      id: 1,
      name: "Reintroduction",
      weeks: "from the start",
      minSessions: 0,
      minWeeks: 0,
      rpe: "5-6",
      rir: "3-4 reps in reserve",
      allowLoadProgress: false,
      note:
        "No vest, no harder variants. Reps climb inside the range and that is all. " +
        "After a long layoff muscle comes back fast but tendons and connective tissue do not — " +
        "this phase exists to let them catch up. Full range of motion, controlled tempo, stop well short of failure.",
    },
    {
      id: 2,
      name: "Ramp-up",
      weeks: "9 sessions + 3 weeks",
      minSessions: 9,
      minWeeks: 3,
      rpe: "7-8",
      rir: "2-3 reps in reserve",
      allowLoadProgress: true,
      note:
        "Load progression unlocks: ladder levels first, then the vest starting at 1 kg. " +
        "Push toward the top of each rep range. First twinge in a joint, back off a level — do not train through it.",
    },
    {
      id: 3,
      name: "Full programming",
      weeks: "18 sessions + 6 weeks",
      minSessions: 18,
      minWeeks: 6,
      rpe: "8-9",
      rir: "1-2 reps in reserve",
      allowLoadProgress: true,
      note:
        "The vest is now the main progression driver in 0.5 kg steps. Full rep ranges, deep dips allowed " +
        "if the shoulders have stayed quiet. Last set of an accessory can go to technical failure.",
    },
  ],

  /* Session-length model. Rest dominates, so these only need to be roughly
   * right; the estimate is arithmetic and real sessions run 10-15% longer. */
  time: {
    secondsPerRep: 3, // this program cues a 3 s eccentric, so reps are slow
    transition: 30, // between exercises: setup, walking over, reading the card
    ringAdjust: 50, // one ring height change
  },

  /* Progression config consumed by progression.js. */
  rules: {
    topOutSessions: 2, // sessions at top of range before load increases
    failsBeforeDeload: 3, // consecutive missed sessions before backing off
    overshootMargin: 2, // reps above the top of range that skip the top-out wait
    vestFirstKg: 1.0, // first vest jump (0 -> 1 kg)
    vestStepKg: 0.5, // every jump after that
    vestMaxKg: 10.0,
  },

  exercises: {
    /* ---------------------------------------------------------------- */
    /* Warm-up                                                           */
    /* ---------------------------------------------------------------- */
    "movement-prep": {
      name: "Movement prep",
      search: "bodyweight good morning and dynamic warm up form",
      station: "rings-full",
      pattern: "prehab-warmup",
      sets: 1,
      trimPriority: 0,
      minSets: 1,
      metric: "seconds",
      range: [180, 180],
      step: 30,
      rest: 30,
      needs: [],
      progression: "fixed",
      ladder: [{ name: "Same every session" }],
      cues: [
        "2 min getting warm — march or jog on the spot, or run up and down the stairs",
        "Arm circles both directions, then shoulder rolls",
        "10 bodyweight good mornings and 10 deep squats — the hamstrings and hips need this",
        "Wrist circles, then rock forward and back with your hands on the push-up bars",
      ],
      why:
        "There are no light warm-up sets built into this program — every set is a working set — so " +
        "this is the only thing between cold connective tissue and the first hard rep. After a " +
        "five-year layoff that matters more than usual; it is the same reasoning behind Phase 1. " +
        "It never progresses: three minutes, the same four things, every session.",
    },

    /* ---------------------------------------------------------------- */
    /* Rings overhead — shoulder prep, then the pull                     */
    /* ---------------------------------------------------------------- */
    "dead-hang": {
      name: "Dead hang",
      search: "dead hang form shoulder",
      station: "rings-full",
      pattern: "prehab-hang",
      sets: 1,
      trimPriority: 0,
      minSets: 1,
      metric: "seconds",
      range: [20, 45],
      step: 5,
      rest: 30,
      needs: ["hang-high-adjustable"],
      progression: "ladder",
      ladder: [
        { name: "Toes lightly down", note: "Take some weight off through the legs" },
        { name: "Full hang", needs: ["hang-high"], },
        { name: "Full hang, shoulders relaxed", note: "Let the shoulders rise — the deepest range", needs: ["hang-high"], },
      ],
      cues: [
        "Let the shoulders relax up towards your ears — this is a stretch, not a hold",
        "Ribs down and neck neutral: relaxed is not the same as collapsed",
        "Bend the knees and cross the ankles so your feet clear — you still hang under full bodyweight",
        "Hang and breathe. Nothing is meant to be working except your grip",
        "If you are cold, two minutes of anything that raises your heart rate first",
      ],
      why:
        "Opens the overhead position and decompresses the shoulder before anything loads it, and it " +
        "is literally the starting position of the next exercise. Replaces band pass-throughs — it " +
        "covers the flexion range, though not the rotation range a band gave.",
      note:
        "PASSIVE on purpose. Nothing is contracting: the shoulders ride up, the capsule and lats get " +
        "stretched, and the grip is the only thing working. The ACTIVE hang — shoulders pulled down " +
        "and back — is the next exercise, ring scap pulls, which is why the two sit together: relax " +
        "first, then learn to switch on, then pull. A fully relaxed hang does put a cold shoulder " +
        "capsule under all your bodyweight, so stay on level 1 with the toes down as long as it feels " +
        "better there, and if it ever pinches rather than stretches, take weight back onto the legs.",
    },
    "ring-scap-pull": {
      name: "Scap pulls",
      search: "scapular pull ups tutorial",
      image: "https://raw.githubusercontent.com/Th0masL/exercises-gifs/main/assets/0688.gif",
      station: "rings-full",
      pattern: "prehab-scap",
      sets: 1,
      trimPriority: 0,
      minSets: 1,
      metric: "reps",
      range: [8, 12],
      step: 1,
      rest: 30,
      needs: ["hang-high-adjustable"],
      progression: "ladder",
      ladder: [
        { name: "Standing, nearly upright", note: "Feet well under you — lightest" },
        { name: "Leaning back" },
        { name: "Full hang", needs: ["hang-high"], },
      ],
      cues: [
        "Arms stay completely straight — only the shoulder blades move",
        "Pull the shoulders down and back, chest up, then let them rise again",
      ],
      why:
        "Wakes up the mid-traps and lats and teaches the scapular position every pull depends on. " +
        "Same job as band pull-aparts, at a station already set up, with body angle as the dial.",
    },
    "ring-pullup": {
      name: "Pull-ups",
      search: "pull ups form tutorial",
      station: "rings-full",
      pattern: "pull-vertical",
      sets: 3,
      trimPriority: 1,
      minSets: 2,
      metric: "reps",
      range: [6, 8],
      step: 1,
      rest: 150,
      needs: ["hang-high-adjustable"],
      progression: "ladder-then-vest",
      ladder: [
        { name: "Feet assisted, heavy", note: "Legs straight, toes down, taking a real share of the weight" },
        { name: "Feet assisted, light", note: "Toes down but barely pushing — just enough to finish the rep" },
        { name: "Bodyweight", note: "Knees bent, ankles crossed, feet clear of the floor", needs: ["hang-high"], },
      ],
      cues: [
        "Dead hang at the bottom — arms fully straight, shoulders unpacked",
        "Hands turned out at the top, if what you are on lets them",
        "Pull the elbows down and back, chest toward your hands",
        "Three seconds down — the lowering is where the tendons adapt",
      ],
      why:
        "The primary vertical pull. Rings let the wrists and shoulders find their own path, which is " +
        "much kinder than a fixed bar after a layoff, at the cost of a couple of reps from the instability.",
    },
    "ring-chinup": {
      name: "Chin-ups",
      search: "chin ups form tutorial",
      image: "https://raw.githubusercontent.com/Th0masL/exercises-gifs/main/assets/1326.gif",
      station: "rings-full",
      pattern: "pull-vertical",
      sets: 3,
      trimPriority: 1,
      minSets: 2,
      metric: "reps",
      range: [6, 8],
      step: 1,
      rest: 150,
      needs: ["hang-high-adjustable"],
      progression: "ladder-then-vest",
      ladder: [
        { name: "Feet assisted, heavy", note: "Legs straight, toes down, taking a real share of the weight" },
        { name: "Feet assisted, light", note: "Toes down but barely pushing — just enough to finish the rep" },
        { name: "Bodyweight", needs: ["hang-high"], },
      ],
      cues: [
        "Start supinated — palms toward you",
        "On rings, let them rotate as you pull — do not fight it. On a fixed bar there is nothing to rotate",
      ],
      why:
        "Same movement as the pull-up biased toward the biceps and lower lats. Alternating grips across " +
        "A and B days spreads elbow stress instead of concentrating it.",
    },
    "hanging-leg-raise": {
      name: "Hanging leg raises",
      search: "hanging leg raise progression form",
      image: "https://raw.githubusercontent.com/Th0masL/exercises-gifs/main/assets/0472.gif",
      station: "rings-full",
      pattern: "core-hip-flexion",
      sets: 3,
      trimPriority: 5,
      minSets: 2,
      metric: "reps",
      range: [8, 10],
      step: 1,
      rest: 75,
      needs: ["hang-high"],
      progression: "ladder",
      ladder: [
        { name: "Knee tucks", note: "Knees to chest, feet stay low" },
        { name: "Knees to chest, slow lower", note: "3 s eccentric" },
        { name: "Straight legs to 90°" },
        { name: "Toes to rings" },
      ],
      cues: [
        "Posteriorly tilt the pelvis first — curl the hips up, do not just swing the legs",
        "No swinging; if you are using momentum, drop a level",
      ],
      why:
        "Trains the abs in the lengthened position under a load bodyweight crunches cannot reach. " +
        "Grip will be pre-fatigued from pulling — that is expected, and it is free grip work.",
      note:
        "The one exercise the low hang costs something: with the rings set so straight legs reach the " +
        "floor, the bottom of a straight-leg raise is slightly cut short. It does not matter at levels " +
        "1-2, and if it starts to at levels 3-4, raise the rings for this exercise only. If grip gives " +
        "out before the abs do, use straps.",
    },

    /* ---------------------------------------------------------------- */
    /* Rings at chest                                                    */
    /* ---------------------------------------------------------------- */
    "ring-facepull": {
      name: "Face pulls",
      search: "TRX face pull form tutorial",
      station: "rings-chest",
      pattern: "prehab-rear-delt",
      sets: 2,
      trimPriority: 8,
      minSets: 1,
      metric: "reps",
      range: [12, 20],
      step: 2,
      rest: 45,
      superset: "prehab-pair",
      needs: ["grip-chest"],
      progression: "ladder",
      ladder: [
        { name: "Almost upright", note: "Feet under your hands — lightest" },
        { name: "Feet walked forward" },
        { name: "Body at 45 degrees" },
        { name: "Body horizontal" },
      ],
      cues: [
        "Pull to the forehead with the elbows high and wide",
        "Finish with an external rotation — knuckles back, then hold a beat",
        "Walking the feet further forward is the load",
      ],
      why:
        "The best insurance against dip-related shoulder pain, and deliberately placed immediately " +
        "before the dips for that reason. Better than the band version: no dead spot at the start, " +
        "and body angle loads it continuously instead of in band-tension steps.",
    },
    "ring-row": {
      name: "Inverted rows",
      search: "inverted row form tutorial",
      image: "https://raw.githubusercontent.com/Th0masL/exercises-gifs/main/assets/0808.gif",
      station: "rings-chest",
      pattern: "pull-horizontal",
      sets: 3,
      trimPriority: 2,
      minSets: 2,
      metric: "reps",
      range: [10, 12],
      step: 1,
      rest: 90,
      superset: "chest-pair",
      needs: ["grip-chest"],
      progression: "ladder-then-vest",
      ladder: [
        { name: "Feet under the rings", note: "Torso upright — the easiest angle" },
        { name: "Feet walked forward", note: "Roughly 45°" },
        { name: "Body horizontal", note: "Heels on the floor, straight line ankle to ear" },
        { name: "Heels on the sofa chair", note: "20 cm", needs: ["grip-chest", "step-20"], },
        { name: "Heels on the chair", note: "45 cm — hips above shoulders", needs: ["grip-chest", "step-45"], },
      ],
      cues: [
        "Squeeze the glutes — the body is a plank, no hip sag",
        "Pull to the lower ribs, elbows close, pause for a beat",
      ],
      why:
        "The horizontal pull. Feet elevation is the built-in progression, which is exactly why this " +
        "exercise never needs the rings moved — walk the feet out, then put them on a box.",
    },
    "ring-dip": {
      name: "Dips",
      search: "dips beginner progression tutorial",
      image: "https://raw.githubusercontent.com/Th0masL/exercises-gifs/main/assets/0677.gif",
      station: "rings-chest",
      pattern: "push-dip",
      sets: 3,
      trimPriority: 1,
      minSets: 2,
      metric: "reps",
      range: [6, 8],
      step: 1,
      rest: 150,
      superset: "chest-pair",
      needs: ["dip-support-adjustable"],
      progression: "ladder-then-vest",
      ladder: [
        /* Started seated, in an L. Rings at seated-shoulder height, legs
         * straight out in front, backside on the floor: that IS the bottom of a
         * dip, and it has three properties nothing else here had —
         *
         *   the floor is the depth stop, so "no deeper than parallel" enforces
         *     itself instead of being a rule you have to remember;
         *   the hands stay at your SIDES rather than behind you, so the shoulder
         *     never sees the extension-plus-internal-rotation position that
         *     makes bench dips a bad idea after a layoff;
         *   the legs are out in front and nearly flat, so they can push a
         *     little but cannot squat you up.
         *
         * The progression is the same one everybody uses for bench dips —
         * raise the feet — except the hands are on rings, which is the whole
         * point of owning rings. Higher heels put more of you on your arms. */
        {
          name: "Seated, heels on the floor",
          note: "Sit between the rings, legs straight out — press your hips off the floor",
          station: "rings-dip",
          image: "images/ring-dip.svg",
          cues: [
            "Sit on the floor between the rings, legs straight out in front, heels down",
            "Hands on the rings at your SIDES — never behind you. Rings turned out",
            "Press until the arms lock and your hips come off the floor, then lower until you touch down",
            "Push through the heels as much as you need. Do not bend the knees to get more",
          ],
        },
        {
          name: "Seated, heels on the sofa chair",
          note: "20 cm — more of you goes onto the arms",
          station: "rings-dip",

          image: "images/ring-dip.svg",
          cues: [
            "Same position, heels up on the 20 cm sofa chair instead of the floor",
            "Raising the feet shifts weight off the legs and onto the arms — that is the whole step",
            "Legs stay straight; the heels rest, they do not press hard",
          ],
          needs: ["dip-support-adjustable", "step-20"],
        },
        {
          name: "Seated, heels on the chair",
          note: "45 cm — nearly all of you is on the arms now",
          station: "rings-dip",
          image: "images/ring-dip.svg",
          cues: [
            "Heels on the 45 cm chair. At lockout your feet are level with your hips",
            "Almost all of your weight is on the arms; the feet are for balance",
            "When this stops being hard, the rings go back up and the feet come off entirely",
          ],
          needs: ["dip-support-adjustable", "step-45"],
        },
        {
          name: "Bodyweight, to parallel",
          note: "Rings back up to chest height — feet clear, upper arm to parallel",
          addCues: [
            "Back to a normal dip height. Knees bent, ankles crossed, feet clear for the whole set",
            "Cannot reach parallel unassisted? Go back a level. Range is earned before load",
          ],
          needs: ["dip-support"],
        },
        {
          /* Depth is the last thing earned before the vest, and it is the one
           * step this program will not let you take early — six weeks of
           * calendar time, not just sessions, before the shoulder sees the
           * bottom of the range under full bodyweight. */
          name: "Bodyweight, below parallel",
          note: "Phase 3 only — the range itself is the progression now",
          minPhase: 3,
          addCues: [
            "A centimetre or two deeper per session, not the whole range at once",
            "The reps reset to 6 when you arrive here. A deeper dip IS a harder dip; treat it as one",
            "Stop where the shoulder is comfortable — that is your depth, not a number someone else picked",
            "Any pinch rather than a stretch at the bottom: back up to parallel and stay there a fortnight",
          ],
          needs: ["dip-support"],
        },
      ],
      cues: [
        /* This is the thing the level names never said, and the reason a
         * partial-range unassisted dip felt like progress when it was not. */
        "A rep counts only if the upper arm reaches PARALLEL to the floor. Higher is not a short rep, it is a different exercise",
        "Parallel is the target AND the ceiling until the last rung opens in Phase 3 — then depth becomes the progression",
        "Hands pressed against the sides at lockout, turned out if they can be",
        "Shoulders down and back the whole time — never let them shrug up at the bottom",
      ],
      why:
        "The primary vertical push and the highest-risk movement in the program. Ring dips are far more " +
        "shoulder-friendly than fixed bars because the hands can rotate, but depth is what hurts people " +
        "after a layoff — hence the depth cap for the first six weeks.",
      caution:
        "Upper arm to parallel on every rep — and no deeper until the last rung opens in Phase 3. " +
        "Cannot reach parallel? Drop a level and use your feet.",
      note:
        "DEPTH IS THE LAST RUNG, and it comes BEFORE the vest — which is what \"range before load\" has to " +
        "mean if it means anything. Parallel is the ceiling until Phase 3, six weeks and eighteen sessions " +
        "in; then the bottom of the range opens up a centimetre at a time and the reps reset, because a " +
        "deeper dip is a harder dip. Only once that is owned does weight go on. Earn the level and the app " +
        "banks it until the phase opens, so nothing is lost by the wait.\n\n" +
        "The ladder ENDS there, and the vest takes over. Holding the legs straight " +
        "out — an L-sit dip — is not on it, because it does not make the movement harder for the muscles " +
        "doing the pushing: it shifts your centre of mass forward and asks for hip-flexor compression " +
        "and balance instead. As a rung it would gate the vest on a core skill, so someone with plenty " +
        "strong dips could stall there and never get to load them. Chase it as a skill if you want it; " +
        "it is not the way to make dips harder.\n\n" +
        "RANGE BEFORE LOAD. The ladder takes assistance away, but only once you can already reach depth — " +
        "an unassisted dip that stops above parallel is not a harder version of a full one, it trains the " +
        "top few inches and skips the part the shoulder actually needs to learn. If you cannot hit parallel " +
        "without help, you are on level 1 or 2 no matter how strong the partial feels. Using your feet is " +
        "not a lesser version of the exercise; it is how you buy the range.\n\n" +
        "This is the highest-risk movement in the program after a long layoff. Depth is what hurts " +
        "shoulders, not load, which is why the cap is on range of motion rather than on weight — and why " +
        "the cap is a CEILING as well as a floor for the first six weeks. Back off at the first twinge " +
        "rather than training through it.",
      warn: true,
    },
    "ring-fallout": {
      name: "Fallouts",
      search: "TRX fallout anti extension core exercise",
      image: "https://raw.githubusercontent.com/Th0masL/exercises-gifs/main/assets/0805.gif",
      station: "rings-chest",
      pattern: "core-anti-extension",
      sets: 3,
      trimPriority: 6,
      minSets: 2,
      metric: "seconds",
      range: [20, 30],
      step: 5,
      rest: 60,
      needs: ["handles-hanging"],
      progression: "ladder",
      ladder: [
        { name: "Feet close, torso steep", note: "Nearly upright — easiest" },
        { name: "Feet walked back to ~45°" },
        { name: "Feet walked back to ~30°" },
        { name: "Near horizontal", note: "Body almost parallel to the floor" },
      ],
      cues: [
        "Hands in the rings, arms straight, lean in until the abs are loaded",
        "Ribs down, glutes tight — the lower back must not arch",
        "Walking the feet further back is the load; that is the whole progression",
      ],
      why:
        "Anti-extension core work with the shoulders loaded — carries over directly to holding a rigid " +
        "body position in rows, dips and push-ups.",
      note:
        "CORRECTION to the original plan, which called for a ring plank with the FEET in the rings at " +
        "chest height. That is not physically possible — feet in sternum-height rings puts you inverted. " +
        "Hands in the rings gives the same anti-extension stimulus at the height you are already standing " +
        "at, and loads the shoulders and lats as well. A feet-in-rings version IS possible now that the " +
        "straps reach the floor — it is not used because this one progresses continuously by walking the " +
        "feet back, where switching to feet-in-rings is one huge jump with nothing in between.",
      correction: true,
    },

    /* Not in either workout's order. It exists so that anti-extension has an
     * answer in a room with no rings — the resolver reaches for it by pattern
     * when the fallout cannot be done. Needs nothing at all, anywhere. */
    plank: {
      name: "Front plank",
      search: "front plank long lever form tutorial",
      image: "images/plank.svg",
      station: "floor",
      pattern: "core-anti-extension",
      sets: 3,
      trimPriority: 6,
      minSets: 2,
      metric: "seconds",
      range: [20, 45],
      step: 5,
      rest: 60,
      needs: [],
      progression: "ladder",
      ladder: [
        { name: "Knees down", note: "Elbows under the shoulders" },
        { name: "Full plank", note: "Elbows under the shoulders, toes down" },
        { name: "Elbows a hand ahead", note: "One hand-length forward — the lever starts" },
        { name: "Elbows fully ahead", note: "Arms extended forward, as far as you can hold" },
      ],
      cues: [
        "Elbows under the shoulders to start; sliding them FORWARD is the entire progression",
        "Ribs down and glutes tight — the lower back must not arch. That is the whole exercise",
        "Squeeze as if bracing for a punch rather than just lying there propped up",
        "The moment the hips sag or the back arches, the set is over. Time held with a sag is not time",
      ],
      why:
        "The same job as the ring fallouts — stopping your spine extending while the shoulders are " +
        "loaded — done with nothing but a floor. It exists because anti-extension is the one core " +
        "pattern this program has no answer for away from the rings, and a pattern with no answer is " +
        "a hole in the week rather than a missing exercise.",
      note:
        "Progressed by LEVER, not by time. Adding minutes to a plank stops being useful quickly; " +
        "sliding the elbows forward keeps it hard at 20-45 seconds, which is the range that trains " +
        "something. If you are holding a level for over a minute, you are on the wrong level.",
    },

    /* ---------------------------------------------------------------- */
    /* Floor                                                             */
    /* ---------------------------------------------------------------- */
    pushup: {
      name: "Push-ups",
      search: "push up form tutorial",
      station: "floor",
      pattern: "push-horizontal",
      sets: 3,
      trimPriority: 7,
      minSets: 2,
      metric: "reps",
      range: [10, 12],
      step: 1,
      rest: 90,
      /* The bars are a RANGE bonus, not a requirement. Requiring them meant a
       * park had no horizontal push at all, which is absurd — the body position
       * is the load, and the hands being raised just lets the chest travel
       * further. Ladder positions are unchanged, so nothing has to migrate. */
      needs: [],
      progression: "ladder-then-vest",
      ladder: [
        {
          name: "Knees down",
          note: "On the push-up bars if you have them",
          addCues: ["No bars? Hands on the floor. You lose a little range, not the exercise"],
        },
        {
          name: "Full",
          note: "On the push-up bars if you have them",
          addCues: ["No bars? Hands on the floor. You lose a little range, not the exercise"],
        },
        { name: "Feet on the sofa chair", note: "20 cm", needs: ["step-20"], },
        { name: "Feet on the chair", note: "45 cm", needs: ["step-45"], },
        {
          name: "Rings on the floor",
          note: "Hands in the rings — instability on top of the deficit",

          cues: [
            "Rings turned out at the top and pressed in against the ribs",
            "Fight the rings drifting apart — that is most of the work here",
            "Elbows at roughly 45° to the body, not flared to 90°",
            "Expect to lose several reps to the instability; that is the point",
          ],
          needs: ["handles-low"],
        },
      ],
      cues: [
        "If you are on the bars, let the chest drop BELOW the hands — that range is why they exist",
        "Elbows at roughly 45° to the body, not flared to 90°",
      ],
      note:
        "The top level needs the rings on the floor. On the push day they are already down there for " +
        "the leg curl; on the pull day it costs one extra adjustment at the very end of the session.",
      why:
        "Horizontal push volume that costs nothing to set up. The deficit from the bars is the reason " +
        "this is not redundant with dips — it trains the chest in a much longer position.",
    },
    /* ---------------------------------------------------------------- */
    /* Legs — knee-dominant on day A, hip-dominant on day B              */
    /* ---------------------------------------------------------------- */
    "split-squat": {
      name: "Split squats",
      search: "bulgarian split squat form tutorial",
      station: "rings-chest",
      pattern: "legs-knee",
      sets: 3,
      trimPriority: 4,
      minSets: 2,
      metric: "reps",
      range: [10, 15],
      step: 1,
      rest: 90,
      superset: "prehab-pair",
      needs: [],
      progression: "ladder-then-vest",
      ladder: [
        {
          name: "Bodyweight squat",
          note: "Both legs, full depth, no rings",
          cues: [
            "Feet shoulder-width, toes turned out slightly",
            "Sit down between the hips rather than folding forward",
            "All the way down — thighs past parallel if the ankles allow it",
            "Arms out in front as a counterweight if that helps you stay upright",
          ],
        },
        { name: "Split squat", note: "Fingertips on the rings for balance only", perSide: true, needs: ["steady"], },
        { name: "Rear foot on the sofa chair", note: "20 cm — the same movement as level 4, on a lower step", image: "images/split-squat-L4.gif", perSide: true, needs: ["steady", "step-20"], },
        { name: "Rear foot on the chair", note: "45 cm — the full Bulgarian split squat", perSide: true, needs: ["steady", "step-45"], },
        /* A pistol is a different exercise that happens to share this ladder,
         * so it carries its own range: 10-15 per side is a prescription nobody
         * would write for one, and it was only ever inherited. */
        {
          name: "Ring-assisted pistol",
          note: "Hold the rings, one leg, full depth",
          perSide: true,
          range: [6, 10],
          cues: [
            "Free leg straight out in front, heel off the floor the whole rep",
            "Sit BACK, not down — the hips travel behind the heel, then under it",
            "Working heel stays flat; if it lifts, take more weight through your hands",
            "Pull on your support only as much as you need to — that is the load dial",
          ],
          needs: ["steady"],
        },
      ],
      cues: [
        "Front shin roughly vertical, back knee down to just off the floor",
        "Whatever you are holding is for balance, not for pulling yourself up — fingertips only",
        "Both sides back to back, then rest once",
      ],
      why:
        "The knee-dominant pattern. Single-leg work reaches a useful stimulus at bodyweight long after " +
        "two-leg squats have stopped being hard, and the chest-height rings give exactly the light " +
        "balance support that makes deep ranges trainable.",
    },
    /* The answer to the one pattern nothing away from home could train. A
     * towel on a hard floor is not equipment in any sense the app models, so
     * this needs nothing at all — which makes knee flexion the last pattern to
     * become possible in a park, a gym and an empty hotel room. Unscheduled,
     * so it shows up as a choice against the ring curl rather than replacing
     * it: the ring version loads the hamstring harder and stays the default
     * wherever there are handles. */
    "slider-leg-curl": {
      name: "Slider leg curls",
      search: "towel slider hamstring curl form tutorial",
      station: "floor",
      pattern: "legs-knee-flexion",
      sets: 3,
      trimPriority: 2,
      minSets: 2,
      metric: "reps",
      range: [8, 12],
      step: 1,
      rest: 90,
      needs: [],
      progression: "ladder",
      ladder: [
        { name: "Both legs, hips low", note: "Hips just off the floor, heels slide a short way" },
        { name: "Both legs, hips bridged", note: "Hips stay up, heels slide to about half range" },
        { name: "Both legs, full range", note: "Heels all the way out to straight legs, hips still up" },
        { name: "Full range, 3 s out", note: "Three seconds sliding out, pull back in normally" },
        {
          name: "One leg",
          note: "Free leg held straight up",
          perSide: true,
          addCues: ["Free leg held straight up, hips square — do not let the working side rotate"],
        },
      ],
      cues: [
        "A towel under the heels on a hard floor, or socks on laminate — anything that slides",
        "Flat on your back, drive the hips up BEFORE the first rep",
        "Hips stay high the whole set — the moment they drop, the set is over",
        "Pull with the hamstrings, not by yanking the hips",
      ],
      why:
        "Knee flexion with nothing but a floor and a towel. Less loading than the ring version — your " +
        "heels stay on the ground rather than hanging — but it is the difference between training the " +
        "hamstrings away from home and not training them at all.",
      note:
        "Carpet will not slide. If the floor fights you, use the ring curl instead — that is what the " +
        "swap on this card is for.",
    },

    /* Push-horizontal is the second-highest volume pattern in the week, so it
     * is one of the places variety is genuinely free. Close hands is a real
     * change of emphasis rather than the same push-up renamed. */
    "diamond-pushup": {
      name: "Close-grip push-ups",
      search: "diamond close grip push up form tutorial",
      station: "floor",
      pattern: "push-horizontal",
      sets: 3,
      trimPriority: 7,
      minSets: 2,
      metric: "reps",
      range: [8, 12],
      step: 1,
      rest: 90,
      needs: [],
      progression: "ladder-then-vest",
      ladder: [
        { name: "Knees down", note: "Hands close, index fingers and thumbs touching" },
        { name: "Full" },
        { name: "Feet on the sofa chair", note: "20 cm", needs: ["step-20"] },
        { name: "Feet on the chair", note: "45 cm", needs: ["step-45"] },
      ],
      cues: [
        "Hands under the sternum, index fingers and thumbs touching",
        "Elbows stay tight to the ribs — that is the whole point of the grip",
        "Wrists sore? Turn the hands slightly out, or make a smaller triangle rather than a full diamond",
      ],
      why:
        "The same horizontal push biased hard toward the triceps and the inner chest. Expect several " +
        "fewer reps than a normal push-up at the same level — it is a different exercise, not an easier one.",
    },

    /* Pull-horizontal is the joint-highest volume pattern. Archer rows are the
     * honest variant: unilateral, so each side gets a much larger share of the
     * load without needing a single thing added to the room. */
    "archer-row": {
      name: "Archer rows",
      search: "archer inverted row form tutorial",
      station: "rings-chest",
      pattern: "pull-horizontal",
      sets: 3,
      trimPriority: 2,
      minSets: 2,
      metric: "reps",
      range: [6, 10],
      step: 1,
      rest: 90,
      needs: ["grip-chest"],
      progression: "ladder",
      perSide: true,
      ladder: [
        { name: "Feet under, slight reach", note: "Torso upright — the free arm only just straightens" },
        { name: "Feet walked forward", note: "Roughly 45°, free arm straight" },
        { name: "Body horizontal", note: "Heels on the floor, free arm straight out to the side" },
        { name: "Heels on the sofa chair", note: "20 cm", needs: ["grip-chest", "step-20"] },
      ],
      cues: [
        "Pull to ONE side — the working elbow goes to that hip, the other arm straightens out sideways",
        "The free arm is a guide, not a second pull: keep it straight and light",
        "Shoulders stay square to the ceiling; the temptation is to roll away from the working side",
      ],
      why:
        "The horizontal pull with most of the load on one side at a time, which is how you keep making " +
        "it harder once body-horizontal rows stop being difficult and before a vest is worth it.",
    },

    "hip-thrust": {
      name: "Hip thrusts",
      search: "hip thrust bench form tutorial",
      station: "floor",
      pattern: "legs-hip",
      sets: 3,
      trimPriority: 4,
      minSets: 2,
      metric: "reps",
      range: [10, 15],
      step: 1,
      rest: 90,
      needs: [],
      progression: "ladder-then-vest",
      ladder: [
        {
          name: "Glute bridge on the floor",
          note: "Both legs, shoulders and feet down",
          cues: [
            "Heels close enough that your fingertips brush them",
            "Ribs down, chin tucked — squeeze the glutes to get high, never arch the back",
            "Pause a full second at the top of every rep",
            "Shoulders stay on the floor; nothing here needs a chair yet",
          ],
        },
        { name: "Feet on the sofa chair", note: "20 cm — both legs, longer range", image: "https://raw.githubusercontent.com/Th0masL/exercises-dataset/main/videos/3523-aWedzZX.gif", needs: ["step-20"], },
        { name: "Shoulders on the chair", note: "45 cm — the real hip thrust, shoulder blades on the edge", needs: ["step-45"], },
        {
          name: "Shoulders on the chair, one leg",
          perSide: true,
          addCues: [
            "Free leg tucked to the chest, not dangling — it keeps the pelvis level",
            "Hips must stay square: if one side drops, the set is over",
          ],
          needs: ["step-45"],
        },
      ],
      cues: [
        "Ribs down, chin tucked — squeeze the glutes to get high, never arch the back to gain height",
        "Pause a full second at the top of every rep",
        "Wear the vest pulled low so the weight sits over the hips, not the chest",
        "Put the 45 cm chair against a wall so it cannot slide out from under you",
      ],
      why:
        "The main hip extensor movement, and the one leg exercise here that takes vest load well — the " +
        "weight sits right over the hips. Level 3 is a genuine hip thrust with full range, which is a long " +
        "way beyond what a floor glute bridge can give you.",
    },
    "ring-leg-curl": {
      name: "Leg curls",
      search: "TRX hamstring curl form tutorial",
      station: "rings-low",
      pattern: "legs-knee-flexion",
      sets: 3,
      trimPriority: 2,
      minSets: 2,
      metric: "reps",
      range: [8, 12],
      step: 1,
      rest: 90,
      needs: ["handles-low"],
      progression: "ladder",
      ladder: [
        { name: "Knees bent, hips low", note: "Short lever, partial range — the way in" },
        { name: "Hips bridged, partial range" },
        { name: "Hips bridged, full range" },
        { name: "Full range, 3 s eccentric" },
        {
          name: "One leg",
          note: "Other foot held off the ring",
          perSide: true,
          addCues: ["Free leg held straight up, hips square — do not let the working side rotate"],
        },
      ],
      cues: [
        "Flat on your back, heels in the rings, drive the hips up BEFORE the first rep",
        "Hips stay high the whole set — the moment they drop, the set is over",
        "Lower slowly: the rings pull away from you and that is the hard part",
      ],
      why:
        "The one exercise here that trains knee flexion — the hamstrings' actual job — and close to " +
        "impossible to replicate without rings or a machine. Paired with the hip thrust it covers both " +
        "ends of the hamstring, which is most of what a barbell deadlift would give you.",
      note:
        "No vest: a torso vest loads the bridge, not the curl, so progression is the ladder only. " +
        "Expect hamstring cramp in the first few sessions — drop a level rather than fighting it, and do " +
        "not skip the good mornings in the warm-up, which is what this exercise is relying on.",
    },
    "pike-pushup": {
      name: "Pike push-ups",
      search: "pike push up form progression tutorial",
      station: "floor",
      pattern: "push-vertical",
      sets: 3,
      trimPriority: 3,
      minSets: 2,
      metric: "reps",
      range: [6, 10],
      step: 1,
      rest: 90,
      /* Hands flat on the floor is the normal way to do this. The bars only
       * matter at the top rung, where the point is the deficit. */
      needs: [],
      progression: "ladder-then-vest",
      ladder: [
        { name: "Feet on the floor", note: "Hips high, an inverted V — hands flat, no bars needed" },
        { name: "Feet on the sofa chair", note: "20 cm — hips stack further over the shoulders", needs: ["step-20"], },
        { name: "Feet on the chair", note: "45 cm — close to vertical", needs: ["step-45"], },
        {
          name: "Feet on the chair, on the bars",
          note: "Deficit — the head drops below the hands",

          addCues: ["The bars are what makes this a deficit — use the extra range rather than stopping short"],
          needs: ["handles-floor", "step-45"],
        },
      ],
      cues: [
        "Hips high and stacked over the shoulders — the straighter the torso, the more this becomes a press",
        "Lower the crown of the head toward the floor, not your face",
        "Elbows track forward over the hands, not flared out to the sides",
      ],
      why:
        "The vertical press, and the one pattern a rings-and-bodyweight program usually leaves out " +
        "entirely. Nothing else here trains the shoulder overhead, and the ladder runs all the way to " +
        "a handstand push-up, so it does not cap out.",
    },
    "calf-raise": {
      name: "Calf raises",
      search: "single leg calf raise form tutorial",
      image: "https://raw.githubusercontent.com/Th0masL/exercises-gifs/main/assets/1373.gif",
      station: "floor",
      pattern: "legs-calf",
      sets: 2,
      trimPriority: 9,
      minSets: 1,
      metric: "reps",
      range: [12, 20],
      step: 2,
      rest: 60,
      needs: [],
      progression: "ladder-then-vest",
      ladder: [
        { name: "Both legs, floor" },
        { name: "Both legs, 2 s pause at the top" },
        { name: "One leg, floor", perSide: true, addCues: ["Rest the free foot behind the working ankle, not on the floor"] },
        { name: "One leg, 2 s pause at the top", perSide: true, addCues: ["Rest the free foot behind the working ankle, not on the floor"] },
      ],
      cues: [
        "Pause at the top, lower all the way down — no bouncing",
        "Fingertips on a wall for balance",
        "If you find a stair or doorstep, do them off the edge for a deeper stretch — better, but not required",
      ],
      why:
        "Cheap insurance for the only lower-body muscle nothing else here touches, and the cheapest " +
        "thing in the session: two sets at the very end, first to go when the clock is tight.",
    },
  },

  /* Legs are split by pattern rather than repeated: knee-dominant on the pull
   * day, hip-dominant on the push day. Each pattern lands ~1.5x/week, upper
   * body is trained every session, and neither grows past ~50 minutes. */
  workouts: {
    A: {
      name: "Pull emphasis",
      legs: "Knee-dominant",
      order: [
        { id: "movement-prep" },
        { id: "dead-hang" },
        { id: "ring-scap-pull" },
        { id: "ring-pullup" },
        { id: "hanging-leg-raise" },
        /* Split squats sit ahead of the row/dip pair so a non-grip movement
         * separates them from the pull-ups and hanging leg raises above. */
        { id: "split-squat" },
        /* Face pulls sit immediately before the dips — rear-delt prep right in
         * front of the movement most likely to bother a shoulder. */
        { id: "ring-facepull" },
        { id: "ring-row" },
        { id: "ring-dip" },
        /* Overhead pressing was the one working pattern trained on a single day,
         * at nine sets a fortnight against eighteen for the dip — and the dip is
         * the movement most likely to bother a shoulder that never presses
         * overhead. Two sets rather than three because the pull day is the one
         * with room, and it takes the freshest floor slot for the same reason it
         * does on the push day: it is the weakest pattern here. */
        { id: "pike-pushup", setCount: 2 },
        /* Two sets only on the pull day — the chest already took three sets of
         * dips, and this is where the time for legs comes from. */
        { id: "pushup", setCount: 2 },
        { id: "calf-raise" },
      ],
    },
    B: {
      name: "Push emphasis",
      legs: "Hip-dominant",
      order: [
        { id: "movement-prep" },
        { id: "dead-hang" },
        { id: "ring-scap-pull" },
        { id: "ring-chinup" },
        { id: "ring-dip" },
        /* B runs rows one level harder than A — this is the "feet elevated"
         * variant from the original plan, expressed as a ladder offset so both
         * days still share one progression state. */
        { id: "ring-row", levelOffset: 1 },
        { id: "ring-fallout" },
        { id: "ring-leg-curl" },
        /* Pike push-ups take the freshest floor slot — vertical pressing is the
         * weakest pattern here and the hip thrust then buffers it from the
         * horizontal pressing below. */
        { id: "pike-pushup" },
        { id: "hip-thrust" },
        { id: "pushup" },
      ],
    },
  },
};
