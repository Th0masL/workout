/* Apply rendered HTML to a live element without throwing the DOM away.
 *
 * The app renders whole views as strings, which is simple and worth keeping.
 * Assigning that string to innerHTML is what is not: it destroys and rebuilds
 * every node on every tap. The costs are real and were all observed here —
 *
 *   - element references go stale silently. Collect the log buttons, tap one,
 *     and the other twenty are detached: clicking them does nothing, raises
 *     nothing, and looks exactly like a broken handler.
 *   - scroll position and focus are lost mid-session, which on a phone means
 *     the card you were working on jumps away under your thumb.
 *   - listeners attached per render pile up on nodes that survive.
 *   - every <img> is recreated and re-requested.
 *
 * So: parse the new HTML into a detached tree, then walk both trees together
 * and change only what actually differs. Nodes that did not change keep their
 * identity, and everything above goes away.
 *
 * Deliberately NOT a virtual DOM. No component model, no lifecycle, no
 * scheduling. Children are matched by KEY where they have one and by position
 * where they do not, which is the minimum that works here: logging the first
 * set turns "Up next" into "In progress" and removes a hint paragraph, so
 * everything below it shifts by one. Positional matching alone would then
 * replace every card in the session — technically correct, and useless.
 */
(function (root) {
  "use strict";

  /* What makes a node "the same node" across renders. data-ex identifies an
   * exercise card and data-set a row inside it, which is exactly where identity
   * matters; everything else falls back to position. */
  function keyOf(el) {
    return (
      el.getAttribute("data-ex") ||
      el.getAttribute("data-set") ||
      el.getAttribute("id") ||
      ""
    );
  }

  function patchAttrs(oldEl, newEl) {
    var i, name;
    var seen = {};
    var next = newEl.attributes;
    for (i = 0; i < next.length; i++) {
      name = next[i].name;
      seen[name] = true;
      if (oldEl.getAttribute(name) !== next[i].value) oldEl.setAttribute(name, next[i].value);
    }
    /* Backwards: removing while iterating a live NamedNodeMap skips entries. */
    var current = oldEl.attributes;
    for (i = current.length - 1; i >= 0; i--) {
      name = current[i].name;
      if (!seen[name]) oldEl.removeAttribute(name);
    }
  }

  /* Form controls keep their state as a PROPERTY, and the attribute the render
   * emits does not touch it. Without this a <select> would show the old choice
   * and a checkbox the old tick, no matter what the markup said. */
  function syncFormState(el, next) {
    var tag = el.tagName;
    if (tag === "SELECT") {
      var opts = el.options;
      for (var i = 0; i < opts.length; i++) {
        var want = opts[i].hasAttribute("selected");
        if (opts[i].selected !== want) opts[i].selected = want;
      }
      return;
    }
    if (tag === "INPUT") {
      var want = el.hasAttribute("checked");
      if (el.type === "checkbox" || el.type === "radio") {
        if (el.checked !== want) el.checked = want;
      }
      return;
    }
    if (tag === "TEXTAREA") {
      /* The value is user input, so compare against what the RENDER says, not
       * against the old node's own children — those are what was there before
       * and would hand back the stale value every time. Only write when they
       * genuinely disagree, or typing would fight the re-render for the caret. */
      var text = next.textContent;
      if (el.value !== text) el.value = text;
    }
  }

  function patchNode(oldNode, newNode) {
    if (oldNode.nodeType !== newNode.nodeType) return false;

    if (oldNode.nodeType === 3) {
      if (oldNode.textContent !== newNode.textContent) oldNode.textContent = newNode.textContent;
      return true;
    }
    if (oldNode.nodeType !== 1) return true;
    if (oldNode.tagName !== newNode.tagName) return false;
    if (keyOf(oldNode) !== keyOf(newNode)) return false;

    patchAttrs(oldNode, newNode);
    /* A textarea's children ARE its value; patching them would move the caret. */
    if (oldNode.tagName !== "TEXTAREA") patchChildren(oldNode, newNode);
    syncFormState(oldNode, newNode);
    return true;
  }

  function patchChildren(oldEl, newEl) {
    /* Snapshot both: inserting moves a node out of newEl's live child list,
     * which would make an index walk skip every other entry. */
    var olds = [], news = [], i;
    for (i = 0; i < oldEl.childNodes.length; i++) olds.push(oldEl.childNodes[i]);
    for (i = 0; i < newEl.childNodes.length; i++) news.push(newEl.childNodes[i]);

    /* Keyed children are claimed by key wherever they have moved to. Unkeyed
     * ones fall back to "the next one still going spare", in order. */
    var byKey = {}, taken = [], cursor = 0;
    for (i = 0; i < olds.length; i++) {
      var k = olds[i].nodeType === 1 && keyOf(olds[i]);
      if (k) byKey[olds[i].tagName + "\u0000" + k] = i;
    }

    var out = [];
    for (i = 0; i < news.length; i++) {
      var n = news[i];
      var at = -1;
      if (n.nodeType === 1) {
        var nk = keyOf(n);
        if (nk) {
          var slot = byKey[n.tagName + "\u0000" + nk];
          if (slot !== undefined && !taken[slot]) at = slot;
        }
      }
      if (at < 0) {
        /* Skip anything already claimed, and anything KEYED — a keyed node is
         * reserved for its own key and must not be consumed positionally. */
        while (cursor < olds.length) {
          var c = olds[cursor];
          if (!taken[cursor] && !(c.nodeType === 1 && keyOf(c))) { at = cursor++; break; }
          cursor++;
        }
      }
      if (at >= 0 && patchNode(olds[at], n)) {
        taken[at] = true;
        out.push(olds[at]);
      } else {
        out.push(n);
      }
    }

    /* Put them in order. insertBefore moves a node that is already a child, so
     * a reused node that shifted position is relocated rather than rebuilt. */
    for (i = 0; i < out.length; i++) {
      if (oldEl.childNodes[i] !== out[i]) oldEl.insertBefore(out[i], oldEl.childNodes[i] || null);
    }
    while (oldEl.childNodes.length > out.length) {
      oldEl.removeChild(oldEl.childNodes[oldEl.childNodes.length - 1]);
    }
  }

  /* Make `el` look like `html`, reusing whatever already matches. `el` is
   * always a plain container here — the app patches whole views, never a
   * fragment that needs a particular parent to parse (a bare <tr>, say). */
  function patch(el, html) {
    var scratch = el.ownerDocument.createElement("div");
    scratch.innerHTML = html;
    patchChildren(el, scratch);
  }

  root.DomPatch = { patch: patch, keyOf: keyOf };
})(typeof self !== "undefined" ? self : this);
