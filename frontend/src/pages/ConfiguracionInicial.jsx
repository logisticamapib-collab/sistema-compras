import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// Asistente de arranque: da de alta la empresa, sus sites, y convierte en
// admin a quien lo corre.
//
// Se llegaba aqui con solo no tener empresa asignada, y eso lo volvia una
// puerta: cualquiera que consiguiera una cuenta caia en esta pantalla y salia
// de ella siendo administrador. Con el registro publico abierto, eso era
// cualquier persona con un correo.
//
// Ahora solo corre si la base esta VACIA de empresas, que es lo unico que
// significa "instalacion nueva". Si ya hay una empresa, este usuario es
// alguien a quien le falta que lo den de alta, y eso lo hace un administrador,
// no el mismo.

const siteVacio = {
  nombre: '', codigo: '', razon_social: '', rfc: '',
  telefono: '', email: '', direccion: '', ciudad: '', estado: '', cp: ''
}

export default function ConfiguracionInicial() {
  const { user, cargarPerfil } = useAuth()
  const [revisando, setRevisando] = useState(true)
  const [yaHayEmpresa, setYaHayEmpresa] = useState(false)
  const [paso, setPaso] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [empresaId, setEmpresaId] = useState(null)
  const [multiples, setMultiples] = useState(null)
  const [sites, setSites] = useState([{ ...siteVacio }])
  const [siteActual, setSiteActual] = useState(0)

  const [empresa, setEmpresa] = useState({
    nombre: '', razon_social: '', rfc: '', telefono: '',
    email: '', direccion: '', ciudad: '', estado: '', cp: ''
  })

  useEffect(() => {
    // head:true trae solo la cuenta, sin los datos.
    supabase.from('empresas').select('id', { count: 'exact', head: true })
      .then(({ count }) => { setYaHayEmpresa((count || 0) > 0); setRevisando(false) })
  }, [])

  const actualizarSite = (campo, valor) => {
    const nuevos = [...sites]
    nuevos[siteActual] = { ...nuevos[siteActual], [campo]: valor }
    setSites(nuevos)
  }

  const agregarSite = () => {
    setSites([...sites, { ...siteVacio }])
    setSiteActual(sites.length)
  }

  const eliminarSite = (index) => {
    if (sites.length === 1) return
    const nuevos = sites.filter((_, i) => i !== index)
    setSites(nuevos)
    setSiteActual(Math.max(0, siteActual - 1))
  }

  const guardarEmpresa = async () => {
    if (!empresa.nombre || !empresa.razon_social) {
      setError('Nombre comercial y razon social son obligatorios')
      return
    }
    setLoading(true)
    setError('')

    const { data, error } = await supabase
      .from('empresas')
      .insert(empresa)
      .select()
      .single()

    if (error) {
      setError('Error al guardar empresa: ' + error.message)
      setLoading(false)
      return
    }

    setEmpresaId(data.id)
    setPaso(2)
    setLoading(false)
  }

  const guardarSites = async () => {
    const sitesValidos = sites.filter(s => s.nombre && s.codigo)
    if (sitesValidos.length === 0) {
      setError('Debes capturar al menos un site con nombre y codigo')
      return
    }

    setLoading(true)
    setError('')

    const sitesConEmpresa = sitesValidos.map(s => ({
      ...s,
      codigo: s.codigo.toUpperCase(),
      empresa_id: empresaId
    }))

    const { data: sitesGuardados, error: errorSites } = await supabase
      .from('sites')
      .insert(sitesConEmpresa)
      .select()

    if (errorSites) {
      setError('Error al guardar sites: ' + errorSites.message)
      setLoading(false)
      return
    }

    const primerSite = sitesGuardados[0]

    const { error: errorUsuario } = await supabase
      .from('usuarios')
      .update({
        empresa_id: empresaId,
        site_id: primerSite.id,
        rol: 'admin'
      })
      .eq('id', user.id)

    if (errorUsuario) {
      setError('Error al actualizar perfil: ' + errorUsuario.message)
      setLoading(false)
      return
    }

    await cargarPerfil(user.id)
    setLoading(false)
  }

  if (revisando) {
    return <p style={{ textAlign: 'center', marginTop: '40px' }}>Cargando...</p>
  }

  // Ya hay empresa: esto no es una instalacion nueva, es un usuario al que le
  // falta que lo den de alta. Se le dice quien lo puede resolver, en vez de
  // dejarlo crear una empresa paralela y nombrarse administrador de ella.
  if (yaHayEmpresa) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.titulo}>Tu usuario todavia no esta asignado</h1>
          <p style={styles.subtitulo}>
            Entraste bien, pero tu cuenta no esta ligada a ninguna empresa ni planta, asi que
            no hay nada que mostrarte todavia.
          </p>
          <p style={{ ...styles.subtitulo, marginTop: '12px' }}>
            Pidele al administrador del sistema que te de de alta en Configuracion &rarr; Usuarios.
            Tu correo es <strong>{user?.email}</strong>; se lo va a pedir.
          </p>
          <button style={styles.boton} onClick={() => supabase.auth.signOut()}>Salir</button>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.titulo}>Bienvenido a SYNTIA</h1>
        <p style={styles.subtitulo}>Configura tu empresa para comenzar</p>

        <div style={styles.pasos}>
          <div style={paso === 1 ? styles.pasoActivo : styles.pasoCompletado}>
            {paso > 1 ? '✓' : '1'} Datos de la empresa
          </div>
          <div style={styles.lineaPaso}></div>
          <div style={paso === 2 ? styles.pasoActivo : styles.pasoInactivo}>
            2 Sites / Plantas
          </div>
        </div>

        {error && <p style={styles.error}>{error}</p>}

        {paso === 1 && (
          <div style={styles.form}>
            <div style={styles.fila}>
              <div style={styles.campo}>
                <label style={styles.label}>Nombre comercial *</label>
                <input style={styles.input} value={empresa.nombre}
                  onChange={e => setEmpresa({ ...empresa, nombre: e.target.value })}
                  placeholder="Ej: MAPIB" />
              </div>
              <div style={styles.campo}>
                <label style={styles.label}>Razon social *</label>
                <input style={styles.input} value={empresa.razon_social}
                  onChange={e => setEmpresa({ ...empresa, razon_social: e.target.value })}
                  placeholder="Ej: MAPIB SA de CV" />
              </div>
            </div>
            <div style={styles.fila}>
              <div style={styles.campo}>
                <label style={styles.label}>RFC</label>
                <input style={styles.input} value={empresa.rfc}
                  onChange={e => setEmpresa({ ...empresa, rfc: e.target.value })}
                  placeholder="Ej: MAP123456XX1" />
              </div>
              <div style={styles.campo}>
                <label style={styles.label}>Telefono</label>
                <input style={styles.input} value={empresa.telefono}
                  onChange={e => setEmpresa({ ...empresa, telefono: e.target.value })}
                  placeholder="Ej: 442 123 4567" />
              </div>
            </div>
            <div style={styles.fila}>
              <div style={styles.campo}>
                <label style={styles.label}>Email corporativo</label>
                <input style={styles.input} value={empresa.email}
                  onChange={e => setEmpresa({ ...empresa, email: e.target.value })}
                  placeholder="contacto@empresa.com" />
              </div>
              <div style={styles.campo}>
                <label style={styles.label}>Codigo postal</label>
                <input style={styles.input} value={empresa.cp}
                  onChange={e => setEmpresa({ ...empresa, cp: e.target.value })}
                  placeholder="Ej: 76000" />
              </div>
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Direccion</label>
              <input style={styles.input} value={empresa.direccion}
                onChange={e => setEmpresa({ ...empresa, direccion: e.target.value })}
                placeholder="Calle, numero, colonia" />
            </div>
            <div style={styles.fila}>
              <div style={styles.campo}>
                <label style={styles.label}>Ciudad</label>
                <input style={styles.input} value={empresa.ciudad}
                  onChange={e => setEmpresa({ ...empresa, ciudad: e.target.value })}
                  placeholder="Ej: Queretaro" />
              </div>
              <div style={styles.campo}>
                <label style={styles.label}>Estado</label>
                <input style={styles.input} value={empresa.estado}
                  onChange={e => setEmpresa({ ...empresa, estado: e.target.value })}
                  placeholder="Ej: Queretaro" />
              </div>
            </div>

            <div style={styles.pregunta}>
              <p style={styles.preguntaTexto}>Tu empresa opera en mas de una ubicacion?</p>
              <div style={styles.opciones}>
                <button
                  style={multiples === false ? styles.opcionActiva : styles.opcion}
                  onClick={() => { setMultiples(false); setSites([{ ...siteVacio }]) }}>
                  Un solo site
                </button>
                <button
                  style={multiples === true ? styles.opcionActiva : styles.opcion}
                  onClick={() => setMultiples(true)}>
                  Multiples sites
                </button>
              </div>
            </div>

            <button
              style={loading || multiples === null ? styles.botonDeshabilitado : styles.boton}
              disabled={loading || multiples === null || !empresa.nombre || !empresa.razon_social}
              onClick={guardarEmpresa}>
              {loading ? 'Guardando...' : 'Continuar'}
            </button>
          </div>
        )}

        {paso === 2 && (
          <div style={styles.form}>
            {multiples && (
              <div style={styles.tabs}>
                {sites.map((s, i) => (
                  <button
                    key={i}
                    style={i === siteActual ? styles.tabActivo : styles.tab}
                    onClick={() => setSiteActual(i)}>
                    {s.nombre || `Site ${i + 1}`}
                    {sites.length > 1 && i === siteActual && (
                      <span
                        style={styles.eliminarTab}
                        onClick={e => { e.stopPropagation(); eliminarSite(i) }}>
                        x
                      </span>
                    )}
                  </button>
                ))}
                <button style={styles.tabAgregar} onClick={agregarSite}>
                  + Agregar site
                </button>
              </div>
            )}

            <div style={styles.fila}>
              <div style={styles.campo}>
                <label style={styles.label}>Nombre del site *</label>
                <input style={styles.input} value={sites[siteActual].nombre}
                  onChange={e => actualizarSite('nombre', e.target.value)}
                  placeholder="Ej: Planta Queretaro" />
              </div>
              <div style={styles.campo}>
                <label style={styles.label}>Codigo del site *</label>
                <input style={styles.input} value={sites[siteActual].codigo}
                  onChange={e => actualizarSite('codigo', e.target.value.toUpperCase())}
                  placeholder="Ej: PLT1" maxLength={6} />
              </div>
            </div>
            <div style={styles.fila}>
              <div style={styles.campo}>
                <label style={styles.label}>Razon social</label>
                <input style={styles.input} value={sites[siteActual].razon_social}
                  onChange={e => actualizarSite('razon_social', e.target.value)}
                  placeholder="Si es diferente a la empresa" />
              </div>
              <div style={styles.campo}>
                <label style={styles.label}>RFC</label>
                <input style={styles.input} value={sites[siteActual].rfc}
                  onChange={e => actualizarSite('rfc', e.target.value)}
                  placeholder="Si es diferente a la empresa" />
              </div>
            </div>
            <div style={styles.fila}>
              <div style={styles.campo}>
                <label style={styles.label}>Telefono</label>
                <input style={styles.input} value={sites[siteActual].telefono}
                  onChange={e => actualizarSite('telefono', e.target.value)}
                  placeholder="442 123 4567" />
              </div>
              <div style={styles.campo}>
                <label style={styles.label}>Email</label>
                <input style={styles.input} value={sites[siteActual].email}
                  onChange={e => actualizarSite('email', e.target.value)}
                  placeholder="planta@empresa.com" />
              </div>
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Direccion</label>
              <input style={styles.input} value={sites[siteActual].direccion}
                onChange={e => actualizarSite('direccion', e.target.value)}
                placeholder="Calle, numero, colonia" />
            </div>
            <div style={styles.fila}>
              <div style={styles.campo}>
                <label style={styles.label}>Ciudad</label>
                <input style={styles.input} value={sites[siteActual].ciudad}
                  onChange={e => actualizarSite('ciudad', e.target.value)}
                  placeholder="Ej: Queretaro" />
              </div>
              <div style={styles.campo}>
                <label style={styles.label}>Estado</label>
                <input style={styles.input} value={sites[siteActual].estado}
                  onChange={e => actualizarSite('estado', e.target.value)}
                  placeholder="Ej: Queretaro" />
              </div>
              <div style={styles.campo}>
                <label style={styles.label}>CP</label>
                <input style={styles.input} value={sites[siteActual].cp}
                  onChange={e => actualizarSite('cp', e.target.value)}
                  placeholder="76000" />
              </div>
            </div>

            <div style={styles.botones}>
              <button style={styles.botonSecundario} onClick={() => setPaso(1)}>
                Atras
              </button>
              <button
                style={loading ? styles.botonDeshabilitado : styles.boton}
                disabled={loading}
                onClick={guardarSites}>
                {loading ? 'Guardando...' : 'Finalizar configuracion'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const styles = {
  container: { minHeight: '100vh', backgroundColor: '#f0f2f5', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' },
  card: { backgroundColor: '#fff', borderRadius: '12px', padding: '40px', width: '100%', maxWidth: '700px', boxShadow: '0 2px 16px rgba(0,0,0,0.1)' },
  titulo: { fontSize: '22px', fontWeight: '600', color: '#1a1a2e', textAlign: 'center', margin: '0 0 6px 0' },
  subtitulo: { fontSize: '14px', color: '#666', textAlign: 'center', margin: '0 0 28px 0' },
  pasos: { display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '28px', gap: '8px' },
  pasoActivo: { padding: '6px 16px', backgroundColor: '#2563eb', color: '#fff', borderRadius: '20px', fontSize: '13px', fontWeight: '500' },
  pasoCompletado: { padding: '6px 16px', backgroundColor: '#16a34a', color: '#fff', borderRadius: '20px', fontSize: '13px', fontWeight: '500' },
  pasoInactivo: { padding: '6px 16px', backgroundColor: '#e2e8f0', color: '#94a3b8', borderRadius: '20px', fontSize: '13px' },
  lineaPaso: { width: '40px', height: '2px', backgroundColor: '#e2e8f0' },
  form: { display: 'flex', flexDirection: 'column', gap: '16px' },
  fila: { display: 'flex', gap: '16px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' },
  pregunta: { backgroundColor: '#f8fafc', borderRadius: '8px', padding: '16px' },
  preguntaTexto: { fontSize: '14px', fontWeight: '500', color: '#444', margin: '0 0 12px 0' },
  opciones: { display: 'flex', gap: '12px' },
  opcion: { padding: '8px 20px', border: '2px solid #e2e8f0', borderRadius: '8px', backgroundColor: '#fff', fontSize: '14px', cursor: 'pointer', color: '#444' },
  opcionActiva: { padding: '8px 20px', border: '2px solid #2563eb', borderRadius: '8px', backgroundColor: '#eff6ff', fontSize: '14px', cursor: 'pointer', color: '#2563eb', fontWeight: '500' },
  tabs: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  tab: { padding: '6px 14px', border: '1px solid #e2e8f0', borderRadius: '6px', backgroundColor: '#f8fafc', fontSize: '13px', cursor: 'pointer', color: '#666' },
  tabActivo: { padding: '6px 14px', border: '1px solid #2563eb', borderRadius: '6px', backgroundColor: '#eff6ff', fontSize: '13px', cursor: 'pointer', color: '#2563eb', fontWeight: '500' },
  tabAgregar: { padding: '6px 14px', border: '1px dashed #2563eb', borderRadius: '6px', backgroundColor: '#fff', fontSize: '13px', cursor: 'pointer', color: '#2563eb' },
  eliminarTab: { marginLeft: '8px', color: '#dc2626', fontWeight: '700', cursor: 'pointer' },
  boton: { padding: '12px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: '500', cursor: 'pointer' },
  botonSecundario: { padding: '12px 24px', backgroundColor: '#e2e8f0', color: '#444', border: 'none', borderRadius: '8px', fontSize: '15px', cursor: 'pointer' },
  botonDeshabilitado: { padding: '12px', backgroundColor: '#93c5fd', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '15px', cursor: 'not-allowed' },
  botones: { display: 'flex', gap: '12px', justifyContent: 'flex-end' },
  error: { color: '#dc2626', fontSize: '13px', textAlign: 'center' },
}