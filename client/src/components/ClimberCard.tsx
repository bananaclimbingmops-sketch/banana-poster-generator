import { memo, useState } from 'react';
import { X, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CardLayout } from './PosterPreview';
import { FLAG_MAP } from '@/assets/flagAssets';

export interface ClimberCardProps {
  id: string;
  name: string;
  bio: string;
  image?: string;
  role: 'regular' | 'special';
  nationality?: string;
  onRemove?: (id: string) => void;
  onEdit?: (id: string) => void;
  /** 由 PosterPreview 根据定线员数量计算后传入，控制卡片内部布局比例 */
  layout?: CardLayout;
}

/**
 * ClimberCard 支持两种布局模式：
 * - 竖向胶囊（1-3人）：上图下文，底部全宽色块标签
 * - 横向胶囊（4人+）：左图右文，右侧半圆标签（圆心与胶囊右侧圆角圆心重合）
 *
 * 横向半圆标签几何关系：
 *   胶囊高度 H，border-radius:999px → 圆角半径 R = H/2
 *   胶囊右侧圆角圆心坐标（相对外层包装）= (wrapper_right - R, H/2)
 *   标签圆：直径 = H（height:100% + aspect-ratio:1/1），right:0
 *     → 圆右边在 wrapper_right，圆心 x = wrapper_right - H/2 = 胶囊圆角圆心 ✅
 *   圆在胶囊外部（绝对定位在外层包装上），胶囊 z-index:1 遮住圆的左半部分
 *   右半圆（圆心到 wrapper_right）在胶囊圆角弧线区域内，视觉上与胶囊圆角无缝衔接
 *   整个圆不超出外层包装右边缘，无需额外 padding
 */
