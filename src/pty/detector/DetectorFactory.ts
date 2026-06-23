import { DetectorStrategy } from './DetectorStrategy';
import { ClaudeDetector } from './ClaudeDetector';
import { CodexDetector } from './CodexDetector';
import { AntigravityDetector } from './AntigravityDetector';

export type ProviderName = 'claude' | 'codex' | 'antigravity';

export class DetectorFactory {
  static for(name: ProviderName): DetectorStrategy {
    switch (name) {
      case 'claude':
        return new ClaudeDetector();
      case 'codex':
        return new CodexDetector();
      case 'antigravity':
        return new AntigravityDetector();
      default: {
        const _exhaustive: never = name;
        throw new Error(`Unknown provider: ${String(_exhaustive)}`);
      }
    }
  }
}
