import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export interface AppliedFileEdit {
  fileUri: vscode.Uri;
  beforeContent: string;
  afterContent: string;
}

export interface AppliedTurn {
  turnId: string;
  summary: string;
  timestamp: number;
  edits: AppliedFileEdit[];
}

export class UndoManager {
  private turnHistory: AppliedTurn[] = [];

  /**
   * Applies content change to a file using vscode.WorkspaceEdit so that
   * the change is tracked on VS Code's native undo stack (Ctrl+Z).
   */
  public async applyFileContent(
    fileUri: vscode.Uri,
    newContent: string,
    turnId: string = 'turn',
    summary: string = 'TrueForge edit'
  ): Promise<boolean> {
    const filePath = fileUri.fsPath;
    let beforeContent = '';

    if (fs.existsSync(filePath)) {
      beforeContent = fs.readFileSync(filePath, 'utf-8');
    } else {
      // Ensure directory exists if new file
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }

    const edit = new vscode.WorkspaceEdit();

    // Check if document is already opened
    const existingDoc = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === fileUri.toString()
    );

    if (existingDoc) {
      const fullRange = new vscode.Range(
        0,
        0,
        existingDoc.lineCount,
        existingDoc.lineAt(Math.max(0, existingDoc.lineCount - 1)).text.length
      );
      edit.replace(fileUri, fullRange, newContent);
    } else if (fs.existsSync(filePath)) {
      // Create edit over whole file range
      const fileBytes = fs.readFileSync(filePath);
      const lines = fileBytes.toString('utf-8').split(/\r?\n/);
      const lastLineIndex = Math.max(0, lines.length - 1);
      const fullRange = new vscode.Range(0, 0, lastLineIndex, lines[lastLineIndex].length);
      edit.replace(fileUri, fullRange, newContent);
    } else {
      // Create new file
      edit.createFile(fileUri, { ignoreIfExists: true });
      edit.insert(fileUri, new vscode.Position(0, 0), newContent);
    }

    const success = await vscode.workspace.applyEdit(edit);
    if (success) {
      // Save document to persist
      try {
        const doc = await vscode.workspace.openTextDocument(fileUri);
        await doc.save();
      } catch (e) {
        // Fallback disk write if not openable as text document
        fs.writeFileSync(filePath, newContent, 'utf-8');
      }

      this.recordEdit(turnId, summary, {
        fileUri,
        beforeContent,
        afterContent: newContent,
      });
    }

    return success;
  }

  public recordEdit(turnId: string, summary: string, edit: AppliedFileEdit): void {
    let lastTurn = this.turnHistory[this.turnHistory.length - 1];
    if (!lastTurn || lastTurn.turnId !== turnId) {
      lastTurn = {
        turnId,
        summary,
        timestamp: Date.now(),
        edits: [],
      };
      this.turnHistory.push(lastTurn);
    }
    lastTurn.edits.push(edit);
  }

  /**
   * Reverts all changes applied during the last turn cleanly.
   */
  public async undoLastTurn(): Promise<boolean> {
    const lastTurn = this.turnHistory.pop();
    if (!lastTurn || lastTurn.edits.length === 0) {
      vscode.window.showInformationMessage('TrueForge: No applied turns to undo.');
      return false;
    }

    const edit = new vscode.WorkspaceEdit();

    for (const item of lastTurn.edits) {
      const filePath = item.fileUri.fsPath;
      if (item.beforeContent === '') {
        // Was a new file created in this turn; delete it
        edit.deleteFile(item.fileUri, { ignoreIfNotExists: true });
      } else {
        const doc = vscode.workspace.textDocuments.find(
          (d) => d.uri.toString() === item.fileUri.toString()
        );
        if (doc) {
          const fullRange = new vscode.Range(
            0,
            0,
            doc.lineCount,
            doc.lineAt(Math.max(0, doc.lineCount - 1)).text.length
          );
          edit.replace(item.fileUri, fullRange, item.beforeContent);
        } else {
          fs.writeFileSync(filePath, item.beforeContent, 'utf-8');
        }
      }
    }

    const success = await vscode.workspace.applyEdit(edit);
    for (const item of lastTurn.edits) {
      try {
        const doc = await vscode.workspace.openTextDocument(item.fileUri);
        await doc.save();
      } catch {
        // Ignored
      }
    }

    vscode.window.showInformationMessage(
      `TrueForge: Successfully undid last turn (${lastTurn.summary}).`
    );
    return success;
  }

  public getHistoryCount(): number {
    return this.turnHistory.length;
  }
}

