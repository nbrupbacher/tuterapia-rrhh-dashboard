'use client';

import { useEffect, useState } from 'react';
import type { TherapistView } from '@/lib/types';
import {
  colorScore, colorSesPaciente, segmento,
  cuadranteBadge, situacionBadge, accionBadge,
  usd, ganHist,
} from '@/lib/helpers';
import { ACCION_INMEDIATA, ACCION_TEMPORAL, ordenarSituacionesPorGravedad } from '@/lib/constants-matrix';
import { PDESC } from '@/lib/constants';
import { fetchNotes, addNote, deleteNote, type Note } from '@/lib/notes';

interface Props {
  therapist: TherapistView | null;
  userEmail?: string;
  onClose: () => void;
}

// Descripciones de cada situación (para mostrar contexto en el modal)
const SDESC: Record<string, (t: TherapistView) => string> = {
  top_performer: () => 'Cuadrante A con tendencia positiva o estable. Máximo perfil actual. Priorizar en visibilidad y matching.',
  arrancando_bien: (t) => `Terapeuta con menos de 6 meses que viene fuerte (${t.sesMes ?? 0} sesiones este mes con tendencia subiendo).`,
  recien_ingresado: () => 'Menos de 30 días en la plataforma. Sin alertas activas, sigue en período de onboarding.',
  estable: () => 'Sin alertas activas. Performance constante. Seguimiento regular en el próximo ciclo.',
  ventana_45_55_viene_bien: () => 'En ventana de evaluación temprana (45-55 días) con performance buena. Momento ideal para reconocimiento.',
  ventana_45_55_poca_actividad: (t) => `En ventana 45-55 días con poca actividad (${t.sesMes ?? 0} sesiones este mes). Conviene Meet para entender qué está pasando.`,
  ventana_45_55_sin_actividad: () => 'En ventana 45-55 días sin sesiones. Conversación urgente para evaluar continuidad temprana.',
  baja_retencion: (t) => `Promedio de sesiones por paciente últimos 3m: ${(t.sesPaciente3m ?? 0).toFixed(2)} (umbral: 2.0). Los pacientes no vuelven con regularidad.`,
  sin_horarios_cargados: () => 'Sin horas disponibles cargadas. Los pacientes no pueden agendarse. Solicitar actualización del perfil.',
  cancelaciones: (t) => `Tasa de cancelación: ${Math.round((t.tasaCancelMes ?? 0) * 100)}% (umbral: 20%). Afecta experiencia del paciente y score.`,
  alerta_arranque: () => 'Menos de 6 meses con muy pocas sesiones y tendencia floja. Conviene contacto temprano para identificar bloqueos.',
  recibe_no_convierte: () => 'Recibe registros pero la conversión está por debajo del 50% del benchmark del país. Tiene demanda pero no la aprovecha.',
  pierde_pacientes_netos: (t) => `Recibió ${t.regMes ?? 0} registros este mes pero tiene menos pacientes que el mes anterior. Si persiste, se activa Fantasmear automáticamente.`,
  en_abandono: () => 'Menos de 6 meses sin sesiones este mes y tendencia sin actividad o bajando. Si persiste 3 meses, se evalúa continuidad.',
  sin_actividad_sostenida: () => 'Más de 30 días sin sesión. Sin actividad consolidada. Si persiste 3 meses, se evalúa continuidad.',
};

// Limpiar teléfono para WhatsApp
function waLink(phone: string | null, pais: 'AR' | 'UY'): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/[^0-9]/g, '');
  if (!cleaned) return null;
  if (cleaned.startsWith('54') || cleaned.startsWith('598')) {
    return `https://wa.me/${cleaned}`;
  }
  const noLeadingZero = cleaned.replace(/^0+/, '');
  const prefix = pais === 'AR' ? '54' : '598';
  return `https://wa.me/${prefix}${noLeadingZero}`;
}

function formatPhone(phone: string | null): string {
  if (!phone) return '—';
  return phone;
}

