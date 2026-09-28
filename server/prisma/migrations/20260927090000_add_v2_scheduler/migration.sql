-- V2: 定时增量扫描所需的调度状态、关键词来源水位和任务运行记录。
-- 只新增表和索引，不修改现有 Keyword / Hotspot / Notification / Setting 数据。

-- CreateTable: 调度器单例配置与最近一次运行状态（id 固定为 'default'）
CREATE TABLE "SchedulerState" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 30,
    "lastRunAt" DATETIME,
    "nextRunAt" DATETIME,
    "lastRunStatus" TEXT,
    "lastRunError" TEXT,
    "lastRunSummary" TEXT,
    "runToken" TEXT,
    "runStartedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable: 每个关键词 × 来源的增量扫描水位
CREATE TABLE "KeywordScanState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "keywordId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "lastStartedAt" DATETIME,
    "lastSuccessAt" DATETIME,
    "watermarkAt" DATETIME,
    "lastResultCount" INTEGER NOT NULL DEFAULT 0,
    "lastNewCount" INTEGER NOT NULL DEFAULT 0,
    "lastUpdatedCount" INTEGER NOT NULL DEFAULT 0,
    "lastDurationMs" INTEGER,
    "lastStatus" TEXT,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KeywordScanState_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: 扫描任务运行记录（定时 / 手动）
CREATE TABLE "ScanRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "keywordCount" INTEGER NOT NULL DEFAULT 0,
    "newCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "filteredCount" INTEGER NOT NULL DEFAULT 0,
    "sourceStats" TEXT,
    "error" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "KeywordScanState_keywordId_source_key" ON "KeywordScanState"("keywordId", "source");

-- CreateIndex
CREATE INDEX "ScanRun_startedAt_idx" ON "ScanRun"("startedAt");

-- CreateIndex: 来源 ID 优先去重
CREATE INDEX "Hotspot_source_sourceId_idx" ON "Hotspot"("source", "sourceId");

-- CreateIndex: 热点雷达按启用关键词过滤
CREATE INDEX "Hotspot_keywordId_idx" ON "Hotspot"("keywordId");

-- 初始化调度器默认配置：启用、30 分钟间隔
INSERT OR IGNORE INTO "SchedulerState" ("id", "enabled", "intervalMinutes", "updatedAt")
VALUES ('default', true, 30, CURRENT_TIMESTAMP);
