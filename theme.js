/* Apply the saved theme before styles load so an explicit override never
 * flashes through the operating-system palette first. The settings control is
 * rendered by app.js, so change handling is delegated from the document. */
(function () {
  "use strict";

  var KEY = "workout-theme";
  var root = document.documentElement;
  var meta = document.querySelector('meta[name="theme-color"]');
  var system = window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : { matches: false };
  var choice = "system";

  try {
    var saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark" || saved === "system") choice = saved;
  } catch (e) {
    /* Storage can be unavailable in privacy modes. System remains a safe,
     * fully functional default. */
  }

  function resolved() {
    return choice === "system" ? (system.matches ? "dark" : "light") : choice;
  }

  function syncControls() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-theme-choice]"), function (button) {
      button.setAttribute("aria-pressed", String(button.dataset.themeChoice === choice));
    });
    Array.prototype.forEach.call(document.querySelectorAll("select[data-theme-control]"), function (select) {
      select.value = choice;
    });
  }

  function apply(next, persist) {
    if (next !== "light" && next !== "dark" && next !== "system") next = "system";
    choice = next;
    if (choice === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", choice);

    if (!meta && document.head && document.createElement) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      document.head.appendChild(meta);
    }
    if (meta) meta.setAttribute("content", resolved() === "dark" ? "#0f1320" : "#f6f8fb");
    syncControls();

    if (persist) {
      try { localStorage.setItem(KEY, choice); } catch (e) { /* Theme still applies in memory. */ }
    }
  }

  function systemChanged() {
    if (choice === "system") apply("system", false);
  }

  if (system.addEventListener) system.addEventListener("change", systemChanged);
  else if (system.addListener) system.addListener(systemChanged);

  document.addEventListener("change", function (event) {
    var control = event.target.closest && event.target.closest("select[data-theme-control]");
    if (control) apply(control.value, true);
  });
  document.addEventListener("click", function (event) {
    var control = event.target.closest && event.target.closest("[data-theme-choice]");
    if (control) apply(control.dataset.themeChoice, true);
  });

  window.WorkoutTheme = {
    getChoice: function () { return choice; },
    setChoice: function (next) { apply(next, true); },
  };

  apply(choice, false);
})();
