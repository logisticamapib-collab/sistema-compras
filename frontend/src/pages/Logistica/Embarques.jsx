import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import PortalImpresion from '../../components/PortalImpresion'
import { imprimirAislado } from '../../lib/impresion'

// Embarques: surte producto terminado contra el release del cliente.
// - Solo lotes LIBERADOS por Calidad (candado de calidad al embarcar).
// - Asignacion FIFO automatica de lotes, editable por linea.
// - Al confirmar descuenta inventario, registra el movimiento de salida y
//   la entrega en el release (release_entregas), que alimenta el estatus
//   Cubierta/Parcial/Vencida de Customer Service.

const fmtNum = (n) => (Number(n) || 0).toLocaleString('es-MX')
const fmtFecha = (f) => f ? new Date(f + 'T00:00:00').toLocaleDateString('es-MX') : '-'
const hoy = () => new Date().toISOString().split('T')[0]

export default function Embarques() {
  const { perfil, tienePermiso } = useAuth()
  const puedeEmbarcar = tienePermiso('log_embarques', 'crear')

  const [vista, setVista] = useState('pendientes')
  const [clientes, setClientes] = useState([])
  const [articulos, setArticulos] = useState([])
  const [artCliente, setArtCliente] = useState([])
  const [lineasRel, setLineasRel] = useState([])
  const [entregas, setEntregas] = useState([])
  const [existencias, setExistencias] = useState([])
  const [lotes, setLotes] = useState([])
  const [almacenes, setAlmacenes] = useState([])
  const [ubicaciones, setUbicaciones] = useState([])
  const [embarques, setEmbarques] = useState([])
  const [empresa, setEmpresa] = useState(null)
  const [traspasos, setTraspasos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [procesando, setProcesando] = useState(false)

  const [cliente, setCliente] = useState('')
  const [cab, setCab] = useState({ fecha: hoy(), transportista: '', referencia: '', notas: '' })
  const [surtido, setSurtido] = useState({}) // { [releaseLineaId]: cantidad }
  const [detalle, setDetalle] = useState(null) // embarque para packing list

  useEffect(() => { cargar() }, [])

  const cargar = async () => {
    setLoading(true)
    const [c, a, ac, rl, en, ex, lo, al, ub, em, emp, tr] = await Promise.all([
      supabase.from('clientes').select('id, nombre').eq('activo', true).order('nombre'),
      supabase.from('articulos').select('id, codigo_interno, descripcion, unidad_medida'),
      supabase.from('articulo_cliente').select('*').eq('activo', true),
      supabase.from('release_lineas').select('*').eq('vigente', true).order('fecha_requerida'),
      supabase.from('release_entregas').select('*'),
      supabase.from('existencias').select('*'),
      supabase.from('lotes').select('*'),
      supabase.from('almacenes').select('*'),
      supabase.from('ubicaciones').select('*'),
      supabase.from('embarques').select('*, cli:clientes(nombre), usuario:usuarios!embarques_creado_por_fkey(nombre)').order('fecha', { ascending: false }).limit(100),
      supabase.from('empresas').select('*').eq('id', perfil.empresa_id).maybeSingle(),
      supabase.from('traspasos').select('*').eq('estatus', 'enviado'),
    ])
    setClientes(c.data || []); setArticulos(a.data || []); setArtCliente(ac.data || [])
    setLineasRel(rl.data || []); setEntregas(en.data || []); setExistencias(ex.data || [])
    setLotes(lo.data || []); setAlmacenes(al.data || []); setUbicaciones(ub.data || [])
    setEmbarques(em.data || []); setEmpresa(emp.data || null); setTraspasos(tr.data || [])
    setLoading(false)
  }

  const artDe = (id) => articulos.find(a => a.id === id)
  const almDe = (id) => almacenes.find(a => a.id === id)
  const ubiDe = (id) => ubicaciones.find(u => u.id === id)
  const cliDe = (id) => clientes.find(c => c.id === id)
  const entregadoDe = (lineaId) => entregas.filter(e => e.linea_id === lineaId).reduce((s, e) => s + Number(e.cantidad), 0)
  const pendienteDe = (l) => Math.max(0, Number(l.cantidad) - entregadoDe(l.id))

  // Lineas del release del cliente con pendiente (las vencidas primero)
  const lineasPendientes = lineasRel
    .filter(l => !cliente || l.cliente_id === Number(cliente))
    .map(l => ({ ...l, _pend: pendienteDe(l), _art: artDe(l.articulo_id) }))
    .filter(l => l._pend > 0 && l._art)
    .sort((a, b) => a.fecha_requerida.localeCompare(b.fecha_requerida))

  // Existencias liberadas del articulo, FIFO por fecha de lote
  const disponiblesDe = (articuloId) => existencias
    .filter(e => Number(e.cantidad) > 0)
    .map(e => ({ ...e, _lote: lotes.find(l => l.id === e.lote_id) }))
    .filter(e => e._lote && e._lote.articulo_id === articuloId && e._lote.estatus_calidad === 'liberado')
    .sort((a, b) => (a._lote.fecha || '').localeCompare(b._lote.fecha || ''))

  const disponibleTotal = (articuloId) => disponiblesDe(articuloId).reduce((s, e) => s + Number(e.cantidad), 0)

  // Material que existe pero NO se puede embarcar todavia (visibilidad, no se usa)
  const noDisponibleDe = (articuloId) => {
    const detalle = []
    existencias.filter(e => Number(e.cantidad) > 0).forEach(e => {
      const lote = lotes.find(l => l.id === e.lote_id)
      if (!lote || lote.articulo_id !== articuloId || lote.estatus_calidad === 'liberado') return
      detalle.push({
        cantidad: Number(e.cantidad),
        donde: `${almDe(e.almacen_id)?.clave || '?'}${e.ubicacion_id ? '/' + (ubiDe(e.ubicacion_id)?.clave || '') : ''}`,
        motivo: lote.estatus_calidad === 'rechazado' ? 'rechazado' : 'pendiente de liberacion',
      })
    })
    traspasos.filter(t => t.articulo_id === articuloId).forEach(t => {
      detalle.push({ cantidad: Number(t.cantidad), donde: `en transito a ${almDe(t.almacen_destino_id)?.clave || '?'}`, motivo: 'sin confirmar recepcion' })
    })
    return detalle
  }

  // Asignacion FIFO de lotes para la cantidad capturada
  const asignacionDe = (linea) => {
    const cant = Number(surtido[linea.id]) || 0
    if (cant <= 0) return { tomas: [], faltante: 0 }
    const disp = disponiblesDe(linea.articulo_id)
    const tomas = []
    let falta = cant
    for (const e of disp) {
      if (falta <= 0.000001) break
      const toma = Math.min(falta, Number(e.cantidad))
      tomas.push({ existencia: e, cantidad: toma })
      falta -= toma
    }
    return { tomas, faltante: Math.max(0, falta) }
  }

  const conSurtido = lineasPendientes.filter(l => Number(surtido[l.id]) > 0)
  const hayFaltante = conSurtido.some(l => asignacionDe(l).faltante > 0.000001)
  const totalPiezas = conSurtido.reduce((s, l) => s + Number(surtido[l.id]), 0)

  const setCantidad = (lineaId, valor) => setSurtido(s => ({ ...s, [lineaId]: valor }))
  const surtirTodo = () => {
    const nuevo = {}
    lineasPendientes.forEach(l => {
      const disp = disponibleTotal(l.articulo_id)
      const yaAsignado = Object.entries(nuevo).filter(([id]) => {
        const otra = lineasPendientes.find(x => x.id === Number(id))
        return otra && otra.articulo_id === l.articulo_id
      }).reduce((s, [, v]) => s + Number(v), 0)
      const posible = Math.min(l._pend, Math.max(0, disp - yaAsignado))
      if (posible > 0) nuevo[l.id] = String(posible)
    })
    setSurtido(nuevo)
  }

  const confirmar = async () => {
    setError('')
    if (!cliente) { setError('Selecciona el cliente'); return }
    if (conSurtido.length === 0) { setError('Captura la cantidad a embarcar de al menos una linea'); return }
    for (const l of conSurtido) {
      if (Number(surtido[l.id]) > l._pend) { setError(`${l._art.codigo_interno}: la cantidad excede lo pendiente (${fmtNum(l._pend)})`); return }
    }
    if (hayFaltante) { setError('No hay suficiente producto LIBERADO en inventario para lo capturado. Revisa la asignacion de lotes.'); return }

    setProcesando(true)
    try {
      const { data: emb, error: e0 } = await supabase.from('embarques').insert({
        empresa_id: perfil.empresa_id, folio: `EMB-${Date.now().toString().slice(-8)}`,
        cliente_id: Number(cliente), fecha: cab.fecha, transportista: cab.transportista || null,
        referencia: cab.referencia || null, notas: cab.notas || null, creado_por: perfil.id,
      }).select().single()
      if (e0) throw e0

      for (const l of conSurtido) {
        const { tomas } = asignacionDe(l)
        for (const t of tomas) {
          const nueva = Number(t.existencia.cantidad) - t.cantidad
          if (nueva <= 0.000001) await supabase.from('existencias').delete().eq('id', t.existencia.id)
          else await supabase.from('existencias').update({ cantidad: nueva }).eq('id', t.existencia.id)

          await supabase.from('embarque_lineas').insert({
            embarque_id: emb.id, release_linea_id: l.id, articulo_id: l.articulo_id,
            lote_id: t.existencia.lote_id, cantidad: t.cantidad,
            almacen_id: t.existencia.almacen_id, ubicacion_id: t.existencia.ubicacion_id,
          })
          await supabase.from('movimientos').insert({
            empresa_id: perfil.empresa_id, articulo_id: l.articulo_id, lote_id: t.existencia.lote_id,
            tipo: 'salida_embarque', almacen_origen_id: t.existencia.almacen_id, ubicacion_origen_id: t.existencia.ubicacion_id,
            cantidad: t.cantidad, motivo: `Embarque ${emb.folio} - ${cliDe(Number(cliente))?.nombre}`, usuario_id: perfil.id,
          })
        }
        // Entrega en el release (alimenta el estatus de Customer Service)
        await supabase.from('release_entregas').insert({
          linea_id: l.id, cantidad: Number(surtido[l.id]), fecha_entrega: cab.fecha,
          referencia: `${emb.folio}${cab.referencia ? ' / ' + cab.referencia : ''}`,
          registrado_por: perfil.id, embarque_id: emb.id,
        })
      }

      setExito(`Embarque ${emb.folio} registrado: ${fmtNum(totalPiezas)} pzas en ${conSurtido.length} linea(s). Entregas aplicadas al release.`)
      setSurtido({}); setCab({ fecha: hoy(), transportista: '', referencia: '', notas: '' })
      await cargar()
      setVista('historial')
    } catch (err) { setError('Error al embarcar: ' + err.message) }
    setProcesando(false)
  }

  const verPacking = async (emb) => {
    const { data } = await supabase.from('embarque_lineas').select('*, lote:lotes(codigo_lote)').eq('embarque_id', emb.id)
    setDetalle({ ...emb, _lineas: data || [] })
  }

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>

  // ---------- Packing list ----------
  if (detalle) {
    const hoja = (
      <div style={{ padding: '0.5in', fontFamily: 'Arial, Helvetica, sans-serif', color: '#000' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ margin: '0 0 2px' }}>LISTA DE EMPAQUE</h2>
            <p style={{ fontSize: '20px', fontWeight: '700', margin: '0 0 10px' }}>{detalle.folio}</p>
          </div>
          {empresa?.logo_url && <img src={empresa.logo_url} alt={empresa.nombre} style={{ height: '50px', objectFit: 'contain' }} />}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px', fontSize: '13px', marginBottom: '16px' }}>
          <div><b>Cliente:</b> {detalle.cli?.nombre}</div>
          <div><b>Fecha:</b> {fmtFecha(detalle.fecha)}</div>
          <div><b>Transportista:</b> {detalle.transportista || '-'}</div>
          <div><b>Referencia:</b> {detalle.referencia || '-'}</div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ backgroundColor: '#f1f5f9' }}>
              <th style={th}>Codigo</th><th style={th}>Parte cliente</th><th style={th}>Descripcion</th>
              <th style={th}>Lote</th><th style={th}>Ubicacion</th><th style={{ ...th, textAlign: 'right' }}>Cantidad</th>
            </tr>
          </thead>
          <tbody>
            {detalle._lineas.map(l => {
              const art = artDe(l.articulo_id)
              const rel = artCliente.find(x => x.articulo_id === l.articulo_id && x.cliente_id === detalle.cliente_id)
              return (
                <tr key={l.id}>
                  <td style={td}>{art?.codigo_interno}</td>
                  <td style={td}>{rel?.codigo_cliente || '-'}</td>
                  <td style={td}>{art?.descripcion}</td>
                  <td style={td}>{l.lote?.codigo_lote}</td>
                  <td style={td}>{almDe(l.almacen_id)?.clave}{l.ubicacion_id ? ` / ${ubiDe(l.ubicacion_id)?.clave}` : ''}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: '700' }}>{fmtNum(l.cantidad)}</td>
                </tr>
              )
            })}
            <tr>
              <td style={{ ...td, fontWeight: '700' }} colSpan={5}>TOTAL</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: '700' }}>{fmtNum(detalle._lineas.reduce((s, l) => s + Number(l.cantidad), 0))}</td>
            </tr>
          </tbody>
        </table>
        {detalle.notas && <p style={{ marginTop: '14px', fontSize: '12px' }}><b>Notas:</b> {detalle.notas}</p>}
        <div style={{ marginTop: '50px', display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
          <div style={{ borderTop: '1px solid #000', width: '35%', textAlign: 'center', paddingTop: '4px' }}>Entrega</div>
          <div style={{ borderTop: '1px solid #000', width: '35%', textAlign: 'center', paddingTop: '4px' }}>Recibe</div>
        </div>
      </div>
    )
    return (
      <div style={styles.container} className="aparecer">
        <style>{`@media print { @page { size: letter; margin: 0; } }`}</style>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '14px' }} className="no-imprimir">
          <button style={styles.botonSec} onClick={() => setDetalle(null)}>&larr; Volver</button>
          <button style={styles.boton} onClick={imprimirAislado}>Imprimir</button>
        </div>
        <PortalImpresion>{hoja}</PortalImpresion>
        <div style={{ backgroundColor: '#fff', borderRadius: '10px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>{hoja}</div>
      </div>
    )
  }

  return (
    <div style={styles.container} className="aparecer">
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Embarques</h2>
      </div>
      <div style={styles.tabs}>
        {[['pendientes', 'Surtir release'], ['historial', `Historial${embarques.length ? ` (${embarques.length})` : ''}`]].map(([id, n]) => (
          <button key={id} style={vista === id ? styles.tabActiva : styles.tab} onClick={() => setVista(id)}>{n}</button>
        ))}
      </div>
      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {vista === 'pendientes' && (
        <>
          <p style={styles.ayuda}>Solo se puede embarcar producto <b>liberado por Calidad</b>. Los lotes se asignan por <b>FIFO</b> y la entrega se aplica sola al release del cliente.</p>
          <div style={styles.filtros}>
            <label style={styles.label}>Cliente *</label>
            <select style={styles.input} value={cliente} onChange={e => { setCliente(e.target.value); setSurtido({}) }}>
              <option value="">Selecciona...</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <label style={styles.label}>Fecha</label>
            <input type="date" style={styles.input} value={cab.fecha} onChange={e => setCab({ ...cab, fecha: e.target.value })} />
            <input style={{ ...styles.input, flex: 1 }} placeholder="Transportista" value={cab.transportista} onChange={e => setCab({ ...cab, transportista: e.target.value })} />
            <input style={{ ...styles.input, flex: 1 }} placeholder="Referencia (remision/factura)" value={cab.referencia} onChange={e => setCab({ ...cab, referencia: e.target.value })} />
            {cliente && lineasPendientes.length > 0 && <button style={styles.botonSec} onClick={surtirTodo}>Surtir lo disponible</button>}
          </div>

          {!cliente ? (
            <p style={{ color: '#666', padding: '10px 4px' }}>Selecciona un cliente para ver su release pendiente.</p>
          ) : lineasPendientes.length === 0 ? (
            <p style={{ color: '#666', padding: '10px 4px' }}>Este cliente no tiene lineas pendientes en su release vigente.</p>
          ) : (
            <>
              <div style={styles.tabla}>
                <div style={styles.tablaHeader}>
                  <span style={{ flex: 2 }}>Articulo</span>
                  <span style={{ flex: 1 }}>Fecha req.</span>
                  <span style={{ flex: 0.8, textAlign: 'right' }}>Pendiente</span>
                  <span style={{ flex: 0.9, textAlign: 'right' }}>Disponible</span>
                  <span style={{ flex: 1.4 }}>No disponible</span>
                  <span style={{ flex: 0.9, textAlign: 'center' }}>A embarcar</span>
                  <span style={{ flex: 1.8 }}>Lotes asignados (FIFO)</span>
                </div>
                {lineasPendientes.map(l => {
                  const disp = disponibleTotal(l.articulo_id)
                  const { tomas, faltante } = asignacionDe(l)
                  const vencida = l.fecha_requerida < hoy()
                  return (
                    <div key={l.id} style={styles.tablaFila} className="fila-hover">
                      <span style={{ flex: 2 }}>
                        <b>{l._art.codigo_interno}</b> <span style={{ color: '#64748b', fontSize: '13px' }}>- {l._art.descripcion}</span>
                        <span style={{ ...styles.badge, ...(l.tipo === 'firme' ? styles.badgeVerde : styles.badgeGris), marginLeft: '6px' }}>{l.tipo}</span>
                      </span>
                      <span style={{ flex: 1, color: vencida ? '#dc2626' : '#64748b', fontWeight: vencida ? '600' : '400' }}>{fmtFecha(l.fecha_requerida)}</span>
                      <span style={{ flex: 0.8, textAlign: 'right', fontWeight: '600' }}>{fmtNum(l._pend)}</span>
                      <span style={{ flex: 0.9, textAlign: 'right', color: disp > 0 ? '#16a34a' : '#dc2626' }}>{fmtNum(disp)}</span>
                      <span style={{ flex: 1.4, fontSize: '11px', color: '#b45309' }}>
                        {noDisponibleDe(l.articulo_id).length === 0
                          ? <span style={{ color: '#cbd5e1' }}>-</span>
                          : noDisponibleDe(l.articulo_id).map((nd, i) => <span key={i} style={{ display: 'block' }}>{fmtNum(nd.cantidad)} en {nd.donde} ({nd.motivo})</span>)}
                      </span>
                      <span style={{ flex: 0.9, textAlign: 'center' }}>
                        <input type="number" min="0" max={l._pend} style={{ ...styles.input, width: '90px', padding: '5px 8px' }}
                          value={surtido[l.id] || ''} onChange={e => setCantidad(l.id, e.target.value)} disabled={!puedeEmbarcar} />
                      </span>
                      <span style={{ flex: 1.8, fontSize: '12px', color: faltante > 0 ? '#dc2626' : '#64748b' }}>
                        {faltante > 0
                          ? `FALTAN ${fmtNum(faltante)} liberadas`
                          : tomas.map(t => `${lotes.find(x => x.id === t.existencia.lote_id)?.codigo_lote} (${fmtNum(t.cantidad)})`).join(', ') || '-'}
                      </span>
                    </div>
                  )
                })}
              </div>
              <div style={{ ...styles.botones, marginTop: '16px', alignItems: 'center' }}>
                {totalPiezas > 0 && <span style={{ marginRight: 'auto', fontSize: '13px', color: '#334155' }}>Total a embarcar: <b>{fmtNum(totalPiezas)}</b> pzas en {conSurtido.length} linea(s)</span>}
                <button style={{ ...styles.boton, opacity: (!puedeEmbarcar || procesando || hayFaltante || conSurtido.length === 0) ? 0.5 : 1 }}
                  disabled={!puedeEmbarcar || procesando || hayFaltante || conSurtido.length === 0} onClick={confirmar}>
                  {procesando ? 'Procesando...' : 'Confirmar embarque'}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {vista === 'historial' && (
        embarques.length === 0 ? <p style={{ color: '#666', padding: '10px 4px' }}>Aun no hay embarques.</p> : (
          <div style={styles.tabla}>
            <div style={styles.tablaHeader}>
              <span style={{ flex: 1 }}>Folio</span>
              <span style={{ flex: 1.6 }}>Cliente</span>
              <span style={{ flex: 1 }}>Fecha</span>
              <span style={{ flex: 1.3 }}>Transportista</span>
              <span style={{ flex: 1.3 }}>Referencia</span>
              <span style={{ flex: 1.2 }}>Registro</span>
              <span style={{ width: '130px' }}></span>
            </div>
            {embarques.map(e => (
              <div key={e.id} style={styles.tablaFila} className="fila-hover">
                <span style={{ flex: 1, fontWeight: '600' }}>{e.folio}</span>
                <span style={{ flex: 1.6 }}>{e.cli?.nombre}</span>
                <span style={{ flex: 1, color: '#64748b' }}>{fmtFecha(e.fecha)}</span>
                <span style={{ flex: 1.3, color: '#64748b' }}>{e.transportista || '-'}</span>
                <span style={{ flex: 1.3, color: '#64748b' }}>{e.referencia || '-'}</span>
                <span style={{ flex: 1.2, color: '#64748b', fontSize: '13px' }}>{e.usuario?.nombre}</span>
                <span style={{ width: '130px', textAlign: 'right' }}>
                  <button style={styles.botonAccion} onClick={() => verPacking(e)}>Lista de empaque</button>
                </span>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}

const th = { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #cbd5e1' }
const td = { padding: '6px 8px', borderBottom: '1px solid #f1f5f9' }

const styles = {
  container: { padding: '28px' },
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0' },
  ayuda: { fontSize: '13px', color: '#64748b', margin: '0 0 14px', lineHeight: '1.5' },
  tabs: { display: 'flex', gap: '4px', marginBottom: '16px', borderBottom: '1px solid #e2e8f0' },
  tab: { padding: '8px 16px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#64748b', cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabActiva: { padding: '8px 16px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#0891b2', fontWeight: '600', cursor: 'pointer', borderBottom: '2px solid #0891b2' },
  filtros: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '16px', backgroundColor: '#fff', borderRadius: '10px', padding: '14px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '8px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', fontFamily: 'inherit', backgroundColor: '#fff' },
  botones: { display: 'flex', justifyContent: 'flex-end', gap: '10px' },
  boton: { padding: '9px 20px', backgroundColor: '#0891b2', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSec: { padding: '9px 18px', backgroundColor: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '11px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  badge: { padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: '600' },
  badgeVerde: { backgroundColor: '#dcfce7', color: '#16a34a' },
  badgeGris: { backgroundColor: '#f1f5f9', color: '#64748b' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
