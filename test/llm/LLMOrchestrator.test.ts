import { expect } from 'chai';
import {
  LLMOrchestrator,
  type LLMOrchestratorDeps,
  type PtySessionLike,
  type OrchestratorConfig,
} from '../../src/llm/LLMOrchestrator';
import type { CostGuardOutput } from '../../src/llm/ProviderConfig';

function captureOutput(): CostGuardOutput & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    appendLine(line: string) {
      lines.push(line);
    },
  };
}

interface RecordedSession extends PtySessionLike {
  writes: string[];
  killed: number;
  emit(chunk: string): void;
}

function recordingSession(): RecordedSession {
  const writes: string[] = [];
  let handler: ((chunk: string) => void) | null = null;
  let killed = 0;
  return {
    writes,
    get killed() {
      return killed;
    },
    set killed(v: number) {
      killed = v;
    },
    write(payload: string) {
      writes.push(payload);
    },
    onData(h: (chunk: string) => void) {
      handler = h;
      return {
        dispose() {
          handler = null;
        },
      };
    },
    async kill() {
      killed += 1;
    },
    emit(chunk: string) {
      if (handler) handler(chunk);
    },
  };
}

function makeDeps(
  overrides: Partial<OrchestratorConfig> = {},
): LLMOrchestratorDeps & {
  output: ReturnType<typeof captureOutput>;
  spawned: { command: string; args: readonly string[] }[];
  session: RecordedSession;
} {
  const session = recordingSession();
  const spawned: { command: string; args: readonly string[] }[] = [];
  const output = captureOutput();
  return {
    output,
    spawned,
    session,
    timing: { bootTimeoutMs: 0, bootSettleMs: 0, submitKeyDelayMs: 0 },
    readConfig() {
      return {
        provider: 'claude',
        command: 'claude',
        args: [],
        sentinelTimeoutMs: 5000,
        ...overrides,
      };
    },
    spawn(command, args) {
      spawned.push({ command, args });
      return session;
    },
  };
}

function settleTimers(): Promise<void> {
  return new Promise((r) => setTimeout(r, 5));
}

describe('LLMOrchestrator', () => {
  it('happy path — writes prompt, parses fenced markdown, resolves SubmitResult', async () => {
    const deps = makeDeps();
    const orch = new LLMOrchestrator(deps);

    const submitPromise = orch.submit('# Title\nbody text', []);
    await settleTimers();

    // 프롬프트와 Enter는 별도 write여야 한다 (TUI paste-mode 회피).
    expect(deps.session.writes).to.have.lengthOf(2);
    const written = deps.session.writes[0];
    expect(written).to.contain('<<<BEGIN-');
    expect(written).to.contain('<<<END-');
    expect(deps.session.writes[1]).to.equal('\r');
    const beginMatch = written.match(/<<<BEGIN-([0-9a-f-]+)>>>/);
    expect(beginMatch, 'expected BEGIN token in prompt').to.not.equal(null);
    const uuid = beginMatch![1];
    const endTag = `<<<END-${uuid}>>>`;
    const doneTag = `<<<DONE-${uuid}>>>`;

    deps.session.emit(
      `${endTag}\nresponse stream\n\n\`\`\`markdown\nupdated body\n\`\`\`\n${doneTag}\n`,
    );

    const result = await submitPromise;
    expect(result.markdown).to.equal('updated body');
    expect(result.raw).to.contain('updated body');
    expect(result.uuid).to.equal(uuid);
    expect(deps.session.killed).to.equal(1);
  });

  it('invalid command — throws and does not spawn', async () => {
    const deps = makeDeps({ command: 'claude-wrapper' });
    const orch = new LLMOrchestrator(deps);

    let threw: Error | null = null;
    try {
      await orch.submit('body', []);
    } catch (e) {
      threw = e as Error;
    }

    expect(threw).to.be.instanceOf(Error);
    expect(threw?.message).to.match(/command basename/);
    expect(deps.spawned).to.have.lengthOf(0);
    expect(deps.session.killed).to.equal(0);
  });

  it('invalid args — throws and does not spawn', async () => {
    const deps = makeDeps({ args: ['-p'] });
    const orch = new LLMOrchestrator(deps);

    let threw: Error | null = null;
    try {
      await orch.submit('body', []);
    } catch (e) {
      threw = e as Error;
    }

    expect(threw).to.be.instanceOf(Error);
    expect(threw?.message).to.match(/args/);
    expect(deps.spawned).to.have.lengthOf(0);
  });

  it('timeout — rejects, still kills session via finally', async () => {
    const deps = makeDeps({ sentinelTimeoutMs: 50 });
    const orch = new LLMOrchestrator(deps);

    let threw: Error | null = null;
    try {
      await orch.submit('body', []);
    } catch (e) {
      threw = e as Error;
    }

    expect(threw).to.be.instanceOf(Error);
    expect(threw?.message).to.match(/timed out/i);
    expect(deps.session.killed).to.equal(1);
  });

  it('logs submit start and submit done lines on success', async () => {
    const deps = makeDeps();
    const orch = new LLMOrchestrator(deps);

    const submitPromise = orch.submit('body', []);
    await settleTimers();
    const written = deps.session.writes[0];
    const uuid = written.match(/<<<BEGIN-([0-9a-f-]+)>>>/)![1];
    deps.session.emit(
      `<<<END-${uuid}>>>\nstuff\n\`\`\`markdown\nok\n\`\`\`\n<<<DONE-${uuid}>>>\n`,
    );
    await submitPromise;

    expect(deps.output.lines.some((l) => l.includes('submit start'))).to.equal(
      true,
    );
    expect(deps.output.lines.some((l) => l.includes('submit done'))).to.equal(
      true,
    );
  });
});
