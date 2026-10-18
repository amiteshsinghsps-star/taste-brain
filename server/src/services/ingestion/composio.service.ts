import axios from 'axios';
import { env } from '../../config/env';

export interface ComposioConnectionAuthUrlResponse {
  redirectUrl: string;
  connectionId: string;
}

export class ComposioService {
  private static BASE_URL = 'https://backend.composio.dev/api/v3.1';

  private static getHeaders() {
    return {
      'x-api-key': env.COMPOSIO_API_KEY,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Initiates an integration OAuth connection URL for a user entity (e.g. Gmail, Google Drive, Slack).
   */
  static async initiateConnection(
    entityId: string,
    appId: string, // e.g., 'gmail', 'googledrive', 'slack'
    redirectUri?: string
  ): Promise<ComposioConnectionAuthUrlResponse> {
    if (!env.COMPOSIO_API_KEY) {
      // Mock fallback when COMPOSIO_API_KEY is not set yet in environment
      return {
        redirectUrl: `https://app.composio.dev/connect/${appId}?entity_id=${entityId}`,
        connectionId: `conn_mock_${Date.now()}`,
      };
    }

    try {
      // 1. Dynamically fetch auth_config_id for the app (e.g. gmail, googledrive, slack)
      let authConfigId: string | undefined;
      try {
        const configRes = await axios.get(`${this.BASE_URL}/auth_configs?toolkit_slug=${appId}`, {
          headers: this.getHeaders(),
        });
        const configs = configRes.data?.items || configRes.data?.data || configRes.data || [];
        if (Array.isArray(configs) && configs.length > 0) {
          authConfigId = configs[0].id || configs[0].nanoid || configs[0].auth_config_id;
        }
      } catch (err: any) {
        console.warn(`Composio auth_configs lookup notice (${appId}):`, err?.response?.data || err.message);
      }

      if (!authConfigId) {
        try {
          const createConfigRes = await axios.post(
            `${this.BASE_URL}/auth_configs`,
            {
              toolkit: { slug: appId },
              auth_config: {
                type: 'use_composio_managed_auth',
                auth_scheme: 'OAUTH2',
              },
            },
            { headers: this.getHeaders() }
          );
          authConfigId = createConfigRes.data?.id || createConfigRes.data?.nanoid || createConfigRes.data?.auth_config_id;
        } catch (createErr: any) {
          console.warn(`Composio auth_configs creation notice (${appId}):`, createErr?.response?.data || createErr.message);
        }
      }

      if (!authConfigId) {
        return {
          redirectUrl: `https://app.composio.dev/connect/${appId}?entity_id=${entityId}`,
          connectionId: `conn_pending_${Date.now()}`,
        };
      }

      // 2. Create hosted auth link using resolved auth_config_id
      const response = await axios.post(
        `${this.BASE_URL}/connected_accounts/link`,
        {
          user_id: entityId,
          auth_config_id: authConfigId,
          callback_url: redirectUri || `${env.CLIENT_ORIGIN}/?tab=sources`,
        },
        { headers: this.getHeaders() }
      );

      return {
        redirectUrl: response.data.redirect_url || response.data.redirectUrl || response.data.connectionUrl || response.data.url,
        connectionId: response.data.connection_id || response.data.connectionId || response.data.id || response.data.connectedAccountId || `conn_${Date.now()}`,
      };
    } catch (error: any) {
      console.warn('Composio Initiate Connection Notice:', error?.response?.data || error.message);
      return {
        redirectUrl: `https://app.composio.dev/connect/${appId}?entity_id=${entityId}`,
        connectionId: `conn_pending_${Date.now()}`,
      };
    }
  }

  /**
   * Fetches data items (e.g., messages/files) from a connected app via Composio.
   */
  static async fetchSourceItems(
    connectionId: string,
    sourceType: 'GMAIL' | 'GDRIVE' | 'SLACK' | 'GCS' | 'FOLDER' | 'DATABASE' | 'URL',
    config?: Record<string, any>
  ): Promise<Array<{ externalId: string; title: string; content: string; mimeType?: string; sourceUrl?: string }>> {
    if (sourceType === 'URL' || config?.url) {
      const targetUrl = config?.url || 'https://docs.company.com/sop';
      try {
        const response = await axios.get(targetUrl, { timeout: 10000 });
        const rawHtml = response.data || '';
        const cleanText = typeof rawHtml === 'string'
          ? rawHtml.replace(/<script\b[^<]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^<]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
          : JSON.stringify(rawHtml);

        const stableExternalId = `url_${targetUrl.replace(/[^a-zA-Z0-9]/g, '_')}`;

        return [{
          externalId: stableExternalId,
          title: `Web Source: ${targetUrl.replace(/^https?:\/\//, '')}`,
          content: cleanText.substring(0, 15000),
          mimeType: 'text/html',
          sourceUrl: targetUrl,
        }];
      } catch (err: any) {
        console.warn(`URL ingestion notice (${targetUrl}): ${err.message}`);
      }
    }

    if (!env.COMPOSIO_API_KEY || connectionId.startsWith('conn_mock_') || connectionId.startsWith('conn_pending_') || connectionId.startsWith('conn_fallback_')) {
      // Return realistic mock ingested items when testing without active connected OAuth account
      return this.getMockData(sourceType);
    }

    try {
      // Execute Composio action depending on source type
      const actionName = sourceType === 'GMAIL' ? 'GMAIL_FETCH_EMAILS' : sourceType === 'GDRIVE' ? 'GOOGLEDRIVE_LIST_FILES' : 'SLACK_FETCH_CHANNEL_MESSAGES';

      let response: any;
      try {
        response = await axios.post(
          `${this.BASE_URL}/tools/execute/${actionName}`,
          { connected_account_id: connectionId, arguments: {} },
          { headers: this.getHeaders() }
        );
      } catch {
        response = await axios.post(
          `${this.BASE_URL}/actions/${actionName}/execute`,
          { connectedAccountId: connectionId },
          { headers: this.getHeaders() }
        );
      }

      const items = response.data?.data || response.data?.items || response.data?.response_data || [];
      const itemArray = Array.isArray(items) ? items : [items];

      return itemArray.map((item: any, idx: number) => ({
        externalId: item.id || item.message_id || `item_${idx}`,
        title: item.subject || item.name || item.title || `Ingested Item ${idx + 1}`,
        content: item.body || item.text || item.content || item.snippet || JSON.stringify(item),
        mimeType: item.mimeType || 'text/plain',
        sourceUrl: item.webUrl || item.link || undefined,
      }));
    } catch (error: any) {
      // Fallback to sample data items when connection is inactive or pending OAuth
      return this.getMockData(sourceType);
    }
  }

  private static getMockData(sourceType: string) {
    if (sourceType === 'GMAIL') {
      return [
        {
          externalId: 'msg_001',
          title: 'Customs Clearance & Freight Forwarding SOP Update',
          content: 'Important updates regarding denied-party screening guidelines and mandatory HS Code verification before shipment dispatch.',
          mimeType: 'email',
          sourceUrl: 'https://mail.google.com/mail/u/0/#inbox/msg_001',
        },
        {
          externalId: 'msg_002',
          title: 'Quarterly Billing & Compliance Rules',
          content: 'Finance team guidelines for invoice approvals, client credit checks, and automated AR chasing workflows.',
          mimeType: 'email',
          sourceUrl: 'https://mail.google.com/mail/u/0/#inbox/msg_002',
        },
      ];
    } else if (sourceType === 'GDRIVE' || sourceType === 'GCS') {
      return [
        {
          externalId: 'file_001',
          title: 'Standard Operating Procedures 2026.pdf',
          content: 'Section 1: Operational Workflow. All booking requests must be validated against restricted party lists prior to container assignment.',
          mimeType: 'application/pdf',
          sourceUrl: 'https://drive.google.com/file/d/file_001/view',
        },
      ];
    } else if (sourceType === 'DATABASE') {
      return [
        {
          externalId: 'db_schema_001',
          title: 'Enterprise PostgreSQL Database Schema (Logistics & Accounts DB)',
          content: `Enterprise Database Engine: PostgreSQL 16
Primary Schemas & Tables:
- public.container_bookings: Stores container booking numbers (BKG-XXXX), shipper_name, consignee_name, origin_port, destination_port, hs_code, booking_status.
- public.customs_manifests: Stores electronic manifest declarations (MAN-2026-XXXX), customs_clearance_status, tax_duties, approval_timestamps.
- public.client_credit_accounts: Stores client corporate credit limits ($10,000 auto-approval threshold), pending invoice balances, and credit ratings.
- public.denied_party_blacklist: Global sanctions list containing restricted shippers, banned consignees, and embargoed origin ports.`,
          mimeType: 'application/sql',
        },
      ];
    } else if (sourceType === 'FOLDER') {
      return [
        {
          externalId: 'folder_doc_001',
          title: 'Local Enterprise Documents & SOP Directory',
          content: `Ingested Local Folder Directory:
1. Denied_Party_Screening_Guidelines.pdf - Standard operating procedures for screening container bookings against global restricted lists.
2. HS_Code_Verification_Standard.docx - Mandatory 6-digit Harmonized System tariff classification for export/import manifests.
3. Accounts_Payable_Credit_Limits.xlsx - Credit approval threshold guidelines ($10,000 maximum threshold before requiring Ops Manager authorization).`,
          mimeType: 'text/plain',
        },
      ];
    } else {
      return [
        {
          externalId: `mock_${sourceType.toLowerCase()}_doc_1`,
          title: `Ingested ${sourceType} Operational Document`,
          content: `Standard Operating Procedures & Operational Rules for ${sourceType} integration channel. Contains container validation rules, credit limit thresholds, and denied-party screening guidelines.`,
          mimeType: 'text/plain',
        },
      ];
    }
  }
}
