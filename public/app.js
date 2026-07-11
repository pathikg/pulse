// helper selectors
const $ = (s, ctx = document) => ctx.querySelector(s);
const $$ = (s, ctx = document) => Array.from(ctx.querySelectorAll(s));

let view = "board"; // "board" | "runs" | "analytics"
let tickets = [];
let runs = [];
let activeTicketId = null;
let uploadQueue = [];

// API methods
const api = {
  async getTickets() { return (await fetch("/api/tickets")).json(); },
  async createTicket(t) {
    return (await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(t)
    })).json();
  },
  async getTicket(id) { return (await fetch(`/api/tickets/${id}`)).json(); },
  async updateTicket(id, patches) {
    return (await fetch(`/api/tickets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patches)
    })).json();
  },
  async addComment(id, c) {
    return (await fetch(`/api/tickets/${id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(c)
    })).json();
  },
  async startAgent(id) {
    return (await fetch(`/api/tickets/${id}/run`, { method: "POST" })).json();
  },
  async getRuns() { return (await fetch("/api/runs")).json(); },
  async reindex() { return (await fetch("/api/reindex", { method: "POST" })).json(); },
  async upload(formData) {
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    return res.json();
  }
};

// UI helpers
const T = (id) => tickets.find((t) => t.id === id);

