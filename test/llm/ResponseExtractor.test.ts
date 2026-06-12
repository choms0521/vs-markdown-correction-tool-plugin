import { expect } from 'chai';
import { ResponseExtractor } from '../../src/llm/ResponseExtractor';

describe('ResponseExtractor', () => {
  it('extracts content from a fenced markdown block', () => {
    const e = new ResponseExtractor();
    expect(e.extract('```markdown\nhello\n```')).to.equal('hello');
  });

  it('extracts from a fenced md block (md alias)', () => {
    const e = new ResponseExtractor();
    expect(e.extract('```md\nx\n```')).to.equal('x');
  });

  it('extracts from a bare fenced block (no language tag)', () => {
    const e = new ResponseExtractor();
    expect(e.extract('```\nplain\n```')).to.equal('plain');
  });

  it('uses only the first fenced block when multiple are present', () => {
    const e = new ResponseExtractor();
    const raw = '```markdown\nfirst\n```\n\n```markdown\nsecond\n```';
    expect(e.extract(raw)).to.equal('first');
  });

  it('falls back to trimmed raw input when no fence is present', () => {
    const e = new ResponseExtractor();
    expect(e.extract('   raw content  \n')).to.equal('raw content');
  });

  it('returns empty string when input is whitespace', () => {
    const e = new ResponseExtractor();
    expect(e.extract('   \n  ')).to.equal('');
  });
});
