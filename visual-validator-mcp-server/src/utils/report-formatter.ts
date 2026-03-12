import { ValidateAndCaptureResult, RuleResult } from "../types.js";

const SEVERITY_ICON: Record<string, string> = {
  error: "❌",
  warning: "⚠️",
  info: "✅",
};

export function formatMarkdown(result: ValidateAndCaptureResult): string {
  const { validation, metadata } = result as ValidateAndCaptureResult & {
    metadata: { url: string; viewport: { width: number; height: number }; timestamp: string };
  };

  const passLabel = validation.pass ? "**PASS ✅**" : "**FAIL ❌**";
  const lines: string[] = [
    `## UI Validation Report`,
    ``,
    `| Field | Value |`,
    `|-------|-------|`,
    `| URL | \`${(result as any).metadata?.url ?? "—"}\` |`,
    `| Score | **${validation.score}/100** ${passLabel} |`,
    `| Timestamp | ${(result as any).metadata?.timestamp ?? result.timestamp} |`,
    `| Viewport | ${result.viewport.width}×${result.viewport.height} |`,
    ``,
    `### Rule Results`,
    ``,
  ];

  for (const r of validation.ruleResults) {
    lines.push(formatRuleResult(r));
  }

  if (validation.cnnResults) {
    const cnn = validation.cnnResults;
    lines.push(``, `### CNN Analysis`, ``);
    lines.push(`- Quality: **${cnn.qualityClass}**`);
    lines.push(`- Anomaly score: ${(cnn.anomalyScore * 100).toFixed(0)}%`);
    if (cnn.anomalyRegions.length > 0) {
      lines.push(`- Anomaly regions: ${cnn.anomalyRegions.length}`);
    }
  }

  return lines.join("\n");
}

function formatRuleResult(r: RuleResult): string {
  const icon = SEVERITY_ICON[r.severity] ?? "ℹ️";
  const regionInfo =
    r.affectedRegions.length > 0
      ? ` _(${r.affectedRegions.length} region${r.affectedRegions.length > 1 ? "s" : ""})_`
      : "";
  return `${icon} **${r.rule}**: ${r.message}${regionInfo}`;
}
