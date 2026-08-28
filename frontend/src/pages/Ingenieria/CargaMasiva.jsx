import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Carga masiva de Articulos y BOM por plantilla Excel.
// Descarga plantilla -> se llena -> se sube -> valida fila por fila -> carga los validos.
// Las referencias se hacen por texto (codigo, nombre de categoria/maquilador/site) y el
// sistema las resuelve a IDs; nunca se piden IDs internos.

const UNIDADES = ['PZA', 'KG', 'LT', 'MT', 'CJ', 'RLL', 'PAR', 'JGO', 'SRV', 'TON', 'GR', 'ML', 'CM', 'M2', 'M3']
const TIPOS_PROCESO = ['solo_inyeccion', 'solo_ensamble', 'inyeccion_y_ensamble', 'doble_inyeccion']
const COLS_ART = ['codigo_interno', 'descripcion', 'origen', 'unidad_medida', 'categoria', 'es_consigna', 'tipo_proceso', 'peso_pieza_g', 'peso_colada_g', 'peso_purga_g', 'pct_scrap_aprobado', 'admite_molido', 'pct_molido_max', 'lead_time_dias', 'moq', 'tiempo_transito_dias', 'stock_minimo', 'snp', 'dias_inventario_seguridad', 'multiplo_lote', 'costo', 'tipo_moneda', 'iva_porcentaje', 'se_maquila', 'maquilador', 'precio_maquila', 'site']
const COLS_BOM = ['articulo_padre', 'componente', 'tipo_componente', 'cantidad_por_unidad', 'unidad_medida']

const boolCel = (v) => ['si', 'sí', 'x', '1', 'true', 'verdadero', 'y', 'yes'].includes(String(v ?? '').trim().toLowerCase())
const numCel = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(n) ? null : n }
const txt = (v) => String(v ?? '').trim()

