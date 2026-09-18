import test from "node:test";
import assert from "node:assert/strict";

global.document = {
  getElementById: () => ({ addEventListener() {}, style: {} }),
  querySelectorAll: () => [],
  addEventListener() {},
};
global.localStorage = { getItem: () => null, setItem() {} };
Object.defineProperty(global, "navigator", { value: {}, configurable: true });
Object.defineProperty(global, "location", { value: { protocol: "file:" }, configurable: true });
global.fetch = async () => ({ json: async () => ({ cards: [] }) });

const { buildBookmarklet, createBackup, nextInterval, normalizeCard, parseDeck, stableId, wordsIn } = await import("../app.js");

test("normalizes common card field names", () => {
  assert.deepEqual(normalizeCard({ prompt: " hola ", translation: " hello " }, 0), {
    id: stableId("hola|hello|0"), front: "hola", back: "hello",
  });
});

test("parses tab-separated cards", () => {
  assert.equal(parseDeck("hola\thello\nbuenos días\tgood morning").length, 2);
});

test("extracts unique words from phrases", () => {
  assert.deepEqual(wordsIn("¿Cómo estás, cómo?"), ["cómo", "estás"]);
});

test("increases intervals for successful reviews", () => {
  const day = 24 * 60 * 60 * 1000;
  assert.equal(nextInterval({ interval: 0, attempts: 0 }, "again"), 10 * 60 * 1000);
  assert.equal(nextInterval({ interval: 0, attempts: 0 }, "good"), 3 * day);
  assert.equal(nextInterval({ interval: 3 * day, attempts: 1 }, "good"), 7.2 * day);
});

test("builds a complete bookmarklet below common browser URL limits", () => {
  const bookmarklet = buildBookmarklet();
  assert.ok(bookmarklet.length < 3000, `bookmarklet is ${bookmarklet.length} characters`);
  assert.doesNotThrow(() => new Function(bookmarklet.slice("javascript:".length)));
});

test("creates a JSON-serializable backup with review history", () => {
  const backup = createBackup(
    [{ id: "one", front: "hallo", back: "hello" }],
    { one: { attempts: 1 } },
    [{ cardId: "one", score: "good" }],
    { includeWords: true },
  );
  const restored = JSON.parse(JSON.stringify(backup));
  assert.equal(restored.type, "field-notes-backup");
  assert.equal(restored.reviews[0].score, "good");
  assert.equal(restored.progress.one.attempts, 1);
});
