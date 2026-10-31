import * as vscode from 'vscode';
import { HunkRegistry } from './hunkRegistry';
import { DiffContentProvider } from './diffContentProvider';

export class DiffCodeLensProvider implements vscode.CodeLensProvider {
  private registry: HunkRegistry;
  private onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;

  constructor(registry: HunkRegistry) {
    this.registry = registry;
  }

  public refresh(): void {
    this.onDidChangeCodeLensesEmitter.fire();
  }

  public provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    let normPath = '';

    if (document.uri.scheme === DiffContentProvider.scheme) {
      // Proposed virtual document
      let p = document.uri.path.replace(/^\/+/, '');
      if (p.startsWith('proposed/')) {
        p = p.slice('proposed/'.length);
      }
      normPath = decodeURIComponent(p).replace(/\\/g, '/');
    } else if (document.uri.scheme === 'file') {
      normPath = this.registry.normalizePath(document.uri.fsPath);
    } else {
      return lenses;
    }

    const fileDiff = this.registry.getFileDiff(normPath);
    if (!fileDiff || fileDiff.hunks.length === 0) {
      return lenses;
    }

    const pendingHunks = fileDiff.hunks.filter((h) => h.state === 'pending');

    // Document header CodeLens: Accept All / Reject All
    if (pendingHunks.length > 0) {
      const topRange = new vscode.Range(0, 0, 0, 0);

      lenses.push(
        new vscode.CodeLens(topRange, {
          title: `✓ Accept All Hunks (${pendingHunks.length})`,
          command: 'trueforge.acceptAllHunks',
          arguments: [normPath],
        })
      );

      lenses.push(
        new vscode.CodeLens(topRange, {
          title: '✗ Reject All Hunks',
          command: 'trueforge.rejectAllHunks',
          arguments: [normPath],
        })
      );
    }

    // Per-hunk CodeLens
    fileDiff.hunks.forEach((hunk, index) => {
      // Determine target line number in document
      let lineNum = 0;
      if (document.uri.scheme === DiffContentProvider.scheme) {
        lineNum = Math.max(0, hunk.newStart - 1);
      } else {
        lineNum = Math.max(0, hunk.oldStart - 1);
      }

      lineNum = Math.min(lineNum, Math.max(0, document.lineCount - 1));
      const range = new vscode.Range(lineNum, 0, lineNum, 0);

      if (hunk.state === 'pending') {
        lenses.push(
          new vscode.CodeLens(range, {
            title: `✓ Accept Hunk ${index + 1}`,
            command: 'trueforge.acceptHunk',
            arguments: [normPath, hunk.id],
          })
        );
        lenses.push(
          new vscode.CodeLens(range, {
            title: `✗ Reject Hunk ${index + 1}`,
            command: 'trueforge.rejectHunk',
            arguments: [normPath, hunk.id],
          })
        );
      } else if (hunk.state === 'accepted') {
        lenses.push(
          new vscode.CodeLens(range, {
            title: `✓ Hunk ${index + 1} Accepted`,
            command: '',
          })
        );
      } else if (hunk.state === 'rejected') {
        lenses.push(
          new vscode.CodeLens(range, {
            title: `✗ Hunk ${index + 1} Rejected`,
            command: '',
          })
        );
      }
    });

    return lenses;
  }
}

