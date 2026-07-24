import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const fmt = (n) => Number(n ?? 0).toLocaleString('es-MX', { maximumFractionDigits: 0 })
const fFecha = (s) => { if (!s) return '-'; const p = String(s).split('-'); return `${p[2]}/${p[1]}/${p[0]}` }
const EST_LBL = { preparando: 'En preparacion', preparado: 'Preparado', autorizado: 'Autorizado', embarcado: 'Embarcado' }

export default function EmbarquePreparar() {
  const { perfil, tienePermiso } = useAuth()
  const puede = tienePermiso('log_embarques', 'crear')
  const puedeAutorizar = tienePermiso('log_embarques', 'aprobar')

  const [lista, setLista] = useState([])
  const [folioIn, setFolioIn] = useState('')
  const [emb, setEmb] = useState(null)
  const [objetivo, setObjetivo] = useState([])
  const [lineas, setLineas] = useState([])
  const [fifo, setFifo] = useState({})
  const [scan, setScan] = useState('')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [proc, setProc] = useState(false)

  useEffect(() => { base() }, [])

  const base = async () => {
    const { data: pr } = await supabase.from('embarques').select('*, clientes(nombre)')
      .eq('empresa_id', perfil.empresa_id).in('estatus', ['preparando', 'preparado', 'autorizado']).order('id', { ascending: false })
    setLista(pr || [])
  }

  const refrescarEmb = async (id) => (await supabase.from('embarques').select('*, clientes(nombre)').eq('id', id).single()).data

  const abrir = async (e) => {
    setEmb(e); setError(''); setMsg('')
    const [{ data: obj }, { data: ls }, { data: ex }] = await Promise.all([
      supabase.from('embarque_objetivo').select('*, articulos(codigo_interno, descripcion)').eq('embarque_id', e.id),
      supabase.from('embarque_lineas').select('*, articulos(codigo_interno), lotes(codigo_lote), contenedores(folio)').eq('embarque_id', e.id).order('id'),
      supabase.from('existencias').select('cantidad, lote:lotes(id, codigo_lote, articulo_id, fecha, estatus_calidad)'),
    ])
    setObjetivo(obj || []); setLineas(ls || [])
    const ff = {}
    ;(ex || []).forEach(x => {
      const l = x.lote
      if (!l || l.estatus_calidad !== 'liberado') return
      const g = ff[l.articulo_id] = ff[l.articulo_id] || {}
      if (!g[l.id]) g[l.id] = { lote_id: l.id, codigo: l.codigo_lote, fecha: l.fecha, cantidad: 0 }
      g[l.id].cantidad += Number(x.cantidad)
    })
    const arr = {}
    Object.keys(ff).forEach(a => { arr[a] = Object.values(ff[a]).sort((x, y) => String(x.fecha).localeCompare(String(y.fecha))) })
    setFifo(arr)
  }

  const abrirPorFolio = async () => {
    setError('')
    const f = folioIn.trim()
    if (!f) return
    const { data } = await supabase.from('embarques').select('*, clientes(nombre)').eq('empresa_id', perfil.empresa_id).eq('folio', f).maybeSingle()
    if (!data) { setError(`No existe el embarque "${f}".`); return }
    if (data.estatus === 'embarcado') { setError(`El embarque "${f}" ya fue embarcado.`); return }
    setFolioIn(''); abrir(data)
  }

  // ---- progreso por articulo ----
  const req = {}, esc = {}, disp = {}
  objetivo.forEach(o => { req[o.articulo_id] = (req[o.articulo_id] || 0) + Number(o.cantidad_requerida) })
  lineas.forEach(l => { esc[l.articulo_id] = (esc[l.articulo_id] || 0) + Number(l.cantidad) })
  Object.keys(fifo).forEach(a => { disp[a] = fifo[a].reduce((s, x) => s + x.cantidad, 0) })
  const arts = [...new Set([...Object.keys(req), ...Object.keys(esc)])]
  const completoGlobal = objetivo.length > 0 && Object.keys(req).every(a => (esc[a] || 0) >= req[a] - 0.001)

  const escanear = async () => {
    setError(''); setMsg('')
    const folio = scan.trim()
    if (!folio || !emb) return
    const { data: c } = await supabase.from('contenedores')
      .select('*, lote:lotes(id, codigo_lote, articulo_id, fecha, estatus_calidad)')
      .eq('empresa_id', perfil.empresa_id).eq('folio', folio).maybeSingle()
    if (!c) { setError(`Contenedor "${folio}" no encontrado. Usa alta manual si el material aun no tiene folio.`); setScan(''); return }
    if (!c.lote || c.lote.estatus_calidad !== 'liberado') { setError(`El lote de "${folio}" no esta liberado por Calidad.`); setScan(''); return }
    if (lineas.some(l => l.contenedor_id === c.id)) { setError(`"${folio}" ya fue escaneado.`); setScan(''); return }
    const art = c.lote.articulo_id
    const enObjetivo = art in req
    const disponibles = fifo[art] || []
    const masViejo = disponibles.find(d => String(d.fecha) < String(c.lote.fecha) && !lineas.some(l => l.lote_id === d.lote_id))
    let fuera = false, motivo = ''
    if (!enObjetivo) { fuera = true; motivo = 'no esta en el objetivo de este embarque' }
    else if (masViejo) { fuera = true; motivo = `hay un lote mas viejo (${masViejo.codigo})` }
    else if ((esc[art] || 0) >= (req[art] || 0)) { fuera = true; motivo = 'ya cubriste lo requerido de este articulo' }
    if (fuera) {
      const ok = window.confirm(`El lote ${c.lote.codigo_lote} esta FUERA DE FIFO: ${motivo}.\n\n¿Confirmas agregarlo fuera de FIFO? (requerira autorizacion del gerente)`)
      if (!ok) { setScan(''); return }
    }
    const { error } = await supabase.from('embarque_lineas').insert({
      embarque_id: emb.id, articulo_id: art, lote_id: c.lote.id, cantidad: Number(c.cantidad),
      almacen_id: c.almacen_id, ubicacion_id: c.ubicacion_id, contenedor_id: c.id, fuera_fifo: fuera,
      escaneado_por: perfil.id, escaneado_at: new Date().toISOString(),
    })
    if (error) { setError(error.message); return }
    setScan('')
    await abrir(emb)
  }

  const [manual, setManual] = useState({ articulo_id: '', cantidad: '' })
  const agregarManual = async () => {
    if (!manual.articulo_id || !manual.cantidad) { setError('Articulo y cantidad obligatorios.'); return }
    const ok = window.confirm('Alta manual = material fuera de FIFO (aun en produccion o sin folio). ¿Confirmas?')
    if (!ok) return
    await supabase.from('embarque_lineas').insert({
      embarque_id: emb.id, articulo_id: parseInt(manual.articulo_id), lote_id: null, cantidad: parseFloat(manual.cantidad),
      contenedor_id: null, fuera_fifo: true, escaneado_por: perfil.id, escaneado_at: new Date().toISOString(),
    })
    setManual({ articulo_id: '', cantidad: '' }); await abrir(emb)
  }

  const quitar = async (l) => { await supabase.from('embarque_lineas').delete().eq('id', l.id); await abrir(emb) }

  const eliminar = async () => {
    if (emb.estatus === 'embarcado') { setError('No se puede eliminar un embarque ya embarcado.'); return }
    if (!window.confirm(`Eliminar el embarque ${emb.folio} y todo lo escaneado? Esta accion no se puede deshacer.`)) return
    await supabase.from('embarque_lineas').delete().eq('embarque_id', emb.id)
    await supabase.from('embarques').delete().eq('id', emb.id) // objetivo cae por cascade
    setEmb(null); setMsg(`Embarque ${emb.folio} eliminado.`); await base()
  }

  const terminar = async () => {
    if (lineas.length === 0) { setError('Escanea al menos un contenedor.'); return }
    if (!completoGlobal && !window.confirm('El embarque esta incompleto (falta material). ¿Terminar como parcial? El resto quedara pendiente en el release.')) return
    const fuera = lineas.some(l => l.fuera_fifo)
    await supabase.from('embarques').update({ estatus: 'preparado', requiere_autorizacion: fuera }).eq('id', emb.id)
    setEmb(await refrescarEmb(emb.id)); setMsg(`Embarque preparado.${fuera ? ' Requiere autorizacion del gerente.' : ''}`); await base()
  }

  const autorizar = async () => {
    await supabase.from('embarques').update({ estatus: 'autorizado', autorizado_por: perfil.id, autorizado_at: new Date().toISOString() }).eq('id', emb.id)
    setEmb(await refrescarEmb(emb.id)); setMsg('Embarque autorizado.'); await base()
  }

  const embarcar = async () => {
    setError(''); setProc(true)
    try {
      const loteIds = [...new Set(lineas.filter(l => l.lote_id).map(l => l.lote_id))]
      let exs = []
      if (loteIds.length) { const { data } = await supabase.from('existencias').select('*').in('lote_id', loteIds); exs = data || [] }
      for (const l of lineas) {
        if (l.lote_id) {
          const ex = exs.find(e => e.lote_id === l.lote_id && e.almacen_id === l.almacen_id && Number(e.cantidad) > 0)
          if (ex) {
            const nueva = Number(ex.cantidad) - Number(l.cantidad)
            if (nueva <= 0.000001) await supabase.from('existencias').delete().eq('id', ex.id)
            else await supabase.from('existencias').update({ cantidad: nueva }).eq('id', ex.id)
            ex.cantidad = nueva
          }
          await supabase.from('movimientos').insert({
            empresa_id: perfil.empresa_id, articulo_id: l.articulo_id, lote_id: l.lote_id, tipo: 'salida_embarque',
            almacen_origen_id: l.almacen_id, ubicacion_origen_id: l.ubicacion_id, cantidad: Number(l.cantidad),
            motivo: `Embarque ${emb.folio}`, usuario_id: perfil.id,
          })
        }
        if (l.contenedor_id) await supabase.from('contenedores').update({ estatus: 'embarcado' }).eq('id', l.contenedor_id)
      }
      const { data: rls } = await supabase.from('release_lineas')
        .select('id, articulo_id, fecha_requerida, cantidad, release_entregas(cantidad)')
        .eq('vigente', true).eq('cliente_id', emb.cliente_id).order('fecha_requerida')
      const porArt = {}
      lineas.forEach(l => { porArt[l.articulo_id] = (porArt[l.articulo_id] || 0) + Number(l.cantidad) })
      for (const art of Object.keys(porArt)) {
        let rem = porArt[art]
        for (const r of (rls || []).filter(x => x.articulo_id === Number(art))) {
          if (rem <= 0) break
          const entregado = (r.release_entregas || []).reduce((s, x) => s + Number(x.cantidad || 0), 0)
          const falt = Number(r.cantidad) - entregado
          if (falt <= 0) continue
          const asg = Math.min(rem, falt)
          await supabase.from('release_entregas').insert({ linea_id: r.id, cantidad: asg, fecha_entrega: emb.fecha, referencia: emb.folio, registrado_por: perfil.id, embarque_id: emb.id })
          rem -= asg
        }
      }
      await supabase.from('embarques').update({ estatus: 'embarcado' }).eq('id', emb.id)
      setMsg(`Embarque ${emb.folio} confirmado. Inventario descontado y entregas aplicadas.`)
      setEmb(null); await base()
    } catch (e) { setError('Error al embarcar: ' + (e.message || e)) }
    setProc(false)
  }

  // ================= LISTA =================
  if (!emb) {
    return (
      <div>
        <h2 style={styles.titulo}>Preparar Embarque</h2>
        <p style={styles.ayuda}>Las ordenes de embarque se generan desde <b>Lista de Embarque</b>. Ingresa aqui su folio para escanear el material contra el objetivo.</p>
        {error && <p style={styles.error}>{error}</p>}
        {msg && <p style={styles.msg}>{msg}</p>}
        <div style={styles.tarjeta}>
          <h3 style={styles.subt}>Ingresar folio de embarque</h3>
          <div style={{ display: 'flex', gap: '10px', maxWidth: '420px' }}>
            <input style={{ ...styles.input, flex: 1 }} value={folioIn} placeholder="EMB-..." onChange={e => setFolioIn(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') abrirPorFolio() }} />
            <button style={styles.btn} onClick={abrirPorFolio}>Abrir</button>
          </div>
        </div>
        <div style={styles.tarjeta}>
          <h3 style={styles.subt}>Embarques en curso</h3>
          {lista.length === 0 ? <p style={{ color: '#666', fontSize: '13px' }}>No hay embarques en preparacion.</p> : lista.map(e => (
            <div key={e.id} style={styles.prepFila}>
              <span style={{ flex: 1, fontWeight: '600' }}>{e.folio}</span>
              <span style={{ flex: 1 }}>{e.clientes?.nombre}</span>
              <span style={{ flex: 1 }}>{fFecha(e.fecha)}</span>
              <span style={{ flex: 1 }}><span style={badgeEst(e.estatus)}>{EST_LBL[e.estatus]}</span>{e.requiere_autorizacion && e.estatus === 'preparado' ? ' ⚠' : ''}</span>
              <button style={styles.btnSec} onClick={() => abrir(e)}>Abrir</button>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ================= ACTIVO =================
  const totalFuera = lineas.filter(l => l.fuera_fifo).length
  const bloqueado = emb.requiere_autorizacion && emb.estatus !== 'autorizado'
  const preparando = emb.estatus === 'preparando'

  return (
    <div>
      <style>{`@media print { .no-imprimir { display: none !important; } }`}</style>
      <div style={styles.head} className="no-imprimir">
        <div>
          <h2 style={styles.titulo}>{emb.folio}</h2>
          <span style={{ fontSize: '13px', color: '#64748b' }}>{emb.clientes?.nombre} · {fFecha(emb.fecha)} · <span style={badgeEst(emb.estatus)}>{EST_LBL[emb.estatus]}</span></span>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button style={styles.btnSec} onClick={() => { setEmb(null); base() }}>Volver</button>
          {puede && emb.estatus !== 'embarcado' && <button style={styles.btnDel} onClick={eliminar}>Eliminar</button>}
          {puede && preparando && <button style={styles.btn} onClick={terminar}>Terminar preparacion</button>}
          {!preparando && bloqueado && puedeAutorizar && <button style={styles.btnAut} onClick={autorizar}>Autorizar (fuera FIFO)</button>}
          {!preparando && !bloqueado && <button style={styles.btnSec} onClick={() => window.print()}>Imprimir remision</button>}
          {!preparando && !bloqueado && puede && <button style={styles.btn} disabled={proc} onClick={embarcar}>{proc ? '...' : 'Confirmar embarque'}</button>}
        </div>
      </div>
      {error && <p style={styles.error}>{error}</p>}
      {msg && <p style={styles.msg}>{msg}</p>}
      {preparando && completoGlobal && <p style={styles.avisoOk}>Embarque COMPLETO — ya no hay que escanear mas. Da "Terminar preparacion".</p>}
      {!preparando && bloqueado && <p style={styles.avisoFuera}>Material fuera de FIFO: requiere autorizacion del Gerente de Logistica antes de la remision o el embarque.</p>}

      {/* Objetivo / avance */}
      <div style={styles.tarjeta} className="remision">
        {!preparando && <div style={{ marginBottom: '10px' }}><div style={{ fontSize: '18px', fontWeight: '700' }}>REMISION {emb.folio}</div><div style={{ fontSize: '13px', color: '#475569' }}>Cliente: {emb.clientes?.nombre} · Fecha: {fFecha(emb.fecha)}{emb.transportista ? ` · ${emb.transportista}` : ''}</div></div>}
        <h3 style={styles.subt}>Objetivo del embarque</h3>
        <div style={styles.th}><span style={{ flex: 1.4 }}>Articulo</span><span style={{ flex: 2 }}>Descripcion</span><span style={{ flex: 1 }}>OC</span><span style={{ flex: 0.8, textAlign: 'right' }}>Requerido</span><span style={{ flex: 0.8, textAlign: 'right' }}>Escaneado</span><span style={{ flex: 0.8, textAlign: 'right' }}>Falta</span><span style={{ flex: 1, textAlign: 'center' }}>Estatus</span></div>
        {arts.map(a => {
          const o = objetivo.find(x => String(x.articulo_id) === String(a))
          const r = req[a] || 0, e = esc[a] || 0, falta = Math.max(r - e, 0)
          const insuf = (disp[a] || 0) < falta
          const comp = r > 0 && e >= r - 0.001
          const extra = r === 0
          return (
            <div key={a} style={{ ...styles.tr, backgroundColor: comp ? '#f0fdf4' : extra ? '#fffbeb' : '#fff' }}>
              <span style={{ flex: 1.4, fontWeight: '600' }}>{o?.articulos?.codigo_interno || (lineas.find(l => String(l.articulo_id) === String(a))?.articulos?.codigo_interno)}</span>
              <span style={{ flex: 2, color: '#64748b' }}>{o?.articulos?.descripcion || ''}</span>
              <span style={{ flex: 1 }}>{o?.oc_cliente || '-'}</span>
              <span style={{ flex: 0.8, textAlign: 'right' }}>{fmt(r)}</span>
              <span style={{ flex: 0.8, textAlign: 'right', fontWeight: '600' }}>{fmt(e)}</span>
              <span style={{ flex: 0.8, textAlign: 'right', color: falta > 0 ? '#dc2626' : '#16a34a' }}>{fmt(falta)}</span>
              <span style={{ flex: 1, textAlign: 'center' }}>
                {extra ? <span style={styles.bExtra}>EXTRA</span> : comp ? <span style={styles.bOk}>✓ COMPLETO</span> : insuf ? <span style={styles.bInsuf}>INSUFICIENTE</span> : <span style={styles.bFalta}>FALTA</span>}
              </span>
            </div>
          )
        })}
        {objetivo.length === 0 && <p style={{ color: '#666', fontSize: '13px', padding: '8px' }}>Sin objetivo (embarque manual).</p>}
      </div>

      {/* Escaneo */}
      {puede && preparando && (
        <div style={styles.tarjeta} className="no-imprimir">
          <h3 style={styles.subt}>Escanear caja / tarima</h3>
          <div style={{ display: 'flex', gap: '10px' }}>
            <input style={{ ...styles.input, flex: 1 }} autoFocus value={scan} placeholder="Folio del contenedor (CJ-... / TA-...)" onChange={e => setScan(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') escanear() }} />
            <button style={styles.btn} onClick={escanear}>Escanear</button>
          </div>
          <div style={{ marginTop: '10px', display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={styles.campo}><label style={styles.lbl}>Alta manual (fuera FIFO)</label>
              <select style={styles.input} value={manual.articulo_id} onChange={e => setManual({ ...manual, articulo_id: e.target.value })}>
                <option value="">Articulo...</option>
                {objetivo.map(o => <option key={o.articulo_id} value={o.articulo_id}>{o.articulos?.codigo_interno}</option>)}
              </select></div>
            <input style={{ ...styles.input, width: '120px' }} type="number" placeholder="Cantidad" value={manual.cantidad} onChange={e => setManual({ ...manual, cantidad: e.target.value })} />
            <button style={styles.btnSec} onClick={agregarManual}>+ Agregar manual</button>
          </div>
        </div>
      )}

      {/* Escaneado */}
      <div style={styles.tarjeta} className="remision">
        <h3 style={styles.subt}>Escaneado ({lineas.length})</h3>
        <div style={styles.th}><span style={{ flex: 1 }}>Articulo</span><span style={{ flex: 1 }}>Contenedor</span><span style={{ flex: 1 }}>Lote</span><span style={{ flex: 0.7, textAlign: 'right' }}>Cantidad</span><span style={{ flex: 0.7, textAlign: 'center' }}>FIFO</span><span style={{ width: '28px' }} className="no-imprimir"></span></div>
        {lineas.length === 0 ? <p style={{ color: '#666', fontSize: '13px', padding: '8px' }}>Aun no se escanea nada.</p> : lineas.map(l => (
          <div key={l.id} style={{ ...styles.tr, backgroundColor: l.fuera_fifo ? '#fffbeb' : '#fff' }}>
            <span style={{ flex: 1, fontWeight: '600' }}>{l.articulos?.codigo_interno}</span>
            <span style={{ flex: 1, color: '#64748b' }}>{l.contenedores?.folio || 'manual'}</span>
            <span style={{ flex: 1, color: '#64748b' }}>{l.lotes?.codigo_lote || '-'}</span>
            <span style={{ flex: 0.7, textAlign: 'right' }}>{fmt(l.cantidad)}</span>
            <span style={{ flex: 0.7, textAlign: 'center' }}>{l.fuera_fifo ? <span style={styles.bExtra}>FUERA</span> : <span style={styles.bOk}>✓</span>}</span>
            <span style={{ width: '28px' }} className="no-imprimir">{puede && preparando && <button style={styles.quitar} onClick={() => quitar(l)}>✕</button>}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function badgeEst(e) {
  const b = { padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: '600' }
  if (e === 'preparando') return { ...b, backgroundColor: '#eff6ff', color: '#2563eb' }
  if (e === 'preparado') return { ...b, backgroundColor: '#fef9c3', color: '#a16207' }
  if (e === 'autorizado') return { ...b, backgroundColor: '#dcfce7', color: '#16a34a' }
  return { ...b, backgroundColor: '#f1f5f9', color: '#475569' }
}

const styles = {
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 4px' },
  ayuda: { fontSize: '13px', color: '#64748b', margin: '0 0 16px', maxWidth: '760px' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px', gap: '10px', flexWrap: 'wrap' },
  subt: { fontSize: '14px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 12px' },
  tarjeta: { backgroundColor: '#fff', borderRadius: '10px', padding: '20px', marginBottom: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px' },
  lbl: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' },
  btn: { padding: '9px 18px', backgroundColor: '#0891b2', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' },
  btnAut: { padding: '9px 18px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' },
  btnDel: { padding: '9px 16px', backgroundColor: '#fff', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  btnSec: { padding: '8px 14px', backgroundColor: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  prepFila: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 0', borderBottom: '1px solid #f1f5f9', fontSize: '13px' },
  th: { display: 'flex', gap: '10px', padding: '8px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tr: { display: 'flex', gap: '10px', alignItems: 'center', padding: '10px 8px', borderBottom: '1px solid #f1f5f9', fontSize: '13px' },
  bOk: { backgroundColor: '#dcfce7', color: '#16a34a', borderRadius: '20px', padding: '2px 8px', fontSize: '10px', fontWeight: '700' },
  bFalta: { backgroundColor: '#fee2e2', color: '#dc2626', borderRadius: '20px', padding: '2px 8px', fontSize: '10px', fontWeight: '700' },
  bInsuf: { backgroundColor: '#fef3c7', color: '#b45309', borderRadius: '20px', padding: '2px 8px', fontSize: '10px', fontWeight: '700' },
  bExtra: { backgroundColor: '#fef3c7', color: '#b45309', borderRadius: '20px', padding: '2px 8px', fontSize: '10px', fontWeight: '700' },
  quitar: { padding: '4px 8px', background: 'transparent', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: '14px' },
  avisoOk: { backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', color: '#16a34a', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '14px', fontWeight: '600' },
  avisoFuera: { backgroundColor: '#fffbeb', border: '1px solid #fde68a', color: '#b45309', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '14px' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  msg: { color: '#0891b2', fontSize: '13px', marginBottom: '12px' },
}
