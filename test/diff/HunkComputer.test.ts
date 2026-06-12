import { expect } from 'chai';
import { HunkComputer, MAX_DP_CELLS } from '../../src/diff/HunkComputer';

describe('HunkComputer', () => {
  const hc = new HunkComputer();

  it('빈 입력은 빈 hunk 배열을 반환한다', () => {
    expect(hc.compute('', '')).to.deep.equal([]);
  });

  it('완전 일치 입력은 빈 hunk 배열을 반환한다', () => {
    const text = 'a\nb\nc';
    expect(hc.compute(text, text)).to.deep.equal([]);
  });

  it('완전 교체는 단일 replace hunk를 만든다', () => {
    const r = hc.compute('a\nb', 'x\ny');
    expect(r).to.have.lengthOf(1);
    expect(r[0].kind).to.equal('replace');
    expect(r[0].beforeText).to.equal('a\nb');
    expect(r[0].afterText).to.equal('x\ny');
    expect(r[0].beforeRange).to.deep.equal({
      startLine: 0,
      endLineExclusive: 2,
    });
  });

  it('단일 라인 추가는 insert hunk를 만든다', () => {
    const r = hc.compute('a\nc', 'a\nb\nc');
    expect(r).to.have.lengthOf(1);
    expect(r[0].kind).to.equal('insert');
    expect(r[0].beforeText).to.equal('');
    expect(r[0].afterText).to.equal('b');
    expect(r[0].beforeRange).to.deep.equal({
      startLine: 1,
      endLineExclusive: 1,
    });
  });

  it('단일 라인 삭제는 delete hunk를 만든다', () => {
    const r = hc.compute('a\nb\nc', 'a\nc');
    expect(r).to.have.lengthOf(1);
    expect(r[0].kind).to.equal('delete');
    expect(r[0].beforeText).to.equal('b');
    expect(r[0].afterText).to.equal('');
    expect(r[0].beforeRange).to.deep.equal({
      startLine: 1,
      endLineExclusive: 2,
    });
  });

  it('서로 떨어진 두 변경은 두 개의 hunk를 만든다', () => {
    const origLines = Array.from({ length: 30 }, (_, i) => `L${i}`);
    const revLines = [...origLines];
    revLines[5] = 'X5';
    revLines[20] = 'X20';
    const r = hc.compute(origLines.join('\n'), revLines.join('\n'));
    expect(r).to.have.lengthOf(2);
    expect(r[0].beforeRange.startLine).to.be.lessThan(
      r[1].beforeRange.startLine,
    );
    expect(r[0].beforeText).to.equal('L5');
    expect(r[0].afterText).to.equal('X5');
    expect(r[1].beforeText).to.equal('L20');
    expect(r[1].afterText).to.equal('X20');
  });

  it('CRLF 입력은 LF로 정규화된다', () => {
    const r = hc.compute('a\r\nb\r\nc', 'a\nb\nc');
    expect(r).to.deep.equal([]);
  });

  it('trailing newline 차이는 hunk를 만들지 않는다', () => {
    expect(hc.compute('a\n', 'a')).to.deep.equal([]);
    expect(hc.compute('a', 'a\n')).to.deep.equal([]);
  });

  it('인접한 add/del은 단일 replace hunk로 묶인다', () => {
    const r = hc.compute('a\nb\nc\nd', 'a\nx\ny\nd');
    expect(r).to.have.lengthOf(1);
    expect(r[0].kind).to.equal('replace');
    expect(r[0].beforeText).to.equal('b\nc');
    expect(r[0].afterText).to.equal('x\ny');
    expect(r[0].beforeRange).to.deep.equal({
      startLine: 1,
      endLineExclusive: 3,
    });
  });

  it('hunk id는 h0, h1 순으로 부여된다', () => {
    const r = hc.compute('a\nb\nc\nd\ne', 'a\nX\nc\nY\ne');
    expect(r).to.have.lengthOf(2);
    expect(r[0].id).to.equal('h0');
    expect(r[1].id).to.equal('h1');
  });

  it('원본이 비어 있고 응답이 있으면 단일 insert hunk', () => {
    const r = hc.compute('', 'first\nsecond');
    expect(r).to.have.lengthOf(1);
    expect(r[0].kind).to.equal('insert');
    expect(r[0].afterText).to.equal('first\nsecond');
    expect(r[0].beforeRange).to.deep.equal({
      startLine: 0,
      endLineExclusive: 0,
    });
  });

  it('인접한 라인 교체는 단일 hunk로 묶인다 (L5~L7 모두 변경)', () => {
    const orig = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8'].join('\n');
    const rev = ['L0', 'L1', 'L2', 'L3', 'L4', 'X5', 'X6', 'X7', 'L8'].join('\n');
    const r = hc.compute(orig, rev);
    expect(r).to.have.lengthOf(1);
    expect(r[0].kind).to.equal('replace');
    expect(r[0].beforeRange).to.deep.equal({
      startLine: 5,
      endLineExclusive: 8,
    });
    expect(r[0].beforeText).to.equal('L5\nL6\nL7');
    expect(r[0].afterText).to.equal('X5\nX6\nX7');
  });

  it('마지막 라인(EOF) 추가는 단일 insert hunk + endLineExclusive == origLineCount', () => {
    const r = hc.compute('a\nb\nc', 'a\nb\nc\nd');
    expect(r).to.have.lengthOf(1);
    expect(r[0].kind).to.equal('insert');
    expect(r[0].afterText).to.equal('d');
    expect(r[0].beforeRange).to.deep.equal({
      startLine: 3,
      endLineExclusive: 3,
    });
  });

  it('마지막 라인(EOF) 삭제는 단일 delete hunk', () => {
    const r = hc.compute('a\nb\nc', 'a\nb');
    expect(r).to.have.lengthOf(1);
    expect(r[0].kind).to.equal('delete');
    expect(r[0].beforeText).to.equal('c');
    expect(r[0].beforeRange).to.deep.equal({
      startLine: 2,
      endLineExclusive: 3,
    });
  });

  it('원본 CRLF + 응답 LF 혼합도 EOL 정규화 후 hunk 만들지 않음', () => {
    const r = hc.compute('a\r\nb\r\nc', 'a\nb\nc');
    expect(r).to.deep.equal([]);
  });

  it('원본 CRLF + 응답이 한 라인 변경(LF)도 정확히 단일 hunk', () => {
    const r = hc.compute('a\r\nb\r\nc', 'a\nX\nc');
    expect(r).to.have.lengthOf(1);
    expect(r[0].beforeText).to.equal('b');
    expect(r[0].afterText).to.equal('X');
  });

  it('입력 라인 곱이 MAX_DP_CELLS를 초과하면 throw', () => {
    const lineCount = Math.ceil(Math.sqrt(MAX_DP_CELLS)) + 10;
    const big = new Array(lineCount).fill('x').join('\n');
    let threw: Error | null = null;
    try {
      hc.compute(big, big);
    } catch (e) {
      threw = e as Error;
    }
    expect(threw).to.be.instanceOf(Error);
    expect(threw?.message).to.match(/hunk computation too large/);
  });
});
