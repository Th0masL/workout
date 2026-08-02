/* Audible cues — the beep, the spoken announcement, and the rules about when
 * each is allowed to go out.
 *
 * Split out of app.js because it was the only part of the app with no tests at
 * all, and not by accident: the state it depends on (when the output was last
 * used, when the last tone finishes, which voice got resolved) lived in
 * closure variables with no way in. Everything here that is a RULE now takes
 * its clock and its output device as arguments, so a test can watch what would
 * have been emitted and when.
 *
 * The rules, all of which were learned the hard way on a real phone:
 *
 *   1. Bluetooth output idles between sounds and swallows the first few hundred
 *      milliseconds while the link wakes up — the first beep of a set is lost
 *      and "Ring dips" arrives as "ing dips". So an inaudible tone goes out
 *      ahead of anything that matters and the real sound is held back behind it.
 *   2. The hold-back is applied even when the primer is skipped, so a run of
 *      cues stays evenly spaced instead of the first one jumping ahead.
 *   3. Speech goes through the platform, not through our AudioContext, so it
 *      cannot be scheduled — it has to be delayed by hand, and it has to wait
 *      for any tone already scheduled or the two play over each other.
 *   4. The voice is resolved at speak time, not once at startup. Firefox often
 *      has voices ready before we ask and then never fires voiceschanged, which
 *      would leave the choice null forever and let the platform pick.
 */
