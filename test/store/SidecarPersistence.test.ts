import { expect } from 'chai';
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import {
  SidecarPersistence,
  computeSidecarPath,
} from '../../src/store/SidecarPersistence';
import type { Comment } from '../../src/model/Comment';

function sampleComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c-001',
    type: 'suggestion',
    anchor: { line: 10, col: 4, length: 8 },
    before: 'electron-manager',
    after: 'local-cli-manager',
    note: '패키지 이름이 의도와 다름',
    createdAt: '2026-05-15T10:00:00.000Z',
    ...overrides,
  };
}

async function makeTempDocPath(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'mdreview-sidecar-'));
  return join(dir, 'doc.md');
}

describe('SidecarPersistence', () => {
  describe('computeSidecarPath', () => {
    it('appends .review.json to plain absolute path', () => {
      expect(computeSidecarPath('/abs/path/doc.md')).to.equal(
        '/abs/path/doc.md.review.json',
      );
    });

    it('converts file:// URI to absolute path before suffixing', () => {
      // Build the file URL from a real OS-absolute path so the test is
      // cross-platform (Windows file URLs require a drive letter; a bare
      // unix path like file:///abs/path is rejected by Windows node).
      const abs =
        process.platform === 'win32'
          ? 'C:\\abs\\path\\doc.md'
          : '/abs/path/doc.md';
      const uri = pathToFileURL(abs).toString();
      expect(computeSidecarPath(uri)).to.equal(`${abs}.review.json`);
    });
  });

  describe('round-trip', () => {
    it('SidecarPersistence round-trip preserves comments via deep-equal', async () => {
      const docPath = await makeTempDocPath();
      const store = new SidecarPersistence();
      const questionComment: Comment = {
        id: 'c-002',
        type: 'question',
        anchor: { line: 88, col: 0, length: 0 },
        note: '출처 확인',
        createdAt: '2026-05-15T10:05:30.000Z',
      };
      const original: Comment[] = [sampleComment({ id: 'c-001' }), questionComment];

      await store.save(docPath, original);
      const loaded = await store.load(docPath);

      expect(loaded).to.deep.equal(original);
    });

    it('save then load yields a fresh array reference (no shared mutation)', async () => {
      const docPath = await makeTempDocPath();
      const store = new SidecarPersistence();
      const original = [sampleComment()];

      await store.save(docPath, original);
      const loaded = await store.load(docPath);

      expect(loaded).to.not.equal(original);
      expect(loaded[0]).to.not.equal(original[0]);
    });
  });

  describe('missing file', () => {
    it('SidecarPersistence missing file returns empty array', async () => {
      const dir = await fs.mkdtemp(join(tmpdir(), 'mdreview-sidecar-missing-'));
      const docPath = join(dir, 'never-existed.md');
      const store = new SidecarPersistence();

      const loaded = await store.load(docPath);
      expect(loaded).to.deep.equal([]);
    });
  });

  describe('schema validation', () => {
    it('SidecarPersistence schema failure throws Korean error', async () => {
      const docPath = await makeTempDocPath();
      const sidecarPath = computeSidecarPath(docPath);
      await fs.writeFile(sidecarPath, JSON.stringify({ version: 99 }));

      const store = new SidecarPersistence();
      let threw: Error | null = null;
      try {
        await store.load(docPath);
      } catch (e) {
        threw = e as Error;
      }

      expect(threw).to.be.instanceOf(Error);
      expect(threw?.message).to.match(/사이드카 schema 검증 실패/);
    });

    it('SidecarPersistence malformed JSON throws Korean error', async () => {
      const docPath = await makeTempDocPath();
      const sidecarPath = computeSidecarPath(docPath);
      await fs.writeFile(sidecarPath, '{ not valid json');

      const store = new SidecarPersistence();
      let threw: Error | null = null;
      try {
        await store.load(docPath);
      } catch (e) {
        threw = e as Error;
      }

      expect(threw).to.be.instanceOf(Error);
      expect(threw?.message).to.match(/사이드카 JSON parse 실패/);
    });
  });

  describe('atomic write', () => {
    it('SidecarPersistence atomic write — rename failure leaves original unchanged', async () => {
      const docPath = await makeTempDocPath();
      const sidecarPath = computeSidecarPath(docPath);
      const store = new SidecarPersistence();

      const initial = [sampleComment({ id: 'initial' })];
      await store.save(docPath, initial);
      const beforeBytes = fsSync.readFileSync(sidecarPath, 'utf-8');

      const original = fs.rename;
      const renameStub = async (
        ..._args: Parameters<typeof fs.rename>
      ): Promise<void> => {
        throw new Error('simulated rename failure');
      };
      (fs as { rename: typeof fs.rename }).rename =
        renameStub as typeof fs.rename;

      let threw: Error | null = null;
      try {
        await store.save(docPath, [sampleComment({ id: 'attempted-overwrite' })]);
      } catch (e) {
        threw = e as Error;
      } finally {
        (fs as { rename: typeof fs.rename }).rename = original;
      }

      expect(threw, 'expected rename stub to throw').to.be.instanceOf(Error);
      const afterBytes = fsSync.readFileSync(sidecarPath, 'utf-8');
      expect(afterBytes).to.equal(beforeBytes);
    });
  });
});
