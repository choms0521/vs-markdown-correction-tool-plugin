import { DetectorStrategy } from './DetectorStrategy';

export class ClaudeDetector implements DetectorStrategy {
  readonly providerName = 'claude';
  readonly submitKey = '\r' as const;
  // claude는 풀스크린 TUI라 입력창(│ >)이 응답 생성 중에도 항상 화면에
  // 그려진다. 입력창 패턴을 종료 신호(B2)로 쓰면 응답 도중 가짜 완료가
  // 발생하므로 의도적으로 비활성화한다 (never-match). 종료 판정은
  // B1 sentinel과 B3 hard timeout이 담당한다.
  readonly shellPromptRegex = /(?!)/;
}
