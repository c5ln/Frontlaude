"""
ONNX 모델 평가 스크립트

Usage:
  python training/evaluate.py
  python training/evaluate.py --model models/ui_quality.onnx
"""

import argparse
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image
import torchvision.transforms as T

ROOT = Path(__file__).parent
MODELS_DIR = ROOT.parent / "models"
DATASET_DIR = ROOT / "dataset" / "raw"

VAL_TRANSFORM = T.Compose([
    T.Resize((224, 224)),
    T.ToTensor(),
    T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])

QUALITY_LABELS = ["good", "acceptable", "poor"]


def preprocess(img_path: Path) -> np.ndarray:
    img = Image.open(img_path).convert("RGB")
    tensor = VAL_TRANSFORM(img)
    return tensor.unsqueeze(0).numpy()  # [1, 3, 224, 224]


def evaluate(model_path: Path):
    if not model_path.exists():
        print(f"[ERROR] 모델을 찾을 수 없습니다: {model_path}")
        print("먼저 실행: python training/export_onnx.py")
        return

    print(f"모델 로드: {model_path}")
    session = ort.InferenceSession(str(model_path))

    results = []

    for label_name, true_label in [("good", 0), ("bad", 1)]:
        img_dir = DATASET_DIR / label_name
        if not img_dir.exists():
            continue

        images = list(img_dir.glob("*.png"))[:50]  # val sample
        for img_path in images:
            try:
                x = preprocess(img_path)
                quality, anomaly_score, _ = session.run(None, {"input": x})
                pred_quality_idx = int(np.argmax(quality[0]))
                # poor(2) → "bad", good(0)/acceptable(1) → "good"
                pred_label = 1 if pred_quality_idx == 2 else 0
                results.append({
                    "true": true_label,
                    "pred": pred_label,
                    "quality_class": QUALITY_LABELS[pred_quality_idx],
                    "anomaly_score": float(anomaly_score[0][0]),
                })
            except Exception as e:
                print(f"  skip {img_path.name}: {e}")

    if not results:
        print("평가할 이미지가 없습니다.")
        return

    # ── Metrics ──────────────────────────────────────────────────────────────
    tp = sum(1 for r in results if r["true"] == 1 and r["pred"] == 1)
    tn = sum(1 for r in results if r["true"] == 0 and r["pred"] == 0)
    fp = sum(1 for r in results if r["true"] == 0 and r["pred"] == 1)
    fn = sum(1 for r in results if r["true"] == 1 and r["pred"] == 0)
    n = len(results)

    accuracy = (tp + tn) / n * 100
    precision = tp / (tp + fp) * 100 if (tp + fp) > 0 else 0
    recall = tp / (tp + fn) * 100 if (tp + fn) > 0 else 0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

    print(f"\n── 평가 결과 ({n}개 샘플) ──────────────────────")
    print(f"Accuracy : {accuracy:.1f}%")
    print(f"Precision: {precision:.1f}%")
    print(f"Recall   : {recall:.1f}%")
    print(f"F1 Score : {f1:.1f}%")
    print(f"\nConfusion Matrix:")
    print(f"  TP={tp}  FP={fp}")
    print(f"  FN={fn}  TN={tn}")

    # Average anomaly scores by class
    good_scores = [r["anomaly_score"] for r in results if r["true"] == 0]
    bad_scores = [r["anomaly_score"] for r in results if r["true"] == 1]
    if good_scores:
        print(f"\nAnomaly score avg (good): {np.mean(good_scores):.3f}")
    if bad_scores:
        print(f"Anomaly score avg (bad) : {np.mean(bad_scores):.3f}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=str(MODELS_DIR / "ui_quality.onnx"))
    args = parser.parse_args()
    evaluate(Path(args.model))