export default function CargaMasiva() {
  const { perfil, tienePermiso } = useAuth()
  const emp = perfil.empresa_id
  const puedeArt = tienePermiso('articulos', 'crear')
  const puedeBom = tienePermiso('ing_bom', 'crear')

  const [vista, setVista] = useState('articulos')
  const [cats, setCats] = useState([])
  const [maquiladores, setMaquiladores] = useState([])
  const [sites, setSites] = useState([])
  const [arts, setArts] = useState([])
  const [filas, setFilas] = useState([])   // {n, payload, errores, tipo}
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [proc, setProc] = useState(false)
  const [resultado, setResultado] = useState(null)

  useEffect(() => { cargar() }, [])
  const cargar = async () => {
    const [c, p, s, a] = await Promise.all([
      supabase.from('categorias').select('id, nombre').eq('empresa_id', emp),
      supabase.from('proveedores').select('id, nombre').eq('empresa_id', emp),
      supabase.from('sites').select('id, nombre').eq('empresa_id', emp),
      supabase.from('articulos').select('id, codigo_interno').eq('empresa_id', emp),
    ])
    setCats(c.data || []); setMaquiladores(p.data || []); setSites(s.data || []); setArts(a.data || [])
  }

  // ---------- PLANTILLAS ----------
  const descargarPlantillaArt = () => {
    const ej1 = ['RES-001', 'Resina PP natural', 'comprado', 'KG', 'Resina', 'no', '', '', '', '', '', 'no', '', 7, 100, 2, 50, '', '', '', 28, 'MXN', 16, 'no', '', '', '']
    const ej2 = ['PT-0001', 'Tapa frontal negra', 'fabricado', 'PZA', 'Inyección', '', 'solo_inyeccion', 20, 3, 50, 3, 'si', 15, '', '', '', 500, '', '', '', '', 'MXN', 16, 'no', '', '', '']
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([COLS_ART, ej1, ej2])
    ws['!cols'] = COLS_ART.map(() => ({ wch: 16 }))
    XLSX.utils.book_append_sheet(wb, ws, 'Articulos')
    const instr = [
      ['INSTRUCCIONES — Carga masiva de Articulos'],
      ['Obligatorios: codigo_interno, descripcion, origen, unidad_medida.'],
      ['origen', 'comprado / fabricado'],
      ['unidad_medida', UNIDADES.join(' / ')],
      ['tipo_proceso (solo fabricado)', TIPOS_PROCESO.join(' / ')],
      ['categoria (por nombre)', (cats.map(c => c.nombre).join(' / ')) || '(no hay categorias dadas de alta)'],
      ['maquilador (por nombre, solo si se_maquila=si)', (maquiladores.map(m => m.nombre).join(' / ')) || '(sin proveedores)'],
      ['site (por nombre, opcional)', (sites.map(s => s.nombre).join(' / ')) || '(sin sites)'],
      ['De que esta hecho un articulo', 'se captura en el BOM, no aqui. Es lo que el MRP explota para replicar la cantidad a los componentes.'],
      ['Campos si/no', 'es_consigna, admite_molido, se_maquila  ->  escribe si / no'],
      ['Pesos (peso_pieza_g, peso_colada_g, peso_purga_g)', 'en GRAMOS, solo para fabricados de inyeccion'],
      ['Comprado: llena lead_time_dias, moq, tiempo_transito_dias, costo, es_consigna.'],
      ['Fabricado: llena tipo_proceso, pesos, pct_scrap_aprobado, admite_molido, pct_molido_max.'],
    ]
    const wsi = XLSX.utils.aoa_to_sheet(instr); wsi['!cols'] = [{ wch: 45 }, { wch: 60 }]
    XLSX.utils.book_append_sheet(wb, wsi, 'Instrucciones')
    XLSX.writeFile(wb, 'plantilla_articulos.xlsx')
  }

  const descargarPlantillaBom = () => {
    const ej = ['PT-0001', 'RES-001', 'materia_prima', 0.023, 'KG']
    const ej2 = ['PT-0001', 'INS-001', 'componente', 1, 'PZA']
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([COLS_BOM, ej, ej2])
    ws['!cols'] = COLS_BOM.map(() => ({ wch: 18 }))
    XLSX.utils.book_append_sheet(wb, ws, 'BOM')
    const instr = [
      ['INSTRUCCIONES — Carga masiva de BOM'],
      ['articulo_padre', 'codigo del articulo fabricado (padre)'],
      ['componente', 'codigo del articulo componente/MP'],
      ['tipo_componente', 'materia_prima / componente / empaque / insumo'],
      ['cantidad_por_unidad', 'cantidad por pieza (en Kg ya incluye pieza+colada; o en pieza para ensamble)'],
      ['unidad_medida', 'KG / GR / PZA ...'],
      ['Nota', 'El padre y el componente deben existir ya en Articulos (cargalos primero).'],
    ]
    const wsi = XLSX.utils.aoa_to_sheet(instr); wsi['!cols'] = [{ wch: 22 }, { wch: 60 }]
    XLSX.utils.book_append_sheet(wb, wsi, 'Instrucciones')
    XLSX.writeFile(wb, 'plantilla_bom.xlsx')
  }

  // ---------- LECTURA + VALIDACION ----------
  const leer = (e, tipo) => {
    setError(''); setExito(''); setResultado(null); setFilas([])
    const f = e.target.files?.[0]; if (!f) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array' })
        const nombre = tipo === 'articulos' ? 'Articulos' : 'BOM'
        const ws = wb.Sheets[nombre] || wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
        if (tipo === 'articulos') validarArt(rows); else validarBom(rows)
      } catch (err) { setError('No se pudo leer el archivo: ' + err.message) }
    }
    reader.readAsArrayBuffer(f)
    e.target.value = ''
  }

  const catByName = (n) => cats.find(c => c.nombre.toLowerCase() === txt(n).toLowerCase())
  const maqByName = (n) => maquiladores.find(m => m.nombre.toLowerCase() === txt(n).toLowerCase())
  const siteByName = (n) => sites.find(s => s.nombre.toLowerCase() === txt(n).toLowerCase())
  const artByCode = (c) => arts.find(a => a.codigo_interno.toLowerCase() === txt(c).toLowerCase())

  const validarArt = (rows) => {
    const codigosArchivo = new Set()
    const out = rows.map((r, i) => {
      const err = []
      const cod = txt(r.codigo_interno)
      const desc = txt(r.descripcion)
      const origen = txt(r.origen).toLowerCase()
      const um = txt(r.unidad_medida).toUpperCase()
      if (!cod) err.push('codigo_interno vacio')
      if (!desc) err.push('descripcion vacia')
      if (!['comprado', 'fabricado'].includes(origen)) err.push('origen debe ser comprado o fabricado')
      if (!um) err.push('unidad_medida vacia')
      if (cod && codigosArchivo.has(cod.toLowerCase())) err.push('codigo repetido en el archivo')
      if (cod) codigosArchivo.add(cod.toLowerCase())
      if (cod && artByCode(cod)) err.push('el codigo ya existe en el sistema')
      const cat = r.categoria ? catByName(r.categoria) : null
      if (txt(r.categoria) && !cat) err.push(`categoria "${txt(r.categoria)}" no existe`)
      const esFab = origen === 'fabricado'
      let tp = txt(r.tipo_proceso)
      if (esFab && tp && !TIPOS_PROCESO.includes(tp)) err.push('tipo_proceso invalido')
      if (esFab && !tp) tp = 'solo_inyeccion'
      const seMaq = esFab && boolCel(r.se_maquila)
      const maq = seMaq && txt(r.maquilador) ? maqByName(r.maquilador) : null
      if (seMaq && txt(r.maquilador) && !maq) err.push(`maquilador "${txt(r.maquilador)}" no existe`)
      const site = txt(r.site) ? siteByName(r.site) : null
      if (txt(r.site) && !site) err.push(`site "${txt(r.site)}" no existe`)

      const payload = {
        empresa_id: emp, codigo_interno: cod, descripcion: desc, unidad_medida: um,
        categoria_id: cat?.id || null, origen: origen || 'comprado',
        tipo_moneda: txt(r.tipo_moneda).toUpperCase() || 'MXN',
        iva_porcentaje: numCel(r.iva_porcentaje) ?? 16, retencion_iva: 0,
        es_consigna: !esFab ? boolCel(r.es_consigna) : false,
        lead_time_dias: !esFab ? (numCel(r.lead_time_dias) ?? 0) : 0,
        moq: !esFab ? (numCel(r.moq) ?? 0) : 0,
        tiempo_transito_dias: !esFab ? (numCel(r.tiempo_transito_dias) ?? 0) : 0,
        stock_minimo: numCel(r.stock_minimo) ?? 0,
        snp: numCel(r.snp) ?? 0,
        dias_inventario_seguridad: numCel(r.dias_inventario_seguridad) ?? 0,
        multiplo_lote: numCel(r.multiplo_lote) ?? 0,
        costo: numCel(r.costo) ?? 0, costo_inicial: numCel(r.costo) ?? 0,
        tipo_proceso: esFab ? tp : null,
        peso_pieza_g: esFab ? numCel(r.peso_pieza_g) : null,
        peso_colada_g: esFab ? numCel(r.peso_colada_g) : null,
        peso_purga_g: esFab ? numCel(r.peso_purga_g) : null,
        pct_scrap_aprobado: esFab ? (numCel(r.pct_scrap_aprobado) ?? 0) : 0,
        admite_molido: esFab ? boolCel(r.admite_molido) : false,
        pct_molido_max: esFab && boolCel(r.admite_molido) ? (numCel(r.pct_molido_max) ?? 0) : 0,
        se_maquila: seMaq, maquilador_id: maq?.id || null,
        precio_maquila: seMaq ? numCel(r.precio_maquila) : null,
        site_id: site?.id || null,
      }
      return { n: i + 2, payload, errores: err, tipo: 'articulos', cod }
    })
    setFilas(out)
  }

  const validarBom = (rows) => {
    const out = rows.map((r, i) => {
      const err = []
      const padre = artByCode(r.articulo_padre)
      const comp = artByCode(r.componente)
      if (!txt(r.articulo_padre)) err.push('articulo_padre vacio')
      else if (!padre) err.push(`padre "${txt(r.articulo_padre)}" no existe`)
      if (!txt(r.componente)) err.push('componente vacio')
      else if (!comp) err.push(`componente "${txt(r.componente)}" no existe`)
      const cant = numCel(r.cantidad_por_unidad)
      if (cant == null || cant <= 0) err.push('cantidad_por_unidad invalida')
      const um = txt(r.unidad_medida).toUpperCase()
      if (!um) err.push('unidad_medida vacia')
      const payload = {
        articulo_padre_id: padre?.id || null, componente_articulo_id: comp?.id || null,
        tipo_componente: txt(r.tipo_componente) || 'componente',
        cantidad_por_unidad: cant, unidad_medida: um,
      }
      return { n: i + 2, payload, errores: err, tipo: 'bom', cod: `${txt(r.articulo_padre)} <- ${txt(r.componente)}` }
    })
    setFilas(out)
  }

  // ---------- CARGA ----------
  const cargarFilas = async () => {
    setError(''); setExito(''); setProc(true)
    const validas = filas.filter(f => f.errores.length === 0)
    let ok = 0; const fallos = []
    for (const f of validas) {
      const tabla = f.tipo === 'articulos' ? 'articulos' : 'bom'
      const { error: e } = await supabase.from(tabla).insert(f.payload)
      if (e) fallos.push({ n: f.n, cod: f.cod, msg: e.message.includes('unique') ? 'codigo duplicado' : e.message })
      else ok++
    }
    setResultado({ ok, fallos })
    setExito(`Se cargaron ${ok} registros${fallos.length ? `, ${fallos.length} con error` : ''}.`)
    setProc(false)
    await cargar()
  }

  const conError = filas.filter(f => f.errores.length > 0).length
  const validas = filas.length - conError

  return (
    <div style={S.c} className="aparecer">
      <h2 style={S.t}>Carga Masiva</h2>
      <div style={S.tabs}>
        {[['articulos', 'Articulos'], ['bom', 'BOM']].map(([id, n]) => (
          <button key={id} style={vista === id ? S.tabOn : S.tab} onClick={() => { setVista(id); setFilas([]); setError(''); setExito(''); setResultado(null) }}>{n}</button>
        ))}
      </div>
      {error && <p style={S.err}>{error}</p>}
      {exito && <p style={S.ok}>{exito}</p>}

      <div style={S.pasos}>
        <div style={S.paso}><b>1.</b> Descarga la plantilla y llenala.
          {vista === 'articulos'
            ? <button style={S.btnSec} onClick={descargarPlantillaArt}>Descargar plantilla de Articulos</button>
            : <button style={S.btnSec} onClick={descargarPlantillaBom}>Descargar plantilla de BOM</button>}
        </div>
        <div style={S.paso}><b>2.</b> Sube el archivo lleno (.xlsx).
          <label style={S.btn}>Subir archivo<input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => leer(e, vista)} /></label>
        </div>
      </div>

      {filas.length > 0 && (
        <>
          <p style={S.resumen}>{filas.length} filas · <b style={{ color: '#16a34a' }}>{validas} validas</b>{conError ? <span style={{ color: '#dc2626' }}> · {conError} con error</span> : ''}</p>
          <div style={S.tabla}>
            <div style={S.th}><span style={{ width: 50 }}>Fila</span><span style={{ flex: 1 }}>Registro</span><span style={{ flex: 2 }}>Validacion</span></div>
            {filas.slice(0, 300).map((f, i) => (
              <div key={i} style={S.tr}>
                <span style={{ width: 50, color: '#64748b' }}>{f.n}</span>
                <span style={{ flex: 1, fontWeight: 600 }}>{f.cod || '-'}</span>
                <span style={{ flex: 2 }}>{f.errores.length === 0 ? <span style={S.pillOk}>OK</span> : <span style={S.errTxt}>{f.errores.join(' · ')}</span>}</span>
              </div>
            ))}
          </div>
          {((vista === 'articulos' && puedeArt) || (vista === 'bom' && puedeBom)) && validas > 0 &&
            <div style={{ textAlign: 'right', marginTop: 12 }}><button style={S.btn} onClick={cargarFilas} disabled={proc}>{proc ? 'Cargando...' : `Cargar ${validas} validos`}</button></div>}
        </>
      )}

      {resultado && (
        <div style={S.result}>
          <p><b>Cargados:</b> {resultado.ok}</p>
          {resultado.fallos.length > 0 && <div><b style={{ color: '#dc2626' }}>Con error:</b>{resultado.fallos.map((x, i) => <div key={i} style={S.errTxt}>Fila {x.n} ({x.cod}): {x.msg}</div>)}</div>}
        </div>
      )}
    </div>
  )
}

