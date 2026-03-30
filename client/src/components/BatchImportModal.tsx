import { useRef, useState, useCallback } from 'react';
import { X, FolderOpen, CheckCircle, AlertCircle, Loader2, Users, FileArchive } from 'lucide-react';
import { nanoid } from 'nanoid';
import JSZip from 'jszip';
import { removeBackground } from '@imgly/background-removal';
import type { Climber } from '@/components/PosterPreview';
import { NATIONALITY_OPTIONS } from '@/assets/flagAssets';

// ─── 类型定义 ──────────────────────────────────────────────
type ClimberRole = 'banana_coach' | 'banana_setter' | 'guest_domestic' | 'guest_international';
const ROLE_LABELS: Record<ClimberRole, string> = {
  banana_coach: '香蕉教练员',
  banana_setter: '香蕉定线员',
  guest_domestic: '特邀国内定线员',
  guest_international: '特邀国际定线员',
};

/** 定线员身份排序优先级（数值越小越靠前）*/
const ROLE_SORT_ORDER: Record<ClimberRole, number> = {
  guest_international: 0,
  guest_domestic: 1,
  banana_setter: 2,
  banana_coach: 3,
};

/** 新格式 role 值 → 海报 role 映射 */
const ROLE_MAP: Record<string, ClimberRole> = {
  coach: 'banana_coach',
  route_setter: 'banana_setter',
  invited_domestic: 'guest_domestic',
  invited_international: 'guest_international',
  banana_coach: 'banana_coach',
  banana_setter: 'banana_setter',
  guest_domestic: 'guest_domestic',
  guest_international: 'guest_international',
};

/** 门店 ID → 门店名称映射 */
const STORE_NAME_MAP: Record<string, string> = {
  '59d94c16-8b3a-49b1-b221-d8a222a0a533': '香蕉攀岩·华发中城商都店',
};

interface LegacyClimberJson {
  name: string;
  bio?: string;
  role?: string;
  nationality?: string;
  photo?: string;
}

interface RoutePlanJson {
  id?: string;
  store_id?: string;
  store_name?: string;
  area_id?: string;
  area_name?: string;
  plan_type?: string;
  plan_quantity?: number;
  status?: string;
  start_date?: string;
  end_date?: string;
  schedule?: string;
  is_closed?: boolean;
  notes?: string;
  setters?: Array<{
    id?: string;
    name: string;
    bio?: string;
    role?: string;
    nationality?: string;
    photo?: string;
  }>;
}

interface ParsedClimber {
  id: string;
  name: string;
  bio: string;
  role: ClimberRole;
  nationality?: string;
  photoFile?: File;
  photoPreview?: string;
  error?: string;
}

interface ParsedImportData {
  isRoutePlan: boolean;
  /** 单次换线模式 */
  posterTitle?: string;
  schedule?: string;
  isClosed?: boolean;
  venueArea?: string;
  /** 多次换线模式 */
  isMultiPlan?: boolean;
  multiSchedules?: Array<{ startDate: string; endDate?: string; description: string }>;
  climbers: ParsedClimber[];
}

export interface ImportResult {
  climbers: Climber[];
  posterMeta?: {
    title: string;
    schedule: string;
    isClosed: boolean;
    venueArea: string;
    /** 多次换线模式 */
    isMultiPlan?: boolean;
    multiSchedules?: Array<{ startDate: string; endDate?: string; description: string }>;
  };
}

interface BatchImportModalProps {
  onImport: (result: ImportResult) => void;
  onClose: () => void;
  autoRemoveBg?: boolean;
}

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

const VALID_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

function parseSetters(
  setters: Array<{ name: string; bio?: string; role?: string; nationality?: string; photo?: string }>,
  imageMap: Map<string, File>,
): ParsedClimber[] {
  const validNationalities = NATIONALITY_OPTIONS.map((o) => o.value);
  const parsed = setters.map((item, idx) => {
    const id = nanoid();
    if (!item.name?.trim()) {
      return { id, name: '', bio: '', role: 'banana_setter' as ClimberRole, error: `第 ${idx + 1} 条缺少 name 字段` };
    }
    let photoFile: File | undefined;
    let photoPreview: string | undefined;
    if (item.photo) {
      photoFile = imageMap.get(item.photo.toLowerCase());
      if (!photoFile) {
        const baseName = item.photo.toLowerCase().replace(/\.[^.]+$/, '');
        for (const [key, file] of Array.from(imageMap.entries())) {
          if (key.replace(/\.[^.]+$/, '') === baseName) { photoFile = file; break; }
        }
      }
      if (photoFile) photoPreview = URL.createObjectURL(photoFile);
    }
    const role: ClimberRole = (item.role && ROLE_MAP[item.role]) ? ROLE_MAP[item.role] : 'banana_setter';
    const nationality = item.nationality && validNationalities.includes(item.nationality) ? item.nationality : undefined;
    return { id, name: item.name.trim(), bio: item.bio?.trim() ?? '', role, nationality, photoFile, photoPreview };
  });
  // 按身份优先级排序：特邀国际 > 特邀国内 > 香蕉定线员 > 香蕉教练员
  // 有错误的条目保持原位（排在末尾）
  return parsed.sort((a, b) => {
    if (a.error && b.error) return 0;
    if (a.error) return 1;
    if (b.error) return -1;
    return (ROLE_SORT_ORDER[a.role] ?? 99) - (ROLE_SORT_ORDER[b.role] ?? 99);
  });
}

