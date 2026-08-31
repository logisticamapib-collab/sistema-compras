import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { exportarExcel, imprimirTablaPDF } from '../../lib/exportar'

// Facturas de proveedor: el tercer lado del triangulo de compras.
//
// La ORDEN dice que pediste y a que precio. El RECIBO dice que llego al
// almacen. La FACTURA dice que te estan cobrando. Los tres deben cuadrar, y
// donde no cuadran esta el dinero que se va.
//
// La captura arranca por los RECIBOS pendientes de facturar, no por una hoja
// en blanco: asi la factura nace ligada a lo que de verdad se recibio, y de
// ahi el sistema alcanza la linea de orden -- con su precio pactado -- y el
// lote al que entro el material. Es el unico punto donde se pueden comparar
// las tres cosas.
//
// Aplicar la factura es lo que vuelve FIRME el costo del lote, con el precio y
// el tipo de cambio del documento que de verdad se paga. Por eso no se aplica
// si hay diferencias sin autorizar, y ese candado vive en la base.

const hoy = () => new Date().toISOString().split('T')[0]
const fmt = (n) => Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const ESTATUS = {
  capturada: { t: 'Capturada', bg: '#f1f5f9', c: '#475569' },
  en_revision: { t: 'En revision', bg: '#fffbeb', c: '#b45309' },
  autorizada: { t: 'Autorizada', bg: '#eff6ff', c: '#1d4ed8' },
  aplicada: { t: 'Aplicada', bg: '#f0fdf4', c: '#16a34a' },
  rechazada: { t: 'Rechazada', bg: '#fef2f2', c: '#dc2626' },
}

