import { prisma } from '../../db/client';
import { ComposioService } from './composio.service';
import { ChunkerService } from './chunker.service';
import { TenantGraphService } from '../brain/graph.service';
import { SkillsService } from '../brain/skills.service';
import { SourceType, SyncStatus } from '@prisma/client';
import { maskSensitiveConfig } from '../../utils/crypto.utils';
import { flags } from '../../config/flags';

/** Thrown when a route needs a live third-party account and the flag is off. */
export class LiveConnectorsDisabledError extends Error {
  code = 'LIVE_CONNECTORS_DISABLED';
  constructor(source: string) {
    super(
      `Live connectors are off, so "${source}" sync is disabled. The graph is built from the synthetic demo company and files you upload; to connect a real account set FF_LIVE_CONNECTORS=1 and restart.`
    );
  }
}

export class IngestionService {
  /**
   * Creates a new DataSource record and initiates Composio OAuth link if needed.
   */
  static async connectSource(
    userId: string,
    name: string,
    type: SourceType,
    config: Record<string, any> = {}
  ) {
    const composioAppNameMap: Record<string, string> = {
      GMAIL: 'gmail',
      GDRIVE: 'googledrive',
      SLACK: 'slack',
      GCS: 'googledrive',
    };

    let redirectUrl: string | undefined;
    let connectionId: string | undefined;

    if (composioAppNameMap[type]) {
      if (!flags.liveConnectors) throw new LiveConnectorsDisabledError(type);
      const composioRes = await ComposioService.initiateConnection(userId, composioAppNameMap[type]);
      redirectUrl = composioRes.redirectUrl;
      connectionId = composioRes.connectionId;
    }

    const secureConfig = maskSensitiveConfig(config);

    const dataSource = await prisma.dataSource.create({
      data: {
        userId,
        name,
        type,
        status: SyncStatus.CONNECTED,
        composioConnectionId: connectionId,
        config: secureConfig,
      },
    });

    return { dataSource, redirectUrl };
  }

  /**
   * Executes ingestion sync for a DataSource:
   * 1. Updates status to SYNCING.
   * 2. Fetches items via Composio/Direct.
   * 3. Creates IngestedDocument & KnowledgeChunk records.
   * 4. Updates status to SUCCESS.
   */
  static async syncSource(dataSourceId: string, userId: string) {
    const dataSource = await prisma.dataSource.findFirst({
      where: { id: dataSourceId, userId },
    });

    if (!dataSource) {
      throw new Error('Data source not found');
    }

    // "Sync" always means pulling from a system outside this app. Uploads go
    // through POST /api/ingestion/upload and the demo company through
    // POST /api/brain/seed-demo, so turning this off costs the demo nothing.
    if (!flags.liveConnectors) throw new LiveConnectorsDisabledError(dataSource.type);

    await prisma.dataSource.update({
      where: { id: dataSourceId },
      data: { status: SyncStatus.SYNCING },
    });

    try {
      const connectionId = dataSource.composioConnectionId || `conn_fallback_${dataSource.id}`;
      const rawItems = await ComposioService.fetchSourceItems(connectionId, dataSource.type, (dataSource.config as Record<string, any>) || undefined);

      let ingestedCount = 0;

      for (const item of rawItems) {
        const textChunks = ChunkerService.chunkText(item.content);

        // Delete existing document with same externalId or title to prevent duplicate stacking on sync
        await prisma.ingestedDocument.deleteMany({
          where: {
            dataSourceId: dataSource.id,
            OR: [
              ...(item.externalId ? [{ externalId: item.externalId }] : []),
              { title: item.title },
            ],
          },
        });

        await prisma.ingestedDocument.create({
          data: {
            dataSourceId: dataSource.id,
            userId,
            externalId: item.externalId,
            title: item.title,
            content: item.content,
            mimeType: item.mimeType || 'text/plain',
            sourceUrl: item.sourceUrl,
            chunkCount: textChunks.length,
            chunks: {
              create: textChunks.map((chunkText, idx) => ({
                chunkIndex: idx,
                text: chunkText,
              })),
            },
          },
        });

        ingestedCount++;
      }

      const updatedSource = await prisma.dataSource.update({
        where: { id: dataSourceId },
        data: {
          status: SyncStatus.SUCCESS,
          lastSyncedAt: new Date(),
        },
      });

      // Auto-extract Knowledge Graph & Executable SOP Skills from newly ingested documents
      try {
        await TenantGraphService.extractGraphFromDocuments(userId);
        await SkillsService.extractSkillsFromSOPs(userId);
      } catch (extractErr) {
        console.warn('Auto extraction notice after sync:', extractErr);
      }

      return { success: true, ingestedDocumentsCount: ingestedCount, dataSource: updatedSource };
    } catch (error: any) {
      await prisma.dataSource.update({
        where: { id: dataSourceId },
        data: { status: SyncStatus.FAILED },
      });
      throw error;
    }
  }

  /**
   * Lists all connected DataSources for a user.
   */
  static async listUserSources(userId: string) {
    return prisma.dataSource.findMany({
      where: { userId },
      include: {
        _count: { select: { documents: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Lists all IngestedDocuments and KnowledgeChunks for a user.
   */
  static async listUserDocuments(userId: string, dataSourceId?: string, query?: string) {
    const where: any = { userId };
    if (dataSourceId) where.dataSourceId = dataSourceId;
    if (query) {
      where.OR = [
        { title: { contains: query, mode: 'insensitive' } },
        { content: { contains: query, mode: 'insensitive' } },
      ];
    }

    return prisma.ingestedDocument.findMany({
      where,
      include: {
        dataSource: { select: { id: true, name: true, type: true } },
        chunks: { select: { id: true, chunkIndex: true, text: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Deletes a DataSource and all associated documents/chunks (Cascade).
   */
  static async deleteSource(dataSourceId: string, userId: string) {
    const dataSource = await prisma.dataSource.findFirst({
      where: { id: dataSourceId, userId },
    });

    if (!dataSource) {
      throw new Error('Data source not found');
    }

    await prisma.dataSource.delete({
      where: { id: dataSourceId },
    });

    return { success: true, message: 'Data source and associated documents deleted' };
  }

  /**
   * Directly uploads & ingests a text document file or SOP content into PostgreSQL.
   */
  static async uploadDocument(userId: string, title: string, content: string) {
    let dataSource = await prisma.dataSource.findFirst({
      where: { userId, type: SourceType.FOLDER, name: 'Direct Document Uploads' },
    });

    if (!dataSource) {
      dataSource = await prisma.dataSource.create({
        data: {
          userId,
          name: 'Direct Document Uploads',
          type: SourceType.FOLDER,
          status: SyncStatus.SUCCESS,
        },
      });
    }

    const textChunks = ChunkerService.chunkText(content);

    const document = await prisma.ingestedDocument.create({
      data: {
        dataSourceId: dataSource.id,
        userId,
        title,
        content,
        mimeType: 'text/plain',
        chunkCount: textChunks.length,
        chunks: {
          create: textChunks.map((chunkText, idx) => ({
            chunkIndex: idx,
            text: chunkText,
          })),
        },
      },
    });

    await prisma.dataSource.update({
      where: { id: dataSource.id },
      data: { status: SyncStatus.SUCCESS, lastSyncedAt: new Date() },
    });

    try {
      await TenantGraphService.extractGraphFromDocuments(userId);
      await SkillsService.extractSkillsFromSOPs(userId);
    } catch (extractErr) {
      console.warn('Auto extraction notice after upload:', extractErr);
    }

    return { success: true, document, chunksCount: textChunks.length };
  }
}
