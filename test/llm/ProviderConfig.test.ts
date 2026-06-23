import { expect } from 'chai';
import {
  ProviderConfigSchema,
  ProviderNameSchema,
  directPermissionArgs,
  validateArgs,
} from '../../src/llm/ProviderConfig';

describe('ProviderConfigSchema', () => {
  it('accepts valid claude/codex/agy basenames', () => {
    expect(
      ProviderConfigSchema.safeParse({ command: 'claude', args: [] }).success,
    ).to.equal(true);
    expect(
      ProviderConfigSchema.safeParse({
        command: '/usr/local/bin/codex',
        args: [],
      }).success,
    ).to.equal(true);
    expect(
      ProviderConfigSchema.safeParse({
        command: '/home/x/agy',
        args: [],
      }).success,
    ).to.equal(true);
  });

  it('rejects wrapper-like basenames', () => {
    expect(
      ProviderConfigSchema.safeParse({ command: 'claude-wrapper', args: [] })
        .success,
    ).to.equal(false);
    expect(
      ProviderConfigSchema.safeParse({
        command: '/path/to/billable-claude',
        args: [],
      }).success,
    ).to.equal(false);
  });

  it('defaults args to empty array when omitted', () => {
    const r = ProviderConfigSchema.parse({ command: 'claude' });
    expect(r.args).to.deep.equal([]);
  });

  it('rejects when command is missing', () => {
    expect(ProviderConfigSchema.safeParse({ args: [] }).success).to.equal(
      false,
    );
  });

  it('ProviderNameSchema parses only the three providers', () => {
    expect(ProviderNameSchema.parse('claude')).to.equal('claude');
    expect(ProviderNameSchema.parse('antigravity')).to.equal('antigravity');
    expect(() => ProviderNameSchema.parse('gemini')).to.throw();
    expect(() => ProviderNameSchema.parse('openai')).to.throw();
  });
});

describe('directPermissionArgs', () => {
  it('claude → --permission-mode acceptEdits', () => {
    expect(directPermissionArgs('claude')).to.deep.equal([
      '--permission-mode',
      'acceptEdits',
    ]);
  });

  it('antigravity → --dangerously-skip-permissions', () => {
    expect(directPermissionArgs('antigravity')).to.deep.equal([
      '--dangerously-skip-permissions',
    ]);
  });

  it('codex → 빈 배열 (자동 승인 플래그 없음)', () => {
    expect(directPermissionArgs('codex')).to.deep.equal([]);
  });

  it('반환값은 ALLOWED_ARGS와 정합하여 validateArgs를 통과한다', () => {
    for (const p of ['claude', 'antigravity', 'codex'] as const) {
      expect(() => validateArgs(p, directPermissionArgs(p))).to.not.throw();
    }
  });
});
