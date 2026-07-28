import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Reprogramaciones sugeridas por el MRP.
// Toma la ultima corrida (cubos de demanda por articulo) y el suministro que YA existe
// (OT, OC, consigna, maquila). Mediante un pegging simple asigna a cada orden la fecha
// en que realmente se necesita y sugiere: ADELANTAR (llega tarde), DIFERIR (llega antes
// de tiempo) o CANCELAR (sobra). El usuario puede aplicar el cambio de fecha.

const fFecha = (s) => s ? new Date(s + 'T00:00:00').toLocaleDateString('es-MX') : '-'
const fmt = (n) => (Number(n) || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 })
const ACC = {
  adelantar: { l: 'Adelantar', c: '#dc2626' },
  diferir: { l: 'Diferir', c: '#2563eb' },
  cancelar: { l: 'Cancelar / sobra', c: '#b45309' },
}
const TIPO_L = { ot: 'OT', oc: 'OC compra', consigna: 'Consigna', maquila: 'Maquila' }

export default function ExcepcionesMRP() {
  const { perfil, tienePermiso } = useAuth()
  const emp = perfil.empresa_id
  const puede = tienePermiso('plan_ordenes', 'crear')

  const [corridas, setCorridas] = useState([])
  const [corrida, setCorrida] = useState(null)
  const [arts, setArts] = useState([])
  const [sugerencias, setSugerencias] = useState([])
  const [loading, setLoading] = useState(true)
  const [proc, setProc] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [fAcc, setFAcc] = useState('')

  useEffect(() => { cargarCorridas() }, [])
  const cargarCorridas = async () => {
    const { data } = await supabase.from('mrp_corridas').select('id, fecha_corrida, ordenes_sugeridas').eq('empresa_id', emp).eq('estado', 'completada').order('fecha_corrida', { ascending: false }).limit(20)
    setCorridas(data || [])
    if (data && data.length) { setCorrida(data[0].id); analizar(data[0].id) } else setLoading(false)
  }

  const bucketIdx = (buckets, fecha) => {
    if (!fecha) return 0
    for (let i = 0; i < buckets.length; i++) if (fecha >= buckets[i].ini && fecha <= buckets[i].fin) return i
    if (fecha < buckets[0].ini) return 0
    return buckets.length - 1
  }

  const analizar = async (corridaId) => {
    setLoading(true); setError(''); setExito('')
    // 1) cubos de la corrida por articulo
    const { data: res } = await supabase.from('mrp_resultados')
      .select('articulo_id, cubo_inicio, cubo_fin, demanda_bruta, disponible_inicial, stock_seguridad')
      .eq('corrida_id', corridaId).order('articulo_id').order('cubo_inicio')
    const porArt = {}
    ;(res || []).forEach(r => { (porArt[r.articulo_id] = porArt[r.articulo_id] || []).push(r) })

    // 2) suministro existente
    const [ot, oc, co, mq, ar] = await Promise.all([
      supabase.from('ot_articulos').select('articulo_id, cantidad_programada, cantidad_producida, ot:ordenes_trabajo!inner(id, folio, fecha_programada, estatus, empresa_id)').eq('ot.empresa_id', emp).in('ot.estatus', ['programada', 'en_proceso']),
      supabase.from('oc_lineas').select('id, articulo_id, cantidad, cantidad_recibida, oc:ordenes_compra!inner(id, folio, fecha_entrega_estimada, estatus, empresa_id)').eq('oc.empresa_id', emp).neq('oc.estatus', 'cancelada'),
      supabase.from('consigna_autorizacion_lineas').select('id, articulo_id, cantidad, cantidad_recibida, fecha_sugerida, ca:consigna_autorizaciones!inner(id, folio, estatus, empresa_id)').eq('ca.empresa_id', emp).neq('ca.estatus', 'cancelada'),
      supabase.from('om_lineas').select('id, fecha_requerida, cantidad, cantidad_recibida, vigente, om:ordenes_maquila!inner(id, folio, articulo_id, empresa_id)').eq('om.empresa_id', emp).eq('vigente', true),
      supabase.from('articulos').select('id, codigo_interno, descripcion').eq('empresa_id', emp),
    ])
    setArts(ar.data || [])

    const supByArt = {}
    const push = (aid, s) => { if (s.qty > 0) (supByArt[aid] = supByArt[aid] || []).push(s) }
    ;(ot.data || []).forEach(x => push(x.articulo_id, { tipo: 'ot', orden_id: x.ot.id, linea_id: x.ot.id, ref: x.ot.folio, qty: Number(x.cantidad_programada) - Number(x.cantidad_producida || 0), fecha: x.ot.fecha_programada }))
    ;(oc.data || []).forEach(x => push(x.articulo_id, { tipo: 'oc', orden_id: x.oc.id, linea_id: x.id, ref: x.oc.folio, qty: Number(x.cantidad) - Number(x.cantidad_recibida || 0), fecha: x.oc.fecha_entrega_estimada }))
    ;(co.data || []).forEach(x => push(x.articulo_id, { tipo: 'consigna', orden_id: x.ca.id, linea_id: x.id, ref: x.ca.folio || `CONS-${x.ca.id}`, qty: Number(x.cantidad) - Number(x.cantidad_recibida || 0), fecha: x.fecha_sugerida }))
    ;(mq.data || []).forEach(x => push(x.om.articulo_id, { tipo: 'maquila', orden_id: x.om.id, linea_id: x.id, ref: x.om.folio, qty: Number(x.cantidad) - Number(x.cantidad_recibida || 0), fecha: x.fecha_requerida }))

    // 3) pegging por articulo
    const out = []
    Object.keys(supByArt).forEach(aid => {
      const rows = porArt[aid]
      const sups = supByArt[aid]
      if (!rows || rows.length === 0) { // sin demanda en el horizonte => sobra
        sups.forEach(s => out.push({ ...s, articulo_id: Number(aid), accion: 'cancelar' }))
        return
      }
      const buckets = rows.map(r => ({ ini: r.cubo_inicio, fin: r.cubo_fin, D: Number(r.demanda_bruta) || 0, SS: Number(r.stock_seguridad) || 0 }))
      const onHand = Number(rows[0].disponible_inicial) || 0
      const S = sups.map(s => ({ ...s, articulo_id: Number(aid), usado: false, neededIdx: null, bIdx: bucketIdx(buckets, s.fecha) }))
        .sort((a, b) => (a.fecha || '9999').localeCompare(b.fecha || '9999'))
      let inv = onHand
      for (let i = 0; i < buckets.length; i++) {
        inv -= buckets[i].D
        let guard = 0
        while (inv < buckets[i].SS && guard < 2000) {
          const s = S.find(x => !x.usado)
          if (!s) break
          s.usado = true; s.neededIdx = i; inv += s.qty; guard++
        }
      }
      S.forEach(s => {
        if (!s.usado) { out.push({ ...s, accion: 'cancelar' }); return }
        if (s.neededIdx < s.bIdx) out.push({ ...s, accion: 'adelantar', nuevaFecha: buckets[s.neededIdx].ini })
        else if (s.neededIdx > s.bIdx) out.push({ ...s, accion: 'diferir', nuevaFecha: buckets[s.neededIdx].ini })
        // igual => sin sugerencia
      })
    })
    setSugerencias(out)
    setLoading(false)
  }

  const artDe = (id) => arts.find(a => a.id === id)

  const aplicar = async (s) => {
    if (s.accion === 'cancelar' || !s.nuevaFecha) return
    setProc(true); setError('')
    try {
      if (s.tipo === 'ot') {
        await supabase.from('ordenes_trabajo').update({ fecha_programada: s.nuevaFecha }).eq('id', s.orden_id)
        await supabase.from('programa_cambios').insert({ empresa_id: emp, ot_id: s.orden_id, tipo: 'reprogramacion_mrp', campo: 'fecha', antes: s.fecha, despues: s.nuevaFecha, usuario_id: perfil.id, usuario_nombre: perfil.nombre })
      } else if (s.tipo === 'oc') {
        await supabase.from('ordenes_compra').update({ fecha_entrega_estimada: s.nuevaFecha }).eq('id', s.orden_id)
      } else if (s.tipo === 'consigna') {
        await supabase.from('consigna_autorizacion_lineas').update({ fecha_sugerida: s.nuevaFecha }).eq('id', s.linea_id)
      } else if (s.tipo === 'maquila') {
        await supabase.from('om_lineas').update({ fecha_requerida: s.nuevaFecha }).eq('id', s.linea_id)
      }
      setSugerencias(prev => prev.filter(x => !(x.tipo === s.tipo && x.linea_id === s.linea_id)))
      setExito(`${TIPO_L[s.tipo]} ${s.ref}: fecha ajustada a ${fFecha(s.nuevaFecha)}.`)
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  const lista = sugerencias.filter(s => !fAcc || s.accion === fAcc)
  const cuenta = (a) => sugerencias.filter(s => s.accion === a).length

  if (loading) return <p style={{ padding: 28, color: '#666' }}>Analizando...</p>

  return (
    <div style={S.c} className="aparecer">
      <div style={S.head}>
        <div>
          <h2 style={S.t}>Reprogramaciones sugeridas por el MRP</h2>
          <p style={S.sub}>Compara la demanda de la corrida contra las OT, OC, consigna y maquila que ya existen.</p>
        </div>
        <select style={S.input} value={corrida || ''} onChange={e => { setCorrida(Number(e.target.value)); analizar(Number(e.target.value)) }}>
          {corridas.map(c => <option key={c.id} value={c.id}>Corrida #{c.id} · {new Date(c.fecha_corrida).toLocaleDateString('es-MX')}</option>)}
        </select>
      </div>
      {error && <p style={S.err}>{error}</p>}
      {exito && <p style={S.ok}>{exito}</p>}

      <div style={S.filtros}>
        {[['', 'Todas'], ['adelantar', `Adelantar (${cuenta('adelantar')})`], ['diferir', `Diferir (${cuenta('diferir')})`], ['cancelar', `Cancelar/sobra (${cuenta('cancelar')})`]].map(([k, l]) => (
          <button key={k} style={fAcc === k ? S.segOn : S.seg} onClick={() => setFAcc(k)}>{l}</button>
        ))}
      </div>

      {lista.length === 0 ? (
        <p style={{ color: '#64748b', padding: '12px 4px' }}>No hay reprogramaciones sugeridas para esta corrida. Las fechas de tus órdenes coinciden con lo que se necesita.</p>
      ) : (
        <div style={S.tabla}>
          <div style={S.th}><span style={{ flex: 1 }}>Orden</span><span style={{ flex: 1.4 }}>Articulo</span><span style={{ flex: 0.8, textAlign: 'right' }}>Cant.</span><span style={{ flex: 1 }}>Fecha actual</span><span style={{ flex: 1 }}>Sugerido</span><span style={{ flex: 1 }}>Accion</span><span style={{ width: 90 }}></span></div>
          {lista.map((s, i) => (
            <div key={i} style={S.tr}>
              <span style={{ flex: 1 }}><span style={S.tipoTag}>{TIPO_L[s.tipo]}</span> <b>{s.ref}</b></span>
              <span style={{ flex: 1.4, fontSize: 13 }}>{artDe(s.articulo_id)?.codigo_interno} <span style={{ color: '#94a3b8' }}>{artDe(s.articulo_id)?.descripcion}</span></span>
              <span style={{ flex: 0.8, textAlign: 'right' }}>{fmt(s.qty)}</span>
              <span style={{ flex: 1, color: '#64748b', fontSize: 13 }}>{fFecha(s.fecha)}</span>
              <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{s.nuevaFecha ? fFecha(s.nuevaFecha) : '-'}</span>
              <span style={{ flex: 1 }}><span style={{ ...S.pill, backgroundColor: ACC[s.accion].c + '22', color: ACC[s.accion].c }}>{ACC[s.accion].l}</span></span>
              <span style={{ width: 90, textAlign: 'right' }}>
                {puede && s.accion !== 'cancelar' && <button style={S.btn} disabled={proc} onClick={() => aplicar(s)}>Aplicar</button>}
              </span>
            </div>
          ))}
        </div>
      )}
      <p style={S.nota}>Nota: "Cancelar/sobra" es solo un aviso (el material ya está pedido y no se necesita en el horizonte); revísalo y cancela manualmente si aplica. "Adelantar" y "Diferir" ajustan la fecha de la orden al aplicarse.</p>
    </div>
  )
}

const S = {
  c: { padding: 24, maxWidth: 1080 },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 12 },
  t: { fontSize: 18, fontWeight: 600, color: '#1a1a2e', margin: 0 },
  sub: { fontSize: 13, color: '#64748b', margin: '4px 0 0' },
  filtros: { display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' },
  seg: { padding: '7px 14px', background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, cursor: 'pointer' },
  segOn: { padding: '7px 14px', background: '#9333ea', color: '#fff', border: '1px solid #9333ea', borderRadius: 7, fontSize: 13, cursor: 'pointer' },
  tabla: { background: '#fff', border: '1px solid #eef2f7', borderRadius: 8, overflow: 'hidden' },
  th: { display: 'flex', padding: '11px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' },
  tr: { display: 'flex', padding: '10px 16px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: 13 },
  input: { padding: '8px 12px', borderRadius: 7, border: '1px solid #ddd', fontSize: 13, outline: 'none' },
  btn: { padding: '6px 12px', background: '#9333ea', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' },
  pill: { padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700 },
  tipoTag: { padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: '#ede9fe', color: '#6d28d9' },
  nota: { fontSize: 12, color: '#94a3b8', marginTop: 12, lineHeight: 1.5 },
  err: { color: '#dc2626', fontSize: 13, marginBottom: 12 },
  ok: { color: '#16a34a', fontSize: 13, marginBottom: 12 },
}
