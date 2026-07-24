/**
 * IA simple de bots para Golpeado (servidor).
 * Roba del descarte si puede armar grupo; si no, del mazo.
 * Descarta la carta suelta de mayor valor.
 */

import { esGrupoValido, optimizarMano, VALUES } from './game.js';

function combinaciones(arr, k) {
    const out = [];
    function helper(start, combo) {
        if (combo.length === k) {
            out.push([...combo]);
            return;
        }
        for (let i = start; i < arr.length; i++) {
            combo.push(arr[i]);
            helper(i + 1, combo);
            combo.pop();
        }
    }
    helper(0, []);
    return out;
}

/**
 * Busca IDs de cartas de la mano que, con la carta del descarte, forman un grupo válido.
 */
export function encontrarComboDescarte(cartaDescarte, mano) {
    if (!cartaDescarte || !mano?.length) return null;
    const maxSz = Math.min(4, mano.length);
    for (let sz = 2; sz <= maxSz; sz++) {
        for (const combo of combinaciones(mano, sz)) {
            if (esGrupoValido([cartaDescarte, ...combo])) {
                return combo.map(c => c.id);
            }
        }
    }
    return null;
}

/**
 * Elige qué carta descartar (prioriza sueltas de mayor puntuación).
 */
export function elegirCartaDescarte(game, playerIndex) {
    const jugador = game.jugadores[playerIndex];
    if (!jugador?.mano?.length) return null;

    const opt = optimizarMano(jugador.mano, game.gruposEnMesa);
    const candidatas = opt.sueltas.length > 0 ? opt.sueltas : [...jugador.mano];
    candidatas.sort((a, b) => VALUES[b.value].points - VALUES[a.value].points);
    return candidatas[0].id;
}

/**
 * Ejecuta un turno completo de bot (robo + descarte).
 * @returns {boolean} true si actuó
 */
export function jugarTurnoBot(game, playerIndex) {
    if (!game || game.juegoTerminado) return false;
    if (!game.esTurnoDe(playerIndex)) return false;

    if (game.faseActual === 'ROBO') {
        const top = game.mazoDescarte.length > 0
            ? game.mazoDescarte[game.mazoDescarte.length - 1]
            : null;
        const mano = game.jugadores[playerIndex].mano;
        const comboIds = top ? encontrarComboDescarte(top, mano) : null;

        if (comboIds) {
            if (!game.robarDeDescarte(comboIds, playerIndex)) {
                game.robarDeMazo(playerIndex);
            }
        } else {
            game.robarDeMazo(playerIndex);
        }
        if (game.juegoTerminado) return true;
    }

    if (game.faseActual === 'DESCARTE' && !game.juegoTerminado) {
        const cartaId = elegirCartaDescarte(game, playerIndex);
        if (cartaId) game.descartarCarta(cartaId, playerIndex);
    }

    return true;
}
