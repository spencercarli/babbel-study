const STORAGE = {
  deck: "field-notes-deck-v1",
  progress: "field-notes-progress-v1",
  reviews: "field-notes-reviews-v1",
  settings: "field-notes-settings-v1",
};

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

const elements = Object.fromEntries(
  [
    "answer", "card-back", "card-front", "card-kind", "due-stat", "empty-state",
    "flashcard", "good-interval", "include-reverse", "include-words",
    "learned-stat", "paste-data", "phrase-context", "progress-bar", "remaining-count",
    "reveal", "score-actions", "settings-dialog", "tap-hint", "import-status",
  ].map((id) => [id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), document.getElementById(id)]),
);

let sourceCards = [];
let studyCards = [];
let queue = [];
let currentCard = null;
let sessionTotal = 0;
let studyAhead = false;
let progress = readStorage(STORAGE.progress, {});
let reviews = readStorage(STORAGE.reviews, []);
let settings = readStorage(STORAGE.settings, { includeWords: true, includeReverse: false });
let dragStartX = null;
let dragOffset = 0;

function readStorage(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function normalizeCard(card, index) {
  const front = String(card.front ?? card.prompt ?? card.source ?? card.word ?? "").trim();
  const back = String(card.back ?? card.answer ?? card.translation ?? card.target ?? "").trim();
  if (!front || !back) return null;
  return { id: card.id || stableId(`${front}|${back}|${index}`), front, back };
}

function stableId(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `c${(hash >>> 0).toString(36)}`;
}

function wordsIn(text) {
  const segments = "Segmenter" in Intl
    ? [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(text)]
        .filter((part) => part.isWordLike)
        .map((part) => part.segment)
    : text.match(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu) || [];

  return [...new Set(segments.map((word) => word.toLocaleLowerCase()))]
    .filter((word) => [...word].length > 1);
}

function makeStudyCards(cards) {
  const result = [];
  const seenWords = new Set();

  for (const card of cards) {
    result.push({ ...card, kind: "Phrase" });
    if (settings.includeReverse) {
      result.push({ id: `${card.id}:reverse`, front: card.back, back: card.front, kind: "Reverse" });
    }
    if (!settings.includeWords) continue;

    const words = wordsIn(card.front);
    if (words.length < 2) continue;
    for (const word of words) {
      if (seenWords.has(word)) continue;
      seenWords.add(word);
      result.push({
        id: `word:${stableId(word)}`,
        front: word,
        back: card.back,
        context: card.front,
        kind: "Word in context",
      });
    }
  }
  return result;
}

function cardState(card) {
  return progress[card.id] || { interval: 0, dueAt: 0, attempts: 0, correct: 0 };
}

function cardPriority(card, now = Date.now()) {
  const state = cardState(card);
  if (!state.attempts) return Number.MAX_SAFE_INTEGER - Math.random() * 100000;
  return now - state.dueAt + Math.random() * 1000;
}

function rebuildQueue() {
  studyCards = makeStudyCards(sourceCards);
  const now = Date.now();
  queue = studyCards
    .filter((card) => studyAhead || cardState(card).dueAt <= now)
    .sort((a, b) => cardPriority(b, now) - cardPriority(a, now));
  sessionTotal = queue.length;
  showNextCard();
  updateStats();
}

function showNextCard() {
  resetCardPosition();
  currentCard = queue.shift() || null;
  elements.answer.hidden = true;
  elements.scoreActions.hidden = true;
  elements.reveal.hidden = !currentCard;
  elements.tapHint.hidden = !currentCard;
  elements.emptyState.hidden = Boolean(currentCard);

  if (!currentCard) {
    elements.remainingCount.textContent = "0";
    elements.progressBar.style.width = "100%";
    return;
  }

  const state = cardState(currentCard);
  elements.cardFront.textContent = currentCard.front;
  elements.cardBack.textContent = currentCard.back;
  elements.cardKind.textContent = currentCard.kind;
  elements.phraseContext.hidden = !currentCard.context;
  elements.phraseContext.textContent = currentCard.context ? `From: “${currentCard.context}”` : "";
  elements.remainingCount.textContent = String(queue.length + 1);
  const complete = sessionTotal ? (sessionTotal - queue.length - 1) / sessionTotal : 1;
  elements.progressBar.style.width = `${complete * 100}%`;
  elements.goodInterval.textContent = `See again in ${formatInterval(nextInterval(state, "good"))}`;
}

function revealAnswer() {
  if (!currentCard || !elements.answer.hidden) return;
  elements.answer.hidden = false;
  elements.scoreActions.hidden = false;
  elements.reveal.hidden = true;
  elements.tapHint.hidden = true;
}

function nextInterval(state, score) {
  if (score === "again") return 10 * MINUTE;
  const previous = state.interval || DAY;
  return state.attempts ? Math.min(180 * DAY, Math.max(3 * DAY, previous * 2.4)) : 3 * DAY;
}

function resetCardPosition() {
  dragStartX = null;
  dragOffset = 0;
  elements.flashcard.classList.remove("is-dragging", "is-swiping", "drag-left", "drag-right");
  elements.flashcard.style.transform = "";
}

function canSwipe() {
  return currentCard && !elements.answer.hidden && matchMedia("(max-width: 700px), (pointer: coarse)").matches;
}

function startSwipe(event) {
  if (!canSwipe() || elements.flashcard.classList.contains("is-swiping")) return;
  dragStartX = event.clientX;
  dragOffset = 0;
  elements.flashcard.classList.add("is-dragging");
  elements.flashcard.setPointerCapture(event.pointerId);
}

function moveSwipe(event) {
  if (dragStartX === null) return;
  dragOffset = event.clientX - dragStartX;
  if (Math.abs(dragOffset) > 5) event.preventDefault();
  elements.flashcard.style.transform = `translateX(${dragOffset}px) rotate(${dragOffset * 0.035}deg)`;
  elements.flashcard.classList.toggle("drag-left", dragOffset < -20);
  elements.flashcard.classList.toggle("drag-right", dragOffset > 20);
}

function endSwipe(event) {
  if (dragStartX === null) return;
  if (elements.flashcard.hasPointerCapture(event.pointerId)) elements.flashcard.releasePointerCapture(event.pointerId);
  const threshold = Math.min(110, elements.flashcard.clientWidth * 0.24);
  if (Math.abs(dragOffset) < threshold) {
    resetCardPosition();
    return;
  }

  const score = dragOffset < 0 ? "again" : "good";
  const direction = dragOffset < 0 ? -1 : 1;
  dragStartX = null;
  elements.flashcard.classList.remove("is-dragging");
  elements.flashcard.classList.add("is-swiping");
  elements.flashcard.style.transform = `translateX(${direction * (innerWidth + elements.flashcard.clientWidth)}px) rotate(${direction * 18}deg)`;
  navigator.vibrate?.(20);
  setTimeout(() => scoreCard(score), 220);
}

function scoreCard(score) {
  if (!currentCard) return;
  const previous = cardState(currentCard);
  const interval = nextInterval(previous, score);
  const reviewedAt = Date.now();
  progress[currentCard.id] = {
    interval,
    dueAt: reviewedAt + interval,
    lastSeen: reviewedAt,
    attempts: previous.attempts + 1,
    correct: previous.correct + (score === "good" ? 1 : 0),
  };
  reviews.push({
    cardId: currentCard.id,
    front: currentCard.front,
    back: currentCard.back,
    score,
    reviewedAt: new Date(reviewedAt).toISOString(),
    interval,
    dueAt: new Date(reviewedAt + interval).toISOString(),
  });
  saveStorage(STORAGE.progress, progress);
  saveStorage(STORAGE.reviews, reviews);
  showNextCard();
  updateStats();
}

function formatInterval(milliseconds) {
  if (milliseconds < DAY) return `${Math.round(milliseconds / MINUTE)} min`;
  const days = Math.round(milliseconds / DAY);
  return days === 1 ? "1 day" : `${days} days`;
}

function updateStats() {
  const states = studyCards.map(cardState);
  const attempts = states.reduce((sum, state) => sum + state.attempts, 0);
  const correct = states.reduce((sum, state) => sum + state.correct, 0);
  elements.dueStat.textContent = String(studyCards.filter((card) => cardState(card).dueAt <= Date.now()).length);
  elements.learnedStat.textContent = String(states.filter((state) => state.attempts > 0).length);
  document.getElementById("accuracy-stat").textContent = attempts ? `${Math.round(correct / attempts * 100)}%` : "—";
}

function parseDelimited(text) {
  return text.split(/\r?\n/).map((line, index) => {
    const separator = line.includes("\t") ? "\t" : line.includes(";") ? ";" : ",";
    const [front, ...back] = line.split(separator);
    return normalizeCard({ front, back: back.join(separator) }, index);
  }).filter(Boolean);
}

function parseDeck(text) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("The file or pasted text is empty.");
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    const rows = Array.isArray(parsed) ? parsed : parsed.cards;
    if (!Array.isArray(rows)) throw new Error("JSON must be an array or contain a cards array.");
    return rows.map(normalizeCard).filter(Boolean);
  }
  return parseDelimited(trimmed);
}

