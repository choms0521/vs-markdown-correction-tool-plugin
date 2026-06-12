import { z } from 'zod';

export const ProviderNameSchema = z.enum(['claude', 'codex', 'gemini']);
export type ProviderName = z.infer<typeof ProviderNameSchema>;

export const ProviderConfigSchema = z.object({
  command: z
    .string()
    .regex(
      /^(?:.*\/)?(?:claude|codex|gemini)$/,
      'command basename must be exactly one of claude/codex/gemini',
    ),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const ALLOWED_ARGS: Readonly<
  Record<ProviderName, ReadonlySet<string>>
> = {
  // --permission-mode acceptEdits: direct 모드에서 파일 편집 권한 프롬프트로
  // TUI가 멈추지 않게 한다. print mode와 무관하며 과금 경로가 아니다.
  claude: new Set<string>(['--permission-mode', 'acceptEdits']),
  codex: new Set<string>(),
  gemini: new Set<string>(),
};

export const ALLOWED_COMMAND_BASENAMES: Readonly<
  Record<ProviderName, string>
> = {
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
};

export function commandBasename(command: string): string {
  const trimmed = command.trim();
  const idx = trimmed.lastIndexOf('/');
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

export interface CostGuardOutput {
  appendLine(line: string): void;
}

export function validateCommand(
  provider: ProviderName,
  command: string,
  output?: CostGuardOutput,
): void {
  const basename = commandBasename(command);
  const expected = ALLOWED_COMMAND_BASENAMES[provider];
  output?.appendLine(
    `[cost-guard] resolved-command=${command} basename=${basename}`,
  );
  if (basename !== expected) {
    output?.appendLine(
      `[cost-guard] event=command-basename-violation provider=${provider} got=${basename} expected=${expected}`,
    );
    throw new Error(
      `[cost-guard] provider '${provider}'의 command basename은 '${expected}'만 허용됨. ` +
        `현재: '${basename}'. wrapper script로 우회하는 것은 비용 driver 위반 위험이라 차단합니다.`,
    );
  }
}

export function validateArgs(
  provider: ProviderName,
  args: readonly string[],
  output?: CostGuardOutput,
): void {
  const allowed = ALLOWED_ARGS[provider];
  const violating = args.filter((a) => !allowed.has(a));
  if (violating.length > 0) {
    output?.appendLine(
      `[cost-guard] event=args-whitelist-violation provider=${provider} violating=${violating.join(',')}`,
    );
    throw new Error(
      `[cost-guard] provider '${provider}'에 허용되지 않은 args 발견: ${violating.join(', ')}. ` +
        `종량 과금 위험으로 spawn을 거부합니다.`,
    );
  }
}
