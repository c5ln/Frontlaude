import { RuleResult, ValidationReport } from "../types.js";
import { config } from "../config.js";

/**
 * Aggregate rule results into a 0-100 score.
 * Penalties and pass threshold are configurable via config / env vars.
 */
export function calculateScore(ruleResults: RuleResult[]): ValidationReport {
  const { errorPenalty, warningPenalty, passThreshold } = config.scoring;

  const severityPenalty: Record<string, number> = {
    error:   errorPenalty,
    warning: warningPenalty,
    info:    0,
  };

  let score = 100;
  for (const result of ruleResults) {
    score -= severityPenalty[result.severity] ?? 0;
  }
  score = Math.max(0, Math.min(100, score));

  return {
    score,
    pass: score >= passThreshold,
    ruleResults,
  };
}
