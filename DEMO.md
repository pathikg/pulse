# Pulse — demo status & script

## ✅ Status: working end-to-end (all gates + builds green)
| Piece | State |
|---|---|
| Antigravity access on the key | ✅ verified |
| Sandbox → git push → **PR** (the risky unknown) | ✅ proven — see PRs #1, #2 |
| PR gets `antigravity` label | ✅ PR #2 labelled |
| Planner → dynamic specialist crew | ✅ distinct crews per ticket |
| Move to In Progress → live agent stream | ✅ SSE, Claude-Code-style log |
| Steer with context (same sandbox) | ✅ follow-up reattaches |
| Repo pushed + platform dogfoods itself | ✅ github.com/pathikg/pulse |

Proof it's real: **https://github.com/pathikg/pulse/pulls** — PRs opened autonomously by the sandbox.

## Run
```bash
npm start                 # http://localhost:3000
# tunnel (for phone / sharing):
cloudflared tunnel --url http://localhost:3000
```

## 3-minute demo script
1. **Creativity money shot (can't fail — pure planning):**
   - Board already seeded with "Add OAuth login" and "Optimize the PostgreSQL queries".
   - Move each to In Progress → watch the planner invent a *different, ticket-specific* crew for each
     (OAuth Security Architect / Backend Integrator / … vs Query Plan Analyst / Indexing Architect / …).
     "Same system — it designs the right team per problem."
2. **"And it builds itself" (the proof):**
   - Add a small real ticket, e.g. **"Add a /health endpoint to server.js"**.
   - Move To Do → In Progress → the lead specialist spins up an Antigravity sandbox, clones THIS repo,
     writes code, streams every command live on the card.
   - **Steer it:** type a context line (e.g. "also return the git commit sha") → it continues in the
     same sandbox.
   - **PR lands** on `pathikg/pulse`, labelled `antigravity` → click through as the closer.
3. **Vision slide (say, don't build):** parallel multi-sandbox crews, code-graph traversal, deploy envs.

## ⚠️ Demo discipline (agent runs are ~1–2 min, sometimes flaky)
- **Kick off the real run at the START of the beat and narrate while it works** — never watch a spinner.
- **Record fallback footage** of one clean run (stream + PR) BEFORE going on stage.
- Keep the executed ticket **tiny** (health endpoint / a doc line) so it finishes fast.
- Pre-warm: do one throwaway run right before your slot so the path is hot.

## Scoring hooks
- Creativity (35%): dynamic per-ticket crews + self-building platform.
- Impact-India (25%): "a solo dev moves like a team" for India's huge dev/services workforce.
- Live demo (25%): planner is instant; PR is a concrete artifact judges can click.

## Nice-to-haves if time remains
- Show the crew members' roles on hover (already in tooltips).
- A second executed ticket to show variety.
- Rename polish / a logo.
