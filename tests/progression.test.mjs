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
// Equipment chips are only useful if they cannot drift from reality.
const KIT_TOKENS = ['rings', 'bars', 'sofa', 'chair'];
check('every exercise declares a kit',
  Object.entries(P.exercises).filter(([, e]) => !Array.isArray(e.kit)).map(([k]) => k), []);
check('every kit token is one the UI can label',
  Object.entries(P.exercises).flatMap(([id, e]) =>
    [...(e.kit || []), ...(e.ladder || []).flatMap(l => l.kit || [])]
      .filter(t => !KIT_TOKENS.includes(t)).map(t => id + ':' + t)), []);
// A level that puts you in the rings must not still claim you need the bars.
check('the push-up ladder hands off from bars to rings',
  P.exercises.pushup.ladder.map(l => (l.kit || P.exercises.pushup.kit).join('+')),
  ['bars', 'bars', 'bars+sofa', 'bars+chair', 'rings']);
// Anything at a rings station needs the rings, unless the level says otherwise.
check('ring-station exercises list the rings at their base level',
  Object.entries(P.exercises)
    .filter(([, e]) => e.station.indexOf('rings') === 0)
    .filter(([, e]) => !((e.ladder[0] && e.ladder[0].kit) || e.kit).includes('rings'))
    .map(([k]) => k),
  // Two deliberate exceptions, both of which sit at a rings station without
  // needing the rings: movement prep is grouped there so the whole warm-up is
  // one block, and the split squat's first level is a plain bodyweight squat.
  ['movement-prep', 'split-squat']);
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
// Day A must stay at two adjustments; only day B pays for the leg curl.
const adjFor = k => P.stationOrder.filter(s => P.stations[s].adjust &&
  P.workouts[k].order.some(o => P.exercises[o.id].station === s)).length;
check('pull day needs 2 ring adjustments', adjFor('A'), 2);
check('push day needs 3, for the leg curl', adjFor('B'), 3);
// The rings bottom out at 80 cm, so the low station is the lowest that exists.
check('only the leg curl uses the low station',
  Object.entries(P.exercises).filter(([, e]) => e.station === 'rings-low').map(([k]) => k),
  ['ring-leg-curl']);

// ---------------------------------------------------------------- //
section('Installable app shell');

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');

check('manifest launches standalone', manifest.display, 'standalone');
check('manifest declares a maskable icon',
  manifest.icons.some(i => i.purpose === 'maskable'), true);
check('every manifest icon file exists',
  manifest.icons.filter(i => !existsSync(join(root, i.src))).map(i => i.src), []);
check('index links the manifest and an apple-touch-icon',
  [/rel="manifest"/.test(html), /rel="apple-touch-icon"/.test(html)], [true, true]);
check('the apple-touch-icon file exists', existsSync(join(root, 'icons/icon-180.png')), true);

// Both generated lists are checked against disk. A manifest nobody regenerates
// is worse than no manifest: data/images.js going stale hides a picture that is
// right there, and sw.js MEDIA going stale hides it only when offline.
const imagesJs = readFileSync(join(root, 'data', 'images.js'), 'utf8');
const declared = [...imagesJs.matchAll(/^    "([^"]+)",$/gm)].map(m => m[1]);
const filesOnDisk = readdirSync(join(root, 'images'))
  .filter(f => /\.(gif|jpe?g|png|webp)$/i.test(f)).sort();
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
  [k, w.order.filter(o => P.exercises[o.id].pattern === 'legs').map(o => o.id)]));
check('day A is knee-dominant', legDays.A, ['split-squat', 'calf-raise']);
check('day B is hip-dominant', legDays.B, ['ring-leg-curl', 'hip-thrust']);
check('the leg curl is done off the floor, no furniture',
  P.exercises['ring-leg-curl'].cues.some(c => /chair/i.test(c)), false);
check('both days train legs', Object.values(legDays).every(l => l.length === 2), true);
// Day A stacks pull-ups and hanging leg raises, both grip-limited. A non-grip
// movement must separate them from the ring rows that follow.
const aIds = P.workouts.A.order.map(o => o.id);
check('a non-grip movement buffers the grip work on day A',
  P.exercises[aIds[aIds.indexOf('hanging-leg-raise') + 1]].pattern, 'legs');

// Every movement pattern a program can leave out. Vertical push was the gap.
const patterns = Object.fromEntries(['A', 'B'].map(k => [k,
  new Set(P.workouts[k].order.map(o => P.exercises[o.id].pattern))]));
check('both days cover push, pull, legs and prehab',
  ['A', 'B'].filter(k => !['push', 'pull', 'legs'].every(p => patterns[k].has(p))), []);
check('a vertical press exists', !!P.exercises['pike-pushup'], true);
// The band is gone — nothing may quietly reintroduce a dependency on it.
check('no exercise depends on a resistance band',
  Object.entries(P.exercises).filter(([, e]) =>
    /band/i.test(e.name) || (e.ladder || []).some(l => /band/i.test(l.name + ' ' + (l.note || ''))))
    .map(([k]) => k), []);
check('both days open with the warm-up',
  ['A', 'B'].filter(k => P.workouts[k].order[0].id !== 'movement-prep'), []);
check('and follow it with shoulder prep before any hard pull',
  ['A', 'B'].filter(k => P.exercises[P.workouts[k].order[1].id].pattern !== 'prehab'), []);

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
check('a rung that names its own kit REPLACES the exercise default',
  [PR.rung(squat, 0).kit, PR.rung(squat, 3).kit], [[], ['rings', 'chair']]);
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
section('Illustrations resolve in one place');

check('an explicit level picture wins outright, with no fallback',
  PR.imageCandidates('hip-thrust', P.exercises['hip-thrust'], 1).length, 1);
check('a level with no picture falls back level-first, then exercise',
  PR.imageCandidates('split-squat', P.exercises['split-squat'], 1),
  ['images/split-squat-L2.gif', 'images/split-squat-L2.jpg',
   'images/split-squat.gif', 'images/split-squat.jpg']);
check('a level may point at another level\u2019s file',
  PR.imageCandidates('split-squat', P.exercises['split-squat'], 2), ['images/split-squat-L4.gif']);
check('an exercise-wide picture covers every level',
  [0, 2].map(l => PR.imageCandidates('ring-dip', P.exercises['ring-dip'], l)[0]),
  [P.exercises['ring-dip'].image, P.exercises['ring-dip'].image]);
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
  PR.imageCandidates('split-squat', P.exercises['split-squat'], 1, null).length, 4);
// Every candidate ends up inside a single-quoted JS array in an onerror
// attribute. A quote in one of them would close it and kill the whole chain.
check('no candidate contains a quote that would break the fallback chain',
  Object.keys(P.exercises).flatMap(id => [0, 1, 2, 3, 4]
    .flatMap(l => PR.imageCandidates(id, P.exercises[id], l))).filter(u => /['"\\]/.test(u)), []);

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

// ---------------------------------------------------------------- //
section('Claims in the data match the data');

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
