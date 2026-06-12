import stripAnsi from 'strip-ansi';

/**
 * Wraps strip-ansi to remove ANSI escape sequences from PTY output.
 * Used by TerminationDetector before pattern matching so that cursor
 * positioning, color codes, and similar escape sequences cannot
 * accidentally break envelope or sentinel detection.
 */
export class AnsiSanitizer {
  sanitize(chunk: string): string {
    return stripAnsi(chunk);
  }
}
