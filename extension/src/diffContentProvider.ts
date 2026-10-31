import * as vscode from 'vscode';
import { HunkRegistry } from './hunkRegistry';

export class DiffContentProvider implements vscode.TextDocumentContentProvider {
  public static readonly scheme = 'trueforge-diff';

  private onDidChangeEventEmitter = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this.onDidChangeEventEmitter.event;

  private registry: HunkRegistry;

  constructor(registry: HunkRegistry) {
    this.registry = registry;
  }

  public refresh(uri: vscode.Uri): void {
    this.onDidChangeEventEmitter.fire(uri);
  }

  public provideTextDocumentContent(uri: vscode.Uri): string {
    // URI structure: trueforge-diff://proposed/<relativePath>
    // Path may have leading slash
    let filePath = uri.path.replace(/^\/+/, '');
    if (filePath.startsWith('proposed/')) {
      filePath = filePath.slice('proposed/'.length);
    }
    filePath = decodeURIComponent(filePath).replace(/\\/g, '/');

    return this.registry.getProposedPreviewContent(filePath);
  }
}

