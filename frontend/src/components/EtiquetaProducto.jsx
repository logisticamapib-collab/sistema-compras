import { useState, useEffect } from 'react'
import QRCode from 'qrcode'

// Etiqueta de identificacion de material para impresora Zebra 4 x 2 in.
// Medidas en pulgadas/puntos para que la impresion salga a escala real.
// El QR lleva solo el codigo de lote: con el se ligan traspasos, salidas y bajas.
// El logo sale de los datos de la empresa (sistema comercial: sin codigos de documento fijos).

export default function EtiquetaProducto({ datos, escala = 1 }) {
  const [qr, setQr] = useState('')

  useEffect(() => {
    let vivo = true
    if (datos?.lote) {
      QRCode.toDataURL(datos.lote, { width: 400, margin: 0, errorCorrectionLevel: 'M' })
        .then(url => { if (vivo) setQr(url) })
        .catch(() => { if (vivo) setQr('') })
    }
    return () => { vivo = false }
  }, [datos?.lote])

  if (!datos) return null

  return (
    <div style={{ ...st.etiqueta, transform: escala !== 1 ? `scale(${escala})` : undefined, transformOrigin: 'top left' }} className="etiqueta-imp">
      {/* Encabezado: numero de parte y descripcion (sin titulos) + logo */}
      <div style={st.encabezado}>
        <div style={st.bloqueTexto}>
          <div style={st.numeroParte}>{datos.numeroParte}</div>
          <div style={st.descripcion}>{datos.descripcion}</div>
        </div>
        {datos.logoUrl
          ? <img src={datos.logoUrl} alt={datos.empresa} style={st.logo} />
          : <div style={st.logoTexto}>{datos.empresa}</div>}
      </div>

      {/* SNP + indicadores (lado arriba, tipo abajo y mas grande) */}
      <div style={st.filaMedia}>
        <div style={st.bloqueSnp}>
          <span style={st.rotuloSnp}>SNP:</span>
          <span style={st.cantidad}>{Number(datos.cantidad).toLocaleString('es-MX')}</span>
        </div>
        <div style={st.indicadores}>
          {datos.lado && <div style={st.lado}>{datos.lado}</div>}
          <div style={st.tipo}>{datos.tipo}</div>
        </div>
      </div>

      {/* Pie: lote / fecha / hora, sello y QR */}
      <div style={st.pie}>
        <div style={st.bloqueLote}>
          <div style={st.loteLinea}><span style={st.rotuloChico}>LOTE</span> <b style={st.loteValor}>{datos.lote}</b></div>
          {datos.maquina && <div style={st.maquina}>MAQ: <b>{datos.maquina}</b></div>}
          <div style={st.fecha}>{datos.fecha}</div>
          <div style={st.hora}>{datos.hora}</div>
        </div>
        <div style={st.sello}>SELLO:</div>
        {qr && <img src={qr} alt={datos.lote} style={st.qr} />}
      </div>
    </div>
  )
}

const st = {
  // 4 x 2 in con margen interior generoso para que nada quede pegado al borde
  etiqueta: {
    width: '4in', height: '2in', boxSizing: 'border-box',
    padding: '0.13in 0.16in', backgroundColor: '#fff', color: '#000',
    fontFamily: 'Arial, Helvetica, sans-serif', display: 'flex', flexDirection: 'column',
    border: '1px solid #000', overflow: 'hidden',
  },
  encabezado: { display: 'flex', alignItems: 'flex-start', gap: '0.08in' },
  bloqueTexto: { flex: 1, minWidth: 0 },
  numeroParte: { fontSize: '19pt', fontWeight: '700', lineHeight: '1.05', letterSpacing: '-0.2pt' },
  descripcion: { fontSize: '12pt', fontWeight: '700', lineHeight: '1.15', marginTop: '0.02in' },
  logo: { height: '0.32in', maxWidth: '0.95in', objectFit: 'contain', flexShrink: 0 },
  logoTexto: { fontSize: '8pt', fontWeight: '700', border: '1px solid #000', padding: '2pt 4pt', flexShrink: 0 },

  filaMedia: { display: 'flex', alignItems: 'center', marginTop: '0.05in' },
  bloqueSnp: { display: 'flex', alignItems: 'baseline', gap: '0.06in', flex: 1 },
  rotuloSnp: { fontSize: '12pt', fontWeight: '700' },
  cantidad: { fontSize: '26pt', fontWeight: '700', letterSpacing: '1.5pt', lineHeight: 1 },
  // Los indicadores no llegan al borde: se reservan ~1.05in de la columna del QR
  indicadores: { display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1, marginRight: '1.02in', minWidth: '0.6in' },
  lado: { fontSize: '15pt', fontWeight: '700' },
  tipo: { fontSize: '21pt', fontWeight: '700', marginTop: '0.01in' },

  pie: { display: 'flex', alignItems: 'flex-end', gap: '0.08in', marginTop: 'auto' },
  bloqueLote: { display: 'flex', flexDirection: 'column', gap: '0.5pt', width: '1.25in', flexShrink: 0 },
  loteLinea: { whiteSpace: 'nowrap' },
  rotuloChico: { fontSize: '8pt', fontWeight: '600' },
  loteValor: { fontSize: '11pt' },
  maquina: { fontSize: '8pt' },
  fecha: { fontSize: '12pt', fontWeight: '700' },
  hora: { fontSize: '9pt', fontWeight: '600' },
  sello: { flex: 1, border: '1px solid #000', height: '0.62in', fontSize: '8pt', padding: '2pt 3pt', boxSizing: 'border-box' },
  qr: { width: '0.88in', height: '0.88in', flexShrink: 0 },
}
