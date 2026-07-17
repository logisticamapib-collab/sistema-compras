import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Autorizacion de ingreso de materia prima en consigna (material del cliente, costo 0).
// CS la crea; el Gerente de Logistica la aprueba. El recibo de consigna se hace contra
// una autorizacion APROBADA. En el futuro el motor MRP (Capa 7) podra generarlas solo.

const fmtNum = (n) => (Number(n) || 0).toLocaleString('es-MX')
const fmtFecha = (f) => f ? new Date(f + 'T00:00:00').toLocaleDateString('es-MX') : '-'
const NOMBRE_EST = { pendiente: 'Pendiente', aprobada: 'Aprobada', recibida_parcial: 'Recibida parcial', recibida: 'Recibida', cancelada: 'Cancelada', rechazada: 'Rechazada' }

export default function AutorizacionesConsigna() {
  const { perfil, tienePermiso } = useAuth()
  const puedeCrear = tienePermiso('cs_consigna', 'crear')
  const puedeAprobar = tienePermiso('cs_consigna', 'aprobar')

  const [autorizaciones, setAutorizaciones] = useState([])
  const [lineas, setLineas] = useState([])
  const [clientes, setClientes] = useState([])
  const [sites, setSites] = useState([])
  const [articulos, setArticulos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [filtro, setFiltro] = useState('activas')
  const [expandido, setExpandido] = useState(null)
  const [form, setForm] = useState(null)
  const [procesando, setProcesando] = useState(false)

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    const [a, l, c, s, art] = await Promise.all([
      supabase.from('consigna_autorizaciones').select('*, cliente:clientes(nombre), creador:usuarios!consigna_autorizaciones_creado_por_fkey(nombre), aprobador:usuarios!consigna_autorizaciones_aprobado_por_fkey(nombre)').order('fecha_creacion', { ascending: false }),
      supabase.from('consigna_autorizacion_lineas').select('*'),
      supabase.from('clientes').select('id, nombre').eq('activo', true),
      supabase.from('sites').select('id, nombre').eq('activo', true),
      supabase.from('articulos').select('id, codigo_interno, descripcion, unidad_medida, es_consigna').eq('empresa_id', perfil.empresa_id).eq('es_consigna', true).eq('activo', true).order('codigo_interno'),
    ])
    setAutorizaciones(a.data || [])
    setLineas(l.data || [])
    setClientes(c.data || [])
    setSites(s.data || [])
    setArticulos(art.data || [])
    setLoading(false)
  }

  const artDe = (id) => articulos.find(a => a.id === id)
  const lineasDe = (autId) => lineas.filter(l => l.autorizacion_id === autId)

  const nuevoForm = () => setForm({ cliente_id: '', site_id: '', referencia: '', notas: '', lineas: [{ articulo_id: '', cantidad: '', fecha_sugerida: '', tipo: 'firme' }] })
  const setLinea = (i, campo, val) => setForm(f => ({ ...f, lineas: f.lineas.map((l, j) => j === i ? { ...l, [campo]: val } : l) }))
  const agregarLinea = () => setForm(f => ({ ...f, lineas: [...f.lineas, { articulo_id: '', cantidad: '', fecha_sugerida: '', tipo: 'firme' }] }))
  const quitarLinea = (i) => setForm(f => ({ ...f, lineas: f.lineas.filter((_, j) => j !== i) }))

  const guardar = async () => {
    setError('')
    if (!form.cliente_id) { setError('Selecciona el cliente dueno del material'); return }
    const lns = form.lineas.filter(l => l.articulo_id && Number(l.cantidad) > 0)
    if (lns.length === 0) { setError('Agrega al menos un articulo con cantidad'); return }
    setProcesando(true)
    try {
      const { data: aut, error: e1 } = await supabase.from('consigna_autorizaciones').insert({
        empresa_id: perfil.empresa_id, folio: `CON-${Date.now().toString().slice(-8)}`,
        cliente_id: Number(form.cliente_id), site_id: form.site_id ? Number(form.site_id) : null,
        referencia: form.referencia || null, notas: form.notas || null, creado_por: perfil.id, estatus: 'pendiente',
      }).select().single()
      if (e1) throw e1
      const filas = lns.map(l => ({ autorizacion_id: aut.id, articulo_id: Number(l.articulo_id), cantidad: Number(l.cantidad), fecha_sugerida: l.fecha_sugerida || null, tipo: l.tipo }))
      const { error: e2 } = await supabase.from('consigna_autorizacion_lineas').insert(filas)
      if (e2) throw e2
      setExito(`Autorizacion ${aut.folio} creada (pendiente de aprobacion)`)
      setForm(null)
      await cargarDatos()
    } catch (err) { setError('Error: ' + err.message) }
    setProcesando(false)
  }

  const cambiarEstatus = async (aut, estatus) => {
    setError(''); setExito('')
    const patch = { estatus }
    if (estatus === 'aprobada') { patch.aprobado_por = perfil.id; patch.fecha_aprobacion = new Date().toISOString() }
    const { error: e1 } = await supabase.from('consigna_autorizaciones').update(patch).eq('id', aut.id)
    if (e1) { setError('Error: ' + e1.message); return }
    setExito(estatus === 'aprobada' ? `Autorizacion ${aut.folio} aprobada` : estatus === 'rechazada' ? 'Autorizacion rechazada' : 'Autorizacion cancelada')
    await cargarDatos()
  }

  const lista = autorizaciones.filter(a => filtro === 'todas' ? true : filtro === 'activas' ? ['pendiente', 'aprobada', 'recibida_parcial'].includes(a.estatus) : a.estatus === filtro)
  const badgeEst = (e) => e === 'aprobada' ? styles.badgeVerde : e === 'pendiente' ? styles.badgeAmbar : ['cancelada', 'rechazada'].includes(e) ? styles.badgeRojo : styles.badgeAzul

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>

  return (
    <div style={styles.container} className="aparecer">
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Autorizaciones de Consigna</h2>
        {puedeCrear && !form && <button style={styles.boton} onClick={nuevoForm}>+ Nueva autorizacion</button>}
      </div>
      <p style={styles.ayuda}>Ingreso de materia prima en consigna (material del cliente, costo 0). CS la crea y el Gerente de Logistica la aprueba; el recibo se hace en Recibos contra una autorizacion aprobada.</p>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {form && (
        <div style={styles.form}>
          <h3 style={styles.formTitulo}>Nueva autorizacion de consigna</h3>
          {articulos.length === 0 && <p style={styles.avisoAmbar}>No hay articulos marcados como consigna. Marca "es consigna" en Articulos primero.</p>}
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Cliente (dueno del material) *</label>
              <select style={styles.input} value={form.cliente_id} onChange={e => setForm({ ...form, cliente_id: e.target.value })}>
                <option value="">Selecciona...</option>
                {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Site destino</label>
              <select style={styles.input} value={form.site_id} onChange={e => setForm({ ...form, site_id: e.target.value })}>
                <option value="">Sin especificar</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Referencia (remision del cliente)</label>
              <input style={styles.input} value={form.referencia} onChange={e => setForm({ ...form, referencia: e.target.value })} placeholder="Opcional" />
            </div>
          </div>
          <p style={{ ...styles.label, margin: '6px 0 8px' }}>Materiales:</p>
          {form.lineas.map((l, i) => (
            <div key={i} style={styles.filaLinea}>
              <select style={{ ...styles.input, flex: 2 }} value={l.articulo_id} onChange={e => setLinea(i, 'articulo_id', e.target.value)}>
                <option value="">Articulo consigna...</option>
                {articulos.map(a => <option key={a.id} value={a.id}>{a.codigo_interno} - {a.descripcion}</option>)}
              </select>
              <input type="number" min="0" style={{ ...styles.input, flex: 0.8 }} value={l.cantidad} onChange={e => setLinea(i, 'cantidad', e.target.value)} placeholder="Cantidad" />
              <input type="date" style={{ ...styles.input, flex: 1 }} value={l.fecha_sugerida} onChange={e => setLinea(i, 'fecha_sugerida', e.target.value)} />
              <select style={{ ...styles.input, flex: 0.8 }} value={l.tipo} onChange={e => setLinea(i, 'tipo', e.target.value)}>
                <option value="firme">Firme</option>
                <option value="vision">Vision</option>
              </select>
              <button style={styles.botonAccion} onClick={() => quitarLinea(i)} disabled={form.lineas.length === 1}>Quitar</button>
            </div>
          ))}
          <button style={{ ...styles.botonAccion, marginBottom: '14px' }} onClick={agregarLinea}>+ Agregar material</button>
          <div style={styles.campoFull}>
            <label style={styles.label}>Notas</label>
            <input style={styles.input} value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })} placeholder="Opcional" />
          </div>
          <div style={{ ...styles.botones, marginTop: '16px' }}>
            <button style={styles.botonSec} onClick={() => setForm(null)} disabled={procesando}>Cancelar</button>
            <button style={styles.boton} onClick={guardar} disabled={procesando}>{procesando ? 'Guardando...' : 'Crear autorizacion'}</button>
          </div>
        </div>
      )}

      <div style={styles.filtros}>
        <label style={{ ...styles.label, marginRight: '8px' }}>Ver:</label>
        <select style={styles.input} value={filtro} onChange={e => setFiltro(e.target.value)}>
          <option value="activas">Activas (pendientes y aprobadas)</option>
          <option value="pendiente">Solo pendientes</option>
          <option value="aprobada">Solo aprobadas</option>
          <option value="todas">Todas</option>
        </select>
      </div>

      {lista.length === 0 ? (
        <p style={{ color: '#666', padding: '10px 4px' }}>No hay autorizaciones con este filtro.</p>
      ) : (
        <div style={styles.tabla}>
          <div style={styles.tablaHeader}>
            <span style={{ flex: 1 }}>Folio</span>
            <span style={{ flex: 1.6 }}>Cliente</span>
            <span style={{ flex: 1.3 }}>Referencia</span>
            <span style={{ flex: 1.2 }}>Creada por</span>
            <span style={{ flex: 1, textAlign: 'center' }}>Estatus</span>
            <span style={{ width: '210px' }}></span>
          </div>
          {lista.map(a => {
            const lns = lineasDe(a.id)
            return (
              <div key={a.id}>
                <div style={styles.tablaFila} className="fila-hover">
                  <span style={{ flex: 1, fontWeight: '600' }}>{a.folio}</span>
                  <span style={{ flex: 1.6 }}>{a.cliente?.nombre}</span>
                  <span style={{ flex: 1.3, color: '#64748b', fontSize: '13px' }}>{a.referencia || '-'}</span>
                  <span style={{ flex: 1.2, color: '#64748b', fontSize: '13px' }}>{a.creador?.nombre}</span>
                  <span style={{ flex: 1, textAlign: 'center' }}><span style={{ ...styles.badge, ...badgeEst(a.estatus) }}>{NOMBRE_EST[a.estatus]}</span></span>
                  <span style={{ width: '210px', textAlign: 'right', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                    <button style={styles.botonAccion} onClick={() => setExpandido(expandido === a.id ? null : a.id)}>{expandido === a.id ? 'Ocultar' : 'Detalle'}</button>
                    {puedeAprobar && a.estatus === 'pendiente' && (
                      <>
                        <button style={{ ...styles.botonAccion, color: '#16a34a', borderColor: '#bbf7d0' }} onClick={() => cambiarEstatus(a, 'aprobada')}>Aprobar</button>
                        <button style={{ ...styles.botonAccion, color: '#dc2626', borderColor: '#fecaca' }} onClick={() => cambiarEstatus(a, 'rechazada')}>Rechazar</button>
                      </>
                    )}
                    {puedeCrear && ['pendiente', 'aprobada'].includes(a.estatus) && a.estatus !== 'recibida_parcial' && (
                      <button style={styles.botonAccion} onClick={() => cambiarEstatus(a, 'cancelada')}>Cancelar</button>
                    )}
                  </span>
                </div>
                {expandido === a.id && (
                  <div style={styles.subTabla}>
                    {lns.map(l => (
                      <div key={l.id} style={{ ...styles.tablaFila, padding: '7px 20px', fontSize: '13px' }}>
                        <span style={{ flex: 2 }}><b>{artDe(l.articulo_id)?.codigo_interno}</b> <span style={{ color: '#64748b' }}>- {artDe(l.articulo_id)?.descripcion}</span></span>
                        <span style={{ flex: 1, textAlign: 'right' }}>{fmtNum(l.cantidad)} {artDe(l.articulo_id)?.unidad_medida || ''}</span>
                        <span style={{ flex: 1, textAlign: 'right', color: '#16a34a' }}>Recibido: {fmtNum(l.cantidad_recibida)}</span>
                        <span style={{ flex: 1, textAlign: 'center' }}>{fmtFecha(l.fecha_sugerida)}</span>
                        <span style={{ flex: 0.8, textAlign: 'center' }}><span style={{ ...styles.badge, ...(l.tipo === 'firme' ? styles.badgeVerde : styles.badgeGris) }}>{l.tipo}</span></span>
                      </div>
                    ))}
                    {a.notas && <p style={{ padding: '6px 20px', fontSize: '12px', color: '#64748b' }}>Notas: {a.notas}</p>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const styles = {
  container: { padding: '28px' },
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0' },
  ayuda: { fontSize: '13px', color: '#64748b', margin: '0 0 16px', lineHeight: '1.5' },
  form: { backgroundColor: '#fff', borderRadius: '10px', padding: '24px', marginBottom: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  formTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 16px 0' },
  fila: { display: 'flex', gap: '16px', marginBottom: '14px' },
  filaLinea: { display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '8px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 },
  campoFull: { display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', fontFamily: 'inherit', backgroundColor: '#fff' },
  filtros: { display: 'flex', alignItems: 'center', marginBottom: '16px', backgroundColor: '#fff', borderRadius: '10px', padding: '14px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  botones: { display: 'flex', justifyContent: 'flex-end', gap: '10px' },
  boton: { padding: '9px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSec: { padding: '9px 20px', backgroundColor: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#fff', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer', fontWeight: '600' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '11px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  subTabla: { backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', padding: '4px 0 8px' },
  avisoAmbar: { backgroundColor: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '7px', padding: '8px 12px', color: '#92400e', fontSize: '13px', marginBottom: '12px' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '600' },
  badgeVerde: { backgroundColor: '#dcfce7', color: '#16a34a' },
  badgeAmbar: { backgroundColor: '#fef3c7', color: '#b45309' },
  badgeRojo: { backgroundColor: '#fee2e2', color: '#dc2626' },
  badgeAzul: { backgroundColor: '#dbeafe', color: '#2563eb' },
  badgeGris: { backgroundColor: '#f1f5f9', color: '#64748b' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
