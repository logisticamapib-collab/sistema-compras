import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Cuarentena de material. Al ENVIAR a cuarentena se exige una CAUSA. Al SALIR se
// decide: causa cerrada (regresa a liberado) o el material se va a SCRAP (se
// descuenta de existencias). Todo queda en el historial (cuarentena_eventos).
const fmt = (n) => (Number(n) || 0).toLocaleString('es-MX')
const fFecha = (f) => f ? new Date(f).toLocaleDateString('es-MX') : '-'

export default function Cuarentena() {
  const { perfil, tienePermiso } = useAuth()
  const puedeEnviar = tienePermiso('cal_cuarentena', 'crear')
  const puedeSalir = tienePermiso('cal_cuarentena', 'editar')

  const [lotes, setLotes] = useState([])
  const [existencias, setExistencias] = useState([])
  const [eventos, setEventos] = useState([])
  const [causas, setCausas] = useState([])
  const [loading, setLoading] = useState(true)
  const [proc, setProc] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [vista, setVista] = useState('cuarentena')
  const [envForm, setEnvForm] = useState(null)   // { lote }
  const [salForm, setSalForm] = useState(null)   // { evento, lote }

  useEffect(() => { cargar() }, [])
  const cargar = async () => {
    setLoading(true)
    const emp = perfil.empresa_id
    const [lo, ex, ev, ca] = await Promise.all([
      supabase.from('lotes').select('*, articulo:articulos(codigo_interno, descripcion)').eq('empresa_id', emp).order('id', { ascending: false }),
      supabase.from('existencias').select('*'),
      supabase.from('cuarentena_eventos').select('*, envio:usuarios!cuarentena_eventos_enviado_por_fkey(nombre)').eq('empresa_id', emp).order('id', { ascending: false }),
      supabase.from('causas_scrap').select('id, clave, nombre').eq('empresa_id', emp).eq('activo', true),
    ])
    setLotes(lo.data || []); setExistencias(ex.data || []); setEventos(ev.data || []); setCausas(ca.data || [])
    setLoading(false)
  }
  const totalDe = (loteId) => existencias.filter(e => e.lote_id === loteId).reduce((s, e) => s + Number(e.cantidad), 0)
  const eventoActivo = (loteId) => eventos.find(e => e.lote_id === loteId && e.estatus === 'en_cuarentena')

  const enviar = async () => {
    setError('')
    const f = envForm
    if (!f.causa || !f.causa.trim()) { setError('La causa es obligatoria para enviar a cuarentena.'); return }
    setProc(true)
    try {
      const cant = totalDe(f.lote.id)
      await supabase.from('lotes').update({ estatus_calidad: 'cuarentena' }).eq('id', f.lote.id)
      await supabase.from('cuarentena_eventos').insert({ empresa_id: perfil.empresa_id, lote_id: f.lote.id, articulo_id: f.lote.articulo_id, cantidad: cant, causa: f.causa.trim(), causa_id: f.causa_id ? Number(f.causa_id) : null, enviado_por: perfil.id })
      await supabase.from('movimientos').insert({ empresa_id: perfil.empresa_id, articulo_id: f.lote.articulo_id, lote_id: f.lote.id, tipo: 'cuarentena', cantidad: cant, motivo: `Cuarentena: ${f.causa.trim()}`, usuario_id: perfil.id })
      setExito(`Lote ${f.lote.codigo_lote} enviado a cuarentena.`); setEnvForm(null); await cargar()
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  const salir = async () => {
    setError('')
    const f = salForm
    if (!f.decision) { setError('Indica la decision de salida.'); return }
    if (!f.nota || !f.nota.trim()) { setError('Escribe la nota de salida.'); return }
    setProc(true)
    try {
      const patchEv = { estatus: f.decision === 'scrap' ? 'scrap' : 'liberada', salida_decision: f.decision, salida_nota: f.nota.trim(), salida_por: perfil.id, salida_at: new Date().toISOString() }
      if (f.decision === 'cerrada') {
        await supabase.from('lotes').update({ estatus_calidad: 'liberado', liberado_por: perfil.id, liberado_en: new Date().toISOString() }).eq('id', f.lote.id)
        await supabase.from('movimientos').insert({ empresa_id: perfil.empresa_id, articulo_id: f.lote.articulo_id, lote_id: f.lote.id, tipo: 'liberacion_calidad', cantidad: totalDe(f.lote.id), motivo: `Salida cuarentena (causa cerrada): ${f.nota.trim()}`, usuario_id: perfil.id })
      } else {
        // SCRAP: descuenta existencias del lote
        for (const e of existencias.filter(x => x.lote_id === f.lote.id)) {
          await supabase.from('movimientos').insert({ empresa_id: perfil.empresa_id, articulo_id: f.lote.articulo_id, lote_id: f.lote.id, tipo: 'scrap', almacen_origen_id: e.almacen_id, ubicacion_origen_id: e.ubicacion_id || null, cantidad: Number(e.cantidad), motivo: `Scrap desde cuarentena: ${f.nota.trim()}`, usuario_id: perfil.id })
          await supabase.from('existencias').delete().eq('id', e.id)
        }
        await supabase.from('lotes').update({ estatus_calidad: 'scrap' }).eq('id', f.lote.id)
      }
      if (f.evento) await supabase.from('cuarentena_eventos').update(patchEv).eq('id', f.evento.id)
      setExito(f.decision === 'scrap' ? `Lote ${f.lote.codigo_lote} enviado a SCRAP.` : `Lote ${f.lote.codigo_lote} liberado (causa cerrada).`)
      setSalForm(null); await cargar()
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>

  const enCuarentena = lotes.filter(l => l.estatus_calidad === 'cuarentena')
  const disponibles = lotes.filter(l => ['liberado', 'retenido'].includes(l.estatus_calidad) && totalDe(l.id) > 0)

  return (
    <div style={styles.container} className="aparecer">
      <h2 style={styles.titulo}>Cuarentena</h2>
      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}
      <div style={styles.tabs}>
        {[['cuarentena', `En cuarentena (${enCuarentena.length})`], ['enviar', 'Enviar a cuarentena'], ['historial', 'Historial']].map(([id, n]) => (
          <button key={id} style={vista === id ? styles.tabAct : styles.tab} onClick={() => setVista(id)}>{n}</button>
        ))}
      </div>

      {vista === 'cuarentena' && (
        <div style={styles.tabla}>
          <div style={styles.th}><span style={{ flex: 1 }}>Lote</span><span style={{ flex: 1.4 }}>Articulo</span><span style={{ flex: 1, textAlign: 'right' }}>Cantidad</span><span style={{ flex: 2 }}>Causa</span><span style={{ width: '110px' }}></span></div>
          {enCuarentena.map(l => { const ev = eventoActivo(l.id); return (
            <div key={l.id} style={styles.tr}>
              <span style={{ flex: 1, fontWeight: 600 }}>{l.codigo_lote}</span>
              <span style={{ flex: 1.4 }}>{l.articulo?.codigo_interno}</span>
              <span style={{ flex: 1, textAlign: 'right' }}>{fmt(totalDe(l.id))}</span>
              <span style={{ flex: 2, color: '#64748b', fontSize: '12px' }}>{ev?.causa || '-'}</span>
              <span style={{ width: '110px', textAlign: 'right' }}>{puedeSalir && <button style={styles.boton} onClick={() => { setError(''); setSalForm({ evento: ev, lote: l, decision: '', nota: '' }) }}>Salir</button>}</span>
            </div>
          ) })}
          {enCuarentena.length === 0 && <div style={styles.vacio}>No hay material en cuarentena.</div>}
        </div>
      )}

      {vista === 'enviar' && (
        <div style={styles.tabla}>
          <div style={styles.th}><span style={{ flex: 1 }}>Lote</span><span style={{ flex: 1.6 }}>Articulo</span><span style={{ flex: 1 }}>Estatus</span><span style={{ flex: 1, textAlign: 'right' }}>Existencia</span><span style={{ width: '150px' }}></span></div>
          {disponibles.map(l => (
            <div key={l.id} style={styles.tr}>
              <span style={{ flex: 1, fontWeight: 600 }}>{l.codigo_lote}</span>
              <span style={{ flex: 1.6 }}>{l.articulo?.codigo_interno} <span style={{ color: '#94a3b8' }}>- {l.articulo?.descripcion}</span></span>
              <span style={{ flex: 1 }}>{l.estatus_calidad}</span>
              <span style={{ flex: 1, textAlign: 'right' }}>{fmt(totalDe(l.id))}</span>
              <span style={{ width: '150px', textAlign: 'right' }}>{puedeEnviar && <button style={styles.botonAmber} onClick={() => { setError(''); setEnvForm({ lote: l, causa: '', causa_id: '' }) }}>Enviar a cuarentena</button>}</span>
            </div>
          ))}
          {disponibles.length === 0 && <div style={styles.vacio}>Sin lotes con existencia.</div>}
        </div>
      )}

      {vista === 'historial' && (
        <div style={styles.tabla}>
          <div style={styles.th}><span style={{ flex: 1 }}>Lote</span><span style={{ flex: 2 }}>Causa</span><span style={{ flex: 1 }}>Enviado</span><span style={{ flex: 1 }}>Salida</span><span style={{ flex: 1.6 }}>Nota salida</span></div>
          {eventos.map(e => { const l = lotes.find(x => x.id === e.lote_id); return (
            <div key={e.id} style={styles.tr}>
              <span style={{ flex: 1, fontWeight: 600 }}>{l?.codigo_lote || e.lote_id}</span>
              <span style={{ flex: 2, color: '#64748b', fontSize: '12px' }}>{e.causa}</span>
              <span style={{ flex: 1, color: '#64748b', fontSize: '12px' }}>{fFecha(e.enviado_at)} · {e.envio?.nombre || ''}</span>
              <span style={{ flex: 1 }}>{e.estatus === 'en_cuarentena' ? <span style={styles.pillAmber}>en cuarentena</span> : e.salida_decision === 'scrap' ? <span style={styles.pillRed}>scrap</span> : <span style={styles.pillGreen}>cerrada</span>}</span>
              <span style={{ flex: 1.6, color: '#64748b', fontSize: '12px' }}>{e.salida_nota || '-'}</span>
            </div>
          ) })}
          {eventos.length === 0 && <div style={styles.vacio}>Sin eventos.</div>}
        </div>
      )}

      {envForm && (
        <div style={styles.overlay}><div style={styles.modal}>
          <h3 style={styles.h3}>Enviar {envForm.lote.codigo_lote} a cuarentena</h3>
          <p style={styles.sub}>La <b>causa es obligatoria</b>.</p>
          <label style={styles.lbl}>Causa (catalogo)</label>
          <select style={styles.input} value={envForm.causa_id} onChange={e => { const c = causas.find(x => x.id === Number(e.target.value)); setEnvForm({ ...envForm, causa_id: e.target.value, causa: c ? c.nombre : envForm.causa }) }}>
            <option value="">Otra / escribir</option>
            {causas.map(c => <option key={c.id} value={c.id}>{c.clave} - {c.nombre}</option>)}
          </select>
          <label style={{ ...styles.lbl, marginTop: '8px' }}>Causa (detalle) *</label>
          <input style={styles.input} value={envForm.causa} onChange={e => setEnvForm({ ...envForm, causa: e.target.value })} autoFocus placeholder="Describe la causa" />
          <div style={styles.botones}><button style={styles.botonSec} onClick={() => setEnvForm(null)} disabled={proc}>Cancelar</button><button style={styles.botonAmber} onClick={enviar} disabled={proc || !envForm.causa.trim()}>Enviar a cuarentena</button></div>
        </div></div>
      )}

      {salForm && (
        <div style={styles.overlay}><div style={styles.modal}>
          <h3 style={styles.h3}>Salida de cuarentena · {salForm.lote.codigo_lote}</h3>
          <label style={styles.lbl}>Decision *</label>
          <div style={{ display: 'flex', gap: '10px', margin: '6px 0 10px' }}>
            <button style={salForm.decision === 'cerrada' ? styles.optOn : styles.opt} onClick={() => setSalForm({ ...salForm, decision: 'cerrada' })}>Causa cerrada (liberar)</button>
            <button style={salForm.decision === 'scrap' ? styles.optRedOn : styles.opt} onClick={() => setSalForm({ ...salForm, decision: 'scrap' })}>Scrap (descartar)</button>
          </div>
          <label style={styles.lbl}>Nota *</label>
          <input style={styles.input} value={salForm.nota} onChange={e => setSalForm({ ...salForm, nota: e.target.value })} autoFocus placeholder={salForm.decision === 'scrap' ? 'Motivo del scrap' : 'Dictamen de liberacion'} />
          <div style={styles.botones}><button style={styles.botonSec} onClick={() => setSalForm(null)} disabled={proc}>Cancelar</button><button style={salForm.decision === 'scrap' ? styles.botonRed : styles.boton} onClick={salir} disabled={proc || !salForm.decision || !salForm.nota.trim()}>Confirmar salida</button></div>
        </div></div>
      )}
    </div>
  )
}

const styles = {
  container: { padding: '28px', maxWidth: '1040px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 12px' },
  h3: { fontSize: '15px', fontWeight: 600, color: '#1a1a2e', margin: '0 0 6px' },
  sub: { fontSize: '13px', color: '#64748b', margin: '0 0 10px' },
  lbl: { fontSize: '12px', fontWeight: 500, color: '#444' },
  tabs: { display: 'flex', gap: '4px', marginBottom: '14px', borderBottom: '1px solid #e2e8f0' },
  tab: { padding: '8px 16px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#64748b', cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabAct: { padding: '8px 16px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#b45309', fontWeight: '600', cursor: 'pointer', borderBottom: '2px solid #b45309' },
  tabla: { backgroundColor: '#fff', border: '1px solid #eef2f7', borderRadius: '8px', overflow: 'hidden' },
  th: { display: 'flex', padding: '10px 16px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tr: { display: 'flex', padding: '11px 16px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px' },
  vacio: { padding: '14px 16px', color: '#94a3b8', fontSize: '13px' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' },
  botones: { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '14px' },
  boton: { padding: '8px 16px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 500, cursor: 'pointer' },
  botonRed: { padding: '8px 16px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 500, cursor: 'pointer' },
  botonAmber: { padding: '7px 14px', backgroundColor: '#d97706', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 500, cursor: 'pointer' },
  botonSec: { padding: '8px 16px', backgroundColor: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  opt: { flex: 1, padding: '10px', backgroundColor: '#f1f5f9', color: '#334155', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' },
  optOn: { flex: 1, padding: '10px', backgroundColor: '#dcfce7', color: '#15803d', border: '1px solid #86efac', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' },
  optRedOn: { flex: 1, padding: '10px', backgroundColor: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' },
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 },
  modal: { backgroundColor: '#fff', borderRadius: '12px', padding: '22px', width: '440px', maxWidth: '92vw', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' },
  pillAmber: { padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 700, backgroundColor: '#fef3c7', color: '#b45309' },
  pillRed: { padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 700, backgroundColor: '#fee2e2', color: '#b91c1c' },
  pillGreen: { padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 700, backgroundColor: '#dcfce7', color: '#15803d' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
