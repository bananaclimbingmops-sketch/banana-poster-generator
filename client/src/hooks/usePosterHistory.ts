import { useState, useCallback } from 'react';
import type { Climber } from '@/components/PosterPreview';

const HISTORY_KEY = 'poster_generator_history';
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

function loadHistory(): PosterRecord[] {
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    if (stored) return JSON.parse(stored) as PosterRecord[];
  } catch {
    // ignore
  }
  return [];
}

function saveHistory(records: PosterRecord[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(records));
  } catch (e) {
    // localStorage 空间不足时，移除最旧的记录后重试
    console.warn('History storage full, removing oldest record');
    if (records.length > 1) {
      saveHistory(records.slice(1));
    }
  }
}

/**
 * 将海报 PNG dataUrl 压缩为小缩略图（宽 300px），减少 localStorage 占用
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

export function usePosterHistory() {
  const [history, setHistory] = useState<PosterRecord[]>(loadHistory);

  const saveRecord = useCallback(
    (
      record: Omit<PosterRecord, 'id' | 'createdAt'>,
    ) => {
      const newRecord: PosterRecord = {
        ...record,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: Date.now(),
      };

      setHistory((prev) => {
        // 最多保留 MAX_RECORDS 条，超出时移除最旧的
        const next = [newRecord, ...prev].slice(0, MAX_RECORDS);
        saveHistory(next);
        return next;
      });

      return newRecord.id;
    },
    [],
  );

  const deleteRecord = useCallback((id: string) => {
    setHistory((prev) => {
      const next = prev.filter((r) => r.id !== id);
      saveHistory(next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    localStorage.removeItem(HISTORY_KEY);
    setHistory([]);
  }, []);

  return { history, saveRecord, deleteRecord, clearHistory };
}
