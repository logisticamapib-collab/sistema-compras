import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import EnlaceArchivo from '../../components/EnlaceArchivo'
import { useAuth } from '../../context/AuthContext'
import { numeroALetras } from '../../lib/numeroALetras'

export default function ImprimirOrden({ orden, onVolver }) {
  const { perfil } = useAuth()
  const [lineas, setLineas] = useState([])
  const [proveedor, setProveedor] = useState(null)
  const [solicitante, setSolicitante] = useState(null)
  const [aprobaciones, setAprobaciones] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    const [{ data: l }, { data: p }, { data: a }] = await Promise.all([
      supabase.from('oc_lineas')
        .select('*, articulos(codigo_interno, descripcion)')
        .eq('oc_id', orden.id),
      supabase.from('proveedores').select('*').eq('id', orden.proveedor_id).single(),
      supabase.from('aprobaciones')
        .select('*, aprobador:aprobador_id(nombre, rol)')
        .eq('referencia_id', orden.id)
        .eq('tipo', 'orden_compra')
        .eq('decision', 'aprobada')
        .order('created_at')
    ])
    setLineas(l || [])
    setProveedor(p)
    setAprobaciones(a || [])

    if (orden.requisicion_id) {
      const { data: req } = await supabase.from('requisiciones')
        .select('solicitante:solicitante_id(nombre)')
        .eq('id', orden.requisicion_id)
        .single()
      setSolicitante(req?.solicitante)
    }

    setLoading(false)
  }

  const aprobacionDireccion = aprobaciones.find(a => a.aprobador?.rol === 'direccion')

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
            <h1 style={styles.tituloForma}>ORDEN DE COMPRA</h1>
            <div style={styles.codigoForma}></div>
          </div>

          <table style={styles.tablaSuperior}>
            <tbody>
              <tr>
                <td style={styles.celdaProveedor} rowSpan={5}>
                  <p style={styles.labelChico}>PROVEEDOR:</p>
                  <p style={styles.labelChico}><strong>NOMBRE:</strong> {proveedor?.nombre}</p>
                  <p style={styles.labelChico}><strong>DIRECCIÓN:</strong> {proveedor?.direccion || ''} {proveedor?.ciudad || ''} {proveedor?.estado || ''}</p>
                  <p style={styles.labelChico}><strong>RFC:</strong> {proveedor?.rfc}</p>
                  <p style={styles.labelChico}><strong>TELEFONO:</strong> {proveedor?.telefono}</p>
                </td>
                <td style={styles.celdaLabelD}>FECHA DE CREACIÓN:</td>
                <td style={styles.celdaValorD}>{new Date(orden.fecha_emision).toLocaleDateString('es-MX')}</td>
              </tr>
              <tr>
                <td style={styles.celdaLabelD}>PERSONA DE CONTACTO:</td>
                <td style={styles.celdaValorD}>{proveedor?.contacto}</td>
              </tr>
              <tr>
                <td style={styles.celdaLabelD} colSpan={2}>
                  <strong>FACTURAR A:</strong><br />
                  <span style={styles.labelChico}><strong>NOMBRE:</strong> {perfil?.empresas?.nombre}</span><br />
                  <span style={styles.labelChico}><strong>DIRECCIÓN:</strong> {perfil?.empresas?.direccion}</span><br />
                  <span style={styles.labelChico}><strong>R.F.C.</strong> {perfil?.empresas?.rfc}</span>
                  {' '}<strong>TELEFONO:</strong> {perfil?.empresas?.telefono}
                </td>
              </tr>
            </tbody>
          </table>

          <table style={styles.tablaLineas}>
            <thead>
              <tr>
                <th style={styles.th}>NUMERO<br />DE ORDEN</th>
                <th style={styles.th}>DESCRIPCIÓN</th>
                <th style={styles.th}>FECHA DE<br />ENTREGA</th>
                <th style={styles.th}>CANTIDAD</th>
                <th style={styles.th}>UNIDAD</th>
                <th style={styles.th}>PRECIO<br />UNITARIO</th>
                <th style={styles.th}>DESCUENTO</th>
                <th style={styles.th}>VALOR NETO</th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={l.id}>
                  <td style={styles.tdCentro}>{orden.folio}-{i + 1}</td>
                  <td style={styles.tdIzq}>{l.articulos ? `${l.articulos.codigo_interno} - ${l.articulos.descripcion}` : l.descripcion}</td>
                  <td style={styles.tdCentro}>{orden.fecha_entrega_estimada ? new Date(orden.fecha_entrega_estimada).toLocaleDateString('es-MX') : ''}</td>
                  <td style={styles.tdCentro}>{l.cantidad}</td>
                  <td style={styles.tdCentro}>{l.unidad_medida}</td>
                  <td style={styles.tdDer}>${parseFloat(l.precio_unitario).toFixed(2)}</td>
                  <td style={styles.tdDer}>${parseFloat(l.descuento || 0).toFixed(2)}</td>
                  <td style={styles.tdDer}>${parseFloat(l.subtotal || 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={styles.filaMedia}>
            <table style={styles.tablaMoneda}>
              <tbody>
                <tr><td style={styles.celdaLabelD}>MONEDA</td></tr>
                <tr>
                  <td style={styles.monedaValor}>
                    {{ MXN: 'PESOS MEXICANOS (MXN)', USD: 'DOLARES AMERICANOS (USD)', EUR: 'EUROS (EUR)' }[orden.moneda] || orden.moneda}
                  </td>
                </tr>
              </tbody>
            </table>
            <table style={styles.tablaReferencia}>
              <tbody>
                <tr><td style={styles.celdaLabelD}>REFERENCIA A COTIZACION:</td></tr>
                <tr>
                  <td style={{ ...styles.tdIzq, height: '50px', verticalAlign: 'top' }}>
                    {orden.referencia_cotizacion}
                    {orden.cotizacion_archivo_url && (
                      <>
                        <br />
                        <EnlaceArchivo valor={orden.cotizacion_archivo_url} style={styles.linkCotizacion}>
                          Ver documento de cotizacion adjunto
                        </EnlaceArchivo>
                      </>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
            <table style={styles.tablaTotales}>
              <tbody>
                <tr><td style={styles.celdaLabelD}>SUB TOTAL</td><td style={styles.tdDer}>${parseFloat(orden.subtotal || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td></tr>
                <tr><td style={styles.celdaLabelD}>IVA 16 %</td><td style={styles.tdDer}>${parseFloat(orden.iva || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td></tr>
                <tr><td style={styles.celdaLabelD}>TOTAL A PAGAR.</td><td style={styles.tdDer}>${parseFloat(orden.total || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td></tr>
              </tbody>
            </table>
          </div>

          <table style={styles.tablaCondiciones}>
            <tbody>
              <tr>
                <td style={styles.celdaLabelD}>CONDICIÓN DE PAGO:</td>
                <td style={styles.tdIzq}>{orden.condiciones_pago}</td>
                <td style={styles.celdaLabelD}>COSTO TOTAL CON LETRA:</td>
              </tr>
              <tr>
                <td style={styles.celdaLabelD}>FORMA DE PAGO:</td>
                <td style={styles.tdIzq}>{proveedor?.forma_pago}</td>
                <td style={styles.tdIzq} rowSpan={3}>{numeroALetras(orden.total || 0, orden.moneda)}</td>
              </tr>
              <tr>
                <td style={styles.celdaLabelD}>N° CUENTA:</td>
                <td style={styles.tdIzq}>{proveedor?.numero_cuenta}</td>
              </tr>
              <tr>
                <td style={styles.celdaLabelD}>HOJA</td>
                <td style={styles.tdCentro}>1/1</td>
              </tr>
            </tbody>
          </table>

          <table style={styles.tablaFirmas}>
            <tbody>
              <tr>
                <td style={styles.celdaFirmaLabel}>NOMBRE Y FIRMA DEL DPTO.<br />SOLICITANTE</td>
                <td style={styles.celdaFirmaLabel}>NOMBRE Y FIRMA DEL DPTO. DE<br />COMPRAS</td>
                <td style={styles.celdaFirmaLabel}>AUTORIZADO<br />D.G.</td>
              </tr>
              <tr>
                <td style={styles.celdaFirmaValor}>{solicitante?.nombre || ''}</td>
                <td style={styles.celdaFirmaValor}>{orden.comprador?.nombre || ''}</td>
                <td style={styles.celdaFirmaValor}>
                  {aprobacionDireccion ? (
                    <>
                      {aprobacionDireccion.aprobador?.nombre}
                      <br /><span style={styles.firmaFecha}>Aprobado: {new Date(aprobacionDireccion.fecha_decision).toLocaleDateString('es-MX')}</span>
                    </>
                  ) : ''}
                </td>
              </tr>
            </tbody>
          </table>

          <div style={styles.notasLegales}>
            <p style={styles.notaLegal}>
              NOTA: En caso de fallo en calidad, cantidad o cualquier tipo de cambio en el producto y/o servicio, el proveedor
              sera directamente el responsable, ademas de dar respuesta en un tiempo no mayor a 24 horas, realizando el cambio
              por el material correcto, si el proveedor no lo hace, le seran atribuidos cargos economicos por el incumplimiento.
            </p>
            <p style={styles.notaLegal}>
              El proveedor debe cumplir con los requerimientos establecido en el M-SC-02 Manual del Proveedor de {perfil?.empresas?.nombre}.
            </p>
            <p style={styles.notaLegal}>
              Todos los productos comprados deben ser conformes con los requisitos legales y reglamentarios aplicables, ademas
              en proveedores de resinas y/o MB es indispensable contar con certificacion ISO 9001:2015 o mostrar evidencia de
              algun sistema de gestion de calidad. En caso de no tener ninguno de los anteriores se les enviara un Formato de
              autoevaluacion que tienen que llenar y regresar para revisar su Sistema de Gestion de Calidad.
            </p>
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
  barraAcciones: { display: 'flex', justifyContent: 'space-between', maxWidth: '1050px', margin: '0 auto 16px auto' },
  botonVolver: { padding: '8px 16px', backgroundColor: '#fff', color: '#2563eb', border: '1px solid #2563eb', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' },
  botonImprimir: { padding: '8px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' },
  hoja: { backgroundColor: '#fff', maxWidth: '1050px', margin: '0 auto', padding: '30px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)', fontFamily: 'Arial, sans-serif', fontSize: '10px', color: '#000' },
  encabezado: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '2px solid #000', paddingBottom: '10px', marginBottom: '10px', position: 'relative' },
  logoBox: { width: '140px', height: '55px', display: 'flex', alignItems: 'center' },
  logo: { maxWidth: '140px', maxHeight: '55px', objectFit: 'contain' },
  tituloForma: { flex: 1, textAlign: 'center', fontSize: '24px', fontWeight: '700', margin: '0' },
  codigoForma: { fontSize: '10px', position: 'absolute', top: 0, right: 0 },
  tablaSuperior: { width: '100%', borderCollapse: 'collapse', marginBottom: '4px' },
  celdaProveedor: { border: '1px solid #000', padding: '6px', width: '40%', verticalAlign: 'top' },
  celdaLabelD: { border: '1px solid #000', padding: '4px 8px', fontWeight: '700', fontSize: '9px' },
  celdaValorD: { border: '1px solid #000', padding: '4px 8px', fontSize: '10px' },
  labelChico: { fontSize: '9px', margin: '2px 0' },
  tablaLineas: { width: '100%', borderCollapse: 'collapse', marginBottom: '4px' },
  th: { border: '1px solid #000', padding: '4px', fontSize: '9px', backgroundColor: '#f1f5f9' },
  tdCentro: { border: '1px solid #000', padding: '5px', textAlign: 'center', fontSize: '9px', height: '18px' },
  tdIzq: { border: '1px solid #000', padding: '5px', textAlign: 'left', fontSize: '9px' },
  tdDer: { border: '1px solid #000', padding: '5px', textAlign: 'right', fontSize: '9px' },
  filaMedia: { display: 'flex', gap: '4px', marginBottom: '4px' },
  tablaMoneda: { borderCollapse: 'collapse', fontSize: '9px', flex: 1 },
  monedaValor: { border: '1px solid #000', padding: '10px 6px', textAlign: 'center', fontSize: '10px', fontWeight: '700' },
  linkCotizacion: { fontSize: '8px', color: '#2563eb' },
  tablaReferencia: { borderCollapse: 'collapse', fontSize: '9px', flex: 1.4 },
  tablaTotales: { borderCollapse: 'collapse', fontSize: '9px', flex: 1.2 },
  tablaCondiciones: { width: '100%', borderCollapse: 'collapse', marginBottom: '10px' },
  tablaFirmas: { width: '100%', borderCollapse: 'collapse', marginBottom: '10px' },
  celdaFirmaLabel: { border: '1px solid #000', padding: '4px', fontWeight: '700', textAlign: 'center', fontSize: '9px', width: '33%' },
  celdaFirmaValor: { border: '1px solid #000', padding: '10px', textAlign: 'center', fontSize: '10px', height: '45px', verticalAlign: 'middle' },
  firmaFecha: { fontSize: '8px', color: '#444' },
  notasLegales: { marginTop: '6px' },
  notaLegal: { fontSize: '8px', margin: '0 0 4px 0', lineHeight: '1.3' },
}
