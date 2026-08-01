import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import FiltroSite from '../../components/FiltroSite'
import { siteEfectivo } from '../../lib/sites'

const COLOR = {
  trabajando: { bg: '#16a34a', lbl: 'TRABAJANDO' },
  parada: { bg: '#dc2626', lbl: 'PARADA' },
  cambio_molde: { bg: '#ea580c', lbl: 'CAMBIO DE MOLDE' },
  sin_programa: { bg: '#2563eb', lbl: 'SIN PROGRAMA' },
}
const hoyISO = () => new Date().toISOString().slice(0, 10)
const fmt = (n) => Number(n ?? 0).toLocaleString('es-MX', { maximumFractionDigits: 0 })
const enEstado = (desde) => {
  if (!desde) return '-'
  const ms = Date.now() - new Date(desde).getTime()
  const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4)
  return `${h}h ${m}m`
}

export default function TableroAndon() {
  const { perfil, tienePermiso } = useAuth()
  const puedeControl = tienePermiso('prod_andon', 'crear')

  const [maquinas, setMaquinas] = useState([])
  const [site, setSite] = useState('')
  const [estados, setEstados] = useState({})
  const [enProceso, setEnProceso] = useState({})
  const [artMap, setArtMap] = useState({})
  const [prioridades, setPrioridades] = useState([])
  const [adeudos, setAdeudos] = useState([])
  const [tick, setTick] = useState(0)
  const [control, setControl] = useState(false)
  const [full, setFull] = useState(false)
  const [nuevaP, setNuevaP] = useState({ articulo_id: '', nota: '' })
  const [, forceTime] = useState(0)
  const timer = useRef(null)

  useEffect(() => {
    cargar()
    const r = setInterval(cargar, 10000)
    const t = setInterval(() => setTick(x => x + 1), 3000)
    const clock = setInterval(() => forceTime(x => x + 1), 30000)
    return () => { clearInterval(r); clearInterval(t); clearInterval(clock) }
  }, [])

  const cargar = async () => {
    const sid = siteEfectivo(perfil, site)
    const emp = perfil.empresa_id
    const [{ data: maq }, { data: est }, { data: ots }, { data: arts }, { data: prio }, { data: rl }] = await Promise.all([
      (sid ? supabase.from('maquinas').select('id, clave, nombre, site_id').eq('empresa_id', emp).eq('activo', true).eq('site_id', sid).order('clave') : supabase.from('maquinas').select('id, clave, nombre, site_id').eq('empresa_id', emp).eq('activo', true).order('clave')),
      supabase.from('maquina_estado').select('*').eq('empresa_id', emp),
      supabase.from('ordenes_trabajo').select('id, maquina_id, articulo_id, molde_id, estatus, ot_articulos(articulos(codigo_interno, descripcion))').eq('empresa_id', emp).eq('estatus', 'en_proceso'),
      supabase.from('articulos').select('id, codigo_interno, descripcion').eq('empresa_id', emp),
      supabase.from('prioridades').select('*, articulos(codigo_interno, descripcion)').eq('empresa_id', emp).eq('estatus', 'abierta').order('numero'),
      supabase.from('release_lineas').select('id, articulo_id, fecha_requerida, cantidad, vigente, articulos(codigo_interno, descripcion), clientes(nombre), release_entregas(cantidad)').eq('vigente', true).lt('fecha_requerida', hoyISO()),
    ])
    setMaquinas(maq || [])
    const em = {}; (est || []).forEach(e => { em[e.maquina_id] = e }); setEstados(em)
    const pm = {}; (ots || []).forEach(o => { pm[o.maquina_id] = o }); setEnProceso(pm)
    const am = {}; (arts || []).forEach(a => { am[a.id] = a }); setArtMap(am)
    setPrioridades(prio || [])
    const ad = (rl || []).map(r => {
      const entregado = (r.release_entregas || []).reduce((s, x) => s + Number(x.cantidad || 0), 0)
      return { ...r, faltante: Number(r.cantidad) - entregado }
    }).filter(r => r.faltante > 0)
    setAdeudos(ad)
  }

  const efectivo = (maq) => {
    const e = estados[maq.id]
    const otp = enProceso[maq.id]
    if (e && (e.estado === 'parada' || e.estado === 'cambio_molde'))
      return { estado: e.estado, desde: e.desde, art: e.articulo_id, familia: null, ot: otp }
    if (otp) return { estado: 'trabajando', desde: e?.estado === 'trabajando' ? e.desde : (e?.desde || otp.created_at), art: otp.articulo_id, familia: (otp.ot_articulos || []).map(x => x.articulos?.codigo_interno).filter(Boolean).join(' / '), ot: otp }
    if (e && e.estado === 'trabajando') return { estado: 'trabajando', desde: e.desde, art: e.articulo_id, ot: null }
    return { estado: 'sin_programa', desde: e?.desde, art: null, ot: null }
  }

  const setEstado = async (maq, estado) => {
    const otp = enProceso[maq.id]
    await supabase.from('maquina_estado').upsert({
      maquina_id: maq.id, empresa_id: perfil.empresa_id, estado,
      ot_id: otp?.id || null, articulo_id: otp?.articulo_id || null,
      desde: new Date().toISOString(), actualizado_por: perfil.id, actualizado_at: new Date().toISOString(),
    }, { onConflict: 'maquina_id' })
    await cargar()
  }

  const agregarPrioridad = async () => {
    if (!nuevaP.articulo_id) return
    const numero = (prioridades.reduce((mx, p) => Math.max(mx, p.numero), 0)) + 1
    await supabase.from('prioridades').insert({
      empresa_id: perfil.empresa_id, articulo_id: parseInt(nuevaP.articulo_id), numero, nota: nuevaP.nota || null,
      creado_por: perfil.id,
    })
    setNuevaP({ articulo_id: '', nota: '' }); await cargar()
  }

  const cerrarPrioridad = async (p) => {
    await supabase.from('prioridades').update({ estatus: 'cerrada', cerrada_por: perfil.id, cerrada_at: new Date().toISOString() }).eq('id', p.id)
    // recorrer numeros
    const mayores = prioridades.filter(x => x.numero > p.numero)
    for (const x of mayores) await supabase.from('prioridades').update({ numero: x.numero - 1 }).eq('id', x.id)
    await cargar()
  }

  const moverPrioridad = async (p, dir) => {
    const otro = prioridades.find(x => x.numero === p.numero + dir)
    if (!otro) return
    await supabase.from('prioridades').update({ numero: otro.numero }).eq('id', p.id)
    await supabase.from('prioridades').update({ numero: p.numero }).eq('id', otro.id)
    await cargar()
  }

  const adeudoAct = adeudos.length ? adeudos[tick % adeudos.length] : null

  return (
    <div style={full ? { ...styles.wrap, ...styles.wrapFull } : styles.wrap}>
      <div style={styles.head}>
        <h2 style={styles.titulo}>Tablero Andon</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          {puedeControl && <button style={styles.ctrlBtn} onClick={() => setControl(c => !c)}>{control ? 'Ocultar controles' : 'Controles'}</button>}
          <button style={styles.ctrlBtn} onClick={() => setFull(f => !f)}>{full ? 'Mostrar menu' : 'Pantalla completa'}</button>
        </div>
      </div>

      {/* Cinta de adeudos */}
      <div style={styles.cinta}>
        <span style={styles.cintaLbl}>ADEUDOS A CLIENTE</span>
        {adeudoAct
          ? <span style={styles.cintaTxt}>{adeudoAct.articulos?.codigo_interno} · {adeudoAct.clientes?.nombre || 'Cliente'} · falta <strong>{fmt(adeudoAct.faltante)}</strong> · venc. {adeudoAct.fecha_requerida} ({adeudos.length} adeudo{adeudos.length > 1 ? 's' : ''})</span>
          : <span style={{ ...styles.cintaTxt, color: '#86efac' }}>SIN ADEUDOS</span>}
      </div>

      <div style={styles.cuerpo}>
        {/* Mosaico de maquinas */}
        <div style={full ? { ...styles.mosaico, ...styles.mosaicoFull } : styles.mosaico}>
          {maquinas.map(m => {
            const ef = efectivo(m)
            const c = COLOR[ef.estado]
            const art = ef.familia || (ef.art ? artMap[ef.art]?.codigo_interno : null)
            const desc = ef.art ? artMap[ef.art]?.descripcion : (ef.ot ? '' : '')
            return (
              <div key={m.id} style={{ ...styles.tile, ...(full ? styles.tileFull : {}), backgroundColor: c.bg }}>
                <div style={styles.tileMaq}>{m.clave}</div>
                <div style={styles.tileEstado}>{c.lbl}</div>
                <div style={styles.tileArt}>{art || '—'}</div>
                <div style={styles.tileDesc}>{desc || m.nombre}</div>
                <div style={styles.tileHoras}>{enEstado(ef.desde)}</div>
                {control && puedeControl && (
                  <div style={styles.tileCtrl}>
                    <button style={styles.miniBtn} onClick={() => setEstado(m, 'trabajando')}>Trab</button>
                    <button style={styles.miniBtn} onClick={() => setEstado(m, 'parada')}>Paro</button>
                    <button style={styles.miniBtn} onClick={() => setEstado(m, 'cambio_molde')}>Molde</button>
                  </div>
                )}
              </div>
            )
          })}
          {maquinas.length === 0 && <p style={{ color: '#cbd5e1' }}>No hay maquinas activas.</p>}
        </div>

        {/* Prioridades */}
        <div style={styles.prioPanel}>
          <div style={styles.prioTitulo}>PRIORIDADES</div>
          {prioridades.length === 0 && <p style={{ color: '#94a3b8', fontSize: '13px' }}>Sin prioridades.</p>}
          {prioridades.map(p => (
            <div key={p.id} style={styles.prioItem}>
              <span style={styles.prioNum}>{p.numero}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: '600', fontSize: '13px' }}>{p.articulos?.codigo_interno}</div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>{p.nota || p.articulos?.descripcion}</div>
              </div>
              {puedeControl && (
                <div style={{ display: 'flex', gap: '2px' }}>
                  <button style={styles.pMini} onClick={() => moverPrioridad(p, -1)}>▲</button>
                  <button style={styles.pMini} onClick={() => moverPrioridad(p, 1)}>▼</button>
                  <button style={{ ...styles.pMini, color: '#fca5a5' }} onClick={() => cerrarPrioridad(p)}>✓</button>
                </div>
              )}
            </div>
          ))}
          {control && puedeControl && (
            <div style={styles.prioNueva}>
              <select style={styles.pInput} value={nuevaP.articulo_id} onChange={e => setNuevaP({ ...nuevaP, articulo_id: e.target.value })}>
                <option value="">Articulo...</option>
                {Object.values(artMap).map(a => <option key={a.id} value={a.id}>{a.codigo_interno}</option>)}
              </select>
              <input style={styles.pInput} placeholder="Nota" value={nuevaP.nota} onChange={e => setNuevaP({ ...nuevaP, nota: e.target.value })} />
              <button style={styles.miniBtn} onClick={agregarPrioridad}>+ Agregar</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const styles = {
  wrap: { backgroundColor: '#0f172a', borderRadius: '12px', padding: '20px', minHeight: 'calc(100vh - 130px)' },
  wrapFull: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, borderRadius: 0, minHeight: '100vh', overflow: 'auto', padding: '14px 18px' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' },
  titulo: { fontSize: '20px', fontWeight: '700', color: '#fff', margin: 0 },
  ctrlBtn: { padding: '7px 14px', backgroundColor: '#1e293b', color: '#cbd5e1', border: '1px solid #334155', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  cinta: { backgroundColor: '#1e293b', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '16px', overflow: 'hidden' },
  cintaLbl: { backgroundColor: '#dc2626', color: '#fff', fontWeight: '700', fontSize: '11px', padding: '4px 10px', borderRadius: '5px', whiteSpace: 'nowrap' },
  cintaTxt: { color: '#e2e8f0', fontSize: '16px', whiteSpace: 'nowrap' },
  cuerpo: { display: 'flex', gap: '16px', flexWrap: 'wrap' },
  mosaico: { flex: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '14px', minWidth: '280px' },
  mosaicoFull: { gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px' },
  tileFull: { padding: '10px 12px', minHeight: '108px' },
  tile: { borderRadius: '12px', padding: '16px', color: '#fff', minHeight: '150px', display: 'flex', flexDirection: 'column' },
  tileMaq: { fontSize: '22px', fontWeight: '800' },
  tileEstado: { fontSize: '12px', fontWeight: '700', opacity: 0.9, letterSpacing: '0.5px', marginBottom: '8px' },
  tileArt: { fontSize: '18px', fontWeight: '700' },
  tileDesc: { fontSize: '12px', opacity: 0.85, flex: 1 },
  tileHoras: { fontSize: '20px', fontWeight: '700', textAlign: 'right' },
  tileCtrl: { display: 'flex', gap: '4px', marginTop: '8px' },
  miniBtn: { padding: '4px 8px', backgroundColor: 'rgba(255,255,255,0.2)', color: '#fff', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' },
  prioPanel: { width: '300px', backgroundColor: '#1e293b', borderRadius: '12px', padding: '16px' },
  prioTitulo: { color: '#fbbf24', fontWeight: '700', fontSize: '13px', letterSpacing: '1px', marginBottom: '12px' },
  prioItem: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: '1px solid #334155', color: '#e2e8f0' },
  prioNum: { backgroundColor: '#fbbf24', color: '#0f172a', fontWeight: '800', width: '26px', height: '26px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px' },
  pMini: { padding: '2px 6px', backgroundColor: '#334155', color: '#cbd5e1', border: 'none', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' },
  prioNueva: { marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' },
  pInput: { padding: '7px 9px', borderRadius: '6px', border: '1px solid #334155', backgroundColor: '#0f172a', color: '#e2e8f0', fontSize: '12px', outline: 'none' },
}
