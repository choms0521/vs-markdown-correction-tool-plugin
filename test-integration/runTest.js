const path = require('path');
const fs = require('fs');
const os = require('os');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '..');
  const extensionTestsPath = path.resolve(__dirname, 'suite.js');

  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdreview-it-'));
  fs.writeFileSync(
    path.join(workspaceDir, 'sample.md'),
    '# Title\n\nHello world.\n\n- item a\n- item b\n',
  );

  try {
    await runTests({
      version: '1.120.0',
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [workspaceDir, '--disable-extensions'],
    });
    console.log('[IT] PASS');
  } catch (e) {
    console.error('[IT] FAIL:', e);
    process.exit(1);
  }
}

main();