export function TherapistModal({ therapist, userEmail, onClose }: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!therapist) return;
    fetchNotes(therapist.id).then(setNotes);
  }, [therapist]);

  if (!therapist) return null;
  const r = therapist;

  const sp = r.sesPaciente3m || 0;
  const tc = r.tasaCancelMes ?? 0;
  const deltaPac = r.pacMes != null && r.pacAnt != null ? r.pacMes - r.pacAnt : null;
  const gh = ganHist(r);
  const cBadge = cuadranteBadge(r.cuadrante);
  const whatsapp = waLink(r.telefono, r.pais);

  // Situaciones ordenadas por gravedad
  const sitsOrdenadas = ordenarSituacionesPorGravedad(r.situaciones || []);
  const mesesEnSit = r.mesesEnSituacion || {};

  const itag = (v: number | null | undefined, suf = '') => {
    if (v == null) return null;
    if (v > 0) return <span style={{ fontSize: 11, color: 'var(--v)' }}> ↑+{v}{suf}</span>;
    if (v < 0) return <span style={{ fontSize: 11, color: 'var(--r)' }}> ↓{v}{suf}</span>;
    return null;
  };

  const handleCopy = () => {
    if (!r.email) return;
    navigator.clipboard.writeText(r.email).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleAdd = async () => {
    if (!newNote.trim()) return;
    setSaving(true);
    const note = await addNote(r.id, newNote.trim(), userEmail);
    if (note) {
      setNotes([note, ...notes]);
      setNewNote('');
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Borrar esta nota?')) return;
    const ok = await deleteNote(id);
    if (ok) setNotes(notes.filter(n => n.id !== id));
  };

  return (
    <div className="ov open" onClick={onClose}>
      <div className="mo" onClick={e => e.stopPropagation()}>
        <div className="mh">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="mn2">{r.nombre}</div>
            <div className="mm">
              {r.pais} · {segmento(r.dias)} · Alta: {r.inicio || '—'}
              {r.corriente && ` · ${r.corriente}`}
            </div>
            <div style={{ marginTop: 5, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {r.email && (
                <div style={{ display: 'flex', alignItems: 'center', minHeight: 18 }}>
                  <span style={{ fontFamily: 'var(--m)', fontSize: 11, color: 'var(--t2)' }}>{r.email}</span>
                  <button
                    onClick={handleCopy}
                    style={{ marginLeft: 8, fontSize: 10, padding: '2px 8px', borderRadius: 4, border: '1px solid var(--bd2)', background: 'var(--bg3)', color: 'var(--t2)', cursor: 'pointer', fontFamily: 'var(--f)' }}
                  >
                    {copied ? '✓ copiado' : 'Copiar'}
                  </button>
                </div>
              )}
              {r.telefono && (
                <div style={{ display: 'flex', alignItems: 'center', minHeight: 18 }}>
                  <span style={{ fontFamily: 'var(--m)', fontSize: 11, color: 'var(--t2)' }}>📱 {formatPhone(r.telefono)}</span>
                  {whatsapp && (
                    <a
                      href={whatsapp}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ marginLeft: 8, fontSize: 10, padding: '2px 8px', borderRadius: 4, border: '1px solid #25d36644', background: '#25d36622', color: '#25d366', textDecoration: 'none', fontFamily: 'var(--f)', fontWeight: 600 }}
                    >
                      💬 WhatsApp
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
          <button className="mcl" onClick={onClose}>✕</button>
        </div>

        <div className="mb">

          {/* ============ Situaciones detectadas ============ */}
          <div className="ms">
            <div className="mst">
              Situaciones detectadas ({sitsOrdenadas.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sitsOrdenadas.length === 0 ? (
                <div style={{ background: 'var(--bg3)', borderRadius: 7, padding: '9px 11px', fontSize: 11, color: 'var(--t2)' }}>
                  Sin situaciones detectadas este mes.
                </div>
              ) : (
                sitsOrdenadas.map((sid) => {
                  const sb = situacionBadge(sid);
                  const meses = mesesEnSit[sid] ?? 1;
                  const accInm = ACCION_INMEDIATA[sid];
                  const escalada = ACCION_TEMPORAL[sid];
                  const desc = SDESC[sid] ? SDESC[sid](r) : '';
                  // ¿La escalada ya se activó?
                  const escaladaCumplida = escalada ? meses >= escalada.mesesParaActivar : false;
                  return (
                    <div key={sid} style={{ background: 'var(--bg3)', borderRadius: 7, padding: '9px 11px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span className="sit-dot" style={{ background: sb.dot, width: 7, height: 7, borderRadius: '50%' }} />
                        <span style={{ fontSize: 12, fontWeight: 500 }}>{sb.label}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 10, fontFamily: 'var(--m)', color: 'var(--t3)', background: 'var(--bg2)', padding: '1px 6px', borderRadius: 4 }}>
                          {meses}° mes
                        </span>
                      </div>
                      {desc && (
                        <p style={{ fontSize: 11, color: 'var(--t2)', lineHeight: 1.55, margin: '6px 0' }}>
                          {desc}
                        </p>
                      )}
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                        <span className={`acc ${accionBadge(accInm).cls}`}>
                          {accionBadge(accInm).icon} {accionBadge(accInm).label}
                        </span>
                        {escalada && (
                          <span className={`acc ${accionBadge(escalada.accion).cls} ${escaladaCumplida ? '' : 'acc-pending'}`}>
                            {accionBadge(escalada.accion).icon} {accionBadge(escalada.accion).label}
                            {!escaladaCumplida && ` · tras ${escalada.mesesParaActivar - meses}m`}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ============ Predicción ============ */}
          <div className="ms">
            <div className="mst">Predicción</div>
            <div style={{ background: 'var(--bg3)', borderRadius: 7, padding: '9px 11px' }}>
              <div style={{ marginBottom: 4 }}>
                <span className={`pr ${cBadge.cls}`}>{cBadge.label}</span>
              </div>
              {r.cuadrante && PDESC[r.cuadrante] && (
                <p style={{ fontSize: 11, color: 'var(--t2)', lineHeight: 1.55 }}>
                  {PDESC[r.cuadrante]}
                </p>
              )}
            </div>
          </div>

          {/* ============ Métricas ============ */}
          <div className="ms">
            <div className="mst">Métricas</div>
            <div className="mg">
              <div className="mst2">
                <div className="mv" style={{ color: colorScore(r.score) }}>{r.score}</div>
                <div className="ml">Score</div>
              </div>
              <div className="mst2">
                <div className="mv">{r.sesMes != null ? r.sesMes : '—'}</div>
                <div className="ml">Ses. mes</div>
              </div>
              <div className="mst2">
                <div className="mv" style={{ color: colorSesPaciente(sp) }}>{sp ? sp.toFixed(2) : '—'}</div>
                <div className="ml">Prom.ses 3m</div>
                <div className="msb2">umbral ≥2.0</div>
              </div>
              <div className="mst2">
                <div className="mv" style={{ color: deltaPac != null && deltaPac < 0 ? 'var(--r)' : (r.pacMes || 0) >= 3 ? 'var(--v)' : 'var(--am)' }}>
                  {r.pacMes != null ? r.pacMes : '—'}
                </div>
                <div className="ml">Pac. mes{itag(deltaPac)}</div>
                <div className="msb2">{r.pacAnt != null ? `mes ant: ${r.pacAnt}` : ''}</div>
              </div>
              <div className="mst2">
                <div className="mv" style={{ color: tc > 0.3 ? 'var(--r)' : tc > 0.2 ? 'var(--am)' : 'inherit' }}>
                  {tc ? `${Math.round(tc * 100)}%` : '—'}
                </div>
                <div className="ml">Cancelaciones</div>
              </div>
              <div className="mst2">
                <div className="mv" style={{ color: r.hs === 0 ? 'var(--r)' : r.hs < 5 ? 'var(--am)' : 'inherit' }}>
                  {r.hs || 0}h
                </div>
                <div className="ml">Hs. disp.</div>
              </div>
              <div className="mst2">
                <div className={`mv ${gh >= 0 ? 'gp' : 'gn'}`}>{usd(gh)}</div>
                <div className="ml">Gan. hist.</div>
              </div>
              <div className="mst2">
                <div className={`mv ${r.ganMes == null ? 'g0' : r.ganMes >= 0 ? 'gp' : 'gn'}`}>{usd(r.ganMes)}</div>
                <div className="ml">Gan. mes</div>
              </div>
              <div className="mst2">
                <div className="mv">{r.regTotalHist || '—'}</div>
                <div className="ml">Reg. total</div>
              </div>
            </div>
          </div>

          {/* ============ Notas ============ */}
          <div className="ms">
            <div className="mst">📝 Notas del equipo</div>
            <div style={{ background: 'var(--bg3)', borderRadius: 7, padding: '9px 11px' }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Agregar una nota..."
                  rows={2}
                  style={{ flex: 1, background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 5, padding: 6, color: 'var(--t)', fontFamily: 'var(--f)', fontSize: 12, resize: 'vertical' }}
                />
                <button
                  onClick={handleAdd}
                  disabled={!newNote.trim() || saving}
                  style={{ alignSelf: 'flex-end', padding: '6px 12px', background: 'var(--ac)', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 11, fontFamily: 'var(--f)', fontWeight: 600 }}
                >
                  {saving ? '...' : 'Agregar'}
                </button>
              </div>
              {notes.length === 0 ? (
                <p style={{ fontSize: 11, color: 'var(--t3)', fontStyle: 'italic' }}>Sin notas todavía</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {notes.map(n => (
                    <div key={n.id} style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 5, padding: 8 }}>
                      <p style={{ fontSize: 12, color: 'var(--t)', lineHeight: 1.4, marginBottom: 5, whiteSpace: 'pre-wrap' }}>
                        {n.contenido?.text || ''}
                      </p>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: 'var(--t3)' }}>
                        <span>
                          {n.autor || 'anónimo'} · {new Date(n.created_at).toLocaleDateString('es-AR')}
                        </span>
                        <button
                          onClick={() => handleDelete(n.id)}
                          style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', fontSize: 10, padding: '2px 4px' }}
                          title="Borrar"
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
