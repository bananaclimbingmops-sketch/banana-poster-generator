import { memo } from 'react';
import type { ScheduleEntry } from '@/hooks/usePosterStorage';
import { iconCalendar } from '@/assets/brandAssets';

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];
const MONTH_CN = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

/** 解析日期字符串为 Date 对象（避免时区问题，直接按本地时间解析） */
function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 获取日期的月份标签 */
function getMonthLabel(dateStr: string): string {
  const d = parseDate(dateStr);
  return MONTH_CN[d.getMonth()];
}

/** 获取日期的日号 */
function getDayNum(dateStr: string): number {
  return parseDate(dateStr).getDate();
}

/** 获取日期的星期 */
function getWeekday(dateStr: string): string {
  return `周${WEEKDAY_CN[parseDate(dateStr).getDay()]}`;
}

/**
 * 计算月份标题的列跨度信息：
 * 返回每个月份标题应该从哪一列开始、跨几列
 */
interface MonthSpan {
  monthLabel: string;
  colStart: number; // 1-indexed
  colSpan: number;
}

function calcMonthSpans(entries: ScheduleEntry[]): MonthSpan[] {
  const spans: MonthSpan[] = [];
  let i = 0;
  while (i < entries.length) {
    const monthLabel = getMonthLabel(entries[i].startDate);
    let j = i;
    while (j < entries.length && getMonthLabel(entries[j].startDate) === monthLabel) {
      j++;
    }
    spans.push({ monthLabel, colStart: i + 1, colSpan: j - i });
    i = j;
  }
  return spans;
}

interface MultiScheduleGridProps {
  entries: ScheduleEntry[];
  /** 信息栏右侧小字（两行，\n分隔） */
  note?: string;
  /** 是否闭馆换线 */
  closedVenue?: boolean;
}

const MultiScheduleGrid = memo(function MultiScheduleGrid({
  entries,
  note = '请合理安排攀岩时间\n避免因换线影响您的体验',
  closedVenue = false,
}: MultiScheduleGridProps) {
  const noteLines = note ? note.split('\n') : [];
  const totalCols = entries.length || 1;
  const monthSpans = entries.length > 0 ? calcMonthSpans(entries) : [];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.3em',
      }}
    >
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
          <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.72em', whiteSpace: 'nowrap' }}>
            换线时间表 · {closedVenue ? '闭馆换线' : '换线期间不闭馆'}
          </span>
        </div>
        {noteLines.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.05em' }}>
            {noteLines.map((line, i) => (
              <span key={i} style={{ color: '#fff', fontSize: '0.48em', lineHeight: 1.4, whiteSpace: 'nowrap' }}>
                {line}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 日期卡片区域（浅色背景） */}
      <div
        style={{
          backgroundColor: 'rgba(255,255,255,0.55)',
          borderRadius: '0.45em',
          padding: '0.35em 0.3em 0.4em',
        }}
      >
        {entries.length === 0 ? (
          <div style={{ textAlign: 'center', fontSize: '0.72em', color: '#888', padding: '0.5em' }}>
            暂无换线安排
          </div>
        ) : (
          /*
           * 两行 Grid：
           * 行1：月份标题（按月份分组跨列）
           * 行2：所有日期卡片（每卡片占1列）
           */
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${totalCols}, 1fr)`,
              gridTemplateRows: 'auto auto',
              rowGap: '0.15em',
            }}
          >
            {/* 行1：月份标题 */}
            {monthSpans.map((span, si) => (
              <div
                key={si}
                style={{
                  gridRow: 1,
                  gridColumn: `${span.colStart} / span ${span.colSpan}`,
                  textAlign: 'center',
                  fontSize: '0.72em',
                  fontWeight: 700,
                  color: '#111',
                  lineHeight: 1.4,
                  paddingBottom: '0.1em',
                }}
              >
                {span.monthLabel}
              </div>
            ))}

            {/* 行2：所有日期卡片 */}
            {entries.map((entry, ei) => {
              const isLast = ei === entries.length - 1;
              const startDay = getDayNum(entry.startDate);
              const endDay = entry.endDate ? getDayNum(entry.endDate) : null;
              const startWeekday = getWeekday(entry.startDate);
              const endWeekday = entry.endDate ? getWeekday(entry.endDate) : null;

              // 日期显示：单天 "5" / 跨天 "25-26"
              const dayDisplay = endDay ? `${startDay}-${endDay}` : `${startDay}`;
              // 星期显示：单天 "周四" / 跨天 "周四 - 周五"
              const weekdayDisplay = endWeekday ? `${startWeekday} - ${endWeekday}` : startWeekday;

              const descLines = entry.description ? entry.description.split('\n') : [];

              return (
                <div
                  key={entry.id}
                  style={{
                    gridRow: 2,
                    gridColumn: ei + 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '0.3em',
                    padding: '0.2em 0.15em 0.3em',
                    borderRight: !isLast ? '1px solid rgba(0,0,0,0.12)' : 'none',
                  }}
                >
                  {/* 日期圆形徽章 */}
                  <div
                    style={{
                      backgroundColor: '#FFE000',
                      borderRadius: '50%',
                      width: '2.8em',
                      height: '2.8em',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      boxSizing: 'border-box',
                    }}
                  >
                    {/* 日期数字 */}
                    <span
                      style={{
                        fontSize: endDay ? '0.72em' : '0.9em',
                        fontWeight: 900,
                        color: '#111',
                        lineHeight: 1.1,
                        letterSpacing: '-0.02em',
                      }}
                    >
                      {dayDisplay}
                    </span>
                    {/* 星期 */}
                    <span
                      style={{
                        fontSize: '0.42em',
                        fontWeight: 700,
                        color: '#111',
                        lineHeight: 1.2,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {weekdayDisplay}
                    </span>
                  </div>

                  {/* 换线描述 */}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '0.05em',
                    }}
                  >
                    {descLines.map((line, li) => (
                      <span
                        key={li}
                        style={{
                          fontSize: '0.62em',
                          fontWeight: 700,
                          color: '#111',
                          lineHeight: 1.35,
                          textAlign: 'center',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {line}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});

export default MultiScheduleGrid;
