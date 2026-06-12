// Playwright 전체 파이프라인 시험: 실제 webview 번들(dist/main.js)을 그대로
// 구동하여 드래그 -> 우클릭 -> 제안 추가 -> 폼 -> addComment 메시지까지 검증.
// 사용법: node test-webview/full-flow.js

const fs = require('fs');
const path = require('path');
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
  const bundle = fs.readFileSync(
    path.join(ROOT, 'media/webview/dist/main.js'),
    'utf8',
  );
  const style = fs.readFileSync(
    path.join(ROOT, 'media/webview/style.css'),
    'utf8',
  );

  // renderShell과 동일한 DOM 골격 + acquireVsCodeApi mock
  const page = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<style>${style}</style></head>
<body>
<div id="layout">
  <main id="doc-body"></main>
  <aside id="panel">
    <header><strong>코멘트</strong>
      <button id="theme-toggle" type="button">테마: 자동</button>
    </header>
    <ul id="comment-list"></ul>
    <button id="submit-btn" type="button">제출</button>
  </aside>
</div>
<div id="overlay-root"></div>
<script>
  window.__posted = [];
  function acquireVsCodeApi() {
    return { postMessage: (m) => window.__posted.push(m) };
  }
</script>
<script>${bundle}</script>
<script>
  window.postMessage(
    { type: 'renderUpdate', html: ${JSON.stringify(html)}, source: ${JSON.stringify(source)} },
    '*',
  );
</script>
</body></html>`;
  return { source, page };
}

async function dragSelect(page, fromSel, toSel, options = {}) {
  const from = await page.locator(fromSel).first().boundingBox();
  const to = await page.locator(toSel).first().boundingBox();
  let fromX = from.x + 2;
  let fromY = from.y + from.height / 2;
  let toX = to.x + to.width - 2;
  let toY = to.y + to.height / 2;
  if (options.backward) {
    [fromX, fromY, toX, toY] = [toX, toY, fromX, fromY];
  }
  if (options.fromAbove) {
    fromY = from.y - 8;
    fromX = from.x + from.width / 2;
  }
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(toX, toY, { steps: 10 });
  await page.mouse.up();
}

async function rightClickOnSelection(page, sel) {
  const box = await page.locator(sel).first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
    button: 'right',
  });
}

async function addSuggestion(page) {
  await page.locator('.overlay-buttons button', { hasText: '제안 추가' }).click();
  const prefill = await page.locator('.overlay-form textarea').inputValue();
  await page.locator('.overlay-form button.primary').click();
  const posted = await page.evaluate(() => window.__posted);
  const last = posted.filter((m) => m.type === 'addComment').at(-1);
  return { prefill, message: last };
}

function sliceOf(sourceLines, startText, endText) {
  const s = sourceLines.findIndex((l) => l.includes(startText));
  const e = sourceLines.findIndex((l) => l.includes(endText)) + 1;
  return { start: s, end: e, text: sourceLines.slice(s, e).join('\n') };
}

async function main() {
  const { source, page: html } = buildPage();
  const sourceLines = source.split('\n');

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1100, height: 1600 },
  });
  await page.setContent(html);
  await page.waitForSelector('#doc-body h3');

  const h2 = 'h3:has-text("2. 본문이 markdown-it")';
  const h2LastItem = 'li:has-text("한국어 본문이 깨지지 않고")';
  const h3 = 'h3:has-text("3. 본문 선택 시 인라인")';
  const h3LastItem = 'li:has-text("선택 해제(다른 곳 클릭)")';

  const section2 = sliceOf(sourceLines, '### 2. 본문이', '한국어 본문이 깨지지 않고');
  const section3 = sliceOf(sourceLines, '### 3. 본문 선택', '선택 해제(다른 곳 클릭)');

  let failures = 0;
  const check = (label, got, want) => {
    const pass = got === want;
    if (!pass) failures += 1;
    console.log(`[${label}] ${pass ? 'PASS' : 'FAIL'}`);
    if (!pass) {
      console.log('  --- want ---');
      console.log(want.split('\n').map((l) => '  | ' + l).join('\n'));
      console.log('  --- got ---');
      console.log(got.split('\n').map((l) => '  | ' + l).join('\n'));
    }
  };

  // S1: 2절(제목~마지막 항목) 드래그 -> 우클릭 -> 제안
  await dragSelect(page, h2, h2LastItem);
  await rightClickOnSelection(page, h2LastItem);
  const s1 = await addSuggestion(page);
  check('S1 prefill = 2절', s1.prefill, section2.text);
  check('S1 before = 2절', s1.message.before, section2.text);

  // S2: 2절 제목 ~ 3절 마지막 항목 (두 절에 걸친 선택)
  await dragSelect(page, h2, h3LastItem);
  await rightClickOnSelection(page, h3LastItem);
  const s2 = await addSuggestion(page);
  const both = sourceLines
    .slice(section2.start, section3.end)
    .join('\n');
  check('S2 prefill = 2~3절', s2.prefill, both);
  check('S2 before = 2~3절', s2.message.before, both);

  // S3: 3절 선택 후 우클릭 (메뉴 표시) -> 클릭 없이 다시 2절 선택 -> 우클릭 -> 제안
  // (이전 선택이 stale하게 남는지 검증)
  await dragSelect(page, h3, h3LastItem);
  await rightClickOnSelection(page, h3LastItem);
  await dragSelect(page, h2, h2LastItem);
  await rightClickOnSelection(page, h2LastItem);
  const s3 = await addSuggestion(page);
  check('S3 재선택 후 before = 2절', s3.message.before, section2.text);

  // S4: 거꾸로 드래그 (아래 -> 위)
  await dragSelect(page, h2, h2LastItem, { backward: true });
  await rightClickOnSelection(page, h2LastItem);
  const s4 = await addSuggestion(page);
  check('S4 거꾸로 드래그 before = 2절', s4.message.before, section2.text);

  // S5: 제목 위 빈 공간에서 시작하는 드래그 (시작 경계가 이전 블록에 걸림)
  await dragSelect(page, h2, h2LastItem, { fromAbove: true });
  await rightClickOnSelection(page, h2LastItem);
  const s5 = await addSuggestion(page);
  check('S5 빈 공간 시작 before = 2절', s5.message.before, section2.text);

  await browser.close();
  console.log(
    failures > 0
      ? `RESULT: ${failures} check(s) FAILED`
      : 'RESULT: all checks PASS',
  );
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
