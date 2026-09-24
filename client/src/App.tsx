import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Flame, Search, Plus, Bell, Trash2, 
  ExternalLink, RefreshCw, X, Check, AlertTriangle,
  Zap, TrendingUp, Twitter, Globe, Eye, Activity, Clock, Target,
  ChevronLeft, ChevronRight,
  MessageCircle, Repeat2, Quote, User, Shield, ShieldAlert,
  ChevronDown, ChevronUp, ChevronsUpDown, ThermometerSun, FileText
} from 'lucide-react';
import { 
  keywordsApi, hotspotsApi, notificationsApi, triggerHotspotCheck,
  type Keyword, type Hotspot, type Stats, type Notification
} from './services/api';
import { onNewHotspot, onNotification, subscribeToKeywords } from './services/socket';
import { cn } from './lib/utils';
import { Spotlight } from './components/ui/spotlight';
import { BackgroundBeams } from './components/ui/background-beams';
import { Meteors } from './components/ui/meteors';
import FilterSortBar, { defaultFilterState, type FilterState } from './components/FilterSortBar';
import { sortHotspots } from './utils/sortHotspots';
import { relativeTime, formatDateTime } from './utils/relativeTime';
// TextGenerateEffect available for future use

/** 计算热度综合指标（归一化 0-100） */
function calcHeatScore(h: Hotspot): number {
  const likes = h.likeCount ?? 0;
  const retweets = h.retweetCount ?? 0;
  const replies = h.replyCount ?? 0;
  const comments = h.commentCount ?? 0;
  const quotes = h.quoteCount ?? 0;
  const views = h.viewCount ?? 0;
  // 加权公式：转发最重、其次点赞、然后评论/回复
  const raw = likes * 2 + retweets * 3 + replies * 1.5 + comments * 1.5 + quotes * 2 + views / 100;
  // log 压缩到 0-100
  if (raw <= 0) return 0;
  return Math.min(100, Math.round(Math.log10(raw + 1) * 25));
}

function getHeatLevel(score: number): { label: string; color: string } {
  if (score >= 80) return { label: '爆', color: 'text-red-400' };
  if (score >= 60) return { label: '热', color: 'text-orange-400' };
  if (score >= 40) return { label: '温', color: 'text-amber-400' };
  if (score >= 20) return { label: '凉', color: 'text-blue-400' };
  return { label: '冷', color: 'text-slate-500' };
}

