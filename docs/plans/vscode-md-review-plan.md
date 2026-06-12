# VSCode Markdown Inline Review Extension — Implementation Plan

- Plan ID: vscode-md-review-plan
- Generated: 2026-05-14 (Planner v3, Critic v2 ITERATE 후 surgical edits 4건 반영, Architect v3 재검토 생략)
- Source Spec: `.omc/specs/deep-interview-vscode-md-review.md` (ambiguity 7.7%, PASSED)
- History: `docs/plans/vscode-md-review-history.md`
- Type: greenfield
- Status: APPROVED (ralplan 3회차 통과, 2026-05-14)
- Mode: SHORT for P0/P2/P3/P5, DELIBERATE for P1 / P6 (high-risk surfaces)

## 0. Executive Summary

VSCode Extension(TypeScript) 형태로 동작하는 마크다운 인라인 리뷰 도구를 구현한다. 사용자는 활성 `.md` 파일의 포맷된 프리뷰 위에 suggestion(before/after) 또는 question 코멘트를 인라인으로 anchor한 뒤, 단일 LLM(claude / codex / gemini 중 settings 기반 default)을 **node-pty interactive CLI 세션**으로 호출하여 envelope-wrapped 단일 프롬프트를 송신하고, PROMPT_END 토큰으로 echo 영역을 분리한 뒤 sentinel(+200ms quiet period) + shell prompt + 90s timeout 삼중 detector로 응답 종료를 감지하고, `vscode.diff` editor의 hunk별 승인 흐름을 거쳐 `WorkspaceEdit`으로 본문에 반영한다.

핵심 비즈니스 제약: `claude -p` 같은 print mode는 Pro/Max 구독과 별개 종량 과금이 발생하므로 **절대 금지**한다. settings의 args + command basename 모두 화이트리스트로 강제 검증한다.

총 8개 Phase로 분해하며 (P0, P0.5, P1..P6), 누적 소요는 약 12.5 ~ 15.0 작업일로 추정한다. v3의 surgical edits는 코드 수정 / P0.5 흡수 / P4 흡수 만으로 처리되어 **phase 일정 증가 없음**.

---
---

## 1. RALPLAN-DR 합의 요약

### 1.1 Principles (설계 원칙 5개)

1. **No per-call billing**: 어떤 경로로도 `claude -p`, `codex -p` 같은 print mode 호출을 발생시키지 않는다. 모든 LLM 호출은 interactive CLI 세션을 통해서만 일어난다. 이 원칙은 CI lint, code review checklist, runtime guard(args + command basename 이중 화이트리스트, v3-Edit-3) 세 곳에서 강제한다. (Edit-4, v3-Edit-3)
2. **VSCode-native first**: 별도 daemon, 별도 host process, 별도 system 의존(tmux 등)을 도입하지 않는다. VSCode Extension Host가 모든 lifecycle을 직접 소유한다. node-pty native 모듈만 의존한다.
3. **Single file unit of work**: 작업 범위는 활성 `.md` 파일 한 개로 한정한다. 워크스페이스 전체 처리, 여러 파일 batch는 비범위. 이 원칙으로 상태 관리, undo 의미론, 충돌 가능성을 모두 단순화한다.
4. **Defense in depth for termination — 2단계 합의 구조 (Edit-9)**: Interactive CLI는 spec상 명시적 종료 신호가 없다. 이는 ad-hoc workaround가 아니라 사용자가 명세서 § Constraints에서 직접 요구한 설계다. 본 plan의 detector는 **단일 신호로 종료를 판정하지 않는다**. 다음 2단계 합의가 모두 성립해야 종료로 판정한다.
   - **Stage A (envelope 통과)**: buffer에서 `<<<END-{uuid}>>>` 토큰을 만나야 한다. 이전 영역은 PTY echo로 간주하여 폐기.
   - **Stage B (응답 영역 detector 일치)**: Stage A 이후 영역에서 다음 중 하나가 검출되어야 한다.
     - B1 — Sentinel `<<<DONE-{uuid}>>>` (primary, deterministic) + 200ms quiet period (v3-Edit-1). `lastIndexOf`로 응답 마지막 occurrence만 사용 → R-15 대응. quiet period 동안 추가 chunk가 도착하면 timer 재설정 + final lastIndexOf 재평가 → R-16 대응.
     - B2 — Provider별 shell prompt 정규식 (secondary, deterministic on prompt match). DetectorStrategy로 provider별 캡슐화.
     - B3 — 90s hard timeout (tertiary, liveness guarantee). v1의 30s에서 90s로 격상 (장문 응답 + thinking 토큰 고려, Edit-1).
   - 즉 종료 = `Stage A ∧ (B1 ∨ B2 ∨ B3)`. envelope 통과 전에 buffer에 sentinel이 우연히 출현해도 무시한다.
5. **Human-in-the-loop for application**: LLM 응답을 자동 적용하지 않는다. 반드시 `vscode.diff` editor의 hunk별 승인을 거친다. 자동 적용은 의도적으로 non-goal로 둔다.

### 1.2 Decision Drivers (우선순위 Top 3)

| 순위 | Driver | 가중치 | 비고 |
|---|---|---|---|
| 1 | 비용 회피 (per-call billing 금지) | High | 본 확장 존재 이유. print mode 사용 시 사용자가 구독료 외 추가 과금. args + command basename 이중 화이트리스트로 runtime 강제 (Edit-4, v3-Edit-3). |
| 2 | VSCode 친화성 (Extension Host 단일 lifecycle) | High | tmux 같은 외부 환경 의존을 도입하면 Windows·기업 환경 배포가 무너진다. |
| 3 | 설치 단순성 (native 빌드 함정 최소화) | Medium | node-pty native binary가 Electron 버전과 정합해야 함. vsce platform-specific vsix로 흡수. |

### 1.3 Viable Options (검토한 대안 ≥2개)

#### Option A — node-pty + Interactive CLI (채택안)

VSCode Extension Host가 `node-pty.spawn()`으로 `claude` / `codex` / `gemini` 바이너리를 interactive 모드로 띄우고, envelope-wrapped 프롬프트를 `pty.write()`로 주입한 뒤 `pty.onData()`로 응답을 수신한다.

- Pros
  - print mode를 거치지 않으므로 종량 과금 0건 보장.
  - VSCode 내장 터미널이 동일 패턴으로 검증되어 있다 (안정성 입증).
  - 외부 system 의존 없음 (tmux, screen 불필요).
  - lifecycle을 Extension Host가 직접 소유 → leak 추적 용이.
- Cons
  - native 모듈이므로 Electron 버전마다 prebuild 필요.
  - cross-platform (특히 Windows ConPTY) 미세 함정 존재.
  - 종료 감지가 명시적이지 않아 envelope + sentinel + secondary detector 설계가 필요.
  - PTY echo·multiline submit semantics가 provider마다 다를 수 있어 P0.5 spike 필요 (Edit-2).

#### Option B — tmux pipe-pane + send-keys

별도 tmux 세션을 만들고 `tmux send-keys`로 프롬프트 송신, `tmux pipe-pane`으로 출력 캡처.

- Pros
  - 사용자가 외부에서도 동일 세션을 들여다볼 수 있어 디버깅 친화적.
  - 사용자의 초기 의도와 가장 가까움 (Round 3 인터뷰 출발점).
- Cons
  - **tmux를 별도 설치/설정해야 함** — VSCode 확장 단일 설치로 끝나지 않음 (설치 단순성 driver 위배).
  - Windows에서 native tmux 미지원 (WSL 우회 필요).
  - VSCode Extension Host에서 별도 child process 트리를 lifecycle 추적해야 해 leak 위험.
  - pane buffer 파싱이 ANSI + tmux 자체 escape까지 겹쳐 더 복잡.
- **Invalidation 근거**: 설치 단순성 driver(우선순위 3)와 VSCode 친화성 driver(우선순위 2)를 동시 위배. 사용자 본인이 Round 5에서 "tmux는 시작점이지 목적지가 아니다" 명시. 채택 불가.

#### Option C — VSCode Terminal API + Pseudo-shell hijack

`vscode.window.createTerminal({ pty: ... })`를 이용해 VSCode 내장 터미널 UI 위에 pseudoterminal을 띄우고, 그 안에서 CLI를 spawn.

- Pros
  - 사용자가 응답 stream을 그대로 볼 수 있어 투명성 높음.
  - VSCode API 표준 경로 (`Pseudoterminal` interface).
- Cons
  - **출력 capture가 어렵다** — VSCode Terminal API는 출력 수신용 callback을 외부에 노출하지 않음 (write는 가능하지만 read는 UI 전용).
  - 결과적으로 sentinel detection을 위해 우회로(별도 pipe, intermediate process)가 필요해져 복잡도 증가.
  - 사용자가 실수로 터미널을 닫으면 세션 leak.
- **Invalidation 근거**: 출력 capture를 안정적으로 할 수 없어 응답 종료 감지가 fragile. 핵심 success criteria(envelope + sentinel + multi-tier detector)를 만족 못함. 채택 불가.

#### Option D — child_process + non-interactive `-p` print mode

`child_process.spawn('claude', ['-p', prompt])`로 단발 호출.

- Pros
  - 구현이 가장 간단 (PTY 불필요, sentinel 불필요).
  - 출력이 stdout으로 깔끔히 옴.
- Cons
  - **즉시 무효**: `claude -p`는 Pro/Max 구독과 별개 종량 과금 발생. 본 확장의 존재 이유와 정면 충돌.
- **Invalidation 근거**: Principle 1(no per-call billing)과 Decision Driver 1을 직접 위배. 사용자 명시 거부 (Round 4). 채택 불가.

#### Option E — claude `--output-format stream-json` (interactive 안에서 슬래시 명령으로 활성) (Edit-6, 잠정)

