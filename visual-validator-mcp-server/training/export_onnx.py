"""
학습된 PyTorch 체크포인트를 ONNX로 변환합니다.

Usage:
  python training/export_onnx.py
  python training/export_onnx.py --checkpoint models/ui_quality_best.pt
"""

import argparse
from pathlib import Path

import torch
import onnx
import onnxruntime as ort
import numpy as np

ROOT = Path(__file__).parent
MODELS_DIR = ROOT.parent / "models"

# Inline model definition (same as train.py — avoids circular imports)
import torch.nn as nn
import torchvision


class UIQualityModel(nn.Module):
    def __init__(self, num_quality_classes: int = 3):
        super().__init__()
        backbone = torchvision.models.mobilenet_v2(pretrained=False)
        self.features = backbone.features
        self.gap = nn.AdaptiveAvgPool2d((1, 1))
        self.quality_head = nn.Sequential(
            nn.Dropout(0.2),
            nn.Linear(1280, num_quality_classes),
        )
        self.anomaly_head = nn.Sequential(
            nn.Dropout(0.2),
            nn.Linear(1280, 1),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor):
        feat = self.features(x)
        pooled = self.gap(feat).flatten(1)
        quality = self.quality_head(pooled)
        anomaly = self.anomaly_head(pooled)
        return quality, anomaly, feat


class ExportModel(nn.Module):
    """
    ONNX export용 래퍼.
    - quality: softmax 확률 [B, 3]
    - anomaly_score: scalar [B, 1]
    - feature_map: [B, 1280, 7, 7]  ← CAM 계산에 사용
    """

    def __init__(self, base: UIQualityModel):
        super().__init__()
        self.base = base

    def forward(self, x: torch.Tensor):
        quality_logits, anomaly_score, feature_map = self.base(x)
        quality_probs = torch.softmax(quality_logits, dim=1)
        return quality_probs, anomaly_score, feature_map


def export(checkpoint_path: Path, output_path: Path):
    print(f"Loading checkpoint: {checkpoint_path}")
    base_model = UIQualityModel()
    state = torch.load(checkpoint_path, map_location="cpu")
    base_model.load_state_dict(state)
    base_model.eval()

    export_model = ExportModel(base_model)
    export_model.eval()

    dummy_input = torch.randn(1, 3, 224, 224)

    print(f"Exporting to ONNX: {output_path}")
    torch.onnx.export(
        export_model,
        dummy_input,
        str(output_path),
        opset_version=12,
        input_names=["input"],
        output_names=["quality", "anomaly_score", "feature_map"],
        dynamic_axes={
            "input": {0: "batch"},
            "quality": {0: "batch"},
            "anomaly_score": {0: "batch"},
            "feature_map": {0: "batch"},
        },
        export_params=True,
        do_constant_folding=True,
    )

    # ── Verify ONNX model ────────────────────────────────────────────────────
    print("ONNX 모델 검증 중...")
    onnx_model = onnx.load(str(output_path))
    onnx.checker.check_model(onnx_model)
    print("  ✓ ONNX 모델 유효성 검사 통과")

    # ── Verify with OnnxRuntime ──────────────────────────────────────────────
    print("OnnxRuntime 추론 테스트 중...")
    session = ort.InferenceSession(str(output_path))
    dummy_np = dummy_input.numpy()
    outputs = session.run(None, {"input": dummy_np})

    quality, anomaly_score, feature_map = outputs
    print(f"  quality shape      : {quality.shape}      (softmax probs)")
    print(f"  anomaly_score shape: {anomaly_score.shape}")
    print(f"  feature_map shape  : {feature_map.shape}")
    print(f"  sample quality     : {quality[0].round(3)}")
    print(f"  sample anomaly     : {anomaly_score[0][0]:.4f}")

    size_mb = output_path.stat().st_size / 1_048_576
    print(f"\n✓ Export 완료: {output_path} ({size_mb:.1f} MB)")
    print("\n다음 단계:")
    print("  1. Claude Code를 재시작하거나 MCP 서버를 재빌드합니다.")
    print("  2. use_cnn: true 로 vv_capture_and_validate 를 호출하면 CNN 분석이 활성화됩니다.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", default=str(MODELS_DIR / "ui_quality_best.pt"),
                        help="PyTorch 체크포인트 경로")
    parser.add_argument("--output", default=str(MODELS_DIR / "ui_quality.onnx"),
                        help="출력 ONNX 파일 경로")
    args = parser.parse_args()

    ckpt = Path(args.checkpoint)
    out = Path(args.output)

    if not ckpt.exists():
        print(f"[ERROR] 체크포인트를 찾을 수 없습니다: {ckpt}")
        print("먼저 학습을 실행하세요: python training/train.py")
        exit(1)

    out.parent.mkdir(parents=True, exist_ok=True)
    export(ckpt, out)
