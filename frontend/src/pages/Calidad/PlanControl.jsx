import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { exportarExcel, imprimirTablaPDF } from '../../lib/exportar'
import { useAuth } from '../../context/AuthContext'

// PLAN DE CONTROL (IATF 16949, 8.5.1.1 y Anexo A)
//
// Dice que se mide, con que, cada cuando y que se hace cuando sale mal. Aqui
// no es un anexo en Excel: es la tabla de la que sale la carta de control, asi
// que lo que se capture determina si el SPC de manana significa algo.
//
// Va por version y con un solo plan vigente por articulo. El plan vigente no
// se edita: se clona a una version nueva. Cambiar una tolerancia sin dejar
// rastro es de las cosas que mas caro salen en auditoria, y ademas rompe la
// comparabilidad de las cartas, porque los datos viejos se midieron contra
// otra especificacion.

const num = (v) => v === '' || v === null || v === undefined ? null : Number(v)
const fmt = (n) => n == null ? '-' : Number(n).toLocaleString('es-MX', { maximumFractionDigits: 4 })

const ESTATUS = {
  borrador: { txt: 'Borrador', bg: '#fef3c7', col: '#92400e' },
  vigente:  { txt: 'Vigente',  bg: '#dcfce7', col: '#15803d' },
  obsoleto: { txt: 'Obsoleto', bg: '#e5e7eb', col: '#374151' },
}
const ESPECIAL = {
  critica:       { txt: 'Critica',       bg: '#fee2e2', col: '#b91c1c' },
  significativa: { txt: 'Significativa', bg: '#ffedd5', col: '#c2410c' },
  seguridad:     { txt: 'Seguridad',     bg: '#fee2e2', col: '#991b1b' },
}
const FREQ = {
  arranque: 'Al arranque', por_hora: 'Cada hora', cada_n_horas: 'Cada N horas',
  por_turno: 'Por turno', por_lote: 'Por lote', por_piezas: 'Cada N piezas',
}

const caracVacia = {
  orden: 1, numero: '', nombre: '', tipo: 'variable', especial: '',
  ruta_fabricacion_id: '', nominal: '', lie: '', lse: '', unidad: '',
  equipo_id: '', tamano_subgrupo: 5, frecuencia_tipo: 'por_turno', frecuencia_valor: '',
  metodo_control: '', plan_reaccion: '', meta_cpk: 1.33, meta_ppk: 1.67,
  requiere_spc: true, activo: true,
}

