import { randomUUID } from 'crypto';
import {
  type Comment,
  type CommentDraft,
  type CommentPatch,
} from '../model/Comment';
import { type PersistenceBackend } from './PersistenceBackend';

export class CommentStore {
  constructor(private readonly backend: PersistenceBackend) {}

  async load(docUri: string): Promise<Comment[]> {
    return this.backend.load(docUri);
  }

  async save(docUri: string, comments: readonly Comment[]): Promise<void> {
    return this.backend.save(docUri, comments);
  }

  add(comments: readonly Comment[], draft: CommentDraft): Comment[] {
    const id = draft.id ?? randomUUID();
    if (comments.some((c) => c.id === id)) {
      throw new Error(`코멘트 id 충돌: ${id}`);
    }
    const created: Comment = {
      type: draft.type,
      anchor: draft.anchor,
      before: draft.before,
      after: draft.after,
      note: draft.note,
      id,
      createdAt: new Date().toISOString(),
    };
    return [...comments, created];
  }

  update(
    comments: readonly Comment[],
    id: string,
    patch: CommentPatch,
  ): Comment[] {
    const idx = comments.findIndex((c) => c.id === id);
    if (idx === -1) {
      throw new Error(`코멘트를 찾을 수 없음: id=${id}`);
    }
    const existing = comments[idx];
    const merged: Comment = {
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    return [...comments.slice(0, idx), merged, ...comments.slice(idx + 1)];
  }

  remove(comments: readonly Comment[], id: string): Comment[] {
    const next = comments.filter((c) => c.id !== id);
    if (next.length === comments.length) {
      throw new Error(`삭제할 코멘트를 찾을 수 없음: id=${id}`);
    }
    return next;
  }

  list(comments: readonly Comment[]): readonly Comment[] {
    return [...comments];
  }
}
