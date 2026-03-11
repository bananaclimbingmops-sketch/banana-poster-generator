import { useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronUp, Trash2, Clock, RotateCcw } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import type { PosterRecord } from '@/hooks/usePosterHistory';

interface Props {
  history: PosterRecord[];
  onRestore: (record: PosterRecord) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function PosterHistoryPanel({ history, onRestore, onDelete, onClear }: Props) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // 点击面板外部时关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={panelRef} className="relative" style={{ zIndex: 50 }}>
      {/* 触发按钮 */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white shadow-md border border-gray-200 hover:bg-yellow-50 hover:border-yellow-300 transition-all text-sm font-semibold text-gray-700 select-none"
      >
        <Clock className="w-4 h-4 text-yellow-500" />
        生成记录
        {history.length > 0 && (
          <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-yellow-400 text-black text-xs font-bold leading-none">
            {history.length}
          </span>
        )}
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {/* 下拉面板 */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="absolute right-0 top-full mt-2 w-[680px] max-h-[70vh] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-gray-100 p-5"
          >
            {/* 面板标题 */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-900">
                生成记录
                <span className="ml-2 text-sm font-normal text-gray-400">
                  共 {history.length} 条（最多保留 20 条）
                </span>
              </h3>
              {history.length > 0 && (
                <button
                  onClick={() => {
                    if (confirm('确定要清空所有生成记录吗？此操作不可撤销。')) {
                      onClear();
                    }
                  }}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  清空全部
                </button>
              )}
            </div>

            {/* 空状态 */}
            {history.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                <Clock className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-sm">暂无生成记录</p>
                <p className="text-xs mt-1">下载海报后将自动保存记录</p>
              </div>
            )}

            {/* 记录网格 */}
            {history.length > 0 && (
              <div className="grid grid-cols-3 gap-4">
                {history.map((record) => (
                  <div
                    key={record.id}
                    className="group relative rounded-xl overflow-hidden border border-gray-100 hover:border-yellow-300 hover:shadow-md transition-all cursor-pointer bg-gray-50"
                    onClick={() => {
                      onRestore(record);
                      setOpen(false);
                    }}
                  >
                    {/* 缩略图 */}
                    <div className="aspect-[2/3] bg-yellow-50 flex items-center justify-center overflow-hidden">
                      {record.thumbnail ? (
                        <img
                          src={record.thumbnail}
                          alt={record.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="flex flex-col items-center text-gray-300">
                          <Clock className="w-8 h-8 mb-1" />
                          <span className="text-xs">无预览图</span>
                        </div>
                      )}
                    </div>

                    {/* 悬停遮罩 */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-yellow-400 text-black text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow">
                        <RotateCcw className="w-3.5 h-3.5" />
                        恢复编辑
                      </div>
                    </div>

                    {/* 删除按钮 */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(record.id);
                      }}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 hover:bg-red-50 text-gray-500 hover:text-red-500 rounded-full p-1 shadow"
                      title="删除此记录"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>

                    {/* 底部信息 */}
                    <div className="p-2 border-t border-gray-100">
                      <p className="text-xs font-semibold text-gray-800 truncate">
                        {record.title || '未命名海报'}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {formatDate(record.createdAt)} · {record.climbers.length} 位定线员
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
