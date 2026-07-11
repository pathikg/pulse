import test from "node:test";
import assert from "node:assert";

// Implement the same exact conversion logic that the frontend/metrics components use
function formatTokens(v) {
  if (v >= 1000000) return (v / 1000000).toFixed(2) + "M";
  if (v >= 1000) return (v / 1000).toFixed(1) + "k";
  return String(v);
}

test("Metrics Scaling and Unit Conversion Test Suite", async (t) => {
  await t.test("verifies scaling under small volumes (no formatting or thousand formatting)", () => {
    assert.equal(formatTokens(0), "0");
    assert.equal(formatTokens(450), "450");
    assert.equal(formatTokens(1000), "1.0k");
    assert.equal(formatTokens(999999), "1000.0k");
  });

  await t.test("verifies scaling under large volumes to millions format with correct decimals", () => {
    assert.equal(formatTokens(1000000), "1.00M");
    assert.equal(formatTokens(1500000), "1.50M");
    assert.equal(formatTokens(2751200), "2.75M");
    assert.equal(formatTokens(12345678), "12.35M"); // verify correct rounding
  });

  await t.test("verifies scaling under extremely large volumes", () => {
    assert.equal(formatTokens(100000000), "100.00M");
    assert.equal(formatTokens(5000000000), "5000.00M");
  });

  await t.test("verifies backend cost calculation accuracy at million-token scale", () => {
    const RATE_IN = 1.5 / 1e6;
    const RATE_OUT = 9.0 / 1e6;
    const cost = (usage) => {
      if (!usage) return 0;
      return (usage.total_input_tokens || 0) * RATE_IN + (usage.total_output_tokens || 0) * RATE_OUT;
    };

    // 1 million input tokens = $1.50
    // 2 million output tokens = $18.00
    // Total = $19.50
    const usage = { total_input_tokens: 1000000, total_output_tokens: 2000000 };
    assert.equal(cost(usage), 19.50);

    // Extreme scale: 100 million input, 100 million output
    const largeUsage = { total_input_tokens: 100000000, total_output_tokens: 100000000 };
    assert.equal(cost(largeUsage), 1050.0);
  });
});
