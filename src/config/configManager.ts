import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export interface AppConfig {
  server: {
    port: number;
    baseUrl: string;
    networkPolicyEnabled: boolean;
  };
  models: {
    primary: {
      provider: string;
      modelId: string;
      apiKey?: string;
      params?: Record<string, any>;
    };
    fallback?: {
      provider: string;
      modelId: string;
      apiKey?: string;
      params?: Record<string, any>;
    };
  };
  mcpServer: {
    name: string;
    port: number;
    url: string;
  };
  agent: {
    name: string;
    description: string;
    iterationLimit: number;
    contextCompactionTokens: number;
  };
}

export class ConfigManager {
  private static cachedConfig: AppConfig | null = null;

  public static loadConfig(workspaceRoot?: string): AppConfig {
    const defaultExamplePath = path.join(__dirname, '..', 'trueforge', 'trueforge.config.example.json');
    let configPath = '';

    if (workspaceRoot) {
      const userConfig = path.join(workspaceRoot, 'trueforge.config.json');
      const exampleConfig = path.join(workspaceRoot, 'trueforge', 'trueforge.config.example.json');
      if (fs.existsSync(userConfig)) {
        configPath = userConfig;
      } else if (fs.existsSync(exampleConfig)) {
        configPath = exampleConfig;
      }
    }

    if (!configPath || !fs.existsSync(configPath)) {
      if (fs.existsSync(defaultExamplePath)) {
        configPath = defaultExamplePath;
      }
    }

    const vscodeBaseUrl = vscode.workspace.getConfiguration('trueforge').get<string>('serverUrl');
    const vscodeAgentName = vscode.workspace.getConfiguration('trueforge').get<string>('agentName');

    let parsed: AppConfig = {
      server: {
        port: 8790,
        baseUrl: vscodeBaseUrl || 'http://localhost:8790',
        networkPolicyEnabled: false,
      },
      models: {
        primary: {
          provider: 'anthropic',
          modelId: 'anthropic/claude-sonnet-4-6',
        },
      },
      mcpServer: {
        name: 'vscode-tools',
        port: 4545,
        url: 'http://127.0.0.1:4545/mcp',
      },
      agent: {
        name: vscodeAgentName || 'trueforge-coding-agent',
        description: 'TrueForge Coding Agent for VS Code',
        iterationLimit: 50,
        contextCompactionTokens: 50000,
      },
    };

    if (configPath && fs.existsSync(configPath)) {
      try {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const fileConfig = JSON.parse(raw);
        parsed = {
          ...parsed,
          ...fileConfig,
          server: { ...parsed.server, ...(fileConfig.server || {}) },
          models: { ...parsed.models, ...(fileConfig.models || {}) },
          mcpServer: { ...parsed.mcpServer, ...(fileConfig.mcpServer || {}) },
          agent: { ...parsed.agent, ...(fileConfig.agent || {}) },
        };
      } catch (e) {
        console.warn(`[ConfigManager] Failed to parse config file at ${configPath}:`, e);
      }
    }

    if (vscodeBaseUrl) {
      parsed.server.baseUrl = vscodeBaseUrl;
    }
    if (vscodeAgentName) {
      parsed.agent.name = vscodeAgentName;
    }

    this.cachedConfig = parsed;
    return parsed;
  }

  public static getConfig(): AppConfig {
    if (!this.cachedConfig) {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      return this.loadConfig(workspaceRoot);
    }
    return this.cachedConfig;
  }
}
