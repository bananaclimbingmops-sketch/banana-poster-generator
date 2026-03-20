import { useRef, useState, useCallback } from 'react';
import { X, FolderOpen, CheckCircle, AlertCircle, Loader2, Users, FileArchive } from 'lucide-react';
import { nanoid } from 'nanoid';
import JSZip from 'jszip';
import { removeBackground } from '@imgly/background-removal';
import type { Climber } from '@/components/PosterPreview';
import { NATIONALITY_OPTIONS } from '@/assets/flagAssets';

// ─── 类型定义 ──────────────────────────────────────────────────────────────────

interface ClimberInfoJson {
  name: string;
  bio?: string;
  role?: 'regular' | 'special';
  nationality?: string;
  photo?: string;
}

interface ParsedClimber {
  id: string;
  name: string;
  bio: string;
  role: 'regular' | 'special';
  nationality?: string;
  photoFile?: File;
  photoPreview?: string; // ObjectURL，仅用于预览
  error?: string;        // 解析错误信息
}

interface BatchImportModalProps {
  onImport: (climbers: Climber[]) => void;
  onClose: () => void;
  autoRemoveBg?: boolean;
}

// ─── 辅助函数 ──────────────────────────────────────────────────────────────────

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

const VALID_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

// ─── 主组件 ────────────────────────────────────────────────────────────────────

