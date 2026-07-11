// Wraps the Antigravity managed agent: runs a specialist in a per-ticket sandbox, streams
// normalized events, asks QUESTION: when blocked, opens a documented PR (labelled `antigravity`),
// and supports follow-up steering that reuses the same sandbox.

const AGENT = "antigravity-preview-05-2026";
const repo = () => process.env.GITHUB_REPO || "pathikg/pulse";
const pat = () => process.env.GITHUB_PAT;

const QUESTION_RULE = `If you hit a decision that MATERIALLY changes the implementation and you are
unsure, do NOT guess: output a single line starting with "QUESTION: " followed by one clear question,
then STOP without making further changes. The user's answer will be sent back to you in this same sandbox.`;

function specialistInstruction(crew, ticket, repoMap = "") {
  const REPO = repo();
  const list = (crew && crew.length ? crew : [{ name: "Engineer", role: "software engineer" }]);
  const lead = list[0];
  const roster = list.map((s, i) => `  ${i + 1}. ${s.name} — ${s.role}${s.responsibilities ? ": " + s.responsibilities : ""}${i === 0 ? " (LEAD)" : ""}`).join("\n");
  const map = repoMap ? `\n\n${repoMap}\n` : "";
  return `You are an autonomous engineering crew assembled for ticket ${ticket.key}, working in the repo
cloned at /workspace/pulse. Your crew, each with a distinct expertise:
${roster}
${map}

Embody ALL of these specialists as you work — apply each one's perspective (${lead.name} leads).
Keep narration short and concrete. A GitHub token is in /workspace/.gh_token.

STRICT WORK BUDGET — you are billed per token and the whole transcript is re-sent to the model on
every step, so exploration is the #1 cost/latency killer. Treat this as a HARD limit:
- You get ~8 tool calls TOTAL for the whole ticket. Plan to: (1) npm ci, (2) open the 1-2 files named
  in the REPO MAP that this ticket touches, (3) edit them, (4) npm test once, (5) commit/push/PR.
- TRUST THE REPO MAP above. Do NOT explore the tree to "understand the codebase" — the map already
  tells you what each file is. Go straight to the file the ticket concerns.
- Read only the specific files/sections you need, ONCE. Do not repeatedly grep or sed the same file,
  do not re-list directories, and do not read files unrelated to this ticket.
- NEVER run \`git log -p\`, \`git show <sha>\`, or otherwise dump commit patches / large diffs into
  the terminal — that floods context with tens of thousands of tokens that get re-sent every turn.
  Use \`git diff --stat\` if you must inspect changes.
- Do not cat or print large files (e.g. style.css) in full. Open targeted line ranges only if needed.
- The sandbox is a FRESH git clone — \`node_modules\` is NOT present. Run \`npm ci\` ONCE as the very
  first thing you do, before running or testing ANY code. Never run \`npm test\` before \`npm ci\` —
  it will fail with "Cannot find package '@google/genai'". After that one install, run \`npm test\`
  once right before opening the PR. Do not re-run either to "double-check".
- Make edits decisively; avoid trial-and-error loops.

${QUESTION_RULE}

When the change is complete, ship it as a pull request:
1. cd /workspace/pulse && git config user.email "agent@pulse.dev" && git config user.name "Pulse Agent"
2. Create a branch named ${ticket.key.toLowerCase()}-<short-slug>
2b. Verify the build (deps are already installed from your one npm ci at the start), echoing progress:
      echo "▶ running tests…" && npm test
      echo "✓ tests passed"
    The suite MUST pass before you open the PR — fix anything you broke.
3. Make the changes, then: git add -A && git commit -m "${ticket.key}: <concise message>"
4. git remote set-url origin "https://x-access-token:$(cat /workspace/.gh_token)@github.com/${REPO}.git"
5. git push -u origin <branch>
6. Open a PR with a PROPER description. The body MUST include: a "## Summary" of what changed,
   a "## Testing" section, and the line "Resolves ${ticket.key}". Use:
   curl -sS -X POST -H "Authorization: Bearer $(cat /workspace/.gh_token)" -H "Accept: application/vnd.github+json" \
     https://api.github.com/repos/${REPO}/pulls \
     -d "$(python3 -c 'import json,sys; print(json.dumps({"title":"${ticket.key}: <title>","head":"<branch>","base":"main","body":"## Summary\\n<what changed>\\n\\n## Testing\\n<how to test>\\n\\nResolves ${ticket.key}"}))')"
7. Add the label: curl -sS -X POST -H "Authorization: Bearer $(cat /workspace/.gh_token)" -H "Accept: application/vnd.github+json" \
     https://api.github.com/repos/${REPO}/issues/<pr_number>/labels -d '{"labels":["antigravity"]}'
8. Print the PR html_url on its own line, exactly: PR_URL: <url>`;
}

function continueInstruction(ticket) {
  return `Continue working ticket ${ticket.key} in the SAME sandbox at /workspace/pulse, on the SAME branch
you already pushed. ${QUESTION_RULE}
If the user says tests/CI are failing: run \`npm ci && npm test\`, read the failures, fix them, then
\`git add -A && git commit\` and \`git push\` to the SAME branch to UPDATE the existing PR — do NOT open a new PR.
When done, print PR_URL: <url> for the existing PR.`;
}

export function normalize(ev) {
  const d = ev.delta;
  switch (ev.event_type) {
    case "interaction.created": return { kind: "status", text: "sandbox starting…" };
    case "step.start": return ev.step?.type === "thought" ? { kind: "thought", text: "" } : null;
    case "step.delta":
      if (d?.type === "thought_summary") return { kind: "thought", text: d.content?.text || "" };
      if (d?.type === "code_execution_call") return { kind: "command", text: d.arguments?.code || "" };
      if (d?.type === "code_execution_result") return { kind: "output", text: String(d.result || ""), isError: !!d.is_error };
      if (d?.type === "text") return { kind: "message", text: d.text || "" };
      return null;
    case "interaction.completed":
      return {
        kind: "done",
        environmentId: ev.interaction?.environment_id,
        interactionId: ev.interaction?.id,
        usage: ev.interaction?.usage || null,
        created: ev.interaction?.created,
        updated: ev.interaction?.updated,
      };
    default: return null;
  }
}

async function pump(stream, onEvent) {
  let done = {};
  for await (const ev of stream) {
    const n = normalize(ev);
    if (!n) continue;
    if (n.kind === "done") done = n;
    onEvent(n);
  }
  return done;
}

export async function runSpecialist(ai, { ticket, crew, repoMap, onEvent }) {
  const stream = await ai.interactions.create({
    agent: AGENT,
    input: ticket.title,
    system_instruction: specialistInstruction(crew, ticket, repoMap),
    environment: {
      type: "remote",
      sources: [
        { type: "repository", source: `https://github.com/${repo()}`, target: "/workspace/pulse" },
        { type: "inline", target: "/workspace/.gh_token", content: pat() },
      ],
    },
    stream: true,
  });
  return pump(stream, onEvent);
}

// Steer / answer a question: chained to the previous interaction, reusing the same sandbox.
export async function followUp(ai, { ticket, previousInteractionId, environmentId, input, onEvent }) {
  const stream = await ai.interactions.create({
    agent: AGENT,
    input,
    system_instruction: continueInstruction(ticket),
    previous_interaction_id: previousInteractionId,
    environment: environmentId,
    stream: true,
  });
  return pump(stream, onEvent);
}
