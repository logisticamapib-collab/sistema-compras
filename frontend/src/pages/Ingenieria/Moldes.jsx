import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { exportarExcel, imprimirTablaPDF } from '../../lib/exportar'

const formVacio = {
  clave: '', nombre: '', num_cavidades: 1,
  shots_alerta_min: '', shots_alerta_max: '', ubicacion_fisica: '',
  site_id: '', maquina_asignada_id: ''
}

export default function Moldes() {
  const { perfil, tienePermiso } = useAuth()
  const [moldes, setMoldes] = useState([])
  const [sites, setSites] = useState([])
  const [maquinas, setMaquinas] = useState([])
  const [filtroMol, setFiltroMol] = useState('')
  const [articulos, setArticulos] = useState([])
  const [loading, setLoading] = useState(true)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [editando, setEditando] = useState(null)
  const [moldeCavidades, setMoldeCavidades] = useState(null)
  const [form, setForm] = useState(formVacio)
  const [error, setError] = useState('')
  const [colores, setColores] = useState([])
  const [exito, setExito] = useState('')

  const puedeCrear = tienePermiso('ing_moldes', 'crear')
  const puedeEditar = tienePermiso('ing_moldes', 'editar')

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    // El orden de las variables DEBE seguir el orden de las consultas.
    const [{ data: mol }, { data: sit }, { data: maq }, { data: art }, { data: cols }] = await Promise.all([
      supabase.from('moldes').select('*, site:sites(nombre), maq:maquinas(clave)').eq('empresa_id', perfil.empresa_id).order('clave'),
      supabase.from('sites').select('id, nombre, codigo').eq('empresa_id', perfil.empresa_id).order('nombre'),
      supabase.from('maquinas').select('id, clave, nombre, site_id').eq('empresa_id', perfil.empresa_id).eq('activo', true).order('clave'),
      supabase.from('articulos').select('id, codigo_interno, descripcion, color_id').eq('empresa_id', perfil.empresa_id).eq('activo', true).order('codigo_interno'),
      supabase.from('colores').select('*').eq('empresa_id', perfil.empresa_id).eq('activo', true).order('orden_secuencia'),
    ])
    setMoldes(mol || [])
    setSites(sit || [])
    setMaquinas(maq || [])
    setArticulos(art || [])
    setColores(cols || [])
    setLoading(false)
  }

  const moldesFiltrados = moldes.filter(m => !filtroMol || (`${m.clave} ${m.nombre}`).toLowerCase().includes(filtroMol.toLowerCase()))
  const colsMol = [{ label: 'Clave', get: m => m.clave }, { label: 'Nombre', get: m => m.nombre }, { label: 'Cavidades', get: m => m.num_cavidades }, { label: 'Shots acum.', get: m => m.shots_acumulados }, { label: 'Estado', get: m => m.estado }, { label: 'Site', get: m => m.site?.nombre || '' }, { label: 'Maquina PPAP', get: m => m.maq?.clave || '' }, { label: 'Ubicacion', get: m => m.ubicacion_fisica || '' }, { label: 'Estatus', get: m => m.activo ? 'Activo' : 'Inactivo' }]
  const abrirNuevo = () => { setEditando(null); setForm(formVacio); setMostrarForm(true); setError('') }
  const abrirEditar = (m) => {
    setEditando(m)
    setForm({
      clave: m.clave, nombre: m.nombre || '', num_cavidades: m.num_cavidades,
      shots_alerta_min: m.shots_alerta_min || '', shots_alerta_max: m.shots_alerta_max || '',
      ubicacion_fisica: m.ubicacion_fisica || '',
      site_id: m.site_id?.toString() || '', maquina_asignada_id: m.maquina_asignada_id?.toString() || '',
    })
    setMostrarForm(true)
    setError('')
  }

  const guardar = async () => {
    if (!form.clave || !form.num_cavidades) { setError('Clave y numero de cavidades son obligatorios'); return }
    setError('')
    setLoading(true)

    const payload = {
      clave: form.clave, nombre: form.nombre, num_cavidades: parseInt(form.num_cavidades),
      shots_alerta_min: form.shots_alerta_min ? parseInt(form.shots_alerta_min) : null,
      shots_alerta_max: form.shots_alerta_max ? parseInt(form.shots_alerta_max) : null,
      ubicacion_fisica: form.ubicacion_fisica,
      site_id: form.site_id ? parseInt(form.site_id) : null,
      maquina_asignada_id: form.maquina_asignada_id ? parseInt(form.maquina_asignada_id) : null,
    }

    let error, moldeId
    if (editando) {
      const r = await supabase.from('moldes').update(payload).eq('id', editando.id)
      error = r.error
      moldeId = editando.id
    } else {
      const r = await supabase.from('moldes').insert({ ...payload, empresa_id: perfil.empresa_id }).select().single()
      error = r.error
      moldeId = r.data?.id
    }

    if (error) { setError(error.message.includes('unique') ? 'Esa clave ya existe' : error.message); setLoading(false); return }

    // Si cambio el numero de cavidades, asegurar que existan filas en molde_cavidades para cada una
    if (moldeId) {
      const { data: cavidadesExistentes } = await supabase.from('molde_cavidades').select('numero_cavidad').eq('molde_id', moldeId)
      const existentes = new Set((cavidadesExistentes || []).map(c => c.numero_cavidad))
      const faltantes = []
      for (let i = 1; i <= parseInt(form.num_cavidades); i++) {
        if (!existentes.has(i)) faltantes.push({ molde_id: moldeId, numero_cavidad: i })
      }
      if (faltantes.length > 0) await supabase.from('molde_cavidades').insert(faltantes)
    }

    setExito(editando ? 'Molde actualizado' : 'Molde creado, ya puedes asignar sus cavidades')
    setMostrarForm(false)
    await cargarDatos()
    setLoading(false)
    setTimeout(() => setExito(''), 3000)
  }

  const toggleActivo = async (m) => {
    await supabase.from('moldes').update({ activo: !m.activo }).eq('id', m.id)
    await cargarDatos()
  }

  const abrirCavidades = async (molde) => {
    const { data } = await supabase.from('molde_cavidades').select('*').eq('molde_id', molde.id).order('numero_cavidad')
    setMoldeCavidades({ molde, cavidades: data || [] })
  }

  // Una cavidad fisica produce siempre la misma geometria, pero el codigo de
  // articulo cambia con el color. Por eso una cavidad puede tener varias
  // filas: una por cada color que se corre en ese molde.
  const actualizarCavidad = (key, articuloId) => {
    setMoldeCavidades(prev => ({
      ...prev,
      cavidades: prev.cavidades.map(c => (c._key || c.id) === key
        ? { ...c, articulo_id: articuloId ? parseInt(articuloId) : null } : c)
    }))
  }

  const agregarVariante = (numeroCavidad) => {
    setMoldeCavidades(prev => ({
      ...prev,
      cavidades: [...prev.cavidades, {
        _key: `n${Date.now()}${Math.random()}`, _nuevo: true,
        molde_id: prev.molde.id, numero_cavidad: numeroCavidad, articulo_id: null, activa: true,
      }],
    }))
  }

  const quitarVariante = (key) => {
    setMoldeCavidades(prev => ({
      ...prev,
      cavidades: prev.cavidades
        .filter(c => !((c._key || c.id) === key && c._nuevo))
        .map(c => (c._key || c.id) === key ? { ...c, _borrar: true } : c),
    }))
  }

  // Tapar una cavidad afecta a TODOS sus colores a la vez: se tapa la cavidad
  // fisica, no el codigo. Al bajar el conteo suben los disparos, asi que el
  // plan de capacidad se alarga solo y el costo por pieza sube.
  const alternarBloqueo = async (numeroCavidad, bloquear) => {
    let motivo = null
    if (bloquear) {
      motivo = prompt(`Motivo por el que se tapa la cavidad #${numeroCavidad} (dano, balanceo de sets, etc.)`)
      if (motivo === null) return
    }
    setLoading(true); setError('')
    const { error: e } = await supabase.rpc('bloquear_cavidad', {
      p_molde_id: moldeCavidades.molde.id, p_numero_cavidad: numeroCavidad,
      p_bloquear: bloquear, p_motivo: motivo, p_usuario: perfil.id,
    })
    setLoading(false)
    if (e) { setError('No se pudo actualizar la cavidad: ' + e.message); return }
    setExito(bloquear ? `Cavidad #${numeroCavidad} tapada` : `Cavidad #${numeroCavidad} liberada`)
    setTimeout(() => setExito(''), 3000)
    abrirCavidades(moldeCavidades.molde)
  }

  const guardarCavidades = async () => {
    setLoading(true); setError('')
    try {
      for (const c of moldeCavidades.cavidades) {
        if (c._borrar && c.id) {
          const { error: e } = await supabase.from('molde_cavidades').delete().eq('id', c.id)
          if (e) throw e
        } else if (c._nuevo) {
          if (!c.articulo_id) continue
          const { error: e } = await supabase.from('molde_cavidades')
            .insert({ molde_id: c.molde_id, numero_cavidad: c.numero_cavidad, articulo_id: c.articulo_id, activa: true })
          if (e) throw e
        } else if (c.id) {
          const { error: e } = await supabase.from('molde_cavidades')
            .update({ articulo_id: c.articulo_id }).eq('id', c.id)
          if (e) throw e
        }
      }
    } catch (err) {
      setLoading(false)
      setError(err.message?.includes('duplicate') || err.message?.includes('unq')
        ? 'Ese articulo ya esta asignado a esa cavidad. Cada color debe capturarse una sola vez por cavidad.'
        : 'No se pudo guardar: ' + err.message)
      return
    }
    setLoading(false)
    setExito('Cavidades actualizadas correctamente')
    setMoldeCavidades(null)
    setTimeout(() => setExito(''), 3000)
  }

  if (moldeCavidades) {
    return (
      <div style={styles.container}>
        <button style={styles.botonVolver} onClick={() => setMoldeCavidades(null)}>&larr; Volver a moldes</button>
        <h2 style={styles.titulo}>Cavidades: {moldeCavidades.molde.clave}</h2>
        <p style={{ fontSize: '13px', color: '#666', marginBottom: '6px', lineHeight: 1.55 }}>
          Asigna que articulo produce cada cavidad. Si el molde produce piezas espejo (izquierda / derecha),
          asigna el articulo que corresponde a cada cavidad.
        </p>
        <p style={{ fontSize: '13px', color: '#666', marginBottom: '20px', lineHeight: 1.55 }}>
          <b>Variantes de color:</b> si la misma cavidad corre el mismo componente en varios colores, agrega
          una linea por color. Los articulos del <b>mismo color</b> salen juntos en un disparo; los de
          <b> distinto color</b> se corren por separado, con purga entre uno y otro.
        </p>
        {(() => {
          const activas = [...new Set(moldeCavidades.cavidades.filter(c => c.activa !== false).map(c => c.numero_cavidad))].length
          const nominal = moldeCavidades.molde.num_cavidades
            || [...new Set(moldeCavidades.cavidades.map(c => c.numero_cavidad))].length
          if (activas >= nominal) return null
          return (
            <div style={styles.avisoCav}>
              <b>{nominal - activas} de {nominal} cavidades tapadas.</b> El molde entrega {activas} piezas por
              disparo en vez de {nominal}, asi que las OT tardan mas y el costo por pieza sube. El plan de
              capacidad ya lo considera; el OEE sigue midiendo contra las {nominal} nominales para que la
              perdida de capacidad se vea como caida de desempeno.
            </div>
          )
        })()}
        <div style={styles.tabla}>
          <div style={styles.tablaHeader}>
            <span style={{ flex: 1 }}>Cavidad</span>
            <span style={{ flex: 3 }}>Articulo que produce</span>
            <span style={{ width: '190px' }}></span>
          </div>
          {[...new Set(moldeCavidades.cavidades.map(c => c.numero_cavidad))].sort((a, b) => a - b).map(num => {
            const filas = moldeCavidades.cavidades.filter(c => c.numero_cavidad === num && !c._borrar)
            return (
              <div key={num} style={{ borderBottom: '1px solid #f1f5f9', padding: '4px 0' }}>
                {filas.map((c, i) => {
                  const key = c._key || c.id
                  const art = articulos.find(x => x.id === c.articulo_id)
                  const col = colores.find(x => x.id === art?.color_id)
                  return (
                    <div key={key} style={{ ...styles.tablaFila, borderBottom: 'none', opacity: c.activa === false ? 0.45 : 1 }}>
                      <span style={{ flex: 1, fontWeight: '600' }}>{i === 0 ? `#${num}` : ''}</span>
                      <span style={{ flex: 3, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <select style={{ ...styles.input, flex: 1 }} value={c.articulo_id || ''}
                          onChange={e => actualizarCavidad(key, e.target.value)}>
                          <option value="">Sin asignar</option>
                          {articulos.map(a => <option key={a.id} value={a.id}>{a.codigo_interno} - {a.descripcion}</option>)}
                        </select>
                        {col && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', color: '#475569', whiteSpace: 'nowrap' }}>
                            <span style={{ width: '14px', height: '14px', borderRadius: '4px', border: '1px solid #cbd5e1', background: col.hex || '#fff' }} />
                            {col.clave}
                          </span>
                        )}
                      </span>
                      <span style={{ width: '90px', textAlign: 'right' }}>
                        {filas.length > 1 && (
                          <button style={styles.botonAccion} onClick={() => quitarVariante(key)}>Quitar</button>
                        )}
                      </span>
                    </div>
                  )
                })}
                <div style={{ padding: '2px 0 6px 12px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button style={{ ...styles.botonAccion, fontSize: '11.5px' }} onClick={() => agregarVariante(num)}>
                    + Variante de color en la cavidad #{num}
                  </button>
                  {(() => {
                    const tapada = moldeCavidades.cavidades.some(c => c.numero_cavidad === num && c.activa === false)
                    const conMotivo = moldeCavidades.cavidades.find(c => c.numero_cavidad === num && c.motivo_bloqueo)
                    return tapada ? (
                      <>
                        <span style={styles.tapadaTag}>Tapada{conMotivo?.motivo_bloqueo ? `: ${conMotivo.motivo_bloqueo}` : ''}</span>
                        <button style={{ ...styles.botonAccion, fontSize: '11.5px' }} onClick={() => alternarBloqueo(num, false)}>Liberar</button>
                      </>
                    ) : (
                      <button style={{ ...styles.botonAccion, fontSize: '11.5px', color: '#b45309', borderColor: '#fcd34d' }}
                        onClick={() => alternarBloqueo(num, true)}>Tapar cavidad</button>
                    )
                  })()}
                </div>
              </div>
            )
          })}
        </div>
        <div style={styles.botones}>
          <button style={styles.boton} onClick={guardarCavidades} disabled={loading}>{loading ? 'Guardando...' : 'Guardar cavidades'}</button>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Moldes</h2>
        {puedeCrear && (
          <button style={styles.boton} onClick={() => mostrarForm ? setMostrarForm(false) : abrirNuevo()}>
            {mostrarForm ? 'Cancelar' : '+ Nuevo molde'}
          </button>
        )}
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {mostrarForm && (
        <div style={styles.form} className="aparecer">
          <h3 style={styles.formTitulo}>{editando ? `Editando: ${editando.clave}` : 'Nuevo molde'}</h3>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Clave *</label>
              <input style={styles.input} value={form.clave} onChange={e => setForm({ ...form, clave: e.target.value.toUpperCase() })} placeholder="Ej: MLD-014" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Nombre</label>
              <input style={styles.input} value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Numero de cavidades *</label>
              <input style={styles.input} type="number" min="1" value={form.num_cavidades} onChange={e => setForm({ ...form, num_cavidades: e.target.value })} />
            </div>
          </div>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Shots alerta minimo</label>
              <input style={styles.input} type="number" value={form.shots_alerta_min} onChange={e => setForm({ ...form, shots_alerta_min: e.target.value })} placeholder="Ej: 450000" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Shots alerta maximo</label>
              <input style={styles.input} type="number" value={form.shots_alerta_max} onChange={e => setForm({ ...form, shots_alerta_max: e.target.value })} placeholder="Ej: 500000" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Site (planta a la que pertenece)</label>
              <select style={styles.input} value={form.site_id} onChange={e => setForm({ ...form, site_id: e.target.value, maquina_asignada_id: '' })}>
                <option value="">Sin asignar</option>
                {sites.map(x => <option key={x.id} value={x.id}>{x.codigo ? x.codigo + ' - ' : ''}{x.nombre}</option>)}
              </select>
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Maquina asignada (PPAP)</label>
              <select style={styles.input} value={form.maquina_asignada_id} onChange={e => setForm({ ...form, maquina_asignada_id: e.target.value })}>
                <option value="">Sin asignar</option>
                {maquinas.filter(x => !form.site_id || x.site_id === Number(form.site_id)).map(x => <option key={x.id} value={x.id}>{x.clave} - {x.nombre}</option>)}
              </select>
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Ubicacion fisica</label>
              <input style={styles.input} value={form.ubicacion_fisica} onChange={e => setForm({ ...form, ubicacion_fisica: e.target.value })} />
            </div>
          </div>
          <div style={styles.botones}>
            <button style={styles.boton} onClick={guardar} disabled={loading}>{loading ? 'Guardando...' : 'Guardar'}</button>
          </div>
        </div>
      )}

      <div className="no-imprimir" style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
        <input style={{ padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', width: '260px' }} value={filtroMol} onChange={e => setFiltroMol(e.target.value)} placeholder="Filtrar por clave o nombre..." />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <button style={{ padding: '9px 14px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' }} onClick={() => exportarExcel('moldes', colsMol, moldesFiltrados)}>Excel</button>
          <button style={{ padding: '9px 14px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' }} onClick={() => imprimirTablaPDF('Moldes', colsMol, moldesFiltrados)}>PDF</button>
        </div>
      </div>
      <div style={styles.tabla}>
        <div style={styles.tablaHeader}>
          <span style={{ flex: 1 }}>Clave</span>
          <span style={{ flex: 2 }}>Nombre</span>
          <span style={{ flex: 1 }}>Cavidades</span>
          <span style={{ flex: 1 }}>Shots acum.</span>
          <span style={{ flex: 1 }}>Estatus</span>
          <span style={{ flex: 2 }}>Acciones</span>
        </div>
        {loading ? <p style={{ padding: 20, color: '#666' }}>Cargando...</p> : moldes.length === 0 ? (
          <p style={{ padding: 20, color: '#666' }}>No hay moldes registrados</p>
        ) : moldesFiltrados.map(m => {
          const cercaDeAlerta = m.shots_alerta_max && m.shots_acumulados >= m.shots_alerta_max
          const enRangoAlerta = m.shots_alerta_min && m.shots_acumulados >= m.shots_alerta_min && !cercaDeAlerta
          return (
            <div key={m.id} style={styles.tablaFila} className="fila-hover">
              <span style={{ flex: 1, fontWeight: '600', color: '#2563eb', fontSize: '13px' }}>{m.clave}</span>
              <span style={{ flex: 2, fontSize: '14px' }}>{m.nombre}</span>
              <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{m.num_cavidades}</span>
              <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{m.shots_acumulados?.toLocaleString('es-MX') || 0}</span>
              <span style={{ flex: 1 }}>
                <span style={{ ...styles.badge, ...(cercaDeAlerta ? { backgroundColor: '#fef2f2', color: '#dc2626' } : enRangoAlerta ? { backgroundColor: '#fef9c3', color: '#854d0e' } : { backgroundColor: '#f0fdf4', color: '#16a34a' }) }}>
                  {cercaDeAlerta ? 'Requiere Mtto' : enRangoAlerta ? 'Cerca de Mtto' : 'OK'}
                </span>
              </span>
              <span style={{ flex: 2 }}>
                <button style={styles.botonAccion} onClick={() => abrirCavidades(m)}>Cavidades</button>
                {puedeEditar && <button style={{ ...styles.botonAccion, marginLeft: '6px' }} onClick={() => abrirEditar(m)}>Editar</button>}
                {puedeEditar && <button style={{ ...styles.botonAccion, marginLeft: '6px' }} onClick={() => toggleActivo(m)}>{m.activo ? 'Desactivar' : 'Activar'}</button>}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const styles = {
  avisoCav: { background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '8px', padding: '10px 12px', fontSize: '12.5px', color: '#92400e', marginBottom: '12px', lineHeight: 1.5 },
  tapadaTag: { fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '20px', background: '#fef3c7', color: '#b45309' },
  container: { padding: '28px' },
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0' },
  botonVolver: { padding: '6px 14px', backgroundColor: 'transparent', color: '#2563eb', border: '1px solid #2563eb', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', marginBottom: '16px' },
  form: { backgroundColor: '#fff', borderRadius: '10px', padding: '24px', marginBottom: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  formTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 16px 0' },
  fila: { display: 'flex', gap: '16px', marginBottom: '16px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', width: '100%', boxSizing: 'border-box' },
  botones: { display: 'flex', justifyContent: 'flex-end' },
  boton: { padding: '9px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '14px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '500' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
