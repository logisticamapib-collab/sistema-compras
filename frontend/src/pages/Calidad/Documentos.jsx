import { useState, useEffect } from 'react'
import { subirArchivo as subirAStorage } from '../../lib/archivos'
import EnlaceArchivo from '../../components/EnlaceArchivo'
import { supabase } from '../../lib/supabase'
import { exportarExcel, imprimirTablaPDF } from '../../lib/exportar'
import { useAuth } from '../../context/AuthContext'

// CONTROL DE DOCUMENTOS Y REGISTROS (IATF 16949 / ISO 9001, 7.5)
//
// Son dos cosas distintas que la norma junta en una clausula:
//
//   DOCUMENTOS dicen como se hace algo. Se controlan por VERSION: importa
//   cual es la buena hoy y que la de ayer ya no se use.
//
//   REGISTROS son evidencia de que algo paso. No tienen version: importa
//   cuanto hay que guardarlos y cuando se pueden destruir.
//
// El sistema ES la copia controlada. Quien abre un documento ve la vigente y
// no hay forma de abrir una obsoleta por accidente, que es justo lo que pide
// la norma sobre disponibilidad en el punto de uso.

const hoyISO = () => new Date().toISOString().slice(0, 10)

const TIPOS = {
  manual: 'Manual', politica: 'Politica', procedimiento: 'Procedimiento',
  instruccion_trabajo: 'Instruccion de trabajo', formato: 'Formato',
  especificacion: 'Especificacion', plano: 'Plano',
  norma_externa: 'Norma externa', plan_calidad: 'Plan de calidad', otro: 'Otro',
}
const EST = {
  borrador: { txt: 'Borrador', bg: '#fef3c7', col: '#92400e' },
  vigente: { txt: 'Vigente', bg: '#dcfce7', col: '#15803d' },
  obsoleto: { txt: 'Obsoleto', bg: '#e5e7eb', col: '#374151' },
}
const BASES = {
  meses: 'Meses',
  anos_calendario: 'Anos calendario',
  vida_pieza_mas_anos: 'Vida de la pieza + anos',
  permanente: 'Permanente',
}

const docVacio = {
  codigo: '', titulo: '', tipo: 'procedimiento', area_id: '',
  origen: 'interno', fuente_externa: '', proxima_revision: '', notas: '',
}
const regVacio = {
  tipo_id: '', identificador: '', descripcion: '', fecha_registro: hoyISO(),
  fecha_fin_produccion: '', articulo_id: '', ubicacion: '', notas: '',
}

