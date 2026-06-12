import { expect } from 'chai';
import { PromptBuilder } from '../../src/llm/PromptBuilder';
import type { Comment } from '../../src/model/Comment';

function sampleSuggestion(): Comment {
  return {
    id: 'c-s-1',
    type: 'suggestion',
    anchor: { line: 12, col: 4, length: 18 },
    before: 'electron-manager',
    after: 'local-cli-manager',
    note: '패키지 이름이 의도와 다름',
    createdAt: '2026-05-15T10:00:00.000Z',
  };
}

function sampleQuestion(): Comment {
  return {
    id: 'c-q-1',
    type: 'question',
    anchor: { line: 88, col: 0, length: 0 },
    note: '이 단락의 출처는?',
    createdAt: '2026-05-15T10:05:00.000Z',
  };
}

describe('PromptBuilder envelope', () => {
  it('produces exactly one BEGIN and END token', () => {
    const pb = new PromptBuilder();
    const r = pb.build('# title\nbody', [], 'fixed-uuid');
    const begin = (r.prompt.match(/<<<BEGIN-fixed-uuid>>>/g) ?? []).length;
    const end = (r.prompt.match(/<<<END-fixed-uuid>>>/g) ?? []).length;
    expect(begin).to.equal(1);
    expect(end).to.equal(1);
  });

  it('sentinel literal은 프롬프트에 연속 문자열로 등장하지 않는다 (TUI 재표시 가짜 완료 방지)', () => {
    const pb = new PromptBuilder();
    const r = pb.build('# title\nbody', [], 'fixed-uuid');
    expect(r.prompt).to.not.contain('<<<DONE-fixed-uuid>>>');
    // 단, LLM이 이어붙일 두 조각은 포함되어야 한다.
    expect(r.prompt).to.contain('<<<DONE-');
    expect(r.prompt).to.contain('fixed-uuid>>>');

    const d = pb.buildDirect('/tmp/doc.md', [], 'fixed-uuid');
    expect(d.prompt).to.not.contain('<<<DONE-fixed-uuid>>>');
    expect(d.prompt).to.contain('<<<DONE-');
    expect(d.prompt).to.contain('fixed-uuid>>>');
  });

  it('returns matching envelope/sentinel strings on the BuiltPrompt object', () => {
    const pb = new PromptBuilder();
    const r = pb.build('body', [], 'u-1');
    expect(r.envelopeBegin).to.equal('<<<BEGIN-u-1>>>');
    expect(r.envelopeEnd).to.equal('<<<END-u-1>>>');
    expect(r.sentinel).to.equal('<<<DONE-u-1>>>');
    expect(r.uuid).to.equal('u-1');
  });

  it('generates a different UUID on each call when none is supplied', () => {
    const pb = new PromptBuilder();
    const a = pb.build('x', []);
    const b = pb.build('x', []);
    expect(a.uuid).to.be.a('string').with.length.greaterThan(0);
    expect(a.uuid).to.not.equal(b.uuid);
  });

  it('embeds the document body and each non-empty comment line', () => {
    const pb = new PromptBuilder();
    const r = pb.build('the document body', [sampleSuggestion(), sampleQuestion()], 'u-2');
    expect(r.prompt).to.contain('the document body');
    expect(r.prompt).to.contain('(suggestion) line 12');
    expect(r.prompt).to.contain('electron-manager');
    expect(r.prompt).to.contain('local-cli-manager');
    expect(r.prompt).to.contain('(request) line 88');
    expect(r.prompt).to.contain('이 단락의 출처는?');
  });

  it('skips suggestion entries with both before/after empty', () => {
    const pb = new PromptBuilder();
    const empty: Comment = {
      id: 'e',
      type: 'suggestion',
      anchor: { line: 0, col: 0, length: 0 },
      createdAt: '2026-05-15T10:00:00.000Z',
    };
    const r = pb.build('body', [empty], 'u-3');
    expect(r.prompt).to.contain('(코멘트 없음)');
    expect(r.prompt).to.not.contain('(suggestion)');
  });

  it('skips question entries with empty note', () => {
    const pb = new PromptBuilder();
    const q: Comment = {
      id: 'q',
      type: 'question',
      anchor: { line: 0, col: 0, length: 0 },
      note: '   ',
      createdAt: '2026-05-15T10:00:00.000Z',
    };
    const r = pb.build('body', [q], 'u-4');
    expect(r.prompt).to.contain('(코멘트 없음)');
    expect(r.prompt).to.not.contain('(request)');
  });

  it('preserves comment input order across multiple entries', () => {
    const pb = new PromptBuilder();
    const c1 = sampleSuggestion();
    const c2 = { ...sampleSuggestion(), id: 'c-s-2', before: 'foo', after: 'bar' };
    const r = pb.build('body', [c1, c2], 'u-5');
    const i1 = r.prompt.indexOf('electron-manager');
    const i2 = r.prompt.indexOf('foo');
    expect(i1).to.be.lessThan(i2);
  });
});

describe('PromptBuilder.buildDirect', () => {
  it('대상 파일 경로를 포함하고 본문은 포함하지 않는다', () => {
    const b = new PromptBuilder();
    const built = b.buildDirect('/tmp/doc.md', []);
    expect(built.prompt).to.contain('/tmp/doc.md');
    expect(built.prompt).to.contain('직접 수정');
    expect(built.prompt).to.not.contain('--- 본문 ---');
  });

  it('envelope/sentinel 토큰을 정확히 1회씩 포함한다', () => {
    const b = new PromptBuilder();
    const built = b.buildDirect('/tmp/doc.md', []);
    expect(built.prompt.match(/<<<BEGIN-/g)).to.have.lengthOf(1);
    expect(built.prompt.match(/<<<END-/g)).to.have.lengthOf(1);
    expect(built.prompt.match(/<<<DONE-/g)).to.have.lengthOf(1);
  });
});
