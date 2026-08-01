import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Ingenieria autoriza (o rechaza) mover una OT a una maquina que no esta dada de alta
// como alterna aprobada en la ruta del articulo. Al aprobar puede dejarla registrada
// como maquina alterna permanente de esa ruta (y marcar si el cliente la aprobo).

const fFecha = (t) => t ? new Date(t).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '-'
const EST = { pendiente: { l: 'Pendiente', c: '#b45309' }, aprobada: { l: 'Aprobada', c: '#16a34a' }, rechazada: { l: 'Rechazada', c: '#dc2626' } }

export default function AprobacionMaquinaAlterna() {
  const { perfil, tienePermiso } = useAuth()
  const emp = perfil.empresa_id
  const puedeAprobar = tienePermiso('ing_maq_alterna', 'aprobar')

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
      supabase.from('solicitudes_maquina_alterna').select('*').eq('empresa_id', emp).order('id', { ascending: false }).limit(200),
      supabase.from('ordenes_trabajo').select('id, folio, articulo_id, maquina_id').eq('empresa_id', emp),
      supabase.from('articulos').select('id, codigo_interno, descripcion').eq('empresa_id', emp),
      supabase.from('maquinas').select('id, clave, nombre').eq('empresa_id', emp),
      supabase.from('rutas_fabricacion').select('id, articulo_id, maquina_principal_id').eq('tipo_operacion', 'inyeccion'),
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

  const resolver = async (s, aprobar) => {
    setError(''); setProc(true)
    try {
      if (aprobar) {
        // 1) mueve la OT a la maquina solicitada
        await supabase.from('ordenes_trabajo').update({ maquina_id: s.maquina_solicitada_id }).eq('id', s.ot_id)
        // 2) opcionalmente deja la maquina registrada como alterna de la ruta
        if (form?.registrar) {
          const ruta = rutas.find(r => r.articulo_id === s.articulo_id)
          if (ruta) {
            const { data: ya } = await supabase.from('ruta_maquinas_alternas').select('id').eq('ruta_id', ruta.id).eq('maquina_id', s.maquina_solicitada_id).maybeSingle()
            if (!ya) await supabase.from('ruta_maquinas_alternas').insert({ ruta_id: ruta.id, maquina_id: s.maquina_solicitada_id, aprobada_por_cliente: !!form?.cliente })
            else await supabase.from('ruta_maquinas_alternas').update({ aprobada_por_cliente: !!form?.cliente }).eq('id', ya.id)
          }
        }
        await supabase.from('programa_cambios').insert({
          empresa_id: emp, ot_id: s.ot_id, tipo: 'maquina_alterna_aprobada', campo: 'maquina',
          antes: String(s.maquina_actual_id ?? '-'), despues: String(s.maquina_solicitada_id),
          usuario_id: perfil.id, usuario_nombre: perfil.nombre,
        })
      }
      await supabase.from('solicitudes_maquina_alterna').update({
        estatus: aprobar ? 'aprobada' : 'rechazada',
        aprobada_por_cliente: aprobar ? !!form?.cliente : false,
        registrar_como_alterna: aprobar ? !!form?.registrar : false,
        comentario_ingenieria: form?.comentario || null,
        resuelto_por: perfil.id, resuelto_at: new Date().toISOString(),
      }).eq('id', s.id)
      setExito(aprobar ? `Autorizada: la OT se movio a ${maqDe(s.maquina_solicitada_id)?.clave}.` : 'Solicitud rechazada.')
      setForm(null); await cargar()
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  if (loading) return <p style={{ padding: 28, color: '#666' }}>Cargando...</p>
  const pend = sols.filter(x => x.estatus === 'pendiente')

  return (
    <div style={S.c} className="aparecer">
      <h2 style={S.t}>Aprobacion de Maquina Alterna</h2>
      <p style={S.sub}>Planeacion solicita correr una OT en una maquina que no esta dada de alta como alterna aprobada en la ruta. Ingenieria autoriza el cambio.</p>
      {error && <p style={S.err}>{error}</p>}
      {exito && <p style={S.ok}>{exito}</p>}

      <h3 style={S.h3}>Pendientes ({pend.length})</h3>
      <div style={S.tabla}>
        <div style={S.th}><span style={{ flex: 1 }}>OT</span><span style={{ flex: 1.4 }}>Articulo</span><span style={{ flex: 1.4 }}>Cambio</span><span style={{ flex: 1.6 }}>Motivo</span><span style={{ flex: 1 }}>Solicito</span><span style={{ width: 190 }}></span></div>
        {pend.map(s => (
          <div key={s.id} style={S.tr}>
            <span style={{ flex: 1, fontWeight: 600 }}>{otDe(s.ot_id)?.folio || s.ot_id}</span>
            <span style={{ flex: 1.4, fontSize: 12.5 }}>{artDe(s.articulo_id)?.codigo_interno}</span>
            <span style={{ flex: 1.4, fontSize: 12.5 }}>{maqDe(s.maquina_actual_id)?.clave || '-'} → <b>{maqDe(s.maquina_solicitada_id)?.clave}</b></span>
            <span style={{ flex: 1.6, fontSize: 12, color: '#64748b' }}>{s.motivo}</span>
            <span style={{ flex: 1, fontSize: 11.5, color: '#64748b' }}>{usrDe(s.solicitado_por)}<div>{fFecha(s.solicitado_at)}</div></span>
            <span style={{ width: 190, textAlign: 'right' }}>
              {puedeAprobar
                ? <button style={S.btn} onClick={() => setForm({ sol: s, registrar: true, cliente: false, comentario: '' })}>Revisar</button>
                : <span style={{ fontSize: 11, color: '#94a3b8' }}>solo Ingenieria autoriza</span>}
            </span>
          </div>
        ))}
        {pend.length === 0 && <div style={S.vacio}>No hay solicitudes pendientes.</div>}
      </div>

      <h3 style={S.h3}>Historial</h3>
      <div style={S.tabla}>
        <div style={S.th}><span style={{ flex: 1 }}>OT</span><span style={{ flex: 1.4 }}>Cambio</span><span style={{ flex: 1 }}>Estatus</span><span style={{ flex: 1.4 }}>Resolvio</span><span style={{ flex: 1.6 }}>Comentario</span></div>
        {sols.filter(x => x.estatus !== 'pendiente').map(s => (
          <div key={s.id} style={S.tr}>
            <span style={{ flex: 1, fontWeight: 600 }}>{otDe(s.ot_id)?.folio || s.ot_id}</span>
            <span style={{ flex: 1.4, fontSize: 12.5 }}>{maqDe(s.maquina_actual_id)?.clave || '-'} → {maqDe(s.maquina_solicitada_id)?.clave}</span>
            <span style={{ flex: 1 }}><span style={{ ...S.pill, backgroundColor: (EST[s.estatus]?.c || '#64748b') + '22', color: EST[s.estatus]?.c }}>{EST[s.estatus]?.l}</span>{s.aprobada_por_cliente && <span style={{ ...S.pill, backgroundColor: '#dcfce7', color: '#15803d', marginLeft: 4 }}>cliente</span>}</span>
            <span style={{ flex: 1.4, fontSize: 11.5, color: '#64748b' }}>{usrDe(s.resuelto_por)}<div>{fFecha(s.resuelto_at)}</div></span>
            <span style={{ flex: 1.6, fontSize: 12, color: '#64748b' }}>{s.comentario_ingenieria || '-'}</span>
          </div>
        ))}
        {sols.filter(x => x.estatus !== 'pendiente').length === 0 && <div style={S.vacio}>Sin historial.</div>}
      </div>

      {form && (
        <div style={S.ov} onClick={() => setForm(null)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>Solicitud de maquina alterna</h3>
            <p style={S.sub}>
              OT <b>{otDe(form.sol.ot_id)?.folio}</b> · {artDe(form.sol.articulo_id)?.codigo_interno}<br />
              {maqDe(form.sol.maquina_actual_id)?.clave || '-'} → <b>{maqDe(form.sol.maquina_solicitada_id)?.clave}</b><br />
              <span style={{ color: '#475569' }}>Motivo: {form.sol.motivo}</span>
            </p>
            <label style={S.chk}><input type="checkbox" checked={form.registrar} onChange={e => setForm({ ...form, registrar: e.target.checked })} /> Registrar esta maquina como <b>alterna permanente</b> en la ruta del articulo</label>
            <label style={S.chk}><input type="checkbox" checked={form.cliente} onChange={e => setForm({ ...form, cliente: e.target.checked })} /> La maquina esta <b>aprobada por el cliente</b> (PPAP)</label>
            <label style={{ ...S.lbl, marginTop: 8 }}>Comentario de Ingenieria</label>
            <input style={S.input} value={form.comentario} onChange={e => setForm({ ...form, comentario: e.target.value })} />
            {!form.cliente && form.registrar && <p style={{ fontSize: 12, color: '#b45309', marginTop: 8 }}>Sin aprobacion del cliente la maquina queda registrada pero <b>no</b> se ofrecera como autorizada en Planeacion.</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <button style={S.btnSec} onClick={() => setForm(null)} disabled={proc}>Cerrar</button>
              <button style={S.btnRed} onClick={() => resolver(form.sol, false)} disabled={proc}>Rechazar</button>
              <button style={S.btn} onClick={() => resolver(form.sol, true)} disabled={proc}>Autorizar y mover OT</button>
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
  chk: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, margin: '6px 0', cursor: 'pointer' },
  tabla: { background: '#fff', border: '1px solid #eef2f7', borderRadius: 8, overflow: 'hidden' },
  th: { display: 'flex', padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' },
  tr: { display: 'flex', padding: '10px 14px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: 13 },
  vacio: { padding: 14, color: '#94a3b8', fontSize: 13 },
  input: { padding: '9px 12px', borderRadius: 7, border: '1px solid #ddd', fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box' },
  btn: { padding: '8px 16px', background: '#059669', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, cursor: 'pointer' },
  btnRed: { padding: '8px 16px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, cursor: 'pointer' },
  btnSec: { padding: '8px 14px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: 7, fontSize: 13, cursor: 'pointer' },
  pill: { padding: '2px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 700 },
  ov: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 },
  modal: { background: '#fff', borderRadius: 12, padding: 22, width: 500, maxWidth: '94vw' },
  err: { color: '#dc2626', fontSize: 13, marginBottom: 12 },
  ok: { color: '#16a34a', fontSize: 13, marginBottom: 12 },
}
