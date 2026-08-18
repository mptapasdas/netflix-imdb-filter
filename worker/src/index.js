// Proxies IMDb rating lookups to OMDb, holding the API key server-side only.
// Caches results in KV so repeated lookups (across all your devices) cost
// zero extra OMDb requests.

const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function cacheKey(title, year) {
  return `${title}||${year || ""}`.toLowerCase();
}

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

// Fire-and-forget counter bump. Eventually consistent is fine for a display stat.
async function bumpDailyCount(env) {
  if (!env.RATINGS_KV) return;
  const key = `count:${todayStr()}`;
  const current = parseInt((await env.RATINGS_KV.get(key)) || "0", 10);
  await env.RATINGS_KV.put(key, String(current + 1), {
    expirationTtl: 60 * 60 * 26, // just over a day, self-expires
  });
}

async function getDailyCount(env) {
  if (!env.RATINGS_KV) return { date: todayStr(), count: 0 };
  const key = `count:${todayStr()}`;
  const count = parseInt((await env.RATINGS_KV.get(key)) || "0", 10);
  return { date: todayStr(), count };
}

async function fetchFromOmdb(title, year, apiKey) {
  const params = new URLSearchParams({ apikey: apiKey, t: title });
  if (year) params.set("y", year);

  const res = await fetch(`https://www.omdbapi.com/?${params.toString()}`);
  if (!res.ok) throw new Error(`OMDb HTTP ${res.status}`);
  const data = await res.json();

  if (data.Response === "False") return { rating: null };

  const raw = data.imdbRating; // e.g. "7.4" or "N/A"
  const rating = raw && raw !== "N/A" ? parseFloat(raw) : null;
  return { rating };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);

    if (url.pathname === "/count") {
      return json(await getDailyCount(env));
    }

    if (url.pathname !== "/rating") {
      return json({ error: "not found" }, 404);
    }

    const title = url.searchParams.get("title");
    const year = url.searchParams.get("year") || "";
    if (!title) return json({ error: "missing title" }, 400);

    if (env.RATE_LIMITER) {
      const ip = request.headers.get("cf-connecting-ip") || "unknown";
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) return json({ error: "rate limit exceeded" }, 429);
    }

    await bumpDailyCount(env);

    const key = cacheKey(title, year);

    if (env.RATINGS_KV) {
      const cached = await env.RATINGS_KV.get(key);
      if (cached !== null) return json(JSON.parse(cached));
    }

    try {
      const result = await fetchFromOmdb(title, year, env.OMDB_KEY);
      if (env.RATINGS_KV) {
        await env.RATINGS_KV.put(key, JSON.stringify(result), {
          expirationTtl: CACHE_TTL_SECONDS,
        });
      }
      return json(result);
    } catch (e) {
      return json({ error: String(e) }, 502);
    }
  },
};
