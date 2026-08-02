// A DOM small enough to test this app against, and no larger.
//
// WHY THIS EXISTS: every assertion in progression.test.mjs is aimed at the pure
// engine, and the engine was never the part that broke. What broke was the
// wiring — a click handler that threw and froze a card, an image that could
// never load, a quote that closed an attribute early. None of it was reachable
// without a document.
//
// jsdom would do this properly, but the app has no build step and no
// dependencies, and `node tests/*.mjs` on a fresh clone is worth more than
// fidelity we do not need. So: a tag soup parser, a tree, selectors limited to
// what app.js actually uses, and bubbling events.
//
// It is deliberately NOT a browser. No layout, no CSS, no network, no timers
// running on their own. Anything relying on those has to be tested elsewhere.

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img',
  'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: '\u00a0' };
const decode = (s) => s.replace(/&(#\d+|[a-z]+);/gi, (m, e) =>
  ENTITIES[e.toLowerCase()] ?? (e[0] === '#' ? String.fromCharCode(+e.slice(1)) : m));
const encode = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

class Text {
  // `data` stays as written so innerHTML round-trips; textContent decodes.
  constructor(data) { this.data = data; this.parentNode = null; }
  get nodeType() { return 3; }
  get textContent() { return decode(this.data); }
  set textContent(v) { this.data = encode(String(v)); }
  get outerHTML() { return this.data; }
}

class Element {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.attrs = new Map();
    this.childNodes = [];
    this.parentNode = null;
    this.ownerDocument = doc;
    this.listeners = new Map();
    this.style = new Style();
    this._value = null;
    this._checked = undefined;
    this._selected = undefined;
  }
  get nodeType() { return 1; }

  // -- attributes ------------------------------------------------------
  // A snapshot, not the live NamedNodeMap a browser returns. Patch code that
  // removes while iterating has to be written for the live one; it is correct
  // against this too.
  get attributes() {
    const out = [];
    for (const [name, value] of this.attrs) out.push({ name, value });
    return out;
  }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  setAttribute(n, v) { this.attrs.set(n, String(v)); }
  hasAttribute(n) { return this.attrs.has(n); }
  removeAttribute(n) { this.attrs.delete(n); }

  get dataset() {
    const out = {};
    for (const [k, v] of this.attrs) if (k.startsWith('data-')) {
      out[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
    }
    return out;
  }
  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get classList() {
    const el = this;
    const list = () => el.className.split(/\s+/).filter(Boolean);
    return {
      contains: (c) => list().includes(c),
      add: (c) => { if (!list().includes(c)) el.className = list().concat(c).join(' '); },
      remove: (c) => { el.className = list().filter(x => x !== c).join(' '); },
    };
  }
  // The `hidden` attribute is how every view and the rest bar are toggled, so
  // it has to behave like the property, not like a string.
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(v) { v ? this.setAttribute('hidden', '') : this.removeAttribute('hidden'); }
  get value() {
    if (this._value !== null) return this._value;
    if (this.tagName === 'SELECT') {
      const sel = this.options.find(o => o.selected);
      return sel ? (sel.getAttribute('value') ?? sel.textContent) : '';
    }
    return this.getAttribute('value') ?? this.textContent;
  }
  set value(v) { this._value = String(v); }
  get options() { return this.querySelectorAll('option'); }
  get type() { return this.getAttribute('type') || 'text'; }
  // Form state lives on the PROPERTY; the attribute is only the initial value.
  // Patching markup does not move it, which is why patch.js syncs it by hand.
  get selected() { return this._selected === undefined ? this.hasAttribute('selected') : this._selected; }
  set selected(v) { this._selected = !!v; }
  get checked() { return this._checked === undefined ? this.hasAttribute('checked') : this._checked; }
  set checked(v) { this._checked = !!v; }

  // -- tree ------------------------------------------------------------
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  appendChild(n) {
    if (n.parentNode) n.parentNode.removeChild(n);
    n.parentNode = this;
    this.childNodes.push(n);
    return n;
  }
  removeChild(n) {
    const i = this.childNodes.indexOf(n);
    if (i >= 0) { this.childNodes.splice(i, 1); n.parentNode = null; }
    return n;
  }
  insertBefore(node, ref) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(node);
    else this.childNodes.splice(i, 0, node);
    return node;
  }
  replaceChild(fresh, stale) {
    const i = this.childNodes.indexOf(stale);
    if (i < 0) return stale;
    if (fresh.parentNode) fresh.parentNode.removeChild(fresh);
    fresh.parentNode = this;
    this.childNodes[i] = fresh;
    stale.parentNode = null;
    return stale;
  }
  remove() {
    if (!this.parentNode) return;
    const i = this.parentNode.childNodes.indexOf(this);
    if (i >= 0) this.parentNode.childNodes.splice(i, 1);
    this.parentNode = null;
  }
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  /* Detaches, rather than forgetting. A node whose parentNode still points at a
   * parent that has dropped it is a node that keeps bubbling events to a
   * document it is no longer in. */
  clear() {
    for (const n of this.childNodes) n.parentNode = null;
    this.childNodes = [];
  }
  set textContent(v) {
    this.clear();
    if (v === '' || v == null) return;
    const t = new Text('');
    t.textContent = v; // goes through the encoder
    this.appendChild(t);
  }
  get innerHTML() { return this.childNodes.map(n => n.outerHTML).join(''); }
  set innerHTML(html) {
    this.clear();
    for (const n of parseFragment(String(html), this.ownerDocument)) this.appendChild(n);
  }
  get outerHTML() {
    const tag = this.tagName.toLowerCase();
    let a = '';
    for (const [k, v] of this.attrs) a += v === '' ? ` ${k}` : ` ${k}="${v}"`;
    if (VOID.has(tag)) return `<${tag}${a}>`;
    return `<${tag}${a}>${this.innerHTML}</${tag}>`;
  }

  // -- selectors -------------------------------------------------------
  matches(sel) { return match(this, sel); }
  closest(sel) {
    let n = this;
    while (n && n.nodeType === 1) { if (match(n, sel)) return n; n = n.parentNode; }
    return null;
  }
  querySelectorAll(sel) { return queryAll(this, sel); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }

  // -- events ----------------------------------------------------------
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  click() { dispatch(this, 'click'); }
}

