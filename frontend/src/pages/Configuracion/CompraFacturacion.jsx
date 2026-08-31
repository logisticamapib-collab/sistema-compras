import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Hasta donde llega el modulo de compras de esta empresa.
//
// En compras hay tres documentos que deben cuadrar entre si: la ORDEN dice que
// pediste y a que precio, el RECIBO dice que llego al almacen, y la FACTURA
// dice que te estan cobrando. Los dos primeros ya estan amarrados en el
// sistema; el tercero se habilita aqui.
//
// No todas las plantas quieren llegar igual de lejos -- en muchas la factura
// la lleva contabilidad en su propio sistema -- y por eso el nivel se
// configura en vez de imponerse. De paso evita el peor error de diseno de
// todos: ofrecer una opcion que el sistema no puede cumplir. Con el nivel en
// "solo recibo", la politica de moneda deja de ofrecer "congelar al facturar",
// porque no habria quien registrara esa factura.

const NIVELES = [
  {
    v: 'recibo',
    titulo: 'Solo recibo',
    resumen: 'El costo queda firme cuando el material entra al almacen. No se capturan facturas.',
    sirve: 'Sirve cuando la factura del proveedor la lleva contabilidad en su propio sistema y aqui solo se '
      + 'necesita saber que llego y cuanto costo. Es lo que ya funciona hoy: la orden y el recibo se amarran, '
      + 'el lote se valua con el precio de la orden y el tipo de cambio del dia, y ahi termina.',
    falta: 'No se detecta si el proveedor te factura de mas: nadie compara lo cobrado contra lo pedido.',
  },
  {
    v: 'cotejo',
    titulo: 'Cotejo de tres vias',
    resumen: 'Se captura la factura, se liga a sus recibos y se compara contra la orden y contra lo recibido.',
    sirve: 'Cierra el circulo de compras. Al registrar la factura, el sistema compara tres cosas: cantidad '
      + 'facturada contra recibida, precio facturado contra el de la orden, y tipo de cambio de la factura '
      + 'contra el que se uso al recibir. Ahi es donde se detecta que te facturaron 1,200 piezas cuando '
      + 'entregaste 1,000, o que te cobraron a 3.10 lo que cotizaron a 2.80. Y es la evidencia de que Compras '
      + 'controla lo que paga, que es lo que se revisa en auditoria.',
    falta: 'No lleva vencimientos ni programacion de pagos: eso sigue en el sistema contable.',
  },
  {
    v: 'cxp',
    titulo: 'Cotejo mas cuentas por pagar',
    resumen: 'Lo anterior, mas vencimientos, antiguedad de saldos y programacion de pagos.',
    sirve: 'Para cuando el area administrativa va a trabajar dentro del sistema. El vencimiento sale de los '
      + 'dias de credito del proveedor y de la fecha de la factura, y de ahi salen la antiguedad de saldos y '
      + 'que toca pagar esta semana. Es tambien el punto donde despues se puede colgar un modulo de '
      + 'contabilidad, porque ya existe el documento, su vencimiento y su saldo.',
    falta: 'Es el nivel que mas captura exige: si nadie registra las facturas al dia, los saldos mienten.',
  },
]

