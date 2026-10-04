// Validates the half the engine tests never reached: the wiring.
//
//   Run:  node tests/ui.test.mjs
//
// app.js, index.html, data/program.js and progression.js are all loaded
// verbatim into a VM context holding tests/dom.mjs's minimal document. Nothing
// is stubbed out or reimplemented — if a handler throws, these fail.
//
// Every case below corresponds to a bug that shipped and was found by hand.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { makeWindow } from './dom.mjs';
import { check, section, report, noThrow } from './harness.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const KEY = 'workout-program:v1';


function boot({ protocol = 'http:', stored = null, startTime, listen = false } = {}) {
  const win = makeWindow({ protocol, ...(startTime ? { startTime } : {}) });
  if (stored) win.localStorage.setItem(KEY, JSON.stringify(stored));
  /* A speaker that writes down what it was asked to play. audio.js is proven on
   * its own elsewhere; this is about whether the APP calls it at the right
   * moments — which is a different question and was not being asked. */
  if (listen) {
    win.heard = [];
    win.CUES_DEVICE = {
      tone: (freq, delay, dur, gain) => {
        if (gain > 0.01) win.heard.push({ beep: freq, at: win.CLOCK.now() });
      },
      speak: (text) => win.heard.push({ said: text, at: win.CLOCK.now() }),
      voices: () => [{ name: 'Alan', lang: 'en-GB' }],
      onVoicesChanged() {},
      wake() {},
      nudgeSpeech() {},
    };
  }
  win.document.loadBody(read('index.html'));
  vm.createContext(win);
  for (const f of scripts) vm.runInContext(read(f), win, { filename: f });
  return win;
}
/* Taken from the page rather than listed here: a script index.html loads and
 * the tests do not is a gap that looks like a passing suite. */
const scripts = [...read('index.html').matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);

const $ = (w, sel) => w.document.querySelector(sel);
const $$ = (w, sel) => w.document.querySelectorAll(sel);
const card = (w, id) => $$(w, '.ex-card').find(c => c.dataset.ex === id);
const rows = (c) => c.querySelectorAll('.set-row');
const tab = (w, name) => $$(w, '.tab').find(t => t.dataset.tab === name).click();
const stored = (w) => JSON.parse(w.localStorage.getItem(KEY) || 'null');
const holdRow = (w, id) => rows(card(w, id))[0];
const nowCard = (w) => {
  const c = w.document.querySelector('.ex-card--now');
  return c ? c.dataset.ex : null;
};
const banner = (w) => w.document.getElementById('crash');
/* app.js catches its own failures now and shows a banner instead of throwing,
 * so "did not throw" stopped being enough on its own — an interaction has to
 * leave the page working, not merely leave the runner alive. */
function works(label, fn) {
  let winRef = null;
  const ok = noThrow(label, () => { winRef = fn(); });
  if (!ok) return false;
  const b = banner(w);
  if (b && !b.hidden) {
    return check(label + ' — without breaking the page',
      b.querySelector('.crash-what').textContent, '(no error)');
  }
  return true;
}
const P = (() => { const w = boot(); return w.PROGRAM; })();
const PR_range = (w, id, level) => w.Progression.rung(w.PROGRAM.exercises[id], level).range;

// ---------------------------------------------------------------- //
section('It boots');

// The page decides what loads; the tests follow. Assert it is not empty, or a
// broken regex above would silently boot an app with no scripts at all.
check('the tests load every script the page does', scripts.length >= 4, true);
check('and data/images.js is one of them', scripts.includes('data/images.js'), true);

let w = boot();
check('the program name reaches the header', $(w, '#progName').textContent, P.meta.name);
check('the phase badge is filled in', /Phase 1/.test($(w, '#phaseBadge').textContent), true);
check('one card per exercise in workout A', $$(w, '.ex-card').length, P.workouts.A.order.length);
check('the first card is the warm-up', $$(w, '.ex-card')[0].dataset.ex, 'movement-prep');
// The rest bar is display:flex, so `hidden` only works if the stylesheet says
// [hidden] wins. It was visible on every page load until it did.
check('the rest bar starts hidden', $(w, '#restBar').hidden, true);
check('and the stylesheet enforces the hidden attribute',
  /\[hidden\][^{]*\{[^}]*display:\s*none\s*!important/.test(read('styles.css')), true);
check('only the Today view is showing',
  ['today', 'history', 'program', 'data'].map(t => $(w, '#view-' + t).hidden),
  [false, true, true, true]);

// ---------------------------------------------------------------- //
section('Every tab renders');

for (const t of ['history', 'program', 'data', 'today']) {
  noThrow(`the ${t} tab renders`, () => tab(w, t));
  check(`and the ${t} view has content`, $(w, '#view-' + t).innerHTML.length > 200, true);
}
tab(w, 'program');
check('the program carries a visible health warning',
  /not medical advice/.test($(w, '#view-program').textContent), true);
tab(w, 'today');

// ---------------------------------------------------------------- //
section('Keyboard and screen-reader semantics');

check('tabs name the panel they control',
  $$(w, '.tab').map(t => t.getAttribute('aria-controls')),
  ['view-today', 'view-history', 'view-program', 'view-data']);
check('panels point back to their tabs',
  ['today', 'history', 'program', 'data'].map(t => $(w, '#view-' + t).getAttribute('aria-labelledby')),
  ['tab-today', 'tab-history', 'tab-program', 'tab-data']);
check('only the selected tab is in the tab order',
  $$(w, '.tab').map(t => t.getAttribute('tabindex')), ['0', '-1', '-1', '-1']);
const movedTab = $(w, '#tab-today').keydown('ArrowRight');
check('arrow keys select the next tab', $(w, '#tab-history').getAttribute('aria-selected'), 'true');
check('and move keyboard focus with it', w.document.activeElement.id, 'tab-history');
check('the arrow key does not scroll the page', movedTab.defaultPrevented, true);
tab(w, 'today');

check('every picker exposes its selected state',
  $$(w, '.pick-btn, .chip').filter(b => b.tagName === 'BUTTON' && !b.hasAttribute('aria-pressed')).length,
  0);
check('upcoming waits are real buttons',
  $$(w, '.rest-step, .flow--rest').filter(el => el.dataset.act === 'rest-now')
    .every(el => el.tagName === 'BUTTON'), true);
const details = card(w, 'ring-pullup').querySelector('.info-btn');
check('details identifies its exercise', details.getAttribute('aria-label'), 'Show details for Pull-ups');
check('and starts collapsed', details.getAttribute('aria-expanded'), 'false');
details.click();
check('opening details updates the accessible state',
  card(w, 'ring-pullup').querySelector('.info-btn').getAttribute('aria-expanded'), 'true');
check('every symbol-only set control has a name',
  $$(w, '.step, .btn-done').filter(b => !b.getAttribute('aria-label')).length, 0);
check('interactive control sizing follows the documented 44px floor',
  [
    /\.chip\s*\{[^}]*min-height:\s*44px/s.test(read('styles.css')),
    /\.pick-btn\s*\{[^}]*height:\s*44px/s.test(read('styles.css')),
    /\.info-btn\s*\{[^}]*height:\s*44px/s.test(read('styles.css')),
  ], [true, true, true]);

// ---------------------------------------------------------------- //
section('Every button is wired to something');

// A data-act with no case is a button that silently does nothing — exactly what
// a renamed action looks like, and nothing else would catch it.
const handled = new Set([...read('app.js').matchAll(/case "([a-z-]+)":/g)].map(m => m[1]));
const rendered = new Set();
for (const t of ['today', 'history', 'program', 'data']) {
  tab(w, t);
  for (const el of $(w, '#view-' + t).querySelectorAll('[data-act]')) rendered.add(el.dataset.act);
}
for (const el of $(w, '.site-header').querySelectorAll('[data-act]')) rendered.add(el.dataset.act);
tab(w, 'today');
check('every rendered action has a handler', [...rendered].filter(a => !handled.has(a)).sort(), []);
check('and there are actions to check', rendered.size > 8, true);

// ---------------------------------------------------------------- //
section('The A/B picker');

check('two picker buttons before a session', $$(w, '.pick-btn').length, 2);
check('A is the one highlighted', $(w, '.pick-btn--on').textContent, 'A');
$$(w, '.pick-btn').find(b => b.dataset.w === 'B').click();
check('picking B switches the session', /Workout B/.test($(w, '.session-head').textContent), true);
check('and is remembered', stored(w).nextOverride, 'B');
check('and the exercises follow it', card(w, 'ring-chinup') !== undefined, true);
$$(w, '.pick-btn').find(b => b.dataset.w === 'A').click();
// Storing a pick that matches the natural alternation would leave an override
// outliving the reason for it.
check('picking back to A stores no override', stored(w).nextOverride, null);

$(w, '[data-act="start"]').click();
check('the picker disappears once a session is running', $$(w, '.pick-btn').length, 0);
check('and Finish replaces Start', $$(w, '[data-act="finish"]').length > 0, true);
w.confirmAnswer = true;
$(w, '[data-act="abandon"]').click();
check('discarding brings the picker back', $$(w, '.pick-btn').length, 2);
check('and it asked first', /Discard this session/.test(w.prompts.pop()), true);

// ---------------------------------------------------------------- //
section('Logging a set');

w = boot();
let pull = card(w, 'ring-pullup');
check('three sets are laid out', rows(pull).length, 3);
works('logging the first set does not throw', () =>
  rows(pull)[0].querySelector('[data-act="log-set"]').click());
pull = card(w, 'ring-pullup');
check('the set is marked done', rows(pull)[0].classList.contains('set-row--done'), true);
check('and can be undone', rows(pull)[0].querySelectorAll('[data-act="undo-set"]').length, 1);
check('logging a set starts the session', stored(w).active !== null, true);
// The rest timer is the whole reason the app is usable one-handed mid-set.
check('and starts the rest timer', $(w, '#restBar').hidden, false);
check('naming what is coming', $(w, '#restLabel').textContent.length > 0, true);

works('undo does not throw', () =>
  rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="undo-set"]').click());
check('the set is open again', rows(card(w, 'ring-pullup'))[0].classList.contains('set-row--done'), false);

// Reps step by the LEVEL's step, and never below one step.
const before = rows(card(w, 'ring-pullup'))[0].querySelector('.set-val').textContent;
rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="rep-inc"]').click();
check('+ raises the rep target',
  rows(card(w, 'ring-pullup'))[0].querySelector('.set-val').textContent,
  before.replace(/^\d+/, (n) => +n + 1));


// ---------------------------------------------------------------- //
section('Cutting a set when time is short');

// One tap past the floor on the minus drops a set: "I am not doing this one".
// The row stays — the fact that there was meant to be a third set is worth
// keeping — but everything downstream treats it as though it was never
// prescribed.
const cut = (win, id, i) => {
  for (let n = 0; n < 40; n++) {
    const row = rows(card(win, id))[i];
    if (row.classList.contains('set-row--skipped')) return true;
    row.querySelector('[data-act="rep-dec"]').click();
  }
  return false;
};
const skipped = (win, id) =>
  rows(card(win, id)).map((r) => r.classList.contains('set-row--skipped'));

w = boot();
check('winding a set to nothing cuts it', cut(w, 'ring-pullup', 2), true);
check('the row is still there, marked', skipped(w, 'ring-pullup'), [false, false, true]);
check('and says what it is', /not doing this one/.test(rows(card(w, 'ring-pullup'))[2].textContent), true);
check('the card counts what you will actually do',
  card(w, 'ring-pullup').querySelector('.ex-target b').textContent, '2 × 6 reps');
check('and says how many were cut',
  card(w, 'ring-pullup').querySelector('.tag-cut').textContent, '1 cut');
check('it cannot be logged', rows(card(w, 'ring-pullup'))[2].querySelectorAll('[data-act="log-set"]').length, 0);

// Plus puts it straight back, rather than making you tap up from one rep.
rows(card(w, 'ring-pullup'))[2].querySelector('[data-act="rep-inc"]').click();
check('plus restores it', skipped(w, 'ring-pullup'), [false, false, false]);
check('to the prescribed number',
  rows(card(w, 'ring-pullup'))[2].querySelector('.set-val').textContent, '6reps');

// Cutting a main lift to one set is a different session, not a shorter one, so
// the minus stops at the same floor the time-cap trimmer respects.
w = boot();
cut(w, 'ring-pullup', 2);
check('a second set can be cut down to the floor', cut(w, 'ring-pullup', 1), false);
check('which leaves the exercise at its minimum',
  skipped(w, 'ring-pullup').filter((x) => !x).length, P.exercises['ring-pullup'].minSets);
check('and the minus goes back to just being minus',
  rows(card(w, 'ring-pullup'))[1].querySelector('[data-act="rep-dec"]').textContent, '−');

// A cut set costs no time — which is the entire point.
w = boot();
const mins = () => +/~(\d+) min/.exec($(w, '.sh-meta').textContent)[1];
const wholeSession = mins();
cut(w, 'ring-pullup', 2);
cut(w, 'ring-dip', 2);
check('the estimate comes down', mins() < wholeSession, true);

// It leaves the running order too: no wait before it, and the marker steps over.
w = boot();
cut(w, 'ring-pullup', 1);
check('no wait is drawn before a set you are not doing',
  card(w, 'ring-pullup').querySelectorAll('.rest-step').length, 1);
rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="log-set"]').click();
check('and the rest that runs is the one before the set you WILL do',
  /set 3 next/.test(card(w, 'ring-pullup').querySelector('.rest-step--live').textContent), true);
w.advance(160000);
check('the marker steps over it',
  rows(card(w, 'ring-pullup'))[2].classList.contains('set-row--next'), true);
check('rather than landing on it',
  rows(card(w, 'ring-pullup'))[1].classList.contains('set-row--next'), false);

