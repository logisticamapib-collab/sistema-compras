import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import EtiquetaProducto from '../../components/EtiquetaProducto'
import PortalImpresion from '../../components/PortalImpresion'
import { imprimirAislado } from '../../lib/impresion'
import { datosEtiqueta } from '../../lib/etiquetas'

// Capa 3 - Recibos. Dos fuentes:
//  - Contra OC (compra): valida certificado y PPAP del proveedor.
//  - Consigna: contra una autorizacion APROBADA (material del cliente, costo 0).
// Ambas generan lote RETENIDO, existencia y movimiento de entrada, y actualizan
// el flujo del documento origen (OC o autorizacion de consigna).

const fmtNum = (n) => (Number(n) || 0).toLocaleString('es-MX')
const fmtFecha = (f) => f ? new Date(f).toLocaleDateString('es-MX') : '-'
const hoy = () => new Date().toISOString().split('T')[0]
const RECIBIBLES = ['aprobada', 'enviada_proveedor', 'confirmada', 'en_transito', 'recibida_parcial']

export default function Recibos() {
  const { perfil, tienePermiso } = useAuth()
  const puedeRecibir = tienePermiso('log_recibos', 'crear')

  const [vista, setVista] = useState('oc')
  const [ocs, setOcs] = useState([])
  const [ocLineas, setOcLineas] = useState([])
  const [cons, setCons] = useState([])
  const [consLineas, setConsLineas] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [clientes, setClientes] = useState([])
  const [articulos, setArticulos] = useState([])
  const [almacenes, setAlmacenes] = useState([])
  const [ubicaciones, setUbicaciones] = useState([])
  const [relProv, setRelProv] = useState([])
  const [desviaciones, setDesviaciones] = useState([])
  const [recibos, setRecibos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  const [ocActiva, setOcActiva] = useState(null)
  const [consActiva, setConsActiva] = useState(null)
  const [expandido, setExpandido] = useState(null)      // 'oc-3' | 'cons-5'
  const [seleccion, setSeleccion] = useState({})        // { [docKey]: { [lineaId]: true } }
  const [rec, setRec] = useState({})
  const [notas, setNotas] = useState('')
  const [procesando, setProcesando] = useState(false)
  const [empresa, setEmpresa] = useState(null)
  const [bom, setBom] = useState([])
  const [cfgEtiqueta, setCfgEtiqueta] = useState(null)
  const [etiquetas, setEtiquetas] = useState([])

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    const [o, l, cc, cl, p, cli, a, alm, ubi, rp, d, r, emp, bm, cfg] = await Promise.all([
      supabase.from('ordenes_compra').select('*').eq('empresa_id', perfil.empresa_id).in('estatus', RECIBIBLES).order('fecha_emision', { ascending: false }),
      supabase.from('oc_lineas').select('*'),
      supabase.from('consigna_autorizaciones').select('*').eq('empresa_id', perfil.empresa_id).in('estatus', ['aprobada', 'recibida_parcial']).order('fecha_creacion', { ascending: false }),
      supabase.from('consigna_autorizacion_lineas').select('*'),
      supabase.from('proveedores').select('id, nombre'),
      supabase.from('clientes').select('id, nombre'),
      supabase.from('articulos').select('id, codigo_interno, descripcion, unidad_medida, es_consigna, origen, snp'),
      supabase.from('almacenes').select('*').eq('activo', true),
      supabase.from('ubicaciones').select('*').eq('activo', true),
      supabase.from('articulo_proveedor').select('*').eq('activo', true),
      supabase.from('desviaciones_ppap').select('*').eq('activo', true),
      supabase.from('recibos').select('*, prov:proveedores(nombre), oc:ordenes_compra(folio), cons:consigna_autorizaciones(folio), usuario:usuarios!recibos_recibido_por_fkey(nombre)').order('fecha', { ascending: false }).limit(100),
      supabase.from('empresas').select('*').eq('id', perfil.empresa_id).maybeSingle(),
      supabase.from('bom').select('componente_articulo_id'),
      supabase.from('config_etiquetas').select('*').eq('empresa_id', perfil.empresa_id).maybeSingle(),
    ])
    setOcs(o.data || []); setOcLineas(l.data || []); setCons(cc.data || []); setConsLineas(cl.data || [])
    setProveedores(p.data || []); setClientes(cli.data || []); setArticulos(a.data || [])
    setAlmacenes(alm.data || []); setUbicaciones(ubi.data || []); setRelProv(rp.data || [])
    setDesviaciones(d.data || []); setRecibos(r.data || [])
    setEmpresa(emp.data || null); setBom(bm.data || []); setCfgEtiqueta(cfg.data || null)
    setLoading(false)
  }

  const artDe = (id) => articulos.find(a => a.id === id)
  const provDe = (id) => proveedores.find(p => p.id === id)
  const cliDe = (id) => clientes.find(c => c.id === id)
  const ocLineasDe = (ocId) => ocLineas.filter(l => l.oc_id === ocId)
  const consLineasDe = (cId) => consLineas.filter(l => l.autorizacion_id === cId)
  const pendOc = (l) => Number(l.cantidad) - Number(l.cantidad_recibida || 0)
  const pendCons = (l) => Number(l.cantidad) - Number(l.cantidad_recibida || 0)
  const ubisDe = (almId) => ubicaciones.filter(u => u.almacen_id === almId)

  const ocsPendientes = ocs.filter(o => ocLineasDe(o.id).some(l => pendOc(l) > 0))
  const consPendientes = cons.filter(c => consLineasDe(c.id).some(l => pendCons(l) > 0))

  const requisitoDe = (aid, pid) => relProv.find(r => r.articulo_id === aid && r.proveedor_id === pid)
  const desviacionActiva = (aid, pid) => desviaciones.find(d => d.articulo_id === aid && d.proveedor_id === pid && d.vigente_hasta >= hoy())
  const validaCalidad = (aid, pid) => {
    const req = requisitoDe(aid, pid)
    const certReq = !!req?.requiere_certificado
    if (!req?.requiere_ppap) return { ppapOk: true, certReq, desvId: null }
    if (req.ppap_vigencia && req.ppap_vigencia >= hoy()) return { ppapOk: true, certReq, desvId: null }
    const desv = desviacionActiva(aid, pid)
    if (desv) return { ppapOk: true, certReq, desvId: desv.id, porDesviacion: true }
    return { ppapOk: false, certReq, desvId: null, motivo: !req.ppap_vigencia ? 'PPAP faltante' : 'PPAP vencido' }
  }

  const setCampo = (id, campo, valor) => setRec(r => ({ ...r, [id]: { ...r[id], [campo]: valor } }))

  // --- Seleccion de lineas por documento ---
  const seleccionadas = (docKey) => seleccion[docKey] || {}
  const nSeleccionadas = (docKey) => Object.values(seleccionadas(docKey)).filter(Boolean).length
  const toggleLinea = (docKey, lineaId) => setSeleccion(s => {
    const act = { ...(s[docKey] || {}) }
    act[lineaId] = !act[lineaId]
    return { ...s, [docKey]: act }
  })
  const toggleTodas = (docKey, lineasIds) => setSeleccion(s => {
    const act = { ...(s[docKey] || {}) }
    const todas = lineasIds.every(id => act[id])
    lineasIds.forEach(id => { act[id] = !todas })
    return { ...s, [docKey]: act }
  })
  const abrirDoc = (docKey, lineasIds) => {
    if (expandido === docKey) { setExpandido(null); return }
    setExpandido(docKey)
    // por defecto, todas las lineas pendientes seleccionadas
    setSeleccion(s => s[docKey] ? s : { ...s, [docKey]: Object.fromEntries(lineasIds.map(id => [id, true])) })
  }

  const subirCertificado = async (file) => {
    const nombre = `recibos/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { error: e } = await supabase.storage.from('calidad').upload(nombre, file)
    if (e) throw new Error('No se pudo subir el certificado: ' + e.message)
    return supabase.storage.from('calidad').getPublicUrl(nombre).data.publicUrl
  }

  // Arma las etiquetas de los lotes recibidos (una por empaque segun el SNP del articulo)
  const construirEtiquetas = (items, { proveedorNombre, clienteNombre }) => {
    const nuevas = []
    for (const it of items) {
      const art = artDe(it.articulo_id)
      const snp = Number(art?.snp || 0)
      const cajas = snp > 0 ? Math.ceil(it.cantidad / snp) : 1
      for (let i = 0; i < cajas; i++) {
        const cant = snp > 0 ? (i === cajas - 1 ? it.cantidad - snp * (cajas - 1) : snp) : it.cantidad
        nuevas.push(datosEtiqueta({
          lote: it.lote, articulo: art, empresa,
          cliente: { nombre: clienteNombre || proveedorNombre || '' },
          codigoCliente: art?.codigo_interno, maquina: null, cantidad: cant, bom,
        }))
      }
    }
    return nuevas
  }

  // Reimprime las etiquetas de un recibo ya guardado
  const reimprimir = async (recibo) => {
    setError(''); setExito('')
    const { data: filas, error: e1 } = await supabase
      .from('recibo_lineas').select('*, lote:lotes(*)').eq('recibo_id', recibo.id)
    if (e1) { setError('Error al leer el recibo: ' + e1.message); return }
    const items = (filas || []).filter(f => f.lote_id).map(f => ({ articulo_id: f.articulo_id, cantidad: Number(f.cantidad), lote: f.lote }))
    if (items.length === 0) { setError('Ese recibo no tiene lotes para etiquetar'); return }
    setEtiquetas(construirEtiquetas(items, { proveedorNombre: recibo.prov?.nombre, clienteNombre: null }))
  }

  const abrirOc = (oc) => {
    setError(''); setExito(''); setConsActiva(null); setOcActiva(oc); setNotas('')
    const sel = seleccionadas(`oc-${oc.id}`)
    const hay = Object.values(sel).some(Boolean)
    const ini = {}
    ocLineasDe(oc.id).filter(l => pendOc(l) > 0).filter(l => !hay || sel[l.id]).forEach(l => { ini[l.id] = { cantidad: '', codigo_lote: '', almacen_id: '', ubicacion_id: '', certificado_ref: '', file: null } })
    setRec(ini)
  }
  const abrirCons = (c) => {
    setError(''); setExito(''); setOcActiva(null); setConsActiva(c); setNotas('')
    const sel = seleccionadas(`cons-${c.id}`)
    const hay = Object.values(sel).some(Boolean)
    const ini = {}
    consLineasDe(c.id).filter(l => pendCons(l) > 0).filter(l => !hay || sel[l.id]).forEach(l => { ini[l.id] = { cantidad: '', codigo_lote: '', almacen_id: '', ubicacion_id: '', certificado_ref: '', file: null } })
    setRec(ini)
  }

  // ---------- Confirmar recibo OC ----------
  const confirmarOc = async () => {
    setError('')
    const items = Object.entries(rec).map(([id, v]) => ({ lineaId: Number(id), ...v, cant: Number(v.cantidad) })).filter(x => x.cant > 0)
    if (items.length === 0) { setError('Captura al menos una cantidad'); return }
    for (const it of items) {
      const l = ocLineas.find(x => x.id === it.lineaId); const art = artDe(l.articulo_id)
      if (it.cant > pendOc(l)) { setError(`${art?.codigo_interno}: excede lo pendiente (${fmtNum(pendOc(l))})`); return }
      if (!it.codigo_lote.trim()) { setError(`${art?.codigo_interno}: captura codigo de lote`); return }
      if (!it.almacen_id) { setError(`${art?.codigo_interno}: selecciona almacen`); return }
      const val = validaCalidad(l.articulo_id, ocActiva.proveedor_id)
      if (!val.ppapOk) { setError(`${art?.codigo_interno}: ${val.motivo}. Calidad debe autorizar desviacion o renovar PPAP`); return }
      if (val.certReq && !it.certificado_ref.trim()) { setError(`${art?.codigo_interno}: requiere referencia de certificado`); return }
    }
    setProcesando(true)
    try {
      const { data: recibo, error: e0 } = await supabase.from('recibos').insert({
        empresa_id: perfil.empresa_id, folio: `REC-${Date.now().toString().slice(-8)}`, oc_id: ocActiva.id,
        proveedor_id: ocActiva.proveedor_id, site_id: ocActiva.site_id, recibido_por: perfil.id, notas: notas || null,
      }).select().single()
      if (e0) throw e0
      const detalleSeg = []
      const paraEtiquetas = []
      for (const it of items) {
        const l = ocLineas.find(x => x.id === it.lineaId)
        const val = validaCalidad(l.articulo_id, ocActiva.proveedor_id)
        let certUrl = it.file ? await subirCertificado(it.file) : null
        const { data: lote, error: e1 } = await supabase.from('lotes').insert({
          empresa_id: perfil.empresa_id, articulo_id: l.articulo_id, codigo_lote: it.codigo_lote.trim(), origen: 'compra', estatus_calidad: 'retenido', creado_por: perfil.id,
        }).select().single()
        if (e1) throw (e1.message.includes('duplicate') ? new Error(`El lote "${it.codigo_lote.trim()}" ya existe`) : e1)
        await supabase.from('existencias').insert({ lote_id: lote.id, almacen_id: Number(it.almacen_id), ubicacion_id: it.ubicacion_id ? Number(it.ubicacion_id) : null, cantidad: it.cant })
        await supabase.from('movimientos').insert({ empresa_id: perfil.empresa_id, articulo_id: l.articulo_id, lote_id: lote.id, tipo: 'entrada_inicial', almacen_destino_id: Number(it.almacen_id), ubicacion_destino_id: it.ubicacion_id ? Number(it.ubicacion_id) : null, cantidad: it.cant, motivo: `Recibo ${recibo.folio} / OC ${ocActiva.folio}`, usuario_id: perfil.id })
        await supabase.from('recibo_lineas').insert({ recibo_id: recibo.id, oc_linea_id: l.id, articulo_id: l.articulo_id, cantidad: it.cant, lote_id: lote.id, almacen_id: Number(it.almacen_id), ubicacion_id: it.ubicacion_id ? Number(it.ubicacion_id) : null, certificado_ref: it.certificado_ref.trim() || null, certificado_url: certUrl, ppap_estado: val.porDesviacion ? 'desviacion' : (requisitoDe(l.articulo_id, ocActiva.proveedor_id)?.requiere_ppap ? 'vigente' : 'no_requiere'), desviacion_id: val.desvId })
        await supabase.from('oc_lineas').update({ cantidad_recibida: Number(l.cantidad_recibida || 0) + it.cant }).eq('id', l.id)
        paraEtiquetas.push({ articulo_id: l.articulo_id, cantidad: it.cant, lote })
        detalleSeg.push({ oc_linea_id: l.id, cantidad: it.cant })
      }
      const { data: seg } = await supabase.from('oc_seguimiento').insert({ oc_id: ocActiva.id, evento: 'recibo', usuario_id: perfil.id, comentario: `Recibo ${recibo.folio}: ${items.length} linea(s) a inventario (retenido)` }).select().single()
      if (seg) for (const d of detalleSeg) await supabase.from('oc_seguimiento_detalle').insert({ seguimiento_id: seg.id, oc_id: ocActiva.id, oc_linea_id: d.oc_linea_id, cantidad_recibida: d.cantidad })
      const todo = ocLineasDe(ocActiva.id).map(l => { const it = items.find(i => i.lineaId === l.id); return (Number(l.cantidad_recibida || 0) + (it ? it.cant : 0)) >= Number(l.cantidad) })
      await supabase.from('ordenes_compra').update({ estatus: todo.every(Boolean) ? 'recibida' : 'recibida_parcial', fecha_entrega_real: hoy() }).eq('id', ocActiva.id)
      setEtiquetas(construirEtiquetas(paraEtiquetas, { proveedorNombre: provDe(ocActiva.proveedor_id)?.nombre }))
      setExito(`Recibo ${recibo.folio} registrado. Material RETENIDO, pendiente de liberacion por Calidad.`)
      setOcActiva(null); setRec({}); await cargarDatos()
    } catch (err) { setError('Error al recibir: ' + err.message) }
    setProcesando(false)
  }

  // ---------- Confirmar recibo Consigna ----------
  const confirmarCons = async () => {
    setError('')
    const items = Object.entries(rec).map(([id, v]) => ({ lineaId: Number(id), ...v, cant: Number(v.cantidad) })).filter(x => x.cant > 0)
    if (items.length === 0) { setError('Captura al menos una cantidad'); return }
    for (const it of items) {
      const l = consLineas.find(x => x.id === it.lineaId); const art = artDe(l.articulo_id)
      if (it.cant > pendCons(l)) { setError(`${art?.codigo_interno}: excede lo pendiente (${fmtNum(pendCons(l))})`); return }
      if (!it.codigo_lote.trim()) { setError(`${art?.codigo_interno}: captura codigo de lote`); return }
      if (!it.almacen_id) { setError(`${art?.codigo_interno}: selecciona almacen`); return }
    }
    setProcesando(true)
    try {
      const { data: recibo, error: e0 } = await supabase.from('recibos').insert({
        empresa_id: perfil.empresa_id, folio: `REC-${Date.now().toString().slice(-8)}`, consigna_autorizacion_id: consActiva.id,
        site_id: consActiva.site_id, recibido_por: perfil.id, notas: notas || null,
      }).select().single()
      if (e0) throw e0
      const paraEtiquetasC = []
      for (const it of items) {
        const l = consLineas.find(x => x.id === it.lineaId)
        let certUrl = it.file ? await subirCertificado(it.file) : null
        const { data: lote, error: e1 } = await supabase.from('lotes').insert({
          empresa_id: perfil.empresa_id, articulo_id: l.articulo_id, codigo_lote: it.codigo_lote.trim(), origen: 'consigna', estatus_calidad: 'retenido', creado_por: perfil.id,
        }).select().single()
        if (e1) throw (e1.message.includes('duplicate') ? new Error(`El lote "${it.codigo_lote.trim()}" ya existe`) : e1)
        await supabase.from('existencias').insert({ lote_id: lote.id, almacen_id: Number(it.almacen_id), ubicacion_id: it.ubicacion_id ? Number(it.ubicacion_id) : null, cantidad: it.cant })
        await supabase.from('movimientos').insert({ empresa_id: perfil.empresa_id, articulo_id: l.articulo_id, lote_id: lote.id, tipo: 'entrada_inicial', almacen_destino_id: Number(it.almacen_id), ubicacion_destino_id: it.ubicacion_id ? Number(it.ubicacion_id) : null, cantidad: it.cant, motivo: `Recibo consigna ${recibo.folio} / ${consActiva.folio}`, usuario_id: perfil.id })
        await supabase.from('recibo_lineas').insert({ recibo_id: recibo.id, consigna_linea_id: l.id, articulo_id: l.articulo_id, cantidad: it.cant, lote_id: lote.id, almacen_id: Number(it.almacen_id), ubicacion_id: it.ubicacion_id ? Number(it.ubicacion_id) : null, certificado_ref: it.certificado_ref.trim() || null, certificado_url: certUrl, ppap_estado: 'consigna' })
        await supabase.from('consigna_autorizacion_lineas').update({ cantidad_recibida: Number(l.cantidad_recibida || 0) + it.cant }).eq('id', l.id)
        paraEtiquetasC.push({ articulo_id: l.articulo_id, cantidad: it.cant, lote })
      }
      const todo = consLineasDe(consActiva.id).map(l => { const it = items.find(i => i.lineaId === l.id); return (Number(l.cantidad_recibida || 0) + (it ? it.cant : 0)) >= Number(l.cantidad) })
      await supabase.from('consigna_autorizaciones').update({ estatus: todo.every(Boolean) ? 'recibida' : 'recibida_parcial' }).eq('id', consActiva.id)
      setEtiquetas(construirEtiquetas(paraEtiquetasC, { clienteNombre: cliDe(consActiva.cliente_id)?.nombre }))
      setExito(`Recibo de consigna ${recibo.folio} registrado (costo 0). Material RETENIDO, pendiente de liberacion por Calidad.`)
      setConsActiva(null); setRec({}); await cargarDatos()
    } catch (err) { setError('Error al recibir: ' + err.message) }
    setProcesando(false)
  }

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>

  // ---------- Etiquetas del material recibido ----------
  if (etiquetas.length > 0) {
    return (
      <div style={styles.container} className="aparecer">
        <style>{`@media print { @page { size: ${cfgEtiqueta?.ancho_in || 4}in ${cfgEtiqueta?.alto_in || 2}in; margin: 0; } }`}</style>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }} className="no-imprimir">
          <button style={styles.botonSec} onClick={() => setEtiquetas([])}>&larr; Volver a recibos</button>
          <button style={styles.boton} onClick={imprimirAislado}>Imprimir {etiquetas.length} etiqueta(s)</button>
        </div>
        <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '18px' }} className="no-imprimir">
          Una etiqueta por empaque segun el <b>SNP</b> del articulo (se captura en Articulos &gt; Datos de abastecimiento). El QR contiene el codigo de lote.
        </p>
        <PortalImpresion>
          <div>{etiquetas.map((d, i) => <EtiquetaProducto key={i} datos={d} config={cfgEtiqueta} />)}</div>
        </PortalImpresion>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {etiquetas.map((d, i) => <EtiquetaProducto key={i} datos={d} config={cfgEtiqueta} />)}
        </div>
      </div>
    )
  }

  // ---------- Formulario recibo (OC o consigna) ----------
  const doc = ocActiva || consActiva
  if (doc) {
    const esConsigna = !!consActiva
    const lns = (esConsigna ? consLineasDe(doc.id).filter(l => pendCons(l) > 0) : ocLineasDe(doc.id).filter(l => pendOc(l) > 0)).filter(l => rec[l.id])
    const siteId = esConsigna ? doc.site_id : doc.site_id
    return (
      <div style={styles.container} className="aparecer">
        <button style={styles.volver} onClick={() => { setOcActiva(null); setConsActiva(null) }}>&larr; Volver a recibos</button>
        <h2 style={styles.titulo}>{esConsigna ? `Recibir consigna ${doc.folio}` : `Recibir OC ${doc.folio}`}</h2>
        <p style={{ fontSize: '13px', color: '#64748b', margin: '4px 0 18px' }}>
          {esConsigna ? <>Cliente: <b>{cliDe(doc.cliente_id)?.nombre}</b> - Material en consigna (costo 0). </> : <>Proveedor: <b>{provDe(doc.proveedor_id)?.nombre}</b>. </>}
          El material entra como <b>RETENIDO</b> y lo libera Calidad.
        </p>
        {error && <p style={styles.error}>{error}</p>}
        {lns.map(l => {
          const art = artDe(l.articulo_id)
          const pend = esConsigna ? pendCons(l) : pendOc(l)
          const val = esConsigna ? { ppapOk: true, certReq: false } : validaCalidad(l.articulo_id, doc.proveedor_id)
          const v = rec[l.id] || {}
          return (
            <div key={l.id} style={styles.tarjeta}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span><b>{art?.codigo_interno}</b> - {art?.descripcion}</span>
                <span style={{ fontSize: '13px', color: '#64748b' }}>Pendiente: <b>{fmtNum(pend)}</b> {art?.unidad_medida}</span>
              </div>
              {!val.ppapOk && <p style={styles.bloqueo}>{val.motivo}: no se puede recibir. Calidad debe autorizar desviacion o renovar el PPAP.</p>}
              {val.porDesviacion && <p style={styles.avisoDesv}>Se recibe bajo desviacion de PPAP autorizada por Calidad.</p>}
              <div style={styles.fila}>
                <div style={{ ...styles.campo, flex: 0.7 }}>
                  <label style={styles.label}>Cantidad *</label>
                  <input type="number" min="0" style={styles.input} value={v.cantidad || ''} disabled={!val.ppapOk} onChange={e => setCampo(l.id, 'cantidad', e.target.value)} />
                </div>
                <div style={{ ...styles.campo, flex: 0.9 }}>
                  <label style={styles.label}>Codigo de lote *</label>
                  <input style={styles.input} value={v.codigo_lote || ''} disabled={!val.ppapOk} onChange={e => setCampo(l.id, 'codigo_lote', e.target.value)} placeholder="Lote" />
                </div>
                <div style={styles.campo}>
                  <label style={styles.label}>Almacen destino *</label>
                  <select style={styles.input} value={v.almacen_id || ''} disabled={!val.ppapOk} onChange={e => setCampo(l.id, 'almacen_id', e.target.value)}>
                    <option value="">Selecciona...</option>
                    {almacenes.filter(a => !siteId || a.site_id === siteId).map(a => <option key={a.id} value={a.id}>{a.clave} - {a.nombre}</option>)}
                  </select>
                </div>
                <div style={styles.campo}>
                  <label style={styles.label}>Ubicacion</label>
                  <select style={styles.input} value={v.ubicacion_id || ''} disabled={!val.ppapOk || !v.almacen_id} onChange={e => setCampo(l.id, 'ubicacion_id', e.target.value)}>
                    <option value="">Sin ubicacion</option>
                    {ubisDe(Number(v.almacen_id)).map(u => <option key={u.id} value={u.id}>{u.clave}</option>)}
                  </select>
                </div>
              </div>
              {(val.certReq || esConsigna) && (
                <div style={styles.fila}>
                  <div style={styles.campo}>
                    <label style={styles.label}>Referencia de certificado{val.certReq ? ' *' : ' (opcional)'}</label>
                    <input style={styles.input} value={v.certificado_ref || ''} disabled={!val.ppapOk} onChange={e => setCampo(l.id, 'certificado_ref', e.target.value)} placeholder="No. de certificado / COA" />
                  </div>
                  <div style={styles.campo}>
                    <label style={styles.label}>Archivo del certificado (opcional)</label>
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={styles.input} disabled={!val.ppapOk} onChange={e => setCampo(l.id, 'file', e.target.files[0])} />
                  </div>
                </div>
              )}
            </div>
          )
        })}
        <div style={{ ...styles.campo, margin: '4px 0 16px' }}>
          <label style={styles.label}>Notas del recibo (opcional)</label>
          <input style={styles.input} value={notas} onChange={e => setNotas(e.target.value)} placeholder="Ej. remision, transportista" />
        </div>
        <div style={styles.botones}>
          <button style={styles.botonSec} onClick={() => { setOcActiva(null); setConsActiva(null) }} disabled={procesando}>Cancelar</button>
          <button style={styles.boton} onClick={esConsigna ? confirmarCons : confirmarOc} disabled={procesando}>{procesando ? 'Procesando...' : 'Confirmar recibo'}</button>
        </div>
      </div>
    )
  }

  // ---------- Lista ----------
  return (
    <div style={styles.container} className="aparecer">
      <div style={styles.encabezado}><h2 style={styles.titulo}>Recibos</h2></div>
      <div style={styles.tabs}>
        {[['oc', `OC por recibir${ocsPendientes.length ? ` (${ocsPendientes.length})` : ''}`], ['consigna', `Consigna por recibir${consPendientes.length ? ` (${consPendientes.length})` : ''}`], ['historial', 'Historial']].map(([id, n]) => (
          <button key={id} style={vista === id ? styles.tabActiva : styles.tab} onClick={() => setVista(id)}>{n}</button>
        ))}
      </div>
      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {vista === 'oc' && (
        ocsPendientes.length === 0 ? <p style={{ color: '#666', padding: '10px 4px' }}>No hay ordenes de compra pendientes de recibir.</p> : (
          <div style={styles.tabla}>
            <div style={styles.tablaHeader}>
              <span style={{ flex: 1 }}>Folio OC</span><span style={{ flex: 1.6 }}>Proveedor</span><span style={{ flex: 1 }}>Estatus</span><span style={{ flex: 1 }}>Entrega est.</span><span style={{ flex: 0.8, textAlign: 'center' }}>Lineas pend.</span><span style={{ width: '110px' }}></span>
            </div>
            {ocsPendientes.map(o => {
              const lns = ocLineasDe(o.id).filter(l => pendOc(l) > 0)
              const key = `oc-${o.id}`
              const abierto = expandido === key
              const nSel = nSeleccionadas(key)
              return (
                <div key={o.id}>
                  <div style={{ ...styles.tablaFila, cursor: 'pointer' }} className="fila-hover" onClick={() => abrirDoc(key, lns.map(l => l.id))}>
                    <span style={{ flex: 1, fontWeight: '600' }}>{abierto ? '\u25BC' : '\u25B6'} {o.folio}</span>
                    <span style={{ flex: 1.6 }}>{provDe(o.proveedor_id)?.nombre}</span>
                    <span style={{ flex: 1 }}><span style={{ ...styles.badge, ...styles.badgeAmbar }}>{o.estatus.replace(/_/g, ' ')}</span></span>
                    <span style={{ flex: 1, color: '#64748b' }}>{fmtFecha(o.fecha_entrega_estimada)}</span>
                    <span style={{ flex: 0.8, textAlign: 'center' }}>{abierto && nSel > 0 ? `${nSel}/${lns.length}` : lns.length}</span>
                    <span style={{ width: '110px', textAlign: 'right' }} onClick={ev => ev.stopPropagation()}>
                      {puedeRecibir && <button style={{ ...styles.boton, opacity: abierto && nSel === 0 ? 0.5 : 1 }} disabled={abierto && nSel === 0} onClick={() => abrirOc(o)}>Recibir</button>}
                    </span>
                  </div>
                  {abierto && (
                    <div style={styles.subTabla}>
                      <div style={{ ...styles.tablaHeader, backgroundColor: '#fff' }}>
                        <span style={{ width: '34px' }}>
                          <input type="checkbox" checked={lns.every(l => seleccionadas(key)[l.id])} onChange={() => toggleTodas(key, lns.map(l => l.id))} />
                        </span>
                        <span style={{ flex: 2.4 }}>Articulo</span>
                        <span style={{ flex: 1, textAlign: 'right' }}>Ordenado</span>
                        <span style={{ flex: 1, textAlign: 'right' }}>Recibido</span>
                        <span style={{ flex: 1, textAlign: 'right' }}>Pendiente</span>
                        <span style={{ flex: 0.8 }}>UM</span>
                      </div>
                      {lns.map(l => (
                        <label key={l.id} style={{ ...styles.tablaFila, padding: '8px 20px', fontSize: '13px', cursor: 'pointer' }}>
                          <span style={{ width: '34px' }}>
                            <input type="checkbox" checked={!!seleccionadas(key)[l.id]} onChange={() => toggleLinea(key, l.id)} />
                          </span>
                          <span style={{ flex: 2.4 }}><b>{artDe(l.articulo_id)?.codigo_interno}</b> <span style={{ color: '#64748b' }}>- {l.descripcion || artDe(l.articulo_id)?.descripcion}</span></span>
                          <span style={{ flex: 1, textAlign: 'right' }}>{fmtNum(l.cantidad)}</span>
                          <span style={{ flex: 1, textAlign: 'right', color: '#16a34a' }}>{fmtNum(l.cantidad_recibida || 0)}</span>
                          <span style={{ flex: 1, textAlign: 'right', fontWeight: '600', color: '#b45309' }}>{fmtNum(pendOc(l))}</span>
                          <span style={{ flex: 0.8, color: '#64748b' }}>{l.unidad_medida}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      )}

      {vista === 'consigna' && (
        consPendientes.length === 0 ? <p style={{ color: '#666', padding: '10px 4px' }}>No hay autorizaciones de consigna aprobadas pendientes de recibir.</p> : (
          <div style={styles.tabla}>
            <div style={styles.tablaHeader}>
              <span style={{ flex: 1 }}>Folio</span><span style={{ flex: 1.6 }}>Cliente</span><span style={{ flex: 1.3 }}>Referencia</span><span style={{ flex: 1 }}>Estatus</span><span style={{ flex: 0.8, textAlign: 'center' }}>Lineas pend.</span><span style={{ width: '110px' }}></span>
            </div>
            {consPendientes.map(c => {
              const lns = consLineasDe(c.id).filter(l => pendCons(l) > 0)
              const key = `cons-${c.id}`
              const abierto = expandido === key
              const nSel = nSeleccionadas(key)
              return (
                <div key={c.id}>
                  <div style={{ ...styles.tablaFila, cursor: 'pointer' }} className="fila-hover" onClick={() => abrirDoc(key, lns.map(l => l.id))}>
                    <span style={{ flex: 1, fontWeight: '600' }}>{abierto ? '\u25BC' : '\u25B6'} {c.folio}</span>
                    <span style={{ flex: 1.6 }}>{cliDe(c.cliente_id)?.nombre}</span>
                    <span style={{ flex: 1.3, color: '#64748b', fontSize: '13px' }}>{c.referencia || '-'}</span>
                    <span style={{ flex: 1 }}><span style={{ ...styles.badge, ...styles.badgeAzul }}>{c.estatus.replace(/_/g, ' ')}</span></span>
                    <span style={{ flex: 0.8, textAlign: 'center' }}>{abierto && nSel > 0 ? `${nSel}/${lns.length}` : lns.length}</span>
                    <span style={{ width: '110px', textAlign: 'right' }} onClick={ev => ev.stopPropagation()}>
                      {puedeRecibir && <button style={{ ...styles.boton, opacity: abierto && nSel === 0 ? 0.5 : 1 }} disabled={abierto && nSel === 0} onClick={() => abrirCons(c)}>Recibir</button>}
                    </span>
                  </div>
                  {abierto && (
                    <div style={styles.subTabla}>
                      <div style={{ ...styles.tablaHeader, backgroundColor: '#fff' }}>
                        <span style={{ width: '34px' }}>
                          <input type="checkbox" checked={lns.every(l => seleccionadas(key)[l.id])} onChange={() => toggleTodas(key, lns.map(l => l.id))} />
                        </span>
                        <span style={{ flex: 2.4 }}>Articulo</span>
                        <span style={{ flex: 1, textAlign: 'right' }}>Autorizado</span>
                        <span style={{ flex: 1, textAlign: 'right' }}>Recibido</span>
                        <span style={{ flex: 1, textAlign: 'right' }}>Pendiente</span>
                        <span style={{ flex: 0.9, textAlign: 'center' }}>Fecha / Tipo</span>
                      </div>
                      {lns.map(l => (
                        <label key={l.id} style={{ ...styles.tablaFila, padding: '8px 20px', fontSize: '13px', cursor: 'pointer' }}>
                          <span style={{ width: '34px' }}>
                            <input type="checkbox" checked={!!seleccionadas(key)[l.id]} onChange={() => toggleLinea(key, l.id)} />
                          </span>
                          <span style={{ flex: 2.4 }}><b>{artDe(l.articulo_id)?.codigo_interno}</b> <span style={{ color: '#64748b' }}>- {artDe(l.articulo_id)?.descripcion}</span></span>
                          <span style={{ flex: 1, textAlign: 'right' }}>{fmtNum(l.cantidad)}</span>
                          <span style={{ flex: 1, textAlign: 'right', color: '#16a34a' }}>{fmtNum(l.cantidad_recibida || 0)}</span>
                          <span style={{ flex: 1, textAlign: 'right', fontWeight: '600', color: '#b45309' }}>{fmtNum(pendCons(l))}</span>
                          <span style={{ flex: 0.9, textAlign: 'center', color: '#64748b' }}>{fmtFecha(l.fecha_sugerida)} / {l.tipo}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      )}

      {vista === 'historial' && (
        recibos.length === 0 ? <p style={{ color: '#666', padding: '10px 4px' }}>Aun no hay recibos.</p> : (
          <div style={styles.tabla}>
            <div style={styles.tablaHeader}>
              <span style={{ flex: 1 }}>Folio</span><span style={{ flex: 1 }}>Origen</span><span style={{ flex: 1.6 }}>Proveedor / Cliente</span><span style={{ flex: 1.3 }}>Fecha</span><span style={{ flex: 1.3 }}>Recibio</span><span style={{ flex: 1.2 }}>Notas</span><span style={{ width: '110px' }}></span>
            </div>
            {recibos.map(r => (
              <div key={r.id} style={{ ...styles.tablaFila, fontSize: '13px' }} className="fila-hover">
                <span style={{ flex: 1, fontWeight: '600' }}>{r.folio}</span>
                <span style={{ flex: 1 }}>{r.oc?.folio ? `OC ${r.oc.folio}` : r.cons?.folio ? `Consigna ${r.cons.folio}` : '-'}</span>
                <span style={{ flex: 1.6 }}>{r.prov?.nombre || '-'}</span>
                <span style={{ flex: 1.3, color: '#64748b' }}>{new Date(r.fecha).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}</span>
                <span style={{ flex: 1.3, color: '#64748b' }}>{r.usuario?.nombre}</span>
                <span style={{ flex: 1.2, color: '#64748b' }}>{r.notas || '-'}</span>
                <span style={{ width: '110px', textAlign: 'right' }}>
                  <button style={styles.botonAccion} onClick={() => reimprimir(r)}>Etiquetas</button>
                </span>
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
  volver: { padding: '6px 14px', backgroundColor: 'transparent', color: '#2563eb', border: '1px solid #2563eb', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', marginBottom: '14px' },
  tabs: { display: 'flex', gap: '4px', marginBottom: '16px', borderBottom: '1px solid #e2e8f0' },
  tab: { padding: '8px 16px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#64748b', cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabActiva: { padding: '8px 16px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#2563eb', fontWeight: '600', cursor: 'pointer', borderBottom: '2px solid #2563eb' },
  tarjeta: { backgroundColor: '#fff', borderRadius: '10px', padding: '18px 20px', marginBottom: '14px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  fila: { display: 'flex', gap: '14px', marginBottom: '10px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', fontFamily: 'inherit', backgroundColor: '#fff' },
  botones: { display: 'flex', justifyContent: 'flex-end', gap: '10px' },
  boton: { padding: '8px 18px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSec: { padding: '8px 18px', backgroundColor: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '11px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  subTabla: { backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', padding: '2px 0 6px' },
  bloqueo: { backgroundColor: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '7px', padding: '8px 12px', color: '#b91c1c', fontSize: '13px', margin: '0 0 10px' },
  avisoDesv: { backgroundColor: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '7px', padding: '8px 12px', color: '#92400e', fontSize: '13px', margin: '0 0 10px' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '600' },
  badgeAmbar: { backgroundColor: '#fef3c7', color: '#b45309' },
  badgeAzul: { backgroundColor: '#dbeafe', color: '#2563eb' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