interactive 모드를 유지하면서 응답을 stream-json 포맷으로 받아 종료 토큰을 deterministic하게 검출.

- Pros (잠정)
  - sentinel envelope 없이도 JSON message boundary로 종료 판정 가능.
  - thinking/메타텍스트가 별도 type으로 분리되어 추출 신뢰성 상승.
- Cons (잠정, v3-Edit-2 격상)
  - 슬래시 명령 활성이 interactive 안에서 가능한지 미확정.
  - **과금 발생 가능성을 tcpdump baseline 대비 outbound TLS connection 차이 0건으로 확인 필요** — Anthropic dashboard는 최대 24h 지연되므로 ground truth가 아님. P0.5 spike에서 network probe로 실측 검증 (v3-Edit-2).
  - claude/codex/gemini 간 지원 편차 가능.
- **상태**: P0.5 Provider Spike(Edit-2, v3-Edit-2)에서 다음 두 가지를 실측한다.
  - (E1) interactive 세션 안에서 슬래시 명령으로 stream-json 활성이 되는가?
  - (E2) 활성 시 사용자 dashboard에서 종량 과금이 발생하는가? + **tcpdump baseline 대비 추가 outbound TLS connection이 발생하는가? (v3-Edit-2 ground truth)**
- **잠정 invalidation 근거**: E2가 yes(dashboard) 또는 tcpdump diff > 0이면 Option E는 Driver 1 위배로 즉시 기각. E1이 no이면 자동 기각.
- **확정 시점**: P0.5 종료 시 본 § 1.3을 surgical edit으로 확정 (v4 또는 P1 코드 흡수). v3에서는 잠정 상태 유지.

### 1.4 채택안 선택 근거 callout

> **Why Option A**:
> 본 프로젝트의 1순위 driver인 "비용 회피"를 만족하는 유일한 검증 완료 선택지다. tmux(B), VSCode Terminal API(C) 모두 비용 driver는 만족하지만 각각 설치 단순성·출력 capture 안정성에서 실격된다. child_process(D)는 cost driver 자체를 위배한다. Option E(stream-json)는 P0.5 spike의 tcpdump network probe(v3-Edit-2) 결과에 따라 보조 채택 가능성을 열어둔다 (단 tcpdump diff 0건일 때만). node-pty는 VSCode 내장 터미널과 동일 라이브러리이므로 호환성·안정성이 이미 검증되어 있어 native 빌드 함정(Cons)을 감수할 만하다.

---

## 2. Phase별 구현 단계

각 Phase는 측정 가능한 종료 조건(grep/npm test/명령 실행)을 포함한다. "정상 동작" 같은 모호한 표현은 사용하지 않는다.

### P0 — 스캐폴딩 (Scaffolding)

- **목표**: TypeScript VSCode Extension 보일러플레이트를 만들고, node-pty native 모듈 빌드 환경을 검증한다.
- **산출물**
  - `package.json` (engines.vscode 명시, activationEvents, contributes.commands, contributes.configuration)
  - `tsconfig.json` (strict 모드)
  - `src/extension.ts` (activate / deactivate skeleton)
  - `.vscode/launch.json` (Extension Development Host 실행 설정)
  - `.vscodeignore`, `.gitignore`
  - `node-pty` 종속성 추가 및 Electron rebuild script
  - ESLint + Prettier 설정
  - CI workflow skeleton (lint + build matrix: macOS, Linux)
- **측정 가능한 종료 조건**
  - `npm run compile` → exit code 0
  - `npm run lint` → 0 errors
  - `node -e "require('node-pty')"` → exit code 0 (rebuild 후)
  - VSCode F5 디버그 실행 → activate 로그 1줄 이상 출력 (수동 검증)
  - `grep -rE '"-p"|"--print"' src/` → 0건 (cost guard lint)
- **예상 소요**: 1.0 작업일
- **핵심 위험**: node-pty prebuild 누락으로 Electron 버전 mismatch. P0 단계에서 미리 잡지 않으면 P1에서 막힌다.

### P0.5 — Provider Spike (NEW, Edit-2, v3-Edit-2 ground-truth 확장)

- **목표**: claude / codex / gemini 각 CLI를 node-pty로 직접 spawn하여 다음 4개 차원을 실측하고 provider matrix를 확정한다. P1 구현 전 모든 모호 항목을 0건으로 만든다. **v3에서는 dashboard 의존을 제거하고 tcpdump network probe로 ground truth 검증을 추가한다 (v3-Edit-2)**.
- **실측 차원**
  1. **submit key 의미론**: `\r` / `\r\n` / `\x1b[200~...prompt...\x1b[201~` bracketed paste 중 어느 것이 multiline 프롬프트를 한 번에 submit하는가. provider별로 다를 수 있음.
  2. **shell prompt 복귀 ANSI 패턴**: 응답 종료 후 출력되는 prompt 패턴. claude는 `\n│ > `, codex/gemini는 미실측. 정규식을 실측 후 확정.
  3. **echo back 발생 여부 + skip byte 계산법**: PTY는 입력을 echo back하므로 응답 buffer 앞쪽에 프롬프트 자체가 출현. envelope `<<<END-{uuid}>>>`로 skip 처리(Edit-1)하되, envelope 외에도 별도 echo 정화 규칙이 필요한지 실측.
  4. **`--output-format json` / stream-json 가용성 + 과금 영향 (Edit-6, v3-Edit-2)**: interactive 안에서 슬래시 명령(`/json` 등)으로 stream-json 활성이 가능한지, 활성 시 사용자 dashboard에 종량 과금이 발생하는지 + **tcpdump baseline 대비 추가 outbound TLS connection이 발생하는지 (v3-Edit-2 ground truth)**.
- **산출물**
  - `.omc/specs/provider-detector-matrix.md` — 3개 provider × 4개 차원 매트릭스. 각 셀에 실측값 + 재현 명령 + 측정 일자 + 측정자 기록.
  - 매트릭스 항목 예시 (마크다운 표):

    ```
    | Provider | submit key | prompt regex | echo skip | stream-json | 과금 발생 |
    |---|---|---|---|---|---|
    | claude | \r | /\n\s*│\s*>\s*$/ | envelope만 | (P0.5 실측 결과) | (P0.5 실측 결과) |
    | codex  | (P0.5 실측 결과) | (P0.5 실측 결과) | (P0.5 실측 결과) | (P0.5 실측 결과) | (P0.5 실측 결과) |
    | gemini | (P0.5 실측 결과) | (P0.5 실측 결과) | (P0.5 실측 결과) | (P0.5 실측 결과) | (P0.5 실측 결과) |
    ```

  - `scripts/spike/probe-{claude,codex,gemini}.ts` — 각 provider 1회 round-trip 측정 스크립트. node-pty로 spawn → envelope 송신 → onData chunks를 stdout에 raw dump → 종료.
  - **`scripts/spike/network-probe.sh` (v3-Edit-2)** — provider별 baseline pcap + stream-json 활성 후 pcap 캡처 + 차이 비교 스크립트.
- **측정 가능한 종료 조건**
  - `.omc/specs/provider-detector-matrix.md` 존재 + claude/codex/gemini 3 row 모두 채워짐
  - matrix 안 "(P0.5 실측 결과)" plaintext 잔존 0건: `grep -c "(P0.5 실측 결과)" .omc/specs/provider-detector-matrix.md` → 0
  - matrix 안 "TBD" / "unknown" / "?" 잔존 0건: `grep -cE "TBD|unknown|\\?\$" .omc/specs/provider-detector-matrix.md` → 0
  - 각 probe 스크립트 1회 실행 → exit code 0
  - claude/codex/gemini dashboard 캡처 첨부 (사용자 수동): stream-json 활성 전후 과금 0건 또는 발생량 명시
  - **(v3-Edit-2) tcpdump network probe ground truth 검증**:
    - probe 실행 중 `sudo tcpdump -nn -i any 'host api.anthropic.com or host generativelanguage.googleapis.com' -w probe-{provider}-baseline.pcap` 캡처 (baseline = slash 명령 없이 round-trip)
    - stream-json 활성 후 동일 cmd로 `probe-{provider}-streamjson.pcap` 캡처
    - 종료 조건: `tcpdump -r probe-{provider}-streamjson.pcap | wc -l` - `tcpdump -r probe-{provider}-baseline.pcap | wc -l` = 0 (또는 명시적 차이값을 matrix에 기록)
    - macOS 환경에서는 `sudo nettop -P -t wifi -t wired -m tcp -k all` 대체 가능 (README + matrix 헤더에 명시)
    - 권한 미부여 환경 fallback: `lsof -i 4tcp@api.anthropic.com:443` polling으로 outbound TLS connection 검출
- **예상 소요**: 0.5 작업일 (v3-Edit-2의 network probe는 동일 spike 안에 흡수)
- **핵심 위험**: codex/gemini의 prompt 정규식이 PTY 환경에서 ANSI 시퀀스로 인해 grep으로 못 잡히는 경우 → AnsiSanitizer 적용 후 다시 측정. probe 스크립트가 raw + sanitized 두 버전을 stdout에 dump하도록 설계.

### P1 — PTY 코어 (PTY Core, DELIBERATE — Edit-8 격상)