class Style {
  constructor() { this.props = new Map(); }
  setProperty(k, v) { this.props.set(k, v); }
  getPropertyValue(k) { return this.props.get(k) || ''; }
  get display() { return this.props.get('display') || ''; }
  set display(v) { this.props.set('display', v); }
}

/* Descendant selectors ("#view-today [data-act]") narrow left to right; each
 * part is a simple selector. closest() and matches() take a simple selector
 * only, which is all the app ever passes them. */
/* Splits a selector LIST on its commas, leaving any inside [attr="a,b"] alone. */
function splitList(sel) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < sel.length; i++) {
    if (sel[i] === '[') depth++;
    else if (sel[i] === ']') depth--;
    else if (sel[i] === ',' && depth === 0) { out.push(sel.slice(start, i)); start = i + 1; }
  }
  out.push(sel.slice(start));
  return out.map(s => s.trim()).filter(Boolean);
}

/* A selector list is a union, returned in document order with no duplicates —
 * which is what makes ".set-row, .rest-step" report the running order of a card
 * rather than two separate lists. */
function queryAll(root, sel) {
  const parts = splitList(sel);
  if (parts.length === 1) return queryOne(root, parts[0]);
  const hit = new Set();
  for (const p of parts) for (const el of queryOne(root, p)) hit.add(el);
  const out = [];
  (function walk(n) {
    for (const c of n.childNodes) {
      if (c.nodeType !== 1) continue;
      if (hit.has(c)) out.push(c);
      walk(c);
    }
  })(root);
  return out;
}

function queryOne(root, sel) {
  let scope = [root];
  for (const part of sel.trim().split(/\s+/)) {
    const next = [];
    for (const s of scope) {
      (function walk(n) {
        for (const c of n.childNodes) {
          if (c.nodeType !== 1) continue;
          if (match(c, part) && !next.includes(c)) next.push(c);
          walk(c);
        }
      })(s);
    }
    scope = next;
  }
  return scope;
}

/* Only the selector forms app.js uses: a tag name, any number of classes, an
 * id, and attribute-presence. Anything else is a mistake worth failing on
 * loudly rather than silently matching nothing. */
