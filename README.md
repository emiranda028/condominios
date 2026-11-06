# Condominios

Plataforma que conecta a **vecinos, administración, propietarios y proveedores** de edificios y barrios:

- **Reclamos**: plomería, electricidad, gas, ascensores, pintura, humedad, cerrajería, fumigación, mudanzas, ruidos y convivencia, etc. Cada reclamo tiene seguimiento completo.
- **Cotización en el momento**: los proveedores se inscriben por rubro y zona. Cuando alguien carga un reclamo, los proveedores del rubro reciben un aviso al instante y cotizan desde la app. Ninguno ve los precios de los demás.
- **Aprobación del propietario**: el propietario compara, aprueba un presupuesto o lo desestima con motivo. El proveedor que gana recibe el aviso y la dirección del trabajo.
- **Compras en conjunto**: un vecino propone una compra (pintura, membrana, fumigación por casa, flete compartido). Otros vecinos de la zona se suman aunque no se conozcan, los proveedores publican precios por cantidad y el precio por unidad baja a medida que se suma gente. Solo se muestra el barrio de cada participante, nunca el nombre.

## Roles

| Rol | Qué hace |
|---|---|
| Vecino | Carga reclamos, comenta, propone y se suma a compras en conjunto |
| Administración | Publica reclamos para cotizar, carga presupuestos propios, envía notas de convivencia, marca trabajos resueltos |
| Propietario | Ve todas sus propiedades, aprueba o desestima presupuestos y reclamos |
| Proveedor | Se inscribe por rubros y zonas, recibe avisos, cotiza reclamos y oferta precios por volumen en compras |

Circuito de un reclamo: `nuevo → presupuestando (publicado) → aprobacion → en_curso → resuelto`, o `desestimado` en cualquier punto. Si la propiedad tiene la cotización abierta (opción por defecto), el reclamo se publica a los proveedores apenas se carga.

## Estructura

```
index.html          Interfaz
styles.css          Estilos
app.js              Lógica: capa demo (navegador) y capa Supabase con la misma interfaz
config.js           URL y anon key de Supabase. Vacío = modo demo
supabase/schema.sql Tablas, seguridad por fila, funciones (RPC) y tiempo real
supabase/seed.sql   Propiedades de ejemplo y cómo asignar roles
```

Sin build ni dependencias: es un sitio estático. Se puede servir con GitHub Pages, Netlify o Vercel.

## Probar en modo demo

Abrí `index.html?demo` en el navegador (o `npx serve .` y entrá a `/?demo`). En modo demo arranca con datos de ejemplo y un selector **Ver como** para recorrer los cuatro roles.

## Supabase

Proyecto de producción: `fggqqrbldsdtumyqehny` (región São Paulo), ya configurado en `config.js`. Para montar otro desde cero:

1. Crear un proyecto en [supabase.com](https://supabase.com).
2. En **SQL Editor**, ejecutar `supabase/schema.sql` y después `supabase/seed.sql`.
3. En **Authentication > URL Configuration**, poner como Site URL la dirección donde se publica la app.
4. Copiar **Project URL** y **anon public key** (Settings > API) en `config.js`.
5. Cada persona entra con su email (link mágico). Los proveedores se inscriben solos desde la app. A vecinos, administración y propietarios se les asigna propiedad y rol con los `insert` comentados en `seed.sql`.

### Seguridad

- Las tablas son de solo lectura para el cliente. Toda escritura pasa por funciones `security definer` que validan el rol del usuario en esa propiedad y registran el evento.
- Cada usuario ve solo las propiedades donde tiene rol. Los proveedores no ven las tablas de reclamos: reciben por `oportunidades()` solo rubro, descripción, zona y tipo de propiedad. La dirección exacta les llega recién cuando les aprueban el presupuesto.
- En compras en conjunto, `compras_resumen()` devuelve totales y barrios, nunca quién participa.

## Próximos pasos

- Fotos en reclamos y PDF en presupuestos (Supabase Storage).
- Avisos por WhatsApp o mail además del aviso en la app.
- Invitación de vecinos por link o QR en el hall del edificio.
- Calificación de proveedores después de cada trabajo.
- Panel del propietario: gasto aprobado por propiedad y rubro, y tiempos de resolución.
