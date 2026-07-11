const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const api = (u, o) => fetch(u, o).then((r) => r.json());
const esc = (s) => (s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const linkify = (s) => s.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

const COLS = [{ id: "todo", label: "To Do" }, { id: "doing", label: "In Progress" }, { id: "review", label: "In Review" }, { id: "done", label: "Done" }];
const AV = ["#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#ec4899"];
const initials = (n) => (n || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

let tickets = [], runs = [], wiki = null, view = "board", openId = null, es = null, streamingId = null, createAtts = [];
const logs = new Map();
const T = (id) => tickets.find((t) => t.id === id);

async function loadAll() {
  [tickets, runs, wiki] = await Promise.all([api("/api/tickets"), api("/api/runs"), api("/api/wiki")]);
  // if we're not the ones live-streaming this ticket (e.g. after a mid-run reload),
  // trust the server's incrementally-persisted activity so the log keeps advancing.
  if (openId && streamingId !== openId) {
    const t = T(openId);
    if (t?.activity?.length) logs.set(openId, t.activity.map((a) => ({ ...a })));
  }
  render();
}

function render() {
  $$("#nav button").forEach((b) => {
    const active = b.dataset.view === view;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", active ? "true" : "false");
  });
  ["board", "runs", "analytics", "graph"].forEach((v) => ($(`#view-${v}`).hidden = v !== view));
  if (view === "board") renderBoard();
  if (view === "runs") renderRuns();
  if (view === "analytics") renderAnalytics();
  if (view === "graph") renderGraph();
  if (openId) renderIssue();
}

// ---------------- board ----------------
function renderBoard() {
  const v = $("#view-board");
  v.innerHTML = `<div class="board"></div>`;
  const board = $(".board", v);
  for (const col of COLS) {
    const items = tickets.filter((t) => col.id === "done" ? (t.status === "done" || t.status === "obsolete") : t.status === col.id);
    const el = document.createElement("section");
    el.className = "col";
    el.setAttribute("aria-label", col.label);
    el.innerHTML = `<div class="col-h" id="h-${col.id}">${col.label}<span class="count">${items.length}</span></div><div class="col-cards" role="list" aria-labelledby="h-${col.id}"></div>`;
    const cards = $(".col-cards", el);
    items.forEach((t) => cards.appendChild(cardEl(t)));
    el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("drop"); });
    el.addEventListener("dragleave", () => el.classList.remove("drop"));
    el.addEventListener("drop", async (e) => {
      e.preventDefault(); el.classList.remove("drop");
      const t = T(e.dataTransfer.getData("id"));
      if (!t) return;
      if (col.id === "doing" && t.status === "todo") startTicket(t.id);          // start the agent
      else if (col.id !== t.status && !(col.id === "done" && t.status === "obsolete")) await setStatus(t.id, col.id);
    });
    board.appendChild(el);
  }
}

function cardEl(t) {
  const el = document.createElement("div");
  el.className = "card" + (t.status === "doing" ? " running" : "") + (t.status === "obsolete" ? " obsolete" : "");
  el.draggable = true;
  el.setAttribute("role", "listitem");
  el.setAttribute("tabindex", "0");
  el.setAttribute("aria-label", `${t.type === "bug" ? "Bug" : "Feature"} ticket ${t.key}: ${t.title}`);
  
  const badge = t.status === "obsolete" ? `<span class="badge obsolete">obsolete</span>`
    : t.prNumber ? `<span class="badge pr">PR #${t.prNumber}</span>`
    : t.status === "waiting" ? `<span class="badge waiting">needs you</span>`
    : t.status === "doing" ? `<span class="badge running">running…</span>` : "";
  const avatars = (t.crew || []).slice(0, 4).map((s, i) => `<span class="avatar" style="background:${AV[i % AV.length]}" title="${esc(s.name)}">${initials(s.name)}</span>`).join("");
  const thumb = (t.attachments || [])[0] ? `<img class="thumb-mini" src="${t.attachments[0].dataUrl}" alt="Attachment preview" />` : "";
  el.innerHTML = `<div class="card-top"><span class="flag ${t.type}">${t.type === "bug" ? "🐞 Bug" : "✨ Feature"}</span><span class="key">${t.key}</span><span class="prio ${t.priority}" title="Priority: ${t.priority}"></span></div>
    <div class="card-title">${esc(t.title)}</div>${thumb}
    <div class="card-foot"><div class="avatars">${avatars}</div>${badge}</div>`;
  
  el.onclick = () => openIssue(t.id);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openIssue(t.id);
    }
  });
  el.addEventListener("dragstart", (e) => e.dataTransfer.setData("id", t.id));
  return el;
}

