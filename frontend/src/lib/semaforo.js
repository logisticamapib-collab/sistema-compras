// Semaforo de preparacion de un articulo fabricado (8 puntos).
// Es el candado para poder crear Ordenes de Trabajo (Capa 4).
// Recibe el articulo y los catalogos ya cargados, y regresa los checks.

const DIAS_AVISO = 30

export function evaluarSemaforo(a, datos) {
  const { bom = [], clientesArt = [], normas = [], niveles = [], rutas = [], cavidades = [], liberaciones = [] } = datos
  const hoy = new Date().toISOString().split('T')[0]
  const fechaAviso = new Date(Date.now() + DIAS_AVISO * 86400000).toISOString().split('T')[0]

  const lib = liberaciones.find(l => l.articulo_id === a.id)
  const docs = [
    { nombre: 'PSW', vigencia: lib?.psw_vigencia },
    { nombre: 'PPAP', vigencia: lib?.ppap_vigencia },
  ]
  const vencidos = docs.filter(d => d.vigencia && d.vigencia < hoy).map(d => d.nombre)
  const porVencer = docs.filter(d => d.vigencia && d.vigencia >= hoy && d.vigencia <= fechaAviso).map(d => d.nombre)

  const requiereMolde = ['solo_inyeccion', 'inyeccion_y_ensamble', 'doble_inyeccion'].includes(a.tipo_proceso)
  const nivelVig = niveles.find(n => n.articulo_id === a.id)
  const nivelVencido = nivelVig?.vigente_hasta && nivelVig.vigente_hasta < hoy

  const checks = [
    {
      clave: 'alta', nombre: 'Alta de articulo completa',
      ok: !!a.tipo_proceso && (!requiereMolde || Number(a.peso_pieza_g || 0) > 0),
      detalle: !a.tipo_proceso ? 'Falta tipo de proceso' : (requiereMolde && !(a.peso_pieza_g > 0)) ? 'Falta peso de pieza' : 'Completa',
    },
    {
      clave: 'bom', nombre: 'BOM definido',
      ok: bom.some(b => b.articulo_padre_id === a.id),
      detalle: bom.some(b => b.articulo_padre_id === a.id) ? 'BOM capturado' : 'Sin BOM',
    },
    {
      clave: 'docs', nombre: 'PSW y PPAP vigentes',
      ok: !!lib?.psw_url && !!lib?.ppap_url && vencidos.length === 0,
      detalle: !lib ? 'Sin documentos' : vencidos.length ? `Vencido: ${vencidos.join(', ')}` : porVencer.length ? `Por vencer: ${porVencer.join(', ')}` : 'Vigentes',
    },
    {
      clave: 'liberado', nombre: 'Liberado por Calidad',
      ok: !!lib?.liberado,
      detalle: lib?.liberado ? 'Liberado' : 'Pendiente de liberacion',
    },
    {
      clave: 'cliente', nombre: 'Cliente asignado',
      ok: clientesArt.some(c => c.articulo_id === a.id),
      detalle: clientesArt.some(c => c.articulo_id === a.id) ? 'Asignado' : 'Sin cliente',
    },
    {
      clave: 'empaque', nombre: 'Norma de empaque oficial activa',
      ok: normas.some(n => n.articulo_id === a.id),
      detalle: normas.some(n => n.articulo_id === a.id) ? 'Norma oficial activa' : 'Sin norma oficial',
    },
    {
      clave: 'nivel', nombre: 'Nivel de ingenieria vigente',
      ok: !!nivelVig && !nivelVencido,
      detalle: !nivelVig ? 'Sin nivel vigente' : nivelVencido ? 'Nivel vencido' : 'Vigente',
    },
    {
      clave: 'ruta', nombre: 'Ruta de fabricacion' + (requiereMolde ? ' y molde' : ''),
      ok: rutas.some(r => r.articulo_id === a.id) && (!requiereMolde || cavidades.some(c => c.articulo_id === a.id)),
      detalle: !rutas.some(r => r.articulo_id === a.id) ? 'Sin ruta' : (requiereMolde && !cavidades.some(c => c.articulo_id === a.id)) ? 'Sin molde/cavidad' : 'Completa',
    },
  ]

  const faltantes = checks.filter(c => !c.ok)
  return { checks, completo: faltantes.length === 0, faltantes }
}

// Consulta unica de los catalogos que necesita el semaforo
export async function cargarDatosSemaforo(supabase, empresaId) {
  const [b, c, n, nv, r, cav, lib] = await Promise.all([
    supabase.from('bom').select('articulo_padre_id'),
    supabase.from('articulo_cliente').select('articulo_id').eq('activo', true),
    supabase.from('normas_empaque').select('articulo_id').eq('activa', true).eq('tipo', 'oficial'),
    supabase.from('niveles_ingenieria').select('articulo_id, estatus, vigente_hasta').eq('estatus', 'vigente'),
    supabase.from('rutas_fabricacion').select('articulo_id'),
    supabase.from('molde_cavidades').select('articulo_id').eq('activa', true),
    supabase.from('liberaciones_calidad').select('*'),
  ])
  return {
    bom: b.data || [], clientesArt: c.data || [], normas: n.data || [], niveles: nv.data || [],
    rutas: r.data || [], cavidades: cav.data || [], liberaciones: lib.data || [],
  }
}
