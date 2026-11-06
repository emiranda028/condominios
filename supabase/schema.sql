-- ============================================================
-- Condominios · esquema para Supabase
-- Ejecutar completo, una sola vez, en Supabase > SQL Editor.
-- Toda escritura pasa por funciones (RPC) que validan el rol
-- del usuario en la propiedad y dejan registro en el historial.
-- ============================================================

-- gen_random_uuid() viene incluido en Postgres 13+

create type rol_usuario    as enum ('vecino', 'administracion', 'propietario');
create type estado_reclamo as enum ('nuevo', 'presupuestando', 'aprobacion', 'en_curso', 'resuelto', 'desestimado');
create type estado_presup  as enum ('pendiente', 'aprobado', 'desestimado');
create type urgencia       as enum ('baja', 'media', 'alta');

-- ---------- Tablas ----------

create table perfiles (
  id        uuid primary key references auth.users(id) on delete cascade,
  nombre    text not null,
  creado_en timestamptz not null default now()
);

create table propiedades (
  id        uuid primary key default gen_random_uuid(),
  nombre    text not null,          -- "Rivadavia 4520"
  tipo      text,                   -- "Edificio · 24 UF"
  zona      text,                   -- "Caballito, CABA"
  region    text not null default 'CABA',   -- CABA | GBA Norte | GBA Oeste | GBA Sur | La Plata | Interior
  cotizacion_abierta boolean not null default true,  -- los reclamos nuevos se publican solos a proveedores
  creado_en timestamptz not null default now()
);

-- Un usuario tiene un rol por propiedad (un propietario puede tener varias)
create table membresias (
  usuario_id   uuid not null references perfiles(id) on delete cascade,
  propiedad_id uuid not null references propiedades(id) on delete cascade,
  rol          rol_usuario not null,
  unidad       text,                -- "UF 7A" / "Lote 14" para vecinos
  primary key (usuario_id, propiedad_id)
);

create table rubros (
  nombre          text primary key,
  requiere_presup boolean not null default true,  -- false: se gestiona con notas (convivencia)
  orden           int not null default 0
);

create sequence reclamo_seq start 1001;

