// Tipos del dominio. Coinciden con el schema de Supabase.

export type Pais = 'AR' | 'UY';
export type View = 'pred' | 'anal' | 'prog';
export type PaisFilter = 'T' | 'AR' | 'UY';
export type TabKey = 'T' | 'IRR' | 'OC' | 'NUE' | 'SEG45';

export type Tendencia = 'subiendo' | 'estable' | 'bajando' | 'arrancando' | 'sin actividad';
export type Cuadrante = 'A' | 'B' | 'C' | 'D';

// Fila de la tabla `therapists` en Supabase
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

// Fila de `therapist_state`
export interface TherapistStateRow {
  therapist_id: string;
  month: string;
  score: number | null;
  zona: 'Verde' | 'Amarillo' | 'Rojo' | null;
  cuadrante: Cuadrante | null;
  tendencia: Tendencia | null;
  irrecuperable: boolean;
  senal: string | null;
  accionable: string;
  ses_paciente_3m: number | null;
  gan_mes: number | null;
  dias_sin_sesion: number | null;
  reg_3m: number | null;
  tasa_cancel: number | null;
  videollamada: boolean;
}

// Fila de `monthly_metrics` (registros_mes = del mes, NO acumulado)
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

// Tipo "fusionado" para la UI
export interface TherapistView {
  // De therapists
  id: string;
  nombre: string;
  pais: Pais;
  email: string | null;
  corriente: string | null;
  inicio: string | null;
  dias: number;
  activo: boolean;

  // Acumulados históricos (de therapists)
  regTotalHist: number;
  sesionesHist: number;
  pacientesHist: number;

  // De therapist_state del mes actual
  score: number;
  zona: 'Verde' | 'Amarillo' | 'Rojo';
  cuadrante: Cuadrante;
  tendencia: Tendencia;
  irrecuperable: boolean;
  senal: string | null;
  accionable: string;
  sesPaciente3m: number;
  ganMes: number;
  diasSinSesion: number | null;
  videollamada: boolean;

  // De monthly_metrics del mes actual
  sesMes: number | null;
  pacMes: number | null;
  regMes: number | null;
  hs: number;
  ultimaSesion: string | null;

  // Del mes ANTERIOR (para deltas/conversión en Análisis)
  pacAnt: number | null;
  sesAnt: number | null;
  regAnt: number | null;
}
