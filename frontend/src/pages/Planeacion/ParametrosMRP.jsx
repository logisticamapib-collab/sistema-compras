import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Etiquetas legibles de cada grupo de la politica general
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

export default function ParametrosMRP() {
  const { perfil, tienePermiso } = useAuth()
  const puedeEditar = tienePermiso('plan_parametros', 'editar')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  const [params, setParams] = useState({
    horizonte_firme_dias: 14,
    horizonte_total_dias: 90,
    base_demanda_prom: 'firme',
    incluir_forecast: true,
  })
  const [politicas, setPoliticas] = useState([]) // {grupo, dias_inventario}

  useEffect(() => { cargar() }, [])

  const cargar = async () => {
    setLoading(true)
    const emp = perfil.empresa_id
    const [{ data: p }, { data: pol }] = await Promise.all([
      supabase.from('mrp_parametros').select('*').eq('empresa_id', emp).maybeSingle(),
      supabase.from('mrp_politicas_grupo').select('*').eq('empresa_id', emp),
    ])
    if (p) setParams({
      horizonte_firme_dias: p.horizonte_firme_dias,
      horizonte_total_dias: p.horizonte_total_dias,
      base_demanda_prom: p.base_demanda_prom,
      incluir_forecast: p.incluir_forecast,
    })
    // Ordenar segun GRUPOS y completar los que falten en 0
    const mapa = {}
    ;(pol || []).forEach(r => { mapa[r.grupo] = r.dias_inventario })
    setPoliticas(GRUPOS.map(g => ({ grupo: g.clave, dias_inventario: mapa[g.clave] ?? 0 })))
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
    const filas = politicas.map(p => ({
      empresa_id: emp,
      grupo: p.grupo,
      dias_inventario: parseFloat(p.dias_inventario) || 0,
    }))
    const { error } = await supabase.from('mrp_politicas_grupo').upsert(filas, { onConflict: 'empresa_id,grupo' })
    if (error) { setError(error.message); return }
    setExito('Politica de dias por grupo guardada'); setTimeout(() => setExito(''), 3000)
  }

  const setDias = (grupo, valor) => {
    setPoliticas(prev => prev.map(p => p.grupo === grupo ? { ...p, dias_inventario: valor } : p))
  }

  if (loading) return <div><p style={{ padding: '20px', color: '#666' }}>Cargando...</p></div>

  return (
    <div>
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Parametros del MRP</h2>
      </div>
      <p style={styles.ayuda}>
        Define el horizonte de planeacion y el inventario de seguridad. La seguridad se calcula en cada
        corrida como <strong>dias x demanda promedio diaria</strong>. Un articulo con su propio valor de
        dias manda; si esta en 0, hereda el de su grupo.
      </p>
      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {/* ===== Parametros globales ===== */}
      <div style={styles.tarjeta}>
        <h3 style={styles.tarjetaTitulo}>Horizonte y calculo</h3>
        <div style={styles.fila}>
          <div style={styles.campo}>
            <label style={styles.label}>Horizonte firme (dias, cubos diarios)</label>
            <input style={styles.input} type="number" min="1" disabled={!puedeEditar}
              value={params.horizonte_firme_dias}
              onChange={e => setParams({ ...params, horizonte_firme_dias: e.target.value })} />
          </div>
          <div style={styles.campo}>
            <label style={styles.label}>Horizonte total (dias, luego semanal)</label>
            <input style={styles.input} type="number" min="1" disabled={!puedeEditar}
              value={params.horizonte_total_dias}
              onChange={e => setParams({ ...params, horizonte_total_dias: e.target.value })} />
          </div>
          <div style={styles.campo}>
            <label style={styles.label}>Base de demanda promedio</label>
            <select style={styles.input} disabled={!puedeEditar}
              value={params.base_demanda_prom}
              onChange={e => setParams({ ...params, base_demanda_prom: e.target.value })}>
              <option value="firme">Demanda firme / dias firme</option>
              <option value="total">Demanda total / dias totales</option>
            </select>
          </div>
          <div style={{ ...styles.campo, justifyContent: 'flex-end' }}>
            <label style={styles.checkLabel}>
              <input type="checkbox" disabled={!puedeEditar}
                checked={params.incluir_forecast}
                onChange={e => setParams({ ...params, incluir_forecast: e.target.checked })} />
              {' '}Incluir forecast en la demanda
            </label>
          </div>
        </div>
        {puedeEditar && (
          <div style={styles.botones}>
            <button style={styles.boton} onClick={guardarParametros}>Guardar parametros</button>
          </div>
        )}
      </div>

      {/* ===== Politica de dias por grupo ===== */}
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
                <input style={{ ...styles.input, maxWidth: '140px' }} type="number" min="0" step="0.01"
                  disabled={!puedeEditar} value={p.dias_inventario}
                  onChange={e => setDias(p.grupo, e.target.value)} />
              </span>
            </div>
          )
        })}
        {puedeEditar && (
          <div style={{ ...styles.botones, padding: '16px 20px' }}>
            <button style={styles.boton} onClick={guardarPoliticas}>Guardar politica de grupos</button>
          </div>
        )}
      </div>
    </div>
  )
}

const styles = {
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0' },
  ayuda: { fontSize: '13px', color: '#64748b', margin: '0 0 20px 0', maxWidth: '760px', lineHeight: '1.5' },
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
