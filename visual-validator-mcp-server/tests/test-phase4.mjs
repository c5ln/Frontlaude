/**
 * Phase 4 smoke test — spacing, overflow, whitespace rules + compare tool
 * Run: node tests/test-phase4.mjs
 */
import sharp from "sharp";
import { SpacingRule }    from "../dist/rules/spacing.js";
import { OverflowRule }   from "../dist/rules/overflow.js";
import { WhitespaceRule } from "../dist/rules/whitespace.js";
import { calculateScore } from "../dist/utils/scoring.js";

// ── Test image factories ──────────────────────────────────────────────────────

/** Well-spaced UI: horizontal bars with consistent gaps */
async function makeConsistentPNG() {
  const w = 640, h = 360;
  const data = Buffer.alloc(w * h * 3, 245);
  const bars = [30, 80, 130, 180, 230, 280]; // consistent 50px gaps
  for (const y0 of bars) {
    for (let y = y0; y < y0 + 20 && y < h; y++)
      for (let x = 20; x < w - 20; x++) {
        const i = (y * w + x) * 3;
        data[i] = data[i+1] = 40; data[i+2] = 80;
      }
  }
  return sharp(data, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

/** Inconsistent spacing: bars with irregular gaps */
async function makeInconsistentPNG() {
  const w = 640, h = 360;
  const data = Buffer.alloc(w * h * 3, 245);
  const bars = [10, 20, 80, 85, 200, 350]; // very uneven gaps
  for (const y0 of bars) {
    for (let y = y0; y < y0 + 15 && y < h; y++)
      for (let x = 5; x < w - 5; x++) {
        const i = (y * w + x) * 3;
        data[i] = data[i+1] = 40; data[i+2] = 80;
      }
  }
  return sharp(data, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

/** Overflow: content extends to edges */
async function makeOverflowPNG() {
  const w = 640, h = 360;
  const data = Buffer.alloc(w * h * 3, 245);
  // Draw content right at the boundary
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < 4; x++) { // left edge content
      const i = (y * w + x) * 3;
      data[i] = data[i+1] = 30; data[i+2] = 30;
    }
    for (let x = w - 4; x < w; x++) { // right edge content
      const i = (y * w + x) * 3;
      data[i] = data[i+1] = 30; data[i+2] = 30;
    }
  }
  return sharp(data, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

/** Heavy whitespace: mostly blank */
async function makeWhitespacePNG() {
  const w = 640, h = 360;
  const data = Buffer.alloc(w * h * 3, 252); // near-white
  // tiny content in one corner
  for (let y = 10; y < 30; y++)
    for (let x = 10; x < 100; x++) {
      const i = (y * w + x) * 3;
      data[i] = data[i+1] = 50; data[i+2] = 90;
    }
  return sharp(data, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

// ── Run tests ─────────────────────────────────────────────────────────────────

const cases = [
  ["일관된 간격", makeConsistentPNG,   [new SpacingRule()]],
  ["불일치 간격", makeInconsistentPNG, [new SpacingRule()]],
  ["Overflow",   makeOverflowPNG,     [new OverflowRule()]],
  ["과도한 여백", makeWhitespacePNG,   [new WhitespaceRule()]],
];

for (const [label, factory, rules] of cases) {
  const png = await factory();
  const results = await Promise.all(rules.map(r => r.run(png)));
  const report = calculateScore(results);
  console.log(`\n=== ${label} (score ${report.score}/100) ===`);
  for (const r of results) {
    const icon = r.severity === "error" ? "❌" : r.severity === "warning" ? "⚠️" : "✅";
    console.log(`  ${icon} [${r.rule}] ${r.message}`);
  }
}

console.log("\n✓ Phase 4 rule 테스트 완료");
