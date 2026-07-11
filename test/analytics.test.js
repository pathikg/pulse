import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

test("Analytics and Scaling Formatters Test Suite", async (t) => {
  await t.test("app.js uses millions formatter for total tokens and charts", () => {
    const appPath = path.join(process.cwd(), "public/app.js");
    const content = fs.readFileSync(appPath, "utf8");
    
    // Validate unit formatting changed from 'k' (divided by 1000) to 'M' (divided by 1000000)
    assert.ok(content.includes("/ 1000000") || content.includes("/ 1e6"), "Should divide by millions");
    assert.ok(content.includes('"M"') || content.includes("'M'") || content.includes("`M`"), "Should format with millions label 'M'");
  });
});
