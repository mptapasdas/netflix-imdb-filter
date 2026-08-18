// Scrape Netflix title tiles, look up IMDb rating, hide if below threshold.

let THRESHOLD = 7;
let DISPLAY_MODE = "dim"; // "dim" | "hide"

const processed = new WeakSet();
let contextDead = false;

function isContextAlive() {
  if (contextDead) return false;
  if (!chrome.runtime?.id) {
    contextDead = true;
    return false;
  }
  return true;
}

function safeSendMessage(msg, cb) {
  if (!isContextAlive()) return;
  try {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        contextDead = true;
        return;
      }
      cb(resp);
    });
  } catch (e) {
    contextDead = true;
  }
}

// Netflix's own CSS classes are hashed/build-specific and unreliable.
// data-uia is Netflix's stable QA hook — use that instead.
const TILE_SELECTORS = [
  '[data-uia$="-card"]',
  ".title-card-container",
  ".title-card",
  ".slider-item",
  ".gallery-item",
];

function extractTitle(tile) {
  // Title tile itself may carry the aria-label (standard-card layout).
  if (tile.hasAttribute("aria-label")) {
    const v = tile.getAttribute("aria-label").trim();
    if (v) return v;
  }

  const fallback = tile.querySelector(".fallback-text");
  if (fallback && fallback.textContent.trim()) return fallback.textContent.trim();

  const aria = tile.querySelector("[aria-label]");
  if (aria) {
    const v = aria.getAttribute("aria-label").trim();
    if (v) return v;
  }

  const img = tile.querySelector("img[alt]");
  if (img && img.alt.trim()) return img.alt.trim();

  return null;
}

function hideTarget(tile) {
  // Hide the whole grid slot (if present) so the row reflows cleanly,
  // not just the inner card link.
  return tile.closest("[data-virtual-slot]") || tile;
}

function cleanTitle(raw) {
  // Strip trailing "Season X", episode markers, etc. for better OMDb match.
  return raw
    .replace(/\s*[:\-–]\s*(season|series|part|volume)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function markLow(tile) {
  const slot = hideTarget(tile);
  slot.classList.remove("nif-hidden");
  tile.classList.remove("nif-dim");
  if (DISPLAY_MODE === "hide") {
    slot.classList.add("nif-hidden");
  } else {
    tile.classList.add("nif-dim"); // opacity on card only, not the slot/badge
  }
}

function markShown(tile) {
  hideTarget(tile).classList.remove("nif-hidden");
  tile.classList.remove("nif-dim");
}

function showBadge(tile, rating) {
  const slot = hideTarget(tile);
  slot.classList.add("nif-anchor"); // position:relative host for the badge
  let badge = slot.querySelector(":scope > .nif-badge");
  if (!badge) {
    badge = document.createElement("div");
    badge.className = "nif-badge";
    slot.appendChild(badge);
  }
  badge.textContent = rating.toFixed(1);
}

async function processTile(tile) {
  if (processed.has(tile)) return;
  const raw = extractTitle(tile);
  if (!raw) return; // no title yet; lazy-load may fill later
  processed.add(tile);

  const title = cleanTitle(raw);
  safeSendMessage({ type: "getRating", title }, (resp) => {
    if (!resp) return;
    const r = resp.rating;
    // Unknown rating (null) => leave visible, no badge. Only act on known ratings.
    if (typeof r === "number" && r < THRESHOLD) {
      markLow(tile);
      showBadge(tile, r);
      tile.dataset.nifRating = r;
    } else if (typeof r === "number") {
      markShown(tile);
      showBadge(tile, r); // still show rating on titles above threshold
      tile.dataset.nifRating = r;
    }
  });
}

function scan(root = document) {
  if (!isContextAlive()) return;
  for (const sel of TILE_SELECTORS) {
    root.querySelectorAll(sel).forEach(processTile);
  }
}

function init() {
  safeSendMessage({ type: "getSettings" }, (s) => {
    if (s) {
      THRESHOLD = s.threshold ?? 7;
      DISPLAY_MODE = s.displayMode ?? "dim";
    }
    scan();
  });

  const obs = new MutationObserver((muts) => {
    if (!isContextAlive()) {
      obs.disconnect();
      return;
    }
    for (const m of muts) {
      m.addedNodes.forEach((n) => {
        if (n.nodeType === 1) scan(n);
      });
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  // Netflix lazy-loads title text; re-scan periodically to catch fills.
  const intervalId = setInterval(() => {
    if (!isContextAlive()) {
      clearInterval(intervalId);
      return;
    }
    scan();
  }, 3000);
}

// Re-read settings when changed via popup.
chrome.storage.onChanged.addListener((changes) => {
  if (changes.threshold) THRESHOLD = changes.threshold.newValue;
  if (changes.displayMode) DISPLAY_MODE = changes.displayMode.newValue;
});

init();
