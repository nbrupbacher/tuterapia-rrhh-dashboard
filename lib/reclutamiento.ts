/**
 * Cruce de postulaciones (form "Requisitos Psicos Tu Terapia") contra quienes
 * ya estuvieron en la plataforma. Funciones puras: las usa la solapa
 * Reclutamiento (components/ReclutamientoView.tsx).
 *
 * El problema que resuelve: alguien que estuvo (y se fue, o lo desvinculamos)
 * se vuelve a postular, a veces con otro mail. Orden del cruce, del más seguro
 * al menos:
 *   1. Mail igual al de la cuenta en la plataforma (el de este form o el de
 *      cualquier postulación anterior de la misma persona).
 *   2. Nombre normalizado. Solo "Posible": hay homónimos, y hay que mirarlo.
 * El CUIT/RUT del form todavía no se puede cruzar con `therapists` (no lo
 * tiene); sí sirve para reconocer a quien se postuló antes con otro mail.
 * Etapa 2: traer el documento de la plataforma y cruzar también por ahí.
 *
 * `therapists` arranca en abril 2026 (CSV mensuales): quien se fue antes no
 * está. Para eso está `bajas_historicas` (form de desvinculación desde 2024 y
 * planilla 2022-2023). Se cruza por mail o CUIT/RUT (seguro) o por nombre en
 * el mismo país (posible), y solo cuenta una baja anterior a la postulación:
 * una baja posterior es la misma persona que entró y se fue, no una que vuelve.
 */

export type PaisPost = 'AR' | 'UY' | 'otro';
export type Decision = 'avanza' | 'no_avanza' | 'en_espera';
export type MotivoBaja = 'por_el_psicologo' | 'nuestra' | 'a_definir';

export type Postulacion = {
  id: string;
  postulado_at: string;
  pais: PaisPost;
  pais_texto: string | null;
  nombre: string;
  email: string;
  cuit: string | null;
  titulo: string | null;
  proceso_personal: string | null;
  experiencia_clinica: string | null;
  supervision: string | null;
  diez_horas: string | null;
  estado_planilla: string | null;
};

export type DecisionRow = {
  id: string;
  postulacion_id: string;
  decision: Decision;
  motivo: string;
  decidido_por: string;
  created_at: string;
};

export type Ter = {
  id: string;
  nombre: string;
  pais: string;
  email: string | null;
  activo: boolean;
  inicio: string | null;
  fecha_baja: string | null;
  motivo_baja: string | null;
};

export type DesvRow = {
  therapist_id: string;
  motivo: MotivoBaja;
  desvinculado_at: string | null;
  cancelada_at: string | null;
  nota: string | null;
  created_at: string;
};

export type MultaRow = { therapist_id: string; saldo: number | null; moneda: string | null; anulada_el: string | null; pago_confirmado_el: string | null };
export type FantasmeoRow = { therapist_id: string; desde: string; hasta: string | null; motivo: string };

export type BajaHist = {
  id: string;
  fuente: 'form' | 'planilla_previa';
  pais: 'AR' | 'UY' | 'CL' | null;
  nombre: string;
  email: string | null;
  cuit: string | null;
  fecha: string | null; // 'YYYY-MM-DD'
  anio: number | null;
  quien: 'nuestra' | 'propia' | 'ambos' | null;
  motivo: string | null;
};

/**
 * Historial, de lo más delicado a lo menos:
 * - baja_nuestra: lo desvinculamos nosotros. No avanza sin revisar por qué.
 * - activo: ya está atendiendo (¿segunda cuenta? ¿cambió de mail?).
 * - baja_propia / baja: se fue (por su cuenta, o sin motivo cargado).
 * - posible: coincide solo el nombre. Hay que mirarlo.
 * - nuevo: no hay rastro en la plataforma.
 */
export type Historial = 'baja_nuestra' | 'activo' | 'baja_propia' | 'baja' | 'posible' | 'nuevo';

