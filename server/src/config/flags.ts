import { env } from './env';

/**
 * Feature flags (§8.12). Demo safety rule: nothing that touches a real
 * third-party account is on by default — the graph is built from synthetic,
 * clearly-labelled demo content unless an operator opts in.
 */
export const flags = {
  /** Gmail/Drive/Slack/Composio sync. Off = connectors return a disabled response. */
  liveConnectors: env.FF_LIVE_CONNECTORS,
  /** Fail the whole process instead of serving a degraded graph. */
  requireFalkor: env.FALKORDB_REQUIRED,
};

export function connectorStatus() {
  return {
    liveConnectorsEnabled: flags.liveConnectors,
    banner: flags.liveConnectors
      ? 'Live connectors are ON — ingestion may contact real accounts.'
      : 'Live connectors are OFF. The graph is populated only by the synthetic demo company and files you upload.',
  };
}
