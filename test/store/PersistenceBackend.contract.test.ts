import { expect } from 'chai';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SidecarPersistence } from '../../src/store/SidecarPersistence';
import {
  WorkspaceStatePersistence,
  type MementoLike,
} from '../../src/store/WorkspaceStatePersistence';
import type { Comment } from '../../src/model/Comment';
import type { PersistenceBackend } from '../../src/store/PersistenceBackend';

interface BackendCase {
  name: string;
  factory: () => Promise<{ backend: PersistenceBackend; docUri: string }>;
}

function fakeMemento(): MementoLike {
  const store = new Map<string, unknown>();
  return {
    get<T>(key: string): T | undefined {
      return store.get(key) as T | undefined;
    },
    async update(key: string, value: unknown): Promise<void> {
      store.set(key, value);
    },
  };
}

const cases: BackendCase[] = [
  {
    name: 'sidecar',
    factory: async () => {
      const dir = await fs.mkdtemp(join(tmpdir(), 'mdreview-contract-sidecar-'));
      return {
        backend: new SidecarPersistence(),
        docUri: join(dir, 'doc.md'),
      };
    },
  },
  {
    name: 'workspaceState',
    factory: async () => ({
      backend: new WorkspaceStatePersistence(fakeMemento()),
      docUri: 'file:///abs/doc.md',
    }),
  },
];

function sample(id: string): Comment {
  return {
    id,
    type: 'suggestion',
    anchor: { line: 1, col: 0, length: 3 },
    before: 'foo',
    after: 'bar',
    createdAt: '2026-05-15T10:00:00.000Z',
  };
}

for (const c of cases) {
  describe(`PersistenceBackend contract — ${c.name}`, () => {
    it('empty load returns empty array (no prior save)', async () => {
      const { backend, docUri } = await c.factory();
      const loaded = await backend.load(docUri);
      expect(loaded).to.deep.equal([]);
    });

    it('round-trip — save then load preserves data', async () => {
      const { backend, docUri } = await c.factory();
      const data = [sample('a'), sample('b')];
      await backend.save(docUri, data);
      const loaded = await backend.load(docUri);
      expect(loaded).to.deep.equal(data);
    });

    it('save replaces (does not append) — overwriting with a smaller list shrinks', async () => {
      const { backend, docUri } = await c.factory();
      await backend.save(docUri, [sample('a'), sample('b')]);
      await backend.save(docUri, [sample('a')]);
      const loaded = await backend.load(docUri);
      expect(loaded.map((c2) => c2.id)).to.deep.equal(['a']);
    });

    it('save with empty array yields empty load', async () => {
      const { backend, docUri } = await c.factory();
      await backend.save(docUri, [sample('a')]);
      await backend.save(docUri, []);
      const loaded = await backend.load(docUri);
      expect(loaded).to.deep.equal([]);
    });

    it('backendName matches expected token', async () => {
      const { backend } = await c.factory();
      expect(backend.backendName).to.equal(c.name);
    });

    it('save then load returns a fresh array reference', async () => {
      const { backend, docUri } = await c.factory();
      const input = [sample('a')];
      await backend.save(docUri, input);
      const loaded = await backend.load(docUri);
      expect(loaded).to.not.equal(input);
    });
  });
}
