import { z } from 'zod';

export const ProviderNameSchema = z.enum(['claude', 'codex', 'antigravity']);
export type ProviderName = z.infer<typeof ProviderNameSchema>;

export const ProviderConfigSchema = z.object({
  command: z
    .string()
    .regex(
      /^(?:.*\/)?(?:claude|codex|agy)$/,
      'command basename must be exactly one of claude/codex/agy',
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
  // --dangerously-skip-permissions: agy(antigravity)의 direct 모드 권한
  // 자동 승인. claude의 acceptEdits 대응물이며 print mode와 무관하다.
  // 도구 전반을 승인하므로 프롬프트에서 "대상 파일만 수정"으로 범위를 묶는다.
  antigravity: new Set<string>(['--dangerously-skip-permissions']),
};

export const ALLOWED_COMMAND_BASENAMES: Readonly<
  Record<ProviderName, string>
> = {
  claude: 'claude',
  codex: 'codex',
  // provider 식별자는 'antigravity'이나 실제 실행 명령(basename)은 'agy'다.
  antigravity: 'agy',
};

export function commandBasename(command: string): string {
  const trimmed = command.trim();
  // Windows 절대 경로(C:\...\agy)는 백슬래시를 구분자로 쓰므로 두 구분자
  // 중 더 뒤쪽을 basename 경계로 삼는다. 둘 다 없으면 전체가 basename이다.
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
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

// direct 모드(파일 직접 수정)에서 권한 프롬프트로 TUI가 멈추지 않도록
// provider별 자동 승인 플래그를 돌려준다. ALLOWED_ARGS와 정합해야 하며,
// LLMOrchestrator(diff/direct)와 ChatSession(항상 direct)이 공유한다.
export function directPermissionArgs(
  provider: ProviderName,
): readonly string[] {
  switch (provider) {
    case 'claude':
      return ['--permission-mode', 'acceptEdits'];
    case 'antigravity':
      return ['--dangerously-skip-permissions'];
    case 'codex':
      return [];
  }
}