(function (root) {
  "use strict";

  var WARM_FOR_MS = 2500; // how long a wake is assumed to last
  var DEFAULT_WARMUP_MS = 600;
  var TONE_GAIN = 0.25;
  var PRIMER_GAIN = 0.004; // a real signal for the codec, still far below audible
  var PRIMER_HZ = 120;

  /* ---------------------------------------------------------------- */
  /* The device                                                        */
  /* ---------------------------------------------------------------- */

  /* Everything below this comment is two browser APIs and nothing else. All
   * the decisions are above it, in create(). */
  function browserDevice(win) {
    var ctx = null;

    function context() {
      if (!ctx) {
        var Ctor = win.AudioContext || win.webkitAudioContext;
        if (!Ctor) return null;
        ctx = new Ctor();
      }
      /* Browsers suspend an idle context; a suspended one drops what you
       * schedule at it, silently. */
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    }

    return {
      /* delay and dur in seconds, relative to now. */
      tone: function (freq, delay, dur, gain) {
        try {
          var c = context();
          if (!c) return;
          var o = c.createOscillator();
          var g = c.createGain();
          o.connect(g);
          g.connect(c.destination);
          o.frequency.value = freq;
          var t = c.currentTime + delay;
          if (gain <= PRIMER_GAIN) {
            /* The primer is meant to be flat and inaudible — an envelope on it
             * would defeat the point, which is a steady signal for the codec. */
            g.gain.value = gain;
            o.start(t);
            o.stop(t + dur);
            return;
          }
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
          o.start(t);
          o.stop(t + dur + 0.01);
        } catch (e) {
          /* silent */
        }
      },

      speak: function (text, voice) {
        try {
          var u = new win.SpeechSynthesisUtterance(text);
          if (voice) u.voice = voice;
          u.lang = (voice && voice.lang) || "en-GB";
          u.rate = 1.05;
          win.speechSynthesis.cancel();
          win.speechSynthesis.speak(u);
        } catch (e) {
          /* silent */
        }
      },

      /* null means the browser has no speech support at all; [] means it has
       * the API but no voices behind it — Chrome on Linux does not bridge to
       * speech-dispatcher, so speak() there is a silent no-op. The difference
       * matters because the UI has to say which one it is. */
      voices: function () {
        if (!win.speechSynthesis) return null;
        return win.speechSynthesis.getVoices() || [];
      },

      onVoicesChanged: function (fn) {
        if (win.speechSynthesis && win.speechSynthesis.addEventListener) {
          win.speechSynthesis.addEventListener("voiceschanged", fn);
        }
      },

      wake: function () {
        context();
      },

      /* iOS refuses to speak later unless speech was first invoked from a
       * gesture, so an empty utterance is pushed through on the first tap. */
      nudgeSpeech: function () {
        try {
          if (win.speechSynthesis) win.speechSynthesis.speak(new win.SpeechSynthesisUtterance(""));
        } catch (e) {
          /* silent */
        }
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /* The rules                                                         */
  /* ---------------------------------------------------------------- */

  /* opts: {device, window, now, settings, preferredVoice, schedule}
   * `settings` is a function so the live object is read at each call rather
   * than captured once — the user can change the sound mode mid-session. */
  function create(opts) {
    var o = opts || {};
    var device = o.device || browserDevice(o.window || root);
    var now = o.now || function () { return Date.now(); };
    var readSettings = o.settings || function () { return {}; };
    var schedule = o.schedule || function (fn, ms) { return setTimeout(fn, ms); };
    var choose =
      o.preferredVoice ||
      function (vs) { return vs && vs.length ? vs[0] : null; };

    /* null, not 0: "never used" has to be its own state. Comparing a sentinel
     * zero against the clock only looks stale because the clock happens to be a
     * large epoch number — the very first cue after opening the app is the one
     * that most needs a primer, and it would have skipped it under any clock
     * counting from zero. */
    var lastAudioAt = null;
    var busyUntil = 0; // when the last scheduled tone finishes
    var voice = null;
    var nudged = false;

    function settings() {
      return readSettings() || {};
    }

    /* Every call into the device is guarded. The browser device already catches
     * its own failures, but beep() is called from the one-second interval that
     * also drives the hold and rest clocks — one throw from a device that does
     * not catch, and a missing sound becomes a frozen session timer. */
    function safely(fn, fallback) {
      try {
        return fn();
      } catch (e) {
        return fallback;
      }
    }

    function mode() {
      var m = settings().sound;
      return m === undefined ? "voice" : m;
    }

    function warmMs() {
      var n = settings().audioWarmupMs;
      return typeof n === "number" && n >= 0 ? n : DEFAULT_WARMUP_MS;
    }

    /* Emits the primer if the output has gone cold, and returns how long the
     * real sound must be held back — in seconds, and returned whether or not
     * the primer actually went out. */
    function warmUp() {
      var ms = warmMs();
      if (!ms) return 0;
      var stale = lastAudioAt === null || now() - lastAudioAt > WARM_FOR_MS;
      lastAudioAt = now();
      if (stale) safely(function () { device.tone(PRIMER_HZ, 0, ms / 1000 + 0.06, PRIMER_GAIN); });
      return ms / 1000;
    }

    function beep(freq, dur) {
      if (mode() === "off") return 0;
      var d = dur || 0.35;
      var lead = warmUp();
      /* Recorded so speech can queue behind it rather than over it. */
      busyUntil = now() + (lead + d) * 1000;
      safely(function () { device.tone(freq || 880, lead, d, TONE_GAIN); });
      return lead;
    }

    function deviceVoices() {
      return safely(function () { return device.voices(); }, null);
    }

    function voices() {
      var all = deviceVoices();
      if (!all) return [];
      return all.filter(function (v) {
        return v && /^en/i.test(v.lang || "");
      });
    }

    function pick() {
      var all = deviceVoices();
      if (!all) return null;
      return safely(function () { return choose(all, settings().voiceName); }, null);
    }

    function status() {
      var all = deviceVoices();
      if (!all) return "unsupported";
      return all.length ? "ready" : "novoices";
    }

    function say(text) {
      if (mode() !== "voice" || !text || deviceVoices() === null) return 0;
      var lead = Math.max(warmUp() * 1000, busyUntil - now() + 60);
      schedule(function () {
        if (!voice) voice = pick();
        safely(function () { device.speak(text, voice); });
      }, lead);
      return lead;
    }

    /* Called from a real tap. Browsers will not start audio without one. */
    function prime() {
      safely(function () { device.wake(); });
      if (!nudged) {
        nudged = true;
        safely(function () { device.nudgeSpeech(); });
      }
    }

    return {
      beep: beep,
      say: say,
      warmupMs: warmMs,
      prime: prime,
      voices: voices,
      status: status,
      current: function () {
        return voice;
      },
      /* Re-resolve after a settings change, or when the browser finally
       * delivers its voice list. */
      refresh: function () {
        voice = pick();
        return voice;
      },
      onVoicesChanged: function (fn) {
        safely(function () { device.onVoicesChanged(function () {
          var had = !!voice;
          voice = pick();
          fn(had, voice);
        }); });
      },
      /* Forces the next cue to emit a primer, for the settings-page test. */
      cool: function () {
        lastAudioAt = null;
      },
    };
  }

  root.Cues = { create: create, browserDevice: browserDevice, WARM_FOR_MS: WARM_FOR_MS };
})(typeof self !== "undefined" ? self : this);
