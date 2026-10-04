/* Workout tracker — vanilla JS, no dependencies, no build step.
 *
 * Everything lives in localStorage under one key. The only non-trivial logic
 * (what to do next session) lives in progression.js; this file is UI, storage
 * and the session timer.
 */
(function () {
  "use strict";

  var P = window.PROGRAM;
  var PR = window.Progression;
  var DP = window.DomPatch;
  var CUES = window.Cues;
  var KEY = "workout-program:v1";
  var MAX_IMPORT_BYTES = 5 * 1024 * 1024;
  var MAX_SESSIONS = 5000;
  var MAX_SETS_PER_ENTRY = 100;
  var MAX_TOTAL_SETS = 100000;
  var storageIssue = "";
  var rejectedPayload = null;
  var mediaCacheState =
    location.protocol.indexOf("http") === 0 && "serviceWorker" in navigator
      ? "Waiting for the offline cache…"
      : "Unavailable in this launch mode.";
  var mediaCacheBad = false;
  var updateReady = false;

  if (!P || !PR || !DP || !CUES) {
    document.getElementById("view-today").innerHTML =
      '<div class="panel pad empty">Could not load one of data/program.js, progression.js, ' +
      "patch.js or audio.js.</div>";
    return;
  }

  /* ================================================================ */
  /* Storage                                                           */
  /* ================================================================ */

  var DEFAULT_SETTINGS = {
    audioWarmupMs: 600, // silent lead-in that wakes a sleeping Bluetooth link
    voiceName: "", // "" = pick automatically
    holdLeadIn: 5, // seconds to get into position before a hold starts counting
    holdCallEvery: 10, // call the time out every N seconds during a hold; 0 = off
    sound: "voice", // "voice" | "beep" | "off"
    sessionCapMin: 0, // 0 = run the full program, no trimming
    kit: P.places.home.has.slice(), // the equipment in front of you right now
    variant: {}, // slot ("A:ring-pullup") -> the exercise you chose instead
    gear: {}, // capability ("hang-high") -> which of the ticked things provides it
    phaseOverride: 0, // 0 = automatic
    restTimer: true,
    bodyweightKg: null,
  };

  /* Declared before load(), which fills it — the other way round the var
   * initialiser runs second and wipes what load() just put there. */
  var migrationNotes = [];
  var migrated = false;
  var storedSnapshot = null;
  var state = load();

  function clone(v) {
    if (Array.isArray(v)) return v.slice();
    if (v && typeof v === "object") {
      var out = {};
      for (var k in v) out[k] = v[k];
      return out;
    }
    return v;
  }

  function isRecord(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function validateEntries(entries, active, tally) {
    if (!isRecord(entries)) throw new Error("entries must be an object");
    Object.keys(entries).forEach(function (id) {
      if (active && !P.exercises[id]) throw new Error("active session contains an unknown exercise");
      var entry = entries[id];
      if (!isRecord(entry) || !Array.isArray(entry.sets))
        throw new Error("an exercise entry has no set list");
      if (entry.sets.length > MAX_SETS_PER_ENTRY)
        throw new Error("an exercise entry contains too many sets");
      tally.sets += entry.sets.length;
      if (tally.sets > MAX_TOTAL_SETS) throw new Error("backup contains too many sets");
      entry.sets.forEach(function (set) {
        if (!isRecord(set)) throw new Error("a set is not an object");
        ["value", "load"].forEach(function (key) {
          if (set[key] !== null && set[key] !== undefined &&
              (typeof set[key] !== "number" || !isFinite(set[key]) || set[key] < 0))
            throw new Error("a set contains an invalid " + key);
        });
      });
    });
  }

  function validateState(s) {
    if (!isRecord(s)) throw new Error("backup root must be an object");
    if (s.settings !== undefined && !isRecord(s.settings))
      throw new Error("settings must be an object");
    if (s.exerciseState !== undefined && !isRecord(s.exerciseState))
      throw new Error("exerciseState must be an object");
    Object.keys(s.exerciseState || {}).forEach(function (id) {
      if (!isRecord(s.exerciseState[id])) throw new Error("an exercise state is invalid");
    });
    var settings = s.settings || {};
    if (settings.kit !== undefined &&
        (!Array.isArray(settings.kit) || settings.kit.some(function (k) { return !P.equipment[k]; })))
      throw new Error("equipment settings are invalid");
    if (settings.gear !== undefined && !isRecord(settings.gear))
      throw new Error("gear settings are invalid");
    if (settings.variant !== undefined && !isRecord(settings.variant))
      throw new Error("exercise choices are invalid");
    if (settings.sound !== undefined && ["voice", "beep", "off"].indexOf(settings.sound) < 0)
      throw new Error("sound setting is invalid");
    ["audioWarmupMs", "holdLeadIn", "holdCallEvery", "sessionCapMin", "phaseOverride", "bodyweightKg"]
      .forEach(function (key) {
        if (settings[key] !== undefined && settings[key] !== null &&
            (typeof settings[key] !== "number" || !isFinite(settings[key])))
          throw new Error(key + " setting is invalid");
      });
    if (settings.restTimer !== undefined && typeof settings.restTimer !== "boolean")
      throw new Error("rest timer setting is invalid");
    if (!Array.isArray(s.sessions)) throw new Error("sessions must be an array");
    if (s.sessions.length > MAX_SESSIONS) throw new Error("backup contains too many sessions");
    var tally = { sets: 0 };
    s.sessions.forEach(function (session) {
      if (!isRecord(session) || !P.workouts[session.workout])
        throw new Error("a session has an invalid workout");
      validateEntries(session.entries, false, tally);
    });
    if (s.active !== undefined && s.active !== null) {
      if (!isRecord(s.active) || !P.workouts[s.active.workout])
        throw new Error("active session has an invalid workout");
      validateEntries(s.active.entries, true, tally);
    }
    if (s.nextOverride !== undefined && s.nextOverride !== null && !P.workouts[s.nextOverride])
      throw new Error("next workout override is invalid");
  }

  function prepareState(raw, strictExport) {
    if (strictExport && (!isRecord(raw) || !Array.isArray(raw.sessions)))
      throw new Error("not a workout export");
    if (raw && typeof raw.version === "number" && raw.version > PR.SCHEMA)
      throw new Error("backup was created by a newer version of Workout");
    var m = PR.migrate(raw, P);
    var s = m.state;
    if (!Array.isArray(s.sessions)) s.sessions = [];
    validateState(s);
    var settings = {};
    for (var k in DEFAULT_SETTINGS) {
      var stored = s.settings && s.settings[k] !== undefined ? s.settings[k] : null;
      settings[k] = stored !== null ? stored : clone(DEFAULT_SETTINGS[k]);
    }
    return {
      migrated: m.migrated,
      notes: m.migrated ? m.notes : [],
      state: {
        version: PR.SCHEMA,
        settings: settings,
        exerciseState: s.exerciseState || {},
        sessions: s.sessions,
        active: s.active || null,
        nextOverride: s.nextOverride || null,
      },
    };
  }

  function load() {
    var raw = null, prepared, storedText = null;
    try {
      storedText = localStorage.getItem(KEY);
      storedSnapshot = storedText;
      raw = JSON.parse(storedText || "null");
    } catch (e) {
      storageIssue = "Stored workout data is not valid JSON. A fresh in-memory state was opened.";
      rejectedPayload = storedText;
    }
    /* Run stored data through the schema steps BEFORE reading any of it, so a
     * shape change is handled in one place instead of by defensive checks
     * scattered through the app. */
    try {
      prepared = prepareState(raw);
    } catch (e) {
      storageIssue = "Stored workout data was rejected: " + e.message;
      rejectedPayload = storedText;
      prepared = prepareState(null);
    }
    migrated = prepared.migrated;
    migrationNotes = prepared.notes;
    return prepared.state;
  }

  function storageIsCurrent() {
    try {
      if (localStorage.getItem(KEY) === storedSnapshot) return true;
    } catch (e) {
      // Keep the in-memory recovery workflow available when storage is blocked.
      return true;
    }
    storageIssue = "Workout data changed in another tab. Reload before making more changes. Download recovery data first if this tab has unsaved work.";
    showStorageWarning();
    return false;
  }

  function save() {
    invalidatePlan();
    try {
      if (!storageIsCurrent()) return false;
      var text = JSON.stringify(state);
      localStorage.setItem(KEY, text);
      storedSnapshot = text;
      storageIssue = "";
      rejectedPayload = null;
      showStorageWarning();
      return true;
    } catch (e) {
      console.warn("Could not save:", e);
      storageIssue = "Browser storage is unavailable or full (" +
        ((e && e.name) || "write failed") + "). Keep this page open and download a backup.";
      showStorageWarning();
      return false;
    }
  }

  function showStorageWarning() {
    var box = document.getElementById("storageWarning");
    if (!box) return;
    box.hidden = !storageIssue;
    if (storageIssue) document.getElementById("storageWarningWhat").textContent = storageIssue;
  }

  function exState(id) {
    var ex = P.exercises[id];
    if (!state.exerciseState[id]) state.exerciseState[id] = PR.initialState(ex);
    return PR.normalizeState(ex, state.exerciseState[id]);
  }

  /* ================================================================ */
  /* When something breaks                                             */
  /* ================================================================ */

  /* None of this should ever fire. It exists because the alternative failure
   * mode is a blank or frozen page with the reason in a console nobody opens on
   * a phone — and at that point there is no way to tell a rendering bug from
   * lost training data. It is never lost: everything logged is in localStorage
   * before the screen is touched. Say so, and offer a way out. */
  function fail(where, err) {
    try {
      if (window.console) console.error("[" + where + "]", err);
      var box = document.getElementById("crash");
      if (!box) return;
      document.getElementById("crashWhere").textContent = "— " + where;
      document.getElementById("crashWhat").textContent =
        (err && err.message) || String(err) || "unknown error";
      box.hidden = false;
    } catch (e) {
      /* There is nothing left to fall back to. */
    }
  }

  /* Wraps a callback so one failure does not take the whole app with it. The
   * click handler especially: without this, one bad tap kills the listener and
   * every button on the page goes dead at once, with no visible cause. */
  function guard(where, fn) {
    return function () {
      try {
        if (!storageIsCurrent()) return;
        return fn.apply(this, arguments);
      } catch (e) {
        fail(where, e);
      }
    };
  }

  /* ================================================================ */
  /* The clock                                                         */
  /* ================================================================ */

  /* The ONE place this app reads the time.
   *
   * Everything that depends on it — the hold timer, the get-into-position
   * countdown, the rest bar, the Bluetooth priming window, phase rollover —
   * used to call Date.now() directly, which is why none of it had a test: you
   * cannot assert on a countdown you have to sit and wait for. Routed through
   * here, a test advances the clock instead.
   *
   * window.CLOCK is the test seam and is never present in a browser. */
  var clock = window.CLOCK || null;

  function now() {
    return clock ? clock.now() : Date.now();
  }

  function nowISO() {
    return new Date(now()).toISOString();
  }

  /* ================================================================ */
  /* Derived                                                           */
  /* ================================================================ */

  function todayISO() {
    var d = new Date(now());
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }

  function currentPhase() {
    var first = state.sessions.length ? state.sessions[0].date : null;
    return PR.phaseFor({
      phases: P.phases,
      sessionCount: state.sessions.length,
      weeksElapsed: PR.weeksBetween(first, todayISO()),
      override: state.settings.phaseOverride || 0,
    });
  }

  function currentGap() {
    var first = state.sessions.length ? state.sessions[0].date : null;
    return PR.phaseGap({
      phases: P.phases,
      sessionCount: state.sessions.length,
      weeksElapsed: PR.weeksBetween(first, todayISO()),
      override: state.settings.phaseOverride || 0,
    });
  }

  function nextWorkoutKey() {
    if (state.active) return state.active.workout;
    if (state.nextOverride && P.workouts[state.nextOverride]) return state.nextOverride;
    return PR.nextWorkout(state.sessions);
  }

  /* Where you are, and what it can do. */
  /* There is one source of truth for where you are: the equipment you ticked.
   * A named place is a BUTTON that fills that list, not a mode — so "Home plus
   * the high bar I just bought" is expressible, which it was not when the
   * places were fixed lists in the program. */
  function currentKit() {
    var k = state.settings.kit;
    return Array.isArray(k) ? k : [];
  }

  /* Which preset, if any, the ticks currently match — for highlighting only. */
  function matchingPlace() {
    var have = currentKit().slice().sort().join("|");
    return (
      Object.keys(P.places).find(function (pid) {
        return P.places[pid].has.slice().sort().join("|") === have;
      }) || null
    );
  }

  function currentPlace() {
    var pid = matchingPlace();
    return { label: (pid && P.places[pid].label) || "Custom", has: currentKit() };
  }

  function caps() {
    return PR.capabilities(currentPlace(), P.equipment, state.settings.gear);
  }

  /* The capabilities this rung needs that more than one thing here could
   * provide — i.e. the questions worth asking. Keyed by CAPABILITY, not by
   * exercise: "what do I hang from" has one answer, and it covers the chin-up,
   * the pull-up, the dead hang, the scap pull and the leg raise at once. */
  function gearChoices(t) {
    var place = currentPlace();
    var out = [];
    (t.needs || []).forEach(function (cap) {
      var opts = PR.providersFor(cap, place, P.equipment);
      if (opts.length > 1) out.push({ cap: cap, options: opts });
    });
    return out;
  }

  /* The day's order, resolved against the place: every entry carries the
   * highest level this room can actually support, and anything with no usable
   * level at all is left out and reported separately rather than silently
   * vanishing from the session. */
  /* Which exercise fills a slot, given what you picked.
   *
   * Keyed by WORKOUT AND SLOT, not by pattern: A does pull-ups and B does
   * chin-ups on purpose, and a per-pattern key would collapse that the moment
   * you swapped either one. */
  function slotKey(workout, id) {
    return workout + ":" + id;
  }

  function chosenFor(workout, o) {
    var picked = (state.settings.variant || {})[slotKey(workout, o.id)];
    return (picked && P.exercises[picked] && picked) || o.id;
  }

  function workoutItems(key) {
    var c = caps();
    var out = [];
    P.workouts[key].order.forEach(function (slot) {
      /* A deliberate swap behaves exactly like the prescribed exercise from
       * here on — including being substituted away if the room cannot do it. */
      var o = slot;
      var pick = chosenFor(key, slot);
      if (pick !== slot.id) {
        o = {};
        for (var kk in slot) o[kk] = slot[kk];
        o.id = pick;
        o.setCount = slot.setCount || P.exercises[slot.id].sets;
        o.chosenOver = slot.id;
        /* The offset tuned A's row against B's belongs to the exercise it was
         * measured on, not to whatever you swap in. */
        delete o.levelOffset;
      }
      var ex = P.exercises[o.id];
      if (!ex) return;
      var st = exState(o.id);
      var here = PR.usableLevel(ex, st.level + (o.levelOffset || 0), c);
      if (here >= 0) {
        var e = {};
        for (var k in o) e[k] = o[k];
        e.levelHere = here;
        e.slot = slot.id;
        out.push(e);
        return;
      }
      /* Nothing on this ladder is possible here, so reach for something that
       * trains the same pattern and is. The volume the workout asked for
       * carries over; the level does not, because it belongs to the exercise. */
      var sub = PR.substituteFor(ex, P.exercises, c);
      if (!sub) return;
      out.push({
        id: sub,
        setCount: o.setCount || ex.sets,
        levelHere: PR.usableLevel(P.exercises[sub], exState(sub).level, c),
        standsInFor: o.id,
        slot: slot.id,
      });
    });
    return out;
  }



  var CAPS = [30, 40, 50, 0]; // 0 = full

  var TIME_OPTS = { transition: P.time.transition, ringAdjust: P.time.ringAdjust };

  /* Generic {sets, workSeconds, rest, station, ...} items for the time model.
   * The station travels with the item so the timeline can charge for a ring
   * adjustment where it actually happens, instead of adding a lump sum. */
  function planItems(key) {
    var phase = currentPhase();
    return workoutItems(key).map(function (o) {
      var ex = P.exercises[o.id];
      var t = PR.target(ex, exState(o.id), phase, o);
      var work = t.metric === "seconds" ? t.value : t.value * P.time.secondsPerRep;
      return {
        id: o.id,
        /* Sets you have cut cost nothing — the whole point of cutting them is
         * that the number at the top of the screen comes down. */
        sets: liveSets(o.id, t.sets),
        workSeconds: work * (t.perSide ? 2 : 1),
        rest: t.rest,
        superset: ex.superset || null,
        station: t.station,
        stationAdjust: !!P.stations[t.station].adjust,
        trimPriority: ex.trimPriority || 0,
        minSets: ex.minSets || 1,
        fixed: ex.progression === "fixed",
        /* Carried through so the swap list stays anchored to the SLOT: without
         * it the options would reorder under your thumb every time you picked
         * one, because the list is built around whichever is showing. */
        slot: o.slot || o.id,
      };
    });
  }

  /* The whole session plan, computed once and reused for the rest of the
   * render: the trim, the estimate and the timeline all come from here.
   *
   * Memoised because it is not cheap — every card asks for it, and each ask
   * used to re-run the trimmer over all eleven exercises. save() and render()
   * clear it, so nothing can read a stale plan. */
  var planCache = null;

  function invalidatePlan() {
    planCache = null;
  }

  function planFor(key) {
    if (planCache && planCache.key === key) return planCache;
    var items = planItems(key);
    var full = PR.estimate(items, TIME_OPTS);
    var cap = state.settings.sessionCapMin || 0;
    var r = cap
      ? PR.fit(items, cap * 60, TIME_OPTS)
      : { items: items, trimmed: [], seconds: full, overBudget: false };
    var byId = null;
    if (cap) {
      byId = {};
      r.items.forEach(function (i) {
        byId[i.id] = i.sets;
      });
    }
    planCache = {
      key: key,
      byId: byId,
      seconds: r.seconds,
      full: full,
      trimmed: r.trimmed,
      overBudget: r.overBudget,
      events: PR.timeline(r.items, TIME_OPTS),
    };
    return planCache;
  }

  /* The workout order entry with the session-length trim folded in. */
  function trimmedEntry(o, key) {
    var b = planFor(key || nextWorkoutKey());
    if (!b.byId || b.byId[o.id] === undefined) return o;
    var e = {};
    for (var k in o) e[k] = o[k];
    e.setCount = b.byId[o.id];
    return e;
  }

  /* Session grouped into stations, in the fixed station order. */
  function sessionPlan(key) {
    var phase = currentPhase();
    var resolved = workoutItems(key).map(function (o) {
      var ex = P.exercises[o.id];
      var e = trimmedEntry(o, key);
      /* `slot` is the exercise the WORKOUT names, which is not `id` once you
       * have swapped. The swap list is built around it so the options keep a
       * stable order instead of reshuffling under your thumb as you pick. */
      return { id: o.id, slot: o.slot || o.id, ex: ex, entry: e,
        target: PR.target(ex, exState(o.id), phase, e) };
    });
    var groups = [];
    P.stationOrder.forEach(function (stKey) {
      /* Grouped by the station this exercise is at TODAY. Assisted ring dips
       * need the rings low enough to reach the floor and unassisted ones need
       * them high enough not to, so an exercise moves between blocks as you
       * climb its ladder — and the session order follows automatically. */
      var inStation = resolved.filter(function (it) {
        return it.target.station === stKey;
      });
      if (!inStation.length) return;
      groups.push({ key: stKey, station: P.stations[stKey], items: inStation });
    });
    return groups;
  }

  /* ================================================================ */
  /* Active session                                                    */
  /* ================================================================ */

  function startSession() {
    var key = nextWorkoutKey();
    state.active = {
      workout: key,
      startedAt: nowISO(),
      date: todayISO(),
      phaseId: currentPhase().id,
      note: "",
      entries: {},
    };
    workoutItems(key).forEach(ensureEntry);
    save();
    requestWakeLock();
    render();
  }

  /* An entry records what you DID, and nothing else.
   *
   * It used to also hold a frozen copy of the prescription — level, target, the
   * vest, and a number on every set including the ones not yet done. That is
   * two sources of truth for "what am I doing right now", and they drift: lower
   * the session cap or cross a phase boundary mid-workout and the entry keeps
   * the old numbers while the card computes new ones.
   *
   * So: `null` means "follow the plan" and a number means "I changed this".
   * Logging a set freezes both, because at that point they are a record rather
   * than a prescription. */
  function ensureEntry(o) {
    if (!state.active) return null;
    o = trimmedEntry(o, state.active.workout);
    var tgt = PR.target(P.exercises[o.id], exState(o.id), currentPhase(), o);
    if (!state.active.entries[o.id]) state.active.entries[o.id] = { vest: null, sets: [] };
    var e = state.active.entries[o.id];
    while (e.sets.length < tgt.sets) e.sets.push(plannedSet());
    /* Lowering the cap mid-session drops trailing sets that were never logged
     * and were not added by hand. */
    var drop = PR.droppableSets(e.sets, tgt.sets);
    for (var d = 0; d < drop; d++) e.sets.pop();
    return e;
  }

  function plannedSet() {
    return { done: false, value: null, load: null };
  }

  /* Today's prescription for an exercise, on the day that is actually running. */
  function targetFor(id) {
    return PR.target(P.exercises[id], exState(id), currentPhase(), entryFor(id));
  }

  /* Resolving the three things a set can inherit from the plan. */
  function entryVest(id, t) {
    var e = state.active && state.active.entries[id];
    return e && typeof e.vest === "number" ? e.vest : t.vest;
  }
  function setValue(st, t) {
    return typeof st.value === "number" ? st.value : t.value;
  }

  /* A set wound down to zero is one you have decided not to do. It is not a
   * failed set and not a missing one — it is a smaller session, chosen on
   * purpose, and everything downstream treats it as though it was never
   * prescribed: no time in the estimate, no rest before it, no place in the
   * running order, and not counted against you at the end. */
  function isSkipped(st) {
    return st.value === 0 && !st.done;
  }

  /* How many sets of this exercise you are actually going to do today. */
  function liveSets(id, fallback) {
    var e = state.active && state.active.entries[id];
    if (!e) return fallback;
    var n = 0;
    e.sets.forEach(function (st) {
      if (!isSkipped(st)) n++;
    });
    return n;
  }

  /* Which set of this exercise is the next one you may log.
   *
   * You do set 1, then set 2, then set 3 — so only one row at a time is
   * loggable. Without this a mis-tap on the wrong row records a set you have
   * not done, at numbers that were meant for later, and the only clue is a tick
   * appearing in the wrong place. Cut sets are stepped over; done ones are
   * behind you. Undo reopens a row and hands the turn back to it. */
  /* Same question, answerable before a session exists — a tap out of turn must
   * not even start one, or the reject leaves a session running that the user
   * never asked for. With nothing logged the turn is always the first set. */
  function turnFor(exId) {
    var e = state.active && state.active.entries[exId];
    return e ? nextLoggable(e) : 0;
  }

  function nextLoggable(entry) {
    if (!entry) return 0;
    for (var i = 0; i < entry.sets.length; i++) {
      var st = entry.sets[i];
      if (!st.done && !isSkipped(st)) return i;
    }
    return -1;
  }

  /* The floor. Cutting a main lift to a single set is not a shorter session,
   * it is a different one — so the same minimum the time-cap trimmer respects
   * applies here, and the minus stops rather than going to zero. */
  function canSkip(id, fallback) {
    return liveSets(id, fallback) - 1 >= (P.exercises[id].minSets || 1);
  }
  function setLoad(st, id, t) {
    return typeof st.load === "number" ? st.load : entryVest(id, t);
  }

  function finishSession() {
    if (!state.active) return;
    commitHold(); // a plank still running when you hit Finish still counts
    var a = state.active;
    var phase = currentPhase();
    var results = [];

    var logged = {};
    workoutItems(a.workout).forEach(function (o) {
      var id = o.id;
      var ex = P.exercises[id];
      var entry = a.entries[id];
      if (!entry) return;
      var dayEntry = trimmedEntry(o, a.workout);
      /* Judged against the session you chose to do, not the one that was
       * prescribed before you ran out of time. A cut set is not a missed one —
       * scoring it as a miss would deload you for being busy. */
      if (entry) {
        var meant = liveSets(id, dayEntry.setCount || ex.sets);
        if (meant !== (dayEntry.setCount || ex.sets)) {
          var copy = {};
          for (var k in dayEntry) copy[k] = dayEntry[k];
          copy.setCount = meant;
          dayEntry = copy;
        }
      }
      /* Read the level BEFORE evaluate() replaces the state — this used to be
       * taken from the entry's frozen copy, which was written when the session
       * started and could be a phase behind by the time it was read. */
      var levelDone = PR.target(ex, exState(id), phase, dayEntry).level;
      var doneSets = entry.sets.filter(function (s) {
        return s.done;
      });
      var res = PR.evaluate({
        exercise: ex,
        state: exState(id),
        sets: doneSets.map(function (s) {
          return { value: s.value, load: s.load || 0 };
        }),
        phase: phase,
        rules: P.rules,
        entry: dayEntry,
      });
      state.exerciseState[id] = res.state;
      if (doneSets.length) {
        results.push({ id: id, name: ex.name, events: res.events, hit: res.hit });
        logged[id] = {
          level: levelDone,
          sets: doneSets.map(function (s) {
            /* `at` is kept deliberately: the gap between consecutive sets is
             * the only record of how long you ACTUALLY rested, and without it
             * the session-length model can never be checked against anything
             * but a total. */
            return { value: s.value, load: s.load || 0, at: s.at };
          }),
        };
      }
    });

    if (!Object.keys(logged).length) {
      if (!confirm("Nothing was logged. Discard this session?")) return;
      state.active = null;
      save();
      render();
      return;
    }

    state.sessions.push({
      date: a.date,
      workout: a.workout,
      phaseId: phase.id,
      startedAt: a.startedAt,
      endedAt: nowISO(),
      durationSec: Math.round((now() - Date.parse(a.startedAt)) / 1000),
      note: a.note || "",
      entries: logged,
    });
    state.active = null;
    state.nextOverride = null; // alternation resumes from what was actually done
    lastSummary = { results: results, at: now() };
    save();
    releaseWakeLock();
    stopRest();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  var lastSummary = null;

  /* ================================================================ */
  /* Hold timer — for metric:"seconds" exercises                       */
  /* ================================================================ */

  /* Counts UP, not down: if you fail a plank at 22 s against a 30 s target the
   * app must log 22, not 30. The target only decides when it beeps. Held in
   * state.active so a reload mid-plank does not lose the clock. */
  function activeHold() {
    return state.active && state.active.hold ? state.active.hold : null;
  }

  /* readyAt is when the hold actually begins; before it we are still counting
   * you into position. Falls back to startedAt for a hold saved by an older
   * version of the app. */
  function holdStartMs(h) {
    return Date.parse(h.readyAt || h.startedAt);
  }

  function holdElapsed(h) {
    return Math.max(0, Math.floor((now() - holdStartMs(h)) / 1000));
  }

  /* Seconds left of the get-into-position countdown, 0 once it has started. */
  function holdLeadLeft(h) {
    return Math.max(0, Math.ceil((holdStartMs(h) - now()) / 1000));
  }

  function commitHold() {
    var h = activeHold();
    if (!h) return;
    state.active.hold = null;
    /* Cancelled during the countdown — nothing was held, so log nothing. */
    if (holdLeadLeft(h) > 0) return h;
    var e = ensureEntry(entryFor(h.id));
    var set = e && e.sets[h.set];
    if (set && !set.done) {
      /* Logging freezes the numbers: from here they are a record of what
       * happened, not a prescription that should follow the plan. */
      set.value = Math.max(1, holdElapsed(h));
      set.load = entryVest(h.id, targetFor(h.id));
      set.done = true;
      set.at = nowISO();
      state.active.resume = null;
    }
    return h;
  }

  /* The rest a card advertises, read off the same timeline the app will run —
   * so the number printed on the card cannot disagree with the timer. For a
   * superset that is the LONGER of the pair's intervals; the engine works that
   * out when it builds the group. */
  function restFor(exId, key) {
    return PR.restForId(planFor(key || nextWorkoutKey()).events, exId);
  }

  /* The timeline of the session as it actually stands, rather than as planned:
   * set counts come from the live entries, so hand-added sets are in it. */
  function liveTimeline() {
    var a = state.active;
    var phase = currentPhase();
    var items = workoutItems(a.workout).map(function (o) {
      var ex = P.exercises[o.id];
      var e = a.entries[o.id];
      var t = PR.target(ex, exState(o.id), phase, trimmedEntry(o, a.workout));
      var work = t.metric === "seconds" ? t.value : t.value * P.time.secondsPerRep;
      return {
        id: o.id,
        sets: e ? e.sets.length : t.sets,
        workSeconds: work * (t.perSide ? 2 : 1),
        rest: t.rest,
        superset: ex.superset || null,
        station: t.station,
        stationAdjust: !!P.stations[t.station].adjust,
      };
    });
    return PR.timeline(items, TIME_OPTS);
  }

  /* The set you are on right now. Everything about this app is meant to remove
   * the "where was I?" moment, and a long scrolling page of eleven cards puts it
   * straight back if nothing says which one is live. */
  function currentPosition() {
    /* A hold that is running IS what you are doing, whatever the order says. */
    var h = activeHold();
    if (h) return { id: h.id, set: h.set };
    if (!state.active) {
      /* Nothing logged yet — point at the first thing, so a fresh session shows
       * you where to begin rather than nowhere. */
      var events = planFor(nextWorkoutKey()).events;
      for (var i = 0; i < events.length; i++) {
        if (events[i].type === "work") return { id: events[i].id, set: events[i].set };
      }
      return null;
    }
    /* Forward from the last thing you actually logged, then wrapping — the same
     * walk the rest timer uses to decide what to announce, so the highlighted
     * card is always the one it just named. Forward-first matters: skip the
     * warm-up and the marker moves on with you instead of sitting on it, but
     * the wrap means the skipped set is still reachable at the end. */
    /* Reopening a set is a deliberate "I want to redo this", so it wins over
     * the natural forward order — otherwise undo points you past the very row
     * it just put back. Cleared as soon as anything is logged. */
    var resume = state.active.resume;
    var entries = state.active.entries;
    /* "Nothing pending here", which covers both a set you have done and one you
     * have decided not to do. Keeping the skipped rows in the timeline rather
     * than filtering them out means set indices still line up with the entry,
     * which is what everything else addresses them by. */
    var done = function (id, set) {
      var e = entries[id];
      var st = e && e.sets[set];
      return !!(st && (st.done || isSkipped(st)));
    };
    if (resume && !done(resume.id, resume.set)) return { id: resume.id, set: resume.set };
    var n = PR.nextUp(liveTimeline(), lastLogged() || { id: null, set: -1 }, done);
    return n.kind === "done" ? null : { id: n.id, set: n.set };
  }

  /* The most recently logged set, by its own timestamp — so where you are
   * survives a reload rather than resetting to the top of the session. */
  function lastLogged() {
    var best = null, bestAt = "";
    var entries = (state.active && state.active.entries) || {};
    Object.keys(entries).forEach(function (id) {
      entries[id].sets.forEach(function (s, i) {
        if (s.done && s.at && s.at > bestAt) {
          bestAt = s.at;
          best = { id: id, set: i };
        }
      });
    });
    return best;
  }

  /* How this session is actually going: what is left, at the pace you are
   * really working at.
   *
   * This exists because of a real session. Workout B ran out of time and the
   * last three exercises were simply not done — the hip work and the overhead
   * press, which are the two things that day exists to provide. Nothing warned
   * anybody, because the app only ever showed the estimate it made BEFORE you
   * started and a clock counting up. Neither answers "am I going to finish". */
  function pacing() {
    if (!state.active) return null;
    var entries = state.active.entries;
    return PR.project(
      liveTimeline(),
      function (id, set) {
        var e = entries[id];
        var st = e && e.sets[set];
        return !!(st && (st.done || isSkipped(st)));
      },
      sessionElapsedSec()
    );
  }

  /* What to do the moment a set is logged — walked off the timeline rather than
   * worked out separately, so "is there a rest between these two?" has exactly
   * one answer in the whole app. */
  function whatsNext(exId, justDone) {
    if (!state.active) return { kind: "done" };
    var entries = state.active.entries;
    return PR.nextUp(liveTimeline(), { id: exId, set: justDone }, function (id, set) {
      var e = entries[id];
      var st = e && e.sets[set];
      return !!(st && (st.done || isSkipped(st)));
    });
  }

  /* ================================================================ */
  /* Rest timer                                                        */
  /* ================================================================ */

  var rest = { until: 0, total: 0, label: "" };

  /* `next` is the step this rest is holding you before — {id, set} — so the
   * card can show the countdown in the sequence rather than only in the bar at
   * the bottom of the screen. */
  function startRest(seconds, label, announce, next) {
    if (!state.settings.restTimer) return;
    rest.until = now() + seconds * 1000;
    rest.total = seconds;
    rest.label = label || "Rest";
    rest.say = announce || "";
    rest.next = next || null;
    rest.warned = false;
    tick();
    render(); // the step in the card has to pick up the countdown
  }

  /* Is the running rest the one that sits before this exercise's set N? */
  function restingBefore(id, set) {
    return !!(rest.until && rest.next && rest.next.id === id && rest.next.set === set);
  }

  function restClock(seconds) {
    return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  }

  function restLeft() {
    return Math.max(0, Math.ceil((rest.until - now()) / 1000));
  }

  function stopRest() {
    rest.until = 0;
    rest.next = null;
    document.getElementById("restBar").hidden = true;
  }

  function tick() {
    var bar = document.getElementById("restBar");
    if (!rest.until) {
      bar.hidden = true;
      return;
    }
    var left = Math.ceil((rest.until - now()) / 1000);
    if (left <= 0) {
      rest.until = 0;
      rest.next = null;
      bar.hidden = true;
      beep();
      if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
      say(rest.say);
      render(); // once, to take the countdown back out of the card
      return;
    }
    /* Ten-second warning, so you can get into position before it goes. */
    if (left <= 10 && !rest.warned && rest.total > 25) {
      rest.warned = true;
      say("Ten seconds");
    }
    bar.hidden = false;
    /* The same number in two places: the bar you can see with the phone face
     * down on the floor, and the step in the session so you can see WHERE the
     * wait sits. */
    var inline = document.getElementById("restInline");
    if (inline) inline.textContent = restClock(left);
    document.getElementById("restTime").textContent = restClock(left);
    document.getElementById("restLabel").textContent = rest.label;
    bar.style.setProperty("--fill", ((1 - left / rest.total) * 100).toFixed(1) + "%");
  }

  /* All of the audio policy lives in audio.js, which takes its clock and its
   * output device as arguments so the rules can be tested without a speaker.
   * The settings object is passed as a getter, not a value — the sound mode can
   * change mid-session and the module has to see it. */
  var cues = CUES.create({
    window: window,
    device: window.CUES_DEVICE || null, // test seam; never present in a browser
    now: now,
    settings: function () {
      return state.settings;
    },
    preferredVoice: PR.preferredVoice,
  });

  function beep(freq, dur) {
    cues.beep(freq, dur);
  }

  function say(text) {
    cues.say(text);
  }

  cues.onVoicesChanged(function (had, v) {
    /* The Data tab names the voice it will use, so it has to redraw the moment
     * the browser finally admits to having one. */
    if (!had && v && currentTab === "data") render();
  });

  /* Screen wake lock.
   *
   * Two things make this harder than one request/release pair:
   *   1. The spec releases the lock whenever the document becomes hidden, and
   *      does NOT restore it. Switch apps to change the music and come back and
   *      the screen would start sleeping again — so we re-request on every
   *      return to visibility while a session is running.
   *   2. It needs a secure context: https, localhost or file. Plain http to a
   *      LAN address is NOT secure and the API is simply absent there. */
  var wakeLock = null;
  var wakeState = navigator.wakeLock ? "idle" : window.isSecureContext ? "unsupported" : "insecure";

  function requestWakeLock() {
    if (!navigator.wakeLock || !state.active) return;
    if (wakeLock && !wakeLock.released) return;
    navigator.wakeLock
      .request("screen")
      .then(function (l) {
        wakeLock = l;
        wakeState = "held";
        l.addEventListener("release", function () {
          if (wakeLock === l) {
            wakeLock = null;
            if (wakeState === "held") wakeState = "idle";
          }
        });
        if (currentTab === "data") render();
      })
      .catch(function (e) {
        wakeState = "failed: " + (e && e.name ? e.name : "unknown");
        if (currentTab === "data") render();
      });
  }

  function releaseWakeLock() {
    wakeState = navigator.wakeLock ? "idle" : wakeState;
    if (wakeLock) {
      wakeLock.release().catch(function () {});
      wakeLock = null;
    }
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") requestWakeLock();
  });

  function wakeLockLabel() {
    if (wakeState === "insecure")
      return [
        "Not available — the page is on plain http.",
        "The screen will sleep. Serve it over https, from localhost, or open the file directly.",
        true,
      ];
    if (wakeState === "unsupported")
      return ["Not supported by this browser.", "The screen will sleep during a session.", true];
    if (wakeState.indexOf("failed") === 0)
      return ["Request was refused (" + wakeState + ").", "The screen may sleep.", true];
    if (wakeState === "held") return ["Active — the screen is being kept awake.", "", false];
    return [
      "Supported, and claimed once a session starts.",
      "It is re-claimed automatically whenever you come back to the page.",
      false,
    ];
  }

  setInterval(guard("running the timer", function () {
    tick();
    var elapsed = document.getElementById("sessionElapsed");
    if (elapsed && state.active) elapsed.textContent = fmtDuration(sessionElapsedSec());

    var h = activeHold();
    if (!h) return;

    var lead = holdLeadLeft(h);
    if (lead > 0) {
      var cd = document.getElementById("holdClock");
      if (cd) cd.textContent = lead;
      if (h.lastLead !== lead) {
        h.lastLead = lead;
        if (lead <= 3) beep(660, 0.12);
      }
      return;
    }
    if (!h.started) {
      h.started = true;
      h.lastLead = 0;
      beep(1320, 0.25);
      say("Go");
      save();
      render(); // swap the countdown out for the running clock
      return;
    }

    var secs = holdElapsed(h);
    var clock = document.getElementById("holdClock");
    if (clock) clock.textContent = secs;

    if (!h.beeped && secs >= h.target) {
      h.beeped = true;
      beep();
      if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
      say(h.target + " seconds");
      save();
      var row = document.getElementById("holdRow");
      if (row) row.classList.add("set-row--hit");
    }

    /* Call the time out as it passes. Hanging from rings you cannot look at the
     * phone, and a hold is the one thing here with no reps to count — without
     * this the only cue between "Go" and the target is silence.
     *
     * Announced on the MARK rather than on an exact match: a background tab
     * throttles this interval, so testing `secs % every === 0` would skip the
     * call whenever a tick was dropped. */
    var every = callEvery();
    if (every) {
      var mark = Math.floor(secs / every) * every;
      if (mark > 0 && mark !== h.lastCall) {
        h.lastCall = mark;
        /* The target has its own, more specific announcement — do not say the
         * same number twice a beat apart. */
        if (mark !== h.target) say(String(mark));
        save();
      }
    }
  }), 1000);

  /* 0 = never call the time out. */
  function callEvery() {
    var n = state.settings.holdCallEvery;
    return typeof n === "number" && n >= 0 ? n : 10;
  }

  function sessionElapsedSec() {
    if (!state.active) return 0;
    return Math.max(0, Math.round((now() - Date.parse(state.active.startedAt)) / 1000));
  }

  /* ================================================================ */
  /* Formatting helpers                                                */
  /* ================================================================ */

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /* YouTube search rather than a specific video id: a search URL never rots,
   * and the query uses the name the movement is commonly known by, which is
   * often not the name this program uses for it. */
  /* An illustration for an exercise if one has been dropped in, otherwise
   * nothing. No manifest to keep in sync: the browser asks for the file and the
   * element removes itself if it is not there, which also means it works the
   * same offline once the service worker has cached it. */
  /* Illustrations bundled from the Gym Visual set, which is redistributed with
   * permission on two conditions: 180x180 only, and the copyright indication
   * must accompany every use. Anything not listed here is either your own photo
   * or absent, so the credit is rendered per-image rather than page-wide. */
  /* Gym Visual media is redistributed with permission on condition the copyright
   * indication accompanies every use. Levels can draw from different sources, so
   * this asks whether THIS PICTURE is theirs rather than whether the exercise is:
   * anything served from the exercises-* forks, plus the handful of their frames
   * saved locally. */
  var GYMVISUAL_LOCAL = ["pushup"];
  function isGymVisual(src, id) {
    if (/exercises-(gifs|dataset)/.test(src)) return true;
    return src.indexOf("images/") === 0 && GYMVISUAL_LOCAL.indexOf(id) >= 0;
  }

  function exerciseImage(id, ex, level) {
    /* Hidden until it actually loads, so a missing file leaves no empty box.
     * Deliberately NOT loading="lazy": a display:none element has no layout box,
     * so the lazy observer never fires and the image would never load at all.
     *
     * Where the pictures come from is PR.imageCandidates' problem — this only
     * turns the list into a fallback chain. */
    var candidates = PR.imageCandidates(id, ex, level, window.IMAGES);
    if (!candidates.length) return ""; // nothing to show, and nothing to ask for
    var src = candidates[0];
    var chain = candidates.slice(1);
    var credit = isGymVisual(src, id)
      ? '<figcaption class="img-credit">© <a href="https://gymvisual.com/" target="_blank" rel="noopener noreferrer">Gym visual</a></figcaption>'
      : "";
    /* crossorigin only for remote images, and only when the page itself is
     * http(s). It exists so the service worker sees a real status instead of an
     * opaque response it cannot cache — but on file:// a CORS request is
     * rejected outright ("CORS request not http"), which killed every local
     * illustration. There is no service worker on file:// anyway, so nothing is
     * lost by dropping it there. */
    var cors =
      /^https?:/i.test(src) && location.protocol.indexOf("http") === 0
        ? ' crossorigin="anonymous"'
        : "";
    return (
      '<figure class="ex-figure"><img class="ex-img" alt=""' + cors +
      ' data-src="' + esc(src) + '" data-fallbacks="' + esc(JSON.stringify(chain)) + '">' +
      credit +
      "</figure>"
    );
  }

  /* The query names the movement, and the equipment you actually chose is
   * prepended — searching "ring pull ups" while you are hanging off a park bar
   * sends you to the wrong video, and the exercise no longer knows which it is. */
  function searchFor(ex, t) {
    if (!ex.search) return "";
    var c = caps();
    var seen = {}, words = [];
    ((t && t.needs) || []).forEach(function (cap) {
      var token = c[cap];
      if (!token || seen[token] || !P.equipment[token]) return;
      seen[token] = 1;
      words.push(P.equipment[token].label);
    });
    return (words.join(" ") + " " + ex.search).trim();
  }

  function videoLink(ex, label, t) {
    var q = searchFor(ex, t);
    if (!q) return "";
    return (
      '<a class="vid-btn" target="_blank" rel="noopener noreferrer" href="https://www.youtube.com/results?search_query=' +
      encodeURIComponent(q) +
      '">▶ ' +
      (label || "Show me how") +
      ' <span class="vid-q">' +
      esc(q) +
      "</span></a>"
    );
  }

  /* Abbreviated for the header, where a long list wraps the sticky bar onto a
   * second line and costs real screen height on a phone. */
  var KIT_SHORT = {
    "push-up bars": "bars",
    "sofa chair 20 cm": "sofa 20",
    "chair 45 cm": "chair 45",
    "parallel bars": "dip bars",
  };

  /* What this exercise needs AT THE LEVEL YOU ARE ON — push-ups start on the
   * bars and end up in the rings, so a fixed per-exercise list would be wrong
   * most of the time. The level's own kit is already resolved into the target. */
  /* `except` drops capabilities the card has already asked about above: with a
   * HANG FROM row offering rings or a bar right there, repeating "rings" in the
   * summary chips underneath says the same thing twice. */
  function kitFor(t, short, except) {
    var needs = (t.needs || []).filter(function (cap) {
      return !except || except.indexOf(cap) < 0;
    });
    var chips = PR.kitFor(needs, caps(), P.equipment);
    if (short) {
      chips = chips.map(function (c) {
        return KIT_SHORT[c] || c;
      });
    }
    if (t.vest) chips.push("vest " + trimNum(t.vest) + (short ? "kg" : " kg"));
    return chips;
  }

  /* Deduped kit for a whole workout at its current levels — what to fetch
   * before you start. Recomputed every render, so it follows the ladders. */
  function sessionKit(key, short) {
    var phase = currentPhase();
    var seen = {}, out = [];
    workoutItems(key).forEach(function (o) {
      var ex = P.exercises[o.id];
      kitFor(PR.target(ex, exState(o.id), phase, trimmedEntry(o, key)), short).forEach(function (k) {
        if (!seen[k]) {
          seen[k] = 1;
          out.push(k);
        }
      });
    });
    return out;
  }

  function unit(m) {
    return (m && m.metric ? m.metric : m) === "seconds" ? "s" : "reps";
  }

  function fmtLoad(kg) {
    return kg ? "+" + trimNum(kg) + " kg" : "bodyweight";
  }

  function trimNum(n) {
    return String(Math.round(n * 10) / 10);
  }

  function fmtDuration(sec) {
    var m = Math.floor(sec / 60);
    return m + ":" + String(sec % 60).padStart(2, "0");
  }

  function fmtDate(iso) {
    var d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  }

  function daysAgo(iso) {
    var d = Date.parse(iso + "T00:00:00");
    if (isNaN(d)) return "";
    var n = Math.round((Date.parse(todayISO() + "T00:00:00") - d) / 86400000);
    if (n === 0) return "today";
    if (n === 1) return "yesterday";
    return n + " days ago";
  }

  /* ================================================================ */
  /* Render — Today                                                    */
  /* ================================================================ */

  function renderToday() {
    var key = nextWorkoutKey();
    var w = P.workouts[key];
    var phase = currentPhase();
    var active = !!state.active;
    var b = planFor(key);
    var html = "";

    if (migrationNotes.length) {
      html +=
        '<div class="panel pad summary-panel" id="migrationPanel"><h2>Targets adjusted</h2>' +
        '<p class="muted">Rep ranges are now set per level, and these were below the range of the level they sit on:</p><ul class="changes">' +
        migrationNotes
          .map(function (n) {
            return '<li class="ev ev-reps">' + esc(n) + "</li>";
          })
          .join("") +
        '</ul><button class="btn btn-ghost btn-sm" data-act="dismiss-migration">Dismiss</button></div>';
    }

    if (lastSummary && now() - lastSummary.at < 1000 * 60 * 60) {
      html += renderSummary(lastSummary.results);
    }

    html +=
      '<div class="panel session-overview"><div class="pad session-head" id="sessionHead">' +
      '<div class="sh-left">' +
      '<div class="sh-kicker">' +
      (active ? "In progress" : "Up next") +
      " · session " +
      (state.sessions.length + 1) +
      "</div>" +
      "<h2>Workout " +
      key +
      ' <span class="muted">· ' +
      esc(w.name) +
      "</span></h2>" +
      (active
        ? ""
        : '<div class="pick">' +
          ["A", "B"]
            .map(function (w) {
              return (
                '<button class="pick-btn' +
                (key === w ? " pick-btn--on" : "") +
                '" data-act="pick-workout" data-w="' +
                w +
                '" aria-pressed="' +
                (key === w ? "true" : "false") +
                '">' +
                w +
                "</button>"
              );
            })
            .join("") +
          "</div>") +
      '<div class="sh-meta">RPE ' +
      esc(phase.rpe) +
      " · " +
      esc(phase.rir) +
      " · ~" +
      Math.round(b.seconds / 60) +
      " min</div>" +
      pacingLine() +
      "</div>" +
      '<div class="sh-right">' +
      (active
        ? '<div class="elapsed" id="sessionElapsed">' +
          fmtDuration(sessionElapsedSec()) +
          "</div>" +
          '<button class="btn btn-primary" data-act="finish">Finish</button>' +
          '<button class="btn btn-ghost btn-sm" data-act="abandon">Discard</button>'
        : '<button class="btn btn-primary btn-lg" data-act="start">Start</button>') +
      "</div>" +
      "</div>";

    html += '<div class="session-setup" role="group" aria-label="Session setup">';

    /* Where you are decides what the session can contain, so it sits with the
     * other two things you choose before starting rather than in Settings. */
    {
      var here = matchingPlace();
      html += '<div class="cap-row" id="placeRow"><span class="cap-label">Where</span>';
      Object.keys(P.places).forEach(function (pid) {
        html +=
          '<button class="chip cap' +
          (here === pid ? " cap--on" : "") +
          '" data-act="set-place" data-place="' +
          pid +
          '" aria-pressed="' +
          (here === pid ? "true" : "false") +
          '">' +
          esc(P.places[pid].label) +
          "</button>";
      });
      /* Ticks that match no preset are a real answer, not a broken state —
       * shown so the row never reads as "nowhere". */
      if (!here) html += '<span class="cap cap--on chip is-static">Custom</span>';
      html += "</div>";

      /* Always visible, never a separate mode. A preset is a shortcut that
       * fills this list; the list is what actually decides the session, so
       * hiding it behind a mode meant the one screen that answers "why is
       * this exercise missing?" was the one you could not see. */
      var have = currentKit();
      html += '<div class="kit-pick" id="kitPick"><span class="cap-label">Equipment</span>';
      Object.keys(P.equipment).forEach(function (token) {
        html +=
          '<button class="chip kit-tick' +
          (have.indexOf(token) >= 0 ? " kit-tick--on" : "") +
          '" data-act="toggle-kit" data-kit="' +
          token +
          '" aria-pressed="' +
          (have.indexOf(token) >= 0 ? "true" : "false") +
          '">' +
          esc(P.equipment[token].label) +
          "</button>";
      });
      html += "</div>";
      if (!have.length) {
        html +=
          '<p class="hint" id="kitEmpty">Nothing ticked, so you get what needs no equipment at ' +
          "all. Tick whatever is in the room.</p>";
      }

      /* Reported as PATTERNS, not exercises. Losing push-ups because there are
       * no bars is not a loss — a push-up on the floor trains the same thing.
       * Losing anti-extension because everything that trains it needs rings
       * is. Only the second is worth telling you about. */
      var gaps = PR.gapsAt(P.workouts[key].order, P.exercises, caps());
      if (gaps.length) {
        html +=
          '<p class="hint cap-note warn" id="placeNote">Nothing here trains <strong>' +
          gaps
            .map(function (p) {
              return esc(patternLabel(p));
            })
            .join("</strong> or <strong>") +
          "</strong>. Everything else is covered, at whatever level this place supports.</p>";
      }
    }

    html += '<div class="cap-row" id="capRow"><span class="cap-label">Time today</span>';
    CAPS.forEach(function (c) {
      html +=
        '<button class="chip cap' +
        (state.settings.sessionCapMin === c ? " cap--on" : "") +
        '" data-act="set-cap" data-cap="' +
        c +
        '" aria-pressed="' +
        (state.settings.sessionCapMin === c ? "true" : "false") +
        '">' +
        (c ? c + " min" : "Full") +
        "</button>";
    });
    html += "</div>";

    if (b.trimmed.length) {
      html +=
        '<p class="hint cap-note" id="capNote">Trimmed to fit ' +
        state.settings.sessionCapMin +
        " min (full session is ~" +
        Math.round(b.full / 60) +
        "): " +
        b.trimmed
          .map(function (t) {
            return esc(P.exercises[t.id].name) + " " + t.from + "→" + t.to;
          })
          .join(", ") +
        ".</p>";
    } else if (state.settings.sessionCapMin && b.overBudget) {
      html +=
        '<p class="hint cap-note warn" id="capNote">Everything is already at its minimum — ~' +
        Math.round(b.seconds / 60) +
        " min is as short as this session goes without dropping an exercise.</p>";
    }

    if (!active) {
      html +=
        '<p class="hint" id="startHint">Tap <strong>Start</strong>, or just log a set — the session starts either way. ' +
        "Close the tab mid-workout and it picks up where you left off.</p>";
    }

    html += "</div></div>";

    var groups = sessionPlan(key);
    var here = currentPosition();
    var workStarted = false;

    /* Four consecutive cards all tagged "superset" read as one four-way group.
     * Label the pairs A1/A2, B1/B2 instead — standard programming notation, and
     * it names the partner in the tooltip. */
    var pairLetter = {}, pairSeen = {}, pairMembers = {};
    groups.forEach(function (g) {
      g.items.forEach(function (it) {
        var k = it.ex.superset;
        if (!k) return;
        if (!pairLetter[k]) {
          pairLetter[k] = String.fromCharCode(65 + Object.keys(pairLetter).length);
          pairMembers[k] = [];
        }
        pairMembers[k].push(it.ex.name);
      });
    });
    function pairInfo(ex) {
      var k = ex.superset;
      if (!k || !pairLetter[k]) return null;
      pairSeen[k] = (pairSeen[k] || 0) + 1;
      var others = pairMembers[k].filter(function (n) { return n !== ex.name; });
      return { first: pairSeen[k] === 1, partners: others.join(", ") };
    }
    groups.forEach(function (g, gi) {
      html +=
        '<div class="station' +
        (g.station.adjust ? " station--adjust" : "") +
        '" id="st-' +
        g.key +
        '">' +
        '<div class="station-head">' +
        '<span class="st-icon">' +
        g.station.icon +
        "</span>" +
        '<div class="st-text"><div class="st-label">' +
        esc(stationLabel(g.key)) +
        '<span class="st-count">' +
        (gi + 1) +
        " / " +
        groups.length +
        "</span></div>" +
        /* The setup text exists because the rings have to be re-rigged. Where
         * nothing is adjustable there is nothing to set up, and telling you to
         * hang rings you have not got is worse than saying nothing. */
        (adjustableHere() ? '<div class="st-setup">' + esc(g.station.setup) + "</div>" : "") +
        "</div>" +
        "</div>";
      var opened = false;
      g.items.forEach(function (it, ii) {
        /* Bookend the prep block: without an opening marker you can tell where
         * the warm-up ends but not that it started. */
        if (!workStarted && !opened) {
          opened = true;
          if (gi === 0) html += '<div class="work-start work-start--warm"><span>Warm-up</span></div>';
        }
        if (!workStarted && PR.groupOf(it.ex.pattern) !== "prehab") {
          workStarted = true;
          html += '<div class="work-start"><span>Working sets</span></div>';
        }
        /* "Prep" is a position, not a purpose. Face pulls are prehab by intent
         * but they are real working sets in the middle of the session, so only
         * what comes before the divider is marked. */
        html += renderExerciseCard(it, !workStarted, pairInfo(it.ex), here);

        /* What separates this exercise from the next: nothing at all if the
         * next one is its superset partner, otherwise a rest of this
         * exercise's own interval. Rest used to be invisible until after a set
         * was logged, so there was no way to see how long it should be. */
        var following = g.items[ii + 1];
        var lastOfSession = gi === groups.length - 1 && ii === g.items.length - 1;
        var pairedWithNext =
          following && it.ex.superset && following.ex.superset === it.ex.superset;
        if (pairedWithNext) {
          html +=
            '<div class="flow flow--go"><span>⇄ straight into ' +
            esc(following.ex.name) +
            " — no rest</span></div>";
        } else if (!lastOfSession && workStarted) {
          /* No rest cards inside the warm-up — you flow straight through it. */
          var liveHere = following && restingBefore(following.id, 0);
          html += liveHere
            ? '<div class="flow flow--rest flow--live"><span id="restInline">' +
              restClock(restLeft()) +
              "</span><small>resting · " +
              esc(following.ex.name) +
              ' next</small><button class="btn btn-ghost btn-sm" data-act="rest-skip">Skip</button></div>'
            : '<button type="button" class="flow flow--rest" data-act="rest-now" data-rest="' +
              restFor(it.id, key) +
              '" data-restname="' +
              esc(it.ex.name) +
              (following ? '" data-nextid="' + following.id + '" data-nextset="0' : "") +
              '"><span>⏱ Rest ' +
              restFor(it.id, key) +
              " s</span><small>before " +
              (following ? esc(following.ex.name) : "the next exercise") +
              "</small></button>";
        }
      });
      html += "</div>";
    });

    html +=
      '<div class="panel pad note-panel" id="notePanel">' +
      '<label class="field-label" for="sessionNote">Session note — joints, sleep, how it felt</label>' +
      '<textarea id="sessionNote" rows="2" placeholder="Left shoulder fine today. Slept 6h.">' +
      esc(state.active ? state.active.note : "") +
      "</textarea>" +
      "</div>";

    if (active) {
      html +=
        '<div class="finish-row" id="finishRow"><button class="btn btn-primary btn-lg" data-act="finish">Finish session &amp; update targets</button></div>';
    }

    return html;
  }

  /* "Am I going to finish?" — answerable only once a session is running, and
   * only worth saying once there is enough behind you to mean anything. */
  function pacingLine() {
    var p = pacing();
    if (!p) return "";
    if (p.done) return '<div class="pace pace--done">Everything is logged. Hit Finish.</div>';
    if (p.behind < 120) return ""; // too early to say anything honest
    var cap = state.settings.sessionCapMin || 0;
    var over = cap && p.total > cap * 60;
    var end = new Date(now() + p.remaining * 1000);
    var clock =
      String(end.getHours()).padStart(2, "0") + ":" + String(end.getMinutes()).padStart(2, "0");
    return (
      '<div class="pace' +
      (over ? " pace--over" : "") +
      '" id="pacing">~' +
      Math.round(p.remaining / 60) +
      " min left · finishing about " +
      clock +
      (p.pace >= 1.15
        ? " · running " + Math.round((p.pace - 1) * 100) + "% slow"
        : p.pace <= 0.85
        ? " · " + Math.round((1 - p.pace) * 100) + "% ahead"
        : "") +
      (over
        ? '<small>Over your ' +
          cap +
          " min. Cut a set or two now, while there is still something to cut.</small>"
        : "") +
      "</div>"
    );
  }

  /* The minus button turns into a remove button on a hand-added set that is
   * already at its floor, so the next tap visibly takes the set away. */
  function removeOrMinus(set, value, step, id, sets) {
    var atFloor = !set.done && value <= step;
    var willRemove = atFloor && set.extra;
    var willSkip = atFloor && !set.extra && canSkip(id, sets);
    return (
      '<button class="step' +
      (willRemove || willSkip ? " step--remove" : "") +
      '" data-act="rep-dec" aria-label="' +
      (willRemove ? "Remove this extra set" : willSkip ? "Skip this set" : "Decrease target") +
      '" title="' +
      (willRemove ? "Remove this extra set" : willSkip ? "Skip this set" : "Less") +
      '">' +
      (willRemove || willSkip ? "✕" : "−") +
      "</button>"
    );
  }

  /* Station names describe a ring height, which is a lie anywhere without
   * rings. The grouping still holds — it is the order you do things in. */
  function stationLabel(stKey) {
    var st = P.stations[stKey];
    return (!adjustableHere() && st.plain) || st.label;
  }

  /* Does anything here get rigged, or is it all fixed in the ground? */
  function adjustableHere() {
    var c = caps();
    return !!(c["hang-high-adjustable"] || c["dip-support-adjustable"]);
  }

  /* What this place is missing for a level you cannot reach here. */
  function missingFor(ex, level) {
    var c = caps();
    var want = PR.rung(ex, level).needs.filter(function (cap) {
      return !c[cap];
    });
    return want
      .map(function (cap) {
        /* Name it as the thing you would need, not as the capability. */
        var provider = Object.keys(P.equipment).filter(function (t) {
          return P.equipment[t].provides.indexOf(cap) >= 0;
        })[0];
        return (P.equipment[provider] && P.equipment[provider].label) || cap;
      })
      .join(" or ");
  }

  /* The session item a card belongs to, by the id on the card. */
  function itemFor(id) {
    return workoutItems(nextWorkoutKey()).filter(function (i) {
      return i.id === id;
    })[0];
  }

  /* The other exercises that would train this slot's pattern here.
   *
   * Offered against the SLOT's exercise, not the one currently showing: once
   * you have swapped, the list has to keep including what you swapped away
   * from, or the choice would be one-way. */
  function variantsFor(it) {
    var slot = it.slot || it.id;
    var ex = P.exercises[slot];
    if (!ex) return [];
    /* Everything the program schedules SOMEWHERE, minus this slot's own
     * exercise. Those are the week's deliberate choices, not spare parts. */
    var taken = {};
    Object.keys(P.workouts).forEach(function (k) {
      P.workouts[k].order.forEach(function (o) {
        if (o.id !== slot) taken[o.id] = true;
      });
    });
    return PR.alternativesFor(ex, P.exercises, caps(), taken);
  }

  /* Sets already logged this session pin the level: finishSession records the
   * level at finish time, so moving it after logging would file those sets
   * under a rung they were not done at. */
  function levelPinned(id) {
    var e = state.active && state.active.entries[id];
    return !!(e && e.sets.some(function (st) { return st.done; }));
  }

  /* The ladder, with anything a rung changes about the prescription shown ON
   * the rung. A level that is per-side, or that carries its own rep range, is a
   * materially different exercise — leaving that invisible until you reach it
   * is how "10-15 reps" ended up printed against a pistol squat. */
  function ladderHtml(ex, current) {
    var h = '<div class="ladder">';
    ex.ladder.forEach(function (l, i) {
      var r = PR.rung(ex, i);
      var tags = "";
      if (r.minPhase) tags += '<span class="rung-tag">Phase ' + r.minPhase + "</span>";
      if (r.perSide) tags += '<span class="rung-tag">per side</span>';
      if (r.own.cues) tags += '<span class="rung-tag">own cues</span>';
      if (r.own.range) {
        tags += '<span class="rung-tag">' + r.range[0] + "-" + r.range[1] + " " + unit(r) + "</span>";
      }
      h +=
        '<div class="rung' +
        (current === i ? " rung--now" : "") +
        (typeof current === "number" && i < current ? " rung--done" : "") +
        '">' +
        '<span class="rung-n">' +
        (i + 1) +
        "</span>" +
        esc(r.name) +
        (r.note ? ' <span class="muted">— ' + esc(r.note) + "</span>" : "") +
        tags +
        "</div>";
    });
    return h + "</div>";
  }

  /* The wait before set `next` of this exercise, as a step in the sequence.
   *
   * Rest is most of a session — 150 s between sets of pull-ups against 18 s of
   * actual pulling — and it used to exist only as a bar at the bottom of the
   * screen once a set had been logged. That made it impossible to see what was
   * coming, and impossible to see where in the session you were waiting. */
  function restStep(it, next, pair) {
    var live = restingBefore(it.id, next);
    var seconds = restFor(it.id);
    /* For a superset the wait comes AFTER the partner, not straight after this
     * set — saying "rest 90 s" here would have you standing still through the
     * half of the round you are supposed to be doing. */
    var what = pair
      ? "⇄ " + esc(pair.partners) + ", then rest " + seconds + " s"
      : "⏱ Rest " + seconds + " s";
    if (live) {
      return (
        '<div class="rest-step rest-step--live">' +
        '<span class="rs-clock" id="restInline">' +
        restClock(restLeft()) +
        "</span>" +
        '<span class="rs-what">resting · set ' +
        (next + 1) +
        " next</span>" +
        '<button class="btn btn-ghost btn-sm" data-act="rest-skip">Skip</button>' +
        "</div>"
      );
    }
    return (
      '<button type="button" class="rest-step" data-act="rest-now" data-rest="' +
      seconds +
      '" data-restname="' +
      esc(it.ex.name) +
      '" data-nextid="' +
      it.id +
      '" data-nextset="' +
      next +
      '"><span class="rs-what">' +
      what +
      "</span></button>"
    );
  }

  function renderExerciseCard(it, isPrep, pair, here) {
    var isNow = !!(here && here.id === it.id);
    var ex = it.ex;
    var t = it.target;
    var u = unit(t);
    var canVest = PR.usesVest(ex);
    /* Before the session is started there is no stored entry yet, so render a
     * throwaway one at the prescribed numbers. The buttons still work — the
     * first tap calls autoStart() and the real entry is created underneath. */
    var entry =
      (state.active && state.active.entries[it.id]) ||
      { vest: null, sets: Array.apply(null, Array(t.sets)).map(plannedSet) };
    var vest = entryVest(it.id, t);

    var doing = liveSets(it.id, t.sets);
    var allSkipped = doing === 0;

    var h =
      '<div class="ex-card' +
      (ex.warn ? " ex-card--warn" : "") +
      (isPrep ? " ex-card--prep" : "") +
      (isNow ? " ex-card--now" : "") +
      (allSkipped ? " ex-card--off" : "") +
      '" data-ex="' + it.id + '">';

    h +=
      '<div class="ex-head">' +
      '<div class="ex-name">' +
      (isNow ? '<span class="tag tag-now">now</span> ' : "") +
      esc(ex.name) +
      (isPrep ? ' <span class="tag tag-prep">prep</span>' : "") +
      /* The card is a SLOT, and the exercise is one way to fill it. Without
       * this the name is all you see, and the name reads as the point — which
       * it is not: "chin-ups" is what you are doing, "lats, biceps" is why. */
      (P.trains[ex.pattern]
        ? ' <span class="ex-trains">' + esc(P.trains[ex.pattern]) + "</span>"
        : "") +
      (pair ? ' <span class="tag tag-ss">⇄ ' + esc(pair.partners) + "</span>" : "") +
      (t.offset ? ' <span class="tag tag-off">one level harder</span>' : "") +
      (it.entry && it.entry.standsInFor
        ? ' <span class="tag tag-sub">for ' + esc(P.exercises[it.entry.standsInFor].name) + "</span>"
        : "") +
      "</div>" +
      '<button class="skip-btn" data-act="skip-exercise" title="' +
      (allSkipped ? "Put this exercise back" : "Not doing this exercise today") +
      '" aria-label="' +
      (allSkipped ? "Put this exercise back" : "Skip this exercise") +
      '">' +
      (allSkipped ? "↺" : "⊘") +
      "</button>" +
      '<button class="info-btn" data-act="toggle-info" aria-label="' +
      (expandedInfo[it.id] ? "Hide details for " : "Show details for ") +
      esc(ex.name) +
      '" aria-expanded="' +
      (expandedInfo[it.id] ? "true" : "false") +
      '" aria-controls="info-' + it.id + '">ⓘ</button>' +
      "</div>";

    h +=
      '<div class="ex-target">' +
      "<b>" +
      doing +
      " × " +
      t.value +
      " " +
      u +
      (t.perSide ? " per side" : "") +
      "</b>" +
      (canVest ? '<span class="dot">·</span><span>' + fmtLoad(vest) + "</span>" : "") +
      (t.atTopOfRange ? '<span class="tag tag-top">top of range</span>' : "") +
      (doing < t.sets
        ? '<span class="tag tag-cut">' + (t.sets - doing) + " cut</span>"
        : "") +
      "</div>";

    /* A one-level ladder has no variation to report and no progress to show. */
    if (ex.ladder.length > 1) {
      h +=
        '<div class="ex-level"><span class="lvl-badge">Level ' +
        (t.level + 1) +
        "/" +
        ex.ladder.length +
        "</span>" +
        esc(t.levelName) +
        "</div>";
    }
    /* The amber stripe down the card means nothing on its own — say why. */
    if (ex.caution) h += '<div class="ex-caution">⚠ ' + esc(ex.caution) + "</div>";
    if (t.movedFrom !== null && t.movedFrom !== undefined) {
      var down = t.level < t.movedFrom;
      h +=
        '<div class="ex-levelnote warn">' +
        (down ? "Down to" : "Up to") +
        " level " +
        (t.level + 1) +
        " here — no " +
        esc(missingFor(ex, t.movedFrom)) +
        (down ? "" : " for level " + (t.movedFrom + 1)) +
        /* "at home" was true while places were modes. There is only a kit
         * now, and the stored level is not attached to any of them. */
        ". Your level is " +
        (t.movedFrom + 1) +
        ".</div>";
    }
    /* A ladder that appears to stop is worse than one that says why. */
    if (t.nextGate) {
      h +=
        '<div class="ex-levelnote">Next up — <strong>' +
        esc(t.nextGate.name) +
        "</strong> — opens in Phase " +
        t.nextGate.phase +
        ". Earn it before then and it is banked.</div>";
    }

    /* Which of the things you ticked to use, where more than one would do.
     * With rings and a bar both to hand a chin-up can be done on either, and
     * declaration order was quietly answering "rings" every time. */
    gearChoices(t).forEach(function (g) {
      h += '<div class="gear-row" id="gear-' + it.id + "-" + g.cap + '">';
      h += '<span class="gear-label">' + esc(P.capLabels[g.cap] || g.cap) + "</span>";
      g.options.forEach(function (token) {
        var on = caps()[g.cap] === token;
        h +=
          '<button class="chip gear' +
          (on ? " gear--on" : "") +
          '" data-act="pick-gear" data-cap="' +
          g.cap +
          '" data-gear="' +
          token +
          '" aria-pressed="' +
          (on ? "true" : "false") +
          '">' +
          esc(P.equipment[token].label) +
          "</button>";
      });
      h += "</div>";
    });

    /* Which exercise trains this pattern today. Shown only where there is an
     * actual choice, and only until a set is logged — the same pin as the level
     * stepper, and for the same reason: swapping after logging would file those
     * sets against an exercise they were not done on. */
    var variants = variantsFor(it);
    if (variants.length > 1) {
      var locked = levelPinned(it.id);
      h += '<div class="swap-row" id="swap-' + (it.slot || it.id) + '">';
      variants.forEach(function (vid) {
        h +=
          '<button class="chip swap' +
          (vid === it.id ? " swap--on" : "") +
          (locked ? " is-static" : "") +
          '" data-act="pick-variant" data-variant="' +
          vid +
          '"' +
          ' aria-pressed="' +
          (vid === it.id ? "true" : "false") +
          '"' +
          (locked ? " disabled" : "") +
          ">" +
          esc(P.exercises[vid].name) +
          "</button>";
      });
      h += "</div>";
      /* Keyed, because it APPEARS mid-card once you log. Without an id the
       * patcher matches by position and rebuilds every node below it, which
       * detaches the very set rows the tap handler is holding. */
      if (locked)
        h +=
          '<div class="ex-levelnote" id="swaplock-' + (it.slot || it.id) +
          '">Swap before you log a set — these are already done.</div>';
    }

    var asked = gearChoices(t).map(function (g) { return g.cap; });
    var kit = kitFor(t, false, asked);
    /* "no equipment" means the exercise needs none — NOT that everything it
     * needs was already asked about above. Reading the filtered list alone said
     * a hanging leg raise needed nothing, one line under a row offering a
     * choice of two things to hang from. */
    var bare = !(t.needs || []).length && !t.vest;
    h +=
      '<div class="ex-kit">' +
      (kit.length
        ? kit
            .map(function (k) {
              return '<span class="kit">' + esc(k) + "</span>";
            })
            .join("")
        : bare
          ? '<span class="kit kit--none">no equipment</span>'
          : "") +
      '<span class="kit kit--rest">rest ' + restFor(it.id) + " s</span>" +
      "</div>";
    if (t.vestSuppressed)
      h +=
        '<div class="ex-levelnote warn">Vest held at 0 during ' +
        esc(currentPhase().name) +
        ".</div>";

    if (canVest && currentPhase().allowLoadProgress) {
      h +=
        '<div class="vest-row">' +
        '<span class="vest-label">Vest</span>' +
        '<button class="step" data-act="vest-dec" aria-label="Decrease vest load">−</button>' +
        '<span class="vest-val">' +
        trimNum(vest) +
        " kg</span>" +
        '<button class="step" data-act="vest-inc" aria-label="Increase vest load">+</button>' +
        '<span class="vest-hint">applies to sets not yet logged — drop it between sets for descending sets</span>' +
        "</div>";
    }

    h += '<div class="sets">';
    var held = activeHold() && activeHold().id === it.id ? activeHold() : null;
    var turn = nextLoggable(entry);
    entry.sets.forEach(function (s, i) {
      /* Anything the user has not overridden is read from the plan here, so a
       * cap or phase change updates the sets still ahead of them. */
      var myTurn = i === turn;
      var sVal = setValue(s, t);
      var sLoad = setLoad(s, it.id, t);
      var isHeld = held && held.set === i;
      h +=
        '<div class="set-row' +
        (s.done ? " set-row--done" : "") +
        (isSkipped(s) ? " set-row--skipped" : "") +
        (!s.done && !isSkipped(s) && !myTurn ? " set-row--waiting" : "") +
        (isHeld ? " set-row--holding" : "") +
        (isNow && here.set === i && !s.done ? " set-row--next" : "") +
        (s.extra && !s.done ? " set-row--extra" : "") +
        '" data-set="' +
        i +
        '"' +
        (isHeld ? ' id="holdRow"' : "") +
        ">" +
        '<span class="set-n">' +
        (i + 1) +
        "</span>";
      if (isSkipped(s)) {
        h +=
          '<span class="set-skipped">not doing this one</span>' +
          '<button class="step" data-act="rep-inc" aria-label="Put this set back" title="Put this set back">+</button>';
      } else if (s.done) {
        h +=
          '<span class="set-done">' +
          sVal +
          " " +
          u +
          (canVest && sLoad ? " · " + fmtLoad(sLoad) : "") +
          "</span>" +
          '<button class="btn btn-ghost btn-sm" data-act="undo-set">undo</button>';
      } else if (t.metric === "seconds" && held && held.set === i) {
        var lead = holdLeadLeft(held);
        h += lead
          ? '<span class="set-val set-val--lead"><b id="holdClock">' +
            lead +
            "</b><small>get ready</small></span>" +
            '<button class="btn btn-stop" data-act="stop-hold">Cancel</button>'
          : '<span class="set-val set-val--hold"><b id="holdClock">' +
            holdElapsed(held) +
            "</b><small>/" +
            held.target +
            " s</small></span>" +
            '<button class="btn btn-stop" data-act="stop-hold">Stop</button>';
      } else if (t.metric === "seconds") {
        /* Two ways to finish a hold: run the clock, or write down what you did.
         * Without the second one a mistimed hold could never be corrected —
         * undo put the row back but Start was the only way out of it, and that
         * means re-hanging for thirty seconds to fix a typo. */
        h +=
          removeOrMinus(s, sVal, t.step, it.id, t.sets) +
          '<span class="set-val">' +
          sVal +
          "<small>" +
          u +
          "</small></span>" +
          '<button class="step" data-act="rep-inc" aria-label="Increase target">+</button>' +
          '<button class="btn btn-start' +
          (myTurn ? "" : " btn--waiting") +
          '" data-act="start-hold"' +
          (myTurn ? "" : " disabled") +
          ">Start</button>" +
          '<button class="btn btn-done' +
          (myTurn ? "" : " btn--waiting") +
          '" data-act="log-set" title="Log ' +
          sVal +
          ' s without running the clock"' +
          (myTurn ? "" : " disabled") +
          ' aria-label="Log set">✓</button>';
      } else {
        h +=
          removeOrMinus(s, sVal, t.step, it.id, t.sets) +
          '<span class="set-val">' +
          sVal +
          "<small>" +
          u +
          "</small></span>" +
          '<button class="step" data-act="rep-inc" aria-label="Increase target">+</button>' +
          '<button class="btn btn-done' +
          (myTurn ? "" : " btn--waiting") +
          '" data-act="log-set"' +
          (myTurn ? "" : " disabled") +
          ' aria-label="Log set">✓</button>';
      }
      h += "</div>";

      /* Every wait is a step you can see — but only between two sets that are
       * both still happening. The rest AFTER the last set is the one drawn
       * between the cards, so it is not repeated here. */
      if (!isSkipped(s)) {
        for (var nx = i + 1; nx < entry.sets.length; nx++) {
          if (isSkipped(entry.sets[nx])) continue;
          h += restStep(it, nx, pair);
          break;
        }
      }
    });
    h +=
      '<button class="linkbtn addset" data-act="add-set">+ extra set</button>' +
      "</div>";

    h += '<div class="ex-info" id="info-' + it.id + '"' + (expandedInfo[it.id] ? "" : " hidden") + ">";
    if (expandedInfo[it.id]) h += exerciseImage(it.id, ex, t.level);
    h += videoLink(ex, null, t);
    if (t.levelNote) h += '<p class="why"><strong>This level:</strong> ' + esc(t.levelNote) + "</p>";
    if (pair)
      h +=
        '<p class="why"><strong>Superset:</strong> alternate sets with ' +
        esc(pair.partners) +
        " — one rest covers both.</p>";
    /* The level's cues, not the exercise's — a pistol squat and a bodyweight
     * squat share this ladder and nothing else, so "front shin roughly
     * vertical" is the wrong instruction for one of them. */
    h += "<p class=\"why\"><strong>Form</strong></p><ul>";
    t.cues.forEach(function (c) {
      h += "<li>" + esc(c) + "</li>";
    });
    h += "</ul>";
    h += '<p class="why"><strong>Why:</strong> ' + esc(ex.why) + "</p>";
    if (ex.note) h += '<p class="why note">' + esc(ex.note) + "</p>";
    /* The app's idea of where you are can be wrong — a ladder gets rewritten, or
     * you come back from a break, or it simply started you in the wrong place.
     * Until this existed the only remedies were resetting all sixteen exercises
     * or editing the exported JSON by hand. */
    if (ex.ladder.length > 1) {
      var pinned = levelPinned(it.id);
      h +=
        '<div class="lvl-set">' +
        '<span class="lvl-set-label">Your level</span>' +
        '<button class="step" data-act="level-dec"' +
        (pinned || t.level === 0 ? " disabled" : "") +
        ' aria-label="One level easier">−</button>' +
        '<span class="lvl-set-val">' +
        (t.level + 1) +
        " / " +
        ex.ladder.length +
        "</span>" +
        '<button class="step" data-act="level-inc"' +
        (pinned || t.level === ex.ladder.length - 1 ? " disabled" : "") +
        ' aria-label="One level harder">+</button>' +
        '<span class="lvl-set-hint">' +
        (pinned
          ? "locked — sets already logged today"
          : "move it if the app has you in the wrong place; the reps reset to that level\u2019s range") +
        "</span>" +
        "</div>";
    }
    h += ladderHtml(ex, t.level);
    h +=
      '<p class="why muted">Rest ' +
      restFor(it.id) +
      "s between sets. Range " +
      t.range[0] +
      "-" +
      t.range[1] +
      " " +
      u +
      " at this level.</p>";
    h += "</div>";

    h += "</div>";
    return h;
  }

  function renderSummary(results) {
    if (!results || !results.length) return "";
    var h = '<div class="panel pad summary-panel" id="summaryPanel"><h2>Session logged ✓</h2><p class="muted">Here is what changed for next time.</p><ul class="changes">';
    results.forEach(function (r) {
      r.events.forEach(function (ev) {
        h +=
          '<li class="ev ev-' +
          ev.type +
          '"><strong>' +
          esc(r.name) +
          "</strong> " +
          esc(ev.text) +
          "</li>";
      });
    });
    h += '</ul><button class="btn btn-ghost btn-sm" data-act="dismiss-summary">Dismiss</button></div>';
    return h;
  }

  /* ================================================================ */
  /* Render — History                                                  */
  /* ================================================================ */

  function renderHistory() {
    var phase = currentPhase();
    var gap = currentGap();
    var h = "";

    h += '<div class="panel pad">';
    h += "<h2>Where you are</h2>";
    h +=
      '<div class="stats">' +
      stat("Sessions", state.sessions.length) +
      stat("Phase", phase.id + " · " + phase.name) +
      stat(
        "Weeks in",
        state.sessions.length
          ? Math.floor(PR.weeksBetween(state.sessions[0].date, todayISO())) + 1
          : 0
      ) +
      stat("Last session", state.sessions.length ? daysAgo(state.sessions[state.sessions.length - 1].date) : "—") +
      "</div>";
    if (gap) {
      var bits = [];
      if (gap.sessionsShort) bits.push(gap.sessionsShort + " more session" + (gap.sessionsShort > 1 ? "s" : ""));
      if (gap.weeksShort >= 0.05) bits.push(gap.weeksShort.toFixed(1) + " more weeks");
      h +=
        '<p class="muted gap-note">Phase ' +
        gap.phase.id +
        " (" +
        esc(gap.phase.name) +
        ") unlocks after " +
        (bits.length ? bits.join(" and ") : "the next session") +
        ".</p>";
    }
    h += "</div>";

    h += renderCoverage();

    h += '<div class="panel pad"><h2>Current standing</h2><div class="table-scroll" tabindex="0" role="region" aria-label="Current progression table"><table class="standing">';
    h +=
      "<thead><tr><th>Exercise</th><th>Level</th><th class=\"num\">Target</th><th class=\"num\">Load</th><th class=\"num\">Streak</th></tr></thead><tbody>";
    Object.keys(P.exercises).forEach(function (id) {
      var ex = P.exercises[id];
      if (ex.progression === "fixed") return;
      var st = exState(id);
      var t = PR.target(ex, st, phase, null);
      h +=
        "<tr><td>" +
        esc(ex.name) +
        '</td><td class="lvl">' +
        (st.level + 1) +
        "/" +
        ex.ladder.length +
        ' <span class="muted">' +
        esc(t.levelName) +
        '</span></td><td class="num">' +
        st.target +
        " " +
        unit(t) +
        (t.perSide ? "/side" : "") +
        '</td><td class="num">' +
        (PR.usesVest(ex) ? fmtLoad(st.vest) : "—") +
        '</td><td class="num">' +
        (st.failStreak
          ? '<span class="bad">' + st.failStreak + " miss</span>"
          : st.topOutStreak
          ? '<span class="good">' + st.topOutStreak + "/" + P.rules.topOutSessions + " top</span>"
          : "—") +
        "</td></tr>";
    });
    h += "</tbody></table></div></div>";

    h += '<div class="panel pad"><h2>Sessions</h2>';
    if (!state.sessions.length) {
      h += '<p class="empty">Nothing logged yet.</p>';
    } else {
      h += '<div class="sess-list">';
      state.sessions
        .slice()
        .reverse()
        .forEach(function (s, idx) {
          var n = state.sessions.length - idx;
          var vol = 0;
          Object.keys(s.entries).forEach(function (id) {
            s.entries[id].sets.forEach(function (set) {
              vol += set.value;
            });
          });
          h +=
            '<details class="sess"><summary>' +
            '<span class="sess-n">#' +
            n +
            "</span>" +
            '<span class="sess-w">Workout ' +
            s.workout +
            "</span>" +
            '<span class="sess-d">' +
            fmtDate(s.date) +
            "</span>" +
            '<span class="sess-x muted">' +
            (s.durationSec ? fmtDuration(s.durationSec) + " · " : "") +
            vol +
            " total reps/s</span>" +
            "</summary><div class=\"sess-body\">";
          Object.keys(s.entries).forEach(function (id) {
            var ex = P.exercises[id];
            if (!ex) return;
            h +=
              '<div class="sess-line"><span class="sl-name">' +
              esc(ex.name) +
              '</span><span class="sl-sets">' +
              s.entries[id].sets
                .map(function (set) {
                  return set.value + (set.load ? "@" + trimNum(set.load) : "");
                })
                .join(" · ") +
              "</span></div>";
          });
          if (s.note) h += '<p class="sess-note">' + esc(s.note) + "</p>";
          h += "</div></details>";
        });
      h += "</div>";
    }
    h += "</div>";
    return h;
  }

  /* What the last seven days actually trained, by pattern.
   *
   * A total set count cannot show this. Two real sessions came out at 41 sets —
   * a respectable-looking number — while every hip-dominant and every overhead
   * set was missing, because the exercises that provide them sit at the end of
   * workout B and fell off when the clock ran out. Split by pattern it is
   * obvious at a glance; unsplit it is invisible. */
  function renderCoverage() {
    var since = new Date(now() - 7 * 86400000);
    var sinceISO =
      since.getFullYear() +
      "-" +
      String(since.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(since.getDate()).padStart(2, "0");
    var rows = PR.coverage({
      sessions: state.sessions,
      exercises: P.exercises,
      workouts: [P.workouts.A.order, P.workouts.B.order],
      since: sinceISO,
    });
    var trained = rows.filter(function (r) {
      return r.got > 0;
    }).length;
    if (!state.sessions.length) return "";

    var gaps = rows.filter(function (r) {
      return r.state === "missed";
    });
    var h =
      '<div class="panel pad"><h2>Last 7 days</h2>' +
      '<p class="muted small">Sets per movement pattern, against what one A and one B would give you. ' +
      "A pattern nothing covers is invisible in a total.</p>";
    if (gaps.length) {
      h +=
        '<p class="cov-gap">Barely trained: <strong>' +
        gaps
          .map(function (r) {
            return esc(patternLabel(r.pattern));
          })
          .join("</strong>, <strong>") +
        "</strong>.</p>";
    } else if (trained) {
      h += '<p class="cov-ok">Every pattern got work.</p>';
    }
    h += '<div class="cov">';
    var lastGroup = "";
    rows.forEach(function (r) {
      if (r.group !== lastGroup) {
        lastGroup = r.group;
        h += '<div class="cov-group">' + esc(r.group) + "</div>";
      }
      var pct = Math.min(100, Math.round((r.got / r.planned) * 100));
      h +=
        '<div class="cov-row cov-row--' +
        r.state +
        '"><span class="cov-name">' +
        esc(patternLabel(r.pattern)) +
        '</span><span class="cov-bar"><span data-width="' +
        pct +
        '"></span></span><span class="cov-n">' +
        r.got +
        "/" +
        r.planned +
        "</span></div>";
    });
    h += "</div></div>";
    return h;
  }

  /* The pattern id is for the code; this is for you. */
  var PATTERN_LABEL = {
    "prehab-warmup": "warm-up",
    "prehab-hang": "hang",
    "prehab-scap": "scapular",
    "prehab-rear-delt": "rear delt",
    "pull-vertical": "vertical pull",
    "pull-horizontal": "horizontal pull",
    "push-dip": "dip",
    "push-vertical": "overhead push",
    "push-horizontal": "horizontal push",
    "legs-knee": "knee-dominant",
    "legs-hip": "hip-dominant",
    "legs-knee-flexion": "knee flexion",
    "legs-calf": "calf",
    "core-anti-extension": "anti-extension",
    "core-hip-flexion": "hip flexion",
  };

  function patternLabel(p) {
    return PATTERN_LABEL[p] || p;
  }

  function stat(label, value) {
    return '<div class="stat"><div class="stat-v">' + esc(value) + '</div><div class="stat-l">' + esc(label) + "</div></div>";
  }

  /* ================================================================ */
  /* Render — Program                                                  */
  /* ================================================================ */

  function renderProgram() {
    var phase = currentPhase();
    var h = "";

    h +=
      '<div class="panel pad safety"><h2>Training safety</h2>' +
      '<p>Stop for sharp or joint pain, numbness, dizziness, or loss of control. Regress the movement and seek qualified medical advice for an injury or symptoms that persist. This program is general information, not medical advice.</p></div>';

    h +=
      '<div class="panel pad"><h2>How progression works</h2>' +
      "<p>Nothing here needs to be remembered between sessions — the app holds the state and tells you the numbers. The rules it applies:</p>" +
      '<ol class="rules">' +
      "<li><strong>Climb the rep range.</strong> Hit the target on <em>every</em> set and the target goes up by one next session, until you reach the top of the range.</li>" +
      "<li><strong>Hold the top.</strong> Hit the top of the range on all sets for <strong>" +
      P.rules.topOutSessions +
      " sessions in a row</strong> and the load goes up. Beat it by " +
      P.rules.overshootMargin +
      "+ and it goes up immediately.</li>" +
      "<li><strong>Ladder before vest.</strong> Every exercise has a <em>ladder</em> of difficulty levels — feet further out, feet on a box, less assistance. A load increase first moves you one level up that ladder. Only when the ladder is topped out does the vest come into play — <strong>" +
      trimNum(P.rules.vestFirstKg) +
      " kg</strong> first, then <strong>" +
      trimNum(P.rules.vestStepKg) +
      " kg</strong> a time up to " +
      trimNum(P.rules.vestMaxKg) +
      " kg.</li>" +
      "<li><strong>Reset the reps.</strong> Any load increase drops the target back to the bottom of the range. That is what keeps you in the 6-12 hypertrophy window instead of grinding singles.</li>" +
      "<li><strong>Back off when stuck.</strong> Miss the target <strong>" +
      P.rules.failsBeforeDeload +
      " sessions in a row</strong> and the load steps down (1 kg of vest, or one ladder level) and the reps reset.</li>" +
      "<li><strong>Phases gate the load.</strong> A phase unlocks only when you have both the sessions <em>and</em> the calendar weeks. Load increases earned during Phase 1 are banked and applied the moment Phase 2 opens.</li>" +
      "</ol></div>";

    h +=
      '<div class="panel pad"><h2>How often</h2><p class="muted">' +
      esc(P.meta.frequencyNote) +
      "</p><p class=\"muted small\">No fixed days. Phases unlock on <strong>sessions completed and weeks elapsed</strong>, never on the calendar, so training twice a week simply takes longer to clear a gate — which is right, not a penalty. Two sessions a week lands around 11-12 hard sets per muscle group, inside the range associated with growth; three is faster if you will actually do it.</p></div>";

    h += '<div class="panel pad"><h2>Phases</h2><div class="phases">';
    P.phases.forEach(function (p) {
      h +=
        '<div class="phase' +
        (p.id === phase.id ? " phase--now" : "") +
        '">' +
        '<div class="phase-h"><span class="phase-n">Phase ' +
        p.id +
        "</span> " +
        esc(p.name) +
        ' <span class="muted">· unlocks ' +
        esc(p.weeks) +
        "</span>" +
        (p.id === phase.id ? ' <span class="tag tag-top">you are here</span>' : "") +
        "</div>" +
        '<div class="phase-meta">RPE ' +
        esc(p.rpe) +
        " · " +
        esc(p.rir) +
        " · " +
        (p.allowLoadProgress ? "load progression on" : "load progression locked") +
        "</div>" +
        "<p>" +
        esc(p.note) +
        "</p>" +
        "</div>";
    });
    h += "</div></div>";

    ["A", "B"].forEach(function (key) {
      var w = P.workouts[key];
      var adjustments = P.stationOrder.filter(function (s) {
        return (
          P.stations[s].adjust && w.order.some(function (o) {
            return P.exercises[o.id] && P.exercises[o.id].station === s;
          })
        );
      }).length;
      h +=
        '<div class="panel pad"><h2>Workout ' +
        key +
        " — " +
        esc(w.name) +
        "</h2>" +
        '<p class="muted small pgm-sub">' +
        esc(w.legs) +
        " legs · " +
        adjustments +
        " ring adjustment" +
        (adjustments === 1 ? "" : "s") +
        ", downward only</p>";
      P.stationOrder.forEach(function (stKey) {
        var inSt = w.order.filter(function (o) {
          return P.exercises[o.id] && P.exercises[o.id].station === stKey;
        });
        if (!inSt.length) return;
        h +=
          '<div class="pgm-station"><div class="pgm-st-head">' +
          P.stations[stKey].icon +
          " " +
          esc(stationLabel(stKey)) +
          "</div>";
        inSt.forEach(function (o) {
          var ex = P.exercises[o.id];
          h +=
            '<div class="pgm-ex"><span class="pgm-name">' +
            esc(ex.name) +
            (o.levelOffset ? ' <span class="tag tag-off">+1 level</span>' : "") +
            (ex.correction ? ' <span class="tag tag-warn">corrected</span>' : "") +
            '</span><span class="pgm-sets">' +
            (o.setCount || ex.sets) +
            " × " +
            PR.rung(ex, 0).range[0] +
            "-" +
            PR.rung(ex, 0).range[1] +
            " " +
            unit(PR.rung(ex, 0)) +
            "</span></div>";
        });
        h += "</div>";
      });
      h += "</div>";
    });

    h += '<div class="panel pad"><h2>Exercise reference</h2>';
    Object.keys(P.exercises).forEach(function (id) {
      var ex = P.exercises[id];
      h +=
        '<details class="ref"><summary><strong>' +
        esc(ex.name) +
        '</strong> <span class="muted">' +
        esc(stationLabel(ex.station)) +
        " · " +
        ex.sets +
        " × " +
        PR.rung(ex, 0).range[0] +
        "-" +
        PR.rung(ex, 0).range[1] +
        " " +
        unit(PR.rung(ex, 0)) +
        "</span></summary><div class=\"ref-body\">";
      h += exerciseImage(id, ex, 0);
      h += videoLink(ex);
      h += "<p>" + esc(ex.why) + "</p>";
      if (ex.note)
        h += '<p class="' + (ex.correction ? "correction" : "muted") + '">' + esc(ex.note) + "</p>";
      h += "<ul>";
      PR.rung(ex, 0).cues.forEach(function (c) {
        h += "<li>" + esc(c) + "</li>";
      });
      h += "</ul>";
      h += ladderHtml(ex, null);
      h += "</div></details>";
    });
    h += "</div>";

    return h;
  }

  /* ================================================================ */
  /* Render — Data                                                     */
  /* ================================================================ */

  function renderData() {
    var h = "";
    var themeChoice = window.WorkoutTheme ? window.WorkoutTheme.getChoice() : "system";
    h +=
      '<div class="panel pad"><h2>Settings</h2>' +
      '<div class="field"><label class="field-label" for="optTheme">Appearance</label>' +
      '<select id="optTheme" data-theme-control>' +
      [
        ["light", "Light"],
        ["system", "System"],
        ["dark", "Dark"],
      ].map(function (option) {
        return '<option value="' + option[0] + '"' +
          (themeChoice === option[0] ? " selected" : "") + '>' + option[1] + '</option>';
      }).join("") +
      '</select><p class="muted small">System follows this device and updates when its appearance changes.</p></div>' +
      '<label class="toggle"><input type="checkbox" id="optRest"' +
      (state.settings.restTimer ? " checked" : "") +
      '> <span>Rest timer <span class="muted">— counts down and beeps after each logged set</span></span></label>' +
      '<div class="field"><span class="field-label">Screen wake lock</span>' +
      (function () {
        var w = wakeLockLabel();
        return (
          '<p class="wake-state' + (w[2] ? " bad" : "") + '">' + esc(w[0]) + "</p>" +
          (w[1] ? '<p class="muted small">' + esc(w[1]) + "</p>" : "")
        );
      })() +
      "</div>" +
      '<div class="field"><span class="field-label">Offline illustrations</span>' +
      '<p id="mediaCacheState" class="wake-state' + (mediaCacheBad ? " bad" : "") + '">' +
      esc(mediaCacheState) + "</p>" +
      (updateReady
        ? '<p class="muted small">A new app version is ready. Use the reload prompt to switch versions.</p>'
        : '<p class="muted small">Cached in a background task so every exercise picture remains available without a connection.</p>') +
      "</div>" +
      '<div class="field"><label class="field-label" for="optLead">Get-into-position countdown</label>' +
      '<select id="optLead">' +
      [0, 3, 5, 10]
        .map(function (n) {
          return (
            '<option value="' + n + '"' +
            (state.settings.holdLeadIn === n ? " selected" : "") +
            ">" + (n ? n + " seconds" : "None — start immediately") + "</option>"
          );
        })
        .join("") +
      '</select><p class="muted small">Timed exercises (movement prep, dead hang, ring fallouts) count you in before the clock starts, so tapping Start does not eat the seconds you spend getting into the rings. Beeps on the last three, then a higher tone and “Go”.</p></div>' +
      '<div class="field"><label class="field-label" for="optCall">Count out a hold</label>' +
      '<select id="optCall">' +
      [0, 5, 10, 15, 30]
        .map(function (n) {
          return (
            '<option value="' + n + '"' +
            (callEvery() === n ? " selected" : "") +
            ">" + (n ? "Say the time every " + n + " seconds" : "Say nothing until the target") + "</option>"
          );
        })
        .join("") +
      '</select><p class="muted small">Hanging from the rings you cannot look at the phone, and a hold has no reps to count — so it calls the seconds out as they pass, and keeps going past the target until you stop it. The target itself is always announced with a beep. Needs a voice; in beep-only mode the marks are silent.</p></div>' +
      '<div class="field"><label class="field-label" for="optWarm">Bluetooth wake-up</label>' +
      '<select id="optWarm">' +
      [0, 300, 600, 1000, 1500]
        .map(function (n) {
          return (
            '<option value="' + n + '"' +
            (cues.warmupMs() === n ? " selected" : "") +
            ">" + (n ? n + " ms of silent lead-in" : "None — play immediately") + "</option>"
          );
        })
        .join("") +
      '</select><p class="muted small">Bluetooth headphones idle between sounds and swallow the first few hundred milliseconds when they wake, so an inaudible tone goes out ahead of every cue. Raise this if the first word still gets cut; drop it to zero on wired or built-in speakers. Use the 🔊 button in the header to test after changing it.</p></div>' +
      '<div class="field"><label class="field-label" for="optSound">Sound</label>' +
      '<select id="optSound">' +
      [
        ["voice", "Beep, then speak what is next"],
        ["beep", "Beep only"],
        ["off", "Silent"],
      ]
        .map(function (o) {
          return (
            '<option value="' + o[0] + '"' +
            (state.settings.sound === o[0] ? " selected" : "") +
            ">" + esc(o[1]) + "</option>"
          );
        })
        .join("") +
      "</select>" +
      (function () {
        var vs = cues.voices();
        if (!vs.length) return "";
        return (
          '<label class="field-label field-label-spaced" for="optVoice">Voice</label>' +
          '<select id="optVoice">' +
          '<option value=""' + (state.settings.voiceName ? "" : " selected") + ">Automatic — best available</option>" +
          vs
            .map(function (v) {
              return (
                '<option value="' + esc(v.name) + '"' +
                (state.settings.voiceName === v.name ? " selected" : "") +
                ">" + esc(v.name) + " (" + esc(v.lang) + ")</option>"
              );
            })
            .join("") +
          "</select>"
        );
      })() +
      '<div class="btn-row btn-row-spaced"><button class="btn btn-sm" data-act="test-sound">Test</button>' +
      '<span id="soundMsg" class="msg msg-inline" hidden></span></div>' +
      '<p class="muted small' +
      (cues.status() === "ready" ? '">' : ' bad">') +
      (cues.status() === "ready"
        ? "Uses your device's own voice — nothing is downloaded and it works offline. It announces the next exercise and set when rest ends, a ten-second warning before that, and the target when a hold is reached."
        : cues.status() === "unsupported"
        ? "This browser has no speech support at all. “Speak” falls back to beeping."
        : "No voices available in this browser, so “speak” falls back to beeping. Chrome on Linux does not expose system voices to web pages even when speech-dispatcher is installed — Firefox does, and phones work out of the box.") +
      "</p></div>" +
      '<div class="field"><label class="field-label" for="optCap">Session length</label>' +
      '<select id="optCap">' +
      CAPS.map(function (c) {
        return (
          '<option value="' +
          c +
          '"' +
          (state.settings.sessionCapMin === c ? " selected" : "") +
          ">" +
          (c ? "Cap at " + c + " minutes" : "Full session — no trimming") +
          "</option>"
        );
      }).join("") +
      '</select><p class="muted small">Sets are shaved one at a time off the least important exercise still above its floor — calves and face pulls first, the main lifts last, and never below two sets. The estimate is arithmetic; real sessions run 10-15% longer.</p></div>' +
      '<div class="field"><label class="field-label" for="optPhase">Phase</label>' +
      '<select id="optPhase">' +
      '<option value="0"' +
      (!state.settings.phaseOverride ? " selected" : "") +
      ">Automatic (sessions + weeks)</option>" +
      P.phases
        .map(function (p) {
          return (
            '<option value="' +
            p.id +
            '"' +
            (state.settings.phaseOverride === p.id ? " selected" : "") +
            ">Force Phase " +
            p.id +
            " — " +
            esc(p.name) +
            "</option>"
          );
        })
        .join("") +
      '</select><p class="muted small">Forcing a phase is for coming back from a break — drop to Phase 1 for a couple of weeks rather than picking up where you left off.</p></div>' +
      "</div>";

    h +=
      '<div class="panel pad"><h2>Backup</h2>' +
      '<p class="muted">All data lives in this browser\'s localStorage. Clearing site data wipes it. Export regularly.</p>' +
      '<div class="btn-row">' +
      '<button class="btn" data-act="export">Download JSON</button>' +
      '<button class="btn" data-act="copy">Copy to clipboard</button>' +
      '<label class="btn btn-file">Import JSON<input type="file" id="importFile" accept="application/json,.json" hidden></label>' +
      "</div>" +
      '<div id="dataMsg" class="msg" role="status" aria-live="polite" hidden></div>' +
      "</div>";

    h +=
      '<div class="panel pad danger"><h2>Reset</h2>' +
      '<div class="btn-row">' +
      '<button class="btn btn-ghost" data-act="reset-progress">Reset progression only</button>' +
      '<button class="btn btn-ghost" data-act="reset-all">Erase everything</button>' +
      "</div>" +
      '<p class="muted small">“Progression only” keeps your session history but sends every exercise back to level 1, bottom of the range, no vest.</p>' +
      "</div>";

    return h;
  }

  /* ================================================================ */
  /* Render — shell                                                    */
  /* ================================================================ */

  var currentTab = "today";
  var expandedInfo = {}; // exercise id -> details panel open (survives re-render)

  function render() {
    try {
      draw();
      return true;
    } catch (e) {
      fail("drawing the page", e);
      return false;
    }
  }

  function draw() {
    invalidatePlan();
    var phase = currentPhase();
    document.getElementById("progName").textContent = P.meta.name;
    var kit = sessionKit(nextWorkoutKey(), true);
    document.getElementById("headline").textContent =
      P.meta.subtitle + " · " + (kit.length ? "needs " + kit.join(", ") : "no equipment");
    var badge = document.getElementById("phaseBadge");
    badge.innerHTML =
      '<span class="pb-n">Phase ' + phase.id + "</span><span class=\"pb-l\">" + esc(phase.name) + "</span>";
    badge.className = "phase-badge phase-badge--" + phase.id;

    /* Patched, not replaced. Assigning innerHTML here rebuilt every node on
     * every tap, which silently detached any element a handler was still
     * holding and threw away scroll position mid-session. */
    var views = {
      today: renderToday,
      history: renderHistory,
      program: renderProgram,
      data: renderData,
    };
    Object.keys(views).forEach(function (t) {
      DP.patch(document.getElementById("view-" + t), currentTab === t ? views[t]() : "");
    });

    ["today", "history", "program", "data"].forEach(function (t) {
      document.getElementById("view-" + t).hidden = t !== currentTab;
    });
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (b) {
      var selected = b.dataset.tab === currentTab;
      b.setAttribute("aria-selected", selected ? "true" : "false");
      b.setAttribute("tabindex", selected ? "0" : "-1");
    });

    renderNextUp();
    showStorageWarning();
    bindViewInputs();
    followAlong();
  }

  /* Bring the live card into view, but only when the EXERCISE changes — doing it
   * on every logged set would yank the page around under your thumb. `nearest`
   * leaves it alone when it is already on screen. */
  var followingId = null;
  function renderNextUp() {
    var bar = document.getElementById("nextUp");
    bar.hidden = !state.active;
    if (!state.active) {
      document.body.classList.remove("has-next-up");
      return;
    }
    document.body.classList.add("has-next-up");
    var here = currentPosition();
    if (!here) {
      DP.patch(bar, '<div class="next-up-copy"><strong>All sets complete</strong><small>Finish to save your session.</small></div><button class="btn btn-primary" data-act="finish">Finish</button>');
      return;
    }
    var target = targetFor(here.id);
    var entry = state.active.entries[here.id];
    var set = entry && entry.sets[here.set];
    var count = entry ? entry.sets.filter(function (s) { return !isSkipped(s); }).length : target.sets;
    var number = entry ? entry.sets.slice(0, here.set + 1).filter(function (s) { return !isSkipped(s); }).length : here.set + 1;
    var value = set ? setValue(set, target) : target.value;
    var load = set ? setLoad(set, here.id, target) : target.vest;
    DP.patch(bar, '<div class="next-up-copy" role="status"><small>' +
      (activeHold() ? "Current set" : "Next up") + '</small><strong>' + esc(P.exercises[here.id].name) +
      '</strong><small>Set ' + number + ' of ' + count + ' · ' + esc(value) +
      (target.metric === "seconds" ? ' s' : ' reps') + (target.perSide ? ' per side' : '') +
      (load ? ' · ' + esc(fmtLoad(load)) : '') +
      '</small></div><button class="btn" data-act="go-to-set">Go to set</button>');
  }

  function followAlong() {
    if (currentTab !== "today") return;
    var here = currentPosition();
    var id = here && here.id;
    if (id === followingId) return;
    var moved = followingId !== null || !!state.active;
    followingId = id;
    if (!id || !moved) return;
    var el = document.querySelector('.ex-card[data-ex="' + id + '"]');
    if (el && el.scrollIntoView) {
      try {
        var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
      } catch (e) {
        el.scrollIntoView();
      }
    }
  }

  /* Nodes survive a render now, so their listeners do too — binding blind would
   * stack another copy on every tap. */
  function bindOnce(id, type, fn) {
    var el = document.getElementById(id);
    if (!el || el.boundTo === type) return null;
    /* A plain property, not a data attribute — patching removes any attribute
     * the render does not emit, so an attribute marker would vanish and the
     * listener would stack up again on the very next tap. */
    el.boundTo = type;
    el.addEventListener(type, fn);
    return el;
  }

  function bindViewInputs() {
    bindImageFallbacks();
    Array.prototype.forEach.call(document.querySelectorAll(".cov-bar [data-width]"), function (bar) {
      bar.style.width = bar.getAttribute("data-width") + "%";
    });
    bindOnce("sessionNote", "input", function () {
      if (!state.active) return;
      state.active.note = document.getElementById("sessionNote").value;
      save();
    });
    bindOnce("optRest", "change", function () {
      state.settings.restTimer = document.getElementById("optRest").checked;
      if (!state.settings.restTimer) stopRest();
      save();
    });
    bindOnce("optWarm", "change", function () {
      state.settings.audioWarmupMs = parseInt(document.getElementById("optWarm").value, 10) || 0;
      save();
      cues.cool(); // force a real primer on the next test, whatever the timing
      beep();
      say("Ring dips, set two");
    });
    bindOnce("optCall", "change", function () {
      state.settings.holdCallEvery = parseInt(document.getElementById("optCall").value, 10) || 0;
      save();
      render();
    });
    bindOnce("optLead", "change", function () {
      state.settings.holdLeadIn = parseInt(document.getElementById("optLead").value, 10) || 0;
      save();
      render();
    });
    bindOnce("optVoice", "change", function () {
      state.settings.voiceName = document.getElementById("optVoice").value;
      cues.refresh();
      cues.prime();
      say("Ring dips, set two");
      save();
    });
    bindOnce("optSound", "change", function () {
      state.settings.sound = document.getElementById("optSound").value;
      cues.prime();
      save();
      render();
    });
    bindOnce("optCap", "change", function () {
      state.settings.sessionCapMin = parseInt(document.getElementById("optCap").value, 10) || 0;
      invalidatePlan();
      if (state.active) workoutItems(state.active.workout).forEach(ensureEntry);
      save();
      render();
    });
    bindOnce("optPhase", "change", function () {
      state.settings.phaseOverride = parseInt(document.getElementById("optPhase").value, 10) || 0;
      save();
      render();
    });
    bindOnce("importFile", "change", doImport);
  }

  /* Bind before assigning src. Inline onload/onerror handlers made a strict
   * Content Security Policy impossible and were awkward to escape safely. The
   * node may survive a patched render, so its handlers read mutable properties
   * while each draw refreshes the candidate list. */
  function bindImageFallbacks() {
    Array.prototype.forEach.call(document.querySelectorAll(".ex-img"), function (img) {
      if (!img.imageEventsBound) {
        img.imageEventsBound = true;
        img.addEventListener("load", function () {
          if (img.parentNode) img.parentNode.style.display = "block";
        });
        img.addEventListener("error", function () {
          if (img.imageFallbackIndex < img.imageFallbacks.length) {
            img.setAttribute("src", img.imageFallbacks[img.imageFallbackIndex++]);
          } else if (img.parentNode) {
            img.parentNode.remove();
          }
        });
      }
      try {
        img.imageFallbacks = JSON.parse(img.getAttribute("data-fallbacks") || "[]");
      } catch (e) {
        img.imageFallbacks = [];
      }
      img.imageFallbackIndex = 0;
      var src = img.getAttribute("data-src");
      if (src && img.getAttribute("src") !== src) img.setAttribute("src", src);
    });
  }

  /* ================================================================ */
  /* Events                                                            */
  /* ================================================================ */

  document.addEventListener("click", guard("handling a tap", function (e) {
    var tab = e.target.closest(".tab");
    if (tab) {
      currentTab = tab.dataset.tab;
      render();
      return;
    }

    var btn = e.target.closest("[data-act]");
    if (!btn) return;
    var act = btn.dataset.act;
    var card = btn.closest(".ex-card");
    var exId = card ? card.dataset.ex : null;
    var setRow = btn.closest(".set-row");
    var setIdx = setRow ? parseInt(setRow.dataset.set, 10) : -1;

    switch (act) {
      case "go-to-set": {
        currentTab = "today";
        render();
        var next = currentPosition();
        if (!next) return;
        var nextCard = document.querySelector('.ex-card[data-ex="' + next.id + '"]');
        var row = nextCard && nextCard.querySelectorAll('.set-row')[next.set];
        if (row) {
          row.setAttribute("tabindex", "-1");
          if (row.focus) row.focus({ preventScroll: true });
          if (row.scrollIntoView) row.scrollIntoView({ block: "center", behavior: "auto" });
        }
        return;
      }
      case "start":
        cues.prime();
        startSession();
        var first = currentPosition();
        say(
          "Workout " +
            state.active.workout +
            ". " +
            stationLabel(sessionPlan(state.active.workout)[0].key) +
            (first ? ". " + announce(first.id, first.set) : "")
        );
        return;
      case "finish":
        finishSession();
        return;
      case "abandon":
        if (confirm("Discard this session? Logged sets will be lost.")) {
          state.active = null;
          stopRest();
          releaseWakeLock();
          save();
          render();
        }
        return;
      case "set-place": {
        /* A preset REPLACES the ticks rather than adding to them: tapping Park
         * has to drop the rings, or the session would still be planned around
         * equipment you have just walked away from. */
        state.settings.kit = (P.places[btn.dataset.place] || P.places.home).has.slice();
        invalidatePlan();
        /* A place change can cap a level or remove an exercise, so the running
         * session's entries have to be rebuilt against what is here now. */
        if (state.active) workoutItems(state.active.workout).forEach(ensureEntry);
        save();
        render();
        return;
      }
      case "toggle-kit": {
        var token = btn.dataset.kit;
        var have = currentKit().slice();
        var at = have.indexOf(token);
        if (at >= 0) have.splice(at, 1);
        else have.push(token);
        state.settings.kit = have;
        invalidatePlan();
        if (state.active) workoutItems(state.active.workout).forEach(ensureEntry);
        save();
        render();
        return;
      }
      case "set-cap": {
        var cap = parseInt(btn.dataset.cap, 10) || 0;
        state.settings.sessionCapMin = cap;
        invalidatePlan();
        if (state.active) workoutItems(state.active.workout).forEach(ensureEntry);
        save();
        render();
        return;
      }
      case "rest-skip":
        stopRest();
        render();
        return;
      case "rest-now": {
        cues.prime();
        var nid = btn.dataset.nextid;
        var nset = parseInt(btn.dataset.nextset, 10) || 0;
        startRest(
          parseInt(btn.dataset.rest, 10) || 90,
          btn.dataset.restname || "Rest",
          /* A wait you started by hand ends the same way as one that started by
           * itself — it is the same wait, and you need the same thing said. */
          nid && P.exercises[nid] ? announce(nid, nset) : "",
          nid ? { id: nid, set: nset } : null
        );
        return;
      }
      case "pick-workout": {
        var pick = btn.dataset.w;
        /* Only remember it when it differs from the natural alternation, so a
         * stale override cannot outlive the reason for it. */
        state.nextOverride = pick === PR.nextWorkout(state.sessions) ? null : pick;
        save();
        render();
        return;
      }
      case "dismiss-migration":
        migrationNotes = [];
        render();
        return;
      case "dismiss-summary":
        lastSummary = null;
        render();
        return;
      case "toggle-info": {
        if (expandedInfo[exId]) delete expandedInfo[exId];
        else expandedInfo[exId] = true;
        render();
        return;
      }
      case "rep-dec":
      case "rep-inc": {
        autoStart();
        var e1 = ensureEntry(entryFor(exId));
        var s = e1 && e1.sets[setIdx];
        if (!s) { render(); return; }
        var t1 = targetFor(exId);
        var step = t1.step;
        var cur = setValue(s, t1);
        /* A hand-added set already at its floor is removed by one more tap on
         * the minus — the only way to take an extra set back off. */
        if (act === "rep-dec" && s.extra && !s.done && cur <= step) {
          if (activeHold() && activeHold().id === exId) state.active.hold = null;
          e1.sets.splice(setIdx, 1);
          save();
          render();
          return;
        }
        /* One more tap past the floor on a PRESCRIBED set drops it instead:
         * "I am not doing this one". Short of time, that is the gesture you
         * want — not deleting the row, which loses the fact that there was
         * meant to be a third set. */
        if (act === "rep-dec" && !s.done && !s.extra && cur <= step && canSkip(exId, t1.sets)) {
          if (activeHold() && activeHold().id === exId) state.active.hold = null;
          s.value = 0;
          save();
          render();
          return;
        }
        /* And plus puts it straight back to what was prescribed, rather than
         * making you tap up from one rep. */
        if (act === "rep-inc" && isSkipped(s)) {
          s.value = null;
          save();
          render();
          return;
        }
        /* Floor at one step — a 0-rep set is otherwise never meant. Writing a
         * number here is what marks it as deliberately changed. */
        s.value = Math.max(step, cur + (act === "rep-inc" ? step : -step));
        save();
        render();
        return;
      }
      case "pick-gear": {
        var gear = state.settings.gear || (state.settings.gear = {});
        gear[btn.dataset.cap] = btn.dataset.gear;
        invalidatePlan();
        if (state.active) workoutItems(state.active.workout).forEach(ensureEntry);
        save();
        render();
        return;
      }
      case "pick-variant": {
        var it = itemFor(exId);
        if (!it) return;
        var slot = it.slot || it.id;
        if (levelPinned(it.id)) return;
        var chosen = btn.dataset.variant;
        var vs = state.settings.variant || (state.settings.variant = {});
        /* Choosing what the workout already prescribes is not an override —
         * storing it would freeze the slot against a later program change. */
        if (chosen === slot) delete vs[slotKey(nextWorkoutKey(), slot)];
        else vs[slotKey(nextWorkoutKey(), slot)] = chosen;
        invalidatePlan();
        if (state.active) workoutItems(state.active.workout).forEach(ensureEntry);
        save();
        render();
        return;
      }
      case "level-dec":
      case "level-inc": {
        if (levelPinned(exId)) return;
        var lex = P.exercises[exId];
        var lst = exState(exId);
        var want = lst.level + (act === "level-inc" ? 1 : -1);
        var lvl = Math.max(0, Math.min(PR.maxLevel(lex), want));
        if (lvl === lst.level) return;
        /* A level you set by hand is a fresh start on that rung: the reps go to
         * the bottom of ITS range, and streaks earned somewhere else do not
         * follow you there. */
        lst.level = lvl;
        lst.target = PR.rung(lex, lvl).range[0];
        lst.topOutStreak = 0;
        lst.failStreak = 0;
        state.exerciseState[exId] = lst;
        save();
        render();
        return;
      }
      case "vest-dec":
      case "vest-inc": {
        autoStart();
        var e2 = ensureEntry(entryFor(exId));
        var d = act === "vest-inc" ? P.rules.vestStepKg : -P.rules.vestStepKg;
        /* Sets not yet logged follow this automatically — they carry no load of
         * their own until they are logged, which is what makes descending sets
         * work without writing to each row. */
        e2.vest = PR.roundKg(
          Math.min(P.rules.vestMaxKg, Math.max(0, entryVest(exId, targetFor(exId)) + d))
        );
        save();
        render();
        return;
      }
      case "start-hold": {
        if (turnFor(exId) !== setIdx) return; // not this set's turn
        autoStart();
        cues.prime();
        commitHold(); // a hold already running is logged, not discarded
        stopRest();
        var eh = ensureEntry(entryFor(exId));
        if (!eh || !eh.sets[setIdx]) { render(); return; }
        var leadIn = state.settings.holdLeadIn || 0;
        state.active.hold = {
          id: exId,
          set: setIdx,
          readyAt: new Date(now() + leadIn * 1000).toISOString(),
          target: setValue(eh.sets[setIdx], targetFor(exId)),
          beeped: false,
          started: leadIn === 0,
        };
        if (leadIn) say("Get ready");
        else say("Go");
        save();
        render();
        return;
      }
      case "stop-hold": {
        var hh = activeHold();
        var hid = hh && hh.id;
        var hset = hh ? hh.set : 0;
        var wasCancelled = hh && holdLeadLeft(hh) > 0;
        commitHold();
        if (wasCancelled) {
          save();
          render();
          return;
        }
        save();
        render();
        if (hid) restAfter(hid, hset);
        return;
      }
      case "log-set": {
        if (turnFor(exId) !== setIdx) return; // not this set's turn
        autoStart();
        cues.prime();
        var e3 = ensureEntry(entryFor(exId));
        var set = e3 && e3.sets[setIdx];
        if (!set) { render(); return; }
        /* Logging a TIMED set by hand — no clock was run, so a hold left over
         * from a previous tap must not attach itself to this row. */
        if (activeHold() && activeHold().id === exId) commitHold();
        var t3 = targetFor(exId);
        /* Freeze both: from here this row is a record of what happened. */
        set.value = setValue(set, t3);
        set.load = setLoad(set, exId, t3);
        set.done = true;
        set.at = nowISO();
        state.active.resume = null;
        save();
        render();
        restAfter(exId, setIdx);
        return;
      }
      case "undo-set": {
        var e4 = ensureEntry(entryFor(exId));
        if (!e4 || !e4.sets[setIdx]) { render(); return; }
        var s4 = e4.sets[setIdx];
        s4.done = false;
        state.active.resume = { id: exId, set: setIdx };
        s4.load = null; // follows the vest control again
        delete s4.at;
        /* A hold's value was written by the clock, not by the user, so undo
         * hands it back to the plan. A rep count you typed is yours to keep. */
        if (targetFor(exId).metric === "seconds") s4.value = null;
        save();
        render();
        return;
      }
      case "skip-exercise": {
        /* Cutting every set one tap at a time works but is absurd when the
         * answer is "not today". This ignores the minSets floor on purpose:
         * that floor exists to stop an exercise being DEGRADED to one set, and
         * dropping it entirely is a different decision. */
        autoStart();
        var e6 = ensureEntry(entryFor(exId));
        var anyLeft = e6.sets.some(function (st) {
          return !st.done && !isSkipped(st);
        });
        e6.sets.forEach(function (st) {
          if (st.done) return;
          st.value = anyLeft ? 0 : null; // restore to the plan when un-skipping
        });
        save();
        render();
        return;
      }
      case "add-set": {
        autoStart();
        var e5 = ensureEntry(entryFor(exId));
        var last = e5.sets[e5.sets.length - 1];
        e5.sets.push({
          done: false,
          value: last && typeof last.value === "number" ? last.value : null,
          load: null,
          extra: true, // added by hand — the cap trim must leave it alone
        });
        save();
        render();
        return;
      }
      case "test-sound": {
        cues.prime();
        beep();
        say("Ring dips, set two");
        var noVoice = cues.status() !== "ready" && state.settings.sound === "voice";
        var voice = cues.current() || cues.refresh();
        var what =
          state.settings.sound === "off"
            ? "Sound is off — turn it on in Data"
            : noVoice
            ? "Beeped — no voice available in this browser"
            : state.settings.sound === "beep"
            ? "Beeped"
            : "Beeped, then spoke — voice: " + (voice ? voice.name : "platform default");
        toast(what, noVoice || state.settings.sound === "off");
        var el = document.getElementById("soundMsg");
        if (el) {
          el.textContent = what + ".";
          el.className = "msg msg-inline" + (noVoice ? " msg-bad" : "");
          el.hidden = false;
        }
        return;
      }
      case "export":
        doExport();
        return;
      case "copy":
        doCopy();
        return;
      case "reset-progress":
        if (confirm("Send every exercise back to level 1 and clear all targets? History is kept.")) {
          state.exerciseState = {};
          save();
          render();
        }
        return;
      case "reset-all":
        if (confirm("Erase all sessions, settings and progression. This cannot be undone.")) {
          if (!storageIsCurrent()) return;
          localStorage.removeItem(KEY);
          state = load();
          render();
        }
        return;
    }
  }));

  document.addEventListener("keydown", guard("moving between tabs", function (e) {
    var tab = e.target.closest && e.target.closest(".tab");
    if (!tab) return;
    var tabs = Array.prototype.slice.call(document.querySelectorAll(".tab"));
    var at = tabs.indexOf(tab), next = at;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (at + 1) % tabs.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (at - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    if (e.preventDefault) e.preventDefault();
    currentTab = tabs[next].dataset.tab;
    render();
    var selected = document.getElementById("tab-" + currentTab);
    if (selected && selected.focus) selected.focus();
  }));

  document.getElementById("crashReload").addEventListener("click", function () {
    location.reload();
  });
  document.getElementById("crashExport").addEventListener("click", function () {
    try {
      doExport();
    } catch (e) {
      fail("writing the backup", e);
    }
  });
  document.getElementById("storageWarningExport").addEventListener("click", function () {
    try {
      if (rejectedPayload !== null) {
        downloadText(rejectedPayload, "workout-rejected-" + todayISO() + ".txt", "text/plain");
      } else {
        doExport();
      }
    } catch (e) {
      fail("writing the backup", e);
    }
  });
  document.getElementById("crashHide").addEventListener("click", function () {
    document.getElementById("crash").hidden = true;
  });

  /* Anything that escapes the guards above — an async callback, a bad image
   * handler, a browser API throwing where it is documented not to. */
  window.addEventListener("error", function (e) {
    fail("in the background", (e && e.error) || (e && e.message) || e);
  });
  window.addEventListener("unhandledrejection", function (e) {
    fail("in the background", (e && e.reason) || e);
  });

  document.getElementById("restSkip").addEventListener("click", function () {
    stopRest();
    render(); // the step in the card has to stop showing a clock that has stopped
  });
  document.getElementById("restAdd").addEventListener("click", function () {
    if (rest.until) {
      rest.until += 30000;
      rest.total += 30;
      tick();
    }
  });

  /* The current workout's order entry for an exercise — carries levelOffset
   * and setCount, so a tap knows which day's prescription it is editing. */
  function entryFor(exId) {
    var key = nextWorkoutKey();
    var found = P.workouts[key].order.filter(function (o) {
      return o.id === exId;
    })[0];
    return found ? trimmedEntry(found, key) : { id: exId };
  }

  /* What to say about a set that is coming up: the exercise, which set, and
   * the numbers. Without the numbers you have to pick the phone up off the
   * floor to find out what you were told to do, which is the one thing the
   * announcement exists to save you. */
  function announce(id, setIdx) {
    var ex = P.exercises[id];
    var t = targetFor(id);
    var e = state.active && state.active.entries[id];
    var st = e && e.sets[setIdx];
    var value = st ? setValue(st, t) : t.value;
    var units = t.metric === "seconds" ? " seconds" : value === 1 ? " rep" : " reps";
    return (
      ex.name +
      ", set " +
      (setIdx + 1) +
      ", " +
      value +
      units +
      (t.perSide ? " per side" : "") +
      /* The vest only gets a mention when it is on — "bodyweight" every time
       * would be noise on an exercise that never carries it. */
      (t.vest ? ", " + trimNum(t.vest) + " kilos" : "")
    );
  }

  /* Start the right rest (or none) for whatever comes next. Both the decision
   * and the interval come from nextUp, so a rest can never be started for a
   * gap the timeline says has none. */
  function restAfter(exId, justDone) {
    var n = whatsNext(exId, justDone);
    if (n.kind === "done") return;
    var name = P.exercises[n.id].name;
    if (n.kind === "partner") {
      /* Straight over — the pairing exists so one rest covers both. */
      stopRest();
      say(announce(n.id, n.set) + ", now");
      return;
    }
    var label = n.kind === "exercise" ? "Next: " + name : name;
    startRest(
      n.rest || restFor(exId, state.active.workout),
      label,
      announce(n.id, n.set),
      { id: n.id, set: n.set }
    );
  }

  function autoStart() {
    if (!state.active) startSession();
  }

  /* ================================================================ */
  /* Import / export                                                   */
  /* ================================================================ */

  function payload() {
    return JSON.stringify(state, null, 2);
  }

  function doExport() {
    downloadText(payload(), "workout-" + todayISO() + ".json", "application/json");
    msg("Downloaded workout-" + todayISO() + ".json");
  }

  function downloadText(contents, filename, type) {
    var blob = new Blob([contents], { type: type });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 1000);
  }

  function doCopy() {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(payload()).then(
        function () {
          msg("Copied " + payload().length + " bytes to the clipboard.");
        },
        function () {
          msg("Clipboard blocked — use Download instead.", true);
        }
      );
    } else {
      msg("Clipboard unavailable — use Download instead.", true);
    }
  }

  function doImport(e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    if (typeof f.size === "number" && f.size > MAX_IMPORT_BYTES) {
      msg("Could not read that file: backup is larger than 5 MB.", true);
      e.target.value = "";
      return;
    }
    var r = new FileReader();
    r.onload = function () {
      try {
        var incoming = JSON.parse(r.result);
        var prepared = prepareState(incoming, true);
        if (!storageIsCurrent()) return;
        if (
          (state.sessions.length || state.active || storedSnapshot !== null) &&
          !confirm(
            "Replace all local workout data, including any active workout and settings? Replace " +
              state.sessions.length +
              " local session(s) with " +
              incoming.sessions.length +
              " from the file?"
          )
        )
          return;
        var previous = state;
        var previousMigrated = migrated;
        var previousNotes = migrationNotes;
        state = prepared.state;
        migrated = prepared.migrated;
        migrationNotes = prepared.notes;
        if (!render()) {
          state = previous;
          migrated = previousMigrated;
          migrationNotes = previousNotes;
          document.getElementById("crash").hidden = true;
          render();
          throw new Error("the imported data could not be rendered");
        }
        try {
          if (!storageIsCurrent()) throw new Error("Workout data changed in another tab; reload before importing.");
          var importedText = JSON.stringify(state);
          localStorage.setItem(KEY, importedText);
          storedSnapshot = importedText;
          storageIssue = "";
          rejectedPayload = null;
          showStorageWarning();
        } catch (writeError) {
          state = previous;
          migrated = previousMigrated;
          migrationNotes = previousNotes;
          storageIssue = "Browser storage is unavailable or full (" +
            ((writeError && writeError.name) || "write failed") +
            "). The imported data was not applied.";
          render();
          throw writeError;
        }
        msg("Imported " + state.sessions.length + " session(s).");
      } catch (err) {
        msg("Could not read that file: " + err.message, true);
      } finally {
        e.target.value = "";
      }
    };
    r.readAsText(f);
  }

  var toastTimer = null;
  function toast(text, bad) {
    var el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.className = "toast" + (bad ? " toast--bad" : "") + " toast--on";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.className = "toast" + (bad ? " toast--bad" : "");
    }, 2600);
  }

  function msg(text, bad) {
    var el = document.getElementById("dataMsg");
    if (!el) return;
    el.textContent = text;
    el.className = "msg" + (bad ? " msg-bad" : "");
    el.hidden = false;
  }

  /* ================================================================ */
  /* Offline                                                           */
  /* ================================================================ */

  /* Needs http(s); silently absent on file://, which is fine — opening a local
   * file works offline by definition. */
  if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("message", function (e) {
      if (!e.data || e.data.type !== "MEDIA_CACHE_STATUS") return;
      mediaCacheBad = e.data.failed > 0;
      mediaCacheState = e.data.failed
        ? e.data.ready + " of " + e.data.total + " illustrations cached; " + e.data.failed + " unavailable."
        : "Ready — all " + e.data.total + " illustrations are cached.";
      if (currentTab === "data") render();
    });
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (hadController) {
        updateReady = true;
        var notice = document.getElementById("updateNotice");
        if (notice) notice.hidden = false;
        toast("An app update is ready.");
      }
      hadController = true;
    });
    window.addEventListener("load", function () {
      navigator.serviceWorker
        .register("sw.js")
        .then(function () { return navigator.serviceWorker.ready; })
        .then(function (registration) {
          var worker = navigator.serviceWorker.controller || registration.active;
          if (worker) worker.postMessage({ type: "CACHE_MEDIA" });
        })
        .catch(function () {
          mediaCacheBad = true;
          mediaCacheState = "Offline cache setup failed; reload while connected to retry.";
          if (currentTab === "data") render();
        });
    });
  }

  var updateReload = document.getElementById("updateReload");
  if (updateReload) updateReload.addEventListener("click", function () { location.reload(); });

  /* Persist a migration straight away, so it settles instead of re-running —
   * and re-announcing itself — on every reload until something else saves.
   * Keyed on whether a step ran, not on whether it had anything to report: the
   * silent steps are exactly the ones that would otherwise re-run forever. */
  if (migrated) save();

  render();
  if (state.active) requestWakeLock(); // a session survived a reload
})();
