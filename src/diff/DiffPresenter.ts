import { type UriLike } from './types';

export { type UriLike };

export interface DiffPresenterDeps {
  openTextDocument(options: {
    content: string;
    language: string;
  }): Promise<{ uri: UriLike }>;
  executeCommand(command: string, ...args: unknown[]): Promise<unknown>;
}

export class DiffPresenter {
  constructor(private readonly deps: DiffPresenterDeps) {}

  async present(
    originalUri: UriLike,
    revisedText: string,
    title: string,
  ): Promise<UriLike> {
    const doc = await this.deps.openTextDocument({
      content: revisedText,
      language: 'markdown',
    });
    await this.deps.executeCommand(
      'vscode.diff',
      originalUri,
      doc.uri,
      title,
      { preview: true },
    );
    return doc.uri;
  }
}
