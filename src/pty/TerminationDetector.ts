import { AnsiSanitizer } from './AnsiSanitizer';

export interface TerminationDetectorOptions {
  envelopeEnd: string;
  sentinel: string;
  shellPromptRegex: RegExp;
  hardTimeoutMs?: number;
  quietPeriodMs?: number;
  sanitizer?: AnsiSanitizer;
}

/**
 * Envelope-aware termination detector for LLM CLI sessions.
 *
 * Stage A: discard buffer until the envelope-end token is seen
 *   (echo region of the prompt is dropped along with the marker itself).
 * Stage B1: once in the response region, when the sentinel token is found,
 *   start a quiet-period timer. Additional chunks reset the timer and the
 *   final lastIndexOf of the sentinel is used to trim the result
 *   (mitigates R-16: stream fragmentation false-resolve).
 * Stage B2: if the configured shell-prompt regex matches in the response
 *   region, resolve immediately with the accumulated buffer.
 * Stage B3: hard timeout (default 90s) rejects the promise.
 */
export class TerminationDetector {
  private buffer = '';
  private promptEndDetected = false;
  private quietTimer?: NodeJS.Timeout;
  private hardTimer?: NodeJS.Timeout;
  private settled = false;
  private readonly sanitizer: AnsiSanitizer;
  private readonly hardTimeoutMs: number;
  private readonly quietPeriodMs: number;

  constructor(
    private readonly opts: TerminationDetectorOptions,
    private readonly resolve: (markdown: string) => void,
    private readonly reject: (err: Error) => void,
  ) {
    this.sanitizer = opts.sanitizer ?? new AnsiSanitizer();
    this.hardTimeoutMs = opts.hardTimeoutMs ?? 90_000;
    this.quietPeriodMs = opts.quietPeriodMs ?? 200;
    this.hardTimer = setTimeout(
      () =>
        this.fail(
          new Error(`LLM response timed out after ${this.hardTimeoutMs}ms`),
        ),
      this.hardTimeoutMs,
    );
  }

  feed(chunk: string): void {
    if (this.settled) return;
    this.buffer += this.sanitizer.sanitize(chunk);

    if (!this.promptEndDetected) {
      const endIdx = this.buffer.indexOf(this.opts.envelopeEnd);
      if (endIdx === -1) return;
      this.buffer = this.buffer.slice(endIdx + this.opts.envelopeEnd.length);
      this.promptEndDetected = true;
    }

    const sentinelIdx = this.buffer.lastIndexOf(this.opts.sentinel);
    if (sentinelIdx !== -1) {
      if (this.quietTimer) clearTimeout(this.quietTimer);
      this.quietTimer = setTimeout(() => {
        const finalIdx = this.buffer.lastIndexOf(this.opts.sentinel);
        this.settle(this.buffer.slice(0, finalIdx).trim());
      }, this.quietPeriodMs);
      return;
    }

    if (this.opts.shellPromptRegex.test(this.buffer)) {
      this.settle(this.buffer);
    }
  }

  private settle(markdown: string): void {
    if (this.settled) return;
    this.settled = true;
    if (this.quietTimer) clearTimeout(this.quietTimer);
    if (this.hardTimer) clearTimeout(this.hardTimer);
    this.resolve(markdown);
  }

  private fail(err: Error): void {
    if (this.settled) return;
    this.settled = true;
    if (this.quietTimer) clearTimeout(this.quietTimer);
    if (this.hardTimer) clearTimeout(this.hardTimer);
    this.reject(err);
  }

  // 외부에서 진행 중인 턴을 강제 종료한다 (예: 탭 닫힘으로 세션 dispose).
  // PTY를 죽이면 완료 신호가 영영 오지 않아 awaiter가 무한 대기하므로,
  // 반드시 이 abort로 약속을 reject해야 한다. settled면 무시(멱등).
  abort(reason: string): void {
    this.fail(new Error(reason));
  }

  dispose(): void {
    if (this.quietTimer) clearTimeout(this.quietTimer);
    if (this.hardTimer) clearTimeout(this.hardTimer);
  }
}
