-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('GMAIL', 'GDRIVE', 'SLACK', 'GCS', 'FOLDER', 'DATABASE');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('CONNECTED', 'SYNCING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('ORGANIZATION', 'PERSON', 'PROCESS', 'POLICY', 'SYSTEM', 'FIELD');

-- CreateEnum
CREATE TYPE "RelationType" AS ENUM ('REQUIRES', 'GOVERNS', 'APPROVES', 'USES', 'VALIDATES');

-- CreateEnum
CREATE TYPE "CategoryType" AS ENUM ('FREIGHT', 'FINANCE', 'HR', 'COMPLIANCE', 'GENERAL');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('RUNNING', 'PAUSED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AgentMode" AS ENUM ('COPILOT', 'AUTOPILOT');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('COMPLETED', 'FLAGGED', 'STAGED_FOR_APPROVAL', 'REJECTED');

-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('ADMIN', 'OPS', 'ACCOUNTS');

-- CreateEnum
CREATE TYPE "AccessScope" AS ENUM ('EMAIL', 'DRIVE', 'SLACK', 'ACCOUNTING', 'BRAIN', 'WORKFLOWS');

-- CreateEnum
CREATE TYPE "EmailCategory" AS ENUM ('INQUIRY', 'BOOKING', 'BILLING', 'URGENT');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('TRIAGED', 'STAGED_FOR_APPROVAL', 'SENT', 'REJECTED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "replacedByToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_sources" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SourceType" NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'CONNECTED',
    "composioConnectionId" TEXT,
    "config" JSONB DEFAULT '{}',
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingested_documents" (
    "id" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "externalId" TEXT,
    "title" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "mimeType" TEXT DEFAULT 'text/plain',
    "content" TEXT NOT NULL,
    "metadata" JSONB DEFAULT '{}',
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingested_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "metadata" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entities" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "EntityType" NOT NULL DEFAULT 'PROCESS',
    "metadata" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_relations" (
    "id" TEXT NOT NULL,
    "sourceEntityId" TEXT NOT NULL,
    "targetEntityId" TEXT NOT NULL,
    "relationType" "RelationType" NOT NULL DEFAULT 'GOVERNS',
    "evidenceChunkId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_rules" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "CategoryType" NOT NULL DEFAULT 'GENERAL',
    "ruleName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "triggerCondition" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "parameters" JSONB DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "isExecutable" BOOLEAN NOT NULL DEFAULT true,
    "sourceDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brain_query_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "citations" JSONB DEFAULT '[]',
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brain_query_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_instances" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'FREIGHT_AGENT',
    "status" "AgentStatus" NOT NULL DEFAULT 'RUNNING',
    "mode" "AgentMode" NOT NULL DEFAULT 'COPILOT',
    "configuration" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tasks" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "inputPayload" JSONB NOT NULL,
    "outputResult" JSONB DEFAULT '{}',
    "status" "TaskStatus" NOT NULL DEFAULT 'COMPLETED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_audit_logs" (
    "id" TEXT NOT NULL,
    "agentId" TEXT,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB DEFAULT '{}',
    "citationUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'OPS',
    "isSuspended" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_grants" (
    "id" TEXT NOT NULL,
    "teamMemberId" TEXT NOT NULL,
    "scope" "AccessScope" NOT NULL,
    "isGranted" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_desk_messages" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "senderEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" "EmailCategory" NOT NULL DEFAULT 'INQUIRY',
    "citedDraft" TEXT,
    "status" "EmailStatus" NOT NULL DEFAULT 'TRIAGED',
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_desk_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "data_sources_userId_idx" ON "data_sources"("userId");

-- CreateIndex
CREATE INDEX "ingested_documents_dataSourceId_idx" ON "ingested_documents"("dataSourceId");

-- CreateIndex
CREATE INDEX "ingested_documents_userId_idx" ON "ingested_documents"("userId");

-- CreateIndex
CREATE INDEX "knowledge_chunks_documentId_idx" ON "knowledge_chunks"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "entities_name_key" ON "entities"("name");

-- CreateIndex
CREATE INDEX "entity_relations_sourceEntityId_idx" ON "entity_relations"("sourceEntityId");

-- CreateIndex
CREATE INDEX "entity_relations_targetEntityId_idx" ON "entity_relations"("targetEntityId");

-- CreateIndex
CREATE INDEX "skill_rules_userId_idx" ON "skill_rules"("userId");

-- CreateIndex
CREATE INDEX "brain_query_logs_userId_idx" ON "brain_query_logs"("userId");

-- CreateIndex
CREATE INDEX "agent_instances_userId_idx" ON "agent_instances"("userId");

-- CreateIndex
CREATE INDEX "agent_tasks_agentId_idx" ON "agent_tasks"("agentId");

-- CreateIndex
CREATE INDEX "agent_tasks_userId_idx" ON "agent_tasks"("userId");

-- CreateIndex
CREATE INDEX "agent_audit_logs_agentId_idx" ON "agent_audit_logs"("agentId");

-- CreateIndex
CREATE INDEX "agent_audit_logs_userId_idx" ON "agent_audit_logs"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_ownerUserId_email_key" ON "team_members"("ownerUserId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "access_grants_teamMemberId_scope_key" ON "access_grants"("teamMemberId", "scope");

-- CreateIndex
CREATE INDEX "email_desk_messages_userId_idx" ON "email_desk_messages"("userId");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingested_documents" ADD CONSTRAINT "ingested_documents_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "data_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingested_documents" ADD CONSTRAINT "ingested_documents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ingested_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_relations" ADD CONSTRAINT "entity_relations_sourceEntityId_fkey" FOREIGN KEY ("sourceEntityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_relations" ADD CONSTRAINT "entity_relations_targetEntityId_fkey" FOREIGN KEY ("targetEntityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_rules" ADD CONSTRAINT "skill_rules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_rules" ADD CONSTRAINT "skill_rules_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "ingested_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brain_query_logs" ADD CONSTRAINT "brain_query_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_instances" ADD CONSTRAINT "agent_instances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agent_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_audit_logs" ADD CONSTRAINT "agent_audit_logs_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agent_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_audit_logs" ADD CONSTRAINT "agent_audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "team_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_desk_messages" ADD CONSTRAINT "email_desk_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
