import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const hoyISO = () => new Date().toISOString().slice(0, 10)
const fmt = (n) => Number(n ?? 0).toLocaleString('es-MX', { maximumFractionDigits: 0 })
const fFecha = (s) => { if (!s) return '-'; const p = String(s).split('-'); return `${p[2]}/${p[1]}/${p[0]}` }

export default function EmbarquePreparar() {
  const { perfil, tienePermiso } = useAuth()
  const puede = tienePermiso('log_embarques', 'crear')

  const [clientes, setClientes] = useState([])
  const [prep, setPrep] = useState([])            // embarques en preparacion
  const [form, setForm] = useState({ cliente_id: '', fecha: hoyISO(), transportista: '' })
  const [emb, setEmb] = useState(null)
  const [lineas, setLineas] = useState([])
  const [fifo, setFifo] = useState({})            // articulo_id -> [{lote_id, codigo, fecha, cantidad}]
  const [scan, setScan] = useState('')
  const [manual, setManual] = useState({ articulo_id: '', lote: '', cantidad: '' })
  const [articulos, setArticulos] = useState([])
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { base() }, [])

  const base = async () => {
    const emp = perfil.empresa_id
    const [{ data: cli }, { data: pr }, { data: arts }] = await Promise.all([
      supabase.from('clientes').select('id, nombre').eq('empresa_id', emp).order('nombre'),
      supabase.from('embarques').select('*, clientes(nombre)').eq('empresa_id', emp).eq('estatus', 'preparando').order('id', { ascending: false }),
      supabase.from('articulos').select('id, codigo_interno, descripcion').eq('empresa_id', emp).order('codigo_interno'),
    ])
    setClientes(cli || []); setPrep(pr || []); setArticulos(arts || [])
  }

  const iniciar = async () => {
    setError('')
    if (!form.cliente_id) { setError('Selecciona el cliente.'); return }
    const folio = `EMB-${Date.now().toString().slice(-8)}`
    const { data, error } = await supabase.from('embarques').insert({
      empresa_id: perfil.empresa_id, folio, cliente_id: parseInt(form.cliente_id), site_id: perfil.site_id,
      fecha: form.fecha, transportista: form.transportista || null, estatus: 'preparando', creado_por: perfil.id,
    }).select('*, clientes(nombre)').single()
    if (error) { setError(error.message); return }
    await base(); abrir(data)
  }

  const abrir = async (e) => {
    setEmb(e); setError(''); setMsg('')
    const { data: ls } = await supabase.from('embarque_lineas')
      .select('*, articulos(codigo_interno), lotes(codigo_lote), contenedores(folio, tipo)')
      .eq('embarque_id', e.id)
    setLineas(ls || [])
    // FIFO disponible por articulo (lotes liberados con existencia)
    const { data: ex } = await supabase.from('existencias')
      .select('cantidad, lote:lotes(id, codigo_lote, articulo_id, fecha, estatus_calidad)')
    const ff = {}
    ;(ex || []).forEach(x => {
      const l = x.lote
      if (!l || l.estatus_calidad !== 'liberado') return
      const g = ff[l.articulo_id] = ff[l.articulo_id] || {}
      const k = l.id
      if (!g[k]) g[k] = { lote_id: l.id, codigo: l.codigo_lote, fecha: l.fecha, cantidad: 0 }
      g[k].cantidad += Number(x.cantidad)
    })
    const ffArr = {}
    Object.keys(ff).forEach(a => { ffArr[a] = Object.values(ff[a]).sort((x, y) => String(x.fecha).localeCompare(String(y.fecha))) })
    setFifo(ffArr)
  }

  const escanear = async () => {
    setError(''); setMsg('')
    const folio = scan.trim()
    if (!folio || !emb) return
    const { data: c } = await supabase.from('contenedores')
      .select('*, lote:lotes(id, codigo_lote, articulo_id, fecha, estatus_calidad), articulo:articulos(codigo_interno)')
      .eq('empresa_id', perfil.empresa_id).eq('folio', folio).maybeSingle()
    if (!c) { setError(`Contenedor "${folio}" no encontrado. Usa alta manual si el material no tiene folio en sistema.`); setScan(''); return }
    if (!c.lote || c.lote.estatus_calidad !== 'liberado') { setError(`El lote de "${folio}" no esta liberado por Calidad.`); setScan(''); return }
    if (lineas.some(l => l.contenedor_id === c.id)) { setError(`"${folio}" ya fue escaneado en este embarque.`); setScan(''); return }
    // FIFO: hay algun lote liberado mas viejo del mismo articulo?
    const disp = fifo[c.lote.articulo_id] || []
    const masViejo = disp.find(d => String(d.fecha) < String(c.lote.fecha))
    const fuera = !!masViejo
    const { error } = await supabase.from('embarque_lineas').insert({
      embarque_id: emb.id, articulo_id: c.lote.articulo_id, lote_id: c.lote.id, cantidad: Number(c.cantidad),
      almacen_id: c.almacen_id, ubicacion_id: c.ubicacion_id, contenedor_id: c.id, fuera_fifo: fuera,
      escaneado_por: perfil.id, escaneado_at: new Date().toISOString(),
    })
    if (error) { setError(error.message); return }
    setMsg(fuera ? `Escaneado ${folio} — FUERA DE FIFO (hay lote mas viejo ${masViejo.codigo}). Requerira autorizacion.` : `Escaneado ${folio} (${fmt(c.cantidad)} pz).`)
    setScan(''); abrir(emb)
  }

  const agregarManual = async () => {
    setError('')
    if (!manual.articulo_id || !manual.cantidad) { setError('Articulo y cantidad son obligatorios en alta manual.'); return }
    const { error } = await supabase.from('embarque_lineas').insert({
      embarque_id: emb.id, articulo_id: parseInt(manual.articulo_id), lote_id: null, cantidad: parseFloat(manual.cantidad),
      contenedor_id: null, fuera_fifo: true, escaneado_por: perfil.id, escaneado_at: new Date().toISOString(),
    })
    if (error) { setError(error.message); return }
    setManual({ articulo_id: '', lote: '', cantidad: '' }); setMsg('Alta manual agregada (fuera de FIFO).'); abrir(emb)
  }

  const quitar = async (l) => {
    await supabase.from('embarque_lineas').delete().eq('id', l.id); abrir(emb)
  }

  const terminar = async () => {
    if (lineas.length === 0) { setError('Escanea al menos un contenedor.'); return }
    const fuera = lineas.some(l => l.fuera_fifo)
    const { error } = await supabase.from('embarques').update({ estatus: 'preparado', requiere_autorizacion: fuera }).eq('id', emb.id)
    if (error) { setError(error.message); return }
    setMsg(`Embarque ${emb.folio} preparado.${fuera ? ' Requiere autorizacion del gerente antes de la remision.' : ''}`)
    setEmb(null); setLineas([]); await base()
  }

  if (!emb) {
    return (
      <div>
        <h2 style={styles.titulo}>Preparar Embarque</h2>
        {error && <p style={styles.error}>{error}</p>}
        {puede && (
          <div style={styles.tarjeta}>
            <h3 style={styles.subt}>Nuevo embarque</h3>
            <div style={styles.fila}>
              <div style={styles.campo}><label style={styles.lbl}>Cliente</label>
                <select style={styles.input} value={form.cliente_id} onChange={e => setForm({ ...form, cliente_id: e.target.value })}>
                  <option value="">Selecciona...</option>
                  {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select></div>
              <div style={styles.campo}><label style={styles.lbl}>Fecha</label>
                <input style={styles.input} type="date" value={form.fecha} onChange={e => setForm({ ...form, fecha: e.target.value })} /></div>
              <div style={styles.campo}><label style={styles.lbl}>Transportista</label>
                <input style={styles.input} value={form.transportista} onChange={e => setForm({ ...form, transportista: e.target.value })} placeholder="Opcional" /></div>
              <button style={{ ...styles.btn, alignSelf: 'flex-end' }} onClick={iniciar}>Iniciar preparacion</button>
            </div>
          </div>
        )}
        <div style={styles.tarjeta}>
          <h3 style={styles.subt}>En preparacion</h3>
          {prep.length === 0 ? <p style={{ color: '#666', fontSize: '13px' }}>No hay embarques en preparacion.</p> : prep.map(e => (
            <div key={e.id} style={styles.prepFila}>
              <span style={{ flex: 1, fontWeight: '600' }}>{e.folio}</span>
              <span style={{ flex: 1 }}>{e.clientes?.nombre}</span>
              <span style={{ flex: 1 }}>{fFecha(e.fecha)}</span>
              <button style={styles.btnSec} onClick={() => abrir(e)}>Abrir</button>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const totalFuera = lineas.filter(l => l.fuera_fifo).length
  return (
    <div>
      <div style={styles.head}>
        <div>
          <h2 style={styles.titulo}>{emb.folio}</h2>
          <span style={{ fontSize: '13px', color: '#64748b' }}>{emb.clientes?.nombre} · {fFecha(emb.fecha)}</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button style={styles.btnSec} onClick={() => { setEmb(null); base() }}>Volver</button>
          {puede && <button style={styles.btn} onClick={terminar}>Terminar preparacion</button>}
        </div>
      </div>
      {error && <p style={styles.error}>{error}</p>}
      {msg && <p style={styles.msg}>{msg}</p>}
      {totalFuera > 0 && <p style={styles.avisoFuera}>{totalFuera} contenedor(es) fuera de FIFO — al terminar quedara pendiente de autorizacion del Gerente de Logistica.</p>}

      {puede && (
        <div style={styles.tarjeta}>
          <h3 style={styles.subt}>Escanear caja / tarima</h3>
          <div style={{ display: 'flex', gap: '10px' }}>
            <input style={{ ...styles.input, flex: 1 }} autoFocus value={scan} placeholder="Folio del contenedor (CJ-... / TA-...)"
              onChange={e => setScan(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') escanear() }} />
            <button style={styles.btn} onClick={escanear}>Escanear</button>
          </div>
          <div style={{ marginTop: '10px', display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={styles.campo}><label style={styles.lbl}>Alta manual (fuera FIFO)</label>
              <select style={styles.input} value={manual.articulo_id} onChange={e => setManual({ ...manual, articulo_id: e.target.value })}>
                <option value="">Articulo...</option>
                {articulos.map(a => <option key={a.id} value={a.id}>{a.codigo_interno}</option>)}
              </select></div>
            <input style={{ ...styles.input, width: '120px' }} type="number" placeholder="Cantidad" value={manual.cantidad} onChange={e => setManual({ ...manual, cantidad: e.target.value })} />
            <button style={styles.btnSec} onClick={agregarManual}>+ Agregar manual</button>
          </div>
        </div>
      )}

      <div style={styles.tarjeta}>
        <h3 style={styles.subt}>Escaneado ({lineas.length})</h3>
        {lineas.length === 0 ? <p style={{ color: '#666', fontSize: '13px' }}>Aun no se escanea nada.</p> : (
          <div>
            {lineas.map(l => (
              <div key={l.id} style={{ ...styles.linea, backgroundColor: l.fuera_fifo ? '#fffbeb' : '#fff' }}>
                <span style={{ flex: 1, fontWeight: '600' }}>{l.articulos?.codigo_interno}</span>
                <span style={{ flex: 1, color: '#64748b' }}>{l.contenedores?.folio || 'manual'}</span>
                <span style={{ flex: 1, color: '#64748b' }}>{l.lotes?.codigo_lote || '-'}</span>
                <span style={{ flex: 0.8, textAlign: 'right' }}>{fmt(l.cantidad)}</span>
                <span style={{ flex: 0.8, textAlign: 'center' }}>{l.fuera_fifo ? <span style={styles.badgeFuera}>FUERA FIFO</span> : <span style={styles.badgeOk}>FIFO</span>}</span>
                {puede && <button style={styles.quitar} onClick={() => quitar(l)}>✕</button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const styles = {
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 4px' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' },
  subt: { fontSize: '14px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 12px' },
  tarjeta: { backgroundColor: '#fff', borderRadius: '10px', padding: '20px', marginBottom: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  fila: { display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px' },
  lbl: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' },
  btn: { padding: '9px 18px', backgroundColor: '#0891b2', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' },
  btnSec: { padding: '8px 14px', backgroundColor: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  prepFila: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 0', borderBottom: '1px solid #f1f5f9', fontSize: '13px' },
  linea: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 8px', borderBottom: '1px solid #f1f5f9', fontSize: '13px' },
  badgeFuera: { backgroundColor: '#fef3c7', color: '#b45309', borderRadius: '20px', padding: '2px 8px', fontSize: '10px', fontWeight: '700' },
  badgeOk: { backgroundColor: '#dcfce7', color: '#16a34a', borderRadius: '20px', padding: '2px 8px', fontSize: '10px', fontWeight: '600' },
  quitar: { padding: '4px 8px', background: 'transparent', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: '14px' },
  avisoFuera: { backgroundColor: '#fffbeb', border: '1px solid #fde68a', color: '#b45309', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '14px' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  msg: { color: '#0891b2', fontSize: '13px', marginBottom: '12px' },
}
