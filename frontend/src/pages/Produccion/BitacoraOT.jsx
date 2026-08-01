import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import FiltroSite from '../../components/FiltroSite'
import { siteEfectivo } from '../../lib/sites'
import { exportarExcel, imprimirTablaPDF } from '../../lib/exportar'

// Bitacora / historial de cambios de las OT: reprogramaciones, arrastres, inicios
// tarde, cierres (cortos o completos) y cancelaciones. Alimentada desde Ordenes de
// Trabajo y Programacion (tabla programa_cambios).

const TIPO = {
  creada: { l: 'Creada', c: '#2563eb' }, reprogramacion: { l: 'Reprogramacion', c: '#7c3aed' },
  arrastre: { l: 'Arrastre', c: '#0891b2' }, inicio: { l: 'Inicio', c: '#16a34a' },
  inicio_tarde: { l: 'Inicio tarde', c: '#dc2626' }, terminada: { l: 'Terminada', c: '#16a34a' },
  cierre: { l: 'Cierre', c: '#0e7490' }, cierre_corto: { l: 'Cierre corto', c: '#c2410c' },
  cancelada: { l: 'Cancelada', c: '#dc2626' },
}
const fFecha = (t) => t ? new Date(t).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '-'

export default function BitacoraOT() {
  const { perfil } = useAuth()
  const [rows, setRows] = useState([])
  const [ots, setOts] = useState([])
  const [loading, setLoading] = useState(true)
  const [fTipo, setFTipo] = useState('')
  const [fOT, setFOT] = useState('')
  const [fDesde, setFDesde] = useState('')
  const [fHasta, setFHasta] = useState('')
  const [site, setSite] = useState('')

  useEffect(() => { cargar() }, [site])
  const cargar = async () => {
    const sid = siteEfectivo(perfil, site)
    setLoading(true)
    const [c, o] = await Promise.all([
      supabase.from('programa_cambios').select('*').eq('empresa_id', perfil.empresa_id).order('at', { ascending: false }).limit(1000),
      (sid ? supabase.from('ordenes_trabajo').select('id, folio, site_id').eq('empresa_id', perfil.empresa_id).eq('site_id', sid) : supabase.from('ordenes_trabajo').select('id, folio, site_id').eq('empresa_id', perfil.empresa_id)),
    ])
    setRows(c.data || []); setOts(o.data || [])
    setLoading(false)
  }
  const folioDe = (id) => ots.find(o => o.id === id)?.folio || id

  const otIds = new Set(ots.map(o => o.id))
  const lista = rows
    .filter(r => !r.ot_id || otIds.has(r.ot_id))
    .filter(r => !fTipo || r.tipo === fTipo)
    .filter(r => !fOT || (folioDe(r.ot_id) || '').toLowerCase().includes(fOT.toLowerCase()))
    .filter(r => !fDesde || (r.at && r.at.slice(0, 10) >= fDesde))
    .filter(r => !fHasta || (r.at && r.at.slice(0, 10) <= fHasta))

  const cols = [
    { label: 'Fecha', get: r => fFecha(r.at) },
    { label: 'OT', get: r => folioDe(r.ot_id) },
    { label: 'Evento', get: r => TIPO[r.tipo]?.l || r.tipo || '-' },
    { label: 'Campo', get: r => r.campo || '-' },
    { label: 'Antes', get: r => r.antes || '-' },
    { label: 'Despues', get: r => r.despues || '-' },
    { label: 'Usuario', get: r => r.usuario_nombre || '-' },
  ]

  if (loading) return <p style={{ padding: 28, color: '#666' }}>Cargando...</p>

  return (
    <div style={S.c} className="aparecer">
      <div style={S.head}>
        <h2 style={S.t}>Bitacora / Historial de OT</h2>
        {lista.length > 0 && (
          <div style={{ display: 'flex', gap: 8 }} className="no-imprimir">
            <button style={S.btnSec} onClick={() => exportarExcel('bitacora_ot', cols, lista)}>Excel</button>
            <button style={S.btnSec} onClick={() => imprimirTablaPDF('Bitacora de OT', cols, lista)}>PDF</button>
          </div>
        )}
      </div>
      <div style={S.filtros} className="no-imprimir">
        <select style={S.input} value={fTipo} onChange={e => setFTipo(e.target.value)}>
          <option value="">Todos los eventos</option>
          {Object.entries(TIPO).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}
        </select>
        <input style={S.input} placeholder="Buscar OT (folio)" value={fOT} onChange={e => setFOT(e.target.value)} />
        <label style={S.lbl}>Del:</label><input type="date" style={S.input} value={fDesde} onChange={e => setFDesde(e.target.value)} />
        <label style={S.lbl}>Al:</label><input type="date" style={S.input} value={fHasta} onChange={e => setFHasta(e.target.value)} />
        <FiltroSite value={site} onChange={setSite} />
        <button style={S.btnSec} onClick={() => { setFTipo(''); setFOT(''); setFDesde(''); setFHasta('') }}>Limpiar</button>
        <span style={{ fontSize: 12, color: '#64748b', marginLeft: 'auto' }}>{lista.length} registro(s)</span>
      </div>
      <div style={S.tabla}>
        <div style={S.th}><span style={{ flex: 1.2 }}>Fecha</span><span style={{ flex: 1 }}>OT</span><span style={{ flex: 1.1 }}>Evento</span><span style={{ flex: 1 }}>Campo</span><span style={{ flex: 1.4 }}>Antes</span><span style={{ flex: 1.4 }}>Despues</span><span style={{ flex: 1.1 }}>Usuario</span></div>
        {lista.map(r => (
          <div key={r.id} style={S.tr}>
            <span style={{ flex: 1.2, color: '#64748b', fontSize: 12 }}>{fFecha(r.at)}</span>
            <span style={{ flex: 1, fontWeight: 600 }}>{folioDe(r.ot_id)}</span>
            <span style={{ flex: 1.1 }}><span style={{ ...S.pill, backgroundColor: (TIPO[r.tipo]?.c || '#64748b') + '22', color: TIPO[r.tipo]?.c || '#64748b' }}>{TIPO[r.tipo]?.l || r.tipo || '-'}</span></span>
            <span style={{ flex: 1, fontSize: 12, color: '#64748b' }}>{r.campo || '-'}</span>
            <span style={{ flex: 1.4, fontSize: 12 }}>{r.antes || '-'}</span>
            <span style={{ flex: 1.4, fontSize: 12 }}>{r.despues || '-'}</span>
            <span style={{ flex: 1.1, fontSize: 12, color: '#64748b' }}>{r.usuario_nombre || '-'}</span>
          </div>
        ))}
        {lista.length === 0 && <div style={S.vacio}>Sin registros con este filtro.</div>}
      </div>
    </div>
  )
}

const S = {
  c: { padding: 24 },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  t: { fontSize: 18, fontWeight: 600, color: '#1a1a2e', margin: 0 },
  filtros: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14, background: '#fff', borderRadius: 10, padding: '12px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  lbl: { fontSize: 12, color: '#444' },
  input: { padding: '8px 10px', borderRadius: 7, border: '1px solid #ddd', fontSize: 13, outline: 'none' },
  tabla: { background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  th: { display: 'flex', padding: '11px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' },
  tr: { display: 'flex', padding: '10px 16px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: 13 },
  vacio: { padding: '14px 16px', color: '#94a3b8', fontSize: 13 },
  pill: { padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700 },
  btnSec: { padding: '8px 14px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: 7, fontSize: 13, cursor: 'pointer' },
}
