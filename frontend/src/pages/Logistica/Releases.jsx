import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Capa 2 - Customer Service: releases de clientes (firme/forecast) cargados via Excel.
// - Reemplazo POR ARTICULO + FECHA: solo las lineas incluidas en el archivo sustituyen
//   a la linea vigente de esa misma fecha; las fechas no incluidas siguen vigentes.
// - Al reemplazar una fecha, las entregas registradas se HEREDAN a la linea nueva:
//   CS captura la cantidad original del pedido y el sistema descuenta lo entregado.
// - Validaciones al cargar:
//   1) Fecha pasada SIN registro vigente previo -> se bloquea el articulo completo (corregir el archivo).
//   2) Fecha pasada CON registro pendiente/parcial (back order), decrementos y
//      cancelaciones/cierres -> requieren palomear y justificar en pantalla;
//      queda grabado en BD (releases_confirmaciones) para auditoria.
// - Solo se acepta UNA linea por codigo y fecha (candado tambien en BD).
// - Estatus por linea: cubierta / parcial / pendiente / vencida.

const fmtNum = (n) => (Number(n) || 0).toLocaleString('es-MX')
const fmtFecha = (f) => {
  if (!f) return '-'
  const [y, m, d] = f.split('-')
  return `${d}/${m}/${y}`
}
const hoy = () => new Date().toISOString().split('T')[0]

// Convierte celdas de Excel (serial, Date o texto) a 'YYYY-MM-DD'
const parseFecha = (v) => {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date && !isNaN(v)) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }
  const s = String(v).trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}

const parseTipo = (v) => {
  const s = String(v || '').trim().toLowerCase()
  if (!s) return 'firme'
  if (s.startsWith('firm') || s === 'f' || s.includes('firme')) return 'firme'
  if (s.startsWith('fore') || s === 'fc' || s.includes('pron')) return 'forecast'
  return null
}

const NOMBRE_ESTATUS = { cubierta: 'Cubierta', parcial: 'Parcial', pendiente: 'Pendiente', vencida: 'Vencida' }

