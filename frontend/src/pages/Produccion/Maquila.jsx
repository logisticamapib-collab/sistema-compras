import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Capa 9 - Maquila / subcontratacion.
// OM -> enviar material propio a un almacen virtual del maquilador (salida_maquila)
// -> recibir producto (lote retenido) + consumo por BOM (consumo_maquila) + shots al molde.
const fmt = (n) => Number(n ?? 0).toLocaleString('es-MX', { maximumFractionDigits: 3 })
const hoy = () => new Date().toISOString().split('T')[0]
const fFecha = (f) => f ? new Date(f).toLocaleDateString('es-MX') : '-'

export default function Maquila() {
  const { perfil, tienePermiso } = useAuth()
  const puedeCrear = tienePermiso('prod_maquila', 'crear')
  const puedeEditar = tienePermiso('prod_maquila', 'editar')

  const [vista, setVista] = useState('lista')
  const [oms, setOms] = useState([])
  const [omSel, setOmSel] = useState(null)
  const [materiales, setMateriales] = useState([])
  const [recibos, setRecibos] = useState([])
  const [saldo, setSaldo] = useState([])

  const [maquiladores, setMaquiladores] = useState([])
  const [articulos, setArticulos] = useState([])
  const [bom, setBom] = useState([])
  const [cavidades, setCavidades] = useState([])
  const [almacenes, setAlmacenes] = useState([])
  const [existencias, setExistencias] = useState([])
  const [lotes, setLotes] = useState([])

  const [form, setForm] = useState(null)      // nueva OM
  const [rec, setRec] = useState({ cantidad: '', almacen_id: '' })
  const [loading, setLoading] = useState(true)
  const [proc, setProc] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  useEffect(() => { cargar() }, [])

  const cargar = async () => {
    setLoading(true)
    const emp = perfil.empresa_id
    const [om, mq, ar, bm, cv, al, ex, lo] = await Promise.all([
      supabase.from('ordenes_maquila').select('*, maq:proveedores(nombre), art:articulos(codigo_interno, descripcion), molde:moldes(clave)').eq('empresa_id', emp).order('id', { ascending: false }),
      supabase.from('proveedores').select('id, nombre').eq('empresa_id', emp).eq('es_maquilador', true).eq('activo', true),
      supabase.from('articulos').select('id, codigo_interno, descripcion, unidad_medida, origen').eq('empresa_id', emp),
      supabase.from('bom').select('*'),
      supabase.from('molde_cavidades').select('molde_id, articulo_id, activa').eq('activa', true),
      supabase.from('almacenes').select('*').eq('empresa_id', emp).eq('activo', true),
      supabase.from('existencias').select('*'),
      supabase.from('lotes').select('id, articulo_id, codigo_lote, estatus_calidad, fecha, empresa_id').eq('empresa_id', emp),
    ])
    setOms(om.data || []); setMaquiladores(mq.data || []); setArticulos(ar.data || [])
    setBom(bm.data || []); setCavidades(cv.data || []); setAlmacenes(al.data || [])
    setExistencias(ex.data || []); setLotes(lo.data || [])
    setLoading(false)
  }

  const artDe = (id) => articulos.find(a => a.id === id)
  const loteDe = (id) => lotes.find(l => l.id === id)
  const cavDe = (artId) => cavidades.filter(c => c.articulo_id === artId).length
  const moldeDeArticulo = (artId) => cavidades.find(c => c.articulo_id === artId)?.molde_id || null
  const almInternos = almacenes.filter(a => !a.es_virtual)

  // ---------- Nueva OM ----------
  const abrirNueva = () => { setError(''); setExito(''); setForm({ maquilador_id: '', articulo_id: '', cantidad_esperada: '', notas: '' }); setVista('nueva') }

  const bomDe = (artId) => bom.filter(b => b.articulo_padre_id === artId)

  const guardarNueva = async () => {
    setError('')
    const f = form
    if (!f.maquilador_id || !f.articulo_id || !(Number(f.cantidad_esperada) > 0)) { setError('Captura maquilador, articulo y cantidad.'); return }
    setProc(true)
    try {
      const molde = moldeDeArticulo(Number(f.articulo_id))
      const folio = `OM-${Date.now().toString().slice(-8)}`
      const { data: om, error: e1 } = await supabase.from('ordenes_maquila').insert({
        empresa_id: perfil.empresa_id, folio, maquilador_id: Number(f.maquilador_id), site_id: perfil.site_id,
        articulo_id: Number(f.articulo_id), cantidad_esperada: Number(f.cantidad_esperada), molde_id: molde,
        estatus: 'borrador', notas: f.notas || null, creado_por: perfil.id,
      }).select().single()
      if (e1) throw e1
      const mats = bomDe(Number(f.articulo_id)).map(b => ({
        om_id: om.id, articulo_id: b.componente_articulo_id,
        cantidad_por_unidad: Number(b.cantidad_por_unidad),
        cantidad_plan: Number(b.cantidad_por_unidad) * Number(f.cantidad_esperada),
        cantidad_enviada: Number(b.cantidad_por_unidad) * Number(f.cantidad_esperada),
        unidad_medida: b.unidad_medida || artDe(b.componente_articulo_id)?.unidad_medida || null,
      }))
      if (mats.length > 0) { const { error: e2 } = await supabase.from('om_materiales').insert(mats); if (e2) throw e2 }
      setExito(`OM ${folio} creada en borrador con ${mats.length} material(es) del BOM.`)
      await cargar(); await abrirDetalle(om.id)
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  // ---------- Detalle ----------
  const abrirDetalle = async (omId) => {
    setError(''); setExito(''); setRec({ cantidad: '', almacen_id: '' })
    const [m, r] = await Promise.all([
      supabase.from('om_materiales').select('*').eq('om_id', omId),
      supabase.from('om_recibos').select('*').eq('om_id', omId).order('id'),
    ])
    setMateriales(m.data || []); setRecibos(r.data || [])
    const { data: om } = await supabase.from('ordenes_maquila').select('*, maq:proveedores(nombre), art:articulos(codigo_interno, descripcion, unidad_medida), molde:moldes(clave)').eq('id', omId).single()
    setOmSel(om)
    await recalcSaldo(omId)
    setVista('detalle')
  }

  const recalcSaldo = async (omId) => {
    const { data } = await supabase.rpc('maquila_saldo', { p_om: omId })
    setSaldo(data || [])
  }

  const setMatCampo = (id, v) => setMateriales(ms => ms.map(m => m.id === id ? { ...m, cantidad_enviada: v } : m))

  // Almacen virtual del maquilador (uno por maquilador): buscar o crear
  const asegurarVirtual = async (maquiladorId, nombre) => {
    const clave = `MAQ-${maquiladorId}`
    const ex = almacenes.find(a => a.es_virtual && a.clave === clave)
    if (ex) return ex.id
    const { data, error: e } = await supabase.from('almacenes').insert({
      empresa_id: perfil.empresa_id, site_id: perfil.site_id, clave, nombre: `Maquila ${nombre || maquiladorId}`, activo: true, es_virtual: true,
    }).select().single()
    if (e) throw e
    return data.id
  }

  const deducir = async (articuloId, cantidad, almacenIds) => {
    let restante = Number(cantidad)
    const exs = existencias
      .filter(e => almacenIds.includes(e.almacen_id) && Number(e.cantidad) > 0)
      .filter(e => loteDe(e.lote_id)?.articulo_id === articuloId)
      .sort((a, b) => (loteDe(a.lote_id)?.fecha || '').localeCompare(loteDe(b.lote_id)?.fecha || ''))
    const tomados = []
    for (const e of exs) {
      if (restante <= 0.000001) break
      const toma = Math.min(Number(e.cantidad), restante)
      tomados.push({ ex: e, toma }); restante -= toma
    }
    return { tomados, faltante: Math.max(0, restante) }
  }

  const sumarVirtual = async (loteId, almacenVirtual, cantidad) => {
    const existente = existencias.find(e => e.lote_id === loteId && e.almacen_id === almacenVirtual)
    if (existente) await supabase.from('existencias').update({ cantidad: Number(existente.cantidad) + Number(cantidad) }).eq('id', existente.id)
    else await supabase.from('existencias').insert({ lote_id: loteId, almacen_id: almacenVirtual, ubicacion_id: null, cantidad: Number(cantidad) })
  }

  const enviarMaterial = async () => {
    setError(''); setExito('')
    const mats = materiales.filter(m => Number(m.cantidad_enviada) > 0)
    if (mats.length === 0) { setError('No hay materiales con cantidad a enviar.'); return }
    setProc(true)
    try {
      const almVirtual = await asegurarVirtual(omSel.maquilador_id, omSel.maq?.nombre)
      const internos = almInternos.map(a => a.id)
      for (const m of mats) {
        const { tomados, faltante } = await deducir(m.articulo_id, Number(m.cantidad_enviada), internos)
        if (faltante > 0.001) throw new Error(`${artDe(m.articulo_id)?.codigo_interno}: faltan ${fmt(faltante)} en almacenes internos (liberado).`)
        for (const t of tomados) {
          const nueva = Number(t.ex.cantidad) - t.toma
          if (nueva <= 0.000001) await supabase.from('existencias').delete().eq('id', t.ex.id)
          else await supabase.from('existencias').update({ cantidad: nueva }).eq('id', t.ex.id)
          await sumarVirtual(t.ex.lote_id, almVirtual, t.toma)
          await supabase.from('movimientos').insert({
            empresa_id: perfil.empresa_id, articulo_id: m.articulo_id, lote_id: t.ex.lote_id, tipo: 'salida_maquila',
            almacen_origen_id: t.ex.almacen_id, ubicacion_origen_id: t.ex.ubicacion_id || null,
            almacen_destino_id: almVirtual, cantidad: t.toma, motivo: `Envio a maquila OM ${omSel.folio}`, usuario_id: perfil.id,
          })
        }
        await supabase.from('om_materiales').update({ cantidad_enviada: Number(m.cantidad_enviada) }).eq('id', m.id)
      }
      const upd = { estatus: 'enviada', fecha_envio: new Date().toISOString(), almacen_maquila_id: almVirtual }
      await supabase.from('ordenes_maquila').update(upd).eq('id', omSel.id)
      if (omSel.molde_id) await supabase.from('moldes').update({ ubicacion_fisica: `Maquila ${omSel.maq?.nombre || ''}`.trim() }).eq('id', omSel.molde_id)
      setExito('Material enviado a maquila. Inventario movido al almacen del maquilador.')
      await cargar(); await abrirDetalle(omSel.id)
    } catch (err) { setError('Error al enviar: ' + err.message) }
    setProc(false)
  }

  const recibirProducto = async () => {
    setError(''); setExito('')
    const cant = Number(rec.cantidad)
    if (!(cant > 0)) { setError('Captura la cantidad recibida.'); return }
    if (!rec.almacen_id) { setError('Selecciona el almacen destino.'); return }
    setProc(true)
    try {
      // lote del producto (retenido, origen maquila)
      const { data: codigo, error: ec } = await supabase.rpc('generar_lote_recibo', { p_empresa_id: perfil.empresa_id })
      if (ec) throw ec
      const { data: lote, error: el } = await supabase.from('lotes').insert({
        empresa_id: perfil.empresa_id, articulo_id: omSel.articulo_id, codigo_lote: codigo,
        origen: 'maquila', estatus_calidad: 'retenido', creado_por: perfil.id,
      }).select().single()
      if (el) throw el
      await supabase.from('existencias').insert({ lote_id: lote.id, almacen_id: Number(rec.almacen_id), ubicacion_id: null, cantidad: cant })
      await supabase.from('movimientos').insert({
        empresa_id: perfil.empresa_id, articulo_id: omSel.articulo_id, lote_id: lote.id, tipo: 'entrada_maquila',
        almacen_destino_id: Number(rec.almacen_id), cantidad: cant, motivo: `Recibo de maquila OM ${omSel.folio}`, usuario_id: perfil.id,
      })
      // shots por cavidades del molde
      const cav = cavDe(omSel.articulo_id) || 0
      const shots = cav > 0 ? Math.ceil(cant / cav) : 0
      await supabase.from('om_recibos').insert({ om_id: omSel.id, articulo_id: omSel.articulo_id, cantidad: cant, lote_id: lote.id, shots, recibido_por: perfil.id })
      // consumo por BOM desde el almacen virtual
      if (omSel.almacen_maquila_id) {
        for (const m of materiales) {
          const consumo = cant * Number(m.cantidad_por_unidad)
          if (consumo <= 0) continue
          const { tomados } = await deducir(m.articulo_id, consumo, [omSel.almacen_maquila_id])
          for (const t of tomados) {
            const nueva = Number(t.ex.cantidad) - t.toma
            if (nueva <= 0.000001) await supabase.from('existencias').delete().eq('id', t.ex.id)
            else await supabase.from('existencias').update({ cantidad: nueva }).eq('id', t.ex.id)
            await supabase.from('movimientos').insert({
              empresa_id: perfil.empresa_id, articulo_id: m.articulo_id, lote_id: t.ex.lote_id, tipo: 'consumo_maquila',
              almacen_origen_id: omSel.almacen_maquila_id, cantidad: t.toma, motivo: `Consumo BOM maquila OM ${omSel.folio}`, usuario_id: perfil.id,
            })
          }
        }
      }
      const totalRec = recibos.reduce((s, r) => s + Number(r.cantidad), 0) + cant
      const estatus = totalRec >= Number(omSel.cantidad_esperada) ? 'cerrada' : 'recibida_parcial'
      await supabase.from('ordenes_maquila').update({ estatus }).eq('id', omSel.id)
      setExito(`Recibidas ${fmt(cant)} pzas (lote ${codigo}, retenido). ${shots > 0 ? `+${fmt(shots)} shots al molde.` : ''}`)
      await cargar(); await abrirDetalle(omSel.id)
    } catch (err) { setError('Error al recibir: ' + err.message) }
    setProc(false)
  }

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>

  // ---------- NUEVA ----------
  if (vista === 'nueva') {
    const artsFab = articulos.filter(a => a.origen === 'fabricado' || moldeDeArticulo(a.id))
    const mats = form?.articulo_id ? bomDe(Number(form.articulo_id)) : []
    return (
      <div style={styles.container} className="aparecer">
        <button style={styles.volver} onClick={() => setVista('lista')}>&larr; Volver</button>
        <h2 style={styles.titulo}>Nueva orden de maquila</h2>
        {error && <p style={styles.error}>{error}</p>}
        <div style={styles.tarjeta}>
          <div style={styles.fila}>
            <div style={styles.campo}><label style={styles.label}>Maquilador *</label>
              <select style={styles.input} value={form.maquilador_id} onChange={e => setForm({ ...form, maquilador_id: e.target.value })}>
                <option value="">Selecciona...</option>
                {maquiladores.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
              {maquiladores.length === 0 && <span style={styles.hint}>No hay proveedores marcados como maquilador. Marca "es_maquilador" en Proveedores.</span>}
            </div>
            <div style={styles.campo}><label style={styles.label}>Articulo a producir *</label>
              <select style={styles.input} value={form.articulo_id} onChange={e => setForm({ ...form, articulo_id: e.target.value })}>
                <option value="">Selecciona...</option>
                {artsFab.map(a => <option key={a.id} value={a.id}>{a.codigo_interno} - {a.descripcion}</option>)}
              </select>
            </div>
            <div style={styles.campo}><label style={styles.label}>Cantidad esperada *</label>
              <input type="number" min="0" style={styles.input} value={form.cantidad_esperada} onChange={e => setForm({ ...form, cantidad_esperada: e.target.value })} />
            </div>
          </div>
          {form.articulo_id && (
            <div style={{ marginTop: '8px' }}>
              <p style={styles.sub}>Molde: <b>{(() => { const mid = moldeDeArticulo(Number(form.articulo_id)); return mid ? `si (cav ${cavDe(Number(form.articulo_id))})` : 'sin molde' })()}</b> · Materiales del BOM a enviar:</p>
              {mats.length === 0 ? <p style={styles.hint}>El articulo no tiene BOM. Podras agregar materiales despues.</p> : (
                <div style={styles.tabla}>
                  <div style={styles.th}><span style={{ flex: 2 }}>Componente</span><span style={{ flex: 1, textAlign: 'right' }}>Por unidad</span><span style={{ flex: 1, textAlign: 'right' }}>Plan (x{fmt(form.cantidad_esperada || 0)})</span></div>
                  {mats.map(b => (
                    <div key={b.id} style={styles.tr}>
                      <span style={{ flex: 2 }}>{artDe(b.componente_articulo_id)?.codigo_interno} <span style={{ color: '#94a3b8' }}>- {artDe(b.componente_articulo_id)?.descripcion}</span></span>
                      <span style={{ flex: 1, textAlign: 'right' }}>{fmt(b.cantidad_por_unidad)} {b.unidad_medida}</span>
                      <span style={{ flex: 1, textAlign: 'right' }}>{fmt(Number(b.cantidad_por_unidad) * Number(form.cantidad_esperada || 0))}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div style={styles.campo}><label style={styles.label}>Notas</label>
            <input style={styles.input} value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })} /></div>
          <div style={styles.botones}>
            <button style={styles.botonSec} onClick={() => setVista('lista')} disabled={proc}>Cancelar</button>
            <button style={styles.boton} onClick={guardarNueva} disabled={proc}>{proc ? 'Guardando...' : 'Crear OM (borrador)'}</button>
          </div>
        </div>
      </div>
    )
  }

  // ---------- DETALLE ----------
  if (vista === 'detalle' && omSel) {
    const totalRec = recibos.reduce((s, r) => s + Number(r.cantidad), 0)
    const puedeEnviar = puedeEditar && omSel.estatus === 'borrador'
    const puedeRecibir = puedeEditar && ['enviada', 'en_proceso', 'recibida_parcial'].includes(omSel.estatus)
    return (
      <div style={styles.container} className="aparecer">
        <button style={styles.volver} onClick={() => { setVista('lista'); cargar() }}>&larr; Volver a maquila</button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={styles.titulo}>{omSel.folio} · {omSel.maq?.nombre}</h2>
          <span style={badge(omSel.estatus)}>{omSel.estatus.replace(/_/g, ' ')}</span>
        </div>
        <p style={styles.sub}>Producir <b>{fmt(omSel.cantidad_esperada)}</b> de <b>{omSel.art?.codigo_interno}</b> {omSel.molde?.clave ? <>· molde <b>{omSel.molde.clave}</b></> : ''} · recibido <b>{fmt(totalRec)}</b></p>
        {error && <p style={styles.error}>{error}</p>}
        {exito && <p style={styles.exito}>{exito}</p>}

        <div style={styles.tarjeta}>
          <h3 style={styles.h3}>Materiales a enviar</h3>
          <div style={styles.tabla}>
            <div style={styles.th}><span style={{ flex: 2 }}>Componente</span><span style={{ flex: 1, textAlign: 'right' }}>Por unidad</span><span style={{ flex: 1, textAlign: 'right' }}>Plan</span><span style={{ flex: 1.2, textAlign: 'right' }}>Enviado</span></div>
            {materiales.map(m => (
              <div key={m.id} style={styles.tr}>
                <span style={{ flex: 2 }}>{artDe(m.articulo_id)?.codigo_interno} <span style={{ color: '#94a3b8' }}>- {artDe(m.articulo_id)?.descripcion}</span></span>
                <span style={{ flex: 1, textAlign: 'right' }}>{fmt(m.cantidad_por_unidad)} {m.unidad_medida}</span>
                <span style={{ flex: 1, textAlign: 'right' }}>{fmt(m.cantidad_plan)}</span>
                <span style={{ flex: 1.2, textAlign: 'right' }}>
                  {puedeEnviar
                    ? <input type="number" min="0" value={m.cantidad_enviada} onChange={e => setMatCampo(m.id, e.target.value)} style={{ ...styles.inputMini, textAlign: 'right' }} />
                    : fmt(m.cantidad_enviada)}
                </span>
              </div>
            ))}
            {materiales.length === 0 && <div style={styles.vacio}>Sin materiales.</div>}
          </div>
          {puedeEnviar && <div style={styles.botones}><button style={styles.boton} onClick={enviarMaterial} disabled={proc}>{proc ? 'Enviando...' : 'Enviar material a maquila'}</button></div>}
        </div>

        {['enviada', 'en_proceso', 'recibida_parcial', 'cerrada'].includes(omSel.estatus) && (
          <div style={styles.tarjeta}>
            <h3 style={styles.h3}>Conciliacion (saldo en maquila)</h3>
            <div style={styles.tabla}>
              <div style={styles.th}><span style={{ flex: 2 }}>Componente</span><span style={{ flex: 1, textAlign: 'right' }}>Enviado</span><span style={{ flex: 1, textAlign: 'right' }}>Consumo teorico</span><span style={{ flex: 1, textAlign: 'right' }}>Saldo</span><span style={{ flex: 1, textAlign: 'right' }}>En maquila</span></div>
              {saldo.map((s, i) => (
                <div key={i} style={styles.tr}>
                  <span style={{ flex: 2 }}>{artDe(s.articulo_id)?.codigo_interno}</span>
                  <span style={{ flex: 1, textAlign: 'right' }}>{fmt(s.enviado)}</span>
                  <span style={{ flex: 1, textAlign: 'right' }}>{fmt(s.consumo_teorico)}</span>
                  <span style={{ flex: 1, textAlign: 'right', fontWeight: 600 }}>{fmt(s.saldo)}</span>
                  <span style={{ flex: 1, textAlign: 'right', color: Math.abs(Number(s.saldo) - Number(s.existencia_virtual)) > 0.01 ? '#dc2626' : '#16a34a' }}>{fmt(s.existencia_virtual)}</span>
                </div>
              ))}
            </div>
            <p style={styles.hint}>Saldo = enviado - (recibido x BOM). "En maquila" es la existencia real en el almacen virtual; si difiere del saldo hay merma a justificar.</p>
          </div>
        )}

        {puedeRecibir && (
          <div style={styles.tarjeta}>
            <h3 style={styles.h3}>Recibir producto terminado</h3>
            <div style={styles.fila}>
              <div style={styles.campo}><label style={styles.label}>Cantidad recibida *</label>
                <input type="number" min="0" style={styles.input} value={rec.cantidad} onChange={e => setRec({ ...rec, cantidad: e.target.value })} /></div>
              <div style={styles.campo}><label style={styles.label}>Almacen destino *</label>
                <select style={styles.input} value={rec.almacen_id} onChange={e => setRec({ ...rec, almacen_id: e.target.value })}>
                  <option value="">Selecciona...</option>
                  {almInternos.map(a => <option key={a.id} value={a.id}>{a.clave} - {a.nombre}</option>)}
                </select></div>
              <div style={styles.campo}><label style={styles.label}>Shots estimados</label>
                <div style={styles.loteAuto}>{(() => { const cav = cavDe(omSel.articulo_id); return cav > 0 && rec.cantidad ? `${fmt(Math.ceil(Number(rec.cantidad) / cav))} (cav ${cav})` : cav > 0 ? `cav ${cav}` : 'sin molde' })()}</div></div>
            </div>
            <div style={styles.botones}><button style={styles.boton} onClick={recibirProducto} disabled={proc}>{proc ? 'Procesando...' : 'Recibir (RETENIDO)'}</button></div>
          </div>
        )}

        {recibos.length > 0 && (
          <div style={styles.tarjeta}>
            <h3 style={styles.h3}>Recepciones</h3>
            <div style={styles.tabla}>
              <div style={styles.th}><span style={{ flex: 1 }}>Fecha</span><span style={{ flex: 1, textAlign: 'right' }}>Cantidad</span><span style={{ flex: 1, textAlign: 'right' }}>Shots</span></div>
              {recibos.map(r => (
                <div key={r.id} style={styles.tr}><span style={{ flex: 1 }}>{fFecha(r.fecha)}</span><span style={{ flex: 1, textAlign: 'right' }}>{fmt(r.cantidad)}</span><span style={{ flex: 1, textAlign: 'right' }}>{fmt(r.shots)}</span></div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ---------- LISTA ----------
  return (
    <div style={styles.container} className="aparecer">
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Maquila / Subcontratacion</h2>
        {puedeCrear && <button style={styles.boton} onClick={abrirNueva}>Nueva OM</button>}
      </div>
      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}
      {oms.length === 0 ? <p style={{ color: '#666' }}>No hay ordenes de maquila.</p> : (
        <div style={styles.tabla}>
          <div style={styles.th}><span style={{ flex: 1 }}>Folio</span><span style={{ flex: 1.6 }}>Maquilador</span><span style={{ flex: 1.6 }}>Producto</span><span style={{ flex: 1, textAlign: 'right' }}>Esperado</span><span style={{ flex: 1 }}>Estatus</span><span style={{ width: '90px' }}></span></div>
          {oms.map(o => (
            <div key={o.id} style={styles.tr}>
              <span style={{ flex: 1, fontWeight: 600 }}>{o.folio}</span>
              <span style={{ flex: 1.6 }}>{o.maq?.nombre}</span>
              <span style={{ flex: 1.6 }}>{o.art?.codigo_interno} <span style={{ color: '#94a3b8' }}>{o.molde?.clave ? `· ${o.molde.clave}` : ''}</span></span>
              <span style={{ flex: 1, textAlign: 'right' }}>{fmt(o.cantidad_esperada)}</span>
              <span style={{ flex: 1 }}><span style={badge(o.estatus)}>{o.estatus.replace(/_/g, ' ')}</span></span>
              <span style={{ width: '90px', textAlign: 'right' }}><button style={styles.botonAccion} onClick={() => abrirDetalle(o.id)}>Abrir</button></span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function badge(s) {
  const base = { padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600 }
  const c = { borrador: ['#f1f5f9', '#64748b'], enviada: ['#dbeafe', '#2563eb'], en_proceso: ['#fef3c7', '#b45309'], recibida_parcial: ['#fef3c7', '#b45309'], cerrada: ['#dcfce7', '#16a34a'], cancelada: ['#fee2e2', '#b91c1c'] }[s] || ['#f1f5f9', '#64748b']
  return { ...base, backgroundColor: c[0], color: c[1] }
}

const styles = {
  container: { padding: '28px', maxWidth: '1000px' },
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: 0 },
  volver: { padding: '6px 14px', backgroundColor: 'transparent', color: '#2563eb', border: '1px solid #2563eb', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', marginBottom: '14px' },
  sub: { fontSize: '13px', color: '#64748b', margin: '6px 0 14px' },
  h3: { fontSize: '14px', fontWeight: 600, color: '#1a1a2e', margin: '0 0 12px' },
  tarjeta: { backgroundColor: '#fff', borderRadius: '10px', padding: '18px 20px', marginBottom: '14px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  fila: { display: 'flex', gap: '14px', flexWrap: 'wrap', marginBottom: '10px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: '180px' },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  hint: { fontSize: '12px', color: '#94a3b8', marginTop: '4px' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', fontFamily: 'inherit', backgroundColor: '#fff' },
  inputMini: { padding: '6px 8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '13px', outline: 'none', width: '120px' },
  loteAuto: { padding: '9px 12px', borderRadius: '7px', border: '1px dashed #cbd5e1', fontSize: '13px', color: '#64748b', backgroundColor: '#f8fafc' },
  botones: { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '14px' },
  boton: { padding: '9px 18px', backgroundColor: '#9333ea', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSec: { padding: '9px 18px', backgroundColor: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonAccion: { padding: '5px 12px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' },
  tabla: { border: '1px solid #eef2f7', borderRadius: '8px', overflow: 'hidden' },
  th: { display: 'flex', padding: '9px 14px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tr: { display: 'flex', padding: '10px 14px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px' },
  vacio: { padding: '12px 14px', color: '#94a3b8', fontSize: '13px' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
