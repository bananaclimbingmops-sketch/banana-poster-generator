import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';

interface SortableListItemProps {
  id: string;
  name: string;
  onRemove: (id: string) => void;
}

/**
 * 左侧定线员列表的可拖拽排序行。
 * 使用 useSortable hook 绑定真正的拖拽事件，
 * 手柄图标绑定 listeners，整行绑定 setNodeRef。
 */
export function SortableListItem({ id, name, onRemove }: SortableListItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg select-none"
    >
      {/* 拖拽手柄 */}
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 flex-shrink-0"
        title="拖拽排序"
      >
        <GripVertical className="w-4 h-4" />
      </div>
      <span className="text-sm text-gray-700 flex-1 truncate">{name}</span>
      <button
        onClick={() => onRemove(id)}
        className="text-xs text-red-400 hover:text-red-600 flex-shrink-0"
        title={`移除 ${name}`}
      >
        ✕
      </button>
    </div>
  );
}
