import { expect } from 'chai';
import {
  HostToWebViewMessageSchema,
  WebViewToHostMessageSchema,
} from '../../src/editor/messages';

describe('messages — Host→WebView schema', () => {
  it('parses valid renderUpdate', () => {
    const r = HostToWebViewMessageSchema.safeParse({
      type: 'renderUpdate',
      html: '<p>x</p>',
      source: '# x',
    });
    expect(r.success).to.equal(true);
  });

  it('parses valid commentsUpdate', () => {
    const r = HostToWebViewMessageSchema.safeParse({
      type: 'commentsUpdate',
      comments: [
        {
          id: 'c1',
          type: 'suggestion',
          anchor: { line: 0, col: 0, length: 1 },
          createdAt: '2026-05-15T10:00:00.000Z',
        },
      ],
    });
    expect(r.success).to.equal(true);
  });

  it('parses valid themeUpdate', () => {
    const r = HostToWebViewMessageSchema.safeParse({
      type: 'themeUpdate',
      theme: 'light',
    });
    expect(r.success).to.equal(true);
  });

  it('rejects themeUpdate with unknown theme', () => {
    const r = HostToWebViewMessageSchema.safeParse({
      type: 'themeUpdate',
      theme: 'sepia',
    });
    expect(r.success).to.equal(false);
  });

  it('rejects unknown host message type', () => {
    const r = HostToWebViewMessageSchema.safeParse({ type: 'noSuch' });
    expect(r.success).to.equal(false);
  });

  it('rejects renderUpdate missing html field', () => {
    const r = HostToWebViewMessageSchema.safeParse({ type: 'renderUpdate' });
    expect(r.success).to.equal(false);
  });
});

describe('messages — WebView→Host schema', () => {
  it('parses valid addComment', () => {
    const r = WebViewToHostMessageSchema.safeParse({
      type: 'addComment',
      kind: 'suggestion',
      anchor: { line: 0, col: 0, length: 4 },
      before: 'foo',
      after: 'bar',
    });
    expect(r.success).to.equal(true);
  });

  it('parses valid submit', () => {
    const r = WebViewToHostMessageSchema.safeParse({ type: 'submit' });
    expect(r.success).to.equal(true);
  });

  it('rejects addComment missing anchor', () => {
    const r = WebViewToHostMessageSchema.safeParse({
      type: 'addComment',
      kind: 'suggestion',
    });
    expect(r.success).to.equal(false);
  });

  it('parses valid setTheme', () => {
    const r = WebViewToHostMessageSchema.safeParse({
      type: 'setTheme',
      theme: 'dark',
    });
    expect(r.success).to.equal(true);
  });

  it('rejects unknown WebView message type', () => {
    const r = WebViewToHostMessageSchema.safeParse({ type: 'mystery' });
    expect(r.success).to.equal(false);
  });

  it('rejects empty id on removeComment', () => {
    const r = WebViewToHostMessageSchema.safeParse({
      type: 'removeComment',
      id: '',
    });
    expect(r.success).to.equal(false);
  });
});
