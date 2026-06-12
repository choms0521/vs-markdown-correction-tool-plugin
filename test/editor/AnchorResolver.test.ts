import { expect } from 'chai';
import {
  AnchorResolver,
  type TextDocumentLike,
} from '../../src/editor/AnchorResolver';

function fakeDoc(lines: string[]): TextDocumentLike {
  return {
    lineCount: lines.length,
    lineAt(line: number) {
      return { text: lines[line] ?? '' };
    },
  };
}

describe('AnchorResolver', () => {
  it('basic — DOM selection maps to {line, col, length}', () => {
    const r = new AnchorResolver(fakeDoc(['hello world', 'second']));
    const a = r.resolveAnchorFromDom({
      startLine: 0,
      startColInLine: 6,
      length: 5,
    });
    expect(a).to.deep.equal({ line: 0, col: 6, length: 5 });
  });

  it('out-of-range line — clamps to last line', () => {
    const r = new AnchorResolver(fakeDoc(['a', 'b', 'c']));
    const a = r.resolveAnchorFromDom({
      startLine: 99,
      startColInLine: 0,
      length: 1,
    });
    expect(a.line).to.equal(2);
  });

  it('negative line — clamps to 0', () => {
    const r = new AnchorResolver(fakeDoc(['only']));
    const a = r.resolveAnchorFromDom({
      startLine: -5,
      startColInLine: 0,
      length: 1,
    });
    expect(a.line).to.equal(0);
  });

  it('col exceeds line length — clamps to line length', () => {
    const r = new AnchorResolver(fakeDoc(['short']));
    const a = r.resolveAnchorFromDom({
      startLine: 0,
      startColInLine: 100,
      length: 0,
    });
    expect(a.col).to.equal(5);
  });

  it('negative length — clamps to 0', () => {
    const r = new AnchorResolver(fakeDoc(['x']));
    const a = r.resolveAnchorFromDom({
      startLine: 0,
      startColInLine: 0,
      length: -7,
    });
    expect(a.length).to.equal(0);
  });

  it('non-integer DOM values — floored', () => {
    const r = new AnchorResolver(fakeDoc(['abcdef']));
    const a = r.resolveAnchorFromDom({
      startLine: 0.9,
      startColInLine: 2.7,
      length: 3.6,
    });
    expect(a).to.deep.equal({ line: 0, col: 2, length: 3 });
  });

  it('round-trip — anchor → DOM → anchor preserves data', () => {
    const r = new AnchorResolver(fakeDoc(['one', 'two longer line']));
    const anchor = { line: 1, col: 4, length: 6 };
    const dom = r.resolveDomFromAnchor(anchor);
    const back = r.resolveAnchorFromDom(dom);
    expect(back).to.deep.equal(anchor);
  });

  it('empty document — clampLine returns 0', () => {
    const r = new AnchorResolver({
      lineCount: 0,
      lineAt: () => ({ text: '' }),
    });
    const a = r.resolveAnchorFromDom({
      startLine: 5,
      startColInLine: 5,
      length: 0,
    });
    expect(a).to.deep.equal({ line: 0, col: 0, length: 0 });
  });
});
