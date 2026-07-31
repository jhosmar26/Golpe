/**
 * Servidor autoritativo de Golpeado (Express + Socket.io).
 * El Game State vive aquí; los clientes solo reciben vistas y envían acciones.
 */

import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { GolpeadoGame } from './game.js';
import { jugarTurnoBot } from './bot.js';
import { aplicarEscenarioDebug, aplicarEscenarioCustom, listarIdsEscenarios } from './debug-scenarios.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3080;
const HOST = process.env.HOST || '0.0.0.0';
const LOBBY_MIN = 2;
const LOBBY_MAX = 6;
const BOT_NOMBRES = ['Bot Ana', 'Bot Luis', 'Bot Sofía', 'Bot Diego', 'Bot Marta'];
/** Tiempo para volver a la partida tras minimizar el navegador / cortar red. */
const RECONNECT_GRACE_MS = 3 * 60 * 1000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: true,
        methods: ['GET', 'POST']
    }
});

app.set('trust proxy', 1);
app.use(express.static(__dirname));

/** @type {Map<string, object>} */
const rooms = new Map();

function generarCodigoSala() {
    let code;
    do {
        code = String(Math.floor(1000 + Math.random() * 9000));
    } while (rooms.has(code));
    return code;
}

function obtenerSalaDeSocket(socket) {
    const code = socket.data.roomCode;
    if (!code) return null;
    return rooms.get(code) || null;
}

function jugadoresListos(room) {
    return room.players.filter(p => p.esBot || p.conectado);
}

function serializarLobby(room, socketId) {
    const listos = jugadoresListos(room);
    return {
        code: room.code,
        status: room.status,
        hostId: room.hostId,
        yoSoyHost: room.hostId === socketId,
        players: room.players.map((p, idx) => ({
            id: idx,
            nombre: p.nombre,
            socketId: p.socketId,
            conectado: p.conectado,
            esBot: !!p.esBot,
            esYo: !p.esBot && p.socketId === socketId,
            esHost: !p.esBot && p.socketId === room.hostId,
            ...( !p.esBot && p.socketId === socketId && p.sessionId
                ? { sessionId: p.sessionId }
                : {})
        })),
        minPlayers: LOBBY_MIN,
        maxPlayers: LOBBY_MAX,
        puedeEmpezar: listos.length >= LOBBY_MIN,
        puedeAgregarBot: listos.length < LOBBY_MAX
    };
}

function emitirLobby(room) {
    for (const p of room.players) {
        if (p.esBot || !p.conectado) continue;
        io.to(p.socketId).emit('roomState', serializarLobby(room, p.socketId));
    }
}

function emitirGameState(room) {
    if (!room.game) return;
    for (const p of room.players) {
        if (p.esBot || !p.conectado || p.playerIndex == null) continue;
        const vista = room.game.serializarParaJugador(p.playerIndex);
        io.to(p.socketId).emit('gameState', vista);
    }
}

function encontrarJugador(room, socketId) {
    return room.players.find(p => !p.esBot && p.socketId === socketId) || null;
}

function normalizarSessionId(raw) {
    const s = String(raw || '').trim();
    if (s && s.length >= 8 && s.length <= 80) return s;
    return crypto.randomUUID();
}

function crearJugadorHumano(socket, nombre, sessionId) {
    return {
        socketId: socket.id,
        nombre,
        conectado: true,
        esBot: false,
        playerIndex: null,
        sessionId: normalizarSessionId(sessionId)
    };
}

function cancelarGraciaEliminacion(room) {
    if (room?._graceTimer) {
        clearTimeout(room._graceTimer);
        room._graceTimer = null;
    }
}

function programarEliminacionSiVacia(room) {
    if (!room) return;
    cancelarGraciaEliminacion(room);
    room._graceTimer = setTimeout(() => {
        room._graceTimer = null;
        const alguienHumano = room.players.some(p => !p.esBot && p.conectado);
        if (alguienHumano) return;
        if (room._botTimer) clearTimeout(room._botTimer);
        rooms.delete(room.code);
        console.log(`[Sala ${room.code}] eliminada (gracia de reconexión agotada)`);
    }, RECONNECT_GRACE_MS);
}

