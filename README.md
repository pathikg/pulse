# Muster

**File a ticket. A crew assembles itself. A PR shows up.**

Muster is a JIRA-like board where every ticket is worked by a **crew of specialist AI agents that a
planner invents on the fly for that specific ticket** — not fixed "backend/frontend" roles. Move a
card to **In Progress** and an orchestrator hands the work to a [Google Antigravity](https://ai.google.dev/gemini-api/docs/agents)
managed agent running in a sandbox: it clones the repo, does the work, streams every step live, takes
your steering mid-task, and opens a pull request.

> Built at the Google DeepMind Bangalore Hackathon (2026) for the Managed Agents / Antigravity track.
> Muster develops **itself** — this repo is its own first target. The PRs on this repo were opened by Muster.

## How it works
```
Ticket ──▶ Planner (Gemini 3.5 Flash) ──▶ dynamic specialist crew
                                              │
        move card → In Progress ─────────────▶ Antigravity sandbox (clone repo, work, stream, PR)
```

## Stack
- Node.js + Express, `@google/genai` (Interactions API, agent `antigravity-preview-05-2026`)
- Vanilla JS board UI, Server-Sent Events for the live agent stream

## Run
```bash
npm install
# .env: GOOGLE_API_KEY, GITHUB_PAT
npm start   # http://localhost:3000
```

_Working name — subject to change._
