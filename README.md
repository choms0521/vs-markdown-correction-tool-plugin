# mdReview — Markdown Inline Review for VSCode

A VSCode extension for inline review of `.md` files. Author `suggestion` and
`question` comments directly on the rendered markdown preview, submit them to
an interactive LLM CLI (`claude`, `codex`, or `antigravity`/`agy`), and apply the revised
markdown hunk-by-hunk through the standard VSCode diff editor.

## Features

- **Custom editor** for `.md`: side-by-side preview + comment panel.
- **Inline anchoring**: pin comments to specific lines / ranges in the preview.
- **Interactive CLI integration**: opens a long-lived PTY session and sends a
  single envelope-wrapped prompt. No piped `--print` mode (see Cost Guard).
- **Hunk-by-hunk diff approval**: review the revised markdown in the standard
  `vscode.diff` editor and pick which hunks to apply.
- **Two persistence backends** (mutually exclusive, configurable):
  - `sidecar`: writes `<file>.review.json` next to the source. Git-portable.
  - `workspaceState`: stores in VSCode's per-workspace memento. Not portable.
- **Cost guard**: four layers prevent accidental metered (non-interactive)
  invocations of supported CLIs.

## Requirements

- **VSCode**: `^1.90.0`
- **Node-pty native binary**: the published `.vsix` is platform-specific.
  Install the variant matching your OS and CPU architecture.
- **Windows 10 1809 (build 17763) or newer** is required for ConPTY support.
  Older builds will show a warning and PTY-based submissions will fail. Use
  Windows Terminal or Windows 11 if possible.
- A working `claude`, `codex`, or `antigravity` (`agy`) CLI on `PATH`, **or** an explicit
  absolute path configured in settings (see Troubleshooting).

## Installation

Download the `.vsix` matching your platform from the GitHub Releases page, then:

```sh
code --install-extension mdreview-0.0.1-darwin-arm64.vsix
```

Available targets: `darwin-arm64`, `linux-x64`, `linux-arm64`, `win32-x64`.
(Intel macOS / `darwin-x64` is not built in CI — the macOS x64 runner is being
retired; build it locally with `npm run package:darwin-x64` if needed.)

## Settings

| Key | Type | Default | Description |
| --- | ---- | ------- | ----------- |
| `mdReview.defaultProvider` | enum (`claude` / `codex` / `antigravity`) | `claude` | Provider used for review submissions. |
| `mdReview.providers` | object | `{}` | Per-provider `command` / `args` / `cwd` / `env` overrides. Keys are provider names. |
| `mdReview.sentinelTimeoutMs` | number | `600000` | Hard timeout (ms) before submission gives up. |
| `mdReview.responseQuietPeriodMs` | number | `200` | Quiet period (ms) after sentinel before finalizing response. |
| `mdReview.persistenceBackend` | enum (`sidecar` / `workspaceState`) | `sidecar` | Where to store review comments. Mutually exclusive. |

### Example `settings.json`

```jsonc
{
  "mdReview.defaultProvider": "claude",
  "mdReview.providers": {
    "claude": {
      "command": "/Users/me/.local/bin/claude",
      "args": [],
      "cwd": "${workspaceFolder}"
    }
  },
  "mdReview.persistenceBackend": "sidecar"
}
```

## Cost Guard

The CLIs supported by this extension (`claude`, `codex`, `antigravity`/`agy`) are
billed per token when invoked non-interactively (`-p` / `--print`). mdReview enforces
**interactive PTY mode only** through four defense layers:

1. **Static lint** (`npm run lint:cost-guard`): grep blocks committing literal
   `-p` or `--print` tokens in `src/`.
2. **Zod regex**: command basename must match `^(?:.*\/)?(?:claude|codex|agy)$`.
3. **`validateCommand`**: rejects wrapper scripts at runtime.
4. **`validateArgs`**: rejects any token not in the provider's `ALLOWED_ARGS`
   set. Only direct-mode permission flags are whitelisted (claude:
   `--permission-mode acceptEdits`; antigravity: `--dangerously-skip-permissions`);
   `-p` / `--print` and every other token are rejected. Violations are logged as
   `args-whitelist-violation` and throw immediately.

The args whitelist is **enforced at runtime**. Editing settings cannot bypass
it.

## Troubleshooting

### macOS GUI launch — zshrc trap

If you launch VSCode by double-clicking the icon in Finder or Dock, macOS does
**not** start a login shell, so your `~/.zshrc` (and any `PATH` exports there)
will not be loaded. This commonly results in `ENOENT` errors when mdReview
tries to spawn `claude` or another CLI installed under `~/.local/bin`.

Three remedies, pick whichever fits your workflow:

1. **Absolute path in settings** (simplest):
   ```jsonc
   {
     "mdReview.providers": {
       "claude": { "command": "/Users/you/.local/bin/claude" }
     }
   }
   ```
2. **Launch VSCode from a terminal** (`code .`) so the inherited `PATH`
   includes your shell's customizations.
3. **Inject env via a `launchd` plist** under `~/Library/LaunchAgents` if you
   need GUI launch to behave like a login shell system-wide.

### Windows: ConPTY not available

mdReview requires **Windows 10 build 17763 (1809) or newer**. On older builds,
activation logs `[mdReview] os-guard-violation` and displays a warning; PTY
submissions will fail. Update Windows, or use Windows 11.

### Linux: cannot find `claude` after install

`node-pty` requires `glibc 2.31+` (Ubuntu 20.04+, Debian 11+, RHEL 9+). On
older distros you may see `GLIBC_2.31 not found`. Upgrade your distro or build
node-pty from source.

## Development

```sh
npm install
npm run compile           # tsc (host)
npm run compile:webview   # tsc (webview separate config)
npm run lint              # eslint + cost-guard grep
npm test                  # mocha unit tests
npm run package:darwin-arm64   # vsce package --target darwin-arm64
```

Open the workspace in VSCode and press `F5` to launch an Extension
Development Host.

## License

MIT. See [LICENSE](./LICENSE).