const SEL = /^([a-z][a-z0-9]*)?((?:\.[A-Za-z0-9_-]+)*)(?:#([A-Za-z0-9_-]+))?(?:\[([A-Za-z-]+)(?:="([^"]*)")?\])?$/;
function match(el, sel) {
  const parts = splitList(sel);
  if (parts.length > 1) return parts.some((p) => match(el, p));
  const m = SEL.exec(sel.trim());
  if (!m) throw new Error(`test DOM: unsupported selector ${JSON.stringify(sel)}`);
  const [, tag, classes, id, attr, attrVal] = m;
  if (tag && el.tagName !== tag.toUpperCase()) return false;
  if (id && el.id !== id) return false;
  if (attr) {
    if (!el.hasAttribute(attr)) return false;
    if (attrVal !== undefined && el.getAttribute(attr) !== attrVal) return false;
  }
  for (const c of classes.split('.').filter(Boolean)) {
    if (!el.classList.contains(c)) return false;
  }
  return true;
}

/* Events bubble from the target to the document. app.js hangs one delegated
 * click listener on the document and reads e.target.closest(...) — get this
 * wrong and every button in the app silently does nothing. */
function dispatch(target, type) {
  const ev = { type, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  /* Walking parentNode reaches the Document by itself when the node is in the
   * tree, because documentElement's parent IS the document. A detached node
   * stops short — which is the point: clicking one does nothing in a browser
   * and must do nothing here. */
  const chain = [];
  for (let n = target; n; n = n.parentNode) chain.push(n);
  for (const n of chain) {
    const fns = n.listeners && n.listeners.get(type);
    if (fns) for (const fn of fns.slice()) fn.call(n, ev);
  }
  return ev;
}

// ---------------------------------------------------------------- //
// Parser
// ---------------------------------------------------------------- //

const TAG = /<(\/)?([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[a-zA-Z_:@-][a-zA-Z0-9_:.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g;
const ATTR = /([a-zA-Z_:@-][a-zA-Z0-9_:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function parseFragment(html, doc) {
  const roots = [];
  const stack = [];
  const push = (n) => {
    const parent = stack[stack.length - 1];
    if (parent) parent.appendChild(n);
    else roots.push(n);
  };
  // Comments and doctype carry nothing the app reads.
  html = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<!doctype[^>]*>/gi, '');

  let last = 0;
  TAG.lastIndex = 0;
  let m;
  while ((m = TAG.exec(html))) {
    if (m.index > last) {
      const text = html.slice(last, m.index);
      if (text.trim()) push(new Text(text));
    }
    last = TAG.lastIndex;
    const [, closing, name, attrString, selfClose] = m;
    const tag = name.toLowerCase();
    if (closing) {
      // Tolerate a stray close tag rather than unwinding past the root.
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tagName === tag.toUpperCase()) { stack.length = i; break; }
      }
      continue;
    }
    const el = new Element(tag, doc);
    ATTR.lastIndex = 0;
    let a;
    while ((a = ATTR.exec(attrString))) {
      el.setAttribute(a[1], a[2] ?? a[3] ?? a[4] ?? '');
    }
    push(el);
    if (!VOID.has(tag) && !selfClose) stack.push(el);
  }
  if (html.length > last) {
    const text = html.slice(last);
    if (text.trim()) push(new Text(text));
  }
  return roots;
}

// ---------------------------------------------------------------- //
// Document / window
// ---------------------------------------------------------------- //

class Document {
  constructor() {
    this.listeners = new Map();
    this.childNodes = [];
    this.parentNode = null;
    this.nodeType = 9;
    this.visibilityState = 'visible';
    this.documentElement = new Element('html', this);
    this.documentElement.parentNode = this;
    this.childNodes.push(this.documentElement);
    this.head = this.documentElement.appendChild(new Element('head', this));
    this.body = this.documentElement.appendChild(new Element('body', this));
  }
  createElement(tag) { return new Element(tag, this); }
  getElementById(id) { return this.documentElement.querySelector('#' + id); }
  querySelector(s) { return this.documentElement.querySelector(s); }
  querySelectorAll(s) { return queryAll(this.documentElement, s); }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  loadBody(html) {
    // Take index.html's real <body>, so the ids app.js reaches for are the ids
    // the page actually ships. A rename in one and not the other is a bug the
    // engine tests cannot see.
    const m = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
    this.body.innerHTML = m ? m[1] : html;
  }
}

class Storage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

/* A browser-shaped global object, with everything the app touches present and
 * everything it does not deliberately absent — no AudioContext, no
 * speechSynthesis, no wakeLock. The app has to cope with all three missing on
 * some real device, so the tests run in exactly that shape. */
export function makeWindow({ protocol = 'http:', startTime = Date.parse('2026-03-02T09:00:00Z') } = {}) {
  const document = new Document();
  const timers = { intervals: [], timeouts: [] };
  const prompts = [];
  /* A clock the test drives. app.js reads window.CLOCK when it is present, so
   * a countdown can be asserted on instead of waited for. */
  const clock = { t: startTime, now() { return clock.t; } };

  const win = {
    document,
    localStorage: new Storage(),
    location: {
      protocol,
      href: protocol + '//localhost/',
      origin: protocol + '//localhost',
      reloads: 0,
      reload() { this.reloads++; },
    },
    navigator: { userAgent: 'test' },
    isSecureContext: protocol !== 'http:',
    listeners: new Map(),
    scrollTo() {},
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    },
    CLOCK: clock,
    setInterval(fn, ms) { timers.intervals.push({ fn, ms, acc: 0 }); return timers.intervals.length; },
    clearInterval() {},
    setTimeout(fn, ms) { timers.timeouts.push({ fn, due: clock.t + (ms || 0) }); return timers.timeouts.length; },
    clearTimeout() {},
    // Every confirm() in the app guards something destructive. Tests must say
    // what they answered, so the default is to refuse and log the question.
    confirm(q) { prompts.push(q); return win.confirmAnswer; },
    confirmAnswer: false,
    console,
  };
  win.window = win;
  win.globalThis = win;
  win.self = win;
  win.timers = timers;
  win.prompts = prompts;

  /* Advance in one-second steps, running each interval when its period is up
   * and firing timeouts as they come due — the app's clock behaviour depends on
   * being called every second, not on one big jump. */
  win.advance = (ms) => {
    let left = Math.max(0, ms);
    do {
      const step = Math.min(left, 1000);
      clock.t += step;
      left -= step;
      const due = timers.timeouts.filter((t) => t.due <= clock.t);
      timers.timeouts = timers.timeouts.filter((t) => t.due > clock.t);
      for (const t of due) t.fn();
      for (const iv of timers.intervals) {
        iv.acc += step;
        while (iv.acc >= iv.ms) { iv.acc -= iv.ms; iv.fn(); }
      }
    } while (left > 0);
  };
  return win;
}

export { Element, Text, Document, dispatch };
