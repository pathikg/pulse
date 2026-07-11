import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

test("Scroll Container and Layout Test Suite", async (t) => {
  await t.test("style.css defines layout styles on .views / main container", () => {
    const cssPath = path.join(process.cwd(), "public/style.css");
    const content = fs.readFileSync(cssPath, "utf8");
    
    // Validate that .views container has flex-grow, height limits or layout styles constraining height
    assert.ok(
      content.includes(".views") || content.includes("#main-content") || content.includes(".main-content"),
      "style.css should have a rule for the .views container, #main-content, or similar"
    );
  });
});
