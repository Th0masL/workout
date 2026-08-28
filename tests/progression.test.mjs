// Validates the progression engine. progression.js is loaded verbatim into an
// isolated VM context — no duplicated logic, nothing to drift.
//
//   Run:  node tests/progression.test.mjs
//
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { check, section, report } from './harness.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const ctx = { console };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(join(root, 'progression.js'), 'utf8'), ctx);

// data/program.js assigns to window.PROGRAM.
const win = {};
vm.runInContext('var window = ' + 'globalThis.__win;', Object.assign(ctx, { __win: win }));
vm.runInContext(readFileSync(join(root, 'data', 'program.js'), 'utf8'), ctx);

const P = win.PROGRAM;
const PR = ctx.Progression;


const PHASE1 = P.phases[0];
const PHASE2 = P.phases[1];
const PHASE3 = P.phases[2];

// A pull-up: 3 sets, 6-8 reps, 3-rung ladder, vest after that.
const pullup = P.exercises['ring-pullup'];

/** Log `n` sets of `v` reps at `load` kg. */
const sets = (n, v, load = 0) => Array.from({ length: n }, () => ({ value: v, load }));

/** Run one session through the engine. */
function run(ex, state, logged, phase = PHASE3, entry = null) {
  return PR.evaluate({ exercise: ex, state, sets: logged, phase, rules: P.rules, entry });
}

// ---------------------------------------------------------------- //
section('Program data integrity');

check('every workout entry resolves to an exercise',
  Object.values(P.workouts).flatMap(w => w.order).filter(o => !P.exercises[o.id]).map(o => o.id), []);
check('every exercise sits in a known station',
  Object.values(P.exercises).filter(e => !P.stations[e.station]).map(e => e.name), []);
check('every exercise has a non-empty ladder',
  Object.entries(P.exercises).filter(([, e]) => !e.ladder || !e.ladder.length).map(([k]) => k), []);
check('every exercise has range[0] <= range[1]',
  Object.entries(P.exercises).filter(([, e]) => e.range[0] > e.range[1]).map(([k]) => k), []);
check('every exercise has cues and a rationale',
  Object.entries(P.exercises).filter(([, e]) => !e.cues?.length || !e.why).map(([k]) => k), []);
// The amber stripe on a card is meaningless unless the card says why it is
// there, and a caution with no stripe would go unnoticed.
check('the warn stripe and the caution text always travel together',
  Object.entries(P.exercises).filter(([, e]) => !!e.warn !== !!e.caution).map(([k]) => k), []);
// An exercise needs a CAPABILITY, not an object. "rings" was the wrong unit: a
// dead hang needs something overhead to hang from and a park bar does fine,
// while a feet-assisted pull-up needs that something to be at a height you
// choose — which only the rings give.
const CAPS = [...new Set(Object.values(P.equipment).flatMap(e => e.provides))];
check('every exercise declares what it needs',
  Object.entries(P.exercises).filter(([, e]) => !Array.isArray(e.needs)).map(([k]) => k), []);
check('every level declares what it needs',
  Object.entries(P.exercises).flatMap(([id, e]) =>
    e.ladder.map((_, i) => [id, i]).filter(([, i]) => !Array.isArray(PR.rung(e, i).needs))
      .map(([k, i]) => k + ':L' + (i + 1))), []);
check('and every capability is one some equipment provides',
  Object.entries(P.exercises).flatMap(([id, e]) =>
    e.ladder.flatMap((_, i) => PR.rung(e, i).needs)
      .filter(c => !CAPS.includes(c)).map(c => id + ':' + c)), []);
check('no requirement names a piece of equipment by name',
  Object.entries(P.exercises).flatMap(([id, e]) =>
    e.ladder.flatMap((_, i) => PR.rung(e, i).needs)
      .filter(c => P.equipment[c]).map(c => id + ':' + c)), []);
// The push-up bars add RANGE; they are not a requirement. Requiring them meant
// a park had no horizontal push at all, which is absurd — the body position is
// the load, and raised hands just let the chest travel further.
check('a push-up needs nothing until the furniture rungs',
  P.exercises.pushup.ladder.map((_, i) => PR.rung(P.exercises.pushup, i).needs.join('+')),
  ['', '', 'step-20', 'step-45', 'handles-low']);
check('and a pike push-up only needs the bars for the deficit rung',
  P.exercises['pike-pushup'].ladder.map((_, i) => PR.rung(P.exercises['pike-pushup'], i).needs.join('+')),
  ['', 'step-20', 'step-45', 'handles-floor+step-45']);
// A capability nothing in a place provides is a real gap; an exercise you
// cannot do there usually is not, because something else trains the same thing.
check('the requirement is on the level that genuinely needs it',
  PR.rung(P.exercises['pike-pushup'], 0).needs, []);
// Feet-assisted rungs need a height you can CHOOSE; bodyweight ones do not.
check('assisted pull-up rungs need an adjustable bar, bodyweight ones do not',
  P.exercises['ring-pullup'].ladder.map((_, i) => PR.rung(P.exercises['ring-pullup'], i).needs[0]),
  ['hang-high-adjustable', 'hang-high-adjustable', 'hang-high']);
check('every exercise has a demo search term',
  Object.entries(P.exercises).filter(([, e]) => !e.search).map(([k]) => k), []);
// The search must use the name the movement is commonly known by, not ours —
// searching "ring leg curl" finds far less than "TRX hamstring curl".
check('the leg curl searches under its common name',
  /trx hamstring curl/i.test(P.exercises['ring-leg-curl'].search), true);
