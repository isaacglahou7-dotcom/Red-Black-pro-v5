// ============================================================
// RED BLACK PRO V5
// server.cjs
// Predictor / Analytics only
// No automated betting
// No hardcoded SportyBet credentials
// ============================================================

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;

const DATA_DIR = __dirname;
const HISTORY_FILE = path.join(DATA_DIR, "rb_history.json");
const PREDICTIONS_FILE = path.join(DATA_DIR, "rb_predictions.json");

const MAX_HISTORY = 5000;
const MAX_PREDICTIONS = 2000;

// ------------------------------------------------------------
// FILE HELPERS
// ------------------------------------------------------------

function loadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
      return fallback;
    }

    const raw = fs.readFileSync(file, "utf8");

    if (!raw.trim()) return fallback;

    return JSON.parse(raw);
  } catch (error) {
    console.error("JSON read error:", file, error.message);
    return fallback;
  }
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let history = loadJson(HISTORY_FILE, []);
let predictions = loadJson(PREDICTIONS_FILE, []);

// ------------------------------------------------------------
// NORMALIZATION
// ------------------------------------------------------------

function normalizeOutcome(value) {
  if (value === null || value === undefined) return null;

  const text = String(value).trim().toUpperCase();

  if (
    text === "RED" ||
    text === "R" ||
    text.includes("🔴") ||
    text.includes("RED")
  ) {
    return "RED";
  }

  if (
    text === "BLACK" ||
    text === "B" ||
    text.includes("⚫") ||
    text.includes("BLACK")
  ) {
    return "BLACK";
  }

  if (
    text === "GREEN" ||
    text === "G" ||
    text.includes("🟢") ||
    text.includes("GREEN")
  ) {
    return "GREEN";
  }

  return null;
}

// ------------------------------------------------------------
// BASIC STATISTICS
// ------------------------------------------------------------

function countOutcomes(data) {
  const counts = {
    RED: 0,
    BLACK: 0,
    GREEN: 0
  };

  for (const item of data) {
    const outcome = normalizeOutcome(
      typeof item === "string" ? item : item.outcome
    );

    if (outcome) counts[outcome]++;
  }

  return counts;
}

function probabilitiesFromCounts(counts) {
  const total = counts.RED + counts.BLACK + counts.GREEN;

  if (!total) {
    return {
      RED: 1 / 3,
      BLACK: 1 / 3,
      GREEN: 1 / 3
    };
  }

  return {
    RED: counts.RED / total,
    BLACK: counts.BLACK / total,
    GREEN: counts.GREEN / total
  };
}

// ------------------------------------------------------------
// RECENT WEIGHTED PROBABILITY
// ------------------------------------------------------------

function recencyProbability(data, windowSize = 30) {
  const recent = data.slice(-windowSize);
  const counts = {
    RED: 1,
    BLACK: 1,
    GREEN: 1
  };

  for (const item of recent) {
    const outcome = normalizeOutcome(
      typeof item === "string" ? item : item.outcome
    );

    if (outcome) counts[outcome]++;
  }

  return probabilitiesFromCounts(counts);
}

// ------------------------------------------------------------
// MARKOV MODEL
// ------------------------------------------------------------

function markovProbability(data) {
  const states = ["RED", "BLACK", "GREEN"];

  const matrix = {
    RED: { RED: 1, BLACK: 1, GREEN: 1 },
    BLACK: { RED: 1, BLACK: 1, GREEN: 1 },
    GREEN: { RED: 1, BLACK: 1, GREEN: 1 }
  };

  for (let i = 1; i < data.length; i++) {
    const previous = normalizeOutcome(
      typeof data[i - 1] === "string" ? data[i - 1] : data[i - 1].outcome
    );

    const current = normalizeOutcome(
      typeof data[i] === "string" ? data[i] : data[i].outcome
    );

    if (
      previous &&
      current &&
      matrix[previous] &&
      matrix[previous][current] !== undefined
    ) {
      matrix[previous][current]++;
    }
  }

  const lastItem = data[data.length - 1];

  if (!lastItem) {
    return {
      RED: 1 / 3,
      BLACK: 1 / 3,
      GREEN: 1 / 3
    };
  }

  const last = normalizeOutcome(
    typeof lastItem === "string" ? lastItem : lastItem.outcome
  );

  if (!last || !matrix[last]) {
    return {
      RED: 1 / 3,
      BLACK: 1 / 3,
      GREEN: 1 / 3
    };
  }

  const row = matrix[last];

  return probabilitiesFromCounts(row);
}

