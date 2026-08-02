// The test DOM, tested.
//
//   Run:  node tests/dom.test.mjs
//
// tests/dom.mjs is the one piece of code here that everything else trusts and
// nothing checked. That is a bad place for a blind spot: when a shim is subtly
// wrong, the tests built on it do not fail — they pass, and say the wrong
// thing. It has already been wrong twice, both found by hand in a real browser:
// textContent was not decoding entities, and form state was being read off the
// attribute instead of the property.
//
// So every assertion below states a rule of the REAL DOM. Where the shim
// deliberately does less than a browser, it says so and pins the limit, because
// a documented gap is something you can reason about and a silent one is not.
import { makeWindow, Element } from './dom.mjs';
import { check, section, report } from './harness.mjs';


const win = makeWindow({});
const doc = win.document;
const el = (html) => { const d = doc.createElement('div'); d.innerHTML = html; return d; };
const one = (html) => el(html).children[0];

// ---------------------------------------------------------------- //
section('Parsing');

check('an element carries its attributes',
  [one('<a href="x" class="y">t</a>').getAttribute('href'), one('<a class="y">t</a>').className],
  ['x', 'y']);
check('a valueless attribute is the empty string', one('<div hidden>x</div>').getAttribute('hidden'), '');
check('single-quoted attributes parse too', one("<div title='a b'>x</div>").getAttribute('title'), 'a b');
check('an unquoted attribute parses', one('<div data-n=3>x</div>').getAttribute('data-n'), '3');
// The generated onerror chain is single-quoted inside a double-quoted attribute
// on purpose; the parser has to keep it intact or the test asserting that is
// meaningless.
check('single quotes survive inside a double-quoted attribute',
  one(`<img onerror="var c=['a.gif','b.gif'];">`).getAttribute('onerror'),
  "var c=['a.gif','b.gif'];");
check('void elements do not swallow their siblings',
  el('<img src="a"><p>after</p>').children.map(c => c.tagName), ['IMG', 'P']);
check('a self-closing tag is not left open',
  el('<br/><p>after</p>').children.map(c => c.tagName), ['BR', 'P']);
check('nesting is preserved',
  one('<div><span><b>deep</b></span></div>').children[0].children[0].textContent, 'deep');
check('comments are dropped', el('<!-- gone --><p>kept</p>').children.length, 1);
check('a doctype is dropped', el('<!DOCTYPE html><p>kept</p>').children.length, 1);
// A stray close tag must not unwind past the root and start dropping siblings.
check('a stray close tag is tolerated',
  el('<p>a</p></div><p>b</p>').children.map(c => c.textContent), ['a', 'b']);

// ---------------------------------------------------------------- //
section('textContent decodes, innerHTML round-trips');

// esc() writes entities into the markup. textContent has to hand them back
// decoded or a textarea's value can never match what the render produced —
// which is exactly how the session note came back empty.
check('entities are decoded', one('<p>a &amp; b &lt;c&gt;</p>').textContent, 'a & b <c>');
check('numeric entities too', one('<p>it&#39;s</p>').textContent, "it's");
check('an unknown entity is left alone', one('<p>&nope;</p>').textContent, '&nope;');
check('innerHTML gives back what went in, still encoded',
  el('<p>a &amp; b</p>').innerHTML, '<p>a &amp; b</p>');
check('setting textContent re-encodes',
  (() => { const p = one('<p>x</p>'); p.textContent = 'a & b'; return p.innerHTML; })(), 'a &amp; b');
check('and reads back as it was set',
  (() => { const p = one('<p>x</p>'); p.textContent = 'a & b'; return p.textContent; })(), 'a & b');
check('textContent of a subtree concatenates', one('<p>a<b>b</b>c</p>').textContent, 'abc');

// ---------------------------------------------------------------- //
section('Selectors');

const tree = el(`
  <div class="card" data-ex="pushup">
    <button class="btn go" data-act="log">x</button>
    <div class="row" data-set="0"><button data-act="undo">u</button></div>
  </div>
  <div class="card" data-ex="ring-dip"><span id="mark">m</span></div>`);