- **목표**: node-pty 세션 spawn/kill, envelope-aware TerminationDetector(+ 200ms quiet period, v3-Edit-1), provider별 DetectorStrategy, ANSI 정화를 독립 모듈로 구현하고 단위 + 통합 + 관찰성 테스트로 검증한다. P0.5 matrix 결과를 본 phase에서 코드로 흡수한다.
- **산출물 (Edit-3, Edit-5 반영 + v3-Edit-4 정리)**
  - `src/pty/NodePtySession.ts`
    - 시그니처: `spawn(command: string, args: string[], cwd: string, env: Record<string,string>): NodePtySession`
    - default (Edit-3):
      - `cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()`
      - `env = process.env` (사용자 `~/.claude` ambient context 상속 필수)
    - test mode (Edit-3):
      - `cwd = <tempdir>` (`fs.mkdtempSync`)
      - `env = { ...process.env, HOME: <sandbox>, NO_COLOR: '1' }`
    - 메서드: `write(payload: string): void`, `onData(handler: (chunk: string) => void): Disposable`, `kill(signal: 'SIGTERM' | 'SIGKILL', forceTimeoutMs: number): Promise<void>`
  - `src/pty/TerminationDetector.ts` (Edit-1 envelope + v3-Edit-1 quiet period 의사 코드 채택, § 9 참조)
  - `src/pty/AnsiSanitizer.ts` — `strip-ansi` wrapper, NO_COLOR 환경에서도 ANSI escape가 누설될 경우 보강 정화
  - `src/pty/ResponseExtractor.ts` — Stage A 통과 후 buffer에서 sentinel 위쪽 fenced markdown block 우선 추출
  - `src/pty/detector/` 디렉토리 (Edit-5)
    - `DetectorStrategy.ts` — interface (v3-Edit-4 정리: `computeEchoSkipBytes` 제거)
      ```typescript
      // envelope으로 echo skip이 해결되어 strategy의 echo 처리 메서드는 불필요 (v3-Edit-4)
      interface DetectorStrategy {
        readonly providerName: string;
        readonly submitKey: '\r' | '\r\n' | 'bracketed-paste';
        readonly shellPromptRegex: RegExp;
      }
      ```
    - `ClaudeDetector.ts`, `CodexDetector.ts`, `GeminiDetector.ts` — P0.5 matrix 값을 코드로 반영
    - `DetectorFactory.ts` — `providerName: 'claude' | 'codex' | 'gemini'` → strategy
  - `test/pty/*.test.ts` (mocha + chai)
- **측정 가능한 종료 조건**
  - `npm test -- --grep TerminationDetector` → all green
  - **Edit-1 envelope 통과 케이스**: prompt에 sentinel이 포함되어 PTY echo로 buffer 앞쪽에 sentinel이 나오더라도 PROMPT_END 도달 전이면 resolve 호출 0회 → spy assert 통과
  - **Edit-10 + v3-Edit-1 echo case 6종 단위 테스트** (sentinel 검출 전 PROMPT_END 검증 + quiet period):
    1. echo 영역에 sentinel 우연 포함 → resolve 호출 X
    2. PROMPT_END 검출 후 응답 영역에 sentinel 1회 → 200ms idle 후 resolve 호출 1회
    3. 응답 영역에 sentinel 2회 (LLM이 중복 출력) → `lastIndexOf`로 마지막만 사용 (R-15 대응)
    4. PROMPT_END 검출 후 shell prompt regex 일치 (sentinel 없음) → resolve via B2
    5. 90s 안에 어떤 신호도 없음 → reject via B3
    6. **(v3-Edit-1 NEW)** sentinel 검출 후 150ms 시점에 추가 chunk 1건 도착 → 응답 미완료로 판정되고 quiet timer 재설정 + 최종 sentinel만 매칭 + 추가 200ms idle 후 resolve. 결과 buffer는 trailing chunk를 포함하지 않은 final sentinel 위쪽까지로 trim (R-16 대응)
  - sentinel 정상 감지 케이스: 응답에 `<<<DONE-{uuid}>>>` 포함 시 200ms idle 후 resolve, sentinel 위쪽 buffer만 반환 → assert 통과
  - ANSI escape 시퀀스 포함 chunk 입력 시 정화 후 buffer 누적 → `expect(buffer).not.toMatch(/\x1b\[/)` 통과
  - `kill('SIGTERM', 2000)` 호출 후 2초 내 미종료 시 `SIGKILL` 전송 → `lsof -p <pid>` 0건 (수동 검증)
  - 정적 검사: `grep -rE '"-p"|"--print"' src/pty/` → 0건
  - DetectorFactory 분기: `expect(DetectorFactory.for('claude')).toBeInstanceOf(ClaudeDetector)` 등 3종 assert
  - **Integration (Edit-8)**: 실제 `claude` CLI를 cwd=`/tmp/empty-md-review` + env={HOME=`/tmp/sandbox`, NO_COLOR='1'}에서 1회 round-trip → revisedMarkdown 반환 → 종료. 사용자 dashboard에서 과금 0건 확인 (수동).
  - **Observability (Edit-8 + Edit-11)**: OutputChannel에 raw chunks 첫 10개 + `prompt-end-detected` + `sentinel-detected` + `echo-rejected` + `submit-key-sent` 이벤트가 모두 로깅됨을 통합 테스트에서 grep 검증 (`grep -c 'event=prompt-end-detected' output.log >= 1` 등).
- **예상 소요**: 2.5 작업일 (v1의 2.0d + deliberate 추가 0.5d; v3 surgical edits는 코드 내 ~15 lines 추가만으로 흡수되어 일정 증가 0d)

#### P1 Pre-mortem (DELIBERATE, Edit-8)

세 가지 실패 시나리오를 사전에 정의하고 완화책을 박아둔다.

1. **시나리오 P1-A — PTY echo로 인한 false-resolve**
   - 사건: PTY가 입력을 echo back하므로 buffer 앞쪽에 prompt가 그대로 출현. prompt 안 `<<<DONE-{uuid}>>>` 토큰이 그대로 buffer에 들어가 즉시 false-resolve.
   - 완화: Edit-1 envelope 도입. Stage A(PROMPT_END 검출) 통과 전에는 buffer를 응답으로 간주하지 않음. `<<<END-{uuid}>>>` 토큰을 만나면 그 이후 영역만 응답으로 분리.
2. **시나리오 P1-B — `\r\n` enter 시 multiline submit이 첫 줄에서 멈춤**
   - 사건: claude REPL이 `\r\n`을 줄바꿈으로만 받고 submit으로 인식하지 않아 첫 줄만 송신되고 응답이 즉시 partial로 돌아옴.
   - 완화: Edit-2 P0.5 spike에서 provider별 submit key를 실측 확정. ClaudeDetector/CodexDetector/GeminiDetector의 `submitKey` 필드로 반영. bracketed paste(`\x1b[200~...\x1b[201~`)가 안전한 default.
3. **시나리오 P1-C — claude REPL이 응답 중간에 `> ` prompt를 출력**
   - 사건: thinking 표시나 tool use UI 갱신 과정에서 `\n│ > ` 같은 prompt 유사 패턴이 응답 stream에 섞일 수 있음.
   - 완화: Edit-1 Stage A로 envelope 이전 영역을 폐기. Stage B의 shell prompt regex는 envelope 이후 응답 영역에서만 평가. 추가로 detector strategy의 prompt regex를 매우 엄격하게(`^` anchor + ANSI sanitize 후) 작성.

#### P1 확장 Test Plan (DELIBERATE, Edit-8)

- **Unit**: TerminationDetector echo case 6종 (v3-Edit-1 quiet period 포함) + DetectorStrategy 3종 분기 + AnsiSanitizer 누설 보강 케이스. 누적 coverage ≥ 80%.
- **Integration**: 실제 `claude` CLI 1회 round-trip (cwd=tempdir, env=sandbox, NO_COLOR=1). 응답 추출 + 종료 확인. 사용자 dashboard 과금 0건 (수동 검증, screenshot 첨부).
- **Observability**: OutputChannel에 다음 이벤트 모두 발생 (grep 검증):
  - `event=submit-key-sent provider=<name> submitKey=<key>` (Edit-11)
  - `event=prompt-end-detected provider=<name> elapsedMs=<n>` (Edit-11)
  - `event=echo-rejected provider=<name> bytes=<n>` (Edit-11)
  - `event=sentinel-detected provider=<name> elapsedMs=<n>`
- **E2E (수동)**: 사용자가 직접 F5 디버그 → P1 코드 직접 호출 (UI 없이 command palette) → claude round-trip → revisedMarkdown stdout 출력 확인.

- **핵심 위험**: shell prompt 정규식이 CLI UI 업데이트로 깨질 수 있음 → 정규식을 settings로 노출하고 default 외 override 가능하게 설계 (F-1). DetectorStrategy 패턴으로 provider별 격리.

### P2 — 코멘트 데이터 모델 + 영속화 (Comment Model & Persistence)

- **목표**: Comment 엔티티, CommentStore, 사이드카 영속화를 구현하고 round-trip 검증한다.
- **산출물**
  - `src/model/Comment.ts` — `interface Comment { id: string; type: 'suggestion' | 'question'; anchor: { line: number; col: number; length: number }; before?: string; after?: string; note?: string; createdAt: string; }`
  - `src/store/CommentStore.ts` — `load(docUri)`, `save(docUri, comments)`, `add`, `update`, `remove`, `list`
  - `src/store/SidecarPersistence.ts` — `.md.review.json` read/write (immutable 패턴: 새 객체 반환)
  - `src/store/WorkspaceStatePersistence.ts` — secondary persistence backend (사용자가 settings로 명시 선택; 두 backend는 mutually exclusive)
  - `test/store/*.test.ts`
- **측정 가능한 종료 조건**
  - `npm test -- --grep CommentStore` → all green
  - `add → save → load → list` round-trip 시 입력 객체와 출력 객체 deep-equal 통과
  - Immutability 확인: `add` 호출 전후 원본 array reference 변화 없음 (`expect(originalRef).toBe(originalRef)`, 새 배열은 다른 reference)
  - `.md.review.json` 사이드카 schema: zod `parse()` 성공
  - Schema validation 실패 케이스: 잘못된 JSON 입력 시 throw → assert
  - 한자 사용 정적 검증: `grep -P '[\x{4E00}-\x{9FFF}]' src/` → 0건
