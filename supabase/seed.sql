-- ============================================================
-- Condominios · datos iniciales
-- 1) Ejecutar este archivo después de schema.sql.
-- 2) Cada persona entra una vez a la app con su email (link mágico).
-- 3) Recién ahí, asignarle propiedad y rol con los insert de abajo.
-- ============================================================

insert into propiedades (id, nombre, tipo, zona) values
  ('11111111-1111-1111-1111-111111111111', 'Rivadavia 4520',    'Edificio · 24 UF',          'Caballito, CABA'),
  ('22222222-2222-2222-2222-222222222222', 'Gorriti 5180',      'Edificio · 40 UF',          'Palermo, CABA'),
  ('33333333-3333-3333-3333-333333333333', 'Barrio Los Álamos', 'Barrio cerrado · 62 lotes', 'Pilar');

-- Propietario: acceso a todas las propiedades
-- insert into membresias (usuario_id, propiedad_id, rol)
-- select u.id, p.id, 'propietario' from auth.users u cross join propiedades p
-- where u.email = 'propietario@ejemplo.com';

-- Administración de un edificio
-- insert into membresias (usuario_id, propiedad_id, rol)
-- select id, '11111111-1111-1111-1111-111111111111', 'administracion'
-- from auth.users where email = 'admin@ejemplo.com';

-- Vecino con su unidad
-- insert into membresias (usuario_id, propiedad_id, rol, unidad)
-- select id, '11111111-1111-1111-1111-111111111111', 'vecino', 'UF 7A'
-- from auth.users where email = 'vecino@ejemplo.com';

-- Nombre visible de una persona (por defecto toma lo que está antes de la @)
-- update perfiles set nombre = 'Lucía Fernández'
-- where id = (select id from auth.users where email = 'vecino@ejemplo.com');
