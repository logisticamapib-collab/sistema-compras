import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import FiltroSite from '../../components/FiltroSite'
import { siteEfectivo } from '../../lib/sites'
import { asegurarCajas } from '../../lib/contenedores'
import { datosEtiqueta } from '../../lib/etiquetas'
import EtiquetaProducto from '../../components/EtiquetaProducto'
import PortalImpresion from '../../components/PortalImpresion'
import { imprimirAislado } from '../../lib/impresion'

// Capa 3 - Inventario por LOTE con trazabilidad y estatus de calidad.
// - Existencias = cantidad de un lote en un almacen/ubicacion.
// - Traspasos respetan el FLUJO del articulo (candado estricto); un rol autorizado
//   puede forzar un movimiento fuera de flujo dejando justificacion (queda en bitacora).
// - El estatus de calidad vive en el LOTE (retenido/liberado/rechazado), no en la ubicacion.
// - Un paso marcado "Libera Calidad" exige que el lote este liberado para poder salir de el.

const fmtNum = (n) => (Number(n) || 0).toLocaleString('es-MX')
const fmtFechaHora = (f) => new Date(f).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })

const NOMBRE_CALIDAD = { retenido: 'Retenido', liberado: 'Liberado', rechazado: 'Rechazado' }
const NOMBRE_MOV = {
  entrada_inicial: 'Entrada inicial', ajuste_positivo: 'Ajuste (+)', ajuste_negativo: 'Ajuste (-)',
  traspaso: 'Traspaso', liberacion_calidad: 'Liberacion calidad', rechazo_calidad: 'Rechazo calidad',
}

