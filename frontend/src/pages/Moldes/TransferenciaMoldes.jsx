import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import FiltroSite from '../../components/FiltroSite'
import { siteEfectivo } from '../../lib/sites'

// Transferencia de moldes entre sites.
// Por PPAP el molde corre en una maquina y ubicacion definidas: moverlo exige
// notificar al cliente y una nueva validacion (try-out) antes de volver a producir.
// Mientras la transferencia no se cierre con su try-out, el molde queda marcado
// como "pendiente de try-out" y no debe programarse.

const fFecha = (f) => f ? new Date(f).toLocaleDateString('es-MX') : '-'
const EST = { pendiente_tryout: { l: 'Pendiente try-out', c: '#b45309' }, completada: { l: 'Completada', c: '#16a34a' }, cancelada: { l: 'Cancelada', c: '#dc2626' } }

export default function TransferenciaMoldes() {
  const { perfil, tienePermiso } = useAuth()
  const emp = perfil.empresa_id
  const puedeTransferir = tienePermiso('mol_estado', 'editar') || tienePermiso('ing_moldes', 'editar')

  const [moldes, setMoldes] = useState([])
  const [sites, setSites] = useState([])
  const [maquinas, setMaquinas] = useState([])
  const [transfs, setTransfs] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [site, setSite] = useState('')
  const [loading, setLoading] = useState(true)
  const [proc, setProc] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [form, setForm] = useState(null)

  useEffect(() => { cargar() }, [site])
  const cargar = async () => {
    setLoading(true)
    const sid = siteEfectivo(perfil, site)
    const [mo, st, mq, tr, us] = await Promise.all([
      supabase.from('moldes').select('*, site:sites(nombre), maq:maquinas(clave)').eq('empresa_id', emp).eq('activo', true).order('clave'),
      supabase.from('sites').select('id, nombre, codigo').eq('empresa_id', emp).order('nombre'),
      supabase.from('maquinas').select('id, clave, nombre, site_id').eq('empresa_id', emp).eq('activo', true).order('clave'),
      supabase.from('molde_transferencias').select('*, molde:moldes(clave)').eq('empresa_id', emp).order('id', { ascending: false }).limit(200),
      supabase.from('usuarios').select('id, nombre'),
    ])
    setMoldes((mo.data || []).filter(m => !sid || m.site_id === sid || m.site_id == null))
    setSites(st.data || []); setMaquinas(mq.data || []); setTransfs(tr.data || []); setUsuarios(us.data || [])
    setLoading(false)
  }

  const siteNom = (id) => sites.find(s => s.id === id)?.nombre || '-'
  const maqNom = (id) => maquinas.find(m => m.id === id)?.clave || '-'
  const usrNom = (id) => usuarios.find(u => u.id === id)?.nombre || '-'

  const abrir = (m) => {
    setError('')
    setForm({
      molde: m, site_destino_id: '', maquina_destino_id: '', ubicacion_destino: '',
      motivo: '', cliente_notificado: false, fecha_notificacion: '', referencia_notificacion: '',
    })
  }

  const guardar = async () => {
    setError('')
    const f = form
    if (!f.site_destino_id) { setError('Selecciona el site destino.'); return }
    if (Number(f.site_destino_id) === f.molde.site_id) { setError('El site destino es el mismo que el actual.'); return }
    if (!f.motivo.trim()) { setError('Captura el motivo de la transferencia.'); return }
    if (!f.cliente_notificado) { setError('Debes confirmar la notificacion al cliente: el molde tiene PPAP y no puede moverse sin avisarle.'); return }
    if (!f.fecha_notificacion) { setError('Indica la fecha en que se notifico al cliente.'); return }
    setProc(true)
    try {
      await supabase.from('molde_transferencias').insert({
        empresa_id: emp, molde_id: f.molde.id,
        site_origen_id: f.molde.site_id, site_destino_id: Number(f.site_destino_id),
        maquina_origen_id: f.molde.maquina_asignada_id || null,
        maquina_destino_id: f.maquina_destino_id ? Number(f.maquina_destino_id) : null,
        ubicacion_origen: f.molde.ubicacion_fisica || null, ubicacion_destino: f.ubicacion_destino || null,
        motivo: f.motivo.trim(), cliente_notificado: true,
        fecha_notificacion: f.fecha_notificacion, referencia_notificacion: f.referencia_notificacion || null,
        requiere_tryout: true, estatus: 'pendiente_tryout',
        autorizado_por: perfil.id, autorizado_at: new Date().toISOString(), creado_por: perfil.id,
      })
      // El molde cambia de site y queda bloqueado hasta el try-out de liberacion
      await supabase.from('moldes').update({
        site_id: Number(f.site_destino_id),
        maquina_asignada_id: f.maquina_destino_id ? Number(f.maquina_destino_id) : null,
        ubicacion_fisica: f.ubicacion_destino || null,
        pendiente_tryout: true, estado: 'en_mantenimiento',
      }).eq('id', f.molde.id)
      setExito(`Molde ${f.molde.clave} transferido a ${siteNom(Number(f.site_destino_id))}. Queda PENDIENTE DE TRY-OUT: no debe programarse hasta liberarlo.`)
      setForm(null); await cargar()
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  const cerrarTransferencia = async (t) => {
    setError(''); setProc(true)
    try {
      await supabase.from('molde_transferencias').update({ estatus: 'completada' }).eq('id', t.id)
      await supabase.from('moldes').update({ pendiente_tryout: false, estado: 'disponible' }).eq('id', t.molde_id)
      setExito(`Transferencia cerrada: el molde ${t.molde?.clave || ''} queda liberado para producir en su nuevo site.`)
      await cargar()
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  if (loading) return <p style={{ padding: 28, color: '#666' }}>Cargando...</p>
  const pendientes = transfs.filter(t => t.estatus === 'pendiente_tryout')

  return (
    <div style={S.c} className="aparecer">
      <h2 style={S.t}>Transferencia de Moldes entre Sites</h2>
      <p style={S.sub}>Por PPAP el molde corre en una maquina y ubicacion definidas. Transferirlo exige <b>notificar al cliente</b> y una <b>nueva validacion / try-out</b> antes de volver a producir.</p>
      <div style={{ marginBottom: 12 }}><FiltroSite value={site} onChange={setSite} /></div>
      {error && <p style={S.err}>{error}</p>}
      {exito && <p style={S.ok}>{exito}</p>}

      {pendientes.length > 0 && (
        <div style={S.alerta}>
          <b>{pendientes.length} molde(s) pendientes de try-out</b> tras una transferencia. No deben programarse hasta liberarse.
        </div>
      )}

      <h3 style={S.h3}>Moldes</h3>
      <div style={S.tabla}>
        <div style={S.th}><span style={{ flex: 1 }}>Clave</span><span style={{ flex: 1.4 }}>Nombre</span><span style={{ flex: 1 }}>Site</span><span style={{ flex: 1 }}>Maquina PPAP</span><span style={{ flex: 1 }}>Ubicacion</span><span style={{ width: 130 }}></span></div>
        {moldes.map(m => (
          <div key={m.id} style={S.tr}>
            <span style={{ flex: 1, fontWeight: 600 }}>{m.clave}{m.pendiente_tryout && <span style={{ ...S.pill, backgroundColor: '#fef3c7', color: '#b45309', marginLeft: 4 }}>try-out</span>}</span>
            <span style={{ flex: 1.4, color: '#64748b' }}>{m.nombre}</span>
            <span style={{ flex: 1 }}>{m.site?.nombre || <span style={{ color: '#dc2626' }}>sin site</span>}</span>
            <span style={{ flex: 1, color: '#64748b' }}>{m.maq?.clave || '-'}</span>
            <span style={{ flex: 1, color: '#64748b', fontSize: 12 }}>{m.ubicacion_fisica || '-'}</span>
            <span style={{ width: 130, textAlign: 'right' }}>{puedeTransferir && <button style={S.btn} onClick={() => abrir(m)}>Transferir</button>}</span>
          </div>
        ))}
        {moldes.length === 0 && <div style={S.vacio}>Sin moldes en este site.</div>}
      </div>

      <h3 style={S.h3}>Historial de transferencias</h3>
      <div style={S.tabla}>
        <div style={S.th}><span style={{ flex: 1 }}>Molde</span><span style={{ flex: 1.6 }}>Movimiento</span><span style={{ flex: 1.4 }}>Motivo</span><span style={{ flex: 1.2 }}>Cliente notificado</span><span style={{ flex: 1 }}>Estatus</span><span style={{ width: 120 }}></span></div>
        {transfs.map(t => (
          <div key={t.id} style={S.tr}>
            <span style={{ flex: 1, fontWeight: 600 }}>{t.molde?.clave || t.molde_id}</span>
            <span style={{ flex: 1.6, fontSize: 12.5 }}>{siteNom(t.site_origen_id)} → <b>{siteNom(t.site_destino_id)}</b><div style={{ color: '#94a3b8', fontSize: 11 }}>{maqNom(t.maquina_origen_id)} → {maqNom(t.maquina_destino_id)}</div></span>
            <span style={{ flex: 1.4, fontSize: 12, color: '#64748b' }}>{t.motivo}</span>
            <span style={{ flex: 1.2, fontSize: 12 }}>{t.cliente_notificado ? <>Si · {fFecha(t.fecha_notificacion)}<div style={{ color: '#94a3b8', fontSize: 11 }}>{t.referencia_notificacion || ''}</div></> : <span style={{ color: '#dc2626' }}>No</span>}</span>
            <span style={{ flex: 1 }}><span style={{ ...S.pill, backgroundColor: (EST[t.estatus]?.c || '#64748b') + '22', color: EST[t.estatus]?.c }}>{EST[t.estatus]?.l || t.estatus}</span></span>
            <span style={{ width: 120, textAlign: 'right' }}>{t.estatus === 'pendiente_tryout' && puedeTransferir && <button style={S.btnMini} disabled={proc} onClick={() => cerrarTransferencia(t)}>Try-out OK</button>}</span>
          </div>
        ))}
        {transfs.length === 0 && <div style={S.vacio}>Sin transferencias registradas.</div>}
      </div>

      {form && (
        <div style={S.ov} onClick={() => setForm(null)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>Transferir molde {form.molde.clave}</h3>
            <p style={S.sub}>Actual: {form.molde.site?.nombre || 'sin site'} · maquina {form.molde.maq?.clave || '-'} · {form.molde.ubicacion_fisica || 'sin ubicacion'}</p>
            <label style={S.lbl}>Site destino *</label>
            <select style={S.input} value={form.site_destino_id} onChange={e => setForm({ ...form, site_destino_id: e.target.value, maquina_destino_id: '' })}>
              <option value="">Selecciona...</option>
              {sites.filter(x => x.id !== form.molde.site_id).map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </select>
            <label style={{ ...S.lbl, marginTop: 8 }}>Maquina destino (PPAP)</label>
            <select style={S.input} value={form.maquina_destino_id} onChange={e => setForm({ ...form, maquina_destino_id: e.target.value })} disabled={!form.site_destino_id}>
              <option value="">Por definir</option>
              {maquinas.filter(x => x.site_id === Number(form.site_destino_id)).map(x => <option key={x.id} value={x.id}>{x.clave} - {x.nombre}</option>)}
            </select>
            <label style={{ ...S.lbl, marginTop: 8 }}>Ubicacion fisica destino</label>
            <input style={S.input} value={form.ubicacion_destino} onChange={e => setForm({ ...form, ubicacion_destino: e.target.value })} />
            <label style={{ ...S.lbl, marginTop: 8 }}>Motivo de la transferencia *</label>
            <input style={S.input} value={form.motivo} onChange={e => setForm({ ...form, motivo: e.target.value })} placeholder="Ej. balanceo de capacidad / cierre de linea" />
            <div style={S.aviso}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.cliente_notificado} onChange={e => setForm({ ...form, cliente_notificado: e.target.checked })} />
                <span>Confirmo que se <b>notifico al cliente</b> del cambio de maquina/ubicacion (requisito PPAP).</span>
              </label>
              {form.cliente_notificado && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <input style={{ ...S.input, flex: 1 }} type="date" value={form.fecha_notificacion} onChange={e => setForm({ ...form, fecha_notificacion: e.target.value })} />
                  <input style={{ ...S.input, flex: 1.4 }} value={form.referencia_notificacion} onChange={e => setForm({ ...form, referencia_notificacion: e.target.value })} placeholder="Referencia (correo, folio)" />
                </div>
              )}
            </div>
            <p style={{ fontSize: 12, color: '#b45309', marginTop: 8 }}>Al confirmar, el molde queda <b>pendiente de try-out</b> y no debe programarse hasta ser liberado.</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <button style={S.btnSec} onClick={() => setForm(null)} disabled={proc}>Cancelar</button>
              <button style={S.btn} onClick={guardar} disabled={proc}>Confirmar transferencia</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const S = {
  c: { padding: 24, maxWidth: 1120 },
  t: { fontSize: 18, fontWeight: 600, color: '#1a1a2e', margin: '0 0 4px' },
  sub: { fontSize: 13, color: '#64748b', margin: '0 0 10px' },
  h3: { fontSize: 13, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.04em', margin: '20px 0 8px' },
  lbl: { fontSize: 12, fontWeight: 500, color: '#444', display: 'block' },
  tabla: { background: '#fff', border: '1px solid #eef2f7', borderRadius: 8, overflow: 'hidden' },
  th: { display: 'flex', padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' },
  tr: { display: 'flex', padding: '10px 14px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: 13 },
  vacio: { padding: '14px', color: '#94a3b8', fontSize: 13 },
  alerta: { background: '#fffbeb', border: '1px solid #fde68a', color: '#b45309', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 12 },
  aviso: { background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 12px', marginTop: 10, fontSize: 13 },
  input: { padding: '9px 12px', borderRadius: 7, border: '1px solid #ddd', fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box' },
  btn: { padding: '8px 16px', background: '#a16207', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, cursor: 'pointer' },
  btnSec: { padding: '8px 14px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: 7, fontSize: 13, cursor: 'pointer' },
  btnMini: { padding: '5px 10px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' },
  pill: { padding: '2px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 700 },
  ov: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 },
  modal: { background: '#fff', borderRadius: 12, padding: 22, width: 520, maxWidth: '94vw', maxHeight: '92vh', overflowY: 'auto' },
  err: { color: '#dc2626', fontSize: 13, marginBottom: 12 },
  ok: { color: '#16a34a', fontSize: 13, marginBottom: 12 },
}
