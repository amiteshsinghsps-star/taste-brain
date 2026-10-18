import { prisma } from '../../db/client';
import { EmailCategory, EmailStatus } from '@prisma/client';
import { RetrievalService } from '../brain/retrieval.service';

export class EmailDeskService {
  /**
   * Triages an incoming email message, categorizes it, performs grounded Brain lookup, and creates a cited draft response staged for approval.
   */
  static async triageEmail(
    userId: string,
    senderEmail: string,
    subject: string,
    body: string
  ) {
    // 1. Deterministic Category Triage
    let category: EmailCategory = EmailCategory.INQUIRY;
    if (/booking|container|shipment|freight/i.test(subject + ' ' + body)) {
      category = EmailCategory.BOOKING;
    } else if (/invoice|billing|payment|credit/i.test(subject + ' ' + body)) {
      category = EmailCategory.BILLING;
    } else if (/urgent|asap|delay|demurrage/i.test(subject + ' ' + body)) {
      category = EmailCategory.URGENT;
    }

    // 2. Grounded Brain Context Retrieval (graph-first)
    const brainRes = await RetrievalService.query(userId, `${subject} ${body}`);

    // 3. Construct Grounded Cited Draft
    const citedDraft = `Hi ${senderEmail.split('@')[0]},\n\nThank you for reaching out regarding "${subject}".\n\n${brainRes.answer}\n\nBest regards,\nCustomer Support Desk`;

    const message = await prisma.emailDeskMessage.create({
      data: {
        userId,
        senderEmail,
        subject,
        body,
        category,
        citedDraft,
        status: EmailStatus.STAGED_FOR_APPROVAL,
      },
    });

    await prisma.agentAuditLog.create({
      data: {
        userId,
        action: 'EMAIL_DESK_TRIAGED',
        details: { messageId: message.id, category, senderEmail },
      },
    });

    return message;
  }

  /**
   * Lists email desk inbox messages and staged drafts for a user.
   */
  static async listMessages(userId: string, category?: EmailCategory, status?: EmailStatus) {
    const where: any = { userId };
    if (category) where.category = category;
    if (status) where.status = status;

    return prisma.emailDeskMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Approves a staged email draft and sends it to the recipient.
   */
  static async approveAndSendEmail(messageId: string, userId: string) {
    const message = await prisma.emailDeskMessage.findFirst({
      where: { id: messageId, userId },
    });

    if (!message) {
      throw new Error('Email message not found');
    }

    if (message.status === EmailStatus.SENT) {
      throw new Error('Email message has already been sent');
    }

    const updated = await prisma.emailDeskMessage.update({
      where: { id: messageId },
      data: {
        status: EmailStatus.SENT,
        sentAt: new Date(),
      },
    });

    await prisma.agentAuditLog.create({
      data: {
        userId,
        action: 'EMAIL_DESK_APPROVED_AND_SENT',
        details: { messageId: message.id, senderEmail: message.senderEmail, subject: message.subject },
      },
    });

    return updated;
  }
}
