import { useState, useCallback, useEffect } from 'react';
import type { Climber } from '@/components/PosterPreview';

const HISTORY_META_KEY = 'poster_generator_history_meta';
const DB_NAME = 'poster_generator_db';
const DB_VERSION = 1;
const STORE_NAME = 'history_images';
const MAX_RECORDS = 20;

export interface PosterRecord {
  id: string;
  createdAt: number; // timestamp
  title: string;
  subtitle: string;
  schedule: string;
  closedVenue: boolean;
  venueArea: string;
  climbers: Climber[]; // 含 base64 image
  thumbnail?: string;  // 压缩后的海报缩略图 base64
}

// ── 元数据（不含图片，存 localStorage）──────────────────────────────────────
type PosterRecordMeta = Omit<PosterRecord, 'climbers' | 'thumbnail'>;

// ── IndexedDB 辅助 ────────────────────────────────────────────────────────────

let _db: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => {
      _db = req.result;
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // ignore
  }
}

async function idbDelete(key: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // ignore
  }
}

// ── localStorage 元数据读写 ───────────────────────────────────────────────────

function loadMeta(): PosterRecordMeta[] {
  try {
    const stored = localStorage.getItem(HISTORY_META_KEY);
    if (stored) return JSON.parse(stored) as PosterRecordMeta[];
  } catch {
    // ignore
  }
  return [];
}

function saveMeta(metas: PosterRecordMeta[]) {
  try {
    localStorage.setItem(HISTORY_META_KEY, JSON.stringify(metas));
  } catch {
    // ignore
  }
}

// ── 缩略图压缩 ────────────────────────────────────────────────────────────────

/**
 * 将海报 PNG dataUrl 压缩为小缩略图（宽 300px），减少存储占用
 */
export async function compressThumbnail(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const targetWidth = 300;
      const scale = targetWidth / img.width;
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(dataUrl); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// ── 主 Hook ───────────────────────────────────────────────────────────────────

export function usePosterHistory() {
  // history 只保存元数据，图片按需从 IndexedDB 加载
  const [metas, setMetas] = useState<PosterRecordMeta[]>(loadMeta);
  // 完整记录（含 thumbnail + climbers 图片），按需填充
  const [history, setHistory] = useState<PosterRecord[]>(() =>
    loadMeta().map((m) => ({ ...m, climbers: [], thumbnail: undefined })),
  );

  // 初始化时从 IndexedDB 加载图片数据，填充 history
  useEffect(() => {
    const metas = loadMeta();
    if (metas.length === 0) return;

    Promise.all(
      metas.map(async (meta) => {
        const images = await idbGet<{ thumbnail?: string; climbers: Climber[] }>(meta.id);
        return {
          ...meta,
          thumbnail: images?.thumbnail,
          climbers: images?.climbers ?? [],
        } as PosterRecord;
      }),
    ).then((records) => {
      setHistory(records);
    });
  }, []);

  const saveRecord = useCallback(
    async (record: Omit<PosterRecord, 'id' | 'createdAt'>) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const createdAt = Date.now();

      const meta: PosterRecordMeta = {
        id,
        createdAt,
        title: record.title,
        subtitle: record.subtitle,
        schedule: record.schedule,
        closedVenue: record.closedVenue,
        venueArea: record.venueArea,
      };

      const fullRecord: PosterRecord = { ...meta, ...record };

      // 将图片数据存入 IndexedDB
      await idbSet(id, {
        thumbnail: record.thumbnail,
        climbers: record.climbers,
      });

      setMetas((prev) => {
        const next = [meta, ...prev].slice(0, MAX_RECORDS);
        saveMeta(next);
        // 同步清理超出上限的旧记录
        const removed = [meta, ...prev].slice(MAX_RECORDS);
        removed.forEach((r) => void idbDelete(r.id));
        return next;
      });

      setHistory((prev) => [fullRecord, ...prev].slice(0, MAX_RECORDS));

      return id;
    },
    [],
  );

  const deleteRecord = useCallback((id: string) => {
    void idbDelete(id);
    setMetas((prev) => {
      const next = prev.filter((r) => r.id !== id);
      saveMeta(next);
      return next;
    });
    setHistory((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const clearHistory = useCallback(() => {
    // 清理所有 IndexedDB 记录
    setMetas((prev) => {
      prev.forEach((r) => void idbDelete(r.id));
      return [];
    });
    localStorage.removeItem(HISTORY_META_KEY);
    setHistory([]);
  }, []);

  return { history, saveRecord, deleteRecord, clearHistory };
}
