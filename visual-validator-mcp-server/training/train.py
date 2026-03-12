"""
UIQualityModel 학습 스크립트
MobileNetV2 backbone + Quality head + Anomaly head

Usage:
  python training/train.py
  python training/train.py --epochs 30 --batch-size 16 --lr 1e-3
"""

import argparse
import random
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torchvision
import torchvision.transforms as T
from torch.utils.data import DataLoader, Dataset, random_split
from PIL import Image
from tqdm import tqdm

ROOT = Path(__file__).parent
DATASET_DIR = ROOT / "dataset" / "raw"
MODELS_DIR = ROOT.parent / "models"
MODELS_DIR.mkdir(exist_ok=True)

SEED = 42
random.seed(SEED)
np.random.seed(SEED)
torch.manual_seed(SEED)

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")


# ── Dataset ───────────────────────────────────────────────────────────────────

class UIDataset(Dataset):
    """
    Label:
      0 = good   (training/dataset/raw/good/*.png)
      1 = poor   (training/dataset/raw/bad/*.png)
    """

    TRAIN_TRANSFORM = T.Compose([
        T.Resize((224, 224)),
        T.RandomHorizontalFlip(p=0.3),
        T.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.1),
        T.ToTensor(),
        T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])

    VAL_TRANSFORM = T.Compose([
        T.Resize((224, 224)),
        T.ToTensor(),
        T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])

    def __init__(self, augment: bool = True):
        self.samples: list[tuple[Path, int]] = []
        self.transform = self.TRAIN_TRANSFORM if augment else self.VAL_TRANSFORM

        good_dir = DATASET_DIR / "good"
        bad_dir = DATASET_DIR / "bad"

        if not good_dir.exists():
            raise FileNotFoundError(
                f"{good_dir} not found.\n"
                "Run: node training/dataset/collect_web_screenshots.mjs"
            )
        if not bad_dir.exists():
            raise FileNotFoundError(
                f"{bad_dir} not found.\n"
                "Run: python training/dataset/augment_defects.py"
            )

        for p in sorted(good_dir.glob("*.png")):
            self.samples.append((p, 0))
        for p in sorted(bad_dir.glob("*.png")):
            self.samples.append((p, 1))

        random.shuffle(self.samples)
        print(f"Dataset: {sum(1 for _,l in self.samples if l==0)} good  "
              f"/ {sum(1 for _,l in self.samples if l==1)} bad  "
              f"(total {len(self.samples)})")

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        path, label = self.samples[idx]
        img = Image.open(path).convert("RGB")
        x = self.transform(img)
        return x, label


# ── Model ─────────────────────────────────────────────────────────────────────

class UIQualityModel(nn.Module):
    def __init__(self, num_quality_classes: int = 3):
        super().__init__()
        backbone = torchvision.models.mobilenet_v2(pretrained=True)

        # Feature extractor: all conv layers before classifier
        self.features = backbone.features  # output: [B, 1280, 7, 7] for 224x224 input

        self.gap = nn.AdaptiveAvgPool2d((1, 1))

        # Quality head: good(0) / acceptable(1) / poor(2)
        self.quality_head = nn.Sequential(
            nn.Dropout(0.2),
            nn.Linear(1280, num_quality_classes),
        )

        # Anomaly head: 0.0 = normal, 1.0 = highly anomalous
        self.anomaly_head = nn.Sequential(
            nn.Dropout(0.2),
            nn.Linear(1280, 1),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor):
        feat = self.features(x)                 # [B, 1280, 7, 7]
        pooled = self.gap(feat).flatten(1)       # [B, 1280]
        quality = self.quality_head(pooled)      # [B, 3]
        anomaly = self.anomaly_head(pooled)      # [B, 1]
        return quality, anomaly, feat


# ── Training loop ─────────────────────────────────────────────────────────────

