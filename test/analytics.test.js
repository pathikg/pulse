import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

test("Analytics Scaling and Unit Test Suite", async (t) => {
  await t.test("app.js formats total tokens burned in Millions (M) instead of Thousands (k)", () => {
    const appPath = path.join(process.cwd(), "public/app.js");
    const content = fs.readFileSync(appPath, "utf8");
    
    // Validate that the old division of tokens / 1000 and "k" unit are removed
    assert.ok(!content.includes("(tokens / 1000).toFixed(1)}k"), "Should not format total tokens in thousands");
    
    // Validate that the new division of tokens / 1000000 and "M" unit are present
    assert.ok(content.includes("(tokens / 1000000).toFixed(2)}M"), "Should format total tokens in Millions (M) with 2 decimals");
  });

  await t.test("app.js formats chart values in Millions (M) instead of Thousands (k)", () => {
    const appPath = path.join(process.cwd(), "public/app.js");
    const content = fs.readFileSync(appPath, "utf8");
    
    // Validate that the old bar value threshold and "k" unit are removed
    assert.ok(!content.includes('val(d) >= 1000 ? (val(d) / 1000).toFixed(1) + "k"'), "Should not format chart bar values in thousands");
    
    // Validate that the new bar value threshold and "M" unit are present
    assert.ok(content.includes('val(d) >= 1000000 ? (val(d) / 1000000).toFixed(1) + "M"'), "Should format chart bar values in Millions (M)");
  });
});