function App() {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  
  const [newKeyword, setNewKeyword] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'keywords' | 'search'>('dashboard');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [dashboardFilters, setDashboardFilters] = useState<FilterState>({ ...defaultFilterState });
  const [searchFilters, setSearchFilters] = useState<FilterState>({ ...defaultFilterState });
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchResults, setSearchResults] = useState<Hotspot[]>([]);
  // 展开/折叠状态
  const [expandedReasons, setExpandedReasons] = useState<Set<string>>(new Set());
  const [expandedContents, setExpandedContents] = useState<Set<string>>(new Set());
  const [allReasonsExpanded, setAllReasonsExpanded] = useState(false);

  // 加载数据
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const filterParams: Record<string, string | number> = {
        limit: 20,
        page: currentPage,
      };
      // Apply dashboard filters
      if (dashboardFilters.source) filterParams.source = dashboardFilters.source;
      if (dashboardFilters.importance) filterParams.importance = dashboardFilters.importance;
      if (dashboardFilters.keywordId) filterParams.keywordId = dashboardFilters.keywordId;
      if (dashboardFilters.timeRange) filterParams.timeRange = dashboardFilters.timeRange;
      if (dashboardFilters.isReal) filterParams.isReal = dashboardFilters.isReal;
      if (dashboardFilters.sortBy) filterParams.sortBy = dashboardFilters.sortBy;
      if (dashboardFilters.sortOrder) filterParams.sortOrder = dashboardFilters.sortOrder;

      const [keywordsData, hotspotsData, statsData, notifData] = await Promise.all([
        keywordsApi.getAll(),
        hotspotsApi.getAll(filterParams as any),
        hotspotsApi.getStats(),
        notificationsApi.getAll({ limit: 20 })
      ]);
      setKeywords(keywordsData);
      setHotspots(hotspotsData.data);
      setTotalPages(hotspotsData.pagination.totalPages);
      setStats(statsData);
      setNotifications(notifData.data);
      setUnreadCount(notifData.unreadCount);

      // 订阅关键词
      const activeKeywords = keywordsData.filter(k => k.isActive).map(k => k.text);
      if (activeKeywords.length > 0) {
        subscribeToKeywords(activeKeywords);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [dashboardFilters, currentPage]);

  // 当筛选条件变化时重置页码
  useEffect(() => {
    setCurrentPage(1);
  }, [dashboardFilters]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // WebSocket 事件
  useEffect(() => {
    const unsubHotspot = onNewHotspot((hotspot) => {
      setHotspots(prev => [hotspot as Hotspot, ...prev.slice(0, 19)]);
      showToast('发现新热点: ' + hotspot.title.slice(0, 30), 'success');
      loadData();
    });

    const unsubNotif = onNotification(() => {
      setUnreadCount(prev => prev + 1);
    });

    return () => {
      unsubHotspot();
      unsubNotif();
    };
  }, [loadData]);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // 添加关键词
  const handleAddKeyword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyword.trim()) return;

    try {
      const keyword = await keywordsApi.create({ text: newKeyword.trim() });
      setKeywords(prev => [keyword, ...prev]);
      setNewKeyword('');
      showToast('关键词添加成功', 'success');
      subscribeToKeywords([keyword.text]);
    } catch (error: any) {
      showToast(error.message || '添加失败', 'error');
    }
  };

  // 删除关键词
  const handleDeleteKeyword = async (id: string) => {
    try {
      await keywordsApi.delete(id);
      setKeywords(prev => prev.filter(k => k.id !== id));
      showToast('关键词已删除', 'success');
    } catch (error) {
      showToast('删除失败', 'error');
    }
  };

  // 切换关键词状态
  const handleToggleKeyword = async (id: string) => {
    try {
      const updated = await keywordsApi.toggle(id);
      setKeywords(prev => prev.map(k => k.id === id ? updated : k));
    } catch (error) {
      showToast('操作失败', 'error');
    }
  };

  // 手动搜索
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsLoading(true);
    try {
      const result = await hotspotsApi.search(searchQuery);
      setSearchResults(result.results);
      showToast(`找到 ${result.results.length} 条结果`, 'success');
    } catch (error) {
      showToast('搜索失败', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // 手动触发检查
  const handleManualCheck = async () => {
    setIsChecking(true);
    try {
      await triggerHotspotCheck();
      showToast('热点检查已触发', 'success');
      setTimeout(loadData, 5000);
    } catch (error) {
      showToast('触发失败', 'error');
    } finally {
      setIsChecking(false);
    }
  };

  // 标记通知为已读
  const handleMarkAllRead = async () => {
    try {
      await notificationsApi.markAllAsRead();
      setUnreadCount(0);
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    } catch (error) {
      console.error('Failed to mark as read:', error);
    }
  };

  // 展开/折叠相关性理由
  const toggleReason = (id: string) => {
    setExpandedReasons(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // 展开/折叠原始内容
  const toggleContent = (id: string) => {
    setExpandedContents(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // 一键展开/折叠所有相关性理由
  const toggleAllReasons = (list: Hotspot[]) => {
    if (allReasonsExpanded) {
      setExpandedReasons(new Set());
    } else {
      setExpandedReasons(new Set(list.filter(h => h.relevanceReason).map(h => h.id)));
    }
    setAllReasonsExpanded(!allReasonsExpanded);
  };

  // Client-side filtering/sorting for search results
  const filteredSearchResults = useMemo(() => {
    let results = [...searchResults];

    // Apply filters
    if (searchFilters.source) {
      results = results.filter(h => h.source === searchFilters.source);
    }
    if (searchFilters.importance) {
      results = results.filter(h => h.importance === searchFilters.importance);
    }
    if (searchFilters.isReal === 'true') {
      results = results.filter(h => h.isReal);
    } else if (searchFilters.isReal === 'false') {
      results = results.filter(h => !h.isReal);
    }
    if (searchFilters.keywordId) {
      results = results.filter(h => h.keyword?.id === searchFilters.keywordId);
    }
    if (searchFilters.timeRange) {
      const now = new Date();
      let dateFrom: Date | null = null;
      switch (searchFilters.timeRange) {
        case '1h': dateFrom = new Date(now.getTime() - 60 * 60 * 1000); break;
        case 'today': dateFrom = new Date(now); dateFrom.setHours(0, 0, 0, 0); break;
        case '7d': dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
        case '30d': dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
      }
      if (dateFrom) {
        results = results.filter(h => new Date(h.createdAt) >= dateFrom!);
      }
    }

    // Apply sorting using shared utility
    results = sortHotspots(results, searchFilters.sortBy || 'createdAt', (searchFilters.sortOrder || 'desc') as 'asc' | 'desc');

    return results;
  }, [searchResults, searchFilters]);

  const getImportanceIcon = (importance: string) => {
    switch (importance) {
      case 'urgent': return <AlertTriangle className="w-4 h-4" />;
      case 'high': return <Flame className="w-4 h-4" />;
      case 'medium': return <Zap className="w-4 h-4" />;
      default: return <TrendingUp className="w-4 h-4" />;
    }
  };

  const getSourceIcon = (source: string) => {
    switch (source) {
      case 'twitter': return <Twitter className="w-4 h-4" />;
      case 'bilibili': return <Eye className="w-4 h-4" />;
      case 'weibo': return <Activity className="w-4 h-4" />;
      case 'sogou': return <Search className="w-4 h-4" />;
      case 'hackernews': return <Zap className="w-4 h-4" />;
      default: return <Globe className="w-4 h-4" />;
    }
  };

  const getSourceLabel = (source: string) => {
    const labels: Record<string, string> = {
      twitter: 'Twitter',
      bing: 'Bing',
      google: 'Google',
      sogou: '搜狗',
      bilibili: 'Bilibili',
      weibo: '微博热搜',
      hackernews: 'HackerNews',
      duckduckgo: 'DuckDuckGo'
    };
    return labels[source] || source;
  };

  return (
    <div className="min-h-screen bg-[#050510] relative overflow-hidden">
      {/* Background Effects */}
      <BackgroundBeams className="z-0" />
      <Spotlight className="-top-40 left-0 md:left-60 md:-top-20" fill="#3b82f6" />
      
      {/* Subtle gradient orbs */}
      <div className="fixed top-0 right-0 w-[600px] h-[600px] bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="fixed bottom-0 left-0 w-[400px] h-[400px] bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -20 }}
            className={cn(
              "fixed top-6 left-1/2 z-50 px-5 py-3 rounded-xl backdrop-blur-xl flex items-center gap-3 shadow-2xl",
              toast.type === 'success' 
                ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400' 
                : 'bg-red-500/10 border border-red-500/30 text-red-400'
            )}
          >
            {toast.type === 'success' ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
            <span className="text-sm font-medium">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header - Minimal & Clean */}
      <header className="sticky top-0 z-40 backdrop-blur-2xl bg-[#050510]/70 border-b border-white/5">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-blue-500/20">
                  <Flame className="w-5 h-5 text-white" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-emerald-400 rounded-full border-2 border-[#050510] animate-pulse" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-white tracking-tight">HotPulse</h1>
                <p className="text-xs text-slate-500">AI 热点雷达</p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <motion.button
                onClick={handleManualCheck}
                disabled={isChecking}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className={cn(
                  "px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 transition-all",
                  isChecking 
                    ? "bg-blue-500/20 text-blue-400 cursor-wait"
                    : "bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40"
                )}
              >
                <RefreshCw className={cn("w-4 h-4", isChecking && "animate-spin")} />
                {isChecking ? '扫描中' : '立即扫描'}
              </motion.button>

              {/* Notifications */}
              <div className="relative">
                <button
                  onClick={() => setShowNotifications(!showNotifications)}
                  className="relative p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 transition-all"
                >
                  <Bell className="w-5 h-5 text-slate-400" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-[10px] font-bold flex items-center justify-center text-white">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>

                <AnimatePresence>
                  {showNotifications && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.96 }}
                      className="absolute right-0 top-14 w-80 bg-[#0a0a1a]/95 backdrop-blur-2xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
                    >
                      <div className="flex items-center justify-between p-4 border-b border-white/5">
                        <h3 className="font-medium text-white">通知</h3>
                        {unreadCount > 0 && (
                          <button onClick={handleMarkAllRead} className="text-xs text-blue-400 hover:text-blue-300">
                            全部已读
                          </button>
                        )}
                      </div>
                      <div className="max-h-80 overflow-y-auto">
                        {notifications.length === 0 ? (
                          <p className="text-slate-500 text-sm text-center py-8">暂无通知</p>
                        ) : (
                          <div className="divide-y divide-white/5">
                            {notifications.slice(0, 5).map(n => (
                              <div key={n.id} className={cn("p-4 transition-colors", n.isRead ? 'opacity-50' : 'hover:bg-white/5')}>
                                <p className="text-sm font-medium text-white">{n.title}</p>
                                <p className="text-xs text-slate-500 mt-1 line-clamp-2">{n.content}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 max-w-6xl mx-auto px-6 py-8">
        {/* Navigation Tabs */}
        <div className="flex gap-2 mb-8">
          {([
            { key: 'dashboard', label: '热点雷达', icon: Activity },
            { key: 'keywords', label: '监控词', icon: Target },
            { key: 'search', label: '搜索', icon: Search },
          ] as const).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={cn(
                "px-5 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 transition-all",
                activeTab === key 
                  ? 'bg-white/10 text-white border border-white/10' 
                  : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
          <div className="space-y-8">
            {/* Hero Stats */}
            {stats && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="relative group p-5 rounded-2xl bg-gradient-to-br from-blue-500/10 to-transparent border border-blue-500/10 overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="relative">
                    <div className="flex items-center gap-2 text-slate-500 text-sm mb-2">
                      <Activity className="w-4 h-4" />
                      总热点
                    </div>
                    <p className="text-3xl font-bold text-white">{stats.total}</p>
                  </div>
                </motion.div>

                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 }}
                  className="relative group p-5 rounded-2xl bg-gradient-to-br from-cyan-500/10 to-transparent border border-cyan-500/10 overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="relative">
                    <div className="flex items-center gap-2 text-slate-500 text-sm mb-2">
                      <Clock className="w-4 h-4" />
                      今日新增
                    </div>
                    <p className="text-3xl font-bold text-cyan-400">{stats.today}</p>
                  </div>
                </motion.div>

                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="relative group p-5 rounded-2xl bg-gradient-to-br from-red-500/10 to-transparent border border-red-500/10 overflow-hidden"
                >
                  <Meteors number={6} />
                  <div className="relative">
                    <div className="flex items-center gap-2 text-slate-500 text-sm mb-2">
                      <AlertTriangle className="w-4 h-4" />
                      紧急热点
                    </div>
                    <p className="text-3xl font-bold text-red-400">{stats.urgent}</p>
                  </div>
                </motion.div>

                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 }}
                  className="relative group p-5 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-transparent border border-emerald-500/10 overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="relative">
                    <div className="flex items-center gap-2 text-slate-500 text-sm mb-2">
                      <Target className="w-4 h-4" />
                      监控词
                    </div>
                    <p className="text-3xl font-bold text-emerald-400">{keywords.filter(k => k.isActive).length}</p>
                  </div>
                </motion.div>
              </div>
            )}

            {/* Hotspots Feed */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Flame className="w-5 h-5 text-orange-500" />
                  实时热点流
                </h2>
                <span className="text-xs text-slate-600">每 30 分钟自动更新</span>
              </div>

              {/* Filter & Sort Bar */}
              <div className="mb-5">
                <FilterSortBar
                  filters={dashboardFilters}
                  onChange={setDashboardFilters}
                  keywords={keywords}
                />
              </div>
              
              {isLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                </div>
              ) : hotspots.length === 0 ? (
                <div className="text-center py-16 rounded-2xl border border-dashed border-white/10">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/5 flex items-center justify-center">
                    <Search className="w-8 h-8 text-slate-600" />
                  </div>
                  <p className="text-slate-500">尚未发现热点</p>
                  <p className="text-sm text-slate-600 mt-1">添加监控关键词开始追踪</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* 一键展开/折叠所有理由 */}
                  {hotspots.some(h => h.relevanceReason) && (
                    <div className="flex justify-end">
                      <button
                        onClick={() => toggleAllReasons(hotspots)}
                        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-blue-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5"
                      >
                        <ChevronsUpDown className="w-3.5 h-3.5" />
                        {allReasonsExpanded ? '折叠所有理由' : '展开所有理由'}
                      </button>
                    </div>
                  )}

                  {hotspots.map((hotspot, index) => {
                    const heatScore = calcHeatScore(hotspot);
                    const heat = getHeatLevel(heatScore);
                    return (
                    <motion.div
                      key={hotspot.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.03 }}
                      className="group p-5 rounded-2xl bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 hover:border-white/10 transition-all"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          {/* Row 1: Meta badges */}
                          <div className="flex flex-wrap items-center gap-2 mb-3">
                            <span className={cn(
                              "px-2.5 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wider flex items-center",
                              hotspot.importance === 'urgent' && "bg-red-500/15 text-red-400 border border-red-500/20",
                              hotspot.importance === 'high' && "bg-orange-500/15 text-orange-400 border border-orange-500/20",
                              hotspot.importance === 'medium' && "bg-amber-500/15 text-amber-400 border border-amber-500/20",
                              hotspot.importance === 'low' && "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                            )}>
                              {getImportanceIcon(hotspot.importance)}
                              <span className="ml-1">{hotspot.importance}</span>
                            </span>
                            <span className="flex items-center gap-1 text-xs text-slate-600">
                              {getSourceIcon(hotspot.source)}
                              {getSourceLabel(hotspot.source)}
                            </span>
                            {hotspot.keyword && (
                              <span className="text-[10px] px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                {hotspot.keyword.text}
                              </span>
                            )}
                            {/* 真实性标记 */}
                            {!hotspot.isReal && (
                              <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-red-500/10 text-red-400 border border-red-500/20">
                                <ShieldAlert className="w-3 h-3" />
                                可疑
                              </span>
                            )}
                            {hotspot.isReal && hotspot.relevance >= 80 && (
                              <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                <Shield className="w-3 h-3" />
                                可信
                              </span>
                            )}
                            {hotspot.keywordMentioned === true && (
                              <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-400 border border-purple-500/20">
                                <Target className="w-3 h-3" />
                                直接提及
                              </span>
                            )}
                            {hotspot.keywordMentioned === false && (
                              <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-yellow-500/10 text-yellow-500 border border-yellow-500/20">
                                <Target className="w-3 h-3" />
                                间接相关
                              </span>
                            )}
                            {/* 热度综合指标 */}
                            <span className={cn("flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-white/5 border border-white/10 font-medium", heat.color)}>
                              <ThermometerSun className="w-3 h-3" />
                              {heat.label} {heatScore}
                            </span>
                          </div>
                          
                          {/* Title */}
                          <h3 className="font-medium text-white mb-2 line-clamp-2 group-hover:text-blue-400 transition-colors">
                            {hotspot.title}
                          </h3>
                          
                          {/* AI Summary - 标注 */}
                          {hotspot.summary && (
                            <div className="mb-3">
                              <span className="text-[10px] text-blue-400/60 font-medium mr-1.5">AI 摘要</span>
                              <span className="text-sm text-slate-500">{hotspot.summary}</span>
                            </div>
                          )}

                          {/* 作者信息 */}
                          {hotspot.authorName && (
                            <div className="flex items-center gap-2 mb-3">
                              {hotspot.authorAvatar ? (
                                <img src={hotspot.authorAvatar} alt="" className="w-5 h-5 rounded-full object-cover" />
                              ) : (
                                <User className="w-4 h-4 text-slate-600" />
                              )}
                              <span className="text-xs text-slate-400">
                                {hotspot.authorName}
                                {hotspot.authorUsername && <span className="text-slate-600 ml-1">@{hotspot.authorUsername}</span>}
                              </span>
                              {hotspot.authorVerified && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400">✓ 认证</span>
                              )}
                              {hotspot.authorFollowers != null && hotspot.authorFollowers > 0 && (
                                <span className="text-[10px] text-slate-600">{hotspot.authorFollowers.toLocaleString()} 粉丝</span>
                              )}
                            </div>
                          )}
                          
                          {/* 互动数据 */}
                          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 mb-2">
                            <span className="flex items-center gap-1">
                              <Target className="w-3.5 h-3.5" />
                              相关性 {hotspot.relevance}%
                            </span>
                            {hotspot.likeCount != null && hotspot.likeCount > 0 && (
                              <span className="flex items-center gap-1" title="点赞">
                                <Zap className="w-3.5 h-3.5" />
                                {hotspot.likeCount.toLocaleString()}
                              </span>
                            )}
                            {hotspot.retweetCount != null && hotspot.retweetCount > 0 && (
                              <span className="flex items-center gap-1" title="转发">
                                <Repeat2 className="w-3.5 h-3.5" />
                                {hotspot.retweetCount.toLocaleString()}
                              </span>
                            )}
                            {hotspot.replyCount != null && hotspot.replyCount > 0 && (
                              <span className="flex items-center gap-1" title="回复">
                                <MessageCircle className="w-3.5 h-3.5" />
                                {hotspot.replyCount.toLocaleString()}
                              </span>
                            )}
                            {hotspot.commentCount != null && hotspot.commentCount > 0 && (
                              <span className="flex items-center gap-1" title="评论">
                                <MessageCircle className="w-3.5 h-3.5" />
                                {hotspot.commentCount.toLocaleString()}
                              </span>
                            )}
                            {hotspot.quoteCount != null && hotspot.quoteCount > 0 && (
                              <span className="flex items-center gap-1" title="引用">
                                <Quote className="w-3.5 h-3.5" />
                                {hotspot.quoteCount.toLocaleString()}
                              </span>
                            )}
                            {hotspot.viewCount != null && hotspot.viewCount > 0 && (
                              <span className="flex items-center gap-1" title="浏览量">
                                <Eye className="w-3.5 h-3.5" />
                                {hotspot.viewCount.toLocaleString()}
                              </span>
                            )}
                            {hotspot.danmakuCount != null && hotspot.danmakuCount > 0 && (
                              <span className="flex items-center gap-1" title="弹幕">
                                💬 {hotspot.danmakuCount.toLocaleString()}
                              </span>
                            )}
                          </div>

                          {/* 时间信息 */}
                          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
                            {hotspot.publishedAt && (
                              <span className="flex items-center gap-1" title={`发布于 ${formatDateTime(hotspot.publishedAt)}`}>
                                <Clock className="w-3 h-3" />
                                发布 {relativeTime(hotspot.publishedAt)}
                              </span>
                            )}
                            <span className="flex items-center gap-1" title={`抓取于 ${formatDateTime(hotspot.createdAt)}`}>
                              <Activity className="w-3 h-3" />
                              抓取 {relativeTime(hotspot.createdAt)}
                            </span>
                          </div>

                          {/* AI 相关性理由 - 可折叠 */}
                          {hotspot.relevanceReason && (
                            <div className="mt-2">
                              <button
                                onClick={() => toggleReason(hotspot.id)}
                                className="flex items-center gap-1 text-[11px] text-blue-400/70 hover:text-blue-400 transition-colors"
                              >
                                {expandedReasons.has(hotspot.id) ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                AI 分析理由
                              </button>
                              <AnimatePresence>
                                {expandedReasons.has(hotspot.id) && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="overflow-hidden"
                                  >
                                    <p className="text-xs text-slate-500 mt-1 pl-4 border-l-2 border-blue-500/20">
                                      {hotspot.relevanceReason}
                                    </p>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          )}

                          {/* 原始内容 - 可折叠 */}
                          {hotspot.content && hotspot.content !== hotspot.summary && (
                            <div className="mt-2">
                              <button
                                onClick={() => toggleContent(hotspot.id)}
                                className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
                              >
                                {expandedContents.has(hotspot.id) ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                <FileText className="w-3 h-3" />
                                原始内容
                              </button>
                              <AnimatePresence>
                                {expandedContents.has(hotspot.id) && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="overflow-hidden"
                                  >
                                    <p className="text-xs text-slate-500 mt-1 pl-4 border-l-2 border-white/10 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                                      {hotspot.content}
                                    </p>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          )}
                        </div>
                        
                        {/* Link */}
                        <a
                          href={hotspot.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="p-2.5 rounded-xl bg-white/5 hover:bg-blue-500/20 text-slate-500 hover:text-blue-400 transition-all opacity-0 group-hover:opacity-100"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      </div>
                    </motion.div>
                    );
                  })}
                </div>
              )}

              {/* Pagination */}
              {totalPages > 1 && !isLoading && (
                <div className="flex items-center justify-center gap-3 mt-6">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                    className="p-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:border-white/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <div className="flex items-center gap-1.5">
                    {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                      let page: number;
                      if (totalPages <= 7) {
                        page = i + 1;
                      } else if (currentPage <= 4) {
                        page = i + 1;
                      } else if (currentPage >= totalPages - 3) {
                        page = totalPages - 6 + i;
                      } else {
                        page = currentPage - 3 + i;
                      }
                      return (
                        <button
                          key={page}
                          onClick={() => setCurrentPage(page)}
                          className={cn(
                            "w-8 h-8 rounded-lg text-xs font-medium transition-all",
                            currentPage === page
                              ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                              : "text-slate-500 hover:text-white hover:bg-white/5"
                          )}
                        >
                          {page}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
                    className="p-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:border-white/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <span className="text-xs text-slate-600 ml-2">
                    共 {stats?.total || 0} 条
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Keywords Tab */}
        {activeTab === 'keywords' && (
          <div className="space-y-6">
            {/* Add Keyword Card */}
            <form onSubmit={handleAddKeyword} className="p-5 rounded-2xl bg-white/[0.02] border border-white/5">
              <div className="flex gap-3">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={newKeyword}
                    onChange={(e) => setNewKeyword(e.target.value)}
                    placeholder="输入要监控的关键词，如：GPT-5、AI编程、Cursor..."
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 transition-all"
                  />
                </div>
                <motion.button 
                  type="submit" 
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="px-6 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 text-white font-medium flex items-center gap-2 shadow-lg shadow-blue-500/25"
                >
                  <Plus className="w-4 h-4" />
                  添加
                </motion.button>
              </div>
            </form>

            {/* Keywords Grid */}
            <div className="grid gap-3 md:grid-cols-2">
              <AnimatePresence>
                {keywords.map((keyword, i) => (
                  <motion.div
                    key={keyword.id}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ delay: i * 0.02 }}
                    className={cn(
                      "group p-4 rounded-xl border transition-all",
                      keyword.isActive 
                        ? "bg-white/[0.03] border-blue-500/20 hover:border-blue-500/30" 
                        : "bg-white/[0.01] border-white/5 opacity-60"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {/* Toggle */}
                        <button
                          onClick={() => handleToggleKeyword(keyword.id)}
                          className={cn(
                            "w-11 h-6 rounded-full transition-all relative",
                            keyword.isActive ? "bg-blue-500" : "bg-slate-700"
                          )}
                        >
                          <span className={cn(
                            "absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all",
                            keyword.isActive ? "left-6" : "left-1"
                          )} />
                        </button>
                        
                        <div>
                          <span className={cn("font-medium", keyword.isActive ? "text-white" : "text-slate-500")}>
                            {keyword.text}
                          </span>
                          {keyword._count && keyword._count.hotspots > 0 && (
                            <span className="ml-2 text-xs text-slate-600">
                              {keyword._count.hotspots} 条热点
                            </span>
                          )}
                        </div>
                      </div>
                      
                      <button
                        onClick={() => handleDeleteKeyword(keyword.id)}
                        className="p-2 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {keywords.length === 0 && (
              <div className="text-center py-16 rounded-2xl border border-dashed border-white/10">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/5 flex items-center justify-center">
                  <Target className="w-8 h-8 text-slate-600" />
                </div>
                <p className="text-slate-500">还没有监控关键词</p>
                <p className="text-sm text-slate-600 mt-1">添加你想追踪的技术热点词</p>
              </div>
            )}
          </div>
        )}

        {/* Search Tab */}
        {activeTab === 'search' && (
          <div className="space-y-6">
            {/* Search Form */}
            <form onSubmit={handleSearch} className="p-5 rounded-2xl bg-white/[0.02] border border-white/5">
              <div className="flex gap-3">
                <div className="flex-1 relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-600" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索热点内容..."
                    className="w-full pl-12 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 transition-all"
                  />
                </div>
                <motion.button 
                  type="submit" 
                  disabled={isLoading}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="px-6 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 text-white font-medium flex items-center gap-2 shadow-lg shadow-blue-500/25 disabled:opacity-50"
                >
                  {isLoading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Search className="w-4 h-4" />
                  )}
                  搜索
                </motion.button>
              </div>
            </form>

            {/* Search Filter & Sort Bar */}
            <FilterSortBar
              filters={searchFilters}
              onChange={setSearchFilters}
              keywords={keywords}
            />

            {/* Search Results */}
            <div className="space-y-3">
              {filteredSearchResults.length === 0 && searchResults.length > 0 && (
                <div className="text-center py-12 rounded-2xl border border-dashed border-white/10">
                  <p className="text-slate-500">当前筛选条件下无结果</p>
                  <p className="text-sm text-slate-600 mt-1">尝试调整筛选条件</p>
                </div>
              )}
              {filteredSearchResults.map((hotspot, i) => {
                const heatScore = calcHeatScore(hotspot);
                const heat = getHeatLevel(heatScore);
                return (
                <motion.div 
                  key={hotspot.id} 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="group p-5 rounded-2xl bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 transition-all"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        <span className={cn(
                          "px-2.5 py-1 rounded-lg text-[10px] font-semibold uppercase flex items-center",
                          hotspot.importance === 'urgent' && "bg-red-500/15 text-red-400 border border-red-500/20",
                          hotspot.importance === 'high' && "bg-orange-500/15 text-orange-400 border border-orange-500/20",
                          hotspot.importance === 'medium' && "bg-amber-500/15 text-amber-400 border border-amber-500/20",
                          hotspot.importance === 'low' && "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                        )}>
                          {getImportanceIcon(hotspot.importance)}
                          <span className="ml-1">{hotspot.importance}</span>
                        </span>
                        <span className="flex items-center gap-1 text-xs text-slate-600">
                          {getSourceIcon(hotspot.source)}
                          {getSourceLabel(hotspot.source)}
                        </span>
                        {!hotspot.isReal && (
                          <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-red-500/10 text-red-400 border border-red-500/20">
                            <ShieldAlert className="w-3 h-3" />
                            可疑
                          </span>
                        )}
                        <span className={cn("flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-white/5 border border-white/10 font-medium", heat.color)}>
                          <ThermometerSun className="w-3 h-3" />
                          {heat.label} {heatScore}
                        </span>
                      </div>
                      <h3 className="font-medium text-white mb-2 group-hover:text-blue-400 transition-colors">{hotspot.title}</h3>
                      {hotspot.summary && (
                        <div className="mb-2">
                          <span className="text-[10px] text-blue-400/60 font-medium mr-1.5">AI 摘要</span>
                          <span className="text-sm text-slate-500">{hotspot.summary}</span>
                        </div>
                      )}
                      {hotspot.authorName && (
                        <div className="flex items-center gap-2 mb-2">
                          <User className="w-4 h-4 text-slate-600" />
                          <span className="text-xs text-slate-400">{hotspot.authorName}</span>
                          {hotspot.authorVerified && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400">✓ 认证</span>
                          )}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                        <span className="flex items-center gap-1">
                          <Target className="w-3.5 h-3.5" />
                          相关性 {hotspot.relevance}%
                        </span>
                        {hotspot.likeCount != null && hotspot.likeCount > 0 && (
                          <span className="flex items-center gap-1" title="点赞">
                            <Zap className="w-3.5 h-3.5" />
                            {hotspot.likeCount.toLocaleString()}
                          </span>
                        )}
                        {hotspot.viewCount != null && hotspot.viewCount > 0 && (
                          <span className="flex items-center gap-1" title="浏览量">
                            <Eye className="w-3.5 h-3.5" />
                            {hotspot.viewCount.toLocaleString()}
                          </span>
                        )}
                      </div>
                      {hotspot.publishedAt && (
                        <div className="flex items-center gap-1 text-[11px] text-slate-600 mt-1" title={formatDateTime(hotspot.publishedAt)}>
                          <Clock className="w-3 h-3" />
                          发布 {relativeTime(hotspot.publishedAt)}
                        </div>
                      )}
                    </div>
                    <a
                      href={hotspot.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 px-4 py-2 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-sm font-medium transition-all"
                    >
                      查看
                    </a>
                  </div>
                </motion.div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
