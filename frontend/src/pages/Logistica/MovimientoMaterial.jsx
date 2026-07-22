import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { etiquetaRol } from '../../lib/roles'
import { moverContenedor } from '../../lib/contenedores'

// Movimiento guiado por el flujo del articulo. El usuario no elige destino:
// el sistema le dice el siguiente paso (almacen + ubicacion) y solo confirma.
//   Enviar   -> descuenta del origen; el material queda EN TRANSITO.
//   Recibir  -> el destino confirma y ubica (si el paso es de ubicacion libre).
//   Firmar   -> los pasos marcados exigen firma del rol configurado para poder salir.
// Al firmar el ultimo paso que requiere liberacion, el lote queda LIBERADO y
// puede embarcarse.

const fmtNum = (n) => (Number(n) || 0).toLocaleString('es-MX')
const fmtFH = (f) => f ? new Date(f).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '-'

export default function MovimientoMaterial() {
  const { perfil, tienePermiso } = useAuth()
  const puedeMover = tienePermiso('log_movimiento', 'crear')
  const puedeFirmar = tienePermiso('log_movimiento', 'aprobar')
  const puedeForzar = tienePermiso('log_movimiento', 'editar')

  const [vista, setVista] = useState('enviar')
  const [articulos, setArticulos] = useState([])
  const [almacenes, setAlmacenes] = useState([])
  const [ubicaciones, setUbicaciones] = useState([])
  const [pasos, setPasos] = useState([])
  const [lotes, setLotes] = useState([])
  const [existencias, setExistencias] = useState([])
  const [firmas, setFirmas] = useState([])
  const [traspasos, setTraspasos] = useState([])
  const [maquinas, setMaquinas] = useState([])
  const [contenedores, setContenedores] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [procesando, setProcesando] = useState(false)
  const [texto, setTexto] = useState('')
  const [envio, setEnvio] = useState(null)     // { ex, paso, siguiente, cantidad, fuera, justificacion }
  const [recepcion, setRecepcion] = useState(null) // { traspaso, ubicacion_id }
  const [firma, setFirma] = useState(null)     // { ex, paso, nota }

  useEffect(() => { cargar() }, [])

  const cargar = async () => {
    setLoading(true)
    const [a, al, ub, ps, lo, ex, fi, tr, mq, ct] = await Promise.all([
      supabase.from('articulos').select('id, codigo_interno, descripcion, unidad_medida, flujo_id').eq('empresa_id', perfil.empresa_id),
      supabase.from('almacenes').select('*'),
      supabase.from('ubicaciones').select('*'),
      supabase.from('flujo_pasos').select('*').order('secuencia'),
      supabase.from('lotes').select('*'),
      supabase.from('existencias').select('*'),
      supabase.from('lote_firmas').select('*, usuario:usuarios!lote_firmas_firmado_por_fkey(nombre)'),
      supabase.from('traspasos').select('*, envio:usuarios!traspasos_enviado_por_fkey(nombre)').eq('estatus', 'enviado').order('fecha_envio'),
      supabase.from('maquinas').select('id, clave'),
      supabase.from('contenedores').select('*').eq('estatus', 'activo'),
    ])
    setArticulos(a.data || []); setAlmacenes(al.data || []); setUbicaciones(ub.data || []); setPasos(ps.data || [])
    setLotes(lo.data || []); setExistencias(ex.data || []); setFirmas(fi.data || []); setTraspasos(tr.data || [])
    setMaquinas(mq.data || []); setContenedores(ct.data || [])
    setLoading(false)
  }

  const artDe = (id) => articulos.find(a => a.id === id)
  const almDe = (id) => almacenes.find(a => a.id === id)
  const ubiDe = (id) => ubicaciones.find(u => u.id === id)
  const loteDe = (id) => lotes.find(l => l.id === id)
  const pasosDeArt = (artId) => { const a = artDe(artId); return a?.flujo_id ? pasos.filter(p => p.flujo_id === a.flujo_id) : [] }
  const firmaDe = (loteId, pasoId) => firmas.find(f => f.lote_id === loteId && f.paso_id === pasoId)

  // Ubicacion destino de un paso segun su modo
  const ubicacionDestino = (paso, loteId) => {
    if (!paso) return { ubicacion: null, modo: null, falta: false }
    if (paso.ubicacion_modo === 'fija') return { ubicacion: ubiDe(paso.ubicacion_id), modo: 'fija', falta: !paso.ubicacion_id }
    if (paso.ubicacion_modo === 'maquina') {
      // Se resuelve con la maquina de origen del lote (ubicacion ligada a maquina en ese almacen)
      const u = ubicaciones.find(x => x.almacen_id === paso.almacen_id && x.maquina_id)
      return { ubicacion: u, modo: 'maquina', falta: !u }
    }
    return { ubicacion: null, modo: 'libre', falta: false }
  }

  // Existencias con su paso actual y el siguiente segun el flujo
  const filas = existencias
    .filter(e => Number(e.cantidad) > 0)
    .map(e => {
      const lote = loteDe(e.lote_id)
      const art = lote ? artDe(lote.articulo_id) : null
      const ps = art ? pasosDeArt(art.id) : []
      const idx = ps.findIndex(p => p.almacen_id === e.almacen_id)
      const paso = idx >= 0 ? ps[idx] : null
      const siguiente = idx >= 0 ? ps[idx + 1] || null : null
      return { ...e, _lote: lote, _art: art, _pasos: ps, _paso: paso, _siguiente: siguiente, _idx: idx, _esUltimo: idx >= 0 && idx === ps.length - 1 }
    })
    .filter(e => e._lote && e._art)
    .filter(e => e._art.flujo_id)  // solo fabricados con flujo; comprados/consigna se mueven en Traspaso por Escaneo
    .filter(e => {
      if (!texto) return true
      const t = texto.toLowerCase()
      return e._art.codigo_interno.toLowerCase().includes(t) || e._art.descripcion.toLowerCase().includes(t) || e._lote.codigo_lote.toLowerCase().includes(t)
    })
    .sort((a, b) => a._art.codigo_interno.localeCompare(b._art.codigo_interno))

  // Puede salir del paso actual?
  const bloqueoDe = (f) => {
    if (!f._paso) return 'El material esta en un almacen que no pertenece al flujo del articulo'
    if (f._lote.estatus_calidad === 'rechazado') return 'Lote rechazado: solo puede moverse a cuarentena o con movimiento forzado'
    if (f._paso.requiere_liberacion && !firmaDe(f._lote.id, f._paso.id)) {
      return `Requiere firma de ${etiquetaRol(f._paso.rol_libera || 'calidad')} para salir de este paso`
    }
    if (!f._siguiente) return 'Ultimo paso del flujo: disponible para embarque'
    return null
  }

  // ---------- Enviar al siguiente paso ----------
  const abrirEnvio = (f) => {
    setError('')
    setEnvio({ f, cantidad: String(f.cantidad), fuera: false, justificacion: '', almacen_destino_id: '' })
  }

  const confirmarEnvio = async () => {
    const { f } = envio
    const cant = Number(envio.cantidad)
    setError('')
    if (!(cant > 0) || cant > Number(f.cantidad)) { setError(`Cantidad invalida (disponible ${fmtNum(f.cantidad)})`); return }
    const destinoPaso = envio.fuera ? null : f._siguiente
    const almDest = envio.fuera ? Number(envio.almacen_destino_id) : destinoPaso?.almacen_id
    if (!almDest) { setError('Selecciona el almacen destino'); return }
    if (envio.fuera && !envio.justificacion.trim()) { setError('El movimiento fuera de flujo requiere justificacion'); return }

    setProcesando(true)
    try {
      const ud = envio.fuera ? { ubicacion: null } : ubicacionDestino(destinoPaso, f._lote.id)
      const nueva = Number(f.cantidad) - cant
      if (nueva <= 0.000001) await supabase.from('existencias').delete().eq('id', f.id)
      else await supabase.from('existencias').update({ cantidad: nueva }).eq('id', f.id)

      await supabase.from('traspasos').insert({
        empresa_id: perfil.empresa_id, folio: `TR-${Date.now().toString().slice(-8)}`,
        lote_id: f._lote.id, articulo_id: f._art.id, cantidad: cant,
        paso_origen_id: f._paso?.id || null, paso_destino_id: destinoPaso?.id || null,
        almacen_origen_id: f.almacen_id, ubicacion_origen_id: f.ubicacion_id,
        almacen_destino_id: almDest, ubicacion_destino_id: ud.ubicacion?.id || null,
        fuera_flujo: envio.fuera, justificacion: envio.fuera ? envio.justificacion.trim() : null,
        enviado_por: perfil.id,
      })
      await supabase.from('movimientos').insert({
        empresa_id: perfil.empresa_id, articulo_id: f._art.id, lote_id: f._lote.id, tipo: 'traspaso',
        almacen_origen_id: f.almacen_id, ubicacion_origen_id: f.ubicacion_id,
        almacen_destino_id: almDest, ubicacion_destino_id: ud.ubicacion?.id || null,
        cantidad: cant, fuera_flujo: envio.fuera, justificacion: envio.fuera ? envio.justificacion.trim() : null,
        motivo: `Envio a ${almDe(almDest)?.clave} (pendiente de recepcion)`, usuario_id: perfil.id,
      })
      setExito(`Enviado a ${almDe(almDest)?.clave}. El destino debe confirmar la recepcion.`)
      setEnvio(null); await cargar(); setVista('recibir')
    } catch (err) { setError('Error: ' + err.message) }
    setProcesando(false)
  }

  // ---------- Confirmar recepcion ----------
  const confirmarRecepcion = async () => {
    const { traspaso } = recepcion
    setError('')
    const paso = pasos.find(p => p.id === traspaso.paso_destino_id)
    const ud = ubicacionDestino(paso, traspaso.lote_id)
    const ubicFinal = ud.modo === 'libre' || !paso
      ? (recepcion.ubicacion_id ? Number(recepcion.ubicacion_id) : null)
      : (ud.ubicacion?.id || null)
    if ((ud.modo === 'libre' || !paso) && !recepcion.ubicacion_id) { setError('Selecciona la ubicacion donde se acomoda el material'); return }

    setProcesando(true)
    try {
      const existente = existencias.find(e => e.lote_id === traspaso.lote_id && e.almacen_id === traspaso.almacen_destino_id && (e.ubicacion_id || null) === ubicFinal)
      if (existente) await supabase.from('existencias').update({ cantidad: Number(existente.cantidad) + Number(traspaso.cantidad) }).eq('id', existente.id)
      else await supabase.from('existencias').insert({ lote_id: traspaso.lote_id, almacen_id: traspaso.almacen_destino_id, ubicacion_id: ubicFinal, cantidad: traspaso.cantidad })

      await supabase.from('traspasos').update({
        estatus: 'recibido', recibido_por: perfil.id, fecha_recepcion: new Date().toISOString(), ubicacion_destino_id: ubicFinal,
      }).eq('id', traspaso.id)

      // Las cajas y tarimas del lote que estaban en el origen se reubican al destino
      const enOrigen = contenedores.filter(c => c.lote_id === traspaso.lote_id
        && c.almacen_id === traspaso.almacen_origen_id
        && (c.ubicacion_id || null) === (traspaso.ubicacion_origen_id || null))
      for (const c of enOrigen.filter(x => !x.padre_id)) {
        await moverContenedor(supabase, c.id, { almacenId: traspaso.almacen_destino_id, ubicacionId: ubicFinal })
      }

      setExito(`Recepcion confirmada en ${almDe(traspaso.almacen_destino_id)?.clave}${ubicFinal ? ' / ' + ubiDe(ubicFinal)?.clave : ''}`)
      setRecepcion(null); await cargar()
    } catch (err) { setError('Error: ' + err.message) }
    setProcesando(false)
  }

  // ---------- Firmar liberacion del paso ----------
  const confirmarFirma = async () => {
    const { f } = firma
    setError('')
    const rolReq = f._paso.rol_libera || 'calidad'
    if (perfil.rol !== rolReq && perfil.rol !== 'admin') { setError(`Solo ${etiquetaRol(rolReq)} puede firmar este paso`); return }
    setProcesando(true)
    try {
      await supabase.from('lote_firmas').insert({
        lote_id: f._lote.id, paso_id: f._paso.id, firmado_por: perfil.id, nota: firma.nota || null,
      })
      // Si es el ultimo paso que requiere firma, el lote queda liberado globalmente
      const conFirma = f._pasos.filter(p => p.requiere_liberacion)
      const ultimo = conFirma[conFirma.length - 1]
      if (ultimo && ultimo.id === f._paso.id) {
        await supabase.from('lotes').update({ estatus_calidad: 'liberado', liberado_por: perfil.id, liberado_en: new Date().toISOString() }).eq('id', f._lote.id)
        await supabase.from('movimientos').insert({
          empresa_id: perfil.empresa_id, articulo_id: f._art.id, lote_id: f._lote.id, tipo: 'liberacion_calidad',
          cantidad: f.cantidad, motivo: `Firma final del flujo (${almDe(f.almacen_id)?.clave})`, usuario_id: perfil.id,
        })
      }
      setExito(`Firma registrada en el paso ${almDe(f.almacen_id)?.clave}${ultimo?.id === f._paso.id ? ': el lote queda LIBERADO' : ''}`)
      setFirma(null); await cargar()
    } catch (err) {
      setError(err.message.includes('duplicate') ? 'Ese paso ya estaba firmado para este lote' : 'Error: ' + err.message)
    }
    setProcesando(false)
  }

  const pendientesRecepcion = traspasos
  const badgeCal = (est) => est === 'liberado' ? styles.badgeVerde : est === 'rechazado' ? styles.badgeRojo : styles.badgeAmbar

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>

  return (
    <div style={styles.container} className="aparecer">
      <h2 style={styles.titulo}>Movimiento de Material</h2>
      <p style={styles.ayuda}>Solo material <b>fabricado con flujo</b> (la MP y comprados se mueven en Traspaso por Escaneo). El sistema indica el <b>siguiente paso</b>: el origen envia y el destino confirma la recepcion; las cajas se reubican al confirmar. Los pasos marcados exigen la firma del rol configurado para poder avanzar.</p>

      <div style={styles.tabs}>
        {[['enviar', 'Enviar al siguiente paso'], ['recibir', `Por recibir${pendientesRecepcion.length ? ` (${pendientesRecepcion.length})` : ''}`]].map(([id, n]) => (
          <button key={id} style={vista === id ? styles.tabActiva : styles.tab} onClick={() => setVista(id)}>{n}</button>
        ))}
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {vista === 'enviar' && (
        <>
          <div style={styles.filtros}>
            <input style={{ ...styles.input, flex: 1 }} placeholder="Buscar articulo o lote..." value={texto} onChange={e => setTexto(e.target.value)} />
          </div>
          {filas.length === 0 ? (
            <p style={{ color: '#666', padding: '10px 4px' }}>No hay material en existencia.</p>
          ) : (
            <div style={styles.tabla}>
              <div style={styles.tablaHeader}>
                <span style={{ flex: 1.9 }}>Articulo / lote</span>
                <span style={{ flex: 1.2 }}>Paso actual</span>
                <span style={{ flex: 0.8, textAlign: 'right' }}>Cantidad</span>
                <span style={{ flex: 0.8, textAlign: 'center' }}>Calidad</span>
                <span style={{ flex: 1.5 }}>Siguiente paso</span>
                <span style={{ width: '190px' }}></span>
              </div>
              {filas.map(f => {
                const bloqueo = bloqueoDe(f)
                const ud = f._siguiente ? ubicacionDestino(f._siguiente, f._lote.id) : null
                const requiereFirma = f._paso?.requiere_liberacion && !firmaDe(f._lote.id, f._paso.id)
                return (
                  <div key={f.id} style={styles.tablaFila} className="fila-hover">
                    <span style={{ flex: 1.9, fontSize: '13px' }}>
                      <b>{f._art.codigo_interno}</b> <span style={{ color: '#94a3b8' }}>/ {f._lote.codigo_lote}</span>
                      <span style={{ display: 'block', color: '#64748b', fontSize: '12px' }}>{f._art.descripcion}</span>
                    </span>
                    <span style={{ flex: 1.2, fontSize: '13px' }}>
                      {almDe(f.almacen_id)?.clave}{f.ubicacion_id ? ` / ${ubiDe(f.ubicacion_id)?.clave}` : ''}
                      {f._paso && <span style={{ display: 'block', color: '#94a3b8', fontSize: '11px' }}>paso {f._idx + 1} de {f._pasos.length}</span>}
                    </span>
                    <span style={{ flex: 0.8, textAlign: 'right', fontWeight: '600' }}>
                      {fmtNum(f.cantidad)}
                      {(() => {
                        const aqui = contenedores.filter(c => c.lote_id === f._lote.id && c.almacen_id === f.almacen_id && (c.ubicacion_id || null) === (f.ubicacion_id || null) && !c.padre_id)
                        if (!aqui.length) return null
                        return <span style={{ display: 'block', fontSize: '11px', color: '#94a3b8', fontWeight: '400' }}>
                          {aqui.slice(0, 4).map(c => c.folio).join(', ')}{aqui.length > 4 ? ` +${aqui.length - 4}` : ''}
                        </span>
                      })()}
                    </span>
                    <span style={{ flex: 0.8, textAlign: 'center' }}>
                      <span style={{ ...styles.badge, ...badgeCal(f._lote.estatus_calidad) }}>{f._lote.estatus_calidad}</span>
                    </span>
                    <span style={{ flex: 1.5, fontSize: '12px', color: bloqueo ? '#b45309' : '#16a34a' }}>
                      {f._siguiente
                        ? <><b>{almDe(f._siguiente.almacen_id)?.clave}</b>{ud?.ubicacion ? ` / ${ud.ubicacion.clave}` : ud?.modo === 'libre' ? ' / (ubica al recibir)' : ''}</>
                        : 'Fin del flujo'}
                      {bloqueo && <span style={{ display: 'block', color: '#b45309' }}>{bloqueo}</span>}
                    </span>
                    <span style={{ width: '190px', textAlign: 'right', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                      {requiereFirma && puedeFirmar && (
                        <button style={{ ...styles.botonAccion, color: '#16a34a', borderColor: '#bbf7d0' }} onClick={() => { setError(''); setFirma({ f, nota: '' }) }}>Firmar</button>
                      )}
                      {puedeMover && f._siguiente && !bloqueo && (
                        <button style={styles.botonAccion} onClick={() => abrirEnvio(f)}>Enviar</button>
                      )}
                      {puedeForzar && (
                        <button style={{ ...styles.botonAccion, color: '#dc2626' }} onClick={() => { setError(''); setEnvio({ f, cantidad: String(f.cantidad), fuera: true, justificacion: '', almacen_destino_id: '' }) }}>Forzar</button>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {vista === 'recibir' && (
        pendientesRecepcion.length === 0 ? (
          <p style={{ color: '#666', padding: '10px 4px' }}>No hay material en transito pendiente de recibir.</p>
        ) : (
          <div style={styles.tabla}>
            <div style={styles.tablaHeader}>
              <span style={{ flex: 1 }}>Folio</span>
              <span style={{ flex: 1.9 }}>Articulo / lote</span>
              <span style={{ flex: 1.2 }}>Origen</span>
              <span style={{ flex: 1.2 }}>Destino</span>
              <span style={{ flex: 0.8, textAlign: 'right' }}>Cantidad</span>
              <span style={{ flex: 1.2 }}>Envio</span>
              <span style={{ width: '110px' }}></span>
            </div>
            {pendientesRecepcion.map(t => (
              <div key={t.id} style={styles.tablaFila} className="fila-hover">
                <span style={{ flex: 1, fontWeight: '600', fontSize: '13px' }}>{t.folio}</span>
                <span style={{ flex: 1.9, fontSize: '13px' }}>
                  <b>{artDe(t.articulo_id)?.codigo_interno}</b> <span style={{ color: '#94a3b8' }}>/ {loteDe(t.lote_id)?.codigo_lote}</span>
                </span>
                <span style={{ flex: 1.2, fontSize: '13px', color: '#64748b' }}>{almDe(t.almacen_origen_id)?.clave}{t.ubicacion_origen_id ? ` / ${ubiDe(t.ubicacion_origen_id)?.clave}` : ''}</span>
                <span style={{ flex: 1.2, fontSize: '13px' }}><b>{almDe(t.almacen_destino_id)?.clave}</b>{t.ubicacion_destino_id ? ` / ${ubiDe(t.ubicacion_destino_id)?.clave}` : ''}</span>
                <span style={{ flex: 0.8, textAlign: 'right', fontWeight: '600' }}>{fmtNum(t.cantidad)}</span>
                <span style={{ flex: 1.2, fontSize: '12px', color: '#64748b' }}>{t.envio?.nombre}<br />{fmtFH(t.fecha_envio)}</span>
                <span style={{ width: '110px', textAlign: 'right' }}>
                  {puedeMover && <button style={styles.boton} onClick={() => { setError(''); setRecepcion({ traspaso: t, ubicacion_id: t.ubicacion_destino_id || '' }) }}>Recibir</button>}
                </span>
              </div>
            ))}
          </div>
        )
      )}

      {/* Modal envio */}
      {envio && (
        <div style={styles.overlay} onClick={() => setEnvio(null)}>
          <div style={styles.modal} onClick={ev => ev.stopPropagation()}>
            <h3 style={styles.formTitulo}>{envio.fuera ? 'Movimiento fuera de flujo' : 'Enviar al siguiente paso'}</h3>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 14px' }}>
              {envio.f._art.codigo_interno} / lote <b>{envio.f._lote.codigo_lote}</b> - Origen: <b>{almDe(envio.f.almacen_id)?.clave}</b> (disponible {fmtNum(envio.f.cantidad)})
            </p>
            {!envio.fuera && envio.f._siguiente && (
              <div style={styles.destinoBox}>
                Destino segun el flujo: <b>{almDe(envio.f._siguiente.almacen_id)?.clave}</b>
                {(() => { const ud = ubicacionDestino(envio.f._siguiente, envio.f._lote.id)
                  return ud.ubicacion ? <> / <b>{ud.ubicacion.clave}</b></> : ud.modo === 'libre' ? ' (la ubicacion la define quien recibe)' : ''
                })()}
              </div>
            )}
            {envio.fuera && (
              <>
                <div style={{ ...styles.campo, marginBottom: '10px' }}>
                  <label style={styles.label}>Almacen destino *</label>
                  <select style={styles.input} value={envio.almacen_destino_id} onChange={e => setEnvio({ ...envio, almacen_destino_id: e.target.value })}>
                    <option value="">Selecciona...</option>
                    {almacenes.filter(a => a.id !== envio.f.almacen_id).map(a => <option key={a.id} value={a.id}>{a.clave} - {a.nombre}</option>)}
                  </select>
                </div>
                <div style={{ ...styles.campo, marginBottom: '10px' }}>
                  <label style={styles.label}>Justificacion *</label>
                  <input style={styles.input} value={envio.justificacion} onChange={e => setEnvio({ ...envio, justificacion: e.target.value })} placeholder="Motivo del movimiento excepcional" />
                </div>
              </>
            )}
            <div style={{ ...styles.campo, marginBottom: '16px' }}>
              <label style={styles.label}>Cantidad a enviar *</label>
              <input type="number" min="0" style={styles.input} value={envio.cantidad} onChange={e => setEnvio({ ...envio, cantidad: e.target.value })} autoFocus />
            </div>
            <div style={styles.botones}>
              <button style={styles.botonSec} onClick={() => setEnvio(null)} disabled={procesando}>Cancelar</button>
              <button style={styles.boton} onClick={confirmarEnvio} disabled={procesando}>{procesando ? 'Enviando...' : 'Confirmar envio'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal recepcion */}
      {recepcion && (() => {
        const t = recepcion.traspaso
        const paso = pasos.find(p => p.id === t.paso_destino_id)
        const ud = ubicacionDestino(paso, t.lote_id)
        const pideUbicacion = ud.modo === 'libre' || !paso
        return (
          <div style={styles.overlay} onClick={() => setRecepcion(null)}>
            <div style={styles.modal} onClick={ev => ev.stopPropagation()}>
              <h3 style={styles.formTitulo}>Confirmar recepcion {t.folio}</h3>
              <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 14px' }}>
                {artDe(t.articulo_id)?.codigo_interno} / lote <b>{loteDe(t.lote_id)?.codigo_lote}</b> - {fmtNum(t.cantidad)} pzas en <b>{almDe(t.almacen_destino_id)?.clave}</b>
              </p>
              {pideUbicacion ? (
                <div style={{ ...styles.campo, marginBottom: '16px' }}>
                  <label style={styles.label}>Ubicacion donde se acomoda *</label>
                  <select style={styles.input} value={recepcion.ubicacion_id} onChange={e => setRecepcion({ ...recepcion, ubicacion_id: e.target.value })} autoFocus>
                    <option value="">Selecciona...</option>
                    {ubicaciones.filter(u => u.almacen_id === t.almacen_destino_id).map(u => <option key={u.id} value={u.id}>{u.clave}{u.es_cuarentena ? ' (cuarentena)' : ''}</option>)}
                  </select>
                </div>
              ) : (
                <div style={{ ...styles.destinoBox, marginBottom: '16px' }}>Ubicacion definida por el flujo: <b>{ud.ubicacion?.clave || 'sin ubicacion'}</b></div>
              )}
              <div style={styles.botones}>
                <button style={styles.botonSec} onClick={() => setRecepcion(null)} disabled={procesando}>Cancelar</button>
                <button style={styles.boton} onClick={confirmarRecepcion} disabled={procesando}>{procesando ? 'Recibiendo...' : 'Confirmar recepcion'}</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Modal firma */}
      {firma && (
        <div style={styles.overlay} onClick={() => setFirma(null)}>
          <div style={styles.modal} onClick={ev => ev.stopPropagation()}>
            <h3 style={styles.formTitulo}>Firmar liberacion del paso</h3>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 14px' }}>
              {firma.f._art.codigo_interno} / lote <b>{firma.f._lote.codigo_lote}</b> en <b>{almDe(firma.f.almacen_id)?.clave}</b>
              {firma.f.ubicacion_id ? ` / ${ubiDe(firma.f.ubicacion_id)?.clave}` : ''} - {fmtNum(firma.f.cantidad)} pzas
              <br />Firma requerida: <b>{etiquetaRol(firma.f._paso?.rol_libera || 'calidad')}</b>
            </p>
            <div style={{ ...styles.campo, marginBottom: '16px' }}>
              <label style={styles.label}>Nota / dictamen (opcional)</label>
              <input style={styles.input} value={firma.nota} onChange={e => setFirma({ ...firma, nota: e.target.value })} placeholder="Ej. inspeccion conforme" autoFocus />
            </div>
            <div style={styles.botones}>
              <button style={styles.botonSec} onClick={() => setFirma(null)} disabled={procesando}>Cancelar</button>
              <button style={{ ...styles.boton, backgroundColor: '#16a34a' }} onClick={confirmarFirma} disabled={procesando}>{procesando ? 'Firmando...' : 'Firmar'}</button>
            </div>
          </div>
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
  filtros: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', backgroundColor: '#fff', borderRadius: '10px', padding: '14px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', fontFamily: 'inherit', backgroundColor: '#fff' },
  destinoBox: { backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', color: '#1e40af', marginBottom: '12px' },
  botones: { display: 'flex', justifyContent: 'flex-end', gap: '10px' },
  boton: { padding: '8px 18px', backgroundColor: '#0891b2', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSec: { padding: '8px 18px', backgroundColor: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#fff', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer', fontWeight: '600' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '11px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  modal: { backgroundColor: '#fff', borderRadius: '12px', padding: '28px', width: '560px', maxWidth: '92vw', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' },
  formTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 12px 0' },
  badge: { padding: '2px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: '600' },
  badgeVerde: { backgroundColor: '#dcfce7', color: '#16a34a' },
  badgeAmbar: { backgroundColor: '#fef3c7', color: '#b45309' },
  badgeRojo: { backgroundColor: '#fee2e2', color: '#dc2626' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
