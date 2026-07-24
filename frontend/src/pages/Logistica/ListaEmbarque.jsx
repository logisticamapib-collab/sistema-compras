import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const hoyISO = () => new Date().toISOString().slice(0, 10)
const addD = (iso, n) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const fmt = (n) => Number(n ?? 0).toLocaleString('es-MX', { maximumFractionDigits: 0 })
const fFecha = (s) => { if (!s) return '-'; const p = String(s).split('-'); return `${p[2]}/${p[1]}/${p[0]}` }
const ceilDiv = (a, b) => (b > 0 ? Math.ceil(a / b) : null)

export default function ListaEmbarque() {
  const { perfil, tienePermiso } = useAuth()
  const puedeGenerar = tienePermiso('log_embarques', 'crear')
  const [clientes, setClientes] = useState([])
  const [desde, setDesde] = useState(hoyISO())
  const [hasta, setHasta] = useState(addD(hoyISO(), 14))
  const [cliente, setCliente] = useState('')
  const [lineas, setLineas] = useState([])
  const [normas, setNormas] = useState({})
  const [fifo, setFifo] = useState({})
  const [expo, setExpo] = useState(null)
  const [sel, setSel] = useState(new Set())
  const [cargando, setCargando] = useState(false)
  const [genMsg, setGenMsg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { base() }, [])

  const base = async () => {
    const emp = perfil.empresa_id
    const { data: cli } = await supabase.from('clientes').select('id, nombre').eq('empresa_id', emp).order('nombre')
    setClientes(cli || [])
    await cargar()
  }

  const cargar = async () => {
    setCargando(true); setSel(new Set()); setGenMsg(''); setError('')
    const [{ data: rl }, { data: ne }, { data: ex }] = await Promise.all([
      supabase.from('release_lineas').select('id, articulo_id, cliente_id, oc_cliente, fecha_requerida, cantidad, tipo, articulos(codigo_interno, descripcion, snp), release_entregas(cantidad)').eq('vigente', true),
      supabase.from('normas_empaque').select('articulo_id, piezas_por_empaque, piezas_por_tarima').eq('tipo', 'oficial').eq('activa', true),
      supabase.from('existencias').select('cantidad, almacen_id, lote:lotes(id, codigo_lote, articulo_id, fecha, estatus_calidad)'),
    ])
    const nm = {}; (ne || []).forEach(n => { if (!nm[n.articulo_id]) nm[n.articulo_id] = n }); setNormas(nm)
    const ff = {}
    ;(ex || []).forEach(e => {
      const l = e.lote
      if (!l || l.estatus_calidad !== 'liberado') return
      ;(ff[l.articulo_id] = ff[l.articulo_id] || []).push({ codigo: l.codigo_lote, fecha: l.fecha, cantidad: Number(e.cantidad) })
    })
    Object.values(ff).forEach(arr => arr.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))))
    setFifo(ff)
    setLineas((rl || []).map(l => {
      const entregado = (l.release_entregas || []).reduce((s, x) => s + Number(x.cantidad || 0), 0)
      return { ...l, entregado, pendiente: Number(l.cantidad) - entregado }
    }).filter(l => l.pendiente > 0))
    setCargando(false)
  }

  const hoy = hoyISO()
  const filtroCli = (l) => !cliente || l.cliente_id === Number(cliente)
  const enRango = lineas.filter(l => filtroCli(l) && l.fecha_requerida >= desde && l.fecha_requerida <= hasta)
  const vencidasFuera = lineas.filter(l => filtroCli(l) && l.fecha_requerida < hoy && l.fecha_requerida < desde)
  const filas = [...vencidasFuera, ...enRango]

  const enrich = (l) => {
    const n = normas[l.articulo_id] || {}
    const snp = Number(l.articulos?.snp) > 0 ? Number(l.articulos.snp) : (n.piezas_por_empaque || 0)
    const dispFifo = (fifo[l.articulo_id] || []).reduce((s, x) => s + x.cantidad, 0)
    return {
      ...l, snp,
      cajas: ceilDiv(l.pendiente, n.piezas_por_empaque || 0),
      tarimas: ceilDiv(l.pendiente, n.piezas_por_tarima || 0),
      vencida: l.fecha_requerida < hoy, fuera: l.fecha_requerida < desde,
      dispFifo, suficiente: dispFifo >= l.pendiente,
    }
  }
  const rows = filas.map(enrich)

  const toggle = (id) => { const s = new Set(sel); s.has(id) ? s.delete(id) : s.add(id); setSel(s) }
  const toggleAll = () => setSel(sel.size === rows.length ? new Set() : new Set(rows.map(r => r.id)))

  const generar = async () => {
    setError(''); setGenMsg('')
    const elegidas = rows.filter(r => sel.has(r.id))
    if (elegidas.length === 0) { setError('Selecciona al menos una linea.'); return }
    // agrupar por cliente -> un embarque por cliente
    const porCliente = {}
    elegidas.forEach(r => { (porCliente[r.cliente_id] = porCliente[r.cliente_id] || []).push(r) })
    const folios = []
    try {
      let i = 0
      for (const cid of Object.keys(porCliente)) {
        const folio = `EMB-${Date.now().toString().slice(-7)}${i++}`
        const { data: emb, error: e1 } = await supabase.from('embarques').insert({
          empresa_id: perfil.empresa_id, folio, cliente_id: Number(cid), site_id: perfil.site_id,
          fecha: hoy, estatus: 'preparando', creado_por: perfil.id,
        }).select().single()
        if (e1) throw e1
        const obj = porCliente[cid].map(r => ({
          embarque_id: emb.id, release_linea_id: r.id, articulo_id: r.articulo_id,
          oc_cliente: r.oc_cliente || null, cantidad_requerida: r.pendiente, fecha_requerida: r.fecha_requerida,
        }))
        const { error: e2 } = await supabase.from('embarque_objetivo').insert(obj)
        if (e2) throw e2
        folios.push(folio)
      }
      setGenMsg(`Orden(es) de embarque generada(s): ${folios.join(', ')}. Ve a "Preparar Embarque" e ingresa el folio para escanear.`)
      setSel(new Set())
    } catch (e) { setError('Error al generar: ' + (e.message || e)) }
  }

  const exportarExcel = () => {
    const data = rows.map(r => ({
      Cliente: clientes.find(c => c.id === r.cliente_id)?.nombre || r.cliente_id,
      Articulo: r.articulos?.codigo_interno, Descripcion: r.articulos?.descripcion,
      'OC cliente': r.oc_cliente || '', SNP: r.snp, Pendiente: r.pendiente,
      Cajas: r.cajas ?? '', Tarimas: r.tarimas ?? '', 'Fecha requerida': fFecha(r.fecha_requerida),
      Estatus: r.vencida ? 'VENCIDA' : 'Vigente',
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Lista de Embarque')
    XLSX.writeFile(wb, `lista_embarque_${desde}_a_${hasta}.xlsx`)
  }

  return (
    <div>
      <style>{`@media print { .no-imprimir { display: none !important; } }`}</style>
      <div style={styles.head} className="no-imprimir">
        <h2 style={styles.titulo}>Lista de Embarque</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          {puedeGenerar && sel.size > 0 && <button style={styles.btnGen} onClick={generar}>Generar orden de embarque ({sel.size})</button>}
          <button style={styles.btnSec} onClick={() => window.print()}>Imprimir / PDF</button>
          <button style={styles.btn} onClick={exportarExcel}>Exportar Excel</button>
        </div>
      </div>

      <div style={styles.filtros} className="no-imprimir">
        <div style={styles.campo}><label style={styles.lbl}>Desde</label><input style={styles.input} type="date" value={desde} onChange={e => setDesde(e.target.value)} /></div>
        <div style={styles.campo}><label style={styles.lbl}>Hasta</label><input style={styles.input} type="date" value={hasta} onChange={e => setHasta(e.target.value)} /></div>
        <div style={styles.campo}><label style={styles.lbl}>Cliente</label>
          <select style={styles.input} value={cliente} onChange={e => setCliente(e.target.value)}>
            <option value="">Todos</option>
            {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select></div>
        <button style={{ ...styles.btnSec, alignSelf: 'flex-end' }} onClick={cargar}>{cargando ? '...' : 'Actualizar'}</button>
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {genMsg && <p style={styles.exito}>{genMsg}</p>}
      {vencidasFuera.length > 0 && (
        <p style={styles.avisoVenc}>
          Atencion: hay <strong>{vencidasFuera.filter(filtroCli).length}</strong> orden(es) <strong>vencidas fuera del rango</strong>.
          Se incluyen igual (marcadas). Favor de cerrarlas o embarcarlas.
        </p>
      )}

      <div style={styles.tabla}>
        <div style={styles.th}>
          <span style={{ width: '30px' }} className="no-imprimir"><input type="checkbox" checked={sel.size === rows.length && rows.length > 0} onChange={toggleAll} /></span>
          <span style={{ flex: 1.4 }}>Articulo</span>
          <span style={{ flex: 2 }}>Descripcion</span>
          <span style={{ flex: 1 }}>OC cliente</span>
          <span style={{ flex: 0.7, textAlign: 'right' }}>SNP</span>
          <span style={{ flex: 0.9, textAlign: 'right' }}>Pendiente</span>
          <span style={{ flex: 0.6, textAlign: 'right' }}>Cajas</span>
          <span style={{ flex: 0.7, textAlign: 'right' }}>Tarimas</span>
          <span style={{ flex: 1, textAlign: 'center' }}>Requerida</span>
        </div>
        {rows.length === 0 && <p style={{ padding: '20px', color: '#666' }}>Sin ordenes pendientes en el rango.</p>}
        {rows.map(r => (
          <div key={r.id}>
            <div style={{ ...styles.tr, backgroundColor: sel.has(r.id) ? '#ecfeff' : r.vencida ? '#fef2f2' : r.fuera ? '#fffbeb' : '#fff' }}>
              <span style={{ width: '30px' }} className="no-imprimir"><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></span>
              <span style={{ flex: 1.4, fontWeight: '600', cursor: 'pointer' }} onClick={() => setExpo(expo === r.id ? null : r.id)}>{expo === r.id ? '▾' : '▸'} {r.articulos?.codigo_interno}</span>
              <span style={{ flex: 2, color: '#475569' }}>{r.articulos?.descripcion}</span>
              <span style={{ flex: 1 }}>{r.oc_cliente || '-'}</span>
              <span style={{ flex: 0.7, textAlign: 'right' }}>{fmt(r.snp)}</span>
              <span style={{ flex: 0.9, textAlign: 'right', fontWeight: '600' }}>{fmt(r.pendiente)}</span>
              <span style={{ flex: 0.6, textAlign: 'right' }}>{r.cajas ?? '-'}</span>
              <span style={{ flex: 0.7, textAlign: 'right' }}>{r.tarimas ?? '-'}</span>
              <span style={{ flex: 1, textAlign: 'center', color: r.vencida ? '#dc2626' : '#334155', fontWeight: r.vencida ? '700' : '400' }}>
                {fFecha(r.fecha_requerida)}{r.vencida ? ' ⚠' : ''}
              </span>
            </div>
            {expo === r.id && (
              <div style={styles.detalle}>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
                  Lotes disponibles (FIFO) — disponible {fmt(r.dispFifo)} de {fmt(r.pendiente)} {r.suficiente ? '' : '(INSUFICIENTE)'}:
                </div>
                {(fifo[r.articulo_id] || []).length === 0 && <div style={{ fontSize: '12px', color: '#dc2626' }}>Sin inventario liberado (aun en produccion).</div>}
                {(fifo[r.articulo_id] || []).map((lt, i) => (
                  <div key={i} style={styles.lote}>
                    <span style={{ flex: 1, fontWeight: '500' }}>{lt.codigo}</span>
                    <span style={{ flex: 1, color: '#64748b' }}>{fFecha(lt.fecha)}</span>
                    <span style={{ flex: 1, textAlign: 'right' }}>{fmt(lt.cantidad)} disp.</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

const styles = {
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: 0 },
  filtros: { display: 'flex', gap: '12px', alignItems: 'flex-end', marginBottom: '16px', flexWrap: 'wrap' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px' },
  lbl: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' },
  btn: { padding: '9px 18px', backgroundColor: '#0891b2', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' },
  btnGen: { padding: '9px 18px', backgroundColor: '#7c3aed', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
  btnSec: { padding: '9px 16px', backgroundColor: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  avisoVenc: { backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '14px' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  th: { display: 'flex', padding: '10px 14px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', alignItems: 'center' },
  tr: { display: 'flex', padding: '11px 14px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px' },
  detalle: { padding: '10px 14px 14px 30px', backgroundColor: '#f8fafc', borderBottom: '1px solid #f1f5f9' },
  lote: { display: 'flex', fontSize: '12px', padding: '4px 0', borderBottom: '1px solid #eef2f7' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
