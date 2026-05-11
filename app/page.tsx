'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { Header } from '@/components/Header';
import { KpiSections } from '@/components/KpiSection';
import { TableTabs } from '@/components/TableTabs';
import { TableFilters, type FilterState } from '@/components/TableFilters';
import { DashboardTable } from '@/components/DashboardTable';
import { segmento } from '@/lib/helpers';
import type {
  View, PaisFilter, TabKey, TherapistView,
  TherapistRow, TherapistStateRow, MonthlyMetricsRow,
} from '@/lib/types';

export default function DashboardPage() {
  const router = useRouter();
  const supabase = getSupabase();

  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<string | undefined>(undefined);
  const [therapists, setTherapists] = useState<TherapistView[]>([]);
  const [currentMonth, setCurrentMonth] = useState<string>('—');

  const [view, setView] = useState<View>('pred');
  const [pais, setPais] = useState<PaisFilter>('T');
  const [tab, setTab] = useState<TabKey>('T');
  const [filters, setFilters] = useState<FilterState>({
    search: '', accionable: '', segmento: '', tendencia: '', senal: '',
  });
  const [vidFilter, setVidFilter] = useState(false);

  // Auth + carga de datos
  useEffect(() => {
    let mounted = true;

    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;

      if (!session) {
        router.replace('/login');
        return;
      }

      setUserEmail(session.user.email);

      // 1. Buscar el mes más reciente
      const { data: months, error: monthsErr } = await supabase
        .from('therapist_state')
        .select('month')
        .order('computed_at', { ascending: false })
        .limit(1);

      if (monthsErr) {
        console.error('Error cargando meses:', monthsErr);
      }

      const latestMonth = months?.[0]?.month;
      if (!latestMonth) {
        setLoading(false);
        return;
      }

      setCurrentMonth(latestMonth);

      // 2. Cargar therapists activos
      const { data: thRows } = await supabase
        .from('therapists')
        .select('*')
        .eq('activo', true);

      // 3. Cargar therapist_state del mes actual
      const { data: stateRows } = await supabase
        .from('therapist_state')
        .select('*')
        .eq('month', latestMonth);

      // 4. Cargar monthly_metrics del mes actual
      const { data: metricsRows } = await supabase
        .from('monthly_metrics')
        .select('*')
        .eq('month', latestMonth);

      if (!mounted) return;

      // 5. Mergear todo en TherapistView
      const stateMap = new Map<string, TherapistStateRow>(
        (stateRows || []).map((s: TherapistStateRow) => [s.therapist_id, s])
      );
      const metricsMap = new Map<string, MonthlyMetricsRow>(
        (metricsRows || []).map((m: MonthlyMetricsRow) => [m.therapist_id, m])
      );

      const merged: TherapistView[] = (thRows || []).map((t: TherapistRow) => {
        const st = stateMap.get(t.id);
        const mt = metricsMap.get(t.id);

        // Calcular días en plataforma
        const inicioDate = t.inicio ? new Date(t.inicio) : null;
        const dias = inicioDate
          ? Math.floor((Date.now() - inicioDate.getTime()) / (1000 * 60 * 60 * 24))
          : 0;

        return {
          id: t.id,
          nombre: t.nombre,
          pais: t.pais,
          email: t.email,
          corriente: t.corriente,
          inicio: t.inicio,
          dias,
          activo: t.activo,

          score: st?.score || 0,
          zona: st?.zona || 'Rojo',
          cuadrante: st?.cuadrante || 'D',
          tendencia: st?.tendencia || 'sin actividad',
          irrecuperable: st?.irrecuperable || false,
          senal: st?.senal || null,
          accionable: st?.accionable || 'monitorear',
          sesPaciente3m: Number(st?.ses_paciente_3m || 0),
          ganMes: Number(st?.gan_mes || 0),
          diasSinSesion: st?.dias_sin_sesion || 0,
          videollamada: st?.videollamada || false,

          sesMes: mt?.sesiones_totales || null,
          pacMes: mt?.pacientes_unicos || null,
          regMes: mt?.registros_totales || null,
          hs: mt?.hs_disponibles || 0,
          ultimaSesion: mt?.ultima_sesion || null,
        };
      });

      setTherapists(merged);
      setLoading(false);
    }

    init();

    // Listener para logout
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace('/login');
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [router, supabase]);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  }, [router, supabase]);

  const filtered = useMemo(() => {
    return therapists
      .filter((r) => pais === 'T' || r.pais === pais)
      .filter((r) => {
        if (tab === 'IRR' && !r.irrecuperable) return false;
        if (tab === 'OC' && !(r.score >= 70 && r.tendencia === 'bajando')) return false;
        if (tab === 'NUE' && segmento(r.dias) !== 'Nuevo') return false;
        if (tab === 'SEG45' && !r.videollamada) return false;

        if (filters.search && !r.nombre.toLowerCase().includes(filters.search.toLowerCase())) return false;
        if (filters.accionable && r.accionable !== filters.accionable) return false;
        if (filters.segmento && segmento(r.dias) !== filters.segmento) return false;
        if (filters.tendencia && r.tendencia !== filters.tendencia) return false;
        if (filters.senal && r.senal !== filters.senal) return false;
        if (vidFilter && !r.videollamada) return false;

        return true;
      });
  }, [therapists, pais, tab, filters, vidFilter]);

  function handleKpiClick(filter: { acc?: string; sen?: string; tab?: string; vid?: boolean }) {
    setFilters({
      search: filters.search,
      accionable: filter.acc || '',
      segmento: '', tendencia: '',
      senal: filter.sen || '',
    });
    setVidFilter(filter.vid || false);
    if (filter.tab) setTab(filter.tab as TabKey);
    else setTab('T');
  }

  if (loading) {
    return <div className="loading-wrap">Cargando…</div>;
  }

  return (
    <>
      <Header
        view={view} setView={setView}
        pais={pais} setPais={setPais}
        mesActual={currentMonth}
        userEmail={userEmail}
        onLogout={handleLogout}
      />

      <div className="main">
        {therapists.length === 0 ? (
          <div className="empty-wrap">
            <h3>No hay datos cargados todavía</h3>
            <p>El próximo paso es importar los terapeutas del HTML actual a Supabase.</p>
            <p style={{ marginTop: 8, fontSize: 11, color: 'var(--t3)' }}>
              Una vez que importes datos en la tabla <code>therapist_state</code>,
              <br />el dashboard los va a mostrar automáticamente.
            </p>
          </div>
        ) : view === 'prog' ? (
          <div className="empty-wrap">
            <h3>📊 Progreso</h3>
            <p>Esta vista se implementa en el próximo sprint con una librería de gráficos.</p>
          </div>
        ) : (
          <>
            <KpiSections data={therapists} pais={pais} onKpiClick={handleKpiClick} />
            <TableTabs tab={tab} setTab={setTab} />
            <TableFilters filters={filters} setFilters={setFilters} count={filtered.length} />
            <DashboardTable data={filtered} onRowClick={(t) => console.log('TODO: modal', t)} />
          </>
        )}
      </div>
    </>
  );
}
