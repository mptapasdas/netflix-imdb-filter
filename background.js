// Service worker: fetch IMDb ratings via our Cloudflare Worker proxy and cache them.
// Proxy holds the OMDb key server-side — nothing secret ships in this extension.

const PROXY_URL = "https://netflix-imdb-proxy.tapasdas.workers.dev";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

async function getSettings() {
  const { threshold = 7, displayMode = "dim" } = await chrome.storage.local.get([
    "threshold",
    "displayMode",
  ]);
  return { threshold, displayMode };
}

async function getCache() {
  const { ratingCache = {} } = await chrome.storage.local.get("ratingCache");
  return ratingCache;
}

function cacheKey(title, year) {
  return `${title}||${year || ""}`.toLowerCase();
}

async function getRequestCount() {
  try {
    const res = await fetch(`${PROXY_URL}/count`);
    if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    return { date: null, count: 0 };
  }
}

async function fetchRating(title, year) {
  const params = new URLSearchParams({ title });
  if (year) params.set("year", year);

  const res = await fetch(`${PROXY_URL}/rating?${params.toString()}`);
  if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
  const data = await res.json();
  return { rating: data.rating ?? null };
}

async function lookup(title, year) {
  const key = cacheKey(title, year);
  const cache = await getCache();
  const hit = cache[key];
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
    return { rating: hit.rating };
  }

  try {
    const { rating } = await fetchRating(title, year);
    cache[key] = { rating, ts: Date.now() };
    await chrome.storage.local.set({ ratingCache: cache });
    return { rating };
  } catch (e) {
    return { rating: null, error: String(e) };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "getRating") {
    lookup(msg.title, msg.year).then(sendResponse);
    return true; // async response
  }
  if (msg.type === "getSettings") {
    getSettings().then(sendResponse);
    return true;
  }
  if (msg.type === "getRequestCount") {
    getRequestCount().then(sendResponse);
    return true;
  }
});
