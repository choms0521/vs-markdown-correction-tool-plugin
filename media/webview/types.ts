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

// 작업 요청(채팅) 탭 ----------------------------------------------------------

export type ChatStatus = 'applied' | 'noChange' | 'reverted' | 'failed';

export interface ChatHunk {
  kind: 'insert' | 'delete' | 'replace';
  startLine: number;
  beforeText: string;
  afterText: string;
}

export interface ChatResult {
  id: string;
  status: ChatStatus;
  summary: string;
  hunks: ChatHunk[];
  error?: string;
}

// webview가 화면에 표시하는 채팅 턴 상태 (낙관적 pending 포함).
export interface ChatTurnView {
  id: string;
  instruction: string;
  pending: boolean;
  status?: ChatStatus;
  summary?: string;
  hunks?: ChatHunk[];
  error?: string;
}