// ------------------------------------------------------------
// STREAK ANALYSIS
// ------------------------------------------------------------

function getStreak(data) {
  if (!data.length) {
    return {
      outcome: null,
      length: 0
    };
  }

  const last = normalizeOutcome(
    typeof data[data.length - 1] === "string"
      ? data[data.length - 1]
      : data[data.length - 1].outcome
  );

  let length = 0;

  for (let i = data.length - 1; i >= 0; i--) {
    const value = normalizeOutcome(
      typeof data[i] === "string" ? data[i] : data[i].outcome
    );

    if (value === last) {
      length++;
    } else {
      break;
    }
  }

  return {
    outcome: last,
    length
  };
}

// ------------------------------------------------------------
// STREAK ADJUSTMENT
// ------------------------------------------------------------

function applyStreakAdjustment(probabilities, data) {
  const result = { ...probabilities };
  const streak = getStreak(data);

  if (!streak.outcome || streak.length < 3) {
    return result;
  }

  // Small correction only.
  // This does NOT assume that a streak must reverse.
  const bonus = Math.min(0.05, streak.length * 0.008);

  const otherStates = ["RED", "BLACK", "GREEN"].filter(
    x => x !== streak.outcome
  );

  result[streak.outcome] -= bonus;
  result[otherStates[0]] += bonus / 2;
  result[otherStates[1]] += bonus / 2;

  return normalizeProbabilities(result);
}

// ------------------------------------------------------------
// ENSEMBLE
// ------------------------------------------------------------

function normalizeProbabilities(p) {
  const total = p.RED + p.BLACK + p.GREEN;

  if (!total) {
    return {
      RED: 1 / 3,
      BLACK: 1 / 3,
      GREEN: 1 / 3
    };
  }

  return {
    RED: p.RED / total,
    BLACK: p.BLACK / total,
    GREEN: p.GREEN / total
  };
}

function ensembleProbability(data) {
  const markov = markovProbability(data);
  const recent = recencyProbability(data, 30);
  const global = probabilitiesFromCounts(countOutcomes(data));

  // Ensemble weights
  const result = {
    RED:
      markov.RED * 0.45 +
      recent.RED * 0.40 +
      global.RED * 0.15,

    BLACK:
      markov.BLACK * 0.45 +
      recent.BLACK * 0.40 +
      global.BLACK * 0.15,

    GREEN:
      markov.GREEN * 0.45 +
      recent.GREEN * 0.40 +
      global.GREEN * 0.15
  };

  return applyStreakAdjustment(
    normalizeProbabilities(result),
    data
  );
}

// ------------------------------------------------------------
// PREDICTION
// ------------------------------------------------------------

function calculatePrediction(data) {
  if (data.length < 5) {
    return {
      ready: false,
      message: "Pas assez de données",
      minimumRequired: 5,
      probabilities: {
        RED: 1 / 3,
        BLACK: 1 / 3,
        GREEN: 1 / 3
      }
    };
  }

  const probabilities = ensembleProbability(data);

  const ordered = Object.entries(probabilities)
    .sort((a, b) => b[1] - a[1]);

  const prediction = ordered[0][0];

  const confidence = ordered[0][1];

  let level = "LOW";

  if (confidence >= 0.60) {
    level = "HIGH";
  } else if (confidence >= 0.45) {
    level = "MEDIUM";
  }

  return {
    ready: true,
    prediction,
    confidence,
    level,
    probabilities,
    markov: markovProbability(data),
    recent: recencyProbability(data, 30),
    global: probabilitiesFromCounts(countOutcomes(data)),
    streak: getStreak(data),
    generatedAt: new Date().toISOString()
  };
}

// ------------------------------------------------------------
// RECORD OUTCOME
// ------------------------------------------------------------

function addOutcome(outcome, source = "manual") {
  const normalized = normalizeOutcome(outcome);

  if (!normalized) {
    throw new Error("Outcome invalide. Utilise RED, BLACK ou GREEN.");
  }

  const now = Date.now();

  const last = history[history.length - 1];

  // Protection contre les doubles insertions extrêmement rapprochées.
  if (last) {
    const lastTime = new Date(last.timestamp).getTime();

    if (
      last.outcome === normalized &&
      now - lastTime < 2500
    ) {
      return {
        added: false,
        duplicate: true,
        item: last
      };
    }
  }

  const item = {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    outcome: normalized,
    timestamp: new Date().toISOString(),
    source
  };

  history.push(item);

  if (history.length > MAX_HISTORY) {
    history = history.slice(-MAX_HISTORY);
  }

  saveJson(HISTORY_FILE, history);

  return {
    added: true,
    duplicate: false,
    item
  };
}

