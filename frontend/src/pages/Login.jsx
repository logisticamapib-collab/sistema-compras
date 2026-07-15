import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('Correo o contrasena incorrectos')
    setLoading(false)
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <img src="/syntia-logo.png" alt="SYNTIA" style={styles.logoImagen} />
        </div>
        <h1 style={styles.titulo}>SYNTIA</h1>
        <p style={styles.tagline}>Synchronized Injection &amp; Logistics Intelligence Assistant</p>
        <p style={styles.subtitulo}>Inicia sesion para continuar</p>

        <form onSubmit={handleLogin} style={styles.form}>
          <div style={styles.campo}>
            <label style={styles.label}>Correo electronico</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={styles.input}
              placeholder="tu@correo.com"
              required
            />
          </div>
          <div style={styles.campo}>
            <label style={styles.label}>Contrasena</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={styles.input}
              placeholder="••••••••"
              required
            />
          </div>
          {error && <p style={styles.error}>{error}</p>}
          <button
            type="submit"
            style={loading ? styles.botonDeshabilitado : styles.boton}
            disabled={loading}>
            {loading ? 'Iniciando sesion...' : 'Iniciar sesion'}
          </button>
        </form>
        <p style={styles.footer}>
          Si no tienes acceso contacta al administrador del sistema
        </p>
      </div>
    </div>
  )
}

const styles = {
  container: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f2f5' },
  card: { backgroundColor: '#fff', padding: '40px', borderRadius: '12px', boxShadow: '0 2px 16px rgba(0,0,0,0.1)', width: '100%', maxWidth: '380px' },
  logo: { display: 'flex', justifyContent: 'center', marginBottom: '12px' },
  logoImagen: { width: '96px', height: '96px', objectFit: 'contain' },
  tagline: { fontSize: '11px', color: '#94a3b8', textAlign: 'center', margin: '0 0 16px 0', fontStyle: 'italic' },
  titulo: { fontSize: '20px', fontWeight: '600', color: '#1a1a2e', textAlign: 'center', margin: '0 0 4px 0' },
  subtitulo: { fontSize: '13px', color: '#666', textAlign: 'center', margin: '0 0 28px 0' },
  form: { display: 'flex', flexDirection: 'column', gap: '16px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '6px' },
  label: { fontSize: '13px', fontWeight: '500', color: '#444' },
  input: { padding: '10px 14px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' },
  boton: { padding: '12px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: '500', cursor: 'pointer', marginTop: '4px' },
  botonDeshabilitado: { padding: '12px', backgroundColor: '#93c5fd', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '15px', cursor: 'not-allowed', marginTop: '4px' },
  error: { color: '#dc2626', fontSize: '13px', textAlign: 'center', margin: '0' },
  footer: { fontSize: '12px', color: '#94a3b8', textAlign: 'center', marginTop: '20px', marginBottom: '0' }
}