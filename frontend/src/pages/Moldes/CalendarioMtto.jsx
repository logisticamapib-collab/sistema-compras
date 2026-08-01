import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import FiltroSite from '../../components/FiltroSite'
import { siteEfectivo } from '../../lib/sites'

// Calendario / programa de mantenimiento preventivo. Detecta moldes vencidos
// por SHOTS (>= alerta) y por PERIODICIDAD (dias desde el ultimo mtto), y permite
// generar la orden preventiva (queda 'programada'). El molde no se bloquea hasta
// que la orden se inicia en Ordenes de Mantenimiento.
const fmt = (n) => Number(n ?? 0).toLocaleString('es-MX')
const hoy = () => new Date().toISOString().split('T')[0]
const fFecha = (f) => f ? new Date(f + 'T00:00:00').toLocaleDateString('es-MX') : '-'
const addDias = (fecha, d) => { const x = new Date(fecha + 'T00:00:00'); x.setDate(x.getDate() + Number(d)); return x.toISOString().split('T')[0] }

export default function CalendarioMtto() {
  const { perfil, tienePermiso } = useAuth()
  const puedeCrear = tienePermiso('mol_calendario', 'crear')
  const [moldes, setMoldes] = useState([])
  const [site, setSite] = useState('')
  const [abiertas, setAbiertas] = useState([])
  const [tipos, setTipos] = useState([])
  const [loading, setLoading] = useState(true)
  const [proc, setProc] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  useEffect(() => { cargar() }, [site])
  const cargar = async () => {
    setLoading(true)
    const emp = perfil.empresa_id
    const [mo, ab, ti] = await Promise.all([
      supabase.from('moldes').select('*').eq('empresa_id', emp).eq('activo', true).order('clave'),
      supabase.from('molde_mtto').select('id, molde_id, estatus').eq('empresa_id', emp).in('estatus', ['programada', 'en_proceso', 'tryout']),
      supabase.from('mtto_tipos').select('*').eq('empresa_id', emp).eq('activo', true),
    ])
    setMoldes(mo.data || []); setAbiertas(ab.data || []); setTipos(ti.data || [])
    setLoading(false)
  }

  const evaluar = (m) => {
    const dueShots = Number(m.shots_alerta_max || 0) > 0 && Number(m.shots_acumulados || 0) >= Number(m.shots_alerta_max)
    const proxima = m.periodicidad_mtto_dias ? (m.fecha_ultimo_mtto ? addDias(m.fecha_ultimo_mtto, m.periodicidad_mtto_dias) : 'nunca') : null
    const dueCal = m.periodicidad_mtto_dias && (!m.fecha_ultimo_mtto || proxima <= hoy())
    const tieneOrden = abiertas.some(a => a.molde_id === m.id)
    return { dueShots, dueCal, proxima, tieneOrden }
  }

  const generar = async (m, clase) => {
    setError(''); setExito('')
    setProc(true)
    try {
      const tipo = tipos.find(t => t.clase === clase) || tipos.find(t => t.clase.startsWith('preventivo'))
      const folio = `MM-${Date.now().toString().slice(-8)}`
      const { error: e } = await supabase.from('molde_mtto').insert({
        empresa_id: perfil.empresa_id, folio, molde_id: m.id, tipo_id: tipo?.id || null,
        motivo_origen: 'interno', causa: clase === 'preventivo_shots' ? 'desgaste_shots' : null,
        descripcion: clase === 'preventivo_shots' ? `Preventivo por shots (${fmt(m.shots_acumulados)})` : 'Preventivo por calendario',
        reinicia_contador: !!tipo?.reinicia_contador, shots_al_abrir: Number(m.shots_acumulados || 0),
        estatus: 'programada', fecha_programada: hoy(), creado_por: perfil.id,
      })
      if (e) throw e
      setExito(`Orden preventiva ${folio} programada para ${m.clave}. Iniciala en Ordenes de Mantenimiento.`)
      cargar()
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>

  const evaluados = moldes.map(m => ({ m, ev: evaluar(m) }))
  const vencidos = evaluados.filter(x => (x.ev.dueShots || x.ev.dueCal) && !x.ev.tieneOrden)
  const resto = evaluados.filter(x => !((x.ev.dueShots || x.ev.dueCal) && !x.ev.tieneOrden))

  const Fila = ({ m, ev }) => (
    <div style={styles.tr}>
      <span style={{ flex: 1, fontWeight: 600 }}>{m.clave}</span>
      <span style={{ flex: 1.4, color: '#475569' }}>{m.nombre}</span>
      <span style={{ flex: 1, textAlign: 'right', color: ev.dueShots ? '#dc2626' : '#334155', fontWeight: ev.dueShots ? 700 : 400 }}>{fmt(m.shots_acumulados)}{m.shots_alerta_max ? ` / ${fmt(m.shots_alerta_max)}` : ''}</span>
      <span style={{ flex: 1, textAlign: 'center', color: '#64748b', fontSize: '12px' }}>{m.periodicidad_mtto_dias ? `${m.periodicidad_mtto_dias}d` : '-'}</span>
      <span style={{ flex: 1.2, textAlign: 'center', color: ev.dueCal ? '#dc2626' : '#64748b', fontSize: '12px' }}>{ev.proxima === 'nunca' ? 'sin registro' : (ev.proxima ? fFecha(ev.proxima) : '-')}</span>
      <span style={{ flex: 1.3 }}>
        {ev.tieneOrden ? <span style={styles.pillOrden}>orden abierta</span>
          : ev.dueShots ? <span style={styles.pillVenc}>vencido por shots</span>
            : ev.dueCal ? <span style={styles.pillVenc}>vencido calendario</span>
              : <span style={styles.pillOk}>en tiempo</span>}
      </span>
      <span style={{ width: '150px', textAlign: 'right' }}>
        {puedeCrear && !ev.tieneOrden && (ev.dueShots || ev.dueCal) &&
          <button style={styles.boton} onClick={() => generar(m, ev.dueShots ? 'preventivo_shots' : 'preventivo_calendario')} disabled={proc}>Programar</button>}
      </span>
    </div>
  )

  return (
    <div style={styles.container} className="aparecer">
      <h2 style={styles.titulo}>Calendario / Programa de mantenimiento</h2>
      <div style={{ marginBottom: 10 }} className="no-imprimir"><FiltroSite value={site} onChange={setSite} /></div>
      <p style={styles.sub}>Preventivo automatico por <b>shots</b> (&ge; alerta) y por <b>periodicidad</b> (dias desde el ultimo mtto, se define en cada molde). Genera la orden con un clic; queda programada hasta que se inicia.</p>
      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      <h3 style={styles.h3}>Vencidos ({vencidos.length})</h3>
      <div style={styles.tabla}>
        <div style={styles.th}><span style={{ flex: 1 }}>Clave</span><span style={{ flex: 1.4 }}>Nombre</span><span style={{ flex: 1, textAlign: 'right' }}>Shots / alerta</span><span style={{ flex: 1, textAlign: 'center' }}>Period.</span><span style={{ flex: 1.2, textAlign: 'center' }}>Proxima</span><span style={{ flex: 1.3 }}>Estatus</span><span style={{ width: '150px' }}></span></div>
        {vencidos.map(x => <Fila key={x.m.id} {...x} />)}
        {vencidos.length === 0 && <div style={styles.vacio}>Ningun molde vencido.</div>}
      </div>

      <h3 style={{ ...styles.h3, marginTop: '20px' }}>Todos los moldes</h3>
      <div style={styles.tabla}>
        <div style={styles.th}><span style={{ flex: 1 }}>Clave</span><span style={{ flex: 1.4 }}>Nombre</span><span style={{ flex: 1, textAlign: 'right' }}>Shots / alerta</span><span style={{ flex: 1, textAlign: 'center' }}>Period.</span><span style={{ flex: 1.2, textAlign: 'center' }}>Proxima</span><span style={{ flex: 1.3 }}>Estatus</span><span style={{ width: '150px' }}></span></div>
        {resto.map(x => <Fila key={x.m.id} {...x} />)}
      </div>
    </div>
  )
}

const styles = {
  container: { padding: '28px', maxWidth: '1080px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 6px' },
  sub: { fontSize: '13px', color: '#64748b', margin: '0 0 16px', lineHeight: 1.5 },
  h3: { fontSize: '14px', fontWeight: 600, color: '#1a1a2e', margin: '0 0 10px' },
  tabla: { backgroundColor: '#fff', border: '1px solid #eef2f7', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' },
  th: { display: 'flex', padding: '9px 14px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tr: { display: 'flex', padding: '10px 14px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px' },
  vacio: { padding: '12px 14px', color: '#94a3b8', fontSize: '13px' },
  boton: { padding: '6px 12px', backgroundColor: '#a16207', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 500, cursor: 'pointer' },
  pillVenc: { padding: '2px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, backgroundColor: '#fee2e2', color: '#b91c1c' },
  pillOk: { padding: '2px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, backgroundColor: '#dcfce7', color: '#15803d' },
  pillOrden: { padding: '2px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, backgroundColor: '#fef3c7', color: '#b45309' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
