import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { subirArchivo as subirAStorage } from '../../lib/archivos'
import { ROLES_GERENCIALES } from '../../lib/roles'
import { useAuth } from '../../context/AuthContext'

const unidades = ['PZA','KG','LT','MT','CJ','RLL','PAR','JGO','SRV','TON','GR','ML','CM','M2','M3']

function lineaVacia() {
  return {
    articulo_id: '',
    descripcion: '',
    cantidad: '',
    unidad_medida: 'PZA',
    precio_unitario: '',
    iva_porcentaje: 16,
    descuento_tipo: 'porcentaje',
    descuento_valor: '',
    centro_costo_id: '',
    cuenta_gasto_id: ''
  }
}

export default function NuevaOrdenDirecta({ onVolver, onGuardado }) {
  const { perfil } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [articulos, setArticulos] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [monedas, setMonedas] = useState([])
  // Proveedores que ademas son clientes nuestros. Solo informa: no bloquea ni
  // cambia el flujo. Compras debe saber que hay relacion en los dos sentidos
  // antes de sentarse a negociar.
  const [provTambienCliente, setProvTambienCliente] = useState(new Set())
  const [centrosCostos, setCentrosCostos] = useState([])
  const [cuentasGastos, setCuentasGastos] = useState([])
  const [gerentesArea, setGerentesArea] = useState([])
  const [lineas, setLineas] = useState([lineaVacia()])
  const [form, setForm] = useState({
    proveedor_id: '',
    fecha_entrega_estimada: '',
    condiciones_pago: '',
    moneda: 'MXN',
    justificacion: '',
    notas: '',
    gerente_area_id: '',
    referencia_cotizacion: ''
  })
  const [archivoCotizacion, setArchivoCotizacion] = useState(null)

  useEffect(() => { cargarCatalogos() }, [])

  const cargarCatalogos = async () => {
    setLoading(true)
    const [{ data: a }, { data: p }, { data: cc }, { data: cg }, { data: ga }] = await Promise.all([
      supabase.from('articulos').select('*, articulo_proveedor(proveedor_id, precio, moneda)').eq('empresa_id', perfil.empresa_id).eq('activo', true),
      supabase.from('proveedores').select('*').eq('empresa_id', perfil.empresa_id).eq('activo', true),
      supabase.from('centros_costos').select('*').eq('site_id', perfil.site_id).eq('activo', true),
      supabase.from('cuentas_gastos').select('*').eq('site_id', perfil.site_id).eq('activo', true),
      supabase.from('usuarios').select('id, nombre, area, rol').eq('empresa_id', perfil.empresa_id).eq('activo', true)
        .in('rol', ROLES_GERENCIALES)
    ])
    setArticulos(a || [])
    setProveedores(p || [])

    // Consulta aparte a proposito: meterla al Promise.all de arriba obliga a
    // agregar su variable en la posicion exacta, y ese descuadre ya rompio
    // otras pantallas.
    const { data: vinc } = await supabase
      .from('clientes').select('proveedor_id')
      .eq('empresa_id', perfil.empresa_id).not('proveedor_id', 'is', null)
    setProvTambienCliente(new Set((vinc || []).map(v => v.proveedor_id)))

    const { data: mons } = await supabase.from('monedas')
      .select('clave').eq('empresa_id', perfil.empresa_id).eq('activo', true).order('clave')
    setMonedas((mons || []).map(m => m.clave))
    setCentrosCostos(cc || [])
    setCuentasGastos(cg || [])
    setGerentesArea(ga || [])
    setLoading(false)
  }

  const actualizarLinea = (i, campo, valor) => {
    const nuevas = [...lineas]
    nuevas[i] = { ...nuevas[i], [campo]: valor }
    if (campo === 'articulo_id' && valor) {
      const art = articulos.find(a => a.id === parseInt(valor))
      if (art) {
        nuevas[i].unidad_medida = art.unidad_medida
        const ap = art.articulo_proveedor?.find(ap => ap.proveedor_id?.toString() === form.proveedor_id)
        if (ap) {
          nuevas[i].precio_unitario = ap.precio.toString()
          // La moneda viaja con el precio. Antes se copiaba el numero y se
          // dejaba la de la orden: un precio en dolares terminaba etiquetado
          // como pesos y nadie lo notaba hasta la factura.
          nuevas[i].moneda_proveedor = ap.moneda || null
        }
      }
    }
    setLineas(nuevas)
  }

  // Monedas que traen los precios copiados y que no coinciden con la de la
  // orden. Una OC no se puede sumar en dos monedas, asi que se avisa fuerte.
  const monedasEnConflicto = [...new Set(
    lineas.map(l => l.moneda_proveedor).filter(m => m && m !== form.moneda)
  )]

  const agregarLinea = () => setLineas([...lineas, lineaVacia()])

  const eliminarLinea = (i) => {
    if (lineas.length === 1) return
    setLineas(lineas.filter((_, idx) => idx !== i))
  }

  const calcularDescuentoLinea = (l) => {
    const precio = parseFloat(l.precio_unitario) || 0
    const cantidad = parseFloat(l.cantidad) || 0
    const valor = parseFloat(l.descuento_valor) || 0
    if (!valor) return 0
    if (l.descuento_tipo === 'porcentaje') return (precio * cantidad) * (valor / 100)
    return valor
  }

  const calcularTotales = () => {
    const subtotal = lineas.reduce((sum, l) => {
      const precio = parseFloat(l.precio_unitario) || 0
      const cantidad = parseFloat(l.cantidad) || 0
      return sum + (precio * cantidad) - calcularDescuentoLinea(l)
    }, 0)
    const iva = lineas.reduce((sum, l) => {
      const precio = parseFloat(l.precio_unitario) || 0
      const cantidad = parseFloat(l.cantidad) || 0
      const ivaP = parseFloat(l.iva_porcentaje) || 0
      const importeConDescuento = (precio * cantidad) - calcularDescuentoLinea(l)
      return sum + (importeConDescuento * ivaP / 100)
    }, 0)
    return { subtotal, iva, total: subtotal + iva }
  }

  const generarFolioOC = async () => {
    const anio = new Date().getFullYear()
    const codigo = perfil.sites?.codigo || 'GEN'
    const empresa = perfil.empresas?.nombre?.substring(0, 5).toUpperCase() || 'EMP'
    const { count } = await supabase
      .from('ordenes_compra')
      .select('*', { count: 'exact', head: true })
      .eq('site_id', perfil.site_id)
    const consecutivo = String((count || 0) + 1).padStart(4, '0')
    return `OC-${empresa}-${codigo}-${anio}-${consecutivo}`
  }

  const guardar = async () => {
    if (!form.proveedor_id) { setError('El proveedor es obligatorio'); return }
    if (!form.justificacion) { setError('La justificacion es obligatoria en ordenes directas'); return }
    if (!form.fecha_entrega_estimada) { setError('La fecha de entrega estimada es obligatoria'); return }
    const lineasValidas = lineas.filter(l => (l.articulo_id || l.descripcion) && l.cantidad && l.precio_unitario)
    if (lineasValidas.length === 0) { setError('Debes agregar al menos una linea completa'); return }

    setError('')
    setLoading(true)

    const folio = await generarFolioOC()
    const { subtotal, iva, total } = calcularTotales()

    const requiereGerenteArea = !!form.gerente_area_id
    const estatusInicial = requiereGerenteArea ? 'aprobacion_gerente_area' : 'aprobacion_gerente_compras'
    const aprobadorInicialId = requiereGerenteArea ? form.gerente_area_id : null

    let cotizacionArchivoUrl = null
    if (archivoCotizacion) {
      const extension = archivoCotizacion.name.split('.').pop()
      const ruta = `cotizaciones/${folio}-${Date.now()}.${extension}`
      const { valor, error: errorSubida } = await subirAStorage('cotizaciones', ruta, archivoCotizacion)
      if (!errorSubida) {
        cotizacionArchivoUrl = valor
      }
    }

    const { data: oc, error: errorOC } = await supabase
      .from('ordenes_compra')
      .insert({
        folio,
        tipo: 'directa',
        empresa_id: perfil.empresa_id,
        site_id: perfil.site_id,
        proveedor_id: parseInt(form.proveedor_id),
        comprador_id: perfil.id,
        fecha_entrega_estimada: form.fecha_entrega_estimada,
        condiciones_pago: form.condiciones_pago,
        moneda: form.moneda,
        justificacion: form.justificacion,
        subtotal,
        iva,
        total,
        notas: form.notas,
        referencia_cotizacion: form.referencia_cotizacion || null,
        cotizacion_archivo_url: cotizacionArchivoUrl,
        estatus: estatusInicial,
        aprobador_actual_id: aprobadorInicialId
      })
      .select()
      .single()

    if (errorOC) {
      setError('Error al crear orden: ' + errorOC.message)
      setLoading(false)
      return
    }

    const lineasInsert = lineasValidas.map(l => ({
      oc_id: oc.id,
      articulo_id: l.articulo_id ? parseInt(l.articulo_id) : null,
      descripcion: l.descripcion || articulos.find(a => a.id === parseInt(l.articulo_id))?.descripcion || '',
      cantidad: parseFloat(l.cantidad),
      unidad_medida: l.unidad_medida,
      precio_unitario: parseFloat(l.precio_unitario),
      descuento: calcularDescuentoLinea(l),
      iva_porcentaje: parseFloat(l.iva_porcentaje),
      subtotal: (parseFloat(l.precio_unitario) * parseFloat(l.cantidad)) - calcularDescuentoLinea(l),
      centro_costo_id: l.centro_costo_id ? parseInt(l.centro_costo_id) : null,
      cuenta_gasto_id: l.cuenta_gasto_id ? parseInt(l.cuenta_gasto_id) : null
    }))

    await supabase.from('oc_lineas').insert(lineasInsert)
    setLoading(false)
    onGuardado()
  }

  const { subtotal, iva, total } = calcularTotales()

  return (
    <div style={styles.container}>
      <div style={styles.encabezado}>
        <button style={styles.botonVolver} onClick={onVolver}>
          &larr; Volver a seleccion de tipo
        </button>
        <h2 style={styles.titulo}>Orden de compra directa</h2>
        <div style={styles.alertaDirecta}>
          Esta orden no viene de una requisicion previa. Justificacion obligatoria.
          Si eliges un Gerente de area, el flujo sera: Gerente de area &rarr; Gerente de Compras &rarr; Direccion.
          Si no eliges ninguno: Gerente de Compras &rarr; Direccion.
        </div>
      </div>

      {error && <p style={styles.error}>{error}</p>}

      <div style={styles.seccion}>
        <h3 style={styles.seccionTitulo}>Datos generales</h3>
        <div style={styles.fila}>
          <div style={styles.campo}>
            <label style={styles.label}>Proveedor *</label>
            <select style={styles.input} value={form.proveedor_id}
              onChange={e => setForm({ ...form, proveedor_id: e.target.value })}>
              <option value="">Selecciona proveedor</option>
              {proveedores.map(p => (
                <option key={p.id} value={p.id}>
                  {p.nombre}{provTambienCliente.has(p.id) ? '  (tambien es cliente)' : ''}
                </option>
              ))}
            </select>
            {form.proveedor_id && provTambienCliente.has(parseInt(form.proveedor_id)) && (
              <p style={{ fontSize: '12px', color: '#1d4ed8', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', padding: '6px 9px', margin: '6px 0 0' }}>
                Esta contraparte tambien es cliente nuestro.
              </p>
            )}
          </div>
          <div style={styles.campo}>
            <label style={styles.label}>Fecha entrega estimada *</label>
            <input style={styles.input} type="date" value={form.fecha_entrega_estimada}
              onChange={e => setForm({ ...form, fecha_entrega_estimada: e.target.value })}
              min={new Date().toISOString().split('T')[0]} />
          </div>
          <div style={styles.campo}>
            <label style={styles.label}>Moneda</label>
            <select style={styles.input} value={form.moneda}
              onChange={e => setForm({ ...form, moneda: e.target.value })}>
              {(monedas.length ? monedas : [form.moneda]).map(m => <option key={m} value={m}>{m}</option>)}
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
        <div style={styles.campo}>
          <label style={styles.label}>Requiere aprobacion previa de un Gerente de area (opcional)</label>
          <select style={styles.input} value={form.gerente_area_id}
            onChange={e => setForm({ ...form, gerente_area_id: e.target.value })}>
            <option value="">No, enviar directo a Gerente de Compras</option>
            {gerentesArea.map(g => (
              <option key={g.id} value={g.id}>{g.nombre} - {g.area || g.rol}</option>
            ))}
          </select>
          <p style={styles.inputDesc}>
            Si esta compra es para un area especifica (ej. Logistica), selecciona al Gerente de esa area para que la apruebe primero. Si no aplica, se enviara directo al Gerente de Compras.
          </p>
        </div>
        <div style={styles.campo}>
          <label style={styles.label}>Justificacion *</label>
          <textarea style={styles.textarea} value={form.justificacion}
            onChange={e => setForm({ ...form, justificacion: e.target.value })}
            placeholder="Explica el motivo de esta compra directa sin requisicion previa..."
            rows={3} />
        </div>
        <div style={styles.campo}>
          <label style={styles.label}>Notas adicionales</label>
          <textarea style={styles.textarea} value={form.notas}
            onChange={e => setForm({ ...form, notas: e.target.value })}
            placeholder="Instrucciones para el proveedor..."
            rows={2} />
        </div>
        <div style={styles.fila}>
          <div style={styles.campo}>
            <label style={styles.label}>Referencia a cotizacion (opcional)</label>
            <input style={styles.input} value={form.referencia_cotizacion}
              onChange={e => setForm({ ...form, referencia_cotizacion: e.target.value })}
              placeholder="Numero de cotizacion o referencia" />
          </div>
          <div style={styles.campo}>
            <label style={styles.label}>Adjuntar cotizacion (PDF o foto, opcional)</label>
            <input type="file" accept=".pdf,image/*"
              onChange={e => setArchivoCotizacion(e.target.files[0])} />
          </div>
        </div>
      </div>

      <div style={styles.seccion}>
        <div style={styles.seccionEncabezado}>
          <h3 style={styles.seccionTitulo}>Lineas de la orden</h3>
          <button style={styles.botonAgregar} onClick={agregarLinea}>+ Agregar linea</button>
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
                    <option value="">Selecciona o escribe descripcion libre</option>
                    {articulos.map(a => (
                      <option key={a.id} value={a.id}>{a.codigo_interno} - {a.descripcion}</option>
                    ))}
                  </select>
                </div>
                <div style={{ ...styles.campo, flex: 2 }}>
                  <label style={styles.label}>O descripcion libre</label>
                  <input style={styles.input} value={linea.descripcion}
                    onChange={e => actualizarLinea(i, 'descripcion', e.target.value)}
                    placeholder="Descripcion si no esta en catalogo"
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
                  <select style={styles.input} value={linea.unidad_medida}
                    onChange={e => actualizarLinea(i, 'unidad_medida', e.target.value)}>
                    {unidades.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div style={styles.campo}>
                  <label style={styles.label}>Precio unitario *</label>
                  <input style={styles.input} type="number" value={linea.precio_unitario}
                    onChange={e => actualizarLinea(i, 'precio_unitario', e.target.value)}
                    placeholder="0.00" min="0" step="0.01" />
                </div>
                <div style={styles.campo}>
                  <label style={styles.label}>IVA %</label>
                  <input style={styles.input} type="number" value={linea.iva_porcentaje}
                    onChange={e => actualizarLinea(i, 'iva_porcentaje', e.target.value)}
                    placeholder="16" min="0" max="100" />
                </div>
                <div style={styles.campo}>
                  <label style={styles.label}>Descuento</label>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <input style={styles.input} type="number" value={linea.descuento_valor}
                      onChange={e => actualizarLinea(i, 'descuento_valor', e.target.value)}
                      placeholder="0" min="0" />
                    <select style={{ ...styles.input, width: '60px' }} value={linea.descuento_tipo}
                      onChange={e => actualizarLinea(i, 'descuento_tipo', e.target.value)}>
                      <option value="porcentaje">%</option>
                      <option value="monto">$</option>
                    </select>
                  </div>
                </div>
                <div style={styles.campo}>
                  <label style={styles.label}>Subtotal</label>
                  <input style={{ ...styles.input, backgroundColor: '#f8fafc', color: '#666' }}
                    value={((parseFloat(linea.precio_unitario) || 0) * (parseFloat(linea.cantidad) || 0)).toFixed(2)}
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
                <div style={styles.campoEliminar}>
                  <button style={styles.botonEliminar} onClick={() => eliminarLinea(i)}>
                    Eliminar
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}

        {monedasEnConflicto.length > 0 && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '12px 14px', fontSize: '12.5px', color: '#7f1d1d', margin: '12px 0', lineHeight: 1.6 }}>
            <b>Hay precios en otra moneda.</b> Esta orden esta en <b>{form.moneda}</b>, pero
            {' '}{monedasEnConflicto.length === 1 ? 'un precio viene' : 'hay precios'} en
            {' '}<b>{monedasEnConflicto.join(', ')}</b>, que es como cotiza ese proveedor.
            {' '}Una orden no se puede sumar en dos monedas: cambia la moneda de la orden a la del proveedor,
            o corrige el precio de la linea a {form.moneda}.
            <div style={{ marginTop: 8 }}>
              {monedasEnConflicto.map(m => (
                <button key={m} type="button"
                  style={{ marginRight: 8, padding: '5px 12px', background: '#fff', color: '#b91c1c', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 12.5, cursor: 'pointer' }}
                  onClick={() => setForm({ ...form, moneda: m })}>
                  Poner la orden en {m}
                </button>
              ))}
            </div>
          </div>
        )}

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
          {loading ? 'Guardando...' : 'Enviar a aprobacion'}
        </button>
      </div>
    </div>
  )
}

