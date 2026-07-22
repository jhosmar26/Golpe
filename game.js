/**
 * Motor lógico del juego "Golpeado".
 * Administra el estado de la partida, los turnos, la baraja, las combinaciones y
 * las condiciones de victoria.
 */

export const SUITS = {
    H: { key: 'H', label: '♥', color: 'red' },
    D: { key: 'D', label: '♦', color: 'red' },
    C: { key: 'C', label: '♣', color: 'black' },
    S: { key: 'S', label: '♠', color: 'black' }
};

export const VALUES = {
    1: { value: 1, label: 'A', points: 11 },
    2: { value: 2, label: '2', points: 2 },
    3: { value: 3, label: '3', points: 3 },
    4: { value: 4, label: '4', points: 4 },
    5: { value: 5, label: '5', points: 5 },
    6: { value: 6, label: '6', points: 6 },
    7: { value: 7, label: '7', points: 7 },
    8: { value: 8, label: '8', points: 8 },
    9: { value: 9, label: '9', points: 9 },
    10: { value: 10, label: '10', points: 10 },
    11: { value: 11, label: 'J', points: 10 },
    12: { value: 12, label: 'Q', points: 10 },
    13: { value: 13, label: 'K', points: 10 }
};

// ==========================================
// 1. VALIDACIÓN DE COMBINACIONES (GRUPOS)
// ==========================================

/**
 * Retorna si un grupo de cartas es un Trío válido (3 cartas de igual valor, palos distintos).
 */
export function esTrio(cards) {
    if (cards.length !== 3) return false;
    const value = cards[0].value;
    const sameValue = cards.every(c => c.value === value);
    if (!sameValue) return false;
    
    // Validar palos distintos
    const suits = cards.map(c => c.suit);
    const uniqueSuits = new Set(suits);
    return uniqueSuits.size === 3;
}

/**
 * Retorna si un grupo de cartas es un Póker válido (4 cartas de igual valor, palos distintos).
 */
export function esPoker(cards) {
    if (cards.length !== 4) return false;
    const value = cards[0].value;
    const sameValue = cards.every(c => c.value === value);
    if (!sameValue) return false;
    
    // Validar palos distintos
    const suits = cards.map(c => c.suit);
    const uniqueSuits = new Set(suits);
    return uniqueSuits.size === 4;
}

/**
 * Retorna si un grupo de cartas es una Escalera válida (3 o más cartas del mismo palo, consecutivas, sin ser cíclicas).
 * El As solo puede ser 1 (A-2-3) o 14 (Q-K-A).
 */
export function esEscalera(cards) {
    if (cards.length < 3) return false;
    
    // Todos deben ser del mismo palo
    const suit = cards[0].suit;
    if (!cards.every(c => c.suit === suit)) return false;
    
    // Extraemos valores y ordenamos
    const values = cards.map(c => c.value);
    
    // Hipótesis 1: El As actúa como 1 (su valor por defecto)
    const sortedH1 = [...values].sort((a, b) => a - b);
    let h1Valida = true;
    for (let i = 1; i < sortedH1.length; i++) {
        if (sortedH1[i] !== sortedH1[i-1] + 1) {
            h1Valida = false;
            break;
        }
    }
    if (h1Valida) return true;
    
    // Hipótesis 2: Si hay un As (1), puede actuar como 14 (alto, p. ej. Q(12)-K(13)-A(14))
    if (values.includes(1)) {
        const valuesH2 = values.map(v => v === 1 ? 14 : v);
        const sortedH2 = valuesH2.sort((a, b) => a - b);
        let h2Valida = true;
        for (let i = 1; i < sortedH2.length; i++) {
            if (sortedH2[i] !== sortedH2[i-1] + 1) {
                h2Valida = false;
                break;
            }
        }
        if (h2Valida) return true;
    }
    
    return false;
}

/**
 * Retorna si las cartas forman un grupo válido (Trío, Póker o Escalera).
 */
export function esGrupoValido(cards) {
    return esTrio(cards) || esPoker(cards) || esEscalera(cards);
}

