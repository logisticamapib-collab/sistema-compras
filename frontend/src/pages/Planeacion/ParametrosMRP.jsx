import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const GRUPOS = [
  { clave: 'producto_terminado', label: 'Producto Terminado (PT)' },
  { clave: 'wip', label: 'WIP (producto en proceso)' },
  { clave: 'materia_prima', label: 'Materia Prima (MP)' },
  { clave: 'consigna', label: 'Consigna' },
  { clave: 'empaque', label: 'Empaque' },
  { clave: 'ensamble', label: 'Ensamble' },
  { clave: 'consumible', label: 'Consumible' },
  { clave: 'refaccion', label: 'Refaccion' },
  { clave: 'toolcrib', label: 'ToolCrib / Herramienta' },
  { clave: 'servicio', label: 'Servicio' },
  { clave: 'otro', label: 'Otro' },
]

const DIAS = [
  { n: 1, label: 'Lunes' }, { n: 2, label: 'Martes' }, { n: 3, label: 'Miercoles' },
  { n: 4, label: 'Jueves' }, { n: 5, label: 'Viernes' }, { n: 6, label: 'Sabado' }, { n: 7, label: 'Domingo' },
]

export default function ParametrosMRP() {
  const { perfil, tienePermiso } = useAuth()
  const puedeEditar = tienePermiso('plan_parametros', 'editar')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  const [params, setParams] = useState({
    horizonte_firme_dias: 14, horizonte_total_dias: 90,
    base_demanda_prom: 'firme', incluir_forecast: true,
    modo_redondeo_fabricado: 'empaque', estimar_lead_ciclo: true,
  })
  const [politicas, setPoliticas] = useState([])
  const [calendario, setCalendario] = useState([])

  useEffect(() => { cargar() }, [])

  const cargar = async () => {
    setLoading(true)
    const emp = perfil.empresa_id
    const [{ data: p }, { data: pol }, { data: cal }] = await Promise.all([
      supabase.from('mrp_parametros').select('*').eq('empresa_id', emp).maybeSingle(),
      supabase.from('mrp_politicas_grupo').select('*').eq('empresa_id', emp),
      supabase.from('mrp_calendario').select('*').eq('empresa_id', emp).order('dia_semana'),
    ])
    if (p) setParams({
      horizonte_firme_dias: p.horizonte_firme_dias, horizonte_total_dias: p.horizonte_total_dias,
      base_demanda_prom: p.base_demanda_prom, incluir_forecast: p.incluir_forecast,
      modo_redondeo_fabricado: p.modo_redondeo_fabricado || 'empaque', estimar_lead_ciclo: p.estimar_lead_ciclo ?? true,
    })
    const mapa = {}
    ;(pol || []).forEach(r => { mapa[r.grupo] = r.dias_inventario })
    setPoliticas(GRUPOS.map(g => ({ grupo: g.clave, dias_inventario: mapa[g.clave] ?? 0 })))
    const cmap = {}
    ;(cal || []).forEach(r => { cmap[r.dia_semana] = r })
    setCalendario(DIAS.map(d => ({
      dia_semana: d.n,
      trabaja: cmap[d.n]?.trabaja ?? (d.n <= 6),
      horas_efectivas: cmap[d.n]?.horas_efectivas ?? (d.n <= 5 ? 22.5 : d.n === 6 ? 15 : 0),
    })))
    setLoading(false)
  }

  const guardarParametros = async () => {
    setError(''); setExito('')
    const emp = perfil.empresa_id
    const payload = {
      empresa_id: emp,
      horizonte_firme_dias: parseInt(params.horizonte_firme_dias) || 0,
      horizonte_total_dias: parseInt(params.horizonte_total_dias) || 0,
      base_demanda_prom: params.base_demanda_prom,
      incluir_forecast: !!params.incluir_forecast,
      modo_redondeo_fabricado: params.modo_redondeo_fabricado,
      estimar_lead_ciclo: !!params.estimar_lead_ciclo,
      updated_at: new Date().toISOString(),
    }
    if (payload.horizonte_total_dias <= payload.horizonte_firme_dias) {
      setError('El horizonte total debe ser mayor al horizonte firme.'); return
    }
    const { error } = await supabase.from('mrp_parametros').upsert(payload, { onConflict: 'empresa_id' })
    if (error) { setError(error.message); return }
    setExito('Parametros globales guardados'); setTimeout(() => setExito(''), 3000)
  }

  const guardarPoliticas = async () => {
    setError(''); setExito('')
    const emp = perfil.empresa_id
    const filas = politicas.map(p => ({ empresa_id: emp, grupo: p.grupo, dias_inventario: parseFloat(p.dias_inventario) || 0 }))
    const { error } = await supabase.from('mrp_politicas_grupo').upsert(filas, { onConflict: 'empresa_id,grupo' })
    if (error) { setError(error.message); return }
    setExito('Politica de dias por grupo guardada'); setTimeout(() => setExito(''), 3000)
  }

  const guardarCalendario = async () => {
    setError(''); setExito('')
    const emp = perfil.empresa_id
    const filas = calendario.map(c => ({
      empresa_id: emp, dia_semana: c.dia_semana,
      trabaja: !!c.trabaja, horas_efectivas: parseFloat(c.horas_efectivas) || 0,
    }))
    const { error } = await supabase.from('mrp_calendario').upsert(filas, { onConflict: 'empresa_id,dia_semana' })
    if (error) { setError(error.message); return }
    setExito('Calendario laboral guardado'); setTimeout(() => setExito(''), 3000)
  }

  const setDias = (grupo, v) => setPoliticas(prev => prev.map(p => p.grupo === grupo ? { ...p, dias_inventario: v } : p))
  const setCal = (dia, campo, v) => setCalendario(prev => prev.map(c => c.dia_semana === dia ? { ...c, [campo]: v } : c))

  if (loading) return <div><p style={{ padding: '20px', color: '#666' }}>Cargando...</p></div>

  return (
    <div>
      <div style={styles.encabezado}><h2 style={styles.titulo}>Parametros del MRP</h2></div>
      <p style={styles.ayuda}>La seguridad se calcula en cada corrida como <strong>dias x demanda promedio por dia habil</strong>.
        Un articulo con su propio valor de dias manda; si esta en 0, hereda el de su grupo. Las ordenes se redondean hacia arriba al empaque/SNP.</p>
      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {/* Horizonte y calculo */}
      <div style={styles.tarjeta}>
        <h3 style={styles.tarjetaTitulo}>Horizonte y calculo</h3>
        <div style={styles.fila}>
          <div style={styles.campo}>
            <label style={styles.label}>Horizonte firme (dias, cubos diarios)</label>
            <input style={styles.input} type="number" min="1" disabled={!puedeEditar}
              value={params.horizonte_firme_dias} onChange={e => setParams({ ...params, horizonte_firme_dias: e.target.value })} />
          </div>
          <div style={styles.campo}>
            <label style={styles.label}>Horizonte total (dias, luego semanal)</label>
            <input style={styles.input} type="number" min="1" disabled={!puedeEditar}
              value={params.horizonte_total_dias} onChange={e => setParams({ ...params, horizonte_total_dias: e.target.value })} />
          </div>
          <div style={styles.campo}>
            <label style={styles.label}>Base de demanda promedio</label>
            <select style={styles.input} disabled={!puedeEditar}
              value={params.base_demanda_prom} onChange={e => setParams({ ...params, base_demanda_prom: e.target.value })}>
              <option value="firme">Demanda firme / dias habiles firme</option>
              <option value="total">Demanda total / dias habiles total</option>
            </select>
          </div>
        </div>
        <div style={styles.fila}>
          <div style={styles.campo}>
            <label style={styles.label}>Redondeo de fabricados</label>
            <select style={styles.input} disabled={!puedeEditar}
              value={params.modo_redondeo_fabricado} onChange={e => setParams({ ...params, modo_redondeo_fabricado: e.target.value })}>
              <option value="empaque">A piezas por empaque</option>
              <option value="tarima">A tarima completa</option>
              <option value="multiplo">Solo multiplo del articulo</option>
            </select>
          </div>
          <div style={{ ...styles.campo, justifyContent: 'flex-end' }}>
            <label style={styles.checkLabel}>
              <input type="checkbox" disabled={!puedeEditar} checked={params.estimar_lead_ciclo}
                onChange={e => setParams({ ...params, estimar_lead_ciclo: e.target.checked })} />
              {' '}Estimar lead time de fabricados por tiempo de ciclo
            </label>
          </div>
          <div style={{ ...styles.campo, justifyContent: 'flex-end' }}>
            <label style={styles.checkLabel}>
              <input type="checkbox" disabled={!puedeEditar} checked={params.incluir_forecast}
                onChange={e => setParams({ ...params, incluir_forecast: e.target.checked })} />
              {' '}Incluir forecast en la demanda
            </label>
          </div>
        </div>
        {puedeEditar && <div style={styles.botones}><button style={styles.boton} onClick={guardarParametros}>Guardar parametros</button></div>}
      </div>

      {/* Calendario laboral */}
      <div style={styles.tarjeta}>
        <h3 style={styles.tarjetaTitulo}>Calendario laboral</h3>
        <p style={{ fontSize: '12px', color: '#94a3b8', margin: '0 0 12px' }}>Define que dias se trabaja y las horas efectivas (descontando cambios de turno). Se usa para la tasa diaria y el lead time de produccion.</p>
        <div style={styles.tablaHeader}>
          <span style={{ flex: 2 }}>Dia</span>
          <span style={{ flex: 1, textAlign: 'center' }}>Se trabaja</span>
          <span style={{ flex: 1 }}>Horas efectivas</span>
        </div>
        {calendario.map(c => {
          const d = DIAS.find(x => x.n === c.dia_semana)
          return (
            <div key={c.dia_semana} style={styles.tablaFila}>
              <span style={{ flex: 2, fontWeight: '500' }}>{d?.label}</span>
              <span style={{ flex: 1, textAlign: 'center' }}>
                <input type="checkbox" disabled={!puedeEditar} checked={c.trabaja} onChange={e => setCal(c.dia_semana, 'trabaja', e.target.checked)} />
              </span>
              <span style={{ flex: 1 }}>
                <input style={{ ...styles.input, maxWidth: '120px' }} type="number" min="0" step="0.5" disabled={!puedeEditar || !c.trabaja}
                  value={c.horas_efectivas} onChange={e => setCal(c.dia_semana, 'horas_efectivas', e.target.value)} />
              </span>
            </div>
          )
        })}
        {puedeEditar && <div style={{ ...styles.botones, marginTop: '16px' }}><button style={styles.boton} onClick={guardarCalendario}>Guardar calendario</button></div>}
      </div>

      {/* Politica por grupo */}
      <div style={styles.tarjeta}>
        <h3 style={styles.tarjetaTitulo}>Dias de inventario de seguridad por grupo</h3>
        <div style={styles.tablaHeader}>
          <span style={{ flex: 2 }}>Grupo</span>
          <span style={{ flex: 1 }}>Dias de seguridad</span>
        </div>
        {politicas.map(p => {
          const g = GRUPOS.find(x => x.clave === p.grupo)
          return (
            <div key={p.grupo} style={styles.tablaFila}>
              <span style={{ flex: 2, fontWeight: '500' }}>{g?.label || p.grupo}</span>
              <span style={{ flex: 1 }}>
                <input style={{ ...styles.input, maxWidth: '140px' }} type="number" min="0" step="0.01" disabled={!puedeEditar}
                  value={p.dias_inventario} onChange={e => setDias(p.grupo, e.target.value)} />
              </span>
            </div>
          )
        })}
        {puedeEditar && <div style={{ ...styles.botones, marginTop: '16px' }}><button style={styles.boton} onClick={guardarPoliticas}>Guardar politica de grupos</button></div>}
      </div>
    </div>
  )
}

const styles = {
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0' },
  ayuda: { fontSize: '13px', color: '#64748b', margin: '0 0 20px 0', maxWidth: '820px', lineHeight: '1.5' },
  tarjeta: { backgroundColor: '#fff', borderRadius: '10px', padding: '24px', marginBottom: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tarjetaTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 16px 0' },
  fila: { display: 'flex', gap: '16px', marginBottom: '8px', flexWrap: 'wrap' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: '200px' },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  checkLabel: { fontSize: '13px', color: '#444', display: 'flex', alignItems: 'center', paddingBottom: '9px' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' },
  botones: { display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '16px' },
  boton: { padding: '9px 20px', backgroundColor: '#9333ea', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  tablaHeader: { display: 'flex', padding: '12px 0', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '10px 0', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
