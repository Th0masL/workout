/* Progression engine — pure functions, no DOM, no storage.
 *
 * Loaded by index.html as a plain script and by tests/ in a node VM context, so
 * it must stay dependency-free and attach to globalThis.
 *
 * The model in one paragraph: every exercise is a ladder of LEVELS. You climb a
 * rep (or second) range one rep at a time. When all sets hit the TOP of the
 * range for `topOutSessions` sessions in a row, the load goes up — one ladder
 * level if any are left, otherwise vest weight — and the target drops back to
 * the bottom of the range. Miss the target `failsBeforeDeload` sessions in a
 * row and the load steps back down. That is double progression with
 * microloading, written out as code so there is nothing to remember between
 * sessions.
 *
 * THE LEVEL IS THE UNIT. A level is very nearly its own exercise: a floor glute
 * bridge and a single-leg hip thrust off a chair share a progression and
 * nothing else. So a level owns its name, its equipment, its picture, whether
 * it is done per side, and — where it genuinely differs — its own rep range,
 * step and rest. The exercise supplies defaults. Everything downstream reads a
 * resolved rung and never reaches into the exercise for these.
 */
(function (root) {
  "use strict";

  var DEFAULT_RULES = {
    topOutSessions: 2,
    failsBeforeDeload: 3,
    overshootMargin: 2,
    vestFirstKg: 1.0,
    vestStepKg: 0.5,
    vestMaxKg: 10.0,
  };

  function rules(r) {
    var out = {};
    for (var k in DEFAULT_RULES) out[k] = DEFAULT_RULES[k];
    for (var j in r || {}) if (r[j] !== undefined) out[j] = r[j];
    return out;
  }

  function roundKg(x) {
    return Math.round(x * 10) / 10;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function maxLevel(ex) {
    return (ex.ladder ? ex.ladder.length : 1) - 1;
  }

  function usesVest(ex) {
    return ex.progression === "ladder-then-vest" || ex.progression === "vest";
  }

  /* ---------------------------------------------------------------- */
  /* Levels                                                            */
  /* ---------------------------------------------------------------- */

  /* The complete prescription for one level, with the exercise's defaults
   * filled in. This is the ONLY place a level's fields are resolved — the
   * fallback chain used to be re-implemented at every call site, which is how
   * `perSideFrom` ended up expressing a level property on the exercise. */
  function rung(ex, level) {
    var ladder = (ex && ex.ladder && ex.ladder.length ? ex.ladder : [{ name: "" }]);
    var i = clamp(typeof level === "number" ? level : 0, 0, ladder.length - 1);
    var r = ladder[i] || {};
    return {
      index: i,
      count: ladder.length,
      name: r.name || "",
      note: r.note || "",
      /* A level that puts you in the rings must not still claim you need the
       * bars, so its own kit REPLACES the exercise default rather than adding
       * to it. Same for the picture. */
      kit: r.kit || ex.kit || [],
      image: r.image || ex.image || "",
      perSide: !!r.perSide,
      /* Coaching follows the level too. A pistol squat and a bodyweight squat
       * share a ladder and nothing else — telling you to keep the front shin
       * vertical is the wrong instruction for one of them. A rung's cues
       * REPLACE the exercise's; `addCues` appends instead, for a level that
       * only adds a caveat. */
      cues: (r.cues || ex.cues || []).concat(r.addCues || []),
      range: r.range || ex.range,
      step: r.step || ex.step,
      rest: r.rest || ex.rest,
      metric: r.metric || ex.metric,
      /* What this level overrode, so the ladder can say so without the UI
       * reaching back into the raw data to work it out — and without comparing
       * against level 1, which is itself just another level. */
      own: {
        cues: !!(r.cues || r.addCues),
        range: !!r.range,
        kit: !!r.kit,
        image: !!r.image,
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /* State                                                             */
  /* ---------------------------------------------------------------- */

  function initialState(ex) {
    var start = ex.startLevel || 0;
    return {
      level: start,
      vest: 0,
      target: rung(ex, start).range[0],
      topOutStreak: 0,
      failStreak: 0,
    };
  }

  function normalizeState(ex, st) {
    var s = st && typeof st === "object" ? st : {};
    var base = initialState(ex);
    var level = clamp(typeof s.level === "number" ? s.level : base.level, 0, maxLevel(ex));
    var r = rung(ex, level);
    /* Only the FLOOR is enforced. The ceiling is deliberately open: an exercise
     * at the top of its ladder with a full vest keeps pushing reps past the
     * range, and clamping here would silently undo that every load. */
    var target = typeof s.target === "number" ? Math.max(s.target, r.range[0]) : base.target;
    return {
      level: level,
      vest: typeof s.vest === "number" ? roundKg(s.vest) : base.vest,
      target: target,
      topOutStreak: typeof s.topOutStreak === "number" ? s.topOutStreak : 0,
      failStreak: typeof s.failStreak === "number" ? s.failStreak : 0,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Targets                                                           */
  /* ---------------------------------------------------------------- */

  /* What to actually do today. Everything the card needs, resolved once.
   *
   * `entry` is the workout's order entry for this exercise, which can bend the
   * shared prescription for one day only:
   *   levelOffset — run it a level harder (workout B's elevated ring rows)
   *   setCount    — run fewer/more sets (push-ups drop to 2 on the pull day)
   * Progression state stays shared across both days either way, so the offset
   * moves what you DO today without moving what you have EARNED. */
  function target(ex, st, phase, entry) {
    var e = entry || {};
    var s = normalizeState(ex, st);
    var lvl = clamp(s.level + (e.levelOffset || 0), 0, maxLevel(ex));
    var r = rung(ex, lvl);
    var vest = phase && phase.allowLoadProgress === false ? 0 : s.vest;
    return {
      sets: e.setCount || ex.sets,
      metric: r.metric,
      value: s.target,
      level: lvl,
      levelName: r.name,
      levelNote: r.note,
      cues: r.cues.slice(),
      offset: e.levelOffset || 0,
      perSide: r.perSide,
      kit: r.kit.slice(),
      image: r.image,
      step: r.step,
      rest: r.rest,
      vest: usesVest(ex) ? vest : 0,
      vestSuppressed: usesVest(ex) && s.vest > 0 && vest === 0,
      atTopOfRange: ex.progression !== "fixed" && s.target >= r.range[1],
      range: r.range.slice(),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Evaluation                                                        */
  /* ---------------------------------------------------------------- */

  /* opts: {exercise, state, sets:[{value, load}], phase, rules, entry}
   * `sets` are the sets actually logged; `entry` is the workout order entry
   * (see target()), so the day's own set count and level offset are judged
   * against, not the exercise defaults.
   * Returns {state, events:[{type, text}], hit}. Pure — `state` is a new object.
   */
  function evaluate(opts) {
    var ex = opts.exercise;
    var R = rules(opts.rules);
    var phase = opts.phase || { allowLoadProgress: true };
    var st = normalizeState(ex, opts.state);
    var logged = (opts.sets || []).filter(function (s) {
      return s && typeof s.value === "number" && s.value > 0;
    });
    var events = [];
    var tgt = target(ex, st, phase, opts.entry);
    /* Progression is judged against the level you have EARNED, not the one a
     * day's levelOffset had you working at — the state climbs its own ladder. */
    var r = rung(ex, st.level);

    if (!logged.length) return { state: st, events: [], hit: false, skipped: true };

    /* Some things are done, not progressed — a warm-up should not creep from
     * three minutes to four to five as you keep completing it. */
    if (ex.progression === "fixed") return { state: st, events: [], hit: true, fixed: true };

    var minValue = Math.min.apply(
      null,
      logged.map(function (s) {
        return s.value;
      })
    );
    var minLoad = Math.min.apply(
      null,
      logged.map(function (s) {
        return roundKg(s.load || 0);
      })
    );
    var openingLoad = roundKg(logged[0].load || 0);

    /* Load is judged on the OPENING set, not the lightest one. Stripping vest
     * weight across sets is a deliberate technique here (descending sets), and
     * judging on the minimum would score every one of them as a failure.
     * Banking a heavier baseline further down still needs every set heavier. */
    var enoughSets = logged.length >= tgt.sets;
    var metValue = minValue >= tgt.value;
    var metLoad = !usesVest(ex) || openingLoad >= tgt.vest - 0.001;
    var hit = enoughSets && metValue && metLoad;

    var unit = r.metric === "seconds" ? "s" : " reps";

    if (!hit) {
      st.failStreak += 1;
      st.topOutStreak = 0;
      if (!enoughSets) {
        events.push({
          type: "short",
          text: "Only " + logged.length + " of " + tgt.sets + " sets logged — targets held.",
        });
      } else if (!metLoad) {
        events.push({
          type: "miss",
          text:
            "Opened at " + fmtKg(openingLoad) + " against a " + fmtKg(tgt.vest) + " target — targets held.",
        });
      } else {
        events.push({
          type: "miss",
          text:
            "Missed " + tgt.value + unit + " (lowest set " + minValue + ") — repeat next session.",
        });
      }

      if (st.failStreak >= R.failsBeforeDeload) {
        st.failStreak = 0;
        if (usesVest(ex) && st.vest > 0) {
          st.vest = roundKg(Math.max(0, st.vest - R.vestStepKg * 2));
          events.push({
            type: "deload",
            text:
              R.failsBeforeDeload +
              " misses in a row — vest down to " +
              fmtKg(st.vest) +
              ", back to " +
              rung(ex, st.level).range[0] +
              unit +
              ".",
          });
        } else if (st.level > 0) {
          st.level -= 1;
          events.push({
            type: "deload",
            text:
              R.failsBeforeDeload +
              " misses in a row — dropping to “" +
              rung(ex, st.level).name +
              "”, back to " +
              rung(ex, st.level).range[0] +
              unit +
              ".",
          });
        } else {
          events.push({
            type: "deload",
            text: "Stalled at the easiest level — take a rest week or check sleep and food.",
          });
        }
        /* Resolved AFTER the level may have moved: dropping a rung can drop you
         * into a level with a different range. */
        st.target = rung(ex, st.level).range[0];
      }
      return { state: st, events: events, hit: false };
    }

    /* ---- hit ---- */
    st.failStreak = 0;

    /* Carried more than prescribed and still hit it — adopt that as the baseline. */
    if (usesVest(ex) && minLoad > st.vest + 0.001 && phase.allowLoadProgress !== false) {
      st.vest = roundKg(Math.min(minLoad, R.vestMaxKg));
      events.push({ type: "load", text: "Vest baseline moved up to " + fmtKg(st.vest) + "." });
    }

    if (st.target < r.range[1]) {
      st.target = Math.min(st.target + r.step, r.range[1]);
      st.topOutStreak = 0;
      events.push({ type: "reps", text: "Next session: " + st.target + unit + "." });
      return { state: st, events: events, hit: true };
    }

    /* At the top of the range. */
    var overshot = minValue >= r.range[1] + R.overshootMargin * r.step;
    st.topOutStreak += 1;
    if (overshot) {
      st.topOutStreak = R.topOutSessions;
      events.push({
        type: "reps",
        text: "Blew past the range (" + minValue + unit + ") — skipping the wait.",
      });
    }

    if (st.topOutStreak < R.topOutSessions) {
      events.push({
        type: "hold",
        text:
          "Top of the range. Hit " +
          r.range[1] +
          unit +
          " once more (" +
          st.topOutStreak +
          "/" +
          R.topOutSessions +
          ") and the load goes up.",
      });
      return { state: st, events: events, hit: true };
    }

    if (phase.allowLoadProgress === false) {
      st.topOutStreak = R.topOutSessions; // banked — promotes the moment the phase unlocks
      events.push({
        type: "locked",
        text:
          "Earned a load increase, but " +
          (phase.name || "this phase") +
          " holds it back. It applies the day Phase 2 opens.",
      });
      return { state: st, events: events, hit: true };
    }

    /* Promote: ladder first, then vest. */
    if (st.level < maxLevel(ex)) {
      st.level += 1;
      var up = rung(ex, st.level);
      st.target = up.range[0];
      st.topOutStreak = 0;
      events.push({
        type: "level",
        text:
          "Level up → “" +
          up.name +
          "”, back to " +
          up.range[0] +
          (up.metric === "seconds" ? "s" : " reps") +
          (up.perSide && !r.perSide ? " per side" : "") +
          ".",
      });
    } else if (usesVest(ex) && st.vest < R.vestMaxKg - 0.001) {
      st.vest = roundKg(Math.min(st.vest === 0 ? R.vestFirstKg : st.vest + R.vestStepKg, R.vestMaxKg));
      st.target = r.range[0];
      st.topOutStreak = 0;
      events.push({
        type: "load",
        text: "Vest → " + fmtKg(st.vest) + ", back to " + r.range[0] + unit + ".",
      });
    } else {
      st.target = st.target + r.step;
      st.topOutStreak = 0;
      events.push({
        type: "maxed",
        text:
          "Hardest level and the vest is full — reps now run past the range (" +
          st.target +
          unit +
          "). Time for a harder variant or a fourth set.",
      });
    }

    return { state: st, events: events, hit: true };
  }

  function fmtKg(kg) {
    if (!kg) return "bodyweight";
    return "+" + (Math.round(kg * 10) / 10).toFixed(1).replace(/\.0$/, "") + " kg";
  }

  /* How many trailing sets to drop when the prescribed count falls — the
   * session-length cap being lowered mid-session. Stops at the first set that
   * must be kept: one already logged, or one the user added by hand. Without
   * the `extra` check, adding a set and then tapping it would delete it. */
  function droppableSets(sets, targetCount) {
    var n = 0;
    for (var i = sets.length - 1; i >= 0; i--) {
      if (sets.length - n <= targetCount) break;
      if (sets[i].done || sets[i].extra) break;
      n++;
    }
    return n;
  }

  /* ---------------------------------------------------------------- */
  /* The session timeline                                              */
  /* ---------------------------------------------------------------- */

  /* ONE model of session time. estimate() sums this; the app walks it to decide
   * what happens after a set. There used to be two independent models — a
   * formula for the estimate and a separate lookahead for the runtime — and
   * they drifted: the estimate counted a rest between exercises that the app
   * was not actually running.
   *
   * items: [{id, sets, workSeconds, rest, superset, station, stationAdjust,
   *          trimPriority, minSets, fixed}] — generic, so the engine still
   * knows nothing about exercises.
   *
   * Rest is the dominant term in a session like this, not the work, which is
   * why supersetting matters so much: members of a group share one rest per
   * round instead of taking one each. */
  var TIME_DEFAULTS = { transition: 30, ringAdjust: 50 };

  function timeCfg(o) {
    return {
      transition: (o && o.transition) || TIME_DEFAULTS.transition,
      ringAdjust: (o && o.ringAdjust) || TIME_DEFAULTS.ringAdjust,
    };
  }

  function group(items) {
    var groups = [], byKey = {};
    (items || []).forEach(function (it, i) {
      var key = it.superset || "solo:" + i;
      if (!byKey[key]) {
        byKey[key] = { key: key, members: [], rest: 0 };
        groups.push(byKey[key]);
      }
      byKey[key].members.push(it);
      /* The rest that applies to a pair is the LONGER of the two intervals —
       * resting 45 s because the face pulls say so would short-change the split
       * squats you did in the same round. */
      byKey[key].rest = Math.max(byKey[key].rest, it.rest || 0);
    });
    return groups;
  }

  function timeline(items, opts) {
    var o = timeCfg(opts);
    var out = [];
    var lastStation = null;

    group(items).forEach(function (g) {
      var rounds = 0;
      g.members.forEach(function (m) {
        rounds = Math.max(rounds, m.sets || 0);
      });
      if (!rounds) return;

      /* The rings only ever travel downward, and only when the station changes.
       * Emitting it as an event rather than adding a lump sum at the end means
       * the estimate and the running order cannot disagree about how many. */
      var station = g.members[0].station || null;
      if (station !== lastStation) {
        if (g.members[0].stationAdjust) {
          out.push({ type: "adjust", seconds: o.ringAdjust, station: station });
        }
        lastStation = station;
      }

      for (var r = 0; r < rounds; r++) {
        g.members.forEach(function (m) {
          if (r >= m.sets) return;
          /* Walking over, setting up and reading the card — once per exercise,
           * not once per set. */
          if (r === 0) out.push({ type: "transition", seconds: o.transition, id: m.id });
          out.push({
            type: "work",
            seconds: m.workSeconds || 0,
            id: m.id,
            set: r,
            group: g.key,
          });
        });
        out.push({
          type: "rest",
          seconds: g.rest,
          round: r,
          group: g.key,
          ids: g.members.map(function (m) {
            return m.id;
          }),
        });
      }
    });

    /* Nothing left to rest for at the end of the session. */
    while (out.length && out[out.length - 1].type === "rest") out.pop();
    return out;
  }

  function estimate(items, opts) {
    return Math.round(
      timeline(items, opts).reduce(function (a, e) {
        return a + (e.seconds || 0);
      }, 0)
    );
  }

  /* The rest interval that applies to an exercise, read off the timeline rather
   * than recomputed — so what the card advertises is what the app will run. */
  function restForId(events, id) {
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (e.type === "rest" && e.ids.indexOf(id) >= 0) return e.seconds;
    }
    return 0;
  }

  /* What to do the moment a set is logged, walked off the same timeline.
   *
   *   partner  — the other half of a superset, same round: go NOW, no rest
   *   set      — another round of this exercise or its pair: rest first
   *   exercise — this one is finished: rest, then the next exercise
   *   done     — nothing left
   *
   * `isDone(id, set)` reports what has actually been logged, which is the only
   * thing the timeline itself cannot know. */
  function nextUp(events, from, isDone) {
    var at = -1;
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (e.type === "work" && e.id === from.id && e.set === from.set) {
        at = i;
        break;
      }
    }

    var fromGroup = at >= 0 ? events[at].group : null;

    function scan(start, stop) {
      var rest = 0, sawRest = false;
      for (var j = start; j < stop; j++) {
        var ev = events[j];
        if (ev.type === "rest") {
          sawRest = true;
          rest = ev.seconds;
          continue;
        }
        if (ev.type !== "work") continue;
        if (isDone(ev.id, ev.set)) continue;
        return {
          kind: !sawRest ? "partner" : ev.group === fromGroup ? "set" : "exercise",
          id: ev.id,
          set: ev.set,
          rest: rest,
        };
      }
      return null;
    }

    /* Forward first, then wrap. Looking forward matters: finishing an exercise
     * used to announce something already left behind. */
    var ahead = at >= 0 ? scan(at + 1, events.length) : scan(0, events.length);
    if (ahead) return ahead;

    if (at >= 0) {
      var behind = scan(0, at);
      if (behind) {
        /* Anything reached by wrapping is a fresh exercise, and always rests. */
        return {
          kind: "exercise",
          id: behind.id,
          set: behind.set,
          rest: behind.rest || restForId(events, from.id),
        };
      }
    }
    return { kind: "done" };
  }

  /* Shave one set at a time off the least important exercise that is still
   * above its floor, until the estimate fits. Cutting one set from each of
   * several exercises beats gutting one of them. */
  function fit(items, budgetSeconds, opts) {
    var work = items.map(function (it) {
      var c = {};
      for (var k in it) c[k] = it[k];
      return c;
    });
    var original = {};
    work.forEach(function (it) { original[it.id] = it.sets; });

    var guard = 0;
    while (estimate(work, opts) > budgetSeconds && guard++ < 500) {
      var cand = null;
      work.forEach(function (it) {
        if (it.fixed || it.sets <= (it.minSets || 1)) return;
        if (!cand) { cand = it; return; }
        var p = it.trimPriority || 0, cp = cand.trimPriority || 0;
        if (p > cp || (p === cp && it.sets > cand.sets)) cand = it;
      });
      if (!cand) break; // everything is at its floor
      cand.sets -= 1;
    }

    var trimmed = work
      .filter(function (it) { return it.sets < original[it.id]; })
      .map(function (it) { return { id: it.id, from: original[it.id], to: it.sets }; });

    var seconds = estimate(work, opts);
    return { items: work, trimmed: trimmed, seconds: seconds, overBudget: seconds > budgetSeconds };
  }

  /* ---------------------------------------------------------------- */
  /* Illustrations                                                     */
  /* ---------------------------------------------------------------- */

  /* Every place a picture for a level might come from, best first.
   *
   * One resolver. The chain grew a source at a time — level URL, exercise URL,
   * local per-level file, local per-exercise file — and each addition was
   * another chance to get the ordering or the quoting wrong, which is exactly
   * what happened. An explicit URL wins outright: if a level names its picture,
   * falling back to a generic one for the exercise would show the wrong
   * movement rather than none.
   *
   * `have` is the generated list of files actually in images/ (data/images.js).
   * Given it, the local candidates are filtered down to the ones that exist, so
   * nothing is requested that is known to be missing — the chain used to probe
   * blind and fire four 404s per exercise without one. Without it the full
   * chain is returned and the browser does the probing, which still works. */
  function imageCandidates(id, ex, level, have) {
    var r = rung(ex, level);
    if (r.image) return [r.image];
    var lvl = id + "-L" + (r.index + 1);
    var names = [lvl + ".gif", lvl + ".jpg", id + ".gif", id + ".jpg"];
    if (have && have.length) {
      names = names.filter(function (n) {
        return have.indexOf(n) >= 0;
      });
    }
    return names.map(function (n) {
      return "images/" + encodeURIComponent(n);
    });
  }

  /* ---------------------------------------------------------------- */
  /* Stored schema                                                     */
  /* ---------------------------------------------------------------- */

  /* Bumping SCHEMA and adding a step here is the only supported way to change
   * the shape of what is stored. There used to be a `version` field that
   * nothing ever read, so any rename would have silently dropped data. */
  var SCHEMA = 3;

  function migrate(raw, program) {
    var s = raw && typeof raw === "object" ? raw : {};
    /* An empty store is already current — there is no old shape to convert, and
     * reporting a migration would show the user a notice about nothing. */
    var fresh = !raw || typeof raw !== "object" || !Object.keys(raw).length;
    var from = fresh ? SCHEMA : typeof s.version === "number" ? s.version : 1;
    var notes = [];

    if (from < 2) {
      /* v1 stored one rep range per exercise. Ranges can now differ per level,
       * so a target saved against the exercise-wide range can sit below the
       * range of the level it actually belongs to. */
      var es = s.exerciseState || {};
      Object.keys(es).forEach(function (id) {
        var ex = program && program.exercises && program.exercises[id];
        if (!ex || !es[id] || typeof es[id].target !== "number") return;
        var r = rung(ex, es[id].level || 0);
        if (es[id].target < r.range[0]) {
          notes.push(ex.name + ": target " + es[id].target + " → " + r.range[0]);
          es[id].target = r.range[0];
        }
      });
    }

    if (from < 3) {
      /* v2 froze the prescription into the running session — level, target, the
       * vest, and a number on every set including the ones not yet done. The
       * entry is a log now: null means "follow the plan". Numbers already on
       * screen are kept as deliberate overrides rather than moved under a
       * session in progress, so this is invisible and needs no note. */
      var a = s.active;
      if (a && a.entries) {
        Object.keys(a.entries).forEach(function (id) {
          var e = a.entries[id];
          if (!e || typeof e !== "object") return;
          delete e.level;
          delete e.target;
          if (typeof e.vest !== "number") e.vest = null;
          (e.sets || []).forEach(function (st) {
            if (typeof st.value !== "number") st.value = null;
            if (typeof st.load !== "number") st.load = null;
          });
        });
      }
    }

    s.version = SCHEMA;
    return { state: s, from: from, migrated: from !== SCHEMA, notes: notes };
  }

  /* Which speech voice to use, given the list the browser exposes.
   *
   * A saved choice always wins. Otherwise prefer any English voice that is NOT
   * espeak: it is a formant synthesiser and sounds like one, and on Linux it is
   * usually first in the list — so without this rule, installing a better
   * engine would change nothing. Non-English voices are never used; they read
   * the exercise names with the wrong phonetics. */
  function preferredVoice(voices, savedName) {
    var vs = (voices || []).filter(function (v) {
      return v && /^en/i.test(v.lang || "");
    });
    if (!vs.length) return null;
    if (savedName) {
      for (var i = 0; i < vs.length; i++) if (vs[i].name === savedName) return vs[i];
    }
    for (var j = 0; j < vs.length; j++) if (!/espeak/i.test(vs[j].name || "")) return vs[j];
    return vs[0];
  }

  /* ---------------------------------------------------------------- */
  /* Phase & scheduling                                                */
  /* ---------------------------------------------------------------- */

  var DAY_MS = 86400000;

  function weeksBetween(startISO, endISO) {
    if (!startISO) return 0;
    var a = Date.parse(startISO);
    var b = Date.parse(endISO);
    if (isNaN(a) || isNaN(b)) return 0;
    return Math.max(0, (b - a) / DAY_MS / 7);
  }

  /* A phase unlocks only when BOTH the session count and the elapsed weeks are
   * satisfied. Nine sessions crammed into ten days is not a completed
   * reintroduction phase — connective tissue adapts on the calendar. */
  function phaseFor(opts) {
    var phases = opts.phases;
    if (opts.override) {
      for (var i = 0; i < phases.length; i++) {
        if (phases[i].id === opts.override) return phases[i];
      }
    }
    var chosen = phases[0];
    for (var j = 0; j < phases.length; j++) {
      var p = phases[j];
      if (opts.sessionCount >= p.minSessions && opts.weeksElapsed >= p.minWeeks) chosen = p;
    }
    return chosen;
  }

  /* What it would take to reach the next phase. Returns null at the last one. */
  function phaseGap(opts) {
    var phases = opts.phases;
    var current = phaseFor(opts);
    var next = null;
    for (var i = 0; i < phases.length; i++) {
      if (phases[i].id === current.id + 1) next = phases[i];
    }
    if (!next) return null;
    return {
      phase: next,
      sessionsShort: Math.max(0, next.minSessions - opts.sessionCount),
      weeksShort: Math.max(0, next.minWeeks - opts.weeksElapsed),
    };
  }

  function nextWorkout(sessions) {
    for (var i = sessions.length - 1; i >= 0; i--) {
      if (sessions[i] && sessions[i].workout) return sessions[i].workout === "A" ? "B" : "A";
    }
    return "A";
  }

  root.Progression = {
    DEFAULT_RULES: DEFAULT_RULES,
    SCHEMA: SCHEMA,
    rung: rung,
    initialState: initialState,
    normalizeState: normalizeState,
    target: target,
    evaluate: evaluate,
    migrate: migrate,
    phaseFor: phaseFor,
    phaseGap: phaseGap,
    nextWorkout: nextWorkout,
    timeline: timeline,
    estimate: estimate,
    restForId: restForId,
    nextUp: nextUp,
    fit: fit,
    imageCandidates: imageCandidates,
    droppableSets: droppableSets,
    preferredVoice: preferredVoice,
    weeksBetween: weeksBetween,
    maxLevel: maxLevel,
    usesVest: usesVest,
    fmtKg: fmtKg,
    roundKg: roundKg,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
