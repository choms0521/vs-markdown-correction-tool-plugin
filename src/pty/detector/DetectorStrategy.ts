/**
 * Provider-specific behavior used by NodePtySession and TerminationDetector.
 *
 * Echo skipping is solved by the envelope token in TerminationDetector
 * (v3-Edit-4), so the strategy interface no longer carries an
 * echo-handling method — only the submit key and the shell-prompt regex
 * vary per provider.
 */
export interface DetectorStrategy {
  readonly providerName: string;
  readonly submitKey: '\r' | '\r\n' | 'bracketed-paste';
  readonly shellPromptRegex: RegExp;
}
