import express from "express";
import { GoogleGenAI } from "@google/genai";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runPlanner } from "./src/planner.js";
import { runSpecialist, followUp } from "./src/antigravity.js";
import * as db from "./src/store.js";
import { startPreview, stopPreview } from "./src/preview.js";

try { process.loadEnvFile(); } catch { console.warn("no .env"); }
if (!process.env.GOOGLE_API_KEY) { console.error("✗ GOOGLE_API_KEY missing"); process.exit(1); }

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// Gemini 3.5 Flash rates (sandbox compute free during preview).
const RATE_IN = 1.5 / 1e6, RATE_OUT = 9.0 / 1e6;
const PR_RE = /https:\/\/github\.com\/[^\s"'`)]+\/pull\/\d+/g;
const Q_RE = /QUESTION:\s*(.+)/g;

const app = express();
app.use(express.json({ limit: "25mb" })); // room for pasted screenshots
app.use(express.static(join(__dirname, "public")));

function sseStart(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  return (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

function cost(usage) {
  if (!usage) return 0;
  return (usage.total_input_tokens || 0) * RATE_IN + (usage.total_output_tokens || 0) * RATE_OUT;
}
const lastMatch = (re, s) => { let m, out = null; while ((m = re.exec(s))) out = m; re.lastIndex = 0; return out; };
// coalesce streamed events into a compact activity log
function pushAct(arr, e) {
  if (!e || (!e.text && e.kind !== "status")) return;
  const last = arr[arr.length - 1];
  if (last && last.kind === e.kind && (e.kind === "message" || e.kind === "thought")) last.text += e.text;
  else arr.push({ kind: e.kind, text: e.text || "" });
}

// Shared post-run processing: cost/time, PR + question detection, comments, run history.
function finishRun(ticket, buffer, done) {
  db.updateTicket(ticket.id, { interactionId: done.interactionId || ticket.interactionId, environmentId: done.environmentId || ticket.environmentId });
  const durationSec = done.created && done.updated ? (new Date(done.updated) - new Date(done.created)) / 1000 : null;
  const costUsd = cost(done.usage);
  db.addRun({
    ticketId: ticket.id, key: ticket.key, title: ticket.title,
    tokens: done.usage?.total_tokens || 0, inputTokens: done.usage?.total_input_tokens || 0,
    outputTokens: done.usage?.total_output_tokens || 0, costUsd, durationSec,
    ts: done.updated || new Date().toISOString(),
  });

  const prMatch = lastMatch(PR_RE, buffer);
  const qMatch = lastMatch(Q_RE, buffer);
  if (prMatch) {
    const url = prMatch[0];
    const num = Number(url.split("/").pop());
    const testUrl = `http://localhost:${PORT}/?ticket=${ticket.id}`; // local preview stub
    db.updateTicket(ticket.id, { prUrl: url, prNumber: num, testUrl, status: "review" });
    db.addComment(ticket.id, { author: "system", kind: "note", text: `✅ PR opened: ${url}` });
    db.addComment(ticket.id, { author: "system", kind: "note", text: `🧪 Test environment (local): ${testUrl}` });
  } else if (qMatch) {
    db.addComment(ticket.id, { author: "agent", kind: "question", text: qMatch[1].trim() });
    db.updateTicket(ticket.id, { status: "waiting" });
  } else {
    db.addComment(ticket.id, { author: "system", kind: "note", text: "Run finished without a PR. Re-run or steer via a comment." });
  }
}

// --- tickets ---
app.get("/api/tickets", (_q, res) => res.json(db.listTickets()));
app.post("/api/tickets", (req, res) => {
  const { title, type, priority, description, attachments } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: "title required" });
  res.json(db.createTicket({ title: title.trim(), type, priority, description, attachments }));
});
app.post("/api/tickets/:id/attach", (req, res) => {
  const t = db.addAttachment(req.params.id, req.body); // { name, dataUrl }
  if (!t) return res.status(404).json({ error: "no ticket" });
  res.json({ ok: true });
});
app.delete("/api/tickets/:id", (req, res) => { db.removeTicket(req.params.id); res.json({ ok: true }); });
app.get("/api/runs", (_q, res) => res.json(db.listRuns()));

// manual status change (drag-drop between columns, or mark done/obsolete)
app.post("/api/tickets/:id/status", (req, res) => {
  const t = db.getTicket(req.params.id);
  if (!t) return res.status(404).json({ error: "no ticket" });
  const { status } = req.body || {};
  db.updateTicket(t.id, { status });
  if (status === "done" || status === "obsolete") stopPreview(t.id);
  res.json({ ok: true });
});

// spin up a live local preview of the PR branch on its own port
app.post("/api/preview", async (req, res) => {
  const t = db.getTicket(req.body?.id);
  if (!t?.prNumber) return res.status(400).json({ error: "no PR to preview" });
  try {
    let branch = t.branch;
    if (!branch) {
      const r = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPO || "pathikg/pulse"}/pulls/${t.prNumber}`,
        { headers: { Authorization: `Bearer ${process.env.GITHUB_PAT}`, Accept: "application/vnd.github+json" } });
      branch = (await r.json()).head?.ref;
      db.updateTicket(t.id, { branch });
    }
    if (!branch) throw new Error("could not resolve PR branch");
    const { url } = await startPreview({ id: t.id, branch });
    db.updateTicket(t.id, { testUrl: url });
    db.addComment(t.id, { author: "system", kind: "note", text: `🧪 Live preview running: ${url}` });
    res.json({ url });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});
app.post("/api/preview/stop", (req, res) => { stopPreview(req.body?.id); res.json({ ok: true }); });

// --- planner (the star) ---
app.post("/api/plan", async (req, res) => {
  const t = db.getTicket(req.body?.id);
  if (!t) return res.status(404).json({ error: "no ticket" });
  try {
    const crew = await runPlanner(ai, t.title);
    db.updateTicket(t.id, { crew: crew.specialists || [] });
    res.json(crew);
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

// --- run a specialist in the ticket's sandbox ---
app.get("/api/run", async (req, res) => {
  const send = sseStart(res);
  const t = db.getTicket(req.query.id);
  if (!t) { send({ kind: "error", text: "no ticket" }); return res.end(); }
  db.updateTicket(t.id, { status: "doing" });
  let buf = "", act = [];
  try {
    const done = await runSpecialist(ai, {
      ticket: t, crew: t.crew || [],
      onEvent: (e) => { if (e.text && (e.kind === "message" || e.kind === "output")) buf += e.text + "\n"; pushAct(act, e); send(e); },
    });
    db.appendActivity(t.id, act);
    finishRun(t, buf, done);
    send({ kind: "ticket" }); send({ kind: "end" });
  } catch (e) { db.appendActivity(t.id, [...act, { kind: "error", text: String(e?.message || e) }]); send({ kind: "error", text: String(e?.message || e) }); }
  res.end();
});

// --- reply / steer: answer in the same sandbox ---
app.get("/api/reply", async (req, res) => {
  const send = sseStart(res);
  const t = db.getTicket(req.query.id);
  const text = req.query.text || "";
  if (!t) { send({ kind: "error", text: "no ticket" }); return res.end(); }
  if (!t.interactionId) { send({ kind: "error", text: "no active sandbox for this ticket" }); return res.end(); }
  db.addComment(t.id, { author: "user", kind: "answer", text });
  db.appendActivity(t.id, [{ kind: "status", text: "↪ steer: " + text }]);
  db.updateTicket(t.id, { status: "doing" });
  let buf = "", act = [];
  try {
    const done = await followUp(ai, {
      ticket: t, previousInteractionId: t.interactionId, environmentId: t.environmentId, input: text,
      onEvent: (e) => { if (e.text && (e.kind === "message" || e.kind === "output")) buf += e.text + "\n"; pushAct(act, e); send(e); },
    });
    db.appendActivity(t.id, act);
    finishRun(t, buf, done);
    send({ kind: "ticket" }); send({ kind: "end" });
  } catch (e) { db.appendActivity(t.id, [...act, { kind: "error", text: String(e?.message || e) }]); send({ kind: "error", text: String(e?.message || e) }); }
  res.end();
});

// --- close the PR from the board ---
app.post("/api/pr/close", async (req, res) => {
  const t = db.getTicket(req.body?.id);
  if (!t?.prNumber) return res.status(400).json({ error: "no PR" });
  try {
    const r = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPO || "pathikg/pulse"}/pulls/${t.prNumber}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${process.env.GITHUB_PAT}`, Accept: "application/vnd.github+json" },
      body: JSON.stringify({ state: "closed" }),
    });
    if (!r.ok) throw new Error("GitHub " + r.status);
    db.updateTicket(t.id, { status: "done" });
    db.addComment(t.id, { author: "system", kind: "note", text: "🔒 PR closed." });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.listen(PORT, () => console.log(`\n  Pulse ▸ http://localhost:${PORT}\n`));
