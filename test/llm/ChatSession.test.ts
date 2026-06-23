import { expect } from 'chai';
import { ChatSession, type ChatSessionDeps } from '../../src/llm/ChatSession';
import type {
  PtySessionLike,
  OrchestratorConfig,
} from '../../src/llm/LLMOrchestrator';
import type { CostGuardOutput } from '../../src/llm/ProviderConfig';

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

function captureOutput(): CostGuardOutput {
  return { appendLine() {} };
}

function makeDeps(
  overrides: Partial<OrchestratorConfig> = {},
): ChatSessionDeps & {
  sessions: RecordedSession[];
  spawned: { command: string; args: readonly string[] }[];
} {
  const sessions: RecordedSession[] = [];
  const spawned: { command: string; args: readonly string[] }[] = [];
  return {
    sessions,
    spawned,
    output: captureOutput(),
    timing: { bootTimeoutMs: 0, bootSettleMs: 0, submitKeyDelayMs: 0 },
    readConfig(): OrchestratorConfig {
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
      const s = recordingSession();
      sessions.push(s);
      return s;
    },
  };
}

function settleTimers(): Promise<void> {
  return new Promise((r) => setTimeout(r, 5));
}

function uuidOf(prompt: string): string {
  return prompt.match(/<<<BEGIN-([0-9a-f-]+)>>>/)![1];
}

describe('ChatSession', () => {
  it('lazy spawn — 생성만으로는 spawn하지 않고 첫 runTurn에서 spawn한다', async () => {
    const deps = makeDeps();
    const cs = new ChatSession(deps);
    expect(deps.spawned).to.have.lengthOf(0);

    const p = cs.runTurn('/tmp/doc.md', '고쳐줘', []);
    await settleTimers();
    expect(deps.spawned).to.have.lengthOf(1);

    const s = deps.sessions[0];
    const uuid = uuidOf(s.writes[0]);
    s.emit(`<<<END-${uuid}>>>\nok\n<<<DONE-${uuid}>>>\n`);
    await p;
  });

  it('claude direct는 --permission-mode acceptEdits로 spawn한다', async () => {
    const deps = makeDeps();
    const cs = new ChatSession(deps);
    const p = cs.runTurn('/tmp/doc.md', '고쳐줘', []);
    await settleTimers();
    expect(deps.spawned[0].args).to.deep.equal([
      '--permission-mode',
      'acceptEdits',
    ]);
    const s = deps.sessions[0];
    const uuid = uuidOf(s.writes[0]);
    s.emit(`<<<END-${uuid}>>>\nok\n<<<DONE-${uuid}>>>\n`);
    await p;
  });

  it('세션 재사용 — 2턴이 같은 PTY를 쓰고 spawn은 1회뿐, 턴마다 uuid가 다르다', async () => {
    const deps = makeDeps();
    const cs = new ChatSession(deps);

    const p1 = cs.runTurn('/tmp/doc.md', '첫 지시', []);
    await settleTimers();
    const s = deps.sessions[0];
    const uuid1 = uuidOf(s.writes[0]);
    s.emit(`<<<END-${uuid1}>>>\nok1\n<<<DONE-${uuid1}>>>\n`);
    await p1;

    const p2 = cs.runTurn('/tmp/doc.md', '둘째 지시', []);
    await settleTimers();
    expect(deps.spawned).to.have.lengthOf(1); // 재spawn 없음

    // 턴1 writes = [prompt1, '\r'], 턴2 writes는 그 뒤에 누적된다.
    const turn2Prompt = s.writes[2];
    const uuid2 = uuidOf(turn2Prompt);
    expect(uuid2).to.not.equal(uuid1);
    expect(turn2Prompt).to.contain('둘째 지시');
    s.emit(`<<<END-${uuid2}>>>\nok2\n<<<DONE-${uuid2}>>>\n`);
    await p2;
  });

  it('매 턴 프롬프트와 Enter를 별도 burst로 보낸다 (paste-newline 회피)', async () => {
    const deps = makeDeps();
    const cs = new ChatSession(deps);
    const p = cs.runTurn('/tmp/doc.md', '고쳐줘', []);
    await settleTimers();
    const s = deps.sessions[0];
    expect(s.writes).to.have.lengthOf(2);
    expect(s.writes[0]).to.contain('<<<BEGIN-');
    expect(s.writes[1]).to.equal('\r');
    const uuid = uuidOf(s.writes[0]);
    s.emit(`<<<END-${uuid}>>>\nok\n<<<DONE-${uuid}>>>\n`);
    await p;
  });

  it('dispose — 진행 중 턴을 reject하고 PTY를 kill한다 (탭 닫힘 누수 방지)', async () => {
    const deps = makeDeps();
    const cs = new ChatSession(deps);
    const p = cs.runTurn('/tmp/doc.md', '고쳐줘', []);
    await settleTimers();

    // 완료 신호를 주지 않고 세션을 dispose (탭 닫힘 시나리오).
    let rejected: Error | null = null;
    const guarded = p.catch((e: Error) => {
      rejected = e;
    });
    await cs.dispose();
    await guarded;

    expect(rejected).to.be.instanceOf(Error);
    expect(deps.sessions[0].killed).to.equal(1);
  });

  it('dispose는 멱등하다 (onDidDispose + deactivate 중복 발동 대비)', async () => {
    const deps = makeDeps();
    const cs = new ChatSession(deps);
    const p = cs.runTurn('/tmp/doc.md', '고쳐줘', []);
    await settleTimers();

    const guarded = p.catch(() => {});
    await cs.dispose();
    await cs.dispose();
    await guarded;

    expect(deps.sessions[0].killed).to.equal(1); // 두 번 호출해도 kill 1회
  });

  it('dispose 후 runTurn은 거부된다', async () => {
    const deps = makeDeps();
    const cs = new ChatSession(deps);
    await cs.dispose();

    let threw: Error | null = null;
    try {
      await cs.runTurn('/tmp/doc.md', '고쳐줘', []);
    } catch (e) {
      threw = e as Error;
    }
    expect(threw).to.be.instanceOf(Error);
    expect(deps.spawned).to.have.lengthOf(0);
  });

  it('invalid args — cost guard가 spawn을 거부한다', async () => {
    const deps = makeDeps({ args: ['-p'] });
    const cs = new ChatSession(deps);

    let threw: Error | null = null;
    try {
      await cs.runTurn('/tmp/doc.md', '고쳐줘', []);
    } catch (e) {
      threw = e as Error;
    }
    expect(threw).to.be.instanceOf(Error);
    expect(threw?.message).to.match(/args/);
    expect(deps.spawned).to.have.lengthOf(0);
  });
});
