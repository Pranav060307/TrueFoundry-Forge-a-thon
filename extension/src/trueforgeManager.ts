import * as child_process from 'child_process';
import * as vscode from 'vscode';

export class TrueForgeManager {
  private process: child_process.ChildProcess | null = null;
  private port: number = 8790;
  private isStopping: boolean = false;
  private outputChannel: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel, port: number = 8790) {
    this.outputChannel = outputChannel;
    this.port = port;
  }

  public getBaseUrl(): string {
    return `http://localhost:${this.port}`;
  }

  public async start(): Promise<boolean> {
    this.isStopping = false;

    // Check if TrueForge is already listening on this port
    if (await this.isHealthy()) {
      this.outputChannel.appendLine(`[TrueForgeManager] TrueForge is already running on port ${this.port}.`);
      return true;
    }

    this.outputChannel.appendLine(`[TrueForgeManager] Launching local TrueForge on port ${this.port} with SSRF bypass...`);

    try {
      const env = {
        ...process.env,
        NETWORK_POLICY_ENABLED: 'false',
        OUTBOUND_URL_ALLOWED_HOSTS: JSON.stringify(['127.0.0.1', 'localhost']),
        PORT: String(this.port),
        STANDALONE: 'true',
      };

      // Prefer npx @truefoundry/trueforge@latest
      const cmd = process.platform === 'win32' ? 'cmd.exe' : 'npx';
      const args = process.platform === 'win32'
        ? ['/c', 'npx', '@truefoundry/trueforge@latest', '--port', String(this.port)]
        : ['@truefoundry/trueforge@latest', '--port', String(this.port)];

      this.process = child_process.spawn(cmd, args, {
        env,
        shell: false,
      });

      this.process.stdout?.on('data', (data) => {
        this.outputChannel.append(`[TrueForge stdout] ${data.toString()}`);
      });

      this.process.stderr?.on('data', (data) => {
        this.outputChannel.append(`[TrueForge stderr] ${data.toString()}`);
      });

      this.process.on('close', (code) => {
        this.outputChannel.appendLine(`[TrueForgeManager] TrueForge exited with code ${code}`);
        this.process = null;
      });

      const healthy = await this.waitForHealth(15000);
      if (healthy) {
        this.outputChannel.appendLine(`[TrueForgeManager] TrueForge is online and healthy at ${this.getBaseUrl()}`);
      } else {
        this.outputChannel.appendLine(`[TrueForgeManager] TrueForge start timed out or still booting.`);
      }
      return healthy;
    } catch (err: any) {
      this.outputChannel.appendLine(`[TrueForgeManager] Failed to launch TrueForge: ${err.message}`);
      return false;
    }
  }

  public async isHealthy(): Promise<boolean> {
    for (const url of [`http://localhost:${this.port}`, `http://127.0.0.1:${this.port}`, `http://[::1]:${this.port}`]) {
      try {
        const res = await fetch(`${url}/api/v1/sessions`, {
          signal: AbortSignal.timeout(1500),
        });
        if (res.status < 500) {
          return true;
        }
      } catch {}
    }
    return false;
  }

  public stop(): void {
    this.isStopping = true;
    if (this.process) {
      this.outputChannel.appendLine('[TrueForgeManager] Stopping TrueForge...');
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
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.isHealthy()) {
        return true;
      }
      await new Promise((r) => setTimeout(r, 600));
    }
    return false;
  }
}

