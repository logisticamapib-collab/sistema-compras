import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Capa 3 - Almacen: instancias de almacen por site (con su TIPO de almacen virtual)
// y ubicaciones de clave libre dentro de cada almacen.

export default function Almacenes() {
  const { perfil, tienePermiso } = useAuth()
  const puedeCrear = tienePermiso('log_almacenes', 'crear')
  const puedeEditar = tienePermiso('log_almacenes', 'editar')

  const [sites, setSites] = useState([])
  const [tipos, setTipos] = useState([])
  const [almacenes, setAlmacenes] = useState([])
  const [ubicaciones, setUbicaciones] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  const [filtroSite, setFiltroSite] = useState('')
  const [expandido, setExpandido] = useState(null)

  // Form almacen (alta o edicion)
  const [form, setForm] = useState(null) // { id?, site_id, tipo_id, clave, nombre }
  // Form ubicacion por almacen
  const [formUbi, setFormUbi] = useState(null) // { almacen_id, id?, clave, descripcion }

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    const [s, t, a, u] = await Promise.all([
      supabase.from('sites').select('id, nombre').eq('activo', true).order('nombre'),
      supabase.from('almacenes_virtuales').select('*').order('orden'),
      supabase.from('almacenes').select('*').order('site_id').order('clave'),
      supabase.from('ubicaciones').select('*').order('clave'),
    ])
    setSites(s.data || [])
    setTipos(t.data || [])
    setAlmacenes(a.data || [])
    setUbicaciones(u.data || [])
    setLoading(false)
  }

  const guardarAlmacen = async () => {
    setError(''); setExito('')
    if (!form.site_id || !form.tipo_id || !form.clave.trim() || !form.nombre.trim()) {
      setError('Site, tipo, clave y nombre son obligatorios'); return
    }
    const datos = {
      site_id: Number(form.site_id),
      tipo_id: Number(form.tipo_id),
      clave: form.clave.trim().toUpperCase(),
      nombre: form.nombre.trim(),
    }
    let res
    if (form.id) {
      res = await supabase.from('almacenes').update(datos).eq('id', form.id)
    } else {
      res = await supabase.from('almacenes').insert({ ...datos, empresa_id: perfil.empresa_id })
    }
    if (res.error) {
      setError(res.error.message.includes('duplicate') ? `Ya existe un almacen con la clave "${datos.clave}" en ese site` : 'Error: ' + res.error.message)
      return
    }
    setExito(form.id ? 'Almacen actualizado' : 'Almacen creado')
    setForm(null)
    await cargarDatos()
  }

  const toggleActivo = async (a) => {
    await supabase.from('almacenes').update({ activo: !a.activo }).eq('id', a.id)
    await cargarDatos()
  }

  const guardarUbicacion = async () => {
    setError(''); setExito('')
    if (!formUbi.clave.trim()) { setError('La clave de la ubicacion es obligatoria'); return }
    const datos = { clave: formUbi.clave.trim().toUpperCase(), descripcion: formUbi.descripcion?.trim() || null }
    let res
    if (formUbi.id) {
      res = await supabase.from('ubicaciones').update(datos).eq('id', formUbi.id)
    } else {
      res = await supabase.from('ubicaciones').insert({ ...datos, almacen_id: formUbi.almacen_id })
    }
    if (res.error) {
      setError(res.error.message.includes('duplicate') ? `Ya existe la ubicacion "${datos.clave}" en este almacen` : 'Error: ' + res.error.message)
      return
    }
    setFormUbi(null)
    await cargarDatos()
  }

  const toggleUbicacion = async (u) => {
    await supabase.from('ubicaciones').update({ activo: !u.activo }).eq('id', u.id)
    await cargarDatos()
  }

  const tipoDe = (id) => tipos.find(t => t.id === id)
  const siteDe = (id) => sites.find(s => s.id === id)
  const ubisDe = (almacenId) => ubicaciones.filter(u => u.almacen_id === almacenId)

  const visibles = almacenes.filter(a => !filtroSite || a.site_id === Number(filtroSite))

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando almacenes...</p>

  return (
    <div style={styles.container} className="aparecer">
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Almacenes y Ubicaciones</h2>
        {puedeCrear && !form && (
          <button style={styles.boton} onClick={() => setForm({ site_id: filtroSite || '', tipo_id: '', clave: '', nombre: '' })}>+ Nuevo almacen</button>
        )}
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {form && (
        <div style={styles.form}>
          <h3 style={styles.formTitulo}>{form.id ? 'Editar almacen' : 'Nuevo almacen'}</h3>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Site *</label>
              <select style={styles.input} value={form.site_id} onChange={e => setForm({ ...form, site_id: e.target.value })}>
                <option value="">Selecciona...</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Tipo de almacen *</label>
              <select style={styles.input} value={form.tipo_id} onChange={e => setForm({ ...form, tipo_id: e.target.value })}>
                <option value="">Selecciona...</option>
                {tipos.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
              </select>
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Clave *</label>
              <input style={styles.input} value={form.clave} onChange={e => setForm({ ...form, clave: e.target.value })} placeholder="Ej. MP-01, PT-NORTE" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Nombre *</label>
              <input style={styles.input} value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Ej. Materia Prima Nave 1" />
            </div>
          </div>
          <div style={styles.botones}>
            <button style={styles.botonSec} onClick={() => setForm(null)}>Cancelar</button>
            <button style={styles.boton} onClick={guardarAlmacen}>{form.id ? 'Guardar cambios' : 'Crear almacen'}</button>
          </div>
        </div>
      )}

      <div style={styles.selectorBox}>
        <label style={{ ...styles.label, marginRight: '10px' }}>Site:</label>
        <select style={styles.input} value={filtroSite} onChange={e => setFiltroSite(e.target.value)}>
          <option value="">Todos</option>
          {sites.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      </div>

      {visibles.length === 0 ? (
        <p style={{ color: '#666', padding: '10px 4px' }}>No hay almacenes dados de alta{filtroSite ? ' en este site' : ''}. Usa "+ Nuevo almacen".</p>
      ) : (
        <div style={styles.tabla}>
          <div style={styles.tablaHeader}>
            <span style={{ flex: 1 }}>Clave</span>
            <span style={{ flex: 1.8 }}>Nombre</span>
            <span style={{ flex: 1.3 }}>Tipo</span>
            <span style={{ flex: 1.2 }}>Site</span>
            <span style={{ flex: 0.9, textAlign: 'center' }}>Ubicaciones</span>
            <span style={{ flex: 0.8, textAlign: 'center' }}>Estatus</span>
            <span style={{ width: '170px' }}></span>
          </div>
          {visibles.map(a => {
            const ubis = ubisDe(a.id)
            return (
              <div key={a.id}>
                <div style={styles.tablaFila} className="fila-hover">
                  <span style={{ flex: 1, fontWeight: '600' }}>{a.clave}</span>
                  <span style={{ flex: 1.8 }}>{a.nombre}</span>
                  <span style={{ flex: 1.3, color: '#64748b' }}>{tipoDe(a.tipo_id)?.nombre}</span>
                  <span style={{ flex: 1.2 }}>{siteDe(a.site_id)?.nombre}</span>
                  <span style={{ flex: 0.9, textAlign: 'center' }}>{ubis.filter(u => u.activo).length}</span>
                  <span style={{ flex: 0.8, textAlign: 'center' }}>
                    <span style={{ ...styles.badge, ...(a.activo ? styles.badgeVerde : styles.badgeGris) }}>{a.activo ? 'Activo' : 'Inactivo'}</span>
                  </span>
                  <span style={{ width: '170px', textAlign: 'right', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                    <button style={styles.botonAccion} onClick={() => setExpandido(expandido === a.id ? null : a.id)}>
                      {expandido === a.id ? 'Ocultar' : 'Ubicaciones'}
                    </button>
                    {puedeEditar && (
                      <>
                        <button style={styles.botonAccion} onClick={() => { setForm({ id: a.id, site_id: a.site_id, tipo_id: a.tipo_id, clave: a.clave, nombre: a.nombre }); window.scrollTo(0, 0) }}>Editar</button>
                        <button style={styles.botonAccion} onClick={() => toggleActivo(a)}>{a.activo ? 'Desactivar' : 'Activar'}</button>
                      </>
                    )}
                  </span>
                </div>
                {expandido === a.id && (
                  <div style={styles.subTabla}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 20px 4px' }}>
                      <span style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' }}>Ubicaciones de {a.clave}</span>
                      {puedeEditar && !formUbi && (
                        <button style={styles.botonAccion} onClick={() => setFormUbi({ almacen_id: a.id, clave: '', descripcion: '' })}>+ Agregar ubicacion</button>
                      )}
                    </div>
                    {formUbi?.almacen_id === a.id && (
                      <div style={styles.formUbicacion}>
                        <div style={{ ...styles.campo, flex: 0.8 }}>
                          <label style={styles.label}>Clave *</label>
                          <input style={styles.input} value={formUbi.clave} onChange={e => setFormUbi({ ...formUbi, clave: e.target.value })} placeholder="Ej. R1-A3, TOLVA-2" autoFocus />
                        </div>
                        <div style={{ ...styles.campo, flex: 1.5 }}>
                          <label style={styles.label}>Descripcion</label>
                          <input style={styles.input} value={formUbi.descripcion || ''} onChange={e => setFormUbi({ ...formUbi, descripcion: e.target.value })} placeholder="Opcional" />
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                          <button style={styles.botonSec} onClick={() => setFormUbi(null)}>Cancelar</button>
                          <button style={styles.boton} onClick={guardarUbicacion}>{formUbi.id ? 'Guardar' : 'Agregar'}</button>
                        </div>
                      </div>
                    )}
                    {ubis.length === 0 ? (
                      <p style={{ color: '#94a3b8', fontSize: '13px', padding: '4px 20px 10px' }}>Sin ubicaciones. El inventario se manejara a nivel almacen hasta que agregues ubicaciones.</p>
                    ) : (
                      ubis.map(u => (
                        <div key={u.id} style={{ ...styles.tablaFila, padding: '7px 20px', fontSize: '13px' }}>
                          <span style={{ flex: 0.8, fontWeight: '600' }}>{u.clave}</span>
                          <span style={{ flex: 1.5, color: '#64748b' }}>{u.descripcion || '-'}</span>
                          <span style={{ flex: 0.6, textAlign: 'center' }}>
                            <span style={{ ...styles.badge, ...(u.activo ? styles.badgeVerde : styles.badgeGris) }}>{u.activo ? 'Activa' : 'Inactiva'}</span>
                          </span>
                          <span style={{ width: '150px', textAlign: 'right', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                            {puedeEditar && (
                              <>
                                <button style={styles.botonAccion} onClick={() => setFormUbi({ almacen_id: a.id, id: u.id, clave: u.clave, descripcion: u.descripcion || '' })}>Editar</button>
                                <button style={styles.botonAccion} onClick={() => toggleUbicacion(u)}>{u.activo ? 'Desactivar' : 'Activar'}</button>
                              </>
                            )}
                          </span>
                        </div>
                      ))
                    )}
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
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0' },
  selectorBox: { backgroundColor: '#fff', borderRadius: '10px', padding: '14px 20px', marginBottom: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center' },
  form: { backgroundColor: '#fff', borderRadius: '10px', padding: '24px', marginBottom: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  formTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 16px 0' },
  formUbicacion: { display: 'flex', gap: '12px', padding: '10px 20px', backgroundColor: '#eff6ff', alignItems: 'flex-end' },
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
  subTabla: { backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', padding: '4px 0 8px' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '600' },
  badgeVerde: { backgroundColor: '#dcfce7', color: '#16a34a' },
  badgeGris: { backgroundColor: '#f1f5f9', color: '#64748b' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