// ------------------------------------------------------------
// BACKTEST
// ------------------------------------------------------------

function runBacktest(data) {
  if (data.length < 20) {
    return {
      ready: false,
      message: "Il faut au moins 20 résultats pour le backtest.",
      samples: data.length
    };
  }

  let correct = 0;
  let total = 0;

  const confusion = {
    RED: { RED: 0, BLACK: 0, GREEN: 0 },
    BLACK: { RED: 0, BLACK: 0, GREEN: 0 },
    GREEN: { RED: 0, BLACK: 0, GREEN: 0 }
  };

  for (let i = 10; i < data.length; i++) {
    const training = data.slice(0, i);

    const actual = normalizeOutcome(
      typeof data[i] === "string" ? data[i] : data[i].outcome
    );

    const prediction = calculatePrediction(training);

    if (!prediction.ready || !actual) continue;

    const predicted = prediction.prediction;

    total++;

    if (predicted === actual) {
      correct++;
    }

    if (confusion[predicted]) {
      confusion[predicted][actual]++;
    }
  }

  const accuracy = total ? correct / total : 0;

  return {
    ready: true,
    samples: data.length,
    testedRounds: total,
    correct,
    incorrect: total - correct,
    accuracy,
    accuracyPercent: Number((accuracy * 100).toFixed(2)),
    confusion
  };
}

// ------------------------------------------------------------
// SAVE PREDICTION
// ------------------------------------------------------------

function savePrediction(prediction) {
  if (!prediction || !prediction.ready) return null;

  const record = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    prediction: prediction.prediction,
    confidence: prediction.confidence,
    level: prediction.level,
    probabilities: prediction.probabilities,
    timestamp: new Date().toISOString(),
    resolved: false,
    actual: null,
    correct: null
  };

  predictions.push(record);

  if (predictions.length > MAX_PREDICTIONS) {
    predictions = predictions.slice(-MAX_PREDICTIONS);
  }

  saveJson(PREDICTIONS_FILE, predictions);

  return record;
}

// ------------------------------------------------------------
// RESOLVE LAST PREDICTION
// ------------------------------------------------------------

function resolveLastPrediction(actual) {
  const normalized = normalizeOutcome(actual);

  if (!normalized) {
    throw new Error("Résultat invalide.");
  }

  for (let i = predictions.length - 1; i >= 0; i--) {
    if (!predictions[i].resolved) {
      predictions[i].actual = normalized;
      predictions[i].correct =
        predictions[i].prediction === normalized;
      predictions[i].resolved = true;

      saveJson(PREDICTIONS_FILE, predictions);

      return predictions[i];
    }
  }

  return null;
}

// ------------------------------------------------------------
// PREDICTION PERFORMANCE
// ------------------------------------------------------------

function predictionStats() {
  const resolved = predictions.filter(p => p.resolved);

  if (!resolved.length) {
    return {
      total: 0,
      correct: 0,
      incorrect: 0,
      accuracy: 0,
      accuracyPercent: 0
    };
  }

  const correct = resolved.filter(p => p.correct).length;

  return {
    total: resolved.length,
    correct,
    incorrect: resolved.length - correct,
    accuracy: correct / resolved.length,
    accuracyPercent: Number(
      ((correct / resolved.length) * 100).toFixed(2)
    )
  };
}

// ------------------------------------------------------------
// DASHBOARD DATA
// ------------------------------------------------------------

function dashboardData() {
  const prediction = calculatePrediction(history);

  return {
    app: "Red Black Pro V5",
    version: "5.0",
    status: "ONLINE",

    historyCount: history.length,

    counts: countOutcomes(history),

    prediction,

    backtest: runBacktest(history),

    predictionStats: predictionStats(),

    streak: getStreak(history),

    recentHistory: history.slice(-50).reverse(),

    recentPredictions: predictions
      .slice(-30)
      .reverse()
  };
}

// ------------------------------------------------------------
// HTTP HELPERS
// ------------------------------------------------------------

