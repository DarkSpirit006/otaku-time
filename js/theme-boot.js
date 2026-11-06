/* ============================================================
   Otaku Time — first-paint theme selection

   Loaded as a classic blocking script (not a module) so the
   theme is applied before the first paint and no inline script
   is required under the Content-Security-Policy.
   ============================================================ */
(function () {
  var KEY = "otaku-time.theme.v1";
  var LEGACY = "okaeri.theme.v1";
  var choices = ["light", "dark", "auto", "system"];
  var saved = null;
  try {
    saved = localStorage.getItem(KEY);
    if (saved === null) saved = localStorage.getItem(LEGACY);
  } catch (error) {
    /* storage unavailable — fall back to the default */
  }
  var preference = choices.indexOf(saved) !== -1 ? saved : "dark";
  var followsSystem = preference === "auto" || preference === "system";
  var dark =
    preference === "dark" ||
    (followsSystem && window.matchMedia("(prefers-color-scheme: dark)").matches);
  var root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.themePreference = preference;
})();
