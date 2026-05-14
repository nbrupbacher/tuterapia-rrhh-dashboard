'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { Header } from '@/components/Header';
import { KpiSections } from '@/components/KpiSection';
import { KpiDeltas } from '@/components/KpiDeltas';
import { TableTabs } from '@/components/TableTabs';
import { TableFilters, type FilterState } from '@/components/TableFilters';
import { DashboardTable } from '@/components/DashboardTable';
import { TherapistModal } from '@/components/TherapistModal';
import { ProgressView } from '@/components/ProgressView';
import { segmento } from '@/lib/helpers';
import type {
  View, PaisFilter, TabKey, TherapistView,
  TherapistRow, TherapistStateRow, MonthlyMetricsRow,
} from '@/lib/types';

interface PrevStats {
  scoreAvg: number | null;
  ganTotal: number | null;
  spAvgMes: number | null;   // sp mensual del mes anterior (no 3m)
}

type PrevStatsByPais = Record<PaisFilter, PrevStats>;
const EMPTY_PREV_STATS: PrevStats = { scoreAvg: null, ganTotal: null, spAvgMes: null };

export default function DashboardPage() {
  const router = useRouter();
  const supabase = getSupabase();

  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<string | undefined>(undefined);
  const [therapists, setTherapists] = useState<TherapistView[]>([]);
  const [currentMonth, setCurrentMonth] = useState<string>('—');
  const [prevStatsByPais, setPrevStatsByPais] = useState<PrevStatsByPais>({
    T: EMPTY_PREV_STATS, AR: EMPTY_PREV_STATS, UY: EMPTY_PREV_STATS,
  });
  const [selectedTherapist, setSelectedTherapist] = useState<TherapistView | null>(null);

  const [view, setView] = useState<View>('pred');
  const [pais, setPais] = useState<PaisFilter>('T');
  const [tab, setTab] = useState<TabKey>('T');
  const [filters, setFilters] = useState<FilterState>({
    search: '', accionable: '', segmento: '', tendencia: '', senal: '', cuadrante: '',
  });
  const [vidFilter, setVidFilter] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;
      if (!session) { router.replace('/login'); return; }
      setUserEmail(session.user.email);

      const { data: months } = await supabase
        .from('therapist_state')
        .select('month')
        .order('month', { ascending: false });
      const uniqueMonths = Array.from(new Set((months || []).map((m: any) => m.month))) as string[];
      if (!uniqueMonths.length) { setLoading(false); return; }

      const latestMonth = uniqueMonths[0];
      const prevMonth = uniqueMonths[1] || null;
      setCurrentMonth(latestMonth);

      const { data: thRows } = await supabase.from('therapists').select('*').eq('activo', true).limit(2000);

      // State mes actual
      const { data: stateRows } = await supabase.from('therapist_state').select('*').eq('month', latestMonth).limit(2000);
      // State mes anterior (para calcular deltas)
      let prevStateRows: { therapist_id: string; score: number | null; gan_mes: number | null; ses_paciente_3m: number | null }[] = [];
      if (prevMonth) {
        const { data } = await supabase
          .from('therapist_state')
          .select('therapist_id, score, gan_mes, ses_paciente_3m')
          .eq('month', prevMonth)
          .limit(2000);
        prevStateRows = (data || []) as typeof prevStateRows;
      }
      // Metrics actual + anterior
      const monthsToFetch = prevMonth ? [latestMonth, prevMonth] : [latestMonth];
      const { data: metricsRows } = await supabase.from('monthly_metrics').select('*').in('month', monthsToFetch).limit(5000);

      if (!mounted) return;

      // Calcular stats del mes anterior POR PAÍS
      if (prevStateRows.length > 0 && thRows) {
        // Map therapist_id → pais
        const paisMap = new Map<string, 'AR' | 'UY'>(
          (thRows as TherapistRow[]).map(t => [t.id, t.pais])
        );
        // Datos de monthly_metrics del mes anterior con id (para sp mensual)
        const prevMetricsList = (metricsRows || []).filter((m: MonthlyMetricsRow) => m.month === prevMonth);
        
        function computeFor(filter: PaisFilter): PrevStats {
          const ps = prevStateRows.filter((r: any) =>
            filter === 'T' || paisMap.get(r.therapist_id) === filter
          );
          const pm = prevMetricsList.filter((m: MonthlyMetricsRow) =>
            filter === 'T' || paisMap.get(m.therapist_id) === filter
          );
          if (!ps.length) return EMPTY_PREV_STATS;
          const scoreAvg = ps.reduce((s, r: any) => s + (Number(r.score) || 0), 0) / ps.length;
          const ganTotal = ps.reduce((s, r: any) => s + (Number(r.gan_mes) || 0), 0);
          // sp mensual = total sesiones / total pacientes (no promedio de promedios)
          const totSes = pm.reduce((s, m) => s + (Number(m.sesiones_totales) || 0), 0);
          const totPac = pm.reduce((s, m) => s + (Number(m.pacientes_unicos) || 0), 0);
          const spAvgMes = totPac > 0 ? totSes / totPac : null;
          return { scoreAvg, ganTotal, spAvgMes };
        }
        
        // Necesito el id del state row para mappear. La query original era:
        //   .select('score, gan_mes, ses_paciente_3m')
        // Necesito agregar therapist_id. Lo hago abajo.
        setPrevStatsByPais({
          T: computeFor('T'),
          AR: computeFor('AR'),
          UY: computeFor('UY'),
        });
      }

      const stateMap = new Map<string, TherapistStateRow>(
        (stateRows || []).map((s: TherapistStateRow) => [s.therapist_id, s])
      );
      const metricsCurrent = new Map<string, MonthlyMetricsRow>();
      const metricsPrev = new Map<string, MonthlyMetricsRow>();
      (metricsRows || []).forEach((m: MonthlyMetricsRow) => {
        if (m.month === latestMonth) metricsCurrent.set(m.therapist_id, m);
        else if (m.month === prevMonth) metricsPrev.set(m.therapist_id, m);
      });

      const merged: TherapistView[] = (thRows || []).map((t: TherapistRow) => {
        const st = stateMap.get(t.id);
        const mt = metricsCurrent.get(t.id);
        const mp = metricsPrev.get(t.id);
        const inicioDate = t.inicio ? new Date(t.inicio) : null;
        const dias = inicioDate
          ? Math.floor((Date.now() - inicioDate.getTime()) / (1000 * 60 * 60 * 24))
          : 0;
        return {
          id: t.id, nombre: t.nombre, pais: t.pais, email: t.email,
          telefono: t.telefono,
          corriente: t.corriente, inicio: t.inicio, dias, activo: t.activo,
          regTotalHist: t.registros_totales_hist || 0,
          sesionesHist: t.sesiones_totales_hist || 0,
          pacientesHist: t.pacientes_unicos_hist || 0,
          score: st?.score || 0,
          zona: st?.zona || 'Rojo',
          cuadrante: st?.cuadrante || 'D',
          tendencia: st?.tendencia || 'sin actividad',
          irrecuperable: st?.irrecuperable || false,
          senal: st?.senal || null,
          accionable: st?.accionable || 'monitorear',
          sesPaciente3m: Number(st?.ses_paciente_3m || 0),
          ganMes: Number(st?.gan_mes || 0),
          diasSinSesion: st?.dias_sin_sesion ?? null,
          videollamada: st?.videollamada || false,
          tasaCancelMes: st?.tasa_cancel != null ? Number(st.tasa_cancel) : null,
          reg3m: st?.reg_3m != null ? Number(st.reg_3m) : null,
          sesMes: mt?.sesiones_totales ?? null,
          pacMes: mt?.pacientes_unicos ?? null,
          regMes: mt?.registros_mes ?? null,
          hs: mt?.hs_disponibles || 0,
          ultimaSesion: mt?.ultima_sesion || null,
          pacAnt: mp?.pacientes_unicos ?? null,
          sesAnt: mp?.sesiones_totales ?? null,
          regAnt: mp?.registros_mes ?? null,
        };
      });
      setTherapists(merged);
      setLoading(false);
    }
    init();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) router.replace('/login');
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, [router, supabase]);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  }, [router, supabase]);

  // Función helper: limpiar todos los filtros (excepto search)
  function clearAllFilters() {
    setFilters({
      search: filters.search,
      accionable: '', segmento: '', tendencia: '', senal: '', cuadrante: '',
    });
    setVidFilter(false);
    setTab('T');
  }

  const filtered = useMemo(() => {
    return therapists
      .filter((r) => pais === 'T' || r.pais === pais)
      .filter((r) => {
        // Tabs (mutuamente exclusivos)
        if (tab === 'IRR' && !r.irrecuperable) return false;
        if (tab === 'OC' && !(r.score >= 70 && r.tendencia === 'bajando')) return false;
        if (tab === 'NUE' && segmento(r.dias) !== 'Nuevo') return false;
        if (tab === 'SEG45' && !r.videollamada) return false;

        // Filtros del select
        if (filters.search && !r.nombre.toLowerCase().includes(filters.search.toLowerCase())) return false;
        if (filters.accionable && r.accionable !== filters.accionable) return false;
        if (filters.segmento && segmento(r.dias) !== filters.segmento) return false;
        if (filters.tendencia && r.tendencia !== filters.tendencia) return false;
        if (filters.senal && r.senal !== filters.senal) return false;
        if (filters.cuadrante && r.cuadrante !== filters.cuadrante) return false;
        if (vidFilter && !r.videollamada) return false;
        return true;
      });
  }, [therapists, pais, tab, filters, vidFilter]);

  // Handler unificado: cualquier click en KPI resetea TODO lo demás (filtros + tab + bucket)
  // y aplica solo lo nuevo. Así no se superponen filtros entre clicks.
  function handleKpiClick(filter: { acc?: string; sen?: string; tab?: string; vid?: boolean }) {
    setFilters({
      search: filters.search,  // mantengo search
      accionable: filter.acc || '',
      segmento: '', tendencia: '',
      senal: filter.sen || '',
      cuadrante: '',
    });
    setVidFilter(filter.vid || false);
    setTab(filter.tab ? (filter.tab as TabKey) : 'T');
  }

