# Visual Validator MCP Server — Architecture Design

## 1. Overview

**visual-validator-mcp-server**: localhost 개발 서버의 UI를 스크린샷으로 캡처하고, rule-based 검출 + CNN 보조 분석을 통해 구조화된 검증 리포트를 반환하는 MCP 서버.

```
┌─────────────────────────────────────────────────────────┐
│  Claude Desktop / Claude Code (MCP Client)              │
│                                                         │
│  "localhost:3000 캡처해서 UI 검증해줘"                      │
└──────────────┬──────────────────────────────────────────┘
               │ stdio (JSON-RPC)
               ▼
┌─────────────────────────────────────────────────────────┐
│  visual-validator-mcp-server                            │
│                                                         │
│  ┌───────────┐   ┌──────────────┐   ┌───────────────┐  │
│  │ Capture   │──▶│ Rule Engine  │──▶│ Report        │  │
│  │ Module    │   │              │   │ Generator     │  │
│  │(Playwright)│  │ ┌──────────┐ │   │               │  │
│  │           │   │ │CNN Model │ │   │ JSON + MD     │  │
│  └───────────┘   │ │(보조)    │ │   └───────────────┘  │
│                  │ └──────────┘ │                       │
│                  └──────────────┘                       │
└─────────────────────────────────────────────────────────┘
```

---

## 2. MCP Tools 정의

### Tool 1: `vv_capture_and_validate`

**핵심 도구**. 스크린샷 캡처 → 전체 파이프라인 실행 → 구조화된 리포트 반환.

```typescript
// Input
{
  url: string,              // e.g. "http://localhost:3000/dashboard"
  viewport?: {
    width: number,          // default: 1280
    height: number          // default: 720
  },
  full_page?: boolean,      // default: false
  wait_for?: string,        // CSS selector to wait for before capture
  rules?: string[],         // 실행할 rule 필터 (기본: 전체)
  use_cnn?: boolean,        // CNN 보조 분석 활성화 (default: true)
  threshold?: number        // CNN anomaly threshold 0.0-1.0 (default: 0.5)
}

// Output (구조화된 JSON)
{
  screenshot: string,       // base64 PNG (Claude가 직접 볼 수 있음)
  timestamp: string,
  viewport: { width, height },
  validation: {
    score: number,          // 0-100 종합 점수
    pass: boolean,          // score >= 70
    rule_results: [
      {
        rule: "alignment",
        severity: "warning" | "error" | "info",
        message: "3 elements misaligned on vertical axis",
        affected_regions: [{ x, y, w, h }],  // bounding boxes
        details: { ... }
      }
    ],
    cnn_results?: {
      anomaly_score: number,      // 0.0-1.0
      anomaly_regions: [{ x, y, w, h, confidence }],
      quality_class: "good" | "acceptable" | "poor"
    }
  }
}
```

### Tool 2: `vv_capture_screenshot`

스크린샷만 캡처 (검증 없이). Claude가 직접 이미지를 보고 판단하고 싶을 때.

```typescript
// Input
{
  url: string,
  viewport?: { width, height },
  full_page?: boolean,
  wait_for?: string,
  selector?: string         // 특정 요소만 캡처
}

// Output
{
  screenshot: string,       // base64 PNG → MCP image content type
  metadata: { url, viewport, timestamp, selector? }
}
```

### Tool 3: `vv_compare_screenshots`

두 스크린샷 비교 (before/after 검증용).

```typescript
// Input
{
  url_a: string,            // 또는 base64 이미지
  url_b: string,
  viewport?: { width, height },
  diff_threshold?: number   // pixel diff tolerance (default: 0.01)
}

// Output
{
  screenshots: { a: string, b: string },
  diff_image: string,       // 차이점 시각화 base64
  diff_percentage: number,
  changed_regions: [{ x, y, w, h, diff_score }]
}
```

### Tool 4: `vv_list_rules`

사용 가능한 검증 규칙 목록 반환.

---

## 3. Rule Engine — 규칙 기반 검출

OpenCV (sharp + custom logic) 기반의 이미지 분석으로, DOM이 아닌 **렌더된 픽셀**을 대상으로 검증.