// ---------------- runs page ----------------
function renderRuns() {
  const rows = runs.map((r) => `<tr><td><span class="k">${r.key}</span></td><td>${esc(r.title)}</td>
    <td>${(r.tokens || 0).toLocaleString()}</td><td>$${(r.costUsd || 0).toFixed(4)}</td>
    <td>${r.durationSec ? Math.round(r.durationSec) + "s" : "—"}</td><td>${new Date(r.ts).toLocaleString()}</td></tr>`).join("");
  $("#view-runs").innerHTML = `<div class="page"><h1>Runs</h1><div class="table-container">
    <table class="runs"><thead><tr><th>Ticket</th><th>Title</th><th>Tokens</th><th>Est. cost</th><th>Duration</th><th>When</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="6" style="color:var(--faint); text-align: center; padding: 24px;">No runs yet.</td></tr>`}</tbody></table></div></div>`;
}

// ---------------- analytics ----------------
function renderAnalytics() {
  const prs = tickets.filter((t) => t.prNumber).length;
  const tokens = runs.reduce((a, r) => a + (r.tokens || 0), 0);
  const cost = runs.reduce((a, r) => a + (r.costUsd || 0), 0);
  const done = tickets.filter((t) => t.status === "done").length;

  const byDay = {};
  runs.forEach((r) => { const d = (r.ts || "").slice(0, 10); (byDay[d] ||= { tok: 0, n: 0 }); byDay[d].tok += r.tokens || 0; byDay[d].n++; });
  const days = Object.keys(byDay).sort();
  const maxTok = Math.max(1, ...days.map((d) => byDay[d].tok));
  const maxN = Math.max(1, ...days.map((d) => byDay[d].n));
  const bars = (val, max, alt) => days.map((d) => {
    const h = Math.round((val(d) / max) * 150);
    return `<div class="bar-wrap"><span class="bar-val">${val(d) >= 1000 ? (val(d) / 1000).toFixed(1) + "k" : val(d)}</span><div class="bar ${alt ? "alt" : ""}" style="height:${h}px"></div><span class="bar-lbl">${d.slice(5)}</span></div>`;
  }).join("") || `<div style="color:var(--faint)">No data yet.</div>`;

  $("#view-analytics").innerHTML = `<div class="page">
    <h1>Analytics</h1>
    <div class="kpis">
      <div class="kpi"><div class="v">${tickets.length}</div><div class="l">Total tickets</div></div>
      <div class="kpi"><div class="v">${prs}</div><div class="l">PRs raised</div></div>
      <div class="kpi"><div class="v">${(tokens / 1000).toFixed(1)}k</div><div class="l">Tokens burned</div></div>
      <div class="kpi"><div class="v">$${cost.toFixed(2)}</div><div class="l">Est. spend</div></div>
    </div>
    <div class="charts">
      <div class="chart"><h3>Tokens per day</h3><div class="bars">${bars((d) => byDay[d].tok, maxTok, false)}</div></div>
      <div class="chart"><h3>Runs per day</h3><div class="bars">${bars((d) => byDay[d].n, maxN, true)}</div></div>
    </div>
    <div class="chart" style="margin-top:20px"><h3>Tickets by status</h3>
      <div class="bars">${COLS.map((c) => { const n = tickets.filter((t) => t.status === c.id).length; const h = Math.round((n / Math.max(1, tickets.length)) * 150); return `<div class="bar-wrap"><span class="bar-val">${n}</span><div class="bar" style="height:${h}px"></div><span class="bar-lbl">${c.label}</span></div>`; }).join("")}
      <div class="bar-wrap"><span class="bar-val">${done}</span><div class="bar alt" style="height:${Math.round((done / Math.max(1, tickets.length)) * 150)}px"></div><span class="bar-lbl">Closed</span></div></div></div>
  </div>`;
}

// ---------------- codebase graph / wiki ----------------
async function reindex() {
  const btn = $("#reindex-btn"); if (btn) { btn.textContent = "⏳ indexing… (Gemini 3.5 Flash)"; btn.disabled = true; }
  try { await api("/api/reindex", { method: "POST" }); await loadAll(); }
  catch (e) { if (btn) { btn.textContent = "↻ Reindex (failed, retry)"; btn.disabled = false; } }
}
const GTYPES = { module: "#8b5cf6", endpoint: "#10b981", external: "#f59e0b", concept: "#3b82f6" };
let graphSig = null, graphAnim = null;
function renderGraph() {
  const nodes0 = wiki?.nodes || [], edges0 = wiki?.edges || [];
  const sig = (wiki?.generatedAt || "") + "/" + nodes0.length;
  // don't rebuild (and reset physics) on background polls — only when the index changes
  if (sig === graphSig && $("#gsvg")) return;
  graphSig = sig;
  if (graphAnim) { cancelAnimationFrame(graphAnim); graphAnim = null; }

  $("#view-graph").innerHTML = `<div class="graph-page">
    <div class="graph-head"><h1>Codebase Wiki</h1>
      <div class="glegend">${Object.entries(GTYPES).map(([k, c]) => `<span><i style="background:${c}"></i>${k}</span>`).join("")}</div>
      <button id="reindex-btn" class="primary">↻ Reindex</button></div>
    <div class="muted-line">${wiki?.generatedAt ? `${nodes0.length} nodes · ${edges0.length} edges · ${esc(wiki.model || "Gemini 3.5 Flash")} · indexed ${new Date(wiki.generatedAt).toLocaleString()} · fed to Antigravity as a REPO MAP to cut exploration tokens` : "Not indexed yet — click Reindex to build the graph with Gemini 3.5 Flash."}</div>
    <div class="gcanvas" id="gcanvas"><svg id="gsvg"><g id="gzoom"><g id="gedges"></g><g id="gnodes"></g></g></svg><div class="ghint">drag nodes · scroll to zoom · drag background to pan</div></div>
  </div>`;
  if ($("#reindex-btn")) $("#reindex-btn").onclick = reindex;
  if (!nodes0.length) return;

  const canvas = $("#gcanvas"), svg = $("#gsvg"), zoomG = $("#gzoom");
  const W = canvas.clientWidth || 900, H = canvas.clientHeight || 520;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const idx = {};
  const N = nodes0.map((n, i) => { idx[n.id] = i; return { ...n, x: W / 2 + (Math.random() - .5) * W * .6, y: H / 2 + (Math.random() - .5) * H * .6, vx: 0, vy: 0 }; });
  const E = edges0.map((e) => ({ s: idx[e.source], t: idx[e.target] })).filter((e) => e.s != null && e.t != null);
  const k = Math.sqrt((W * H) / Math.max(1, N.length)) * 0.72;
  let temp = W / 8;

  const gE = $("#gedges"), gN = $("#gnodes");
  gE.innerHTML = E.map(() => `<line stroke="var(--line2,#444)" stroke-width="1" opacity="0.6"/>`).join("");
  gN.innerHTML = N.map((n, i) => { const c = GTYPES[n.type] || "#888", r = n.type === "module" ? 14 : n.type === "concept" ? 11 : 9; return `<g class="gn" data-i="${i}"><circle r="${r}" fill="${c}33" stroke="${c}" stroke-width="1.8"/><text dy="-${r + 4}" text-anchor="middle" fill="var(--text)" font-size="9.5">${esc(n.label)}</text></g>`; }).join("");
  const lineEls = [...gE.children], nodeEls = [...gN.children];

  function draw() {
    for (let i = 0; i < E.length; i++) { const l = lineEls[i], a = N[E[i].s], b = N[E[i].t]; l.setAttribute("x1", a.x.toFixed(1)); l.setAttribute("y1", a.y.toFixed(1)); l.setAttribute("x2", b.x.toFixed(1)); l.setAttribute("y2", b.y.toFixed(1)); }
    for (let i = 0; i < N.length; i++) nodeEls[i].setAttribute("transform", `translate(${N[i].x.toFixed(1)},${N[i].y.toFixed(1)})`);
  }
  function step() {
    for (let i = 0; i < N.length; i++) { let fx = 0, fy = 0; for (let j = 0; j < N.length; j++) { if (i === j) continue; let dx = N[i].x - N[j].x, dy = N[i].y - N[j].y, d = Math.hypot(dx, dy) || .01, rep = k * k / d; fx += dx / d * rep; fy += dy / d * rep; } N[i].vx = fx; N[i].vy = fy; }
    for (const e of E) { const a = N[e.s], b = N[e.t]; let dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy) || .01, att = d * d / k, fx = dx / d * att, fy = dy / d * att; a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy; }
    for (const n of N) { if (n.fixed) continue; n.vx += (W / 2 - n.x) * .012; n.vy += (H / 2 - n.y) * .012; const disp = Math.hypot(n.vx, n.vy) || .01; n.x += n.vx / disp * Math.min(disp, temp); n.y += n.vy / disp * Math.min(disp, temp); n.x = Math.max(24, Math.min(W - 24, n.x)); n.y = Math.max(24, Math.min(H - 24, n.y)); }
    if (temp > 1.2) temp *= 0.975;
    draw();
    graphAnim = requestAnimationFrame(step);
  }

  let scale = 1, panx = 0, pany = 0, panning = false, sx = 0, sy = 0, drag = null;
  const applyT = () => zoomG.setAttribute("transform", `translate(${panx},${pany}) scale(${scale})`);
  const toLocal = (e) => { const r = svg.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width * W - panx) / scale, y: ((e.clientY - r.top) / r.height * H - pany) / scale }; };
  svg.onwheel = (e) => { e.preventDefault(); scale = Math.max(0.3, Math.min(3, scale * (e.deltaY < 0 ? 1.1 : 0.9))); applyT(); };
  svg.onmousedown = (e) => { if (e.target.closest(".gn")) return; panning = true; sx = e.clientX - panx; sy = e.clientY - pany; };
  gN.onmousedown = (e) => { const g = e.target.closest(".gn"); if (!g) return; e.stopPropagation(); drag = +g.dataset.i; N[drag].fixed = true; temp = Math.max(temp, W / 14); };
  const onMove = (e) => { if (panning) { panx = e.clientX - sx; pany = e.clientY - sy; applyT(); } if (drag != null) { const p = toLocal(e); N[drag].x = p.x; N[drag].y = p.y; } };
  const onUp = () => { panning = false; if (drag != null) { N[drag].fixed = false; drag = null; } };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  step();
}

// ---------------- issue modal ----------------
function openIssue(id) {
  openId = id;
  if (!logs.has(id)) { const t = T(id); if (t?.activity?.length) logs.set(id, t.activity.map((a) => ({ ...a }))); } // show persisted log
  $("#scrim").hidden = false; $("#issue").hidden = false; renderIssue();
  $("#iss-close").focus();
}

function closeIssue() {
  openId = null;
  $("#scrim").hidden = true;
  $("#issue").hidden = true;
  if (es) es.close();
  // Return focus to the ticket card
  const card = $$(".card").find((el) => el.innerHTML.includes(T(openId)?.key || ""));
  if (card) card.focus();
}

function renderIssue() {
  const t = T(openId); if (!t) return;
  // preserve in-progress input + scroll across background re-renders (poll/SSE resync)
  const rin = $("#reply input");
  const keep = rin ? { val: rin.value, foc: document.activeElement === rin, s: rin.selectionStart, e: rin.selectionEnd } : null;
  const mainScroll = $(".iss-main")?.scrollTop;
  const agents = (t.crew || []).length ? (t.crew || []).map((s, i) => `<div class="agent-row"><span class="avatar" style="background:${AV[i % AV.length]}">${initials(s.name)}</span><div><div class="nm">${esc(s.name)}</div><div class="rl">${esc(s.role || "")}</div></div><span class="tag">${i === 0 ? "lead" : "member"}</span></div>`).join("") : `<div style="color:var(--faint);font-size:13.5px;font-style:italic">No crew yet — start work to spawn the crew.</div>`;
  const atts = (t.attachments || []).map((a, i) => `<img src="${a.dataUrl}" title="${esc(a.name)}" alt="${esc(a.name)}" onclick="window.open('${a.dataUrl}')" />`).join("");
  const comments = (t.comments || []).filter((c) => !c.text || !c.text.includes("Test environment")).map((c) => `<div class="comment ${c.author} ${c.kind === "question" ? "question" : ""}"><div class="c-who">${c.author === "agent" ? "🤖 Antigravity" : c.author === "user" ? "🧑 Pathik" : "•"}${c.kind === "question" ? " · asks" : ""}</div><div>${linkify(esc(c.text))}</div></div>`).join("") || `<div style="color:var(--faint);font-size:13.5px;font-style:italic">No comments yet.</div>`;
  const canReply = ["waiting", "review", "doing"].includes(t.status);
  const isPreview = t.testUrl && /localhost:31\d\d/.test(t.testUrl);
  const prBlock = t.prUrl ? `<div class="pr-actions">
      <a class="pr" href="${t.prUrl}" target="_blank" rel="noopener noreferrer">View PR #${t.prNumber}</a>
      <button id="preview-btn">🚀 Spin up live preview</button>
      ${isPreview ? `<a href="${t.testUrl}" target="_blank" rel="noopener noreferrer">🧪 Open preview (:${t.testUrl.split(":").pop()})</a>` : ""}
      <button id="close-pr">Close PR</button></div>` : "";
  const STATUSES = { todo: "To Do", doing: "In Progress", waiting: "Needs you", review: "In Review", done: "Done", obsolete: "Obsolete" };

  $("#issue").innerHTML = `
    <div class="iss-head"><span class="flag ${t.type}">${t.type === "bug" ? "🐞 Bug" : "✨ Feature"}</span>
      <span class="crumbs">${t.key}</span>
      <select class="status-sel" id="iss-status" aria-label="Status">${Object.entries(STATUSES).filter(([k]) => k !== "waiting").map(([k, v]) => `<option value="${k}" ${t.status === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      <button class="iss-close" id="iss-close" aria-label="Close dialog">×</button></div>
    <div class="iss-cols">
      <div class="iss-main">
        <h2 id="iss-title">${esc(t.title)}</h2>
        <div class="sec"><div class="sec-t">Description</div><div class="desc ${t.description ? "" : "empty"}">${t.description ? linkify(esc(t.description)) : "No description."}</div></div>
        <div class="sec"><div class="sec-t">Attachments</div><div class="thumbs" id="iss-thumbs">${atts || '<span style="color:var(--faint);font-size:13px;font-style:italic">Paste a screenshot while this is open to attach.</span>'}</div></div>
        <div class="sec"><div class="sec-t">Agents (${(t.crew || []).length})</div><div class="agent-list">${agents}</div></div>
        <div class="sec"><div class="sec-t">Live activity</div><div class="log" id="iss-log"></div></div>
        <div class="sec"><div class="sec-t">Comments</div><div class="comments">${comments}</div>
          ${canReply ? `<form class="reply" id="reply" aria-label="Add a comment"><input placeholder="${t.status === "waiting" ? "Answer the agent…" : "Comment / steer the agent…"}" autocomplete="off" aria-label="Comment text" /><button class="primary">Send</button></form>` : ""}</div>
      </div>
      <div class="iss-rail">
        ${t.status === "todo" ? `<button class="startwork" id="startwork">▶ Start work</button><div style="height:16px"></div>` : ""}
        ${prBlock ? `<div class="rail-row"><div class="rl-l">Pull request</div>${prBlock}</div>` : ""}
        <div class="rail-row"><div class="rl-l">Assignee</div><div class="rl-v"><div class="who"><span class="avatar" style="background:${AV[0]}">AG</span>Antigravity</div></div></div>
        <div class="rail-row"><div class="rl-l">Reporter</div><div class="rl-v"><div class="who"><span class="avatar" style="background:${AV[3]}">PK</span>Pathik</div></div></div>
        <div class="rail-row"><div class="rl-l">Priority</div><div class="rl-v"><span class="prio ${t.priority}"></span> ${t.priority}</div></div>
        <div class="rail-row"><div class="rl-l">Type</div><div class="rl-v">${t.type === "bug" ? "🐞 Bug" : "✨ Feature"}</div></div>
        <div class="rail-row"><div class="rl-l">Labels</div><div class="rl-v">${t.prNumber ? '<span class="pill">antigravity</span>' : "—"}</div></div>
        <div class="rail-row"><div class="rl-l">Created</div><div class="rl-v">${t.createdAt ? new Date(t.createdAt).toLocaleString() : "—"}</div></div>
      </div>
    </div>`;
  $("#iss-close").onclick = closeIssue;
  if ($("#iss-status")) $("#iss-status").onchange = (e) => setStatus(t.id, e.target.value);
  if ($("#startwork")) $("#startwork").onclick = () => startTicket(t.id);
  if ($("#preview-btn")) $("#preview-btn").onclick = () => spinPreview(t.id);
  if ($("#close-pr")) $("#close-pr").onclick = () => closePR(t.id);
  if ($("#reply")) $("#reply").onsubmit = (e) => { e.preventDefault(); const i = $("#reply input"); if (i.value.trim()) { reply(t.id, i.value.trim()); i.value = ""; } };
  // restore what the poll would otherwise have wiped
  if (keep) { const ni = $("#reply input"); if (ni) { ni.value = keep.val; if (keep.foc) { ni.focus(); try { ni.setSelectionRange(keep.s, keep.e); } catch {} } } }
  if (mainScroll != null) { const m = $(".iss-main"); if (m) m.scrollTop = mainScroll; }
  renderLog(openId);
}

function pushLog(id, kind, text) {
  const arr = logs.get(id) || []; const last = arr[arr.length - 1];
  if (last && last.kind === kind && (kind === "message" || kind === "thought")) last.text += text;
  else arr.push({ kind, text });
  logs.set(id, arr); renderLog(id);
}
function renderLog(id) {
  const el = $("#iss-log"); if (!el || openId !== id) return;
  el.innerHTML = (logs.get(id) || []).map((l) => `<div class="${l.kind}">${esc(l.text)}</div>`).join("");
  el.scrollTop = el.scrollHeight;
}

// ---------------- actions ----------------
async function startTicket(id) {
  const t = T(id); if (!t) return;
  t.status = "doing"; if (openId !== id) openIssue(id); else renderIssue(); render();
  logs.set(id, []); pushLog(id, "status", "planning the crew…");
  try {
    const crew = await api("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    t.crew = crew.specialists || []; renderIssue();
    pushLog(id, "status", `${(t.crew[0] || {}).name || "agent"} taking the ticket…`);
  } catch (e) { pushLog(id, "error", "planner failed: " + e); return; }
  stream(`/api/run?id=${id}`, id);
}
function reply(id, text) { pushLog(id, "status", "↪ " + text); stream(`/api/reply?id=${id}&text=${encodeURIComponent(text)}`, id); }
async function closePR(id) { await api("/api/pr/close", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); loadAll(); }
async function setStatus(id, status) { await api(`/api/tickets/${id}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }); await loadAll(); }
async function spinPreview(id) {
  const btn = $("#preview-btn"); if (btn) { btn.textContent = "⏳ starting preview…"; btn.disabled = true; }
  try { const r = await api("/api/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); if (r.url) window.open(r.url, "_blank"); }
  finally { await loadAll(); }
}

function stream(url, id) {
  if (es) es.close();
  es = new EventSource(url);
  streamingId = id;
  es.onmessage = async (ev) => {
    const e = JSON.parse(ev.data);
    if (e.kind === "end") { es.close(); streamingId = null; return; }
    if (e.kind === "ticket") { await loadAll(); return; }
    if (e.kind === "error") { es.close(); streamingId = null; pushLog(id, "error", e.text); return; }
    if (e.kind === "done") return;
    if (e.text) pushLog(id, e.kind, e.text);
  };
  es.onerror = () => { es.close(); streamingId = null; loadAll(); }; // dropped stream → resync from server truth
}

// ---------------- create + attachments ----------------
function readImage(file) { return new Promise((res) => { const r = new FileReader(); r.onload = () => res({ name: file.name || "pasted.png", dataUrl: r.result }); r.readAsDataURL(file); }); }
function renderCreateThumbs() { $("#c-thumbs").innerHTML = createAtts.map((a) => `<img src="${a.dataUrl}" alt="Thumbnail preview" />`).join(""); }

async function addFiles(files, target) {
  for (const f of files) {
    if (!f.type?.startsWith("image/")) continue;
    const att = await readImage(f);
    if (target === "create") { createAtts.push(att); renderCreateThumbs(); }
    else { await fetch(`/api/tickets/${target}/attach`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(att) }); await loadAll(); }
  }
}

function showCreate(v) { $("#create-modal").hidden = !v; $("#create-scrim").hidden = !v; if (v) { createAtts = []; renderCreateThumbs(); $("#c-title").value = ""; $("#c-desc").value = ""; $("#c-title").focus(); } }
$("#create-btn").onclick = () => showCreate(true);
$("#c-cancel").onclick = () => showCreate(false);
$("#create-scrim").onclick = () => showCreate(false);
$("#c-file").onchange = (e) => addFiles(e.target.files, "create");
const drop = $("#c-drop");
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); addFiles(e.dataTransfer.files, "create"); };
$("#create-modal").onsubmit = async (e) => {
  e.preventDefault();
  const title = $("#c-title").value.trim(); if (!title) return;
  await api("/api/tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, type: $("#c-type").value, priority: $("#c-priority").value, description: $("#c-desc").value.trim(), attachments: createAtts }) });
  showCreate(false); loadAll();
};

// global paste → attach to whichever modal is open
document.addEventListener("paste", (e) => {
  const imgs = [...(e.clipboardData?.items || [])].filter((i) => i.type.startsWith("image/")).map((i) => i.getAsFile());
  if (!imgs.length) return;
  if (!$("#create-modal").hidden) addFiles(imgs, "create");
  else if (openId) addFiles(imgs, openId);
});

// nav + scrim
$("#nav").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { view = b.dataset.view; render(); } });
$("#scrim").onclick = closeIssue;

// boot
await loadAll();
// backstop: if a run is in-flight, poll so the card converges even if the SSE stream dropped
setInterval(() => { if (tickets.some((t) => t.status === "doing")) loadAll(); }, 8000);
const qp = new URLSearchParams(location.search).get("ticket");
if (qp && T(qp)) openIssue(qp);


// --- Theme State Coordinator ---
const themeBtn = $("#theme-toggle");
const themeIcon = $(".theme-icon", themeBtn);
const themeText = $(".theme-text", themeBtn);

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  if (themeIcon) {
    themeIcon.textContent = theme === "light" ? "☀️" : "🌙";
  }
  if (themeText) {
    themeText.textContent = theme === "light" ? "Light Mode" : "Dark Mode";
  }
}

// Initial sync of toggle icon
const currentTheme = document.documentElement.getAttribute("data-theme") || "light";
applyTheme(currentTheme);

if (themeBtn) {
  themeBtn.onclick = () => {
    const nextTheme = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    localStorage.setItem("pulse-theme", nextTheme);
    applyTheme(nextTheme);
  };
}

// Listen to system preference changes
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
  if (!localStorage.getItem("pulse-theme")) {
    applyTheme(e.matches ? "dark" : "light");
  }
});
