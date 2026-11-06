/* ============================================================
   Otaku Time — undo for destructive actions

   One pending undo at a time, six seconds. The restore function is
   supplied by the caller and must be atomic: it either brings the
   whole record/dataset back or reports failure, in which case we
   say so instead of claiming success.
   ============================================================ */

import { showToast, hideToast } from "../components/toast.js";

export const UNDO_MS = 6000;

let pending = null; // { token, restore, message }

/**
 * Offer an undo for an action that already happened.
 * @param {{message:string, restore:()=>boolean|Promise<boolean>}} options
 * @returns {boolean} whether the offer was shown
 */
export function offerUndo({ message, restore }) {
  if (typeof restore !== "function") return false;
  const token = Symbol("undo");
  pending = { token, restore, message };

  showToast(message, {
    ms: UNDO_MS,
    actionLabel: "Undo",
    onAction: () => runUndo(token),
  });
  return true;
}

/** Execute the pending undo (toast action or keyboard). */
export async function runUndo(token = null) {
  if (!pending) return false;
  if (token && pending.token !== token) return false;
  const { restore } = pending;
  pending = null;
  hideToast();

  let ok = false;
  try {
    ok = await restore();
  } catch {
    ok = false;
  }

  showToast(ok ? "Restored." : "Couldn't restore that — nothing to undo.", ok ? 2600 : 5000);
  return ok;
}

/** Drop the pending undo without running it (toast expired or replaced). */
export function cancelUndo() {
  pending = null;
}

/** True while an undo is still available. */
export function hasPendingUndo() {
  return pending !== null;
}
