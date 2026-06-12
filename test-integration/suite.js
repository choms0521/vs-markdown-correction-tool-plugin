const vscode = require('vscode');
const assert = require('assert');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true, label }), ms);
  });
  return Promise.race([
    Promise.resolve(promise).then(
      (value) => ({ timedOut: false, value }),
      (error) => ({ timedOut: false, error: String(error) }),
    ),
    timeout,
  ]).finally(() => clearTimeout(timer));
}

function describeActiveTab() {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (!tab) {
    return { label: null, kind: 'none' };
  }
  const input = tab.input;
  if (input instanceof vscode.TabInputCustom) {
    return { label: tab.label, kind: 'custom', viewType: input.viewType };
  }
  if (input instanceof vscode.TabInputText) {
    return { label: tab.label, kind: 'text' };
  }
  return {
    label: tab.label,
    kind: 'other',
    ctor: input && input.constructor && input.constructor.name,
  };
}

exports.run = async function run() {
  const log = (...args) => console.log('[IT]', ...args);

  vscode.window.tabGroups.onDidChangeTabs((e) => {
    const fmt = (t) =>
      `${t.label}:${t.input && t.input.constructor ? t.input.constructor.name : '?'}`;
    log(
      'tabEvent opened=[' + e.opened.map(fmt).join(',') + ']',
      'closed=[' + e.closed.map(fmt).join(',') + ']',
      'changed=[' + e.changed.map(fmt).join(',') + ']',
    );
  });

  const folders = vscode.workspace.workspaceFolders;
  assert.ok(folders && folders.length > 0, 'workspace folder missing');
  const uri = vscode.Uri.joinPath(folders[0].uri, 'sample.md');

  log('STEP1 openTextDocument');
  const r1 = await withTimeout(vscode.workspace.openTextDocument(uri), 5000, 'openTextDocument');
  log('STEP1 result', JSON.stringify({ timedOut: r1.timedOut, error: r1.error }));

  log('STEP2 showTextDocument');
  const r2 = await withTimeout(vscode.window.showTextDocument(r1.value), 5000, 'showTextDocument');
  log('STEP2 result', JSON.stringify({ timedOut: r2.timedOut, error: r2.error }));
  await sleep(500);
  log('STEP2 activeTab', JSON.stringify(describeActiveTab()));

  log('STEP3 openWith mdReview.editor');
  const r3 = await withTimeout(
    vscode.commands.executeCommand('vscode.openWith', uri, 'mdReview.editor'),
    10000,
    'openWith-custom',
  );
  log('STEP3 result', JSON.stringify({ timedOut: r3.timedOut, error: r3.error }));
  await sleep(1500);
  const afterCustom = describeActiveTab();
  log('STEP3 activeTab', JSON.stringify(afterCustom));

  log('STEP4 openWith default (control)');
  const r4 = await withTimeout(
    vscode.commands.executeCommand('vscode.openWith', uri, 'default'),
    10000,
    'openWith-default',
  );
  log('STEP4 result', JSON.stringify({ timedOut: r4.timedOut, error: r4.error }));
  await sleep(1000);
  log('STEP4 activeTab', JSON.stringify(describeActiveTab()));

  log('VERDICT customOpened=' + (afterCustom.kind === 'custom' && afterCustom.viewType === 'mdReview.editor'));
  assert.strictEqual(afterCustom.kind, 'custom', 'custom editor did not open via vscode.openWith');
  assert.strictEqual(afterCustom.viewType, 'mdReview.editor', 'unexpected viewType');
};