check('search terms are plain text, safe to URL-encode',
  Object.entries(P.exercises).filter(([, e]) => /[<>"']/.test(e.search)).map(([k]) => k), []);

// A duplicate key in an object literal is silent — the last one simply wins —
// so a bad edit can leave a stale exercise shadowing its replacement. Count the
// declarations in the source and compare against the parsed object.
const src = readFileSync(join(root, 'data', 'program.js'), 'utf8');
const declaredKeys = [...src.matchAll(/^    "?([a-z][a-z-]*)"?: \{$/gm)].map(m => m[1]);
const dupes = declaredKeys.filter((k, i) => declaredKeys.indexOf(k) !== i);
check('no exercise or station is declared twice', dupes, []);

// The whole point of the design: ring adjustments stay few and one-directional.
// stationOrder is also the physical order the rings descend, so asserting that
// a workout's stations follow it is asserting the rings never travel back up.
for (const [key, w] of Object.entries(P.workouts)) {
  const stationsHit = P.stationOrder.filter(s =>
    w.order.some(o => P.exercises[o.id].station === s));
  const adjustments = stationsHit.filter(s => P.stations[s].adjust).length;
  check(`workout ${key} keeps ring adjustments to 3 or fewer`, adjustments <= 3, true);
  check(`workout ${key} moves the rings downward only`,
    stationsHit.join('>'), stationsHit.slice().sort(
      (a, b) => P.stationOrder.indexOf(a) - P.stationOrder.indexOf(b)).join('>'));
}
// The station is a per-LEVEL property now — assisted ring dips need the rings
// low enough to reach the floor — so the adjustment count depends on where you
// are, and asserting it statically would assert something untrue.
const adjAt = (k, dipLevel) => P.stationOrder.filter(s => P.stations[s].adjust &&
  P.workouts[k].order.some(o => {
    const e = P.exercises[o.id];
    return (o.id === 'ring-dip' ? PR.rung(e, dipLevel).station : e.station) === s;
  })).length;
const topDip = P.exercises['ring-dip'].ladder.length - 1;
check('once dipping unassisted, the pull day is back to 2 adjustments', adjAt('A', topDip), 2);
check('and the push day to 3, for the leg curl', adjAt('B', topDip), 3);
// While you still need the legs, the rings have to come down for the dip and
// that costs one more move. It is a real cost, and it goes away by itself.
check('while assisted, each day pays one extra', [adjAt('A', 0), adjAt('B', 0)], [3, 4]);
check('and the extra one is the dip station',
  P.exercises['ring-dip'].ladder.filter(l => l.station === 'rings-dip').length, 3);
// The assisted levels all start SEATED, which is what makes the floor the depth
// stop — "no deeper than parallel" enforces itself instead of being a rule.
check('every assisted level starts seated',
  P.exercises['ring-dip'].ladder.filter(l => l.station === 'rings-dip')
    .filter(l => !/^Seated,/.test(l.name)), []);
// The ladder ends with DEPTH, and depth comes before the vest — which is what
// "range before load" has to mean if it means anything.
const dip = P.exercises['ring-dip'];
check('the last rung is the deeper range, not more weight',
  dip.ladder.map(l => l.name).slice(-1), ['Bodyweight, below parallel']);
check('and nothing on the ladder is an L-sit',
  dip.ladder.filter(l => /L-sit/.test(l.name)), []);
check('the reason it is not is written where it will be found',
  /L-sit/.test(dip.note), true);

// That rung is held shut until Phase 3 — six weeks of calendar time, not just
// sessions, before the shoulder sees the bottom of the range at bodyweight.
check('the depth rung is gated on Phase 3', PR.rung(dip, 4).minPhase, 3);
check('and it is the only gated rung in the program',
  Object.entries(P.exercises).flatMap(([id, e]) =>
    e.ladder.map((_, i) => [id, i, PR.rung(e, i).minPhase]).filter(([, , m]) => m)
      .map(([k, i]) => k + ':L' + (i + 1))),
  ['ring-dip:L5']);

const atTop = { level: 3, vest: 0, target: 8, topOutStreak: 1, failStreak: 0 };
const held = run(dip, atTop, sets(3, 8), PHASE2);
check('topping out in Phase 2 holds you at parallel', held.state.level, 3);
check('and does NOT skip ahead to the vest', held.state.vest, 0);
check('saying what is waiting and when', /opens in Phase 3/.test(held.events[0].text), true);
check('but the promotion is banked', held.state.topOutStreak, P.rules.topOutSessions);
const opened = run(dip, held.state, sets(3, 8), PHASE3);
check('and cashes in the moment Phase 3 arrives', opened.state.level, 4);
check('with the reps reset, because a deeper dip is a harder dip', opened.state.target, 6);
check('only THEN does the vest come on',
  run(dip, { level: 4, vest: 0, target: 8, topOutStreak: 1, failStreak: 0 }, sets(3, 8), PHASE3)
    .state.vest, P.rules.vestFirstKg);
// The card has to be able to say why the ladder appears to stop.
check('target() names the gate it is waiting on',
  PR.target(dip, { level: 3, vest: 0, target: 8 }, PHASE2, null).nextGate,
  { name: 'Bodyweight, below parallel', phase: 3 });
check('and stops mentioning it once open',
  PR.target(dip, { level: 3, vest: 0, target: 8 }, PHASE3, null).nextGate, null);
// Hands at your SIDES, never behind you: that is the whole reason this is on
// rings rather than on a chair, and it is what keeps the shoulder out of
// extension-plus-internal-rotation.
check('and says so, on the level you meet first',
  /at your SIDES/.test(PR.rung(P.exercises['ring-dip'], 0).cues.join(' ')), true);
// The progression is raising the heels, so each step asks for a taller one.
check('the assist steps up through the two chairs',
  P.exercises['ring-dip'].ladder.slice(0, 3)
    .map((_, i) => PR.rung(P.exercises['ring-dip'], i).needs.join('+')),
  ['dip-support-adjustable', 'dip-support-adjustable+step-20',
   'dip-support-adjustable+step-45']);
// And the bodyweight rungs drop the adjustable requirement, which is what makes
// them possible on a fixed pair of parallel bars in a park.
check('bodyweight dips only need a pair of supports',
  [3, 4].map(i => PR.rung(P.exercises['ring-dip'], i).needs), [['dip-support'], ['dip-support']]);
// Nothing but the leg curl needs the rings at their very lowest.
check('only the leg curl uses the low station',
  Object.entries(P.exercises).filter(([, e]) => e.station === 'rings-low').map(([k]) => k),
  ['ring-leg-curl']);
// Every station a level names has to exist and sit in the order.
check('every level station is a real one, in stationOrder',
  Object.entries(P.exercises).flatMap(([id, e]) => e.ladder
    .map((_, i) => PR.rung(e, i).station)
    .filter(st => !P.stations[st] || P.stationOrder.indexOf(st) < 0)
    .map(st => id + ':' + st)), []);

// ---------------------------------------------------------------- //
section('Installable app shell');

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const tokens = readFileSync(join(root, 'tokens.css'), 'utf8');

check('manifest launches standalone', manifest.display, 'standalone');
check('manifest declares a maskable icon',
  manifest.icons.some(i => i.purpose === 'maskable'), true);
check('every manifest icon file exists',
  manifest.icons.filter(i => !existsSync(join(root, i.src))).map(i => i.src), []);
check('index links the manifest and an apple-touch-icon',
  [/rel="manifest"/.test(html), /rel="apple-touch-icon"/.test(html)], [true, true]);
check('Nordic Utility tokens load before component styles',
  html.indexOf('href="tokens.css"') < html.indexOf('href="styles.css"'), true);
check('the existing dark-only theme policy is explicit', /<html[^>]+data-theme="dark"/.test(html), true);
check('the local token copy includes the canonical semantic roles',
  ['--color-bg', '--color-primary', '--color-success', '--color-warning', '--color-danger',
   '--radius-md', '--shadow-md', '--font-sans'].filter(role => !tokens.includes(role)), []);
check('the page ships a restrictive content security policy',
  /Content-Security-Policy/.test(html) && /object-src 'none'/.test(html), true);
check('the app has no inline event or style attributes',
  /\son(?:load|error)=/.test(html + readFileSync(join(root, 'app.js'), 'utf8')) ||
    /<[^>]+\sstyle=/.test(html + readFileSync(join(root, 'app.js'), 'utf8')), false);
check('the apple-touch-icon file exists', existsSync(join(root, 'icons/icon-180.png')), true);

// Both generated lists are checked against disk. A manifest nobody regenerates
// is worse than no manifest: data/images.js going stale hides a picture that is
// right there, and sw.js MEDIA going stale hides it only when offline.
const imagesJs = readFileSync(join(root, 'data', 'images.js'), 'utf8');
const declared = [...imagesJs.matchAll(/^    "([^"]+)",$/gm)].map(m => m[1]);
const filesOnDisk = readdirSync(join(root, 'images'))
  .filter(f => /\.(gif|svg|jpe?g|png|webp)$/i.test(f)).sort();
check('data/images.js lists exactly what is in images/', declared, filesOnDisk);
check('and says how to regenerate it', /tools\/gen-images\.mjs/.test(imagesJs), true);
check('and works in a worker as well as the page', /typeof self/.test(imagesJs), true);

// The worker's MEDIA list is generated from disk and from data/program.js, so it
// drifts the moment an illustration is added or swapped — and the symptom is a
// picture that silently vanishes offline.
const media = [...sw.matchAll(/"(\.\/images\/[^"]+|https:\/\/[^"]+)"/g)].map(m => m[1]);
const onDisk = readdirSync(join(root, 'images')).filter(f => /\.(gif|jpg)$/.test(f)).map(f => './images/' + f);
check('every local illustration is precached',
  onDisk.filter(f => !media.includes(f)), []);
check('nothing precached is missing from disk',
  media.filter(u => u.startsWith('./images/') && !existsSync(join(root, u.slice(2)))), []);
const hotlinks = [...readFileSync(join(root, 'data', 'program.js'), 'utf8')
  .matchAll(/image: "(https:\/\/[^"]+)"/g)].map(m => m[1]);
check('every hotlinked illustration is precached',
  [...new Set(hotlinks)].filter(u => !media.includes(u)), []);
// An <img> handed index.html gets a 200 of HTML, which fails to decode and looks
// identical to a missing file. Only a navigation may fall back to the shell.
check('the shell fallback is limited to navigations',
  /req\.mode === "navigate"/.test(sw) && /status: 504/.test(sw), true);
check('the required shell installs atomically', /return c\.addAll\(SHELL\)/.test(sw), true);
check('old cache cleanup is limited to this app namespace',
  /k\.indexOf\(CACHE_PREFIX\) === 0 \? caches\.delete\(k\)/.test(sw), true);
check('network revalidation preserves the original request',
  /new Request\(req, \{ cache: "no-cache" \}\)/.test(sw), true);
check('a weak connection falls back after a bounded wait',
  /Promise\.race\(\[network, deadline\]\)/.test(sw) && /2500/.test(sw), true);
check('media warming is tied to a service-worker lifetime',
  /type !== "CACHE_MEDIA"/.test(sw) && /e\.waitUntil\(\s*warmMedia\(\)/.test(sw), true);
check('media cache completion is reported back to the page',
  /type: "MEDIA_CACHE_STATUS"/.test(sw) && /e\.source\.postMessage/.test(sw), true);

// Every shell entry the worker precaches must actually be there, or the app
// silently loses offline support for that file.
const shell = [...sw.matchAll(/"\.\/([^"]*)"/g)].map(m => m[1]).filter(Boolean);
check('every precached shell file exists',
  shell.filter(f => !existsSync(join(root, f))), []);
check('the shell covers the scripts index.html actually loads',
  [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]).filter(f => !shell.includes(f)), []);

// The deploy workflow copies files into _site/ by hand. Add a script to the
// page and forget to add it there and the PUBLISHED site breaks while
// everything local keeps working — the one failure this repo cannot reproduce
// on a laptop. So: everything the page loads must be in that copy list.
const deploy = readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8');
const published = new Set();
for (const [, args] of deploy.matchAll(/^ +cp (.+?) _site\/(?:[a-z]*)\/?$/gm)) {
  for (const arg of args.trim().split(/\s+/)) {
    if (!arg.includes('*')) { published.add(arg); continue; }
    // Expand the glob against what is actually on disk.
    const dir = arg.slice(0, arg.lastIndexOf('/'));
    const ext = arg.slice(arg.lastIndexOf('.'));
    for (const f of readdirSync(join(root, dir))) {
      if (f.endsWith(ext)) published.add(dir + '/' + f);
    }
  }
}
check('the deploy workflow copies something', published.size > 10, true);
check('every file index.html loads is published',
  [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1])
    .filter(f => !/^(https?:|#|data:)/.test(f))
    .filter(f => !published.has(f)),
  []);
check('and every file the service worker precaches is too',
  shell.filter(f => f && !published.has(f)), []);
check('including the worker itself, which must sit at the root',
  published.has('sw.js'), true);
// The worker is registered from app.js, not from a tag in the page.
check('nothing published is missing from disk',
  [...published].filter(f => !existsSync(join(root, f))), []);

// ---------------------------------------------------------------- //
section('Rep progression inside the range');

let st = PR.initialState(pullup);
check('starts at level 0, bottom of range, no vest',
  [st.level, st.target, st.vest], [0, 6, 0]);

st = run(pullup, st, sets(3, 6)).state;
check('all sets at target → +1 rep', st.target, 7);
st = run(pullup, st, sets(3, 7)).state;
check('again → +1 rep', st.target, 8);
check('not yet a top-out streak', st.topOutStreak, 0);

// ---------------------------------------------------------------- //
section('Top of range → load increase');

let r = run(pullup, st, sets(3, 8));
check('first time at the top holds the target', [r.state.target, r.state.topOutStreak], [8, 1]);
check('and says so', r.events[0].type, 'hold');

r = run(pullup, r.state, sets(3, 8));
check('second time at the top → ladder level up', r.state.level, 1);
check('and reps reset to the bottom', r.state.target, 6);
check('vest untouched while ladder rungs remain', r.state.vest, 0);
check('event is a level-up', r.events[0].type, 'level');

// Climb to the top of the ladder.
let s2 = { level: 2, vest: 0, target: 8, topOutStreak: 1, failStreak: 0 };
r = run(pullup, s2, sets(3, 8));
check('ladder exhausted → first vest jump is 1 kg', r.state.vest, 1);
check('and reps reset', r.state.target, 6);

s2 = { level: 2, vest: 1, target: 8, topOutStreak: 1, failStreak: 0 };
r = run(pullup, s2, sets(3, 8, 1));
check('subsequent vest jumps are 0.5 kg', r.state.vest, 1.5);

// Microloading must not accumulate float error.
let v = { level: 2, vest: 0, target: 8, topOutStreak: 1, failStreak: 0 };
for (let i = 0; i < 12; i++) {
  v = run(pullup, { ...v, target: 8, topOutStreak: 1 }, sets(3, 8, v.vest)).state;
}
check('12 vest jumps land on an exact 0.5 kg multiple', v.vest, 6.5);
check('and never exceed the vest', v.vest <= P.rules.vestMaxKg, true);

// ---------------------------------------------------------------- //
section('Overshoot skips the wait');

r = run(pullup, { level: 0, vest: 0, target: 8, topOutStreak: 0, failStreak: 0 }, sets(3, 10));
check('8-rep target beaten by 2 → immediate level up', r.state.level, 1);
r = run(pullup, { level: 0, vest: 0, target: 8, topOutStreak: 0, failStreak: 0 }, sets(3, 9));
check('beaten by only 1 → still has to wait', [r.state.level, r.state.topOutStreak], [0, 1]);

// ---------------------------------------------------------------- //
section('Misses and deload');

let m = { level: 1, vest: 0, target: 8, topOutStreak: 0, failStreak: 0 };
r = run(pullup, m, [{ value: 8 }, { value: 8 }, { value: 5 }]);
check('one weak set is a miss', [r.hit, r.state.failStreak], [false, 1]);
check('target is held, not lowered', r.state.target, 8);
r = run(pullup, r.state, sets(3, 5));
check('second miss', r.state.failStreak, 2);
r = run(pullup, r.state, sets(3, 5));
check('third miss → drop a ladder rung', r.state.level, 0);
check('reps reset to the bottom', r.state.target, 6);
check('fail streak clears after the deload', r.state.failStreak, 0);

r = run(pullup, { level: 2, vest: 3, target: 8, topOutStreak: 0, failStreak: 2 }, sets(3, 4, 3));
check('with vest on, deload strips 1 kg before touching the ladder',
  [r.state.vest, r.state.level], [2, 2]);

r = run(pullup, { level: 0, vest: 0, target: 6, topOutStreak: 0, failStreak: 2 }, sets(3, 3));
check('stalled at the easiest level → advice, no negative level',
  [r.state.level, r.events.some(e => e.type === 'deload')], [0, true]);

check('fewer sets than prescribed is not a hit',
  run(pullup, PR.initialState(pullup), sets(2, 8)).hit, false);
check('an unlogged exercise changes nothing',
  run(pullup, PR.initialState(pullup), []).skipped, true);

// ---------------------------------------------------------------- //
section('Load handling');

const target2 = PR.target(pullup, { level: 2, vest: 2, target: 6 }, PHASE3, null);
check('target reports the vest', target2.vest, 2);
check('missing the prescribed vest is a miss',
  run(pullup, { level: 2, vest: 2, target: 6, topOutStreak: 0, failStreak: 0 }, sets(3, 6, 0)).hit,
  false);
// Descending sets are an endorsed technique: open at the target, strip weight.
check('descending sets still count — load is judged on the opening set',
  run(pullup, { level: 2, vest: 2, target: 6, topOutStreak: 0, failStreak: 0 },
    [{ value: 6, load: 2 }, { value: 6, load: 1.5 }, { value: 6, load: 1 }]).hit,
  true);
check('carrying more than prescribed on every set moves the baseline up',
  run(pullup, { level: 2, vest: 2, target: 6, topOutStreak: 0, failStreak: 0 }, sets(3, 6, 3)).state.vest,
  3);

// ---------------------------------------------------------------- //
section('Phase 1 locks load progression');

const p1target = PR.target(pullup, { level: 2, vest: 4, target: 6 }, PHASE1, null);
check('Phase 1 suppresses the vest in the prescription', p1target.vest, 0);
check('and flags that it is being suppressed', p1target.vestSuppressed, true);

r = run(pullup, { level: 0, vest: 0, target: 8, topOutStreak: 1, failStreak: 0 }, sets(3, 8), PHASE1);
check('an earned level-up is withheld in Phase 1', r.state.level, 0);
check('but banked', r.state.topOutStreak, P.rules.topOutSessions);
check('and reported', r.events[0].type, 'locked');
check('the banked increase applies immediately in Phase 2',
  run(pullup, r.state, sets(3, 8), PHASE2).state.level, 1);
check('reps still climb normally in Phase 1',
  run(pullup, { level: 0, vest: 0, target: 6, topOutStreak: 0, failStreak: 0 }, sets(3, 6), PHASE1).state.target,
  7);

// ---------------------------------------------------------------- //
section('Session length');

const TOPTS = { transition: P.time.transition, ringAdjust: P.time.ringAdjust };
const item = (id, sets, work, rest, extra = {}) =>
  ({ id, sets, workSeconds: work, rest, superset: null, trimPriority: 0, minSets: 1, ...extra });

// 3 sets x 30 s work, 90 s rest. A rest follows every round, but the final one
// is dropped — there is nothing left to rest for.
check('estimate is work + rest + transition',
  PR.estimate([item('a', 3, 30, 90)], TOPTS), 90 + 180 + 30);
check('a single set has no rest', PR.estimate([item('a', 1, 30, 90)], TOPTS), 60);
// Two separate exercises carry a rest between them; one exercise does not.
check('a rest is counted between exercises',
  PR.estimate([item('a', 1, 30, 90), item('b', 1, 30, 90)], TOPTS) -
  PR.estimate([item('a', 1, 30, 90)], TOPTS), 60 + 90);
check('zero sets cost nothing', PR.estimate([item('a', 0, 30, 90)], TOPTS), 0);

// Supersets share one rest per round instead of taking one each.
const solo = PR.estimate([item('a', 3, 30, 90), item('b', 3, 30, 90)], TOPTS);
const supd = PR.estimate([item('a', 3, 30, 90, { superset: 'p' }), item('b', 3, 30, 90, { superset: 'p' })],
  TOPTS);
check('supersetting a pair saves one rest per round', solo - supd, 270);

// Ring adjustments are charged where they happen, not added as a lump sum.
const staged = (id, st, adjust) => item(id, 1, 30, 60, { station: st, stationAdjust: adjust });
check('a ring adjustment is charged once per station entered',
  PR.estimate([staged('a', 'high', true), staged('b', 'high', true), staged('c', 'low', true)], TOPTS) -
  PR.estimate([staged('a', 'high', false), staged('b', 'high', false), staged('c', 'low', false)], TOPTS),
  100);
check('a station nothing has to be moved for is free',
  PR.estimate([staged('a', 'floor', false)], TOPTS), 60);

// Trimming takes from the least important exercise still above its floor.
const pool = [
  item('main', 3, 30, 120, { trimPriority: 1, minSets: 2 }),
  item('accessory', 3, 30, 60, { trimPriority: 9, minSets: 1 }),
];
// Full cost 720 s. Flooring the accessory alone gets it to 540, so a 560
// budget must be met without touching the main lift.
check('full cost of the pool', PR.estimate(pool, TOPTS), 720);
const tight = PR.fit(pool, 560, TOPTS);
check('the accessory is cut before the main lift',
  tight.trimmed.map(t => t.id), ['accessory']);
check('and the main lift keeps its sets',
  tight.items.find(i => i.id === 'main').sets, 3);
// Below that, the main lift has to give too — least-important-first, not never.
check('a tighter budget then reaches the main lift',
  PR.fit(pool, 500, TOPTS).trimmed.map(t => t.id).sort(),
  ['accessory', 'main']);

const brutal = PR.fit(pool, 60, TOPTS);
check('a hard budget floors everything rather than going below minSets',
  brutal.items.map(i => [i.id, i.sets]), [['main', 2], ['accessory', 1]]);
check('and reports that it could not fit', brutal.overBudget, true);
check('a fixed exercise is never trimmed',
  PR.fit([item('warmup', 1, 180, 30, { fixed: true, minSets: 1 })], 10, TOPTS)
    .items[0].sets, 1);
check('fit does not mutate the input', pool.map(i => i.sets), [3, 3]);
check('a budget that already fits changes nothing',
  PR.fit(pool, 99999, TOPTS).trimmed, []);

// Every exercise must carry the config the trimmer needs.
// Every place has to be describable, and every piece of kit has to do something.
check('every place lists real equipment',
  Object.entries(P.places).flatMap(([id, p]) =>
    p.has.filter(t => !P.equipment[t]).map(t => id + ':' + t)), []);
check('and every piece of equipment provides something',
  Object.entries(P.equipment).filter(([, e]) => !e.provides.length).map(([k]) => k), []);
check('home can do the whole program',
  Object.entries(P.exercises).filter(([, e]) =>
    PR.usableLevel(e, PR.maxLevel(e), PR.capabilities(P.places.home, P.equipment)) < 0)
    .map(([k]) => k), []);
// A place without the furniture caps you down rather than dropping you.
const parkCaps = PR.capabilities(P.places.park, P.equipment);
check('a park caps the push-ups it cannot fully equip',
  PR.usableLevel(P.exercises['ring-row'], 4, parkCaps), 2);
check('and leaves out only what it truly cannot do',
  Object.entries(P.exercises).filter(([, e]) => PR.usableLevel(e, PR.maxLevel(e), parkCaps) < 0)
    .map(([k]) => k),
  ['ring-fallout', 'ring-leg-curl']);

// The unit that matters is the PATTERN, not the exercise. Losing push-ups for
// want of bars is not a loss; losing anti-extension because everything that
// trains it needs rings is.
check('home has no gaps',
  PR.gapsAt(P.workouts.A.order.concat(P.workouts.B.order), P.exercises,
    PR.capabilities(P.places.home, P.equipment)), []);
// Anti-extension went first, when the plank was added; knee flexion was the
// last hole and the slider curl closed it. A park now trains everything the
// week asks for, which is the whole point of the exercise being a capability
// question rather than an equipment one.
check('a park is short of nothing at all',
  PR.gapsAt(P.workouts.A.order.concat(P.workouts.B.order), P.exercises, parkCaps), []);
check('and a room with no equipment whatsoever now reaches eight of fifteen patterns',
  [...new Set(Object.values(P.exercises).map((e) => e.pattern))]
    .filter((p) => Object.values(P.exercises).some((e) => e.pattern === p &&
      PR.usableLevel(e, PR.maxLevel(e), {}) >= 0)).length, 8);
// The plank is in no workout's order; it is only ever reached by substitution.
check('the plank is a substitute, not a scheduled exercise',
  Object.values(P.workouts).flatMap(w => w.order).filter(o => o.id === 'plank'), []);
check('and it is what a park reaches for when the fallout will not work',
  PR.substituteFor(P.exercises['ring-fallout'], P.exercises, parkCaps), 'plank');
check('at home there is nothing to substitute, because the fallout works',
  PR.usableLevel(P.exercises['ring-fallout'], 3, PR.capabilities(P.places.home, P.equipment)) >= 0,
  true);
check('the ring curl now has a park-legal stand-in of its own',
  PR.substituteFor(P.exercises['ring-leg-curl'], P.exercises, parkCaps), 'slider-leg-curl');
check('a pattern with genuinely one exercise still has none to offer',
  PR.substituteFor(P.exercises['calf-raise'], P.exercises, parkCaps), null);
check('and the plank itself needs nothing, anywhere',
  P.exercises.plank.ladder.flatMap((_, i) => PR.rung(P.exercises.plank, i).needs), []);
check('and workout A, which has neither of them, is short of none',
  PR.gapsAt(P.workouts.A.order, P.exercises, parkCaps), []);
// A pattern covered by ANY of its exercises is covered.
check('one usable exercise is enough to cover a pattern',
  PR.gapsAt([{ id: 'ring-pullup' }, { id: 'ring-chinup' }], P.exercises, parkCaps), []);
check('the warm-up is never reported as a gap',
  PR.gapsAt([{ id: 'movement-prep' }], P.exercises, { }), []);
check('the chips name the thing in front of you, not the capability',
  PR.kitFor(['hang-high'], parkCaps, P.equipment), ['high bar']);
check('and the same requirement names a different object at home',
  PR.kitFor(['hang-high'], PR.capabilities(P.places.home, P.equipment), P.equipment), ['rings']);

check('every exercise declares a trim priority and a floor',
  Object.entries(P.exercises).filter(([, e]) =>
    typeof e.trimPriority !== 'number' || typeof e.minSets !== 'number').map(([k]) => k), []);
check('no floor exceeds the prescribed sets',
  Object.entries(P.exercises).filter(([, e]) => e.minSets > e.sets).map(([k]) => k), []);

// ---------------------------------------------------------------- //
section('Trailing sets when the cap moves');

const S = (done, extra) => ({ done, extra });
check('nothing to drop when the count still fits',
  PR.droppableSets([S(false), S(false), S(false)], 3), 0);
check('drops the unlogged tail when the count falls',
  PR.droppableSets([S(false), S(false), S(false)], 1), 2);
check('never drops a logged set',
  PR.droppableSets([S(false), S(true), S(true)], 1), 0);
check('stops at the first set it must keep',
  PR.droppableSets([S(false), S(true), S(false)], 1), 1);
// Regression: tapping a hand-added set used to delete it, then throw on the
// missing index, which killed the click handler and froze the card.
check('never drops a set the user added by hand',
  PR.droppableSets([S(false), S(false), S(false), S(false, true)], 3), 0);
check('and stops at it rather than reaching past it',
  PR.droppableSets([S(false), S(false, true), S(false), S(false)], 1), 2);
check('an empty set list is safe', PR.droppableSets([], 3), 0);

// ---------------------------------------------------------------- //
section('Speech voice selection');

const V = (name, lang) => ({ name, lang });
const ESPEAK = V('espeak-ng', 'en-US'), ALAN = V('Alan', 'en-GB'), FR = V('Amelie', 'fr-FR');

check('no voices at all', PR.preferredVoice([], ''), null);
check('no English voices is still nothing', PR.preferredVoice([FR], ''), null);
check('non-English voices are never chosen', PR.preferredVoice([FR, ALAN], '').name, 'Alan');
// The rule that matters on Linux: espeak is first in the list but chosen last.
check('anything beats espeak', PR.preferredVoice([ESPEAK, ALAN], '').name, 'Alan');
check('espeak is used only when it is all there is',
  PR.preferredVoice([ESPEAK], '').name, 'espeak-ng');
check('a saved choice wins, even if it is espeak',
  PR.preferredVoice([ESPEAK, ALAN], 'espeak-ng').name, 'espeak-ng');
check('a saved choice that has gone away falls back to the rule',
  PR.preferredVoice([ESPEAK, ALAN], 'Daniel').name, 'Alan');
check('matching is case-sensitive on name but not on lang',
  PR.preferredVoice([V('Alan', 'EN-gb')], '').name, 'Alan');

// ---------------------------------------------------------------- //
section('Phase gating needs sessions AND weeks');

const gate = (sessionCount, weeksElapsed, override = 0) =>
  PR.phaseFor({ phases: P.phases, sessionCount, weeksElapsed, override }).id;

check('fresh start → Phase 1', gate(0, 0), 1);
check('9 sessions but only 2 weeks → still Phase 1', gate(9, 2), 1);
check('3 weeks but only 5 sessions → still Phase 1', gate(5, 3), 1);
check('9 sessions and 3 weeks → Phase 2', gate(9, 3), 2);
check('18 sessions and 6 weeks → Phase 3', gate(18, 6), 3);
check('30 sessions but 4 weeks → capped at Phase 2', gate(30, 4), 2);
check('manual override wins', gate(30, 12, 1), 1);

const gap = PR.phaseGap({ phases: P.phases, sessionCount: 5, weeksElapsed: 2, override: 0 });
check('gap to Phase 2 from 5 sessions / 2 weeks',
  [gap.phase.id, gap.sessionsShort, gap.weeksShort], [2, 4, 1]);
check('no gap past the last phase',
  PR.phaseGap({ phases: P.phases, sessionCount: 99, weeksElapsed: 99, override: 0 }), null);

// ---------------------------------------------------------------- //
section('A/B alternation and level offsets');

check('first session is A', PR.nextWorkout([]), 'A');
check('after A comes B', PR.nextWorkout([{ workout: 'A' }]), 'B');
check('after B comes A', PR.nextWorkout([{ workout: 'A' }, { workout: 'B' }]), 'A');

const row = P.exercises['ring-row'];
const rowEntry = P.workouts.B.order.find(o => o.id === 'ring-row');
check('workout B runs rows one rung harder', rowEntry.levelOffset, 1);
check('the offset shows up in the prescribed level',
  PR.target(row, { level: 1, vest: 0, target: 10 }, PHASE3, rowEntry).level, 2);
check('the offset cannot run off the end of the ladder',
  PR.target(row, { level: row.ladder.length - 1, vest: 0, target: 10 }, PHASE3, rowEntry).level,
  row.ladder.length - 1);

// ---------------------------------------------------------------- //
section('Timed exercises use the same machinery');

const plank = P.exercises['ring-fallout'];
check('plank steps in seconds, not reps',
  run(plank, PR.initialState(plank), sets(3, 20)).state.target, 25);
check('and tops out at the range ceiling',
  run(plank, { level: 0, vest: 0, target: 25, topOutStreak: 0, failStreak: 0 }, sets(3, 25)).state.target,
  30);
check('a timed exercise never picks up vest weight',
  run(plank, { level: plank.ladder.length - 1, vest: 0, target: 30, topOutStreak: 1, failStreak: 0 },
    sets(3, 30)).state.vest, 0);

// ---------------------------------------------------------------- //
section('Per-workout set counts');

const pushup = P.exercises.pushup;
const pushupA = P.workouts.A.order.find(o => o.id === 'pushup');
const pushupB = P.workouts.B.order.find(o => o.id === 'pushup');
check('push-ups drop to 2 sets on the pull day', pushupA.setCount, 2);
check('and stay at 3 on the push day', pushupB.setCount ?? pushup.sets, 3);
check('the prescription reflects the day', PR.target(pushup, PR.initialState(pushup), PHASE3, pushupA).sets, 2);
check('2 logged sets satisfy the pull day',
  run(pushup, PR.initialState(pushup), sets(2, 10), PHASE3, pushupA).hit, true);
check('but not the push day',
  run(pushup, PR.initialState(pushup), sets(2, 10), PHASE3, pushupB).hit, false);
check('an exercise with no override falls back to its own set count',
  PR.target(pushup, PR.initialState(pushup), PHASE3, null).sets, pushup.sets);

// ---------------------------------------------------------------- //
section('Legs');

const legDays = Object.fromEntries(Object.entries(P.workouts).map(([k, w]) =>
  [k, w.order.filter(o => PR.groupOf(P.exercises[o.id].pattern) === 'legs').map(o => o.id)]));
check('day A is knee-dominant', legDays.A, ['split-squat', 'calf-raise']);
check('day B is hip-dominant', legDays.B, ['ring-leg-curl', 'hip-thrust']);
check('the leg curl is done off the floor, no furniture',
  P.exercises['ring-leg-curl'].cues.some(c => /chair/i.test(c)), false);
check('both days train legs', Object.values(legDays).every(l => l.length === 2), true);
// Day A stacks pull-ups and hanging leg raises, both grip-limited. A non-grip
// movement must separate them from the ring rows that follow.
const aIds = P.workouts.A.order.map(o => o.id);
check('a non-grip movement buffers the grip work on day A',
  PR.groupOf(P.exercises[aIds[aIds.indexOf('hanging-leg-raise') + 1]].pattern), 'legs');

// Every movement pattern a program can leave out. Vertical push was the gap.
const groups = Object.fromEntries(['A', 'B'].map(k => [k,
  new Set(P.workouts[k].order.map(o => PR.groupOf(P.exercises[o.id].pattern)))]));
check('both days cover push, pull and legs',
  ['A', 'B'].filter(k => !['push', 'pull', 'legs'].every(p => groups[k].has(p))), []);

// Patterns are what one exercise could stand in for another ON. Two things
// share one only when they are genuinely interchangeable — which is the whole
// reason "pull" had to split: a pull-up and a row are both lats and are not
// substitutes.
const byPattern = {};
for (const [id, e] of Object.entries(P.exercises)) (byPattern[e.pattern] ||= []).push(id);
check('every exercise declares a movement pattern, not a muscle',
  Object.entries(P.exercises).filter(([, e]) => !/^(prehab|pull|push|legs|core)-/.test(e.pattern))
    .map(([k]) => k), []);
// Sharing a pattern is what MAKES substitution possible — but only where the
// exercises really are alternatives for one another.
check('patterns are shared only where the exercises are genuine alternatives',
  Object.entries(byPattern).filter(([, v]) => v.length > 1),
  [['pull-vertical', ['ring-pullup', 'ring-chinup']],
   ['pull-horizontal', ['ring-row', 'archer-row']],
   ['core-anti-extension', ['ring-fallout', 'plank']],
   ['push-horizontal', ['pushup', 'diamond-pushup']],
   ['legs-knee-flexion', ['slider-leg-curl', 'ring-leg-curl']]]);
// Variety was added where the WEEK spends its volume, because that is where a
// second exercise costs nothing: split a pattern trained once a week and each
// variant runs fortnightly, which is too slow for a target to move.
const setsPerPattern = {};
for (const k of Object.keys(P.workouts))
  for (const o of P.workouts[k].order) {
    const ex = P.exercises[o.id];
    setsPerPattern[ex.pattern] = (setsPerPattern[ex.pattern] || 0) + (o.setCount || ex.sets) * 3;
  }
check('every pattern with a choice is one the week trains at least nine sets of',
  Object.entries(byPattern).filter(([p, v]) => v.length > 1 && (setsPerPattern[p] || 0) < 9)
    .map(([p]) => p), []);
check('the coarse group falls out of the prefix',
  [...new Set(Object.values(P.exercises).map(e => PR.groupOf(e.pattern)))].sort(),
  ['core', 'legs', 'prehab', 'pull', 'push']);
// Vertical and horizontal pulling are separate slots, and so are the two core
// jobs. Collapsing either would let a resolver drop one of them.
check('vertical and horizontal pull are different patterns',
  P.exercises['ring-pullup'].pattern === P.exercises['ring-row'].pattern, false);
check('and producing hip flexion is not the same as resisting extension',
  P.exercises['hanging-leg-raise'].pattern === P.exercises['ring-fallout'].pattern, false);
check('a vertical press exists', !!P.exercises['pike-pushup'], true);
// The band is gone — nothing may quietly reintroduce a dependency on it.
check('no exercise depends on a resistance band',
  Object.entries(P.exercises).filter(([, e]) =>
    /band/i.test(e.name) || (e.ladder || []).some(l => /band/i.test(l.name + ' ' + (l.note || ''))))
    .map(([k]) => k), []);
check('both days open with the warm-up',
  ['A', 'B'].filter(k => P.workouts[k].order[0].id !== 'movement-prep'), []);
check('and follow it with shoulder prep before any hard pull',
  ['A', 'B'].filter(k => PR.groupOf(P.exercises[P.workouts[k].order[1].id].pattern) !== 'prehab'), []);

// A warm-up must not creep longer every time you complete it.
const prep = P.exercises['movement-prep'];
const prepAfter = run(prep, PR.initialState(prep), sets(1, 180)).state;
check('the warm-up never progresses',
  [prepAfter.target, prepAfter.level, prepAfter.topOutStreak], [180, 0, 0]);
check('and repeated sessions leave it alone',
  Array.from({ length: 10 }).reduce(st => run(prep, st, sets(1, 300)).state,
    PR.initialState(prep)).target, 180);
check('face pulls come immediately before the dips on the pull day',
  aIds.indexOf('ring-dip') > aIds.indexOf('ring-facepull'), true);
check('and it is on the push day', P.workouts.B.order.some(o => o.id === 'pike-pushup'), true);

const thrust = P.exercises['hip-thrust'];
check('hip thrusts take vest load', PR.usesVest(thrust), true);
check('single-leg levels are flagged per-side',
  [PR.target(thrust, { level: 2, vest: 0, target: 12 }, PHASE3, null).perSide,
   PR.target(thrust, { level: 3, vest: 0, target: 12 }, PHASE3, null).perSide],
  [false, true]);
const legCurl = P.exercises['ring-leg-curl'];
check('the leg curl never takes vest weight', PR.usesVest(legCurl), false);
check('only its last level is single-leg',
  [3, 4].map(l => PR.target(legCurl, { level: l, vest: 0, target: 10 }, PHASE3, null).perSide),
  [false, true]);
check('calves step 2 reps at a time',
  run(P.exercises['calf-raise'], PR.initialState(P.exercises['calf-raise']), sets(3, 12)).state.target, 14);

// Only two props exist — a 20 cm sofa chair and a 45 cm chair. Nothing may
// reference a height that is not one of them.
const propRefs = Object.entries(P.exercises).flatMap(([id, e]) =>
  (e.ladder || []).map(l => `${l.name} ${l.note || ''}`).filter(t => /\d+\s*cm/.test(t))
    .map(t => [id, t.match(/(\d+)\s*cm/)[1]]));
check('every height referenced is a prop that exists',
  propRefs.filter(([, cm]) => !['20', '45', '80'].includes(cm)), []);
check('both chairs are actually used',
  ['20', '45'].filter(cm => !propRefs.some(([, c]) => c === cm)), []);
check('no exercise requires standing on furniture',
  Object.entries(P.exercises).flatMap(([id, e]) => (e.ladder || [])
    .filter(l => /^Standing on/.test(l.name)).map(() => id)), []);

// ---------------------------------------------------------------- //
section('A full Phase-1 block, session by session');

// Nine sessions of pull-ups at RPE 5-6: reps should climb 6→7→8, top out, and
// bank the level-up without ever touching the vest.
let sim = PR.initialState(pullup);
const trace = [];
for (let i = 0; i < 9; i++) {
  const t = PR.target(pullup, sim, PHASE1, null);
  trace.push(`${t.value}@L${t.level}`);
  sim = run(pullup, sim, sets(3, t.value), PHASE1).state;
}
check('Phase 1 pull-up prescriptions',
  trace, ['6@L0', '7@L0', '8@L0', '8@L0', '8@L0', '8@L0', '8@L0', '8@L0', '8@L0']);
check('never left level 0 in Phase 1', sim.level, 0);
check('never picked up vest weight in Phase 1', sim.vest, 0);
check('first Phase 2 session cashes in the banked level-up',
  PR.target(pullup, run(pullup, sim, sets(3, 8), PHASE2).state, PHASE2, null).level, 1);


// ---------------------------------------------------------------- //
section('The level is the unit');

const squat = P.exercises['split-squat'];
check('a rung inherits what it does not override',
  [PR.rung(squat, 0).rest, PR.rung(squat, 0).step, PR.rung(squat, 0).metric],
  [squat.rest, squat.step, squat.metric]);
check('a rung that names its own requirements REPLACES the exercise default',
  [PR.rung(squat, 0).needs, PR.rung(squat, 3).needs], [[], ['steady', 'step-45']]);
check('per-side is a property of the level, not the exercise',
  squat.ladder.map((_, i) => PR.rung(squat, i).perSide), [false, true, true, true, true]);
check('no exercise still uses the old exercise-wide perSideFrom',
  Object.entries(P.exercises).filter(([, e]) => e.perSideFrom !== undefined).map(([k]) => k), []);
// The whole point: a pistol squat is a different exercise that happens to share
// this ladder, so it carries its own range instead of inheriting 10-15.
check('a rung can carry its own rep range',
  [PR.rung(squat, 0).range, PR.rung(squat, 4).range], [[10, 15], [6, 10]]);
// Coaching is a level property too — this was the same bug one layer up, and
// it survived the first pass at making levels the unit.
check('every level has coaching, inherited or its own',
  Object.entries(P.exercises).flatMap(([id, e]) =>
    e.ladder.map((_, i) => [id, i]).filter(([, i]) => !PR.rung(e, i).cues.length)), []);
check('a rung with its own cues replaces the exercise\u2019s, not appends',
  PR.rung(squat, 4).cues.filter(c => squat.cues.includes(c)), []);
check('and addCues appends to them instead',
  PR.rung(P.exercises['ring-leg-curl'], 4).cues.slice(0, -1),
  P.exercises['ring-leg-curl'].cues);
check('a rung that says nothing inherits verbatim',
  PR.rung(squat, 2).cues, squat.cues);
// The UI badges what a level overrode. Comparing against level 1 would be
// wrong — level 1 is just another level, and here it has its own cues too.
check('a rung reports what it overrode, not how it differs from level 1',
  squat.ladder.map((_, i) => PR.rung(squat, i).own.cues), [true, false, false, false, true]);
check('and level 1 having its own cues does not tag every other level',
  PR.rung(squat, 2).own.cues, false);
check('addCues counts as overriding too',
  PR.rung(P.exercises['ring-leg-curl'], 4).own.cues, true);
check('own.range is set only where a range is declared',
  squat.ladder.map((_, i) => PR.rung(squat, i).own.range), [false, false, false, false, true]);
// The pistol must not still be told to keep its front shin vertical.
check('the pistol is not coached like a split squat',
  /front shin/i.test(PR.rung(squat, 4).cues.join(' ')), false);
check('and the bodyweight squat is not told to hold the rings',
  /rings/i.test(PR.rung(squat, 0).cues.join(' ')), false);
check('target() carries the level\u2019s cues to the card',
  PR.target(squat, { level: 4, vest: 0, target: 6 }, PHASE3, null).cues,
  PR.rung(squat, 4).cues);

check('an out-of-range level is clamped, never undefined',
  [PR.rung(squat, -3).index, PR.rung(squat, 99).index, PR.rung(squat, undefined).index], [0, 4, 0]);

// A level-up must land on the NEW level's range, not the old one's.
const preTop = { level: 3, vest: 0, target: 15, topOutStreak: 1, failStreak: 0 };
const promoted = run(squat, preTop, sets(3, 15)).state;
check('levelling into a narrower range resets to THAT range',
  [promoted.level, promoted.target], [4, 6]);
check('and the event says the new range, not the old one',
  /back to 6 reps/.test(run(squat, preTop, sets(3, 15)).events[0].text), true);
// Crossing from a two-legged level into a single-leg one halves the work for
// the same number on the card, so the event has to call it out.
check('crossing into a single-leg level says so',
  /per side/.test(run(squat, { level: 0, vest: 0, target: 15, topOutStreak: 1, failStreak: 0 },
    sets(3, 15)).events[0].text), true);
// And dropping back out of it must climb back to the wider range's bottom.
const dropped = run(squat, { level: 4, vest: 0, target: 6, topOutStreak: 0, failStreak: 2 }, sets(3, 2)).state;
check('deloading out of it resets to the level below', [dropped.level, dropped.target], [3, 10]);
check('progression is judged on the level you EARNED, not a day offset',
  PR.evaluate({ exercise: squat, state: { level: 4, vest: 0, target: 6 }, sets: sets(3, 6),
    phase: PHASE3, rules: P.rules, entry: { levelOffset: -2 } }).state.target, 7);
// A stored target below its level's floor is raised, never silently kept.
check('normalizeState floors the target at the level range',
  PR.normalizeState(squat, { level: 4, target: 2, vest: 0 }).target, 6);
check('but never caps it — past the range is how a maxed exercise progresses',
  PR.normalizeState(squat, { level: 4, target: 40, vest: 0 }).target, 40);

// ---------------------------------------------------------------- //
section('One session timeline');

const tl = PR.timeline([
  item('a', 2, 30, 90, { station: 'high', stationAdjust: true }),
  item('b', 2, 30, 60, { station: 'low', stationAdjust: true, superset: 'p' }),
  item('c', 2, 20, 45, { station: 'low', stationAdjust: true, superset: 'p' }),
], TOPTS);
check('the timeline is the running order, event by event',
  tl.map(e => e.type + (e.id ? ':' + e.id : '')),
  ['adjust', 'transition:a', 'work:a', 'rest', 'work:a', 'rest',
   'adjust', 'transition:b', 'work:b', 'transition:c', 'work:c', 'rest',
   'work:b', 'work:c']);
// The rest after an exercise's LAST round is the rest before the next
// exercise. The estimate used to count it while the app never ran it.
check('the rest before the next exercise is in the timeline, not implied',
  tl.filter(e => e.type === 'rest' && e.group === 'solo:0').length, 2);
check('the estimate is exactly the sum of it',
  PR.estimate([
    item('a', 2, 30, 90, { station: 'high', stationAdjust: true }),
    item('b', 2, 30, 60, { station: 'low', stationAdjust: true, superset: 'p' }),
    item('c', 2, 20, 45, { station: 'low', stationAdjust: true, superset: 'p' }),
  ], TOPTS),
  tl.reduce((n, e) => n + e.seconds, 0));
check('the session never ends on a rest', tl[tl.length - 1].type, 'work');
// A pair rests on the longer of the two intervals: resting 45 s because the
// face pulls say so would short-change the split squats in the same round.
check('a pair rests on the longer interval', tl.find(e => e.type === 'rest' && e.group === 'p').seconds, 60);
check('restForId reads the interval off the timeline', PR.restForId(tl, 'c'), 60);

// nextUp walks the SAME structure, so the estimate and the app cannot disagree
// about whether a rest sits between two exercises.
const none = () => false;
check('mid-pair goes straight over with no rest',
  PR.nextUp(tl, { id: 'b', set: 0 }, none), { kind: 'partner', id: 'c', set: 0, rest: 0 });
check('completing a round rests, then repeats the pair',
  PR.nextUp(tl, { id: 'c', set: 0 }, none), { kind: 'set', id: 'b', set: 1, rest: 60 });
check('finishing an exercise rests, then moves on',
  PR.nextUp(tl, { id: 'a', set: 1 }, id => id === 'a'), { kind: 'exercise', id: 'b', set: 0, rest: 90 });
check('another set of the same exercise is a set, not an exercise',
  PR.nextUp(tl, { id: 'a', set: 0 }, none).kind, 'set');
check('nothing left is done', PR.nextUp(tl, { id: 'c', set: 1 }, () => true), { kind: 'done' });
// Logging out of order must look forward first, then wrap — announcing
// something already left behind was a real bug.
check('it looks forward before wrapping back',
  PR.nextUp(tl, { id: 'a', set: 0 }, (id, set) => id === 'a' && set === 1).id, 'b');
check('and does wrap when there is nothing ahead',
  PR.nextUp(tl, { id: 'c', set: 1 }, id => id !== 'a').id, 'a');


// ---------------------------------------------------------------- //
section('Am I going to finish?');

// A real session ran out of time and the last three exercises were simply not
// done — the hip work and the overhead press, the two things that day exists
// to provide. Nothing warned anybody, because the app only ever showed the
// estimate it made BEFORE the session and a clock counting up. Neither answers
// the question you actually have at minute 35.
const pace = (its, isDone, elapsed) => PR.project(PR.timeline(its, TOPTS), isDone, elapsed);
const three = [item('a', 3, 30, 90), item('b', 3, 30, 90), item('c', 3, 30, 90)];

const fresh = pace(three, () => false, 0);
check('nothing done yet means it is all still ahead', fresh.behind, 0);
check('and the whole session is the remainder', fresh.ahead, PR.estimate(three, TOPTS));
check('with no pace to speak of yet', fresh.pace, 1);

// The line is drawn after the last set you actually DID — the transition and
// the rest between it and the next exercise are still ahead of you.
const doneA = PR.split(PR.timeline(three, TOPTS), (id) => id === 'a');
check('nothing before the first set counts as time spent',
  PR.split(PR.timeline(three, TOPTS), () => false).behind, 0);
check('and the two halves always add up to the whole',
  doneA.behind + doneA.ahead, PR.estimate(three, TOPTS));

// Working exactly to the model: elapsed equals what the model said that took.
const onModel = pace(three, (id) => id === 'a', doneA.behind);
check('on model, the pace reads as 1', onModel.pace, 1);
check('and the projection is just what is left', onModel.remaining, onModel.ahead);

// Running slow: the remainder has to stretch, or the warning comes too late.
const slow = pace(three, (id) => id === 'a', 900);
check('running slow is detected', slow.pace > 1.2, true);
check('and the remainder stretches with it', slow.remaining > slow.ahead, true);
check('so the projected total includes the time already spent',
  slow.total, 900 + slow.remaining);

// Two sets in, the ratio is noise. A 4x projection off one slow set helps nobody.
check('the pace is clamped at the top', pace(three, (id) => id === 'a', 100000).pace, 2);
check('and at the bottom', pace(three, (id) => id === 'a', 1).pace, 0.6);
check('and is not guessed at all before there is enough behind you',
  pace([item('a', 1, 20, 30)], () => true, 600).pace, 1);

check('everything logged is reported as done', pace(three, () => true, 1000).done, true);
check('with nothing left', pace(three, () => true, 1000).ahead, 0);
// A skipped set counts as nothing left to do, exactly like a logged one.
check('cut sets are not waiting for you',
  pace(three, (id, set) => id !== 'c' || set === 0, 1000).ahead <
  pace(three, (id) => id !== 'c', 1000).ahead, true);

// ---------------------------------------------------------------- //
section('Illustrations resolve in one place');

check('an explicit level picture wins outright, with no fallback',
  PR.imageCandidates('hip-thrust', P.exercises['hip-thrust'], 1).length, 1);
// .svg is in the chain because some things are geometry, not movement — the
// ring-dip set-up needed a drawn diagram, not a clip of someone doing it.
check('a level with no picture falls back level-first, then exercise',
  PR.imageCandidates('split-squat', P.exercises['split-squat'], 1),
  ['images/split-squat-L2.gif', 'images/split-squat-L2.svg', 'images/split-squat-L2.jpg',
   'images/split-squat.gif', 'images/split-squat.svg', 'images/split-squat.jpg']);
check('a level may point at another level\u2019s file',
  PR.imageCandidates('split-squat', P.exercises['split-squat'], 2), ['images/split-squat-L4.gif']);
check('an exercise-wide picture covers the levels that do not override it',
  [3, 4].map(l => PR.imageCandidates('ring-dip', P.exercises['ring-dip'], l)[0]),
  [P.exercises['ring-dip'].image, P.exercises['ring-dip'].image]);
check('while a level that names its own wins',
  PR.imageCandidates('ring-dip', P.exercises['ring-dip'], 0), ['images/ring-dip.svg']);
check('ids are URL-encoded, never interpolated raw',
  PR.imageCandidates('a b/c', { ladder: [{}], range: [1, 1] }, 0)[0], 'images/a%20b%2Fc-L1.gif');
// Given the generated manifest, only files that exist are ever named — the
// chain used to fire four 404s per exercise finding that out.
const HAVE = ['split-squat-L2.gif', 'split-squat.jpg'];
check('the manifest narrows the chain to what exists',
  PR.imageCandidates('split-squat', P.exercises['split-squat'], 1, HAVE),
  ['images/split-squat-L2.gif', 'images/split-squat.jpg']);
check('an exercise with nothing on disk asks for nothing',
  PR.imageCandidates('movement-prep', P.exercises['movement-prep'], 0, HAVE), []);
check('an explicit URL ignores the manifest entirely',
  PR.imageCandidates('ring-dip', P.exercises['ring-dip'], 0, HAVE).length, 1);
check('no manifest falls back to probing, as before',
  PR.imageCandidates('split-squat', P.exercises['split-squat'], 1, null).length, 6);
// Every candidate ends up inside a single-quoted JS array in an onerror
// attribute. A quote in one of them would close it and kill the whole chain.
check('no candidate contains a quote that would break the fallback chain',
  Object.keys(P.exercises).flatMap(id => [0, 1, 2, 3, 4]
    .flatMap(l => PR.imageCandidates(id, P.exercises[id], l))).filter(u => /['"\\]/.test(u)), []);


// ---------------------------------------------------------------- //
section('What a week actually trained');

// From the real export: two sessions, 41 sets — a respectable-looking number —
// with every hip-dominant and every overhead set missing, because the exercises
// that provide them sit at the end of workout B and fell off when time ran out.
// A total cannot show that. Split by pattern it is obvious.
const cov = (sessions, since) => PR.coverage({
  sessions, exercises: P.exercises, since,
  workouts: [P.workouts.A.order, P.workouts.B.order],
});
const sess = (workout, ids, date = '2026-08-02', setsEach = null) => ({
  date, workout,
  entries: Object.fromEntries(ids.map(id =>
    [id, { level: 0, sets: Array.from({ length: setsEach ?? P.exercises[id].sets },
      () => ({ value: 1, load: 0 })) }])),
});

check('no sessions means nothing got trained',
  cov([]).every(r => r.got === 0), true);
check('and every pattern is still listed, so a gap is visible from day one',
  cov([]).length, new Set(Object.values(P.exercises)
    .filter(e => e.progression !== 'fixed').map(e => e.pattern)).size);
check('the warm-up is left out — it never progresses and is not volume',
  cov([]).filter(r => r.pattern === 'prehab-warmup'), []);

const full = cov([sess('A', P.workouts.A.order.map(o => o.id)),
                  sess('B', P.workouts.B.order.map(o => o.id))]);
check('doing both days in full meets everything',
  full.filter(r => r.state !== 'met').map(r => r.pattern), []);

// The actual shape of what happened: workout B lost its last three exercises.
const real = cov([
  sess('A', P.workouts.A.order.map(o => o.id)),
  sess('B', P.workouts.B.order.map(o => o.id)
    .filter(id => !['ring-leg-curl', 'pike-pushup', 'hip-thrust'].includes(id))),
]);
check('losing the tail of workout B shows up as three empty patterns',
  real.filter(r => r.state === 'missed').map(r => r.pattern),
  ['legs-hip', 'legs-knee-flexion', 'push-vertical']);
check('while the total set count looks perfectly healthy',
  real.reduce((n, r) => n + r.got, 0) > 35, true);

// Three states, because "did a bit less" and "did none" are different problems.
// Split squats are day A only, so one session is the whole week's plan.
const partial = cov([sess('A', ['split-squat'], '2026-08-02', 2)]);
check('two thirds of the plan reads as short',
  partial.find(r => r.pattern === 'legs-knee').state, 'short');
check('a third of it reads as missed',
  cov([sess('A', ['split-squat'], '2026-08-02', 1)]).find(r => r.pattern === 'legs-knee').state,
  'missed');
check('and all of it reads as met',
  cov([sess('A', ['split-squat'])]).find(r => r.pattern === 'legs-knee').state, 'met');
check('doing MORE than planned still reads as met',
  cov([sess('A', ['split-squat'], '2026-08-02', 9)]).find(r => r.pattern === 'legs-knee').state,
  'met');
check('nothing at all is missed',
  partial.find(r => r.pattern === 'legs-hip').state, 'missed');
check('rows carry the group, so they can be shown in families',
  partial.find(r => r.pattern === 'legs-hip').group, 'legs');
// A pattern with no label would render its own id at the user, which is the
// kind of thing that ships because nobody has that exercise yet.
const labelled = readFileSync(join(root, 'app.js'), 'utf8');
check('every pattern in the program has a human label',
  [...new Set(Object.values(P.exercises).map(e => e.pattern))]
    .filter(p => !labelled.includes(`"${p}":`)), []);

// Only the window asked for.
check('sessions before the window are ignored',
  cov([sess('A', ['ring-pullup'], '2026-07-01')], '2026-08-01')
    .find(r => r.pattern === 'pull-vertical').got, 0);
check('and sessions inside it are counted',
  cov([sess('A', ['ring-pullup'], '2026-08-03')], '2026-08-01')
    .find(r => r.pattern === 'pull-vertical').got, P.exercises['ring-pullup'].sets);

// ---------------------------------------------------------------- //
section('Stored schema migrates');

check('the schema version is declared', typeof PR.SCHEMA, 'number');
check('nothing stored yet is not a migration', PR.migrate(null, P).migrated, false);
check('and comes out stamped', PR.migrate(null, P).state.version, PR.SCHEMA);
// v1 stored one range per exercise, so a target could sit below the range of
// the level it belongs to once ranges became per-level.
const old = PR.migrate({ version: 1, exerciseState: { 'split-squat': { level: 4, target: 3 } } }, P);
check('a v1 target below its level range is raised',
  old.state.exerciseState['split-squat'].target, 6);
check('and the user is told', old.notes.length, 1);
check('a target that was already fine is left alone',
  PR.migrate({ version: 1, exerciseState: { 'split-squat': { level: 0, target: 12 } } }, P)
    .state.exerciseState['split-squat'].target, 12);
check('re-running it is a no-op',
  PR.migrate(PR.migrate({ version: 1, exerciseState: {} }, P).state, P).notes, []);
check('an exercise that no longer exists is skipped, not thrown on',
  PR.migrate({ version: 1, exerciseState: { 'deleted-exercise': { level: 0, target: 1 } } }, P).notes, []);

// v3 said where you were in two incompatible ways: a named place, plus a
// hand-ticked list that only the placeless "anywhere" ever read. There is one
// list now, so the stored place has to resolve to the kit it stood for.
const v4 = (settings) => PR.migrate({ version: 3, settings }, P).state.settings;
check('a named place becomes the equipment it stood for',
  v4({ place: 'park' }).kit, P.places.park.has);
check('and the place itself is gone', v4({ place: 'park' }).place, undefined);
check('the hand-ticked list wins where it was the one being used',
  v4({ place: 'anywhere', customKit: ['high-bar', 'bench'] }).kit, ['high-bar', 'bench']);
check('and it is gone too', v4({ place: 'anywhere', customKit: ['bench'] }).customKit, undefined);
// The dangerous case: an unset place meant home, and resolving it to an empty
// list would silently strip every exercise that needs any equipment at all.
check('an unset place still means home', v4({}).kit, P.places.home.has);
check('and so does a place that no longer exists', v4({ place: 'gone' }).kit, P.places.home.has);
check('a list already ticked is left alone',
  v4({ place: 'home', kit: ['straps'] }).kit, ['straps']);
check('the whole thing is idempotent',
  PR.migrate(PR.migrate({ version: 3, settings: { place: 'park' } }, P).state, P).state.settings.kit,
  P.places.park.has);

// ---------------------------------------------------------------- //
section('Which of the things you have');

// Declaration order decided this, which meant it silently answered "rings" for
// everything: with rings and a high bar both up, a chin-up can be done on
// either, and that is a preference rather than a constraint.
const both = { has: ['rings', 'high-bar', 'low-bar'] };
check('with nothing preferred, declaration order still wins',
  PR.capabilities(both, P.equipment)['hang-high'], 'rings');
check('a preference is honoured',
  PR.capabilities(both, P.equipment, { 'hang-high': 'high-bar' })['hang-high'], 'high-bar');
check('and leaves the other capabilities alone',
  PR.capabilities(both, P.equipment, { 'hang-high': 'high-bar' })['grip-chest'], 'rings');

// Preferences must never widen what is possible, only pick between equals.
check('preferring something that is not here is ignored',
  PR.capabilities(both, P.equipment, { 'hang-high': 'straps' })['hang-high'], 'rings');
check('preferring something that cannot do the job is ignored',
  PR.capabilities(both, P.equipment, { 'hang-high': 'low-bar' })['hang-high'], 'rings');
check('and a preference cannot conjure a capability nothing here provides',
  PR.capabilities({ has: ['high-bar'] }, P.equipment, { 'handles-low': 'high-bar' })['handles-low'],
  undefined);

// The question is only worth asking where more than one thing could answer it.
check('two things can hang you', PR.providersFor('hang-high', both, P.equipment),
  ['rings', 'high-bar']);
check('one thing grips at chest here', PR.providersFor('grip-chest',
  { has: ['low-bar'] }, P.equipment), ['low-bar']);
check('and nothing at all is an empty list, not a crash',
  PR.providersFor('handles-low', { has: ['high-bar'] }, P.equipment), []);
check('a full kit offers three ways to hang',
  PR.providersFor('hang-high', { has: Object.keys(P.equipment) }, P.equipment),
  ['rings', 'high-bar', 'straps']);

// Every capability that can ever be a question needs wording for it.
const askable = [...new Set(Object.values(P.equipment).flatMap((e) => e.provides))];
check('every capability has a label for asking about it',
  askable.filter((c) => !P.capLabels[c]), []);
check('and none is labelled that no equipment provides',
  Object.keys(P.capLabels).filter((c) => !askable.includes(c)), []);

// ---------------------------------------------------------------- //
section('What else could train this');

// substituteFor answers "what INSTEAD" and excludes the exercise itself;
// alternativesFor answers "what ELSE", which has to include it — the list is a
// choice, and a choice you cannot choose back out of is a one-way door.
const home = PR.capabilities(P.places.home, P.equipment);
check('the prescribed exercise heads its own list',
  PR.alternativesFor(P.exercises['ring-fallout'], P.exercises, home)[0], 'ring-fallout');
check('with the other exercise for that pattern behind it',
  PR.alternativesFor(P.exercises['ring-fallout'], P.exercises, home), ['ring-fallout', 'plank']);
check('and it is symmetric, so a swap can be undone',
  PR.alternativesFor(P.exercises['plank'], P.exercises, home), ['plank', 'ring-fallout']);
check('a pattern with one exercise offers no choice',
  PR.alternativesFor(P.exercises['calf-raise'], P.exercises, home).length, 1);

// What the program already schedules is not a free choice, even where the
// pattern matches. Chin-ups and pull-ups are both vertical pulls and either
// beats nothing where a place can only manage one — that is substituteFor's
// job. But a supinated grip pulls with the elbow flexors in a way a pronated
// one does not, which is why the week schedules both; offering them against
// each other would let you chin twice a week and never pronate.
const scheduled = {};
for (const k of Object.keys(P.workouts))
  for (const o of P.workouts[k].order) scheduled[o.id] = true;
const free = (id) => PR.alternativesFor(P.exercises[id], P.exercises, home,
  Object.fromEntries(Object.keys(scheduled).filter((x) => x !== id).map((x) => [x, true])));
check('a scheduled sibling is not a free choice', free('ring-pullup'), ['ring-pullup']);
check('nor the other way round', free('ring-chinup'), ['ring-chinup']);
check('an unscheduled one still is', free('ring-fallout'), ['ring-fallout', 'plank']);
check('and the slot itself is never excluded from its own list',
  Object.keys(P.exercises).every((id) => free(id)[0] === id), true);
// Substitution is the last resort and keeps the looser rule, deliberately: a
// place that can only manage one of them should get one, not neither.
check('substitution still crosses where a choice would not',
  PR.substituteFor(P.exercises['ring-pullup'], P.exercises, home), 'ring-chinup');

// Only what is doable HERE. A park has no hanging handles, so the fallout is
// not on offer even though it is what the workout prescribes.
const park = PR.capabilities(P.places.park, P.equipment);
check('a park offers the plank and not the fallout',
  PR.alternativesFor(P.exercises['ring-fallout'], P.exercises, park), ['plank']);
check('while at home both are on offer',
  PR.alternativesFor(P.exercises['ring-fallout'], P.exercises, home), ['ring-fallout', 'plank']);
check('and an empty room offers only the plank',
  PR.alternativesFor(P.exercises['ring-fallout'], P.exercises, {}), ['plank']);

// The engine must not invent cross-pattern swaps: a row is not a pull-up.
check('nothing crosses a pattern boundary',
  Object.keys(P.exercises).every((id) =>
    PR.alternativesFor(P.exercises[id], P.exercises, home)
      .every((o) => P.exercises[o].pattern === P.exercises[id].pattern)), true);

// ---------------------------------------------------------------- //
section('The small helpers everything else leans on');

// Weeks, not sessions, are half of what gates a phase — nine sessions crammed
// into ten days is not a completed reintroduction. A bad date has to read as
// "no time has passed" rather than NaN, which would compare false against every
// gate and silently freeze you in phase 1 forever.
check('a week apart is one week', PR.weeksBetween('2026-01-01', '2026-01-08'), 1);
check('and it is fractional, not rounded', PR.weeksBetween('2026-01-01', '2026-01-05'), 4 / 7);
check('no start date means no time has passed', PR.weeksBetween(null, '2026-01-08'), 0);
check('an unparseable date is zero, not NaN', PR.weeksBetween('never', '2026-01-08'), 0);
check('and so is an unparseable end', PR.weeksBetween('2026-01-01', 'whenever'), 0);
check('going backwards never yields a negative week',
  PR.weeksBetween('2026-01-08', '2026-01-01'), 0);

// Loads are shown to a tenth and stored to a tenth, so that 0.1 + 0.2 never
// reaches the screen as 0.30000000000000004.
check('a half step rounds clean', PR.roundKg(1.25), 1.3);
check('float noise is flattened', PR.roundKg(0.1 + 0.2), 0.3);
check('and a whole number is left alone', PR.roundKg(4), 4);

check('no load reads as bodyweight, not "+0 kg"', PR.fmtKg(0), 'bodyweight');
check('a whole number drops the decimal', PR.fmtKg(2), '+2 kg');
check('a half is kept', PR.fmtKg(2.5), '+2.5 kg');
check('and the sign is always there, because it is added weight', PR.fmtKg(10)[0], '+');

// The rules are the defaults evaluate() falls back to. Pinned because a typo
// here changes progression everywhere at once and nothing else would notice.
check('the rules are all present and positive',
  Object.entries(PR.DEFAULT_RULES).filter(([, v]) => typeof v !== 'number' || v <= 0).map(([k]) => k),
  []);
check('the first vest step is at least as big as the step after it',
  PR.DEFAULT_RULES.vestFirstKg >= PR.DEFAULT_RULES.vestStepKg, true);
check('and the ceiling is above the first step',
  PR.DEFAULT_RULES.vestMaxKg > PR.DEFAULT_RULES.vestFirstKg, true);
check('a deload cannot take more than the ceiling allows',
  PR.DEFAULT_RULES.vestStepKg * 2 <= PR.DEFAULT_RULES.vestMaxKg, true);

// ---------------------------------------------------------------- //
section('Claims in the data match the data');

// An exercise NAME must not hardcode equipment it does not actually require.
// "Ring chin-ups" done on a park bar is a regular chin-up, and calling it a
// ring chin-up made the app look like it was missing an option it already had:
// the requirement is a capability, so the name has to describe the MOVEMENT and
// let the kit chip name the object.
const withoutRings = PR.capabilities(
  { has: Object.keys(P.equipment).filter((t) => t !== 'rings' && t !== 'straps') },
  P.equipment);
const equipmentWords = /\b(ring|strap|bar|sofa|chair|bench|box)s?\b/i;
check('no exercise names equipment it can be done without',
  Object.entries(P.exercises)
    .filter(([, ex]) => ex.ladder.some((_, i) => PR.rung(ex, i).needs.every((c) => withoutRings[c])))
    .filter(([, ex]) => equipmentWords.test(ex.name))
    .map(([id]) => id), []);

// Same rule for the coaching. "Rings turned out at the top" is wrong advice on
// a fixed bar, and it appears on a rung the bar can do. Ring-specific coaching
// is fine where the rung genuinely needs rings, or where it says "on rings".
const ringCue = (t) => /\bring/i.test(t) && !/\bon rings\b/i.test(t);
check('no cue assumes rings on a rung that does not need them',
  Object.entries(P.exercises).flatMap(([id, ex]) =>
    ex.ladder.map((_, i) => [id, i, PR.rung(ex, i)])
      .filter(([, , r]) => r.needs.every((c) => withoutRings[c]))
      .flatMap(([, i, r]) => (r.cues || []).filter(ringCue).map((c) => id + ' L' + (i + 1) + ': ' + c))),
  []);

// Every pattern needs its plain-words reading, or a card would show a muscle
// group for some exercises and nothing for others.
check('every pattern says what it trains',
  [...new Set(Object.values(P.exercises).map((e) => e.pattern))].filter((p) => !P.trains[p]), []);
check('and nothing claims a pattern the program does not use',
  Object.keys(P.trains).filter((p) =>
    !Object.values(P.exercises).some((e) => e.pattern === p)), []);

// The prose used to say the calf raises were supersetted with the face pulls
// long after they stopped being.
check('nothing claims a superset it does not have',
  Object.entries(P.exercises)
    .filter(([, e]) => /supersett?ed/i.test((e.why || '') + ' ' + (e.note || '')))
    .filter(([, e]) => !e.superset).map(([k]) => k), []);
check('a superset key always has at least two members in some workout',
  Object.values(P.workouts).flatMap(w => {
    const counts = {};
    w.order.forEach(o => { const k = P.exercises[o.id].superset; if (k) counts[k] = (counts[k] || 0) + 1; });
    return Object.entries(counts).filter(([, n]) => n < 2).map(([k]) => k);
  }), []);

// ---------------------------------------------------------------- //
report();
