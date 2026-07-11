// Wraps the Antigravity managed agent: runs a specialist on the repo, streams normalized events,
// opens a PR labelled `antigravity`, and supports follow-up steering in the same sandbox.

const AGENT = "antigravity-preview-05-2026";

// Read env lazily (server.js loads .env after these modules are imported).
const repo = () => process.env.GITHUB_REPO || "pathikg/pulse";
const pat = () => process.env.GITHUB_PAT;

function specialistInstruction(specialist) {
  const REPO = repo();
  const name = specialist?.name || "Engineer";
  const role = specialist?.role || "software engineer";
  return `You are "${name}" — ${role}. Work inside the cloned repo at /workspace/pulse.
Keep your narration short and concrete. A GitHub token is in /workspace/.gh_token.

Implement the ticket, then ship it as a pull request:
1. cd /workspace/pulse && git config user.email "agent@pulse.dev" && git config user.name "Pulse Agent"
2. Create a uniquely named branch (random suffix), e.g. pulse-<slug>-$RANDOM
3. Make the code changes, then: git add -A && git commit -m "<concise message>"
4. git remote set-url origin "https://x-access-token:$(cat /workspace/.gh_token)@github.com/${REPO}.git"
5. git push -u origin <branch>
6. Open a PR into main:
   curl -sS -X POST -H "Authorization: Bearer $(cat /workspace/.gh_token)" -H "Accept: application/vnd.github+json" \
     https://api.github.com/repos/${REPO}/pulls -d '{"title":"<title>","head":"<branch>","base":"main","body":"Opened autonomously by Pulse."}'
7. Add the antigravity label (capture the PR number from step 6's response):
   curl -sS -X POST -H "Authorization: Bearer $(cat /workspace/.gh_token)" -H "Accept: application/vnd.github+json" \
     https://api.github.com/repos/${REPO}/issues/<pr_number>/labels -d '{"labels":["antigravity"]}'
8. Print the PR html_url on its own line, exactly: PR_URL: <url>`;
}

// Map raw Interactions API events → compact UI events.
export function normalize(ev) {
  const d = ev.delta;
  switch (ev.event_type) {
    case "interaction.created":
      return { kind: "status", text: "sandbox starting…" };
    case "step.start":
      if (ev.step?.type === "thought") return { kind: "thought", text: "" };
      return null;
    case "step.delta":
      if (d?.type === "thought_summary") return { kind: "thought", text: d.content?.text || "" };
      if (d?.type === "code_execution_call") return { kind: "command", text: d.arguments?.code || "" };
      if (d?.type === "code_execution_result")
        return { kind: "output", text: String(d.result || ""), isError: !!d.is_error };
      if (d?.type === "text") return { kind: "message", text: d.text || "" };
      return null;
    case "interaction.completed":
      return { kind: "done", environmentId: ev.interaction?.environment_id, interactionId: ev.interaction?.id };
    default:
      return null;
  }
}

async function pump(stream, onEvent) {
  let ids = {};
  for await (const ev of stream) {
    const n = normalize(ev);
    if (!n) continue;
    if (n.kind === "done") ids = { environmentId: n.environmentId, interactionId: n.interactionId };
    onEvent(n);
  }
  return ids;
}

export async function runSpecialist(ai, { ticket, specialist, onEvent }) {
  const stream = await ai.interactions.create({
    agent: AGENT,
    input: ticket,
    system_instruction: specialistInstruction(specialist),
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

// Steer mid-task: a new interaction chained to the previous one, reusing the same sandbox.
export async function followUp(ai, { previousInteractionId, environmentId, input, onEvent }) {
  const stream = await ai.interactions.create({
    agent: AGENT,
    input,
    previous_interaction_id: previousInteractionId,
    environment: environmentId, // reattach to the same sandbox (filesystem preserved)
    stream: true,
  });
  return pump(stream, onEvent);
}
