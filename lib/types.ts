// Tipos del dominio. Coinciden con el schema de Supabase.

import type { SituacionId, AccionId } from './constants-matrix';
import type { AccionPendiente } from './actions';

export type Pais = 'AR' | 'UY';
export type View = 'pred' | 'anal' | 'prog';
export type PaisFilter = 'T' | 'AR' | 'UY';
// MODIFICADO PR2: tabs nuevos. IRR/OC/SEG45 removidos, CRIT/V45/DEST agregados.
export type TabKey = 'T' | 'CRIT' | 'V45' | 'DEST' | 'NUE';

export type Tendencia = 'subiendo' | 'estable' | 'bajando' | 'arrancando' | 'sin actividad';
export type Cuadrante = 'A' | 'B' | 'C' | 'D';

export interface TherapistRow {
  id: string;
  pais: Pais;
  nombre: string;
  email: string | null;
  telefono: string | null;
  corriente: string | null;
  edad: number | null;
  inicio: string | null;
  activo: boolean;
  fecha_baja: string | null;
  motivo_baja: string | null;
  registros_totales_hist: number | null;
  sesiones_totales_hist: number | null;
  pacientes_unicos_hist: number | null;
}

export interface TherapistStateRow {
  therapist_id: string;
  month: string;
  score: number | null;
  zona: 'Verde' | 'Amarillo' | 'Rojo' | null;
  cuadrante: Cuadrante | null;
  tendencia: Tendencia | null;
  // MODIFICADO PR2: removidos accionable, senal, irrecuperable
  // Agregados: situaciones, accion, acciones_pendientes, meses_en_situacion
  situaciones: SituacionId[];
  accion: AccionId;
  acciones_pendientes: AccionPendiente[];
  meses_en_situacion: Record<string, number>;
  ses_paciente_3m: number | null;
  gan_mes: number | null;
  dias_sin_sesion: number | null;
  reg_3m: number | null;
  tasa_cancel: number | null;
  videollamada: boolean;
}

export interface MonthlyMetricsRow {
  therapist_id: string;
  month: string;
  ses_creadas: number | null;
  ses_aprobadas: number | null;
  ses_canceladas: number | null;
  pacientes_unicos: number | null;
  sesiones_totales: number | null;
  registros_mes: number | null;
  hs_disponibles: number | null;
  ultima_sesion: string | null;
}

export interface TherapistView {
  // De therapists
  id: string;
  nombre: string;
  pais: Pais;
  email: string | null;
  telefono: string | null;
  corriente: string | null;
  inicio: string | null;
  dias: number;
  activo: boolean;

  // Acumulados históricos
  regTotalHist: number;
  sesionesHist: number;
  pacientesHist: number;

  // Capa Predicción (sin cambios)
  score: number;
  zona: 'Verde' | 'Amarillo' | 'Rojo';
  cuadrante: Cuadrante;
  tendencia: Tendencia;

  // Capa Matrix (NUEVO PR2)
  situaciones: SituacionId[];
  accion: AccionId;
  accionesPendientes: AccionPendiente[];
  mesesEnSituacion: Record<string, number>;

  // Métricas
  sesPaciente3m: number;
  ganMes: number;
  diasSinSesion: number | null;
  videollamada: boolean;
  tasaCancelMes: number | null;
  reg3m: number | null;

  // De monthly_metrics del mes actual
  sesMes: number | null;
  pacMes: number | null;
  regMes: number | null;
  hs: number;
  ultimaSesion: string | null;

  // Del mes anterior
  pacAnt: number | null;
  sesAnt: number | null;
  regAnt: number | null;
}


// Estado de filtros del UI
// MODIFICADO PR2: 'accionable' renombrado a 'accion', 'senal' removido,
// agregada 'situacion'
export interface FilterState {
  search: string;
  accion: string;
  situacion: string;
  segmento: string;
  tendencia: string;
  cuadrante: string;
}
