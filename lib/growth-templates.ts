// Growth — redacción de los insights.
//
// Cada generador SQL devuelve números; acá se convierten en un texto que el
// equipo de RRHH pueda leer y accionar. Sin LLM: plantillas fijas.
//
// Reglas de tono (no negociables):
//   - Español rioplatense, de vos. Claro y humano, sin jerga.
//   - Siempre desde la oportunidad. Nada de "problema", "fallan", "malo",
//     "bajo rendimiento".
//   - Describir lo que se ve en los datos, sin suponer el motivo. El motivo
//     lo descubre el equipo hablando con cada terapeuta.
//   - Estructura fija: título (la oportunidad) / qué pasa (1-2 frases) /
//     oportunidad (con número redondeado) / qué hacer (una acción concreta).
//   - Pocos números por insight y redondeados.

import type { GeneratorPayload, TerapeutaRef } from './growth';
import { PAIS_NOMBRE, mesNombre } from './growth';

export interface DraftInsight {
  generator: string;
  titulo: string;
  que_pasa: string;
  oportunidad: string | null;
  accion: string;
  impacto_usd: number | null;
  payload: GeneratorPayload;
  /** Número que define el insight. Se usa para detectar si repite el del mes anterior. */
  numero_principal: number;
}

export interface TemplateCtx {
  month: string;
  pais: string;
  /** Umbral mínimo de casos del generador. Abajo de eso no se genera nada. */
  minCasos: number;
}

// ===== Formateo =====

const n = (v: unknown): number => Number(v ?? 0);

/** 1243 → '1.243' */
export function num(v: unknown): string {
  return new Intl.NumberFormat('es-AR').format(Math.round(n(v)));
}

/** Redondeo por magnitud: los números exactos dan una precisión que no tenemos. */
export function redondear(v: unknown): number {
  const x = Math.abs(n(v));
  const signo = n(v) < 0 ? -1 : 1;
  if (x < 100) return signo * Math.round(x / 5) * 5;
  if (x < 1000) return signo * Math.round(x / 10) * 10;
  if (x < 10000) return signo * Math.round(x / 50) * 50;
  return signo * Math.round(x / 100) * 100;
}

/** 938 → 'cerca de 940 USD por mes' */
export function usdMes(v: unknown): string {
  return `cerca de ${num(redondear(v))} USD por mes`;
}

const pct = (v: unknown): string => `${Math.round(n(v))}%`;
const plural = (c: number, uno: string, varios: string) => (c === 1 ? uno : varios);

/**
 * Une una lista con comas y la conjunción correcta: 'y', o 'e' cuando la
 * palabra siguiente arranca con i- o hi- (pero no 'hie-'). Sin esto salía
 * "cognitiva-conductual e psicoanálisis".
 */
export function unirCon(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  const ultimo = items[items.length - 1];
  const sinTildes = ultimo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const conj = /^(i(?!e)|hi(?!e))/.test(sinTildes) ? 'e' : 'y';
  return `${items.slice(0, -1).join(', ')} ${conj} ${ultimo}`;
}

/** Para no repetir "de los dos países" en medio de una frase. */
function pais(ctx: TemplateCtx): string {
  return PAIS_NOMBRE[ctx.pais] ?? ctx.pais;
}

/** Nota al pie cuando hay terapeutas sin horas cargadas: es un dato a completar. */
function notaSinHoras(sinHoras: number): string {
  if (!sinHoras) return '';
  return ` Ojo que ${num(sinHoras)} ${plural(sinHoras, 'terapeuta todavía no tiene', 'terapeutas todavía no tienen')} horas cargadas, así que ${plural(sinHoras, 'queda', 'quedan')} afuera de esta cuenta.`;
}

// ===== Plantillas =====

type Template = (p: GeneratorPayload, ctx: TemplateCtx) => DraftInsight | null;

