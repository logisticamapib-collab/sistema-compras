import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { exportarExcel } from '../../lib/exportar'

// Bitacora de cambios.
//
// Responde una sola pregunta, que es la que se hace a las siete de la manana:
// "esto amanecio distinto, quien lo movio y que decia antes".
//
// Por eso el detalle no muestra la fila entera sino SOLO lo que cambio, con el
// valor anterior al lado del nuevo. Una pantalla que vuelca cincuenta campos
// para que uno busque cual se movio no se usa dos veces.
//
// La bitacora es de solo lectura por construccion: la tabla no le otorga
// INSERT, UPDATE ni DELETE a nadie, ni al administrador. Aqui no hay botones
// de editar ni de borrar porque no podrian funcionar.

const TABLAS = [
  { v: '', t: 'Todas las tablas' },
  { v: 'articulos', t: 'Articulos (costos)' },
  { v: 'articulo_proveedor', t: 'Precios de proveedor' },
  { v: 'articulo_cliente', t: 'Precios de cliente' },
  { v: 'lotes', t: 'Lotes (costo congelado)' },
  { v: 'facturas_proveedor', t: 'Facturas de proveedor' },
  { v: 'factura_lineas', t: 'Lineas de factura' },
  { v: 'ordenes_compra', t: 'Ordenes de compra' },
  { v: 'oc_lineas', t: 'Lineas de orden' },
  { v: 'requisiciones', t: 'Requisiciones' },
  { v: 'aprobaciones', t: 'Aprobaciones' },
  { v: 'usuarios', t: 'Usuarios' },
  { v: 'permisos_rol', t: 'Permisos por rol' },
  { v: 'permisos_usuario', t: 'Permisos por usuario' },
  { v: 'tipos_cambio', t: 'Tipos de cambio' },
  { v: 'monedas', t: 'Monedas' },
  { v: 'politica_moneda', t: 'Politica de costeo' },
  { v: 'config_compras', t: 'Config. de compras' },
  { v: 'liberaciones_calidad', t: 'Liberaciones de calidad' },
  { v: 'empresas', t: 'Empresa' },
  { v: 'sites', t: 'Sites' },
]

const OPS = { alta: { t: 'Alta', c: '#059669' }, cambio: { t: 'Cambio', c: '#b45309' }, baja: { t: 'Baja', c: '#dc2626' } }

