import { expect } from 'chai';
import { MAX_WEBVIEW_TO_HOST_PAYLOAD_BYTES } from '../../src/editor/messages';

describe('payload-budget — WebView → Host messages stay under 2KB', () => {
  it('addComment with short before/after — under 2KB', () => {
    const payload = {
      type: 'addComment',
      kind: 'suggestion',
      anchor: { line: 12, col: 4, length: 18 },
      before: 'electron-manager',
      after: 'local-cli-manager',
      note: '패키지 이름이 의도와 다름',
    };
    const size = JSON.stringify(payload).length;
    expect(size).to.be.below(MAX_WEBVIEW_TO_HOST_PAYLOAD_BYTES);
  });

  it('addComment with realistic 200-char note — under 2KB', () => {
    const longNote = '리뷰 코멘트는 보통 한두 문장이지만 가끔 길어집니다. '.repeat(6);
    const payload = {
      type: 'addComment',
      kind: 'question',
      anchor: { line: 5, col: 0, length: 0 },
      note: longNote,
    };
    const size = JSON.stringify(payload).length;
    expect(size).to.be.below(MAX_WEBVIEW_TO_HOST_PAYLOAD_BYTES);
  });

  it('submit — well under budget (essentially zero overhead)', () => {
    const size = JSON.stringify({ type: 'submit' }).length;
    expect(size).to.be.below(64);
  });

  it('removeComment — well under budget', () => {
    const size = JSON.stringify({
      type: 'removeComment',
      id: '019015f5-7c18-7000-8000-000000000001',
    }).length;
    expect(size).to.be.below(128);
  });

  it('budget constant is the documented 2048 bytes', () => {
    expect(MAX_WEBVIEW_TO_HOST_PAYLOAD_BYTES).to.equal(2048);
  });
});