export default function Documentos() {
  const { perfil, tienePermiso } = useAuth()
  const emp = perfil.empresa_id
  const puedeEditar = tienePermiso('cal_documentos', 'crear') || tienePermiso('cal_documentos', 'editar')
  const puedeAprobar = tienePermiso('cal_documentos', 'aprobar')

  const [tab, setTab] = useState('docs')
  const [docs, setDocs] = useState([])
  const [tipos, setTipos] = useState([])
  const [regs, setRegs] = useState([])
  const [purga, setPurga] = useState([])
  const [articulos, setArticulos] = useState([])
  const [areas, setAreas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [subiendo, setSubiendo] = useState(0)

  const [form, setForm] = useState(null)
  const [filtro, setFiltro] = useState('')
  const [verObsoletos, setVerObsoletos] = useState(false)
  const [regForm, setRegForm] = useState(null)

  useEffect(() => { cargar() }, [])

  const cargar = async () => {
    setLoading(true); setError('')
    const [d, t, r, p, a, ars] = await Promise.all([
      supabase.rpc('documentos_resumen', { p_empresa_id: emp }),
      supabase.from('registro_tipos').select('*').eq('empresa_id', emp).order('categoria').order('clave'),
      supabase.from('registros_archivados')
        .select('*, registro_tipos(clave, nombre, disposicion), articulos(codigo_interno)')
        .eq('empresa_id', emp).order('fecha_registro', { ascending: false }).limit(300),
      supabase.rpc('registros_por_purgar', { p_empresa_id: emp, p_dias_aviso: 60 }),
      supabase.from('articulos').select('id, codigo_interno, descripcion').eq('empresa_id', emp).order('codigo_interno'),
      supabase.from('areas').select('id, clave, nombre').eq('empresa_id', emp).eq('activo', true).order('clave'),
    ])
    if (d.error) setError('No se pudo cargar: ' + d.error.message)
    setDocs(d.data || []); setTipos(t.data || []); setRegs(r.data || [])
    setPurga(p.data || []); setArticulos(a.data || []); setAreas(ars.data || [])
    setLoading(false)
  }

  // ---------- Documentos ----------
  const guardarDoc = async () => {
    setError(''); setExito('')
    if (!form.codigo || !form.titulo) { setError('El codigo y el titulo son obligatorios'); return }
    const payload = {
      empresa_id: emp, codigo: form.codigo.toUpperCase(), titulo: form.titulo,
      tipo: form.tipo, area_id: form.area_id ? Number(form.area_id) : null, origen: form.origen,
      fuente_externa: form.origen === 'externo' ? (form.fuente_externa || null) : null,
      proxima_revision: form.proxima_revision || null, notas: form.notas || null,
      version: 1, elaborado_por: perfil.id,
    }
    if (form.id) {
      delete payload.version; delete payload.elaborado_por
      const { error: e } = await supabase.from('documentos').update(payload).eq('id', form.id)
      if (e) { setError('No se pudo guardar: ' + e.message); return }
    } else {
      const { error: e } = await supabase.from('documentos').insert(payload)
      if (e) {
        setError(e.message.includes('duplicate')
          ? `Ya existe un documento con el codigo ${payload.codigo}. Si quieres cambiarlo, abrelo y saca una version nueva.`
          : 'No se pudo guardar: ' + e.message)
        return
      }
    }
    setForm(null); setExito('Documento guardado'); cargar()
  }

  const subirArchivo = async (doc, archivo) => {
    if (!archivo) return
    setError(''); setSubiendo(doc.id)
    const ruta = `documentos/${doc.codigo}_v${doc.version}_${Date.now()}_${archivo.name}`
    // Se guarda la ruta, no una URL publica: el enlace se firma al abrirlo.
    const { valor, error: eS } = await subirAStorage('calidad', ruta, archivo)
    if (eS) { setError('Error al subir: ' + eS); setSubiendo(0); return }
    const { error: e } = await supabase.from('documentos')
      .update({ archivo_url: valor, archivo_nombre: archivo.name }).eq('id', doc.id)
    setSubiendo(0)
    if (e) { setError('No se pudo guardar: ' + e.message); return }
    setExito('Archivo cargado'); cargar()
  }

  const activar = async (doc) => {
    setError(''); setExito('')
    if (!confirm(`Vas a poner vigente ${doc.codigo} version ${doc.version}. La version anterior queda obsoleta de inmediato y a partir de ahora nadie la abre por accidente. Confirma para continuar.`)) return
    const { error: e } = await supabase.rpc('activar_documento', {
      p_empresa_id: emp, p_documento_id: doc.id, p_usuario: perfil.id,
    })
    if (e) { setError(e.message); return }
    setExito(`${doc.codigo} v${doc.version} vigente`); cargar()
  }

  const clonar = async (doc) => {
    setError(''); setExito('')
    const { data, error: e } = await supabase.rpc('clonar_documento', {
      p_empresa_id: emp, p_documento_id: doc.id, p_usuario: perfil.id,
    })
    if (e) { setError(e.message); return }
    setExito('Version nueva en borrador. Carga el archivo actualizado y captura el motivo del cambio.')
    cargar()
  }

  const guardarCampo = async (id, campo, valor) => {
    const { error: e } = await supabase.from('documentos').update({ [campo]: valor || null }).eq('id', id)
    if (e) { setError('No se pudo guardar: ' + e.message); return }
    cargar()
  }

  const descartar = async (doc) => {
    if (!confirm(`Se va a borrar el borrador ${doc.codigo} v${doc.version}. Confirma para continuar.`)) return
    const { error: e } = await supabase.from('documentos').delete().eq('id', doc.id)
    if (e) { setError('No se pudo borrar: ' + e.message); return }
    setExito('Borrador descartado'); cargar()
  }

  // ---------- Tipos de registro ----------
  const guardarTipo = async (id, campo, valor) => {
    const v = ['valor', 'responsable_area_id'].includes(campo)
      ? (valor === '' ? null : Number(valor)) : valor
    const { error: e } = await supabase.from('registro_tipos').update({ [campo]: v }).eq('id', id)
    if (e) { setError('No se pudo guardar: ' + e.message); return }
    setExito('Tipo de registro actualizado'); cargar()
  }

  // ---------- Registros ----------
  const guardarReg = async () => {
    setError(''); setExito('')
    if (!regForm.tipo_id || !regForm.identificador) { setError('Elige el tipo y captura el identificador'); return }
    const payload = {
      empresa_id: emp, tipo_id: Number(regForm.tipo_id),
      identificador: regForm.identificador, descripcion: regForm.descripcion || null,
      fecha_registro: regForm.fecha_registro,
      fecha_fin_produccion: regForm.fecha_fin_produccion || null,
      articulo_id: regForm.articulo_id ? Number(regForm.articulo_id) : null,
      ubicacion: regForm.ubicacion || null, notas: regForm.notas || null,
      capturado_por: perfil.id,
    }
    const r = regForm.id
      ? await supabase.from('registros_archivados').update(payload).eq('id', regForm.id)
      : await supabase.from('registros_archivados').insert(payload)
    if (r.error) { setError('No se pudo guardar: ' + r.error.message); return }
    setRegForm(null); setExito('Registro archivado'); cargar()
  }

  const marcarLegal = async (reg) => {
    const motivo = reg.retencion_legal ? null : prompt('Motivo de la retencion legal (demanda, reclamo, auditoria...):')
    if (!reg.retencion_legal && !motivo) return
    const { error: e } = await supabase.from('registros_archivados')
      .update({ retencion_legal: !reg.retencion_legal, motivo_retencion: motivo }).eq('id', reg.id)
    if (e) { setError('No se pudo guardar: ' + e.message); return }
    setExito(reg.retencion_legal ? 'Retencion legal levantada' : 'Registro bajo retencion legal'); cargar()
  }

  const purgar = async (reg) => {
    if (!confirm(`Vas a marcar como destruido ${reg.identificador || reg.registro_id}.\n\nEl renglon NO se borra: queda constancia de que se destruyo, quien y cuando, que es justo lo que pregunta el auditor.`)) return
    const nota = prompt('Como se dispuso (acta, trituradora, devuelto al cliente...):') || null
    const { error: e } = await supabase.rpc('purgar_registro', {
      p_empresa_id: emp, p_registro_id: reg.registro_id || reg.id, p_usuario: perfil.id, p_notas: nota,
    })
    if (e) { setError(e.message); return }
    setExito('Registro purgado'); cargar()
  }

  // ---------- Derivados ----------
  const lista = docs
    .filter(d => verObsoletos || d.estatus !== 'obsoleto')
    .filter(d => {
      if (!filtro) return true
      const t = filtro.toLowerCase()
      return [d.codigo, d.titulo, d.area, TIPOS[d.tipo]].some(v => (v || '').toLowerCase().includes(t))
    })
  const vencidos = docs.filter(d => d.revision_vencida)
  const sinArchivo = docs.filter(d => d.estatus === 'vigente' && !d.archivo_url)
  const porPurgar = purga.filter(p => p.situacion === 'ya se puede destruir' && !p.retencion_legal)
  const enLegal = purga.filter(p => p.retencion_legal)

  const COLS_D = [
    { label: 'Codigo', get: d => d.codigo },
    { label: 'Titulo', get: d => d.titulo },
    { label: 'Tipo', get: d => TIPOS[d.tipo] || d.tipo },
    { label: 'Area', get: d => d.area || '' },
    { label: 'Version', get: d => d.version },
    { label: 'Estatus', get: d => d.estatus },
    { label: 'Origen', get: d => d.origen },
    { label: 'Fuente externa', get: d => d.fuente_externa || '' },
    { label: 'Vigente desde', get: d => d.vigente_desde || '' },
    { label: 'Proxima revision', get: d => d.proxima_revision || '' },
    { label: 'Motivo del cambio', get: d => d.motivo_cambio || '' },
  ]
  const COLS_R = [
    { label: 'Tipo', get: r => r.registro_tipos?.clave || '' },
    { label: 'Identificador', get: r => r.identificador },
    { label: 'Descripcion', get: r => r.descripcion || '' },
    { label: 'Fecha', get: r => r.fecha_registro },
    { label: 'Articulo', get: r => r.articulos?.codigo_interno || '' },
    { label: 'Fin de produccion', get: r => r.fecha_fin_produccion || '' },
    { label: 'Se puede destruir', get: r => r.fecha_purga || 'sin fecha' },
    { label: 'Retencion legal', get: r => r.retencion_legal ? 'Si' : 'No' },
    { label: 'Ubicacion', get: r => r.ubicacion || '' },
    { label: 'Estatus', get: r => r.estatus },
  ]

  const badge = (e) => {
    const s = EST[e] || {}
    return <span style={{ ...S.tag, background: s.bg, color: s.col }}>{s.txt || e}</span>
  }

  return (
    <div style={S.wrap}>
      <div style={S.top}>
        <div>
          <h2 style={S.h2}>Control de documentos y registros</h2>
          <p style={S.sub}>
            Un <b>documento</b> dice como se hace algo y se controla por version: importa cual es la
            buena hoy. Un <b>registro</b> es evidencia de que algo paso y no tiene version: importa
            cuanto hay que guardarlo. El sistema es la copia controlada, asi que quien abre un
            documento siempre ve la vigente y no hay forma de usar una obsoleta por accidente.
          </p>
        </div>
      </div>

      <div style={S.kpis}>
        <div style={S.kpi}><span style={S.kpiTit}>Documentos vigentes</span><b style={S.kpiVal}>{docs.filter(d => d.estatus === 'vigente').length}</b></div>
        <div style={S.kpi}><span style={S.kpiTit}>En borrador</span><b style={S.kpiVal}>{docs.filter(d => d.estatus === 'borrador').length}</b></div>
        <div style={S.kpi}><span style={S.kpiTit}>Revision vencida</span><b style={{ ...S.kpiVal, color: vencidos.length ? '#b91c1c' : '#1a1a2e' }}>{vencidos.length}</b></div>
        <div style={S.kpi}><span style={S.kpiTit}>Registros archivados</span><b style={S.kpiVal}>{regs.filter(r => r.estatus === 'vigente').length}</b></div>
        <div style={S.kpi}><span style={S.kpiTit}>Ya se pueden destruir</span><b style={{ ...S.kpiVal, color: porPurgar.length ? '#b45309' : '#1a1a2e' }}>{porPurgar.length}</b></div>
        <div style={S.kpi}><span style={S.kpiTit}>Bajo retencion legal</span><b style={{ ...S.kpiVal, color: enLegal.length ? '#4338ca' : '#1a1a2e' }}>{enLegal.length}</b></div>
      </div>

      {sinArchivo.length > 0 && (
        <p style={S.avisoRojo}>
          Hay <b>{sinArchivo.length}</b> documento(s) vigentes sin archivo cargado.
          Un documento controlado sin contenido no sirve: la gente sigue usando la copia que ya tenia.
        </p>
      )}
      {vencidos.length > 0 && (
        <p style={S.aviso}>
          <b>{vencidos.length}</b> documento(s) pasaron su fecha de revision:{' '}
          {vencidos.slice(0, 5).map(d => d.codigo).join(', ')}{vencidos.length > 5 ? '...' : ''}.
        </p>
      )}

      <div style={S.tabs}>
        {[['docs', 'Documentos'], ['registros', 'Registros archivados'],
          ['purga', `Retencion${porPurgar.length ? ` (${porPurgar.length})` : ''}`],
          ['tipos', 'Tiempos de retencion']].map(([id, n]) => (
          <button key={id} style={tab === id ? S.tabAct : S.tab} onClick={() => setTab(id)}>{n}</button>
        ))}
      </div>

      {error && <p style={S.err}>{error}</p>}
      {exito && <p style={S.ok}>{exito}</p>}
      {loading && <p style={S.info}>Cargando...</p>}

      {/* ================= DOCUMENTOS ================= */}
      {tab === 'docs' && (
        <>
          {form && (
            <div style={S.card}>
              <p style={S.cardTit}>{form.id ? 'Editar documento' : 'Nuevo documento'}</p>
              <div style={S.fila}>
                <div style={S.campo}>
                  <label style={S.label}>Codigo *</label>
                  <input style={S.input} maxLength={30} value={form.codigo} disabled={!!form.id}
                    onChange={e => setForm({ ...form, codigo: e.target.value.toUpperCase() })} placeholder="IT-INY-001" />
                </div>
                <div style={{ ...S.campo, flex: 3 }}>
                  <label style={S.label}>Titulo *</label>
                  <input style={S.input} value={form.titulo}
                    onChange={e => setForm({ ...form, titulo: e.target.value })} />
                </div>
                <div style={{ ...S.campo, flex: 1.5 }}>
                  <label style={S.label}>Tipo</label>
                  <select style={S.input} value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>
                    {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div style={S.fila}>
                <div style={S.campo}>
                  <label style={S.label}>Area o proceso</label>
                  <select style={S.input} value={form.area_id}
                    onChange={e => setForm({ ...form, area_id: e.target.value })}>
                    <option value="">Sin asignar</option>
                    {areas.map(a => <option key={a.id} value={a.id}>{a.clave} - {a.nombre}</option>)}
                  </select>
                </div>
                <div style={S.campo}>
                  <label style={S.label}>Origen</label>
                  <select style={S.input} value={form.origen} onChange={e => setForm({ ...form, origen: e.target.value })}>
                    <option value="interno">Interno</option>
                    <option value="externo">Externo (cliente o norma)</option>
                  </select>
                </div>
                {form.origen === 'externo' && (
                  <div style={{ ...S.campo, flex: 2 }}>
                    <label style={S.label}>Fuente</label>
                    <input style={S.input} value={form.fuente_externa}
                      onChange={e => setForm({ ...form, fuente_externa: e.target.value })}
                      placeholder="Especificacion del cliente, norma ASTM..." />
                  </div>
                )}
                <div style={S.campo}>
                  <label style={S.label}>Proxima revision</label>
                  <input type="date" style={S.input} value={form.proxima_revision}
                    onChange={e => setForm({ ...form, proxima_revision: e.target.value })} />
                  <span style={S.ayuda}>Opcional. Si la pones, el sistema avisa cuando venza.</span>
                </div>
              </div>
              <div style={S.acciones}>
                <button style={S.botonSec} onClick={() => setForm(null)}>Cancelar</button>
                <button style={S.boton} onClick={guardarDoc}>Guardar</button>
              </div>
            </div>
          )}

          <div style={S.card}>
            <div style={S.cardHead}>
              <p style={S.cardTit}>Documentos &middot; {lista.length}</p>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={S.check}>
                  <input type="checkbox" checked={verObsoletos} onChange={e => setVerObsoletos(e.target.checked)} />
                  <span>Ver obsoletos</span>
                </label>
                <input style={S.inputMini} value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Buscar..." />
                <button style={S.expBtn} onClick={() => exportarExcel('documentos', COLS_D, lista)}>Excel</button>
                <button style={S.expBtn} onClick={() => imprimirTablaPDF('Lista maestra de documentos', COLS_D, lista)}>PDF</button>
                {puedeEditar && !form && (
                  <button style={S.boton} onClick={() => { setForm({ ...docVacio }); setError('') }}>+ Nuevo</button>
                )}
              </div>
            </div>
            {lista.length === 0 && <p style={S.vacio}>No hay documentos.</p>}
            {lista.length > 0 && (
              <table style={S.tabla}>
                <thead>
                  <tr>
                    <th style={S.th}>Codigo</th><th style={S.th}>Titulo</th><th style={S.th}>Tipo</th>
                    <th style={S.th}>Area</th><th style={S.thR}>Ver.</th><th style={S.th}>Estatus</th>
                    <th style={S.th}>Vigente desde</th><th style={S.th}>Revision</th>
                    <th style={S.th}>Archivo</th><th style={S.th}>Motivo del cambio</th><th style={S.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map(d => (
                    <tr key={d.id} style={d.estatus === 'obsoleto' ? { opacity: 0.55 } : {}}>
                      <td style={{ ...S.td, fontWeight: 600 }}>{d.codigo}</td>
                      <td style={S.td}>
                        {d.titulo}
                        {d.origen === 'externo' && <span style={S.tagAzul}>externo</span>}
                        {d.fuente_externa && <div style={S.mini}>{d.fuente_externa}</div>}
                      </td>
                      <td style={S.td}>{TIPOS[d.tipo] || d.tipo}</td>
                      <td style={S.td}>{d.area || '-'}</td>
                      <td style={S.tdR}>{d.version}</td>
                      <td style={S.td}>{badge(d.estatus)}</td>
                      <td style={S.td}>{d.vigente_desde || '-'}</td>
                      <td style={S.td}>
                        {d.proxima_revision || '-'}
                        {d.revision_vencida && <span style={S.tagRojo}>vencida</span>}
                      </td>
                      <td style={S.td}>
                        {d.archivo_url
                          ? <EnlaceArchivo valor={d.archivo_url} style={S.link}>abrir</EnlaceArchivo>
                          : <span style={{ color: '#b91c1c' }}>falta</span>}
                        {d.estatus === 'borrador' && puedeEditar && (
                          <label style={S.subir}>
                            {subiendo === d.id ? 'subiendo...' : 'cargar'}
                            <input type="file" style={{ display: 'none' }}
                              onChange={e => subirArchivo(d, e.target.files?.[0])} />
                          </label>
                        )}
                      </td>
                      <td style={{ ...S.td, maxWidth: 220 }}>
                        {d.estatus === 'borrador' && d.version > 1 && puedeEditar
                          ? <input style={S.inputMini} defaultValue={d.motivo_cambio || ''}
                              placeholder="Que cambio y por que"
                              onBlur={e => guardarCampo(d.id, 'motivo_cambio', e.target.value)} />
                          : (d.motivo_cambio || '-')}
                      </td>
                      <td style={S.td}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {d.estatus === 'borrador' && puedeAprobar && (
                            <button style={S.btnMini} onClick={() => activar(d)}>Poner vigente</button>
                          )}
                          {d.estatus === 'borrador' && puedeEditar && (
                            <button style={S.btnMiniSec} onClick={() => descartar(d)}>Descartar</button>
                          )}
                          {d.estatus === 'vigente' && puedeEditar && (
                            <button style={S.btnMiniSec} onClick={() => clonar(d)}>Nueva version</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ================= REGISTROS ================= */}
      {tab === 'registros' && (
        <>
          {regForm && (
            <div style={S.card}>
              <p style={S.cardTit}>{regForm.id ? 'Editar registro' : 'Archivar un registro'}</p>
              <div style={S.fila}>
                <div style={{ ...S.campo, flex: 2 }}>
                  <label style={S.label}>Tipo *</label>
                  <select style={S.input} value={regForm.tipo_id}
                    onChange={e => setRegForm({ ...regForm, tipo_id: e.target.value })}>
                    <option value="">Selecciona...</option>
                    {tipos.filter(t => t.activo).map(t => (
                      <option key={t.id} value={t.id}>{t.clave} - {t.nombre}</option>
                    ))}
                  </select>
                </div>
                <div style={{ ...S.campo, flex: 1.5 }}>
                  <label style={S.label}>Identificador *</label>
                  <input style={S.input} value={regForm.identificador}
                    onChange={e => setRegForm({ ...regForm, identificador: e.target.value })}
                    placeholder="PPAP-SH1LA101" />
                </div>
                <div style={S.campo}>
                  <label style={S.label}>Fecha del registro *</label>
                  <input type="date" style={S.input} value={regForm.fecha_registro}
                    onChange={e => setRegForm({ ...regForm, fecha_registro: e.target.value })} />
                </div>
              </div>
              <div style={S.fila}>
                <div style={{ ...S.campo, flex: 2 }}>
                  <label style={S.label}>Articulo</label>
                  <select style={S.input} value={regForm.articulo_id}
                    onChange={e => setRegForm({ ...regForm, articulo_id: e.target.value })}>
                    <option value="">No aplica</option>
                    {articulos.map(a => <option key={a.id} value={a.id}>{a.codigo_interno} - {a.descripcion}</option>)}
                  </select>
                </div>
                <div style={S.campo}>
                  <label style={S.label}>Fin de produccion</label>
                  <input type="date" style={S.input} value={regForm.fecha_fin_produccion}
                    onChange={e => setRegForm({ ...regForm, fecha_fin_produccion: e.target.value })} />
                  <span style={S.ayuda}>
                    Solo para los que se guardan por vida de la pieza. Vacio = sigue viva y no se purga.
                  </span>
                </div>
                <div style={{ ...S.campo, flex: 1.5 }}>
                  <label style={S.label}>Donde esta</label>
                  <input style={S.input} value={regForm.ubicacion}
                    onChange={e => setRegForm({ ...regForm, ubicacion: e.target.value })}
                    placeholder="Archivo muerto anaquel 3 / servidor" />
                </div>
                <div style={{ ...S.campo, flex: 2 }}>
                  <label style={S.label}>Descripcion</label>
                  <input style={S.input} value={regForm.descripcion}
                    onChange={e => setRegForm({ ...regForm, descripcion: e.target.value })} />
                </div>
              </div>
              <div style={S.acciones}>
                <button style={S.botonSec} onClick={() => setRegForm(null)}>Cancelar</button>
                <button style={S.boton} onClick={guardarReg}>Guardar</button>
              </div>
            </div>
          )}

          <div style={S.card}>
            <div style={S.cardHead}>
              <p style={S.cardTit}>Registros &middot; {regs.length}</p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button style={S.expBtn} onClick={() => exportarExcel('registros_archivados', COLS_R, regs)}>Excel</button>
                <button style={S.expBtn} onClick={() => imprimirTablaPDF('Registros archivados', COLS_R, regs)}>PDF</button>
                {puedeEditar && !regForm && (
                  <button style={S.boton} onClick={() => { setRegForm({ ...regVacio }); setError('') }}>+ Archivar</button>
                )}
              </div>
            </div>
            {regs.length === 0 && <p style={S.vacio}>Aun no hay registros archivados.</p>}
            {regs.length > 0 && (
              <table style={S.tabla}>
                <thead>
                  <tr>
                    <th style={S.th}>Tipo</th><th style={S.th}>Identificador</th><th style={S.th}>Fecha</th>
                    <th style={S.th}>Articulo</th><th style={S.th}>Fin produccion</th>
                    <th style={S.th}>Se destruye</th><th style={S.th}>Donde</th>
                    <th style={S.th}>Estatus</th><th style={S.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {regs.map(r => (
                    <tr key={r.id} style={r.estatus === 'purgado' ? { opacity: 0.5 } : {}}>
                      <td style={{ ...S.td, fontWeight: 600 }}>{r.registro_tipos?.clave}</td>
                      <td style={S.td}>
                        {r.identificador}
                        {r.descripcion && <div style={S.mini}>{r.descripcion}</div>}
                      </td>
                      <td style={S.td}>{r.fecha_registro}</td>
                      <td style={S.td}>{r.articulos?.codigo_interno || '-'}</td>
                      <td style={S.td}>{r.fecha_fin_produccion || <span style={S.mini}>en produccion</span>}</td>
                      <td style={S.td}>
                        {r.fecha_purga || <span style={S.mini}>sin fecha todavia</span>}
                        {r.retencion_legal && <span style={S.tagAzul}>retencion legal</span>}
                      </td>
                      <td style={S.td}>{r.ubicacion || '-'}</td>
                      <td style={S.td}>
                        {r.estatus === 'purgado'
                          ? <span style={S.tagGris}>purgado {r.purgado_at ? new Date(r.purgado_at).toLocaleDateString('es-MX') : ''}</span>
                          : <span style={S.tagVerde}>vigente</span>}
                      </td>
                      <td style={S.td}>
                        {r.estatus === 'vigente' && puedeEditar && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button style={S.btnMiniSec} onClick={() => setRegForm({
                              id: r.id, tipo_id: r.tipo_id, identificador: r.identificador,
                              descripcion: r.descripcion || '', fecha_registro: r.fecha_registro,
                              fecha_fin_produccion: r.fecha_fin_produccion || '',
                              articulo_id: r.articulo_id || '', ubicacion: r.ubicacion || '',
                              notas: r.notas || '',
                            })}>Editar</button>
                            <button style={S.btnMiniSec} onClick={() => marcarLegal(r)}>
                              {r.retencion_legal ? 'Levantar retencion' : 'Retencion legal'}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ================= PURGA ================= */}
      {tab === 'purga' && (
        <div style={S.card}>
          <p style={S.cardTit}>Retencion cumplida o por cumplir &middot; proximos 60 dias</p>
          <p style={S.ayuda}>
            La retencion legal manda sobre el calendario: si hay una demanda, un reclamo o una
            auditoria abierta, el registro no se destruye aunque le toque, y desde aqui no se puede.
            Al purgar, el renglon no se borra: queda constancia de que se destruyo, quien y cuando.
          </p>
          {purga.length === 0 && <p style={S.vacio}>No hay registros por vencer en los proximos 60 dias.</p>}
          {purga.length > 0 && (
            <table style={S.tabla}>
              <thead>
                <tr>
                  <th style={S.th}>Tipo</th><th style={S.th}>Identificador</th>
                  <th style={S.th}>Fecha registro</th><th style={S.th}>Se destruye</th>
                  <th style={S.thR}>Dias</th><th style={S.th}>Situacion</th>
                  <th style={S.th}>Disposicion</th><th style={S.th}>Responsable</th>
                  <th style={S.th}>Donde</th><th style={S.th}></th>
                </tr>
              </thead>
              <tbody>
                {purga.map(p => (
                  <tr key={p.registro_id}>
                    <td style={{ ...S.td, fontWeight: 600 }}>{p.tipo_clave}</td>
                    <td style={S.td}>{p.identificador}</td>
                    <td style={S.td}>{p.fecha_registro}</td>
                    <td style={S.td}>{p.fecha_purga || '-'}</td>
                    <td style={S.tdR}>{p.dias != null ? p.dias : '-'}</td>
                    <td style={S.td}>
                      <span style={p.retencion_legal ? S.tagAzul
                        : p.situacion === 'ya se puede destruir' ? S.tagAmbar : S.tagGris}>
                        {p.situacion}
                      </span>
                    </td>
                    <td style={S.td}>{p.disposicion}</td>
                    <td style={S.td}>{p.responsable_area || '-'}</td>
                    <td style={S.td}>{p.ubicacion || '-'}</td>
                    <td style={S.td}>
                      {!p.retencion_legal && p.situacion === 'ya se puede destruir' && puedeAprobar && (
                        <button style={S.btnMini} onClick={() => purgar(p)}>Marcar destruido</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ================= TIPOS ================= */}
      {tab === 'tipos' && (
        <div style={S.card}>
          <p style={S.cardTit}>Tiempos de retencion por tipo de registro</p>
          <p style={S.ayuda}>
            Vienen sembrados con lo que pide IATF 16949. Los requisitos especificos de cada cliente
            pueden pedir <b>mas</b> tiempo, nunca menos, asi que son editables. "Vida de la pieza mas
            anos" significa que mientras la pieza siga en produccion no hay fecha de destruccion.
          </p>
          <table style={S.tabla}>
            <thead>
              <tr>
                <th style={S.th}>Clave</th><th style={S.th}>Tipo de registro</th><th style={S.th}>Categoria</th>
                <th style={S.th}>Base de retencion</th><th style={S.thR}>Valor</th>
                <th style={S.th}>Medio</th><th style={S.th}>Disposicion</th>
                <th style={S.th}>Responsable</th><th style={S.th}>Referencia</th>
              </tr>
            </thead>
            <tbody>
              {tipos.map(t => (
                <tr key={t.id}>
                  <td style={{ ...S.td, fontWeight: 600 }}>{t.clave}</td>
                  <td style={S.td}>{t.nombre}</td>
                  <td style={S.td}>{t.categoria || '-'}</td>
                  <td style={S.td}>
                    <select style={S.inputMini} disabled={!puedeAprobar} value={t.base_retencion}
                      onChange={e => guardarTipo(t.id, 'base_retencion', e.target.value)}>
                      {Object.entries(BASES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td style={S.tdR}>
                    {t.base_retencion === 'permanente' ? '-' : (
                      <input type="number" step="0.5" min="0" style={{ ...S.inputMini, width: 60, textAlign: 'right' }}
                        disabled={!puedeAprobar} defaultValue={t.valor ?? ''}
                        onBlur={e => guardarTipo(t.id, 'valor', e.target.value)} />
                    )}
                  </td>
                  <td style={S.td}>
                    <select style={S.inputMini} disabled={!puedeAprobar} value={t.medio}
                      onChange={e => guardarTipo(t.id, 'medio', e.target.value)}>
                      <option value="fisico">Fisico</option>
                      <option value="digital">Digital</option>
                      <option value="ambos">Ambos</option>
                    </select>
                  </td>
                  <td style={S.td}>
                    <select style={S.inputMini} disabled={!puedeAprobar} value={t.disposicion}
                      onChange={e => guardarTipo(t.id, 'disposicion', e.target.value)}>
                      <option value="destruir">Destruir</option>
                      <option value="archivar">Archivar</option>
                      <option value="devolver_cliente">Devolver al cliente</option>
                    </select>
                  </td>
                  <td style={S.td}>
                    <select style={{ ...S.inputMini, width: 130 }} disabled={!puedeAprobar}
                      value={t.responsable_area_id || ''}
                      onChange={e => guardarTipo(t.id, 'responsable_area_id', e.target.value)}>
                      <option value="">Sin asignar</option>
                      {areas.map(a => <option key={a.id} value={a.id}>{a.clave}</option>)}
                    </select>
                  </td>
                  <td style={S.td}><span style={S.mini}>{t.referencia_norma || '-'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const S = {
  wrap: { padding: '24px 28px' },
  top: { marginBottom: '12px' },
  h2: { fontSize: '20px', color: '#1a1a2e', margin: 0 },
  sub: { color: '#64748b', fontSize: '13px', margin: '4px 0 0', maxWidth: '860px', lineHeight: 1.5 },
  aviso: { background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '8px', padding: '10px 12px', fontSize: '12.5px', color: '#92400e', marginBottom: '10px', lineHeight: 1.5 },
  avisoRojo: { background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px 12px', fontSize: '12.5px', color: '#b91c1c', marginBottom: '10px', lineHeight: 1.5 },
  tabs: { display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' },
  tab: { padding: '8px 15px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  tabAct: { padding: '8px 15px', background: '#b91c1c', color: '#fff', border: '1px solid #b91c1c', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', fontWeight: 500 },
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '15px 17px', marginBottom: '13px' },
  cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' },
  cardTit: { fontSize: '14px', fontWeight: 600, color: '#1a1a2e', margin: '0 0 4px' },
  fila: { display: 'flex', gap: '12px', flexWrap: 'wrap' },
  campo: { display: 'flex', flexDirection: 'column', gap: '5px', flex: 1, minWidth: '130px', marginBottom: '8px' },
  label: { fontSize: '12px', color: '#444', fontWeight: 500 },
  input: { padding: '9px 11px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '13.5px', outline: 'none', background: '#fff', width: '100%', boxSizing: 'border-box' },
  inputMini: { padding: '6px 8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '12px', outline: 'none' },
  ayuda: { fontSize: '11.5px', color: '#64748b', lineHeight: 1.45, margin: '4px 0 8px' },
  check: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: '#444' },
  acciones: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' },
  boton: { padding: '8px 17px', background: '#b91c1c', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', fontWeight: 500 },
  botonSec: { padding: '8px 17px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  btnMini: { padding: '4px 10px', background: '#b91c1c', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '11.5px', cursor: 'pointer' },
  btnMiniSec: { padding: '4px 10px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '6px', fontSize: '11.5px', cursor: 'pointer' },
  expBtn: { padding: '7px 12px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '12.5px', cursor: 'pointer' },
  subir: { marginLeft: 8, fontSize: 11.5, color: '#b91c1c', cursor: 'pointer', textDecoration: 'underline' },
  err: { color: '#b91c1c', fontSize: '13px', margin: '0 0 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '9px 12px', lineHeight: 1.5 },
  ok: { color: '#15803d', fontSize: '13px', margin: '0 0 10px' },
  info: { color: '#64748b', fontSize: '13px' },
  vacio: { color: '#64748b', fontSize: '13px', margin: 0 },
  kpis: { display: 'flex', gap: '11px', flexWrap: 'wrap', marginBottom: '13px' },
  kpi: { flex: 1, minWidth: '130px', display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '13px 16px' },
  kpiTit: { fontSize: '10.5px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 },
  kpiVal: { fontSize: '21px', color: '#1a1a2e', margin: '3px 0 1px' },
  tabla: { width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' },
  th: { textAlign: 'left', padding: '8px 9px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' },
  thR: { textAlign: 'right', padding: '8px 9px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' },
  td: { padding: '7px 9px', borderBottom: '1px solid #f1f5f9', color: '#1a1a2e' },
  tdR: { padding: '7px 9px', borderBottom: '1px solid #f1f5f9', color: '#1a1a2e', textAlign: 'right', whiteSpace: 'nowrap' },
  mini: { fontSize: '10.5px', color: '#64748b', marginTop: 2 },
  link: { color: '#b91c1c', fontSize: '12px' },
  tag: { fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', whiteSpace: 'nowrap' },
  tagRojo: { fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', background: '#fee2e2', color: '#b91c1c', marginLeft: 5 },
  tagAmbar: { fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', background: '#fef3c7', color: '#92400e' },
  tagAzul: { fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', background: '#e0e7ff', color: '#4338ca', marginLeft: 5 },
  tagVerde: { fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', background: '#dcfce7', color: '#15803d' },
  tagGris: { fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', background: '#e5e7eb', color: '#374151' },
}