function crearBot(room) {
    const usados = new Set(room.players.map(p => p.nombre));
    const nombre = BOT_NOMBRES.find(n => !usados.has(n)) || `Bot ${room.players.length + 1}`;
    const bot = {
        socketId: `bot-${room.code}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        nombre,
        conectado: true,
        esBot: true,
        playerIndex: null
    };
    room.players.push(bot);
    return bot;
}

function iniciarPartidaEnSala(room) {
    const listos = jugadoresListos(room);
    room.players = listos;
    room.players.forEach((p, idx) => {
        p.playerIndex = idx;
    });

    const nombres = room.players.map(p => p.nombre);
    room.game = new GolpeadoGame();
    room.game.inicializarJuego(nombres);
    room.status = 'playing';

    emitirLobby(room);
    emitirGameState(room);
    programarTurnosBot(room);
    console.log(`[Sala ${room.code}] partida iniciada (${nombres.join(', ')})`);
}

function programarTurnosBot(room) {
    if (room._botTimer) {
        clearTimeout(room._botTimer);
        room._botTimer = null;
    }
    if (!room.game || room.game.juegoTerminado || room.status !== 'playing') return;

    const actual = room.players.find(p => p.playerIndex === room.game.turnoActual);
    if (!actual?.esBot) return;

    room._botTimer = setTimeout(() => {
        room._botTimer = null;
        ejecutarTurnoBot(room);
    }, 700 + Math.floor(Math.random() * 800));
}

function ejecutarTurnoBot(room) {
    if (!room.game || room.game.juegoTerminado || room.status !== 'playing') return;

    const idx = room.game.turnoActual;
    const actual = room.players.find(p => p.playerIndex === idx);
    if (!actual?.esBot) return;

    jugarTurnoBot(room.game, idx);

    if (room.game.juegoTerminado) {
        room.status = 'finished';
        emitirLobby(room);
    }

    emitirGameState(room);
    programarTurnosBot(room);
}

io.on('connection', (socket) => {
    console.log(`[+] Conectado: ${socket.id}`);

    socket.on('createRoom', ({ nombre, sessionId } = {}, ack) => {
        const nombreLimpio = String(nombre || '').trim() || 'Anfitrión';
        const code = generarCodigoSala();
        const room = {
            code,
            hostId: socket.id,
            status: 'lobby',
            players: [crearJugadorHumano(socket, nombreLimpio, sessionId)],
            game: null,
            _botTimer: null,
            _graceTimer: null
        };
        rooms.set(code, room);
        socket.data.roomCode = code;
        socket.join(code);

        const payload = serializarLobby(room, socket.id);
        if (typeof ack === 'function') ack({ ok: true, room: payload });
        socket.emit('roomState', payload);
        console.log(`[Sala ${code}] creada por ${nombreLimpio}`);
    });

    socket.on('joinRoom', ({ code, nombre, sessionId } = {}, ack) => {
        const codeNorm = String(code || '').trim();
        const room = rooms.get(codeNorm);
        const responder = (data) => {
            if (typeof ack === 'function') ack(data);
        };

        if (!room) {
            responder({ ok: false, error: 'Sala no encontrada.' });
            return;
        }
        if (room.status !== 'lobby') {
            responder({ ok: false, error: 'La partida ya comenzó.' });
            return;
        }
        if (jugadoresListos(room).length >= LOBBY_MAX) {
            responder({ ok: false, error: 'La sala está llena.' });
            return;
        }

        const nombreLimpio = String(nombre || '').trim() || `Jugador ${room.players.length + 1}`;
        room.players.push(crearJugadorHumano(socket, nombreLimpio, sessionId));
        cancelarGraciaEliminacion(room);
        socket.data.roomCode = codeNorm;
        socket.join(codeNorm);

        emitirLobby(room);
        responder({ ok: true, room: serializarLobby(room, socket.id) });
        console.log(`[Sala ${codeNorm}] ${nombreLimpio} se unió`);
    });

    socket.on('addBot', (ack) => {
        const room = obtenerSalaDeSocket(socket);
        const responder = (data) => {
            if (typeof ack === 'function') ack(data);
        };
        if (!room) {
            responder({ ok: false, error: 'No estás en una sala.' });
            return;
        }
        if (room.hostId !== socket.id) {
            responder({ ok: false, error: 'Solo el anfitrión puede agregar bots.' });
            return;
        }
        if (room.status !== 'lobby') {
            responder({ ok: false, error: 'La partida ya comenzó.' });
            return;
        }
        if (jugadoresListos(room).length >= LOBBY_MAX) {
            responder({ ok: false, error: 'La sala está llena.' });
            return;
        }

        const bot = crearBot(room);
        emitirLobby(room);
        responder({ ok: true });
        console.log(`[Sala ${room.code}] se agregó ${bot.nombre}`);
    });

    socket.on('playVsBots', ({ nombre, numBots = 1, sessionId } = {}, ack) => {
        const responder = (data) => {
            if (typeof ack === 'function') ack(data);
        };
        const nombreLimpio = String(nombre || '').trim() || 'Jugador';
        const n = Math.max(1, Math.min(Number(numBots) || 1, LOBBY_MAX - 1));

        const code = generarCodigoSala();
        const room = {
            code,
            hostId: socket.id,
            status: 'lobby',
            players: [crearJugadorHumano(socket, nombreLimpio, sessionId)],
            game: null,
            _botTimer: null,
            _graceTimer: null
        };
        for (let i = 0; i < n; i++) crearBot(room);

        rooms.set(code, room);
        socket.data.roomCode = code;
        socket.join(code);

        iniciarPartidaEnSala(room);
        responder({ ok: true, room: serializarLobby(room, socket.id) });
        console.log(`[Sala ${code}] vs bots (${n}) para ${nombreLimpio}`);
    });

    socket.on('playDebugScenario', ({ nombre, scenarioId, sessionId } = {}, ack) => {
        const responder = (data) => {
            if (typeof ack === 'function') ack(data);
        };

        const id = String(scenarioId || '').trim();
        if (!listarIdsEscenarios().includes(id)) {
            responder({ ok: false, error: 'Escenario de prueba inválido.' });
            return;
        }

        // Salir de sala previa si había una
        if (socket.data.roomCode) {
            salirDeSala(socket);
        }

        const nombreLimpio = String(nombre || '').trim() || 'Jugador';
        const code = generarCodigoSala();
        const room = {
            code,
            hostId: socket.id,
            status: 'lobby',
            players: [crearJugadorHumano(socket, nombreLimpio, sessionId)],
            game: null,
            _botTimer: null,
            _graceTimer: null,
            esDebug: true
        };
        crearBot(room);
        rooms.set(code, room);
        socket.data.roomCode = code;
        socket.join(code);

        const listos = jugadoresListos(room);
        room.players = listos;
        room.players.forEach((p, idx) => {
            p.playerIndex = idx;
        });

        room.game = new GolpeadoGame();
        room.game.inicializarJuego(room.players.map(p => p.nombre));

        // Anular victoria accidental por mano aleatoria al repartir
        room.game.juegoTerminado = false;
        room.game.ganadorId = null;
        room.game.tipoVictoria = null;

        const aplicado = aplicarEscenarioDebug(room.game, id);
        if (!aplicado.ok) {
            rooms.delete(code);
            socket.leave(code);
            socket.data.roomCode = null;
            responder({ ok: false, error: aplicado.error || 'No se pudo aplicar el escenario.' });
            return;
        }

        room.status = room.game.juegoTerminado ? 'finished' : 'playing';
        emitirLobby(room);
        emitirGameState(room);
        if (room.status === 'playing') programarTurnosBot(room);

        responder({ ok: true, room: serializarLobby(room, socket.id), scenarioId: id });
        console.log(`[Sala ${code}] debug «${id}» para ${nombreLimpio}`);
    });

    socket.on('playCustomDebug', ({ nombre, config, sessionId } = {}, ack) => {
        const responder = (data) => {
            if (typeof ack === 'function') ack(data);
        };

        if (socket.data.roomCode) {
            salirDeSala(socket);
        }

        const nombreLimpio = String(nombre || '').trim() || 'Jugador';
        const code = generarCodigoSala();
        const room = {
            code,
            hostId: socket.id,
            status: 'lobby',
            players: [crearJugadorHumano(socket, nombreLimpio, sessionId)],
            game: null,
            _botTimer: null,
            _graceTimer: null,
            esDebug: true
        };
        crearBot(room);
        rooms.set(code, room);
        socket.data.roomCode = code;
        socket.join(code);

        const listos = jugadoresListos(room);
        room.players = listos;
        room.players.forEach((p, idx) => {
            p.playerIndex = idx;
        });

        room.game = new GolpeadoGame();
        room.game.inicializarJuego(room.players.map(p => p.nombre));
        room.game.juegoTerminado = false;
        room.game.ganadorId = null;
        room.game.tipoVictoria = null;

        const cfg = config || {};
        const slotsInfo = Array.isArray(cfg.miManoSlots) ? cfg.miManoSlots.length : 0;
        console.log(`[Sala ${code}] custom slots mi=${slotsInfo} texto="${String(cfg.miMano || '').slice(0, 80)}"`);

        const aplicado = aplicarEscenarioCustom(room.game, cfg);
        if (!aplicado.ok) {
            rooms.delete(code);
            socket.leave(code);
            socket.data.roomCode = null;
            responder({ ok: false, error: aplicado.error || 'No se pudo aplicar el custom.' });
            return;
        }

        room.status = room.game.juegoTerminado ? 'finished' : 'playing';
        emitirLobby(room);
        emitirGameState(room);
        if (room.status === 'playing') programarTurnosBot(room);

        responder({ ok: true, room: serializarLobby(room, socket.id) });
        console.log(`[Sala ${code}] debug custom para ${nombreLimpio}`);
    });

    socket.on('leaveRoom', () => {
        salirDeSala(socket);
    });

    socket.on('startGame', (ack) => {
        const room = obtenerSalaDeSocket(socket);
        const responder = (data) => {
            if (typeof ack === 'function') ack(data);
        };
        if (!room) {
            responder({ ok: false, error: 'No estás en una sala.' });
            return;
        }
        if (room.hostId !== socket.id) {
            responder({ ok: false, error: 'Solo el anfitrión puede iniciar.' });
            return;
        }
        if (room.status !== 'lobby') {
            responder({ ok: false, error: 'La partida ya está en curso.' });
            return;
        }

        if (jugadoresListos(room).length < LOBBY_MIN) {
            responder({ ok: false, error: `Se necesitan al menos ${LOBBY_MIN} jugadores (personas o bots).` });
            return;
        }

        iniciarPartidaEnSala(room);
        responder({ ok: true });
    });

    socket.on('exportGameReport', (ack) => {
        const room = obtenerSalaDeSocket(socket);
        const responder = (data) => {
            if (typeof ack === 'function') ack(data);
        };

        if (!room?.game) {
            responder({ ok: false, error: 'No hay partida para exportar.' });
            return;
        }
        if (room.status !== 'playing' && room.status !== 'finished') {
            responder({ ok: false, error: 'No hay partida activa.' });
            return;
        }

        const jugador = encontrarJugador(room, socket.id);
        if (!jugador || jugador.playerIndex == null) {
            responder({ ok: false, error: 'No eres un jugador de esta partida.' });
            return;
        }

        const informe = room.game.generarInformePartida(jugador.playerIndex);
        informe.metaSala = {
            code: room.code,
            status: room.status,
            esDebug: !!room.esDebug,
            jugadores: room.players.map(p => ({
                nombre: p.nombre,
                esBot: !!p.esBot,
                playerIndex: p.playerIndex
            }))
        };

        responder({ ok: true, informe });
    });

    socket.on('gameAction', (payload = {}, ack) => {
        const room = obtenerSalaDeSocket(socket);
        const responder = (data) => {
            if (typeof ack === 'function') ack(data);
        };

        if (!room || !room.game || room.status !== 'playing') {
            responder({ ok: false, error: 'No hay partida activa.' });
            return;
        }

        const jugador = encontrarJugador(room, socket.id);
        if (!jugador || jugador.playerIndex == null) {
            responder({ ok: false, error: 'No eres un jugador de esta partida.' });
            return;
        }

        const playerIndex = jugador.playerIndex;
        const game = room.game;
        const type = payload.type;
        let ok = false;

        if (type === 'REORDENAR_MANO') {
            ok = game.reordenarMano(payload.ordenIds || [], playerIndex);
            if (!ok) {
                responder({ ok: false, error: 'No se pudo reordenar la mano.' });
                return;
            }
            responder({ ok: true });
            return;
        }

        if (!game.juegoTerminado && !game.esTurnoDe(playerIndex)) {
            const msg = 'No es tu turno.';
            socket.emit('actionError', { message: msg });
            responder({ ok: false, error: msg });
            return;
        }

        switch (type) {
            case 'ROBAR_MAZO':
                ok = game.robarDeMazo(playerIndex);
                break;
            case 'ROBAR_DESCARTE':
                ok = game.robarDeDescarte(payload.cartasIds || [], playerIndex);
                break;
            case 'DESCARTAR':
                ok = game.descartarCarta(payload.cartaId, playerIndex);
                break;
            case 'CANTAR_PUNTOS':
                ok = !!game.cantarPorPuntos(playerIndex);
                break;
            default:
                responder({ ok: false, error: 'Acción desconocida.' });
                return;
        }

        if (!ok) {
            const msg = 'Acción inválida.';
            socket.emit('actionError', { message: msg });
            responder({ ok: false, error: msg });
            emitirGameState(room);
            return;
        }

        if (game.juegoTerminado) {
            room.status = 'finished';
            emitirLobby(room);
        }

        emitirGameState(room);
        responder({ ok: true });
        programarTurnosBot(room);
    });

    socket.on('returnToLobby', (ack) => {
        const room = obtenerSalaDeSocket(socket);
        const responder = (data) => {
            if (typeof ack === 'function') ack(data);
        };
        if (!room) {
            responder({ ok: false, error: 'No estás en una sala.' });
            return;
        }
        if (room.hostId !== socket.id) {
            responder({ ok: false, error: 'Solo el anfitrión puede volver al lobby.' });
            return;
        }

        if (room._botTimer) {
            clearTimeout(room._botTimer);
            room._botTimer = null;
        }
        cancelarGraciaEliminacion(room);
        room.game = null;
        room.status = 'lobby';
        room.players.forEach(p => {
            p.playerIndex = null;
        });
        emitirLobby(room);
        io.to(room.code).emit('gameState', null);
        responder({ ok: true });
    });

    socket.on('reclaimSession', ({ roomCode, sessionId } = {}, ack) => {
        const responder = (data) => {
            if (typeof ack === 'function') ack(data);
        };
        const code = String(roomCode || '').trim();
        const sid = String(sessionId || '').trim();
        if (!code || !sid) {
            responder({ ok: false, error: 'Sesión incompleta.' });
            return;
        }

        const room = rooms.get(code);
        if (!room) {
            responder({ ok: false, error: 'La partida ya no está disponible.' });
            return;
        }

        const jugador = room.players.find(p => !p.esBot && p.sessionId === sid);
        if (!jugador) {
            responder({ ok: false, error: 'No se encontró tu asiento en la sala.' });
            return;
        }

        // Si ya estaba en otra sala con este socket, limpiar
        if (socket.data.roomCode && socket.data.roomCode !== code) {
            salirDeSala(socket);
        }

        const eraHost = room.hostId === jugador.socketId;
        jugador.socketId = socket.id;
        jugador.conectado = true;
        if (eraHost) room.hostId = socket.id;

        cancelarGraciaEliminacion(room);
        socket.data.roomCode = code;
        socket.join(code);

        if (room.game) {
            room.game.log(`${jugador.nombre} se reconectó.`);
        }

        emitirLobby(room);
        if (room.game && jugador.playerIndex != null) {
            const vista = room.game.serializarParaJugador(jugador.playerIndex);
            socket.emit('gameState', vista);
        }
        programarTurnosBot(room);

        responder({ ok: true, room: serializarLobby(room, socket.id) });
        console.log(`[Sala ${code}] ${jugador.nombre} reconectó`);
    });

    socket.on('disconnect', () => {
        console.log(`[-] Desconectado: ${socket.id}`);
        salirDeSala(socket, true);
    });
});

function salirDeSala(socket, porDesconexion = false) {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) {
        socket.data.roomCode = null;
        return;
    }

    const idx = room.players.findIndex(p => !p.esBot && p.socketId === socket.id);
    if (idx === -1) {
        socket.data.roomCode = null;
        return;
    }

    const jugador = room.players[idx];

    if (room.status === 'lobby') {
        room.players.splice(idx, 1);
        const humanos = room.players.filter(p => !p.esBot);
        if (humanos.length === 0) {
            if (room._botTimer) clearTimeout(room._botTimer);
            cancelarGraciaEliminacion(room);
            rooms.delete(code);
            console.log(`[Sala ${code}] eliminada (vacía)`);
        } else {
            if (room.hostId === socket.id) {
                room.hostId = humanos[0].socketId;
            }
            emitirLobby(room);
        }
    } else if (porDesconexion) {
        // Partida en curso / terminada: conservar asiento para reconectar (p.ej. minimizar el browser)
        jugador.conectado = false;
        if (room.game) {
            room.game.log(`${jugador.nombre} se desconectó.`);
            emitirGameState(room);
        }
        emitirLobby(room);

        const alguienHumano = room.players.some(p => !p.esBot && p.conectado);
        if (!alguienHumano) {
            if (room._botTimer) {
                clearTimeout(room._botTimer);
                room._botTimer = null;
            }
            programarEliminacionSiVacia(room);
            console.log(`[Sala ${code}] esperando reconexión (${RECONNECT_GRACE_MS / 1000}s)`);
        } else {
            programarTurnosBot(room);
        }
    } else {
        // Salida voluntaria: liberar asiento ya
        room.players.splice(idx, 1);
        const humanos = room.players.filter(p => !p.esBot);
        if (humanos.length === 0) {
            if (room._botTimer) clearTimeout(room._botTimer);
            cancelarGraciaEliminacion(room);
            rooms.delete(code);
            console.log(`[Sala ${code}] eliminada (salida voluntaria)`);
        } else {
            if (room.hostId === socket.id) {
                room.hostId = humanos.find(p => p.conectado)?.socketId || humanos[0].socketId;
            }
            if (room.game) emitirGameState(room);
            emitirLobby(room);
            programarTurnosBot(room);
        }
    }

    socket.leave(code);
    socket.data.roomCode = null;
    if (!porDesconexion) {
        socket.emit('roomState', null);
        socket.emit('gameState', null);
    }
}

server.listen(PORT, HOST, () => {
    console.log(`Golpeado multijugador en http://${HOST}:${PORT}`);
    console.log('Abre la URL en varios dispositivos/navegadores para jugar.');
});