const styles = {
  container: { padding: '28px' },
  encabezado: { marginBottom: '20px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '4px 0 8px 0' },
  botonVolver: { padding: '6px 14px', backgroundColor: 'transparent', color: '#2563eb', border: '1px solid #2563eb', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', marginBottom: '8px' },
  alertaDirecta: { backgroundColor: '#fef9c3', border: '1px solid #fde047', borderRadius: '7px', padding: '10px 14px', fontSize: '13px', color: '#854d0e' },
  seccion: { backgroundColor: '#fff', borderRadius: '10px', padding: '24px', marginBottom: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  seccionEncabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  seccionTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 16px 0' },
  fila: { display: 'flex', gap: '16px', marginBottom: '16px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 },
  campoEliminar: { display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: '4px' },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  inputDesc: { fontSize: '11px', color: '#94a3b8', margin: '4px 0 0 0' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' },
  textarea: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', resize: 'vertical', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' },
  linea: { display: 'flex', gap: '12px', backgroundColor: '#f8fafc', borderRadius: '8px', padding: '16px', marginBottom: '12px', border: '1px solid #e2e8f0' },
  lineaNumero: { width: '24px', height: '24px', borderRadius: '50%', backgroundColor: '#7c3aed', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '600', flexShrink: 0, marginTop: '4px' },
  lineaContenido: { flex: 1 },
  botonAgregar: { padding: '7px 16px', backgroundColor: '#f5f3ff', color: '#7c3aed', border: '1px solid #ddd6fe', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', fontWeight: '500' },
  botonEliminar: { padding: '9px 14px', backgroundColor: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  totales: { marginTop: '16px', padding: '16px', backgroundColor: '#f8fafc', borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' },
  totalItem: { display: 'flex', gap: '24px', alignItems: 'center' },
  totalLabel: { fontSize: '13px', color: '#666', minWidth: '80px', textAlign: 'right' },
  totalValor: { fontSize: '14px', color: '#1a1a2e', minWidth: '100px', textAlign: 'right' },
  botones: { display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' },
  boton: { padding: '10px 24px', backgroundColor: '#7c3aed', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSecundario: { padding: '10px 24px', backgroundColor: '#e2e8f0', color: '#444', border: 'none', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
}