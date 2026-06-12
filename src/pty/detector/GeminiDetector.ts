import { DetectorStrategy } from './DetectorStrategy';

export class GeminiDetector implements DetectorStrategy {
  readonly providerName = 'gemini';
  readonly submitKey = '\r' as const;
  readonly shellPromptRegex = /\n\s*>\s*$/m;
}
