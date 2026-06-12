export type CommentType = 'suggestion' | 'question';

export interface CommentMirror {
  id: string;
  type: CommentType;
  anchor: { line: number; endLine?: number; col: number; length: number };
  before?: string;
  after?: string;
  note?: string;
  createdAt: string;
  updatedAt?: string;
}
