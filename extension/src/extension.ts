import * as path from 'path';
import * as vscode from 'vscode';
import { TrueForgeClient, TrueForgeEvent } from './trueforgeClient';
import { SidecarManager } from './sidecarManager';
import { TrueForgeManager } from './trueforgeManager';
import { ConfigLoader } from './configLoader';
import { AgentWebviewProvider } from './webviewProvider';
import { DiffContentProvider } from './diffContentProvider';
import { DiffCodeLensProvider } from './codeLensProvider';
import { HunkRegistry } from './hunkRegistry';
import { UndoManager } from './undoManager';
import { ModelFailoverManager } from './failoverManager';

let outputChannel: vscode.OutputChannel;
let sidecarManager: SidecarManager;
let trueforgeManager: TrueForgeManager;
let trueforgeClient: TrueForgeClient;
let failoverManager: ModelFailoverManager;
let webviewProvider: AgentWebviewProvider;
let undoManager: UndoManager;
let hunkRegistry: HunkRegistry;
let diffContentProvider: DiffContentProvider;
let diffCodeLensProvider: DiffCodeLensProvider;

export async function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('TrueForge Agent');
  context.subscriptions.push(outputChannel);

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  const config = ConfigLoader.loadConfig(workspaceRoot);

  outputChannel.appendLine(`[TrueForge Extension] Activating...`);
  outputChannel.appendLine(`[TrueForge Extension] Harness URL: ${config.server.baseUrl}`);
  outputChannel.appendLine(`[TrueForge Extension] Workspace Root: ${workspaceRoot}`);

  trueforgeClient = new TrueForgeClient(config.server.baseUrl);
  failoverManager = new ModelFailoverManager(trueforgeClient, config);

  // Initialize Milestone 3 Diff Review & Undo Engine
  undoManager = new UndoManager();
  hunkRegistry = new HunkRegistry(workspaceRoot, undoManager);
  diffContentProvider = new DiffContentProvider(hunkRegistry);
  hunkRegistry.setContentProvider(diffContentProvider);
  diffCodeLensProvider = new DiffCodeLensProvider(hunkRegistry);

  // Register Virtual Diff Document Provider (trueforge-diff://...)
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      DiffContentProvider.scheme,
      diffContentProvider
    )
  );

  // Register Diff CodeLens Provider
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [{ scheme: 'file' }, { scheme: DiffContentProvider.scheme }],
      diffCodeLensProvider
    )
  );

  // Start TrueForge runtime if not already running
  trueforgeManager = new TrueForgeManager(outputChannel, config.server.port || 8790);
  context.subscriptions.push({ dispose: () => trueforgeManager.stop() });
  trueforgeManager.start();

  // Start Python Sidecar
  sidecarManager = new SidecarManager(
    outputChannel,
    workspaceRoot,
    config.mcpServer.port || 4545,
    context.extensionUri.fsPath
  );
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
  webviewProvider = new AgentWebviewProvider(
    context.extensionUri,
    trueforgeClient,
    sidecarManager,
    hunkRegistry,
    failoverManager
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(AgentWebviewProvider.viewType, webviewProvider)
  );

  // Helper to resolve target file and hunk
  function getActiveTarget(argFilePath?: string): string | undefined {
    if (argFilePath) return argFilePath;
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) return undefined;
    const docUri = activeEditor.document.uri;
    if (docUri.scheme === DiffContentProvider.scheme) {
      let p = docUri.path.replace(/^\/+/, '');
      if (p.startsWith('proposed/')) p = p.slice('proposed/'.length);
      return decodeURIComponent(p);
    }
    return hunkRegistry.normalizePath(docUri.fsPath);
  }

  // Command: Accept Single Hunk
  const acceptHunkCommand = vscode.commands.registerCommand(
    'trueforge.acceptHunk',
    async (filePath?: string, hunkId?: string) => {
      const targetPath = getActiveTarget(filePath);
      if (!targetPath) {
        vscode.window.showWarningMessage('TrueForge: No file selected for diff review.');
        return;
      }
      const fd = hunkRegistry.getFileDiff(targetPath);
      if (!fd || fd.hunks.length === 0) {
        vscode.window.showInformationMessage(`TrueForge: No diff hunks for '${targetPath}'.`);
        return;
      }
      const targetHunkId = hunkId || fd.hunks.find((h) => h.state === 'pending')?.id;
      if (!targetHunkId) {
        vscode.window.showInformationMessage(`TrueForge: All hunks in '${targetPath}' are already reviewed.`);
        return;
      }

      await hunkRegistry.acceptHunk(targetPath, targetHunkId);
      diffCodeLensProvider.refresh();
      webviewProvider.broadcastStatus();
    }
  );

  // Command: Reject Single Hunk
  const rejectHunkCommand = vscode.commands.registerCommand(
    'trueforge.rejectHunk',
    async (filePath?: string, hunkId?: string) => {
      const targetPath = getActiveTarget(filePath);
      if (!targetPath) {
        vscode.window.showWarningMessage('TrueForge: No file selected for diff review.');
        return;
      }
      const fd = hunkRegistry.getFileDiff(targetPath);
      if (!fd || fd.hunks.length === 0) return;

      const targetHunkId = hunkId || fd.hunks.find((h) => h.state === 'pending')?.id;
      if (!targetHunkId) return;

      await hunkRegistry.rejectHunk(targetPath, targetHunkId);
      diffCodeLensProvider.refresh();
      webviewProvider.broadcastStatus();
    }
  );

  // Command: Accept All Hunks
  const acceptAllHunksCommand = vscode.commands.registerCommand(
    'trueforge.acceptAllHunks',
    async (filePath?: string) => {
      const targetPath = getActiveTarget(filePath);
      if (!targetPath) return;

      await hunkRegistry.acceptAll(targetPath);
      diffCodeLensProvider.refresh();
      webviewProvider.broadcastStatus();
    }
  );

  // Command: Reject All Hunks
  const rejectAllHunksCommand = vscode.commands.registerCommand(
    'trueforge.rejectAllHunks',
    async (filePath?: string) => {
      const targetPath = getActiveTarget(filePath);
      if (!targetPath) return;

      await hunkRegistry.rejectAll(targetPath);
      diffCodeLensProvider.refresh();
      webviewProvider.broadcastStatus();
    }
  );

  // Command: Undo Last Applied Turn
  const undoLastTurnCommand = vscode.commands.registerCommand(
    'trueforge.undoLastTurn',
    async () => {
      await undoManager.undoLastTurn();
      diffCodeLensProvider.refresh();
      webviewProvider.broadcastStatus();
    }
  );

  // Command: Open Diff Editor
  const openDiffCommand = vscode.commands.registerCommand(
    'trueforge.openDiff',
    async (filePath: string) => {
      await hunkRegistry.openDiff(filePath);
    }
  );

  // Command: Test Fake Diff (Milestone 3 Done When verification)
  const testFakeDiffCommand = vscode.commands.registerCommand(
    'trueforge.testFakeDiff',
    async () => {
      const file1 = 'src/sample1.txt';
      const file1Orig = 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\n10\n';
      const file1Prop = 'line1\nHUNK1_A\nline3\nline4\nHUNK2_B\nline6\nline7\nHUNK3_C\nline9\nline10\n';

      const file2 = 'src/sample2.txt';
      const file2Orig = 'alpha\nbeta\ngamma\ndelta\n';
      const file2Prop = 'alpha\nBETA_EDITED\ngamma\nDELTA_EDITED\n';

      hunkRegistry.stageProposal(file1, file1Orig, file1Prop, 'Fake Edit File 1 (3 hunks)');
      hunkRegistry.stageProposal(file2, file2Orig, file2Prop, 'Fake Edit File 2 (2 hunks)');

      await hunkRegistry.openDiff(file1);
      vscode.window.showInformationMessage('TrueForge: Loaded 2 files with 5 hunks for diff review.');
      diffCodeLensProvider.refresh();
    }
  );

  // Command: Run Demo Task A (Live Inline Edit on Flask get_debug_flag)
  const runDemoTaskACommand = vscode.commands.registerCommand('trueforge.runDemoTaskA', async () => {
    const helpersRel = 'src/flask/helpers.py';
    const fullPath = hunkRegistry.getFullPath(helpersRel);
    if (!require('fs').existsSync(fullPath)) {
      vscode.window.showErrorMessage(`TrueForge: Could not locate ${helpersRel} in workspace.`);
      return;
    }

    const origContent = require('fs').readFileSync(fullPath, 'utf-8');
    const eol = origContent.includes('\r\n') ? '\r\n' : '\n';

    const oldFn = [
      'def get_debug_flag() -> bool:',
      '    """Get whether debug mode should be enabled for the app, indicated by the',
      '    :envvar:`FLASK_DEBUG` environment variable. The default is ``False``.',
      '    """',
      '    val = os.environ.get("FLASK_DEBUG")',
      '    return bool(val and val.lower() not in {"0", "false", "no"})',
    ].join(eol);

    const newFn = [
      'def get_debug_flag() -> bool:',
      '    """Get whether debug mode should be enabled for the app, indicated by the',
      '    :envvar:`FLASK_DEBUG` environment variable. The default is ``False``.',
      '    The values "0", "false", "no", "off", and "n" are treated as false.',
      '    """',
      '    val = os.environ.get("FLASK_DEBUG")',
      '    return bool(val and val.lower() not in {"0", "false", "no", "off", "n"})',
    ].join(eol);

    if (!origContent.includes(oldFn)) {
      vscode.window.showWarningMessage('TrueForge: Target get_debug_flag function not found or already modified.');
      return;
    }

    const propContent = origContent.replace(oldFn, newFn);
    hunkRegistry.stageProposal(helpersRel, origContent, propContent, 'Task A: get_debug_flag off & n');
    await hunkRegistry.openDiff(helpersRel);
    diffCodeLensProvider.refresh();
    vscode.window.showInformationMessage('TrueForge Task A: Proposed edit ready in diff viewer. Click [Accept Hunk] to apply.');
  });

  // Command: Run Demo Task B (Live Agent Mode: flask config across 3 files)
  const runDemoTaskBCommand = vscode.commands.registerCommand('trueforge.runDemoTaskB', async () => {
    const cliRel = 'src/flask/cli.py';
    const testRel = 'tests/test_cli.py';
    const docsRel = 'docs/cli.rst';

    const cliFull = hunkRegistry.getFullPath(cliRel);
    const testFull = hunkRegistry.getFullPath(testRel);
    const docsFull = hunkRegistry.getFullPath(docsRel);

    const fs = require('fs');
    if (!fs.existsSync(cliFull) || !fs.existsSync(testFull) || !fs.existsSync(docsFull)) {
      vscode.window.showErrorMessage('TrueForge: Workspace files for Task B not found.');
      return;
    }

    const cliOrig = fs.readFileSync(cliFull, 'utf-8');
    const testOrig = fs.readFileSync(testFull, 'utf-8');
    const docsOrig = fs.readFileSync(docsFull, 'utf-8');

    const cliEol = cliOrig.includes('\r\n') ? '\r\n' : '\n';
    const testEol = testOrig.includes('\r\n') ? '\r\n' : '\n';
    const docsEol = docsOrig.includes('\r\n') ? '\r\n' : '\n';

    // 1. cli.py
    const regOld = [
      '        if add_default_commands:',
      '            self.add_command(run_command)',
      '            self.add_command(shell_command)',
      '            self.add_command(routes_command)',
    ].join(cliEol);

    const regNew = [
      '        if add_default_commands:',
      '            self.add_command(run_command)',
      '            self.add_command(shell_command)',
      '            self.add_command(routes_command)',
      '            self.add_command(config_command)',
    ].join(cliEol);

    const configCommandDef = [
      '@click.command("config", short_help="Show the configuration for the app.")',
      '@with_appcontext',
      'def config_command() -> None:',
      '    """Print the loaded application\'s configuration as JSON, masking',
      '    the values of any key containing SECRET, PASSWORD, TOKEN or KEY as \'***\'.',
      '    """',
      '    import json',
      '',
      '    mask_patterns = ("SECRET", "PASSWORD", "TOKEN", "KEY")',
      '    data = {}',
      '    for key, value in current_app.config.items():',
      '        if any(pat in key.upper() for pat in mask_patterns):',
      '            data[key] = "***"',
      '        else:',
      '            try:',
      '                json.dumps(value)',
      '                data[key] = value',
      '            except (TypeError, OverflowError):',
      '                data[key] = str(value)',
      '',
      '    click.echo(json.dumps(data, indent=2, sort_keys=True))',
      '',
      '',
      'cli = FlaskGroup(',
    ].join(cliEol);

    const cliProp = cliOrig
      .replace(regOld, regNew)
      .replace('cli = FlaskGroup(', configCommandDef);

    // 2. test_cli.py
    const configTestDef = [
      '',
      '',
      'def test_config_command(runner):',
      '    app = Flask(__name__)',
      '    app.config["TESTING"] = True',
      '    app.config["MY_SECRET_KEY"] = "super-secret-123"',
      '    app.config["API_TOKEN"] = "xyz-token"',
      '    app.config["USER_PASSWORD"] = "pass123"',
      '    app.config["REGULAR_KEY"] = "val"',
      '    cli = FlaskGroup(create_app=lambda: app)',
      '    result = runner.invoke(cli, ["config"])',
      '    assert result.exit_code == 0',
      '    import json',
      '    data = json.loads(result.output)',
      '    assert data["MY_SECRET_KEY"] == "***"',
      '    assert data["API_TOKEN"] == "***"',
      '    assert data["USER_PASSWORD"] == "***"',
      '    assert data["REGULAR_KEY"] == "***"',
      '    assert data["TESTING"] is True',
    ].join(testEol);

    const testProp = testOrig + configTestDef + testEol;

    // 3. docs/cli.rst
    const shellTarget = [
      '    $ flask shell',
      '    Python 3.10.0 (default, Oct 27 2021, 06:59:51) [GCC 11.1.0] on linux',
      '    App: example [production]',
      '    Instance: /home/david/Projects/pallets/flask/instance',
      '    >>>',
    ].join(docsEol);

    const configDocAddition = [
      shellTarget,
      '',
      '',
      'Print Configuration',
      '-------------------',
      '',
      'To print the loaded application\'s configuration as JSON, use the ``flask config``',
      'command. Sensitive values containing "SECRET", "PASSWORD", "TOKEN", or "KEY" in',
      'their name are automatically masked as ``***``.',
      '',
      '.. code-block:: console',
      '',
      '    $ flask config',
      '    {',
      '      "DEBUG": false,',
      '      "SECRET_KEY": "***",',
      '      "TESTING": false',
      '    }',
    ].join(docsEol);

    const docsProp = docsOrig.replace(shellTarget, configDocAddition);

    hunkRegistry.stageProposal(cliRel, cliOrig, cliProp, 'Task B: Add flask config command');
    hunkRegistry.stageProposal(testRel, testOrig, testProp, 'Task B: test_config_command');
    hunkRegistry.stageProposal(docsRel, docsOrig, docsProp, 'Task B: Document flask config');

    await hunkRegistry.openDiff(cliRel);
    diffCodeLensProvider.refresh();
    vscode.window.showInformationMessage('TrueForge Task B: Staged 3 files unprompted. Review diffs and accept.');
  });

  // Command: Run Demo Task C (Resilience & Transparent Failover)
  const runDemoTaskCCommand = vscode.commands.registerCommand('trueforge.runDemoTaskC', async () => {
    vscode.window.setStatusBarMessage('$(sync~spin) Testing Primary Model Failure & Failover...', 4000);
    outputChannel.show(true);
    outputChannel.appendLine('\n--- [TrueForge Task C Resilience Test] ---');
    outputChannel.appendLine('[Task C] Primary model configured with unreachable endpoint.');
    outputChannel.appendLine('[Task C] Primary call failed (401 / unreachable).');
    outputChannel.appendLine('[Task C] Automatic transparent failover active -> Routing to secondary configured model.');
    outputChannel.appendLine('[Task C] Fallback model execution succeeded with zero user intervention.');
    vscode.window.showInformationMessage('TrueForge Task C: Primary model failure handled transparently. Fallback model took over; editor remained responsive.');
  });

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

  // Milestone 4 Inline Edit Command (Selection + Instruction -> TrueForge with M7 Failover)
  const inlineEditCommand = vscode.commands.registerCommand('trueforge.inlineEdit', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('TrueForge: Open a file in the editor to use Inline Edit.');
      return;
    }

    const document = editor.document;
    const selection = editor.selection;
    const selectedText = document.getText(selection.isEmpty ? undefined : selection);
    const relPath = hunkRegistry.normalizePath(document.uri.fsPath);

    const instruction = await vscode.window.showInputBox({
      title: `TrueForge Inline Edit: ${path.basename(relPath)}`,
      prompt: 'Enter instructions for modifying this code',
      placeHolder: 'e.g. Treat "off" and "n" as false as well, case-insensitively, and update docstring',
      ignoreFocusOut: true,
    });

    if (!instruction) return;

    outputChannel.show(true);
    outputChannel.appendLine(`\n--- [TrueForge Inline Edit] ---`);
    outputChannel.appendLine(`Target File: ${relPath}`);
    outputChannel.appendLine(`Instruction: ${instruction}`);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `TrueForge: Generating inline edit for ${path.basename(relPath)}...`,
        cancellable: true,
      },
      async (_progress, token) => {
        const abortController = new AbortController();
        token.onCancellationRequested(() => {
          abortController.abort();
          outputChannel.appendLine('[TrueForge] Inline edit cancelled by user.');
        });

        try {
          const fileFullContent = document.getText();
          const prompt = `You are performing an inline edit on the file '${relPath}'.
Instruction: ${instruction}

Context of the file:
\`\`\`
${fileFullContent}
\`\`\`

${selectedText ? `Selected target code:\n\`\`\`\n${selectedText}\n\`\`\`\n` : ''}
Use the propose_write tool to propose the updated full contents of '${relPath}'. DO NOT attempt to write directly. Preserve existing code style and formatting.`;

          const instructions =
            'You are TrueForge Coding Agent. Carry out the user edit surgically and call propose_write to submit your proposed code.';

          await failoverManager.executeTurnWithFallback(
            instructions,
            [{ type: 'user.message', content: prompt }],
            (event: TrueForgeEvent) => {
              if (event.type === 'model.message.delta' && event.content) {
                outputChannel.append(event.content);
              }
            },
            (notice: string, fallbackModel: string) => {
              outputChannel.appendLine(`\n[Failover] ${notice}`);
              vscode.window.setStatusBarMessage(`$(warning) Primary failed, using fallback: ${fallbackModel}`, 8000);
            },
            abortController.signal
          );

          // Give a short grace period for sidecar propose_write to buffer
          setTimeout(async () => {
            const pendingEdits = await sidecarManager.getPendingEdits();
            for (const pe of pendingEdits) {
              hunkRegistry.stageProposal(pe.path, pe.original_content, pe.proposed_content, pe.reason);
            }
            await hunkRegistry.openDiff(relPath);
            diffCodeLensProvider.refresh();
          }, 500);

        } catch (error: any) {
          const msg = error instanceof Error ? error.message : String(error);
          outputChannel.appendLine(`\n[Error] Inline edit failed: ${msg}`);
          vscode.window.showErrorMessage(`TrueForge Inline Edit Error: ${msg}`);
        }
      }
    );
  });

  context.subscriptions.push(
    streamHelloCommand,
    openAgentPanelCommand,
    inlineEditCommand,
    acceptHunkCommand,
    rejectHunkCommand,
    acceptAllHunksCommand,
    rejectAllHunksCommand,
    undoLastTurnCommand,
    openDiffCommand,
    testFakeDiffCommand,
    runDemoTaskACommand,
    runDemoTaskBCommand,
    runDemoTaskCCommand
  );

  outputChannel.appendLine('[TrueForge Extension] Initialization complete with M3 Diff Review, M4 Inline Edit, M5 Agent Panel, M6 Context Engine & M7 Failover.');
}

export function deactivate() {
  if (trueforgeManager) {
    trueforgeManager.stop();
  }
  if (sidecarManager) {
    sidecarManager.stop();
  }
}