create table reclamos (
  id             bigint primary key default nextval('reclamo_seq'),  -- se muestra R-1001
  propiedad_id   uuid not null references propiedades(id) on delete cascade,
  ubicacion      text not null,     -- "UF 7A", "Hall PB", "Lote 14"
  rubro          text not null references rubros(nombre),
  titulo         text not null,
  descripcion    text,
  urgencia       urgencia not null default 'media',
  estado         estado_reclamo not null default 'nuevo',
  motivo         text,              -- motivo de desestimación
  autor_id       uuid references perfiles(id) on delete set null,
  autor_nombre   text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index on reclamos (propiedad_id, estado);

-- Oferentes inscriptos (cerrajeros, pintores, fumigadores, mudanzas...)
create table proveedores (
  id           uuid primary key references perfiles(id) on delete cascade,
  razon_social text not null,
  cuit         text,
  telefono     text not null,
  matricula    text,                 -- gasistas / electricistas matriculados
  zonas        text[] not null default '{CABA}',
  descripcion  text,
  activo       boolean not null default true,
  creado_en    timestamptz not null default now()
);

create table proveedor_rubros (
  proveedor_id uuid not null references proveedores(id) on delete cascade,
  rubro        text not null references rubros(nombre),
  primary key (proveedor_id, rubro)
);

-- Avisos en el momento para proveedores (pedido nuevo, presupuesto aprobado...)
create table avisos (
  id           bigserial primary key,
  usuario_id   uuid not null references perfiles(id) on delete cascade,
  texto        text not null,
  reclamo_id   bigint references reclamos(id) on delete cascade,
  compra_id    bigint,
  leido        boolean not null default false,
  creado_en    timestamptz not null default now()
);
create index on avisos (usuario_id, leido);

create table presupuestos (
  id           uuid primary key default gen_random_uuid(),
  reclamo_id   bigint not null references reclamos(id) on delete cascade,
  proveedor_id uuid references proveedores(id) on delete set null,   -- null = cargado a mano por la administración
  contacto     text,
  proveedor    text not null,
  monto        numeric(14,2) not null check (monto > 0),
  plazo_dias   int check (plazo_dias > 0),
  detalle      text,
  estado       estado_presup not null default 'pendiente',
  motivo       text,
  cargado_por  uuid references perfiles(id) on delete set null,
  decidido_por uuid references perfiles(id) on delete set null,
  decidido_en  timestamptz,
  creado_en    timestamptz not null default now()
);
create index on presupuestos (reclamo_id);
create unique index una_cotizacion_por_proveedor on presupuestos (reclamo_id, proveedor_id)
  where proveedor_id is not null and estado <> 'desestimado';

-- Compras en conjunto entre vecinos (pintura, membranas, fumigación por manzana...)
create sequence compra_seq start 501;

create table compras (
  id             bigint primary key default nextval('compra_seq'),
  creador_id     uuid references perfiles(id) on delete set null,
  region         text not null,
  rubro          text not null references rubros(nombre),
  producto       text not null,      -- "Látex interior blanco 20 L"
  unidad         text not null,      -- "lata", "m²", "servicio"
  detalle        text,
  cierre         date not null,
  estado         text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
  creado_en      timestamptz not null default now()
);

create table compra_participantes (
  compra_id  bigint not null references compras(id) on delete cascade,
  usuario_id uuid not null references perfiles(id) on delete cascade,
  cantidad   numeric(10,2) not null check (cantidad > 0),
  zona       text,                   -- se muestra "Caballito", nunca el nombre
  primary key (compra_id, usuario_id)
);

create table compra_ofertas (
  id               uuid primary key default gen_random_uuid(),
  compra_id        bigint not null references compras(id) on delete cascade,
  proveedor_id     uuid not null references proveedores(id) on delete cascade,
  proveedor_nombre text not null,
  escalas          jsonb not null,   -- [{"desde":1,"precio":98000},{"desde":10,"precio":84000}]
  detalle          text,
  creado_en        timestamptz not null default now(),
  unique (compra_id, proveedor_id)
);

create table eventos (
  id           bigserial primary key,
  reclamo_id   bigint not null references reclamos(id) on delete cascade,
  usuario_id   uuid references perfiles(id) on delete set null,
  autor_nombre text,
  texto        text not null,
  creado_en    timestamptz not null default now()
);
create index on eventos (reclamo_id);

insert into rubros (nombre, requiere_presup, orden) values
  ('Plomería', true, 1), ('Electricidad', true, 2), ('Gas', true, 3), ('Ascensores', true, 4),
  ('Pintura', true, 5), ('Humedad y filtraciones', true, 6), ('Cerrajería', true, 7),
  ('Fumigación y plagas', true, 8), ('Albañilería', true, 9), ('Herrería', true, 10),
  ('Vidriería', true, 11), ('Aire acondicionado', true, 12), ('Jardinería', true, 13),
  ('Mudanzas y fletes', true, 14), ('Limpieza', true, 15), ('Seguridad y accesos', true, 16),
  ('Espacios comunes', true, 17), ('Ruidos y convivencia', false, 18), ('Otro', true, 19);

-- ---------- Ayudantes ----------

create or replace function mi_rol(p uuid) returns rol_usuario
language sql stable security definer set search_path = public as $$
  select rol from membresias where usuario_id = auth.uid() and propiedad_id = p
$$;

create or replace function mi_nombre() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select nombre from perfiles where id = auth.uid()), 'Usuario')
$$;

create or replace function pesos(n numeric) returns text
language sql immutable set search_path = public as $$
  select '$ ' || replace(to_char(n, 'FM999,999,999,990'), ',', '.')
$$;

create or replace function _log(p_reclamo bigint, p_texto text) returns void
language sql security definer set search_path = public as $$
  insert into eventos (reclamo_id, usuario_id, autor_nombre, texto)
  values (p_reclamo, auth.uid(), mi_nombre(), p_texto);
  update reclamos set actualizado_en = now() where id = p_reclamo;
$$;

