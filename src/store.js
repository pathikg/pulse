// Lightweight ticket persistence (JSON file). Not a real DB — enough to make the board real,
// survive refreshes, and hold per-ticket sandbox handles + comment threads for the demo.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const FILE = process.env.PULSE_STORE || join(dirname(fileURLToPath(import.meta.url)), "..", "tickets.json");
let state = { seq: 0, runSeq: 0, tickets: [], runs: [] };

function save() { try { writeFileSync(FILE, JSON.stringify(state, null, 2)); } catch {} }
function load() { if (existsSync(FILE)) { try { state = { runs: [], ...JSON.parse(readFileSync(FILE, "utf8")) }; } catch {} } }
load();

export function createTicket({ title, type = "feature", priority = "medium", description = "", attachments = [] }) {
  const t = {
    id: "t" + (++state.seq),
    key: "PULSE-" + state.seq,
    title,
    description,
    type,              // feature | bug
    priority,          // low | medium | high
    status: "todo",    // todo | doing | waiting | review | done
    reporter: "pathik",
    assignee: "antigravity",
    attachments,       // [{name, dataUrl}]
    crew: [],
    prUrl: null, prNumber: null, testUrl: null,
    interactionId: null, environmentId: null,  // reused sandbox for this ticket
    comments: [],      // {author:'agent'|'user'|'system', kind:'question'|'answer'|'note', text, ts}
    createdAt: new Date().toISOString(),
  };
  state.tickets.push(t);
  save();
  return t;
}

export function addAttachment(id, att) {
  const t = getTicket(id);
  if (t) { (t.attachments ||= []).push(att); save(); }
  return t;
}

export const listTickets = () => state.tickets;
export const getTicket = (id) => state.tickets.find((t) => t.id === id);
export function updateTicket(id, patch) { const t = getTicket(id); if (t) { Object.assign(t, patch); save(); } return t; }
export function removeTicket(id) { state.tickets = state.tickets.filter((t) => t.id !== id); save(); }

export function addComment(id, comment) {
  const t = getTicket(id);
  if (!t) return null;
  const c = { ts: new Date().toISOString(), ...comment };
  t.comments.push(c);
  save();
  return c;
}

export function addRun(run) {
  const r = { id: "r" + (++state.runSeq), ...run };
  state.runs.unshift(r);          // newest first
  if (state.runs.length > 100) state.runs.pop();
  save();
  return r;
}
export const listRuns = () => state.runs;

if (state.tickets.length === 0) {
  createTicket({ title: "Add a /health endpoint to server.js that returns { ok: true }", type: "feature", priority: "high" });
  createTicket({ title: "Add a short 'Architecture' section to README.md", type: "feature", priority: "medium" });
}
