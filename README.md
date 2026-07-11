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

## Stack
- Node.js + Express, `@google/genai` (Interactions API, agent `antigravity-preview-05-2026`)
- Vanilla JS board UI, Server-Sent Events for the live agent stream

## Architecture

Pulse is organized into a modular, single-process architecture designed for high developer utility and rapid execution feedback:

- **Orchestration Layer (`server.js`)**: An Express-based API coordinator that exposes REST endpoints for ticket management, runs planner pipelines, streams real-time updates via Server-Sent Events (SSE), and serves the frontend.
- **Planner Module (`src/planner.js`)**: Leverages Gemini 3.5 Flash to dynamically assemble a team of ticket-specific, specialized virtual agents with tailored system instructions, bypassing rigid predefined roles.
- **Agent Sandbox (`src/antigravity.js`)**: Interfaces with the Antigravity Managed Agents API, executing each specialized agent in an isolated, remote VM sandbox with full repository and tool access, enabling autonomous branch creation, testing, and PR generation.
- **Local Previews (`src/preview.js`)**: Leverages `git worktree` and isolated child processes running on dedicated ports to spin up live, ephemeral local test environments for open PR branches.
- **Persistence (`src/store.js`)**: A fast and lightweight local JSON-based store (`tickets.json`) that manages ticket state, run statistics, attachments, and collaborative agent-user comment threads.
- **UI Dashboard (`public/`)**: A sleek vanilla JS Kanban board showcasing drag-and-drop actions, live terminal streams of agent output, execution logs, and sandbox steering dialogs.

## Run
```bash
npm install
# .env: GOOGLE_API_KEY, GITHUB_PAT, GITHUB_REPO
npm start   # http://localhost:3000
```