function replaceDeck(cards) {
  if (!cards.length) throw new Error("No valid prompt and answer pairs were found.");
  sourceCards = cards;
  saveStorage(STORAGE.deck, { version: 1, cards });
  studyAhead = false;
  rebuildQueue();
  elements.importStatus.textContent = `Imported ${cards.length} cards. This browser now uses your custom deck.`;
}

function createBackup(cards, savedProgress, reviewHistory, savedSettings) {
  return {
    version: 2,
    type: "field-notes-backup",
    exportedAt: new Date().toISOString(),
    cards,
    progress: savedProgress,
    reviews: reviewHistory,
    settings: savedSettings,
  };
}

function importStudyData(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    if (parsed.type === "field-notes-backup" && Array.isArray(parsed.cards)) {
      sourceCards = parsed.cards.map(normalizeCard).filter(Boolean);
      if (!sourceCards.length) throw new Error("The backup contains no valid cards.");
      progress = parsed.progress && typeof parsed.progress === "object" ? parsed.progress : {};
      reviews = Array.isArray(parsed.reviews) ? parsed.reviews : [];
      settings = { includeWords: true, includeReverse: false, ...(parsed.settings || {}) };
      saveStorage(STORAGE.deck, { version: 1, cards: sourceCards });
      saveStorage(STORAGE.progress, progress);
      saveStorage(STORAGE.reviews, reviews);
      saveStorage(STORAGE.settings, settings);
      elements.includeWords.checked = settings.includeWords;
      elements.includeReverse.checked = settings.includeReverse;
      studyAhead = false;
      rebuildQueue();
      elements.importStatus.textContent = `Restored ${sourceCards.length} cards and ${reviews.length} review responses.`;
      return;
    }
  }
  replaceDeck(parseDeck(trimmed));
}

