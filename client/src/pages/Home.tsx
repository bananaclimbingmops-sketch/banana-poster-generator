import { useState, useCallback, useRef, memo } from 'react';
import ClimberEditModal from '@/components/ClimberEditModal';
import BatchImportModal from '@/components/BatchImportModal';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Upload, Download, Plus, Loader2, RotateCcw, FolderUp, Trash2, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import PosterPreview, { POSTER_SIZE_LABEL } from '@/components/PosterPreview';
import type { PosterSize } from '@/components/PosterPreview';
import { Switch } from '@/components/ui/switch';
import ClimberCard from '@/components/ClimberCard';
import { SortableListItem } from '@/components/SortableListItem';
import { nanoid } from 'nanoid';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { usePosterStorage } from '@/hooks/usePosterStorage';
import type { ScheduleEntry } from '@/hooks/usePosterStorage';
import { usePosterHistory, compressThumbnail } from '@/hooks/usePosterHistory';
import type { Climber } from '@/components/PosterPreview';
import { NATIONALITY_OPTIONS } from '@/assets/flagAssets';
import { removeBackground } from '@imgly/background-removal';
import PosterHistoryPanel from '@/components/PosterHistoryPanel';

// ─── 导出格式类型 ─────────────────────────────────────────────────────────────
type ExportFormat = 'png' | 'pdf';

// ─── 表单 Schema（使用 zod 进行类型安全的表单验证）────────────────────────────
const climberSchema = z.object({
  name: z.string().min(1, '请输入定线员名字'),
  bio: z.string().optional(),
  role: z.enum(['regular', 'special']),
  nationality: z.string().optional(),
});

type ClimberFormValues = z.infer<typeof climberSchema>;

// ─── 多次换线条目编辑行组件 ──────────────────────────────────────────────────
interface ScheduleEntryRowProps {
  entry: ScheduleEntry;
  onChange: (id: string, field: keyof ScheduleEntry, value: string) => void;
  onRemove: (id: string) => void;
}

const ScheduleEntryRow = memo(function ScheduleEntryRow({ entry, onChange, onRemove }: ScheduleEntryRowProps) {
  // 将 YYYY-MM-DD 字符串拆分为年/月/日三段
  const parseDateParts = (dateStr: string) => {
    if (!dateStr) return { y: '', m: '', d: '' };
    const [y, m, d] = dateStr.split('-');
    return { y: y || '', m: m || '', d: d || '' };
  };

  // 将年/月/日三段合并为 YYYY-MM-DD 字符串
  const buildDateStr = (y: string, m: string, d: string) => {
    if (!y && !m && !d) return '';
    const yy = y.padStart(4, '0');
    const mm = m.padStart(2, '0');
    const dd = d.padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  };

  const startParts = parseDateParts(entry.startDate);
  const endParts = parseDateParts(entry.endDate ?? '');

  const handleDateChange = (field: 'startDate' | 'endDate', part: 'y' | 'm' | 'd', val: string) => {
    const current = field === 'startDate' ? startParts : endParts;
    const updated = { ...current, [part]: val };
    onChange(entry.id, field, buildDateStr(updated.y, updated.m, updated.d));
  };

  // 三段日期输入组件
  const DateInput = ({ field, parts, label }: {
    field: 'startDate' | 'endDate';
    parts: { y: string; m: string; d: string };
    label: string;
  }) => (
    <div className="flex-1">
      <label className="block text-xs text-gray-500 mb-0.5">{label}</label>
      <div className="flex items-center gap-0.5">
        <Input
          type="number"
          min={2020} max={2099}
          placeholder="年"
          value={parts.y}
          onChange={(e) => handleDateChange(field, 'y', e.target.value)}
          className="h-8 text-xs text-center px-1"
          style={{ width: '3.8rem', minWidth: 0 }}
        />
        <span className="text-gray-400 text-xs flex-shrink-0">/</span>
        <Input
          type="number"
          min={1} max={12}
          placeholder="月"
          value={parts.m}
          onChange={(e) => handleDateChange(field, 'm', e.target.value)}
          className="h-8 text-xs text-center px-1"
          style={{ width: '2.4rem', minWidth: 0 }}
        />
        <span className="text-gray-400 text-xs flex-shrink-0">/</span>
        <Input
          type="number"
          min={1} max={31}
          placeholder="日"
          value={parts.d}
          onChange={(e) => handleDateChange(field, 'd', e.target.value)}
          className="h-8 text-xs text-center px-1"
          style={{ width: '2.4rem', minWidth: 0 }}
        />
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-1.5 p-3 bg-gray-50 rounded-xl border border-gray-100">
      <div className="flex items-start gap-2">
        <GripVertical size={14} className="text-gray-300 flex-shrink-0 mt-6" />
        <div className="flex gap-2 flex-1 flex-wrap">
          <DateInput field="startDate" parts={startParts} label="开始日期" />
          <DateInput field="endDate" parts={endParts} label="结束日期（跨天，选填）" />
        </div>
        <button
          onClick={() => onRemove(entry.id)}
          className="flex-shrink-0 p-1 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors mt-5"
        >
          <Trash2 size={14} />
        </button>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-0.5">换线区域描述（每行一条）</label>
        <Textarea
          value={entry.description}
          onChange={(e) => onChange(entry.id, 'description', e.target.value)}
          placeholder="如：二层抱石区 + 新手区换线"
          rows={2}
          className="resize-none text-xs"
        />
      </div>
    </div>
  );
});

