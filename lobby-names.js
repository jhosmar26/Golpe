/**
 * Nombres únicos en el lobby (sin distinguir mayúsculas / espacios extra).
 */

export function claveNombre(nombre) {
    return String(nombre || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function nombreYaUsadoEnSala(players, nombre) {
    const clave = claveNombre(nombre);
    if (!clave) return false;
    return (players || []).some(p => claveNombre(p.nombre) === clave);
}

/** Alternativas libres (p. ej. Ana → Ana2, Ana3, Ana Jr). */
export function sugerirNombresAlternativos(players, nombreBase, cantidad = 3) {
    const usados = new Set((players || []).map(p => claveNombre(p.nombre)));
    const base = String(nombreBase || '').trim().replace(/\s+/g, ' ') || 'Jugador';
    const sugerencias = [];
    const candidatos = [];

    for (let i = 2; i <= 30; i++) candidatos.push(`${base}${i}`);
    for (const suf of [' Jr', ' Pro', ' X', ' Plus']) candidatos.push(`${base}${suf}`);
    for (let i = 1; i <= 20; i++) candidatos.push(`Jugador ${i}`);

    for (const cand of candidatos) {
        const clave = claveNombre(cand);
        if (!clave || usados.has(clave)) continue;
        sugerencias.push(cand);
        usados.add(clave);
        if (sugerencias.length >= cantidad) break;
    }
    return sugerencias;
}

export function normalizarNombreJugador(nombre, fallback) {
    const limpio = String(nombre || '').trim().replace(/\s+/g, ' ');
    return limpio || fallback;
}