export default function Inventario() {
  const { perfil, tienePermiso } = useAuth()
  const puedeMover = tienePermiso('log_inventario', 'crear')
  const puedeForzar = tienePermiso('log_inventario', 'editar')
  const puedeLiberar = tienePermiso('log_inventario', 'aprobar')

  const [vista, setVista] = useState('existencias')
  const [site, setSite] = useState('')
  const [articulos, setArticulos] = useState([])
  const [almacenes, setAlmacenes] = useState([])
  const [ubicaciones, setUbicaciones] = useState([])
  const [pasos, setPasos] = useState([])
  const [lotes, setLotes] = useState([])
  const [existencias, setExistencias] = useState([])
  const [contenedores, setContenedores] = useState([])
  const [etq, setEtq] = useState(null)   // { cajas, articulo, lote, empresa }
  const [movimientos, setMovimientos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  const [filtroAlmacen, setFiltroAlmacen] = useState('')
  const [filtroTexto, setFiltroTexto] = useState('')
  // Filtros de la bitacora / kardex
  const [movArticulo, setMovArticulo] = useState('') // id de articulo (kardex con saldo)
  const [movTexto, setMovTexto] = useState('')
  const [movTipo, setMovTipo] = useState('')
  const [movAlmacen, setMovAlmacen] = useState('')
  const [movSoloFuera, setMovSoloFuera] = useState(false)

  const [traspaso, setTraspaso] = useState(null) // { ex, almacen_destino_id, ubicacion_destino_id, cantidad, fuera_flujo, justificacion }
  const [ajuste, setAjuste] = useState(null) // { ex, signo, cantidad, motivo }
  const [entrada, setEntrada] = useState(null) // nueva entrada manual
  const [preview, setPreview] = useState(null)
  const [procesando, setProcesando] = useState(false)

  useEffect(() => { cargarDatos() }, [site])

  const cargarDatos = async () => {
    const sid = siteEfectivo(perfil, site)
    setLoading(true)
    const [art, alm, ubi, ps, lot, ex, mov, ct] = await Promise.all([
      supabase.from('articulos').select('id, codigo_interno, descripcion, unidad_medida, flujo_id, origen').eq('empresa_id', perfil.empresa_id).eq('activo', true).order('codigo_interno'),
      supabase.from('almacenes').select('*').eq('activo', true).order('clave'),
      supabase.from('ubicaciones').select('*').eq('activo', true).order('clave'),
      supabase.from('flujo_pasos').select('*').order('secuencia'),
      supabase.from('lotes').select('*, liberador:usuarios!lotes_liberado_por_fkey(nombre)'),
      supabase.from('existencias').select('*'),
      supabase.from('contenedores').select('id, folio, tipo, lote_id, almacen_id, ubicacion_id, cantidad, padre_id').eq('empresa_id', perfil.empresa_id).eq('estatus', 'activo'),
      supabase.from('movimientos').select('*, usuario:usuarios!movimientos_usuario_id_fkey(nombre)').order('fecha', { ascending: false }).limit(200),
    ])
    setArticulos(art.data || [])
    setAlmacenes(alm.data || [])
    setUbicaciones(ubi.data || [])
    setPasos(ps.data || [])
    setLotes(lot.data || [])
    setExistencias(((ex.data) || []).filter(x => { if (!sid) return true; const _a = (alm.data || []).find(z => z.id === x.almacen_id); return _a && _a.site_id === sid }))
    setContenedores(ct.data || [])
    setMovimientos(mov.data || [])
    setLoading(false)
  }

  const artDe = (id) => articulos.find(a => a.id === id)
  const almDe = (id) => almacenes.find(a => a.id === id)
  const ubiDe = (id) => ubicaciones.find(u => u.id === id)
  const loteDe = (id) => lotes.find(l => l.id === id)
  const ubisDe = (almacenId) => ubicaciones.filter(u => u.almacen_id === almacenId)

  // Pasos del flujo de un articulo, ordenados
  const pasosDeArticulo = (articuloId) => {
    const art = artDe(articuloId)
    if (!art?.flujo_id) return []
    return pasos.filter(p => p.flujo_id === art.flujo_id)
  }
  // Siguiente almacen permitido tras el almacen origen (segun flujo)
  const siguientePaso = (articuloId, almacenOrigenId) => {
    const ps = pasosDeArticulo(articuloId)
    const idx = ps.findIndex(p => p.almacen_id === almacenOrigenId)
    if (idx < 0) return null
    return { actual: ps[idx], siguiente: ps[idx + 1] || null }
  }

  // ---------- Traspaso ----------
  const abrirTraspaso = (ex) => {
    setError(''); setExito('')
    setTraspaso({ ex, almacen_destino_id: '', ubicacion_destino_id: '', cantidad: '', fuera_flujo: false, justificacion: '' })
  }

  const destinosTraspaso = () => {
    if (!traspaso) return []
    const { ex } = traspaso
    const art = artDe(ex._articuloId)
    if (traspaso.fuera_flujo) {
      // Cualquier almacen del mismo site (excepto el origen)
      const site = almDe(ex.almacen_id)?.site_id
      return almacenes.filter(a => a.site_id === site && a.id !== ex.almacen_id)
    }
    if (!art?.flujo_id) return [] // sin flujo: obliga a usar fuera de flujo
    const sp = siguientePaso(ex._articuloId, ex.almacen_id)
    if (!sp?.siguiente) return []
    const alm = almDe(sp.siguiente.almacen_id)
    return alm ? [alm] : []
  }

  const guardarTraspaso = async () => {
    const { ex } = traspaso
    const cant = Number(traspaso.cantidad)
    setError('')
    if (!(cant > 0)) { setError('La cantidad debe ser mayor a 0'); return }
    if (cant > Number(ex.cantidad)) { setError(`No hay suficiente: disponible ${fmtNum(ex.cantidad)}`); return }
    if (!traspaso.almacen_destino_id) { setError('Selecciona el almacen destino'); return }
    if (traspaso.fuera_flujo && !traspaso.justificacion.trim()) { setError('El movimiento fuera de flujo requiere justificacion'); return }

    // Candado de liberacion de calidad al salir de un paso marcado
    const sp = siguientePaso(ex._articuloId, ex.almacen_id)
    const lote = loteDe(ex.lote_id)
    if (!traspaso.fuera_flujo && sp?.actual?.requiere_liberacion && lote.estatus_calidad !== 'liberado') {
      setError('Este paso exige liberacion de Calidad: el lote no esta liberado, no puede avanzar')
      return
    }
    if (lote.estatus_calidad === 'rechazado' && !traspaso.fuera_flujo) {
      setError('El lote esta rechazado: solo puede moverse con un movimiento fuera de flujo justificado')
      return
    }

    setProcesando(true)
    try {
      const destAlm = Number(traspaso.almacen_destino_id)
      const destUbi = traspaso.ubicacion_destino_id ? Number(traspaso.ubicacion_destino_id) : null
      // Descontar del origen
      const nuevaOrigen = Number(ex.cantidad) - cant
      if (nuevaOrigen === 0) {
        await supabase.from('existencias').delete().eq('id', ex.id)
      } else {
        await supabase.from('existencias').update({ cantidad: nuevaOrigen }).eq('id', ex.id)
      }
      // Sumar al destino (buscar existencia igual)
      const dest = existencias.find(e => e.lote_id === ex.lote_id && e.almacen_id === destAlm && (e.ubicacion_id || null) === destUbi)
      if (dest) {
        await supabase.from('existencias').update({ cantidad: Number(dest.cantidad) + cant }).eq('id', dest.id)
      } else {
        await supabase.from('existencias').insert({ lote_id: ex.lote_id, almacen_id: destAlm, ubicacion_id: destUbi, cantidad: cant })
      }
      // Bitacora
      await supabase.from('movimientos').insert({
        empresa_id: perfil.empresa_id, articulo_id: ex._articuloId, lote_id: ex.lote_id, tipo: 'traspaso',
        almacen_origen_id: ex.almacen_id, ubicacion_origen_id: ex.ubicacion_id, almacen_destino_id: destAlm, ubicacion_destino_id: destUbi,
        cantidad: cant, fuera_flujo: traspaso.fuera_flujo, justificacion: traspaso.fuera_flujo ? traspaso.justificacion.trim() : null, usuario_id: perfil.id,
      })
      setExito('Traspaso registrado')
      setTraspaso(null)
      await cargarDatos()
    } catch (err) { setError('Error: ' + err.message) }
    setProcesando(false)
  }

  // ---------- Ajuste ----------
  const guardarAjuste = async () => {
    const { ex } = ajuste
    const cant = Number(ajuste.cantidad)
    setError('')
    if (!(cant > 0)) { setError('La cantidad debe ser mayor a 0'); return }
    if (!ajuste.motivo.trim()) { setError('El motivo del ajuste es obligatorio'); return }
    if (ajuste.signo === '-' && cant > Number(ex.cantidad)) { setError(`No puedes descontar mas de lo disponible (${fmtNum(ex.cantidad)})`); return }
    setProcesando(true)
    try {
      const nueva = ajuste.signo === '+' ? Number(ex.cantidad) + cant : Number(ex.cantidad) - cant
      if (nueva === 0) {
        await supabase.from('existencias').delete().eq('id', ex.id)
      } else {
        await supabase.from('existencias').update({ cantidad: nueva }).eq('id', ex.id)
      }
      await supabase.from('movimientos').insert({
        empresa_id: perfil.empresa_id, articulo_id: ex._articuloId, lote_id: ex.lote_id,
        tipo: ajuste.signo === '+' ? 'ajuste_positivo' : 'ajuste_negativo',
        almacen_origen_id: ex.almacen_id, ubicacion_origen_id: ex.ubicacion_id,
        cantidad: cant, motivo: ajuste.motivo.trim(), usuario_id: perfil.id,
      })
      setExito('Ajuste registrado')
      setAjuste(null)
      await cargarDatos()
    } catch (err) { setError('Error: ' + err.message) }
    setProcesando(false)
  }

  // ---------- Liberacion / Rechazo de calidad (a nivel lote) ----------
  // Etiquetas del inventario inicial: crea las cajas segun la SNP del articulo
  // (si el lote aun no las tiene) y abre la vista de impresion con QR por caja.
  const generarEtiquetas = async (ex, lote) => {
    setError(''); setExito('')
    try {
      const art = articulos.find(a => a.id === (ex._articuloId || lote.articulo_id))
      if (!art) { setError('No se encontro el articulo del lote'); return }
      const { data: norma } = await supabase.from('normas_empaque').select('piezas_por_empaque')
        .eq('articulo_id', art.id).eq('activa', true).eq('tipo', 'oficial').maybeSingle()
      const snp = Number(norma?.piezas_por_empaque || art.snp || 0)
      const cajas = await asegurarCajas(supabase, {
        empresaId: perfil.empresa_id, loteId: lote.id, articuloId: art.id,
        cantidad: Number(ex.cantidad), snp, almacenId: ex.almacen_id, ubicacionId: ex.ubicacion_id || null,
        origen: 'Inventario inicial', usuarioId: perfil.id,
      })
      const { data: emp } = await supabase.from('empresas').select('*').eq('id', perfil.empresa_id).maybeSingle()
      setEtq({ cajas, articulo: art, lote, empresa: emp || null })
    } catch (err) { setError('No se pudieron generar las etiquetas: ' + err.message) }
  }

  const cambiarCalidad = async (lote, nuevoEstatus) => {
    setError(''); setExito('')
    setProcesando(true)
    try {
      const patch = { estatus_calidad: nuevoEstatus }
      if (nuevoEstatus === 'liberado') { patch.liberado_por = perfil.id; patch.liberado_en = new Date().toISOString() }
      await supabase.from('lotes').update(patch).eq('id', lote.id)
      const totalLote = existencias.filter(e => e.lote_id === lote.id).reduce((s, e) => s + Number(e.cantidad), 0)
      await supabase.from('movimientos').insert({
        empresa_id: perfil.empresa_id, articulo_id: lote.articulo_id, lote_id: lote.id,
        tipo: nuevoEstatus === 'liberado' ? 'liberacion_calidad' : 'rechazo_calidad',
        cantidad: totalLote, usuario_id: perfil.id,
      })
      setExito(nuevoEstatus === 'liberado' ? 'Lote liberado por Calidad' : 'Lote rechazado')
      await cargarDatos()
    } catch (err) { setError('Error: ' + err.message) }
    setProcesando(false)
  }

  // ---------- Nueva entrada manual ----------
  const abrirEntrada = () => {
    setError(''); setExito('')
    setEntrada({ articulo_id: '', codigo_lote: '', almacen_id: '', ubicacion_id: '', cantidad: '', estatus_calidad: 'retenido' })
  }
  const guardarEntrada = async () => {
    setError('')
    if (!entrada.articulo_id || !entrada.codigo_lote.trim() || !entrada.almacen_id || !(Number(entrada.cantidad) > 0)) {
      setError('Articulo, codigo de lote, almacen y cantidad (>0) son obligatorios'); return
    }
    setProcesando(true)
    try {
      const { data: lote, error: e1 } = await supabase.from('lotes').insert({
        empresa_id: perfil.empresa_id, articulo_id: Number(entrada.articulo_id), codigo_lote: entrada.codigo_lote.trim(),
        origen: 'inicial', estatus_calidad: entrada.estatus_calidad,
        liberado_por: entrada.estatus_calidad === 'liberado' ? perfil.id : null,
        liberado_en: entrada.estatus_calidad === 'liberado' ? new Date().toISOString() : null,
        creado_por: perfil.id,
      }).select().single()
      if (e1) throw e1
      await supabase.from('existencias').insert({
        lote_id: lote.id, almacen_id: Number(entrada.almacen_id),
        ubicacion_id: entrada.ubicacion_id ? Number(entrada.ubicacion_id) : null, cantidad: Number(entrada.cantidad),
      })
      await supabase.from('movimientos').insert({
        empresa_id: perfil.empresa_id, articulo_id: Number(entrada.articulo_id), lote_id: lote.id, tipo: 'entrada_inicial',
        almacen_destino_id: Number(entrada.almacen_id), ubicacion_destino_id: entrada.ubicacion_id ? Number(entrada.ubicacion_id) : null,
        cantidad: Number(entrada.cantidad), motivo: 'Entrada inicial manual', usuario_id: perfil.id,
      })
      setExito('Entrada registrada')
      setEntrada(null)
      await cargarDatos()
    } catch (err) {
      setError(err.message.includes('duplicate') ? `Ya existe un lote con el codigo "${entrada.codigo_lote.trim()}"` : 'Error: ' + err.message)
    }
    setProcesando(false)
  }

  // ---------- Carga inicial por Excel ----------
  const descargarPlantilla = () => {
    const wb = XLSX.utils.book_new()
    const datos = [
      ['Codigo Articulo', 'Codigo Lote', 'Almacen', 'Ubicacion', 'Cantidad', 'Estatus'],
      ['SH1LA001A0000G10', 'L-2026-001', 'MP-N1-S1', 'R1-A1', 1000, 'liberado'],
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(datos), 'Inventario inicial')
    XLSX.writeFile(wb, 'plantilla_inventario_inicial.xlsx')
  }

  const leerImport = async (e) => {
    setError(''); setExito(''); setPreview(null)
    const file = e.target.files[0]
    if (!file) return
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
      let idxH = -1, c = {}
      for (let i = 0; i < Math.min(filas.length, 10); i++) {
        const row = filas[i].map(x => String(x).toLowerCase())
        const iArt = row.findIndex(x => x.includes('articulo'))
        const iLote = row.findIndex(x => x.includes('lote'))
        const iCant = row.findIndex(x => x.includes('cant'))
        if (iArt >= 0 && iLote >= 0 && iCant >= 0) {
          idxH = i
          c = { art: iArt, lote: iLote, cant: iCant, alm: row.findIndex(x => x.includes('almacen')), ubi: row.findIndex(x => x.includes('ubicacion')), est: row.findIndex(x => x.includes('estatus')) }
          break
        }
      }
      if (idxH < 0) { setError('No se encontraron encabezados. Usa la plantilla: Codigo Articulo, Codigo Lote, Almacen, Ubicacion, Cantidad, Estatus'); return }
      const items = [], errores = []
      const lotesEnArchivo = {}
      for (let i = idxH + 1; i < filas.length; i++) {
        const f = filas[i]
        const codArt = String(f[c.art] || '').trim()
        if (!codArt) continue
        const numFila = i + 1
        const art = articulos.find(a => a.codigo_interno.toLowerCase() === codArt.toLowerCase())
        if (!art) { errores.push(`Fila ${numFila}: articulo "${codArt}" no existe`); continue }
        const codLote = String(f[c.lote] || '').trim()
        if (!codLote) { errores.push(`Fila ${numFila}: falta el codigo de lote`); continue }
        if (lotes.some(l => l.codigo_lote.toLowerCase() === codLote.toLowerCase())) { errores.push(`Fila ${numFila}: el lote "${codLote}" ya existe en el sistema`); continue }
        const claveAlm = String(f[c.alm] || '').trim()
        const alm = almacenes.find(a => a.clave.toLowerCase() === claveAlm.toLowerCase())
        if (!alm) { errores.push(`Fila ${numFila}: almacen "${claveAlm}" no existe`); continue }
        const cant = Number(f[c.cant])
        if (!(cant > 0)) { errores.push(`Fila ${numFila}: cantidad invalida "${f[c.cant]}"`); continue }
        let ubiId = null
        const claveUbi = String(f[c.ubi] || '').trim()
        if (claveUbi) {
          const u = ubicaciones.find(x => x.almacen_id === alm.id && x.clave.toLowerCase() === claveUbi.toLowerCase())
          if (!u) { errores.push(`Fila ${numFila}: ubicacion "${claveUbi}" no existe en ${alm.clave} (se omite la ubicacion)`) }
          else ubiId = u.id
        }
        const est = String(f[c.est] || 'retenido').trim().toLowerCase()
        const estatus = ['liberado', 'retenido', 'rechazado'].includes(est) ? est : 'retenido'
        const key = codLote.toLowerCase()
        if (lotesEnArchivo[key] && lotesEnArchivo[key] !== art.id) { errores.push(`Fila ${numFila}: el lote "${codLote}" aparece con articulos distintos`); continue }
        lotesEnArchivo[key] = art.id
        items.push({ articulo_id: art.id, codArt, codigo_lote: codLote, almacen_id: alm.id, claveAlm: alm.clave, ubicacion_id: ubiId, cantidad: cant, estatus })
      }
      if (items.length === 0) { setError('No se pudo leer ninguna linea valida' + (errores.length ? ` (${errores.length} errores)` : '')); if (errores.length) setPreview({ items: [], errores }); return }
      setPreview({ items, errores })
    } catch (err) { setError('Error al leer: ' + err.message) }
    e.target.value = ''
  }

  const aplicarImport = async () => {
    setProcesando(true); setError('')
    try {
      // Un lote puede tener varias existencias (varias filas): agrupar por codigo_lote
      const porLote = {}
      preview.items.forEach(it => {
        if (!porLote[it.codigo_lote]) porLote[it.codigo_lote] = { articulo_id: it.articulo_id, estatus: it.estatus, filas: [] }
        porLote[it.codigo_lote].filas.push(it)
      })
      for (const codigo_lote of Object.keys(porLote)) {
        const g = porLote[codigo_lote]
        const { data: lote, error: e1 } = await supabase.from('lotes').insert({
          empresa_id: perfil.empresa_id, articulo_id: g.articulo_id, codigo_lote, origen: 'inicial', estatus_calidad: g.estatus,
          liberado_por: g.estatus === 'liberado' ? perfil.id : null, liberado_en: g.estatus === 'liberado' ? new Date().toISOString() : null, creado_por: perfil.id,
        }).select().single()
        if (e1) throw e1
        for (const it of g.filas) {
          await supabase.from('existencias').insert({ lote_id: lote.id, almacen_id: it.almacen_id, ubicacion_id: it.ubicacion_id, cantidad: it.cantidad })
          await supabase.from('movimientos').insert({
            empresa_id: perfil.empresa_id, articulo_id: it.articulo_id, lote_id: lote.id, tipo: 'entrada_inicial',
            almacen_destino_id: it.almacen_id, ubicacion_destino_id: it.ubicacion_id, cantidad: it.cantidad, motivo: 'Carga inicial Excel', usuario_id: perfil.id,
          })
        }
      }
      setExito(`Carga inicial: ${Object.keys(porLote).length} lote(s) importados`)
      setPreview(null)
      await cargarDatos()
    } catch (err) { setError('Error al importar: ' + err.message) }
    setProcesando(false)
  }

  // ---------- Armado de existencias para la vista ----------
  const filas = existencias.map(e => {
    const lote = loteDe(e.lote_id)
    return { ...e, _articuloId: lote?.articulo_id, _lote: lote }
  }).filter(e => e._lote)
    .filter(e => !filtroAlmacen || e.almacen_id === Number(filtroAlmacen))
    .filter(e => {
      if (!filtroTexto) return true
      const art = artDe(e._articuloId)
      const t = filtroTexto.toLowerCase()
      return art?.codigo_interno.toLowerCase().includes(t) || art?.descripcion.toLowerCase().includes(t) || e._lote.codigo_lote.toLowerCase().includes(t)
    })

  // Agrupar por articulo
  const grupos = []
  filas.forEach(e => {
    let g = grupos.find(x => x.articulo_id === e._articuloId)
    if (!g) { g = { articulo_id: e._articuloId, total: 0, filas: [] }; grupos.push(g) }
    g.total += Number(e.cantidad)
    g.filas.push(e)
  })
  grupos.sort((a, b) => (artDe(a.articulo_id)?.codigo_interno || '').localeCompare(artDe(b.articulo_id)?.codigo_interno || ''))

  const badgeCal = (est) => est === 'liberado' ? styles.badgeVerde : est === 'rechazado' ? styles.badgeRojo : styles.badgeAmbar

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando inventario...</p>


  // Vista de impresion de etiquetas (una por caja, 4x4 con QR)
  if (etq) {
    return (
      <div style={styles.container} className="aparecer">
        <style>{`@media print { @page { size: 4cm 4cm; margin: 0; } }`}</style>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '14px' }} className="no-imprimir">
          <button style={styles.botonSec} onClick={() => setEtq(null)}>&larr; Volver</button>
          <button style={styles.boton} onClick={imprimirAislado}>Imprimir {etq.cajas.length} etiqueta(s)</button>
        </div>
        <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '10px' }} className="no-imprimir">
          Lote <b>{etq.lote.codigo_lote}</b> · {etq.articulo.codigo_interno} · {etq.cajas.length} caja(s) segun la norma de empaque.
        </p>
        <PortalImpresion>
          <div>
            {etq.cajas.map(c => (
              <EtiquetaProducto key={c.id} datos={datosEtiqueta({
                lote: etq.lote, articulo: etq.articulo, empresa: etq.empresa,
                cantidad: c.cantidad, contenedor: c, qrContenido: 'contenedor',
              })} />
            ))}
          </div>
        </PortalImpresion>
      </div>
    )
  }

  return (
    <div style={styles.container} className="aparecer">
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Inventario</h2>
      <div style={{ marginBottom: 10 }} className="no-imprimir"><FiltroSite value={site} onChange={setSite} /></div>
        {puedeMover && (
          <div style={{ display: 'flex', gap: '10px' }}>
            <label style={{ ...styles.botonSec, cursor: 'pointer' }}>
              Carga inicial Excel
              <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={leerImport} />
            </label>
            <button style={styles.botonSec} onClick={descargarPlantilla}>Plantilla</button>
            <button style={styles.boton} onClick={abrirEntrada}>+ Nueva entrada</button>
          </div>
        )}
      </div>

      <div style={styles.tabs}>
        {[['existencias', 'Existencias'], ['movimientos', 'Movimientos']].map(([id, nombre]) => (
          <button key={id} style={vista === id ? styles.tabActiva : styles.tab} onClick={() => setVista(id)}>{nombre}</button>
        ))}
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {/* Vista previa import */}
      {preview && (
        <div style={styles.form}>
          <h3 style={styles.formTitulo}>Vista previa de carga inicial</h3>
          <p style={{ fontSize: '13px', color: '#444', margin: '0 0 8px' }}>Se crearan <b>{new Set(preview.items.map(i => i.codigo_lote)).size}</b> lote(s) con <b>{preview.items.length}</b> existencia(s).</p>
          {preview.items.slice(0, 10).map((it, i) => (
            <p key={i} style={{ fontSize: '12px', color: '#64748b', margin: '2px 0' }}>+ {it.codArt} / lote {it.codigo_lote} -&gt; {it.claveAlm} : {fmtNum(it.cantidad)} [{it.estatus}]</p>
          ))}
          {preview.items.length > 10 && <p style={{ fontSize: '12px', color: '#64748b' }}>... y {preview.items.length - 10} mas</p>}
          {preview.errores.length > 0 && (
            <div style={{ ...styles.cajaErrores, marginTop: '10px' }}>
              <p style={{ margin: '0 0 4px', fontWeight: '600', fontSize: '13px' }}>{preview.errores.length} advertencia(s):</p>
              {preview.errores.slice(0, 12).map((e, i) => <p key={i} style={{ margin: '2px 0', fontSize: '12px' }}>{e}</p>)}
            </div>
          )}
          <div style={{ ...styles.botones, marginTop: '12px' }}>
            <button style={styles.botonSec} onClick={() => setPreview(null)} disabled={procesando}>Cancelar</button>
            {preview.items.length > 0 && <button style={styles.boton} onClick={aplicarImport} disabled={procesando}>{procesando ? 'Importando...' : 'Confirmar carga'}</button>}
          </div>
        </div>
      )}

      {/* Nueva entrada manual */}
      {entrada && (
        <div style={styles.form}>
          <h3 style={styles.formTitulo}>Nueva entrada de inventario</h3>
          <div style={styles.fila}>
            <div style={{ ...styles.campo, flex: 1.6 }}>
              <label style={styles.label}>Articulo *</label>
              <select style={styles.input} value={entrada.articulo_id} onChange={e => setEntrada({ ...entrada, articulo_id: e.target.value })}>
                <option value="">Selecciona...</option>
                {articulos.map(a => <option key={a.id} value={a.id}>{a.codigo_interno} - {a.descripcion}</option>)}
              </select>
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Codigo de lote *</label>
              <input style={styles.input} value={entrada.codigo_lote} onChange={e => setEntrada({ ...entrada, codigo_lote: e.target.value })} placeholder="Ej. L-2026-001" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Estatus calidad</label>
              <select style={styles.input} value={entrada.estatus_calidad} onChange={e => setEntrada({ ...entrada, estatus_calidad: e.target.value })}>
                <option value="retenido">Retenido</option>
                <option value="liberado">Liberado</option>
              </select>
            </div>
          </div>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Almacen *</label>
              <select style={styles.input} value={entrada.almacen_id} onChange={e => setEntrada({ ...entrada, almacen_id: e.target.value, ubicacion_id: '' })}>
                <option value="">Selecciona...</option>
                {almacenes.map(a => <option key={a.id} value={a.id}>{a.clave} - {a.nombre}</option>)}
              </select>
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Ubicacion</label>
              <select style={styles.input} value={entrada.ubicacion_id} onChange={e => setEntrada({ ...entrada, ubicacion_id: e.target.value })} disabled={!entrada.almacen_id}>
                <option value="">Sin ubicacion</option>
                {ubisDe(Number(entrada.almacen_id)).map(u => <option key={u.id} value={u.id}>{u.clave}</option>)}
              </select>
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Cantidad *</label>
              <input type="number" min="0" style={styles.input} value={entrada.cantidad} onChange={e => setEntrada({ ...entrada, cantidad: e.target.value })} />
            </div>
          </div>
          <div style={styles.botones}>
            <button style={styles.botonSec} onClick={() => setEntrada(null)} disabled={procesando}>Cancelar</button>
            <button style={styles.boton} onClick={guardarEntrada} disabled={procesando}>{procesando ? 'Guardando...' : 'Registrar entrada'}</button>
          </div>
        </div>
      )}

      {/* ==================== EXISTENCIAS ==================== */}
      {vista === 'existencias' && (
        <>
          <div style={styles.selectorBox}>
            <input style={{ ...styles.input, flex: 1, marginRight: '12px' }} placeholder="Buscar articulo o lote..." value={filtroTexto} onChange={e => setFiltroTexto(e.target.value)} />
            <label style={{ ...styles.label, marginRight: '10px' }}>Almacen:</label>
            <select style={styles.input} value={filtroAlmacen} onChange={e => setFiltroAlmacen(e.target.value)}>
              <option value="">Todos</option>
              {almacenes.map(a => <option key={a.id} value={a.id}>{a.clave}</option>)}
            </select>
          </div>
          {grupos.length === 0 ? (
            <p style={{ color: '#666', padding: '10px 4px' }}>No hay existencias. Usa "Carga inicial Excel" o "+ Nueva entrada".</p>
          ) : (
            <div style={styles.tabla}>
              <div style={styles.tablaHeader}>
                <span style={{ flex: 2.4 }}>Articulo</span>
                <span style={{ flex: 1.3 }}>Lote</span>
                <span style={{ flex: 1.4 }}>Ubicacion</span>
                <span style={{ flex: 1, textAlign: 'right' }}>Cantidad</span>
                <span style={{ flex: 1, textAlign: 'center' }}>Calidad</span>
                <span style={{ width: '220px' }}></span>
              </div>
              {grupos.map(g => {
                const art = artDe(g.articulo_id)
                return (
                  <div key={g.articulo_id}>
                    <div style={{ ...styles.tablaFila, backgroundColor: '#f8fafc', fontWeight: '600' }}>
                      <span style={{ flex: 2.4 }}>{art?.codigo_interno} <span style={{ color: '#64748b', fontWeight: '400', fontSize: '13px' }}>- {art?.descripcion}</span></span>
                      <span style={{ flex: 3.7, color: '#64748b', fontSize: '13px', fontWeight: '400' }}>Total: {fmtNum(g.total)} {art?.unidad_medida || 'pzas'}{art?.flujo_id ? '' : ' - (sin flujo asignado)'}</span>
                      <span style={{ width: '220px' }}></span>
                    </div>
                    {g.filas.map(e => {
                      const lote = e._lote
                      const puedeTraspaso = puedeMover && Number(e.cantidad) > 0
                      return (
                        <div key={e.id} style={{ ...styles.tablaFila, fontSize: '13px', cursor: 'pointer' }} className="fila-hover"
                          onDoubleClick={() => { setMovArticulo(String(e._articuloId)); setMovTexto(''); setMovTipo(''); setMovAlmacen(''); setMovSoloFuera(false); setVista('movimientos') }}
                          title="Doble clic para ver el kardex de este articulo">
                          <span style={{ flex: 2.4, paddingLeft: '12px', color: '#94a3b8' }}>&#8627;</span>
                          <span style={{ flex: 1.3, fontWeight: '600' }}>{lote.codigo_lote}</span>
                          <span style={{ flex: 1.4 }}>{almDe(e.almacen_id)?.clave}{e.ubicacion_id ? ` / ${ubiDe(e.ubicacion_id)?.clave}` : ''}</span>
                          <span style={{ flex: 1, textAlign: 'right', fontWeight: '600' }}>{fmtNum(e.cantidad)}</span>
                          <span style={{ flex: 1.4, fontSize: '11px', color: '#94a3b8' }}>
                            {(() => {
                              const cajas = contenedores.filter(c => c.lote_id === lote.id && c.almacen_id === e.almacen_id && (c.ubicacion_id || null) === (e.ubicacion_id || null) && !c.padre_id)
                              if (!cajas.length) return null
                              return cajas.slice(0, 4).map(c => c.folio).join(', ') + (cajas.length > 4 ? ` +${cajas.length - 4}` : '')
                            })()}
                          </span>
                          <span style={{ flex: 1, textAlign: 'center' }}>
                            <span style={{ ...styles.badge, ...badgeCal(lote.estatus_calidad) }}>{NOMBRE_CALIDAD[lote.estatus_calidad]}</span>
                          </span>
                          <span style={{ width: '220px', textAlign: 'right', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>

                            {puedeTraspaso && <button style={styles.botonAccion} onClick={() => { setError(''); setAjuste({ ex: e, signo: '-', cantidad: '', motivo: '' }) }}>Ajustar</button>}
                            <button style={styles.botonAccion} onClick={() => generarEtiquetas(e, lote)}>Etiquetas</button>
                            {puedeLiberar && lote.estatus_calidad === 'retenido' && (
                              <>
                                <button style={{ ...styles.botonAccion, color: '#16a34a' }} onClick={() => cambiarCalidad(lote, 'liberado')}>Liberar</button>
                                <button style={{ ...styles.botonAccion, color: '#dc2626' }} onClick={() => cambiarCalidad(lote, 'rechazado')}>Rechazar</button>
                              </>
                            )}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ==================== MOVIMIENTOS / KARDEX ==================== */}
      {vista === 'movimientos' && (() => {
        // Filtrado
        let lista = movimientos.filter(m => {
          if (movArticulo && m.articulo_id !== Number(movArticulo)) return false
          if (movTipo && m.tipo !== movTipo) return false
          if (movAlmacen && m.almacen_origen_id !== Number(movAlmacen) && m.almacen_destino_id !== Number(movAlmacen)) return false
          if (movSoloFuera && !m.fuera_flujo) return false
          if (movTexto) {
            const art = artDe(m.articulo_id); const t = movTexto.toLowerCase()
            if (!(art?.codigo_interno.toLowerCase().includes(t) || art?.descripcion.toLowerCase().includes(t) || loteDe(m.lote_id)?.codigo_lote.toLowerCase().includes(t))) return false
          }
          return true
        })
        // Kardex con saldo corrido solo si hay un articulo seleccionado (orden cronologico ascendente)
        const esKardex = !!movArticulo
        let conSaldo = lista
        if (esKardex) {
          const asc = [...lista].sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
          let saldo = 0
          const mapa = {}
          asc.forEach(m => {
            const entra = ['entrada_inicial', 'ajuste_positivo'].includes(m.tipo) || (m.tipo === 'traspaso' && m.almacen_destino_id === Number(movAlmacen))
            const sale = ['ajuste_negativo'].includes(m.tipo) || (m.tipo === 'traspaso' && m.almacen_origen_id === Number(movAlmacen))
            let signo = 0
            if (movAlmacen) { signo = entra ? 1 : sale ? -1 : 0 }
            else { signo = ['entrada_inicial', 'ajuste_positivo'].includes(m.tipo) ? 1 : ['ajuste_negativo'].includes(m.tipo) ? -1 : 0 }
            saldo += signo * Number(m.cantidad)
            mapa[m.id] = saldo
          })
          conSaldo = [...lista].sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).map(m => ({ ...m, _saldo: mapa[m.id] }))
        }
        const art = movArticulo ? artDe(Number(movArticulo)) : null
        return (
          <>
            <div style={styles.selectorBox}>
              <input style={{ ...styles.input, flex: 1, marginRight: '10px' }} placeholder="Buscar articulo o lote..." value={movTexto} onChange={e => setMovTexto(e.target.value)} />
              <select style={{ ...styles.input, marginRight: '10px' }} value={movArticulo} onChange={e => setMovArticulo(e.target.value)}>
                <option value="">Articulo (kardex)...</option>
                {articulos.map(a => <option key={a.id} value={a.id}>{a.codigo_interno}</option>)}
              </select>
              <select style={{ ...styles.input, marginRight: '10px' }} value={movTipo} onChange={e => setMovTipo(e.target.value)}>
                <option value="">Todo tipo</option>
                {Object.keys(NOMBRE_MOV).map(k => <option key={k} value={k}>{NOMBRE_MOV[k]}</option>)}
              </select>
              <select style={{ ...styles.input, marginRight: '10px' }} value={movAlmacen} onChange={e => setMovAlmacen(e.target.value)}>
                <option value="">Todo almacen</option>
                {almacenes.map(a => <option key={a.id} value={a.id}>{a.clave}</option>)}
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={movSoloFuera} onChange={e => setMovSoloFuera(e.target.checked)} />
                Fuera de flujo
              </label>
            </div>
            {esKardex && (
              <p style={{ fontSize: '13px', color: '#334155', margin: '0 0 12px 4px' }}>
                Kardex de <b>{art?.codigo_interno}</b>{movAlmacen ? ` en almacen ${almDe(Number(movAlmacen))?.clave}` : ' (todos los almacenes)'} - saldo corrido{!movAlmacen ? ' (entradas/ajustes; los traspasos no cambian el total global)' : ''}.
              </p>
            )}
            {conSaldo.length === 0 ? (
              <p style={{ color: '#666', padding: '10px 4px' }}>No hay movimientos con estos filtros.</p>
            ) : (
              <div style={styles.tabla}>
                <div style={styles.tablaHeader}>
                  <span style={{ flex: 1.3 }}>Fecha</span>
                  <span style={{ flex: 1.2 }}>Tipo</span>
                  <span style={{ flex: 1.8 }}>Articulo / Lote</span>
                  <span style={{ flex: 1.6 }}>Origen &rarr; Destino</span>
                  <span style={{ flex: 0.8, textAlign: 'right' }}>Cantidad</span>
                  {esKardex && <span style={{ flex: 0.8, textAlign: 'right' }}>Saldo</span>}
                  <span style={{ flex: 1.3 }}>Usuario / Motivo</span>
                </div>
                {conSaldo.map(m => {
                  const a2 = artDe(m.articulo_id)
                  const oa = m.almacen_origen_id ? almDe(m.almacen_origen_id)?.clave : null
                  const da = m.almacen_destino_id ? almDe(m.almacen_destino_id)?.clave : null
                  return (
                    <div key={m.id} style={{ ...styles.tablaFila, fontSize: '13px' }} className="fila-hover">
                      <span style={{ flex: 1.3, color: '#64748b' }}>{fmtFechaHora(m.fecha)}</span>
                      <span style={{ flex: 1.2 }}>
                        <span style={{ ...styles.badge, ...(m.fuera_flujo ? styles.badgeRojo : styles.badgeGris) }}>{NOMBRE_MOV[m.tipo]}</span>
                      </span>
                      <span style={{ flex: 1.8 }}>{a2?.codigo_interno} <span style={{ color: '#94a3b8' }}>/ {loteDe(m.lote_id)?.codigo_lote}</span></span>
                      <span style={{ flex: 1.6, color: '#64748b' }}>{oa || '-'} &rarr; {da || '-'}</span>
                      <span style={{ flex: 0.8, textAlign: 'right', fontWeight: '600' }}>{fmtNum(m.cantidad)}</span>
                      {esKardex && <span style={{ flex: 0.8, textAlign: 'right', fontWeight: '600', color: '#2563eb' }}>{fmtNum(m._saldo)}</span>}
                      <span style={{ flex: 1.3, color: '#64748b', fontSize: '12px' }}>{m.usuario?.nombre}{m.motivo ? ` - ${m.motivo}` : ''}{m.justificacion ? ` - ${m.justificacion}` : ''}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )
      })()}

      {/* Modal traspaso */}
      {traspaso && (
        <div style={styles.overlay} onClick={() => setTraspaso(null)}>
          <div style={styles.modal} onClick={ev => ev.stopPropagation()}>
            <h3 style={styles.formTitulo}>Traspaso de lote {traspaso.ex._lote.codigo_lote}</h3>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 14px' }}>
              {artDe(traspaso.ex._articuloId)?.codigo_interno} - Origen: <b>{almDe(traspaso.ex.almacen_id)?.clave}{traspaso.ex.ubicacion_id ? ` / ${ubiDe(traspaso.ex.ubicacion_id)?.clave}` : ''}</b> (disponible {fmtNum(traspaso.ex.cantidad)})
            </p>
            {puedeForzar && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer', marginBottom: '12px' }}>
                <input type="checkbox" checked={traspaso.fuera_flujo} onChange={e => setTraspaso({ ...traspaso, fuera_flujo: e.target.checked, almacen_destino_id: '', ubicacion_destino_id: '' })} />
                Movimiento fuera de flujo (requiere justificacion)
              </label>
            )}
            {!traspaso.fuera_flujo && destinosTraspaso().length === 0 && (
              <p style={{ ...styles.cajaErrores, fontSize: '12px' }}>
                No hay siguiente paso de flujo desde este almacen{artDe(traspaso.ex._articuloId)?.flujo_id ? ' (es el ultimo paso o el almacen no esta en el flujo)' : ' (el articulo no tiene flujo asignado)'}.
                {puedeForzar ? ' Usa "fuera de flujo" para mover.' : ''}
              </p>
            )}
            <div style={styles.fila}>
              <div style={styles.campo}>
                <label style={styles.label}>Almacen destino *</label>
                <select style={styles.input} value={traspaso.almacen_destino_id} onChange={e => setTraspaso({ ...traspaso, almacen_destino_id: e.target.value, ubicacion_destino_id: '' })}>
                  <option value="">Selecciona...</option>
                  {destinosTraspaso().map(a => <option key={a.id} value={a.id}>{a.clave} - {a.nombre}</option>)}
                </select>
              </div>
              <div style={styles.campo}>
                <label style={styles.label}>Ubicacion destino</label>
                <select style={styles.input} value={traspaso.ubicacion_destino_id} onChange={e => setTraspaso({ ...traspaso, ubicacion_destino_id: e.target.value })} disabled={!traspaso.almacen_destino_id}>
                  <option value="">Sin ubicacion</option>
                  {ubisDe(Number(traspaso.almacen_destino_id)).map(u => <option key={u.id} value={u.id}>{u.clave}</option>)}
                </select>
              </div>
              <div style={{ ...styles.campo, flex: 0.7 }}>
                <label style={styles.label}>Cantidad *</label>
                <input type="number" min="0" style={styles.input} value={traspaso.cantidad} onChange={e => setTraspaso({ ...traspaso, cantidad: e.target.value })} autoFocus />
              </div>
            </div>
            {traspaso.fuera_flujo && (
              <div style={{ ...styles.campo, marginBottom: '12px' }}>
                <label style={styles.label}>Justificacion *</label>
                <input style={styles.input} value={traspaso.justificacion} onChange={e => setTraspaso({ ...traspaso, justificacion: e.target.value })} placeholder="Motivo del movimiento excepcional" />
              </div>
            )}
            <div style={styles.botones}>
              <button style={styles.botonSec} onClick={() => setTraspaso(null)} disabled={procesando}>Cancelar</button>
              <button style={styles.boton} onClick={guardarTraspaso} disabled={procesando}>{procesando ? 'Guardando...' : 'Registrar traspaso'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal ajuste */}
      {ajuste && (
        <div style={styles.overlay} onClick={() => setAjuste(null)}>
          <div style={styles.modal} onClick={ev => ev.stopPropagation()}>
            <h3 style={styles.formTitulo}>Ajuste de inventario</h3>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 14px' }}>
              {artDe(ajuste.ex._articuloId)?.codigo_interno} - Lote {ajuste.ex._lote.codigo_lote} en {almDe(ajuste.ex.almacen_id)?.clave} (actual {fmtNum(ajuste.ex.cantidad)})
            </p>
            <div style={styles.fila}>
              <div style={{ ...styles.campo, flex: 0.6 }}>
                <label style={styles.label}>Tipo *</label>
                <select style={styles.input} value={ajuste.signo} onChange={e => setAjuste({ ...ajuste, signo: e.target.value })}>
                  <option value="-">Descontar (-)</option>
                  <option value="+">Agregar (+)</option>
                </select>
              </div>
              <div style={{ ...styles.campo, flex: 0.6 }}>
                <label style={styles.label}>Cantidad *</label>
                <input type="number" min="0" style={styles.input} value={ajuste.cantidad} onChange={e => setAjuste({ ...ajuste, cantidad: e.target.value })} autoFocus />
              </div>
              <div style={{ ...styles.campo, flex: 1.4 }}>
                <label style={styles.label}>Motivo *</label>
                <input style={styles.input} value={ajuste.motivo} onChange={e => setAjuste({ ...ajuste, motivo: e.target.value })} placeholder="Ej. merma, conteo fisico, dano" />
              </div>
            </div>
            <div style={styles.botones}>
              <button style={styles.botonSec} onClick={() => setAjuste(null)} disabled={procesando}>Cancelar</button>
              <button style={styles.boton} onClick={guardarAjuste} disabled={procesando}>{procesando ? 'Guardando...' : 'Registrar ajuste'}</button>
            </div>
          </div>
        </div>
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
  formTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 16px 0' },
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
  tablaFila: { display: 'flex', padding: '11px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  modal: { backgroundColor: '#fff', borderRadius: '12px', padding: '28px', width: '640px', maxWidth: '92vw', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '600' },
  badgeVerde: { backgroundColor: '#dcfce7', color: '#16a34a' },
  badgeRojo: { backgroundColor: '#fee2e2', color: '#dc2626' },
  badgeAmbar: { backgroundColor: '#fef3c7', color: '#b45309' },
  badgeGris: { backgroundColor: '#f1f5f9', color: '#64748b' },
  cajaErrores: { backgroundColor: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '8px', padding: '12px 16px', color: '#92400e', marginBottom: '12px' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