// And it is not scored as a miss. Being busy must not deload you.
w = boot({ listen: false, stored: { version: 3, settings: { phaseOverride: 3 } } });
cut(w, 'ring-pullup', 2);
rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="log-set"]').click();
rows(card(w, 'ring-pullup'))[1].querySelector('[data-act="log-set"]').click();
$$(w, '[data-act="finish"]')[0].click();
check('two sets of a three-set exercise, one cut, still counts as done',
  stored(w).exerciseState['ring-pullup'].target, P.exercises['ring-pullup'].range[0] + 1);
check('with no failure recorded', stored(w).exerciseState['ring-pullup'].failStreak, 0);
check('and only what was done is in the log',
  stored(w).sessions[0].entries['ring-pullup'].sets.length, 2);

// Simply not logging a set is still a miss — that is a different thing from
// deciding in advance not to do it.
w = boot({ stored: { version: 3, settings: { phaseOverride: 3 } } });
rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="log-set"]').click();
rows(card(w, 'ring-pullup'))[1].querySelector('[data-act="log-set"]').click();
$$(w, '[data-act="finish"]')[0].click();
check('leaving a set unlogged holds the target', stored(w).exerciseState['ring-pullup'].target,
  P.exercises['ring-pullup'].range[0]);
check('and counts against you', stored(w).exerciseState['ring-pullup'].failStreak, 1);


// ---------------------------------------------------------------- //
section('One set at a time');

// Reported from real use: a mis-tap on the wrong row records a set you have not
// done, at numbers meant for later, and a tick appearing in the wrong place is
// the only clue.
w = boot();
const live = (win, id) => rows(card(win, id)).map((r) => {
  const b = r.querySelector('[data-act="log-set"]');
  return b ? !b.hasAttribute('disabled') : null;
});
check('only the first set can be logged', live(w, 'ring-pullup'), [true, false, false]);
check('and the rest are visibly waiting',
  rows(card(w, 'ring-pullup')).map((r) => r.classList.contains('set-row--waiting')),
  [false, true, true]);

// The disabled attribute is a hint; the handler has to enforce it too, because
// the delegated listener never sees the button's state.
rows(card(w, 'ring-pullup'))[2].querySelector('[data-act="log-set"]').click();
check('tapping a set out of turn does nothing',
  rows(card(w, 'ring-pullup')).map((r) => r.classList.contains('set-row--done')),
  [false, false, false]);

rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="log-set"]').click();
check('logging the first hands the turn to the second', live(w, 'ring-pullup'), [null, true, false]);
rows(card(w, 'ring-pullup'))[1].querySelector('[data-act="log-set"]').click();
check('and then to the third', live(w, 'ring-pullup'), [null, null, true]);

// Undo gives the turn back to the row it reopened.
rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="undo-set"]').click();
check('undo hands the turn back', live(w, 'ring-pullup'), [true, null, false]);

// A cut set is stepped over rather than blocking the ones behind it.
w = boot();
cut(w, 'ring-pullup', 1);
check('a cut set does not hold up the queue', live(w, 'ring-pullup'), [true, null, false]);
rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="log-set"]').click();
check('the turn skips straight over it', live(w, 'ring-pullup'), [null, null, true]);

// Timed rows obey the same rule, on both of their buttons.
w = boot();
const startable = (win, id) => rows(card(win, id)).map((r) => {
  const b = r.querySelector('[data-act="start-hold"]');
  return b ? !b.hasAttribute('disabled') : null;
});
// Fallouts are a three-set timed exercise, on workout B.
$$(w, '.pick-btn').find((b) => b.dataset.w === 'B').click();
check('a timed exercise queues its Start buttons too',
  startable(w, 'ring-fallout'), [true, false, false]);
rows(card(w, 'ring-fallout'))[2].querySelector('[data-act="start-hold"]').click();
check('a hold cannot be started out of turn — and does not even start a session',
  stored(w).active, null);
rows(card(w, 'ring-fallout'))[0].querySelector('[data-act="start-hold"]').click();
check('but the first one starts', !!stored(w).active.hold, true);

// ---------------------------------------------------------------- //
section('Logging a hold without running the clock');

// Reported from real use: a timed set marked done could not be corrected. Undo
// put the row back, but Start was the only way out of it — which means hanging
// for another thirty seconds to fix a miscount.
w = boot();
check('a timed row offers both Start and a tick',
  [holdRow(w, 'dead-hang').querySelectorAll('[data-act="start-hold"]').length,
   holdRow(w, 'dead-hang').querySelectorAll('[data-act="log-set"]').length],
  [1, 1]);
works('logging a hold by hand', () =>
  holdRow(w, 'dead-hang').querySelector('[data-act="log-set"]').click());
check('it records the number shown, with no clock run',
  stored(w).active.entries['dead-hang'].sets[0].value, 20);
check('and no hold was ever started', stored(w).active.hold, undefined);

// The correction round-trip that was impossible before.
holdRow(w, 'dead-hang').querySelector('[data-act="undo-set"]').click();
for (let i = 0; i < 3; i++) holdRow(w, 'dead-hang').querySelector('[data-act="rep-inc"]').click();
check('the reopened row can be adjusted',
  holdRow(w, 'dead-hang').querySelector('.set-val').textContent, '35s');
holdRow(w, 'dead-hang').querySelector('[data-act="log-set"]').click();
check('and logged at the corrected time',
  stored(w).active.entries['dead-hang'].sets[0].value, 35);
check('which is what the session records', (() => {
  $$(w, '[data-act="finish"]')[0].click();
  return stored(w).sessions[0].entries['dead-hang'].sets[0].value;
})(), 35);

// A hold left running must not attach itself to a row logged by hand.
w = boot();
holdRow(w, 'dead-hang').querySelector('[data-act="start-hold"]').click();
w.advance(5000 + 8000);
holdRow(w, 'ring-scap-pull') && null;
works('logging by hand while a hold runs', () =>
  holdRow(w, 'dead-hang').querySelector('[data-act="stop-hold"]').click());
check('the running hold is committed, not lost',
  stored(w).active.entries['dead-hang'].sets[0].value, 8);

// ---------------------------------------------------------------- //
section('Skipping a whole exercise');

// Cutting every set one tap at a time works but is absurd when the answer is
// "not today" — and minSets makes it impossible anyway.
w = boot();
const fullMins = +/~(\d+) min/.exec($(w, '.sh-meta').textContent)[1];
check('every card offers it', $$(w, '[data-act="skip-exercise"]').length, $$(w, '.ex-card').length);
works('skipping an exercise', () =>
  card(w, 'ring-pullup').querySelector('[data-act="skip-exercise"]').click());
check('every set is cut', skipped(w, 'ring-pullup'), [true, true, true]);
check('including past the minSets floor that blocks cutting by hand',
  P.exercises['ring-pullup'].minSets > 0, true);
check('the card says so', card(w, 'ring-pullup').classList.contains('ex-card--off'), true);
check('the header counts nothing', card(w, 'ring-pullup').querySelector('.ex-target b').textContent,
  '0 × 6 reps');
check('and the estimate drops', +/~(\d+) min/.exec($(w, '.sh-meta').textContent)[1] < fullMins, true);
check('the marker moves on', nowCard(w) !== 'ring-pullup', true);

// Reversible in one tap.
works('putting it back', () =>
  card(w, 'ring-pullup').querySelector('[data-act="skip-exercise"]').click());
check('every set returns', skipped(w, 'ring-pullup'), [false, false, false]);
check('at the prescribed number',
  rows(card(w, 'ring-pullup'))[0].querySelector('.set-val').textContent, '6reps');
check('and the estimate comes back',
  +/~(\d+) min/.exec($(w, '.sh-meta').textContent)[1], fullMins);

// Sets already logged are kept — skipping is about what is left to do.
w = boot();
rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="log-set"]').click();
card(w, 'ring-pullup').querySelector('[data-act="skip-exercise"]').click();
check('a logged set survives being skipped',
  rows(card(w, 'ring-pullup'))[0].classList.contains('set-row--done'), true);
check('while the rest are cut', skipped(w, 'ring-pullup').slice(1), [true, true]);
$$(w, '[data-act="finish"]')[0].click();
check('and one set of one is scored as complete',
  stored(w).exerciseState['ring-pullup'].target, P.exercises['ring-pullup'].range[0] + 1);

// ---------------------------------------------------------------- //
section('Extra sets — the regression that froze a card');

// Adding a set by hand, then lowering the session cap, used to delete the set
// out from under the click handler: the next tap read sets[i] of undefined,
// threw, and every button on the page stopped responding with no visible cause.
w = boot();
works('adding an extra set', () => card(w, 'ring-row').querySelector('[data-act="add-set"]').click());
check('the card gains a set', rows(card(w, 'ring-row')).length, 4);
check('marked as one you added', rows(card(w, 'ring-row'))[3].classList.contains('set-row--extra'), true);

works('capping the session with an extra set present', () =>
  $$(w, '[data-act="set-cap"]').find(b => b.dataset.cap === '30').click());
check('the trim leaves the hand-added set alone',
  rows(card(w, 'ring-row')).some(r => r.classList.contains('set-row--extra')), true);
works('and logging it still works', () => {
  const extra = rows(card(w, 'ring-row')).find(r => r.classList.contains('set-row--extra'));
  extra.querySelector('[data-act="log-set"]').click();
});
works('the page is still alive afterwards', () => tab(w, 'history'));
tab(w, 'today');

// One more tap on the minus of a spent extra set removes it — the only way to
// take one back off.
w = boot();
card(w, 'calf-raise').querySelector('[data-act="add-set"]').click();
let extraRow = () => rows(card(w, 'calf-raise')).find(r => r.classList.contains('set-row--extra'));
for (let i = 0; i < 40 && extraRow(); i++) extraRow().querySelector('[data-act="rep-dec"]').click();
check('winding an extra set down to nothing removes it', extraRow(), undefined);
check('and the prescribed sets are untouched', rows(card(w, 'calf-raise')).length, 2);

// ---------------------------------------------------------------- //
section('Illustrations');

w = boot();
// Deliberately not the first card — the warm-up has no illustration by design.
card(w, 'dead-hang').querySelector('[data-act="toggle-info"]').click();
let img = $(w, '.ex-img');
check('opening the details panel loads a picture', !!img, true);
// A display:none element has no layout box, so the lazy observer never fires
// and the image never loads at all.
check('the image is not lazy', img.hasAttribute('loading'), false);
check('image loading uses no inline event handlers',
  [img.hasAttribute('onerror'), img.hasAttribute('onload')], [false, false]);
check('the fallback list is inert JSON data',
  Array.isArray(JSON.parse(img.getAttribute('data-fallbacks'))), true);
check('and it stays hidden until the file arrives', img.parentNode.style.display, '');
img.load();
check('then reveals its figure', img.parentNode.style.display, 'block');
const failedFigure = img.parentNode;
img.error();
check('a missing image removes the figure after its fallbacks', failedFigure.parentNode, null);

// crossorigin is what lets the service worker cache a remote image, but on
// file:// a CORS request is rejected outright — it killed every local
// illustration until it was made conditional.
const remote = (win) => $$(win, '.ex-img').find(i => /^https?:/.test(i.getAttribute('src')));
let http = boot();
for (const b of $$(http, '[data-act="toggle-info"]')) b.click();
check('a remote image asks for CORS over http', remote(http).getAttribute('crossorigin'), 'anonymous');
check('and local ones do not',
  $$(http, '.ex-img').filter(i => !/^https?:/.test(i.getAttribute('src')))
    .every(i => !i.hasAttribute('crossorigin')), true);
let file = boot({ protocol: 'file:' });
for (const b of $$(file, '[data-act="toggle-info"]')) b.click();
check('nothing asks for CORS on file://',
  $$(file, '.ex-img').filter(i => i.hasAttribute('crossorigin')).length, 0);
check('and the pictures are still there', $$(file, '.ex-img').length > 5, true);

// The chain used to probe blind: four requests per exercise, 404 each, before
// giving up. With the generated manifest nothing missing is ever asked for.
const onDisk = new Set(readdirSync(join(root, 'images')).filter(f => /\.(gif|svg|jpg)$/.test(f)));
const localSrcs = $$(http, '.ex-img')
  .map(i => i.getAttribute('src')).filter(u => !/^https?:/.test(u));
const localFallbacks = $$(http, '.ex-img').flatMap(i =>
  JSON.parse(i.getAttribute('data-fallbacks') || '[]').filter(u => !/^https?:/.test(u)));
check('every local image requested actually exists',
  [...localSrcs, ...localFallbacks]
    .map(u => decodeURIComponent(u.replace('images/', '')))
    .filter(f => !onDisk.has(f)), []);
check('so there is no fallback chain left to probe', localFallbacks, []);
// An exercise with no illustration at all renders no figure, rather than an
// <img> that asks for four files and then deletes itself.
check('an exercise with no picture renders nothing',
  card(http, 'movement-prep').querySelectorAll('.ex-figure').length, 0);

// ---------------------------------------------------------------- //
section('Levels reach the card');

w = boot({
  stored: {
    version: 2,
    // Top of the split squat ladder: single leg, and its own 6-10 rep range.
    exerciseState: { 'split-squat': { level: 4, vest: 0, target: 6, topOutStreak: 0, failStreak: 0 } },
  },
});
const sq = card(w, 'split-squat');
check('the card names the level', /Ring-assisted pistol/.test(sq.textContent), true);
check('and says it is per side', /per side/.test(sq.querySelector('.ex-target').textContent), true);
check('and prescribes the level’s own range, not the exercise’s',
  sq.querySelector('.ex-target').textContent.includes('6 reps'), true);
check('the level badge counts the ladder', /Level 5\/5/.test(sq.textContent), true);
sq.querySelector('[data-act="toggle-info"]').click();
check('the ladder flags which rungs differ',
  card(w, 'split-squat').querySelectorAll('.rung-tag').length > 0, true);