export default function BatchImportModal({
  onImport,
  onClose,
  autoRemoveBg = false,
}: BatchImportModalProps) {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // 解析阶段：已解析的定线员列表
  const [parsed, setParsed] = useState<ParsedClimber[] | null>(null);
  // 导入阶段：正在处理 AI 抠图
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0); // 0-100
  const [importTotal, setImportTotal] = useState(0);
  const [importDone, setImportDone] = useState(0);
  // AI 抠图开关（继承外部设置，可在弹窗内覆盖）
  const [localAutoRemoveBg, setLocalAutoRemoveBg] = useState(autoRemoveBg);

  // ── 核心解析逻辑（接收 File 数组）──────────────────────────────────────────

  const parseFiles = useCallback(async (files: File[]) => {
    // 找到 info.json（忽略路径层级）
    const infoFile = files.find(
      (f) => f.name.toLowerCase() === 'info.json' || f.webkitRelativePath?.endsWith('/info.json'),
    );
    if (!infoFile) {
      setParsed([
        {
          id: nanoid(),
          name: '',
          bio: '',
          role: 'regular',
          error: '未找到 info.json 文件，请确保文件夹或压缩包根目录包含 info.json',
        },
      ]);
      return;
    }

    // 解析 JSON
    let infoList: ClimberInfoJson[];
    try {
      const text = await infoFile.text();
      infoList = JSON.parse(text) as ClimberInfoJson[];
      if (!Array.isArray(infoList)) throw new Error('info.json 应为数组格式');
    } catch (e) {
      setParsed([
        {
          id: nanoid(),
          name: '',
          bio: '',
          role: 'regular',
          error: `info.json 解析失败：${(e as Error).message}`,
        },
      ]);
      return;
    }

    // 建立文件名 → File 的映射（忽略路径，只匹配文件名）
    const imageMap = new Map<string, File>();
    for (const f of files) {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      if (VALID_IMAGE_EXTS.includes(ext)) {
        imageMap.set(f.name.toLowerCase(), f);
      }
    }

    // 逐条解析
    const result: ParsedClimber[] = infoList.map((item, idx) => {
      const id = nanoid();
      if (!item.name?.trim()) {
        return { id, name: '', bio: '', role: 'regular', error: `第 ${idx + 1} 条缺少 name 字段` };
      }

      // 匹配照片文件
      let photoFile: File | undefined;
      let photoPreview: string | undefined;
      if (item.photo) {
        photoFile = imageMap.get(item.photo.toLowerCase());
        if (!photoFile) {
          // 尝试不带扩展名匹配
          const baseName = item.photo.toLowerCase().replace(/\.[^.]+$/, '');
          for (const [key, file] of imageMap.entries()) {
            if (key.replace(/\.[^.]+$/, '') === baseName) {
              photoFile = file;
              break;
            }
          }
        }
        if (photoFile) {
          photoPreview = URL.createObjectURL(photoFile);
        }
      }

      // 验证 nationality
      const validNationalities = NATIONALITY_OPTIONS.map((o) => o.value);
      const nationality =
        item.nationality && validNationalities.includes(item.nationality)
          ? item.nationality
          : undefined;

      return {
        id,
        name: item.name.trim(),
        bio: item.bio?.trim() ?? '',
        role: item.role === 'special' ? 'special' : 'regular',
        nationality,
        photoFile,
        photoPreview,
      };
    });

    setParsed(result);
  }, []);

  // ── 解析文件夹（FileList）──────────────────────────────────────────────────

  const parseFolder = useCallback(async (fileList: FileList) => {
    await parseFiles(Array.from(fileList));
  }, [parseFiles]);

  // ── 解析 ZIP 文件 ──────────────────────────────────────────────────────────

  const parseZip = useCallback(async (zipFile: File) => {
    try {
      const zip = await JSZip.loadAsync(zipFile);
      const files: File[] = [];

      for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
        if (zipEntry.dir) continue;
        // 只取文件名（去掉路径前缀）
        const fileName = relativePath.split('/').pop() ?? relativePath;
        // 跳过 macOS 系统文件
        if (fileName.startsWith('._') || fileName === '.DS_Store') continue;

        const blob = await zipEntry.async('blob');
        const file = new File([blob], fileName, { type: blob.type });
        files.push(file);
      }

      await parseFiles(files);
    } catch (e) {
      setParsed([
        {
          id: nanoid(),
          name: '',
          bio: '',
          role: 'regular',
          error: `压缩包解析失败：${(e as Error).message}`,
        },
      ]);
    }
  }, [parseFiles]);

  // ── 文件夹选择 ──────────────────────────────────────────────────────────────

  const handleFolderInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) void parseFolder(e.target.files);
    },
    [parseFolder],
  );

  // ── ZIP 文件选择 ────────────────────────────────────────────────────────────

  const handleZipInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void parseZip(file);
    },
    [parseZip],
  );

  /**
   * 递归读取 FileSystemDirectoryEntry，返回所有 File 对象。
   */
  const readDirectoryEntry = useCallback(
    (entry: FileSystemDirectoryEntry): Promise<File[]> => {
      return new Promise((resolve) => {
        const reader = entry.createReader();
        const allFiles: File[] = [];

        const readBatch = () => {
          reader.readEntries(async (entries) => {
            if (entries.length === 0) {
              resolve(allFiles);
              return;
            }
            for (const e of entries) {
              if (e.isFile) {
                const file = await new Promise<File>((res) =>
                  (e as FileSystemFileEntry).file(res),
                );
                allFiles.push(file);
              } else if (e.isDirectory) {
                const subFiles = await readDirectoryEntry(e as FileSystemDirectoryEntry);
                allFiles.push(...subFiles);
              }
            }
            readBatch();
          });
        };

        readBatch();
      });
    },
    [],
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);

      const items = e.dataTransfer.items;
      if (!items || items.length === 0) return;

      // 检查是否是 ZIP 文件（直接拖入单个 .zip 文件）
      if (items.length === 1) {
        const entry = items[0].webkitGetAsEntry?.();
        if (entry?.isFile) {
          const file = await new Promise<File>((res) =>
            (entry as FileSystemFileEntry).file(res),
          );
          if (file.name.toLowerCase().endsWith('.zip')) {
            void parseZip(file);
            return;
          }
        }
      }

      // 尝试通过 FileSystemEntry API 读取文件夹
      const allFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const entry = item.webkitGetAsEntry?.();
        if (entry?.isDirectory) {
          const files = await readDirectoryEntry(entry as FileSystemDirectoryEntry);
          allFiles.push(...files);
        } else if (entry?.isFile) {
          const file = await new Promise<File>((res) =>
            (entry as FileSystemFileEntry).file(res),
          );
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
    },
    [parseFolder, parseZip, readDirectoryEntry],
  );

  // ── 确认导入（含 AI 抠图）──────────────────────────────────────────────────

  const handleConfirmImport = useCallback(async () => {
    if (!parsed) return;
    const valid = parsed.filter((p) => !p.error && p.name);
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
            const resultBlob = await removeBackground(p.photoFile, {
              model: 'isnet_quint8',
              output: { format: 'image/png' },
            });
            imageDataUrl = await blobToDataUrl(resultBlob);
          } else {
            imageDataUrl = await blobToDataUrl(p.photoFile);
          }
        } catch {
          imageDataUrl = await blobToDataUrl(p.photoFile);
        }
      }

      if (p.photoPreview) URL.revokeObjectURL(p.photoPreview);

      results.push({
        id: p.id,
        name: p.name,
        bio: p.bio,
        role: p.role,
        nationality: p.nationality,
        image: imageDataUrl,
      });

      setImportDone(i + 1);
      setImportProgress(Math.round(((i + 1) / valid.length) * 100));
    }

    onImport(results);
  }, [parsed, localAutoRemoveBg, onImport]);

  // ── 关闭弹窗（释放 ObjectURL）──────────────────────────────────────────────

  const handleClose = useCallback(() => {
    if (parsed) {
      for (const p of parsed) {
        if (p.photoPreview) URL.revokeObjectURL(p.photoPreview);
      }
    }
    onClose();
  }, [parsed, onClose]);

  // ── 渲染 ────────────────────────────────────────────────────────────────────

  const hasErrors = parsed?.some((p) => p.error);
  const validCount = parsed?.filter((p) => !p.error && p.name).length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/50" onClick={isImporting ? undefined : handleClose} />

      {/* 弹窗主体 */}
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Users size={20} className="text-yellow-500" />
            <h2 className="text-base font-bold text-gray-900">批量导入定线员</h2>
          </div>
          {!isImporting && (
            <button
              onClick={handleClose}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

          {/* ── 导入中状态 ── */}
          {isImporting && (
            <div className="flex flex-col items-center justify-center py-8 gap-4">
              <Loader2 size={40} className="text-yellow-400 animate-spin" />
              <p className="text-gray-700 font-medium">
                正在处理第 {importDone} / {importTotal} 位定线员...
              </p>
              {localAutoRemoveBg && (
                <p className="text-sm text-gray-400">AI 抠图中，请稍候</p>
              )}
              <div className="w-full bg-gray-100 rounded-full h-2.5">
                <div
                  className="bg-yellow-400 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${importProgress}%` }}
                />
              </div>
              <p className="text-sm text-gray-400">{importProgress}%</p>
            </div>
          )}

          {/* ── 上传区（未解析时显示）── */}
          {!isImporting && !parsed && (
            <>
              {/* 格式说明 */}
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-sm text-gray-600 space-y-2">
                <p className="font-semibold text-gray-800">文件夹 / 压缩包格式要求</p>
                <p>将定线员照片和 <code className="bg-yellow-100 px-1 rounded">info.json</code> 放在同一文件夹中，支持直接上传文件夹或打包为 <code className="bg-yellow-100 px-1 rounded">.zip</code> 压缩包：</p>
                <pre className="bg-white border border-yellow-100 rounded-lg p-3 text-xs leading-relaxed overflow-x-auto">{`climbers/          ← 文件夹 或 climbers.zip
├── info.json
├── 张三.jpg
├── 李四.png
└── 王五.webp`}</pre>
                <p className="font-semibold text-gray-800 pt-1">info.json 格式：</p>
                <pre className="bg-white border border-yellow-100 rounded-lg p-3 text-xs leading-relaxed overflow-x-auto">{`[
  {
    "name": "张三",
    "bio": "国家一级定线员\\n全国冠军",
    "role": "regular",
    "nationality": "中国",
    "photo": "张三.jpg"
  },
  {
    "name": "李四",
    "bio": "DOME主理人",
    "role": "special",
    "photo": "李四.png"
  }
]`}</pre>
                <p className="text-xs text-gray-400">role 可选值：<code>regular</code>（定线员）/ <code>special</code>（特邀定线员）</p>
              </div>

              {/* 拖拽上传区 */}
              <div
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
                  isDragOver
                    ? 'border-yellow-400 bg-yellow-50'
                    : 'border-gray-200 hover:border-yellow-300 hover:bg-gray-50'
                }`}
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
                  <button
                    onClick={() => folderInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 hover:border-yellow-300 transition-colors"
                  >
                    <FolderOpen size={15} />
                    选择文件夹
                  </button>
                  <button
                    onClick={() => zipInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 hover:border-yellow-300 transition-colors"
                  >
                    <FileArchive size={15} />
                    选择 .zip 文件
                  </button>
                </div>
              </div>

              {/* 隐藏的文件夹 input */}
              <input
                ref={folderInputRef}
                type="file"
                className="hidden"
                // @ts-expect-error webkitdirectory 是非标准属性
                webkitdirectory=""
                multiple
                onChange={handleFolderInput}
              />
              {/* 隐藏的 ZIP input */}
              <input
                ref={zipInputRef}
                type="file"
                className="hidden"
                accept=".zip"
                onChange={handleZipInput}
              />
            </>
          )}

          {/* ── 解析结果预览 ── */}
          {!isImporting && parsed && (
            <div className="space-y-3">
              {/* 汇总信息 */}
              <div className={`flex items-center gap-2 p-3 rounded-xl text-sm font-medium ${
                hasErrors ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
              }`}>
                {hasErrors
                  ? <AlertCircle size={16} />
                  : <CheckCircle size={16} />
                }
                {hasErrors
                  ? `发现 ${parsed.filter(p => p.error).length} 个错误，${validCount} 位定线员可正常导入`
                  : `成功解析 ${validCount} 位定线员，确认后开始导入`
                }
              </div>

              {/* AI 抠图开关 */}
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                <div>
                  <p className="text-sm font-medium text-gray-700">AI 自动抠图</p>
                  <p className="text-xs text-gray-400">导入时自动去除照片背景</p>
                </div>
                <button
                  onClick={() => setLocalAutoRemoveBg((v) => !v)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    localAutoRemoveBg ? 'bg-yellow-400' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      localAutoRemoveBg ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* 定线员列表 */}
              <div className="space-y-2">
                {parsed.map((p) => (
                  <div
                    key={p.id}
                    className={`flex items-center gap-3 p-3 rounded-xl border ${
                      p.error
                        ? 'border-red-200 bg-red-50'
                        : 'border-gray-100 bg-white'
                    }`}
                  >
                    {/* 照片预览 */}
                    <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0 flex items-center justify-center">
                      {p.photoPreview ? (
                        <img src={p.photoPreview} alt={p.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-gray-300 text-xs text-center leading-tight px-1">
                          {p.error ? '错误' : '无图'}
                        </span>
                      )}
                    </div>

                    {/* 信息 */}
                    <div className="flex-1 min-w-0">
                      {p.error ? (
                        <p className="text-sm text-red-600">{p.error}</p>
                      ) : (
                        <>
                          <p className="text-sm font-semibold text-gray-900 truncate">{p.name}</p>
                          <p className="text-xs text-gray-400 truncate">
                            {p.role === 'special' ? '特邀定线员' : '定线员'}
                            {p.nationality ? ` · ${p.nationality}` : ''}
                            {p.bio ? ` · ${p.bio.replace(/\n/g, ' ')}` : ''}
                          </p>
                        </>
                      )}
                    </div>

                    {/* 状态图标 */}
                    {!p.error && (
                      <CheckCircle size={16} className="text-green-400 flex-shrink-0" />
                    )}
                    {p.error && (
                      <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
                    )}
                  </div>
                ))}
              </div>

              {/* 重新上传 */}
              <button
                onClick={() => {
                  setParsed(null);
                  if (folderInputRef.current) folderInputRef.current.value = '';
                  if (zipInputRef.current) zipInputRef.current.value = '';
                }}
                className="text-sm text-gray-400 hover:text-gray-600 underline"
              >
                重新选择文件夹 / 压缩包
              </button>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        {!isImporting && parsed && validCount > 0 && (
          <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
            <button
              onClick={handleClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              取消
            </button>
            <button
              onClick={() => void handleConfirmImport()}
              className="flex-1 py-2.5 rounded-xl bg-yellow-400 text-black text-sm font-bold hover:bg-yellow-300 transition-colors"
            >
              导入 {validCount} 位定线员
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
