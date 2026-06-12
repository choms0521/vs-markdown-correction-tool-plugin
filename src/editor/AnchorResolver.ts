import { type CommentAnchor } from '../model/Comment';

export interface DomSelectionInfo {
  startLine: number;
  startColInLine: number;
  length: number;
}

export interface TextDocumentLike {
  readonly lineCount: number;
  lineAt(line: number): { text: string };
}

export class AnchorResolver {
  constructor(private readonly document: TextDocumentLike) {}

  resolveAnchorFromDom(dom: DomSelectionInfo): CommentAnchor {
    const line = this.clampLine(dom.startLine);
    const lineText = this.document.lineAt(line).text;
    const col = Math.min(
      Math.max(Math.floor(dom.startColInLine), 0),
      lineText.length,
    );
    const length = Math.max(0, Math.floor(dom.length));
    return { line, col, length };
  }

  resolveDomFromAnchor(anchor: CommentAnchor): DomSelectionInfo {
    const line = this.clampLine(anchor.line);
    return {
      startLine: line,
      startColInLine: Math.max(0, Math.floor(anchor.col)),
      length: Math.max(0, Math.floor(anchor.length)),
    };
  }

  private clampLine(line: number): number {
    const max = Math.max(0, this.document.lineCount - 1);
    return Math.min(Math.max(Math.floor(line), 0), max);
  }
}
