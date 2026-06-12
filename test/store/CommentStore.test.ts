import { expect } from 'chai';
import { CommentStore } from '../../src/store/CommentStore';
import type {
  Comment,
  CommentDraft,
} from '../../src/model/Comment';
import type { PersistenceBackend } from '../../src/store/PersistenceBackend';

function makeStubBackend(): PersistenceBackend {
  return {
    backendName: 'sidecar' as const,
    async load() {
      return [];
    },
    async save() {
      /* noop */
    },
  };
}

function sample(id = 'c-001'): Comment {
  return {
    id,
    type: 'suggestion',
    anchor: { line: 1, col: 0, length: 5 },
    before: 'foo',
    after: 'bar',
    createdAt: '2026-05-15T10:00:00.000Z',
  };
}

function draft(): CommentDraft {
  return {
    type: 'suggestion',
    anchor: { line: 2, col: 0, length: 4 },
    before: 'baz',
    after: 'qux',
  };
}

describe('CommentStore', () => {
  describe('add', () => {
    it('CommentStore add immutable — original array reference and length preserved', () => {
      const store = new CommentStore(makeStubBackend());
      const before = [sample('c-001')];
      const after = store.add(before, { ...draft(), id: 'c-002' });

      expect(before).to.not.equal(after);
      expect(before).to.have.lengthOf(1);
      expect(after).to.have.lengthOf(2);
      expect(after[1].id).to.equal('c-002');
      expect(after[1].createdAt).to.be.a('string');
    });

    it('CommentStore add — generates UUID when id omitted', () => {
      const store = new CommentStore(makeStubBackend());
      const result = store.add([], draft());
      expect(result[0].id).to.match(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it('CommentStore add — id collision throws Korean error', () => {
      const store = new CommentStore(makeStubBackend());
      const before = [sample('c-dup')];
      expect(() => store.add(before, { ...draft(), id: 'c-dup' })).to.throw(
        /코멘트 id 충돌/,
      );
    });
  });

  describe('update', () => {
    it('CommentStore update preserves id and createdAt, adds updatedAt', () => {
      const store = new CommentStore(makeStubBackend());
      const original = sample();
      const result = store.update([original], original.id, { note: 'new note' });

      expect(result[0].id).to.equal(original.id);
      expect(result[0].createdAt).to.equal(original.createdAt);
      expect(result[0].updatedAt).to.be.a('string');
      expect(result[0].note).to.equal('new note');
    });

    it('CommentStore update — patch cannot override id even if supplied', () => {
      const store = new CommentStore(makeStubBackend());
      const original = sample();
      const result = store.update([original], original.id, {
        ...({ id: 'malicious-override' } as unknown as Partial<Comment>),
        note: 'changed',
      });
      expect(result[0].id).to.equal(original.id);
      expect(result[0].note).to.equal('changed');
    });

    it('CommentStore update — missing id throws Korean error', () => {
      const store = new CommentStore(makeStubBackend());
      expect(() => store.update([sample()], 'nope', { note: 'x' })).to.throw(
        /코멘트를 찾을 수 없음/,
      );
    });
  });

  describe('remove', () => {
    it('CommentStore remove pure — original unchanged, filtered array returned', () => {
      const store = new CommentStore(makeStubBackend());
      const a = sample('a');
      const b = sample('b');
      const before = [a, b];
      const after = store.remove(before, 'a');

      expect(before).to.have.lengthOf(2);
      expect(after).to.deep.equal([b]);
      expect(after).to.not.equal(before);
    });

    it('CommentStore remove missing — throws Korean error (non-idempotent by design)', () => {
      const store = new CommentStore(makeStubBackend());
      expect(() => store.remove([sample()], 'nope')).to.throw(
        /삭제할 코멘트를 찾을 수 없음/,
      );
    });
  });

  describe('list', () => {
    it('CommentStore list — returns fresh array (caller cannot mutate via reference)', () => {
      const store = new CommentStore(makeStubBackend());
      const source = [sample()];
      const result = store.list(source);
      expect(result).to.deep.equal(source);
      expect(result).to.not.equal(source);
    });
  });

  describe('backend delegation', () => {
    it('CommentStore — load delegates to backend', async () => {
      const data = [sample()];
      const backend: PersistenceBackend = {
        backendName: 'sidecar',
        async load() {
          return data;
        },
        async save() {
          /* noop */
        },
      };
      const store = new CommentStore(backend);
      const loaded = await store.load('file:///x.md');
      expect(loaded).to.equal(data);
    });

    it('CommentStore — save delegates to backend with same arguments', async () => {
      let captured: { uri?: string; comments?: readonly Comment[] } = {};
      const backend: PersistenceBackend = {
        backendName: 'sidecar',
        async load() {
          return [];
        },
        async save(uri, comments) {
          captured = { uri, comments };
        },
      };
      const store = new CommentStore(backend);
      const arr = [sample()];
      await store.save('file:///x.md', arr);
      expect(captured.uri).to.equal('file:///x.md');
      expect(captured.comments).to.equal(arr);
    });
  });
});
