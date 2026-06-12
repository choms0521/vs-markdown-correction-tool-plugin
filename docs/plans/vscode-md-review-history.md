# VSCode Markdown Inline Review Extension — ralplan Consensus History

본 문서는 `docs/plans/vscode-md-review-plan.md`가 ralplan 합의 사이클을 거치며 적용된 surgical edits의 추적 이력입니다. 회귀 추적과 의사결정 감사 목적으로 보존됩니다.

- 최종 plan: `docs/plans/vscode-md-review-plan.md`
- Source spec: `.omc/specs/deep-interview-vscode-md-review.md`
- 합의 사이클 결과:
  - 1회차: v1 (443 lines) → Critic ITERATE (11 surgical edits)
  - 2회차: v2 (742 lines) → Architect STRONG + Critic ITERATE (4 surgical edits)
  - 3회차: v3 (819 lines) → **APPROVE**

---

## 0.1 v1 → v2 deltas (Critic v1 ITERATE 대응)

본 표는 v1 → v2 사이클의 11개 surgical edits를 § 매핑과 함께 기록한다. APPROVE 통과 후 본 deltas 표는 v2 → v3 deltas와 함께 `vscode-md-review-history.md`로 분리하고 본 문서에서 제거한다. (CLAUDE.md "OMC 합의 산출물 저장 규약" 및 "plan-documents.md § 2 ralplan 합의 워크플로 산출 분리" 준수)

| Edit | Priority | 적용 § | 변경 내용 요약 |
|---|---|---|---|
| Edit-1 | CRITICAL | § 9 Technical Context — TerminationDetector 의사 코드 | PROMPT_END envelope 도입. 의사 코드를 2단계(envelope 통과 → sentinel 검출 by lastIndexOf)로 재작성. 30s → 90s timeout. shellPromptRegex를 생성자 인자로 명시. |
| Edit-2 | CRITICAL | § 2 Phase별 (P0.5 신설) | P0과 P1 사이에 0.5d Provider Spike phase 추가. provider matrix 산출물 `.omc/specs/provider-detector-matrix.md`. |
| Edit-7 | CRITICAL | § 5 Risk Register R-11~R-15 | echo back, REPL submit semantics, intra-turn prompt, cwd/env, sentinel 본문 충돌 등 5개 신규 위험 등록. |
| Edit-3 | HIGH | § 2 P1 NodePtySession.spawn 시그니처 + § 7 settings 확장 + § 5 R-14 | cwd/env 정책 명시. macOS GUI launch zshrc 함정 README 반영. |
| Edit-4 | HIGH | § 2 P4 ProviderConfig + § 4 AC-14 + § 5 R-7 갱신 | args 블랙리스트 → 화이트리스트로 격상. provider별 `ALLOWED_ARGS` 정의. AC-14 신설. |
| Edit-9 | HIGH | § 1.1 Principle 4 | envelope-then-sentinel 2단계 합의 명시. 단일 신호가 아닌 (envelope 통과 ∧ sentinel 검출) 합의 구조. |
| Edit-8 | HIGH | § 2 P1 DELIBERATE 격상 + P1 Pre-mortem + P1 확장 test plan | P1을 deliberate로 격상. 3 시나리오 사전 정의 + unit/integration/observability/e2e test plan. |
| Edit-5 | MEDIUM | § 2 P1 산출물 + § 6 Project Layout `src/pty/detector/` | provider별 DetectorStrategy 분리 (Claude/Codex/Gemini Detector + Factory). v1의 F-3을 P1으로 끌어올림. |
| Edit-10 | MEDIUM | § 4 AC-7 갱신 | PROMPT_END 통과 후 buffer만 detector에 feed. echo case 단위 테스트 5종 추가. |
| Edit-6 | MEDIUM | § 1.3 Option E 추가 | `--output-format stream-json` Option E 잠정 표기. P0.5 spike 결과에 따라 채택/기각 확정. |
| Edit-11 | MEDIUM | § 2 P6 observability events | `prompt-end-detected`, `echo-rejected`, `submit-key-sent` 3개 이벤트 추가. |

총합 v2: CRITICAL 3건 + HIGH 4건 + MEDIUM 4건 = 11건.

## 0.2 v2 → v3 deltas (Critic v2 ITERATE 대응)

본 표는 v2 → v3 사이클의 4개 surgical edits를 § 매핑과 함께 기록한다. minimal scope (총 ~40 lines). Architect v3 재검토는 생략 (Architect v2 STRONG verdict 이미 수령). APPROVE 통과 후 본 표 + v1→v2 deltas 표는 history 파일로 분리한다.

| Edit | Priority | 적용 § | scope (실제 line 수) | 변경 내용 요약 |
|---|---|---|---|---|
| v3-Edit-1 | CRITICAL | § 9 의사 코드 + § 4 AC-7 + § 5 R-16 신설 | ~15 lines | TerminationDetector에 200ms quiet period 도입. sentinel 검출 시 즉시 resolve가 아니라 quiet timer 설정 후 200ms idle 시 final lastIndexOf로 resolve. stream fragmentation으로 sentinel 후 trailing chunk 잘림 방지. AC-7 echo case 6번째 추가. R-16 신설. |
| v3-Edit-2 | CRITICAL | § 2 P0.5 산출물 + 종료 조건 + § 1.3 Option E Cons | ~12 lines | tcpdump network probe를 P0.5 ground-truth 검증 수단으로 추가. dashboard 24h 지연 의존 제거. `scripts/spike/network-probe.sh` + baseline vs stream-json pcap 비교. macOS nettop 대체 경로 + 권한 fallback(lsof). |
| v3-Edit-3 | HIGH | § 2 P4 ProviderConfig + § 4 AC-14 + § 5 R-7 | ~10 lines | command basename 화이트리스트 추가. `ALLOWED_COMMAND_BASENAMES` + `validateCommand` + zod regex로 wrapper script 우회 차단. AC-14 케이스 1개 추가. R-7 완화책 한 줄 추가. |
| v3-Edit-4 | MINOR | § 2 P1 DetectorStrategy interface | ~3 lines | `computeEchoSkipBytes(prompt)` dead surface 제거. envelope으로 echo skip이 해결되어 strategy 메서드 불필요. 주석 1줄로 사유 명시. |

총합 v3: CRITICAL 2건 + HIGH 1건 + MINOR 1건 = 4건. 누적 line 변경 ~40 lines, phase 일정 증가 0d.
