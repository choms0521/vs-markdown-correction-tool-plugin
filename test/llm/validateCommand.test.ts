import { expect } from 'chai';
import {
  validateCommand,
  ALLOWED_COMMAND_BASENAMES,
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

  it('antigravity provider — only agy basename accepted', () => {
    expect(() => validateCommand('antigravity', 'agy')).to.not.throw();
    expect(() => validateCommand('antigravity', 'codex')).to.throw();
  });

  it('기본 basename 폴백(ALLOWED_COMMAND_BASENAMES)은 모든 provider에서 통과', () => {
    // readProviderConfig는 command 미설정 시 ALLOWED_COMMAND_BASENAMES[provider]로
    // 폴백한다. 그 값이 항상 validateCommand를 통과해야 한다 — provider명과
    // basename이 다른 antigravity→agy 분리에서의 회귀를 방지한다.
    for (const p of ['claude', 'codex', 'antigravity'] as const) {
      expect(() =>
        validateCommand(p, ALLOWED_COMMAND_BASENAMES[p]),
      ).to.not.throw();
    }
  });
});