function download(filename, data) {
  const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  link.click();
  URL.revokeObjectURL(url);
}

function buildBookmarklet() {
  async function exportBabbel() {
    const row = "tr[data-testid^='learned-item-row-learned-items-']";
    const button = (name) => document.querySelector(`[data-testid='all-items-list-footer-paginator-link-${name}'] button`);
    const firstId = () => document.querySelector(row)?.dataset.testid;
    const wait = async (id) => {
      for (let attempt = 0; attempt < 100 && firstId() === id; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };
    const first = button("first");
    if (first && !first.disabled) {
      const id = firstId();
      first.click();
      await wait(id);
    }
    const cards = [];
    const seen = new Set();
    for (let page = 0; page < 100; page += 1) {
      const rows = [...document.querySelectorAll(row)];
      for (const item of rows) {
        const front = item.querySelector("[data-testid^='learned-item-row-learn-text-']")?.textContent.trim();
        const back = item.querySelector("[data-testid^='learned-item-row-display-text-']")?.textContent.trim();
        const key = `${front}\u0000${back}`;
        if (front && back && !seen.has(key)) {
          seen.add(key);
          cards.push({ front, back });
        }
      }
      const next = button("next");
      if (!next || next.disabled) break;
      const id = firstId();
      next.click();
      await wait(id);
    }
    if (!cards.length) {
      alert("No review rows were found. Make sure the Review Manager list is visible, then try again.");
      return;
    }
    const payload = JSON.stringify({ version: 1, source: location.href, exportedAt: new Date().toISOString(), cards }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: `babbel-words-${new Date().toISOString().slice(0, 10)}.json` });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    alert(`Exported ${cards.length} Babbel items.`);
  }
  return `javascript:(${exportBabbel.toString()})()`;
}