const templates: Record<string, Template> = {

  // 1. Crecimiento del país
  crecimiento_pais: (p, ctx) => {
    const largo = p.vs_primer_mes as Record<string, unknown> | null;
    const corto = p.vs_mes_anterior as Record<string, unknown> | null;
    const ventana = largo ?? corto;
    if (!ventana) return null;

    const quedaron = n(ventana.quedaron_delta);
    const entraron = n(ventana.entraron_delta);
    const salieron = n(ventana.salieron_delta);
    const total = n(ventana.total);
    const desde = mesNombre(String(ventana.desde));
    const rec = String(p.recomendacion ?? 'mantener');
    const rinden = n(p.rinden_pct);
    const impacto = n(p.impacto_usd);
    const lugar = n(p.lugar_libre_buenos);
    const perfil = (p.perfil as string[] | null) ?? [];
    const perfilTxt = perfil.length
      ? `, priorizando ${unirCon(perfil.map(c => c.toLowerCase()))}`
      : '';

    // Qué pasa: de dónde salió el crecimiento. Siempre en sesiones, nunca en
    // USD: el valor por sesión cambió y en USD el salto no sería real.
    const quePasa = total >= 0
      ? `Desde ${desde}, ${pais(ctx)} sumó ${num(total)} sesiones por mes. `
        + `Los ${num(ventana.entraron_n)} que se incorporaron aportan ${num(entraron)}, `
        + `y los ${num(ventana.quedaron_n)} que ya estaban sumaron ${num(quedaron)} más de lo que hacían.`
      : `Desde ${desde}, ${pais(ctx)} pasó de ${num(ventana.ses_desde)} a ${num(ventana.ses_hasta)} sesiones por mes. `
        + `Los ${num(ventana.entraron_n)} que se incorporaron aportan ${num(entraron)} y `
        + `los ${num(ventana.salieron_n)} que dejaron la plataforma se llevaron ${num(Math.abs(salieron))}.`;

    if (rec === 'reclutar') {
      return {
        generator: 'crecimiento_pais',
        titulo: `${pais(ctx)} tiene espacio para crecer sumando terapeutas`,
        que_pasa: quePasa + (rinden >= 80
          ? ` Los que entraron ya están haciendo casi las mismas sesiones que los que están hace más tiempo.`
          : ''),
        oportunidad: `Con ${num(p.objetivo)} incorporaciones nuevas podemos sumar ${usdMes(impacto)}.`,
        accion: `Retomar el reclutamiento${perfilTxt}.`,
        impacto_usd: impacto,
        payload: p,
        numero_principal: impacto,
      };
    }

    if (rec === 'llenar_primero') {
      return {
        generator: 'crecimiento_pais',
        titulo: `${pais(ctx)} puede crecer con el equipo que ya está`,
        que_pasa: quePasa
          + ` Hoy hay ${num(lugar)} sesiones de lugar libre en terapeutas que vienen muy bien, `
          + `bastante más de lo que sumarían ${num(p.objetivo)} incorporaciones nuevas.`,
        oportunidad: `Llenar ese lugar rinde más que reclutar ahora: ${num(p.objetivo)} incorporaciones aportarían ${usdMes(impacto)}, y el lugar que ya existe es varias veces eso.`,
        accion: `Antes de abrir búsquedas, priorizar en la asignación a los terapeutas que hoy tienen lugar y confirmar con ellos que las horas cargadas son las reales.`,
        impacto_usd: impacto,
        payload: p,
        numero_principal: impacto,
      };
    }

    if (rec === 'enfocar_nuevos') {
      return {
        generator: 'crecimiento_pais',
        titulo: `Los que se sumaron en ${pais(ctx)} todavía están arrancando`,
        que_pasa: quePasa
          + ` Los ${num(p.n_nuevos)} que entraron en los últimos meses están haciendo `
          + `${pct(rinden)} de las sesiones que hacen los que están hace más tiempo.`,
        oportunidad: `Acompañarlos hasta que lleguen al promedio del país es la vía más corta para crecer, sin sumar gente nueva.`,
        accion: `Enfocar el acompañamiento de este mes en los que entraron desde ${String(p.mes_anterior ?? '').slice(0, 7)} y ver con ellos qué necesitan para llenar su agenda.`,
        impacto_usd: impacto,
        payload: p,
        numero_principal: impacto,
      };
    }

    return {
      generator: 'crecimiento_pais',
      titulo: `${pais(ctx)} viene creciendo parejo`,
      que_pasa: quePasa,
      oportunidad: `Si sostenemos el ritmo, ${num(p.objetivo)} incorporaciones aportarían ${usdMes(impacto)}.`,
      accion: `Mantener la intensidad actual y revisar el mes que viene si conviene abrir búsquedas.`,
      impacto_usd: impacto,
      payload: p,
      numero_principal: impacto,
    };
  },

  // 2. Nuevos destacados
  nuevos_destacados: (p, ctx) => {
    const cant = n(p.n_terapeutas);
    if (cant < ctx.minCasos) return null;
    return {
      generator: 'nuevos_destacados',
      titulo: `Los nuevos de ${pais(ctx)} ya son parte del equipo fuerte`,
      que_pasa: `${num(cant)} de los ${num(p.n_nuevos)} terapeutas que entraron desde ${mesNombre(String(p.desde_mes))} `
        + `ya están en el grupo de mejor desempeño, con un promedio de ${num(p.ses_prom)} sesiones en el mes.`,
      oportunidad: `Son ${pct(p.pct)} de las incorporaciones recientes: lo que les funcionó a ellos se puede replicar con los que están arrancando ahora.`,
      accion: `Reconocerlos y preguntarles qué les funcionó en sus primeros meses.`,
      impacto_usd: null,
      payload: p,
      numero_principal: cant,
    };
  },

  // 3. Demanda redirigible
  demanda_redirigible: (p, ctx) => {
    const cant = n(p.n_terapeutas);
    if (cant < ctx.minCasos) return null;
    return {
      generator: 'demanda_redirigible',
      titulo: `Hay pacientes esperando que podemos redirigir`,
      que_pasa: `Algunos perfiles de ${pais(ctx)} están recibiendo muchos registros pero este mes no están atendiendo: `
        + `${num(cant)} ${plural(cant, 'terapeuta', 'terapeutas')} en ${mesNombre(ctx.month)}, con ${num(p.registros)} personas interesadas.`,
      oportunidad: `Si esas personas llegan a terapeutas con lugar, recuperamos ${usdMes(p.impacto_usd)}.`,
      accion: `Pausar temporalmente esos perfiles para que los pacientes vayan a terapeutas con lugar, y hablar con cada uno para ver si quieren retomar.`,
      impacto_usd: n(p.impacto_usd),
      payload: p,
      numero_principal: n(p.registros),
    };
  },

  // 4. Primera sesión
  primera_sesion: (p, ctx) => {
    const cant = n(p.n_terapeutas);
    if (cant < ctx.minCasos) return null;
    const refs = (p.referentes as TerapeutaRef[] | undefined) ?? [];
    const nombres = unirCon(refs.slice(0, 3).map(r => r.nombre));
    return {
      generator: 'primera_sesion',
      titulo: `Podemos acompañar mejor la primera sesión`,
      que_pasa: `En ${pais(ctx)} hay ${num(cant)} ${plural(cant, 'terapeuta', 'terapeutas')} donde, en el acumulado histórico, `
        + `${pct(p.caida_prom)} de las personas que tuvieron una primera sesión no volvieron a una segunda. `
        + `El promedio del país es ${pct(p.caida_prom_pais)}.`,
      oportunidad: `Dentro del mismo equipo hay quienes logran que casi todos vuelvan${nombres ? `, como ${nombres}` : ''}. Esa práctica se puede compartir.`,
      accion: `Armar un espacio para compartir prácticas de primera sesión, con ${nombres || 'los referentes del país'} contando cómo la encaran.`,
      impacto_usd: null,
      payload: p,
      numero_principal: cant,
    };
  },

  // 5. Cancelaciones
  cancelaciones_foco: (p, ctx) => {
    const cant = n(p.n_terapeutas);
    if (cant < ctx.minCasos) return null;
    return {
      generator: 'cancelaciones_foco',
      titulo: `Un grupo chico explica buena parte de las cancelaciones`,
      que_pasa: `En ${pais(ctx)}, ${num(cant)} terapeutas concentran ${num(p.cancel_grupo)} de las ${num(p.cancel_pais)} `
        + `sesiones canceladas de ${mesNombre(ctx.month)}, o sea ${pct(p.pct_concentran)} del total.`,
      oportunidad: `Es un grupo lo bastante chico como para hablar con cada uno este mes y entender qué les está pasando con la agenda.`,
      accion: `Tener una conversación puntual con ese grupo, de a uno.`,
      impacto_usd: null,
      payload: p,
      numero_principal: n(p.cancel_grupo),
    };
  },

  // 6. Foco de acompañamiento
  foco_acompanamiento: (p, ctx) => {
    const cant = n(p.n_terapeutas);
    const meet = n(p.meet_delta);
    const wa = n(p.whatsapp_delta);
    if (cant < ctx.minCasos || !n(p.meet_n)) return null;
    return {
      generator: 'foco_acompanamiento',
      titulo: `A quiénes conviene acompañar este mes`,
      que_pasa: `A los dos meses de una Meet, el score sube en promedio ${num(meet)} puntos; con WhatsApp, ${num(wa)}. `
        + `Los que estaban en rojo y nunca fueron acompañados subieron ${num(p.control_delta)}, `
        + `así que los números solos no alcanzan para comparar: son grupos que arrancan de situaciones distintas.`,
      oportunidad: `Hoy hay ${num(cant)} ${plural(cant, 'terapeuta', 'terapeutas')} en ${pais(ctx)} que ${plural(cant, 'lleva', 'llevan')} `
        + `${num(p.meses_rojo)} meses seguidos en rojo y ${plural(cant, 'no tiene', 'no tienen')} acompañamiento vigente.`,
      accion: `Agendar una Meet con ese grupo. Entre las dos opciones, la Meet es la que más se usó y la que deja más contexto.`,
      impacto_usd: null,
      payload: p,
      numero_principal: cant,
    };
  },

  // 7. Top a recuperar
  top_a_recuperar: (p, ctx) => {
    const cant = n(p.n_terapeutas);
    if (cant < ctx.minCasos) return null;
    return {
      generator: 'top_a_recuperar',
      titulo: `Terapeutas del top que podemos volver a acompañar`,
      que_pasa: `${num(cant)} de los que estaban entre los ${num(p.top_n)} que más atendieron en ${mesNombre(String(p.mes_anterior))} `
        + `hicieron al menos ${pct(p.umbral_pct)} menos sesiones en ${mesNombre(ctx.month)}. `
        + `Entre todos son ${num(p.ses_perdidas)} sesiones menos.`,
      oportunidad: `Si vuelven al ritmo que traían, son ${usdMes(p.impacto_usd)}.`,
      accion: `Llamarlos para ver cómo están y qué necesitan.`,
      impacto_usd: n(p.impacto_usd),
      payload: p,
      numero_principal: n(p.ses_perdidas),
    };
  },

  // 8. Perfil que crece
  perfil_que_crece: (p, ctx) => {
    const cs = (p.corrientes as Record<string, unknown>[] | undefined) ?? [];
    if (cs.length < ctx.minCasos) return null;
    const top = cs[0];
    const sug = ((p.sugeridas as string[] | null) ?? []).map(c => c.toLowerCase());
    return {
      generator: 'perfil_que_crece',
      titulo: `Qué perfil conviene priorizar si sumamos terapeutas`,
      que_pasa: `En ${pais(ctx)}, mirando solo las corrientes con al menos ${num(p.min_terapeutas)} terapeutas, `
        + `${String(top.corriente).toLowerCase()} promedia ${num(top.ses_prom)} sesiones por terapeuta `
        + `contra ${num(p.ses_prom_pais)} del país, con ${pct(top.caida_prom)} de caída en primera sesión.`,
      oportunidad: `Priorizar ${unirCon(sug)} en las próximas búsquedas apunta al perfil que hoy mejor retiene y más sesiones sostiene.`,
      accion: `Usar este orden de corrientes como criterio en la próxima tanda de reclutamiento.`,
      impacto_usd: null,
      payload: p,
      numero_principal: n(top.ses_prom),
    };
  },

  // 9. Lugar en buenos terapeutas
  lugar_en_buenos_terapeutas: (p, ctx) => {
    const cant = n(p.n_terapeutas);
    if (cant < ctx.minCasos) return null;
    return {
      generator: 'lugar_en_buenos_terapeutas',
      titulo: `Hay lugar libre en terapeutas que vienen muy bien`,
      que_pasa: `${num(cant)} terapeutas de ${pais(ctx)} sostienen buenos resultados con sus pacientes y hoy están usando `
        + `menos de la mitad de las horas que tienen cargadas.${notaSinHoras(n(p.sin_horas))}`,
      oportunidad: `Llenarlos hasta ${pct(p.objetivo_pct)} de su agenda son ${num(p.lugar_libre)} sesiones más por mes, `
        + `un techo de ${usdMes(p.impacto_usd)}. Es el máximo posible, no una proyección.`,
      accion: `Priorizarlos en la asignación de pacientes nuevos, y confirmar con cada uno que las horas cargadas son las reales.`,
      impacto_usd: n(p.impacto_usd),
      payload: p,
      numero_principal: n(p.lugar_libre),
    };
  },

  // 10. Terapeutas completos
  terapeutas_completos: (p, ctx) => {
    const cant = n(p.n_terapeutas);
    if (cant < ctx.minCasos) return null;
    const refuerza = n(p.lugar_libre_buenos) < n(p.sesiones);
    return {
      generator: 'terapeutas_completos',
      titulo: `${num(cant)} terapeutas de ${pais(ctx)} tienen la agenda llena`,
      que_pasa: `${num(cant)} terapeutas están usando ${pct(p.umbral_pct)} o más de las horas que cargaron, `
        + `y entre todos hicieron ${num(p.sesiones)} sesiones este mes.${notaSinHoras(n(p.sin_horas))}`,
      oportunidad: refuerza
        ? `Con tantas agendas llenas y poco lugar libre en el resto, sumar terapeutas nuevos pasa a ser la vía más clara para crecer.`
        : `Si alguno quiere sumar horas, es la forma más rápida de agregar sesiones sin sumar gente nueva.`,
      accion: `Escribirles para confirmar si quieren sumar horas.`,
      impacto_usd: null,
      payload: p,
      numero_principal: cant,
    };
  },
};

