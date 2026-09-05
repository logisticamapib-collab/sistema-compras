import { createClient } from '@supabase/supabase-js'

// Un solo cliente, con la llave publica. No hay ni debe haber un cliente
// "admin" aqui: todo lo que exige la llave de servicio vive en una Edge
// Function, del lado del servidor. Antes existia un `supabaseAdmin` que en
// realidad usaba la misma llave publica -- el nombre mentia, y ese nombre es
// justo la invitacion a que alguien "arregle" el asunto pegandole la llave de
// servicio, que quedaria publicada dentro del JavaScript que descarga el
// navegador de cualquiera.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
