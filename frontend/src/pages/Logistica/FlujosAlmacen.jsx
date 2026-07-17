import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Capa 3 - Flujos de Almacen: plantillas con la secuencia de TIPOS de almacen
// que sigue un producto en su fabricacion. El paso 1 es donde NACE el producto
// (donde se registra al reportar produccion). Las plantillas se asignan a los
// articulos fabricados; sera la ruta que respeten los movimientos de inventario.

export default function FlujosAlmacen() {
  const { perfil, tienePermiso } = useAuth()
  const puedeCrear = tienePermiso('log_flujos', 'crear')
  const puedeEditar = tienePermiso('log_flujos', 'editar')

  const [vista, setVista] = useState('plantillas')
  const [tipos, setTipos] = useState([])
  const [flujos, setFlujos] = useState([])
  const [pasos, setPasos] = useState([])
  const [articulos, setArticulos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  // Form plantilla: { id?, nombre, descripcion, pasos: [{ tipo_almacen_id, nota }] }
  const [form, setForm] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [soloSinFlujo, setSoloSinFlujo] = useState(false)

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    const [t, f, p, a] = await Promise.all([
      supabase.from('almacenes_virtuales').select('*').order('orden'),
      supabase.from('flujos_almacen').select('*').order('nombre'),
      supabase.from('flujo_pasos').select('*').order('secuencia'),
      supabase.from('articulos').select('id, codigo_interno, descripcion, flujo_id, tipo_proceso')
        .eq('empresa_id', perfil.empresa_id).eq('origen', 'fabricado').eq('activo', true).order('codigo_interno'),
    ])
    setTipos(t.data || [])
    setFlujos(f.data || [])
    setPasos(p.data || [])
    setArticulos(a.data || [])
    setLoading(false)
  }

  const tipoDe = (id) => tipos.find(t => t.id === id)
  const pasosDe = (flujoId) => pasos.filter(p => p.flujo_id === flujoId)
  const articulosCon = (flujoId) => articulos.filter(a => a.flujo_id === flujoId)

  const cadenaDe = (flujoId) => pasosDe(flujoId).map(p => tipoDe(p.tipo_almacen_id)?.nombre || '?').join(' -> ')

  // ---------- Plantillas ----------
  const nuevoForm = () => setForm({ nombre: '', descripcion: '', pasos: [{ tipo_almacen_id: '', nota: '' }] })

  const editarForm = (f) => setForm({
    id: f.id, nombre: f.nombre, descripcion: f.descripcion || '',
    pasos: pasosDe(f.id).map(p => ({ tipo_almacen_id: String(p.tipo_almacen_id), nota: p.nota || '' })),
  })

  const setPaso = (i, campo, valor) => {
    const nuevos = form.pasos.map((p, j) => j === i ? { ...p, [campo]: valor } : p)
    setForm({ ...form, pasos: nuevos })
  }
  const agregarPaso = () => setForm({ ...form, pasos: [...form.pasos, { tipo_almacen_id: '', nota: '' }] })
  const quitarPaso = (i) => setForm({ ...form, pasos: form.pasos.filter((_, j) => j !== i) })
  const moverPaso = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= form.pasos.length) return
    const nuevos = [...form.pasos]
    ;[nuevos[i], nuevos[j]] = [nuevos[j], nuevos[i]]
    setForm({ ...form, pasos: nuevos })
  }

  const guardarFlujo = async () => {
    setError(''); setExito('')
    if (!form.nombre.trim()) { setError('El nombre de la plantilla es obligatorio'); return }
    const pasosValidos = form.pasos.filter(p => p.tipo_almacen_id)
    if (pasosValidos.length === 0) { setError('Agrega al menos un paso (el paso 1 es donde nace el producto)'); return }
    setGuardando(true)
    try {
      let flujoId = form.id
      if (form.id) {
        const { error: e1 } = await supabase.from('flujos_almacen')
          .update({ nombre: form.nombre.trim(), descripcion: form.descripcion.trim() || null }).eq('id', form.id)
        if (e1) throw e1
        const { error: e2 } = await supabase.from('flujo_pasos').delete().eq('flujo_id', form.id)
        if (e2) throw e2
      } else {
        const { data, error: e1 } = await supabase.from('flujos_almacen')
          .insert({ empresa_id: perfil.empresa_id, nombre: form.nombre.trim(), descripcion: form.descripcion.trim() || null })
          .select().single()
        if (e1) throw e1
        flujoId = data.id
      }
      const filas = pasosValidos.map((p, i) => ({
        flujo_id: flujoId, secuencia: i + 1, tipo_almacen_id: Number(p.tipo_almacen_id), nota: p.nota.trim() || null,
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
          {form && (
            <div style={styles.form}>
              <h3 style={styles.formTitulo}>{form.id ? 'Editar plantilla' : 'Nueva plantilla de flujo'}</h3>
              <div style={styles.fila}>
                <div style={styles.campo}>
                  <label style={styles.label}>Nombre *</label>
                  <input style={styles.input} value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Ej. Inyeccion estandar" />
                </div>
                <div style={{ ...styles.campo, flex: 2 }}>
                  <label style={styles.label}>Descripcion</label>
                  <input style={styles.input} value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })} placeholder="Opcional" />
                </div>
              </div>
              <p style={{ ...styles.label, margin: '4px 0 8px' }}>
                Pasos del flujo (el <b>paso 1 es donde NACE el producto</b> al reportar produccion; el ultimo es de donde se embarca):
              </p>
              {form.pasos.map((p, i) => (
                <div key={i} style={styles.filaPaso}>
                  <span style={{ ...styles.numeroPaso, ...(i === 0 ? styles.numeroNace : {}) }}>{i + 1}</span>
                  <select style={{ ...styles.input, flex: 1.2 }} value={p.tipo_almacen_id} onChange={e => setPaso(i, 'tipo_almacen_id', e.target.value)}>
                    <option value="">Tipo de almacen...</option>
                    {tipos.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                  </select>
                  <input style={{ ...styles.input, flex: 1.5 }} value={p.nota} onChange={e => setPaso(i, 'nota', e.target.value)} placeholder={i === 0 ? 'Nacimiento del producto' : 'Nota opcional'} />
                  <button style={styles.botonAccion} onClick={() => moverPaso(i, -1)} disabled={i === 0}>&#8593;</button>
                  <button style={styles.botonAccion} onClick={() => moverPaso(i, 1)} disabled={i === form.pasos.length - 1}>&#8595;</button>
                  <button style={styles.botonAccion} onClick={() => quitarPaso(i)} disabled={form.pasos.length === 1}>Quitar</button>
                </div>
              ))}
              <button style={{ ...styles.botonAccion, margin: '4px 0 14px 34px' }} onClick={agregarPaso}>+ Agregar paso</button>
              <div style={styles.botones}>
                <button style={styles.botonSec} onClick={() => setForm(null)} disabled={guardando}>Cancelar</button>
                <button style={styles.boton} onClick={guardarFlujo} disabled={guardando}>{guardando ? 'Guardando...' : form.id ? 'Guardar cambios' : 'Crear plantilla'}</button>
              </div>
            </div>
          )}

          {flujos.length === 0 && !form ? (
            <p style={{ color: '#666', padding: '10px 4px' }}>No hay plantillas. Crea la primera con "+ Nueva plantilla" (ej. Produccion -&gt; WIP -&gt; Calidad -&gt; Producto Terminado).</p>
          ) : (
            <div style={styles.tabla}>
              <div style={styles.tablaHeader}>
                <span style={{ flex: 1 }}>Plantilla</span>
                <span style={{ flex: 2.5 }}>Flujo (paso 1 = nacimiento)</span>
                <span style={{ flex: 0.7, textAlign: 'center' }}>Articulos</span>
                <span style={{ flex: 0.7, textAlign: 'center' }}>Estatus</span>
                <span style={{ width: '140px' }}></span>
              </div>
              {flujos.map(f => (
                <div key={f.id} style={styles.tablaFila} className="fila-hover">
                  <span style={{ flex: 1 }}>
                    <b>{f.nombre}</b>
                    {f.descripcion && <span style={{ color: '#64748b', fontSize: '12px', display: 'block' }}>{f.descripcion}</span>}
                  </span>
                  <span style={{ flex: 2.5, fontSize: '13px', color: '#334155' }}>{cadenaDe(f.id) || 'Sin pasos'}</span>
                  <span style={{ flex: 0.7, textAlign: 'center' }}>{articulosCon(f.id).length}</span>
                  <span style={{ flex: 0.7, textAlign: 'center' }}>
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
                <span style={{ flex: 1.4 }}>Plantilla de flujo</span>
                <span style={{ flex: 2.4 }}>Cadena</span>
              </div>
              {articulosVisibles.map(a => (
                <div key={a.id} style={styles.tablaFila} className="fila-hover">
                  <span style={{ flex: 2.2 }}>
                    <b>{a.codigo_interno}</b>
                    <span style={{ color: '#64748b', fontSize: '13px' }}> - {a.descripcion}</span>
                  </span>
                  <span style={{ flex: 1.4 }}>
                    {puedeEditar ? (
                      <select style={{ ...styles.input, padding: '6px 10px', fontSize: '13px' }} value={a.flujo_id || ''} onChange={e => asignarFlujo(a.id, e.target.value)}>
                        <option value="">Sin flujo</option>
                        {flujosActivos.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
                      </select>
                    ) : (
                      <span>{flujos.find(f => f.id === a.flujo_id)?.nombre || 'Sin flujo'}</span>
                    )}
                  </span>
                  <span style={{ flex: 2.4, fontSize: '12px', color: a.flujo_id ? '#334155' : '#dc2626' }}>
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
