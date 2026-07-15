import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

export default function ImprimirRequisicion({ requisicion, onVolver }) {
  const { perfil } = useAuth()
  const [lineas, setLineas] = useState([])
  const [solicitante, setSolicitante] = useState(null)
  const [aprobaciones, setAprobaciones] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    const [{ data: l }, { data: s }, { data: a }] = await Promise.all([
      supabase.from('requisicion_lineas')
        .select('*, articulos(codigo_interno, descripcion), centros_costos(codigo, nombre), cuentas_gastos(codigo, nombre)')
        .eq('requisicion_id', requisicion.id),
      supabase.from('usuarios').select('nombre, area').eq('id', requisicion.solicitante_id).single(),
      supabase.from('aprobaciones')
        .select('*, aprobador:aprobador_id(nombre)')
        .eq('referencia_id', requisicion.id)
        .eq('tipo', 'requisicion')
        .eq('decision', 'aprobada')
        .order('created_at')
    ])
    setLineas(l || [])
    setSolicitante(s)
    setAprobaciones(a || [])
    setLoading(false)
  }

  const centrosCostos = [...new Set(lineas.map(l => l.centros_costos?.codigo).filter(Boolean))].join(', ')
  const cuentasGastos = [...new Set(lineas.map(l => l.cuentas_gastos?.nombre).filter(Boolean))].join(', ')

  // Primer aprobador registrado (Gte de Area / Usuario) y segundo (Gte de Operaciones / Gte de Area superior)
  const aprobacion1 = aprobaciones[0]
  const aprobacion2 = aprobaciones[1]

  return (
    <div style={styles.wrapper}>
      <div style={styles.barraAcciones} className="no-imprimir">
        <button style={styles.botonVolver} onClick={onVolver}>&larr; Volver al detalle</button>
        <button style={styles.botonImprimir} onClick={() => window.print()}>Imprimir</button>
      </div>

      {loading ? <p style={{ padding: 20 }}>Cargando...</p> : (
        <div style={styles.hoja} id="hoja-imprimir">
          <div style={styles.encabezado}>
            <div style={styles.logoBox}>
              {perfil?.empresas?.logo_url && <img src={perfil.empresas.logo_url} alt="Logo" style={styles.logo} />}
            </div>
            <h1 style={styles.tituloForma}>REQUISICIÓN DE COMPRA</h1>
            <div style={styles.codigoForma}></div>
          </div>

          <table style={styles.tablaDatos}>
            <tbody>
              <tr>
                <td style={styles.celdaLabelAncha} colSpan={2}>DEPARTAMENTO SOLICITANTE:</td>
                <td style={styles.celdaLabel}>FECHA</td>
                <td style={styles.celdaLabel}>FOLIO:</td>
              </tr>
              <tr>
                <td style={styles.celdaValorAncha} colSpan={2}>{(solicitante?.area || '').toUpperCase()}</td>
                <td style={styles.celdaValor}>{new Date(requisicion.created_at).toLocaleDateString('es-MX')}</td>
                <td style={styles.celdaValor}>{requisicion.folio}</td>
              </tr>
              <tr>
                <td style={styles.celdaLabelAncha} colSpan={4}>SOLICITANTE: (Nombre)</td>
              </tr>
              <tr>
                <td style={styles.celdaValorAncha} colSpan={4}>{(solicitante?.nombre || '').toUpperCase()}</td>
              </tr>
            </tbody>
          </table>

          <table style={styles.tablaLineas}>
            <thead>
              <tr>
                <th style={styles.thPartida}>PARTIDA</th>
                <th style={styles.thCantidad}>CANTIDAD</th>
                <th style={styles.thUnidad}>UNIDAD</th>
                <th style={styles.thDescripcion}>DESCRIPCION</th>
                <th style={styles.thJustificacion} rowSpan={lineas.length + 1}>
                  <div style={styles.justificacionContenido}>
                    <p style={styles.justificacionTexto}>{requisicion.justificacion}</p>
                    <div style={styles.criticidadBox}>
                      <p style={styles.criticidadTitulo}>Nivel de criticidad</p>
                      <p style={styles.criticidadLinea}>
                        {requisicion.criticidad === 'alta' ? '☒' : '☐'} Alta, detiene operacion, afecta seguridad o cumplimiento legal.
                      </p>
                      <p style={styles.criticidadLinea}>
                        {requisicion.criticidad === 'media' ? '☒' : '☐'} Media, afecta productividad o calidad.
                      </p>
                      <p style={styles.criticidadLinea}>
                        {requisicion.criticidad === 'baja' ? '☒' : '☐'} Baja, no impacta directamente la operacion.
                      </p>
                    </div>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={l.id}>
                  <td style={styles.tdCentro}>{i + 1}</td>
                  <td style={styles.tdCentro}>{l.cantidad}</td>
                  <td style={styles.tdCentro}>{l.unidad_medida}</td>
                  <td style={styles.tdDescripcion}>
                    {l.articulos ? `${l.articulos.codigo_interno} - ${l.articulos.descripcion}` : l.descripcion_libre}
                  </td>
                </tr>
              ))}
              {lineas.length === 0 && (
                <tr><td colSpan={3} style={styles.tdCentro}>Sin lineas</td></tr>
              )}
            </tbody>
          </table>

          <table style={styles.tablaFirmas}>
            <tbody>
              <tr>
                <td style={styles.celdaFirmaLabel}>GTE DE AREA / USUARIO<br />NOMBRE &amp; FIRMA</td>
                <td style={styles.celdaFirmaLabel}>GTE. DE OPERACIONES / GTE DE AREA<br />NOMBRE &amp; FIRMA</td>
              </tr>
              <tr>
                <td style={styles.celdaFirmaValor}>
                  {aprobacion1 ? (
                    <>
                      {aprobacion1.aprobador?.nombre}
                      <br /><span style={styles.firmaFecha}>Aprobado electronicamente: {new Date(aprobacion1.fecha_decision).toLocaleDateString('es-MX')}</span>
                    </>
                  ) : ''}
                </td>
                <td style={styles.celdaFirmaValor}>
                  {aprobacion2 ? (
                    <>
                      {aprobacion2.aprobador?.nombre}
                      <br /><span style={styles.firmaFecha}>Aprobado electronicamente: {new Date(aprobacion2.fecha_decision).toLocaleDateString('es-MX')}</span>
                    </>
                  ) : ''}
                </td>
              </tr>
            </tbody>
          </table>

          <div style={styles.filaInferior}>
            <table style={styles.tablaNotas}>
              <tbody>
                <tr><td style={styles.notaTitulo} colSpan={3}>Nota: Para los requerimientos tomar en cuenta:</td></tr>
                <tr>
                  <td style={styles.notaHeaderCelda}>Criticidad</td>
                  <td style={styles.notaHeaderCelda}>Dias para cotizar</td>
                  <td style={styles.notaHeaderCelda}>Dias para autorizacion</td>
                </tr>
                <tr><td style={styles.notaCelda}>Alta</td><td style={styles.notaCelda}>2</td><td style={styles.notaCelda}>1</td></tr>
                <tr><td style={styles.notaCelda}>Media</td><td style={styles.notaCelda}>5</td><td style={styles.notaCelda}>5</td></tr>
                <tr><td style={styles.notaCelda}>Baja</td><td style={styles.notaCelda}>5</td><td style={styles.notaCelda}>15</td></tr>
              </tbody>
            </table>
            <table style={styles.tablaCC}>
              <tbody>
                <tr>
                  <td style={styles.notaHeaderCelda}>CENTRO DE COSTOS</td>
                  <td style={styles.notaHeaderCelda}>CUENTA DE GASTOS</td>
                </tr>
                <tr>
                  <td style={styles.notaCelda}>{centrosCostos}</td>
                  <td style={styles.notaCelda}>{cuentasGastos}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <style>{`
        @media print {
          .no-imprimir { display: none !important; }
          body { margin: 0; }
          #hoja-imprimir { box-shadow: none !important; margin: 0 !important; }
        }
      `}</style>
    </div>
  )
}

