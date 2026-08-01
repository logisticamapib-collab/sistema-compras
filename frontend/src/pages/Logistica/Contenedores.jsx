import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import FiltroSite from '../../components/FiltroSite'
import { siteEfectivo } from '../../lib/sites'
import EscanerCamara from '../../components/EscanerCamara'
import EtiquetaMaster from '../../components/EtiquetaMaster'
import PortalImpresion from '../../components/PortalImpresion'
import { imprimirAislado } from '../../lib/impresion'
import { folioContenedor, agrupables, cajasDe, resumenTarima } from '../../lib/contenedores'
import { ladoDeDescripcion, tipoDeArticulo, fmtFechaEtiqueta } from '../../lib/etiquetas'

// Cajas y Tarimas. La tarima (master) es OPCIONAL: sirve para mover muchas cajas
// de una sola vez. Se arma escaneando o eligiendo cajas; admite cajas del mismo
// articulo o de articulos que comparten molde (izquierda y derecha del familiar).

const fmtNum = (n) => (Number(n) || 0).toLocaleString('es-MX')

export default function Contenedores() {
  const { perfil, tienePermiso } = useAuth()
  const puedeArmar = tienePermiso('log_contenedores', 'crear')

  const [vista, setVista] = useState('armar')
  const [site, setSite] = useState('')
  const [contenedores, setContenedores] = useState([])
  const [articulos, setArticulos] = useState([])
  const [lotes, setLotes] = useState([])
  const [almacenes, setAlmacenes] = useState([])
  const [ubicaciones, setUbicaciones] = useState([])
  const [cavidades, setCavidades] = useState([])
  const [normas, setNormas] = useState([])
  const [artCliente, setArtCliente] = useState([])
  const [clientes, setClientes] = useState([])
  const [empresa, setEmpresa] = useState(null)
  const [cfg, setCfg] = useState(null)
  const [bom, setBom] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [procesando, setProcesando] = useState(false)

  const [escaneo, setEscaneo] = useState('')
  const [seleccion, setSeleccion] = useState([])  // cajas que van en la tarima
  const [filtro, setFiltro] = useState('')
  const [master, setMaster] = useState(null)      // tarima recien creada para imprimir
  const inputRef = useRef(null)

  useEffect(() => { cargar() }, [])

  const cargar = async () => {
    setLoading(true)
    const [c, a, lo, al, ub, cav, n, ac, cli, emp, ce, bm] = await Promise.all([
      supabase.from('contenedores').select('*').eq('empresa_id', perfil.empresa_id).in('estatus', ['activo']).order('folio'),
      supabase.from('articulos').select('id, codigo_interno, descripcion, unidad_medida, origen, es_consigna'),
      supabase.from('lotes').select('id, codigo_lote, articulo_id, estatus_calidad'),
      supabase.from('almacenes').select('*'),
      supabase.from('ubicaciones').select('*'),
      supabase.from('molde_cavidades').select('articulo_id, molde_id').eq('activa', true),
      supabase.from('normas_empaque').select('*').eq('activa', true).eq('tipo', 'oficial'),
      supabase.from('articulo_cliente').select('*').eq('activo', true),
      supabase.from('clientes').select('id, nombre'),
      supabase.from('empresas').select('*').eq('id', perfil.empresa_id).maybeSingle(),
      supabase.from('config_etiquetas').select('*').eq('empresa_id', perfil.empresa_id).maybeSingle(),
      supabase.from('bom').select('componente_articulo_id'),
    ])
    setContenedores(c.data || []); setArticulos(a.data || []); setLotes(lo.data || [])
    setAlmacenes(al.data || []); setUbicaciones(ub.data || []); setCavidades(cav.data || [])
    setNormas(n.data || []); setArtCliente(ac.data || []); setClientes(cli.data || [])
    setEmpresa(emp.data || null); setCfg(ce.data || null); setBom(bm.data || [])
    setLoading(false)
  }

  const artDe = (id) => articulos.find(a => a.id === id)
  const loteDe = (id) => lotes.find(l => l.id === id)
  const almDe = (id) => almacenes.find(a => a.id === id)
  const ubiDe = (id) => ubicaciones.find(u => u.id === id)

  const cajasLibres = contenedores.filter(c => c.tipo === 'caja' && !c.padre_id)
  const tarimas = contenedores.filter(c => c.tipo === 'tarima')

  // Piezas por tarima de la norma oficial (para la sugerencia de cierre)
  const piezasPorTarima = seleccion.length
    ? Number(normas.find(n => n.articulo_id === seleccion[0].articulo_id)?.piezas_por_tarima || 0)
    : 0
  const totalSeleccion = seleccion.reduce((s, c) => s + Number(c.cantidad), 0)
  const tarimaCompleta = piezasPorTarima > 0 && totalSeleccion >= piezasPorTarima

  const agregarCaja = (caja) => {
    setError('')
    if (seleccion.some(s => s.id === caja.id)) { setError(`La caja ${caja.folio} ya esta en la tarima`); return }
    if (caja.padre_id) { setError(`La caja ${caja.folio} ya pertenece a otra tarima`); return }
    if (seleccion.length > 0) {
      const base = seleccion[0]
      if (!agrupables(base.articulo_id, caja.articulo_id, cavidades)) {
        setError(`La caja ${caja.folio} es de otro articulo y no comparte molde con las ya agregadas`); return
      }
      if (caja.almacen_id !== base.almacen_id || (caja.ubicacion_id || null) !== (base.ubicacion_id || null)) {
        setError(`La caja ${caja.folio} esta en otra ubicacion (${almDe(caja.almacen_id)?.clave}). Todas deben estar en el mismo lugar`); return
      }
    }
    setSeleccion([...seleccion, caja])
    setExito(`Caja ${caja.folio} agregada (${fmtNum(caja.cantidad)} pzas)`)
  }

  const procesarEscaneo = (valor) => {
    const v = (valor || '').trim()
    if (!v) return
    const caja = cajasLibres.find(c => c.folio.toLowerCase() === v.toLowerCase())
    if (!caja) {
      // Tambien acepta escanear el lote: agrega todas sus cajas libres en una ubicacion
      const lote = lotes.find(l => l.codigo_lote.toLowerCase() === v.toLowerCase())
      if (lote) {
        const delLote = cajasLibres.filter(c => c.lote_id === lote.id)
        if (delLote.length === 0) { setError(`El lote ${v} no tiene cajas libres`); return }
        delLote.forEach(c => agregarCaja(c))
        return
      }
      setError(`No se encontro la caja o lote "${v}"`); return
    }
    agregarCaja(caja)
  }

  const quitarCaja = (id) => setSeleccion(seleccion.filter(s => s.id !== id))

  const crearTarima = async () => {
    setError('')
    if (seleccion.length === 0) { setError('Agrega al menos una caja'); return }
    setProcesando(true)
    try {
      const base = seleccion[0]
      const total = totalSeleccion
      const unArticulo = [...new Set(seleccion.map(s => s.articulo_id))].length === 1
      const unLote = [...new Set(seleccion.map(s => s.lote_id))].length === 1
      const folio = await folioContenedor(supabase, perfil.empresa_id, 'tarima')
      const { data: tarima, error: e1 } = await supabase.from('contenedores').insert({
        empresa_id: perfil.empresa_id, folio, tipo: 'tarima',
        articulo_id: unArticulo ? base.articulo_id : null,
        lote_id: unLote ? base.lote_id : null,
        molde_id: base.molde_id || null, cantidad: total,
        almacen_id: base.almacen_id, ubicacion_id: base.ubicacion_id,
        origen: `Armada con ${seleccion.length} caja(s)`, creado_por: perfil.id,
      }).select().single()
      if (e1) throw e1
      const { error: e2 } = await supabase.from('contenedores')
        .update({ padre_id: tarima.id }).in('id', seleccion.map(s => s.id))
      if (e2) throw e2

      setMaster({ tarima, cajas: [...seleccion] })
      setExito(`Tarima ${folio} creada con ${seleccion.length} caja(s) y ${fmtNum(total)} pzas`)
      setSeleccion([]); setEscaneo('')
      await cargar()
    } catch (err) { setError('Error: ' + err.message) }
    setProcesando(false)
  }

  const desarmar = async (tarima) => {
    setError(''); setExito('')
    await supabase.from('contenedores').update({ padre_id: null }).eq('padre_id', tarima.id)
    await supabase.from('contenedores').update({ estatus: 'desarmado' }).eq('id', tarima.id)
    setExito(`Tarima ${tarima.folio} desarmada; sus cajas quedan libres`)
    await cargar()
  }

  const datosMaster = (tarima, cajas) => {
    const art = artDe(tarima.articulo_id || cajas[0]?.articulo_id)
    const rel = artCliente.find(x => x.articulo_id === art?.id)
    const r = { cajas: cajas.length, total: Number(tarima.cantidad), lotes: [...new Set(cajas.map(c => loteDe(c.lote_id)?.codigo_lote).filter(Boolean))] }
    return {
      folio: tarima.folio,
      numeroParte: rel?.codigo_cliente || art?.codigo_interno || '',
      descripcion: art?.descripcion || (tarima.articulo_id ? '' : 'Varios articulos del mismo molde'),
      total: r.total, cajas: r.cajas, lotes: r.lotes.join(', ') || '-',
      lado: ladoDeDescripcion(art?.descripcion), tipo: tipoDeArticulo(art, bom),
      logoUrl: empresa?.logo_url || '', empresa: empresa?.nombre || '',
      fecha: fmtFechaEtiqueta(),
    }
  }

  const imprimirTarima = async (tarima) => {
    const { data } = await supabase.from('contenedores').select('*').eq('padre_id', tarima.id)
    setMaster({ tarima, cajas: data || [] })
  }

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>

  // ---------- Impresion de la etiqueta master ----------
  if (master) {
    const d = datosMaster(master.tarima, master.cajas)
    return (
      <div style={styles.container} className="aparecer">
        <style>{`@media print { @page { size: ${cfg?.ancho_in || 4}in ${cfg?.alto_in || 2}in; margin: 0; } }`}</style>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }} className="no-imprimir">
          <button style={styles.botonSec} onClick={() => setMaster(null)}>&larr; Volver</button>
          <button style={styles.boton} onClick={imprimirAislado}>Imprimir etiqueta master</button>
        </div>
        <PortalImpresion><EtiquetaMaster datos={d} config={cfg} /></PortalImpresion>
        <EtiquetaMaster datos={d} config={cfg} />
        <div style={{ marginTop: '18px', fontSize: '13px', color: '#64748b' }} className="no-imprimir">
          Contiene {master.cajas.length} caja(s): {master.cajas.map(c => c.folio).join(', ')}
        </div>
      </div>
    )
  }

  const cajasFiltradas = cajasLibres.filter(c => {
    if (!filtro) return true
    const t = filtro.toLowerCase()
    const art = artDe(c.articulo_id)
    return c.folio.toLowerCase().includes(t) || art?.codigo_interno.toLowerCase().includes(t) || loteDe(c.lote_id)?.codigo_lote.toLowerCase().includes(t)
  })

  return (
    <div style={styles.container} className="aparecer">
      <h2 style={styles.titulo}>Cajas y Tarimas</h2>
      <p style={styles.ayuda}>Cada caja nace con su folio al producir o recibir. La <b>tarima master es opcional</b>: agrupa cajas para mover muchas de golpe. Admite cajas del mismo articulo o de articulos que comparten molde (izquierda y derecha).</p>

      <div style={styles.tabs}>
        {[['armar', 'Armar tarima'], ['tarimas', `Tarimas (${tarimas.length})`], ['cajas', `Cajas libres (${cajasLibres.length})`]].map(([id, n]) => (
          <button key={id} style={vista === id ? styles.tabActiva : styles.tab} onClick={() => setVista(id)}>{n}</button>
        ))}
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {vista === 'armar' && (
        <div style={styles.columnas}>
          <div style={styles.panel}>
            <h3 style={styles.subtitulo}>Escanea o elige las cajas</h3>
            <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
              <input ref={inputRef} style={{ ...styles.input, flex: 1 }} autoFocus
                placeholder="Escanea el QR de la caja (o del lote) y presiona Enter"
                value={escaneo} onChange={e => setEscaneo(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { procesarEscaneo(escaneo); setEscaneo('') } }} />
              <EscanerCamara onScan={t => { setEscaneo(''); procesarEscaneo(t) }} />
            </div>
            <input style={{ ...styles.input, width: '100%', marginBottom: '10px' }} placeholder="Filtrar cajas por folio, articulo o lote..."
              value={filtro} onChange={e => setFiltro(e.target.value)} />
            <div style={styles.listaCajas}>
              {cajasFiltradas.length === 0 && <p style={{ color: '#94a3b8', fontSize: '13px' }}>No hay cajas libres.</p>}
              {cajasFiltradas.slice(0, 60).map(c => {
                const art = artDe(c.articulo_id)
                const yaEsta = seleccion.some(s => s.id === c.id)
                return (
                  <div key={c.id} style={{ ...styles.filaCaja, opacity: yaEsta ? 0.4 : 1 }}>
                    <span style={{ flex: 1, fontSize: '13px' }}>
                      <b>{c.folio}</b> <span style={{ color: '#64748b' }}>{art?.codigo_interno}</span>
                      <span style={{ display: 'block', fontSize: '11px', color: '#94a3b8' }}>
                        lote {loteDe(c.lote_id)?.codigo_lote} - {almDe(c.almacen_id)?.clave}{c.ubicacion_id ? '/' + ubiDe(c.ubicacion_id)?.clave : ''}
                      </span>
                    </span>
                    <span style={{ width: '70px', textAlign: 'right', fontWeight: '600', fontSize: '13px' }}>{fmtNum(c.cantidad)}</span>
                    <button style={styles.botonAccion} disabled={yaEsta || !puedeArmar} onClick={() => agregarCaja(c)}>Agregar</button>
                  </div>
                )
              })}
            </div>
          </div>

          <div style={styles.panel}>
            <h3 style={styles.subtitulo}>Tarima en armado</h3>
            {seleccion.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: '13px' }}>Aun no has agregado cajas.</p>
            ) : (
              <>
                <div style={{ ...styles.resumen, backgroundColor: tarimaCompleta ? '#dcfce7' : '#f8fafc' }}>
                  <span><b>{seleccion.length}</b> caja(s)</span>
                  <span><b>{fmtNum(totalSeleccion)}</b> pzas</span>
                  {piezasPorTarima > 0 && <span style={{ color: tarimaCompleta ? '#16a34a' : '#b45309' }}>
                    {tarimaCompleta ? 'Tarima completa' : `Faltan ${fmtNum(piezasPorTarima - totalSeleccion)} para la tarima estandar (${fmtNum(piezasPorTarima)})`}
                  </span>}
                </div>
                <div style={styles.listaCajas}>
                  {seleccion.map(c => (
                    <div key={c.id} style={styles.filaCaja}>
                      <span style={{ flex: 1, fontSize: '13px' }}>
                        <b>{c.folio}</b> <span style={{ color: '#64748b' }}>{artDe(c.articulo_id)?.codigo_interno}</span>
                        <span style={{ display: 'block', fontSize: '11px', color: '#94a3b8' }}>lote {loteDe(c.lote_id)?.codigo_lote}</span>
                      </span>
                      <span style={{ width: '70px', textAlign: 'right', fontWeight: '600', fontSize: '13px' }}>{fmtNum(c.cantidad)}</span>
                      <button style={styles.botonAccion} onClick={() => quitarCaja(c.id)}>Quitar</button>
                    </div>
                  ))}
                </div>
                <div style={{ ...styles.botones, marginTop: '14px' }}>
                  <button style={styles.botonSec} onClick={() => setSeleccion([])} disabled={procesando}>Vaciar</button>
                  <button style={styles.boton} onClick={crearTarima} disabled={procesando || !puedeArmar}>
                    {procesando ? 'Creando...' : 'Crear tarima e imprimir master'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {vista === 'tarimas' && (
        tarimas.length === 0 ? <p style={{ color: '#666', padding: '10px 4px' }}>Aun no hay tarimas armadas.</p> : (
          <div style={styles.tabla}>
            <div style={styles.tablaHeader}>
              <span style={{ flex: 1 }}>Folio</span>
              <span style={{ flex: 1.8 }}>Articulo</span>
              <span style={{ flex: 0.7, textAlign: 'center' }}>Cajas</span>
              <span style={{ flex: 0.9, textAlign: 'right' }}>Piezas</span>
              <span style={{ flex: 1.3 }}>Ubicacion</span>
              <span style={{ width: '190px' }}></span>
            </div>
            {tarimas.map(t => {
              const r = resumenTarima(contenedores, t.id, lotes)
              const art = artDe(t.articulo_id)
              return (
                <div key={t.id} style={styles.tablaFila} className="fila-hover">
                  <span style={{ flex: 1, fontWeight: '600' }}>{t.folio}</span>
                  <span style={{ flex: 1.8, fontSize: '13px' }}>
                    {art ? <><b>{art.codigo_interno}</b> <span style={{ color: '#64748b' }}>- {art.descripcion}</span></> : <span style={{ color: '#64748b' }}>Varios del mismo molde</span>}
                    <span style={{ display: 'block', fontSize: '11px', color: '#94a3b8' }}>lotes: {r.lotes.join(', ') || '-'}</span>
                  </span>
                  <span style={{ flex: 0.7, textAlign: 'center' }}>{r.cajas}</span>
                  <span style={{ flex: 0.9, textAlign: 'right', fontWeight: '600' }}>{fmtNum(t.cantidad)}</span>
                  <span style={{ flex: 1.3, fontSize: '13px' }}>{almDe(t.almacen_id)?.clave}{t.ubicacion_id ? ` / ${ubiDe(t.ubicacion_id)?.clave}` : ''}</span>
                  <span style={{ width: '190px', textAlign: 'right', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                    <button style={styles.botonAccion} onClick={() => imprimirTarima(t)}>Etiqueta master</button>
                    {puedeArmar && <button style={{ ...styles.botonAccion, color: '#dc2626' }} onClick={() => desarmar(t)}>Desarmar</button>}
                  </span>
                </div>
              )
            })}
          </div>
        )
      )}

      {vista === 'cajas' && (
        <div style={styles.tabla}>
          <div style={styles.tablaHeader}>
            <span style={{ flex: 1 }}>Folio</span>
            <span style={{ flex: 1.8 }}>Articulo / lote</span>
            <span style={{ flex: 0.9, textAlign: 'right' }}>Piezas</span>
            <span style={{ flex: 1.3 }}>Ubicacion</span>
            <span style={{ flex: 1 }}>Origen</span>
          </div>
          {cajasLibres.slice(0, 200).map(c => (
            <div key={c.id} style={styles.tablaFila} className="fila-hover">
              <span style={{ flex: 1, fontWeight: '600', fontSize: '13px' }}>{c.folio}</span>
              <span style={{ flex: 1.8, fontSize: '13px' }}>
                <b>{artDe(c.articulo_id)?.codigo_interno}</b> <span style={{ color: '#94a3b8' }}>/ {loteDe(c.lote_id)?.codigo_lote}</span>
              </span>
              <span style={{ flex: 0.9, textAlign: 'right', fontWeight: '600' }}>{fmtNum(c.cantidad)}</span>
              <span style={{ flex: 1.3, fontSize: '13px' }}>{almDe(c.almacen_id)?.clave}{c.ubicacion_id ? ` / ${ubiDe(c.ubicacion_id)?.clave}` : ''}</span>
              <span style={{ flex: 1, fontSize: '12px', color: '#64748b' }}>{c.origen || '-'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const styles = {
  container: { padding: '28px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 6px' },
  ayuda: { fontSize: '13px', color: '#64748b', margin: '0 0 16px', lineHeight: '1.5' },
  tabs: { display: 'flex', gap: '4px', marginBottom: '16px', borderBottom: '1px solid #e2e8f0' },
  tab: { padding: '8px 16px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#64748b', cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabActiva: { padding: '8px 16px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#0891b2', fontWeight: '600', cursor: 'pointer', borderBottom: '2px solid #0891b2' },
  columnas: { display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap' },
  panel: { backgroundColor: '#fff', borderRadius: '10px', padding: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', flex: 1, minWidth: '360px' },
  subtitulo: { fontSize: '14px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 10px' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' },
  listaCajas: { maxHeight: '360px', overflowY: 'auto' },
  filaCaja: { display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 0', borderBottom: '1px solid #f1f5f9' },
  resumen: { display: 'flex', gap: '18px', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', marginBottom: '10px', flexWrap: 'wrap' },
  botones: { display: 'flex', justifyContent: 'flex-end', gap: '10px' },
  boton: { padding: '9px 18px', backgroundColor: '#0891b2', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSec: { padding: '9px 18px', backgroundColor: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '11px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
