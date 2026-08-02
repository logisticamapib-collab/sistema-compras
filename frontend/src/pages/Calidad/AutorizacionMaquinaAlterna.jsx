import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { exportarExcel, imprimirTablaPDF } from '../../lib/exportar'
import { useAuth } from '../../context/AuthContext'

// Ultimo eslabon del cambio de maquina: Ingenieria ya valido y adjunto el PPAP o la
// Desviacion; Calidad revisa ese documento y libera. Solo al liberar Calidad se mueve
// la OT a la maquina solicitada y (si aplica) queda registrada como alterna de la ruta.

const fFecha = (t) => t ? new Date(t).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '-'
const fDia = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('es-MX') : '-'

const EXP_BTN = { padding: '8px 14px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' }

export default function AutorizacionMaquinaAlterna() {
  const { perfil, tienePermiso } = useAuth()
  const emp = perfil.empresa_id
  const puedeAutorizar = tienePermiso('cal_maq_alterna', 'aprobar')

  const [sols, setSols] = useState([])
  const [ots, setOts] = useState([])
  const [arts, setArts] = useState([])
  const [maqs, setMaqs] = useState([])
  const [rutas, setRutas] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [proc, setProc] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [form, setForm] = useState(null)

  useEffect(() => { cargar() }, [])
  const cargar = async () => {
    setLoading(true)
    const [s, o, a, m, r, u] = await Promise.all([
      supabase.from('solicitudes_maquina_alterna').select('*').eq('empresa_id', emp).in('estatus', ['pendiente_calidad', 'aprobada', 'rechazada']).order('id', { ascending: false }).limit(200),
      supabase.from('ordenes_trabajo').select('id, folio, articulo_id, maquina_id').eq('empresa_id', emp),
      supabase.from('articulos').select('id, codigo_interno, descripcion').eq('empresa_id', emp),
      supabase.from('maquinas').select('id, clave, nombre').eq('empresa_id', emp),
      supabase.from('rutas_fabricacion').select('id, articulo_id').eq('tipo_operacion', 'inyeccion'),
      supabase.from('usuarios').select('id, nombre'),
    ])
    setSols(s.data || []); setOts(o.data || []); setArts(a.data || []); setMaqs(m.data || [])
    setRutas(r.data || []); setUsuarios(u.data || [])
    setLoading(false)
  }

  const otDe = (id) => ots.find(x => x.id === id)
  const artDe = (id) => arts.find(x => x.id === id)
  const maqDe = (id) => maqs.find(x => x.id === id)
  const usrDe = (id) => usuarios.find(x => x.id === id)?.nombre || '-'

  const resolver = async (s, liberar) => {
    setError(''); setProc(true)
    try {
      if (liberar) {
        // Calidad libera: AHORA si se mueve la OT
        await supabase.from('ordenes_trabajo').update({ maquina_id: s.maquina_solicitada_id }).eq('id', s.ot_id)
        if (s.registrar_como_alterna) {
          const ruta = rutas.find(r => r.articulo_id === s.articulo_id)
          if (ruta) {
            const { data: ya } = await supabase.from('ruta_maquinas_alternas').select('id').eq('ruta_id', ruta.id).eq('maquina_id', s.maquina_solicitada_id).maybeSingle()
            if (!ya) await supabase.from('ruta_maquinas_alternas').insert({ ruta_id: ruta.id, maquina_id: s.maquina_solicitada_id, aprobada_por_cliente: !!s.aprobada_por_cliente })
            else await supabase.from('ruta_maquinas_alternas').update({ aprobada_por_cliente: !!s.aprobada_por_cliente }).eq('id', ya.id)
          }
        }
        await supabase.from('programa_cambios').insert({
          empresa_id: emp, ot_id: s.ot_id, tipo: 'maquina_alterna_liberada', campo: 'maquina',
          antes: String(s.maquina_actual_id ?? '-'), despues: String(s.maquina_solicitada_id),
          usuario_id: perfil.id, usuario_nombre: perfil.nombre,
        })
      }
      await supabase.from('solicitudes_maquina_alterna').update({
        estatus: liberar ? 'aprobada' : 'rechazada',
        comentario_calidad: form?.comentario || null,
        aut_cal_por: perfil.id, aut_cal_at: new Date().toISOString(),
        resuelto_por: perfil.id, resuelto_at: new Date().toISOString(),
      }).eq('id', s.id)
      setExito(liberar ? `Liberado por Calidad: la OT se movio a ${maqDe(s.maquina_solicitada_id)?.clave}.` : 'Solicitud rechazada por Calidad.')
      setForm(null); await cargar()
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  if (loading) return <p style={{ padding: 28, color: '#666' }}>Cargando...</p>
  const colsExp = [
    { label: 'OT', get: r => otDe(r.ot_id)?.folio || r.ot_id },
    { label: 'Articulo', get: r => artDe(r.articulo_id)?.codigo_interno || '' },
    { label: 'Maquina actual', get: r => maqDe(r.maquina_actual_id)?.clave || '' },
    { label: 'Maquina solicitada', get: r => maqDe(r.maquina_solicitada_id)?.clave || '' },
    { label: 'Motivo', get: r => r.motivo || '' },
    { label: 'Documento', get: r => r.doc_tipo || '' },
    { label: 'Vigencia doc', get: r => r.doc_vigencia || '' },
    { label: 'Estatus', get: r => r.estatus },
    { label: 'Ingenieria', get: r => usrDe(r.aut_ing_por) },
    { label: 'Calidad', get: r => usrDe(r.aut_cal_por) },
  ]
  const pend = sols.filter(x => x.estatus === 'pendiente_calidad')

  return (
    <div style={S.c} className="aparecer">
      <h2 style={S.t}>Autorizacion de Maquina Alterna</h2>
      <div style={{ display: 'flex', gap: '8px', margin: '0 0 12px' }} className="no-imprimir">
        <button style={EXP_BTN} onClick={() => exportarExcel('autorizacion_maquina_alterna', colsExp, sols)}>Excel</button>
        <button style={EXP_BTN} onClick={() => imprimirTablaPDF('Autorizacion de Maquina Alterna', colsExp, sols)}>PDF</button>
      </div>
      <p style={S.sub}>Ingenieria ya valido el cambio y adjunto el <b>PPAP</b> o la <b>Desviacion</b>. Calidad revisa el documento y libera; hasta entonces la OT no se mueve.</p>
      {error && <p style={S.err}>{error}</p>}
      {exito && <p style={S.ok}>{exito}</p>}

      <h3 style={S.h3}>Por autorizar ({pend.length})</h3>
      <div style={S.tabla}>
        <div style={S.th}><span style={{ flex: 1 }}>OT</span><span style={{ flex: 1.3 }}>Articulo</span><span style={{ flex: 1.3 }}>Cambio</span><span style={{ flex: 1.2 }}>Documento</span><span style={{ flex: 1.2 }}>Ingenieria</span><span style={{ width: 120 }}></span></div>
        {pend.map(s => (
          <div key={s.id} style={S.tr}>
            <span style={{ flex: 1, fontWeight: 600 }}>{otDe(s.ot_id)?.folio || s.ot_id}</span>
            <span style={{ flex: 1.3, fontSize: 12.5 }}>{artDe(s.articulo_id)?.codigo_interno}</span>
            <span style={{ flex: 1.3, fontSize: 12.5 }}>{maqDe(s.maquina_actual_id)?.clave || '-'} → <b>{maqDe(s.maquina_solicitada_id)?.clave}</b></span>
            <span style={{ flex: 1.2, fontSize: 12 }}>
              <span style={{ ...S.pill, backgroundColor: s.doc_tipo === 'ppap' ? '#dcfce7' : '#fef3c7', color: s.doc_tipo === 'ppap' ? '#15803d' : '#b45309' }}>{s.doc_tipo === 'ppap' ? 'PPAP' : 'Desviacion'}</span>
              {s.doc_url && <div><a href={s.doc_url} target="_blank" rel="noreferrer" style={{ color: '#2563eb', fontSize: 11.5 }}>{s.doc_nombre || 'ver documento'}</a></div>}
              {s.doc_vigencia && <div style={{ fontSize: 11, color: '#64748b' }}>vence {fDia(s.doc_vigencia)}</div>}
            </span>
            <span style={{ flex: 1.2, fontSize: 11.5, color: '#64748b' }}>{usrDe(s.aut_ing_por)}<div>{fFecha(s.aut_ing_at)}</div></span>
            <span style={{ width: 120, textAlign: 'right' }}>
              {puedeAutorizar
                ? <button style={S.btn} onClick={() => setForm({ sol: s, comentario: '' })}>Revisar</button>
                : <span style={{ fontSize: 11, color: '#94a3b8' }}>solo Calidad</span>}
            </span>
          </div>
        ))}
        {pend.length === 0 && <div style={S.vacio}>No hay solicitudes por autorizar.</div>}
      </div>

      <h3 style={S.h3}>Historial</h3>
      <div style={S.tabla}>
        <div style={S.th}><span style={{ flex: 1 }}>OT</span><span style={{ flex: 1.3 }}>Cambio</span><span style={{ flex: 1 }}>Doc</span><span style={{ flex: 1 }}>Estatus</span><span style={{ flex: 1.2 }}>Calidad</span><span style={{ flex: 1.4 }}>Comentario</span></div>
        {sols.filter(x => x.estatus !== 'pendiente_calidad').map(s => (
          <div key={s.id} style={S.tr}>
            <span style={{ flex: 1, fontWeight: 600 }}>{otDe(s.ot_id)?.folio || s.ot_id}</span>
            <span style={{ flex: 1.3, fontSize: 12.5 }}>{maqDe(s.maquina_actual_id)?.clave || '-'} → {maqDe(s.maquina_solicitada_id)?.clave}</span>
            <span style={{ flex: 1, fontSize: 11.5 }}>{s.doc_url ? <a href={s.doc_url} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>{s.doc_tipo === 'ppap' ? 'PPAP' : 'Desviacion'}</a> : '-'}</span>
            <span style={{ flex: 1 }}><span style={{ ...S.pill, backgroundColor: s.estatus === 'aprobada' ? '#dcfce7' : '#fee2e2', color: s.estatus === 'aprobada' ? '#15803d' : '#b91c1c' }}>{s.estatus === 'aprobada' ? 'Liberada' : 'Rechazada'}</span></span>
            <span style={{ flex: 1.2, fontSize: 11.5, color: '#64748b' }}>{usrDe(s.aut_cal_por)}<div>{fFecha(s.aut_cal_at)}</div></span>
            <span style={{ flex: 1.4, fontSize: 12, color: '#64748b' }}>{s.comentario_calidad || '-'}</span>
          </div>
        ))}
        {sols.filter(x => x.estatus !== 'pendiente_calidad').length === 0 && <div style={S.vacio}>Sin historial.</div>}
      </div>

      {form && (
        <div style={S.ov} onClick={() => setForm(null)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>Autorizacion de Calidad</h3>
            <p style={S.sub}>
              OT <b>{otDe(form.sol.ot_id)?.folio}</b> · {artDe(form.sol.articulo_id)?.codigo_interno}<br />
              {maqDe(form.sol.maquina_actual_id)?.clave || '-'} → <b>{maqDe(form.sol.maquina_solicitada_id)?.clave}</b><br />
              <span style={{ color: '#475569' }}>Motivo: {form.sol.motivo}</span>
            </p>
            <div style={S.docBox}>
              <b>{form.sol.doc_tipo === 'ppap' ? 'PPAP' : 'Desviacion'}</b> adjuntado por Ingenieria
              {form.sol.doc_url && <div><a href={form.sol.doc_url} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>{form.sol.doc_nombre || 'abrir documento'}</a></div>}
              {form.sol.doc_vigencia && <div style={{ fontSize: 12, color: '#64748b' }}>Vigencia: {fDia(form.sol.doc_vigencia)}</div>}
              {form.sol.comentario_ingenieria && <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Ingenieria: {form.sol.comentario_ingenieria}</div>}
            </div>
            <label style={S.lbl}>Comentario de Calidad</label>
            <input style={S.input} value={form.comentario} onChange={e => setForm({ ...form, comentario: e.target.value })} />
            <p style={{ fontSize: 12, color: '#b45309', marginTop: 8 }}>Al liberar, la OT se movera a la maquina solicitada.</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <button style={S.btnSec} onClick={() => setForm(null)} disabled={proc}>Cerrar</button>
              <button style={S.btnRed} onClick={() => resolver(form.sol, false)} disabled={proc}>Rechazar</button>
              <button style={S.btn} onClick={() => resolver(form.sol, true)} disabled={proc}>Liberar y mover OT</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const S = {
  c: { padding: 24, maxWidth: 1100 },
  t: { fontSize: 18, fontWeight: 600, color: '#1a1a2e', margin: '0 0 4px' },
  sub: { fontSize: 13, color: '#64748b', margin: '0 0 10px', lineHeight: 1.5 },
  h3: { fontSize: 13, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.04em', margin: '18px 0 8px' },
  lbl: { fontSize: 12, fontWeight: 500, color: '#444', display: 'block' },
  docBox: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', margin: '8px 0 12px', fontSize: 13 },
  tabla: { background: '#fff', border: '1px solid #eef2f7', borderRadius: 8, overflow: 'hidden' },
  th: { display: 'flex', padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' },
  tr: { display: 'flex', padding: '10px 14px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: 13 },
  vacio: { padding: 14, color: '#94a3b8', fontSize: 13 },
  input: { padding: '9px 12px', borderRadius: 7, border: '1px solid #ddd', fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box' },
  btn: { padding: '8px 16px', background: '#b91c1c', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, cursor: 'pointer' },
  btnRed: { padding: '8px 16px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, cursor: 'pointer' },
  btnSec: { padding: '8px 14px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: 7, fontSize: 13, cursor: 'pointer' },
  pill: { padding: '2px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 700 },
  ov: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 },
  modal: { background: '#fff', borderRadius: 12, padding: 22, width: 520, maxWidth: '94vw' },
  err: { color: '#dc2626', fontSize: 13, marginBottom: 12 },
  ok: { color: '#16a34a', fontSize: 13, marginBottom: 12 },
}
