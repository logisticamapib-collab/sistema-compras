import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Parametros de costeo por empresa. Define como se actualiza articulos.costo
// de los articulos COMPRADOS cada vez que se recibe material contra una OC.
// La consigna (material del cliente) se ignora: costo 0.
// El recalculo lo hace el trigger trg_aplicar_costeo_recibo en la base.

const METODOS = [
  {
    value: 'estandar',
    titulo: 'Costo estandar (fijo / manual)',
    desc: 'El costo NO se actualiza con los recibos. Queda como se capturo en el alta del articulo. Ideal para costeo estandar con revision manual.',
  },
  {
    value: 'ultima_compra',
    titulo: 'Ultima compra',
    desc: 'El costo toma el precio unitario de la OC del ultimo recibo. Simple y predecible: siempre refleja el ultimo precio pagado.',
  },
  {
    value: 'promedio_ponderado',
    titulo: 'Promedio ponderado (movil)',
    desc: 'Recalcula en cada recibo: (existencia previa x costo actual + recibido x precio de OC) / (existencia previa + recibido). Es el estandar en ERP.',
  },
  {
    value: 'promedio_simple',
    titulo: 'Promedio simple',
    desc: 'Promedio aritmetico de los precios de compra historicos del articulo (ignora cantidades).',
  },
]

const fmtDinero = (n) => n == null ? '-' : Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 6 })
const fmtNum = (n) => (Number(n) || 0).toLocaleString('es-MX')
const fmtFecha = (f) => f ? new Date(f).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '-'

