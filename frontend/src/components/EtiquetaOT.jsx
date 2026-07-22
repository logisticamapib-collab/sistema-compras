import { useState, useEffect } from 'react'
import QRCode from 'qrcode'

// Etiqueta chica (4x4 cm) que se imprime al generar la OT y se entrega al operador.
// El operador la pega en cada caja al nacer el producto. El QR contiene el FOLIO
// DE LA OT: al escanearlo en "Declarar produccion", el sistema selecciona solo
// esa OT/producto y el operador no se equivoca. Ademas muestra el codigo del
// articulo y el SNP para evitar confusiones en piso.

export default function EtiquetaOT({ datos, ladoCm = 4 }) {
  const [qr, setQr] = useState('')

  useEffect(() => {
    let vivo = true
    if (datos?.folioOt) {
      QRCode.toDataURL(datos.folioOt, { width: 300, margin: 0, errorCorrectionLevel: 'M' })
        .then(u => { if (vivo) setQr(u) }).catch(() => { if (vivo) setQr('') })
    }
    return () => { vivo = false }
  }, [datos?.folioOt])

  if (!datos) return null

  return (
    <div style={{ ...st.etiqueta, width: `${ladoCm}cm`, height: `${ladoCm}cm` }} className="etiqueta-imp">
      {qr && <img src={qr} alt={datos.folioOt} style={st.qr} />}
      <div style={st.folio}>{datos.folioOt}</div>
      <div style={st.articulo}>{datos.codigoArticulo}</div>
      <div style={st.snp}>SNP: <b>{Number(datos.snp || 0).toLocaleString('es-MX')}</b></div>
    </div>
  )
}

const st = {
  etiqueta: {
    boxSizing: 'border-box', padding: '0.12cm', backgroundColor: '#fff', color: '#000',
    fontFamily: 'Arial, Helvetica, sans-serif', border: '1px solid #000',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', overflow: 'hidden',
  },
  qr: { width: '2.5cm', height: '2.5cm' },
  folio: { fontSize: '10pt', fontWeight: '700', lineHeight: 1 },
  articulo: { fontSize: '7pt', fontWeight: '600', lineHeight: 1 },
  snp: { fontSize: '9pt', lineHeight: 1 },
}
