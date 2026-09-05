import { useState, useEffect } from 'react'
import { subirArchivo as subirAStorage } from '../../lib/archivos'
import { enlaceDe } from '../../lib/archivos'
import EnlaceArchivo from '../../components/EnlaceArchivo'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { exportarExcel, imprimirTablaPDF } from '../../lib/exportar'

const formVacio = {
  articulo_id: '', nombre: '', piezas_por_empaque: '', piezas_por_tarima: '',
  tipo: 'oficial', aprobada_cliente: false, activa: true,
}

export default function NormasEmpaque() {
  const { perfil, tienePermiso } = useAuth()
  const [normas, setNormas] = useState([])
  const [articulos, setArticulos] = useState([])
  const [loading, setLoading] = useState(true)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [editando, setEditando] = useState(null)
  const [form, setForm] = useState(formVacio)
  const [archivo, setArchivo] = useState(null)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [filtroArticulo, setFiltroArticulo] = useState('')

  const puedeCrear = tienePermiso('ing_normas_empaque', 'crear')
  const puedeEditar = tienePermiso('ing_normas_empaque', 'editar')

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    const [{ data: n }, { data: a }] = await Promise.all([
      supabase.from('normas_empaque').select('*, articulos(codigo_interno, descripcion)').order('id'),
      supabase.from('articulos').select('id, codigo_interno, descripcion')
        .eq('empresa_id', perfil.empresa_id).eq('origen', 'fabricado').eq('activo', true)
        .order('codigo_interno'),
    ])
    setNormas(n || [])
    setArticulos(a || [])
    setLoading(false)
  }

  const abrirNuevo = () => { setEditando(null); setForm(formVacio); setArchivo(null); setMostrarForm(true); setError('') }
  const abrirEditar = (n) => {
    setEditando(n)
    setForm({
      articulo_id: n.articulo_id?.toString() || '',
      nombre: n.nombre || '',
      piezas_por_empaque: n.piezas_por_empaque?.toString() || '',
      piezas_por_tarima: n.piezas_por_tarima?.toString() || '',
      tipo: n.tipo || 'oficial',
      aprobada_cliente: n.aprobada_cliente || false,
      activa: n.activa ?? true,
    })
    setArchivo(null)
    setMostrarForm(true)
    setError('')
  }

  const guardar = async () => {
    if (!form.articulo_id || !form.piezas_por_empaque) { setError('Articulo y piezas por empaque son obligatorios'); return }
    // Solo puede haber una norma OFICIAL activa por articulo
    if (form.tipo === 'oficial' && form.activa) {
      const otraOficial = normas.find(n =>
        n.articulo_id === parseInt(form.articulo_id) && n.tipo === 'oficial' && n.activa && n.id !== editando?.id
      )
      if (otraOficial) {
        setError(`Ese articulo ya tiene una norma oficial activa (${otraOficial.nombre || '#' + otraOficial.id}). Desactivala primero o registra esta como alterna.`)
        return
      }
    }
    setError('')
    setLoading(true)

    // Subir PDF firmado si se selecciono
    let camposDocumento = {}
    if (archivo) {
      const ruta = `normas_empaque/${form.articulo_id}/${Date.now()}_${archivo.name}`
      const { valor, error: errS } = await subirAStorage('calidad', ruta, archivo)
      if (errS) { setError('Error al subir el PDF: ' + errS); setLoading(false); return }
      camposDocumento = { documento_url: valor, documento_nombre: archivo.name }
    }

    const payload = {
      articulo_id: parseInt(form.articulo_id),
      nombre: form.nombre,
      piezas_por_empaque: parseFloat(form.piezas_por_empaque),
      piezas_por_tarima: form.piezas_por_tarima ? parseFloat(form.piezas_por_tarima) : null,
      tipo: form.tipo,
      aprobada_cliente: form.tipo === 'oficial' ? true : form.aprobada_cliente,
      activa: form.activa,
      ...camposDocumento,
    }

    let error
    if (editando) {
      const r = await supabase.from('normas_empaque').update(payload).eq('id', editando.id)
      error = r.error
    } else {
      const r = await supabase.from('normas_empaque').insert(payload)
      error = r.error
    }

    if (error) { setError(error.message); setLoading(false); return }

    setExito(editando ? 'Norma actualizada' : 'Norma creada')
    setMostrarForm(false)
    setArchivo(null)
    await cargarDatos()
    setLoading(false)
    setTimeout(() => setExito(''), 3000)
  }

  const toggleActiva = async (n) => {
    // Al reactivar una oficial, validar que no haya otra oficial activa
    if (!n.activa && n.tipo === 'oficial') {
      const otraOficial = normas.find(x => x.articulo_id === n.articulo_id && x.tipo === 'oficial' && x.activa && x.id !== n.id)
      if (otraOficial) { setError('Ese articulo ya tiene otra norma oficial activa'); return }
    }
    await supabase.from('normas_empaque').update({ activa: !n.activa }).eq('id', n.id)
    await cargarDatos()
  }

  const imprimir = async (n) => {
    if (!n.documento_url) return
    // Abre el PDF oficial firmado en una pestana nueva, desde ahi se imprime/postea en maquina
    // La ventana se abre antes de pedir el enlace firmado; al reves el
    // navegador la bloquea.
    const ventana = window.open('', '_blank')
    const { url, error: eUrl } = await enlaceDe(n.documento_url)
    if (eUrl || !url) {
      if (ventana) { ventana.document.write('<p style="font-family:sans-serif;padding:24px">No se pudo abrir el documento.</p>'); ventana.document.close() }
      return
    }
    if (ventana) ventana.location = url; else window.location.href = url
  }

  const etiquetaTipo = (n) => {
    if (n.tipo === 'oficial') return { texto: 'Oficial', fondo: '#eff6ff', color: '#2563eb' }
    if (n.aprobada_cliente) return { texto: 'Alterna aprobada', fondo: '#ecfeff', color: '#0891b2' }
    return { texto: 'Alterna interna', fondo: '#fef9c3', color: '#854d0e' }
  }

  const normasFiltradas = filtroArticulo
    ? normas.filter(n => n.articulo_id === parseInt(filtroArticulo))
    : normas

  return (
    <div style={styles.container}>
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Normas de Empaque</h2>
        {puedeCrear && (
          <button style={styles.boton} onClick={() => mostrarForm ? setMostrarForm(false) : abrirNuevo()}>
            {mostrarForm ? 'Cancelar' : '+ Nueva norma'}
          </button>
        )}
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {mostrarForm && (
        <div style={styles.form} className="aparecer">
          <h3 style={styles.formTitulo}>{editando ? 'Editando norma de empaque' : 'Nueva norma de empaque'}</h3>
          <div style={styles.fila}>
            <div style={{ ...styles.campo, flex: 2 }}>
              <label style={styles.label}>Articulo (fabricado) *</label>
              <select style={styles.input} value={form.articulo_id} onChange={e => setForm({ ...form, articulo_id: e.target.value })}>
                <option value="">Selecciona articulo</option>
                {articulos.map(a => <option key={a.id} value={a.id}>{a.codigo_interno} — {a.descripcion}</option>)}
              </select>
            </div>
            <div style={{ ...styles.campo, flex: 2 }}>
              <label style={styles.label}>Nombre de la norma</label>
              <input style={styles.input} value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Ej: Caja estandar cliente X" />
            </div>
          </div>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Tipo de norma *</label>
              <select style={styles.input} value={form.tipo}
                onChange={e => setForm({ ...form, tipo: e.target.value, aprobada_cliente: false })}>
                <option value="oficial">Oficial (aprobada por el cliente)</option>
                <option value="alterna">Alterna</option>
              </select>
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Piezas por empaque *</label>
              <input style={styles.input} type="number" min="1" value={form.piezas_por_empaque} onChange={e => setForm({ ...form, piezas_por_empaque: e.target.value })} />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Piezas por tarima</label>
              <input style={styles.input} type="number" min="1" value={form.piezas_por_tarima} onChange={e => setForm({ ...form, piezas_por_tarima: e.target.value })} />
            </div>
          </div>
          {form.tipo === 'alterna' && (
            <div style={styles.avisoAlterna}>
              <div style={styles.filaCheckbox}>
                <input type="checkbox" id="aprobadaCliente" checked={form.aprobada_cliente}
                  onChange={e => setForm({ ...form, aprobada_cliente: e.target.checked })} />
                <label htmlFor="aprobadaCliente" style={styles.labelCheckbox}>
                  El cliente aprueba este empaque alterno para entrega directa
                </label>
              </div>
              <p style={styles.notaAlterna}>
                {form.aprobada_cliente
                  ? 'Se podra embarcar al cliente en este empaque sin traspaleo.'
                  : 'Uso interno unicamente: al salir de inyeccion se debera traspalear al empaque oficial antes de embarcar.'}
              </p>
            </div>
          )}
          <div style={styles.fila}>
            <div style={{ ...styles.campo, flex: 2 }}>
              <label style={styles.label}>Formato oficial firmado (PDF) — el que se postea en maquina</label>
              {editando?.documento_url && !archivo && (
                <p style={{ fontSize: '13px', color: '#16a34a', margin: '0 0 4px 0' }}>
                  ✓ <EnlaceArchivo valor={editando.documento_url} style={{ color: '#2563eb' }}>{editando.documento_nombre || 'Ver documento actual'}</EnlaceArchivo>
                  <span style={{ color: '#94a3b8' }}> (sube otro para reemplazarlo)</span>
                </p>
              )}
              <input style={{ fontSize: '13px' }} type="file" accept=".pdf"
                onChange={e => setArchivo(e.target.files[0])} />
            </div>
            <div style={{ ...styles.campo, justifyContent: 'flex-end' }}>
              <div style={styles.filaCheckbox}>
                <input type="checkbox" id="normaActiva" checked={form.activa}
                  onChange={e => setForm({ ...form, activa: e.target.checked })} />
                <label htmlFor="normaActiva" style={styles.labelCheckbox}>Norma activa</label>
              </div>
            </div>
          </div>
          <div style={styles.botones}>
            <button style={styles.boton} onClick={guardar} disabled={loading}>{loading ? 'Guardando...' : 'Guardar'}</button>
          </div>
        </div>
      )}

      <div style={{ marginBottom: '14px' }}>
        <select style={{ ...styles.input, maxWidth: '380px' }} value={filtroArticulo} onChange={e => setFiltroArticulo(e.target.value)}>
          <option value="">Todos los articulos</option>
          {articulos.map(a => <option key={a.id} value={a.id}>{a.codigo_interno} — {a.descripcion}</option>)}
        </select>
      </div>

      {(() => { const cols = [{ label: 'Articulo', get: n => (articulos.find(a => a.id === n.articulo_id)?.codigo_interno || n.articulo_id) }, { label: 'Norma', get: n => n.nombre }, { label: 'Pzas/empaque', get: n => n.piezas_por_empaque }, { label: 'Pzas/tarima', get: n => n.piezas_por_tarima }, { label: 'Tipo', get: n => n.tipo }, { label: 'Aprob. cliente', get: n => n.aprobada_cliente ? 'Si' : 'No' }, { label: 'Activa', get: n => n.activa ? 'Si' : 'No' }]; return (
      <div className="no-imprimir" style={{ display: 'flex', gap: '8px', marginBottom: '12px', justifyContent: 'flex-end' }}>
        <button style={{ padding: '9px 14px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' }} onClick={() => exportarExcel('normas_empaque', cols, normasFiltradas)}>Excel</button>
        <button style={{ padding: '9px 14px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' }} onClick={() => imprimirTablaPDF('Normas de Empaque', cols, normasFiltradas)}>PDF</button>
      </div>) })()}
      <div style={styles.tabla}>
        <div style={styles.tablaHeader}>
          <span style={{ flex: 2 }}>Articulo</span>
          <span style={{ flex: 2 }}>Norma</span>
          <span style={{ flex: 1 }}>Tipo</span>
          <span style={{ flex: 1 }}>Pzs/empaque</span>
          <span style={{ flex: 1 }}>Pzs/tarima</span>
          <span style={{ flex: 1 }}>Formato</span>
          <span style={{ flex: 1 }}>Estatus</span>
          <span style={{ flex: 2 }}>Acciones</span>
        </div>
        {loading ? <p style={{ padding: 20, color: '#666' }}>Cargando...</p> : normasFiltradas.length === 0 ? (
          <p style={{ padding: 20, color: '#666' }}>No hay normas de empaque registradas</p>
        ) : normasFiltradas.map(n => {
          const tipo = etiquetaTipo(n)
          return (
            <div key={n.id} className="fila-hover" style={{ ...styles.tablaFila, opacity: n.activa ? 1 : 0.5 }}>
              <span style={{ flex: 2, fontSize: '13px' }}>
                <span style={{ fontWeight: '600', color: '#2563eb' }}>{n.articulos?.codigo_interno}</span>
                <span style={{ color: '#666' }}> — {n.articulos?.descripcion}</span>
              </span>
              <span style={{ flex: 2, fontSize: '14px' }}>{n.nombre || '-'}</span>
              <span style={{ flex: 1 }}>
                <span style={{ ...styles.badge, backgroundColor: tipo.fondo, color: tipo.color }}>{tipo.texto}</span>
              </span>
              <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{n.piezas_por_empaque}</span>
              <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{n.piezas_por_tarima || '-'}</span>
              <span style={{ flex: 1, fontSize: '12px' }}>
                {n.documento_url
                  ? <span style={{ color: '#16a34a' }}>✓ PDF</span>
                  : <span style={{ color: '#dc2626' }}>Sin PDF</span>}
              </span>
              <span style={{ flex: 1 }}>
                <span style={{ ...styles.badge, ...(n.activa ? { backgroundColor: '#f0fdf4', color: '#16a34a' } : { backgroundColor: '#fef2f2', color: '#dc2626' }) }}>
                  {n.activa ? 'Activa' : 'Inactiva'}
                </span>
              </span>
              <span style={{ flex: 2 }}>
                {n.documento_url && (
                  <button style={styles.botonAccion} onClick={() => imprimir(n)}>Imprimir</button>
                )}
                {puedeEditar && <button style={{ ...styles.botonAccion, marginLeft: '6px' }} onClick={() => abrirEditar(n)}>Editar</button>}
                {puedeEditar && <button style={{ ...styles.botonAccion, marginLeft: '6px' }} onClick={() => toggleActiva(n)}>{n.activa ? 'Desactivar' : 'Activar'}</button>}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const styles = {
  container: { padding: '28px' },
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0' },
  form: { backgroundColor: '#fff', borderRadius: '10px', padding: '24px', marginBottom: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  formTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 16px 0' },
  fila: { display: 'flex', gap: '16px', marginBottom: '16px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' },
  botones: { display: 'flex', justifyContent: 'flex-end' },
  filaCheckbox: { display: 'flex', alignItems: 'center', gap: '8px' },
  labelCheckbox: { fontSize: '13px', color: '#444' },
  avisoAlterna: { backgroundColor: '#f8fafc', borderRadius: '8px', padding: '14px', marginBottom: '16px' },
  notaAlterna: { fontSize: '12px', color: '#94a3b8', margin: '8px 0 0 0' },
  boton: { padding: '9px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '14px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '600' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
