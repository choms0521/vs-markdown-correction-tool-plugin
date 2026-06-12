import { expect } from 'chai';
import {
  validateArgs,
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

describe('validateArgs — whitelist enforcement', () => {
  it('empty args is allowed for all three providers', () => {
    expect(() => validateArgs('claude', [])).to.not.throw();
    expect(() => validateArgs('codex', [])).to.not.throw();
    expect(() => validateArgs('gemini', [])).to.not.throw();
  });

  it("rejects ['-p'] across all providers", () => {
    expect(() => validateArgs('claude', ['-p'])).to.throw(/args/);
    expect(() => validateArgs('codex', ['-p'])).to.throw(/args/);
    expect(() => validateArgs('gemini', ['-p'])).to.throw(/args/);
  });

  it("rejects ['--print']", () => {
    expect(() => validateArgs('claude', ['--print'])).to.throw(/args/);
  });

  it('claude는 direct 모드용 --permission-mode acceptEdits를 허용', () => {
    expect(() =>
      validateArgs('claude', ['--permission-mode', 'acceptEdits']),
    ).to.not.throw();
  });

  it('codex/gemini는 --permission-mode를 허용하지 않음', () => {
    expect(() => validateArgs('codex', ['--permission-mode'])).to.throw(/args/);
    expect(() => validateArgs('gemini', ['--permission-mode'])).to.throw(/args/);
  });

  it('rejects arbitrary unknown tokens', () => {
    expect(() => validateArgs('claude', ['--something-else'])).to.throw();
  });

  it('logs args-whitelist-violation event on failure', () => {
    const out = captureOutput();
    expect(() => validateArgs('claude', ['-p'], out)).to.throw();
    expect(out.lines.some((l) => l.includes('args-whitelist-violation'))).to.equal(true);
  });

  it('reports all violating tokens in the error message', () => {
    let captured: Error | null = null;
    try {
      validateArgs('claude', ['-p', '--print', '-x']);
    } catch (e) {
      captured = e as Error;
    }
    expect(captured?.message).to.match(/-p/);
    expect(captured?.message).to.match(/--print/);
    expect(captured?.message).to.match(/-x/);
  });
});
