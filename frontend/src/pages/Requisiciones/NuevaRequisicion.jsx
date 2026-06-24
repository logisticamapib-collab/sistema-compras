import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

export default function NuevaRequisicion({ onVolver, onGuardado }) {
  const { perfil } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [articulos, setArticulos] = useState([])
  const [centrosCostos, setCentrosCostos] = useState([])
  const [cuentasGastos, setCuentasGastos] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [lineas, setLineas] = useState([lineaVacia()])
  const [form, setForm] = useState({
    fecha_requerida: '',
    criticidad: 'baja',
    justificacion: '',
    notas: ''
  })

  useEffect(() => { cargarCatalogos() }, [])

  const cargarCatalogos = async () => {
    const [{ data: a }, { data: cc }, { data: cg }, { data: p }] = await Promise.all([
      supabase.from('articulos').select('*, articulo_proveedor(proveedor_id, proveedores(nombre))').eq('empresa_id', perfil.empresa_id).eq('activo', true),
      supabase.from('centros_costos').select('*').eq('site_id', perfil.site_id).eq('activo', true),
      supabase.from('cuentas_gastos').select('*').eq('site_id', perfil.site_id).eq('activo', true),
      supabase.from('proveedores').select('*').eq('empresa_id', perfil.empresa_id).eq('activo', true)
    ])
    setArticulos(a || [])
    setCentrosCostos(cc || [])
    setCuentasGastos(cg || [])
    setProveedores(p || [])
  }

  function lineaVacia() {
    return {
      articulo_id: '',
      descripcion_libre: '',
      cantidad: '',
      unidad_medida: 'PZA',
      centro_costo_id: '',
      cuenta_gasto_id: '',
      proveedor_sugerido_id: '',
      notas: ''
    }
  }

  const agregarLinea = () => setLineas([...lineas, lineaVacia()])

  const eliminarLinea = (i) => {
    if (lineas.length === 1) return
    setLineas(lineas.filter((_, idx) => idx !== i))
  }

  const actualizarLinea = (i, campo, valor) => {
    const nuevas = [...lineas]
    nuevas[i] = { ...nuevas[i], [campo]: valor }
    if (campo === 'articulo_id' && valor) {
      const art = articulos.find(a => a.id === parseInt(valor))
      if (art) nuevas[i].unidad_medida = art.unidad_medida
    }
    setLineas(nuevas)
  }

  const generarFolio = async () => {
    const anio = new Date().getFullYear()
    const codigo = perfil.sites?.codigo || 'GEN'
    const empresa = perfil.empresas?.nombre?.substring(0, 5).toUpperCase() || 'EMP'
    const { count } = await supabase
      .from('requisiciones')
      .select('*', { count: 'exact', head: true })
      .eq('site_id', perfil.site_id)
    const consecutivo = String((count || 0) + 1).padStart(4, '0')
    return `REQ-${empresa}-${codigo}-${anio}-${consecutivo}`
  }

  const guardar = async (enviar = false) => {
    if (!form.fecha_requerida) {
      setError('La fecha requerida es obligatoria')
      return
    }
    if (form.criticidad === 'alta' && !form.justificacion) {
      setError('La justificacion es obligatoria para criticidad Alta')
      return
    }
    const lineasValidas = lineas.filter(l => (l.articulo_id || l.descripcion_libre) && l.cantidad)
    if (lineasValidas.length === 0) {
      setError('Debes agregar al menos una linea con articulo y cantidad')
      return
    }

    setError('')
    setLoading(true)

    const folio = await generarFolio()
    const estatus = enviar ? 'enviada' : 'borrador'

    const { data: req, error: errorReq } = await supabase
      .from('requisiciones')
      .insert({
        folio,
        empresa_id: perfil.empresa_id,
        site_id: perfil.site_id,
        solicitante_id: perfil.id,
        fecha_requerida: form.fecha_requerida,
        criticidad: form.criticidad,
        justificacion: form.justificacion,
        notas: form.notas,
        estatus
      })
      .select()
      .single()

    if (errorReq) {
      setError('Error al guardar: ' + errorReq.message)
      setLoading(false)
      return
    }

    const lineasInsert = lineasValidas.map(l => ({
      requisicion_id: req.id,
      articulo_id: l.articulo_id ? parseInt(l.articulo_id) : null,
      descripcion_libre: l.descripcion_libre || null,
      cantidad: parseFloat(l.cantidad),
      unidad_medida: l.unidad_medida,
      centro_costo_id: l.centro_costo_id ? parseInt(l.centro_costo_id) : null,
      cuenta_gasto_id: l.cuenta_gasto_id ? parseInt(l.cuenta_gasto_id) : null,
      proveedor_sugerido_id: l.proveedor_sugerido_id ? parseInt(l.proveedor_sugerido_id) : null,
      notas: l.notas || null
    }))

    await supabase.from('requisicion_lineas').insert(lineasInsert)
    setLoading(false)
    onGuardado()
  }

  return (
    <div style={styles.container}>
      <div style={styles.encabezado}>
        <div>
          <button style={styles.botonVolver} onClick={onVolver}>
            &larr; Volver a requisiciones
          </button>
          <h2 style={styles.titulo}>Nueva requisicion</h2>
        </div>
      </div>

      {error && <p style={styles.error}>{error}</p>}

      <div style={styles.seccion}>
        <h3 style={styles.seccionTitulo}>Datos generales</h3>
        <div style={styles.fila}>
          <div style={styles.campo}>
            <label style={styles.label}>Fecha requerida *</label>
            <input style={styles.input} type="date" value={form.fecha_requerida}
              onChange={e => setForm({ ...form, fecha_requerida: e.target.value })}
              min={new Date().toISOString().split('T')[0]} />
          </div>
          <div style={styles.campo}>
            <label style={styles.label}>Nivel de criticidad *</label>
            <select style={styles.input} value={form.criticidad}
              onChange={e => setForm({ ...form, criticidad: e.target.value })}>
              <option value="baja">Baja</option>
              <option value="media">Media</option>
              <option value="alta">Alta - Requiere aprobacion adicional</option>
            </select>
          </div>
        </div>
        {form.criticidad === 'alta' && (
          <div style={styles.alertaAlta}>
            Las requisiciones de criticidad Alta requieren aprobacion del Gerente de Planta o Administrativo.
          </div>
        )}
        <div style={styles.campo}>
          <label style={styles.label}>
            Justificacion {form.criticidad === 'alta' ? '*' : '(opcional)'}
          </label>
          <textarea style={styles.textarea} value={form.justificacion}
            onChange={e => setForm({ ...form, justificacion: e.target.value })}
            placeholder="Describe el motivo de la requisicion..."
            rows={3} />
        </div>
        <div style={styles.campo}>
          <label style={styles.label}>Notas adicionales</label>
          <textarea style={styles.textarea} value={form.notas}
            onChange={e => setForm({ ...form, notas: e.target.value })}
            placeholder="Notas o instrucciones adicionales..."
            rows={2} />
        </div>
      </div>

      <div style={styles.seccion}>
        <div style={styles.seccionEncabezado}>
          <h3 style={styles.seccionTitulo}>Lineas de requisicion</h3>
          <button style={styles.botonAgregar} onClick={agregarLinea}>
            + Agregar linea
          </button>
        </div>

        {lineas.map((linea, i) => (
          <div key={i} style={styles.linea}>
            <div style={styles.lineaNumero}>{i + 1}</div>
            <div style={styles.lineaContenido}>
              <div style={styles.fila}>
                <div style={{ ...styles.campo, flex: 2 }}>
                  <label style={styles.label}>Articulo del catalogo</label>
                  <select style={styles.input} value={linea.articulo_id}
                    onChange={e => actualizarLinea(i, 'articulo_id', e.target.value)}>
                    <option value="">Selecciona articulo o escribe descripcion libre</option>
                    {articulos.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.codigo_interno} - {a.descripcion}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ ...styles.campo, flex: 2 }}>
                  <label style={styles.label}>O descripcion libre</label>
                  <input style={styles.input} value={linea.descripcion_libre}
                    onChange={e => actualizarLinea(i, 'descripcion_libre', e.target.value)}
                    placeholder="Descripcion del articulo si no esta en catalogo"
                    disabled={!!linea.articulo_id} />
                </div>
              </div>
              <div style={styles.fila}>
                <div style={styles.campo}>
                  <label style={styles.label}>Cantidad *</label>
                  <input style={styles.input} type="number" value={linea.cantidad}
                    onChange={e => actualizarLinea(i, 'cantidad', e.target.value)}
                    placeholder="0" min="0" step="0.01" />
                </div>
                <div style={styles.campo}>
                  <label style={styles.label}>Unidad</label>
                  <input style={styles.input} value={linea.unidad_medida}
                    onChange={e => actualizarLinea(i, 'unidad_medida', e.target.value)} />
                </div>
                <div style={styles.campo}>
                  <label style={styles.label}>Centro de costos</label>
                  <select style={styles.input} value={linea.centro_costo_id}
                    onChange={e => actualizarLinea(i, 'centro_costo_id', e.target.value)}>
                    <option value="">Selecciona</option>
                    {centrosCostos.map(c => (
                      <option key={c.id} value={c.id}>{c.codigo} - {c.nombre}</option>
                    ))}
                  </select>
                </div>
                <div style={styles.campo}>
                  <label style={styles.label}>Cuenta de gastos</label>
                  <select style={styles.input} value={linea.cuenta_gasto_id}
                    onChange={e => actualizarLinea(i, 'cuenta_gasto_id', e.target.value)}>
                    <option value="">Selecciona</option>
                    {cuentasGastos.map(c => (
                      <option key={c.id} value={c.id}>{c.codigo} - {c.nombre}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={styles.fila}>
                <div style={{ ...styles.campo, flex: 2 }}>
                  <label style={styles.label}>Proveedor sugerido</label>
                  <select style={styles.input} value={linea.proveedor_sugerido_id}
                    onChange={e => actualizarLinea(i, 'proveedor_sugerido_id', e.target.value)}>
                    <option value="">Sin preferencia</option>
                    {proveedores.map(p => (
                      <option key={p.id} value={p.id}>{p.nombre}</option>
                    ))}
                  </select>
                </div>
                <div style={{ ...styles.campo, flex: 3 }}>
                  <label style={styles.label}>Notas de la linea</label>
                  <input style={styles.input} value={linea.notas}
                    onChange={e => actualizarLinea(i, 'notas', e.target.value)}
                    placeholder="Especificaciones adicionales..." />
                </div>
                <div style={styles.campoEliminar}>
                  <button style={styles.botonEliminar} onClick={() => eliminarLinea(i)}>
                    Eliminar
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={styles.botones}>
        <button style={styles.botonSecundario} onClick={onVolver}>Cancelar</button>
        <button style={styles.botonBorrador} onClick={() => guardar(false)} disabled={loading}>
          {loading ? 'Guardando...' : 'Guardar borrador'}
        </button>
        <button style={styles.boton} onClick={() => guardar(true)} disabled={loading}>
          {loading ? 'Enviando...' : 'Enviar requisicion'}
        </button>
      </div>
    </div>
  )
}

const styles = {
  container: { padding: '28px' },
  encabezado: { marginBottom: '20px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '4px 0 0 0' },
  botonVolver: { padding: '6px 14px', backgroundColor: 'transparent', color: '#2563eb', border: '1px solid #2563eb', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', marginBottom: '8px' },
  seccion: { backgroundColor: '#fff', borderRadius: '10px', padding: '24px', marginBottom: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  seccionEncabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  seccionTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 16px 0' },
  fila: { display: 'flex', gap: '16px', marginBottom: '16px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 },
  campoEliminar: { display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: '4px' },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' },
  textarea: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', resize: 'vertical', fontFamily: 'inherit' },
  alertaAlta: { backgroundColor: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '7px', padding: '10px 14px', fontSize: '13px', color: '#dc2626', marginBottom: '16px' },
  linea: { display: 'flex', gap: '12px', backgroundColor: '#f8fafc', borderRadius: '8px', padding: '16px', marginBottom: '12px', border: '1px solid #e2e8f0' },
  lineaNumero: { width: '24px', height: '24px', borderRadius: '50%', backgroundColor: '#2563eb', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '600', flexShrink: 0, marginTop: '4px' },
  lineaContenido: { flex: 1 },
  botonAgregar: { padding: '7px 16px', backgroundColor: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', fontWeight: '500' },
  botonEliminar: { padding: '9px 14px', backgroundColor: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  botones: { display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' },
  boton: { padding: '10px 24px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonBorrador: { padding: '10px 24px', backgroundColor: '#fff', color: '#444', border: '1px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonSecundario: { padding: '10px 24px', backgroundColor: '#e2e8f0', color: '#444', border: 'none', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
}