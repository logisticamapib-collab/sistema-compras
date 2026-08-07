import { supabase } from './supabase'

// Catalogo de roles del sistema.
//
// El rol define PERMISOS por modulo. Tres cosas que se confundian y aqui viven
// separadas a proposito:
//
//   PUESTO    -> quien eres (Jefe de Moldes, Lider, Coordinador). Catalogo
//                aparte, dato de RH, no da ni quita permisos.
//   ROL       -> que puedes ver y hacer. Pocos y por FUNCION, no por nivel:
//                un Lider y un Coordinador de Produccion necesitan lo mismo.
//   JERARQUIA -> quien aprueba a quien. Vive en usuarios.gerente_id.
//
// Los roles ya no estan escritos aqui: viven en la tabla `roles` para que se
// puedan agregar desde la pantalla sin tocar codigo. Los arreglos de abajo son
// un respaldo por si la carga falla, y se RELLENAN EN SITIO al cargar (no se
// reasignan) para que las pantallas que ya los importaron sigan viendo lo
// mismo sin volverse asincronas.

export const ROLES = [
  { value: 'solicitante', label: 'Solicitante' },
  { value: 'admin', label: 'Administrador' },
]

// Roles que pueden fungir como jefe que aprueba en el flujo de compras.
export const ROLES_GERENCIALES = ['admin']

// Roles cuya requisicion se va directo a compras sin pasar por firma.
export const ROLES_OMITEN_APROBACION = ['admin']

// Fila completa por clave, para consultar banderas sin otra ida a la base.
const _porClave = new Map()

export const rolInfo = (clave) => _porClave.get(clave) || null
export const esGerencial = (clave) => !!_porClave.get(clave)?.es_gerencial
export const omiteAprobacion = (clave) => !!_porClave.get(clave)?.omite_aprobacion
export const etiquetaRol = (valor) => ROLES.find(r => r.value === valor)?.label || valor

let _cargado = false

// Se llama una vez al iniciar sesion. Rellena los arreglos en sitio.
export async function cargarRoles(forzar = false) {
  if (_cargado && !forzar) return ROLES
  const { data, error } = await supabase
    .from('roles').select('*').eq('activo', true).order('orden')
  if (error || !data || data.length === 0) {
    // Se deja el respaldo: es preferible entrar con menos opciones que no
    // poder entrar, pero se avisa en consola para que no pase inadvertido.
    console.warn('No se pudieron cargar los roles del catalogo; se usa el respaldo.', error)
    return ROLES
  }

  ROLES.length = 0
  ROLES_GERENCIALES.length = 0
  ROLES_OMITEN_APROBACION.length = 0
  _porClave.clear()

  for (const r of data) {
    ROLES.push({ value: r.clave, label: r.nombre, descripcion: r.descripcion, nivel: r.nivel })
    if (r.es_gerencial) ROLES_GERENCIALES.push(r.clave)
    if (r.omite_aprobacion) ROLES_OMITEN_APROBACION.push(r.clave)
    _porClave.set(r.clave, r)
  }
  _cargado = true
  return ROLES
}
