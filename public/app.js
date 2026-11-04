// app.js — Multi-Theme Roblox UI (Tokyo Night, Dark, Light, RC7) + 0ms UI Boot & Parallel Instant Game Launch
(() => {
  let _engineStatusFn = null;
  Object.defineProperty(window, "__onEngineLoadingStatus", {
    get: () => (arg) => {
      if (typeof _engineStatusFn === "function") {
        try { return _engineStatusFn(arg); } catch (e) {}
      }
    },
    set: (fn) => { _engineStatusFn = fn; },
    configurable: true,
  });

  addEventListener("error", (e) => console.error("[app] window error:", e.message || e));
  addEventListener("unhandledrejection", (e) => console.error("[app] rejection:", e.reason));

  // -------------------------------------------------------------------------
  // 0. Apply Theme Immediately (Automatically Default to Dark)
  // -------------------------------------------------------------------------
  const THEME_KEY = "weblox_theme";
  function applyTheme(themeName) {
    const valid = ["dark", "tokyo-night", "light"];
    let chosen = valid.includes(themeName) ? themeName : "dark";
    document.documentElement.setAttribute("data-theme", chosen);
    try {
      localStorage.setItem(THEME_KEY, chosen);
    } catch (e) {}
    document.querySelectorAll("[data-theme-pick]").forEach((btn) => {
      btn.classList.toggle("active-theme", btn.dataset.themePick === chosen);
    });
  }
  // Automatically start in Dark mode with zero flash of light
  applyTheme((() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      return (stored && stored !== "light") ? stored : "dark";
    } catch (e) {
      return "dark";
    }
  })());

  // -------------------------------------------------------------------------
  // 1. Background Engine Pre-Compilation & Preload (Runs AFTER UI is rendered)
  // -------------------------------------------------------------------------
  let _enginePreloadStarted = false;
  function startEnginePreload() {
    if (_enginePreloadStarted) return;
    _enginePreloadStarted = true;

    if (!window.__preloadedMetadata) {
      window.__preloadedMetadata = fetch("/engine/WebClient.metadata.json")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
    }

    if (!window.__preloadedFlags) {
      window.__preloadedFlags = fetch("https://clientsettingscdn.roblox.com/v2/settings/application/WebClientApp")
        .then((r) => (r.ok ? r.json() : { applicationSettings: {} }))
        .catch(() => ({ applicationSettings: {} }));
    }

    if (typeof window.createWebClient !== "function" && !document.getElementById("preload-webclient-js")) {
      const s = document.createElement("script");
      s.id = "preload-webclient-js";
      s.src = "/engine/WebClient.js";
      s.async = true;
      document.head.appendChild(s);
    }

    if (!window.__precompiledWasm) {
      try {
        window.__precompiledWasm = fetch("/engine/WebClient.wasm")
          .then((r) => {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return WebAssembly.compileStreaming(r);
          })
          .then((mod) => {
            console.log("[app] WebClient.wasm precompiled in background");
            return mod;
          })
          .catch(() => {
            window.__precompiledWasm = null;
          });
      } catch (e) {
        window.__precompiledWasm = null;
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2. Clean SVG Icons & Instant Seed Data (0ms UI Render)
  // -------------------------------------------------------------------------
  const SVG_THUMB_UP = `<svg viewBox="0 0 24 24"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>`;
  const SVG_USERS = `<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
  const SVG_PLAY_MINI = `<svg width="9" height="9" viewBox="0 0 24 24" fill="var(--tn-accent-fg)"><polygon points="6,3 20,12 6,21"/></svg>`;

  function stripEmojis(str) {
    return String(str || "")
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  // Instant 0ms fallback list shown before the first network response arrives
  const INITIAL_GAMES = [
    { placeId: "123974602339071", universeId: 9271746647, name: "[UP] Just a baseplate.", creator: "Roblox", playing: 1420, rating: "94%", genre: "All" },
    { placeId: "189707", universeId: 65241, name: "Natural Disaster Survival", creator: "Stickmasterluke", playing: 18400, rating: "91%", genre: "Survival" },
    { placeId: "4924922222", universeId: 1686885941, name: "Brookhaven RP", creator: "Wolfpaq", playing: 412000, rating: "87%", genre: "Roleplay" },
    { placeId: "2753915549", universeId: 994732206, name: "Blox Fruits", creator: "Gamer Robot Inc", playing: 385000, rating: "92%", genre: "Adventure" },
    { placeId: "17625359962", universeId: 6035872082, name: "RIVALS", creator: "Nosniy Games", playing: 145000, rating: "94%", genre: "Shooter" },
    { placeId: "10449761463", universeId: 3808081382, name: "The Strongest Battlegrounds", creator: "Yielding Arts", playing: 128000, rating: "89%", genre: "Fighting" },
    { placeId: "6516141723", universeId: 2440500124, name: "DOORS", creator: "LSPLASH", playing: 42000, rating: "95%", genre: "Horror" },
    { placeId: "142823291", universeId: 66654135, name: "Murder Mystery 2", creator: "Nikilis", playing: 96000, rating: "91%", genre: "Mystery" },
    { placeId: "15101393044", universeId: 5203828273, name: "Dress To Impress", creator: "Dress To Impress Group", playing: 175000, rating: "90%", genre: "Fashion" },
    { placeId: "16732694052", universeId: 5750914919, name: "Fisch", creator: "Fisching", playing: 160000, rating: "93%", genre: "Simulation" },
    { placeId: "6872265039", universeId: 2619619496, name: "BedWars", creator: "Easy.gg", playing: 29000, rating: "85%", genre: "Fighting" },
    { placeId: "1962086868", universeId: 703124385, name: "Tower of Hell", creator: "YXCeptional Studios", playing: 24500, rating: "84%", genre: "Obby" },
    { placeId: "286090429", universeId: 111958650, name: "Arsenal", creator: "ROLVe Community", playing: 19200, rating: "89%", genre: "Shooter" },
    { placeId: "192800", universeId: 47545, name: "Work at a Pizza Place", creator: "Dued1", playing: 16800, rating: "93%", genre: "Simulation" },
  ];

  const CACHE_KEY = "weblox_cached_session_v1";
  let homeContinueGames = INITIAL_GAMES.slice(0, 7);
  let homeRecommendedGames = INITIAL_GAMES.slice(0, 8);
  let homeFavoritesGames = INITIAL_GAMES.slice(0, 14);
  let chartsTrendingGames = INITIAL_GAMES.slice(0, 14);
  let chartsPlayingNowGames = INITIAL_GAMES.slice(2, 14);
  let chartsUpAndComingGames = INITIAL_GAMES.slice(4, 14);
  let userFriends = [];
  let currentMyAvatar = "";
  const knownGamesByPlace = new Map();
  const knownGamesByUniverse = new Map();

  function registerGame(g) {
    if (!g) return g;
    if (g.name) g.name = stripEmojis(g.name);
    if (g.creator) g.creator = stripEmojis(g.creator);
    if (g.placeId) knownGamesByPlace.set(String(g.placeId), g);
    if (g.universeId) knownGamesByUniverse.set(Number(g.universeId), g);
    return g;
  }
  INITIAL_GAMES.forEach(registerGame);

  function saveSessionCache() {
    try {
      if (!window.__whoami) return;
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          who: window.__whoami,
          myAvatar: currentMyAvatar,
          friends: userFriends,
          homeContinueGames,
          homeRecommendedGames,
          homeFavoritesGames,
          chartsTrendingGames,
          chartsPlayingNowGames,
          chartsUpAndComingGames,
        })
      );
    } catch (e) {}
  }

  function restoreSessionCache() {
    try {
      if (!localStorage.getItem("weblox_user_logged_in")) return false;
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || !data.who) return false;
      window.__whoami = data.who;
      const myDisplay = data.who.displayName || data.who.name || "Player";
      topUsername.textContent = myDisplay;
      sideUsername.textContent = myDisplay;
      currentMyAvatar = data.myAvatar || makeAvatarPlaceholder(myDisplay);
      topAvatar.src = currentMyAvatar;
      sideAvatar.src = currentMyAvatar;
      topUser.style.display = "flex";
      loginSwitchBtn.style.display = "none";
      signupSwitchBtn.style.display = "none";

      if (Array.isArray(data.friends)) userFriends = data.friends;
      if (data.homeContinueGames && data.homeContinueGames.length) homeContinueGames = data.homeContinueGames.map(registerGame);
      if (data.homeRecommendedGames && data.homeRecommendedGames.length) homeRecommendedGames = data.homeRecommendedGames.map(registerGame);
      if (data.homeFavoritesGames && data.homeFavoritesGames.length) homeFavoritesGames = data.homeFavoritesGames.map(registerGame);
      if (data.chartsTrendingGames && data.chartsTrendingGames.length) chartsTrendingGames = data.chartsTrendingGames.map(registerGame);
      if (data.chartsPlayingNowGames && data.chartsPlayingNowGames.length) chartsPlayingNowGames = data.chartsPlayingNowGames.map(registerGame);
      if (data.chartsUpAndComingGames && data.chartsUpAndComingGames.length) chartsUpAndComingGames = data.chartsUpAndComingGames.map(registerGame);
      return true;
    } catch (e) {
      return false;
    }
  }

  function makeFallbackThumb(title, placeId, wide = false) {
    const num = Number(placeId) || 1;
    const h1 = 215 + (num % 35);
    const h2 = 230 + ((num * 7) % 30);
    const w = wide ? 768 : 256;
    const h = wide ? 432 : 256;
    const label = stripEmojis(title || "Roblox").slice(0, 18);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="hsl(${h1}, 35%, 22%)"/>
          <stop offset="100%" stop-color="hsl(${h2}, 40%, 12%)"/>
        </linearGradient>
      </defs>
      <rect width="${w}" height="${h}" fill="url(#g)"/>
      <text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" fill="#c0caf5" font-family="Arial, sans-serif" font-weight="800" font-size="${wide ? 36 : 26}">${label.replace(/[<>&"']/g, "")}</text>
    </svg>`;
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  }

  function makeAvatarPlaceholder(name) {
    const ch = stripEmojis(name || "R").charAt(0).toUpperCase() || "R";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150">
      <rect width="150" height="150" rx="75" fill="#24283b"/>
      <circle cx="75" cy="56" r="26" fill="#565f89"/>
      <path d="M30 135 C30 98 120 98 120 135" fill="#565f89"/>
      <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-family="Arial" font-weight="800" font-size="24">${ch}</text>
    </svg>`;
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  }

  function formatCount(n) {
    if (n === null || n === undefined || n === "—") return "—";
    const num = Number(n);
    if (!Number.isFinite(num)) return "0";
    if (num >= 1e9) return (num / 1e9).toFixed(1) + "B+";
    if (num >= 1e6) return (num / 1e6).toFixed(1) + "M+";
    if (num >= 1e3) return (num / 1e3).toFixed(1) + "K";
    return num.toLocaleString();
  }

  function formatDate(iso) {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return "—";
      return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    } catch (e) {
      return "—";
    }
  }

  // -------------------------------------------------------------------------
  // 3. DOM Elements & View Switching
  // -------------------------------------------------------------------------
  const shell = document.getElementById("rbx-shell");
  const bodyWrap = document.getElementById("rbx-body");
  const viewHome = document.getElementById("view-home");
  const viewFriends = document.getElementById("view-friends");
  const viewCharts = document.getElementById("view-charts");
  const viewCollection = document.getElementById("view-collection");
  const viewSearch = document.getElementById("view-search");
  const viewDetail = document.getElementById("view-game-detail");

  const topUser = document.getElementById("rbx-top-user");
  const topAvatar = document.getElementById("rbx-top-avatar");
  const topUsername = document.getElementById("rbx-top-username");
  const sideAvatar = document.getElementById("rbx-side-avatar");
  const sideUsername = document.getElementById("rbx-side-username");
  const sideFriendCount = document.getElementById("rbx-side-friend-count");

  const loginSwitchBtn = document.getElementById("rbx-login-switch-btn");
  const signupSwitchBtn = document.getElementById("rbx-signup-switch-btn");
  const settingsBtn = document.getElementById("rbx-settings-btn");
  const settingsMenu = document.getElementById("rbx-settings-menu");

  const searchInput = document.getElementById("rbx-search-input");
  const searchClear = document.getElementById("rbx-search-clear");

  let activeDetailGame = null;
  let isLaunching = false;
  let activeFriendFilter = "all";
  let activeFriendQuery = "";
  let lastActiveView = "home";

  function showView(name) {
    if (name !== "detail") {
      lastActiveView = name;
    }
    const auth = window.auth;
    if (auth) auth.visible(false);
    bodyWrap.style.display = "flex";

    viewHome.style.display = name === "home" ? "block" : "none";
    viewFriends.style.display = name === "friends" ? "block" : "none";
    viewCharts.style.display = name === "charts" ? "block" : "none";
    if (viewCollection) viewCollection.style.display = name === "collection" ? "block" : "none";
    if (viewSearch) viewSearch.style.display = name === "search" ? "block" : "none";
    viewDetail.style.display = name === "detail" ? "block" : "none";

    document.querySelectorAll(".rbx-side-item").forEach((el) => {
      el.classList.toggle("active", el.dataset.side === name);
    });

    document.getElementById("rbx-main").scrollTop = 0;
  }

  function openCollectionView(title, gamesList) {
    const titleEl = document.getElementById("collection-page-title");
    const gridEl = document.getElementById("collection-grid");
    if (titleEl) titleEl.textContent = title;
    if (gridEl) {
      gridEl.innerHTML = "";
      for (const g of gamesList || []) {
        gridEl.appendChild(createSquareTile(g));
      }
    }
    showView("collection");
  }

  // -------------------------------------------------------------------------
  // 4. Rendering Components
  // -------------------------------------------------------------------------
  function createStatSpan(svgHtml, text) {
    const span = document.createElement("span");
    span.className = "rbx-stat-item";
    span.innerHTML = svgHtml;
    const t = document.createElement("span");
    t.textContent = text;
    span.appendChild(t);
    return span;
  }

  function createSquareTile(game) {
    const tile = document.createElement("div");
    tile.className = "rbx-exp-tile";

    const cleanName = stripEmojis(game.name || `Place ${game.placeId}`);

    const thumbWrap = document.createElement("div");
    thumbWrap.className = "rbx-exp-thumb";
    const img = document.createElement("img");
    img.src = game.thumb || makeFallbackThumb(cleanName, game.placeId || game.universeId, false);
    img.alt = cleanName;
    img.loading = "lazy";
    thumbWrap.appendChild(img);

    // Quick-Play Overlay on Hover (Clicking launches immediately)
    const playOverlay = document.createElement("div");
    playOverlay.className = "rbx-exp-play-overlay";
    const qPlayBtn = document.createElement("button");
    qPlayBtn.className = "rbx-exp-quick-play-btn";
    qPlayBtn.title = "Play Now";
    qPlayBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,3 20,12 6,21"/></svg>`;
    qPlayBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      launchExperience(game);
    });
    playOverlay.appendChild(qPlayBtn);
    thumbWrap.appendChild(playOverlay);

    const title = document.createElement("div");
    title.className = "rbx-exp-title";
    title.textContent = cleanName;

    const stats = document.createElement("div");
    stats.className = "rbx-exp-stats";
    stats.appendChild(createStatSpan(SVG_THUMB_UP, game.rating || "90%"));
    stats.appendChild(createStatSpan(SVG_USERS, formatCount(game.playing || 0)));

    tile.appendChild(thumbWrap);
    tile.appendChild(title);
    tile.appendChild(stats);

    tile.addEventListener("click", () => openExperienceDetail(game));
    return tile;
  }

  function createRecommendedCard(game) {
    const card = document.createElement("div");
    card.className = "rbx-rec-card";

    const cleanName = stripEmojis(game.name || `Place ${game.placeId}`);

    const banner = document.createElement("div");
    banner.className = "rbx-rec-banner";
    const bImg = document.createElement("img");
    bImg.src = game.banner || game.thumb || makeFallbackThumb(cleanName, game.placeId || game.universeId, true);
    bImg.alt = cleanName;
    bImg.loading = "lazy";
    banner.appendChild(bImg);

    // Quick-Play Overlay on Hover
    const playOverlay = document.createElement("div");
    playOverlay.className = "rbx-exp-play-overlay";
    const qPlayBtn = document.createElement("button");
    qPlayBtn.className = "rbx-exp-quick-play-btn";
    qPlayBtn.title = "Play Now";
    qPlayBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,3 20,12 6,21"/></svg>`;
    qPlayBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      launchExperience(game);
    });
    playOverlay.appendChild(qPlayBtn);
    banner.appendChild(playOverlay);

    const foot = document.createElement("div");
    foot.className = "rbx-rec-foot";

    const mini = document.createElement("img");
    mini.className = "rbx-rec-mini-icon";
    mini.src = game.thumb || makeFallbackThumb(cleanName, game.placeId || game.universeId, false);
    mini.alt = "";

    const meta = document.createElement("div");
    meta.className = "rbx-rec-meta";

    const title = document.createElement("div");
    title.className = "rbx-exp-title";
    title.textContent = cleanName;

    const stats = document.createElement("div");
    stats.className = "rbx-exp-stats";
    stats.appendChild(createStatSpan(SVG_THUMB_UP, game.rating || "91%"));
    stats.appendChild(createStatSpan(SVG_USERS, formatCount(game.playing || 0) + " Playing"));

    meta.appendChild(title);
    meta.appendChild(stats);
    foot.appendChild(mini);
    foot.appendChild(meta);

    card.appendChild(banner);
    card.appendChild(foot);
    card.addEventListener("click", () => openExperienceDetail(game));
    return card;
  }

  // -------------------------------------------------------------------------
  // 4B. Hero Spotlight Marquee (Next-Gen Client Feature)
  // -------------------------------------------------------------------------
  let currentSpotlightIndex = 0;
  let spotlightIntervalTimer = null;
  let spotlightGames = [];

  function updateSpotlightView(idx) {
    if (!spotlightGames || !spotlightGames.length) return;
    currentSpotlightIndex = (idx + spotlightGames.length) % spotlightGames.length;
    const g = spotlightGames[currentSpotlightIndex];
    if (!g) return;

    const bgImg = document.getElementById("hero-spotlight-bg");
    const titleEl = document.getElementById("hero-spotlight-title");
    const playLiveEl = document.getElementById("hero-spotlight-playing");
    const ratingEl = document.getElementById("hero-spotlight-rating");
    const genreEl = document.getElementById("hero-spotlight-genre");
    const creatorEl = document.getElementById("hero-spotlight-creator");
    const descEl = document.getElementById("hero-spotlight-desc");
    const dotsEl = document.getElementById("hero-spotlight-dots");

    const cleanName = stripEmojis(g.name || `Place ${g.placeId}`);
    if (bgImg) {
      bgImg.src = g.banner || g.thumb || makeFallbackThumb(cleanName, g.placeId, true);
    }
    if (titleEl) titleEl.textContent = cleanName;
    if (playLiveEl) {
      playLiveEl.innerHTML = `<span class="pulse-dot"></span> ${formatCount(g.playing || 0)} Playing`;
    }
    if (ratingEl) ratingEl.textContent = `★ ${g.rating || "94%"}`;
    if (genreEl) genreEl.textContent = g.genre || "Adventure";
    if (creatorEl) creatorEl.textContent = `By ${stripEmojis(g.creator || "Roblox")}`;
    if (descEl) {
      descEl.textContent =
        stripEmojis(g.description) ||
        `Jump into ${cleanName}, one of the top trending multiplayer experiences right now.`;
    }

    if (dotsEl) {
      dotsEl.querySelectorAll(".rbx-hero-dot").forEach((d, i) => {
        d.classList.toggle("active", i === currentSpotlightIndex);
      });
    }
  }

  function startSpotlightTimer() {
    if (spotlightIntervalTimer) clearInterval(spotlightIntervalTimer);
    spotlightIntervalTimer = setInterval(() => {
      if (viewHome && viewHome.style.display !== "none") {
        updateSpotlightView(currentSpotlightIndex + 1);
      }
    }, 7500);
  }

  function initHeroSpotlight() {
    const pool = (homeRecommendedGames.length ? homeRecommendedGames : INITIAL_GAMES).slice(0, 5);
    spotlightGames = pool;

    const dotsEl = document.getElementById("hero-spotlight-dots");
    if (dotsEl) {
      dotsEl.innerHTML = "";
      spotlightGames.forEach((_, i) => {
        const dot = document.createElement("button");
        dot.className = "rbx-hero-dot" + (i === currentSpotlightIndex ? " active" : "");
        dot.title = `Spotlight ${i + 1}`;
        dot.addEventListener("click", (e) => {
          e.stopPropagation();
          updateSpotlightView(i);
        });
        dotsEl.appendChild(dot);
      });
    }

    const playBtn = document.getElementById("hero-spotlight-play-btn");
    if (playBtn) {
      playBtn.onclick = (e) => {
        e.stopPropagation();
        const g = spotlightGames[currentSpotlightIndex];
        if (g) launchExperience(g);
      };
    }

    const infoBtn = document.getElementById("hero-spotlight-info-btn");
    if (infoBtn) {
      infoBtn.onclick = (e) => {
        e.stopPropagation();
        const g = spotlightGames[currentSpotlightIndex];
        if (g) openExperienceDetail(g);
      };
    }

    const heroWrap = document.getElementById("home-hero-spotlight");
    if (heroWrap) {
      heroWrap.onmouseenter = () => {
        if (spotlightIntervalTimer) clearInterval(spotlightIntervalTimer);
      };
      heroWrap.onmouseleave = () => {
        startSpotlightTimer();
      };
    }

    updateSpotlightView(currentSpotlightIndex);
    startSpotlightTimer();
  }

  function renderHomeAndCharts() {
    initHeroSpotlight();

    const contRow = document.getElementById("home-continue-row");
    contRow.innerHTML = "";
    for (const g of homeContinueGames.slice(0, 7)) {
      contRow.appendChild(createSquareTile(g));
    }

    const recGrid = document.getElementById("home-recommended-grid");
    recGrid.innerHTML = "";
    for (const g of homeRecommendedGames.slice(0, 8)) {
      recGrid.appendChild(createRecommendedCard(g));
    }

    const clsRow = document.getElementById("home-classics-row");
    clsRow.innerHTML = "";
    for (const g of homeFavoritesGames.slice(0, 14)) {
      clsRow.appendChild(createSquareTile(g));
    }

    const trRow = document.getElementById("charts-trending-row");
    const enRow = document.getElementById("charts-engaging-row");
    const clRow = document.getElementById("charts-classics-row");
    trRow.innerHTML = "";
    enRow.innerHTML = "";
    clRow.innerHTML = "";

    for (const g of chartsTrendingGames) trRow.appendChild(createSquareTile(g));
    for (const g of chartsPlayingNowGames) enRow.appendChild(createSquareTile(g));
    for (const g of chartsUpAndComingGames) clRow.appendChild(createSquareTile(g));
  }

  function renderFriends(friendsList) {
    const strip = document.getElementById("home-friends-strip");
    const grid = document.getElementById("friends-full-grid");
    const homeHeading = document.getElementById("home-friends-heading");
    const pageTitle = document.getElementById("friends-page-title");

    const count = friendsList.length;
    homeHeading.textContent = `Friends (${count})`;
    pageTitle.textContent = `My Friends (${count})`;
    sideFriendCount.textContent = String(count);

    strip.innerHTML = "";
    grid.innerHTML = "";

    if (count === 0) {
      const empty = document.createElement("div");
      empty.style.color = "var(--tn-fg-muted)";
      empty.style.fontSize = "14px";
      empty.style.padding = "12px 0";
      empty.textContent = "No friends found.";
      strip.appendChild(empty);
      grid.appendChild(empty.cloneNode(true));
      return;
    }

    // 1. Home horizontal Friends row — Strictly 9 friends shown at a time
    for (const f of friendsList.slice(0, 9)) {
      const displayName = f.displayName || f.name || `User ${f.id}`;
      const username = f.name || displayName;

      const tile = document.createElement("div");
      tile.className = "rbx-friend-tile";
      const avWrap = document.createElement("div");
      avWrap.className = "rbx-friend-avatar-wrap";
      if (f.presenceType === 2) {
        avWrap.classList.add("status-ingame");
      } else if (f.presenceType === 1) {
        avWrap.classList.add("status-online");
      }
      const img = document.createElement("img");
      img.src = f.avatar || makeAvatarPlaceholder(displayName);
      img.alt = displayName;
      avWrap.appendChild(img);

      const dot = document.createElement("div");
      dot.className =
        "rbx-presence-dot " +
        (f.presenceType === 2 ? "rbx-presence-ingame" : f.presenceType === 1 ? "rbx-presence-online" : "rbx-presence-offline");
      if (f.presenceType === 2) dot.innerHTML = SVG_PLAY_MINI;
      avWrap.appendChild(dot);

      const fname = document.createElement("div");
      fname.className = "rbx-friend-name";
      fname.textContent = displayName;
      fname.title = `${displayName} (@${username})`;

      const fsub = document.createElement("div");
      if (f.presenceType === 2 && f.lastLocation) {
        fsub.className = "rbx-friend-game";
        fsub.textContent = stripEmojis(f.lastLocation);
      } else {
        fsub.className = "rbx-friend-handle-sub";
        fsub.textContent = "@" + username;
      }

      tile.appendChild(avWrap);
      tile.appendChild(fname);
      tile.appendChild(fsub);

      tile.addEventListener("click", () => {
        if (f.placeId) {
          openExperienceDetail({
            placeId: String(f.placeId),
            universeId: f.universeId || null,
            name: stripEmojis(f.lastLocation || `Place ${f.placeId}`),
          });
        } else {
          showView("friends");
        }
      });
      strip.appendChild(tile);
    }

    renderFriendsPageGrid();
  }

  function renderFriendsPageGrid() {
    const grid = document.getElementById("friends-full-grid");
    grid.innerHTML = "";

    const q = (activeFriendQuery || "").trim().toLowerCase();
    const filtered = userFriends.filter((f) => {
      if (activeFriendFilter === "online" && f.presenceType < 1) return false;
      if (activeFriendFilter === "ingame" && f.presenceType !== 2) return false;
      if (q) {
        const dn = String(f.displayName || "").toLowerCase();
        const un = String(f.name || "").toLowerCase();
        if (!dn.includes(q) && !un.includes(q)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.style.color = "var(--tn-fg-muted)";
      empty.style.fontSize = "14px";
      empty.style.padding = "12px 0";
      empty.textContent = "No matching friends.";
      grid.appendChild(empty);
      return;
    }

    for (const f of filtered) {
      const displayName = f.displayName || f.name || `User ${f.id}`;
      const username = f.name || displayName;

      const card = document.createElement("div");
      card.className = "rbx-friend-card";

      const cAv = document.createElement("div");
      cAv.className = "rbx-friend-card-avatar";
      const cImg = document.createElement("img");
      cImg.src = f.avatar || makeAvatarPlaceholder(displayName);
      cImg.alt = displayName;
      cAv.appendChild(cImg);

      const dot = document.createElement("div");
      dot.className =
        "rbx-presence-dot " +
        (f.presenceType === 2 ? "rbx-presence-ingame" : f.presenceType === 1 ? "rbx-presence-online" : "rbx-presence-offline");
      if (f.presenceType === 2) dot.innerHTML = SVG_PLAY_MINI;
      cAv.appendChild(dot);

      const cInfo = document.createElement("div");
      cInfo.className = "rbx-friend-card-info";

      const cTitle = document.createElement("div");
      cTitle.className = "rbx-friend-card-title";
      cTitle.textContent = displayName;

      const cHandle = document.createElement("div");
      cHandle.className = "rbx-friend-card-handle";
      cHandle.textContent = "@" + username;

      const cStat = document.createElement("div");
      cStat.className = "rbx-friend-card-status";
      cStat.style.color = f.presenceType === 2 ? "var(--tn-fg-bright)" : f.presenceType === 1 ? "var(--tn-online)" : "var(--tn-fg-muted)";
      cStat.textContent =
        f.presenceType === 2
          ? stripEmojis(f.lastLocation || "In-Experience")
          : f.presenceType === 1
          ? "Online"
          : "Offline";

      cInfo.appendChild(cTitle);
      cInfo.appendChild(cHandle);
      cInfo.appendChild(cStat);

      card.appendChild(cAv);
      card.appendChild(cInfo);

      if (f.placeId) {
        const joinBtn = document.createElement("button");
        joinBtn.className = "rbx-friend-join-btn";
        joinBtn.textContent = "Join";
        joinBtn.addEventListener("click", () =>
          launchExperience({
            placeId: String(f.placeId),
            name: stripEmojis(f.lastLocation || `Place ${f.placeId}`),
          })
        );
        card.appendChild(joinBtn);
      }

      grid.appendChild(card);
    }
  }

  // -------------------------------------------------------------------------
  // 5. Experience Detail Page
  // -------------------------------------------------------------------------
  function populateDetailDOM(game) {
    const cleanName = stripEmojis(game.name || `Place ${game.placeId}`);
    document.getElementById("detail-banner-img").src =
      game.banner || game.thumb || makeFallbackThumb(cleanName, game.placeId, true);
    document.getElementById("detail-icon-sm").src =
      game.thumb || makeFallbackThumb(cleanName, game.placeId, false);
    document.getElementById("detail-title").textContent = cleanName;
    document.getElementById("detail-creator").textContent = stripEmojis(game.creator || "Roblox");
    document.getElementById("detail-desc").textContent =
      stripEmojis(game.description) ||
      `Welcome to ${cleanName}.\n\nClick the Play button above to join this experience directly.`;

    const activeText = formatCount(game.playing || 0);
    const visitsText = game.visits ? formatCount(game.visits) : "—";
    const ratingText = game.rating || "90%";
    const genreText = game.genre || "All";
    const maxPText = String(game.maxPlayers || 50);

    document.getElementById("detail-stat-active").textContent = activeText;
    document.getElementById("detail-stat-favs").textContent = game.favoritedCount ? formatCount(game.favoritedCount) : "—";
    document.getElementById("detail-stat-visits").textContent = visitsText;
    document.getElementById("detail-stat-created").textContent = formatDate(game.created);
    document.getElementById("detail-stat-updated").textContent = formatDate(game.updated);
    document.getElementById("detail-stat-maxplayers").textContent = maxPText;
    document.getElementById("detail-stat-genre").textContent = genreText;

    const heroPlaying = document.getElementById("detail-hero-playing");
    const heroRating = document.getElementById("detail-hero-rating");
    const heroVisits = document.getElementById("detail-hero-visits");
    const heroGenre = document.getElementById("detail-hero-genre");
    const heroServer = document.getElementById("detail-hero-server");

    if (heroPlaying) heroPlaying.textContent = activeText;
    if (heroRating) heroRating.textContent = ratingText;
    if (heroVisits) heroVisits.textContent = visitsText;
    if (heroGenre) heroGenre.textContent = `Genre: ${genreText}`;
    if (heroServer) heroServer.textContent = `Server: ${maxPText} Max`;
  }

  async function openExperienceDetail(gameInput) {
    const known =
      (gameInput.placeId && knownGamesByPlace.get(String(gameInput.placeId))) ||
      (gameInput.universeId && knownGamesByUniverse.get(Number(gameInput.universeId)));
    const game = Object.assign({}, known || {}, gameInput);
    activeDetailGame = game;

    populateDetailDOM(game);

    const recRow = document.getElementById("detail-recommended-row");
    recRow.innerHTML = "";
    const recSource = homeRecommendedGames.length ? homeRecommendedGames : chartsTrendingGames;
    const recs = recSource.filter((c) => String(c.placeId) !== String(game.placeId)).slice(0, 7);
    for (const r of recs) {
      recRow.appendChild(createSquareTile(r));
    }

    showView("detail");

    const auth = window.auth;
    if (auth && (!game.visits || !game.banner || !game.placeId)) {
      try {
        let uid = game.universeId || null;
        const pid = game.placeId || null;
        if (!uid && pid) {
          const uRes = await auth.fetchJson(`https://apis.roblox.com/universes/v1/places/${pid}/universe`);
          uid = uRes && uRes.universeId;
        }
        if (uid) {
          const [gRes, iconRes, banRes, voteRes] = await Promise.all([
            auth.fetchJson(`https://games.roblox.com/v1/games?universeIds=${uid}`),
            auth.fetchJson(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${uid}&returnPolicy=PlaceHolder&size=256x256&format=Png&isCircular=false`),
            auth.fetchJson(`https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${uid}&countPerUniverse=1&defaults=true&size=768x432&format=Png&isCircular=false`),
            auth.fetchJson(`https://games.roblox.com/v1/games/votes?universeIds=${uid}`),
          ]);
          game.universeId = uid;
          const g = gRes && gRes.data && gRes.data[0];
          if (g) {
            if (g.rootPlaceId) game.placeId = String(g.rootPlaceId);
            if (g.name) game.name = stripEmojis(g.name);
            if (typeof g.playing === "number") game.playing = g.playing;
            if (g.creator && g.creator.name) game.creator = g.creator.name;
            if (g.description) game.description = g.description;
            if (g.maxPlayers) game.maxPlayers = g.maxPlayers;
            if (typeof g.favoritedCount === "number") game.favoritedCount = g.favoritedCount;
            if (typeof g.visits === "number") game.visits = g.visits;
            if (g.created) game.created = g.created;
            if (g.updated) game.updated = g.updated;
            if (g.genre) game.genre = g.genre;
          }
          const ic = iconRes && iconRes.data && iconRes.data[0] && iconRes.data[0].imageUrl;
          if (ic) game.thumb = ic;
          const bn =
            banRes &&
            banRes.data &&
            banRes.data[0] &&
            banRes.data[0].thumbnails &&
            banRes.data[0].thumbnails[0] &&
            banRes.data[0].thumbnails[0].imageUrl;
          if (bn) game.banner = bn;
          const vt = voteRes && voteRes.data && voteRes.data[0];
          if (vt && (vt.upVotes + vt.downVotes) > 0) {
            game.rating = Math.round((vt.upVotes / (vt.upVotes + vt.downVotes)) * 100) + "%";
          }
          registerGame(game);
          if (activeDetailGame && (String(activeDetailGame.placeId) === String(game.placeId) || Number(activeDetailGame.universeId) === Number(game.universeId))) {
            populateDetailDOM(game);
          }
        }
      } catch (e) {}
    }
  }

  document.getElementById("detail-play-btn").addEventListener("click", () => {
    if (activeDetailGame) launchExperience(activeDetailGame);
  });

  // -------------------------------------------------------------------------
  // 6. Progressive Account Loader (Home Updates First, Charts Second)
  // -------------------------------------------------------------------------
  async function loadUserAndFriendsData(auth, who) {
    if (!who) return;
    const myDisplay = who.displayName || who.name || "Player";
    topUsername.textContent = myDisplay;
    sideUsername.textContent = myDisplay;
    if (!currentMyAvatar) {
      currentMyAvatar = makeAvatarPlaceholder(myDisplay);
      topAvatar.src = currentMyAvatar;
      sideAvatar.src = currentMyAvatar;
    }
    topUser.style.display = "flex";
    loginSwitchBtn.style.display = "none";
    signupSwitchBtn.style.display = "none";

    try {
      const myId = Number(who.id);
      const [myAvRes, fRes] = await Promise.all([
        auth.fetchJson(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${myId}&size=150x150&format=Png&isCircular=true`),
        auth.fetchJson(`https://friends.roblox.com/v1/users/${myId}/friends`),
      ]);
      const myAvatar = (myAvRes && myAvRes.data && myAvRes.data[0] && myAvRes.data[0].imageUrl) || "";
      const list = fRes && Array.isArray(fRes.data) ? fRes.data : [];

      if (myAvatar) {
        currentMyAvatar = myAvatar;
        topAvatar.src = myAvatar;
        sideAvatar.src = myAvatar;
      }

      if (!list.length) {
        userFriends = [];
        renderFriends(userFriends);
        saveSessionCache();
        return;
      }

      const ids = list.map((u) => Number(u.id)).filter(Boolean);
      const chunk = (arr, n) => {
        const o = [];
        for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n));
        return o;
      };
      const c100 = chunk(ids, 100);
      const c50 = chunk(ids, 50);

      const userMap = {};
      const avMap = {};
      const presMap = {};

      await Promise.all([
        Promise.all(
          c100.map((ch) =>
            auth
              .postJson("https://users.roblox.com/v1/users", { userIds: ch, excludeBannedUsers: false })
              .then((res) => {
                if (res && Array.isArray(res.data)) for (const u of res.data) userMap[u.id] = u;
              })
              .catch(() => {})
          )
        ),
        Promise.all(
          c100.map((ch) =>
            auth
              .fetchJson(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${ch.join(",")}&size=150x150&format=Png&isCircular=true`)
              .then((res) => {
                if (res && Array.isArray(res.data)) for (const d of res.data) if (d.imageUrl) avMap[d.targetId] = d.imageUrl;
              })
              .catch(() => {})
          )
        ),
        Promise.all(
          c50.map((ch) =>
            auth
              .postJson("https://presence.roblox.com/v1/presence/users", { userIds: ch })
              .then((res) => {
                if (res && Array.isArray(res.userPresences)) for (const p of res.userPresences) presMap[p.userId] = p;
              })
              .catch(() => {})
          )
        ),
      ]);

      userFriends = list.map((raw) => {
        const uid = Number(raw.id);
        const prof = userMap[uid] || {};
        const p = presMap[uid] || {};
        const name = prof.name || raw.name || "User" + uid;
        const displayName = prof.displayName || raw.displayName || name;
        return {
          id: uid,
          name,
          displayName,
          avatar: avMap[uid] || "",
          presenceType: p.userPresenceType || 0,
          lastLocation: p.lastLocation || "",
          placeId: p.rootPlaceId || p.placeId || null,
          universeId: p.universeId || null,
        };
      });

      userFriends.sort((a, b) => {
        if (b.presenceType !== a.presenceType) return b.presenceType - a.presenceType;
        return String(a.displayName).localeCompare(String(b.displayName));
      });
      renderFriends(userFriends);
      saveSessionCache();
    } catch (e) {
      console.warn("[app] friends load error:", e);
    }
  }

  async function loadAccountExperiencesFromRoblox(auth, who) {
    try {
      const userId = who && who.id ? Number(who.id) : 0;
      const sid = crypto.randomUUID();

      const [omniRes, exploreRes, favRes] = await Promise.all([
        auth.postJson("https://apis.roblox.com/discovery-api/omni-recommendation", {
          pageType: "Home",
          sessionId: sid,
          supportedTreatmentTypes: ["SortlessGrid"],
        }),
        auth.fetchJson(`https://apis.roblox.com/explore-api/v1/get-sorts?sessionId=${sid}`),
        userId
          ? auth.fetchJson(`https://games.roblox.com/v2/users/${userId}/favorite/games?accessFilter=2&limit=14&sortOrder=Desc`)
          : Promise.resolve(null),
      ]);

      const gameMeta = (omniRes && omniRes.contentMetadata && omniRes.contentMetadata.Game) || {};
      const omniSorts = omniRes && Array.isArray(omniRes.sorts) ? omniRes.sorts : [];

      const extractOmniUids = (sort) => {
        if (!sort) return [];
        const list = sort.recommendationList || sort.games || [];
        return list
          .filter((x) => !x.contentType || x.contentType === "Game")
          .map((x) => Number(x.contentId || x.universeId || x.id))
          .filter(Boolean);
      };

      let continueUids = [];
      let recommendedUids = [];
      let favoritesUids = [];

      for (const s of omniSorts) {
        const topic = String(s.topic || s.sortDisplayName || "").toLowerCase();
        const tid = Number(s.topicId);
        const uids = extractOmniUids(s);
        if (!uids.length) continue;

        if (!continueUids.length && (tid === 100000003 || topic.includes("continue"))) {
          continueUids = uids.slice(0, 28);
        } else if (!favoritesUids.length && (tid === 100000001 || topic.includes("favorite"))) {
          favoritesUids = uids.slice(0, 28);
        } else if (!recommendedUids.length && (tid === 100000000 || s.treatmentType === "SortlessGrid" || topic.includes("recommend"))) {
          recommendedUids = uids.slice(0, 12);
        }
      }

      if (!recommendedUids.length) {
        for (const s of omniSorts) {
          const uids = extractOmniUids(s);
          if (uids.length >= 6 && uids[0] !== continueUids[0]) {
            recommendedUids = uids.slice(0, 12);
            break;
          }
        }
      }

      if (favRes && Array.isArray(favRes.data) && favRes.data.length) {
        favoritesUids = favRes.data.map((f) => Number(f.id)).filter(Boolean).slice(0, 14);
      }

      const exSorts = exploreRes && Array.isArray(exploreRes.sorts) ? exploreRes.sorts : [];
      const findExSort = (idSub) => {
        const found = exSorts.find(
          (s) => String(s.sortId || "").toLowerCase().includes(idSub) && Array.isArray(s.games) && s.games.length
        );
        return found ? found.games.slice(0, 14) : [];
      };

      const trendingRaw = findExSort("trending");
      const playingNowRaw = findExSort("playing-now");
      const upAndComingRaw = findExSort("up-and-coming");

      if (!continueUids.length && trendingRaw.length) {
        continueUids = trendingRaw.slice(0, 7).map((g) => Number(g.universeId));
      }
      if (!recommendedUids.length && playingNowRaw.length) {
        recommendedUids = playingNowRaw.slice(0, 8).map((g) => Number(g.universeId));
      }
      if (!favoritesUids.length && upAndComingRaw.length) {
        favoritesUids = upAndComingRaw.slice(0, 14).map((g) => Number(g.universeId));
      }

      const allUids = Array.from(
        new Set(
          [
            ...continueUids,
            ...recommendedUids,
            ...favoritesUids,
            ...trendingRaw.map((g) => Number(g.universeId)),
            ...playingNowRaw.map((g) => Number(g.universeId)),
            ...upAndComingRaw.map((g) => Number(g.universeId)),
          ].filter(Boolean)
        )
      );

      if (!allUids.length) return;

      const chunk = (arr, n) => {
        const o = [];
        for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n));
        return o;
      };
      const uidChunks50 = chunk(allUids, 50);
      const bannerUids = Array.from(new Set([...continueUids, ...recommendedUids])).slice(0, 25);

      const iconsMap = {};
      const bannersMap = {};
      const detailsMap = {};
      const votesMap = {};

      await Promise.all([
        Promise.all(
          uidChunks50.map((ch) =>
            auth
              .fetchJson(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${ch.join(",")}&returnPolicy=PlaceHolder&size=256x256&format=Png&isCircular=false`)
              .then((res) => {
                if (res && Array.isArray(res.data)) for (const d of res.data) if (d.imageUrl) iconsMap[d.targetId] = d.imageUrl;
              })
              .catch(() => {})
          )
        ),
        bannerUids.length
          ? auth
              .fetchJson(`https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${bannerUids.join(",")}&countPerUniverse=1&defaults=true&size=768x432&format=Png&isCircular=false`)
              .then((res) => {
                if (res && Array.isArray(res.data)) {
                  for (const b of res.data) {
                    const img = b.thumbnails && b.thumbnails[0] && b.thumbnails[0].imageUrl;
                    if (img) bannersMap[b.universeId] = img;
                  }
                }
              })
              .catch(() => {})
          : Promise.resolve(),
        Promise.all(
          uidChunks50.map((ch) =>
            auth
              .fetchJson(`https://games.roblox.com/v1/games?universeIds=${ch.join(",")}`)
              .then((res) => {
                if (res && Array.isArray(res.data)) for (const g of res.data) detailsMap[g.id] = g;
              })
              .catch(() => {})
          )
        ),
        Promise.all(
          uidChunks50.map((ch) =>
            auth
              .fetchJson(`https://games.roblox.com/v1/games/votes?universeIds=${ch.join(",")}`)
              .then((res) => {
                if (res && Array.isArray(res.data)) for (const v of res.data) votesMap[v.id] = v;
              })
              .catch(() => {})
          )
        ),
      ]);

      const buildGame = (uid, fallbackObj) => {
        const d = detailsMap[uid] || {};
        const m = gameMeta[String(uid)] || gameMeta[uid] || fallbackObj || {};
        const v = votesMap[uid];
        const up = Number(v ? v.upVotes : m.totalUpVotes ?? 0) || 0;
        const down = Number(v ? v.downVotes : m.totalDownVotes ?? 0) || 0;
        const rating = up + down > 0 ? Math.round((up / (up + down)) * 100) + "%" : "90%";
        const placeId = d.rootPlaceId || m.rootPlaceId || m.placeId;
        if (!placeId) return null;
        return {
          universeId: Number(uid),
          placeId: String(placeId),
          name: d.name || m.name || "Experience",
          creator: (d.creator && d.creator.name) || m.creatorName || "Roblox",
          playing: typeof d.playing === "number" ? d.playing : Number(m.playerCount) || 0,
          rating,
          thumb: iconsMap[uid] || "",
          banner: bannersMap[uid] || iconsMap[uid] || "",
          description: d.description || "",
          maxPlayers: d.maxPlayers || 50,
          favoritedCount: d.favoritedCount || 0,
          visits: d.visits || 0,
          created: d.created || "",
          updated: d.updated || "",
          genre: d.genre || m.genreL1 || "All",
        };
      };

      homeContinueGames = continueUids.map((u) => buildGame(u)).filter(Boolean).slice(0, 28).map(registerGame);
      homeRecommendedGames = recommendedUids.map((u) => buildGame(u)).filter(Boolean).slice(0, 8).map(registerGame);
      homeFavoritesGames = favoritesUids.map((u) => buildGame(u)).filter(Boolean).slice(0, 28).map(registerGame);
      chartsTrendingGames = trendingRaw.map((g) => buildGame(Number(g.universeId), g)).filter(Boolean).map(registerGame);
      chartsPlayingNowGames = playingNowRaw.map((g) => buildGame(Number(g.universeId), g)).filter(Boolean).map(registerGame);
      chartsUpAndComingGames = upAndComingRaw.map((g) => buildGame(Number(g.universeId), g)).filter(Boolean).map(registerGame);

      renderHomeAndCharts();
      saveSessionCache();
    } catch (e) {
      console.warn("[app] account experience load error:", e);
    } finally {
      startEnginePreload();
    }
  }

  // -------------------------------------------------------------------------
  // 7. Search Bar (Dedicated Search Page + Place ID / URL Join)
  // -------------------------------------------------------------------------
  async function runSearch(auth) {
    const raw = (searchInput.value || "").trim();
    searchClear.style.display = raw ? "block" : "none";
    if (!raw) {
      showView("home");
      return;
    }

    const urlMatch = raw.match(/roblox\.com\/(?:[a-z]{2}\/)?games\/(\d+)/i);
    if (urlMatch) {
      return openExperienceDetail({ placeId: urlMatch[1], name: `Place ${urlMatch[1]}` });
    }
    if (/^\d{4,20}$/.test(raw)) {
      return openExperienceDetail({ placeId: raw, name: `Place ${raw}` });
    }

    showView("search");
    const searchHeading = document.getElementById("search-page-title");
    const searchRow = document.getElementById("search-results-row");
    if (searchHeading) searchHeading.textContent = `Results for "${raw}"`;
    if (searchRow) searchRow.innerHTML = "";

    if (!auth) return;
    try {
      const sessionId = crypto.randomUUID();
      const sRes = await auth.fetchJson(
        `https://apis.roblox.com/search-api/omni-search?searchQuery=${encodeURIComponent(raw)}&pageToken=&sessionId=${sessionId}&pageType=all`
      );
      const contents = [];
      if (sRes && Array.isArray(sRes.searchResults)) {
        for (const grp of sRes.searchResults) {
          if (Array.isArray(grp.contents)) {
            for (const c of grp.contents) {
              if (c.rootPlaceId) contents.push(c);
            }
          }
        }
      }
      if (!contents.length) return;

      const items = contents.slice(0, 24).map((c) => {
        const up = Number(c.totalUpVotes) || 0;
        const down = Number(c.totalDownVotes) || 0;
        const pct = up + down > 0 ? Math.round((up / (up + down)) * 100) + "%" : "90%";
        return registerGame({
          placeId: String(c.rootPlaceId),
          universeId: c.universeId,
          name: stripEmojis(c.name || "Experience"),
          creator: stripEmojis(c.creatorName || "Roblox"),
          playing: c.playerCount || 0,
          rating: pct,
          description: c.description || "",
        });
      });

      const uids = items.map((i) => i.universeId).filter(Boolean);
      if (uids.length) {
        const iconRes = await auth.fetchJson(
          `https://thumbnails.roblox.com/v1/games/icons?universeIds=${uids.join(",")}&returnPolicy=PlaceHolder&size=256x256&format=Png&isCircular=false`
        );
        if (iconRes && Array.isArray(iconRes.data)) {
          const iconMap = new Map(iconRes.data.map((d) => [Number(d.targetId), d.imageUrl]));
          for (const it of items) {
            const u = iconMap.get(Number(it.universeId));
            if (u) it.thumb = u;
          }
        }
      }

      if (searchRow) {
        searchRow.innerHTML = "";
        for (const it of items) searchRow.appendChild(createSquareTile(it));
      }
    } catch (e) {}
  }

  // -------------------------------------------------------------------------
  // 8. Instant Game Launch (Starts WasmPlayer.js Immediately at 0ms in Parallel with Join)
  // -------------------------------------------------------------------------
  async function launchExperience(gameInput) {
    if (isLaunching) return;
    const placeId = String(typeof gameInput === "object" ? gameInput.placeId : gameInput).trim();
    if (!placeId) return;
    isLaunching = true;

    const auth = window.auth;
    if (typeof gameInput === "object" && gameInput.placeId) {
      homeContinueGames = [
        gameInput,
        ...homeContinueGames.filter((g) => String(g.placeId) !== String(gameInput.placeId)),
      ].slice(0, 28);
      saveSessionCache();
    }

    // 1. Show the Roblox canvas immediately at 0ms
    if (auth) auth.visible(false);
    shell.style.display = "none";

    window.__placeId = placeId;
    try {
      history.replaceState(null, "", "?placeId=" + placeId);
    } catch (e) {}

    // 2. Start auth.join + UDP socket in parallel so WasmPlayer.js does NOT wait for it
    startEnginePreload();
    auth.pendingJoinPromise = (async () => {
      const join = await auth.join(placeId);
      window.__join = join;
      const peer = join.udmux || (join.connections && join.connections[0]);
      if (!peer) throw new Error("join script has no endpoint");
      await __rkRing.start({ host: peer.Address, port: peer.Port, script: join.script });
      return join;
    })();

    auth.pendingJoinPromise.catch((e) => {
      console.error("[app] launch failed:", e);
      isLaunching = false;
      shell.style.display = "flex";
      alert("Unable to join experience: " + (e && e.message ? e.message : e));
    });

    // 3. Boot WasmPlayer.js immediately at 0ms
    const s = document.createElement("script");
    s.src = "/engine/WasmPlayer.js";
    s.onerror = () => {
      isLaunching = false;
      shell.style.display = "flex";
    };
    document.body.appendChild(s);
  }

  // -------------------------------------------------------------------------
  // 9. Boot & Login / Switch Account Flow
  // -------------------------------------------------------------------------
  async function requireAuthSession(auth, forceLoginScreen = false) {
    const topbar = document.getElementById("rbx-topbar");
    if (forceLoginScreen) {
      localStorage.removeItem("weblox_user_logged_in");
      localStorage.removeItem(CACHE_KEY);
      topUser.style.display = "none";
      loginSwitchBtn.style.display = "none";
      signupSwitchBtn.style.display = "none";
      if (topbar) topbar.style.display = "none";
      bodyWrap.style.display = "none";
      await auth.logout();
    } else {
      const existing = await auth.whoami().catch(() => null);
      if (existing) {
        window.__whoami = existing;
        localStorage.setItem("weblox_user_logged_in", "1");
        if (topbar) topbar.style.display = "grid";
        bodyWrap.style.display = "flex";
        loadUserAndFriendsData(auth, existing);
        return existing;
      }
      localStorage.removeItem("weblox_user_logged_in");
    }

    topUser.style.display = "none";
    loginSwitchBtn.style.display = "none";
    signupSwitchBtn.style.display = "none";
    if (topbar) topbar.style.display = "none";
    bodyWrap.style.display = "none";

    const who = await auth.interactiveLogin(30 * 60 * 1000, 0);
    window.__whoami = who;
    localStorage.setItem("weblox_user_logged_in", "1");
    if (topbar) topbar.style.display = "grid";
    bodyWrap.style.display = "flex";
    loadUserAndFriendsData(auth, who);
    return who;
  }

  async function main() {
    // 1. Render UI at 0ms if a cached logged-in session exists; otherwise hide topbar & body until logged in
    const topbar = document.getElementById("rbx-topbar");
    const hasCachedSession = restoreSessionCache() || localStorage.getItem("weblox_user_logged_in") === "1";
    renderFriends(userFriends);
    renderHomeAndCharts();
    if (!hasCachedSession) {
      if (topbar) topbar.style.display = "none";
      bodyWrap.style.display = "none";
    }

    const auth = new RobloxAuth();
    self.__rbxAuth = auth;
    window.auth = auth;

    // Navigation
    const brandHome = document.getElementById("rbx-brand-home");
    if (brandHome) brandHome.addEventListener("click", () => showView("home"));
    document.getElementById("home-friends-seeall").addEventListener("click", () => showView("friends"));
    const contSeeAll = document.getElementById("home-continue-seeall");
    if (contSeeAll) {
      contSeeAll.addEventListener("click", () => openCollectionView("Continue", homeContinueGames));
    }
    const favSeeAll = document.getElementById("home-favorites-seeall");
    if (favSeeAll) {
      favSeeAll.addEventListener("click", () => openCollectionView("Favorites", homeFavoritesGames));
    }
    const colBack = document.getElementById("collection-back-btn");
    if (colBack) colBack.addEventListener("click", () => showView("home"));
    const searchBack = document.getElementById("search-back-btn");
    if (searchBack) searchBack.addEventListener("click", () => showView("home"));
    document.querySelectorAll("[data-goto]").forEach((btn) => {
      btn.addEventListener("click", () => showView(btn.dataset.goto));
    });

    document.querySelectorAll(".rbx-side-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const s = btn.dataset.side;
        if (s === "home" || s === "friends" || s === "charts") {
          showView(s);
        }
      });
    });

    // Settings Menu & Theme Picker & Switch Account
    settingsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      settingsMenu.style.display = settingsMenu.style.display === "flex" ? "none" : "flex";
    });
    addEventListener("click", () => {
      settingsMenu.style.display = "none";
    });
    document.querySelectorAll("[data-theme-pick]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        applyTheme(btn.dataset.themePick);
        settingsMenu.style.display = "none";
      });
    });
    document.getElementById("menu-switch-account").addEventListener("click", async () => {
      settingsMenu.style.display = "none";
      currentMyAvatar = "";
      userFriends = [];
      const who = await requireAuthSession(auth, true);
      showView("home");
      loadAccountExperiencesFromRoblox(auth, who);
    });

    // Friends page subtabs & live search
    document.querySelectorAll("#friends-filter-tabs .rbx-subtab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll("#friends-filter-tabs .rbx-subtab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        activeFriendFilter = tab.dataset.ffilter || "all";
        renderFriendsPageGrid();
      });
    });
    const friendSearchInput = document.getElementById("friends-search-input");
    if (friendSearchInput) {
      friendSearchInput.addEventListener("input", () => {
        activeFriendQuery = friendSearchInput.value || "";
        renderFriendsPageGrid();
      });
    }

    // Search Input
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") runSearch(auth);
    });
    searchInput.addEventListener("input", () => {
      searchClear.style.display = searchInput.value ? "block" : "none";
    });
    searchClear.addEventListener("click", () => {
      searchInput.value = "";
      searchClear.style.display = "none";
      if (viewSearch && viewSearch.style.display !== "none") {
        showView("home");
      }
    });

    // Detail Page Back Button
    const detailBackBtn = document.getElementById("detail-back-btn");
    if (detailBackBtn) {
      detailBackBtn.addEventListener("click", () => {
        showView(lastActiveView || "home");
      });
    }

    // Keyboard shortcut '/' to search
    window.addEventListener("keydown", (e) => {
      if (e.key === "/" && document.activeElement !== searchInput && !e.target.matches("input, textarea")) {
        e.preventDefault();
        searchInput.focus();
      }
    });

    // Login / Sign Up Switchers (when on Login screen)
    loginSwitchBtn.addEventListener("click", () => {
      auth.navigate("https://www.roblox.com/login");
      auth.visible(true, 0);
    });
    signupSwitchBtn.addEventListener("click", () => {
      auth.navigate("https://www.roblox.com/CreateAccount");
      auth.visible(true, 0);
    });

    // Fast Boot Auth Frame (~100ms because <controlledframe> is no longer display:none)
    await auth.start();
    let cfg = {};
    try {
      cfg = await fetch("/config.json").then((r) => r.json());
    } catch (e) {}

    let who = null;
    if (cfg && cfg.cookie) {
      try {
        who = await auth.injectCookie(cfg.cookie);
        window.__whoami = who;
        localStorage.setItem("weblox_user_logged_in", "1");
        if (topbar) topbar.style.display = "grid";
        bodyWrap.style.display = "flex";
        loadUserAndFriendsData(auth, who);
      } catch (e) {}
    }
    if (!who) {
      who = await requireAuthSession(auth, false);
    }
    window.__whoami = who;

    const params = new URLSearchParams(location.search);
    const directPlace = params.get("placeId") || params.get("place") || (cfg && cfg.placeId);
    if (directPlace) {
      return launchExperience({ placeId: directPlace, name: `Place ${directPlace}` });
    }

    loadAccountExperiencesFromRoblox(auth, who);
  }

  main().catch((e) => console.error("[app] fatal:", e));
})();