// The card must coach the movement in front of you, not the one at the bottom
// of the ladder.
const form = card(w, 'split-squat').querySelectorAll('.ex-info li').map(li => li.textContent).join(' ');
check('the form cues are the level\u2019s', /Free leg straight out in front/.test(form), true);
check('and not the exercise\u2019s', /front shin roughly vertical/i.test(form), false);
check('the ladder marks which rungs re-coach the movement',
  [...card(w, 'split-squat').querySelectorAll('.rung-tag')].some(t => t.textContent === 'own cues'),
  true);
// The kit chip has to follow the level: push-ups start on the bars and finish
// in the rings.
w = boot({ stored: { version: 2, exerciseState: { pushup: { level: 4, vest: 0, target: 10 } } } });
check('the kit chip follows the level',
  card(w, 'pushup').querySelector('.ex-kit').textContent.includes('rings'), true);
check('and drops what the level no longer needs',
  card(w, 'pushup').querySelector('.ex-kit').textContent.includes('push-up bars'), false);

// A ladder that appears to stop is worse than one that says why.
w = boot({ stored: { version: 3, settings: { phaseOverride: 2 },
  exerciseState: { 'ring-dip': { level: 3, vest: 0, target: 8, topOutStreak: 1, failStreak: 0 } } } });
const gateNote = (win) => card(win, 'ring-dip').querySelectorAll('.ex-levelnote')
  .map((e) => e.textContent).find((t) => /Next up/.test(t)) || '';
check('the card names the rung it is waiting on',
  /Bodyweight, below parallel/.test(gateNote(w)), true);
check('and when it opens', /opens in Phase 3/.test(gateNote(w)), true);
check('and that it is not lost by waiting', /banked/.test(gateNote(w)), true);
card(w, 'ring-dip').querySelector('[data-act="toggle-info"]').click();
check('the ladder tags the gated rung',
  [...card(w, 'ring-dip').querySelectorAll('.rung-tag')].some(t => t.textContent === 'Phase 3'), true);
w = boot({ stored: { version: 3, settings: { phaseOverride: 3 },
  exerciseState: { 'ring-dip': { level: 3, vest: 0, target: 8, topOutStreak: 1, failStreak: 0 } } } });
check('and the notice goes away once it is open', gateNote(w), '');


// ---------------------------------------------------------------- //
section('Correcting the level by hand');

// The app's idea of where you are can be wrong — a ladder gets rewritten, or
// you come back from a break. Until this existed the only remedies were
// resetting all sixteen exercises or editing the exported JSON.
const stepper = (win, id) => card(win, id).querySelector('.lvl-set');
const lvlOf = (win, id) => stepper(win, id).querySelector('.lvl-set-val').textContent.trim();
const bump = (win, id, dir) =>
  card(win, id).querySelector(`[data-act="level-${dir}"]`).click();

w = boot();
card(w, 'ring-dip').querySelector('[data-act="toggle-info"]').click();
check('the stepper is there', !!stepper(w, 'ring-dip'), true);
check('showing where you are', lvlOf(w, 'ring-dip'), '1 / 5');
check('and cannot go below the bottom',
  stepper(w, 'ring-dip').querySelector('[data-act="level-dec"]').hasAttribute('disabled'), true);

works('moving up a level', () => bump(w, 'ring-dip', 'inc'));
check('it moves', lvlOf(w, 'ring-dip'), '2 / 5');
check('the card follows', /Seated, heels on the sofa chair/.test(card(w, 'ring-dip').textContent), true);
check('and it is stored', stored(w).exerciseState['ring-dip'].level, 1);

// A level set by hand is a fresh start on that rung.
bump(w, 'ring-dip', 'inc');
bump(w, 'ring-dip', 'inc');
check('three taps lands on level 4', lvlOf(w, 'ring-dip'), '4 / 5');
check('the reps reset to that level’s range',
  stored(w).exerciseState['ring-dip'].target, PR_range(w, 'ring-dip', 3)[0]);
check('and the top of the ladder stops it',
  (() => { bump(w, 'ring-dip', 'inc'); bump(w, 'ring-dip', 'inc'); return lvlOf(w, 'ring-dip'); })(),
  '5 / 5');

// Streaks belong to the rung you earned them on.
w = boot({ stored: { version: 3, exerciseState: {
  'ring-pullup': { level: 0, vest: 0, target: 8, topOutStreak: 1, failStreak: 2 } } } });
card(w, 'ring-pullup').querySelector('[data-act="toggle-info"]').click();
bump(w, 'ring-pullup', 'inc');
check('a hand-set level clears the streaks',
  [stored(w).exerciseState['ring-pullup'].topOutStreak,
   stored(w).exerciseState['ring-pullup'].failStreak], [0, 0]);

// Sets already logged pin it: finishSession files them under the level as it
// stands at the end, so moving it afterwards would mislabel the history.
w = boot();
card(w, 'ring-pullup').querySelector('[data-act="toggle-info"]').click();
rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="log-set"]').click();
check('logging a set locks the stepper',
  card(w, 'ring-pullup').querySelector('[data-act="level-inc"]').hasAttribute('disabled'), true);
check('and says why', /sets already logged today/.test(stepper(w, 'ring-pullup').textContent), true);
bump(w, 'ring-pullup', 'inc');
check('so it cannot be moved', stored(w).exerciseState['ring-pullup'].level, 0);
rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="undo-set"]').click();
check('undoing the set unlocks it again',
  card(w, 'ring-pullup').querySelector('[data-act="level-inc"]').hasAttribute('disabled'), false);

// A one-rung exercise has nothing to move along.
w = boot();
card(w, 'movement-prep').querySelector('[data-act="toggle-info"]').click();
check('no stepper where there is no ladder',
  card(w, 'movement-prep').querySelectorAll('.lvl-set').length, 0);


// ---------------------------------------------------------------- //
section('Training somewhere else');

// An exercise needs a capability, not an object: a dead hang needs something
// overhead to hang from, and a park bar does fine. A feet-assisted pull-up
// needs that something to be at a height you choose, and only rings give that.
const at = (place) => {
  const win = boot();
  $$(win, '[data-act="set-place"]').find((b) => b.dataset.place === place).click();
  return win;
};

w = boot();
check('the place picker offers everywhere', $$(w, '[data-act="set-place"]').length,
  Object.keys(P.places).length);
check('and starts at home', $(w, '#placeRow').querySelector('.cap--on').textContent, 'Home');
check('nothing is impossible at home', $$(w, '#placeNote').length, 0);

const park = at('park');
check('switching places is remembered', stored(park).settings.kit, P.places.park.has);
// Workout A loses no PATTERN in a park, so there is nothing to report — even
// though it is done with different equipment throughout.
check('workout A is fully covered in a park', $$(park, '#placeNote').length, 0);
check('and still has push-ups, on the floor',
  $$(park, '.ex-card').map((c) => c.dataset.ex).includes('pushup'), true);
// Workout B used to lose knee flexion in a park. The slider curl needs a floor
// and a towel, so there is nothing left to report — the two exercises a park
// cannot do are both SUBSTITUTED rather than dropped, which is the difference
// between losing an exercise and losing a pattern.
$$(park, '.pick-btn').find((b) => b.dataset.w === 'B').click();
check('workout B is fully covered in a park too', $$(park, '#placeNote').length, 0);
const parkIds = $$(park, '.ex-card').map((c) => c.dataset.ex);
check('the fallout is replaced rather than dropped', parkIds.includes('plank'), true);
check('and so is the ring curl', parkIds.includes('slider-leg-curl'), true);
check('with neither original still there',
  parkIds.filter((id) => id === 'ring-fallout' || id === 'ring-leg-curl'), []);
check('the card says what it is standing in for',
  card(park, 'plank').querySelector('.tag-sub').textContent,
  'for Fallouts');
check('it keeps the volume the workout asked for',
  rows(card(park, 'plank')).length, P.exercises['ring-fallout'].sets);
check('and nothing the workout asked for is missing from the session',
  P.workouts.B.order.length, parkIds.length);
// At home the workout runs as written — nothing stands in for anything.
check('no substitution happens at home', $$(w, '.tag-sub').length, 0);
$$(park, '.pick-btn').find((b) => b.dataset.w === 'A').click();
check('but everything else is still there', $$(park, '.ex-card').length > 5, true);

// The chips name what is actually in front of you.
check('at home the hang is on the rings',
  card(w, 'dead-hang').querySelector('.ex-kit').textContent.includes('rings'), true);
check('in the park it is a high bar',
  card(park, 'dead-hang').querySelector('.ex-kit').textContent.includes('high bar'), true);
check('and the dips are on parallel bars',
  card(park, 'ring-dip').querySelector('.ex-kit').textContent.includes('parallel bars'), true);

// Capping rather than dropping: you lose the progression, not the movement.
const high = boot({ stored: { version: 3, settings: { place: 'park' },
  exerciseState: { 'ring-row': { level: 4, vest: 0, target: 10, topOutStreak: 0, failStreak: 0 } } } });
check('a level the room cannot equip drops to one it can',
  /Level 3\/5/.test(card(high, 'ring-row').textContent), true);
check('and the card says why, naming the missing thing',
  /Down to level 3 here — no chair 45 cm/.test(card(high, 'ring-row').textContent), true);
check('and where you really are', /Your level is 5\./.test(card(high, 'ring-row').textContent), true);

// Requirements are not monotonic: a toes-down hang needs a height you CHOOSE,
// a full hang needs only a bar. So the room can push you UP a rung, not just
// down — and a search that only capped produced a level nothing satisfied.
const parkHang = boot({ stored: { version: 3, settings: { place: 'park' },
  exerciseState: { 'dead-hang': { level: 0, vest: 0, target: 20, topOutStreak: 0, failStreak: 0 } } } });
check('the easy rung can be the impossible one',
  /Level 2\/3/.test(card(parkHang, 'dead-hang').textContent), true);
check('and the card says it went UP, not down',
  /Up to level 2 here/.test(card(parkHang, 'dead-hang').textContent), true);
check('the chip names the bar you are actually on',
  card(parkHang, 'dead-hang').querySelector('.ex-kit').textContent.includes('high bar'), true);
check('your stored level is untouched', stored(high).exerciseState['ring-row'].level, 4);

// Going home puts it all back.
$$(high, '[data-act="set-place"]').find((b) => b.dataset.place === 'home').click();
check('back home the cap is gone', /Level 5\/5/.test(card(high, 'ring-row').textContent), true);
check('and nothing is missing', $$(high, '#placeNote').length, 0);

// The setup text tells you how to rig the rings. In a park nothing is rigged.
check('at home the station explains the set-up', $$(w, '.st-setup').length > 0, true);
check('in a park there is nothing to set up', $$(park, '.st-setup').length, 0);
// The station still groups the session, but naming it after a ring height you
// have not got is worse than saying nothing — so it names the role instead.
const stations = (win) =>
  $$(win, '.st-label').map((e) => e.textContent.replace(/\d+ \/ \d+/, '').trim());
check('at home a station names the rig', stations(w).includes('Rings overhead'), true);
check('in a park it names the role instead', stations(park).includes('Overhead'), true);
check('and mentions no rings at all',
  stations(park).some((s) => /ring/i.test(s)), false);
check('and the session is still grouped, not one flat list',
  stations(park).length > 1, true);

// Nothing is dropped from workout A, so the session is the same length — it is
// just done on different equipment. That is the whole point.
check('a park session of workout A is the same length as at home',
  +/~(\d+) min/.exec($(park, '.sh-meta').textContent)[1],
  +/~(\d+) min/.exec($(w, '.sh-meta').textContent)[1]);
check('with the same number of exercises',
  $$(park, '.ex-card').length, $$(w, '.ex-card').length);
check('but not the same equipment',
  $(park, '.tagline').textContent === $(w, '.tagline').textContent, false);

// A gym is a park with better furniture: a bench and a box stand in for the
// sofa and the chair, so nothing is lost that a park would not also lose.
const gym = at('gym');
check('a gym loses no more than a park does',
  $$(gym, '#placeNote').length, $$(park, '#placeNote').length);
check('the ticks are visible for a preset too', $$(gym, '#kitPick').length, 1);
check('and show exactly what the preset filled in',
  $$(gym, '.kit-tick--on').map((b) => b.dataset.kit), P.places.gym.has);
$$(gym, '.pick-btn').find((b) => b.dataset.w === 'B').click();
$$(park, '.pick-btn').find((b) => b.dataset.w === 'B').click();
check('the gym misses nothing, exactly like the park',
  [$$(gym, '#placeNote').length, $$(park, '#placeNote').length], [0, 0]);
// The rung that needs a 45 cm chair at home is the one a gym bench covers —
// without it the hip thrust would be stuck on the floor rung forever.
const gymHip = boot({ stored: { version: 3, settings: { place: 'gym' },
  exerciseState: { 'hip-thrust': { level: 2, vest: 0, target: 12, topOutStreak: 0, failStreak: 0 } } } });
$$(gymHip, '.pick-btn').find((b) => b.dataset.w === 'B').click();
check('the real hip thrust survives, on a bench',
  card(gymHip, 'hip-thrust').querySelectorAll('.gear--on').map((b) => b.textContent), ['bench']);
check('at its full level', /Level 3\/4/.test(card(gymHip, 'hip-thrust').textContent), true);

// ---------------------------------------------------------------- //
section('The ticks are what decide the session');

// A named place is a button that fills the list, not a mode. That is the whole
// point: "home, plus the high bar I just bought" was not expressible while the
// places were fixed lists in the program.
const any = at('nothing');
check('the picker is always there', $$(any, '#kitPick').length, 1);
check('with a tick-box per piece of equipment',
  $$(any, '[data-act="toggle-kit"]').length, Object.keys(P.equipment).length);
check('Nothing clears every tick', $$(any, '.kit-tick--on').length, 0);
check('and it says what that means', /Nothing ticked/.test($(any, '#kitEmpty').textContent), true);

// With an empty room you still get a session — just the floor work. That is a
// real answer, not an error page.
const bare = $$(any, '.ex-card').map((c) => c.dataset.ex);
check('an empty room still yields a session', bare.length > 0, true);
check('and it is the things that need nothing at all',
  bare, ['movement-prep', 'split-squat', 'pike-pushup', 'pushup', 'calf-raise']);
