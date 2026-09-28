import { Router } from 'express';
import {
  getSchedulerStatus,
  updateSchedulerConfig,
  triggerManualScan,
  getRecentRuns
} from '../services/scheduler.js';
import { ALLOWED_INTERVALS } from '../types.js';

const router = Router();

/** GET /api/scheduler/status — 调度器当前状态 */
router.get('/status', async (_req, res) => {
  try {
    const status = await getSchedulerStatus();
    res.json(status);
  } catch (error) {
    console.error('获取调度器状态失败:', error);
    res.status(500).json({ error: '获取调度器状态失败' });
  }
});

/** PUT /api/scheduler/config — 更新调度器配置 */
router.put('/config', async (req, res) => {
  try {
    const { enabled, intervalMinutes } = req.body;

    if (enabled !== undefined && typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled 必须是布尔值' });
    }

    if (intervalMinutes !== undefined) {
      if (!ALLOWED_INTERVALS.includes(intervalMinutes)) {
        return res.status(400).json({
          error: `intervalMinutes 必须是 ${ALLOWED_INTERVALS.join('/')} 之一`
        });
      }
    }

    await updateSchedulerConfig({ enabled, intervalMinutes });
    const status = await getSchedulerStatus();
    res.json(status);
  } catch (error) {
    console.error('更新调度器配置失败:', error);
    res.status(500).json({ error: '更新调度器配置失败' });
  }
});

/** POST /api/scheduler/trigger — 手动触发一次增量扫描 */
router.post('/trigger', async (_req, res) => {
  try {
    const result = await triggerManualScan();
    if (!result.started) {
      return res.status(409).json({ error: result.message });
    }
    res.json({ message: result.message });
  } catch (error) {
    console.error('触发扫描失败:', error);
    res.status(500).json({ error: '触发扫描失败' });
  }
});

/** GET /api/scheduler/runs — 最近扫描记录 */
router.get('/runs', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
    const runs = await getRecentRuns(limit);
    res.json(runs);
  } catch (error) {
    console.error('获取扫描记录失败:', error);
    res.status(500).json({ error: '获取扫描记录失败' });
  }
});

export default router;
