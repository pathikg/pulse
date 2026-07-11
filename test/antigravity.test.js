import test from "node:test";
import assert from "node:assert";
import { normalize } from "../src/antigravity.js";

test("normalize maps a shell command event", () => {
  const n = normalize({ event_type: "step.delta", delta: { type: "code_execution_call", arguments: { code: "ls -la" } } });
  assert.equal(n.kind, "command");
  assert.equal(n.text, "ls -la");
});

test("normalize maps model text", () => {
  const n = normalize({ event_type: "step.delta", delta: { type: "text", text: "hello" } });
  assert.equal(n.kind, "message");
  assert.equal(n.text, "hello");
});

test("normalize completed event carries sandbox handles + usage", () => {
  const n = normalize({ event_type: "interaction.completed", interaction: { id: "i1", environment_id: "e1", usage: { total_tokens: 5 } } });
  assert.equal(n.kind, "done");
  assert.equal(n.interactionId, "i1");
  assert.equal(n.environmentId, "e1");
  assert.equal(n.usage.total_tokens, 5);
});

test("normalize ignores unknown events", () => {
  assert.equal(normalize({ event_type: "something.else" }), null);
});

test("planner module exposes runPlanner", async () => {
  const m = await import("../src/planner.js");
  assert.equal(typeof m.runPlanner, "function");
});
