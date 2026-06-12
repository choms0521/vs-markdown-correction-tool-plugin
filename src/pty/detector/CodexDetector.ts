import { DetectorStrategy } from './DetectorStrategy';

export class CodexDetector implements DetectorStrategy {
  readonly providerName = 'codex';
  readonly submitKey = '\r' as const;
  readonly shellPromptRegex = /\n\s*>\s*$/m;
}
