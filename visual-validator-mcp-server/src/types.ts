// ─── Viewport ────────────────────────────────────────────────────────────────

export interface Viewport {
  width: number;
  height: number;
}

// ─── Capture ─────────────────────────────────────────────────────────────────

export interface CaptureOptions {
  url: string;
  viewport?: Viewport;
  fullPage?: boolean;
  waitFor?: string;   // CSS selector to wait for before capture
  selector?: string;  // capture a specific element only
}

export interface CaptureResult {
  screenshot: string;  // base64 PNG
  metadata: {
    url: string;
    viewport: Viewport;
    timestamp: string;
    selector?: string;
  };
}

// ─── Rule Engine (Phase 2+) ───────────────────────────────────────────────────

export type Severity = "error" | "warning" | "info";

export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RuleResult {
  rule: string;
  severity: Severity;
  message: string;
  affectedRegions: BoundingBox[];
  details: Record<string, unknown>;
}

// ─── CNN (Phase 3+) ──────────────────────────────────────────────────────────

export interface CNNResult {
  anomalyScore: number;
  anomalyRegions: Array<BoundingBox & { confidence: number }>;
  qualityClass: "good" | "acceptable" | "poor";
}

// ─── Validation Report (Phase 2+) ────────────────────────────────────────────

export interface ValidationReport {
  score: number;
  pass: boolean;
  ruleResults: RuleResult[];
  cnnResults?: CNNResult;
}

export interface ValidateAndCaptureResult {
  screenshot: string;
  timestamp: string;
  viewport: Viewport;
  validation: ValidationReport;
}

// ─── Diff (Phase 4+) ─────────────────────────────────────────────────────────

export interface DiffRegion extends BoundingBox {
  diffScore: number;
}

export interface CompareResult {
  screenshots: { a: string; b: string };
  diffImage: string;
  diffPercentage: number;
  changedRegions: DiffRegion[];
}
