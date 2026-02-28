import { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X, Upload, Loader2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { removeBackground } from '@imgly/background-removal';
import { NATIONALITY_OPTIONS } from '@/assets/flagAssets';
import type { Climber } from './PosterPreview';

// ─── 表单 Schema ───────────────────────────────────────────────────────────────
const editSchema = z.object({
  name: z.string().min(1, '请输入定线员名字'),
  bio: z.string().optional(),
  role: z.enum(['regular', 'special']),
  nationality: z.string().optional(),
});

type EditFormValues = z.infer<typeof editSchema>;

interface ClimberEditModalProps {
  climber: Climber;
  onSave: (updated: Climber) => void;
  onClose: () => void;
}

/**
 * 定线员信息编辑弹窗
 * - 预填充当前定线员的所有信息
 * - 支持重新上传照片（含 AI 抠图）
 * - 保存时覆盖原数据，取消或点击遮罩关闭
 * - 有未保存更改时关闭前提示确认
 */
export default function ClimberEditModal({ climber, onSave, onClose }: ClimberEditModalProps) {
  // 当前编辑中的图片（可能已被替换）
  const [editImage, setEditImage] = useState<string | undefined>(climber.image);
  const [isDirty, setIsDirty] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isRemovingBg, setIsRemovingBg] = useState(false);
  const [autoRemoveBg, setAutoRemoveBg] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isDirty: formIsDirty },
  } = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: climber.name,
      bio: climber.bio ?? '',
      role: climber.role,
      nationality: climber.nationality ?? '',
    },
  });

  // 监听表单变化，标记为已修改
  const watchedValues = watch();
  useEffect(() => {
    if (formIsDirty || editImage !== climber.image) {
      setIsDirty(true);
    }
  }, [watchedValues, editImage, formIsDirty, climber.image]);

  // 将 Blob/File 转换为 base64 data URL
  const blobToDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  const processImageFile = useCallback(
    async (file: File) => {
      if (autoRemoveBg) {
        setIsRemovingBg(true);
        // 先显示原图预览
        const previewUrl = URL.createObjectURL(file);
        setEditImage(previewUrl);
        try {
          const resultBlob = await removeBackground(file, {
            model: 'isnet_quint8',
            output: { format: 'image/png' },
          });
          URL.revokeObjectURL(previewUrl);
          const dataUrl = await blobToDataUrl(resultBlob);
          setEditImage(dataUrl);
          setIsDirty(true);
          toast.success('抠图完成！');
        } catch (err) {
          console.error('rembg failed:', err);
          toast.error('抠图失败，已保留原图');
        } finally {
          setIsRemovingBg(false);
        }
      } else {
        const dataUrl = await blobToDataUrl(file);
        setEditImage(dataUrl);
        setIsDirty(true);
      }
    },
    [autoRemoveBg],
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void processImageFile(file);
    },
    [processImageFile],
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

  // 尝试关闭弹窗（有未保存更改时提示）
  const handleClose = useCallback(() => {
    if (isDirty) {
      if (!window.confirm('有未保存的更改，确定要放弃吗？')) return;
    }
    onClose();
  }, [isDirty, onClose]);

  // 点击遮罩关闭
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) handleClose();
    },
    [handleClose],
  );

  // 保存
  const onSubmit = useCallback(
    (data: EditFormValues) => {
      const updated: Climber = {
        ...climber,
        name: data.name,
        bio: data.bio ?? '',
        role: data.role,
        nationality: data.nationality || undefined,
        image: editImage,
      };
      onSave(updated);
      toast.success('定线员信息已更新');
    },
    [climber, editImage, onSave],
  );

  return (
    /* 遮罩层 */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={handleOverlayClick}
    >
      {/* 弹窗主体 */}
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        style={{ maxHeight: '90vh', overflowY: 'auto' }}
      >
        {/* 弹窗头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">编辑定线员信息</h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="关闭"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 弹窗内容 */}
        <form onSubmit={handleSubmit(onSubmit)} className="px-6 py-5 space-y-4">

          {/* 照片上传区 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">照片</label>
              {/* AI 抠图开关 */}
              <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                <div
                  className={`relative w-8 h-4 rounded-full transition-colors ${autoRemoveBg ? 'bg-yellow-400' : 'bg-gray-200'}`}
                  onClick={() => setAutoRemoveBg((v) => !v)}
                >
                  <div
                    className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${autoRemoveBg ? 'translate-x-4' : 'translate-x-0.5'}`}
                  />
                </div>
                AI 自动抠图
              </label>
            </div>

            {/* 图片预览 / 上传区 */}
            <div
              className={`relative rounded-xl overflow-hidden border-2 border-dashed transition-colors cursor-pointer ${
                isDragOver ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 hover:border-yellow-300'
              }`}
              style={{ aspectRatio: '4/3' }}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
            >
              {isRemovingBg && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80">
                  <Loader2 className="w-6 h-6 animate-spin text-yellow-500 mb-1" />
                  <p className="text-xs text-gray-500">AI 抠图中…</p>
                </div>
              )}
              {editImage ? (
                <img
                  src={editImage}
                  alt="预览"
                  className="w-full h-full object-cover object-top"
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
                  <Upload className="w-6 h-6 mb-1" />
                  <p className="text-xs">点击或拖拽照片到此处</p>
                  <p className="text-xs text-gray-300 mt-0.5">支持 JPG、PNG、WebP</p>
                </div>
              )}
              {/* 悬停时显示更换提示 */}
              {editImage && !isRemovingBg && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/30 transition-colors group">
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity text-white text-xs font-medium flex items-center gap-1">
                    <Upload className="w-4 h-4" />
                    更换照片
                  </div>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileInputChange}
            />
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
              placeholder="定线员简介和成就（支持换行）"
              rows={4}
              {...register('bio')}
            />
          </div>

          {/* 身份 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">身份</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" value="regular" {...register('role')} className="accent-yellow-400" />
                <span className="text-sm text-gray-700">定线员</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" value="special" {...register('role')} className="accent-yellow-400" />
                <span className="text-sm text-gray-700">特邀定线员</span>
              </label>
            </div>
          </div>

          {/* 国籍 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">国籍</label>
            <select
              {...register('nationality')}
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-yellow-400"
            >
              {NATIONALITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* 操作按钮 */}
          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={handleClose}
            >
              取消
            </Button>
            <Button
              type="submit"
              className="flex-1 bg-yellow-400 hover:bg-yellow-500 text-black font-bold"
              disabled={isRemovingBg}
            >
              <Check className="w-4 h-4 mr-1" />
              保存
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
