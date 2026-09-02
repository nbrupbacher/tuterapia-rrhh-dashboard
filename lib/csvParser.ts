import Papa from 'papaparse';

export interface CsvRow {
  id: string;
  pais: 'AR' | 'UY';
  nombre: string;
  email: string | null;
  telefono: string | null;
  corriente: string | null;
  edad: number | null;
  inicio: string | null;            // YYYY-MM-DD
  hs_disponibles: number;
  ses_creadas: number;
  ses_aprobadas: number;
  ses_confirmadas: number;
  ses_canceladas: number;
  aprob_pendientes: number;
  pacientes_unicos: number;
  sesiones_totales: number;
  registros_mes: number;            // "Registros Totales" del CSV (mal nombrado)
  ultimo_registro: string | null;
  ultima_sesion: string | null;
}

const EXPECTED_HEADERS = [
  'Id', 'País', 'Nombre Psic', 'Email', 'Teléfono', 'Corriente', 'Edad', 'Inicio',
  'Hs Disponibles', 'S. Creadas', 'S. Aprobadas', 'S. Confirmadas', 'S. Canceladas',
  'Aprobaciones Pendientes', 'Pacientes Únicos', 'Sesiones Totales', 'Registros Totales',
  'Último Registro', 'Última Sesión'
];

function parseDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const parts = s.trim().split('/');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(p => parseInt(p, 10));
  if (isNaN(d) || isNaN(m) || isNaN(y)) return null;
  return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
}

const NAMED_ENTITIES: Record<string, string> = {
  iacute: 'í', aacute: 'á', eacute: 'é', oacute: 'ó', uacute: 'ú',
  ntilde: 'ñ', uuml: 'ü', iuml: 'ï', ccedil: 'ç',
  Iacute: 'Í', Aacute: 'Á', Eacute: 'É', Oacute: 'Ó', Uacute: 'Ú',
  Ntilde: 'Ñ', Uuml: 'Ü', Iuml: 'Ï', Ccedil: 'Ç',
  amp: '&', quot: '"', apos: "'", nbsp: ' ', lt: '<', gt: '>',
};

// El origen exporta nombres con entidades HTML sin decodificar
// (ej. "Ara&uacute;jo", "D&#39;angelo"). Soporta named y numéricas.
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m);
}

function toInt(v: any): number {
  if (v == null || v === '') return 0;
  const n = parseInt(String(v), 10);
  return isNaN(n) ? 0 : n;
}

export interface ParseResult {
  ok: boolean;
  rows: CsvRow[];
  errors: string[];
}

// ============================================================
// CSV "% de caída en 1ra sesión" (acumulado histórico)
// ============================================================

export interface PrimeraSesionRow {
  id: string;                    // id_terapeuta — única clave de matching
  nombre: string;                // solo verificación visual, no se usa para matchear
  pacientes_1ra_sesion: number;
  pacientes_sin_2da: number;
  pct_caida_1ra_sesion: number;
}

const PRIMERA_SESION_HEADERS = [
  'id_terapeuta', 'terapeuta', 'pacientes_1ra_sesion',
  'pacientes_sin_2da', 'pct_caida_1ra_sesion',
];

// Mínimo de pacientes con 1ra sesión para que el % sea representativo.
// Por debajo de esto la Matrix muestra "—" en vez de un porcentaje.
export const MIN_PACIENTES_1RA_SESION = 3;

function toFloat(v: any): number | null {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}

export interface PrimeraSesionParseResult {
  ok: boolean;
  rows: PrimeraSesionRow[];
  errors: string[];
}