export default function CompraFacturacion() {
  const { perfil, tienePermiso } = useAuth()
  const emp = perfil.empresa_id
  const puedeEditar = tienePermiso('config_compras', 'editar') || tienePermiso('config_compras', 'crear')

  const [cfg, setCfg] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  useEffect(() => { cargar() }, [])

  const cargar = async () => {
    setLoading(true)
    const { data } = await supabase.from('config_compras').select('*').eq('empresa_id', emp).maybeSingle()
    setCfg(data || {
      empresa_id: emp, nivel_facturacion: 'recibo', tolerancia_tipo: 'ninguna',
      tolerancia_pct: 0, tolerancia_monto: 0, autoriza_compras: true, autoriza_jefe: false, captura_xml: false,
    })
    setLoading(false)
  }

  const guardar = async (patch) => {
    setError(''); setExito('')
    const np = { ...cfg, ...patch, empresa_id: emp, updated_at: new Date().toISOString(), updated_by: perfil.id }
    const { error: e } = await supabase.from('config_compras').upsert(np, { onConflict: 'empresa_id' })
    if (e) { setError(e.message); return }
    setCfg(np)
    setExito('Configuracion guardada.')
    setTimeout(() => setExito(''), 3000)
  }

  if (loading || !cfg) return <p style={{ padding: 28, color: '#666' }}>Cargando...</p>

  const conFacturas = cfg.nivel_facturacion !== 'recibo'

  return (
    <div style={S.wrap}>
      <h2 style={S.h2}>Compras y facturacion</h2>
      <p style={S.sub}>
        En compras hay tres documentos que deben cuadrar: la <b>orden</b> dice que pediste y a que precio, el
        <b> recibo</b> dice que llego al almacen, y la <b>factura</b> dice que te estan cobrando. Los dos primeros
        ya estan amarrados. Aqui se decide si el tercero tambien vive en el sistema.
      </p>

      {error && <p style={S.err}>{error}</p>}
      {exito && <p style={S.ok}>{exito}</p>}

      <div style={S.card}>
        <p style={S.cardTit}>Hasta donde llega el modulo</p>
        {NIVELES.map(n => (
          <label key={n.v} style={cfg.nivel_facturacion === n.v ? S.opcionSel : S.opcion}>
            <input type="radio" name="nivel" checked={cfg.nivel_facturacion === n.v} disabled={!puedeEditar}
              onChange={() => guardar({ nivel_facturacion: n.v })} />
            <span>
              <b>{n.titulo}</b>
              <span style={S.opcionResumen}>{n.resumen}</span>
              <span style={S.opcionExpl}>{n.sirve}</span>
              <span style={S.opcionFalta}>Lo que no cubre: {n.falta}</span>
            </span>
          </label>
        ))}
        {!conFacturas && (
          <p style={S.avisoNivel}>
            Con este nivel, la <b>politica de moneda</b> no ofrece "congelar al facturar": no habria quien
            registrara esa factura. El costo del lote queda firme desde el recibo.
          </p>
        )}
      </div>

      {conFacturas && (
        <>
          <div style={S.card}>
            <p style={S.cardTit}>Cuando la factura no cuadra</p>
            <p style={S.ayuda}>
              Una diferencia de centavos por redondeo no deberia frenar una factura, y un sobreprecio del 15%
              no deberia pasar solo. Aqui se define donde esta esa raya.
            </p>
            {[
              ['ninguna', 'Sin tolerancia',
               'Cualquier diferencia, por chica que sea, deja la factura retenida esperando autorizacion. Lo mas estricto; en la practica frena por redondeos.'],
              ['porcentaje', 'Por porcentaje',
               'Se acepta si la diferencia no pasa de un porcentaje del monto esperado. Funciona bien con importes parejos.'],
              ['monto', 'Por monto',
               'Se acepta si la diferencia no pasa de una cantidad fija de dinero. Funciona bien cuando hay compras chicas y grandes mezcladas.'],
              ['ambas', 'Porcentaje o monto',
               'Basta con caber en UNA de las dos: que la diferencia sea chica en porcentaje O chica en dinero. Es lo mas usado, porque cubre tanto la compra grande con desviacion minima como la compra chica con diferencia de pesos.'],
            ].map(([v, titulo, expl]) => (
              <label key={v} style={cfg.tolerancia_tipo === v ? S.opcionSel : S.opcion}>
                <input type="radio" name="tol" checked={cfg.tolerancia_tipo === v} disabled={!puedeEditar}
                  onChange={() => guardar({ tolerancia_tipo: v })} />
                <span><b>{titulo}</b><span style={S.opcionExpl}>{expl}</span></span>
              </label>
            ))}

            {(cfg.tolerancia_tipo === 'porcentaje' || cfg.tolerancia_tipo === 'ambas') && (
              <div style={S.campoInline}>
                <label style={S.label}>Porcentaje permitido</label>
                <input style={S.inputCorto} type="number" min="0" step="0.1" defaultValue={cfg.tolerancia_pct}
                  disabled={!puedeEditar}
                  onBlur={e => guardar({ tolerancia_pct: Number(e.target.value) || 0 })} />
                <span style={S.unidad}>%</span>
              </div>
            )}
            {(cfg.tolerancia_tipo === 'monto' || cfg.tolerancia_tipo === 'ambas') && (
              <div style={S.campoInline}>
                <label style={S.label}>Monto permitido</label>
                <input style={S.inputCorto} type="number" min="0" step="1" defaultValue={cfg.tolerancia_monto}
                  disabled={!puedeEditar}
                  onBlur={e => guardar({ tolerancia_monto: Number(e.target.value) || 0 })} />
                <span style={S.unidad}>en la moneda de la compania</span>
              </div>
            )}
          </div>

          <div style={S.card}>
            <p style={S.cardTit}>Quien autoriza una factura fuera de tolerancia</p>
            <p style={S.ayuda}>
              Se pueden pedir las dos firmas: primero Compras, que sabe que se negocio, y despues el jefe
              directo del comprador. Si no se marca ninguna, la diferencia se registra y se avisa, pero la
              factura pasa sin que nadie la autorice.
            </p>
            <label style={S.check}>
              <input type="checkbox" checked={!!cfg.autoriza_compras} disabled={!puedeEditar}
                onChange={e => guardar({ autoriza_compras: e.target.checked })} />
              <span><b>Compras</b> — quien levanto la orden y conoce lo que se negocio.</span>
            </label>
            <label style={S.check}>
              <input type="checkbox" checked={!!cfg.autoriza_jefe} disabled={!puedeEditar}
                onChange={e => guardar({ autoriza_jefe: e.target.checked })} />
              <span><b>Jefe directo</b> — el segundo par de ojos, por el monto.</span>
            </label>
            {!cfg.autoriza_compras && !cfg.autoriza_jefe && (
              <p style={S.avisoNivel}>
                Sin nadie que autorice, una diferencia fuera de tolerancia solo queda registrada. Se ve en el
                reporte, pero nada impide que la factura siga su curso.
              </p>
            )}
          </div>

          <div style={S.card}>
            <p style={S.cardTit}>Como entra la factura</p>
            <label style={S.check}>
              <input type="checkbox" checked={!!cfg.captura_xml} disabled={!puedeEditar}
                onChange={e => guardar({ captura_xml: e.target.checked })} />
              <span>
                <b>Leer el XML del CFDI</b>
                <span style={S.opcionExpl}>
                  Se sube el archivo y el sistema saca emisor, UUID, conceptos, moneda, tipo de cambio e
                  impuestos. Menos captura y menos errores de dedo.
                </span>
              </span>
            </label>
            <p style={S.ayuda}>
              <b>La captura manual siempre queda disponible</b>, este o no activada la lectura del XML. Es el
              respaldo para cuando el archivo no viene, viene mal, o el proveedor es extranjero y no emite CFDI.
              Un modo automatico sin salida manual deja parada la operacion el dia que falla.
            </p>
          </div>
        </>
      )}

      <div style={S.avisoFuturo}>
        <b>Que sigue.</b> Esta pantalla deja configurado el alcance; el modulo de facturas todavia no esta
        construido. Con el nivel en <b>cotejo</b> o <b>cuentas por pagar</b>, lo que falta es la pantalla donde
        se capturan y se ligan a sus recibos. La estructura de la politica, las tolerancias y el congelamiento
        del costo ya estan listas para recibirla, y el nivel de cuentas por pagar es el punto donde despues se
        puede colgar un modulo de contabilidad.
      </div>
    </div>
  )
}

