// Catalogo unico de roles del sistema. Lo usan Usuarios, Permisos por Rol y los
// filtros del flujo de aprobacion, para que no se desincronicen entre pantallas.
//
// OJO: el rol define PERMISOS por modulo. La posicion en el flujo de aprobacion
// (quien aprueba la requisicion de quien) se define con el campo gerente_id del
// usuario, no con el nombre del rol: cualquier rol gerencial puede ser el jefe
// que aprueba. 'gerente_area' se conserva como rol generico heredado.

export const ROLES = [
  { value: 'solicitante', label: 'Solicitante' },
  { value: 'gerente_area', label: 'Gerente de Area (generico)' },
  { value: 'gerente_planta', label: 'Gerente de Planta' },
  { value: 'gerente_administrativo', label: 'Gerente Administrativo' },
  { value: 'gerente_logistica', label: 'Gerente de Logistica' },
  { value: 'gerente_produccion', label: 'Gerente de Produccion' },
  { value: 'gerente_calidad', label: 'Gerente de Calidad' },
  { value: 'gerente_ingenieria', label: 'Gerente de Ingenieria' },
  { value: 'gerente_compras', label: 'Gerente de Compras' },
  { value: 'compras', label: 'Compras' },
  { value: 'ingeniero_nuevos_proyectos', label: 'Ingeniero de Nuevos Proyectos' },
  { value: 'calidad', label: 'Calidad' },
  { value: 'sgc', label: 'SGC (Sistema de Gestion de Calidad)' },
  { value: 'customer_service', label: 'Customer Service' },
  { value: 'direccion', label: 'Direccion / Director' },
  { value: 'admin', label: 'Administrador' },
]

// Roles que pueden fungir como jefe/aprobador de area en el flujo de compras.
export const ROLES_GERENCIALES = [
  'gerente_area', 'gerente_planta', 'gerente_administrativo', 'gerente_logistica',
  'gerente_produccion', 'gerente_calidad', 'gerente_ingenieria', 'gerente_compras',
  'direccion', 'admin',
]

export const etiquetaRol = (valor) => ROLES.find(r => r.value === valor)?.label || valor
