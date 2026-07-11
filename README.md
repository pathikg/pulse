# Pulse

**File a ticket. A crew assembles itself. A PR shows up.**

Pulse is a JIRA-like board where every ticket is worked by a **crew of specialist AI agents that a
planner invents on the fly for that specific ticket** — not fixed "backend/frontend" roles. Move a
card to **In Progress** and an orchestrator hands the work to a [Google Antigravity](https://ai.google.dev/gemini-api/docs/agents)
managed agent running in a sandbox: it clones the repo, does the work, streams every step live, takes
your steering mid-task, and opens a pull request (labelled `antigravity`).

> Built at the Google DeepMind Bangalore Hackathon (2026) for the Managed Agents / Antigravity track.
> Pulse develops **itself** — this repo is its own first target. The `antigravity`-labelled PRs here
> were opened by Pulse.

## How it works
```
Ticket ──▶ Planner (Gemini 3.5 Flash) ──▶ dynamic specialist crew
                                              │
        move card → In Progress ─────────────▶ Antigravity sandbox (clone repo, work, stream, PR)
```

## Architecture
Pulse is composed of decoupled, lightweight modules to maximize isolation, developer utility, and execution efficiency:

1. **Express Server (`server.js`)**: Coordinates all REST APIs, ticket lifecycle, and serves the vanilla HTML/JS Kanban UI. It streams live agent container operations straight to the browser using Server-Sent Events (SSE).
2. **Planner Module (`src/planner.js`)**: Leverages `gemini-3.5-flash` with a structured JSON output schema to evaluate a ticket and dynamically build a custom specialist "crew" (e.g., `OAuth Integrator` or `Database Optimizer`) on the fly, avoiding generic static roles.
3. **Agent Orchestrator (`src/antigravity.js`)**: Manages Google Antigravity agents (`antigravity-preview-05-2026` via the `@google/genai` Interactions API). It boots remote sandboxed environments, clones the target repo, executes commands, streams step-by-step stdout, opens documented PRs, and handles follow-up steering in the same sandbox session.
4. **Preview Engine (`src/preview.js`)**: Leverages `git worktree` and symlinked `node_modules` to spin up live, isolated preview instances of PR branches on dynamic ports, enabling instantaneous, localized testing of agent work.
5. **Data Store (`src/store.js`)**: A simple, local JSON-backed persistence file (`tickets.json`) that manages ticket states, active sandbox handles (interaction/environment IDs), comments, and run statistics.

## Stack
- Node.js + Express, `@google/genai` (Interactions API, agent `antigravity-preview-05-2026`)
- Vanilla JS board UI, Server-Sent Events for the live agent stream

## Run
```bash
npm install
# .env: GOOGLE_API_KEY, GITHUB_PAT, GITHUB_REPO
npm start   # http://localhost:3000
```
