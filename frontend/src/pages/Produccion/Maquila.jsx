import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Capa 9 - Maquila (programa de subcontratacion).
// La OM es un PROGRAMA (release al maquilador) con lineas firme/forecast.
// El firme se convierte en OC (subcontrato) y se le da seguimiento como
// backorders (pendiente por entregar) y entregas futuras.
// Envio de free-issue (fase 3) y recepcion del PT + backflush + shots (fase 4).
const fmt = (n) => Number(n ?? 0).toLocaleString('es-MX', { maximumFractionDigits: 3 })
const hoy = () => new Date().toISOString().split('T')[0]
const fFecha = (f) => f ? new Date(f + 'T00:00:00').toLocaleDateString('es-MX') : '-'

export default function Maquila() {
  const { perfil, tienePermiso } = useAuth()
  const puedeEditar = tienePermiso('prod_maquila', 'editar') || tienePermiso('prod_maquila', 'crear')

  const [vista, setVista] = useState('lista')
  const [programas, setProgramas] = useState([])
  const [omSel, setOmSel] = useState(null)
  const [lineas, setLineas] = useState([])
  const [materiales, setMateriales] = useState([])
  const [ocs, setOcs] = useState([])
  const [articulos, setArticulos] = useState([])
  const [loading, setLoading] = useState(true)
  const [proc, setProc] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [existencias, setExistencias] = useState([])
  const [lotes, setLotes] = useState([])
  const [almacenes, setAlmacenes] = useState([])
  const [saldo, setSaldo] = useState([])
  const [envCant, setEnvCant] = useState({})
  const [ocLineas, setOcLineas] = useState([])
  const [cavidades, setCavidades] = useState([])
  const [rec, setRec] = useState({ cantidad: '', almacen_id: '' })

  useEffect(() => { cargar() }, [])

  const cargar = async () => {
    setLoading(true)
    const emp = perfil.empresa_id
    const [pr, ar, ex, lo, al, cv] = await Promise.all([
      supabase.from('ordenes_maquila').select('*, maq:proveedores(nombre), art:articulos(codigo_interno, descripcion), molde:moldes(clave)').eq('empresa_id', emp).order('id', { ascending: false }),
      supabase.from('articulos').select('id, codigo_interno, descripcion, unidad_medida, costo, precio_maquila').eq('empresa_id', emp),
      supabase.from('existencias').select('*'),
      supabase.from('lotes').select('id, articulo_id, estatus_calidad, fecha, empresa_id').eq('empresa_id', emp),
      supabase.from('almacenes').select('*').eq('empresa_id', emp).eq('activo', true),
      supabase.from('molde_cavidades').select('molde_id, articulo_id, activa').eq('activa', true),
    ])
    setProgramas(pr.data || []); setArticulos(ar.data || [])
    setExistencias(ex.data || []); setLotes(lo.data || []); setAlmacenes(al.data || []); setCavidades(cv.data || [])
    setLoading(false)
  }

  const artDe = (id) => articulos.find(a => a.id === id)
  const loteDe = (id) => lotes.find(l => l.id === id)
  const almInternos = almacenes.filter(a => !a.es_virtual)
  const cavDe = (id) => cavidades.filter(c => c.articulo_id === id).length
  const asegurarVirtual = async () => {
    if (omSel?.almacen_maquila_id) return omSel.almacen_maquila_id
    const clave = `MAQ-${omSel.maquilador_id}`
    const exv = almacenes.find(a => a.es_virtual && a.clave === clave)
    if (exv) return exv.id
    const { data, error: e } = await supabase.from('almacenes').insert({ empresa_id: perfil.empresa_id, site_id: perfil.site_id, clave, nombre: `Maquila ${omSel.maq?.nombre || omSel.maquilador_id}`, activo: true, es_virtual: true }).select().single()
    if (e) throw e
    return data.id
  }
  const deducir = (articuloId, cantidad, almacenIds) => {
    let restante = Number(cantidad)
    const exs = existencias.filter(e => almacenIds.includes(e.almacen_id) && Number(e.cantidad) > 0)
      .filter(e => loteDe(e.lote_id)?.articulo_id === articuloId && loteDe(e.lote_id)?.estatus_calidad === 'liberado')
      .sort((a, b) => (loteDe(a.lote_id)?.fecha || '').localeCompare(loteDe(b.lote_id)?.fecha || ''))
    const tomados = []
    for (const e of exs) { if (restante <= 0.000001) break; const toma = Math.min(Number(e.cantidad), restante); tomados.push({ ex: e, toma }); restante -= toma }
    return { tomados, faltante: Math.max(0, restante) }
  }
  const sumarVirtual = async (loteId, almV, cantidad) => {
    const existe = existencias.find(e => e.lote_id === loteId && e.almacen_id === almV)
    if (existe) await supabase.from('existencias').update({ cantidad: Number(existe.cantidad) + Number(cantidad) }).eq('id', existe.id)
    else await supabase.from('existencias').insert({ lote_id: loteId, almacen_id: almV, ubicacion_id: null, cantidad: Number(cantidad) })
  }

  const RECIBIBLES_OC = ['aprobada', 'enviada_proveedor', 'confirmada', 'en_transito', 'recibida_parcial']
  const recibirProducto = async () => {
    setError(''); setExito('')
    const cant = Number(rec.cantidad)
    if (!(cant > 0)) { setError('Captura la cantidad recibida.'); return }
    if (!rec.almacen_id) { setError('Selecciona el almacen destino.'); return }
    const recibibles = ocs.filter(o => RECIBIBLES_OC.includes(o.estatus))
    if (recibibles.length === 0) { setError('No hay OC aprobada para recibir.'); return }
    setProc(true)
    try {
      const { data: codigo, error: ec } = await supabase.rpc('generar_lote_recibo', { p_empresa_id: perfil.empresa_id })
      if (ec) throw ec
      const { data: lote, error: el } = await supabase.from('lotes').insert({ empresa_id: perfil.empresa_id, articulo_id: omSel.articulo_id, codigo_lote: codigo, origen: 'maquila', estatus_calidad: 'retenido', creado_por: perfil.id }).select().single()
      if (el) throw el
      await supabase.from('existencias').insert({ lote_id: lote.id, almacen_id: Number(rec.almacen_id), ubicacion_id: null, cantidad: cant })
      await supabase.from('movimientos').insert({ empresa_id: perfil.empresa_id, articulo_id: omSel.articulo_id, lote_id: lote.id, tipo: 'entrada_maquila', almacen_destino_id: Number(rec.almacen_id), cantidad: cant, motivo: `Recibo maquila ${omSel.folio}`, usuario_id: perfil.id })
      const cav = cavDe(omSel.articulo_id) || 0
      const shots = cav > 0 ? Math.ceil(cant / cav) : 0
      await supabase.from('om_recibos').insert({ om_id: omSel.id, articulo_id: omSel.articulo_id, cantidad: cant, lote_id: lote.id, shots, recibido_por: perfil.id })
      if (omSel.almacen_maquila_id) {
        for (const m of materiales) {
          const consumo = cant * Number(m.cantidad_por_unidad)
          if (consumo <= 0) continue
          const { tomados } = deducir(m.articulo_id, consumo, [omSel.almacen_maquila_id])
          for (const t of tomados) {
            const nueva = Number(t.ex.cantidad) - t.toma
            if (nueva <= 0.000001) await supabase.from('existencias').delete().eq('id', t.ex.id)
            else await supabase.from('existencias').update({ cantidad: nueva }).eq('id', t.ex.id)
            await supabase.from('movimientos').insert({ empresa_id: perfil.empresa_id, articulo_id: m.articulo_id, lote_id: t.ex.lote_id, tipo: 'consumo_maquila', almacen_origen_id: omSel.almacen_maquila_id, cantidad: t.toma, motivo: `Backflush maquila ${omSel.folio}`, usuario_id: perfil.id })
          }
        }
      }
      let resto = cant
      const ols = ocLineas.filter(ol => recibibles.some(o => o.id === ol.oc_id)).sort((a, b) => a.oc_id - b.oc_id)
      for (const ol of ols) {
        if (resto <= 0.000001) break
        const pend = Number(ol.cantidad) - Number(ol.cantidad_recibida || 0)
        if (pend <= 0) continue
        const ap = Math.min(pend, resto)
        await supabase.from('oc_lineas').update({ cantidad_recibida: Number(ol.cantidad_recibida || 0) + ap }).eq('id', ol.id)
        resto -= ap
      }
      let resto2 = cant
      const firmeOrd = lineas.filter(l => l.tipo === 'firme' && Number(l.cantidad_oc) > Number(l.cantidad_recibida)).sort((a, b) => (a.fecha_requerida || '').localeCompare(b.fecha_requerida || ''))
      for (const l of firmeOrd) {
        if (resto2 <= 0.000001) break
        const pend = Number(l.cantidad_oc) - Number(l.cantidad_recibida)
        const ap = Math.min(pend, resto2)
        await supabase.from('om_lineas').update({ cantidad_recibida: Number(l.cantidad_recibida) + ap }).eq('id', l.id)
        resto2 -= ap
      }
      for (const o of recibibles) {
        const { data: lref } = await supabase.from('oc_lineas').select('cantidad, cantidad_recibida').eq('oc_id', o.id)
        const completa = (lref || []).every(x => Number(x.cantidad_recibida || 0) >= Number(x.cantidad))
        await supabase.from('ordenes_compra').update({ estatus: completa ? 'recibida' : 'recibida_parcial' }).eq('id', o.id)
      }
      setExito(`Recibidas ${fmt(cant)} pzas de ${omSel.art?.codigo_interno} (lote ${codigo}, RETENIDO, lo libera Calidad). ${shots > 0 ? `+${fmt(shots)} shots al molde.` : ''}`)
      await cargar(); await abrirDetalle(omSel)
    } catch (err) { setError('Error al recibir: ' + err.message) }
    setProc(false)
  }

  const totalesDe = async (omId) => {
    const { data } = await supabase.from('om_lineas').select('tipo, cantidad, cantidad_oc, cantidad_recibida, vigente').eq('om_id', omId).eq('vigente', true)
    const t = { firme: 0, forecast: 0, enOC: 0, recibido: 0, backorder: 0 }
    for (const l of (data || [])) {
      if (l.tipo === 'firme') t.firme += Number(l.cantidad); else t.forecast += Number(l.cantidad)
      t.enOC += Number(l.cantidad_oc); t.recibido += Number(l.cantidad_recibida)
      t.backorder += Math.max(0, Number(l.cantidad_oc) - Number(l.cantidad_recibida))
    }
    return t
  }

  const abrirDetalle = async (om) => {
    setError(''); setExito('')
    const [l, m, o] = await Promise.all([
      supabase.from('om_lineas').select('*').eq('om_id', om.id).eq('vigente', true).order('fecha_requerida'),
      supabase.from('om_materiales').select('*').eq('om_id', om.id),
      supabase.from('ordenes_compra').select('*').eq('om_id', om.id).order('id', { ascending: false }),
    ])
    setLineas(l.data || []); setMateriales(m.data || []); setOcs(o.data || [])
    const ocIds = (o.data || []).map(x => x.id)
    const { data: ols } = ocIds.length ? await supabase.from('oc_lineas').select('*').in('oc_id', ocIds) : { data: [] }
    setOcLineas(ols || [])
    setRec({ cantidad: '', almacen_id: '' })
    const { data: sal } = await supabase.rpc('maquila_saldo', { p_om: om.id })
    setSaldo(sal || [])
    const firmeTot = (l.data || []).filter(x => x.tipo === 'firme').reduce((a, x) => a + Number(x.cantidad), 0)
    const ec = {}
    for (const mat of (m.data || [])) ec[mat.id] = Math.max(0, firmeTot * Number(mat.cantidad_por_unidad) - Number(mat.cantidad_enviada || 0))
    setEnvCant(ec)
    setOmSel(om); setVista('detalle')
  }

  const pendConv = (l) => Math.max(0, Number(l.cantidad) - Number(l.cantidad_oc))         // firme por convertir a OC
  const pendRec = (l) => Math.max(0, Number(l.cantidad_oc) - Number(l.cantidad_recibida)) // en OC por recibir (backorder)

  // ---- Convertir el firme pendiente en una OC de subcontrato ----
  const convertirFirme = async () => {
    setError(''); setExito('')
    const firmePend = lineas.filter(l => l.tipo === 'firme' && pendConv(l) > 0)
    if (firmePend.length === 0) { setError('No hay firme pendiente por convertir a OC.'); return }
    setProc(true)
    try {
      const art = artDe(omSel.articulo_id)
      const precio = Number(art?.precio_maquila ?? art?.costo ?? 0)
      const totalQty = firmePend.reduce((s, l) => s + pendConv(l), 0)
      const fechaEntrega = firmePend.reduce((min, l) => (!min || (l.fecha_requerida && l.fecha_requerida < min) ? l.fecha_requerida : min), null)
      const subtotal = totalQty * precio, iva = subtotal * 0.16, total = subtotal + iva
      const folio = `OC-SUB-${Date.now().toString().slice(-8)}`
      const { data: oc, error: e1 } = await supabase.from('ordenes_compra').insert({
        folio, empresa_id: perfil.empresa_id, site_id: perfil.site_id, proveedor_id: omSel.maquilador_id,
        comprador_id: perfil.id, fecha_emision: new Date().toISOString(), fecha_entrega_estimada: fechaEntrega,
        moneda: 'MXN', subtotal, iva, total, estatus: 'aprobacion_gerente_logistica', tipo: 'subcontrato', om_id: omSel.id,
        notas: `Subcontrato maquila - programa ${omSel.folio}`,
      }).select().single()
      if (e1) throw e1
      const { error: e2 } = await supabase.from('oc_lineas').insert({
        oc_id: oc.id, articulo_id: omSel.articulo_id, descripcion: `Maquila ${art?.codigo_interno || ''}`.trim(),
        cantidad: totalQty, unidad_medida: art?.unidad_medida || 'PZA', precio_unitario: precio,
        descuento: 0, iva_porcentaje: 16, subtotal, cantidad_recibida: 0,
      })
      if (e2) throw e2
      for (const l of firmePend) {
        await supabase.from('om_lineas').update({ cantidad_oc: Number(l.cantidad) }).eq('id', l.id)
      }
      setExito(`OC ${folio} creada (${fmt(totalQty)} pzas de ${art?.codigo_interno}). Entra a aprobacion: Gerente de Logistica -> Compras (precios) -> Gerente de Compras -> compradora la envia.`)
      await abrirDetalle(omSel)
    } catch (err) { setError('Error al generar OC: ' + err.message) }
    setProc(false)
  }

  const toggleEnviar = async (m) => {
    await supabase.from('om_materiales').update({ enviar: !m.enviar }).eq('id', m.id)
    setMateriales(ms => ms.map(x => x.id === m.id ? { ...x, enviar: !x.enviar } : x))
  }

  const enviarMaterial = async () => {
    setError(''); setExito('')
    const mats = materiales.filter(m => m.enviar && Number(envCant[m.id]) > 0)
    if (mats.length === 0) { setError('No hay material marcado con cantidad a enviar.'); return }
    setProc(true)
    try {
      const almV = await asegurarVirtual()
      const internos = almInternos.map(a => a.id)
      for (const m of mats) {
        const qty = Number(envCant[m.id])
        const { tomados, faltante } = deducir(m.articulo_id, qty, internos)
        if (faltante > 0.001) throw new Error(`${artDe(m.articulo_id)?.codigo_interno}: faltan ${fmt(faltante)} en almacenes internos (liberado).`)
        for (const t of tomados) {
          const nueva = Number(t.ex.cantidad) - t.toma
          if (nueva <= 0.000001) await supabase.from('existencias').delete().eq('id', t.ex.id)
          else await supabase.from('existencias').update({ cantidad: nueva }).eq('id', t.ex.id)
          await sumarVirtual(t.ex.lote_id, almV, t.toma)
          await supabase.from('movimientos').insert({ empresa_id: perfil.empresa_id, articulo_id: m.articulo_id, lote_id: t.ex.lote_id, tipo: 'salida_maquila', almacen_origen_id: t.ex.almacen_id, ubicacion_origen_id: t.ex.ubicacion_id || null, almacen_destino_id: almV, cantidad: t.toma, motivo: `Free-issue maquila ${omSel.folio}`, usuario_id: perfil.id })
        }
        await supabase.from('om_materiales').update({ cantidad_enviada: Number(m.cantidad_enviada || 0) + qty }).eq('id', m.id)
      }
      if (!omSel.almacen_maquila_id) await supabase.from('ordenes_maquila').update({ almacen_maquila_id: almV }).eq('id', omSel.id)
      setExito('Material enviado al almacen del maquilador (free-issue).')
      await cargar()
      await abrirDetalle({ ...omSel, almacen_maquila_id: omSel.almacen_maquila_id || almV })
    } catch (err) { setError('Error al enviar: ' + err.message) }
    setProc(false)
  }

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>

  // ---------- DETALLE ----------
  if (vista === 'detalle' && omSel) {
    const firme = lineas.filter(l => l.tipo === 'firme')
    const forecast = lineas.filter(l => l.tipo === 'forecast')
    const firmePendConv = firme.reduce((s, l) => s + pendConv(l), 0)
    const backorders = lineas.filter(l => pendRec(l) > 0)
    const futuras = lineas.filter(l => (l.fecha_requerida || '') >= hoy() && (Number(l.cantidad) - Number(l.cantidad_recibida)) > 0)
    return (
      <div style={styles.container} className="aparecer">
        <button style={styles.volver} onClick={() => { setVista('lista'); cargar() }}>&larr; Volver a maquila</button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={styles.titulo}>{omSel.folio} · {omSel.maq?.nombre}</h2>
          <span style={badge(omSel.estatus)}>{omSel.estatus.replace(/_/g, ' ')}</span>
        </div>
        <p style={styles.sub}>Programa de maquila de <b>{omSel.art?.codigo_interno}</b> {omSel.molde?.clave ? <>· molde <b>{omSel.molde.clave}</b></> : ''}</p>
        {error && <p style={styles.error}>{error}</p>}
        {exito && <p style={styles.exito}>{exito}</p>}

        <div style={styles.tarjeta}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={styles.h3}>Programa (firme / forecast)</h3>
            {puedeEditar && firmePendConv > 0 && (
              <button style={styles.boton} onClick={convertirFirme} disabled={proc}>{proc ? 'Generando...' : `Convertir firme a OC (${fmt(firmePendConv)})`}</button>
            )}
          </div>
          <div style={styles.tabla}>
            <div style={styles.th}><span style={{ flex: 1 }}>Fecha</span><span style={{ flex: 1 }}>Tipo</span><span style={{ flex: 1, textAlign: 'right' }}>Cantidad</span><span style={{ flex: 1, textAlign: 'right' }}>En OC</span><span style={{ flex: 1, textAlign: 'right' }}>Recibido</span><span style={{ flex: 1, textAlign: 'right' }}>Pend. entregar</span></div>
            {lineas.map(l => (
              <div key={l.id} style={styles.tr}>
                <span style={{ flex: 1 }}>{fFecha(l.fecha_requerida)}</span>
                <span style={{ flex: 1 }}><span style={l.tipo === 'firme' ? styles.pillFirme : styles.pillFcst}>{l.tipo}</span></span>
                <span style={{ flex: 1, textAlign: 'right' }}>{fmt(l.cantidad)}</span>
                <span style={{ flex: 1, textAlign: 'right', color: '#2563eb' }}>{fmt(l.cantidad_oc)}</span>
                <span style={{ flex: 1, textAlign: 'right', color: '#16a34a' }}>{fmt(l.cantidad_recibida)}</span>
                <span style={{ flex: 1, textAlign: 'right', fontWeight: 600, color: pendRec(l) > 0 && (l.fecha_requerida || '') < hoy() ? '#dc2626' : '#334155' }}>{fmt(pendRec(l))}</span>
              </div>
            ))}
            {lineas.length === 0 && <div style={styles.vacio}>Sin lineas. Corre el MRP y genera desde la bandeja.</div>}
          </div>
          <p style={styles.hint}>Firme total: <b>{fmt(firme.reduce((s, l) => s + Number(l.cantidad), 0))}</b> · Forecast: <b>{fmt(forecast.reduce((s, l) => s + Number(l.cantidad), 0))}</b>. El firme se compromete con una OC; el forecast es visibilidad.</p>
        </div>

        <div style={styles.tarjeta}>
          <h3 style={styles.h3}>Seguimiento de entregas</h3>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '280px' }}>
              <p style={styles.subh}>Backorders (en OC, por entregar)</p>
              <div style={styles.tabla}>
                <div style={styles.th}><span style={{ flex: 1 }}>Fecha</span><span style={{ flex: 1, textAlign: 'right' }}>Pendiente</span><span style={{ flex: 1, textAlign: 'center' }}>Estado</span></div>
                {backorders.length === 0 && <div style={styles.vacio}>Sin backorders.</div>}
                {backorders.map(l => (
                  <div key={l.id} style={styles.tr}><span style={{ flex: 1 }}>{fFecha(l.fecha_requerida)}</span><span style={{ flex: 1, textAlign: 'right' }}>{fmt(pendRec(l))}</span>
                    <span style={{ flex: 1, textAlign: 'center' }}>{(l.fecha_requerida || '') < hoy() ? <span style={styles.pillVenc}>vencida</span> : <span style={styles.pillOk}>en tiempo</span>}</span></div>
                ))}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: '280px' }}>
              <p style={styles.subh}>Entregas futuras (firme + forecast)</p>
              <div style={styles.tabla}>
                <div style={styles.th}><span style={{ flex: 1 }}>Fecha</span><span style={{ flex: 1 }}>Tipo</span><span style={{ flex: 1, textAlign: 'right' }}>Pendiente</span></div>
                {futuras.length === 0 && <div style={styles.vacio}>Sin entregas futuras.</div>}
                {futuras.map(l => (
                  <div key={l.id} style={styles.tr}><span style={{ flex: 1 }}>{fFecha(l.fecha_requerida)}</span><span style={{ flex: 1 }}>{l.tipo}</span><span style={{ flex: 1, textAlign: 'right' }}>{fmt(Number(l.cantidad) - Number(l.cantidad_recibida))}</span></div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div style={styles.tarjeta}>
          <h3 style={styles.h3}>OCs de subcontrato</h3>
          <div style={styles.tabla}>
            <div style={styles.th}><span style={{ flex: 1 }}>Folio</span><span style={{ flex: 1 }}>Estatus</span><span style={{ flex: 1, textAlign: 'right' }}>Total</span><span style={{ flex: 1.4 }}>Entrega est.</span></div>
            {ocs.length === 0 && <div style={styles.vacio}>Aun no hay OC. Convierte el firme.</div>}
            {ocs.map(o => (
              <div key={o.id} style={styles.tr}><span style={{ flex: 1, fontWeight: 600 }}>{o.folio}</span><span style={{ flex: 1 }}>{(o.estatus || '').replace(/_/g, ' ')}</span><span style={{ flex: 1, textAlign: 'right' }}>${fmt(o.total)}</span><span style={{ flex: 1.4 }}>{fFecha(o.fecha_entrega_estimada)}</span></div>
            ))}
          </div>
          <p style={styles.hint}>El PT se recibe contra estas OC en la seccion de abajo (entra como PT).</p>
        </div>

        {puedeEditar && ocs.some(o => RECIBIBLES_OC.includes(o.estatus)) && (
        <div style={styles.tarjeta}>
          <h3 style={styles.h3}>Recibir producto terminado (contra OC)</h3>
          <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}><label style={styles.lbl}>Cantidad recibida *</label><input type="number" min="0" style={styles.input} value={rec.cantidad} onChange={e => setRec({ ...rec, cantidad: e.target.value })} /></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}><label style={styles.lbl}>Almacen destino *</label><select style={styles.input} value={rec.almacen_id} onChange={e => setRec({ ...rec, almacen_id: e.target.value })}><option value="">Selecciona...</option>{almInternos.map(a => <option key={a.id} value={a.id}>{a.clave} - {a.nombre}</option>)}</select></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}><label style={styles.lbl}>Shots estimados</label><div style={styles.loteAuto}>{(() => { const c = cavDe(omSel.articulo_id); return c > 0 && rec.cantidad ? `${fmt(Math.ceil(Number(rec.cantidad) / c))} (cav ${c})` : c > 0 ? `cav ${c}` : 'sin molde' })()}</div></div>
            <button style={styles.boton} onClick={recibirProducto} disabled={proc}>{proc ? 'Procesando...' : 'Recibir (RETENIDO)'}</button>
          </div>
          <p style={styles.hint}>Entra como PT (lote retenido, lo libera Calidad). Hace backflush del free-issue desde el maquilador, suma shots al molde y descuenta las lineas del programa (cierra backorders).</p>
        </div>
        )}

        <div style={styles.tarjeta}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={styles.h3}>Material a suministrar (free-issue por BOM)</h3>
            {puedeEditar && materiales.some(m => m.enviar) && (<button style={styles.boton} onClick={enviarMaterial} disabled={proc}>{proc ? 'Enviando...' : 'Enviar material'}</button>)}
          </div>
          <div style={styles.tabla}>
            <div style={styles.th}><span style={{ flex: 2 }}>Componente</span><span style={{ flex: 1, textAlign: 'right' }}>Por unidad</span><span style={{ flex: 1, textAlign: 'right' }}>Enviado</span><span style={{ flex: 1.1, textAlign: 'right' }}>A enviar</span><span style={{ flex: 0.7, textAlign: 'center' }}>Free-issue</span></div>
            {materiales.map(m => (
              <div key={m.id} style={styles.tr}>
                <span style={{ flex: 2 }}>{artDe(m.articulo_id)?.codigo_interno} <span style={{ color: '#94a3b8' }}>- {artDe(m.articulo_id)?.descripcion}</span></span>
                <span style={{ flex: 1, textAlign: 'right' }}>{fmt(m.cantidad_por_unidad)} {m.unidad_medida}</span>
                <span style={{ flex: 1, textAlign: 'right', color: '#16a34a' }}>{fmt(m.cantidad_enviada)}</span>
                <span style={{ flex: 1.1, textAlign: 'right' }}>{m.enviar ? <input type="number" min="0" value={envCant[m.id] ?? ''} disabled={!puedeEditar} onChange={e => setEnvCant({ ...envCant, [m.id]: e.target.value })} style={{ ...styles.inputMini, textAlign: 'right' }} /> : <span style={{ color: '#cbd5e1' }}>-</span>}</span>
                <span style={{ flex: 0.7, textAlign: 'center' }}><input type="checkbox" checked={!!m.enviar} disabled={!puedeEditar} onChange={() => toggleEnviar(m)} /></span>
              </div>
            ))}
            {materiales.length === 0 && <div style={styles.vacio}>Sin BOM (el PT no consume componentes suministrados).</div>}
          </div>
          <p style={styles.hint}>Desmarca "free-issue" en los componentes que ponga el maquilador. Sugerido = firme x BOM (menos lo ya enviado). Se descuenta de tu almacen (liberado, FIFO) y pasa al almacen del maquilador.</p>
        </div>

        <div style={styles.tarjeta}>
          <h3 style={styles.h3}>Conciliacion de material (saldo en maquila)</h3>
          <div style={styles.tabla}>
            <div style={styles.th}><span style={{ flex: 2 }}>Componente</span><span style={{ flex: 1, textAlign: 'right' }}>Enviado</span><span style={{ flex: 1, textAlign: 'right' }}>Consumo teorico</span><span style={{ flex: 1, textAlign: 'right' }}>Saldo</span><span style={{ flex: 1, textAlign: 'right' }}>En maquila</span></div>
            {saldo.length === 0 && <div style={styles.vacio}>Sin envios aun.</div>}
            {saldo.map((sv, i) => { const merma = Math.abs(Number(sv.saldo) - Number(sv.existencia_virtual)) > 0.01; return (
              <div key={i} style={styles.tr}>
                <span style={{ flex: 2 }}>{artDe(sv.articulo_id)?.codigo_interno}</span>
                <span style={{ flex: 1, textAlign: 'right' }}>{fmt(sv.enviado)}</span>
                <span style={{ flex: 1, textAlign: 'right' }}>{fmt(sv.consumo_teorico)}</span>
                <span style={{ flex: 1, textAlign: 'right', fontWeight: 600 }}>{fmt(sv.saldo)}</span>
                <span style={{ flex: 1, textAlign: 'right', color: merma ? '#dc2626' : '#16a34a' }}>{fmt(sv.existencia_virtual)}</span>
              </div>) })}
          </div>
          <p style={styles.hint}>Saldo = enviado - (recibido x BOM). "En maquila" es la existencia real en el almacen del maquilador; si difiere hay merma a justificar. El consumo se aplica al recibir el PT (fase 4).</p>
        </div>
      </div>
    )
  }

  // ---------- LISTA ----------
  return (
    <div style={styles.container} className="aparecer">
      <div style={styles.encabezado}><h2 style={styles.titulo}>Maquila / Subcontratacion</h2></div>
      <p style={styles.sub}>Programas de maquila (release firme/forecast al maquilador). Se generan al correr el MRP y generar desde la bandeja, para articulos fabricados marcados "se maquila".</p>
      {error && <p style={styles.error}>{error}</p>}
      {programas.length === 0 ? <p style={{ color: '#666' }}>No hay programas de maquila.</p> : (
        <div style={styles.tabla}>
          <div style={styles.th}><span style={{ flex: 1 }}>Folio</span><span style={{ flex: 1.6 }}>Maquilador</span><span style={{ flex: 1.6 }}>Producto</span><span style={{ flex: 1 }}>Estatus</span><span style={{ width: '90px' }}></span></div>
          {programas.map(o => (
            <div key={o.id} style={styles.tr}>
              <span style={{ flex: 1, fontWeight: 600 }}>{o.folio}</span>
              <span style={{ flex: 1.6 }}>{o.maq?.nombre}</span>
              <span style={{ flex: 1.6 }}>{o.art?.codigo_interno} <span style={{ color: '#94a3b8' }}>{o.molde?.clave ? `· ${o.molde.clave}` : ''}</span></span>
              <span style={{ flex: 1 }}><span style={badge(o.estatus)}>{o.estatus.replace(/_/g, ' ')}</span></span>
              <span style={{ width: '90px', textAlign: 'right' }}><button style={styles.botonAccion} onClick={() => abrirDetalle(o)}>Abrir</button></span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function badge(s) {
  const base = { padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600 }
  const c = { borrador: ['#f1f5f9', '#64748b'], abierta: ['#ede9fe', '#7c3aed'], enviada: ['#dbeafe', '#2563eb'], en_proceso: ['#fef3c7', '#b45309'], recibida_parcial: ['#fef3c7', '#b45309'], cerrada: ['#dcfce7', '#16a34a'], cancelada: ['#fee2e2', '#b91c1c'] }[s] || ['#f1f5f9', '#64748b']
  return { ...base, backgroundColor: c[0], color: c[1] }
}

const styles = {
  container: { padding: '28px', maxWidth: '1040px' },
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: 0 },
  volver: { padding: '6px 14px', backgroundColor: 'transparent', color: '#2563eb', border: '1px solid #2563eb', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', marginBottom: '14px' },
  sub: { fontSize: '13px', color: '#64748b', margin: '6px 0 16px' },
  subh: { fontSize: '12px', fontWeight: 600, color: '#475569', margin: '0 0 6px' },
  h3: { fontSize: '14px', fontWeight: 600, color: '#1a1a2e', margin: '0 0 12px' },
  tarjeta: { backgroundColor: '#fff', borderRadius: '10px', padding: '18px 20px', marginBottom: '14px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  hint: { fontSize: '12px', color: '#94a3b8', marginTop: '8px', lineHeight: 1.5 },
  boton: { padding: '9px 16px', backgroundColor: '#9333ea', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' },
  botonAccion: { padding: '5px 12px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' },
  inputMini: { padding: '5px 8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '12px', outline: 'none', width: '110px' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', fontFamily: 'inherit', backgroundColor: '#fff' },
  lbl: { fontSize: '12px', fontWeight: '500', color: '#444' },
  loteAuto: { padding: '9px 12px', borderRadius: '7px', border: '1px dashed #cbd5e1', fontSize: '13px', color: '#64748b', backgroundColor: '#f8fafc' },
  tabla: { border: '1px solid #eef2f7', borderRadius: '8px', overflow: 'hidden' },
  th: { display: 'flex', padding: '9px 14px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tr: { display: 'flex', padding: '10px 14px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px' },
  vacio: { padding: '12px 14px', color: '#94a3b8', fontSize: '13px' },
  pillFirme: { padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 700, backgroundColor: '#dcfce7', color: '#15803d' },
  pillFcst: { padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 700, backgroundColor: '#e0f2fe', color: '#0369a1' },
  pillVenc: { padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 700, backgroundColor: '#fee2e2', color: '#b91c1c' },
  pillOk: { padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 700, backgroundColor: '#dcfce7', color: '#15803d' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
