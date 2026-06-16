import { type Comment } from '../model/Comment';
import { PromptBuilder } from './PromptBuilder';
import {
  validateCommand,
  validateArgs,
  directPermissionArgs,
  type CostGuardOutput,
} from './ProviderConfig';
import {
  DEFAULT_TIMING,
  type OrchestratorConfig,
  type OrchestratorTiming,
  type PtySessionLike,
} from './LLMOrchestrator';
import { TerminationDetector } from '../pty/TerminationDetector';
import { DetectorFactory } from '../pty/detector/DetectorFactory';
import { type DetectorStrategy } from '../pty/detector/DetectorStrategy';

export interface ChatSessionDeps {
  readConfig(): OrchestratorConfig;
  spawn(command: string, args: readonly string[]): PtySessionLike;
  output: CostGuardOutput;
  promptBuilder?: PromptBuilder;
  timing?: Partial<OrchestratorTiming>;
}

export interface ChatTurnResult {
  raw: string;
  uuid: string;
  durationMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 멀티턴 채팅용 장수명 PTY 세션. LLMOrchestrator의 일회성 submit과 달리
 * spawn / 턴 실행 / kill을 분리하여, interactive CLI 세션을 살려둔 채
 * 여러 지시를 주고받아 대화 맥락을 유지한다.
 *
 * 수명 규칙:
 * - 첫 turn에서만 spawn(lazy) + boot 대기. 이후 turn은 즉시 프롬프트 주입.
 * - 세션 종료는 오직 dispose()로만 (탭 가시성과 무관 — 백그라운드 탭 유지).
 * - dispose는 진행 중인 turn을 abort로 끊어, PTY를 죽인 뒤 awaiter가
 *   무한 대기하는 누수를 막는다. 멱등하다.
 */
export class ChatSession {
  private pty: PtySessionLike | null = null;
  private activeDetector: TerminationDetector | null = null;
  private disposed = false;
  private onFirstChunk: (() => void) | null = null;
  private cfg: OrchestratorConfig | null = null;
  private strategy: DetectorStrategy | null = null;
  private readonly promptBuilder: PromptBuilder;
  private readonly timing: OrchestratorTiming;

  constructor(private readonly deps: ChatSessionDeps) {
    this.promptBuilder = deps.promptBuilder ?? new PromptBuilder();
    this.timing = { ...DEFAULT_TIMING, ...deps.timing };
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  // 첫 호출에서만 spawn + boot 대기. 이후는 살아있는 세션을 재사용한다.
  private async ensureStarted(): Promise<void> {
    if (this.disposed) {
      throw new Error('채팅 세션이 종료되었습니다.');
    }
    if (this.pty) {
      return;
    }

    const cfg = this.deps.readConfig();
    this.cfg = cfg;
    // 채팅은 항상 direct 경로(파일 직접 수정)이므로 provider별 편집 권한
    // 자동 승인 플래그를 붙인다 (화이트리스트 검증 대상).
    const args = [...cfg.args, ...directPermissionArgs(cfg.provider)];
    validateCommand(cfg.provider, cfg.command, this.deps.output);
    validateArgs(cfg.provider, args, this.deps.output);
    this.strategy = DetectorFactory.for(cfg.provider);

    this.deps.output.appendLine(
      `[mdReview] chat-session spawn provider=${cfg.provider}`,
    );
    const session = this.deps.spawn(cfg.command, args);
    this.pty = session;

    // onData는 세션 수명 동안 한 번만 구독하고, 현재 활성 detector로
    // 라우팅한다 (턴마다 detector는 새로 만든다).
    session.onData((chunk) => {
      if (this.onFirstChunk) {
        this.onFirstChunk();
        this.onFirstChunk = null;
      }
      this.activeDetector?.feed(chunk);
    });

    // 첫 부팅 대기 (turn 1만). 첫 출력 chunk 이후 settle까지 기다린다.
    if (this.timing.bootTimeoutMs > 0) {
      await new Promise<void>((resolve) => {
        const fallback = setTimeout(resolve, this.timing.bootTimeoutMs);
        this.onFirstChunk = () => {
          clearTimeout(fallback);
          setTimeout(resolve, this.timing.bootSettleMs);
        };
      });
    }
  }

  async runTurn(
    filePath: string,
    instruction: string,
    comments: readonly Comment[],
  ): Promise<ChatTurnResult> {
    await this.ensureStarted();
    if (this.disposed || !this.pty || !this.cfg || !this.strategy) {
      throw new Error('채팅 세션이 종료되었습니다.');
    }
    const pty = this.pty;
    const cfg = this.cfg;
    const strategy = this.strategy;

    // 매 턴 새 uuid로 envelope를 만든다. detector의 Stage-A가 envelopeEnd
    // 전까지(= 이전 턴 응답 포함)를 버리므로, 화면에 남은 이전 턴 출력이
    // 이번 턴 결과로 새지 않는다.
    const built = this.promptBuilder.buildDirectInstruction(
      filePath,
      instruction,
      comments,
    );
    const startedAt = Date.now();

    const settled = new Promise<string>((resolve, reject) => {
      const detector = new TerminationDetector(
        {
          envelopeEnd: built.envelopeEnd,
          sentinel: built.sentinel,
          shellPromptRegex: strategy.shellPromptRegex,
          hardTimeoutMs: cfg.sentinelTimeoutMs,
        },
        (body) => resolve(body),
        (err) => reject(err),
      );
      this.activeDetector = detector;
    });

    // 프롬프트와 Enter는 매 턴 반드시 별도 burst로 보낸다 (TUI는 같은
    // burst의 Enter를 붙여넣기 줄바꿈으로 삼켜 제출하지 않는다 —
    // boot가 아니라 제출 단위마다 발생하는 문제다).
    pty.write(built.prompt);
    if (this.timing.submitKeyDelayMs > 0) {
      await sleep(this.timing.submitKeyDelayMs);
    }
    pty.write(strategy.submitKey === '\r\n' ? '\r\n' : '\r');

    try {
      const raw = await settled;
      return { raw, uuid: built.uuid, durationMs: Date.now() - startedAt };
    } finally {
      this.activeDetector?.dispose();
      this.activeDetector = null;
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    // 진행 중인 턴을 먼저 끊어야 한다. PTY를 죽이면 완료 신호가 오지
    // 않아 awaiter가 영원히 매달린다 (탭 닫힘 시의 누수 원인).
    this.activeDetector?.abort('채팅 세션이 종료되었습니다.');
    this.activeDetector = null;
    const pty = this.pty;
    this.pty = null;
    if (pty) {
      await pty.kill('SIGTERM');
    }
  }
}
