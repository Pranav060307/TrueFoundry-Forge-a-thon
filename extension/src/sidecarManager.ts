import * as child_process from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

export class SidecarManager {
  private process: child_process.ChildProcess | null = null;
  private port: number = 4545;
  private isStopping: boolean = false;
  private outputChannel: vscode.OutputChannel;
  private workspaceRoot: string;

  constructor(outputChannel: vscode.OutputChannel, workspaceRoot: string, port: number = 4545) {
    this.outputChannel = outputChannel;
    this.workspaceRoot = workspaceRoot;
    this.port = port;
  }

  public getBaseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  public async start(): Promise<boolean> {
    this.isStopping = false;
    const pythonPath = vscode.workspace.getConfiguration('trueforge').get<string>('pythonPath') || 'python';
    const backendScript = path.join(this.workspaceRoot, 'backend', 'main.py');

    this.outputChannel.appendLine(`[SidecarManager] Starting Python sidecar on port ${this.port}...`);
    this.outputChannel.appendLine(`[SidecarManager] Python: ${pythonPath}, Script: ${backendScript}`);

    try {
      this.process = child_process.spawn(
        pythonPath,
        [backendScript, '--port', String(this.port), '--workspace', this.workspaceRoot],
        {
          cwd: this.workspaceRoot,
          env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
            WORKSPACE_ROOT: this.workspaceRoot,
          },
        }
      );

      this.process.stdout?.on('data', (data) => {
        this.outputChannel.append(`[Sidecar stdout] ${data.toString()}`);
      });

      this.process.stderr?.on('data', (data) => {
        this.outputChannel.append(`[Sidecar stderr] ${data.toString()}`);
      });

      this.process.on('close', (code) => {
        this.outputChannel.appendLine(`[Sidecar] Process exited with code ${code}`);
        this.process = null;
        if (!this.isStopping) {
          this.outputChannel.appendLine('[Sidecar] Unexpected exit. Will attempt restart on next query.');
        }
      });

      // Poll /health until online
      const healthy = await this.waitForHealth(8000);
      if (healthy) {
        this.outputChannel.appendLine('[SidecarManager] Python sidecar is ONLINE and healthy.');
      } else {
        this.outputChannel.appendLine('[SidecarManager] Warning: Python sidecar health check timed out.');
      }
      return healthy;
    } catch (err: any) {
      this.outputChannel.appendLine(`[SidecarManager] Error starting sidecar: ${err.message}`);
      return false;
    }
  }

  public async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.getBaseUrl()}/health`, {
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok) {
        const json = await res.json() as any;
        return json.status === 'healthy';
      }
      return false;
    } catch {
      return false;
    }
  }

  public async getPendingEdits(): Promise<any[]> {
    try {
      const res = await fetch(`${this.getBaseUrl()}/api/pending_edits`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const json = await res.json() as { pending_edits: any[] };
        return json.pending_edits || [];
      }
      return [];
    } catch {
      return [];
    }
  }

  public async clearPendingEdits(filePath?: string): Promise<void> {
    try {
      await fetch(`${this.getBaseUrl()}/api/pending_edits/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath }),
      });
    } catch (e) {
      console.warn('[SidecarManager] Failed to clear pending edits:', e);
    }
  }

  public stop(): void {
    this.isStopping = true;
    if (this.process) {
      this.outputChannel.appendLine('[SidecarManager] Stopping Python sidecar...');
      if (process.platform === 'win32') {
        try {
          child_process.execSync(`taskkill /pid ${this.process.pid} /T /F`);
        } catch {
          this.process.kill();
        }
      } else {
        this.process.kill('SIGTERM');
      }
      this.process = null;
    }
  }

  private async waitForHealth(timeoutMs: number): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      if (await this.isHealthy()) {
        return true;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    return false;
  }
}

