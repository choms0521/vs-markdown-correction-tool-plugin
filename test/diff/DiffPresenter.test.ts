import { expect } from 'chai';
import {
  DiffPresenter,
  type DiffPresenterDeps,
  type UriLike,
} from '../../src/diff/DiffPresenter';

interface FakeDeps extends DiffPresenterDeps {
  opened: { content: string; language: string }[];
  commands: { command: string; args: unknown[] }[];
  fakeRevisedUri: UriLike;
}

function makeDeps(): FakeDeps {
  const opened: { content: string; language: string }[] = [];
  const commands: { command: string; args: unknown[] }[] = [];
  const fakeRevisedUri: UriLike = { toString: () => 'untitled:revised' };
  return {
    opened,
    commands,
    fakeRevisedUri,
    async openTextDocument(opts: { content: string; language: string }) {
      opened.push(opts);
      return { uri: fakeRevisedUri };
    },
    async executeCommand(command: string, ...args: unknown[]) {
      commands.push({ command, args });
      return undefined;
    },
  };
}

describe('DiffPresenter', () => {
  it('openTextDocument에 revised content + markdown language를 전달한다', async () => {
    const deps = makeDeps();
    const p = new DiffPresenter(deps);
    const originalUri: UriLike = { toString: () => 'file:///foo.md' };
    await p.present(originalUri, 'hello\nworld', 'title');
    expect(deps.opened).to.have.lengthOf(1);
    expect(deps.opened[0]).to.deep.equal({
      content: 'hello\nworld',
      language: 'markdown',
    });
  });

  it('vscode.diff 명령을 (origin, revised, title, options) 인자로 호출한다', async () => {
    const deps = makeDeps();
    const p = new DiffPresenter(deps);
    const originalUri: UriLike = { toString: () => 'file:///foo.md' };
    await p.present(originalUri, 'x', 'mdReview: foo.md');
    expect(deps.commands).to.have.lengthOf(1);
    const c = deps.commands[0];
    expect(c.command).to.equal('vscode.diff');
    expect(c.args[0]).to.equal(originalUri);
    expect(c.args[1]).to.equal(deps.fakeRevisedUri);
    expect(c.args[2]).to.equal('mdReview: foo.md');
    expect(c.args[3]).to.deep.equal({ preview: true });
  });

  it('생성된 revised doc의 uri를 반환한다', async () => {
    const deps = makeDeps();
    const p = new DiffPresenter(deps);
    const originalUri: UriLike = { toString: () => 'file:///foo.md' };
    const ret = await p.present(originalUri, 'x', 't');
    expect(ret).to.equal(deps.fakeRevisedUri);
  });

  it('openTextDocument 실패 시 executeCommand를 호출하지 않는다', async () => {
    const commands: { command: string; args: unknown[] }[] = [];
    const deps: DiffPresenterDeps = {
      async openTextDocument() {
        throw new Error('mock open failed');
      },
      async executeCommand(command, ...args) {
        commands.push({ command, args });
        return undefined;
      },
    };
    const p = new DiffPresenter(deps);
    let threw: Error | null = null;
    try {
      await p.present({ toString: () => 'x' }, 'r', 't');
    } catch (e) {
      threw = e as Error;
    }
    expect(threw).to.be.instanceOf(Error);
    expect(commands).to.have.lengthOf(0);
  });
});
