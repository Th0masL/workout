// patch.js on its own, against the test DOM.
//
//   Run:  node tests/patch.test.mjs
//
// Everything here is about one property: a node that did not change keeps its
// identity. That is what stops element references going stale, listeners
// stacking up and the page jumping under your thumb mid-session.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { makeWindow } from './dom.mjs';
import { check, section, report } from './harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');


const win = makeWindow({});
vm.createContext(win);
vm.runInContext(readFileSync(join(root, 'patch.js'), 'utf8'), win, { filename: 'patch.js' });
const { patch, keyOf } = win.DomPatch;
const doc = win.document;

/** A detached host with some starting markup. */
function host(html) {
  const el = doc.createElement('div');
  el.innerHTML = html;
  return el;
}
const kids = (el) => el.children;

// ---------------------------------------------------------------- //
section('Identity survives');

let h = host('<p class="a">one</p><p class="b">two</p>');
let [first, second] = kids(h);
patch(h, '<p class="a">one</p><p class="b">CHANGED</p>');
check('an untouched node is the same object', kids(h)[0] === first, true);
check('and so is a node whose text changed', kids(h)[1] === second, true);
check('the text is updated', kids(h)[1].textContent, 'CHANGED');
check('and the untouched one is not', kids(h)[0].textContent, 'one');

// The failure that motivated all of this: hold a reference, re-render, click it.
h = host('<button id="go">go</button>');
const btn = kids(h)[0];
let clicks = 0;
btn.addEventListener('click', () => clicks++);
patch(h, '<button id="go">go</button>');
btn.click();
check('a reference held across a render still fires', clicks, 1);
check('and is still in the tree', kids(h)[0] === btn, true);
// A listener must not be attached twice just because the node survived.
patch(h, '<button id="go">go now</button>');
kids(h)[0].click();
check('the surviving node did not gain a second listener', clicks, 2);

// ---------------------------------------------------------------- //
section('Attributes');

h = host('<div id="x" class="one" data-keep="1" data-drop="2">t</div>');
const div = kids(h)[0];
patch(h, '<div id="x" class="two" data-keep="1" data-add="3">t</div>');
check('the node is reused', kids(h)[0] === div, true);
check('a changed attribute is updated', div.getAttribute('class'), 'two');
check('a new attribute is added', div.getAttribute('data-add'), '3');
check('an attribute that went away is removed', div.hasAttribute('data-drop'), false);
check('an unchanged one is left alone', div.getAttribute('data-keep'), '1');

// ---------------------------------------------------------------- //
section('Children added, removed and replaced');

h = host('<ul><li>a</li><li>b</li></ul>');
let ul = kids(h)[0];
patch(h, '<ul><li>a</li><li>b</li><li>c</li></ul>');
check('a new child is appended', ul.children.map(c => c.textContent), ['a', 'b', 'c']);
patch(h, '<ul><li>a</li></ul>');
check('surplus children are removed', ul.children.map(c => c.textContent), ['a']);
check('the list itself never moved', kids(h)[0] === ul, true);

h = host('<div><span>x</span></div>');
const span = kids(h)[0].children[0];
patch(h, '<div><b>x</b></div>');
check('a different tag is replaced, not mutated', kids(h)[0].children[0] === span, false);
check('and the new tag is in place', kids(h)[0].children[0].tagName, 'B');

// ---------------------------------------------------------------- //
section('Keys');

// data-ex and data-set are what identify a card and a row. Reusing the wrong
// one would move a logged set's state onto a different exercise.
h = host('<div data-ex="pushup">p</div>');
const pushup = kids(h)[0];
patch(h, '<div data-ex="ring-dip">d</div>');
check('a node with a different key is replaced', kids(h)[0] === pushup, false);
patch(h, '<div data-ex="ring-dip">dips</div>');
check('a node with the same key is reused', kids(h)[0].textContent, 'dips');
check('keyOf prefers the exercise, then the set, then the id',
  ['<div data-ex="a" id="z">', '<div data-set="2" id="z">', '<div id="z">', '<div>']
    .map(t => keyOf(host(t + '</div>').children[0])),
  ['a', '2', 'z', '']);