def train(args):
    print(f"Device: {DEVICE}")
    print(f"Loading dataset from {DATASET_DIR}...")

    full_dataset = UIDataset(augment=True)

    # 80/20 train/val split
    n_val = max(1, int(len(full_dataset) * 0.2))
    n_train = len(full_dataset) - n_val
    train_ds, val_ds = random_split(
        full_dataset, [n_train, n_val],
        generator=torch.Generator().manual_seed(SEED)
    )
    # Use val transform for val set
    val_ds.dataset.transform = UIDataset.VAL_TRANSFORM

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True,
                              num_workers=2, pin_memory=True)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False,
                            num_workers=2, pin_memory=True)

    model = UIQualityModel().to(DEVICE)

    # ── Phase 1: freeze backbone, train only heads ──────────────────────────
    for param in model.features.parameters():
        param.requires_grad = False
    optimizer = torch.optim.Adam(
        filter(lambda p: p.requires_grad, model.parameters()), lr=args.lr
    )
    quality_loss_fn = nn.CrossEntropyLoss()
    anomaly_loss_fn = nn.BCELoss()

    print(f"\nPhase 1: Training heads only ({args.warmup_epochs} epochs)")
    best_val_loss = float("inf")
    best_ckpt = MODELS_DIR / "ui_quality_best.pt"

    for epoch in range(1, args.warmup_epochs + 1):
        _train_epoch(model, train_loader, optimizer, quality_loss_fn, anomaly_loss_fn, epoch)
        val_loss = _val_epoch(model, val_loader, quality_loss_fn, anomaly_loss_fn, epoch)
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            torch.save(model.state_dict(), best_ckpt)
            print(f"  → saved best checkpoint (val_loss={val_loss:.4f})")

    # ── Phase 2: unfreeze last N backbone layers ────────────────────────────
    unfreeze_from = max(0, len(list(model.features)) - args.unfreeze_layers)
    for i, layer in enumerate(model.features):
        for param in layer.parameters():
            param.requires_grad = i >= unfreeze_from

    optimizer = torch.optim.Adam(
        filter(lambda p: p.requires_grad, model.parameters()), lr=args.lr / 5
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=args.epochs - args.warmup_epochs
    )

    print(f"\nPhase 2: Fine-tuning last {args.unfreeze_layers} backbone layers ({args.epochs - args.warmup_epochs} epochs)")

    for epoch in range(args.warmup_epochs + 1, args.epochs + 1):
        _train_epoch(model, train_loader, optimizer, quality_loss_fn, anomaly_loss_fn, epoch)
        val_loss = _val_epoch(model, val_loader, quality_loss_fn, anomaly_loss_fn, epoch)
        scheduler.step()
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            torch.save(model.state_dict(), best_ckpt)
            print(f"  → saved best checkpoint (val_loss={val_loss:.4f})")

    # Save final checkpoint too
    final_ckpt = MODELS_DIR / "ui_quality_final.pt"
    torch.save(model.state_dict(), final_ckpt)
    print(f"\n학습 완료!")
    print(f"Best checkpoint: {best_ckpt}")
    print(f"Final checkpoint: {final_ckpt}")
    print(f"\n다음 단계: python training/export_onnx.py")


def _train_epoch(model, loader, optimizer, q_loss_fn, a_loss_fn, epoch):
    model.train()
    total_loss = 0.0
    correct = 0
    total = 0

    for x, labels in tqdm(loader, desc=f"[Train E{epoch:02d}]", leave=False):
        x, labels = x.to(DEVICE), labels.to(DEVICE)

        # Quality labels: 0→0(good), 1→2(poor) for 3-class classification
        quality_labels = torch.where(labels == 0,
                                     torch.zeros_like(labels),
                                     torch.full_like(labels, 2))
        anomaly_labels = labels.float().unsqueeze(1)

        optimizer.zero_grad()
        quality_logits, anomaly_score, _ = model(x)

        loss = q_loss_fn(quality_logits, quality_labels) + a_loss_fn(anomaly_score, anomaly_labels)
        loss.backward()
        optimizer.step()

        total_loss += loss.item()
        pred = quality_logits.argmax(dim=1)
        correct += (pred == quality_labels).sum().item()
        total += len(labels)

    acc = correct / total * 100
    print(f"  Train E{epoch:02d}: loss={total_loss/len(loader):.4f}  acc={acc:.1f}%")


def _val_epoch(model, loader, q_loss_fn, a_loss_fn, epoch) -> float:
    model.eval()
    total_loss = 0.0
    correct = 0
    total = 0

    with torch.no_grad():
        for x, labels in loader:
            x, labels = x.to(DEVICE), labels.to(DEVICE)
            quality_labels = torch.where(labels == 0,
                                         torch.zeros_like(labels),
                                         torch.full_like(labels, 2))
            anomaly_labels = labels.float().unsqueeze(1)

            quality_logits, anomaly_score, _ = model(x)
            loss = q_loss_fn(quality_logits, quality_labels) + a_loss_fn(anomaly_score, anomaly_labels)
            total_loss += loss.item()
            pred = quality_logits.argmax(dim=1)
            correct += (pred == quality_labels).sum().item()
            total += len(labels)

    avg_loss = total_loss / len(loader)
    acc = correct / total * 100
    print(f"  Val   E{epoch:02d}: loss={avg_loss:.4f}  acc={acc:.1f}%")
    return avg_loss


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="UIQualityModel 학습")
    parser.add_argument("--epochs", type=int, default=25)
    parser.add_argument("--warmup-epochs", type=int, default=5,
                        help="backbone 동결 상태로 head만 학습할 epoch 수")
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--unfreeze-layers", type=int, default=5,
                        help="Phase 2에서 unfreeze할 backbone 마지막 레이어 수")
    args = parser.parse_args()
    train(args)
