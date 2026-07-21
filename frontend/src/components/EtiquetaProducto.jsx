import { useState, useEffect } from 'react'
import QRCode from 'qrcode'

// Etiqueta de identificacion de material (Zebra u otra). El tamano, los campos
// visibles y los tamanos de fuente se leen de config_etiquetas, para que cada
// empresa la ajuste sin tocar codigo. El QR lleva solo el codigo de lote.

export const CONFIG_DEFECTO = {
  ancho_in: 4, alto_in: 2,
  campos: { logo: true, numero_parte: true, descripcion: true, snp: true, lado: true, tipo: true, lote: true, maquina: true, fecha: true, hora: true, cliente: false, sello: true, qr: true },
  tamanos: { numero_parte: 19, descripcion: 12, snp: 26, lado: 15, tipo: 21, lote: 11, fecha: 12, qr_in: 0.88 },
}

export default function EtiquetaProducto({ datos, config }) {
  const [qr, setQr] = useState('')
  const cfg = { ...CONFIG_DEFECTO, ...(config || {}) }
  const campos = { ...CONFIG_DEFECTO.campos, ...(cfg.campos || {}) }
  const tam = { ...CONFIG_DEFECTO.tamanos, ...(cfg.tamanos || {}) }
  const anchoQr = Number(tam.qr_in) || 0.88

  useEffect(() => {
    let vivo = true
    if (datos?.lote && campos.qr) {
      QRCode.toDataURL(datos.lote, { width: 400, margin: 0, errorCorrectionLevel: 'M' })
        .then(url => { if (vivo) setQr(url) })
        .catch(() => { if (vivo) setQr('') })
    }
    return () => { vivo = false }
  }, [datos?.lote, campos.qr])

  if (!datos) return null

  const st = estilos(cfg, tam, anchoQr)

  return (
    <div style={st.etiqueta} className="etiqueta-imp">
      {/* Numero de parte y descripcion (sin rotulos) + logo */}
      <div style={st.encabezado}>
        <div style={st.bloqueTexto}>
          {campos.numero_parte && <div style={st.numeroParte}>{datos.numeroParte}</div>}
          {campos.descripcion && <div style={st.descripcion}>{datos.descripcion}</div>}
          {campos.cliente && datos.cliente && <div style={st.cliente}>{datos.cliente}</div>}
        </div>
        {campos.logo && (datos.logoUrl
          ? <img src={datos.logoUrl} alt={datos.empresa} style={st.logo} />
          : <div style={st.logoTexto}>{datos.empresa}</div>)}
      </div>

      {/* SNP + indicadores (lado arriba, tipo abajo y mas grande) */}
      <div style={st.filaMedia}>
        {campos.snp && (
          <div style={st.bloqueSnp}>
            <span style={st.rotuloSnp}>SNP:</span>
            <span style={st.cantidad}>{Number(datos.cantidad).toLocaleString('es-MX')}</span>
          </div>
        )}
        <div style={st.indicadores}>
          {campos.lado && datos.lado && <div style={st.lado}>{datos.lado}</div>}
          {campos.tipo && <div style={st.tipo}>{datos.tipo}</div>}
        </div>
      </div>

      {/* Pie: lote / maquina / fecha / hora, sello y QR */}
      <div style={st.pie}>
        <div style={st.bloqueLote}>
          {campos.lote && <div style={st.loteLinea}><span style={st.rotuloChico}>LOTE</span> <b style={st.loteValor}>{datos.lote}</b></div>}
          {campos.maquina && datos.maquina && <div style={st.maquina}>MAQ: <b>{datos.maquina}</b></div>}
          {campos.fecha && <div style={st.fecha}>{datos.fecha}</div>}
          {campos.hora && <div style={st.hora}>{datos.hora}</div>}
        </div>
        {campos.sello && <div style={st.sello}>SELLO:</div>}
        {campos.qr && qr && <img src={qr} alt={datos.lote} style={st.qr} />}
      </div>
    </div>
  )
}

function estilos(cfg, tam, anchoQr) {
  return {
    etiqueta: {
      width: `${cfg.ancho_in}in`, height: `${cfg.alto_in}in`, boxSizing: 'border-box',
      // padding inferior mayor para que el pie nunca toque el borde
      padding: '0.10in 0.14in 0.14in', backgroundColor: '#fff', color: '#000',
      fontFamily: 'Arial, Helvetica, sans-serif', display: 'flex', flexDirection: 'column',
      border: '1px solid #000', overflow: 'hidden',
    },
    encabezado: { display: 'flex', alignItems: 'flex-start', gap: '0.08in', flexShrink: 0 },
    bloqueTexto: { flex: 1, minWidth: 0 },
    numeroParte: { fontSize: `${tam.numero_parte}pt`, fontWeight: '700', lineHeight: '1.02', letterSpacing: '-0.2pt' },
    descripcion: { fontSize: `${tam.descripcion}pt`, fontWeight: '700', lineHeight: '1.1' },
    cliente: { fontSize: `${Math.max(7, Number(tam.descripcion) - 3)}pt`, fontWeight: '600', lineHeight: '1.1' },
    logo: { height: '0.30in', maxWidth: '0.9in', objectFit: 'contain', flexShrink: 0 },
    logoTexto: { fontSize: '8pt', fontWeight: '700', border: '1px solid #000', padding: '2pt 4pt', flexShrink: 0 },

    filaMedia: { display: 'flex', alignItems: 'center', flexShrink: 0, marginTop: '0.02in' },
    bloqueSnp: { display: 'flex', alignItems: 'baseline', gap: '0.06in', flex: 1 },
    rotuloSnp: { fontSize: '11pt', fontWeight: '700' },
    cantidad: { fontSize: `${tam.snp}pt`, fontWeight: '700', letterSpacing: '1.5pt', lineHeight: 1 },
    indicadores: { display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1, marginRight: `${anchoQr + 0.14}in`, minWidth: '0.55in' },
    lado: { fontSize: `${tam.lado}pt`, fontWeight: '700' },
    tipo: { fontSize: `${tam.tipo}pt`, fontWeight: '700' },

    // El pie ya no se empuja al fondo: sube un poco para que nada se corte
    pie: { display: 'flex', alignItems: 'flex-end', gap: '0.08in', marginTop: 'auto', flexShrink: 0 },
    bloqueLote: { display: 'flex', flexDirection: 'column', gap: '0', width: '1.22in', flexShrink: 0, lineHeight: '1.12' },
    loteLinea: { whiteSpace: 'nowrap' },
    rotuloChico: { fontSize: '8pt', fontWeight: '600' },
    loteValor: { fontSize: `${tam.lote}pt` },
    maquina: { fontSize: '8pt' },
    fecha: { fontSize: `${tam.fecha}pt`, fontWeight: '700' },
    hora: { fontSize: '9pt', fontWeight: '600' },
    sello: { flex: 1, border: '1px solid #000', height: `${anchoQr - 0.06}in`, fontSize: '8pt', padding: '2pt 3pt', boxSizing: 'border-box' },
    qr: { width: `${anchoQr}in`, height: `${anchoQr}in`, flexShrink: 0 },
  }
}
