import { type Comment } from '../model/Comment';
import { PromptBuilder, type BuiltPrompt } from './PromptBuilder';
import { ResponseExtractor } from './ResponseExtractor';
import {
  validateCommand,
  validateArgs,
  type ProviderName,
  type CostGuardOutput,
} from './ProviderConfig';
import { TerminationDetector } from '../pty/TerminationDetector';
import { DetectorFactory } from '../pty/detector/DetectorFactory';
import { AnsiSanitizer } from '../pty/AnsiSanitizer';

const DIAGNOSTIC_BUFFER_CHARS = 2000;
const DIAGNOSTIC_LOG_TAIL_CHARS = 600;

export interface PtySessionLike {
  write(payload: string): void;
  onData(handler: (chunk: string) => void): { dispose(): void };
  kill(
    signal?: 'SIGTERM' | 'SIGKILL',
    forceTimeoutMs?: number,
  ): Promise<void>;
}

export interface OrchestratorConfig {
  provider: ProviderName;
  command: string;
  args: string[];
  sentinelTimeoutMs: number;
}

// Interactive TUI(claude 등)는 부팅이 끝나기 전의 입력을 버릴 수 있고,
// 프롬프트와 같은 burst로 도착한 Enter를 "붙여넣기 내 줄바꿈"으로 해석하여
// 제출하지 않는다. 따라서 (1) 첫 출력 후 settle 대기 → (2) 프롬프트 주입 →
// (3) 별도 burst로 Enter 송신의 3단계 타이밍이 필요하다.
export interface OrchestratorTiming {
  bootTimeoutMs: number;
  bootSettleMs: number;
  submitKeyDelayMs: number;
}

const DEFAULT_TIMING: OrchestratorTiming = {
  bootTimeoutMs: 10_000,
  bootSettleMs: 1_200,
  submitKeyDelayMs: 600,
};

export interface LLMOrchestratorDeps {
  readConfig(): OrchestratorConfig;
  spawn(command: string, args: readonly string[]): PtySessionLike;
  output: CostGuardOutput;
  promptBuilder?: PromptBuilder;
  responseExtractor?: ResponseExtractor;
  timing?: Partial<OrchestratorTiming>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SubmitResult {
  markdown: string;
  raw: string;
  uuid: string;
  durationMs: number;
}

export interface SubmitOptions {
  // diff: 응답을 fenced markdown으로 받아 hunk 승인 후 적용 (기존 흐름)
  // direct: CLI가 대상 파일을 도구로 직접 수정 (화면 긁기 손상 면역)
  mode: 'diff' | 'direct';
  filePath?: string;
}

export class LLMOrchestrator {
  private readonly promptBuilder: PromptBuilder;
  private readonly responseExtractor: ResponseExtractor;

  constructor(private readonly deps: LLMOrchestratorDeps) {
    this.promptBuilder = deps.promptBuilder ?? new PromptBuilder();
    this.responseExtractor = deps.responseExtractor ?? new ResponseExtractor();
  }

  async submit(
    documentText: string,
    comments: readonly Comment[],
    opts: SubmitOptions = { mode: 'diff' },
  ): Promise<SubmitResult> {
    const cfg = this.deps.readConfig();

    const direct = opts.mode === 'direct';
    if (direct && !opts.filePath) {
      throw new Error('direct 모드에는 filePath가 필요합니다.');
    }
    // direct 모드에서 파일 편집 권한 프롬프트로 TUI가 멈추지 않도록
    // provider별 자동 승인 플래그를 추가한다 (화이트리스트 검증 대상).
    const args =
      direct && cfg.provider === 'claude'
        ? [...cfg.args, '--permission-mode', 'acceptEdits']
        : cfg.args;

    validateCommand(cfg.provider, cfg.command, this.deps.output);
    validateArgs(cfg.provider, args, this.deps.output);

    const built: BuiltPrompt = direct
      ? this.promptBuilder.buildDirect(opts.filePath as string, comments)
      : this.promptBuilder.build(documentText, comments);
    const strategy = DetectorFactory.for(cfg.provider);
    const startedAt = Date.now();

    this.deps.output.appendLine(
      `[mdReview] submit start provider=${cfg.provider} mode=${opts.mode} uuid=${built.uuid}`,
    );

    const session = this.deps.spawn(cfg.command, args);

    const timing: OrchestratorTiming = { ...DEFAULT_TIMING, ...this.deps.timing };

    // 실패 진단용 rolling tail: timeout 시 CLI가 실제로 무엇을 출력했는지
    // 없이는 원인 추적이 불가능하다.
    let diagnosticTail = '';
    let onFirstChunk: (() => void) | null = null;

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
      session.onData((chunk) => {
        if (onFirstChunk) {
          onFirstChunk();
          onFirstChunk = null;
        }
        diagnosticTail = (diagnosticTail + chunk).slice(-DIAGNOSTIC_BUFFER_CHARS);
        detector.feed(chunk);
      });
    });

    // 1단계: TUI 부팅 대기 — 첫 출력 chunk 이후 settle 시간까지 기다린다.
    // bootTimeoutMs 안에 출력이 없으면 그대로 진행한다 (REPL형 CLI 대비).
    if (timing.bootTimeoutMs > 0) {
      await new Promise<void>((resolve) => {
        const fallback = setTimeout(resolve, timing.bootTimeoutMs);
        onFirstChunk = () => {
          clearTimeout(fallback);
          setTimeout(resolve, timing.bootSettleMs);
        };
      });
    }

    // 2단계: 프롬프트 주입 (TUI는 이 burst를 붙여넣기로 인식한다).
    session.write(built.prompt);

    // 3단계: Enter는 반드시 별도 burst로 보내야 제출로 인식된다.
    if (timing.submitKeyDelayMs > 0) {
      await sleep(timing.submitKeyDelayMs);
    }
    const tail = strategy.submitKey === '\r\n' ? '\r\n' : '\r';
    session.write(tail);

    try {
      const raw = await settled;
      // direct 모드의 채팅 출력은 완료 신호일 뿐 본문이 아니다.
      const markdown = direct ? '' : this.responseExtractor.extract(raw);
      const durationMs = Date.now() - startedAt;
      this.deps.output.appendLine(
        `[mdReview] submit done ${durationMs}ms bytes=${raw.length}`,
      );
      return { markdown, raw, uuid: built.uuid, durationMs };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.output.appendLine(`[mdReview] submit FAIL: ${message}`);
      const sanitizedTail = new AnsiSanitizer()
        .sanitize(diagnosticTail)
        .slice(-DIAGNOSTIC_LOG_TAIL_CHARS);
      this.deps.output.appendLine(
        `[mdReview] submit FAIL pty-tail(${sanitizedTail.length} chars): ${JSON.stringify(sanitizedTail)}`,
      );
      throw err;
    } finally {
      await session.kill('SIGTERM');
    }
  }
}
