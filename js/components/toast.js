/* ============================================================
   Otaku Time — toast (single polite live region in index.html)
   ============================================================ */

let timer = null;

/** Show a toast message for `ms` milliseconds. */
export function showToast(message, ms = 4000) {
  const toast = document.getElementById("toast");
  if (!toast || !message) return;
  toast.textContent = message;
  toast.classList.add("is-visible");
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    toast.classList.remove("is-visible");
    timer = null;
  }, ms);
}
