# Cómo empezar — Golpeado

## 1. Instalar una sola vez

1. Instala **Node.js** LTS: https://nodejs.org/
2. Abre una terminal en la carpeta del proyecto.
3. Si no tienes **pnpm**, descárgalo (Windows):
   - Crea la carpeta `%LOCALAPPDATA%\pnpm`
   - Descarga `pnpm-win-x64.exe` desde https://github.com/pnpm/pnpm/releases  
     y guárdalo ahí como `pnpm.exe`
   - Añade esa carpeta al PATH de Windows (o usa la ruta completa al exe).
4. Instala dependencias:

```bash
pnpm install
```

> No uses `npm install`. Este proyecto usa **pnpm**.

## 2. Lanzar el juego

```bash
pnpm start
```

En Windows también puedes ejecutar: `.\run.ps1`

## 3. Abrir y jugar

1. En el navegador entra a: **http://localhost:3080**
2. Un jugador pulsa **Crear sala** y comparte el código de 4 dígitos.
3. Los demás ponen el código y pulsan **Unirse a sala**.
4. El anfitrión pulsa **Comenzar partida** (mínimo 2 jugadores).

Para jugar desde otro dispositivo en la misma Wi‑Fi, usa la IP de tu PC, por ejemplo: `http://192.168.1.20:3080`

## Parar el servidor

En la terminal: `Ctrl + C`
