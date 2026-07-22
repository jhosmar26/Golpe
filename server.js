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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3080;
const HOST = process.env.HOST || '0.0.0.0';
const LOBBY_MIN = 2;
const LOBBY_MAX = 6;

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

function serializarLobby(room, socketId) {
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
            esYo: p.socketId === socketId,
            esHost: p.socketId === room.hostId
        })),
        minPlayers: LOBBY_MIN,
        maxPlayers: LOBBY_MAX,
        puedeEmpezar: room.players.filter(p => p.conectado).length >= LOBBY_MIN
    };
}

function emitirLobby(room) {
    for (const p of room.players) {
        if (!p.conectado) continue;
        io.to(p.socketId).emit('roomState', serializarLobby(room, p.socketId));
    }
}

function emitirGameState(room) {
    if (!room.game) return;
    for (const p of room.players) {
        if (!p.conectado || p.playerIndex == null) continue;
        const vista = room.game.serializarParaJugador(p.playerIndex);
        io.to(p.socketId).emit('gameState', vista);
    }
}

function encontrarJugador(room, socketId) {
    return room.players.find(p => p.socketId === socketId) || null;
}

io.on('connection', (socket) => {
    console.log(`[+] Conectado: ${socket.id}`);

    socket.on('createRoom', ({ nombre } = {}, ack) => {
        const nombreLimpio = String(nombre || '').trim() || 'Anfitrión';
        const code = generarCodigoSala();
        const room = {
            code,
            hostId: socket.id,
            status: 'lobby',
            players: [{
                socketId: socket.id,
                nombre: nombreLimpio,
                conectado: true,
                playerIndex: null
            }],
            game: null
        };
        rooms.set(code, room);
        socket.data.roomCode = code;
        socket.join(code);

        const payload = serializarLobby(room, socket.id);
        if (typeof ack === 'function') ack({ ok: true, room: payload });
        socket.emit('roomState', payload);
        console.log(`[Sala ${code}] creada por ${nombreLimpio}`);
    });

    socket.on('joinRoom', ({ code, nombre } = {}, ack) => {
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
        if (room.players.filter(p => p.conectado).length >= LOBBY_MAX) {
            responder({ ok: false, error: 'La sala está llena.' });
            return;
        }

        const nombreLimpio = String(nombre || '').trim() || `Jugador ${room.players.length + 1}`;
        room.players.push({
            socketId: socket.id,
            nombre: nombreLimpio,
            conectado: true,
            playerIndex: null
        });
        socket.data.roomCode = codeNorm;
        socket.join(codeNorm);

        emitirLobby(room);
        responder({ ok: true, room: serializarLobby(room, socket.id) });
        console.log(`[Sala ${codeNorm}] ${nombreLimpio} se unió`);
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

        const conectados = room.players.filter(p => p.conectado);
        if (conectados.length < LOBBY_MIN) {
            responder({ ok: false, error: `Se necesitan al menos ${LOBBY_MIN} jugadores.` });
            return;
        }

        // Compactar lista a solo conectados al iniciar
        room.players = conectados;
        room.players.forEach((p, idx) => {
            p.playerIndex = idx;
        });

        const nombres = room.players.map(p => p.nombre);
        room.game = new GolpeadoGame();
        room.game.inicializarJuego(nombres);
        room.status = 'playing';

        emitirLobby(room);
        emitirGameState(room);
        responder({ ok: true });
        console.log(`[Sala ${room.code}] partida iniciada (${nombres.join(', ')})`);
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

        // Reordenar mano: local al jugador, sin exigir turno ni notificar a rivales
        if (type === 'REORDENAR_MANO') {
            ok = game.reordenarMano(payload.ordenIds || [], playerIndex);
            if (!ok) {
                responder({ ok: false, error: 'No se pudo reordenar la mano.' });
                return;
            }
            // Solo confirmación al que reordenó; no emitir gameState a la sala
            responder({ ok: true });
            return;
        }

        // Autoridad de turno (excepto si el juego ya terminó)
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
            // Aun así sincronizar por si el estado cambió parcialmente
            emitirGameState(room);
            return;
        }

        if (game.juegoTerminado) {
            room.status = 'finished';
            emitirLobby(room);
        }

        emitirGameState(room);
        responder({ ok: true });
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

        room.game = null;
        room.status = 'lobby';
        room.players.forEach(p => {
            p.playerIndex = null;
        });
        emitirLobby(room);
        io.to(room.code).emit('gameState', null);
        responder({ ok: true });
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

    const idx = room.players.findIndex(p => p.socketId === socket.id);
    if (idx === -1) {
        socket.data.roomCode = null;
        return;
    }

    const jugador = room.players[idx];

    if (room.status === 'lobby') {
        room.players.splice(idx, 1);
        if (room.players.length === 0) {
            rooms.delete(code);
            console.log(`[Sala ${code}] eliminada (vacía)`);
        } else {
            if (room.hostId === socket.id) {
                room.hostId = room.players[0].socketId;
            }
            emitirLobby(room);
        }
    } else {
        // En partida: marcar desconectado; no eliminar asiento
        jugador.conectado = false;
        if (room.game) {
            room.game.log(`${jugador.nombre} se desconectó.`);
            emitirGameState(room);
        }
        emitirLobby(room);

        const alguienConectado = room.players.some(p => p.conectado);
        if (!alguienConectado) {
            rooms.delete(code);
            console.log(`[Sala ${code}] eliminada (todos desconectados)`);
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