// ==========================================
// 2. ENCHUFES (LAY-OFFS) Y OPTIMIZACIÓN
// ==========================================

/**
 * Verifica si una carta se puede enchufar en un grupo de cartas ya existente y válido.
 * Retorna el nuevo grupo si es válido, o null si no se puede enchufar.
 */
export function intentarEnchufarCarta(grupo, carta) {
    const nuevoGrupo = [...grupo, carta];
    
    // Si el grupo original era un Trío, con la nueva carta podría formar un Póker
    if (esTrio(grupo) && esPoker(nuevoGrupo)) {
        return nuevoGrupo;
    }
    
    // Si el grupo original era una Escalera, la nueva carta debe extenderla por los extremos
    if (esEscalera(grupo) && esEscalera(nuevoGrupo)) {
        return nuevoGrupo;
    }
    
    // Caso especial: si es una Escalera y el grupo original ya tiene más de 3 cartas,
    // esEscalera(nuevoGrupo) seguirá validando correctamente la secuencia ordenada.
    return null;
}

/**
 * Calcula los puntos de cartas que no están combinadas (Deadwood).
 */
export function calcularPuntosCartasSueltas(cards) {
    return cards.reduce((sum, card) => sum + VALUES[card.value].points, 0);
}

/**
 * Busca recursivamente la mejor organización de las cartas de un jugador (mano).
 * Minimiza la puntuación de las cartas sueltas (Deadwood), considerando la posibilidad
 * de formar grupos propios e integrar cartas en los grupos expuestos en la mesa.
 *
 * @param {Array} mano - Cartas en mano del jugador.
 * @param {Array} gruposMesa - Array de grupos expuestos en la mesa (ej: [[c1, c2, c3], ...]).
 * @returns {Object} { gruposPropios: [[], ...], enchufes: [{carta, enGrupoIndex}], sueltas: [], puntos: number }
 */
export function optimizarMano(mano, gruposMesa = []) {
    let mejorResultado = {
        gruposPropios: [],
        enchufes: [],
        sueltas: [...mano],
        puntos: calcularPuntosCartasSueltas(mano)
    };

    // Función auxiliar recursiva para buscar combinaciones
    function buscar(cartasDisponibles, gruposFormados, enchufesFormados, mesaActual) {
        const puntosActuales = calcularPuntosCartasSueltas(cartasDisponibles);
        if (puntosActuales < mejorResultado.puntos) {
            mejorResultado = {
                gruposPropios: [...gruposFormados],
                enchufes: [...enchufesFormados],
                sueltas: [...cartasDisponibles],
                puntos: puntosActuales
            };
        }

        // Si ya no quedan cartas, terminamos
        if (cartasDisponibles.length === 0) return;

        // 1. Intentar formar grupos propios con subconjuntos de las cartas disponibles
        // Probamos tamaños de 3 y 4 (para tríos, póker o escaleras cortas)
        for (let sz = 3; sz <= Math.min(8, cartasDisponibles.length); sz++) {
            const combinaciones = obtenerCombinaciones(cartasDisponibles, sz);
            for (const combo of combinaciones) {
                if (esGrupoValido(combo)) {
                    const restantes = cartasDisponibles.filter(c => !combo.some(cc => cc.id === c.id));
                    
                    // Al formar un grupo propio, este se agrega a "mesaActual" para permitir enchufes en él
                    const nuevaMesa = [...mesaActual, combo];
                    buscar(
                        restantes,
                        [...gruposFormados, combo],
                        enchufesFormados,
                        nuevaMesa
                    );
                }
            }
        }

        // 2. Intentar enchufar cartas sueltas de forma individual en los grupos de la mesa (propios o ajenos)
        for (let i = 0; i < cartasDisponibles.length; i++) {
            const carta = cartasDisponibles[i];
            for (let gIdx = 0; gIdx < mesaActual.length; gIdx++) {
                const grupoDestino = mesaActual[gIdx];
                const nuevoGrupo = intentarEnchufarCarta(grupoDestino, carta);
                if (nuevoGrupo) {
                    const restantes = cartasDisponibles.filter(c => c.id !== carta.id);
                    
                    // Actualizar el grupo en la mesa temporal para futuras recursiones
                    const nuevaMesa = [...mesaActual];
                    nuevaMesa[gIdx] = nuevoGrupo;
                    
                    buscar(
                        restantes,
                        gruposFormados,
                        [...enchufesFormados, { carta, enGrupoIndex: gIdx, grupoDestino }],
                        nuevaMesa
                    );
                }
            }
        }
    }

    // Clonamos los grupos de la mesa para simular modificaciones locales durante la recursión
    const mesaInicial = gruposMesa.map(g => [...g]);
    buscar(mano, [], [], mesaInicial);

    return mejorResultado;
}