### 3.1 핵심 Rules

| Rule ID | Category | 설명 | 구현 방법 |
|---------|----------|------|-----------|
| `alignment` | Layout | 요소들의 수직/수평 정렬 일관성 | Edge detection → Hough line transform → 정렬 축 클러스터링 |
| `spacing` | Layout | 요소 간 간격 일관성 | Connected component analysis → gap 분포 분석 |
| `overflow` | Layout | 텍스트/요소 잘림 감지 | 뷰포트 경계 근처 콘텐츠 감지, clipping 분석 |
| `color_contrast` | Accessibility | WCAG 2.1 AA 기준 명암비 | 텍스트 영역 추출 → 전경/배경 색상비 계산 |
| `whitespace` | Balance | 비정상적 여백 (너무 크거나 작은) | 공간 분할 → 비율 분석 |
| `text_rendering` | Typography | 텍스트 깨짐, 겹침, 잘림 | OCR 보조 + edge density 분석 |
| `visual_hierarchy` | Composition | 시각적 무게 중심 편향 | 영역별 edge density + 색상 대비 가중치 맵 |
| `empty_state` | Content | 빈 화면 / 로딩 실패 감지 | 전체 이미지 entropy 분석 |

### 3.2 Rule 구현 파이프라인

```
Screenshot (PNG Buffer)
    │
    ├─── Preprocessing ──────────────────────────┐
    │    ├── Resize to analysis resolution       │
    │    ├── Grayscale conversion                │
    │    ├── Edge detection (Canny)              │
    │    └── Color space conversion (LAB)        │
    │                                            │
    ├─── Layout Rules ───────────────────────────┤
    │    ├── alignment: Hough lines → axis gaps  │
    │    ├── spacing: component gaps histogram   │
    │    └── overflow: boundary analysis         │
    │                                            │
    ├─── Visual Rules ───────────────────────────┤
    │    ├── color_contrast: LAB ΔE calculation  │
    │    ├── whitespace: region segmentation     │
    │    └── visual_hierarchy: saliency map      │
    │                                            │
    └─── Content Rules ──────────────────────────┤
         ├── text_rendering: OCR confidence      │
         └── empty_state: entropy threshold      │
                                                 ▼
                                         Aggregated Results
```

### 3.3 구현 기술 스택 (Node.js)

- **sharp**: 이미지 전처리 (resize, grayscale, raw pixel access)
- **@aspect-build/opencv** 또는 **opencv-wasm**: Edge detection, Hough transform
  - 대안: 순수 JS 구현 (Canny edge는 직접 구현 가능)
- **Tesseract.js**: OCR 기반 텍스트 분석 (text_rendering rule)
- **pixelmatch**: 스크린샷 비교 (diff tool)

> **주의**: opencv 네이티브 바인딩은 설치가 무거움. 
> MVP에서는 sharp + 자체 구현 알고리즘으로 시작하고,
> 필요시 opencv-wasm으로 확장하는 전략 추천.

---

## 4. CNN 보조 모델

### 4.1 역할 정의

CNN은 rule engine이 잡지 못하는 **"뭔가 이상한데?"**를 감지하는 anomaly detector.

- Rule engine: "버튼 3개의 수평 간격이 [16, 16, 42]px → 불일치" (명확한 규칙)
- CNN: "이 화면은 전반적으로 깨진 느낌" (학습된 감각)

### 4.2 모델 아키텍처

```
Input: 224x224 RGB (resized screenshot)
    │
    ▼
┌──────────────────────────────┐
│  Backbone: MobileNetV2       │  ← Rico 데이터셋으로 fine-tuning
│  (pretrained on ImageNet)    │
│                              │
│  - 경량: ~3.4M params        │
│  - 추론 속도: ~20ms (CPU)    │
│  - ONNX export 가능          │
└──────────┬───────────────────┘
           │
    ┌──────┴──────┐
    ▼             ▼
┌─────────┐  ┌──────────────────┐
│ Quality │  │ Anomaly Region   │
│ Head    │  │ Head (CAM)       │
│         │  │                  │
│ FC→3cls │  │ Grad-CAM heatmap │
│good/ok/ │  │ → bounding boxes │
│poor     │  │                  │
└─────────┘  └──────────────────┘
```

