// helper selectors
const $ = (s, ctx = document) => ctx.querySelector(s);
const $$ = (s, ctx = document) => Array.from(ctx.querySelectorAll(s));

let view = "board"; // "board" | "runs" | "analytics"
let tickets = [];
let runs = [];
let activeTicketId = null;
let uploadQueue = [];

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
  // Sync view tabs
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

function renderBoard() {
  const container = $("#view-board");
  if (!container) return;

  const cols = {
    todo: { t: "Todo", items: [] },
    doing: { t: "In Progress", items: [] },
    review: { t: "Review", items: [] },
    done: { t: "Done", items: [] }
  };

  tickets.forEach((t) => {
    if (cols[t.status]) cols[t.status].items.push(t);
  });

  container.innerHTML = `
    <div class="board">
      ${Object.entries(cols).map(([id, col]) => `
        <div class="column" id="col-${id}">
          <header class="col-hdr">
            <h2>${col.t}</h2>
            <span class="count">${col.items.length}</span>
          </header>
          <div class="cards" data-status="${id}">
            ${col.items.map(renderCard).join("")}
          </div>
        </div>
      `).join("")}
    </div>
  `;

  // Attach card event listeners
  $$(".card", container).forEach((card) => {
    card.onclick = () => openIssue(card.dataset.id);
  });
}

function renderCard(t) {
  const commentCount = t.comments ? t.comments.length : 0;
  const showMeta = commentCount > 0 || (t.attachments && t.attachments.length > 0) || t.prNumber;
  const isBug = t.type === "bug";

  return `
    <article class="card" data-id="${t.id}" tabindex="0" role="button">
      <div class="card-top">
        <span class="flag ${isBug ? "bug" : "feat"}">${isBug ? "🐞 Bug" : "✨ Feature"}</span>
        <span class="key">${t.key}</span>
        <span class="prio ${t.priority}" title="Priority: ${t.priority}"></span>
      </div>
      <h3 class="card-title">${escapeHTML(t.title)}</h3>
      ${showMeta ? `
        <div class="card-meta">
          ${t.prNumber ? `<span class="badge pr">#${t.prNumber}</span>` : ""}
          ${t.status === "doing" ? `<span class="badge run">running</span>` : ""}
          ${t.status === "review" && !t.prNumber ? `<span class="badge wait">waiting</span>` : ""}
          <div class="avatars">
            ${t.assignee ? `<span class="avatar" title="Assignee: ${t.assignee}">${t.assignee[0].toUpperCase()}</span>` : ""}
          </div>
        </div>
      ` : ""}
    </article>
  `;
}

