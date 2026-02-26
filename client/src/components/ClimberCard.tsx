import { memo } from 'react';
import { X } from 'lucide-react';
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
  /** 由 PosterPreview 根据定线员数量计算后传入，控制卡片内部布局比例 */
  layout?: CardLayout;
}

/**
 * 性能优化：使用 React.memo 包裹，仅在 props 变化时重新渲染。
 *
 * 布局说明：
 * - 卡片整体高度由父网格（grid）决定，自身 height: 100%
 * - 图片区高度 = imgHeightRatio × 100%（通过 flex 比例实现）
 * - 文字区占剩余高度，字号使用 clamp 响应式缩放
 */
const ClimberCard = memo(function ClimberCard({
  id,
  name,
  bio,
  image,
  role,
  nationality,
  onRemove,
  layout,
}: ClimberCardProps) {
  const roleLabel = role === 'special' ? '特邀定线员' : '定线员';
  const roleBgClass = role === 'special' ? '' : 'bg-yellow-300';
  const roleStyle = role === 'special'
    ? { backgroundColor: '#111', color: '#ffda2a' }
    : { color: '#111' };
  const imgRatio = layout?.imgHeightRatio ?? 0.6;
  const flagSrc = nationality ? FLAG_MAP[nationality] : null;

  return (
    <div
      className="relative rounded-xl shadow-md"
      style={{ height: '100%' }}
    >
      {/* 内层：rounded + overflow-hidden 裁剪内容，bg-white 提供白色背景 */}
      <div className="absolute inset-0 rounded-xl bg-white" />
      <div className="relative rounded-xl overflow-hidden flex flex-col" style={{ height: '100%' }}>
      {/* 移除按钮 */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-1 right-1 z-10 hover:bg-red-100 w-6 h-6"
        onClick={() => onRemove?.(id)}
        aria-label={`移除 ${name}`}
      >
        <X className="w-3 h-3 text-red-500" />
      </Button>

      {/* 图片区：flex 比例控制高度 */}
      <div
        className="bg-gradient-to-br from-yellow-100 to-yellow-50 flex items-center justify-center overflow-hidden flex-shrink-0"
        style={{ flex: `${imgRatio} 0 0` }}
      >
        {image ? (
          <img
            src={image}
            alt={name}
            className="w-full h-full object-cover object-top"
            loading="lazy"
          />
        ) : (
          <div className="text-center text-gray-400">
            <div className="mb-1" style={{ fontSize: 'clamp(1rem, 3vw, 2rem)' }}>📷</div>
            <p style={{ fontSize: 'clamp(0.4rem, 1vw, 0.65rem)' }}>暂无照片</p>
          </div>
        )}
      </div>

      {/* 文字区：flex-1 占剩余高度，overflow-hidden 防止撑出 */}
      <div
        className="bg-white flex flex-col justify-between overflow-hidden"
        style={{
          flex: `${1 - imgRatio} 0 0`,
          padding: 'clamp(3px, 0.8vw, 8px)',
        }}
      >
        <div style={{ overflow: 'hidden', minHeight: 0 }}>
          {/* 名字 + 国旗图标（与文字等高，inline-flex 对齐） */}
          <div
            className="flex items-center gap-1 leading-tight overflow-hidden"
            style={{ marginBottom: '2px' }}
          >
            <h3
              className="font-bold text-black truncate leading-tight"
              style={{ fontSize: 'clamp(0.55rem, 1.5vw, 0.9rem)' }}
            >
              {name || '定线员'}
            </h3>
            {flagSrc && (
              <img
                src={flagSrc}
                alt={nationality}
                style={{
                  height: '1em',
                  width: 'auto',
                  flexShrink: 0,
                  display: 'inline-block',
                  verticalAlign: 'middle',
                  borderRadius: '2px',
                  objectFit: 'cover',
                }}
              />
            )}
          </div>
          <p
            className="text-gray-600 overflow-hidden leading-snug"
            style={{
              fontSize: 'clamp(0.45rem, 1.1vw, 0.7rem)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {bio || '暂无简介'}
          </p>
        </div>
        <div className="flex justify-center mt-1">
          <div
            className={`rounded-full font-bold flex items-center justify-center ${roleBgClass}`}
            style={{
              fontSize: 'clamp(0.4rem, 1vw, 0.65rem)',
              padding: 'clamp(2px, 0.4vw, 4px) clamp(4px, 1vw, 10px)',
              lineHeight: 1,
              ...roleStyle,
            }}
          >
            {roleLabel}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
});

export default ClimberCard;
