import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { exportarExcel, imprimirTablaPDF } from '../../lib/exportar'
import { useAuth } from '../../context/AuthContext'
import FiltroSite from '../../components/FiltroSite'
import { siteEfectivo } from '../../lib/sites'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell,
} from 'recharts'

// Costeo real vs estandar por OT.
//   Estandar ganado = piezas OK x costo estandar unitario (material de la BOM
//                     explotada + mano de obra y overhead del ciclo de la ruta)
//   Real            = consumo real de MP valuado + horas hombre y maquina reales
//   Variacion       = Real - Estandar, desglosada en material, MO y overhead
// Las horas reales de maquina son el mismo tiempo operativo que usa el OEE,
// repartido entre las OT del turno segun las piezas que produjo cada una, de
// modo que costeo y OEE siempre reconcilian.

const fmt = (n) => (Number(n) || 0).toLocaleString('es-MX')
const din = (n) => '$' + (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const din4 = (n) => '$' + (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
const pct = (n) => (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'
const hoyISO = () => new Date().toISOString().slice(0, 10)

const rango = (periodo, ini, fin) => {
  const h = new Date()
  if (periodo === 'hoy') return [hoyISO(), hoyISO()]
  if (periodo === 'semana') {
    const l = new Date(h); l.setDate(h.getDate() - ((h.getDay() + 6) % 7))
    return [l.toISOString().slice(0, 10), hoyISO()]
  }
  if (periodo === 'mes') return [new Date(h.getFullYear(), h.getMonth(), 1).toISOString().slice(0, 10), hoyISO()]
  return [ini, fin]
}

export default function CosteoProduccion() {
  const { perfil, tienePermiso } = useAuth()
  const emp = perfil.empresa_id
  const puedeConfig = tienePermiso('dir_costeo_prod', 'editar')

  const [periodo, setPeriodo] = useState('mes')
  const [ini, setIni] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 29); return d.toISOString().slice(0, 10) })
  const [fin, setFin] = useState(hoyISO())
  const [site, setSite] = useState('')
  const [agrup, setAgrup] = useState('ot')

  const [filas, setFilas] = useState([])
  const [param, setParam] = useState(null)
  const [maquinas, setMaquinas] = useState([])
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

  useEffect(() => { cargar() }, [periodo, ini, fin, site])

  const cargar = async () => {
    setLoading(true); setError('')
    const [d, h] = rango(periodo, ini, fin)
    if (!d || !h) { setLoading(false); return }
    const sid = siteEfectivo(perfil, site)
    const [res, par, maq] = await Promise.all([
      supabase.rpc('costeo_ot', { p_empresa_id: emp, p_desde: d, p_hasta: h, p_site_id: sid || null }),
      supabase.from('costeo_prod_parametros').select('*').eq('empresa_id', emp).maybeSingle(),
      supabase.from('maquinas').select('id, clave, nombre, tipo, tonelaje, costo_hora_hombre, costo_hora_maquina')
        .eq('empresa_id', emp).eq('activo', true).order('clave'),
    ])
    setLoading(false)
    if (res.error) { setError('No se pudo calcular el costeo: ' + res.error.message); setFilas([]); return }
    setFilas(res.data || [])
    setParam(par.data || null)
    setMaquinas(maq.data || [])
  }

  // ---------- Agregacion ----------
  const CAMPOS = ['piezas_ok', 'piezas_scrap', 'min_maquina_real', 'min_maquina_std',
    'min_hombre_real', 'min_hombre_std', 'material_real', 'material_std',
    'mo_real', 'mo_std', 'oh_real', 'oh_std', 'costo_real', 'costo_std']
  const cero = () => Object.fromEntries(CAMPOS.map(k => [k, 0]))
  const sumar = (d, r) => { CAMPOS.forEach(k => { d[k] += Number(r[k]) || 0 }); return d }

  const total = filas.reduce((a, r) => sumar(a, r), cero())
  const varTotal = total.costo_real - total.costo_std
  const varPct = total.costo_std > 0 ? 100 * varTotal / total.costo_std : 0

  const claveDe = (r) => agrup === 'ot' ? r.ot_folio
    : agrup === 'articulo' ? r.articulo_codigo
      : agrup === 'maquina' ? (r.maquina || 'Sin maquina')
        : r.fecha
  const mapa = new Map()
  filas.forEach(r => {
    const k = claveDe(r)
    if (!mapa.has(k)) mapa.set(k, { k, desc: r.articulo_desc, ...cero() })
    sumar(mapa.get(k), r)
  })
  const grupos = [...mapa.values()]
    .map(g => ({ ...g, variacion: g.costo_real - g.costo_std }))
    .sort((a, b) => b.variacion - a.variacion)

  // Las 3 variaciones clasicas: material, eficiencia (MO) y tasa (overhead)
  const variaciones = [
    { k: 'Material', real: total.material_real, std: total.material_std, color: '#dc2626' },
    { k: 'Mano de obra', real: total.mo_real, std: total.mo_std, color: '#f59e0b' },
    { k: 'Overhead', real: total.oh_real, std: total.oh_std, color: '#7c3aed' },
  ].map(v => ({ ...v, dif: v.real - v.std, pct: v.std > 0 ? 100 * (v.real - v.std) / v.std : 0 }))

  const [d0, h0] = rango(periodo, ini, fin)
  const periodoLbl = periodo === 'hoy' ? 'Hoy' : periodo === 'semana' ? 'Esta semana'
    : periodo === 'mes' ? 'Este mes' : `${d0} al ${h0}`
  const nombreSite = siteEfectivo(perfil, site)
    ? (sitesCat.find(x => x.id === siteEfectivo(perfil, site))?.nombre || '-') : 'Todos los sites'

  const COLS = [
    { label: 'Fecha', get: r => r.fecha },
    { label: 'OT', get: r => r.ot_folio },
    { label: 'Articulo', get: r => r.articulo_codigo },
    { label: 'Descripcion', get: r => r.articulo_desc },
    { label: 'Maquina', get: r => r.maquina || '' },
    { label: 'Molde', get: r => r.molde || '' },
    { label: 'Piezas OK', get: r => r.piezas_ok },
    { label: 'Scrap', get: r => r.piezas_scrap },
    { label: 'Min maquina real', get: r => r.min_maquina_real },
    { label: 'Min maquina std', get: r => r.min_maquina_std },
    { label: 'Min hombre real', get: r => r.min_hombre_real },
    { label: 'Min hombre std', get: r => r.min_hombre_std },
    { label: 'Material real', get: r => r.material_real },
    { label: 'Material std', get: r => r.material_std },
    { label: 'MO real', get: r => r.mo_real },
    { label: 'MO std', get: r => r.mo_std },
    { label: 'Overhead real', get: r => r.oh_real },
    { label: 'Overhead std', get: r => r.oh_std },
    { label: 'Costo real', get: r => r.costo_real },
    { label: 'Costo std', get: r => r.costo_std },
    { label: 'Variacion', get: r => Math.round((r.costo_real - r.costo_std) * 100) / 100 },
    { label: 'Costo unit real', get: r => r.costo_unit_real },
    { label: 'Costo unit std', get: r => r.costo_unit_std },
    { label: 'Precio venta', get: r => r.precio_venta },
    { label: 'Margen unit', get: r => Math.round(((r.precio_venta || 0) - (r.costo_unit_real || 0)) * 10000) / 10000 },
  ]

  // ---------- Configuracion ----------
  const guardarDefault = async (campo, valor) => {
    const v = Number(valor)
    if (isNaN(v) || v < 0) { setError('La tarifa debe ser un numero positivo'); return }
    setError(''); setExito('')
    const { error: e } = await supabase.from('costeo_prod_parametros')
      .upsert({ empresa_id: emp, [campo]: v, updated_at: new Date().toISOString(), updated_by: perfil.id })
    if (e) { setError('No se pudo guardar: ' + e.message); return }
    setParam(p => ({ ...p, [campo]: v })); setExito('Tarifa base actualizada'); cargar()
  }
  const guardarTarifaMaq = async (id, campo, valor) => {
    const v = Number(valor)
    if (isNaN(v) || v < 0) { setError('La tarifa debe ser un numero positivo'); return }
    setError(''); setExito('')
    const { error: e } = await supabase.from('maquinas').update({ [campo]: v }).eq('id', id)
    if (e) { setError('No se pudo guardar: ' + e.message); return }
    setMaquinas(ms => ms.map(m => m.id === id ? { ...m, [campo]: v } : m))
    setExito('Tarifa actualizada'); cargar()
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

      <div style={S.hojaHead} className="solo-imprimir">
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {empresa?.logo_url && <img src={empresa.logo_url} alt="" style={{ height: '48px', objectFit: 'contain' }} />}
          <div>
            <div style={{ fontSize: '17px', fontWeight: 800, color: '#1a1a2e' }}>{empresa?.nombre || 'SYNTIA'}</div>
            <div style={{ fontSize: '13px', color: '#334155' }}>Costeo Real vs Estandar</div>
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: '11.5px', color: '#475569', lineHeight: 1.6 }}>
          <div><b>Site:</b> {nombreSite}</div>
          <div><b>Periodo:</b> {periodoLbl}</div>
          <div><b>Impreso:</b> {new Date().toLocaleString('es-MX')}</div>
        </div>
      </div>

      <div style={S.top} className="no-imprimir">
        <div>
          <h2 style={S.h2}>Costeo Real vs Estandar</h2>
          <p style={S.sub}>El estandar se arma solo con la BOM explotada y el ciclo de la ruta. El real usa el consumo de materia prima capturado y el mismo tiempo operativo que mide el OEE, repartido entre las OT del turno.</p>
        </div>
        {puedeConfig && (
          <button style={S.btnSec} onClick={() => setVerConfig(v => !v)}>
            {verConfig ? 'Cerrar tarifas' : 'Tarifas'}
          </button>
        )}
      </div>

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
          <option value="ot">Orden de trabajo</option>
          <option value="articulo">Articulo</option>
          <option value="maquina">Maquina</option>
          <option value="fecha">Fecha</option>
        </select>
        <div style={{ flex: 1 }} />
        <button style={S.expBtn} onClick={() => exportarExcel(`costeo_${d0}_${h0}`, COLS, filas)}>Excel</button>
        <button style={S.expBtn} onClick={() => imprimirTablaPDF(`Costeo real vs estandar ${periodoLbl} - ${nombreSite}`, COLS, filas)}>PDF</button>
        <button style={S.expBtn} onClick={() => window.print()}>Imprimir vista</button>
      </div>

      {error && <p style={S.err} className="no-imprimir">{error}</p>}
      {exito && <p style={S.ok} className="no-imprimir">{exito}</p>}

      {/* ---------- Tarifas ---------- */}
      {verConfig && puedeConfig && (
        <div style={S.card} className="no-imprimir">
          <p style={S.cardTit}>Tarifas de mano de obra y overhead</p>
          <p style={S.ayuda}>
            Cada maquina puede tener su propia tarifa por hora. Si la dejas en cero, se usa la tarifa base de planta.
            La mano de obra se multiplica ademas por el personal que pide la ruta de esa operacion.
          </p>

          <p style={S.subTit}>Tarifa base de planta ({param?.moneda || 'MXN'} por hora)</p>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <span style={S.metaIn}>
              <label style={S.lblIn}>Hora-hombre</label>
              <input type="number" min="0" step="0.01" style={S.num}
                defaultValue={param?.costo_hora_hombre_default ?? ''}
                onBlur={e => guardarDefault('costo_hora_hombre_default', e.target.value)} />
            </span>
            <span style={S.metaIn}>
              <label style={S.lblIn}>Hora-maquina</label>
              <input type="number" min="0" step="0.01" style={S.num}
                defaultValue={param?.costo_hora_maquina_default ?? ''}
                onBlur={e => guardarDefault('costo_hora_maquina_default', e.target.value)} />
            </span>
          </div>

          <p style={S.subTit}>Por maquina</p>
          <table style={S.tabla}>
            <thead>
              <tr>
                <th style={S.th}>Clave</th><th style={S.th}>Maquina</th><th style={S.th}>Tipo</th>
                <th style={S.thR}>Tonelaje</th><th style={S.thR}>Hora-hombre</th><th style={S.thR}>Hora-maquina</th>
              </tr>
            </thead>
            <tbody>
              {maquinas.map(m => (
                <tr key={m.id}>
                  <td style={S.td}>{m.clave}</td>
                  <td style={S.td}>{m.nombre}</td>
                  <td style={S.td}>{m.tipo}</td>
                  <td style={S.tdR}>{m.tonelaje || '-'}</td>
                  <td style={S.tdR}>
                    <input type="number" min="0" step="0.01" style={S.numMini}
                      defaultValue={m.costo_hora_hombre ?? 0}
                      onBlur={e => guardarTarifaMaq(m.id, 'costo_hora_hombre', e.target.value)} />
                  </td>
                  <td style={S.tdR}>
                    <input type="number" min="0" step="0.01" style={S.numMini}
                      defaultValue={m.costo_hora_maquina ?? 0}
                      onBlur={e => guardarTarifaMaq(m.id, 'costo_hora_maquina', e.target.value)} />
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
            No hay OT con produccion reportada en este periodo. Para que el costeo salga completo se necesitan
            tres cosas: la BOM del articulo con el costo de sus componentes, la ruta con el tiempo estandar,
            y las tarifas por hora capturadas en el boton Tarifas.
          </p>
        </div>
      )}

      {!loading && filas.length > 0 && (
        <>
          {/* ---------- Resumen ---------- */}
          <div style={S.kpis}>
            <div style={S.kpi}>
              <span style={S.kpiTit}>Costo real</span>
              <b style={{ ...S.kpiVal, color: '#1a1a2e' }}>{din(total.costo_real)}</b>
              <span style={S.kpiPie}>{fmt(total.piezas_ok)} pz OK</span>
            </div>
            <div style={S.kpi}>
              <span style={S.kpiTit}>Costo estandar ganado</span>
              <b style={{ ...S.kpiVal, color: '#1a1a2e' }}>{din(total.costo_std)}</b>
              <span style={S.kpiPie}>piezas OK x estandar unitario</span>
            </div>
            <div style={{ ...S.kpi, background: varTotal > 0 ? '#fef2f2' : '#f0fdf4', borderColor: varTotal > 0 ? '#fca5a5' : '#86efac' }}>
              <span style={S.kpiTit}>Variacion</span>
              <b style={{ ...S.kpiVal, color: varTotal > 0 ? '#b91c1c' : '#15803d' }}>
                {varTotal > 0 ? '+' : ''}{din(varTotal)}
              </b>
              <span style={S.kpiPie}>{varTotal > 0 ? 'Costo por arriba' : 'Ahorro'} &middot; {pct(varPct)}</span>
            </div>
            <div style={S.kpi}>
              <span style={S.kpiTit}>Costo unitario real</span>
              <b style={{ ...S.kpiVal, color: '#1a1a2e' }}>
                {din4(total.piezas_ok > 0 ? total.costo_real / total.piezas_ok : 0)}
              </b>
              <span style={S.kpiPie}>
                estandar {din4(total.piezas_ok > 0 ? total.costo_std / total.piezas_ok : 0)}
              </span>
            </div>
            <div style={S.kpi}>
              <span style={S.kpiTit}>Scrap del periodo</span>
              <b style={{ ...S.kpiVal, color: total.piezas_scrap > 0 ? '#b45309' : '#15803d' }}>{fmt(total.piezas_scrap)}</b>
              <span style={S.kpiPie}>
                {pct(total.piezas_ok + total.piezas_scrap > 0 ? 100 * total.piezas_scrap / (total.piezas_ok + total.piezas_scrap) : 0)} del total
              </span>
            </div>
          </div>

          {/* ---------- Variacion por concepto ---------- */}
          <div style={S.card}>
            <p style={S.cardTit}>De donde viene la variacion</p>
            <table style={S.tabla}>
              <thead>
                <tr>
                  <th style={S.th}>Concepto</th>
                  <th style={S.thR}>Real</th><th style={S.thR}>Estandar</th>
                  <th style={S.thR}>Variacion</th><th style={S.thR}>%</th>
                  <th style={S.th}></th>
                </tr>
              </thead>
              <tbody>
                {variaciones.map(v => (
                  <tr key={v.k}>
                    <td style={S.td}>{v.k}</td>
                    <td style={S.tdR}>{din(v.real)}</td>
                    <td style={S.tdR}>{din(v.std)}</td>
                    <td style={{ ...S.tdR, color: v.dif > 0 ? '#b91c1c' : '#15803d', fontWeight: 600 }}>
                      {v.dif > 0 ? '+' : ''}{din(v.dif)}
                    </td>
                    <td style={{ ...S.tdR, color: v.dif > 0 ? '#b91c1c' : '#15803d' }}>
                      {v.dif > 0 ? '+' : ''}{pct(v.pct)}
                    </td>
                    <td style={{ ...S.td, width: '34%' }}>
                      <div style={S.barBg}>
                        <div style={{
                          ...S.barFill,
                          width: `${Math.min(Math.abs(v.pct), 100)}%`,
                          background: v.dif > 0 ? '#dc2626' : '#16a34a',
                        }} />
                      </div>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td style={{ ...S.td, fontWeight: 700 }}>Total</td>
                  <td style={{ ...S.tdR, fontWeight: 700 }}>{din(total.costo_real)}</td>
                  <td style={{ ...S.tdR, fontWeight: 700 }}>{din(total.costo_std)}</td>
                  <td style={{ ...S.tdR, fontWeight: 700, color: varTotal > 0 ? '#b91c1c' : '#15803d' }}>
                    {varTotal > 0 ? '+' : ''}{din(varTotal)}
                  </td>
                  <td style={{ ...S.tdR, fontWeight: 700, color: varTotal > 0 ? '#b91c1c' : '#15803d' }}>
                    {varTotal > 0 ? '+' : ''}{pct(varPct)}
                  </td>
                  <td style={S.td}></td>
                </tr>
              </tbody>
            </table>
            <p style={S.ayuda}>
              En material, una variacion positiva significa que se consumio mas materia prima de la que pide la BOM
              (purga, scrap o merma). En mano de obra y overhead significa que la maquina tardo mas minutos de los
              que marca el ciclo estandar: es la misma perdida que el OEE reporta como disponibilidad o desempeno.
            </p>
          </div>

          {/* ---------- Peores desviaciones ---------- */}
          <div style={S.card}>
            <p style={S.cardTit}>Variacion por {agrup === 'ot' ? 'orden de trabajo' : agrup}</p>
            <ResponsiveContainer width="100%" height={Math.max(220, Math.min(grupos.length, 15) * 32)}>
              <BarChart data={grupos.slice(0, 15)} layout="vertical"
                margin={{ left: 10, right: 30, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => '$' + fmt(v)} />
                <YAxis type="category" dataKey="k" width={130} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => din(v)} />
                <Bar dataKey="variacion" name="Variacion">
                  {grupos.slice(0, 15).map((g, i) => (
                    <Cell key={i} fill={g.variacion > 0 ? '#dc2626' : '#16a34a'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* ---------- Tabla agrupada ---------- */}
          <div style={S.card}>
            <p style={S.cardTit}>Resumen por {agrup}</p>
            <div style={{ overflowX: 'auto' }}>
              <table style={S.tabla}>
                <thead>
                  <tr>
                    <th style={S.th}>{agrup === 'ot' ? 'OT' : agrup === 'articulo' ? 'Articulo' : agrup === 'maquina' ? 'Maquina' : 'Fecha'}</th>
                    <th style={S.thR}>Pz OK</th><th style={S.thR}>Scrap</th>
                    <th style={S.thR}>Material real</th><th style={S.thR}>Material std</th>
                    <th style={S.thR}>MO real</th><th style={S.thR}>MO std</th>
                    <th style={S.thR}>OH real</th><th style={S.thR}>OH std</th>
                    <th style={S.thR}>Costo real</th><th style={S.thR}>Costo std</th>
                    <th style={S.thR}>Variacion</th>
                  </tr>
                </thead>
                <tbody>
                  {grupos.map(g => (
                    <tr key={g.k}>
                      <td style={S.td}>{g.k}</td>
                      <td style={S.tdR}>{fmt(g.piezas_ok)}</td>
                      <td style={S.tdR}>{fmt(g.piezas_scrap)}</td>
                      <td style={S.tdR}>{din(g.material_real)}</td>
                      <td style={S.tdR}>{din(g.material_std)}</td>
                      <td style={S.tdR}>{din(g.mo_real)}</td>
                      <td style={S.tdR}>{din(g.mo_std)}</td>
                      <td style={S.tdR}>{din(g.oh_real)}</td>
                      <td style={S.tdR}>{din(g.oh_std)}</td>
                      <td style={S.tdR}>{din(g.costo_real)}</td>
                      <td style={S.tdR}>{din(g.costo_std)}</td>
                      <td style={{ ...S.tdR, fontWeight: 700, color: g.variacion > 0 ? '#b91c1c' : '#15803d' }}>
                        {g.variacion > 0 ? '+' : ''}{din(g.variacion)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ---------- Detalle por OT ---------- */}
          <div style={S.card}>
            <p style={S.cardTit}>Detalle por OT &middot; {filas.length} orden(es)</p>
            <div style={{ overflowX: 'auto' }}>
              <table style={S.tabla}>
                <thead>
                  <tr>
                    <th style={S.th}>Fecha</th><th style={S.th}>OT</th><th style={S.th}>Articulo</th>
                    <th style={S.th}>Maquina</th>
                    <th style={S.thR}>Pz OK</th><th style={S.thR}>Scrap</th>
                    <th style={S.thR}>Min maq real</th><th style={S.thR}>Min maq std</th>
                    <th style={S.thR}>Costo real</th><th style={S.thR}>Costo std</th>
                    <th style={S.thR}>Unit real</th><th style={S.thR}>Unit std</th>
                    <th style={S.thR}>Precio</th><th style={S.thR}>Margen unit</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((r, i) => {
                    const margen = (Number(r.precio_venta) || 0) - (Number(r.costo_unit_real) || 0)
                    const hayPrecio = Number(r.precio_venta) > 0
                    return (
                      <tr key={i}>
                        <td style={S.td}>{r.fecha}</td>
                        <td style={S.td}>{r.ot_folio}</td>
                        <td style={S.td} title={r.articulo_desc}>{r.articulo_codigo}</td>
                        <td style={S.td}>{r.maquina || '-'}</td>
                        <td style={S.tdR}>{fmt(r.piezas_ok)}</td>
                        <td style={S.tdR}>{fmt(r.piezas_scrap)}</td>
                        <td style={S.tdR}>{fmt(r.min_maquina_real)}</td>
                        <td style={S.tdR}>{fmt(r.min_maquina_std)}</td>
                        <td style={S.tdR}>{din(r.costo_real)}</td>
                        <td style={S.tdR}>{din(r.costo_std)}</td>
                        <td style={S.tdR}>{din4(r.costo_unit_real)}</td>
                        <td style={S.tdR}>{din4(r.costo_unit_std)}</td>
                        <td style={S.tdR}>{hayPrecio ? din4(r.precio_venta) : '-'}</td>
                        <td style={{ ...S.tdR, fontWeight: 600, color: !hayPrecio ? '#94a3b8' : margen > 0 ? '#15803d' : '#b91c1c' }}>
                          {hayPrecio ? din4(margen) : '-'}
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

const S = {
  wrap: { padding: '24px 28px' },
  hojaHead: { display: 'none', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #1a1a2e', paddingBottom: '10px', marginBottom: '14px' },
  top: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' },
  h2: { fontSize: '20px', color: '#1a1a2e', margin: 0 },
  sub: { color: '#64748b', fontSize: '13px', margin: '4px 0 0', maxWidth: '830px', lineHeight: 1.5 },
  filtros: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '14px' },
  p: { padding: '8px 15px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  pAct: { padding: '8px 15px', background: '#2563eb', color: '#fff', border: '1px solid #2563eb', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', fontWeight: 500 },
  sep: { width: '1px', height: '22px', background: '#e2e8f0' },
  lblIn: { fontSize: '12px', color: '#444', fontWeight: 500 },
  date: { padding: '7px 10px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '13px', outline: 'none' },
  sel: { padding: '7px 10px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '13px', outline: 'none', background: '#fff' },
  num: { padding: '7px 10px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '13px', outline: 'none', width: '120px' },
  numMini: { padding: '5px 8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '12.5px', outline: 'none', width: '95px', textAlign: 'right' },
  expBtn: { padding: '8px 14px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  btnSec: { padding: '9px 16px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '8px', fontSize: '13.5px', cursor: 'pointer' },
  err: { color: '#b91c1c', fontSize: '13px', margin: '0 0 10px' },
  ok: { color: '#15803d', fontSize: '13px', margin: '0 0 10px' },
  info: { color: '#64748b', fontSize: '13px' },
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', marginBottom: '14px' },
  cardTit: { fontSize: '14px', fontWeight: 600, color: '#1a1a2e', margin: '0 0 12px' },
  subTit: { fontSize: '12.5px', fontWeight: 600, color: '#334155', margin: '16px 0 7px' },
  ayuda: { fontSize: '12px', color: '#64748b', lineHeight: 1.55, margin: '10px 0 0' },
  vacio: { color: '#64748b', fontSize: '13.5px', margin: 0, lineHeight: 1.55 },
  metaIn: { display: 'flex', flexDirection: 'column', gap: '4px' },
  kpis: { display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' },
  kpi: { flex: 1, minWidth: '175px', display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 18px' },
  kpiTit: { fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 },
  kpiVal: { fontSize: '24px', lineHeight: 1.2, margin: '4px 0 2px' },
  kpiPie: { fontSize: '11.5px', color: '#64748b' },
  barBg: { width: '100%', height: '9px', background: '#f1f5f9', borderRadius: '20px', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: '20px' },
  tabla: { width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' },
  th: { textAlign: 'left', padding: '8px 9px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' },
  thR: { textAlign: 'right', padding: '8px 9px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' },
  td: { padding: '7px 9px', borderBottom: '1px solid #f1f5f9', color: '#1a1a2e' },
  tdR: { padding: '7px 9px', borderBottom: '1px solid #f1f5f9', color: '#1a1a2e', textAlign: 'right', whiteSpace: 'nowrap' },
}
