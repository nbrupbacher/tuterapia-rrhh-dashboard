// Growth — redacción de los insights.
//
// Cada generador SQL devuelve números; acá se convierten en una tarjeta que se
// lee en 10 segundos y dice qué hacer. Sin LLM: plantillas fijas.
//
// Reglas de tono (no negociables):
//   - Español rioplatense, de vos. Claro y humano, sin jerga.
//   - Siempre desde la oportunidad. Nada de "problema", "fallan", "malo",
//     "bajo rendimiento".
//   - Describir lo que se ve en los datos, sin suponer el motivo.
//   - Sin explicaciones de método, sin condicionales, sin paréntesis
//     aclaratorios. Si un número necesita contexto, va en el desplegable.
//
// Los límites de largo son duros: si un texto se pasa, el insight no se
// publica y el error sale en la respuesta del recálculo. Es a propósito —
// una tarjeta larga es peor que una tarjeta que falta.

import type { GeneratorPayload, TerapeutaRef } from './growth';
import { mesNombre, PAIS_NOMBRE } from './growth';

export const LIMITES = {
  titulo: 60,
  cuerpo: 220,
  accion: 100,
  frasesCuerpo: 2,
} as const;

export interface DraftInsight {
  generator: string;
  titulo: string;
  que_pasa: string;
  /** La línea de potencial, ya redactada. El insight de contexto no lleva. */
  oportunidad: string | null;
  accion: string;
  potencial_pct: number | null;
  /** Se sigue calculando y guardando en el payload, pero no se muestra. */
  impacto_usd: number | null;
  payload: GeneratorPayload;
  /** Número que define el insight. Detecta si repite el del mes anterior. */
  numero_principal: number;
  /**
   * Va primero en la lista y fuera del ranking por potencial. Es el contexto
   * que da sentido a los demás, no compite con ellos.
   */
  fijo?: boolean;
  /**
   * Exime a la acción de llevar un número. Solo para los insights de contexto:
   * "frenar las altas y revisar de dónde vienen los pacientes" es una acción
   * concreta aunque no tenga una cifra adentro.
   */
  accionSinNumero?: boolean;
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

/** 13.1 → '13,1' · 10 → '10' — un decimal, coma decimal, sin ceros al pedo. */
export function dec(v: unknown): string {
  const x = Math.round(n(v) * 10) / 10;
  return (Number.isInteger(x) ? String(x) : x.toFixed(1)).replace('.', ',');
}

const plural = (c: number, uno: string, varios: string) => (c === 1 ? uno : varios);

/** 'AR' → 'Argentina'. Para no repetir el código de país en medio de una frase. */
function pais(ctx: TemplateCtx): string {
  return PAIS_NOMBRE[ctx.pais] ?? ctx.pais;
}

// ===== Validación de largo =====

export class TextoLargoError extends Error {}

function contarFrases(texto: string): number {
  return texto.split(/[.!?]+(?:\s|$)/).filter(f => f.trim().length > 0).length;
}

/** Corre los límites duros. Tira si alguno no se cumple. */
export function validar(d: DraftInsight): DraftInsight {
  const fallas: string[] = [];

  if (d.titulo.length > LIMITES.titulo) {
    fallas.push(`título de ${d.titulo.length} caracteres, máximo ${LIMITES.titulo}`);
  }
  if (d.que_pasa.length > LIMITES.cuerpo) {
    fallas.push(`cuerpo de ${d.que_pasa.length} caracteres, máximo ${LIMITES.cuerpo}`);
  }
  const frases = contarFrases(d.que_pasa);
  if (frases > LIMITES.frasesCuerpo) {
    fallas.push(`cuerpo de ${frases} frases, máximo ${LIMITES.frasesCuerpo}`);
  }
  if (d.accion.length > LIMITES.accion) {
    fallas.push(`acción de ${d.accion.length} caracteres, máximo ${LIMITES.accion}`);
  }
  // La acción tiene que ser concreta: un verbo y un número.
  if (!d.accionSinNumero && !/\d/.test(d.accion)) {
    fallas.push('la acción no tiene ningún número');
  }
  if (d.oportunidad != null && d.oportunidad.includes('\n')) {
    fallas.push('el potencial tiene que ser una sola línea');
  }

  if (fallas.length) {
    throw new TextoLargoError(`${d.generator}: ${fallas.join('; ')}`);
  }
  return d;
}

// ===== Plantillas =====

type Template = (p: GeneratorPayload, ctx: TemplateCtx) => DraftInsight | null;

const templates: Record<string, Template> = {

  // 0. Crecimiento del país — el contexto del mes. Va siempre primero y
  //    fuera del ranking: es lo que le da sentido a los demás insights.
  crecimiento_pais: (p, ctx) => {
    if (!p.serie_completa) return null;

    const varPct = n(p.var_pct);
    const dProd = n(p.delta_productivos);
    const cae = varPct < 0;
    const desde = mesNombre(String(p.mes_2));
    const hasta = mesNombre(String(p.mes));

    // El movimiento de terapeutas productivos, en la misma ventana que la
    // variación, para que los dos números se puedan leer juntos.
    const movimiento = `Hay ${num(Math.abs(dProd))} ${plural(Math.abs(dProd), 'terapeuta productivo', 'terapeutas productivos')} `
      + `${dProd < 0 ? 'menos' : 'más'} y entraron ${num(p.entraron)} nuevos.`;

    if (cae) {
      return {
        generator: 'crecimiento_pais',
        titulo: `${pais(ctx)} lleva dos meses bajando`,
        que_pasa: `Las sesiones pasaron de ${num(p.ses_2)} en ${desde} a ${num(p.ses)} en ${hasta}, `
          + `un ${dec(Math.abs(varPct))}% menos. ${movimiento}`,
        oportunidad: null,
        accion: `Frenar las altas y revisar de dónde vienen los pacientes.`,
        potencial_pct: null,
        impacto_usd: null,
        payload: p,
        numero_principal: varPct,
        fijo: true,
        accionSinNumero: true,
      };
    }

    return {
      generator: 'crecimiento_pais',
      titulo: `${pais(ctx)} creció ${dec(varPct)}% en dos meses`,
      que_pasa: `Las sesiones pasaron de ${num(p.ses_2)} en ${desde} a ${num(p.ses)} en ${hasta}. ${movimiento}`,
      oportunidad: null,
      accion: `Sostener el ritmo de incorporación de los últimos dos meses.`,
      potencial_pct: null,
      impacto_usd: null,
      payload: p,
      numero_principal: varPct,
      fijo: true,
      accionSinNumero: true,
    };
  },

  // 1. Reclutamiento — cuánto crece el país si sumamos terapeutas
  reclutamiento: (p, ctx) => {
    const nuevos = n(p.n_terapeutas);
    if (nuevos < ctx.minCasos || !n(p.ses_prom_nuevo)) return null;

    const altas = n(p.altas);

    // Si el país viene cayendo, sumar gente reparte los mismos pacientes
    // entre más terapeutas. La recomendación se da vuelta.
    if (p.frenar === true) {
      const motivo = p.cae_sesiones && p.cae_registros
        ? 'Las sesiones y los registros'
        : p.cae_sesiones ? 'Las sesiones' : 'Los registros';
      return {
        generator: 'reclutamiento',
        titulo: 'Conviene esperar antes de sumar terapeutas',
        que_pasa: `${motivo} de ${pais(ctx)} bajan hace dos meses. `
          + `Sumar gente ahora reparte los mismos pacientes entre más terapeutas.`,
        oportunidad: null,
        accion: `Esperar 1 mes de crecimiento antes de abrir búsquedas.`,
        potencial_pct: 0,
        impacto_usd: 0,
        payload: p,
        numero_principal: n(p.ses_prom_nuevo),
      };
    }

    const unoDeCada = p.uno_de_cada != null ? n(p.uno_de_cada) : null;
    const porcion = unoDeCada
      ? `1 de cada ${unoDeCada} sesiones del país`
      : `el ${dec(p.share_nuevos_pct)}% de las sesiones del país`;

    return {
      generator: 'reclutamiento',
      titulo: 'Sumar terapeutas hace crecer rápido',
      que_pasa: `Cada ${altas} terapeutas nuevos suman unas ${num(p.ses_adicionales)} sesiones por mes. `
        + `Los ${num(nuevos)} que entraron en 6 meses ya hacen ${porcion}.`,
      oportunidad: `Potencial: +${dec(p.potencial_pct)}% por cada ${altas} que sumemos.`,
      accion: `Sumar ${altas} terapeutas este mes.`,
      potencial_pct: n(p.potencial_pct),
      impacto_usd: n(p.impacto_usd),
      payload: p,
      numero_principal: n(p.ses_prom_nuevo),
    };
  },

  // 2. Demanda redirigible — pacientes que llegan a quien no está atendiendo
  demanda_redirigible: (p, ctx) => {
    const cant = n(p.n_terapeutas);
    if (cant < ctx.minCasos || !n(p.ses_potenciales)) return null;

    const ses = n(p.sesiones);
    const cuerpo = cant === 1
      ? `1 terapeuta recibió ${num(p.registros)} registros en ${mesNombre(ctx.month)} `
        + `y dio ${num(ses)} ${plural(ses, 'sesión', 'sesiones')}.`
      : `${num(cant)} terapeutas recibieron ${num(p.registros)} registros en ${mesNombre(ctx.month)} `
        + `y entre todos dieron ${num(ses)} ${plural(ses, 'sesión', 'sesiones')}.`;

    return {
      generator: 'demanda_redirigible',
      titulo: 'Hay pacientes llegando a terapeutas que no atienden',
      que_pasa: cuerpo,
      // Siempre "hasta": no sabemos si esos pacientes elegirían otro terapeuta.
      oportunidad: `Potencial: hasta +${dec(p.potencial_pct)}%.`,
      accion: cant === 1
        ? `Sacar del listado a 1 perfil y hablar con esa persona.`
        : `Sacar del listado a esos ${num(cant)} y hablar con cada uno.`,
      potencial_pct: n(p.potencial_pct),
      impacto_usd: n(p.impacto_usd),
      payload: p,
      numero_principal: n(p.registros),
    };
  },

  // 3. Concentración — cuántos pacientes dependen de pocos terapeutas
  concentracion: (p, ctx) => {
    const cant = n(p.n_terapeutas);
    const topN = n(p.top_n);
    if (cant < ctx.minCasos || !n(p.pct_top_n)) return null;

    return {
      generator: 'concentracion',
      titulo: 'Muchos pacientes se concentran en pocos terapeutas',
      que_pasa: `${num(cant)} terapeutas, el 10% del país, atienden el ${dec(p.pct_top)}% de las sesiones. `
        + `Los ${topN} más fuertes solos hacen el ${dec(p.pct_top_n)}%.`,
      // Acá el potencial es riesgo evitado, así que no se muestra como "+X%".
      oportunidad: `Si esos ${topN} bajan el ritmo, se cae el ${dec(p.pct_top_n)}% del país.`,
      accion: `Acompañar a esos ${topN} y repartir los pacientes nuevos.`,
      potencial_pct: n(p.potencial_pct),
      impacto_usd: n(p.impacto_usd),
      payload: p,
      numero_principal: n(p.pct_top_n),
    };
  },

  // 4. Primera sesión — medición MENSUAL, por diferencia de snapshots.
  //
  // Los snapshots guardan el acumulado histórico, no el mes. El mes sale de
  // restar dos snapshots, pero ese número viene inflado: el paciente que tuvo
  // su primera sesión a fin de mes figura como "no volvió" aunque todavía no
  // le tocaba volver. Entre agosto y septiembre, 40 terapeutas bajaron su
  // cantidad de pacientes sin segunda sesión: 52 pacientes que figuraban como
  // perdidos volvieron después.
  //
  // De ahí las dos reglas: nunca comparar el mensual contra el acumulado
  // histórico —uno está maduro y el otro no, la comparación no significa
  // nada— y comparar solo mensual contra mensual, que arrastra el mismo
  // sesgo todos los meses. Eso recién es posible con tres snapshots.
  //
  // PENDIENTE: la medición correcta (primera sesión en el mes y segunda
  // dentro de los 30 días) sale de los datos crudos de sesiones, no de acá.
  primera_sesion: (p, ctx) => {
    // Con dos snapshots hay un solo dato mensual y nada con qué compararlo.
    if (p.comparable !== true) return null;
    const casos = n(p.n_terapeutas);
    if (casos < ctx.minCasos) return null;

    const pct = n(p.pct_caida);
    const pctPrev = n(p.pct_caida_prev);
    const sube = pct > pctPrev;

    return {
      generator: 'primera_sesion',
      titulo: sube ? 'Vuelven menos pacientes a la segunda sesión'
                   : 'Vuelven más pacientes a la segunda sesión',
      que_pasa: `De las ${num(p.primeras)} primeras sesiones de ${mesNombre(ctx.month)}, `
        + `${num(p.sin_segunda)} no tuvieron segunda: ${dec(pct)}% contra ${dec(pctPrev)}% el mes pasado.`,
      oportunidad: `Mover ese ${dec(pct)}% al ${dec(pctPrev)}% del mes pasado son ${num(Math.abs(n(p.primeras) * (pct - pctPrev) / 100))} pacientes más.`,
      accion: `Revisar la primera sesión con los ${num(casos)} terapeutas medidos.`,
      potencial_pct: null,
      impacto_usd: null,
      payload: p,
      numero_principal: pct,
    };
  },
};

/**
 * Redacta un insight. Devuelve null si el generador no llega al mínimo de
 * casos: mejor no mostrar nada que meter ruido en el mes.
 * Tira TextoLargoError si el texto se pasa de los límites.
 */
export function redactar(
  generator: string,
  payload: GeneratorPayload | null,
  ctx: TemplateCtx,
): DraftInsight | null {
  const tpl = templates[generator];
  if (!tpl || !payload) return null;
  const draft = tpl(payload, ctx);
  return draft ? validar(draft) : null;
}

// ===== Ranking =====

export interface RankingCfg {
  potencial_base_pct: number;
  penalizacion_repetido: number;
  umbral_cambio_pct: number;
  feedback_piso: number;
  feedback_paso: number;
  feedback_techo: number;
}

export const RANKING_DEFAULT: RankingCfg = {
  potencial_base_pct: 1,
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

/**
 * Score de los insights fijos. Queda por encima de cualquier score normalizado
 * (que nunca pasa de 1) para que la UI, que ordena por score, los ponga
 * primero sin necesitar una columna de orden aparte.
 */
export const SCORE_FIJO = 1000;

/** score = potencial normalizado × penalización × peso de feedback */
export function calcularScore(
  potencial: number | null,
  potencialMax: number,
  penalizacion: number,
  peso: number,
  cfg: RankingCfg,
): number {
  const base = potencial ?? cfg.potencial_base_pct;
  const normalizado = potencialMax > 0 ? base / potencialMax : 0;
  return Math.round(normalizado * penalizacion * peso * 10000) / 10000;
}
