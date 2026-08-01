import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

export default function DatosEmpresa() {
  const { perfil, cargarPerfil } = useAuth()
  const [form, setForm] = useState({ nombre: '', razon_social: '', rfc: '', direccion: '', ciudad: '', estado: '', cp: '', pais: 'Mexico', telefono: '', email: '', email_remitente: '' })
  const [logoPreview, setLogoPreview] = useState('')
  const [archivoLogo, setArchivoLogo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [exito, setExito] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (perfil?.empresas) {
      setForm({
        nombre: perfil.empresas.nombre || '',
        razon_social: perfil.empresas.razon_social || '',
        rfc: perfil.empresas.rfc || '',
        direccion: perfil.empresas.direccion || '',
        ciudad: perfil.empresas.ciudad || '',
        estado: perfil.empresas.estado || '',
        cp: perfil.empresas.cp || '',
        pais: perfil.empresas.pais || 'Mexico',
        telefono: perfil.empresas.telefono || '',
        email: perfil.empresas.email || '',
        email_remitente: perfil.empresas.email_remitente || '',
      })
      setLogoPreview(perfil.empresas.logo_url || '')
    }
  }, [perfil])

  const seleccionarLogo = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setArchivoLogo(file)
    setLogoPreview(URL.createObjectURL(file))
  }

  const guardar = async () => {
    if (!form.nombre) {
      setError('El nombre de la empresa es obligatorio')
      return
    }
    setError('')
    setLoading(true)

    let logoUrl = perfil?.empresas?.logo_url || null

    if (archivoLogo) {
      const extension = archivoLogo.name.split('.').pop()
      const rutaArchivo = `logos/empresa-${perfil.empresa_id}.${extension}`

      const { error: errorSubida } = await supabase.storage
        .from('empresa-assets')
        .upload(rutaArchivo, archivoLogo, { upsert: true })

      if (errorSubida) {
        setError('Error al subir el logo: ' + errorSubida.message)
        setLoading(false)
        return
      }

      const { data: urlData } = supabase.storage
        .from('empresa-assets')
        .getPublicUrl(rutaArchivo)

      logoUrl = urlData.publicUrl + '?t=' + Date.now()
    }

    const { error: errorUpdate } = await supabase
      .from('empresas')
      .update({
        nombre: form.nombre,
        razon_social: form.razon_social || null,
        rfc: form.rfc,
        direccion: form.direccion,
        ciudad: form.ciudad || null,
        estado: form.estado || null,
        cp: form.cp || null,
        pais: form.pais || null,
        telefono: form.telefono,
        email: form.email || null,
        email_remitente: form.email_remitente || null,
        logo_url: logoUrl
      })
      .eq('id', perfil.empresa_id)

    if (errorUpdate) {
      setError('Error al guardar: ' + errorUpdate.message)
      setLoading(false)
      return
    }

    await cargarPerfil(perfil.id)
    setExito('Datos de la empresa actualizados correctamente')
    setArchivoLogo(null)
    setLoading(false)
    setTimeout(() => setExito(''), 3000)
  }

  return (
    <div>
      <h2 style={styles.titulo}>Datos de la Empresa</h2>
      <p style={styles.subtitulo}>
        Esta informacion y el logo se usan en los formatos imprimibles (Requisiciones, Ordenes de Compra) y en reportes.
      </p>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      <div style={styles.form}>
        <div style={styles.fila}>
          <div style={styles.logoBox}>
            {logoPreview ? (
              <img src={logoPreview} alt="Logo" style={styles.logoImagen} />
            ) : (
              <span style={styles.logoPlaceholder}>Sin logo</span>
            )}
            <label style={styles.botonSubir}>
              {logoPreview ? 'Cambiar logo' : 'Subir logo'}
              <input type="file" accept="image/*" onChange={seleccionarLogo} style={{ display: 'none' }} />
            </label>
          </div>
          <div style={{ flex: 1 }}>
            <div style={styles.campo}>
              <label style={styles.label}>Nombre comercial *</label>
              <input style={styles.input} value={form.nombre}
                onChange={e => setForm({ ...form, nombre: e.target.value })} />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Razon social</label>
              <input style={styles.input} value={form.razon_social}
                onChange={e => setForm({ ...form, razon_social: e.target.value })} />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>RFC</label>
              <input style={styles.input} value={form.rfc}
                onChange={e => setForm({ ...form, rfc: e.target.value.toUpperCase() })} />
            </div>
          </div>
        </div>

        <div style={styles.campo}>
          <label style={styles.label}>Direccion</label>
          <textarea style={styles.textarea} value={form.direccion}
            onChange={e => setForm({ ...form, direccion: e.target.value })}
            rows={2} placeholder="Calle, numero, colonia, municipio, estado, C.P." />
        </div>

        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
          <div style={{ ...styles.campo, flex: 1, minWidth: '180px' }}>
            <label style={styles.label}>Ciudad / Municipio</label>
            <input style={styles.input} value={form.ciudad}
              onChange={e => setForm({ ...form, ciudad: e.target.value })} />
          </div>
          <div style={{ ...styles.campo, flex: 1, minWidth: '180px' }}>
            <label style={styles.label}>Estado</label>
            <input style={styles.input} value={form.estado}
              onChange={e => setForm({ ...form, estado: e.target.value })} />
          </div>
          <div style={{ ...styles.campo, width: '130px' }}>
            <label style={styles.label}>C.P.</label>
            <input style={styles.input} value={form.cp}
              onChange={e => setForm({ ...form, cp: e.target.value })} />
          </div>
          <div style={{ ...styles.campo, flex: 1, minWidth: '150px' }}>
            <label style={styles.label}>Pais</label>
            <input style={styles.input} value={form.pais}
              onChange={e => setForm({ ...form, pais: e.target.value })} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
          <div style={{ ...styles.campo, flex: 1, minWidth: '220px' }}>
            <label style={styles.label}>Telefono</label>
            <input style={styles.input} value={form.telefono}
              onChange={e => setForm({ ...form, telefono: e.target.value })} />
          </div>
          <div style={{ ...styles.campo, flex: 1, minWidth: '240px' }}>
            <label style={styles.label}>Email de contacto</label>
            <input style={styles.input} type="email" value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })} />
          </div>
          <div style={{ ...styles.campo, flex: 1, minWidth: '240px' }}>
            <label style={styles.label}>Email remitente (notificaciones)</label>
            <input style={styles.input} type="email" value={form.email_remitente}
              onChange={e => setForm({ ...form, email_remitente: e.target.value })}
              placeholder="Desde donde se envian los correos del sistema" />
          </div>
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
  form: { backgroundColor: '#fff', borderRadius: '10px', padding: '24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', maxWidth: '650px' },
  fila: { display: 'flex', gap: '20px', marginBottom: '8px' },
  logoBox: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', width: '140px' },
  logoImagen: { width: '120px', height: '120px', objectFit: 'contain', border: '1px solid #e2e8f0', borderRadius: '8px', backgroundColor: '#f8fafc' },
  logoPlaceholder: { width: '120px', height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed #cbd5e1', borderRadius: '8px', color: '#94a3b8', fontSize: '12px' },
  botonSubir: { fontSize: '12px', color: '#2563eb', cursor: 'pointer', textAlign: 'center' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px' },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' },
  textarea: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', resize: 'vertical', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' },
  botones: { display: 'flex', justifyContent: 'flex-end' },
  boton: { padding: '10px 24px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}