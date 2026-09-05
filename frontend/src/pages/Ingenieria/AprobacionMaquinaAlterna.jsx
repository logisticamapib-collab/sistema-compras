import { useState, useEffect } from 'react'
import { subirArchivo as subirAStorage } from '../../lib/archivos'

import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Ingenieria autoriza (o rechaza) mover una OT a una maquina que no esta dada de alta
// como alterna aprobada en la ruta del articulo. Al aprobar puede dejarla registrada
// como maquina alterna permanente de esa ruta (y marcar si el cliente la aprobo).

const fFecha = (t) => t ? new Date(t).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '-'
const EST = { pendiente: { l: 'Pendiente Ingenieria', c: '#b45309' }, pendiente_calidad: { l: 'Pendiente Calidad', c: '#7c3aed' }, aprobada: { l: 'Aprobada', c: '#16a34a' }, rechazada: { l: 'Rechazada', c: '#dc2626' } }

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

  const subirDoc = async (file) => {
    const ruta = `maq-alterna/${Date.now()}-${file.name.replace(/\s+/g, '_')}`
    const { valor, error: e } = await subirAStorage('calidad', ruta, file)
    if (e) throw new Error('No se pudo subir el archivo: ' + e)
    return { url: valor, nombre: file.name }
  }

  const otDe = (id) => ots.find(x => x.id === id)
  const artDe = (id) => arts.find(x => x.id === id)
  const maqDe = (id) => maqs.find(x => x.id === id)
  const usrDe = (id) => usuarios.find(x => x.id === id)?.nombre || '-'

  // Ingenieria valida y ADJUNTA el PPAP o la Desviacion. La OT no se mueve aqui:
  // la solicitud pasa a autorizacion de Calidad, que es quien la libera.
  const resolver = async (s, aprobar) => {
    setError('')
    if (aprobar) {
      if (!form?.doc_tipo) { setError('Indica si adjuntas PPAP o Desviacion.'); return }
      if (!form?.archivo && !s.doc_url) { setError('Adjunta el documento (PPAP o Desviacion) antes de autorizar.'); return }
    }
    setProc(true)
    try {
      let doc = { url: s.doc_url, nombre: s.doc_nombre }
      if (aprobar && form?.archivo) doc = await subirDoc(form.archivo)
      await supabase.from('solicitudes_maquina_alterna').update({
        estatus: aprobar ? 'pendiente_calidad' : 'rechazada',
        aprobada_por_cliente: aprobar ? !!form?.cliente : false,
        registrar_como_alterna: aprobar ? !!form?.registrar : false,
        comentario_ingenieria: form?.comentario || null,
        doc_tipo: aprobar ? form.doc_tipo : null,
        doc_url: aprobar ? doc.url : null, doc_nombre: aprobar ? doc.nombre : null,
        doc_vigencia: aprobar && form?.vigencia ? form.vigencia : null,
        aut_ing_por: perfil.id, aut_ing_at: new Date().toISOString(),
        resuelto_por: aprobar ? null : perfil.id, resuelto_at: aprobar ? null : new Date().toISOString(),
      }).eq('id', s.id)
      setExito(aprobar
        ? `Ingenieria autorizo y adjunto el ${form.doc_tipo === 'ppap' ? 'PPAP' : 'documento de desviacion'}. Pasa a autorizacion de Calidad; la OT se movera cuando Calidad libere.`
        : 'Solicitud rechazada.')
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
                ? <button style={S.btn} onClick={() => setForm({ sol: s, registrar: true, cliente: false, comentario: '', doc_tipo: '', archivo: null, vigencia: '' })}>Revisar</button>
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
            <label style={S.lbl}>Documento de respaldo *</label>
            <div style={{ display: 'flex', gap: 8, margin: '4px 0 8px' }}>
              <button style={form.doc_tipo === 'ppap' ? S.optOn : S.opt} onClick={() => setForm({ ...form, doc_tipo: 'ppap' })}>PPAP</button>
              <button style={form.doc_tipo === 'desviacion' ? S.optOn : S.opt} onClick={() => setForm({ ...form, doc_tipo: 'desviacion' })}>Desviacion</button>
            </div>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" style={{ fontSize: 13 }} onChange={e => setForm({ ...form, archivo: e.target.files?.[0] || null })} />
            {form.archivo && <div style={{ fontSize: 12, color: '#16a34a', marginTop: 4 }}>Listo: {form.archivo.name}</div>}
            <label style={{ ...S.lbl, marginTop: 8 }}>Vigencia del documento (opcional)</label>
            <input style={S.input} type="date" value={form.vigencia || ''} onChange={e => setForm({ ...form, vigencia: e.target.value })} />
            <label style={{ ...S.chk, marginTop: 8 }}><input type="checkbox" checked={form.registrar} onChange={e => setForm({ ...form, registrar: e.target.checked })} /> Registrar esta maquina como <b>alterna permanente</b> en la ruta del articulo</label>
            <label style={S.chk}><input type="checkbox" checked={form.cliente} onChange={e => setForm({ ...form, cliente: e.target.checked })} /> La maquina esta <b>aprobada por el cliente</b> (PPAP)</label>
            <label style={{ ...S.lbl, marginTop: 8 }}>Comentario de Ingenieria</label>
            <input style={S.input} value={form.comentario} onChange={e => setForm({ ...form, comentario: e.target.value })} />
            {!form.cliente && form.registrar && <p style={{ fontSize: 12, color: '#b45309', marginTop: 8 }}>Sin aprobacion del cliente la maquina queda registrada pero <b>no</b> se ofrecera como autorizada en Planeacion.</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <button style={S.btnSec} onClick={() => setForm(null)} disabled={proc}>Cerrar</button>
              <button style={S.btnRed} onClick={() => resolver(form.sol, false)} disabled={proc}>Rechazar</button>
              <button style={S.btn} onClick={() => resolver(form.sol, true)} disabled={proc}>Autorizar y enviar a Calidad</button>
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
  opt: { flex: 1, padding: '8px', background: '#f1f5f9', color: '#334155', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, cursor: 'pointer' },
  optOn: { flex: 1, padding: '8px', background: '#dbeafe', color: '#1d4ed8', border: '1px solid #93c5fd', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  pill: { padding: '2px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 700 },
  ov: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 },
  modal: { background: '#fff', borderRadius: 12, padding: 22, width: 500, maxWidth: '94vw' },
  err: { color: '#dc2626', fontSize: 13, marginBottom: 12 },
  ok: { color: '#16a34a', fontSize: 13, marginBottom: 12 },
}
