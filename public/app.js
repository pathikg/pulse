const $ = (s, r = document) => r.querySelector(s);
const cols = { todo: $("#todo"), doing: $("#doing"), done: $("#done") };
const PR_RE = /https:\/\/github\.com\/[^\s"'`)]+\/pull\/\d+/;

// --- add ticket ---
$("#new").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = $("#ticket").value.trim();
  if (!t) return;
  addCard(t);
  $("#ticket").value = "";
});

function addCard(title) {
  const node = $("#card-tpl").content.firstElementChild.cloneNode(true);
  $(".card-title", node).textContent = title;
  node._title = title;
  $(".move", node).addEventListener("click", () => start(node));
  $(".steer", node).addEventListener("submit", (e) => {
    e.preventDefault();
    const inp = $(".steer input", node);
    if (inp.value.trim()) { steer(node, inp.value.trim()); inp.value = ""; }
  });
  cols.todo.prepend(node);
}

// --- move to In Progress → plan → run ---
async function start(node) {
  node.classList.add("running");
  cols.doing.prepend(node);
  const log = $(".log", node);
  log.classList.add("on");

  line(log, "status", "planning the crew…");
  let crew;
  try {
    crew = await (await fetch("/api/plan", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket: node._title }),
    })).json();
  } catch (e) { return line(log, "error", "planner failed: " + e); }

  renderCrew(node, crew.specialists || []);
  const lead = (crew.specialists || [])[0] || {};
  line(log, "status", `${lead.name || "agent"} taking the ticket…`);

  stream(`/api/run?ticket=${encodeURIComponent(node._title)}&specialist=${encodeURIComponent(JSON.stringify(lead))}`,
    node, () => { $(".steer", node).hidden = false; });
}

function steer(node, text) {
  const log = $(".log", node);
  line(log, "status", "↪ steering: " + text);
  stream(`/api/followup?input=${encodeURIComponent(text)}`, node, null);
}

// --- SSE stream → log ---
function stream(url, node, onEnd) {
  const log = $(".log", node);
  const es = new EventSource(url);
  es.onmessage = (ev) => {
    const e = JSON.parse(ev.data);
    if (e.kind === "end") { es.close(); node.classList.remove("running"); node.classList.add("done"); cols.done.prepend(node); onEnd?.(); return; }
    if (e.kind === "error") { es.close(); line(log, "error", e.text); return; }
    if (e.kind === "done") return;
    if (e.text) { line(log, e.kind, e.text); detectPR(node, e.text); }
    log.scrollTop = log.scrollHeight;
  };
  es.onerror = () => es.close();
}

// merge consecutive streaming text (message/thought); discrete lines otherwise
function line(log, kind, text) {
  const last = log.lastElementChild;
  if (last && last.dataset.kind === kind && (kind === "message" || kind === "thought")) {
    last.textContent += text;
  } else {
    const div = document.createElement("div");
    div.className = kind; div.dataset.kind = kind; div.textContent = text;
    log.appendChild(div);
  }
}

function renderCrew(node, specialists) {
  const c = $(".crew", node);
  c.innerHTML = "";
  specialists.forEach((s, i) => {
    const chip = document.createElement("span");
    chip.className = "chip" + (i === 0 ? " lead" : "");
    chip.textContent = s.name;
    chip.title = `${s.role}\n${s.responsibilities}` + (s.why ? `\n— ${s.why}` : "");
    c.appendChild(chip);
  });
}

function detectPR(node, text) {
  if (node._pr) return;
  const m = text.match(PR_RE);
  if (m) {
    node._pr = m[0];
    const a = document.createElement("a");
    a.href = m[0]; a.target = "_blank"; a.textContent = "#" + m[0].split("/").pop();
    $(".pr", node).appendChild(a);
  }
}

// seed two demo tickets for the creativity contrast
["Add OAuth login", "Optimize the PostgreSQL queries"].forEach(addCard);
