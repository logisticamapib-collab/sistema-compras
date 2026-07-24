import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const DIAS_LBL = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab']
const fmt = (n) => Number(n ?? 0).toLocaleString('es-MX', { maximumFractionDigits: 0 })
const iso = (d) => d.toISOString().slice(0, 10)
const lunesDe = (d) => { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x }
const addDias = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const ddmm = (s) => { const p = String(s).split('-'); return `${p[2]}/${p[1]}` }

export default function ProgramacionProduccion() {
  const { perfil, tienePermiso } = useAuth()
  const puedeProgramar = tienePermiso('prod_programa', 'crear')
  const puedeCerrar = tienePermiso('prod_programa', 'aprobar')

  const [ref, setRef] = useState(lunesDe(new Date()))
  const [semana, setSemana] = useState(null)
  const [maquinas, setMaquinas] = useState([])
  const [turnos, setTurnos] = useState([])
  const [ots, setOts] = useState([])
  const [avance, setAvance] = useState({})
  const [personal, setPersonal] = useState({})
  const [edit, setEdit] = useState(null)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [cargando, setCargando] = useState(false)

  const lunes = ref
  const domingo = addDias(lunes, 6)
  const dias = Array.from({ length: 6 }, (_, i) => addDias(lunes, i))
  const turnoOrden = Object.fromEntries(turnos.map(t => [t.clave, t.orden]))

  useEffect(() => { cargar() }, [ref])

  const cargar = async () => {
    setCargando(true); setError(''); setExito('')
    const emp = perfil.empresa_id
    const [{ data: maq }, { data: tur }, { data: sem }, { data: rutas }] = await Promise.all([
      supabase.from('maquinas').select('id, clave, nombre').eq('empresa_id', emp).eq('activo', true).order('clave'),
      supabase.from('turnos').select('*').eq('empresa_id', emp).eq('activo', true).order('orden'),
      supabase.from('semanas_produccion').select('*').eq('empresa_id', emp).eq('semana_inicio', iso(lunes)).maybeSingle(),
      supabase.from('rutas_fabricacion').select('articulo_id, personal_requerido').eq('tipo_operacion', 'inyeccion'),
    ])
    setMaquinas(maq || []); setTurnos(tur || []); setSemana(sem || null)
    const perMap = {}
    ;(rutas || []).forEach(r => { if (!(r.articulo_id in perMap)) perMap[r.articulo_id] = r.personal_requerido || 0 })
    setPersonal(perMap)

    const { data: otData } = await supabase.from('ordenes_trabajo')
      .select('*, ot_articulos(articulo_id, cantidad_programada, principal, articulos(codigo_interno))')
      .eq('empresa_id', emp).gte('fecha_programada', iso(lunes)).lte('fecha_programada', iso(domingo))
      .order('secuencia')
    setOts(otData || [])

    // avance por OT
    const otIds = (otData || []).map(o => o.id)
    if (otIds.length) {
      const { data: rep } = await supabase.from('ot_reportes').select('ot_id, ot_reporte_articulos(cantidad_ok, cantidad_scrap)').in('ot_id', otIds)
      const av = {}
      ;(rep || []).forEach(r => {
        const a = av[r.ot_id] || { ok: 0, scrap: 0 }
        ;(r.ot_reporte_articulos || []).forEach(x => { a.ok += Number(x.cantidad_ok || 0); a.scrap += Number(x.cantidad_scrap || 0) })
        av[r.ot_id] = a
      })
      setAvance(av)
    } else setAvance({})
    setCargando(false)
  }

  const programar = async () => {
    setError(''); setExito('')
    // Candado: semana anterior abierta con OT sin cerrar
    const { data: prev } = await supabase.from('semanas_produccion').select('id, semana_inicio, estatus')
      .eq('empresa_id', perfil.empresa_id).lt('semana_inicio', iso(lunes)).eq('estatus', 'abierta')
      .order('semana_inicio', { ascending: false }).limit(1).maybeSingle()
    if (prev) {
      const { count } = await supabase.from('ordenes_trabajo').select('*', { count: 'exact', head: true })
        .eq('semana_id', prev.id).in('estatus', ['programada', 'en_proceso'])
      if (count > 0) { setError(`No puedes programar: la semana del ${ddmm(prev.semana_inicio)} sigue abierta con OT sin cerrar.`); return }
    }
    setCargando(true)
    const { error } = await supabase.rpc('programar_semana', {
      p_empresa_id: perfil.empresa_id, p_site_id: perfil.site_id || null,
      p_semana_inicio: iso(lunes), p_usuario_id: perfil.id, p_cambio_molde_min: 60,
    })
    setCargando(false)
    if (error) { setError(error.message); return }
    setExito('Semana programada'); await cargar(); setTimeout(() => setExito(''), 3000)
  }

  const cerrarSemana = async () => {
    setError(''); setExito('')
    const abiertas = ots.filter(o => ['programada', 'en_proceso'].includes(o.estatus))
    if (abiertas.length > 0) { setError(`Faltan ${abiertas.length} OT por cerrar antes de cerrar la semana.`); return }
    if (!semana) { setError('Programa la semana primero.'); return }
    const { error } = await supabase.from('semanas_produccion').update({
      estatus: 'cerrada', cerrada_por: perfil.id, cerrada_at: new Date().toISOString(),
    }).eq('id', semana.id)
    if (error) { setError(error.message); return }
    setExito('Semana cerrada'); await cargar()
  }

  const guardarEdit = async () => {
    const o = edit
    const { error } = await supabase.from('ordenes_trabajo').update({
      maquina_id: o.maquina_id ? parseInt(o.maquina_id) : null, fecha_programada: o.fecha_programada, turno: o.turno,
    }).eq('id', o.id)
    if (error) { setError(error.message); return }
    await supabase.from('programa_cambios').insert({
      empresa_id: perfil.empresa_id, semana_id: semana?.id || null, ot_id: o.id, campo: 'reprogramacion manual',
      despues: `maq ${o.maquina_id} / ${o.fecha_programada} / ${o.turno}`, usuario_id: perfil.id, usuario_nombre: perfil.nombre,
    })
    setEdit(null); await cargar()
  }

  const otsDe = (maqId, dia) => ots
    .filter(o => o.maquina_id === maqId && o.fecha_programada === iso(dia))
    .sort((a, b) => (turnoOrden[a.turno] || 0) - (turnoOrden[b.turno] || 0) || (a.secuencia || 0) - (b.secuencia || 0))

  const familia = (o) => (o.ot_articulos || []).map(a => a.articulos?.codigo_interno).filter(Boolean).join(' / ') || o.articulo_id
  const hoy = iso(new Date())
  const cambios = ots.filter(o => Number(o.cambio_molde_min) > 0).length
  const atrasos = ots.filter(o => o.fecha_programada < hoy && o.estatus === 'programada').length
  const maquinasSinPrograma = maquinas.filter(m => !ots.some(o => o.maquina_id === m.id))
  const personalDia = (dia) => otsDe0(dia).reduce((s, o) => s + (personal[o.articulo_id] || 0), 0)
  function otsDe0(dia) { return ots.filter(o => o.fecha_programada === iso(dia)) }

  return (
    <div>
      <div style={styles.barra}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button style={styles.navBtn} onClick={() => setRef(addDias(lunes, -7))}>&larr;</button>
          <div>
            <div style={{ fontSize: '15px', fontWeight: '600', color: '#1a1a2e' }}>Semana {ddmm(iso(lunes))} - {ddmm(iso(domingo))}</div>
            <div style={{ fontSize: '12px', color: semana?.estatus === 'cerrada' ? '#dc2626' : '#16a34a' }}>
              {semana ? (semana.estatus === 'cerrada' ? 'Cerrada' : 'Abierta') : 'Sin programar'}
            </div>
          </div>
          <button style={styles.navBtn} onClick={() => setRef(addDias(lunes, 7))}>&rarr;</button>
          <button style={styles.navBtn} onClick={() => setRef(lunesDe(new Date()))}>Hoy</button>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          {puedeProgramar && semana?.estatus !== 'cerrada' && <button style={styles.boton} disabled={cargando} onClick={programar}>{cargando ? '...' : 'Programar semana'}</button>}
          {puedeCerrar && semana && semana.estatus !== 'cerrada' && <button style={styles.botonCerrar} onClick={cerrarSemana}>Cerrar semana</button>}
        </div>
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      <div style={styles.avisos}>
        <span style={styles.aviso}>OT: <strong>{ots.length}</strong></span>
        <span style={{ ...styles.aviso, color: atrasos ? '#dc2626' : '#64748b' }}>Atrasos: <strong>{atrasos}</strong></span>
        <span style={{ ...styles.aviso, color: cambios ? '#c2410c' : '#64748b' }}>Cambios de molde: <strong>{cambios}</strong></span>
        <span style={{ ...styles.aviso, color: maquinasSinPrograma.length ? '#2563eb' : '#64748b' }}>Maquinas sin programa: <strong>{maquinasSinPrograma.length}</strong></span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={styles.grid}>
          <thead>
            <tr>
              <th style={styles.thMaq}>Maquina</th>
              {dias.map((d, i) => (
                <th key={i} style={styles.thDia}>
                  {DIAS_LBL[i]} {ddmm(iso(d))}<br />
                  <span style={{ fontSize: '10px', fontWeight: '400', color: '#94a3b8' }}>{personalDia(d)} pers.</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {maquinas.map(m => (
              <tr key={m.id}>
                <td style={styles.tdMaq}>{m.clave}<br /><span style={{ fontSize: '10px', color: '#94a3b8' }}>{m.nombre}</span></td>
                {dias.map((d, i) => (
                  <td key={i} style={styles.tdDia}>
                    {otsDe(m.id, d).map(o => {
                      const av = avance[o.id] || { ok: 0, scrap: 0 }
                      const falt = Math.max(Number(o.cantidad_programada) - av.ok, 0)
                      const atras = o.fecha_programada < hoy && o.estatus === 'programada'
                      return (
                        <button key={o.id} onClick={() => setEdit({ ...o })} style={{ ...styles.card, borderLeftColor: atras ? '#dc2626' : Number(o.cambio_molde_min) > 0 ? '#c2410c' : '#7c3aed' }}>
                          <div style={styles.cardTop}><span style={styles.turnoBadge}>{o.turno}</span> <strong>#{o.secuencia}</strong> {o.folio}</div>
                          <div style={{ fontWeight: '600', fontSize: '12px' }}>{familia(o)}</div>
                          <div style={{ fontSize: '11px', color: '#64748b' }}>Molde {o.molde_id || '-'} · {fmt(o.cantidad_programada)} pz</div>
                          <div style={{ fontSize: '10px', color: '#94a3b8' }}>OK {fmt(av.ok)} · Falta {fmt(falt)} · Scrap {fmt(av.scrap)}</div>
                          {Number(o.cambio_molde_min) > 0 && <span style={styles.cambioBadge}>cambio molde {o.cambio_molde_min}m</span>}
                          {atras && <span style={styles.atrasoBadge}>ATRASO</span>}
                        </button>
                      )
                    })}
                  </td>
                ))}
              </tr>
            ))}
            {maquinas.length === 0 && <tr><td colSpan={7} style={{ padding: '20px', color: '#666' }}>No hay maquinas activas.</td></tr>}
          </tbody>
        </table>
      </div>

      {edit && (
        <div style={styles.modalBg} onClick={() => setEdit(null)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 14px', fontSize: '15px' }}>Reprogramar {edit.folio}</h3>
            <div style={styles.campo}><label style={styles.label}>Maquina</label>
              <select style={styles.input} value={edit.maquina_id || ''} onChange={e => setEdit({ ...edit, maquina_id: e.target.value })}>
                {maquinas.map(m => <option key={m.id} value={m.id}>{m.clave} - {m.nombre}</option>)}
              </select></div>
            <div style={styles.campo}><label style={styles.label}>Fecha</label>
              <input style={styles.input} type="date" value={edit.fecha_programada || ''} onChange={e => setEdit({ ...edit, fecha_programada: e.target.value })} /></div>
            <div style={styles.campo}><label style={styles.label}>Turno</label>
              <select style={styles.input} value={edit.turno || ''} onChange={e => setEdit({ ...edit, turno: e.target.value })}>
                {turnos.map(t => <option key={t.id} value={t.clave}>{t.clave} - {t.nombre}</option>)}
              </select></div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button style={styles.botonSec} onClick={() => setEdit(null)}>Cancelar</button>
              <button style={styles.boton} onClick={guardarEdit}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const styles = {
  barra: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' },
  navBtn: { padding: '7px 12px', backgroundColor: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  boton: { padding: '9px 18px', backgroundColor: '#c2410c', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' },
  botonCerrar: { padding: '9px 18px', backgroundColor: '#fff', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  botonSec: { padding: '9px 18px', backgroundColor: '#e2e8f0', color: '#444', border: 'none', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  avisos: { display: 'flex', gap: '18px', flexWrap: 'wrap', padding: '10px 16px', backgroundColor: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', marginBottom: '16px', fontSize: '13px' },
  aviso: { color: '#64748b' },
  grid: { borderCollapse: 'collapse', width: '100%', minWidth: '820px', backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  thMaq: { padding: '10px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', color: '#64748b', textAlign: 'left', minWidth: '110px' },
  thDia: { padding: '8px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', borderLeft: '1px solid #f1f5f9', fontSize: '11px', color: '#334155', minWidth: '150px' },
  tdMaq: { padding: '10px', borderBottom: '1px solid #f1f5f9', fontSize: '12px', fontWeight: '600', color: '#1a1a2e', verticalAlign: 'top' },
  tdDia: { padding: '6px', borderBottom: '1px solid #f1f5f9', borderLeft: '1px solid #f1f5f9', verticalAlign: 'top' },
  card: { display: 'block', width: '100%', textAlign: 'left', border: '1px solid #eee', borderLeft: '3px solid #7c3aed', borderRadius: '6px', padding: '6px 8px', marginBottom: '6px', background: '#fff', cursor: 'pointer' },
  cardTop: { fontSize: '10px', color: '#94a3b8', marginBottom: '2px' },
  turnoBadge: { backgroundColor: '#eef2ff', color: '#4338ca', borderRadius: '4px', padding: '1px 5px', fontSize: '10px', fontWeight: '600' },
  cambioBadge: { display: 'inline-block', marginTop: '4px', backgroundColor: '#fff7ed', color: '#c2410c', borderRadius: '4px', padding: '1px 6px', fontSize: '10px' },
  atrasoBadge: { display: 'inline-block', marginTop: '4px', marginLeft: '4px', backgroundColor: '#fef2f2', color: '#dc2626', borderRadius: '4px', padding: '1px 6px', fontSize: '10px', fontWeight: '700' },
  modalBg: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  modal: { backgroundColor: '#fff', borderRadius: '10px', padding: '24px', width: '360px', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