// ---------------------------------------------------------------- //
section('Form state');

// Markup carries the attribute; the browser keeps the state on the PROPERTY.
// Patching one does not move the other, so patch.js syncs it by hand — without
// that a select would keep showing the old choice forever.
h = host('<select id="s"><option value="0" selected>full</option><option value="30">30</option></select>');
const sel = kids(h)[0];
check('the select starts on the marked option', sel.value, '0');
patch(h, '<select id="s"><option value="0">full</option><option value="30" selected>30</option></select>');
check('the node is reused', kids(h)[0] === sel, true);
check('and the selection follows the markup', sel.value, '30');

h = host('<input id="c" type="checkbox" checked>');
const box = kids(h)[0];
check('a checkbox starts checked', box.checked, true);
patch(h, '<input id="c" type="checkbox">');
check('unchecking in the markup unchecks the property', box.checked, false);
patch(h, '<input id="c" type="checkbox" checked>');
check('and back again', box.checked, true);

// A textarea holds user input. Its children are its value, so patching them
// would fight the caret on every keystroke.
h = host('<textarea id="n">saved note</textarea>');
const ta = kids(h)[0];
ta.value = 'half-typed';
patch(h, '<textarea id="n">saved note</textarea>');
check('the textarea node survives', kids(h)[0] === ta, true);
check('and a render that disagrees wins, rather than drifting', ta.value, 'saved note');

// ---------------------------------------------------------------- //
section('A keyed node appearing among unkeyed siblings');

// The bug this catches shipped silently for weeks, because every keyed node in
// the app existed in BOTH trees. The first CONDITIONAL keyed node — a warning
// that shows up once you log a set — fired it: with no old node to match, it
// fell through to positional matching and ate the next unkeyed slot on the way
// past. Everything below then shifted by one, so <div class="sets"> was patched
// into the kit row and every set row underneath was rebuilt. The buttons the
// tap handler was holding went stale, and taps did nothing.
h = host('<div class="a"></div><div class="b"></div><div class="c">rows</div>');
const [a, b, cNode] = kids(h);
patch(h, '<div class="a"></div><div id="new">appeared</div>' +
         '<div class="b"></div><div class="c">rows</div>');
check('the new keyed node is inserted', kids(h).map(k => k.getAttribute('id') || k.className),
  ['a', 'new', 'b', 'c']);
check('and the unkeyed siblings below it keep their identity',
  [kids(h)[2] === b, kids(h)[3] === cNode], [true, true]);
check('so nothing below was rebuilt', kids(h)[0] === a, true);

// And it has to survive going away again, or the shift would just move.
patch(h, '<div class="a"></div><div class="b"></div><div class="c">rows</div>');
check('removing it puts the list back', kids(h).map(k => k.className), ['a', 'b', 'c']);
check('still without rebuilding', [kids(h)[1] === b, kids(h)[2] === cNode], [true, true]);

// The same node moving is a relocate, not a rebuild — that part already worked
// and must keep working now that keyed nodes never fall back to position.
h = host('<p id="x">x</p><p id="y">y</p>');
const [px, py] = kids(h);
patch(h, '<p id="y">y</p><p id="x">x</p>');
check('a keyed node that swapped places is moved, not remade',
  [kids(h)[0] === py, kids(h)[1] === px], [true, true]);

// ---------------------------------------------------------------- //
section('Emptying');

h = host('<p>a</p><p>b</p>');
patch(h, '');
check('patching to nothing clears the host', h.childNodes.length, 0);
patch(h, '<p>back</p>');
check('and it can be filled again', h.children.map(c => c.textContent), ['back']);

// ---------------------------------------------------------------- //
report();
