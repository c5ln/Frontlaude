# Frontlaude
localhost 개발 서버의 UI를 스크린샷으로 캡처하고, rule-based 검증 + CNN 보조 분석을 통해 구조화된 리포트를 반환하는 **MCP 서버**.

Claude Code 세션 안에서 **코드 수정 → 캡처 → 검증 → 재수정** 루프를 끊김 없이 돌릴 수 있습니다.

---

## 빠른 시작

```bash
# 1. 빌드
cd visual-validator-mcp-server
npm install
npm run build

# 2. Chromium 설치 (최초 1회)
npm run install-browsers

# 3. Claude Code에 등록 (모든 프로젝트에서 사용)
claude mcp add visual-validator --scope user \
  -- node /절대경로/visual-validator-mcp-server/dist/index.js

# 4. 연결 확인
claude mcp list
# → visual-validator: ✓ Connected (4 tools)
```

---

## MCP Tools

### `vv_capture_screenshot`
스크린샷만 캡처합니다. Claude가 이미지를 직접 보고 판단할 때 사용합니다.

```
url        필수  캡처할 URL (http://localhost:3000/...)
viewport   선택  { width, height }  기본값: 1280×720
full_page  선택  전체 스크롤 캡처   기본값: false
wait_for   선택  대기할 CSS selector
selector   선택  특정 요소만 캡처
```

### `vv_capture_and_validate`
캡처 + 전체 검증 파이프라인(6 rules + CNN)을 실행하고 점수와 리포트를 반환합니다.

```
url        필수  검증할 URL
viewport   선택  { width, height }
full_page  선택  기본값: false
wait_for   선택  대기할 CSS selector
rules      선택  실행할 rule ID 배열 (기본값: 전체)
use_cnn    선택  CNN 분석 활성화    기본값: true
threshold  선택  CNN 이상 감도 0–1  기본값: 0.5
```

**반환값:**
- 스크린샷 이미지
- Markdown 리포트 (종합 점수, pass/fail, 각 rule 결과)
- JSON (score, pass, rule_results, cnn_results)

### `vv_compare_screenshots`
두 URL 또는 base64 PNG를 비교하고 diff 이미지와 변경 영역을 반환합니다.

```
url_a           필수  URL 또는 base64 PNG ('이전' 상태)
url_b           필수  URL 또는 base64 PNG ('이후' 상태)
viewport        선택  { width, height }
diff_threshold  선택  픽셀 허용 오차 0–1  기본값: 0.1
```

### `vv_list_rules`
사용 가능한 검증 rule 목록과 설명을 반환합니다.

---

## 검증 Rules

| Rule ID | 카테고리 | 감지 내용 | 알고리즘 |
|---------|----------|-----------|----------|
| `empty_state` | 콘텐츠 | 빈 화면 / 로딩 실패 | 픽셀 표준편차 + 흰 픽셀 비율 |
| `alignment` | 레이아웃 | 요소 수직 정렬 불일치 | Sobel Gx → 컬럼 프로젝션 피크 분석 |
| `color_contrast` | 접근성 | WCAG 2.1 AA 명암비 위반 | 16×9 그리드 셀별 최소/최대 휘도 비율 |
| `spacing` | 레이아웃 | 요소 간 간격 불일치 | 행 프로젝션 갭 변동계수(CV) |
| `overflow` | 레이아웃 | 콘텐츠 잘림 / overflow | 뷰포트 경계 엣지 밀도 분석 |
| `whitespace` | 균형 | 과도한 여백 / 레이아웃 편중 | 여백 비율 + 4분면 콘텐츠 밀도 불균형 |

**점수 계산:**
- 기본 100점에서 차감 — error: -25점, warning: -10점
- 70점 이상 → **PASS**, 미만 → **FAIL**

---

## CNN 모델 설정

`models/ui_quality.onnx` 파일이 있으면 자동으로 로드됩니다.

```bash
# 데이터 수집 (웹 스크린샷 ~87장)
node training/dataset/collect_web_screenshots.mjs

# 합성 결함 주입
training/.venv/bin/python training/dataset/augment_defects.py --multiplier 4

# 학습 (~25 epochs)
training/.venv/bin/python training/train.py

# ONNX export
training/.venv/bin/python training/export_onnx.py
```

