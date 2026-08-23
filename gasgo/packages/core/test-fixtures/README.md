# Fixtures de test

⚠️ **Estos ficheros NO son precios reales y NUNCA llegan a la aplicación ni a la base de
datos.** Existen solo para probar el *parser* frente a la ESTRUCTURA documentada de la API
oficial (nombres de claves, coma decimal, campos vacíos, tildes).

Los precios que verá un usuario de GASGO proceden exclusivamente de una llamada real a la API
del Ministerio ejecutada por el ingestor. Si la ingesta no se ha ejecutado, la API responde
`hasData: false` y la app muestra «sin datos de la fuente oficial».
