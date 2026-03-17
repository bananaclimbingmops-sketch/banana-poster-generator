import { memo, forwardRef, useRef, useEffect, useState } from 'react';
import { logo, decoRocks, iconCalendar, bannerWatermark } from '@/assets/brandAssets';
import ClimberCard from './ClimberCard';

export interface Climber {
  id: string;
  name: string;
  bio: string;
  image?: string;
  role: 'regular' | 'special';
  nationality?: string;
}

/** 海报尺寸规格 */
export type PosterSize = '60x90' | '60x80' | '59x79';

/** 各尺寸对应的宽高比（宽 / 高） */
export const POSTER_SIZE_RATIO: Record<PosterSize, number> = {
  '60x90': 60 / 90,
  '60x80': 60 / 80,
  '59x79': 59 / 79,
};

/** 各尺寸的显示标签 */
export const POSTER_SIZE_LABEL: Record<PosterSize, string> = {
  '60x90': '60×90cm',
  '60x80': '60×80cm',
  '59x79': '59×79cm',
};

export interface PosterPreviewProps {
  title: string;
  subtitle: string;
  schedule: string;
  climbers: Climber[];
  posterSize?: PosterSize;
  /** 是否闭馆换线：true=闭馆换线，false=不闭馆换线 */
  closedVenue?: boolean;
  /** 换线区域文字，显示在信息栏右侧 */
  venueArea?: string;
  renderCard?: (climber: Climber, layout: CardLayout) => React.ReactNode;
}

export interface CardLayout {
  cols: number;
  imgHeightRatio: number;
}

function calcLayout(count: number, posterRatio: number): CardLayout {
  if (count === 0) return { cols: 3, imgHeightRatio: 0.62 };

  // 头部约占总高度 38%，卡片区占 62%
  const posterH = 1 / posterRatio;
  const gridH = posterH * 0.62;

  // 特殊规则：4人时强制 2×2 网格，平铺占满画面
  if (count === 4) {
    const cols = 2;
    const rows = 2;
    const gap = 0.01;
    const cardW = (1 - gap * (cols - 1)) / cols;
    const cardH = (gridH - gap * (rows - 1)) / rows;
    const textH = cardW * 0.45;
    const imgH = cardH - textH;
    const imgRatio = Math.min(0.75, Math.max(0.35, imgH / cardH));
    return { cols: 2, imgHeightRatio: imgRatio };
  }

  const candidates = [1, 2, 3, 4, 5];
  let bestCols = 3;
  let bestImgRatio = 0.62;
  let bestScore = Infinity;

  for (const cols of candidates) {
    const rows = Math.ceil(count / cols);
    const gap = 0.01;
    const cardW = (1 - gap * (cols - 1)) / cols;
    const cardH = (gridH - gap * (rows - 1)) / rows;

    const textH = cardW * 0.45;
    const imgH = cardH - textH;
    const imgRatio = imgH / cardH;

    if (imgRatio < 0.25 || imgRatio > 0.85) continue;

    const aspectRatio = cardW / cardH;
    const score = Math.abs(aspectRatio - 0.75);

    if (score < bestScore) {
      bestScore = score;
      bestCols = cols;
      bestImgRatio = Math.min(0.75, Math.max(0.35, imgRatio));
    }
  }

  return { cols: bestCols, imgHeightRatio: bestImgRatio };
}

