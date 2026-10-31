import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { TrueForgeClient, TrueForgeEvent } from './trueforgeClient';
import { SidecarManager } from './sidecarManager';
import { ConfigLoader } from './configLoader';

export class AgentWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'trueforge.agentPanel';

  private view?: vscode.WebviewView;
  private extensionUri: vscode.Uri;
  private trueforgeClient: TrueForgeClient;
  private sidecarManager: SidecarManager;
  private currentSessionId?: string;
  private abortController?: AbortController;
  private statusInterval?: NodeJS.Timeout;

  constructor(extensionUri: vscode.Uri, trueforgeClient: TrueForgeClient, sidecarManager: SidecarManager) {
    this.extensionUri = extensionUri;
    this.trueforgeClient = trueforgeClient;
    this.sidecarManager = sidecarManager;
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

        case 'reviewDiff':
          vscode.commands.executeCommand('trueforge.acceptHunk');
          break;
      }
    });

    // Start background status poll
    this.statusInterval = setInterval(() => {
      this.broadcastStatus();
    }, 4000);

    webviewView.onDidDispose(() => {
      if (this.statusInterval) clearInterval(this.statusInterval);
    });
  }

  public async broadcastStatus(): Promise<void> {
    if (!this.view) return;
    const tfOk = await this.trueforgeClient.isHealthy();
    const scOk = await this.sidecarManager.isHealthy();
    const pendingEdits = await this.sidecarManager.getPendingEdits();

    this.view.webview.postMessage({
      type: 'statusUpdate',
      trueforge: tfOk ? 'connected' : 'offline',
      sidecar: scOk ? 'healthy' : 'offline',
      pendingEdits: pendingEdits.length,
    });
  }

  private async handleUserPrompt(userPrompt: string): Promise<void> {
    if (!this.view) return;
    const config = ConfigLoader.getConfig();

    this.abortController = new AbortController();

    try {
      if (!this.currentSessionId) {
        const session = await this.trueforgeClient.createSession({
          spec: {
            model: { name: config.models.primary.modelId },
            instructions: 'You are TrueForge Coding Agent. Help the user concisely.',
          },
        });
        this.currentSessionId = session.id;
      }

      this.view.webview.postMessage({ type: 'turnCreated', turnId: Date.now().toString() });

      await this.trueforgeClient.createTurnStream(
        this.currentSessionId,
        [{ type: 'user.message', content: userPrompt }],
        (event: TrueForgeEvent) => {
          if (!this.view) return;

          if (event.type === 'model.message.delta' && event.content) {
            this.view.webview.postMessage({ type: 'tokenDelta', content: event.content });
          } else if (event.type === 'model.message' && event.tool_calls) {
            for (const tc of event.tool_calls) {
              this.view.webview.postMessage({
                type: 'toolCall',
                toolName: tc.function?.name || tc.tool_info?.name || 'tool',
                args: tc.function?.arguments,
              });
            }
          }
        },
        this.abortController.signal
      );

      this.view.webview.postMessage({ type: 'turnDone' });
    } catch (err: any) {
      this.view.webview.postMessage({
        type: 'error',
        message: err.message || 'Error communicating with TrueForge',
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