- **예상 소요**: 1.5 작업일
- **핵심 위험**: 사이드카 vs workspaceState 동시 활성화 시 우선순위 모호 → 두 backend를 mutually exclusive로 강제 (settings flag로 한쪽만 선택, 자동 전환 금지).

### P3 — 마크다운 리뷰 WebView (Review Editor UI)

- **목표**: CustomTextEditor 기반 WebView를 띄우고, `markdown-it` 렌더링 + inline comment overlay + 사이드 panel 코멘트 목록을 구현한다.
- **산출물**
  - `src/editor/MarkdownReviewEditor.ts` — `CustomTextEditorProvider` 구현
  - `src/editor/WebViewBridge.ts` — `postMessage` / `onDidReceiveMessage` wrapper, anchor 정보만 전달 (본문은 Extension Host 보유)
  - `media/webview/index.html` + `media/webview/main.ts` (vanilla TS, 추후 Lit/Preact 검토)
  - `media/webview/inline-overlay.ts` — 선택 구간에 suggestion/question 코멘트 부착 UI
  - `media/webview/comment-panel.ts` — 사이드 panel 목록 + 위치 이동/하이라이트 + [제출] 버튼
  - `src/editor/AnchorResolver.ts` — selection → (line, col, length) 변환
- **측정 가능한 종료 조건**
  - F5 디버그 실행 후 `.md` 파일을 우클릭 → "Open with Markdown Review" 명령으로 WebView 열림 (수동 검증, 스크린샷 첨부)
  - WebView 안에서 텍스트 선택 + suggestion 추가 → 사이드 panel 목록에 항목 1개 추가 (수동 검증)
  - 사이드 panel 항목 클릭 → WebView 본문에서 해당 anchor highlight → `data-comment-id` 속성으로 DOM 검증 (수동)
  - WebView `postMessage` payload size: 단일 코멘트 추가 시 `JSON.stringify(payload).length` < 2KB (성능 가드)
  - Comment 추가 후 영속: WebView 닫고 다시 열어도 코멘트 유지 (P2와 통합 회귀 테스트)
  - `npm test -- --grep AnchorResolver` → all green (line/col 계산 unit test)
- **예상 소요**: 2.5 작업일
- **핵심 위험**: 대용량 `.md` (>500KB)에서 WebView 직렬화 부담 → 본문은 Extension Host가 보유하고 WebView에 anchor만 전달 (Spec Risk 5).

### P4 — 제출 흐름 (Submit Flow)