/**
 * Función helper para generar combinaciones de un array de tamaño k.
 */
function obtenerCombinaciones(arr, k) {
    const resultados = [];
    function helper(inicio, comboActual) {
        if (comboActual.length === k) {
            resultados.push([...comboActual]);
            return;
        }
        for (let i = inicio; i < arr.length; i++) {
            comboActual.push(arr[i]);
            helper(i + 1, comboActual);
            comboActual.pop();
        }
    }
    helper(0, []);
    return resultados;
}

// ==========================================
// 3. CLASE PRINCIPAL: MOTOR DE JUEGO (GAMESTATE)
// ==========================================

export class GolpeadoGame {
    constructor() {
        this.jugadores = [];
        this.mazoRobo = [];
        this.mazoDescarte = [];
        this.turnoActual = 0;
        this.faseActual = 'ROBO'; // 'ROBO' o 'DESCARTE'
        
        // Control de victoria diferida (Modo B)
        this.jugadorEnEspera = null; // Jugador en estado de espera para ganar (secreto)
        this.turnosEsperaRestantes = 0; // Vueltas a esperar
        
        this.juegoTerminado = false;
        this.ganadorId = null;
        this.tipoVictoria = null; // 'CERO_MANO', 'CERO_EXPUESTO', 'PUNTOS'
        
        // Historial de eventos del juego para la UI
        this.historial = [];
    }

    log(mensaje) {
        this.historial.push({ timestamp: new Date(), mensaje });
        console.log(`[Golpeado] ${mensaje}`);
    }

    /**
     * Inicializa una partida con los jugadores indicados.
     */
    inicializarJuego(nombresJugadores = ['Jugador A', 'Jugador B']) {
        this.juegoTerminado = false;
        this.ganadorId = null;
        this.tipoVictoria = null;
        this.jugadorEnEspera = null;
        this.turnosEsperaRestantes = 0;
        this.mazoDescarte = [];
        this.historial = [];

        // 1. Crear baraja
        const baraja = [];
        for (const suitKey in SUITS) {
            for (const valKey in VALUES) {
                const val = VALUES[valKey];
                baraja.push({
                    id: `${suitKey}${val.value}`,
                    suit: suitKey,
                    value: val.value,
                    label: val.label,
                    suitLabel: SUITS[suitKey].label,
                    color: SUITS[suitKey].color
                });
            }
        }

        // 2. Barajar (Fisher-Yates)
        for (let i = baraja.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [baraja[i], baraja[j]] = [baraja[j], baraja[i]];
        }
        this.mazoRobo = baraja;

        // 3. Crear jugadores y repartir
        this.jugadores = nombresJugadores.map((nombre, idx) => {
            const esPrimerJugador = (idx === 0);
            const numCartas = esPrimerJugador ? 8 : 7;
            const mano = [];
            for (let c = 0; c < numCartas; c++) {
                mano.push(this.mazoRobo.pop());
            }
            return {
                id: idx,
                nombre,
                mano,
                gruposExpuestos: [], // Grupos expuestos públicamente en la mesa
                tuvoRoboDescarte: false // Rastrear si robó del descarte (para Cero en Mano)
            };
        });

        this.turnoActual = 0;
        // El primer jugador inicia con 8 cartas directamente en fase de DESCARTE (omite robo)
        this.faseActual = 'DESCARTE';
        this.log(`Partida iniciada. ${this.jugadores[0].nombre} inicia con 8 cartas (fase Descarte).`);
    }

