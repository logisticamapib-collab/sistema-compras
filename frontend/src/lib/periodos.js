// Calcula {desde, hasta} como objetos Date segun el tipo de periodo elegido
export function calcularRangoFechas(periodo) {
  const hoy = new Date()
  let desde, hasta = new Date()

  if (periodo.tipo === 'semana_actual') {
    const diaSemana = hoy.getDay() // 0 = domingo
    const offset = diaSemana === 0 ? 6 : diaSemana - 1
    desde = new Date(hoy)
    desde.setDate(hoy.getDate() - offset)
    desde.setHours(0, 0, 0, 0)
  } else if (periodo.tipo === 'mes_actual') {
    desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
  } else if (periodo.tipo === 'ultimos_n_meses') {
    desde = new Date()
    desde.setMonth(desde.getMonth() - (parseInt(periodo.valor) || 1))
  } else if (periodo.tipo === 'rango_personalizado') {
    desde = periodo.desde ? new Date(periodo.desde + 'T00:00:00') : new Date(hoy.getFullYear(), hoy.getMonth() - 1, hoy.getDate())
    hasta = periodo.hasta ? new Date(periodo.hasta + 'T23:59:59') : new Date()
  } else {
    desde = new Date()
    desde.setMonth(desde.getMonth() - 6)
  }

  return { desde, hasta }
}

export function etiquetaPeriodo(periodo) {
  switch (periodo.tipo) {
    case 'semana_actual': return 'Semana actual'
    case 'mes_actual': return 'Mes actual'
    case 'ultimos_n_meses': return `Ultimos ${periodo.valor || 1} mes(es)`
    case 'rango_personalizado': return `${periodo.desde || '...'} a ${periodo.hasta || 'hoy'}`
    default: return 'Periodo'
  }
}