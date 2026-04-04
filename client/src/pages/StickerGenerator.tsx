import { useState, useCallback, useRef, useEffect } from 'react';
import { Upload, Download, Loader2, RotateCcw, Sticker, Move, ZoomIn, ZoomOut, Check } from 'lucide-react';
import GuideDrawer from '@/components/GuideDrawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { NATIONALITY_OPTIONS, FLAG_MAP } from '@/assets/flagAssets';

// ─── 国籍选择器（带旗帜预览）────────────────────────────────────────────────
function NationalitySelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {NATIONALITY_OPTIONS.map((opt) => {
        const flag = FLAG_MAP[opt.value];
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all text-xs font-medium
              ${selected
                ? 'border-yellow-400 bg-yellow-50 shadow-sm'
                : 'border-gray-200 bg-white hover:border-yellow-300 hover:bg-yellow-50'
              }`}
          >
            {flag ? (
              <img src={flag} alt={opt.label} className="w-8 h-8 object-cover rounded-full" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-400 text-xs">无</div>
            )}
            <span className="text-center leading-tight">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── 构图参数类型 ─────────────────────────────────────────────────────────────
interface LayoutInfo {
  person_x: number;
  person_y: number;
  person_w: number;
  person_h: number;
  scale_ratio: number;
  canvas_size: number;
}

// ─── Canvas 拖拽微调组件 ──────────────────────────────────────────────────────
function StickerAdjuster({
  bgB64,
  bgTopB64,
  personB64,
  layout,
  onConfirm,
  onCancel,
}: {
  bgB64: string;
  bgTopB64: string;
  personB64: string;
  layout: LayoutInfo;
  onConfirm: (pngDataUrl: string) => void;
  onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgImgRef = useRef<HTMLImageElement | null>(null);
  const bgTopImgRef = useRef<HTMLImageElement | null>(null);
  const personImgRef = useRef<HTMLImageElement | null>(null);
  const imagesLoaded = useRef(0);

  const DISPLAY_SIZE = 400;
  const CANVAS_SIZE = layout.canvas_size; // 945

  // 人物在 945 坐标系中的位置
  const [personX, setPersonX] = useState(layout.person_x);
  const [personY, setPersonY] = useState(layout.person_y);
  // 缩放倍率（相对于后端已缩放的 person_img）
  const [scaleAdj, setScaleAdj] = useState(1.0);

  const isDraggingRef = useRef(false);
  const dragStart = useRef({ mx: 0, my: 0, px: 0, py: 0 });

  // 重绘 canvas
  const drawCanvas = useCallback((px: number, py: number, sa: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scale = DISPLAY_SIZE / CANVAS_SIZE;
    ctx.clearRect(0, 0, DISPLAY_SIZE, DISPLAY_SIZE);

    // 1. 绘制底层背景（黄色圆形 + 香蕉 logo）
    if (bgImgRef.current) {
      ctx.drawImage(bgImgRef.current, 0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
    }

    // 2. 绘制人物（圆形裁剪）
    if (personImgRef.current) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(DISPLAY_SIZE / 2, DISPLAY_SIZE / 2, DISPLAY_SIZE / 2, 0, Math.PI * 2);
      ctx.clip();

      const pw = layout.person_w * sa * scale;
      const ph = layout.person_h * sa * scale;
      // 缩放时以人物中心为锁点
      const anchorX = (px + layout.person_w / 2) * scale;
      const anchorY = (py + layout.person_h / 2) * scale;
      ctx.drawImage(personImgRef.current, anchorX - pw / 2, anchorY - ph / 2, pw, ph);
      ctx.restore();
    }

    // 3. 绘制顶层（国旗 + 姓名标签）——始终在人物上方
    if (bgTopImgRef.current) {
      ctx.drawImage(bgTopImgRef.current, 0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
    }

    // 辅助线：人脸目标位置（Y=35%）
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    const targetY = DISPLAY_SIZE * 0.35;
    ctx.beginPath();
    ctx.moveTo(DISPLAY_SIZE * 0.25, targetY);
    ctx.lineTo(DISPLAY_SIZE * 0.75, targetY);
    ctx.stroke();
    ctx.restore();
  }, [layout, CANVAS_SIZE]);

  // 加载图片
  useEffect(() => {
    imagesLoaded.current = 0;
    const onLoad = () => {
      imagesLoaded.current += 1;
      if (imagesLoaded.current >= 3) {
        drawCanvas(layout.person_x, layout.person_y, 1.0);
      }
    };

    const bg = new Image();
    bg.onload = onLoad;
    bg.src = `data:image/png;base64,${bgB64}`;
    bgImgRef.current = bg;

    const bgTop = new Image();
    bgTop.onload = onLoad;
    bgTop.src = `data:image/png;base64,${bgTopB64}`;
    bgTopImgRef.current = bgTop;

    const person = new Image();
    person.onload = onLoad;
    person.src = `data:image/png;base64,${personB64}`;
    personImgRef.current = person;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgB64, bgTopB64, personB64]);

  // 状态变化时重绘
  useEffect(() => {
    drawCanvas(personX, personY, scaleAdj);
  }, [personX, personY, scaleAdj, drawCanvas]);

  // 坐标转换（display px → canvas 945 坐标）
  const getCanvasPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * (CANVAS_SIZE / rect.width),
      y: (clientY - rect.top) * (CANVAS_SIZE / rect.height),
    };
  };

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    const pos = getCanvasPos(e);
    dragStart.current = { mx: pos.x, my: pos.y, px: personX, py: personY };
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDraggingRef.current) return;
    e.preventDefault();
    const pos = getCanvasPos(e);
    setPersonX(dragStart.current.px + (pos.x - dragStart.current.mx));
    setPersonY(dragStart.current.py + (pos.y - dragStart.current.my));
  };

  const handlePointerUp = () => {
    isDraggingRef.current = false;
  };

  // 确认：在全尺寸 offscreen canvas 合成最终图
  const handleConfirm = () => {
    const offscreen = document.createElement('canvas');
    offscreen.width = CANVAS_SIZE;
    offscreen.height = CANVAS_SIZE;
    const ctx = offscreen.getContext('2d')!;

    // 1. 底层背景（黄色圆形 + 香蕉 logo）
    if (bgImgRef.current) {
      ctx.drawImage(bgImgRef.current, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
    }

    // 2. 人物（圆形裁剪）
    if (personImgRef.current) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, CANVAS_SIZE / 2, 0, Math.PI * 2);
      ctx.clip();

      const pw = layout.person_w * scaleAdj;
      const ph = layout.person_h * scaleAdj;
      const anchorX = personX + layout.person_w / 2;
      const anchorY = personY + layout.person_h / 2;
      ctx.drawImage(personImgRef.current, anchorX - pw / 2, anchorY - ph / 2, pw, ph);
      ctx.restore();
    }

    // 3. 顶层（国旗 + 姓名标签）——始终在人物上方
    if (bgTopImgRef.current) {
      ctx.drawImage(bgTopImgRef.current, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
    }

    onConfirm(offscreen.toDataURL('image/png'));
  };

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <div className="flex items-center gap-2 text-sm text-gray-600 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 w-full">
        <Move size={14} className="text-blue-500 flex-shrink-0" />
        <span>拖动圆形区域调整人物位置，使用滑块调整大小</span>
      </div>

      {/* Canvas 预览 */}
      <canvas
        ref={canvasRef}
        width={DISPLAY_SIZE}
        height={DISPLAY_SIZE}
        className="rounded-full shadow-lg cursor-grab active:cursor-grabbing touch-none select-none"
        style={{ width: DISPLAY_SIZE, height: DISPLAY_SIZE, maxWidth: '100%' }}
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onMouseLeave={handlePointerUp}
        onTouchStart={handlePointerDown}
        onTouchMove={handlePointerMove}
        onTouchEnd={handlePointerUp}
      />

      {/* 缩放滑块 */}
      <div className="w-full flex items-center gap-3">
        <ZoomOut size={16} className="text-gray-400 flex-shrink-0" />
        <input
          type="range"
          min={0.3}
          max={2.5}
          step={0.02}
          value={scaleAdj}
          onChange={(e) => setScaleAdj(parseFloat(e.target.value))}
          className="flex-1 accent-yellow-400"
        />
        <ZoomIn size={16} className="text-gray-400 flex-shrink-0" />
        <span className="text-xs text-gray-500 w-10 text-right">{Math.round(scaleAdj * 100)}%</span>
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-3 w-full">
        <Button variant="outline" className="flex-1" onClick={onCancel}>
          取消
        </Button>
        <Button
          className="flex-1 bg-yellow-400 hover:bg-yellow-500 text-black font-bold"
          onClick={handleConfirm}
        >
          <Check size={16} className="mr-1.5" />
          确认构图
        </Button>
      </div>

      <button
        className="text-xs text-gray-400 hover:text-gray-600 underline"
        onClick={() => { setPersonX(layout.person_x); setPersonY(layout.person_y); setScaleAdj(1.0); }}
      >
        重置到自动构图
      </button>
    </div>
  );
}

// ─── 生成中 Loading 动画组件 ─────────────────────────────────────────────────
function StickerLoadingView({ step, useRembg }: { step: number; useRembg: boolean }) {
  const [dotCount, setDotCount] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  // 动态省略号
  useEffect(() => {
    const timer = setInterval(() => setDotCount(d => (d + 1) % 4), 500);
    return () => clearInterval(timer);
  }, []);

  // 计时器
  useEffect(() => {
    const timer = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const dots = '.'.repeat(dotCount);

  // 步骤定义（根据是否开启抠图动态调整）
  const steps = useRembg
    ? [
        { label: '准备中', icon: '⚙️' },
        { label: 'AI 自动抠图', icon: '✂️' },
        { label: '上传图片', icon: '📤' },
        { label: '合成贴纸', icon: '🎨' },
      ]
    : [
        { label: '准备中', icon: '⚙️' },
        { label: '上传图片', icon: '📤' },
        { label: '合成贴纸', icon: '🎨' },
      ];

  // 当不开启抠图时，step 映射：0→0, 2→1, 3→2
  const displayStep = useRembg ? step : step === 0 ? 0 : step - 1;

  const currentStepLabel = steps[Math.min(displayStep, steps.length - 1)]?.label || '处理中';

  return (
    <div className="flex flex-col items-center gap-6 py-8 w-full">
      {/* 香蕉动画圆圈 */}
      <div className="relative w-32 h-32">
        {/* 旋转外圈 */}
        <div className="absolute inset-0 rounded-full border-4 border-yellow-100" />
        <div
          className="absolute inset-0 rounded-full border-4 border-transparent border-t-yellow-400 border-r-yellow-300"
          style={{ animation: 'spin 1.2s linear infinite' }}
        />
        {/* 中心香蕉图标 */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-20 h-20 rounded-full bg-yellow-400 flex items-center justify-center shadow-md">
            <span className="text-3xl" style={{ animation: 'pulse 2s ease-in-out infinite' }}>🍌</span>
          </div>
        </div>
      </div>

      {/* 当前步骤文字 */}
      <div className="text-center">
        <p className="text-lg font-bold text-gray-800">
          {currentStepLabel}{dots}
        </p>
        <p className="text-sm text-gray-400 mt-1">已等待 {elapsed} 秒，请耐心等待</p>
      </div>

      {/* 步骤进度条 */}
      <div className="w-full max-w-xs space-y-2">
        {steps.map((s, i) => {
          const isDone = i < displayStep;
          const isActive = i === displayStep;
          return (
            <div key={i} className="flex items-center gap-3">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm flex-shrink-0 transition-all
                ${isDone ? 'bg-green-400 text-white' : isActive ? 'bg-yellow-400 text-black' : 'bg-gray-100 text-gray-400'}`}>
                {isDone ? '✓' : s.icon}
              </div>
              <div className="flex-1">
                <div className={`h-1.5 rounded-full transition-all duration-500
                  ${isDone ? 'bg-green-400' : isActive ? 'bg-yellow-400' : 'bg-gray-100'}`}
                  style={{ width: isDone ? '100%' : isActive ? '60%' : '0%' }}
                />
              </div>
              <span className={`text-xs w-16 text-right ${
                isDone ? 'text-green-500 font-medium' : isActive ? 'text-yellow-600 font-medium' : 'text-gray-300'
              }`}>
                {isDone ? '完成' : isActive ? '进行中' : '等待中'}
              </span>
            </div>
          );
        })}
      </div>

      {elapsed >= 15 && (
        <p className="text-xs text-gray-400 text-center max-w-xs">
          首次生成需要加载模型，稍微慢一点是正常的 😊
        </p>
      )}
    </div>
  );
}

