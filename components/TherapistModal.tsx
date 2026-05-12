'use client';

import { useEffect, useState } from 'react';
import type { TherapistView } from '@/lib/types';
import {
  colorScore, colorSesPaciente, segmento,
  cuadranteBadge, accionableBadge, usd, ganHist,
} from '@/lib/helpers';
import { PDESC, ADESC } from '@/lib/constants';
import { fetchNotes, addNote, deleteNote, type Note } from '@/lib/notes';

interface Props {
  therapist: TherapistView | null;
  userEmail?: string;
  onClose: () => void;
}

// Limpiar teléfono para WhatsApp: solo números, agregar código país si falta
function waLink(phone: string | null, pais: 'AR' | 'UY'): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/[^0-9]/g, '');
  if (!cleaned) return null;
  // Si ya tiene código de país completo, usarlo
  if (cleaned.startsWith('54') || cleaned.startsWith('598')) {
    return `https://wa.me/${cleaned}`;
  }
  // Si empieza con 0 (formato local AR), quitarlo
  const noLeadingZero = cleaned.replace(/^0+/, '');
  // Agregar código país según país del terapeuta
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
  const aBadge = accionableBadge(r.accionable);
  const whatsapp = waLink(r.telefono, r.pais);

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
            {/* Email + WhatsApp */}
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
          {/* Sección 1: Accionable */}
          <div className="ms">
            <span className={`ac ${aBadge.cls}`}>{aBadge.label}</span>
            <div style={{ background: 'var(--bg3)', borderRadius: 7, padding: '9px 11px', marginTop: 6 }}>
              <p style={{ fontSize: 11, color: 'var(--t2)', lineHeight: 1.55, marginBottom: 6 }}>
                {ADESC[r.accionable] || ''}
              </p>
              <div className="ind">
                {deltaPac != null && (
                  <span className="ic">
                    Δ Pacientes mes
                    {deltaPac > 0 && <span style={{ color: 'var(--v)' }}> ↑+{deltaPac}</span>}
                    {deltaPac < 0 && <span style={{ color: 'var(--r)' }}> ↓{deltaPac}</span>}
                    {deltaPac === 0 && ' ='}
                  </span>
                )}
                {sp > 0 && (
                  <span className="ic">
                    Prom.ses 3m <span style={{ color: colorSesPaciente(sp) }}>{sp.toFixed(1)}</span>
                  </span>
                )}
                {r.reg3m != null && (
                  <span className="ic">
                    Reg. 3m <span style={{ color: 'var(--t)' }}>{r.reg3m}</span>
                  </span>
                )}
                {tc > 0.2 && (
                  <span className="ic">
                    Cancelaciones <span style={{ color: 'var(--r)' }}>{Math.round(tc * 100)}%</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Sección 2: Predicción */}
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

          {/* Sección 3: Métricas */}
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

          {/* Sección 4: Notas */}
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
