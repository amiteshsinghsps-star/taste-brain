import { Response } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { IngestionService } from '../services/ingestion/ingestion.service';
import { SourceType } from '@prisma/client';

const createSourceSchema = z.object({
  name: z.string().min(1, 'Source name is required'),
  type: z.nativeEnum(SourceType),
  config: z.record(z.any()).optional(),
});

export class IngestionController {
  static async createSource(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const parseResult = createSourceSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({ success: false, errors: parseResult.error.errors });
        return;
      }

      const { name, type, config } = parseResult.data;
      const { dataSource, redirectUrl } = await IngestionService.connectSource(
        req.user.userId,
        name,
        type,
        config
      );

      res.status(201).json({
        success: true,
        message: 'Data source connected successfully',
        dataSource,
        redirectUrl,
      });
    } catch (error: any) {
      if (error?.code === 'LIVE_CONNECTORS_DISABLED') {
        res.status(403).json({ success: false, code: error.code, message: error.message });
        return;
      }
      res.status(500).json({ success: false, message: error.message || 'Failed to connect data source' });
    }
  }

  static async listSources(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const sources = await IngestionService.listUserSources(req.user.userId);
      res.status(200).json({ success: true, sources });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to fetch data sources' });
    }
  }

  static async syncSource(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const id = String(req.params.id);
      const result = await IngestionService.syncSource(id, req.user.userId);
      res.status(200).json(result);
    } catch (error: any) {
      if (error?.code === 'LIVE_CONNECTORS_DISABLED') {
        res.status(403).json({ success: false, code: error.code, message: error.message });
        return;
      }
      res.status(500).json({ success: false, message: error.message || 'Data ingestion sync failed' });
    }
  }

  static async deleteSource(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const id = String(req.params.id);
      const result = await IngestionService.deleteSource(id, req.user.userId);
      res.status(200).json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to delete data source' });
    }
  }

  static async listDocuments(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const dataSourceId = req.query.dataSourceId as string | undefined;
      const query = req.query.q as string | undefined;

      const documents = await IngestionService.listUserDocuments(req.user.userId, dataSourceId, query);
      res.status(200).json({ success: true, count: documents.length, documents });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to fetch ingested documents' });
    }
  }

  static async uploadDocument(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const uploadSchema = z.object({
        title: z.string().min(1, 'Document title is required'),
        content: z.string().min(1, 'Document content is required'),
      });

      const parseResult = uploadSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({ success: false, errors: parseResult.error.errors });
        return;
      }

      const { title, content } = parseResult.data;
      const result = await IngestionService.uploadDocument(req.user.userId, title, content);
      res.status(201).json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to upload document' });
    }
  }
}