check('while what needs a bar is honestly reported missing',
  /vertical pull/.test($(any, '#placeNote').textContent), true);

// Ticking a bar has to change the session, not just the checkbox.
const tick = (win, token) =>
  $$(win, '[data-act="toggle-kit"]').find((b) => b.dataset.kit === token).click();
tick(any, 'high-bar');
check('ticking a high bar shows it ticked', $$(any, '.kit-tick--on').length, 1);
check('and pull-ups appear', $$(any, '.ex-card').map((c) => c.dataset.ex).includes('ring-pullup'), true);
check('and vertical pull is no longer missing',
  $$(any, '#placeNote').length === 0 || !/vertical pull/.test($(any, '#placeNote').textContent), true);
check('the tick survives a reload', stored(any).settings.kit, ['high-bar']);

// Ticks that match no preset are a real answer, not a broken state.
check('a list matching no preset says so', $$(any, '#placeRow .is-static').length, 1);
const litPresets = (win) =>
  $$(win, '#placeRow .cap--on').filter((b) => b.dataset.act === 'set-place');
check('and no preset is highlighted as if it were true', litPresets(any).length, 0);

// Untick puts it back, or the box would be a one-way switch.
tick(any, 'high-bar');
check('unticking removes it', $$(any, '.kit-tick--on').length, 0);
check('and the exercise goes with it',
  $$(any, '.ex-card').map((c) => c.dataset.ex).includes('ring-pullup'), false);

// The thing the fixed-list model could not express: home plus something new.
const homePlus = at('home');
tick(homePlus, 'high-bar');
check('a preset can be amended rather than replaced',
  $$(homePlus, '.kit-tick--on').length, P.places.home.has.length + 1);
check('and it is no longer any named place', litPresets(homePlus).length, 0);
check('but nothing is lost by adding to it', $$(homePlus, '#placeNote').length, 0);
// A high bar adds only hang-high, which the rings already give — so the session
// is unchanged. Worth pinning: it is why this was never a blocker, only a gap.
check('a high bar at home changes nothing, because the rings already cover it',
  $$(homePlus, '.ex-card').map((c) => c.dataset.ex),
  $$(at('home'), '.ex-card').map((c) => c.dataset.ex));

// A preset REPLACES the ticks: tapping Park has to drop the rings, or the
// session would still be planned around equipment you walked away from.
const back = at('park');
check('tapping a preset replaces the list rather than adding to it',
  $$(back, '.kit-tick--on').map((b) => b.dataset.kit), P.places.park.has);

// Straps are the only thing anywhere that holds your heels, and so the only
// answer to knee flexion away from home.
const trx = boot({ stored: { version: 4, settings: {
  kit: P.places.gym.has.concat('straps') } } });
$$(trx, '.pick-btn').find((b) => b.dataset.w === 'B').click();
check('a room with straps loses nothing at all', $$(trx, '#placeNote').length, 0);
check('including the leg curl',
  $$(trx, '.ex-card').map((c) => c.dataset.ex).includes('ring-leg-curl'), true);
check('done on the straps', card(trx, 'ring-leg-curl').querySelector('.ex-kit')
  .textContent.includes('suspension straps'), true);

// ---------------------------------------------------------------- //
section('Choosing which of the things you have');

// With rings and a high bar both up, a chin-up can be done on either, and
// declaration order was quietly answering "rings" every time.
const gears = (win, ex) => card(win, ex).querySelectorAll('[data-act="pick-gear"]');
/* What the card says you are on: the chosen gear where it asked, the summary
 * chip where it did not. Those are the same claim shown in one place or the
 * other, never both. */
const onWhat = (win, ex) => {
  const picked = gears(win, ex).filter((b) => b.classList.contains('gear--on'));
  return picked.length ? picked.map((b) => b.textContent).join(' ')
    : card(win, ex).querySelector('.ex-kit').textContent;
};
const withBar = (extra) => boot({ stored: { version: 4, settings: {
  kit: P.places.home.has.concat('high-bar'), ...extra } } });

w = withBar();
check('nothing to ask where one thing does the job', gears(w, 'split-squat').length, 0);
check('but a hang offers both', gears(w, 'hanging-leg-raise').map((b) => b.dataset.gear),
  ['rings', 'high-bar']);
check('the question is worded, not just a row of chips',
  card(w, 'hanging-leg-raise').querySelectorAll('.gear-label')[0].textContent, 'hang from');
check('with declaration order marked until you say otherwise',
  gears(w, 'hanging-leg-raise').filter((b) => b.classList.contains('gear--on'))
    .map((b) => b.dataset.gear), ['rings']);
check('and it is the only place the card says so',
  card(w, 'hanging-leg-raise').querySelector('.ex-kit').textContent.includes('rings'), false);
// ...but "no equipment" means the exercise needs none, not that everything it
// needs was asked about above. Reading the filtered list alone said a hanging
// leg raise needed nothing, one line under a choice of two things to hang from.
check('and it does not then claim the exercise needs nothing',
  card(w, 'hanging-leg-raise').querySelector('.ex-kit').textContent.includes('no equipment'), false);
check('while something that genuinely needs nothing still says so',
  card(w, 'pushup').querySelector('.ex-kit').textContent.includes('no equipment'), true);
check('because repeating it underneath would say the same thing twice',
  onWhat(w, 'hanging-leg-raise'), 'rings');

gears(w, 'hanging-leg-raise').find((b) => b.dataset.gear === 'high-bar').click();
check('picking the bar changes what the card says you are on',
  onWhat(w, 'hanging-leg-raise'), 'high bar');
check('and it is stored against the CAPABILITY, not the exercise',
  stored(w).settings.gear, { 'hang-high': 'high-bar' });

// That is the whole reason for keying it this way: you do not hang from the
// rings for one exercise and walk to the bar for the next. Pull-ups have to be
// at their bodyweight rung to show it, because the assisted rungs below need a
// height you CHOOSE — which is the next check.
const bw = { 'ring-pullup': { level: 2, vest: 0, target: 6, topOutStreak: 0, failStreak: 0 } };
const onBar = withBar({ gear: { 'hang-high': 'high-bar' } });
onBar.localStorage.setItem(KEY, JSON.stringify({ ...stored(onBar), exerciseState: bw }));
const onBar2 = boot({ stored: JSON.parse(onBar.localStorage.getItem(KEY)) });
check('everything else on the same capability follows',
  onWhat(onBar2, 'ring-pullup'), 'high bar');
check('and the choice survives a reload',
  stored(onBar2).settings.gear, { 'hang-high': 'high-bar' });

// ...but only where the capability is the same one. A feet-assisted pull needs
// a height you CHOOSE, which a fixed bar cannot give, so it stays on the rings
// — and that is why the chin-up card shows no choice until you reach bodyweight.
check('a rung needing an adjustable height is unaffected',
  onWhat(w, 'dead-hang').includes('rings'), true);
check('and offers no choice at all, because there is none',
  gears(w, 'dead-hang').length, 0);
check('nor does the assisted pull-up, which is the same reason the chin-up card ' +
  'shows nothing until you reach bodyweight', gears(w, 'ring-pullup').length, 0);

// A preference must never widen what is possible — only pick between equals.
const impossible = boot({ stored: { version: 4, settings: {
  kit: ['high-bar'], gear: { 'handles-low': 'high-bar' } } } });
$$(impossible, '.pick-btn').find((b) => b.dataset.w === 'B').click();
check('preferring something that cannot do the job does not unlock it',
  $$(impossible, '.ex-card').map((c) => c.dataset.ex).includes('ring-leg-curl'), false);

// Untick the thing you preferred and the preference has to stop applying,
// rather than leaving a dangling choice that quietly does nothing.
const untick = withBar({ gear: { 'hang-high': 'high-bar' } });
check('the preference applies while it is ticked',
  onWhat(untick, 'hanging-leg-raise'), 'high bar');
$$(untick, '[data-act="toggle-kit"]').find((b) => b.dataset.kit === 'high-bar').click();
check('and falls back cleanly once it is gone',
  onWhat(untick, 'hanging-leg-raise').includes('rings'), true);
check('with the question no longer asked', gears(untick, 'hanging-leg-raise').length, 0);

// Searching "ring pull ups" while you are hanging off a park bar sends you to
// the wrong video, and the exercise no longer knows which one you are on — so
// the query names the movement and picks up the equipment you actually chose.
const query = (win, ex) => {
  card(win, ex).querySelector('[data-act="toggle-info"]').click();
  return card(win, ex).querySelector('.vid-q').textContent;
};
check('at home the query says rings', query(boot(), 'ring-row'), 'rings inverted row form tutorial');
const atPark = boot({ stored: { version: 4, settings: { kit: P.places.park.has } } });
check('in a park it says low bar', query(atPark, 'ring-row'), 'low bar inverted row form tutorial');
check('and an exercise needing nothing names nothing',
  query(boot(), 'pushup'), 'push up form tutorial');
check('no query still names equipment it is not on',
  Object.values(P.exercises).filter((ex) => /\bring/i.test(ex.search || '')).map((ex) => ex.name), []);

// ---------------------------------------------------------------- //
section('Choosing which exercise trains a pattern');

// Step 2 of "equipment first, then exercise": with the room settled, pick which
// of the exercises that train this pattern you actually feel like doing.
const swaps = (win, ex) => card(win, ex).querySelectorAll('[data-act="pick-variant"]');
const swapTo = (win, ex, to) =>
  swaps(win, ex).find((b) => b.dataset.variant === to).click();
const toB = (win) => $$(win, '.pick-btn').find((b) => b.dataset.w === 'B').click();

// What the program already schedules is NOT a free choice, even where the
// pattern matches. Chin-ups and pull-ups are both vertical pulls, and either
// beats nothing if a place can only manage one — but a supinated grip pulls
// with the elbow flexors in a way a pronated one does not, which is why the
// week puts one in A and the other in B. Offering them rebootst each other
// would let you chin twice a week and never pronate.
w = boot();
check('a scheduled exercise is not offered as a swap', swaps(w, 'ring-pullup').length, 0);
toB(w);
check('nor the other way round', swaps(w, 'ring-chinup').length, 0);
// Variety went where the WEEK spends its volume: the two highest-volume
// patterns in A both carry an alternative now.
const swappable = (win) => $$(win, '.ex-card').filter((c) => c.querySelectorAll('.swap-row').length)
  .map((c) => c.dataset.ex);
check('workout A offers a choice on its two busiest patterns',
  swappable(boot()), ['ring-row', 'pushup']);

// The fallout is scheduled; the plank is not, so it is a spare part and a real
// alternative. That is the one genuine choice the program holds right now.
w = boot();
toB(w);
check('an unscheduled sibling IS offered', swaps(w, 'ring-fallout').map((b) => b.dataset.variant),
  ['ring-fallout', 'plank']);
check('with the prescribed one marked', swaps(w, 'ring-fallout')
  .filter((b) => b.classList.contains('swap--on')).map((b) => b.dataset.variant), ['ring-fallout']);
check('a pattern with one exercise offers nothing', swaps(w, 'hip-thrust').length, 0);
check('and workout B carries four, including the two that close its park gaps',
  swappable(w), ['ring-row', 'ring-fallout', 'ring-leg-curl', 'pushup']);
check('the ring curl offers the floor version',
  swaps(w, 'ring-leg-curl').map((b) => b.dataset.variant), ['ring-leg-curl', 'slider-leg-curl']);

swapTo(w, 'ring-fallout', 'plank');
check('swapping replaces the card', $$(w, '.ex-card').map((c) => c.dataset.ex).includes('plank'), true);
check('and the one it replaced is gone',
  $$(w, '.ex-card').map((c) => c.dataset.ex).includes('ring-fallout'), false);
check('the choice is keyed by workout AND slot, so A and B stay independent',
  stored(w).settings.variant, { 'B:ring-fallout': 'plank' });
check('the new card still offers the way back',
  swaps(w, 'plank').map((b) => b.dataset.variant), ['ring-fallout', 'plank']);
check('with the chosen one marked now', swaps(w, 'plank')
  .filter((b) => b.classList.contains('swap--on')).map((b) => b.dataset.variant), ['plank']);
check('and the volume the workout asked for carries over',
  rows(card(w, 'plank')).length, P.exercises['ring-fallout'].sets);

// The reported bug: the choice was written to storage and dropped on the way
// back in, because load() copies only the keys DEFAULT_SETTINGS declares. The
// first test for this checked what was WRITTEN and never re-booted, which is
// exactly the vacuous persistence assertion that let it through.
let reboot = boot({ stored: JSON.parse(w.localStorage.getItem(KEY)) });
toB(reboot);
check('the swap survives a reload',
  $$(reboot, '.ex-card').map((c) => c.dataset.ex).includes('plank'), true);
check('and it is still offered both ways afterwards',
  swaps(reboot, 'plank').map((b) => b.dataset.variant), ['ring-fallout', 'plank']);
swapTo(reboot, 'plank', 'ring-fallout');
check('so it can be swapped back after a reload',
  $$(reboot, '.ex-card').map((c) => c.dataset.ex).includes('ring-fallout'), true);

// Choosing back is not an override — storing it would freeze the slot rebootst
// a later change to the program.
check('choosing what was prescribed clears the override', stored(reboot).settings.variant, {});
reboot = boot({ stored: JSON.parse(reboot.localStorage.getItem(KEY)) });
toB(reboot);
check('and THAT survives a reload too',
  $$(reboot, '.ex-card').map((c) => c.dataset.ex).includes('ring-fallout'), true);

// Logging pins the choice, for the same reason it pins the level: the session
// records what you did rebootst the exercise you did it on.
w = boot();
toB(w);
swapTo(w, 'ring-fallout', 'plank');
rows(card(w, 'plank'))[0].querySelector('[data-act="log-set"]').click();
check('a logged set locks the swap',
  swaps(w, 'plank').every((b) => b.hasAttribute('disabled')), true);
