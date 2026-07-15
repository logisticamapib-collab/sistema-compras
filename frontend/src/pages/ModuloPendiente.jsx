export default function ModuloPendiente({ titulo }) {
  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.icono}>🚧</div>
        <h2 style={styles.titulo}>{titulo}</h2>
        <p style={styles.desc}>
          Este modulo forma parte del roadmap de SYNTIA MRP y todavia esta en desarrollo.
          Cuando este listo, aparecera aqui automaticamente.
        </p>
      </div>
    </div>
  )
}

const styles = {
  container: { padding: '60px 28px', display: 'flex', justifyContent: 'center' },
  card: { backgroundColor: '#fff', borderRadius: '12px', padding: '48px', maxWidth: '440px', textAlign: 'center', boxShadow: '0 1px 6px rgba(0,0,0,0.07)' },
  icono: { fontSize: '40px', marginBottom: '12px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 10px 0' },
  desc: { fontSize: '13px', color: '#666', lineHeight: '1.6', margin: '0' },
}