function bindEvents() {
  document.getElementById("open-settings").addEventListener("click", () => elements.settingsDialog.showModal());
  document.getElementById("close-settings").addEventListener("click", () => elements.settingsDialog.close());
  elements.settingsDialog.addEventListener("click", (event) => {
    if (event.target === elements.settingsDialog) elements.settingsDialog.close();
  });
  elements.reveal.addEventListener("click", revealAnswer);
  elements.flashcard.addEventListener("click", revealAnswer);
  elements.flashcard.addEventListener("pointerdown", startSwipe);
  elements.flashcard.addEventListener("pointermove", moveSwipe);
  elements.flashcard.addEventListener("pointerup", endSwipe);
  elements.flashcard.addEventListener("pointercancel", resetCardPosition);
  document.addEventListener("keydown", (event) => {
    if (elements.settingsDialog.open) return;
    if (event.code === "Space") { event.preventDefault(); revealAnswer(); }
    if (!elements.scoreActions.hidden && ["Digit1", "Digit2"].includes(event.code)) {
      scoreCard({ Digit1: "again", Digit2: "good" }[event.code]);
    }
  });
  document.querySelectorAll("[data-score]").forEach((button) => button.addEventListener("click", () => scoreCard(button.dataset.score)));
  document.getElementById("study-ahead").addEventListener("click", () => { studyAhead = true; rebuildQueue(); });
  document.getElementById("import-paste").addEventListener("click", () => {
    try { importStudyData(elements.pasteData.value); } catch (error) { elements.importStatus.textContent = error.message; }
  });
  document.getElementById("file-input").addEventListener("change", async (event) => {
    try { importStudyData(await event.target.files[0].text()); } catch (error) { elements.importStatus.textContent = error.message; }
  });
  document.getElementById("export-deck").addEventListener("click", () => {
    const backup = createBackup(sourceCards, progress, reviews, settings);
    download(`field-notes-backup-${backup.exportedAt.slice(0, 10)}.json`, JSON.stringify(backup, null, 2));
  });
  document.getElementById("reset-progress").addEventListener("click", () => {
    if (!confirm("Reset all study history in this browser? Your deck will be kept.")) return;
    progress = {};
    reviews = [];
    saveStorage(STORAGE.progress, progress);
    saveStorage(STORAGE.reviews, reviews);
    rebuildQueue();
  });
  document.getElementById("clear-deck").addEventListener("click", () => {
    if (!confirm("Remove every word and phrase from this browser? Study history will also be cleared.")) return;
    sourceCards = [];
    progress = {};
    reviews = [];
    saveStorage(STORAGE.deck, { version: 1, cards: [] });
    saveStorage(STORAGE.progress, progress);
    saveStorage(STORAGE.reviews, reviews);
    studyAhead = false;
    rebuildQueue();
    elements.importStatus.textContent = "All words and study history have been cleared.";
  });
  for (const [element, key] of [[elements.includeWords, "includeWords"], [elements.includeReverse, "includeReverse"]]) {
    element.checked = settings[key];
    element.addEventListener("change", () => {
      settings[key] = element.checked;
      saveStorage(STORAGE.settings, settings);
      studyAhead = false;
      rebuildQueue();
    });
  }
  document.getElementById("bookmarklet").href = buildBookmarklet();
}

async function initialize() {
  bindEvents();
  const customDeck = readStorage(STORAGE.deck, null);
  if (customDeck?.cards) {
    sourceCards = customDeck.cards.map(normalizeCard).filter(Boolean);
  } else {
    const response = await fetch("data/words.json");
    const defaultDeck = await response.json();
    sourceCards = defaultDeck.cards.map(normalizeCard).filter(Boolean);
  }
  rebuildQueue();
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("service-worker.js");
}

initialize().catch((error) => {
  elements.cardFront.textContent = "Could not load the deck";
  elements.cardBack.textContent = error.message;
});

export { buildBookmarklet, createBackup, formatInterval, makeStudyCards, nextInterval, normalizeCard, parseDeck, stableId, wordsIn };