const ClimberCard = memo(function ClimberCard({
  id,
  name,
  bio,
  image,
  role,
  nationality,
  onRemove,
  onEdit,
  layout,
}: ClimberCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  const roleLabel = role === 'special' ? '特邀定线员' : '定线员';
  const roleStyle = role === 'special'
    ? { backgroundColor: '#111', color: '#ffda2a' }
    : { backgroundColor: '#ffda2a', color: '#111' };

  const flagSrc = nationality ? FLAG_MAP[nationality] : null;
  const flagEmoji = flagSrc ? <img src={flagSrc} alt={nationality} style={{ height: '1em', width: 'auto', flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', borderRadius: '2px', objectFit: 'cover' }} /> : null;

  // ── 操作按钮区（悬停时显示，导出时隐藏）──
  const actionButtons = (
    <div
      className="absolute top-1 right-1 z-10 flex gap-1 transition-opacity duration-150"
      style={{ opacity: isHovered ? 1 : 0 }}
      data-export-hide="true"
    >
      {onEdit && (
        <Button
          variant="ghost"
          size="icon"
          className="hover:bg-blue-100 w-6 h-6 bg-white/80 backdrop-blur-sm shadow-sm"
          onClick={(e) => { e.stopPropagation(); onEdit(id); }}
          aria-label={`编辑 ${name}`}
          tabIndex={isHovered ? 0 : -1}
        >
          <Pencil className="w-3 h-3 text-blue-500" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="hover:bg-red-100 w-6 h-6 bg-white/80 backdrop-blur-sm shadow-sm"
        onClick={(e) => { e.stopPropagation(); onRemove?.(id); }}
        aria-label={`移除 ${name}`}
        tabIndex={isHovered ? 0 : -1}
      >
        <X className="w-3 h-3 text-red-500" />
      </Button>
    </div>
  );

  // ══════════════════════════════════════════
  // 横向胶囊模式（4人+）：左图右文 + 右侧半圆标签
  // ══════════════════════════════════════════
  if (layout?.mode === 'horizontal') {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* ── 胶囊容器──
            宽度 = 100%，overflow:hidden 裁剪圆形标签的左半圆 */}
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: '999px',
            backgroundColor: 'white',
            overflow: 'hidden',
            boxShadow: '0 2px 8px rgba(0,0,0,0.10)',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            position: 'relative',
          }}
        >
          {actionButtons}

          {/* ── 白色内描边层（zIndex:30，覆盖在标签上方）── */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '999px',
              border: '4pt solid white',
              zIndex: 30,
              pointerEvents: 'none',
            }}
          />

          {/* ── SVG 右半圆标签背景（胶囊内部绝对定位）──
               SVG 宽度 = 高度 = H，圆心在 SVG 左边缘中心（viewBox x=0）
               圆心对应胶囊圆角圆心，弧线与胶囊圆角完全重叠 */}
          <svg
            viewBox="0 0 100 200"
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              height: '100%',
              aspectRatio: '0.5 / 1',
              zIndex: 10,
              pointerEvents: 'none',
            }}
          >
            {/* 圆心在 (0, 100)，半径 100，绘制右半圆 */}
            <path
              d="M 0 0 A 100 100 0 0 1 0 200 Z"
              fill={roleStyle.backgroundColor as string}
            />
          </svg>

          {/* 左侧：圆形照片，宽度 = 高度（正圆） */}
          <div
            style={{
              height: '100%',
              aspectRatio: '1 / 1',
              flexShrink: 0,
              padding: '4pt',
              boxSizing: 'border-box',
            }}
          >
          <div
            style={{
              width: '100%',
              height: '100%',
              borderRadius: '50%',
              overflow: 'hidden',
              backgroundColor: '#e5e7eb',
            }}
          >
            {image ? (
              <img
                src={image}
                alt={name}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  display: 'block',
                }}
                loading="lazy"
              />
            ) : (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#9ca3af',
                }}
              >
                <span style={{ fontSize: 'clamp(1rem, 3cqh, 2rem)' }}>📷</span>
                <p style={{ fontSize: 'clamp(0.35rem, 1cqh, 0.6rem)', marginTop: '2px' }}>暂无照片</p>
              </div>
            )}
          </div>
          </div>

          {/* 中间：名字 + 简介 */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 'clamp(2px, 0.4em, 6px)',
              padding: 'clamp(4px, 0.6em, 10px) clamp(6px, 0.8em, 12px)',
              overflow: 'hidden',
            }}
          >
            {name && (
              <p
                style={{
                  fontSize: 'clamp(0.45rem, 0.9em, 0.8rem)',
                  fontWeight: 700,
                  color: '#111',
                  lineHeight: 1.2,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {flagEmoji && <span style={{ marginRight: '0.3em' }}>{flagEmoji}</span>}
                {name}
              </p>
            )}
            {bio && (
              <p
                style={{
                  fontSize: 'clamp(0.4rem, 0.82em, 0.72rem)',
                  color: '#374151',
                  lineHeight: 1.45,
                  whiteSpace: 'pre-line',
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 4,
                  WebkitBoxOrient: 'vertical',
                }}
              >
                {bio}
              </p>
            )}
          </div>
        </div>

        {/* ── 半圆标签文字层（outerDiv 中绝对定位，不受胶囊 overflow:hidden 限制）── */}
        {/* 文字层 */}
        <div
          style={{
            position: 'absolute',
            right: '4pt',
            top: 0,
            height: '100%',
            aspectRatio: '0.5 / 1',
            zIndex: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: '0.05em',
            pointerEvents: 'none',
          }}
        >
          {role === 'special' ? (
            <>
              <span style={{ fontSize: 'clamp(0.35rem, 0.75em, 0.85rem)', fontWeight: 800, color: roleStyle.color as string, lineHeight: 1.2 }}>特</span>
              <span style={{ fontSize: 'clamp(0.35rem, 0.75em, 0.85rem)', fontWeight: 800, color: roleStyle.color as string, lineHeight: 1.2 }}>邀</span>
              <span style={{ fontSize: 'clamp(0.35rem, 0.75em, 0.85rem)', fontWeight: 800, color: roleStyle.color as string, lineHeight: 1.2 }}>定</span>
              <span style={{ fontSize: 'clamp(0.35rem, 0.75em, 0.85rem)', fontWeight: 800, color: roleStyle.color as string, lineHeight: 1.2 }}>线</span>
              <span style={{ fontSize: 'clamp(0.35rem, 0.75em, 0.85rem)', fontWeight: 800, color: roleStyle.color as string, lineHeight: 1.2 }}>员</span>
            </>
          ) : (
            <>
              <span style={{ fontSize: 'clamp(0.35rem, 0.75em, 0.85rem)', fontWeight: 800, color: roleStyle.color as string, lineHeight: 1.2 }}>定</span>
              <span style={{ fontSize: 'clamp(0.35rem, 0.75em, 0.85rem)', fontWeight: 800, color: roleStyle.color as string, lineHeight: 1.2 }}>线</span>
              <span style={{ fontSize: 'clamp(0.35rem, 0.75em, 0.85rem)', fontWeight: 800, color: roleStyle.color as string, lineHeight: 1.2 }}>员</span>
            </>
          )}
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════
  // 竖向胶囊模式（1-3人）：上图下文
  // ══════════════════════════════════════════
  const isNarrow = layout?.cols === 1;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'stretch',
        position: 'relative',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 胶囊容器 */}
      <div
        style={{
          width: isNarrow ? '55%' : '100%',
          height: '100%',
          borderRadius: '999px',
          backgroundColor: 'white',
          overflow: 'hidden',
          boxShadow: '0 2px 8px rgba(0,0,0,0.10)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {actionButtons}

        {/* ── 白色内描边层（zIndex:30，覆盖在标签上方）── */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '999px',
            border: '4pt solid white',
            zIndex: 30,
            pointerEvents: 'none',
          }}
        />

        {/* 上方：正圆形照片区，宽度=胶囊宽度，高度=宽度（正圆） */}
        <div
          style={{
            width: '100%',
            aspectRatio: '1 / 1',
            flexShrink: 0,
            padding: '4pt',
            boxSizing: 'border-box',
          }}
        >
        <div
          style={{
            width: '100%',
            height: '100%',
            position: 'relative',
            overflow: 'hidden',
            backgroundColor: '#e5e7eb',
            borderRadius: '50%',
          }}
        >
          {image ? (
            <img
              src={image}
              alt={name}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                objectPosition: 'top',
                display: 'block',
              }}
              loading="lazy"
            />
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#9ca3af',
              }}
            >
              <span style={{ fontSize: 'clamp(1.5rem, 5cqh, 3rem)' }}>📷</span>
              <p style={{ fontSize: 'clamp(0.4rem, 1.2cqh, 0.7rem)', marginTop: '4px' }}>暂无照片</p>
            </div>
          )}
        </div>
        </div>

        {/* 中间：名字 + 简介 */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 'clamp(4px, 0.8em, 10px) clamp(6px, 1em, 14px)',
            gap: 'clamp(2px, 0.4em, 5px)',
            overflow: 'hidden',
            paddingBottom: 'clamp(28px, 18%, 50px)',
          }}
        >
          {name && (
            <p
              style={{
                fontSize: 'clamp(0.5rem, 1em, 0.9rem)',
                fontWeight: 700,
                color: '#111',
                lineHeight: 1.2,
                textAlign: 'center',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                width: '100%',
              }}
            >
              {flagEmoji && <span style={{ marginRight: '0.3em' }}>{flagEmoji}</span>}
              {name}
            </p>
          )}
          {bio && (
            <p
              style={{
                fontSize: 'clamp(0.38rem, 0.8em, 0.68rem)',
                color: '#374151',
                lineHeight: 1.45,
                textAlign: 'center',
                whiteSpace: 'pre-line',
                overflow: 'hidden',
                display: '-webkit-box',
                WebkitLineClamp: 4,
                WebkitBoxOrient: 'vertical',
                width: '100%',
              }}
            >
              {bio}
            </p>
          )}
        </div>

        {/* ── 底部半圆标签（胶囊内部绝对定位，受overflow:hidden裁剪与圆角无缝衔接）──
             circle+clipPath 方式，避免 SVG 弧线退化问题 */}
        <svg
          viewBox="0 0 200 100"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            width: '100%',
            aspectRatio: '2 / 1',
            zIndex: 10,
            pointerEvents: 'none',
          }}
        >
          <defs>
            <clipPath id={`halfCircleClip-${id}`}>
              <rect x="0" y="0" width="200" height="100" />
            </clipPath>
          </defs>
          {/* 圆心在 (100, 0)，半径 100，用 clipPath 裁剪为下半圆 */}
          <circle
            cx="100"
            cy="0"
            r="100"
            fill={roleStyle.backgroundColor as string}
            clipPath={`url(#halfCircleClip-${id})`}
          />
        </svg>

        {/* ── 标签文字层（胶囊内部，zIndex:20）── */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            width: '100%',
            aspectRatio: '2 / 1',
            zIndex: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              fontSize: 'clamp(0.5rem, 1em, 0.9rem)',
              fontWeight: 800,
              color: roleStyle.color as string,
              letterSpacing: '0.1em',
              lineHeight: 1,
              paddingBottom: '0.2em',
            }}
          >
            {roleLabel}
          </span>
        </div>

      </div>
    </div>
  );
});

export default ClimberCard;