export function parsePrimeraSesionCsv(file: File): Promise<PrimeraSesionParseResult> {
  return new Promise((resolve) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const errors: string[] = [];
        if (!results.meta.fields) {
          errors.push('No se pudo leer los headers del CSV');
          resolve({ ok: false, rows: [], errors });
          return;
        }
        const missing = PRIMERA_SESION_HEADERS.filter(h => !results.meta.fields!.includes(h));
        if (missing.length) {
          errors.push(`Faltan columnas: ${missing.join(', ')}`);
          resolve({ ok: false, rows: [], errors });
          return;
        }

        const rows: PrimeraSesionRow[] = [];
        const vistos = new Set<string>();

        results.data.forEach((row, idx) => {
          const id = (row['id_terapeuta'] || '').trim();
          if (!id) return;
          if (vistos.has(id)) {
            errors.push(`Fila ${idx + 2}: id_terapeuta duplicado "${id}"`);
            return;
          }

          const n = toFloat(row['pacientes_1ra_sesion']);
          const sin2da = toFloat(row['pacientes_sin_2da']);
          const pct = toFloat(row['pct_caida_1ra_sesion']);

          if (n == null || sin2da == null || pct == null) {
            errors.push(`Fila ${idx + 2} (${id}): valores numéricos inválidos o vacíos`);
            return;
          }
          if (pct < 0 || pct > 100) {
            errors.push(`Fila ${idx + 2} (${id}): pct_caida_1ra_sesion fuera de rango (${pct})`);
            return;
          }
          if (sin2da > n) {
            errors.push(`Fila ${idx + 2} (${id}): pacientes_sin_2da (${sin2da}) > pacientes_1ra_sesion (${n})`);
            return;
          }

          vistos.add(id);
          rows.push({
            id,
            nombre: decodeHtmlEntities((row['terapeuta'] || '').trim()),
            pacientes_1ra_sesion: Math.round(n),
            pacientes_sin_2da: Math.round(sin2da),
            pct_caida_1ra_sesion: pct,
          });
        });

        resolve({ ok: errors.length === 0, rows, errors });
      },
      error: (err) => {
        resolve({ ok: false, rows: [], errors: [err.message] });
      }
    });
  });
}

export function parseCsv(file: File): Promise<ParseResult> {
  return new Promise((resolve) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const errors: string[] = [];
        if (!results.meta.fields) {
          errors.push('No se pudo leer los headers del CSV');
          resolve({ ok: false, rows: [], errors });
          return;
        }
        const missing = EXPECTED_HEADERS.filter(h => !results.meta.fields!.includes(h));
        if (missing.length) {
          errors.push(`Faltan columnas: ${missing.join(', ')}`);
          resolve({ ok: false, rows: [], errors });
          return;
        }
        const rows: CsvRow[] = [];
        results.data.forEach((row, idx) => {
          const id = (row['Id'] || '').trim();
          if (!id) return;
          const paisRaw = (row['País'] || '').trim();
          if (paisRaw !== 'AR' && paisRaw !== 'UY') {
            errors.push(`Fila ${idx + 2}: país inválido "${paisRaw}"`);
            return;
          }
          rows.push({
            id,
            pais: paisRaw as 'AR' | 'UY',
            nombre: decodeHtmlEntities((row['Nombre Psic'] || '').trim()),
            email: (row['Email'] || '').trim() || null,
            telefono: (row['Teléfono'] || '').trim() || null,
            corriente: (row['Corriente'] || '').trim() || null,
            edad: toInt(row['Edad']) || null,
            inicio: parseDate(row['Inicio']),
            hs_disponibles: toInt(row['Hs Disponibles']),
            ses_creadas: toInt(row['S. Creadas']),
            ses_aprobadas: toInt(row['S. Aprobadas']),
            ses_confirmadas: toInt(row['S. Confirmadas']),
            ses_canceladas: toInt(row['S. Canceladas']),
            aprob_pendientes: toInt(row['Aprobaciones Pendientes']),
            pacientes_unicos: toInt(row['Pacientes Únicos']),
            sesiones_totales: toInt(row['Sesiones Totales']),
            registros_mes: toInt(row['Registros Totales']),
            ultimo_registro: parseDate(row['Último Registro']),
            ultima_sesion: parseDate(row['Última Sesión']),
          });
        });
        resolve({ ok: errors.length === 0, rows, errors });
      },
      error: (err) => {
        resolve({ ok: false, rows: [], errors: [err.message] });
      }
    });
  });
}
