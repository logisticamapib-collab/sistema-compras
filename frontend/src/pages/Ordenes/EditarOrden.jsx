import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { subirArchivo as subirAStorage } from '../../lib/archivos'
import EnlaceArchivo from '../../components/EnlaceArchivo'
import { useAuth } from '../../context/AuthContext'

const unidades = ['PZA','KG','LT','MT','CJ','RLL','PAR','JGO','SRV','TON','GR','ML','CM','M2','M3']

export default function EditarOrden({ orden, onVolver, onGuardado }) {
  const { perfil } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lineas, setLineas] = useState([])
  const [centrosCostos, setCentrosCostos] = useState([])
  const [cuentasGastos, setCuentasGastos] = useState([])
  const [archivoCotizacion, setArchivoCotizacion] = useState(null)
  const [form, setForm] = useState({
    fecha_entrega_estimada: orden.fecha_entrega_estimada || '',
    condiciones_pago: orden.condiciones_pago || '',
    moneda: orden.moneda || 'MXN',
    notas: orden.notas || '',
    justificacion: orden.justificacion || '',
    referencia_cotizacion: orden.referencia_cotizacion || ''
  })

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    const [{ data: l }, { data: cc }, { data: cg }] = await Promise.all([
      supabase.from('oc_lineas')
        .select('*, articulos(codigo_interno, descripcion)')
        .eq('oc_id', orden.id)
        .order('id'),
      supabase.from('centros_costos').select('*').eq('site_id', orden.site_id).eq('activo', true),
      supabase.from('cuentas_gastos').select('*').eq('site_id', orden.site_id).eq('activo', true)
    ])
    setLineas((l || []).map(linea => ({
      id: linea.id,
      articulo_id: linea.articulo_id,
      articulos: linea.articulos,
      descripcion: linea.descripcion || '',
      cantidad: linea.cantidad?.toString() || '',
      unidad_medida: linea.unidad_medida || 'PZA',
      precio_unitario: linea.precio_unitario?.toString() || '',
      iva_porcentaje: linea.iva_porcentaje?.toString() || '16',
      descuento: linea.descuento?.toString() || '0',
      centro_costo_id: linea.centro_costo_id?.toString() || '',
      cuenta_gasto_id: linea.cuenta_gasto_id?.toString() || ''
    })))
    setCentrosCostos(cc || [])
    setCuentasGastos(cg || [])
    setLoading(false)
  }

  const actualizarLinea = (i, campo, valor) => {
    const nuevas = [...lineas]
    nuevas[i] = { ...nuevas[i], [campo]: valor }
    setLineas(nuevas)
  }

  const subtotalLinea = (l) => {
    const precio = parseFloat(l.precio_unitario) || 0
    const cantidad = parseFloat(l.cantidad) || 0
    const descuento = parseFloat(l.descuento) || 0
    return (precio * cantidad) - descuento
  }

  const calcularTotales = () => {
    const subtotal = lineas.reduce((sum, l) => sum + subtotalLinea(l), 0)
    const iva = lineas.reduce((sum, l) => {
      const ivaP = parseFloat(l.iva_porcentaje) || 0
      return sum + (subtotalLinea(l) * ivaP / 100)
    }, 0)
    return { subtotal, iva, total: subtotal + iva }
  }

  const guardar = async () => {
    if (!form.fecha_entrega_estimada) {
      setError('La fecha de entrega estimada es obligatoria')
      return
    }
    if (orden.tipo === 'directa' && !form.justificacion) {
      setError('La justificacion es obligatoria en ordenes directas')
      return
    }
    const lineasInvalidas = lineas.some(l => !l.cantidad || !l.precio_unitario)
    if (lineasInvalidas) {
      setError('Todas las lineas necesitan cantidad y precio unitario')
      return
    }

    setError('')
    setLoading(true)

    const { subtotal, iva, total } = calcularTotales()

    let cotizacionArchivoUrl = orden.cotizacion_archivo_url || null
    if (archivoCotizacion) {
      const extension = archivoCotizacion.name.split('.').pop()
      const ruta = `cotizaciones/${orden.folio}-${Date.now()}.${extension}`
      const { valor, error: errorSubida } = await subirAStorage('cotizaciones', ruta, archivoCotizacion)
      if (!errorSubida) {
        cotizacionArchivoUrl = valor
      }
    }

    const updateOC = {
      fecha_entrega_estimada: form.fecha_entrega_estimada,
      condiciones_pago: form.condiciones_pago,
      moneda: form.moneda,
      notas: form.notas,
      referencia_cotizacion: form.referencia_cotizacion || null,
      cotizacion_archivo_url: cotizacionArchivoUrl,
      subtotal,
      iva,
      total
    }
    if (orden.tipo === 'directa') {
      updateOC.justificacion = form.justificacion
    }

    const { error: errorOC } = await supabase
      .from('ordenes_compra')
      .update(updateOC)
      .eq('id', orden.id)

    if (errorOC) {
      setError('Error al actualizar la orden: ' + errorOC.message)
      setLoading(false)
      return
    }

    for (const l of lineas) {
      await supabase.from('oc_lineas').update({
        descripcion: l.descripcion,
        cantidad: parseFloat(l.cantidad),
        unidad_medida: l.unidad_medida,
        precio_unitario: parseFloat(l.precio_unitario),
        iva_porcentaje: parseFloat(l.iva_porcentaje),
        descuento: parseFloat(l.descuento) || 0,
        subtotal: subtotalLinea(l),
        centro_costo_id: l.centro_costo_id ? parseInt(l.centro_costo_id) : null,
        cuenta_gasto_id: l.cuenta_gasto_id ? parseInt(l.cuenta_gasto_id) : null
      }).eq('id', l.id)
    }

    setLoading(false)
    onGuardado()
  }

  const { subtotal, iva, total } = calcularTotales()

  return (
    <div style={styles.container}>
      <div style={styles.encabezado}>
        <button style={styles.botonVolver} onClick={onVolver}>
          &larr; Volver al detalle
        </button>
        <h2 style={styles.titulo}>Editando {orden.folio}</h2>
        <div style={styles.alertaInfo}>
          Puedes editar esta orden porque aun no ha recibido ninguna aprobacion.
          El proveedor no se puede cambiar aqui; si necesitas otro proveedor, cancela esta orden y genera una nueva.
        </div>
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {loading ? <p style={{ color: '#666' }}>Cargando...</p> : (
        <>
          <div style={styles.seccion}>
            <h3 style={styles.seccionTitulo}>Datos generales</h3>
            <div style={styles.fila}>
              <div style={styles.campo}>
                <label style={styles.label}>Fecha entrega estimada *</label>
                <input style={styles.input} type="date" value={form.fecha_entrega_estimada}
                  onChange={e => setForm({ ...form, fecha_entrega_estimada: e.target.value })} />
              </div>
              <div style={styles.campo}>
                <label style={styles.label}>Moneda</label>
                <select style={styles.input} value={form.moneda}
                  onChange={e => setForm({ ...form, moneda: e.target.value })}>
                  <option value="MXN">MXN</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
              <div style={styles.campo}>
                <label style={styles.label}>Condiciones de pago</label>
                <select style={styles.input} value={form.condiciones_pago}
                  onChange={e => setForm({ ...form, condiciones_pago: e.target.value })}>
                  <option value="">Selecciona</option>
                  <option value="contado">Contado</option>
                  <option value="15 dias">15 dias</option>
                  <option value="30 dias">30 dias</option>
                  <option value="45 dias">45 dias</option>
                  <option value="60 dias">60 dias</option>
                  <option value="90 dias">90 dias</option>
                </select>
              </div>
            </div>
            {orden.tipo === 'directa' && (
              <div style={styles.campo}>
                <label style={styles.label}>Justificacion *</label>
                <textarea style={styles.textarea} value={form.justificacion}
                  onChange={e => setForm({ ...form, justificacion: e.target.value })}
                  rows={3} />
              </div>
            )}
            <div style={styles.campo}>
              <label style={styles.label}>Notas</label>
              <textarea style={styles.textarea} value={form.notas}
                onChange={e => setForm({ ...form, notas: e.target.value })}
                rows={2} />
            </div>
            <div style={styles.fila}>
              <div style={styles.campo}>
                <label style={styles.label}>Referencia a cotizacion</label>
                <input style={styles.input} value={form.referencia_cotizacion}
                  onChange={e => setForm({ ...form, referencia_cotizacion: e.target.value })}
                  placeholder="Numero de cotizacion o referencia" />
              </div>
              <div style={styles.campo}>
                <label style={styles.label}>Adjuntar cotizacion (PDF o foto)</label>
                <input type="file" accept=".pdf,image/*"
                  onChange={e => setArchivoCotizacion(e.target.files[0])} />
                {orden.cotizacion_archivo_url && !archivoCotizacion && (
                  <EnlaceArchivo valor={orden.cotizacion_archivo_url} style={styles.linkArchivo}>
                    Ver archivo actual
                  </EnlaceArchivo>
                )}
              </div>
            </div>
          </div>

          <div style={styles.seccion}>
            <h3 style={styles.seccionTitulo}>Lineas de la orden</h3>
            {lineas.map((linea, i) => (
              <div key={linea.id} style={styles.linea}>
                <div style={styles.lineaNumero}>{i + 1}</div>
                <div style={styles.lineaContenido}>
                  <div style={styles.fila}>
                    <div style={{ ...styles.campo, flex: 3 }}>
                      <label style={styles.label}>Articulo / Descripcion</label>
                      {linea.articulo_id ? (
                        <input style={{ ...styles.input, backgroundColor: '#f8fafc', color: '#666' }}
                          value={`${linea.articulos?.codigo_interno || ''} - ${linea.articulos?.descripcion || ''}`}
                          readOnly />
                      ) : (
                        <input style={styles.input} value={linea.descripcion}
                          onChange={e => actualizarLinea(i, 'descripcion', e.target.value)} />
                      )}
                    </div>
                  </div>
                  <div style={styles.fila}>
                    <div style={styles.campo}>
                      <label style={styles.label}>Cantidad *</label>
                      <input style={styles.input} type="number" value={linea.cantidad}
                        onChange={e => actualizarLinea(i, 'cantidad', e.target.value)}
                        min="0" step="0.01" />
                    </div>
                    <div style={styles.campo}>
                      <label style={styles.label}>Unidad</label>
                      <select style={styles.input} value={linea.unidad_medida}
                        onChange={e => actualizarLinea(i, 'unidad_medida', e.target.value)}>
                        {unidades.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                    <div style={styles.campo}>
                      <label style={styles.label}>Precio unitario *</label>
                      <input style={styles.input} type="number" value={linea.precio_unitario}
                        onChange={e => actualizarLinea(i, 'precio_unitario', e.target.value)}
                        min="0" step="0.01" />
                    </div>
                    <div style={styles.campo}>
                      <label style={styles.label}>IVA %</label>
                      <input style={styles.input} type="number" value={linea.iva_porcentaje}
                        onChange={e => actualizarLinea(i, 'iva_porcentaje', e.target.value)}
                        min="0" max="100" />
                    </div>
                    <div style={styles.campo}>
                      <label style={styles.label}>Descuento ($)</label>
                      <input style={styles.input} type="number" value={linea.descuento}
                        onChange={e => actualizarLinea(i, 'descuento', e.target.value)}
                        min="0" step="0.01" />
                    </div>
                    <div style={styles.campo}>
                      <label style={styles.label}>Subtotal</label>
                      <input style={{ ...styles.input, backgroundColor: '#f8fafc', color: '#666' }}
                        value={subtotalLinea(linea).toFixed(2)}
                        readOnly />
                    </div>
                  </div>
                  <div style={styles.fila}>
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
                </div>
              </div>
            ))}

            <div style={styles.totales}>
              <div style={styles.totalItem}>
                <span style={styles.totalLabel}>Subtotal</span>
                <span style={styles.totalValor}>${subtotal.toFixed(2)}</span>
              </div>
              <div style={styles.totalItem}>
                <span style={styles.totalLabel}>IVA</span>
                <span style={styles.totalValor}>${iva.toFixed(2)}</span>
              </div>
              <div style={{ ...styles.totalItem, borderTop: '2px solid #e2e8f0', paddingTop: '8px' }}>
                <span style={{ ...styles.totalLabel, fontWeight: '700', fontSize: '15px' }}>Total {form.moneda}</span>
                <span style={{ ...styles.totalValor, fontWeight: '700', fontSize: '18px', color: '#2563eb' }}>${total.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div style={styles.botones}>
            <button style={styles.botonSecundario} onClick={onVolver}>Cancelar</button>
            <button style={styles.boton} onClick={guardar} disabled={loading}>
              {loading ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

const styles = {
  container: { padding: '28px' },
  encabezado: { marginBottom: '20px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '4px 0 8px 0' },
  botonVolver: { padding: '6px 14px', backgroundColor: 'transparent', color: '#2563eb', border: '1px solid #2563eb', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', marginBottom: '8px' },
  alertaInfo: { backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '7px', padding: '10px 14px', fontSize: '13px', color: '#2563eb' },
  seccion: { backgroundColor: '#fff', borderRadius: '10px', padding: '24px', marginBottom: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  seccionTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 16px 0' },
  fila: { display: 'flex', gap: '16px', marginBottom: '16px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' },
  textarea: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', resize: 'vertical', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' },
  linkArchivo: { fontSize: '12px', color: '#2563eb', marginTop: '4px' },
  linea: { display: 'flex', gap: '12px', backgroundColor: '#f8fafc', borderRadius: '8px', padding: '16px', marginBottom: '12px', border: '1px solid #e2e8f0' },
  lineaNumero: { width: '24px', height: '24px', borderRadius: '50%', backgroundColor: '#2563eb', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '600', flexShrink: 0, marginTop: '4px' },
  lineaContenido: { flex: 1 },
  totales: { marginTop: '16px', padding: '16px', backgroundColor: '#f8fafc', borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' },
  totalItem: { display: 'flex', gap: '24px', alignItems: 'center' },
  totalLabel: { fontSize: '13px', color: '#666', minWidth: '80px', textAlign: 'right' },
  totalValor: { fontSize: '14px', color: '#1a1a2e', minWidth: '100px', textAlign: 'right' },
  botones: { display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' },
  boton: { padding: '10px 24px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSecundario: { padding: '10px 24px', backgroundColor: '#e2e8f0', color: '#444', border: 'none', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
}