const S = {
  wrap: { padding: 24 },
  h2: { fontSize: 18, fontWeight: 600, color: '#1a1a2e', margin: 0 },
  sub: { fontSize: 13, color: '#64748b', margin: '6px 0 18px', maxWidth: 880, lineHeight: 1.6 },
  card: { background: '#fff', borderRadius: 10, padding: 18, marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  cardTit: { fontSize: 14, fontWeight: 600, color: '#1a1a2e', margin: '0 0 10px' },
  ayuda: { fontSize: 12.5, color: '#64748b', margin: '4px 0 12px', lineHeight: 1.6, maxWidth: 860 },
  opcion: { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '13px 15px', border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 8, cursor: 'pointer', fontSize: 13.5, color: '#334155' },
  opcionSel: { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '13px 15px', border: '1px solid #2563eb', background: '#eff6ff', borderRadius: 8, marginBottom: 8, cursor: 'pointer', fontSize: 13.5, color: '#1e3a8a' },
  opcionResumen: { display: 'block', fontSize: 12.5, color: '#475569', marginTop: 3, lineHeight: 1.5 },
  opcionExpl: { display: 'block', fontSize: 12, color: '#64748b', marginTop: 6, lineHeight: 1.6, maxWidth: 820 },
  opcionFalta: { display: 'block', fontSize: 11.5, color: '#b45309', marginTop: 6, lineHeight: 1.6, maxWidth: 820 },
  campoInline: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 },
  label: { fontSize: 12.5, fontWeight: 500, color: '#444', minWidth: 150 },
  inputCorto: { padding: '8px 11px', borderRadius: 7, border: '1px solid #ddd', fontSize: 14, outline: 'none', width: 110 },
  unidad: { fontSize: 12.5, color: '#64748b' },
  check: { display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 13.5, color: '#334155', cursor: 'pointer', marginBottom: 10, lineHeight: 1.5 },
  avisoNivel: { background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '10px 12px', fontSize: 12.5, color: '#92400e', marginTop: 10, lineHeight: 1.6 },
  avisoFuturo: { background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 8, padding: '12px 14px', fontSize: 12.5, color: '#475569', lineHeight: 1.6, maxWidth: 880 },
  err: { color: '#dc2626', fontSize: 13, marginBottom: 12 },
  ok: { color: '#16a34a', fontSize: 13, marginBottom: 12 },
}
