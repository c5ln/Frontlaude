/**
 * Centralised, environment-variable-backed configuration.
 *
 * Every threshold can be overridden via a VV_* env var.
 * Example (Claude Code ~/.claude.json):
 *   "env": { "VV_ALIGNMENT_WARNING_RATIO": "0.65", "VV_CNN_THRESHOLD": "0.4" }
 */

function env(key: string, defaultVal: number): number {
  const v = process.env[key];
  if (!v) return defaultVal;
  const n = parseFloat(v);
  return isNaN(n) ? defaultVal : n;
}

function envBool(key: string, defaultVal: boolean): boolean {
  const v = process.env[key];
  if (!v) return defaultVal;
  return v.toLowerCase() !== "false" && v !== "0";
}

export const config = {
  // ── Capture ────────────────────────────────────────────────────────────────
  pageLoadTimeoutMs: env("VV_PAGE_LOAD_TIMEOUT_MS", 30_000),
  captureTimeoutMs:  env("VV_CAPTURE_TIMEOUT_MS",   30_000),

  // ── CNN ────────────────────────────────────────────────────────────────────
  cnn: {
    enabled:   envBool("VV_CNN_ENABLED", true),
    threshold: env("VV_CNN_THRESHOLD", 0.5),
  },

  // ── Rule: empty_state ──────────────────────────────────────────────────────
  emptyState: {
    stdDevError:       env("VV_EMPTY_STDDEV_ERROR",        10),
    stdDevWarning:     env("VV_EMPTY_STDDEV_WARNING",      20),
    whiteRatioError:   env("VV_EMPTY_WHITE_RATIO_ERROR",  0.97),
    whiteRatioWarning: env("VV_EMPTY_WHITE_RATIO_WARNING", 0.90),
  },

  // ── Rule: alignment ────────────────────────────────────────────────────────
  alignment: {
    errorRatio:    env("VV_ALIGNMENT_ERROR_RATIO",    0.55),
    warningRatio:  env("VV_ALIGNMENT_WARNING_RATIO",  0.70),
    peakTolerance: env("VV_ALIGNMENT_PEAK_TOLERANCE", 12),
    minPeakDistance: env("VV_ALIGNMENT_PEAK_MIN_DIST", 20),
  },

  // ── Rule: color_contrast ───────────────────────────────────────────────────
  colorContrast: {
    failRatioError:   env("VV_CONTRAST_FAIL_RATIO_ERROR",   0.25),
    failRatioWarning: env("VV_CONTRAST_FAIL_RATIO_WARNING", 0.10),
    minLuminanceRange: env("VV_CONTRAST_MIN_RANGE", 0.06),
  },

  // ── Rule: spacing ──────────────────────────────────────────────────────────
  spacing: {
    cvError:    env("VV_SPACING_CV_ERROR",    0.90),
    cvWarning:  env("VV_SPACING_CV_WARNING",  0.55),
    minGapPx:   env("VV_SPACING_MIN_GAP_PX",  3),
    minGaps:    env("VV_SPACING_MIN_GAPS",     4),
    contentThreshold: env("VV_SPACING_CONTENT_THRESHOLD", 225),
  },

  // ── Rule: overflow ─────────────────────────────────────────────────────────
  overflow: {
    densityError:   env("VV_OVERFLOW_DENSITY_ERROR",   0.18),
    densityWarning: env("VV_OVERFLOW_DENSITY_WARNING", 0.10),
    stripPx:        env("VV_OVERFLOW_STRIP_PX", 6),
  },

  // ── Rule: whitespace ───────────────────────────────────────────────────────
  whitespace: {
    ratioError:        env("VV_WHITESPACE_RATIO_ERROR",        0.93),
    ratioWarning:      env("VV_WHITESPACE_RATIO_WARNING",      0.82),
    imbalanceError:    env("VV_WHITESPACE_IMBALANCE_ERROR",    0.55),
    imbalanceWarning:  env("VV_WHITESPACE_IMBALANCE_WARNING",  0.30),
    bgThreshold:       env("VV_WHITESPACE_BG_THRESHOLD",      238),
  },

  // ── Scoring ────────────────────────────────────────────────────────────────
  scoring: {
    passThreshold:  env("VV_PASS_THRESHOLD", 70),
    errorPenalty:   env("VV_ERROR_PENALTY",  25),
    warningPenalty: env("VV_WARNING_PENALTY", 10),
  },
};
