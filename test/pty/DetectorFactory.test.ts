import { expect } from 'chai';
import { DetectorFactory } from '../../src/pty/detector/DetectorFactory';
import { ClaudeDetector } from '../../src/pty/detector/ClaudeDetector';
import { CodexDetector } from '../../src/pty/detector/CodexDetector';
import { AntigravityDetector } from '../../src/pty/detector/AntigravityDetector';

describe('DetectorFactory', () => {
  it('returns ClaudeDetector for claude', () => {
    expect(DetectorFactory.for('claude')).to.be.instanceOf(ClaudeDetector);
  });

  it('returns CodexDetector for codex', () => {
    expect(DetectorFactory.for('codex')).to.be.instanceOf(CodexDetector);
  });

  it('returns AntigravityDetector for antigravity', () => {
    expect(DetectorFactory.for('antigravity')).to.be.instanceOf(
      AntigravityDetector,
    );
  });
});