export default function Bitacora() {
  const [dias, setDias] = useState(7)
  const [tabla, setTabla] = useState('')
  const [usuarioId, setUsuarioId] = useState('')
  const [texto, setTexto] = useState('')
  const [filas, setFilas] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [abierta, setAbierta] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { cargar() }, [dias, tabla, usuarioId])

  const cargar = async () => {
    setLoading(true); setError('')
    let q = supabase.from('bitacora').select('*')
      .gte('momento', new Date(Date.now() - dias * 86400000).toISOString())
      .order('momento', { ascending: false }).limit(500)
    if (tabla) q = q.eq('tabla', tabla)
    if (usuarioId) q = q.eq('usuario_id', usuarioId)

    const [rB, rU] = await Promise.all([q, supabase.from('usuarios').select('id, nombre').order('nombre')])
    if (rB.error) setError(rB.error.message)
    setFilas(rB.data || [])
    setUsuarios(rU.data || [])
    setLoading(false)
  }

  const valor = (v) => {
    if (v === null || v === undefined) return '(vacio)'
    if (typeof v === 'object') return JSON.stringify(v)
    if (v === '') return '(vacio)'
    return String(v)
  }

  const camposDe = (f) => Object.keys(f.cambios || {})
  const resumen = (f) => {
    if (f.operacion === 'cambio') {
      const c = camposDe(f)
      return c.length <= 3 ? c.join(', ') : `${c.slice(0, 3).join(', ')} y ${c.length - 3} mas`
    }
    const fila = f.fila || {}
    return fila.codigo_interno || fila.clave || fila.nombre || fila.folio || `id ${f.registro_id || '?'}`
  }

  const t = texto.trim().toLowerCase()
  const visibles = !t ? filas : filas.filter(f =>
    (f.usuario_nombre || '').toLowerCase().includes(t) ||
    f.tabla.includes(t) ||
    (f.registro_id || '').includes(t) ||
    JSON.stringify(f.cambios || f.fila || {}).toLowerCase().includes(t))

  // Un renglon por CAMPO cambiado, no por movimiento: asi el Excel se puede
  // filtrar por campo, que es lo que hace un auditor cuando pregunta "ensename
  // todos los cambios de costo".
  const exportar = () => {
    const renglones = []
    for (const f of visibles) {
      const base = {
        momento: new Date(f.momento).toLocaleString('es-MX'),
        usuario: f.usuario_nombre, tabla: f.tabla,
        operacion: OPS[f.operacion]?.t || f.operacion, registro: f.registro_id || '',
      }
      if (f.operacion === 'cambio') {
        for (const k of camposDe(f)) {
          renglones.push({ ...base, campo: k, antes: valor(f.cambios[k].antes), despues: valor(f.cambios[k].despues) })
        }
      } else {
        renglones.push({ ...base, campo: '(fila completa)', antes: '', despues: JSON.stringify(f.fila) })
      }
    }
    exportarExcel('bitacora_cambios', [
      { label: 'Momento', get: r => r.momento },
      { label: 'Usuario', get: r => r.usuario },
      { label: 'Tabla', get: r => r.tabla },
      { label: 'Que paso', get: r => r.operacion },
      { label: 'Registro', get: r => r.registro },
      { label: 'Campo', get: r => r.campo },
      { label: 'Antes', get: r => r.antes },
      { label: 'Despues', get: r => r.despues },
    ], renglones)
  }

  return (
    <div>
      <h2 style={s.titulo}>Bitacora de cambios</h2>
      <p style={s.intro}>
        Quien toco que, cuando, y como estaba antes. Solo se agrega: nadie puede modificarla ni
        borrarla, ni el administrador. Se vigila el dinero, los permisos y las autorizaciones;
        las tablas de mucho movimiento se dejan fuera a proposito para que aqui se encuentre lo que importa.
      </p>

      <div style={s.barra}>
        <select style={s.select} value={dias} onChange={e => setDias(Number(e.target.value))}>
          <option value={1}>Hoy</option><option value={7}>7 dias</option>
          <option value={30}>30 dias</option><option value={90}>90 dias</option>
        </select>
        <select style={s.select} value={tabla} onChange={e => setTabla(e.target.value)}>
          {TABLAS.map(x => <option key={x.v} value={x.v}>{x.t}</option>)}
        </select>
        <select style={s.select} value={usuarioId} onChange={e => setUsuarioId(e.target.value)}>
          <option value="">Cualquier usuario</option>
          {usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
        </select>
        <input style={s.input} value={texto} onChange={e => setTexto(e.target.value)}
          placeholder="Buscar en el detalle..." />
        <button style={s.boton} onClick={cargar}>Actualizar</button>
        <button style={s.botonSec} onClick={exportar} disabled={!visibles.length}>Excel</button>
      </div>

      {error && <p style={s.error}>{error}</p>}
      {loading ? <p>Cargando...</p> : (
        <>
          <p style={s.conteo}>
            {visibles.length} movimiento{visibles.length === 1 ? '' : 's'}
            {filas.length >= 500 && ' — se muestran los 500 mas recientes del periodo, acorta el rango'}
          </p>
          <div style={s.tabla}>
            <div style={{ ...s.fila, ...s.encabezado }}>
              <span style={{ flex: 2 }}>Momento</span>
              <span style={{ flex: 2 }}>Usuario</span>
              <span style={{ flex: 2 }}>Tabla</span>
              <span style={{ flex: 1 }}>Que paso</span>
              <span style={{ flex: 4 }}>Detalle</span>
            </div>
            {visibles.map(f => (
              <div key={f.id}>
                <div style={{ ...s.fila, cursor: 'pointer' }} onClick={() => setAbierta(abierta === f.id ? null : f.id)}>
                  <span style={{ flex: 2, fontSize: 12 }}>{new Date(f.momento).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}</span>
                  <span style={{ flex: 2 }}>{f.usuario_nombre}</span>
                  <span style={{ flex: 2, fontSize: 12, color: '#555' }}>{f.tabla}</span>
                  <span style={{ flex: 1, color: OPS[f.operacion]?.c }}>{OPS[f.operacion]?.t || f.operacion}</span>
                  <span style={{ flex: 4, fontSize: 12, color: '#444' }}>{resumen(f)}</span>
                </div>
                {abierta === f.id && (
                  <div style={s.detalle}>
                    {f.operacion === 'cambio' ? (
                      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                        <thead><tr>
                          <th style={s.th}>Campo</th><th style={s.th}>Antes</th><th style={s.th}>Despues</th>
                        </tr></thead>
                        <tbody>
                          {camposDe(f).map(k => (
                            <tr key={k}>
                              <td style={s.td}><strong>{k}</strong></td>
                              <td style={{ ...s.td, color: '#b91c1c' }}>{valor(f.cambios[k].antes)}</td>
                              <td style={{ ...s.td, color: '#15803d' }}>{valor(f.cambios[k].despues)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <pre style={s.pre}>{JSON.stringify(f.fila, null, 2)}</pre>
                    )}
                  </div>
                )}
              </div>
            ))}
            {!visibles.length && <div style={{ ...s.fila, color: '#666' }}>Nada en este periodo.</div>}
          </div>
        </>
      )}
    </div>
  )
}

const s = {
  titulo: { margin: '0 0 8px', fontSize: 18 },
  intro: { margin: '0 0 16px', fontSize: 13, color: '#555', lineHeight: 1.6, maxWidth: 820 },
  barra: { display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' },
  select: { padding: '7px 10px', border: '1px solid #ccc', borderRadius: 4, fontSize: 13 },
  input: { padding: '7px 10px', border: '1px solid #ccc', borderRadius: 4, fontSize: 13, minWidth: 200 },
  boton: { padding: '7px 14px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: 13, cursor: 'pointer' },
  botonSec: { padding: '7px 14px', background: '#fff', color: '#2563eb', border: '1px solid #2563eb', borderRadius: 4, fontSize: 13, cursor: 'pointer' },
  conteo: { fontSize: 12.5, color: '#666', margin: '0 0 8px' },
  tabla: { border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden' },
  fila: { display: 'flex', gap: 10, padding: '8px 12px', borderBottom: '1px solid #f1f1f1', fontSize: 13, alignItems: 'center' },
  encabezado: { background: '#f9fafb', fontWeight: 600, fontSize: 12, color: '#555' },
  detalle: { padding: '10px 16px 14px', background: '#fafafa', borderBottom: '1px solid #f1f1f1' },
  th: { textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #ddd', color: '#666', fontWeight: 600 },
  td: { padding: '4px 8px', borderBottom: '1px solid #eee', verticalAlign: 'top', wordBreak: 'break-word' },
  pre: { margin: 0, fontSize: 11.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  error: { color: '#dc2626', fontSize: 13 },
}
