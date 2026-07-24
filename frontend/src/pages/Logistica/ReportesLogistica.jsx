import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const hoyISO = () => new Date().toISOString().slice(0, 10)
const addD = (iso, n) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const n0 = (x) => Number(x ?? 0).toLocaleString('es-MX', { maximumFractionDigits: 0 })
const n2 = (x) => Number(x ?? 0).toLocaleString('es-MX', { maximumFractionDigits: 2 })
const GRUPO_LBL = { mp: 'Materia Prima', pt_wip: 'PT + WIP', otros: 'Otros' }
const TABS = [['vueltas', 'Vueltas de inventario'], ['dias', 'Dias de inventario'], ['tonelaje', 'Tonelaje'], ['kg', 'Inventario Kg por area'], ['cumplimiento', 'Cumplimiento de entregas'], ['objetivos', 'Objetivos']]

export default function ReportesLogistica() {
  const { perfil, tienePermiso } = useAuth()
  const puedeEditarObj = tienePermiso('log_consultas', 'editar') || tienePermiso('log_consultas', 'crear')

  const [tab, setTab] = useState('vueltas')
  const [desde, setDesde] = useState(addD(hoyISO(), -30))
  const [hasta, setHasta] = useState(hoyISO())
  const [base, setBase] = useState('costo')
  const [cliente, setCliente] = useState('')
  const [clientes, setClientes] = useState([])
  const [rows, setRows] = useState([])
  const [objetivos, setObjetivos] = useState({})
  const [kgArea, setKgArea] = useState([])
  const [entregas, setEntregas] = useState([])
  const [cargando, setCargando] = useState(false)

  useEffect(() => { cargarClientes(); cargar() }, [])

  const cargarClientes = async () => {
    const { data } = await supabase.from('clientes').select('id, nombre').eq('empresa_id', perfil.empresa_id).order('nombre')
    setClientes(data || [])
  }

  const cargar = async () => {
    setCargando(true)
    const emp = perfil.empresa_id
    const [{ data: kpi }, { data: obj }, { data: ex }, { data: rl }] = await Promise.all([
      supabase.rpc('kpi_logistica', { p_empresa: emp, p_desde: desde, p_hasta: hasta }),
      supabase.from('kpi_objetivos').select('*').eq('empresa_id', emp),
      supabase.from('existencias').select('cantidad, almacen_id, almacenes(clave, nombre), lote:lotes(articulo_id, articulos(codigo_interno, descripcion, unidad_medida, es_consigna, categorias(tipo)))'),
      supabase.from('release_lineas').select('id, cliente_id, articulo_id, fecha_requerida, cantidad, articulos(codigo_interno), release_entregas(cantidad, fecha_entrega)').eq('vigente', true).gte('fecha_requerida', desde).lte('fecha_requerida', hasta),
    ])
    setRows(kpi || [])
    const om = {}; (obj || []).forEach(o => { om[o.grupo] = o }); setObjetivos(om)
    // Kg por area (MP)
    const kg = {}
    ;(ex || []).forEach(e => {
      const a = e.lote?.articulos; if (!a) return
      const esMP = a.es_consigna || a.categorias?.tipo === 'materia_prima'
      if (!esMP) return
      const alm = e.almacenes?.clave || `Alm ${e.almacen_id}`
      const k = `${e.almacen_id}|${e.lote.articulo_id}`
      if (!kg[k]) kg[k] = { almacen: alm, codigo: a.codigo_interno, descripcion: a.descripcion, kg: 0 }
      kg[k].kg += Number(e.cantidad)
    })
    setKgArea(Object.values(kg).sort((a, b) => a.almacen.localeCompare(b.almacen) || a.codigo.localeCompare(b.codigo)))
    setEntregas((rl || []).map(l => {
      const ent = (l.release_entregas || []).reduce((s, x) => s + Number(x.cantidad || 0), 0)
      const aTiempo = (l.release_entregas || []).some(x => x.fecha_entrega && x.fecha_entrega <= l.fecha_requerida) && ent >= Number(l.cantidad)
      return { ...l, entregado: ent, requerido: Number(l.cantidad), fill: Number(l.cantidad) > 0 ? ent / Number(l.cantidad) : 0, aTiempo }
    }).filter(l => !cliente || l.cliente_id === Number(cliente)))
    setCargando(false)
  }

  const pesoKg = (r, q) => r.grupo === 'mp' ? Number(q) : r.grupo === 'pt_wip' ? Number(q) * (Number(r.peso_pieza_g) / 1000) : 0
  const val = (r, q) => base === 'costo' ? Number(q) * Number(r.costo) : pesoKg(r, q)
  const invIni = (r) => Number(r.onhand) - Number(r.ent_ge_desde) + Number(r.sal_ge_desde)
  const invFin = (r) => Number(r.onhand) - Number(r.ent_gt_hasta) + Number(r.sal_gt_hasta)
  const diasPeriodo = Math.max(1, Math.round((new Date(hasta) - new Date(desde)) / 86400000) + 1)

  // ---- Vueltas por grupo ----
  const vueltasGrupo = ['mp', 'pt_wip', 'otros'].map(g => {
    const rg = rows.filter(r => r.grupo === g)
    const II = rg.reduce((s, r) => s + val(r, invIni(r)), 0)
    const IF = rg.reduce((s, r) => s + val(r, invFin(r)), 0)
    const C = rg.reduce((s, r) => s + val(r, r.compras_p), 0)
    const Emb = rg.reduce((s, r) => s + val(r, r.emb_p), 0)
    const Cons = rg.reduce((s, r) => s + val(r, r.cons_p), 0)
    const avg = (II + IF) / 2
    const num = g === 'mp' ? (II + C - IF) : g === 'pt_wip' ? Emb : (Cons + Emb)
    const vueltas = avg > 0 ? num / avg : 0
    const obj = Number(objetivos[g]?.vueltas_objetivo || 0)
    return { g, II, IF, C, Emb, Cons, avg, num, vueltas, obj, cumple: obj > 0 && vueltas >= obj }
  })

  // ---- Dias de inventario por articulo ----
  const diasRows = rows.map(r => {
    const uso = r.grupo === 'pt_wip' ? Number(r.emb_p) : Number(r.cons_p)
    const daily = uso / diasPeriodo
    const dias = daily > 0 ? Number(r.onhand) / daily : null
    const seg = Number(r.dias_seg)
    return { ...r, dias, seg, cumple: seg > 0 && dias != null ? dias >= seg : null }
  }).filter(r => Number(r.onhand) > 0 || Number(r.emb_p) > 0 || Number(r.cons_p) > 0)
  const cumplenSeg = diasRows.filter(r => r.cumple === true).length
  const conPolitica = diasRows.filter(r => r.seg > 0).length

  // ---- Tonelaje ----
  const ton = (campo) => rows.reduce((s, r) => s + pesoKg(r, r[campo]) / 1000, 0)
  const tonEmb = ton('emb_p'), tonProd = ton('prod_p'), tonComp = ton('compras_p')

  // ---- Cumplimiento ----
  const totReq = entregas.reduce((s, l) => s + l.requerido, 0)
  const totEnt = entregas.reduce((s, l) => s + l.entregado, 0)
  const aTiempo = entregas.filter(l => l.aTiempo).length

  const exportar = (data, nombre) => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), nombre.slice(0, 28))
    XLSX.writeFile(wb, `${nombre}_${desde}_a_${hasta}.xlsx`)
  }

  const guardarObjetivo = async (g, campo, valor) => {
    const cur = objetivos[g] || { empresa_id: perfil.empresa_id, grupo: g, vueltas_objetivo: 0, dias_objetivo: 0 }
    const upd = { ...cur, [campo]: parseFloat(valor) || 0 }
    setObjetivos({ ...objetivos, [g]: upd })
  }
  const persistirObjetivos = async () => {
    const filas = ['mp', 'pt_wip', 'otros'].map(g => ({
      empresa_id: perfil.empresa_id, grupo: g,
      vueltas_objetivo: parseFloat(objetivos[g]?.vueltas_objetivo) || 0,
      dias_objetivo: parseFloat(objetivos[g]?.dias_objetivo) || 0,
    }))
    await supabase.from('kpi_objetivos').upsert(filas, { onConflict: 'empresa_id,grupo' })
    await cargar()
  }

  return (
    <div>
      <div style={styles.head}>
        <h2 style={styles.titulo}>Reportes y KPIs de Logistica</h2>
      </div>

      <div style={styles.filtros}>
        <div style={styles.campo}><label style={styles.lbl}>Desde</label><input style={styles.input} type="date" value={desde} onChange={e => setDesde(e.target.value)} /></div>
        <div style={styles.campo}><label style={styles.lbl}>Hasta</label><input style={styles.input} type="date" value={hasta} onChange={e => setHasta(e.target.value)} /></div>
        <div style={styles.campo}><label style={styles.lbl}>Base</label>
          <select style={styles.input} value={base} onChange={e => setBase(e.target.value)}>
            <option value="costo">Costo / Unidad</option>
            <option value="peso">Peso (Ton) - solo MP/PT/WIP</option>
          </select></div>
        {tab === 'cumplimiento' && (
          <div style={styles.campo}><label style={styles.lbl}>Cliente</label>
            <select style={styles.input} value={cliente} onChange={e => setCliente(e.target.value)}>
              <option value="">Todos</option>{clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select></div>
        )}
        <button style={{ ...styles.btn, alignSelf: 'flex-end' }} onClick={cargar}>{cargando ? '...' : 'Actualizar'}</button>
      </div>

      <div style={styles.tabs}>
        {TABS.map(([id, lbl]) => <button key={id} style={tab === id ? styles.tabAct : styles.tab} onClick={() => setTab(id)}>{lbl}</button>)}
      </div>

      {tab === 'vueltas' && (
        <div style={styles.tarjeta}>
          <div style={styles.tt}><h3 style={styles.subt}>Vueltas de inventario ({base === 'costo' ? 'costo' : 'peso'})</h3>
            <button style={styles.btnSec} onClick={() => exportar(vueltasGrupo.map(v => ({ Grupo: GRUPO_LBL[v.g], InvInicial: v.II, InvFinal: v.IF, Compras: v.C, Embarques: v.Emb, Consumo: v.Cons, InvPromedio: v.avg, Vueltas: v.vueltas, Objetivo: v.obj })), 'vueltas')}>Excel</button></div>
          <div style={styles.th}><span style={{ flex: 1.4 }}>Grupo</span><span style={{ flex: 1, textAlign: 'right' }}>Inv. prom.</span><span style={{ flex: 1, textAlign: 'right' }}>Flujo periodo</span><span style={{ flex: 0.8, textAlign: 'right' }}>Vueltas</span><span style={{ flex: 0.8, textAlign: 'right' }}>Objetivo</span><span style={{ flex: 0.8, textAlign: 'center' }}>Cumple</span></div>
          {vueltasGrupo.map(v => (
            <div key={v.g} style={styles.tr}>
              <span style={{ flex: 1.4, fontWeight: 600 }}>{GRUPO_LBL[v.g]}</span>
              <span style={{ flex: 1, textAlign: 'right' }}>{n0(v.avg)}</span>
              <span style={{ flex: 1, textAlign: 'right' }}>{n0(v.num)}</span>
              <span style={{ flex: 0.8, textAlign: 'right', fontWeight: 700 }}>{n2(v.vueltas)}</span>
              <span style={{ flex: 0.8, textAlign: 'right' }}>{n2(v.obj)}</span>
              <span style={{ flex: 0.8, textAlign: 'center' }}>{v.obj > 0 ? (v.cumple ? <span style={styles.ok}>SI</span> : <span style={styles.no}>NO</span>) : '-'}</span>
            </div>
          ))}
          <p style={styles.nota}>MP = (Inv.inicial + Compras - Inv.final) / Inv.promedio. PT+WIP = Embarques / Inv.promedio. En base peso, "Otros" no aplica.</p>
        </div>
      )}

      {tab === 'dias' && (
        <div style={styles.tarjeta}>
          <div style={styles.tt}><h3 style={styles.subt}>Dias de inventario vs politica — cumplen {cumplenSeg} de {conPolitica} con politica</h3>
            <button style={styles.btnSec} onClick={() => exportar(diasRows.map(r => ({ Articulo: r.codigo, Grupo: GRUPO_LBL[r.grupo], OnHand: Number(r.onhand), DiasInventario: r.dias == null ? '' : Number(r.dias.toFixed(1)), DiasSeguridad: r.seg, Cumple: r.cumple == null ? 'N/A' : r.cumple ? 'SI' : 'NO' })), 'dias_inventario')}>Excel</button></div>
          <div style={styles.th}><span style={{ flex: 1.4 }}>Articulo</span><span style={{ flex: 1 }}>Grupo</span><span style={{ flex: 1, textAlign: 'right' }}>On hand</span><span style={{ flex: 1, textAlign: 'right' }}>Dias inv.</span><span style={{ flex: 1, textAlign: 'right' }}>Dias seg.</span><span style={{ flex: 0.8, textAlign: 'center' }}>Cumple</span></div>
          {diasRows.map(r => (
            <div key={r.articulo_id} style={styles.tr}>
              <span style={{ flex: 1.4, fontWeight: 600 }}>{r.codigo}</span>
              <span style={{ flex: 1, color: '#64748b' }}>{GRUPO_LBL[r.grupo]}</span>
              <span style={{ flex: 1, textAlign: 'right' }}>{n0(r.onhand)}</span>
              <span style={{ flex: 1, textAlign: 'right', fontWeight: 600 }}>{r.dias == null ? '-' : n2(r.dias)}</span>
              <span style={{ flex: 1, textAlign: 'right' }}>{r.seg > 0 ? n0(r.seg) : '-'}</span>
              <span style={{ flex: 0.8, textAlign: 'center' }}>{r.cumple == null ? '-' : r.cumple ? <span style={styles.ok}>SI</span> : <span style={styles.no}>NO</span>}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'tonelaje' && (
        <div style={styles.tarjeta}>
          <h3 style={styles.subt}>Tonelaje del periodo (MP/PT/WIP)</h3>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            {[['Embarcado', tonEmb, '#16a34a'], ['Producido', tonProd, '#c2410c'], ['Comprado', tonComp, '#2563eb']].map(([l, v, c]) => (
              <div key={l} style={{ ...styles.kpi, borderColor: c }}><div style={{ fontSize: 12, color: '#64748b' }}>{l}</div><div style={{ fontSize: 26, fontWeight: 700, color: c }}>{n2(v)} Ton</div></div>
            ))}
          </div>
        </div>
      )}

      {tab === 'kg' && (
        <div style={styles.tarjeta}>
          <div style={styles.tt}><h3 style={styles.subt}>Inventario de MP en Kg por area</h3><button style={styles.btnSec} onClick={() => exportar(kgArea.map(k => ({ Area: k.almacen, Articulo: k.codigo, Descripcion: k.descripcion, Kg: k.kg })), 'inventario_kg')}>Excel</button></div>
          <div style={styles.th}><span style={{ flex: 1 }}>Area</span><span style={{ flex: 1.2 }}>Articulo</span><span style={{ flex: 2 }}>Descripcion</span><span style={{ flex: 1, textAlign: 'right' }}>Kg</span></div>
          {kgArea.map((k, i) => (
            <div key={i} style={styles.tr}><span style={{ flex: 1 }}>{k.almacen}</span><span style={{ flex: 1.2, fontWeight: 600 }}>{k.codigo}</span><span style={{ flex: 2, color: '#64748b' }}>{k.descripcion}</span><span style={{ flex: 1, textAlign: 'right', fontWeight: 600 }}>{n0(k.kg)}</span></div>
          ))}
          {kgArea.length === 0 && <p style={{ color: '#666', padding: 10 }}>Sin inventario de MP.</p>}
        </div>
      )}

      {tab === 'cumplimiento' && (
        <div style={styles.tarjeta}>
          <div style={styles.tt}><h3 style={styles.subt}>Cumplimiento de entregas</h3><button style={styles.btnSec} onClick={() => exportar(entregas.map(l => ({ Articulo: l.articulos?.codigo_interno, Requerida: l.fecha_requerida, Requerido: l.requerido, Entregado: l.entregado, Fill: (l.fill * 100).toFixed(0) + '%', ATiempo: l.aTiempo ? 'SI' : 'NO' })), 'cumplimiento')}>Excel</button></div>
          <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={styles.kpi}><div style={{ fontSize: 12, color: '#64748b' }}>Fill rate</div><div style={{ fontSize: 22, fontWeight: 700 }}>{totReq > 0 ? n0(totEnt / totReq * 100) : 0}%</div></div>
            <div style={styles.kpi}><div style={{ fontSize: 12, color: '#64748b' }}>Lineas a tiempo</div><div style={{ fontSize: 22, fontWeight: 700 }}>{aTiempo} / {entregas.length}</div></div>
          </div>
          <div style={styles.th}><span style={{ flex: 1.2 }}>Articulo</span><span style={{ flex: 1, textAlign: 'center' }}>Requerida</span><span style={{ flex: 1, textAlign: 'right' }}>Requerido</span><span style={{ flex: 1, textAlign: 'right' }}>Entregado</span><span style={{ flex: 0.8, textAlign: 'right' }}>Fill</span><span style={{ flex: 0.8, textAlign: 'center' }}>A tiempo</span></div>
          {entregas.map(l => (
            <div key={l.id} style={styles.tr}>
              <span style={{ flex: 1.2, fontWeight: 600 }}>{l.articulos?.codigo_interno}</span>
              <span style={{ flex: 1, textAlign: 'center' }}>{l.fecha_requerida}</span>
              <span style={{ flex: 1, textAlign: 'right' }}>{n0(l.requerido)}</span>
              <span style={{ flex: 1, textAlign: 'right' }}>{n0(l.entregado)}</span>
              <span style={{ flex: 0.8, textAlign: 'right' }}>{n0(l.fill * 100)}%</span>
              <span style={{ flex: 0.8, textAlign: 'center' }}>{l.aTiempo ? <span style={styles.ok}>SI</span> : <span style={styles.no}>NO</span>}</span>
            </div>
          ))}
          {entregas.length === 0 && <p style={{ color: '#666', padding: 10 }}>Sin lineas en el rango.</p>}
        </div>
      )}

      {tab === 'objetivos' && (
        <div style={styles.tarjeta}>
          <h3 style={styles.subt}>Objetivos por grupo</h3>
          <div style={styles.th}><span style={{ flex: 1.4 }}>Grupo</span><span style={{ flex: 1 }}>Vueltas objetivo</span><span style={{ flex: 1 }}>Dias inventario objetivo</span></div>
          {['mp', 'pt_wip', 'otros'].map(g => (
            <div key={g} style={styles.tr}>
              <span style={{ flex: 1.4, fontWeight: 600 }}>{GRUPO_LBL[g]}</span>
              <span style={{ flex: 1 }}><input type="number" step="0.1" disabled={!puedeEditarObj} style={{ ...styles.input, maxWidth: 120 }} value={objetivos[g]?.vueltas_objetivo ?? ''} onChange={e => guardarObjetivo(g, 'vueltas_objetivo', e.target.value)} /></span>
              <span style={{ flex: 1 }}><input type="number" step="1" disabled={!puedeEditarObj} style={{ ...styles.input, maxWidth: 120 }} value={objetivos[g]?.dias_objetivo ?? ''} onChange={e => guardarObjetivo(g, 'dias_objetivo', e.target.value)} /></span>
            </div>
          ))}
          {puedeEditarObj && <div style={{ marginTop: 14 }}><button style={styles.btn} onClick={persistirObjetivos}>Guardar objetivos</button></div>}
        </div>
      )}
    </div>
  )
}

const styles = {
  head: { marginBottom: 12 },
  titulo: { fontSize: 18, fontWeight: 600, color: '#1a1a2e', margin: 0 },
  filtros: { display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 14, flexWrap: 'wrap' },
  campo: { display: 'flex', flexDirection: 'column', gap: 4 },
  lbl: { fontSize: 12, fontWeight: 500, color: '#444' },
  input: { padding: '9px 12px', borderRadius: 7, border: '1px solid #ddd', fontSize: 14, outline: 'none' },
  btn: { padding: '9px 18px', backgroundColor: '#0891b2', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  btnSec: { padding: '7px 14px', backgroundColor: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 12, cursor: 'pointer' },
  tabs: { display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap' },
  tab: { padding: '8px 14px', border: 'none', background: 'transparent', fontSize: 13, color: '#64748b', cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabAct: { padding: '8px 14px', border: 'none', background: 'transparent', fontSize: 13, color: '#0891b2', fontWeight: 600, cursor: 'pointer', borderBottom: '2px solid #0891b2' },
  tarjeta: { backgroundColor: '#fff', borderRadius: 10, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tt: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  subt: { fontSize: 14, fontWeight: 600, color: '#1a1a2e', margin: 0 },
  th: { display: 'flex', gap: 10, padding: '8px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' },
  tr: { display: 'flex', gap: 10, padding: '9px 8px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: 13 },
  ok: { backgroundColor: '#dcfce7', color: '#16a34a', borderRadius: 20, padding: '2px 8px', fontSize: 10, fontWeight: 700 },
  no: { backgroundColor: '#fee2e2', color: '#dc2626', borderRadius: 20, padding: '2px 8px', fontSize: 10, fontWeight: 700 },
  kpi: { border: '2px solid #e2e8f0', borderRadius: 10, padding: '12px 20px', minWidth: 160 },
  nota: { fontSize: 11, color: '#94a3b8', marginTop: 10 },
}