const PosterPreview = memo(
  forwardRef<HTMLDivElement, PosterPreviewProps>(function PosterPreview(
    {
      title,
      subtitle,
      schedule,
      climbers,
      posterSize = '60x90',
      closedVenue = false,
      venueArea = '全场',
      renderCard,
    },
    ref,
  ) {
     const ratio = POSTER_SIZE_RATIO[posterSize];
    const aspectRatioCSS =
      posterSize === '60x90' ? '2 / 3' :
      posterSize === '59x79' ? '59 / 79' :
      '3 / 4';
    const layout = calcLayout(climbers.length, ratio);
    const { cols } = layout;
    const rows = Math.ceil(climbers.length / cols);
    const scheduleLines = schedule
      ? schedule.split('\n')
      : [];

    // 检测卡片网格底部是否超过安全阈值（海报高度的 88%）
    const gridRef = useRef<HTMLDivElement>(null);
    const posterRef = useRef<HTMLDivElement>(null);
    const [showWatermark, setShowWatermark] = useState(true);
    useEffect(() => {
      const checkOverflow = () => {
        if (!gridRef.current || !posterRef.current) return;
        const posterRect = posterRef.current.getBoundingClientRect();
        const gridRect = gridRef.current.getBoundingClientRect();
        const gridBottomRatio = (gridRect.bottom - posterRect.top) / posterRect.height;
        setShowWatermark(gridBottomRatio < 0.88);
      };
      checkOverflow();
      const ro = new ResizeObserver(checkOverflow);
      if (gridRef.current) ro.observe(gridRef.current);
      if (posterRef.current) ro.observe(posterRef.current);
      return () => ro.disconnect();
    }, [climbers, scheduleLines.length, posterSize]);;

    return (
      <div
        ref={(el) => {
          // 同时绑定 forwardRef 和 posterRef
          if (typeof ref === 'function') ref(el);
          else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
          (posterRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        }}
        style={{
          aspectRatio: aspectRatioCSS,
          width: '100%',
          boxSizing: 'border-box',
          overflow: 'hidden',
          backgroundColor: '#FFE000',
          borderRadius: '8px',
          fontSize: 'clamp(9px, 3vw, 19px)',
          fontFamily: "'AlimamaShuHei', 'PingFang SC', 'Microsoft YaHei', sans-serif",
          /* 统一内边距：所有内容向画面中心缩进 */
          padding: '5%',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* ══════════════════════════════════════════
            头部区域
            ══════════════════════════════════════════ */}
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.4em',
            marginBottom: '0.5em',
          }}
        >
          {/* ── 标题区 ── */}
          <div style={{ position: 'relative' }}>

            {/* ── Logo：右上角，完整展示图形+文字 ── */}
            <div
              style={{
                position: 'absolute',
                top: '0.1em',
                right: 0,
                zIndex: 2,
              }}
            >
              <img
                src={logo}
                alt="香蕉攀岩 Logo"
                style={{
                  height: '2.2em',
                  width: 'auto',
                  objectFit: 'contain',
                }}
              />
            </div>

            {/* 门店名：小字，大标题上方 */}
            <p
              style={{
                fontSize: '1.05em',
                fontWeight: 700,
                color: '#111',
                lineHeight: 1.3,
                marginBottom: '0.1em',
                textShadow: '5px 0 0 #fff, -5px 0 0 #fff, 0 5px 0 #fff, 0 -5px 0 #fff, 4px 4px 0 #fff, -4px 4px 0 #fff, 4px -4px 0 #fff, -4px -4px 0 #fff, 5px 2px 0 #fff, -5px 2px 0 #fff, 5px -2px 0 #fff, -5px -2px 0 #fff, 2px 5px 0 #fff, -2px 5px 0 #fff, 2px -5px 0 #fff, -2px -5px 0 #fff',
                paddingRight: '8em',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {title || '香蕉攀岩'}
            </p>

            {/* 大标题行：换线信息文字 + 岩点装饰 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: '0.2em',
                paddingRight: '8em',
              }}
            >
              <h1
                style={{
                  fontSize: '2.6em',
                  fontWeight: 700,
                  color: '#000',
                  lineHeight: 1.0,
                  letterSpacing: '-0.01em',
                  fontFamily: "'AlimamaShuHei', 'PingFang SC', sans-serif",
                  flex: '0 1 auto',
                  whiteSpace: 'nowrap',
                  textShadow: '5px 0 0 #fff, -5px 0 0 #fff, 0 5px 0 #fff, 0 -5px 0 #fff, 4px 4px 0 #fff, -4px 4px 0 #fff, 4px -4px 0 #fff, -4px -4px 0 #fff, 5px 2px 0 #fff, -5px 2px 0 #fff, 5px -2px 0 #fff, -5px -2px 0 #fff, 2px 5px 0 #fff, -2px 5px 0 #fff, 2px -5px 0 #fff, -2px -5px 0 #fff',
                }}
              >
                {subtitle || '换线信息'}
              </h1>
              {/* 岩点装饰：高度与大标题行高一致 */}
              <img
                src={decoRocks}
                alt=""
                aria-hidden="true"
                style={{
                  height: '2.6em',
                  width: 'auto',
                  objectFit: 'contain',
                  flexShrink: 0,
                  marginBottom: '0.15em',
                }}
              />
            </div>
          </div>

          {/* ── 黑色信息栏 + 白色时间列表背景框 ── */}
          {scheduleLines.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3em' }}>

              {/* 黑色圆角信息栏 */}
              <div
                style={{
                  backgroundColor: '#111',
                  borderRadius: '0.45em',
                  padding: '0.35em 0.7em',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4em' }}>
                  <img
                    src={iconCalendar}
                    alt=""
                    aria-hidden="true"
                    style={{
                      height: '1em',
                      width: 'auto',
                      objectFit: 'contain',
                      flexShrink: 0,
                      filter: 'brightness(0) invert(1)',
                    }}
                  />
                  <span
                    style={{
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: '0.72em',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    换线时间表 · {closedVenue ? '闭馆换线' : '不闭馆换线'}
                  </span>
                </div>
                <span
                  style={{
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '0.72em',
                    whiteSpace: 'nowrap',
                  }}
                >
                  换线区域 · {venueArea || '全场'}
                </span>
              </div>

              {/* ── 白色背景时间列表框 ── */}
              <div
                style={{
                  backgroundColor: '#fff',
                  borderRadius: '0.45em',
                  padding: '0.4em 0.7em',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.18em',
                }}
              >
                {scheduleLines.map((line, i) => (
                  <p
                    key={i}
                    style={{
                      fontSize: '0.78em',
                      fontWeight: 700,
                      color: '#111',
                      lineHeight: 1.45,
                      minHeight: line.trim() === '' ? '0.78em' : undefined,
                    }}
                  >
                    {line || '\u00A0'}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ══════════════════════════════════════════
            定线员网格区域：flex:1 填充剩余空间
            ══════════════════════════════════════════ */}
        <div
          ref={gridRef}
          style={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridTemplateRows: `repeat(${rows}, 1fr)`,
            gap: '0.5em',
            alignContent: 'stretch',
          }}
        >
          {climbers.map((climber) =>
            renderCard ? (
              renderCard(climber, layout)
            ) : (
              <ClimberCard
                key={climber.id}
                {...climber}
                layout={layout}
              />
            ),
          )}
        </div>

        {/* ── 底部分隔线水印：当卡片底部超过海报高度 88% 时隐藏 ── */}
        <div style={{ flexShrink: 0, marginTop: showWatermark ? '0.5em' : 0, visibility: showWatermark ? 'visible' : 'hidden', height: showWatermark ? undefined : 0, overflow: 'hidden' }}>
          <img
            src={bannerWatermark}
            alt=""
            aria-hidden="true"
            style={{
              width: '100%',
              display: 'block',
              objectFit: 'fill',
            }}
          />
        </div>
      </div>
    );
  }),
);

export default PosterPreview;
