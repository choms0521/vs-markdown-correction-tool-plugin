#!/usr/bin/env node
// Cost guard (static): blocks committing literal "-p" / "--print" CLI flags in
// src/, which would route a provider into metered, non-interactive mode.
//
// This is a cross-platform replacement for `! grep -rE '"-p"|"--print"' src/`.
// The bash form fails under cmd.exe (npm's default script shell on Windows CI)
// with `'!' is not recognized`, so the check is implemented in Node instead.
'use strict';

const { readdirSync, readFileSync } = require('fs');
const { join } = require('path');

const ROOT = 'src';
const FORBIDDEN = /"-p"|"--print"/;

function listFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

function main() {
  let files;
  try {
    files = listFiles(ROOT);
  } catch (err) {
    console.error(`[cost-guard] cannot read ${ROOT}/: ${err.message}`);
    process.exit(1);
  }

  const hits = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (FORBIDDEN.test(line)) {
        hits.push(`${file}:${index + 1}: ${line.trim()}`);
      }
    });
  }

  if (hits.length > 0) {
    console.error('[cost-guard] forbidden -p/--print literal found:');
    for (const hit of hits) {
      console.error(`  ${hit}`);
    }
    process.exit(1);
  }
  console.log('[cost-guard] no -p/--print literals in src/');
}

main();
