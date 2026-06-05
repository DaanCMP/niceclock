const express = require("express");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");

const app = express();
const PORT = process.env.PORT || 8080;
const publicDir = path.join(__dirname, "..", "public");
const backgroundsDir = path.join(publicDir, "backgrounds");

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseDisplayConfig(prefix, defaults) {
  const name = process.env[`${prefix}_CITY`] || defaults.city;
  const lat = parseFloat(process.env[`${prefix}_LAT`] ?? defaults.lat);
  const lon = parseFloat(process.env[`${prefix}_LON`] ?? defaults.lon);
  const timezone =
    process.env[`${prefix}_TIMEZONE`] || defaults.timezone;
  const slug =
    process.env[`${prefix}_SLUG`] || defaults.slug || slugify(name);

  return { city: name, lat, lon, timezone, slug };
}

const displays = {
  1: parseDisplayConfig("DISPLAY_1", {
    city: "Willemstad",
    lat: 12.1224,
    lon: -68.8824,
    timezone: "America/Curacao",
    slug: "willemstad",
  }),
  2: parseDisplayConfig("DISPLAY_2", {
    city: "Hilversum",
    lat: 52.2292,
    lon: 5.1669,
    timezone: "Europe/Amsterdam",
    slug: "hilversum",
  }),
};

const weatherCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

let fetchChain = Promise.resolve();

function runSerialized(task) {
  const result = fetchChain.then(task);
  fetchChain = result.catch(() => {});
  return result;
}

async function fetchFromOpenMeteo(lat, lon, timezone) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current:
      "temperature_2m,relative_humidity_2m,weather_code,is_day,wind_speed_10m",
    daily: "sunrise,sunset",
    timezone,
    forecast_days: "1",
  });

  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        throw new Error(`Weather API error: ${response.status}`);
      }

      const json = await response.json();
      const current = json.current;
      const isDay = current.is_day === 1;
      const condition = wmoToCondition(current.weather_code, isDay);

      return {
        temperature: Math.round(current.temperature_2m),
        humidity: current.relative_humidity_2m,
        windSpeed: Math.round(current.wind_speed_10m),
        weatherCode: current.weather_code,
        description: wmoDescription(current.weather_code),
        isDay,
        condition,
        sunrise: json.daily?.sunrise?.[0] ?? null,
        sunset: json.daily?.sunset?.[0] ?? null,
        fetchedAt: new Date().toISOString(),
      };
    } catch (err) {
      lastError = err;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  }

  throw lastError;
}

async function fetchWeather(lat, lon, timezone) {
  const cacheKey = `${lat},${lon},${timezone}`;
  const cached = weatherCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  return runSerialized(async () => {
    const freshCached = weatherCache.get(cacheKey);
    if (freshCached && Date.now() - freshCached.fetchedAt < CACHE_TTL_MS) {
      return freshCached.data;
    }

    try {
      const data = await fetchFromOpenMeteo(lat, lon, timezone);
      weatherCache.set(cacheKey, { data, fetchedAt: Date.now() });
      return data;
    } catch (err) {
      if (freshCached) {
        console.warn("Weather fetch failed, serving stale cache:", err.message);
        return freshCached.data;
      }
      throw err;
    }
  });
}

async function prefetchWeather() {
  for (const id of [1, 2]) {
    const config = displays[id];
    try {
      await fetchWeather(config.lat, config.lon, config.timezone);
      console.log("Prefetched weather for", config.city);
    } catch (err) {
      console.error("Prefetch failed for", config.city + ":", err.message);
    }
  }
}

function wmoToCondition(code, isDay) {
  if (code === 0) return isDay ? "clear-day" : "clear-night";
  if (code <= 3) return isDay ? "partly-cloudy-day" : "partly-cloudy-night";
  if (code <= 48) return "fog";
  if (code <= 57) return "drizzle";
  if (code <= 67) return "rain";
  if (code <= 77) return "snow";
  if (code <= 82) return "rain";
  if (code <= 86) return "snow";
  return "storm";
}

function wmoDescription(code) {
  const descriptions = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Foggy",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    71: "Slight snow",
    73: "Moderate snow",
    75: "Heavy snow",
    80: "Rain showers",
    81: "Moderate showers",
    82: "Violent showers",
    95: "Thunderstorm",
    96: "Thunderstorm with hail",
    99: "Thunderstorm with heavy hail",
  };
  return descriptions[code] || "Unknown";
}

const BACKGROUND_CONDITIONS = {
  "clear-day": "day",
  "partly-cloudy-day": "day",
  "clear-night": "night",
  "partly-cloudy-night": "night",
  drizzle: "rain",
  fog: "rain",
  rain: "rain",
  snow: "rain",
  storm: "rain",
};

function backgroundCondition(condition) {
  return BACKGROUND_CONDITIONS[condition] || "day";
}

function resolveBackgroundUrl(slug, condition) {
  const fileCondition = backgroundCondition(condition);
  const extensions = [".jpg", ".jpeg", ".webp", ".png"];

  for (const ext of extensions) {
    const filePath = path.join(backgroundsDir, slug, fileCondition + ext);
    if (fs.existsSync(filePath)) {
      return `/backgrounds/${slug}/${fileCondition}${ext}`;
    }
  }

  const genericSvg = path.join(backgroundsDir, fileCondition + ".svg");
  if (fs.existsSync(genericSvg)) {
    return `/backgrounds/${fileCondition}.svg`;
  }

  return "/backgrounds/partly-cloudy-day.svg";
}

app.get("/api/config", (req, res) => {
  const displayId = req.query.display === "2" ? 2 : 1;
  res.json({ display: displayId, ...displays[displayId] });
});

app.get("/api/weather", async (req, res) => {
  const displayId = req.query.display === "2" ? 2 : 1;
  const config = displays[displayId];

  try {
    const weather = await fetchWeather(
      config.lat,
      config.lon,
      config.timezone
    );
    res.json({
      city: config.city,
      timezone: config.timezone,
      slug: config.slug,
      backgroundUrl: resolveBackgroundUrl(config.slug, weather.condition),
      ...weather,
    });
  } catch (err) {
    console.error("Weather fetch failed:", err.message);
    res.status(502).json({ error: "Failed to fetch weather" });
  }
});

app.get("/api/time", (_req, res) => {
  res.json({ epochMs: Date.now() });
});

app.use(express.static(path.join(__dirname, "..", "public")));

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

function startClockBroadcast(wss) {
  function broadcastTick() {
    const payload = JSON.stringify({ type: "tick", epochMs: Date.now() });
    for (const client of wss.clients) {
      if (client.readyState === 1) {
        client.send(payload);
      }
    }
  }

  function scheduleNextTick() {
    const msUntilNextSecond = 1000 - (Date.now() % 1000);
    setTimeout(() => {
      broadcastTick();
      scheduleNextTick();
    }, msUntilNextSecond);
  }

  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "tick", epochMs: Date.now() }));
  });

  scheduleNextTick();
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/sync" });
startClockBroadcast(wss);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`niceclock listening on http://0.0.0.0:${PORT}`);
  console.log("Display 1:", displays[1].city, displays[1].timezone);
  console.log("Display 2:", displays[2].city, displays[2].timezone);
  prefetchWeather();
});
