import express from "express";
import { GoogleGenAI } from "@google/genai";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { runPlanner } from "./src/planner.js";
import { runSpecialist, followUp } from "./src/antigravity.js";

try { process.loadEnvFile(); } catch { console.warn("no .env"); }

if (!process.env.GOOGLE_API_KEY) { console.error("✗ GOOGLE_API_KEY missing"); process.exit(1); }

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(join(__dirname, "public")));

// JWT Secret fallback to simplify setup
const JWT_SECRET = process.env.JWT_SECRET || "pulse-super-secret-key-1234";

// Authentication Middleware
function requireAuth(req, res, next) {
  const token = req.cookies?.pulse_session;
  if (!token) {
    return res.status(401).json({ error: "Unauthorized. Please login." });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid session. Please login again." });
  }
}

// OAuth Flow Endpoints
app.get("/auth/github", (req, res) => {
  const client_id = process.env.GITHUB_CLIENT_ID;
  const redirect_uri = process.env.GITHUB_REDIRECT_URI || `${req.protocol}://${req.get("host")}/auth/github/callback`;
  
  if (!client_id) {
    console.log("No GITHUB_CLIENT_ID configured. Seamlessly logging in with mock developer profile.");
    return res.redirect(`/auth/github/callback?mock=true`);
  }
  
  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${client_id}&redirect_uri=${encodeURIComponent(redirect_uri)}&scope=read:user`;
  res.redirect(githubAuthUrl);
});

app.get("/auth/github/callback", async (req, res) => {
  const { code, mock } = req.query;
  const client_id = process.env.GITHUB_CLIENT_ID;
  const client_secret = process.env.GITHUB_CLIENT_SECRET;
  
  let userProfile = null;
  
  if (mock === "true" || !client_id || !client_secret) {
    userProfile = {
      login: "pulse-dev-user",
      name: "Pulse Developer",
      avatar_url: "https://github.com/identicons/pulse-dev.png",
      bio: "Local Developer Mode"
    };
  } else {
    try {
      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          client_id,
          client_secret,
          code
        })
      });
      
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) {
        throw new Error(tokenData.error_description || "Failed to obtain access token from GitHub");
      }
      
      const userRes = await fetch("https://api.github.com/user", {
        headers: {
          "Authorization": `Bearer ${tokenData.access_token}`,
          "User-Agent": "Pulse-App"
        }
      });
      
      if (!userRes.ok) {
        throw new Error("Failed to fetch user profile from GitHub");
      }
      
      const githubUser = await userRes.json();
      userProfile = {
        login: githubUser.login,
        name: githubUser.name || githubUser.login,
        avatar_url: githubUser.avatar_url,
        bio: githubUser.bio || ""
      };
    } catch (err) {
      console.error("OAuth authentication error:", err);
      return res.status(500).send(`Authentication error: ${err.message}. Please check your credentials.`);
    }
  }
  
  const token = jwt.sign(userProfile, JWT_SECRET, { expiresIn: "7d" });
  
  res.cookie("pulse_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
  
  res.redirect("/");
});

app.get("/auth/user", (req, res) => {
  const token = req.cookies?.pulse_session;
  const isMock = !process.env.GITHUB_CLIENT_ID;
  if (!token) {
    return res.status(401).json({ error: "Unauthorized", isMock });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ ...decoded, isMock });
  } catch (e) {
    res.status(401).json({ error: "Invalid session", isMock });
  }
});

app.get("/auth/logout", (req, res) => {
  res.clearCookie("pulse_session");
  res.redirect("/");
});

// Remember the most recent run so "add context" can reattach to its sandbox.
let lastRun = { interactionId: null, environmentId: null };

// Planner — the star. Fast, reliable.
app.post("/api/plan", requireAuth, async (req, res) => {
  try {
    const crew = await runPlanner(ai, req.body.ticket || "");
    res.json(crew);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

function sseStart(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  return (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

// Run a specialist in the sandbox, streaming its activity to the browser.
app.get("/api/run", requireAuth, async (req, res) => {
  const send = sseStart(res);
  const ticket = req.query.ticket || "";
  let specialist = {};
  try { specialist = JSON.parse(req.query.specialist || "{}"); } catch {}
  try {
    const ids = await runSpecialist(ai, { ticket, specialist, onEvent: (e) => send(e) });
    lastRun = ids;
    send({ kind: "end" });
  } catch (e) {
    send({ kind: "error", text: String(e?.message || e) });
  }
  res.end();
});

// Steer the running task by adding context (reuses the same sandbox).
app.get("/api/followup", requireAuth, async (req, res) => {
  const send = sseStart(res);
  try {
    if (!lastRun.interactionId) throw new Error("no active run to steer");
    const ids = await followUp(ai, {
      previousInteractionId: lastRun.interactionId,
      environmentId: lastRun.environmentId,
      input: req.query.input || "",
      onEvent: (e) => send(e),
    });
    lastRun = { ...lastRun, ...ids };
    send({ kind: "end" });
  } catch (e) {
    send({ kind: "error", text: String(e?.message || e) });
  }
  res.end();
});

app.listen(PORT, () => console.log(`\n  Pulse ▸ http://localhost:${PORT}\n`));
