/* ============================================================
   Otaku Time — PWA install prompt

   promptInstall() used to return "unavailable" unconditionally. It now
   has to reflect what the browser actually offered: no captured
   beforeinstallprompt means no install UI, and a captured one is
   single-use. These tests drive the real module with a fake window.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const PWA_URL = pathToFileURL(new URL("../../js/services/pwa.js", import.meta.url).pathname).href;

let importCount = 0;

/** Fresh module instance with a fake browser around it. */
async function loadPwa() {
  const listeners = new Map();
  const promptCalls = [];

  const window = {
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener() {},
  };
  const document = { visibilityState: "hidden", addEventListener() {} };
  const location = { protocol: "https:" };
  // No serviceWorker property: initPwa() stops right after wiring install
  // events, which is the part under test.
  const navigator = {};

  const previous = {
    window: Object.getOwnPropertyDescriptor(globalThis, "window"),
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
    location: Object.getOwnPropertyDescriptor(globalThis, "location"),
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
  };
  const define = (name, value) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  define("window", window);
  define("document", document);
  define("location", location);
  define("navigator", navigator);

  const moduleUrl = `${PWA_URL}?instance=${++importCount}`;
  const pwa = await import(moduleUrl);

  const restore = () => {
    for (const [name, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };

  /** Fire a browser event at the module. */
  const fire = (type, event = {}) => {
    for (const handler of listeners.get(type) || []) handler(event);
  };

  return { pwa, fire, promptCalls, restore, window };
}

/** A beforeinstallprompt event with a scripted user choice. */
function installEvent(outcome = "accepted", { throws = false } = {}) {
  const event = {
    prevented: false,
    prompted: 0,
    userChoice: Promise.resolve({ outcome, platform: "web" }),
    preventDefault() {
      this.prevented = true;
    },
    prompt() {
      this.prompted += 1;
      if (throws) throw new Error("prompt is not available");
    },
  };
  return event;
}

const withEnv = async (run) => {
  const env = await loadPwa();
  try {
    await run(env);
  } finally {
    env.restore();
  }
};

test("nothing is claimed before the browser offers an install", async () => {
  await withEnv(async ({ pwa }) => {
    pwa.initPwa();
    assert.equal(pwa.canInstall(), false);
    assert.equal(await pwa.promptInstall(), "unavailable");
  });
});

test("a captured event is offered once and reports acceptance", async () => {
  await withEnv(async ({ pwa, fire }) => {
    pwa.initPwa();
    const event = installEvent("accepted");
    fire("beforeinstallprompt", event);

    assert.equal(pwa.canInstall(), true);
    assert.equal(await pwa.promptInstall(), "accepted");
    assert.equal(event.prompted, 1);
    // The browser's own mini-infobar would otherwise compete with ours.
    assert.equal(event.prevented, true);
  });
});

test("a dismissed prompt is reported as dismissed, not as failure", async () => {
  await withEnv(async ({ pwa, fire }) => {
    pwa.initPwa();
    fire("beforeinstallprompt", installEvent("dismissed"));
    assert.equal(await pwa.promptInstall(), "dismissed");
  });
});

test("the install event is single use", async () => {
  await withEnv(async ({ pwa, fire }) => {
    pwa.initPwa();
    const event = installEvent("accepted");
    fire("beforeinstallprompt", event);

    await pwa.promptInstall();
    assert.equal(pwa.canInstall(), false, "a spent event cannot be replayed");
    assert.equal(await pwa.promptInstall(), "unavailable");
    assert.equal(event.prompted, 1);
  });
});

test("a prompt that throws reports unavailable instead of rejecting", async () => {
  await withEnv(async ({ pwa, fire }) => {
    pwa.initPwa();
    fire("beforeinstallprompt", installEvent("accepted", { throws: true }));
    assert.equal(await pwa.promptInstall(), "unavailable");
  });
});

test("installing clears the offer", async () => {
  await withEnv(async ({ pwa, fire }) => {
    pwa.initPwa();
    fire("beforeinstallprompt", installEvent("accepted"));
    assert.equal(pwa.canInstall(), true);

    fire("appinstalled", {});
    assert.equal(pwa.canInstall(), false);
    assert.equal(await pwa.promptInstall(), "unavailable");
  });
});
