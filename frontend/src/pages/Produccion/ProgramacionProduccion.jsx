import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const DIAS_LBL = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab']
const COLOR_EST = {
  trabajando: { c: '#16a34a', l: 'Trabajando' },
  parada: { c: '#dc2626', l: 'Parada' },
  cambio_molde: { c: '#d97706', l: 'Cambio de molde' },
  sin_programa: { c: '#64748b', l: 'Sin programa' },
}
const fmt = (n) => Number(n ?? 0).toLocaleString('es-MX', { maximumFractionDigits: 0 })
const iso = (d) => d.toISOString().slice(0, 10)
const lunesDe = (d) => { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x }
const addDias = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const ddmm = (s) => { const p = String(s).split('-'); return `${p[2]}/${p[1]}` }
const fechaHora = (ts) => ts ? new Date(ts).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'

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
  const [estados, setEstados] = useState([])
  const [rutas, setRutas] = useState([])
  const [alternas, setAlternas] = useState([])
  const [solicitudes, setSolicitudes] = useState([])
  const [edit, setEdit] = useState(null)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [cargando, setCargando] = useState(false)
  const [arrastreForm, setArrastreForm] = useState(null)
  const [seqMaquina, setSeqMaquina] = useState('')
  const [seq, setSeq] = useState(null)
  const [seqCargando, setSeqCargando] = useState(false)
  const [plan, setPlan] = useState([])
  const [planCargando, setPlanCargando] = useState(false)
  const [verPlan, setVerPlan] = useState(false)
  const [chequeo, setChequeo] = useState(null)

  const lunes = ref
  const domingo = addDias(lunes, 6)
  const dias = Array.from({ length: 6 }, (_, i) => addDias(lunes, i))
  const turnoOrden = Object.fromEntries(turnos.map(t => [t.clave, t.orden]))

  useEffect(() => { cargar() }, [ref])

  const cargar = async () => {
    setCargando(true); setError(''); setExito('')
    const emp = perfil.empresa_id
    const [{ data: maq }, { data: tur }, { data: sem }, { data: rutas }, { data: est }, { data: alt }, { data: sol }] = await Promise.all([
      supabase.from('maquinas').select('id, clave, nombre').eq('empresa_id', emp).eq('activo', true).order('clave'),
      supabase.from('turnos').select('*').eq('empresa_id', emp).eq('activo', true).order('orden'),
      supabase.from('semanas_produccion').select('*').eq('empresa_id', emp).eq('semana_inicio', iso(lunes)).maybeSingle(),
      supabase.from('rutas_fabricacion').select('id, articulo_id, personal_requerido, maquina_principal_id, molde_id').eq('tipo_operacion', 'inyeccion'),
      supabase.from('maquina_estado').select('*').eq('empresa_id', emp),
      supabase.from('ruta_maquinas_alternas').select('*'),
      supabase.from('solicitudes_maquina_alterna').select('*').eq('empresa_id', emp).eq('estatus', 'pendiente'),
    ])
    setMaquinas(maq || []); setTurnos(tur || []); setSemana(sem || null)
    setEstados(est || []); setRutas(rutas || []); setAlternas(alt || []); setSolicitudes(sol || [])
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

  // Programar la semana. Ya no bloquea si hay OT pendientes de semanas previas:
  // ofrece arrastrarlas a esta semana (reprogramarlas) o programar sin arrastrar.
  const iniciarProgramar = async () => {
    setError(''); setExito('')
    const { data: prev } = await supabase.from('semanas_produccion').select('id, semana_inicio, estatus')
      .eq('empresa_id', perfil.empresa_id).lt('semana_inicio', iso(lunes)).eq('estatus', 'abierta')
      .order('semana_inicio', { ascending: false }).limit(1).maybeSingle()
    if (prev) {
      const { data: pend } = await supabase.from('ordenes_trabajo')
        .select('id, folio, fecha_programada, turno, maquina_id')
        .eq('semana_id', prev.id).in('estatus', ['programada', 'en_proceso'])
      if (pend && pend.length > 0) { setArrastreForm({ prev, ots: pend }); return }
    }
    runPrograma(false)
  }
  const runPrograma = async (arrastrar) => {
    setArrastreForm(null); setCargando(true); setError('')
    try {
      // Se mueve la fecha ANTES de programar para que la capacidad la tome
      // en cuenta. La semana se reasigna despues, cuando ya existe su id.
      if (arrastrar && arrastreForm) {
        for (const o of arrastreForm.ots) {
          await supabase.from('ordenes_trabajo').update({ fecha_programada: iso(lunes) }).eq('id', o.id)
        }
      }
      const { data: semanaId, error } = await supabase.rpc('programar_semana', {
        p_empresa_id: perfil.empresa_id, p_site_id: perfil.site_id || null,
        p_semana_inicio: iso(lunes), p_usuario_id: perfil.id, p_cambio_molde_min: 60,
      })
      if (error) { setError(error.message); setCargando(false); return }
      // Una OT arrastrada debe quedar ligada a la semana destino. Las que
      // estan 'en_proceso' no las re-secuencia programar_semana, asi que sin
      // esto seguirian colgadas de la semana anterior y el aviso de
      // pendientes se repetiria cada vez.
      if (arrastrar && arrastreForm && semanaId) {
        for (const o of arrastreForm.ots) {
          await supabase.from('ordenes_trabajo').update({ semana_id: semanaId }).eq('id', o.id)
          await supabase.from('programa_cambios').insert({
            empresa_id: perfil.empresa_id, semana_id: semanaId, ot_id: o.id,
            tipo: 'arrastre', campo: 'fecha', antes: o.fecha_programada, despues: iso(lunes),
            usuario_id: perfil.id, usuario_nombre: perfil.nombre,
          })
        }
      }
      setExito(arrastrar ? 'Semana programada (OT pendientes arrastradas)' : 'Semana programada')
      await cargar(); setTimeout(() => setExito(''), 3000)
    } catch (err) { setError('Error: ' + err.message) }
    setCargando(false)
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
    const o = edit; const orig = o._orig || {}
    const nuevaMaq = o.maquina_id ? parseInt(o.maquina_id) : null
    // Cambio de maquina: solo directo si la maquina esta autorizada en la ruta
    if (nuevaMaq && nuevaMaq !== orig.maquina_id) {
      const permitidas = maquinasAutorizadas(o)
      if (!permitidas.has(nuevaMaq)) {
        if (!o._motivo || !o._motivo.trim()) { setError('Esa maquina no esta dada de alta como alterna aprobada. Escribe el motivo para solicitar la autorizacion a Ingenieria.'); return }
        const { error: eS } = await supabase.from('solicitudes_maquina_alterna').insert({
          empresa_id: perfil.empresa_id, ot_id: o.id, articulo_id: o.articulo_id, molde_id: o.molde_id || null,
          maquina_actual_id: orig.maquina_id || null, maquina_solicitada_id: nuevaMaq,
          motivo: o._motivo.trim(), solicitado_por: perfil.id,
        })
        if (eS) { setError(eS.message); return }
        await supabase.from('programa_cambios').insert({
          empresa_id: perfil.empresa_id, semana_id: semana?.id || null, ot_id: o.id, tipo: 'solicitud_maquina_alterna',
          campo: 'maquina', antes: String(orig.maquina_id ?? '-'), despues: String(nuevaMaq),
          usuario_id: perfil.id, usuario_nombre: perfil.nombre,
        })
        setEdit(null); setExito('Solicitud de maquina alterna enviada a Ingenieria. La OT no se movio hasta que se autorice.')
        await cargar(); return
      }
    }
    const { error } = await supabase.from('ordenes_trabajo').update({
      maquina_id: nuevaMaq, fecha_programada: o.fecha_programada, turno: o.turno,
    }).eq('id', o.id)
    if (error) { setError(error.message); return }
    await supabase.from('programa_cambios').insert({
      empresa_id: perfil.empresa_id, semana_id: semana?.id || null, ot_id: o.id, tipo: 'reprogramacion', campo: 'maquina/fecha/turno',
      antes: `maq ${orig.maquina_id ?? '-'} / ${orig.fecha_programada ?? '-'} / ${orig.turno ?? '-'}`,
      despues: `maq ${o.maquina_id} / ${o.fecha_programada} / ${o.turno}`, usuario_id: perfil.id, usuario_nombre: perfil.nombre,
    })
    setEdit(null); await cargar()
  }

  // Estado real de la maquina (mismo criterio que Andon/Terminal)
  const estadoMaq = (maqId) => {
    const e = estados.find(x => x.maquina_id === maqId)
    if (e && (e.estado === 'parada' || e.estado === 'cambio_molde')) return e.estado
    if (ots.some(o => o.maquina_id === maqId && o.estatus === 'en_proceso')) return 'trabajando'
    return e?.estado || 'sin_programa'
  }
  // Una OT implica CAMBIO DE MOLDE si el molde difiere del de la OT anterior en esa maquina
  const otsMaqOrden = (maqId) => ots.filter(o => o.maquina_id === maqId)
    .sort((a, b) => String(a.fecha_programada).localeCompare(String(b.fecha_programada))
      || (turnoOrden[a.turno] || 0) - (turnoOrden[b.turno] || 0) || (a.secuencia || 0) - (b.secuencia || 0))
  const implicaCambio = (o) => {
    const lista = otsMaqOrden(o.maquina_id)
    const i = lista.findIndex(x => x.id === o.id)
    if (i <= 0) return Number(o.cambio_molde_min) > 0
    const prev = lista[i - 1]
    return (prev.molde_id || null) !== (o.molde_id || null)
  }
  // Maquinas autorizadas para el articulo de la OT: principal + alternas de su ruta
  const rutaDe = (artId) => rutas.find(r => r.articulo_id === artId)
  const maquinasAutorizadas = (o) => {
    const arts = (o.ot_articulos || []).map(a => a.articulo_id).filter(Boolean)
    const ids = new Set()
    const lista = arts.length ? arts : [o.articulo_id]
    lista.forEach(aid => {
      const r = rutaDe(aid); if (!r) return
      if (r.maquina_principal_id) ids.add(r.maquina_principal_id)
      alternas.filter(x => x.ruta_id === r.id && x.aprobada_por_cliente).forEach(x => ids.add(x.maquina_id))
    })
    return ids
  }
  const solicitudPendiente = (otId) => solicitudes.find(x => x.ot_id === otId)
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

  // ---------- Plan de capacidad ----------
  // Cada OT tiene duracion real: (cantidad / cavidades) x ciclo / eficiencia,
  // mas cambio de molde y purga de color. La maquina corre continuo entre
  // turnos, asi que una OT puede cruzar de turno y empujar a la siguiente.
  const cargarPlan = async () => {
    setPlanCargando(true)
    const res = await Promise.all(maquinas.map(m =>
      supabase.rpc('plan_maquina', {
        p_empresa_id: perfil.empresa_id, p_maquina_id: m.id,
        p_desde: iso(lunes), p_hasta: iso(domingo), p_excluir_ot: null,
      }).then(r => ({ maquina: m, filas: r.data || [], error: r.error }))
    ))
    setPlanCargando(false)
    const conError = res.find(r => r.error)
    if (conError) { setError('No se pudo calcular el plan: ' + conError.error.message); return }
    setPlan(res.filter(r => r.filas.length > 0))
  }

  useEffect(() => { if (verPlan && maquinas.length) cargarPlan() }, [verPlan, maquinas, ref])

  // Revisa si el destino elegido en el modal esta ocupado, y de ser asi
  // cuanto habria que recortar la OT que estorba.
  const revisarDestino = async (maquinaId, fecha, turno, otId) => {
    if (!maquinaId || !fecha || !turno) { setChequeo(null); return }
    const { data, error: e } = await supabase.rpc('validar_traslape', {
      p_empresa_id: perfil.empresa_id, p_maquina_id: Number(maquinaId),
      p_fecha: fecha, p_turno: turno, p_ot_id: otId || null,
    })
    if (e) { setChequeo(null); return }
    setChequeo(data && data[0] ? data[0] : null)
  }

  // ---------- Secuencia sugerida por color ----------
  // Agrupa por molde para no cambiar de molde de mas y dentro de cada campana
  // corre los colores de claro a oscuro, porque regresar a un claro exige
  // mucha mas purga. Muestra los dos escenarios para poder comparar.
  const calcularSecuencia = async (maquinaId) => {
    if (!maquinaId) { setSeq(null); return }
    setSeqCargando(true); setError('')
    const { data, error: e } = await supabase.rpc('secuencia_sugerida', {
      p_empresa_id: perfil.empresa_id, p_maquina_id: Number(maquinaId),
      p_desde: iso(lunes), p_hasta: iso(domingo),
    })
    setSeqCargando(false)
    if (e) { setError('No se pudo calcular la secuencia: ' + e.message); return }
    const filas = data || []
    const actual = filas.filter(r => r.escenario === 'actual')
    const sugerido = filas.filter(r => r.escenario === 'sugerido')
    const tot = (rs) => rs.reduce((a, r) => ({
      min: a.min + (Number(r.min_purga) || 0) + (Number(r.min_molde) || 0),
      kg: a.kg + (Number(r.kg_purga) || 0),
    }), { min: 0, kg: 0 })
    setSeq({ actual, sugerido, totActual: tot(actual), totSugerido: tot(sugerido) })
  }

  const aplicarSecuencia = async () => {
    if (!seq?.sugerido?.length) return
    if (!confirm(`Se va a renumerar la secuencia de ${seq.sugerido.length} OT en esta maquina. Confirma para aplicar.`)) return
    setSeqCargando(true); setError('')
    for (const r of seq.sugerido) {
      const { error: e } = await supabase.from('ordenes_trabajo')
        .update({ secuencia: Number(r.posicion) }).eq('id', r.ot_id)
      if (e) { setSeqCargando(false); setError('No se pudo aplicar: ' + e.message); return }
    }
    setSeqCargando(false)
    setExito('Secuencia aplicada')
    setSeq(null); setSeqMaquina('')
    cargar()
  }

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
          {puedeProgramar && semana?.estatus !== 'cerrada' && <button style={styles.boton} disabled={cargando} onClick={iniciarProgramar}>{cargando ? '...' : 'Programar semana'}</button>}
          <button style={styles.botonSec} onClick={() => setVerPlan(v => !v)}>{verPlan ? 'Cerrar carga' : 'Carga y capacidad'}</button>
          {puedeProgramar && <button style={styles.botonSec} onClick={() => { setSeq(null); setSeqMaquina(seqMaquina ? '' : 'abrir') }}>{seqMaquina ? 'Cerrar secuencia' : 'Secuencia por color'}</button>}
          {puedeCerrar && semana && semana.estatus !== 'cerrada' && <button style={styles.botonCerrar} onClick={cerrarSemana}>Cerrar semana</button>}
        </div>
      </div>

      {error && <p style={styles.error}>{error}</p>}

      {/* ---------- Carga y capacidad ---------- */}
      {verPlan && (
        <div style={styles.seqPanel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <span style={{ fontSize: '13.5px', fontWeight: 600, color: '#1a1a2e' }}>Carga y capacidad de la semana</span>
            {planCargando && <span style={{ fontSize: '12.5px', color: '#64748b' }}>Calculando...</span>}
          </div>
          <p style={styles.seqAyuda}>
            La duracion de cada OT sale de su cantidad, las cavidades del molde y el ciclo de la ruta, ajustada
            por la eficiencia real de esa maquina, mas el cambio de molde y la purga de color. La maquina corre
            continuo entre turnos, por eso una OT puede cruzar de turno y empujar a la que sigue.
          </p>

          {!planCargando && plan.length === 0 && (
            <p style={styles.seqVacio}>No hay OT programadas esta semana, o falta capturar el tiempo estandar en las rutas.</p>
          )}

          {plan.map(({ maquina, filas }) => {
            const totalMin = filas.reduce((a, r) => a + (Number(r.total_min) || 0), 0)
            const ef = filas[0]?.eficiencia
            return (
              <div key={maquina.id} style={styles.planMaq}>
                <div style={styles.planMaqTop}>
                  <span style={{ fontWeight: 600, fontSize: '13px' }}>{maquina.clave} &middot; {maquina.nombre}</span>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>
                    {filas.length} OT &middot; {Math.round(totalMin / 60)} h de carga
                    {ef ? ` · eficiencia ${(Number(ef) * 100).toFixed(0)}%` : ''}
                  </span>
                </div>
                {filas.map(r => {
                  const col = !r.cabe ? '#b91c1c' : r.atrasada ? '#dc2626' : r.empujada ? '#d97706' : '#16a34a'
                  const bg = !r.cabe ? '#fef2f2' : r.atrasada ? '#fef2f2' : r.empujada ? '#fffbeb' : '#f0fdf4'
                  return (
                    <div key={r.ot_id} style={{ ...styles.planFila, borderLeftColor: col, background: bg }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#1a1a2e' }}>
                          #{r.posicion} {r.folio} &middot; {r.articulo_codigo}
                          {r.color_clave && <span style={styles.planTag}>{r.color_clave}</span>}
                        </span>
                        <span style={{ fontSize: '12px', color: '#475569' }}>
                          {Number(r.cantidad).toLocaleString('es-MX')} pz &middot; {Math.round(Number(r.total_min) / 60)} h
                        </span>
                      </div>
                      <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '3px' }}>
                        {r.inicio ? fechaHora(r.inicio) : '-'} &rarr; {r.fin ? fechaHora(r.fin) : '-'}
                        {r.turnos_ocupados ? ` · ocupa ${r.turnos_ocupados}` : ''}
                      </div>
                      <div style={{ fontSize: '11.5px', marginTop: '3px', color: col }}>
                        {!r.cabe && 'No alcanza a terminar en el horizonte: hay que partirla, subir cantidad de turnos o mover a otra maquina.'}
                        {r.cabe && r.empujada && `Se pidio para ${fechaHora(r.inicio_solicitado)} pero arranca ${Math.round(Number(r.empuje_min) / 60)} h despues porque la maquina sigue ocupada.`}
                        {r.cabe && !r.empujada && r.atrasada && 'Segun el plan ya deberia haber terminado y sigue abierta.'}
                        {r.cabe && !r.empujada && !r.atrasada && `Arranca a tiempo · setup ${r.setup_min || 0} min${Number(r.purga_min) > 0 ? ` + purga ${r.purga_min} min` : ''}`}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      {/* ---------- Secuencia sugerida por color ---------- */}
      {seqMaquina !== '' && (
        <div style={styles.seqPanel}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13.5px', fontWeight: 600, color: '#1a1a2e' }}>Secuencia por color</span>
            <select style={styles.seqSel} value={seqMaquina === 'abrir' ? '' : seqMaquina}
              onChange={e => { setSeqMaquina(e.target.value || 'abrir'); calcularSecuencia(e.target.value) }}>
              <option value="">Elige la maquina...</option>
              {maquinas.map(m => <option key={m.id} value={m.id}>{m.clave} - {m.nombre}</option>)}
            </select>
            {seqCargando && <span style={{ fontSize: '12.5px', color: '#64748b' }}>Calculando...</span>}
          </div>
          <p style={styles.seqAyuda}>
            Se agrupan las OT por molde para no cambiar de molde de mas, y dentro de cada molde los colores
            corren de claro a oscuro. Regresar a un color mas claro exige mucha mas purga, por eso se marca
            en rojo cuando pasa.
          </p>

          {seq && seq.actual.length === 0 && (
            <p style={styles.seqVacio}>Esta maquina no tiene OT programadas en la semana.</p>
          )}

          {seq && seq.actual.length > 0 && (
            <>
              <div style={styles.seqCols}>
                {[['Orden actual', seq.actual, seq.totActual], ['Orden sugerido', seq.sugerido, seq.totSugerido]].map(([tit, filas, tot], idx) => (
                  <div key={tit} style={{ ...styles.seqCol, borderColor: idx === 1 ? '#86efac' : '#e2e8f0' }}>
                    <div style={styles.seqColTit}>
                      <span>{tit}</span>
                      <span style={{ fontWeight: 700, color: idx === 1 ? '#15803d' : '#334155' }}>
                        {tot.min.toLocaleString('es-MX', { maximumFractionDigits: 0 })} min &middot; {tot.kg.toLocaleString('es-MX', { maximumFractionDigits: 1 })} kg
                      </span>
                    </div>
                    {filas.map(r => (
                      <div key={r.escenario + r.ot_id} style={styles.seqFila}>
                        <span style={styles.seqPos}>{r.posicion}</span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#1a1a2e' }}>
                            {r.ot_folio} &middot; {r.articulo_codigo}
                          </div>
                          <div style={{ fontSize: '11.5px', color: '#64748b' }}>
                            {r.molde_clave || 'sin molde'} &middot; {r.color_clave || 'sin color'} &middot; {ddmm(r.fecha_programada)}
                          </div>
                        </span>
                        <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {r.cambio_molde && <span style={styles.seqTagMolde}>molde</span>}
                          {Number(r.min_purga) > 0 && (
                            <span style={r.es_retroceso ? styles.seqTagRojo : styles.seqTagAmbar}>
                              {Number(r.min_purga).toLocaleString('es-MX', { maximumFractionDigits: 0 })} min
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              {(() => {
                const ahorroMin = seq.totActual.min - seq.totSugerido.min
                const ahorroKg = seq.totActual.kg - seq.totSugerido.kg
                if (ahorroMin <= 0.5 && ahorroKg <= 0.1) {
                  return <p style={styles.seqOk}>La secuencia actual ya es la mejor: no hay purga que ahorrar.</p>
                }
                return (
                  <div style={styles.seqAhorro}>
                    <span>
                      Reordenar ahorra <b>{ahorroMin.toLocaleString('es-MX', { maximumFractionDigits: 0 })} min</b> de
                      purga y <b>{ahorroKg.toLocaleString('es-MX', { maximumFractionDigits: 1 })} kg</b> de material.
                    </span>
                    {puedeProgramar && semana?.estatus !== 'cerrada' && (
                      <button style={styles.boton} disabled={seqCargando} onClick={aplicarSecuencia}>
                        Aplicar orden sugerido
                      </button>
                    )}
                  </div>
                )
              })()}
            </>
          )}
        </div>
      )}
      {exito && <p style={styles.exito}>{exito}</p>}

      <div style={styles.leyenda} className="no-imprimir">
        {Object.entries(COLOR_EST).map(([k, v]) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: v.c }} /> {v.l}
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: '#fffbeb', border: '1px solid #d97706' }} /> OT con cambio de molde
        </span>
      </div>

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
                <td style={styles.tdMaq}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ width: '9px', height: '9px', borderRadius: '50%', backgroundColor: COLOR_EST[estadoMaq(m.id)]?.c || '#94a3b8', flex: '0 0 auto' }} />
                    {m.clave}
                  </span>
                  <br /><span style={{ fontSize: '10px', color: '#94a3b8' }}>{m.nombre}</span>
                  <div style={{ fontSize: '9px', fontWeight: 700, color: COLOR_EST[estadoMaq(m.id)]?.c || '#94a3b8' }}>{COLOR_EST[estadoMaq(m.id)]?.l || ''}</div>
                </td>
                {dias.map((d, i) => (
                  <td key={i} style={styles.tdDia}>
                    {otsDe(m.id, d).map(o => {
                      const av = avance[o.id] || { ok: 0, scrap: 0 }
                      const falt = Math.max(Number(o.cantidad_programada) - av.ok, 0)
                      const atras = o.fecha_programada < hoy && o.estatus === 'programada'
                      const cambia = implicaCambio(o)
                      return (
                        <button key={o.id} onClick={() => { setChequeo(null); setEdit({ ...o, _orig: { maquina_id: o.maquina_id, fecha_programada: o.fecha_programada, turno: o.turno }, _nuevaMaquina: String(o.maquina_id || ''), _motivo: '' }) }} style={{ ...styles.card, borderLeftColor: atras ? '#dc2626' : cambia ? '#d97706' : COLOR_EST[estadoMaq(o.maquina_id)]?.c || '#7c3aed', backgroundColor: cambia ? '#fffbeb' : '#fff' }}>
                          <div style={styles.cardTop}><span style={styles.turnoBadge}>{o.turno}</span> <strong>#{o.secuencia}</strong> {o.folio}</div>
                          <div style={{ fontWeight: '600', fontSize: '12px' }}>{familia(o)}</div>
                          <div style={{ fontSize: '11px', color: '#64748b' }}>Molde {o.molde_id || '-'} · {fmt(o.cantidad_programada)} pz</div>
                          <div style={{ fontSize: '10px', color: '#94a3b8' }}>OK {fmt(av.ok)} · Falta {fmt(falt)} · Scrap {fmt(av.scrap)}</div>
                          {cambia && <span style={styles.cambioBadge}>CAMBIO DE MOLDE{Number(o.cambio_molde_min) > 0 ? ` ${o.cambio_molde_min}m` : ''}</span>}
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
            {(() => {
              const permitidas = maquinasAutorizadas(edit)
              const nueva = edit.maquina_id ? parseInt(edit.maquina_id) : null
              const requiereAut = nueva && nueva !== edit._orig?.maquina_id && !permitidas.has(nueva)
              const pend = solicitudPendiente(edit.id)
              return (<>
                <div style={styles.campo}><label style={styles.label}>Maquina</label>
                  <select style={styles.input} value={edit.maquina_id || ''} onChange={e => { setEdit({ ...edit, maquina_id: e.target.value }); revisarDestino(e.target.value, edit.fecha_programada, edit.turno, edit.id) }}>
                    {maquinas.map(m => <option key={m.id} value={m.id}>{m.clave} - {m.nombre}{permitidas.has(m.id) ? '  (autorizada)' : ''}</option>)}
                  </select>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>Autorizadas en la ruta: {[...permitidas].map(id => maquinas.find(m => m.id === id)?.clave).filter(Boolean).join(', ') || 'ninguna'}</span>
                </div>
                {pend && <div style={styles.avisoAmbar}>Ya hay una solicitud de maquina alterna <b>pendiente</b> para esta OT.</div>}
                {requiereAut && (
                  <div style={styles.avisoAmbar}>
                    Esa maquina <b>no esta aprobada</b> para el articulo. Al guardar se enviara una <b>solicitud de maquina alterna a Ingenieria</b> y la OT no se movera hasta autorizarse.
                    <input style={{ ...styles.input, marginTop: '6px' }} placeholder="Motivo del cambio *" value={edit._motivo || ''} onChange={e => setEdit({ ...edit, _motivo: e.target.value })} />
                  </div>
                )}
              </>)
            })()}
            <div style={styles.campo}><label style={styles.label}>Fecha</label>
              <input style={styles.input} type="date" value={edit.fecha_programada || ''} onChange={e => { setEdit({ ...edit, fecha_programada: e.target.value }); revisarDestino(edit.maquina_id, e.target.value, edit.turno, edit.id) }} /></div>
            <div style={styles.campo}><label style={styles.label}>Turno</label>
              <select style={styles.input} value={edit.turno || ''} onChange={e => { setEdit({ ...edit, turno: e.target.value }); revisarDestino(edit.maquina_id, edit.fecha_programada, e.target.value, edit.id) }}>
                {turnos.map(t => <option key={t.id} value={t.clave}>{t.clave} - {t.nombre}</option>)}
              </select></div>

            {/* Candado de capacidad: no basta con avisar que no cabe, dice cuanto SI cabe */}
            {chequeo && !chequeo.cabe && (
              <div style={styles.avisoRojo}>
                <b>Ese turno no esta libre.</b>
                <div style={{ marginTop: '5px', lineHeight: 1.5 }}>{chequeo.mensaje}</div>
                {chequeo.cantidad_sugerida != null && (
                  <div style={{ marginTop: '7px', fontSize: '12px' }}>
                    Opciones: reducir la <b>{chequeo.ot_bloq_folio}</b> a{' '}
                    <b>{Number(chequeo.cantidad_sugerida).toLocaleString('es-MX')} pz</b>, cerrarla antes,
                    o programar esta OT a partir de <b>{fechaHora(chequeo.libera_en)}</b>.
                  </div>
                )}
              </div>
            )}
            {chequeo && chequeo.cabe && (
              <div style={styles.avisoVerde}>La maquina esta libre en ese turno.</div>
            )}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button style={styles.botonSec} onClick={() => setEdit(null)}>Cancelar</button>
              <button
                style={{ ...styles.boton, opacity: (chequeo && !chequeo.cabe) ? 0.45 : 1, cursor: (chequeo && !chequeo.cabe) ? 'not-allowed' : 'pointer' }}
                disabled={!!(chequeo && !chequeo.cabe)}
                title={chequeo && !chequeo.cabe ? 'La maquina no esta libre en ese turno' : ''}
                onClick={guardarEdit}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {arrastreForm && (
        <div style={styles.modalBg} onClick={() => setArrastreForm(null)}>
          <div style={{ ...styles.modal, width: '440px' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 8px', fontSize: '15px' }}>OT pendientes de la semana del {ddmm(arrastreForm.prev.semana_inicio)}</h3>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 10px' }}>Hay {arrastreForm.ots.length} OT sin terminar. ¿Arrastrarlas a esta semana ({ddmm(iso(lunes))}) o programar sin arrastrar?</p>
            <div style={{ maxHeight: '160px', overflowY: 'auto', border: '1px solid #eef2f7', borderRadius: '8px', padding: '6px 10px', marginBottom: '12px' }}>
              {arrastreForm.ots.map(o => <div key={o.id} style={{ fontSize: '12.5px', color: '#334155', padding: '2px 0' }}>{o.folio} · {ddmm(o.fecha_programada)} · {o.turno}</div>)}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', flexWrap: 'wrap' }}>
              <button style={styles.botonSec} onClick={() => setArrastreForm(null)}>Cancelar</button>
              <button style={styles.botonCerrar} onClick={() => runPrograma(false)}>Programar sin arrastrar</button>
              <button style={styles.boton} onClick={() => runPrograma(true)}>Arrastrar y programar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const styles = {
  avisoRojo: { background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '10px 12px', fontSize: '12.5px', color: '#b91c1c', marginTop: '10px', lineHeight: 1.5 },
  avisoVerde: { background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', padding: '9px 12px', fontSize: '12.5px', color: '#15803d', marginTop: '10px' },
  planMaq: { border: '1px solid #e2e8f0', borderRadius: '9px', padding: '10px 12px', marginTop: '10px' },
  planMaqTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', paddingBottom: '7px', borderBottom: '1px solid #f1f5f9', marginBottom: '7px' },
  planFila: { borderLeft: '3px solid', borderRadius: '7px', padding: '7px 10px', marginBottom: '6px' },
  planTag: { fontSize: '10.5px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', background: '#ede9fe', color: '#6d28d9', marginLeft: '6px' },
  seqPanel: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 16px', margin: '0 0 14px' },
  seqSel: { padding: '7px 10px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '13px', outline: 'none', background: '#fff', minWidth: '220px' },
  seqAyuda: { fontSize: '12px', color: '#64748b', lineHeight: 1.55, margin: '8px 0 12px' },
  seqVacio: { fontSize: '13px', color: '#64748b', margin: 0 },
  seqCols: { display: 'flex', gap: '14px', flexWrap: 'wrap' },
  seqCol: { flex: 1, minWidth: '300px', border: '1px solid', borderRadius: '9px', padding: '10px 12px' },
  seqColTit: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12.5px', color: '#475569', paddingBottom: '8px', borderBottom: '1px solid #f1f5f9', marginBottom: '4px' },
  seqFila: { display: 'flex', gap: '9px', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f8fafc' },
  seqPos: { width: '22px', height: '22px', borderRadius: '6px', background: '#f1f5f9', color: '#475569', fontSize: '11.5px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  seqTagMolde: { fontSize: '10.5px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', background: '#e0e7ff', color: '#4338ca', marginLeft: '5px' },
  seqTagAmbar: { fontSize: '10.5px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', background: '#fef3c7', color: '#b45309', marginLeft: '5px' },
  seqTagRojo: { fontSize: '10.5px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', background: '#fee2e2', color: '#b91c1c', marginLeft: '5px' },
  seqAhorro: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '12px', padding: '10px 14px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '9px', fontSize: '13px', color: '#15803d' },
  seqOk: { marginTop: '12px', padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '9px', fontSize: '13px', color: '#475569' },
  barra: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' },
  navBtn: { padding: '7px 12px', backgroundColor: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  boton: { padding: '9px 18px', backgroundColor: '#c2410c', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' },
  botonCerrar: { padding: '9px 18px', backgroundColor: '#fff', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  botonSec: { padding: '9px 18px', backgroundColor: '#e2e8f0', color: '#444', border: 'none', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  avisoAmbar: { backgroundColor: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: '8px', padding: '9px 11px', fontSize: '12.5px', marginBottom: '10px' },
  leyenda: { display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '11.5px', color: '#475569', marginBottom: '10px' },
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
