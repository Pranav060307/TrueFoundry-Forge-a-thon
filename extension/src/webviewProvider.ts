import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { TrueForgeClient, TrueForgeEvent } from './trueforgeClient';
import { SidecarManager } from './sidecarManager';
import { ConfigLoader } from './configLoader';
import { HunkRegistry } from './hunkRegistry';
import { ModelFailoverManager } from './failoverManager';

export class AgentWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'trueforge.agentPanel';

  private view?: vscode.WebviewView;
  private extensionUri: vscode.Uri;
  private trueforgeClient: TrueForgeClient;
  private sidecarManager: SidecarManager;
  private hunkRegistry: HunkRegistry;
  private failoverManager: ModelFailoverManager;
  private currentSessionId?: string;
  private abortController?: AbortController;
  private statusInterval?: NodeJS.Timeout;

  constructor(
    extensionUri: vscode.Uri,
    trueforgeClient: TrueForgeClient,
    sidecarManager: SidecarManager,
    hunkRegistry: HunkRegistry,
    failoverManager: ModelFailoverManager
  ) {
    this.extensionUri = extensionUri;
    this.trueforgeClient = trueforgeClient;
    this.sidecarManager = sidecarManager;
    this.hunkRegistry = hunkRegistry;
    this.failoverManager = failoverManager;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.extensionUri,
        vscode.Uri.file(path.join(this.extensionUri.fsPath, '..', 'webview', 'dist')),
      ],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'getHealth':
          await this.broadcastStatus();
          break;

        case 'sendMessage':
          await this.handleUserPrompt(message.prompt);
          break;

        case 'cancel':
          await this.handleCancel();
          break;

        case 'reviewDiff': {
          const pendingFiles = this.hunkRegistry
            .getAllFileDiffs()
            .filter((f) => f.hunks.some((h) => h.state === 'pending'));

          if (pendingFiles.length > 0) {
            await this.hunkRegistry.openDiff(pendingFiles[0].filePath);
          } else {
            vscode.window.showInformationMessage('TrueForge: No pending diffs to review.');
          }
          break;
        }

        case 'acceptAll':
          await vscode.commands.executeCommand('trueforge.acceptAllHunks');
          break;

        case 'rejectAll':
          await vscode.commands.executeCommand('trueforge.rejectAllHunks');
          break;
      }
    });

    // Start background status poll
    this.statusInterval = setInterval(() => {
      this.broadcastStatus();
    }, 3000);

    webviewView.onDidDispose(() => {
      if (this.statusInterval) clearInterval(this.statusInterval);
    });
  }

  public async broadcastStatus(): Promise<void> {
    if (!this.view) return;
    const tfOk = await this.trueforgeClient.isHealthy();
    const scOk = await this.sidecarManager.isHealthy();

    // Sync any pending edits from the Python sidecar into HunkRegistry
    try {
      const pendingEdits = await this.sidecarManager.getPendingEdits();
      for (const pe of pendingEdits) {
        const existing = this.hunkRegistry.getFileDiff(pe.path);
        if (!existing || existing.proposedContent !== pe.proposed_content) {
          this.hunkRegistry.stageProposal(
            pe.path,
            pe.original_content,
            pe.proposed_content,
            pe.reason
          );
        }
      }
    } catch {
      // Sidecar offline or starting
    }

    const pendingCount = this.hunkRegistry.getPendingHunksCount();

    this.view.webview.postMessage({
      type: 'statusUpdate',
      trueforge: tfOk ? 'connected' : 'offline',
      sidecar: scOk ? 'healthy' : 'offline',
      pendingEdits: pendingCount,
    });
  }

  private async handleUserPrompt(userPrompt: string): Promise<void> {
    if (!this.view) return;

    this.abortController = new AbortController();
    const turnId = `turn-${Date.now()}`;
    this.hunkRegistry.setTurnId(turnId);

    try {
      this.view.webview.postMessage({ type: 'turnCreated', turnId });

      const instructions =
        'You are TrueForge Coding Agent, an expert software engineer embedded in VS Code. Use the available MCP tools to read, search, and propose changes.';

      const result = await this.failoverManager.executeTurnWithFallback(
        instructions,
        [{ type: 'user.message', content: userPrompt }],
        (event: TrueForgeEvent) => {
          if (!this.view) return;

          if (event.type === 'model.message.delta' && event.content) {
            this.view.webview.postMessage({ type: 'tokenDelta', content: event.content });
          } else if (event.type === 'model.message' && event.tool_calls) {
            for (const tc of event.tool_calls) {
              const toolName = tc.function?.name || tc.tool_info?.name || 'tool';
              this.view.webview.postMessage({
                type: 'toolCall',
                toolName,
                args: tc.function?.arguments,
              });

              // If propose_write was called, sync immediately and notify
              if (toolName === 'propose_write') {
                this.broadcastStatus().then(() => {
                  const pendingFiles = this.hunkRegistry
                    .getAllFileDiffs()
                    .filter((f) => f.hunks.some((h) => h.state === 'pending'));
                  if (pendingFiles.length > 0) {
                    this.hunkRegistry.openDiff(pendingFiles[0].filePath);
                  }
                });
              }
            }
          }
        },
        (notice: string, fallbackModel: string) => {
          vscode.window.setStatusBarMessage(`$(warning) ${notice}`, 8000);
          this.view?.webview.postMessage({
            type: 'statusNotice',
            message: `Primary failed, using fallback: ${fallbackModel}`,
          });
        },
        this.abortController.signal
      );

      this.view.webview.postMessage({ type: 'turnDone' });
      await this.broadcastStatus();
    } catch (err: any) {
      const msg = err.message || 'Error communicating with TrueForge';

      this.view.webview.postMessage({
        type: 'error',
        message: msg,
      });
    }
  }

  private async handleCancel(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
    }
    if (this.currentSessionId) {
      await this.trueforgeClient.cancelSession(this.currentSessionId);
    }
    this.view?.webview.postMessage({ type: 'turnDone' });
    vscode.window.showInformationMessage('TrueForge: Agent turn cancelled. No changes were written to disk.');
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const webviewDist = path.join(this.extensionUri.fsPath, '..', 'webview', 'dist');
    const indexPath = path.join(webviewDist, 'index.html');

    if (!fs.existsSync(indexPath)) {
      return `<!DOCTYPE html><html><body><h3>Webview dist not built yet. Run "npm run build" in webview/.</h3></body></html>`;
    }

    let html = fs.readFileSync(indexPath, 'utf-8');

    // Transform asset URLs
    const assetRegex = /(src|href)="\/assets\/([^"]+)"/g;
    html = html.replace(assetRegex, (_match, attr, file) => {
      const assetUri = webview.asWebviewUri(vscode.Uri.file(path.join(webviewDist, 'assets', file)));
      return `${attr}="${assetUri}"`;
    });

    const csp = `
      default-src 'none';
      img-src ${webview.cspSource} https: data:;
      script-src ${webview.cspSource} 'unsafe-inline';
      style-src ${webview.cspSource} 'unsafe-inline';
      font-src ${webview.cspSource};
      connect-src ${webview.cspSource} http://localhost:* http://127.0.0.1:*;
    `.replace(/\s+/g, ' ').trim();

    html = html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`);
    return html;
  }
}