    /**
     * Obtiene el jugador activo en el turno.
     */
    get jugadorActivo() {
        return this.jugadores[this.turnoActual];
    }

    /**
     * Retorna todos los grupos expuestos en la mesa de todos los jugadores.
     */
    get gruposEnMesa() {
        return this.jugadores.reduce((all, player) => {
            return all.concat(player.gruposExpuestos);
        }, []);
    }

    /**
     * Valida que el índice corresponda al jugador con el turno activo.
     */
    esTurnoDe(playerIndex) {
        return Number(playerIndex) === this.turnoActual && !this.juegoTerminado;
    }

    /**
     * Acción: Robar carta del mazo de robo.
     * @param {number} [playerIndex] - Índice del jugador que actúa (validación de turno).
     */
    robarDeMazo(playerIndex) {
        if (this.juegoTerminado) return false;
        if (!this.esTurnoDe(playerIndex)) {
            this.log("Acción inválida: No es tu turno.");
            return false;
        }
        if (this.faseActual !== 'ROBO') {
            this.log("Acción inválida: No estás en la fase de robo.");
            return false;
        }

        // Si se acaba el mazo, reciclamos el descarte excepto la superior
        if (this.mazoRobo.length === 0) {
            if (this.mazoDescarte.length <= 1) {
                this.log("¡No quedan cartas en el mazo ni en descartes!");
                return false;
            }
            const ultimaCarta = this.mazoDescarte.pop();
            this.mazoRobo = [...this.mazoDescarte];
            // Barajar mazo reciclado
            for (let i = this.mazoRobo.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [this.mazoRobo[i], this.mazoRobo[j]] = [this.mazoRobo[j], this.mazoRobo[i]];
            }
            this.mazoDescarte = [ultimaCarta];
            this.log("Mazo agotado. Se recicló y barajó la pila de descartes.");
        }

        const carta = this.mazoRobo.pop();
        const jugador = this.jugadorActivo;
        jugador.mano.push(carta);
        this.faseActual = 'DESCARTE';

        this.log(`${jugador.nombre} robó una carta del mazo.`);

        // Comprobación interna de victoria inmediata para Cero en Mano (Modo A)
        this.verificarVictoriaInmediata(jugador);

        return true;
    }

    /**
     * Acción: Robar del descarte.
     * @param {Array} cartasAsociadasIds - IDs de las cartas en la mano del jugador con las cuales completará un grupo con la carta del descarte.
     * @param {number} [playerIndex] - Índice del jugador que actúa (validación de turno).
     */
    robarDeDescarte(cartasAsociadasIds = [], playerIndex) {
        if (this.juegoTerminado) return false;
        if (!this.esTurnoDe(playerIndex)) {
            this.log("Acción inválida: No es tu turno.");
            return false;
        }
        if (this.faseActual !== 'ROBO') {
            this.log("Acción inválida: No estás en la fase de robo.");
            return false;
        }
        if (this.mazoDescarte.length === 0) {
            this.log("La pila de descartes está vacía.");
            return false;
        }

        const jugador = this.jugadorActivo;
        const cartaDescarte = this.mazoDescarte[this.mazoDescarte.length - 1];

        // Validar que se seleccionaron cartas para hacer combinación
        const cartasManoAsociadas = jugador.mano.filter(c => cartasAsociadasIds.includes(c.id));
        const grupoPropuesto = [cartaDescarte, ...cartasManoAsociadas];

        if (!esGrupoValido(grupoPropuesto)) {
            this.log("Error: La carta del descarte debe completar inmediatamente un grupo válido.");
            return false;
        }

        // Si es válido, se roba la carta
        this.mazoDescarte.pop();
        jugador.mano.push(cartaDescarte);
        jugador.tuvoRoboDescarte = true; // Ya no califica para Cero en Mano

        // Es obligatorio bajar/exponer el grupo completado a la mesa
        // Eliminamos las cartas asociadas de la mano y las colocamos en los grupos expuestos
        jugador.mano = jugador.mano.filter(c => !grupoPropuesto.some(gp => gp.id === c.id));
        jugador.gruposExpuestos.push(grupoPropuesto);

        this.faseActual = 'DESCARTE';
        this.log(`${jugador.nombre} robó ${cartaDescarte.label}${cartaDescarte.suitLabel} del descarte y expuso el grupo: [${grupoPropuesto.map(c => c.label + c.suitLabel).join(', ')}].`);

        return true;
    }

