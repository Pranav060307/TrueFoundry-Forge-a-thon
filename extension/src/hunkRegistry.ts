import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  FileDiff,
  DiffHunk,
  computeFileDiff,
  assembleContent,
  acceptHunk,
  rejectHunk,
  acceptAllHunks,
  rejectAllHunks,
} from './diffEngine';
import { DiffContentProvider } from './diffContentProvider';
import { UndoManager } from './undoManager';

export class HunkRegistry {
  private workspaceRoot: string;
  private stagedEdits = new Map<string, FileDiff>();
  private contentProvider?: DiffContentProvider;
  private undoManager: UndoManager;
  private currentTurnId: string = 'turn-1';

  constructor(workspaceRoot: string, undoManager: UndoManager) {
    this.workspaceRoot = workspaceRoot;
    this.undoManager = undoManager;
  }

  public setContentProvider(provider: DiffContentProvider): void {
    this.contentProvider = provider;
  }

  public setTurnId(turnId: string): void {
    this.currentTurnId = turnId;
  }

  public getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  public normalizePath(filePath: string): string {
    const absPath = path.isAbsolute(filePath)
      ? path.normalize(filePath)
      : path.normalize(path.join(this.workspaceRoot, filePath));
    return path.relative(this.workspaceRoot, absPath).replace(/\\/g, '/');
  }

  public getFullPath(filePath: string): string {
    return path.isAbsolute(filePath)
      ? filePath
      : path.join(this.workspaceRoot, filePath);
  }

  /**
   * Stages a proposed modification in memory. Computes isolated diff hunks
   * and prepares virtual document. DOES NOT TOUCH DISK.
   */
  public stageProposal(
    filePath: string,
    originalContent: string,
    proposedContent: string,
    reason?: string
  ): FileDiff {
    const normPath = this.normalizePath(filePath);
    const fileDiff = computeFileDiff(normPath, originalContent, proposedContent, reason);
    this.stagedEdits.set(normPath, fileDiff);

    // Notify diff provider if already open
    const proposedUri = this.getProposedUri(normPath);
    this.contentProvider?.refresh(proposedUri);

    return fileDiff;
  }

  public getFileDiff(filePath: string): FileDiff | undefined {
    const normPath = this.normalizePath(filePath);
    return this.stagedEdits.get(normPath);
  }

  public getAllFileDiffs(): FileDiff[] {
    return Array.from(this.stagedEdits.values());
  }

  public getPendingHunksCount(filePath?: string): number {
    if (filePath) {
      const fd = this.getFileDiff(filePath);
      return fd ? fd.hunks.filter((h) => h.state === 'pending').length : 0;
    }
    let count = 0;
    for (const fd of this.stagedEdits.values()) {
      count += fd.hunks.filter((h) => h.state === 'pending').length;
    }
    return count;
  }

  public getProposedPreviewContent(filePath: string): string {
    const normPath = this.normalizePath(filePath);
    const fd = this.stagedEdits.get(normPath);
    if (!fd) {
      // If not staged, fallback to reading file from disk
      const fullPath = this.getFullPath(filePath);
      if (fs.existsSync(fullPath)) {
        return fs.readFileSync(fullPath, 'utf-8');
      }
      return '';
    }
    return assembleContent(fd, 'preview');
  }

  public getProposedUri(filePath: string): vscode.Uri {
    const normPath = this.normalizePath(filePath);
    return vscode.Uri.parse(`${DiffContentProvider.scheme}://proposed/${encodeURIComponent(normPath)}`);
  }

  public getOriginalUri(filePath: string): vscode.Uri {
    return vscode.Uri.file(this.getFullPath(filePath));
  }

