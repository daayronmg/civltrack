# Privacidad y RGPD

GASGO se diseñó para necesitar el **mínimo** dato personal posible. No es una política de
privacidad legal (eso lo redacta un profesional antes de publicar en las tiendas); es la
descripción técnica de qué hace el sistema con los datos.

## Qué NO se recoge

- Correo electrónico, nombre, teléfono o cuenta de usuario. **No hay registro.**
- Identificadores publicitarios (IDFA / AAID).
- Historial de ubicaciones. **En ninguna tabla se guarda dónde ha estado el usuario.**
- Contactos, fotos, agenda ni ningún otro dato del dispositivo.

Verificado por un test automático (`services/api/test/security.test.ts`): el esquema solo
contiene coordenadas en `stations` (gasolineras) y en `price_alerts` (el punto que el propio
usuario elige para su alerta).

## Qué se recoge y por qué

| Dato | Base jurídica | Dónde vive | Cuánto dura |
|---|---|---|---|
| Ubicación puntual | Consentimiento (permiso del sistema) | Solo en memoria del móvil; viaja como parámetro de consulta | No se almacena |
| Token anónimo de dispositivo | Interés legítimo / ejecución del servicio | Llavero seguro del móvil; en el servidor solo su SHA-256 | Hasta que el usuario borra sus datos |
| Perfil de vehículo | Consentimiento | Móvil (y servidor si crea alertas) | Hasta borrado |
| Alertas y favoritos | Consentimiento | Servidor | Hasta borrado |
| Token de notificaciones push | **Consentimiento explícito y revocable** | Servidor | Se borra al retirar el consentimiento |

## Ubicación

- Se pide el permiso «mientras se usa la app» (*when in use*). Nunca «siempre».
- Se usa `Accuracy.Balanced`: suficiente para buscar gasolineras y mucho menos invasivo y
  costoso en batería que la precisión máxima.
- Las coordenadas viajan al backend como parámetros de una consulta que **no va asociada a
  ningún identificador de usuario**: `/v1/stations/nearby` es un endpoint público y anónimo.
- Los registros del servidor no guardan el cuerpo ni la query de las peticiones con coordenadas
  más allá de lo estrictamente operativo, y la cabecera `Authorization` está redactada en los
  logs (`redact` de pino).

## Derechos del usuario

Implementados en la app (Perfil → «Privacidad y tus datos»):

- **Acceso y portabilidad** (arts. 15 y 20): `GET /v1/devices/me/export` devuelve todo lo que el
  servidor guarda de ese dispositivo, en JSON.
- **Supresión** (art. 17): `DELETE /v1/devices/me` borra el dispositivo y, en cascada,
  vehículos, alertas, favoritos y entregas. El token deja de ser válido de inmediato.
- **Retirada del consentimiento** (art. 7.3): el interruptor de notificaciones borra el token
  push del servidor.

## Seguridad de los datos

- Tokens guardados solo como hash SHA-256 (nunca en claro).
- En el móvil, el token vive en Keychain/Keystore con `WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
- TLS obligatorio en producción; la base de datos no se expone fuera de la red interna.
- Sin claves secretas en la app: la única credencial del cliente es su propio token anónimo.

## Antes de publicar en las tiendas

Pendiente y necesario (no está hecho, ver `docs/06-estado-implementacion.md`):

1. Redactar la política de privacidad y los términos de uso, y alojarlos en una URL pública.
2. Rellenar la *App Privacy* de App Store y el *Data Safety* de Google Play declarando:
   ubicación aproximada/precisa, uso «funcionalidad de la app», **no vinculada a la identidad**
   y **no usada para seguimiento**.
3. Designar responsable del tratamiento y vía de contacto para ejercer derechos.