### 4.3 학습 데이터: Rico 데이터셋 활용

**Rico** (Rico: A Mobile App Dataset for Building Data-Driven Design Applications)
- ~72K unique UI screenshots (Android)
- UI component hierarchy annotations
- Layout vectors

**데이터 준비 전략:**

```
Phase 1: Binary Classification (good vs. broken)
─────────────────────────────────────────────────
Good UI:   Rico 원본 스크린샷 (~72K)
Bad UI:    Rico 스크린샷에 합성 결함 주입:
           ├── 랜덤 요소 겹침 (overlap injection)
           ├── 텍스트 잘림 (crop text regions)
           ├── 정렬 깨뜨리기 (shift elements randomly)
           ├── 색상 대비 파괴 (reduce contrast)
           ├── 빈 영역 주입 (white/gray blocks)
           └── 레이아웃 왜곡 (scale distortion)

Phase 2: 웹 UI 도메인 적응
─────────────────────────────────────────────────
- 실제 웹사이트 스크린샷 수집 (Playwright batch)
- Awesome Landing Pages 등에서 "good" 샘플
- 의도적으로 깨뜨린 버전 생성
```

### 4.4 추론 런타임

**ONNX Runtime (onnxruntime-node)**를 사용:
- Python 학습 → ONNX export → Node.js에서 추론
- CPU 전용으로 충분 (MobileNetV2 기준 ~20ms)
- MCP 서버가 Node.js이므로 네이티브 통합

```typescript
import * as ort from 'onnxruntime-node';

class CNNAnalyzer {
  private session: ort.InferenceSession;

  async load(modelPath: string) {
    this.session = await ort.InferenceSession.create(modelPath);
  }

  async analyze(imageBuffer: Buffer): Promise<CNNResult> {
    const tensor = this.preprocessImage(imageBuffer); // → [1, 3, 224, 224]
    const results = await this.session.run({ input: tensor });
    
    return {
      quality_class: this.decodeClass(results.quality),
      anomaly_score: results.anomaly_score.data[0],
      // Grad-CAM은 별도 경량 구현 필요
    };
  }
}
```

### 4.5 Grad-CAM을 통한 이상 영역 시각화

CNN이 "이상하다"고 판단한 영역을 heatmap으로 시각화해서, 어디가 문제인지 알려줌.

```
원본 스크린샷         Grad-CAM 히트맵         오버레이 결과
┌──────────┐      ┌──────────┐         ┌──────────┐
│  ┌────┐  │      │          │         │  ┌────┐  │
│  │ Nav│  │      │  ░░░░░░  │         │  │ Nav│  │
│  └────┘  │  +   │  ░░██░░  │    =    │  └────┘  │
│  ┌────┐  │      │  ░░██░░  │         │  ┌▓▓▓▓┐  │  ← "이 영역이 이상함"
│  │Card│  │      │  ░░░░░░  │         │  │Card│  │
│  └────┘  │      │          │         │  └────┘  │
└──────────┘      └──────────┘         └──────────┘
```

---

## 5. 프로젝트 구조

