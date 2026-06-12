import type MarkdownIt from 'markdown-it';

// 블록 토큰에 소스 줄 범위(data-line / data-line-end)를 부착한다.
// webview의 선택 -> 소스 줄 환산(selection-capture.ts)이 이 속성에 의존하므로,
// Playwright 실브라우저 시험(test-webview/)에서도 동일 함수를 사용한다.
export function attachDataLineAttrs(md: MarkdownIt): void {
  const tokensWithLineMap = [
    'paragraph_open',
    'heading_open',
    'list_item_open',
    'blockquote_open',
    'code_block',
    'fence',
  ];

  for (const tokenName of tokensWithLineMap) {
    const original = md.renderer.rules[tokenName];
    md.renderer.rules[tokenName] = (tokens, idx, opts, env, self) => {
      const token = tokens[idx];
      if (token.map && token.map.length > 0) {
        token.attrSet('data-line', String(token.map[0]));
        token.attrSet('data-line-end', String(token.map[1]));
      }
      return original
        ? original(tokens, idx, opts, env, self)
        : self.renderToken(tokens, idx, opts);
    };
  }
}
