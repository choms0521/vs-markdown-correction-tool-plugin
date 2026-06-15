import { randomUUID } from 'crypto';
import { type Comment } from '../model/Comment';

export interface BuiltPrompt {
  prompt: string;
  envelopeBegin: string;
  envelopeEnd: string;
  sentinel: string;
  uuid: string;
}

// 완료 신호(sentinel)의 연속된 literal을 프롬프트에 넣으면 안 된다:
// interactive TUI는 제출된 사용자 메시지를 대화창에 다시 표시하므로,
// 프롬프트 속 literal이 응답 영역에 그대로 출현하여 detector가 즉시
// 가짜 완료로 오인한다. 두 조각으로 쪼개 LLM이 이어붙이게 한다.
function sentinelInstruction(sentinel: string): string {
  const head = sentinel.slice(0, 8);
  const tail = sentinel.slice(8);
  return (
    `완료 신호를 한 줄로 출력하십시오. ` +
    `완료 신호는 "${head}" 와 "${tail}" 두 조각을 공백 없이 이어붙인 문자열입니다.`
  );
}

// 0-based 줄 범위 표기. endLine은 exclusive로 저장되어 있어 inclusive로 변환.
function formatAnchorRange(c: Comment): string {
  const start = c.anchor.line;
  const endExclusive = c.anchor.endLine ?? c.anchor.line + 1;
  const endInclusive = endExclusive - 1;
  return endInclusive > start
    ? `lines ${start}-${endInclusive}`
    : `line ${start}`;
}

export class PromptBuilder {
  build(
    documentText: string,
    comments: readonly Comment[],
    uuid?: string,
  ): BuiltPrompt {
    const id = uuid ?? randomUUID();
    const envelopeBegin = `<<<BEGIN-${id}>>>`;
    const envelopeEnd = `<<<END-${id}>>>`;
    const sentinel = `<<<DONE-${id}>>>`;
    const joined = this.joinComments(comments);

    const prompt = [
      envelopeBegin,
      '다음 마크다운 본문을 코멘트에 따라 수정해 주십시오.',
      '응답은 ```markdown 으로 감싼 fenced block 하나로만 보내십시오.',
      `응답 마지막에 ${sentinelInstruction(sentinel)}`,
      '',
      '--- 본문 ---',
      documentText,
      '',
      '--- 코멘트 ---',
      joined.length > 0 ? joined : '(코멘트 없음)',
      envelopeEnd,
    ].join('\n');

    return { prompt, envelopeBegin, envelopeEnd, sentinel, uuid: id };
  }

  // direct 모드: 본문을 채팅으로 받지 않고 agentic CLI가 대상 파일을 도구로
  // 직접 수정하게 한다. TUI 화면 출력은 글자 유실이 있어 데이터 수신 경로로
  // 부적합하므로, 채팅 출력은 완료 신호(sentinel)로만 사용한다.
  buildDirect(
    filePath: string,
    comments: readonly Comment[],
    uuid?: string,
  ): BuiltPrompt {
    const id = uuid ?? randomUUID();
    const envelopeBegin = `<<<BEGIN-${id}>>>`;
    const envelopeEnd = `<<<END-${id}>>>`;
    const sentinel = `<<<DONE-${id}>>>`;
    const joined = this.joinComments(comments);

    const prompt = [
      envelopeBegin,
      '다음 마크다운 파일을 아래 리뷰 코멘트에 따라 도구로 직접 수정해 주십시오.',
      `대상 파일: ${filePath}`,
      '',
      '규칙:',
      '- (request) 항목: 해당 구간을 요청 내용대로 수정하십시오.',
      '- (suggestion) 항목: 원본 구간을 제시된 수정안으로 교체하십시오.',
      '- 파일에서 코멘트와 관련된 부분만 수정하고, 그 외 내용은 보존하십시오.',
      '- 대상 파일 외 다른 파일은 만들거나 수정하지 마십시오.',
      '- 수정한 본문을 채팅 응답으로 출력하지 마십시오.',
      '- 코멘트의 줄 번호(line)는 0부터 시작합니다.',
      `- 모든 수정이 끝나면 마지막에 ${sentinelInstruction(sentinel)}`,
      '',
      '--- 코멘트 ---',
      joined.length > 0 ? joined : '(코멘트 없음)',
      envelopeEnd,
    ].join('\n');

    return { prompt, envelopeBegin, envelopeEnd, sentinel, uuid: id };
  }

  // 작업 요청(채팅) 탭: 코멘트 묶음 대신 자유 텍스트 지시 1개로 파일을
  // 직접 수정하게 한다. 현재 코멘트 목록도 참조용으로 동봉하여 "1번
  // 적용해줘" 같은 번호 참조 지시가 동작하도록 한다.
  buildDirectInstruction(
    filePath: string,
    instruction: string,
    comments: readonly Comment[] = [],
    uuid?: string,
  ): BuiltPrompt {
    const id = uuid ?? randomUUID();
    const envelopeBegin = `<<<BEGIN-${id}>>>`;
    const envelopeEnd = `<<<END-${id}>>>`;
    const sentinel = `<<<DONE-${id}>>>`;
    const joined = this.joinComments(comments);

    const lines = [
      envelopeBegin,
      '다음 지시에 따라 아래 마크다운 파일을 도구로 직접 수정해 주십시오.',
      `대상 파일: ${filePath}`,
      '',
      '--- 지시 ---',
      instruction,
      '',
    ];
    if (joined.length > 0) {
      lines.push(
        '--- 참고: 현재 리뷰 코멘트 (지시에서 번호로 참조될 수 있음) ---',
        joined,
        '',
      );
    }
    lines.push(
      '규칙:',
      '- 지시와 관련된 부분만 수정하고, 그 외 내용은 보존하십시오.',
      '- 대상 파일 외 다른 파일은 만들거나 수정하지 마십시오.',
      '- 수정한 본문을 채팅 응답으로 출력하지 마십시오.',
      '- 코멘트의 줄 번호(line)는 0부터 시작합니다.',
      `- 모든 수정이 끝나면 마지막에 ${sentinelInstruction(sentinel)}`,
      envelopeEnd,
    );

    return {
      prompt: lines.join('\n'),
      envelopeBegin,
      envelopeEnd,
      sentinel,
      uuid: id,
    };
  }

  private joinComments(comments: readonly Comment[]): string {
    const lines: string[] = [];
    let index = 1;
    for (const c of comments) {
      const range = formatAnchorRange(c);
      if (c.type === 'suggestion') {
        const before = c.before ?? '';
        const after = c.after ?? '';
        if (before.length === 0 && after.length === 0) {
          continue;
        }
        const trailing = c.note ? ` : ${c.note}` : '';
        lines.push(
          `[${index}] (suggestion) ${range}: "${before}" -> "${after}"${trailing}`,
        );
      } else {
        const note = (c.note ?? '').trim();
        if (note.length === 0) {
          continue;
        }
        lines.push(`[${index}] (request) ${range}: ${note}`);
        // 줄 번호만으로는 LLM이 구간을 잘못 짚을 수 있으므로
        // 선택된 원문을 함께 인용한다.
        const target = (c.before ?? '').trim();
        if (target.length > 0) {
          lines.push('    대상 구간:');
          for (const t of target.split('\n')) {
            lines.push(`    | ${t}`);
          }
        }
      }
      index += 1;
    }
    return lines.join('\n');
  }
}
