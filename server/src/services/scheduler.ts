import { Server } from 'socket.io';
import { prisma } from '../db.js';
import { runIncrementalScan } from '../jobs/hotspotChecker.js';
import type { SchedulerConfig, SchedulerStatus, ScanRunSummary } from '../types.js';

let io: Server;
let timer: ReturnType<typeof setTimeout> | null = null;
let stopping = false;

/** 初始化调度器，传入 Socket.IO 实例并根据持久化配置恢复定时 */
export async function initScheduler(socketIo: Server): Promise<void> {
  io = socketIo;
  stopping = false;

  // 确保 SchedulerState 单例存在
  await prisma.schedulerState.upsert({
    where: { id: 'default' },
    create: { id: 'default', enabled: true, intervalMinutes: 30 },
    update: {}
  });

  // 清理可能因进程崩溃残留的运行令牌
  await prisma.schedulerState.update({
    where: { id: 'default' },
    data: { runToken: null, runStartedAt: null }
  });

  const state = await prisma.schedulerState.findUniqueOrThrow({ where: { id: 'default' } });

  if (state.enabled) {
    // 检查是否需要补跑（上次 nextRunAt 已过期）
    const now = new Date();
    if (state.nextRunAt && state.nextRunAt <= now) {
      console.log('⏰ 调度器检测到上次计划时间已过期，立即补跑');
      scheduleNext(0);
    } else {
      const delayMs = state.nextRunAt
        ? Math.max(0, state.nextRunAt.getTime() - now.getTime())
        : state.intervalMinutes * 60 * 1000;
      scheduleNext(delayMs);
    }
    console.log(`✅ 调度器已启动，间隔 ${state.intervalMinutes} 分钟`);
  } else {
    console.log('⏸ 调度器已停用');
  }
}

/** 优雅停止调度器 */
export function stopScheduler(): void {
  stopping = true;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/** 读取当前调度器状态 */
export async function getSchedulerStatus(): Promise<SchedulerStatus> {
  const state = await prisma.schedulerState.findUniqueOrThrow({ where: { id: 'default' } });
  const activeKeywordCount = await prisma.keyword.count({ where: { isActive: true } });

  let lastRunSummary: ScanRunSummary | null = null;
  if (state.lastRunSummary) {
    try { lastRunSummary = JSON.parse(state.lastRunSummary); } catch { /* ignore */ }
  }

  return {
    enabled: state.enabled,
    intervalMinutes: state.intervalMinutes,
    running: !!state.runToken,
    lastRunAt: state.lastRunAt?.toISOString() ?? null,
    nextRunAt: state.nextRunAt?.toISOString() ?? null,
    lastRunStatus: state.lastRunStatus,
    lastRunError: state.lastRunError,
    lastRunSummary,
    activeKeywordCount
  };
}

/** 更新调度器配置并立即生效 */
export async function updateSchedulerConfig(config: Partial<SchedulerConfig>): Promise<void> {
  const data: any = {};
  if (config.enabled !== undefined) data.enabled = config.enabled;
  if (config.intervalMinutes !== undefined) data.intervalMinutes = config.intervalMinutes;

  await prisma.schedulerState.update({ where: { id: 'default' }, data });

  // 重新加载定时
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  const state = await prisma.schedulerState.findUniqueOrThrow({ where: { id: 'default' } });
  if (state.enabled && !stopping) {
    const nextRunAt = new Date(Date.now() + state.intervalMinutes * 60 * 1000);
    await prisma.schedulerState.update({ where: { id: 'default' }, data: { nextRunAt } });
    scheduleNext(state.intervalMinutes * 60 * 1000);
    console.log(`🔄 调度器配置已更新：间隔 ${state.intervalMinutes} 分钟`);
  } else {
    await prisma.schedulerState.update({ where: { id: 'default' }, data: { nextRunAt: null } });
    console.log('⏸ 调度器已停用');
  }
}

/** 手动触发一次增量扫描，返回是否成功启动 */
export async function triggerManualScan(): Promise<{ started: boolean; message: string }> {
  const state = await prisma.schedulerState.findUniqueOrThrow({ where: { id: 'default' } });
  if (state.runToken) {
    return { started: false, message: '已有扫描任务在运行，请等待完成' };
  }
  // 不阻塞，后台执行
  executeScan('manual').catch(err => console.error('手动扫描异常:', err));
  return { started: true, message: '增量扫描已触发' };
}

/** 获取最近扫描记录 */
export async function getRecentRuns(limit = 10) {
  return prisma.scanRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: limit
  });
}

