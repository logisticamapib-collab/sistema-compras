import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { veTodosLosSites } from '../lib/sites'

// Selector de site para los roles que ven todos (Direccion, Admin, Gte de Planta,
// Administrativo, Gte de Compras). Para el resto no se dibuja nada: su site es fijo.
export default function FiltroSite({ value, onChange, label = 'Site:', todos = 'Todos los sites' }) {
  const { perfil } = useAuth()
  const [sites, setSites] = useState([])
  const privilegiado = veTodosLosSites(perfil?.rol)

  useEffect(() => {
    if (!privilegiado || !perfil?.empresa_id) return
    supabase.from('sites').select('id, nombre, codigo').eq('empresa_id', perfil.empresa_id).order('nombre')
      .then(({ data }) => setSites(data || []))
  }, [privilegiado, perfil?.empresa_id])

  if (!privilegiado) return null
  return (
    <span style={st.wrap} className="no-imprimir">
      <label style={st.lbl}>{label}</label>
      <select style={st.sel} value={value ?? ''} onChange={e => onChange(e.target.value)}>
        <option value="">{todos}</option>
        {sites.map(s => <option key={s.id} value={s.id}>{s.codigo ? `${s.codigo} - ` : ''}{s.nombre}</option>)}
      </select>
    </span>
  )
}

const st = {
  wrap: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  lbl: { fontSize: 12, fontWeight: 500, color: '#444' },
  sel: { padding: '7px 10px', borderRadius: 7, border: '1px solid #ddd', fontSize: 13, outline: 'none', backgroundColor: '#fff' },
}
