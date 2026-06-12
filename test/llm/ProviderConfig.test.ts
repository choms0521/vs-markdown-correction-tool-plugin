import { expect } from 'chai';
import {
  ProviderConfigSchema,
  ProviderNameSchema,
} from '../../src/llm/ProviderConfig';

describe('ProviderConfigSchema', () => {
  it('accepts valid claude/codex/gemini basenames', () => {
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
        command: '/home/x/gemini',
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
    expect(() => ProviderNameSchema.parse('openai')).to.throw();
  });
});
