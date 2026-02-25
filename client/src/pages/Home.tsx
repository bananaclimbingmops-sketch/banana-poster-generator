import { useCallback, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Upload, Download, Plus, Loader2, RotateCcw, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import PosterPreview, { POSTER_SIZE_LABEL } from '@/components/PosterPreview';
import type { PosterSize } from '@/components/PosterPreview';
import { Switch } from '@/components/ui/switch';
import { SortableClimberCard } from '@/components/SortableClimberCard';
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
import type { Climber } from '@/components/PosterPreview';
import { NATIONALITY_OPTIONS } from '@/assets/flagAssets';

// ─── 抠图服务地址（使用相对路径，由 Vite/Express 代理转发到本地 rembg 服务）────
const REMBG_API = '/api/remove-bg';

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

// ─── 主页组件 ─────────────────────────────────────────────────────────────────
export default function Home() {
  // UX 优化：使用自定义 hook 实现状态持久化（localStorage）
  const {
    title,
    subtitle,
    schedule,
    climbers,
    setTitle,
    setSubtitle,
    setSchedule,
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

  // 海报容器 ref（用于导出）
  const posterRef = useRef<HTMLDivElement>(null);

  // 当前待添加的图片 ObjectURL
  const [currentImage, setCurrentImage] = useState<string | undefined>();
  const currentObjectUrlRef = useRef<string | null>(null);

  // 图片上传区拖拽状态
  const [isDragOver, setIsDragOver] = useState(false);

  // AI 抠图开关
  const [autoRemoveBg, setAutoRemoveBg] = useState(true);

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
  const processImageFile = useCallback(
    async (file: File) => {
      // 释放上一张图片的 ObjectURL
      if (currentObjectUrlRef.current) {
        URL.revokeObjectURL(currentObjectUrlRef.current);
        currentObjectUrlRef.current = null;
      }

      if (autoRemoveBg) {
        setIsRemovingBg(true);
        // 先显示原图预览
        const previewUrl = URL.createObjectURL(file);
        currentObjectUrlRef.current = previewUrl;
        setCurrentImage(previewUrl);

        try {
          const formData = new FormData();
          formData.append('image', file);
          const res = await fetch(REMBG_API, { method: 'POST', body: formData });
          if (!res.ok) throw new Error(`rembg error: ${res.status}`);
          const data = (await res.json()) as { result: string };
          // 将 base64 结果转为 ObjectURL
          const byteStr = atob(data.result);
          const ab = new ArrayBuffer(byteStr.length);
          const ia = new Uint8Array(ab);
          for (let i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i);
          const blob = new Blob([ab], { type: 'image/png' });
          // 释放原图预览 URL
          URL.revokeObjectURL(previewUrl);
          const resultUrl = URL.createObjectURL(blob);
          currentObjectUrlRef.current = resultUrl;
          setCurrentImage(resultUrl);
          toast.success('抠图完成！');
        } catch (err) {
          console.error('rembg failed:', err);
          toast.error('抠图失败，已保留原图');
        } finally {
          setIsRemovingBg(false);
        }
      } else {
        const url = URL.createObjectURL(file);
        currentObjectUrlRef.current = url;
        setCurrentImage(url);
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

  /**
   * 导出海报
   *
   * 使用 html-to-image（基于 SVG foreignObject，让浏览器原生渲染，
   * 完全兼容 Tailwind CSS v4 的 oklab() 颜色函数）
   *
   * - PNG：直接下载高分辨率 PNG
   * - PDF：将 PNG 嵌入 jsPDF，页面尺寸精确对应印刷规格
   */
  const downloadPoster = useCallback(async () => {
    if (!posterRef.current) return;
    setIsDownloading(true);
    try {
      const el = posterRef.current;
      const pixelRatio = 3; // 约 300dpi 印刷分辨率

      // html-to-image：让浏览器原生渲染，完全兼容现代 CSS
      const dataUrl = await toPng(el, {
        pixelRatio,
        backgroundColor: '#FFDA2A',
        // 确保跨域图片（base64 内嵌资源）正常渲染
        skipFonts: false,
        cacheBust: true,
      });

      const timestamp = new Date().getTime();
      const sizeLabel = POSTER_SIZE_LABEL[posterSize].replace('×', 'x');

      if (exportFormat === 'png') {
        // ── PNG 导出 ──────────────────────────────────────────────────────────
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = `换线海报-${sizeLabel}-${timestamp}.png`;
        link.click();
        toast.success('海报 PNG 下载成功');
      } else {
        // ── PDF 导出 ──────────────────────────────────────────────────────────
        const [widthMm, heightMm] = posterSize === '60x90' ? [600, 900] : [600, 800];
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
      setIsDownloading(false);
    }
  }, [posterSize, exportFormat]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部 Banner */}
      <div className="bg-gradient-to-r from-yellow-300 to-yellow-200 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-black text-black mb-1">换线海报生成器</h1>
            <p className="text-gray-700 text-sm">上传照片和简介，自动生成专业排版海报</p>
          </div>
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

            {/* 换线时间表 */}
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

            {/* 闭馆换线开关 */}
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">闭馆换线</label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">{closedVenue ? '闭馆换线' : '不闭馆换线'}</span>
                <Switch checked={closedVenue} onCheckedChange={setClosedVenue} />
              </div>
            </div>

            {/* 换线区域 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">换线区域</label>
              <Input
                placeholder="如：大抱石区内侧"
                value={venueArea}
                onChange={(e) => setVenueArea(e.target.value)}
              />
            </div>
          </div>

          {/* 添加定线员卡片 */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">添加定线员</h2>

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
              <div className="grid grid-cols-2 gap-2">
                {(['60x90', '60x80'] as PosterSize[]).map((size) => (
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
                <span className="text-xs text-gray-400">可拖拽排序</span>
              </div>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext items={climbers.map((c) => c.id)} strategy={rectSortingStrategy}>
                  <div className="space-y-2">
                    {climbers.map((c) => (
                      <div key={c.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                        <GripVertical className="w-4 h-4 text-gray-300 flex-shrink-0" />
                        <span className="text-sm text-gray-700 flex-1 truncate">{c.name}</span>
                        <button
                          onClick={() => removeClimber(c.id)}
                          className="text-xs text-red-400 hover:text-red-600 flex-shrink-0"
                          title={`移除 ${c.name}`}
                        >
                          ✕
                        </button>
                      </div>
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
              renderCard={(climber, layout) => (
                <SortableClimberCard
                  key={climber.id}
                  {...climber}
                  layout={layout}
                  onRemove={removeClimber}
                />
              )}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
