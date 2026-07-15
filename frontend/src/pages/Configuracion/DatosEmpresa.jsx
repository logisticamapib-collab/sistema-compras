import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

export default function DatosEmpresa() {
  const { perfil, cargarPerfil } = useAuth()
  const [form, setForm] = useState({ nombre: '', rfc: '', direccion: '', telefono: '' })
  const [logoPreview, setLogoPreview] = useState('')
  const [archivoLogo, setArchivoLogo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [exito, setExito] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (perfil?.empresas) {
      setForm({
        nombre: perfil.empresas.nombre || '',
        rfc: perfil.empresas.rfc || '',
        direccion: perfil.empresas.direccion || '',
        telefono: perfil.empresas.telefono || ''
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
        rfc: form.rfc,
        direccion: form.direccion,
        telefono: form.telefono,
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
              <label style={styles.label}>Nombre / Razon social *</label>
              <input style={styles.input} value={form.nombre}
                onChange={e => setForm({ ...form, nombre: e.target.value })} />
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

        <div style={styles.campo}>
          <label style={styles.label}>Telefono</label>
          <input style={{ ...styles.input, maxWidth: '260px' }} value={form.telefono}
            onChange={e => setForm({ ...form, telefono: e.target.value })} />
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