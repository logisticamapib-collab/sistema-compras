import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { aIdentidad } from '../lib/accesoInterno'

import Captcha, { CAPTCHA_ACTIVO, reiniciarCaptcha } from '../components/Captcha'


// Que decirle al usuario cuando no entra.
//
// La primera version tapaba TODO con "Datos incorrectos". Eso costo una tarde:
// se encendio el CAPTCHA en Supabase antes de poner la llave en el navegador,
// Supabase empezo a rechazar por falta de token, y la pantalla dijo que la
// contrasena estaba mal. Se busco el problema donde no estaba.
//
// La regla ahora: solo se generaliza cuando el error ES de credenciales.
// Cualquier otra cosa se muestra tal cual, aunque suene tecnica, porque un
// mensaje tecnico que apunta al lugar correcto vale mas que uno amable que
// manda a buscar a otro lado.
function mensajeDeError(error) {
  const m = String(error?.message || '')

  if (/captcha/i.test(m)) {
    return 'El sistema esta pidiendo verificacion CAPTCHA y este navegador no la esta enviando. '
      + 'Falta configurar VITE_TURNSTILE_SITE_KEY, o hay que apagar la proteccion en Supabase.'
  }
  if (error?.status === 429 || /demasiados|too many|rate limit/i.test(m)) {
    return /demasiados/i.test(m) ? m : 'Demasiados intentos. Espera un momento antes de volver a intentar.'
  }
  if (/invalid login credentials|invalid_credentials/i.test(m)) {
    return 'Datos incorrectos. Revisa tu correo o numero de empleado y tu contrasena.'
  }
  if (/email not confirmed/i.test(m)) {
    return 'Tu cuenta todavia no esta confirmada. Pide que te reenvien el acceso.'
  }
  // Lo que no reconocemos se muestra completo, a proposito.
  return m || 'No se pudo iniciar sesion.'
}

export default function Login() {
  // Aqui puede venir un correo o un numero de empleado; se resuelve al enviar.
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [captcha, setCaptcha] = useState('')

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithPassword({
      email: aIdentidad(email),
      password,
      ...(CAPTCHA_ACTIVO ? { options: { captchaToken: captcha } } : {}),
    })
    if (error) {
      setError(mensajeDeError(error))
      // El token es de un solo uso: si no se pide otro, el siguiente intento
      // falla por el captcha y no por la contrasena.
      reiniciarCaptcha(); setCaptcha('')
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
          <Captcha onToken={setCaptcha} />
          {error && <p style={styles.error}>{error}</p>}
          <button
            type="submit"
            style={(loading || (CAPTCHA_ACTIVO && !captcha)) ? styles.botonDeshabilitado : styles.boton}
            disabled={loading || (CAPTCHA_ACTIVO && !captcha)}>
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