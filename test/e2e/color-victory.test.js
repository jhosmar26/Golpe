/**
 * E2E (motor): partida completa hasta victoria por Color y tabla final correcta.
 * Sin navegador: arranca juego → fuerza Color → resultadores de victoria.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { crearCarta, GolpeadoGame } from '../../game.js';

describe('e2e: victoria por Color', () => {
    it('desde inicio forzado hasta resultados finales coherentes', () => {
        const game = new GolpeadoGame();
        game.inicializarJuego(['Tú', 'Rival']);

        // Evitar victoria accidental al iniciar; luego forzar Color en tu mano
        assert.equal(game.jugadores.length, 2);

        game.juegoTerminado = false;
        game.ganadorId = null;
        game.tipoVictoria = null;
        game.mazoRecicladoUnaVez = false;
        game.turnoActual = 0;
        game.faseActual = 'DESCARTE';

        game.jugadores[0].nombre = 'Tú';
        game.jugadores[0].tuvoRoboDescarte = false;
        game.jugadores[0].gruposExpuestos = [];
        // 8 del mismo palo = Color usando todas las cartas
        game.jugadores[0].mano = [1, 2, 3, 4, 5, 6, 7, 8].map(v => crearCarta('D', v));

        game.jugadores[1].tuvoRoboDescarte = false;
        game.jugadores[1].gruposExpuestos = [];
        game.jugadores[1].mano = [
            crearCarta('H', 2), crearCarta('C', 5), crearCarta('S', 9),
            crearCarta('H', 11), crearCarta('C', 12), crearCarta('S', 3),
            crearCarta('H', 7)
        ];

        game.verificarVictoriaEspecial(game.jugadores[0]);

        assert.equal(game.juegoTerminado, true);
        assert.equal(game.tipoVictoria, 'COLOR');
        assert.equal(game.ganadorId, 0);

        const vista = game.serializarParaJugador(0);
        assert.equal(vista.juegoTerminado, true);
        assert.equal(vista.tipoVictoria, 'COLOR');
        assert.ok(Array.isArray(vista.resultadosVictoria));

        const yo = vista.resultadosVictoria.find(r => r.esGanador);
        const rival = vista.resultadosVictoria.find(r => !r.esGanador);

        assert.ok(yo);
        assert.equal(yo.jugadaEspecial, 'COLOR');
        assert.equal(yo.puntosSueltas, 0);
        assert.equal(yo.cartasSueltasText, 'Ninguna');
        assert.equal(yo.gruposArmados[0].etiqueta, 'Color');
        assert.equal(yo.gruposArmados[0].cartas.length, 8);

        assert.ok(rival);
        assert.equal(rival.jugadaEspecial, null);
        // El rival sí se evalúa con deadwood normal (≥ 0)
        assert.ok(rival.puntosSueltas >= 0);
    });

    it('descartar hacia Color en el flujo de turno cierra la partida', () => {
        const game = new GolpeadoGame();
        game.inicializarJuego(['Ana', 'Luis']);

        game.juegoTerminado = false;
        game.ganadorId = null;
        game.tipoVictoria = null;
        game.mazoRecicladoUnaVez = false;
        game.turnoActual = 0;
        game.faseActual = 'DESCARTE';
        game.jugadores[0].tuvoRoboDescarte = false;
        game.jugadores[0].gruposExpuestos = [];
        // 7♦ + 1 comodín a descartar → tras descarte quedan 7♦ = Color
        game.jugadores[0].mano = [
            crearCarta('D', 1), crearCarta('D', 2), crearCarta('D', 3),
            crearCarta('D', 4), crearCarta('D', 5), crearCarta('D', 6),
            crearCarta('D', 7), crearCarta('S', 13)
        ];

        const ok = game.descartarCarta('S13', 0);
        assert.equal(ok, true);
        assert.equal(game.juegoTerminado, true);
        assert.equal(game.tipoVictoria, 'COLOR');

        const ana = game.obtenerResultadosVictoria().find(r => r.id === 0);
        assert.equal(ana.puntosSueltas, 0);
        assert.equal(ana.cartasSueltas.length, 0);
        assert.equal(ana.gruposArmados[0].origen, 'color');
        assert.equal(ana.gruposArmados[0].cartas.length, 7);

        const informe = game.generarInformePartida(0);
        assert.equal(informe.resumen.tipoVictoria, 'COLOR');
        assert.ok(Array.isArray(informe.historial));
        assert.ok(informe.jugadores[0].deteccionEspecial.tieneColor);
    });
});