function render() {
  // Sync view tabs
  $$("#nav button").forEach((b) => {
    const active = b.dataset.view === view;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", active ? "true" : "false");
  });

  // Sync view panels
  $$(".views .view").forEach((p) => {
    p.hidden = p.id !== `view-${view}`;
  });

  if (view === "board") renderBoard();
  if (view === "runs") renderRuns();
  if (view === "analytics") renderAnalytics();
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

// Issue detail drawer
async function openIssue(id) {
  activeTicketId = id;
  const t = T(id);
  if (!t) return;

  const container = $("#issue");
  const scrim = $("#scrim");
  if (!container || !scrim) return;

  scrim.hidden = false;
  container.hidden = false;
  document.body.classList.add("modal-open");

  container.innerHTML = `
    <div class="iss-container">
      <header class="iss-hdr">
        <span class="iss-k">${t.key}</span>
        <button class="close-btn" id="iss-close" aria-label="Close panel">✕</button>
      </header>
      <div class="iss-main">
        <div class="iss-content">
          <h1 id="iss-title">${escapeHTML(t.title)}</h1>
          <div class="iss-desc">
            ${t.description ? formatMarkdown(t.description) : "<p class='empty-text'>No description provided.</p>"}
          </div>

          ${t.attachments && t.attachments.length > 0 ? `
            <div class="iss-attachments">
              <h3>Attachments</h3>
              <div class="thumbs">
                ${t.attachments.map(att => `
                  <a href="${att.url}" target="_blank" class="thumb-link">
                    <img src="${att.url}" alt="Attachment" class="thumb" />
                  </a>
                `).join("")}
              </div>
            </div>
          ` : ""}

          <div class="iss-discussion">
            <h2>Discussion Thread</h2>
            <div class="comments" id="comments-box">
              ${(t.comments || []).map(renderComment).join("")}
            </div>
            
            <form class="comment-compose" id="comment-form">
              <textarea id="comment-text" rows="3" placeholder="Add a comment, or ask agent a question..." required></textarea>
              <div class="compose-actions">
                <button type="submit" class="primary">Comment</button>
              </div>
            </form>
          </div>
        </div>

        <aside class="iss-rail">
          <div class="sec">
            <span class="sec-t">Status</span>
            <div class="fld">
              <select id="iss-status">
                <option value="todo" ${t.status === "todo" ? "selected" : ""}>Todo</option>
                <option value="doing" ${t.status === "doing" ? "selected" : ""}>In Progress</option>
                <option value="review" ${t.status === "review" ? "selected" : ""}>Review</option>
                <option value="done" ${t.status === "done" ? "selected" : ""}>Done</option>
              </select>
            </div>
          </div>

          <div class="sec">
            <span class="sec-t">Agent Workspace</span>
            <div class="agent-box">
              ${t.status === "todo" ? `
                <button id="launch-agent-btn" class="primary launch-btn">
                  <span>🚀</span> Launch Specialist Crew
                </button>
              ` : ""}
              ${t.status === "doing" ? `
                <div class="agent-row active">
                  <span class="avatar animated">🤖</span>
                  <div class="agent-meta">
                    <strong>Crew is executing...</strong>
                    <span>Autonomous pipeline active</span>
                  </div>
                </div>
              ` : ""}
              ${t.status === "review" || t.status === "done" ? `
                <div class="agent-row success">
                  <span class="avatar">✅</span>
                  <div class="agent-meta">
                    <strong>Crew execution finished</strong>
                    <span>Build checks passed</span>
                  </div>
                </div>
              ` : ""}
            </div>
          </div>

          <div class="sec">
            <span class="sec-t">Details</span>
            <div class="rail-details">
              <div class="rail-row">
                <span class="rl-l">Type</span>
                <span class="rl-v">${t.type === "bug" ? "🐞 Bug" : "✨ Feature"}</span>
              </div>
              <div class="rail-row">
                <span class="rl-l">Priority</span>
                <span class="rl-v" style="text-transform: capitalize;">${t.priority}</span>
              </div>
              <div class="rail-row">
                <span class="rl-l">Assignee</span>
                <span class="rl-v">
                  <span class="who">
                    <span class="avatar">${t.assignee[0].toUpperCase()}</span>
                    <span>${t.assignee}</span>
                  </span>
                </span>
              </div>
              <div class="rail-row">
                <span class="rl-l">Reporter</span>
                <span class="rl-v">
                  <span class="who">
                    <span class="avatar">${t.reporter[0].toUpperCase()}</span>
                    <span>${t.reporter}</span>
                  </span>
                </span>
              </div>
              ${t.prNumber ? `
                <div class="rail-row">
                  <span class="rl-l">Pull Request</span>
                  <span class="rl-v"><a href="https://github.com/pathikg/pulse/pull/${t.prNumber}" target="_blank" class="pr-link">#${t.prNumber} ↗</a></span>
                </div>
              ` : ""}
            </div>
          </div>
        </aside>
      </div>
    </div>
  `;

  // Attach drawer actions
  $("#iss-close").onclick = closeIssue;

  const statusSel = $("#iss-status");
  statusSel.onchange = async () => {
    const oldStatus = t.status;
    const nextStatus = statusSel.value;
    await api.updateTicket(t.id, { status: nextStatus });
    await loadAll();
    // If transitioning from Todo to Doing, trigger agent run
    if (oldStatus === "todo" && nextStatus === "doing") {
      api.startAgent(t.id).catch(console.error);
    }
    openIssue(t.id); // reload drawer
  };

  const launchBtn = $("#launch-agent-btn");
  if (launchBtn) {
    launchBtn.onclick = async () => {
      launchBtn.disabled = true;
      launchBtn.innerHTML = "<span>⚙️</span> Deploying crew...";
      await api.updateTicket(t.id, { status: "doing" });
      await loadAll();
      api.startAgent(t.id).catch(console.error);
      openIssue(t.id);
    };
  }

  const commentForm = $("#comment-form");
  commentForm.onsubmit = async (e) => {
    e.preventDefault();
    const textEl = $("#comment-text");
    const text = textEl.value.trim();
    if (!text) return;

    await api.addComment(t.id, { author: "pathik", kind: "user", text });
    textEl.value = "";
    await loadAll();
    openIssue(t.id);
  };

  // Setup Server-Sent Events for run output if doing
  if (t.status === "doing") {
    setupRunStream(t.id);
  }
}

function closeIssue() {
  $("#issue").hidden = true;
  $("#scrim").hidden = true;
  document.body.classList.remove("modal-open");
  activeTicketId = null;
  // Clear SSE stream if any
  if (window.activeEventSource) {
    window.activeEventSource.close();
    window.activeEventSource = null;
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
