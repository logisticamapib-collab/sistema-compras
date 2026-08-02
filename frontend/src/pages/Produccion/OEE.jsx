import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { exportarExcel, imprimirTablaPDF } from '../../lib/exportar'
import { useAuth } from '../../context/AuthContext'
import FiltroSite from '../../components/FiltroSite'
import { siteEfectivo } from '../../lib/sites'
import {
  BarChart, Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts'

// OEE formal por maquina y turno.
//   Disponibilidad = (Tiempo programado - Paros) / Tiempo programado
//   Desempeno      = Minutos ideales / Tiempo operativo
//   Calidad        = Piezas OK / Piezas totales
//   OEE            = Disponibilidad x Desempeno x Calidad
// El tiempo programado sale del calendario laboral del MRP cruzado con los
// turnos activos. El ciclo ideal por pieza es el ciclo del disparo de la ruta
// dividido entre las cavidades del molde. La funcion oee_detalle devuelve los
// COMPONENTES por maquina/fecha/turno; aqui se suman y hasta el final se
// dividen, que es la unica forma correcta de agregar un OEE.

const fmt = (n) => (Number(n) || 0).toLocaleString('es-MX')
const fmt1 = (n) => (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const pct = (n) => (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'
const hoyISO = () => new Date().toISOString().slice(0, 10)

const CATS = [
  { k: 'min_falla', label: 'Fallas y averias', color: '#dc2626' },
  { k: 'min_setup', label: 'Cambio de molde / setup', color: '#f59e0b' },
  { k: 'min_espera', label: 'Esperas (material / personal)', color: '#3b82f6' },
  { k: 'min_calidad_paro', label: 'Paros por calidad', color: '#a855f7' },
]

const COMPONENTES = ['min_calendario', 'min_planeado', 'min_programados', 'min_falla', 'min_setup',
  'min_espera', 'min_calidad_paro', 'min_paro', 'min_operativo', 'min_ideales', 'piezas_ok', 'piezas_scrap']

// lunes de la semana ISO a la que pertenece la fecha
const lunesDe = (iso) => {
  const d = new Date(iso + 'T00:00:00')
  const dow = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - dow)
  return d.toISOString().slice(0, 10)
}

const rango = (periodo, ini, fin) => {
  const h = new Date()
  if (periodo === 'hoy') return [hoyISO(), hoyISO()]
  if (periodo === 'semana') {
    const l = new Date(h); l.setDate(h.getDate() - ((h.getDay() + 6) % 7))
    return [l.toISOString().slice(0, 10), hoyISO()]
  }
  if (periodo === 'mes') {
    return [new Date(h.getFullYear(), h.getMonth(), 1).toISOString().slice(0, 10), hoyISO()]
  }
  return [ini, fin]
}

export default function OEE() {
  const { perfil, tienePermiso } = useAuth()
  const emp = perfil.empresa_id
  const puedeConfig = tienePermiso('prod_oee', 'editar')

  const [periodo, setPeriodo] = useState('semana')
  const [ini, setIni] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 29); return d.toISOString().slice(0, 10) })
  const [fin, setFin] = useState(hoyISO())
  const [site, setSite] = useState('')
  const [base, setBase] = useState('')
  const [agrup, setAgrup] = useState('dia')

  const [filas, setFilas] = useState([])
  const [param, setParam] = useState(null)
  const [causas, setCausas] = useState([])
  const [empresa, setEmpresa] = useState(null)
  const [sitesCat, setSitesCat] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [verConfig, setVerConfig] = useState(false)

  useEffect(() => {
    supabase.from('empresas').select('*').eq('id', emp).maybeSingle().then(({ data }) => setEmpresa(data || null))
    supabase.from('sites').select('id, nombre, codigo').eq('empresa_id', emp).then(({ data }) => setSitesCat(data || []))
  }, [emp])

  useEffect(() => { cargar() }, [periodo, ini, fin, site, base])

  const cargar = async () => {
    setLoading(true); setError('')
    const [d, h] = rango(periodo, ini, fin)
    if (!d || !h) { setLoading(false); return }
    const sid = siteEfectivo(perfil, site)
    const [res, par, cau] = await Promise.all([
      supabase.rpc('oee_detalle', {
        p_empresa_id: emp, p_desde: d, p_hasta: h,
        p_site_id: sid || null, p_base: base || null,
      }),
      supabase.from('oee_parametros').select('*').eq('empresa_id', emp).maybeSingle(),
      supabase.from('causas_paro').select('*').eq('empresa_id', emp).order('clave'),
    ])
    setLoading(false)
    if (res.error) { setError('No se pudo calcular el OEE: ' + res.error.message); setFilas([]); return }
    setFilas(res.data || [])
    setParam(par.data || null)
    setCausas(cau.data || [])
  }

  // ---------- Agregacion: sumar componentes, dividir al final ----------
  const vacio = () => Object.fromEntries(COMPONENTES.map(k => [k, 0]))
  const acumular = (dest, r) => { COMPONENTES.forEach(k => { dest[k] += Number(r[k]) || 0 }); return dest }

  const total = filas.reduce((a, r) => acumular(a, r), vacio())

  const ind = (t) => {
    const disp = t.min_programados > 0 ? t.min_operativo / t.min_programados : 0
    const desem = t.min_operativo > 0 ? t.min_ideales / t.min_operativo : 0
    const piezas = t.piezas_ok + t.piezas_scrap
    const cal = piezas > 0 ? t.piezas_ok / piezas : 0
    return { disp: disp * 100, desem: desem * 100, cal: cal * 100, oee: disp * desem * cal * 100 }
  }
  const T = ind(total)

  const claveDe = (r) => {
    if (agrup === 'dia') return r.fecha
    if (agrup === 'semana') return lunesDe(r.fecha)
    if (agrup === 'mes') return r.fecha.slice(0, 7)
    if (agrup === 'turno') return r.turno
    return r.maquina
  }
  const etiquetaDe = (k) => {
    if (agrup === 'dia') return new Date(k + 'T00:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
    if (agrup === 'semana') return 'Sem ' + new Date(k + 'T00:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
    if (agrup === 'mes') return new Date(k + '-01T00:00:00').toLocaleDateString('es-MX', { month: 'short', year: '2-digit' })
    return k
  }

  const mapa = new Map()
  filas.forEach(r => {
    const k = claveDe(r)
    if (!mapa.has(k)) mapa.set(k, { k, ...vacio() })
    acumular(mapa.get(k), r)
  })
  const grupos = [...mapa.values()].sort((a, b) => String(a.k).localeCompare(String(b.k)))
    .map(g => ({ ...g, etiqueta: etiquetaDe(g.k), ...ind(g) }))

  const meta = {
    oee: Number(param?.meta_oee ?? 85),
    disp: Number(param?.meta_disponibilidad ?? 90),
    desem: Number(param?.meta_desempeno ?? 95),
    cal: Number(param?.meta_calidad ?? 99),
  }

  // Perdidas ordenadas de mayor a menor: por donde empezar
  const perdidas = CATS.map(c => ({ ...c, min: total[c.k] }))
    .filter(c => c.min > 0).sort((a, b) => b.min - a.min)
  const totalPerdido = perdidas.reduce((s, c) => s + c.min, 0)

  // ---------- Exportar ----------
  const COLS = [
    { label: 'Fecha', get: r => r.fecha },
    { label: 'Turno', get: r => r.turno_nombre || r.turno },
    { label: 'Maquina', get: r => r.maquina },
    { label: 'OT', get: r => r.ots || '' },
    { label: 'Min calendario', get: r => r.min_calendario },
    { label: 'Min planeado', get: r => r.min_planeado },
    { label: 'Min programados', get: r => r.min_programados },
    { label: 'Min falla', get: r => r.min_falla },
    { label: 'Min setup', get: r => r.min_setup },
    { label: 'Min espera', get: r => r.min_espera },
    { label: 'Min calidad', get: r => r.min_calidad_paro },
    { label: 'Min paro total', get: r => r.min_paro },
    { label: 'Min operativo', get: r => r.min_operativo },
    { label: 'Min ideales', get: r => Math.round(r.min_ideales * 10) / 10 },
    { label: 'Piezas OK', get: r => r.piezas_ok },
    { label: 'Piezas scrap', get: r => r.piezas_scrap },
    { label: 'Disponibilidad %', get: r => Math.round(ind(r).disp * 10) / 10 },
    { label: 'Desempeno %', get: r => Math.round(ind(r).desem * 10) / 10 },
    { label: 'Calidad %', get: r => Math.round(ind(r).cal * 10) / 10 },
    { label: 'OEE %', get: r => Math.round(ind(r).oee * 10) / 10 },
  ]
  const [d0, h0] = rango(periodo, ini, fin)
  const periodoLbl = periodo === 'hoy' ? 'Hoy' : periodo === 'semana' ? 'Esta semana'
    : periodo === 'mes' ? 'Este mes' : `${d0} al ${h0}`
  const nombreSite = siteEfectivo(perfil, site)
    ? (sitesCat.find(x => x.id === siteEfectivo(perfil, site))?.nombre || '-') : 'Todos los sites'

  // ---------- Configuracion ----------
  const guardarMetas = async (campo, valor) => {
    const v = Number(valor)
    if (isNaN(v) || v < 0 || v > 100) { setError('La meta debe ser un porcentaje entre 0 y 100'); return }
    setError(''); setExito('')
    const { error: e } = await supabase.from('oee_parametros')
      .upsert({ empresa_id: emp, [campo]: v, updated_at: new Date().toISOString(), updated_by: perfil.id })
    if (e) { setError('No se pudo guardar: ' + e.message); return }
    setParam(p => ({ ...p, [campo]: v })); setExito('Meta actualizada')
  }
  const guardarBase = async (v) => {
    const { error: e } = await supabase.from('oee_parametros')
      .upsert({ empresa_id: emp, base_tiempo: v, updated_at: new Date().toISOString(), updated_by: perfil.id })
    if (e) { setError('No se pudo guardar: ' + e.message); return }
    setParam(p => ({ ...p, base_tiempo: v })); setExito('Base de tiempo actualizada'); cargar()
  }
  const guardarCategoria = async (causaId, cat) => {
    const { error: e } = await supabase.from('causas_paro').update({ categoria_oee: cat }).eq('id', causaId)
    if (e) { setError('No se pudo guardar: ' + e.message); return }
    setCausas(cs => cs.map(c => c.id === causaId ? { ...c, categoria_oee: cat } : c))
    setExito('Clasificacion actualizada'); cargar()
  }

  return (
    <div style={S.wrap}>
      <style>{`
        @media print {
          @page { size: letter landscape; margin: 10mm; }
          .solo-imprimir { display: flex !important; }
          .no-imprimir { display: none !important; }
        }
      `}</style>

      {/* Encabezado que solo sale al imprimir */}
      <div style={S.hojaHead} className="solo-imprimir">
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {empresa?.logo_url && <img src={empresa.logo_url} alt="" style={{ height: '48px', objectFit: 'contain' }} />}
          <div>
            <div style={{ fontSize: '17px', fontWeight: 800, color: '#1a1a2e' }}>{empresa?.nombre || 'SYNTIA'}</div>
            <div style={{ fontSize: '13px', color: '#334155' }}>OEE - Eficiencia General de los Equipos</div>
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: '11.5px', color: '#475569', lineHeight: 1.6 }}>
          <div><b>Site:</b> {nombreSite}</div>
          <div><b>Periodo:</b> {periodoLbl}</div>
          <div><b>Base:</b> {(base || param?.base_tiempo) === 'calendario' ? 'Calendario completo' : 'Solo maquinas programadas'}</div>
          <div><b>Impreso:</b> {new Date().toLocaleString('es-MX')}</div>
        </div>
      </div>

      <div style={S.top} className="no-imprimir">
        <div>
          <h2 style={S.h2}>OEE &mdash; Eficiencia General de los Equipos</h2>
          <p style={S.sub}>Disponibilidad &times; Desempeno &times; Calidad. El tiempo programado sale del calendario laboral del MRP y el ciclo ideal del tiempo de disparo de la ruta entre las cavidades del molde.</p>
        </div>
        {puedeConfig && (
          <button style={S.btnSec} onClick={() => setVerConfig(v => !v)}>
            {verConfig ? 'Cerrar configuracion' : 'Configuracion'}
          </button>
        )}
      </div>

      {/* ---------- Filtros ---------- */}
      <div style={S.filtros} className="no-imprimir">
        {[['hoy', 'Hoy'], ['semana', 'Semana'], ['mes', 'Mes'], ['rango', 'Rango']].map(([id, n]) => (
          <button key={id} style={periodo === id ? S.pAct : S.p} onClick={() => setPeriodo(id)}>{n}</button>
        ))}
        {periodo === 'rango' && (
          <>
            <label style={S.lblIn}>Del</label>
            <input type="date" style={S.date} value={ini} onChange={e => setIni(e.target.value)} />
            <label style={S.lblIn}>al</label>
            <input type="date" style={S.date} value={fin} onChange={e => setFin(e.target.value)} />
          </>
        )}
        <span style={S.sep} />
        <FiltroSite value={site} onChange={setSite} />
        <span style={S.sep} />
        <label style={S.lblIn}>Agrupar por</label>
        <select style={S.sel} value={agrup} onChange={e => setAgrup(e.target.value)}>
          <option value="dia">Dia</option>
          <option value="semana">Semana</option>
          <option value="mes">Mes</option>
          <option value="turno">Turno</option>
          <option value="maquina">Maquina</option>
        </select>
        <label style={S.lblIn}>Base</label>
        <select style={S.sel} value={base} onChange={e => setBase(e.target.value)}>
          <option value="">Segun configuracion ({param?.base_tiempo === 'calendario' ? 'calendario' : 'programadas'})</option>
          <option value="programadas">Solo maquinas programadas</option>
          <option value="calendario">Calendario completo</option>
        </select>
        <div style={{ flex: 1 }} />
        <button style={S.expBtn} onClick={() => exportarExcel(`oee_${d0}_${h0}`, COLS, filas)}>Excel</button>
        <button style={S.expBtn} onClick={() => imprimirTablaPDF(`OEE ${periodoLbl} - ${nombreSite}`, COLS, filas)}>PDF</button>
        <button style={S.expBtn} onClick={() => window.print()}>Imprimir vista</button>
      </div>

      {error && <p style={S.err} className="no-imprimir">{error}</p>}
      {exito && <p style={S.ok} className="no-imprimir">{exito}</p>}

      {/* ---------- Configuracion ---------- */}
      {verConfig && puedeConfig && (
        <div style={S.card} className="no-imprimir">
          <p style={S.cardTit}>Configuracion del OEE</p>

          <p style={S.subTit}>Base del tiempo programado</p>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '6px' }}>
            <button style={(param?.base_tiempo || 'programadas') === 'programadas' ? S.optAct : S.opt}
              onClick={() => guardarBase('programadas')}>Solo maquinas programadas</button>
            <button style={param?.base_tiempo === 'calendario' ? S.optAct : S.opt}
              onClick={() => guardarBase('calendario')}>Calendario completo</button>
          </div>
          <p style={S.ayuda}>
            <b>Solo programadas</b> mide el OEE contra los turnos en que la maquina tenia OT: es el indicador estandar.
            <b> Calendario completo</b> incluye todos los turnos habiles aunque la maquina no tuviera programa, asi que
            tambien castiga la falta de carga. Sirve para decidir si sobra o falta capacidad.
          </p>

          <p style={S.subTit}>Metas</p>
          <div style={S.metasRow}>
            {[['meta_oee', 'OEE'], ['meta_disponibilidad', 'Disponibilidad'], ['meta_desempeno', 'Desempeno'], ['meta_calidad', 'Calidad']].map(([c, n]) => (
              <span key={c} style={S.metaIn}>
                <label style={S.lblIn}>{n} %</label>
                <input type="number" min="0" max="100" step="0.1" style={S.num}
                  defaultValue={param?.[c] ?? ''}
                  onBlur={e => guardarMetas(c, e.target.value)} />
              </span>
            ))}
          </div>

          <p style={S.subTit}>Clasificacion de las causas de paro</p>
          <p style={S.ayuda}>
            Las causas marcadas como <b>planeado</b> se descuentan del tiempo programado en vez de castigar el OEE
            (es el caso del mantenimiento preventivo). Todas las demas cuentan como perdida de disponibilidad.
          </p>
          <table style={S.tabla}>
            <thead><tr><th style={S.th}>Clave</th><th style={S.th}>Causa</th><th style={S.th}>Categoria OEE</th></tr></thead>
            <tbody>
              {causas.map(c => (
                <tr key={c.id}>
                  <td style={S.td}>{c.clave}</td>
                  <td style={S.td}>{c.nombre}</td>
                  <td style={S.td}>
                    <select style={S.sel} value={c.categoria_oee || 'falla'} onChange={e => guardarCategoria(c.id, e.target.value)}>
                      <option value="falla">Falla / averia</option>
                      <option value="setup">Cambio de molde / setup</option>
                      <option value="espera">Espera (material, personal)</option>
                      <option value="calidad">Paro por calidad</option>
                      <option value="planeado">Planeado (no castiga el OEE)</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loading && <p style={S.info}>Calculando...</p>}

      {!loading && filas.length === 0 && (
        <div style={S.card}>
          <p style={S.vacio}>
            No hay turnos que medir en este periodo. Revisa que existan OT programadas en el rango,
            que el calendario laboral del MRP marque esos dias como habiles, y que las rutas de fabricacion
            tengan capturado el tiempo estandar (sin el no se puede calcular el desempeno).
          </p>
        </div>
      )}

      {!loading && filas.length > 0 && (
        <>
          {/* ---------- KPIs ---------- */}
          <div style={S.kpis}>
            <Kpi grande titulo="OEE" valor={T.oee} meta={meta.oee} />
            <Kpi titulo="Disponibilidad" valor={T.disp} meta={meta.disp}
              pie={`${fmt1(total.min_operativo)} de ${fmt1(total.min_programados)} min`} />
            <Kpi titulo="Desempeno" valor={T.desem} meta={meta.desem}
              pie={`${fmt1(total.min_ideales)} min ideales`} />
            <Kpi titulo="Calidad" valor={T.cal} meta={meta.cal}
              pie={`${fmt(total.piezas_ok)} OK / ${fmt(total.piezas_scrap)} scrap`} />
          </div>

          {/* ---------- Tendencia ---------- */}
          <div style={S.card}>
            <p style={S.cardTit}>OEE y sus componentes por {agrup === 'dia' ? 'dia' : agrup === 'semana' ? 'semana' : agrup === 'mes' ? 'mes' : agrup}</p>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={grupos}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="etiqueta" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                <Tooltip formatter={(v) => pct(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={meta.oee} stroke="#16a34a" strokeDasharray="4 4"
                  label={{ value: `Meta ${meta.oee}%`, fontSize: 11, fill: '#16a34a', position: 'right' }} />
                <Bar dataKey="oee" name="OEE" fill="#c2410c" radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="disp" name="Disponibilidad" stroke="#2563eb" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="desem" name="Desempeno" stroke="#7c3aed" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="cal" name="Calidad" stroke="#16a34a" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* ---------- Perdidas ---------- */}
          <div style={S.dosCol}>
            <div style={{ ...S.card, flex: 1, minWidth: '330px' }}>
              <p style={S.cardTit}>Donde se pierde el tiempo</p>
              {perdidas.length === 0 && <p style={S.vacio}>No hay paros registrados en el periodo.</p>}
              {perdidas.map(c => (
                <div key={c.k} style={{ marginBottom: '11px' }}>
                  <div style={S.perdTop}>
                    <span style={{ fontSize: '13px', color: '#334155' }}>{c.label}</span>
                    <span style={{ fontSize: '13px', color: '#1a1a2e', fontWeight: 600 }}>
                      {fmt1(c.min)} min &middot; {pct(totalPerdido > 0 ? 100 * c.min / totalPerdido : 0)}
                    </span>
                  </div>
                  <div style={S.barBg}>
                    <div style={{ ...S.barFill, width: `${totalPerdido > 0 ? 100 * c.min / totalPerdido : 0}%`, background: c.color }} />
                  </div>
                </div>
              ))}
              {total.min_planeado > 0 && (
                <p style={S.ayuda}>
                  Ademas se descontaron <b>{fmt1(total.min_planeado)} min</b> de paro planeado
                  (mantenimiento preventivo), que no castigan el OEE.
                </p>
              )}
            </div>

            <div style={{ ...S.card, flex: 1, minWidth: '330px' }}>
              <p style={S.cardTit}>Minutos por {agrup === 'maquina' ? 'maquina' : agrup}</p>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={grupos}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="etiqueta" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => fmt1(v) + ' min'} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {CATS.map(c => (
                    <Bar key={c.k} dataKey={c.k} name={c.label} stackId="p" fill={c.color} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ---------- Tabla agrupada ---------- */}
          <div style={S.card}>
            <p style={S.cardTit}>Resumen por {agrup}</p>
            <table style={S.tabla}>
              <thead>
                <tr>
                  <th style={S.th}>{agrup === 'maquina' ? 'Maquina' : agrup === 'turno' ? 'Turno' : 'Periodo'}</th>
                  <th style={S.thR}>Min programados</th>
                  <th style={S.thR}>Min paro</th>
                  <th style={S.thR}>Min operativo</th>
                  <th style={S.thR}>Piezas OK</th>
                  <th style={S.thR}>Scrap</th>
                  <th style={S.thR}>Disp.</th>
                  <th style={S.thR}>Desemp.</th>
                  <th style={S.thR}>Calidad</th>
                  <th style={S.thR}>OEE</th>
                </tr>
              </thead>
              <tbody>
                {grupos.map(g => (
                  <tr key={g.k}>
                    <td style={S.td}>{g.etiqueta}</td>
                    <td style={S.tdR}>{fmt1(g.min_programados)}</td>
                    <td style={S.tdR}>{fmt1(g.min_paro)}</td>
                    <td style={S.tdR}>{fmt1(g.min_operativo)}</td>
                    <td style={S.tdR}>{fmt(g.piezas_ok)}</td>
                    <td style={S.tdR}>{fmt(g.piezas_scrap)}</td>
                    <td style={S.tdR}>{pct(g.disp)}</td>
                    <td style={S.tdR}>{pct(g.desem)}</td>
                    <td style={S.tdR}>{pct(g.cal)}</td>
                    <td style={{ ...S.tdR, fontWeight: 700, color: g.oee >= meta.oee ? '#15803d' : g.oee >= meta.oee * 0.85 ? '#b45309' : '#b91c1c' }}>
                      {pct(g.oee)}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td style={{ ...S.td, fontWeight: 700 }}>Total</td>
                  <td style={{ ...S.tdR, fontWeight: 700 }}>{fmt1(total.min_programados)}</td>
                  <td style={{ ...S.tdR, fontWeight: 700 }}>{fmt1(total.min_paro)}</td>
                  <td style={{ ...S.tdR, fontWeight: 700 }}>{fmt1(total.min_operativo)}</td>
                  <td style={{ ...S.tdR, fontWeight: 700 }}>{fmt(total.piezas_ok)}</td>
                  <td style={{ ...S.tdR, fontWeight: 700 }}>{fmt(total.piezas_scrap)}</td>
                  <td style={{ ...S.tdR, fontWeight: 700 }}>{pct(T.disp)}</td>
                  <td style={{ ...S.tdR, fontWeight: 700 }}>{pct(T.desem)}</td>
                  <td style={{ ...S.tdR, fontWeight: 700 }}>{pct(T.cal)}</td>
                  <td style={{ ...S.tdR, fontWeight: 800 }}>{pct(T.oee)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ---------- Detalle maquina / turno ---------- */}
          <div style={S.card}>
            <p style={S.cardTit}>Detalle por maquina y turno &middot; {filas.length} registro(s)</p>
            <div style={{ overflowX: 'auto' }}>
              <table style={S.tabla}>
                <thead>
                  <tr>
                    <th style={S.th}>Fecha</th><th style={S.th}>Turno</th><th style={S.th}>Maquina</th><th style={S.th}>OT</th>
                    <th style={S.thR}>Prog.</th><th style={S.thR}>Falla</th><th style={S.thR}>Setup</th>
                    <th style={S.thR}>Espera</th><th style={S.thR}>Calidad</th><th style={S.thR}>Operativo</th>
                    <th style={S.thR}>Ideales</th><th style={S.thR}>OK</th><th style={S.thR}>Scrap</th><th style={S.thR}>OEE</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((r, i) => {
                    const k = ind(r)
                    return (
                      <tr key={i}>
                        <td style={S.td}>{r.fecha}</td>
                        <td style={S.td}>{r.turno_nombre || r.turno}</td>
                        <td style={S.td}>{r.maquina}</td>
                        <td style={S.td}>{r.ots || '-'}</td>
                        <td style={S.tdR}>{fmt1(r.min_programados)}</td>
                        <td style={S.tdR}>{r.min_falla > 0 ? fmt1(r.min_falla) : '-'}</td>
                        <td style={S.tdR}>{r.min_setup > 0 ? fmt1(r.min_setup) : '-'}</td>
                        <td style={S.tdR}>{r.min_espera > 0 ? fmt1(r.min_espera) : '-'}</td>
                        <td style={S.tdR}>{r.min_calidad_paro > 0 ? fmt1(r.min_calidad_paro) : '-'}</td>
                        <td style={S.tdR}>{fmt1(r.min_operativo)}</td>
                        <td style={S.tdR}>{fmt1(r.min_ideales)}</td>
                        <td style={S.tdR}>{fmt(r.piezas_ok)}</td>
                        <td style={S.tdR}>{fmt(r.piezas_scrap)}</td>
                        <td style={{ ...S.tdR, fontWeight: 600, color: k.oee >= meta.oee ? '#15803d' : k.oee >= meta.oee * 0.85 ? '#b45309' : '#b91c1c' }}>
                          {pct(k.oee)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Kpi({ titulo, valor, meta, pie, grande }) {
  const v = Number(valor) || 0
  const color = v >= meta ? '#15803d' : v >= meta * 0.85 ? '#b45309' : '#b91c1c'
  return (
    <div style={{ ...S.kpi, ...(grande ? S.kpiGrande : {}) }}>
      <span style={S.kpiTit}>{titulo}</span>
      <b style={{ ...S.kpiVal, color, fontSize: grande ? '40px' : '28px' }}>{pct(v)}</b>
      <span style={S.kpiMeta}>Meta {meta}%</span>
      {pie && <span style={S.kpiPie}>{pie}</span>}
    </div>
  )
}

const S = {
  wrap: { padding: '24px 28px' },
  hojaHead: { display: 'none', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #1a1a2e', paddingBottom: '10px', marginBottom: '14px' },
  top: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' },
  h2: { fontSize: '20px', color: '#1a1a2e', margin: 0 },
  sub: { color: '#64748b', fontSize: '13px', margin: '4px 0 0', maxWidth: '820px', lineHeight: 1.5 },
  filtros: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '14px' },
  p: { padding: '8px 15px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  pAct: { padding: '8px 15px', background: '#c2410c', color: '#fff', border: '1px solid #c2410c', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', fontWeight: 500 },
  sep: { width: '1px', height: '22px', background: '#e2e8f0' },
  lblIn: { fontSize: '12px', color: '#444', fontWeight: 500 },
  date: { padding: '7px 10px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '13px', outline: 'none' },
  sel: { padding: '7px 10px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '13px', outline: 'none', background: '#fff' },
  num: { padding: '7px 10px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '13px', outline: 'none', width: '90px' },
  expBtn: { padding: '8px 14px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  btnSec: { padding: '9px 16px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '8px', fontSize: '13.5px', cursor: 'pointer' },
  opt: { padding: '8px 15px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  optAct: { padding: '8px 15px', background: '#1e293b', color: '#fff', border: '1px solid #1e293b', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  err: { color: '#b91c1c', fontSize: '13px', margin: '0 0 10px' },
  ok: { color: '#15803d', fontSize: '13px', margin: '0 0 10px' },
  info: { color: '#64748b', fontSize: '13px' },
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', marginBottom: '14px' },
  cardTit: { fontSize: '14px', fontWeight: 600, color: '#1a1a2e', margin: '0 0 12px' },
  subTit: { fontSize: '12.5px', fontWeight: 600, color: '#334155', margin: '16px 0 7px' },
  ayuda: { fontSize: '12px', color: '#64748b', lineHeight: 1.55, margin: '6px 0 0' },
  vacio: { color: '#64748b', fontSize: '13.5px', margin: 0, lineHeight: 1.55 },
  metasRow: { display: 'flex', gap: '16px', flexWrap: 'wrap' },
  metaIn: { display: 'flex', flexDirection: 'column', gap: '4px' },
  kpis: { display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' },
  kpi: { flex: 1, minWidth: '180px', display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 18px' },
  kpiGrande: { minWidth: '220px', background: '#fffbeb', borderColor: '#fcd34d' },
  kpiTit: { fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 },
  kpiVal: { lineHeight: 1.15, margin: '4px 0 2px' },
  kpiMeta: { fontSize: '11.5px', color: '#94a3b8' },
  kpiPie: { fontSize: '11.5px', color: '#64748b', marginTop: '3px' },
  dosCol: { display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'flex-start' },
  perdTop: { display: 'flex', justifyContent: 'space-between', marginBottom: '4px' },
  barBg: { width: '100%', height: '9px', background: '#f1f5f9', borderRadius: '20px', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: '20px' },
  tabla: { width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' },
  th: { textAlign: 'left', padding: '8px 9px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' },
  thR: { textAlign: 'right', padding: '8px 9px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' },
  td: { padding: '7px 9px', borderBottom: '1px solid #f1f5f9', color: '#1a1a2e' },
  tdR: { padding: '7px 9px', borderBottom: '1px solid #f1f5f9', color: '#1a1a2e', textAlign: 'right', whiteSpace: 'nowrap' },
}

