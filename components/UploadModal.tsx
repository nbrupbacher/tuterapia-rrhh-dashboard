'use client';

import { useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { parseCsv, parsePrimeraSesionCsv, type CsvRow, type PrimeraSesionRow } from '@/lib/csvParser';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  suggestedMonth: string;
}

// Tipos de carga soportados por el popup. Cada uno usa su propio parser,
// su propio endpoint y no pisa los datos del otro.
type TipoCarga = 'mensual' | 'primera_sesion';

interface Preview {
  rows: CsvRow[] | PrimeraSesionRow[];
  errors: string[];
}

interface MensualStats {
  total_csv: number; nuevos: number; reactivados: number; bajas: number; actualizados: number;
}
interface PrimeraSesionStats {
  total_csv: number; actualizados: number;
  sin_match: number; sin_match_ids: string[];
  desaparecidos: number; desaparecidos_nombres: string[];
}

interface UploadResult {
  ok: boolean;
  tipo?: TipoCarga;
  stats?: MensualStats | PrimeraSesionStats;
  error?: string;
}

const MESES = [
  { v: '01', l: 'Enero' }, { v: '02', l: 'Febrero' }, { v: '03', l: 'Marzo' },
  { v: '04', l: 'Abril' }, { v: '05', l: 'Mayo' }, { v: '06', l: 'Junio' },
  { v: '07', l: 'Julio' }, { v: '08', l: 'Agosto' }, { v: '09', l: 'Septiembre' },
  { v: '10', l: 'Octubre' }, { v: '11', l: 'Noviembre' }, { v: '12', l: 'Diciembre' },
];