const hayFiltrosActivos = useMemo(() => {
    return (
      tab !== 'T' ||
      vidFilter ||
      filters.accionable !== '' ||
      filters.segmento !== '' ||
      filters.tendencia !== '' ||
      filters.senal !== '' ||
      filters.cuadrante !== ''
    );
  }, [tab, vidFilter, filters]);

  if (loading) return <div className="loading-wrap">Cargando…</div>;

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
          <div className="empty-wrap"><h3>No hay datos cargados todavía</h3></div>
        ) : view === 'prog' ? (
          <ProgressView pais={pais} />
        ) : (
          <>
            <KpiDeltas
              data={therapists.filter(t => pais === 'T' || t.pais === pais)}
              prevStats={prevStatsByPais[pais]}
            />
            <KpiSections data={therapists} pais={pais} onKpiClick={handleKpiClick} />
            <TableTabs tab={tab} setTab={setTab} />
            {hayFiltrosActivos && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                <button className="btn" onClick={clearAllFilters} style={{ fontSize: 10 }}>
                  ✕ Limpiar filtros
                </button>
              </div>
            )}
            <TableFilters filters={filters} setFilters={setFilters} count={filtered.length} />
            <DashboardTable data={filtered} view={view} onRowClick={setSelectedTherapist} />
          </>
        )}
      </div>
      <TherapistModal therapist={selectedTherapist} userEmail={userEmail} onClose={() => setSelectedTherapist(null)} />
    </>
  );
}
