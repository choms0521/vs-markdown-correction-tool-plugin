# P3 Manual Smoke Test Checklist

본 문서는 P3 phase의 F5 수동 검증 체크리스트이다. 각 항목은 VSCode F5 디버그 세션에서 직접 확인하여야 한다.

## 사전 준비

1. 터미널에서 `npm run compile`과 `npm run compile:webview` 실행 (exit 0 확인).
2. VSCode에서 본 워크스페이스를 연다.
3. F5 (Run Extension) 키 입력 → "Extension Development Host" 창이 열림.
4. Extension Host 창에서 임의의 `.md` 파일을 준비 (예: README 등 200~500자 이상 본문 권장).

## 체크리스트

### 1. "Open with Markdown Review" 컨텍스트 메뉴 노출

- [x] `.md` 파일을 Explorer에서 우클릭 → "Open with..." 클릭
- [x] 목록에 "Markdown Review" 항목이 존재함
- [x] 항목 선택 시 WebView 패널이 열림

### 2. 본문이 markdown-it으로 렌더되어 표시

- [ ] heading (`#`, `##` 등), list (`-`, `1.`), code block(`...`)이 포맷되어 시각화됨
- [ ] inline `code`가 monospace 폰트 + 옅은 배경으로 표시됨
- [ ] 한국어 본문이 깨지지 않고 정상 표시됨

### 3. 본문 선택 시 인라인 오버레이 버튼 노출

- [ ] 본문 텍스트를 드래그로 선택
- [ ] 선택 종료 약 50ms 후 selection 상단에 "제안 추가" / "질문 추가" 버튼이 표시됨
- [ ] 선택 해제(다른 곳 클릭) 시 버튼이 사라짐

### 4. suggestion/question 추가 → 사이드 패널 항목 +1

- [ ] 임의 텍스트 선택 → "제안 추가" 클릭
- [ ] 사이드 패널의 코멘트 목록에 항목 1개가 추가됨
- [ ] 항목 라벨이 "제안"이고 본문이 "(원본) → (제안)" 형태로 표시됨
- [ ] 다른 텍스트 선택 → "질문 추가" 클릭 → 패널에 "질문" 항목이 +1 추가됨

### 5. 패널 항목 클릭 → 하이라이트

- [x] 패널 항목 클릭 시 해당 항목에 외곽선 하이라이트가 부착됨
- [ ] 약 1.5초 후 하이라이트가 자동 제거됨

### 6. [제출] 버튼 → placeholder toast

- [ ] 사이드 패널 하단 [제출] 버튼 클릭
- [ ] VSCode 우하단에 "제출은 P4 단계에서 LLM 호출로 활성화됩니다 (현재 placeholder)." 안내 toast 표시됨

### 7. 영속 round-trip (P2 통합 회귀)

- [ ] 코멘트 1개 이상 추가 후 WebView 패널 닫기
- [ ] 동일 `.md` 파일을 다시 "Open with → Markdown Review"로 열기
- [ ] 사이드 패널에 직전에 추가한 코멘트가 그대로 복원됨
- [ ] 워크스페이스 디렉토리에서 `.md.review.json` 사이드카 파일이 생성되어 있음 (default = sidecar backend)
- [ ] 사이드카 파일 내용을 텍스트 에디터로 열어 보면 zod schema 형식의 JSON임 (version: 1, comments: [...])

- [ ] WebView 패널을 활성화한 상태에서 Command Palette → "Developer: Open Webview Developer Tools" 실행

### 8. CSP 위반 0건 (DevTools 확인)

- [ ] WebView 패널을 활성화한 상태에서 Command Palette → "Developer: Open Webview Developer Tools" 실행
- [ ] DevTools Console 탭에 "Refused to" 또는 "Content Security Policy" 관련 에러가 없음
- [ ] Network 탭에서 모든 리소스(main.js, style.css)가 200 상태로 로드됨

### 9. backend 전환 (workspaceState)

- [ ] settings.json에 `"mdReview.persistenceBackend": "workspaceState"` 추가
- [ ] Command Palette → "Developer: Reload Window"로 reload
- [ ] 동일 `.md` 다시 열기 → 코멘트 추가
- [ ] 워크스페이스 디렉토리에 새 `.md.review.json` 사이드카가 **생성되지 않음** 확인 (이미 있는 파일은 무시)
- [ ] WebView 닫기 → 다시 열기 → 코멘트가 그대로 복원됨 (workspaceState backend가 정상 동작)

## 결과 기록

| 항목 | 결과 | 비고 |
| ---- | ---- | ---- |
| 1    | ☐    |      |
| 2    | ☐    |      |
| 3    | ☐    |      |
| 4    | ☐    |      |
| 5    | ☐    |      |
| 6    | ☐    |      |
| 7    | ☐    |      |
| 8    | ☐    |      |
| 9    | ☐    |      |

모든 항목이 PASS여야 P3 phase exit gate 통과로 인정한다.
