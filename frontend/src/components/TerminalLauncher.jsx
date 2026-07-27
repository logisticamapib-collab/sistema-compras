import { useState } from 'react'

// Launcher de terminal por area (tablet). Pantalla completa con botones grandes
// que abren la pantalla operativa correspondiente del area, tambien en full.
export default function TerminalLauncher({ titulo, opciones }) {
  const [sel, setSel] = useState(null)
  const [full, setFull] = useState(true)
  const wrap = full ? { ...styles.wrap, ...styles.wrapFull } : styles.wrap

  if (sel != null) {
    const O = opciones[sel]; const Comp = O.Comp
    return (
      <div style={wrap}>
        <div style={styles.bar}>
          <button style={styles.back} onClick={() => setSel(null)}>&larr; {titulo}</button>
          <button style={styles.back} onClick={() => setFull(f => !f)}>{full ? 'Mostrar menu' : 'Pantalla completa'}</button>
        </div>
        <div style={styles.body}><Comp /></div>
      </div>
    )
  }
  return (
    <div style={wrap}>
      <div style={styles.bar}>
        <h2 style={styles.h1}>{titulo}</h2>
        <button style={styles.back} onClick={() => setFull(f => !f)}>{full ? 'Mostrar menu' : 'Pantalla completa'}</button>
      </div>
      <div style={styles.grid}>
        {opciones.map((o, i) => (
          <button key={i} style={{ ...styles.tile, backgroundColor: o.color || '#334155' }} onClick={() => setSel(i)}>
            <span style={styles.tileTxt}>{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

const styles = {
  wrap: { backgroundColor: '#0f172a', borderRadius: '12px', padding: '18px', minHeight: 'calc(100vh - 90px)' },
  wrapFull: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, borderRadius: 0, overflow: 'auto' },
  bar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  h1: { color: '#fff', fontSize: '22px', fontWeight: 800, margin: 0 },
  back: { padding: '10px 18px', backgroundColor: '#1e293b', color: '#cbd5e1', border: '1px solid #334155', borderRadius: '8px', fontSize: '15px', cursor: 'pointer' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' },
  tile: { border: 'none', borderRadius: '16px', padding: '48px 22px', color: '#fff', cursor: 'pointer', fontSize: '24px', fontWeight: 800, minHeight: '150px', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' },
  tileTxt: { lineHeight: 1.2 },
  body: { backgroundColor: '#f8fafc', borderRadius: '10px', minHeight: '70vh' },
}
