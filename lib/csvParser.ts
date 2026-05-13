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

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&iacute;/g, 'í')
    .replace(/&aacute;/g, 'á')
    .replace(/&eacute;/g, 'é')
    .replace(/&oacute;/g, 'ó')
    .replace(/&uacute;/g, 'ú')
    .replace(/&ntilde;/g, 'ñ')
    .replace(/&Aacute;/g, 'Á')
    .replace(/&Eacute;/g, 'É')
    .replace(/&Iacute;/g, 'Í')
    .replace(/&Oacute;/g, 'Ó')
    .replace(/&Uacute;/g, 'Ú')
    .replace(/&Ntilde;/g, 'Ñ');
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
