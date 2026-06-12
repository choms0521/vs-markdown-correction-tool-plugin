import * as pty from 'node-pty';
import * as vscode from 'vscode';

export interface SpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

/**
 * Thin wrapper around node-pty for spawning interactive LLM CLI sessions.
 * - spawnDefault: production path. Inherits user's ~/.claude ambient state
 *   via process.env and uses the active workspace folder as cwd.
 * - spawnForTest: test path. Uses a tmp cwd and sandboxed HOME with
 *   NO_COLOR=1 so observability does not depend on terminal capabilities.
 */
export class NodePtySession {
  private ptyProcess: pty.IPty;
  private disposables: { dispose: () => void }[] = [];

  constructor(opts: SpawnOptions) {
    this.ptyProcess = pty.spawn(opts.command, opts.args, {
      name: 'xterm-256color',
      cols: 200,
      rows: 50,
      cwd: opts.cwd,
      env: opts.env as { [key: string]: string },
    });
  }

  static spawnDefault(command: string, args: string[]): NodePtySession {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const cwd = folder ? folder.uri.fsPath : process.cwd();
    return new NodePtySession({
      command,
      args,
      cwd,
      env: process.env,
    });
  }

  static spawnForTest(
    command: string,
    args: string[],
    sandboxHome: string,
    tempCwd: string,
  ): NodePtySession {
    return new NodePtySession({
      command,
      args,
      cwd: tempCwd,
      env: { ...process.env, HOME: sandboxHome, NO_COLOR: '1' },
    });
  }

  write(payload: string): void {
    this.ptyProcess.write(payload);
  }

  onData(handler: (chunk: string) => void): { dispose: () => void } {
    const disposable = this.ptyProcess.onData(handler);
    this.disposables.push(disposable);
    return disposable;
  }

  async kill(
    signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM',
    forceTimeoutMs = 2000,
  ): Promise<void> {
    return new Promise((resolve) => {
      let killed = false;
      const onExit = this.ptyProcess.onExit(() => {
        killed = true;
        for (const d of this.disposables) d.dispose();
        onExit.dispose();
        resolve();
      });
      this.ptyProcess.kill(signal);
      if (signal === 'SIGTERM') {
        setTimeout(() => {
          if (!killed) {
            try {
              this.ptyProcess.kill('SIGKILL');
            } catch {
              /* already dead */
            }
          }
        }, forceTimeoutMs);
      }
    });
  }
}
