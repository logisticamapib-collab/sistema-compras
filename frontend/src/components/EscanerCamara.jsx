import { useEffect, useRef, useState } from 'react'

// Boton de camara reutilizable para los puntos de escaneo. Usa la camara del
// dispositivo (facingMode environment) y BarcodeDetector nativo para leer QR /
// codigos y devolver el texto por onScan. Fallback claro si no hay soporte.
export default function EscanerCamara({ onScan, title = 'Escanear con la camara' }) {
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState('')
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const rafRef = useRef(null)
  const soportado = typeof window !== 'undefined' && 'BarcodeDetector' in window

  const detener = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
  }
  const cerrar = () => { detener(); setOpen(false) }

  const loop = () => {
    rafRef.current = requestAnimationFrame(async () => {
      const v = videoRef.current
      if (!v || v.readyState < 2) { loop(); return }
      try {
        let det
        try { det = new window.BarcodeDetector({ formats: ['qr_code', 'data_matrix', 'code_128', 'code_39', 'ean_13'] }) }
        catch { det = new window.BarcodeDetector() }
        const codes = await det.detect(v)
        if (codes && codes.length && codes[0].rawValue) {
          const val = codes[0].rawValue
          cerrar()
          onScan && onScan(val)
          return
        }
      } catch { /* seguir intentando */ }
      loop()
    })
  }

  const abrir = async () => {
    setErr(''); setOpen(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } })
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play() }
      if (soportado) loop()
    } catch (e) { setErr('No se pudo abrir la camara: ' + (e.message || e)) }
  }

  useEffect(() => () => detener(), [])

  return (
    <>
      <button type="button" title={title} onClick={abrir} style={styles.camBtn} aria-label="Escanear con camara">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      </button>
      {open && (
        <div style={styles.overlay} onClick={cerrar}>
          <div style={styles.box} onClick={e => e.stopPropagation()}>
            <div style={styles.head}><span>Escanear QR / codigo</span><button style={styles.x} onClick={cerrar}>✕</button></div>
            <div style={styles.videoWrap}>
              <video ref={videoRef} style={styles.video} playsInline muted />
              <div style={styles.mira} />
            </div>
            {!soportado && <p style={styles.warn}>Este navegador no soporta lectura por camara. Usa Chrome en Android o el escaner fisico.</p>}
            {err && <p style={styles.warn}>{err}</p>}
            <p style={styles.hint}>Enfoca el codigo dentro del recuadro.</p>
          </div>
        </div>
      )}
    </>
  )
}

const styles = {
  camBtn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '42px', height: '42px', backgroundColor: '#0f172a', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' },
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 },
  box: { backgroundColor: '#fff', borderRadius: '12px', padding: '16px', width: '380px', maxWidth: '94vw' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', fontWeight: 600, color: '#1a1a2e' },
  x: { background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#64748b' },
  videoWrap: { position: 'relative', width: '100%', aspectRatio: '1 / 1', backgroundColor: '#000', borderRadius: '10px', overflow: 'hidden' },
  video: { width: '100%', height: '100%', objectFit: 'cover' },
  mira: { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: '62%', height: '62%', border: '3px solid #22c55e', borderRadius: '12px', boxShadow: '0 0 0 2000px rgba(0,0,0,0.25)' },
  warn: { color: '#b45309', fontSize: '12.5px', marginTop: '10px' },
  hint: { color: '#64748b', fontSize: '12px', marginTop: '8px', textAlign: 'center' },
}
