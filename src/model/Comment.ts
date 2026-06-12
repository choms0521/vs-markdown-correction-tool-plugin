import { z } from 'zod';

export const CommentTypeSchema = z.enum(['suggestion', 'question']);
export type CommentType = z.infer<typeof CommentTypeSchema>;

export const CommentAnchorSchema = z.object({
  line: z.number().int().nonnegative(),
  // 선택이 끝나는 소스 줄 (exclusive). 구버전 sidecar 호환을 위해 optional.
  endLine: z.number().int().nonnegative().optional(),
  col: z.number().int().nonnegative(),
  length: z.number().int().nonnegative(),
});
export type CommentAnchor = z.infer<typeof CommentAnchorSchema>;

export const CommentSchema = z.object({
  id: z.string().min(1),
  type: CommentTypeSchema,
  anchor: CommentAnchorSchema,
  before: z.string().optional(),
  after: z.string().optional(),
  note: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
});
export type Comment = z.infer<typeof CommentSchema>;

export const COMMENTS_FILE_VERSION = 1 as const;

export const CommentsFileSchema = z.object({
  version: z.literal(COMMENTS_FILE_VERSION),
  comments: z.array(CommentSchema),
});
export type CommentsFile = z.infer<typeof CommentsFileSchema>;

export type CommentDraft = Omit<Comment, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string;
};

export type CommentPatch = Partial<
  Omit<Comment, 'id' | 'createdAt' | 'updatedAt'>
>;
