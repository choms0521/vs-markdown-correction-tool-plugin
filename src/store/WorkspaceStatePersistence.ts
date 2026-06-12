import { z } from 'zod';
import { CommentSchema, type Comment } from '../model/Comment';
import {
  type PersistenceBackend,
  type PersistenceBackendName,
} from './PersistenceBackend';

export interface MementoLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void> | Promise<void>;
}

const StoredCommentsSchema = z.array(CommentSchema);

export function computeWorkspaceStateKey(docUri: string): string {
  return `mdReview.comments.${docUri}`;
}

export class WorkspaceStatePersistence implements PersistenceBackend {
  readonly backendName: PersistenceBackendName = 'workspaceState';

  constructor(private readonly memento: MementoLike) {}

  async load(docUri: string): Promise<Comment[]> {
    const key = computeWorkspaceStateKey(docUri);
    const raw = this.memento.get<unknown>(key);
    if (raw === undefined) {
      return [];
    }
    const result = StoredCommentsSchema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `  - ${i.path.join('.') || '<root>'}: ${i.message}`)
        .join('\n');
      throw new Error(
        `workspaceState 코멘트 schema 검증 실패 (key=${key}):\n${issues}`,
      );
    }
    return result.data;
  }

  async save(docUri: string, comments: readonly Comment[]): Promise<void> {
    const key = computeWorkspaceStateKey(docUri);
    await Promise.resolve(this.memento.update(key, [...comments]));
  }
}
