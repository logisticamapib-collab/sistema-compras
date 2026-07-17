import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Capa 3 - Almacen (mejores practicas MRP/WMS):
// - Tipo de almacen = tipo de MERCANCIA que acepta (multi-seleccion; varios = mixto).
//   Catalogo editable: cada negocio crea sus propios tipos (MP, PT, WIP, Empaque, MRO, etc.)
// - Almacenes por site; pueden ser virtuales (Produccion, Calidad).
// - Ubicaciones de clave libre; opcionalmente ligadas a una maquina (MP-MAQ1) para
//   el consumo automatico en Capa 4.
// - Carga masiva de almacenes y ubicaciones desde Excel.

export default function Almacenes() {
  const { perfil, tienePermiso } = useAuth()
  const puedeCrear = tienePermiso('log_almacenes', 'crear')
  const puedeEditar = tienePermiso('log_almacenes', 'editar')

  const [sites, setSites] = useState([])
  const [tipos, setTipos] = useState([])
  const [almacenes, setAlmacenes] = useState([])
  const [almacenTipos, setAlmacenTipos] = useState([])
  const [ubicaciones, setUbicaciones] = useState([])
  const [maquinas, setMaquinas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  const [filtroSite, setFiltroSite] = useState('')
  const [expandido, setExpandido] = useState(null)

  const [form, setForm] = useState(null) // { id?, site_id, clave, nombre, es_virtual, tipos: [ids] }
  const [formUbi, setFormUbi] = useState(null) // { almacen_id, id?, clave, descripcion, maquina_id }
  const [mostrarTipos, setMostrarTipos] = useState(false)
  const [formTipo, setFormTipo] = useState(null) // { id?, nombre }

  // Importacion masiva
  const [preview, setPreview] = useState(null) // { almacenesNuevos, ubicacionesNuevas, errores, omitidas }
  const [importando, setImportando] = useState(false)

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    const [s, t, a, at, u, m] = await Promise.all([
      supabase.from('sites').select('id, nombre').eq('activo', true).order('nombre'),
      supabase.from('tipos_almacen').select('*').order('nombre'),
      supabase.from('almacenes').select('*').order('site_id').order('clave'),
      supabase.from('almacen_tipos').select('*'),
      supabase.from('ubicaciones').select('*').order('clave'),
      supabase.from('maquinas').select('id, clave, nombre, site_id').eq('activo', true).order('clave'),
    ])
    setSites(s.data || [])
    setTipos(t.data || [])
    setAlmacenes(a.data || [])
    setAlmacenTipos(at.data || [])
    setUbicaciones(u.data || [])
    setMaquinas(m.data || [])
    setLoading(false)
  }

  const siteDe = (id) => sites.find(s => s.id === id)
  const maquinaDe = (id) => maquinas.find(m => m.id === id)
  const ubisDe = (almacenId) => ubicaciones.filter(u => u.almacen_id === almacenId)
  const tipoIdsDe = (almacenId) => almacenTipos.filter(x => x.almacen_id === almacenId).map(x => x.tipo_id)
  const tiposNombresDe = (almacenId) => tipoIdsDe(almacenId).map(id => tipos.find(t => t.id === id)?.nombre).filter(Boolean).join(', ')

  // ---------- Almacenes ----------
  const guardarAlmacen = async () => {
    setError(''); setExito('')
    if (!form.site_id || !form.clave.trim() || !form.nombre.trim()) { setError('Site, clave y nombre son obligatorios'); return }
    if (form.tipos.length === 0) { setError('Selecciona al menos un tipo de mercancia que acepta el almacen (varios = mixto)'); return }
    const datos = {
      site_id: Number(form.site_id),
      clave: form.clave.trim().toUpperCase(),
      nombre: form.nombre.trim(),
      es_virtual: form.es_virtual,
    }
    try {
      let almacenId = form.id
      if (form.id) {
        const { error: e1 } = await supabase.from('almacenes').update(datos).eq('id', form.id)
        if (e1) throw e1
        await supabase.from('almacen_tipos').delete().eq('almacen_id', form.id)
      } else {
        const { data, error: e1 } = await supabase.from('almacenes').insert({ ...datos, empresa_id: perfil.empresa_id }).select().single()
        if (e1) throw e1
        almacenId = data.id
      }
      const { error: e2 } = await supabase.from('almacen_tipos').insert(form.tipos.map(t => ({ almacen_id: almacenId, tipo_id: t })))
      if (e2) throw e2
      setExito(form.id ? 'Almacen actualizado' : 'Almacen creado')
      setForm(null)
      await cargarDatos()
    } catch (err) {
      setError(err.message.includes('duplicate') ? `Ya existe un almacen con la clave "${datos.clave}" en ese site` : 'Error: ' + err.message)
    }
  }

  const toggleActivo = async (a) => {
    await supabase.from('almacenes').update({ activo: !a.activo }).eq('id', a.id)
    await cargarDatos()
  }

  const toggleTipoEnForm = (tipoId) => {
    setForm(f => ({ ...f, tipos: f.tipos.includes(tipoId) ? f.tipos.filter(x => x !== tipoId) : [...f.tipos, tipoId] }))
  }

  // ---------- Ubicaciones ----------
  const guardarUbicacion = async () => {
    setError(''); setExito('')
    if (!formUbi.clave.trim()) { setError('La clave de la ubicacion es obligatoria'); return }
    const datos = {
      clave: formUbi.clave.trim().toUpperCase(),
      descripcion: formUbi.descripcion?.trim() || null,
      maquina_id: formUbi.maquina_id ? Number(formUbi.maquina_id) : null,
    }
    let res
    if (formUbi.id) {
      res = await supabase.from('ubicaciones').update(datos).eq('id', formUbi.id)
    } else {
      res = await supabase.from('ubicaciones').insert({ ...datos, almacen_id: formUbi.almacen_id })
    }
    if (res.error) {
      setError(res.error.message.includes('duplicate') ? `Ya existe la ubicacion "${datos.clave}" en este almacen` : 'Error: ' + res.error.message)
      return
    }
    setFormUbi(null)
    await cargarDatos()
  }

  const toggleUbicacion = async (u) => {
    await supabase.from('ubicaciones').update({ activo: !u.activo }).eq('id', u.id)
    await cargarDatos()
  }

  // ---------- Tipos de almacen (catalogo) ----------
  const guardarTipo = async () => {
    setError(''); setExito('')
    if (!formTipo.nombre.trim()) { setError('El nombre del tipo es obligatorio'); return }
    let res
    if (formTipo.id) {
      res = await supabase.from('tipos_almacen').update({ nombre: formTipo.nombre.trim() }).eq('id', formTipo.id)
    } else {
      res = await supabase.from('tipos_almacen').insert({ nombre: formTipo.nombre.trim(), empresa_id: perfil.empresa_id })
    }
    if (res.error) { setError('Error: ' + res.error.message); return }
    setFormTipo(null)
    await cargarDatos()
  }

  const toggleTipo = async (t) => {
    if (t.activo && almacenTipos.some(x => x.tipo_id === t.id)) {
      setError('No se puede desactivar: hay almacenes que aceptan este tipo')
      return
    }
    await supabase.from('tipos_almacen').update({ activo: !t.activo }).eq('id', t.id)
    await cargarDatos()
  }

  // ---------- Importacion masiva desde Excel ----------
  const descargarPlantillaImport = () => {
    const wb = XLSX.utils.book_new()
    const datos = [
      ['Site', 'Clave Almacen', 'Nombre Almacen', 'Tipos', 'Virtual', 'Clave Ubicacion', 'Descripcion Ubicacion', 'Maquina'],
      ['Site 1', 'MP-01', 'Almacen Principal MP', 'Materia Prima', 'NO', 'R1-A1', 'Rack 1 pasillo A', ''],
      ['Site 1', 'MP-01', '', '', '', 'R1-A2', 'Rack 1 pasillo A nivel 2', ''],
      ['Site 1', 'PROD', 'Produccion', 'Materia Prima, Producto Terminado', 'SI', 'MP-MAQ1', 'Tolva de maquina 1', 'INY-01'],
      ['Site 1', 'CAL', 'Calidad', 'Producto Terminado', 'SI', 'GP12', 'Inspeccion GP12', ''],
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(datos), 'Almacenes')
    XLSX.writeFile(wb, 'plantilla_almacenes_ubicaciones.xlsx')
  }

  const leerImport = async (e) => {
    setError(''); setExito(''); setPreview(null)
    const file = e.target.files[0]
    if (!file) return
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
      let idxH = -1, cols = {}
      for (let i = 0; i < Math.min(filas.length, 10); i++) {
        const c = filas[i].map(x => String(x).toLowerCase())
        const iSite = c.findIndex(x => x.includes('site'))
        const iCA = c.findIndex(x => x.includes('clave') && x.includes('almacen'))
        if (iSite >= 0 && iCA >= 0) {
          idxH = i
          cols = {
            site: iSite, claveAlm: iCA,
            nombreAlm: c.findIndex(x => x.includes('nombre') && x.includes('almacen')),
            tipos: c.findIndex(x => x.includes('tipo')),
            virtual: c.findIndex(x => x.includes('virtual')),
            claveUbi: c.findIndex(x => x.includes('clave') && x.includes('ubicacion')),
            descUbi: c.findIndex(x => x.includes('descripcion')),
            maquina: c.findIndex(x => x.includes('maquina')),
          }
          break
        }
      }
      if (idxH < 0) { setError('No se encontraron encabezados. Usa la plantilla: Site, Clave Almacen, Nombre Almacen, Tipos, Virtual, Clave Ubicacion, Descripcion Ubicacion, Maquina'); return }

      const errores = []
      const nuevos = {} // clave: siteId|CLAVE -> { site_id, clave, nombre, es_virtual, tipoIds }
      const ubisNuevas = [] // { key, clave, descripcion, maquina_id }
      let omitidas = 0

      for (let i = idxH + 1; i < filas.length; i++) {
        const f = filas[i]
        const siteNombre = String(f[cols.site] || '').trim()
        const claveAlm = String(f[cols.claveAlm] || '').trim().toUpperCase()
        if (!siteNombre && !claveAlm) continue
        const numFila = i + 1
        const site = sites.find(s => s.nombre.trim().toLowerCase() === siteNombre.toLowerCase())
        if (!site) { errores.push(`Fila ${numFila}: site "${siteNombre}" no existe`); continue }
        if (!claveAlm) { errores.push(`Fila ${numFila}: falta la clave del almacen`); continue }
        const key = `${site.id}|${claveAlm}`
        const existente = almacenes.find(a => a.site_id === site.id && a.clave.toUpperCase() === claveAlm)

        if (!existente && !nuevos[key]) {
          const nombreAlm = String(f[cols.nombreAlm] || '').trim()
          if (!nombreAlm) { errores.push(`Fila ${numFila}: el almacen "${claveAlm}" es nuevo y no trae nombre`); continue }
          const tiposTxt = String(f[cols.tipos] || '').trim()
          const tipoIds = []
          let tiposOk = true
          if (!tiposTxt) { errores.push(`Fila ${numFila}: el almacen nuevo "${claveAlm}" no trae tipos de mercancia`); tiposOk = false }
          else {
            for (const tn of tiposTxt.split(',').map(x => x.trim()).filter(Boolean)) {
              const tipo = tipos.find(t => t.nombre.toLowerCase() === tn.toLowerCase())
              if (!tipo) { errores.push(`Fila ${numFila}: el tipo "${tn}" no existe en el catalogo (crealo primero en "Tipos de almacen")`); tiposOk = false }
              else tipoIds.push(tipo.id)
            }
          }
          if (!tiposOk) continue
          const virtualTxt = String(f[cols.virtual] || '').trim().toLowerCase()
          nuevos[key] = { site_id: site.id, clave: claveAlm, nombre: nombreAlm, es_virtual: ['si', 'sí', 'yes', 'x', 'true', '1'].includes(virtualTxt), tipoIds }
        }

        const claveUbi = String(f[cols.claveUbi] || '').trim().toUpperCase()
        if (claveUbi) {
          const yaExiste = existente && ubisDe(existente.id).some(u => u.clave.toUpperCase() === claveUbi)
          const yaEnArchivo = ubisNuevas.some(u => u.key === key && u.clave === claveUbi)
          if (yaExiste || yaEnArchivo) { omitidas++; continue }
          let maquinaId = null
          const maqTxt = String(f[cols.maquina] || '').trim()
          if (maqTxt) {
            const maq = maquinas.find(m => m.clave?.toLowerCase() === maqTxt.toLowerCase() || m.nombre?.toLowerCase() === maqTxt.toLowerCase())
            if (!maq) { errores.push(`Fila ${numFila}: la maquina "${maqTxt}" no existe (se importara la ubicacion sin maquina)`) }
            else maquinaId = maq.id
          }
          ubisNuevas.push({ key, clave: claveUbi, descripcion: String(f[cols.descUbi] || '').trim() || null, maquina_id: maquinaId })
        }
      }

      const almacenesNuevos = Object.values(nuevos)
      if (almacenesNuevos.length === 0 && ubisNuevas.length === 0) {
        setError('El archivo no trae almacenes ni ubicaciones nuevas' + (errores.length ? ` (${errores.length} errores)` : ''))
        setPreview(errores.length ? { almacenesNuevos: [], ubicacionesNuevas: [], errores, omitidas } : null)
        return
      }
      setPreview({ almacenesNuevos, ubicacionesNuevas: ubisNuevas, errores, omitidas })
    } catch (err) {
      setError('Error al leer el archivo: ' + err.message)
    }
    e.target.value = ''
  }

  const aplicarImport = async () => {
    setImportando(true); setError('')
    try {
      const idsPorKey = {}
      almacenes.forEach(a => { idsPorKey[`${a.site_id}|${a.clave.toUpperCase()}`] = a.id })
      for (const n of preview.almacenesNuevos) {
        const { data, error: e1 } = await supabase.from('almacenes')
          .insert({ empresa_id: perfil.empresa_id, site_id: n.site_id, clave: n.clave, nombre: n.nombre, es_virtual: n.es_virtual }).select().single()
        if (e1) throw e1
        idsPorKey[`${n.site_id}|${n.clave}`] = data.id
        const { error: e2 } = await supabase.from('almacen_tipos').insert(n.tipoIds.map(t => ({ almacen_id: data.id, tipo_id: t })))
        if (e2) throw e2
      }
      const filasUbi = preview.ubicacionesNuevas
        .filter(u => idsPorKey[u.key])
        .map(u => ({ almacen_id: idsPorKey[u.key], clave: u.clave, descripcion: u.descripcion, maquina_id: u.maquina_id }))
      if (filasUbi.length > 0) {
        const { error: e3 } = await supabase.from('ubicaciones').insert(filasUbi)
        if (e3) throw e3
      }
      setExito(`Importacion completada: ${preview.almacenesNuevos.length} almacen(es) y ${filasUbi.length} ubicacion(es)`)
      setPreview(null)
      await cargarDatos()
    } catch (err) {
      setError('Error al importar: ' + err.message)
    }
    setImportando(false)
  }

  const visibles = almacenes.filter(a => !filtroSite || a.site_id === Number(filtroSite))
  const tiposActivos = tipos.filter(t => t.activo)

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando almacenes...</p>

  return (
    <div style={styles.container} className="aparecer">
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Almacenes y Ubicaciones</h2>
        <div style={{ display: 'flex', gap: '10px' }}>
          {puedeCrear && (
            <>
              <label style={{ ...styles.botonSec, cursor: 'pointer' }}>
                Importar Excel
                <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={leerImport} />
              </label>
              <button style={styles.botonSec} onClick={descargarPlantillaImport}>Plantilla</button>
              <button style={styles.botonSec} onClick={() => { setMostrarTipos(!mostrarTipos); setFormTipo(null) }}>
                {mostrarTipos ? 'Ocultar tipos' : 'Tipos de almacen'}
              </button>
              {!form && (
                <button style={styles.boton} onClick={() => setForm({ site_id: filtroSite || '', clave: '', nombre: '', es_virtual: false, tipos: [] })}>+ Nuevo almacen</button>
              )}
            </>
          )}
        </div>
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {/* Vista previa de importacion */}
      {preview && (
        <div style={styles.form}>
          <h3 style={styles.formTitulo}>Vista previa de importacion</h3>
          <p style={{ fontSize: '13px', color: '#444', margin: '0 0 8px 0' }}>
            Se crearan <b>{preview.almacenesNuevos.length}</b> almacen(es) y <b>{preview.ubicacionesNuevas.length}</b> ubicacion(es).
            {preview.omitidas > 0 && ` ${preview.omitidas} ubicacion(es) ya existian y se omiten.`}
          </p>
          {preview.almacenesNuevos.map((n, i) => (
            <p key={i} style={{ fontSize: '12px', color: '#64748b', margin: '2px 0' }}>
              + {siteDe(n.site_id)?.nombre} / <b>{n.clave}</b> - {n.nombre} ({n.tipoIds.map(t => tipos.find(x => x.id === t)?.nombre).join(', ')}){n.es_virtual ? ' [virtual]' : ''}
            </p>
          ))}
          {preview.errores.length > 0 && (
            <div style={{ ...styles.cajaErrores, marginTop: '10px' }}>
              <p style={{ margin: '0 0 4px 0', fontWeight: '600', fontSize: '13px' }}>{preview.errores.length} advertencia(s):</p>
              {preview.errores.slice(0, 12).map((e, i) => <p key={i} style={{ margin: '2px 0', fontSize: '12px' }}>{e}</p>)}
              {preview.errores.length > 12 && <p style={{ fontSize: '12px' }}>... y {preview.errores.length - 12} mas</p>}
            </div>
          )}
          <div style={{ ...styles.botones, marginTop: '12px' }}>
            <button style={styles.botonSec} onClick={() => setPreview(null)} disabled={importando}>Cancelar</button>
            {(preview.almacenesNuevos.length > 0 || preview.ubicacionesNuevas.length > 0) && (
              <button style={styles.boton} onClick={aplicarImport} disabled={importando}>{importando ? 'Importando...' : 'Confirmar importacion'}</button>
            )}
          </div>
        </div>
      )}

      {mostrarTipos && (
        <div style={styles.form}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ ...styles.formTitulo, margin: 0 }}>Tipos de almacen (tipo de mercancia que aceptan)</h3>
            {puedeCrear && !formTipo && <button style={styles.botonAccion} onClick={() => setFormTipo({ nombre: '' })}>+ Nuevo tipo</button>}
          </div>
          {formTipo && (
            <div style={{ display: 'flex', gap: '10px', marginBottom: '12px', alignItems: 'flex-end' }}>
              <div style={{ ...styles.campo, flex: 1 }}>
                <label style={styles.label}>Nombre del tipo *</label>
                <input style={styles.input} value={formTipo.nombre} onChange={e => setFormTipo({ ...formTipo, nombre: e.target.value })} placeholder="Ej. MRO, Componentes, Quimicos" autoFocus />
              </div>
              <button style={styles.botonSec} onClick={() => setFormTipo(null)}>Cancelar</button>
              <button style={styles.boton} onClick={guardarTipo}>{formTipo.id ? 'Guardar' : 'Agregar'}</button>
            </div>
          )}
          {tipos.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 0', borderBottom: '1px solid #f1f5f9', fontSize: '14px' }}>
              <span style={{ flex: 1 }}>{t.nombre}</span>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>{almacenTipos.filter(x => x.tipo_id === t.id).length} almacen(es)</span>
              <span style={{ ...styles.badge, ...(t.activo ? styles.badgeVerde : styles.badgeGris) }}>{t.activo ? 'Activo' : 'Inactivo'}</span>
              {puedeEditar && (
                <>
                  <button style={styles.botonAccion} onClick={() => setFormTipo({ id: t.id, nombre: t.nombre })}>Editar</button>
                  <button style={styles.botonAccion} onClick={() => toggleTipo(t)}>{t.activo ? 'Desactivar' : 'Activar'}</button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {form && (
        <div style={styles.form}>
          <h3 style={styles.formTitulo}>{form.id ? 'Editar almacen' : 'Nuevo almacen'}</h3>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Site *</label>
              <select style={styles.input} value={form.site_id} onChange={e => setForm({ ...form, site_id: e.target.value })}>
                <option value="">Selecciona...</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Clave *</label>
              <input style={styles.input} value={form.clave} onChange={e => setForm({ ...form, clave: e.target.value })} placeholder="Ej. MP-01, PROD, CAL" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Nombre *</label>
              <input style={styles.input} value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Ej. Almacen Principal MP" />
            </div>
            <div style={{ ...styles.campo, flex: 0.6, justifyContent: 'flex-end' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', paddingBottom: '9px' }}>
                <input type="checkbox" checked={form.es_virtual} onChange={e => setForm({ ...form, es_virtual: e.target.checked })} />
                Virtual
              </label>
            </div>
          </div>
          <label style={styles.label}>Tipos de mercancia que acepta * (varios = mixto)</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', margin: '8px 0 16px' }}>
            {tiposActivos.map(t => (
              <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', backgroundColor: form.tipos.includes(t.id) ? '#eff6ff' : '#f8fafc', border: `1px solid ${form.tipos.includes(t.id) ? '#bfdbfe' : '#e2e8f0'}`, borderRadius: '7px', padding: '7px 12px' }}>
                <input type="checkbox" checked={form.tipos.includes(t.id)} onChange={() => toggleTipoEnForm(t.id)} />
                {t.nombre}
              </label>
            ))}
          </div>
          <div style={styles.botones}>
            <button style={styles.botonSec} onClick={() => setForm(null)}>Cancelar</button>
            <button style={styles.boton} onClick={guardarAlmacen}>{form.id ? 'Guardar cambios' : 'Crear almacen'}</button>
          </div>
        </div>
      )}

      <div style={styles.selectorBox}>
        <label style={{ ...styles.label, marginRight: '10px' }}>Site:</label>
        <select style={styles.input} value={filtroSite} onChange={e => setFiltroSite(e.target.value)}>
          <option value="">Todos</option>
          {sites.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      </div>

      {visibles.length === 0 ? (
        <p style={{ color: '#666', padding: '10px 4px' }}>No hay almacenes dados de alta{filtroSite ? ' en este site' : ''}. Usa "+ Nuevo almacen" o "Importar Excel".</p>
      ) : (
        <div style={styles.tabla}>
          <div style={styles.tablaHeader}>
            <span style={{ flex: 0.9 }}>Clave</span>
            <span style={{ flex: 1.5 }}>Nombre</span>
            <span style={{ flex: 1.6 }}>Tipos de mercancia</span>
            <span style={{ flex: 1 }}>Site</span>
            <span style={{ flex: 0.7, textAlign: 'center' }}>Ubicaciones</span>
            <span style={{ flex: 0.9, textAlign: 'center' }}>Estatus</span>
            <span style={{ width: '170px' }}></span>
          </div>
          {visibles.map(a => {
            const ubis = ubisDe(a.id)
            return (
              <div key={a.id}>
                <div style={styles.tablaFila} className="fila-hover">
                  <span style={{ flex: 0.9, fontWeight: '600' }}>{a.clave}</span>
                  <span style={{ flex: 1.5 }}>{a.nombre}</span>
                  <span style={{ flex: 1.6, color: '#64748b', fontSize: '13px' }}>{tiposNombresDe(a.id) || '-'}</span>
                  <span style={{ flex: 1 }}>{siteDe(a.site_id)?.nombre}</span>
                  <span style={{ flex: 0.7, textAlign: 'center' }}>{ubis.filter(u => u.activo).length}</span>
                  <span style={{ flex: 0.9, textAlign: 'center', display: 'flex', gap: '4px', justifyContent: 'center' }}>
                    <span style={{ ...styles.badge, ...(a.activo ? styles.badgeVerde : styles.badgeGris) }}>{a.activo ? 'Activo' : 'Inactivo'}</span>
                    {a.es_virtual && <span style={{ ...styles.badge, ...styles.badgeAzul }}>Virtual</span>}
                  </span>
                  <span style={{ width: '170px', textAlign: 'right', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                    <button style={styles.botonAccion} onClick={() => setExpandido(expandido === a.id ? null : a.id)}>
                      {expandido === a.id ? 'Ocultar' : 'Ubicaciones'}
                    </button>
                    {puedeEditar && (
                      <>
                        <button style={styles.botonAccion} onClick={() => { setForm({ id: a.id, site_id: a.site_id, clave: a.clave, nombre: a.nombre, es_virtual: a.es_virtual, tipos: tipoIdsDe(a.id) }); window.scrollTo(0, 0) }}>Editar</button>
                        <button style={styles.botonAccion} onClick={() => toggleActivo(a)}>{a.activo ? 'Desactivar' : 'Activar'}</button>
                      </>
                    )}
                  </span>
                </div>
                {expandido === a.id && (
                  <div style={styles.subTabla}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 20px 4px' }}>
                      <span style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' }}>Ubicaciones de {a.clave}</span>
                      {puedeEditar && !formUbi && (
                        <button style={styles.botonAccion} onClick={() => setFormUbi({ almacen_id: a.id, clave: '', descripcion: '', maquina_id: '' })}>+ Agregar ubicacion</button>
                      )}
                    </div>
                    {formUbi?.almacen_id === a.id && (
                      <div style={styles.formUbicacion}>
                        <div style={{ ...styles.campo, flex: 0.7 }}>
                          <label style={styles.label}>Clave *</label>
                          <input style={styles.input} value={formUbi.clave} onChange={e => setFormUbi({ ...formUbi, clave: e.target.value })} placeholder="Ej. R1-A3, MP-MAQ1, GP12" autoFocus />
                        </div>
                        <div style={{ ...styles.campo, flex: 1.2 }}>
                          <label style={styles.label}>Descripcion</label>
                          <input style={styles.input} value={formUbi.descripcion || ''} onChange={e => setFormUbi({ ...formUbi, descripcion: e.target.value })} placeholder="Opcional" />
                        </div>
                        <div style={{ ...styles.campo, flex: 0.9 }}>
                          <label style={styles.label}>Maquina (opcional)</label>
                          <select style={styles.input} value={formUbi.maquina_id || ''} onChange={e => setFormUbi({ ...formUbi, maquina_id: e.target.value })}>
                            <option value="">Sin maquina</option>
                            {maquinas.filter(m => m.site_id === a.site_id).map(m => <option key={m.id} value={m.id}>{m.clave} - {m.nombre}</option>)}
                          </select>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                          <button style={styles.botonSec} onClick={() => setFormUbi(null)}>Cancelar</button>
                          <button style={styles.boton} onClick={guardarUbicacion}>{formUbi.id ? 'Guardar' : 'Agregar'}</button>
                        </div>
                      </div>
                    )}
                    {ubis.length === 0 ? (
                      <p style={{ color: '#94a3b8', fontSize: '13px', padding: '4px 20px 10px' }}>Sin ubicaciones. El inventario se manejara a nivel almacen hasta que agregues ubicaciones.</p>
                    ) : (
                      ubis.map(u => (
                        <div key={u.id} style={{ ...styles.tablaFila, padding: '7px 20px', fontSize: '13px' }}>
                          <span style={{ flex: 0.7, fontWeight: '600' }}>{u.clave}</span>
                          <span style={{ flex: 1.2, color: '#64748b' }}>{u.descripcion || '-'}</span>
                          <span style={{ flex: 0.9, color: '#64748b' }}>{u.maquina_id ? `Maq: ${maquinaDe(u.maquina_id)?.clave || u.maquina_id}` : '-'}</span>
                          <span style={{ flex: 0.5, textAlign: 'center' }}>
                            <span style={{ ...styles.badge, ...(u.activo ? styles.badgeVerde : styles.badgeGris) }}>{u.activo ? 'Activa' : 'Inactiva'}</span>
                          </span>
                          <span style={{ width: '150px', textAlign: 'right', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                            {puedeEditar && (
                              <>
                                <button style={styles.botonAccion} onClick={() => setFormUbi({ almacen_id: a.id, id: u.id, clave: u.clave, descripcion: u.descripcion || '', maquina_id: u.maquina_id || '' })}>Editar</button>
                                <button style={styles.botonAccion} onClick={() => toggleUbicacion(u)}>{u.activo ? 'Desactivar' : 'Activar'}</button>
                              </>
                            )}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const styles = {
  container: { padding: '28px' },
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0' },
  selectorBox: { backgroundColor: '#fff', borderRadius: '10px', padding: '14px 20px', marginBottom: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center' },
  form: { backgroundColor: '#fff', borderRadius: '10px', padding: '24px', marginBottom: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  formTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 16px 0' },
  formUbicacion: { display: 'flex', gap: '12px', padding: '10px 20px', backgroundColor: '#eff6ff', alignItems: 'flex-end' },
  fila: { display: 'flex', gap: '16px', marginBottom: '16px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', fontFamily: 'inherit', backgroundColor: '#fff' },
  botones: { display: 'flex', justifyContent: 'flex-end', gap: '10px' },
  boton: { padding: '9px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSec: { padding: '9px 20px', backgroundColor: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '12px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  subTabla: { backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', padding: '4px 0 8px' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '600' },
  badgeVerde: { backgroundColor: '#dcfce7', color: '#16a34a' },
  badgeAzul: { backgroundColor: '#dbeafe', color: '#2563eb' },
  badgeGris: { backgroundColor: '#f1f5f9', color: '#64748b' },
  cajaErrores: { backgroundColor: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '8px', padding: '12px 16px', color: '#92400e', marginBottom: '12px' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
