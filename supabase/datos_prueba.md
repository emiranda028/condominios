# Datos de prueba (proyecto de Supabase)

Cuentas creadas para probar cada rol. Contraseña común: `prueba1234`. Los emails son del dominio reservado `.test`, no reciben correo.

| Email | Rol |
|---|---|
| admin@condominios.test | Administración de Rivadavia 4520 y Gorriti 5180 |
| lucia@condominios.test | Vecina, Rivadavia 4520 UF 7A |
| sofia@condominios.test | Vecina, Rivadavia 4520 UF 2C |
| martin@condominios.test | Vecino, Gorriti 5180 UF 3D |
| rossi@condominios.test | Vecino, Barrio Los Álamos Lote 14 |
| delta@condominios.test | Proveedor: plomería, electricidad, pintura, cerrajería (CABA) |
| electrica@condominios.test | Proveedor: electricidad (CABA, GBA Norte) |
| pinturerias@condominios.test | Proveedor: pintura (CABA) |
| fumigaciones@condominios.test | Proveedor: fumigación (GBA Norte) |
| mudanzas@condominios.test | Proveedor: mudanzas y fletes (CABA, GBA Norte) |

Incluye 18 reclamos (R-1001 a R-1018) en todos los estados, 16 presupuestos, historial, 4 compras en conjunto (C-501 a C-504) con ofertas, avisos y una invitación pendiente (carla@condominios.test).

Para borrar todo lo de prueba antes de salir a producción:

```sql
delete from reclamos where id between 1001 and 1018;
delete from compras where id between 501 and 504;
delete from invitaciones where email like '%@condominios.test';
delete from auth.users where email like '%@condominios.test';
```
