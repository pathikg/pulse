// Codebase Wiki: a one-time (re-runnable) index built by Gemini 3.5 Flash. It reads the source,
// summarizes each module + its dependencies into a compact graph, and — crucially — feeds that
// map into the Antigravity agent's prompt so it stops exploring the repo blindly (the #1 cause of
// the token blow-up). Rebuilt on demand (Reindex button) so it stays fresh as PRs merge.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Type } from "@google/genai";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WIKI_FILE = process.env.PULSE_WIKI || join(ROOT, "wiki.json");

// The source files worth mapping (skip node_modules, generated, and data files).
const FILES = ["server.js", "src/store.js", "src/planner.js", "src/antigravity.js", "src/preview.js", "src/wiki.js", "public/app.js"];

const wikiSchema = {
  type: Type.OBJECT,
  properties: {
    nodes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, description: "unique slug, e.g. 'server.js' or 'ep:POST /api/run' or 'ext:Antigravity'" },
          label: { type: Type.STRING, description: "short display name" },
          type: { type: Type.STRING, enum: ["module", "endpoint", "external", "concept"], description: "module=source file; endpoint=HTTP route; external=3rd-party service/tool; concept=cross-cutting idea" },
          file: { type: Type.STRING, description: "for module nodes: the file path" },
          summary: { type: Type.STRING, description: "1 sentence: what it is / does" },
        },
        required: ["id", "label", "type"],
      },
    },
    edges: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          source: { type: Type.STRING, description: "node id" },
          target: { type: Type.STRING, description: "node id" },
        },
        required: ["source", "target"],
      },
    },
  },
  required: ["nodes", "edges"],
};

export function readWiki() {
  if (existsSync(WIKI_FILE)) { try { return JSON.parse(readFileSync(WIKI_FILE, "utf8")); } catch {} }
  return null;
}

function gather() {
  return FILES.filter((f) => existsSync(join(ROOT, f))).map((f) => {
    let src = readFileSync(join(ROOT, f), "utf8");
    if (src.length > 6000) src = src.slice(0, 6000) + "\n/* …truncated… */";
    return { file: f, src };
  });
}

export async function buildWiki(ai) {
  const files = gather();
  const contents = files.map((f) => `### ${f.file}\n\`\`\`\n${f.src}\n\`\`\``).join("\n\n");
  const res = await ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents: `Here is the Pulse codebase (a JIRA-like board that hands tickets to Google Antigravity ` +
      `managed agents which open PRs). Build a KNOWLEDGE GRAPH of it. Emit nodes of these types:\n` +
      `- module: one per source file (set file=path, summary=what it does + key exports).\n` +
      `- endpoint: one per HTTP route you find (e.g. "POST /api/run", "GET /api/wiki"). label it that way.\n` +
      `- external: third-party services/tools the code uses (e.g. Gemini API, Antigravity Managed Agents, ` +
      `GitHub API, git worktree, SSE/browser, Express).\n` +
      `- concept: cross-cutting ideas this system implements (e.g. Dynamic Crew Planning, Sandbox PR flow, ` +
      `Live Activity Streaming, Cost Tracking, Codebase Wiki, Self-Dogfooding).\n` +
      `Then emit edges connecting them: module→module imports, module→endpoint it defines, ` +
      `module→external it calls, module/endpoint→concept it implements. Aim for a rich, connected graph ` +
      `(~25-45 nodes). Ground everything in the actual source; do not invent files.\n\n${contents}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: wikiSchema,
      systemInstruction: "You are a code cartographer. Map this codebase into a rich, connected knowledge graph. Return only JSON.",
    },
  });
  const wiki = JSON.parse(res.text);
  wiki.generatedAt = new Date().toISOString();
  wiki.model = "gemini-3.5-flash";
  writeFileSync(WIKI_FILE, JSON.stringify(wiki, null, 2));
  return wiki;
}

// Compact repo map injected into the agent's system prompt so it doesn't re-explore the tree.
export function wikiToPrompt(wiki) {
  const mods = (wiki?.nodes || []).filter((n) => n.type === "module");
  if (!mods.length) return "";
  return "REPO MAP (authoritative — use this instead of grepping/reading the tree to orient):\n" +
    mods.map((m) => `- ${m.file || m.label} — ${m.summary || m.label}`).join("\n");
}