function renderRuns() {
  const container = $("#view-runs");
  if (!container) return;

  if (runs.length === 0) {
    container.innerHTML = `
      <div class="empty-runs">
        <div class="icon">🛸</div>
        <h3>No activity yet</h3>
        <p>Runs are launched automatically when tickets move to "In Progress".</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="runs-list">
      <header class="runs-hdr">
        <h1>Agent Run History</h1>
        <button id="reindex-btn" class="secondary">Re-index Repo Wiki</button>
      </header>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Tokens</th>
              <th>PR</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            ${runs.map((r) => {
              const ticket = tickets.find(t => t.key === r.ticketKey);
              const prLink = ticket && ticket.prNumber 
                ? `<a href="https://github.com/pathikg/pulse/pull/${ticket.prNumber}" target="_blank">#${ticket.prNumber}</a>` 
                : "—";
              return `
                <tr>
                  <td>
                    <div class="ticket-link" data-id="${ticket?.id || ""}">
                      <strong>${r.ticketKey}</strong>
                      <span>${escapeHTML(r.ticketTitle)}</span>
                    </div>
                  </td>
                  <td><span class="status-pill ${r.status}">${r.status}</span></td>
                  <td>${r.durationMs ? `${(r.durationMs/1000).toFixed(1)}s` : "—"}</td>
                  <td>${r.usage?.total_tokens ? r.usage.total_tokens.toLocaleString() : "—"}</td>
                  <td>${prLink}</td>
                  <td>${new Date(r.ts).toLocaleString()}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Attach row click listeners to view the tickets
  $$(".ticket-link", container).forEach((link) => {
    link.onclick = (e) => {
      const id = link.dataset.id;
      if (id) openIssue(id);
    };
  });

  const reindexBtn = $("#reindex-btn");
  if (reindexBtn) {
    reindexBtn.onclick = async () => {
      reindexBtn.disabled = true;
      reindexBtn.textContent = "Indexing...";
      try {
        await api.reindex();
        alert("Wiki index rebuilt successfully.");
      } catch (err) {
        alert("Index rebuild failed: " + err.message);
      } finally {
        reindexBtn.disabled = false;
        reindexBtn.textContent = "Re-index Repo Wiki";
      }
    };
  }
}

function renderAnalytics() {
  const container = $("#view-analytics");
  if (!container) return;

  const total = tickets.length;
  const done = tickets.filter(t => t.status === "done").length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const tokenSum = runs.reduce((acc, r) => acc + (r.usage?.total_tokens || 0), 0);

  container.innerHTML = `
    <div class="analytics">
      <h1>Dashboard Metrics</h1>
      <div class="metrics-grid">
        <div class="metric-card">
          <span class="m-val">${percent}%</span>
          <span class="m-lbl">Autonomy Complete</span>
        </div>
        <div class="metric-card">
          <span class="m-val">${tickets.filter(t => t.status === "doing").length}</span>
          <span class="m-lbl">Active Agents</span>
        </div>
        <div class="metric-card">
          <span class="m-val">${tokenSum.toLocaleString()}</span>
          <span class="m-lbl">Tokens Consumed</span>
        </div>
        <div class="metric-card">
          <span class="m-val">${runs.length}</span>
          <span class="m-lbl">Total Executed Runs</span>
        </div>
      </div>

      <div class="charts">
        <div class="chart-box">
          <h3>Ticket Pipeline</h3>
          <div class="bar-chart">
            ${["todo", "doing", "review", "done"].map((status) => {
              const count = tickets.filter(t => t.status === status).length;
              const max = Math.max(...["todo", "doing", "review", "done"].map(s => tickets.filter(t => t.status === s).length), 1);
              const height = (count / max) * 100;
              return `
                <div class="bar-col">
                  <div class="bar" style="height: ${height}%"></div>
                  <span class="bar-lbl">${status}</span>
                  <span class="bar-val">${count}</span>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      </div>
    </div>
  `;
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

function renderComment(c) {
  const isAgent = c.kind === "agent";
  const icon = isAgent ? "🤖" : c.kind === "system" ? "⚙️" : "👤";
  const label = isAgent ? "Agent Crew" : c.kind === "system" ? "System" : c.author;

  return `
    <div class="comment ${c.kind}">
      <header class="c-hdr">
        <span class="avatar">${icon}</span>
        <span class="c-who">${label}</span>
        <span class="c-time">${new Date(c.ts).toLocaleTimeString()}</span>
      </header>
      <div class="c-body">
        ${formatMarkdown(c.text)}
      </div>
    </div>
  `;
}

function setupRunStream(ticketId) {
  if (window.activeEventSource) {
    window.activeEventSource.close();
  }

  // Prepend stream target log element if not existing
  const discussionBox = $(".iss-discussion");
  if (!discussionBox) return;

  let logEl = $("#active-run-log");
  if (!logEl) {
    const logWrapper = document.createElement("div");
    logWrapper.className = "active-run-wrapper";
    logWrapper.innerHTML = `
      <h3>Autonomous Agent Logs</h3>
      <div class="log" id="active-run-log"></div>
    `;
    discussionBox.insertBefore(logWrapper, discussionBox.firstChild);
    logEl = $("#active-run-log");
  }

  const es = new EventSource(`/api/tickets/${ticketId}/runs/stream`);
  window.activeEventSource = es;

  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.event === "done") {
        es.close();
        loadAll().then(() => {
          if (activeTicketId === ticketId) openIssue(ticketId);
        });
        return;
      }
      appendLogLine(logEl, data);
    } catch (err) {
      console.error(err);
    }
  };

  es.onerror = () => {
    es.close();
  };
}

function appendLogLine(container, event) {
  const line = document.createElement("div");
  if (event.kind === "message") {
    line.className = "thought";
    line.innerHTML = `<span>💭</span> ${escapeHTML(event.text)}`;
  } else if (event.kind === "command") {
    line.className = "command";
    line.innerHTML = `<span>$</span> <code>${escapeHTML(event.text)}</code>`;
  } else if (event.kind === "output") {
    line.className = "output";
    line.textContent = event.text;
  } else if (event.kind === "error") {
    line.className = "error";
    line.textContent = event.text;
  } else if (event.kind === "pr") {
    line.className = "pr-action";
    line.innerHTML = `<span>🚀</span> <strong>PR Created!</strong> ${escapeHTML(event.text)}`;
  } else if (event.kind === "startwork") {
    line.className = "startwork-heading";
    line.innerHTML = `<span>🛠️</span> Specialist <strong>${escapeHTML(event.text)}</strong> starts work`;
  } else {
    return;
  }
  container.appendChild(line);
  container.scrollTop = container.scrollHeight;
}

// Global Actions
const createModal = $("#create-modal");
const createScrim = $("#create-scrim");

$("#create-btn").onclick = () => {
  createModal.hidden = false;
  createScrim.hidden = false;
  document.body.classList.add("modal-open");
};

const closeCreateModal = () => {
  createModal.hidden = true;
  createScrim.hidden = true;
  document.body.classList.remove("modal-open");
  createModal.reset();
  uploadQueue = [];
  $("#c-thumbs").innerHTML = "";
};

$("#c-cancel").onclick = closeCreateModal;
createScrim.onclick = closeCreateModal;

// Attachment Handling
const dropzone = $("#c-drop");
const fileInput = $("#c-file");
const thumbsContainer = $("#c-thumbs");

if (dropzone && fileInput) {
  dropzone.ondragover = (e) => { e.preventDefault(); dropzone.classList.add("dragover"); };
  dropzone.ondragleave = () => dropzone.classList.remove("dragover");
  dropzone.ondrop = (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    handleFiles(e.dataTransfer.files);
  };
  fileInput.onchange = () => handleFiles(fileInput.files);
}

async function handleFiles(files) {
  for (const f of Array.from(files)) {
    if (!f.type.startsWith("image/")) continue;
    const fd = new FormData();
    fd.append("file", f);
    try {
      const { url } = await api.upload(fd);
      uploadQueue.push(url);
      const div = document.createElement("div");
      div.className = "thumb-wrapper";
      div.innerHTML = `
        <img src="${url}" class="thumb" />
        <button type="button" class="del" onclick="removeThumb('${url}', this)">✕</button>
      `;
      thumbsContainer.appendChild(div);
    } catch (err) {
      alert("Upload failed: " + err.message);
    }
  }
}

window.removeThumb = (url, btn) => {
  uploadQueue = uploadQueue.filter(u => u !== url);
  btn.closest(".thumb-wrapper").remove();
};

createModal.onsubmit = async (e) => {
  e.preventDefault();
  const title = $("#c-title").value.trim();
  const description = $("#c-desc").value.trim();
  const type = $("#c-type").value;
  const priority = $("#c-priority").value;

  if (!title) return;

  await api.createTicket({
    title,
    description,
    type,
    priority,
    attachments: uploadQueue.map(url => ({ url }))
  });

  closeCreateModal();
  await loadAll();
};

// Markdown & Escape helpers
function escapeHTML(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatMarkdown(src) {
  if (!src) return "";
  let html = escapeHTML(src);
  // Headers
  html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
  html = html.replace(/^## (.*$)/gim, "<h2>$1</h2>");
  html = html.replace(/^# (.*$)/gim, "<h1>$1</h1>");
  // Bold / Italic
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");
  // Code block
  html = html.replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>");
  // Inline code
  html = html.replace(/`(.*?)`/g, "<code>$1</code>");
  // Line breaks
  html = html.replace(/\n/g, "<br>");
  return html;
}

async function loadAll() {
  try {
    tickets = await api.getTickets();
    runs = await api.getRuns();
    render();
  } catch (err) {
    console.error("Failed to load initial dataset", err);
  }
}


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
