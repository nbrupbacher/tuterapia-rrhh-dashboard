'use client';

import { useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { parseCsv, type CsvRow } from '@/lib/csvParser';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  suggestedMonth: string;
}

interface Preview {
  rows: CsvRow[];
  errors: string[];
}

interface UploadResult {
  ok: boolean;
  stats?: { total_csv: number; nuevos: number; reactivados: number; bajas: number; actualizados: number };
  error?: string;
}

const MESES = [
  { v: '01', l: 'Enero' }, { v: '02', l: 'Febrero' }, { v: '03', l: 'Marzo' },
  { v: '04', l: 'Abril' }, { v: '05', l: 'Mayo' }, { v: '06', l: 'Junio' },
  { v: '07', l: 'Julio' }, { v: '08', l: 'Agosto' }, { v: '09', l: 'Septiembre' },
  { v: '10', l: 'Octubre' }, { v: '11', l: 'Noviembre' }, { v: '12', l: 'Diciembre' },
];

export function UploadModal({ open, onClose, onSuccess, suggestedMonth }: Props) {
  const [year, setYear] = useState(suggestedMonth.split('-')[0] || '2026');
  const [month, setMonth] = useState(suggestedMonth.split('-')[1] || '05');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);

  if (!open) return null;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null);
    const r = await parseCsv(file);
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
      const res = await fetch('/api/upload', {
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
        setResult({ ok: true, stats: data.stats });
        // FIX: el dashboard no se actualizaba solo porque el onSuccess del padre
        // no re-consultaba los datos. Recargamos la página completa para garantizar
        // que todo (tabla, métricas y Progreso) lea los datos nuevos de Supabase.
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
          {/* Selector de mes */}
          <div className="ms">
            <div className="mst">Mes que corresponde el CSV</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <select value={month} onChange={(e) => setMonth(e.target.value)} style={{ flex: 2 }}>
                {MESES.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
              </select>
              <select value={year} onChange={(e) => setYear(e.target.value)} style={{ flex: 1 }}>
                {['2025', '2026', '2027'].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>

          {/* File input */}
          <div className="ms">
            <div className="mst">Archivo CSV</div>
            <input
              type="file"
              accept=".csv"
              onChange={handleFile}
              style={{ width: '100%', padding: 8, background: 'var(--bg3)', border: '1px solid var(--bd)', borderRadius: 5, color: 'var(--t)', fontSize: 12 }}
            />
            <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4 }}>
              Formato esperado: 19 columnas con Id, País, Nombre Psic, etc.
            </div>
          </div>

          {/* Preview de errores */}
          {preview && preview.errors.length > 0 && (
            <div className="ms">
              <div style={{ background: 'rgba(240,82,82,.1)', border: '1px solid rgba(240,82,82,.3)', borderRadius: 6, padding: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--r)', marginBottom: 6 }}>⚠ Errores en el CSV</div>
                {preview.errors.map((e, i) => (
                  <div key={i} style={{ fontSize: 11, color: 'var(--r)', marginBottom: 2 }}>• {e}</div>
                ))}
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
                  <ul style={{ marginLeft: 14, marginTop: 4 }}>
                    <li>Crea o actualiza datos en Supabase para <strong>{year}-{month}</strong></li>
                    <li>Detecta nuevos terapeutas y los da de alta</li>
                    <li>Marca como inactivos a los que ya no aparecen</li>
                    <li>Recalcula scoring automáticamente (cuadrantes, irrecuperables, etc.)</li>
                  </ul>
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
                  <div style={{ fontSize: 11, color: 'var(--t2)' }}>
                    Total procesado: <strong>{result.stats.total_csv}</strong><br/>
                    🆕 Nuevos: <strong>{result.stats.nuevos}</strong> ·
                    🔄 Reactivados: <strong>{result.stats.reactivados}</strong> ·
                    ⬇ Bajas: <strong>{result.stats.bajas}</strong> ·
                    ✏ Actualizados: <strong>{result.stats.actualizados}</strong>
                  </div>
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
