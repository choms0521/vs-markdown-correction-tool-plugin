# Changelog

All notable changes to the mdReview extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.2] - 2026-06-15

### Added
- Initial 0.0.1 release scaffolding (P0 through P6).
- `mdReview.toggle` command, editor title icon, and keybinding to switch
  between the review editor and the default text editor.
- Webview `ready` handshake: the webview signals readiness on load and the
  host pushes the initial `renderUpdate` / `commentsUpdate` afterwards.
- Integration test harness (`test-integration/`) using `@vscode/test-electron`
  covering the open/toggle flow against a clean VSCode instance.
- Inline comment input form: clicking "제안 추가" / "질문 추가" now opens a
  small overlay form to author the suggestion replacement text or question
  before the comment is created (previously the selected text itself was
  stored as both the note and the suggestion).
- Per-comment delete (×) button in the side panel, wired to the existing
  `removeComment` host handler.
- `mdReview.previewTheme` setting (`auto` / `light` / `dark`) plus a panel
  header toggle button; forced themes use a GitHub-style palette implemented
  by overriding the consumed `--vscode-*` CSS variables.
- Right-clicking a text selection in the preview opens the
  suggestion/question/copy menu at the cursor. This is now the only entry
  point: the automatic popup on text selection was removed as too intrusive,
  and a copy button is provided since the native context menu is suppressed.
- Suggestions now capture the original markdown source for the selected
  lines (via `data-line` / `data-line-end` block attributes and the raw
  source shipped with `renderUpdate`) instead of the rendered text, so
  markers like list bullets, task checkboxes, and backticks are preserved
  in the suggestion's before text and the edit form prefill.
- Submission progress feedback: a VSCode progress notification while waiting
  for the LLM, and the submit button shows a busy state until `submitAck`.
- On submission failure the sanitized tail of the PTY output is logged to the
  `mdReview` channel for diagnosis (e.g., sentinel timeouts).
- GitHub-style typography for the rendered markdown body (heading hierarchy
  with borders, 860px measure, table stripes, blockquote/hr/link styling).
- "작업 요청" (task request) tab in the review panel. The panel now has two
  tabs: the existing comment review becomes the left "md수정" tab, and a new
  right tab offers a multi-turn chat backed by a persistent CLI session. A
  free-text instruction (e.g. "1번 적용해줘", then "방금 바꾼 거 되돌려줘")
  drives the CLI to edit the file directly (direct mode) while the live
  session retains conversation context across turns; the resulting change is
  shown as a host-computed before/after diff (immune to TUI screen-scrape
  corruption) with explicit applied / no-change / failed status and per-turn
  undo. The current review comments are bundled into each instruction prompt
  so number references work. Both tabs share one in-flight lock, so while any
  LLM operation runs the submit/send buttons on both tabs are disabled.
- Multi-turn chat session lifecycle (`ChatSession`). The interactive CLI
  process is spawned lazily on the first send (opening a document costs no
  process), reused across turns to preserve context, and torn down on a
  single anchor: the tab closing (`onDidDispose`) or the extension
  deactivating (provider-held registry as a backstop). Disposal aborts any
  in-flight turn so killing the PTY can never leave an awaiter hanging, and is
  idempotent. Each turn computes its diff from disk (the source of truth in
  direct mode) to avoid cross-turn contamination from a lagging buffer reload.

### Fixed
- Custom editor hang: `resolveCustomTextEditor` awaited webview message
  delivery before returning, but VSCode does not load webview content until
  resolution completes — a host/webview deadlock that left the editor stuck
  on an empty panel. Initial state is now pushed on the webview's `ready`
  signal instead.
- `.vsix` packaging excluded `node_modules/markdown-it/dist/**`, which removed
  markdown-it's CommonJS entry point (`dist/index.cjs.js`) and made activation
  fail with `Cannot find module`. Only browser bundles are excluded now.
- `node-pty` `spawn-helper` prebuilt binary shipped without the executable
  bit, which would break PTY spawning on macOS.
- Selection overlay buttons were positioned with the scroll offset added on
  top of viewport coordinates inside a fixed-position layer, so they rendered
  off-screen for any selection below the first viewport of the document.
- The submit button could be pushed out of view when the comment list grew;
  the list now scrolls independently and the button stays pinned at the
  bottom of the panel.
- Oversized comment payloads (over the 2KB webview-to-host budget) were
  dropped silently; the input form now shows a visible error instead.
