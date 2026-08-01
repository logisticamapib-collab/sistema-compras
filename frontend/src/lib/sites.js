// Multi-site: por diseno un usuario normal SOLO ve el site donde esta dado de alta.
// Los roles de direccion/administracion ven todos los sites y por eso necesitan un
// filtro explicito en cada vista, reporte y KPI.

export const ROLES_TODOS_LOS_SITES = ['admin', 'direccion', 'gerente_planta', 'gerente_administrativo', 'gerente_compras']

export const veTodosLosSites = (rol) => ROLES_TODOS_LOS_SITES.includes(rol)

// Site efectivo de una consulta:
//   - usuario normal  -> siempre su site (no puede elegir)
//   - rol privilegiado -> lo que elija en el filtro ('' = todos)
export function siteEfectivo(perfil, siteElegido) {
  if (!veTodosLosSites(perfil?.rol)) return perfil?.site_id ?? null
  return siteElegido ? Number(siteElegido) : null   // null = todos los sites
}

// Aplica .eq('site_id', X) solo si hay site efectivo. Para tablas con site_id propio.
export function aplicarSite(query, perfil, siteElegido, columna = 'site_id') {
  const s = siteEfectivo(perfil, siteElegido)
  return s ? query.eq(columna, s) : query
}

// Para entidades sin site_id propio (lotes, existencias, moldes...) se deriva del
// almacen / maquina. Devuelve la lista de ids permitidos, o null si son todos.
export function idsDelSite(lista, perfil, siteElegido, campo = 'site_id') {
  const s = siteEfectivo(perfil, siteElegido)
  if (!s) return null
  return (lista || []).filter(x => x[campo] === s).map(x => x.id)
}
