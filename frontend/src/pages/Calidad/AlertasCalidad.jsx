import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Alertas de calidad: avisos vigentes que difunde Calidad (defecto detectado en un
// articulo, atencion especial en piso). Pueden ligarse a una no conformidad.
const fFecha = (f) => f ? new Date(f).toLocaleDateString('es-MX') : '-'
const SEV = ['menor', 'mayor', 'critica']

export default function AlertasCalidad() {
  const { perfil, tienePermiso } = useAuth()
  const puedeCrear = tienePermiso('cal_alertas', 'crear')
  const puedeEditar = tienePermiso('cal_alertas', 'editar') || puedeCrear
  const [alertas, setAlertas] = useState([])
  const [articulos, setArticulos] = useState([])
  const [defectos, setDefectos] = useState([])
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [filtro, setFiltro] = useState('vigentes')

  useEffect(() => { cargar() }, [])
  const cargar = async () => {
    setLoading(true)
    const emp = perfil.empresa_id
    const [a, ar, de] = await Promise.all([
      supabase.from('calidad_alertas').select('*, articulo:articulos(codigo_interno), defecto:causas_scrap(nombre)').eq('empresa_id', emp).order('id', { ascending: false }),
      supabase.from('articulos').select('id, codigo_interno').eq('empresa_id', emp),
      supabase.from('causas_scrap').select('id, clave, nombre').eq('empresa_id', emp).eq('activo', true),
    ])
    setAlertas(a.data || []); setArticulos(ar.data || []); setDefectos(de.data || [])
    setLoading(false)
  }

  const abrirNueva = () => { setError(''); setExito(''); setForm({ titulo: '', articulo_id: '', defecto_id: '', mensaje: '', severidad: 'mayor', area: '', vence: '' }) }
  const crear = async () => {
    if (!form.titulo.trim()) { setError('Captura el titulo.'); return }
    const folio = `AC-${Date.now().toString().slice(-8)}`
    const { error: e } = await supabase.from('calidad_alertas').insert({ empresa_id: perfil.empresa_id, folio, titulo: form.titulo, articulo_id: form.articulo_id ? Number(form.articulo_id) : null, defecto_id: form.defecto_id ? Number(form.defecto_id) : null, mensaje: form.mensaje || null, severidad: form.severidad, area: form.area || null, vence: form.vence || null, creado_por: perfil.id })
    if (e) { setError(e.message); return }
    setExito(`Alerta ${folio} publicada.`); setForm(null); cargar()
  }
  const toggleVigente = async (a) => { await supabase.from('calidad_alertas').update({ vigente: !a.vigente }).eq('id', a.id); cargar() }

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>
  const lista = alertas.filter(a => filtro === 'vigentes' ? a.vigente : filtro === 'historial' ? !a.vigente : true)

  return (
    <div style={styles.container} className="aparecer">
      <div style={styles.encabezado}><h2 style={styles.titulo}>Alertas de calidad</h2>{puedeCrear && <button style={styles.boton} onClick={abrirNueva}>Nueva alerta</button>}</div>
      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {form && (
        <div style={styles.tarjeta}>
          <div style={styles.fila}>
            <Campo label="Titulo *"><input style={styles.input} value={form.titulo} onChange={e => setForm({ ...form, titulo: e.target.value })} placeholder="Ej. Atencion: rebaba en SH1LA001" /></Campo>
            <Campo label="Severidad"><select style={styles.input} value={form.severidad} onChange={e => setForm({ ...form, severidad: e.target.value })}>{SEV.map(s => <option key={s} value={s}>{s}</option>)}</select></Campo>
            <Campo label="Vence"><input type="date" style={styles.input} value={form.vence} onChange={e => setForm({ ...form, vence: e.target.value })} /></Campo>
          </div>
          <div style={styles.fila}>
            <Campo label="Articulo"><select style={styles.input} value={form.articulo_id} onChange={e => setForm({ ...form, articulo_id: e.target.value })}><option value="">-</option>{articulos.map(a => <option key={a.id} value={a.id}>{a.codigo_interno}</option>)}</select></Campo>
            <Campo label="Defecto"><select style={styles.input} value={form.defecto_id} onChange={e => setForm({ ...form, defecto_id: e.target.value })}><option value="">-</option>{defectos.map(d => <option key={d.id} value={d.id}>{d.nombre}</option>)}</select></Campo>
            <Campo label="Area"><input style={styles.input} value={form.area} onChange={e => setForm({ ...form, area: e.target.value })} /></Campo>
          </div>
          <Campo label="Mensaje"><input style={styles.input} value={form.mensaje} onChange={e => setForm({ ...form, mensaje: e.target.value })} /></Campo>
          <div style={styles.botones}><button style={styles.botonSec} onClick={() => setForm(null)}>Cancelar</button><button style={styles.boton} onClick={crear}>Publicar</button></div>
        </div>
      )}

      <div style={styles.tabs}>{[['vigentes', 'Vigentes'], ['historial', 'Historial'], ['todas', 'Todas']].map(([id, n]) => <button key={id} style={filtro === id ? styles.tabAct : styles.tab} onClick={() => setFiltro(id)}>{n}</button>)}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
        {lista.map(a => (
          <div key={a.id} style={{ ...styles.card, borderLeft: `4px solid ${a.severidad === 'critica' ? '#b91c1c' : a.severidad === 'mayor' ? '#d97706' : '#64748b'}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={styles.cardTit}>{a.titulo}</span>
              <span style={sevBadge(a.severidad)}>{a.severidad}</span>
            </div>
            <p style={styles.cardMsg}>{a.mensaje}</p>
            <div style={styles.cardMeta}>{a.articulo?.codigo_interno || ''} {a.defecto?.nombre ? `· ${a.defecto.nombre}` : ''} {a.area ? `· ${a.area}` : ''} · {a.folio}{a.vence ? ` · vence ${fFecha(a.vence)}` : ''}</div>
            {puedeEditar && <div style={{ marginTop: '8px' }}><button style={styles.botonAccion} onClick={() => toggleVigente(a)}>{a.vigente ? 'Desactivar' : 'Reactivar'}</button></div>}
          </div>
        ))}
        {lista.length === 0 && <p style={{ color: '#94a3b8', fontSize: '13px' }}>Sin alertas.</p>}
      </div>
    </div>
  )
}

function Campo({ label, children }) { return (<div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: '160px' }}><label style={{ fontSize: '12px', fontWeight: 500, color: '#444' }}>{label}</label>{children}</div>) }
function sevBadge(s) { const c = { menor: ['#f1f5f9', '#64748b'], mayor: ['#fef3c7', '#b45309'], critica: ['#fee2e2', '#b91c1c'] }[s] || ['#f1f5f9', '#64748b']; return { padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 700, backgroundColor: c[0], color: c[1] } }

const styles = {
  container: { padding: '28px', maxWidth: '1080px' },
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: 0 },
  tarjeta: { backgroundColor: '#fff', borderRadius: '10px', padding: '18px 20px', marginBottom: '14px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  fila: { display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '10px' },
  input: { padding: '9px 11px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', fontFamily: 'inherit', backgroundColor: '#fff' },
  botones: { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' },
  boton: { padding: '9px 18px', backgroundColor: '#b91c1c', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSec: { padding: '9px 18px', backgroundColor: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonAccion: { padding: '5px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' },
  tabs: { display: 'flex', gap: '4px', margin: '4px 0 14px', borderBottom: '1px solid #e2e8f0' },
  tab: { padding: '8px 16px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#64748b', cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabAct: { padding: '8px 16px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#b91c1c', fontWeight: '600', cursor: 'pointer', borderBottom: '2px solid #b91c1c' },
  card: { backgroundColor: '#fff', borderRadius: '10px', padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  cardTit: { fontSize: '14px', fontWeight: 700, color: '#1a1a2e' },
  cardMsg: { fontSize: '13px', color: '#334155', margin: '6px 0' },
  cardMeta: { fontSize: '11px', color: '#94a3b8' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