모델이 없어도 rule engine은 정상 동작합니다 (`use_cnn: false` 시 CNN 건너뜀).

---

## 환경 변수 설정

`.env.example`의 모든 항목을 환경변수로 오버라이드할 수 있습니다.

**Claude Code에서 설정하는 방법 (`~/.claude.json`):**
```jsonc
{
  "mcpServers": {
    "visual-validator": {
      "type": "stdio",
      "command": "node",
      "args": ["/절대경로/visual-validator-mcp-server/dist/index.js"],
      "env": {
        "VV_CNN_THRESHOLD": "0.4",
        "VV_PASS_THRESHOLD": "75",
        "VV_ALIGNMENT_WARNING_RATIO": "0.65"
      }
    }
  }
}
```

---

## Claude Code 연동

### CLAUDE.md에 추가 (선택)
프로젝트 루트의 `CLAUDE.md`에 아래를 추가하면 코드 수정 후 자동으로 검증합니다:

```markdown
## UI 검증 가이드

이 프로젝트는 visual-validator MCP 서버가 연결되어 있습니다.

- 프론트엔드 컴포넌트를 수정한 후에는 `vv_capture_and_validate`로 검증하세요.
- 개발 서버: http://localhost:3000
- 검증 기준 점수: 70점 이상이면 Pass
- 수정 전후 비교가 필요하면 `vv_compare_screenshots`를 사용하세요.
```

### 팀 공유 (`.mcp.json`)
```jsonc
// {project-root}/.mcp.json
{
  "mcpServers": {
    "visual-validator": {
      "type": "stdio",
      "command": "node",
      "args": ["/절대경로/visual-validator-mcp-server/dist/index.js"]
    }
  }
}
```

---

## 사용 시나리오

**기본 검증**
```
"localhost:3000 대시보드 UI 검증해줘"
→ vv_capture_and_validate({ url: "http://localhost:3000/dashboard" })
```

**수정 전후 비교**
```
"수정 전이랑 지금 비교해줘"
→ vv_compare_screenshots({ url_a: <이전 base64>, url_b: "http://localhost:3000" })
```

**반응형 검증**
```
"모바일, 태블릿, 데스크톱 각각 검증해줘"
→ viewport: { width: 375, height: 812 }
→ viewport: { width: 768, height: 1024 }
→ viewport: { width: 1440, height: 900 }
```

**특정 컴포넌트만**
```
"헤더만 캡처해줘"
→ vv_capture_screenshot({ url: "...", selector: "nav.main-header" })
```

**특정 rule만 선택**
```
"spacing이랑 overflow만 확인해줘"
→ vv_capture_and_validate({ url: "...", rules: ["spacing", "overflow"] })
```

---

## 개발

```bash
npm run build          # TypeScript 컴파일
npm run dev            # tsx watch 모드
npm run inspector      # MCP Inspector (http://localhost:6274)
node tests/test-rules.mjs   # Phase 2 rule 테스트
node tests/test-cnn.mjs     # CNN 추론 테스트
node tests/test-phase4.mjs  # Phase 4 rule 테스트
```

---

## 프로젝트 구조

```
visual-validator-mcp-server/
├── src/
│   ├── index.ts               MCP 서버 진입점
│   ├── config.ts              환경변수 기반 설정
│   ├── types.ts               공통 타입
│   ├── capture/
│   │   └── playwright-capture.ts
│   ├── rules/
│   │   ├── engine.ts
│   │   ├── empty-state.ts
│   │   ├── alignment.ts
│   │   ├── color-contrast.ts
│   │   ├── spacing.ts
│   │   ├── overflow.ts
│   │   └── whitespace.ts
│   ├── cnn/
│   │   ├── analyzer.ts        ONNX 추론 래퍼
│   │   ├── preprocessor.ts    이미지 → 텐서 변환
│   │   └── gradcam.ts         CAM 기반 이상 영역 시각화
│   ├── tools/
│   │   ├── capture-screenshot.ts
│   │   ├── capture-and-validate.ts
│   │   ├── compare-screenshots.ts
│   │   └── list-rules.ts
│   └── utils/
│       ├── image-processing.ts
│       ├── scoring.ts
│       └── report-formatter.ts
├── models/
│   └── ui_quality.onnx        학습된 CNN 모델
├── training/                  Python 학습 코드
└── tests/                     테스트 스크립트
```
