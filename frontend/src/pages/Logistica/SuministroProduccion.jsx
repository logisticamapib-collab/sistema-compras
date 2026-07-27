import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import EscanerCamara from '../../components/EscanerCamara'

// Suministro de Materiales a Produccion.
// - Solo OT abiertas y no surtidas. Se busca/escribe/escanea la OT.
// - Muestra el material requerido (BOM ya trae pieza+colada; a lineas en Kg se les
//   suma purga (1 vez por OT) y % de scrap del alta del articulo). Lineas en pieza
//   (ensamble) van tal cual. Depende de tipo_proceso del articulo.
// - Consolida la misma MP de otras OT abiertas para surtir de una sola vez.
// - No se puede entregar mas que el pendiente; el extra requiere autorizacion de
//   Gerente de Produccion y luego Gerente de Logistica.
// - El surtido es un traspaso a Patio de Maniobras (ubicacion configurable).
// - Retiro de asignacion (Almacen con motivo) y balance entregado vs producido.

const fmt = (n) => (Math.round((Number(n) || 0) * 1000) / 1000).toLocaleString('es-MX')
const esRol = (r, arr) => arr.includes(r)
const isPeso = (u) => { const s = (u || '').toLowerCase(); return /kg|kilo|gram|^g$|^gr$/.test(s) }
const aKg = (c, u) => { const s = (u || '').toLowerCase(); return (s.startsWith('g') && !s.includes('k')) ? Number(c) / 1000 : Number(c) }