// ─── 主页面 ──────────────────────────────────────────────────────────────────
export default function StickerGenerator() {
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [nationality, setNationality] = useState('中国');
  const [useRembg, setUseRembg] = useState(false);
  const [rembgMode, setRembgMode] = useState<'free' | 'premium'>('free');
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [resultB64, setResultB64] = useState<string | null>(null);
  const [faceDetected, setFaceDetected] = useState<boolean | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // 拖拽微调相关
  const [adjustMode, setAdjustMode] = useState(false);
  const [bgBottomB64, setBgBottomB64] = useState<string | null>(null);
  const [bgTopB64, setBgTopB64] = useState<string | null>(null);
  const [personB64, setPersonB64] = useState<string | null>(null);
  const [layoutInfo, setLayoutInfo] = useState<LayoutInfo | null>(null);
  const [adjustedDataUrl, setAdjustedDataUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── 处理文件选择 ────────────────────────────────────────────────────────────
  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('请上传图片文件（JPG、PNG、WebP）');
      return;
    }
    setPhotoFile(file);
    setResultB64(null);
    setFaceDetected(null);
    setAdjustMode(false);
    setAdjustedDataUrl(null);
    const reader = new FileReader();
    reader.onload = (e) => setPhotoPreview(e.target?.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  // ── 生成贴纸（调用 generate-layers 接口）────────────────────────────────────
  const handleGenerate = async () => {
    if (!photoFile) { toast.error('请先上传定线员照片'); return; }
    if (!name.trim()) { toast.error('请输入定线员姓名'); return; }

    setLoading(true);
    setLoadingStep(0);
    setResultB64(null);
    setAdjustMode(false);
    setAdjustedDataUrl(null);

    try {
      // 直接发送原图，后端使用 u2net_human_seg 模型处理抠图
      setLoadingStep(1);
      const formData = new FormData();
      formData.append('photo', photoFile, 'photo.png');
      formData.append('name', name.trim());
      formData.append('nationality', nationality);
      formData.append('rembg', useRembg ? 'true' : 'false');
      formData.append('rembg_mode', rembgMode);

      setLoadingStep(2);
      const res = await fetch('/api/sticker/generate-layers', {
        method: 'POST',
        body: formData,
      });
      setLoadingStep(3);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '生成失败');

      setResultB64(data.result);
      setBgBottomB64(data.bg_bottom_layer);
      setBgTopB64(data.bg_top_layer);
      setPersonB64(data.person_layer);
      setLayoutInfo(data.layout);
      setFaceDetected(data.face_detected ?? null);

      if (data.face_detected === false) {
        toast('未检测到人脸，已使用默认构图。可点击「手动调整构图」微调。', { icon: '⚠️' });
      } else {
        toast.success('贴纸生成成功！如构图不理想可点击「手动调整构图」。');
      }
    } catch (err: unknown) {
      toast.error(`生成失败：${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setLoading(false);
      setLoadingStep(0);
    }
  };

  // ── 下载贴纸 ────────────────────────────────────────────────────────────────
  const handleDownload = async () => {
    const src = adjustedDataUrl || (resultB64 ? `data:image/png;base64,${resultB64}` : null);
    if (!src) return;
    // iOS Safari 不支持 <a download> 直接下载 data URL，需转为 Blob URL
    const res = await fetch(src);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `${name || '定线员'}_贴纸.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    toast.success('贴纸已下载');
  };

  // ── 重置 ────────────────────────────────────────────────────────────────────
  const handleReset = () => {
    setPhotoFile(null);
    setPhotoPreview(null);
    setName('');
    setNationality('中国');
    setUseRembg(false);
    setRembgMode('free');
    setResultB64(null);
    setAdjustMode(false);
    setAdjustedDataUrl(null);
    setBgBottomB64(null);
    setBgTopB64(null);
    setPersonB64(null);
    setLayoutInfo(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const displaySrc = adjustedDataUrl || (resultB64 ? `data:image/png;base64,${resultB64}` : null);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部 Banner */}
      <div className="bg-gradient-to-r from-yellow-300 to-yellow-200 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:py-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-2">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-4xl font-black text-black mb-0.5 sm:mb-1 leading-tight">香蕉换线海报生成器</h1>
              <p className="text-gray-700 text-xs sm:text-sm hidden sm:block">上传定线员图片和简介，生成换线海报</p>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-3 flex-shrink-0">
              <GuideDrawer />
              <a href="/" className="text-xs sm:text-sm text-gray-600 hover:text-black font-medium px-2 sm:px-3 py-1.5 rounded-lg hover:bg-yellow-100 transition-colors whitespace-nowrap">
                ← <span className="hidden sm:inline">返回海报生成器</span><span className="sm:hidden">返回</span>
              </a>
            </div>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 pb-0 flex gap-1">
          <a href="/" className="px-4 py-2 text-sm font-semibold text-gray-600 hover:text-black rounded-t-lg hover:bg-white/60 transition-colors">
            换线海报
          </a>
          <div className="px-4 py-2 text-sm font-bold text-black bg-white rounded-t-lg shadow-sm flex items-center gap-1.5">
            <Sticker size={14} />
            定线员贴纸
          </div>
        </div>
      </div>

      {/* 主内容区 */}
      <div className="max-w-7xl mx-auto px-4 py-4 sm:py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8">

          {/* 左侧：表单 */}
          <div className="space-y-6">
            {/* 照片上传 */}
            <div className="bg-white rounded-2xl shadow-sm p-6">
              <h2 className="text-lg font-bold mb-4">上传照片</h2>
              <div
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors
                  ${isDragging ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 hover:border-yellow-300 hover:bg-yellow-50/50'}`}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                {photoPreview ? (
                  <div className="flex flex-col items-center gap-3">
                    <img src={photoPreview} alt="预览" className="max-h-48 max-w-full rounded-lg object-contain shadow" />
                    <p className="text-sm text-gray-500">{photoFile?.name}</p>
                    <p className="text-xs text-gray-400">点击重新选择</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 py-4">
                    <Upload size={32} className="text-gray-300" />
                    <p className="text-sm text-gray-500">点击或拖拽照片到此处</p>
                    <p className="text-xs text-gray-400">支持 JPG、PNG、WebP</p>
                  </div>
                )}
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
              </div>
            </div>

            {/* 姓名输入 */}
            <div className="bg-white rounded-2xl shadow-sm p-6">
              <h2 className="text-lg font-bold mb-4">定线员姓名</h2>
              <Input placeholder="输入定线员姓名" value={name} onChange={(e) => setName(e.target.value)} className="text-base" />
            </div>

            {/* 国籍选择 */}
            <div className="bg-white rounded-2xl shadow-sm p-6">
              <h2 className="text-lg font-bold mb-4">国籍</h2>
              <NationalitySelector value={nationality} onChange={setNationality} />
            </div>

            {/* AI 抠图开关 */}
            <div className="bg-white rounded-2xl shadow-sm p-6">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-base font-bold">AI 自动抠图</h2>
                  <p className="text-xs text-gray-500 mt-0.5">开启后自动去除背景，获得更干净的效果</p>
                </div>
                <button
                  type="button"
                  onClick={() => setUseRembg(!useRembg)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${useRembg ? 'bg-yellow-400' : 'bg-gray-200'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${useRembg ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
              {/* 抠图模式选择（仅在开启抠图时显示）*/}
              {useRembg && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => setRembgMode('free')}
                    className={`flex flex-col items-start gap-0.5 p-3 rounded-xl border-2 transition-all text-left ${
                      rembgMode === 'free'
                        ? 'border-yellow-400 bg-yellow-50'
                        : 'border-gray-200 bg-white hover:border-yellow-300'
                    }`}
                  >
                    <span className="text-sm font-bold text-gray-800">🆓 免费抠图</span>
                    <span className="text-xs text-gray-500">速度快，精度一般</span>
                    <span className="text-xs text-green-600 font-medium">无限次使用</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRembgMode('premium')}
                    className={`flex flex-col items-start gap-0.5 p-3 rounded-xl border-2 transition-all text-left ${
                      rembgMode === 'premium'
                        ? 'border-yellow-400 bg-yellow-50'
                        : 'border-gray-200 bg-white hover:border-yellow-300'
                    }`}
                  >
                    <span className="text-sm font-bold text-gray-800">⭐ 精准抠图</span>
                    <span className="text-xs text-gray-500">发丝级精度，效果极佳</span>
                    <span className="text-xs text-blue-600 font-medium">每月 50 次免费</span>
                  </button>
                </div>
              )}
            </div>

            {/* 操作按钮 */}
            <div className="flex gap-3">
              <Button
                className="flex-1 bg-yellow-400 hover:bg-yellow-500 text-black font-bold h-12 text-base"
                onClick={handleGenerate}
                disabled={loading || !photoFile || !name.trim()}
              >
                {loading ? (
                  <><Loader2 size={18} className="mr-2 animate-spin" />{useRembg ? '抠图中...' : '生成中...'}</>
                ) : (
                  <><Sticker size={18} className="mr-2" />生成贴纸</>
                )}
              </Button>
              <Button variant="outline" className="h-12 px-4" onClick={handleReset} disabled={loading}>
                <RotateCcw size={16} />
              </Button>
            </div>
          </div>

          {/* 右侧：预览 */}
          <div className="flex flex-col gap-6">
            <div className="bg-white rounded-2xl shadow-sm p-6 flex-1">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold">
                  {adjustMode ? '手动调整构图' : '贴纸预览'}
                </h2>
                {displaySrc && !adjustMode && (
                  <Button size="sm" className="bg-black hover:bg-gray-800 text-white" onClick={handleDownload}>
                    <Download size={14} className="mr-1.5" />下载 PNG
                  </Button>
                )}
              </div>

              <div className="flex items-center justify-center min-h-80">
                {loading ? (
                  <StickerLoadingView step={loadingStep} useRembg={useRembg} />
                ) : adjustMode && bgBottomB64 && bgTopB64 && personB64 && layoutInfo ? (
                  <StickerAdjuster
                    bgB64={bgBottomB64}
                    bgTopB64={bgTopB64}
                    personB64={personB64}
                    layout={layoutInfo}
                    onConfirm={(dataUrl) => {
                      setAdjustedDataUrl(dataUrl);
                      setAdjustMode(false);
                      toast.success('构图已调整！点击「下载 PNG」保存。');
                    }}
                    onCancel={() => setAdjustMode(false)}
                  />
                ) : displaySrc ? (
                  <div className="flex flex-col items-center gap-4 w-full">
                    <img
                      src={displaySrc}
                      alt="生成的贴纸"
                      className="max-w-full max-h-96 rounded-2xl shadow-lg"
                      style={{ imageRendering: 'crisp-edges' }}
                    />
                    <p className="text-xs text-gray-400">
                      输出尺寸：945 × 945px（8cm × 8cm @ 300dpi）
                      {adjustedDataUrl && <span className="ml-2 text-green-500 font-medium">✓ 已手动调整</span>}
                    </p>

                    {/* 手动调整构图按钮 */}
                    {bgBottomB64 && bgTopB64 && personB64 && layoutInfo && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-yellow-400 text-yellow-700 hover:bg-yellow-50 font-medium"
                        onClick={() => setAdjustMode(true)}
                      >
                        <Move size={14} className="mr-1.5" />
                        手动调整构图
                      </Button>
                    )}


                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 text-gray-300">
                    <Sticker size={64} strokeWidth={1} />
                    <p className="text-sm">填写信息后点击「生成贴纸」</p>
                  </div>
                )}
              </div>
            </div>

            {/* 使用说明 */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-5">
              <h3 className="text-sm font-bold text-yellow-800 mb-2">使用说明</h3>
              <ul className="text-xs text-yellow-700 space-y-1.5">
                <li>• 上传定线员照片，填写姓名并选择国籍</li>
                <li>• 照片将自动居中填满圆形区域，适合各种构图的照片</li>
                <li>• 开启「AI 自动抠图」可去除背景，让人物与黄色背景融合更自然：
                  <ul className="mt-1 ml-3 space-y-0.5">
                    <li>- 🆓 免费抠图：本地模型处理，速度快（5-10 秒），无次数限制</li>
                    <li>- ⭐ 精准抠图：云端 AI 处理，发丝级精度，每月 50 次免费</li>
                  </ul>
                </li>
                <li>• 如构图不理想，点击「手动调整构图」可拖动人物位置微调</li>
                <li>• 输出为 945×945px 高清 PNG，满足 8cm×8cm @ 300dpi 印刷需求</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
