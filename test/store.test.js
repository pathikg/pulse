import test from "node:test";
import assert from "node:assert";
import { createTicket, getTicket, addComment, updateTicket, addRun, listRuns } from "../src/store.js";

test("createTicket has the expected shape", () => {
  const t = createTicket({ title: "Test ticket", type: "bug", priority: "high" });
  assert.equal(t.type, "bug");
  assert.equal(t.priority, "high");
  assert.equal(t.status, "todo");
  assert.equal(t.reporter, "pathik");
  assert.equal(t.assignee, "antigravity");
  assert.match(t.key, /^PULSE-\d+$/);
  assert.ok(Array.isArray(t.comments));
  assert.ok(Array.isArray(t.attachments));
});

test("addComment appends to the thread", () => {
  const t = createTicket({ title: "Comment test" });
  addComment(t.id, { author: "agent", kind: "question", text: "Which limit?" });
  const got = getTicket(t.id);
  assert.equal(got.comments.length, 1);
  assert.equal(got.comments[0].kind, "question");
  assert.ok(got.comments[0].ts);
});

test("updateTicket patches fields", () => {
  const t = createTicket({ title: "Patch test" });
  updateTicket(t.id, { status: "review", prNumber: 7 });
  const got = getTicket(t.id);
  assert.equal(got.status, "review");
  assert.equal(got.prNumber, 7);
});

test("addRun saves a run and preserves token and million-unit metrics", () => {
  const run = {
    ticketId: "t1",
    key: "PULSE-1",
    title: "Test run",
    tokens: 150000,
    tokensM: 0.15,
    costUsd: 0.5,
  };
  const saved = addRun(run);
  assert.equal(saved.tokens, 150000);
  assert.equal(saved.tokensM, 0.15);
  
  const all = listRuns();
  assert.ok(all.some(r => r.id === saved.id && r.tokensM === 0.15));
});
