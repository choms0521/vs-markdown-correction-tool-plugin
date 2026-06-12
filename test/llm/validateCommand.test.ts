import { expect } from 'chai';
import {
  validateCommand,
  type CostGuardOutput,
} from '../../src/llm/ProviderConfig';

function captureOutput(): CostGuardOutput & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    appendLine(line: string) {
      lines.push(line);
    },
  };
}

describe('validateCommand — 4 canonical cases', () => {
  it("'claude' (bare basename) — no throw", () => {
    const out = captureOutput();
    expect(() => validateCommand('claude', 'claude', out)).to.not.throw();
    expect(out.lines.some((l) => l.includes('[cost-guard] resolved-command'))).to.equal(true);
  });

  it("'/usr/local/bin/claude' (absolute path with valid basename) — no throw", () => {
    expect(() =>
      validateCommand('claude', '/usr/local/bin/claude'),
    ).to.not.throw();
  });

  it("'claude-wrapper' (wrapper script bare) — throws", () => {
    const out = captureOutput();
    expect(() => validateCommand('claude', 'claude-wrapper', out)).to.throw(
      /command basename/,
    );
    expect(out.lines.some((l) => l.includes('command-basename-violation'))).to.equal(true);
  });

  it("'/path/to/billable-claude' (path with wrapper basename) — throws", () => {
    expect(() =>
      validateCommand('claude', '/path/to/billable-claude'),
    ).to.throw(/command basename/);
  });

  it('codex provider — only codex basename accepted', () => {
    expect(() => validateCommand('codex', 'codex')).to.not.throw();
    expect(() => validateCommand('codex', 'claude')).to.throw();
  });

  it('gemini provider — only gemini basename accepted', () => {
    expect(() => validateCommand('gemini', 'gemini')).to.not.throw();
    expect(() => validateCommand('gemini', 'codex')).to.throw();
  });
});
