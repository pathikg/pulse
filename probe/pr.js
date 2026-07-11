// GATE probe 2 (riskiest): can the sandbox clone pulse, push a branch, and open a PR?
import { GoogleGenAI } from "@google/genai";
try { process.loadEnvFile(); } catch {}

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
const PAT = process.env.GITHUB_PAT;
const REPO = process.env.GITHUB_REPO || "pathikg/pulse";

const task = `You are in a Linux sandbox. The GitHub repo ${REPO} is cloned at /workspace/pulse,
and a GitHub token is in the file /workspace/.gh_token. Do EXACTLY the following and then print the
resulting pull request URL. Print the exact error if any step fails.

1. cd /workspace/pulse
2. git config user.email "agent@muster.dev" && git config user.name "Muster Agent"
3. Create a uniquely named branch (append a random suffix), e.g. muster-probe-$RANDOM
4. Append one line to README.md: "Probe: the Muster sandbox reached GitHub."
5. git add -A && git commit -m "probe: sandbox -> GitHub PR"
6. Set the push remote with the token:
   git remote set-url origin "https://x-access-token:$(cat /workspace/.gh_token)@github.com/${REPO}.git"
7. Push the branch: git push -u origin <branch>
8. Open a PR into main via the REST API:
   curl -sS -X POST -H "Authorization: Bearer $(cat /workspace/.gh_token)" \
     -H "Accept: application/vnd.github+json" \
     https://api.github.com/repos/${REPO}/pulls \
     -d '{"title":"Muster probe PR","head":"<branch>","base":"main","body":"Opened autonomously by the Muster sandbox agent."}'
9. Print the "html_url" from the API response.`;

console.log("→ launching sandbox agent to push a branch + open a PR…\n");
try {
  const stream = await ai.interactions.create({
    agent: "antigravity-preview-05-2026",
    input: task,
    environment: {
      type: "remote",
      sources: [
        { type: "repository", source: `https://github.com/${REPO}`, target: "/workspace/pulse" },
        { type: "inline", target: "/workspace/.gh_token", content: PAT },
      ],
    },
    stream: true,
  });

  let envId = "";
  for await (const ev of stream) {
    const d = ev.delta;
    if (ev.event_type === "step.delta") {
      if (d?.type === "code_execution_call") console.log("  $", d.arguments?.code?.replace(/\s+/g, " ").slice(0, 200));
      else if (d?.type === "code_execution_result") console.log("  ⤷", String(d.result || "").trim().slice(0, 300));
      else if (d?.type === "text") process.stdout.write(d.text);
    } else if (ev.event_type === "interaction.completed") {
      envId = ev.interaction?.environment_id || "";
    }
  }
  console.log(`\n\n✅ run finished. environment_id=${envId}`);
  console.log("→ Check https://github.com/" + REPO + "/pulls for the PR.");
} catch (err) {
  console.error("\n❌ PR PROBE FAILED:", err?.status || "", err?.message || err);
  process.exit(1);
}
