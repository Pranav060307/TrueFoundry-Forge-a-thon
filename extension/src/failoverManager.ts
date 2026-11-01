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
   *
   * Deeply integrates TrueForge context-engineering features:
   * - Dynamic subagents for multi-file workspace reasoning
   * - Automatic context compaction triggered at token limits
   * - Large tool response compaction to prevent context window overflows
   * - Deferred tool loading (preload: false)
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

    // Build common TrueForge agent config enabling context engineering
    const buildAgentSpec = (modelConfig: { modelId: string; params?: Record<string, any> }) => ({
      model: { name: modelConfig.modelId, params: modelConfig.params },
      instructions: agentInstructions,
      mcp_servers: [
        {
          name: this.config.mcpServer.name || 'vscode-tools',
          enable_tools: ['@all'],
          require_approval_for_tools: ['@destructive', 'run_command'],
          preload: false, // Deferred tool loading for prompt token efficiency
        },
      ],
      config: {
        dynamic_sub_agents: {
          enabled: true,
        },
        context_management: {
          compaction: {
            enabled: true,
            trigger: {
              type: 'input_tokens',
              value: this.config.agent?.contextCompactionTokens || 40000,
            },
          },
          large_tool_response: {
            enabled: true,
          },
        },
        iteration_limit: this.config.agent?.iterationLimit || 50,
      },
    });

    // Attempt 1: Primary Model
    try {
      const session = await this.client.createSession({
        spec: buildAgentSpec(primary),
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
        spec: buildAgentSpec(fallback),
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