check('by class', tree.querySelectorAll('.card').length, 2);
check('by attribute presence', tree.querySelectorAll('[data-act]').length, 2);
check('by attribute value', tree.querySelectorAll('[data-act="undo"]').length, 1);
check('by tag', tree.querySelectorAll('button').length, 2);
check('by id', tree.querySelector('#mark').textContent, 'm');
check('several classes must all match', tree.querySelectorAll('.btn.go').length, 1);
check('and one that does not match excludes it', tree.querySelectorAll('.btn.missing').length, 0);
check('descendant selectors narrow left to right',
  tree.querySelectorAll('.row [data-act]').map(e => e.getAttribute('data-act')), ['undo']);
check('results are in document order',
  tree.querySelectorAll('.card').map(c => c.getAttribute('data-ex')), ['pushup', 'ring-dip']);
check('querySelector returns the first, or null',
  [tree.querySelector('.card').getAttribute('data-ex'), tree.querySelector('.nope')],
  ['pushup', null]);
check('closest walks up and includes self',
  [tree.querySelector('[data-act="undo"]').closest('.card').getAttribute('data-ex'),
   tree.querySelector('#mark').closest('.card').getAttribute('data-ex'),
   tree.querySelector('.card').closest('.card').getAttribute('data-ex')],
  ['pushup', 'ring-dip', 'pushup']);
check('closest returns null when nothing matches',
  tree.querySelector('#mark').closest('.nothing'), null);
// A selector form the shim does not implement must throw rather than quietly
// match nothing — a test that silently checks zero elements always passes.
let threw = false;
try { tree.querySelectorAll('div > p'); } catch (e) { threw = /unsupported selector/.test(e.message); }
check('an unsupported selector is loud, not silently empty', threw, true);
// A selector list is a union in document order, not two lists stuck together —
// which is what makes ".set-row, .rest-step" read out the order of a card.
const mixed = el('<p class="a">1</p><span class="b">2</span><p class="a">3</p>');
check('a comma list unions both, in document order',
  mixed.querySelectorAll('.a, .b').map(e => e.textContent), ['1', '2', '3']);
check('and never reports the same element twice',
  mixed.querySelectorAll('.a, p').map(e => e.textContent), ['1', '3']);
check('whitespace around the commas does not matter',
  mixed.querySelectorAll('.a,.b').length, 3);
check('a comma inside an attribute value is not a separator',
  el('<p data-x="a,b">1</p>').querySelectorAll('[data-x="a,b"]').length, 1);
check('matches() takes a list too', mixed.children[1].matches('.a, .b'), true);
check('and closest()', mixed.children[1].closest('.zz, .b').textContent, '2');

// ---------------------------------------------------------------- //
section('dataset');

const d = one('<div data-act="log-set" data-ex="ring-dip" data-two-words="x" class="c">t</div>');
check('data-* attributes appear on dataset', [d.dataset.act, d.dataset.ex], ['log-set', 'ring-dip']);
check('hyphenated names are camel-cased', d.dataset.twoWords, 'x');
check('non-data attributes do not', d.dataset.class, undefined);
check('a missing one is undefined', d.dataset.nothing, undefined);
// The shim's dataset is a snapshot, not the live DOMStringMap a browser gives
// you. Assigning to it does nothing — which is why bindOnce uses a plain
// property instead, and why this limit is worth pinning down.
d.dataset.act = 'changed';
check('LIMIT: the shim dataset is read-only', d.dataset.act, 'log-set');
check('setAttribute is how you change it',
  (() => { d.setAttribute('data-act', 'changed'); return d.dataset.act; })(), 'changed');

// ---------------------------------------------------------------- //
section('classList and hidden');

const c = one('<div class="a b">t</div>');
check('contains', [c.classList.contains('a'), c.classList.contains('z')], [true, false]);
c.classList.add('c');
check('add appends', c.className, 'a b c');
c.classList.add('c');
check('adding twice does not duplicate', c.className, 'a b c');
c.classList.remove('b');
check('remove takes it out', c.className, 'a c');
c.classList.remove('nope');
check('removing something absent is harmless', c.className, 'a c');

