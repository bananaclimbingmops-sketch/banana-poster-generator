import { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X, Upload, Loader2, Check, Crop } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { removeBackground } from '@imgly/background-removal';
import { NATIONALITY_OPTIONS } from '@/assets/flagAssets';
import type { Climber } from './PosterPreview';
import ReactCrop, { type Crop as CropType, centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

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

/** 将 canvas 内容导出为 base64 data URL */
function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png');
}

/** 根据裁切区域将图片绘制到 canvas 并返回 data URL */
function getCroppedImageDataUrl(
  image: HTMLImageElement,
  crop: CropType,
): string {
  const canvas = document.createElement('canvas');
  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;

  canvas.width = crop.width * scaleX;
  canvas.height = crop.height * scaleY;

  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.drawImage(
    image,
    crop.x * scaleX,
    crop.y * scaleY,
    crop.width * scaleX,
    crop.height * scaleY,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  return canvasToDataUrl(canvas);
}

/**
 * 定线员信息编辑弹窗
 * - 预填充当前定线员的所有信息
 * - 支持重新上传照片（含 AI 抠图）
 * - 支持图片裁切
 * - 保存时覆盖原数据，取消或点击遮罩关闭
 * - 有未保存更改时关闭前提示确认
 */
export default function ClimberEditModal({ climber, onSave, onClose }: ClimberEditModalProps) {
  // 当前编辑中的图片
  const [editImage, setEditImage] = useState<string | undefined>(climber.image);
  const [isDirty, setIsDirty] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isRemovingBg, setIsRemovingBg] = useState(false);
  const [autoRemoveBg, setAutoRemoveBg] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── 裁切相关状态 ────────────────────────────────────────────────────────────
  const [isCropping, setIsCropping] = useState(false);
  const [crop, setCrop] = useState<CropType>();
  const [completedCrop, setCompletedCrop] = useState<CropType>();
  const cropImageRef = useRef<HTMLImageElement>(null);
  // 裁切前的原图（用于取消裁切时恢复）
  const [preCropImage, setPreCropImage] = useState<string | undefined>();

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

  // abort controller ref，用于取消进行中的抠图
  const abortControllerRef = useRef<AbortController | null>(null);

  const processImageFile = useCallback(
    async (file: File) => {
      // 取消上一次正在进行的抠图
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      if (autoRemoveBg) {
        setIsRemovingBg(true);
        const previewUrl = URL.createObjectURL(file);
        setEditImage(previewUrl);
        try {
          const resultBlob = await removeBackground(file, {
            model: 'isnet_quint8',
            output: { format: 'image/png' },
          });
          if (signal.aborted) return;
          URL.revokeObjectURL(previewUrl);
          const dataUrl = await blobToDataUrl(resultBlob);
          setEditImage(dataUrl);
          setIsDirty(true);
          toast.success('抠图完成！');
        } catch (err: unknown) {
          if (signal.aborted) return;
          console.error('rembg failed:', err);
          toast.error('抠图失败，已保留原图');
        } finally {
          if (!signal.aborted) setIsRemovingBg(false);
        }
      } else {
        // 直接使用原图，确保重置抠图状态
        setIsRemovingBg(false);
        const dataUrl = await blobToDataUrl(file);
        if (signal.aborted) return;
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
      // 清空 input 值，允许重复选同一文件
      e.target.value = '';
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

  // ─── 裁切操作 ────────────────────────────────────────────────────────────────

  /** 进入裁切模式 */
  const handleStartCrop = useCallback(() => {
    setPreCropImage(editImage);
    setCrop(undefined);
    setCompletedCrop(undefined);
    setIsCropping(true);
  }, [editImage]);

  /** 图片加载完成后设置初始裁切区域（居中，自由比例） */
  const handleCropImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget;
    // 默认选中中心 80% 区域
    const initialCrop = centerCrop(
      makeAspectCrop({ unit: '%', width: 80 }, undefined as unknown as number, width, height),
      width,
      height,
    );
    setCrop(initialCrop);
    setCompletedCrop(initialCrop);
  }, []);

  /** 确认裁切 */
  const handleConfirmCrop = useCallback(() => {
    if (!cropImageRef.current || !completedCrop) {
      toast.error('请先选择裁切区域');
      return;
    }
    const croppedDataUrl = getCroppedImageDataUrl(cropImageRef.current, completedCrop);
    if (!croppedDataUrl) {
      toast.error('裁切失败，请重试');
      return;
    }
    setEditImage(croppedDataUrl);
    setIsDirty(true);
    setIsCropping(false);
    toast.success('裁切完成！');
  }, [completedCrop]);

  /** 取消裁切，恢复原图 */
  const handleCancelCrop = useCallback(() => {
    setEditImage(preCropImage);
    setIsCropping(false);
    setCrop(undefined);
    setCompletedCrop(undefined);
  }, [preCropImage]);

  // 尝试关闭弹窗（有未保存更改时提示）
  const handleClose = useCallback(() => {
    if (isCropping) {
      handleCancelCrop();
      return;
    }
    if (isDirty) {
      if (!window.confirm('有未保存的更改，确定要放弃吗？')) return;
    }
    onClose();
  }, [isDirty, isCropping, handleCancelCrop, onClose]);

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
      if (isCropping) {
        toast.error('请先完成或取消裁切操作');
        return;
      }
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
    [climber, editImage, isCropping, onSave],
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
          <h2 className="text-lg font-bold text-gray-900">
            {isCropping ? '裁切照片' : '编辑定线员信息'}
          </h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="关闭"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── 裁切模式 ── */}
        {isCropping && editImage ? (
          <div className="px-6 py-5 space-y-4">
            <p className="text-xs text-gray-500 text-center">拖动选框调整裁切区域，完成后点击"确认裁切"</p>
            <div className="flex justify-center">
              <ReactCrop
                crop={crop}
                onChange={(c) => setCrop(c)}
                onComplete={(c) => setCompletedCrop(c)}
                style={{ maxWidth: '100%', maxHeight: '60vh' }}
              >
                <img
                  ref={cropImageRef}
                  src={editImage}
                  alt="裁切预览"
                  style={{ maxWidth: '100%', maxHeight: '60vh', display: 'block' }}
                  onLoad={handleCropImageLoad}
                />
              </ReactCrop>
            </div>
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={handleCancelCrop}
              >
                取消
              </Button>
              <Button
                type="button"
                className="flex-1 bg-yellow-400 hover:bg-yellow-500 text-black font-bold"
                onClick={handleConfirmCrop}
                disabled={!completedCrop?.width || !completedCrop?.height}
              >
                <Check className="w-4 h-4 mr-1" />
                确认裁切
              </Button>
            </div>
          </div>
        ) : (
          /* ── 正常编辑模式 ── */
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

              {/* 裁切按钮（仅有图片时显示） */}
              {editImage && !isRemovingBg && (
                <button
                  type="button"
                  onClick={handleStartCrop}
                  className="mt-2 w-full flex items-center justify-center gap-1.5 text-xs text-gray-500 hover:text-yellow-600 border border-gray-200 hover:border-yellow-400 rounded-lg py-1.5 transition-colors"
                >
                  <Crop className="w-3.5 h-3.5" />
                  裁切照片
                </button>
              )}

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
        )}
      </div>
    </div>
  );
}
