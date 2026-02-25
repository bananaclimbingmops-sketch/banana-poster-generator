import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import ClimberCard from './ClimberCard';
import type { ClimberCardProps } from './ClimberCard';
import type { CardLayout } from './PosterPreview';

type SortableClimberCardProps = Omit<ClimberCardProps, 'onRemove'> & {
  onRemove: (id: string) => void;
  layout?: CardLayout;
};

/**
 * UX 优化：使用 @dnd-kit/sortable 为定线员卡片添加拖拽排序能力。
 * 通过 useSortable hook 获取拖拽所需的 ref、属性和变换样式，
 * 并在卡片左上角渲染一个拖拽手柄图标，提示用户可拖动。
 * layout prop 透传给 ClimberCard 以支持自适应排版。
 */
export function SortableClimberCard({ layout, ...props }: SortableClimberCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative',
    height: '100%',
  };

  return (
    <div ref={setNodeRef} style={style}>
      {/* 拖拽手柄 */}
      <div
        {...attributes}
        {...listeners}
        className="absolute top-1 left-1 z-10 cursor-grab active:cursor-grabbing p-0.5 rounded bg-white/70 hover:bg-white shadow-sm"
        title="拖拽排序"
      >
        <GripVertical className="w-3 h-3 text-gray-400" />
      </div>
      <ClimberCard {...props} layout={layout} />
    </div>
  );
}
