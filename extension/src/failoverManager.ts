import { TrueForgeClient, TrueForgeEvent, TurnInputItem } from './trueforgeClient';
import { AppConfig } from './configLoader';

export interface FailoverEventCallback {
  (event: TrueForgeEvent): void;
}

export interface FailoverNoticeCallback {
  (message: string, fallbackModel: string): void;
}

export class ModelFailoverManager {
  private client: TrueForgeClient;
  private config: AppConfig;

  constructor(client: TrueForgeClient, config: AppConfig) {
    this.client = client;
    this.config = config;
  }

  /**
   * Executes a turn with automatic transparent failover:
   * If primary model encounters an error (401, unreachable endpoint, 5xx, or turn error),
   * transparently re-routes to fallback model without user intervention or editor locks.
   */
  public async executeTurnWithFallback(
    agentInstructions: string,
    input: TurnInputItem[],
    onEvent: FailoverEventCallback,
    onFailoverNotice?: FailoverNoticeCallback,
    abortSignal?: AbortSignal
  ): Promise<{ finalEvent: TrueForgeEvent; modelUsed: string; failedOver: boolean }> {
    const primary = this.config.models.primary;
    const fallback = this.config.models.fallback;

    // Attempt 1: Primary Model
    try {
      const session = await this.client.createSession({
        spec: {
          model: { name: primary.modelId, params: primary.params },
          instructions: agentInstructions,
          mcp_servers: [
            {
              name: this.config.mcpServer.name || 'vscode-tools',
              enable_tools: ['@all'],
              require_approval_for_tools: ['@destructive', 'run_command'],
              preload: false,
            },
          ],
        },
      });

      const finalEvent = await this.client.createTurnStream(
        session.id,
        input,
        onEvent,
        abortSignal
      );

      // Check if turn finished with error status
      if (finalEvent.state?.status === 'error') {
        throw new Error(`Turn returned error state: ${finalEvent.state.message || 'unknown error'}`);
      }

      return { finalEvent, modelUsed: primary.modelId, failedOver: false };
    } catch (primaryErr: any) {
      const errMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);

      if (!fallback || !fallback.modelId) {
        throw primaryErr;
      }

      // Transparent Failover to Fallback Model
      const notice = `Primary model '${primary.modelId}' encountered an error (${errMsg}). Transparently switching to fallback '${fallback.modelId}'...`;
      if (onFailoverNotice) {
        onFailoverNotice(notice, fallback.modelId);
      }

      const fallbackSession = await this.client.createSession({
        spec: {
          model: { name: fallback.modelId, params: fallback.params },
          instructions: agentInstructions,
          mcp_servers: [
            {
              name: this.config.mcpServer.name || 'vscode-tools',
              enable_tools: ['@all'],
              require_approval_for_tools: ['@destructive', 'run_command'],
              preload: false,
            },
          ],
        },
      });

      const finalFallbackEvent = await this.client.createTurnStream(
        fallbackSession.id,
        input,
        onEvent,
        abortSignal
      );

      return { finalEvent: finalFallbackEvent, modelUsed: fallback.modelId, failedOver: true };
    }
  }
}
