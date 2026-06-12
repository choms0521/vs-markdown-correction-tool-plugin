import { expect } from 'chai';
import {
  WorkspaceStatePersistence,
  computeWorkspaceStateKey,
  type MementoLike,
} from '../../src/store/WorkspaceStatePersistence';
import type { Comment } from '../../src/model/Comment';

function fakeMemento(): MementoLike & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    get<T>(key: string): T | undefined {
      return store.get(key) as T | undefined;
    },
    async update(key: string, value: unknown): Promise<void> {
      if (value === undefined) {
        store.delete(key);
      } else {
        store.set(key, value);
      }
    },
  };
}

function sample(): Comment {
  return {
    id: 'c-ws-1',
    type: 'suggestion',
    anchor: { line: 5, col: 0, length: 3 },
    before: 'a',
    after: 'b',
    createdAt: '2026-05-15T10:00:00.000Z',
  };
}

describe('WorkspaceStatePersistence', () => {
  it('computeWorkspaceStateKey — namespaces under mdReview.comments prefix', () => {
    expect(computeWorkspaceStateKey('file:///abs/doc.md')).to.equal(
      'mdReview.comments.file:///abs/doc.md',
    );
  });

  it('WorkspaceStatePersistence round-trip — save then load preserves comments', async () => {
    const m = fakeMemento();
    const wsp = new WorkspaceStatePersistence(m);
    const original = [sample()];

    await wsp.save('file:///doc.md', original);
    const loaded = await wsp.load('file:///doc.md');

    expect(loaded).to.deep.equal(original);
  });

  it('WorkspaceStatePersistence — missing key returns empty array', async () => {
    const wsp = new WorkspaceStatePersistence(fakeMemento());
    const loaded = await wsp.load('file:///never.md');
    expect(loaded).to.deep.equal([]);
  });

  it('WorkspaceStatePersistence schema validation — corrupt value throws Korean error', async () => {
    const m = fakeMemento();
    m.store.set(
      computeWorkspaceStateKey('file:///doc.md'),
      [{ id: 'broken', /* missing required fields */ } as unknown as Comment],
    );
    const wsp = new WorkspaceStatePersistence(m);

    let threw: Error | null = null;
    try {
      await wsp.load('file:///doc.md');
    } catch (e) {
      threw = e as Error;
    }
    expect(threw).to.be.instanceOf(Error);
    expect(threw?.message).to.match(/workspaceState 코멘트 schema 검증 실패/);
  });
});