// `hidden` is a property backed by attribute PRESENCE. Every view and the rest
// bar are toggled with it.
const hid = one('<div>t</div>');
check('absent means visible', hid.hidden, false);
hid.hidden = true;
check('setting it adds the attribute', [hid.hidden, hid.getAttribute('hidden')], [true, '']);
hid.hidden = false;
check('clearing it removes the attribute', [hid.hidden, hid.hasAttribute('hidden')], [false, false]);
check('parsed markup with hidden starts hidden', one('<div hidden>t</div>').hidden, true);

// ---------------------------------------------------------------- //
section('Form state lives on the property');

// The attribute is only the INITIAL value. A browser keeps the live state on
// the property, and patching markup does not move it — which is why patch.js
// syncs by hand. Getting this backwards made a select look stuck.
const sel = one('<select><option value="a" selected>A</option><option value="b">B</option></select>');
check('value comes from the selected option', sel.value, 'a');
sel.options[1].selected = true;
sel.options[0].selected = false;
check('setting the property moves it', sel.value, 'b');
check('without touching the attribute', sel.options[0].hasAttribute('selected'), true);
sel.value = 'zzz';
check('assigning value wins outright', sel.value, 'zzz');

const box = one('<input type="checkbox" checked>');
check('checked starts from the attribute', box.checked, true);
box.checked = false;
check('and then follows the property', box.checked, false);
check('while the attribute stays put', box.hasAttribute('checked'), true);
check('type defaults to text', one('<input>').type, 'text');

const ta = one('<textarea>note</textarea>');
check('a textarea reads its content', ta.value, 'note');
ta.value = 'typed';
check('and then its property', ta.value, 'typed');

// ---------------------------------------------------------------- //
section('Tree surgery');

const host = el('<p id="a">a</p><p id="b">b</p>');
const [pa, pb] = host.children;
const fresh = doc.createElement('p');
fresh.id = 'c';
host.replaceChild(fresh, pa);
check('replaceChild swaps in place', host.children.map(x => x.id), ['c', 'b']);
check('and detaches the old node', pa.parentNode, null);
host.insertBefore(pa, pb);
check('insertBefore puts it back at the right index', host.children.map(x => x.id), ['c', 'a', 'b']);
host.insertBefore(pb, fresh);
check('and MOVES a node that is already a child, not duplicates it',
  host.children.map(x => x.id), ['b', 'c', 'a']);
check('so the count is unchanged', host.children.length, 3);
host.insertBefore(pb, null);
check('a null reference appends', host.children.map(x => x.id), ['c', 'a', 'b']);
host.removeChild(pa);
check('removeChild takes it out', host.children.map(x => x.id), ['c', 'b']);
pb.remove();
check('and remove() works from the node', host.children.map(x => x.id), ['c']);
pb.remove();
check('removing an already-detached node is harmless', host.children.length, 1);
check('appendChild moves rather than shares',
  (() => {
    const from = el('<i>x</i>'), to = doc.createElement('div');
    to.appendChild(from.children[0]);
    return [from.children.length, to.children.length];
  })(), [0, 1]);

// ---------------------------------------------------------------- //
section('Events bubble to the document');

// app.js hangs ONE delegated click listener on the document and reads
// e.target.closest(...). Get bubbling wrong and every button silently dies.
const page = makeWindow({});
page.document.body.innerHTML =
  '<div class="card" data-ex="pushup"><button data-act="log"><span>go</span></button></div>';
const seen = [];
page.document.addEventListener('click', (e) => {
  seen.push({
    target: e.target.tagName,
    act: e.target.closest('[data-act]') ? e.target.closest('[data-act]').dataset.act : null,
    card: e.target.closest('.card') ? e.target.closest('.card').dataset.ex : null,
  });
});
page.document.querySelector('span').click();
check('a click on a child reaches the document', seen.length, 1);
check('with the original target', seen[0].target, 'SPAN');
check('and closest() resolves the action from it', seen[0].act, 'log');
check('and the card it happened in', seen[0].card, 'pushup');

// Element listeners fire too, and before the document sees it.
const order = [];
const btn = page.document.querySelector('button');
btn.addEventListener('click', () => order.push('button'));
page.document.addEventListener('click', () => order.push('document'));
btn.click();
check('the element fires before the document', order, ['button', 'document']);