-- Bloquea el reclamo y verifica que el usuario tenga uno de los roles pedidos
create or replace function _exigir(p_reclamo bigint, p_roles rol_usuario[]) returns reclamos
language plpgsql security definer set search_path = public as $$
declare r reclamos; v rol_usuario;
begin
  select * into r from reclamos where id = p_reclamo for update;
  if not found then raise exception 'El reclamo R-% no existe', p_reclamo; end if;
  v := mi_rol(r.propiedad_id);
  if v is null or not (v = any(p_roles)) then
    raise exception 'Tu rol en esta propiedad no permite esta acción';
  end if;
  return r;
end $$;

-- Avisa a los proveedores activos del rubro y la región del reclamo. Devuelve cuántos.
create or replace function _avisar_proveedores(p_reclamo bigint) returns int
language plpgsql security definer set search_path = public as $$
declare r reclamos; v_region text; n int;
begin
  select * into r from reclamos where id = p_reclamo;
  select region into v_region from propiedades where id = r.propiedad_id;
  insert into avisos (usuario_id, reclamo_id, texto)
  select pv.id, r.id, format('Nuevo pedido de %s en %s: %s', r.rubro, v_region, r.titulo)
    from proveedores pv join proveedor_rubros pr on pr.proveedor_id = pv.id
   where pv.activo and pr.rubro = r.rubro and v_region = any(pv.zonas);
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function _avisar_proveedores(bigint) from public, anon, authenticated;
revoke execute on function _log(bigint, text) from public, anon, authenticated;
revoke execute on function _exigir(bigint, rol_usuario[]) from public, anon, authenticated;