- LLM submissions always timed out because the prompt and the submit key
  were written to the PTY in a single burst: interactive TUI CLIs treat an
  Enter arriving inside a paste burst as a newline, so the prompt was never
  submitted (the CLI sat at 0 tokens). The orchestrator now waits for the
  TUI to boot (first output + settle), writes the prompt, then sends the
  submit key as a separate write after a short delay. Timing is injectable
  for tests (`OrchestratorTiming`).

- The hunk approval QuickPick silently dismissed on focus loss, making a
  successful LLM response look like nothing happened. It now sets
  `ignoreFocusOut`, an arrival toast announces the hunk count, and an empty
  selection offers a retry instead of dropping the response.

### Changed
- Replaced the `gemini` provider with `antigravity` (Google's Antigravity CLI,
  invoked as `agy`). The standalone `gemini` CLI stops serving consumer requests
  on 2026-06-18, so it is no longer a viable backend. The provider identifier is
  `antigravity` while the command basename is `agy`; the cost-guard command
  regex (`claude|codex|agy`) and the command/args whitelists were updated to
  match. `GeminiDetector` is replaced by `AntigravityDetector`, which disables
  shell-prompt termination (never-match) like `ClaudeDetector` — `agy` is a
  full-screen TUI whose input box renders during responses, so a `>` prompt
  pattern would trigger false completion.
- Centralized direct-mode permission flags into a single
  `directPermissionArgs(provider)` helper shared by `LLMOrchestrator` and
  `ChatSession` (claude: `--permission-mode acceptEdits`; antigravity:
  `--dangerously-skip-permissions`; codex: none). antigravity uses
  `--dangerously-skip-permissions` *without* `--sandbox`: sandbox mode confines
  writes to a virtual filesystem (so the real `.md` is never edited) and is
  bypassable when combined with auto-approval, making it incompatible with
  direct file editing.
- `mdReview.sentinelTimeoutMs` default raised from 90000 to 180000 (3 min)
  to accommodate long responses.

## [0.0.1] - 2026-05-15

### Added
- Custom text editor for `.md` files (`mdReview.editor`) with inline preview panel.
- Inline comment authoring with `suggestion` (before/after) and `question` types.
- Persistence backends (mutually exclusive):
  - `sidecar`: `<file>.review.json` next to the source markdown (git-portable).
  - `workspaceState`: per-workspace VSCode memento (not portable).
- Interactive LLM CLI integration via node-pty:
  - Supported providers: `claude`, `codex`, `gemini`.
  - PROMPT envelope + sentinel + 200ms quiet period + shell prompt regex + 90s
    timeout for response termination detection.
- Cost guard (defense in depth):
  - Static `lint:cost-guard` grep blocks committing `-p` / `--print` literals.
  - Zod regex enforces command basename whitelist (`claude` / `codex` / `gemini`
    only).
  - Runtime `validateCommand` rejects wrapper scripts.
  - Runtime `validateArgs` rejects any token outside `ALLOWED_ARGS`
    (currently empty for all providers).
- Diff workflow:
  - Line-level LCS hunk computation (no external diff dependency).
  - `vscode.diff` editor presentation of original vs. revised markdown.
  - QuickPick hunk-by-hunk approval (default: all picked).
  - `WorkspaceEdit` applied in descending startLine order to avoid index shift.
- Observability: 11 lifecycle events logged to `mdReview` and
  `mdReview-lifecycle` output channels.
- Windows 1809 (build 17763) guard with a friendly warning on older builds.

### Documentation
- `README.md` covering install, settings, macOS GUI launch trap, Windows
  requirements, and cost guard behavior.
- `LICENSE` (MIT).
- Detailed phase plans under `docs/plans/p1/` through `docs/plans/p6/`.

### Build & CI
- TypeScript strict mode, dual `tsconfig` for host and webview.
- Mocha + Chai + Sinon test harness, 155+ unit tests across PTY, LLM, store,
  editor, and diff layers.
- GitHub Actions matrix workflow for `darwin-arm64`, `darwin-x64`, `linux-x64`,
  `linux-arm64`, and `win32-x64`, producing platform-specific `.vsix`
  artifacts.

[Unreleased]: https://github.com/local/vscode-md-review/compare/v0.0.2...HEAD
[0.0.2]: https://github.com/local/vscode-md-review/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/local/vscode-md-review/releases/tag/v0.0.1
