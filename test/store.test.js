import test from "node:test";
import assert from "node:assert";
import { createTicket, getTicket, addComment, updateTicket } from "../src/store.js";

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
