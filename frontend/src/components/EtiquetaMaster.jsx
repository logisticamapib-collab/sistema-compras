import { useState, useEffect } from 'react'
import QRCode from 'qrcode'

// Etiqueta MASTER de tarima: agrupa cajas para mover muchas de golpe.
// El QR lleva el folio de la tarima; al escanearlo el sistema resuelve todas
// sus cajas, lotes y cantidades.

export default function EtiquetaMaster({ datos, config }) {
  const [qr, setQr] = useState('')
  const ancho = Number(config?.ancho_in) || 4
  const alto = Number(config?.alto_in) || 2

  useEffect(() => {
    let vivo = true
    if (datos?.folio) {
      QRCode.toDataURL(datos.folio, { width: 400, margin: 0, errorCorrectionLevel: 'M' })
        .then(u => { if (vivo) setQr(u) }).catch(() => { if (vivo) setQr('') })
    }
    return () => { vivo = false }
  }, [datos?.folio])

  if (!datos) return null

  return (
    <div style={{ ...st.etiqueta, width: `${ancho}in`, height: `${alto}in` }} className="etiqueta-imp">
      <div style={st.encabezado}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={st.master}>MASTER / TARIMA</div>
          <div style={st.folio}>{datos.folio}</div>
        </div>
        {datos.logoUrl
          ? <img src={datos.logoUrl} alt={datos.empresa} style={st.logo} />
          : <div style={st.logoTexto}>{datos.empresa}</div>}
      </div>

      <div style={st.filaMedia}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={st.parte}>{datos.numeroParte}</div>
          <div style={st.descripcion}>{datos.descripcion}</div>
        </div>
        <div style={st.indicadores}>
          {datos.lado && <div style={st.lado}>{datos.lado}</div>}
          <div style={st.tipo}>{datos.tipo}</div>
        </div>
      </div>

      <div style={st.pie}>
        <div style={st.bloque}>
          <div><span style={st.rot}>TOTAL</span> <b style={st.total}>{Number(datos.total).toLocaleString('es-MX')}</b></div>
          <div style={st.chico}>CAJAS: <b>{datos.cajas}</b></div>
          <div style={st.chico}>LOTES: <b>{datos.lotes}</b></div>
          <div style={st.fecha}>{datos.fecha}</div>
        </div>
        <div style={st.sello}>SELLO:</div>
        {qr && <img src={qr} alt={datos.folio} style={{ ...st.qr, width: `${Number(config?.tamanos?.qr_in) || 0.8}in`, height: `${Number(config?.tamanos?.qr_in) || 0.8}in` }} />}
      </div>
    </div>
  )
}

const st = {
  etiqueta: { boxSizing: 'border-box', padding: '0.07in 0.12in 0.09in', backgroundColor: '#fff', color: '#000', fontFamily: 'Arial, Helvetica, sans-serif', display: 'flex', flexDirection: 'column', border: '1px solid #000', overflow: 'hidden' },
  encabezado: { display: 'flex', alignItems: 'flex-start', gap: '0.08in', flexShrink: 0 },
  master: { fontSize: '10pt', fontWeight: '700', letterSpacing: '1pt' },
  folio: { fontSize: '20pt', fontWeight: '700', lineHeight: 1 },
  logo: { height: '0.28in', maxWidth: '0.85in', objectFit: 'contain', flexShrink: 0 },
  logoTexto: { fontSize: '8pt', fontWeight: '700', border: '1px solid #000', padding: '2pt 4pt', flexShrink: 0 },
  filaMedia: { display: 'flex', alignItems: 'center', flex: 1, minHeight: 0, overflow: 'hidden' },
  parte: { fontSize: '15pt', fontWeight: '700', lineHeight: 1.05 },
  descripcion: { fontSize: '10pt', fontWeight: '700', lineHeight: 1.05 },
  indicadores: { display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1, marginRight: '0.95in', minWidth: '0.55in' },
  lado: { fontSize: '14pt', fontWeight: '700' },
  tipo: { fontSize: '19pt', fontWeight: '700' },
  pie: { display: 'flex', alignItems: 'flex-end', gap: '0.07in', flexShrink: 0 },
  bloque: { display: 'flex', flexDirection: 'column', width: '1.35in', flexShrink: 0, lineHeight: 1.06 },
  rot: { fontSize: '8pt', fontWeight: '600' },
  total: { fontSize: '15pt' },
  chico: { fontSize: '7.5pt' },
  fecha: { fontSize: '10pt', fontWeight: '700' },
  sello: { flex: 1, border: '1px solid #000', height: '0.8in', fontSize: '8pt', padding: '2pt 3pt', boxSizing: 'border-box' },
  qr: { flexShrink: 0 },
}
