// audio.js on its own, with a device that records instead of making noise.
//
//   Run:  node tests/audio.test.mjs
//
// This whole file exists because the rules below cost more debugging than
// anything else in the app — a beep swallowed by a sleeping Bluetooth link, a
// tone and a spoken cue landing on top of each other, a voice that silently
// stayed null and let the platform pick a French one — and none of them had a
// single assertion until the policy was pulled out of app.js and given its
// clock and its output device as arguments.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { check, section, report } from './harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');


const ctx = { console };
ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(join(root, 'progression.js'), 'utf8'), ctx);
vm.runInContext(readFileSync(join(root, 'audio.js'), 'utf8'), ctx);
const { Cues } = ctx;
const { preferredVoice } = ctx.Progression;

const V = (name, lang) => ({ name, lang });
const ALAN = V('Alan', 'en-GB'), ESPEAK = V('espeak-ng', 'en-US'), FR = V('Amelie', 'fr-FR');

/** A speaker that writes down what it was asked to do instead of doing it. */
function rig({ settings = {}, voices = [ALAN], start = 1000 } = {}) {
  const log = { tones: [], spoken: [], woken: 0, nudged: 0, pending: [] };
  const clock = { t: start };
  const device = {
    tone: (freq, delay, dur, gain) => log.tones.push({ freq, delay, dur, gain, at: clock.t }),
    speak: (text, voice) => log.spoken.push({ text, voice: voice ? voice.name : null, at: clock.t }),
    voices: () => voices,
    onVoicesChanged: (fn) => { log.voicesChanged = fn; },
    wake: () => { log.woken++; },
    nudgeSpeech: () => { log.nudged++; },
  };
  const cues = Cues.create({
    device,
    now: () => clock.t,
    settings: () => settings,
    preferredVoice,
    schedule: (fn, ms) => log.pending.push({ fn, due: clock.t + ms, delay: ms }),
  });
  return {
    cues, log, settings,
    /* Advance the clock and run anything that has come due. */
    advance(ms) {
      clock.t += ms;
      const due = log.pending.filter((p) => p.due <= clock.t);
      log.pending = log.pending.filter((p) => p.due > clock.t);
      due.forEach((p) => p.fn());
    },
    /** Everything audible, in the order it would actually be heard. */
    audible: () => log.tones.filter((t) => t.gain > 0.01),
    primers: () => log.tones.filter((t) => t.gain <= 0.01),
  };
}

// ---------------------------------------------------------------- //
section('Waking a sleeping Bluetooth link');

// The symptom this exists for: headphones idle between cues and swallow the
// first few hundred milliseconds while the link comes back.
let r = rig();
r.cues.beep();
check('an inaudible primer goes out first', r.primers().length, 1);
check('at a frequency low enough not to be heard', r.primers()[0].freq, 120);
check('but with a real signal level for the codec', r.primers()[0].gain > 0, true);
check('and it starts immediately', r.primers()[0].delay, 0);
check('the audible tone is held back behind it', r.audible()[0].delay, 0.6);
check('and it is the one you can actually hear', r.audible()[0].gain, 0.25);

// The hold-back is unconditional; only the primer is skipped. Without that,
// a run of cues would have the first one lag and the rest jump ahead.
r = rig();
r.cues.beep();
r.advance(500);
r.cues.beep(660);
check('a cue close behind another skips the primer', r.primers().length, 1);
check('but is still delayed by the same amount', r.audible()[1].delay, 0.6);
check('so the spacing between cues stays even',
  r.audible().map((t) => t.delay), [0.6, 0.6]);

// Once the output has gone quiet for long enough, assume it has slept again.
r = rig();
r.cues.beep();
r.advance(Cues.WARM_FOR_MS + 1);
r.cues.beep();
check('a cue after a long gap primes again', r.primers().length, 2);

// The lead-in is configurable, down to off for wired or built-in speakers.
r = rig({ settings: { audioWarmupMs: 1500 } });
r.cues.beep();
check('a longer lead-in is honoured', r.audible()[0].delay, 1.5);
r = rig({ settings: { audioWarmupMs: 0 } });
r.cues.beep();
check('zero means no primer at all', r.primers().length, 0);
check('and no delay either', r.audible()[0].delay, 0);
check('the default is used when the setting is absent', rig().cues.warmupMs(), 600);
check('and when it is nonsense',
  rig({ settings: { audioWarmupMs: 'soon' } }).cues.warmupMs(), 600);

// ---------------------------------------------------------------- //
section('Speech queues behind a tone, never over it');

// Both used to be fired at once and arrived on top of each other.
r = rig();
r.cues.beep();
r.cues.say('Ring dips, set two');
check('the tone is scheduled first', r.audible().length, 1);
check('nothing is spoken yet', r.log.spoken.length, 0);
const beepEnds = 600 + 350; // lead + duration
check('speech waits for the tone to finish, plus a margin',
  r.log.pending[0].delay > beepEnds, true);
r.advance(r.log.pending[0].delay);
check('then it speaks', r.log.spoken.map((s) => s.text), ['Ring dips, set two']);

// Speech on its own still waits for the primer — it goes through the platform,
// not through our AudioContext, so it cannot be scheduled with a delay.
r = rig();
r.cues.say('Dead hang');
check('a lone announcement is held back by the lead-in', r.log.pending[0].delay, 600);
r.advance(600);
check('and then goes out', r.log.spoken.length, 1);
check('having primed the output first', r.primers().length, 1);

// ---------------------------------------------------------------- //
section('The sound setting is obeyed');

r = rig({ settings: { sound: 'off' } });
r.cues.beep();
r.cues.say('anything');
r.advance(5000);
check('silent means silent — no tone', r.log.tones.length, 0);
check('and nothing spoken', r.log.spoken.length, 0);

