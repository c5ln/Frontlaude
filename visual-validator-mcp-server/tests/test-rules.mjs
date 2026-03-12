/**
 * Quick smoke test: run all 3 rules against a synthetic PNG (pure white = empty state).
 * Run with: node tests/test-rules.mjs
 */
import sharp from "sharp";
import { EmptyStateRule } from "../dist/rules/empty-state.js";
import { AlignmentRule } from "../dist/rules/alignment.js";
import { ColorContrastRule } from "../dist/rules/color-contrast.js";
import { calculateScore } from "../dist/utils/scoring.js";

// Generate a mostly-white 640x360 PNG (should trigger empty_state error)
async function makeWhitePNG() {
  return sharp({
    create: { width: 640, height: 360, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer();
}

// Generate a simple gradient PNG (has content)
async function makeGradientPNG() {
  const width = 640, height = 360;
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      data[i] = Math.round((x / width) * 255);       // R
      data[i + 1] = Math.round((y / height) * 255);  // G
      data[i + 2] = 128;                              // B
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

async function runTest(label, pngBuffer) {
  const rules = [new EmptyStateRule(), new AlignmentRule(), new ColorContrastRule()];
  const results = await Promise.all(rules.map((r) => r.run(pngBuffer)));
  const report = calculateScore(results);

  console.log(`\n=== ${label} ===`);
  console.log(`Score: ${report.score}/100  Pass: ${report.pass}`);
  for (const r of results) {
    const icon = r.severity === "error" ? "❌" : r.severity === "warning" ? "⚠️" : "✅";
    console.log(`  ${icon} [${r.rule}] ${r.message}`);
  }
}

await runTest("White (empty) PNG", await makeWhitePNG());
await runTest("Gradient PNG", await makeGradientPNG());
console.log("\n✓ All tests completed");
