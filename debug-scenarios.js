/**
 * Escenarios de prueba (lobby → engranaje).
 * Incluye partidas resueltas y el formulario «Custom».
 */
import { crearCarta, SUITS, VALUES, esGrupoValido } from './game.js';

/** @typedef {{ id: string, label: string, hint: string, opensForm?: boolean }} DebugScenarioMeta */

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
    },
    {
        id: 'custom',
        label: 'Custom',
        hint: 'Armá manos, mesa, descarte y mazo a mano',
        opensForm: true
    }
];

const BARAJA_SIZE = Object.keys(SUITS).length * Object.keys(VALUES).length;

function resetFin(game) {
    game.juegoTerminado = false;
    game.ganadorId = null;
    game.tipoVictoria = null;
    game.jugadorEnEspera = null;
    game.turnosEsperaRestantes = 0;
    game.historial = [];
    game.mazoRecicladoUnaVez = false;
    game.permitirVictoriaColor = true;
    game.permitirVictoriaPoker = true;
}

/** Normaliza "H1", "h1", "H-1" → carta */
export function parseCodigoCarta(raw) {
    const s = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!s) return null;
    const suit = s[0];
    const value = Number(s.slice(1));
    if (!SUITS[suit] || !VALUES[value]) {
        throw new Error(`Carta inválida: ${raw}`);
    }
    return crearCarta(suit, value);
}

/**
 * Slot parcial o completo: "H1", "H?", "?12", "H", "12".
 * @returns {{ suit: string|null, value: number|null }}
 */
export function parseSlotCodigo(raw) {
    const s = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9?]/g, '');
    if (!s) return null;

    // Solo valor: "12" / "?12"
    if (/^\??\d{1,2}$/.test(s)) {
        const value = Number(s.replace('?', ''));
        if (!VALUES[value]) throw new Error(`Valor inválido: ${raw}`);
        return { suit: null, value };
    }

    const suit = s[0];
    const rest = s.slice(1);

    if (suit !== '?' && !SUITS[suit]) {
        throw new Error(`Palo inválido: ${raw}`);
    }

    // Solo palo: "H" / "H?"
    if (!rest || rest === '?') {
        if (suit === '?') return { suit: null, value: null };
        return { suit, value: null };
    }

    const value = Number(rest);
    if (!VALUES[value]) throw new Error(`Carta inválida: ${raw}`);
    if (suit === '?') return { suit: null, value };
    return { suit, value };
}

/** "H1, D12 H3" o multilínea → cartas (solo códigos completos) */
export function parseListaCartas(texto) {
    const raw = String(texto || '').trim();
    if (!raw) return [];
    const parts = raw.split(/[\s,;|]+/).filter(Boolean);
    return parts.map(parseCodigoCarta);
}

/** "H1 H? ?12 H" → slots (permite comodines) */
export function parseListaSlots(texto) {
    const raw = String(texto || '').trim();
    if (!raw) return [];
    return raw.split(/[\s,;|]+/).filter(Boolean).map(parseSlotCodigo).filter(Boolean);
}

/**
 * Grupos: separados por `;` o salto de línea.
 * Dentro del grupo, cartas por coma/espacio: `C5,S5,H5 ; D7 D8 D9`
 */
export function parseGrupos(texto) {
    const raw = String(texto || '').trim();
    if (!raw) return [];
    return raw.split(/[;\n]+/).map(chunk => chunk.trim()).filter(Boolean).map(chunk => {
        const cartas = parseListaCartas(chunk);
        if (cartas.length < 3) {
            throw new Error(`Grupo inválido (mín. 3 cartas): ${chunk}`);
        }
        return cartas;
    });
}