function sendJson(res, status, data) {
  const body = JSON.stringify(data);

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });

  res.end(body);
}

function sendText(res, status, text, contentType = "text/plain") {
  res.writeHead(status, {
    "Content-Type": `${contentType}; charset=utf-8`,
    "Access-Control-Allow-Origin": "*"
  });

  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", chunk => {
      body += chunk;

      if (body.length > 1_000_000) {
        reject(new Error("Request trop volumineuse."));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });

    req.on("error", reject);
  });
}

// ------------------------------------------------------------
// SPORTYBET COLLECTOR
// ------------------------------------------------------------
//
// IMPORTANT:
// This collector does NOT receive or store credentials.
// It opens the visible SportyBet page and expects the user
// to log in manually if required.
//
// Automated interaction with a third-party website may be
// restricted by that site's terms. Use only where permitted.
// ------------------------------------------------------------

let collector = {
  running: false,
  browser: null,
  page: null,
  lastRaw: "",
  lastOutcome: null,
  lastDetectedAt: null,
  message: "Collector arrêté"
};

async function startCollector() {
  if (collector.running) {
    return {
      running: true,
      message: "Collector déjà actif."
    };
  }

  let puppeteer;

  try {
    puppeteer = require("puppeteer");
  } catch {
    throw new Error(
      "Puppeteer n'est pas installé. Exécute npm install puppeteer."
    );
  }

  collector.message = "Ouverture de SportyBet...";

  const browser = await puppeteer.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage"
    ]
  });

  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();

  collector.browser = browser;
  collector.page = page;
  collector.running = true;

  await page.goto(
    "https://www.sportybet.com/gh/m/",
    {
      waitUntil: "domcontentloaded",
      timeout: 60000
    }
  );

  collector.message =
    "Connecte-toi manuellement puis ouvre Red Black.";

  monitorSportyBet(page);

  return {
    running: true,
    message: collector.message
  };
}

async function monitorSportyBet(page) {
  let previousText = "";

  while (collector.running) {
    try {
      const text = await page.evaluate(() => {
        return document.body
          ? document.body.innerText
          : "";
      });

      if (
        text &&
        text !== previousText
      ) {
        previousText = text;

        const upper = text.toUpperCase();

        let detected = null;

        if (
          /\bRED\b/.test(upper) &&
          !/\bBLACK\b/.test(upper)
        ) {
          detected = "RED";
        }

        if (
          /\bBLACK\b/.test(upper) &&
          !/\bRED\b/.test(upper)
        ) {
          detected = "BLACK";
        }

        if (
          /\bGREEN\b/.test(upper) &&
          !/\bRED\b/.test(upper) &&
          !/\bBLACK\b/.test(upper)
        ) {
          detected = "GREEN";
        }

        if (
          detected &&
          detected !== collector.lastOutcome
        ) {
          const result = addOutcome(
            detected,
            "sportybet-collector"
          );

          if (result.added) {
            collector.lastOutcome = detected;
            collector.lastDetectedAt =
              new Date().toISOString();

            collector.message =
              `Résultat détecté : ${detected}`;
          }
        }
      }
    } catch (error) {
      collector.message =
        `Erreur collector : ${error.message}`;
    }

    await new Promise(resolve =>
      setTimeout(resolve, 1500)
    );
  }
}

async function stopCollector() {
  collector.running = false;

  if (collector.browser) {
    try {
      await collector.browser.close();
    } catch {}
  }

  collector.browser = null;
  collector.page = null;

  collector.message = "Collector arrêté.";

  return {
    running: false,
    message: collector.message
  };
}

// ------------------------------------------------------------
// STATIC DASHBOARD
// ------------------------------------------------------------

function serveIndex(res) {
  const file = path.join(DATA_DIR, "index.html");

  if (!fs.existsSync(file)) {
    sendText(
      res,
      404,
      "index.html n'existe pas encore."
    );
    return;
  }

  const html = fs.readFileSync(file, "utf8");

  sendText(
    res,
    200,
    html,
    "text/html"
  );
}

// ------------------------------------------------------------
// API ROUTER
// ------------------------------------------------------------

