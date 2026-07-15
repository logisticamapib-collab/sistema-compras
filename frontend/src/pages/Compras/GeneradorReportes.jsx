import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import * as XLSX from 'xlsx'
import { calcularRangoFechas, etiquetaPeriodo } from '../../lib/periodos'
import SelectorPeriodo from './SelectorPeriodo'

const tiposReporte = [
  { id: 'compras_pendientes', titulo: 'Compras pendientes (no recibidas ni canceladas)' },
  { id: 'compras_hechas', titulo: 'Compras hechas (recibidas completas)' },
  { id: 'oc_pendientes_aprobar', titulo: 'Ordenes pendientes de aprobar' },
  { id: 'oc_aprobadas', titulo: 'Ordenes ya aprobadas' },
  { id: 'compras_por_usuario', titulo: 'Compras por usuario (comprador)' },
  { id: 'compras_por_aprobador', titulo: 'Compras por aprobador' },
  { id: 'requisiciones_pendientes', titulo: 'Requisiciones pendientes de aprobar' },
  { id: 'requisiciones_completadas', titulo: 'Requisiciones completadas' },
]

const ESTATUS_APROBACION = ['aprobacion_gerente_area', 'aprobacion_gerente_planta', 'aprobacion_gerente_compras', 'aprobacion_direccion']
const ESTATUS_APROBADA_EN_ADELANTE = ['aprobada', 'enviada_proveedor', 'confirmada', 'en_transito', 'recibida_parcial', 'recibida']

