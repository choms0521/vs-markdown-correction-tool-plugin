import { DetectorStrategy } from './DetectorStrategy';
import { ClaudeDetector } from './ClaudeDetector';
import { CodexDetector } from './CodexDetector';
import { GeminiDetector } from './GeminiDetector';

export type ProviderName = 'claude' | 'codex' | 'gemini';

export class DetectorFactory {
  static for(name: ProviderName): DetectorStrategy {
    switch (name) {
      case 'claude':
        return new ClaudeDetector();
      case 'codex':
        return new CodexDetector();
      case 'gemini':
        return new GeminiDetector();
      default: {
        const _exhaustive: never = name;
        throw new Error(`Unknown provider: ${String(_exhaustive)}`);
      }
    }
  }
}