export default function SuministroProduccion() {
  const { perfil, tienePermiso } = useAuth()
  const emp = perfil.empresa_id
  const puedeSurtir = tienePermiso('log_suministro', 'crear')
  const esProd = esRol(perfil.rol, ['gerente_produccion', 'admin'])
  const esLog = esRol(perfil.rol, ['gerente_logistica', 'admin'])

  const [arts, setArts] = useState([])
  const [bom, setBom] = useState([])
  const [ots, setOts] = useState([])
  const [req, setReq] = useState([])
  const [extras, setExtras] = useState([])
  const [almacenes, setAlmacenes] = useState([])
  const [ubis, setUbis] = useState([])
  const [param, setParam] = useState(null)
  const [usuarios, setUsuarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [proc, setProc] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [vista, setVista] = useState('surtir')

  const [busca, setBusca] = useState('')
  const [sel, setSel] = useState(null)          // OT seleccionada
  const [lineas, setLineas] = useState([])      // editable
  const [fuente, setFuente] = useState('')      // almacen origen
  const [extraForm, setExtraForm] = useState(null)
  const [retForm, setRetForm] = useState(null)
  const [cfg, setCfg] = useState({ almacen_patio_id: '', ubicacion_patio_id: '' })

  useEffect(() => { cargar() }, [])
  const cargar = async () => {
    setLoading(true)
    const [a, b, o, r, ex, al, ub, us, pa] = await Promise.all([
      supabase.from('articulos').select('id, codigo_interno, descripcion, unidad_medida, tipo_proceso, pct_scrap_aprobado, peso_purga_g, pct_molido_max').eq('empresa_id', emp),
      supabase.from('bom').select('*'),
      supabase.from('ordenes_trabajo').select('id, folio, articulo_id, cantidad_programada, cantidad_producida, cantidad_scrap, site_id, estatus').eq('empresa_id', emp).neq('estatus', 'cerrada').order('id', { ascending: false }),
      supabase.from('ot_material_requerido').select('*').eq('empresa_id', emp),
      supabase.from('suministro_extra').select('*').eq('empresa_id', emp).order('id', { ascending: false }),
      supabase.from('almacenes').select('*').eq('empresa_id', emp).eq('activo', true).order('clave'),
      supabase.from('ubicaciones').select('*').eq('activo', true).order('clave'),
      supabase.from('usuarios').select('id, nombre'),
      supabase.from('suministro_parametros').select('*').eq('site_id', perfil.site_id).maybeSingle(),
    ])
    setArts(a.data || []); setBom(b.data || []); setOts(o.data || []); setReq(r.data || [])
    setExtras(ex.data || []); setAlmacenes(al.data || []); setUbis(ub.data || []); setUsuarios(us.data || [])
    setParam(pa.data || null)
    if (pa.data) setCfg({ almacen_patio_id: pa.data.almacen_patio_id || '', ubicacion_patio_id: pa.data.ubicacion_patio_id || '' })
    if (!fuente) { const mp = (al.data || []).find(x => /mp|materia/i.test(x.clave + x.nombre)); if (mp) setFuente(String(mp.id)) }
    setLoading(false)
  }

  const artDe = (id) => arts.find(x => x.id === id)
  const nombreUsr = (id) => usuarios.find(u => u.id === id)?.nombre || '-'
  const reqDeOT = (otId) => req.filter(r => r.ot_id === otId)
  const pendiente = (r) => r.retirado ? 0 : (Number(r.cantidad_requerida) + Number(r.cantidad_extra_autorizada) - Number(r.cantidad_entregada))

  // Calcula el requerido de una OT desde el BOM + alta de articulo
  const calc = (ot) => {
    const art = artDe(ot.articulo_id); if (!art) return []
    const scrap = Number(art.pct_scrap_aprobado) || 0
    const purga = (Number(art.peso_purga_g) || 0) / 1000
    const esIny = /inyecc/i.test(art.tipo_proceso || '')
    const pb = Number(ot.cantidad_programada) * (1 + scrap / 100)
    const lines = bom.filter(l => l.articulo_padre_id === ot.articulo_id)
    let primerPeso = true; const out = []
    for (const l of lines) {
      const w = isPeso(l.unidad_medida)
      if (w && esIny) {
        let rq = aKg(l.cantidad_por_unidad, l.unidad_medida) * pb
        if (primerPeso) { rq += purga; primerPeso = false }
        out.push({ articulo_id: l.componente_articulo_id, tipo_linea: 'inyectado', unidad: 'kg', requerido: rq })
      } else {
        out.push({ articulo_id: l.componente_articulo_id, tipo_linea: 'pieza', unidad: l.unidad_medida || 'pza', requerido: Number(l.cantidad_por_unidad) * Number(ot.cantidad_programada) })
      }
    }
    return out
  }

  // Asegura filas en ot_material_requerido (snapshot) y devuelve filas frescas de la OT
  const ensureReq = async (ot) => {
    let filas = reqDeOT(ot.id)
    if (filas.length === 0) {
      const calc0 = calc(ot)
      if (calc0.length) {
        const rows = calc0.map(c => ({ empresa_id: emp, ot_id: ot.id, articulo_id: c.articulo_id, tipo_linea: c.tipo_linea, unidad: c.unidad, cantidad_requerida: c.requerido, detalle: { cantidad_programada: ot.cantidad_programada } }))
        await supabase.from('ot_material_requerido').insert(rows)
        const { data } = await supabase.from('ot_material_requerido').select('*').eq('ot_id', ot.id)
        filas = data || []
        setReq(prev => [...prev.filter(r => r.ot_id !== ot.id), ...filas])
      }
    }
    return filas
  }

  const otNoSurtida = (ot) => {
    const filas = reqDeOT(ot.id)
    if (filas.length === 0) return true
    return filas.some(r => pendiente(r) > 0)
  }
  const otsLista = ots.filter(otNoSurtida)

  const abrirOT = async (ot) => {
    setError(''); setExito('')
    const filas = await ensureReq(ot)
    // consolidacion: otras OT abiertas que usan el mismo articulo
    const otrasPorArt = {}
    for (const f of filas) {
      const mismos = []
      for (const o2 of ots) {
        if (o2.id === ot.id) continue
        const c2 = calc(o2).find(c => c.articulo_id === f.articulo_id)
        if (!c2) continue
        const r2 = req.find(r => r.ot_id === o2.id && r.articulo_id === f.articulo_id)
        const pend = r2 ? pendiente(r2) : c2.requerido
        if (pend > 0) mismos.push({ ot: o2, pend, incluir: false, entregar: 0 })
      }
      otrasPorArt[f.articulo_id] = mismos
    }
    setLineas(filas.map(f => ({ ...f, entregar: Math.max(0, pendiente(f)), otras: otrasPorArt[f.articulo_id] || [] })))
    setSel(ot)
  }

  const buscarOT = async (valor) => {
    const v = (valor || busca).trim().toLowerCase()
    if (!v) return
    const ot = ots.find(o => (o.folio || '').toLowerCase() === v || String(o.id) === v) || otsLista.find(o => (o.folio || '').toLowerCase().includes(v))
    if (!ot) { setError(`No hay OT abierta y no surtida con "${valor || busca}"`); return }
    abrirOT(ot)
  }

  // Mueve 'cant' del articulo de fuente -> patio (FIFO por lote) y registra movimientos
  const moverAPatio = async (articuloId, cant, srcAlm, sumId, otId, esExtra) => {
    const { data: exs } = await supabase.from('existencias')
      .select('*, lote:lotes!inner(id, articulo_id, fecha, estatus_calidad)')
      .eq('almacen_id', srcAlm).eq('lote.articulo_id', articuloId).gt('cantidad', 0).order('id')
    let disp = (exs || []).filter(e => !['cuarentena', 'scrap', 'rechazado'].includes(e.lote?.estatus_calidad))
    disp.sort((a, b) => new Date(a.lote?.fecha || 0) - new Date(b.lote?.fecha || 0))
    const total = disp.reduce((s, e) => s + Number(e.cantidad), 0)
    if (total + 1e-6 < cant) throw new Error(`Existencia insuficiente de ${artDe(articuloId)?.codigo_interno} en el almacen origen (hay ${fmt(total)}, se requieren ${fmt(cant)}).`)
    let rem = cant
    for (const e of disp) {
      if (rem <= 1e-6) break
      const take = Math.min(rem, Number(e.cantidad))
      const nuevo = Number(e.cantidad) - take
      if (nuevo > 1e-6) await supabase.from('existencias').update({ cantidad: nuevo }).eq('id', e.id)
      else await supabase.from('existencias').delete().eq('id', e.id)
      // patio
      const { data: pe } = await supabase.from('existencias').select('*').eq('lote_id', e.lote_id).eq('almacen_id', param.almacen_patio_id).eq('ubicacion_id', param.ubicacion_patio_id).maybeSingle()
      if (pe) await supabase.from('existencias').update({ cantidad: Number(pe.cantidad) + take }).eq('id', pe.id)
      else await supabase.from('existencias').insert({ lote_id: e.lote_id, almacen_id: param.almacen_patio_id, ubicacion_id: param.ubicacion_patio_id, cantidad: take })
      await supabase.from('movimientos').insert({ empresa_id: emp, articulo_id: articuloId, lote_id: e.lote_id, tipo: 'surtido_produccion', almacen_origen_id: srcAlm, ubicacion_origen_id: e.ubicacion_id, almacen_destino_id: param.almacen_patio_id, ubicacion_destino_id: param.ubicacion_patio_id, cantidad: take, motivo: `Surtido OT ${otId}${esExtra ? ' (extra)' : ''}`, usuario_id: perfil.id })
      rem -= take
    }
  }

  const confirmarSurtido = async () => {
    setError('')
    if (!param?.almacen_patio_id || !param?.ubicacion_patio_id) { setError('Configura la ubicacion de Patio de Maniobras (pestana Configuracion).'); return }
    if (!fuente) { setError('Elige el almacen origen.'); return }
    // recolectar entregas: linea principal + otras OT incluidas
    const entregas = []
    for (const l of lineas) {
      const e = Number(l.entregar) || 0
      if (e > 0) {
        if (e > pendiente(l) + 1e-6) { setError(`No puedes entregar mas que el pendiente en ${artDe(l.articulo_id)?.codigo_interno}. Usa "Solicitar extra".`); return }
        entregas.push({ otId: l.ot_id, articulo_id: l.articulo_id, cant: e, reqRow: l })
      }
      for (const o of (l.otras || [])) {
        const e2 = Number(o.entregar) || 0
        if (o.incluir && e2 > 0) {
          if (e2 > o.pend + 1e-6) { setError(`La entrega para OT ${o.ot.folio} excede su pendiente.`); return }
          entregas.push({ otId: o.ot.id, articulo_id: l.articulo_id, cant: e2, otObj: o.ot })
        }
      }
    }
    if (entregas.length === 0) { setError('No hay cantidades a entregar.'); return }
    setProc(true)
    try {
      const folio = 'SUM-' + String(Date.now()).slice(-6)
      const { data: sum, error: es } = await supabase.from('suministros').insert({ empresa_id: emp, site_id: perfil.site_id, folio, surtido_por: perfil.id }).select().single()
      if (es) throw es
      for (const en of entregas) {
        // asegurar snapshot para OT consolidada
        if (en.otObj) await ensureReq(en.otObj)
        await moverAPatio(en.articulo_id, en.cant, Number(fuente), sum.id, en.otId, false)
        await supabase.from('suministro_lineas').insert({ suministro_id: sum.id, ot_id: en.otId, articulo_id: en.articulo_id, cantidad_entregada: en.cant, almacen_origen_id: Number(fuente), almacen_destino_id: param.almacen_patio_id, ubicacion_destino_id: param.ubicacion_patio_id })
        // acumular entregado
        const { data: rr } = await supabase.from('ot_material_requerido').select('*').eq('ot_id', en.otId).eq('articulo_id', en.articulo_id).maybeSingle()
        if (rr) await supabase.from('ot_material_requerido').update({ cantidad_entregada: Number(rr.cantidad_entregada) + en.cant }).eq('id', rr.id)
      }
      setExito(`Surtido ${folio} registrado (${entregas.length} entregas a Patio de Maniobras).`)
      setSel(null); setLineas([]); await cargar()
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  const crearExtra = async () => {
    setError(''); const f = extraForm
    if (!(Number(f.cantidad) > 0) || !f.motivo.trim()) { setError('Captura cantidad y motivo.'); return }
    setProc(true)
    try {
      await supabase.from('suministro_extra').insert({ empresa_id: emp, ot_id: f.ot_id, articulo_id: f.articulo_id, cantidad: Number(f.cantidad), motivo: f.motivo.trim(), solicitado_por: perfil.id })
      setExito('Solicitud de MP extra registrada. Requiere autorizacion de Produccion y Logistica.'); setExtraForm(null); await cargar()
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  const autorizarExtra = async (x, area) => {
    setError(''); setProc(true)
    try {
      const now = new Date().toISOString()
      if (area === 'prod') await supabase.from('suministro_extra').update({ estatus: 'aut_produccion', auth_prod_por: perfil.id, auth_prod_at: now }).eq('id', x.id)
      else {
        await supabase.from('suministro_extra').update({ estatus: 'autorizada', auth_log_por: perfil.id, auth_log_at: now }).eq('id', x.id)
        const { data: rr } = await supabase.from('ot_material_requerido').select('*').eq('ot_id', x.ot_id).eq('articulo_id', x.articulo_id).maybeSingle()
        if (rr) await supabase.from('ot_material_requerido').update({ cantidad_extra_autorizada: Number(rr.cantidad_extra_autorizada) + Number(x.cantidad) }).eq('id', rr.id)
        else await supabase.from('ot_material_requerido').insert({ empresa_id: emp, ot_id: x.ot_id, articulo_id: x.articulo_id, tipo_linea: 'inyectado', unidad: 'kg', cantidad_requerida: 0, cantidad_extra_autorizada: Number(x.cantidad) })
      }
      setExito('Autorizacion registrada.'); await cargar()
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  const confirmarRetiro = async () => {
    setError(''); const f = retForm
    if (!f.motivo.trim()) { setError('Escribe el motivo del retiro.'); return }
    setProc(true)
    try {
      await supabase.from('suministro_retiros').insert({ empresa_id: emp, ot_id: f.ot.id, motivo: f.motivo.trim(), cantidad_devuelta: f.filas.reduce((s, x) => s + (Number(x.devuelto) || 0), 0), retirado_por: perfil.id })
      for (const x of f.filas) {
        await supabase.from('ot_material_requerido').update({ retirado: true }).eq('id', x.id)
        const dev = Number(x.devuelto) || 0
        if (dev > 0) {
          // devolver de patio -> almacen MP (FIFO en patio)
          const { data: pes } = await supabase.from('existencias').select('*, lote:lotes!inner(id, articulo_id)').eq('almacen_id', param.almacen_patio_id).eq('lote.articulo_id', x.articulo_id).gt('cantidad', 0).order('id')
          let rem = dev
          for (const pe of (pes || [])) {
            if (rem <= 1e-6) break
            const take = Math.min(rem, Number(pe.cantidad))
            const nv = Number(pe.cantidad) - take
            if (nv > 1e-6) await supabase.from('existencias').update({ cantidad: nv }).eq('id', pe.id)
            else await supabase.from('existencias').delete().eq('id', pe.id)
            const { data: me } = await supabase.from('existencias').select('*').eq('lote_id', pe.lote_id).eq('almacen_id', Number(fuente)).maybeSingle()
            if (me) await supabase.from('existencias').update({ cantidad: Number(me.cantidad) + take }).eq('id', me.id)
            else await supabase.from('existencias').insert({ lote_id: pe.lote_id, almacen_id: Number(fuente), ubicacion_id: null, cantidad: take })
            await supabase.from('movimientos').insert({ empresa_id: emp, articulo_id: x.articulo_id, lote_id: pe.lote_id, tipo: 'retorno_suministro', almacen_origen_id: param.almacen_patio_id, ubicacion_origen_id: param.ubicacion_patio_id, almacen_destino_id: Number(fuente), cantidad: take, motivo: `Retiro OT ${f.ot.folio}: ${f.motivo.trim()}`, usuario_id: perfil.id })
            rem -= take
          }
        }
      }
      setExito(`Asignacion de MP retirada de la OT ${f.ot.folio}.`); setRetForm(null); await cargar()
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  const guardarCfg = async () => {
    setError(''); setProc(true)
    try {
      await supabase.from('suministro_parametros').upsert({ site_id: perfil.site_id, empresa_id: emp, almacen_patio_id: cfg.almacen_patio_id ? Number(cfg.almacen_patio_id) : null, ubicacion_patio_id: cfg.ubicacion_patio_id ? Number(cfg.ubicacion_patio_id) : null, updated_at: new Date().toISOString(), updated_by: perfil.id }, { onConflict: 'site_id' })
      setExito('Patio de Maniobras configurado.'); await cargar()
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>
  const extrasPend = extras.filter(x => ['pendiente', 'aut_produccion'].includes(x.estatus))
  const ubisPatio = ubis.filter(u => u.almacen_id === Number(cfg.almacen_patio_id))

  return (
    <div style={S.c} className="aparecer">
      <h2 style={S.t}>Suministro a Produccion</h2>
      {!param?.ubicacion_patio_id && <p style={S.warn}>Configura la ubicacion de <b>Patio de Maniobras</b> en la pestana Configuracion.</p>}
      {error && <p style={S.err}>{error}</p>}
      {exito && <p style={S.ok}>{exito}</p>}
      <div style={S.tabs}>
        {[['surtir', 'Surtir OT'], ['autorizar', `Extra por autorizar (${extrasPend.length})`], ['retiros', 'Retirar asignacion'], ['balance', 'Balance'], ['config', 'Configuracion']].map(([id, n]) => (
          <button key={id} style={vista === id ? S.tabOn : S.tab} onClick={() => { setError(''); setExito(''); setVista(id) }}>{n}</button>
        ))}
      </div>

      {vista === 'surtir' && !sel && (
        <div>
          <div style={S.buscaRow}>
            <input style={S.input} placeholder="Escribe o escanea la OT (folio)" value={busca} onChange={e => setBusca(e.target.value)} onKeyDown={e => e.key === 'Enter' && buscarOT()} />
            <EscanerCamara title="Escanear OT" onScan={(v) => { setBusca(v); buscarOT(v) }} />
            <button style={S.btn} onClick={() => buscarOT()}>Buscar</button>
          </div>
          <div style={S.tabla}>
            <div style={S.th}><span style={{ flex: 1 }}>OT</span><span style={{ flex: 1.6 }}>Articulo</span><span style={{ flex: 1, textAlign: 'right' }}>Programado</span><span style={{ width: 90 }}></span></div>
            {otsLista.map(o => (
              <div key={o.id} style={S.tr}>
                <span style={{ flex: 1, fontWeight: 600 }}>{o.folio}</span>
                <span style={{ flex: 1.6 }}>{artDe(o.articulo_id)?.codigo_interno} <span style={{ color: '#94a3b8' }}>{artDe(o.articulo_id)?.descripcion}</span></span>
                <span style={{ flex: 1, textAlign: 'right' }}>{fmt(o.cantidad_programada)}</span>
                <span style={{ width: 90, textAlign: 'right' }}>{puedeSurtir && <button style={S.btnMini} onClick={() => abrirOT(o)}>Surtir</button>}</span>
              </div>
            ))}
            {otsLista.length === 0 && <div style={S.vacio}>No hay OT abiertas pendientes de surtir.</div>}
          </div>
        </div>
      )}

      {vista === 'surtir' && sel && (
        <div>
          <div style={S.selHead}>
            <div><b style={{ fontSize: 16 }}>OT {sel.folio}</b> · {artDe(sel.articulo_id)?.codigo_interno} · Programado {fmt(sel.cantidad_programada)}</div>
            <button style={S.btnSec} onClick={() => { setSel(null); setLineas([]) }}>&larr; Volver</button>
          </div>
          <div style={S.fuenteRow}>
            <label style={S.lbl}>Almacen origen:</label>
            <select style={S.inputSm} value={fuente} onChange={e => setFuente(e.target.value)}>
              <option value="">Selecciona...</option>
              {almacenes.map(a => <option key={a.id} value={a.id}>{a.clave} - {a.nombre}</option>)}
            </select>
            <span style={{ color: '#64748b', fontSize: 12 }}>Destino: Patio de Maniobras{param?.ubicacion_patio_id ? '' : ' (sin configurar)'}</span>
          </div>
          {lineas.map((l, i) => (
            <div key={l.id} style={S.matBox}>
              <div style={S.matHead}>
                <span><b>{artDe(l.articulo_id)?.codigo_interno}</b> <span style={{ color: '#94a3b8' }}>{artDe(l.articulo_id)?.descripcion}</span> <span style={l.tipo_linea === 'inyectado' ? S.tagIny : S.tagPza}>{l.tipo_linea}</span></span>
                <span style={{ fontSize: 12, color: '#64748b' }}>Req: {fmt(l.cantidad_requerida)} {l.unidad} · Entregado: {fmt(l.cantidad_entregada)}{Number(l.cantidad_extra_autorizada) > 0 ? ` · Extra aut.: ${fmt(l.cantidad_extra_autorizada)}` : ''} · <b>Pendiente: {fmt(pendiente(l))}</b></span>
              </div>
              <div style={S.matRow}>
                <label style={S.lbl}>Entregar:</label>
                <input style={S.inputSm} type="number" value={l.entregar} onChange={e => { const v = e.target.value; setLineas(ls => ls.map((x, j) => j === i ? { ...x, entregar: v } : x)) }} />
                <span style={{ color: '#94a3b8', fontSize: 12 }}>{l.unidad}</span>
                <button style={S.btnLink} onClick={() => setExtraForm({ ot_id: l.ot_id, articulo_id: l.articulo_id, cantidad: '', motivo: '' })}>Solicitar extra</button>
              </div>
              {l.otras.length > 0 && (
                <div style={S.otras}>
                  <div style={{ fontSize: 11, color: '#b45309', fontWeight: 600, marginBottom: 4 }}>Esta misma MP la requieren otras OT abiertas — puedes surtirlas aqui:</div>
                  {l.otras.map((o, k) => (
                    <div key={o.ot.id} style={S.otraRow}>
                      <label style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1 }}>
                        <input type="checkbox" checked={o.incluir} onChange={e => { const ck = e.target.checked; setLineas(ls => ls.map((x, j) => j === i ? { ...x, otras: x.otras.map((y, m) => m === k ? { ...y, incluir: ck, entregar: ck ? y.pend : 0 } : y) } : x)) }} />
                        <span><b>{o.ot.folio}</b> · {artDe(o.ot.articulo_id)?.codigo_interno} · pendiente {fmt(o.pend)}</span>
                      </label>
                      {o.incluir && <input style={S.inputSm} type="number" value={o.entregar} onChange={e => { const v = e.target.value; setLineas(ls => ls.map((x, j) => j === i ? { ...x, otras: x.otras.map((y, m) => m === k ? { ...y, entregar: v } : y) } : x)) }} />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {lineas.length === 0 && <p style={{ color: '#94a3b8' }}>Esta OT no tiene materiales en su BOM.</p>}
          {puedeSurtir && lineas.length > 0 && <div style={{ textAlign: 'right', marginTop: 12 }}><button style={S.btn} onClick={confirmarSurtido} disabled={proc}>Confirmar surtido</button></div>}
        </div>
      )}

      {vista === 'autorizar' && (
        <div style={S.tabla}>
          <div style={S.th}><span style={{ flex: 1 }}>OT</span><span style={{ flex: 1.4 }}>Articulo</span><span style={{ flex: 0.8, textAlign: 'right' }}>Cant.</span><span style={{ flex: 1.6 }}>Motivo</span><span style={{ flex: 1.2 }}>Firmas</span><span style={{ width: 200 }}></span></div>
          {extrasPend.map(x => { const ot = ots.find(o => o.id === x.ot_id); const okP = !!x.auth_prod_at; return (
            <div key={x.id} style={S.tr}>
              <span style={{ flex: 1, fontWeight: 600 }}>{ot?.folio || x.ot_id}</span>
              <span style={{ flex: 1.4 }}>{artDe(x.articulo_id)?.codigo_interno}</span>
              <span style={{ flex: 0.8, textAlign: 'right' }}>{fmt(x.cantidad)}</span>
              <span style={{ flex: 1.6, fontSize: 12, color: '#64748b' }}>{x.motivo}</span>
              <span style={{ flex: 1.2, fontSize: 11, color: '#64748b' }}>Prod: {okP ? <b style={{ color: '#15803d' }}>OK</b> : 'pendiente'} · Log: {x.auth_log_at ? 'OK' : 'pendiente'}</span>
              <span style={{ width: 200, textAlign: 'right', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                {!okP && esProd && <button style={S.btnMini} disabled={proc} onClick={() => autorizarExtra(x, 'prod')}>Firmar Produccion</button>}
                {okP && esLog && <button style={S.btnMini} disabled={proc} onClick={() => autorizarExtra(x, 'log')}>Firmar Logistica</button>}
              </span>
            </div>
          ) })}
          {extrasPend.length === 0 && <div style={S.vacio}>No hay solicitudes de MP extra por autorizar.</div>}
        </div>
      )}

      {vista === 'retiros' && (
        <div style={S.tabla}>
          <div style={S.th}><span style={{ flex: 1 }}>OT</span><span style={{ flex: 1.6 }}>Articulo</span><span style={{ flex: 1, textAlign: 'right' }}>Entregado</span><span style={{ width: 120 }}></span></div>
          {ots.filter(o => reqDeOT(o.id).some(r => !r.retirado)).map(o => (
            <div key={o.id} style={S.tr}>
              <span style={{ flex: 1, fontWeight: 600 }}>{o.folio}</span>
              <span style={{ flex: 1.6 }}>{artDe(o.articulo_id)?.codigo_interno}</span>
              <span style={{ flex: 1, textAlign: 'right' }}>{fmt(reqDeOT(o.id).reduce((s, r) => s + Number(r.cantidad_entregada), 0))}</span>
              <span style={{ width: 120, textAlign: 'right' }}>{puedeSurtir && <button style={S.btnMiniRed} onClick={() => setRetForm({ ot: o, motivo: '', filas: reqDeOT(o.id).filter(r => !r.retirado).map(r => ({ ...r, devuelto: '' })) })}>Retirar</button>}</span>
            </div>
          ))}
          {ots.filter(o => reqDeOT(o.id).some(r => !r.retirado)).length === 0 && <div style={S.vacio}>Sin OT con asignacion de MP.</div>}
        </div>
      )}

      {vista === 'balance' && (
        <div style={S.tabla}>
          <div style={S.th}><span style={{ flex: 1 }}>OT</span><span style={{ flex: 1.3 }}>Articulo</span><span style={{ flex: 0.9, textAlign: 'right' }}>Requerido</span><span style={{ flex: 0.9, textAlign: 'right' }}>Entregado</span><span style={{ flex: 0.9, textAlign: 'right' }}>Producido</span><span style={{ flex: 0.9, textAlign: 'right' }}>Debio</span><span style={{ flex: 0.8, textAlign: 'right' }}>Dif %</span><span style={{ flex: 0.8, textAlign: 'right' }}>Molido %</span></div>
          {req.filter(r => r.tipo_linea === 'inyectado').map(r => {
            const ot = ots.find(o => o.id === r.ot_id); if (!ot) return null
            const art = artDe(r.articulo_id)
            const prod = Number(ot.cantidad_producida) || 0
            const factor = Number(ot.cantidad_programada) > 0 ? prod / Number(ot.cantidad_programada) : 0
            const debio = Number(r.cantidad_requerida) * factor
            const ent = Number(r.cantidad_entregada)
            const dif = debio > 0 ? ((ent - debio) / debio) * 100 : 0
            return (
              <div key={r.id} style={S.tr}>
                <span style={{ flex: 1, fontWeight: 600 }}>{ot.folio}</span>
                <span style={{ flex: 1.3 }}>{art?.codigo_interno}</span>
                <span style={{ flex: 0.9, textAlign: 'right' }}>{fmt(r.cantidad_requerida)}</span>
                <span style={{ flex: 0.9, textAlign: 'right' }}>{fmt(ent)}</span>
                <span style={{ flex: 0.9, textAlign: 'right' }}>{fmt(prod)}</span>
                <span style={{ flex: 0.9, textAlign: 'right' }}>{fmt(debio)}</span>
                <span style={{ flex: 0.8, textAlign: 'right', color: dif > 0 ? '#dc2626' : '#16a34a' }}>{debio > 0 ? dif.toFixed(1) : '-'}</span>
                <span style={{ flex: 0.8, textAlign: 'right', color: '#94a3b8' }}>{art?.pct_molido_max != null ? Number(art.pct_molido_max).toFixed(1) : '-'}</span>
              </div>
            )
          })}
          {req.filter(r => r.tipo_linea === 'inyectado').length === 0 && <div style={S.vacio}>Aun no hay surtidos registrados.</div>}
        </div>
      )}

      {vista === 'config' && (
        <div style={S.cfg}>
          <p style={S.sub}>Define el <b>almacen y ubicacion de Patio de Maniobras</b> a donde se traspasa el material surtido para este sitio.</p>
          <label style={S.lbl}>Almacen (Patio de Maniobras)</label>
          <select style={S.input} value={cfg.almacen_patio_id} onChange={e => setCfg({ almacen_patio_id: e.target.value, ubicacion_patio_id: '' })}>
            <option value="">Selecciona...</option>
            {almacenes.map(a => <option key={a.id} value={a.id}>{a.clave} - {a.nombre}</option>)}
          </select>
          <label style={{ ...S.lbl, marginTop: 10 }}>Ubicacion</label>
          <select style={S.input} value={cfg.ubicacion_patio_id} onChange={e => setCfg({ ...cfg, ubicacion_patio_id: e.target.value })} disabled={!cfg.almacen_patio_id}>
            <option value="">Selecciona...</option>
            {ubisPatio.map(u => <option key={u.id} value={u.id}>{u.clave}{u.descripcion ? ` - ${u.descripcion}` : ''}</option>)}
          </select>
          <div style={{ textAlign: 'right', marginTop: 14 }}><button style={S.btn} onClick={guardarCfg} disabled={proc || !cfg.almacen_patio_id || !cfg.ubicacion_patio_id}>Guardar</button></div>
        </div>
      )}

      {extraForm && (
        <div style={S.ov}><div style={S.modal}>
          <h3 style={S.h3}>Solicitar MP extra</h3>
          <p style={S.sub}>OT {ots.find(o => o.id === extraForm.ot_id)?.folio} · {artDe(extraForm.articulo_id)?.codigo_interno}. Requiere firma de Gerente de Produccion y luego Gerente de Logistica.</p>
          <label style={S.lbl}>Cantidad extra</label>
          <input style={S.input} type="number" value={extraForm.cantidad} onChange={e => setExtraForm({ ...extraForm, cantidad: e.target.value })} autoFocus />
          <label style={{ ...S.lbl, marginTop: 8 }}>Motivo / justificacion</label>
          <input style={S.input} value={extraForm.motivo} onChange={e => setExtraForm({ ...extraForm, motivo: e.target.value })} placeholder="Ej. arranco 2 veces por falla de molde" />
          <div style={S.btnRow}><button style={S.btnSec} onClick={() => setExtraForm(null)} disabled={proc}>Cancelar</button><button style={S.btn} onClick={crearExtra} disabled={proc}>Enviar solicitud</button></div>
        </div></div>
      )}

      {retForm && (
        <div style={S.ov}><div style={S.modal}>
          <h3 style={S.h3}>Retirar asignacion de MP · OT {retForm.ot.folio}</h3>
          <p style={S.sub}>Cancela el pendiente de la OT. Indica cuanto material regresa fisicamente al almacen (opcional).</p>
          <label style={S.lbl}>Motivo *</label>
          <input style={S.input} value={retForm.motivo} onChange={e => setRetForm({ ...retForm, motivo: e.target.value })} placeholder="Ej. molde danado / entro articulo urgente" autoFocus />
          <div style={{ marginTop: 10 }}>
            {retForm.filas.map((x, i) => (
              <div key={x.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <span style={{ flex: 1, fontSize: 13 }}>{artDe(x.articulo_id)?.codigo_interno} (entregado {fmt(x.cantidad_entregada)})</span>
                <input style={S.inputSm} type="number" placeholder="devuelto" value={x.devuelto} onChange={e => { const v = e.target.value; setRetForm(f => ({ ...f, filas: f.filas.map((y, j) => j === i ? { ...y, devuelto: v } : y) })) }} />
              </div>
            ))}
          </div>
          <div style={S.btnRow}><button style={S.btnSec} onClick={() => setRetForm(null)} disabled={proc}>Cancelar</button><button style={S.btnRedFull} onClick={confirmarRetiro} disabled={proc}>Retirar asignacion</button></div>
        </div></div>
      )}
    </div>
  )
}

const S = {
  c: { padding: '24px', maxWidth: 1120 },
  t: { fontSize: 18, fontWeight: 600, color: '#1a1a2e', margin: '0 0 12px' },
  sub: { fontSize: 13, color: '#64748b', margin: '0 0 10px' },
  h3: { fontSize: 15, fontWeight: 600, color: '#1a1a2e', margin: '0 0 6px' },
  lbl: { fontSize: 12, fontWeight: 500, color: '#444' },
  tabs: { display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap' },
  tab: { padding: '8px 15px', border: 'none', background: 'transparent', fontSize: 14, color: '#64748b', cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabOn: { padding: '8px 15px', border: 'none', background: 'transparent', fontSize: 14, color: '#0891b2', fontWeight: 600, cursor: 'pointer', borderBottom: '2px solid #0891b2' },
  buscaRow: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 },
  fuenteRow: { display: 'flex', gap: 10, alignItems: 'center', margin: '10px 0 14px', flexWrap: 'wrap' },
  selHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  tabla: { background: '#fff', border: '1px solid #eef2f7', borderRadius: 8, overflow: 'hidden' },
  th: { display: 'flex', padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' },
  tr: { display: 'flex', padding: '11px 16px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: 13 },
  vacio: { padding: '14px 16px', color: '#94a3b8', fontSize: 13 },
  matBox: { border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 10, background: '#fff' },
  matHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  matRow: { display: 'flex', gap: 8, alignItems: 'center' },
  otras: { marginTop: 10, padding: '8px 10px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6 },
  otraRow: { display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' },
  input: { padding: '9px 12px', borderRadius: 7, border: '1px solid #ddd', fontSize: 14, outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' },
  inputSm: { padding: '7px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13, outline: 'none', width: 130 },
  cfg: { background: '#fff', border: '1px solid #eef2f7', borderRadius: 8, padding: 20, maxWidth: 460 },
  btn: { padding: '9px 18px', background: '#0891b2', color: '#fff', border: 'none', borderRadius: 7, fontSize: 14, fontWeight: 500, cursor: 'pointer' },
  btnSec: { padding: '8px 14px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: 7, fontSize: 13, cursor: 'pointer' },
  btnMini: { padding: '6px 11px', background: '#0891b2', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' },
  btnMiniRed: { padding: '6px 11px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' },
  btnRedFull: { padding: '9px 18px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 7, fontSize: 14, cursor: 'pointer' },
  btnLink: { padding: '4px 8px', background: 'transparent', color: '#b45309', border: 'none', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' },
  btnRow: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
  ov: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 },
  modal: { background: '#fff', borderRadius: 12, padding: 22, width: 460, maxWidth: '92vw', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' },
  tagIny: { padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700, background: '#e0f2fe', color: '#0369a1', marginLeft: 4 },
  tagPza: { padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700, background: '#ede9fe', color: '#6d28d9', marginLeft: 4 },
  warn: { background: '#fffbeb', border: '1px solid #fde68a', color: '#b45309', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 12 },
  err: { color: '#dc2626', fontSize: 13, marginBottom: 12 },
  ok: { color: '#16a34a', fontSize: 13, marginBottom: 12 },
}