export default function FacturasProveedor() {
  const { perfil, tienePermiso } = useAuth()
  const emp = perfil.empresa_id
  const puedeCrear = tienePermiso('com_facturas', 'crear')
  const puedeAprobar = tienePermiso('com_facturas', 'aprobar')

  const [cfg, setCfg] = useState(null)
  const [facturas, setFacturas] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [monedas, setMonedas] = useState([])
  const [vista, setVista] = useState('lista')   // lista | nueva | detalle
  const [sel, setSel] = useState(null)
  const [cotejo, setCotejo] = useState([])
  const [loading, setLoading] = useState(true)
  const [proc, setProc] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  // --- alta ---
  const [form, setForm] = useState(null)
  const [pendientes, setPendientes] = useState([])
  const [lineas, setLineas] = useState({})   // recibo_linea_id -> { cant, precio }

  useEffect(() => { cargar() }, [])

  const cargar = async () => {
    setLoading(true)
    // El orden de las variables sigue el orden de las consultas.
    const [rCfg, rFac, rProv, rMon] = await Promise.all([
      supabase.from('config_compras').select('*').eq('empresa_id', emp).maybeSingle(),
      supabase.from('facturas_proveedor').select('*').eq('empresa_id', emp).order('fecha', { ascending: false }).limit(300),
      supabase.from('proveedores').select('id, nombre, dias_credito').eq('empresa_id', emp).eq('activo', true).order('nombre'),
      supabase.from('monedas').select('clave').eq('empresa_id', emp).eq('activo', true).order('clave'),
    ])
    setCfg(rCfg.data || null)
    setFacturas(rFac.data || [])
    setProveedores(rProv.data || [])
    setMonedas((rMon.data || []).map(m => m.clave))
    setLoading(false)
  }

  const provDe = (id) => proveedores.find(p => p.id === id)

  // Recibos con material todavia sin facturar de ese proveedor. Se parte de
  // aqui y no de una hoja en blanco: la factura nace amarrada a lo recibido.
  const cargarPendientes = async (provId) => {
    setPendientes([]); setLineas({})
    if (!provId) return
    const { data: recs } = await supabase.from('recibos')
      .select('id, folio, fecha, oc_id').eq('empresa_id', emp).eq('proveedor_id', Number(provId))
      .order('fecha', { ascending: false }).limit(100)
    if (!recs?.length) return

    const { data: lins } = await supabase.from('recibo_lineas')
      .select('id, recibo_id, oc_linea_id, articulo_id, cantidad, cantidad_facturada, lote_id')
      .in('recibo_id', recs.map(r => r.id))
    const pend = (lins || []).filter(l => Number(l.cantidad) - Number(l.cantidad_facturada || 0) > 0.000001)
    if (!pend.length) return

    const [rArt, rOcl, rOc] = await Promise.all([
      supabase.from('articulos').select('id, codigo_interno, descripcion, unidad_medida').in('id', [...new Set(pend.map(l => l.articulo_id))]),
      supabase.from('oc_lineas').select('id, precio_unitario').in('id', pend.map(l => l.oc_linea_id).filter(Boolean)),
      supabase.from('ordenes_compra').select('id, folio, moneda').in('id', [...new Set(recs.map(r => r.oc_id).filter(Boolean))]),
    ])
    const arts = rArt.data || [], ocls = rOcl.data || [], ocs = rOc.data || []
    setPendientes(pend.map(l => {
      const rec = recs.find(r => r.id === l.recibo_id)
      const oc = ocs.find(o => o.id === rec?.oc_id)
      const ocl = ocls.find(x => x.id === l.oc_linea_id)
      const a = arts.find(x => x.id === l.articulo_id)
      return {
        ...l, recibo_folio: rec?.folio, recibo_fecha: rec?.fecha, oc_folio: oc?.folio, oc_moneda: oc?.moneda,
        precio_orden: ocl?.precio_unitario ?? null,
        codigo: a?.codigo_interno, descripcion: a?.descripcion, um: a?.unidad_medida,
        pendiente: Number(l.cantidad) - Number(l.cantidad_facturada || 0),
      }
    }))
  }

  const abrirNueva = () => {
    setForm({
      proveedor_id: '', folio_proveedor: '', uuid_cfdi: '', fecha: hoy(), fecha_vencimiento: '',
      moneda: '', tipo_cambio: '', descuento: 0, iva: 0, retenciones: 0, notas: '',
    })
    setPendientes([]); setLineas({}); setVista('nueva'); setError('')
  }

  const elegirProveedor = async (id) => {
    const p = provDe(Number(id))
    setForm(f => ({ ...f, proveedor_id: id }))
    await cargarPendientes(id)
    // Vencimiento sugerido a partir de los dias de credito del proveedor: es
    // un dato que ya existe y que nadie deberia recapturar.
    if (p?.dias_credito) {
      const d = new Date(form?.fecha || hoy())
      d.setDate(d.getDate() + Number(p.dias_credito))
      setForm(f => ({ ...f, proveedor_id: id, fecha_vencimiento: d.toISOString().split('T')[0] }))
    }
  }

  const toggleLinea = (l) => {
    setLineas(prev => {
      const n = { ...prev }
      if (n[l.id]) delete n[l.id]
      // Arranca con lo pendiente y el precio de la orden: lo normal es que la
      // factura diga eso, y asi lo que se teclea es solo la diferencia.
      else n[l.id] = { cant: String(l.pendiente), precio: String(l.precio_orden ?? '') }
      return n
    })
  }

  const subtotalNuevo = Object.entries(lineas).reduce(
    (a, [, v]) => a + (Number(v.cant) || 0) * (Number(v.precio) || 0), 0)
  const totalNuevo = subtotalNuevo - (Number(form?.descuento) || 0)
    + (Number(form?.iva) || 0) - (Number(form?.retenciones) || 0)

  const guardarFactura = async () => {
    setError('')
    const ids = Object.keys(lineas)
    if (!form.proveedor_id) { setError('Elige el proveedor.'); return }
    if (!form.folio_proveedor.trim()) { setError('Captura el folio de la factura.'); return }
    if (ids.length === 0) { setError('Marca al menos una linea de recibo: la factura se liga a lo que se recibio.'); return }
    for (const id of ids) {
      const v = lineas[id]
      if (!(Number(v.cant) > 0)) { setError('Hay lineas con cantidad en cero.'); return }
      if (!(Number(v.precio) >= 0)) { setError('Hay lineas sin precio.'); return }
    }
    setProc(true)
    try {
      const { data: fac, error: e1 } = await supabase.from('facturas_proveedor').insert({
        empresa_id: emp, proveedor_id: Number(form.proveedor_id),
        folio_proveedor: form.folio_proveedor.trim(),
        uuid_cfdi: form.uuid_cfdi.trim() || null,
        fecha: form.fecha, fecha_vencimiento: form.fecha_vencimiento || null,
        moneda: form.moneda || pendientes.find(p => lineas[p.id])?.oc_moneda || 'MXN',
        tipo_cambio: form.tipo_cambio !== '' ? Number(form.tipo_cambio) : null,
        subtotal: subtotalNuevo, descuento: Number(form.descuento) || 0,
        iva: Number(form.iva) || 0, retenciones: Number(form.retenciones) || 0,
        total: totalNuevo, notas: form.notas || null, capturado_por: perfil.id,
      }).select().single()
      if (e1) throw e1

      for (const id of ids) {
        const v = lineas[id]
        const { error: e2 } = await supabase.from('factura_lineas').insert({
          factura_id: fac.id, recibo_linea_id: Number(id),
          cantidad: Number(v.cant), precio_unitario: Number(v.precio),
          subtotal: Number(v.cant) * Number(v.precio),
        })
        if (e2) throw e2
      }

      // El cotejo decide el estatus: si algo se sale de tolerancia, la factura
      // nace en revision en vez de pasar callada.
      const { data: req } = await supabase.rpc('factura_requiere_autorizacion', {
        p_empresa_id: emp, p_factura_id: fac.id,
      })
      if (req) await supabase.from('facturas_proveedor').update({ estatus: 'en_revision' }).eq('id', fac.id)

      setExito(req
        ? `Factura ${fac.folio_proveedor} capturada. El cotejo encontro diferencias: quedo EN REVISION.`
        : `Factura ${fac.folio_proveedor} capturada y cuadra con la orden y el recibo.`)
      setVista('lista'); await cargar(); await abrirDetalle(fac.id)
      setTimeout(() => setExito(''), 6000)
    } catch (err) {
      setError(err.message?.includes('duplicate')
        ? 'Ya existe una factura de ese proveedor con ese folio, o ya se capturo ese UUID.'
        : 'No se pudo guardar: ' + err.message)
    }
    setProc(false)
  }

  const abrirDetalle = async (id) => {
    const { data: f } = await supabase.from('facturas_proveedor').select('*').eq('id', id).maybeSingle()
    if (!f) return
    const { data: c } = await supabase.rpc('cotejar_factura', { p_empresa_id: emp, p_factura_id: id })
    setSel(f); setCotejo(c || []); setVista('detalle')
  }

  const autorizar = async (quien) => {
    setError(''); setExito('')
    const patch = quien === 'compras'
      ? { autorizada_compras_por: perfil.id, autorizada_compras_at: new Date().toISOString() }
      : { autorizada_jefe_por: perfil.id, autorizada_jefe_at: new Date().toISOString() }
    const np = { ...sel, ...patch }
    // Queda autorizada cuando ya firmaron todos los que la configuracion pide.
    const faltaCompras = cfg?.autoriza_compras && !np.autorizada_compras_at
    const faltaJefe = cfg?.autoriza_jefe && !np.autorizada_jefe_at
    if (!faltaCompras && !faltaJefe) patch.estatus = 'autorizada'

    const { error: e } = await supabase.from('facturas_proveedor').update(patch).eq('id', sel.id)
    if (e) { setError(e.message); return }
    setExito(patch.estatus === 'autorizada' ? 'Factura autorizada. Ya se puede aplicar.' : 'Firma registrada. Falta la otra autorizacion.')
    await cargar(); await abrirDetalle(sel.id)
    setTimeout(() => setExito(''), 5000)
  }

  const aplicar = async () => {
    setError(''); setExito('')
    if (!window.confirm(
      `Aplicar la factura ${sel.folio_proveedor}?\n\n`
      + `Los costos de los lotes van a quedar FIRMES con el precio y el tipo de cambio de esta factura. `
      + `Es lo que valua el inventario y no se revalua despues.\n\nConfirma que desea proceder.`)) return
    setProc(true)
    const { data, error: e } = await supabase.rpc('aplicar_factura', {
      p_empresa_id: emp, p_factura_id: sel.id, p_usuario: perfil.id,
    })
    setProc(false)
    if (e) { setError(e.message); return }
    const r = data?.[0]
    setExito(`Factura aplicada: ${r?.lineas_aplicadas || 0} linea(s), ${r?.lotes_congelados || 0} lote(s) con costo firme.`)
    await cargar(); await abrirDetalle(sel.id)
    setTimeout(() => setExito(''), 6000)
  }

  const rechazar = async () => {
    const motivo = window.prompt('Motivo del rechazo:')
    if (motivo === null) return
    const { error: e } = await supabase.from('facturas_proveedor')
      .update({ estatus: 'rechazada', notas: [sel.notas, `RECHAZADA: ${motivo}`].filter(Boolean).join(' · ') })
      .eq('id', sel.id)
    if (e) { setError(e.message); return }
    setExito('Factura rechazada. No toca ningun costo.')
    await cargar(); await abrirDetalle(sel.id)
    setTimeout(() => setExito(''), 4000)
  }

  const COLS = [
    { label: 'Folio', get: f => f.folio_proveedor },
    { label: 'Proveedor', get: f => provDe(f.proveedor_id)?.nombre || '' },
    { label: 'Fecha', get: f => f.fecha },
    { label: 'Vence', get: f => f.fecha_vencimiento || '' },
    { label: 'Moneda', get: f => f.moneda },
    { label: 'Tipo de cambio', get: f => f.tipo_cambio || '' },
    { label: 'Total', get: f => f.total },
    { label: 'Estatus', get: f => ESTATUS[f.estatus]?.t || f.estatus },
    { label: 'UUID', get: f => f.uuid_cfdi || '' },
  ]

  if (loading) return <p style={{ padding: 28, color: '#666' }}>Cargando...</p>

  // El modulo se apaga desde Configuracion: si la empresa no llego a este
  // nivel, no se ofrece la pantalla a medias.
  if (cfg && cfg.nivel_facturacion === 'recibo') {
    return (
      <div style={S.wrap}>
        <h2 style={S.h2}>Facturas de proveedor</h2>
        <div style={S.avisoOff}>
          <b>El modulo de compras esta configurado en "solo recibo".</b> Con ese nivel el costo queda firme
          cuando el material entra al almacen y no se capturan facturas aqui.
          {' '}Para habilitar el cotejo de tres vias, entra a <b>Configuracion &rarr; Compras y Facturacion</b> y
          sube el nivel a <b>Cotejo</b> o <b>Cotejo mas cuentas por pagar</b>.
        </div>
      </div>
    )
  }

  // ======================= NUEVA =======================
  if (vista === 'nueva' && form) {
    const porRecibo = pendientes.reduce((a, l) => {
      (a[l.recibo_folio] = a[l.recibo_folio] || []).push(l); return a
    }, {})
    return (
      <div style={S.wrap}>
        <button style={S.volver} onClick={() => { setVista('lista'); setError('') }}>&larr; Volver a facturas</button>
        <h2 style={S.h2}>Nueva factura de proveedor</h2>
        <p style={S.sub}>
          Se parte de los <b>recibos pendientes de facturar</b>, no de una hoja en blanco: asi la factura queda
          amarrada a lo que de verdad se recibio, y el sistema puede compararla contra la orden y contra el
          almacen.
        </p>
        {error && <p style={S.err}>{error}</p>}

        <div style={S.card}>
          <div style={S.fila}>
            <div style={{ ...S.campo, flex: 2 }}>
              <label style={S.label}>Proveedor *</label>
              <select style={S.input} value={form.proveedor_id} onChange={e => elegirProveedor(e.target.value)}>
                <option value="">Selecciona...</option>
                {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div style={S.campo}>
              <label style={S.label}>Folio de la factura *</label>
              <input style={S.input} value={form.folio_proveedor}
                onChange={e => setForm({ ...form, folio_proveedor: e.target.value })} placeholder="A-1001" />
            </div>
            <div style={{ ...S.campo, flex: 2 }}>
              <label style={S.label}>UUID del CFDI</label>
              <input style={S.input} value={form.uuid_cfdi}
                onChange={e => setForm({ ...form, uuid_cfdi: e.target.value })} placeholder="Opcional; sirve de candado contra capturarla dos veces" />
            </div>
          </div>
          <div style={S.fila}>
            <div style={S.campo}>
              <label style={S.label}>Fecha</label>
              <input style={S.input} type="date" value={form.fecha} onChange={e => setForm({ ...form, fecha: e.target.value })} />
            </div>
            <div style={S.campo}>
              <label style={S.label}>Vencimiento</label>
              <input style={S.input} type="date" value={form.fecha_vencimiento}
                onChange={e => setForm({ ...form, fecha_vencimiento: e.target.value })} />
              <span style={S.ayuda}>Se sugiere con los dias de credito del proveedor.</span>
            </div>
            <div style={S.campo}>
              <label style={S.label}>Moneda</label>
              <select style={S.input} value={form.moneda} onChange={e => setForm({ ...form, moneda: e.target.value })}>
                <option value="">La de la orden</option>
                {monedas.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div style={S.campo}>
              <label style={S.label}>Tipo de cambio de la factura</label>
              <input style={S.input} type="number" step="0.0001" value={form.tipo_cambio}
                onChange={e => setForm({ ...form, tipo_cambio: e.target.value })} placeholder="El que trae el documento" />
              <span style={S.ayuda}>Manda sobre el del catalogo: es el que se paga.</span>
            </div>
          </div>
        </div>

        {!form.proveedor_id ? null : pendientes.length === 0 ? (
          <div style={S.avisoOff}>
            Este proveedor no tiene recibos con material pendiente de facturar. Si la factura corresponde a algo
            que todavia no se recibe, registralo primero en <b>Logistica &rarr; Recibos</b>.
          </div>
        ) : (
          <div style={S.card}>
            <p style={S.cardTit}>Que se factura</p>
            <p style={S.ayuda}>
              Marca las lineas. Cada una arranca con lo pendiente y el precio de la orden, que es lo normal;
              solo se teclea la diferencia.
            </p>
            {Object.entries(porRecibo).map(([folio, ls]) => (
              <div key={folio} style={{ marginBottom: 14 }}>
                <p style={S.reciboTit}>Recibo {folio} · OC {ls[0].oc_folio || 'directa'} · {ls[0].recibo_fecha}</p>
                <div style={S.tabla}>
                  <div style={S.th}>
                    <span style={{ width: 34 }}></span>
                    <span style={{ flex: 2 }}>Articulo</span>
                    <span style={{ width: 110 }}>Pendiente</span>
                    <span style={{ width: 110 }}>Precio orden</span>
                    <span style={{ width: 120 }}>Cant. facturada</span>
                    <span style={{ width: 120 }}>Precio facturado</span>
                    <span style={{ width: 110 }}>Importe</span>
                  </div>
                  {ls.map(l => {
                    const sel = lineas[l.id]
                    return (
                      <div key={l.id} style={sel ? S.trSel : S.tr}>
                        <span style={{ width: 34 }}>
                          <input type="checkbox" checked={!!sel} onChange={() => toggleLinea(l)} />
                        </span>
                        <span style={{ flex: 2, fontSize: 13 }}>
                          <b>{l.codigo}</b><span style={{ color: '#94a3b8' }}> — {l.descripcion}</span>
                        </span>
                        <span style={{ width: 110, color: '#64748b' }}>{fmt(l.pendiente)} {l.um}</span>
                        <span style={{ width: 110, color: '#64748b' }}>{l.precio_orden != null ? fmt(l.precio_orden) : '—'}</span>
                        <span style={{ width: 120 }}>
                          {sel && <input style={S.inputMini} type="number" step="0.0001" value={sel.cant}
                            onChange={e => setLineas({ ...lineas, [l.id]: { ...sel, cant: e.target.value } })} />}
                        </span>
                        <span style={{ width: 120 }}>
                          {sel && <input style={S.inputMini} type="number" step="0.0001" value={sel.precio}
                            onChange={e => setLineas({ ...lineas, [l.id]: { ...sel, precio: e.target.value } })} />}
                        </span>
                        <span style={{ width: 110, fontWeight: 600 }}>
                          {sel ? fmt((Number(sel.cant) || 0) * (Number(sel.precio) || 0)) : ''}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

            <div style={S.fila}>
              <div style={S.campo}><label style={S.label}>Descuento</label>
                <input style={S.input} type="number" step="0.01" value={form.descuento} onChange={e => setForm({ ...form, descuento: e.target.value })} /></div>
              <div style={S.campo}><label style={S.label}>IVA</label>
                <input style={S.input} type="number" step="0.01" value={form.iva} onChange={e => setForm({ ...form, iva: e.target.value })} /></div>
              <div style={S.campo}><label style={S.label}>Retenciones</label>
                <input style={S.input} type="number" step="0.01" value={form.retenciones} onChange={e => setForm({ ...form, retenciones: e.target.value })} /></div>
              <div style={{ ...S.campo, flex: 2 }}><label style={S.label}>Notas</label>
                <input style={S.input} value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })} /></div>
            </div>

            <div style={S.totales}>
              <span>Subtotal <b>{fmt(subtotalNuevo)}</b></span>
              <span style={{ fontSize: 16 }}>Total <b>{fmt(totalNuevo)}</b> {form.moneda || ''}</span>
            </div>
            <div style={S.acciones}>
              <button style={S.botonGris} onClick={() => setVista('lista')}>Cancelar</button>
              <button style={S.boton} onClick={guardarFactura} disabled={proc}>
                {proc ? 'Guardando...' : 'Guardar y cotejar'}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ======================= DETALLE =======================
  if (vista === 'detalle' && sel) {
    const est = ESTATUS[sel.estatus] || {}
    const hayDif = cotejo.some(c => c.cantidad_ok === false || c.precio_ok === false || c.tasa_ok === false)
    const faltaCompras = cfg?.autoriza_compras && !sel.autorizada_compras_at
    const faltaJefe = cfg?.autoriza_jefe && !sel.autorizada_jefe_at
    const puedeAplicar = sel.estatus !== 'aplicada' && sel.estatus !== 'rechazada'
      && (!hayDif || sel.estatus === 'autorizada')

    return (
      <div style={S.wrap}>
        <button style={S.volver} onClick={() => { setVista('lista'); setError('') }}>&larr; Volver a facturas</button>
        <div style={S.top}>
          <div>
            <h2 style={S.h2}>Factura {sel.folio_proveedor}</h2>
            <p style={S.sub}>
              {provDe(sel.proveedor_id)?.nombre} · {sel.fecha}
              {sel.fecha_vencimiento ? ` · vence ${sel.fecha_vencimiento}` : ''}
              {' · '}{fmt(sel.total)} {sel.moneda}
              {sel.tipo_cambio ? ` · TC ${sel.tipo_cambio}` : ''}
            </p>
          </div>
          <span style={{ ...S.pill, background: est.bg, color: est.c }}>{est.t}</span>
        </div>
        {error && <p style={S.err}>{error}</p>}
        {exito && <p style={S.ok}>{exito}</p>}

        <div style={S.card}>
          <p style={S.cardTit}>Cotejo contra la orden y el recibo</p>
          <div style={S.tabla}>
            <div style={S.th}>
              <span style={{ flex: 1 }}>Articulo</span>
              <span style={{ width: 120 }}>Recibo / OC</span>
              <span style={{ width: 170 }}>Cantidad</span>
              <span style={{ width: 170 }}>Precio</span>
              <span style={{ width: 150 }}>Tipo de cambio</span>
              <span style={{ flex: 1 }}>Resultado</span>
            </div>
            {cotejo.map(c => (
              <div key={c.factura_linea_id} style={S.tr}>
                <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{c.articulo_codigo}</span>
                <span style={{ width: 120, fontSize: 11.5, color: '#64748b' }}>{c.recibo_folio}<br />{c.oc_folio}</span>
                <span style={{ width: 170, fontSize: 12.5, color: c.cantidad_ok === false ? '#b91c1c' : '#334155' }}>
                  {fmt(c.cantidad_facturada)} vs {fmt(c.cantidad_recibida)} recibidas
                  {c.cantidad_ok === false && <b> ({Number(c.dif_cantidad) > 0 ? '+' : ''}{fmt(c.dif_cantidad)})</b>}
                </span>
                <span style={{ width: 170, fontSize: 12.5, color: c.precio_ok === false ? '#b91c1c' : '#334155' }}>
                  {fmt(c.precio_factura)} vs {c.precio_orden != null ? fmt(c.precio_orden) : '—'} de orden
                  {c.precio_ok === false && <b> ({Number(c.dif_precio) > 0 ? '+' : ''}{fmt(c.dif_precio)})</b>}
                </span>
                <span style={{ width: 150, fontSize: 12.5, color: c.tasa_ok === false ? '#b45309' : '#334155' }}>
                  {c.tasa_factura ? `${c.tasa_factura} vs ${c.tasa_recibo || '—'}` : '—'}
                </span>
                <span style={{ flex: 1, fontSize: 12, color: c.motivo === 'cuadra' ? '#16a34a' : '#b45309' }}>{c.motivo}</span>
              </div>
            ))}
          </div>

          {hayDif && (
            <div style={S.avisoDif}>
              <b>Esta factura no cuadra.</b> Revisa arriba que renglon y por que. Una diferencia de tipo de
              cambio no es un error del proveedor: es la variacion entre el dia que se recibio y el dia que se
              facturo, y al aplicar manda la de la factura, que es lo que se paga.
              {' '}Las diferencias de cantidad o de precio si son para reclamar antes de aplicar.
            </div>
          )}
        </div>

        <div style={S.card}>
          <p style={S.cardTit}>Que sigue</p>
          {sel.estatus === 'aplicada' ? (
            <p style={S.ayuda}>
              Ya aplicada. Los costos de sus lotes quedaron firmes con el precio y el tipo de cambio de esta
              factura, y con eso se valua el inventario.
            </p>
          ) : sel.estatus === 'rechazada' ? (
            <p style={S.ayuda}>Rechazada. No toco ningun costo.</p>
          ) : (
            <>
              {hayDif && (
                <p style={S.ayuda}>
                  Con diferencias, hace falta autorizar antes de aplicar. Segun la configuracion firman:{' '}
                  <b>{[cfg?.autoriza_compras && 'Compras', cfg?.autoriza_jefe && 'Jefe directo'].filter(Boolean).join(' y ') || 'nadie'}</b>.
                  {!cfg?.autoriza_compras && !cfg?.autoriza_jefe && ' Como nadie tiene que firmar, se puede aplicar directo.'}
                </p>
              )}
              <div style={S.acciones}>
                {hayDif && puedeAprobar && cfg?.autoriza_compras && faltaCompras && (
                  <button style={S.botonSec} onClick={() => autorizar('compras')}>Autorizar como Compras</button>
                )}
                {hayDif && puedeAprobar && cfg?.autoriza_jefe && faltaJefe && (
                  <button style={S.botonSec} onClick={() => autorizar('jefe')}>Autorizar como Jefe directo</button>
                )}
                {puedeAprobar && <button style={S.botonRojo} onClick={rechazar}>Rechazar</button>}
                <button style={puedeAplicar ? S.boton : S.botonOff} disabled={!puedeAplicar || proc} onClick={aplicar}>
                  {proc ? 'Aplicando...' : 'Aplicar y congelar costos'}
                </button>
              </div>
              {!puedeAplicar && hayDif && (
                <p style={S.ayudaMal}>
                  No se puede aplicar mientras las diferencias no esten autorizadas. El candado vive en la base:
                  aplicar es lo que mueve el valor del inventario.
                </p>
              )}
            </>
          )}
          {(sel.autorizada_compras_at || sel.autorizada_jefe_at) && (
            <p style={S.ayuda}>
              Firmas: {sel.autorizada_compras_at ? `Compras el ${String(sel.autorizada_compras_at).split('T')[0]}` : ''}
              {sel.autorizada_compras_at && sel.autorizada_jefe_at ? ' · ' : ''}
              {sel.autorizada_jefe_at ? `Jefe el ${String(sel.autorizada_jefe_at).split('T')[0]}` : ''}
            </p>
          )}
          {sel.notas && <p style={S.ayuda}>Notas: {sel.notas}</p>}
        </div>
      </div>
    )
  }

  // ======================= LISTA =======================
  return (
    <div style={S.wrap}>
      <div style={S.top}>
        <div>
          <h2 style={S.h2}>Facturas de proveedor</h2>
          <p style={S.sub}>
            La orden dice que pediste, el recibo dice que llego, y la factura dice que te cobran. Aqui se
            comparan los tres y se deja firme el costo de lo que entro al almacen.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={S.expBtn} onClick={() => exportarExcel('facturas_proveedor', COLS, facturas)}>Excel</button>
          <button style={S.expBtn} onClick={() => imprimirTablaPDF('Facturas de proveedor', COLS, facturas)}>PDF</button>
          {puedeCrear && <button style={S.boton} onClick={abrirNueva}>+ Nueva factura</button>}
        </div>
      </div>
      {error && <p style={S.err}>{error}</p>}
      {exito && <p style={S.ok}>{exito}</p>}

      <div style={S.tabla}>
        <div style={S.th}>
          <span style={{ width: 120 }}>Folio</span>
          <span style={{ flex: 2 }}>Proveedor</span>
          <span style={{ width: 110 }}>Fecha</span>
          <span style={{ width: 110 }}>Vence</span>
          <span style={{ width: 140 }}>Total</span>
          <span style={{ width: 120 }}>Estatus</span>
          <span style={{ width: 90 }}></span>
        </div>
        {facturas.length === 0 && (
          <p style={S.info}>
            Todavia no hay facturas capturadas. Se parte de los recibos: registra primero la entrada del
            material y despues la factura que lo cobra.
          </p>
        )}
        {facturas.map(f => {
          const e = ESTATUS[f.estatus] || {}
          return (
            <div key={f.id} style={S.tr}>
              <span style={{ width: 120, fontWeight: 600, color: '#2563eb' }}>{f.folio_proveedor}</span>
              <span style={{ flex: 2 }}>{provDe(f.proveedor_id)?.nombre}</span>
              <span style={{ width: 110, color: '#64748b' }}>{f.fecha}</span>
              <span style={{ width: 110, color: '#64748b' }}>{f.fecha_vencimiento || '—'}</span>
              <span style={{ width: 140, fontWeight: 600 }}>{fmt(f.total)} {f.moneda}</span>
              <span style={{ width: 120 }}><span style={{ ...S.pill, background: e.bg, color: e.c }}>{e.t}</span></span>
              <span style={{ width: 90 }}>
                <button style={S.btnMini} onClick={() => abrirDetalle(f.id)}>Ver</button>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const S = {
  wrap: { padding: 24 },
  top: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16, flexWrap: 'wrap' },
  h2: { fontSize: 18, fontWeight: 600, color: '#1a1a2e', margin: 0 },
  sub: { fontSize: 13, color: '#64748b', margin: '6px 0 0', maxWidth: 880, lineHeight: 1.6 },
  volver: { padding: '6px 14px', background: '#fff', color: '#2563eb', border: '1px solid #2563eb', borderRadius: 6, fontSize: 13, cursor: 'pointer', marginBottom: 14 },
  card: { background: '#fff', borderRadius: 10, padding: 18, marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  cardTit: { fontSize: 14, fontWeight: 600, color: '#1a1a2e', margin: '0 0 8px' },
  fila: { display: 'flex', gap: 14, marginBottom: 12, flexWrap: 'wrap' },
  campo: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 150 },
  label: { fontSize: 12, fontWeight: 500, color: '#444' },
  input: { padding: '9px 12px', borderRadius: 7, border: '1px solid #ddd', fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box' },
  inputMini: { padding: '5px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12.5, width: 100 },
  ayuda: { fontSize: 11.5, color: '#94a3b8', lineHeight: 1.6, marginTop: 3, display: 'block' },
  ayudaMal: { fontSize: 12, color: '#b45309', lineHeight: 1.6, marginTop: 8 },
  reciboTit: { fontSize: 12.5, fontWeight: 600, color: '#334155', margin: '0 0 6px' },
  tabla: { background: '#fff', borderRadius: 10, overflow: 'hidden', border: '1px solid #eef2f7' },
  th: { display: 'flex', gap: 10, padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' },
  tr: { display: 'flex', gap: 10, padding: '10px 14px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: 13.5 },
  trSel: { display: 'flex', gap: 10, padding: '10px 14px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: 13.5, background: '#eff6ff' },
  totales: { display: 'flex', gap: 24, justifyContent: 'flex-end', alignItems: 'center', padding: '12px 0', fontSize: 14, color: '#334155' },
  acciones: { display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' },
  boton: { padding: '9px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 7, fontSize: 14, fontWeight: 500, cursor: 'pointer' },
  botonOff: { padding: '9px 20px', background: '#e2e8f0', color: '#94a3b8', border: 'none', borderRadius: 7, fontSize: 14, cursor: 'not-allowed' },
  botonSec: { padding: '9px 18px', background: '#fff', color: '#2563eb', border: '1px solid #2563eb', borderRadius: 7, fontSize: 13.5, cursor: 'pointer' },
  botonGris: { padding: '9px 20px', background: '#e2e8f0', color: '#444', border: 'none', borderRadius: 7, fontSize: 14, cursor: 'pointer' },
  botonRojo: { padding: '9px 18px', background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 7, fontSize: 13.5, cursor: 'pointer' },
  btnMini: { padding: '4px 12px', background: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 12, cursor: 'pointer' },
  expBtn: { padding: '8px 14px', background: '#fff', color: '#475569', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12.5, cursor: 'pointer' },
  pill: { padding: '3px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' },
  avisoDif: { background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '12px 14px', fontSize: 12.5, color: '#92400e', marginTop: 12, lineHeight: 1.6 },
  avisoOff: { background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 8, padding: '14px 16px', fontSize: 13, color: '#475569', lineHeight: 1.6, maxWidth: 880 },
  info: { fontSize: 13, color: '#94a3b8', padding: '18px', margin: 0, lineHeight: 1.6 },
  err: { color: '#dc2626', fontSize: 13, marginBottom: 12 },
  ok: { color: '#16a34a', fontSize: 13, marginBottom: 12 },
}