check('and says why', /Swap before you log a set/.test(card(w, 'plank').textContent), true);
swapTo(w, 'plank', 'ring-fallout');
check('so it cannot be moved',
  $$(w, '.ex-card').map((c) => c.dataset.ex).includes('plank'), true);
rows(card(w, 'plank'))[0].querySelector('[data-act="undo-set"]').click();
check('undoing the set unlocks it reboot',
  swaps(w, 'plank').every((b) => !b.hasAttribute('disabled')), true);

// The lock note APPEARS mid-card, which is the shape that broke the patcher:
// a keyed node with no old match used to eat the next unkeyed slot, so the
// <div class="sets"> below it was patched into the kit row and every set row
// was rebuilt. Held references went stale and taps did nothing. Looking rows
// up fresh hides it completely, so this holds them across the log.
w = boot();
toB(w);
swapTo(w, 'ring-fallout', 'plank');
const heldRows = [...rows(card(w, 'plank'))];
const heldSets = card(w, 'plank').querySelectorAll('.sets')[0];
heldRows.forEach((r) => r.querySelector('[data-act="log-set"]').click());
check('every held row still logged its set, after the lock note appeared',
  rows(card(w, 'plank')).map((r) => r.classList.contains('set-row--done')),
  heldRows.map(() => true));
check('the rows kept their identity',
  rows(card(w, 'plank')).map((r, i) => r === heldRows[i]), heldRows.map(() => true));
check('and so did the container holding them',
  card(w, 'plank').querySelectorAll('.sets')[0] === heldSets, true);

// Equipment decides the list — that is what makes it step 2 rather than step 1.
const noRings = boot();
$$(noRings, '[data-act="set-place"]').find((b) => b.dataset.place === 'park').click();
toB(noRings);
check('a park offers the plank with no way back to the fallout',
  swaps(noRings, 'plank').length, 0);
check('because the fallout is not doable there',
  card(noRings, 'plank').querySelector('.tag-sub').textContent,
  'for Fallouts');

// A choice the room cannot honour falls back to substitution rather than
// vanishing — the two mechanisms have to compose.
const gone = boot({ stored: { version: 4, settings: {
  kit: P.places.park.has, variant: { 'B:ring-fallout': 'ring-fallout' } } } });
toB(gone);
check('an impossible choice is substituted, not dropped',
  $$(gone, '.ex-card').map((c) => c.dataset.ex).includes('plank'), true);

// ---------------------------------------------------------------- //
section('Session length cap');

w = boot();
const minutes = (win) => +/~(\d+) min/.exec($(win, '.sh-meta').textContent)[1];
const full = minutes(w);
check('a full session is 40-70 minutes', full > 40 && full < 70, true);
$$(w, '[data-act="set-cap"]').find(b => b.dataset.cap === '30').click();
check('capping shortens the estimate', minutes(w) < full, true);
check('and says what it took out', $$(w, '.cap-note').length, 1);
check('the trimmed exercises are named',
  /\d+→\d+/.test($(w, '.cap-note').textContent), true);
// Two chip rows now (where, and how long), so scope it to the time row.
check('the chip shows as selected',
  $(w, '#capRow').querySelector('.cap--on').textContent, '30 min');
$$(w, '[data-act="set-cap"]').find(b => b.dataset.cap === '0').click();
check('going back to Full restores the estimate', minutes(w), full);

// ---------------------------------------------------------------- //
section('Finishing updates the targets');

w = boot();
const pullTarget = () => stored(w).exerciseState['ring-pullup'].target;
for (const r of rows(card(w, 'ring-pullup'))) r.querySelector('[data-act="log-set"]').click();
check('all three sets logged',
  rows(card(w, 'ring-pullup')).every(r => r.classList.contains('set-row--done')), true);
works('finishing does not throw', () => $$(w, '[data-act="finish"]')[0].click());
check('the session is in history', stored(w).sessions.length, 1);
// The timestamp on each set is the only record of how long you really rested.
// Without it the session-length model can only ever be checked against a total.
check('and each logged set keeps when it happened',
  stored(w).sessions[0].entries['ring-pullup'].sets.every((s) => typeof s.at === 'string'), true);
check('the active session is cleared', stored(w).active, null);
check('hitting every set moves the target up', pullTarget(), P.exercises['ring-pullup'].range[0] + 1);
check('the summary says what changed', $$(w, '.summary-panel .ev').length > 0, true);
check('and the next session is the other workout', /Workout B/.test($(w, '.session-head').textContent), true);

// A session with nothing logged must not be recorded, and must ask first.
w = boot();
$(w, '[data-act="start"]').click();
w.confirmAnswer = false;
$$(w, '[data-act="finish"]')[0].click();
check('an empty session is not silently discarded', stored(w).active !== null, true);
w.confirmAnswer = true;
$$(w, '[data-act="finish"]')[0].click();
check('and is dropped once confirmed', [stored(w).active, stored(w).sessions.length], [null, 0]);


// ---------------------------------------------------------------- //
section('The entry is a log, not a copy of the plan');

// It used to be both: level, target, vest and a number on every set were frozen
// when the session started, so anything that moved the plan mid-session left
// the untouched sets showing stale numbers.

w = boot();
rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="rep-inc"]').click();
let entry = () => stored(w).active.entries['ring-pullup'];
check('no frozen copy of the prescription is stored',
  ['level', 'target'].filter(k => k in entry()), []);
check('a set you have not touched carries nothing of its own',
  [entry().sets[1].value, entry().sets[1].load], [null, null]);
check('but still shows the prescribed number',
  rows(card(w, 'ring-pullup'))[1].querySelector('.set-val').textContent, '6reps');
check('a set you did change records the change', entry().sets[0].value, 7);
check('and the vest follows the plan until you move it', entry().vest, null);

// Phase 1 suppresses the vest. Lifting it mid-session has to reach the sets
// that have not been done yet — and must not touch the one that has.
w = boot({
  stored: {
    version: 3,
    settings: { phaseOverride: 1 },
    exerciseState: { 'ring-dip': { level: 3, vest: 3, target: 6, topOutStreak: 0, failStreak: 0 } },
  },
});
check('Phase 1 shows the dip at bodyweight',
  /bodyweight/.test(card(w, 'ring-dip').querySelector('.ex-target').textContent), true);
rows(card(w, 'ring-dip'))[0].querySelector('[data-act="log-set"]').click();
tab(w, 'data');
const phaseSel = $(w, '#optPhase');
phaseSel.value = '3';
phaseSel.listeners.get('change')[0]();
tab(w, 'today');
check('forcing Phase 3 mid-session brings the vest back',
  /\+3 kg/.test(card(w, 'ring-dip').querySelector('.ex-target').textContent), true);
check('and the vest control picks it up',
  card(w, 'ring-dip').querySelector('.vest-val').textContent, '3 kg');
check('while the set already logged keeps what it was done at',
  stored(w).active.entries['ring-dip'].sets[0].load, 0);

// Descending sets are an endorsed technique, so per-set load has to survive.
w = boot({
  stored: {
    version: 3,
    settings: { phaseOverride: 3 },
    exerciseState: { 'ring-dip': { level: 3, vest: 3, target: 6, topOutStreak: 0, failStreak: 0 } },
  },
});
const dipVest = (n) => {
  for (let i = 0; i < n; i++) card(w, 'ring-dip').querySelector('[data-act="vest-dec"]').click();
};
rows(card(w, 'ring-dip'))[0].querySelector('[data-act="log-set"]').click();
dipVest(2);
rows(card(w, 'ring-dip'))[1].querySelector('[data-act="log-set"]').click();
dipVest(2);
rows(card(w, 'ring-dip'))[2].querySelector('[data-act="log-set"]').click();
check('stripping weight between sets records each set’s own load',
  stored(w).active.entries['ring-dip'].sets.map(s => s.load), [3, 2, 1]);
$$(w, '[data-act="finish"]')[0].click();
check('and the session log keeps them',
  stored(w).sessions[0].entries['ring-dip'].sets.map(s => s.load), [3, 2, 1]);
check('opening at the target still counts as a hit',
  stored(w).exerciseState['ring-dip'].target, 7);
check('the level performed at is recorded', stored(w).sessions[0].entries['ring-dip'].level, 3);

// Undo hands a set back to the plan without losing a rep count you typed.
w = boot();
rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="rep-inc"]').click();
rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="log-set"]').click();
rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="undo-set"]').click();
check('undo keeps the reps you typed', stored(w).active.entries['ring-pullup'].sets[0].value, 7);
check('but releases the load back to the plan',
  stored(w).active.entries['ring-pullup'].sets[0].load, null);
// A hold's number came from the clock, not from you, so undo drops it.
w = boot();
holdRow(w, 'dead-hang').querySelector('[data-act="start-hold"]').click();
w.advance(5000 + 9000);
holdRow(w, 'dead-hang').querySelector('[data-act="stop-hold"]').click();
holdRow(w, 'dead-hang').querySelector('[data-act="undo-set"]').click();
check('undoing a hold drops the measured time',
  stored(w).active.entries['dead-hang'].sets[0].value, null);
check('and the row is back to the target', /20/.test(holdRow(w, 'dead-hang').textContent), true);

// A v2 session in progress must survive the change untouched.
const v2session = {
  version: 2,
  sessions: [],
  exerciseState: {},
  active: {
    workout: 'A', startedAt: '2026-03-02T08:00:00.000Z', date: '2026-03-02', phaseId: 1, note: '',
    entries: {
      'ring-pullup': {
        vest: 0, level: 0, target: 6,
        sets: [{ value: 6, load: 0, done: true, at: '2026-03-02T08:05:00.000Z' },
               { value: 6, load: 0, done: false },
               { value: 6, load: 0, done: false }],
      },
    },
  },
};
const up = boot({ stored: v2session });
check('a v2 session in progress still loads',
  /In progress/.test($(up, '.session-head').textContent), true);
check('the frozen prescription is dropped',
  ['level', 'target'].filter(k => k in stored(up).active.entries['ring-pullup']), []);
check('the logged set is untouched',
  stored(up).active.entries['ring-pullup'].sets[0].value, 6);
check('and the numbers on screen are not moved under a running session',
  stored(up).active.entries['ring-pullup'].sets[1].value, 6);
works('and it can be finished', () => $$(up, '[data-act="finish"]')[0].click());
check('recording the session', stored(up).sessions.length, 1);

// ---------------------------------------------------------------- //
section('Stored data survives a reload');

w = boot();
rows(card(w, 'ring-dip'))[0].querySelector('[data-act="log-set"]').click();
const snapshot = w.localStorage.getItem(KEY);
let again = boot({ stored: JSON.parse(snapshot) });
check('a session in progress is picked back up',
  /In progress/.test($(again, '.session-head').textContent), true);
check('and the logged set is still logged',
  rows(card(again, 'ring-dip'))[0].classList.contains('set-row--done'), true);

// v1 data predates per-level ranges. It must load, not crash, and say what it
// changed rather than silently moving a number.
const v1 = boot({
  stored: {
    version: 1,
    sessions: [],
    exerciseState: { 'split-squat': { level: 4, vest: 0, target: 3, topOutStreak: 0, failStreak: 0 } },
  },
});
check('v1 data still loads', $$(v1, '.ex-card').length > 0, true);
check('and the user is told the target moved', $$(v1, '[data-act="dismiss-migration"]').length, 1);
check('naming the exercise and both numbers',
  /Split squats: target 3 → 6/.test($(v1, '.summary-panel').textContent), true);
works('the notice can be dismissed', () => $(v1, '[data-act="dismiss-migration"]').click());
check('and stays dismissed', $$(v1, '[data-act="dismiss-migration"]').length, 0);
check('the raised target is what the card shows',
  card(v1, 'split-squat').querySelector('.ex-target').textContent.includes('6 reps'), true);


// ---------------------------------------------------------------- //
section('Timers — the half that could not be tested before');

// Every assertion here depends on the clock, which is why none of them existed
// until app.js stopped calling Date.now() directly. The lead-in, the count-up,
// the failure case and the cancel are all logic that only ran on a real phone.

const clockText = (win) => {
  const el = win.document.getElementById('holdClock');
  return el ? el.textContent : null;
};

w = boot();
holdRow(w, 'dead-hang').querySelector('[data-act="start-hold"]').click();
check('a hold starts by counting you into position', clockText(w), '5');
w.advance(2000);
check('the countdown runs down', clockText(w), '3');
check('and the set is not counting yet',
  holdRow(w, 'dead-hang').querySelector('.set-val--lead') !== null, true);
w.advance(3000);
check('then the hold itself starts at zero', clockText(w), '0');
check('and the row switches to the running clock',
  holdRow(w, 'dead-hang').querySelector('.set-val--hold') !== null, true);
w.advance(12000);
check('the hold counts up', clockText(w), '12');
// A plank failed at 22 s against a 30 s target must log 22, not 30.
holdRow(w, 'dead-hang').querySelector('[data-act="stop-hold"]').click();
check('stopping logs the time actually held, not the target',
  stored(w).active.entries['dead-hang'].sets[0].value, 12);
check('and the row reads back what was held',
  /12 s/.test(holdRow(w, 'dead-hang').textContent), true);

// Reaching the target must not stop the clock — you can hold longer.
w = boot();
holdRow(w, 'dead-hang').querySelector('[data-act="start-hold"]').click();
w.advance(5000 + 20000);
check('reaching the target marks the row as hit',
  holdRow(w, 'dead-hang').classList.contains('set-row--hit'), true);
w.advance(6000);
check('but the clock keeps running past it', clockText(w), '26');
holdRow(w, 'dead-hang').querySelector('[data-act="stop-hold"]').click();
check('and the overshoot is what gets logged',
  stored(w).active.entries['dead-hang'].sets[0].value, 26);

