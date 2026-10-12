import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Execute the real startup/search methods with controlled generation readiness.
// Rendering and game data are exercised by the browser checks separately.
const source = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
function method(name) {
  const start = source.indexOf(`\n\t${name}(`);
  assert.notEqual(start, -1, name);
  const end = source.indexOf("\n\t},", start);
  const last = source.indexOf("\n\t}\n};", start);
  return source
    .slice(start, end < 0 || (last >= 0 && last < end) ? last + 3 : end + 3)
    .trim();
}
function fixture(
  query,
  searchWorkerReady = Promise.resolve(),
  worldWorkerReady = Promise.resolve(),
) {
  const fields = Object.fromEntries(
    ["seed", "ng", "search-input", "game-mode", "local-search-mode"].map(
      (name) => [
        name,
        {
          value:
            name === "game-mode"
              ? "normal"
              : name === "local-search-mode"
                ? "off"
                : "",
        },
      ],
    ),
  );
  const document = { getElementById: (name) => fields[name] };
  const window = {
    location: new URL("https://telescope.test/?" + query),
    history: {
      replaceState(_state, _title, url) {
        window.location = new URL(url);
      },
    },
  };
  const calls = [];
  const app = {
    seed: -1,
    ngPlusCount: 0,
    gameMode: "normal",
    pendingURLSearch: null,
    isDaily: false,
    generate(...args) {
      calls.push(["generate", ...args]);
    },
    saveSettings() {},
    draw() {},
    getDailyRunSeed: async () => 123,
  };
  const methods = new Function(
    "document",
    "window",
    "app",
    "performSearch",
    "searchWorkerReady",
    "worldWorkerReady",
    "return {" +
      [
        method("async loadFromURLParams"),
        method("runURLSearch"),
        method("syncSearchQueryToURL"),
      ].join(",") +
      "}",
  );
  Object.assign(
    app,
    methods(
      document,
      window,
      app,
      (...args) => calls.push(["search", ...args]),
      searchWorkerReady,
      worldWorkerReady,
    ),
  );
  const ready = () => {
    app.seed = Number(fields.seed.value);
    app.ngPlusCount = Number(fields.ng.value);
    app.gameMode = fields["game-mode"].value;
    app.runURLSearch();
  };
  return { app, fields, window, calls, ready };
}

test("URL query waits for the requested generation and executes once with normal navigation", async () => {
  const f = fixture("seed=42&ng=2&gamemode=nightmare&q=chainsaw");
  await f.app.loadFromURLParams();
  assert.equal(f.fields["search-input"].value, "chainsaw");
  assert.deepEqual(f.calls, [["generate", true, true]]);
  f.ready();
  f.app.runURLSearch();
  assert.deepEqual(f.calls, [
    ["generate", true, true],
    ["search", true, true],
  ]);
});
for (const query of [
  "seed=42",
  "seed=42&q=",
  "seed=42&q=+++",
  "seed=invalid&q=chainsaw",
]) {
  test("does not start an implicit search for " + query, async () => {
    const f = fixture(query);
    await f.app.loadFromURLParams();
    f.ready();
    assert.equal(
      f.calls.some((call) => call[0] === "search"),
      false,
    );
  });
}
test("query without a seed only fills the input", async () => {
  const f = fixture("q=chainsaw");
  await f.app.loadFromURLParams();
  assert.equal(f.fields["search-input"].value, "chainsaw");
  assert.deepEqual(f.calls, []);
});
test("literal daily and zero seeds retain their existing behavior", async () => {
  for (const seed of ["daily", "0"]) {
    const f = fixture("seed=" + seed + "&q=heart");
    await f.app.loadFromURLParams();
    f.ready();
    assert.equal(f.app.seed, seed === "daily" ? 123 : 0);
    assert.equal(f.app.isDaily, seed === "daily");
    assert.deepEqual(f.calls.at(-1), ["search", true, true]);
  }
});
for (const changed of ["seed", "ng", "mode", "query", "local-search"]) {
  test(
    "superseded " + changed + " prevents the old URL query from running",
    async () => {
      const f = fixture("seed=42&q=chainsaw");
      await f.app.loadFromURLParams();
      f.app.seed = 42;
      f.app.ngPlusCount = 0;
      if (changed === "seed") f.app.seed = 43;
      if (changed === "ng") f.app.ngPlusCount = 1;
      if (changed === "mode") f.app.gameMode = "nightmare";
      if (changed === "query") f.fields["search-input"].value = "heart";
      if (changed === "local-search")
        f.fields["local-search-mode"].value = "eoe";
      f.app.runURLSearch();
      assert.equal(
        f.calls.some((call) => call[0] === "search"),
        false,
      );
      assert.equal(f.app.pendingURLSearch, null);
    },
  );
}
test("query encoding and manual-search URL updates preserve the seed, mode and unrelated parameters", async () => {
  const query = "chainsaw + 氷 & <test> #";
  const f = fixture(
    "seed=42&ng=2&gamemode=nightmare&extra=keep&q=" + encodeURIComponent(query),
  );
  await f.app.loadFromURLParams();
  assert.equal(f.fields["search-input"].value, query);
  const next = "mana + water & foo";
  f.fields["search-input"].value = next;
  f.app.syncSearchQueryToURL();
  assert.equal(f.window.location.searchParams.get("q"), next);
  assert.equal(f.window.location.searchParams.get("seed"), "42");
  assert.equal(f.window.location.searchParams.get("ng"), "2");
  assert.equal(f.window.location.searchParams.get("gamemode"), "nightmare");
  assert.equal(f.window.location.searchParams.get("extra"), "keep");
  f.fields["search-input"].value = " ";
  f.app.syncSearchQueryToURL();
  assert.equal(f.window.location.searchParams.has("q"), false);
});

test("URL generation waits for both search and world workers before sending data", async () => {
  let release;
  const workerReady = new Promise((resolve) => {
    release = resolve;
  });
  let releaseWorld;
  const worldReady = new Promise((resolve) => {
    releaseWorld = resolve;
  });
  const f = fixture("seed=42&q=heart", workerReady, worldReady);
  const loading = f.app.loadFromURLParams();
  await Promise.resolve();
  assert.equal(f.fields["search-input"].value, "heart");
  assert.deepEqual(f.calls, []);
  release();
  await Promise.resolve();
  assert.deepEqual(f.calls, []);
  releaseWorld();
  await loading;
  f.ready();
  assert.deepEqual(f.calls, [
    ["generate", true, true],
    ["search", true, true],
  ]);
});
