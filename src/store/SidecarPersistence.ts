import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import {
  CommentsFileSchema,
  COMMENTS_FILE_VERSION,
  type Comment,
  type CommentsFile,
} from '../model/Comment';
import { type PersistenceBackend } from './PersistenceBackend';

export function computeSidecarPath(docUri: string): string {
  const p = docUri.startsWith('file://') ? fileURLToPath(docUri) : docUri;
  return `${p}.review.json`;
}

function isENOENT(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'ENOENT'
  );
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export class SidecarPersistence implements PersistenceBackend {
  readonly backendName = 'sidecar' as const;

  async load(docUri: string): Promise<Comment[]> {
    const path = computeSidecarPath(docUri);
    let raw: string;
    try {
      raw = await fs.readFile(path, 'utf-8');
    } catch (err: unknown) {
      if (isENOENT(err)) {
        return [];
      }
      throw err;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`사이드카 JSON parse 실패: ${path}`);
    }

    const result = CommentsFileSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `  - ${i.path.join('.') || '<root>'}: ${i.message}`)
        .join('\n');
      throw new Error(`사이드카 schema 검증 실패 (${path}):\n${issues}`);
    }
    return result.data.comments;
  }

  async save(
    docUri: string,
    comments: readonly Comment[],
  ): Promise<void> {
    const path = computeSidecarPath(docUri);
    const file: CommentsFile = {
      version: COMMENTS_FILE_VERSION,
      comments: [...comments],
    };
    const serialized = JSON.stringify(file, null, 2) + '\n';

    const tmp = `${path}.${randomSuffix()}.tmp`;
    await fs.writeFile(tmp, serialized, { encoding: 'utf-8' });
    try {
      await fs.rename(tmp, path);
    } catch (err) {
      await fs.unlink(tmp).catch(() => undefined);
      throw err;
    }
  }
}
