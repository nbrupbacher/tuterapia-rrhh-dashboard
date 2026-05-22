'use client';

import type { TabKey } from '@/lib/types';

interface TableTabsProps {
  tab: TabKey;
  setTab: (t: TabKey) => void;
}

const TABS: { id: TabKey; label: string; cls?: string }[] = [
  { id: 'T',    label: 'Todos' },
  { id: 'CRIT', label: '🔴 Críticas', cls: 'tab-critico' },
  { id: 'V45',  label: '📅 Ventana 45-55' },
  { id: 'DEST', label: '⭐ Destacados' },
  { id: 'NUE',  label: 'Nuevos' },
];

export function TableTabs({ tab, setTab }: TableTabsProps) {
  return (
    <div className="tabs">
      {TABS.map((t) => (
        <div
          key={t.id}
          className={`tab ${t.cls || ''} ${tab === t.id ? 'on' : ''}`}
          onClick={() => setTab(t.id)}
        >
          {t.label}
        </div>
      ))}
    </div>
  );
}
