import * as ort from "onnxruntime-node";
import path from "path";
import { fileURLToPath } from "url";
import { CNNResult } from "../types.js";
import { CNN_INPUT_SIZE, DEFAULT_CNN_THRESHOLD } from "../constants.js";
import { imageToTensor } from "./preprocessor.js";
import { computeCAM } from "./gradcam.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MODEL_PATH = path.resolve(__dirname, "../../models/ui_quality.onnx");

const QUALITY_CLASSES = ["good", "acceptable", "poor"] as const;
type QualityClass = typeof QUALITY_CLASSES[number];

export class CNNAnalyzer {
  private session: ort.InferenceSession | null = null;
  private qualityWeights: Float32Array | null = null;  // for CAM
  private modelPath: string;
  private ready = false;

  constructor(modelPath: string = DEFAULT_MODEL_PATH) {
    this.modelPath = modelPath;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async load(): Promise<void> {
    if (this.ready) return;
    this.session = await ort.InferenceSession.create(this.modelPath, {
      executionProviders: ["cpu"],
    });
    this.ready = true;
  }

  get isReady(): boolean {
    return this.ready;
  }

  // ── Inference ──────────────────────────────────────────────────────────────

  async analyze(
    pngBuffer: Buffer,
    anomalyThreshold: number = DEFAULT_CNN_THRESHOLD
  ): Promise<CNNResult> {
    if (!this.session) throw new Error("CNNAnalyzer: call load() first");

    const tensorData = await imageToTensor(pngBuffer);
    const { width, height } = CNN_INPUT_SIZE;

    const inputTensor = new ort.Tensor("float32", tensorData, [1, 3, height, width]);
    const feeds = { input: inputTensor };

    const results = await this.session.run(feeds);

    const qualityData = results["quality"].data as Float32Array;  // [1, 3]
    const anomalyData = results["anomaly_score"].data as Float32Array;  // [1, 1]
    const featureMapData = results["feature_map"].data as Float32Array;  // [1, 1280, 7, 7]

    const anomalyScore = anomalyData[0];
    const qualityIdx = argmax(qualityData);
    const qualityClass = QUALITY_CLASSES[qualityIdx] as QualityClass;

    // Compute CAM only if anomaly detected (performance optimisation)
    let anomalyRegions: CNNResult["anomalyRegions"] = [];
    if (anomalyScore >= anomalyThreshold && this.qualityWeights) {
      // featureMapData layout: [1, C, H, W] → strip batch dim
      const fm = featureMapData.slice(0);
      const { anomalyRegions: regions } = computeCAM(
        fm,
        this.qualityWeights,
        qualityIdx,
        anomalyThreshold
      );
      anomalyRegions = regions;
    }

    return {
      anomalyScore: parseFloat(anomalyScore.toFixed(4)),
      anomalyRegions,
      qualityClass,
    };
  }

  /**
   * Extract quality head weights from the ONNX model graph for CAM.
   * Must be called after load(). Not all ONNX graphs expose weights directly —
   * if extraction fails, CAM is silently disabled (anomaly regions = []).
   */
  async extractQualityWeights(): Promise<void> {
    // ONNX Runtime Node doesn't expose weight extraction API directly.
    // We use a single forward pass with a known input to probe, OR
    // rely on the model having been exported with weights as initializers.
    // For now, leave weights null — regions won't be produced but scores will be.
    // TODO: implement weight extraction via onnx-js or model inspection in Phase 5.
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function argmax(arr: Float32Array | number[]): number {
  let maxIdx = 0;
  let maxVal = arr[0];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > maxVal) {
      maxVal = arr[i];
      maxIdx = i;
    }
  }
  return maxIdx;
}
