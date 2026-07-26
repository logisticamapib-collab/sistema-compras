import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Estado y disponibilidad de moldes. Si el molde NO esta disponible, no puede
// programarse (se valida en el alta de OT). Aqui se cambia el estado manualmente
// (p.ej. fuera_servicio) y se ve el conteo de shots vs alerta.
const fmt = (n) => Number(n ?? 0).toLocaleString('es-MX')
const ESTADOS = ['disponible', 'en_produccion', 'en_reparacion', 'en_mantenimiento', 'en_maquila', 'fuera_servicio']

export default function MoldesEstado() {
  const { perfil, tienePermiso } = useAuth()
  const puedeEditar = tienePermiso('mol_estado', 'editar') || tienePermiso('mol_estado', 'crear')
  const [moldes, setMoldes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  useEffect(() => { cargar() }, [])
  const cargar = async () => {
    setLoading(true)
    const { data } = await supabase.from('moldes').select('*').eq('empresa_id', perfil.empresa_id).order('clave')
    setMoldes(data || []); setLoading(false)
  }

  const cambiarEstado = async (m, estado) => {
    setError(''); setExito('')
    const { error: e } = await supabase.from('moldes').update({ estado }).eq('id', m.id)
    if (e) { setError(e.message); return }
    setExito(`Molde ${m.clave}: estado ${estado.replace(/_/g, ' ')}`)
    setMoldes(ms => ms.map(x => x.id === m.id ? { ...x, estado } : x))
  }

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>

  const alertaShots = (m) => m.shots_alerta_max && Number(m.shots_acumulados) >= Number(m.shots_alerta_max)

  return (
    <div style={styles.container} className="aparecer">
      <h2 style={styles.titulo}>Moldes y estado</h2>
      <p style={styles.sub}>Disponibilidad y conteo de shots. Un molde en reparacion o mantenimiento <b>no puede programarse</b> en OT.</p>
      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}
      <div style={styles.tabla}>
        <div style={styles.th}>
          <span style={{ flex: 1 }}>Clave</span><span style={{ flex: 1.6 }}>Nombre</span>
          <span style={{ flex: 1, textAlign: 'right' }}>Shots</span><span style={{ flex: 1, textAlign: 'right' }}>Alerta max</span>
          <span style={{ flex: 1.2 }}>Ubicacion</span><span style={{ flex: 1.4 }}>Estado</span>
        </div>
        {moldes.map(m => (
          <div key={m.id} style={styles.tr}>
            <span style={{ flex: 1, fontWeight: 600 }}>{m.clave}</span>
            <span style={{ flex: 1.6, color: '#475569' }}>{m.nombre}</span>
            <span style={{ flex: 1, textAlign: 'right', color: alertaShots(m) ? '#dc2626' : '#334155', fontWeight: alertaShots(m) ? 700 : 400 }}>{fmt(m.shots_acumulados)}</span>
            <span style={{ flex: 1, textAlign: 'right', color: '#94a3b8' }}>{m.shots_alerta_max ? fmt(m.shots_alerta_max) : '-'}</span>
            <span style={{ flex: 1.2, color: '#64748b', fontSize: '12px' }}>{m.ubicacion_fisica || '-'}</span>
            <span style={{ flex: 1.4 }}>
              {puedeEditar
                ? <select value={m.estado || 'disponible'} onChange={e => cambiarEstado(m, e.target.value)} style={{ ...styles.input, ...estiloEstado(m.estado) }}>
                    {ESTADOS.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                  </select>
                : <span style={badge(m.estado)}>{(m.estado || 'disponible').replace(/_/g, ' ')}</span>}
            </span>
          </div>
        ))}
        {moldes.length === 0 && <div style={styles.vacio}>No hay moldes. Se dan de alta en Ingenieria / Catalogos.</div>}
      </div>
    </div>
  )
}

function colorEstado(e) {
  return { disponible: ['#dcfce7', '#15803d'], en_produccion: ['#dbeafe', '#2563eb'], en_reparacion: ['#fee2e2', '#b91c1c'], en_mantenimiento: ['#fef3c7', '#b45309'], en_maquila: ['#ede9fe', '#7c3aed'], fuera_servicio: ['#e2e8f0', '#475569'] }[e] || ['#f1f5f9', '#64748b']
}
function badge(e) { const c = colorEstado(e); return { padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, backgroundColor: c[0], color: c[1] } }
function estiloEstado(e) { const c = colorEstado(e); return { backgroundColor: c[0], color: c[1], fontWeight: 600 } }

const styles = {
  container: { padding: '28px', maxWidth: '1000px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 6px' },
  sub: { fontSize: '13px', color: '#64748b', margin: '0 0 16px' },
  tabla: { backgroundColor: '#fff', border: '1px solid #eef2f7', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  th: { display: 'flex', padding: '11px 16px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tr: { display: 'flex', padding: '10px 16px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px' },
  input: { padding: '7px 10px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '13px', outline: 'none', fontFamily: 'inherit' },
  vacio: { padding: '14px 16px', color: '#94a3b8', fontSize: '13px' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
