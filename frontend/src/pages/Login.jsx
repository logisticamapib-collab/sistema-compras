import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { aIdentidad } from '../lib/accesoInterno'

// CAPTCHA (Cloudflare Turnstile).
//
// Es el unico control que de verdad frena un ataque automatizado, y la razon
// es donde vive: Supabase valida el token del lado del SERVIDOR, asi que un
// script que pega directo al endpoint -- sin pasar por esta pantalla -- tambien
// tiene que resolverlo. Cualquier contador que pusieramos en el navegador se
// lo salta sin enterarse.
//
// Se activa poniendo VITE_TURNSTILE_SITE_KEY en el .env. Si no esta, el login
// funciona igual que siempre: asi nadie se queda afuera por una llave que
// falta, ni en desarrollo ni el dia que se cambie de proveedor.
const CLAVE_CAPTCHA = import.meta.env.VITE_TURNSTILE_SITE_KEY || ''

export default function Login() {
  // Aqui puede venir un correo o un numero de empleado; se resuelve al enviar.
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [captcha, setCaptcha] = useState('')
  const cajaCaptcha = useRef(null)

  useEffect(() => {
    if (!CLAVE_CAPTCHA) return
    const pintar = () => {
      if (!window.turnstile || !cajaCaptcha.current || cajaCaptcha.current.dataset.listo) return
      cajaCaptcha.current.dataset.listo = '1'
      window.turnstile.render(cajaCaptcha.current, {
        sitekey: CLAVE_CAPTCHA,
        callback: setCaptcha,
        // Si el token caduca antes de que la persona apriete Entrar, se limpia
        // para que no mande uno muerto y vea un error que no entiende.
        'expired-callback': () => setCaptcha(''),
        'error-callback': () => setCaptcha(''),
      })
    }
    if (window.turnstile) { pintar(); return }
    const et = document.createElement('script')
    et.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    et.async = true
    et.onload = pintar
    document.head.appendChild(et)
  }, [])

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithPassword({
      email: aIdentidad(email),
      password,
      ...(CLAVE_CAPTCHA ? { options: { captchaToken: captcha } } : {}),
    })
    if (error) {
      // 429 es el freno por intentos fallidos, y su mensaje ya viene escrito
      // para el usuario desde la base. No hay que taparlo con el generico.
      setError(error.status === 429 || /demasiados/i.test(error.message)
        ? error.message
        : 'Datos incorrectos. Revisa tu correo o numero de empleado y tu contrasena.')
      // El token es de un solo uso: si no se pide otro, el siguiente intento
      // falla por el captcha y no por la contrasena.
      if (CLAVE_CAPTCHA && window.turnstile) { window.turnstile.reset(); setCaptcha('') }
    }
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
            <label style={styles.label}>Correo o numero de empleado</label>
            <input
              type="text"
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={styles.input}
              placeholder="tu@correo.com  o  10432"
              autoCapitalize="none"
              autoCorrect="off"
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
          {CLAVE_CAPTCHA && <div ref={cajaCaptcha} style={{ display: 'flex', justifyContent: 'center' }} />}
          {error && <p style={styles.error}>{error}</p>}
          <button
            type="submit"
            style={(loading || (CLAVE_CAPTCHA && !captcha)) ? styles.botonDeshabilitado : styles.boton}
            disabled={loading || (CLAVE_CAPTCHA && !captcha)}>
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