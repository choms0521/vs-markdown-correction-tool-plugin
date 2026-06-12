import { z } from 'zod';
import {
  CommentSchema,
  CommentAnchorSchema,
  CommentTypeSchema,
} from '../model/Comment';

export const PreviewThemeSchema = z.enum(['auto', 'light', 'dark']);
export type PreviewTheme = z.infer<typeof PreviewThemeSchema>;

export const HostToWebViewMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('renderUpdate'),
    html: z.string(),
    // 렌더된 화면 텍스트가 아닌 원본 마크다운. webview가 선택 구간을
    // 소스 줄 단위로 정확히 추출하는 데 사용한다.
    source: z.string(),
  }),
  z.object({
    type: z.literal('themeUpdate'),
    theme: PreviewThemeSchema,
  }),
  z.object({
    type: z.literal('commentsUpdate'),
    comments: z.array(CommentSchema),
  }),
  z.object({
    type: z.literal('submitAck'),
    placeholder: z.boolean(),
  }),
]);
export type HostToWebViewMessage = z.infer<typeof HostToWebViewMessageSchema>;

export const WebViewToHostMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ready'),
  }),
  z.object({
    type: z.literal('setTheme'),
    theme: PreviewThemeSchema,
  }),
  z.object({
    type: z.literal('addComment'),
    kind: CommentTypeSchema,
    anchor: CommentAnchorSchema,
    note: z.string().optional(),
    before: z.string().optional(),
    after: z.string().optional(),
  }),
  z.object({
    type: z.literal('removeComment'),
    id: z.string().min(1),
  }),
  z.object({
    type: z.literal('updateComment'),
    id: z.string().min(1),
    patch: z.object({
      note: z.string().optional(),
      before: z.string().optional(),
      after: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('submit'),
  }),
]);
export type WebViewToHostMessage = z.infer<typeof WebViewToHostMessageSchema>;

export const MAX_WEBVIEW_TO_HOST_PAYLOAD_BYTES = 2048;