r = rig({ settings: { sound: 'beep' } });
r.cues.beep();
r.cues.say('anything');
r.advance(5000);
check('beep-only still beeps', r.audible().length, 1);
check('but says nothing', r.log.spoken.length, 0);

r = rig({ settings: { sound: 'voice' } });
r.cues.say('Ring rows');
r.advance(5000);
check('voice mode speaks', r.log.spoken.length, 1);
check('an empty string is not worth an utterance',
  (() => { const q = rig(); q.cues.say(''); q.advance(5000); return q.log.spoken.length; })(), 0);

// The mode is read at each call, not captured once — it can be changed from the
// Data tab in the middle of a session.
const live = rig({ settings: { sound: 'voice' } });
live.cues.say('one');
live.advance(5000);
live.settings.sound = 'off';
live.cues.say('two');
live.advance(5000);
check('changing the setting mid-session takes effect immediately',
  live.log.spoken.map((s) => s.text), ['one']);

// ---------------------------------------------------------------- //
section('Choosing a voice');

// It used to be resolved once at startup. Firefox often has voices ready
// before that and then never fires voiceschanged, so the choice stayed null
// and the platform picked — which is how the announcements came out female
// and French-accented on a machine with an English voice installed.
r = rig({ voices: [ESPEAK, ALAN] });
check('nothing is resolved before the first cue', r.cues.current(), null);
r.cues.say('Ring dips');
r.advance(5000);
check('it resolves at speak time', r.log.spoken[0].voice, 'Alan');
check('and is remembered afterwards', r.cues.current().name, 'Alan');

r = rig({ voices: [ESPEAK, ALAN], settings: { voiceName: 'espeak-ng' } });
r.cues.say('x');
r.advance(5000);
check('a saved choice wins', r.log.spoken[0].voice, 'espeak-ng');

r = rig({ voices: [FR] });
r.cues.say('x');
r.advance(5000);
check('a non-English voice is never chosen', r.log.spoken[0].voice, null);

// Which of the three states the browser is in has to be reported honestly,
// because two of them mean the announcements will not be heard.
check('voices present is ready', rig({ voices: [ALAN] }).cues.status(), 'ready');
check('the API with no voices behind it says so',
  rig({ voices: [] }).cues.status(), 'novoices');
check('no speech support at all is different again',
  rig({ voices: null }).cues.status(), 'unsupported');
check('and an unsupported browser is never asked to speak',
  (() => { const q = rig({ voices: null }); q.cues.say('x'); q.advance(5000); return q.log.spoken.length; })(),
  0);
check('the settings list offers only English voices',
  rig({ voices: [FR, ALAN, ESPEAK] }).cues.voices().map((v) => v.name), ['Alan', 'espeak-ng']);
check('and is empty rather than null when there is no support',
  rig({ voices: null }).cues.voices(), []);

// The Data tab redraws when the browser finally delivers its list.
// A browser that delivers its voice list late has to be picked up, or the
// Data tab keeps claiming there are none.
let late = [];
const arriving = rig({ voices: [] });
arriving.log.voices = late;
const lateRig = Cues.create({
  device: {
    tone() {}, speak(t, v) { late.spokeWith = v && v.name; },
    voices: () => late,
    onVoicesChanged(fn) { late.notify = fn; },
    wake() {}, nudgeSpeech() {},
  },
  now: () => 0, settings: () => ({}), preferredVoice, schedule: (fn) => fn(),
});
let told = null;
lateRig.onVoicesChanged((had, v) => { told = { had, name: v && v.name }; });
check('a browser with no voices yet reports none', lateRig.status(), 'novoices');
late.push(ALAN);
late.notify();
check('when they arrive the choice is made', told, { had: false, name: 'Alan' });
check('and the status flips', lateRig.status(), 'ready');
lateRig.say('Ring rows');
check('and that voice is the one used', late.spokeWith, 'Alan');

// ---------------------------------------------------------------- //
section('Priming from a tap');

r = rig();
check('nothing is woken before the first tap', r.log.woken, 0);
r.cues.prime();
check('a tap wakes the audio context', r.log.woken, 1);
// iOS refuses to speak later unless speech was first invoked from a gesture.
check('and nudges speech once', r.log.nudged, 1);
r.cues.prime();
r.cues.prime();
check('the context is woken every time', r.log.woken, 3);
check('but speech is only nudged once', r.log.nudged, 1);

// Changing the lead-in from the settings page must demonstrate the new value,
// even if a cue happened a moment ago.
r = rig();
r.cues.beep();
check('one primer so far', r.primers().length, 1);
r.cues.cool();
r.cues.beep();
check('cooling forces the next cue to prime again', r.primers().length, 2);

// ---------------------------------------------------------------- //
section('A broken device never breaks the app');

const dead = Cues.create({
  device: {
    tone() { throw new Error('no audio hardware'); },
    speak() { throw new Error('speech died'); },
    voices: () => [ALAN],
    onVoicesChanged() {},
    wake() { throw new Error('no context'); },
    nudgeSpeech() { throw new Error('nope'); },
  },
  now: () => 0,
  settings: () => ({}),
  preferredVoice,
  schedule: (fn) => fn(),
});
for (const [label, fn] of [
  ['a tone that throws', () => dead.beep()],
  ['speech that throws', () => dead.say('x')],
  ['priming that throws', () => dead.prime()],
]) {
  try { fn(); check(label + ' is survivable', 'ok', 'ok'); }
  catch (e) { check(label + ' is survivable', `threw: ${e.message}`, 'ok'); }
}

// ---------------------------------------------------------------- //
report();