  /**
   * Opens VS Code side-by-side diff editor: Original (Left) vs Proposed (Right).
   */
  public async openDiff(filePath: string): Promise<void> {
    const normPath = this.normalizePath(filePath);
    const fd = this.stagedEdits.get(normPath);
    if (!fd) {
      vscode.window.showWarningMessage(`No staged diff found for '${filePath}'`);
      return;
    }

    const originalUri = this.getOriginalUri(normPath);
    const proposedUri = this.getProposedUri(normPath);
    const fileName = path.basename(normPath);
    const title = `${fileName} (Proposed Changes: ${fd.hunks.length} hunk${fd.hunks.length === 1 ? '' : 's'})`;

    await vscode.commands.executeCommand('vscode.diff', originalUri, proposedUri, title, {
      preview: false,
    });
  }

  /**
   * Accepts a single hunk, updates disk content via WorkspaceEdit,
   * and refreshes the diff editor.
   */
  public async acceptHunk(filePath: string, hunkId: string): Promise<boolean> {
    const normPath = this.normalizePath(filePath);
    const fd = this.stagedEdits.get(normPath);
    if (!fd) return false;

    const success = acceptHunk(fd, hunkId);
    if (!success) return false;

    // Apply currently accepted hunks to disk via WorkspaceEdit
    const newAppliedContent = assembleContent(fd, 'applied');
    const originalUri = this.getOriginalUri(normPath);
    await this.undoManager.applyFileContent(
      originalUri,
      newAppliedContent,
      this.currentTurnId,
      `Accept hunk ${hunkId} in ${normPath}`
    );

    // Refresh diff view
    this.contentProvider?.refresh(this.getProposedUri(normPath));

    const remaining = fd.hunks.filter((h) => h.state === 'pending').length;
    vscode.window.showInformationMessage(
      `Accepted hunk in ${path.basename(normPath)} (${remaining} remaining).`
    );

    return true;
  }

  /**
   * Rejects a single hunk, discards its proposed lines, and refreshes diff view.
   */
  public async rejectHunk(filePath: string, hunkId: string): Promise<boolean> {
    const normPath = this.normalizePath(filePath);
    const fd = this.stagedEdits.get(normPath);
    if (!fd) return false;

    const success = rejectHunk(fd, hunkId);
    if (!success) return false;

    // Refresh diff view to show discarded proposal
    this.contentProvider?.refresh(this.getProposedUri(normPath));

    const remaining = fd.hunks.filter((h) => h.state === 'pending').length;
    vscode.window.showInformationMessage(
      `Rejected hunk in ${path.basename(normPath)} (${remaining} remaining).`
    );

    return true;
  }

  /**
   * Accepts all pending hunks for a file.
   */
  public async acceptAll(filePath: string): Promise<boolean> {
    const normPath = this.normalizePath(filePath);
    const fd = this.stagedEdits.get(normPath);
    if (!fd) return false;

    acceptAllHunks(fd);
    const newAppliedContent = assembleContent(fd, 'applied');
    const originalUri = this.getOriginalUri(normPath);

    await this.undoManager.applyFileContent(
      originalUri,
      newAppliedContent,
      this.currentTurnId,
      `Accept all hunks in ${normPath}`
    );

    this.contentProvider?.refresh(this.getProposedUri(normPath));
    vscode.window.showInformationMessage(`Accepted all hunks in ${path.basename(normPath)}.`);
    return true;
  }

  /**
   * Rejects all pending hunks for a file.
   */
  public async rejectAll(filePath: string): Promise<boolean> {
    const normPath = this.normalizePath(filePath);
    const fd = this.stagedEdits.get(normPath);
    if (!fd) return false;

    rejectAllHunks(fd);
    this.contentProvider?.refresh(this.getProposedUri(normPath));
    vscode.window.showInformationMessage(`Rejected all hunks in ${path.basename(normPath)}.`);
    return true;
  }

  public clearProposal(filePath: string): void {
    const normPath = this.normalizePath(filePath);
    this.stagedEdits.delete(normPath);
    this.contentProvider?.refresh(this.getProposedUri(normPath));
  }

  public clearAll(): void {
    const paths = Array.from(this.stagedEdits.keys());
    this.stagedEdits.clear();
    for (const p of paths) {
      this.contentProvider?.refresh(this.getProposedUri(p));
    }
  }
}

