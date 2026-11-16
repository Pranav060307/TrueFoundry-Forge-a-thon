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

    const resourceRoots = [
      this.extensionUri,
      vscode.Uri.file(path.join(this.extensionUri.fsPath, '..', 'webview', 'dist')),
      vscode.Uri.file(path.join(this.extensionUri.fsPath, 'webview-dist')),
      vscode.Uri.file(path.join(this.extensionUri.fsPath, 'webview', 'dist')),
    ];

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: resourceRoots,
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
          await this.broadcastStatus();
          break;

        case 'rejectAll':
          await vscode.commands.executeCommand('trueforge.rejectAllHunks');
          await this.broadcastStatus();
          break;

        case 'acceptHunk':
          await vscode.commands.executeCommand('trueforge.acceptHunk', message.filePath, message.hunkId);
          await this.broadcastStatus();
          break;

        case 'rejectHunk':
          await vscode.commands.executeCommand('trueforge.rejectHunk', message.filePath, message.hunkId);
          await this.broadcastStatus();
          break;

        case 'openDiff':
          if (message.filePath) {
            await this.hunkRegistry.openDiff(message.filePath);
          }
          break;

        case 'undoLastTurn':
          await vscode.commands.executeCommand('trueforge.undoLastTurn');
          await this.broadcastStatus();
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
    const allDiffs = this.hunkRegistry.getAllFileDiffs();
    const stagedFiles = allDiffs.map((fd) => ({
      filePath: fd.filePath,
      reason: fd.reason,
      totalHunks: fd.hunks.length,
      pendingCount: fd.hunks.filter((h) => h.state === 'pending').length,
      hunks: fd.hunks.map((h) => ({
        id: h.id,
        filePath: h.filePath,
        oldStart: h.oldStart,
        oldLinesCount: h.oldLinesCount,
        newStart: h.newStart,
        newLinesCount: h.newLinesCount,
        originalLines: h.originalLines,
        proposedLines: h.proposedLines,
        state: h.state,
      })),
    }));

    let modelInfo: any = {};
    try {
      const cfg = ConfigLoader.load();
      modelInfo = {
        primary: cfg.models.primary.modelId,
        fallback: cfg.models.fallback?.modelId,
      };
    } catch {
      // ignore
    }

    this.view.webview.postMessage({
      type: 'statusUpdate',
      trueforge: tfOk ? 'connected' : 'offline',
      sidecar: scOk ? 'healthy' : 'offline',
      pendingEdits: pendingCount,
      stagedFiles,
      models: modelInfo,
    });
  }

  private async handleUserPrompt(userPrompt: string): Promise<void> {
    if (!this.view) return;

    this.abortController = new AbortController();
    const turnId = `turn-${Date.now()}`;
    this.hunkRegistry.setTurnId(turnId);

    const turnStartTime = Date.now();
    let totalTokens = 0;
    const toolTimes = new Map<string, number>();

    try {
      this.view.webview.postMessage({ type: 'turnCreated', turnId });

      const activeEditor = vscode.window.activeTextEditor;
      let activeContext = '';
      if (activeEditor) {
        const rel = this.hunkRegistry.normalizePath(activeEditor.document.uri.fsPath);
        if (rel && !rel.startsWith('..')) {
          activeContext = `[Active Editor: ${rel}]\n`;
        }
      }

      const instructions =
        'You are TrueForge Coding Agent embedded in VS Code. ' +
        'CRITICAL RULES:\n' +
        '1. When asked to inspect or edit a file, call read_file on that file first.\n' +
        '2. Then IMMEDIATELY submit the modification by calling propose_write(path, content, reason) with the updated full content or target block.\n' +
        '3. NEVER just print code in chat without calling propose_write.\n' +
        '4. Do NOT perform unnecessary searches or commands when the target file is specified.';

      const promptContent = `${activeContext}${userPrompt}`;

      const result = await this.failoverManager.executeTurnWithFallback(
        instructions,
        [{ type: 'user.message', content: promptContent }],
        (event: TrueForgeEvent) => {
          if (!this.view) return;

          if (event.type === 'model.message.delta' && event.content) {
            const added = Math.max(1, Math.round(event.content.length / 4));
            totalTokens += added;
            const elapsedSec = Math.max(0.5, (Date.now() - turnStartTime) / 1000);
            const speed = Math.round(totalTokens / elapsedSec);
            this.view.webview.postMessage({
              type: 'tokenDelta',
              content: event.content,
              totalTokens,
              speed,
            });
          } else if (event.type === 'model.message' && event.tool_calls) {
            for (const tc of event.tool_calls) {
              let toolName = tc.function?.name || tc.tool_info?.name || 'tool';
              let toolArgs = tc.function?.arguments;

              // TrueForge wraps MCP calls in call_tool
              if (toolName === 'call_tool' && toolArgs) {
                try {
                  const parsed = typeof toolArgs === 'string' ? JSON.parse(toolArgs) : toolArgs;
                  if (parsed.tool_name) {
                    toolName = parsed.tool_name;
                    toolArgs = parsed.input || {};
                  }
                } catch {
                  // ignore
                }
              }

              toolTimes.set(toolName, Date.now());
              this.view.webview.postMessage({
                type: 'toolCall',
                toolName,
                args: toolArgs,
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
          } else if (event.type === 'tool.response' || event.type === 'tool.result') {
            const toolName = (event as any).tool_info?.name || (event as any).tool || 'tool';
            const duration = toolTimes.has(toolName) ? Date.now() - toolTimes.get(toolName)! : undefined;
            this.view.webview.postMessage({
              type: 'toolResult',
              toolName,
              duration,
              result: (event as any).content || 'Completed successfully',
            });
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
    const candidates = [
      path.join(this.extensionUri.fsPath, '..', 'webview', 'dist'),
      path.join(this.extensionUri.fsPath, 'webview-dist'),
      path.join(this.extensionUri.fsPath, 'webview', 'dist'),
    ];
    const webviewDist = candidates.find((p) => fs.existsSync(path.join(p, 'index.html'))) || candidates[0];
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
