import { useState, useEffect, useCallback, useRef } from 'react';
import type { Climber } from '@/components/PosterPreview';

const STORAGE_KEY = 'poster_generator_state';

/** 单次换线记录（多次换线模式） */
export interface ScheduleEntry {
  id: string;
  /** 开始日期，格式 YYYY-MM-DD */
  startDate: string;
  /** 结束日期，格式 YYYY-MM-DD，跨天时填写，否则为空 */
  endDate?: string;
  /** 换线区域描述，支持多行（\n分隔） */
  description: string;
}

/** 海报模式：single=单次换线，multi=多次换线 */
export type PosterMode = 'single' | 'multi';

interface PosterState {
  title: string;
  subtitle: string;
  schedule: string;
  climbers: Climber[];
  /** 海报模式 */
  posterMode: PosterMode;
  /** 多次换线模式下的换线记录列表 */
  multiSchedules: ScheduleEntry[];
  /** 多次换线模式下黑色信息栏右侧小字（两行，\n分隔） */
  multiScheduleNote: string;
}

const DEFAULT_STATE: PosterState = {
  title: '香蕉攀岩·华发中城商都店',
  subtitle: '2月换线信息',
  schedule:
    '2月4日 20:00 悬浮岛、比赛墙、新手区拆线\n2月5日 悬浮岛、比赛墙、新手区换线，20:00U形墙拆线\n2月6日 U形墙换线，18:00恢复正常营业',
  climbers: [],
  posterMode: 'single',
  multiSchedules: [],
  multiScheduleNote: '请合理安排攀岩时间\n避免因换线影响您的体验',
};

/**
 * UX 优化：封装 localStorage 状态持久化逻辑。
 *
 * 图片处理策略（修复版）：
 * - 图片以 ObjectURL 形式保存在内存中（imageMapRef），不写入 localStorage
 * - 持久化时仅保存文本字段（标题、副标题、时间表、定线员文字信息）
 * - 读取 state.climbers 时，通过 imageMapRef 将图片重新注入，确保渲染正确
 * - 移除定线员时，同步释放对应 ObjectURL，防止内存泄漏
 */
export function usePosterStorage() {
  // 内存中的图片映射：climber.id -> ObjectURL
  const imageMapRef = useRef<Map<string, string>>(new Map());

  const [state, setState] = useState<PosterState>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as PosterState;
        // 刷新后 ObjectURL 失效，图片字段保持 undefined
        // 防止 climbers 字段不是数组（脏数据）导致崩溃
        const safeClimbers = Array.isArray(parsed.climbers) ? parsed.climbers : [];
        return {
          ...DEFAULT_STATE,
          ...parsed,
          climbers: safeClimbers.map((c) => ({ ...c, image: undefined })),
        };
      }
    } catch {
      // 读取失败时使用默认值
    }
    return DEFAULT_STATE;
  });

  // 状态变更时自动持久化（图片字段不持久化，只存文字信息）
  useEffect(() => {
    try {
      const toStore: PosterState = {
        ...state,
        climbers: state.climbers.map((c) => ({ ...c, image: undefined })),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
    } catch {
      // 存储失败时静默处理（如隐私模式）
    }
  }, [state]);

  const setTitle = useCallback((title: string) => {
    setState((prev) => ({ ...prev, title }));
  }, []);

  const setSubtitle = useCallback((subtitle: string) => {
    setState((prev) => ({ ...prev, subtitle }));
  }, []);

  const setSchedule = useCallback((schedule: string) => {
    setState((prev) => ({ ...prev, schedule }));
  }, []);

  const setPosterMode = useCallback((posterMode: PosterMode) => {
    setState((prev) => ({ ...prev, posterMode }));
  }, []);

  const setMultiSchedules = useCallback((multiSchedules: ScheduleEntry[] | ((prev: ScheduleEntry[]) => ScheduleEntry[])) => {
    setState((prev) => ({
      ...prev,
      multiSchedules: typeof multiSchedules === 'function' ? multiSchedules(prev.multiSchedules) : multiSchedules,
    }));
  }, []);

  const setMultiScheduleNote = useCallback((multiScheduleNote: string) => {
    setState((prev) => ({ ...prev, multiScheduleNote }));
  }, []);

  const setClimbers = useCallback(
    (climbers: Climber[] | ((prev: Climber[]) => Climber[])) => {
      setState((prev) => {
        const next =
          typeof climbers === 'function' ? climbers(prev.climbers) : climbers;

        // 同步更新 imageMapRef：
        // 1. 新增的 climber 若携带 image，存入 imageMap
        // 2. 被移除的 climber 释放其 ObjectURL
        const nextIds = new Set(next.map((c) => c.id));
        const prevIds = new Set(prev.climbers.map((c) => c.id));

        // 释放已移除 climber 的 ObjectURL
        Array.from(prevIds).forEach((prevId) => {
          if (!nextIds.has(prevId)) {
            const url = imageMapRef.current.get(prevId);
            if (url) {
              URL.revokeObjectURL(url);
              imageMapRef.current.delete(prevId);
            }
          }
        });

        // 将新 climber 的 image 存入 imageMap，并从 climber 对象中移除
        // （避免 image 被持久化到 localStorage）
        const sanitized = next.map((c) => {
          if (c.image) {
            // 如果是 base64（历史记录恢复时）或 ObjectURL，都存入 imageMap
            imageMapRef.current.set(c.id, c.image);
          }
          // state 中不保存 image，渲染时通过 imageMap 注入
          return { ...c, image: undefined };
        });

        return { ...prev, climbers: sanitized };
      });
    },
    [],
  );

  const resetState = useCallback(() => {
    // 释放所有 ObjectURL
    Array.from(imageMapRef.current.values()).forEach((url) => {
      URL.revokeObjectURL(url);
    });
    imageMapRef.current.clear();
    localStorage.removeItem(STORAGE_KEY);
    setState(DEFAULT_STATE);
  }, []);

  // 将 imageMap 中的图片注入到 climbers，供渲染使用
  const climbersWithImages: Climber[] = state.climbers.map((c) => ({
    ...c,
    image: imageMapRef.current.get(c.id),
  }));

  return {
    title: state.title,
    subtitle: state.subtitle,
    schedule: state.schedule,
    climbers: climbersWithImages,
    posterMode: state.posterMode,
    multiSchedules: state.multiSchedules,
    multiScheduleNote: state.multiScheduleNote,
    setTitle,
    setSubtitle,
    setSchedule,
    setPosterMode,
    setMultiSchedules,
    setMultiScheduleNote,
    setClimbers,
    resetState,
    /** 历史记录保存时使用：返回含完整 base64 图片的 climbers 列表 */
    climbersWithImages,
  };
}
