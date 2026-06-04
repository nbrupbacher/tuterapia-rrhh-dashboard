// Descripciones de cuadrantes (predicción)
export const PDESC: Record<string, string> = {
  A: 'Ganancia por encima de la mediana del país y promedio de sesiones mayor a 2.0. Los pacientes vuelven con regularidad. Máximo perfil actual.',
  B: 'Genera ganancia pero promedio de sesiones por debajo de 2.0. Los pacientes no vuelven con regularidad. La ganancia puede caer.',
  C: 'Buen promedio de sesiones pero ganancia debajo de la mediana. Tiene calidad, le falta volumen. Necesita más pacientes.',
  D: 'Ganancia baja y promedio de sesiones menor a 2.0. Bajo volumen y baja retención. Requiere intervención directa.',
};

// Descripciones de accionables (modelo viejo — dejarlo por ahora para no romper
// imports legacy; se puede limpiar más adelante si confirmás que nada lo usa)
export const ADESC: Record<string, string> = {
  irrecuperable:   'Sin actividad sostenida y sin pacientes. Los datos muestran que no hubo recuperación en casos similares. Iniciar conversación sobre continuidad en la plataforma.',
  revisar_urgente: 'Recibió registros en los últimos 3 meses, no convirtió y además perdió pacientes netos. Tuvo demanda y la desperdició.',
  dejar_mostrar:   'Acumuló muchos registros sin convertir. Fantasmear al terapeuta — pausar el matching para que trabaje con los registros actuales antes de recibir nuevos.',
  potenciar:       'Cuadrante A con tendencia positiva. Máximo valor actual. Priorizar en visibilidad y matching.',
  retencion:       'Promedio de sesiones por debajo de 2.0. Los pacientes no vuelven con regularidad. Conversar sobre retención.',
  cancelaciones:   'Tasa de cancelaciones por encima del 20%. Afecta la experiencia del paciente y el score.',
  disponibilidad:  'Sin horarios cargados. Los pacientes no pueden agendarse. Solicitar actualización del perfil.',
  monitorear:      'Sin alertas activas. Seguimiento regular en el próximo ciclo mensual.',
};

// Fórmulas de ganancia: gan = ses * s - reg * r
export const TARIFAS = {
  AR: { s: 5.5, r: 1.5 },
  UY: { s: 10.0, r: 2.0 },
};
