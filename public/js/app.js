(function () {
  const params = new URLSearchParams(window.location.search);
  const display = params.get("display") === "2" ? "2" : "1";

  const cityEl = document.getElementById("city");
  const clockEl = document.getElementById("clock");
  const dateEl = document.getElementById("date");
  const backgroundEl = document.getElementById("background");
  const tempEl = document.getElementById("temp");
  const descEl = document.getElementById("desc");
  const humidityEl = document.getElementById("humidity");
  const windEl = document.getElementById("wind");

  let timezone = "UTC";
  let cityName = "";
  let serverOffsetMs = 0;
  let fallbackTimer = null;
  let ws = null;
  let wsConnected = false;

  function formatClockParts(instant) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(instant);

    const get = (type) => parts.find((p) => p.type === type)?.value ?? "00";
    return {
      hours: get("hour"),
      minutes: get("minute"),
      seconds: get("second"),
    };
  }

  function formatDate(instant) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(instant);
  }

  function renderClock(epochMs) {
    const instant = new Date(epochMs);
    const { hours, minutes, seconds } = formatClockParts(instant);
    const timeStr = hours + ":" + minutes + ":" + seconds;
    clockEl.textContent = timeStr;
    clockEl.setAttribute("datetime", timeStr);
    dateEl.textContent = formatDate(instant);
  }

  async function syncServerOffset() {
    const t0 = performance.now();
    const res = await fetch("/api/time");
    const data = await res.json();
    const t1 = performance.now();
    const rtt = t1 - t0;
    serverOffsetMs = data.epochMs + rtt / 2 - Date.now();
  }

  function syncedEpochMs() {
    return Date.now() + serverOffsetMs;
  }

  function stopFallbackClock() {
    if (fallbackTimer !== null) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
  }

  function scheduleFallbackTick() {
    stopFallbackClock();
    const msUntilNextSecond = 1000 - (syncedEpochMs() % 1000);
    fallbackTimer = setTimeout(function () {
      renderClock(syncedEpochMs());
      scheduleFallbackTick();
    }, msUntilNextSecond);
  }

  function startFallbackClock() {
    if (wsConnected) return;
    renderClock(syncedEpochMs());
    scheduleFallbackTick();
  }

  function connectClockSync() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(protocol + "//" + location.host + "/sync");

    ws.addEventListener("open", function () {
      wsConnected = true;
      stopFallbackClock();
    });

    ws.addEventListener("message", function (event) {
      const data = JSON.parse(event.data);
      if (data.type === "tick" && typeof data.epochMs === "number") {
        renderClock(data.epochMs);
      }
    });

    ws.addEventListener("close", function () {
      wsConnected = false;
      startFallbackClock();
      setTimeout(connectClockSync, 2000);
    });

    ws.addEventListener("error", function () {
      ws.close();
    });
  }

  function setBackground(url) {
    backgroundEl.style.backgroundImage = 'url("' + url + '")';
  }

  async function loadConfig() {
    const res = await fetch("/api/config?display=" + display);
    const config = await res.json();
    timezone = config.timezone;
    cityName = config.city;
    cityEl.textContent = cityName;
    document.title = cityName + " — niceclock";
  }

  async function loadWeather() {
    try {
      const res = await fetch("/api/weather?display=" + display);
      if (!res.ok) throw new Error("weather unavailable");
      const data = await res.json();

      tempEl.textContent = data.temperature + "°";
      descEl.textContent = data.description;
      humidityEl.textContent = data.humidity + "%";
      windEl.textContent = data.windSpeed + " km/h";
      setBackground(data.backgroundUrl);
    } catch {
      descEl.textContent = "Weather unavailable";
      setBackground("/backgrounds/partly-cloudy-day.svg");
    }
  }

  async function init() {
    await loadConfig();
    await syncServerOffset();
    renderClock(syncedEpochMs());
    connectClockSync();
    setInterval(syncServerOffset, 5 * 60 * 1000);
    await loadWeather();
    setInterval(loadWeather, 10 * 60 * 1000);
  }

  init();
})();
