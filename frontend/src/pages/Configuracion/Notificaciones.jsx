import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

export default function Notificaciones() {
  const { perfil, cargarPerfil } = useAuth()
  const [emailRemitente, setEmailRemitente] = useState('')
  const [loading, setLoading] = useState(false)
  const [exito, setExito] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    setEmailRemitente(perfil?.empresas?.email_remitente || '')
  }, [perfil])

  const guardar = async () => {
    setLoading(true)
    setError('')
    const { error } = await supabase
      .from('empresas')
      .update({ email_remitente: emailRemitente || null })
      .eq('id', perfil.empresa_id)

    if (error) {
      setError('Error al guardar: ' + error.message)
      setLoading(false)
      return
    }

    await cargarPerfil(perfil.id)
    setExito('Correo remitente actualizado correctamente')
    setLoading(false)
    setTimeout(() => setExito(''), 3000)
  }

  return (
    <div>
      <h2 style={styles.titulo}>Notificaciones por correo</h2>
      <p style={styles.subtitulo}>
        Configura el correo tecnico desde el cual se envian las notificaciones automaticas del sistema
        (aprobaciones, rechazos, etc). Los correos se veran como enviados por la persona que realizo la accion,
        pero tecnicamente salen desde esta direccion para asegurar que se entreguen correctamente.
      </p>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      <div style={styles.form}>
        <div style={styles.campo}>
          <label style={styles.label}>Correo remitente</label>
          <input style={styles.input} type="email" value={emailRemitente}
            onChange={e => setEmailRemitente(e.target.value)}
            placeholder="Dejar vacio para usar el dominio de pruebas de Resend" />
          <p style={styles.inputDesc}>
            Mientras no tengas un dominio propio verificado en Resend, deja este campo vacio
            (se usara el remitente de pruebas onboarding@resend.dev, que solo entrega a tu propio correo de Resend).
            Cuando verifiques tu dominio, escribe aqui el correo que quieres usar, ej. notificaciones@tuempresa.com.
          </p>
        </div>
        <div style={styles.botones}>
          <button style={styles.boton} onClick={guardar} disabled={loading}>
            {loading ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  )
}

const styles = {
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 6px 0' },
  subtitulo: { fontSize: '13px', color: '#666', margin: '0 0 20px 0', maxWidth: '600px' },
  form: { backgroundColor: '#fff', borderRadius: '10px', padding: '24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', maxWidth: '500px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px' },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' },
  inputDesc: { fontSize: '11px', color: '#94a3b8', margin: '4px 0 0 0' },
  botones: { display: 'flex', justifyContent: 'flex-end' },
  boton: { padding: '10px 24px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}