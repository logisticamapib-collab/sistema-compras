import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Capa 3 - Recibos contra OC. Recibe fisicamente contra una orden de compra:
// genera lote RETENIDO, existencia en almacen/ubicacion, movimiento de entrada,
// y actualiza el flujo de la OC (cantidad_recibida, oc_seguimiento, estatus).
// Valida requisitos de calidad del proveedor: certificado obligatorio si aplica,
// y PPAP vigente (o desviacion autorizada por Calidad) para poder recibir.

const fmtNum = (n) => (Number(n) || 0).toLocaleString('es-MX')
const fmtFecha = (f) => f ? new Date(f).toLocaleDateString('es-MX') : '-'
const hoy = () => new Date().toISOString().split('T')[0]

const RECIBIBLES = ['aprobada', 'enviada_proveedor', 'confirmada', 'en_transito', 'recibida_parcial']

export default function Recibos() {
  const { perfil, tienePermiso } = useAuth()
  const puedeRecibir = tienePermiso('log_recibos', 'crear')

  const [vista, setVista] = useState('pendientes')
  const [ocs, setOcs] = useState([])
  const [lineas, setLineas] = useState([])
  const [proveedores, setProveedores] = useState([])
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
  const [rec, setRec] = useState({}) // { [ocLineaId]: { cantidad, codigo_lote, almacen_id, ubicacion_id, certificado_ref, file } }
  const [notas, setNotas] = useState('')
  const [procesando, setProcesando] = useState(false)

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    const [o, l, p, a, alm, ubi, rp, d, r] = await Promise.all([
      supabase.from('ordenes_compra').select('*').eq('empresa_id', perfil.empresa_id).in('estatus', RECIBIBLES).order('fecha_emision', { ascending: false }),
      supabase.from('oc_lineas').select('*'),
      supabase.from('proveedores').select('id, nombre'),
      supabase.from('articulos').select('id, codigo_interno, descripcion, unidad_medida, es_consigna'),
      supabase.from('almacenes').select('*').eq('activo', true),
      supabase.from('ubicaciones').select('*').eq('activo', true),
      supabase.from('articulo_proveedor').select('*').eq('activo', true),
      supabase.from('desviaciones_ppap').select('*').eq('activo', true),
      supabase.from('recibos').select('*, prov:proveedores(nombre), oc:ordenes_compra(folio), usuario:usuarios!recibos_recibido_por_fkey(nombre)').order('fecha', { ascending: false }).limit(100),
    ])
    setOcs(o.data || [])
    setLineas(l.data || [])
    setProveedores(p.data || [])
    setArticulos(a.data || [])
    setAlmacenes(alm.data || [])
    setUbicaciones(ubi.data || [])
    setRelProv(rp.data || [])
    setDesviaciones(d.data || [])
    setRecibos(r.data || [])
    setLoading(false)
  }

  const artDe = (id) => articulos.find(a => a.id === id)
  const provDe = (id) => proveedores.find(p => p.id === id)
  const almDe = (id) => almacenes.find(a => a.id === id)
  const lineasDe = (ocId) => lineas.filter(l => l.oc_id === ocId)
  const pendienteDe = (l) => Number(l.cantidad) - Number(l.cantidad_recibida || 0)
  const ubisDe = (almId) => ubicaciones.filter(u => u.almacen_id === almId)

  // OCs con pendiente por recibir
  const ocsPendientes = ocs.filter(o => lineasDe(o.id).some(l => pendienteDe(l) > 0))

  // Estado de calidad del articulo-proveedor
  const requisitoDe = (articuloId, proveedorId) => relProv.find(r => r.articulo_id === articuloId && r.proveedor_id === proveedorId)
  const desviacionActiva = (articuloId, proveedorId) => desviaciones.find(d => d.articulo_id === articuloId && d.proveedor_id === proveedorId && d.vigente_hasta >= hoy())

  // { ppapOk, certReq, motivo }
  const validaCalidad = (articuloId, proveedorId) => {
    const req = requisitoDe(articuloId, proveedorId)
    const certReq = !!req?.requiere_certificado
    if (!req?.requiere_ppap) return { ppapOk: true, certReq, desvId: null }
    if (req.ppap_vigencia && req.ppap_vigencia >= hoy()) return { ppapOk: true, certReq, desvId: null }
    const desv = desviacionActiva(articuloId, proveedorId)
    if (desv) return { ppapOk: true, certReq, desvId: desv.id, porDesviacion: true }
    return { ppapOk: false, certReq, desvId: null, motivo: !req.ppap_vigencia ? 'PPAP faltante' : 'PPAP vencido' }
  }

  const abrirRecibo = (oc) => {
    setError(''); setExito(''); setOcActiva(oc); setNotas('')
    const ini = {}
    lineasDe(oc.id).filter(l => pendienteDe(l) > 0).forEach(l => {
      ini[l.id] = { cantidad: '', codigo_lote: '', almacen_id: '', ubicacion_id: '', certificado_ref: '', file: null }
    })
    setRec(ini)
  }

  const setCampo = (lineaId, campo, valor) => setRec(r => ({ ...r, [lineaId]: { ...r[lineaId], [campo]: valor } }))

  const subirCertificado = async (file) => {
    const nombre = `recibos/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { error: e } = await supabase.storage.from('calidad').upload(nombre, file)
    if (e) throw new Error('No se pudo subir el certificado: ' + e.message)
    return supabase.storage.from('calidad').getPublicUrl(nombre).data.publicUrl
  }

  const confirmar = async () => {
    setError('')
    const items = Object.entries(rec)
      .map(([lineaId, v]) => ({ lineaId: Number(lineaId), ...v, cant: Number(v.cantidad) }))
      .filter(x => x.cant > 0)
    if (items.length === 0) { setError('Captura al menos una cantidad a recibir'); return }

    // Validaciones por linea
    for (const it of items) {
      const l = lineas.find(x => x.id === it.lineaId)
      const art = artDe(l.articulo_id)
      if (it.cant > pendienteDe(l)) { setError(`${art?.codigo_interno}: la cantidad excede lo pendiente (${fmtNum(pendienteDe(l))})`); return }
      if (!it.codigo_lote.trim()) { setError(`${art?.codigo_interno}: captura el codigo de lote`); return }
      if (!it.almacen_id) { setError(`${art?.codigo_interno}: selecciona almacen destino`); return }
      const val = validaCalidad(l.articulo_id, ocActiva.proveedor_id)
      if (!val.ppapOk) { setError(`${art?.codigo_interno}: ${val.motivo}. Calidad debe autorizar una desviacion o renovar el PPAP antes de recibir`); return }
      if (val.certReq && !it.certificado_ref.trim()) { setError(`${art?.codigo_interno}: requiere referencia de certificado de calidad`); return }
    }

    setProcesando(true)
    try {
      const { data: recibo, error: e0 } = await supabase.from('recibos').insert({
        empresa_id: perfil.empresa_id, folio: `REC-${Date.now().toString().slice(-8)}`,
        oc_id: ocActiva.id, proveedor_id: ocActiva.proveedor_id, site_id: ocActiva.site_id,
        recibido_por: perfil.id, notas: notas || null,
      }).select().single()
      if (e0) throw e0

      const detalleSeg = []
      for (const it of items) {
        const l = lineas.find(x => x.id === it.lineaId)
        const val = validaCalidad(l.articulo_id, ocActiva.proveedor_id)
        let certUrl = null
        if (it.file) certUrl = await subirCertificado(it.file)
        // Lote retenido
        const { data: lote, error: e1 } = await supabase.from('lotes').insert({
          empresa_id: perfil.empresa_id, articulo_id: l.articulo_id, codigo_lote: it.codigo_lote.trim(),
          origen: 'compra', estatus_calidad: 'retenido', creado_por: perfil.id,
        }).select().single()
        if (e1) throw (e1.message.includes('duplicate') ? new Error(`El lote "${it.codigo_lote.trim()}" ya existe`) : e1)
        await supabase.from('existencias').insert({ lote_id: lote.id, almacen_id: Number(it.almacen_id), ubicacion_id: it.ubicacion_id ? Number(it.ubicacion_id) : null, cantidad: it.cant })
        await supabase.from('movimientos').insert({
          empresa_id: perfil.empresa_id, articulo_id: l.articulo_id, lote_id: lote.id, tipo: 'entrada_inicial',
          almacen_destino_id: Number(it.almacen_id), ubicacion_destino_id: it.ubicacion_id ? Number(it.ubicacion_id) : null,
          cantidad: it.cant, motivo: `Recibo ${recibo.folio} / OC ${ocActiva.folio}`, usuario_id: perfil.id,
        })
        await supabase.from('recibo_lineas').insert({
          recibo_id: recibo.id, oc_linea_id: l.id, articulo_id: l.articulo_id, cantidad: it.cant, lote_id: lote.id,
          almacen_id: Number(it.almacen_id), ubicacion_id: it.ubicacion_id ? Number(it.ubicacion_id) : null,
          certificado_ref: it.certificado_ref.trim() || null, certificado_url: certUrl,
          ppap_estado: val.porDesviacion ? 'desviacion' : (requisitoDe(l.articulo_id, ocActiva.proveedor_id)?.requiere_ppap ? 'vigente' : 'no_requiere'),
          desviacion_id: val.desvId,
        })
        // Actualiza OC
        await supabase.from('oc_lineas').update({ cantidad_recibida: Number(l.cantidad_recibida || 0) + it.cant }).eq('id', l.id)
        detalleSeg.push({ oc_linea_id: l.id, cantidad: it.cant })
      }

      // Seguimiento de la OC + estatus
      const { data: seg } = await supabase.from('oc_seguimiento').insert({
        oc_id: ocActiva.id, evento: 'recibo', usuario_id: perfil.id,
        comentario: `Recibo ${recibo.folio}: ${items.length} linea(s) a inventario (retenido, pendiente liberacion de Calidad)`,
      }).select().single()
      if (seg) {
        for (const d of detalleSeg) {
          await supabase.from('oc_seguimiento_detalle').insert({ seguimiento_id: seg.id, oc_id: ocActiva.id, oc_linea_id: d.oc_linea_id, cantidad_recibida: d.cantidad })
        }
      }
      // Recalcular estatus: recibida si todas las lineas completas
      const lineasFrescas = lineasDe(ocActiva.id).map(l => {
        const it = items.find(i => i.lineaId === l.id)
        const recTotal = Number(l.cantidad_recibida || 0) + (it ? it.cant : 0)
        return recTotal >= Number(l.cantidad)
      })
      const nuevoEstatus = lineasFrescas.every(Boolean) ? 'recibida' : 'recibida_parcial'
      await supabase.from('ordenes_compra').update({ estatus: nuevoEstatus, fecha_entrega_real: hoy() }).eq('id', ocActiva.id)

      setExito(`Recibo ${recibo.folio} registrado. Material en inventario como RETENIDO, pendiente de liberacion por Calidad.`)
      setOcActiva(null); setRec({})
      await cargarDatos()
    } catch (err) {
      setError('Error al recibir: ' + err.message)
    }
    setProcesando(false)
  }

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>

  // ---------- Vista formulario de recibo ----------
  if (ocActiva) {
    const lns = lineasDe(ocActiva.id).filter(l => pendienteDe(l) > 0)
    return (
      <div style={styles.container} className="aparecer">
        <button style={styles.volver} onClick={() => setOcActiva(null)}>&larr; Volver a recibos</button>
        <h2 style={styles.titulo}>Recibir OC {ocActiva.folio}</h2>
        <p style={{ fontSize: '13px', color: '#64748b', margin: '4px 0 18px' }}>
          Proveedor: <b>{provDe(ocActiva.proveedor_id)?.nombre}</b> - El material entra como <b>RETENIDO</b> y lo libera Calidad.
        </p>
        {error && <p style={styles.error}>{error}</p>}

        {lns.map(l => {
          const art = artDe(l.articulo_id)
          const val = validaCalidad(l.articulo_id, ocActiva.proveedor_id)
          const v = rec[l.id] || {}
          return (
            <div key={l.id} style={styles.tarjeta}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span><b>{art?.codigo_interno}</b> - {art?.descripcion} {art?.es_consigna && <span style={{ ...styles.badge, ...styles.badgeGris }}>Consigna</span>}</span>
                <span style={{ fontSize: '13px', color: '#64748b' }}>Pendiente: <b>{fmtNum(pendienteDe(l))}</b> {l.unidad_medida}</span>
              </div>
              {!val.ppapOk && (
                <p style={styles.bloqueo}>{val.motivo}: no se puede recibir. Calidad debe autorizar una desviacion o renovar el PPAP.</p>
              )}
              {val.porDesviacion && <p style={styles.avisoDesv}>Se recibe bajo desviacion de PPAP autorizada por Calidad.</p>}
              <div style={styles.fila}>
                <div style={{ ...styles.campo, flex: 0.7 }}>
                  <label style={styles.label}>Cantidad *</label>
                  <input type="number" min="0" style={styles.input} value={v.cantidad || ''} disabled={!val.ppapOk} onChange={e => setCampo(l.id, 'cantidad', e.target.value)} />
                </div>
                <div style={{ ...styles.campo, flex: 0.9 }}>
                  <label style={styles.label}>Codigo de lote *</label>
                  <input style={styles.input} value={v.codigo_lote || ''} disabled={!val.ppapOk} onChange={e => setCampo(l.id, 'codigo_lote', e.target.value)} placeholder="Lote del proveedor" />
                </div>
                <div style={styles.campo}>
                  <label style={styles.label}>Almacen destino *</label>
                  <select style={styles.input} value={v.almacen_id || ''} disabled={!val.ppapOk} onChange={e => setCampo(l.id, 'almacen_id', e.target.value)}>
                    <option value="">Selecciona...</option>
                    {almacenes.filter(a => a.site_id === ocActiva.site_id).map(a => <option key={a.id} value={a.id}>{a.clave} - {a.nombre}</option>)}
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
              {val.certReq && (
                <div style={styles.fila}>
                  <div style={styles.campo}>
                    <label style={styles.label}>Referencia de certificado de calidad *</label>
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
          <button style={styles.botonSec} onClick={() => setOcActiva(null)} disabled={procesando}>Cancelar</button>
          <button style={styles.boton} onClick={confirmar} disabled={procesando}>{procesando ? 'Procesando...' : 'Confirmar recibo'}</button>
        </div>
      </div>
    )
  }

  // ---------- Vista lista ----------
  return (
    <div style={styles.container} className="aparecer">
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Recibos</h2>
      </div>
      <div style={styles.tabs}>
        {[['pendientes', `OC por recibir${ocsPendientes.length ? ` (${ocsPendientes.length})` : ''}`], ['historial', 'Historial de recibos']].map(([id, n]) => (
          <button key={id} style={vista === id ? styles.tabActiva : styles.tab} onClick={() => setVista(id)}>{n}</button>
        ))}
      </div>
      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {vista === 'pendientes' && (
        ocsPendientes.length === 0 ? (
          <p style={{ color: '#666', padding: '10px 4px' }}>No hay ordenes de compra pendientes de recibir.</p>
        ) : (
          <div style={styles.tabla}>
            <div style={styles.tablaHeader}>
              <span style={{ flex: 1 }}>Folio OC</span>
              <span style={{ flex: 1.6 }}>Proveedor</span>
              <span style={{ flex: 1 }}>Estatus</span>
              <span style={{ flex: 1 }}>Entrega estimada</span>
              <span style={{ flex: 0.8, textAlign: 'center' }}>Lineas pend.</span>
              <span style={{ width: '110px' }}></span>
            </div>
            {ocsPendientes.map(o => {
              const pend = lineasDe(o.id).filter(l => pendienteDe(l) > 0).length
              return (
                <div key={o.id} style={styles.tablaFila} className="fila-hover">
                  <span style={{ flex: 1, fontWeight: '600' }}>{o.folio}</span>
                  <span style={{ flex: 1.6 }}>{provDe(o.proveedor_id)?.nombre}</span>
                  <span style={{ flex: 1 }}><span style={{ ...styles.badge, ...styles.badgeAmbar }}>{o.estatus.replace(/_/g, ' ')}</span></span>
                  <span style={{ flex: 1, color: '#64748b' }}>{fmtFecha(o.fecha_entrega_estimada)}</span>
                  <span style={{ flex: 0.8, textAlign: 'center' }}>{pend}</span>
                  <span style={{ width: '110px', textAlign: 'right' }}>
                    {puedeRecibir && <button style={styles.boton} onClick={() => abrirRecibo(o)}>Recibir</button>}
                  </span>
                </div>
              )
            })}
          </div>
        )
      )}

      {vista === 'historial' && (
        recibos.length === 0 ? (
          <p style={{ color: '#666', padding: '10px 4px' }}>Aun no hay recibos.</p>
        ) : (
          <div style={styles.tabla}>
            <div style={styles.tablaHeader}>
              <span style={{ flex: 1 }}>Folio</span>
              <span style={{ flex: 1 }}>OC</span>
              <span style={{ flex: 1.6 }}>Proveedor</span>
              <span style={{ flex: 1.3 }}>Fecha</span>
              <span style={{ flex: 1.3 }}>Recibio</span>
              <span style={{ flex: 1.6 }}>Notas</span>
            </div>
            {recibos.map(r => (
              <div key={r.id} style={{ ...styles.tablaFila, fontSize: '13px' }} className="fila-hover">
                <span style={{ flex: 1, fontWeight: '600' }}>{r.folio}</span>
                <span style={{ flex: 1 }}>{r.oc?.folio}</span>
                <span style={{ flex: 1.6 }}>{r.prov?.nombre}</span>
                <span style={{ flex: 1.3, color: '#64748b' }}>{new Date(r.fecha).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}</span>
                <span style={{ flex: 1.3, color: '#64748b' }}>{r.usuario?.nombre}</span>
                <span style={{ flex: 1.6, color: '#64748b' }}>{r.notas || '-'}</span>
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
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '11px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  bloqueo: { backgroundColor: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '7px', padding: '8px 12px', color: '#b91c1c', fontSize: '13px', margin: '0 0 10px' },
  avisoDesv: { backgroundColor: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '7px', padding: '8px 12px', color: '#92400e', fontSize: '13px', margin: '0 0 10px' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '600', marginLeft: '6px' },
  badgeAmbar: { backgroundColor: '#fef3c7', color: '#b45309' },
  badgeGris: { backgroundColor: '#f1f5f9', color: '#64748b' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