// ============================================================
// 内部调度逻辑
// ============================================================

function scheduleNext(delayMs: number): void {
  if (stopping) return;
  timer = setTimeout(async () => {
    if (stopping) return;
    try {
      await executeScan('schedule');
    } catch (err) {
      console.error('❌ 定时扫描异常:', err);
    }
    // 扫描结束后安排下一次
    if (!stopping) {
      const state = await prisma.schedulerState.findUniqueOrThrow({ where: { id: 'default' } });
      if (state.enabled) {
        const nextDelay = state.intervalMinutes * 60 * 1000;
        const nextRunAt = new Date(Date.now() + nextDelay);
        await prisma.schedulerState.update({ where: { id: 'default' }, data: { nextRunAt } });
        scheduleNext(nextDelay);
      }
    }
  }, delayMs);
}

async function executeScan(trigger: 'schedule' | 'manual'): Promise<void> {
  // 互斥锁：尝试获取运行令牌
  const token = `${trigger}-${Date.now()}`;
  const updated = await prisma.schedulerState.updateMany({
    where: { id: 'default', runToken: null },
    data: { runToken: token, runStartedAt: new Date() }
  });
  if (updated.count === 0) {
    console.log('⏭ 跳过扫描：已有任务在运行');
    return;
  }

  const startTime = Date.now();
  const scanRun = await prisma.scanRun.create({
    data: { trigger, status: 'running' }
  });

  try {
    const summary = await runIncrementalScan(io, scanRun.id);
    const durationMs = Date.now() - startTime;
    const fullSummary: ScanRunSummary = { ...summary, durationMs };
    const status = summary.newCount === 0 && summary.keywordCount === 0
      ? 'empty'
      : Object.values(summary.sourceStats).some(s => s.error) ? 'partial' : 'success';

    await prisma.scanRun.update({
      where: { id: scanRun.id },
      data: {
        status,
        finishedAt: new Date(),
        keywordCount: summary.keywordCount,
        newCount: summary.newCount,
        updatedCount: summary.updatedCount,
        filteredCount: summary.filteredCount,
        sourceStats: JSON.stringify(summary.sourceStats)
      }
    });

    await prisma.schedulerState.update({
      where: { id: 'default' },
      data: {
        runToken: null,
        runStartedAt: null,
        lastRunAt: new Date(),
        lastRunStatus: status,
        lastRunError: null,
        lastRunSummary: JSON.stringify(fullSummary)
      }
    });

    // 通过 WebSocket 广播扫描完成
    io.emit('scan:complete', { runId: scanRun.id, status, summary: fullSummary });

    console.log(`✅ 扫描完成 [${trigger}]: 新增 ${summary.newCount}，更新 ${summary.updatedCount}，过滤 ${summary.filteredCount}，耗时 ${durationMs}ms`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await prisma.scanRun.update({
      where: { id: scanRun.id },
      data: { status: 'failed', finishedAt: new Date(), error: errorMsg }
    });
    await prisma.schedulerState.update({
      where: { id: 'default' },
      data: {
        runToken: null,
        runStartedAt: null,
        lastRunAt: new Date(),
        lastRunStatus: 'failed',
        lastRunError: errorMsg,
      }
    });
    io.emit('scan:complete', { runId: scanRun.id, status: 'failed', error: errorMsg });
    console.error(`❌ 扫描失败 [${trigger}]:`, errorMsg);
  }
}
