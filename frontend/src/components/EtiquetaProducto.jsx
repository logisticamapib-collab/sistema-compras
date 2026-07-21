import { useState, useEffect } from 'react'
import QRCode from 'qrcode'

// Etiqueta de identificacion de material (PT / WIP / MP / consigna).
// El QR lleva solo el codigo de lote: con el se ligan traspasos, salidas y bajas.
// El logo sale de los datos de la empresa (sistema comercial: sin codigos de documento fijos).

export default function EtiquetaProducto({ datos, ancho = 620 }) {
  const [qr, setQr] = useState('')

  useEffect(() => {
    let vivo = true
    if (datos?.lote) {
      QRCode.toDataURL(datos.lote, { width: 400, margin: 1, errorCorrectionLevel: 'M' })
        .then(url => { if (vivo) setQr(url) })
        .catch(() => { if (vivo) setQr('') })
    }
    return () => { vivo = false }
  }, [datos?.lote])

  if (!datos) return null
  const alto = Math.round(ancho * 0.5)

  return (
    <div style={{ ...st.etiqueta, width: `${ancho}px`, minHeight: `${alto}px` }} className="etiqueta-imp">
      {/* Encabezado: parte, descripcion y logo */}
      <div style={st.encabezado}>
        <div style={{ flex: 1 }}>
          <div style={st.renglon}>
            <span style={st.etiquetaCampo}>NUMERO DE PARTE:</span>
            <span style={st.valorGrande}>{datos.numeroParte}</span>
          </div>
          <div style={st.renglon}>
            <span style={st.etiquetaCampo}>DESCRIPCION:</span>
            <span style={st.valorMediano}>{datos.descripcion}</span>
          </div>
        </div>
        {datos.logoUrl
          ? <img src={datos.logoUrl} alt={datos.empresa} style={st.logo} />
          : <div style={st.logoTexto}>{datos.empresa}</div>}
      </div>

      {/* Cantidad + indicadores lado / tipo */}
      <div style={st.filaCantidad}>
        <div style={st.renglon}>
          <span style={st.etiquetaCampo}>CANTIDAD:</span>
          <span style={st.cantidad}>{Number(datos.cantidad).toLocaleString('es-MX')}</span>
        </div>
        <div style={st.indicadores}>
          {datos.lado && <span style={st.lado}>{datos.lado}</span>}
          <span style={st.tipo}>{datos.tipo}</span>
        </div>
      </div>

      {/* Pie: lote, fecha/hora, sello y QR */}
      <div style={st.pie}>
        <div style={st.bloqueLote}>
          <div><span style={st.etiquetaChica}>LOTE</span> <b style={st.loteValor}>{datos.lote}</b></div>
          {datos.maquina && <div style={st.maquina}>MAQUINA: <b>{datos.maquina}</b></div>}
          <div style={st.fecha}>{datos.fecha}</div>
          <div style={st.hora}>{datos.hora}</div>
          {datos.cliente && <div style={st.cliente}>{datos.cliente}</div>}
        </div>
        <div style={st.sello}>SELLO:</div>
        {qr && <img src={qr} alt={datos.lote} style={st.qr} />}
      </div>
    </div>
  )
}

const st = {
  etiqueta: { border: '2px solid #000', borderRadius: '4px', padding: '10px 14px', backgroundColor: '#fff', color: '#000', fontFamily: 'Arial, Helvetica, sans-serif', display: 'flex', flexDirection: 'column', gap: '6px', boxSizing: 'border-box' },
  encabezado: { display: 'flex', alignItems: 'flex-start', gap: '10px' },
  renglon: { display: 'flex', alignItems: 'baseline', gap: '8px' },
  etiquetaCampo: { fontSize: '15px', fontWeight: '700', letterSpacing: '-0.3px' },
  valorGrande: { fontSize: '24px', fontWeight: '700' },
  valorMediano: { fontSize: '19px', fontWeight: '700' },
  logo: { height: '42px', objectFit: 'contain' },
  logoTexto: { fontSize: '14px', fontWeight: '700', border: '1px solid #000', padding: '4px 8px' },
  filaCantidad: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  cantidad: { fontSize: '34px', fontWeight: '700', letterSpacing: '4px' },
  indicadores: { display: 'flex', alignItems: 'center', gap: '10px' },
  lado: { fontSize: '38px', fontWeight: '700', lineHeight: 1 },
  tipo: { fontSize: '24px', fontWeight: '700', lineHeight: 1 },
  pie: { display: 'flex', alignItems: 'flex-end', gap: '10px', marginTop: 'auto' },
  bloqueLote: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '150px' },
  etiquetaChica: { fontSize: '13px', fontWeight: '600' },
  loteValor: { fontSize: '17px' },
  maquina: { fontSize: '12px' },
  fecha: { fontSize: '17px', fontWeight: '700' },
  hora: { fontSize: '14px', fontWeight: '600' },
  cliente: { fontSize: '11px', color: '#333' },
  sello: { flex: 1, border: '1px solid #000', minHeight: '78px', fontSize: '12px', padding: '4px 6px' },
  qr: { width: '100px', height: '100px' },
}
