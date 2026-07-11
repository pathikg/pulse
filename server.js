import express from "express";
import { GoogleGenAI } from "@google/genai";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runPlanner } from "./src/planner.js";
import { runSpecialist, followUp } from "./src/antigravity.js";

try { process.loadEnvFile(); } catch { console.warn("no .env"); }

if (!process.env.GOOGLE_API_KEY) { console.error("✗ GOOGLE_API_KEY missing"); process.exit(1); }

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// Remember the most recent run so "add context" can reattach to its sandbox.
let lastRun = { interactionId: null, environmentId: null };

// Planner — the star. Fast, reliable.
app.post("/api/plan", async (req, res) => {
  try {
    const crew = await runPlanner(ai, req.body.ticket || "");
    res.json(crew);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

function sseStart(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  return (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

// Run a specialist in the sandbox, streaming its activity to the browser.
app.get("/api/run", async (req, res) => {
  const send = sseStart(res);
  const ticket = req.query.ticket || "";
  let specialist = {};
  try { specialist = JSON.parse(req.query.specialist || "{}"); } catch {}
  try {
    const ids = await runSpecialist(ai, { ticket, specialist, onEvent: (e) => send(e) });
    lastRun = ids;
    send({ kind: "end" });
  } catch (e) {
    send({ kind: "error", text: String(e?.message || e) });
  }
  res.end();
});

// Steer the running task by adding context (reuses the same sandbox).
app.get("/api/followup", async (req, res) => {
  const send = sseStart(res);
  try {
    if (!lastRun.interactionId) throw new Error("no active run to steer");
    const ids = await followUp(ai, {
      previousInteractionId: lastRun.interactionId,
      environmentId: lastRun.environmentId,
      input: req.query.input || "",
      onEvent: (e) => send(e),
    });
    lastRun = { ...lastRun, ...ids };
    send({ kind: "end" });
  } catch (e) {
    send({ kind: "error", text: String(e?.message || e) });
  }
  res.end();
});

app.listen(PORT, () => console.log(`\n  Pulse ▸ http://localhost:${PORT}\n`));
