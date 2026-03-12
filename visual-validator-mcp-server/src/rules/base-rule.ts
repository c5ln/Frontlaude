import { RuleResult, Severity, BoundingBox } from "../types.js";

export interface BaseRule {
  readonly id: string;
  readonly description: string;
  run(pngBuffer: Buffer): Promise<RuleResult>;
}

// ─── Result factory helpers ───────────────────────────────────────────────────

export function makeResult(
  rule: string,
  severity: Severity,
  message: string,
  details: Record<string, unknown> = {},
  affectedRegions: BoundingBox[] = []
): RuleResult {
  return { rule, severity, message, affectedRegions, details };
}

export const pass = (rule: string, message: string, details?: Record<string, unknown>): RuleResult =>
  makeResult(rule, "info", message, details ?? {});

export const warn = (
  rule: string,
  message: string,
  details?: Record<string, unknown>,
  regions?: BoundingBox[]
): RuleResult => makeResult(rule, "warning", message, details ?? {}, regions ?? []);

export const error = (
  rule: string,
  message: string,
  details?: Record<string, unknown>,
  regions?: BoundingBox[]
): RuleResult => makeResult(rule, "error", message, details ?? {}, regions ?? []);