export default function ParametrosCosteo() {
  const { perfil, tienePermiso } = useAuth()
  const puedeEditar = tienePermiso('com_costeo', 'editar')

  const [metodo, setMetodo] = useState('estandar')
  const [incluirDescuento, setIncluirDescuento] = useState(false)
  const [historial, setHistorial] = useState([])
  const [articulos, setArticulos] = useState([])
  const [loading, setLoading] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  useEffect(() => { cargar() }, [])

  const cargar = async () => {
    setLoading(true)
    const [p, h, a] = await Promise.all([
      supabase.from('costeo_parametros').select('*').eq('empresa_id', perfil.empresa_id).maybeSingle(),
      supabase.from('costeo_historial').select('*').eq('empresa_id', perfil.empresa_id).order('fecha', { ascending: false }).limit(30),
      supabase.from('articulos').select('id, codigo_interno, descripcion').eq('empresa_id', perfil.empresa_id),
    ])
    if (p.data) { setMetodo(p.data.metodo || 'estandar'); setIncluirDescuento(!!p.data.incluir_descuento) }
    setHistorial(h.data || [])
    setArticulos(a.data || [])
    setLoading(false)
  }

  const artDe = (id) => articulos.find(x => x.id === id)

  const guardar = async () => {
    setError(''); setExito(''); setGuardando(true)
    const { error: e } = await supabase.from('costeo_parametros').upsert({
      empresa_id: perfil.empresa_id,
      metodo,
      incluir_descuento: incluirDescuento,
      updated_at: new Date().toISOString(),
      updated_by: perfil.id,
    }, { onConflict: 'empresa_id' })
    if (e) { setError('No se pudo guardar: ' + e.message); setGuardando(false); return }
    setExito('Metodo de costeo guardado. Aplica a los proximos recibos contra OC.')
    setGuardando(false)
  }

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>

  return (
    <div style={styles.container} className="aparecer">
      <h2 style={styles.titulo}>Parametros de Costeo</h2>
      <p style={styles.intro}>
        Define como se actualiza el <b>costo unitario</b> de los articulos <b>comprados</b> cada vez que se recibe
        material contra una Orden de Compra. El material en <b>consigna</b> no cambia de costo (es del cliente, costo 0).
      </p>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      <div style={styles.tarjeta}>
        <label style={styles.label}>Metodo de costeo</label>
        <div style={styles.opciones}>
          {METODOS.map(m => (
            <label key={m.value} style={{ ...styles.opcion, ...(metodo === m.value ? styles.opcionActiva : {}) }}>
              <input
                type="radio"
                name="metodo"
                value={m.value}
                checked={metodo === m.value}
                disabled={!puedeEditar}
                onChange={() => setMetodo(m.value)}
                style={{ marginTop: '3px' }}
              />
              <span>
                <b>{m.titulo}</b>
                <span style={styles.opcionDesc}>{m.desc}</span>
              </span>
            </label>
          ))}
        </div>

        <label style={{ ...styles.checkFila, opacity: metodo === 'estandar' ? 0.5 : 1 }}>
          <input
            type="checkbox"
            checked={incluirDescuento}
            disabled={!puedeEditar || metodo === 'estandar'}
            onChange={e => setIncluirDescuento(e.target.checked)}
          />
          <span>Aplicar el <b>descuento</b> de la linea de OC al costo (costo = precio x (1 - descuento%)).</span>
        </label>

        {puedeEditar ? (
          <div style={styles.botones}>
            <button style={styles.boton} onClick={guardar} disabled={guardando}>
              {guardando ? 'Guardando...' : 'Guardar metodo'}
            </button>
          </div>
        ) : (
          <p style={styles.soloLectura}>Solo lectura: tu rol no puede editar los parametros de costeo.</p>
        )}
      </div>

      <h3 style={styles.subtitulo}>Historial de recalculos (ultimos 30)</h3>
      {historial.length === 0 ? (
        <p style={{ color: '#666', fontSize: '13px' }}>
          Aun no hay recalculos de costo. Con el metodo <b>Costo estandar</b> el costo no se toca; elige un metodo dinamico y recibe contra una OC para ver movimientos aqui.
        </p>
      ) : (
        <div style={styles.tabla}>
          <div style={styles.tablaHeader}>
            <span style={{ flex: 1.6 }}>Articulo</span>
            <span style={{ flex: 1 }}>Metodo</span>
            <span style={{ flex: 1, textAlign: 'right' }}>Costo anterior</span>
            <span style={{ flex: 1, textAlign: 'right' }}>Costo nuevo</span>
            <span style={{ flex: 1, textAlign: 'right' }}>Precio recibo</span>
            <span style={{ flex: 0.9, textAlign: 'right' }}>Cant.</span>
            <span style={{ flex: 1.3, textAlign: 'right' }}>Fecha</span>
          </div>
          {historial.map(h => (
            <div key={h.id} style={styles.tablaFila}>
              <span style={{ flex: 1.6 }}><b>{artDe(h.articulo_id)?.codigo_interno || h.articulo_id}</b> <span style={{ color: '#64748b' }}>- {artDe(h.articulo_id)?.descripcion || ''}</span></span>
              <span style={{ flex: 1, color: '#64748b' }}>{(h.metodo || '').replace(/_/g, ' ')}</span>
              <span style={{ flex: 1, textAlign: 'right' }}>{fmtDinero(h.costo_anterior)}</span>
              <span style={{ flex: 1, textAlign: 'right', fontWeight: '600', color: '#16a34a' }}>{fmtDinero(h.costo_nuevo)}</span>
              <span style={{ flex: 1, textAlign: 'right' }}>{fmtDinero(h.precio_recibo)}</span>
              <span style={{ flex: 0.9, textAlign: 'right', color: '#64748b' }}>{fmtNum(h.cantidad_recibida)}</span>
              <span style={{ flex: 1.3, textAlign: 'right', color: '#64748b' }}>{fmtFecha(h.fecha)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const styles = {
  container: { padding: '28px', maxWidth: '980px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 6px' },
  intro: { fontSize: '13px', color: '#64748b', margin: '0 0 18px', lineHeight: 1.5 },
  subtitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '26px 0 10px' },
  tarjeta: { backgroundColor: '#fff', borderRadius: '10px', padding: '20px 22px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  label: { fontSize: '12px', fontWeight: '600', color: '#444', textTransform: 'uppercase', letterSpacing: '0.03em' },
  opciones: { display: 'flex', flexDirection: 'column', gap: '10px', margin: '12px 0 18px' },
  opcion: { display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '12px 14px', border: '1px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' },
  opcionActiva: { borderColor: '#2563eb', backgroundColor: '#eff6ff' },
  opcionDesc: { display: 'block', fontSize: '12.5px', color: '#64748b', marginTop: '3px', lineHeight: 1.45 },
  checkFila: { display: 'flex', gap: '9px', alignItems: 'flex-start', fontSize: '13.5px', color: '#334155', margin: '0 0 18px', lineHeight: 1.45 },
  botones: { display: 'flex', justifyContent: 'flex-end' },
  boton: { padding: '9px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  soloLectura: { fontSize: '13px', color: '#94a3b8', margin: '4px 0 0', textAlign: 'right' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '11px 18px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11.5px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '10px 18px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