export default function Releases() {
  const { perfil, tienePermiso } = useAuth()
  const puedeCargar = tienePermiso('cs_releases', 'crear')
  const puedeEntregar = tienePermiso('cs_releases', 'editar')

  const [vista, setVista] = useState('vigente')
  const [clientes, setClientes] = useState([])
  const [articulosCliente, setArticulosCliente] = useState([])
  const [vigentes, setVigentes] = useState([])
  const [entregas, setEntregas] = useState([])
  const [cargas, setCargas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  // Filtros de la vista de vigentes
  const [filtroCliente, setFiltroCliente] = useState('')
  const [filtroEstatus, setFiltroEstatus] = useState('pendientes')
  const [expandido, setExpandido] = useState(null)

  // Registro de entrega
  const [entregaForm, setEntregaForm] = useState(null) // { lineaId, cantidad, fecha, referencia }

  // Flujo de carga
  const [clienteId, setClienteId] = useState('')
  const [archivoNombre, setArchivoNombre] = useState('')
  const [notas, setNotas] = useState('')
  const [lineasNuevas, setLineasNuevas] = useState([])
  const [erroresArchivo, setErroresArchivo] = useState([])
  const [guardando, setGuardando] = useState(false)
  const [detalleDiff, setDetalleDiff] = useState(null)
  // Confirmaciones de hallazgos: { [articulo_id]: { acepta: bool, justificacion: '' } }
  const [confirmaciones, setConfirmaciones] = useState({})

  // Historial
  const [cargaExpandida, setCargaExpandida] = useState(null)
  const [lineasCarga, setLineasCarga] = useState([])
  const [confirmacionesCarga, setConfirmacionesCarga] = useState([])

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    const [c, ac, v, en, cg] = await Promise.all([
      supabase.from('clientes').select('id, clave, nombre').eq('activo', true).order('nombre'),
      supabase.from('articulo_cliente').select('id, articulo_id, cliente_id, codigo_cliente, articulo:articulos(id, codigo_interno, descripcion, unidad_medida)').eq('activo', true),
      supabase.from('release_lineas').select('*').eq('vigente', true).order('fecha_requerida'),
      supabase.from('release_entregas').select('*'),
      supabase.from('releases_cargas').select('*, cliente:clientes(nombre), usuario:usuarios!releases_cargas_cargado_por_fkey(nombre)').order('fecha_carga', { ascending: false }).limit(100),
    ])
    setClientes(c.data || [])
    setArticulosCliente(ac.data || [])
    setVigentes(v.data || [])
    setEntregas(en.data || [])
    setCargas(cg.data || [])
    setLoading(false)
  }

  const recargarEntregas = async () => {
    const { data } = await supabase.from('release_entregas').select('*')
    setEntregas(data || [])
  }

  const articuloDe = (articuloId) => articulosCliente.find(a => a.articulo_id === articuloId)?.articulo
  const entregadoDe = (lineaId) => entregas.filter(e => e.linea_id === lineaId).reduce((s, e) => s + Number(e.cantidad), 0)

  const estatusDe = (linea) => {
    const ent = entregadoDe(linea.id)
    const cant = Number(linea.cantidad)
    if (ent >= cant) return 'cubierta'
    if (linea.fecha_requerida < hoy()) return 'vencida'
    if (ent > 0) return 'parcial'
    return 'pendiente'
  }

  const badgeEstatus = (est) => est === 'cubierta' ? styles.badgeVerde : est === 'vencida' ? styles.badgeRojo : est === 'parcial' ? styles.badgeAzul : styles.badgeGris

  // ---------- Registro de entregas ----------
  const guardarEntrega = async () => {
    const cant = Number(entregaForm.cantidad)
    if (!(cant > 0)) { setError('La cantidad de la entrega debe ser mayor a 0'); return }
    if (!entregaForm.fecha) { setError('Captura la fecha de la entrega'); return }
    setError('')
    const { error: e1 } = await supabase.from('release_entregas').insert({
      linea_id: entregaForm.lineaId,
      cantidad: cant,
      fecha_entrega: entregaForm.fecha,
      referencia: entregaForm.referencia || null,
      registrado_por: perfil.id,
    })
    if (e1) { setError('Error al registrar la entrega: ' + e1.message); return }
    setEntregaForm(null)
    await recargarEntregas()
  }

  // ---------- Lectura del Excel ----------
  const leerArchivo = async (e) => {
    setError(''); setExito(''); setLineasNuevas([]); setErroresArchivo([]); setDetalleDiff(null); setConfirmaciones({})
    const file = e.target.files[0]
    if (!file) return
    if (!clienteId) { setError('Selecciona primero el cliente al que pertenece el release'); e.target.value = ''; return }
    setArchivoNombre(file.name)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })
      const hoja = wb.Sheets[wb.SheetNames[0]]
      const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '' })
      if (filas.length < 2) { setError('El archivo no tiene datos'); return }

      // Detectar fila de encabezados y columnas
      let idxHeader = -1, colParte = -1, colFecha = -1, colCant = -1, colTipo = -1
      for (let i = 0; i < Math.min(filas.length, 10); i++) {
        const celdas = filas[i].map(x => String(x).toLowerCase())
        const p = celdas.findIndex(x => x.includes('parte') || x.includes('codigo') || x.includes('part'))
        const f = celdas.findIndex(x => x.includes('fecha') || x.includes('date'))
        const q = celdas.findIndex(x => x.includes('cant') || x.includes('qty'))
        if (p >= 0 && f >= 0 && q >= 0) {
          idxHeader = i; colParte = p; colFecha = f; colCant = q
          colTipo = celdas.findIndex(x => x.includes('tipo') || x.includes('type'))
          break
        }
      }
      if (idxHeader < 0) {
        setError('No se encontraron los encabezados. El Excel debe tener columnas: Numero de Parte, Fecha Requerida, Cantidad y Tipo (firme/forecast)')
        return
      }

      const partesCliente = articulosCliente.filter(a => a.cliente_id === Number(clienteId))
      let lineas = []
      const errs = []
      for (let i = idxHeader + 1; i < filas.length; i++) {
        const fila = filas[i]
        const codigo = String(fila[colParte] || '').trim()
        if (!codigo) continue
        const numFila = i + 1
        const rel = partesCliente.find(p => String(p.codigo_cliente || '').trim().toLowerCase() === codigo.toLowerCase())
        if (!rel) { errs.push(`Fila ${numFila}: el numero de parte "${codigo}" no esta relacionado con este cliente (revisa la relacion articulo-cliente)`); continue }
        const fecha = parseFecha(fila[colFecha])
        if (!fecha) { errs.push(`Fila ${numFila}: fecha invalida "${fila[colFecha]}"`); continue }
        const cantidad = Number(fila[colCant])
        if (!(cantidad >= 0) || isNaN(cantidad)) { errs.push(`Fila ${numFila}: cantidad invalida "${fila[colCant]}"`); continue }
        const tipo = colTipo >= 0 ? parseTipo(fila[colTipo]) : 'firme'
        if (!tipo) { errs.push(`Fila ${numFila}: tipo invalido "${fila[colTipo]}" (usa firme o forecast)`); continue }
        lineas.push({ articulo_id: rel.articulo_id, codigo_cliente: rel.codigo_cliente, fecha_requerida: fecha, cantidad, tipo })
      }

      // Candado: solo UNA linea por codigo y fecha
      const conteo = {}
      lineas.forEach(l => { const k = `${l.articulo_id}|${l.fecha_requerida}`; conteo[k] = (conteo[k] || 0) + 1 })
      const duplicados = Object.keys(conteo).filter(k => conteo[k] > 1)
      if (duplicados.length > 0) {
        duplicados.forEach(k => {
          const [, f] = k.split('|')
          const l = lineas.find(x => `${x.articulo_id}|${x.fecha_requerida}` === k)
          errs.push(`El codigo "${l?.codigo_cliente}" aparece ${conteo[k]} veces con la fecha ${fmtFecha(f)}; deja una sola fila por codigo y fecha (se excluyeron todas)`)
        })
        lineas = lineas.filter(l => !duplicados.includes(`${l.articulo_id}|${l.fecha_requerida}`))
      }

      // Caso 1: fecha pasada SIN registro vigente previo -> se bloquea el ARTICULO completo
      const fechaHoy = hoy()
      const bloqueados = new Set()
      lineas.forEach(l => {
        if (l.fecha_requerida < fechaHoy) {
          const existe = vigentes.some(v => v.cliente_id === Number(clienteId) && v.articulo_id === l.articulo_id && v.fecha_requerida === l.fecha_requerida)
          if (!existe) {
            bloqueados.add(l.articulo_id)
            errs.push(`El codigo "${l.codigo_cliente}" trae la fecha vencida ${fmtFecha(l.fecha_requerida)} que NO existe como pendiente en el sistema. Se bloqueo el articulo completo: corrige la fecha o quita la fila del archivo`)
          }
        }
      })
      // No se acepta cantidad menor a lo ya entregado (excepto 0 = cancelacion):
      // desvirtuaria el historial de la orden
      lineas.forEach(l => {
        const existente = vigentes.find(v => v.cliente_id === Number(clienteId) && v.articulo_id === l.articulo_id && v.fecha_requerida === l.fecha_requerida)
        if (existente) {
          const ent = entregadoDe(existente.id)
          if (l.cantidad > 0 && l.cantidad < ent) {
            bloqueados.add(l.articulo_id)
            errs.push(`El codigo "${l.codigo_cliente}" en la fecha ${fmtFecha(l.fecha_requerida)} trae cantidad ${fmtNum(l.cantidad)}, MENOR a lo ya entregado (${fmtNum(ent)}). Usa ${fmtNum(ent)} para cerrar la fecha o 0 para cancelar. Se bloqueo el articulo completo`)
          }
        }
      })
      if (bloqueados.size > 0) lineas = lineas.filter(l => !bloqueados.has(l.articulo_id))

      setErroresArchivo(errs)
      if (lineas.length === 0) { setError('No se pudo leer ninguna linea valida del archivo'); return }
      setLineasNuevas(lineas)
    } catch (err) {
      setError('Error al leer el archivo: ' + err.message)
    }
    e.target.value = ''
  }

  // ---------- Comparativo incrementos / decrementos + hallazgos ----------
  const construirDiff = () => {
    const fechaHoy = hoy()
    const articuloIds = [...new Set(lineasNuevas.map(l => l.articulo_id))]
    return articuloIds.map(id => {
      const nuevas = lineasNuevas.filter(l => l.articulo_id === id)
      const fechasArchivo = nuevas.map(l => l.fecha_requerida)
      const vigentesArt = vigentes.filter(v => v.cliente_id === Number(clienteId) && v.articulo_id === id)
      const anteriores = vigentesArt.filter(v => fechasArchivo.includes(v.fecha_requerida))
      const intactas = vigentesArt.length - anteriores.length
      const totalNuevo = nuevas.reduce((s, l) => s + Number(l.cantidad), 0)
      const totalAnterior = anteriores.reduce((s, l) => s + Number(l.cantidad), 0)
      const hallazgos = []
      const detalle = fechasArchivo.sort().map(f => {
        const cn = nuevas.filter(l => l.fecha_requerida === f).reduce((s, l) => s + Number(l.cantidad), 0)
        const ant = anteriores.find(a => a.fecha_requerida === f)
        const ca = ant ? Number(ant.cantidad) : 0
        const entregado = ant ? entregadoDe(ant.id) : 0
        const tipos = [...new Set(nuevas.filter(l => l.fecha_requerida === f).map(l => l.tipo))].join(', ')
        if (ant) {
          const estabaCubierta = entregado >= ca && ca > 0
          if (cn === 0) {
            hallazgos.push(`Cancelacion de la fecha ${fmtFecha(f)} (tenia ${fmtNum(ca)}, entregado ${fmtNum(entregado)})`)
          } else if (cn === entregado) {
            hallazgos.push(`Cierre de la fecha ${fmtFecha(f)}: la nueva cantidad ${fmtNum(cn)} queda cubierta con lo ya entregado (${fmtNum(entregado)})`)
          } else if (estabaCubierta && cn > entregado) {
            hallazgos.push(`Reapertura de la fecha ${fmtFecha(f)} que ya estaba cubierta: entregado ${fmtNum(entregado)}, nueva cantidad ${fmtNum(cn)} (quedaran pendientes ${fmtNum(cn - entregado)})`)
          } else if (f < fechaHoy) {
            hallazgos.push(`Back order en fecha vencida ${fmtFecha(f)}: de ${fmtNum(ca)} a ${fmtNum(cn)}; entregado ${fmtNum(entregado)}, quedaran pendientes ${fmtNum(cn - entregado)}`)
          } else if (cn < ca) {
            hallazgos.push(`Decremento en ${fmtFecha(f)}: de ${fmtNum(ca)} a ${fmtNum(cn)}`)
          }
        }
        return { fecha: f, anterior: ca, nueva: cn, delta: cn - ca, entregado, tipos }
      })
      return { articulo_id: id, articulo: articuloDe(id), esNuevo: vigentesArt.length === 0, totalNuevo, totalAnterior, delta: totalNuevo - totalAnterior, detalle, intactas, hallazgos }
    }).sort((a, b) => (a.articulo?.codigo_interno || '').localeCompare(b.articulo?.codigo_interno || ''))
  }

  const diff = lineasNuevas.length > 0 ? construirDiff() : []
  const conHallazgos = diff.filter(d => d.hallazgos.length > 0)
  const faltanConfirmar = conHallazgos.filter(d => !(confirmaciones[d.articulo_id]?.acepta && (confirmaciones[d.articulo_id]?.justificacion || '').trim()))
  const puedeConfirmarCarga = lineasNuevas.length > 0 && faltanConfirmar.length === 0

  const setConfirmacion = (articuloId, campo, valor) => {
    setConfirmaciones(prev => ({ ...prev, [articuloId]: { acepta: false, justificacion: '', ...prev[articuloId], [campo]: valor } }))
  }

  // ---------- Confirmar y guardar ----------
  const confirmarCarga = async () => {
    if (!puedeConfirmarCarga) return
    setGuardando(true); setError('')
    try {
      const articuloIds = [...new Set(lineasNuevas.map(l => l.articulo_id))]
      const { data: carga, error: e1 } = await supabase.from('releases_cargas').insert({
        empresa_id: perfil.empresa_id,
        cliente_id: Number(clienteId),
        nombre_archivo: archivoNombre,
        notas: notas || null,
        cargado_por: perfil.id,
        total_lineas: lineasNuevas.length,
        articulos_incluidos: articuloIds.length,
      }).select().single()
      if (e1) throw e1

      // Guardar confirmaciones de hallazgos (trazabilidad de back orders / cancelaciones)
      if (conHallazgos.length > 0) {
        const filasConf = conHallazgos.map(d => ({
          carga_id: carga.id,
          articulo_id: d.articulo_id,
          hallazgos: d.hallazgos.join(' | '),
          justificacion: confirmaciones[d.articulo_id].justificacion.trim(),
          confirmado_por: perfil.id,
        }))
        const { error: eC } = await supabase.from('releases_confirmaciones').insert(filasConf)
        if (eC) throw eC
      }

      // Lineas vigentes actuales de los articulos del archivo (frescas de BD)
      const { data: actuales, error: e2 } = await supabase.from('release_lineas')
        .select('id, articulo_id, fecha_requerida')
        .eq('cliente_id', Number(clienteId)).eq('vigente', true).in('articulo_id', articuloIds)
      if (e2) throw e2

      // Solo se reemplazan las lineas cuyo articulo+fecha viene en el archivo
      const reemplazadas = (actuales || []).filter(a =>
        lineasNuevas.some(n => n.articulo_id === a.articulo_id && n.fecha_requerida === a.fecha_requerida))
      if (reemplazadas.length > 0) {
        const { error: e3 } = await supabase.from('release_lineas')
          .update({ vigente: false }).in('id', reemplazadas.map(r => r.id))
        if (e3) throw e3
      }

      // Insertar lineas nuevas (recuperando ids para heredar entregas)
      const filas = lineasNuevas.map(l => ({ ...l, carga_id: carga.id, cliente_id: Number(clienteId), vigente: true }))
      const insertadas = []
      for (let i = 0; i < filas.length; i += 500) {
        const { data, error: e4 } = await supabase.from('release_lineas')
          .insert(filas.slice(i, i + 500)).select('id, articulo_id, fecha_requerida')
        if (e4) throw e4
        insertadas.push(...(data || []))
      }

      // Heredar entregas de la linea reemplazada a la nueva (mismo articulo+fecha)
      for (const old of reemplazadas) {
        const nueva = insertadas.find(n => n.articulo_id === old.articulo_id && n.fecha_requerida === old.fecha_requerida)
        if (nueva) {
          const { error: e5 } = await supabase.from('release_entregas')
            .update({ linea_id: nueva.id }).eq('linea_id', old.id)
          if (e5) throw e5
        }
      }

      setExito(`Release cargado: ${lineasNuevas.length} lineas (${reemplazadas.length} reemplazadas con entregas heredadas, ${lineasNuevas.length - reemplazadas.length} nuevas${conHallazgos.length > 0 ? `, ${conHallazgos.length} articulo(s) con hallazgos confirmados` : ''})`)
      setLineasNuevas([]); setErroresArchivo([]); setArchivoNombre(''); setNotas(''); setDetalleDiff(null); setConfirmaciones({})
      await cargarDatos()
      setVista('vigente')
    } catch (err) {
      setError('Error al guardar: ' + err.message)
    }
    setGuardando(false)
  }

  const descargarPlantilla = () => {
    const wb = XLSX.utils.book_new()
    const datos = [
      ['Numero de Parte', 'Fecha Requerida', 'Cantidad', 'Tipo'],
      ['ABC-12345', '01/08/2026', 5000, 'firme'],
      ['ABC-12345', '15/08/2026', 3000, 'forecast'],
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(datos), 'Release')
    XLSX.writeFile(wb, 'plantilla_release.xlsx')
  }

  // ---------- Vista de vigentes: filtros, agrupacion y export ----------
  const lineasFiltradas = vigentes
    .filter(v => !filtroCliente || v.cliente_id === Number(filtroCliente))
    .map(v => ({ ...v, entregado: entregadoDe(v.id), estatus: estatusDe(v) }))
    .filter(v => filtroEstatus === 'todas' || v.estatus !== 'cubierta')

  const grupos = []
  lineasFiltradas.forEach(v => {
    let g = grupos.find(x => x.cliente_id === v.cliente_id && x.articulo_id === v.articulo_id)
    if (!g) {
      g = { cliente_id: v.cliente_id, articulo_id: v.articulo_id, codigo_cliente: v.codigo_cliente, firme: 0, forecast: 0, pendiente: 0, lineas: [] }
      grupos.push(g)
    }
    g[v.tipo] += Number(v.cantidad)
    g.pendiente += Math.max(0, Number(v.cantidad) - v.entregado)
    g.lineas.push(v)
  })
  grupos.forEach(g => {
    g.estatus = g.lineas.some(l => l.estatus === 'vencida') ? 'vencida'
      : g.lineas.some(l => l.estatus === 'parcial') ? 'parcial'
      : g.lineas.some(l => l.estatus === 'pendiente') ? 'pendiente' : 'cubierta'
    g.proxima = (g.lineas.find(l => l.estatus !== 'cubierta') || g.lineas[0])?.fecha_requerida
  })
  grupos.sort((a, b) => (articuloDe(a.articulo_id)?.codigo_interno || '').localeCompare(articuloDe(b.articulo_id)?.codigo_interno || ''))

  const exportarVigente = () => {
    const filas = lineasFiltradas.map(v => {
      const art = articuloDe(v.articulo_id)
      return {
        Cliente: clientes.find(c => c.id === v.cliente_id)?.nombre || v.cliente_id,
        'Codigo interno': art?.codigo_interno || '',
        Descripcion: art?.descripcion || '',
        'Parte cliente': v.codigo_cliente || '',
        'Fecha requerida': fmtFecha(v.fecha_requerida),
        Cantidad: Number(v.cantidad),
        Entregado: v.entregado,
        Pendiente: Math.max(0, Number(v.cantidad) - v.entregado),
        Tipo: v.tipo,
        Estatus: NOMBRE_ESTATUS[v.estatus],
      }
    })
    const wb = XLSX.utils.book_new()
    const sufijo = filtroEstatus === 'todas' ? 'todas' : 'pendientes'
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), 'Release vigente')
    XLSX.writeFile(wb, `release_${sufijo}_${hoy()}.xlsx`)
  }

  const verLineasCarga = async (cargaId) => {
    if (cargaExpandida === cargaId) { setCargaExpandida(null); setLineasCarga([]); setConfirmacionesCarga([]); return }
    const [l, cf] = await Promise.all([
      supabase.from('release_lineas').select('*').eq('carga_id', cargaId).order('fecha_requerida'),
      supabase.from('releases_confirmaciones').select('*, usuario:usuarios!releases_confirmaciones_confirmado_por_fkey(nombre)').eq('carga_id', cargaId),
    ])
    setLineasCarga(l.data || [])
    setConfirmacionesCarga(cf.data || [])
    setCargaExpandida(cargaId)
  }

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando releases...</p>

  return (
    <div style={styles.container} className="aparecer">
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Releases de Clientes</h2>
        <div style={{ display: 'flex', gap: '10px' }}>
          {vista === 'vigente' && grupos.length > 0 && (
            <button style={styles.botonSec} onClick={exportarVigente}>
              Exportar Excel ({filtroEstatus === 'todas' ? 'todas' : 'pendientes'})
            </button>
          )}
          {puedeCargar && (
            <button style={styles.boton} onClick={() => { setVista(vista === 'cargar' ? 'vigente' : 'cargar'); setError(''); setExito('') }}>
              {vista === 'cargar' ? 'Ver release vigente' : '+ Cargar release'}
            </button>
          )}
        </div>
      </div>

      <div style={styles.tabs}>
        {[['vigente', 'Release vigente'], ['historial', 'Historial de cargas']].map(([id, nombre]) => (
          <button key={id} style={vista === id ? styles.tabActiva : styles.tab} onClick={() => setVista(id)}>{nombre}</button>
        ))}
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {/* ==================== CARGAR ==================== */}
      {vista === 'cargar' && puedeCargar && (
        <div style={styles.form}>
          <h3 style={styles.formTitulo}>Cargar release desde Excel</h3>
          <p style={styles.ayuda}>
            El Excel debe tener columnas: <b>Numero de Parte</b> (del cliente), <b>Fecha Requerida</b>, <b>Cantidad</b> y <b>Tipo</b> (firme/forecast; si falta, se asume firme).
            <br />Solo se reemplazan las lineas de <b>articulo + fecha</b> incluidas en el archivo (con la <b>cantidad original</b>: lo entregado se hereda y se descuenta).
            Las fechas no incluidas siguen vigentes. Para cancelar o cerrar una fecha vencida, incluyela con cantidad 0 o con lo ya entregado (pedira justificacion).
            Una fila por codigo y fecha; fechas vencidas nuevas no se aceptan.
            {' '}<button style={styles.link} onClick={descargarPlantilla}>Descargar plantilla</button>
          </p>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Cliente *</label>
              <select style={styles.input} value={clienteId} onChange={e => { setClienteId(e.target.value); setLineasNuevas([]); setErroresArchivo([]); setConfirmaciones({}) }}>
                <option value="">Selecciona cliente...</option>
                {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Archivo Excel *</label>
              <input type="file" accept=".xlsx,.xls,.csv" style={styles.input} onChange={leerArchivo} />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Notas</label>
              <input style={styles.input} value={notas} onChange={e => setNotas(e.target.value)} placeholder="Ej. release semana 32" />
            </div>
          </div>

          {erroresArchivo.length > 0 && (
            <div style={styles.cajaErrores}>
              <p style={{ margin: '0 0 6px 0', fontWeight: '600', fontSize: '13px' }}>{erroresArchivo.length} problema(s) encontrados (esas filas/articulos no se cargaran):</p>
              {erroresArchivo.slice(0, 15).map((e, i) => <p key={i} style={{ margin: '2px 0', fontSize: '12px' }}>{e}</p>)}
              {erroresArchivo.length > 15 && <p style={{ margin: '2px 0', fontSize: '12px' }}>... y {erroresArchivo.length - 15} mas</p>}
            </div>
          )}

          {/* Comparativo antes de confirmar */}
          {diff.length > 0 && (
            <>
              <h3 style={{ ...styles.formTitulo, marginTop: '20px' }}>Analisis de cambios (solo fechas incluidas en el archivo)</h3>
              {conHallazgos.length > 0 && (
                <p style={{ ...styles.ayuda, color: '#92400e' }}>
                  {conHallazgos.length} articulo(s) tienen hallazgos (back order, decremento, cancelacion o cierre): revisa, palomea y justifica cada uno para habilitar la carga.
                </p>
              )}
              <div style={styles.tabla}>
                <div style={styles.tablaHeader}>
                  <span style={{ flex: 2.5 }}>Articulo</span>
                  <span style={{ flex: 1, textAlign: 'right' }}>Total anterior</span>
                  <span style={{ flex: 1, textAlign: 'right' }}>Total nuevo</span>
                  <span style={{ flex: 1, textAlign: 'right' }}>Diferencia</span>
                  <span style={{ flex: 1, textAlign: 'center' }}>Estado</span>
                  <span style={{ width: '90px' }}></span>
                </div>
                {diff.map(d => (
                  <div key={d.articulo_id}>
                    <div style={styles.tablaFila} className="fila-hover">
                      <span style={{ flex: 2.5 }}>
                        <b>{d.articulo?.codigo_interno}</b>
                        <span style={{ color: '#64748b', fontSize: '13px' }}> - {d.articulo?.descripcion}</span>
                        {d.intactas > 0 && <span style={{ ...styles.badge, ...styles.badgeGris, marginLeft: '8px' }}>{d.intactas} fecha(s) previas se conservan</span>}
                      </span>
                      <span style={{ flex: 1, textAlign: 'right' }}>{fmtNum(d.totalAnterior)}</span>
                      <span style={{ flex: 1, textAlign: 'right' }}>{fmtNum(d.totalNuevo)}</span>
                      <span style={{ flex: 1, textAlign: 'right', fontWeight: '600', color: d.delta > 0 ? '#16a34a' : d.delta < 0 ? '#dc2626' : '#64748b' }}>
                        {d.delta > 0 ? '+' : ''}{fmtNum(d.delta)}
                      </span>
                      <span style={{ flex: 1, textAlign: 'center' }}>
                        <span style={{ ...styles.badge, ...(d.esNuevo ? styles.badgeAzul : d.delta > 0 ? styles.badgeVerde : d.delta < 0 ? styles.badgeRojo : styles.badgeGris) }}>
                          {d.esNuevo ? 'Nuevo' : d.delta > 0 ? 'Incremento' : d.delta < 0 ? 'Decremento' : 'Sin cambio'}
                        </span>
                      </span>
                      <span style={{ width: '90px', textAlign: 'right' }}>
                        <button style={styles.botonAccion} onClick={() => setDetalleDiff(detalleDiff === d.articulo_id ? null : d.articulo_id)}>
                          {detalleDiff === d.articulo_id ? 'Ocultar' : 'Detalle'}
                        </button>
                      </span>
                    </div>

                    {/* Hallazgos que requieren confirmacion y justificacion */}
                    {d.hallazgos.length > 0 && (
                      <div style={styles.cajaHallazgos}>
                        {d.hallazgos.map((h, i) => <p key={i} style={{ margin: '2px 0', fontSize: '12px' }}>&#9888; {h}</p>)}
                        <div style={{ display: 'flex', gap: '14px', alignItems: 'center', marginTop: '8px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            <input type="checkbox" checked={confirmaciones[d.articulo_id]?.acepta || false}
                              onChange={e => setConfirmacion(d.articulo_id, 'acepta', e.target.checked)} />
                            Revisado y confirmado
                          </label>
                          <input style={{ ...styles.input, flex: 1 }} placeholder="Justificacion (obligatoria): ej. cliente ajusto por atraso de produccion"
                            value={confirmaciones[d.articulo_id]?.justificacion || ''}
                            onChange={e => setConfirmacion(d.articulo_id, 'justificacion', e.target.value)} />
                        </div>
                      </div>
                    )}

                    {detalleDiff === d.articulo_id && (
                      <div style={styles.subTabla}>
                        <div style={{ ...styles.tablaHeader, backgroundColor: '#fff' }}>
                          <span style={{ flex: 1 }}>Fecha</span>
                          <span style={{ flex: 1, textAlign: 'right' }}>Anterior</span>
                          <span style={{ flex: 1, textAlign: 'right' }}>Nueva</span>
                          <span style={{ flex: 1, textAlign: 'right' }}>Delta</span>
                          <span style={{ flex: 1, textAlign: 'right' }}>Entregado (se hereda)</span>
                          <span style={{ flex: 0.8, textAlign: 'center' }}>Tipo</span>
                        </div>
                        {d.detalle.map(l => (
                          <div key={l.fecha} style={{ ...styles.tablaFila, padding: '8px 20px', fontSize: '13px' }}>
                            <span style={{ flex: 1 }}>{fmtFecha(l.fecha)}</span>
                            <span style={{ flex: 1, textAlign: 'right' }}>{fmtNum(l.anterior)}</span>
                            <span style={{ flex: 1, textAlign: 'right' }}>{fmtNum(l.nueva)}</span>
                            <span style={{ flex: 1, textAlign: 'right', color: l.delta > 0 ? '#16a34a' : l.delta < 0 ? '#dc2626' : '#64748b' }}>
                              {l.delta > 0 ? '+' : ''}{fmtNum(l.delta)}
                            </span>
                            <span style={{ flex: 1, textAlign: 'right', color: '#16a34a' }}>{fmtNum(l.entregado)}</span>
                            <span style={{ flex: 0.8, textAlign: 'center', color: '#64748b' }}>{l.tipos}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ ...styles.botones, marginTop: '16px', alignItems: 'center' }}>
                {!puedeConfirmarCarga && faltanConfirmar.length > 0 && (
                  <span style={{ fontSize: '12px', color: '#92400e', marginRight: 'auto' }}>
                    Falta confirmar y justificar {faltanConfirmar.length} articulo(s) con hallazgos
                  </span>
                )}
                <button style={styles.botonSec} onClick={() => { setLineasNuevas([]); setErroresArchivo([]); setArchivoNombre(''); setConfirmaciones({}) }} disabled={guardando}>Cancelar</button>
                <button style={{ ...styles.boton, opacity: puedeConfirmarCarga && !guardando ? 1 : 0.5, cursor: puedeConfirmarCarga && !guardando ? 'pointer' : 'not-allowed' }}
                  onClick={confirmarCarga} disabled={!puedeConfirmarCarga || guardando}>
                  {guardando ? 'Guardando...' : `Confirmar (${lineasNuevas.length} lineas)`}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ==================== VIGENTE ==================== */}
      {vista === 'vigente' && (
        <>
          <div style={styles.selectorBox}>
            <label style={{ ...styles.label, marginRight: '10px' }}>Cliente:</label>
            <select style={styles.input} value={filtroCliente} onChange={e => setFiltroCliente(e.target.value)}>
              <option value="">Todos</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <label style={{ ...styles.label, margin: '0 10px 0 20px' }}>Ver:</label>
            <select style={styles.input} value={filtroEstatus} onChange={e => setFiltroEstatus(e.target.value)}>
              <option value="pendientes">Solo pendientes, parciales y vencidas</option>
              <option value="todas">Todas (incluye cubiertas)</option>
            </select>
          </div>
          {grupos.length === 0 ? (
            <p style={{ color: '#666', padding: '10px 4px' }}>
              {filtroEstatus === 'pendientes' ? 'No hay lineas pendientes con este filtro. Cambia a "Todas" para ver las cubiertas.' : 'No hay release vigente. Usa "+ Cargar release" para subir el primero.'}
            </p>
          ) : (
            <div style={styles.tabla}>
              <div style={styles.tablaHeader}>
                <span style={{ flex: 2.3 }}>Articulo</span>
                <span style={{ flex: 1 }}>Parte cliente</span>
                <span style={{ flex: 1 }}>Cliente</span>
                <span style={{ flex: 0.8, textAlign: 'right' }}>Firme</span>
                <span style={{ flex: 0.8, textAlign: 'right' }}>Forecast</span>
                <span style={{ flex: 0.8, textAlign: 'right' }}>Pendiente</span>
                <span style={{ flex: 0.9, textAlign: 'center' }}>Proxima</span>
                <span style={{ flex: 0.9, textAlign: 'center' }}>Estatus</span>
                <span style={{ width: '80px' }}></span>
              </div>
              {grupos.map(g => {
                const art = articuloDe(g.articulo_id)
                const clave = `${g.cliente_id}-${g.articulo_id}`
                return (
                  <div key={clave}>
                    <div style={styles.tablaFila} className="fila-hover">
                      <span style={{ flex: 2.3 }}>
                        <b>{art?.codigo_interno}</b>
                        <span style={{ color: '#64748b', fontSize: '13px' }}> - {art?.descripcion}</span>
                      </span>
                      <span style={{ flex: 1, color: '#64748b' }}>{g.codigo_cliente}</span>
                      <span style={{ flex: 1 }}>{clientes.find(c => c.id === g.cliente_id)?.nombre}</span>
                      <span style={{ flex: 0.8, textAlign: 'right', fontWeight: '600' }}>{fmtNum(g.firme)}</span>
                      <span style={{ flex: 0.8, textAlign: 'right', color: '#64748b' }}>{fmtNum(g.forecast)}</span>
                      <span style={{ flex: 0.8, textAlign: 'right', fontWeight: '600', color: g.pendiente > 0 ? '#b45309' : '#16a34a' }}>{fmtNum(g.pendiente)}</span>
                      <span style={{ flex: 0.9, textAlign: 'center' }}>{fmtFecha(g.proxima)}</span>
                      <span style={{ flex: 0.9, textAlign: 'center' }}>
                        <span style={{ ...styles.badge, ...badgeEstatus(g.estatus) }}>{NOMBRE_ESTATUS[g.estatus]}</span>
                      </span>
                      <span style={{ width: '80px', textAlign: 'right' }}>
                        <button style={styles.botonAccion} onClick={() => setExpandido(expandido === clave ? null : clave)}>
                          {expandido === clave ? 'Ocultar' : 'Detalle'}
                        </button>
                      </span>
                    </div>
                    {expandido === clave && (
                      <div style={styles.subTabla}>
                        <div style={{ ...styles.tablaHeader, backgroundColor: '#fff' }}>
                          <span style={{ flex: 1 }}>Fecha</span>
                          <span style={{ flex: 1, textAlign: 'right' }}>Cantidad</span>
                          <span style={{ flex: 1, textAlign: 'right' }}>Entregado</span>
                          <span style={{ flex: 1, textAlign: 'right' }}>Pendiente</span>
                          <span style={{ flex: 0.8, textAlign: 'center' }}>Tipo</span>
                          <span style={{ flex: 1, textAlign: 'center' }}>Estatus</span>
                          <span style={{ width: '95px' }}></span>
                        </div>
                        {g.lineas.map(l => (
                          <div key={l.id}>
                            <div style={{ ...styles.tablaFila, padding: '7px 20px', fontSize: '13px' }}>
                              <span style={{ flex: 1 }}>{fmtFecha(l.fecha_requerida)}</span>
                              <span style={{ flex: 1, textAlign: 'right' }}>{fmtNum(l.cantidad)} {art?.unidad_medida || 'pzas'}</span>
                              <span style={{ flex: 1, textAlign: 'right', color: '#16a34a' }}>{fmtNum(l.entregado)}</span>
                              <span style={{ flex: 1, textAlign: 'right', fontWeight: '600' }}>{fmtNum(Math.max(0, Number(l.cantidad) - l.entregado))}</span>
                              <span style={{ flex: 0.8, textAlign: 'center' }}>
                                <span style={{ ...styles.badge, ...(l.tipo === 'firme' ? styles.badgeVerde : styles.badgeGris) }}>{l.tipo}</span>
                              </span>
                              <span style={{ flex: 1, textAlign: 'center' }}>
                                <span style={{ ...styles.badge, ...badgeEstatus(l.estatus) }}>{NOMBRE_ESTATUS[l.estatus]}</span>
                              </span>
                              <span style={{ width: '95px', textAlign: 'right' }}>
                                {puedeEntregar && l.estatus !== 'cubierta' && (
                                  <button style={styles.botonAccion} onClick={() => setEntregaForm({ lineaId: l.id, cantidad: '', fecha: hoy(), referencia: '' })}>+ Entrega</button>
                                )}
                              </span>
                            </div>
                            {entregaForm?.lineaId === l.id && (
                              <div style={styles.formEntrega}>
                                <div style={{ ...styles.campo, flex: 0.8 }}>
                                  <label style={styles.label}>Cantidad entregada *</label>
                                  <input type="number" min="1" style={styles.input} value={entregaForm.cantidad}
                                    onChange={e => setEntregaForm({ ...entregaForm, cantidad: e.target.value })} autoFocus />
                                </div>
                                <div style={{ ...styles.campo, flex: 0.8 }}>
                                  <label style={styles.label}>Fecha de entrega *</label>
                                  <input type="date" style={styles.input} value={entregaForm.fecha}
                                    onChange={e => setEntregaForm({ ...entregaForm, fecha: e.target.value })} />
                                </div>
                                <div style={{ ...styles.campo, flex: 1.2 }}>
                                  <label style={styles.label}>Referencia (embarque, factura, etc.)</label>
                                  <input style={styles.input} value={entregaForm.referencia}
                                    onChange={e => setEntregaForm({ ...entregaForm, referencia: e.target.value })} placeholder="Opcional" />
                                </div>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', paddingBottom: '1px' }}>
                                  <button style={styles.botonSec} onClick={() => setEntregaForm(null)}>Cancelar</button>
                                  <button style={styles.boton} onClick={guardarEntrega}>Registrar</button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ==================== HISTORIAL ==================== */}
      {vista === 'historial' && (
        cargas.length === 0 ? (
          <p style={{ color: '#666', padding: '10px 4px' }}>Aun no se ha cargado ningun release.</p>
        ) : (
          <div style={styles.tabla}>
            <div style={styles.tablaHeader}>
              <span style={{ flex: 1.3 }}>Fecha de carga</span>
              <span style={{ flex: 1.3 }}>Cliente</span>
              <span style={{ flex: 1.8 }}>Archivo</span>
              <span style={{ flex: 0.8, textAlign: 'right' }}>Lineas</span>
              <span style={{ flex: 0.8, textAlign: 'right' }}>Articulos</span>
              <span style={{ flex: 1.2 }}>Cargado por</span>
              <span style={{ width: '90px' }}></span>
            </div>
            {cargas.map(cg => (
              <div key={cg.id}>
                <div style={styles.tablaFila} className="fila-hover">
                  <span style={{ flex: 1.3 }}>{new Date(cg.fecha_carga).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}</span>
                  <span style={{ flex: 1.3 }}>{cg.cliente?.nombre}</span>
                  <span style={{ flex: 1.8, color: '#64748b', fontSize: '13px' }}>{cg.nombre_archivo}{cg.notas ? ` - ${cg.notas}` : ''}</span>
                  <span style={{ flex: 0.8, textAlign: 'right' }}>{cg.total_lineas}</span>
                  <span style={{ flex: 0.8, textAlign: 'right' }}>{cg.articulos_incluidos}</span>
                  <span style={{ flex: 1.2, color: '#64748b', fontSize: '13px' }}>{cg.usuario?.nombre}</span>
                  <span style={{ width: '90px', textAlign: 'right' }}>
                    <button style={styles.botonAccion} onClick={() => verLineasCarga(cg.id)}>
                      {cargaExpandida === cg.id ? 'Ocultar' : 'Detalle'}
                    </button>
                  </span>
                </div>
                {cargaExpandida === cg.id && (
                  <div style={styles.subTabla}>
                    {confirmacionesCarga.length > 0 && (
                      <div style={{ ...styles.cajaHallazgos, margin: '8px 20px' }}>
                        <p style={{ margin: '0 0 4px 0', fontWeight: '600', fontSize: '12px' }}>Hallazgos confirmados en esta carga:</p>
                        {confirmacionesCarga.map(cf => (
                          <p key={cf.id} style={{ margin: '2px 0', fontSize: '12px' }}>
                            <b>{articuloDe(cf.articulo_id)?.codigo_interno}</b>: {cf.hallazgos}
                            <br />Justificacion: "{cf.justificacion}" - {cf.usuario?.nombre}, {new Date(cf.created_at).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}
                          </p>
                        ))}
                      </div>
                    )}
                    {lineasCarga.map(l => {
                      const art = articuloDe(l.articulo_id)
                      return (
                        <div key={l.id} style={{ ...styles.tablaFila, padding: '7px 20px', fontSize: '13px' }}>
                          <span style={{ flex: 2 }}><b>{art?.codigo_interno}</b> <span style={{ color: '#94a3b8' }}>({l.codigo_cliente})</span></span>
                          <span style={{ flex: 1 }}>{fmtFecha(l.fecha_requerida)}</span>
                          <span style={{ flex: 1, textAlign: 'right' }}>{fmtNum(l.cantidad)}</span>
                          <span style={{ flex: 1, textAlign: 'center' }}>
                            <span style={{ ...styles.badge, ...(l.tipo === 'firme' ? styles.badgeVerde : styles.badgeGris) }}>{l.tipo}</span>
                          </span>
                          <span style={{ flex: 1, textAlign: 'center', color: l.vigente ? '#16a34a' : '#94a3b8', fontSize: '12px' }}>
                            {l.vigente ? 'vigente' : 'reemplazada'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}

const styles = {
  container: { padding: '28px' },
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0' },
  tabs: { display: 'flex', gap: '4px', marginBottom: '16px', borderBottom: '1px solid #e2e8f0' },
  tab: { padding: '8px 16px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#64748b', cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabActiva: { padding: '8px 16px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#2563eb', fontWeight: '600', cursor: 'pointer', borderBottom: '2px solid #2563eb' },
  selectorBox: { backgroundColor: '#fff', borderRadius: '10px', padding: '14px 20px', marginBottom: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center' },
  form: { backgroundColor: '#fff', borderRadius: '10px', padding: '24px', marginBottom: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  formTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 10px 0' },
  formEntrega: { display: 'flex', gap: '12px', padding: '12px 20px', backgroundColor: '#eff6ff', borderBottom: '1px solid #dbeafe', alignItems: 'flex-end' },
  ayuda: { fontSize: '13px', color: '#64748b', margin: '0 0 16px 0', lineHeight: '1.5' },
  link: { border: 'none', background: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '13px', padding: 0, textDecoration: 'underline' },
  fila: { display: 'flex', gap: '16px', marginBottom: '16px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', fontFamily: 'inherit', backgroundColor: '#fff' },
  botones: { display: 'flex', justifyContent: 'flex-end', gap: '10px' },
  boton: { padding: '9px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSec: { padding: '9px 20px', backgroundColor: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '12px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  subTabla: { backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', padding: '4px 0' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '600' },
  badgeVerde: { backgroundColor: '#dcfce7', color: '#16a34a' },
  badgeRojo: { backgroundColor: '#fee2e2', color: '#dc2626' },
  badgeAzul: { backgroundColor: '#dbeafe', color: '#2563eb' },
  badgeGris: { backgroundColor: '#f1f5f9', color: '#64748b' },
  cajaErrores: { backgroundColor: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '8px', padding: '12px 16px', color: '#92400e', marginBottom: '12px' },
  cajaHallazgos: { backgroundColor: '#fffbeb', borderTop: '1px solid #fcd34d', borderBottom: '1px solid #fcd34d', padding: '10px 20px', color: '#92400e' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