- **목표**: PromptBuilder + LLMOrchestrator + ResponseExtractor를 연결하여 [제출] 버튼 → LLM 호출 → 응답 추출까지 단일 흐름을 완성한다. envelope 송신 + args 화이트리스트 + command basename 화이트리스트(v3-Edit-3)를 본 phase에서 통합한다.
- **산출물 (Edit-4 + v3-Edit-3 반영)**
  - `src/llm/PromptBuilder.ts`:
    - 시그니처: `build(document, comments, uuid): { prompt: string; envelopeBegin: string; envelopeEnd: string; sentinel: string }`
    - 송신 형식 (Edit-1):
      ```
      <<<BEGIN-{uuid}>>>
      [수정 지시 본문 + 코멘트들...]
      응답 마지막에 정확히 다음 한 줄: <<<DONE-{uuid}>>>
      <<<END-{uuid}>>>
      ```
    - uuid는 매 호출마다 `randomUUID()`로 재생성 → R-15 (sentinel 본문 우연 충돌) 1차 방어
  - `src/llm/ProviderConfig.ts` — settings.json에서 providers, defaultProvider, sentinelTimeoutMs(default 90_000), stripAnsi, persistenceBackend 로드 + zod validation. **args + command basename 이중 화이트리스트 검증 (Edit-4 + v3-Edit-3)**:
    ```typescript
    const ALLOWED_ARGS: Record<string, ReadonlySet<string>> = {
      claude: new Set([]),  // interactive 모드 default args만 허용
      codex:  new Set([]),
      gemini: new Set([]),
    };

    // v3-Edit-3: command basename 화이트리스트
    const ALLOWED_COMMAND_BASENAMES: Record<string, string> = {
      claude: 'claude',
      codex:  'codex',
      gemini: 'gemini',
    };

    function validateCommand(provider: string, command: string): void {
      const basename = command.split('/').pop() ?? '';
      if (basename !== ALLOWED_COMMAND_BASENAMES[provider]) {
        throw new Error(
          `[mdReview] provider ${provider}의 command basename은 '${ALLOWED_COMMAND_BASENAMES[provider]}'만 허용됨. ` +
          `현재: '${basename}'. wrapper script 사용은 비용 driver 위반 위험.`
        );
      }
      outputChannel.appendLine(`[cost-guard] resolved-command=${command} basename=${basename}`);
    }

    function validateArgs(provider: 'claude'|'codex'|'gemini', args: string[]): void {
      const allowed = ALLOWED_ARGS[provider];
      const violating = args.filter(a => !allowed.has(a));
      if (violating.length > 0) {
        throw new Error(`mdReview: provider "${provider}"에 허용되지 않은 args 발견: ${violating.join(', ')}. 종량 과금 위험으로 spawn을 거부합니다.`);
      }
    }

    // zod schema도 v3-Edit-3 갱신:
    const ProviderConfigSchema = z.object({
      command: z.string().regex(
        /^(?:.*\/)?(?:claude|codex|gemini)$/,
        "허용된 binary basename만 가능 (claude/codex/gemini)"
      ),
      args: z.array(z.string()),  // 기존 화이트리스트 검증
      cwd: z.string().optional(),
      env: z.record(z.string()).optional(),
    });
    ```
    - 검증 실패 시 OutputChannel에 `event=args-whitelist-violation provider=<name> rejected=<args>` 또는 `[cost-guard] basename-mismatch` 로깅.
  - `src/llm/LLMOrchestrator.ts` — `submit(document, comments)`:
    1. `uuid = randomUUID()`
    2. `{ prompt, envelopeBegin, envelopeEnd, sentinel } = PromptBuilder.build(document, comments, uuid)`
    3. `provider = ProviderConfig.getDefault()`
    4. `validateCommand(provider.name, provider.command)` — basename 화이트리스트 (v3-Edit-3)
    5. `validateArgs(provider.name, provider.args)` — args 화이트리스트 (Edit-4)
    6. `strategy = DetectorFactory.for(provider.name)` — Edit-5
    7. `session = NodePtySession.spawn(provider.command, provider.args, provider.cwd ?? wsRoot, provider.env ?? process.env)` — Edit-3
    8. `detector = new TerminationDetector(envelopeEnd, sentinel, strategy.shellPromptRegex, resolve, reject)`
    9. `session.onData(chunk => detector.feed(chunk))`
    10. `session.write(prompt + (strategy.submitKey === '\r' ? '\r' : strategy.submitKey === '\r\n' ? '\r\n' : `\x1b[200~${prompt}\x1b[201~`))`
    11. OutputChannel에 `event=submit-key-sent provider=<name> submitKey=<key>` 로깅 (Edit-11)
    12. `await promise` → revisedMarkdown
    13. `finally: session.kill('SIGTERM', 2000)`
  - `src/llm/ResponseExtractor.ts` — Stage A 통과 후 buffer에서 fenced markdown block 우선 추출, 없으면 전체 trim 반환
  - `test/llm/*.test.ts` (PromptBuilder unit, mock pty session으로 LLMOrchestrator integration, args 화이트리스트 unit, **command basename 화이트리스트 unit (v3-Edit-3)**)
- **측정 가능한 종료 조건**
  - `npm test -- --grep PromptBuilder` → all green
  - 빌드된 프롬프트 안에 envelope/sentinel 정확히 1회씩 포함: `expect(prompt.match(/<<<BEGIN-/g).length).toBe(1)`, `<<<END-/g` 1회, `<<<DONE-/g` 1회
  - 프롬프트의 uuid가 매 호출마다 다름: 100회 build 호출 후 unique uuid set size === 100
  - 정적 검사: `grep -rE '(\-p|\-\-print)\b' src/llm/` → 0건 (cost guard)
  - **args 화이트리스트 단위 테스트 (Edit-4)**:
    - `validateArgs('claude', [])` → no throw
    - `validateArgs('claude', ['-p'])` → throws with 한국어 메시지 포함 `'-p'`
    - `validateArgs('claude', ['--print'])` → throws
    - `validateArgs('codex', ['--anything'])` → throws (claude 외 provider도 동일하게 엄격)
  - **command basename 화이트리스트 단위 테스트 (v3-Edit-3)**:
    - `validateCommand('claude', 'claude')` → no throw
    - `validateCommand('claude', '/usr/local/bin/claude')` → no throw (절대경로 OK)
    - `validateCommand('claude', 'claude-wrapper')` → throws with `'claude-wrapper'` 포함
    - `validateCommand('claude', '/path/to/billable-claude')` → throws with `'billable-claude'` 포함
    - 검증 시 OutputChannel에 `[cost-guard] resolved-command=... basename=...` 1줄 또는 `[cost-guard] basename-mismatch` 로깅
  - Mock PTY 통합 테스트: pre-recorded ANSI 포함 응답 stream을 `feed`했을 때 envelope 통과 후 sentinel 위쪽 markdown만 반환 → assert
  - 한자 정적 검증: `grep -P '[\x{4E00}-\x{9FFF}]' src/llm/` → 0건
  - 실제 `claude` CLI 통합(local 환경에서 수동): submit 후 90초 이내 revised markdown 반환, 과금 API 호출 0건 (사용자가 claude dashboard에서 확인)
- **예상 소요**: 2.0 작업일 (v3-Edit-3은 ~10 lines 추가만으로 동일 phase에 흡수, 일정 증가 0d)
- **핵심 위험**: LLM이 sentinel 지시를 무시하고 thinking/메타텍스트를 섞어 반환 → PromptBuilder에서 출력 형식을 매우 명시적으로 지시 + ResponseExtractor에서 fenced block 우선 추출 (Spec Risk 4 대응).

### P5 — Diff 적용 (Diff & WorkspaceEdit)

- **목표**: `vscode.diff` editor에 원본 vs 수정본을 표시하고, hunk별 승인 후 `WorkspaceEdit`으로 본문에 반영한다.
- **산출물**
  - `src/diff/DiffPresenter.ts` — `present(original, revised)`:
    1. revised content를 임시 untitled scheme(`md-review-revised:<uuid>`)로 등록 (TextDocumentContentProvider)
    2. `vscode.commands.executeCommand('vscode.diff', originalUri, revisedUri, '검토: <filename>')`
  - `src/diff/HunkApprover.ts` — diff parsing → hunk 단위 분리 → WebView quick-pick UI로 hunk별 [accept] / [reject] 선택. (간단화: VSCode 내장 diff editor 자체 UX 활용 + 별도 quick-pick에서 hunk 토글)
  - `src/diff/WorkspaceEditBuilder.ts` — accepted hunks → `vscode.WorkspaceEdit` → `vscode.workspace.applyEdit(edit)`
  - `test/diff/*.test.ts`
- **측정 가능한 종료 조건**
  - `npm test -- --grep WorkspaceEditBuilder` → all green
  - hunk 3개 중 2개 accept 시나리오: accepted hunks만 반영된 최종 본문이 expected 본문과 deep-equal
  - 모든 hunk reject 시: 원본 본문 unchanged (`expect(finalContent).toBe(original)`)
  - Diff editor가 실제로 열림 (수동 검증, F5 시나리오에서 스크린샷)
  - WorkspaceEdit 적용 후 `.md` 파일이 unsaved state로 dirty 표시 (사용자가 명시적으로 저장)
- **예상 소요**: 1.5 작업일
- **핵심 위험**: VSCode 내장 diff editor가 hunk별 native accept UI를 제공하지 않음 → quick-pick 보조 UI를 일급 설계로 채택 (ad-hoc shim 아님; 처음부터 hunk 승인의 주 진입점). Architect 검토 후 inline accept button으로 승격 검토.

### P6 — 패키징 · 배포 (Packaging & Distribution, DELIBERATE)

- **목표**: `vsce`로 platform-specific `.vsix`를 생성하고 marketplace 게시 준비를 완료한다. 본 Phase는 deliberate 모드로 진행한다 (high-risk: native binary cross-platform).
- **산출물**
  - `package.json` `extensionPack` 또는 `target` 필드 활용 (vsce platform-specific)
  - GitHub Actions matrix workflow: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, (옵션) `win32-x64`
  - 각 platform에서 node-pty prebuild → vsix 생성 → `@vscode/test-electron`으로 smoke test
  - README.md (영어, 표준 기술 톤. 사극톤 금지). **macOS GUI launch 시 zshrc 미로드 함정 명시 (Edit-3)** — Finder/Dock 더블클릭으로 VSCode를 띄우면 login shell이 아니라 `~/.zshrc`의 PATH/env가 누락될 수 있으며, 이 경우 `claude` 바이너리가 발견되지 않을 수 있음. 해결: settings에 절대 경로 명시, 또는 VSCode 터미널에서 실행, 또는 launchd plist로 env 주입.
  - CHANGELOG.md (Keep a Changelog 형식)
  - LICENSE
  - marketplace 등록 메타데이터 (publisher, categories, keywords)
- **측정 가능한 종료 조건**
  - `vsce package --target darwin-arm64` → `.vsix` 산출, exit code 0
  - 산출된 `.vsix`에 `node-pty` native binary 포함: `unzip -l *.vsix | grep -E 'pty.*\.node'` → 1건 이상
  - smoke test: `@vscode/test-electron`으로 VSCode 인스턴스 띄워 activate → 1줄 로그 검출 → exit code 0
  - GitHub Actions matrix workflow 모든 platform 통과 (CI 녹색)
  - 한자 정적 검증: `grep -PR '[\x{4E00}-\x{9FFF}]' .` → 0건
  - cost guard 최종 검증: `grep -rE '(\-p|\-\-print)\b' src/` → 0건
  - README에 macOS GUI launch zshrc 함정 섹션 존재: `grep -i 'zshrc\|GUI launch\|absolute path' README.md` → 1건 이상 (Edit-3)

#### P6 Pre-mortem (DELIBERATE)

세 가지 실패 시나리오를 사전에 정의하고 대응책을 박아둔다.

1. **시나리오 P6-A**: macOS arm64 user가 설치 시 `node-pty.node` 로드 실패 (`dlopen` 에러).
   - 원인: Electron 버전과 node-pty prebuild abi mismatch.
   - 대응: vsce platform-specific vsix로 abi 고정. install-time `npm rebuild` hook은 user 환경 오염 위험으로 회피.
2. **시나리오 P6-B**: Windows user가 설치 시 ConPTY API 호출 실패 (Win10 1809 미만).
   - 원인: ConPTY는 Win10 1809+ 필요.
   - 대응: `package.json` `engines.os` 또는 README에 minimum Windows 10 1809 명시. activate 시 OS 버전 체크 후 친절한 에러 메시지.
3. **시나리오 P6-C**: 사용자가 settings에 `claude -p` 같은 args를 임의 주입하여 과금 발생.
   - 원인: settings의 `providers[x].args` 자유 입력 허용.
   - 대응 (Edit-4 + v3-Edit-3 격상): args 블랙리스트가 아니라 **이중 화이트리스트**로 격상. provider별 `ALLOWED_ARGS` 집합 외 모든 args 즉시 throw + `ALLOWED_COMMAND_BASENAMES` 집합 외 모든 command basename도 즉시 throw. 즉 `-p` / `--print` 뿐 아니라 임의 args 추가도 거부 + wrapper script 우회도 거부. OutputChannel에 위반 사실 구조화 로깅.

#### P6 확장 Test Plan (DELIBERATE, Edit-11 반영)

- **Unit**: P0~P5에서 누적된 모든 mocha/chai 테스트 → coverage 80% 이상 (`nyc` 기준).
- **Integration**: `@vscode/test-electron`으로 VSCode 인스턴스 띄워 (a) activate, (b) `.md` 열고 코멘트 추가, (c) mock provider로 submit 흐름 끝까지 수행.
- **E2E (수동)**: 실제 `claude` CLI 설치된 환경에서 `.md` 파일 → 코멘트 1개 → submit → diff → accept → 본문 반영 → graceful kill.
- **Observability (Edit-11 확장)**: 다음 이벤트를 `vscode.OutputChannel`에 구조화 로그로 기록. 디버그 모드에서만 verbose.
  - extension lifecycle: `activate`, `deactivate`, `spawn`, `kill`
  - detector: `prompt-end-detected` (Edit-1 envelope 통과, Edit-11), `sentinel-detected`, `echo-rejected` (echo buffer skip, Edit-11), `timeout-tertiary-fired`
  - submit: `submit-key-sent` (어떤 submit semantics 적용됐는지, Edit-11)
  - cost guard: `args-whitelist-violation` (Edit-4), `[cost-guard]` resolved-command + basename (v3-Edit-3)
  - 총 11개 이벤트.

- **예상 소요**: 1.5 ~ 2.0 작업일 (deliberate 추가 작업 포함)
- **핵심 위험**: 시나리오 A 미해결 시 macOS 사용자 0%가 설치 가능. 시나리오 C 미해결 시 본 프로젝트의 존재 의의 자체가 무너짐.

### 누적 소요 추정

| Phase | 소요 (작업일) | v2 대비 |
|---|---|---|
| P0 스캐폴딩 | 1.0 | unchanged |
| P0.5 Provider Spike (Edit-2 + v3-Edit-2 network probe 흡수) | 0.5 | unchanged |
| P1 PTY 코어 (DELIBERATE, Edit-8 + v3-Edit-1 quiet period 코드 흡수) | 2.5 | unchanged |
| P2 코멘트 모델 | 1.5 | unchanged |
| P3 리뷰 WebView | 2.5 | unchanged |
| P4 제출 흐름 (v3-Edit-3 command basename 화이트리스트 흡수) | 2.0 | unchanged |
| P5 Diff 적용 | 1.5 | unchanged |
| P6 패키징 (DELIBERATE) | 1.5 ~ 2.0 | unchanged |
| **합계** | **12.5 ~ 13.5** (+ 버퍼 시 15.0) | **unchanged (phase 일정 증가 0d)** |

---

## 3. ADR (Architecture Decision Record)

### ADR-001: Interactive CLI via node-pty for Cost-Free LLM Invocation

- **Status**: Proposed (Planner v3, after Critic v2 ITERATE, Architect v2 STRONG verdict 수령)
- **Date**: 2026-05-14
- **Context**: 사용자는 claude / codex / gemini의 Pro/Max 구독을 보유하고 있으며, 본 확장이 추가 종량 과금을 발생시키지 않는 것이 필수 요건이다. v1에서 식별되지 않은 PTY echo 함정과 args 주입 공격 표면을 v2에서 envelope + 화이트리스트로 보강했다. v3에서는 stream fragmentation으로 인한 응답 잘림과 wrapper script 우회 공격 표면을 quiet period + command basename 화이트리스트로 추가 보강한다.

#### Decision

VSCode Extension Host 안에서 `node-pty`로 claude / codex / gemini CLI를 interactive 모드로 spawn하고, **envelope-wrapped 프롬프트(`<<<BEGIN-{uuid}>>>` ... `<<<END-{uuid}>>>` ... `<<<DONE-{uuid}>>>`)** + provider별 DetectorStrategy + 2단계 합의(Stage A envelope 통과 → Stage B sentinel+200ms quiet/shell-prompt/90s timeout 중 하나) 구조로 응답 종료를 감지하는 구조를 채택한다. settings의 args + command basename은 provider별 이중 화이트리스트로 강제 검증한다.

#### Drivers

1. 비용 회피 — print mode 호출 0건 보장 (Principle 1). args + command basename 이중 화이트리스트로 runtime 강제 (Edit-4, v3-Edit-3).
2. VSCode 친화성 — 외부 system 의존(tmux 등) 없이 Extension Host 단일 lifecycle (Principle 2).
3. 설치 단순성 — 단일 `.vsix` 설치로 동작 (platform-specific vsix로 native 빌드 함정 회피).

#### Alternatives Considered

| 대안 | 기각 사유 |
|---|---|
| tmux pipe-pane + send-keys (Option B) | 외부 tmux 설치 요구로 설치 단순성 driver 위배. Windows 미지원. |
| VSCode Terminal API pseudo-shell (Option C) | 출력 capture 경로가 안정적이지 않아 sentinel detection fragile. |
| child_process + `-p` print mode (Option D) | 종량 과금 발생 → 본 확장 존재 이유와 정면 충돌. |
| `--output-format stream-json` (Option E) | P0.5 spike에서 (a) interactive 안 활성 가능성, (b) tcpdump baseline 대비 outbound TLS connection 차이 0건 (v3-Edit-2) 실측 후 v4 또는 P1 코드에서 확정. v3 단계에서는 잠정 보류. |

#### Why Chosen

본 프로젝트의 1순위 driver(비용 회피)를 만족하는 유일한 검증 완료 선택지다. node-pty는 VSCode 내장 터미널과 동일 라이브러리이므로 안정성·호환성이 이미 입증되었고, native 빌드 함정은 vsce platform-specific vsix로 흡수 가능하다. v1의 단일 sentinel 검출이 PTY echo로 인해 silent bug를 일으킬 수 있다는 Critic 지적을 받아 v2는 envelope + 2단계 합의로 echo guard를 박았다. v2의 즉시-resolve가 stream fragmentation으로 trailing chunk를 잘라낼 수 있다는 Critic v2 지적을 받아 v3는 200ms quiet period를 도입했다. wrapper script로 cost guard를 우회할 수 있다는 v2 지적도 v3에서 command basename 화이트리스트로 봉쇄했다.

#### Consequences

- **긍정**
  - LLM 호출에 따른 추가 과금이 발생하지 않는다.
  - VSCode 내장 터미널과 동일 기술 스택이므로 향후 stream UI 등 확장 여지가 있다.
  - 사용자가 별도 환경 설정 없이 `.vsix` 한 개만 설치하면 된다.
  - args + command basename 이중 화이트리스트로 사용자 실수 또는 악의적 settings 주입 + wrapper script 우회 모두 차단.
  - DetectorStrategy 분리로 provider 추가 시 격리된 모듈 1개 추가만으로 확장 가능.
  - 200ms quiet period로 stream fragmentation 환경에서도 trailing chunk 보존.
- **부정**
  - node-pty native 모듈로 인해 platform별 prebuild + matrix CI가 필요하다 (운영 비용).
  - 응답 종료가 명시적이지 않아 envelope + sentinel(+quiet) + secondary + tertiary detector 4중망을 항상 유지보수해야 한다.
  - Windows ConPTY 의존으로 Win10 1809+ 최소 요구 사항이 생긴다.
  - P0.5 Provider Spike phase로 0.5d 추가 소요.
  - 이중 화이트리스트가 엄격하여 향후 합법적 args 또는 wrapper(예: 사용자 PATH 우선순위 회피용 alias)를 추가하려면 본 코드 수정 + 신규 PR이 필요.
  - 응답 latency가 200ms 증가 (quiet period 대기).

#### Follow-ups

- F-1: shell prompt 정규식을 settings로 노출하여 CLI UI 업데이트 대비. DetectorStrategy override 경로 제공.
- F-2: 응답 stream을 사이드 panel에 실시간 표시할지 결정 (현재는 non-goal). 사용자 피드백 후 P7 후속 결정.
- F-3: gemini CLI의 interactive 종료 패턴을 P1 DetectorStrategy로 캡슐화 완료 (Edit-5로 v1의 F-3 해소). 후속 측정 필요 시 P0.5 spike 결과 반영.
- F-4: marketplace 게시 후 사용자가 `args` 또는 `command`에 화이트리스트 외 토큰 주입 시도하는지 telemetry로 추적(opt-in).
- F-5: Option E(stream-json) 채택 또는 기각 확정 (P0.5 spike tcpdump network probe 결과 + v4 또는 P1 코드에서 § 1.3 확정).
- F-6: ALLOWED_ARGS / ALLOWED_COMMAND_BASENAMES 확장 정책 — 합법적 신규 args 또는 신규 provider(예: 향후 mistral CLI)가 등장하면 화이트리스트 추가 + 회귀 테스트.
- F-7: quiet period 200ms 값을 settings로 노출할지 결정 (v3 default는 hardcoded 200ms). 사용자 피드백 시 P7.

---

## 4. Acceptance Criteria (검증 가능 재진술)

명세서 § Acceptance Criteria 13개 항목 + Edit-4로 추가된 AC-14를 검증 가능한 절차와 함께 재진술한다. v3에서는 AC-7과 AC-14를 갱신한다.

| # | 기준 | 검증 절차 | Phase |
|---|---|---|---|
| AC-1 | `.md` 파일 열면 우측에 포맷된 리뷰 프리뷰 표시 | F5 디버그 → `.md` 파일 우클릭 → "Open with Markdown Review" → WebView 1개 표시 (수동, 스크린샷) | P3 |
| AC-2 | 임의 텍스트 구간 선택 후 suggestion/question 코멘트 anchor 추가 가능 | WebView에서 텍스트 선택 → 컨텍스트 메뉴 → suggestion 추가 → DOM에 `data-comment-id` 1개 추가 (수동) | P3 |
| AC-3 | 코멘트 사이드 panel 목록 표시, anchor 위치 이동/하이라이트 가능 | 사이드 panel 항목 클릭 → WebView가 해당 anchor에 스크롤 + highlight class 부착 (수동) | P3 |
| AC-4 | 코멘트가 `.md.review.json` 사이드카 또는 workspaceState에 영속 저장 | 코멘트 추가 → WebView 재시작 → 동일 코멘트 복원 → `ls *.md.review.json` 검증 또는 `getState(...)` 결과 length > 0 | P2 |
| AC-5 | "제출" 클릭 시 본문 + 코멘트 + envelope/sentinel 출력 지시 포함 단일 프롬프트 조립 | `npm test -- --grep PromptBuilder` 단위 테스트에서 prompt 안 `<<<BEGIN-`/`<<<END-`/`<<<DONE-` 각 정확히 1회, 본문·코멘트 모두 포함 assert | P4 |
| AC-6 | default provider의 interactive CLI가 node-pty로 spawn되고 프롬프트는 `pty.write`로 주입 | 통합 테스트에서 mock `node-pty.spawn` spy 호출 + `pty.write` 호출 1회 + provider별 submit key 적용 assert | P1, P4 |
| **AC-7 (갱신, Edit-10 + v3-Edit-1)** | `pty.onData`가 ANSI 정화 후 PROMPT_END 토큰 이후 buffer만 detector에 feed, sentinel 검출 시 200ms quiet period 통과 후 echo guard 통과 확인하고 완료 | `npm test -- --grep TerminationDetector` 단위 테스트: (a) ANSI 포함 chunk feed 후 buffer escape 0건, (b) **echo case 6종 단위 테스트 (Edit-10 + v3-Edit-1)** — 케이스 1~5(v2 기존) + **케이스 6 (v3 NEW): sentinel 검출 후 150ms 시점에 추가 chunk 1건 도착 → 응답 미완료로 판정되고 quiet timer 재설정 + 최종 sentinel만 매칭** — 모두 통과 | P1 |
| AC-8 | sentinel이 발견되지 않은 상태에서 shell prompt 복귀 패턴(secondary detector)이 일치하면 응답 완료로 판정 (Stage A 통과 후에만) | TerminationDetector 단위 테스트: PROMPT_END 통과 + sentinel 없는 chunk + provider strategy의 shell prompt 정규식 일치 chunk → resolve | P1 |
| AC-9 | 두 신호 모두 90s 안에 없으면 timeout 에러 안내 (v1의 30s → 90s, Edit-1) | TerminationDetector 단위 테스트: 어떤 신호도 없는 stream → 90s 경과 후 reject (Error 메시지 한국어) | P1 |
| AC-10 | 응답에서 추출한 수정본은 `vscode.diff`로 원본과 나란히 표시 | F5 디버그 → submit → diff editor 열림 → 좌우 두 컬럼 표시 (수동, 스크린샷) | P5 |
| AC-11 | diff editor에서 hunk별 승인/거부 후 `WorkspaceEdit`으로 원본 `.md`에 반영 | F5 디버그 → diff editor → quick-pick UI에서 hunk 2개 중 1개 accept → `.md` 본문 dirty + 해당 hunk만 반영 (수동, 텍스트 diff) | P5 |
| AC-12 | `provider`, `defaultProvider`, `sentinelTimeoutMs`, `cwd`, `env`, `persistenceBackend` 등 settings.json으로 변경 가능 | settings.json 수정 → reload → 새 값으로 동작 (수동), `npm test -- --grep ProviderConfig`에서 zod validation 통과 | P4 |
| AC-13 | 확장 비활성화 시 node-pty 세션 graceful kill (자식 leak 없음) | F5 디버그 → submit 진행 중 → reload window → `ps -ef \| grep claude` 0건 (수동, `lsof -p <vscode-pid> \| grep claude` 0건) | P1, P6 |
| **AC-14 (갱신, Edit-4 + v3-Edit-3)** | settings에 `-p` 또는 화이트리스트 외 args 주입 시 spawn 거부 + **command basename이 `claude`/`codex`/`gemini` 외인 경우 spawn 거부 (v3-Edit-3)** + 사용자 경고 메시지 + OutputChannel 로깅 | (a) `npm test -- --grep validateArgs` 단위 테스트 4종 (claude/codex/gemini 화이트리스트 외 args 모두 throw), (b) **`npm test -- --grep validateCommand` 단위 테스트 4종 (v3-Edit-3): `'claude'` no-throw, `'/usr/local/bin/claude'` no-throw, `'claude-wrapper'` throws, `'/path/to/billable-claude'` throws**, (c) 수동: settings에 `claude.command = 'claude-wrapper'` 또는 `claude.command = '/path/to/billable-claude'` 주입 시 throw + 한국어 경고 + OutputChannel에 `[cost-guard]` 로그 1줄 (수동, screenshot), (d) settings에 `claude.args = ["-p"]` 입력 후 submit → 한국어 에러 toast + `event=args-whitelist-violation` 1건 로그 | P4 |

---

## 5. Risk Register

| # | 위험 | 가능성 | 영향 | 완화 | 책임 Phase |
|---|---|---|---|---|---|
| R-1 | `node-pty` native 빌드 실패 (Electron 버전 mismatch) | 중 | 높음 | vsce platform-specific vsix로 ABI 고정; `@vscode/test-electron` matrix CI로 사전 검증 | P0, P6 |
| R-2 | LLM이 sentinel 출력 지시를 무시 | 낮음 | 중 | PromptBuilder가 출력 형식을 매우 명시적으로 지시; secondary detector(shell prompt) + tertiary detector(90s timeout)가 설계 단계부터 활성화되어 sentinel 누락 시에도 deterministic하게 종료 | P4 |
| R-3 | shell prompt 정규식이 CLI UI 업데이트로 깨짐 | 중 | 낮음 | shell prompt 정규식을 settings로 노출; DetectorStrategy로 provider별 격리 (Edit-5); 확장 활성화 시 빈 명령으로 prompt 패턴 자동 학습 옵션 (F-1) | P1 |
| R-4 | Interactive 응답에 thinking/메타텍스트가 마크다운과 섞여 반환 | 중 | 중 | ResponseExtractor가 fenced markdown block 우선 추출; PromptBuilder에서 "응답은 fenced markdown block 한 개로만" 명시 | P4 |
| R-5 | WebView ↔ Extension Host 직렬화 부담 (대용량 `.md`) | 낮음 | 낮음 | 본문은 Extension Host가 직접 보유, WebView에는 anchor 정보만 전달 | P3 |
| R-6 | node-pty 자식 프로세스 leak | 중 | 중 | extension `deactivate` hook에서 모든 session graceful kill(SIGTERM) + 2s 후 force kill(SIGKILL); 통합 테스트에서 `lsof` 0건 검증 | P1, P6 |
| R-7 (갱신, Edit-4 + v3-Edit-3) | 사용자가 settings의 `args`에 `-p`/`--print` 또는 임의 args를 주입하여 과금 발생 + **wrapper script(command basename 우회)로 cost guard 회피** | 낮음 | 매우 높음 | **블랙리스트에서 이중 화이트리스트로 격상** — ProviderConfig 로드 시 args 배열을 `ALLOWED_ARGS[provider]` 집합과 비교, 외부 토큰 1개라도 발견 시 throw + 한국어 toast + OutputChannel 로깅. AC-14 단위 테스트로 회귀 방지. **추가로 command basename도 화이트리스트(`claude`/`codex`/`gemini`)로 검증하여 wrapper script 우회 차단 (v3-Edit-3)** | P4 |
| R-8 | Windows ConPTY 미지원 환경 (Win10 1809 미만) | 낮음 | 중 | `package.json`에 minimum Windows 10 1809 명시; activate 시 OS 버전 체크 후 친절한 에러 표시 | P6 |
| R-9 | 사이드카 `.md.review.json`을 사용자가 실수로 git에 commit | 중 | 낮음 | `.gitignore` 권장 패턴을 README에 명시; workspaceState 모드를 secondary persistence backend로 settings에서 명시 선택 가능 | P2 |
| R-10 | hunk별 승인 UX가 VSCode 내장 diff editor native 기능과 매끄럽지 않음 | 중 | 중 | quick-pick 보조 UI를 일급 설계로 채택 (P5 산출물); 향후 inline accept button 검토 (F-2와 연계) | P5 |
| R-11 (NEW, Edit-7) | PTY echo back으로 sentinel 즉시 false-resolve (silent bug 직결) | 높음 | 매우 높음 | Edit-1 envelope 도입. Stage A(PROMPT_END 검출) 통과 전 buffer는 응답으로 간주하지 않음. `<<<END-{uuid}>>>` 토큰을 만나야만 응답 영역 시작. echo case 6종 단위 테스트(AC-7, Edit-10 + v3-Edit-1)로 회귀 방지 | P1 |
| R-12 (NEW, Edit-7) | claude REPL multiline submit semantics 미명세 — `\r\n` 줄바꿈인지 submit인지 불명 | 중 | 높음 | Edit-2 P0.5 spike에서 provider별 submit key를 실측 확정. DetectorStrategy의 `submitKey: '\r' | '\r\n' | 'bracketed-paste'` 필드로 코드화. bracketed paste가 안전한 default | P0.5, P1 |
| R-13 (NEW, Edit-7) | Shell prompt 정규식이 intra-turn(응답 중간)에도 매칭되어 응답을 일찍 자름 | 중 | 중 | Edit-1 Stage A로 envelope 이전 영역 폐기. Stage B의 shell prompt regex는 envelope 이후 응답 영역에서만 평가. DetectorStrategy의 regex를 엄격하게(`^` anchor + ANSI sanitize 후) 작성 | P1 |
| R-14 (NEW, Edit-7 + Edit-3) | cwd/env 정책 부재로 사용자 `~/.claude` ambient context 누락 → CLI가 인증 실패 또는 새 세션으로 인식하여 종량 모드로 떨어짐 | 중 | 매우 높음 | NodePtySession.spawn의 env default를 `process.env`로 명시하여 `~/.claude` 상속. cwd default는 workspace root. README에 macOS GUI launch zshrc 함정 명시. settings로 cwd/env override 가능 | P1, P6 |
| R-15 (NEW, Edit-7) | Sentinel 토큰이 사용자 본문에 우연히 포함 — 사용자가 마크다운 본문에 `<<<DONE-` 같은 문자열을 직접 작성한 경우 응답을 일찍 자름 | 낮음 | 높음 | (a) sentinel uuid를 매 호출마다 `randomUUID()`로 재생성하여 충돌 확률 무시 가능 수준으로 낮춤. (b) Stage A 통과 후 응답 영역 안에서만 sentinel을 찾되 `lastIndexOf`로 마지막 occurrence만 사용 → 본문에 sentinel이 우연히 들어있더라도 LLM이 응답 끝에 출력한 sentinel이 우선 | P1 |
| **R-16 (NEW, v3-Edit-1)** | Stream fragmentation으로 sentinel 검출 후 추가 chunk 누락 — LLM이 sentinel 출력 후에도 closing remark, tool use trailing text 등 추가 chunk를 보내면 즉시 resolve가 응답을 잘라 trailing 콘텐츠 손실 또는 sentinel 자체가 buffer에 partial로 잘려 false-resolve | 중 | 중 | 200ms quiet period + lastIndexOf 재평가 도입 (v3-Edit-1). sentinel 검출 시 즉시 resolve 대신 quiet timer 설정 후 200ms idle 시 final lastIndexOf로 resolve. 200ms 내 추가 chunk 도착하면 quiet timer 재설정 + buffer 끝쪽 sentinel 재평가. AC-7 케이스 6번째로 회귀 방지 | P1 |

---

## 6. Project Layout (제안)

```
vscode-markdown-editor/
├─ src/
│  ├─ extension.ts              # activate / deactivate entry
│  ├─ pty/
│  │  ├─ NodePtySession.ts      # cwd/env 정책 default + test mode (Edit-3)
│  │  ├─ TerminationDetector.ts # envelope + 2단계 합의 + 200ms quiet period (Edit-1 + v3-Edit-1)
│  │  ├─ AnsiSanitizer.ts
│  │  ├─ ResponseExtractor.ts
│  │  └─ detector/              # provider별 strategy (Edit-5; v3-Edit-4로 computeEchoSkipBytes 제거)
│  │     ├─ DetectorStrategy.ts # interface (3개 필드만 — providerName/submitKey/shellPromptRegex)
│  │     ├─ ClaudeDetector.ts
│  │     ├─ CodexDetector.ts
│  │     ├─ GeminiDetector.ts
│  │     └─ DetectorFactory.ts
│  ├─ model/
│  │  └─ Comment.ts
│  ├─ store/
│  │  ├─ CommentStore.ts
│  │  ├─ SidecarPersistence.ts
│  │  └─ WorkspaceStatePersistence.ts
│  ├─ editor/
│  │  ├─ MarkdownReviewEditor.ts
│  │  ├─ WebViewBridge.ts
│  │  └─ AnchorResolver.ts
│  ├─ llm/
│  │  ├─ ProviderConfig.ts      # args + command basename 이중 화이트리스트 (Edit-4 + v3-Edit-3)
│  │  ├─ PromptBuilder.ts       # envelope 포맷 송신 (Edit-1)
│  │  ├─ LLMOrchestrator.ts     # validateCommand + validateArgs + DetectorFactory 통합
│  │  └─ ResponseExtractor.ts   # (또는 src/pty/와 공유)
│  └─ diff/
│     ├─ DiffPresenter.ts
│     ├─ HunkApprover.ts
│     └─ WorkspaceEditBuilder.ts
├─ media/webview/
│  ├─ index.html
│  ├─ main.ts
│  ├─ inline-overlay.ts
│  └─ comment-panel.ts
├─ scripts/spike/               # P0.5 Provider Spike (Edit-2 + v3-Edit-2)
│  ├─ probe-claude.ts
│  ├─ probe-codex.ts
│  ├─ probe-gemini.ts
│  └─ network-probe.sh          # tcpdump/nettop/lsof ground-truth (v3-Edit-2)
├─ test/
│  ├─ pty/                      # echo case 6종 (v3-Edit-1 포함) + DetectorStrategy 3종 (Edit-10)
│  ├─ store/
│  ├─ llm/                      # validateArgs 4종 + validateCommand 4종 (Edit-4 + v3-Edit-3)
│  └─ diff/
├─ .vscode/launch.json
├─ .github/workflows/ci.yml
├─ .omc/specs/provider-detector-matrix.md   # P0.5 산출물 (Edit-2 + v3-Edit-2)
├─ package.json
├─ tsconfig.json
└─ README.md                    # macOS GUI launch zshrc 함정 섹션 (Edit-3) + tcpdump 권한 안내 (v3-Edit-2)
```

Files 평균 길이 200~400 lines 권장, 800 line 초과 금지 (~/.claude/rules/coding-style.md "File Organization" 준수).

---

## 7. VSCode `settings.json` 스키마 (Edit-3, Edit-4 반영)

```json
{
  "mdReview.providers": {
    "claude":  {
      "command": "claude",
      "args": [],
      "cwd": null,
      "env": null,
      "envOverride": null
    },
    "codex":   { "command": "codex",  "args": [], "cwd": null, "env": null },
    "gemini":  { "command": "gemini", "args": [], "cwd": null, "env": null }
  },
  "mdReview.defaultProvider": "claude",
  "mdReview.sentinelTimeoutMs": 90000,
  "mdReview.stripAnsi": true,
  "mdReview.persistenceBackend": "sidecar"
}
```

- `cwd`: null이면 workspace root 사용. 절대 경로 명시 가능 (Edit-3).
- `env`: null이면 `process.env` 그대로 상속 (Edit-3). 명시 시 완전 대체.
- `envOverride`: null이면 미적용. 명시 시 `process.env`에 merge (부분 override). 예: `{ "ANTHROPIC_CONFIG_DIR": "~/.claude-secondary" }`.
- `command`: basename이 `claude`/`codex`/`gemini` 중 하나여야 함 (v3-Edit-3). 절대 경로 OK, 임의 wrapper script 거부.
- `args`: 빈 배열만 default 허용. 추가 시 ALLOWED_ARGS 화이트리스트 통과해야 함 (Edit-4).
- `sentinelTimeoutMs`: v1의 30000 → 90000으로 격상 (Edit-1).
- `persistenceBackend`: `"sidecar"` 또는 `"workspaceState"` 둘 중 하나만. mutually exclusive.

---

## 8. Open Questions (Planner v3 미해결)

다음 항목은 후속 Critic 또는 사용자 확인이 필요하다. `.omc/plans/open-questions.md`에도 동기화한다.

1. **사이드카 vs workspaceState 기본값**: 두 영속화 경로 중 어느 것을 default로 둘지. v2~v3 default는 `sidecar` (git 친화적, portability). 사용자 검토 후 확정.
2. **Windows 지원 우선순위**: Initial 버전부터 Windows 포함할지, 또는 macOS + Linux로 출시 후 P7로 미룰지.
3. **Diff hunk UX**: VSCode 내장 diff editor의 native UI에 만족할지, quick-pick + checkbox UI 별도 구현할지. P5 구현 중 결정 필요.
4. **응답 stream 실시간 표시 여부**: 현재 non-goal이지만 사용자 피드백 시점에 P7로 재검토.
5. **Option E (stream-json) 채택 또는 기각**: P0.5 spike의 tcpdump network probe(v3-Edit-2) 결과에 따라 v4 또는 P1 코드에서 확정.
6. **ALLOWED_ARGS / ALLOWED_COMMAND_BASENAMES 확장 정책 (F-6)**: 합법적 신규 args 또는 신규 provider가 등장하면 어떤 검토 절차로 화이트리스트에 추가할지 (PR + review).
7. **P0.5 spike 결과의 반영 시점**: spike 완료 후 surgical edit으로 본문 갱신할지, 아니면 P1 코드에서 직접 흡수할지.
8. **quiet period 200ms 값을 settings로 노출할지 (F-7)**: v3 default는 hardcoded 200ms. 사용자 피드백 후 결정.

---

## 9. Technical Context — TerminationDetector 의사 코드 (Edit-1 envelope + v3-Edit-1 quiet period)

```typescript
import stripAnsi from 'strip-ansi';

class TerminationDetector {
  private buffer = '';
  private promptEndDetected = false;
  private hardTimeout?: NodeJS.Timeout;
  // v3-Edit-1: 200ms quiet period 도입
  private quietTimer?: NodeJS.Timeout;
  private readonly quietPeriodMs = 200;

  constructor(
    private envelopeEnd: string,        // <<<END-{uuid}>>>
    private sentinel: string,            // <<<DONE-{uuid}>>>
    private shellPromptRegex: RegExp,    // DetectorStrategy 주입
    private resolve: (markdown: string) => void,
    private reject: (err: Error) => void,
  ) {
    this.hardTimeout = setTimeout(
      () => this.reject(new Error('LLM 응답 시간 초과 (90s)')),
      90_000,  // v1의 30s에서 90s로 격상 (Edit-1)
    );
  }

  feed(chunk: string): void {
    this.buffer += stripAnsi(chunk);

    // Step 1 (Stage A): PROMPT_END 토큰을 만날 때까지 buffer는 echo 영역
    if (!this.promptEndDetected) {
      const endIdx = this.buffer.indexOf(this.envelopeEnd);
      if (endIdx === -1) return;
      // echo 영역 폐기 + envelope 토큰 자체도 제거
      this.buffer = this.buffer.slice(endIdx + this.envelopeEnd.length);
      this.promptEndDetected = true;
      // OutputChannel.appendLine('event=prompt-end-detected ...');
    }

    // Step 2 (Stage B1): sentinel 검출 → 200ms quiet period 대기 후 resolve (v3-Edit-1)
    // — 즉시 resolve 시 stream fragmentation 환경에서 trailing chunk가 잘리거나
    //   sentinel이 buffer 경계에 partial로 걸린 경우 false-resolve 위험 (R-16).
    //   quiet timer 동안 추가 chunk가 오면 재설정 + final lastIndexOf 재평가.
    const sentinelIdx = this.buffer.lastIndexOf(this.sentinel);
    if (sentinelIdx !== -1) {
      clearTimeout(this.quietTimer);
      this.quietTimer = setTimeout(() => {
        const finalIdx = this.buffer.lastIndexOf(this.sentinel);
        clearTimeout(this.hardTimeout);
        this.resolve(this.buffer.slice(0, finalIdx).trim());
      }, this.quietPeriodMs);
      return;
    }

    // Step 3 (Stage B2): shell prompt secondary detector (응답 영역 안에서만)
    if (this.shellPromptRegex.test(this.buffer)) {
      clearTimeout(this.quietTimer);  // v3-Edit-1: pending quiet timer 취소
      clearTimeout(this.hardTimeout);
      return this.resolve(this.buffer);
    }

    // Stage B3 (timeout)는 생성자의 setTimeout이 담당
  }
}
```

**송신 형식 (PromptBuilder, Edit-1)**:

```
<<<BEGIN-{uuid}>>>
[수정 지시 본문 + 코멘트들...]
응답 마지막에 정확히 다음 한 줄: <<<DONE-{uuid}>>>
<<<END-{uuid}>>>
```

- 송신 시 LLM은 envelope 안 본문을 읽고, 응답 마지막에 sentinel 한 줄을 출력한다.
- PTY echo로 인해 위 송신 텍스트가 buffer 앞쪽에 그대로 출현하므로, `<<<END-{uuid}>>>`까지가 echo 영역이며 그 다음부터가 실제 응답 영역이다.
- sentinel이 응답에 한 번이라도 등장하면 200ms quiet period가 시작된다 (v3-Edit-1). 200ms 동안 추가 chunk가 없으면 final lastIndexOf로 응답을 trim한다.

---

## 10. Plan Status & Next Action

- **Status**: DRAFT v3 (Planner, Critic v2 ITERATE 후 surgical edits 4건 minimal scope 반영 완료)
- **Architect 재검토**: 생략 (Architect v2 STRONG verdict 이미 수령)
- **Next**: Critic v3 즉시 APPROVE 경로 진입 → APPROVE 통과 시 `docs/plans/`로 이전 + history(v1→v2 deltas + v2→v3 deltas)는 `.omc/plans/vscode-md-review-history.md`로 분리 (CLAUDE.md "OMC 합의 산출물 저장 규약" 및 "plan-documents.md § 8" 적용)
- **Handoff target**: `/oh-my-claudecode:start-work vscode-md-review-plan-v3` (사용자 명시 승인 후)
