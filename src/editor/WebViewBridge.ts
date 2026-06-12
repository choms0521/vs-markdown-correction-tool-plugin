import {
  HostToWebViewMessageSchema,
  WebViewToHostMessageSchema,
  type HostToWebViewMessage,
  type WebViewToHostMessage,
} from './messages';

export type WebViewMessageHandler = (
  msg: WebViewToHostMessage,
) => void | Promise<void>;

export interface OutputSink {
  appendLine(message: string): void;
}

export interface WebViewLike {
  postMessage(message: unknown): Thenable<boolean> | Promise<boolean>;
  onDidReceiveMessage(
    listener: (e: unknown) => void | Promise<void>,
  ): { dispose(): void };
}

export class WebViewBridge {
  constructor(
    private readonly webview: WebViewLike,
    private readonly output: OutputSink,
  ) {}

  async post(msg: HostToWebViewMessage): Promise<boolean> {
    HostToWebViewMessageSchema.parse(msg);
    return Promise.resolve(this.webview.postMessage(msg));
  }

  onMessage(handler: WebViewMessageHandler): { dispose(): void } {
    return this.webview.onDidReceiveMessage(async (raw) => {
      const result = WebViewToHostMessageSchema.safeParse(raw);
      if (!result.success) {
        this.output.appendLine(
          `[bridge] dropped invalid message: ${result.error.message}`,
        );
        return;
      }
      await handler(result.data);
    });
  }
}