```
visual-validator-mcp-server/
├── package.json
├── tsconfig.json
├── .env.example              # ANTHROPIC_API_KEY (optional, for future)
├── README.md
├── models/
│   └── ui_quality.onnx       # Fine-tuned MobileNetV2 (배포 시 포함)
├── src/
│   ├── index.ts              # MCP Server 진입점 (stdio transport)
│   ├── types.ts              # 공통 타입 정의
│   ├── constants.ts
│   ├── tools/
│   │   ├── capture-and-validate.ts
│   │   ├── capture-screenshot.ts
│   │   ├── compare-screenshots.ts
│   │   └── list-rules.ts
│   ├── capture/
│   │   └── playwright-capture.ts    # Playwright 스크린샷 모듈
│   ├── rules/
│   │   ├── engine.ts               # Rule 실행 엔진
│   │   ├── base-rule.ts            # Rule 인터페이스
│   │   ├── alignment.ts
│   │   ├── spacing.ts
│   │   ├── overflow.ts
│   │   ├── color-contrast.ts
│   │   ├── whitespace.ts
│   │   ├── text-rendering.ts
│   │   ├── visual-hierarchy.ts
│   │   └── empty-state.ts
│   ├── cnn/
│   │   ├── analyzer.ts             # ONNX 추론 래퍼
│   │   ├── preprocessor.ts         # 이미지 → 텐서 변환
│   │   └── gradcam.ts              # Grad-CAM 구현
│   └── utils/
│       ├── image-processing.ts     # sharp 기반 이미지 처리
│       ├── scoring.ts              # 종합 점수 계산
│       └── report-formatter.ts     # JSON/Markdown 리포트 생성
├── training/                       # Python — 모델 학습 코드
│   ├── requirements.txt
│   ├── dataset/
│   │   ├── prepare_rico.py         # Rico 데이터셋 다운로드/전처리
│   │   └── augment_defects.py      # 합성 결함 생성기
│   ├── train.py                    # MobileNetV2 fine-tuning
│   ├── export_onnx.py              # PyTorch → ONNX 변환
│   └── evaluate.py                 # 모델 평가
└── tests/
    ├── rules/
    ├── cnn/
    └── integration/
```

---

## 6. 구현 순서 (Phase Plan)

### Phase 1: MCP 서버 뼈대 + 스크린샷 캡처 (1주)
- [ ] MCP 서버 초기화 (stdio transport)
- [ ] `vv_capture_screenshot` tool 구현
- [ ] Playwright headless 브라우저 관리
- [ ] Claude Desktop config에서 동작 확인

### Phase 2: Rule Engine MVP (2주)
- [ ] Rule 인터페이스 설계
- [ ] `alignment` rule 구현 (edge detection + line clustering)
- [ ] `empty_state` rule 구현 (가장 간단)
- [ ] `color_contrast` rule 구현 (WCAG 기준)
- [ ] `vv_capture_and_validate` tool 통합
- [ ] 리포트 포맷터 (JSON + Markdown)

### Phase 3: CNN 모델 학습 (2-3주)
- [ ] Rico 데이터셋 다운로드 및 전처리
- [ ] 합성 결함 데이터 생성기 구현
- [ ] MobileNetV2 fine-tuning (PyTorch)
- [ ] ONNX export 및 Node.js 추론 테스트
- [ ] Grad-CAM 구현

### Phase 4: 통합 및 나머지 Rules (1-2주)
- [ ] CNN 분석기를 MCP 파이프라인에 통합
- [ ] `spacing`, `overflow`, `whitespace` rules
- [ ] `vv_compare_screenshots` tool 구현
- [ ] 종합 점수 계산 로직

### Phase 5: 품질 개선 (1주)
- [ ] 웹 UI 도메인 적응 (추가 데이터)
- [ ] Rule 임계값 튜닝
- [ ] 에러 핸들링 강화
- [ ] README 및 문서화

**총 예상: 7-9주**

---

## 7. 클라이언트 연동 설정

### 7.1 Claude Code 연동 (권장)

Claude Code는 터미널에서 코드를 수정하면서 바로 UI 검증까지 이어지는 루프를 만들 수 있어서, 이 도구와 가장 궁합이 좋은 클라이언트다.

#### 설치 방법 A: CLI 한 줄 등록

```bash
# 1. 빌드
cd visual-validator-mcp-server
npm install && npm run build

# 2. user scope로 등록 (모든 프로젝트에서 사용 가능)
claude mcp add visual-validator --scope user \
  -- node /absolute/path/to/visual-validator-mcp-server/dist/index.js

# 3. 연결 확인
claude mcp list
# → visual-validator: connected
```

scope 옵션 정리:
- `--scope local` (기본값): 현재 프로젝트 디렉토리에서만 사용. `~/.claude.json`의 프로젝트 경로 하위에 저장.
- `--scope project`: `.mcp.json` 파일에 저장되어 팀원과 공유 가능 (API 키 제외).
- `--scope user`: `~/.claude.json` 전역에 저장. 모든 프로젝트에서 사용 가능.

