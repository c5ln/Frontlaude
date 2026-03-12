/**
 * CNN 추론 end-to-end 테스트
 * Run: node tests/test-cnn.mjs
 */
import sharp from "sharp";
import { CNNAnalyzer } from "../dist/cnn/analyzer.js";

async function makeTestPNG(type) {
  const width = 1280, height = 720;
  if (type === "white") {
    return sharp({ create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .png().toBuffer();
  }
  // Gradient with structured content (simulate real UI)
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      // White background with dark horizontal bars (simulate nav/cards)
      const inBar = (y > 40 && y < 80) || (y > 150 && y < 250) || (y > 300 && y < 450);
      data[i]     = inBar ? 30 : 245;
      data[i + 1] = inBar ? 50 : 245;
      data[i + 2] = inBar ? 90 : 245;
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

const analyzer = new CNNAnalyzer();
await analyzer.load();
console.log("CNN 모델 로드 완료\n");

for (const [label, type] of [["흰 화면 (빈 페이지)", "white"], ["구조화된 UI (바 포함)", "bars"]]) {
  const png = await makeTestPNG(type);
  const result = await analyzer.analyze(png, 0.5);
  console.log(`=== ${label} ===`);
  console.log(`  qualityClass : ${result.qualityClass}`);
  console.log(`  anomalyScore : ${result.anomalyScore}`);
  console.log(`  anomalyRegions: ${result.anomalyRegions.length}개`);
  console.log();
}

console.log("✓ CNN 추론 테스트 완료");