function barajar(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function todaLaBaraja() {
    const out = [];
    for (const suit of Object.keys(SUITS)) {
        for (const valKey of Object.keys(VALUES)) {
            out.push(crearCarta(suit, Number(valKey)));
        }
    }
    return out;
}

function manoIds(codes) {
    return codes.map(code => {
        const suit = code[0];
        const value = Number(code.slice(1));
        return crearCarta(suit, value);
    });
}

/**
 * Convierte texto "H1 D12" o slots [{suit,value}] en slots normalizados.
 * value/suit null = comodín (aleatorio con esa restricción).
 */
export function normalizarSlotsMano(configSlots, textoFallback = '') {
    if (Array.isArray(configSlots) && configSlots.length) {
        return configSlots.map((s) => ({
            suit: s?.suit && s.suit !== '?' ? String(s.suit).toUpperCase() : null,
            value: s?.value != null && s.value !== '?' && s.value !== ''
                ? Number(s.value)
                : null
        }));
    }
    return parseListaSlots(textoFallback);
}

function tomarCartaPorSlot(slot, used, pool) {
    const suit = slot.suit;
    const value = slot.value;

    if (suit && value != null) {
        if (!SUITS[suit] || !VALUES[value]) {
            throw new Error(`Carta inválida en slot: ${suit}${value}`);
        }
        const id = `${suit}${value}`;
        if (used.has(id)) {
            throw new Error(`Carta repetida: ${id}`);
        }
        used.add(id);
        return crearCarta(suit, value);
    }

    const match = pool.find(c =>
        !used.has(c.id)
        && (!suit || c.suit === suit)
        && (value == null || c.value === value)
    );
    if (!match) {
        const desc = `${suit || '?'}${value != null ? value : '?'}`;
        throw new Error(`No hay carta libre que cumpla ${desc}.`);
    }
    used.add(match.id);
    return match;
}

function resolverSlots(slots, used, pool) {
    return slots.map(slot => tomarCartaPorSlot(slot, used, pool));
}

/**
 * Detecta grupos válidos (o intencionados) en slots de la UI.
 * - Mismo valor ×3 / ×4 → trío / póker (palo puede ser “?”, pero no repetir palo concreto)
 * - Mismo palo + valores consecutivos ×3+ → escalera
 * @param {{ suit: string|null, value: number|null }[]} slots
 * @returns {{ indices: number[], key: string, tipo: string }[]}
 */
export function detectarGruposEnSlots(slots) {
    const n = slots.length;
    const used = new Set();
    const groups = [];

    const takeIndices = (idxs, tipo, key) => {
        const clean = idxs.filter(i => !used.has(i));
        if (clean.length < 3) return false;
        for (const i of clean) used.add(i);
        groups.push({ indices: clean, tipo, key });
        return true;
    };

    /** Elige hasta `need` índices con palos concretos distintos (o palo libre). */
    const pickDistinctSuits = (idxs, need) => {
        const chosen = [];
        const usedSuits = new Set();
        const withSuit = idxs.filter(i => slots[i]?.suit);
        const withoutSuit = idxs.filter(i => !slots[i]?.suit);
        for (const i of withSuit) {
            const s = slots[i].suit;
            if (usedSuits.has(s)) continue;
            usedSuits.add(s);
            chosen.push(i);
            if (chosen.length >= need) return chosen;
        }
        for (const i of withoutSuit) {
            chosen.push(i);
            if (chosen.length >= need) return chosen;
        }
        return chosen.length >= need ? chosen : [];
    };

    // Sets por valor (póker preferido sobre trío)
    /** @type {Map<number, number[]>} */
    const byValue = new Map();
    for (let i = 0; i < n; i++) {
        const v = slots[i]?.value;
        if (v == null || Number.isNaN(Number(v))) continue;
        const list = byValue.get(v) || [];
        list.push(i);
        byValue.set(v, list);
    }
    for (const [value, idxs] of byValue) {
        const free = idxs.filter(i => !used.has(i));
        if (free.length >= 4) {
            const pick = pickDistinctSuits(free, 4);
            if (pick.length >= 4) takeIndices(pick.slice(0, 4), 'poker', `set:${value}:4`);
        }
        const free2 = idxs.filter(i => !used.has(i));
        if (free2.length >= 3) {
            const pick = pickDistinctSuits(free2, 3);
            if (pick.length >= 3) takeIndices(pick.slice(0, 3), 'trio', `set:${value}:3`);
        }
    }

    // Escaleras por palo (valores concretos + mismo palo)
    /** @type {Map<string, { i: number, v: number }[]>} */
    const bySuit = new Map();
    for (let i = 0; i < n; i++) {
        if (used.has(i)) continue;
        const suit = slots[i]?.suit;
        const v = slots[i]?.value;
        if (!suit || v == null) continue;
        const list = bySuit.get(suit) || [];
        list.push({ i, v: Number(v) });
        bySuit.set(suit, list);
    }
    for (const [suit, cards] of bySuit) {
        const avail = cards.filter(c => !used.has(c.i)).sort((a, b) => a.v - b.v);
        const uniq = [];
        const seenVal = new Set();
        for (const c of avail) {
            if (seenVal.has(c.v)) continue;
            seenVal.add(c.v);
            uniq.push(c);
        }
        let run = [];
        const flushRun = () => {
            if (run.length >= 3) {
                takeIndices(
                    run.map(c => c.i),
                    'escalera',
                    `run:${suit}:${run.map(c => c.v).join('-')}`
                );
            }
            run = [];
        };
        for (const c of uniq) {
            if (!run.length || c.v === run[run.length - 1].v + 1) {
                run.push(c);
            } else {
                flushRun();
                run = [c];
            }
        }
        flushRun();

        // A-alto: Q-K-A
        const hasA = uniq.find(c => c.v === 1 && !used.has(c.i));
        const hasQ = uniq.find(c => c.v === 12 && !used.has(c.i));
        const hasK = uniq.find(c => c.v === 13 && !used.has(c.i));
        if (hasA && hasQ && hasK) {
            takeIndices([hasQ.i, hasK.i, hasA.i], 'escalera', `run:${suit}:12-13-1`);
        }
    }

    // Fallback: subconjuntos totalmente definidos con esGrupoValido
    const freeFull = [];
    for (let i = 0; i < n; i++) {
        if (used.has(i)) continue;
        const s = slots[i];
        if (!s?.suit || s.value == null) continue;
        freeFull.push({ i, card: crearCarta(s.suit, Number(s.value)) });
    }
    for (let size = Math.min(4, freeFull.length); size >= 3; size--) {
        const pick = (start, chosen) => {
            if (chosen.length === size) {
                if (!esGrupoValido(chosen.map(x => x.card))) return;
                const idxs = chosen.map(x => x.i);
                if (idxs.some(i => used.has(i))) return;
                takeIndices(idxs, 'grupo', `full:${idxs.slice().sort((a, b) => a - b).join(',')}`);
                return;
            }
            for (let i = start; i < freeFull.length; i++) {
                if (used.has(freeFull[i].i)) continue;
                pick(i + 1, [...chosen, freeFull[i]]);
            }
        };
        pick(0, []);
    }

    return groups;
}

/**
 * Clave estable para recordar Mano/Mesa en la UI.
 * @param {{ suit: string|null, value: number|null }[]} slots
 * @param {number[]} indices
 * @param {string} tipo
 */
export function claveGrupoSlots(slots, indices, tipo) {
    const parts = indices.map(i => {
        const s = slots[i] || {};
        return `${s.suit || '?'}${s.value != null ? s.value : '?'}`;
    }).sort();
    return `${tipo}:${parts.join(',')}`;
}

/**
 * Separa de la mano los grupos marcados como “mesa”.
 * @param {object[]} manoCartas cartas ya resueltas (mismo orden que los slots)
 * @param {{ indices: number[], lugar?: string }[]} gruposDetectados
 * @returns {{ mano: object[], gruposMesa: object[][] }}
 */
export function separarGruposMesaDeMano(manoCartas, gruposDetectados = []) {
    const mesaIdx = new Set();
    const gruposMesa = [];
    for (const g of gruposDetectados) {
        if (String(g?.lugar || 'mano').toLowerCase() !== 'mesa') continue;
        const idxs = (g.indices || []).map(Number).filter(i => i >= 0 && i < manoCartas.length);
        if (idxs.length < 3) continue;
        gruposMesa.push(idxs.map(i => manoCartas[i]));
        for (const i of idxs) mesaIdx.add(i);
    }
    const mano = manoCartas.filter((_, i) => !mesaIdx.has(i));
    return { mano, gruposMesa };
}


/**
 * Aplica un escenario resuelto (termina la partida).
 * @returns {{ ok: boolean, error?: string }}
 */
export function aplicarEscenarioDebug(game, scenarioId) {
    if (scenarioId === 'custom') {
        return { ok: false, error: 'Custom requiere formulario (playCustomDebug).' };
    }
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
            yo.mano = manoIds(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'S13']);
            rival.mano = manoIds(['C2', 'D4', 'S6', 'C8', 'D9', 'S11', 'C12']);
            yo.tuvoRoboDescarte = false;
            game.log('[Debug] Escenario Cero en mano cargado.');
            game.verificarVictoriaInmediata(yo);
            if (!game.juegoTerminado) {
                game.declararVictoria(yo.id, 'CERO_MANO');
            }
            break;
        }
        case 'enchufes': {
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

/**
 * Configura una partida jugable desde el formulario Custom.
 * Campos vacíos → aleatorio (excepto mazoRestante vacío → máximo disponible).
 *
 * @param {import('./game.js').GolpeadoGame} game
 * @param {object} config
 * @returns {{ ok: boolean, error?: string }}
 */
export function aplicarEscenarioCustom(game, config = {}) {
    if (!game?.jugadores || game.jugadores.length < 2) {
        return { ok: false, error: 'Se necesitan al menos 2 jugadores.' };
    }

    try {
        resetFin(game);

        const permitirColor = config.permitirVictoriaColor !== false;
        const permitirPoker = config.permitirVictoriaPoker !== false;
        game.permitirVictoriaColor = permitirColor;
        game.permitirVictoriaPoker = permitirPoker;
        // Si ambas especiales están off, marcar reciclado para bloquear elegibilidad residual
        game.mazoRecicladoUnaVez = !permitirColor && !permitirPoker;

        let miSlots = normalizarSlotsMano(config.miManoSlots, config.miMano);
        let rivalSlots = normalizarSlotsMano(config.rivalManoSlots, config.rivalMano);
        let descarteSlot = null;
        if (config.descarteSlot && (config.descarteSlot.suit || config.descarteSlot.value != null)) {
            descarteSlot = normalizarSlotsMano([config.descarteSlot])[0];
        } else if (String(config.descarteTop || '').trim()) {
            descarteSlot = normalizarSlotsMano(null, config.descarteTop)[0] || null;
        }
        let proximaSlots = normalizarSlotsMano(config.mazoProximasSlots, config.mazoProximas);

        // Compat: textareas viejos (opcional) + grupos detectados desde la UI
        let miGruposMano = parseGrupos(config.miGruposMano);
        let miGruposMesaTxt = parseGrupos(config.miGruposMesa);
        let rivalGruposMano = parseGrupos(config.rivalGruposMano);
        let rivalGruposMesaTxt = parseGrupos(config.rivalGruposMesa);
        const miGruposDetectadosRaw = Array.isArray(config.miGruposDetectados) ? config.miGruposDetectados : [];
        const rivalGruposDetectadosRaw = Array.isArray(config.rivalGruposDetectados) ? config.rivalGruposDetectados : [];

        // Si no vienen grupos detectados, inferir desde los slots (default: en mano)
        const miDetectados = miGruposDetectadosRaw.length
            ? miGruposDetectadosRaw
            : detectarGruposEnSlots(miSlots).map(g => ({ ...g, lugar: 'mano' }));
        const rivalDetectados = rivalGruposDetectadosRaw.length
            ? rivalGruposDetectadosRaw
            : detectarGruposEnSlots(rivalSlots).map(g => ({ ...g, lugar: 'mano' }));

        const used = new Set();
        const pool = barajar(todaLaBaraja());

        // Grupos en mesa / mano por texto primero (ocupan cartas fijas)
        const flatMiGruposMano = miGruposMano.flat();
        const flatRivalGruposMano = rivalGruposMano.flat();
        for (const c of [...flatMiGruposMano, ...flatRivalGruposMano, ...miGruposMesaTxt.flat(), ...rivalGruposMesaTxt.flat()]) {
            if (used.has(c.id)) throw new Error(`Carta repetida en grupos: ${c.id}`);
            used.add(c.id);
        }

        // Resolver selectores (respetan palo/valor aunque el otro sea “?”)
        let miMano = resolverSlots(miSlots, used, pool);
        let rivalMano = resolverSlots(rivalSlots, used, pool);

        // Fusionar grupos-en-mano pedidas por texto (si no estaban ya)
        const mergeUnique = (base, extra) => {
            const ids = new Set(base.map(c => c.id));
            const out = [...base];
            for (const c of extra) {
                if (!ids.has(c.id)) {
                    out.push(c);
                    ids.add(c.id);
                }
            }
            return out;
        };
        miMano = mergeUnique(miMano, flatMiGruposMano);
        rivalMano = mergeUnique(rivalMano, flatRivalGruposMano);

        // Separar grupos detectados marcados como “mesa” (salen de la mano)
        // Nota: los índices apuntan a la mano resuelta desde slots (antes del merge de texto).
        const miSplit = separarGruposMesaDeMano(
            miMano.slice(0, miSlots.length),
            miDetectados
        );
        // Conservar cartas extra del merge de texto que no estaban en slots
        const miExtra = miMano.slice(miSlots.length);
        miMano = [...miSplit.mano, ...miExtra];
        const miGruposMesa = [...miGruposMesaTxt, ...miSplit.gruposMesa];

        const rivalSplit = separarGruposMesaDeMano(
            rivalMano.slice(0, rivalSlots.length),
            rivalDetectados
        );
        const rivalExtra = rivalMano.slice(rivalSlots.length);
        rivalMano = [...rivalSplit.mano, ...rivalExtra];
        const rivalGruposMesa = [...rivalGruposMesaTxt, ...rivalSplit.gruposMesa];


        // Reservar descarte y próximas ANTES del relleno aleatorio
        // (si no, takeRandom puede consumir la carta pedida para el descarte).
        let descarteTop = descarteSlot
            ? tomarCartaPorSlot(descarteSlot, used, pool)
            : null;
        let proximas = resolverSlots(proximaSlots, used, pool);

        const takeRandom = (n) => {
            const picked = [];
            for (const c of pool) {
                if (used.has(c.id)) continue;
                picked.push(c);
                used.add(c.id);
                if (picked.length >= n) break;
            }
            if (picked.length < n) {
                throw new Error('No hay cartas suficientes para completar el escenario.');
            }
            return picked;
        };

        if (miMano.length > 8 || rivalMano.length > 8) {
            throw new Error('Ninguna mano puede tener más de 8 cartas.');
        }
        if (miMano.length === 8 && rivalMano.length === 8) {
            throw new Error('Solo uno puede tener 8 cartas: si el rival ya tiene 8, vos máximo 7 (y viceversa).');
        }

        // Completar a 8+7 (quién tiene 8 = el que ya llegó a 8, o vos por defecto)
        if (miMano.length === 0 && rivalMano.length === 0) {
            miMano = takeRandom(8);
            rivalMano = takeRandom(7);
        } else if (miMano.length === 8) {
            const needRival = 7 - rivalMano.length;
            if (needRival > 0) rivalMano = rivalMano.concat(takeRandom(needRival));
            else if (rivalMano.length === 0) rivalMano = takeRandom(7);
        } else if (rivalMano.length === 8) {
            const needMi = 7 - miMano.length;
            if (needMi > 0) miMano = miMano.concat(takeRandom(needMi));
            else if (miMano.length === 0) miMano = takeRandom(7);
        } else {
            if (miMano.length < 8) miMano = miMano.concat(takeRandom(8 - miMano.length));
            if (rivalMano.length < 7) rivalMano = rivalMano.concat(takeRandom(7 - rivalMano.length));
            else if (rivalMano.length === 0) rivalMano = takeRandom(7);
        }

        if (!descarteTop) {
            descarteTop = takeRandom(1)[0];
        }

        const disponibles = todaLaBaraja().filter(c => !used.has(c.id));
        const maxMazo = disponibles.length;
        let mazoRestante = config.mazoRestante;
        if (mazoRestante === '' || mazoRestante == null || Number.isNaN(Number(mazoRestante))) {
            mazoRestante = maxMazo;
        } else {
            mazoRestante = Math.max(0, Math.floor(Number(mazoRestante)));
        }
        if (proximas.length > mazoRestante) {
            throw new Error(`Hay ${proximas.length} cartas próximas pero el mazo solo tiene ${mazoRestante}.`);
        }
        if (mazoRestante > maxMazo) {
            throw new Error(`Solo quedan ${maxMazo} cartas libres para el mazo de robo.`);
        }

        const fillNeed = mazoRestante - proximas.length;
        const fill = barajar(disponibles.filter(c => !proximas.some(p => p.id === c.id))).slice(0, fillNeed);
        game.mazoRobo = [...fill, ...[...proximas].reverse()];

        const yo = game.jugadores[0];
        const rival = game.jugadores[1];
        yo.mano = miMano;
        rival.mano = rivalMano;
        yo.gruposExpuestos = miGruposMesa;
        rival.gruposExpuestos = rivalGruposMesa;
        yo.tuvoRoboDescarte = miGruposMesa.length > 0;
        rival.tuvoRoboDescarte = rivalGruposMesa.length > 0;

        game.mazoDescarte = descarteTop ? [descarteTop] : [];

        if (yo.mano.length === 8) {
            game.turnoActual = 0;
            game.faseActual = 'DESCARTE';
        } else if (rival.mano.length === 8) {
            game.turnoActual = 1;
            game.faseActual = 'DESCARTE';
        } else {
            game.turnoActual = 0;
            game.faseActual = 'ROBO';
        }

        game.log('[Debug] Escenario Custom cargado.');
        game.log(`[Debug] Color=${permitirColor ? 'on' : 'off'}, Póker=${permitirPoker ? 'on' : 'off'}, mazo=${game.mazoRobo.length}.`);
        game.log(`[Debug] Mano vos: ${miMano.map(c => c.label + c.suitLabel).join(' ')}`);

        const activo = game.jugadores[game.turnoActual];
        if (game.faseActual === 'DESCARTE') {
            game.verificarVictoriaEspecial(activo);
        }

        return { ok: true };
    } catch (err) {
        return { ok: false, error: err?.message || String(err) };
    }
}

export function listarIdsEscenarios() {
    return DEBUG_SCENARIOS.filter(s => !s.opensForm).map(s => s.id);
}

export function listarTodosIdsEscenarios() {
    return DEBUG_SCENARIOS.map(s => s.id);
}