async function router(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
    });

    res.end();
    return;
  }

  const url = new URL(
    req.url,
    `http://${req.headers.host || "localhost"}`
  );

  const pathname = url.pathname;

  // Dashboard
  if (
    req.method === "GET" &&
    pathname === "/api/dashboard"
  ) {
    sendJson(res, 200, dashboardData());
    return;
  }

  // Current analysis WITHOUT saving a prediction
  if (
    req.method === "GET" &&
    pathname === "/api/analyze"
  ) {
    sendJson(res, 200, calculatePrediction(history));
    return;
  }

  // Save a new prediction intentionally
  if (
    req.method === "POST" &&
    pathname === "/api/predict"
  ) {
    const prediction = calculatePrediction(history);

    if (!prediction.ready) {
      sendJson(res, 400, prediction);
      return;
    }

    const saved = savePrediction(prediction);

    sendJson(res, 200, {
      prediction,
      saved
    });

    return;
  }

  // Add manual result
  if (
    req.method === "POST" &&
    pathname === "/api/outcome"
  ) {
    try {
      const body = await readBody(req);

      const result = addOutcome(
        body.outcome,
        body.source || "manual"
      );

      sendJson(res, 200, {
        success: true,
        ...result,
        dashboard: dashboardData()
      });

    } catch (error) {
      sendJson(res, 400, {
        success: false,
        error: error.message
      });
    }

    return;
  }

  // Resolve prediction
  if (
    req.method === "POST" &&
    pathname === "/api/resolve"
  ) {
    try {
      const body = await readBody(req);

      const result =
        resolveLastPrediction(body.outcome);

      sendJson(res, 200, {
        success: true,
        result
      });

    } catch (error) {
      sendJson(res, 400, {
        success: false,
        error: error.message
      });
    }

    return;
  }

  // Backtest
  if (
    req.method === "GET" &&
    pathname === "/api/backtest"
  ) {
    sendJson(res, 200, runBacktest(history));
    return;
  }

  // History
  if (
    req.method === "GET" &&
    pathname === "/api/history"
  ) {
    sendJson(res, 200, {
      count: history.length,
      history
    });

    return;
  }

  // Predictions
  if (
    req.method === "GET" &&
    pathname === "/api/predictions"
  ) {
    sendJson(res, 200, {
      count: predictions.length,
      predictions
    });

    return;
  }

  // Export history
  if (
    req.method === "GET" &&
    pathname === "/api/export"
  ) {
    sendJson(res, 200, {
      exportedAt: new Date().toISOString(),
      history,
      predictions
    });

    return;
  }

  // Clear data
  if (
    req.method === "POST" &&
    pathname === "/api/clear"
  ) {
    history = [];
    predictions = [];

    saveJson(HISTORY_FILE, history);
    saveJson(PREDICTIONS_FILE, predictions);

    sendJson(res, 200, {
      success: true,
      message: "Historique et prédictions supprimés."
    });

    return;
  }

  // Collector status
  if (
    req.method === "GET" &&
    pathname === "/api/collector/status"
  ) {
    sendJson(res, 200, {
      running: collector.running,
      message: collector.message,
      lastOutcome: collector.lastOutcome,
      lastDetectedAt: collector.lastDetectedAt
    });

    return;
  }

  // Start collector
  if (
    req.method === "POST" &&
    pathname === "/api/collector/start"
  ) {
    try {
      const result = await startCollector();

      sendJson(res, 200, result);

    } catch (error) {
      sendJson(res, 500, {
        running: false,
        error: error.message
      });
    }

    return;
  }

  // Stop collector
  if (
    req.method === "POST" &&
    pathname === "/api/collector/stop"
  ) {
    try {
      const result = await stopCollector();

      sendJson(res, 200, result);

    } catch (error) {
      sendJson(res, 500, {
        error: error.message
      });
    }

    return;
  }

  // Home page
  if (
    req.method === "GET" &&
    (pathname === "/" || pathname === "/index.html")
  ) {
    serveIndex(res);
    return;
  }

  sendJson(res, 404, {
    error: "Route introuvable"
  });
}

// ------------------------------------------------------------
// SERVER
// ------------------------------------------------------------

const server = http.createServer((req, res) => {
  router(req, res).catch(error => {
    console.error(error);

    sendJson(res, 500, {
      error: "Erreur serveur",
      details: error.message
    });
  });
});

server.listen(PORT, () => {
  console.log("");
  console.log("======================================");
  console.log("     RED BLACK PRO V5");
  console.log("======================================");
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`History: ${history.length}`);
  console.log(`Predictions: ${predictions.length}`);
  console.log("======================================");
});
