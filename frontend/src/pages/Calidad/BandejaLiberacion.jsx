import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Bandeja de liberacion de lotes (Calidad). Lista todo lo RETENIDO con existencia > 0
// para que Calidad libere o rechace. La accion cambia el estatus del lote (no lo mueve)
// y queda en la bitacora de movimientos. Requisito de control IATF.

const fmtNum = (n) => (Number(n) || 0).toLocaleString('es-MX')
const fmtFecha = (f) => f ? new Date(f).toLocaleDateString('es-MX') : '-'
const NOMBRE_ORIGEN = { inicial: 'Inicial', produccion: 'Produccion', compra: 'Compra', ajuste: 'Ajuste' }

export default function BandejaLiberacion() {
  const { perfil, tienePermiso } = useAuth()
  const puedeLiberar = tienePermiso('cal_bandeja', 'aprobar')

  const [articulos, setArticulos] = useState([])
  const [almacenes, setAlmacenes] = useState([])
  const [ubicaciones, setUbicaciones] = useState([])
  const [lotes, setLotes] = useState([])
  const [existencias, setExistencias] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [procesando, setProcesando] = useState(false)
  const [filtro, setFiltro] = useState('retenido')
  const [texto, setTexto] = useState('')
  const [accion, setAccion] = useState(null) // { lote, tipo: 'liberado'|'rechazado', nota }

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    const [art, alm, ubi, lot, ex] = await Promise.all([
      supabase.from('articulos').select('id, codigo_interno, descripcion, unidad_medida, origen, es_consigna').eq('empresa_id', perfil.empresa_id),
      supabase.from('almacenes').select('id, clave'),
      supabase.from('ubicaciones').select('id, clave'),
      supabase.from('lotes').select('*, liberador:usuarios!lotes_liberado_por_fkey(nombre)').order('fecha', { ascending: false }),
      supabase.from('existencias').select('*'),
    ])
    setArticulos(art.data || [])
    setAlmacenes(alm.data || [])
    setUbicaciones(ubi.data || [])
    setLotes(lot.data || [])
    setExistencias(ex.data || [])
    setLoading(false)
  }

  const artDe = (id) => articulos.find(a => a.id === id)
  const almDe = (id) => almacenes.find(a => a.id === id)
  const ubiDe = (id) => ubicaciones.find(u => u.id === id)
  const exDe = (loteId) => existencias.filter(e => e.lote_id === loteId)
  const totalDe = (loteId) => exDe(loteId).reduce((s, e) => s + Number(e.cantidad), 0)
  const ubicacionesTexto = (loteId) => exDe(loteId).map(e => `${almDe(e.almacen_id)?.clave || '?'}${e.ubicacion_id ? '/' + (ubiDe(e.ubicacion_id)?.clave || '') : ''} (${fmtNum(e.cantidad)})`).join(', ')

  const confirmar = async () => {
    const { lote, tipo, nota } = accion
    setProcesando(true); setError('')
    try {
      const patch = { estatus_calidad: tipo }
      if (tipo === 'liberado') { patch.liberado_por = perfil.id; patch.liberado_en = new Date().toISOString() }
      const { error: e1 } = await supabase.from('lotes').update(patch).eq('id', lote.id)
      if (e1) throw e1
      await supabase.from('movimientos').insert({
        empresa_id: perfil.empresa_id, articulo_id: lote.articulo_id, lote_id: lote.id,
        tipo: tipo === 'liberado' ? 'liberacion_calidad' : 'rechazo_calidad',
        cantidad: totalDe(lote.id), motivo: nota?.trim() || null, usuario_id: perfil.id,
      })
      setExito(tipo === 'liberado' ? `Lote ${lote.codigo_lote} liberado` : `Lote ${lote.codigo_lote} rechazado`)
      setAccion(null)
      await cargarDatos()
    } catch (err) { setError('Error: ' + err.message) }
    setProcesando(false)
  }

  // Lotes con existencia > 0, filtrados por estatus y texto
  const lista = lotes
    .map(l => ({ ...l, _art: artDe(l.articulo_id), _total: totalDe(l.id) }))
    .filter(l => l._art && l._total > 0)
    .filter(l => filtro === 'todos' || l.estatus_calidad === filtro)
    .filter(l => {
      if (!texto) return true
      const t = texto.toLowerCase()
      return l._art.codigo_interno.toLowerCase().includes(t) || l._art.descripcion.toLowerCase().includes(t) || l.codigo_lote.toLowerCase().includes(t)
    })

  const nRetenidos = lotes.filter(l => l.estatus_calidad === 'retenido' && totalDe(l.id) > 0).length
  const badgeCal = (est) => est === 'liberado' ? styles.badgeVerde : est === 'rechazado' ? styles.badgeRojo : styles.badgeAmbar
  const NOMBRE_CAL = { retenido: 'Retenido', liberado: 'Liberado', rechazado: 'Rechazado' }

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>

  return (
    <div style={styles.container} className="aparecer">
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Liberacion de Lotes</h2>
        <span style={{ fontSize: '13px', color: nRetenidos ? '#b45309' : '#16a34a', fontWeight: '600' }}>
          {nRetenidos} lote(s) retenidos por liberar
        </span>
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}
      {!puedeLiberar && <p style={{ ...styles.error, color: '#b45309' }}>Tu rol puede consultar pero no liberar lotes.</p>}

      <div style={styles.filtros}>
        <input style={{ ...styles.input, flex: 1 }} placeholder="Buscar articulo o lote..." value={texto} onChange={e => setTexto(e.target.value)} />
        <select style={styles.input} value={filtro} onChange={e => setFiltro(e.target.value)}>
          <option value="retenido">Solo retenidos</option>
          <option value="liberado">Liberados</option>
          <option value="rechazado">Rechazados</option>
          <option value="todos">Todos</option>
        </select>
      </div>

      {lista.length === 0 ? (
        <p style={{ color: '#666', padding: '10px 4px' }}>{filtro === 'retenido' ? 'No hay lotes retenidos pendientes de liberar.' : 'Sin resultados.'}</p>
      ) : (
        <div style={styles.tabla}>
          <div style={styles.tablaHeader}>
            <span style={{ flex: 2.2 }}>Articulo</span>
            <span style={{ flex: 1.1 }}>Lote</span>
            <span style={{ flex: 0.9 }}>Origen</span>
            <span style={{ flex: 0.9 }}>Fecha</span>
            <span style={{ flex: 1, textAlign: 'right' }}>Cantidad</span>
            <span style={{ flex: 1.8 }}>Ubicaciones</span>
            <span style={{ flex: 0.9, textAlign: 'center' }}>Estatus</span>
            <span style={{ width: '160px' }}></span>
          </div>
          {lista.map(l => (
            <div key={l.id} style={{ ...styles.tablaFila, fontSize: '13px' }} className="fila-hover">
              <span style={{ flex: 2.2 }}><b>{l._art.codigo_interno}</b> <span style={{ color: '#64748b' }}>- {l._art.descripcion}</span></span>
              <span style={{ flex: 1.1, fontWeight: '600' }}>{l.codigo_lote}</span>
              <span style={{ flex: 0.9, color: '#64748b' }}>{NOMBRE_ORIGEN[l.origen] || l.origen}</span>
              <span style={{ flex: 0.9, color: '#64748b' }}>{fmtFecha(l.fecha)}</span>
              <span style={{ flex: 1, textAlign: 'right', fontWeight: '600' }}>{fmtNum(l._total)} {l._art.unidad_medida || ''}</span>
              <span style={{ flex: 1.8, color: '#64748b', fontSize: '12px' }}>{ubicacionesTexto(l.id)}</span>
              <span style={{ flex: 0.9, textAlign: 'center' }}>
                <span style={{ ...styles.badge, ...badgeCal(l.estatus_calidad) }}>{NOMBRE_CAL[l.estatus_calidad]}</span>
                {l.estatus_calidad === 'liberado' && l.liberador && <span style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>{l.liberador.nombre}</span>}
              </span>
              <span style={{ width: '160px', textAlign: 'right', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                {puedeLiberar && l.estatus_calidad === 'retenido' && (
                  <>
                    <button style={{ ...styles.botonAccion, color: '#16a34a', borderColor: '#bbf7d0' }} onClick={() => { setError(''); setAccion({ lote: l, tipo: 'liberado', nota: '' }) }}>Liberar</button>
                    <button style={{ ...styles.botonAccion, color: '#dc2626', borderColor: '#fecaca' }} onClick={() => { setError(''); setAccion({ lote: l, tipo: 'rechazado', nota: '' }) }}>Rechazar</button>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {accion && (
        <div style={styles.overlay} onClick={() => setAccion(null)}>
          <div style={styles.modal} onClick={ev => ev.stopPropagation()}>
            <h3 style={styles.formTitulo}>{accion.tipo === 'liberado' ? 'Liberar lote' : 'Rechazar lote'}</h3>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 14px' }}>
              {artDe(accion.lote.articulo_id)?.codigo_interno} - Lote <b>{accion.lote.codigo_lote}</b> ({fmtNum(totalDe(accion.lote.id))} {artDe(accion.lote.articulo_id)?.unidad_medida || ''})
            </p>
            <div style={{ ...styles.campo, marginBottom: '16px' }}>
              <label style={styles.label}>{accion.tipo === 'liberado' ? 'Nota / referencia de dictamen (opcional)' : 'Motivo del rechazo *'}</label>
              <input style={styles.input} value={accion.nota} onChange={e => setAccion({ ...accion, nota: e.target.value })} placeholder={accion.tipo === 'liberado' ? 'Ej. certificado OK, inspeccion conforme' : 'Ej. fuera de especificacion'} autoFocus />
            </div>
            <div style={styles.botones}>
              <button style={styles.botonSec} onClick={() => setAccion(null)} disabled={procesando}>Cancelar</button>
              <button
                style={{ ...styles.boton, backgroundColor: accion.tipo === 'liberado' ? '#16a34a' : '#dc2626', opacity: (accion.tipo === 'rechazado' && !accion.nota.trim()) ? 0.5 : 1 }}
                disabled={procesando || (accion.tipo === 'rechazado' && !accion.nota.trim())}
                onClick={confirmar}>
                {procesando ? 'Guardando...' : accion.tipo === 'liberado' ? 'Confirmar liberacion' : 'Confirmar rechazo'}
              </button>
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
  filtros: { display: 'flex', gap: '10px', marginBottom: '16px', backgroundColor: '#fff', borderRadius: '10px', padding: '14px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', alignItems: 'center' },
  input: { padding: '8px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '13px', outline: 'none', fontFamily: 'inherit', backgroundColor: '#fff' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  botones: { display: 'flex', justifyContent: 'flex-end', gap: '10px' },
  boton: { padding: '9px 20px', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSec: { padding: '9px 20px', backgroundColor: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#fff', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer', fontWeight: '600' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '11px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  modal: { backgroundColor: '#fff', borderRadius: '12px', padding: '28px', width: '520px', maxWidth: '92vw', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' },
  formTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 16px 0' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '600' },
  badgeVerde: { backgroundColor: '#dcfce7', color: '#16a34a' },
  badgeRojo: { backgroundColor: '#fee2e2', color: '#dc2626' },
  badgeAmbar: { backgroundColor: '#fef3c7', color: '#b45309' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