export default function PlanControl() {
  const { perfil, tienePermiso } = useAuth()
  const emp = perfil.empresa_id
  const puedeEditar = tienePermiso('cal_plan_control', 'crear') || tienePermiso('cal_plan_control', 'editar')
  const puedeAprobar = tienePermiso('cal_plan_control', 'aprobar')

  const [resumen, setResumen] = useState([])
  const [articulos, setArticulos] = useState([])
  const [equipos, setEquipos] = useState([])
  const [rutas, setRutas] = useState([])
  const [planSel, setPlanSel] = useState(null)
  const [caracs, setCaracs] = useState([])
  const [plan, setPlan] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  const [nuevoArt, setNuevoArt] = useState('')
  const [form, setForm] = useState(null)
  const [editando, setEditando] = useState(null)

  useEffect(() => { cargar() }, [])
  useEffect(() => { if (planSel) cargarPlan(planSel) }, [planSel])

  const cargar = async () => {
    setLoading(true); setError('')
    const [rs, ar, eq, ru] = await Promise.all([
      supabase.rpc('planes_control_resumen', { p_empresa_id: emp }),
      supabase.from('articulos').select('id, codigo_interno, descripcion')
        .eq('empresa_id', emp).eq('activo', true).eq('origen', 'fabricado').order('codigo_interno'),
      supabase.rpc('equipos_estado', { p_empresa_id: emp, p_site_id: null }),
      supabase.from('rutas_fabricacion').select('id, articulo_id, secuencia, tipo_operacion'),
    ])
    if (rs.error) setError('No se pudo cargar: ' + rs.error.message)
    setResumen(rs.data || []); setArticulos(ar.data || [])
    setEquipos(eq.data || []); setRutas(ru.data || [])
    setLoading(false)
  }

  const cargarPlan = async (id) => {
    const [p, c] = await Promise.all([
      supabase.from('planes_control').select('*').eq('id', id).maybeSingle(),
      supabase.from('plan_control_caracteristicas').select('*').eq('plan_id', id).order('orden').order('id'),
    ])
    setPlan(p.data || null); setCaracs(c.data || [])
    setForm(null); setEditando(null)
  }

  const editable = plan?.estatus === 'borrador' && puedeEditar

  // ---------- Plan ----------
  const crearPlan = async () => {
    setError(''); setExito('')
    if (!nuevoArt) { setError('Elige el articulo'); return }
    const artId = Number(nuevoArt)
    if (resumen.some(r => r.articulo_id === artId && r.estatus === 'borrador')) {
      setError('Ese articulo ya tiene una version en borrador. Terminala o descartala antes de crear otra.')
      return
    }
    const { data, error: e } = await supabase.from('planes_control')
      .insert({ empresa_id: emp, articulo_id: artId, version: 1, fase: 'produccion', elaborado_por: perfil.id })
      .select().single()
    if (e) {
      setError(e.message.includes('duplicate')
        ? 'Ese articulo ya tiene un plan version 1. Usa Clonar sobre el plan existente para sacar una version nueva.'
        : 'No se pudo crear: ' + e.message)
      return
    }
    setNuevoArt(''); setExito('Plan creado en borrador'); await cargar(); setPlanSel(data.id)
  }

  const guardarCabecera = async (campo, valor) => {
    if (!editable) return
    const { error: e } = await supabase.from('planes_control').update({ [campo]: valor || null }).eq('id', plan.id)
    if (e) { setError('No se pudo guardar: ' + e.message); return }
    setPlan(p => ({ ...p, [campo]: valor })); cargar()
  }

  const activar = async () => {
    setError(''); setExito('')
    if (!confirm(`Vas a poner vigente la version ${plan.version}. La version vigente anterior queda obsoleta y a partir de ahora se mide contra esta. Confirma para continuar.`)) return
    const { data, error: e } = await supabase.rpc('activar_plan_control', {
      p_empresa_id: emp, p_plan_id: plan.id, p_usuario: perfil.id,
    })
    if (e) { setError(e.message); return }
    setExito(`Plan vigente con ${data} caracteristica(s)`); await cargar(); cargarPlan(plan.id)
  }

  const clonar = async () => {
    setError(''); setExito('')
    const { data, error: e } = await supabase.rpc('clonar_plan_control', {
      p_empresa_id: emp, p_plan_id: plan.id, p_usuario: perfil.id,
    })
    if (e) { setError(e.message); return }
    setExito('Version nueva en borrador. Aqui si se puede editar.')
    await cargar(); setPlanSel(data)
  }

  const descartar = async () => {
    if (!confirm(`Se va a borrar la version ${plan.version} en borrador con todas sus caracteristicas. Confirma para continuar.`)) return
    const { error: e } = await supabase.from('planes_control').delete().eq('id', plan.id)
    if (e) { setError('No se pudo descartar: ' + e.message); return }
    setPlanSel(null); setPlan(null); setCaracs([]); setExito('Borrador descartado'); cargar()
  }

  // ---------- Caracteristicas ----------
  const guardarCarac = async () => {
    setError(''); setExito('')
    if (!form.nombre) { setError('La caracteristica necesita nombre'); return }
    if (!form.plan_reaccion || !form.plan_reaccion.trim()) {
      setError('Falta el plan de reaccion. Un plan de control que dice que medir pero no que hacer cuando sale mal no sirve en el momento que importa.')
      return
    }
    if (form.tipo === 'variable' && form.lie === '' && form.lse === '') {
      setError('Una caracteristica por variables necesita al menos un limite; si no, no hay contra que comparar ni forma de calcular capacidad.')
      return
    }
    if (form.especial && !form.requiere_spc) {
      setError('Una caracteristica especial del cliente obliga a control estadistico. Marca "lleva SPC".')
      return
    }
    const payload = {
      plan_id: plan.id, orden: Number(form.orden) || 1,
      numero: form.numero || null, nombre: form.nombre,
      tipo: form.tipo, especial: form.especial || null,
      ruta_fabricacion_id: form.ruta_fabricacion_id ? Number(form.ruta_fabricacion_id) : null,
      nominal: num(form.nominal), lie: num(form.lie), lse: num(form.lse),
      unidad: form.unidad || null,
      equipo_id: form.equipo_id ? Number(form.equipo_id) : null,
      tamano_subgrupo: Number(form.tamano_subgrupo) || 1,
      frecuencia_tipo: form.frecuencia_tipo, frecuencia_valor: num(form.frecuencia_valor),
      metodo_control: form.metodo_control || null,
      plan_reaccion: form.plan_reaccion,
      meta_cpk: Number(form.meta_cpk) || 1.33, meta_ppk: Number(form.meta_ppk) || 1.67,
      requiere_spc: !!form.requiere_spc, activo: !!form.activo,
    }
    const r = editando
      ? await supabase.from('plan_control_caracteristicas').update(payload).eq('id', editando)
      : await supabase.from('plan_control_caracteristicas').insert(payload)
    if (r.error) {
      const m = r.error.message
      setError(
        m.includes('carac_limites_coherentes') ? 'El limite inferior tiene que ser menor que el superior.'
        : m.includes('carac_nominal_dentro') ? 'El nominal tiene que quedar dentro de los limites.'
        : m.includes('carac_variable_con_limite') ? 'Una caracteristica por variables necesita al menos un limite.'
        : m.includes('carac_subgrupo_valido') ? 'El tamano de subgrupo tiene que estar entre 1 y 25.'
        : m.includes('duplicate') ? `Ya hay una caracteristica llamada "${payload.nombre}" en este plan. Los nombres se usan para identificar la carta, asi que tienen que ser distintos.`
        : 'No se pudo guardar: ' + m)
      return
    }
    setForm(null); setEditando(null); setExito('Caracteristica guardada'); cargarPlan(plan.id)
  }

  const editarCarac = (c) => {
    setEditando(c.id); setError('')
    setForm({
      orden: c.orden, numero: c.numero || '', nombre: c.nombre, tipo: c.tipo,
      especial: c.especial || '', ruta_fabricacion_id: c.ruta_fabricacion_id || '',
      nominal: c.nominal ?? '', lie: c.lie ?? '', lse: c.lse ?? '', unidad: c.unidad || '',
      equipo_id: c.equipo_id || '', tamano_subgrupo: c.tamano_subgrupo,
      frecuencia_tipo: c.frecuencia_tipo, frecuencia_valor: c.frecuencia_valor ?? '',
      metodo_control: c.metodo_control || '', plan_reaccion: c.plan_reaccion,
      meta_cpk: c.meta_cpk, meta_ppk: c.meta_ppk,
      requiere_spc: c.requiere_spc, activo: c.activo,
    })
  }

  const borrarCarac = async (c) => {
    if (!confirm(`Se va a quitar "${c.nombre}" de este borrador. Confirma para continuar.`)) return
    const { error: e } = await supabase.from('plan_control_caracteristicas').delete().eq('id', c.id)
    if (e) { setError('No se pudo quitar: ' + e.message); return }
    setExito('Caracteristica quitada'); cargarPlan(plan.id)
  }

  // ---------- Derivados ----------
  const equipoDe = (id) => equipos.find(e => e.id === id)
  const artDe = (id) => articulos.find(a => a.id === id)
  const rutasDelArt = rutas.filter(r => r.articulo_id === plan?.articulo_id)
    .sort((a, b) => a.secuencia - b.secuencia)
  const sinPlanVigente = articulos.filter(a => !resumen.some(r => r.articulo_id === a.id && r.estatus === 'vigente'))

  const COLS = [
    { label: 'No.', get: c => c.numero || '' },
    { label: 'Caracteristica', get: c => c.nombre },
    { label: 'Tipo', get: c => c.tipo },
    { label: 'Especial', get: c => c.especial || '' },
    { label: 'Nominal', get: c => c.nominal ?? '' },
    { label: 'LIE', get: c => c.lie ?? '' },
    { label: 'LSE', get: c => c.lse ?? '' },
    { label: 'Unidad', get: c => c.unidad || '' },
    { label: 'Equipo', get: c => equipoDe(c.equipo_id)?.clave || '' },
    { label: 'Subgrupo', get: c => c.tamano_subgrupo },
    { label: 'Frecuencia', get: c => (FREQ[c.frecuencia_tipo] || c.frecuencia_tipo) + (c.frecuencia_valor ? ` (${c.frecuencia_valor})` : '') },
    { label: 'Metodo', get: c => c.metodo_control || '' },
    { label: 'Plan de reaccion', get: c => c.plan_reaccion },
    { label: 'Meta Cpk', get: c => c.meta_cpk },
    { label: 'Meta Ppk', get: c => c.meta_ppk },
    { label: 'Lleva SPC', get: c => c.requiere_spc ? 'Si' : 'No' },
  ]

  return (
    <div style={S.wrap}>
      <div style={S.top}>
        <div>
          <h2 style={S.h2}>Plan de control</h2>
          <p style={S.sub}>
            Que se mide, con que, cada cuando y que se hace cuando sale mal. De aqui sale la carta de
            control, asi que lo que se capture determina si el SPC significa algo. Va por
            <b> version</b>, con un solo plan vigente por articulo: el vigente no se edita, se
            <b> clona</b> a una version nueva para que quede el rastro de que cambio.
          </p>
        </div>
      </div>

      {error && <p style={S.err}>{error}</p>}
      {exito && <p style={S.ok}>{exito}</p>}
      {loading && <p style={S.info}>Cargando...</p>}

      <div style={S.cols}>
        {/* ---------- Lista de planes ---------- */}
        <div style={S.izq}>
          {puedeEditar && (
            <div style={S.card}>
              <p style={S.cardTit}>Nuevo plan</p>
              <select style={S.input} value={nuevoArt} onChange={e => setNuevoArt(e.target.value)}>
                <option value="">Elige el articulo...</option>
                {sinPlanVigente.map(a => <option key={a.id} value={a.id}>{a.codigo_interno} - {a.descripcion}</option>)}
              </select>
              <span style={S.ayuda}>
                Solo salen los articulos fabricados que aun no tienen plan vigente. Para cambiar uno
                que ya esta vigente, abrelo y usa Clonar.
              </span>
              <div style={S.acciones}>
                <button style={S.boton} onClick={crearPlan}>Crear borrador</button>
              </div>
            </div>
          )}

          <div style={S.card}>
            <p style={S.cardTit}>Planes &middot; {resumen.length}</p>
            {resumen.length === 0 && <p style={S.vacio}>Aun no hay planes de control.</p>}
            {resumen.map(r => {
              const st = ESTATUS[r.estatus] || {}
              return (
                <button key={r.plan_id} onClick={() => setPlanSel(r.plan_id)}
                  style={{ ...S.item, ...(planSel === r.plan_id ? S.itemAct : {}) }}>
                  <span style={{ fontWeight: 600 }}>{r.codigo_interno}</span>
                  <span style={{ ...S.tag, background: st.bg, color: st.col, marginLeft: 6 }}>
                    v{r.version} {st.txt}
                  </span>
                  <span style={S.itemPie}>
                    {r.caracteristicas} caract.
                    {r.especiales > 0 && ` · ${r.especiales} especial(es)`}
                    {r.equipos_no_utilizables > 0 && (
                      <span style={{ color: '#b91c1c' }}> · {r.equipos_no_utilizables} equipo(s) sin vigencia</span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ---------- Detalle ---------- */}
        <div style={S.der}>
          {!plan && <div style={S.card}><p style={S.vacio}>Elige un plan de la lista.</p></div>}

          {plan && (
            <>
              <div style={S.card}>
                <div style={S.cardHead}>
                  <div>
                    <p style={S.cardTit}>
                      {artDe(plan.articulo_id)?.codigo_interno} &middot; version {plan.version}
                      <span style={{ ...S.tag, ...(ESTATUS[plan.estatus] || {}), marginLeft: 8 }}>
                        {ESTATUS[plan.estatus]?.txt}
                      </span>
                    </p>
                    <p style={S.ayuda}>
                      {artDe(plan.articulo_id)?.descripcion}
                      {plan.vigente_desde && ` · vigente desde ${plan.vigente_desde}`}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button style={S.expBtn} onClick={() => exportarExcel(`plan_control_${artDe(plan.articulo_id)?.codigo_interno}_v${plan.version}`, COLS, caracs)}>Excel</button>
                    <button style={S.expBtn} onClick={() => imprimirTablaPDF(`Plan de control ${artDe(plan.articulo_id)?.codigo_interno} v${plan.version}`, COLS, caracs)}>PDF</button>
                    {plan.estatus === 'borrador' && puedeAprobar && (
                      <button style={S.boton} onClick={activar}>Poner vigente</button>
                    )}
                    {plan.estatus === 'borrador' && puedeEditar && (
                      <button style={S.botonSec} onClick={descartar}>Descartar</button>
                    )}
                    {plan.estatus !== 'borrador' && puedeEditar && (
                      <button style={S.boton} onClick={clonar}>Clonar a version nueva</button>
                    )}
                  </div>
                </div>

                <div style={S.fila}>
                  <div style={S.campo}>
                    <label style={S.label}>Fase</label>
                    <select style={S.input} disabled={!editable} value={plan.fase}
                      onChange={e => guardarCabecera('fase', e.target.value)}>
                      <option value="prototipo">Prototipo</option>
                      <option value="pre_lanzamiento">Pre-lanzamiento</option>
                      <option value="produccion">Produccion</option>
                    </select>
                  </div>
                  <div style={S.campo}>
                    <label style={S.label}>Nivel de revision del dibujo</label>
                    <input style={S.input} disabled={!editable} defaultValue={plan.nivel_revision_dibujo || ''}
                      onBlur={e => guardarCabecera('nivel_revision_dibujo', e.target.value)} placeholder="Rev C" />
                  </div>
                  <div style={{ ...S.campo, flex: 3 }}>
                    <label style={S.label}>Notas</label>
                    <input style={S.input} disabled={!editable} defaultValue={plan.notas || ''}
                      onBlur={e => guardarCabecera('notas', e.target.value)} />
                  </div>
                </div>

                {plan.estatus === 'vigente' && (
                  <p style={S.nota}>
                    Este plan esta vigente y por eso no se edita. Si hay que cambiar una tolerancia,
                    un equipo o una frecuencia, usa <b>Clonar a version nueva</b>: los datos ya
                    capturados se midieron contra esta version y tienen que seguir comparandose
                    contra ella.
                  </p>
                )}
              </div>

              {/* ---------- Caracteristicas ---------- */}
              <div style={S.card}>
                <div style={S.cardHead}>
                  <p style={S.cardTit}>Caracteristicas &middot; {caracs.length}</p>
                  {editable && !form && (
                    <button style={S.boton} onClick={() => {
                      setForm({ ...caracVacia, orden: (caracs.length ? Math.max(...caracs.map(c => c.orden)) : 0) + 1 })
                      setEditando(null); setError('')
                    }}>+ Agregar</button>
                  )}
                </div>

                {caracs.length === 0 && <p style={S.vacio}>Este plan aun no tiene caracteristicas.</p>}
                {caracs.length > 0 && (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={S.tabla}>
                      <thead>
                        <tr>
                          <th style={S.th}>#</th><th style={S.th}>No.</th><th style={S.th}>Caracteristica</th>
                          <th style={S.th}>Tipo</th><th style={S.th}>Especial</th>
                          <th style={S.thR}>LIE</th><th style={S.thR}>Nom.</th><th style={S.thR}>LSE</th>
                          <th style={S.th}>Equipo</th><th style={S.thR}>n</th><th style={S.th}>Frecuencia</th>
                          <th style={S.thR}>Cpk</th><th style={S.th}>SPC</th>
                          <th style={S.th}>Plan de reaccion</th><th style={S.th}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {caracs.map(c => {
                          const eq = equipoDe(c.equipo_id)
                          const eqMal = eq && !['vigente', 'por_vencer'].includes(eq.estado)
                          return (
                            <tr key={c.id} style={c.activo ? {} : { opacity: 0.5 }}>
                              <td style={S.td}>{c.orden}</td>
                              <td style={S.td}>{c.numero || '-'}</td>
                              <td style={{ ...S.td, fontWeight: 600 }}>{c.nombre}</td>
                              <td style={S.td}>{c.tipo}</td>
                              <td style={S.td}>
                                {c.especial
                                  ? <span style={{ ...S.tag, ...(ESPECIAL[c.especial] || {}) }}>{ESPECIAL[c.especial]?.txt}</span>
                                  : '-'}
                              </td>
                              <td style={S.tdR}>{fmt(c.lie)}</td>
                              <td style={S.tdR}>{fmt(c.nominal)}</td>
                              <td style={S.tdR}>{fmt(c.lse)}{c.unidad ? ` ${c.unidad}` : ''}</td>
                              <td style={S.td}>
                                {eq ? eq.clave : <span style={{ color: '#b91c1c' }}>sin equipo</span>}
                                {eqMal && <span style={{ ...S.tag, background: '#fee2e2', color: '#b91c1c', marginLeft: 4 }}>{eq.estado}</span>}
                              </td>
                              <td style={S.tdR}>{c.tamano_subgrupo}</td>
                              <td style={S.td}>{FREQ[c.frecuencia_tipo] || c.frecuencia_tipo}{c.frecuencia_valor ? ` (${c.frecuencia_valor})` : ''}</td>
                              <td style={S.tdR}>{c.meta_cpk}</td>
                              <td style={S.td}>{c.requiere_spc ? 'Si' : 'No'}</td>
                              <td style={{ ...S.td, maxWidth: 240 }}>{c.plan_reaccion}</td>
                              <td style={S.td}>
                                {editable && (
                                  <div style={{ display: 'flex', gap: 6 }}>
                                    <button style={S.btnMini} onClick={() => editarCarac(c)}>Editar</button>
                                    <button style={S.btnMiniSec} onClick={() => borrarCarac(c)}>Quitar</button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {form && (
                  <div style={S.formBox}>
                    <p style={S.cardTit}>{editando ? 'Editar caracteristica' : 'Nueva caracteristica'}</p>
                    <div style={S.fila}>
                      <div style={{ ...S.campo, maxWidth: 70 }}>
                        <label style={S.label}>Orden</label>
                        <input type="number" min="1" style={S.input} value={form.orden}
                          onChange={e => setForm({ ...form, orden: e.target.value })} />
                      </div>
                      <div style={{ ...S.campo, maxWidth: 90 }}>
                        <label style={S.label}>No. dibujo</label>
                        <input style={S.input} value={form.numero}
                          onChange={e => setForm({ ...form, numero: e.target.value })} />
                      </div>
                      <div style={{ ...S.campo, flex: 2.5 }}>
                        <label style={S.label}>Caracteristica *</label>
                        <input style={S.input} value={form.nombre}
                          onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Diametro pasador" />
                      </div>
                      <div style={S.campo}>
                        <label style={S.label}>Tipo</label>
                        <select style={S.input} value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>
                          <option value="variable">Por variables (se mide)</option>
                          <option value="atributo">Por atributos (pasa / no pasa)</option>
                        </select>
                      </div>
                      <div style={S.campo}>
                        <label style={S.label}>Caracteristica especial</label>
                        <select style={S.input} value={form.especial}
                          onChange={e => setForm({ ...form, especial: e.target.value, requiere_spc: e.target.value ? true : form.requiere_spc })}>
                          <option value="">Ninguna</option>
                          <option value="critica">Critica</option>
                          <option value="significativa">Significativa</option>
                          <option value="seguridad">Seguridad</option>
                        </select>
                        <span style={S.ayuda}>Simbolo del cliente. Obliga a SPC.</span>
                      </div>
                    </div>

                    <div style={S.fila}>
                      <div style={S.campo}>
                        <label style={S.label}>Limite inferior</label>
                        <input type="number" step="any" style={S.input} value={form.lie}
                          onChange={e => setForm({ ...form, lie: e.target.value })} />
                      </div>
                      <div style={S.campo}>
                        <label style={S.label}>Nominal</label>
                        <input type="number" step="any" style={S.input} value={form.nominal}
                          onChange={e => setForm({ ...form, nominal: e.target.value })} />
                      </div>
                      <div style={S.campo}>
                        <label style={S.label}>Limite superior</label>
                        <input type="number" step="any" style={S.input} value={form.lse}
                          onChange={e => setForm({ ...form, lse: e.target.value })} />
                        <span style={S.ayuda}>Deja uno vacio si la tolerancia es unilateral.</span>
                      </div>
                      <div style={{ ...S.campo, maxWidth: 90 }}>
                        <label style={S.label}>Unidad</label>
                        <input style={S.input} maxLength={10} value={form.unidad}
                          onChange={e => setForm({ ...form, unidad: e.target.value })} placeholder="mm" />
                      </div>
                      <div style={{ ...S.campo, flex: 1.6 }}>
                        <label style={S.label}>Equipo de medicion</label>
                        <select style={S.input} value={form.equipo_id}
                          onChange={e => setForm({ ...form, equipo_id: e.target.value })}>
                          <option value="">Sin asignar</option>
                          {equipos.map(x => (
                            <option key={x.id} value={x.id}>
                              {x.clave} - {x.nombre}{['vigente', 'por_vencer'].includes(x.estado) ? '' : ` (${x.estado})`}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div style={S.fila}>
                      <div style={{ ...S.campo, flex: 1.8 }}>
                        <label style={S.label}>Operacion de la ruta</label>
                        <select style={S.input} value={form.ruta_fabricacion_id}
                          onChange={e => setForm({ ...form, ruta_fabricacion_id: e.target.value })}>
                          <option value="">Sin especificar</option>
                          {rutasDelArt.map(r => (
                            <option key={r.id} value={r.id}>{r.secuencia}. {r.tipo_operacion}</option>
                          ))}
                        </select>
                      </div>
                      <div style={{ ...S.campo, maxWidth: 90 }}>
                        <label style={S.label}>Subgrupo (n)</label>
                        <input type="number" min="1" max="25" style={S.input} value={form.tamano_subgrupo}
                          onChange={e => setForm({ ...form, tamano_subgrupo: e.target.value })} />
                        <span style={S.ayuda}>Piezas por muestra.</span>
                      </div>
                      <div style={{ ...S.campo, flex: 1.4 }}>
                        <label style={S.label}>Frecuencia</label>
                        <select style={S.input} value={form.frecuencia_tipo}
                          onChange={e => setForm({ ...form, frecuencia_tipo: e.target.value })}>
                          {Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </div>
                      <div style={{ ...S.campo, maxWidth: 90 }}>
                        <label style={S.label}>Cada</label>
                        <input type="number" step="any" style={S.input} value={form.frecuencia_valor}
                          onChange={e => setForm({ ...form, frecuencia_valor: e.target.value })} />
                        <span style={S.ayuda}>Horas o piezas.</span>
                      </div>
                      <div style={{ ...S.campo, maxWidth: 90 }}>
                        <label style={S.label}>Meta Cpk</label>
                        <input type="number" step="0.01" style={S.input} value={form.meta_cpk}
                          onChange={e => setForm({ ...form, meta_cpk: e.target.value })} />
                      </div>
                      <div style={{ ...S.campo, maxWidth: 90 }}>
                        <label style={S.label}>Meta Ppk</label>
                        <input type="number" step="0.01" style={S.input} value={form.meta_ppk}
                          onChange={e => setForm({ ...form, meta_ppk: e.target.value })} />
                      </div>
                    </div>

                    <div style={S.fila}>
                      <div style={{ ...S.campo, flex: 2 }}>
                        <label style={S.label}>Metodo de control</label>
                        <input style={S.input} value={form.metodo_control}
                          onChange={e => setForm({ ...form, metodo_control: e.target.value })}
                          placeholder="Carta X-R, inspeccion visual contra muestra maestra..." />
                      </div>
                      <div style={{ ...S.campo, flex: 3 }}>
                        <label style={S.label}>Plan de reaccion *</label>
                        <input style={S.input} value={form.plan_reaccion}
                          onChange={e => setForm({ ...form, plan_reaccion: e.target.value })}
                          placeholder="Segregar desde la ultima muestra buena, avisar a Calidad y ajustar molde" />
                        <span style={S.ayuda}>Que se hace cuando sale mal. Sin esto el plan no se puede activar.</span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                      <label style={S.check}>
                        <input type="checkbox" checked={!!form.requiere_spc}
                          onChange={e => setForm({ ...form, requiere_spc: e.target.checked })} />
                        <span>Lleva carta de control (SPC)</span>
                      </label>
                      <label style={S.check}>
                        <input type="checkbox" checked={!!form.activo}
                          onChange={e => setForm({ ...form, activo: e.target.checked })} />
                        <span>Activa</span>
                      </label>
                    </div>

                    <div style={S.acciones}>
                      <button style={S.botonSec} onClick={() => { setForm(null); setEditando(null) }}>Cancelar</button>
                      <button style={S.boton} onClick={guardarCarac}>Guardar</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const S = {
  wrap: { padding: '24px 28px' },
  top: { marginBottom: '12px' },
  h2: { fontSize: '20px', color: '#1a1a2e', margin: 0 },
  sub: { color: '#64748b', fontSize: '13px', margin: '4px 0 0', maxWidth: '860px', lineHeight: 1.5 },
  cols: { display: 'flex', gap: '13px', alignItems: 'flex-start', flexWrap: 'wrap' },
  izq: { width: '290px', flexShrink: 0 },
  der: { flex: 1, minWidth: '520px' },
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '15px 17px', marginBottom: '13px' },
  formBox: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 15px', marginTop: '12px' },
  cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' },
  cardTit: { fontSize: '14px', fontWeight: 600, color: '#1a1a2e', margin: '0 0 4px' },
  fila: { display: 'flex', gap: '11px', flexWrap: 'wrap' },
  campo: { display: 'flex', flexDirection: 'column', gap: '5px', flex: 1, minWidth: '110px', marginBottom: '8px' },
  label: { fontSize: '12px', color: '#444', fontWeight: 500 },
  input: { padding: '8px 10px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '13px', outline: 'none', background: '#fff', width: '100%', boxSizing: 'border-box' },
  ayuda: { fontSize: '11px', color: '#64748b', lineHeight: 1.4 },
  check: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#444', margin: '4px 0' },
  nota: { background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '8px', padding: '9px 12px', fontSize: '12.5px', color: '#075985', marginTop: '8px', lineHeight: 1.5 },
  acciones: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' },
  boton: { padding: '8px 17px', background: '#b91c1c', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', fontWeight: 500 },
  botonSec: { padding: '8px 17px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  btnMini: { padding: '4px 10px', background: '#b91c1c', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '11.5px', cursor: 'pointer' },
  btnMiniSec: { padding: '4px 10px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '6px', fontSize: '11.5px', cursor: 'pointer' },
  expBtn: { padding: '7px 12px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '12.5px', cursor: 'pointer' },
  item: { display: 'block', width: '100%', textAlign: 'left', padding: '9px 10px', border: '1px solid transparent', borderRadius: '8px', background: 'transparent', cursor: 'pointer', fontSize: '13px', color: '#1a1a2e', marginBottom: '3px' },
  itemAct: { background: '#fef2f2', border: '1px solid #fecaca' },
  itemPie: { display: 'block', fontSize: '11px', color: '#64748b', marginTop: '3px' },
  err: { color: '#b91c1c', fontSize: '13px', margin: '0 0 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '9px 12px', lineHeight: 1.5 },
  ok: { color: '#15803d', fontSize: '13px', margin: '0 0 10px' },
  info: { color: '#64748b', fontSize: '13px' },
  vacio: { color: '#64748b', fontSize: '13px', margin: 0 },
  tabla: { width: '100%', borderCollapse: 'collapse', fontSize: '12px' },
  th: { textAlign: 'left', padding: '7px 8px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' },
  thR: { textAlign: 'right', padding: '7px 8px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' },
  td: { padding: '6px 8px', borderBottom: '1px solid #f1f5f9', color: '#1a1a2e' },
  tdR: { padding: '6px 8px', borderBottom: '1px solid #f1f5f9', color: '#1a1a2e', textAlign: 'right', whiteSpace: 'nowrap' },
  tag: { fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', whiteSpace: 'nowrap' },
}
