import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const tiposOperacion = [
  { value: 'inyeccion', label: 'Inyeccion' },
  { value: 'ensamble', label: 'Ensamble' },
  { value: 'doble_inyeccion', label: 'Doble Inyeccion (2K en un ciclo)' },
]

const pasoVacio = {
  site_id: '', tipo_operacion: 'inyeccion', maquina_principal_id: '',
  molde_id: '', personal_requerido: 1, tiempo_estandar_seg: '',
}

export default function RutasFabricacion() {
  const { perfil, tienePermiso } = useAuth()
  const [articulos, setArticulos] = useState([])
  const [articuloId, setArticuloId] = useState('')
  const [sites, setSites] = useState([])
  const [maquinas, setMaquinas] = useState([])
  const [moldes, setMoldes] = useState([])
  const [pasos, setPasos] = useState([])
  const [alternasPorPaso, setAlternasPorPaso] = useState({})
  const [mostrarForm, setMostrarForm] = useState(false)
  const [editandoPaso, setEditandoPaso] = useState(null)
  const [nuevoPaso, setNuevoPaso] = useState(pasoVacio)
  const [nuevasAlternas, setNuevasAlternas] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  const puedeCrear = tienePermiso('ing_rutas', 'crear')
  const puedeEditar = tienePermiso('ing_rutas', 'editar')

  useEffect(() => { cargarCatalogos() }, [])
  useEffect(() => { if (articuloId) cargarRuta() }, [articuloId])

  const cargarCatalogos = async () => {
    const [{ data: a }, { data: s }, { data: m }, { data: mo }] = await Promise.all([
      supabase.from('articulos').select('id, codigo_interno, descripcion').eq('empresa_id', perfil.empresa_id).eq('origen', 'fabricado').eq('activo', true).order('codigo_interno'),
      supabase.from('sites').select('id, nombre').eq('empresa_id', perfil.empresa_id),
      supabase.from('maquinas').select('id, clave, nombre, tipo, site_id').eq('empresa_id', perfil.empresa_id).eq('activo', true),
      supabase.from('moldes').select('id, clave, nombre').eq('empresa_id', perfil.empresa_id).eq('activo', true),
    ])
    setArticulos(a || [])
    setSites(s || [])
    setMaquinas(m || [])
    setMoldes(mo || [])
  }

  const cargarRuta = async () => {
    setLoading(true)
    const { data: p } = await supabase.from('rutas_fabricacion')
      .select('*, sites(nombre), maquinas(clave, nombre), moldes(clave, nombre)')
      .eq('articulo_id', articuloId)
      .order('secuencia')
    setPasos(p || [])

    if (p && p.length > 0) {
      const { data: alt } = await supabase.from('ruta_maquinas_alternas')
        .select('*, maquinas(clave, nombre)')
        .in('ruta_id', p.map(x => x.id))
      const mapa = {}
      for (const a of alt || []) {
        if (!mapa[a.ruta_id]) mapa[a.ruta_id] = []
        mapa[a.ruta_id].push(a)
      }
      setAlternasPorPaso(mapa)
    } else {
      setAlternasPorPaso({})
    }
    setLoading(false)
  }

  const agregarAlternaNueva = () => {
    setNuevasAlternas([...nuevasAlternas, { maquina_id: '', aprobada_por_cliente: false }])
  }
  const actualizarAlternaNueva = (i, campo, valor) => {
    const copia = [...nuevasAlternas]
    copia[i] = { ...copia[i], [campo]: valor }
    setNuevasAlternas(copia)
  }
  const quitarAlternaNueva = (i) => {
    setNuevasAlternas(nuevasAlternas.filter((_, idx) => idx !== i))
  }

  const abrirNuevoPaso = () => {
    setEditandoPaso(null)
    setNuevoPaso(pasoVacio)
    setNuevasAlternas([])
    setMostrarForm(true)
    setError('')
  }

  const abrirEditarPaso = (p) => {
    setEditandoPaso(p)
    setNuevoPaso({
      site_id: p.site_id?.toString() || '',
      tipo_operacion: p.tipo_operacion,
      maquina_principal_id: p.maquina_principal_id?.toString() || '',
      molde_id: p.molde_id?.toString() || '',
      personal_requerido: p.personal_requerido || 1,
      tiempo_estandar_seg: p.tiempo_estandar_seg?.toString() || '',
    })
    setNuevasAlternas((alternasPorPaso[p.id] || []).map(a => ({
      maquina_id: a.maquina_id?.toString() || '',
      aprobada_por_cliente: a.aprobada_por_cliente || false,
    })))
    setMostrarForm(true)
    setError('')
  }

  const guardarPaso = async () => {
    if (!nuevoPaso.tipo_operacion || !nuevoPaso.maquina_principal_id) {
      setError('Tipo de operacion y maquina principal son obligatorios')
      return
    }
    setError('')
    setLoading(true)

    const payload = {
      site_id: nuevoPaso.site_id ? parseInt(nuevoPaso.site_id) : null,
      tipo_operacion: nuevoPaso.tipo_operacion,
      maquina_principal_id: parseInt(nuevoPaso.maquina_principal_id),
      molde_id: nuevoPaso.molde_id ? parseInt(nuevoPaso.molde_id) : null,
      personal_requerido: parseInt(nuevoPaso.personal_requerido) || 1,
      tiempo_estandar_seg: nuevoPaso.tiempo_estandar_seg ? parseFloat(nuevoPaso.tiempo_estandar_seg) : null,
    }

    let rutaId
    if (editandoPaso) {
      const { error: errorRuta } = await supabase.from('rutas_fabricacion')
        .update(payload).eq('id', editandoPaso.id)
      if (errorRuta) { setError(errorRuta.message); setLoading(false); return }
      rutaId = editandoPaso.id
      // Reemplazar las maquinas alternas con la lista del formulario
      await supabase.from('ruta_maquinas_alternas').delete().eq('ruta_id', rutaId)
    } else {
      const siguienteSecuencia = pasos.length > 0 ? Math.max(...pasos.map(p => p.secuencia)) + 1 : 1
      const { data: ruta, error: errorRuta } = await supabase.from('rutas_fabricacion')
        .insert({ articulo_id: parseInt(articuloId), secuencia: siguienteSecuencia, ...payload })
        .select()
        .single()
      if (errorRuta) { setError(errorRuta.message); setLoading(false); return }
      rutaId = ruta.id
    }

    const alternasValidas = nuevasAlternas.filter(a => a.maquina_id)
    if (alternasValidas.length > 0) {
      await supabase.from('ruta_maquinas_alternas').insert(
        alternasValidas.map(a => ({
          ruta_id: rutaId,
          maquina_id: parseInt(a.maquina_id),
          aprobada_por_cliente: a.aprobada_por_cliente,
        }))
      )
    }

    setExito(editandoPaso ? `Paso ${editandoPaso.secuencia} actualizado` : 'Paso agregado correctamente')
    setMostrarForm(false)
    setEditandoPaso(null)
    setNuevoPaso(pasoVacio)
    setNuevasAlternas([])
    await cargarRuta()
    setLoading(false)
    setTimeout(() => setExito(''), 3000)
  }

  const eliminarPaso = async (paso) => {
    if (!confirm(`Eliminar el paso ${paso.secuencia} de la ruta?`)) return
    await supabase.from('ruta_maquinas_alternas').delete().eq('ruta_id', paso.id)
    await supabase.from('rutas_fabricacion').delete().eq('id', paso.id)
    await cargarRuta()
  }

  const toggleAprobadaCliente = async (alterna) => {
    await supabase.from('ruta_maquinas_alternas').update({ aprobada_por_cliente: !alterna.aprobada_por_cliente }).eq('id', alterna.id)
    await cargarRuta()
  }

  const maquinasFiltradas = maquinas.filter(m =>
    nuevoPaso.tipo_operacion === 'ensamble' ? m.tipo === 'ensamble' : m.tipo === 'inyeccion'
  )

  return (
    <div style={styles.container}>
      <h2 style={styles.titulo}>Rutas de Fabricacion</h2>
      <p style={styles.subtitulo}>Define la secuencia de operaciones, maquinas y moldes para fabricar cada articulo.</p>

      <div style={styles.selectorArticulo}>
        <label style={styles.label}>Articulo</label>
        <select style={styles.input} value={articuloId} onChange={e => { setArticuloId(e.target.value); setMostrarForm(false); setEditandoPaso(null) }}>
          <option value="">Selecciona un articulo fabricado</option>
          {articulos.map(a => <option key={a.id} value={a.id}>{a.codigo_interno} - {a.descripcion}</option>)}
        </select>
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {articuloId && (
        <>
          <div style={styles.pasos}>
            {loading ? <p style={{ color: '#666' }}>Cargando...</p> : pasos.length === 0 ? (
              <p style={{ color: '#666' }}>Este articulo aun no tiene ruta de fabricacion.</p>
            ) : pasos.map(p => (
              <div key={p.id} style={styles.pasoCard}>
                <div style={styles.pasoNumero}>{p.secuencia}</div>
                <div style={{ flex: 1 }}>
                  <p style={styles.pasoTitulo}>
                    {tiposOperacion.find(t => t.value === p.tipo_operacion)?.label} &middot; {p.sites?.nombre || 'Sin site'}
                  </p>
                  <p style={styles.pasoDetalle}>
                    Maquina principal: <strong>{p.maquinas?.clave}</strong>
                    {p.moldes && <> &middot; Molde: <strong>{p.moldes.clave}</strong></>}
                    {' '}&middot; Personal: {p.personal_requerido} &middot; Ciclo: {p.tiempo_estandar_seg ? `${p.tiempo_estandar_seg} seg` : '-'}
                  </p>
                  {alternasPorPaso[p.id]?.length > 0 && (
                    <div style={styles.alternasBox}>
                      <p style={styles.alternasTitulo}>Maquinas alternas:</p>
                      {alternasPorPaso[p.id].map(a => (
                        <div key={a.id} style={styles.alternaItem}>
                          <span>{a.maquinas?.clave} - {a.maquinas?.nombre}</span>
                          <button
                            style={a.aprobada_por_cliente ? styles.badgeAprobada : styles.badgePendiente}
                            onClick={() => puedeEditar && toggleAprobadaCliente(a)}>
                            {a.aprobada_por_cliente ? 'Aprobada por cliente' : 'Sin aprobar por cliente'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {puedeEditar && (
                  <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                    <button style={styles.botonEditar} onClick={() => abrirEditarPaso(p)}>Editar</button>
                    <button style={styles.botonEliminar} onClick={() => eliminarPaso(p)}>Eliminar</button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {(puedeCrear || (puedeEditar && editandoPaso)) && (
            <div style={styles.seccionAgregar}>
              {!mostrarForm ? (
                puedeCrear && <button style={styles.boton} onClick={abrirNuevoPaso}>+ Agregar paso a la ruta</button>
              ) : (
                <div style={styles.form} className="aparecer">
                  <h3 style={styles.formTitulo}>
                    {editandoPaso
                      ? `Editando paso ${editandoPaso.secuencia}`
                      : `Nuevo paso (secuencia ${pasos.length > 0 ? Math.max(...pasos.map(p => p.secuencia)) + 1 : 1})`}
                  </h3>
                  <div style={styles.fila}>
                    <div style={styles.campo}>
                      <label style={styles.label}>Tipo de operacion *</label>
                      <select style={styles.input} value={nuevoPaso.tipo_operacion}
                        onChange={e => setNuevoPaso({ ...nuevoPaso, tipo_operacion: e.target.value, maquina_principal_id: '' })}>
                        {tiposOperacion.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <div style={styles.campo}>
                      <label style={styles.label}>Site</label>
                      <select style={styles.input} value={nuevoPaso.site_id} onChange={e => setNuevoPaso({ ...nuevoPaso, site_id: e.target.value })}>
                        <option value="">Selecciona</option>
                        {sites.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                      </select>
                    </div>
                  </div>
                  <div style={styles.fila}>
                    <div style={styles.campo}>
                      <label style={styles.label}>Maquina principal *</label>
                      <select style={styles.input} value={nuevoPaso.maquina_principal_id} onChange={e => setNuevoPaso({ ...nuevoPaso, maquina_principal_id: e.target.value })}>
                        <option value="">Selecciona</option>
                        {maquinasFiltradas.map(m => <option key={m.id} value={m.id}>{m.clave} - {m.nombre}</option>)}
                      </select>
                    </div>
                    {nuevoPaso.tipo_operacion !== 'ensamble' && (
                      <div style={styles.campo}>
                        <label style={styles.label}>Molde</label>
                        <select style={styles.input} value={nuevoPaso.molde_id} onChange={e => setNuevoPaso({ ...nuevoPaso, molde_id: e.target.value })}>
                          <option value="">Selecciona</option>
                          {moldes.map(m => <option key={m.id} value={m.id}>{m.clave} - {m.nombre}</option>)}
                        </select>
                      </div>
                    )}
                    <div style={styles.campo}>
                      <label style={styles.label}>Personal requerido</label>
                      <input style={styles.input} type="number" min="1" value={nuevoPaso.personal_requerido}
                        onChange={e => setNuevoPaso({ ...nuevoPaso, personal_requerido: e.target.value })} />
                    </div>
                    <div style={styles.campo}>
                      <label style={styles.label}>Tiempo estandar (seg)</label>
                      <input style={styles.input} type="number" step="0.01" value={nuevoPaso.tiempo_estandar_seg}
                        onChange={e => setNuevoPaso({ ...nuevoPaso, tiempo_estandar_seg: e.target.value })} placeholder="Ciclo por pieza/shot" />
                    </div>
                  </div>

                  <div style={styles.alternasEdicion}>
                    <p style={styles.alternasTitulo}>Maquinas alternas (opcional)</p>
                    {nuevasAlternas.map((a, i) => (
                      <div key={i} style={styles.filaAlternaNueva}>
                        <select style={styles.input} value={a.maquina_id} onChange={e => actualizarAlternaNueva(i, 'maquina_id', e.target.value)}>
                          <option value="">Selecciona maquina alterna</option>
                          {maquinasFiltradas.filter(m => m.id.toString() !== nuevoPaso.maquina_principal_id).map(m => (
                            <option key={m.id} value={m.id}>{m.clave} - {m.nombre}</option>
                          ))}
                        </select>
                        <label style={styles.checkboxAlterna}>
                          <input type="checkbox" checked={a.aprobada_por_cliente}
                            onChange={e => actualizarAlternaNueva(i, 'aprobada_por_cliente', e.target.checked)} />
                          Aprobada por cliente
                        </label>
                        <button style={styles.botonQuitar} onClick={() => quitarAlternaNueva(i)}>Quitar</button>
                      </div>
                    ))}
                    <button style={styles.botonAgregarAlterna} onClick={agregarAlternaNueva}>+ Agregar maquina alterna</button>
                  </div>

                  <div style={styles.botones}>
                    <button style={styles.botonSecundario} onClick={() => { setMostrarForm(false); setEditandoPaso(null); setNuevoPaso(pasoVacio); setNuevasAlternas([]) }}>Cancelar</button>
                    <button style={styles.boton} onClick={guardarPaso} disabled={loading}>
                      {loading ? 'Guardando...' : editandoPaso ? 'Actualizar paso' : 'Guardar paso'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

const styles = {
  container: { padding: '28px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 6px 0' },
  subtitulo: { fontSize: '13px', color: '#666', margin: '0 0 20px 0' },
  selectorArticulo: { backgroundColor: '#fff', borderRadius: '10px', padding: '16px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: '20px', display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '500px' },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', width: '100%', boxSizing: 'border-box' },
  pasos: { display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' },
  pasoCard: { display: 'flex', gap: '16px', backgroundColor: '#fff', borderRadius: '10px', padding: '18px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', alignItems: 'flex-start' },
  pasoNumero: { width: '28px', height: '28px', borderRadius: '50%', backgroundColor: '#2563eb', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: '700', flexShrink: 0 },
  pasoTitulo: { margin: '2px 0 4px 0', fontSize: '14px', fontWeight: '600', color: '#1a1a2e' },
  pasoDetalle: { margin: '0', fontSize: '13px', color: '#666' },
  alternasBox: { marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed #e2e8f0' },
  alternasTitulo: { fontSize: '12px', fontWeight: '600', color: '#444', margin: '0 0 6px 0' },
  alternaItem: { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', marginBottom: '4px' },
  badgeAprobada: { padding: '2px 8px', borderRadius: '20px', fontSize: '11px', backgroundColor: '#f0fdf4', color: '#16a34a', border: 'none', cursor: 'pointer' },
  badgePendiente: { padding: '2px 8px', borderRadius: '20px', fontSize: '11px', backgroundColor: '#fef9c3', color: '#854d0e', border: 'none', cursor: 'pointer' },
  botonEditar: { padding: '6px 12px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' },
  botonEliminar: { padding: '6px 12px', backgroundColor: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' },
  seccionAgregar: { marginTop: '10px' },
  boton: { padding: '10px 22px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSecundario: { padding: '10px 22px', backgroundColor: '#e2e8f0', color: '#444', border: 'none', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  form: { backgroundColor: '#fff', borderRadius: '10px', padding: '24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  formTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 16px 0' },
  fila: { display: 'flex', gap: '16px', marginBottom: '16px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 },
  alternasEdicion: { backgroundColor: '#f8fafc', borderRadius: '8px', padding: '14px', marginBottom: '16px' },
  filaAlternaNueva: { display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '8px' },
  checkboxAlterna: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#444', whiteSpace: 'nowrap' },
  botonQuitar: { padding: '6px 10px', backgroundColor: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' },
  botonAgregarAlterna: { padding: '6px 14px', backgroundColor: '#fff', color: '#2563eb', border: '1px solid #2563eb', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' },
  botones: { display: 'flex', justifyContent: 'flex-end', gap: '10px' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