export default function BatchImportModal({ onImport, onClose, autoRemoveBg = false }: BatchImportModalProps) {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [parsed, setParsed] = useState<ParsedImportData | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importTotal, setImportTotal] = useState(0);
  const [importDone, setImportDone] = useState(0);
  const [localAutoRemoveBg, setLocalAutoRemoveBg] = useState(autoRemoveBg);

  const parseFiles = useCallback(async (files: File[]) => {
    const infoFile = files.find(
      (f) => f.name.toLowerCase() === 'info.json' || f.webkitRelativePath?.endsWith('/info.json'),
    );
    if (!infoFile) {
      setParsed({ isRoutePlan: false, climbers: [{ id: nanoid(), name: '', bio: '', role: 'banana_setter', error: '未找到 info.json 文件' }] });
      return;
    }
    let rawJson: unknown;
    try {
      rawJson = JSON.parse(await infoFile.text());
    } catch (e) {
      setParsed({ isRoutePlan: false, climbers: [{ id: nanoid(), name: '', bio: '', role: 'banana_setter', error: `info.json 解析失败：${(e as Error).message}` }] });
      return;
    }
    const imageMap = new Map<string, File>();
    for (const f of files) {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      if (VALID_IMAGE_EXTS.includes(ext)) imageMap.set(f.name.toLowerCase(), f);
    }
    if (Array.isArray(rawJson)) {
      // 判断是否为多次换线计划数组（每个元素都有 setters 字段）
      const arr = rawJson as unknown[];
      const isMultiPlan = arr.length > 0 && arr.every((item) => item && typeof item === 'object' && 'setters' in (item as object));
      if (isMultiPlan) {
        const plans = arr as RoutePlanJson[];
        // 合并所有 setters，按 id 去重
        const seenIds = new Set<string>();
        const allSetters: Array<{ id?: string; name: string; bio?: string; role?: string; nationality?: string; photo?: string }> = [];
        for (const plan of plans) {
          for (const setter of plan.setters ?? []) {
            const key = setter.id ?? setter.name;
            if (!seenIds.has(key)) {
              seenIds.add(key);
              allSetters.push(setter);
            }
          }
        }
        const climbers = parseSetters(allSetters, imageMap);
        // 大标题取第一个计划的 store_name
        const posterTitle = plans[0]?.store_name?.trim() || plans[0]?.store_id?.trim() || '';
        // 多次换线记录：每个计划对象映射为一条 ScheduleEntry
        const multiSchedules = plans.map((plan) => ({
          startDate: plan.start_date ?? '',
          endDate: plan.end_date ?? '',
          description: plan.area_name?.trim() || plan.area_id?.trim() || '',
        }));
        const isClosed = plans.some((p) => p.is_closed === true);
        setParsed({ isRoutePlan: true, isMultiPlan: true, posterTitle, isClosed, multiSchedules, climbers });
      } else {
        // 旧格式：定线员数组
        setParsed({ isRoutePlan: false, climbers: parseSetters(rawJson as LegacyClimberJson[], imageMap) });
      }
    } else if (rawJson && typeof rawJson === 'object' && 'setters' in (rawJson as object)) {
      const plan = rawJson as RoutePlanJson;
      const climbers = parseSetters(plan.setters ?? [], imageMap);
      const posterTitle = plan.store_name?.trim() || plan.store_id?.trim() || '';
      const venueArea = plan.area_name?.trim() || plan.area_id?.trim() || '';
      setParsed({ isRoutePlan: true, isMultiPlan: false, posterTitle, schedule: plan.schedule ?? '', isClosed: plan.is_closed ?? false, venueArea, climbers });
    } else {
      setParsed({ isRoutePlan: false, climbers: [{ id: nanoid(), name: '', bio: '', role: 'banana_setter', error: 'info.json 格式不正确' }] });
    }
  }, []);

  const parseFolder = useCallback(async (fileList: FileList) => { await parseFiles(Array.from(fileList)); }, [parseFiles]);

  const parseZip = useCallback(async (zipFile: File) => {
    try {
      const zip = await JSZip.loadAsync(zipFile);
      const files: File[] = [];
      for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
        if (zipEntry.dir) continue;
        const fileName = relativePath.split('/').pop() ?? relativePath;
        if (fileName.startsWith('._') || fileName === '.DS_Store') continue;
        const blob = await zipEntry.async('blob');
        files.push(new File([blob], fileName, { type: blob.type }));
      }
      await parseFiles(files);
    } catch (e) {
      setParsed({ isRoutePlan: false, climbers: [{ id: nanoid(), name: '', bio: '', role: 'banana_setter', error: `压缩包解析失败：${(e as Error).message}` }] });
    }
  }, [parseFiles]);

  const handleFolderInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) void parseFolder(e.target.files);
  }, [parseFolder]);

  const handleZipInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void parseZip(file);
  }, [parseZip]);

  const readDirectoryEntry = useCallback((entry: FileSystemDirectoryEntry): Promise<File[]> => {
    return new Promise((resolve) => {
      const reader = entry.createReader();
      const allFiles: File[] = [];
      const readBatch = () => {
        reader.readEntries(async (entries) => {
          if (entries.length === 0) { resolve(allFiles); return; }
          for (const e of entries) {
            if (e.isFile) {
              const file = await new Promise<File>((res) => (e as FileSystemFileEntry).file(res));
              allFiles.push(file);
            } else if (e.isDirectory) {
              allFiles.push(...await readDirectoryEntry(e as FileSystemDirectoryEntry));
            }
          }
          readBatch();
        });
      };
      readBatch();
    });
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const items = e.dataTransfer.items;
    if (!items || items.length === 0) return;
    if (items.length === 1) {
      const entry = items[0].webkitGetAsEntry?.();
      if (entry?.isFile) {
        const file = await new Promise<File>((res) => (entry as FileSystemFileEntry).file(res));
        if (file.name.toLowerCase().endsWith('.zip')) { void parseZip(file); return; }
      }
    }
    const allFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.();
      if (entry?.isDirectory) allFiles.push(...await readDirectoryEntry(entry as FileSystemDirectoryEntry));
      else if (entry?.isFile) {
        const file = await new Promise<File>((res) => (entry as FileSystemFileEntry).file(res));
        allFiles.push(file);
      }
    }
    if (allFiles.length > 0) {
      const dt = new DataTransfer();
      for (const f of allFiles) dt.items.add(f);
      void parseFolder(dt.files);
    } else if (e.dataTransfer.files?.length) {
      void parseFolder(e.dataTransfer.files);
    }
  }, [parseFolder, parseZip, readDirectoryEntry]);

  const handleConfirmImport = useCallback(async () => {
    if (!parsed) return;
    const valid = parsed.climbers.filter((p) => !p.error && p.name);
    if (valid.length === 0) return;
    setIsImporting(true);
    setImportTotal(valid.length);
    setImportDone(0);
    const results: Climber[] = [];
    for (let i = 0; i < valid.length; i++) {
      const p = valid[i];
      let imageDataUrl: string | undefined;
      if (p.photoFile) {
        try {
          if (localAutoRemoveBg) {
            const resultBlob = await removeBackground(p.photoFile, { model: 'isnet_quint8', output: { format: 'image/png' } });
            imageDataUrl = await blobToDataUrl(resultBlob);
          } else {
            imageDataUrl = await blobToDataUrl(p.photoFile);
          }
        } catch {
          imageDataUrl = await blobToDataUrl(p.photoFile);
        }
      }
      if (p.photoPreview) URL.revokeObjectURL(p.photoPreview);
      results.push({ id: p.id, name: p.name, bio: p.bio, role: p.role, nationality: p.nationality, image: imageDataUrl });
      setImportDone(i + 1);
      setImportProgress(Math.round(((i + 1) / valid.length) * 100));
    }
    const importResult: ImportResult = { climbers: results };
    if (parsed.isRoutePlan) {
      if (parsed.isMultiPlan) {
        importResult.posterMeta = {
          title: parsed.posterTitle ?? '',
          schedule: '',
          isClosed: parsed.isClosed ?? false,
          venueArea: '',
          isMultiPlan: true,
          multiSchedules: parsed.multiSchedules ?? [],
        };
      } else {
        importResult.posterMeta = { title: parsed.posterTitle ?? '', schedule: parsed.schedule ?? '', isClosed: parsed.isClosed ?? false, venueArea: parsed.venueArea ?? '' };
      }
    }
    onImport(importResult);
  }, [parsed, localAutoRemoveBg, onImport]);

  const handleClose = useCallback(() => {
    if (parsed) { for (const p of parsed.climbers) { if (p.photoPreview) URL.revokeObjectURL(p.photoPreview); } }
    onClose();
  }, [parsed, onClose]);

  const hasErrors = parsed?.climbers.some((p) => p.error);
  const validCount = parsed?.climbers.filter((p) => !p.error && p.name).length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={isImporting ? undefined : handleClose} />
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Users size={20} className="text-yellow-500" />
            <h2 className="text-base font-bold text-gray-900">批量导入</h2>
          </div>
          {!isImporting && (
            <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
              <X size={18} />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {isImporting && (
            <div className="flex flex-col items-center justify-center py-8 gap-4">
              <Loader2 size={40} className="text-yellow-400 animate-spin" />
              <p className="text-gray-700 font-medium">正在处理第 {importDone} / {importTotal} 位定线员...</p>
              {localAutoRemoveBg && <p className="text-sm text-gray-400">AI 抜图中，请稍候</p>}
              <div className="w-full bg-gray-100 rounded-full h-2.5">
                <div className="bg-yellow-400 h-2.5 rounded-full transition-all duration-300" style={{ width: `${importProgress}%` }} />
              </div>
              <p className="text-sm text-gray-400">{importProgress}%</p>
            </div>
          )}
          {!isImporting && !parsed && (
            <>
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-sm text-gray-600 space-y-2">
                <p className="font-semibold text-gray-800">支持两种 info.json 格式</p>
                <p className="font-medium text-gray-700 pt-1">① 换线计划格式（新）— 一键填入所有海报信息</p>
                <pre className="bg-white border border-yellow-100 rounded-lg p-3 text-xs leading-relaxed overflow-x-auto">{`{
  "store_name": "香蕉攀岩·华发中城商都店",
  "area_name": "全场",
  "start_date": "2026-04-08",
  "end_date": "2026-04-10",
  "schedule": "4月8日 22:00 闭馆\n4月11日 10:00 开放",
  "is_closed": true,
  "setters": [
    {
      "name": "张三",
      "bio": "国家一级定线员",
      "role": "route_setter",
      "nationality": "中国",
      "photo": "张三.jpg"
    }
  ]
}`}</pre>
                <p className="text-xs text-gray-500">role 可选值：<code>coach</code>（香蕉教练员）/ <code>route_setter</code>（香蕉定线员）/ <code>invited_domestic</code>（特邀国内）/ <code>invited_international</code>（特邀国际）</p>
                <p className="font-medium text-gray-700 pt-1">② 定线员列表格式（旧）— 仅导入定线员</p>
                <pre className="bg-white border border-yellow-100 rounded-lg p-3 text-xs leading-relaxed overflow-x-auto">{`[
  {
    "name": "张三",
    "bio": "香蕉定线员",
    "role": "banana_setter",
    "nationality": "中国",
    "photo": "张三.jpg"
  }
]`}</pre>
              </div>
              <div
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${isDragOver ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 hover:border-yellow-300 hover:bg-gray-50'}`}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
              >
                <div className="flex justify-center gap-3 mb-3">
                  <FolderOpen size={32} className="text-gray-300" />
                  <FileArchive size={32} className="text-gray-300" />
                </div>
                <p className="text-gray-600 font-medium">拖拽文件夹或 .zip 压缩包到此处</p>
                <p className="text-sm text-gray-400 mt-1 mb-4">或点击下方按钮选择</p>
                <div className="flex justify-center gap-3">
                  <button onClick={() => folderInputRef.current?.click()} className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 hover:border-yellow-300 transition-colors">
                    <FolderOpen size={15} />
                    选择文件夹
                  </button>
                  <button onClick={() => zipInputRef.current?.click()} className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 hover:border-yellow-300 transition-colors">
                    <FileArchive size={15} />
                    选择 .zip 文件
                  </button>
                </div>
              </div>
              <input ref={folderInputRef} type="file" className="hidden"
                // @ts-expect-error webkitdirectory
                webkitdirectory="" multiple onChange={handleFolderInput} />
              <input ref={zipInputRef} type="file" className="hidden" accept=".zip" onChange={handleZipInput} />
            </>
          )}
          {!isImporting && parsed && (
            <div className="space-y-3">
              {parsed.isRoutePlan && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-1.5 text-sm">
                  <p className="font-semibold text-blue-800">
                    {parsed.isMultiPlan ? `多次换线模式（${parsed.multiSchedules?.length ?? 0} 次）` : '将覆盖以下海报信息'}
                  </p>
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-blue-700">
                    <span className="text-blue-400">大标题</span>
                    <span className="font-medium">{parsed.posterTitle || '（未识别，请手动填写）'}</span>
                    <span className="text-blue-400">换线模式</span>
                    <span>{parsed.isMultiPlan ? '多次换线' : '单次换线'}</span>
                    {parsed.isMultiPlan ? (
                      <>
                        <span className="text-blue-400">换线记录</span>
                        <div className="space-y-0.5">
                          {parsed.multiSchedules?.map((s, i) => (
                            <div key={i} className="text-xs">
                              {s.startDate}{s.endDate && s.endDate !== s.startDate ? ` ~ ${s.endDate}` : ''}
                              {s.description ? `　${s.description}` : ''}
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <>
                        <span className="text-blue-400">时间安排</span>
                        <span className="whitespace-pre-line">{parsed.schedule || '（空）'}</span>
                        <span className="text-blue-400">闭馆换线</span>
                        <span>{parsed.isClosed ? '是' : '否'}</span>
                        <span className="text-blue-400">区域备注</span>
                        <span>{parsed.venueArea || '（空）'}</span>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-blue-400 pt-1">副标题需导入后手动填写</p>
                </div>
              )}
              <div className={`flex items-center gap-2 p-3 rounded-xl text-sm font-medium ${hasErrors ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                {hasErrors ? <AlertCircle size={16} /> : <CheckCircle size={16} />}
                {hasErrors
                  ? `发现 ${parsed.climbers.filter(p => p.error).length} 个错误，${validCount} 位定线员可正常导入`
                  : `成功解析 ${validCount} 位定线员，确认后开始导入`
                }
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                <div>
                  <p className="text-sm font-medium text-gray-700">AI 自动抜图</p>
                  <p className="text-xs text-gray-400">导入时自动去除照片背景</p>
                </div>
                <button
                  onClick={() => setLocalAutoRemoveBg((v) => !v)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${localAutoRemoveBg ? 'bg-yellow-400' : 'bg-gray-200'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${localAutoRemoveBg ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
              <div className="space-y-2">
                {parsed.climbers.map((p) => (
                  <div key={p.id} className={`flex items-center gap-3 p-3 rounded-xl border ${p.error ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-white'}`}>
                    <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0 flex items-center justify-center">
                      {p.photoPreview ? (
                        <img src={p.photoPreview} alt={p.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-gray-300 text-xs text-center leading-tight px-1">{p.error ? '错误' : '无图'}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      {p.error ? (
                        <p className="text-sm text-red-600">{p.error}</p>
                      ) : (
                        <>
                          <p className="text-sm font-semibold text-gray-900 truncate">{p.name}</p>
                          <p className="text-xs text-gray-400 truncate">
                            {ROLE_LABELS[p.role] ?? '香蕉定线员'}
                            {p.nationality ? ` · ${p.nationality}` : ''}
                            {p.bio ? ` · ${p.bio.replace(/\n/g, ' ')}` : ''}
                          </p>
                        </>
                      )}
                    </div>
                    {!p.error && <CheckCircle size={16} className="text-green-400 flex-shrink-0" />}
                    {p.error && <AlertCircle size={16} className="text-red-400 flex-shrink-0" />}
                  </div>
                ))}
              </div>
              <button
                onClick={() => { setParsed(null); if (folderInputRef.current) folderInputRef.current.value = ''; if (zipInputRef.current) zipInputRef.current.value = ''; }}
                className="text-sm text-gray-400 hover:text-gray-600 underline"
              >
                重新选择文件夹 / 压缩包
              </button>
            </div>
          )}
        </div>
        {!isImporting && parsed && validCount > 0 && (
          <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
            <button onClick={handleClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors">
              取消
            </button>
            <button
              onClick={() => void handleConfirmImport()}
              className="flex-1 py-2.5 rounded-xl bg-yellow-400 text-black text-sm font-bold hover:bg-yellow-300 transition-colors"
            >
              {parsed.isRoutePlan
                ? parsed.isMultiPlan
                  ? `导入多次换线计划（${parsed.multiSchedules?.length ?? 0} 次 · ${validCount} 位定线员）`
                  : `导入换线计划（${validCount} 位定线员）`
                : `导入 ${validCount} 位定线员`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
