import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CalendarDays, ChevronRight } from 'lucide-react';

type DayGroup<T> = {
  key: string;
  label: string;
  hint: string;
  items: T[];
};

export function DayGroupedList<T>({
  items,
  getDate,
  getKey,
  renderItem,
  emptyMessage,
  defaultOpenCount = 2,
}: {
  items: T[];
  getDate: (item: T) => string | null | undefined;
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  emptyMessage: string;
  defaultOpenCount?: number;
}) {
  const groups = useMemo(() => buildDayGroups(items, getDate), [items, getDate]);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setOpenGroups((current) => {
      const next: Record<string, boolean> = {};
      groups.forEach((group, index) => {
        next[group.key] = current[group.key] ?? index < defaultOpenCount;
      });
      return next;
    });
  }, [defaultOpenCount, groups]);

  if (groups.length === 0) {
    return <div className="empty-state">{emptyMessage}</div>;
  }

  return (
    <div className="day-group-list">
      {groups.map((group) => {
        const isOpen = openGroups[group.key] ?? false;

        return (
          <section key={group.key} className={`day-group ${isOpen ? 'day-group-open' : ''}`}>
            <button
              type="button"
              className="day-group-trigger"
              onClick={() => {
                setOpenGroups((current) => ({
                  ...current,
                  [group.key]: !isOpen,
                }));
              }}
              aria-expanded={isOpen}
            >
              <span className="day-group-heading">
                <span className="day-group-caret">
                  <ChevronRight size={14} />
                </span>
                <span className="day-group-copy">
                  <span className="day-group-label">{group.label}</span>
                  <span className="day-group-hint">{group.hint}</span>
                </span>
              </span>
              <span className="day-group-meta">
                <CalendarDays size={14} />
                <span>{group.items.length}</span>
              </span>
            </button>

            {isOpen ? (
              <div className="day-group-items">
                {group.items.map((item) => (
                  <div key={getKey(item)}>{renderItem(item)}</div>
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function buildDayGroups<T>(
  items: T[],
  getDate: (item: T) => string | null | undefined,
): Array<DayGroup<T>> {
  const grouped = new Map<string, { date: Date | null; items: T[] }>();

  for (const item of items) {
    const raw = getDate(item);
    const parsed = parseDate(raw);
    const groupKey = parsed
      ? `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`
      : 'unknown';

    const existing = grouped.get(groupKey);
    if (existing) {
      existing.items.push(item);
      continue;
    }

    grouped.set(groupKey, {
      date: parsed,
      items: [item],
    });
  }

  return [...grouped.entries()]
    .sort((left, right) => {
      const leftTime = left[1].date ? left[1].date.getTime() : 0;
      const rightTime = right[1].date ? right[1].date.getTime() : 0;
      return rightTime - leftTime;
    })
    .map(([key, value]) => ({
      key,
      items: value.items,
      ...getDayGroupMeta(value.date),
    }));
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getDayGroupMeta(date: Date | null): Pick<DayGroup<unknown>, 'label' | 'hint'> {
  if (!date) {
    return {
      label: 'Unknown time',
      hint: 'Items with no valid timestamp',
    };
  }

  const startOfTarget = new Date(date);
  startOfTarget.setHours(0, 0, 0, 0);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const diffDays = Math.round((startOfToday.getTime() - startOfTarget.getTime()) / 86_400_000);

  if (diffDays === 0) {
    return {
      label: 'Today',
      hint: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    };
  }

  if (diffDays === 1) {
    return {
      label: 'Yesterday',
      hint: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    };
  }

  return {
    label: date.toLocaleDateString(undefined, { weekday: 'long' }),
    hint: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
  };
}