-- Perfil automático al registrarse
create or replace function crear_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into perfiles (id, nombre)
  values (new.id, coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

revoke execute on function crear_perfil() from public, anon, authenticated;

create trigger al_registrarse after insert on auth.users
  for each row execute function crear_perfil();

-- ---------- Seguridad por fila (solo lectura; escribir = RPC) ----------

alter table perfiles     enable row level security;
alter table propiedades  enable row level security;
alter table membresias   enable row level security;
alter table rubros       enable row level security;
alter table reclamos     enable row level security;
alter table presupuestos enable row level security;
alter table eventos      enable row level security;

create policy "perfil propio"           on perfiles     for select using (id = auth.uid());
create policy "editar perfil propio"    on perfiles     for update using (id = auth.uid());
create policy "mis propiedades"         on propiedades  for select using (mi_rol(id) is not null);
create policy "mis membresias"          on membresias   for select using (usuario_id = auth.uid());
create policy "rubros"                  on rubros       for select to authenticated using (true);
create policy "reclamos de mis props"   on reclamos     for select using (mi_rol(propiedad_id) is not null);
create policy "presupuestos de mis props" on presupuestos for select using (
  exists (select 1 from reclamos r where r.id = reclamo_id and mi_rol(r.propiedad_id) is not null));
create policy "historial de mis props"  on eventos      for select using (
  exists (select 1 from reclamos r where r.id = reclamo_id and mi_rol(r.propiedad_id) is not null));

-- ---------- Acciones ----------

create or replace function crear_reclamo(
  p_propiedad uuid, p_ubicacion text, p_rubro text, p_titulo text,
  p_descripcion text default null, p_urgencia urgencia default 'media'
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_abierta boolean; v_presup boolean; n int;
begin
  if mi_rol(p_propiedad) is null then raise exception 'No pertenecés a esta propiedad'; end if;
  select cotizacion_abierta into v_abierta from propiedades where id = p_propiedad;
  select requiere_presup into v_presup from rubros where nombre = p_rubro;
  if v_presup is null then raise exception 'Rubro desconocido: %', p_rubro; end if;
  if coalesce(trim(p_ubicacion), '') = '' or coalesce(trim(p_titulo), '') = '' then
    raise exception 'Completá la unidad y el título del reclamo';
  end if;
  insert into reclamos (propiedad_id, ubicacion, rubro, titulo, descripcion, urgencia, autor_id, autor_nombre)
  values (p_propiedad, trim(p_ubicacion), p_rubro, trim(p_titulo), nullif(trim(p_descripcion), ''),
          p_urgencia, auth.uid(), mi_nombre())
  returning id into v_id;
  perform _log(v_id, 'Cargó el reclamo.');
  if v_presup and v_abierta then
    update reclamos set estado = 'presupuestando' where id = v_id;
    n := _avisar_proveedores(v_id);
    perform _log(v_id, format('Se publicó para cotizar: %s proveedor(es) de %s recibieron el aviso.', n, p_rubro));
  end if;
  return v_id;
end $$;

create or replace function pedir_presupuestos(p_reclamo bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r reclamos; n int;
begin
  r := _exigir(p_reclamo, array['administracion']::rol_usuario[]);
  if r.estado <> 'nuevo' then raise exception 'El reclamo ya no está en estado nuevo'; end if;
  update reclamos set estado = 'presupuestando' where id = p_reclamo;
  n := _avisar_proveedores(p_reclamo);
  perform _log(p_reclamo, format('Pidió presupuestos: %s proveedor(es) inscriptos recibieron el aviso.', n));
end $$;

create or replace function cargar_presupuesto(
  p_reclamo bigint, p_proveedor text, p_monto numeric,
  p_plazo int default null, p_detalle text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare r reclamos; v_id uuid;
begin
  r := _exigir(p_reclamo, array['administracion']::rol_usuario[]);
  if r.estado not in ('nuevo', 'presupuestando', 'aprobacion') then
    raise exception 'No se pueden cargar presupuestos en un reclamo %', r.estado;
  end if;
  if exists (select 1 from rubros where nombre = r.rubro and not requiere_presup) then
    raise exception 'Los reclamos de % no llevan presupuesto', r.rubro;
  end if;
  insert into presupuestos (reclamo_id, proveedor, monto, plazo_dias, detalle, cargado_por)
  values (p_reclamo, trim(p_proveedor), p_monto, p_plazo, nullif(trim(p_detalle), ''), auth.uid())
  returning id into v_id;
  update reclamos set estado = 'aprobacion' where id = p_reclamo;
  perform _log(p_reclamo, format('Cargó presupuesto de %s por %s.', trim(p_proveedor), pesos(p_monto)));
  return v_id;
end $$;

create or replace function aprobar_presupuesto(p_presupuesto uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p presupuestos; r reclamos;
begin
  select * into p from presupuestos where id = p_presupuesto;
  if not found then raise exception 'El presupuesto no existe'; end if;
  r := _exigir(p.reclamo_id, array['propietario']::rol_usuario[]);
  if p.estado <> 'pendiente' then raise exception 'Este presupuesto ya fue decidido'; end if;
  update presupuestos set estado = 'aprobado', decidido_por = auth.uid(), decidido_en = now() where id = p.id;
  update presupuestos set estado = 'desestimado', motivo = 'Se aprobó otra opción.',
         decidido_por = auth.uid(), decidido_en = now()
   where reclamo_id = p.reclamo_id and id <> p.id and estado = 'pendiente';
  update reclamos set estado = 'en_curso' where id = p.reclamo_id;
  perform _log(p.reclamo_id, format('Aprobó presupuesto de %s por %s.', p.proveedor, pesos(p.monto)));
  if p.proveedor_id is not null then
    insert into avisos (usuario_id, reclamo_id, texto)
    values (p.proveedor_id, p.reclamo_id, format('Aprobaron tu presupuesto para R-%s (%s). Ya podés coordinar el trabajo.', r.id, r.titulo));
  end if;
  insert into avisos (usuario_id, reclamo_id, texto)
  select proveedor_id, p.reclamo_id, format('El pedido R-%s se adjudicó a otro proveedor.', r.id)
    from presupuestos where reclamo_id = p.reclamo_id and id <> p.id and proveedor_id is not null
     and motivo = 'Se aprobó otra opción.';
end $$;

create or replace function desestimar_presupuesto(p_presupuesto uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare p presupuestos; r reclamos;
begin
  select * into p from presupuestos where id = p_presupuesto;
  if not found then raise exception 'El presupuesto no existe'; end if;
  r := _exigir(p.reclamo_id, array['propietario']::rol_usuario[]);
  if p.estado <> 'pendiente' then raise exception 'Este presupuesto ya fue decidido'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo'; end if;
  update presupuestos set estado = 'desestimado', motivo = trim(p_motivo),
         decidido_por = auth.uid(), decidido_en = now() where id = p.id;
  if not exists (select 1 from presupuestos where reclamo_id = p.reclamo_id and estado = 'pendiente') then
    update reclamos set estado = 'presupuestando' where id = p.reclamo_id;
  end if;
  perform _log(p.reclamo_id, format('Desestimó presupuesto de %s: %s', p.proveedor, trim(p_motivo)));
end $$;

create or replace function desestimar_reclamo(p_reclamo bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare r reclamos;
begin
  r := _exigir(p_reclamo, array['administracion', 'propietario']::rol_usuario[]);
  if r.estado in ('resuelto', 'desestimado') then raise exception 'El reclamo ya está cerrado'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo'; end if;
  update reclamos set estado = 'desestimado', motivo = trim(p_motivo) where id = p_reclamo;
  update presupuestos set estado = 'desestimado', motivo = 'Reclamo desestimado.'
   where reclamo_id = p_reclamo and estado = 'pendiente';
  perform _log(p_reclamo, 'Desestimó: ' || trim(p_motivo));
end $$;

create or replace function resolver_reclamo(p_reclamo bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r reclamos;
begin
  r := _exigir(p_reclamo, array['administracion']::rol_usuario[]);
  if r.estado <> 'en_curso' then raise exception 'Solo se resuelven reclamos en curso'; end if;
  update reclamos set estado = 'resuelto' where id = p_reclamo;
  perform _log(p_reclamo, 'Marcó el reclamo como resuelto.');
end $$;

create or replace function reabrir_reclamo(p_reclamo bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r reclamos;
begin
  r := _exigir(p_reclamo, array['administracion', 'propietario']::rol_usuario[]);
  if r.estado not in ('resuelto', 'desestimado') then raise exception 'El reclamo sigue abierto'; end if;
  update reclamos
     set estado = case when exists (select 1 from presupuestos where reclamo_id = p_reclamo and estado = 'aprobado')
                       then 'en_curso'::estado_reclamo else 'nuevo'::estado_reclamo end,
         motivo = null
   where id = p_reclamo;
  perform _log(p_reclamo, 'Reabrió el reclamo.');
end $$;

create or replace function enviar_nota(p_reclamo bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r reclamos;
begin
  r := _exigir(p_reclamo, array['administracion']::rol_usuario[]);
  if r.estado in ('resuelto', 'desestimado') then raise exception 'El reclamo ya está cerrado'; end if;
  update reclamos set estado = 'en_curso' where id = p_reclamo;
  perform _log(p_reclamo, format('Envió nota formal a %s recordando el reglamento de copropiedad.', r.ubicacion));
end $$;

create or replace function comentar(p_reclamo bigint, p_texto text) returns void
language plpgsql security definer set search_path = public as $$
declare r reclamos;
begin
  r := _exigir(p_reclamo, array['vecino', 'administracion', 'propietario']::rol_usuario[]);
  if coalesce(trim(p_texto), '') = '' then raise exception 'El comentario está vacío'; end if;
  perform _log(p_reclamo, trim(p_texto));
end $$;

-- ============================================================
-- Proveedores: inscripción, pedidos para cotizar y cotización
-- ============================================================

create or replace function registrar_proveedor(
  p_razon_social text, p_telefono text, p_rubros text[], p_zonas text[],
  p_cuit text default null, p_matricula text default null, p_descripcion text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Iniciá sesión para inscribirte'; end if;
  if coalesce(trim(p_razon_social), '') = '' or coalesce(trim(p_telefono), '') = '' then
    raise exception 'Completá nombre comercial y teléfono';
  end if;
  if coalesce(array_length(p_rubros, 1), 0) = 0 then raise exception 'Elegí al menos un rubro'; end if;
  if coalesce(array_length(p_zonas, 1), 0) = 0 then raise exception 'Elegí al menos una zona'; end if;
  insert into proveedores (id, razon_social, telefono, zonas, cuit, matricula, descripcion)
  values (auth.uid(), trim(p_razon_social), trim(p_telefono), p_zonas,
          nullif(trim(p_cuit), ''), nullif(trim(p_matricula), ''), nullif(trim(p_descripcion), ''))
  on conflict (id) do update set razon_social = excluded.razon_social, telefono = excluded.telefono,
     zonas = excluded.zonas, cuit = excluded.cuit, matricula = excluded.matricula,
     descripcion = excluded.descripcion, activo = true;
  delete from proveedor_rubros where proveedor_id = auth.uid();
  insert into proveedor_rubros (proveedor_id, rubro) select auth.uid(), unnest(p_rubros);
end $$;

-- Pedidos abiertos de mis rubros y zonas + los que ya cotizé. Sin datos de vecinos.
create or replace function oportunidades()
returns table (
  id bigint, rubro text, titulo text, descripcion text, urgencia urgencia, estado estado_reclamo,
  zona text, region text, tipo text, creado_en timestamptz, cotizaciones int,
  mi_id uuid, mi_monto numeric, mi_plazo int, mi_detalle text, mi_estado estado_presup, mi_motivo text,
  direccion text
)
language sql stable security definer set search_path = public as $$
  with yo as (select * from proveedores where proveedores.id = auth.uid() and activo)
  select r.id, r.rubro, r.titulo, r.descripcion, r.urgencia, r.estado,
         p.zona, p.region, p.tipo, r.creado_en,
         (select count(*)::int from presupuestos x where x.reclamo_id = r.id and x.estado <> 'desestimado'),
         q.id, q.monto, q.plazo_dias, q.detalle, q.estado, q.motivo,
         case when q.estado = 'aprobado' then p.nombre || ' · ' || r.ubicacion end
    from reclamos r
    join propiedades p on p.id = r.propiedad_id
    left join lateral (select * from presupuestos x
                        where x.reclamo_id = r.id and x.proveedor_id = auth.uid()
                        order by x.creado_en desc limit 1) q on true
   where exists (select 1 from yo)
     and (q.id is not null
          or (r.estado in ('presupuestando', 'aprobacion')
              and exists (select 1 from proveedor_rubros pr where pr.proveedor_id = auth.uid() and pr.rubro = r.rubro)
              and p.region = any (coalesce((select zonas from yo limit 1), '{}'::text[]))))
   order by r.creado_en desc
$$;

create or replace function cotizar(p_reclamo bigint, p_monto numeric, p_plazo int default null, p_detalle text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare pv proveedores; r reclamos; v_region text; v_id uuid;
begin
  select * into pv from proveedores where id = auth.uid() and activo;
  if not found then raise exception 'Inscribite como proveedor para cotizar'; end if;
  select * into r from reclamos where id = p_reclamo for update;
  if not found then raise exception 'El pedido no existe'; end if;
  if r.estado not in ('presupuestando', 'aprobacion') then raise exception 'Este pedido ya no recibe cotizaciones'; end if;
  if not exists (select 1 from proveedor_rubros where proveedor_id = pv.id and rubro = r.rubro) then
    raise exception 'No estás inscripto en %', r.rubro;
  end if;
  select region into v_region from propiedades where id = r.propiedad_id;
  if not (v_region = any(pv.zonas)) then raise exception 'Este pedido está fuera de tus zonas'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'Indicá un monto válido'; end if;
  begin
    insert into presupuestos (reclamo_id, proveedor_id, contacto, proveedor, monto, plazo_dias, detalle, cargado_por)
    values (r.id, pv.id, pv.telefono, pv.razon_social, p_monto, p_plazo, nullif(trim(p_detalle), ''), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Ya cotizaste este pedido';
  end;
  update reclamos set estado = 'aprobacion' where id = r.id;
  perform _log(r.id, format('%s cotizó %s desde la plataforma.', pv.razon_social, pesos(p_monto)));
  return v_id;
end $$;

create or replace function marcar_avisos_leidos() returns void
language sql security definer set search_path = public as $$
  update avisos set leido = true where usuario_id = auth.uid() and not leido
$$;

-- ============================================================
-- Compras en conjunto
-- ============================================================

alter table compras add column actualizado_en timestamptz not null default now();

create or replace function crear_compra(
  p_rubro text, p_producto text, p_unidad text, p_cantidad numeric, p_cierre date,
  p_region text, p_zona text default null, p_detalle text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if auth.uid() is null then raise exception 'Iniciá sesión para crear una compra'; end if;
  if coalesce(trim(p_producto), '') = '' or coalesce(trim(p_unidad), '') = '' then raise exception 'Completá producto y unidad'; end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'Indicá cuántas unidades querés'; end if;
  if p_cierre < current_date then raise exception 'La fecha de cierre ya pasó'; end if;
  insert into compras (creador_id, region, rubro, producto, unidad, detalle, cierre)
  values (auth.uid(), p_region, p_rubro, trim(p_producto), trim(p_unidad), nullif(trim(p_detalle), ''), p_cierre)
  returning id into v_id;
  insert into compra_participantes (compra_id, usuario_id, cantidad, zona) values (v_id, auth.uid(), p_cantidad, p_zona);
  insert into avisos (usuario_id, compra_id, texto)
  select pv.id, v_id, format('Compra en conjunto en %s: %s. Publicá tus precios por cantidad.', p_region, trim(p_producto))
    from proveedores pv join proveedor_rubros pr on pr.proveedor_id = pv.id
   where pv.activo and pr.rubro = p_rubro and p_region = any(pv.zonas);
  return v_id;
end $$;

-- p_cantidad = 0 para salir de la compra
create or replace function sumarse_compra(p_compra bigint, p_cantidad numeric, p_zona text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c compras;
begin
  if auth.uid() is null then raise exception 'Iniciá sesión para sumarte'; end if;
  select * into c from compras where id = p_compra for update;
  if not found then raise exception 'La compra no existe'; end if;
  if c.estado <> 'abierta' or c.cierre < current_date then raise exception 'Esta compra ya cerró'; end if;
  if coalesce(p_cantidad, 0) <= 0 then
    delete from compra_participantes where compra_id = p_compra and usuario_id = auth.uid();
  else
    insert into compra_participantes (compra_id, usuario_id, cantidad, zona) values (p_compra, auth.uid(), p_cantidad, p_zona)
    on conflict (compra_id, usuario_id) do update set cantidad = excluded.cantidad, zona = coalesce(excluded.zona, compra_participantes.zona);
  end if;
  update compras set actualizado_en = now() where id = p_compra;
end $$;

create or replace function ofertar_compra(p_compra bigint, p_escalas jsonb, p_detalle text default null) returns void
language plpgsql security definer set search_path = public as $$
declare pv proveedores; c compras;
begin
  select * into pv from proveedores where id = auth.uid() and activo;
  if not found then raise exception 'Inscribite como proveedor para ofertar'; end if;
  select * into c from compras where id = p_compra for update;
  if not found or c.estado <> 'abierta' then raise exception 'Esta compra no recibe ofertas'; end if;
  if not exists (select 1 from proveedor_rubros where proveedor_id = pv.id and rubro = c.rubro) then
    raise exception 'No estás inscripto en %', c.rubro;
  end if;
  if jsonb_typeof(p_escalas) <> 'array' or jsonb_array_length(p_escalas) = 0
     or exists (select 1 from jsonb_array_elements(p_escalas) e
                 where (e->>'desde')::numeric < 1 or (e->>'precio')::numeric <= 0) then
    raise exception 'Revisá las escalas: cada una necesita cantidad desde 1 y precio mayor a 0';
  end if;
  insert into compra_ofertas (compra_id, proveedor_id, proveedor_nombre, escalas, detalle)
  values (p_compra, pv.id, pv.razon_social || ' · ' || pv.telefono, p_escalas, nullif(trim(p_detalle), ''))
  on conflict (compra_id, proveedor_id) do update set escalas = excluded.escalas, detalle = excluded.detalle, creado_en = now();
  update compras set actualizado_en = now() where id = p_compra;
end $$;

create or replace function cerrar_compra(p_compra bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  update compras set estado = 'cerrada', actualizado_en = now()
   where id = p_compra and creador_id = auth.uid() and estado = 'abierta';
  if not found then raise exception 'Solo quien creó la compra puede cerrarla'; end if;
end $$;

-- Resumen público de compras: totales y barrios, nunca nombres
create or replace function compras_resumen()
returns table (
  id bigint, region text, rubro text, producto text, unidad text, detalle text, cierre date, estado text,
  creado_en timestamptz, participantes int, total numeric, zonas text[], mi_cantidad numeric, soy_creador boolean
)
language sql stable security definer set search_path = public as $$
  select c.id, c.region, c.rubro, c.producto, c.unidad, c.detalle, c.cierre, c.estado, c.creado_en,
         (select count(*)::int from compra_participantes x where x.compra_id = c.id),
         (select coalesce(sum(cantidad), 0) from compra_participantes x where x.compra_id = c.id),
         (select array_agg(distinct x.zona) filter (where x.zona is not null) from compra_participantes x where x.compra_id = c.id),
         (select cantidad from compra_participantes x where x.compra_id = c.id and x.usuario_id = auth.uid()),
         c.creador_id = auth.uid()
    from compras c
   where auth.uid() is not null
   order by c.estado, c.cierre
$$;

-- ---------- Seguridad de las tablas nuevas ----------

alter table proveedores          enable row level security;
alter table proveedor_rubros     enable row level security;
alter table avisos               enable row level security;
alter table compras              enable row level security;
alter table compra_participantes enable row level security;
alter table compra_ofertas       enable row level security;

create policy "mi ficha de proveedor" on proveedores          for select using (id = auth.uid());
create policy "mis rubros"            on proveedor_rubros     for select using (proveedor_id = auth.uid());
create policy "mis avisos"            on avisos               for select using (usuario_id = auth.uid());
create policy "compras visibles"      on compras              for select to authenticated using (true);
create policy "mi participacion"      on compra_participantes for select using (usuario_id = auth.uid());
create policy "ofertas visibles"      on compra_ofertas       for select to authenticated using (true);

-- Cambios en vivo
alter publication supabase_realtime add table eventos, avisos, compras, compra_ofertas;

-- ---------- Permisos: solo usuarios con sesión llaman a las funciones ----------
revoke execute on all functions in schema public from public, anon;
alter default privileges in schema public revoke execute on functions from public, anon;

grant execute on function
  mi_rol(uuid), mi_nombre(), pesos(numeric),
  crear_reclamo(uuid, text, text, text, text, urgencia), pedir_presupuestos(bigint),
  cargar_presupuesto(bigint, text, numeric, int, text), aprobar_presupuesto(uuid),
  desestimar_presupuesto(uuid, text), desestimar_reclamo(bigint, text), resolver_reclamo(bigint),
  reabrir_reclamo(bigint), enviar_nota(bigint), comentar(bigint, text),
  registrar_proveedor(text, text, text[], text[], text, text, text), oportunidades(),
  cotizar(bigint, numeric, int, text), marcar_avisos_leidos(),
  crear_compra(text, text, text, numeric, date, text, text, text), sumarse_compra(bigint, numeric, text),
  ofertar_compra(bigint, jsonb, text), cerrar_compra(bigint), compras_resumen()
to authenticated;

revoke execute on function _log(bigint, text), _exigir(bigint, rol_usuario[]), _avisar_proveedores(bigint), crear_perfil() from authenticated;

-- ============================================================
-- Mercado Libre: productos más usados por rubro
-- (la función supabase/functions/mercadolibre consulta la API y llena la caché)
-- ============================================================
create table rubro_busquedas (
  rubro    text not null references rubros(nombre) on delete cascade,
  busqueda text not null,
  orden    int not null default 0,
  primary key (rubro, busqueda)
);
create table productos_ml (
  busqueda    text primary key,
  items       jsonb not null default '[]',
  actualizado timestamptz not null default now()
);
create table ml_tokens (
  id            int primary key default 1 check (id = 1),
  ml_user_id    bigint,
  access_token  text not null,
  refresh_token text not null,
  expira        timestamptz not null,
  actualizado   timestamptz not null default now()
);
alter table rubro_busquedas enable row level security;
alter table productos_ml    enable row level security;
alter table ml_tokens       enable row level security;
create policy "busquedas visibles" on rubro_busquedas for select to authenticated using (true);
create policy "productos visibles" on productos_ml    for select to authenticated using (true);
revoke all on ml_tokens from anon, authenticated;
-- Las búsquedas iniciales por rubro están en la migración "mercadolibre_productos" y en app.js (BUSQUEDAS).

-- Credenciales de la app de Mercado Libre (alternativa a los secretos de la función)
create table ml_config (
  id            int primary key default 1 check (id = 1),
  client_id     text not null,
  client_secret text,
  actualizado   timestamptz not null default now()
);
alter table ml_config enable row level security;
revoke all on ml_config from anon, authenticated;
