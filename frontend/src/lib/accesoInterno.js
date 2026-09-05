// Cuentas internas: entrar sin correo.
//
// La gente de piso normalmente no tiene correo corporativo. Su identidad es un
// correo interno que nunca recibe nada -- 10432@interno.syntia -- y en el login
// solo teclean su numero de empleado; la aplicacion arma el resto.
//
// POR QUE EL DOMINIO ESTA AQUI Y NO EN LA BASE
//
// El login tiene que armar la identidad ANTES de iniciar sesion, y sin sesion
// ya no se puede leer ninguna tabla: a `anon` se le revocaron los permisos.
// Ponerlo en la base obligaria a volver a abrir una tabla al publico, que es
// exactamente lo que acabamos de cerrar.
//
// Es una constante y no configuracion por empresa porque cada empresa tiene su
// propio proyecto de Supabase: no hay forma de que dos numeros de empleado de
// empresas distintas choquen.
//
// Si esta constante cambia, hay que cambiarla TAMBIEN en la Edge Function
// crear-usuario, o las identidades que arme el servidor no van a coincidir con
// las que arme el login.
export const DOMINIO_INTERNO = 'interno.syntia'

// Lo que teclearon en el login -> la identidad con la que se autentica.
// Si trae arroba se respeta tal cual: es alguien con correo de verdad.
export function aIdentidad(loQueTecleo) {
  const v = String(loQueTecleo ?? '').trim()
  if (!v) return ''
  if (v.includes('@')) return v.toLowerCase()
  return `${v.toLowerCase()}@${DOMINIO_INTERNO}`
}

export const esIdentidadInterna = (email) =>
  String(email ?? '').toLowerCase().endsWith(`@${DOMINIO_INTERNO}`)

// Lo que se le ensena al administrador en las listas: a nadie le sirve ver
// 10432@interno.syntia.
export const comoSeVe = (u) =>
  u?.acceso_interno ? `No. ${u.numero_empleado || '?'}` : u?.email
