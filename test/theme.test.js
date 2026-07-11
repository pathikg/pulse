import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

test("Theme Defaults and Persistence Test Suite", async (t) => {
  await t.test("index.html initializes theme to light mode", () => {
    const htmlPath = path.join("/workspace/pulse/public/index.html");
    const content = fs.readFileSync(htmlPath, "utf8");
    
    // Validate initialization script defaults to "light" when no saved preference exists
    assert.ok(content.includes('const theme = saved || "light";'), "Theme initialization in index.html should default to 'light'");
    
    // Validate that the theme toggle element is initially styled for Light Mode
    assert.ok(content.includes('<span class="theme-icon">☀️</span>'), "Default theme icon in index.html should be sun (☀️)");
    assert.ok(content.includes('<span class="theme-text">Light Mode</span>'), "Default theme text in index.html should be 'Light Mode'");
  });

  await t.test("app.js theme coordinator defaults to light mode", () => {
    const appPath = path.join("/workspace/pulse/public/app.js");
    const content = fs.readFileSync(appPath, "utf8");
    
    // Validate that the fallback theme is 'light'
    assert.ok(content.includes('const currentTheme = document.documentElement.getAttribute("data-theme") || "light";'), "Theme coordinator in app.js should fallback to 'light'");
  });
});
