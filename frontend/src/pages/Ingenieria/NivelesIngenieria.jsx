import { useState, useEffect } from 'react'
import { subirArchivo as subirAStorage } from '../../lib/archivos'
import EnlaceArchivo from '../../components/EnlaceArchivo'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const formVacio = { nivel: '', descripcion_cambio: '', fecha_efectiva: '', vigente_hasta: '' }

export default function NivelesIngenieria() {
  const { perfil, tienePermiso } = useAuth()
  const [articulos, setArticulos] = useState([])
  const [niveles, setNiveles] = useState([])
  const [articuloId, setArticuloId] = useState('')
  const [loading, setLoading] = useState(true)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [editando, setEditando] = useState(null)
  const [form, setForm] = useState(formVacio)
  const [archivo, setArchivo] = useState(null)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  const puedeCrear = tienePermiso('ing_niveles', 'crear')
  const puedeEditar = tienePermiso('ing_niveles', 'editar')

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    const [{ data: a }, { data: n }] = await Promise.all([
      supabase.from('articulos').select('id, codigo_interno, descripcion')
        .eq('empresa_id', perfil.empresa_id).eq('origen', 'fabricado').eq('activo', true)
        .order('codigo_interno'),
      supabase.from('niveles_ingenieria').select('*, usuarios(nombre)').order('created_at', { ascending: false }),
    ])
    setArticulos(a || [])
    setNiveles(n || [])
    setLoading(false)
  }

  const hoy = new Date().toISOString().split('T')[0]
  const estaVencido = (n) => n.vigente_hasta && n.vigente_hasta < hoy

  const articulo = articulos.find(a => a.id === parseInt(articuloId))
  const nivelesDelArticulo = niveles.filter(n => n.articulo_id === parseInt(articuloId))
  const nivelVigente = nivelesDelArticulo.find(n => n.estatus === 'vigente')

  const abrirNuevo = () => { setEditando(null); setForm(formVacio); setArchivo(null); setMostrarForm(true); setError('') }
  const abrirEditar = (n) => {
    setEditando(n)
    setForm({
      nivel: n.nivel || '',
      descripcion_cambio: n.descripcion_cambio || '',
      fecha_efectiva: n.fecha_efectiva || '',
      vigente_hasta: n.vigente_hasta || '',
    })
    setArchivo(null)
    setMostrarForm(true)
    setError('')
  }

  const guardar = async () => {
    if (!articuloId) { setError('Selecciona el articulo'); return }
    if (!form.nivel) { setError('El nivel es obligatorio (ej. A, B, REV-01)'); return }
    if (nivelesDelArticulo.some(n => n.nivel.toUpperCase() === form.nivel.toUpperCase() && n.id !== editando?.id)) {
      setError('Ese nivel ya existe para este articulo')
      return
    }
    setError('')
    setLoading(true)

    // Subir documento del cambio si se selecciono
    let camposDocumento = {}
    if (archivo) {
      const ruta = `niveles/${articuloId}/${Date.now()}_${archivo.name}`
      const { valor, error: errS } = await subirAStorage('calidad', ruta, archivo)
      if (errS) { setError('Error al subir el documento: ' + errS); setLoading(false); return }
      camposDocumento = { documento_url: valor, documento_nombre: archivo.name }
    }

    let error
    if (editando) {
      const r = await supabase.from('niveles_ingenieria').update({
        nivel: form.nivel.toUpperCase(),
        descripcion_cambio: form.descripcion_cambio,
        fecha_efectiva: form.fecha_efectiva || null,
        vigente_hasta: form.vigente_hasta || null,
        ...camposDocumento,
      }).eq('id', editando.id)
      error = r.error
    } else {
      // El nivel anterior vigente pasa a obsoleto
      if (nivelVigente) {
        await supabase.from('niveles_ingenieria').update({ estatus: 'obsoleto' }).eq('id', nivelVigente.id)
      }
      const r = await supabase.from('niveles_ingenieria').insert({
        articulo_id: parseInt(articuloId),
        nivel: form.nivel.toUpperCase(),
        descripcion_cambio: form.descripcion_cambio,
        fecha_efectiva: form.fecha_efectiva || null,
        vigente_hasta: form.vigente_hasta || null,
        estatus: 'vigente',
        creado_por: perfil.id,
        ...camposDocumento,
      })
      error = r.error
    }

    if (error) { setError(error.message); setLoading(false); return }

    setExito(editando ? 'Nivel actualizado' : 'Nuevo nivel de ingenieria registrado como vigente')
    setMostrarForm(false)
    setEditando(null)
    setArchivo(null)
    await cargarDatos()
    setLoading(false)
    setTimeout(() => setExito(''), 3000)
  }

  const restaurarVigente = async (n) => {
    if (!confirm(`Restaurar el nivel "${n.nivel}" como vigente? El nivel vigente actual pasara a obsoleto.`)) return
    if (nivelVigente) {
      await supabase.from('niveles_ingenieria').update({ estatus: 'obsoleto' }).eq('id', nivelVigente.id)
    }
    await supabase.from('niveles_ingenieria').update({ estatus: 'vigente' }).eq('id', n.id)
    await cargarDatos()
  }

  // Resumen para la lista completa: nivel vigente por articulo
  const vigentePorArticulo = (id) => niveles.find(n => n.articulo_id === id && n.estatus === 'vigente')

  return (
    <div style={styles.container}>
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Niveles de Ingenieria</h2>
        {puedeCrear && articuloId && (
          <button style={styles.boton} onClick={() => mostrarForm ? setMostrarForm(false) : abrirNuevo()}>
            {mostrarForm ? 'Cancelar' : '+ Nuevo nivel'}
          </button>
        )}
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      <div style={styles.selectorBox} className="aparecer">
        <label style={styles.label}>Articulo fabricado</label>
        <select style={{ ...styles.input, maxWidth: '480px' }} value={articuloId}
          onChange={e => { setArticuloId(e.target.value); setMostrarForm(false); setError('') }}>
          <option value="">Selecciona un articulo (o deja vacio para ver el resumen general)</option>
          {articulos.map(a => <option key={a.id} value={a.id}>{a.codigo_interno} — {a.descripcion}</option>)}
        </select>
        {articulo && (
          <p style={styles.infoNivel}>
            Nivel vigente: {nivelVigente
              ? <>
                  <strong style={{ color: estaVencido(nivelVigente) ? '#dc2626' : '#16a34a' }}>{nivelVigente.nivel}</strong>
                  {estaVencido(nivelVigente) && <span style={{ color: '#dc2626' }}> (vencido el {new Date(nivelVigente.vigente_hasta + 'T00:00:00').toLocaleDateString('es-MX')})</span>}
                </>
              : <span style={{ color: '#b45309' }}>sin nivel registrado</span>}
          </p>
        )}
      </div>

      {mostrarForm && articuloId && (
        <div style={styles.form} className="aparecer">
          <h3 style={styles.formTitulo}>{editando ? `Editando nivel ${editando.nivel}` : `Nuevo nivel para ${articulo?.codigo_interno}`}</h3>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Nivel *</label>
              <input style={styles.input} value={form.nivel}
                onChange={e => setForm({ ...form, nivel: e.target.value.toUpperCase() })}
                placeholder={nivelVigente && !editando ? `Actual: ${nivelVigente.nivel}` : 'Ej: A'} maxLength={12} />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Fecha efectiva (desde)</label>
              <input style={styles.input} type="date" value={form.fecha_efectiva}
                onChange={e => setForm({ ...form, fecha_efectiva: e.target.value })} />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Vigente hasta (opcional)</label>
              <input style={styles.input} type="date" value={form.vigente_hasta}
                onChange={e => setForm({ ...form, vigente_hasta: e.target.value })} />
            </div>
          </div>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Descripcion del cambio</label>
              <textarea style={{ ...styles.input, minHeight: '70px', resize: 'vertical' }} value={form.descripcion_cambio}
                onChange={e => setForm({ ...form, descripcion_cambio: e.target.value })}
                placeholder="Que cambio en esta revision (dimension, material, tolerancia, etc.)" />
            </div>
          </div>
          <div style={styles.fila}>
            <div style={{ ...styles.campo, flex: 2 }}>
              <label style={styles.label}>Documento del cambio (PDF, dibujo, ECN...)</label>
              {editando?.documento_url && !archivo && (
                <p style={{ fontSize: '13px', color: '#16a34a', margin: '0 0 4px 0' }}>
                  ✓ <EnlaceArchivo valor={editando.documento_url} style={{ color: '#2563eb' }}>{editando.documento_nombre || 'Ver documento actual'}</EnlaceArchivo>
                  <span style={{ color: '#94a3b8' }}> (sube otro para reemplazarlo)</span>
                </p>
              )}
              <input style={{ fontSize: '13px' }} type="file" accept=".pdf,.jpg,.jpeg,.png"
                onChange={e => setArchivo(e.target.files[0])} />
            </div>
          </div>
          {!editando && <p style={styles.aviso}>Al guardar, este nivel queda como vigente y el anterior pasa automaticamente a obsoleto.</p>}
          <div style={styles.botones}>
            <button style={styles.boton} onClick={guardar} disabled={loading}>{loading ? 'Guardando...' : editando ? 'Actualizar nivel' : 'Guardar nivel'}</button>
          </div>
        </div>
      )}

      {!articuloId ? (
        <div style={styles.tabla}>
          <div style={styles.tablaHeader}>
            <span style={{ flex: 3 }}>Articulo</span>
            <span style={{ flex: 1 }}>Nivel vigente</span>
            <span style={{ flex: 1 }}>Vigente hasta</span>
            <span style={{ flex: 1 }}>Revisiones</span>
          </div>
          {loading ? <p style={{ padding: 20, color: '#666' }}>Cargando...</p> : articulos.map(a => {
            const v = vigentePorArticulo(a.id)
            const total = niveles.filter(n => n.articulo_id === a.id).length
            return (
              <div key={a.id} style={styles.tablaFila} className="fila-hover">
                <span style={{ flex: 3, fontSize: '13px' }}>
                  <span style={{ fontWeight: '600', color: '#2563eb' }}>{a.codigo_interno}</span>
                  <span style={{ color: '#666' }}> — {a.descripcion}</span>
                </span>
                <span style={{ flex: 1 }}>
                  {v ? (
                    <span style={{ ...styles.badge, ...(estaVencido(v) ? { backgroundColor: '#fef2f2', color: '#dc2626' } : { backgroundColor: '#f0fdf4', color: '#16a34a' }) }}>
                      {v.nivel}{estaVencido(v) ? ' (vencido)' : ''}
                    </span>
                  ) : <span style={{ ...styles.badge, backgroundColor: '#fef9c3', color: '#854d0e' }}>Sin nivel</span>}
                </span>
                <span style={{ flex: 1, fontSize: '13px', color: estaVencido(v || {}) ? '#dc2626' : '#666' }}>
                  {v?.vigente_hasta ? new Date(v.vigente_hasta + 'T00:00:00').toLocaleDateString('es-MX') : v ? 'Indefinida' : '-'}
                </span>
                <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{total}</span>
              </div>
            )
          })}
        </div>
      ) : (
        <div style={styles.tabla}>
          <div style={styles.tablaHeader}>
            <span style={{ flex: 1 }}>Nivel</span>
            <span style={{ flex: 3 }}>Descripcion del cambio</span>
            <span style={{ flex: 1 }}>Efectiva desde</span>
            <span style={{ flex: 1 }}>Vigente hasta</span>
            <span style={{ flex: 1 }}>Documento</span>
            <span style={{ flex: 1 }}>Registrado por</span>
            <span style={{ flex: 1 }}>Estatus</span>
            <span style={{ flex: 1 }}>Acciones</span>
          </div>
          {loading ? <p style={{ padding: 20, color: '#666' }}>Cargando...</p> : nivelesDelArticulo.length === 0 ? (
            <p style={{ padding: 20, color: '#666' }}>Este articulo no tiene niveles de ingenieria registrados</p>
          ) : nivelesDelArticulo.map(n => (
            <div key={n.id} style={styles.tablaFila} className="fila-hover">
              <span style={{ flex: 1, fontWeight: '700', color: '#2563eb', fontSize: '14px' }}>{n.nivel}</span>
              <span style={{ flex: 3, fontSize: '13px', color: '#444' }}>{n.descripcion_cambio || '-'}</span>
              <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>
                {n.fecha_efectiva ? new Date(n.fecha_efectiva + 'T00:00:00').toLocaleDateString('es-MX') : '-'}
              </span>
              <span style={{ flex: 1, fontSize: '13px', color: estaVencido(n) ? '#dc2626' : '#666' }}>
                {n.vigente_hasta ? new Date(n.vigente_hasta + 'T00:00:00').toLocaleDateString('es-MX') : 'Indefinida'}
                {estaVencido(n) && ' ⚠'}
              </span>
              <span style={{ flex: 1, fontSize: '12px' }}>
                {n.documento_url
                  ? <EnlaceArchivo valor={n.documento_url} style={{ color: '#2563eb' }}>Ver</EnlaceArchivo>
                  : <span style={{ color: '#94a3b8' }}>-</span>}
              </span>
              <span style={{ flex: 1, fontSize: '12px', color: '#666' }}>{n.usuarios?.nombre || '-'}</span>
              <span style={{ flex: 1 }}>
                <span style={{ ...styles.badge, ...(n.estatus === 'vigente' ? (estaVencido(n) ? { backgroundColor: '#fef2f2', color: '#dc2626' } : { backgroundColor: '#f0fdf4', color: '#16a34a' }) : { backgroundColor: '#f1f5f9', color: '#64748b' }) }}>
                  {n.estatus === 'vigente' ? (estaVencido(n) ? 'Vigente (vencido)' : 'Vigente') : 'Obsoleto'}
                </span>
              </span>
              <span style={{ flex: 1 }}>
                {puedeEditar && <button style={styles.botonAccion} onClick={() => abrirEditar(n)}>Editar</button>}
                {puedeEditar && n.estatus === 'obsoleto' && (
                  <button style={{ ...styles.botonAccion, marginLeft: '6px' }} onClick={() => restaurarVigente(n)}>Restaurar</button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const styles = {
  container: { padding: '28px' },
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0' },
  selectorBox: { backgroundColor: '#fff', borderRadius: '10px', padding: '18px 24px', marginBottom: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  infoNivel: { fontSize: '13px', color: '#444', margin: '10px 0 0 0' },
  form: { backgroundColor: '#fff', borderRadius: '10px', padding: '24px', marginBottom: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  formTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 16px 0' },
  fila: { display: 'flex', gap: '16px', marginBottom: '16px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', fontFamily: 'inherit' },
  aviso: { fontSize: '12px', color: '#b45309', margin: '0 0 14px 0' },
  botones: { display: 'flex', justifyContent: 'flex-end' },
  boton: { padding: '9px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '12px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '600' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
