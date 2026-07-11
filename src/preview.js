// Spin up a live local preview of a PR branch: git worktree of the branch + shared node_modules,
// run as a child process on its own port. A real, isolated copy of the change on localhost.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, symlinkSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let nextPort = 3100;
const previews = new Map(); // ticketId -> { proc, port, dir, branch, url }

export const getPreview = (id) => previews.get(id);

async function ready(port, ms = 12000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const r = await fetch(`http://localhost:${port}/`); if (r.ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

export async function startPreview({ id, branch }) {
  stopPreview(id);
  const port = nextPort++;
  const safe = branch.replace(/[^\w.-]/g, "_");
  const dir = join(ROOT, ".previews", safe);
  mkdirSync(join(ROOT, ".previews"), { recursive: true });

  execFileSync("git", ["fetch", "origin", branch], { cwd: ROOT });
  try { execFileSync("git", ["worktree", "remove", "--force", dir], { cwd: ROOT }); } catch {}
  execFileSync("git", ["worktree", "add", "--force", "--detach", dir, `origin/${branch}`], { cwd: ROOT });

  const nm = join(dir, "node_modules");
  if (!existsSync(nm)) { try { symlinkSync(join(ROOT, "node_modules"), nm, "dir"); } catch {} }

  // Child inherits parent env (GOOGLE_API_KEY etc. already loaded), with its own PORT + store.
  const proc = spawn("node", ["server.js"], {
    cwd: dir,
    env: { ...process.env, PORT: String(port), PULSE_STORE: join(dir, "preview-tickets.json") },
    stdio: "ignore",
  });
  proc.on("error", () => {});
  const url = `http://localhost:${port}`;
  previews.set(id, { proc, port, dir, branch, url });
  await ready(port);
  return { url, port };
}

export function stopPreview(id) {
  const p = previews.get(id);
  if (!p) return;
  try { p.proc.kill(); } catch {}
  try { execFileSync("git", ["worktree", "remove", "--force", p.dir], { cwd: ROOT }); } catch {}
  previews.delete(id);
}

process.on("exit", () => { for (const p of previews.values()) { try { p.proc.kill(); } catch {} } });
