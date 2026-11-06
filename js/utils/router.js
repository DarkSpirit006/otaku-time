/* ============================================================
   Otaku Time — hash route parsing (pure)

   Routes
     #upcoming · #watchlist · #recent   primary sections
     #calendar                          Upcoming → week view
     #show/<id>                         detail dialog over the
                                        section it was opened from
   ============================================================ */

export const SECTIONS = ["upcoming", "watchlist", "recent"];

const SHOW = /^show\/([^/]+)$/;
const MAX_ID = 2_147_483_647;

/**
 * @param {string} hash
 * @returns {{section:string|null, view:string|null, mediaId:number|null, invalid:boolean, unknown:boolean}}
 */
export function parseRoute(hash) {
  const raw = String(hash || "").replace(/^#\/?/, "").trim();
  const result = { section: null, view: null, mediaId: null, invalid: false, unknown: false };

  if (!raw) return result;

  if (SECTIONS.includes(raw)) {
    result.section = raw;
    return result;
  }

  if (raw === "calendar") {
    result.section = "upcoming";
    result.view = "calendar";
    return result;
  }

  if (raw === "show" || raw.startsWith("show/")) {
    const show = SHOW.exec(raw);
    if (!show) {
      result.invalid = true;
      return result;
    }
    const value = show[1];
    if (!/^\d{1,10}$/.test(value)) {
      result.invalid = true;
      return result;
    }
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0 || id > MAX_ID) {
      result.invalid = true;
      return result;
    }
    result.mediaId = id;
    return result;
  }

  const show = SHOW.exec(raw);
  if (show) {
    const value = show[1];
    if (!/^\d{1,10}$/.test(value)) {
      result.invalid = true;
      return result;
    }
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0 || id > MAX_ID) {
      result.invalid = true;
      return result;
    }
    result.mediaId = id;
    return result;
  }

  result.unknown = true;
  return result;
}

/** Build a hash for a route description. */
export function buildRoute({ section = null, view = null, mediaId = null } = {}) {
  if (Number.isInteger(mediaId) && mediaId > 0) return `#show/${mediaId}`;
  if (view === "calendar") return "#calendar";
  if (section && SECTIONS.includes(section)) return `#${section}`;
  return "#upcoming";
}

/** Is this hash a detail route? */
export function isShowRoute(hash) {
  return parseRoute(hash).mediaId !== null;
}