export type Cruce = {
  historial: Historial;
  coincide: 'mail' | 'nombre' | null;
  ter: Ter | null;
  // Si hay más de uno con el mismo nombre, para mostrar que hay que elegir.
  otrosPorNombre: Ter[];
  motivoBaja: MotivoBaja | null;
  notaBaja: string | null;
  multaPendiente: { saldo: number; moneda: string } | null;
  fantasmeos: number;
  // Baja anterior a esta postulación en el historial (form de desvinculación
  // o planilla previa), con cómo coincidió.
  bajaHist: BajaHist | null;
  bajaHistPor: 'mail' | 'cuit' | 'nombre' | null;
  // Postulaciones anteriores de la misma persona (mismo mail o mismo CUIT).
  previas: Postulacion[];
  // Última decisión vigente de alguna previa, para ver "ya dijimos que no".
  decisionPrevia: DecisionRow | null;
  decision: DecisionRow | null;
  cumpleMinimos: boolean;
  minimosQueFaltan: string[];
};

export function normalizar(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Nombres compuestos muy comunes: con "María" + apellido sobran homónimos, así
// que con estos se usan las tres primeras palabras (pasó en la planilla: "María
// …" daba falsos positivos).
const PRIMEROS_COMUNES = new Set(['maria', 'ana', 'juan', 'jose', 'luz', 'mar']);

/** Claves de nombre: primera + última palabra, y primeras dos (o tres). */
export function clavesNombre(nombre: string | null | undefined): string[] {
  const p = normalizar(nombre).split(' ').filter((w) => w.length > 1);
  if (p.length < 2) return [];
  const claves = new Set<string>();
  claves.add(`${p[0]} ${p[p.length - 1]}`);
  if (PRIMEROS_COMUNES.has(p[0])) {
    // "Maria Perez" solo: alcanza con primera + última; no agregar otra clave
    // más débil.
    if (p.length >= 3) claves.add(p.slice(0, 3).join(' '));
  } else {
    claves.add(p.slice(0, 2).join(' '));
  }
  return Array.from(claves);
}

const esSi = (v: string | null | undefined) => normalizar(v).startsWith('s');
const esNo = (v: string | null | undefined) => normalizar(v).startsWith('no');

/**
 * Mínimos excluyentes del form. Los cuatro primeros tienen que ser "Sí". El de
 * las 10 horas se agregó después: si está vacío (respuestas viejas) no frena;
 * si dice que no, sí.
 */
export function minimos(p: Postulacion): string[] {
  const faltan: string[] = [];
  if (!esSi(p.titulo)) faltan.push('Título');
  if (!esSi(p.proceso_personal)) faltan.push('Proceso personal');
  if (!esSi(p.experiencia_clinica)) faltan.push('Experiencia clínica');
  if (!esSi(p.supervision)) faltan.push('Supervisión');
  if (esNo(p.diez_horas)) faltan.push('10 horas');
  return faltan;
}

export function cruzar(
  posts: Postulacion[],
  decisiones: DecisionRow[],
  ters: Ter[],
  desvs: DesvRow[],
  multas: MultaRow[],
  fantasmeos: FantasmeoRow[],
  bajasHist: BajaHist[] = [],
): Map<string, Cruce> {
  const bajaPorMail = new Map<string, BajaHist[]>();
  const bajaPorCuit = new Map<string, BajaHist[]>();
  const bajaPorNombre = new Map<string, BajaHist[]>();
  const sumar = (m: Map<string, BajaHist[]>, k: string, b: BajaHist) => {
    const l = m.get(k) ?? [];
    if (!l.includes(b)) l.push(b);
    m.set(k, l);
  };
  for (const b of bajasHist) {
    if (b.email) sumar(bajaPorMail, b.email.toLowerCase(), b);
    if (b.cuit) sumar(bajaPorCuit, b.cuit, b);
    for (const k of clavesNombre(b.nombre)) sumar(bajaPorNombre, k, b);
  }

  const terPorMail = new Map<string, Ter>();
  const terPorNombre = new Map<string, Ter[]>();
  for (const t of ters) {
    const m = String(t.email ?? '').trim().toLowerCase();
    if (m) terPorMail.set(m, t);
    for (const k of clavesNombre(t.nombre)) {
      const l = terPorNombre.get(k) ?? [];
      if (!l.includes(t)) l.push(t);
      terPorNombre.set(k, l);
    }
  }

  // Última salida no cancelada de cada uno: es la que dice por qué se fue.
  const desvPorTer = new Map<string, DesvRow>();
  for (const d of desvs) {
    if (d.cancelada_at) continue;
    const prev = desvPorTer.get(d.therapist_id);
    if (!prev || d.created_at > prev.created_at) desvPorTer.set(d.therapist_id, d);
  }
  const multaPorTer = new Map<string, { saldo: number; moneda: string }>();
  for (const m of multas) {
    if (m.anulada_el || m.pago_confirmado_el || !(Number(m.saldo) > 0)) continue;
    const prev = multaPorTer.get(m.therapist_id);
    multaPorTer.set(m.therapist_id, { saldo: (prev?.saldo ?? 0) + Number(m.saldo), moneda: m.moneda ?? '' });
  }
  const fantPorTer = new Map<string, number>();
  for (const f of fantasmeos) fantPorTer.set(f.therapist_id, (fantPorTer.get(f.therapist_id) ?? 0) + 1);

  // Decisión vigente = la última cargada.
  const decPorPost = new Map<string, DecisionRow>();
  for (const d of decisiones) {
    const prev = decPorPost.get(d.postulacion_id);
    if (!prev || d.created_at > prev.created_at) decPorPost.set(d.postulacion_id, d);
  }

  // Misma persona = mismo mail o mismo CUIT, aunque sea en cadena (mail A con
  // CUIT X, después mail B con CUIT X). Union-find simple.
  const padre = new Map<string, string>();
  const raiz = (x: string): string => {
    let r = x;
    while (padre.get(r) !== r) r = padre.get(r)!;
    padre.set(x, r);
    return r;
  };
  const unir = (a: string, b: string) => padre.set(raiz(a), raiz(b));
  const porMail = new Map<string, string>();
  const porCuit = new Map<string, string>();
  for (const p of posts) {
    padre.set(p.id, p.id);
    const m = p.email.toLowerCase();
    if (porMail.has(m)) unir(p.id, porMail.get(m)!);
    else porMail.set(m, p.id);
    if (p.cuit) {
      if (porCuit.has(p.cuit)) unir(p.id, porCuit.get(p.cuit)!);
      else porCuit.set(p.cuit, p.id);
    }
  }
  const grupos = new Map<string, Postulacion[]>();
  for (const p of posts) {
    const r = raiz(p.id);
    const g = grupos.get(r) ?? [];
    g.push(p);
    grupos.set(r, g);
  }

  const out = new Map<string, Cruce>();
  for (const p of posts) {
    const grupo = grupos.get(raiz(p.id)) ?? [p];
    const previas = grupo
      .filter((q) => q.postulado_at < p.postulado_at)
      .sort((a, b) => (a.postulado_at < b.postulado_at ? 1 : -1));
    let decisionPrevia: DecisionRow | null = null;
    for (const q of previas) {
      const d = decPorPost.get(q.id);
      if (d) {
        decisionPrevia = d;
        break;
      }
    }

    // Mail de este form o de cualquier postulación de la misma persona: si se
    // postuló una vez con el mail de la cuenta y ahora con otro, igual se ve.
    let ter: Ter | null = null;
    let coincide: Cruce['coincide'] = null;
    for (const q of [p, ...grupo]) {
      const t = terPorMail.get(q.email.toLowerCase());
      if (t) {
        ter = t;
        coincide = 'mail';
        break;
      }
    }
    let otrosPorNombre: Ter[] = [];
    if (!ter) {
      const cand = new Set<Ter>();
      for (const k of clavesNombre(p.nombre)) for (const t of terPorNombre.get(k) ?? []) cand.add(t);
      const lista = Array.from(cand);
      // Primero los dados de baja: son los que más importa no dejar pasar.
      lista.sort((a, b) => Number(a.activo) - Number(b.activo));
      if (lista.length) {
        ter = lista[0];
        coincide = 'nombre';
        otrosPorNombre = lista.slice(1);
      }
    }

    const desv = ter ? desvPorTer.get(ter.id) ?? null : null;
    let historial: Historial = 'nuevo';
    if (ter && coincide === 'nombre') historial = 'posible';
    else if (ter && ter.activo && !desv?.desvinculado_at) historial = 'activo';
    else if (ter && desv?.motivo === 'nuestra') historial = 'baja_nuestra';
    else if (ter && desv?.motivo === 'por_el_psicologo') historial = 'baja_propia';
    else if (ter) historial = ter.activo ? 'activo' : 'baja';

    // Historial de bajas. Solo las anteriores a esta postulación (la de la
    // planilla previa no tiene día: vale el año). Seguro: mail o CUIT de
    // cualquier postulación de la persona. Si no, nombre en el mismo país.
    const dia = p.postulado_at.slice(0, 10);
    const anterior = (b: BajaHist) => (b.fecha ? b.fecha < dia : b.anio != null && `${b.anio}-12-31` < dia);
    const ultima = (l: BajaHist[]) =>
      l.filter(anterior).sort((a, b) => ((a.fecha ?? `${a.anio}`) < (b.fecha ?? `${b.anio}`) ? 1 : -1))[0] ?? null;
    let bajaHist: BajaHist | null = null;
    let bajaHistPor: Cruce['bajaHistPor'] = null;
    const porMailB: BajaHist[] = [];
    const porCuitB: BajaHist[] = [];
    for (const q of [p, ...grupo]) {
      porMailB.push(...(bajaPorMail.get(q.email.toLowerCase()) ?? []));
      if (q.cuit) porCuitB.push(...(bajaPorCuit.get(q.cuit) ?? []));
    }
    bajaHist = ultima(porMailB);
    if (bajaHist) bajaHistPor = 'mail';
    else if ((bajaHist = ultima(porCuitB))) bajaHistPor = 'cuit';
    else {
      const cand: BajaHist[] = [];
      for (const k of clavesNombre(p.nombre)) cand.push(...(bajaPorNombre.get(k) ?? []));
      bajaHist = ultima(cand.filter((b) => b.pais === p.pais));
      if (bajaHist) bajaHistPor = 'nombre';
    }

    // La baja del historial pesa cuando el dashboard no sabe nada mejor: no
    // está en la plataforma, coincide solo por nombre, o está de baja sin
    // salida cargada. Si hoy está activo, manda eso.
    let motivoBaja: MotivoBaja | null = desv?.motivo ?? null;
    let notaBaja: string | null = desv?.nota ?? (ter && !ter.activo ? ter.motivo_baja : null);
    if (bajaHist && (historial === 'nuevo' || historial === 'posible' || historial === 'baja')) {
      if (bajaHistPor !== 'nombre' || historial === 'baja') {
        historial = bajaHist.quien === 'nuestra' ? 'baja_nuestra' : bajaHist.quien === 'propia' ? 'baja_propia' : 'baja';
        motivoBaja = bajaHist.quien === 'nuestra' ? 'nuestra' : bajaHist.quien === 'propia' ? 'por_el_psicologo' : 'a_definir';
        notaBaja = bajaHist.motivo;
      } else {
        historial = 'posible';
      }
    }

    const faltan = minimos(p);
    out.set(p.id, {
      historial,
      coincide,
      ter,
      otrosPorNombre,
      motivoBaja,
      notaBaja,
      multaPendiente: ter ? multaPorTer.get(ter.id) ?? null : null,
      fantasmeos: ter ? fantPorTer.get(ter.id) ?? 0 : 0,
      bajaHist,
      bajaHistPor,
      previas,
      decisionPrevia,
      decision: decPorPost.get(p.id) ?? null,
      cumpleMinimos: faltan.length === 0,
      minimosQueFaltan: faltan,
    });
  }
  return out;
}

export const TEXTO_HISTORIAL: Record<Historial, string> = {
  baja_nuestra: 'Baja nuestra',
  activo: 'Activo hoy',
  baja_propia: 'Se fue por su cuenta',
  baja: 'Dado de baja',
  posible: 'Posible: revisar',
  nuevo: 'Nuevo',
};

// Clases de las pastillas de situación ya existentes en globals.css.
export const CLASE_HISTORIAL: Record<Historial, string> = {
  baja_nuestra: 'sit sit-r',
  activo: 'sit sit-b',
  baja_propia: 'sit sit-y',
  baja: 'sit sit-y',
  posible: 'sit sit-o',
  nuevo: 'sit sit-g',
};

export const TEXTO_DECISION: Record<Decision, string> = {
  avanza: 'Avanza',
  no_avanza: 'No avanza',
  en_espera: 'En espera',
};

export const TEXTO_MOTIVO_BAJA: Record<MotivoBaja, string> = {
  nuestra: 'La desvinculamos nosotros',
  por_el_psicologo: 'Se fue por su cuenta',
  a_definir: 'Motivo a definir',
};
