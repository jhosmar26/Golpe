/**
 * Escenarios de prueba (lobby → botones).
 * Evitan jugar vs bot para ver Color, Póker, enchufes, etc.
 */
import { crearCarta } from './game.js';

/** @typedef {{ id: string, label: string, hint: string }} DebugScenarioMeta */

/** @type {DebugScenarioMeta[]} */
export const DEBUG_SCENARIOS = [
    {
        id: 'color',
        label: 'Probar Color',
        hint: 'Ganás con 7♥; queda 2♠ suelta; 0 puntos'
    },
    {
        id: 'poker',
        label: 'Probar Póker',
        hint: 'Ganás con 4 dieces; el resto en sueltas; 0 puntos'
    },
    {
        id: 'cero_mano',
        label: 'Probar Cero en mano',
        hint: 'Victoria inmediata: todo en grupos, 1 carta “descarte”'
    },
    {
        id: 'enchufes',
        label: 'Probar enchufes',
        hint: 'Bot Ana gana por cero expuesto; se ven Enchufe en la tabla'
    }
];

function resetFin(game) {
    game.juegoTerminado = false;
    game.ganadorId = null;
    game.tipoVictoria = null;
    game.jugadorEnEspera = null;
    game.turnosEsperaRestantes = 0;
    game.historial = [];
    game.mazoRecicladoUnaVez = false;
}

function manoIds(codes) {
    return codes.map(code => {
        const suit = code[0];
        const value = Number(code.slice(1));
        return crearCarta(suit, value);
    });
}

/**
 * Aplica un escenario sobre un GolpeadoGame ya inicializado (2+ jugadores).
 * @param {import('./game.js').GolpeadoGame} game
 * @param {string} scenarioId
 * @returns {{ ok: boolean, error?: string }}
 */
export function aplicarEscenarioDebug(game, scenarioId) {
    if (!game?.jugadores || game.jugadores.length < 2) {
        return { ok: false, error: 'Se necesitan al menos 2 jugadores.' };
    }

    resetFin(game);
    game.mazoDescarte = [];
    game.turnoActual = 0;
    game.faseActual = 'DESCARTE';

    const yo = game.jugadores[0];
    const rival = game.jugadores[1];
    yo.gruposExpuestos = [];
    rival.gruposExpuestos = [];
    yo.tuvoRoboDescarte = false;
    rival.tuvoRoboDescarte = false;

    switch (scenarioId) {
        case 'color': {
            yo.mano = manoIds(['H1', 'H3', 'H5', 'H7', 'H9', 'H11', 'H13', 'S2']);
            rival.mano = manoIds(['C2', 'D4', 'S6', 'H8', 'C9', 'D10', 'S11']);
            game.log('[Debug] Escenario Color cargado.');
            game.verificarVictoriaEspecial(yo);
            break;
        }
        case 'poker': {
            yo.mano = manoIds(['H10', 'D10', 'C10', 'S10', 'H2', 'D3', 'C4']);
            rival.mano = manoIds(['H5', 'D6', 'S7', 'C8', 'H9', 'D11', 'S12']);
            game.log('[Debug] Escenario Póker cargado.');
            game.verificarVictoriaEspecial(yo);
            break;
        }
        case 'cero_mano': {
            // 8 cartas: escalera 7 + trío no, better: 2 valid groups in 7 + 1 discard
            // A-2-3♥ + 4-5-6♥ leave 7♥? That's 7 cards color-ish as escalera
            // Classic: trio + escalera with one spare for CERO_MANO check
            // verificarVictoriaInmediata: opt puntos===0 && sueltas.length===1 with 8 cards
            yo.mano = manoIds(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'S13']);
            // 7♠ consecutive H1-7 is escalera of 7; S13 loose → 0 puntos and 1 suelta ✓
            rival.mano = manoIds(['C2', 'D4', 'S6', 'C8', 'D9', 'S11', 'C12']);
            yo.tuvoRoboDescarte = false;
            game.log('[Debug] Escenario Cero en mano cargado.');
            game.verificarVictoriaInmediata(yo);
            if (!game.juegoTerminado) {
                // Fallback explicito si la optimización no encuentra la escalera completa
                game.declararVictoria(yo.id, 'CERO_MANO');
            }
            break;
        }
        case 'enchufes': {
            // Réplica simplificada del informe: Ana gana CERO_EXPUESTO con 10♦ enchufado
            yo.mano = manoIds(['D12', 'C12', 'H12', 'D2', 'D6', 'D5', 'D1']);
            yo.gruposExpuestos = [];
            rival.mano = manoIds(['D10']);
            rival.gruposExpuestos = [
                manoIds(['C5', 'S5', 'H5']),
                manoIds(['D7', 'D8', 'D9'])
            ];
            rival.tuvoRoboDescarte = true;
            game.turnoActual = 0;
            game.faseActual = 'DESCARTE';
            game.mazoDescarte = manoIds(['H7']);
            game.log('[Debug] Escenario enchufes / cero expuesto cargado.');
            game.declararVictoria(rival.id, 'CERO_EXPUESTO');
            break;
        }
        default:
            return { ok: false, error: `Escenario desconocido: ${scenarioId}` };
    }

    if (!game.juegoTerminado) {
        return { ok: false, error: 'El escenario no cerró la partida como se esperaba.' };
    }

    return { ok: true };
}

export function listarIdsEscenarios() {
    return DEBUG_SCENARIOS.map(s => s.id);
}