    /**
     * Acción: Descartar una carta.
     * @param {string} cartaId - ID de la carta a descartar de la mano.
     * @param {number} [playerIndex] - Índice del jugador que actúa (validación de turno).
     */
    descartarCarta(cartaId, playerIndex) {
        if (this.juegoTerminado) return false;
        if (!this.esTurnoDe(playerIndex)) {
            this.log("Acción inválida: No es tu turno.");
            return false;
        }
        if (this.faseActual !== 'DESCARTE') {
            this.log("Acción inválida: Debes robar antes de descartar.");
            return false;
        }

        const jugador = this.jugadorActivo;
        const index = jugador.mano.findIndex(c => c.id === cartaId);
        if (index === -1) {
            this.log("La carta seleccionada no está en tu mano.");
            return false;
        }

        const cartaDescartada = jugador.mano.splice(index, 1)[0];
        this.mazoDescarte.push(cartaDescartada);
        this.log(`${jugador.nombre} descartó ${cartaDescartada.label}${cartaDescartada.suitLabel}.`);

        // Comprobar si tras el descarte el jugador califica para victoria en espera (Modo B)
        // El jugador entra en espera si sus 7 cartas restantes (mano + expuestas) se optimizan a 0 puntos de Deadwood
        const optimizacion = optimizarMano(jugador.mano, this.gruposEnMesa);
        const tieneCeroSueltas = (optimizacion.puntos === 0);

        if (tieneCeroSueltas && jugador.tuvoRoboDescarte) {
            // Entra en estado de espera secreto
            this.jugadorEnEspera = jugador.id;
            this.turnosEsperaRestantes = this.jugadores.length; // Una vuelta completa (incluyendo su próximo inicio de turno)
            this.log(`[Secreto] ${jugador.nombre} está en espera para ganar (Modo B).`);
        }

        // Pasar turno
        this.avanzarTurno();
        return true;
    }

    /**
     * Comprueba si el jugador tiene Cero en Mano (victoria inmediata).
     */
    verificarVictoriaInmediata(jugador) {
        if (jugador.tuvoRoboDescarte) return; // Debe cumplir que nunca robó de descartes

        // Tiene 8 cartas en mano (por haber robado). Vemos si puede optimizar 7 cartas a 0 puntos
        const optimizacion = optimizarMano(jugador.mano, this.gruposEnMesa);
        
        // Si tiene exactamente 0 puntos sueltas con 7 cartas (sobrando la 8va)
        if (optimizacion.puntos === 0 && optimizacion.sueltas.length === 1) {
            this.declararVictoria(jugador.id, 'CERO_MANO');
        }
    }

    /**
     * Avanza el turno del juego en sentido horario y gestiona los turnos de espera.
     */
    avanzarTurno() {
        if (this.juegoTerminado) return;

        // Comprobación de estado de espera de victoria (Modo B)
        if (this.jugadorEnEspera !== null) {
            this.turnosEsperaRestantes--;
            
            // Si regresa el turno al jugador en espera y nadie ha ganado en el camino
            if (this.turnosEsperaRestantes === 0) {
                const jugadorEspera = this.jugadores[this.jugadorEnEspera];
                // Se declara ganador inmediatamente al iniciar su turno
                this.declararVictoria(jugadorEspera.id, 'CERO_EXPUESTO');
                return;
            }
        }

        // Avanzar índice
        this.turnoActual = (this.turnoActual + 1) % this.jugadores.length;
        this.faseActual = 'ROBO';
        this.log(`Turno de ${this.jugadorActivo.nombre}. Fase de Robo.`);
    }

