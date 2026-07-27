import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import ReporteProduccion from './ReporteProduccion'

// Terminal de operador (tablet). Pantalla completa, botones grandes. El operador
// elige su maquina y desde ahi cambia el estado (Andon), reporta paros con causa,
// ve alertas de calidad y prioridades, y abre el reporte de produccion.
const COLOR = {
  trabajando: { bg: '#16a34a', lbl: 'TRABAJANDO' },
  parada: { bg: '#dc2626', lbl: 'PARADA' },
  cambio_molde: { bg: '#d97706', lbl: 'CAMBIO DE MOLDE' },
  sin_programa: { bg: '#334155', lbl: 'SIN PROGRAMA' },
}

export default function TerminalOperador() {
  const { perfil } = useAuth()
  const [maquinas, setMaquinas] = useState([])
  const [estados, setEstados] = useState([])
  const [ots, setOts] = useState([])
  const [causasParo, setCausasParo] = useState([])
  const [prioridades, setPrioridades] = useState([])
  const [alertas, setAlertas] = useState([])
  const [artMap, setArtMap] = useState({})
  const [maqSel, setMaqSel] = useState(null)
  const [modo, setModo] = useState('panel') // panel | paro | reporte
  const [full, setFull] = useState(true)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')

  useEffect(() => { cargar(); const t = setInterval(cargar, 20000); return () => clearInterval(t) }, [])
  const cargar = async () => {
    const emp = perfil.empresa_id
    const [mq, es, ot, cp, pr, al, ar] = await Promise.all([
      supabase.from('maquinas').select('*').eq('empresa_id', emp).eq('activo', true).order('clave'),
      supabase.from('maquina_estado').select('*').eq('empresa_id', emp),
      supabase.from('ordenes_trabajo').select('id, folio, articulo_id, maquina_id, estatus').eq('empresa_id', emp).in('estatus', ['programada', 'en_proceso']),
      supabase.from('causas_paro').select('*').eq('activo', true).order('nombre'),
      supabase.from('prioridades').select('*, articulos(codigo_interno, descripcion)').eq('empresa_id', emp).eq('estatus', 'abierta').order('numero'),
      supabase.from('calidad_alertas').select('*, articulo:articulos(codigo_interno)').eq('empresa_id', emp).eq('vigente', true).order('id', { ascending: false }),
      supabase.from('articulos').select('id, codigo_interno, descripcion').eq('empresa_id', emp),
    ])
    setMaquinas(mq.data || []); setEstados(es.data || []); setOts(ot.data || []); setCausasParo(cp.data || [])
    setPrioridades(pr.data || []); setAlertas(al.data || [])
    const m = {}; (ar.data || []).forEach(a => { m[a.id] = a }); setArtMap(m)
    setLoading(false)
  }

  const estadoDe = (maqId) => estados.find(e => e.maquina_id === maqId)
  const otDe = (maqId) => ots.find(o => o.maquina_id === maqId && o.estatus === 'en_proceso') || ots.find(o => o.maquina_id === maqId)
  const efectivo = (maqId) => estadoDe(maqId)?.estado || (otDe(maqId) ? 'trabajando' : 'sin_programa')

  const setEstado = async (estado, causaId) => {
    const ot = maqSel ? otDe(maqSel.id) : null
    await supabase.from('maquina_estado').upsert({
      maquina_id: maqSel.id, empresa_id: perfil.empresa_id, estado, ot_id: ot?.id || null,
      articulo_id: ot?.articulo_id || null, causa_id: causaId || null,
      desde: new Date().toISOString(), actualizado_por: perfil.id, actualizado_at: new Date().toISOString(),
    }, { onConflict: 'maquina_id' })
    setMsg(`Estado: ${COLOR[estado]?.lbl || estado}`); setModo('panel'); await cargar()
    setTimeout(() => setMsg(''), 2500)
  }

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>

  const wrap = full ? { ...styles.wrap, ...styles.wrapFull } : styles.wrap

  // Reporte de produccion (reusa el flujo completo con backflush)
  if (modo === 'reporte') {
    return (
      <div style={wrap}>
        <div style={styles.topbar}>
          <button style={styles.btnBack} onClick={() => setModo('panel')}>&larr; Volver a la terminal</button>
          <button style={styles.btnBack} onClick={() => setFull(f => !f)}>{full ? 'Mostrar menu' : 'Pantalla completa'}</button>
        </div>
        <div style={{ backgroundColor: '#f8fafc', borderRadius: '10px' }}><ReporteProduccion /></div>
      </div>
    )
  }

  // Selector de maquina
  if (!maqSel) {
    return (
      <div style={wrap}>
        <div style={styles.topbar}>
          <h2 style={styles.h1}>Terminal de operador · elige tu maquina</h2>
          <button style={styles.btnBack} onClick={() => setFull(f => !f)}>{full ? 'Mostrar menu' : 'Pantalla completa'}</button>
        </div>
        <div style={styles.gridMaq}>
          {maquinas.map(m => { const ef = efectivo(m.id); const c = COLOR[ef]; return (
            <button key={m.id} style={{ ...styles.maqTile, backgroundColor: c.bg }} onClick={() => { setMaqSel(m); setModo('panel') }}>
              <div style={styles.maqClave}>{m.clave}</div>
              <div style={styles.maqNom}>{m.nombre}</div>
              <div style={styles.maqEst}>{c.lbl}</div>
            </button>
          ) })}
          {maquinas.length === 0 && <p style={{ color: '#cbd5e1' }}>No hay maquinas.</p>}
        </div>
      </div>
    )
  }

  const ef = efectivo(maqSel.id)
  const c = COLOR[ef]
  const ot = otDe(maqSel.id)
  const art = ot ? artMap[ot.articulo_id] : null

  // Panel de la maquina
  return (
    <div style={wrap}>
      <div style={styles.topbar}>
        <button style={styles.btnBack} onClick={() => { setMaqSel(null); setModo('panel') }}>&larr; Cambiar maquina</button>
        <button style={styles.btnBack} onClick={() => setFull(f => !f)}>{full ? 'Mostrar menu' : 'Pantalla completa'}</button>
      </div>
      {msg && <div style={styles.toast}>{msg}</div>}

      <div style={styles.panelTop}>
        <div style={{ ...styles.estadoBig, backgroundColor: c.bg }}>
          <div style={styles.maqCla2}>{maqSel.clave}</div>
          <div style={styles.estLbl}>{c.lbl}</div>
          <div style={styles.otLbl}>{ot ? `OT ${ot.folio} · ${art?.codigo_interno || ''}` : 'Sin OT en proceso'}</div>
          <div style={styles.otDesc}>{art?.descripcion || maqSel.nombre}</div>
        </div>
        <div style={styles.sidePanel}>
          <div style={styles.sideTit}>ALERTAS DE CALIDAD</div>
          {alertas.length === 0 && <p style={styles.sideVacio}>Sin alertas vigentes.</p>}
          {alertas.slice(0, 4).map(a => (
            <div key={a.id} style={{ ...styles.alerta, borderLeftColor: a.severidad === 'critica' ? '#f87171' : a.severidad === 'mayor' ? '#fbbf24' : '#94a3b8' }}>
              <div style={{ fontWeight: 700, fontSize: '13px' }}>{a.titulo}</div>
              <div style={{ fontSize: '11px', color: '#cbd5e1' }}>{a.articulo?.codigo_interno || ''} {a.mensaje ? `· ${a.mensaje}` : ''}</div>
            </div>
          ))}
          <div style={{ ...styles.sideTit, marginTop: '14px' }}>PRIORIDADES</div>
          {prioridades.slice(0, 4).map(p => (
            <div key={p.id} style={styles.prio}><span style={styles.prioN}>{p.numero}</span><span style={{ fontSize: '13px' }}>{p.articulos?.codigo_interno}</span></div>
          ))}
          {prioridades.length === 0 && <p style={styles.sideVacio}>Sin prioridades.</p>}
        </div>
      </div>

      {modo === 'paro' ? (
        <div style={styles.paroBox}>
          <div style={styles.paroTit}>Selecciona la causa del paro</div>
          <div style={styles.causasGrid}>
            {causasParo.map(cp => <button key={cp.id} style={styles.causaBtn} onClick={() => setEstado('parada', cp.id)}>{cp.nombre}</button>)}
            {causasParo.length === 0 && <button style={styles.causaBtn} onClick={() => setEstado('parada', null)}>Paro (sin causa en catalogo)</button>}
          </div>
          <button style={styles.cancelBtn} onClick={() => setModo('panel')}>Cancelar</button>
        </div>
      ) : (
        <div style={styles.acciones}>
          <button style={{ ...styles.accBtn, backgroundColor: '#16a34a' }} onClick={() => setEstado('trabajando', null)}>TRABAJANDO</button>
          <button style={{ ...styles.accBtn, backgroundColor: '#dc2626' }} onClick={() => setModo('paro')}>PARO</button>
          <button style={{ ...styles.accBtn, backgroundColor: '#d97706' }} onClick={() => setEstado('cambio_molde', null)}>CAMBIO MOLDE</button>
          <button style={{ ...styles.accBtn, backgroundColor: '#475569' }} onClick={() => setEstado('sin_programa', null)}>SIN PROGRAMA</button>
          <button style={{ ...styles.accBtn, backgroundColor: '#2563eb' }} onClick={() => setModo('reporte')}>REPORTAR PRODUCCION</button>
        </div>
      )}
    </div>
  )
}

