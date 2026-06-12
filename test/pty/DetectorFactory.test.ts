import { expect } from 'chai';
import { DetectorFactory } from '../../src/pty/detector/DetectorFactory';
import { ClaudeDetector } from '../../src/pty/detector/ClaudeDetector';
import { CodexDetector } from '../../src/pty/detector/CodexDetector';
import { GeminiDetector } from '../../src/pty/detector/GeminiDetector';

describe('DetectorFactory', () => {
  it('returns ClaudeDetector for claude', () => {
    expect(DetectorFactory.for('claude')).to.be.instanceOf(ClaudeDetector);
  });

  it('returns CodexDetector for codex', () => {
    expect(DetectorFactory.for('codex')).to.be.instanceOf(CodexDetector);
  });

  it('returns GeminiDetector for gemini', () => {
    expect(DetectorFactory.for('gemini')).to.be.instanceOf(GeminiDetector);
  });
});