    /**
     * Declara la victoria de un jugador y finaliza la partida.
     */
    declararVictoria(jugadorId, tipo) {
        const jugador = this.jugadores.find(j => j.id === jugadorId);
        this.juegoTerminado = true;
        this.ganadorId = jugadorId;
        this.tipoVictoria = tipo;

        let msg = "";
        if (tipo === 'CERO_MANO') {
            msg = `¡${jugador.nombre} gana la partida con CERO EN MANO (Victoria Inmediata)!`;
        } else if (tipo === 'CERO_EXPUESTO') {
            msg = `¡${jugador.nombre} gana la partida con CERO CON GRUPO EXPUESTO (Victoria Diferida)!`;
        }
        this.log(msg);
    }

    /**
     * Acción: Detener el juego cantando por puntos.
     * @param {number} [playerIndex] - Índice del jugador que actúa (validación de turno).
     */
    cantarPorPuntos(playerIndex) {
        if (this.juegoTerminado) return null;
        if (!this.esTurnoDe(playerIndex)) {
            this.log("Acción inválida: No es tu turno.");
            return null;
        }
        
        // Solo se permite cantar por puntos antes de robar (en la fase de ROBO)
        if (this.faseActual !== 'ROBO') {
            this.log("Acción inválida: Solo se puede cantar por puntos antes de robar.");
            return null;
        }
        
        const cantor = this.jugadorActivo;
        this.log(`${cantor.nombre} ha cantado "STOP" por puntos. Evaluando manos de todos los jugadores...`);

        // 1. Optimizar las manos de todos los jugadores y registrar sus grupos
        const resultados = this.jugadores.map(jugador => {
            const opt = optimizarMano(jugador.mano, this.gruposEnMesa);
            // El total de grupos es la suma de los grupos expuestos y los formados internamente en la mano
            const numGrupos = jugador.gruposExpuestos.length + opt.gruposPropios.length;
            
            return {
                id: jugador.id,
                nombre: jugador.nombre,
                manoFinal: jugador.mano,
                gruposPropios: opt.gruposPropios,
                enchufes: opt.enchufes,
                cartasSueltas: opt.sueltas,
                puntosSueltas: opt.puntos,
                numGrupos: numGrupos,
                elegible: false
            };
        });

        const resCantor = resultados.find(r => r.id === cantor.id);
        const gruposCantor = resCantor.numGrupos;

        // 2. Filtrar elegibilidad: rivales deben tener al menos la misma cantidad de grupos que el cantor
        resultados.forEach(res => {
            if (res.id === cantor.id) {
                res.elegible = true;
            } else {
                res.elegible = (res.numGrupos >= gruposCantor);
            }
        });

        // 3. Determinar el ganador entre los elegibles
        const elegibles = resultados.filter(r => r.elegible);
        
        // Encontrar la menor puntuación
        const menorPuntaje = Math.min(...elegibles.map(e => e.puntosSueltas));
        const ganadoresPotenciales = elegibles.filter(e => e.puntosSueltas === menorPuntaje);

        let resGanador = null;

        if (ganadoresPotenciales.length === 1) {
            resGanador = ganadoresPotenciales[0];
        } else {
            // Resolución de empates:
            // A) Si el cantor forma parte del empate, gana el cantor
            const cantorEnEmpate = ganadoresPotenciales.find(e => e.id === cantor.id);
            if (cantorEnEmpate) {
                resGanador = cantorEnEmpate;
            } else {
                // B) Si el cantor no está, gana el más cercano al cantor en sentido horario
                // Calculamos distancias en el turno
                let minDistancia = Infinity;
                let elegido = null;
                
                ganadoresPotenciales.forEach(pot => {
                    // Distancia en sentido horario desde cantor
                    let dist = (pot.id - cantor.id + this.jugadores.length) % this.jugadores.length;
                    if (dist < minDistancia) {
                        minDistancia = dist;
                        elegido = pot;
                    }
                });
                resGanador = elegido;
            }
        }

        // 4. Finalizar juego
        this.juegoTerminado = true;
        this.ganadorId = resGanador.id;
        this.tipoVictoria = 'PUNTOS';

        // Determinar si el cantor perdió para aplicar penalización del triple
        const cantorGano = (resGanador.id === cantor.id);
        
        this.log(`Resultados de Puntos:`);
        resultados.forEach(r => {
            this.log(`- ${r.nombre}: ${r.puntosSueltas} pts de cartas sueltas (${r.numGrupos} grupos). Elegible: ${r.elegible ? "SÍ" : "NO"}`);
        });
        
        let detalleFinal = `¡Ganador por puntos: ${resGanador.nombre} con ${resGanador.puntosSueltas} pts!`;
        if (!cantorGano) {
            detalleFinal += ` El cantor (${cantor.nombre}) perdió y debe pagar el triple al ganador.`;
        }
        this.log(detalleFinal);

        return {
            resultados,
            ganadorId: this.ganadorId,
            cantorGano,
            cantorId: cantor.id
        };
    }

