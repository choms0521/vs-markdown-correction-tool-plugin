// Playwright 실브라우저 드래그 시험: 선택 구간 -> 소스 줄 환산 검증.
// 사용법: node test-webview/selection-drag.js
// 사전 조건: npm run compile (out/editor/markdownLineMap.js 필요)

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const MarkdownIt = require('markdown-it');
const { attachDataLineAttrs } = require('../out/editor/markdownLineMap');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const DOC = path.join(ROOT, 'docs/plans/p3/p3-manual-smoke.md');

function buildPage() {
  const source = fs.readFileSync(DOC, 'utf8');
  const md = new MarkdownIt({ html: false, linkify: true });
  attachDataLineAttrs(md);
  const html = md.render(source);

  const bundle = execSync(
    'npx esbuild media/webview/selection-capture.ts --bundle --format=iife --global-name=SelectionCapture',
    { cwd: ROOT, encoding: 'utf8' },
  );

  const page = `<!doctype html><html><head><meta charset="utf-8">
<style>body{font-family:sans-serif;font-size:15px;line-height:1.7;padding:24px;max-width:860px}</style>
</head><body><main id="doc-body">${html}</main>
<script>${bundle}</script></body></html>`;
  return { source, page };
}

let SOURCE_LINES = [];

async function dragAndCapture(pageObj, fromSel, toSel, toPosition) {
  // 이전 선택 해제
  await pageObj.evaluate(() => window.getSelection().removeAllRanges());

  const from = await pageObj.locator(fromSel).first().boundingBox();
  const to = await pageObj.locator(toSel).first().boundingBox();

  const startX = from.x + 2;
  const startY = from.y + from.height / 2;
  let endX;
  let endY;
  if (toPosition === 'text-end') {
    endX = to.x + to.width - 2;
    endY = to.y + to.height / 2;
  } else if (toPosition === 'past-line-end') {
    endX = to.x + to.width + 120;
    endY = to.y + to.height / 2;
  } else if (toPosition === 'below-line') {
    endX = to.x + to.width / 2;
    endY = to.y + to.height + 6;
  } else if (toPosition === 'mid-text') {
    endX = to.x + to.width / 2;
    endY = to.y + to.height / 2;
  } else {
    throw new Error('unknown toPosition: ' + toPosition);
  }

  await pageObj.mouse.move(startX, startY);
  await pageObj.mouse.down();
  await pageObj.mouse.move(endX, endY, { steps: 12 });
  await pageObj.mouse.up();

  return pageObj.evaluate((srcLines) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      return { error: 'no selection' };
    }
    const range = sel.getRangeAt(0);
    const describe = (node) =>
      node.nodeType === Node.TEXT_NODE
        ? `text("${String(node.textContent).slice(0, 30)}")`
        : `<${node.nodeName.toLowerCase()}>`;
    const lineRange = window.SelectionCapture.captureSourceRange(
      range,
      srcLines,
      sel.toString(),
    );
    return {
      rendered: sel.toString(),
      endContainer: describe(range.endContainer),
      endOffset: range.endOffset,
      lineRange,
    };
  }, SOURCE_LINES);
}

async function main() {
  const { source, page: html } = buildPage();
  const sourceLines = source.split('\n');
  SOURCE_LINES = sourceLines;

  // 검증 대상: "### 1." 섹션의 체크리스트 3줄
  const itemTexts = [
    '파일을 Explorer에서 우클릭',
    '목록에 "Markdown Review" 항목이 존재함',
    '항목 선택 시 WebView 패널이 열림',
  ];
  const expectStart = sourceLines.findIndex((l) => l.includes(itemTexts[0]));
  const expectEnd = sourceLines.findIndex((l) => l.includes(itemTexts[2])) + 1;
  const expected = sourceLines.slice(expectStart, expectEnd).join('\n');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
  await page.setContent(html);

  const firstLi = `li:has-text("${itemTexts[0]}")`;
  const lastLi = `li:has-text("${itemTexts[2]}")`;

  let failures = 0;
  const scenarios = [
    { to: lastLi, position: 'text-end', start: expectStart, end: expectEnd },
    { to: lastLi, position: 'past-line-end', start: expectStart, end: expectEnd },
    { to: lastLi, position: 'below-line', start: expectStart, end: expectEnd },
    // 다음 절 제목 중간까지 일부러 끌고 가면 제목 줄까지 포함되어야 한다
    {
      to: 'h3:has-text("2. 본문이 markdown-it")',
      position: 'mid-text',
      start: expectStart,
      end: sourceLines.findIndex((l) => l.includes('### 2. 본문이')) + 1,
    },
  ];
  for (const sc of scenarios) {
    const r = await dragAndCapture(page, firstLi, sc.to, sc.position);
    const label = `${sc.position} -> ${sc.to === lastLi ? 'item3' : 'heading'}`;
    if (r.error) {
      console.log(`[${label}] ERROR: ${r.error}`);
      failures += 1;
      continue;
    }
    const got = sourceLines
      .slice(r.lineRange.startLine, r.lineRange.endLine)
      .join('\n');
    const want = sourceLines.slice(sc.start, sc.end).join('\n');
    const pass = got === want;
    if (!pass) failures += 1;
    console.log(
      `[${label}] ${pass ? 'PASS' : 'FAIL'} ` +
        `lines=[${r.lineRange.startLine},${r.lineRange.endLine}) ` +
        `expected=[${sc.start},${sc.end}) ` +
        `endContainer=${r.endContainer} endOffset=${r.endOffset}`,
    );
    if (!pass) {
      console.log('  --- got slice ---');
      console.log(got.split('\n').map((l) => '  | ' + l).join('\n'));
    }
  }

  await browser.close();
  if (failures > 0) {
    console.log(`RESULT: ${failures} scenario(s) FAILED`);
    process.exit(1);
  }
  console.log('RESULT: all scenarios PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