프론트엔드 작업 전반에 걸쳐 쓸 도구이므로 **`--scope user` 권장**.

#### 설치 방법 B: JSON 직접 편집

`~/.claude.json`을 직접 편집하면 환경변수나 복잡한 설정을 한눈에 관리할 수 있다.

```jsonc
// ~/.claude.json
{
  "mcpServers": {
    "visual-validator": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/visual-validator-mcp-server/dist/index.js"],
      "env": {
        "VV_DEFAULT_VIEWPORT_WIDTH": "1280",
        "VV_DEFAULT_VIEWPORT_HEIGHT": "720",
        "VV_CNN_ENABLED": "true",
        "VV_CNN_THRESHOLD": "0.5"
      }
    }
  }
}
```

편집 후 Claude Code를 재시작하고 `/mcp` 명령어로 연결 상태를 확인한다.

```
> /mcp
⎿ MCP Server Status
⎿
⎿ • visual-validator: connected (4 tools)
```

#### 설치 방법 C: 팀 공유용 (.mcp.json)

프로젝트 루트에 `.mcp.json`을 두면 팀원 전체가 동일한 설정으로 사용할 수 있다.

```jsonc
// {project-root}/.mcp.json
{
  "mcpServers": {
    "visual-validator": {
      "type": "stdio",
      "command": "npx",
      "args": ["visual-validator-mcp-server@latest"]
    }
  }
}
```

> npm에 퍼블리시하면 `npx`로 별도 설치 없이 바로 실행 가능.

#### Claude Code에서의 사용 흐름

```
┌─ Terminal (Claude Code) ─────────────────────────────────────┐
│                                                              │
│ > "Dashboard.tsx의 카드 레이아웃을 3열 그리드로 바꿔줘"           │
│                                                              │
│ Claude: Dashboard.tsx를 수정합니다...                           │
│   ├── grid-cols-2 → grid-cols-3 변경                          │
│   └── gap-4 → gap-6 조정                                     │
│                                                              │
│ > "localhost:3000/dashboard 캡처해서 검증해봐"                   │
│                                                              │
│ Claude → vv_capture_and_validate({                           │
│   url: "http://localhost:3000/dashboard"                     │
│ })                                                           │
│                                                              │
│ Claude: 검증 결과 (82/100 Pass)                                │
│   ⚠️ spacing: 3열 카드 간 간격 불균일 (24, 24, 18)px           │
│   ✅ alignment: 정상                                          │
│   ℹ️ CNN: anomaly_score 0.23 (정상 범위)                      │
│                                                              │
│   gap-6이 마지막 열에서 overflow로 축소된 것 같습니다.              │
│   max-width 제약을 확인하겠습니다...                              │
│                                                              │
│ Claude: Dashboard.tsx를 수정합니다...                           │
│   └── 컨테이너에 min-w-0 추가                                  │
│                                                              │
│ > "다시 검증해봐"                                               │
│                                                              │
│ Claude → vv_capture_and_validate(...)                         │
│ Claude → vv_compare_screenshots(before, after)               │
│                                                              │
│ Claude: 재검증 결과 (95/100 Pass)                              │
│   ✅ 모든 규칙 통과. 이전 대비 diff 2.3%                        │
│   변경된 영역: 카드 그리드 간격이 균일하게 수정됨                    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

핵심은 **코드 수정 → 캡처 → 검증 → 재수정** 루프가 Claude Code 세션 안에서 끊김 없이 돌아간다는 점이다.

#### CLAUDE.md에 프롬프트 가이드 추가 (선택)

프로젝트 루트의 `CLAUDE.md`에 아래를 추가하면 Claude Code가 자동으로 검증 도구를 활용한다:

```markdown
## UI 검증 가이드

이 프로젝트는 visual-validator MCP 서버가 연결되어 있습니다.

