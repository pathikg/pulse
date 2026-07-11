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
    modules: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          file: { type: Type.STRING, description: "path exactly as given" },
          role: { type: Type.STRING, description: "one short phrase" },
          summary: { type: Type.STRING, description: "1-2 sentences: what it does + key exports/endpoints" },
          dependsOn: { type: Type.ARRAY, items: { type: Type.STRING }, description: "other listed files it imports or calls" },
        },
        required: ["file", "role", "summary", "dependsOn"],
      },
    },
  },
  required: ["modules"],
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
    contents: `Here is the Pulse codebase. For each file, give its role, a 1-2 sentence summary ` +
      `(mention key exports/endpoints), and which OTHER listed files it depends on (imports/calls). ` +
      `Only reference files from this list.\n\n${contents}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: wikiSchema,
      systemInstruction: "You are a code cartographer. Map this codebase into a concise dependency wiki. Return only JSON.",
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
  if (!wiki?.modules?.length) return "";
  return "REPO MAP (authoritative — use this instead of grepping/reading the tree to orient):\n" +
    wiki.modules.map((m) => `- ${m.file} — ${m.role}. ${m.summary}${m.dependsOn?.length ? " [deps: " + m.dependsOn.join(", ") + "]" : ""}`).join("\n");
}