const styles = {
  wrapper: { backgroundColor: '#e2e8f0', minHeight: '100vh', padding: '20px' },
  barraAcciones: { display: 'flex', justifyContent: 'space-between', maxWidth: '1000px', margin: '0 auto 16px auto' },
  botonVolver: { padding: '8px 16px', backgroundColor: '#fff', color: '#2563eb', border: '1px solid #2563eb', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' },
  botonImprimir: { padding: '8px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' },
  hoja: { backgroundColor: '#fff', maxWidth: '1000px', margin: '0 auto', padding: '30px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)', fontFamily: 'Arial, sans-serif', fontSize: '11px', color: '#000' },
  encabezado: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '2px solid #000', paddingBottom: '10px', marginBottom: '10px', position: 'relative' },
  logoBox: { width: '140px', height: '60px', display: 'flex', alignItems: 'center' },
  logo: { maxWidth: '140px', maxHeight: '60px', objectFit: 'contain' },
  tituloForma: { flex: 1, textAlign: 'center', fontSize: '26px', fontWeight: '700', margin: '0' },
  codigoForma: { fontSize: '10px', position: 'absolute', top: 0, right: 0 },
  tablaDatos: { width: '100%', borderCollapse: 'collapse', marginBottom: '4px' },
  celdaLabelAncha: { border: '1px solid #000', padding: '4px 8px', fontWeight: '700', textAlign: 'center', fontSize: '10px' },
  celdaLabel: { border: '1px solid #000', padding: '4px 8px', fontWeight: '700', textAlign: 'center', fontSize: '10px', width: '18%' },
  celdaValorAncha: { border: '1px solid #000', padding: '6px 8px', textAlign: 'center', fontSize: '11px' },
  celdaValor: { border: '1px solid #000', padding: '6px 8px', textAlign: 'center', fontSize: '11px' },
  tablaLineas: { width: '100%', borderCollapse: 'collapse', marginBottom: '4px' },
  thPartida: { border: '1px solid #000', padding: '4px', fontSize: '10px', width: '7%' },
  thCantidad: { border: '1px solid #000', padding: '4px', fontSize: '10px', width: '9%' },
  thUnidad: { border: '1px solid #000', padding: '4px', fontSize: '10px', width: '9%' },
  thDescripcion: { border: '1px solid #000', padding: '4px', fontSize: '10px', width: '35%' },
  thJustificacion: { border: '1px solid #000', padding: '4px', fontSize: '10px', width: '40%', verticalAlign: 'top' },
  tdCentro: { border: '1px solid #000', padding: '6px', textAlign: 'center', fontSize: '11px', height: '22px' },
  tdDescripcion: { border: '1px solid #000', padding: '6px', fontSize: '11px' },
  justificacionContenido: { textAlign: 'left', padding: '4px' },
  justificacionTexto: { fontSize: '10px', margin: '0 0 10px 0', whiteSpace: 'pre-wrap' },
  criticidadBox: { marginTop: '8px' },
  criticidadTitulo: { fontWeight: '700', fontSize: '10px', margin: '0 0 4px 0' },
  criticidadLinea: { fontSize: '9px', margin: '0 0 3px 0' },
  tablaFirmas: { width: '100%', borderCollapse: 'collapse', marginBottom: '10px' },
  celdaFirmaLabel: { border: '1px solid #000', padding: '4px', fontWeight: '700', textAlign: 'center', fontSize: '9px', width: '50%' },
  celdaFirmaValor: { border: '1px solid #000', padding: '10px', textAlign: 'center', fontSize: '11px', height: '50px', verticalAlign: 'middle' },
  firmaFecha: { fontSize: '9px', color: '#444' },
  filaInferior: { display: 'flex', gap: '8px' },
  tablaNotas: { borderCollapse: 'collapse', fontSize: '9px', flex: 1 },
  tablaCC: { borderCollapse: 'collapse', fontSize: '9px', flex: 1 },
  notaTitulo: { border: '1px solid #000', padding: '4px', fontWeight: '700', textAlign: 'center' },
  notaHeaderCelda: { border: '1px solid #000', padding: '4px', fontWeight: '700', textAlign: 'center' },
  notaCelda: { border: '1px solid #000', padding: '4px', textAlign: 'center' },
}