import * as vscode from 'vscode';
import { TrueForgeClient, TrueForgeEvent } from './trueforgeClient';
import { SidecarManager } from './sidecarManager';
import { TrueForgeManager } from './trueforgeManager';
import { ConfigLoader } from './configLoader';
import { AgentWebviewProvider } from './webviewProvider';

let outputChannel: vscode.OutputChannel;
let sidecarManager: SidecarManager;
let trueforgeManager: TrueForgeManager;
let trueforgeClient: TrueForgeClient;
let webviewProvider: AgentWebviewProvider;

export async function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('TrueForge Agent');
  context.subscriptions.push(outputChannel);

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  const config = ConfigLoader.loadConfig(workspaceRoot);

  outputChannel.appendLine(`[TrueForge Extension] Activating...`);
  outputChannel.appendLine(`[TrueForge Extension] Harness URL: ${config.server.baseUrl}`);
  outputChannel.appendLine(`[TrueForge Extension] Workspace Root: ${workspaceRoot}`);

  trueforgeClient = new TrueForgeClient(config.server.baseUrl);

  // Start TrueForge runtime if not already running
  trueforgeManager = new TrueForgeManager(outputChannel, config.server.port || 8790);
  context.subscriptions.push({ dispose: () => trueforgeManager.stop() });
  trueforgeManager.start();

  // Start Python Sidecar
  sidecarManager = new SidecarManager(outputChannel, workspaceRoot, config.mcpServer.port || 4545);
  context.subscriptions.push({ dispose: () => sidecarManager.stop() });

  // Launch sidecar in background and register MCP with TrueForge
  sidecarManager.start().then(async (healthy) => {
    if (healthy) {
      vscode.window.showInformationMessage('TrueForge: Python MCP sidecar is online.');
      try {
        await fetch(`${config.server.baseUrl}/api/v1/settings/mcp-servers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            manifest: {
              type: 'remote',
              name: config.mcpServer.name || 'vscode-tools',
              url: config.mcpServer.url || 'http://127.0.0.1:4545/mcp',
              description: 'VS Code editor tools for reading, searching, proposing writes, and running commands',
            },
          }),
        });
        outputChannel.appendLine(`[TrueForge Extension] Registered MCP server with TrueForge at ${config.server.baseUrl}`);
      } catch (err) {
        outputChannel.appendLine(`[TrueForge Extension] TrueForge MCP registration notice: ${err}`);
      }
    } else {
      vscode.window.showWarningMessage('TrueForge: Python sidecar starting or offline.');
    }
  });

  // Register Webview Provider
  webviewProvider = new AgentWebviewProvider(context.extensionUri, trueforgeClient, sidecarManager);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(AgentWebviewProvider.viewType, webviewProvider)
  );

  // Command: Stream Hello Test (Milestone 1 Verification)
  const streamHelloCommand = vscode.commands.registerCommand('trueforge.streamHello', async () => {
    outputChannel.show(true);
    outputChannel.appendLine('\n--- [TrueForge Stream Hello Prompt] ---');

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'TrueForge: Connecting to local agent...',
        cancellable: true,
      },
      async (_progress, token) => {
        const abortController = new AbortController();
        token.onCancellationRequested(() => {
          abortController.abort();
          outputChannel.appendLine('\n[TrueForge] Stream cancelled by user.');
        });

        try {
          outputChannel.appendLine(`[1/3] Creating session on ${trueforgeClient.getBaseUrl()}...`);
          const session = await trueforgeClient.createSession({
            spec: {
              model: { name: config.models.primary.modelId },
              instructions: 'You are TrueForge Coding Agent. Respond briefly and concisely.',
            },
          });

          outputChannel.appendLine(`[2/3] Session established (id: ${session.id}). Starting streaming turn...`);

          const finalEvent = await trueforgeClient.createTurnStream(
            session.id,
            [
              {
                type: 'user.message',
                content: 'Say hello and introduce yourself in one sentence as TrueForge Coding Agent.',
              },
            ],
            (event: TrueForgeEvent) => {
              if (event.type === 'model.message.delta' && event.content) {
                outputChannel.append(event.content);
              } else if (event.type === 'turn.created') {
                outputChannel.appendLine(`[Turn Created: ${event.turn_id}]`);
                outputChannel.append('Agent Response: ');
              }
            },
            abortController.signal
          );

          outputChannel.appendLine(`\n[3/3] Turn completed with status: ${finalEvent.state?.status ?? 'done'}`);
          vscode.window.showInformationMessage(`TrueForge Agent connected successfully!`);
        } catch (error: any) {
          const msg = error instanceof Error ? error.message : String(error);
          outputChannel.appendLine(`\n[Error] TrueForge call failed: ${msg}`);
          vscode.window.showErrorMessage(`TrueForge Error: ${msg}`);
        }
      }
    );
  });

  const openAgentPanelCommand = vscode.commands.registerCommand('trueforge.openAgentPanel', () => {
    vscode.commands.executeCommand('workbench.view.extension.trueforge-explorer');
  });

  const inlineEditCommand = vscode.commands.registerCommand('trueforge.inlineEdit', () => {
    vscode.window.showInformationMessage('TrueForge: Inline Edit Selection (M4).');
  });

  const acceptHunkCommand = vscode.commands.registerCommand('trueforge.acceptHunk', () => {
    vscode.window.showInformationMessage('TrueForge: Accept Diff Hunk (M3).');
  });

  const rejectHunkCommand = vscode.commands.registerCommand('trueforge.rejectHunk', () => {
    vscode.window.showInformationMessage('TrueForge: Reject Diff Hunk (M3).');
  });

  const acceptAllHunksCommand = vscode.commands.registerCommand('trueforge.acceptAllHunks', () => {
    vscode.window.showInformationMessage('TrueForge: Accept All Hunks (M3).');
  });

  const rejectAllHunksCommand = vscode.commands.registerCommand('trueforge.rejectAllHunks', () => {
    vscode.window.showInformationMessage('TrueForge: Reject All Hunks (M3).');
  });

  const undoLastTurnCommand = vscode.commands.registerCommand('trueforge.undoLastTurn', () => {
    vscode.window.showInformationMessage('TrueForge: Undo Last Applied Turn (M3).');
  });

  context.subscriptions.push(
    streamHelloCommand,
    openAgentPanelCommand,
    inlineEditCommand,
    acceptHunkCommand,
    rejectHunkCommand,
    acceptAllHunksCommand,
    rejectAllHunksCommand,
    undoLastTurnCommand
  );

  outputChannel.appendLine('[TrueForge Extension] Initialization complete.');
}

export function deactivate() {
  if (trueforgeManager) {
    trueforgeManager.stop();
  }
  if (sidecarManager) {
    sidecarManager.stop();
  }
}
