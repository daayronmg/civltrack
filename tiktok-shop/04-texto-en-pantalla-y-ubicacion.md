# TEXTO EN PANTALLA, UBICACIÓN Y DESCRIPCIÓN

Especificación de montaje para el concepto #1 sobre la pieza del vestido marrón.
Medidas sobre lienzo **1080 × 1920**.

---

## 1. MAPA DE UBICACIÓN

### Zonas muertas — nunca poner texto aquí

| Zona | Píxeles | Qué la ocupa |
|---|---|---|
| Superior | y 0 → 180 | Pestañas "Siguiendo / Para ti" y buscador |
| Derecha | x 880 → 1080, desde y 700 hacia abajo | Iconos: perfil, like, comentarios, compartir, sonido |
| Inferior | y 1450 → 1920 | Usuario, caption, disco de sonido **y la tarjeta del producto** |

La inferior es la que más se pasa por alto. La ficha del producto ocupa la
esquina inferior izquierda y tapa cualquier texto puesto ahí, justo en el
momento de mayor intención de compra.

### Zona útil

```
x: 60 → 860        y: 200 → 1400
```

**Punto dulce del hook: y 240 → 520.** Tercio superior, alineado a la izquierda
o centrado.

### Problema del encuadre actual

La cabeza ocupa de y≈380 a y≈900: quedan ~200 px de aire arriba, insuficiente
para un hook de dos líneas sin pisar la cara ni entrar en zona muerta.

**Corrección: bajar el sujeto un 12–15%**, cabeza arrancando hacia y≈560. Se
gana una repisa limpia entre y 220 y 520 sin perder nada de la prenda; sobra
suelo por abajo.

Alternativa sin reencuadre: hook sobre el espejo, arriba a la izquierda
(x 60–520, y 220–420). Funciona peor — compite con los grafitis del reflejo.

---

## 2. TEXTOS Y POSICIÓN POR SEGUNDO

| Seg | Texto | Posición | Tamaño |
|---|---|---|---|
| 0–2 | **"Hay algo aquí que no encaja."** | y 260, centrado, 2 líneas | 90–100 px |
| 2–3 | "no" | Sobre el peluche, pegado al objeto | 60 px |
| 3–4 | "tampoco" | Sobre los vasos rojos | 60 px |
| 4–5 | "no" | Sobre el retrete | 60 px |
| 5–7 | **"Es el vestido."** | y 340, centrado | 100 px |
| 7–9 | "Lo único limpio de esta habitación." | y 300, 2 líneas | 75 px |
| 9–11 | **"{PRECIO}"** | y 380, centrado, solo | 140 px |
| 11–12 | "Cesta naranja 👇" | y 1300 — no más abajo | 65 px |

Dos reglas de montaje:

- **Los "no" se colocan encima del objeto, no en el centro.** El texto hace de
  flecha: la mirada persigue la etiqueta y recorre el encuadre entero, que es
  el recorrido que interesa antes del reveal.
- **El precio va solo en pantalla.** Es el único momento del vídeo en el que
  no compite con nada.

---

## 3. TIPOGRAFÍA

Texto blanco liso sobre esta pared desaparece: hay grafiti rosa, rojo, verde y
blanco en el mismo rango tonal. Tres tratamientos válidos:

**A. Bloque sólido — recomendado.** Caja negra al 85% de opacidad, altura del
texto + 24 px de aire, ancho de línea. Legible siempre y el corte recto
contrasta con el caos del fondo.

**B. Contorno grueso.** Blanco con stroke negro de 8–10 px. Aguanta casi todo,
pierde sobre los grafitis blancos del espejo.

**C. Sombra dura.** Desplazamiento 6 px, sin difuminado, negro puro. La más
nativa de TikTok, la menos fiable sobre este fondo.

### Reglas cerradas
- Sans-serif condensada, peso Bold o Black. Nunca fuentes finas.
- Mayúsculas solo en hook y precio. Todo en mayúsculas se lee más lento.
- Máximo 2 líneas. Si hacen falta 3, el texto es malo.
- Interlineado 1,1.
- Alineación izquierda salvo el precio. Se lee más rápido que centrado.

---

## 4. DESCRIPCIÓN Y COMENTARIO FIJADO

### Caption
No describe el vídeo: remata la curiosidad y empuja al carrito. <100 caracteres.

**Principal:**
> Lo único limpio de esta habitación. Está en la cesta 🧡

**Para testear:**
> ¿Cuántas cosas has visto mal antes que el vestido?
>
> El sitio es un desastre. El vestido no.
>
> Mirad el fondo otra vez y decidme que no os habéis reído.
>
> Me lo puse para un sitio mejor y acabé aquí. Da igual.

Un emoji como mucho, y con función. Nada de cadenas decorativas.

### Comentario fijado — publicar en el primer minuto
Segundo CTA, y mata la objeción #1 antes de que la escriban:

> Talla M, mido 1,68 y me llega al tobillo. La abertura llega justo al muslo.
> Está abajo en la cesta naranja 🧡

Con el forro y el tallaje confirmados, sustituir por ese dato: convierte más.

### Hashtags
Tres o cuatro, no doce:
`#vestidos #vestidomarron #tiktokshop #invitadaperfecta`

---

## BLOQUEANTE

El precio. El tramo 9–11s es el momento de máxima conversión del vídeo y
ahora mismo es un hueco.