// ─── 主页组件 ─────────────────────────────────────────────────────────────────
export default function Home() {
  // UX 优化：使用自定义 hook 实现状态持久化（localStorage）
  const {
    title,
    subtitle,
    schedule,
    climbers,
    climbersWithImages,
    posterMode,
    multiSchedules,
    multiScheduleNote,
    setTitle,
    setSubtitle,
    setSchedule,
    setPosterMode,
    setMultiSchedules,
    setMultiScheduleNote,
    setClimbers,
    resetState,
  } = usePosterStorage();

  // 闭馆换线开关 & 换线区域
  const [closedVenue, setClosedVenue] = useState(false);
  const [venueArea, setVenueArea] = useState('全场');

  // 海报尺寸和导出格式
  const [posterSize, setPosterSize] = useState<PosterSize>('60x90');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png');

  // 下载状态
  const [isDownloading, setIsDownloading] = useState(false);

  // 编辑弹窗：当前正在编辑的定线员 id
  const [editingClimberId, setEditingClimberId] = useState<string | null>(null);

  // 批量导入弹窗
  const [showBatchImport, setShowBatchImport] = useState(false);

  // 历史记录
  const { history, saveRecord, deleteRecord, clearHistory } = usePosterHistory();
  const editingClimber = climbers.find((c) => c.id === editingClimberId) ?? null;

  // 保存编辑后的定线员信息
  const handleSaveEdit = useCallback(
    (updated: Climber) => {
      setClimbers((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setEditingClimberId(null);
    },
    [setClimbers],
  );

  // 海报容器 ref（用于导出）
  const posterRef = useRef<HTMLDivElement>(null);

  // 当前待添加的图片 ObjectURL
  const [currentImage, setCurrentImage] = useState<string | undefined>();
  const currentObjectUrlRef = useRef<string | null>(null);

  // 图片上传区拖拽状态
  const [isDragOver, setIsDragOver] = useState(false);

  // AI 抠图开关
  const [autoRemoveBg, setAutoRemoveBg] = useState(false);

  // 抠图处理中状态
  const [isRemovingBg, setIsRemovingBg] = useState(false);

  // 文件 input ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // react-hook-form 表单
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ClimberFormValues>({
    resolver: zodResolver(climberSchema),
    defaultValues: { role: 'regular', nationality: '' },
  });

  /**
   * 处理图片文件：若开启 AI 抠图则调用 rembg 服务，否则直接使用 ObjectURL
   */
  // 将 Blob/File 转换为 base64 data URL（html-to-image 导出时需要 data URL，Blob URL 无法被序列化）
  const blobToDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  const processImageFile = useCallback(
    async (file: File) => {
      // 释放上一张图片的 ObjectURL（仅用于预览阶段）
      if (currentObjectUrlRef.current) {
        URL.revokeObjectURL(currentObjectUrlRef.current);
        currentObjectUrlRef.current = null;
      }

      if (autoRemoveBg) {
        setIsRemovingBg(true);
        // 先显示原图预览（Blob URL 仅用于预览，不存入 climber.image）
        const previewUrl = URL.createObjectURL(file);
        currentObjectUrlRef.current = previewUrl;
        setCurrentImage(previewUrl);

        try {
          // 浏览器端 WebAssembly 抠图，无需服务器 CPU
          const resultBlob = await removeBackground(file, {
            model: 'isnet_quint8', // 最小模型 (~40MB)，速度最快
            output: { format: 'image/png' },
          });
          // 释放原图预览 URL
          URL.revokeObjectURL(previewUrl);
          currentObjectUrlRef.current = null;
          // 转换为 base64 data URL，确保 html-to-image 导出时可以内嵌图片
          const dataUrl = await blobToDataUrl(resultBlob);
          setCurrentImage(dataUrl);
          toast.success('抠图完成！');
        } catch (err) {
          console.error('rembg failed:', err);
          toast.error('抠图失败，已保留原图');
        } finally {
          setIsRemovingBg(false);
        }
      } else {
        // 不抠图时也转换为 base64 data URL
        const dataUrl = await blobToDataUrl(file);
        setCurrentImage(dataUrl);
      }
    },
    [autoRemoveBg],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void processImageFile(file);
    },
    [processImageFile],
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void processImageFile(file);
    },
    [processImageFile],
  );

  // 添加定线员（由 react-hook-form 的 handleSubmit 调用，已完成验证）
  const onAddClimber = useCallback(
    (data: ClimberFormValues) => {
      const newClimber: Climber = {
        id: nanoid(),
        name: data.name,
        bio: data.bio ?? '',
        image: currentImage,
        role: data.role,
        nationality: data.nationality || undefined,
      };
      setClimbers((prev) => [...prev, newClimber]);
      reset();
      currentObjectUrlRef.current = null;
      setCurrentImage(undefined);
      if (fileInputRef.current) fileInputRef.current.value = '';
      toast.success('定线员添加成功');
    },
    [currentImage, setClimbers, reset],
  );

  const removeClimber = useCallback(
    (id: string) => {
      setClimbers((prev) => prev.filter((c) => c.id !== id));
      toast.success('定线员已移除');
    },
    [setClimbers],
  );

  // UX 优化：dnd-kit 拖拽排序传感器
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        setClimbers((prev) => {
          const oldIndex = prev.findIndex((c) => c.id === active.id);
          const newIndex = prev.findIndex((c) => c.id === over.id);
          return arrayMove(prev, oldIndex, newIndex);
        });
      }
    },
    [setClimbers],
  );

  // ─── 多次换线条目操作 ────────────────────────────────────────────────────────
  const addScheduleEntry = useCallback(() => {
    const newEntry: ScheduleEntry = {
      id: nanoid(),
      startDate: '',
      endDate: '',
      description: '',
    };
    setMultiSchedules((prev) => [...prev, newEntry]);
  }, [setMultiSchedules]);

  const updateScheduleEntry = useCallback(
    (id: string, field: keyof ScheduleEntry, value: string) => {
      setMultiSchedules((prev) =>
        prev.map((e) => (e.id === id ? { ...e, [field]: value } : e)),
      );
    },
    [setMultiSchedules],
  );

  const removeScheduleEntry = useCallback(
    (id: string) => {
      setMultiSchedules((prev) => prev.filter((e) => e.id !== id));
    },
    [setMultiSchedules],
  );

  /**
   * 导出海报
   */
  const downloadPoster = useCallback(async () => {
    if (!posterRef.current) return;
    setIsDownloading(true);
    try {
      const el = posterRef.current;
      // 根据目标物理尺寸（150dpi）计算所需 pixelRatio
      // 150dpi: 1cm = 150/2.54 ≈ 59.06 px
      const PX_PER_CM = 150 / 2.54;
      const TARGET_WIDTH_PX: Record<string, number> = {
        '60x90': Math.round(60 * PX_PER_CM), // 3543px
        '60x80': Math.round(60 * PX_PER_CM), // 3543px
        '59x79': Math.round(59 * PX_PER_CM), // 3484px
      };
      const cssWidth = el.getBoundingClientRect().width;
      const targetPx = TARGET_WIDTH_PX[posterSize] ?? Math.round(60 * PX_PER_CM);
      const pixelRatio = Math.ceil(targetPx / cssWidth);

      // 导出前隐藏拖拽手柄和移除按钮
      el.setAttribute('data-exporting', 'true');

      // html-to-image：让浏览器原生渲染，完全兼容现代 CSS
      await document.fonts.ready;
      await toPng(el, { pixelRatio, backgroundColor: '#FFDA2A', cacheBust: true });
      const dataUrl = await toPng(el, {
        pixelRatio,
        backgroundColor: '#FFDA2A',
        cacheBust: true,
      });

      el.removeAttribute('data-exporting');

      const timestamp = new Date().getTime();
      const sizeLabel = POSTER_SIZE_LABEL[posterSize].replace('×', 'x');

      // ── 自动保存历史记录 ──────────────────────────────────────────────────────
      try {
        const thumbnail = await compressThumbnail(dataUrl);
        await saveRecord({
          title,
          subtitle,
          schedule,
          closedVenue,
          venueArea,
          climbers: climbersWithImages,
          thumbnail,
        });
      } catch (e) {
        console.warn('Failed to save history record:', e);
      }

      if (exportFormat === 'png') {
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = `换线海报-${sizeLabel}-${timestamp}.png`;
        link.click();
        toast.success('海报 PNG 下载成功');
      } else {
        const [widthMm, heightMm] =
          posterSize === '60x90' ? [600, 900] :
          posterSize === '59x79' ? [590, 790] :
          [600, 800];
        const pdf = new jsPDF({
          orientation: 'portrait',
          unit: 'mm',
          format: [widthMm, heightMm],
        });
        pdf.addImage(dataUrl, 'PNG', 0, 0, widthMm, heightMm);
        pdf.save(`换线海报-${sizeLabel}-${timestamp}.pdf`);
        toast.success('海报 PDF 下载成功');
      }
    } catch (error) {
      console.error('Export error:', error);
      toast.error('海报导出失败，请重试');
    } finally {
      posterRef.current?.removeAttribute('data-exporting');
      setIsDownloading(false);
    }
  }, [posterSize, exportFormat, title, subtitle, schedule, closedVenue, venueArea, climbersWithImages, saveRecord]);

  return (
    <>
    <div className="min-h-screen bg-gray-50">
      {/* 顶部 Banner */}
      <div className="bg-gradient-to-r from-yellow-300 to-yellow-200 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-black text-black mb-1">香蕉换线海报生成器</h1>
            <p className="text-gray-700 text-sm">上传定线员图片和简介，生成换线海报</p>
          </div>
          <div className="flex items-center gap-3">
            <PosterHistoryPanel
              history={history}
              onRestore={(record) => {
                setTitle(record.title);
                setSubtitle(record.subtitle);
                setSchedule(record.schedule);
                setClosedVenue(record.closedVenue);
                setVenueArea(record.venueArea);
                setClimbers(record.climbers);
                toast.success('已恢复历史记录，可继续编辑');
              }}
              onDelete={deleteRecord}
              onClear={clearHistory}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                resetState();
                toast.success('已重置所有内容');
              }}
              className="text-gray-600 hover:text-black hover:bg-yellow-100"
              title="清空所有内容并重置"
            >
              <RotateCcw className="w-4 h-4 mr-1" />
              重置
            </Button>
          </div>
        </div>
        {/* 工具切换 Tab */}
        <div className="max-w-7xl mx-auto px-4 pb-0 flex gap-1">
          <div className="px-4 py-2 text-sm font-bold text-black bg-white rounded-t-lg shadow-sm">
            换线海报
          </div>
          <a
            href="/sticker"
            className="px-4 py-2 text-sm font-semibold text-gray-600 hover:text-black rounded-t-lg hover:bg-white/60 transition-colors"
          >
            定线员贴纸
          </a>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-4 py-8 flex gap-8">
        {/* ── 左侧：编辑面板 ─────────────────────────────────────────────────── */}
        <div className="w-72 flex-shrink-0 space-y-6">

          {/* 海报信息卡片 */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">海报信息</h2>

            {/* 标题 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">标题</label>
              <Input
                placeholder="请输入海报标题"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {/* 副标题 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">副标题</label>
              <Input
                placeholder="请输入副标题"
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
              />
            </div>

            {/* ── 海报模式切换 ── */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">换线模式</label>
              <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                <button
                  onClick={() => setPosterMode('single')}
                  className={`flex-1 py-2 text-sm font-medium transition-colors ${
                    posterMode === 'single'
                      ? 'bg-yellow-400 text-black'
                      : 'bg-white text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  单次换线
                </button>
                <button
                  onClick={() => setPosterMode('multi')}
                  className={`flex-1 py-2 text-sm font-medium transition-colors border-l border-gray-200 ${
                    posterMode === 'multi'
                      ? 'bg-yellow-400 text-black'
                      : 'bg-white text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  多次换线
                </button>
              </div>
            </div>

            {/* ── 单次换线：换线时间表 + 闭馆开关 + 换线区域 ── */}
            {posterMode === 'single' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">换线时间表</label>
                  <Textarea
                    placeholder="每行一条时间安排"
                    value={schedule}
                    onChange={(e) => setSchedule(e.target.value)}
                    rows={4}
                    className="resize-none"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-700">闭馆换线</label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">{closedVenue ? '闭馆换线' : '不闭馆换线'}</span>
                    <Switch checked={closedVenue} onCheckedChange={setClosedVenue} />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">换线区域</label>
                  <Input
                    placeholder="如：大抱石区内侧"
                    value={venueArea}
                    onChange={(e) => setVenueArea(e.target.value)}
                  />
                </div>
              </>
            )}

            {/* ── 多次换线：日期列表 + 备注 + 闭馆开关 ── */}
            {posterMode === 'multi' && (
              <>
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-700">闭馆换线</label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">{closedVenue ? '闭馆换线' : '不闭馆换线'}</span>
                    <Switch checked={closedVenue} onCheckedChange={setClosedVenue} />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">信息栏右侧小字</label>
                  <Textarea
                    placeholder={'请合理安排攀岩时间\n避免因换线影响您的体验'}
                    value={multiScheduleNote}
                    onChange={(e) => setMultiScheduleNote(e.target.value)}
                    rows={2}
                    className="resize-none text-xs"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-gray-700">换线日期列表</label>
                    <span className="text-xs text-gray-400">{multiSchedules.length} 条</span>
                  </div>
                  <div className="space-y-2">
                    {multiSchedules.map((entry) => (
                      <ScheduleEntryRow
                        key={entry.id}
                        entry={entry}
                        onChange={updateScheduleEntry}
                        onRemove={removeScheduleEntry}
                      />
                    ))}
                  </div>
                  <button
                    onClick={addScheduleEntry}
                    className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border-2 border-dashed border-gray-200 text-gray-500 hover:border-yellow-400 hover:text-yellow-600 hover:bg-yellow-50 text-sm font-medium transition-colors"
                  >
                    <Plus size={14} />
                    添加换线日期
                  </button>
                </div>
              </>
            )}
          </div>

          {/* 添加定线员卡片 */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">添加定线员</h2>
              <button
                onClick={() => setShowBatchImport(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-yellow-100 text-gray-600 hover:text-yellow-700 text-xs font-medium transition-colors"
              >
                <FolderUp size={14} />
                批量导入
              </button>
            </div>

            {/* 照片上传区 */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-gray-700">照片</label>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500">AI 自动抠图</span>
                  <Switch checked={autoRemoveBg} onCheckedChange={setAutoRemoveBg} />
                </div>
              </div>

              <div
                className={`relative border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors ${
                  isDragOver
                    ? 'border-yellow-400 bg-yellow-50'
                    : 'border-gray-200 hover:border-yellow-300 hover:bg-gray-50'
                }`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileInputChange}
                />

                {currentImage ? (
                  <div className="relative">
                    <img
                      src={currentImage}
                      alt="预览"
                      className="w-full h-32 object-contain rounded-lg"
                      style={{
                        backgroundImage: isRemovingBg ? undefined : 'repeating-conic-gradient(#e5e7eb 0% 25%, white 0% 50%) 0 0 / 12px 12px',
                      }}
                    />
                    {isRemovingBg && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 rounded-lg">
                        <Loader2 className="w-6 h-6 animate-spin text-yellow-500 mb-1" />
                        <span className="text-xs text-gray-600">AI 抠图处理中...</span>
                      </div>
                    )}
                    {!isRemovingBg && (
                      <span className="absolute top-1 right-1 bg-green-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                        {autoRemoveBg ? '已抠图' : '原图'}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="py-4">
                    <Upload className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">点击或拖拽照片到此处</p>
                    <p className="text-xs text-gray-400 mt-1">支持 JPG、PNG、WebP</p>
                  </div>
                )}
              </div>
              <p className="text-xs text-amber-600 mt-1.5 leading-snug">
                💡 如果人物在画面中占比过小，请裁剪原图至合适比例后再上传
              </p>
            </div>

            {/* 名字 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">名字</label>
              <Input placeholder="定线员名字" {...register('name')} />
              {errors.name && (
                <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>
              )}
            </div>

            {/* 简介 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">简介</label>
              <Textarea
                placeholder="定线员简介和成就"
                {...register('bio')}
                rows={3}
                className="resize-none"
              />
            </div>

            {/* 身份 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">身份</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" value="regular" {...register('role')} className="accent-yellow-400" />
                  <span className="text-sm">定线员</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" value="special" {...register('role')} className="accent-yellow-400" />
                  <span className="text-sm">特邀定线员</span>
                </label>
              </div>
            </div>

            {/* 国籍 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">国籍</label>
              <select
                {...register('nationality')}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
              >
                {NATIONALITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* 添加按钮 */}
            <Button
              onClick={handleSubmit(onAddClimber)}
              className="w-full bg-yellow-400 hover:bg-yellow-500 text-black font-bold"
            >
              <Plus className="w-4 h-4 mr-1" />
              添加定线员
            </Button>
          </div>

          {/* 导出设置卡片 */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">导出设置</h2>

            {/* 海报尺寸 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">海报尺寸</label>
              <div className="grid grid-cols-3 gap-2">
                {(['60x90', '60x80', '59x79'] as PosterSize[]).map((size) => (
                  <button
                    key={size}
                    onClick={() => setPosterSize(size)}
                    className={`py-2 rounded-lg text-sm font-medium border transition-colors ${
                      posterSize === size
                        ? 'bg-yellow-400 border-yellow-400 text-black'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-yellow-300'
                    }`}
                  >
                    {POSTER_SIZE_LABEL[size]}
                  </button>
                ))}
              </div>
            </div>

            {/* 文件格式 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">文件格式</label>
              <div className="grid grid-cols-2 gap-2">
                {(['png', 'pdf'] as ExportFormat[]).map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => setExportFormat(fmt)}
                    className={`py-2 rounded-lg text-sm font-medium border transition-colors ${
                      exportFormat === fmt
                        ? 'bg-yellow-400 border-yellow-400 text-black'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-yellow-300'
                    }`}
                  >
                    {fmt.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* 下载按钮 */}
            <AnimatePresence>
              {climbers.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                >
                  <Button
                    onClick={downloadPoster}
                    disabled={isDownloading}
                    className="w-full bg-black hover:bg-gray-800 text-white font-bold"
                  >
                    {isDownloading ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4 mr-2" />
                    )}
                    下载海报（{POSTER_SIZE_LABEL[posterSize]} · {exportFormat.toUpperCase()}）
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* 已添加定线员列表 */}
          {climbers.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-gray-900">
                  已添加定线员：{climbers.length} 人
                </h2>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400">可拖拽排序</span>
                  <button
                    onClick={() => {
                      if (window.confirm(`确定要清空全部 ${climbers.length} 位定线员吗？`)) {
                        setClimbers([]);
                        toast.success('已清空所有定线员');
                      }
                    }}
                    className="text-xs text-red-400 hover:text-red-600 transition-colors"
                  >
                    一键清空
                  </button>
                </div>
              </div>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext items={climbers.map((c) => c.id)} strategy={rectSortingStrategy}>
                  <div className="space-y-2">
                    {climbers.map((c) => (
                      <SortableListItem
                        key={c.id}
                        id={c.id}
                        name={c.name}
                        onRemove={removeClimber}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          )}
        </div>

        {/* ── 右侧：海报预览 ─────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col items-center">
          <div className="sticky top-8 w-full max-w-2xl">
            <PosterPreview
              ref={posterRef}
              title={title}
              subtitle={subtitle}
              schedule={schedule}
              climbers={climbers}
              posterSize={posterSize}
              closedVenue={closedVenue}
              venueArea={venueArea}
              posterMode={posterMode}
              multiSchedules={multiSchedules}
              multiScheduleNote={multiScheduleNote}
              renderCard={(climber, layout) => (
                <ClimberCard
                  key={climber.id}
                  {...climber}
                  layout={layout}
                  onRemove={removeClimber}
                  onEdit={(id) => setEditingClimberId(id)}
                />
              )}
            />
          </div>
        </div>
      </div>
    </div>

    {/* 定线员编辑弹窗 */}
    {editingClimber && (
      <ClimberEditModal
        climber={editingClimber}
        onSave={handleSaveEdit}
        onClose={() => setEditingClimberId(null)}
      />
    )}

    {/* 批量导入弹窗 */}
    {showBatchImport && (
      <BatchImportModal
        autoRemoveBg={autoRemoveBg}
        onImport={(newClimbers) => {
          setClimbers((prev) => [...prev, ...newClimbers]);
          setShowBatchImport(false);
          toast.success(`成功导入 ${newClimbers.length} 位定线员`);
        }}
        onClose={() => setShowBatchImport(false)}
      />
    )}
    </>
  );
}
