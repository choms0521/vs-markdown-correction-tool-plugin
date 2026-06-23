import { z } from 'zod';
import {
  CommentSchema,
  CommentAnchorSchema,
  CommentTypeSchema,
} from '../model/Comment';

export const PreviewThemeSchema = z.enum(['auto', 'light', 'dark']);
export type PreviewTheme = z.infer<typeof PreviewThemeSchema>;

// 작업 요청(채팅) 탭의 결과 카드에 표시할 경량 diff 조각.
// src/diff/types.ts의 Hunk를 webview 전송용으로 단순화한 형태다.
export const ChatHunkSchema = z.object({
  kind: z.enum(['insert', 'delete', 'replace']),
  startLine: z.number().int().nonnegative(),
  beforeText: z.string(),
  afterText: z.string(),
});
export type ChatHunk = z.infer<typeof ChatHunkSchema>;

// applied: 파일이 실제로 바뀜 / noChange: 정상 완료지만 변경 없음 /
// reverted: 직전 턴의 변경을 수정 전 상태로 되돌림 (문서는 바뀌었으나 추가
// 되돌리기 대상이 아님) / failed: 시간 초과 또는 오류. 빈 카드로 성공/실패가
// 구분되지 않는 문제를 막기 위해 상태를 명시적으로 구분한다.
export const ChatStatusSchema = z.enum(['applied', 'noChange', 'reverted', 'failed']);
export type ChatStatus = z.infer<typeof ChatStatusSchema>;

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
  z.object({
    type: z.literal('chatResult'),
    id: z.string().min(1),
    status: ChatStatusSchema,
    summary: z.string(),
    hunks: z.array(ChatHunkSchema),
    error: z.string().optional(),
  }),
  // 두 탭이 같은 문서를 수정하므로, 어느 한쪽 작업 중에는 양쪽 제출을
  // 모두 봉쇄한다. busy 동안 webview는 제출/보내기 버튼을 비활성화한다.
  z.object({
    type: z.literal('busyUpdate'),
    busy: z.boolean(),
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
  // 작업 요청(채팅) 탭: 자유 텍스트 지시 1개를 보낸다. id는 webview가
  // 낙관적 카드 표시용으로 생성하며, 결과 chatResult가 같은 id로 회신된다.
  z.object({
    type: z.literal('chatRequest'),
    id: z.string().min(1),
    text: z.string().min(1),
  }),
  // 특정 채팅 턴의 수정 전 상태로 되돌린다. snapshot은 호스트가 턴 id로
  // 보관하므로 webview는 id만 보낸다 (2KB payload 예산 회피).
  z.object({
    type: z.literal('chatRevert'),
    id: z.string().min(1),
  }),
]);
export type WebViewToHostMessage = z.infer<typeof WebViewToHostMessageSchema>;

export const MAX_WEBVIEW_TO_HOST_PAYLOAD_BYTES = 2048;
