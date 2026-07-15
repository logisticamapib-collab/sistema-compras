import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const formVacio = { componente_articulo_id: '', tipo_componente: 'articulo', norma_empaque_id: '', cantidad_por_unidad: '', unidad_medida: '' }

export default function BOM() {
  const { perfil, tienePermiso } = useAuth()
  const [articulos, setArticulos] = useState([])
  const [normas, setNormas] = useState([])
  const [bomCompleto, setBomCompleto] = useState([]) // todas las lineas de BOM (para explosion multinivel)
  const [padreId, setPadreId] = useState('')
  const [loading, setLoading] = useState(true)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [editando, setEditando] = useState(null)
  const [form, setForm] = useState(formVacio)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  const puedeCrear = tienePermiso('ing_bom', 'crear')
  const puedeEditar = tienePermiso('ing_bom', 'editar')

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    const [{ data: a }, { data: n }, { data: b }] = await Promise.all([
      supabase.from('articulos').select('id, codigo_interno, descripcion, origen, unidad_medida, categorias(tipo)')
        .eq('empresa_id', perfil.empresa_id).eq('activo', true).order('codigo_interno'),
      supabase.from('normas_empaque').select('id, articulo_id, nombre, piezas_por_empaque, piezas_por_tarima').eq('activa', true),
      supabase.from('bom').select('*'),
    ])
    setArticulos(a || [])
    setNormas(n || [])
    setBomCompleto(b || [])
    setLoading(false)
  }

  const fabricados = articulos.filter(a => a.origen === 'fabricado')
  const padre = articulos.find(a => a.id === parseInt(padreId))
  const lineas = bomCompleto.filter(l => l.articulo_padre_id === parseInt(padreId))

  const articulosComponente = articulos.filter(a => a.id !== parseInt(padreId))
  const normasDelPadre = normas.filter(n => n.articulo_id === parseInt(padreId))

  const nombreArticulo = (id) => {
    const a = articulos.find(x => x.id === id)
    return a ? `${a.codigo_interno} — ${a.descripcion}` : `#${id}`
  }

  const infoArticulo = (id) => articulos.find(x => x.id === id)

  const abrirNuevo = () => { setEditando(null); setForm(formVacio); setMostrarForm(true); setError('') }
  const abrirEditar = (l) => {
    setEditando(l)
    setForm({
      componente_articulo_id: l.componente_articulo_id?.toString() || '',
      tipo_componente: l.tipo_componente,
      norma_empaque_id: l.norma_empaque_id?.toString() || '',
      cantidad_por_unidad: l.cantidad_por_unidad?.toString() || '',
      unidad_medida: l.unidad_medida || '',
    })
    setMostrarForm(true)
    setError('')
  }

  const seleccionarComponente = (id) => {
    const comp = infoArticulo(parseInt(id))
    const esEmpaque = comp?.categorias?.tipo === 'empaque'
    setForm({
      ...form,
      componente_articulo_id: id,
      tipo_componente: esEmpaque ? 'empaque' : 'articulo',
      unidad_medida: form.unidad_medida || comp?.unidad_medida || '',
    })
  }

  const guardar = async () => {
    if (!padreId) { setError('Selecciona el articulo padre'); return }
    if (!form.componente_articulo_id || !form.cantidad_por_unidad) { setError('Componente y cantidad son obligatorios'); return }
    if (parseInt(form.componente_articulo_id) === parseInt(padreId)) { setError('Un articulo no puede ser componente de si mismo'); return }
    // Evitar ciclos: el componente no debe tener al padre en su propia explosion
    if (creaCiclo(parseInt(form.componente_articulo_id), parseInt(padreId))) {
      setError('Ese componente ya contiene a este articulo en su BOM (crearia un ciclo)')
      return
    }
    if (!editando && lineas.some(l => l.componente_articulo_id === parseInt(form.componente_articulo_id))) {
      setError('Ese componente ya esta en el BOM de este articulo')
      return
    }
    setError('')
    setLoading(true)

    const payload = {
      articulo_padre_id: parseInt(padreId),
      componente_articulo_id: parseInt(form.componente_articulo_id),
      tipo_componente: form.tipo_componente,
      norma_empaque_id: form.tipo_componente === 'empaque' && form.norma_empaque_id ? parseInt(form.norma_empaque_id) : null,
      cantidad_por_unidad: parseFloat(form.cantidad_por_unidad),
      unidad_medida: form.unidad_medida || null,
    }

    let error
    if (editando) {
      const r = await supabase.from('bom').update(payload).eq('id', editando.id)
      error = r.error
    } else {
      const r = await supabase.from('bom').insert(payload)
      error = r.error
    }

    if (error) { setError(error.message); setLoading(false); return }

    setExito(editando ? 'Componente actualizado' : 'Componente agregado al BOM')
    setMostrarForm(false)
    await cargarDatos()
    setLoading(false)
    setTimeout(() => setExito(''), 3000)
  }

  const eliminarLinea = async (l) => {
    if (!confirm(`Quitar "${nombreArticulo(l.componente_articulo_id)}" del BOM?`)) return
    await supabase.from('bom').delete().eq('id', l.id)
    await cargarDatos()
  }

  // Revisa recursivamente si agregar componenteId al BOM de padreObjetivo crearia un ciclo
  const creaCiclo = (componenteId, padreObjetivo, visitados = new Set()) => {
    if (visitados.has(componenteId)) return false
    visitados.add(componenteId)
    const sub = bomCompleto.filter(l => l.articulo_padre_id === componenteId)
    for (const l of sub) {
      if (l.componente_articulo_id === padreObjetivo) return true
      if (creaCiclo(l.componente_articulo_id, padreObjetivo, visitados)) return true
    }
    return false
  }

  // Explosion multinivel para la vista de arbol
  const explotar = (articuloId, cantidadAcumulada = 1, nivel = 0, visitados = new Set()) => {
    if (nivel > 10 || visitados.has(articuloId)) return []
    const nuevosVisitados = new Set(visitados).add(articuloId)
    const sub = bomCompleto.filter(l => l.articulo_padre_id === articuloId)
    let resultado = []
    for (const l of sub) {
      const cantidadTotal = cantidadAcumulada * parseFloat(l.cantidad_por_unidad)
      resultado.push({ ...l, nivel, cantidadTotal })
      resultado = resultado.concat(explotar(l.componente_articulo_id, cantidadTotal, nivel + 1, nuevosVisitados))
    }
    return resultado
  }

  const arbol = padreId ? explotar(parseInt(padreId)) : []
  const tieneMultinivel = arbol.some(n => n.nivel > 0)

  const etiquetaTipo = (l) => {
    if (l.tipo_componente === 'empaque') return { texto: 'Empaque', color: '#854d0e', fondo: '#fef9c3' }
    const comp = infoArticulo(l.componente_articulo_id)
    if (comp?.origen === 'fabricado') return { texto: 'WIP / Subensamble', color: '#7c3aed', fondo: '#f5f3ff' }
    if (comp?.es_consigna) return { texto: 'Consigna', color: '#0891b2', fondo: '#ecfeff' }
    return { texto: 'Materia prima', color: '#16a34a', fondo: '#f0fdf4' }
  }

  return (
    <div style={styles.container}>
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>BOM — Lista de Materiales</h2>
        {puedeCrear && padreId && (
          <button style={styles.boton} onClick={() => mostrarForm ? setMostrarForm(false) : abrirNuevo()}>
            {mostrarForm ? 'Cancelar' : '+ Agregar componente'}
          </button>
        )}
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      <div style={styles.selectorBox}>
        <label style={styles.label}>Articulo fabricado (padre)</label>
        <select style={{ ...styles.input, maxWidth: '480px' }} value={padreId}
          onChange={e => { setPadreId(e.target.value); setMostrarForm(false); setError('') }}>
          <option value="">Selecciona un articulo fabricado</option>
          {fabricados.map(a => <option key={a.id} value={a.id}>{a.codigo_interno} — {a.descripcion}</option>)}
        </select>
        {padre && (
          <p style={styles.infoPadre}>
            Unidad: {padre.unidad_medida} · Las cantidades del BOM son por 1 {padre.unidad_medida} de este articulo.
          </p>
        )}
      </div>

      {mostrarForm && padreId && (
        <div style={styles.form}>
          <h3 style={styles.formTitulo}>{editando ? 'Editando componente' : `Nuevo componente para ${padre?.codigo_interno}`}</h3>
          <div style={styles.fila}>
            <div style={{ ...styles.campo, flex: 3 }}>
              <label style={styles.label}>Componente *</label>
              <select style={styles.input} value={form.componente_articulo_id}
                onChange={e => seleccionarComponente(e.target.value)}>
                <option value="">Selecciona (materia prima, empaque o WIP)</option>
                <optgroup label="Comprados (MP, empaque, consigna)">
                  {articulosComponente.filter(a => a.origen !== 'fabricado').map(a => (
                    <option key={a.id} value={a.id}>{a.codigo_interno} — {a.descripcion}</option>
                  ))}
                </optgroup>
                <optgroup label="Fabricados (WIP / subensambles)">
                  {articulosComponente.filter(a => a.origen === 'fabricado').map(a => (
                    <option key={a.id} value={a.id}>{a.codigo_interno} — {a.descripcion}</option>
                  ))}
                </optgroup>
              </select>
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Cantidad por unidad *</label>
              <input style={styles.input} type="number" min="0" step="0.000001" value={form.cantidad_por_unidad}
                onChange={e => setForm({ ...form, cantidad_por_unidad: e.target.value })} placeholder="Ej: 0.0325" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Unidad</label>
              <input style={styles.input} value={form.unidad_medida}
                onChange={e => setForm({ ...form, unidad_medida: e.target.value })} placeholder="KG, PZA..." />
            </div>
          </div>
          {form.tipo_componente === 'empaque' && (
            <div style={styles.fila}>
              <div style={{ ...styles.campo, flex: 2 }}>
                <label style={styles.label}>Norma de empaque asociada (opcional)</label>
                <select style={styles.input} value={form.norma_empaque_id}
                  onChange={e => setForm({ ...form, norma_empaque_id: e.target.value })}>
                  <option value="">Sin norma especifica</option>
                  {normasDelPadre.map(n => (
                    <option key={n.id} value={n.id}>{n.nombre || `Norma #${n.id}`} ({n.piezas_por_empaque} pzs/empaque)</option>
                  ))}
                </select>
                {normasDelPadre.length === 0 && (
                  <p style={styles.avisoNorma}>Este articulo no tiene normas de empaque activas. Puedes crearlas en la seccion Normas de Empaque.</p>
                )}
              </div>
            </div>
          )}
          <div style={styles.botones}>
            <button style={styles.boton} onClick={guardar} disabled={loading}>{loading ? 'Guardando...' : 'Guardar'}</button>
          </div>
        </div>
      )}

      {!padreId ? (
        <p style={{ color: '#666', fontSize: '14px' }}>Selecciona un articulo fabricado para ver o capturar su lista de materiales.</p>
      ) : loading ? (
        <p style={{ color: '#666' }}>Cargando...</p>
      ) : (
        <>
          <div style={styles.tabla}>
            <div style={styles.tablaHeader}>
              <span style={{ flex: 3 }}>Componente</span>
              <span style={{ flex: 1 }}>Tipo</span>
              <span style={{ flex: 1 }}>Cantidad/unidad</span>
              <span style={{ flex: 1 }}>Unidad</span>
              <span style={{ flex: 1 }}>Norma empaque</span>
              <span style={{ flex: 1 }}>Acciones</span>
            </div>
            {lineas.length === 0 ? (
              <p style={{ padding: 20, color: '#666' }}>Este articulo aun no tiene componentes en su BOM</p>
            ) : lineas.map(l => {
              const tipo = etiquetaTipo(l)
              const norma = normas.find(n => n.id === l.norma_empaque_id)
              return (
                <div key={l.id} style={styles.tablaFila}>
                  <span style={{ flex: 3, fontSize: '13px' }}>{nombreArticulo(l.componente_articulo_id)}</span>
                  <span style={{ flex: 1 }}>
                    <span style={{ ...styles.badge, backgroundColor: tipo.fondo, color: tipo.color }}>{tipo.texto}</span>
                  </span>
                  <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{l.cantidad_por_unidad}</span>
                  <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{l.unidad_medida || '-'}</span>
                  <span style={{ flex: 1, fontSize: '12px', color: '#666' }}>{norma ? (norma.nombre || `#${norma.id}`) : '-'}</span>
                  <span style={{ flex: 1 }}>
                    {puedeEditar && <button style={styles.botonAccion} onClick={() => abrirEditar(l)}>Editar</button>}
                    {puedeEditar && <button style={{ ...styles.botonAccion, marginLeft: '6px', color: '#dc2626' }} onClick={() => eliminarLinea(l)}>Quitar</button>}
                  </span>
                </div>
              )
            })}
          </div>

          {tieneMultinivel && (
            <div style={{ marginTop: '24px' }}>
              <h3 style={styles.subtitulo}>Explosion multinivel (por 1 {padre?.unidad_medida} de {padre?.codigo_interno})</h3>
              <div style={styles.tabla}>
                <div style={styles.tablaHeader}>
                  <span style={{ flex: 4 }}>Componente</span>
                  <span style={{ flex: 1 }}>Cantidad total</span>
                  <span style={{ flex: 1 }}>Unidad</span>
                </div>
                {arbol.map((n, i) => (
                  <div key={`${n.id}-${i}`} style={styles.tablaFila}>
                    <span style={{ flex: 4, fontSize: '13px', paddingLeft: `${n.nivel * 26}px` }}>
                      {n.nivel > 0 && <span style={{ color: '#94a3b8' }}>└ </span>}
                      {nombreArticulo(n.componente_articulo_id)}
                    </span>
                    <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{Number(n.cantidadTotal.toFixed(6))}</span>
                    <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{n.unidad_medida || '-'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

const styles = {
  container: { padding: '28px' },
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0' },
  subtitulo: { fontSize: '14px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 10px 0' },
  selectorBox: { backgroundColor: '#fff', borderRadius: '10px', padding: '18px 24px', marginBottom: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  infoPadre: { fontSize: '12px', color: '#94a3b8', margin: '8px 0 0 0' },
  avisoNorma: { fontSize: '11px', color: '#b45309', margin: '4px 0 0 0' },
  form: { backgroundColor: '#fff', borderRadius: '10px', padding: '24px', marginBottom: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  formTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 16px 0' },
  fila: { display: 'flex', gap: '16px', marginBottom: '16px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' },
  botones: { display: 'flex', justifyContent: 'flex-end' },
  boton: { padding: '9px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '12px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '600' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