// A node no longer in the tree has no path to the document. This is the failure
// that made held references look like broken handlers — and the shim hid it
// twice: once by appending the document unconditionally, and once by clearing
// childNodes without clearing the children's parentNode.
const detached = page.document.querySelector('button');
detached.remove();
let before = seen.length;
detached.click();
check('a node taken out with remove() does not reach the document', seen.length, before);

page.document.body.innerHTML = '<div class="card" data-ex="a"><button data-act="log">go</button></div>';
const held = page.document.querySelector('button');
before = seen.length;
page.document.body.innerHTML = '<div class="card" data-ex="a"><button data-act="log">go</button></div>';
held.click();
check('nor does one dropped by replacing innerHTML', seen.length, before);
// Its immediate parent is still the old card — a browser detaches the SUBTREE,
// it does not orphan every node in it. What matters is that walking up from it
// no longer reaches the document.
const connected = (n) => { for (; n; n = n.parentNode) if (n.nodeType === 9) return true; return false; };
check('it keeps its old parent, as a browser would', held.parentNode.className, 'card');
check('but the chain no longer reaches the document', connected(held), false);
check('while a node still in the page does',
  connected(page.document.querySelector('button')), true);
check('while the replacement does reach it',
  (() => { page.document.querySelector('button').click(); return seen.length; })(), before + 1);

// ---------------------------------------------------------------- //
section('The window shim');

const w = makeWindow({ protocol: 'file:' });
check('the protocol is configurable', w.location.protocol, 'file:');
check('and drives isSecureContext', [w.isSecureContext, makeWindow({}).isSecureContext], [true, false]);
check('localStorage round-trips',
  (() => { w.localStorage.setItem('k', 'v'); return w.localStorage.getItem('k'); })(), 'v');
check('a missing key is null', w.localStorage.getItem('nope'), null);
check('removeItem clears it',
  (() => { w.localStorage.removeItem('k'); return w.localStorage.getItem('k'); })(), null);
check('values are stringified like a real Storage',
  (() => { w.localStorage.setItem('n', 5); return w.localStorage.getItem('n'); })(), '5');

// The clock and timers are the whole reason the countdown can be tested.
const t = makeWindow({ startTime: 1000 });
check('the clock starts where it was told', t.CLOCK.now(), 1000);
let ticks = 0, fired = [];
t.setInterval(() => ticks++, 1000);
t.setTimeout(() => fired.push('at 500'), 500);
t.setTimeout(() => fired.push('at 2500'), 2500);
t.advance(1000);
check('advancing moves the clock', t.CLOCK.now(), 2000);
check('a one-second interval fires once per second', ticks, 1);
check('a timeout due within the step has fired', fired, ['at 500']);
t.advance(3000);
check('three more seconds, three more ticks', ticks, 4);
check('and the later timeout has fired too', fired, ['at 500', 'at 2500']);
check('an interval slower than the step fires proportionally',
  (() => { const x = makeWindow({}); let n = 0; x.setInterval(() => n++, 5000); x.advance(12000); return n; })(),
  2);
check('confirm records the question and answers what it was told',
  (() => {
    const q = makeWindow({});
    q.confirmAnswer = true;
    const answered = q.confirm('Discard?');
    return [answered, q.prompts];
  })(), [true, ['Discard?']]);
check('and refuses by default', makeWindow({}).confirm('Erase everything?'), false);

// Absent on purpose: the app has to cope with all three missing on some real
// device, so the shim never provides them.
check('no audio, speech or wake lock is offered',
  ['AudioContext', 'speechSynthesis'].filter(k => k in makeWindow({}))
    .concat(makeWindow({}).navigator.wakeLock ? ['wakeLock'] : []),
  []);

// ---------------------------------------------------------------- //
section('loadBody takes the real page');

const page2 = makeWindow({});
page2.document.loadBody('<html><head><title>t</title></head><body><div id="real">yes</div></body></html>');
check('the body content is loaded', page2.document.getElementById('real').textContent, 'yes');
check('and the head is not', page2.document.querySelectorAll('title').length, 0);
check('a fragment with no body tag is taken whole',
  (() => { const p = makeWindow({}); p.document.loadBody('<p id="x">z</p>'); return p.document.getElementById('x').textContent; })(),
  'z');

// ---------------------------------------------------------------- //
report();