export function UploadModal({ open, onClose, onSuccess, suggestedMonth }: Props) {
  const [tipo, setTipo] = useState<TipoCarga>('mensual');
  const [year, setYear] = useState(suggestedMonth.split('-')[0] || '2026');
  const [month, setMonth] = useState(suggestedMonth.split('-')[1] || '05');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [fileKey, setFileKey] = useState(0);

  if (!open) return null;

  const esPrimeraSesion = tipo === 'primera_sesion';

  // Cambiar de tipo invalida el archivo ya elegido: el formato es distinto.
  function handleTipo(t: TipoCarga) {
    if (t === tipo) return;
    setTipo(t);
    setPreview(null);
    setResult(null);
    setFileKey(k => k + 1);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null);
    const r = esPrimeraSesion ? await parsePrimeraSesionCsv(file) : await parseCsv(file);
    setPreview(r);
  }

  async function handleUpload() {
    if (!preview || !preview.rows.length) return;
    setUploading(true);
    setResult(null);
    try {
      const sb = getSupabase();
      const { data: { session } } = await sb.auth.getSession();
      if (!session) {
        setResult({ ok: false, error: 'Sesión expirada, recargá la página' });
        setUploading(false);
        return;
      }
      const endpoint = esPrimeraSesion ? '/api/upload-primera-sesion' : '/api/upload';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month: `${year}-${month}`,
          rows: preview.rows,
          jwt: session.access_token,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setResult({ ok: false, error: data.error || 'Error desconocido' });
      } else {
        setResult({ ok: true, tipo, stats: data.stats });
        // El dashboard lee los datos en el mount inicial, así que recargamos
        // la página completa para que tabla, métricas y Progreso se refresquen.
        setTimeout(() => {
          onSuccess();
          window.location.reload();
        }, 2500);
      }
    } catch (err: any) {
      setResult({ ok: false, error: err.message });
    } finally {
      setUploading(false);
    }
  }

  const tabStyle = (activo: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '7px 10px',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'var(--f)',
    fontSize: 11,
    fontWeight: 600,
    border: `1px solid ${activo ? 'var(--ac)' : 'var(--bd)'}`,
    background: activo ? 'var(--ac)' : 'var(--bg3)',
    color: activo ? '#fff' : 'var(--t2)',
  });

  return (
    <div className="ov open" onClick={onClose}>
      <div className="mo" onClick={e => e.stopPropagation()}>
        <div className="mh">
          <div style={{ flex: 1 }}>
            <div className="mn2">📥 Cargar CSV mensual</div>
            <div className="mm">Subí el CSV exportado de Tu Terapia</div>
          </div>
          <button className="mcl" onClick={onClose}>✕</button>
        </div>
        <div className="mb">
          {/* Tipo de carga */}
          <div className="ms">
            <div className="mst">Tipo de dato</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={tabStyle(!esPrimeraSesion)} onClick={() => handleTipo('mensual')}>
                📊 Datos mensuales
              </button>
              <button style={tabStyle(esPrimeraSesion)} onClick={() => handleTipo('primera_sesion')}>
                🔁 Primera Sesión
              </button>
            </div>
          </div>

          {/* Selector de mes */}
          <div className="ms">
            <div className="mst">
              {esPrimeraSesion ? 'Mes de corte del acumulado' : 'Mes que corresponde el CSV'}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <select value={month} onChange={(e) => setMonth(e.target.value)} style={{ flex: 2 }}>
                {MESES.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
              </select>
              <select value={year} onChange={(e) => setYear(e.target.value)} style={{ flex: 1 }}>
                {['2025', '2026', '2027'].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            {esPrimeraSesion && (
              <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4 }}>
                Este dato es un acumulado histórico: el mes indica hasta cuándo está cortado,
                no un cohorte de ese mes.
              </div>
            )}
          </div>

          {/* File input */}
          <div className="ms">
            <div className="mst">Archivo CSV</div>
            <input
              key={fileKey}
              type="file"
              accept=".csv"
              onChange={handleFile}
              style={{ width: '100%', padding: 8, background: 'var(--bg3)', border: '1px solid var(--bd)', borderRadius: 5, color: 'var(--t)', fontSize: 12 }}
            />
            <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4 }}>
              {esPrimeraSesion
                ? 'Formato esperado: id_terapeuta, terapeuta, pacientes_1ra_sesion, pacientes_sin_2da, pct_caida_1ra_sesion'
                : 'Formato esperado: 19 columnas con Id, País, Nombre Psic, etc.'}
            </div>
          </div>

          {/* Preview de errores */}
          {preview && preview.errors.length > 0 && (
            <div className="ms">
              <div style={{ background: 'rgba(240,82,82,.1)', border: '1px solid rgba(240,82,82,.3)', borderRadius: 6, padding: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--r)', marginBottom: 6 }}>⚠ Errores en el CSV</div>
                {preview.errors.slice(0, 12).map((e, i) => (
                  <div key={i} style={{ fontSize: 11, color: 'var(--r)', marginBottom: 2 }}>• {e}</div>
                ))}
                {preview.errors.length > 12 && (
                  <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4 }}>
                    …y {preview.errors.length - 12} más
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Preview OK */}
          {preview && preview.errors.length === 0 && (
            <div className="ms">
              <div className="mst">Vista previa</div>
              <div style={{ background: 'var(--bg3)', borderRadius: 6, padding: 10, fontSize: 12 }}>
                <div>📋 <strong>{preview.rows.length}</strong> terapeutas detectados en el CSV</div>
                <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 6 }}>
                  Al cargar el dashboard:
                  {esPrimeraSesion ? (
                    <ul style={{ marginLeft: 14, marginTop: 4 }}>
                      <li>Matchea por <strong>id_terapeuta</strong> contra los terapeutas de la Matrix</li>
                      <li>Reemplaza el % de caída vigente con este acumulado</li>
                      <li>Guarda un snapshot con corte <strong>{year}-{month}</strong> para ver la evolución</li>
                      <li>No modifica ningún otro dato de la Matrix</li>
                    </ul>
                  ) : (
                    <ul style={{ marginLeft: 14, marginTop: 4 }}>
                      <li>Crea o actualiza datos en Supabase para <strong>{year}-{month}</strong></li>
                      <li>Detecta nuevos terapeutas y los da de alta</li>
                      <li>Marca como inactivos a los que ya no aparecen</li>
                      <li>Recalcula scoring automáticamente (cuadrantes, irrecuperables, etc.)</li>
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Resultado */}
          {result && (
            <div className="ms">
              {result.ok && result.stats ? (
                <div style={{ background: 'rgba(52,211,153,.1)', border: '1px solid rgba(52,211,153,.3)', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--v)', marginBottom: 6 }}>✓ Carga exitosa</div>
                  {result.tipo === 'primera_sesion' ? (() => {
                    const s = result.stats as PrimeraSesionStats;
                    return (
                      <>
                        <div style={{ fontSize: 11, color: 'var(--t2)' }}>
                          Total procesado: <strong>{s.total_csv}</strong><br/>
                          ✏ Actualizados: <strong>{s.actualizados}</strong> ·
                          ❓ Sin match: <strong>{s.sin_match}</strong>
                        </div>
                        {s.sin_match > 0 && (
                          <div style={{ fontSize: 10, color: 'var(--am)', marginTop: 6 }}>
                            ⚠ {s.sin_match} id_terapeuta del CSV no existen en la Matrix
                            (posibles bajas o IDs que no coinciden):<br/>
                            <span style={{ color: 'var(--t3)' }}>
                              {s.sin_match_ids.join(', ')}{s.sin_match > s.sin_match_ids.length ? '…' : ''}
                            </span>
                          </div>
                        )}
                        {s.desaparecidos > 0 && (
                          <div style={{ fontSize: 10, color: 'var(--r)', marginTop: 6 }}>
                            ⚠ {s.desaparecidos} terapeuta{s.desaparecidos === 1 ? '' : 's'} tenían dato antes
                            y no aparecen en este CSV. Al ser acumulado no deberían desaparecer —
                            revisá si la query salió completa:<br/>
                            <span style={{ color: 'var(--t3)' }}>
                              {s.desaparecidos_nombres.join(', ')}{s.desaparecidos > s.desaparecidos_nombres.length ? '…' : ''}
                            </span>
                          </div>
                        )}
                      </>
                    );
                  })() : (() => {
                    const s = result.stats as MensualStats;
                    return (
                      <div style={{ fontSize: 11, color: 'var(--t2)' }}>
                        Total procesado: <strong>{s.total_csv}</strong><br/>
                        🆕 Nuevos: <strong>{s.nuevos}</strong> ·
                        🔄 Reactivados: <strong>{s.reactivados}</strong> ·
                        ⬇ Bajas: <strong>{s.bajas}</strong> ·
                        ✏ Actualizados: <strong>{s.actualizados}</strong>
                      </div>
                    );
                  })()}
                  <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 6 }}>Actualizando dashboard…</div>
                </div>
              ) : (
                <div style={{ background: 'rgba(240,82,82,.1)', border: '1px solid rgba(240,82,82,.3)', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--r)' }}>✗ Error</div>
                  <div style={{ fontSize: 11, color: 'var(--r)' }}>{result.error}</div>
                </div>
              )}
            </div>
          )}

          {/* Botón submit */}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn" onClick={onClose} style={{ flex: 1 }}>Cancelar</button>
            <button
              onClick={handleUpload}
              disabled={!preview || preview.errors.length > 0 || uploading || (result?.ok === true)}
              style={{
                flex: 2, background: 'var(--ac)', color: '#fff', border: 'none',
                padding: '8px 14px', borderRadius: 6, cursor: 'pointer',
                fontFamily: 'var(--f)', fontSize: 12, fontWeight: 600,
                opacity: (!preview || preview.errors.length > 0 || uploading || result?.ok) ? 0.4 : 1,
              }}
            >
              {uploading ? 'Cargando…' : result?.ok ? '✓ Cargado' : 'Cargar a Supabase'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