    /**
     * Reordena la mano de un jugador (solo su dispositivo / su estado).
     * No requiere ser el turno activo: es organización visual local.
     */
    reordenarMano(ordenIds, playerIndex) {
        if (this.juegoTerminado) return false;

        const jugador = this.jugadores[playerIndex];
        if (!jugador) return false;
        if (!Array.isArray(ordenIds) || ordenIds.length !== jugador.mano.length) {
            return false;
        }

        const porId = new Map(jugador.mano.map(c => [String(c.id), c]));
        const nuevaMano = [];
        for (const id of ordenIds) {
            const carta = porId.get(String(id));
            if (!carta) return false;
            nuevaMano.push(carta);
            porId.delete(String(id));
        }
        if (porId.size !== 0) return false;

        jugador.mano = nuevaMano;
        return true;
    }

    /**
     * Vista serializada para un cliente: oculta manos ajenas.
     */
    serializarParaJugador(viewerIndex) {
        const descarteTop = this.mazoDescarte.length > 0
            ? this.mazoDescarte[this.mazoDescarte.length - 1]
            : null;

        return {
            juegoTerminado: this.juegoTerminado,
            ganadorId: this.ganadorId,
            tipoVictoria: this.tipoVictoria,
            turnoActual: this.turnoActual,
            faseActual: this.faseActual,
            miIndice: viewerIndex,
            esMiTurno: viewerIndex === this.turnoActual,
            mazoRoboCount: this.mazoRobo.length,
            descarteTop,
            descarteCount: this.mazoDescarte.length,
            historial: this.historial
                .filter(h => !String(h.mensaje).startsWith('[Secreto]'))
                .map(h => ({
                    mensaje: h.mensaje,
                    timestamp: h.timestamp
                })),
            jugadores: this.jugadores.map((j) => {
                const esYo = j.id === viewerIndex;
                return {
                    id: j.id,
                    nombre: j.nombre,
                    cartasCount: j.mano.length,
                    gruposExpuestos: j.gruposExpuestos,
                    mano: esYo || this.juegoTerminado ? j.mano : null,
                    esYo
                };
            }),
            resultadosVictoria: this.juegoTerminado ? this.obtenerResultadosVictoria() : null
        };
    }

    /**
     * Datos de tabla final (manos reveladas).
     */
    obtenerResultadosVictoria() {
        return this.jugadores.map(jugador => {
            const opt = optimizarMano(jugador.mano, this.gruposEnMesa);
            const totalGrupos = jugador.gruposExpuestos.length + opt.gruposPropios.length;
            return {
                id: jugador.id,
                nombre: jugador.nombre,
                esGanador: jugador.id === this.ganadorId,
                grupos: totalGrupos,
                puntosSueltas: opt.puntos,
                cartasSueltasText: opt.sueltas.map(c => c.label + c.suitLabel).join(', ') || 'Ninguna'
            };
        });
    }
}
