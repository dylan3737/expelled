"use strict";

// Shared setup for the browser tests: a tiny static server for the repo, and fresh, isolated game
// pages that record console errors. Google Fonts requests are blocked so the tests never depend on
// the network (the game falls back to Georgia, as it does offline).

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

/** Serve the repo over http://localhost (service workers need a secure origin; localhost counts). */
function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ url: "http://localhost:" + server.address().port + "/", close: () => server.close() });
    });
  });
}

async function launch() {
  return chromium.launch();
}

/**
 * A new browser context and page on the game. Options:
 *  - save: a save object written to localStorage before the game loads (first load only)
 *  - time: a Date to start the fake clock at (page.clock is installed)
 *  - blockDialogs: make prompt() / confirm() return as a hosted artifact does
 *  - viewport: { width, height }
 * Returns { ctx, page, errors } where errors collects page errors and console errors.
 */
async function openGame(browser, baseUrl, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1000, height: 1200 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/ERR_FAILED|ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(m.text());
  });
  if (opts.time) await page.clock.install({ time: opts.time });
  if (opts.blockDialogs) {
    await page.addInitScript(() => {
      window.prompt = () => null;
      window.confirm = () => false;
    });
  }
  if (opts.save) {
    await page.addInitScript((save) => {
      if (sessionStorage.getItem("e2e-seeded")) return;
      sessionStorage.setItem("e2e-seeded", "1");
      localStorage.setItem("ruin_wars_save_v4", JSON.stringify(Object.assign({ lastTick: Date.now() }, save)));
    }, opts.save);
  }
  await page.goto(baseUrl);
  await page.waitForFunction(() => typeof window.RuinWars === "object");
  return { ctx, page, errors };
}

const state = (page) => page.evaluate(() => window.RuinWars.getState());
const log = (page) => page.evaluate(() => window.RuinWars.getLog());
const openTab = (page, id) => page.click('.tab[data-tab="' + id + '"]');

module.exports = { startServer, launch, openGame, state, log, openTab };
