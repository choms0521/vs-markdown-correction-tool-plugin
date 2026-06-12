import { expect } from 'chai';
import { AnsiSanitizer } from '../../src/pty/AnsiSanitizer';

describe('AnsiSanitizer', () => {
  it('strips ANSI color escape sequences', () => {
    const s = new AnsiSanitizer();
    const input = '[31mred text[0m';
    expect(s.sanitize(input)).to.equal('red text');
  });

  it('strips cursor positioning escape sequences', () => {
    const s = new AnsiSanitizer();
    expect(s.sanitize('[2J[Hcontent')).to.equal('content');
  });

  it('passes through plain text unchanged', () => {
    const s = new AnsiSanitizer();
    expect(s.sanitize('hello world')).to.equal('hello world');
  });
});