- 프론트엔드 컴포넌트를 수정한 후에는 `vv_capture_and_validate`로 검증하세요.
- 개발 서버: http://localhost:3000
- 검증 기준 점수: 70점 이상이면 Pass
- 주요 검증 항목: alignment, spacing, color_contrast, overflow
- 수정 전후 비교가 필요하면 `vv_compare_screenshots`를 사용하세요.
```

### 7.2 Claude Desktop 연동

Claude Desktop에서도 동일하게 사용할 수 있다. 설정 파일 위치가 다를 뿐이다.

```jsonc
// macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
// Windows: %APPDATA%\Claude\claude_desktop_config.json
// Linux: ~/.config/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "visual-validator": {
      "command": "node",
      "args": ["/absolute/path/to/visual-validator-mcp-server/dist/index.js"],
      "env": {
        "VV_CNN_ENABLED": "true"
      }
    }
  }
}
```

Claude Desktop은 대화형으로 결과를 확인하기에 좋고, Claude Code는 코드 수정 루프에 적합하다. 둘 다 동시에 등록해두고 상황에 맞게 쓰면 된다.

### 7.3 MCP Inspector로 디버깅

개발 중 MCP 서버 동작을 테스트하려면 공식 Inspector를 사용한다:

```bash
# Inspector로 서버 테스트
npx @modelcontextprotocol/inspector node dist/index.js

# → http://localhost:6274 에서 웹 UI로 도구 호출 테스트 가능
```

### 7.4 사용 시나리오 모음

#### 시나리오 1: 기본 UI 검증

```
"localhost:3000의 대시보드 페이지 UI 검증해줘"

→ vv_capture_and_validate({ url: "http://localhost:3000/dashboard" })
→ 종합 점수 + 이슈 목록 + 수정 제안
```

#### 시나리오 2: 수정 전후 비교

```
"아까 수정 전 스크린샷이랑 지금 비교해봐"

→ vv_compare_screenshots({
    url_a: "http://localhost:3000/dashboard",  // 이전 캡처
    url_b: "http://localhost:3000/dashboard"   // 현재
  })
→ diff 이미지 + 변경 영역 + 차이 비율
```

#### 시나리오 3: 반응형 검증

```
"모바일(375px), 태블릿(768px), 데스크톱(1440px) 각각 검증해줘"

→ vv_capture_and_validate({ url: "...", viewport: { width: 375, height: 812 } })
→ vv_capture_and_validate({ url: "...", viewport: { width: 768, height: 1024 } })
→ vv_capture_and_validate({ url: "...", viewport: { width: 1440, height: 900 } })
→ 뷰포트별 비교 리포트
```

#### 시나리오 4: 특정 컴포넌트만 캡처

```
"헤더 네비게이션만 캡처해서 보여줘"

→ vv_capture_screenshot({
    url: "http://localhost:3000",
    selector: "nav.main-header"
  })
→ base64 이미지 (Claude가 직접 시각적으로 확인)
```

#### 시나리오 5: CI/CD 연동 시나리오 (향후 확장)

```bash
# GitHub Actions에서 visual regression test로 활용
npx visual-validator-mcp-server --cli \
  --url http://localhost:3000 \
  --threshold 70 \
  --output report.json

# exit code: 0 (pass) / 1 (fail)
```

---

## 8. 핵심 기술적 고려사항

### 8.1 Playwright 브라우저 관리
- 서버 시작 시 Chromium 인스턴스 1개 유지 (cold start 방지)
- 요청마다 새 page 생성 → 완료 후 close
- 30초 timeout으로 행 방지

### 8.2 이미지 처리 성능
- 분석 해상도: 원본 → 640x360으로 축소 (rule engine용)
- CNN 입력: 224x224 (MobileNetV2 표준)
- 반환용 스크린샷: 원본 해상도 유지 (base64)

### 8.3 CNN 모델 배포
- `.onnx` 파일을 npm 패키지에 포함 (약 14MB)
- 첫 실행 시 자동 다운로드 방식도 가능
- `use_cnn: false`로 CNN 없이도 동작하도록 설계

### 8.4 MCP 응답 형식
- 스크린샷은 MCP `image` content type으로 반환 → Claude가 직접 볼 수 있음
- 검증 결과는 `text` (JSON/Markdown) content type
- 하나의 tool 응답에 image + text 복합 반환
