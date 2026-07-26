import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Catalogo de tipos de mantenimiento (define si reinicia el contador de shots)
// y parametros del try-out (que firmas se exigen para liberar una reparacion).
const CLASES = [
  { v: 'preventivo_shots', l: 'Preventivo por shots' },
  { v: 'preventivo_calendario', l: 'Preventivo por calendario' },
  { v: 'correctivo', l: 'Correctivo' },
]

export default function TiposMtto() {
  const { perfil, tienePermiso } = useAuth()
  const puedeEditar = tienePermiso('mol_tipos', 'editar') || tienePermiso('mol_tipos', 'crear')
  const [tipos, setTipos] = useState([])
  const [param, setParam] = useState(null)
  const [nuevo, setNuevo] = useState({ nombre: '', clase: 'correctivo', reinicia_contador: false })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  useEffect(() => { cargar() }, [])
  const cargar = async () => {
    setLoading(true)
    const [t, p] = await Promise.all([
      supabase.from('mtto_tipos').select('*').eq('empresa_id', perfil.empresa_id).order('id'),
      supabase.from('mtto_parametros').select('*').eq('empresa_id', perfil.empresa_id).maybeSingle(),
    ])
    setTipos(t.data || [])
    setParam(p.data || { empresa_id: perfil.empresa_id, tryout_requiere_calidad: true, tryout_requiere_produccion: true, tryout_requiere_ingenieria: true })
    setLoading(false)
  }

  const agregar = async () => {
    setError(''); setExito('')
    if (!nuevo.nombre.trim()) { setError('Captura el nombre del tipo.'); return }
    const { error: e } = await supabase.from('mtto_tipos').insert({ empresa_id: perfil.empresa_id, ...nuevo })
    if (e) { setError(e.message); return }
    setNuevo({ nombre: '', clase: 'correctivo', reinicia_contador: false }); setExito('Tipo agregado.'); cargar()
  }
  const toggle = async (t, campo) => {
    await supabase.from('mtto_tipos').update({ [campo]: !t[campo] }).eq('id', t.id)
    setTipos(ts => ts.map(x => x.id === t.id ? { ...x, [campo]: !x[campo] } : x))
  }
  const guardarParam = async (patch) => {
    const np = { ...param, ...patch }
    setParam(np)
    await supabase.from('mtto_parametros').upsert({ empresa_id: perfil.empresa_id, tryout_requiere_calidad: np.tryout_requiere_calidad, tryout_requiere_produccion: np.tryout_requiere_produccion, tryout_requiere_ingenieria: np.tryout_requiere_ingenieria, updated_at: new Date().toISOString() }, { onConflict: 'empresa_id' })
    setExito('Parametros del try-out guardados.')
  }

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>
  return (
    <div style={styles.container} className="aparecer">
      <h2 style={styles.titulo}>Tipos y parametros de mantenimiento</h2>
      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      <div style={styles.tarjeta}>
        <h3 style={styles.h3}>Tipos de mantenimiento</h3>
        <div style={styles.tabla}>
          <div style={styles.th}><span style={{ flex: 2 }}>Nombre</span><span style={{ flex: 1.4 }}>Clase</span><span style={{ flex: 1, textAlign: 'center' }}>Reinicia shots</span><span style={{ flex: 1, textAlign: 'center' }}>Activo</span></div>
          {tipos.map(t => (
            <div key={t.id} style={styles.tr}>
              <span style={{ flex: 2, fontWeight: 500 }}>{t.nombre}</span>
              <span style={{ flex: 1.4, color: '#64748b' }}>{(CLASES.find(c => c.v === t.clase) || {}).l || t.clase}</span>
              <span style={{ flex: 1, textAlign: 'center' }}><input type="checkbox" checked={!!t.reinicia_contador} disabled={!puedeEditar} onChange={() => toggle(t, 'reinicia_contador')} /></span>
              <span style={{ flex: 1, textAlign: 'center' }}><input type="checkbox" checked={!!t.activo} disabled={!puedeEditar} onChange={() => toggle(t, 'activo')} /></span>
            </div>
          ))}
        </div>
        {puedeEditar && (
          <div style={{ ...styles.fila, marginTop: '12px', alignItems: 'flex-end' }}>
            <Campo label="Nuevo tipo"><input style={styles.input} value={nuevo.nombre} onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })} placeholder="Ej. Pulido de cavidad" /></Campo>
            <Campo label="Clase"><select style={styles.input} value={nuevo.clase} onChange={e => setNuevo({ ...nuevo, clase: e.target.value })}>{CLASES.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}</select></Campo>
            <label style={styles.check}><input type="checkbox" checked={nuevo.reinicia_contador} onChange={e => setNuevo({ ...nuevo, reinicia_contador: e.target.checked })} /> Reinicia shots</label>
            <button style={styles.boton} onClick={agregar}>Agregar</button>
          </div>
        )}
      </div>

      <div style={styles.tarjeta}>
        <h3 style={styles.h3}>Try-out de liberacion (firmas requeridas)</h3>
        <p style={styles.sub}>Que areas deben validar que la reparacion fue efectiva antes de liberar el molde.</p>
        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          <label style={styles.check}><input type="checkbox" checked={!!param.tryout_requiere_calidad} disabled={!puedeEditar} onChange={e => guardarParam({ tryout_requiere_calidad: e.target.checked })} /> Calidad</label>
          <label style={styles.check}><input type="checkbox" checked={!!param.tryout_requiere_produccion} disabled={!puedeEditar} onChange={e => guardarParam({ tryout_requiere_produccion: e.target.checked })} /> Produccion</label>
          <label style={styles.check}><input type="checkbox" checked={!!param.tryout_requiere_ingenieria} disabled={!puedeEditar} onChange={e => guardarParam({ tryout_requiere_ingenieria: e.target.checked })} /> Ingenieria</label>
        </div>
      </div>
    </div>
  )
}

function Campo({ label, children }) { return (<div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: '150px' }}><label style={{ fontSize: '12px', fontWeight: 500, color: '#444' }}>{label}</label>{children}</div>) }
const styles = {
  container: { padding: '28px', maxWidth: '900px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 12px' },
  sub: { fontSize: '12px', color: '#64748b', margin: '0 0 10px' },
  h3: { fontSize: '14px', fontWeight: 600, color: '#1a1a2e', margin: '0 0 12px' },
  tarjeta: { backgroundColor: '#fff', borderRadius: '10px', padding: '18px 20px', marginBottom: '14px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  fila: { display: 'flex', gap: '12px', flexWrap: 'wrap' },
  check: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#334155' },
  input: { padding: '9px 11px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', fontFamily: 'inherit', backgroundColor: '#fff' },
  boton: { padding: '9px 18px', backgroundColor: '#a16207', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  tabla: { border: '1px solid #eef2f7', borderRadius: '8px', overflow: 'hidden' },
  th: { display: 'flex', padding: '9px 14px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tr: { display: 'flex', padding: '10px 14px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