/**
 * Redacta un insight. Devuelve null si el generador no llega al mínimo de
 * casos: mejor no mostrar nada que meter ruido en el mes.
 */
export function redactar(
  generator: string,
  payload: GeneratorPayload | null,
  ctx: TemplateCtx,
): DraftInsight | null {
  const tpl = templates[generator];
  if (!tpl || !payload) return null;
  try {
    return tpl(payload, ctx);
  } catch (e) {
    console.error(`redactar(${generator})`, e);
    return null;
  }
}

// ===== Ranking =====

export interface RankingCfg {
  impacto_base_usd: number;
  penalizacion_repetido: number;
  umbral_cambio_pct: number;
  feedback_piso: number;
  feedback_paso: number;
  feedback_techo: number;
}

export const RANKING_DEFAULT: RankingCfg = {
  impacto_base_usd: 300,
  penalizacion_repetido: 0.5,
  umbral_cambio_pct: 0.15,
  feedback_piso: 0.3,
  feedback_paso: 0.15,
  feedback_techo: 1.6,
};

/**
 * Peso por feedback histórico del generador. Más "sirve" lo sube, más
 * "descarto" lo baja, con piso para que nunca desaparezca del todo: un
 * generador que no sirvió tres meses puede volver a servir al cuarto.
 */
export function pesoFeedback(sirve: number, descarto: number, cfg: RankingCfg): number {
  const peso = 1 + cfg.feedback_paso * (sirve - descarto);
  return Math.min(cfg.feedback_techo, Math.max(cfg.feedback_piso, peso));
}

/**
 * Penalización por repetición: si el mismo generador y país salió el mes
 * anterior y su número principal casi no se movió, el insight ya se leyó.
 */
export function penalizacionRepetido(
  numeroActual: number,
  numeroAnterior: number | null,
  cfg: RankingCfg,
): number {
  if (numeroAnterior == null || numeroAnterior === 0) return 1;
  const cambio = Math.abs(numeroActual - numeroAnterior) / Math.abs(numeroAnterior);
  return cambio < cfg.umbral_cambio_pct ? cfg.penalizacion_repetido : 1;
}

/** score = impacto normalizado × penalización × peso de feedback */
export function calcularScore(
  impacto: number | null,
  impactoMax: number,
  penalizacion: number,
  peso: number,
  cfg: RankingCfg,
): number {
  const base = impacto ?? cfg.impacto_base_usd;
  const normalizado = impactoMax > 0 ? base / impactoMax : 0;
  return Math.round(normalizado * penalizacion * peso * 10000) / 10000;
}
