import * as vscode from 'vscode';
import { TrueForgeClient, TrueForgeEvent } from './agent/TrueForgeClient';
import { ConfigManager } from './config/configManager';

let outputChannel: vscode.OutputChannel;
let client: TrueForgeClient;

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('TrueForge Agent');
  context.subscriptions.push(outputChannel);

  const config = ConfigManager.loadConfig(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
  client = new TrueForgeClient(config.server.baseUrl);

  outputChannel.appendLine(`[TrueForge Extension] Activated. Harness Base URL: ${client.getBaseUrl()}`);

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
      async (progress, token) => {
        const abortController = new AbortController();
        token.onCancellationRequested(() => {
          abortController.abort();
          outputChannel.appendLine('\n[TrueForge] Stream cancelled by user.');
        });

        try {
          outputChannel.appendLine(`[1/3] Creating session on ${client.getBaseUrl()}...`);
          const session = await client.createSession({
            spec: {
              model: { name: config.models.primary.modelId },
              instructions: 'You are TrueForge Coding Agent. Respond briefly and concisely.',
            },
          });

          outputChannel.appendLine(`[2/3] Session established (id: ${session.id}). Starting streaming turn...`);

          let tokenCount = 0;
          const finalEvent = await client.createTurnStream(
            session.id,
            [
              {
                type: 'user.message',
                content: 'Say hello and introduce yourself in one sentence as TrueForge Coding Agent.',
              },
            ],
            (event: TrueForgeEvent) => {
              if (event.type === 'model.message.delta' && event.content) {
                tokenCount++;
                outputChannel.append(event.content);
              } else if (event.type === 'turn.created') {
                outputChannel.appendLine(`[Turn Created: ${event.turn_id}]`);
                outputChannel.append('Agent Response: ');
              }
            },
            abortController.signal
          );

          outputChannel.appendLine(`\n[3/3] Turn completed with status: ${finalEvent.state?.status ?? 'done'}`);
          vscode.window.showInformationMessage(`TrueForge Agent connected successfully! Received stream.`);
        } catch (error: any) {
          const msg = error instanceof Error ? error.message : String(error);
          outputChannel.appendLine(`\n[Error] TrueForge call failed: ${msg}`);
          vscode.window.showErrorMessage(`TrueForge Error: ${msg}`);
        }
      }
    );
  });

  // Placeholder commands for subsequent milestones (M2-M7)
  const openAgentPanelCommand = vscode.commands.registerCommand('trueforge.openAgentPanel', () => {
    outputChannel.appendLine('[TrueForge] Opening Agent Panel (M5)...');
    vscode.window.showInformationMessage('TrueForge Agent Panel will be available in Milestone 5.');
  });

  const inlineEditCommand = vscode.commands.registerCommand('trueforge.inlineEdit', () => {
    outputChannel.appendLine('[TrueForge] Triggering Inline Edit (M4)...');
    vscode.window.showInformationMessage('TrueForge Inline Edit will be available in Milestone 4.');
  });

  const acceptHunkCommand = vscode.commands.registerCommand('trueforge.acceptHunk', () => {
    outputChannel.appendLine('[TrueForge] Accept Hunk (M3)...');
  });

  const rejectHunkCommand = vscode.commands.registerCommand('trueforge.rejectHunk', () => {
    outputChannel.appendLine('[TrueForge] Reject Hunk (M3)...');
  });

  const acceptAllHunksCommand = vscode.commands.registerCommand('trueforge.acceptAllHunks', () => {
    outputChannel.appendLine('[TrueForge] Accept All Hunks (M3)...');
  });

  const rejectAllHunksCommand = vscode.commands.registerCommand('trueforge.rejectAllHunks', () => {
    outputChannel.appendLine('[TrueForge] Reject All Hunks (M3)...');
  });

  const undoLastTurnCommand = vscode.commands.registerCommand('trueforge.undoLastTurn', () => {
    outputChannel.appendLine('[TrueForge] Undo Last Turn (M3)...');
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
}

export function deactivate() {
  if (outputChannel) {
    outputChannel.dispose();
  }
}