// Cancelling during the count-in held nothing, so it must log nothing.
w = boot();
holdRow(w, 'dead-hang').querySelector('[data-act="start-hold"]').click();
w.advance(2000);
holdRow(w, 'dead-hang').querySelector('[data-act="stop-hold"]').click();
check('cancelling during the count-in logs nothing',
  stored(w).active.entries['dead-hang'].sets[0].done, false);
check('and offers Start again',
  holdRow(w, 'dead-hang').querySelectorAll('[data-act="start-hold"]').length, 1);

// A hold still running when you hit Finish still counts.
w = boot();
holdRow(w, 'dead-hang').querySelector('[data-act="start-hold"]').click();
w.advance(5000 + 30000);
$$(w, '[data-act="finish"]')[0].click();
check('a hold still running at Finish is logged, not thrown away',
  stored(w).sessions[0].entries['dead-hang'].sets[0].value, 30);

// The countdown can be turned off entirely.
w = boot({ stored: { version: 2, settings: { holdLeadIn: 0 } } });
holdRow(w, 'dead-hang').querySelector('[data-act="start-hold"]').click();
check('with no lead-in the hold starts immediately', clockText(w), '0');

// ---------------------------------------------------------------- //
section('The rest bar');

w = boot();
rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="log-set"]').click();
const restBar = () => w.document.getElementById('restBar');
check('rest starts at the exercise’s own interval',
  w.document.getElementById('restTime').textContent, '2:30');
w.advance(60000);
check('and counts down', w.document.getElementById('restTime').textContent, '1:30');
check('naming the set it is resting before',
  /Pull-ups/.test(w.document.getElementById('restLabel').textContent), true);
w.advance(89000);
check('still running with a second to go', restBar().hidden, false);
w.advance(2000);
check('then it hides itself', restBar().hidden, true);

// +30s and skip are the two controls that exist mid-rest.
w = boot();
rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="log-set"]').click();
w.document.getElementById('restAdd').click();
check('+30s extends the rest', w.document.getElementById('restTime').textContent, '3:00');
w.document.getElementById('restSkip').click();
check('skip ends it', restBar().hidden, true);
w.advance(5000);
check('and it stays ended', restBar().hidden, true);

// Turning the rest timer off means no bar at all.
w = boot({ stored: { version: 2, settings: { restTimer: false } } });
rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="log-set"]').click();
check('with the rest timer off nothing appears', restBar().hidden, true);
check('but the set is still logged',
  rows(card(w, 'ring-pullup'))[0].classList.contains('set-row--done'), true);

// ---------------------------------------------------------------- //
section('Elapsed time and phase rollover');

w = boot();
$(w, '[data-act="start"]').click();
w.advance(65000);
check('the session clock ticks', $(w, '#sessionElapsed').textContent, '1:05');

// A phase needs BOTH the sessions and the calendar weeks. Only a clock the
// test controls can prove the second half.
const nineSessions = (fromISO) => ({
  version: 2,
  sessions: Array.from({ length: 9 }, () => ({ date: fromISO, workout: 'A', phaseId: 1, entries: {} })),
  exerciseState: {},
});
let early = boot({ stored: nineSessions('2026-03-01') });
check('nine sessions in one week is still Phase 1',
  /Phase 1/.test($(early, '#phaseBadge').textContent), true);
let later = boot({ stored: nineSessions('2026-02-01'), startTime: Date.parse('2026-03-02T09:00:00Z') });
check('nine sessions and four weeks is Phase 2',
  /Phase 2/.test($(later, '#phaseBadge').textContent), true);
// The Program tab lists every phase, so asserting on phase text there proves
// nothing — it is the "you are here" marker that has to move.
tab(later, 'program');
check('and the Program tab marks Phase 2 as the current one',
  $(later, '.phase--now .phase-n').textContent, 'Phase 2');
tab(later, 'today');
check('the vest control appears once load progression unlocks',
  card(later, 'ring-dip').querySelectorAll('.vest-row').length, 1);
check('and was absent in Phase 1',
  card(early, 'ring-dip').querySelectorAll('.vest-row').length, 0);


// ---------------------------------------------------------------- //
section('Rendering does not throw the page away');

// The bug this closes: collect the log buttons, tap the first, and every other
// one is detached. Clicking them does nothing, raises nothing, and is
// indistinguishable from a broken handler. It caught me by hand during the
// browser check for the previous change.
w = boot();
const allLogButtons = $$(w, '.set-row [data-act="log-set"]');
check('there are plenty of buttons to hold on to', allLogButtons.length > 15, true);
works('clicking a whole session’s worth of held references', () => {
  for (const b of allLogButtons) b.click();
});
check('every one of them logged its set',
  $$(w, '.set-row--done').length, allLogButtons.length);

// Node identity is the mechanism. A card untouched by a tap elsewhere must be
// the same object afterwards.
w = boot();
const dipCard = card(w, 'ring-dip');
const pullRow = rows(card(w, 'ring-pullup'))[0];
rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="log-set"]').click();
check('an unrelated card survives the render', card(w, 'ring-dip') === dipCard, true);
check('and so does the row that changed', rows(card(w, 'ring-pullup'))[0] === pullRow, true);
check('with its new state applied', pullRow.classList.contains('set-row--done'), true);

// Settings listeners are bound once, not once per render.
w = boot();
tab(w, 'data');
const capSel = $(w, '#optCap');
// Renders WITHIN the tab. Leaving the tab empties the view, so nothing there
// can survive that — but staying put and re-rendering four times must not
// rebuild the control under the user, nor stack a listener each time.
const fire = (sel, value) => {
  $(w, sel).value = value;
  $(w, sel).listeners.get('change').forEach(fn => fn());
};
fire('#optSound', 'beep');
fire('#optSound', 'voice');
fire('#optLead', '3');
fire('#optLead', '5');
check('the settings select is the same node after four renders', $(w, '#optCap') === capSel, true);
check('and carries exactly one binding marker', $(w, '#optCap').boundTo, 'change');
check('one change handler, not four', $(w, '#optCap').listeners.get('change').length, 1);
fire('#optCap', '40');
check('and it took effect', stored(w).settings.sessionCapMin, 40);
check('the select shows the new value after its own re-render', $(w, '#optCap').value, '40');

// The session note is user input; a re-render must not eat what is half typed.
w = boot();
$(w, '[data-act="start"]').click();
const note = $(w, '#sessionNote');
note.value = 'left shoulder fine';
note.listeners.get('input').forEach(fn => fn());
rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="log-set"]').click();
check('the note element survives a render', $(w, '#sessionNote') === note, true);
check('and keeps what was typed', $(w, '#sessionNote').value, 'left shoulder fine');
check('and it is stored', stored(w).active.note, 'left shoulder fine');
$$(w, '[data-act="finish"]')[0].click();
check('finishing files the note with the session', stored(w).sessions[0].note, 'left shoulder fine');
check('and the box is empty for the next one', $(w, '#sessionNote').value, '');




// ---------------------------------------------------------------- //
section('The waits make a sound');

// audio.js proves the rules of a cue on its own. This proves the app asks for
// one at the right moment — including between SETS, not only between exercises.
//
// Every announcement is deliberately held back ~600 ms so a sleeping Bluetooth
// link has woken by the time the words start, so these advance a second past
// the moment to let the cue actually land.
const said = (win) => win.heard.filter((h) => h.said).map((h) => h.said);
const beeps = (win) => win.heard.filter((h) => h.beep).length;
const settle = (win) => win.advance(1000);

w = boot({ listen: true });
rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="log-set"]').click();
check('logging a set makes no noise by itself', w.heard.length, 0);
w.advance(140000);
settle(w);
check('ten seconds out, it warns you', said(w), ['Ten seconds']);
w.advance(4000);
check('once, not every tick', said(w).filter((t) => t === 'Ten seconds').length, 1);
w.advance(6000);
check('the wait between SETS ends with a beep', beeps(w), 1);
settle(w);
// The numbers matter as much as the name — otherwise you have to pick the
// phone up off the floor to find out what you were just told to do.
check('and says which set is next, with the numbers',
  said(w).pop(), 'Pull-ups, set 2, 6 reps');

// And between exercises, naming the exercise rather than just the set.
w = boot({ listen: true });
for (const r of rows(card(w, 'ring-pullup'))) r.querySelector('[data-act="log-set"]').click();
w.advance(151000);
settle(w);
check('the wait between EXERCISES also sounds', beeps(w), 1);
check('naming what comes next', said(w).pop(), 'Hanging leg raises, set 1, 8 reps');

// A superset has no wait mid-round, so there is nothing to count down — but you
// still have to be told to go, or you would stand there waiting for a beep.
w = boot({ listen: true });
rows(card(w, 'split-squat'))[0].querySelector('[data-act="log-set"]').click();
settle(w);
check('mid-pair it tells you to go straight over',
  said(w), ['Face pulls, set 1, 12 reps, now']);
check('with no beep, because there is no wait', beeps(w), 0);
check('and no clock running', $(w, '#restBar').hidden, true);

// A wait you started by hand is the same wait — it used to beep and say
// nothing, which tells you the time is up but not what to do.
w = boot({ listen: true });
$(w, '[data-act="start"]').click();
card(w, 'ring-dip').querySelectorAll('.rest-step')[0].click();
w.advance(151000);
settle(w);
check('a wait you tapped ends the same way', beeps(w), 1);
check('and says the same thing', said(w).pop(), 'Dips, set 2, 6 reps');

// Timed work is announced in seconds, per-side work says so, and the vest is
// mentioned only when it is actually on.
w = boot({ listen: true });
rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="log-set"]').click();
w.advance(151000); settle(w);
check('reps are called reps', /\d+ reps$/.test(said(w).pop()), true);

// Pull-ups rather than dips: dips are supersetted, so the cue after them names
// the partner, not their own next set.
w = boot({ listen: true, stored: { version: 3, settings: { phaseOverride: 3 },
  exerciseState: { 'ring-pullup': { level: 2, vest: 2, target: 6, topOutStreak: 0, failStreak: 0 } } } });
rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="log-set"]').click();
w.advance(151000); settle(w);
check('a loaded exercise says the weight', said(w).pop(), 'Pull-ups, set 2, 6 reps, 2 kilos');
// And an unloaded one does not say "bodyweight" every single time.
check('an unloaded one stays quiet about it',
  /kilo/.test((() => {
    const q = boot({ listen: true });
    rows(card(q, 'ring-pullup'))[0].querySelector('[data-act="log-set"]').click();
    q.advance(151000); q.advance(1000);
    return q.heard.filter((h) => h.said).pop().said;
  })()), false);

w = boot({ listen: true, stored: { version: 3,
  exerciseState: { 'split-squat': { level: 4, vest: 0, target: 6, topOutStreak: 0, failStreak: 0 } } } });
rows(card(w, 'split-squat'))[0].querySelector('[data-act="log-set"]').click();
settle(w);
check('a single-leg level says per side',
  said(w).pop(), 'Face pulls, set 1, 12 reps, now');
w = boot({ listen: true, stored: { version: 3,
  exerciseState: { 'ring-leg-curl': { level: 4, vest: 0, target: 8, topOutStreak: 0, failStreak: 0 } } } });
$$(w, '.pick-btn').find((b) => b.dataset.w === 'B').click();
rows(card(w, 'ring-leg-curl'))[0].querySelector('[data-act="log-set"]').click();
w.advance(91000); settle(w);
check('per side is announced', /per side/.test(said(w).pop()), true);

// A hold is the one thing here with no reps to count, and you cannot look at
// the phone while hanging off the rings — so the seconds get called out.
w = boot({ listen: true });
holdRow(w, 'dead-hang').querySelector('[data-act="start-hold"]').click();
w.advance(5000);       // through the count-in
settle(w);
const marks = () => said(w).filter((t) => /^\d+$/.test(t));
w.advance(10000);
settle(w);
check('ten seconds in, it says so', marks(), ['10']);
w.advance(5000);
check('and not again before the next mark', marks(), ['10']);
w.advance(5000);
settle(w);
// The target here is 20 s and has its own announcement — saying "20" and
// "20 seconds" a beat apart would be daft.
check('the target is announced once, not twice', said(w).slice(-2), ['10', '20 seconds']);
w.advance(10000);
settle(w);
check('and it keeps counting past the target', marks(), ['10', '30']);
w.advance(10000);
settle(w);
check('for as long as you hold it', marks(), ['10', '30', '40']);
// 45 s of clock have gone by at this point (the settles count too), and the
// count-out changes nothing about what is recorded — the clock does that.
holdRow(w, 'dead-hang').querySelector('[data-act="stop-hold"]').click();
check('the time actually held is what gets logged, not the last mark',
  stored(w).active.entries['dead-hang'].sets[0].value, 45);

// A dropped tick must not swallow a mark — a backgrounded tab throttles the
// interval, so matching an exact second would miss it.
w = boot({ listen: true });
holdRow(w, 'dead-hang').querySelector('[data-act="start-hold"]').click();
w.advance(5000);
w.CLOCK.t += 12000;    // twelve seconds pass with no tick at all
w.advance(1000);
settle(w);
check('a mark is not lost when a tick is skipped', marks(), ['10']);

// The interval is configurable, including off.
w = boot({ listen: true, stored: { version: 3, settings: { holdCallEvery: 0 } } });
holdRow(w, 'dead-hang').querySelector('[data-act="start-hold"]').click();
w.advance(5000 + 15000);
settle(w);
check('with the count-out off, nothing is said before the target', marks(), []);
w.advance(6000);
settle(w);
check('but the target still is', said(w).pop(), '20 seconds');

w = boot({ listen: true, stored: { version: 3, settings: { holdCallEvery: 5 } } });
holdRow(w, 'dead-hang').querySelector('[data-act="start-hold"]').click();
w.advance(5000 + 16000);
settle(w);
check('a shorter interval calls out more often', marks(), ['5', '10', '15']);

// It follows the sound setting like everything else.
w = boot({ listen: true, stored: { version: 3, settings: { sound: 'beep' } } });
holdRow(w, 'dead-hang').querySelector('[data-act="start-hold"]').click();
w.advance(5000 + 12000);
settle(w);
check('beep-only mode stays quiet through a hold', said(w), []);