const S = {
  c: { padding: '24px', maxWidth: 1000 },
  t: { fontSize: 18, fontWeight: 600, color: '#1a1a2e', margin: '0 0 12px' },
  tabs: { display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid #e2e8f0' },
  tab: { padding: '8px 18px', border: 'none', background: 'transparent', fontSize: 14, color: '#64748b', cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabOn: { padding: '8px 18px', border: 'none', background: 'transparent', fontSize: 14, color: '#059669', fontWeight: 600, cursor: 'pointer', borderBottom: '2px solid #059669' },
  pasos: { display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 },
  paso: { flex: 1, minWidth: 280, background: '#fff', border: '1px solid #eef2f7', borderRadius: 8, padding: 16, fontSize: 14, color: '#334155', display: 'flex', flexDirection: 'column', gap: 10 },
  resumen: { fontSize: 13, color: '#334155', margin: '4px 0 8px' },
  tabla: { background: '#fff', border: '1px solid #eef2f7', borderRadius: 8, overflow: 'hidden' },
  th: { display: 'flex', padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' },
  tr: { display: 'flex', padding: '9px 16px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: 13 },
  result: { marginTop: 14, background: '#fff', border: '1px solid #eef2f7', borderRadius: 8, padding: 16, fontSize: 13 },
  btn: { padding: '9px 18px', background: '#059669', color: '#fff', border: 'none', borderRadius: 7, fontSize: 14, fontWeight: 500, cursor: 'pointer', textAlign: 'center' },
  btnSec: { padding: '9px 14px', background: '#fff', color: '#059669', border: '1px solid #059669', borderRadius: 7, fontSize: 13, cursor: 'pointer' },
  pillOk: { padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: '#dcfce7', color: '#15803d' },
  errTxt: { color: '#dc2626', fontSize: 12 },
  err: { color: '#dc2626', fontSize: 13, marginBottom: 12 },
  ok: { color: '#16a34a', fontSize: 13, marginBottom: 12 },
}