const styles = {
  wrap: { backgroundColor: '#0f172a', borderRadius: '12px', padding: '18px', minHeight: 'calc(100vh - 90px)' },
  wrapFull: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, borderRadius: 0, overflow: 'auto' },
  topbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' },
  h1: { color: '#fff', fontSize: '20px', fontWeight: 700, margin: 0 },
  btnBack: { padding: '10px 18px', backgroundColor: '#1e293b', color: '#cbd5e1', border: '1px solid #334155', borderRadius: '8px', fontSize: '15px', cursor: 'pointer' },
  toast: { backgroundColor: '#166534', color: '#fff', padding: '10px 16px', borderRadius: '8px', marginBottom: '12px', fontWeight: 600 },
  gridMaq: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '14px' },
  maqTile: { border: 'none', borderRadius: '14px', padding: '22px', color: '#fff', cursor: 'pointer', textAlign: 'left', minHeight: '120px' },
  maqClave: { fontSize: '30px', fontWeight: 800 },
  maqNom: { fontSize: '13px', opacity: 0.9, margin: '4px 0 10px' },
  maqEst: { fontSize: '13px', fontWeight: 700, letterSpacing: '0.5px' },
  panelTop: { display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' },
  estadoBig: { flex: 2, minWidth: '320px', borderRadius: '16px', padding: '28px', color: '#fff' },
  maqCla2: { fontSize: '40px', fontWeight: 900 },
  estLbl: { fontSize: '26px', fontWeight: 800, margin: '4px 0 16px' },
  otLbl: { fontSize: '22px', fontWeight: 700 },
  otDesc: { fontSize: '15px', opacity: 0.9, marginTop: '4px' },
  sidePanel: { flex: 1, minWidth: '260px', backgroundColor: '#1e293b', borderRadius: '16px', padding: '18px' },
  sideTit: { color: '#fbbf24', fontWeight: 800, fontSize: '13px', letterSpacing: '1px', marginBottom: '10px' },
  sideVacio: { color: '#64748b', fontSize: '13px' },
  alerta: { backgroundColor: '#0f172a', borderLeft: '4px solid #fbbf24', borderRadius: '8px', padding: '8px 10px', marginBottom: '8px', color: '#e2e8f0' },
  prio: { display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 0', color: '#e2e8f0' },
  prioN: { backgroundColor: '#fbbf24', color: '#0f172a', fontWeight: 800, width: '26px', height: '26px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px' },
  acciones: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' },
  accBtn: { border: 'none', borderRadius: '16px', padding: '34px 20px', color: '#fff', fontSize: '24px', fontWeight: 800, cursor: 'pointer', letterSpacing: '0.5px' },
  paroBox: { backgroundColor: '#1e293b', borderRadius: '16px', padding: '20px' },
  paroTit: { color: '#fff', fontSize: '20px', fontWeight: 700, marginBottom: '14px' },
  causasGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '14px' },
  causaBtn: { backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '12px', padding: '22px 14px', fontSize: '18px', fontWeight: 700, cursor: 'pointer' },
  cancelBtn: { backgroundColor: '#334155', color: '#cbd5e1', border: 'none', borderRadius: '10px', padding: '14px 22px', fontSize: '16px', cursor: 'pointer' },
}