// A hold reaching its target is its own cue, separate from any rest.
w = boot({ listen: true });
holdRow(w, 'dead-hang').querySelector('[data-act="start-hold"]').click();
settle(w);
check('starting a hold counts you in', said(w), ['Get ready']);
w.advance(5000);
check('then tells you to go', said(w).pop(), 'Go');
w.advance(21000);
check('and calls the target when you reach it', said(w).pop(), '20 seconds');
check('with a beep at each of those', beeps(w) >= 2, true);

// Silence means silence, everywhere.
w = boot({ listen: true, stored: { version: 3, settings: { sound: 'off' } } });
rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="log-set"]').click();
w.advance(200000);
check('with sound off nothing is played at all', w.heard.length, 0);
check('but the timer still ran to the end', $(w, '#restBar').hidden, true);

w = boot({ listen: true, stored: { version: 3, settings: { sound: 'beep' } } });
rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="log-set"]').click();
w.advance(200000);
check('beep-only still marks the end of the wait', beeps(w), 1);
check('without saying anything', said(w), []);

// ---------------------------------------------------------------- //
section('Every wait is a step you can see');

// Rest is most of a session — 150 s between sets of pull-ups against about 18 s
// of actual pulling — and it used to exist only as a bar at the bottom of the
// screen, and only once a set had been logged. The page read as if the sets ran
// back to back.
w = boot();
const steps = (win, id) =>
  card(win, id).querySelectorAll('.set-row, .rest-step')
    .map(e => (e.classList.contains('rest-step') ? 'rest' : 'set'));

check('sets and rests alternate inside a card',
  steps(w, 'ring-pullup'), ['set', 'rest', 'set', 'rest', 'set']);
check('the wait says how long it is',
  card(w, 'ring-pullup').querySelector('.rest-step').textContent.includes('150 s'), true);
// The rest after the LAST set is the one drawn between the cards, so it must
// not be repeated inside.
check('there is one fewer rest than sets',
  card(w, 'ring-pullup').querySelectorAll('.rest-step').length,
  rows(card(w, 'ring-pullup')).length - 1);
check('and one between the exercises', $$(w, '.flow--rest').length > 0, true);
check('naming what it is a wait before',
  /before/.test($(w, '.flow--rest').textContent), true);
// No rest steps in the warm-up — you flow straight through it.
check('the warm-up has no waits to show',
  card(w, 'movement-prep').querySelectorAll('.rest-step').length, 0);

// A superset's wait comes AFTER the partner. Saying "rest 90 s" here would have
// you standing still through the half of the round you should be doing.
check('a paired exercise says the partner comes first',
  card(w, 'split-squat').querySelector('.rest-step').textContent,
  '⇄ Face pulls, then rest 90 s');

// The one that is running shows the clock, in the sequence and in the bar.
w = boot();
rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="log-set"]').click();
const liveStep = () => card(w, 'ring-pullup').querySelector('.rest-step--live');
check('the wait that is running goes live', !!liveStep(), true);
check('showing the same clock as the bar',
  [liveStep().querySelector('.rs-clock').textContent, $(w, '#restTime').textContent],
  ['2:30', '2:30']);
check('and saying what it is holding you before',
  /set 2 next/.test(liveStep().textContent), true);
check('exactly one step is live at a time', $$(w, '.rest-step--live').length, 1);
check('and it is the one after the set just logged',
  card(w, 'ring-pullup').querySelectorAll('.set-row, .rest-step')[1].classList.contains('rest-step--live'),
  true);

w.advance(60000);
check('it counts down in the card, not only in the bar',
  liveStep().querySelector('.rs-clock').textContent, '1:30');
w.advance(91000);
check('and when it runs out the card stops showing a clock', $$(w, '.rest-step--live').length, 0);
check('the bar is gone too', $(w, '#restBar').hidden, true);
check('but the step is still there, waiting to be used again',
  card(w, 'ring-pullup').querySelectorAll('.rest-step').length, 2);

// Skipping from inside the session, not only from the bar.
w = boot();
rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="log-set"]').click();
works('skipping the wait from the card', () =>
  card(w, 'ring-pullup').querySelector('[data-act="rest-skip"]').click());
check('ends it', $$(w, '.rest-step--live').length, 0);
check('and hides the bar', $(w, '#restBar').hidden, true);

// Tapping a wait that has not started yet starts it there.
w = boot();
$(w, '[data-act="start"]').click();
const upcoming = card(w, 'ring-dip').querySelectorAll('.rest-step')[0];
works('tapping an upcoming wait starts it', () => upcoming.click());
check('and it lights up where it was tapped',
  card(w, 'ring-dip').querySelectorAll('.rest-step')[0].classList.contains('rest-step--live'), true);
check('not somewhere else', $$(w, '.rest-step--live').length, 1);

// With the rest timer switched off nothing counts, but the waits still show —
// you still need to know how long to stand there.
w = boot({ stored: { version: 3, settings: { restTimer: false } } });
rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="log-set"]').click();
check('with the timer off nothing goes live', $$(w, '.rest-step--live').length, 0);
check('but the waits are still written down',
  card(w, 'ring-pullup').querySelectorAll('.rest-step').length, 2);


// ---------------------------------------------------------------- //
section('Am I going to finish?');

// The failure this closes: workout B ran out of time, the last three exercises
// were never done, and nothing warned anybody. The app showed the estimate it
// made before the session and a clock counting up — neither of which answers
// the question you have at minute 35.
const pace = (win) => ($(win, '#pacing') || { textContent: '' }).textContent;

w = boot();
check('nothing is claimed before a session starts', $$(w, '#pacing').length, 0);
$(w, '[data-act="start"]').click();
check('and nothing while there is too little behind you to mean anything',
  $$(w, '#pacing').length, 0);

// Log through the warm-up and a couple of working sets, on model.
for (let i = 0; i < 4; i++) {
  const b = $(w, '.set-row [data-act="log-set"]');
  if (!b) break;
  b.click();
  w.advance(150000);
}
check('once there is a session behind you, it says what is left',
  /~\d+ min left/.test(pace(w)), true);
check('and when you will finish', /finishing about \d\d:\d\d/.test(pace(w)), true);

// Running slow has to stretch the estimate, or the warning arrives too late.
w = boot({ stored: { version: 3, settings: { sessionCapMin: 40 } } });
$(w, '[data-act="start"]').click();
for (let i = 0; i < 3; i++) {
  const b = $(w, '.set-row [data-act="log-set"]');
  if (b) b.click();
  w.advance(420000); // seven minutes a set — well off the pace
}
check('a slow session is called slow', /running \d+% slow/.test(pace(w)), true);
check('and flagged against the cap you set', $(w, '#pacing').classList.contains('pace--over'), true);
check('with a reason to act now rather than later',
  /while there is still something to cut/.test(pace(w)), true);

// A quick session should not be nagged at.
w = boot({ stored: { version: 3, settings: { sessionCapMin: 50 } } });
$(w, '[data-act="start"]').click();
for (let i = 0; i < 4; i++) {
  const b = $(w, '.set-row [data-act="log-set"]');
  if (b) b.click();
  w.advance(20000);
}
check('a fast session says so instead', /% ahead/.test(pace(w)), true);
check('and is not flagged', $(w, '#pacing').classList.contains('pace--over'), false);

// And when there is nothing left, say that rather than a countdown to zero.
w = boot();
for (let i = 0; i < 60; i++) {
  const b = $(w, '.set-row [data-act="log-set"]');
  if (!b) break;
  b.click();
  w.advance(60000);
}
check('everything logged reads as done, not as zero minutes left',
  $(w, '.pace--done').textContent, 'Everything is logged. Hit Finish.');

// ---------------------------------------------------------------- //
section('Where you are');

// A session is eleven cards on a long scrolling page. Without a marker you
// find your place by scanning for the first unlogged set, which is exactly the
// thinking this app exists to remove.
w = boot();
check('exactly one card is marked', $$(w, '.ex-card--now').length, 1);
check('and before you start it is the first thing', nowCard(w), 'movement-prep');
check('it says so on the card', card(w, 'movement-prep').querySelector('.tag-now').textContent, 'now');

// The marker follows what you actually do, not a fixed order.
w = boot();
rows(card(w, 'movement-prep'))[0].querySelector('[data-act="start-hold"]').click();
check('a running hold is what you are on', nowCard(w), 'movement-prep');
w.advance(5000 + 180000);
holdRow(w, 'movement-prep').querySelector('[data-act="stop-hold"]').click();
check('finishing it moves the marker on', nowCard(w), 'dead-hang');

// Within a card, the next set is picked out too.
w = boot();
check('the first set is flagged as next',
  rows(card(w, 'ring-pullup'))[0].classList.contains('set-row--next'), false);
for (const id of ['movement-prep', 'dead-hang']) {
  // Skip the timed warm-up entries by logging them by hand.
  const r = rows(card(w, id))[0];
  if (r.querySelector('[data-act="start-hold"]')) {
    r.querySelector('[data-act="start-hold"]').click();
    w.advance(400000);
    holdRow(w, id).querySelector('[data-act="stop-hold"]').click();
  }
}
check('the marker reached the scap pulls', nowCard(w), 'ring-scap-pull');
check('and the set to do is picked out',
  rows(card(w, 'ring-scap-pull'))[0].classList.contains('set-row--next'), true);
rows(card(w, 'ring-scap-pull'))[0].querySelector('[data-act="log-set"]').click();
check('logging it moves the marker to the next exercise', nowCard(w), 'ring-pullup');
check('and only one card is ever marked', $$(w, '.ex-card--now').length, 1);

// A superset runs by round: A1 B1 rest A2 B2. The marker has to follow that,
// or it would send you back to the first exercise for its second set.
w = boot({ stored: { version: 3, settings: { sessionCapMin: 0 } } });
rows(card(w, 'split-squat'))[0].querySelector('[data-act="log-set"]').click();
check('mid-pair the marker crosses to the partner', nowCard(w), 'ring-facepull');
rows(card(w, 'ring-facepull'))[0].querySelector('[data-act="log-set"]').click();
check('and comes back for the second round', nowCard(w), 'split-squat');
check('at the right set',
  rows(card(w, 'split-squat'))[1].classList.contains('set-row--next'), true);

// Undoing a set has to put the marker back, or it would point past your place.
rows(card(w, 'split-squat'))[0].querySelector('[data-act="undo-set"]').click();
check('undo brings the marker back', nowCard(w), 'split-squat');
// Reopening a set is a deliberate "redo this", so it beats the forward order —
// pointing past the row you just put back would be perverse.
check('to the very set that was reopened',
  rows(card(w, 'split-squat'))[0].classList.contains('set-row--next'), true);
rows(card(w, 'split-squat'))[0].querySelector('[data-act="log-set"]').click();
// Round 0 of the pair is complete again, so round 1 opens with the same
// exercise — the marker follows the pair, not the card order.
check('and logging it releases the marker to the next round', nowCard(w), 'split-squat');
check('at the second set',
  rows(card(w, 'split-squat'))[1].classList.contains('set-row--next'), true);

// Skipping something must not strand the marker on it for the rest of the
// session — but the skipped set has to stay reachable.
w = boot({ stored: { version: 3 } });
rows(card(w, 'ring-row'))[0].querySelector('[data-act="log-set"]').click();
check('logging something late moves the marker past what you skipped',
  nowCard(w), 'ring-dip');
check('and the skipped warm-up is not marked',
  card(w, 'movement-prep').classList.contains('ex-card--now'), false);

// Everything logged means nothing is marked, rather than something wrong.
// Timed sets carry a ✓ as well as Start, so this really does finish the lot.
w = boot();
for (let i = 0; i < 60; i++) {
  const b = $(w, '.set-row [data-act="log-set"]');
  if (!b) break;
  b.click();
}
check('a fully logged session marks nothing', $$(w, '.ex-card--now').length, 0);
check('and every set is done',
  $$(w, '.set-row').filter((r) => !r.classList.contains('set-row--done')).length, 0);

// ---------------------------------------------------------------- //
section('When something breaks');

// The failure mode this replaces: a blank or frozen page, the reason in a
// console nobody opens on a phone, and no way to tell a rendering bug from
// lost training data.
w = boot();
rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="log-set"]').click();
check('the banner is hidden while everything works', banner(w).hidden, true);

// Break the program data underneath a running app.
w.PROGRAM.stations = {};
tab(w, 'history');
tab(w, 'today');
check('a broken render shows the banner instead of a dead page', banner(w).hidden, false);
check('it names what was happening',
  /drawing the page/.test($(w, '#crashWhere').textContent), true);
check('and reports the actual error', $(w, '.crash-what').textContent.length > 5, true);
check('it promises the logged sets are safe',
  /already saved in this browser/.test(banner(w).textContent), true);
check('and they are', stored(w).active.entries['ring-pullup'].sets[0].done, true);

check('a backup can be taken from the banner', $(w, '#crashExport') !== null, true);
noThrow('and taking one does not throw again', () => $(w, '#crashExport').click());
check('reload is offered', (() => {
  $(w, '#crashReload').click();
  return w.location.reloads;
})(), 1);
$(w, '#crashHide').click();
check('and it can be dismissed', banner(w).hidden, true);

// The banner's own buttons are bound directly rather than through the delegated
// click handler — if that handler is what broke, they still have to work.
const src = read('app.js');
check('the banner buttons do not depend on the delegated handler',
  /getElementById\("crashReload"\)\.addEventListener/.test(src), true);

// One bad tap must not kill the listener and take every other button with it.
w = boot();
w.PROGRAM.exercises['ring-pullup'].ladder = 'not a ladder';
$(w, '.ex-card [data-act="toggle-info"]').click();
w.PROGRAM.exercises['ring-pullup'].ladder = [{ name: 'Feet assisted, heavy' }];
$(w, '#crashHide').click();
noThrow('the page still responds after a failed tab', () => tab(w, 'program'));
check('and the tab actually switched', $(w, '#view-program').hidden, false);