export default function GeneradorReportes() {
  const { perfil } = useAuth()
  const [tipoReporte, setTipoReporte] = useState('compras_pendientes')
  const [periodo, setPeriodo] = useState({ tipo: 'ultimos_n_meses', valor: 6 })
  const [sites, setSites] = useState([])
  const [siteFiltro, setSiteFiltro] = useState('todos')
  const [loading, setLoading] = useState(false)
  const [filas, setFilas] = useState([])
  const [generado, setGenerado] = useState(false)
  const [error, setError] = useState('')

  const puedeVerTodosLosSites = ['admin', 'gerente_compras', 'direccion'].includes(perfil?.rol)

  useEffect(() => { cargarSites() }, [])

  const cargarSites = async () => {
    if (!puedeVerTodosLosSites || !perfil) return
    const { data } = await supabase.from('sites').select('id, nombre, codigo').eq('empresa_id', perfil.empresa_id)
    setSites(data || [])
  }

  const siteIdFiltro = () => {
    if (!puedeVerTodosLosSites) return perfil.site_id
    return siteFiltro === 'todos' ? null : parseInt(siteFiltro)
  }

  const generar = async () => {
    setLoading(true)
    setError('')
    setGenerado(false)
    const { desde, hasta } = calcularRangoFechas(periodo)
    const site = siteIdFiltro()

    try {
      let resultado = []

      if (['compras_pendientes', 'compras_hechas', 'oc_pendientes_aprobar', 'oc_aprobadas', 'compras_por_usuario'].includes(tipoReporte)) {
        let q = supabase.from('ordenes_compra')
          .select('folio, tipo, estatus, fecha_emision, fecha_entrega_estimada, fecha_entrega_real, subtotal, iva, total, moneda, proveedores(nombre), comprador:comprador_id(nombre), sites(nombre)')
          .eq('empresa_id', perfil.empresa_id)
          .gte('fecha_emision', desde.toISOString())
          .lte('fecha_emision', hasta.toISOString())
        if (site) q = q.eq('site_id', site)

        if (tipoReporte === 'compras_pendientes') q = q.not('estatus', 'in', '(recibida,cancelada)')
        if (tipoReporte === 'compras_hechas') q = q.eq('estatus', 'recibida')
        if (tipoReporte === 'oc_pendientes_aprobar') q = q.in('estatus', ESTATUS_APROBACION)
        if (tipoReporte === 'oc_aprobadas') q = q.in('estatus', ESTATUS_APROBADA_EN_ADELANTE)

        const { data } = await q
        resultado = (data || []).map(o => ({
          Folio: o.folio,
          Tipo: o.tipo,
          Proveedor: o.proveedores?.nombre || '',
          Comprador: o.comprador?.nombre || '',
          Site: o.sites?.nombre || '',
          Estatus: o.estatus,
          Fecha_emision: o.fecha_emision ? new Date(o.fecha_emision).toLocaleDateString('es-MX') : '',
          Entrega_estimada: o.fecha_entrega_estimada ? new Date(o.fecha_entrega_estimada).toLocaleDateString('es-MX') : '',
          Entrega_real: o.fecha_entrega_real ? new Date(o.fecha_entrega_real).toLocaleDateString('es-MX') : '',
          Total: parseFloat(o.total || 0),
          Moneda: o.moneda,
        }))
        if (tipoReporte === 'compras_por_usuario') {
          resultado.sort((a, b) => (a.Comprador || '').localeCompare(b.Comprador || ''))
        }
      }

      if (tipoReporte === 'compras_por_aprobador') {
        let qOrdenes = supabase.from('ordenes_compra').select('id, folio, site_id, sites(nombre)').eq('empresa_id', perfil.empresa_id)
        if (site) qOrdenes = qOrdenes.eq('site_id', site)
        const { data: ordenes } = await qOrdenes
        const idsOrdenes = (ordenes || []).map(o => o.id)
        const mapaOrdenes = {}
        for (const o of ordenes || []) mapaOrdenes[o.id] = o

        if (idsOrdenes.length > 0) {
          const { data: aprobs } = await supabase.from('aprobaciones')
            .select('*, aprobador:aprobador_id(nombre)')
            .eq('tipo', 'orden_compra')
            .eq('decision', 'aprobada')
            .in('referencia_id', idsOrdenes)
            .gte('fecha_decision', desde.toISOString())
            .lte('fecha_decision', hasta.toISOString())
            .order('fecha_decision')

          resultado = (aprobs || []).map(a => ({
            Aprobador: a.aprobador?.nombre || '',
            Rol: a.rol_requerido,
            Folio_OC: mapaOrdenes[a.referencia_id]?.folio || '',
            Site: mapaOrdenes[a.referencia_id]?.sites?.nombre || '',
            Fecha_decision: new Date(a.fecha_decision).toLocaleString('es-MX'),
            Comentarios: a.comentarios || '',
          }))
          resultado.sort((a, b) => (a.Aprobador || '').localeCompare(b.Aprobador || ''))
        }
      }

      if (['requisiciones_pendientes', 'requisiciones_completadas'].includes(tipoReporte)) {
        let q = supabase.from('requisiciones')
          .select('folio, criticidad, estatus, fecha_requerida, created_at, solicitante:solicitante_id(nombre), sites(nombre)')
          .eq('empresa_id', perfil.empresa_id)
          .gte('created_at', desde.toISOString())
          .lte('created_at', hasta.toISOString())
        if (site) q = q.eq('site_id', site)

        if (tipoReporte === 'requisiciones_pendientes') q = q.not('estatus', 'in', '(completada,rechazada,cancelada)')
        if (tipoReporte === 'requisiciones_completadas') q = q.eq('estatus', 'completada')

        const { data } = await q
        resultado = (data || []).map(r => ({
          Folio: r.folio,
          Solicitante: r.solicitante?.nombre || '',
          Site: r.sites?.nombre || '',
          Criticidad: r.criticidad,
          Estatus: r.estatus,
          Fecha_creacion: r.created_at ? new Date(r.created_at).toLocaleDateString('es-MX') : '',
          Fecha_requerida: r.fecha_requerida ? new Date(r.fecha_requerida).toLocaleDateString('es-MX') : '',
        }))
      }

      setFilas(resultado)
      setGenerado(true)
    } catch (err) {
      setError('Error al generar el reporte: ' + err.message)
    }
    setLoading(false)
  }

  const exportarExcel = () => {
    if (filas.length === 0) return
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), 'Reporte')
    const nombreTipo = tiposReporte.find(t => t.id === tipoReporte)?.titulo || tipoReporte
    XLSX.writeFile(wb, `${nombreTipo.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`)
  }

  const exportarPDF = () => {
    window.print()
  }

  const columnas = filas.length > 0 ? Object.keys(filas[0]) : []

  return (
    <div style={styles.container}>
      <h2 style={styles.titulo}>Generador de reportes</h2>
      <p style={styles.subtitulo}>Elige el tipo de reporte y el periodo, genera la vista previa y descarga en Excel o PDF.</p>

      <div style={styles.panelControles} className="no-imprimir">
        <div style={styles.campo}>
          <label style={styles.label}>Tipo de reporte</label>
          <select style={styles.select} value={tipoReporte} onChange={e => { setTipoReporte(e.target.value); setGenerado(false) }}>
            {tiposReporte.map(t => <option key={t.id} value={t.id}>{t.titulo}</option>)}
          </select>
        </div>

        <div style={styles.campo}>
          <label style={styles.label}>Periodo</label>
          <SelectorPeriodo periodo={periodo} setPeriodo={setPeriodo} />
        </div>

        {puedeVerTodosLosSites && (
          <div style={styles.campo}>
            <label style={styles.label}>Site</label>
            <select style={styles.select} value={siteFiltro} onChange={e => setSiteFiltro(e.target.value)}>
              <option value="todos">Todos los sites</option>
              {sites.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
        )}

        <button style={styles.botonGenerar} onClick={generar} disabled={loading}>
          {loading ? 'Generando...' : 'Generar reporte'}
        </button>
      </div>

      {error && <p style={styles.error}>{error}</p>}

      {generado && (
        <div style={styles.resultado}>
          <div style={styles.resultadoEncabezado}>
            <p style={styles.resultadoInfo}>
              {tiposReporte.find(t => t.id === tipoReporte)?.titulo} &middot; {etiquetaPeriodo(periodo)} &middot; {filas.length} registro(s)
            </p>
            <div style={styles.botonesExport} className="no-imprimir">
              <button style={styles.botonExcel} onClick={exportarExcel} disabled={filas.length === 0}>Descargar Excel</button>
              <button style={styles.botonPDF} onClick={exportarPDF} disabled={filas.length === 0}>Descargar PDF</button>
            </div>
          </div>

          {filas.length === 0 ? (
            <p style={{ color: '#666' }}>No hay registros para este reporte en el periodo seleccionado.</p>
          ) : (
            <div style={styles.tablaWrap}>
              <table style={styles.tabla}>
                <thead>
                  <tr>
                    {columnas.map(c => <th key={c} style={styles.th}>{c.replace(/_/g, ' ')}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f, i) => (
                    <tr key={i} style={styles.tr}>
                      {columnas.map(c => <td key={c} style={styles.td}>{String(f[c] ?? '')}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <style>{`
        @media print {
          .no-imprimir { display: none !important; }
        }
      `}</style>
    </div>
  )
}

const styles = {
  container: { padding: '28px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 6px 0' },
  subtitulo: { fontSize: '13px', color: '#666', margin: '0 0 20px 0' },
  panelControles: { backgroundColor: '#fff', borderRadius: '10px', padding: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '20px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '6px' },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  select: { padding: '8px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '13px', backgroundColor: '#fff', minWidth: '220px' },
  botonGenerar: { padding: '10px 24px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  resultado: { backgroundColor: '#fff', borderRadius: '10px', padding: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  resultadoEncabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' },
  resultadoInfo: { fontSize: '13px', color: '#444', margin: '0' },
  botonesExport: { display: 'flex', gap: '10px' },
  botonExcel: { padding: '8px 16px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' },
  botonPDF: { padding: '8px 16px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' },
  tablaWrap: { overflowX: 'auto' },
  tabla: { width: '100%', borderCollapse: 'collapse', fontSize: '12px' },
  th: { textAlign: 'left', padding: '8px 10px', backgroundColor: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontWeight: '600', textTransform: 'capitalize', whiteSpace: 'nowrap' },
  tr: { borderBottom: '1px solid #f1f5f9' },
  td: { padding: '7px 10px', color: '#1f2937', whiteSpace: 'nowrap' },
}