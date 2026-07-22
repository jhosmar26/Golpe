# Golpeado — Multijugador en tiempo real

Juego de cartas multijugador con salas por código de 4 dígitos.

**Guía rápida (local):** [COMO-EMPEZAR.md](./COMO-EMPEZAR.md)

## Jugar en internet

Cuando el proyecto esté desplegado, abre el enlace público en el navegador (PC o móvil). No hace falta instalar nada.

1. Un jugador crea una sala y comparte el código.
2. El otro se une con ese código.
3. El anfitrión inicia la partida.

## Desarrollo local

```bash
pnpm install
pnpm start
```

Abre http://localhost:3080

Este proyecto usa **pnpm** (no npm).

## Arquitectura

| Capa | Archivo | Rol |
|------|---------|-----|
| Game State | `game.js` + `server.js` | Reglas y turnos en el servidor |
| UI | `ui.js` + `index.css` | Pantalla y acciones del jugador |

Reordenar cartas es local a cada jugador (no refresca a los demás).
