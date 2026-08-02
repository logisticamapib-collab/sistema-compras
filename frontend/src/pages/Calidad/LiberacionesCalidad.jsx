import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { exportarExcel, imprimirTablaPDF } from '../../lib/exportar'
import { useAuth } from '../../context/AuthContext'

const DIAS_AVISO_VENCIMIENTO = 30

const EXP_BTN = { padding: '8px 14px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' }

export default function LiberacionesCalidad() {
  const { perfil, tienePermiso } = useAuth()
  const [articulos, setArticulos] = useState([])
  const [bom, setBom] = useState([])
  const [clientesArt, setClientesArt] = useState([])
  const [normas, setNormas] = useState([])
  const [niveles, setNiveles] = useState([])
  const [rutas, setRutas] = useState([])
  const [cavidades, setCavidades] = useState([])
  const [liberaciones, setLiberaciones] = useState([])
  const [articuloId, setArticuloId] = useState('')
  const [loading, setLoading] = useState(true)
  const [subiendo, setSubiendo] = useState('')
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  const puedeSubir = tienePermiso('cal_liberaciones', 'crear') || tienePermiso('cal_liberaciones', 'editar')
  const puedeLiberar = tienePermiso('cal_liberaciones', 'aprobar')

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    const [a, b, c, n, nv, r, cav, lib] = await Promise.all([
      supabase.from('articulos').select('id, codigo_interno, descripcion, tipo_proceso, peso_pieza_g, unidad_medida')
        .eq('empresa_id', perfil.empresa_id).eq('origen', 'fabricado').eq('activo', true).order('codigo_interno'),
      supabase.from('bom').select('articulo_padre_id'),
      supabase.from('articulo_cliente').select('articulo_id').eq('activo', true),
      supabase.from('normas_empaque').select('articulo_id').eq('activa', true).eq('tipo', 'oficial'),
      supabase.from('niveles_ingenieria').select('articulo_id, estatus, vigente_hasta').eq('estatus', 'vigente'),
      supabase.from('rutas_fabricacion').select('articulo_id'),
      supabase.from('molde_cavidades').select('articulo_id').eq('activa', true),
      supabase.from('liberaciones_calidad').select('*, liberador:usuarios!liberaciones_calidad_liberado_por_fkey(nombre)'),
    ])
    setArticulos(a.data || [])
    setBom(b.data || [])
    setClientesArt(c.data || [])
    setNormas(n.data || [])
    setNiveles(nv.data || [])
    setRutas(r.data || [])
    setCavidades(cav.data || [])
    setLiberaciones(lib.data || [])
    setLoading(false)
  }

  const hoy = new Date().toISOString().split('T')[0]
  const fechaAviso = new Date(Date.now() + DIAS_AVISO_VENCIMIENTO * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const liberacionDe = (id) => liberaciones.find(l => l.articulo_id === id)

  // Estado de vigencia de los documentos PSW/PPAP
  const estadoDocumentos = (lib) => {
    const docs = [
      { nombre: 'PSW', vigencia: lib?.psw_vigencia },
      { nombre: 'PPAP', vigencia: lib?.ppap_vigencia },
    ]
    const vencidos = docs.filter(d => d.vigencia && d.vigencia < hoy).map(d => d.nombre)
    const porVencer = docs.filter(d => d.vigencia && d.vigencia >= hoy && d.vigencia <= fechaAviso).map(d => d.nombre)
    return { vencidos, porVencer }
  }

  // Los 8 puntos de verificacion para que un articulo este listo para produccion
  const checksDe = (a) => {
    const lib = liberacionDe(a.id)
    const { vencidos, porVencer } = estadoDocumentos(lib)
    const requiereMolde = ['solo_inyeccion', 'inyeccion_y_ensamble', 'doble_inyeccion'].includes(a.tipo_proceso)
    const nivelVig = niveles.find(n => n.articulo_id === a.id)
    const nivelVencido = nivelVig?.vigente_hasta && nivelVig.vigente_hasta < hoy
    return [
      {
        clave: 'alta', nombre: 'Alta de articulo completa',
        ok: !!a.tipo_proceso && (!requiereMolde || (a.peso_pieza_g || 0) > 0),
        detalle: !a.tipo_proceso ? 'Falta tipo de proceso' : (requiereMolde && !(a.peso_pieza_g > 0)) ? 'Falta peso de pieza' : 'Tipo de proceso y pesos capturados',
      },
      {
        clave: 'bom', nombre: 'BOM capturado',
        ok: bom.some(l => l.articulo_padre_id === a.id),
        detalle: bom.some(l => l.articulo_padre_id === a.id) ? 'Tiene lista de materiales' : 'Sin componentes en BOM',
      },
      {
        clave: 'documentos', nombre: 'PSW y PPAP cargados y vigentes',
        ok: !!(lib?.psw_url && lib?.ppap_url) && vencidos.length === 0,
        detalle: !lib?.psw_url && !lib?.ppap_url ? 'Faltan ambos documentos'
          : !lib?.psw_url ? 'Falta PSW'
          : !lib?.ppap_url ? 'Falta PPAP'
          : vencidos.length > 0 ? `Documentos vencidos: ${vencidos.join(', ')}`
          : porVencer.length > 0 ? `Vigentes, pero por vencer en ${DIAS_AVISO_VENCIMIENTO} dias o menos: ${porVencer.join(', ')}`
          : 'Documentos completos y vigentes',
        advertencia: vencidos.length === 0 && porVencer.length > 0,
      },
      {
        clave: 'liberado', nombre: 'Liberado por Calidad',
        ok: !!lib?.liberado && vencidos.length === 0,
        detalle: !lib?.liberado ? 'Pendiente de liberacion'
          : vencidos.length > 0 ? 'Liberado, pero con documentos vencidos — pendiente renovar'
          : `Liberado por ${lib.liberador?.nombre || 'Calidad'}`,
      },
      {
        clave: 'cliente', nombre: 'Cliente asignado',
        ok: clientesArt.some(c => c.articulo_id === a.id),
        detalle: clientesArt.some(c => c.articulo_id === a.id) ? 'Con cliente y codigo de parte' : 'Sin cliente asignado',
      },
      {
        clave: 'empaque', nombre: 'Norma de empaque oficial activa',
        ok: normas.some(n => n.articulo_id === a.id),
        detalle: normas.some(n => n.articulo_id === a.id) ? 'Norma oficial definida' : 'Sin norma de empaque oficial',
      },
      {
        clave: 'nivel', nombre: 'Nivel de ingenieria vigente',
        ok: !!nivelVig && !nivelVencido,
        detalle: !nivelVig ? 'Sin nivel registrado' : nivelVencido ? 'El nivel vigente ya vencio — requiere revision' : 'Con revision vigente',
      },
      {
        clave: 'ruta', nombre: 'Ruta de fabricacion' + (requiereMolde ? ' y molde' : ''),
        ok: rutas.some(r => r.articulo_id === a.id) && (!requiereMolde || cavidades.some(c => c.articulo_id === a.id)),
        detalle: !rutas.some(r => r.articulo_id === a.id) ? 'Sin ruta de fabricacion'
          : (requiereMolde && !cavidades.some(c => c.articulo_id === a.id)) ? 'Sin cavidad de molde asignada'
          : 'Ruta' + (requiereMolde ? ' y molde definidos' : ' definida'),
      },
    ]
  }

  const articulo = articulos.find(a => a.id === parseInt(articuloId))
  const lib = articulo ? liberacionDe(articulo.id) : null
  const checks = articulo ? checksDe(articulo) : []
  const estadoDocs = articulo ? estadoDocumentos(lib) : { vencidos: [], porVencer: [] }

  const guardarCampos = async (campos) => {
    let errG
    if (lib) {
      const r = await supabase.from('liberaciones_calidad').update(campos).eq('id', lib.id)
      errG = r.error
    } else {
      const r = await supabase.from('liberaciones_calidad').insert({ articulo_id: articulo.id, ...campos })
      errG = r.error
    }
    return errG
  }

  const subirDocumento = async (tipo, archivo) => {
    if (!archivo || !articulo) return
    setError('')
    setSubiendo(tipo)
    const ruta = `${articulo.id}/${tipo}_${Date.now()}_${archivo.name}`
    const { error: errS } = await supabase.storage.from('calidad').upload(ruta, archivo)
    if (errS) { setError('Error al subir: ' + errS.message); setSubiendo(''); return }
    const { data: urlData } = supabase.storage.from('calidad').getPublicUrl(ruta)

    const campos = tipo === 'PSW'
      ? { psw_url: urlData.publicUrl, psw_nombre: archivo.name, subido_por: perfil.id }
      : { ppap_url: urlData.publicUrl, ppap_nombre: archivo.name, subido_por: perfil.id }

    const errG = await guardarCampos(campos)
    if (errG) { setError(errG.message); setSubiendo(''); return }

    setExito(`${tipo} cargado correctamente — captura su vigencia`)
    setSubiendo('')
    await cargarDatos()
    setTimeout(() => setExito(''), 4000)
  }

  const guardarVigencia = async (tipo, fecha) => {
    if (!articulo) return
    setError('')
    const campos = tipo === 'PSW' ? { psw_vigencia: fecha || null } : { ppap_vigencia: fecha || null }
    const errG = await guardarCampos(campos)
    if (errG) { setError(errG.message); return }
    setExito(`Vigencia de ${tipo} actualizada`)
    await cargarDatos()
    setTimeout(() => setExito(''), 3000)
  }

  const liberar = async () => {
    if (!lib?.psw_url || !lib?.ppap_url) {
      setError('No se puede liberar sin PSW y PPAP cargados')
      return
    }
    if (estadoDocs.vencidos.length > 0) {
      setError('No se puede liberar con documentos vencidos: ' + estadoDocs.vencidos.join(', '))
      return
    }
    if (!confirm(`Confirmas la liberacion de "${articulo.codigo_interno}"? Quedara registrado a tu nombre.`)) return
    setError('')
    const { error } = await supabase.from('liberaciones_calidad')
      .update({ liberado: true, liberado_por: perfil.id, fecha_liberacion: new Date().toISOString() })
      .eq('id', lib.id)
    if (error) { setError(error.message); return }
    setExito('Articulo liberado por Calidad')
    await cargarDatos()
    setTimeout(() => setExito(''), 3000)
  }

  const revocar = async () => {
    if (!confirm(`Revocar la liberacion de "${articulo.codigo_interno}"? El articulo dejara de estar listo para produccion.`)) return
    const { error } = await supabase.from('liberaciones_calidad')
      .update({ liberado: false, liberado_por: null, fecha_liberacion: null })
      .eq('id', lib.id)
    if (error) { setError(error.message); return }
    setExito('Liberacion revocada')
    await cargarDatos()
    setTimeout(() => setExito(''), 3000)
  }

  const badgeCalidad = (a) => {
    const libA = liberacionDe(a.id)
    const { vencidos, porVencer } = estadoDocumentos(libA)
    if (libA?.liberado && vencidos.length > 0) return { texto: 'Documentos vencidos', fondo: '#fef2f2', color: '#dc2626' }
    if (libA?.liberado && porVencer.length > 0) return { texto: 'Por vencer', fondo: '#fef9c3', color: '#854d0e' }
    if (libA?.liberado) return { texto: 'Liberado', fondo: '#f0fdf4', color: '#16a34a' }
    if (vencidos.length > 0) return { texto: 'Pendiente — docs vencidos', fondo: '#fef2f2', color: '#dc2626' }
    return { texto: 'Pendiente', fondo: '#fef9c3', color: '#854d0e' }
  }

  const fmtFecha = (f) => f ? new Date(f + 'T00:00:00').toLocaleDateString('es-MX') : ''

  const BloqueDocumento = ({ tipo, url, nombre, vigencia }) => {
    const vencido = vigencia && vigencia < hoy
    const porVencer = vigencia && !vencido && vigencia <= fechaAviso
    const colsExp = [
    { label: 'Articulo', get: r => articulos.find(a => a.id === r.articulo_id)?.codigo_interno || '' },
    { label: 'Documento', get: r => r.nombre || r.tipo || '' },
    { label: 'Vigencia', get: r => r.vigencia || '' },
    { label: 'Libero', get: r => r.liberador?.nombre || '' },
    { label: 'Fecha', get: r => r.created_at ? new Date(r.created_at).toLocaleDateString('es-MX') : '' },
  ]
  return (
      <div style={styles.campo}>
        <label style={styles.label}>{tipo === 'PSW' ? 'PSW (Part Submission Warrant)' : 'PPAP (Production Part Approval Process)'}</label>
        {url
          ? <p style={styles.docCargado}>✓ <a href={url} target="_blank" rel="noreferrer" style={styles.enlace}>{nombre || 'Ver documento'}</a></p>
          : <p style={styles.docFaltante}>Sin documento</p>}
        {puedeSubir && !lib?.liberado && (
          <input style={styles.inputArchivo} type="file" accept=".pdf,.jpg,.jpeg,.png"
            disabled={subiendo === tipo}
            onChange={e => subirDocumento(tipo, e.target.files[0])} />
        )}
        {subiendo === tipo && <p style={{ fontSize: '12px', color: '#666' }}>Subiendo...</p>}
        {url && (
          <div style={{ marginTop: '6px' }}>
            <label style={{ ...styles.label, color: vencido ? '#dc2626' : porVencer ? '#b45309' : '#444' }}>
              Vigente hasta {vencido ? '(VENCIDO)' : porVencer ? '(por vencer)' : ''}
            </label>
            {puedeSubir ? (
              <input style={{ ...styles.input, maxWidth: '170px' }} type="date" defaultValue={vigencia || ''}
                onBlur={e => e.target.value !== (vigencia || '') && guardarVigencia(tipo, e.target.value)} />
            ) : (
              <p style={{ fontSize: '13px', color: '#666', margin: 0 }}>{vigencia ? fmtFecha(vigencia) : 'Sin capturar'}</p>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Liberacion de Calidad</h2>
      <div style={{ display: 'flex', gap: '8px', margin: '0 0 12px' }} className="no-imprimir">
        <button style={EXP_BTN} onClick={() => exportarExcel('liberaciones_calidad', colsExp, liberaciones)}>Excel</button>
        <button style={EXP_BTN} onClick={() => imprimirTablaPDF('Liberacion de Calidad', colsExp, liberaciones)}>PDF</button>
      </div>
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      <div style={styles.selectorBox} className="aparecer">
        <label style={styles.label}>Articulo fabricado</label>
        <select style={{ ...styles.input, maxWidth: '480px' }} value={articuloId}
          onChange={e => { setArticuloId(e.target.value); setError('') }}>
          <option value="">Selecciona un articulo (o deja vacio para ver el semaforo general)</option>
          {articulos.map(a => <option key={a.id} value={a.id}>{a.codigo_interno} — {a.descripcion}</option>)}
        </select>
      </div>

      {loading ? <p style={{ color: '#666' }}>Cargando...</p> : !articuloId ? (
        <div style={styles.tabla}>
          <div style={styles.tablaHeader}>
            <span style={{ flex: 3 }}>Articulo</span>
            <span style={{ flex: 2 }}>Preparacion</span>
            <span style={{ flex: 2 }}>Calidad</span>
            <span style={{ flex: 2 }}>Faltantes</span>
          </div>
          {articulos.map(a => {
            const ch = checksDe(a)
            const okCount = ch.filter(c => c.ok).length
            const completo = okCount === ch.length
            const badge = badgeCalidad(a)
            const faltantes = ch.filter(c => !c.ok).map(c => c.nombre)
            return (
              <div key={a.id} style={styles.tablaFila} className="fila-hover">
                <span style={{ flex: 3, fontSize: '13px' }}>
                  <span style={{ fontWeight: '600', color: '#2563eb' }}>{a.codigo_interno}</span>
                  <span style={{ color: '#666' }}> — {a.descripcion}</span>
                </span>
                <span style={{ flex: 2 }}>
                  <span style={{ ...styles.badge, ...(completo ? { backgroundColor: '#f0fdf4', color: '#16a34a' } : { backgroundColor: '#fef2f2', color: '#dc2626' }) }}>
                    {completo ? 'Listo para produccion' : `${okCount}/${ch.length} completos`}
                  </span>
                </span>
                <span style={{ flex: 2 }}>
                  <span style={{ ...styles.badge, backgroundColor: badge.fondo, color: badge.color }}>{badge.texto}</span>
                </span>
                <span style={{ flex: 2, fontSize: '11px', color: '#dc2626' }}>
                  {faltantes.length === 0 ? '' : faltantes.slice(0, 3).join(', ') + (faltantes.length > 3 ? '...' : '')}
                </span>
              </div>
            )
          })}
        </div>
      ) : articulo && (
        <>
          <div style={styles.form} className="aparecer">
            <h3 style={styles.formTitulo}>Documentos de calidad — {articulo.codigo_interno}</h3>
            {estadoDocs.vencidos.length > 0 && (
              <p style={styles.alertaVencido}>⚠ Documentos vencidos: {estadoDocs.vencidos.join(', ')}. Renueva y vuelve a cargar para mantener el articulo liberado.</p>
            )}
            {estadoDocs.vencidos.length === 0 && estadoDocs.porVencer.length > 0 && (
              <p style={styles.alertaPorVencer}>⚠ Proximos a vencer (menos de {DIAS_AVISO_VENCIMIENTO} dias): {estadoDocs.porVencer.join(', ')}.</p>
            )}
            <div style={styles.fila}>
              <BloqueDocumento tipo="PSW" url={lib?.psw_url} nombre={lib?.psw_nombre} vigencia={lib?.psw_vigencia} />
              <BloqueDocumento tipo="PPAP" url={lib?.ppap_url} nombre={lib?.ppap_nombre} vigencia={lib?.ppap_vigencia} />
            </div>

            <div style={styles.liberacionBox}>
              {lib?.liberado ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                  <span style={{ ...styles.badge, backgroundColor: estadoDocs.vencidos.length > 0 ? '#fef2f2' : '#f0fdf4', color: estadoDocs.vencidos.length > 0 ? '#dc2626' : '#16a34a', fontSize: '13px' }}>
                    {estadoDocs.vencidos.length > 0
                      ? `⚠ Liberado con documentos vencidos (${estadoDocs.vencidos.join(', ')})`
                      : `✓ Liberado por ${lib.liberador?.nombre || 'Calidad'} el ${lib.fecha_liberacion ? new Date(lib.fecha_liberacion).toLocaleDateString('es-MX') : ''}`}
                  </span>
                  {puedeLiberar && <button style={styles.botonRevocar} onClick={revocar}>Revocar liberacion</button>}
                </div>
              ) : puedeLiberar ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <button style={{ ...styles.botonLiberar, opacity: (lib?.psw_url && lib?.ppap_url && estadoDocs.vencidos.length === 0) ? 1 : 0.5 }}
                    disabled={!(lib?.psw_url && lib?.ppap_url) || estadoDocs.vencidos.length > 0} onClick={liberar}>
                    Liberar articulo
                  </button>
                  {!(lib?.psw_url && lib?.ppap_url) && <span style={{ fontSize: '12px', color: '#b45309' }}>Se requieren PSW y PPAP para liberar</span>}
                  {(lib?.psw_url && lib?.ppap_url) && estadoDocs.vencidos.length > 0 && <span style={{ fontSize: '12px', color: '#dc2626' }}>Hay documentos vencidos</span>}
                </div>
              ) : (
                <p style={{ fontSize: '13px', color: '#666', margin: 0 }}>
                  Pendiente de liberacion — solo el equipo de Calidad (privilegio de aprobar) puede liberar este articulo.
                </p>
              )}
            </div>
          </div>

          <div style={styles.tabla}>
            <div style={styles.tablaHeader}>
              <span style={{ flex: 2 }}>Verificacion</span>
              <span style={{ flex: 1 }}>Estatus</span>
              <span style={{ flex: 3 }}>Detalle</span>
            </div>
            {checks.map(c => (
              <div key={c.clave} style={styles.tablaFila} className="fila-hover">
                <span style={{ flex: 2, fontSize: '13px', fontWeight: '500' }}>{c.nombre}</span>
                <span style={{ flex: 1 }}>
                  <span style={{ ...styles.badge, ...(c.ok ? (c.advertencia ? { backgroundColor: '#fef9c3', color: '#854d0e' } : { backgroundColor: '#f0fdf4', color: '#16a34a' }) : { backgroundColor: '#fef2f2', color: '#dc2626' }) }}>
                    {c.ok ? (c.advertencia ? 'Por vencer' : 'OK') : 'Falta'}
                  </span>
                </span>
                <span style={{ flex: 3, fontSize: '13px', color: '#666' }}>{c.detalle}</span>
              </div>
            ))}
            <div style={{ padding: '14px 20px', backgroundColor: checks.every(c => c.ok) ? '#f0fdf4' : '#fef2f2' }}>
              <span style={{ fontSize: '14px', fontWeight: '700', color: checks.every(c => c.ok) ? '#16a34a' : '#dc2626' }}>
                {checks.every(c => c.ok)
                  ? '✓ Este articulo esta listo para iniciar produccion'
                  : `✗ Faltan ${checks.filter(c => !c.ok).length} requisitos para poder producir este articulo`}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const styles = {
  container: { padding: '28px' },
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0' },
  selectorBox: { backgroundColor: '#fff', borderRadius: '10px', padding: '18px 24px', marginBottom: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  form: { backgroundColor: '#fff', borderRadius: '10px', padding: '24px', marginBottom: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  formTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 16px 0' },
  fila: { display: 'flex', gap: '16px', marginBottom: '16px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' },
  inputArchivo: { fontSize: '13px' },
  docCargado: { fontSize: '13px', color: '#16a34a', margin: 0 },
  docFaltante: { fontSize: '13px', color: '#dc2626', margin: 0 },
  enlace: { color: '#2563eb' },
  alertaVencido: { fontSize: '13px', color: '#dc2626', backgroundColor: '#fef2f2', borderRadius: '7px', padding: '10px 14px', margin: '0 0 14px 0' },
  alertaPorVencer: { fontSize: '13px', color: '#854d0e', backgroundColor: '#fef9c3', borderRadius: '7px', padding: '10px 14px', margin: '0 0 14px 0' },
  liberacionBox: { borderTop: '1px solid #f1f5f9', paddingTop: '16px' },
  botonLiberar: { padding: '9px 20px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
  botonRevocar: { padding: '6px 14px', backgroundColor: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '12px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '600' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