// Every render path is guarded, not just the one that happened to break.
check('the render and the tap handler are both wrapped',
  [/function render\(\)\s*\{\s*try\s*\{\s*draw\(\);/.test(src),
   /addEventListener\("click", guard\(/.test(src),
   /setInterval\(guard\(/.test(src)],
  [true, true, true]);
check('and anything that escapes them is caught globally',
  [/addEventListener\("error"/.test(src), /addEventListener\("unhandledrejection"/.test(src)],
  [true, true]);


// ---------------------------------------------------------------- //
section('Everything you see survives a reload');

// There are 32 hand-written save() calls in app.js. Miss one and the change is
// silently lost when you close the tab — invisible until it bites, and no
// reviewer catches it. Rather than trust all 32, assert the property: after any
// action, booting fresh from storage has to show the same thing.
const visible = (win) => ({
  header: $(win, '.session-head h2').textContent.trim(),
  meta: $(win, '.sh-meta').textContent.replace(/~\d+ min/, '~N min').trim(),
  cap: ($(win, '.cap--on') || { textContent: '' }).textContent.trim(),
  picker: $$(win, '.pick-btn--on').map((b) => b.textContent).join(''),
  cards: $$(win, '.ex-card').length,
  targets: $$(win, '.ex-target').map((e) => e.textContent.trim()),
  levels: $$(win, '.ex-level').map((e) => e.textContent.trim()),
  done: $$(win, '.set-row--done').length,
  skipped: $$(win, '.set-row--skipped').length,
  extra: $$(win, '.set-row--extra').length,
  off: $$(win, '.ex-card--off').length,
  now: nowCard(win),
  /* The numbers ON the sets, not just how many are done — a rep you nudged is
   * a change that has to survive too. */
  setValues: $$(win, '.set-val').map((e) => e.textContent.trim()),
  note: ($(win, '#sessionNote') || { value: '' }).value,
  sessions: (stored(win) || { sessions: [] }).sessions.length,
});

function persists(label, act) {
  const before = JSON.stringify(visible(w));
  act();
  const after = visible(w);
  /* Boot a second app from nothing but what was written to storage. If the
   * action forgot to save, this comes back looking like the world before it. */
  const reloaded = visible(boot({ stored: stored(w) }));
  if (JSON.stringify(after) === before) {
    return check(label + ' — (nothing changed, test is vacuous)', 'changed', 'changed');
  }
  return check(label, reloaded, after);
}

w = boot();
persists('picking the other workout', () =>
  $$(w, '.pick-btn').find((b) => b.dataset.w === 'B').click());
persists('picking back', () =>
  $$(w, '.pick-btn').find((b) => b.dataset.w === 'A').click());
persists('capping the session', () =>
  $$(w, '[data-act="set-cap"]').find((b) => b.dataset.cap === '40').click());
persists('going back to full', () =>
  $$(w, '[data-act="set-cap"]').find((b) => b.dataset.cap === '0').click());
persists('starting a session', () => $(w, '[data-act="start"]').click());
persists('logging a set', () =>
  rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="log-set"]').click());
persists('changing the reps on a set', () =>
  rows(card(w, 'ring-pullup'))[1].querySelector('[data-act="rep-inc"]').click());
persists('undoing a set', () =>
  rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="undo-set"]').click());
persists('logging it again, so the session has something in it', () =>
  rows(card(w, 'ring-pullup'))[0].querySelector('[data-act="log-set"]').click());
persists('adding an extra set', () =>
  card(w, 'ring-row').querySelector('[data-act="add-set"]').click());
persists('cutting a set', () => cut(w, 'hanging-leg-raise', 2));
persists('skipping a whole exercise', () =>
  card(w, 'calf-raise').querySelector('[data-act="skip-exercise"]').click());
persists('putting it back', () =>
  card(w, 'calf-raise').querySelector('[data-act="skip-exercise"]').click());
persists('moving a level by hand', () => {
  card(w, 'ring-dip').querySelector('[data-act="toggle-info"]').click();
  card(w, 'ring-dip').querySelector('[data-act="level-inc"]').click();
});
persists('typing a session note', () => {
  const n = $(w, '#sessionNote');
  n.value = 'left shoulder fine';
  n.listeners.get('input').forEach((fn) => fn());
});
persists('finishing the session', () => $$(w, '[data-act="finish"]')[0].click());

// Settings live in the same object and go through the same save().
w = boot();
tab(w, 'data');
for (const [sel, value, label] of [
  ['#optCap', '30', 'the session cap'],
  ['#optPhase', '3', 'a forced phase'],
  ['#optLead', '3', 'the count-in'],
  ['#optSound', 'beep', 'the sound mode'],
]) {
  $(w, sel).value = value;
  $(w, sel).listeners.get('change').forEach((fn) => fn());
  const fresh = boot({ stored: stored(w) });
  tab(fresh, 'data');
  check(`${label} survives a reload`, $(fresh, sel).value, value);
}
tab(w, 'today');

// The above compares what is SHOWN, which misses a setting written by the app
// but never declared in DEFAULT_SETTINGS: load() copies only the keys it knows,
// so such a setting is saved and then silently dropped on the way back in. That
// is how the exercise swap was lost across a reload while its own test — which
// checked what was WRITTEN and never re-booted — passed throughout.
w = boot();
$$(w, '.pick-btn').find((b) => b.dataset.w === 'B').click();
swapTo(w, 'ring-fallout', 'plank');
$$(w, '[data-act="toggle-kit"]').find((b) => b.dataset.kit === 'straps').click();
$$(w, '[data-act="set-cap"]').find((b) => b.dataset.cap === '40').click();
const settled = stored(w).settings;
const reloaded = boot({ stored: stored(w) });
$$(reloaded, '[data-act="set-cap"]').find((b) => b.dataset.cap === '40').click();
check('every setting the app writes is a setting it can read back',
  Object.keys(stored(reloaded).settings).sort(), Object.keys(settled).sort());
check('and comes back with the same value', stored(reloaded).settings, settled);

// The two deliberate exceptions, so nobody "fixes" them later.
w = boot();
card(w, 'ring-dip').querySelector('[data-act="toggle-info"]').click();
check('an open details panel is NOT persisted, on purpose',
  $$(boot({ stored: stored(w) }), '.ex-info').filter((e) => !e.hidden).length, 0);


// ---------------------------------------------------------------- //
section('What the week actually trained');

// From the real export: 41 sets logged across two sessions — a healthy-looking
// number — with every hip-dominant and every overhead set missing. Nothing in
// the app said so, because a total cannot.
const week = (win) => $$(win, '.cov-row').map((r) => ({
  name: r.querySelector('.cov-name').textContent,
  n: r.querySelector('.cov-n').textContent,
  missed: r.classList.contains('cov-row--missed'),
}));
const session = (workout, ids, date) => ({
  date, workout, phaseId: 1, startedAt: date + 'T09:00:00.000Z', durationSec: 2400, note: '',
  entries: Object.fromEntries(ids.map((id) => [id, {
    level: 0,
    sets: Array.from({ length: P.exercises[id].sets }, () => ({ value: 6, load: 0 })),
  }])),
});

w = boot();
tab(w, 'history');
check('nothing to show before the first session', $$(w, '.cov-row').length, 0);

// Exactly what happened: workout B lost its last three exercises to the clock.
w = boot({ stored: { version: 3, exerciseState: {}, sessions: [
  session('A', P.workouts.A.order.map((o) => o.id), '2026-03-01'),
  session('B', P.workouts.B.order.map((o) => o.id)
    .filter((id) => !['ring-leg-curl', 'pike-pushup', 'hip-thrust'].includes(id)), '2026-03-02'),
] } });
tab(w, 'history');
check('every pattern is listed', week(w).length > 10, true);
check('and the three that got nothing are called out',
  week(w).filter((r) => r.missed).map((r) => r.name),
  ['hip-dominant', 'knee flexion', 'overhead push']);
check('named in a sentence, not just coloured',
  $(w, '.cov-gap').textContent,
  'Barely trained: hip-dominant, knee flexion, overhead push.');
check('the ones that were covered read as met',
  week(w).find((r) => r.name === 'vertical pull').n, '6/6');
check('patterns are grouped into families',
  $$(w, '.cov-group').map((e) => e.textContent), ['core', 'legs', 'prehab', 'pull', 'push']);
// Every pattern needs a human label; a raw id leaking through means someone
// added a pattern and forgot the other half.
const rawIds = new Set(Object.values(P.exercises).map((e) => e.pattern));
check('no raw pattern id reaches the screen',
  week(w).map((r) => r.name).filter((n) => rawIds.has(n)), []);

// Both days in full and there is nothing to flag.
w = boot({ stored: { version: 3, exerciseState: {}, sessions: [
  session('A', P.workouts.A.order.map((o) => o.id), '2026-03-01'),
  session('B', P.workouts.B.order.map((o) => o.id), '2026-03-02'),
] } });
tab(w, 'history');
check('a complete week flags nothing', $$(w, '.cov-gap').length, 0);
check('and says so', $(w, '.cov-ok').textContent, 'Every pattern got work.');

// Only the last seven days.
w = boot({ stored: { version: 3, exerciseState: {}, sessions: [
  session('A', P.workouts.A.order.map((o) => o.id), '2026-02-01'),
] } });
tab(w, 'history');
check('a session from last month does not count as this week',
  week(w).every((r) => r.n.startsWith('0/')), true);

// ---------------------------------------------------------------- //
section('Settings');

w = boot();
tab(w, 'data');
check('the cap select matches the stored setting', $(w, '#optCap').value, '0');
check('the phase select offers automatic plus every phase',
  $(w, '#optPhase').querySelectorAll('option').length, P.phases.length + 1);
check('the rest timer is on by default', $(w, '#optRest').checked, true);
works('the sound test runs with no audio stack at all', () =>
  $$(w, '[data-act="test-sound"]')[0].click());
check('and reports honestly that there is no voice',
  /no voice available/.test($(w, '#soundMsg').textContent), true);
works('resetting progression asks and obeys', () => {
  w.confirmAnswer = true;
  $(w, '[data-act="reset-progress"]').click();
});
check('progression is cleared', stored(w).exerciseState, {});

// ---------------------------------------------------------------- //
section('Backups and storage failures are recoverable');

let damaged = boot({ stored: { version: 4, sessions: [], active: {} } });
check('a malformed active session falls back to a working page',
  /Workout A/.test($(damaged, '#sessionHead').textContent), true);
check('and shows a persistent recovery warning', $(damaged, '#storageWarning').hidden, false);
check('without overwriting the rejected stored data', stored(damaged).active, {});

let future = boot({ stored: { version: 999, sessions: [] } });
check('a backup from a future schema is refused',
  /newer version/.test($(future, '#storageWarningWhat').textContent), true);

let noStore = boot();
noStore.localStorage.failWrites = true;
$$(noStore, '.pick-btn').find(b => b.dataset.w === 'B').click();
check('a failed save is visible outside the console', $(noStore, '#storageWarning').hidden, false);
check('the warning offers an immediate backup',
  $(noStore, '#storageWarningExport').textContent, 'Download recovery data');

let importer = boot();
tab(importer, 'data');
let input = $(importer, '#importFile');
input.files = [{ text: JSON.stringify({ version: 4, sessions: [], active: {} }) }];
input.change();
check('a malformed import is rejected', /invalid workout/.test($(importer, '#dataMsg').textContent), true);
check('and never reaches localStorage', importer.localStorage.getItem(KEY), null);

input = $(importer, '#importFile');
input.files = [{ size: 6 * 1024 * 1024, text: '{}' }];
input.change();
check('an oversized import is rejected before it is read',
  /larger than 5 MB/.test($(importer, '#dataMsg').textContent), true);

input = $(importer, '#importFile');
input.files = [{ text: JSON.stringify({
  version: 4, settings: {}, exerciseState: {}, sessions: [], nextOverride: null,
  active: { workout: 'A', entries: {
    'ring-pullup': { sets: Array.from({ length: 101 }, () => ({ value: 6, load: 0 })) },
  } },
}) }];
input.change();
check('an import cannot create an unbounded set list',
  /too many sets/.test($(importer, '#dataMsg').textContent), true);
check('rejected complex data is still not committed', importer.localStorage.getItem(KEY), null);

input = $(importer, '#importFile');
input.files = [{ text: JSON.stringify({
  version: 4, settings: {}, exerciseState: {}, sessions: [], active: null, nextOverride: 'B',
}) }];
input.change();
check('a valid import is committed', stored(importer).nextOverride, 'B');
tab(importer, 'today');
check('and the imported state renders normally', /Workout B/.test($(importer, '#sessionHead').textContent), true);

// ---------------------------------------------------------------- //
section('Conflicting tabs and active-workout imports');
const stale = boot();
const otherTabPayload = JSON.stringify({ version: 4, sessions: [], active: null, nextOverride: 'B' });
stale.localStorage.setItem(KEY, otherTabPayload);
$(stale, '[data-act="start"]').click();
check('a stale tab cannot overwrite newer workout data', stale.localStorage.getItem(KEY), otherTabPayload);
check('a stale tab explains how to recover', $(stale, '#storageWarningWhat').textContent.includes('another tab'), true);

const activeImporter = boot();
$(activeImporter, '.ex-card[data-ex="ring-pullup"] [data-act="log-set"]').click();
tab(activeImporter, 'data');
const beforeImport = activeImporter.localStorage.getItem(KEY);
let importPrompts = 0;
activeImporter.confirm = () => { importPrompts++; return false; };
const activeInput = $(activeImporter, '#importFile');
activeInput.files = [{ text: JSON.stringify({ version: 4, sessions: [], active: null }) }];
activeInput.change();
check('replacing a first active workout requires confirmation', importPrompts, 1);
check('declining import preserves logged sets', activeImporter.localStorage.getItem(KEY), beforeImport);

report();
