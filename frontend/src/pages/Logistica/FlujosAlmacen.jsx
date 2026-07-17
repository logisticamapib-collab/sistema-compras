import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Capa 3 - Flujos de Almacen: plantillas POR SITE cuyos pasos son ALMACENES REALES.
// El paso 1 es donde NACE el producto al reportar produccion; el ultimo es de donde
// se embarca. Un paso puede exigir liberacion de Calidad para poder avanzar al
// siguiente (el estatus de calidad vive en el LOTE, no en la ubicacion).
// Las plantillas se asignan a los articulos fabricados; los movimientos de
// inventario respetaran este orden.

export default function FlujosAlmacen() {
  const { perfil, tienePermiso } = useAuth()
  const puedeCrear = tienePermiso('log_flujos', 'crear')
  const puedeEditar = tienePermiso('log_flujos', 'editar')

  const [vista, setVista] = useState('plantillas')
  const [sites, setSites] = useState([])
  const [almacenes, setAlmacenes] = useState([])
  const [flujos, setFlujos] = useState([])
  const [pasos, setPasos] = useState([])
  const [articulos, setArticulos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  // Form plantilla: { id?, site_id, nombre, descripcion, pasos: [{ almacen_id, requiere_liberacion, nota }] }
  const [form, setForm] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [soloSinFlujo, setSoloSinFlujo] = useState(false)

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    const [s, a, f, p, art] = await Promise.all([
      supabase.from('sites').select('id, nombre').eq('activo', true).order('nombre'),
      supabase.from('almacenes').select('*').eq('activo', true).order('clave'),
      supabase.from('flujos_almacen').select('*').order('nombre'),
      supabase.from('flujo_pasos').select('*').order('secuencia'),
      supabase.from('articulos').select('id, codigo_interno, descripcion, flujo_id, tipo_proceso')
        .eq('empresa_id', perfil.empresa_id).eq('origen', 'fabricado').eq('activo', true).order('codigo_interno'),
    ])
    setSites(s.data || [])
    setAlmacenes(a.data || [])
    setFlujos(f.data || [])
    setPasos(p.data || [])
    setArticulos(art.data || [])
    setLoading(false)
  }

  const siteDe = (id) => sites.find(s => s.id === id)
  const almacenDe = (id) => almacenes.find(a => a.id === id)
  const pasosDe = (flujoId) => pasos.filter(p => p.flujo_id === flujoId)
  const articulosCon = (flujoId) => articulos.filter(a => a.flujo_id === flujoId)

  const cadenaDe = (flujoId) => pasosDe(flujoId)
    .map(p => `${almacenDe(p.almacen_id)?.clave || '?'}${p.requiere_liberacion ? ' ✓Cal' : ''}`)
    .join(' → ')

  // ---------- Plantillas ----------
  const nuevoForm = () => setForm({ site_id: '', nombre: '', descripcion: '', pasos: [{ almacen_id: '', requiere_liberacion: false, nota: '' }] })

  const editarForm = (f) => setForm({
    id: f.id, site_id: f.site_id || '', nombre: f.nombre, descripcion: f.descripcion || '',
    pasos: pasosDe(f.id).map(p => ({ almacen_id: String(p.almacen_id), requiere_liberacion: p.requiere_liberacion, nota: p.nota || '' })),
  })

  const setPaso = (i, campo, valor) => {
    const nuevos = form.pasos.map((p, j) => j === i ? { ...p, [campo]: valor } : p)
    setForm({ ...form, pasos: nuevos })
  }
  const agregarPaso = () => setForm({ ...form, pasos: [...form.pasos, { almacen_id: '', requiere_liberacion: false, nota: '' }] })
  const quitarPaso = (i) => setForm({ ...form, pasos: form.pasos.filter((_, j) => j !== i) })
  const moverPaso = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= form.pasos.length) return
    const nuevos = [...form.pasos]
    ;[nuevos[i], nuevos[j]] = [nuevos[j], nuevos[i]]
    setForm({ ...form, pasos: nuevos })
  }
  const cambiarSite = (siteId) => {
    setForm({ ...form, site_id: siteId, pasos: form.pasos.map(p => ({ ...p, almacen_id: '' })) })
  }

  const guardarFlujo = async () => {
    setError(''); setExito('')
    if (!form.site_id) { setError('Selecciona el site del flujo'); return }
    if (!form.nombre.trim()) { setError('El nombre de la plantilla es obligatorio'); return }
    const pasosValidos = form.pasos.filter(p => p.almacen_id)
    if (pasosValidos.length === 0) { setError('Agrega al menos un paso (el paso 1 es donde nace el producto)'); return }
    setGuardando(true)
    try {
      let flujoId = form.id
      const cabecera = { site_id: Number(form.site_id), nombre: form.nombre.trim(), descripcion: form.descripcion.trim() || null }
      if (form.id) {
        const { error: e1 } = await supabase.from('flujos_almacen').update(cabecera).eq('id', form.id)
        if (e1) throw e1
        const { error: e2 } = await supabase.from('flujo_pasos').delete().eq('flujo_id', form.id)
        if (e2) throw e2
      } else {
        const { data, error: e1 } = await supabase.from('flujos_almacen')
          .insert({ ...cabecera, empresa_id: perfil.empresa_id }).select().single()
        if (e1) throw e1
        flujoId = data.id
      }
      const filas = pasosValidos.map((p, i) => ({
        flujo_id: flujoId, secuencia: i + 1, almacen_id: Number(p.almacen_id),
        requiere_liberacion: p.requiere_liberacion, nota: p.nota.trim() || null,
      }))
      const { error: e3 } = await supabase.from('flujo_pasos').insert(filas)
      if (e3) throw e3
      setExito(form.id ? 'Plantilla actualizada' : 'Plantilla creada')
      setForm(null)
      await cargarDatos()
    } catch (err) {
      setError('Error al guardar: ' + err.message)
    }
    setGuardando(false)
  }

  const toggleFlujo = async (f) => {
    if (f.activo && articulosCon(f.id).length > 0) {
      setError(`No se puede desactivar: ${articulosCon(f.id).length} articulo(s) usan esta plantilla`)
      return
    }
    await supabase.from('flujos_almacen').update({ activo: !f.activo }).eq('id', f.id)
    await cargarDatos()
  }

  // ---------- Asignacion ----------
  const asignarFlujo = async (articuloId, flujoId) => {
    setError(''); setExito('')
    const { error: e1 } = await supabase.from('articulos').update({ flujo_id: flujoId ? Number(flujoId) : null }).eq('id', articuloId)
    if (e1) { setError('Error al asignar: ' + e1.message); return }
    setArticulos(articulos.map(a => a.id === articuloId ? { ...a, flujo_id: flujoId ? Number(flujoId) : null } : a))
  }

  const articulosVisibles = soloSinFlujo ? articulos.filter(a => !a.flujo_id) : articulos
  const flujosActivos = flujos.filter(f => f.activo)
  const almacenesDelForm = form ? almacenes.filter(a => a.site_id === Number(form.site_id)) : []

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando flujos...</p>

  return (
    <div style={styles.container} className="aparecer">
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Flujos de Almacen</h2>
        {vista === 'plantillas' && puedeCrear && !form && (
          <button style={styles.boton} onClick={nuevoForm}>+ Nueva plantilla</button>
        )}
      </div>

      <div style={styles.tabs}>
        {[['plantillas', 'Plantillas de flujo'], ['asignacion', 'Asignacion a articulos']].map(([id, nombre]) => (
          <button key={id} style={vista === id ? styles.tabActiva : styles.tab} onClick={() => { setVista(id); setError(''); setExito('') }}>{nombre}</button>
        ))}
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {/* ==================== PLANTILLAS ==================== */}
      {vista === 'plantillas' && (
        <>
          {!form && (
            <p style={styles.ayuda}>
              Un flujo es el camino que recorre un producto fabricado, como secuencia de <b>almacenes reales de un site</b>.
              El <b>paso 1 es donde nace</b> el producto al reportar produccion y el ultimo es de donde se embarca; los movimientos
              de inventario respetaran este orden. Marca <b>"Libera Calidad"</b> en el paso donde el lote debe estar liberado antes
              de poder avanzar (la liberacion cambia el estatus del lote, no su ubicacion). Ej. PROD &rarr; CAL (&#10003;Cal) &rarr; PT.
              La ubicacion exacta (GP12, PT-MAQ1, rack) se define al momento de escanear el movimiento.
            </p>
          )}
          {form && (
            <div style={styles.form}>
              <h3 style={styles.formTitulo}>{form.id ? 'Editar plantilla' : 'Nueva plantilla de flujo'}</h3>
              <div style={styles.fila}>
                <div style={{ ...styles.campo, flex: 0.7 }}>
                  <label style={styles.label}>Site *</label>
                  <select style={styles.input} value={form.site_id} onChange={e => cambiarSite(e.target.value)}>
                    <option value="">Selecciona...</option>
                    {sites.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                </div>
                <div style={styles.campo}>
                  <label style={styles.label}>Nombre *</label>
                  <input style={styles.input} value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Ej. Inyeccion estandar" />
                </div>
                <div style={{ ...styles.campo, flex: 1.5 }}>
                  <label style={styles.label}>Descripcion</label>
                  <input style={styles.input} value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })} placeholder="Opcional" />
                </div>
              </div>
              {!form.site_id ? (
                <p style={{ fontSize: '13px', color: '#94a3b8', margin: '4px 0 12px' }}>Selecciona el site para elegir sus almacenes.</p>
              ) : (
                <>
                  <p style={{ ...styles.label, margin: '4px 0 8px' }}>
                    Pasos del flujo (el <b>paso 1 es donde NACE el producto</b>; el ultimo es de donde se embarca):
                  </p>
                  {form.pasos.map((p, i) => (
                    <div key={i} style={styles.filaPaso}>
                      <span style={{ ...styles.numeroPaso, ...(i === 0 ? styles.numeroNace : {}) }}>{i + 1}</span>
                      <select style={{ ...styles.input, flex: 1.1 }} value={p.almacen_id} onChange={e => setPaso(i, 'almacen_id', e.target.value)}>
                        <option value="">Almacen...</option>
                        {almacenesDelForm.map(a => <option key={a.id} value={a.id}>{a.clave} - {a.nombre}</option>)}
                      </select>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        <input type="checkbox" checked={p.requiere_liberacion} onChange={e => setPaso(i, 'requiere_liberacion', e.target.checked)} />
                        Libera Calidad
                      </label>
                      <input style={{ ...styles.input, flex: 1.2 }} value={p.nota} onChange={e => setPaso(i, 'nota', e.target.value)} placeholder={i === 0 ? 'Nacimiento del producto' : 'Nota opcional'} />
                      <button style={styles.botonAccion} onClick={() => moverPaso(i, -1)} disabled={i === 0}>&#8593;</button>
                      <button style={styles.botonAccion} onClick={() => moverPaso(i, 1)} disabled={i === form.pasos.length - 1}>&#8595;</button>
                      <button style={styles.botonAccion} onClick={() => quitarPaso(i)} disabled={form.pasos.length === 1}>Quitar</button>
                    </div>
                  ))}
                  <button style={{ ...styles.botonAccion, margin: '4px 0 14px 34px' }} onClick={agregarPaso}>+ Agregar paso</button>
                </>
              )}
              <div style={styles.botones}>
                <button style={styles.botonSec} onClick={() => setForm(null)} disabled={guardando}>Cancelar</button>
                <button style={styles.boton} onClick={guardarFlujo} disabled={guardando}>{guardando ? 'Guardando...' : form.id ? 'Guardar cambios' : 'Crear plantilla'}</button>
              </div>
            </div>
          )}

          {flujos.length === 0 && !form ? (
            <p style={{ color: '#666', padding: '10px 4px' }}>No hay plantillas. Crea la primera con "+ Nueva plantilla" (ej. PROD &rarr; CAL &rarr; PT).</p>
          ) : (
            <div style={styles.tabla}>
              <div style={styles.tablaHeader}>
                <span style={{ flex: 1 }}>Plantilla</span>
                <span style={{ flex: 0.8 }}>Site</span>
                <span style={{ flex: 2.3 }}>Flujo (paso 1 = nacimiento, &#10003;Cal = requiere liberacion)</span>
                <span style={{ flex: 0.6, textAlign: 'center' }}>Articulos</span>
                <span style={{ flex: 0.6, textAlign: 'center' }}>Estatus</span>
                <span style={{ width: '140px' }}></span>
              </div>
              {flujos.map(f => (
                <div key={f.id} style={styles.tablaFila} className="fila-hover">
                  <span style={{ flex: 1 }}>
                    <b>{f.nombre}</b>
                    {f.descripcion && <span style={{ color: '#64748b', fontSize: '12px', display: 'block' }}>{f.descripcion}</span>}
                  </span>
                  <span style={{ flex: 0.8, color: '#64748b' }}>{siteDe(f.site_id)?.nombre || '-'}</span>
                  <span style={{ flex: 2.3, fontSize: '13px', color: '#334155' }}>{cadenaDe(f.id) || 'Sin pasos'}</span>
                  <span style={{ flex: 0.6, textAlign: 'center' }}>{articulosCon(f.id).length}</span>
                  <span style={{ flex: 0.6, textAlign: 'center' }}>
                    <span style={{ ...styles.badge, ...(f.activo ? styles.badgeVerde : styles.badgeGris) }}>{f.activo ? 'Activa' : 'Inactiva'}</span>
                  </span>
                  <span style={{ width: '140px', textAlign: 'right', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                    {puedeEditar && (
                      <>
                        <button style={styles.botonAccion} onClick={() => { editarForm(f); window.scrollTo(0, 0) }}>Editar</button>
                        <button style={styles.botonAccion} onClick={() => toggleFlujo(f)}>{f.activo ? 'Desactivar' : 'Activar'}</button>
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ==================== ASIGNACION ==================== */}
      {vista === 'asignacion' && (
        <>
          <div style={styles.selectorBox}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
              <input type="checkbox" checked={soloSinFlujo} onChange={e => setSoloSinFlujo(e.target.checked)} />
              Mostrar solo articulos sin flujo asignado ({articulos.filter(a => !a.flujo_id).length})
            </label>
          </div>
          {articulosVisibles.length === 0 ? (
            <p style={{ color: '#666', padding: '10px 4px' }}>{soloSinFlujo ? 'Todos los articulos fabricados tienen flujo asignado.' : 'No hay articulos fabricados activos.'}</p>
          ) : (
            <div style={styles.tabla}>
              <div style={styles.tablaHeader}>
                <span style={{ flex: 2.2 }}>Articulo</span>
                <span style={{ flex: 1.5 }}>Plantilla de flujo</span>
                <span style={{ flex: 2.3 }}>Cadena</span>
              </div>
              {articulosVisibles.map(a => (
                <div key={a.id} style={styles.tablaFila} className="fila-hover">
                  <span style={{ flex: 2.2 }}>
                    <b>{a.codigo_interno}</b>
                    <span style={{ color: '#64748b', fontSize: '13px' }}> - {a.descripcion}</span>
                  </span>
                  <span style={{ flex: 1.5 }}>
                    {puedeEditar ? (
                      <select style={{ ...styles.input, padding: '6px 10px', fontSize: '13px' }} value={a.flujo_id || ''} onChange={e => asignarFlujo(a.id, e.target.value)}>
                        <option value="">Sin flujo</option>
                        {flujosActivos.map(f => <option key={f.id} value={f.id}>{f.nombre} ({siteDe(f.site_id)?.nombre || 'sin site'})</option>)}
                      </select>
                    ) : (
                      <span>{flujos.find(f => f.id === a.flujo_id)?.nombre || 'Sin flujo'}</span>
                    )}
                  </span>
                  <span style={{ flex: 2.3, fontSize: '12px', color: a.flujo_id ? '#334155' : '#dc2626' }}>
                    {a.flujo_id ? cadenaDe(a.flujo_id) : 'Sin flujo asignado: no se podra mover en almacen'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
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
  ayuda: { fontSize: '13px', color: '#64748b', margin: '0 0 16px 0', lineHeight: '1.6', backgroundColor: '#fff', borderRadius: '10px', padding: '14px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  selectorBox: { backgroundColor: '#fff', borderRadius: '10px', padding: '14px 20px', marginBottom: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center' },
  form: { backgroundColor: '#fff', borderRadius: '10px', padding: '24px', marginBottom: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  formTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 16px 0' },
  fila: { display: 'flex', gap: '16px', marginBottom: '12px' },
  filaPaso: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' },
  numeroPaso: { width: '26px', height: '26px', borderRadius: '50%', backgroundColor: '#f1f5f9', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: '600', flexShrink: 0 },
  numeroNace: { backgroundColor: '#dcfce7', color: '#16a34a' },
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
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '600' },
  badgeVerde: { backgroundColor: '#dcfce7', color: '#16a34a' },
  badgeGris: { backgroundColor: '#f1f5f9', color: '#64748b' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
