import { RuleResult, ValidationReport } from "../types.js";
import { PASS_SCORE_THRESHOLD } from "../constants.js";

const SEVERITY_PENALTY: Record<string, number> = {
  error: 25,
  warning: 10,
  info: 0,
};

/**
 * Aggregate rule results into a 0-100 score.
 * Each error deducts 25 points, each warning deducts 10.
 * Score >= 70 → pass.
 */
export function calculateScore(ruleResults: RuleResult[]): ValidationReport {
  let score = 100;

  for (const result of ruleResults) {
    score -= SEVERITY_PENALTY[result.severity] ?? 0;
  }

  score = Math.max(0, Math.min(100, score));

  return {
    score,
    pass: score >= PASS_SCORE_THRESHOLD,
    ruleResults,
  };
}
