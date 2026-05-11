'use client';

import type { TabKey } from '@/lib/types';

interface TableTabsProps {
  tab: TabKey;
  setTab: (t: TabKey) => void;
}

const TABS: { id: TabKey; label: string }[] = [
  { id: 'T', label: 'Todos' },
  { id: 'IRR', label: '⛔ Irrecuperables' },
  { id: 'OC', label: '⚠ Alerta oculta' },
  { id: 'NUE', label: 'Nuevos' },
  { id: 'SEG45', label: '📅 Seguimiento 45d' },
];

export function TableTabs({ tab, setTab }: TableTabsProps) {
  return (
    <div className="tabs">
      {TABS.map((t) => (
        <div
          key={t.id}
          className={`tab ${tab === t.id ? 'on' : ''}`}
          onClick={() => setTab(t.id)}
        >
          {t.label}
        </div>
      ))}
    </div>
  );
}
